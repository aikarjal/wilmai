/*
 * One feed for the whole family: messages, bulletins and teacher notes for
 * every child, with the models' answers turned into something to act on:
 * the decisions' probabilities (needs you, kind, scope) and Luna's reading
 * (the step for the guardian, its deadline, the dates). Code owns the
 * decisions; the probabilities only feed them.
 */
import type { LessonNote } from "@wilma-client/src/core";
import { addDays, dateOf, daysBetween, today } from "./dates";
import type { AppState } from "./store";
import { LUNA_THRESHOLDS, awaitingReply, viewerOf, writtenByFamily, type Child, type JevAnswer, type JevRecord, type LunaEvent, type LunaRecord, type Snapshot } from "./model";
import { TRIAGE_PUPIL_QS, TRIAGE_QS, type Kind, type Scope } from "../jev/questions";
import { awaitingAnswer, slotState, type Invitation as Invite, type InvitationSlot as InviteSlot } from "@wilma-client/src/core";
import { clock, deadlineDay, shortDate } from "./dates";
import { t } from "../i18n";
import { examSuperseded, noteExam, type PupilExam } from "./note-exams";
import { isUnexplained, noteKind, noteKinds, type NoteKind } from "./notes";
import { aboutShown, firstSyncOf, loginOfChild, loginOfId } from "./logins";

export type ItemKind = "message" | "news" | "note";

/** Luna's reading of the item: the school's own sentence for the guardian's step, its deadline, the day it's about. */
export interface Detail {
  actionLine: string | null;
  deadline: string | null;
  eventDate: string | null;
  /** A school day that runs differently (an earlier end, a later start, no lessons), read surely and not over yet. */
  change: LunaEvent | null;
  /** The second, narrower look at "needs action" (used only when the first was unsure). */
  confirm: number | null;
  /** The dated events Luna read (and its decisions' probabilities). */
  events: LunaEvent[];
  model: string | null;
}

export interface Triage {
  /** The question set it answered: a guardian's or a pupil's (questions.ts). */
  qs: string;
  /** Stage 1's answer, or stage 2's second look when stage 1 was unsure. */
  needsAction: number;
  /** Stage 1's own answer, before any second look. */
  firstNeedsAction: number;
  /** 0 (no date ahead) … 3 (today or tomorrow), computed in code from the deadline or day Jev picked. */
  urgency: number;
  kind: Kind;
  kindConfidence: number;
  /** Probability it's written about this child in particular. */
  aboutChild: number;
  scope: Scope;
  scopeConfidence: number;
  praise: number;
  /** Jev saw only the subject (the message hasn't been opened). */
  preliminary: boolean;
  model: string;
  answers: Record<string, JevAnswer>;
  detail: Detail | null;
}

export interface FeedItem {
  key: string;
  kind: ItemKind;
  id: number | null;
  children: string[];
  title: string;
  from: string | null;
  at: Date;
  text: string | null;
  preview: string;
  isNew: boolean;
  done: boolean;
  /** Dates the text mentions, today or later. */
  upcoming: string[];
  /** Whether the text mentions any date at all (past ones included). */
  dated: boolean;
  triage: Triage | null;
  /** The school's own sentence saying what the parent must do (stage 2), or, for a changed school day with nothing to do, what changes. */
  actionLine: string | null;
  /** The deadline for it, and the day the item is about (stage 2; YYYY-MM-DD). */
  deadline: string | null;
  eventDate: string | null;
  /** The school day it changes (stage 2): the parent's to know even when there's nothing to do. */
  change?: LunaEvent | null;
  /** Something the parent has to do that code knows for certain from Wilma's own data (no model needed). */
  task: { label: string; reason: string } | null;
  /** A message this family wrote (model.ts writtenByFamily, or in Wilma's Sent folder): never a step for them, whatever the reading says. */
  own?: boolean;
  /** The family sent it and nobody has answered yet: not read by the AI, and no dates from it. */
  awaitingReply?: boolean;
  tone: "praise" | "neutral" | "concern" | null;
  replyCount: number;
  note?: NoteGroup;
  /** Important for the pupil, independently of a guardian's "needs you" tasks. */
  pupilExam?: PupilExam | null;
  /** A bulletin the school keeps in Wilma's permanent bulletins (pysyvät tiedotteet). */
  pinned?: boolean;
  /** When the reader pinned it to the top of the inbox (this app only), or null. */
  pinnedAt?: number | null;
  /** Event invitations: the slots (once read), the slot chosen, whether it still waits for an answer. */
  invite?: { data: Invite | null; status: string | null; extra: string | null; awaiting: boolean; chosen: InviteSlot | null };
}

export const NEEDS_YOU = 0.6;
const SCOPE_WEIGHT: Record<Scope, number> = { pupil: 1, group: 0.7, school: 0.4, wider: 0 };

/** A "next lesson" exam with no later lesson of the subject in the timetable stops showing this long after its note. */
const UNPLACED_EXAM_DAYS = 14;

/** Outstanding pupil exams need a parent's attention even when no guardian action is assigned. */
export function examsNeedingAttention(items: FeedItem[], from = today()): (FeedItem & { pupilExam: PupilExam })[] {
  return items.filter((item): item is FeedItem & { pupilExam: PupilExam } => {
    if (!item.pupilExam || item.done) return false;
    // Not sure of the day: once a later lesson of the subject is over, so is the exam.
    const day = item.pupilExam.date ?? item.pupilExam.noLaterThan;
    return day ? day >= from : (item.note?.date ?? from) >= addDays(from, -UNPLACED_EXAM_DAYS);
  })
    .sort((a, b) => ((a.pupilExam.date ?? "9999") + (a.pupilExam.start ?? "")).localeCompare((b.pupilExam.date ?? "9999") + (b.pupilExam.start ?? "")));
}

/** One day's notes of one kind, e.g. a pre-approved absence across six lessons. */
export interface NoteGroup {
  key: string;
  child: string;
  date: string;
  start: string | null;
  end: string | null;
  typeLabel: string;
  typeClass: string;
  teachers: string[];
  subjects: string[];
  note: string | null;
  first: LessonNote;
}

/**
 * An absence Wilma marks as unexplained ("selvittämätön poissaolo") stays
 * that way until a guardian explains it in Wilma; once explained, its type
 * changes and the task disappears on the next sync.
 */
export function absenceTask(note: Pick<NoteGroup, "typeLabel" | "typeClass">): FeedItem["task"] {
  if (!isUnexplained(note)) return null;
  return { label: t("Explain in Wilma"), reason: t("Wilma shows this absence as unexplained until a guardian explains it.") };
}

export function noteGroups(child: string, notes: LessonNote[]): NoteGroup[] {
  const groups = new Map<string, NoteGroup>();
  const sorted = [...notes].sort((a, b) => (a.date + (a.start ?? "")).localeCompare(b.date + (b.start ?? "")));
  for (const n of sorted) {
    const id = `${n.date}|${n.typeLabel}|${n.note ?? ""}`;
    let g = groups.get(id);
    if (!g) {
      g = {
        key: `note:${child}:${n.date}:${n.typeLabel}:${(n.note ?? "").slice(0, 40)}`,
        child,
        date: n.date,
        start: n.start,
        end: n.end,
        typeLabel: n.typeLabel,
        typeClass: n.typeClass,
        teachers: [],
        subjects: [],
        note: n.note ?? null,
        first: n,
      };
      groups.set(id, g);
    }
    if (n.subject && !g.subjects.includes(n.subject)) g.subjects.push(n.subject);
    if (n.teacher && !g.teachers.includes(n.teacher)) g.teachers.push(n.teacher);
    if (n.end) g.end = n.end;
  }
  return [...groups.values()];
}

export function preview(text: string | null, fallback = ""): string {
  const source = (text ?? fallback).replace(/\s+/g, " ").trim();
  return source.length > 180 ? `${source.slice(0, 178)}…` : source;
}

/** What Luna read: the step and its deadline when quoted, and the first event's day (in the calendar's thresholds). */
function detailOf(rec: LunaRecord | undefined): Detail | null {
  if (!rec || rec.error) return null;
  const now = today();
  const T = LUNA_THRESHOLDS;
  const day = rec.events.find((e) => e.kind !== "deadline" && e.pDate >= T.keepDate && e.pCalendar + (e.pOptional ?? 0) >= T.keepCalendar && (e.endDate ?? e.date) >= now) ?? null;
  // Sure, for everyone it's about (not a choice), and for one of the family's children (no pupils named: all of the item's).
  // A trip or event the item puts on that day is the day's news (on the day and in the calendar): its hours are part of it.
  const tripThatDay = (e: LunaEvent) => rec.events.some((o) => (o.kind === "trip" || o.kind === "event") && o.date === e.date && o.pCalendar >= T.keepCalendar);
  const change =
    rec.events.find(
      (e) => e.kind === "schedule" && e.pDate >= T.sureDate && e.pCalendar >= T.sureCalendar && (e.pOptional ?? 0) < 0.5 && e.pupils?.length !== 0 && (e.endDate ?? e.date) >= now && !tripThatDay(e)
    ) ?? null;
  return {
    actionLine: rec.action?.quote ?? null,
    deadline: rec.action?.deadline ?? null,
    eventDate: day?.date ?? null,
    change,
    confirm: rec.action ? rec.action.pRequired : null,
    events: rec.events,
    model: rec.model ?? null,
  };
}

/** The days an item is about, still ahead: Luna's events (sure or suggested). */
const upcomingOf = (rec: LunaRecord | undefined) =>
  [...new Set((rec?.events ?? []).filter((e) => e.pDate >= LUNA_THRESHOLDS.keepDate && (e.endDate ?? e.date) >= today()).map((e) => e.date))].sort();

/** How soon, from the first date still ahead: 3 today or tomorrow, 2 this week, 1 within three weeks. */
export function urgencyOf(dates: (string | null | undefined)[]): number {
  const now = today();
  const next = dates.find((d): d is string => Boolean(d) && (d as string) >= now);
  if (!next) return 0;
  const days = daysBetween(now, next);
  return days <= 1 ? 3 : days <= 6 ? 2 : days <= 21 ? 1 : 0;
}

function triageOf(rec: JevRecord | undefined, detailRec: LunaRecord | undefined, preliminary: boolean): Triage | null {
  if (!rec || (rec.qs !== TRIAGE_QS && rec.qs !== TRIAGE_PUPIL_QS)) return null;
  const a = rec.answers;
  const first = a.needs_action?.type === "noul" ? a.needs_action.noul : 0;
  const detail = detailOf(detailRec);
  // The reading's look at the sentence itself (is this step required?): it decides when the first answer was unsure, and a
  // required step it quoted counts even when the first answer missed it (a polite or passive request).
  const action = detail?.confirm == null ? first : first >= 0.45 && first < 0.75 ? detail.confirm : Math.max(first, detail.confirm);
  const scope = a.scope?.type === "choice" ? (a.scope.choice as Scope) : "school";
  const scopeConfidence = a.scope?.type === "choice" ? a.scope.confidence : 0;
  const about = a.scope?.type === "choice" ? (a.scope.probabilities.pupil ?? 0) : 0;
  const praise = a.praise?.type === "noul" ? a.praise.noul : 0;
  const kind = a.kind?.type === "choice" ? (a.kind.choice as Kind) : "general";
  const kindConfidence = a.kind?.type === "choice" ? a.kind.confidence : 0;
  return {
    qs: rec.qs,
    needsAction: action,
    firstNeedsAction: first,
    urgency: 0, // set once the item's dates are known (buildFeed)
    kind,
    kindConfidence,
    aboutChild: about,
    scope,
    scopeConfidence,
    praise,
    preliminary,
    model: rec.model,
    answers: a,
    detail,
  };
}

/** The sentence a list shows under the title: what to do, or, when nothing is asked of the parent, how a school day changes. */
function lineOf(triage: Triage | null): string | null {
  const d = triage?.detail;
  if (!d) return null;
  return d.change && triage.needsAction < NEEDS_YOU ? d.change.quote : d.actionLine;
}

/** The AI's reading of the teacher's words, else the note's own type as Notes counts it (data/notes.ts). */
function toneOf(note: NoteGroup, rec: JevRecord | undefined, kinds: Record<string, NoteKind>): FeedItem["tone"] {
  if (rec?.answers.tone?.type === "choice" && rec.answers.tone.confidence >= 0.5) return rec.answers.tone.choice as FeedItem["tone"];
  const kind = noteKind(note, kinds);
  return kind === "praise" ? "praise" : kind === "explain" || kind === "late" || kind === "forgot" || kind === "remark" ? "concern" : null;
}

/** Why an open invitation is a task: whole sentences per case (Finnish puts "by" after the date). */
function signUpReason(until: Date | undefined): string {
  if (!until) return t("The school asks you to sign up.");
  const { day, time } = deadlineDay(until);
  const days = daysBetween(today(), day);
  if (time === null) {
    if (days === 0) return t("The school asks you to sign up today.");
    if (days === 1) return t("The school asks you to sign up by tomorrow.");
    return t("The school asks you to sign up by {date}.", { date: shortDate(day) });
  }
  if (days === 0) return t("The school asks you to sign up, by {time} today.", { time });
  if (days === 1) return t("The school asks you to sign up, by {time} tomorrow.", { time });
  return t("The school asks you to sign up, by {date} {time}.", { date: shortDate(day), time });
}

/** In place of the sender, for what the family sent: who it went to (once the thread is read), and whether it's answered. */
function sentLine(recipients: string[] | null, waiting: boolean): string {
  if (!recipients?.length) return waiting ? t("Sent by you, no reply yet") : t("Sent by you");
  const names = `${recipients.slice(0, 2).join(", ")}${recipients.length > 2 ? ` +${recipients.length - 2}` : ""}`;
  return waiting ? t("To {names}, no reply yet", { names }) : t("To {names}", { names });
}

export function buildFeed(state: Pick<AppState, "snapshot" | "local" | "jev" | "luna">): FeedItem[] {
  const snap = state.snapshot;
  if (!snap) return [];
  const now = today();
  // A student's own login: signing up for a meeting and explaining an absence are a guardian's to do, not the pupil's.
  const student = viewerOf(snap.account, state.local) === "student";
  const items: FeedItem[] = [];

  for (const m of Object.values(snap.messages)) {
    // An unticked child's (data/logins.ts) stays in the snapshot, unshown.
    if (!aboutShown(snap, m.children)) continue;
    const key = `m:${m.id}`;
    const text = m.thread?.content ?? null;
    // The family's own message, not answered yet, isn't read (an earlier reading of it doesn't show either).
    const waiting = awaitingReply(m);
    const triage = waiting ? null : triageOf(state.jev[key], state.luna[key], !m.thread);
    const inviteData = m.thread?.invite ?? null;
    const invite = m.invite
      ? {
          data: inviteData,
          status: m.invite.status,
          extra: m.invite.extra,
          awaiting: Boolean(inviteData && inviteData.mustApply && awaitingAnswer(inviteData)),
          // Either guardian's sign-up counts for the family.
          chosen: inviteData?.slots.find((slot) => slot.selected || slot.selectedByOther) ?? null,
        }
      : undefined;
    // Written by this family: its dates still count (the calendar), but it's never a step for them.
    const own = Boolean(m.sent) || writtenByFamily(m.sender, snap.children);
    const openUntil = inviteData?.slots
      .filter((slot) => slotState(slot) === "open" && slot.enrollEnd)
      .map((slot) => slot.enrollEnd!)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    const inviteDates = [
      ...(invite?.chosen?.start ? [dateOf(invite.chosen.start)] : []),
      ...(invite?.awaiting && openUntil ? [deadlineDay(openUntil).day] : []),
    ].filter((d) => d >= now);
    items.push({
      key,
      kind: "message",
      id: m.id,
      children: m.children,
      title: m.subject || t("(no subject)"),
      from: m.sent ? sentLine(m.thread?.recipients ?? null, waiting) : m.sender,
      at: m.sentAt,
      text,
      preview: preview(text),
      // What the family just sent isn't news to them.
      isNew: !waiting && !state.local.opened[key] && (m.unreadInWilma || m.sentAt.getTime() > firstSyncOf(snap, loginOfId(m.id))),
      done: Boolean(state.local.done[key]),
      upcoming: [...new Set([...inviteDates, ...upcomingOf(waiting ? undefined : state.luna[key])])].sort(),
      dated: Boolean(!waiting && state.luna[key]?.events.length) || inviteDates.length > 0,
      triage,
      actionLine: own ? null : lineOf(triage),
      deadline: own ? null : triage?.detail?.deadline ?? null,
      eventDate: triage?.detail?.eventDate ?? null,
      change: own ? null : triage?.detail?.change ?? null,
      task: invite?.awaiting && !student ? { label: t("Sign up"), reason: signUpReason(openUntil) } : null,
      own,
      awaitingReply: waiting || undefined,
      invite,
      tone: triage && triage.praise >= 0.6 && triage.aboutChild >= 0.5 ? "praise" : null,
      replyCount: m.replyCount,
      pinnedAt: state.local.pinned?.[key] ?? null,
    });
  }
  for (const n of Object.values(snap.news)) {
    if (!aboutShown(snap, n.children)) continue;
    const key = `n:${n.id}`;
    const text = n.detail?.content ?? null;
    const at = n.published ?? new Date(0);
    const triage = triageOf(state.jev[key], state.luna[key], !n.detail);
    items.push({
      key,
      kind: "news",
      id: n.id,
      children: n.children,
      title: n.title,
      from: n.author,
      at,
      text,
      preview: preview(text, n.subtitle ?? ""),
      isNew: !state.local.opened[key] && at.getTime() > firstSyncOf(snap, loginOfId(n.id)),
      done: Boolean(state.local.done[key]),
      upcoming: upcomingOf(state.luna[key]),
      dated: Boolean(state.luna[key]?.events.length),
      triage,
      actionLine: lineOf(triage),
      deadline: triage?.detail?.deadline ?? null,
      eventDate: triage?.detail?.eventDate ?? null,
      change: triage?.detail?.change ?? null,
      task: null,
      tone: null,
      replyCount: 0,
      pinned: n.pinned,
      pinnedAt: state.local.pinned?.[key] ?? null,
    });
  }
  for (const child of snap.children) {
    for (const note of noteGroups(child.number, snap.perChild[child.number]?.notes ?? [])) {
      // Notes on coming lessons wait for their day (the calendar reads them now).
      if (note.date > today()) continue;
      const key = note.key;
      const at = new Date(`${note.date}T${note.start ?? "08:00"}:00+03:00`);
      const exam = noteExam(snap, note, state.luna[key]);
      items.push({
        key,
        kind: "note",
        id: null,
        children: [child.number],
        title: note.typeLabel,
        from: note.teachers.join(", ") || null,
        at,
        text: note.note,
        preview: preview(note.note, note.subjects.join(", ")),
        isNew: !state.local.opened[key] && at.getTime() > firstSyncOf(snap, loginOfChild(child.number)),
        done: Boolean(state.local.done[key]),
        upcoming: [],
        dated: false,
        triage: null,
        actionLine: null,
        deadline: null,
        eventDate: null,
        task: student ? null : absenceTask(note),
        tone: toneOf(note, state.jev[key], noteKinds(state.jev, state.local.noteKinds)),
        replyCount: 0,
        note,
        pupilExam: exam && !examSuperseded(key, exam, state.luna) ? exam : null,
      });
    }
  }
  // Urgency is code's job: the deadline Jev picked, else the day it's about, else any date ahead.
  for (const item of items) {
    if (item.triage) item.triage.urgency = urgencyOf([item.deadline, item.eventDate, ...item.upcoming]);
  }
  return items.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** The date that matters most for an item: its deadline, the day it's about, or the first date ahead. */
export function keyDate(item: FeedItem): string | null {
  const now = today();
  return [item.deadline, item.eventDate, ...item.upcoming].find((d): d is string => Boolean(d) && (d as string) >= now) ?? null;
}

/** Higher first: how much an item needs the parent now. */
export function priority(item: FeedItem): number {
  // A task Wilma itself records outranks a model's reading; the newest first among them.
  if (item.task) return 3 - Math.min(1, daysBetween(dateOf(item.at), today()) / 30);
  const t = item.triage;
  if (!t) return 0;
  const when = keyDate(item);
  const soon = when ? Math.max(0, 1 - daysBetween(today(), when) / 14) : 0;
  return t.needsAction * 2 + t.urgency / 3 + soon * 0.5 + SCOPE_WEIGHT[t.scope] * 0.5;
}

/**
 * The app's rule for "needs you", from Jev's answers plus facts code knows:
 * a required step (not an optional invitation), or a school day that runs
 * differently in the week ahead (a parent has to know when a first-grader's
 * day ends early), from the child's own school (not the city or an
 * association), and not already over.
 */
export function isNeedsYou(i: FeedItem): boolean {
  if (i.done || i.own) return false;
  if (i.task) return true;
  // An invitation's state is known exactly (signed up, closed, open): that wins over the model's reading.
  if (i.invite?.data) return false;
  const t = i.triage;
  if (!t || t.scope === "wider") return false;
  const now = today();
  if (i.change && (i.change.endDate ?? i.change.date) >= now && daysBetween(now, i.change.date) <= 6) return true;
  if (t.needsAction < NEEDS_YOU) return false;
  const age = daysBetween(dateOf(i.at), now);
  if (t.detail) {
    // Stage 2 named the dates. A passed deadline ends it; so does a passed event day. A past
    // day that isn't an event (the absence being explained) doesn't: that still needs doing.
    if (i.deadline) return i.deadline >= now || age <= 1;
    if (i.eventDate && (t.kind === "event" || t.kind === "schedule")) return i.eventDate >= now || age <= 1;
    return age <= 21;
  }
  if (i.dated && i.upcoming.length === 0 && age > 1) return false; // its dates have passed
  if (!i.dated && age > 14) return false; // undated and old
  return true;
}

export function needsYou(items: FeedItem[]): FeedItem[] {
  return items.filter(isNeedsYou).sort((a, b) => priority(b) - priority(a));
}

/** Nothing to do, but worth knowing soon: tomorrow's later start, a class trip day, from the child's own school. */
export function goodToKnow(items: FeedItem[]): FeedItem[] {
  const now = today();
  return items
    .filter((i) => {
      const t = i.triage;
      if (!t || i.done || isNeedsYou(i) || t.scope === "wider") return false;
      if (daysBetween(dateOf(i.at), now) > 10) return false;
      const day = i.eventDate ?? i.upcoming[0];
      const soon = day !== undefined && day >= now && daysBetween(now, day) <= 2;
      return soon && (t.kind === "event" || t.kind === "schedule" || Boolean(i.eventDate));
    })
    .sort((a, b) => (keyDate(a) ?? "9").localeCompare(keyDate(b) ?? "9"));
}

export function forChildren(items: FeedItem[], selected: string[]): FeedItem[] {
  if (!selected.length) return items;
  return items.filter((i) => i.children.some((c) => selected.includes(c)));
}

export interface AgendaEntry {
  date: string;
  time: string | null;
  child: string;
  kind: "exam" | "event" | "deadline" | "schedule";
  title: string;
  detail: string | null;
  itemKey: string | null;
}

/**
 * What's coming in the next three weeks (or between `range.from` and
 * `range.until`, e.g. one week): exams from Wilma, plus dates in messages Jev
 * says matter.
 */
export function agenda(snap: Snapshot, items: FeedItem[], selected: string[], range?: { from: string; until: string }): AgendaEntry[] {
  const now = range?.from ?? today();
  const until = range?.until ?? addDays(now, 21);
  const entries: AgendaEntry[] = [];
  for (const child of snap.children) {
    if (selected.length && !selected.includes(child.number)) continue;
    for (const exam of snap.perChild[child.number]?.exams ?? []) {
      if (exam.date < now || exam.date > until) continue;
      entries.push({
        date: exam.date,
        time: exam.time ?? null,
        child: child.number,
        kind: "exam",
        title: exam.subject || exam.name,
        detail: exam.topic || exam.name || null,
        itemKey: null,
      });
    }
  }
  for (const item of forChildren(items, selected)) {
    if (item.invite) {
      const { chosen, awaiting, data } = item.invite;
      if (chosen?.start && dateOf(chosen.start) >= now && dateOf(chosen.start) <= until) {
        entries.push({ date: dateOf(chosen.start), time: clock(chosen.start), child: item.children[0], kind: "event", title: item.title, detail: t("Signed up"), itemKey: item.key });
      }
      const deadline = data?.slots.filter((slot) => slotState(slot) === "open" && slot.enrollEnd).map((slot) => slot.enrollEnd!).sort((a, b) => a.getTime() - b.getTime())[0];
      const last = deadline ? deadlineDay(deadline) : null;
      if (awaiting && last && last.day >= now && last.day <= until) {
        entries.push({ date: last.day, time: last.time, child: item.children[0], kind: "deadline", title: t("Sign up: {title}", { title: item.title }), detail: item.from, itemKey: item.key });
      }
      if (data) continue;
    }
    const tri = item.triage;
    if (!tri || item.done || tri.scope === "wider") continue;
    const needs = isNeedsYou(item);
    if (tri.detail) {
      // Stage 2 named the dates: exactly those, no guessing from every date in the text.
      if (needs && item.deadline && item.deadline >= now && item.deadline <= until) {
        entries.push({ date: item.deadline, time: null, child: item.children[0], kind: "deadline", title: item.title, detail: item.actionLine ?? item.from, itemKey: item.key });
      }
      // A changed school day goes by what changes ("Lyhennetty koulupäivä"), not the message's subject.
      const change = item.change;
      if (change && change.date >= now && change.date <= until) {
        entries.push({ date: change.date, time: null, child: item.children[0], kind: "schedule", title: change.title, detail: item.title, itemKey: item.key });
      }
      const aboutDay = needs || tri.kind === "event" || tri.kind === "schedule";
      if (aboutDay && item.eventDate && item.eventDate !== item.deadline && item.eventDate !== change?.date && item.eventDate >= now && item.eventDate <= until) {
        entries.push({ date: item.eventDate, time: null, child: item.children[0], kind: tri.kind === "schedule" ? "schedule" : "event", title: item.title, detail: item.from, itemKey: item.key });
      }
      continue;
    }
    if (!item.upcoming.length) continue;
    const relevant = needs || tri.kind === "event" || tri.kind === "schedule";
    if (!relevant) continue;
    for (const date of item.upcoming.slice(0, 2)) {
      if (date > until) continue;
      entries.push({
        date,
        time: null,
        child: item.children[0],
        kind: tri.kind === "schedule" ? "schedule" : tri.kind === "event" ? "event" : "deadline",
        title: item.title,
        detail: item.from,
        itemKey: item.key,
      });
    }
  }
  return entries.sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? "")));
}

export function childByNumber(snap: Snapshot | null, number: string): Child | undefined {
  return snap?.children.find((c) => c.number === number);
}
