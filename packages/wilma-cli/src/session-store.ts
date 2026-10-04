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
}

type Saved = Record<string, { state: string; savedAt: number }>;

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
    all[key] = { state, savedAt: now };
    const path = sessionsPath();
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    // Temp file + rename: a parallel command never reads half a file.
    const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, JSON.stringify(all), { encoding: "utf-8", mode: 0o600 });
    await rename(tmp, path);
  },
};

/** Forget every saved session (after removing logins or clearing the config). */
export async function clearSessions(): Promise<void> {
  await rm(sessionsPath(), { force: true });
}
