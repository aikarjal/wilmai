/*
 * Luna's reading: one read of every message, bulletin and teacher's lesson
 * note for what a family needs from it, in place of code's date patterns and
 * line picking.
 *  1. The reading model (Luna by default; Responses, structured outputs) reads
 *     the whole text and gives: the one sentence that says what the guardian
 *     must do, with its deadline, and the dated events a family puts in its
 *     calendar (the date with relative words resolved from the day it was
 *     sent, a time, a short title, a kind, whom it's for, and the words it
 *     read it from).
 *  2. Code keeps only what's quoted word for word from the text, with dates
 *     and times that are dates and times; nothing else is read by code.
 *  3. Luna's Decisions check with probabilities: each event's date, whether
 *     it belongs in this family's calendar (not a possible day for whoever
 *     needs it, not another group's), and whether the step is required of
 *     the guardian (the feed's second look at "needs you").
 * Each item is read once, and again when its text (or the reading model)
 * changes. Nothing here sends anything to Wilma.
 */
import { accountScope, getState, setState } from "../data/store";
import { noteGroups } from "../data/feed";
import { awaitingReply, intelligenceOn, pupilName, viewerOf, type LunaEvent, type LunaRecord, type Snapshot, type Viewer } from "../data/model";
import { addDays, dateOf, dayNameLongEn, longDateEn, today } from "../data/dates";
import { LUNA, LunaError, READING_EFFORT, countItem, decide, openAIBlockedMessage, openAIReach, openAIReady, readingModel, respond, type DecisionQuestion } from "./client";
import { saveCompareReport } from "./compare";
import { runLinks } from "./links";
import { runSubjects } from "./subjects";
import { localReading, providerIdentity, usesLocalAI } from "../ai/config";
import { releaseLocalModels } from "../ai/ollama";
import { runJev } from "../jev/runner";
import { subjectNamer } from "../data/schedule";
import { hash } from "../data/hash";
import { runTranslations } from "../data/translations";
import { aboutShown } from "../data/logins";

/** The reading's version: a change here reads everything again. */
export const LUNA_EVENTS = "luna-reading@5";
/** Only notes need rereading for the new relative-lesson instruction. */
const LUNA_NOTE_EXAMS = "luna-note-exams@1";
const DAYS_BACK = 120;
const CONCURRENCY = 3;

/** One thing to read: a message, a bulletin or a lesson note, as Luna gets it. */
export interface LunaSource {
  key: string;
  kind: "message" | "news" | "note";
  children: string[];
  /** The text the quote must be found in (subject and body). */
  body: string;
  /** What Luna reads: the item's facts and its text. */
  input: string;
  /** The pupils it was read for: first name, number, and how the models are told ("Aino (9C)"), to tell whose each event is. */
  pupils: { first: string; number: string; label: string }[];
  /** For a note: its lesson's day and start (the calendar opens that lesson). */
  note?: { child: string; date: string; start: string | null; detail: string };
  title: string;
  /** When it was sent or published (ms; a note: its lesson's day), to tell which of two items is the later. */
  sent: number;
  /** Who reads it: a guardian, or the pupil in their own Wilma (a student's login); the questions are asked for them. */
  reader: Viewer;
}

export const day = (iso: string) => `${dayNameLongEn(iso)} ${longDateEn(iso)} ${iso.slice(0, 4)}`;

/** Everything there is to read for the calendar: recent messages and bulletins with their text, and lesson notes with words. */
export function lunaSources(snap: Snapshot, reader: Viewer = viewerOf(snap.account, getState().local)): LunaSource[] {
  const now = today();
  // A student's own login: every item says the pupil reads it (and so reads apart from a guardian's reading of it).
  const student = reader === "student";
  const readBy: [string, string | null] = ["Read by", student ? "The pupil themself, in their own Wilma (not a guardian)" : null];
  // "Aino (9C)": with the class, an "8. lk" event or another group's lesson can be told from the child's own.
  const names = (numbers: string[]) => snap.children.filter((c) => numbers.includes(c.number)).map((c) => pupilName(snap, c.number));
  const recent = (d: Date | null) => d !== null && Date.parse(now) - d.getTime() <= DAYS_BACK * 86_400_000;
  const out: LunaSource[] = [];
  const add = (key: string, kind: LunaSource["kind"], children: string[], facts: [string, string | null][], subject: string, text: string, sent: number, note?: LunaSource["note"]) => {
    const lines = facts.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
    const pupils = snap.children.filter((c) => children.includes(c.number)).map((c) => ({ first: c.first, number: c.number, label: pupilName(snap, c.number) }));
    out.push({ key, kind, children, pupils, title: subject, body: `${subject}\n${text}`, input: `${lines.join("\n")}\nSubject: ${subject}\n\n${text}`, note, sent, reader });
  };
  for (const m of Object.values(snap.messages)) {
    // The family's own message, not answered yet: their words, nothing to read for them (an answer is). An unticked child's isn't read.
    if (!m.thread?.content || !recent(m.sentAt) || awaitingReply(m) || !aboutShown(snap, m.children)) continue;
    add(
      `m:${m.id}`,
      "message",
      m.children,
      [["Type", student ? "A Wilma message in the pupil's own inbox" : "A Wilma message to the guardians"], readBy, ["From", m.sender], ["Sent", day(dateOf(m.sentAt))], ["Pupils", names(m.children).join(", ")]],
      m.subject,
      m.thread.content,
      m.sentAt.getTime()
    );
  }
  for (const n of Object.values(snap.news)) {
    if (!n.detail?.content || !(n.pinned || recent(n.published)) || !aboutShown(snap, n.children)) continue;
    add(
      `n:${n.id}`,
      "news",
      n.children,
      [["Type", student ? "A Wilma bulletin" : "A Wilma bulletin to families"], readBy, ["From", n.author], ["Published", n.published ? day(dateOf(n.published)) : null], ["Pupils", names(n.children).join(", ")]],
      n.title,
      n.detail.content,
      n.published?.getTime() ?? 0
    );
  }
  for (const child of snap.children) {
    for (const note of noteGroups(child.number, snap.perChild[child.number]?.notes ?? [])) {
      if (!note.note) continue;
      const name = subjectNamer(snap.perChild[child.number]);
      const subject = note.subjects.map((code) => name(code) === code ? code : `${name(code)} (${code})`).join(", ");
      add(
        note.key,
        "note",
        [child.number],
        [
          ["Type", "A teacher's note on a lesson in Wilma"],
          readBy,
          ["Kind", note.typeLabel],
          ["Lesson", `${subject}, ${day(note.date)}${note.start ? ` ${note.start}–${note.end ?? ""}` : ""}`],
          ["Teacher", note.teachers.join(", ")],
          ["Pupil", pupilName(snap, child.number)],
        ],
        `${note.typeLabel}: ${subject}`,
        note.note,
        Date.parse(`${note.date}T${note.start ?? "08:00"}:00`),
        { child: child.number, date: note.date, start: note.start, detail: `${note.typeLabel} · ${subject}` }
      );
    }
  }
  return out;
}

const INSTRUCTIONS = `You read one item from Wilma, the Finnish school system, for a family.

First, action: the one sentence that says what the guardian must do because of this item (reply, give or refuse permission, sign, fill in a form, sign up or register, choose, pay, book a time, or check, bring or return something for the pupil), copied exactly from the text, even when it's asked politely or in the passive ("toivon, että saisin laput takaisin", "suosittelen, että pää tarkistetaan"); a short title for it ("Kuvausluvan palautus"); and its deadline as YYYY-MM-DD if the text gives one. An optional invitation, an offer or information only: quote, title and deadline null.

Then, events: every date in it that the family could put in their calendar:
- exam: an exam or a test, including a make-up exam (rästikoe) or a short test announced for a lesson
- trip: the class goes somewhere outside the school
- event: something on that day to attend or to know of (a parents' evening, a party, a performance, a sports day, a photo day, a health check or a vaccination at school)
- holiday: a holiday or a day off school
- schedule: a school day or week that runs differently (a later start, an earlier end, cancelled lessons, a theme day, a work-experience week, TET)
- deadline: the last day for the family to do something: sign up or apply, reply, pay, bring or return something

Rules:
- Resolve every date to YYYY-MM-DD from the text and the day it was sent (words like "huomenna", "ensi maanantaina", "maanantaina 5.10" without a year). A teacher's note is about its lesson's day unless it names another.
- A last day to sign up, apply, reply, pay, bring or return something ("mennessä", "viimeistään", "by") is its own deadline event, besides the event it is for.
- Leave out dates before the day it was sent, the weekly timetable, the weeks a course or a group meets (its first meeting may be an event), and the weeks over which meetings are held for each family to book (the deadline to book is the event).
- Leave out days when school goes on as usual (school starting again after a holiday, an ordinary school day instead) and anything cancelled ("peruttu", "ei järjestetä"); a moved event is on its new day only.
- A range ("19.–23.10.") is one event with date and end_date. A time ("klo 17.30–18.30") goes in start and end as HH:MM; no time: null.
- A list of days that only apply to whoever needs them (make-up exam days, open help hours) is only_if_needed.
- pupils: which of the pupils named under Pupils it is for, by first name, judged by their class or group ("9. lk" is for the pupil in a 9th class, "8A" only for the pupil in 8A); an empty list when it's for all of them. Leave out events for none of them.
- quote: the words the date is in, copied exactly from the text, one sentence or line at most.
- title: a short calendar title in the text's language, 2 to 6 words, as the school would name it, without the date, the time or the pupil's name; a deadline's title says what is due ("Kuvausluvan palautus", "Ilmoittautuminen vanhempainiltaan").
- Nothing to list: an empty list.`;

/*
 * A student's own login: the same reading, asked for the pupil. The step is what the pupil must do themself; a step only
 * a guardian takes, or one for other classes or grades, isn't theirs. The dates are the pupil's calendar.
 */
const STUDENT_INSTRUCTIONS = INSTRUCTIONS
  .replace(
    "You read one item from Wilma, the Finnish school system, for a family.",
    "You read one item from Wilma, the Finnish school system, for the pupil who reads it in their own Wilma."
  )
  .replace(
    /^First, action:.*$/m,
    `First, action: the one sentence that says what this pupil must do themself because of this item (do or hand in a task, prepare for an exam or a lesson, bring or return something, reply, sign up or register, take part in something), copied exactly from the text, even when it's asked politely, in the passive or of the whole class ("ottakaa sisäpelikengät mukaan", "palauttakaa sopimus opolle"); a short title for it ("Tet-sopimuksen palautus"); and its deadline as YYYY-MM-DD if the text gives one. A step only a guardian takes (a guardian's permission or form, a payment, booking a meeting time, explaining an absence), a step for other classes or grades than this pupil's, an optional invitation, an offer or information only: quote, title and deadline null.`
  )
  .replace("Then, events: every date in it that the family could put in their calendar:", "Then, events: every date in it that the pupil could put in their calendar:")
  .replace("- deadline: the last day for the family to do something: sign up or apply, reply, pay, bring or return something", "- deadline: the last day for the pupil to do something: sign up or apply, reply, hand in, bring or return something");

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["action", "events"],
  properties: {
    action: {
      type: "object",
      additionalProperties: false,
      required: ["quote", "title", "deadline"],
      properties: {
        quote: { type: ["string", "null"], description: "The sentence saying what the guardian must do, copied exactly" },
        title: { type: ["string", "null"], description: "A short title for the step" },
        deadline: { type: ["string", "null"], description: "YYYY-MM-DD" },
      },
    },
    events: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["quote", "date", "end_date", "start", "end", "title", "kind", "for_whom", "pupils"],
        properties: {
          quote: { type: "string" },
          date: { type: "string", description: "YYYY-MM-DD" },
          end_date: { type: ["string", "null"], description: "YYYY-MM-DD, the last day of a range" },
          start: { type: ["string", "null"], description: "HH:MM" },
          end: { type: ["string", "null"], description: "HH:MM" },
          title: { type: "string" },
          kind: { type: "string", enum: ["exam", "trip", "event", "holiday", "schedule", "deadline"] },
          for_whom: { type: "string", enum: ["this_pupil", "pupils_class", "whole_school", "only_if_needed"] },
          pupils: { type: "array", items: { type: "string" }, description: "First names of the pupils it's for; empty: all of them" },
        },
      },
    },
  },
};

interface Extracted {
  action: { quote: string | null; title: string | null; deadline: string | null };
  events: { quote: string; date: string; end_date: string | null; start: string | null; end: string | null; title: string; kind: LunaEvent["kind"]; for_whom: LunaEvent["forWhom"]; pupils: string[] }[];
  next_lesson_exam?: { quote: string; title: string } | null;
}

const NOTE_INSTRUCTIONS = `${INSTRUCTIONS}

For a lesson note, also read next_lesson_exam: a required exam or test this pupil is told to take at the next lesson of the note's subject ("tee seuraavalla englannin tunnilla", even with spelling errors). Copy the instruction exactly and give it a short exam title. This is a pupil's task, not guardian action. The note category (including absence or pre-approved leave) and its neutral tone do not make the instruction unimportant.
- Do not guess a date or use the note's own lesson date for an exam set for a later, unspecified lesson. Keep that instruction in next_lesson_exam and omit it from dated events; code resolves the next lesson from the timetable.
- next_lesson_exam is null for ordinary absences, cancelled or already completed exams, optional practice or general make-up opportunities, an exam with an explicit date, or a next lesson of a different subject than this note. Only the same subject is supported here.`;

const NOTE_SCHEMA = {
  ...SCHEMA,
  required: [...SCHEMA.required, "next_lesson_exam"],
  properties: {
    ...SCHEMA.properties,
    next_lesson_exam: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["quote", "title"],
      properties: { quote: { type: "string" }, title: { type: "string" } },
    },
  },
};

const STUDENT_NOTE_INSTRUCTIONS = NOTE_INSTRUCTIONS.replace(INSTRUCTIONS, STUDENT_INSTRUCTIONS);
/** The schemas say whose step the action is. */
const forPupil = <T extends typeof SCHEMA>(schema: T): T => ({
  ...schema,
  properties: { ...schema.properties, action: { ...schema.properties.action, properties: { ...schema.properties.action.properties, quote: { type: ["string", "null"], description: "The sentence saying what this pupil must do themself, copied exactly" } } } },
});
const STUDENT_SCHEMA = forPupil(SCHEMA);
const STUDENT_NOTE_SCHEMA = forPupil(NOTE_SCHEMA);

/** The instructions and the schema for an item and its reader. */
function readingFor(src: LunaSource): { instructions: string; schema: typeof SCHEMA } {
  const student = src.reader === "student";
  if (src.note) return { instructions: student ? STUDENT_NOTE_INSTRUCTIONS : NOTE_INSTRUCTIONS, schema: student ? STUDENT_NOTE_SCHEMA : NOTE_SCHEMA };
  return { instructions: student ? STUDENT_INSTRUCTIONS : INSTRUCTIONS, schema: student ? STUDENT_SCHEMA : SCHEMA };
}

/** Text as compared for a quote: case, spaces, dashes and quote marks aside. */
const plain = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‐-―−]/g, "-")
    .replace(/[“”„«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const isDate = (s: string | null): s is string => s !== null && /^\d{4}-\d{2}-\d{2}$/.test(s) && dateOf(new Date(`${s}T12:00:00Z`)) === s;
const isTime = (s: string | null): s is string => s !== null && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** One rung of the reading ladder: a model and how much it reasons. */
interface Rung {
  model: string;
  effort: "low" | "medium" | "high";
}

/** The tiered strategy's ladder: Luna at low, Luna at medium, and Sol as the last resort when allowed. */
const ladder = (): Rung[] => [
  { model: LUNA, effort: "low" },
  { model: LUNA, effort: "medium" },
  ...(getState().settings.escalateToSol ? [{ model: "gpt-6.1-sol", effort: "low" as const }] : []),
];

/** The thresholds the eval suite tunes. */
export const TIERS = {
  /** Below this for both "has dates" and "has a step", the item isn't read. */
  skip: 0.25,
  /** From this for "many dates, by class or group, or a table", reading starts a rung up. */
  many: 0.4,
  /** An event this unsure (date or whose) sends the item a rung up. */
  unsure: [0.35, 0.65] as const,
  /** The critic's "a date is missing" from this sends the item a rung up. */
  missing: 0.5,
};

interface Read {
  events: LunaEvent[];
  action: NonNullable<LunaRecord["action"]> | null;
  dropped: number;
  nextLessonExam?: LunaRecord["nextLessonExam"];
}

/** One reading: the model lists, code keeps what it quoted from the text. */
async function extract(src: LunaSource, rung?: Rung): Promise<Read> {
  const { instructions, schema } = readingFor(src);
  const extracted = await respond<Extracted>({ name: "school_item", instructions, input: src.input, schema, model: rung?.model, effort: rung?.effort });
  const text = plain(src.body);
  const quoted = (q: string | null | undefined): q is string => Boolean(q && q.trim() && text.includes(plain(q)));
  const next = extracted.next_lesson_exam;
  const nextLessonExam = src.note && quoted(next?.quote) ? { quote: next.quote.trim(), title: next.title.trim().slice(0, 80), pRequired: 0 } : null;
  const kept = extracted.events.filter((e) => quoted(e.quote) && isDate(e.date) && !(nextLessonExam && e.kind === "exam" && (plain(e.quote).includes(plain(nextLessonExam.quote)) || plain(nextLessonExam.quote).includes(plain(e.quote)))));
  // Whose: the pupils it names, by first name (none named, or none recognised: all of the item's pupils).
  const whose = (names: string[]) => {
    const numbers = src.pupils.filter((p) => names.some((n) => n.trim().toLowerCase().startsWith(p.first.toLowerCase()))).map((p) => p.number);
    return numbers.length ? numbers : src.pupils.map((p) => p.number);
  };
  const events: LunaEvent[] = kept.map((e) => ({
    date: e.date,
    endDate: isDate(e.end_date) && e.end_date > e.date ? e.end_date : null,
    start: isTime(e.start) ? e.start : null,
    end: isTime(e.start) && isTime(e.end) ? e.end : null,
    title: e.title.trim().slice(0, 80),
    kind: e.kind,
    forWhom: e.for_whom,
    pupils: whose(e.pupils ?? []),
    quote: e.quote.trim(),
    pDate: 0,
    pCalendar: 0,
  }));
  const step = extracted.action;
  const action = quoted(step?.quote) ? { quote: step.quote.trim(), title: step.title?.trim() || null, deadline: isDate(step.deadline) ? step.deadline : null, pRequired: 0 } : null;
  return { events, action, nextLessonExam, dropped: extracted.events.length - kept.length + (step?.quote && !action ? 1 : 0) + (next && !nextLessonExam ? 1 : 0) };
}

/** An event's days as the questions put them: "Thursday 15 October 2026 to …". */
const span = (date: string, endDate: string | null) => `${day(date)}${endDate ? ` to ${day(endDate)}` : ""}`;
const when = (e: LunaEvent, withTime = true) => `${span(e.date, e.endDate)}${withTime && e.start ? ` at ${e.start}${e.end ? `–${e.end}` : ""}` : ""}`;

/**
 * The days a reading's date could be instead (lunaChecks.choices), for the decisions to choose among: the same weekday a
 * week either way, a day either way, the first day alone of a range, the same day the other year. Code only offers; the
 * decisions choose by the text.
 */
export function dateCandidates(date: string, endDate: string | null, sentDay: string): { value: string; date: string; endDate: string | null }[] {
  const out: { value: string; date: string; endDate: string | null }[] = [];
  const add = (value: string, d: string, end: string | null) => {
    if (!out.some((c) => c.date === d && c.endDate === end)) out.push({ value, date: d, endDate: end });
  };
  const shift = (n: number) => add(n === 7 ? "week_after" : n === -7 ? "week_before" : n === 1 ? "day_after" : "day_before", addDays(date, n), endDate ? addDays(endDate, n) : null);
  add("read", date, endDate);
  [-7, 7, -1, 1].forEach(shift);
  if (endDate) add("first_day_only", date, null);
  // A year's turn: a day before the one it was sent on is likely next year's; a year other than the sending one, this year's.
  const year = Number(date.slice(0, 4));
  const sentYear = Number(sentDay.slice(0, 4));
  const otherYear = year !== sentYear ? sentYear : date < sentDay ? year + 1 : null;
  if (otherYear !== null) add("other_year", `${otherYear}${date.slice(4)}`, endDate ? `${otherYear + (endDate.slice(0, 4) > date.slice(0, 4) ? 1 : 0)}${endDate.slice(4)}` : null);
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.endDate ?? "").localeCompare(b.endDate ?? ""));
}

const KIND_CHOICES: { value: LunaEvent["kind"]; description: string }[] = [
  { value: "exam", description: "An exam or a test, including a make-up exam or a short test announced for a lesson" },
  { value: "trip", description: "The class goes somewhere outside the school" },
  { value: "event", description: "Something on that day to attend or to know of: a parents' evening, a party, a performance, a sports day, a photo day, a health check" },
  { value: "holiday", description: "A holiday or a day off school" },
  { value: "schedule", description: "A school day or week that runs differently: a later start, an earlier end, cancelled lessons, a theme day, a work-experience week" },
];

const WHOSE_RULE =
  'Judge by the class or group the text names: "9. lk" or "ysit" is for a pupil in a 9th class, "8A" only for a pupil in 8A, "7.-luokkalaiset" for a 7th class; a parents\' evening or a deadline for the guardians of a class counts as that class\'s. An event for the whole school, or with no class or group named, is for every pupil the item was sent about.';

/**
 * Luna's Decisions on a reading: each event's date and whose it is, whether
 * the step is required, and (the critic, when asked) whether the text gives
 * a date for these pupils that the reading missed. Fills in the reading's
 * probabilities; returns the critic's.
 *
 * With lunaChecks.choices the date is a choice among nearby days (the
 * decisions may move it to one they're sure of), whose is one choice among
 * the pupils, and "is it the family's" tells an optional thing (a suggestion
 * at most) from the family's own. With lunaChecks.fields the time, the
 * step's deadline and the kind are each checked on their own, and a doubted
 * time or deadline is cleared rather than shown wrong.
 */
async function check(src: LunaSource, read: Read, critic: boolean): Promise<number | null> {
  const { events, action, nextLessonExam } = read;
  const { choices = false, fields = false } = getState().settings.lunaChecks ?? {};
  const sentDay = dateOf(new Date(src.sent || Date.now()));
  const candidates = events.map((e) => (choices ? dateCandidates(e.date, e.endDate, sentDay) : []));
  const stepCandidates = choices && action?.deadline ? dateCandidates(action.deadline, null, sentDay) : [];
  const relative = 'Words like "huomenna" or "perjantaihin" count from the day it was sent; a teacher\'s note is about its lesson\'s day.';
  const questions: DecisionQuestion[] = events.flatMap((e, i): DecisionQuestion[] => {
    const deadline = e.kind === "deadline";
    // The date: one day asked (the time too unless fields checks it), or a choice among nearby days.
    const date: DecisionQuestion = choices
      ? {
          type: "choice",
          name: `date_${i}`,
          instructions: deadline
            ? `Deadline E${i}: "${e.title}", from the words "${e.quote}". By which day is it due by the text: the last day for it ("mennessä", "viimeistään", "by"), or the day to return, bring or do it? ${relative}`
            : `Event E${i}: "${e.title}", from the words "${e.quote}". On which ${e.endDate ? "days" : "day"} is it, by the text? ${relative}`,
          choices: [
            ...candidates[i].map((c) => ({ value: c.value, description: span(c.date, c.endDate) })),
            { value: "none", description: "None of these: the text gives another day for it, or none" },
          ],
        }
      : {
          type: "predicate",
          name: `date_${i}`,
          // A deadline is "by" its day, not "on" it: asked as "on that date", the decisions say no to "23.10. mennessä".
          instructions: deadline
            ? `Deadline E${i}: "${e.title}" due ${when(e)}, from the words "${e.quote}". Does the text make that date the day it is due: the last day for it ("mennessä", "viimeistään", "by", "senast") or the day to return, bring or do it? ${relative}`
            : `Event E${i}: "${e.title}" on ${when(e, !fields)}, from the words "${e.quote}". Does the text say it is on that date${e.start && !fields ? " and at that time" : ""}? ${relative}`,
        };
    // Is it the family's: yes or no. (Asked as a choice among kinds of thing, "the family's" lost probability to its
    // neighbours: a pupil's own make-up exam to "if needed", a grade's info evening to "optional".)
    const calendar: DecisionQuestion = {
      type: "predicate",
      name: `calendar_${i}`,
      instructions: `Event E${i}: "${e.title}" on ${when(e)}. Is it something a family puts in its calendar: a day its pupil takes part in or must know (an exam, a trip, an event, a holiday, a changed school day, a deadline)? No if it is only a possible day for whoever needs it (make-up exam days, open hours), school going on as usual (the first day after a holiday), something cancelled or moved away from that day, or a mention of something past.`,
    };
    // With choices: is it only for those who choose to join? Asked on its own, it can only make the event a suggestion.
    const optional: DecisionQuestion[] = choices
      ? [
          {
            type: "predicate",
            name: `optional_${i}`,
            instructions: `Event E${i}: "${e.title}" on ${when(e, false)}. Is it only for those who choose to join it: an optional test or course, a club, an offer from outside the school, a parents' association meeting, or a talk or webinar any parent may join? No for an exam, a trip or an event set for the pupil or their class or grade, or a parents' evening or info evening for the pupil's class or grade (also when no sign-up is needed).`,
          },
        ]
      : [];
    // Whose: a question a pupil, or (choices, two or more pupils) one choice among them.
    const whose: DecisionQuestion[] =
      choices && src.pupils.length > 1
        ? [
            {
              type: "choice",
              name: `whose_${i}`,
              instructions: `Event E${i}: "${e.title}" on ${when(e, false)}. Whose is it? ${WHOSE_RULE}`,
              choices: [
                ...src.pupils.map((p) => ({ value: `only_${p.number}`, description: `Only ${p.label} (or their guardians)` })),
                { value: "all", description: `All of them: ${src.pupils.map((p) => p.label).join(", ")}` },
                { value: "none", description: "None of them: another class or group" },
              ],
            },
          ]
        : src.pupils.map((p, k) => ({
            type: "predicate" as const,
            name: `whose_${i}_${k}`,
            instructions: `Event E${i}: "${e.title}" on ${when(e)}. Is it for ${p.label} or their guardians? ${WHOSE_RULE}`,
          }));
    // Fields: the time and the kind on their own.
    const extra: DecisionQuestion[] = [];
    if (fields && e.start)
      extra.push({
        type: "predicate",
        name: `time_${i}`,
        instructions: `Event E${i}: "${e.title}" on ${span(e.date, e.endDate)}. Does the text give ${e.start} as the time it starts, or the pupils gather or leave for it${e.end ? `, until ${e.end}` : ""}? A time for something else that day (lunch, another lesson) doesn't count.`,
      });
    if (fields && !deadline)
      extra.push({ type: "choice", name: `kind_${i}`, instructions: `Event E${i}: "${e.title}" on ${when(e, false)}, from the words "${e.quote}". What is it?`, choices: KIND_CHOICES });
    return [date, calendar, ...optional, ...whose, ...extra];
  });
  if (nextLessonExam) questions.push({
    type: "predicate",
    name: "next_exam_required",
    instructions: `Does the note assign its own pupil a required exam or test at the NEXT lesson of the SAME subject as this note, in these words: "${nextLessonExam.quote}"? Minor spelling errors count. No for a cancelled or completed exam, optional practice, a general make-up opportunity, an explicitly dated exam, or a different subject's next lesson. The absence category alone does not cancel a pupil's exam instruction.`,
  });
  if (action) {
    questions.push({
      type: "predicate",
      name: "action_required",
      instructions:
        src.reader === "student"
          ? `Must this pupil do this themself: "${action.quote}"? Yes for a required step for them: do or hand in a task, prepare for an exam or a lesson, bring or return something, reply, sign up or register, or take part in something on a set day. No for a step only a guardian takes (a guardian's permission or form, a payment, booking a meeting, explaining an absence), a step for other classes or grades, an optional invitation, event, offer or survey, or information only.`
          : `Is this a required step a guardian must do or take part in: "${action.quote}"? Yes: reply, give or refuse permission, sign or fill in a form, a permission slip or a contract (a work-experience or TET contract) even when the pupil hands it in at school or the sentence is passive ("palautetaan"), register or sign up when the school asks it of every family, choose, pay, book a time, or check or bring something for the pupil. No: an optional invitation, event, offer or survey; joining or applying to a club, group or course the pupil may choose (even by a deadline), and what to bring to one; a standing rule for every lesson (always bringing PE kit); a general request to follow Wilma or keep informed; information only; or the pupil's own schoolwork.`,
    });
    // The step's deadline: a choice among nearby days, or (fields) asked on its own.
    if (action.deadline && choices)
      questions.push({
        type: "choice",
        name: "deadline",
        instructions: `The step "${action.quote}": by which day is it due by the text (the last day for it, or the day to return, bring or do it)? ${relative}`,
        choices: [...stepCandidates.map((c) => ({ value: c.value, description: day(c.date) })), { value: "none", description: "None of these: another day, or no day for it" }],
      });
    else if (action.deadline && fields)
      questions.push({
        type: "predicate",
        name: "deadline",
        instructions: `The step "${action.quote}": is ${day(action.deadline)} the day it is due (the last day for it, or the day to return, bring or do it)? ${relative}`,
      });
  }
  if (critic) {
    const listed = [...events.map((e) => `${when(e)}: ${e.title}`), ...(action?.deadline ? [`${day(action.deadline)}: ${action.title ?? "deadline"}`] : [])];
    questions.push({
      type: "predicate",
      name: "missing",
      instructions: `These days were read from the text: ${listed.length ? listed.join("; ") : "none"}. Does the text give another day or date that ${src.pupils.map((p) => p.label).join(" or ")} (by their class or group, or the whole school) take part in or must act on, which is missing from that list? Not days for other classes or groups, days before it was sent, the weekly timetable, or possible days for whoever needs them.`,
    });
  }
  if (!questions.length) return null;
  const answers = await decide(src.input, questions);
  const p = (name: string) => {
    const a = answers[name];
    return a?.type === "predicate" ? a.probability : 0;
  };
  /** A choice's probability for one value (0 without an answer). */
  const pc = (name: string, value: string) => {
    const a = answers[name];
    return a?.type === "choice" ? (a.probabilities.find((x) => x.value === value)?.probability ?? 0) : 0;
  };
  /** The day a date choice settles on: the reading's, or another the decisions are sure of when they doubt the reading's. */
  const settle = (name: string, cands: { value: string; date: string; endDate: string | null }[]) => {
    const best = cands.map((c) => ({ c, q: pc(name, c.value) })).sort((a, b) => b.q - a.q)[0];
    const read = pc(name, "read");
    return best && best.c.value !== "read" && best.q >= 0.6 && read < 0.25 ? { ...best.c, p: best.q, moved: true } : { ...cands.find((c) => c.value === "read")!, p: read, moved: false };
  };
  events.forEach((e, i) => {
    if (choices) {
      const s = settle(`date_${i}`, candidates[i]);
      if (s.moved) {
        e.read = { ...e.read, date: e.date, endDate: e.endDate };
        e.date = s.date;
        e.endDate = s.endDate;
      }
      e.pDate = s.p;
      e.pCalendar = p(`calendar_${i}`);
      e.pOptional = p(`optional_${i}`);
    } else {
      e.pDate = p(`date_${i}`);
      e.pCalendar = p(`calendar_${i}`);
    }
    if (fields && e.start) {
      e.pTime = p(`time_${i}`);
      if (e.pTime < 0.5) {
        e.read = { ...e.read, start: e.start };
        e.start = null;
        e.end = null;
      }
    }
    if (fields && e.kind !== "deadline") {
      const top = KIND_CHOICES.map((k) => ({ k: k.value, q: pc(`kind_${i}`, k.value) })).sort((a, b) => b.q - a.q)[0];
      if (top && top.k !== e.kind && top.q >= 0.6 && pc(`kind_${i}`, e.kind) < 0.25) {
        e.read = { ...e.read, kind: e.kind };
        e.kind = top.k;
      }
    }
    // Whose it is, by the decisions; for none of the item's pupils, it isn't this family's (pCalendar follows).
    // Without those answers (a refusal), the reading's own guess stands.
    let whose: { number: string; p: number }[];
    if (choices && src.pupils.length > 1) {
      if (answers[`whose_${i}`]?.type !== "choice") return;
      // Each pupil's share: the choices naming them alone, and "all of them".
      whose = src.pupils.map((pupil) => ({ number: pupil.number, p: pc(`whose_${i}`, `only_${pupil.number}`) + pc(`whose_${i}`, "all") }));
    } else {
      if (src.pupils.some((_, k) => answers[`whose_${i}_${k}`]?.type !== "predicate")) return;
      whose = src.pupils.map((pupil, k) => ({ number: pupil.number, p: p(`whose_${i}_${k}`) }));
    }
    const theirs = whose.filter((w) => w.p >= 0.5).map((w) => w.number);
    e.pupils = theirs;
    if (!theirs.length) e.pCalendar = Math.min(e.pCalendar, Math.max(0, ...whose.map((w) => w.p)));
  });
  if (action) {
    action.pRequired = p("action_required");
    if (action.deadline && (choices || fields)) {
      const s = choices ? settle("deadline", stepCandidates) : { date: action.deadline, p: p("deadline"), moved: false };
      action.pDeadline = s.p;
      if (s.moved) {
        action.deadlineRead = action.deadline;
        action.deadline = s.date;
      } else if (s.p < 0.5) {
        action.deadlineRead = action.deadline;
        action.deadline = null;
      }
    }
  }
  if (nextLessonExam) nextLessonExam.pRequired = p("next_exam_required");
  return critic ? p("missing") : null;
}

/** The gate (Luna's Decisions, before any reading): does the item give dates, ask for a step, and how are its dates written? */
async function gate(src: LunaSource): Promise<{ dated: number; step: number; many: number }> {
  const answers = await decide(src.input, [
    {
      type: "predicate",
      name: "dated",
      instructions:
        "Does the text give a day or a date (a date, a weekday, a range, or words like 'huomenna'), from the day it was sent on, for something the pupils named above or their class, group or school do or must know: an exam, a trip, an event, a holiday, a changed school day, or a deadline? Not only the weekly timetable or past days." + (src.note ? " An exam assigned to the pupil at their next lesson also counts, even without a calendar date or with a spelling error." : ""),
    },
    {
      type: "predicate",
      name: "step",
      instructions:
        src.reader === "student"
          ? "Does the text ask this pupil to do something themself: do or hand in a task, prepare for something, bring or return something, reply, sign up or register, or take part in something (even politely, in the passive or of the whole class)? Not a step only a guardian takes."
          : "Does the text ask the guardian to do something: reply, give or refuse permission, sign, fill in a form, sign up, choose, pay, book a time, or check, bring or return something for the pupil (even politely or in the passive)?",
    },
    {
      type: "choice",
      name: "layout",
      instructions: "How are the text's days and dates written?",
      choices: [
        { value: "none", description: "No days or dates for the pupils' calendar" },
        { value: "few", description: "One or a few days or dates, written in sentences" },
        { value: "many", description: "Many days or dates, or dates by class or group, or a list, a schedule or a table of times" },
      ],
    },
  ]);
  const p = (name: string) => {
    const a = answers[name];
    return a?.type === "predicate" ? a.probability : 0;
  };
  const layout = answers.layout;
  const many = layout?.type === "choice" ? (layout.probabilities.find((x) => x.value === "many")?.probability ?? 0) : 0;
  return { dated: p("dated"), step: p("step"), many };
}

/** Read one item: the fixed single pass, or the tiered strategy (gate, read, check, a rung up when unsure). */
async function readSource(src: LunaSource, hash: string): Promise<LunaRecord> {
  const scope = accountScope();
  const checkScope = () => { if (accountScope() !== scope) throw new LunaError("Account changed", false); };
  const done = (read: Read, model: string, route?: LunaRecord["route"]): LunaRecord => {
    checkScope();
    countItem();
    return { v: LUNA_EVENTS, hash, at: Date.now(), model, ...read, route };
  };
  const strategy = localReading(getState().settings) ? "fixed" : getState().settings.readingStrategy ?? "fixed";
  if (strategy === "fixed") {
    const read = await extract(src);
    checkScope();
    await check(src, read, false);
    return done(read, readingModel());
  }
  const g = await gate(src);
  checkScope();
  if (strategy === "gated") {
    // The gate, then one reading: Luna at medium, or Sol for the hard ones (many dates, by class, a table) when allowed.
    if (g.dated < TIERS.skip && g.step < TIERS.skip) return done({ events: [], action: null, dropped: 0 }, "none", { gate: g, rungs: [], why: "gate: no dates, no step" });
    const hard = g.many >= TIERS.many && getState().settings.escalateToSol;
    const rung: Rung = hard ? { model: "gpt-6.1-sol", effort: "low" } : { model: LUNA, effort: "medium" };
    const read = await extract(src, rung);
    checkScope();
    await check(src, read, false);
    return done(read, rung.model, { gate: g, rungs: [`${rung.model}/${rung.effort}`], why: hard ? "gate: many dates" : null });
  }
  if (g.dated < TIERS.skip && g.step < TIERS.skip) return done({ events: [], action: null, dropped: 0 }, "none", { gate: g, rungs: [], why: "gate: no dates, no step" });
  const rungs = ladder();
  let at = g.many >= TIERS.many ? 1 : 0;
  const route: NonNullable<LunaRecord["route"]> = { gate: g, rungs: [], why: g.many >= TIERS.many ? "gate: many dates" : null };
  for (;;) {
    const rung = rungs[at];
    const read = await extract(src, rung);
    checkScope();
    const missing = await check(src, read, true);
    checkScope();
    route.rungs.push(`${rung.model}/${rung.effort}`);
    const inBand = (p: number) => p >= TIERS.unsure[0] && p <= TIERS.unsure[1];
    const doubt =
      missing !== null && missing >= TIERS.missing
        ? `critic: missing ${missing.toFixed(2)}`
        : read.events.some((e) => inBand(e.pDate) || inBand(e.pCalendar))
          ? "an event unsure"
          : g.dated >= 0.6 && !read.events.length && !read.action && !read.nextLessonExam
            ? "gate: dates, none read"
            : null;
    if (!doubt || at >= rungs.length - 1) return done(read, rung.model, { ...route, why: doubt ? `${route.why ? `${route.why}; ` : ""}${doubt} (top rung)` : route.why });
    route.why = `${route.why ? `${route.why}; ` : ""}${doubt}`;
    at += 1;
  }
}

export { hash };

/** How items are read: the tiered strategy's version, or the fixed model and effort (a change reads everything again). */
const strategyKey = () => {
  const { readingStrategy, readingEffort, escalateToSol, lunaChecks } = getState().settings;
  const checks = ["choices", "fields"].filter((k) => lunaChecks?.[k as "choices" | "fields"]).join("+");
  const how = readingStrategy === "tiered" || readingStrategy === "gated" ? `${readingStrategy}@1${escalateToSol ? "+sol" : ""}` : `${readingModel()}/${readingEffort ?? READING_EFFORT}`;
  return `${providerIdentity(getState().settings)}/${checks ? `${how}/${checks}` : how}`;
};

/** What's waiting for Luna: items never read, or whose text changed since. */
export function lunaBacklog(): { src: LunaSource; h: string }[] {
  const { snapshot, luna } = getState();
  if (!snapshot) return [];
  return lunaSources(snapshot)
    .map((src) => ({ src, h: hash([src.note ? LUNA_NOTE_EXAMS : LUNA_EVENTS, strategyKey(), src.input]) }))
    .filter(({ src, h }) => luna[src.key]?.hash !== h);
}

let running: Promise<void> | null = null;

/** After the items are read: the items together (what later ones say about earlier events), then the subjects' PE. */
async function afterReading() {
  await runLinks();
  await runSubjects();
}

/** Read what's waiting, a few at a time, when there's a key. */
export function runLuna(): Promise<void> {
  const { settings } = getState();
  // On with a key (Settings → WilmAI Intelligence): nothing is sent otherwise.
  if (!intelligenceOn(settings)) return Promise.resolve();
  const scope = accountScope();
  running ??= (async () => {
    const local = usesLocalAI(settings);
    // Sorting first, including mark maxima. Engine callers may start both runners together.
    if (local) await runJev();
    if (scope !== accountScope() || local !== usesLocalAI(getState().settings)) return;
    const identity = providerIdentity(getState().settings);
    const current = () => scope === accountScope() && Boolean(getState().snapshot) && intelligenceOn(getState().settings) && providerIdentity(getState().settings) === identity;
    if (!current()) return;
    if (local && getState().jevStatus.error) {
      setState((s) => ({ lunaStatus: { ...s.lunaStatus, error: s.jevStatus.error } }));
      return;
    }
    if (!localReading(getState().settings) && !(await openAIReady())) {
      if (current()) setState((s) => ({ lunaStatus: { ...s.lunaStatus, running: false, error: openAIBlockedMessage() } }));
      return;
    }
    if (!current()) return;
    const waiting = lunaBacklog();
    // Nothing new to read: the links may still be waiting (an item read before the experiment was on).
    if (!waiting.length) return void (await afterReading());
    setState({ lunaStatus: { running: true, done: 0, total: waiting.length * (local ? 2 : 1), error: null } });
    if (local) {
      // Extract every item with Qwen, then verify every reading with Clef.
      // Unverified readings are never published to the calendar.
      const extracted: { src: LunaSource; h: string; read: Read }[] = [];
      try {
        for (const { src, h } of waiting) {
          if (!current()) return;
          extracted.push({ src, h, read: await extract(src) });
          if (!current()) return;
          setState((s) => ({ lunaStatus: { ...s.lunaStatus, done: s.lunaStatus.done + 1 } }));
        }
        for (const { src, h, read } of extracted) {
          if (!current()) return;
          await check(src, read, false);
          if (!current()) return;
          countItem();
          setState((s) => ({ luna: { ...s.luna, [src.key]: { v: LUNA_EVENTS, hash: h, at: Date.now(), model: readingModel(), ...read } }, lunaStatus: { ...s.lunaStatus, done: s.lunaStatus.done + 1 } }));
        }
        if (current()) await afterReading();
      } catch (err) {
        if (!current()) return;
        setState((s) => ({ lunaStatus: { ...s.lunaStatus, error: err instanceof Error ? err.message : String(err) } }));
      } finally {
        if (current()) setState((s) => ({ lunaStatus: { ...s.lunaStatus, running: false } }));
      }
      return;
    }
    let next = 0;
    let stop: string | null = null;
    const worker = async () => {
      while (next < waiting.length && !stop && current()) {
        const { src, h } = waiting[next++];
        try {
          const record = await readSource(src, h);
          if (!current()) return;
          setState((s) => ({ luna: { ...s.luna, [src.key]: record } }));
        } catch (err) {
          if (!current()) return;
          // OpenAI refusing the key or the request stops the run (it would refuse the rest too); a busy moment is tried again on the
          // next run; an answer that isn't the schema is kept as an error, so the item isn't read again until its text changes.
          if (err instanceof LunaError && !err.retryable) stop = err.message;
          else if (!(err instanceof LunaError) && !(err instanceof SyntaxError)) stop = err instanceof Error ? err.message : String(err);
          else if (err instanceof SyntaxError)
            setState((s) => ({ luna: { ...s.luna, [src.key]: { v: LUNA_EVENTS, hash: h, at: Date.now(), model: readingModel(), action: null, events: [], dropped: 0, error: err.message } } }));
        }
        setState((s) => ({ lunaStatus: { ...s.lunaStatus, done: s.lunaStatus.done + 1 } }));
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    // Then the items together (lunaChecks.crossItem): what later items say about earlier items' events.
    if (!current()) return;
    if (!stop) await afterReading();
    if (!current()) return;
    setState((s) => ({ lunaStatus: { ...s.lunaStatus, running: false, error: s.lunaStatus.error ?? stop } }));
    await saveCompareReport();
  })().finally(async () => {
    if (usesLocalAI(settings)) await releaseLocalModels().catch((err: unknown) => scope === accountScope() && setState((s) => ({ lunaStatus: { ...s.lunaStatus, error: err instanceof Error ? err.message : String(err) } })));
    running = null;
    if (scope !== accountScope() && getState().phase === "ready" && getState().snapshot) void runLuna();
    // Then the translations, with the readings' sentences on what to do (data/translations.ts).
    else void runTranslations();
  });
  return running;
}

/** Read everything again (after changing how it's read). */
export function forgetLuna() {
  setState({ luna: {} });
  return runLuna();
}

/** Check the key with one tiny decision. */
/** "Check again" (Settings, Today): when OpenAI can be reached again, what's waiting is read. */
export async function checkOpenAIAgain(): Promise<boolean> {
  const { reachable } = await openAIReach();
  if (reachable && intelligenceOn(getState().settings)) {
    void runJev();
    void runLuna();
  }
  return reachable;
}

export async function checkOpenAIKey(): Promise<void> {
  await decide("Hyvää huomenta!", [{ type: "predicate", name: "finnish", instructions: "Is this text in Finnish?" }]);
}
