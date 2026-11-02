/*
 * What's ahead at a glance, for the children shown: exams, events and
 * deadlines from messages, schedule changes (a start or end off the usual,
 * a school day without lessons, and what messages say about the timetable),
 * and in the Week, homework as a count. The sections are always there, in
 * the same order, with a line saying when one is empty, so a glance tells
 * "no exams" from not having looked.
 */
import { useState, type ReactNode } from "react";
import type { ScheduleLesson } from "@wilma-client/src/core";
import { useApp } from "../data/store";
import { agenda, type FeedItem } from "../data/feed";
import { readExamEntries } from "../data/calendar";
import { dueHomework, useHomeworkJudged } from "../data/homework";
import { formatMinutes, unusualDays } from "../data/schedule";
import { dayName, shortDate, today } from "../data/dates";
import type { Child } from "../data/model";
import { Tab } from "./bits";
import { go } from "./shared";
import { plural, t } from "../i18n";
import { useWilma } from "../data/phrases";

/** One line: the day, the child, what, and where a click goes. */
function Line({ date, child, onClick, children }: { date: string; child: Child | undefined; onClick?: () => void; children: ReactNode }) {
  const body = (
    <>
      <span className="ov-day">{shortDate(date)}</span>
      <Tab child={child} />
      <span className="ov-text">{children}</span>
    </>
  );
  return <li>{onClick ? <button type="button" onClick={onClick}>{body}</button> : <div>{body}</div>}</li>;
}

export function Section({ title, count, none, action, children }: { title: string; count: number; none: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="details-section">
      <h4>
        {title}
        {count ? <span className="n">{count}</span> : null}
        {action}
      </h4>
      {count ? children : <p className="ov-none">{none}</p>}
    </section>
  );
}

export function Glance({
  feed,
  children,
  days,
  until,
  lessonsOf,
  onExam,
  onLesson,
  homework = false,
}: {
  feed: FeedItem[];
  children: Child[];
  /** The school days covered (Mon–Fri dates); events and changes before today are left out. */
  days: string[];
  /** The last day covered (the week's Sunday). */
  until: string;
  lessonsOf: (c: Child) => ScheduleLesson[];
  onExam?: (c: Child, date: string) => void;
  onLesson?: (c: Child, l: ScheduleLesson) => void;
  homework?: boolean;
}) {
  const w = useWilma();
  const judged = useHomeworkJudged();
  const snap = useApp((s) => s.snapshot)!;
  const [homeworkOpen, setHomeworkOpen] = useState(false);
  const now = today();
  const from = days[0] > now ? days[0] : now;
  const ahead = days.filter((d) => d >= now);
  const childOf = (n: string) => children.find((c) => c.number === n);
  const luna = useApp((s) => s.luna);
  const local = useApp((s) => s.local.calendar);
  // Wilma's exams and what messages say, and the exams read from messages and teachers' notes (as the calendar shows them).
  const range = { from, until, children: children.map((c) => c.number) };
  const entries = [...agenda(snap, feed, range.children, { from, until }), ...readExamEntries(snap, feed, luna, local, range)].sort((a, b) =>
    (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? ""))
  );
  const exams = entries.filter((e) => e.kind === "exam");
  const events = entries.filter((e) => (e.kind === "event" || e.kind === "deadline") && e.itemKey);
  const leftOut = useApp((s) => s.local.leftOut);
  const changes = children.flatMap((c) => unusualDays(snap.perChild[c.number], ahead, leftOut?.[c.number]).map((u) => ({ child: c, ...u })));
  // A message about the timetable on a day whose change the timetable already shows is the same news: one line, linking the message.
  const messageFor = (child: Child, date: string) => entries.find((e) => e.kind === "schedule" && e.itemKey && e.child === child.number && e.date === date);
  const scheduleNotes = entries.filter((e) => e.kind === "schedule" && e.itemKey && !changes.some((u) => u.child.number === e.child && u.date === e.date));
  const due = homework ? children.flatMap((c) => dueHomework(snap.perChild[c.number], lessonsOf(c), days, judged).map((h) => ({ child: c, ...h }))) : [];

  const changeText = (u: (typeof changes)[number]) => {
    if (u.kind === "off") return t("No lessons");
    const values = { time: u.time!, by: formatMinutes(u.by!) };
    if (u.kind === "start") return u.by! > 0 ? t("Starts {time}, {by} later than usual", values) : t("Starts {time}, {by} earlier than usual", values);
    return u.by! > 0 ? t("Ends {time}, {by} later than usual", values) : t("Ends {time}, {by} earlier than usual", values);
  };

  return (
    <div className="week-ov">
      <Section
        title={t("Exams")}
        count={exams.length}
        none={t("No exams.")}
        action={
          <button type="button" className="linkish ov-all" onClick={() => go("exams")}>
            {t("All exams")} →
          </button>
        }
      >
        <ul className="ov-list">
          {exams.map((e, i) => {
            const child = childOf(e.child);
            return (
              <Line key={i} date={e.date} child={child} onClick={child && onExam ? () => onExam(child, e.date) : undefined}>
                <b>{w(e.title)}</b>
                {e.time ? <small> · {e.time}</small> : null}
                {e.detail && e.detail !== e.title ? <span className="ov-sub">{w(e.detail)}</span> : null}
              </Line>
            );
          })}
        </ul>
      </Section>
      <Section title={t("Events and deadlines")} count={events.length} none={t("No events or deadlines.")}>
        <ul className="ov-list">
          {events.map((e, i) => (
            <Line key={i} date={e.date} child={childOf(e.child)} onClick={() => go("inbox", e.itemKey)}>
              <b>{w(e.title)}</b>
              {e.time ? <small> · {e.time}</small> : null}
              <span className="ov-sub">{e.kind === "deadline" ? t("Deadline") : t("Event")}</span>
            </Line>
          ))}
        </ul>
      </Section>
      <Section title={t("Schedule changes")} count={changes.length + scheduleNotes.length} none={t("Usual times.")}>
        <ul className="ov-list">
          {changes.map((u, i) => {
            const lesson = lessonsOf(u.child).find((l) => l.date === u.date);
            const message = messageFor(u.child, u.date);
            const open = message ? () => go("inbox", message.itemKey) : lesson && onLesson ? () => onLesson(u.child, lesson) : undefined;
            const sub = [u.usual ? t("Usually {time}", { time: u.usual }) : null, message ? t("Message: {title}", { title: w(message.title) }) : null].filter(Boolean).join(" · ");
            return (
              <Line key={`c${i}`} date={u.date} child={u.child} onClick={open}>
                <b>{changeText(u)}</b>
                {sub ? <span className="ov-sub">{sub}</span> : null}
              </Line>
            );
          })}
          {scheduleNotes.map((e, i) => (
            <Line key={`m${i}`} date={e.date} child={childOf(e.child)} onClick={() => go("inbox", e.itemKey)}>
              <b>{w(e.title)}</b>
              <span className="ov-sub">{t("From a message")}</span>
            </Line>
          ))}
        </ul>
      </Section>
      {homework ? (
        <Section title={t("Homework")} count={due.length} none={t("No homework marked.")}>
          <ul className="ov-list">
            {children.map((c) => {
              const mine = due.filter((h) => h.child.number === c.number);
              if (!mine.length) return null;
              const daysWith = [...new Set(mine.map((h) => h.lesson.date))].map((d) => dayName(d)).join(", ");
              return (
                <Line key={c.number} date={mine[0].lesson.date} child={c} onClick={() => setHomeworkOpen((o) => !o)}>
                  <b>{plural(mine.length, "{n} homework task", "{n} homework tasks")}</b>
                  <span className="ov-sub">{t("For {days}", { days: daysWith })}</span>
                </Line>
              );
            })}
          </ul>
          {homeworkOpen ? (
            <ul className="ov-list ov-detail">
              {due.map((h, i) => (
                <Line key={i} date={h.lesson.date} child={h.child} onClick={onLesson ? () => onLesson(h.child, h.lesson) : undefined}>
                  <b>{w(h.lesson.subject)}</b>
                  <span className="ov-sub">{w(h.item.homework)}</span>
                </Line>
              ))}
            </ul>
          ) : null}
          <button type="button" className="linkish ov-more" onClick={() => setHomeworkOpen((o) => !o)}>
            {homeworkOpen ? t("Hide what it is") : t("Show what it is")}
          </button>
        </Section>
      ) : null}
    </div>
  );
}
