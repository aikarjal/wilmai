/*
 * Today: what a parent looks at in the morning or the evening before.
 *
 * 1. School days: each child's today and next school day, start to end,
 *    what's different (a later start, an exam, an event that day), and only
 *    whether there's homework, not what it is. Report an absence or write to
 *    a teacher from here.
 * 2. Needs you: the top three, one line each with the deadline.
 * 3. Recent notes: the teachers' lesson notes from the last three school
 *    days, the new ones marked (an absence to explain is under Needs you).
 * 4. Recent results: exam grades from the last three weeks, the new ones
 *    marked (not yet seen in Wilma or here).
 * 5. This week and next: exams, events and deadlines, schedule changes,
 *    always all three, the same as the Week's overview.
 */
import { useCallback, useMemo, useState, useEffect } from "react";
import { absenceDay, isDemo, prepareAbsenceReport, preparedAgain, sendAbsenceReport, SESSION_CHANGED_NOTE } from "../data/engine";
import { loginOfChild } from "../data/logins";
import type { AbsenceReportForm as AbsenceForm } from "@wilma-client/src/write";
import { markOpened, useApp, useViewer } from "../data/store";
import { agenda, examsNeedingAttention, forChildren, isNeedsYou, needsYou, type AgendaEntry, type FeedItem } from "../data/feed";
import { intelligenceOn, type Child, type Snapshot } from "../data/model";
import type { ScheduleLesson, UpcomingExam } from "@wilma-client/src/core";
import { dueHomework, type DueHomework } from "../data/homework";
import { dayLessons, dayTimes, examForLesson, formatMinutes, knownLessons, lessonKey, subjectNamer, unusualDays, type DayTimes, type UnusualDay } from "../data/schedule";
import { addDays, dayNameLong, daysBetween, dayWithDate, isoWeek, longDate, minutes, mondayOf, nowMinutes, relativeDay, shortDate, today, weekday } from "../data/dates";
import { noteKind, useNoteKinds } from "../data/notes";
import { readExamEntries } from "../data/calendar";
import { language, plural, t, tx } from "../i18n";
import { Icon, Mark, Tab, Tabs } from "./bits";
import { takePendingAbsence } from "./CommandMenu";
import { toggleDoneWithUndo } from "./done";
import { go, hrefFor, itemHref, setSegment, tSense, urgencyLabel, useChildFilter } from "./shared";
import { Glance } from "./Glance";
import { DayPanel, type DayFocus } from "./DayPanel";
import { examResults, isNewResult, resultKey } from "../data/grades";
import { examMark, markKey, markShade } from "../data/marks";
import { AIBudgetWarning } from "./AIBudgetWarning";
import { OpenAIBlocked } from "./OpenAIBlocked";
import { useListed } from "../data/translations";
import { useWilma } from "../data/phrases";

/** The next school day (Mon–Fri) after a date. */
function nextSchoolDay(iso: string): string {
  let d = addDays(iso, 1);
  while (weekday(d) > 4) d = addDays(d, 1);
  return d;
}

export function Today({ feed }: { feed: FeedItem[] }) {
  const w = useWilma();
  const snap = useApp((s) => s.snapshot)!;
  const settings = useApp((s) => s.settings);
  const jevStatus = useApp((s) => s.jevStatus);
  const { selected } = useChildFilter();
  const now = today();
  const items = useMemo(() => forChildren(feed, selected), [feed, selected]);
  const jevOn = intelligenceOn(settings);
  const needs = needsYou(items);
  const pupilExams = examsNeedingAttention(items, now);
  // Without Jev, nothing is sorted: the newest unread instead (besides what Wilma's own data says needs doing).
  const fresh = jevOn || needs.length ? [] : items.filter((i) => i.isNew && !i.done && i.kind !== "note").slice(0, 3);
  const luna = useApp((s) => s.luna);
  const local = useApp((s) => s.local.calendar);
  // What's coming, with the exams read from messages and teachers' notes too (as the calendar shows them).
  const coming = [...agenda(snap, items, selected), ...readExamEntries(snap, items, luna, local, { from: now, until: addDays(now, 21), children: selected })].sort((a, b) =>
    (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? ""))
  );
  const children = snap.children.filter((c) => !selected.length || selected.includes(c.number));
  const next = nextSchoolDay(now);
  const monday = mondayOf(now);
  const twoWeeks = [0, 1, 2, 3, 4, 7, 8, 9, 10, 11].map((i) => addDays(monday, i));
  // A child's day beside the page: from their times, an exam or the homework.
  const [focus, setFocus] = useState<DayFocus | null>(null);
  const closeDay = useCallback(() => setFocus(null), []);

  return (
    <main className="page today">
      <AIBudgetWarning />
      <OpenAIBlocked where="today" />
      <div className="hello">
        <div>
          <h1>{dayNameLong(now)}</h1>
          <div className="sub">
            {longDate(now)} · {t("week {n}", { n: isoWeek(now) })}
          </div>
        </div>
        <Summary needs={jevOn || needs.length || pupilExams.length ? needs.length + pupilExams.length : null} coming={coming} snap={snap} />
      </div>

      <section className="card school-days" aria-label={t("School days")}>
        <div className="sd-head">
          <span />
          <span>{dayWithDate(now)}</span>
          <span>{dayWithDate(next)}</span>
        </div>
        {children.map((child) => (
          <ChildDays key={child.number} child={child} snap={snap} items={items} dates={[now, next]} focus={focus} onOpen={setFocus} />
        ))}
      </section>
      {focus ? <DayPanel focus={focus} onFocus={setFocus} onClose={closeDay} /> : null}

      <div className="today-cols">
        <div className="section">
          {needs.length || fresh.length || !pupilExams.length ? <h2 className="eyebrow" id="needs-h">
            {fresh.length ? t("New") : t("Needs you")} <span className="count">{needs.length || ""}</span>
          </h2> : null}
          {needs.length || fresh.length ? (
            <div className="card needs" aria-labelledby="needs-h">
              {(needs.length ? needs : fresh).slice(0, 3).map((item) => (
                <NeedLine key={item.key} item={item} snap={snap} marked={needs.length > 0} />
              ))}
              {needs.length > 3 ? (
                <button
                  type="button"
                  className="linkish needs-more"
                  onClick={() => {
                    setSegment("needs");
                    go("inbox");
                  }}
                >
                  {t("{n} more in Messages", { n: needs.length - 3 })} →
                </button>
              ) : null}
            </div>
          ) : jevStatus.running ? (
            <div className="empty">
              <Icon name="spark" />
              <p>{t("The AI is reading the newest messages…")}</p>
            </div>
          ) : !pupilExams.length ? (
            <CaughtUp />
          ) : null}
          {!jevOn ? (
            <p className="jev-hint">
              {t("Enable AI in Settings to read new messages for you: what needs you, by when, and what's just for information.")}{" "}
              <button type="button" className="linkish" onClick={() => go("settings")}>
                {t("Choose AI")}
              </button>
            </p>
          ) : null}
          {pupilExams.length ? (
            <section className="section" aria-labelledby="pupil-exams-h">
              <h2 className="eyebrow" id="pupil-exams-h">{t("Make-up exams")} <span className="count">{pupilExams.length}</span></h2>
              <div className="card needs">
                {pupilExams.map((item) => (
                  <a className="need" key={item.key} href={itemHref(item)}>
                    <Tabs snap={snap} numbers={item.children} />
                    <span className="need-main"><Mark on>{w(item.pupilExam.title)}</Mark><small>{w(item.pupilExam.quote)}</small></span>
                    <span className="need-when">{item.pupilExam.date ? dayWithDate(item.pupilExam.date) : t("Date not confirmed")}</span>
                    <NeedDone item={item} />
                  </a>
                ))}
              </div>
            </section>
          ) : null}
          <RecentNotes items={items} snap={snap} />
          <RecentResults children={children} snap={snap} />
        </div>

        <section className="section" aria-labelledby="ahead-h">
          <h2 className="eyebrow" id="ahead-h">
            {t("This week and next")}
          </h2>
          <div className="card glance-card">
            <Glance
              feed={items}
              children={children}
              days={twoWeeks}
              until={addDays(monday, 13)}
              lessonsOf={(c) => knownLessons(snap.perChild[c.number])}
              onExam={(c, date) => {
                const data = snap.perChild[c.number];
                const lesson = knownLessons(data).find((l) => l.date === date && examForLesson(data, l));
                setFocus({ child: c, date, lesson: lesson ? lessonKey(lesson) : null });
              }}
              onLesson={(c, l) => setFocus({ child: c, date: l.date, lesson: null })}
            />
          </div>
        </section>
      </div>
    </main>
  );
}

/* ---------- Recent notes ---------- */

/** The first of the last three school days (today counts when it is one). */
function recentNotesFrom(now: string): string {
  let day = now;
  for (let left = 3; ; day = addDays(day, -1)) if (weekday(day) <= 4 && --left === 0) return day;
}

/** The teachers' notes from the last three school days for the children shown, newest first; one opens in Notes. */
function RecentNotes({ items, snap }: { items: FeedItem[]; snap: Snapshot }) {
  const w = useWilma();
  const kinds = useNoteKinds();
  const from = recentNotesFrom(today());
  // An absence to explain is already under Needs you.
  const notes = items.filter((i) => i.kind === "note" && i.note && i.note.date >= from && !isNeedsYou(i));
  const shown = notes.slice(0, 4);
  return (
    <>
      <h2 className="eyebrow rr-eyebrow" id="notes-h">
        {t("Recent notes")}
        <button type="button" className="linkish rr-all" onClick={() => go("notes")}>
          {t("Notes")} →
        </button>
      </h2>
      <div className="card rr" aria-labelledby="notes-h">
        {shown.length ? (
          shown.map((item) => {
            const note = item.note!;
            const child = snap.children.find((c) => c.number === note.child);
            const name = subjectNamer(snap.perChild[note.child]);
            const subjects = [...new Set(note.subjects.map(name))].map(w).join(", ");
            return (
              <button
                type="button"
                key={item.key}
                className={`rr-line rn-line c${(child?.color ?? 0) % 16}`}
                onClick={() => {
                  markOpened(item.key);
                  go("notes", item.key);
                }}
              >
                <span className="ov-day">{daysBetween(note.date, today()) <= 1 ? relativeDay(note.date) : shortDate(note.date)}</span>
                {child ? <Tab child={child} /> : <span />}
                <span className="rn-what">
                  <span className="rn-head">
                    <span className={`nk nk-${noteKind(note, kinds)}`}>{w(note.typeLabel)}</span>
                    {subjects ? <span> {subjects}</span> : null}
                  </span>
                  {note.note ? <q className="rn-words">{w(note.note)}</q> : null}
                </span>
                {item.isNew ? <em className="lx-new">{tSense("New", "a note")}</em> : <span />}
              </button>
            );
          })
        ) : (
          <p className="ov-none">{t("No notes in the last three school days.")}</p>
        )}
        {notes.length > shown.length ? (
          <button type="button" className="linkish needs-more" onClick={() => go("notes")}>
            {t("{n} more in Notes", { n: notes.length - shown.length })} →
          </button>
        ) : null}
      </div>
    </>
  );
}

/* ---------- Recent results ---------- */

/** Exam grades from the last three weeks for the children shown, newest first; one opens in Grades. */
function RecentResults({ children, snap }: { children: Child[]; snap: Snapshot }) {
  const w = useWilma();
  const opened = useApp((s) => s.local.opened);
  const jev = useApp((s) => s.jev);
  const from = addDays(today(), -21);
  const results = children
    .flatMap((child) => examResults(snap.perChild[child.number]).filter((e) => e.grade && e.date >= from).map((exam) => ({ child, exam })))
    .sort((a, b) => b.exam.date.localeCompare(a.exam.date));
  const shown = results.slice(0, 4);
  return (
    <>
      <h2 className="eyebrow rr-eyebrow" id="results-h">
        {t("Recent results")}
        <button type="button" className="linkish rr-all" onClick={() => go("grades", "exams")}>
          {t("Grades")} →
        </button>
      </h2>
      <div className="card rr" aria-labelledby="results-h">
        {shown.length ? (
          shown.map(({ child, exam }) => {
            const key = resultKey(child.number, exam);
            const mark = examMark(exam, jev[markKey(key)]);
            return (
              <button type="button" key={key} className={`rr-line c${child.color % 16}`} onClick={() => go("grades", key)}>
                <span className="ov-day">{shortDate(exam.date)}</span>
                <Tab child={child} />
                <span className="rr-what">
                  <b>{w(exam.subject || exam.name)}</b>
                  {exam.name && exam.name !== exam.subject ? <span> · {w(exam.name)}</span> : null}
                  {isNewResult(child.number, exam, opened) ? <em className="lx-new">{tSense("New", "a result")}</em> : null}
                </span>
                <span className={`ex-chip ${markShade(mark)}${mark.kind === "grade" ? "" : " not-grade"}`}>{mark.text}</span>
              </button>
            );
          })
        ) : (
          <p className="ov-none">{t("No exam results in the last three weeks.")}</p>
        )}
        {results.length > shown.length ? (
          <button type="button" className="linkish needs-more" onClick={() => go("grades", "exams")}>
            {t("{n} more in Grades", { n: results.length - shown.length })} →
          </button>
        ) : null}
      </div>
    </>
  );
}

/* ---------- School days ---------- */

/** One child's today and next school day, with the absence report and "Message a teacher" under them. Times, exams and homework open the day beside. */
function ChildDays({ child, snap, items, dates, focus, onOpen }: { child: Child; snap: Snapshot; items: FeedItem[]; dates: string[]; focus: DayFocus | null; onOpen: (focus: DayFocus) => void }) {
  const data = snap.perChild[child.number];
  const lessons = knownLessons(data);
  const leftOut = useApp((s) => s.local.leftOut?.[child.number]);
  const times = dayTimes(dayLessons(lessons, leftOut));
  const odd = unusualDays(data, dates, leftOut);
  // Reporting an absence is a guardian's (a student's own login has no such form).
  const student = useViewer() === "student";
  const events = agenda(snap, items, [child.number], { from: dates[0], until: dates[dates.length - 1] }).filter((e) => e.kind !== "exam" && e.itemKey);
  return (
    <div className="sd-row">
      <div className="sd-who">
        <Tab child={child} full />
      </div>
      {dates.map((d, i) => {
        const day = lessons.filter((l) => l.date === d);
        const shown = focus?.child.number === child.number && focus.date === d;
        return (
          <DayCell
            key={d}
            date={d}
            isToday={i === 0}
            times={times.get(d)}
            odd={odd.filter((u) => u.date === d)}
            exams={(data?.exams ?? []).filter((e) => e.date === d).map((exam) => ({ exam, lesson: day.find((l) => examForLesson(data, l) === exam) ?? null }))}
            // A message about a change the timetable already flags that day is the same news (as in Glance).
            events={events.filter((e) => e.date === d && !(e.kind === "schedule" && odd.some((u) => u.date === d)))}
            homework={i === 0 ? null : dueHomework(data, lessons, [d])}
            loaded={Boolean(data)}
            shown={shown}
            onOpen={(lesson) => onOpen({ child, date: d, lesson })}
          />
        );
      })}
      {student ? (
        <div className="day-actions">
          <a className="btn btn-quiet btn-sm" href={hrefFor("inbox", `new:${child.number}`)}>
            {t("Message a teacher")}
          </a>
        </div>
      ) : (
        <AbsenceRow child={child} />
      )}
    </div>
  );
}

function DayCell({
  date,
  isToday,
  times,
  odd,
  exams,
  events,
  homework,
  loaded,
  shown,
  onOpen,
}: {
  date: string;
  isToday: boolean;
  times: DayTimes | undefined;
  odd: UnusualDay[];
  exams: { exam: UpcomingExam; lesson: ScheduleLesson | null }[];
  events: AgendaEntry[];
  /** What's due that day (null: not shown). */
  homework: DueHomework[] | null;
  loaded: boolean;
  /** This day is the one in the panel. */
  shown: boolean;
  /** Show the day beside, with this lesson picked (null: the day, with its homework). */
  onOpen: (lesson: string | null) => void;
}) {
  const w = useWilma();
  if (weekday(date) > 4) return <div className="sd-cell sd-quiet">{t("Weekend")}</div>;
  if (!times) {
    const off = odd.some((u) => u.kind === "off");
    return <div className={`sd-cell${off ? "" : " sd-quiet"}`}>{off ? <span className="flag">{t("No lessons")}</span> : loaded ? "–" : t("Reading the timetable…")}</div>;
  }
  const nowM = nowMinutes();
  const status = !isToday ? null : nowM < minutes(times.start) ? t("Starts {time}", { time: times.start }) : nowM < minutes(times.end) ? t("Ends {time}", { time: times.end }) : t("Done for today");
  const flag = (u: UnusualDay) => {
    const by = formatMinutes(u.by!);
    if (u.kind === "start") return u.by! > 0 ? t("Starts {by} later than usual", { by }) : t("Starts {by} earlier than usual", { by });
    return u.by! > 0 ? t("Ends {by} later than usual", { by }) : t("Ends {by} earlier than usual", { by });
  };
  return (
    <div className="sd-cell">
      <button type="button" className="sd-time" aria-pressed={shown} onClick={() => onOpen(null)} title={t("Show the day's lessons")}>
        {times.start}–{times.end}
      </button>
      {status ? <div className={`sd-status${nowM >= minutes(times.end) ? " done" : ""}`}>{status}</div> : null}
      <div className="sd-notes">
        {odd.map((u, i) => (
          <button type="button" key={`o${i}`} className="flag" onClick={() => onOpen(null)}>
            {flag(u)}
          </button>
        ))}
        {exams.map(({ exam, lesson }, i) => (
          <button type="button" key={`x${i}`} className="chip chip-marker" onClick={() => onOpen(lesson ? lessonKey(lesson) : null)}>
            {t("Exam: {subject}", { subject: w(exam.subject || exam.name) })}
          </button>
        ))}
        {events.map((e, i) =>
          // A day that runs differently, from a message: flagged like a change the timetable shows, in the message's words.
          e.kind === "schedule" ? (
            <a key={`e${i}`} className="flag" href={hrefFor("inbox", e.itemKey)} title={e.detail ? w(e.detail) : undefined}>
              {w(e.title)}
            </a>
          ) : (
            <a key={`e${i}`} className="chip chip-pen" href={hrefFor("inbox", e.itemKey)} title={w(e.title)}>
              {w(e.title)}
            </a>
          )
        )}
        {homework !== null ? (
          homework.length ? (
            <button type="button" className="chip" onClick={() => onOpen(null)}>
              {t("Homework: {n}", { n: homework.length })}
            </button>
          ) : (
            <span className="chip">{t("No homework")}</span>
          )
        ) : null}
      </div>
    </div>
  );
}

/* ---------- Needs you ---------- */

/** One line: the child, the title (in highlighter), the school's own sentence on what to do, and by when. */
function NeedLine({ item, snap, marked }: { item: FeedItem; snap: Snapshot; marked: boolean }) {
  const when = item.task ? item.task.label : urgencyLabel(item);
  const listed = useListed(item);
  return (
    <a className="need" href={itemHref(item)}>
      <Tabs snap={snap} numbers={item.children} />
      <span className="need-main">
        <Mark on={marked}>{listed.title}</Mark>
        <small>{listed.action ?? item.from}</small>
      </span>
      {when ? <span className="need-when">{when}</span> : null}
      <NeedDone item={item} />
    </a>
  );
}

/** Done, as in the lists: the item leaves Today and the lists, with Undo. */
function NeedDone({ item }: { item: FeedItem }) {
  return (
    <button
      type="button"
      className="btn btn-quiet btn-sm need-done"
      title={t("Mark done")}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleDoneWithUndo(item);
      }}
    >
      <Icon name="check" />
      <span className="sr-only">{t("Mark done")}</span>
    </button>
  );
}

function Summary({ needs, coming, snap }: { needs: number | null; coming: AgendaEntry[]; snap: Snapshot }) {
  const w = useWilma();
  const exam = coming.find((e) => e.kind === "exam" && daysBetween(today(), e.date) <= 7);
  const child = exam ? snap.children.find((c) => c.number === exam.child) : null;
  if (needs === null && !exam) return null;
  return (
    <div className="sum">
      {needs !== null ? (
        needs ? (
          <>
            <b>{plural(needs, "{n} thing needs attention", "{n} things need attention")}</b>.{" "}
          </>
        ) : (
          <>{t("Nothing needs you right now.")} </>
        )
      ) : null}
      {exam && child ? (
        <a className="sum-link" href={hrefFor("exams")}>
          {tx("{name} has a {exam} exam {day}.", { name: child.first, exam: <b>{w(exam.title)}</b>, day: dayPhrase(exam.date) })}
        </a>
      ) : null}
    </div>
  );
}

function CaughtUp() {
  return (
    <div className="empty caught-up">
      <svg className="stroke" viewBox="0 0 54 54" aria-hidden="true">
        <path d="M6 30 Q 14 34 20 42 Q 30 22 48 10" fill="none" stroke="var(--marker)" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6 30 Q 14 34 20 42 Q 30 22 48 10" fill="none" stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div>
        <h3>{t("All caught up")}</h3>
        <p>{t("Nothing here needs you. New messages show up as soon as Wilma has them.")}</p>
      </div>
    </div>
  );
}

/* ---------- Reporting an absence ---------- */

/*
 * Like Wilma's phone app: one button, the reason (Helsinki offers one,
 * "Terveydellinen syy"), send. The card itself says exactly what goes to
 * Wilma, so sending it is the confirmation.
 */
type AbsenceStage =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "form"; form: AbsenceForm; note?: string }
  | { kind: "sending"; form: AbsenceForm }
  | { kind: "error"; message: string; form?: AbsenceForm };

/** Wilma's reasons, glossed in English and Swedish (in Finnish, Wilma's own label says it all). */
const REASONS: [RegExp, string, string][] = [
  [/terveydellinen/i, "health reason", "hälsoskäl"],
  [/sairaus/i, "illness", "sjukdom"],
  [/muu syy/i, "other reason", "annat skäl"],
];
const gloss = (label: string) => {
  if (language() === "fi") return null;
  const row = REASONS.find(([re]) => re.test(label));
  return row ? (language() === "sv" ? row[2] : row[1]) : null;
};

const FI_ON_DAY = ["maanantaina", "tiistaina", "keskiviikkona", "torstaina", "perjantaina", "lauantaina", "sunnuntaina"];
const FI_FOR_DAY = ["maanantaiksi", "tiistaiksi", "keskiviikoksi", "torstaiksi", "perjantaiksi", "lauantaiksi", "sunnuntaiksi"];

/**
 * A day for the middle of a sentence, in the app's language.
 *   "on":  "today", "tomorrow", "yesterday", "on Thursday", "on Mon 12 Oct"
 *          / "tänään", "huomenna", "eilen", "torstaina", "ma 12.10."
 *   "for": "for today", "for tomorrow", "for Thursday", "for Mon 12 Oct"
 *          / "tälle päivälle", "huomiseksi", "torstaiksi", "ma 12.10."
 */
function dayPhrase(iso: string, as: "on" | "for" = "on"): string {
  const diff = daysBetween(today(), iso);
  const weekdayName = diff > 1 && diff < 7; // as relativeDay() names it
  if (language() === "fi") {
    if (diff === 0) return as === "on" ? "tänään" : "tälle päivälle";
    if (diff === 1) return as === "on" ? "huomenna" : "huomiseksi";
    if (diff === -1 && as === "on") return "eilen";
    return weekdayName ? (as === "on" ? FI_ON_DAY : FI_FOR_DAY)[weekday(iso)] : shortDate(iso);
  }
  if (language() === "sv") {
    // "i dag", "i morgon", "i går", "på torsdag", "mån 12.10." / "till i dag", "till i morgon", "till torsdag", "till mån 12.10."
    const to = as === "for" ? "till " : "";
    if (diff === 0) return `${to}i dag`;
    if (diff === 1) return `${to}i morgon`;
    if (diff === -1 && as === "on") return "i går";
    return weekdayName ? `${as === "for" ? "till" : "på"} ${dayNameLong(iso).toLowerCase()}` : `${to}${shortDate(iso)}`;
  }
  const prefix = as === "for" ? "for " : "";
  if (diff === 0) return `${prefix}today`;
  if (diff === 1) return `${prefix}tomorrow`;
  if (diff === -1 && as === "on") return "yesterday";
  return `${as} ${weekdayName ? dayNameLong(iso) : shortDate(iso)}`;
}

function AbsenceRow({ child }: { child: Child }) {
  const reported = useApp((s) => s.local.reported?.[child.number]);
  const [stage, setStage] = useState<AbsenceStage>({ kind: "idle" });
  const [reason, setReason] = useState("");
  const [text, setText] = useState("");
  const [noting, setNoting] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const day = absenceDay();
  const done = reported?.[day];

  // "Report absent" from the command menu: open this card (also when the menu asked before Today was showing).
  useEffect(() => {
    if (takePendingAbsence(child.number)) void open();
    const onAsk = (e: Event) => {
      if ((e as CustomEvent<string>).detail === child.number && takePendingAbsence(child.number)) void open();
    };
    addEventListener("wilmai:report-absence", onAsk);
    return () => removeEventListener("wilmai:report-absence", onAsk);
  }, [child.number]);

  const open = async () => {
    setStage({ kind: "loading" });
    try {
      const form = await prepareAbsenceReport(child.number);
      setReason(form.reasons.length === 1 ? form.reasons[0].value : "");
      setStage({ kind: "form", form });
    } catch (err) {
      setStage({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  const send = async (form: AbsenceForm) => {
    setStage({ kind: "sending", form });
    try {
      setSaid(await sendAbsenceReport(child.number, form, reason, text));
      setStage({ kind: "idle" });
      setText("");
      setNoting(false);
    } catch (err) {
      try {
        const fresh = await preparedAgain(err, () => prepareAbsenceReport(child.number), loginOfChild(child.number));
        if (fresh) setStage({ kind: "form", form: fresh, note: SESSION_CHANGED_NOTE });
      } catch {
        setStage({ kind: "error", message: err instanceof Error ? err.message : String(err), form });
      }
    }
  };

  if (stage.kind === "idle" || stage.kind === "loading") {
    return (
      <div className="day-actions">
        <a className="btn btn-quiet btn-sm" href={hrefFor("inbox", `new:${child.number}`)}>
          {t("Message a teacher")}
        </a>
        {done ? (
          <span className="chip chip-good" title={said ?? undefined}>
            {t("Absence reported {day}", { day: dayPhrase(day, "for") })} · {done.reason}
          </span>
        ) : (
          <button className="btn btn-quiet btn-sm" onClick={() => void open()} disabled={stage.kind === "loading"}>
            {stage.kind === "loading" ? t("Opening Wilma's form…") : t("Report {name} absent {day}", { name: child.first, day: dayPhrase(day) })}
          </button>
        )}
      </div>
    );
  }

  const form = "form" in stage ? stage.form : undefined;
  const phrase = form?.date ? dayPhrase(form.date) : null;
  const when = form?.date && phrase ? (phrase.endsWith(shortDate(form.date)) ? phrase : `${phrase} (${shortDate(form.date)})`) : form?.dateLabel || t("on the day Wilma shows");
  const busy = stage.kind === "sending";
  return (
    <div className="absence">
      {form ? (
        <>
          <div className="absence-head">{tx("{name} absent {when}", { name: <b>{child.first}</b>, when: <b>{when}</b> })}</div>
          <div className="pills" role="radiogroup" aria-label={t("Reason")}>
            {form.reasons.map((r) => (
              <button key={r.value} className="pill" role="radio" aria-checked={reason === r.value} aria-pressed={reason === r.value} onClick={() => setReason(r.value)} disabled={busy}>
                {r.label}
                {gloss(r.label) ? <small> · {gloss(r.label)}</small> : null}
              </button>
            ))}
          </div>
          {form.textField ? (
            noting ? (
              <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("A note for the teachers (optional)")} aria-label={t("A note for the teachers")} disabled={busy} autoFocus />
            ) : (
              <button className="linkish" onClick={() => setNoting(true)} disabled={busy}>
                {t("+ Add a note for the teachers")}
              </button>
            )
          ) : null}
          {form.guidance ? <p className="absence-guide">{form.guidance}</p> : null}
        </>
      ) : null}
      {stage.kind === "error" ? <div className="notice err">{stage.message}</div> : null}
      {stage.kind === "form" && stage.note ? <div className="notice err">{t(stage.note)}</div> : null}
      <div className="absence-foot">
        {/* Wilma's own instructions already say teachers see it; say it ourselves only when they're missing. */}
        {isDemo() ? (
          <span className="absence-who">{t("Teachers see the report in Wilma (sample family: nothing is sent).")}</span>
        ) : !form?.guidance ? (
          <span className="absence-who">{t("Teachers see the report in Wilma.")}</span>
        ) : null}
        <button className="btn btn-quiet btn-sm" onClick={() => setStage({ kind: "idle" })} disabled={busy}>
          {t("Close")}
        </button>
        {form ? (
          <button className="btn btn-primary btn-sm" disabled={!reason || busy} onClick={() => void send(form)}>
            {busy ? t("Sending…") : t("Send to Wilma")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
