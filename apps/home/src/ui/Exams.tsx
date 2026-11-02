/*
 * Exams, for the children shown: on top the coming school days, two weeks to
 * a row (as in Homework), each day with its exams per child; then what's
 * coming (when, how soon, where, who, and everything the teacher wrote about
 * what it covers). A day on top opens its exams right under its row; an
 * exam's day opens beside the page. Results are under Grades.
 */
import { useCallback, useEffect, useState } from "react";
import type { ScheduleLesson, UpcomingExam } from "@wilma-client/src/core";
import { useApp } from "../data/store";
import { addDays, daysBetween, dayNameLong, mondayOf, shortDate, today } from "../data/dates";
import { courseKey } from "../data/homework";
import { examForLesson, knownLessons, lessonKey } from "../data/schedule";
import { readExams } from "../data/calendar";
import type { FeedItem } from "../data/feed";
import type { Child } from "../data/model";
import { DayPanel, type DayFocus } from "./DayPanel";
import { DayStrip } from "./DayStrip";
import { Icon, Linked, Tab } from "./bits";
import { examKey, go, shortLabel, tSense, useChildFilter } from "./shared";
import { t } from "../i18n";
import { useWilma } from "../data/phrases";

/** "Today", "Tomorrow", "In 9 days". */
function countdown(date: string): string {
  const n = daysBetween(today(), date);
  if (n <= 0) return t("Today");
  if (n === 1) return t("Tomorrow");
  return t("In {n} days", { n });
}

/** An exam: Wilma's own, or (`from`) read from a teacher's note or a message, with the school's own words. */
type Upcoming = { child: Child; exam: UpcomingExam; lesson: ScheduleLesson | null; from?: { key: string; quote: string; kind: "note" | "message" } };

/** A stable negative id for an exam that isn't in Wilma's list (from its source and day). */
const readId = (key: string, date: string) => -Math.abs([...`${key}|${date}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7));

/** `itemKey`: an exam to bring into view (from a day's panel). */
export function Exams({ itemKey, feed }: { itemKey?: string | null; feed: FeedItem[] }) {
  const snap = useApp((s) => s.snapshot)!;
  const luna = useApp((s) => s.luna);
  const local = useApp((s) => s.local.calendar);
  const { selected } = useChildFilter();
  const children = snap.children.filter((c) => !selected.length || selected.includes(c.number));
  const now = today();
  const [focus, setFocus] = useState<DayFocus | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const close = useCallback(() => setFocus(null), []);
  const dayCards = (date: string) => (
    <div className="exam-cards">
      {upcoming
        .filter((u) => u.exam.date === date)
        .map((u) => (
          <ExamCard
            key={examKey(u.child.number, u.exam)}
            item={u}
            highlight={false}
            shown={focus?.child.number === u.child.number && focus.date === u.exam.date}
            onShowDay={() => setFocus({ child: u.child, date: u.exam.date, lesson: u.lesson ? lessonKey(u.lesson) : null })}
          />
        ))}
    </div>
  );
  useEffect(() => {
    if (itemKey) document.querySelector(`[data-exam="${CSS.escape(itemKey)}"]`)?.scrollIntoView({ block: "center" });
  }, [itemKey]);

  const upcoming: Upcoming[] = children
    .flatMap((child) => {
      const data = snap.perChild[child.number];
      const lessons = knownLessons(data);
      return (data?.exams ?? [])
        .filter((exam) => exam.date >= now)
        .map((exam) => ({ child, exam, lesson: lessons.find((l) => l.date === exam.date && examForLesson(data, l) === exam) ?? null }));
    })
    // Exams read from teachers' notes and messages that Wilma's list doesn't have (as the calendar shows them).
    .concat(
      readExams(snap, feed, luna, local, { from: now, until: addDays(now, 180), children: children.map((c) => c.number) }).flatMap((e) =>
        e.children.flatMap((n) => {
          const child = children.find((c) => c.number === n);
          if (!child) return [];
          const isNote = e.origin.key.startsWith("note:");
          // A note's teacher: the note's lesson that day (its key names the day and the kind of note).
          const [, , noteDay, noteKind] = e.origin.key.split(":");
          const teacher = isNote
            ? (snap.perChild[n]?.notes ?? []).find((x) => x.date === noteDay && x.typeLabel === noteKind)?.teacher ?? ""
            : feed.find((i) => i.key === e.origin.key)?.from ?? "";
          const exam: UpcomingExam = { examId: readId(e.origin.key, e.date), date: e.date, time: e.start, name: "", subject: e.title, subjectCode: "", topic: null, teacher, teacherCode: "" };
          return [{ child, exam, lesson: null, from: { key: e.origin.key, quote: e.origin.quote, kind: isNote ? ("note" as const) : ("message" as const) } }];
        })
      )
    )
    .sort((a, b) => (a.exam.date + (a.exam.time ?? a.lesson?.start ?? "")).localeCompare(b.exam.date + (b.exam.time ?? b.lesson?.start ?? "")));

  const strip = stripRows(upcoming);

  // Grouped by week: this week, next week, later.
  const nextMonday = addDays(mondayOf(now), 7);
  const groups: [string, Upcoming[]][] = [
    [tSense("This week", "heading"), upcoming.filter((u) => u.exam.date < nextMonday)],
    [t("Next week"), upcoming.filter((u) => u.exam.date >= nextMonday && u.exam.date < addDays(nextMonday, 7))],
    [t("Later"), upcoming.filter((u) => u.exam.date >= addDays(nextMonday, 7))],
  ];

  return (
    <main className="page exams-page">
      <div className="week-head">
        <h1>{t("Exams")}</h1>
        <span className="sub">{upcoming.length ? t("{n} coming up", { n: upcoming.length }) : t("None coming up")}</span>
      </div>

      <DayStrip
        start={strip.start}
        rows={strip.rows}
        chips={(d) =>
          upcoming
            .filter((u) => u.exam.date === d)
            .map((u) => (
              <i key={examKey(u.child.number, u.exam)} className={`c${u.child.color % 16}`}>
                {children.length > 1 ? `${shortLabel(u.child)} ${subjectShort(u.exam)}` : subjectShort(u.exam)}
              </i>
            ))
        }
        canOpen={(d) => upcoming.some((u) => u.exam.date === d)}
        describe={(d) =>
          upcoming
            .filter((u) => u.exam.date === d)
            .map((u) => `${u.child.first}, ${u.exam.subject || u.exam.name}`)
            .join("; ")
        }
        picked={picked}
        onPick={setPicked}
        renderDay={dayCards}
        after={strip.later ? <p className="ex-strip-later">{t("+{n} later", { n: strip.later })}</p> : null}
      />

      {upcoming.length ? (
        groups
          .filter(([, list]) => list.length)
          .map(([title, list]) => (
            <section className="section" key={title}>
              <h2 className="eyebrow">{title}</h2>
              <div className="exam-cards">
                {list.map((u) => (
                  <ExamCard
                    key={examKey(u.child.number, u.exam)}
                    item={u}
                    highlight={examKey(u.child.number, u.exam) === itemKey}
                    shown={focus?.child.number === u.child.number && focus.date === u.exam.date}
                    onShowDay={() => setFocus({ child: u.child, date: u.exam.date, lesson: u.lesson ? lessonKey(u.lesson) : null })}
                  />
                ))}
              </div>
            </section>
          ))
      ) : (
        <div className="card">
          <p style={{ margin: 0 }}>{t("Wilma lists no exams coming up for the children shown.")}</p>
        </div>
      )}

      <p className="exams-results-link">
        <button type="button" className="linkish" onClick={() => go("grades", "exams")}>
          {t("Exam results are under Grades")} →
        </button>
      </p>

      {focus ? <DayPanel focus={focus} onFocus={setFocus} onClose={close} /> : null}
    </main>
  );
}

/** An exam's subject, short: its course code as Wilma's timetable shows it ("MA", "ENA1"), else the start of the subject's name. */
const subjectShort = (exam: UpcomingExam) => courseKey(exam.subjectCode || "") || (exam.subject || exam.name).slice(0, 4);

/** Rows of two weeks the exams need, from this week (one to four: up to eight weeks), and how many are later still. */
function stripRows(upcoming: Upcoming[]): { start: string; rows: number; later: number } {
  const start = mondayOf(today());
  const last = upcoming.length ? upcoming[upcoming.length - 1].exam.date : today();
  const weeks = Math.min(8, Math.max(2, Math.ceil((daysBetween(start, last) + 1) / 7)));
  const rows = Math.ceil(weeks / 2);
  return { start, rows, later: upcoming.filter((u) => u.exam.date >= addDays(start, rows * 14)).length };
}

function ExamCard({ item, shown, highlight, onShowDay }: { item: Upcoming; shown: boolean; highlight: boolean; onShowDay: () => void }) {
  const w = useWilma();
  const { child, exam, lesson, from } = item;
  const days = daysBetween(today(), exam.date);
  const time = exam.time ? (lesson && lesson.start === exam.time ? `${lesson.start}–${lesson.end}` : exam.time) : lesson ? `${lesson.start}–${lesson.end}` : null;
  const teacher = exam.teacher || lesson?.teacher;
  const code = exam.teacherCode || lesson?.teacherCode;
  return (
    <article className={`card exam-card c${child.color % 16}${days <= 1 ? " soon" : ""}${shown || highlight ? " shown" : ""}`} data-exam={examKey(child.number, exam)} data-exam-date={exam.date}>
      <div className="exam-when">
        <span className="exam-count">{countdown(exam.date)}</span>
        <span className="exam-day">{dayNameLong(exam.date)}</span>
        <span className="exam-date">{shortDate(exam.date)}</span>
        {time ? <span className="exam-time">{time}</span> : null}
      </div>
      <div className="exam-body">
        <div className="exam-title">
          <Tab child={child} full />
          <h3>{w(exam.subject || exam.name)}</h3>
        </div>
        {exam.name && exam.name !== exam.subject ? <p className="exam-name">{w(exam.name)}</p> : null}
        <div className="exam-meta">
          {lesson?.room ? <span>{t("Room {room}", { room: lesson.room })}</span> : null}
          {teacher ? <span>{teacher}</span> : null}
        </div>
        {from ? (
          <div className="exam-from">
            <span>{from.kind === "note" ? t("From a teacher's note; Wilma's exam list doesn't have it.") : t("From a message; Wilma's exam list doesn't have it.")}</span>
            <blockquote>{w(from.quote)}</blockquote>
          </div>
        ) : exam.topic ? (
          <div className="exam-topic">
            <Linked text={w(exam.topic)} />
          </div>
        ) : (
          <p className="exam-none">{t("The teacher hasn't written what it covers.")}</p>
        )}
        <div className="exam-actions">
          <button className="btn btn-sm" onClick={onShowDay}>
            <Icon name="week" /> {t("Show the day")}
          </button>
          {from ? (
            <button className="btn btn-quiet btn-sm" onClick={() => go(from.kind === "note" ? "notes" : "inbox", from.key)}>
              <Icon name={from.kind === "note" ? "note" : "message"} /> {from.kind === "note" ? t("Open the note") : t("Open the message")}
            </button>
          ) : (
            <button className="btn btn-quiet btn-sm" onClick={() => go("inbox", `new:${child.number}${code ? `:${code}` : ""}`)}>
              <Icon name="pen" /> {teacher ? t("Message {name}", { name: teacher.split(" ")[0] }) : t("Message the teacher")}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
