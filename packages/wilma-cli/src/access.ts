import type { MfaCallback } from "@wilm-ai/wilma-client";
import type { StudentInfo, WilmaClient } from "@wilm-ai/wilma-client";
import { WilmaAccess, WilmaAiError, adoptSession, forgetSession, logoutSession } from "./agent-data.js";
import { editConfig, loadConfig, saveConfig, savedStudent, type StoredProfile } from "./config.js";
import { accountFor, mfaCallbackFor, saveLogin, type ActiveAccount, type StoreChoice } from "./credentials.js";
import { deleteLoginSecrets } from "./secret-store.js";

/**
 * Codes from the saved authenticator key. A keychain login's key comes from
 * the same single read as its password (no second keychain access), and one
 * code generator serves the whole process, so a rejected code waits for the
 * next one instead of repeating it.
 */
function mfaFor(account: ActiveAccount): MfaCallback | undefined {
  if (!account.secrets) return mfaCallbackFor(account.totpSecret);
  if (!account.hasTotp) return undefined;
  const read = account.secrets;
  let generator: Promise<MfaCallback | undefined> | null = null;
  return async (formkey) => {
    const pending = (generator ??= read().then((secrets) => mfaCallbackFor(secrets.totpSecret)));
    pending.catch(() => {
      if (generator === pending) generator = null;
    });
    const callback = await pending;
    if (!callback) throw new WilmaAiError("mfa_required", "Wilma asks for a two-step verification code, and no authenticator key is saved for this login. Run `wilma login`.");
    return callback(formkey);
  };
}

/**
 * Wilma access for the saved (or environment) logins — the same for CLI
 * commands and the local MCP server. Refreshed child lists are written back
 * to the config, changing only that field, so parallel commands and logins
 * aren't overwritten.
 */
export function createAccess(accounts: ActiveAccount[], opts: { debug?: boolean; totpSecret?: string } = {}): WilmaAccess {
  return new WilmaAccess(
    accounts.map((account, index) => ({
      profile: { ...account.profile, debug: opts.debug ?? account.profile.debug },
      password: account.secrets ? async () => (await account.secrets!()).password : undefined,
      keys: account.keys,
      // A --totp-secret given on the command line belongs to the first (active) login.
      mfa: index === 0 && opts.totpSecret ? mfaCallbackFor(opts.totpSecret) : mfaFor(account),
      label: account.stored?.tenantName ?? account.profile.baseUrl,
      knownStudents: account.stored?.students,
      hidden: account.stored?.hidden,
      onStudents: async (students) => {
        const stored = account.stored;
        // An empty answer from Wilma keeps the saved list (see knownStudents).
        if (!stored || !students.length) return;
        const fresh = students.map(savedStudent);
        if (JSON.stringify(fresh) === JSON.stringify(stored.students ?? [])) return;
        const latest = await loadConfig();
        const target = latest.profiles.find((p) => p.id === stored.id);
        if (!target) return;
        target.students = fresh;
        await saveConfig(latest);
      },
    }))
  );
}

/**
 * End WilmAI's Wilma session for each login (see logoutSession), for `wilma
 * logout` and the wilma_logout tool. The logins stay saved. Tries every login
 * (different Wilmas don't affect each other), then throws the first failure.
 */
export async function logoutAccounts(accounts: ActiveAccount[]) {
  const results = await Promise.allSettled(accounts.map((account) => logoutSession(account.profile, account.keys)));
  const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed) throw failed.reason;
  const logins = accounts.map((account, index) => ({
    wilma: account.stored?.tenantName ?? account.profile.baseUrl,
    username: account.profile.username,
    session: (results[index] as PromiseFulfilledResult<boolean>).value ? ("ended" as const) : ("none" as const),
  }));
  return {
    status: "ok" as const,
    logins,
    hint: logins.length
      ? "The logins stay saved. The next time WilmAI reads Wilma it logs in again, and that ends the user's Wilma session in the browser."
      : "No saved Wilma login, so there was nothing to log out.",
  };
}

export type RemovedSession = ({ session: "ended" | "none" } | { session: "not_ended"; message: string }) & {
  /** Its keychain entry couldn't be deleted (it stays recorded, so `wilma config clear` can try again). */
  keychainEntryLeft?: string;
};

/**
 * Remove a saved login (`wilma accounts remove`, the login page's Remove) and
 * end its Wilma session; the other logins keep theirs. The login is removed
 * even when Wilma can't be reached: its saved session is forgotten anyway,
 * and Wilma ends the session when it expires.
 */
export async function removeLogin(id: string): Promise<{ removed: StoredProfile } & RemovedSession> {
  const config = await loadConfig();
  const removed = config.profiles.find((p) => p.id === id);
  if (!removed) throw new WilmaAiError("unknown_account", "That login isn't saved any more.");
  config.profiles = config.profiles.filter((p) => p.id !== id);
  if (config.lastProfileId === id) config.lastProfileId = config.profiles[0]?.id ?? null;
  const entry = removed.secretId ?? config.keychainLogins?.[id];
  await saveConfig(config);
  // The session first (it needs no password), then the keychain entry; its record goes only once it's deleted.
  const session = await endSession(removed);
  if (!entry) return { removed, ...session };
  try {
    await deleteLoginSecrets(entry);
  } catch (err) {
    return { removed, ...session, keychainEntryLeft: err instanceof Error ? err.message : String(err) };
  }
  await editConfig((fresh) => {
    if (fresh.keychainLogins?.[id] !== entry) return false;
    const { [id]: _gone, ...rest } = fresh.keychainLogins;
    fresh.keychainLogins = rest;
  });
  return { removed, ...session };
}

async function endSession(removed: StoredProfile): Promise<RemovedSession> {
  const { profile, keys } = accountFor(removed);
  try {
    return { session: (await logoutSession(profile, keys)) ? "ended" : "none" };
  } catch (err) {
    await forgetSession(profile, keys);
    return { session: "not_ended", message: err instanceof Error ? err.message : String(err) };
  }
}

/** Which of a login's children aren't read (unticked on the login page); only children the login lists count. */
export async function setHiddenChildren(id: string, hidden: string[]): Promise<void> {
  const config = await loadConfig();
  const target = config.profiles.find((p) => p.id === id);
  if (!target) throw new WilmaAiError("unknown_account", "That login isn't saved any more.");
  const known = new Set((target.students ?? []).map((s) => s.studentNumber));
  const kept = [...new Set(hidden)].filter((number) => known.has(number));
  if (kept.length) target.hidden = kept;
  else delete target.hidden;
  await saveConfig(config);
}

/**
 * After Wilma accepted a login: save it where `choice` (chooseSecretStore,
 * decided before contacting Wilma) says, and only then keep the verified
 * session, under the saved login's keys, so the next command or tool call
 * needs no second login (or code). A login that couldn't be saved leaves no
 * session behind.
 */
export async function saveVerifiedLogin(
  input: { tenantUrl: string; tenantName?: string | null; username: string; password: string; totpSecret?: string | null; students: StudentInfo[] },
  client: WilmaClient,
  choice: StoreChoice
): Promise<StoredProfile & { note?: string }> {
  const stored = await saveLogin(await loadConfig(), input, choice);
  adoptSession(accountFor(stored).keys, client);
  return stored;
}
