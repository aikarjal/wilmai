/*
 * Moving saved logins between the config file and the keychain (section 6
 * and machine 1 in docs/secret-store.md). Every step can be interrupted:
 *
 *   F  --reserve-->  F+  --entry, session copy, flip-->  K
 *
 * F+ (a file login with an entry reserved in `keychainLogins`) is read from
 * the file, so a crash anywhere before the flip leaves a working login, and
 * the next move reuses its entry. A crash after the flip leaves a v1 session
 * entry tagged with the login's id, which any later run deletes.
 */
import { readdir, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { dropPooledSession } from "./agent-data.js";
import { editConfig, getConfigPath, loadConfig, obfuscateSecret, revealSecret, type CliConfig, type StoredProfile } from "./config.js";
import {
  deleteLoginSecrets,
  keychainProblem,
  newCredentialsStamp,
  newSecretId,
  readBackLoginSecrets,
  SecretStoreError,
  secretErrorMessage,
  writeLoginSecrets,
  type LoginSecrets,
} from "./secret-store.js";
import { fileLoginKeys, keychainLoginKeys, sessionKeyV1, sessionKeyV2 } from "./session-keys.js";
import { copySession, fileSessionStore, removeTaggedSessions } from "./session-store.js";

/** Background moves wait this long after a failure. */
const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

export interface MoveResult {
  id: string;
  wilma: string;
  username: string;
  to: "keychain" | "file";
  /** moved; already there; skipped (changed meanwhile, tried again later); failed (stays where it was). */
  outcome: "moved" | "already" | "skipped" | "failed";
  message?: string;
}

const describe = (p: StoredProfile) => ({ id: p.id, wilma: p.tenantName ?? p.tenantUrl, username: p.username });
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Move one file login to the keychain: reserve, write and check the entry, copy the session, flip, clean up. */
export async function moveLoginToKeychain(id: string): Promise<MoveResult> {
  // 1. Reserve the entry in the config before it exists (F -> F+).
  let snapshot: StoredProfile | undefined;
  let secretId = "";
  await editConfig((config) => {
    snapshot = config.profiles.find((p) => p.id === id);
    if (!snapshot || snapshot.secrets) return false;
    secretId = config.keychainLogins?.[id] ?? newSecretId();
    if (config.keychainLogins?.[id] === secretId) return false;
    config.keychainLogins = { ...config.keychainLogins, [id]: secretId };
  });
  if (!snapshot) return { id, wilma: id, username: "", to: "keychain", outcome: "failed", message: "That login isn't saved any more." };
  const base = { ...describe(snapshot), to: "keychain" as const };
  if (snapshot.secrets === "keychain") return { ...base, outcome: "already" };
  if (snapshot.secrets) return { ...base, outcome: "failed", message: secretErrorMessage("unavailable", base.wilma) };

  const password = revealSecret(snapshot.passwordObfuscated);
  if (!password) return { ...base, outcome: "failed", message: `The saved password for ${base.wilma} can't be read. Log in again (\`wilma login\`).` };
  const totpSecret = revealSecret(snapshot.totpSecretObfuscated);
  const secrets: LoginSecrets = { password, totpSecret };

  try {
    // 2. Write the entry and read it back.
    await writeLoginSecrets(secretId, secrets);
    const back = await readBackLoginSecrets(secretId);
    if (back?.password !== password || (back?.totpSecret ?? null) !== (totpSecret ?? null)) {
      throw new SecretStoreError("refused", "The keychain didn't keep the password as saved.");
    }
  } catch (err) {
    await markMoveFailed(id);
    return { ...base, outcome: "failed", message: errorText(err) };
  }

  // 3. The session goes with it (no new Wilma login, no new code), both entries tagged.
  const v1 = sessionKeyV1(snapshot.tenantUrl, snapshot.username, password);
  const v2 = sessionKeyV2(snapshot.tenantUrl, snapshot.username);
  await copySession(v1, v2, id).catch(() => false);

  // 4. Flip, unless the login changed meanwhile (then the next run tries again).
  let flipped = false;
  await editConfig((config) => {
    const profile = config.profiles.find((p) => p.id === id);
    if (
      !profile ||
      profile.secrets ||
      profile.passwordObfuscated !== snapshot!.passwordObfuscated ||
      (profile.totpSecretObfuscated ?? null) !== (snapshot!.totpSecretObfuscated ?? null)
    ) {
      return false;
    }
    profile.secrets = "keychain";
    profile.secretId = secretId;
    profile.hasTotp = Boolean(totpSecret);
    // A new stamp: a running MCP server mustn't reuse a client made for this login's earlier place.
    profile.credentialsStamp = newCredentialsStamp();
    delete profile.passwordObfuscated;
    delete profile.totpSecretObfuscated;
    delete profile.moveFailedAt;
    config.keychainLogins = { ...config.keychainLogins, [id]: secretId };
    flipped = true;
  });
  if (!flipped) return { ...base, outcome: "skipped", message: "The login changed while it was being moved; it's tried again next time." };

  // 5. The old session entry (keyed by the password) goes; so does this process's client for it.
  await fileSessionStore.remove(v1).catch(() => {});
  dropPooledSession(fileLoginKeys(snapshot.tenantUrl, snapshot.username, password));
  return { ...base, outcome: "moved" };
}

/** Move a keychain login (or finish an F+ one) to the file, then delete its entry. */
export async function moveLoginToFile(id: string): Promise<MoveResult> {
  const config = await loadConfig();
  const profile = config.profiles.find((p) => p.id === id);
  if (!profile) return { id, wilma: id, username: "", to: "file", outcome: "failed", message: "That login isn't saved any more." };
  const base = { ...describe(profile), to: "file" as const };
  const entry = profile.secretId ?? config.keychainLogins?.[id];

  if (profile.secrets === "keychain" && profile.secretId) {
    let secrets: LoginSecrets | null;
    try {
      secrets = await readBackLoginSecrets(profile.secretId);
    } catch (err) {
      return { ...base, outcome: "failed", message: errorText(err) };
    }
    if (!secrets) return { ...base, outcome: "failed", message: secretErrorMessage("missing", base.wilma) };
    const stamp = profile.credentialsStamp;
    let flipped = false;
    await editConfig((fresh) => {
      const p = fresh.profiles.find((q) => q.id === id);
      if (!p || p.secrets !== "keychain" || p.secretId !== profile.secretId || p.credentialsStamp !== stamp) return false;
      p.passwordObfuscated = obfuscateSecret(secrets!.password);
      p.totpSecretObfuscated = secrets!.totpSecret ? obfuscateSecret(secrets!.totpSecret) : null;
      p.hasTotp = Boolean(secrets!.totpSecret);
      p.credentialsStamp = newCredentialsStamp();
      delete p.secrets;
      delete p.secretId;
      flipped = true;
    });
    if (!flipped) return { ...base, outcome: "skipped", message: "The login changed while it was being moved; try again." };
    const v2 = sessionKeyV2(profile.tenantUrl, profile.username);
    const v1 = sessionKeyV1(profile.tenantUrl, profile.username, secrets.password);
    if (await copySession(v2, v1, id).catch(() => false)) await fileSessionStore.remove(v2).catch(() => {});
    dropPooledSession(keychainLoginKeys(profile.tenantUrl, profile.username, stamp));
  } else if (profile.secrets) {
    return { ...base, outcome: "failed", message: secretErrorMessage("unavailable", base.wilma) };
  } else if (!entry) {
    return { ...base, outcome: "already" };
  }

  // The entry last: a crash before this leaves an F+ login, which this finishes when run again.
  if (entry) {
    try {
      await deleteLoginSecrets(entry);
    } catch (err) {
      return { ...base, outcome: "moved", message: `Moved, but its keychain entry couldn't be deleted (${errorText(err)}).` };
    }
    await editConfig((fresh) => {
      if (!fresh.keychainLogins?.[id]) return false;
      const { [id]: _gone, ...rest } = fresh.keychainLogins;
      fresh.keychainLogins = rest;
    });
  }
  return { ...base, outcome: "moved" };
}

async function markMoveFailed(id: string): Promise<void> {
  await editConfig((config) => {
    const profile = config.profiles.find((p) => p.id === id);
    if (!profile) return false;
    profile.moveFailedAt = new Date().toISOString();
  }).catch(() => {});
}

/** Logins a move to the keychain should take: file logins, and F+ ones an old version rewrote. */
const inFile = (p: StoredProfile) => !p.secrets;

/** Delete the session entries a move interrupted after its flip left behind (tagged, under the old key). */
async function cleanLeftoverSessions(config: CliConfig): Promise<void> {
  for (const profile of config.profiles) {
    if (profile.secrets !== "keychain") continue;
    await removeTaggedSessions(profile.id, sessionKeyV2(profile.tenantUrl, profile.username)).catch(() => 0);
  }
}

/**
 * After a command, when the saved setting is `auto` or `keychain` (never the
 * environment variable alone): move the file logins to the keychain, at most
 * once a day for one that failed. `auto` stays quiet; `keychain` prints one
 * line per failure. Never fails the command it follows.
 */
export async function runBackgroundMoves(warn: (line: string) => void = (line) => console.error(line)): Promise<void> {
  try {
    const config = await loadConfig();
    await cleanLeftoverSessions(config);
    const setting = config.secretStore;
    if (setting !== "auto" && setting !== "keychain") return;
    const now = Date.now();
    const due = config.profiles.filter((p) => inFile(p) && !(p.moveFailedAt && now - Date.parse(p.moveFailedAt) < RETRY_AFTER_MS));
    if (!due.length) return;
    const problem = await keychainProblem();
    if (problem) {
      for (const profile of due) await markMoveFailed(profile.id);
      if (setting === "keychain") warn(`WilmAI couldn't move saved passwords to the keychain: ${problem}. They stay in WilmAI's file for now.`);
      return;
    }
    let moved = false;
    for (const profile of due) {
      const result = await moveLoginToKeychain(profile.id);
      if (result.outcome === "moved") moved = true;
      if (result.outcome === "failed" && setting === "keychain") warn(`WilmAI couldn't move the password for ${result.wilma} to the keychain: ${result.message}`);
    }
    if (moved) await removeStrayTempFiles();
  } catch {
    // A background move never fails the command it follows.
  }
}

/**
 * Remove temp files a crashed save left next to the config (they can hold the
 * scrambled password). Only ones older than a minute: a save in progress in
 * another process may still be using its own.
 */
export async function removeStrayTempFiles(): Promise<number> {
  const dir = dirname(getConfigPath());
  const prefixes = [`${basename(getConfigPath())}.`, "wilmai-sessions.json."];
  let removed = 0;
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (!name.endsWith(".tmp") || !prefixes.some((prefix) => name.startsWith(prefix))) continue;
    const path = join(dir, name);
    try {
      if (Date.now() - (await stat(path)).mtimeMs < 60_000) continue;
      await rm(path, { force: true });
      removed += 1;
    } catch {
      // gone already
    }
  }
  return removed;
}

/** Every login's place, for `wilma config secrets`. */
export function whereSecretsAre(config: CliConfig): { id: string; wilma: string; username: string; store: "file" | "keychain" | "other"; hasTotp: boolean; keychainEntry?: boolean }[] {
  return config.profiles.map((p) => ({
    ...describe(p),
    store: p.secrets === "keychain" ? "keychain" : p.secrets ? "other" : "file",
    hasTotp: p.secrets ? Boolean(p.hasTotp) : Boolean(p.totpSecretObfuscated),
    ...(!p.secrets && config.keychainLogins?.[p.id] ? { keychainEntry: true } : {}),
  }));
}

/**
 * The keychain entries a config file names: `keychainLogins` values and
 * `secretId`s. Read from the text itself, so a damaged file (`wilma config
 * clear` is the way out of one) still gives the entries it names.
 */
export function entriesNamedIn(text: string): string[] {
  const entries = new Set<string>();
  try {
    const config = JSON.parse(text) as Partial<CliConfig>;
    for (const value of Object.values(config.keychainLogins ?? {})) if (typeof value === "string") entries.add(value);
    for (const p of Array.isArray(config.profiles) ? config.profiles : []) if (typeof p?.secretId === "string") entries.add(p.secretId);
  } catch {
    // Damaged: fall back to the entry ids written in it (32 hex characters as a value).
  }
  const block = /"keychainLogins"\s*:\s*\{([^}]*)/.exec(text)?.[1] ?? "";
  for (const m of block.matchAll(/:\s*"([0-9a-f]{32})"/g)) entries.add(m[1]);
  for (const m of text.matchAll(/"secretId"\s*:\s*"([0-9a-f]{32})"/g)) entries.add(m[1]);
  return [...entries].filter((e) => /^[0-9a-f]{32}$/.test(e));
}

/** Delete the keychain entries the config file names (for `wilma config clear`); the ones that couldn't be deleted. */
export async function deleteKnownEntries(configText: string | null): Promise<string[]> {
  if (!configText) return [];
  const entries = entriesNamedIn(configText);
  const failed: string[] = [];
  for (const entry of entries) {
    try {
      await deleteLoginSecrets(entry);
    } catch {
      failed.push(entry);
    }
  }
  return failed;
}
