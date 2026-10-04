import {
  AuthenticationError,
  MfaRequiredError,
  WilmaClient,
  type MfaCallback,
  type StudentInfo,
  type WilmaProfile,
} from "@wilm-ai/wilma-client";
import {
  obfuscateSecret,
  revealSecret,
  saveConfig,
  type CliConfig,
  type StoredProfile,
} from "./config.js";
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
  profile: WilmaProfile;
  totpSecret?: string;
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

/** Environment variables win over the saved config when all three are set. */
export async function resolveAccount(
  config: CliConfig,
  env: NodeJS.ProcessEnv = process.env
): Promise<ActiveAccount | null> {
  if (hasEnvAccount(env)) {
    const tenant = await resolveTenant(env[ENV_VARS.tenant]!);
    return {
      profile: {
        baseUrl: tenant.url,
        username: env[ENV_VARS.username]!,
        password: env[ENV_VARS.password]!,
      },
      totpSecret: env[ENV_VARS.totpSecret] || undefined,
      source: "env",
    };
  }
  const stored = config.profiles.find((p) => p.id === config.lastProfileId);
  if (!stored) return null;
  const password = revealSecret(stored.passwordObfuscated);
  if (!password) {
    throw new Error("Stored password could not be decoded. Run `wilma login` again.");
  }
  return {
    profile: {
      baseUrl: stored.tenantUrl,
      username: stored.username,
      password,
      studentNumber: stored.lastStudentNumber ?? undefined,
    },
    totpSecret: stored.totpSecretObfuscated ? revealSecret(stored.totpSecretObfuscated) ?? undefined : undefined,
    stored,
    source: "config",
  };
}

/**
 * Every Wilma login the family has. Environment variables give exactly one;
 * otherwise all saved logins, the active one first. Families with children on
 * different Wilmas (e.g. a city school and a private school) save one login each.
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
    const password = revealSecret(stored.passwordObfuscated);
    if (!password) continue;
    accounts.push({
      profile: {
        baseUrl: stored.tenantUrl,
        username: stored.username,
        password,
        studentNumber: stored.lastStudentNumber ?? undefined,
      },
      totpSecret: stored.totpSecretObfuscated ? revealSecret(stored.totpSecretObfuscated) ?? undefined : undefined,
      stored,
      source: "config",
    });
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

/** Save a verified login as the active profile, replacing any profile with the same tenant and username. */
export async function saveLogin(
  config: CliConfig,
  input: {
    tenantUrl: string;
    tenantName?: string | null;
    username: string;
    password: string;
    totpSecret?: string | null;
    students: StudentInfo[];
  }
): Promise<StoredProfile> {
  const tenantUrl = normalizeTenantUrl(input.tenantUrl);
  // Wilma usernames are case-insensitive: "Matti.M" and "matti.m" are one account
  // (saving it twice would make two sessions that keep cancelling each other).
  const sameAccount = (p: StoredProfile) =>
    normalizeTenantUrl(p.tenantUrl) === tenantUrl && p.username.toLowerCase() === input.username.toLowerCase();
  const previous = config.profiles.find(sameAccount);
  const id = previous?.id ?? `${tenantUrl}|${input.username}`;
  const keepLast = previous?.lastStudentNumber
    ? input.students.find((s) => s.studentNumber === previous.lastStudentNumber)
    : undefined;
  const lastStudent = keepLast ?? input.students[0];
  const stored: StoredProfile = {
    id,
    tenantUrl,
    tenantName: input.tenantName ?? previous?.tenantName ?? tenantUrl,
    username: input.username,
    passwordObfuscated: obfuscateSecret(input.password),
    totpSecretObfuscated: input.totpSecret ? obfuscateSecret(input.totpSecret.trim()) : previous?.totpSecretObfuscated ?? null,
    students: input.students.map((s) => ({ studentNumber: s.studentNumber, name: s.name })),
    lastStudentNumber: lastStudent?.studentNumber ?? null,
    lastStudentName: lastStudent?.name ?? null,
    lastUsedAt: new Date().toISOString(),
  };
  // Logging in again keeps the login's place in the list (`wilma accounts` numbers stay put).
  const at = config.profiles.findIndex(sameAccount);
  const others = config.profiles.filter((p) => !sameAccount(p));
  config.profiles = at === -1 ? [...others, stored] : [...others.slice(0, at), stored, ...others.slice(at)];
  config.lastProfileId = id;
  await saveConfig(config);
  return stored;
}

/** The client reports a rejected one-time code as an AuthenticationError starting "MFA verification failed". */
export function isMfaFailure(err: unknown): boolean {
  return err instanceof AuthenticationError && /^MFA verification failed/.test(err.message);
}

// Re-exported so other hosts use the same client classes the CLI does.
export { AuthenticationError } from "@wilm-ai/wilma-client";
