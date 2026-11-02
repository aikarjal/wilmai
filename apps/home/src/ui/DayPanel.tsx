/*
 * One child's school day in the details panel, as a timeline: hours down the
 * side from 8 (or earlier), each lesson a block as long as the lesson, so a
 * late start is empty space at the top and breaks are gaps. A click on a
 * block shows that lesson under the timeline (room, teacher, the exam and
 * what it covers, homework, the teacher's notes, writing to the teacher);
 * the timeline itself never moves. With no lesson picked, the day's homework
 * shows there. Opened from the Week (a lesson in the grid), from Today (a
 * child's times, an exam, the homework) and from the Calendar (an exam or a
 * note there).
 */
import { Fragment, type ReactNode } from "react";
import type { ScheduleLesson, UpcomingExam } from "@wilma-client/src/core";
import { setBring, setLeftOut, setPE, useApp } from "../data/store";
import { dueHomework, sameCourse } from "../data/homework";
import { bringOf, dayLessons, dayTimes, examForLesson, formatMinutes, knownLessons, lessonKey, peOf, unusualDays, type SaidBy } from "../data/schedule";
import { addDays, dayWithDate, minutes, mondayOf, nowMinutes, shortDate, today } from "../data/dates";
import type { Child } from "../data/model";
import { buildFeed } from "../data/feed";
import { readExams, type CalEvent } from "../data/calendar";
import { DetailsPanel } from "./Details";
import { Icon, Tab } from "./bits";
import { examKey, go, tSense } from "./shared";
import { t } from "../i18n";
import { useWilma } from "../data/phrases";

/** Which day is shown, and the lesson picked in it (lessonKey), if any. */
export interface DayFocus {
  child: Child;
  date: string;
  lesson: string | null;
}

const HOUR_PX = 58;

/** Text with its web addresses as links (they open in the browser). */
function withLinks(text: string) {
  return text.split(/(https?:\/\/[^\s)]+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noreferrer">
        {part}
      </a>
    ) : (
      part
    )
  );
}

export function DayPanel({ focus, onFocus, onClose }: { focus: DayFocus; onFocus: (focus: DayFocus) => void; onClose: () => void }) {
  const w = useWilma();
  const snap = useApp((s) => s.snapshot);
  const jev = useApp((s) => s.jev);
  const luna = useApp((s) => s.luna);
  const local = useApp((s) => s.local);
  const data = snap?.perChild[focus.child.number];
  const { child, date } = focus;
  const all = knownLessons(data);
  const lessons = all.filter((l) => l.date === date).sort((a, b) => minutes(a.start) - minutes(b.start));
  const leftOut = local.leftOut?.[child.number];
  const times = dayTimes(dayLessons(lessons, leftOut)).get(date);
  const odd = unusualDays(data, [date], leftOut);
  const due = dueHomework(data, all, [date]);
  const picked = lessons.find((l) => lessonKey(l) === focus.lesson) ?? null;
  // A day further out (from the Calendar): until its week is read, no lessons isn't "no lessons". The sync reads this week and next.
  const monday = mondayOf(date);
  const weekKnown = monday === mondayOf(today()) || monday === addDays(mondayOf(today()), 7) || Boolean(data?.weeks?.[monday]) || all.some((l) => mondayOf(l.date) === monday);
  // An exam Wilma lists for the day that no lesson here holds (the timetable isn't out yet, or it's outside lessons).
  const loose = (data?.exams ?? []).filter((e) => e.date === date && !lessons.some((l) => examForLesson(data, l) === e));
  // A note's exam can be after school or on another day than the original lesson.
  const read = snap ? readExams(snap, buildFeed({ snapshot: snap, jev, luna, local }), luna, local.calendar, { from: date, until: date, children: [child.number] }, true) : [];

  // The scale: from 8 (or the first hour, if earlier) to 15 (or the last), so days line up and a late start shows.
  const startH = Math.min(8, ...lessons.map((l) => Math.floor(minutes(l.start) / 60)));
  const endH = Math.max(15, ...lessons.map((l) => Math.ceil(minutes(l.end) / 60)));
  const y = (time: string | number) => (((typeof time === "number" ? time : minutes(time)) - startH * 60) / 60) * HOUR_PX;
  const nowM = nowMinutes();
  const isToday = date === today();

  return (
    <DetailsPanel
      title={
        <>
          <Tab child={child} full />
          <span>{dayWithDate(date)}</span>
        </>
      }
      onClose={onClose}
    >
      <div className="dp-top">
        <div className="dp-time">{times ? `${times.start}–${times.end}` : weekKnown ? t("No lessons") : t("Timetable not read yet")}</div>
        {odd.map((u, i) =>
          u.kind === "off" ? null : (
            <span key={i} className="flag">
              {u.kind === "start"
                ? u.by! > 0
                  ? t("Starts {by} later than usual", { by: formatMinutes(u.by!) })
                  : t("Starts {by} earlier than usual", { by: formatMinutes(u.by!) })
                : u.by! > 0
                  ? t("Ends {by} later than usual", { by: formatMinutes(u.by!) })
                  : t("Ends {by} earlier than usual", { by: formatMinutes(u.by!) })}
            </span>
          )
        )}
      </div>

      {read.length ? (
        <section className="dp-read-exams" aria-label={t("Exams")}>
          {read.map((exam) => <ReadExamFacts key={exam.key} exam={exam} />)}
        </section>
      ) : null}

      {lessons.length ? (
        <div className="dp-tl" style={{ height: (endH - startH) * HOUR_PX + 12 }}>
          {Array.from({ length: endH - startH + 1 }, (_, i) => (
            <div key={i} className="dp-hour" style={{ top: i * HOUR_PX + 6 }}>
              <span>{startH + i}</span>
            </div>
          ))}
          <div className="dp-lane">
            {lessons.map((l) => {
              const key = lessonKey(l);
              const exam = examForLesson(data, l);
              const homework = due.some((h) => lessonKey(h.lesson) === key);
              const height = Math.max(22, y(l.end) - y(l.start) - 3);
              return (
                <button
                  type="button"
                  key={key}
                  className={`dp-les c${child.color % 16}${exam ? " exam" : ""}${height < 40 ? " short" : ""}${leftOut?.includes(l.subject) ? " out" : ""}`}
                  aria-pressed={focus.lesson === key}
                  style={{ top: y(l.start) + 6 + 1, height }}
                  onClick={() => onFocus({ ...focus, lesson: focus.lesson === key ? null : key })}
                  title={`${l.start}–${l.end} ${w(l.subject)}${l.room ? ` · ${l.room}` : ""}${l.teacher ? ` · ${l.teacher}` : ""}`}
                >
                  <b>
                    {w(l.subject)}
                    {exam ? <span className="dp-exam">{t("Exam")}</span> : null}
                    {homework ? <Icon name="book" className="icon dp-hw" label={t("Homework")} /> : null}
                  </b>
                  <span>
                    {l.start}–{l.end}
                    {l.room ? ` · ${l.room}` : ""}
                  </span>
                </button>
              );
            })}
            {isToday && nowM > startH * 60 && nowM < endH * 60 ? <div className="dp-now" style={{ top: y(nowM) + 6 }} /> : null}
          </div>
        </div>
      ) : (
        <p className="ov-none">{!data || !weekKnown ? t("Reading the timetable…") : t("Wilma has no lessons for this day.")}</p>
      )}

      <div className="dp-detail">
        {picked ? (
          <LessonFacts lesson={picked} child={child} />
        ) : loose.length ? (
          loose.map((exam) => <ExamFacts key={exam.examId} exam={exam} child={child} />)
        ) : due.length ? (
          <section className="details-section">
            <h4>{t("Homework for this day")}</h4>
            <ul className="ov-list">
              {due.map((h) => (
                <li key={lessonKey(h.lesson)}>
                  <button type="button" onClick={() => onFocus({ ...focus, lesson: lessonKey(h.lesson) })}>
                    <span className="ov-day">{h.lesson.start}</span>
                    <span />
                    <span className="ov-text">
                      <b>{w(h.lesson.subject)}</b>
                      <span className="ov-sub">{w(h.item.homework)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : lessons.length ? (
          <p className="ov-none">{t("Pick a lesson for its room, teacher and homework.")}</p>
        ) : null}
      </div>
    </DetailsPanel>
  );
}

/** The calendar's quoted exam instruction stays visible even when no timetable lesson holds it. */
function ReadExamFacts({ exam }: { exam: CalEvent & { origin: NonNullable<CalEvent["origin"]> } }) {
  const w = useWilma();
  const note = exam.origin.key.startsWith("note:");
  const bulletin = exam.origin.key.startsWith("n:");
  return (
    <article className="dp-read-exam">
      <h3>{w(exam.title)}<span className={`chip${exam.sure ? " chip-marker" : ""}`}>{t(exam.sure ? "Exam" : "Suggestion")}</span></h3>
      {exam.start ? <p className="dp-read-exam-time">{t("exam starts {time}", { time: exam.start })}{exam.end ? `–${exam.end}` : ""}</p> : null}
      <p className="dp-read-exam-quote">{withLinks(w(exam.origin.quote))}</p>
      <button className="btn btn-sm" onClick={() => go(note ? "notes" : "inbox", exam.origin.key)}>
        {t(note ? "Open the note" : bulletin ? "Open the bulletin" : "Open the message")}
      </button>
    </article>
  );
}

/** An exam on the day that no lesson holds, as a lesson's exam shows: when, the teacher, what it covers. */
function ExamFacts({ exam, child }: { exam: UpcomingExam; child: Child }) {
  const w = useWilma();
  return (
    <section className="dp-facts">
      <h3>
        {w(exam.name || exam.subject)}
        <span className="chip chip-marker">{t("Exam")}</span>
      </h3>
      {exam.name && exam.name !== exam.subject ? <p className="lesson-sub">{w(exam.subject)}</p> : null}
      <dl className="lesson-facts">
        {exam.time ? (
          <>
            <dt>{t("When")}</dt>
            <dd>{t("exam starts {time}", { time: exam.time })}</dd>
          </>
        ) : null}
        {exam.teacher ? (
          <>
            <dt>{t("Teacher")}</dt>
            <dd>{exam.teacher}</dd>
          </>
        ) : null}
      </dl>
      <div className="dp-exam-topic">
        <span className="dp-label">{t("Covers")}</span>
        {exam.topic ? <div className="lesson-topic clamped">{withLinks(w(exam.topic))}</div> : <p className="exam-none">{t("The teacher hasn't written what it covers.")}</p>}
      </div>
      <div className="dp-actions">
        <button className="btn btn-sm btn-primary" onClick={() => go("exams", examKey(child.number, exam))}>
          <Icon name="exam" /> {t("Open in Exams")}
        </button>
        <button className="btn btn-sm" onClick={() => go("inbox", `new:${child.number}${exam.teacherCode ? `:${exam.teacherCode}` : ""}`)}>
          <Icon name="pen" /> {exam.teacher ? t("Message {name}", { name: exam.teacher.split(" ")[0] }) : t("Message the teacher")}
        </button>
      </div>
    </section>
  );
}

/** One lesson's details under the timeline. */
function LessonFacts({ lesson, child }: { lesson: ScheduleLesson; child: Child }) {
  const w = useWilma();
  const data = useApp((s) => s.snapshot?.perChild[child.number]);
  const all = knownLessons(data);
  const exam = examForLesson(data, lesson);
  const homework = dueHomework(data, all, [lesson.date]).find((h) => lessonKey(h.lesson) === lessonKey(lesson))?.item ?? null;
  const given = (data?.overview?.homework ?? []).find((hw) => hw.date === lesson.date && sameCourse(lesson, hw)) ?? null;
  // The teacher's notes on this lesson ("Rästikoe klo 15.20", an absence), from the sync's weeks or the year's list.
  const notes = [...(data?.notes ?? []), ...(data?.yearNotes?.notes ?? [])]
    .filter((n) => n.date === lesson.date && (n.start ? n.start === lesson.start : n.subject === lesson.subject))
    .filter((n, i, all) => all.findIndex((m) => m.typeLabel === n.typeLabel && (m.note ?? "") === (n.note ?? "")) === i);
  const teacher = exam?.teacher || lesson.teacher;
  const code = exam?.teacherCode || lesson.teacherCode;
  return (
    <section className="dp-facts">
      <h3>
        {w(exam?.name || lesson.subject)}
        {exam ? <span className="chip chip-marker">{t("Exam")}</span> : null}
      </h3>
      {exam?.name && exam.name !== lesson.subject ? <p className="lesson-sub">{w(lesson.subject)}</p> : null}
      <dl className="lesson-facts">
        <dt>{t("When")}</dt>
        <dd>
          {lesson.start}–{lesson.end}
          {exam?.time ? ` · ${t("exam starts {time}", { time: exam.time })}` : null}
        </dd>

        {lesson.room ? (
          <>
            <dt>{t("Room")}</dt>
            <dd>{lesson.room}</dd>
          </>
        ) : null}
        {teacher ? (
          <>
            <dt>{t("Teacher")}</dt>
            <dd>{teacher}</dd>
          </>
        ) : null}
        {homework ? (
          <>
            <dt>{t("Homework")}</dt>
            <dd>
              {w(homework.homework)}
              <small> · {t("set {day}", { day: shortDate(homework.date) })}</small>
            </dd>
          </>
        ) : null}
        {given && given !== homework ? (
          <>
            <dt>{t("Given")}</dt>
            <dd>{w(given.homework)}</dd>
          </>
        ) : null}
        {notes.map((n, i) => (
          <Fragment key={i}>
            <dt>{tSense("Note", "lesson")}</dt>
            <dd>
              <b>{w(n.typeLabel)}</b>
              {n.note ? `: ${w(n.note)}` : null}
              {n.teacher && n.teacher !== teacher ? <small> · {n.teacher}</small> : null}
            </dd>
          </Fragment>
        ))}
      </dl>
      {exam ? (
        // What it covers, the full width of the panel and shortened; the whole of it is in Exams.
        <div className="dp-exam-topic">
          <span className="dp-label">{t("Covers")}</span>
          {exam.topic ? <div className="lesson-topic clamped">{withLinks(w(exam.topic))}</div> : <p className="exam-none">{t("The teacher hasn't written what it covers.")}</p>}
        </div>
      ) : null}
      <div className="dp-actions">
        {exam ? (
          <button className="btn btn-sm btn-primary" onClick={() => go("exams", examKey(child.number, exam))}>
            <Icon name="exam" /> {t("Open in Exams")}
          </button>
        ) : null}
        <button className="btn btn-sm" onClick={() => go("inbox", `new:${child.number}${code ? `:${code}` : ""}`)}>
          <Icon name="pen" /> {teacher ? t("Message {name}", { name: teacher.split(" ")[0] }) : t("Message the teacher")}
        </button>
      </div>
      <SchoolDaySwitch lesson={lesson} child={child} />
      <PESwitch lesson={lesson} />
      <BringSwitch lesson={lesson} />
    </section>
  );
}

/**
 * Whether the lesson's subject counts in the child's school hours. An optional lesson (remedial teaching, a club)
 * can be left out: it stays in the timetable, and the day's start and finish, the usual week and the times the
 * children start or finish together go by the other lessons.
 */
function SchoolDaySwitch({ lesson, child }: { lesson: ScheduleLesson; child: Child }) {
  const w = useWilma();
  const out = useApp((s) => Boolean(s.local.leftOut?.[child.number]?.includes(lesson.subject)));
  return (
    <label className="dp-counts">
      <input type="checkbox" checked={!out} onChange={(e) => setLeftOut(child.number, lesson.subject, !e.target.checked)} />
      <span>
        <b>{t("Counts in the school day")}</b>
        <small>{t("Untick it for an optional lesson, such as remedial teaching or a club: the day's start and finish then leave {subject} out, here and in the usual week.", { subject: w(lesson.subject) })}</small>
      </span>
    </label>
  );
}

/**
 * Whether the subject is PE (a shirt on its days in the week and on the fridge sheet), and who said so: the AI, which
 * reads each subject's name; without the AI, the name's usual words; the parent, whose word wins and can be undone.
 */
function PESwitch({ lesson }: { lesson: ScheduleLesson }) {
  const { pe, from } = peOf(lesson, useApp((s) => s.local.pe));
  return (
    <SubjectSwitch lesson={lesson} on={pe} from={from} set={setPE}>
      <Icon name="shirt" className="icon dp-shirt" /> {t("PE: pack the gym kit")}
    </SubjectSwitch>
  );
}

/** Whether the child packs for the subject (its books, materials or kit: the Bring line in Homework), and who said so, as for PE. */
function BringSwitch({ lesson }: { lesson: ScheduleLesson }) {
  const { bring, from } = bringOf(lesson, useApp((s) => s.local.bring));
  return (
    <SubjectSwitch lesson={lesson} on={bring} from={from} set={setBring}>
      {t("On the Bring line in Homework")}
    </SubjectSwitch>
  );
}

/** A yes or no about every lesson of a subject, with who said so; the parent's word can be undone. */
function SubjectSwitch({ lesson, on, from, set, children }: { lesson: ScheduleLesson; on: boolean; from: SaidBy; set: (subject: string, value: boolean | null) => void; children: ReactNode }) {
  const w = useWilma();
  const said = from === "parent" ? t("You set this for every {subject} lesson.", { subject: w(lesson.subject) }) : from === "ai" ? t("The AI read this from the subject's name; change it if it's wrong.") : t("Going by the subject's name; change it if it's wrong.");
  return (
    <label className="dp-counts">
      <input type="checkbox" checked={on} onChange={(e) => set(lesson.subject, e.target.checked)} />
      <span>
        <b>{children}</b>
        <small>
          {said}
          {from === "parent" ? (
            <>
              {" "}
              <button type="button" className="linkish" onClick={(e) => (e.preventDefault(), set(lesson.subject, null))}>
                {t("Undo")}
              </button>
            </>
          ) : null}
        </small>
      </span>
    </label>
  );
}
