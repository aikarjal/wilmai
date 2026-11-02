/*
 * Keeping a calendar outside the app (Google Calendar next) the same as the
 * family calendar here: what should be there, as entries any calendar service
 * can take, and what to change in it to get there. Nothing here talks to a
 * calendar service; that comes with Google (docs/google-calendar-sync.md).
 */
import type { AppState } from "./store";
import type { Child } from "./model";
import { buildFeed } from "./feed";
import { calendarEvents, calendarTitle, goesToCalendar, type CalEvent } from "./calendar";
import { addDays } from "./dates";
import { hash } from "./hash";
import { t } from "../i18n";

/** How far ahead the calendar is kept: about a school term. Before the window, nothing is changed (the past stays). */
export const SYNC_DAYS = 180;

export const syncWindow = (from: string) => ({ from, until: addDays(from, SYNC_DAYS) });

/** An event as a calendar service takes it. */
export interface SyncEntry {
  /** The event's key (calendar.ts): the service's own id for it comes from this. */
  key: string;
  title: string;
  /** The event's short detail and where it's from; never the school's whole message. */
  description: string;
  date: string;
  /** The last day of a range (included), else null. */
  endDate: string | null;
  /** "17:30" in Finnish time, or null for a whole day. */
  start: string | null;
  end: string | null;
  /** Of all the above: the entry changed when this did. */
  hash: string;
}

/** An entry as the calendar service has it, written there by this app. */
export interface StoredEntry {
  key: string;
  /** The hash it was written with (an edit made in the calendar doesn't change it). */
  hash: string;
  date: string;
  /** Deleted there by the person (this app's own deletions are gone). */
  cancelled?: boolean;
}

export interface SyncPlan {
  add: SyncEntry[];
  change: SyncEntry[];
  /** Keys to delete there: no longer wanted. */
  remove: string[];
  /** Keys the person deleted there: dismissed here too, so they don't come back. */
  dismissed: string[];
}

export function syncEntry(e: CalEvent, family: Child[]): SyncEntry {
  const fields = {
    key: e.key,
    title: calendarTitle(e, family),
    description: [e.detail, t("From Wilma, via WilmAI Home")].filter(Boolean).join("\n\n"),
    date: e.date,
    endDate: e.endDate,
    start: e.start,
    end: e.end,
  };
  return { ...fields, hash: hash(fields) };
}

/** What the calendar should have in the window: the events that go to the family calendar, for every child. */
export function wantedEntries(state: Pick<AppState, "snapshot" | "local" | "jev" | "luna">, window: { from: string; until: string }): SyncEntry[] {
  const snap = state.snapshot;
  if (!snap) return [];
  const local = state.local.calendar;
  return calendarEvents(snap, buildFeed(state), local, { ...window, children: [], leftOut: state.local.leftOut }, state.luna)
    .filter((e) => goesToCalendar(e, local))
    .map((e) => syncEntry(e, snap.children));
}

/**
 * What to change in the calendar to make it what's wanted:
 * - add what isn't there, and change what the school changed (not what the person edited there);
 * - remove what's no longer wanted, only from the window's start on (the past stays as it was), and only when the last
 *   read of Wilma was `complete`, so missing data never looks like a cancelled event;
 * - an entry the person deleted there is dismissed here, not put back.
 */
export function reconcile(wanted: SyncEntry[], stored: StoredEntry[], window: { from: string; until: string; complete: boolean }): SyncPlan {
  const there = new Map(stored.map((s) => [s.key, s]));
  const keep = new Set(wanted.map((w) => w.key));
  const plan: SyncPlan = { add: [], change: [], remove: [], dismissed: [] };
  for (const w of wanted) {
    const s = there.get(w.key);
    if (!s) plan.add.push(w);
    else if (s.cancelled) plan.dismissed.push(w.key);
    else if (s.hash !== w.hash) plan.change.push(w);
  }
  if (window.complete) {
    for (const s of stored) if (!s.cancelled && !keep.has(s.key) && s.date >= window.from && s.date <= window.until) plan.remove.push(s.key);
  }
  return plan;
}
