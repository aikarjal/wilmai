import { WilmaAccess } from "./agent-data.js";
import { loadConfig, saveConfig } from "./config.js";
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
      onStudents: async (students) => {
        const stored = account.stored;
        // An empty answer from Wilma keeps the saved list (see knownStudents).
        if (!stored || !students.length) return;
        const fresh = students.map((s) => ({ studentNumber: s.studentNumber, name: s.name }));
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
