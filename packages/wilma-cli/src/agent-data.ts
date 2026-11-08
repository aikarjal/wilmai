import {
  NetworkError,
  WilmaClient,
  addExamTimes,
  type InvitationListing,
  type LessonNote,
  type Message,
  type MessageFolder,
  type MessageRecipient,
  type MfaCallback,
  type NewsItem,
  type NewsResource,
  type OverviewData,
  type ScheduleLesson,
  type StudentInfo,
  type WilmaProfile,
} from "@wilm-ai/wilma-client";
import { fileNameFromResponse, readResponseCapped } from "./downloads.js";
import type { SessionStore } from "./session-store.js";
import { sessionKeyV1, type SessionKeys } from "./session-keys.js";

/**
 * An error with a stable code for agents and scripts (the CLI's JSON errors
 * and exit codes use it): e.g. "unknown_student", "invalid_argument".
 */
export class WilmaAiError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "WilmaAiError";
    this.code = code;
    this.details = details;
  }
}

/* ------------------------------------------------------------------ */
/*  Date helpers shared by the CLI and agent tools                     */
/* ------------------------------------------------------------------ */

// School days follow Finnish time, even when an agent runs on a UTC cloud computer.
const SCHOOL_TIME_ZONE = "Europe/Helsinki";

/** YYYY-MM-DD for an instant, in Finnish time. */
function finnishDate(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SCHOOL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday */
function weekdayOf(isoDate: string): number {
  return new Date(isoDate + "T12:00:00Z").getUTCDay();
}

function todayString(): string {
  return finnishDate();
}

function nextSchoolDay(from?: string): string {
  let d = addDays(from ?? todayString(), 1);
  // Skip Saturday (6) and Sunday (0)
  while (weekdayOf(d) === 0 || weekdayOf(d) === 6) {
    d = addDays(d, 1);
  }
  return d;
}

/** The school day before `from` (default today): Friday for a Monday. */
function previousSchoolDay(from?: string): string {
  let d = addDays(from ?? todayString(), -1);
  while (weekdayOf(d) === 0 || weekdayOf(d) === 6) {
    d = addDays(d, -1);
  }
  return d;
}

function currentWeekBounds(weeksAhead = 0): [string, string] {
  const today = todayString();
  const dayOfWeek = weekdayOf(today); // 0=Sun, 1=Mon, ...
  const monday = addDays(today, (dayOfWeek === 0 ? -6 : 1 - dayOfWeek) + 7 * weeksAhead);
  return [monday, addDays(monday, 4)];
}

/** YYYY-MM-DD, or "today", "yesterday" or "tomorrow" (Finnish time). */
export function parseIsoDate(raw: string): string {
  const value = (raw ?? "").trim();
  const word = value.toLowerCase();
  if (word === "today") return todayString();
  if (word === "yesterday") return addDays(todayString(), -1);
  if (word === "tomorrow") return addDays(todayString(), 1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new WilmaAiError("invalid_argument", `Invalid date "${raw}". Use YYYY-MM-DD, today, yesterday or tomorrow.`);
  }
  // Validate date is real.
  const d = new Date(value + "T12:00:00Z");
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new WilmaAiError("invalid_argument", `Invalid date "${raw}". Expected a real calendar date.`);
  }
  return value;
}

const WEEKDAYS: Record<string, number> = {
  sun: 0, su: 0, sunday: 0,
  mon: 1, ma: 1, monday: 1,
  tue: 2, ti: 2, tuesday: 2,
  wed: 3, ke: 3, wednesday: 3,
  thu: 4, to: 4, thursday: 4,
  fri: 5, pe: 5, friday: 5,
  sat: 6, la: 6, saturday: 6,
};

function nextDateForWeekday(rawWeekday: string): string {
  const target = WEEKDAYS[(rawWeekday ?? "").trim().toLowerCase()];
  if (target === undefined) {
    throw new WilmaAiError(
      "invalid_argument",
      `Invalid weekday "${rawWeekday}". Use mon|tue|wed|thu|fri|sat|sun (also accepts fi: ma|ti|ke|to|pe|la|su).`
    );
  }
  // Asking for "thu" on a Saturday gives next Thursday; today's weekday gives today.
  const today = todayString();
  return addDays(today, (target - weekdayOf(today) + 7) % 7);
}

export type ScheduleDateSelection = {
  when: string;
  startDate: string;
  endDate: string;
  queryDate?: string;
  outputWhen: string;
};

export const SCHEDULE_WHEN = ["today", "tomorrow", "week", "next-week"] as const;

/** The longest period one schedule request covers. */
export const SCHEDULE_MAX_DAYS = 31;

function resolveScheduleDateSelection(opts: { when?: string; date?: string; weekday?: string; from?: string; to?: string }): ScheduleDateSelection {
  const when = opts.when || "week";
  if (!(SCHEDULE_WHEN as readonly string[]).includes(when)) {
    throw new WilmaAiError("invalid_argument", `Unknown period "${when}". Use ${SCHEDULE_WHEN.join(", ")}, a date or a weekday.`);
  }

  if ([opts.date, opts.weekday, opts.from].filter(Boolean).length > 1) {
    throw new WilmaAiError("invalid_argument", "Use one of a date, a weekday, or from/to.");
  }
  if (opts.to && !opts.from) throw new WilmaAiError("invalid_argument", "A period needs a start date (from) as well.");

  if (opts.from) {
    const from = parseIsoDate(opts.from);
    // Without an end: to the Friday of that week (a school week from any day).
    const to = opts.to ? parseIsoDate(opts.to) : addDays(from, Math.max(0, 5 - weekdayOf(from)));
    if (to < from) throw new WilmaAiError("invalid_argument", `The period ends (${to}) before it starts (${from}).`);
    if (addDays(from, SCHEDULE_MAX_DAYS - 1) < to) {
      throw new WilmaAiError("invalid_argument", `A period can be at most ${SCHEDULE_MAX_DAYS} days; ask for a longer one in parts.`);
    }
    return { when, startDate: from, endDate: to, outputWhen: "period" };
  }

  if (opts.date) {
    const parsed = parseIsoDate(opts.date);
    return { when, startDate: parsed, endDate: parsed, queryDate: parsed, outputWhen: "date" };
  }

  if (opts.weekday) {
    const parsed = nextDateForWeekday(opts.weekday);
    return { when, startDate: parsed, endDate: parsed, queryDate: parsed, outputWhen: "weekday" };
  }

  if (when === "today") {
    const date = todayString();
    return { when, startDate: date, endDate: date, outputWhen: when };
  }

  if (when === "tomorrow") {
    const date = nextSchoolDay();
    return { when, startDate: date, endDate: date, outputWhen: when };
  }

  const [startDate, endDate] = currentWeekBounds(when === "next-week" ? 1 : 0);
  return { when, startDate, endDate, outputWhen: when };
}

/**
 * An event invitation as listed: the message, plus the family's answer as
 * Wilma's list shows it ("Applied" with the chosen time, "ExpiredReg"…;
 * null when it shows none).
 */
export type ListedMessage = Message & { invitationStatus?: string | null; invitationInfo?: string | null };

function listedInvitation(listing: InvitationListing): ListedMessage {
  return { ...listing.message, invitationStatus: listing.status, invitationInfo: listing.extra };
}

/** Everything a daily summary is built from (see fetchSummaryInputs). */
export interface SummaryInputs {
  overview: OverviewData;
  news: NewsItem[];
  messages: ListedMessage[];
  lessonNotes: LessonNote[];
  /** Parts Wilma couldn't give this time (the rest of the summary is still right). */
  unavailable: string[];
}

/**
 * One child's daily briefing: today's and the next school day's lessons,
 * upcoming exams (with start times), recent homework, lesson notes (teachers'
 * feedback and absences), bulletins and messages. Without `since`: bulletins
 * and messages from the last `days` days, homework from the last 3 days, and
 * lesson notes from the previous school day. With `since` (YYYY-MM-DD): only
 * what is from that day on. Unread messages are always included.
 */
function buildSummaryData(input: SummaryInputs, opts: { days?: number; since?: string } = {}) {
  const today = todayString();
  const tomorrow = nextSchoolDay();
  const cutoff = opts.since ?? addDays(today, -(opts.days ?? 7));
  const homeworkCutoff = opts.since ?? addDays(today, -3);
  const { overview } = input;

  const news = input.news
    .filter((n) => n.published && finnishDate(n.published) >= cutoff)
    .slice(0, opts.since ? 30 : 10)
    .map((n) => ({ wilmaId: n.wilmaId, title: n.title, published: n.published, pinned: Boolean(n.pinned) }));
  const messages = input.messages
    .filter((m) => m.unread || finnishDate(m.sentAt) >= cutoff)
    .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())
    .slice(0, opts.since ? 30 : 10)
    .map((m) => ({
      wilmaId: m.wilmaId,
      subject: m.subject,
      sentAt: m.sentAt,
      senderName: m.senderName ?? null,
      folder: m.folder,
      unread: Boolean(m.unread),
      replyCount: m.replyCount ?? 0,
      ...(m.invitationStatus !== undefined ? { invitationStatus: m.invitationStatus, invitationInfo: m.invitationInfo ?? null } : {}),
    }));

  return {
    today,
    tomorrow,
    todaySchedule: overview.schedule.filter((l) => l.date === today),
    tomorrowSchedule: overview.schedule.filter((l) => l.date === tomorrow),
    upcomingExams: overview.upcomingExams,
    homework: overview.homework.filter((h) => h.date >= homeworkCutoff),
    lessonNotes: input.lessonNotes,
    news,
    messages,
    unreadMessages: input.messages.filter((m) => m.unread).length,
    ...(input.unavailable.length ? { unavailable: input.unavailable } : {}),
  };
}

/* ------------------------------------------------------------------ */
/*  Agent data access                                                  */
/* ------------------------------------------------------------------ */

export type StudentRef = { studentNumber: string; name: string; wilma?: string };

/** One Wilma login. A family can have several (children on different Wilmas). */
export interface AccessAccount {
  /** For a keychain login the password is empty here and `password` gives it. */
  profile: WilmaProfile;
  /** The password when Wilma needs a new login (a keychain read), never while a saved session works. */
  password?: () => Promise<string>;
  /** Where its session is saved and pooled; by default today's key (address, username and password). */
  keys?: SessionKeys;
  mfa?: MfaCallback;
  /** The Wilma's name, shown to tell children apart when there are several logins. */
  label?: string | null;
  onStudents?: (students: StudentInfo[]) => Promise<void>;
  /** The children saved with the login, used when Wilma's own list comes back empty. */
  knownStudents?: { studentNumber: string; name: string; role?: StudentInfo["role"] }[];
  /** Student numbers unticked on the login page (a profile Wilma lists twice): not read. */
  hidden?: string[];
}

type AccountStudent = StudentInfo & { account: number };

export type FetchedAttachment =
  | {
      status: "fetched";
      /** Set for a bulletin attachment. */
      newsId?: number;
      /** Set for a printout (Tulosteet); `resource` then describes the printout. */
      printoutId?: string;
      resource: NewsResource;
      fileName: string;
      contentType: string | null;
      data: Buffer;
    }
  | {
      status: "not_a_file";
      newsId: number;
      resource: NewsResource;
      message: string;
    };

/**
 * Bulletins to show: the newest `limit` dated ones, every pinned one (they
 * stay relevant all year), and the older ones only when asked for.
 */
function selectNews(news: NewsItem[], opts: { limit?: number; includeOlder?: boolean } = {}): NewsItem[] {
  const dated = news.filter((item) => !item.archived && item.published).slice(0, opts.limit ?? 20);
  const pinnedUndated = news.filter((item) => !item.archived && !item.published);
  const older = opts.includeOlder ? news.filter((item) => item.archived) : [];
  return [...dated, ...pinnedUndated, ...older];
}

/**
 * What a daily summary needs, fetched at once. The front page and inbox are
 * required; bulletins (some Wilmas don't show them to a guardian), meeting
 * invitations, lesson notes and exam times aren't — if Wilma can't give one,
 * the summary says so in `unavailable`.
 */
async function fetchSummaryInputs(client: WilmaClient, opts: { notesFrom: string }): Promise<SummaryInputs> {
  const unavailable: string[] = [];
  const optional = <T>(name: string, promise: Promise<T>, fallback: T): Promise<T> =>
    promise.catch((err) => {
      if (err instanceof NetworkError) throw err;
      unavailable.push(name);
      return fallback;
    });
  const [overview, calendar, news, inbox, appointments, lessonNotes] = await Promise.all([
    client.overview.get(),
    client.exams.calendarOrEmpty(),
    client.news.listIfShown(),
    client.messages.list("inbox"),
    // The invitations folder, with whether the family has answered (one request, as for the folder itself).
    optional("appointments", client.invitations.list(), [] as InvitationListing[]),
    optional("lessonNotes", client.attendance.list({ from: opts.notesFrom, to: todayString() }), [] as LessonNote[]),
  ]);
  if (news === null) unavailable.push("news");
  return {
    overview: { ...overview, upcomingExams: addExamTimes(overview.upcomingExams, calendar) },
    news: news ?? [],
    messages: [...inbox, ...appointments.map(listedInvitation)],
    lessonNotes,
    unavailable,
  };
}

/** The first day of a period ending today that is `days` long. */
function daysBack(days: number): string {
  const today = todayString();
  return addDays(today, -(days - 1));
}

/** What each teacher teaches, by teacher code as the timetable writes it ("KOJ" → ["Matematiikka"]). */
function subjectsByTeacher(lessons: ScheduleLesson[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const lesson of lessons) {
    // A lesson can have several teachers ("KOJ, MÄL"): each teaches it.
    for (const code of (lesson.teacherCode ?? "").split(",")) {
      const key = code.trim().toUpperCase();
      if (!key || !lesson.subject) continue;
      const list = map.get(key) ?? [];
      if (!list.includes(lesson.subject)) map.set(key, [...list, lesson.subject]);
    }
  }
  return map;
}

/** The teacher's code at the end of a name as Wilma's recipient lists write it: "Korhonen Jussi (KOJ)" → "KOJ". */
function codeInName(name: string): string | null {
  return /\(([^()\s]{1,12})\)\s*$/.exec(name)?.[1] ?? null;
}

/**
 * The child's own teachers in Wilma's recipient list: the list behind its
 * "all own teachers" group (whatever the Wilma's language calls it), once
 * each. Without that group, none.
 */
function ownTeachers(recipients: MessageRecipient[]): MessageRecipient[] {
  const group = recipients.find((r) => r.kind === "group" && /[?&]r_ownteachers=/.test(r.composePath))?.group;
  if (!group) return [];
  const seen = new Set<string>();
  return recipients.filter((r) => {
    if (r.kind !== "teacher" || r.group !== group || seen.has(r.name)) return false;
    seen.add(r.name);
    return true;
  });
}

/* ------------------------------------------------------------------ */
/*  Session pool                                                       */
/* ------------------------------------------------------------------ */

// Wilma allows one live session per account: every new login cancels the
// previous one (and logs the parent out of Wilma in their own browser).
// Assistants often call several tools at once, so tool calls in one process
// share a session per account instead of logging in each time. Sessions
// re-log in by themselves if Wilma cancels them.
const POOL_IDLE_MS = 10 * 60 * 1000;
const pool = new Map<string, { client: Promise<WilmaClient>; lastUsed: number }>();

// Between processes (CLI commands, the local MCP server), sessions are saved
// in a store when the host sets one.
let sessionStore: SessionStore | undefined;

/** Continue saved sessions instead of logging in for each process (CLI and local MCP server). */
export function useSessionStore(store: SessionStore | undefined): void {
  sessionStore = store;
}

/**
 * Save the session for the other processes, and share theirs: when Wilma ends
 * this one, the client first continues the newest session another process
 * saved (a CLI command, an assistant's connector, the desktop app), and logs
 * in only when that one has ended too. Each login ends the others, so this
 * keeps WilmAI's programs from logging each other out.
 */
function rememberSession(key: string, client: WilmaClient, opts: { fresh: boolean }): void {
  const store = sessionStore;
  if (!store) return;
  const save = (state: string): Promise<void> => {
    const saving = store.save(key, state).catch(() => {});
    pendingSaves.add(saving);
    void saving.finally(() => pendingSaves.delete(saving));
    return saving;
  };
  client.useSharedSession({ load: () => store.load(key), save });
  // A resumed session is already saved (and another process may have saved a newer one since).
  if (opts.fresh) void save(client.exportSession());
}

const pendingSaves = new Set<Promise<void>>();

/** Today's keys for a login known by its password (file and environment logins): a changed password starts fresh. */
function defaultKeys(profile: WilmaProfile): SessionKeys {
  const key = sessionKeyV1(profile.baseUrl, profile.username, profile.password);
  return { sessionKey: key, poolKey: key };
}

/**
 * Keep a session that is already logged in — e.g. the one the login page just
 * verified — so the first tool call needs no second login (and, with two-step
 * verification, no second code). `keys` are the saved login's (v2 for a
 * keychain login); without them, today's keys from the profile.
 */
export function adoptSession(profileOrKeys: WilmaProfile | SessionKeys, client: WilmaClient): void {
  const keys = "sessionKey" in profileOrKeys ? profileOrKeys : defaultKeys(profileOrKeys);
  pool.set(keys.poolKey, { client: Promise.resolve(client), lastUsed: Date.now() });
  rememberSession(keys.sessionKey, client, { fresh: true });
}

/**
 * Finish saving sessions (call before a short-lived process exits). Only
 * logins made here are saved, never an older session over a newer one
 * another process saved meanwhile.
 */
export async function flushSessions(): Promise<void> {
  for (const entry of pool.values()) await entry.client.catch(() => null);
  await Promise.all([...pendingSaves]);
}

/** Drop this process's client for a login (after its secrets moved, so the next use starts from its new keys). */
export function dropPooledSession(keys: SessionKeys): void {
  pool.delete(keys.poolKey);
}

/**
 * End WilmAI's Wilma session for one login (Wilma's own "Log out") and forget
 * it, in this process and in the session store, so nothing continues it. The
 * login itself stays saved; the next command or tool call logs in again.
 * Never logs in (so it needs no password). Returns true when a live session
 * was ended, false when there was none. If Wilma can't be reached, throws and
 * keeps the saved session, so logging out can be tried again.
 */
export async function logoutSession(profile: WilmaProfile, keys: SessionKeys = defaultKeys(profile)): Promise<boolean> {
  const entry = pool.get(keys.poolKey);
  // The session in use here (a login in progress finishes first) and the saved
  // one, which another process may have replaced since. At most one is live.
  const pooled = entry ? await entry.client.catch(() => null) : null;
  const pooledState = pooled?.exportSession();
  const saved = sessionStore ? await sessionStore.load(keys.sessionKey).catch(() => null) : null;
  let ended = pooled ? await pooled.logout() : false;
  if (pool.get(keys.poolKey) === entry) pool.delete(keys.poolKey);
  if (saved && saved !== pooledState) {
    const resumed = WilmaClient.resume({ ...profile, studentNumber: null }, saved);
    if (resumed && (await resumed.logout())) ended = true;
  }
  await sessionStore?.remove(keys.sessionKey);
  return ended;
}

/** Forget one login's session without ending it in Wilma (when the login itself is removed). */
export async function forgetSession(profile: WilmaProfile, keys: SessionKeys = defaultKeys(profile)): Promise<void> {
  pool.delete(keys.poolKey);
  await sessionStore?.remove(keys.sessionKey);
}

function pooledSession(account: AccessAccount): Promise<WilmaClient> {
  const now = Date.now();
  for (const [key, entry] of pool) {
    if (now - entry.lastUsed > POOL_IDLE_MS) pool.delete(key);
  }
  const keys = account.keys ?? defaultKeys(account.profile);
  let entry = pool.get(keys.poolKey);
  if (!entry) {
    const profile = { ...account.profile, studentNumber: null };
    const lazy = account.password;
    const client = (async () => {
      // A saved session first; it logs in again by itself if Wilma has ended it
      // (reading a keychain login's password only then).
      const saved = sessionStore ? await sessionStore.load(keys.sessionKey).catch(() => null) : null;
      const resumed = saved ? WilmaClient.resume({ ...profile, password: lazy ?? profile.password }, saved, account.mfa) : null;
      const client = resumed ?? (await WilmaClient.login({ ...profile, password: lazy ? await lazy() : profile.password }, account.mfa));
      rememberSession(keys.sessionKey, client, { fresh: !resumed });
      return client;
    })();
    const created = { client, lastUsed: now };
    entry = created;
    pool.set(keys.poolKey, created);
    client.catch(() => {
      if (pool.get(keys.poolKey) === created) pool.delete(keys.poolKey);
    });
  }
  entry.lastUsed = now;
  return entry.client;
}

/**
 * Read-only Wilma access for agent tools (MCP). Covers every Wilma login the
 * family has saved; every method defaults to all children, and a student
 * number or name narrows it. Uses one pooled session per Wilma login for
 * listing and for every child.
 */
/**
 * The students a name or number refers to. Agents and people pass names from
 * free text, so match strictly: a student number, the full name, or the start
 * of a name part ("Kiia" for "Kiia Example"). No fuzzy matching — a child not
 * on the account must not match a sibling. Throws when nothing or several match.
 */
export function matchStudents<T extends { studentNumber: string; name: string }>(students: T[], student: string): T[] {
  const needle = student.trim().toLowerCase();
  const names = students.map((s) => s.name).join(", ") || "none";
  const byNumber = students.filter((s) => s.studentNumber === student.trim());
  if (byNumber.length === 1) return byNumber;
  const exact = students.filter((s) => s.name.toLowerCase() === needle);
  const matches = exact.length
    ? exact
    : students.filter((s) => {
        const name = s.name.toLowerCase();
        return name.startsWith(needle) || name.split(/[\s-]+/).some((part) => part.startsWith(needle));
      });
  if (matches.length === 1) return matches;
  const list = students.map((s) => ({ studentNumber: s.studentNumber, name: s.name }));
  if (!matches.length) {
    throw new WilmaAiError("unknown_student", `No student matching "${student}". Students on this account: ${names}`, { students: list });
  }
  throw new WilmaAiError(
    "ambiguous_student",
    `"${student}" matches several students (${matches.map((s) => s.name).join(", ")}). Use the full name or student number.`,
    { students: list }
  );
}

/** Whose login it is: a student's own when Wilma lists only the student themself, a guardian's when it says so. */
export function roleOf(students: { role?: StudentInfo["role"] }[]): StudentInfo["role"] {
  if (students.length && students.every((s) => s.role === "student")) return "student";
  return students.some((s) => s.role === "guardian") ? "guardian" : undefined;
}

export class WilmaAccess {
  private readonly accounts: AccessAccount[];
  private studentsCache: AccountStudent[] | null = null;
  /** The children each login lists (by login index), including those read through another login. */
  private readonly listed = new Map<number, StudentInfo[]>();
  /** Why a login failed (by login index), while others worked. */
  private readonly failures = new Map<number, string>();
  /** One logged-in session per Wilma login, shared by every child on it. */
  private readonly sessions = new Map<number, Promise<WilmaClient>>();
  /** Logins that failed while other logins worked. */
  readonly problems: { wilma: string; message: string }[] = [];

  constructor(accounts: AccessAccount | AccessAccount[]) {
    this.accounts = Array.isArray(accounts) ? accounts : [accounts];
    if (!this.accounts.length) throw new Error("No Wilma login");
  }

  private get multi(): boolean {
    return this.accounts.length > 1;
  }

  private session(index: number): Promise<WilmaClient> {
    let session = this.sessions.get(index);
    if (!session) {
      session = pooledSession(this.accounts[index]);
      this.sessions.set(index, session);
    }
    return session;
  }

  private labelOf(index: number): string {
    const account = this.accounts[index];
    return account.label ?? account.profile.baseUrl;
  }

  private ref(s: AccountStudent): StudentRef {
    return this.multi
      ? { studentNumber: s.studentNumber, name: s.name, wilma: this.labelOf(s.account) }
      : { studentNumber: s.studentNumber, name: s.name };
  }

  async students(): Promise<AccountStudent[]> {
    if (this.studentsCache) return this.studentsCache;
    // Different Wilma logins can't cancel each other, so log in to all at once.
    const fetched = await Promise.all(
      this.accounts.map(async (_account, index) => {
        try {
          return { index, list: await (await this.session(index)).students() };
        } catch (error) {
          return { index, error };
        }
      })
    );
    const all: AccountStudent[] = [];
    const seen = new Map<string, number>();
    let firstError: unknown = null;
    let worked = 0;
    for (const result of fetched) {
      const account = this.accounts[result.index];
      if (!("list" in result) || !result.list) {
        firstError ??= result.error;
        const message = result.error instanceof Error ? result.error.message : String(result.error);
        this.problems.push({ wilma: this.labelOf(result.index), message });
        this.failures.set(result.index, message);
        continue;
      }
      worked += 1;
      // One at a time: these write the saved config.
      await account.onStudents?.(result.list);
      const list: StudentInfo[] = result.list.length
        ? result.list
        : account.knownStudents?.length
          ? // An empty answer keeps the children saved with the login.
            account.knownStudents.map((s) => ({ ...s, href: `/!${s.studentNumber}/` }))
          : // Accounts that list no students still work against the default page.
            [{ studentNumber: account.profile.studentNumber ?? "", name: "", href: "/" }];
      this.listed.set(result.index, list);
      for (const student of list) {
        if (account.hidden?.includes(student.studentNumber)) continue;
        // Two logins on the same Wilma (two guardians, or a guardian and the child) list the same child once.
        const key = `${account.profile.baseUrl.replace(/\/$/, "").toLowerCase()}|${student.studentNumber}`;
        const at = seen.get(key);
        if (at === undefined) {
          seen.set(key, all.length);
          all.push({ ...student, account: result.index });
        } else if (all[at].role === "student" && student.role === "guardian") {
          // A guardian's login over the child's own, whichever logged in last: the parent's view (messages to guardians, invitations).
          all[at] = { ...student, account: result.index };
        }
      }
    }
    if (!worked) throw firstError instanceof Error ? firstError : new Error("Could not log in to Wilma");
    this.studentsCache = all;
    return all;
  }

  /**
   * The children as tools and commands show them (with their Wilma when there
   * are several), and whose login reads each: a guardian's, or the student's own.
   */
  async studentList(): Promise<(StudentRef & { role?: StudentInfo["role"] })[]> {
    return (await this.students()).map((s) => ({ ...this.ref(s), ...(s.role ? { role: s.role } : {}) }));
  }

  /**
   * Each login: its Wilma, username, whose it is (a guardian's, or a
   * student's own; missing when Wilma doesn't say) and the children it lists.
   * A child another login on the same Wilma also lists is read through one of
   * them only; `readVia` names the other login's username. A child unticked
   * on the login page has `hidden: true` and isn't read.
   */
  async logins() {
    const students = await this.students();
    return this.accounts.map((account, index) => {
      const listed = (this.listed.get(index) ?? []).filter((s) => s.name);
      const role = roleOf(listed);
      return {
        wilma: this.labelOf(index),
        username: account.profile.username,
        ...(role ? { role } : {}),
        children: listed.map((s) => {
          if (account.hidden?.includes(s.studentNumber)) return { name: s.name, studentNumber: s.studentNumber, hidden: true };
          const read = students.find((x) => x.studentNumber === s.studentNumber && this.sameWilma(x.account, index));
          return {
            name: s.name,
            studentNumber: s.studentNumber,
            ...(read && read.account !== index ? { readVia: this.accounts[read.account].profile.username } : {}),
          };
        }),
        ...(this.failures.has(index) ? { problem: this.failures.get(index) } : {}),
      };
    });
  }

  private sameWilma(a: number, b: number): boolean {
    const url = (i: number) => this.accounts[i].profile.baseUrl.replace(/\/$/, "").toLowerCase();
    return url(a) === url(b);
  }

  async selectStudents(student?: string): Promise<AccountStudent[]> {
    const students = await this.students();
    return student ? matchStudents(students, student) : students;
  }

  private async client(student: AccountStudent): Promise<WilmaClient> {
    return (await this.session(student.account)).forStudent(student.studentNumber || null);
  }

  private async perStudent<T>(student: string | undefined, fn: (client: WilmaClient, s: StudentInfo) => Promise<T>) {
    const selected = await this.selectStudents(student);
    // All children at once; children on one Wilma share its session.
    const results: ({ student: StudentRef } & T)[] = await Promise.all(
      selected.map(async (s) => ({ student: this.ref(s), ...(await fn(await this.client(s), s)) }))
    );
    return this.problems.length ? { students: results, problems: this.problems } : { students: results };
  }

  /** Try each selected student until one can open the item (messages and news are often shared across siblings). */
  private async firstStudentWith<T>(student: string | undefined, fn: (client: WilmaClient) => Promise<T>) {
    if (!student && this.multi) {
      // Message and news ids are only unique within one Wilma.
      throw new WilmaAiError(
        "student_required",
        "Several Wilmas are connected and ids are only unique within one Wilma. Pass the student the item was listed under."
      );
    }
    const selected = await this.selectStudents(student);
    let lastError: unknown;
    for (const s of selected) {
      try {
        const client = await this.client(s);
        return { student: this.ref(s), item: await fn(client) };
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Item not found");
  }

  /** The daily briefing per child (see buildSummaryData). `since`: YYYY-MM-DD, "yesterday"… */
  async summary(opts: { student?: string; days?: number; since?: string } = {}) {
    const since = opts.since ? parseIsoDate(opts.since) : undefined;
    const notesFrom = since ?? previousSchoolDay();
    const result = await this.perStudent(opts.student, async (client) => {
      const inputs = await fetchSummaryInputs(client, { notesFrom });
      return { summary: buildSummaryData(inputs, { days: opts.days, since }) };
    });
    return { generatedAt: new Date(), ...(since ? { since } : {}), ...result };
  }

  async schedule(opts: { student?: string; when?: (typeof SCHEDULE_WHEN)[number]; date?: string; weekday?: string; from?: string; to?: string } = {}) {
    const selection = resolveScheduleDateSelection(opts);
    const range =
      selection.outputWhen === "period"
        ? { from: selection.startDate, to: selection.endDate }
        : selection.startDate === selection.endDate
          ? { date: selection.startDate }
          : { weekStart: selection.startDate, weekEnd: selection.endDate };
    const result = await this.perStudent(opts.student, async (client) => ({
      lessons: await client.schedule.list({ from: selection.startDate, to: selection.endDate }),
    }));
    return { when: selection.outputWhen, ...range, ...result };
  }

  async homework(opts: { student?: string; limit?: number } = {}) {
    return this.perStudent(opts.student, async (client) => {
      const overview = await client.overview.get();
      return { homework: overview.homework.slice(0, opts.limit ?? 10) };
    });
  }

  async upcomingExams(opts: { student?: string; limit?: number } = {}) {
    return this.perStudent(opts.student, async (client) => {
      return { exams: (await client.exams.upcoming()).slice(0, opts.limit ?? 20) };
    });
  }

  /**
   * Exam grades: the newest the front page lists, or with `from` (to `to`,
   * default today) Wilma's list of past exams for that period (Kokeet >
   * Menneet), including exams still waiting for a grade (grade: null).
   */
  async grades(opts: { student?: string; limit?: number; from?: string; to?: string } = {}) {
    if (opts.to && !opts.from) throw new WilmaAiError("invalid_argument", "A period needs a start date (from) as well.");
    if (opts.from) {
      const from = parseIsoDate(opts.from);
      const to = opts.to ? parseIsoDate(opts.to) : todayString();
      if (to < from) throw new WilmaAiError("invalid_argument", `The period ends (${to}) before it starts (${from}).`);
      return {
        from,
        to,
        ...(await this.perStudent(opts.student, async (client) => {
          const exams = await client.exams.past({ from, to });
          // Every exam of the period unless a limit is given.
          return { grades: opts.limit ? exams.slice(0, opts.limit) : exams };
        })),
      };
    }
    return this.perStudent(opts.student, async (client) => {
      const overview = await client.overview.get();
      return { grades: overview.grades.slice(0, opts.limit ?? 20) };
    });
  }

  /** Lesson notes for one day (default today), the last `days` days, or `from`–`to` (to defaults to today). */
  async lessonNotes(opts: { student?: string; date?: string; days?: number; from?: string; to?: string } = {}) {
    const ways = [opts.date, opts.days, opts.from].filter((x) => x !== undefined).length;
    if (ways > 1) throw new WilmaAiError("invalid_argument", "Use one of a date, a number of days, or from/to.");
    if (opts.to && !opts.from) throw new WilmaAiError("invalid_argument", "A period needs a start date (from) as well.");
    if (opts.days || opts.from) {
      const from = opts.days ? daysBack(opts.days) : parseIsoDate(opts.from!);
      const to = opts.to ? parseIsoDate(opts.to) : todayString();
      return {
        from,
        to,
        ...(await this.perStudent(opts.student, async (client) => ({ notes: await client.attendance.list({ from, to }) }))),
      };
    }
    const date = opts.date ? parseIsoDate(opts.date) : todayString();
    return { date, ...(await this.perStudent(opts.student, async (client) => ({ notes: await client.attendance.list({ date }) }))) };
  }

  /** Lesson notes counted by kind (absences, lateness, feedback…): this school year, or from a date. */
  async lessonNotesSummary(opts: { student?: string; from?: string; to?: string } = {}) {
    const from = opts.from ? parseIsoDate(opts.from) : undefined;
    const to = opts.to ? parseIsoDate(opts.to) : undefined;
    return this.perStudent(opts.student, async (client) => ({ summary: await client.attendance.summary({ from, to }) }));
  }

  async gradebook(opts: { student?: string } = {}) {
    return this.perStudent(opts.student, async (client) => ({ gradebook: await client.gradebook.get() }));
  }

  /**
   * The child's class, class teacher and other supervisors (front page), and
   * their own teachers (Wilma's recipient list) with what each teaches them,
   * from this and next week's timetable. Parts Wilma can't give are listed in
   * `unavailable`.
   */
  async contacts(opts: { student?: string } = {}) {
    const [from] = currentWeekBounds(0);
    const [, to] = currentWeekBounds(1);
    return this.perStudent(opts.student, async (client) => {
      const unavailable: string[] = [];
      const optional = <T>(name: string, promise: Promise<T>, fallback: T): Promise<T> =>
        promise.catch((err) => {
          if (err instanceof NetworkError) throw err;
          unavailable.push(name);
          return fallback;
        });
      const [details, recipients, lessons] = await Promise.all([
        client.student.get(),
        optional("teachers", client.messages.recipients(), [] as MessageRecipient[]),
        // Only for what each teacher teaches.
        client.schedule.list({ from, to }).catch((err) => {
          if (err instanceof NetworkError) throw err;
          return [] as ScheduleLesson[];
        }),
      ]);
      const subjects = subjectsByTeacher(lessons);
      return {
        contacts: {
          className: details.className,
          supervisors: details.supervisors.map((s) => ({ name: s.name, role: s.role })),
          teachers: ownTeachers(recipients).map((r) => {
            const code = codeInName(r.name);
            return { name: r.name, subjects: (code && subjects.get(code.toUpperCase())) || [] };
          }),
          ...(unavailable.length ? { unavailable } : {}),
        },
      };
    });
  }

  async printouts(opts: { student?: string } = {}) {
    return this.perStudent(opts.student, async (client) => ({ printouts: await client.printouts.list() }));
  }

  async printout(opts: { id: string; student?: string }): Promise<FetchedAttachment & { student: StudentRef }> {
    const { student, item } = await this.firstStudentWith(opts.student, async (client) => {
      const { printout, response } = await client.printouts.fetch(opts.id).catch((err) => {
        throw /not found/.test(String(err?.message)) ? new WilmaAiError("not_found", `Printout "${opts.id}" not found`) : err;
      });
      const resource: NewsResource = { id: printout.id, label: printout.title, url: printout.path, authContext: "wilma" };
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() || null;
      const fileName = fileNameFromResponse(resource, response.headers.get("content-disposition"), contentType);
      const data = await readResponseCapped(response as Parameters<typeof readResponseCapped>[0]);
      return { status: "fetched" as const, printoutId: printout.id, resource, fileName, contentType, data };
    });
    return { ...item, student };
  }

  async messages(opts: { student?: string; folder?: MessageFolder; limit?: number } = {}) {
    return this.perStudent(opts.student, async (client) => {
      // Invitations come with the family's answer as Wilma lists it (the same request).
      const messages: ListedMessage[] =
        opts.folder === "appointments" ? (await client.invitations.list()).map(listedInvitation) : await client.messages.list(opts.folder ?? "inbox");
      return { messages: messages.slice(0, opts.limit ?? 20) };
    });
  }

  async message(opts: { id: number; student?: string }) {
    const { student, item } = await this.firstStudentWith(opts.student, (client) => client.messages.get(opts.id));
    return { student, message: item };
  }

  async news(opts: { student?: string; limit?: number; includeOlder?: boolean } = {}) {
    return this.perStudent(opts.student, async (client) => {
      const list = await client.news.listIfShown();
      // A Wilma that doesn't show this account its bulletins: none, and it says so (not the same as "no bulletins").
      return { news: selectNews(list ?? [], { limit: opts.limit, includeOlder: opts.includeOlder }), ...(list === null ? { unavailable: ["news"] } : {}) };
    });
  }

  async newsItem(opts: { id: number; student?: string }) {
    const { student, item } = await this.firstStudentWith(opts.student, (client) => client.news.get(opts.id));
    return { student, news: item as NewsItem };
  }

  async newsAttachment(opts: { newsId: number; resourceId: string; student?: string }): Promise<FetchedAttachment & { student: StudentRef }> {
    const { student, item } = await this.firstStudentWith(opts.student, async (client) => {
      const news = await client.news.get(opts.newsId);
      const resource = news.resources?.find((r) => r.id === opts.resourceId);
      if (!resource) {
        const known = (news.resources ?? []).map((r) => r.id).join(", ") || "none";
        throw new WilmaAiError("not_found", `Resource "${opts.resourceId}" not found in news item ${opts.newsId} (available: ${known})`);
      }
      const fetched = await client.news.fetchResource(opts.newsId, opts.resourceId, { item: news });
      if (fetched.status === "not_a_file" || !fetched.response) {
        return {
          status: "not_a_file" as const,
          newsId: opts.newsId,
          resource,
          message:
            "The link answered with a web page instead of a file. It may require signing in — open the URL in a browser instead.",
        };
      }
      const contentType = fetched.response.headers.get("content-type")?.split(";", 1)[0]?.trim() || null;
      const fileName = fileNameFromResponse(resource, fetched.response.headers.get("content-disposition"), contentType);
      const data = await readResponseCapped(fetched.response as Parameters<typeof readResponseCapped>[0]);
      return { status: "fetched" as const, newsId: opts.newsId, resource, fileName, contentType, data };
    });
    return { ...item, student };
  }
}
