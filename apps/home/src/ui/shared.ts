/*
 * Shared non-component helpers for the UI (kept out of the component modules
 * so React Fast Refresh can hot-swap those).
 */
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react";
import type { Child } from "../data/model";
import type { FeedItem } from "../data/feed";
import { dayNameLong, daysBetween, relativeDay, shortDate, today, weekday } from "../data/dates";
import { language, t } from "../i18n";

/* ---------- Routing (hash, so it works from a file or an extension page) ---------- */

export type Route = { view: "today" | "inbox" | "week" | "calendar" | "exams" | "grades" | "notes" | "homework" | "settings" | "wilmas"; item: string | null };

function parse(): Route {
  const [view, ...rest] = location.hash.replace(/^#\/?/, "").split("/");
  const item = rest.length ? decodeURIComponent(rest.join("/")) : null;
  if (view === "inbox" || view === "week" || view === "calendar" || view === "exams" || view === "grades" || view === "notes" || view === "homework" || view === "settings" || view === "wilmas") return { view, item };
  return { view: "today", item: null };
}

// Views follow the route at once when the app moves (not a moment later on "hashchange"), so moving to the
// next message and marking the last one done show up together, without a flash in between.
const routeListeners = new Set<() => void>();

export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute((old) => {
      const now = parse();
      return old.view === now.view && old.item === now.item ? old : now;
    });
    addEventListener("hashchange", on);
    routeListeners.add(on);
    return () => {
      removeEventListener("hashchange", on);
      routeListeners.delete(on);
    };
  }, []);
  return route;
}

export const hrefFor = (view: Route["view"], item?: string | null) => `#/${view}${item ? `/${encodeURIComponent(item)}` : ""}`;
export const go = (view: Route["view"], item?: string | null) => {
  location.hash = hrefFor(view, item);
  for (const on of routeListeners) on();
};

/* ---------- Layout: nav, content, details ---------- */

/** The details panel sits beside the content from this width; narrower, details open as a sheet over the page. */
export const DOCK_QUERY = "(min-width: 1200px)";

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    useCallback((cb: () => void) => {
      const list = matchMedia(query);
      list.addEventListener("change", cb);
      // Some embedded views resize without telling the query; a resize re-reads it (no render unless it changed).
      addEventListener("resize", cb);
      return () => {
        list.removeEventListener("change", cb);
        removeEventListener("resize", cb);
      };
    }, [query]),
    () => matchMedia(query).matches
  );
}

/** Where a view's details go (the shell's right-hand panel), and how many views are showing some. */
export const DetailsHost = createContext<{ host: HTMLElement | null; change: (delta: number) => void }>({ host: null, change: () => {} });

/** A remembered on/off choice in localStorage ("1"/"0"), shared by every component that reads it. */
function storedFlag(key: string, fallback: boolean) {
  const listeners = new Set<() => void>();
  let value = (() => {
    try {
      const saved = localStorage.getItem(key);
      return saved === null ? fallback : saved === "1";
    } catch {
      return fallback;
    }
  })();
  const set = (next: boolean) => {
    value = next;
    try {
      localStorage.setItem(key, next ? "1" : "0");
    } catch {
      // only for this visit
    }
    for (const l of listeners) l();
  };
  const use = () =>
    useSyncExternalStore(
      (cb) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      () => value
    );
  return { use, set, get: () => value };
}

/** The nav folded to an icon rail (button or ⌘\). */
export const navFolded = storedFlag("wilmai.navFolded", false);
/** "How the AI read this" opened under messages (closed until the parent opens it; then it stays open). */
export const jevReadingOpen = storedFlag("wilmai.jevReadingOpen", false);
/** Notes' heat map (by subject) opened above the list. */
export const notesBySubject = storedFlag("wilmai.notesBySubject", false);
/** Grades for the academic subjects only (lukuaineet) instead of all subjects. */
export const gradesAcademicOnly = storedFlag("wilmai.gradesAcademic", false);
/** Homework shown by subject instead of by day. */
export const homeworkBySubject = storedFlag("wilmai.homeworkBySubject", false);

/* ---------- Which inbox list is showing (also chosen from the command menu) ---------- */

/** The Inbox is messages and bulletins; teacher notes have their own view (Notes). */
export type Segment = "all" | "needs" | "message" | "news" | "done";
const SEGMENTS: Segment[] = ["all", "needs", "message", "news", "done"];
const segmentListeners = new Set<() => void>();

function savedSegment(): Segment {
  try {
    const s = localStorage.getItem("wilmai.segment") as Segment;
    return SEGMENTS.includes(s) ? s : "all";
  } catch {
    return "all";
  }
}

let segment: Segment = savedSegment();

export function setSegment(next: Segment): void {
  segment = next;
  try {
    localStorage.setItem("wilmai.segment", next);
  } catch {
    // just not remembered
  }
  for (const on of segmentListeners) on();
}

export function useSegment(): Segment {
  const [value, setValue] = useState(segment);
  useEffect(() => {
    const on = () => setValue(segment);
    segmentListeners.add(on);
    return () => void segmentListeners.delete(on);
  }, []);
  return value;
}

/* ---------- Which children are showing (shared across views) ---------- */

export const ChildFilter = createContext<{ selected: string[]; set: (s: string[]) => void }>({ selected: [], set: () => {} });
export const useChildFilter = () => useContext(ChildFilter);

/** Short labels for tabs: one letter, or two when siblings share an initial (Kiia "Ki", Kalle "Ka"). */
let shortLabels = new Map<string, string>();
export function setFamily(children: Child[]) {
  const labels = new Map<string, string>();
  const shown = (c: Child) => c.nick ?? c.first;
  for (const c of children) {
    const clash = children.some((o) => o !== c && shown(o)[0]?.toUpperCase() === shown(c)[0]?.toUpperCase());
    labels.set(c.number, clash ? shown(c).slice(0, 2) : shown(c).slice(0, 1));
  }
  shortLabels = labels;
}

export function shortLabel(child: Child): string {
  return shortLabels.get(child.number) ?? child.first.slice(0, 1);
}

/**
 * An English word the app uses in more than one sense, where Finnish differs
 * ("Done": the button "Hoidettu", the list "Hoidetut"): Finnish comes from the
 * key "word (sense)"; English shows the word.
 */
export function tSense(en: string, sense: string): string {
  if (language() === "en") return en;
  const key = `${en} (${sense})`;
  const fi = t(key);
  return fi === key ? t(en) : fi;
}

/** "Tomorrow", "By Friday", "By Mon 19 Oct": from the deadline Jev picked, else the changed school day ("Friday"), else the first date ahead. */
export function urgencyLabel(item: FeedItem): string | null {
  if (!item.triage) return null;
  const now = today();
  const deadline = item.deadline && item.deadline >= now ? item.deadline : null;
  const change = item.change && item.change.date >= now ? item.change.date : null;
  const when = deadline ?? change ?? item.eventDate ?? item.upcoming[0];
  if (!when || when < now) return null;
  const days = daysBetween(now, when);
  if (days <= 1 || (when === change && days <= 6)) return relativeDay(when, now);
  if (days <= 6 || (deadline && days <= 21)) return byDay(when, now);
  return null;
}

/* Finnish "by Friday" is the weekday in the illative + "mennessä". */
const FI_BY_WEEKDAY = ["Maanantaihin", "Tiistaihin", "Keskiviikkoon", "Torstaihin", "Perjantaihin", "Lauantaihin", "Sunnuntaihin"];

/** "By Friday" / "Perjantaihin mennessä" within the week, else "By Mon 19 Oct" / "ma 19.10. mennessä". */
export function byDay(iso: string, now = today()): string {
  const days = daysBetween(now, iso);
  const thisWeek = days > 1 && days < 7;
  if (language() === "fi") return thisWeek ? `${FI_BY_WEEKDAY[weekday(iso)]} mennessä` : `${shortDate(iso)} mennessä`;
  if (language() === "sv") return `Senast ${thisWeek ? dayNameLong(iso).toLowerCase() : shortDate(iso)}`;
  return `By ${thisWeek ? dayNameLong(iso) : shortDate(iso)}`;
}

/** Where an item opens: a teacher note in Notes, anything else in the Inbox. */
export const itemHref = (item: Pick<FeedItem, "key" | "kind">): string => (item.kind === "note" ? hrefFor("notes", item.key) : hrefFor("inbox", item.key));
export const openItem = (item: Pick<FeedItem, "key" | "kind">): void => go(item.kind === "note" ? "notes" : "inbox", item.key);

/** An exam's place in the Exams view (`#/exams/<key>`). */
export const examKey = (child: string, exam: { examId: number; date: string }): string => `${child}-${exam.examId}-${exam.date}`;
