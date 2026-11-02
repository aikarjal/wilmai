/*
 * The eval suite's cases and how a case is scored, shared by the runner
 * (run.ts), the calibration (calibrate.ts) and anything else that reads the
 * results. Load it after ./shim.ts (it loads the app's code).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { RealDate } from "./shim.ts";
import { firstName, LUNA_THRESHOLDS, type GradeKind, type JevRecord, type LocalState, type LunaRecord, type LunaThresholds, type Snapshot } from "../src/data/model.ts";
export { buildFeed } from "../src/data/feed.ts";
import { buildFeed, examsNeedingAttention, isNeedsYou } from "../src/data/feed.ts";
import { calendarEvents, readExams, type CalEvent } from "../src/data/calendar.ts";
import { examMark, markKey } from "../src/data/marks.ts";
import { kindOf, resultKey } from "../src/data/grades.ts";
import { bringOf, peOf } from "../src/data/schedule.ts";
import { addDays } from "../src/data/dates.ts";
import { labelKinds } from "../src/data/notes.ts";
import type { PastExam } from "@wilma-client/src/core";

export interface Pupil {
  name: string;
  /** The class ("9C"), as the front page gives it: the models are told it. */
  class?: string;
}
export type CaseItem =
  | { type: "message"; id: number; sent: string; from: string; subject: string; text: string; pupils: number[] }
  | { type: "news"; id: number; published: string; from: string; title: string; text: string; pupils: number[] }
  /** A lesson note; without text, only its type (the school's label), as most notes are. */
  | { type: "note"; id: number; pupil: number; date: string; start: string | null; end: string | null; subject: string; kind: string; teacher: string; text?: string }
  | { type: "mark"; id: number; pupil: number; date: string; subject: string; name: string; grade: string; info?: string | null }
  | { type: "lesson"; id: number; pupil: number; date: string; start: string; end: string; subject: string; subjectCode: string }
  /** A subject on the report card (the grade book), with its grade now. */
  | { type: "grade"; id: number; pupil: number; subject: string; grade: string }
  /** An exam in Wilma's own exam list (exact data, not read). */
  | { type: "exam"; id: number; pupil: number; date: string; time?: string | null; subject: string; subjectCode: string; name?: string; teacher: string; teacherCode: string };
export interface ExpectedEvent {
  date: string;
  endDate?: string;
  start?: string;
  kind?: string | string[];
  pupil?: number;
  /** true: must be in the calendar (not only a suggestion). */
  sure?: boolean;
  /** The title must match this (a regular expression, any case): to tell two events of a day apart. */
  title?: string;
  note?: string;
}
export interface Case {
  id: string;
  added: string;
  why: string;
  /** What it tests ("relative-date", "whose", "trap-past"…): the report counts by tag. */
  tags?: string[];
  /** A gap we know of: reported, not counted as a failure. */
  gap?: string;
  today: string;
  pupils: Pupil[];
  /** Who reads it: a guardian (the default) or the pupil in their own Wilma (a student's login, one pupil). */
  reader?: "guardian" | "student";
  items: CaseItem[];
  expect: {
    triage?: { item: number; needs_action?: boolean; kind?: string[]; scope?: string[] }[];
    /** The guardian's step as read: words its sentence must contain, its deadline; or `none` (no required step). */
    action?: { item: number; quote?: string; deadline?: string | null; none?: boolean }[];
    tone?: { item: number; tone: string }[];
    /** What kind a note's type (the school's label) is, as the model says (praise, absence, late, forgot, remark, other). */
    noteKind?: { item: number; kind: string }[];
    /** A pupil exam survives without a date, independently of guardian tasks and tone. */
    noteExam?: { item: number; important: boolean; quote?: string; date?: string | null; originalExam?: number | null }[];
    /** kind: one kind, or the kinds a parent would accept ("88 %" is points or a scale). */
    marks?: { item: number; kind: string | string[]; text?: string; value?: number; share?: [number, number] }[];
    /**
     * What the AI reads a subject's name as (luna/subjects.ts), a subject in the case's lessons or on its report card:
     * PE, packed for (the Bring line in Homework), its kind on the report card (the kinds a parent would accept).
     */
    subjects?: { subject: string; pe?: boolean; bring?: boolean; kind?: GradeKind | GradeKind[] }[];
    calendar?: {
      events?: ExpectedEvent[];
      /** Days that must have no event in the calendar, or none for this pupil (suggestions allowed unless `suggestions: false`). */
      not?: { date: string; pupil?: number; kind?: string | string[]; start?: string; suggestions?: boolean; note?: string }[];
      /** At most this many events that day (for one pupil, of a kind): the same event from two items shows once. */
      atMost?: { date: string; max: number; pupil?: number; kind?: string | string[]; note?: string }[];
      /** No event's title may match these (regular expressions). */
      titlesNot?: string[];
      /** No event may run longer than this many days (a course or a group isn't a holiday). */
      maxDays?: number;
    };
  };
}


/** The cases in a directory (one JSON file each). */
export function loadCases(dir: string): Case[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Case);
}

/**
 * The whole suite: the made-up cases (evals/cases) and, on the developer's computer, the ones built from real school
 * messages (evals/private, not in git: they'd tell which school and classes).
 */
export function loadSuite(evalsDir: string): Case[] {
  return [join(evalsDir, "cases"), join(evalsDir, "private")].filter((dir) => existsSync(dir)).flatMap(loadCases);
}

export const at = (iso: string) => new RealDate(iso.length === 10 ? `${iso}T09:00:00+03:00` : `${iso}:00+03:00`);

export function snapshotOf(c: Case): Snapshot {
  const children = c.pupils.map((p, i) => ({ number: String(2001 + i), name: p.name, first: firstName(p.name), color: i }));
  const num = (i: number) => children[i].number;
  const snap: Snapshot = {
    version: 1,
    account: { baseUrl: "https://esimerkki.inschool.fi", username: "eval", tenantName: "Esimerkkikoulu", via: "demo", ...(c.reader ? { wilmaRole: c.reader } : {}) },
    children,
    perChild: Object.fromEntries(children.map((ch, i) => [ch.number, { lessons: [], notes: [], exams: [], className: { value: c.pupils[i].class ?? null, fetchedAt: at(c.today) } }])),
    messages: {},
    news: {},
    firstSyncAt: 0,
    syncedAt: at(c.today),
  };
  for (const item of c.items) {
    if (item.type === "message") {
      snap.messages[item.id] = {
        id: item.id,
        subject: item.subject,
        sender: item.from,
        sentAt: at(item.sent),
        unreadInWilma: false,
        replyCount: 0,
        children: item.pupils.map(num),
        thread: { content: item.text, recipients: null, replies: [], collated: false, invite: null, fetchedAt: at(item.sent) },
      };
    } else if (item.type === "news") {
      snap.news[item.id] = {
        id: item.id,
        title: item.title,
        subtitle: null,
        author: item.from,
        published: at(item.published),
        pinned: false,
        children: item.pupils.map(num),
        detail: { content: item.text, resources: [], fetchedAt: at(item.published), v: 2 },
      };
    } else if (item.type === "note") {
      snap.perChild[num(item.pupil)].notes.push({ date: item.date, start: item.start, end: item.end, subject: item.subject, typeLabel: item.kind, typeClass: "", teacher: item.teacher, note: item.text ?? null });
    } else if (item.type === "lesson") {
      snap.perChild[num(item.pupil)].lessons.push({ date: item.date, start: item.start, end: item.end, subject: item.subject, subjectCode: item.subjectCode, dayOfWeek: ((at(item.date).getDay() + 6) % 7) + 1, teacher: "Opettaja Esimerkki", teacherCode: "OPE", groupId: 1 });
    } else if (item.type === "grade") {
      const data = snap.perChild[num(item.pupil)];
      const entry = { name: item.subject, code: null, grade: item.grade, credits: null, date: null, children: [] };
      data.gradebook = { entries: [...(data.gradebook?.entries ?? []), entry], fetchedAt: at(c.today) };
    } else if (item.type === "exam") {
      const data = snap.perChild[num(item.pupil)];
      data.exams = [
        ...(data.exams ?? []),
        { examId: item.id, date: item.date, time: item.time ?? null, name: item.name ?? "", subject: item.subject, subjectCode: item.subjectCode, topic: null, teacher: item.teacher, teacherCode: item.teacherCode },
      ];
    } else {
      const data = snap.perChild[num(item.pupil)];
      const exam: PastExam = {
        date: item.date,
        name: item.name,
        subject: item.subject,
        subjectCode: `${item.subject.slice(0, 2).toUpperCase()}_`,
        grade: item.grade,
        verbalGrade: null,
        info: item.info ?? null,
        teacher: "Opettaja Esimerkki",
        teacherCode: "OPE",
        seen: null,
      };
      data.pastExams = { exams: [...(data.pastExams?.exams ?? []), exam], fetchedAt: at(c.today), v: 2 };
    }
  }
  return snap;
}

export interface Check {
  task: "triage" | "action" | "tone" | "marks" | "subjects" | "calendar";
  what: string;
  ok: boolean;
  got: string;
  gap?: boolean;
}

export const kinds = (k: string | string[] | undefined) => (k === undefined ? null : Array.isArray(k) ? k : [k]);
export const describe = (e: CalEvent, snap: Snapshot) =>
  `${e.date}${e.endDate ? `–${e.endDate}` : ""}${e.start ? ` ${e.start}` : ""} ${e.kind}${e.sure ? "" : " (suggestion)"} "${e.title}" [${e.children.map((n) => snap.children.find((c) => c.number === n)?.first).join(", ")}]`;


/** The state a case is scored on: what the app knows and what its models answered. */
export interface Scored {
  snapshot: Snapshot;
  jev: Record<string, JevRecord>;
  luna: Record<string, LunaRecord>;
  local: { opened: Record<string, number>; done: Record<string, number> } & Pick<LocalState, "pe" | "bring" | "gradeKinds">;
}

/** What the app would show for a case, against what a parent would call right; `thresholds` as the app's unless tried others. */
export function scoreCase(
  c: Case,
  state: Scored,
  thresholds: LunaThresholds = LUNA_THRESHOLDS,
  /** The feed, when already built (scoring the same answers many times). */
  built?: ReturnType<typeof buildFeed>
): { checks: Check[]; events: Record<string, string[]> } {
  const checks: Check[] = [];
  const keyOf = (id: number) => {
    const item = c.items.find((i) => i.id === id)!;
    return item.type === "message" ? `m:${id}` : item.type === "news" ? `n:${id}` : "";
  };

  const snap = state.snapshot;
  const feed = built ?? buildFeed(state);
  for (const t of c.expect.triage ?? []) {
    const a = state.jev[keyOf(t.item)]?.answers;
    if (t.needs_action !== undefined) {
      // Needs you as the app shows it: the decisions' first answer with the reading's look at the step (feed.ts).
      const item = feed.find((i) => i.key === keyOf(t.item));
      const p = item?.triage ? item.triage.needsAction : null;
      const first = item?.triage?.firstNeedsAction;
      checks.push({
        task: "triage",
        what: `item ${t.item} needs you: ${t.needs_action ? "yes" : "no"}`,
        ok: p !== null && isNeedsYou(item!) === t.needs_action,
        got: p === null ? "no answer" : `${p.toFixed(2)}${first !== undefined && first !== p ? ` (first ${first.toFixed(2)})` : ""}`,
      });
    }
    for (const q of ["kind", "scope"] as const) {
      const want = t[q];
      if (!want) continue;
      const got = a?.[q]?.type === "choice" ? a[q].choice : null;
      checks.push({ task: "triage", what: `item ${t.item} ${q} ∈ ${want.join("/")}`, ok: got !== null && want.includes(got), got: got ?? "no answer" });
    }
  }

  for (const want of c.expect.action ?? []) {
    const item = feed.find((i) => i.key === keyOf(want.item));
    // The reading's step sentence (a list shows a changed day's sentence instead when nothing is asked: feed.ts lineOf).
    const quote = item?.own ? null : item?.triage?.detail?.actionLine ?? null;
    const required = item?.triage?.detail?.confirm ?? null;
    const shown = `${quote ? `"${quote}"` : "no step"}${required !== null ? ` (required ${required.toFixed(2)})` : ""}${item?.deadline ? ` by ${item.deadline}` : ""}`;
    if (want.none) {
      checks.push({ task: "action", what: `item ${want.item}: no required step`, ok: !quote || (required ?? 0) < 0.5, got: shown });
      continue;
    }
    if (want.quote !== undefined)
      checks.push({ task: "action", what: `item ${want.item}: the step says "${want.quote}"`, ok: Boolean(quote && quote.toLowerCase().includes(want.quote.toLowerCase())), got: shown });
    if (want.deadline !== undefined) checks.push({ task: "action", what: `item ${want.item}: by ${want.deadline ?? "no date"}`, ok: (item?.deadline ?? null) === want.deadline, got: shown });
  }

  for (const t of c.expect.tone ?? []) {
    const item = c.items.find((i) => i.id === t.item) as Extract<CaseItem, { type: "note" }>;
    const record = Object.entries(state.jev).find(([k]) => k.startsWith(`note:${snap.children[item.pupil].number}:${item.date}:${item.kind}:`) && !k.includes("#"))?.[1];
    const got = record?.answers.tone?.type === "choice" ? record.answers.tone.choice : null;
    checks.push({ task: "tone", what: `note ${t.item} tone: ${t.tone}`, ok: got === t.tone, got: got ?? "no answer" });
  }

  for (const want of c.expect.noteKind ?? []) {
    const item = c.items.find((i) => i.id === want.item) as Extract<CaseItem, { type: "note" }>;
    // As the app reads it (data/notes.ts): praise from its own question, else the kind.
    const record = state.jev[`label:${item.kind}`];
    const got = record ? (labelKinds({ [`label:${item.kind}`]: record })[item.kind] ?? "unsure") : null;
    const praise = record?.answers.praise?.type === "noul" ? record.answers.praise.noul : null;
    const kind = record?.answers.note_kind?.type === "choice" ? record.answers.note_kind : null;
    checks.push({ task: "tone", what: `note ${want.item} "${item.kind}" is ${want.kind}`, ok: got === want.kind, got: got ? `${got} (praise ${praise?.toFixed(2) ?? "–"}, kind ${kind ? `${kind.choice} ${kind.confidence.toFixed(2)}` : "–"})` : "no answer" });
  }

  for (const want of c.expect.noteExam ?? []) {
    const source = c.items.find((i) => i.id === want.item) as Extract<CaseItem, { type: "note" }>;
    const item = feed.find((i) => i.note?.child === snap.children[source.pupil].number && i.note.date === source.date && i.note.note === source.text);
    const exam = item?.pupilExam;
    checks.push({ task: "action", what: `note ${want.item}: pupil exam ${want.important ? "retained" : "absent"}`, ok: Boolean(exam) === want.important, got: exam?.quote ?? "no pupil exam" });
    const home = examsNeedingAttention(feed, c.today).some((i) => i.key === item?.key);
    checks.push({ task: "action", what: `note ${want.item}: home exam attention ${want.important ? "shown" : "absent"}`, ok: home === want.important, got: home ? "shown on home" : "absent from home" });
    checks.push({ task: "action", what: `note ${want.item}: no guardian task`, ok: Boolean(item) && !isNeedsYou(item!), got: item && isNeedsYou(item) ? "needs guardian" : "no guardian task" });
    if (want.quote !== undefined) checks.push({ task: "action", what: `note ${want.item}: pupil exam says "${want.quote}"`, ok: Boolean(exam?.quote.toLowerCase().includes(want.quote.toLowerCase())), got: exam?.quote ?? "no pupil exam" });
    if (want.date !== undefined) checks.push({ task: "calendar", what: `note ${want.item}: next lesson ${want.date ?? "unconfirmed"}`, ok: Boolean(exam) && exam!.date === want.date, got: exam ? exam.date ?? "unconfirmed" : "no pupil exam" });
    if (want.originalExam !== undefined) checks.push({ task: "calendar", what: `note ${want.item}: original exam ${want.originalExam ?? "unlinked"}`, ok: Boolean(exam) && exam!.originalExamId === want.originalExam, got: exam?.originalExamId === null ? "unlinked" : String(exam?.originalExamId ?? "no pupil exam") });
  }

  for (const m of c.expect.marks ?? []) {
    const item = c.items.find((i) => i.id === m.item) as Extract<CaseItem, { type: "mark" }>;
    const child = snap.children[item.pupil].number;
    const exam = snap.perChild[child].pastExams!.exams.find((e) => e.name === item.name && e.date === item.date)!;
    const shown = examMark(exam, state.jev[markKey(resultKey(child, exam))]);
    const problems: string[] = [];
    if (!kinds(m.kind)!.includes(shown.kind)) problems.push(`kind ${shown.kind}`);
    if (m.text !== undefined && shown.text !== m.text) problems.push(`shown "${shown.text}"`);
    if (m.value !== undefined && shown.value !== m.value) problems.push(`value ${shown.value}`);
    if (m.share && (shown.share === null || shown.share < m.share[0] || shown.share > m.share[1])) problems.push(`share ${shown.share === null ? "none" : shown.share.toFixed(2)}`);
    checks.push({
      task: "marks",
      what: `"${item.grade}"${item.info ? ` (${item.info.split("\n")[0]})` : ""} → ${kinds(m.kind)!.join("/")}${m.text ? ` "${m.text}"` : ""}`,
      ok: !problems.length,
      got: problems.join(", ") || `${shown.kind} "${shown.text}"${shown.share !== null ? ` ${shown.share.toFixed(2)}` : ""}`,
    });
  }

  // What the AI read each subject's name as. Only its own answer counts: the name's words standing in for it is a miss.
  const said = (from: string, value: string, sure?: number) => (from === "ai" ? `${value}${sure === undefined ? "" : ` (${sure.toFixed(2)})`}` : `no AI answer (the name says ${value})`);
  for (const want of c.expect.subjects ?? []) {
    const lesson = { subject: want.subject, subjectCode: "" };
    if (want.pe !== undefined) {
      const { pe, from } = peOf(lesson, state.local.pe);
      checks.push({ task: "subjects", what: `"${want.subject}" ${want.pe ? "is" : "isn't"} PE`, ok: from === "ai" && pe === want.pe, got: said(from, pe ? "PE" : "not PE", state.local.pe?.[want.subject]?.ai) });
    }
    if (want.bring !== undefined) {
      const { bring, from } = bringOf(lesson, state.local.bring);
      checks.push({ task: "subjects", what: `"${want.subject}" ${want.bring ? "is" : "isn't"} on the Bring line`, ok: from === "ai" && bring === want.bring, got: said(from, bring ? "packed for" : "not packed for", state.local.bring?.[want.subject]?.ai) });
    }
    if (want.kind !== undefined) {
      const { kind, from } = kindOf(want.subject, state.local.gradeKinds);
      checks.push({ task: "subjects", what: `"${want.subject}" on the report card → ${kinds(want.kind)!.join("/")}`, ok: from === "ai" && kinds(want.kind)!.includes(kind), got: said(from, kind) });
    }
  }

  // The calendar as the app would draw it: the read events (no exact Wilma data in these cases).
  const events: Record<string, string[]> = {};
  const cal = c.expect.calendar;
  {
    const list = calendarEvents(snap, feed, undefined, { from: c.today, until: addDays(c.today, 200), children: [] }, state.luna, thresholds);
    events.luna = list.map((e) => describe(e, snap));
    const tag = "";
    if (cal) {
    for (const want of cal.events ?? []) {
      const match = list.find(
        (e) =>
          e.date === want.date &&
          (want.endDate === undefined || e.endDate === want.endDate) &&
          (want.start === undefined || e.start === want.start) &&
          (!kinds(want.kind) || kinds(want.kind)!.includes(e.kind)) &&
          (want.pupil === undefined || e.children.includes(snap.children[want.pupil].number)) &&
          (!want.sure || e.sure) &&
          (want.title === undefined || new RegExp(want.title, "i").test(e.title))
      );
      const near = list.filter((e) => e.date === want.date).map((e) => describe(e, snap));
      checks.push({
        task: "calendar",
        what: `${tag}${want.date}${want.endDate ? `–${want.endDate}` : ""}${want.start ? ` ${want.start}` : ""} ${kinds(want.kind)?.join("/") ?? "any"}${want.title ? ` /${want.title}/` : ""}${want.sure ? " in the calendar" : ""}${want.note ? ` (${want.note})` : ""}`,
        ok: Boolean(match),
        got: match ? describe(match, snap) : near.length ? near.join("; ") : "nothing that day",
        gap: Boolean(c.gap),
      });
    }
    // Every view tells the same: a sure exam read from a note or a message is also on the Exams page and Today's glance.
    const listed = readExams(snap, feed, state.luna, undefined, { from: c.today, until: addDays(c.today, 200), children: [] });
    for (const want of cal.events ?? []) {
      if (!want.sure || !kinds(want.kind)?.includes("exam") || kinds(want.kind)!.length > 1) continue;
      const shown = list.find(
        (e) =>
          e.date === want.date &&
          e.kind === "exam" &&
          e.sure &&
          (want.start === undefined || e.start === want.start) &&
          (want.title === undefined || new RegExp(want.title, "i").test(e.title)) &&
          (want.pupil === undefined || e.children.includes(snap.children[want.pupil].number))
      );
      if (!shown?.origin) continue; // not in the calendar (the check above fails it), or Wilma's own exam (listed anyway)
      const there = listed.some((e) => e.key === shown.key);
      checks.push({ task: "calendar", what: `${tag}${want.date} exam also in Exams and Today`, ok: there, got: there ? "listed" : "in the calendar only", gap: Boolean(c.gap) });
    }
    for (const no of cal.not ?? []) {
      const bad = list.filter(
        (e) =>
          e.date <= no.date &&
          (e.endDate ?? e.date) >= no.date &&
          (e.sure || no.suggestions === false) &&
          (no.pupil === undefined || e.children.includes(snap.children[no.pupil].number)) &&
          (!kinds(no.kind) || kinds(no.kind)!.includes(e.kind)) &&
          (no.start === undefined || e.start === no.start)
      );
      const whose = no.pupil === undefined ? "" : ` for ${snap.children[no.pupil].first}`;
      const what = `${tag}no ${kinds(no.kind)?.join("/") ?? "event"} on ${no.date}${no.start ? ` at ${no.start}` : ""}${whose}${no.note ? ` (${no.note})` : ""}`;
      checks.push({ task: "calendar", what, ok: !bad.length, got: bad.map((e) => describe(e, snap)).join("; ") || "nothing", gap: Boolean(c.gap) });
    }
    for (const most of cal.atMost ?? []) {
      const that = list.filter(
        (e) =>
          e.date <= most.date &&
          (e.endDate ?? e.date) >= most.date &&
          (most.pupil === undefined || e.children.includes(snap.children[most.pupil].number)) &&
          (!kinds(most.kind) || kinds(most.kind)!.includes(e.kind))
      );
      const whose = most.pupil === undefined ? "" : ` for ${snap.children[most.pupil].first}`;
      checks.push({
        task: "calendar",
        what: `${tag}at most ${most.max} ${kinds(most.kind)?.join("/") ?? "event"}${most.max === 1 ? "" : "s"} on ${most.date}${whose}${most.note ? ` (${most.note})` : ""}`,
        ok: that.length <= most.max,
        got: that.map((e) => describe(e, snap)).join("; ") || "none",
        gap: Boolean(c.gap),
      });
    }
    for (const pattern of cal.titlesNot ?? []) {
      const bad = list.filter((e) => new RegExp(pattern, "i").test(e.title));
      checks.push({ task: "calendar", what: `${tag}no title like /${pattern}/`, ok: !bad.length, got: bad.map((e) => describe(e, snap)).join("; ") || "none" });
    }
    if (cal.maxDays !== undefined) {
      const long = list.filter((e) => e.endDate && (RealDate.parse(e.endDate) - RealDate.parse(e.date)) / 86_400_000 + 1 > cal.maxDays!);
      checks.push({ task: "calendar", what: `${tag}no event longer than ${cal.maxDays} days`, ok: !long.length, got: long.map((e) => describe(e, snap)).join("; ") || "none" });
    }
    }
  }
  return { checks, events };
}
