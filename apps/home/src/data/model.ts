import type { GradebookEntry, LessonNote, MessageRecipient, NewsItem, OverviewData, PastExam, ScheduleLesson, StudentDetails, UpcomingExam } from "@wilma-client/src/core";
import type { Invitation as Invite } from "@wilma-client/src/core";
import { DEFAULT_AI_BUDGET } from "./ai-budget.ts";

export interface Child {
  number: string;
  name: string;
  /** First name, for tabs and sentences. */
  first: string;
  /** Index into the child palette (stable per family). */
  color: number;
}

export interface AccountInfo {
  baseUrl: string;
  username: string;
  tenantName: string | null;
  /** How the session was made: the parent's password, the WilmAI CLI's saved login (browser development only), or sample data. */
  via: "password" | "cli" | "demo";
  cliIndex?: number;
  /** Whose login this is, as Wilma's account roles say: a guardian's, or a student's own. Read at sign-in. */
  wilmaRole?: Viewer;
}

/** Who reads the app: a guardian (the parent) or the student themself. */
export type Viewer = "guardian" | "student";

export interface ThreadRec {
  content: string;
  /** When the opening message was sent (the list's time can be the newest reply's); missing in threads read before. */
  sentAt?: Date;
  recipients: string[] | null;
  replies: { id: number; sentAt: Date; senderName: string | null; content: string }[];
  collated: boolean;
  invite?: Invite | null;
  fetchedAt: Date;
}

export interface MessageRec {
  id: number;
  subject: string;
  sender: string | null;
  sentAt: Date;
  /** Wilma's own unread flag when last listed. */
  unreadInWilma: boolean;
  replyCount: number;
  /** Children whose Wilma listed it (siblings often share messages). */
  children: string[];
  thread?: ThreadRec;
  /** Set for event invitations: Wilma's list status ("Applied", "ExpiredReg", …) and its time note. */
  invite?: { status: string | null; extra: string | null };
  /** Listed in Wilma's Sent folder: the family wrote it. Wilma moves the thread to the inbox when someone answers. */
  sent?: boolean;
}

/** The family sent it and nobody has answered yet. */
export const awaitingReply = (m: Pick<MessageRec, "sent" | "replyCount">): boolean => Boolean(m.sent) && m.replyCount === 0;

export interface NewsRec {
  id: number;
  title: string;
  subtitle: string | null;
  author: string | null;
  published: Date | null;
  pinned: boolean;
  children: string[];
  /** The bulletin's text; `v` is how it was read (an older reading is read again). */
  detail?: { content: string; resources: NewsItem["resources"]; fetchedAt: Date; v?: number };
}

export interface ChildData {
  overview?: OverviewData;
  lessons: ScheduleLesson[];
  notes: LessonNote[];
  exams: UpcomingExam[];
  syncedAt?: Date;
  /** The child's class ("9C", from the front page), read once a week: the readers tell "8. lk" from the child's own grade by it. */
  className?: { value: string | null; fetchedAt: Date };
  /** Who the parent can write to about this child; read when writing a message, kept for a week. */
  contacts?: Contacts;
  /** Weeks outside this and next: read in the Week view or retained from an earlier sync, by Monday (YYYY-MM-DD). */
  weeks?: Record<string, { lessons: ScheduleLesson[]; fetchedAt: Date }>;
  /** The whole school year's lesson notes, read when the Notes view shows them (the sync reads the last 20 days). */
  yearNotes?: { notes: LessonNote[]; fetchedAt: Date };
  /** Wilma's grade book (Suoritukset): subject > course, read when the Grades view shows it. */
  gradebook?: { entries: GradebookEntry[]; fetchedAt: Date };
  /** Past exams with their grades (Kokeet > Menneet), as far back as the school keeps them; read when the Grades view shows them. */
  pastExams?: { exams: PastExam[]; fetchedAt: Date; v?: number };
}

export interface Contacts {
  /** The class, class teacher and supervisors from the child's front page. */
  details: StudentDetails | null;
  /** Wilma's recipient list: own teachers, staff and teachers, the other guardian. */
  recipients: MessageRecipient[];
  fetchedAt: Date;
}

/** One of the family's Wilma logins (data/logins.ts): a parent can have one on each school's Wilma. */
export interface Login {
  /** 0: the first login (Wilma's own numbers); 1, 2, …: added later, its children's numbers and its items' ids carry it. Never reused. */
  slot: number;
  account: AccountInfo;
  /** The children Wilma lists for this login (family numbers), as last read. */
  students?: { number: string; name: string }[];
  /** The children not shown (unticked): not read from Wilma, and what was read about them stays. */
  hidden?: string[];
  /** When the app first read this Wilma: its older items don't count as new (as Snapshot.firstSyncAt). */
  firstSyncAt?: number;
  /** The parent signed out of it: nothing signs it in again by itself until they sign in. */
  signedOut?: boolean;
}

export interface Snapshot {
  version: 1;
  /** The login this family was first signed in with: the key of its data on this computer (store's accountKey). */
  account: AccountInfo;
  /** The family's Wilma logins; missing in installations from before, where the first login is the only one. */
  logins?: Login[];
  /** The highest slot a login has had (a removed login's isn't given to another). */
  lastSlot?: number;
  /** The children shown: every login's, less the unticked ones (Login.hidden). */
  children: Child[];
  perChild: Record<string, ChildData>;
  messages: Record<number, MessageRec>;
  news: Record<number, NewsRec>;
  syncedAt?: Date;
  /** When this app first read this account: older items don't count as new. */
  firstSyncAt?: number;
}

/** What the parent did in this app (kept on this device only). */
export interface LocalState {
  opened: Record<string, number>;
  done: Record<string, number>;
  /** Notifications sent (desktop app), by item key ("#due" for a deadline's reminder), and since when items notify. */
  notified?: Record<string, number>;
  notifyFrom?: number;
  /** Absences reported from this app: child → date → when and why. */
  reported?: Record<string, Record<string, { at: number; reason: string }>>;
  /** The calendar: suggestions taken or dismissed, the kinds that go to the calendar, and what's been written to it. */
  calendar?: CalendarLocal;
  /** Who the app is for on this account, when chosen in Settings (otherwise Wilma's role decides). */
  viewAs?: Viewer;
  /** Messages and bulletins pinned to the top of the inbox (key → when), only in this app. */
  pinned?: Record<string, number>;
  /** When a Windows user was told, once, that closing the window leaves the app by the clock. */
  trayTold?: number;
}

export interface CalendarLocal {
  /** A suggestion the parent took ("yes") or dismissed ("no"), by event key. */
  decisions: Record<string, "yes" | "no">;
  /** The kinds that go to the family calendar (missing: the default, see data/calendar.ts). */
  kinds: Partial<Record<string, boolean>>;
}

/** Jev's answers for one item, cached by question set and content. */
export interface JevRecord {
  qs: string;
  hash: string;
  /** A hash of each part of what Jev saw, to tell what changed when an item is asked again. */
  parts?: Record<string, string>;
  model: string;
  at: number;
  answers: Record<string, JevAnswer>;
  /** An exam mark's maximum, read from the mark, the name and the note (points or a scale; luna/marks.ts). */
  meta?: { maximum?: string | null };
}

/** What Luna read in one message, bulletin or note: its dated events, checked (see luna/events.ts). */
export interface LunaRecord {
  /** The reading's version and a hash of what was read (and by which model): read again when either changes. */
  v: string;
  hash: string;
  at: number;
  model?: string;
  /** The sentence saying what the guardian must do, its deadline, and how surely it's required (Luna's Decisions). */
  action?: {
    quote: string;
    title?: string | null;
    deadline: string | null;
    pRequired: number;
    /** The deadline checked on its own (lunaChecks.fields); a doubted one is cleared, kept in deadlineRead. */
    pDeadline?: number;
    deadlineRead?: string;
  } | null;
  events: LunaEvent[];
  /** A pupil's required exam at the next lesson of this note's subject; its date is resolved from Wilma's timetable. */
  nextLessonExam?: { quote: string; title: string; pRequired: number } | null;
  /** What this item says about earlier items' events (lunaChecks.crossItem), by event id (lunaEventId), with what was asked. */
  links?: { hash: string; about: Record<string, LunaLink> };
  /** The tiered strategy's route: the gate's answers, the rungs read (model/effort), and why it went up or stopped. */
  route?: { gate: { dated: number; step: number; many: number }; rungs: string[]; why: string | null };
  /** Events Luna gave whose quote isn't in the text (left out), for judging the experiment. */
  dropped: number;
  error?: string;
}

export interface LunaEvent {
  date: string;
  endDate: string | null;
  start: string | null;
  end: string | null;
  title: string;
  kind: "exam" | "trip" | "event" | "holiday" | "schedule" | "deadline";
  /** For the pupil (or the family's pupils), their class, the whole school, or only if needed (make-up exam days). */
  forWhom: "this_pupil" | "pupils_class" | "whole_school" | "only_if_needed";
  /** The children (numbers) it's for, as Luna's decisions judged it (empty: none of them); missing: all of the item's. */
  pupils?: string[];
  /** The source's own words, found in it word for word. */
  quote: string;
  /** Luna's decisions: the text gives this date (and time), and it belongs in the family's calendar. */
  pDate: number;
  pCalendar: number;
  /** Only for those who choose to join (lunaChecks.choices): from 0.5 a suggestion at most. */
  pOptional?: number;
  /** The time checked on its own (lunaChecks.fields); a doubted time is cleared. */
  pTime?: number;
  /** What the decisions changed (lunaChecks): the reading's own date, time or kind. */
  read?: { date?: string; endDate?: string | null; start?: string | null; kind?: LunaEvent["kind"] };
}

/** What a later item says about an earlier item's event, as probabilities (lunaChecks.crossItem). */
export interface LunaLink {
  cancelled: number;
  moved: number;
  same: number;
  /** The event as asked about: "2026-10-15 Retki Nuuksioon" (for the report). */
  what: string;
}

/** An event's id across readings: its item, day and title (a re-read that keeps them keeps the id). */
export const lunaEventId = (itemKey: string, e: Pick<LunaEvent, "date" | "title">) => `${itemKey}#${e.date}#${e.title.toLowerCase()}`;

/**
 * Where Luna's probabilities put an event (the eval suite tunes these, evals/calibrate.ts): in the calendar when both the
 * date and "it's the family's" are sure, a suggestion from keep, left out below; a later item cancelling or moving an
 * event from `superseded`.
 */
export const LUNA_THRESHOLDS = { sureDate: 0.7, sureCalendar: 0.75, keepDate: 0.5, keepCalendar: 0.45, superseded: 0.6 };
export type LunaThresholds = typeof LUNA_THRESHOLDS;

export interface ReadingUsage {
  calls: number;
  input: number;
  cached: number;
  output: number;
  reasoning: number;
}

/** OpenAI usage, by month ("2026-10"), for what the experiment costs. */
export interface UsageBucket {
  /** Reading (Responses API), by model. */
  reading?: Record<string, ReadingUsage>;
  /** Reading before the model could be chosen (gpt-6-luna). */
  responses?: ReadingUsage;
  decisions: { calls: number; input: number; estimated: boolean };
  /** Messages, bulletins and notes read. */
  items: number;
}

export type JevAnswer =
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "score"; score: number; probabilities: Record<string, number>; confidence: number }
  | { type: "noul"; noul: number };

/** The languages messages can be translated into (ai/translate.ts). */
export type TranslationLanguage = "fi" | "sv" | "en" | "uk" | "ar";

/** An item's translation (data/translations.ts), by item key: of what the item said (hash), into a language. */
export interface ItemTranslation {
  /** What was translated (ai/translate.ts sourceHash): translated again when the item changes, as with a new reply. */
  hash: string;
  language: TranslationLanguage;
  model: string;
  /** The language it was translated from, as the AI named it: an ISO 639-1 code ("sv"). */
  from: string;
  title: string;
  /** One per text: a thread's messages, or the one text; then the sentence on what to do, when there's one. */
  texts: string[];
  /** The translation of the sentence on what to do (the AI's quote), when there's one. */
  action: string | null;
  at: number;
  /** It couldn't be translated (not tried again until the item changes). */
  error?: string;
}

export interface Settings {
  /** Explicit opt-in. Older installations infer OpenAI from their saved key. */
  aiProvider?: "off" | CloudProvider | "local";
  localAI?: {
    /** Download/probe opt-in pending; does not enable school-data inference. */
    setupPending?: boolean;
    endpoint?: string;
    decisionModel?: string;
    readingModel?: string;
    /** Runtime version and verified model digests from local metadata. */
    fingerprint?: string;
    think?: boolean;
  };
  jevKey: string;
  /** The parent's OpenAI key, for the Luna experiment (kept scrambled like the Jev key). */
  openaiKey: string;
  /** The parent's Anthropic key, when Claude is the AI (kept scrambled like the OpenAI key). */
  anthropicKey?: string;
  /** Monthly OpenAI pause limit in USD, from 1 to 5; older settings default to 2. */
  aiMonthlyBudgetUsd?: number;
  /** Who answers the decision questions (not in the app's settings view: the eval suite runs Jev's own to compare). */
  decider?: "luna" | "jev" | "local";
  /** The Decisions model (gpt-6-luna today; the eval suite tries others as they come). */
  decisionsModel?: string;
  /** Cloud reading model; local mode uses the separate localAI model profile. */
  readingModel: string;
  /** How much the reading model reasons (not in the settings view yet: the eval suite compares); unset: medium (READING_EFFORT). */
  readingEffort?: "low" | "medium" | "high";
  /**
   * "fixed": one reading with the model and effort above; "gated": a Decisions gate skips items without dates or a step, the
   * rest are read once by Luna at medium (or Sol, for the hard ones, when allowed); "tiered": the gate, then Luna at low or
   * medium, a rung up when unsure (luna/events.ts).
   */
  readingStrategy?: "fixed" | "gated" | "tiered";
  /** Sol may read: the hard items (gated) or the last rung (tiered). */
  escalateToSol?: boolean;
  /**
   * Experiments with more of Luna's Decisions (the eval suite's configs; no settings view):
   * choices: a reading's date asked as a choice among nearby days (it can correct the date), whose as one choice among the
   *   pupils, and "only for those who choose to join" asked on its own (it makes an event only a suggestion);
   * fields: the time, the step's deadline and the kind checked each on its own;
   * crossItem: a later item asked about the events of earlier ones (cancelled, moved, the same event again).
   */
  lunaChecks?: { choices?: boolean; fields?: boolean; crossItem?: boolean };
  /** Notify when something new needs the parent, and the evening before a deadline (desktop app). */
  notify?: boolean;
  /**
   * Stay signed in: when Wilma ends the app's session, sign in again by itself (with the WilmAI CLI's saved login, or
   * the password kept below), backing off while Wilma is in use elsewhere. Off: the parent signs in (one click).
   */
  staySignedIn?: boolean;
  /**
   * Remember the Wilma password on this computer, so signing in again after Wilma ends the session is one click. On
   * unless turned off when signing in (a shared computer). Staying signed in keeps it either way.
   */
  rememberPassword?: boolean;
  /** Before there were several Wilmas: the one login's remembered password (kept scrambled, not encrypted); moves into `passwords`. */
  wilmaPassword: string;
  /** Each Wilma login's remembered password (data/logins.ts), by login (store's accountKey), kept scrambled like wilmaPassword. */
  passwords: Record<string, string>;
  jevModel: string;
  /** Read new messages in the background so Jev can sort them (Wilma then shows them as read). */
  backgroundRead: boolean;
  /** The app's language: "auto" follows the computer (Finnish if it's set to Finnish, otherwise English). */
  language: "auto" | "en" | "fi" | "sv";
  /** Light or dark: unset or "auto" follows the computer. */
  theme?: "auto" | "light" | "dark";
  /** What messages are translated into, with OpenAI or Claude (data/translations.ts); unset: no translations. */
  translateTo?: TranslationLanguage | "off";
  /** Who translates (ai/translate.ts TRANSLATORS, the chosen AI's); unset or another AI's: the default there. */
  translateModel?: string;
  /** Look for a newer version on wilm.ai now and then (desktop app). */
  updateChecks: boolean;
}

/** Whether the Wilma password is kept on this computer after signing in. */
export const keepsPassword = (s: Pick<Settings, "rememberPassword" | "staySignedIn">): boolean => s.rememberPassword !== false || Boolean(s.staySignedIn);

/** Local processing needs explicit opt-in; older saved cloud keys retain OpenAI. */
/** Who the app is for: the choice in Settings, else Wilma's role for the login, else a guardian. */
export const viewerOf = (account: Pick<AccountInfo, "wilmaRole"> | null | undefined, local: Pick<LocalState, "viewAs"> | null | undefined): Viewer =>
  local?.viewAs ?? account?.wilmaRole ?? "guardian";

/** The AI services the app can use with the parent's own key: one at a time, chosen in Settings. */
export type CloudProvider = "openai" | "anthropic";

export const intelligenceProvider = (s: Pick<Settings, "aiProvider" | "openaiKey">): "off" | CloudProvider | "local" => s.aiProvider ?? (s.openaiKey.trim() ? "openai" : "off");
/** The chosen AI service and its key, or null when the AI isn't a service (none, or local). */
export function cloudOf(s: Pick<Settings, "aiProvider" | "openaiKey" | "anthropicKey">): { provider: CloudProvider; key: string } | null {
  const provider = intelligenceProvider(s);
  if (provider === "openai") return { provider, key: s.openaiKey.trim() };
  if (provider === "anthropic") return { provider, key: (s.anthropicKey ?? "").trim() };
  return null;
}
export const intelligenceOn = (s: Pick<Settings, "aiProvider" | "openaiKey" | "anthropicKey">): boolean => intelligenceProvider(s) === "local" || Boolean(cloudOf(s)?.key);

export const DEFAULT_SETTINGS: Settings = {
  jevKey: "",
  openaiKey: "",
  aiMonthlyBudgetUsd: DEFAULT_AI_BUDGET,
  wilmaPassword: "",
  passwords: {},
  readingModel: "gpt-6-luna",
  // All three read best on the eval suite (99 % on 70 cases, 8 Oct 2026) for about a cent a month more.
  lunaChecks: { choices: true, fields: true, crossItem: true },
  notify: true,
  jevModel: "jev-1.13.0",
  backgroundRead: false,
  language: "auto",
  updateChecks: true,
};

export function emptySnapshot(account: AccountInfo): Snapshot {
  return { version: 1, account, children: [], perChild: {}, messages: {}, news: {} };
}

/** A child as the models are told: "Aino (9C)" when the class is known, else the first name. */
export function pupilName(snap: Snapshot, number: string): string {
  const child = snap.children.find((c) => c.number === number);
  const cls = snap.perChild[number]?.className?.value;
  return child ? (cls ? `${child.first} (${cls})` : child.first) : "the pupil";
}

/**
 * Written by this family: Wilma names a guardian with their child, "Karjalainen Antti (Kiia Karjalainen, 7G)", so a
 * sender naming one of the children is this parent or the other guardian; on a pupil's own login, the pupil writes as
 * themself. Another family's parent names their own child, so their messages still count as anyone else's.
 */
export function writtenByFamily(sender: string | null | undefined, children: Pick<Child, "name">[]): boolean {
  if (!sender) return false;
  const words = (s: string) => s.toLocaleLowerCase("fi").split(/\s+/).filter(Boolean).sort().join(" ");
  const named = sender.split("(")[0];
  const about = /\(([^,)]+)[,)]/.exec(sender)?.[1] ?? "";
  return children.some((c) => {
    const name = words(c.name);
    return name !== "" && (words(about) === name || words(named) === name);
  });
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
