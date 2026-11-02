/*
 * Homework for the children shown, made to glance at:
 *  - What was given today (the evening question "did you get homework?").
 *  - The two weeks' school days as a strip (as in Exams): each day with the
 *    subjects that have homework due, per child; today ringed. A day opens
 *    right under the strip: the subjects that day (what to pack) and one
 *    line per homework. The next school day is open to begin with.
 *  - Then every homework coming up, by the day it's due.
 *  - By subject instead: a matrix per child, a row per subject, a column
 *    per school day of the same two weeks: a dot for a lesson, a mark for
 *    homework due, and what the next task is.
 * A line opens the whole text beside the page. Instructions teachers add
 * for pupils who missed the lesson ("POISSAOLIJAT …") are folded away,
 * unless the notes say the child was away that day.
 */
import { useCallback, useState } from "react";
import type { ScheduleLesson } from "@wilma-client/src/core";
import type { HomeworkItem } from "@wilma-client/src/types";
import { setHomework, useApp } from "../data/store";
import { absentWhenGiven, courseKey, dueHomework, homeworkKey, homeworkParts, isForChild, sameCourse, useHomeworkJudged, type HomeworkJudged, type HomeworkParts } from "../data/homework";
import { bringFor, knownLessons, lessonKey } from "../data/schedule";
import { addDays, dayName, dayWithDate, minutes, mondayOf, nowMinutes, shortDate, today, weekday } from "../data/dates";
import type { Child, ChildData } from "../data/model";
import { DetailsPanel } from "./Details";
import { DayPanel, type DayFocus } from "./DayPanel";
import { DayStrip } from "./DayStrip";
import { Icon, Tab } from "./bits";
import { go, homeworkBySubject as bySubjectView, shortLabel, tSense, useChildFilter } from "./shared";
import { plural, t } from "../i18n";
import { useWilma } from "../data/phrases";

/** One homework with what the app knows about it: what its text says, and whether it's something this child has to do. */
type Hw = { child: Child; item: HomeworkItem; due: ScheduleLesson | null; parts: HomeworkParts; task: boolean };

const hwOf = (child: Child, data: ChildData | undefined, item: HomeworkItem, due: ScheduleLesson | null, judged: HomeworkJudged): Hw => ({
  child,
  item,
  due,
  parts: homeworkParts(item, judged),
  task: isForChild(data, item, judged),
});

/** The ten school days of this week and next. */
function twoWeeks(): string[] {
  const monday = mondayOf(today());
  return [0, 1, 2, 3, 4, 7, 8, 9, 10, 11].map((i) => addDays(monday, i));
}

/** The day to show first: today in the morning, else the next school day ("homework for tomorrow?"). */
function firstDay(days: string[]): string {
  const now = today();
  if (weekday(now) < 5 && nowMinutes() < 12 * 60) return now;
  return days.find((d) => d > now) ?? days[days.length - 1];
}

/** The task without instructions for pupils who were away; what's left when only those were given. */
function shortTask(hw: Hw, data: ChildData | undefined): { text: string; folded: boolean } {
  const { main, absentees } = hw.parts;
  if (!absentees || absentWhenGiven(data, hw.item)) return { text: hw.item.homework, folded: false };
  return { text: main || t("Only instructions for pupils who were away"), folded: true };
}

export function Homework() {
  const w = useWilma();
  const snap = useApp((s) => s.snapshot)!;
  const { selected } = useChildFilter();
  const children = snap.children.filter((c) => !selected.length || selected.includes(c.number));
  const bySubject = bySubjectView.use();
  const days = twoWeeks();
  const [day, setDay] = useState<string | null>(() => firstDay(days));
  const [open, setOpen] = useState<Hw | null>(null);
  const [focus, setFocus] = useState<DayFocus | null>(null);
  const closeAll = useCallback(() => {
    setOpen(null);
    setFocus(null);
  }, []);

  const judged = useHomeworkJudged();
  // Everything the app knows, with the lesson each is due (its course's next lesson after it was set). "No homework"
  // stays here (given today, a subject's history), so a misreading shows and can be set right; it's due nowhere.
  const all: Hw[] = children.flatMap((child) => {
    const data = snap.perChild[child.number];
    const lessons = knownLessons(data).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    return (data?.overview?.homework ?? []).map((item) => hwOf(child, data, item, lessons.find((l) => l.date > item.date && sameCourse(l, item)) ?? null, judged));
  });
  const dueOn = new Map<string, Hw[]>();
  for (const child of children) {
    const data = snap.perChild[child.number];
    for (const h of dueHomework(data, knownLessons(data), days, judged)) {
      dueOn.set(h.lesson.date, [...(dueOn.get(h.lesson.date) ?? []), hwOf(child, data, h.item, h.lesson, judged)]);
    }
  }
  const givenToday = all.filter((h) => h.item.date === today());
  const show = (hw: Hw) => {
    setFocus(null);
    setOpen(hw);
  };

  return (
    <main className="page homework-page">
      <div className="week-head">
        <h1>{tSense("Homework", "nav")}</h1>
        <span style={{ flex: 1 }} />
        <div className="seg-toggle" role="group" aria-label={t("Show")}>
          <button type="button" aria-pressed={!bySubject} onClick={() => bySubjectView.set(false)}>
            {t("By day")}
          </button>
          <button type="button" aria-pressed={bySubject} onClick={() => bySubjectView.set(true)}>
            {t("By subject")}
          </button>
        </div>
      </div>

      <section className="card hw-given">
        <span className="hw-given-head">{t("Given today")}</span>
        {children.map((child) => {
          const mine = givenToday.filter((h) => h.child === child);
          return (
            <span className="hw-given-kid" key={child.number}>
              {children.length > 1 ? <Tab child={child} /> : null}
              {mine.length ? (
                mine.map((h, i) => (
                  <button type="button" key={i} className={`hw-chip${h.task ? "" : " none"}`} onClick={() => show(h)}>
                    {w(h.item.subject)}
                    {h.task ? null : <small> · {t("no homework")}</small>}
                  </button>
                ))
              ) : (
                <span className="ov-none">{t("Nothing")}</span>
              )}
            </span>
          );
        })}
      </section>

      {bySubject ? (
        <BySubject
          children={children}
          days={days}
          dueOn={dueOn}
          onOpen={show}
          onLesson={(child, lesson) => {
            setOpen(null);
            setFocus({ child, date: lesson.date, lesson: lessonKey(lesson) });
          }}
        />
      ) : (
        <>
          <DayStrip
            start={days[0]}
            rows={1}
            chips={(d) =>
              (dueOn.get(d) ?? []).map((h, i) => (
                <i key={i} className={`c${h.child.color % 16}`}>
                  {children.length > 1 ? `${shortLabel(h.child)} ${subjectShort(h)}` : subjectShort(h)}
                </i>
              ))
            }
            canOpen={() => true}
            describe={(d) => {
              const items = dueOn.get(d) ?? [];
              return items.length ? items.map((h) => `${h.child.first}, ${w(h.item.subject)}`).join("; ") : t("No homework due.");
            }}
            picked={day}
            onPick={setDay}
            renderDay={(d) => <DayCard day={d} children={children} due={dueOn.get(d) ?? []} onOpen={show} />}
          />
          <UpcomingList children={children} days={days} dueOn={dueOn} onOpen={show} />
        </>
      )}

      {open ? (
        <HomeworkPanel
          hw={open}
          history={all.filter((h) => h.child === open.child && courseKey(h.item.subjectCode || h.item.subject) === courseKey(open.item.subjectCode || open.item.subject))}
          onOpen={show}
          onShowDay={(lesson) => {
            setOpen(null);
            setFocus({ child: open.child, date: lesson.date, lesson: lessonKey(lesson) });
          }}
          onClose={closeAll}
        />
      ) : focus ? (
        <DayPanel focus={focus} onFocus={setFocus} onClose={closeAll} />
      ) : null}
    </main>
  );
}

/** A homework's subject, short: its course code as Wilma's timetable shows it ("MA", "ENA1"), else the start of the subject's name. */
const subjectShort = (hw: Hw) => courseKey(hw.item.subjectCode || hw.due?.subjectCode || "") || hw.item.subject.slice(0, 4);

/** Every homework coming up in the two weeks, by the day it's due, the whole task at a glance (two lines). */
function UpcomingList({ children, days, dueOn, onOpen }: { children: Child[]; days: string[]; dueOn: Map<string, Hw[]>; onOpen: (hw: Hw) => void }) {
  const w = useWilma();
  const snap = useApp((s) => s.snapshot)!;
  const now = today();
  const ahead = days.filter((d) => d >= now && (dueOn.get(d) ?? []).length);
  return (
    <section className="section hw-upcoming">
      <h2 className="eyebrow">{t("Homework coming up")}</h2>
      {ahead.length ? (
        <div className="card hw-up">
          {ahead.map((d) => (
            <div className="hw-up-day" key={d}>
              <h3>{dayWithDate(d)}</h3>
              <ul className="hw-lines">
                {dueOn.get(d)!.map((h, i) => {
                  const task = shortTask(h, snap.perChild[h.child.number]);
                  return (
                    <li key={i}>
                      <button type="button" onClick={() => onOpen(h)}>
                        <b>
                          {children.length > 1 ? <Tab child={h.child} /> : null} {w(h.item.subject)}
                        </b>
                        <span className="hw-line-text two">
                          <span>{w(task.text)}</span>
                        </span>
                        {task.folded ? <span className="hw-tag">{t("+ for pupils who were away")}</span> : <span />}
                        <Icon name="right" className="icon hw-go" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="ov-none">{t("No homework due.")}</p>
      )}
    </section>
  );
}

/** One school day: per child, the subjects (what to pack) and one line per homework due. */
function DayCard({ day, children, due, onOpen }: { day: string; children: Child[]; due: Hw[]; onOpen: (hw: Hw) => void }) {
  const w = useWilma();
  const snap = useApp((s) => s.snapshot)!;
  const bring = useApp((s) => s.local.bring);
  const summary = children.map((c) => {
    const n = due.filter((h) => h.child === c).length;
    return n ? t("{name}: {n}", { n, name: c.first }) : t("{name}: none", { name: c.first });
  });
  return (
    <section className="card hw-day">
      <div className="hw-day-head">
        <h2>{dayWithDate(day)}</h2>
        <span className="ov-none">{children.length > 1 ? summary.join(" · ") : due.length ? plural(due.length, "{n} homework task", "{n} homework tasks") : t("No homework due.")}</span>
      </div>
      {children.map((child) => {
        const data = snap.perChild[child.number];
        const lessons = knownLessons(data)
          .filter((l) => l.date === day)
          .sort((a, b) => minutes(a.start) - minutes(b.start));
        if (!lessons.length) return null;
        const books = [...new Set(lessons.filter((l) => bringFor(l, bring)).map((l) => l.subject))];
        const mine = due.filter((h) => h.child === child);
        return (
          <div className="hw-kid" key={child.number}>
            {children.length > 1 ? <Tab child={child} full /> : null}
            <p className="hw-books">
              <span>{t("Bring")}</span> {books.join(" · ")}
            </p>
            {mine.length ? (
              <ul className="hw-lines">
                {mine.map((h, i) => {
                  const task = shortTask(h, data);
                  return (
                    <li key={i}>
                      <button type="button" onClick={() => onOpen(h)}>
                        <b>{w(h.item.subject)}</b>
                        <span className="hw-line-text two">
                          <span>{w(task.text)}</span>
                        </span>
                        {task.folded ? <span className="hw-tag">{t("+ for pupils who were away")}</span> : <span />}
                        <Icon name="right" className="icon hw-go" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="ov-none">{t("No homework due.")}</p>
            )}
          </div>
        );
      })}
    </section>
  );
}

/**
 * A matrix per child: a row per subject on the timetable these two weeks, a
 * column per school day (today marked). A dot is a lesson; a filled mark is
 * homework due for it. The last column says what the next task is. A mark or
 * the task opens it beside the page.
 */
function BySubject({
  children,
  days,
  dueOn,
  onOpen,
  onLesson,
}: {
  children: Child[];
  days: string[];
  dueOn: Map<string, Hw[]>;
  onOpen: (hw: Hw) => void;
  onLesson: (child: Child, lesson: ScheduleLesson) => void;
}) {
  const w = useWilma();
  const snap = useApp((s) => s.snapshot)!;
  const bring = useApp((s) => s.local.bring);
  const now = today();
  return (
    <>
      <p className="hwm-explain">{t("A mark is the lesson a homework is for; a dot is a lesson. A mark opens the homework, a dot the day.")}</p>
      {children.map((child) => {
        const data = snap.perChild[child.number];
        const keyOf = (l: ScheduleLesson) => courseKey(l.subjectCode || "") || l.subject.trim().toLowerCase();
        // Each row: the subject's lessons by day (the first that day) and the homework due.
        const rows = new Map<string, { name: string; lessons: Map<string, ScheduleLesson>; due: Hw[] }>();
        for (const l of [...knownLessons(data)].sort((a, b) => a.start.localeCompare(b.start))) {
          if (!days.includes(l.date) || !bringFor(l, bring)) continue;
          const row = rows.get(keyOf(l)) ?? { name: l.subject, lessons: new Map<string, ScheduleLesson>(), due: [] };
          if (!row.lessons.has(l.date)) row.lessons.set(l.date, l);
          rows.set(keyOf(l), row);
        }
        const due = days.flatMap((d) => (dueOn.get(d) ?? []).filter((h) => h.child === child && h.due));
        for (const h of due) {
          const row = rows.get(keyOf(h.due!)) ?? { name: h.due!.subject, lessons: new Map<string, ScheduleLesson>([[h.due!.date, h.due!]]), due: [] };
          row.due.push(h);
          rows.set(keyOf(h.due!), row);
        }
        const list = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, "fi"));
        const ahead = due.filter((h) => h.due!.date >= now).length;
        return (
          <section className={`card hwm c${child.color % 16}`} key={child.number}>
            <div className="hwm-head">
              <Tab child={child} full />
              <span className="ov-none">{ahead ? t("{n} coming up", { n: plural(ahead, "{n} homework task", "{n} homework tasks") }) : t("No homework due.")}</span>
              <span className="hwm-key">
                <span className="hwm-cell lesson" /> {t("lesson")}
                <span className="hwm-cell due">
                  <i />
                </span>{" "}
                {t("homework due")}
              </span>
            </div>
            {list.length ? (
              <div className="hwm-grid" role="table" aria-label={t("Homework by subject and day")}>
                <div className="hwm-row hwm-th" role="row">
                  <span role="columnheader" />
                  {days.map((d, i) => (
                    <span role="columnheader" key={d} className={`hwm-day${d === now ? " today" : ""}${d < now ? " past" : ""}${i === 5 ? " next-week" : ""}`}>
                      <small>{dayName(d)}</small>
                      <b>{Number(d.slice(8))}</b>
                    </span>
                  ))}
                  <span role="columnheader" className="hwm-next-h">{t("Next task")}</span>
                </div>
                {list.map((row) => {
                  const next = row.due.filter((h) => h.due!.date >= now).sort((a, b) => a.due!.date.localeCompare(b.due!.date))[0];
                  return (
                    <div className="hwm-row" role="row" key={row.name}>
                      <span role="rowheader" className="hwm-subject">
                        {w(row.name)}
                      </span>
                      {days.map((d, i) => {
                        const here = row.due.filter((h) => h.due!.date === d);
                        const cls = `hwm-cell${d === now ? " today" : ""}${d < now ? " past" : ""}${i === 5 ? " next-week" : ""}`;
                        return here.length ? (
                          <button
                            type="button"
                            role="cell"
                            key={d}
                            className={`${cls} due`}
                            onClick={() => onOpen(here[0])}
                            aria-label={t("{subject}, homework for {day}", { subject: w(row.name), day: dayWithDate(d) })}
                          >
                            <i>{here.length > 1 ? here.length : ""}</i>
                          </button>
                        ) : row.lessons.has(d) ? (
                          // A lesson that day: its day opens beside the page (time, room, teacher, homework).
                          <button
                            type="button"
                            role="cell"
                            key={d}
                            className={`${cls} lesson`}
                            onClick={() => onLesson(child, row.lessons.get(d)!)}
                            aria-label={t("{subject} on {day}: show the day", { subject: w(row.name), day: dayWithDate(d) })}
                          />
                        ) : (
                          <span role="cell" key={d} className={cls} />
                        );
                      })}
                      {next ? (
                        <button type="button" role="cell" className="hwm-next" onClick={() => onOpen(next)}>
                          <span>{w(shortTask(next, data).text)}</span>
                        </button>
                      ) : (
                        <span role="cell" className="hwm-next none" />
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="ov-none">{t("No lessons or homework these two weeks.")}</p>
            )}
          </section>
        );
      })}
    </>
  );
}

/** A homework in full, beside the page: the task, the part for pupils who were away (folded), when, and the teacher. */
function HomeworkPanel({ hw, history, onOpen, onShowDay, onClose }: { hw: Hw; history: Hw[]; onOpen: (hw: Hw) => void; onShowDay: (lesson: ScheduleLesson) => void; onClose: () => void }) {
  const w = useWilma();
  const data = useApp((s) => s.snapshot?.perChild[hw.child.number]);
  // Read live, not from the list's copy: the parent's word below changes it.
  const { main, absentees, forClass, from } = homeworkParts(hw.item, useHomeworkJudged());
  const away = absentWhenGiven(data, hw.item);
  const [showAbsentees, setShowAbsentees] = useState(false);
  const now = today();
  return (
    <DetailsPanel
      title={
        <>
          <Tab child={hw.child} full />
          <span>{tSense("Homework", "nav")}</span>
        </>
      }
      onClose={onClose}
    >
      <h2 className="details-title">{w(hw.item.subject)}</h2>
      <p className="lesson-sub">
        {hw.due ? (hw.due.date >= now ? t("For {day}", { day: dayWithDate(hw.due.date) }) : t("Was for {day}", { day: shortDate(hw.due.date) })) : null}
        {hw.due ? " · " : ""}
        {t("set {day}", { day: shortDate(hw.item.date) })}
      </p>
      <div className="hw-full">{absentees && !away ? w(main) || t("Only instructions for pupils who were away") : w(hw.item.homework)}</div>
      {absentees && !away ? (
        <div className="hw-absentees">
          <button type="button" className="linkish" onClick={() => setShowAbsentees(!showAbsentees)}>
            {showAbsentees ? t("Hide the instructions for pupils who were away") : t("Instructions for pupils who were away")}
          </button>
          {showAbsentees ? <div className="hw-full muted">{w(absentees)}</div> : null}
        </div>
      ) : away && absentees ? (
        <p className="hw-away">{t("{name} was away from that lesson, so the instructions for pupils who were away apply too.", { name: hw.child.first })}</p>
      ) : null}
      <label className="dp-counts hw-for-class">
        <input type="checkbox" checked={forClass} onChange={(e) => setHomework(homeworkKey(hw.item), e.target.checked)} />
        <span>
          <b>{t("Homework for the class")}</b>
          <small>
            {from === "parent" ? t("You set this for this homework.") : from === "ai" ? t("The AI read this from the text; change it if it's wrong.") : t("Going by the text's words; change it if it's wrong.")}
            {from === "parent" ? (
              <>
                {" "}
                <button type="button" className="linkish" onClick={(e) => (e.preventDefault(), setHomework(homeworkKey(hw.item), null))}>
                  {t("Undo")}
                </button>
              </>
            ) : null}
          </small>
        </span>
      </label>
      <div className="dp-actions">
        {hw.due ? (
          <button className="btn btn-sm" onClick={() => onShowDay(hw.due!)}>
            <Icon name="week" /> {t("Show the day")}
          </button>
        ) : null}
        <button className="btn btn-sm" onClick={() => go("inbox", `new:${hw.child.number}:${encodeURIComponent(hw.item.teacherCode || hw.item.teacher)}:${encodeURIComponent(`${hw.item.subject}: läksy`)}`)}>
          <Icon name="pen" /> {hw.item.teacher ? t("Message {name}", { name: hw.item.teacher.split(" ")[0] }) : t("Message the teacher")}
        </button>
      </div>
      {history.length > 1 ? (
        <section className="details-section">
          <h4>{t("Earlier in {subject}", { subject: hw.item.subject })}</h4>
          <ul className="ov-list">
            {history
              .filter((h) => h.item !== hw.item)
              .slice(0, 8)
              .map((h, i) => (
                <li key={i}>
                  <button type="button" onClick={() => onOpen(h)}>
                    <span className="ov-day">{shortDate(h.item.date)}</span>
                    <span />
                    <span className="ov-text">
                      <span className="ov-sub">
                        {h.task ? null : <small className="hw-none">{t("no homework")} · </small>}
                        {w(h.parts.main || h.item.homework)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </DetailsPanel>
  );
}
