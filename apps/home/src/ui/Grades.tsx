/*
 * Grades for the children shown, in two tabs, both by subject, the latest
 * first:
 *  - Exam results (first; they change every week): a card per child with
 *    the exam average, then a row per subject with exams in the period (this
 *    term, this school year, or all Wilma keeps), the subject with the newest
 *    exam on top: the latest result highlighted, the trend, the results
 *    before it, the subject's exam average.
 *  - Report cards: Wilma's grade book, a card per child: the average
 *    (behaviour isn't counted, as at school; all subjects, or the academic
 *    ones only, "lukuaineet", as the joint application counts), the average
 *    term by term, how the grades spread, and a row per subject: the grade
 *    now, highlighted, the trend, then each term's grade, newest first.
 * A subject opens in place as one timeline, newest first: each term's
 * report-card grade with that term's exams, each exam with what the teacher
 * wrote. Marks are read as the teacher's note says (points, another scale,
 * T–H–K letters; see data/marks.ts): only school grades are averaged.
 * Read from Wilma when the view opens: the grade book (kept twelve hours)
 * and the past exams (kept six), one request each per child.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { PastExam } from "@wilma-client/src/core";
import { markOpened, setGradeKind, useApp } from "../data/store";
import { loadGradebook, loadPastExams } from "../data/engine";
import {
  averageOf,
  examResults,
  examTrend,
  gradeValue,
  isAcademic,
  isConduct,
  isNewResult,
  isResultOrWaiting,
  kindOf,
  resultKey,
  spreadOf,
  subjectsOf,
  subjectsWithExams,
  termAverages,
  termOf,
  termsOf,
  trendOf,
  type SubjectGrades,
} from "../data/grades";
import { examMark, markKey, markShade, type ExamMark } from "../data/marks";
import { MARK_QS } from "../jev/questions";
import { shortDate, today } from "../data/dates";
import { intelligenceOn, type Child, type GradeKind } from "../data/model";
import { Icon, Linked, Tab } from "./bits";
import { go, gradesAcademicOnly, tSense, useChildFilter } from "./shared";
import { locale, plural, t } from "../i18n";
import { useWilma } from "../data/phrases";

const decimals = (n: number) => new Intl.NumberFormat(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

/** "Autumn 24" / "Syksy 24". */
const termLabel = (term: { year: number; spring: boolean }) => t(term.spring ? "Spring {yy}" : "Autumn {yy}", { yy: String(term.year).slice(2) });

/** A report-card grade's shade: g10 the deepest green … g4 red; "other" for S, H and words; "none" without one. */
function heat(grade: string | null | undefined): string {
  const v = gradeValue(grade);
  if (v === null) return grade ? "other" : "none";
  return `g${Math.max(4, Math.min(10, Math.round(v)))}`;
}

function Trend({ trend, label }: { trend: -1 | 0 | 1; label?: string }) {
  return (
    <span
      className={`grade-trend${trend > 0 ? " up" : trend < 0 ? " down" : ""}`}
      aria-label={trend > 0 ? (label ?? t("Up from the course before")) : trend < 0 ? (label ?? t("Down from the course before")) : undefined}
    >
      {trend > 0 ? "↑" : trend < 0 ? "↓" : ""}
    </span>
  );
}

/** How a child's exam marks read: Jev's reading of each (see data/marks.ts), given per child card. */
const MarkOf = createContext<(e: PastExam) => ExamMark>((e) => examMark(e));

/** An exam's mark as a chip: shaded by how good it is; a mark that isn't a school grade (points, letters) outlined; "…" while it waits. */
function Mark({ exam, big = false }: { exam: PastExam; big?: boolean }) {
  const markOf = useContext(MarkOf);
  if (!exam.grade) return <span className={`ex-chip waiting${big ? " big" : ""}`}>…</span>;
  const mark = markOf(exam);
  return <span className={`ex-chip ${markShade(mark)}${mark.kind === "grade" ? "" : " not-grade"}${big ? " big" : ""}`}>{mark.text}</span>;
}

/* ---------- The tab and the period, remembered ---------- */

type GradesTab = "exams" | "reports";
type Period = "term" | "year" | "all";
const PERIODS: { id: Period; label: string }[] = [
  { id: "term", label: "This term" },
  { id: "year", label: "School year" },
  { id: "all", label: "All" },
];

function saved<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Remembering is a convenience.
  }
}

/** The first day a period covers: the term (from January or August), the school year (from August), or everything. */
function periodStart(period: Period): string | null {
  const [y, m] = today().split("-").map(Number);
  if (period === "all") return null;
  if (period === "term") return m <= 7 ? `${y}-01-01` : `${y}-08-01`;
  return `${m >= 8 ? y : y - 1}-08-01`;
}

/** The subject open in place: child and subject name. */
type Open = { child: string; subject: string };
const openKey = (o: Open) => `${o.child}|${o.subject}`;

/** `itemKey`: a tab ("exams", "reports") or an exam result to open (from Today). */
export function Grades({ itemKey }: { itemKey?: string | null }) {
  const snap = useApp((s) => s.snapshot)!;
  const opened = useApp((s) => s.local.opened);
  const { selected } = useChildFilter();
  const children = snap.children.filter((c) => !selected.length || selected.includes(c.number));
  const numbers = children.map((c) => c.number).join(",");
  const asTab = itemKey === "exams" || itemKey === "reports" ? itemKey : null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [tab, setTab] = useState<GradesTab>(() => asTab ?? (itemKey ? "exams" : saved("wilmai.gradesTab", ["exams", "reports"] as const, "exams")));
  const [period, setPeriod] = useState<Period>(() => saved("wilmai.examPeriod", ["term", "year", "all"] as const, "year"));
  const academic = gradesAcademicOnly.use();
  const pickTab = (next: GradesTab) => {
    setTab(next);
    save("wilmai.gradesTab", next);
  };
  const pickPeriod = (next: Period) => {
    setPeriod(next);
    save("wilmai.examPeriod", next);
  };
  const toggle = (o: Open) => setOpen((now) => (now && openKey(now) === openKey(o) ? null : o));

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    Promise.allSettled(children.flatMap((c) => [loadGradebook(c.number), loadPastExams(c.number)]))
      .then((all) => {
        const failed = all.find((r): r is PromiseRejectedResult => r.status === "rejected");
        if (live && failed) setError(failed.reason instanceof Error ? failed.reason.message : String(failed.reason));
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [numbers]);

  const results = useMemo(() => Object.fromEntries(children.map((c) => [c.number, examResults(snap.perChild[c.number])])), [snap, numbers]);
  const jev = useApp((s) => s.jev);
  const jevOn = useApp((s) => intelligenceOn(s.settings));
  const markOf = (child: string) => (e: PastExam) => examMark(e, jev[markKey(resultKey(child, e))]);
  const unread = children.flatMap((c) => results[c.number].filter((e) => e.grade && jev[markKey(resultKey(c.number, e))]?.qs !== MARK_QS)).length;
  const subjectsFor = (child: string) => subjectsOf(snap.perChild[child]?.gradebook?.entries ?? []);

  // New results stay marked for this visit; seen here, they're not new next time (nor a dot on the nav).
  const [fresh] = useState(() => new Set(children.flatMap((c) => results[c.number].filter((e) => isNewResult(c.number, e, opened)).map((e) => resultKey(c.number, e)))));
  useEffect(() => {
    if (tab !== "exams") return;
    for (const c of children) for (const e of results[c.number]) if (isNewResult(c.number, e, opened)) markOpened(resultKey(c.number, e));
  }, [results, tab]);

  // An exam from a link (Today's recent results): the results tab, a period that has it, its subject open, the exam in view.
  const linked = useRef<string | null>(null);
  useEffect(() => {
    if (!itemKey || asTab || linked.current === itemKey) return;
    const hit = children.flatMap((c) => results[c.number].map((e) => ({ c, e }))).find(({ c, e }) => resultKey(c.number, e) === itemKey);
    if (!hit) return;
    linked.current = itemKey;
    setTab("exams");
    const from = periodStart(period);
    if (from && hit.e.date < from) setPeriod(hit.e.date >= periodStart("year")! ? "year" : "all");
    const subject = subjectsWithExams(subjectsFor(hit.c.number), [hit.e]).find((r) => r.exams.length)?.subject.name ?? hit.e.subject;
    setOpen({ child: hit.c.number, subject });
    setHighlight(itemKey);
    setTimeout(() => document.querySelector(`[data-result="${CSS.escape(itemKey)}"]`)?.scrollIntoView({ block: "center" }), 60);
  }, [itemKey, results]);

  return (
    <main className="page grades-page">
      <div className="week-head">
        <h1>{t("Grades")}</h1>
        <div className="seg-toggle grades-tabs" role="tablist" aria-label={t("Grades")}>
          <button type="button" role="tab" aria-selected={tab === "exams"} aria-pressed={tab === "exams"} onClick={() => pickTab("exams")}>
            {t("Exam results")}
          </button>
          <button type="button" role="tab" aria-selected={tab === "reports"} aria-pressed={tab === "reports"} onClick={() => pickTab("reports")}>
            {t("Report cards")}
          </button>
        </div>
        <span style={{ flex: 1 }} />
        {tab === "exams" ? (
          <div className="seg-toggle" role="group" aria-label={t("Period")}>
            {PERIODS.map((p) => (
              <button type="button" key={p.id} aria-pressed={period === p.id} onClick={() => pickPeriod(p.id)}>
                {tSense(p.label, "exams")}
              </button>
            ))}
          </div>
        ) : (
          <div className="seg-toggle" role="group" aria-label={t("Subjects")}>
            <button type="button" aria-pressed={!academic} onClick={() => gradesAcademicOnly.set(false)}>
              {t("All subjects")}
            </button>
            <button type="button" aria-pressed={academic} onClick={() => gradesAcademicOnly.set(true)}>
              {t("Academic subjects")}
            </button>
          </div>
        )}
      </div>
      {error ? <div className="notice err" style={{ marginBottom: 14 }}>{error}</div> : null}
      {unread ? (
        <p className="grades-note">
          {jevOn ? (
            t("The AI is reading the marks ({n} to go)…", { n: unread })
          ) : (
            <>
              {t("Without the AI, points and other scales show as written, and only marks written like school grades are averaged.")}{" "}
              <button type="button" className="linkish" onClick={() => go("settings")}>
                {t("Add a key")}
              </button>
            </>
          )}
        </p>
      ) : null}

      {children.map((child) =>
        tab === "exams" ? (
          <MarkOf.Provider key={child.number} value={markOf(child.number)}>
          <ExamCard
            child={child}
            subjects={subjectsFor(child.number)}
            exams={results[child.number]}
            from={periodStart(period)}
            fresh={fresh}
            highlight={highlight}
            open={open?.child === child.number ? open.subject : null}
            onToggle={(subject) => toggle({ child: child.number, subject })}
            read={Boolean(snap.perChild[child.number]?.pastExams) || !loading}
          />
          </MarkOf.Provider>
        ) : (
          <MarkOf.Provider key={child.number} value={markOf(child.number)}>
          <ReportCard
            child={child}
            all={subjectsFor(child.number)}
            exams={results[child.number]}
            academic={academic}
            fresh={fresh}
            open={open?.child === child.number ? open.subject : null}
            onToggle={(subject) => toggle({ child: child.number, subject })}
            loading={loading && !snap.perChild[child.number]?.gradebook}
          />
          </MarkOf.Provider>
        )
      )}
    </main>
  );
}

/* ---------- Exam results, by subject ---------- */

function ExamCard({
  child,
  subjects,
  exams,
  from,
  fresh,
  highlight,
  open,
  onToggle,
  read,
}: {
  child: Child;
  subjects: SubjectGrades[];
  exams: PastExam[];
  from: string | null;
  fresh: Set<string>;
  highlight: string | null;
  open: string | null;
  onToggle: (subject: string) => void;
  read: boolean;
}) {
  const w = useWilma();
  const markOf = useContext(MarkOf);
  const inPeriod = (e: PastExam) => isResultOrWaiting(e) && (!from || e.date >= from);
  // Subjects with exams in the period, the one with the newest exam first.
  const rows = subjectsWithExams(subjects, exams)
    .map((r) => ({ ...r, shown: r.exams.filter(inPeriod) }))
    .filter((r) => r.shown.length)
    .sort((a, b) => b.shown[0].date.localeCompare(a.shown[0].date));
  const graded = rows.flatMap((r) => r.shown).filter((e) => e.grade);
  const values = graded.map((e) => markOf(e).value).filter((v): v is number => v !== null);

  return (
    <section className={`card grade-card c${child.color % 16}`}>
      <div className="grade-head">
        <div className="grade-who">
          <Tab child={child} full />
          {values.length ? (
            <span className="grade-avg">
              <b>{decimals(mean(values))}</b>
              <span>{t("exam average, {n}", { n: plural(graded.length, "{n} graded exam", "{n} graded exams") })}</span>
            </span>
          ) : (
            <span className="ov-none">{read ? t("No graded exams in this period.") : t("Reading…")}</span>
          )}
        </div>
      </div>

      {rows.length ? (
        <div className="xs-table">
          <div className="xs-head" aria-hidden="true">
            <span />
            <span>{t("Latest")}</span>
            <span />
            <span>{t("Before")}</span>
            <span className="xs-avg-h">{t("Average")}</span>
            <span />
          </div>
          {rows.map((r, i) => {
            const [latest, ...before] = r.shown;
            const grades = r.shown.map((e) => markOf(e).value).filter((v): v is number => v !== null);
            const trend = examTrend(r.exams, markOf);
            const isOpen = open === r.subject.name;
            return (
              <div className={`xs-group${isOpen ? " open" : ""}`} key={`${i}:${r.subject.name}`}>
                <button type="button" className="xs-row" aria-expanded={isOpen} onClick={() => onToggle(r.subject.name)}>
                  <span className="grade-subject">{w(r.subject.name)}</span>
                  <span className="xs-latest">
                    <Mark exam={latest} big />
                    <small>
                      {shortDate(latest.date)}
                      {fresh.has(resultKey(child.number, latest)) ? <em className="lx-new">{tSense("New", "a result")}</em> : null}
                    </small>
                  </span>
                  <Trend trend={trend} label={trend > 0 ? t("Exams going up") : t("Exams going down")} />
                  <span className="xs-before">
                    {before.slice(0, 8).map((e) => (
                      <Mark key={resultKey(child.number, e)} exam={e} />
                    ))}
                    {before.length > 8 ? <small className="xs-more">+{before.length - 8}</small> : null}
                  </span>
                  <span className="xs-avg" aria-label={grades.length ? t("Average {avg}", { avg: decimals(mean(grades)) }) : undefined}>
                    {grades.length ? <span className={`ex-chip g${Math.max(4, Math.min(10, Math.round(mean(grades))))}`}>{decimals(mean(grades))}</span> : <span className="xs-none">–</span>}
                  </span>
                  <Icon name={isOpen ? "up" : "down"} className="icon xs-open" />
                </button>
                {isOpen ? <SubjectTimeline child={child} subject={r.subject} exams={r.exams} fresh={fresh} highlight={highlight} from={from} /> : null}
              </div>
            );
          })}
        </div>
      ) : read ? (
        <p className="ov-none">{t("Wilma lists no exams in this period for {name}.", { name: child.first })}</p>
      ) : null}
    </section>
  );
}

/* ---------- Report cards ---------- */

/** The subjects as they stood in one term: each one's grade that term (behaviour still marked, as averageOf leaves it out). */
function termSubjects(subjects: SubjectGrades[], key: string): SubjectGrades[] {
  return subjects.flatMap((s) => {
    const course = [...s.courses].reverse().find((c) => termOf(c.date)?.key === key);
    return course ? [{ name: s.name, grade: course.grade, courses: [] }] : [];
  });
}

/** The average course grade term by term, as a small line with its last value. */
function TermLine({ points }: { points: { key: string; mean: number }[] }) {
  if (points.length < 2) return null;
  const w = 168;
  const h = 46;
  const lo = Math.min(...points.map((p) => p.mean)) - 0.25;
  const hi = Math.max(...points.map((p) => p.mean)) + 0.25;
  const x = (i: number) => 6 + (i * (w - 12)) / (points.length - 1);
  const y = (v: number) => 6 + ((hi - v) / (hi - lo || 1)) * (h - 12);
  const last = points[points.length - 1].mean;
  const change = last - points[points.length - 2].mean;
  return (
    <div className="grade-line">
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={t("Average by term")}>
        <polyline points={points.map((p, i) => `${x(i)},${y(p.mean)}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle key={p.key} cx={x(i)} cy={y(p.mean)} r={i === points.length - 1 ? 4 : 2.5} fill={i === points.length - 1 ? "currentColor" : "var(--sheet)"} stroke="currentColor" strokeWidth="1.5" />
        ))}
      </svg>
      <span className="grade-line-text">
        {t("By term")}
        {Math.abs(change) >= 0.05 ? (
          <b className={change > 0 ? "up" : "down"}>
            {change > 0 ? "↑" : "↓"} {decimals(Math.abs(change))}
          </b>
        ) : (
          <b>{t("steady")}</b>
        )}
      </span>
    </div>
  );
}

function ReportCard({
  child,
  all,
  exams,
  academic,
  fresh,
  open,
  onToggle,
  loading,
}: {
  child: Child;
  all: SubjectGrades[];
  exams: PastExam[];
  academic: boolean;
  fresh: Set<string>;
  open: string | null;
  onToggle: (subject: string) => void;
  loading: boolean;
}) {
  const w = useWilma();
  const kinds = useApp((s) => s.local.gradeKinds);
  const subjects = all.filter((s) => !academic || isAcademic(s.name, kinds));
  // Newest term first, after the grade now.
  const terms = termsOf(subjects).reverse();
  // The summary (average and spread) is of one column: the grades now, or a term's (a click on its heading).
  const [column, setColumn] = useState<string>("now");
  const term = terms.find((x) => x.key === column) ?? null;
  const summed = term ? termSubjects(subjects, term.key) : subjects;
  const avg = averageOf(summed, kinds);
  const spread = spreadOf(summed, kinds);
  const total = spread.reduce((sum, s) => sum + s.count, 0);
  const withExams = subjectsWithExams(all, exams);
  // School subjects first in Wilma's order; behaviour at the end.
  const rows = [...subjects.filter((s) => !isConduct(s.name, kinds)), ...subjects.filter((s) => isConduct(s.name, kinds))];

  return (
    <section className={`card grade-card c${child.color % 16}`}>
      <div className="grade-head">
        <div className="grade-who">
          <Tab child={child} full />
          {avg !== null ? (
            <span className="grade-avg">
              <b>{decimals(avg.mean)}</b>
              <span>
                {term
                  ? t(academic ? "average in {term}, {n}, academic subjects" : "average in {term}, {n}", { term: termLabel(term), n: plural(avg.count, "{n} subject", "{n} subjects") })
                  : t(academic ? "average now, {n}, academic subjects" : "average now, {n}", { n: plural(avg.count, "{n} subject", "{n} subjects") })}
              </span>
            </span>
          ) : null}
        </div>
        <TermLine points={termAverages(subjects, kinds)} />
      </div>

      {total ? (
        <div className="grade-spread" role="img" aria-label={spread.map((s) => `${s.grade} ×${s.count}`).join(", ")}>
          {spread.map((s) => (
            <span key={s.grade} className={`gs g${Math.max(4, Math.min(10, s.grade))}`} style={{ flexGrow: s.count }}>
              <b>{s.grade}</b>
              <small>×{s.count}</small>
            </span>
          ))}
        </div>
      ) : null}

      {rows.length ? (
        <div className={`grade-table${terms.length ? "" : " no-terms"}`} style={{ ["--terms" as string]: terms.length }}>
          <div className="grade-row grade-th">
            <span />
            <button type="button" className="gt-now" aria-pressed={!term} onClick={() => setColumn("now")}>
              {t("Now")}
            </button>
            <span />
            {terms.map((x) => (
              <button type="button" key={x.key} className="gt-term" aria-pressed={term?.key === x.key} onClick={() => setColumn(term?.key === x.key ? "now" : x.key)}>
                {termLabel(x)}
              </button>
            ))}
          </div>
          {rows.map((s, i) => {
            const isOpen = open === s.name;
            return (
              <div className={`xs-group${isOpen ? " open" : ""}`} key={`${i}:${s.name}`}>
                <button type="button" className={`grade-row${isConduct(s.name, kinds) ? " conduct" : ""}`} aria-expanded={isOpen} onClick={() => onToggle(s.name)}>
                  <span className="grade-subject">{w(s.name)}</span>
                  <span className={`grade-now ${heat(s.grade)}`}>{s.grade ?? "–"}</span>
                  <Trend trend={trendOf(s)} />
                  {terms.map((x) => {
                    const course = [...s.courses].reverse().find((c) => termOf(c.date)?.key === x.key);
                    return (
                      <span key={x.key} className={`gc ${heat(course?.grade)}${term?.key === x.key && course?.grade ? " picked" : ""}`}>
                        {course?.grade ?? ""}
                      </span>
                    );
                  })}
                </button>
                {isOpen ? (
                  <>
                    <SubjectTimeline child={child} subject={s} exams={withExams.find((r) => r.subject === s)?.exams ?? []} fresh={fresh} highlight={null} />
                    <GradeKindSwitch name={s.name} />
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="ov-none">{loading ? t("Reading…") : t("Wilma has no grades for {name} yet.", { name: child.first })}</p>
      )}
      {rows.some((s) => isConduct(s.name, kinds)) ? <p className="grade-foot">{t("Behaviour isn't counted in the average, as at school.")}</p> : null}
    </section>
  );
}

/** What a report-card subject is, for the averages, and who said so; the parent's word can be undone. */
function GradeKindSwitch({ name }: { name: string }) {
  const w = useWilma();
  const { kind, from } = kindOf(name, useApp((s) => s.local.gradeKinds));
  const said = from === "parent" ? t("You set this for {subject}.", { subject: w(name) }) : from === "ai" ? t("The AI read this from the subject's name; change it if it's wrong.") : t("Going by the subject's name; change it if it's wrong.");
  return (
    <div className="grade-kind">
      <label>
        <span>{t("Counts as")}</span>
        <select value={kind} onChange={(e) => setGradeKind(name, e.target.value as GradeKind)}>
          <option value="academic">{t("an academic subject")}</option>
          <option value="other">{t("another subject")}</option>
          <option value="conduct">{t("behaviour: not in the average")}</option>
        </select>
      </label>
      <small>
        {said}
        {from === "parent" ? (
          <>
            {" "}
            <button type="button" className="linkish" onClick={() => setGradeKind(name, null)}>
              {t("Undo")}
            </button>
          </>
        ) : null}
      </small>
    </div>
  );
}

/* ---------- One subject: grades and exams on one timeline ---------- */

type Term = { key: string; year: number; spring: boolean };

/** The term after one: autumn → next spring, spring → autumn. */
const nextTerm = (term: Term): Term => (term.spring ? { key: `${term.year}-2`, year: term.year, spring: false } : { key: `${term.year + 1}-1`, year: term.year + 1, spring: true });
/** A term's first and last day. */
const termSpan = (term: Term): [string, string] => (term.spring ? [`${term.year}-01-01`, `${term.year}-07-31`] : [`${term.year}-08-01`, `${term.year}-12-31`]);

/**
 * The subject's grades and exams over time, left to right: exams as dots on
 * a line, each term's report-card grade as a square at the term's end, the
 * terms marked below. Only school grades are drawn.
 */
function TimelineChart({ terms, exams, courses }: { terms: Term[]; exams: PastExam[]; courses: SubjectGrades["courses"] }) {
  const markOf = useContext(MarkOf);
  if (!terms.length) return null;
  const start = termSpan(terms[0])[0];
  const end = termSpan(terms[terms.length - 1])[1];
  const day = (iso: string) => Date.parse(`${iso}T12:00:00Z`) / 86_400_000;
  const x = (iso: string) => Math.max(0, Math.min(1, (day(iso) - day(start)) / (day(end) - day(start) || 1)));
  const dots = [...exams]
    .reverse()
    .map((e) => ({ e, v: markOf(e).value }))
    .filter((p): p is { e: PastExam; v: number } => p.v !== null);
  const squares = courses
    .map((c) => ({ c, v: gradeValue(c.grade) }))
    .filter((p): p is { c: SubjectGrades["courses"][number]; v: number } => p.v !== null && Boolean(p.c.date));
  if (dots.length + squares.length < 2) return null;
  const values = [...dots.map((d) => d.v), ...squares.map((s) => s.v)];
  const lo = Math.min(...values, 7) - 0.3;
  const hi = Math.max(...values, 9) + 0.3;
  const h = 84;
  const y = (v: number) => 8 + ((hi - v) / (hi - lo || 1)) * (h - 16);
  const grid = [5, 6, 7, 8, 9, 10].filter((g) => g >= lo && g <= hi);
  const band = (term: Term) => ({ left: `${x(termSpan(term)[0]) * 100}%`, width: `${(x(termSpan(term)[1]) - x(termSpan(term)[0])) * 100}%` });
  return (
    <div className="tl-chart" role="img" aria-label={t("Grades and exams over time")}>
      <div className="tl-plot" style={{ height: h }}>
        {terms.map((term, i) => (
          <span key={term.key} className={`tl-band${i % 2 ? " odd" : ""}`} style={band(term)} />
        ))}
        {grid.map((g) => (
          <span key={g} className="tl-grid" style={{ top: y(g) }}>
            <i>{g}</i>
          </span>
        ))}
        <svg viewBox={`0 0 1000 ${h}`} preserveAspectRatio="none" width="100%" height={h}>
          <polyline points={dots.map((d) => `${x(d.e.date) * 1000},${y(d.v)}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.55" vectorEffect="non-scaling-stroke" />
        </svg>
        {dots.map((d, i) => (
          <span key={i} className="tl-dot" style={{ left: `${x(d.e.date) * 100}%`, top: y(d.v) }} />
        ))}
        {squares.map((s, i) => (
          <span key={i} className={`tl-square ${heat(s.c.grade)}`} style={{ left: `${x(s.c.date!) * 100}%`, top: y(s.v) }}>
            {s.c.grade}
          </span>
        ))}
      </div>
      <div className="tl-terms">
        {terms.map((term) => (
          <span key={term.key} style={band(term)}>
            {termLabel(term)}
          </span>
        ))}
      </div>
      <p className="tl-key">
        <span className="tl-dot static" /> {t("exam")}
        <span className="tl-square static g9" /> {t("report-card grade")}
      </p>
    </div>
  );
}

/**
 * One subject in place: the chart, then term by term, newest first, the
 * term's report-card grade and its exams with the teacher's words. `from`:
 * only the period picked (Exam results), with the whole history a click away;
 * without it, everything (Report cards).
 */
function SubjectTimeline({
  child,
  subject,
  exams,
  fresh,
  highlight,
  from = null,
}: {
  child: Child;
  subject: SubjectGrades;
  exams: PastExam[];
  fresh: Set<string>;
  highlight: string | null;
  from?: string | null;
}) {
  const w = useWilma();
  const [whole, setWhole] = useState(false);
  const since = whole ? null : from;
  const all = exams.filter(isResultOrWaiting);
  const shown = since ? all.filter((e) => e.date >= since) : all;
  const courses = since ? subject.courses.filter((c) => c.date && c.date >= since) : subject.courses;
  const more = Boolean(since) && (all.length > shown.length || subject.courses.some((c) => c.grade && c.date && c.date < since!));
  const known = [...shown.map((e) => termOf(e.date)), ...courses.map((c) => termOf(c.date))].filter((x): x is Term => Boolean(x));
  let first = [...known].sort((a, b) => a.key.localeCompare(b.key))[0];
  const sinceTerm = since ? termOf(since) : null;
  if (sinceTerm && (!first || sinceTerm.key < first.key)) first = sinceTerm;
  // Every term from the first with a grade or an exam to now, so a gap shows.
  const terms: Term[] = [];
  const now = termOf(today())!;
  for (let term = first; term && term.key <= now.key; term = nextTerm(term)) terms.push(term);
  const teacher = shown.find((e) => e.teacher)?.teacher.split(", ")[0] ?? "";
  const code = shown.find((e) => e.teacherCode)?.teacherCode.split(", ")[0] || teacher;

  return (
    <div className="tl">
      <TimelineChart terms={terms} exams={shown} courses={courses} />
      {[...terms].reverse().map((term) => {
        const course = [...courses].reverse().find((c) => termOf(c.date)?.key === term.key && c.grade);
        const own = shown.filter((e) => termOf(e.date)?.key === term.key);
        return (
          <div className="tl-term" key={term.key}>
            <div className="tl-term-head">
              <h5>{termLabel(term)}</h5>
              {course ? (
                <span className="tl-report">
                  {t("Report card")} <span className={`gc ${heat(course.grade)}`}>{course.grade}</span>
                </span>
              ) : null}
            </div>
            {own.length ? (
              <ul className="tl-exams">
                {own.map((e) => {
                  const key = resultKey(child.number, e);
                  return (
                    <li key={key} data-result={key} className={highlight === key ? "highlight" : undefined}>
                      <span className="ov-day">{shortDate(e.date)}</span>
                      <span className="tl-what">
                        <b>{w(e.name || e.subject)}</b>
                        {fresh.has(key) ? <em className="lx-new">{tSense("New", "a result")}</em> : null}
                        {e.grade ? null : <span className="tl-waiting">{t("No grade yet")}</span>}
                        {e.verbalGrade ? <span className="tl-verbal">“{w(e.verbalGrade)}”</span> : null}
                        {e.info ? <Note text={e.info} /> : null}
                      </span>
                      <Mark exam={e} />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="ov-none">{t("No exams this term.")}</p>
            )}
          </div>
        );
      })}
      {more || (whole && from) ? (
        <button type="button" className="linkish tl-whole" onClick={() => setWhole(!whole)}>
          {whole ? t("Show only the period picked") : t("Show the whole history")}
        </button>
      ) : null}
      {code ? (
        <button className="btn btn-quiet btn-sm tl-message" onClick={() => go("inbox", `new:${child.number}:${encodeURIComponent(code)}:${encodeURIComponent(`${subject.name}: kokeet`)}`)}>
          <Icon name="pen" /> {teacher ? t("Message {name}", { name: teacher.split(" ")[0] }) : t("Message the teacher")}
        </button>
      ) : null}
    </div>
  );
}

/** What the teacher wrote about an exam: three lines, the rest on request. */
function Note({ text: original }: { text: string }) {
  const text = useWilma()(original);
  const [all, setAll] = useState(false);
  const long = text.split("\n").length > 3 || text.length > 240;
  return (
    <>
      <span className={`tl-note${long && !all ? " clamped" : ""}`}>
        <Linked text={text} />
      </span>
      {long ? (
        <button type="button" className="linkish tl-note-more" onClick={() => setAll(!all)}>
          {all ? t("Show less") : t("Show all")}
        </button>
      ) : null}
    </>
  );
}
