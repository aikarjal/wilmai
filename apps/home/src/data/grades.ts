/*
 * Wilma's grade book (Suoritukset) as subjects: each subject with its
 * current grade and its courses in order (the term and school-year grades).
 * Wilma nests some subjects one level deeper ("Äidinkieli ja kirjallisuus"
 * > "Suomen kieli ja kirjallisuus" > courses); the subject is the level
 * whose rows are courses.
 */
import type { ExamGrade, GradebookEntry, PastExam } from "@wilma-client/src/core";
import type { ChildData, GradeKind, LocalState } from "./model";
import { addDays, today } from "./dates";
import { examMark, type ExamMark } from "./marks";

export interface SubjectGrades {
  name: string;
  /** The subject's grade as Wilma gives it ("9", "8+", "S"), if any. */
  grade: string | null;
  /** Its courses, oldest first. */
  courses: { code: string | null; grade: string | null; date: string | null; name: string }[];
}

export function subjectsOf(entries: GradebookEntry[]): SubjectGrades[] {
  const out: SubjectGrades[] = [];
  for (const e of entries) {
    if (e.children.some((c) => c.children.length)) {
      out.push(...subjectsOf(e.children));
      continue;
    }
    const courses = e.children
      .map((c) => ({ code: c.code, grade: c.grade, date: c.date, name: c.name }))
      .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
    if (e.grade || courses.length) out.push({ name: e.name, grade: e.grade, courses });
  }
  return out;
}

/** A Finnish school grade as a number: "9" 9, "8+" 8.25, "9-" 8.75, "7½" 7.5; null for "S", "H" or words. */
export function gradeValue(grade: string | null | undefined): number | null {
  const m = /^\s*(10|[4-9])\s*(½|,5|\.5|\+|-)?\s*$/.exec(grade ?? "");
  if (!m) return null;
  const base = Number(m[1]);
  const mark = m[2];
  return mark === "+" ? base + 0.25 : mark === "-" ? base - 0.25 : mark ? base + 0.5 : base;
}

/** What the parent said about each subject and the AI's reading of its name (LocalState.gradeKinds). */
type Kinds = LocalState["gradeKinds"];

/**
 * What a report-card subject is, and who said so: the parent's word, else the AI's reading of the name (luna/subjects.ts),
 * else the name's usual words.
 */
export function kindOf(name: string, kinds: Kinds): { kind: GradeKind; from: "parent" | "ai" | "name" } {
  const known = kinds?.[name];
  if (known?.set) return { kind: known.set, from: "parent" };
  if (known?.ai) return { kind: known.ai, from: "ai" };
  return { kind: nameSaysConduct(name) ? "conduct" : nameSaysAcademic(name) ? "academic" : "other", from: "name" };
}

/**
 * Lukuaineet: the academic subjects (languages, mathematics, the sciences,
 * history and civics, religion or ethics, health), whose average the
 * spring joint application (yhteishaku) looks at. Not: arts and skills
 * (art, music, crafts, PE, home economics), electives, behaviour.
 */
export const isAcademic = (name: string, kinds: Kinds): boolean => kindOf(name, kinds).kind === "academic";

/** Behaviour (and work habits) get a grade but aren't school subjects: shown, not counted in the average. */
export const isConduct = (name: string, kinds: Kinds): boolean => kindOf(name, kinds).kind === "conduct";

/** Without the AI: whether the name is an academic subject's usual name (Finnish, Swedish). */
const nameSaysAcademic = (name: string): boolean =>
  !/kuvataide|musiikki|käsityö|tekninen työ|tekstiilityö|liikunta|kotitalous|valinnai|soveltava|design|tanssi|teatteri|ilmaisu|oppilaanohjaus|bildkonst|musik|slöjd|gymnastik|huslig/i.test(name) &&
  /kieli|äidinkieli|kirjallisuus|ruotsi|englanti|saksa|ranska|espanja|venäjä|italia|kiina|japani|latina|\b[AB][12]\b|matematiikka|biologia|maantieto|fysiikka|kemia|ympäristöoppi|terveystieto|uskonto|elämänkatsomus|historia|yhteiskunta|svenska|finska|engelska|matematik|biologi|geografi|fysik|kemi|hälsokunskap|religion|livsåskådning|historia|samhälls/i.test(name);

/** Without the AI: whether the name is behaviour's or work habits' usual name. */
const nameSaysConduct = (name: string): boolean => /käyttäytyminen|työskentely|uppförande|arbetssätt|behaviou?r|conduct/i.test(name);

/** The mean of the subjects' numeric grades and how many there were (behaviour not counted), or null when there are none. */
export function averageOf(subjects: SubjectGrades[], kinds: Kinds): { mean: number; count: number } | null {
  const values = subjects.filter((s) => !isConduct(s.name, kinds)).map((s) => gradeValue(s.grade)).filter((v): v is number => v !== null);
  return values.length ? { mean: values.reduce((a, b) => a + b, 0) / values.length, count: values.length } : null;
}

/** The term a grade was given in: autumn (Aug–Dec) or spring (Jan–Jul) of a year. Keys sort in time order. */
export function termOf(date: string | null): { key: string; year: number; spring: boolean } | null {
  if (!date) return null;
  const [y, m] = date.split("-").map(Number);
  const spring = m <= 7;
  return { key: `${y}-${spring ? 1 : 2}`, year: y, spring };
}

/** Every term any course was graded in, oldest first. */
export function termsOf(subjects: SubjectGrades[]): { key: string; year: number; spring: boolean }[] {
  const seen = new Map<string, { key: string; year: number; spring: boolean }>();
  for (const s of subjects) for (const c of s.courses) {
    const term = termOf(c.date);
    if (term) seen.set(term.key, term);
  }
  return [...seen.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** The mean of the numeric course grades given in each term (behaviour not counted). */
export function termAverages(subjects: SubjectGrades[], kinds: Kinds): { key: string; mean: number }[] {
  return termsOf(subjects)
    .map(({ key }) => {
      const values = subjects
        .filter((s) => !isConduct(s.name, kinds))
        .flatMap((s) => s.courses.filter((c) => termOf(c.date)?.key === key).map((c) => gradeValue(c.grade)))
        .filter((v): v is number => v !== null);
      return { key, mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN };
    })
    .filter((t) => !Number.isNaN(t.mean));
}

/** How many subjects have each whole grade now (10, 9, 8…), behaviour not counted. */
export function spreadOf(subjects: SubjectGrades[], kinds: Kinds): { grade: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const s of subjects) {
    if (isConduct(s.name, kinds)) continue;
    const v = gradeValue(s.grade);
    if (v !== null) counts.set(Math.round(v), (counts.get(Math.round(v)) ?? 0) + 1);
  }
  return [...counts].map(([grade, count]) => ({ grade, count })).sort((a, b) => b.grade - a.grade);
}

/** Up or down from the course before by half a grade or more: +1, -1, or 0 (a "+" or "-" either way isn't news). */
export function trendOf(subject: SubjectGrades): -1 | 0 | 1 {
  const values = subject.courses.map((c) => gradeValue(c.grade)).filter((v): v is number => v !== null);
  if (values.length < 2) return 0;
  const [prev, last] = values.slice(-2);
  return last - prev >= 0.5 ? 1 : prev - last >= 0.5 ? -1 : 0;
}

/* ---------- Exam results ---------- */

const plain = (text: string) => text.toLowerCase().replace(/[^\p{L}\d]+/gu, " ").trim();

function fromFrontPage(g: ExamGrade): PastExam {
  return { date: g.date, name: g.name, subject: g.subject, subjectCode: g.subjectCode, grade: g.grade, verbalGrade: g.verbalGrade, info: g.info, teacher: g.teacher, teacherCode: g.teacherCode, seen: g.seen ?? null };
}

/**
 * A child's exam results, newest first: Wilma's past-exams list (read when
 * Grades opens, back as far as the school keeps them) and the front page's
 * graded exams (read at every sync, so a grade given since shows at once),
 * one entry per exam.
 */
export function examResults(data: ChildData | undefined): PastExam[] {
  const out = [...(data?.pastExams?.exams ?? [])];
  for (const g of (data?.overview?.grades ?? []).map(fromFrontPage)) {
    const at = out.findIndex((e) => e.date === g.date && plain(e.name) === plain(g.name) && (!e.subject || !g.subject || plain(e.subject) === plain(g.subject)));
    if (at < 0) out.push(g);
    else if (!out[at].grade) out[at] = { ...out[at], grade: g.grade, seen: out[at].seen ?? g.seen };
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** One exam of one child, for links and "seen in the app" (date, course and name; Wilma's list has no exam ids). */
export const resultKey = (child: string, e: PastExam): string => `${child}:${e.date}:${e.subjectCode || plain(e.subject)}:${plain(e.name)}`;

/** A graded exam from the last three weeks that nobody has seen in Wilma and the parent hasn't seen here. */
export const isNewResult = (child: string, e: PastExam, opened: Record<string, number>): boolean =>
  Boolean(e.grade) && !e.seen && e.date >= addDays(today(), -21) && !opened[resultKey(child, e)];

/** Graded exams, or ones from the last month still waiting for a grade (an older one without a grade won't get one). */
export const isResultOrWaiting = (e: PastExam): boolean => Boolean(e.grade) || (e.date >= addDays(today(), -30) && e.date <= today());

/** The course-code family: "MA" for "MA_91" and "MA_7LV", "RUB1" for "RUB1_81". */
const family = (code: string | null | undefined): string | null => /^([\p{L}\d]+)_/u.exec(code ?? "")?.[1].toUpperCase() ?? null;

/** The grade-book subject an exam belongs to: by its course code's family, else by name ("Kotitalous yhteinen" → "Kotitalous"). */
export function subjectOfExam(subjects: SubjectGrades[], exam: Pick<PastExam, "subject" | "subjectCode">): SubjectGrades | null {
  const fam = family(exam.subjectCode);
  const byCode = fam ? subjects.find((s) => s.courses.some((c) => family(c.code) === fam)) : undefined;
  if (byCode) return byCode;
  const name = plain(exam.subject);
  if (!name) return null;
  const same = subjects.find((s) => plain(s.name) === name || s.courses.some((c) => plain(c.name) === name));
  if (same) return same;
  const prefix = (a: string, b: string) => b.length >= 5 && (a.startsWith(`${b} `) || a === b);
  return subjects.find((s) => prefix(name, plain(s.name)) || prefix(plain(s.name), name)) ?? null;
}

/**
 * The grade book's subjects, each with its exams (newest first), and after
 * them a row for each subject that has exams but no grades yet (a new
 * school, a first term), named as the exam list names it.
 */
export function subjectsWithExams(subjects: SubjectGrades[], exams: PastExam[]): { subject: SubjectGrades; exams: PastExam[] }[] {
  type Row = { subject: SubjectGrades; exams: PastExam[] };
  const rows: Row[] = subjects.map((subject) => ({ subject, exams: [] }));
  // A subject without grades: one row, whether its exams are known by course code or by name.
  const extra: Row[] = [];
  const byKey = new Map<string, Row>();
  for (const e of exams) {
    const match = subjectOfExam(subjects, e);
    if (match) {
      rows[subjects.indexOf(match)].exams.push(e);
      continue;
    }
    const keys = [family(e.subjectCode), plain(e.subject)].filter((k): k is string => Boolean(k));
    if (!keys.length) continue;
    let row = keys.map((k) => byKey.get(k)).find(Boolean);
    if (!row) {
      row = { subject: { name: e.subject || e.name, grade: null, courses: [] }, exams: [] };
      extra.push(row);
    }
    for (const k of keys) byKey.set(k, row);
    row.exams.push(e);
  }
  return [...rows, ...extra];
}

/**
 * Up or down in a subject's exams: the mean of the last three school grades
 * against the three before, by half a grade or more (+1, -1, else 0). Points,
 * letters and other scales aren't counted. `exams` newest first.
 */
export function examTrend(exams: PastExam[], markOf: (e: PastExam) => ExamMark = (e) => examMark(e)): -1 | 0 | 1 {
  const values = exams.map((e) => markOf(e).value).filter((v): v is number => v !== null);
  if (values.length < 4) return 0;
  const mean = (list: number[]) => list.reduce((a, b) => a + b, 0) / list.length;
  const change = mean(values.slice(0, 3)) - mean(values.slice(3, 6));
  return change >= 0.5 ? 1 : change <= -0.5 ? -1 : 0;
}
