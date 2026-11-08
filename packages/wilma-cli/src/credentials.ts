import {
  AuthenticationError,
  MfaRequiredError,
  WilmaClient,
  type MfaCallback,
  type StudentInfo,
  type WilmaProfile,
} from "@wilm-ai/wilma-client";
import {
  editConfig,
  loadConfig,
  obfuscateSecret,
  revealSecret,
  saveConfig,
  savedStudent,
  type CliConfig,
  type StoredProfile,
} from "./config.js";
import {
  effectiveSecretStore,
  keychainProblem,
  newCredentialsStamp,
  newSecretId,
  readBackLoginSecrets,
  readLoginSecrets,
  SecretStoreError,
  secretErrorMessage,
  writeLoginSecrets,
  type LoginSecrets,
} from "./secret-store.js";
import { fileLoginKeys, keychainLoginKeys, type SessionKeys } from "./session-keys.js";
import { generateTOTP, parseTotpSecret, TOTP_PERIOD_MS, totpCounter } from "./totp.js";
import { normalizeTenantUrl, resolveTenant } from "./tenant-search.js";

/**
 * Environment variables for agents that keep secrets in their own store
 * (cloud VMs, CI-like sandboxes) instead of a config file.
 */
export const ENV_VARS = {
  tenant: "WILMA_TENANT",
  username: "WILMA_USERNAME",
  password: "WILMA_PASSWORD",
  totpSecret: "WILMA_TOTP_SECRET",
} as const;

export interface ActiveAccount {
  /** For a keychain login the password is empty here: `secrets` reads it, only when Wilma needs a new login. */
  profile: WilmaProfile;
  totpSecret?: string;
  /** A keychain login's (or an unreadable login's) password and authenticator key, read only when needed. */
  secrets?: () => Promise<LoginSecrets>;
  /** Whether an authenticator key is saved (for `secrets` logins, without reading it). */
  hasTotp?: boolean;
  /** Where its session is saved and pooled (v1 for file and environment logins, v2 for keychain logins). */
  keys: SessionKeys;
  /** Present when the account comes from the saved config. */
  stored?: StoredProfile;
  source: "config" | "env";
}

export class TotpSecretRequiredError extends Error {
  constructor() {
    super(
      "This Wilma account uses two-step verification. Provide the authenticator setup key (base32 key or otpauth:// link) so logins can run unattended."
    );
  }
}

export class TotpSecretInvalidError extends Error {
  constructor(message = "Wilma didn't accept the two-step verification code. Check the authenticator setup key.") {
    super(message);
  }
}

/** Reject obvious mistakes, like a 6-digit one-time code pasted where the setup key belongs. */
function checkTotpSecret(raw: string): void {
  const value = raw.trim();
  if (/^\d{6,8}$/.test(value)) {
    throw new TotpSecretInvalidError(
      "That looks like a one-time code. Paste the authenticator setup key instead (a long base32 key or an otpauth:// link)."
    );
  }
  try {
    const secret = parseTotpSecret(value);
    if (secret.replace(/=+$/, "").length < 16) throw new Error("too short");
    generateTOTP(secret);
  } catch {
    throw new TotpSecretInvalidError("That doesn't look like an authenticator setup key (a base32 key or an otpauth:// link).");
  }
}

/**
 * Answers Wilma's two-step challenge from the saved authenticator key. If
 * Wilma rejects a code and asks again for the same challenge (a code is
 * usually rejected because it was already used — logins less than 30 seconds
 * apart share one), it waits for the next 30-second window and gives a fresh
 * code. No delay unless Wilma actually refuses.
 */
export function mfaCallbackFor(
  totpSecret?: string | null,
  clock: { now: () => number; sleep: (ms: number) => Promise<void> } = {
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }
): MfaCallback | undefined {
  if (!totpSecret) return undefined;
  const secret = parseTotpSecret(totpSecret);
  const usedFor = new Map<string, number>(); // challenge (formkey) -> time step of the code given
  return async (formkey: string) => {
    let counter = totpCounter(clock.now());
    const previous = usedFor.get(formkey);
    if (previous !== undefined && previous >= counter) {
      await clock.sleep((previous + 1) * TOTP_PERIOD_MS - clock.now() + 50);
      counter = previous + 1;
    }
    usedFor.set(formkey, counter);
    return generateTOTP(secret, counter * TOTP_PERIOD_MS);
  };
}

function hasEnvAccount(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env[ENV_VARS.tenant] && env[ENV_VARS.username] && env[ENV_VARS.password]);
}

/** A saved login as an account: its password from the file, or (keychain logins) read only when needed. */
export function accountFor(stored: StoredProfile): ActiveAccount {
  const profile = {
    baseUrl: stored.tenantUrl,
    username: stored.username,
    password: "",
    studentNumber: stored.lastStudentNumber ?? undefined,
  };
  const wilma = stored.tenantName ?? stored.tenantUrl;
  const base = { stored, source: "config" as const };
  if (stored.secrets === "keychain" && stored.secretId) {
    const ref = { secretId: stored.secretId, credentialsStamp: stored.credentialsStamp, wilma };
    return {
      ...base,
      profile,
      secrets: () => readLoginSecrets(ref),
      hasTotp: Boolean(stored.hasTotp),
      keys: keychainLoginKeys(stored.tenantUrl, stored.username, stored.credentialsStamp),
    };
  }
  if (stored.secrets) {
    // Kept somewhere this version doesn't know (a newer WilmAI saved it).
    const error = new SecretStoreError("unavailable", secretErrorMessage("unavailable", wilma));
    return { ...base, profile, secrets: () => Promise.reject(error), keys: keychainLoginKeys(stored.tenantUrl, stored.username, stored.credentialsStamp) };
  }
  const password = revealSecret(stored.passwordObfuscated);
  if (!password) {
    // Reported when used, not skipped: a skipped login looks like "not logged in" and invites a second login.
    const error = new SecretStoreError("missing", `The saved password for ${wilma} can't be read. Log in again (\`wilma login\`).`);
    return { ...base, profile, secrets: () => Promise.reject(error), keys: keychainLoginKeys(stored.tenantUrl, stored.username, null) };
  }
  const totpSecret = revealSecret(stored.totpSecretObfuscated) ?? undefined;
  return {
    ...base,
    profile: { ...profile, password },
    totpSecret,
    hasTotp: Boolean(totpSecret),
    keys: fileLoginKeys(stored.tenantUrl, stored.username, password),
  };
}

/** The password and authenticator key of an account now (reading the keychain for a keychain login). */
export async function accountSecrets(account: ActiveAccount): Promise<LoginSecrets> {
  if (account.secrets) return account.secrets();
  return { password: account.profile.password, totpSecret: account.totpSecret ?? null };
}

/** Environment variables win over the saved config when all three are set. */
export async function resolveAccount(
  config: CliConfig,
  env: NodeJS.ProcessEnv = process.env
): Promise<ActiveAccount | null> {
  if (hasEnvAccount(env)) {
    const tenant = await resolveTenant(env[ENV_VARS.tenant]!);
    const username = env[ENV_VARS.username]!;
    const password = env[ENV_VARS.password]!;
    return {
      profile: { baseUrl: tenant.url, username, password },
      totpSecret: env[ENV_VARS.totpSecret] || undefined,
      hasTotp: Boolean(env[ENV_VARS.totpSecret]),
      keys: fileLoginKeys(tenant.url, username, password),
      source: "env",
    };
  }
  const stored = config.profiles.find((p) => p.id === config.lastProfileId);
  return stored ? accountFor(stored) : null;
}

/**
 * Every Wilma login the family has. Environment variables give exactly one;
 * otherwise all saved logins, the active one first. Families with children on
 * different Wilmas (e.g. a city school and a private school) save one login each.
 * A login whose password can't be read is kept: it fails with a clear message
 * when used, instead of looking like no login at all.
 */
export async function resolveAccounts(
  config: CliConfig,
  env: NodeJS.ProcessEnv = process.env
): Promise<ActiveAccount[]> {
  if (hasEnvAccount(env)) {
    const account = await resolveAccount(config, env);
    return account ? [account] : [];
  }
  const ordered = [...config.profiles].sort(
    (a, b) => Number(b.id === config.lastProfileId) - Number(a.id === config.lastProfileId)
  );
  const accounts: ActiveAccount[] = [];
  const seen = new Set<string>();
  for (const stored of ordered) {
    // One session per Wilma account, even if an older config saved it twice in different case.
    const key = `${normalizeTenantUrl(stored.tenantUrl)}|${stored.username.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    accounts.push(accountFor(stored));
  }
  return accounts;
}

/**
 * Log in once and return the logged-in client with the account's students.
 * Throws TotpSecretRequiredError for MFA accounts without a key.
 */
export async function verifyLoginSession(input: {
  tenantUrl: string;
  username: string;
  password: string;
  totpSecret?: string | null;
}): Promise<{ client: WilmaClient; students: StudentInfo[] }> {
  if (input.totpSecret) checkTotpSecret(input.totpSecret);
  try {
    const client = await WilmaClient.login(
      { baseUrl: normalizeTenantUrl(input.tenantUrl), username: input.username, password: input.password, studentNumber: null },
      mfaCallbackFor(input.totpSecret)
    );
    return { client, students: await client.students() };
  } catch (err) {
    if (err instanceof MfaRequiredError) throw new TotpSecretRequiredError();
    if (isMfaFailure(err)) throw new TotpSecretInvalidError();
    throw err;
  }
}

/** Where a login's secrets go, decided before Wilma is contacted (section 5 of docs/secret-store.md). */
export interface StoreChoice {
  store: "file" | "keychain";
  /** The keychain entry to use (a login's own, or one this config already reserved for it). */
  secretId?: string;
  /** Said to the user: e.g. saved in the file because no keychain can be used here. */
  note?: string;
}

const sameAccountAs = (tenantUrl: string, username: string) => (p: StoredProfile) =>
  normalizeTenantUrl(p.tenantUrl) === normalizeTenantUrl(tenantUrl) && p.username.toLowerCase() === username.toLowerCase();

const FILE_FALLBACK_NOTE = "Saved in WilmAI's file on this computer: there is no keychain WilmAI can use here.";

/**
 * Decide where a login's secrets go and check the keychain can be used,
 * before anything is sent to Wilma: a login that can't be saved then costs no
 * Wilma login, no ended browser session and no used code. A login saved
 * again keeps its store while that store can be used here; otherwise the
 * setting decides (`auto` and `file`: the file; `keychain`: refused).
 */
export async function chooseSecretStore(config: CliConfig, tenantUrl: string, username: string): Promise<StoreChoice> {
  const setting = effectiveSecretStore(config.secretStore);
  const previous = config.profiles.find(sameAccountAs(tenantUrl, username));
  const id = previous?.id ?? `${normalizeTenantUrl(tenantUrl)}|${username}`;
  const reserved = config.keychainLogins?.[id];
  // A saved keychain login stays in the keychain; a saved file login moves only by the saved setting (the
  // environment variable decides only where new logins go); a new login follows the setting in effect.
  const wantsKeychain =
    previous?.secrets === "keychain" ||
    (previous ? effectiveSecretStore(config.secretStore, {}) !== "file" : setting !== "file");
  if (!wantsKeychain) return { store: "file" };
  const problem = await keychainProblem();
  if (!problem) return { store: "keychain", secretId: previous?.secretId ?? reserved ?? newSecretId() };
  if (setting === "keychain") {
    throw new SecretStoreError(
      "unavailable",
      `WilmAI is set to keep passwords in the keychain, but there's no keychain it can use on this computer (${problem}). Nothing was sent to Wilma.`
    );
  }
  return { store: "file", note: FILE_FALLBACK_NOTE };
}

/** The authenticator key a login already has, so logging in again without one keeps it. */
async function previousTotp(previous: StoredProfile | undefined): Promise<string | null> {
  if (!previous) return null;
  if (previous.secrets === "keychain" && previous.secretId && previous.hasTotp) {
    return (await readBackLoginSecrets(previous.secretId).catch(() => null))?.totpSecret ?? null;
  }
  return revealSecret(previous.totpSecretObfuscated);
}

/**
 * Save a verified login as the active profile, replacing any profile with the
 * same tenant and username, in the store chosen by chooseSecretStore. A
 * keychain entry is recorded in `keychainLogins` before it is written (reusing
 * one another process reserved meanwhile), and read back before the login
 * points at it. Under `auto`, a keychain that fails here falls back to the
 * file (the returned note says so). The keychain calls come first; the
 * profile is then saved onto a fresh read of the config, so a move or a login
 * another process saved meanwhile isn't undone. `config` is updated to match.
 */
export async function saveLogin(
  config: CliConfig,
  input: {
    tenantUrl: string;
    tenantName?: string | null;
    username: string;
    password: string;
    totpSecret?: string | null;
    students: StudentInfo[];
  },
  choice: StoreChoice = { store: "file" }
): Promise<StoredProfile & { note?: string }> {
  const tenantUrl = normalizeTenantUrl(input.tenantUrl);
  // Wilma usernames are case-insensitive: "Matti.M" and "matti.m" are one account
  // (saving it twice would make two sessions that keep cancelling each other).
  const sameAccount = sameAccountAs(tenantUrl, input.username);
  const id = config.profiles.find(sameAccount)?.id ?? `${tenantUrl}|${input.username}`;
  const totpSecret = input.totpSecret?.trim() || (await previousTotp(config.profiles.find(sameAccount)));
  const secrets: LoginSecrets = { password: input.password, totpSecret };

  let note = choice.note;
  let secretFields: Partial<StoredProfile>;
  let secretId: string | undefined;
  if (choice.store === "keychain") {
    try {
      // Recorded before the entry exists, so no entry is ever unknown to the config.
      await editConfig((fresh) => {
        secretId = fresh.keychainLogins?.[id] ?? choice.secretId ?? newSecretId();
        if (fresh.keychainLogins?.[id] === secretId) return false;
        fresh.keychainLogins = { ...fresh.keychainLogins, [id]: secretId };
      });
      await writeLoginSecrets(secretId!, secrets);
      const back = await readBackLoginSecrets(secretId!);
      if (back?.password !== secrets.password || (back?.totpSecret ?? null) !== (secrets.totpSecret ?? null)) {
        throw new SecretStoreError("refused", "The keychain didn't keep the password as saved.");
      }
      secretFields = { secrets: "keychain", secretId, hasTotp: Boolean(totpSecret) };
    } catch (err) {
      // `keychain` never quietly saves to the file; `auto` and `file` do, and say so.
      if (effectiveSecretStore(config.secretStore) === "keychain") throw err;
      note = FILE_FALLBACK_NOTE;
      secretFields = fileSecretFields(secrets);
    }
  } else {
    secretFields = fileSecretFields(secrets);
  }

  let stored: StoredProfile | undefined;
  const fresh = await editConfig((latest) => {
    const previous = latest.profiles.find(sameAccount);
    const keepLast = previous?.lastStudentNumber
      ? input.students.find((s) => s.studentNumber === previous.lastStudentNumber)
      : undefined;
    const lastStudent = keepLast ?? input.students[0];
    stored = {
      id: previous?.id ?? id,
      tenantUrl,
      tenantName: input.tenantName ?? previous?.tenantName ?? tenantUrl,
      username: input.username,
      ...secretFields,
      credentialsStamp: newCredentialsStamp(),
      students: input.students.map(savedStudent),
      lastStudentNumber: lastStudent?.studentNumber ?? null,
      lastStudentName: lastStudent?.name ?? null,
      lastUsedAt: new Date().toISOString(),
    };
    // Logging in again keeps the login's place in the list (`wilma accounts` numbers stay put).
    const at = latest.profiles.findIndex(sameAccount);
    const others = latest.profiles.filter((p) => !sameAccount(p));
    latest.profiles = at === -1 ? [...others, stored] : [...others.slice(0, at), stored, ...others.slice(at)];
    latest.lastProfileId = stored.id;
  });
  Object.assign(config, fresh);
  return note ? { ...stored!, note } : stored!;
}

function fileSecretFields(secrets: LoginSecrets): Partial<StoredProfile> {
  return {
    passwordObfuscated: obfuscateSecret(secrets.password),
    totpSecretObfuscated: secrets.totpSecret ? obfuscateSecret(secrets.totpSecret.trim()) : null,
    hasTotp: Boolean(secrets.totpSecret),
  };
}

/**
 * Save an authenticator key for a saved login (the interactive "Save TOTP
 * secret"): into its keychain entry for a keychain login, never the file.
 */
export async function saveTotpSecret(id: string, totpSecret: string): Promise<void> {
  const key = totpSecret.trim();
  const target = (await loadConfig()).profiles.find((p) => p.id === id);
  if (target?.secrets === "keychain" && target.secretId) {
    const current = await readBackLoginSecrets(target.secretId);
    if (!current) throw new SecretStoreError("missing", secretErrorMessage("missing", target.tenantName));
    await writeLoginSecrets(target.secretId, { ...current, totpSecret: key });
  }
  await editConfig((config) => {
    const profile = config.profiles.find((p) => p.id === id);
    if (!profile) return false;
    if (profile.secrets === "keychain") profile.hasTotp = true;
    else {
      profile.totpSecretObfuscated = obfuscateSecret(key);
      profile.hasTotp = true;
    }
    profile.credentialsStamp = newCredentialsStamp();
  });
}

/** The client reports a rejected one-time code as an AuthenticationError starting "MFA verification failed". */
export function isMfaFailure(err: unknown): boolean {
  return err instanceof AuthenticationError && /^MFA verification failed/.test(err.message);
}

// Re-exported so other hosts use the same client classes the CLI does.
export { AuthenticationError } from "@wilm-ai/wilma-client";
