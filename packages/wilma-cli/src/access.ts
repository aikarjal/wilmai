import { WilmaAccess, WilmaAiError, forgetSession, logoutSession } from "./agent-data.js";
import { loadConfig, revealSecret, saveConfig, savedStudent, type StoredProfile } from "./config.js";
import { mfaCallbackFor, type ActiveAccount } from "./credentials.js";

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
      // A --totp-secret given on the command line belongs to the first (active) login.
      mfa: mfaCallbackFor(index === 0 && opts.totpSecret ? opts.totpSecret : account.totpSecret),
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
  const results = await Promise.allSettled(accounts.map((account) => logoutSession(account.profile)));
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

export type RemovedSession = { session: "ended" | "none" } | { session: "not_ended"; message: string };

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
  await saveConfig(config);
  return { removed, ...(await endSession(removed)) };
}

async function endSession(removed: StoredProfile): Promise<RemovedSession> {
  const password = revealSecret(removed.passwordObfuscated);
  if (!password) return { session: "none" };
  const profile = { baseUrl: removed.tenantUrl, username: removed.username, password };
  try {
    return { session: (await logoutSession(profile)) ? "ended" : "none" };
  } catch (err) {
    await forgetSession(profile);
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
