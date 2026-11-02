import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import type { ScheduleLesson } from "@wilma-client/src/core";
import { useApp } from "../data/store";
import { addDays, isoWeek, longDate, minutes, mondayOf, nowMinutes, shortDate, today, dayName } from "../data/dates";
import { t } from "../i18n";
import { useWilma } from "../data/phrases";
import { forChildren, type FeedItem } from "../data/feed";
import { DEFAULT_KINDS, allDay, calendarEvents, calendarTitle, type CalEvent } from "../data/calendar";
import { allTogether, dayLessons, dayTimes, examForLesson, isPE, lessonKey, together, unusualDays, type UnusualDay } from "../data/schedule";
import { loadWeek } from "../data/engine";
import type { Child } from "../data/model";
import { Icon, Tab } from "./bits";
import { DOCK_QUERY, useChildFilter, useMedia } from "./shared";
import { DetailsPanel } from "./Details";
import { Glance } from "./Glance";
import { DayPanel, type DayFocus } from "./DayPanel";
import { ItemSide } from "./Calendar";
import { UsualWeek, togetherLabel } from "./UsualWeek";


const HOUR_PX = 64;
/** Room above the first hour, so its label isn't cut by the header's line. */
const TOP_PX = 12;
/** How far the Week view goes: a school term back, a few weeks ahead (timetables further out aren't set yet). */
const WEEKS_BACK = 16;
const WEEKS_AHEAD = 6;

export function Week({ feed }: { feed: FeedItem[] }) {
  const w = useWilma();
  const snap = useApp((s) => s.snapshot)!;
  const { selected } = useChildFilter();
  const docked = useMedia(DOCK_QUERY);
  const now = today();
  const [offset, setOffset] = useState(0);
  // The usual week (the fridge sheet: each weekday's usual hours, PE, when the children go together), or week by week.
  const [usual, setUsual] = useState(false);
  const monday = addDays(mondayOf(now), offset * 7);
  const days = [0, 1, 2, 3, 4].map((i) => addDays(monday, i));
  const children = snap.children.filter((c) => !selected.length || selected.includes(c.number));

  // This week and next come with every sync; other weeks are read from Wilma when shown, then kept.
  const synced = offset === 0 || offset === 1;
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    if (synced) return;
    let live = true;
    setLoading(true);
    setLoadError(null);
    Promise.all(children.map((c) => loadWeek(c.number, monday)))
      .catch((err) => live && setLoadError(err instanceof Error ? err.message : String(err)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [monday, synced, children.map((c) => c.number).join(",")]);
  const lessonsOf = (c: Child) => (synced ? snap.perChild[c.number]?.lessons : snap.perChild[c.number]?.weeks?.[monday]?.lessons) ?? [];
  // Lessons the parent left out of a child's school hours (an optional one) still show, but don't move the day's times.
  const leftOut = useApp((s) => s.local.leftOut);
  const isOut = (c: Child, l: ScheduleLesson) => Boolean(leftOut?.[c.number]?.includes(l.subject));
  const timesOf = (c: Child) => dayTimes(dayLessons(lessonsOf(c), leftOut?.[c.number]));
  const unusualOf = (c: Child) => unusualDays(snap.perChild[c.number], days, leftOut?.[c.number]);
  const pe = useApp((s) => s.local.pe);
  const peOn = (c: Child, d: string) => lessonsOf(c).some((l) => l.date === d && isPE(l, pe));
  const all = children.flatMap((c) => lessonsOf(c).filter((l) => days.includes(l.date)).map((l) => ({ ...l, child: c })));
  const empty = !loading && !loadError && all.length === 0;
  const startH = Math.min(8, ...all.map((l) => Math.floor(minutes(l.start) / 60)));
  const endH = Math.max(15, ...all.map((l) => Math.ceil(minutes(l.end) / 60)));
  const height = (endH - startH) * HOUR_PX + TOP_PX;
  const y = (t: string) => TOP_PX + ((minutes(t) - startH * 60) / 60) * HOUR_PX;
  const lanes = children.length;
  // The day in the panel, with the lesson picked in it (a click in the grid picks that one).
  const [focus, setFocus] = useState<DayFocus | null>(null);
  const close = useCallback(() => setFocus(null), []);
  const pick = (child: Child, lesson: ScheduleLesson) => {
    setItem(null);
    setFocus({ child, date: lesson.date, lesson: lessonKey(lesson) });
  };

  // The calendar's events for the week (what's read from messages, bulletins and notes, and invitations), at the top of each day.
  // Exams and changed days are left out: the grid shows those itself.
  const jev = useApp((s) => s.jev);
  const local = useApp((s) => s.local.calendar);
  const luna = useApp((s) => s.luna);
  const items = useMemo(() => forChildren(feed, selected), [feed, selected]);
  const weekEvents = useMemo(
    () =>
      calendarEvents(snap, items, local, { from: monday, until: addDays(monday, 6), children: selected }, luna).filter(
        (e) => (local?.kinds[e.kind] ?? DEFAULT_KINDS[e.kind]) && !e.key.startsWith("exam:") && !e.key.startsWith("day:")
      ),
    [snap, items, jev, local, monday, selected, luna]
  );
  // A message or bulletin an event comes from, shown beside the week as in the Calendar.
  const [item, setItem] = useState<{ key: string; line: string | null; event: string } | null>(null);
  const openEvent = (e: CalEvent) => {
    if (e.source.kind === "item") {
      setFocus(null);
      setItem({ key: e.source.key, line: e.source.line, event: e.key });
      return;
    }
    const child = snap.children.find((c) => c.number === (e.source as { child: string }).child);
    if (!child) return;
    const { date, start } = e.source;
    const lesson = lessonsOf(child).find((l) => l.date === date && start !== null && l.start === start) ?? null;
    setItem(null);
    setFocus({ child, date, lesson: lesson ? lessonKey(lesson) : null });
  };
  const examFor = (child: Child, l: ScheduleLesson) => examForLesson(snap.perChild[child.number], l);
  const on = (e: CalEvent, d: string) => e.date <= d && (e.endDate ?? e.date) >= d;
  const spanning = weekEvents.filter((e) => days.filter((d) => on(e, d)).length > 1);
  const oneDay = weekEvents.filter((e) => !spanning.includes(e));
  const eventChip = (e: CalEvent, style?: CSSProperties) => {
    const first = snap.children.find((c) => c.number === e.children[0]);
    const title = calendarTitle({ ...e, title: w(e.title) }, snap.children);
    return (
      <button
        type="button"
        key={e.key}
        className={`wk-ev ${e.children.length === 1 ? `c${(first?.color ?? 0) % 16}` : "shared"} k-${e.kind}${e.sure ? "" : " suggested"}`}
        style={style}
        title={title}
        onClick={() => openEvent(e)}
      >
        {allDay(e) ? null : <time>{e.start}</time>}
        <span>{lanes > 1 ? title : w(e.title)}</span>
      </button>
    );
  };

  return (
    <main className="page">
      <div className="week-head">
        <h1>{usual ? t("Usual week") : t("Week {n}", { n: isoWeek(monday) })}</h1>
        {usual ? null : (
          <span className="sub">
            {longDate(monday)} – {longDate(days[4])}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <div className="seg-toggle" role="group" aria-label={t("Show")}>
          <button type="button" aria-pressed={!usual} onClick={() => setUsual(false)}>
            {t("Week by week")}
          </button>
          <button type="button" aria-pressed={usual} onClick={() => setUsual(true)}>
            {t("Usual week")}
          </button>
        </div>
        {usual ? null : (
          <span className="week-nav">
            <button className="btn btn-sm" onClick={() => setOffset((o) => o - 1)} disabled={offset <= -WEEKS_BACK} aria-label={t("Previous week")}>
              <Icon name="left" />
            </button>
            <button className="btn btn-sm" onClick={() => setOffset(0)} disabled={offset === 0}>
              {t("This week")}
            </button>
            <button className="btn btn-sm" onClick={() => setOffset((o) => o + 1)} disabled={offset >= WEEKS_AHEAD} aria-label={t("Next week")}>
              <Icon name="right" />
            </button>
          </span>
        )}
      </div>
      {usual ? <UsualWeek snap={snap} children={children} leftOut={leftOut} /> : null}
      {usual ? null : (
        <>
          {loading ? <p className="week-state">{t("Reading the week from Wilma…")}</p> : null}
          {loadError ? <div className="notice err week-state">{loadError}</div> : null}
          {empty ? <p className="week-state">{t("Wilma has no lessons this week. A holiday, perhaps?")}</p> : null}
          <div className="week" style={{ ["--hour" as string]: `${HOUR_PX}px`, ["--top" as string]: `${TOP_PX}px` }}>
            <div className="colhead" />
            {days.map((d) => (
              <div key={d} className={`colhead${d === now ? " is-today" : ""}`}>
                {dayName(d)}
                <small>{shortDate(d).split(" ").slice(1).join(" ")}</small>
                {/* When school starts and ends, for each child; a change from the usual stands out, and so do times a sibling shares. */}
                <DayTimesHead
                  children={children}
                  times={children.map((c) => timesOf(c).get(d))}
                  odd={children.map((c) => unusualOf(c).filter((u) => u.date === d))}
                  pe={children.map((c) => peOn(c, d))}
                />
                {oneDay.some((e) => on(e, d)) ? (
                  <span className="wk-events">
                    {oneDay.filter((e) => on(e, d)).map((e) => eventChip(e))}
                  </span>
                ) : null}
              </div>
            ))}
            {/* Events over several of the days (a week of vaccinations, a camp): once, across their days. */}
            {spanning.length ? (
              <div className="wk-spans">
                {spanning.map((e) => {
                  const covered = days.filter((d) => on(e, d));
                  return eventChip(e, { gridColumn: `${days.indexOf(covered[0]) + 2} / ${days.indexOf(covered[covered.length - 1]) + 3}` });
                })}
              </div>
            ) : null}
            <div className="hours" style={{ height }}>
              {Array.from({ length: endH - startH + 1 }, (_, i) => (
                <span key={i} style={{ top: TOP_PX + i * HOUR_PX }}>
                  {startH + i}
                </span>
              ))}
            </div>
            {days.map((d) => (
              <div key={d} className={`col${d === now ? " is-today" : ""}`} style={{ height }}>
                {all
                  .filter((l) => l.date === d)
                  .map((l, i) => {
                    const lane = children.findIndex((c) => c.number === l.child.number);
                    const exam = examFor(l.child, l);
                    return (
                      <button
                        type="button"
                        key={i}
                        onClick={() => pick(l.child, l)}
                        aria-pressed={Boolean(focus && focus.child.number === l.child.number && focus.date === l.date && focus.lesson === lessonKey(l))}
                        className={`les c${l.child.color % 16}${exam ? " exam" : ""}${minutes(l.end) - minutes(l.start) >= 70 ? " tall" : ""}${isOut(l.child, l) ? " out" : ""}`}
                        style={{
                          top: y(l.start) + 1,
                          height: Math.max(18, y(l.end) - y(l.start) - 2),
                          left: `calc(${(lane / lanes) * 100}% + 3px)`,
                          width: `calc(${100 / lanes}% - 6px)`,
                        }}
                        title={`${l.child.first}: ${l.start}–${l.end} ${w(l.subject)}${l.room ? ` · ${l.room}` : ""}${l.teacher ? ` · ${l.teacher}` : ""}${exam ? ` · ${t("exam")}` : ""}`}
                      >
                        {/* The child is the box's colour and column (see the day's times above); the subject gets the room. */}
                        <b>{w(l.subject)}</b>
                        <span>
                          {l.start}
                          {l.room ? ` · ${l.room}` : ""}
                        </span>
                      </button>
                    );
                  })}
                {d === now && nowMinutes() > startH * 60 && nowMinutes() < endH * 60 ? <div className="nowline" style={{ top: TOP_PX + ((nowMinutes() - startH * 60) / 60) * HOUR_PX }} /> : null}
              </div>
            ))}
          </div>
          {(() => {
            // The week at a glance: beside the grid until a lesson is picked (wide windows), or under it; a picked lesson shows its day.
            const overview = (
              <Glance
                feed={feed}
                children={children}
                days={days}
                until={addDays(monday, 6)}
                lessonsOf={lessonsOf}
                onExam={(child, date) => {
                  const lesson = lessonsOf(child).find((l) => l.date === date && examFor(child, l));
                  if (lesson) pick(child, lesson);
                }}
                onLesson={pick}
                homework
              />
            );
            const title = t("Week {n} at a glance", { n: isoWeek(monday) });
            return (
              <>
                {focus ? (
                  <DayPanel focus={focus} onFocus={setFocus} onClose={close} />
                ) : item ? (
                  <ItemSide itemKey={item.key} line={item.line} event={weekEvents.find((e) => e.key === item.event)} feed={feed} snap={snap} onClose={() => setItem(null)} />
                ) : docked ? (
                  <DetailsPanel title={title}>{overview}</DetailsPanel>
                ) : null}
                {!docked ? (
                  <section className="card week-overview" aria-label={title}>
                    <h2>{title}</h2>
                    {overview}
                  </section>
                ) : null}
              </>
            );
          })()}
        </>
      )}
    </main>
  );
}

/** "Kiia", "Kiia and Otso", "Kiia, Otso and Eeli". */
const names = (children: Child[]) =>
  children.length < 2 ? (children[0]?.first ?? "") : t("{names} and {last}", { names: children.slice(0, -1).map((c) => c.first).join(", "), last: children[children.length - 1].first });


/**
 * Each child's start and finish for one day: a time a sibling shares (within a quarter of an hour) is marked, with
 * who it's shared with; a change from the usual is in the warning colour; a shirt for PE.
 */
function DayTimesHead({ children, times, odd, pe }: { children: Child[]; times: ({ start: string; end: string } | undefined)[]; odd: UnusualDay[][]; pe: boolean[] }) {
  const lanes = children.length;
  const near = together(times);
  const all = allTogether(times);
  // A time shared with some of the siblings (three or more children); when everyone shares it, the day's label says so.
  const shared = (i: number, side: "start" | "end") => {
    const others = near[i][side].map((j) => children[j]);
    if (!others.length || all[side]) return null;
    return { className: "with", title: side === "start" ? t("Starts with {names}", { names: names(others) }) : t("Finishes with {names}", { names: names(others) }) };
  };
  const label = lanes > 1 ? togetherLabel(times) : null;
  return (
    <span className="day-times">
      {children.map((c, i) => {
        const day = times[i];
        const changes = odd[i];
        return (
          <span key={c.number} className={`dt${changes.length ? " odd" : ""}`} title={changes.length ? changes.map((u) => (u.kind === "off" ? t("No lessons") : t("Usually {time}", { time: u.usual! }))).join(" · ") : undefined}>
            {lanes > 1 ? <Tab child={c} /> : null}
            {day ? (
              <>
                <span {...shared(i, "start")}>{day.start}</span>–<span {...shared(i, "end")}>{day.end}</span>
              </>
            ) : (
              "–"
            )}
            {pe[i] ? <Icon name="shirt" className="icon pe" label={t("PE")} /> : null}
          </span>
        );
      })}
      {label ? <span className="together" title={t("Within a quarter of an hour of each other")}>{label}</span> : null}
    </span>
  );
}
