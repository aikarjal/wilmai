import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { accountKey, accountStorageKey, getState, useApp } from "../data/store";
import { cloudOf, intelligenceProvider } from "../data/model";
import { OPENAI_PAUSE_MS } from "../luna/client";
import { checkOpenAIAgain } from "../luna/events";
import { buildFeed, forChildren, needsYou } from "../data/feed";
import { getBack, keepAlive, leaveDemo, syncNow, isDemo } from "../data/engine";
import { logins, schoolOf } from "../data/logins";
import { isDesktopApp } from "../wilma/transport";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { notificationsAvailable, showWindow, startNotifications, trayLabels } from "../data/notify";
import { addDays, today, weekday } from "../data/dates";
import { examResults, isNewResult } from "../data/grades";
import { Brand, Icon, Tab } from "./bits";
import { plural, resolveLanguage, setLanguage, t } from "../i18n";
import { ChildFilter, DetailsHost, go, hrefFor, navFolded, setFamily, setSegment, tSense, useRoute, type Route } from "./shared";
import { Wilmas } from "./Wilmas";
import { screenFor } from "../data/logins";
import { Today } from "./Today";
import { Inbox } from "./Inbox";
import { Week } from "./Week";
import { Calendar } from "./Calendar";
import { Settings, ThemeChoice } from "./Settings";
import { Exams } from "./Exams";
import { Grades } from "./Grades";
import { Notes } from "./Notes";
import { Homework } from "./Homework";
import { CommandMenu } from "./CommandMenu";
import { UpdateDot, VersionLine } from "./Update";
import { Toaster } from "./Toast";
import { Shortcuts } from "./Shortcuts";

export function App() {
  const phase = useApp((s) => s.phase);
  const account = useApp((s) => accountKey(s.snapshot?.account));
  const via = useApp((s) => s.snapshot?.account.via ?? null);
  const route = useRoute();
  // Before anything renders: the app's words and dates in the chosen language (the menu bar's menu too).
  const language = resolveLanguage(useApp((s) => s.settings.language) ?? "auto");
  setLanguage(language);
  useEffect(() => trayLabels(), [language, phase]);
  // Light or dark as chosen (styles.css data-theme); the computer's when automatic.
  const theme = useApp((s) => s.settings.theme ?? "auto");
  useLayoutEffect(() => {
    if (theme === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    if (isDesktopApp) void getCurrentWindow().setTheme(theme === "auto" ? null : theme).catch(() => {});
  }, [theme]);

  // Check Wilma again every ten minutes, and on coming back to the page, signed in or not. In the desktop app it goes
  // on with the window closed (the app stays in the menu bar), so what's new can notify (data/notify.ts); the native
  // side's tick wakes it. Signed out, each check looks for a way back in (engine's getBack).
  useEffect(() => {
    const maybe = (now = false) => {
      const { sync, settings, phase } = getState();
      if (phase === "signed-out") return void getBack();
      if (phase !== "ready") return;
      const inBackground = notificationsAvailable && settings.notify !== false;
      if (document.visibilityState === "visible" || inBackground) {
        if (now || !sync.lastOk || Date.now() - sync.lastOk > 5 * 60_000) void syncNow();
      } else void keepAlive(); // out of sight: one small read, so Wilma doesn't end the session for being idle
    };
    const onTime = () => maybe();
    const t = setInterval(onTime, 10 * 60_000);
    document.addEventListener("visibilitychange", onTime);
    // "Check Wilma now" in the menu bar: signed out, the window opens on the sign-in page.
    const checkNow = () => (getState().phase === "signed-out" ? showWindow() : maybe(true));
    const stop = startNotifications(onTime, checkNow, (key) => (key === "signin" ? undefined : go(key.startsWith("note:") ? "notes" : "inbox", key)));
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onTime);
      stop();
    };
  }, []);
  // OpenAI (or Anthropic) unreachable (luna/client.ts): when the pause is over, one quick check. Still blocked starts a new pause.
  const blockedAt = useApp((s) => s.openaiBlocked?.at ?? null);
  useEffect(() => {
    if (blockedAt === null) return;
    const t = setTimeout(() => {
      if (cloudOf(getState().settings)) void checkOpenAIAgain();
    }, Math.max(0, blockedAt + OPENAI_PAUSE_MS - Date.now()));
    return () => clearTimeout(t);
  }, [blockedAt]);
  // The app once every Wilma is signed in; otherwise the Wilma page (data/logins.ts screenFor).
  switch (screenFor(phase, via, route.view)) {
    case "loading":
      return null;
    case "wilmas":
      return <Wilmas />;
    default:
      return <Shell key={account} />;
  }
}


function useSelected(): [string[], (s: string[]) => void] {
  const filterKey = accountStorageKey("children");
  const [selected, setSelected] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(filterKey) ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  const set = (next: string[]) => {
    setSelected(next);
    localStorage.setItem(filterKey, JSON.stringify(next));
  };
  return [selected, set];
}

/** "Updated 5 min ago": when Wilma was last read. */
function updated(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return t("Updated just now");
  if (s < 3600) return t("Updated {n} min ago", { n: Math.round(s / 60) });
  return t("Updated {n} h ago", { n: Math.round(s / 3600) });
}

function Syncer() {
  const sync = useApp((s) => s.sync);
  const jev = useApp((s) => s.jevStatus);
  const translating = useApp((s) => s.translationStatus);
  const demo = isDemo();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  let text: string;
  if (demo) text = t("Sample family");
  else if (sync.running) text = sync.step ?? t("Checking Wilma");
  else if (sync.error) text = sync.error;
  else if (sync.lastOk) text = updated(sync.lastOk);
  else text = t("Not updated yet");
  return (
    <div className="syncer" aria-live="polite">
      {jev.running ? (
        <span className="chip chip-marker" title={t("This visit: {new} new to the AI, {changed} changed since it read them (details in Settings)", { new: jev.newItems, changed: jev.changedItems })}>
          <Icon name="spark" className="icon" /> {t("Sorting {done}/{total}", { done: jev.done, total: jev.total })}
        </span>
      ) : null}
      {translating.running && translating.total ? (
        <span className="chip" title={t("Translating what came in the last 30 days (Settings → Translating messages)")}>
          <Icon name="translate" className="icon" /> {t("Translating {done}/{total}", { done: translating.done, total: translating.total })}
        </span>
      ) : null}
      <span className={`txt${sync.error ? " err" : ""}`}>{text}</span>
      {!demo ? (
        <button className="btn btn-quiet btn-sm" onClick={() => void syncNow()} disabled={sync.running} title={t("Check Wilma now")}>
          <Icon name="refresh" className={`icon${sync.running ? " spin" : ""}`} />
          <span className="sr-only">{t("Check Wilma now")}</span>
        </button>
      ) : null}
    </div>
  );
}

function Shell() {
  const route = useRoute();
  const snap = useApp((s) => s.snapshot)!;
  const local = useApp((s) => s.local);
  const jev = useApp((s) => s.jev);
  const luna = useApp((s) => s.luna);
  const [selected, setSelected] = useSelected();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  setFamily(snap.children);
  const live = selected.filter((n) => snap.children.some((c) => c.number === n));
  // Every kid picked shows the same as everyone (bulletins for the whole school included); the selector still shows them picked.
  const shownKids = live.length === snap.children.length ? [] : live;
  const lang = useApp((s) => s.settings.language);
  // Help first-time users find the choice; an explicit No AI choice dismisses the cue too.
  const chooseAI = useApp((s) => s.settings.aiProvider === undefined && intelligenceProvider(s.settings) === "off");
  // The feed's own words (tasks, reasons) are in the app's language: rebuild it when that changes.
  const feed = useMemo(() => buildFeed({ snapshot: snap, local, jev, luna }), [snap, local, jev, luna, lang]);
  // The Inbox's badge counts messages; notes that need explaining show on Notes.
  const shownFeed = forChildren(feed, shownKids);
  const needs = needsYou(shownFeed.filter((i) => i.kind !== "note")).length;
  const toExplain = needsYou(shownFeed.filter((i) => i.kind === "note")).length;
  // A quiet dot on Notes: a note dated today not yet seen (Notes marks them seen).
  const newNoteToday = shownFeed.some((i) => i.kind === "note" && i.note?.date === today() && !local.opened[i.key]);
  // A quiet dot on Grades: an exam grade from the last three weeks not yet seen in Wilma or here.
  const newResult = snap.children
    .filter((c) => !shownKids.length || shownKids.includes(c.number))
    .some((c) => examResults(snap.perChild[c.number]).some((e) => isNewResult(c.number, e, local.opened)));
  // A quiet dot on Exams: an exam today or on the next school day for a child shown.
  const examSoon = (() => {
    const now = today();
    let next = addDays(now, 1);
    while (weekday(next) > 4) next = addDays(next, 1);
    return snap.children
      .filter((c) => !shownKids.length || shownKids.includes(c.number))
      .some((c) => (snap.perChild[c.number]?.exams ?? []).some((e) => e.date === now || e.date === next));
  })();
  // Three panels: nav (folds to icons), the view, and the view's details when it has some (Week).
  const [detailsEl, setDetailsEl] = useState<HTMLElement | null>(null);
  const [detailsCount, setDetailsCount] = useState(0);
  const change = useCallback((delta: number) => setDetailsCount((n) => n + delta), []);
  const detailsHost = useMemo(() => ({ host: detailsEl, change }), [detailsEl, change]);
  const detailsOpen = detailsCount > 0;
  const rail = navFolded.use();

  // ⌘K / Ctrl+K: the command menu, from anywhere (also while typing). ⌘\: fold the nav. "?": every shortcut.
  const [menuOpen, setMenuOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setMenuOpen((open) => !open);
      } else if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key === "\\") {
        e.preventDefault();
        navFolded.set(!navFolded.get());
      } else if (e.key === "?" && !(e.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) {
        e.preventDefault();
        setKeysOpen(true);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  // Keyboard: "/" search; G, then T/I/W/S (or D for the Done list), to move between views, with a hint showing the keys.
  const [goHint, setGoHint] = useState(false);
  useEffect(() => {
    let g = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const endGo = () => {
      g = false;
      setGoHint(false);
      if (timer) clearTimeout(timer);
    };
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (g) {
        endGo();
        const key = e.key.toLowerCase();
        if (key === "d") {
          e.preventDefault();
          setSegment("done");
          go("inbox");
          return;
        }
        const view = ({ t: "today", i: "inbox", m: "inbox", w: "week", c: "calendar", e: "exams", r: "grades", n: "notes", h: "homework", s: "settings" } as const)[key as "t" | "i" | "m" | "w" | "c" | "e" | "r" | "n" | "h" | "s"];
        if (view) {
          e.preventDefault();
          go(view);
        }
        return;
      }
      if (e.key === "g") {
        g = true;
        setGoHint(true);
        timer = setTimeout(endGo, 2000);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  // Kids: a click shows only that kid, and again goes back to everyone. ⌘- or Shift-click
  // toggles that kid's highlight, as a toggle should: all kids picked stay picked (the same
  // as everyone), and taking out the last one goes back to everyone, never an empty view.
  // Keys: 0 everyone, 1–9 a kid.
  const family = snap.children.map((c) => c.number);
  const pickKid = (n: string, add: boolean) => {
    if (!add) {
      setSelected(live.length === 1 && live[0] === n ? [] : [n]);
      return;
    }
    setSelected(live.includes(n) ? live.filter((x) => x !== n) : family.filter((x) => x === n || live.includes(x)));
  };
  const pickKidRef = useRef(pickKid);
  pickKidRef.current = pickKid;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.("input, textarea, select, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey || !/^[0-9]$/.test(e.key)) return;
      const children = getState().snapshot?.children ?? [];
      if (children.length < 2) return;
      if (e.key === "0") setSelected([]);
      else if (children[Number(e.key) - 1]) pickKidRef.current(children[Number(e.key) - 1].number, false);
      else return;
      e.preventDefault();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  // The menu in groups: the day-to-day (Today, Inbox, Week), then the school's records (Exams, Notes, Homework),
  // and Settings at the foot, above where the data is.
  type NavItem = { view: Route["view"]; label: string; icon: string; badge?: number; dot?: boolean; group: "daily" | "records" | "settings" };
  const nav: NavItem[] = [
    { view: "today", label: t("Today"), icon: "today", group: "daily" },
    { view: "inbox", label: t("Messages"), icon: "inbox", badge: needs || undefined, group: "daily" },
    { view: "week", label: t("Week"), icon: "week", group: "daily" },
    { view: "calendar", label: t("Calendar"), icon: "calendar", group: "daily" },
    // From the most often looked at to the least: homework daily, notes and exams weekly, grades now and then.
    { view: "homework", label: tSense("Homework", "nav"), icon: "book", group: "records" },
    { view: "notes", label: t("Notes"), icon: "note", badge: toExplain || undefined, dot: newNoteToday, group: "records" },
    { view: "exams", label: t("Exams"), icon: "exam", dot: examSoon, group: "records" },
    { view: "grades", label: t("Grades"), icon: "grades", dot: newResult, group: "records" },
    { view: "settings", label: t("Settings"), icon: "settings", group: "settings" },
  ];
  const navLink = (n: NavItem) => (
    <a key={n.view} className={`nav-${n.group}${n.view === "settings" && chooseAI ? " nav-ai-cue" : ""}`} href={hrefFor(n.view)} aria-current={route.view === n.view ? "page" : undefined} title={rail ? n.view === "settings" && chooseAI ? `${n.label} · ${t("Choose AI")}` : n.label : undefined}>
      <Icon name={n.icon} />
      <span className="nav-label">{n.label}</span>
      {n.view === "settings" && chooseAI ? <span className="nav-ai-label"><Icon name="sparkles" /><span>{t("Choose AI")}</span></span> : null}
      {n.badge ? <span className="badge" title={plural(n.badge, "{n} needs you", "{n} need you")}>{n.badge}</span> : null}
      {n.dot && !n.badge ? <span className="nav-dot" aria-label={n.view === "notes" ? t("A new note today") : n.view === "grades" ? t("A new exam result") : t("An exam today or tomorrow")} /> : null}
    </a>
  );

  return (
    <ChildFilter.Provider value={{ selected: shownKids, set: setSelected }}>
      <DetailsHost.Provider value={detailsHost}>
      <div className={`shell${rail ? " rail" : ""}${detailsOpen ? " with-details" : ""}`}>
        <nav className="nav" aria-label={t("Views")}>
          <Brand />
          {nav.filter((n) => n.group === "daily").map(navLink)}
          <div className="nav-sep" aria-hidden="true" />
          {nav.filter((n) => n.group === "records").map(navLink)}
          {nav.filter((n) => n.group === "settings").map(navLink)}
          {/* Back to the Wilma page (signing in, the schools' Wilmas, the children), a menu item like Settings; the sample family's way out. */}
          <div className="nav-wilmas-wrap">
            {isDemo() ? (
              <button type="button" className="nav-wilmas" onClick={() => { go("today"); void leaveDemo(); }} aria-describedby="nav-wilmas-tip" title={rail ? t("Leave the sample family") : undefined}>
                <Icon name="back" />
                <span className="nav-label">
                  {t("Leave the sample family")}
                  <small>{t("Back to signing in")}</small>
                </span>
              </button>
            ) : (
              <a className="nav-wilmas" href={hrefFor("wilmas")} aria-describedby="nav-wilmas-tip" title={rail ? t("Wilma accounts") : undefined}>
                <Icon name="user" />
                <span className="nav-label">
                  {t("Wilma accounts")}
                  <small>{logins(snap).length > 1 ? plural(logins(snap).length, "{n} Wilma", "{n} Wilmas") : schoolOf(logins(snap)[0].account)}</small>
                </span>
              </a>
            )}
            {/* Drawn here: the desktop app's web view shows no native tooltips. With several Wilmas, which ones. */}
            <span className="nav-tip" id="nav-wilmas-tip" role="tooltip">
              {!isDemo() && logins(snap).length > 1 ? <b className="nav-tip-schools">{logins(snap).map((l) => schoolOf(l.account)).join(" · ")}</b> : null}
              {isDesktopApp ? t("Everything here is stored on this computer only.") : t("Everything here is stored in this app only.")}{" "}
              {t("No WilmAI server stores or passes on anything.")}
            </span>
          </div>
          {/* The foot: the theme and the fold button (only it, folded), then the version. */}
          <div className="nav-meta">
            <div className="nav-meta-row">
              <ThemeChoice compact />
              <button
                className="btn btn-quiet btn-sm nav-fold"
                onClick={() => navFolded.set(!rail)}
                aria-pressed={rail}
                title={rail ? t("Show the full menu (⌘\\)") : t("Fold the menu to icons (⌘\\)")}
                aria-label={rail ? t("Show the full menu") : t("Fold the menu to icons")}
              >
                <Icon name="sidebar" />
              </button>
            </div>
            <VersionLine />
          </div>
        </nav>
        <div className="main">
          <header className="topbar">
            {snap.children.length > 1 ? (
              <div className="kids" role="group" aria-label={t("Show children")}>
                <button className="kid-seg all" aria-pressed={live.length === 0} onClick={() => setSelected([])} title={t("Everyone (0)")}>
                  {t("Everyone")}
                </button>
                {snap.children.map((c, i) => (
                  <button
                    key={c.number}
                    className={`kid-seg c${c.color % 5}`}
                    aria-pressed={live.includes(c.number)}
                    onClick={(e) => pickKid(c.number, e.metaKey || e.ctrlKey || e.shiftKey)}
                    title={
                      live.length === 1 && live[0] === c.number
                        ? t("Back to everyone ({key})", { key: String(i + 1) })
                        : t("Show only {name} ({key}). ⌘-click to add or remove.", { name: c.first, key: String(i + 1) })
                    }
                  >
                    {c.first}
                  </button>
                ))}
              </div>
            ) : null}
            <label className="search">
              <Icon name="search" />
              <input
                ref={searchRef}
                value={query}
                placeholder={t("Search everything")}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (route.view !== "inbox") go("inbox");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setQuery("");
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                aria-label={t("Search")}
              />
              {!query ? <kbd>/</kbd> : null}
            </label>
            <Syncer />
            <UpdateDot />
          </header>
          {route.view === "today" ? <Today feed={feed} /> : null}
          {route.view === "inbox" ? <Inbox feed={feed} query={query} itemKey={route.item} /> : null}
          {route.view === "week" ? <Week feed={forChildren(feed, shownKids)} /> : null}
          {route.view === "calendar" ? <Calendar feed={feed} /> : null}
          {route.view === "exams" ? <Exams itemKey={route.item} feed={feed} /> : null}
          {route.view === "grades" ? <Grades itemKey={route.item} /> : null}
          {route.view === "notes" ? <Notes feed={feed} itemKey={route.item} /> : null}
          {route.view === "homework" ? <Homework /> : null}
          {route.view === "settings" ? <Settings /> : null}
        </div>
        <aside ref={setDetailsEl} className="details details-docked" aria-label={t("Details")} hidden={!detailsOpen} />
      </div>
      </DetailsHost.Provider>
      <CommandMenu open={menuOpen} onClose={() => setMenuOpen(false)} feed={forChildren(feed, shownKids)} family={snap.children} onShortcuts={() => setKeysOpen(true)} />
      {keysOpen ? <Shortcuts onClose={() => setKeysOpen(false)} /> : null}
      {goHint ? <GoHint /> : null}
      <Toaster />
    </ChildFilter.Provider>
  );
}

/** After G: where the next key goes. */
function GoHint() {
  const keys: [string, string][] = [
    ["T", t("Today")],
    ["M", t("Messages")],
    ["W", t("Week")],
    ["C", t("Calendar")],
    ["H", tSense("Homework", "nav")],
    ["N", t("Notes")],
    ["E", t("Exams")],
    ["R", t("Grades")],
    ["S", t("Settings")],
    ["D", t("Done list")],
  ];
  return (
    <div className="go-hint" role="status" aria-live="polite">
      <span className="go-title">{t("Go to")}</span>
      {keys.map(([key, label]) => (
        <span key={key} className="go-key">
          <kbd>{key}</kbd> {label}
        </span>
      ))}
    </div>
  );
}
