import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { getConfigPath } from "./config.js";

/*
 * Wilma sessions saved between commands. Wilma allows one live session per
 * account and every login cancels the previous one — which also logs the
 * parent out of Wilma in their own browser, and with two-step verification
 * needs a fresh code. So commands (and the local MCP server) continue the last
 * session instead of logging in each time, and log in again only when Wilma
 * has ended it.
 *
 * A saved session gives the same access as the saved password, so it lives
 * next to it with the same protection: a file only this user can read. Set
 * WILMAI_NO_SESSION_CACHE=1 to log in on every command instead.
 */

/** A session older than this is not tried (Wilma ends idle sessions anyway). */
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;

export interface SessionStore {
  load(key: string): Promise<string | null>;
  save(key: string, state: string): Promise<void>;
  /** Forget one session (after logging out). */
  remove(key: string): Promise<void>;
  /** The newest session saved under any of these keys (one login's labels). */
  loadNewest?(keys: string[]): Promise<string | null>;
  /** Save one session under all of these keys, in one write. */
  saveAll?(keys: string[], state: string): Promise<void>;
  /** Forget a session under all of these keys, in one write. */
  removeAll?(keys: string[]): Promise<void>;
}

/**
 * `by`: which WilmAI program saved it ("cli", "mcp", "home"), so a parent can
 * see who started a session. `login`: the saved login's id, set while moving a
 * login between the file and the keychain, so a leftover entry under the old
 * key can be found again without the password.
 */
type Saved = Record<string, { state: string; savedAt: number; by?: string; login?: string }>;

let savedBy = "cli";

/** Name this program in the sessions it saves (the MCP server says "mcp"). */
export function nameSessionOwner(name: string): void {
  savedBy = name;
}

function sessionsPath(): string {
  return resolve(dirname(getConfigPath()), "wilmai-sessions.json");
}

async function readAll(): Promise<Saved> {
  try {
    const data = JSON.parse(await readFile(sessionsPath(), "utf8")) as Saved;
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

export const fileSessionStore: SessionStore = {
  async load(key) {
    if (process.env.WILMAI_NO_SESSION_CACHE === "1") return null;
    const entry = (await readAll())[key];
    if (!entry || typeof entry.state !== "string" || Date.now() - entry.savedAt > SESSION_TTL_MS) return null;
    return entry.state;
  },

  async save(key, state) {
    if (process.env.WILMAI_NO_SESSION_CACHE === "1") return;
    const all = await readAll();
    const now = Date.now();
    for (const [k, entry] of Object.entries(all)) {
      if (now - entry.savedAt > SESSION_TTL_MS) delete all[k];
    }
    all[key] = { state, savedAt: now, by: savedBy };
    await writeAll(all);
  },

  async remove(key) {
    const all = await readAll();
    if (!(key in all)) return;
    delete all[key];
    await writeAll(all);
  },

  async loadNewest(keys) {
    if (process.env.WILMAI_NO_SESSION_CACHE === "1") return null;
    const all = await readAll();
    let newest: { state: string; savedAt: number } | null = null;
    for (const key of keys) {
      const entry = all[key];
      if (!entry || typeof entry.state !== "string" || Date.now() - entry.savedAt > SESSION_TTL_MS) continue;
      if (!newest || entry.savedAt > newest.savedAt) newest = entry;
    }
    return newest?.state ?? null;
  },

  async saveAll(keys, state) {
    if (process.env.WILMAI_NO_SESSION_CACHE === "1") return;
    const all = await readAll();
    const now = Date.now();
    for (const [k, entry] of Object.entries(all)) {
      if (now - entry.savedAt > SESSION_TTL_MS) delete all[k];
    }
    for (const key of keys) all[key] = { state, savedAt: now, by: savedBy };
    await writeAll(all);
  },

  async removeAll(keys) {
    const all = await readAll();
    const present = keys.filter((key) => key in all);
    if (!present.length) return;
    for (const key of present) delete all[key];
    await writeAll(all);
  },
};

async function writeAll(all: Saved): Promise<void> {
  const path = sessionsPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // Temp file + rename: a parallel command never reads half a file.
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(all), { encoding: "utf-8", mode: 0o600 });
  await rename(tmp, path);
}

/**
 * Make sure a login's newest session is under `to` too (moving a login
 * between the file and the keychain), keeping when and by whom it was saved,
 * and tag both entries with the login's id. With the labels overlapping, `to`
 * usually has it already; an older program may have saved a newer one under
 * `from` only. Nothing to copy (none, or expired): false.
 */
export async function copySession(from: string, to: string, login: string): Promise<boolean> {
  if (process.env.WILMAI_NO_SESSION_CACHE === "1") return false;
  const all = await readAll();
  const valid = (entry: Saved[string] | undefined) => entry && typeof entry.state === "string" && Date.now() - entry.savedAt <= SESSION_TTL_MS;
  const source = all[from];
  const target = all[to];
  if (!valid(source)) return false;
  const newest = valid(target) && target!.savedAt >= source!.savedAt ? target! : source!;
  all[from] = { ...source!, login };
  all[to] = { ...newest, login };
  await writeAll(all);
  return true;
}

/** Delete the entries tagged with a login's id except `keep` (what a move interrupted before its last step left). */
export async function removeTaggedSessions(login: string, keep: string): Promise<number> {
  const all = await readAll();
  const gone = Object.keys(all).filter((key) => key !== keep && all[key]?.login === login);
  if (!gone.length) return 0;
  for (const key of gone) delete all[key];
  await writeAll(all);
  return gone.length;
}

/** When one login's session was saved, and by which program (null when there's none to try). */
export async function sessionInfo(key: string): Promise<{ savedAt: number; by: string | null } | null> {
  if (process.env.WILMAI_NO_SESSION_CACHE === "1") return null;
  const entry = (await readAll())[key];
  if (!entry || typeof entry.state !== "string" || Date.now() - entry.savedAt > SESSION_TTL_MS) return null;
  return { savedAt: entry.savedAt, by: typeof entry.by === "string" ? entry.by : null };
}

/** Forget every saved session (after clearing the config). */
export async function clearSessions(): Promise<void> {
  await rm(sessionsPath(), { force: true });
}
