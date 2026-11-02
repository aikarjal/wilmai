/*
 * The family calendar (Kalenteri), for the children shown: what's coming that
 * a family puts in its calendar (see data/calendar.ts). Exams, changed school
 * days and the times signed up for come from Wilma's own data; trips,
 * events, holidays and deadlines from messages, bulletins and teachers'
 * lesson notes, as Jev read them. A month at a time, the month's arrows on
 * the calendar itself. Beside it, as in the Week: what's coming and Jev's
 * less sure finds (suggestions, to take or dismiss); a day shows what's on
 * it there, and an event shows where it comes from: an exam's or a note's
 * lesson in the child's day, a message or bulletin with the line the date
 * is on. What goes to the family calendar is set by kind.
 */
import { useEffect, useMemo, useState } from "react";
import { loadWeek } from "../data/engine";
import { getState, setCalendarDecision, setCalendarKind, useApp } from "../data/store";
import { forChildren, type FeedItem } from "../data/feed";
import { CAL_KIND_ORDER, DEFAULT_KINDS, allDay, calendarDecision, calendarEvents, calendarPanelSource, calendarTitle, goesToCalendar, type CalEvent, type CalKind, type CalSource } from "../data/calendar";
import { addDays, dayName, dayWithDate, daysBetween, isoWeek, mondayOf, shortDate, today, weekday } from "../data/dates";
import { knownLessons, lessonKey } from "../data/schedule";
import type { Snapshot } from "../data/model";
import { DetailsPanel } from "./Details";
import { DayPanel } from "./DayPanel";
import { Section } from "./Glance";
import { Reader } from "./Reader";
import { Icon, Tab, Tabs } from "./bits";
import { DOCK_QUERY, tSense, useChildFilter, useMedia } from "./shared";
import { showToast } from "./Toast";
import { locale, t } from "../i18n";
import { useWilma } from "../data/phrases";

const KIND: Record<CalKind, { one: string; many: string }> = {
  exam: { one: "Exam", many: "Exams" },
  event: { one: "Event", many: "Events" },
  trip: { one: "Trip", many: "Trips" },
  holiday: { one: "Holiday", many: "Holidays" },
  schedule: { one: "Changed school day", many: "Changed school days" },
  deadline: { one: "Deadline", many: "Deadlines" },
};
const kindOne = (k: CalKind) => tSense(KIND[k].one, "calendar");
const kindMany = (k: CalKind) => tSense(KIND[k].many, "calendar");

/** "October 2026" / "Lokakuu 2026". */
const monthTitle = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  const text = new Intl.DateTimeFormat(locale(), { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 15)));
  return text[0].toUpperCase() + text.slice(1);
};
const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const lastOfMonth = (month: string) => addDays(`${shiftMonth(month, 1)}-01`, -1);

/** An event's source shown beside the calendar; in a child's day, the lesson the parent picked there (null: none), else the source's own. */
type Opened = CalSource & { event: string; lesson?: string | null };

export function Calendar({ feed }: { feed: FeedItem[] }) {
  const snap = useApp((s) => s.snapshot)!;
  const jev = useApp((s) => s.jev);
  const local = useApp((s) => s.local.calendar);
  const { selected } = useChildFilter();
  const docked = useMedia(DOCK_QUERY);
  const items = useMemo(() => forChildren(feed, selected), [feed, selected]);
  const now = today();
  const [month, setMonth] = useState(now.slice(0, 7));
  const [day, setDay] = useState<string | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const gridStart = mondayOf(`${month}-01`);
  const gridEnd = addDays(mondayOf(lastOfMonth(month)), 6);
  const luna = useApp((s) => s.luna);
  const leftOut = useApp((s) => s.local.leftOut);
  const events = useMemo(() => calendarEvents(snap, items, local, { from: gridStart, until: gridEnd, children: selected, leftOut }, luna), [snap, items, jev, local, gridStart, gridEnd, selected, luna, leftOut]);
  const ahead = useMemo(() => calendarEvents(snap, items, local, { from: now, until: addDays(now, 56), children: selected, leftOut }, luna), [snap, items, jev, local, now, selected, luna, leftOut]);
  const kindOn = (e: CalEvent) => local?.kinds[e.kind] ?? DEFAULT_KINDS[e.kind];
  // The grid is the family calendar as it will be: the kinds that go there, and suggestions (outlined) of those.
  const shown = events.filter(kindOn);
  const suggestions = ahead.filter((e) => !e.sure && kindOn(e));
  const coming = ahead.filter((e) => goesToCalendar(e, local) && e.date <= addDays(now, 27));
  const weeks: string[][] = [];
  for (let monday = gridStart; monday <= gridEnd; monday = addDays(monday, 7)) weeks.push([0, 1, 2, 3, 4, 5, 6].map((i) => addDays(monday, i)));

  // Exams open their scheduled day; other events open their source. From a day's list, closing goes back to the day.
  const openEvent = (e: CalEvent, fromDay: boolean) => {
    if (!fromDay) setDay(null);
    setOpened({ ...calendarPanelSource(e), event: e.key });
  };
  const pickDay = (d: string) => {
    setOpened(null);
    setDay(day === d ? null : d);
  };

  // A day further out than the sync reads: its timetable is read when it's shown (and kept, as in the Week).
  const openedDay = opened?.kind === "day" ? `${opened.child}|${opened.date}` : null;
  useEffect(() => {
    if (!openedDay) return;
    const [child, date] = openedDay.split("|");
    if (weekday(date) > 4 || knownLessons(getState().snapshot?.perChild[child]).some((l) => l.date === date)) return;
    void loadWeek(child, mondayOf(date)).catch(() => {});
  }, [openedDay]);

  const glance = <CalendarGlance suggestions={suggestions} coming={coming} snap={snap} onOpen={(e) => openEvent(e, false)} />;
  const side = (() => {
    if (opened?.kind === "day") {
      const child = snap.children.find((c) => c.number === opened.child);
      if (!child) return null;
      const own = knownLessons(snap.perChild[child.number]).find((l) => l.date === opened.date && opened.start !== null && l.start === opened.start);
      return (
        <DayPanel
          focus={{ child, date: opened.date, lesson: opened.lesson !== undefined ? opened.lesson : own ? lessonKey(own) : null }}
          onFocus={(f) => setOpened({ ...opened, date: f.date, lesson: f.lesson })}
          onClose={() => setOpened(null)}
        />
      );
    }
    if (opened?.kind === "item") {
      const event = [...events, ...ahead].find((e) => e.key === opened.event);
      return <ItemSide itemKey={opened.key} line={opened.line} event={event} feed={feed} snap={snap} onClose={() => setOpened(null)} />;
    }
    if (day) {
      const on = events.filter((e) => e.date <= day && (e.endDate ?? e.date) >= day);
      return (
        <DetailsPanel title={dayWithDate(day)} onClose={() => setDay(null)}>
          {on.length ? (
            <ul className="ov-list cal-list">
              {on.map((e) => (
                <EventLine key={e.key} e={e} snap={snap} onOpen={() => openEvent(e, true)} />
              ))}
            </ul>
          ) : (
            <p className="ov-none">{t("Nothing for the calendar this day.")}</p>
          )}
        </DetailsPanel>
      );
    }
    return docked ? <DetailsPanel title={t("Coming up")}>{glance}</DetailsPanel> : null;
  })();

  return (
    <main className="page calendar-page">
      <div className="week-head">
        <h1>{t("Calendar")}</h1>
        <span style={{ flex: 1 }} />
        <button type="button" className={`btn btn-sm${settingsOpen ? " active" : ""}`} aria-expanded={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)}>
          <Icon name="settings" /> {t("To the family calendar")}
        </button>
      </div>

      {settingsOpen ? <CalendarSettings ahead={ahead} /> : null}

      <MonthGrid
        weeks={weeks}
        month={month}
        onMonth={setMonth}
        shown={shown}
        snap={snap}
        picked={day}
        openedEvent={opened?.event ?? null}
        onPick={pickDay}
        onOpen={(e) => openEvent(e, false)}
      />

      {side}
      {!docked ? (
        <section className="card week-overview" aria-label={t("Coming up")}>
          {glance}
        </section>
      ) : null}
    </main>
  );
}

/** Beside the calendar (or under it, in a narrow window): Jev's suggestions, then what's in the calendar for the next four weeks. */
function CalendarGlance({ suggestions, coming, snap, onOpen }: { suggestions: CalEvent[]; coming: CalEvent[]; snap: Snapshot; onOpen: (e: CalEvent) => void }) {
  return (
    <div className="cal-ov">
      <Section title={t("Suggestions")} count={suggestions.length} none={t("None: everything found is sure.")}>
        <p className="cal-suggest-why">{t("The AI found these but isn't sure. Add the ones that belong in the calendar.")}</p>
        <ul className="ov-list cal-list">
          {suggestions.map((e) => (
            <EventLine key={e.key} e={e} snap={snap} onOpen={() => onOpen(e)} withDate />
          ))}
        </ul>
      </Section>
      <Section title={t("In the calendar")} count={coming.length} none={t("Nothing in the next four weeks.")}>
        <ul className="ov-list cal-list">
          {coming.map((e) => (
            <EventLine key={e.key} e={e} snap={snap} onOpen={() => onOpen(e)} withDate />
          ))}
        </ul>
      </Section>
    </div>
  );
}

/** What goes to the family calendar, by kind, with how many are coming in the next eight weeks. */
function CalendarSettings({ ahead }: { ahead: CalEvent[] }) {
  const local = useApp((s) => s.local.calendar);
  return (
    <section className="card cal-settings">
      <h2 className="eyebrow">{t("What goes to the family calendar")}</h2>
      <div className="cal-kinds">
        {CAL_KIND_ORDER.map((k) => {
          const on = local?.kinds[k] ?? DEFAULT_KINDS[k];
          const n = ahead.filter((e) => e.kind === k && e.sure).length;
          return (
            <label key={k} className={`cal-kind k-${k}`}>
              <input type="checkbox" checked={on} onChange={(ev) => setCalendarKind(k, ev.target.checked)} />
              <span>{kindMany(k)}</span>
              <small>{n ? t("{n} coming", { n }) : t("none coming")}</small>
            </label>
          );
        })}
      </div>
      <p className="cal-sync-note">
        <Icon name="calendar" /> {t("Google Calendar comes next: these go to a calendar of their own in your Google account, kept up to date, and removed when Wilma drops them.")}
      </p>
    </section>
  );
}

const LANES = 3;

interface Placed {
  e: CalEvent;
  /** The week's columns it covers (0 = Monday). */
  from: number;
  to: number;
  lane: number;
  /** It began before this week, or goes on after it. */
  before: boolean;
  after: boolean;
}

/** A week's events in lanes, the longest first, each in the first lane free on all its days: a holiday runs across as one bar. */
function lanesOf(days: string[], events: CalEvent[]): Placed[] {
  const first = days[0];
  const last = days[6];
  const span = (e: CalEvent) => daysBetween(e.date, e.endDate ?? e.date);
  const on = events
    .filter((e) => e.date <= last && (e.endDate ?? e.date) >= first)
    // Longest first (bars on top), then what's sure and the child's own (an exam before a holiday) before the rest, then by time.
    .sort(
      (a, b) =>
        span(b) - span(a) ||
        a.date.localeCompare(b.date) ||
        Number(!a.sure) - Number(!b.sure) ||
        CAL_KIND_ORDER.indexOf(a.kind) - CAL_KIND_ORDER.indexOf(b.kind) ||
        Number(!allDay(a)) - Number(!allDay(b)) ||
        (a.start ?? "").localeCompare(b.start ?? "")
    );
  const taken: boolean[][] = [];
  return on.map((e) => {
    const from = Math.max(0, daysBetween(first, e.date));
    const to = Math.min(6, daysBetween(first, e.endDate ?? e.date));
    let lane = 0;
    while (taken[lane]?.slice(from, to + 1).some(Boolean)) lane += 1;
    taken[lane] ??= [];
    for (let k = from; k <= to; k += 1) taken[lane][k] = true;
    return { e, from, to, lane, before: e.date < first, after: (e.endDate ?? e.date) > last };
  });
}

/**
 * The month, a week to a row (Mon–Sun), as a family calendar shows it: each
 * event as it will read there ("Kiia: Maantiedon koe"), a time first when it
 * has one, a holiday as a bar across its days. The month and its arrows stay
 * on top while the page scrolls. An event opens where it comes from, a day
 * what's on it, both beside the calendar.
 */
function MonthGrid({
  weeks,
  month,
  onMonth,
  shown,
  snap,
  picked,
  openedEvent,
  onPick,
  onOpen,
}: {
  weeks: string[][];
  month: string;
  onMonth: (month: string) => void;
  /** What goes to the family calendar (and suggestions for it), drawn on the days. */
  shown: CalEvent[];
  snap: Snapshot;
  picked: string | null;
  openedEvent: string | null;
  onPick: (d: string) => void;
  onOpen: (e: CalEvent) => void;
}) {
  const w = useWilma();
  const now = today();
  const colorOf = (e: CalEvent) => (e.children.length === 1 ? `c${(snap.children.find((c) => c.number === e.children[0])?.color ?? 0) % 16}` : "shared");
  const onDay = (d: string) => shown.filter((e) => e.date <= d && (e.endDate ?? e.date) >= d);

  return (
    <div className="cal-grid">
      <div className="cal-top">
        <div className="cal-nav">
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => onMonth(shiftMonth(month, -1))} aria-label={t("Previous month")}>
            <Icon name="left" />
          </button>
          <h2 className="cal-month">{monthTitle(month)}</h2>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => onMonth(shiftMonth(month, 1))} aria-label={t("Next month")}>
            <Icon name="right" />
          </button>
          {month !== now.slice(0, 7) ? (
            <button type="button" className="btn btn-sm" onClick={() => onMonth(now.slice(0, 7))}>
              {tSense("Today", "calendar")}
            </button>
          ) : null}
        </div>
        <div className="cal-head" aria-hidden="true">
          {weeks[0].map((d) => (
            <span key={d} className={weekday(d) > 4 ? "weekend" : undefined}>
              {dayName(d)}
            </span>
          ))}
        </div>
      </div>
      {weeks.map((days) => {
        const placed = lanesOf(days, shown);
        const lanes = Math.min(LANES, Math.max(0, ...placed.map((p) => p.lane + 1)));
        const hidden = days.map((_, k) => placed.filter((p) => p.lane >= LANES && p.from <= k && k <= p.to).length);
        const more = hidden.some(Boolean);
        return (
          <div className="cal-wk" key={days[0]} style={{ gridTemplateRows: `var(--cal-dn) repeat(${lanes}, var(--cal-lane))${more ? " var(--cal-lane)" : ""} minmax(4px, 1fr)` }}>
            {days.map((d, k) => {
              const on = onDay(d);
              const cls = `cal-day${d.slice(0, 7) !== month ? " other" : ""}${weekday(d) > 4 ? " weekend" : ""}${d === now ? " today" : ""}${d < now ? " past" : ""}`;
              return (
                <button
                  type="button"
                  key={d}
                  className={cls}
                  style={{ gridColumn: k + 1 }}
                  aria-pressed={picked === d}
                  aria-label={`${dayWithDate(d)}${on.length ? `: ${on.map((e) => calendarTitle(e, snap.children)).join(", ")}` : ""}`}
                  onClick={() => onPick(d)}
                >
                  <span className="cal-dn">
                    <b>{d.slice(8) === "01" ? shortDate(d).replace(/^\S+ /, "") : Number(d.slice(8))}</b>
                    {k === 0 ? <small>{t("wk {n}", { n: isoWeek(d) })}</small> : null}
                  </span>
                </button>
              );
            })}
            {placed
              .filter((p) => p.lane < LANES)
              .map((p) => (
                <button
                  type="button"
                  key={p.e.key}
                  className={`cal-bar ${colorOf(p.e)} k-${p.e.kind}${allDay(p.e) ? "" : " timed"}${p.e.sure ? "" : " suggested"}${p.before ? " before" : ""}${p.after ? " after" : ""}${(p.e.endDate ?? p.e.date) < now ? " past" : ""}`}
                  style={{ gridColumn: `${p.from + 1} / ${p.to + 2}`, gridRow: p.lane + 2 }}
                  aria-pressed={openedEvent === p.e.key}
                  onClick={() => onOpen(p.e)}
                >
                  {allDay(p.e) ? null : <time>{p.e.start}</time>}
                  <span>{calendarTitle({ ...p.e, title: w(p.e.title) }, snap.children)}</span>
                </button>
              ))}
            {hidden.map((n, k) =>
              n ? (
                <small key={k} className="cal-more" aria-hidden="true" style={{ gridColumn: k + 1, gridRow: lanes + 2 }}>
                  {t("+{n} more", { n })}
                </small>
              ) : null
            )}
          </div>
        );
      })}
    </div>
  );
}

/** One event in a list beside the calendar: when, whose, what and of which kind; opens where it comes from. A suggestion has "Add" and "Dismiss". */
function EventLine({ e, snap, onOpen, withDate = false }: { e: CalEvent; snap: Snapshot; onOpen: () => void; withDate?: boolean }) {
  const w = useWilma();
  const local = useApp((s) => s.local.calendar);
  const kids = e.children.map((n) => snap.children.find((c) => c.number === n)).filter((c) => c !== undefined);
  const decided = calendarDecision(e, local);
  const syncs = goesToCalendar(e, local);
  const time = e.start ? (e.end ? `${e.start}–${e.end}` : e.start) : null;
  const span = e.endDate ? `${shortDate(e.date)}–${shortDate(e.endDate)}` : null;
  const facts = [withDate ? (span ?? time) : (span ?? time ?? t("All day")), kindOne(e.kind), kids.length > 1 ? kids.map((c) => c.first).join(", ") : null, w(e.detail)];
  return (
    <li className={`cal-line${e.sure ? "" : " suggested"}`}>
      <button type="button" onClick={onOpen}>
        <span className="ov-day">{withDate ? shortDate(e.date) : (e.start ?? "")}</span>
        <Tab child={kids[0]} />
        <span className="ov-text">
          <b>{w(e.title)}</b>
          <small>{facts.filter(Boolean).join(" · ")}</small>
        </span>
      </button>
      {!e.sure ? (
        <p className="cal-line-act">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setCalendarDecision(e, "yes")}>
            <Icon name="check" /> {t("Add")}
          </button>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setCalendarDecision(e, "no")}>
            {t("Dismiss")}
          </button>
        </p>
      ) : decided === "yes" || !syncs ? (
        <p className="cal-line-act">
          {syncs ? null : <span className="chip">{t("Not to the calendar")}</span>}
          {decided === "yes" ? (
            <button type="button" className="linkish" onClick={() => setCalendarDecision(e, null)}>
              {t("Undo")}
            </button>
          ) : null}
        </p>
      ) : null}
    </li>
  );
}

/**
 * A message or bulletin beside the calendar (or the week), as the Inbox shows it, with the line the date was read from
 * marked. Opened from an event, the event is on top, and can be removed from the calendar.
 */
export function ItemSide({ itemKey, line, event, feed, snap, onClose }: { itemKey: string; line: string | null; event?: CalEvent; feed: FeedItem[]; snap: Snapshot; onClose: () => void }) {
  const item = feed.find((i) => i.key === itemKey);
  return (
    <DetailsPanel
      title={
        <>
          {item ? <Tabs snap={snap} numbers={item.children} /> : null}
          <span>{item?.kind === "news" ? t("Bulletin") : t("Message")}</span>
        </>
      }
      onClose={onClose}
    >
      {event ? <EventBar e={event} snap={snap} onRemoved={onClose} /> : null}
      {item ? <Reader key={item.key} item={item} snap={snap} inPanel highlight={line} /> : <p className="ov-none">{t("It isn't in Wilma any more.")}</p>}
    </DetailsPanel>
  );
}

/**
 * The event read from the message, with "Remove from the calendar" for one that isn't the family's (a vaccination
 * for the other child's class, say): it leaves the week, the calendar and the family calendar; the message stays.
 */
function EventBar({ e, snap, onRemoved }: { e: CalEvent; snap: Snapshot; onRemoved: () => void }) {
  const w = useWilma();
  const local = useApp((s) => s.local.calendar);
  const kids = e.children.map((n) => snap.children.find((c) => c.number === n)?.first).filter(Boolean);
  const when = e.endDate ? `${shortDate(e.date)}–${shortDate(e.endDate)}` : `${shortDate(e.date)}${e.start ? ` ${e.start}${e.end ? `–${e.end}` : ""}` : ""}`;
  const remove = () => {
    const before = calendarDecision(e, local) ?? null;
    setCalendarDecision(e, "no");
    onRemoved();
    showToast(t("Removed from the calendar: {title}", { title: w(e.title) }), () => setCalendarDecision(e, before));
  };
  return (
    <div className="event-bar">
      <span className="event-bar-text">
        <b>{w(e.title)}</b>
        <small>{[when, kindOne(e.kind), kids.length > 1 ? kids.join(", ") : null].filter(Boolean).join(" · ")}</small>
      </span>
      <button type="button" className="btn btn-sm" onClick={remove} title={t("The message stays; only the event leaves the week and the calendar.")}>
        {t("Remove from the calendar")}
      </button>
    </div>
  );
}
