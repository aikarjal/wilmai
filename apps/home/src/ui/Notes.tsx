/*
 * Lesson notes (tuntimerkinnät) for the children shown, this school year.
 * For the chosen period (week, month, three months, school year): a line per
 * child with how many of each kind (a count shows only those), the notes
 * themselves right below, and on request a heat map per child, a row per
 * subject (class) and a column per kind, each cell shaded by its count. A
 * count, a cell, a subject or a kind shows only those notes; "Show all"
 * shows everything again. The notes follow by week, newest first; days in a row
 * with the same kind and no words from the teacher (a week of pre-approved
 * time off) are one line. Lessons are named by subject, not course code.
 *
 * The sync keeps the last 20 days; the whole year is read from Wilma when
 * this view opens (one request per child, kept six hours).
 */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { LessonNote } from "@wilma-client/src/core";
import { markOpened, setNoteKind, useApp, useViewer } from "../data/store";
import { loadYearNotes, isDemo } from "../data/engine";
import { wilmaPage } from "../data/logins";
import { needsYou, noteGroups, type FeedItem, type NoteGroup } from "../data/feed";
import { NOTE_KINDS, NOTE_KIND_LABEL, noteKind, noteKindFrom, useNoteKinds, type NoteKind } from "../data/notes";
import { subjectNamer, teacherCodeFor } from "../data/schedule";
import { addDays, dateSpan, dateSpanFi, isoWeek, mondayOf, shortDate, shortDateFi, today, weekday } from "../data/dates";
import type { Child } from "../data/model";
import { Icon, Mark, Tab } from "./bits";
import { go, notesBySubject, tSense, useChildFilter } from "./shared";
import { plural, t } from "../i18n";
import { examSuperseded, noteExam } from "../data/note-exams";
import { useWilma } from "../data/phrases";

/** How far back the view looks; the chart and the list follow it. */
type Period = "week" | "month" | "quarter" | "year";
const PERIODS: { id: Period; label: string; sub: string; days: number | null }[] = [
  { id: "week", label: "Week", sub: "The last 7 days", days: 7 },
  { id: "month", label: "Month", sub: "The last 30 days", days: 30 },
  { id: "quarter", label: "3 months", sub: "The last 3 months", days: 91 },
  { id: "year", label: "School year", sub: "This school year", days: null },
];
const PERIOD_KEY = "wilmai.notesPeriod";
function savedPeriod(): Period {
  try {
    const p = localStorage.getItem(PERIOD_KEY) as Period | null;
    return p && PERIODS.some((x) => x.id === p) ? p : "month";
  } catch {
    return "month";
  }
}

/** One line in the list: a note group, or several days of the same kind in a row. */
type Row = { child: Child; group: NoteGroup; kind: NoteKind; lessons: number; from: string; subjects: string[] };

/** The school day before (Fri before Mon). */
function schoolDayBefore(iso: string): string {
  let d = addDays(iso, -1);
  while (weekday(d) > 4) d = addDays(d, -1);
  return d;
}

export function Notes({ feed, itemKey }: { feed: FeedItem[]; itemKey: string | null }) {
  const snap = useApp((s) => s.snapshot)!;
  // What the menu's badge counts (an absence to explain): marked as Today's Needs you marks it.
  const toExplain = useMemo(() => new Set(needsYou(feed.filter((i) => i.kind === "note")).map((i) => i.key)), [feed]);
  const { selected } = useChildFilter();
  const children = snap.children.filter((c) => !selected.length || selected.includes(c.number));
  const childKey = children.map((c) => c.number).join(",");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the list shows: a child, a subject and a kind, each optional (picked in the heat map).
  const [filter, setFilter] = useState<Filter>(NO_FILTER);
  const bySubject = notesBySubject.use();
  const [period, setPeriodState] = useState<Period>(savedPeriod);
  const setPeriod = (p: Period) => {
    setPeriodState(p);
    try {
      localStorage.setItem(PERIOD_KEY, p);
    } catch {
      // only for this visit
    }
  };
  const span = PERIODS.find((p) => p.id === period)!;
  // From that day on; notes a teacher put on a coming day (for information) stay in.
  const since = span.days === null ? null : addDays(today(), -(span.days - 1));

  // The whole year, read once the view shows (kept in the snapshot); until then, the synced 20 days.
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    Promise.all(children.map((c) => loadYearNotes(c.number)))
      .catch((err) => live && setError(err instanceof Error ? err.message : String(err)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [childKey]);

  const notesOf = (c: Child): LessonNote[] => {
    const all = snap.perChild[c.number]?.yearNotes?.notes ?? snap.perChild[c.number]?.notes ?? [];
    return since ? all.filter((n) => n.date >= since) : all;
  };
  const year = children.every((c) => snap.perChild[c.number]?.yearNotes) || isDemo();
  // The model's kinds for the school's labels (with AI), else their words.
  const labelKinds = useNoteKinds();

  const rows: Row[] = useMemo(
    () =>
      children
        .flatMap((child) => {
          const notes = notesOf(child);
          const name = subjectNamer(snap.perChild[child.number]);
          return noteGroups(child.number, notes).map((group) => ({
            child,
            group,
            kind: noteKind(group, labelKinds),
            lessons: notes.filter((n) => n.date === group.date && n.typeLabel === group.typeLabel && (n.note ?? null) === group.note).length,
            from: group.date,
            subjects: [...new Set(group.subjects.map(name))],
          }));
        })
        .sort((a, b) => (b.group.date + (b.group.start ?? "")).localeCompare(a.group.date + (a.group.start ?? ""))),
    [snap, childKey, since, labelKinds]
  );

  // Counts are lessons, as Wilma counts them (a day's absence over six lessons is six), by subject and kind.
  const matrices = children.map((child) => matrixOf(child, notesOf(child), subjectNamer(snap.perChild[child.number]), labelKinds));
  // Every kind, always, in the fixed order: a zero is worth seeing ("no remarks").
  const kinds = NOTE_KINDS;
  const shown = rows.filter(
    (r) => (!filter.child || r.child.number === filter.child) && (!filter.kind || r.kind === filter.kind) && (!filter.subject || r.subjects.includes(filter.subject))
  );
  const filtered = Boolean(filter.child || filter.kind || filter.subject);
  const pick = (next: Filter) => setFilter(sameFilter(filter, next) ? NO_FILTER : next);

  // Today's notes are seen once this view shows them (the menu's dot goes).
  useEffect(() => {
    const now = today();
    for (const r of rows) if (r.group.date === now) markOpened(r.group.key);
  }, [rows]);

  // Opened from Today (a note that needs you): bring it into view.
  useEffect(() => {
    if (itemKey) document.querySelector(`[data-note="${CSS.escape(itemKey)}"]`)?.scrollIntoView({ block: "center" });
  }, [itemKey, rows.length]);

  // By week, newest first. Within a week, days in a row of the same kind without the teacher's words are one
  // line (a week of pre-approved time off); a note with words stays its own line and doesn't break the run.
  const weeks: [string, Row[]][] = [];
  let runs = new Map<string, number>();
  for (const r of shown) {
    const monday = mondayOf(r.group.date);
    let week = weeks[weeks.length - 1];
    if (!week || week[0] !== monday) {
      weeks.push((week = [monday, []]));
      runs = new Map();
    }
    const runKey = `${r.child.number}|${r.group.typeLabel}`;
    const at = runs.get(runKey);
    const run = at === undefined ? null : week[1][at];
    if (!r.group.note && r.group.key !== itemKey && run && schoolDayBefore(run.from) === r.group.date) {
      week[1][at!] = { ...run, from: r.group.date, lessons: run.lessons + r.lessons, subjects: [...new Set([...run.subjects, ...r.subjects])] };
    } else {
      week[1].push(r);
      if (!r.group.note && r.group.key !== itemKey) runs.set(runKey, week[1].length - 1);
    }
  }
  const thisMonday = mondayOf(today());
  const weekTitle = (monday: string) =>
    monday === thisMonday
      ? t("This week")
      : monday === addDays(thisMonday, -7)
        ? t("Last week")
        : t("Week {n} · {from}–{to}", { n: isoWeek(monday), from: shortDate(monday), to: shortDate(addDays(monday, 4)) });

  return (
    <main className="page notes-page">
      <div className="week-head">
        <h1>{t("Notes")}</h1>
        <span className="sub">{loading ? t("Reading this school year from Wilma…") : year || span.days !== null ? t(span.sub) : t("The last 20 days")}</span>
        <span style={{ flex: 1 }} />
        <div className="seg-toggle" role="group" aria-label={t("Period")}>
          {PERIODS.map((p) => (
            <button type="button" key={p.id} aria-pressed={period === p.id} onClick={() => setPeriod(p.id)}>
              {t(p.label)}
            </button>
          ))}
        </div>
      </div>
      {error ? <div className="notice err" style={{ marginBottom: 14 }}>{error}</div> : null}

      {/* First a line per child: how many of each kind (a count shows only those); the heat map by subject opens on request. */}
      <section className="card notes-sum">
        {matrices.map((m) => (
          <div className="ns-row" key={m.child.number}>
            {children.length > 1 ? <Tab child={m.child} full /> : null}
            <span className="ns-total">{plural(m.total, "{n} note", "{n} notes")}</span>
            <span className="ns-kinds">
              {NOTE_KINDS.filter((k) => m.totals[k] > 0).map((k) => (
                <button
                  type="button"
                  key={k}
                  className={`ns-kind nk-${k}`}
                  aria-pressed={filter.kind === k && !filter.subject && (!filter.child || filter.child === m.child.number)}
                  onClick={() => pick({ child: children.length > 1 ? m.child.number : null, subject: null, kind: k })}
                >
                  {tSense(NOTE_KIND_LABEL[k], "count")} <b>{m.totals[k]}</b>
                </button>
              ))}
            </span>
          </div>
        ))}
        <button type="button" className="linkish ns-open" aria-expanded={bySubject} onClick={() => notesBySubject.set(!bySubject)}>
          {bySubject ? t("Hide by subject") : t("By subject")} <Icon name={bySubject ? "up" : "down"} className="icon" />
        </button>
      </section>
      {bySubject
        ? matrices.map((m) => <NoteMatrix key={m.child.number} matrix={m} kinds={kinds} filter={filter} many={children.length > 1} onPick={pick} />)
        : null}
      {filtered ? (
        <p className="nc-hint notes-filter">
          {t("Showing")}{" "}
          <b>
            {[
              filter.child && children.length > 1 ? children.find((c) => c.number === filter.child)?.first : null,
              filter.subject,
              filter.kind ? tSense(NOTE_KIND_LABEL[filter.kind], "count") : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </b>{" "}
          <button type="button" className="linkish" onClick={() => setFilter(NO_FILTER)}>
            {t("Show all")}
          </button>
        </p>
      ) : null}

      {weeks.length ? (
        weeks.map(([monday, list]) => (
          <section className="section" key={monday}>
            <h2 className="eyebrow">{weekTitle(monday)}</h2>
            <div className="card note-list">
              {list.map((r) => (
                <NoteRow
                  key={r.group.key}
                  row={r}
                  many={children.length > 1}
                  highlight={r.group.key === itemKey}
                  needs={toExplain.has(r.group.key)}
                  wilma={wilmaPage(snap, r.child.number, "attendance")}
                  teacherCode={teacherCodeFor(snap.perChild[r.child.number], r.group.teachers[0])}
                />
              ))}
            </div>
          </section>
        ))
      ) : (
        <p className="ov-none">{filtered ? t("No notes of this kind.") : loading ? t("Reading…") : t("No lesson notes.")}</p>
      )}
    </main>
  );
}

/** The name a teacher goes by in a button: the first word of "Jussi Korhonen" (Wilma's notes put the first name first). */
const firstNameOf = (name: string) => name.split(/\s+/)[0];

type Filter = { child: string | null; subject: string | null; kind: NoteKind | null };
const NO_FILTER: Filter = { child: null, subject: null, kind: null };
const sameFilter = (a: Filter, b: Filter) => a.child === b.child && a.subject === b.subject && a.kind === b.kind;

type Matrix = { child: Child; subjects: { name: string; counts: Record<NoteKind, number>; total: number }[]; totals: Record<NoteKind, number>; total: number };

function emptyCounts(): Record<NoteKind, number> {
  return Object.fromEntries(NOTE_KINDS.map((k) => [k, 0])) as Record<NoteKind, number>;
}

/** One child's notes counted by subject and kind, the subjects with most notes first. */
function matrixOf(child: Child, notes: LessonNote[], name: (code: string) => string, kinds: Record<string, NoteKind>): Matrix {
  const bySubject = new Map<string, Record<NoteKind, number>>();
  const totals = emptyCounts();
  for (const n of notes) {
    const subject = n.subject ? name(n.subject) : t("No subject");
    const k = noteKind(n, kinds);
    const row = bySubject.get(subject) ?? emptyCounts();
    row[k] += 1;
    bySubject.set(subject, row);
    totals[k] += 1;
  }
  const subjects = [...bySubject]
    .map(([subject, counts]) => ({ name: subject, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "fi"));
  return { child, subjects, totals, total: notes.length };
}

/**
 * A child's notes as a heat map: a row per subject (class), a column per
 * kind, each cell shaded by its count against the busiest cell of that kind.
 * A cell, a subject or a column heading shows only those notes below.
 */
function NoteMatrix({ matrix, kinds, filter, many, onPick }: { matrix: Matrix; kinds: NoteKind[]; filter: Filter; many: boolean; onPick: (f: Filter) => void }) {
  const w = useWilma();
  const { child, subjects, totals, total } = matrix;
  const max = Object.fromEntries(kinds.map((k) => [k, Math.max(1, ...subjects.map((s) => s.counts[k]))])) as Record<NoteKind, number>;
  const mine = filter.child === child.number || !filter.child;
  return (
    <section className={`card note-matrix c${child.color % 16}`} style={{ ["--kinds" as string]: kinds.length }} aria-label={t("Notes by subject and kind")}>
      <div className="nm-head">
        {many ? <Tab child={child} full /> : null}
        <span className="nm-total">{plural(total, "{n} note", "{n} notes")}</span>
      </div>
      {subjects.length ? (
        <div className="nm-scroll">
          <div className="nm-grid">
            <span />
            {kinds.map((k) => (
              <button
                type="button"
                key={k}
                className={`nm-col nk-${k}`}
                aria-pressed={mine && filter.kind === k && !filter.subject}
                onClick={() => onPick({ child: many ? child.number : null, subject: null, kind: k })}
              >
                <span>{tSense(NOTE_KIND_LABEL[k], "count")}</span>
                <b>{totals[k] || "–"}</b>
              </button>
            ))}
            {subjects.map((s) => (
              <Fragment key={s.name}>
                <button
                  type="button"
                  className="nm-subject"
                  aria-pressed={mine && filter.subject === s.name && !filter.kind}
                  onClick={() => onPick({ child: many ? child.number : null, subject: s.name, kind: null })}
                >
                  <span title={w(s.name)}>{w(s.name)}</span>
                  <small>{s.total}</small>
                </button>
                {kinds.map((k) => {
                  const n = s.counts[k];
                  return n ? (
                    <button
                      type="button"
                      key={k}
                      className={`nm-cell nk-${k}`}
                      style={{ ["--a" as string]: `${Math.round(16 + (n / max[k]) * 52)}%` }}
                      aria-pressed={mine && filter.subject === s.name && filter.kind === k}
                      onClick={() => onPick({ child: many ? child.number : null, subject: s.name, kind: k })}
                    >
                      {n}
                    </button>
                  ) : (
                    <span key={k} className="nm-cell nm-blank" />
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
      ) : (
        <p className="ov-none">{t("No lesson notes.")}</p>
      )}
    </section>
  );
}

/**
 * A note's type in its kind's colour. A click sets what kind the type is, for every note of it, and says who decided:
 * the parent, the AI or the type's words. An unexplained absence is Wilma's own state, not changed here.
 */
function KindChip({ label, kind }: { label: string; kind: NoteKind }) {
  const w = useWilma();
  const jev = useApp((s) => s.jev);
  const set = useApp((s) => s.local.noteKinds);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  if (kind === "explain") return <span className={`nk nk-${kind}`}>{w(label)}</span>;
  const from = noteKindFrom(label, jev, set);
  const pick = (k: Exclude<NoteKind, "explain"> | null) => {
    setNoteKind(label, k);
    setOpen(false);
  };
  return (
    <span className="nk-box" ref={box}>
      <button type="button" className={`nk nk-${kind}`} aria-expanded={open} title={t("Change what kind of note this is")} onClick={() => setOpen(!open)}>
        {w(label)}
      </button>
      {open ? (
        <div className="nk-pick" role="dialog" aria-label={t("Show “{label}” under", { label: w(label) })}>
          <span className="nk-pick-head">{t("Show “{label}” under", { label: w(label) })}</span>
          <div className="nk-pick-kinds" role="radiogroup">
            {NOTE_KINDS.filter((k): k is Exclude<NoteKind, "explain"> => k !== "explain").map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} className={`nk nk-${k}`} onClick={() => pick(k)}>
                {t(NOTE_KIND_LABEL[k])}
              </button>
            ))}
          </div>
          <small>
            {from === "parent" ? t("You set this for every “{label}” note.", { label: w(label) }) : from === "ai" ? t("The AI read this from the note's type; change it if it's wrong.") : t("Going by the type's words; change it if it's wrong.")}
            {from === "parent" ? (
              <>
                {" "}
                <button type="button" className="linkish" onClick={() => pick(null)}>
                  {t("Undo")}
                </button>
              </>
            ) : null}
          </small>
        </div>
      ) : null}
    </span>
  );
}

function NoteRow({ row, many, highlight, needs, wilma, teacherCode }: { row: Row; many: boolean; highlight: boolean; needs: boolean; wilma: string; teacherCode: string | null }) {
  const w = useWilma();
  const student = useViewer() === "student";
  const { child, group, kind, lessons, from, subjects } = row;
  const snap = useApp((s) => s.snapshot)!;
  const luna = useApp((s) => s.luna);
  const read = noteExam(snap, group, luna[group.key]);
  const exam = read && !examSuperseded(group.key, read, luna) ? read : null;
  const original = exam?.originalExamId === null || !exam ? null : snap.perChild[child.number]?.exams.find((x) => x.examId === exam.originalExamId);
  const range = from !== group.date;
  const what = lessons > 2 || range ? plural(lessons, "{n} lesson", "{n} lessons") : subjects.map(w).join(", ");
  const time = !range && group.start ? `${group.start}${group.end && group.end !== group.start ? `–${group.end}` : ""}` : null;
  // Writing to the teacher about this note: the subject says which lesson and what was marked.
  const teacher = group.teachers[0] ?? null;
  // In Finnish whatever the app's language: it goes to the teacher, like the note's own words.
  const about = `${subjects.length === 1 ? `${subjects[0]} ` : ""}${range ? dateSpanFi(from, group.date) : shortDateFi(group.date)}: ${group.typeLabel}`;
  return (
    <div className={`note-row${highlight ? " highlight" : ""}`} data-note={group.key}>
      <span className="ov-day">{range ? dateSpan(from, group.date) : shortDate(group.date)}</span>
      {many ? <Tab child={child} /> : <span />}
      <div className="note-main">
        <div className="note-line">
          <KindChip label={group.typeLabel} kind={kind} />
          <span className="note-what">
            <Mark on={needs}>{what}</Mark>
            {time ? <small> · {time}</small> : null}
          </span>
        </div>
        {lessons > 2 && !range && subjects.length ? <small className="note-subjects">{subjects.map(w).join(", ")}</small> : null}
        {group.note ? <q className="note-words">{w(group.note)}</q> : null}
        {exam ? (
          <div className="note-exam">
            <span className="chip chip-marker">{t("Make-up exam")}</span>
            <span>{exam.date ? `${shortDate(exam.date)}${exam.start ? ` · ${exam.start}` : ""}` : t("Date not confirmed")}</span>
            {original ? <small>{t("Missed exam: {title}", { title: w(original.name || original.subject) })}</small> : null}
          </div>
        ) : null}
        <small className="note-who">{group.teachers.join(", ")}</small>
      </div>
      <div className="note-actions">
        {kind === "explain" && student ? (
          <span className="chip">{t("A guardian explains it in Wilma")}</span>
        ) : kind === "explain" && !isDemo() ? (
          <a className="btn btn-sm btn-primary" href={wilma} target="_blank" rel="noreferrer noopener">
            {t("Explain in Wilma")} ↗
          </a>
        ) : kind === "explain" ? (
          <span className="chip">{t("Sample family: no real Wilma")}</span>
        ) : null}
        {teacher ? (
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={() => go("inbox", `new:${child.number}:${encodeURIComponent(teacherCode ?? teacher)}:${encodeURIComponent(about)}`)}
            title={t("Write to {name} about this", { name: teacher })}
          >
            <Icon name="pen" /> {t("Message {name}", { name: firstNameOf(teacher) })}
          </button>
        ) : null}
      </div>
    </div>
  );
}
