/*
 * Sorting with Jev's questions, answered by OpenAI's Luna decisions or the
 * explicitly enabled local Clef profile (luna/decisions.ts). Jev's own answers from
 * before are kept as a baseline (state.jevBaseline) to compare with
 * (luna/compare.ts); Jev itself answers only when the eval suite asks it to
 * (settings.decider "jev"), to compare on the same cases.
 *
 * Only when the parent has added a key and left it on. Each item is one
 * request with just that item and the child's first name; answers are
 * cached by question set and content, so an item is asked about again only
 * when its text changes (for example once an unread message is opened).
 * Exam marks are read the same way, one exam per request (questions.ts,
 * markQuestions); a mark that is points or a scale then has its maximum read
 * (luna/marks.ts). What an item says (the step, its deadline, the dates) is
 * Luna's reading, not a question here (luna/events.ts).
 * Jev refuses calls from web pages, so the desktop app's native side (or, in
 * browser development, the local bridge) sends them.
 */
import { bridgeCall } from "../wilma/transport";
import { accountScope, getState, setState } from "../data/store";
import { awaitingReply, intelligenceOn, pupilName, viewerOf, type JevAnswer, type JevRecord, type Snapshot, type Viewer } from "../data/model";
import { localDecisions, providerIdentity, usesLocalAI } from "../ai/config";
import { prepareOllama } from "../ai/ollama";
import { dateOf, daysBetween, dayNameLongEn as dayNameLong, longDateEn as longDate, today } from "../data/dates";
import { finnishParts } from "@wilma-client/src/finnish-time";
import { HOMEWORK_QS, MARK_QS, NOTE_LABEL_QS, TONE_PUPIL_QS, TONE_QS, TRIAGE_PUPIL_QS, TRIAGE_QS, homeworkQuestions, markQuestions, noteLabelQuestions, toneQuestions, tonePupilQuestions, triagePupilQuestions, triageQuestions, type Entry, type Question } from "./questions";
import { examResults, resultKey } from "../data/grades";
import { markKey } from "../data/marks";
import { readMaximum } from "../luna/marks";
import type { PastExam } from "@wilma-client/src/core";
import { noteGroups } from "../data/feed";
import { isUnexplained, labelKey } from "../data/notes";
import { homeworkKey, homeworkSentences, MAX_SENTENCES } from "../data/homework";
import { askDecisions } from "../luna/decisions";
import { LunaError, openAIBlockedMessage, openAIReady } from "../luna/client";
import { saveCompareReport } from "../luna/compare";
import { aboutShown } from "../data/logins";
import { t } from "../i18n";

const MAX_TEXT = 6000;
const CONCURRENCY = 3;
const PER_RUN = 80;

export class JevError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = "JevError";
  }
}

interface JevResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

async function post(key: string, body: unknown): Promise<{ status: number; retryAfter: string | null; text: string }> {
  const r = await bridgeCall<{ status: number; retryAfter: string | null; body: string }>("jev", {
    body,
    headers: { "x-jev-key": key },
  });
  return { status: r.status, retryAfter: r.retryAfter, text: r.body };
}

export async function askJev(key: string, model: string, state: Entry, questions: Record<string, Question>): Promise<JevResponse> {
  for (let attempt = 1; ; attempt += 1) {
    const r = await post(key, { state, model, questions });
    if (r.status === 200) {
      const data = JSON.parse(r.text) as JevResponse;
      for (const name of Object.keys(questions)) {
        if (!data.answers?.[name]) throw new JevError(t("Jev's answer was missing a question"), false);
      }
      return data;
    }
    if (r.status === 401 || r.status === 403) throw new JevError(t("Jev didn't accept the API key."), false);
    if (r.status === 402) throw new JevError(t("The Jev account has no credits left."), false);
    const retryable = r.status === 429 || r.status === 529 || r.status >= 500;
    if (!retryable || attempt >= 4) throw new JevError(t("Jev answered HTTP {status}.", { status: r.status }), retryable);
    const wait = Number(r.retryAfter) > 0 ? Math.min(Number(r.retryAfter) * 1000, 30_000) : 300 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

function hash(value: unknown): string {
  // FNV-1a: only to notice changed content, not for security.
  let h = 0x811c9dc5;
  const s = JSON.stringify(value);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function when(instant: Date): string {
  const p = finnishParts(instant);
  const iso = dateOf(instant);
  return `${dayNameLong(iso)} ${longDate(iso)} ${p.year} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

const clip = (text: string, max = MAX_TEXT) => (text.length > max ? `${text.slice(0, max)}…` : text);

interface Job {
  key: string;
  qs: string;
  questions: Record<string, Question>;
  item: Entry;
  pupil: string;
  at: number;
  meta?: JevRecord["meta"];
  /** An exam mark's job: its maximum is read once the decisions say it's points or a scale. */
  mark?: PastExam;
}

const STAGE_TWO_FROM = 0.35;

/** Everything worth asking about, newest first. */
function jobs(snap: Snapshot, who: Viewer): Job[] {
  const now = today();
  // A student's own login: the questions are asked of the pupil reading it (questions.ts).
  const triage = who === "student" ? { qs: TRIAGE_PUPIL_QS, questions: triagePupilQuestions } : { qs: TRIAGE_QS, questions: triageQuestions };
  const tone = who === "student" ? { qs: TONE_PUPIL_QS, questions: tonePupilQuestions } : { qs: TONE_QS, questions: toneQuestions };
  // The family's first child the item is for, in the family's order: the same name every time, so Jev isn't asked again
  // just because a sync listed the siblings in another order.
  const first = (numbers: string[]) => {
    const child = snap.children.find((c) => numbers.includes(c.number));
    return child ? pupilName(snap, child.number) : "the pupil";
  };
  const list: Job[] = [];
  const recent = (d: Date | null, days: number) => d && Date.parse(now) - d.getTime() < days * 86_400_000;

  for (const m of Object.values(snap.messages)) {
    // The family's own message, not answered yet: nothing to ask about it until someone answers. An unticked child's isn't asked about.
    if ((!recent(m.sentAt, 60) && !m.unreadInWilma) || awaitingReply(m) || !aboutShown(snap, m.children)) continue;
    const item: Record<string, Entry> = {
      type: "Wilma message",
      from: m.sender,
      sent: when(m.sentAt),
      subject: m.subject,
    };
    if (m.thread) {
      item.text = clip(m.thread.content);
      if (m.thread.replies.length) {
        item.replies = m.thread.replies.slice(-3).map((r) => ({ from: r.senderName, sent: when(r.sentAt), text: clip(r.content, 800) }));
      }
    } else {
      item.note = "Only the subject is known; the message hasn't been opened yet.";
    }
    list.push({ key: `m:${m.id}`, ...triage, item, pupil: first(m.children), at: m.sentAt.getTime() });
  }
  for (const n of Object.values(snap.news)) {
    if ((!n.pinned && !recent(n.published, 45)) || !aboutShown(snap, n.children)) continue;
    const item: Record<string, Entry> = {
      type: "Wilma bulletin to families",
      from: n.author,
      sent: n.published ? when(n.published) : null,
      subject: n.title,
      summary: n.subtitle,
    };
    if (n.detail) item.text = clip(n.detail.content);
    list.push({ key: `n:${n.id}`, ...triage, item, pupil: first(n.children), at: n.published?.getTime() ?? 0 });
  }
  for (const child of snap.children) {
    for (const note of noteGroups(child.number, snap.perChild[child.number]?.notes ?? [])) {
      if (!note.note || note.date > today()) continue;
      list.push({
        key: note.key,
        ...tone,
        item: { type: "Teacher's lesson note", date: note.date, subjects: note.subjects, kind: note.typeLabel, teacher: note.teachers.join(", "), text: clip(note.note, 1500) },
        pupil: child.first,
        at: Date.parse(note.date),
      });
    }
  }
  // Note types: what kind each of the school's labels is, asked once per label (its newest note first). An unexplained
  // absence is Wilma's own state and stays a code rule (data/notes.ts).
  const labels = new Map<string, number>();
  for (const child of snap.children) {
    const data = snap.perChild[child.number];
    for (const note of [...(data?.notes ?? []), ...(data?.yearNotes?.notes ?? [])]) {
      if (!note.typeLabel.trim() || isUnexplained(note)) continue;
      labels.set(note.typeLabel, Math.max(labels.get(note.typeLabel) ?? 0, Date.parse(note.date)));
    }
  }
  for (const [label, at] of labels)
    list.push({ key: labelKey(label), qs: NOTE_LABEL_QS, questions: noteLabelQuestions, item: { type: "The type of a teacher's note on a lesson, as the school named it", label }, pupil: "", at });
  // Exam marks: what each one is (a grade, points, another scale, letters…), read once per mark.
  for (const child of snap.children) {
    for (const exam of examResults(snap.perChild[child.number])) {
      if (!exam.grade) continue;
      list.push({
        key: markKey(resultKey(child.number, exam)),
        qs: MARK_QS,
        questions: markQuestions(),
        mark: exam,
        item: {
          type: "A mark in Wilma's list of past exams",
          subject: exam.subject,
          exam: exam.name || null,
          date: exam.date,
          mark: exam.grade,
          verbal_assessment: exam.verbalGrade,
          teacher_note: exam.info ? clip(exam.info, 1500) : null,
        },
        pupil: child.first,
        at: Date.parse(exam.date),
      });
    }
  }
  // Homework: what each text gives the class to do, and which sentences are for pupils who were away, once per text
  // (siblings in one class share it). The last three weeks: the Homework view's two weeks and what's due in them.
  const homework = new Set<string>();
  for (const child of snap.children) {
    for (const hw of snap.perChild[child.number]?.overview?.homework ?? []) {
      const key = homeworkKey(hw);
      if (!hw.homework.trim() || !hw.date || daysBetween(hw.date, now) > 21 || homework.has(key)) continue;
      homework.add(key);
      const sentences = homeworkSentences(hw.homework);
      const asked = sentences.length <= MAX_SENTENCES ? sentences : [];
      list.push({
        key,
        qs: HOMEWORK_QS,
        questions: homeworkQuestions(asked.length),
        item: {
          type: "Homework a teacher wrote in Wilma after a lesson",
          subject: hw.subject,
          set: hw.date,
          text: asked.length ? asked.map((s, i) => `(${i + 1}) ${s.trim()}`).join("\n") : clip(hw.homework, 1500),
        },
        pupil: "",
        at: Date.parse(hw.date),
      });
    }
  }
  return list.sort((a, b) => b.at - a.at);
}

/** What's to ask, each only when its content changed: triage, note tones and exam marks. */
function waitingJobs(): { job: Job; h: string }[] {
  const { snapshot, local } = getState();
  if (!snapshot) return [];
  return jobs(snapshot, viewerOf(snapshot.account, local))
    .map((job) => ({ job, h: hash([providerIdentity(getState().settings), job.qs, job.pupil, job.item, job.questions]) }))
    .filter(({ job, h }) => {
      const have = getState().jev[job.key];
      // Answers from the other decider (Jev's from before the experiment) are asked again.
      return !have || have.hash !== h || have.qs !== job.qs;
    });
}

/** What's waiting for Jev, and why: never asked (new), or its content changed since (changed). */
export function jevBacklog(): { cached: number; new: string[]; changed: { key: string; fields: string[] }[] } {
  const { jev } = getState();
  const waiting = waitingJobs();
  return {
    cached: Object.keys(jev).length,
    new: waiting.filter(({ job }) => !jev[job.key]).map(({ job }) => job.key),
    changed: waiting
      .filter(({ job }) => jev[job.key])
      .map(({ job }) => ({ key: job.key, fields: changedFields(job) })),
  };
}

/** Which parts of an item differ from what Jev last saw (from the stored hash of each part). */
function changedFields(job: Job): string[] {
  const record = getState().jev[job.key];
  if (!record?.parts) return ["(asked before parts were kept)"];
  const now = partHashes(job);
  return Object.keys(now).filter((part) => record.parts![part] !== now[part]);
}

function partHashes(job: Job): Record<string, string> {
  const item = (job.item && typeof job.item === "object" && !Array.isArray(job.item) ? job.item : {}) as Record<string, Entry>;
  return {
    qs: hash(job.qs),
    pupil: hash(job.pupil),
    questions: hash(Object.keys(job.questions)),
    ...Object.fromEntries(Object.entries(item).map(([k, v]) => [`item.${k}`, hash(v)])),
  };
}

/** Luna's errors as the runner's own (a key OpenAI refuses stops the run like Jev's). */
function lunaToJev(err: unknown): never {
  throw err instanceof LunaError ? new JevError(err.message, err.retryable) : err;
}

let running: Promise<void> | null = null;

/** Before Luna answers anything, Jev's own answers are put aside once, as the baseline to compare with. */
function keepBaseline() {
  const { jev, jevBaseline } = getState();
  if (Object.keys(jevBaseline).length) return;
  const fromJev = Object.fromEntries(Object.entries(jev).filter(([, r]) => r.model.startsWith("jev-")));
  if (Object.keys(fromJev).length) setState({ jevBaseline: fromJev });
}

export function runJev(): Promise<void> {
  const scope = accountScope();
  running ??= (async () => {
    if (usesLocalAI(getState().settings) && intelligenceOn(getState().settings)) {
      try { await prepareOllama(); }
      catch (err) {
        if (scope !== accountScope()) return;
        setState((s) => ({ jevStatus: { ...s.jevStatus, running: false, error: err instanceof Error ? err.message : String(err) } }));
        return;
      }
      if (scope !== accountScope()) return;
      setState((s) => ({ jevStatus: { ...s.jevStatus, error: null } }));
    }
    if (scope !== accountScope()) return;
    keepBaseline();
    // A few passes at most: each pass takes the newest items still unsorted.
    for (let pass = 0; pass < 8; pass += 1) {
      if (scope !== accountScope()) break;
      const more = await run();
      if (!more) break;
    }
    if (scope === accountScope()) await saveCompareReport();
  })().finally(() => {
    running = null;
    if (scope !== accountScope() && getState().phase === "ready" && getState().snapshot) void runJev();
  });
  return running;
}

/** One pass. Returns true when more items are waiting and it's worth another pass. */
async function run(): Promise<boolean> {
  const { settings, snapshot } = getState();
  const byJev = settings.decider === "jev" && !localDecisions(settings);
  if (!snapshot || !intelligenceOn(settings) || (byJev && !settings.jevKey.trim())) return false;
  const identity = providerIdentity(settings);
  const scope = accountScope();
  const current = () => scope === accountScope() && intelligenceOn(getState().settings) && providerIdentity(getState().settings) === identity;
  const local = usesLocalAI(settings);
  // OpenAI unreachable from this network a moment ago: say so, and leave everything waiting for later.
  if (!byJev && !localDecisions(settings) && !(await openAIReady())) {
    if (current()) setState((s) => ({ jevStatus: { ...s.jevStatus, running: false, error: openAIBlockedMessage() } }));
    return false;
  }
  if (!current()) return false;
  const maxima: { job: Job; h: string }[] = [];
  const todayText = `${dayNameLong(today())} ${longDate(today())} ${today().slice(0, 4)}`;
  const waiting = waitingJobs();
  const pending = waiting.slice(0, PER_RUN);
  if (!pending.length) return false;

  // Why each is asked: new to Jev, or changed since (and which parts), so a re-sort is visible as one.
  const { jev } = getState();
  const changed = pending.filter(({ job }) => jev[job.key]);
  const parts: Record<string, number> = {};
  for (const { job } of changed) for (const part of changedFields(job)) parts[part] = (parts[part] ?? 0) + 1;
  setState((s) => {
    const changedParts = { ...s.jevStatus.changedParts };
    for (const [part, n] of Object.entries(parts)) changedParts[part] = (changedParts[part] ?? 0) + n;
    return {
      jevStatus: {
        ...s.jevStatus,
        running: true,
        done: 0,
        total: pending.length,
        error: null,
        newItems: s.jevStatus.newItems + pending.length - changed.length,
        changedItems: s.jevStatus.changedItems + changed.length,
        changedParts,
      },
    };
  });
  const stop: { error: JevError | null } = { error: null };
  let index = 0;
  const worker = async () => {
    while (index < pending.length && !stop.error && current()) {
      const { job, h } = pending[index++];
      try {
        const state = { today: todayText, pupil: job.pupil, item: job.item };
        const { jevKey, jevModel } = getState().settings;
        const answer = byJev
          ? await askJev(jevKey.trim(), jevModel, state, job.questions)
          : await askDecisions(state, job.questions).catch(lunaToJev);
        if (!current()) return;
        // Points or a scale: its maximum, read from the mark, the name and the note (luna/marks.ts).
        const kind = answer.answers.kind;
        const scored = kind?.type === "choice" && kind.confidence >= 0.5 && (kind.choice === "points" || kind.choice === "other_scale");
        const needsMaximum = job.mark && scored && !(job.mark.grade ?? "").includes("/");
        if (local && needsMaximum) maxima.push({ job, h });
        const meta = needsMaximum && !local ? { maximum: await readMaximum(job.mark!).catch(lunaToJev) } : job.meta;
        const record: JevRecord = { qs: job.qs, hash: h, parts: partHashes(job), model: answer.model, at: Date.now(), answers: answer.answers, meta };
        if (!current()) return;
        setState((s) => ({
          jev: { ...s.jev, [job.key]: record },
          jevStatus: {
            ...s.jevStatus,
            done: s.jevStatus.done + 1,
            calls: s.jevStatus.calls + 1,
          },
        }));
      } catch (err) {
        if (!current()) return;
        if (local) stop.error = err instanceof JevError ? err : new JevError(err instanceof Error ? err.message : String(err), false);
        else if (err instanceof JevError && !err.retryable) stop.error = err;
        else setState((s) => ({ jevStatus: { ...s.jevStatus, done: s.jevStatus.done + 1, error: err instanceof Error ? err.message : String(err) } }));
      }
    }
  };
  await Promise.all(Array.from({ length: local ? 1 : CONCURRENCY }, worker));
  // Read all mark maxima after the decision phase to avoid repeatedly swapping models.
  for (const { job, h } of maxima) {
    if (stop.error || !current()) break;
    try {
      const maximum = await readMaximum(job.mark!).catch(lunaToJev);
      if (current()) setState((s) => ({ jev: { ...s.jev, [job.key]: { ...s.jev[job.key], meta: { maximum } } } }));
    } catch (err) {
      // Leave this mark waiting so a runtime failure can be retried.
      if (current()) setState((s) => ({ jev: { ...s.jev, [job.key]: { ...s.jev[job.key], hash: `${h}/maximum-failed` } } }));
      stop.error = err instanceof JevError ? err : new JevError(err instanceof Error ? err.message : String(err), false);
    }
  }
  if (!current()) return false;
  setState((s) => ({ jevStatus: { ...s.jevStatus, running: false, error: stop.error ? stop.error.message : s.jevStatus.error } }));
  // Another pass when more is waiting: the rest of a long list.
  return !stop.error && current() && waitingJobs().length > 0;
}
