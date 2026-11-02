/*
 * The family calendar: what's coming that a family puts in its calendar,
 * for the children shown, from three places.
 *  1. Wilma's own data, exact: exams (at the lesson's time), school days
 *     off their usual hours or without lessons (from the timetable), the time
 *     signed up for in an invitation, and an invitation's sign-up deadline.
 *  2. Messages, bulletins and teachers' lesson notes ("Rästikoe klo 15.20"),
 *     as Luna read them (luna/events.ts): each dated event with the words
 *     it's from, kept only when those words are in the text, and Luna's
 *     Decisions saying how sure (the date, and whether it's this family's).
 *  3. The parent: a suggestion (not sure enough) taken or dismissed.
 * Each event has a key from its source, the same every time, so the
 * calendar it's written to can be updated and cleaned up, never duplicated.
 */
import { awaitingAnswer, slotState, type UpcomingExam } from "@wilma-client/src/core";
import { noteGroups, type AgendaEntry, type FeedItem } from "./feed";
import { LUNA_THRESHOLDS, lunaEventId, type CalendarLocal, type Child, type LunaEvent, type LunaRecord, type LunaThresholds, type Snapshot } from "./model";
import { addDays, clock, dateOf, daysBetween, deadlineDay, shortDate, weekday } from "./dates";
import { courseOf, examForLesson, knownLessons, unusualDays } from "./schedule";
import { t } from "../i18n";
import { noteExamEvent } from "./note-exams";

export type CalKind = "exam" | "event" | "trip" | "holiday" | "schedule" | "deadline";
export const CAL_KIND_ORDER: CalKind[] = ["exam", "event", "trip", "holiday", "schedule", "deadline"];
/** What goes to the family calendar until the parent says otherwise: all but deadlines (those are tasks, in the Inbox). */
export const DEFAULT_KINDS: Record<CalKind, boolean> = { exam: true, event: true, trip: true, holiday: true, schedule: true, deadline: false };

export interface CalEvent {
  /** From the source, the same every time (the calendar it's written to is kept by it). */
  key: string;
  kind: CalKind;
  /** The children it's for, in the family's order. */
  children: string[];
  title: string;
  date: string;
  /** The last day of a range ("19.–23.10."), else null. */
  endDate: string | null;
  /** "17:30", or null for a whole day. */
  start: string | null;
  end: string | null;
  /** More to know: an exam's topic, the message it came from. */
  detail: string | null;
  /** The message or bulletin it came from. */
  itemKey: string | null;
  /**
   * Where it comes from, to show beside the calendar: a child's day (an
   * exam's or a note's lesson by its start, a changed day) or a message or
   * bulletin (with the line the date is on).
   */
  source: CalSource;
  /** Exact (Wilma's data, or Jev sure, or the parent took it); else a suggestion. */
  sure: boolean;
  /** Read from a message, bulletin or teacher's note (not Wilma's own data): the item and the school's own words. */
  origin?: { key: string; quote: string };
  /** Jev's confidence, for a suggestion. */
  confidence?: number;
  /** The keys of the same event from other sources (a twin, a repeat), so the parent's word on any of them counts. */
  aliases?: string[];
}

export type CalSource = { kind: "day"; child: string; date: string; start: string | null } | { kind: "item"; key: string; line: string | null };

/** An exam read from an instruction opens the day it happens; its origin still links to that instruction. */
export function calendarPanelSource(event: CalEvent): CalSource {
  return event.kind === "exam" && event.origin && event.children.length
    ? { kind: "day", child: event.children[0], date: event.date, start: event.start }
    : event.source;
}

/* ---------- The events ---------- */

function examTitle(exam: UpcomingExam): string {
  const subject = exam.subject || "";
  const name = exam.name || "";
  if (!name || name === subject) return subject || t("Exam");
  // "Maantieto" and "Maantiedon koe": the name says the subject already (Finnish bends the word, so by its start).
  const stem = subject.toLowerCase().split(/[ ,]/)[0].slice(0, 4);
  return stem.length >= 3 && name.toLowerCase().includes(stem) ? name : `${subject}: ${name}`;
}

/** The school days from `from` to `until` (Mon–Fri). */
function schoolDays(from: string, until: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= until; d = addDays(d, 1)) if (weekday(d) < 5) out.push(d);
  return out;
}

/**
 * Every event from `from` to `until` for the children given (all when empty),
 * the parent's dismissed ones left out and taken ones made sure. Events for
 * siblings that are the same (one parents' evening) are one, for both.
 */
/**
 * What later items said about earlier items' events (luna/links.ts): the events they cancel or move (left out), and for
 * each later item, the earlier events it repeats (shown once).
 */
export function linkVerdicts(luna: Record<string, LunaRecord>, threshold = LUNA_THRESHOLDS.superseded) {
  const superseded = new Set<string>();
  const repeats = new Map<string, { id: string; date: string }[]>();
  for (const [key, rec] of Object.entries(luna)) {
    for (const [id, l] of Object.entries(rec.links?.about ?? {})) {
      if (l.cancelled + l.moved >= threshold) superseded.add(id);
      else if (l.same >= threshold) repeats.set(key, [...(repeats.get(key) ?? []), { id, date: l.what.slice(0, 10) }]);
    }
  }
  return { superseded, repeats };
}

/** Whether an exam read from a note or a message is Wilma's own exam that day (see calendarEvents): facts, not wording. */
function sameExam(x: UpcomingExamLike, ev: Pick<LunaEvent, "start">, src: { from?: string | null; subjects?: string[] }): boolean {
  if (ev.start && x.time && ev.start === x.time) return true;
  if (src.subjects?.some((code) => code === x.subjectCode || (courseOf(code) !== null && courseOf(code) === courseOf(x.subjectCode)))) return true;
  const sender = (src.from ?? "").toLowerCase();
  return Boolean(sender && ((x.teacher && sender.includes(x.teacher.toLowerCase())) || (x.teacherCode && sender.includes(`(${x.teacherCode.toLowerCase()})`))));
}
type UpcomingExamLike = Pick<UpcomingExam, "time" | "subjectCode" | "teacher" | "teacherCode">;

/**
 * Exams read from messages, bulletins and teachers' notes ("Fysiikan rästikoe klo 15.20"), sure ones, that Wilma's own
 * exam list doesn't have: the same ones the calendar shows, for the views that list exams (Exams, Today's glance), so
 * every view tells the same. Wilma's own exam that day wins (calendarEvents leaves the read one out).
 */
export function readExams(
  snap: Snapshot,
  items: FeedItem[],
  luna: Record<string, LunaRecord>,
  local: CalendarLocal | undefined,
  range: { from: string; until: string; children: string[] },
  /** The day panel also shows uncertain exams, labelled as suggestions. */
  includeSuggestions = false
): (CalEvent & { origin: NonNullable<CalEvent["origin"]> })[] {
  return calendarEvents(snap, items, local, range, luna).filter((e): e is CalEvent & { origin: NonNullable<CalEvent["origin"]> } => e.kind === "exam" && (e.sure || includeSuggestions) && Boolean(e.origin));
}

/** The read exams as entries of the agenda (Today's glance): one a child, the school's words as the detail. */
export function readExamEntries(
  snap: Snapshot,
  items: FeedItem[],
  luna: Record<string, LunaRecord>,
  local: CalendarLocal | undefined,
  range: { from: string; until: string; children: string[] }
): AgendaEntry[] {
  return readExams(snap, items, luna, local, range).flatMap((e) =>
    e.children.map((child): AgendaEntry => ({ date: e.date, time: e.start, child, kind: "exam", title: e.title, detail: e.origin.quote, itemKey: e.itemKey }))
  );
}

export function calendarEvents(
  snap: Snapshot,
  items: FeedItem[],
  local: CalendarLocal | undefined,
  /** `leftOut`: subjects left out of each child's school hours (LocalState.leftOut), for the days off their usual hours. */
  range: { from: string; until: string; children: string[]; leftOut?: Record<string, string[]> },
  /** Luna's reading of each message, bulletin and note (luna/events.ts). */
  luna: Record<string, LunaRecord>,
  /** Where the probabilities put an event (the eval suite tries others). */
  T: LunaThresholds = LUNA_THRESHOLDS
): CalEvent[] {
  const { from, until } = range;
  const wanted = (n: string) => !range.children.length || range.children.includes(n);
  const kids = snap.children.filter((c) => wanted(c.number));
  const order = (numbers: string[]) => snap.children.map((c) => c.number).filter((n) => numbers.includes(n));
  const events: CalEvent[] = [];
  // A child's day off its usual hours, or without lessons, by the timetable: `${child}|${date}`.
  const oddDay = new Map<string, "off" | "changed">();
  const inRange = (date: string, end: string | null = null) => (end ?? date) >= from && date <= until;

  // 1. Wilma's own data.
  for (const child of kids) {
    const data = snap.perChild[child.number];
    const lessons = knownLessons(data);
    for (const exam of data?.exams ?? []) {
      if (!inRange(exam.date)) continue;
      const lesson = lessons.find((l) => l.date === exam.date && examForLesson(data, l) === exam) ?? null;
      const start = exam.time ?? lesson?.start ?? null;
      events.push({
        // Wilma gives most exams an id; one without is known by its day and subject.
        key: `exam:${child.number}:${exam.examId || `${exam.date}:${(exam.subjectCode || exam.subject || "").toLowerCase()}`}`,
        kind: "exam",
        children: [child.number],
        title: examTitle(exam),
        date: exam.date,
        endDate: null,
        start,
        end: lesson && start === lesson.start ? lesson.end : null,
        detail: exam.topic,
        itemKey: null,
        source: { kind: "day", child: child.number, date: exam.date, start: lesson?.start ?? null },
        sure: true,
      });
    }
    const odd = unusualDays(data, schoolDays(from, until), range.leftOut?.[child.number]);
    for (const date of [...new Set(odd.map((u) => u.date))]) {
      const day = odd.filter((u) => u.date === date);
      oddDay.set(`${child.number}|${date}`, day.some((u) => u.kind === "off") ? "off" : "changed");
      const title = day.some((u) => u.kind === "off")
        ? t("No lessons")
        : day.map((u) => (u.kind === "start" ? t("School starts {time}", { time: u.time! }) : t("School ends {time}", { time: u.time! }))).join(" · ");
      events.push({
        key: `day:${child.number}:${date}`,
        kind: "schedule",
        children: [child.number],
        title,
        date,
        endDate: null,
        start: null,
        end: null,
        detail: null,
        itemKey: null,
        source: { kind: "day", child: child.number, date, start: null },
        sure: true,
      });
    }
  }
  const invited = new Set<string>();
  for (const item of items) {
    if (!item.invite?.data || !item.children.some(wanted)) continue;
    const children = order(item.children.filter(wanted));
    // The invitation's own event as Luna named it ("Vanhempainilta"), else the message's subject.
    const title = luna[item.key]?.events.find((e) => e.kind !== "deadline")?.title ?? item.title;
    for (const slot of item.invite.data.slots) {
      if (!(slot.selected || slot.selectedByOther) || !slot.start) continue;
      const date = dateOf(slot.start);
      if (!inRange(date)) continue;
      invited.add(`${item.key}|${date}`);
      events.push({
        key: `invite:${item.id}:${slot.id}`,
        kind: "event",
        children,
        title,
        date,
        endDate: null,
        start: clock(slot.start),
        end: slot.end && dateOf(slot.end) === date ? clock(slot.end) : null,
        detail: [slot.subject, slot.info].filter(Boolean).join(" · ") || null,
        itemKey: item.key,
        source: { kind: "item", key: item.key, line: null },
        sure: true,
      });
    }
    const open = item.invite.data.slots.filter((s) => slotState(s) === "open" && s.enrollEnd).map((s) => s.enrollEnd!);
    if (awaitingAnswer(item.invite.data) && open.length) {
      const last = deadlineDay(open.sort((a, b) => a.getTime() - b.getTime())[0]);
      if (inRange(last.day)) {
        invited.add(`${item.key}|${last.day}`);
        events.push({
          key: `signup:${item.id}`,
          kind: "deadline",
          children,
          title: t("{title} (sign-up ends)", { title }),
          date: last.day,
          endDate: null,
          start: last.time,
          end: null,
          detail: null,
          itemKey: item.key,
          source: { kind: "item", key: item.key, line: null },
          sure: true,
        });
      }
    }
  }

  // 2. Messages, bulletins and teachers' lesson notes, as Luna read them.
  // Each source with what tells its exam from Wilma's own: a message's sender, a note's lesson (subject codes).
  // `said`: when the school said it (a message's time, a note's lesson), for which of two sources of one event comes first.
  const read: { key: string; said: string; children: string[]; detail: string; source: (line: string | null) => CalSource; from?: string | null; subjects?: string[]; nextExam?: LunaEvent }[] = [];
  for (const item of items) {
    if (!item.text || item.kind === "note" || item.awaitingReply || !item.children.some(wanted)) continue;
    read.push({ key: item.key, said: item.at.toISOString(), children: order(item.children.filter(wanted)), detail: item.title, source: (line) => ({ kind: "item", key: item.key, line }), from: item.from });
  }
  for (const child of kids) {
    for (const note of noteGroups(child.number, snap.perChild[child.number]?.notes ?? [])) {
      if (!note.note) continue;
      const exam = noteExamEvent(snap, note, luna[note.key]);
      read.push({
        key: note.key,
        said: `${note.date}T${note.start ?? "00:00"}`,
        children: [child.number],
        detail: `${note.typeLabel} · ${note.subjects.join(", ")} · ${shortDate(note.date)}`,
        source: () => ({ kind: "day", child: child.number, date: note.date, start: note.start }),
        subjects: note.subjects,
        nextExam: exam ?? undefined,
      });
    }
  }
  const links = linkVerdicts(luna, T.superseded);
  /**
   * Luna's events by id, as they went in (an event a later item repeats takes in its pupils instead). One id can be
   * several events: the same title on one day at two times (a concert at 17 and at 19).
   */
  const byId = new Map<string, CalEvent[]>();
  const repeated: { e: CalEvent; of: string[] }[] = [];
  for (const src of read) {
    const first = events.length;
    const record = luna[src.key];
    // A deadline the guardian's step names is a deadline in the calendar, whether or not the reading listed it among the events.
    const step = record?.action;
    const fromStep: LunaEvent[] =
      step?.deadline && step.pRequired >= 0.5 && !(record?.events ?? []).some((e) => e.kind === "deadline" && (e.endDate ?? e.date) === step.deadline)
        ? [
            {
              date: step.deadline,
              endDate: null,
              start: null,
              end: null,
              title: step.title ?? t("{title} (deadline)", { title: src.detail }),
              kind: "deadline",
              forWhom: "this_pupil",
              quote: step.quote,
              // The deadline as checked on its own (lunaChecks), else as the reading gave it.
              pDate: step.pDeadline ?? 1,
              pCalendar: step.pRequired,
            },
          ]
        : [];
    // Each event Luna quoted from the text, as Luna's Decisions judged it (the date, and whether it's this family's).
    for (const ev of [...(record?.events ?? []), ...fromStep, ...(src.nextExam ? [src.nextExam] : [])]) {
      // Whose: the pupils the decisions said it's for (of those shown); a reading without that (older ones, a step's deadline): all of the item's.
      const children = ev.pupils ? src.children.filter((n) => ev.pupils!.includes(n)) : src.children;
      if (!children.length) continue;
      // An optional thing ("for those who want") stays a suggestion: it counts for keeping, not for sure.
      if (ev.pDate < T.keepDate || ev.pCalendar + (ev.pOptional ?? 0) < T.keepCalendar) continue;
      // A later item cancelled it or moved it (the new day, if any, is that item's own event).
      const id = lunaEventId(src.key, ev);
      if (links.superseded.has(id)) continue;
      // A period to apply in ends on its last day; other long periods (a course, a weekly group) aren't a day to mark.
      const date = ev.kind === "deadline" && ev.endDate ? ev.endDate : ev.date;
      const endDate = ev.kind === "deadline" ? null : ev.endDate;
      if (endDate && ev.kind !== "holiday" && daysBetween(date, endDate) > 13) continue;
      if (!inRange(date, endDate) || invited.has(`${src.key}|${date}`)) continue;
      // An exam Wilma lists for the child that day is shown from Wilma's data when it's the same exam: at the same time,
      // from a note on the same subject, or from a message its teacher sent. Another exam that day stays (an exam week).
      if (ev.kind === "exam" && children.every((n) => (snap.perChild[n]?.exams ?? []).some((x) => x.date === date && sameExam(x, ev, src)))) continue;
      // A changed day the timetable shows is the same day.
      if (ev.kind === "schedule" && !endDate && children.every((n) => oddDay.has(`${n}|${date}`))) continue;
      events.push({
        key: `${src.key}:${date}${endDate ? `-${endDate}` : ""}${ev.start ? `@${ev.start}` : ""}`,
        kind: ev.kind,
        children,
        title: ev.title,
        date,
        endDate,
        start: ev.start,
        end: ev.end,
        detail: src.detail,
        itemKey: src.source(null).kind === "item" ? src.key : null,
        source: src.source(ev.quote),
        // Sure: the date and "it's the family's" both sure, and not something only for those who choose to join.
        sure: ev.pDate >= T.sureDate && ev.pCalendar >= T.sureCalendar && (ev.pOptional ?? 0) < 0.5,
        confidence: Math.min(ev.pDate, ev.pCalendar),
        origin: { key: src.key, quote: ev.quote },
      });
      const added = events[events.length - 1];
      byId.set(id, [...(byId.get(id) ?? []), added]);
      // The same event as earlier items' (as this item's reading said), on the same day: shown once (below).
      const of = (links.repeats.get(src.key) ?? []).filter((r) => r.date === date && r.id !== id).map((r) => r.id);
      if (of.length) repeated.push({ e: added, of });
    }
    distinguish(events.slice(first));
  }
  // A later item's event that repeats an earlier one: the earlier one stays, for both items' pupils, sure if either is.
  // It's the one at the same time, else one with a time. The earlier events it repeats are one event too: one of them
  // without a time (a bulletin's "concerts on 5.11.") goes into the timed one, which says more. Its key isn't taken
  // along, so the parent's word on it stays its own.
  const into = (keeper: CalEvent, e: CalEvent) => {
    keeper.children = order([...new Set([...keeper.children, ...e.children])]);
    keeper.sure ||= e.sure;
    events.splice(events.indexOf(e), 1);
  };
  for (const { e, of } of repeated) {
    const earlier = of.flatMap((id) => byId.get(id) ?? []).filter((x) => x !== e && events.includes(x));
    if (!earlier.length || !events.includes(e)) continue;
    const keeper = earlier.find((x) => x.start === e.start) ?? earlier.find((x) => x.start) ?? earlier[0];
    into(keeper, e);
    keeper.aliases = [...(keeper.aliases ?? []), e.key];
    if (keeper.start) for (const x of earlier) if (!x.start && !x.endDate && events.includes(x)) into(keeper, x);
  }

  // A holiday Luna is sure of says more than the timetable's "No lessons" on its days.
  const offDays = new Set<string>();
  for (const e of events) {
    if (e.kind !== "holiday" || !e.sure || e.confidence === undefined) continue;
    for (let d = e.date; d <= (e.endDate ?? e.date); d = addDays(d, 1)) for (const n of e.children) if (oddDay.get(`${n}|${d}`) === "off") offDays.add(`day:${n}:${d}`);
  }

  // 3. The same event from two places (a message and a bulletin, two siblings' messages) is one, sure if either is. It
  // keeps the key of the first the school said (Wilma's own data, then the oldest item), so a later one doesn't change it.
  const said = new Map(read.map((src) => [src.key, src.said]));
  const saidAt = (e: CalEvent) => (e.origin ? (said.get(e.origin.key) ?? "~") : "");
  const firstSaid = events.filter((e) => !offDays.has(e.key)).sort((a, b) => saidAt(a).localeCompare(saidAt(b)) || a.key.localeCompare(b.key));
  const merged: CalEvent[] = [];
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  for (const e of firstSaid) {
    const twin = merged.find((m) => m.kind === e.kind && m.date === e.date && m.endDate === e.endDate && m.start === e.start && same(m.title, e.title));
    if (!twin) {
      merged.push({ ...e });
      continue;
    }
    twin.children = order([...new Set([...twin.children, ...e.children])]);
    twin.sure ||= e.sure;
    twin.aliases = [...(twin.aliases ?? []), e.key, ...(e.aliases ?? [])];
  }
  // 4. The parent's word, on any of the event's keys.
  return merged
    .flatMap((e) => {
      const word = calendarDecision(e, local);
      return word === "no" ? [] : [word === "yes" ? { ...e, sure: true } : e];
    })
    .sort((a, b) => (a.date + (a.start ?? "")).localeCompare(b.date + (b.start ?? "")));
}

/**
 * One source's events that would share a key (one bulletin's two exams on a day) are told apart by their titles, all
 * of them, so no key depends on which was read first.
 */
function distinguish(list: CalEvent[]): void {
  const byKey = new Map<string, CalEvent[]>();
  for (const e of list) byKey.set(e.key, [...(byKey.get(e.key) ?? []), e]);
  for (const [key, same] of byKey) {
    if (same.length < 2) continue;
    const taken = new Set<string>();
    for (const e of [...same].sort((a, b) => a.title.localeCompare(b.title) || a.kind.localeCompare(b.kind))) {
      let k = `${key}~${e.title.toLowerCase().replace(/\s+/g, " ").trim()}`;
      while (taken.has(k)) k += "+";
      taken.add(k);
      e.key = k;
    }
  }
}

/** The parent's word on an event, on any of its keys (the same event from another source counts); a dismissal wins. */
export function calendarDecision(e: Pick<CalEvent, "key" | "aliases">, local: CalendarLocal | undefined): "yes" | "no" | undefined {
  const words = [e.key, ...(e.aliases ?? [])].map((key) => local?.decisions[key]);
  return words.includes("no") ? "no" : words.includes("yes") ? "yes" : undefined;
}

/**
 * An event as it reads in the family calendar, whose it is first, the way
 * families write them ("Kiia: Maantiedon koe"). A holiday for every child is
 * just the holiday.
 */
export function calendarTitle(e: CalEvent, family: Child[]): string {
  const names = e.children.map((n) => family.find((c) => c.number === n)?.first).filter((n): n is string => Boolean(n));
  if (!names.length || (e.kind === "holiday" && names.length === family.length)) return e.title;
  return `${names.join(", ")}: ${e.title}`;
}

/** An event without a time is for the whole day (an exam goes in at its lesson's time). */
export const allDay = (e: CalEvent): boolean => !e.start;

/** Whether an event goes to the family calendar: its kind is on, and it's sure (a suggestion waits for the parent). */
export function goesToCalendar(e: CalEvent, local: CalendarLocal | undefined): boolean {
  const on = local?.kinds[e.kind] ?? DEFAULT_KINDS[e.kind];
  return Boolean(on) && e.sure;
}
