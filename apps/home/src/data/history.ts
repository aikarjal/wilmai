/*
 * The sign-in history (Settings): when this app's Wilma session started,
 * when it continued a session another WilmAI program saved, and when Wilma
 * ended it, with which program did what. Wilma allows one live session per
 * account, so every login anywhere (the phone, a browser, another WilmAI
 * program) ends the others; this is where a parent can see which one it was.
 *
 * Only times and program names, on this device (localStorage), last 30.
 * Signing out clears it with everything else.
 */
import { useSyncExternalStore } from "react";

/** Which WilmAI program saved a session, as the shared session file says ("home", "cli", "mcp"); null when it doesn't say. */
export type Program = string | null;

export type SessionHistoryEntry = (
  /** This app logged in: with the password typed here, the CLI's saved login (before 0.4.0), or by itself (staying signed in). */
  | { at: number; kind: "signed-in"; how: "password" | "saved-login" | "automatic" }
  /** This app continued a live session another program saved (no login, nothing else ended). */
  | { at: number; kind: "continued"; by: Program; savedAt: number | null; midway: boolean }
  /** Wilma ended this app's session. `by`/`savedAt`: a newer login another WilmAI program saved, if any. */
  | { at: number; kind: "ended"; by: Program; savedAt: number | null; lastOk: number | null; other: boolean }
) & {
  /** With more than one Wilma (data/logins.ts), whose: its school's name. */
  wilma?: string;
};

const KEY = "wilmai.sessionHistory";
const MAX = 30;
const listeners = new Set<() => void>();
let entries: SessionHistoryEntry[] = load();

function load(): SessionHistoryEntry[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Distributive Omit, so each kind keeps its own fields. */
type WithoutTime<T> = T extends unknown ? Omit<T, "at"> : never;

export function recordSession(entry: WithoutTime<SessionHistoryEntry>): void {
  entries = [{ ...entry, at: Date.now() } as SessionHistoryEntry, ...load()].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // not remembered, still shown until the app closes
  }
  for (const listener of listeners) listener();
}

export function useSessionHistory(): SessionHistoryEntry[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => entries
  );
}

/** The Wilma session cookie in wilma-client's session state, to tell one session from another. */
export function sessionCookieOf(state: string | null | undefined): string | null {
  if (!state) return null;
  try {
    const jar = JSON.parse(state) as { cookies?: { key?: string; value?: string }[] };
    return jar.cookies?.find((c) => c.key === "Wilma2SID")?.value ?? null;
  } catch {
    return null;
  }
}
