import {
  NetworkError,
  WilmaClient,
  addExamTimes,
  type LessonNote,
  type Message,
  type MessageFolder,
  type MfaCallback,
  type NewsItem,
  type NewsResource,
  type OverviewData,
  type StudentInfo,
  type WilmaProfile,
} from "@wilm-ai/wilma-client";
import { createHash } from "node:crypto";
import { fileNameFromResponse, readResponseCapped } from "./downloads.js";
import type { SessionStore } from "./session-store.js";

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

function resolveScheduleDateSelection(opts: { when?: string; date?: string; weekday?: string }): ScheduleDateSelection {
  const when = opts.when || "week";
  if (!(SCHEDULE_WHEN as readonly string[]).includes(when)) {
    throw new WilmaAiError("invalid_argument", `Unknown period "${when}". Use ${SCHEDULE_WHEN.join(", ")}, a date or a weekday.`);
  }

  if (opts.date && opts.weekday) {
    throw new WilmaAiError("invalid_argument", "Use either a date or a weekday, not both.");
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

/** Everything a daily summary is built from (see fetchSummaryInputs). */
export interface SummaryInputs {
  overview: OverviewData;
  news: NewsItem[];
  messages: Message[];
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
  profile: WilmaProfile;
  mfa?: MfaCallback;
  /** The Wilma's name, shown to tell children apart when there are several logins. */
  label?: string | null;
  onStudents?: (students: StudentInfo[]) => Promise<void>;
  /** The children saved with the login, used when Wilma's own list comes back empty. */
  knownStudents?: { studentNumber: string; name: string }[];
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
 * What a daily summary needs, fetched at once. The front page, bulletins and
 * inbox are required; meeting invitations, lesson notes and exam times are
 * extras — if Wilma can't give one, the summary says so in `unavailable`.
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
    client.news.list(),
    client.messages.list("inbox"),
    optional("appointments", client.messages.list("appointments"), [] as Message[]),
    optional("lessonNotes", client.attendance.list({ from: opts.notesFrom, to: todayString() }), [] as LessonNote[]),
  ]);
  return {
    overview: { ...overview, upcomingExams: addExamTimes(overview.upcomingExams, calendar) },
    news,
    messages: [...inbox, ...appointments],
    lessonNotes,
    unavailable,
  };
}

/** The first day of a period ending today that is `days` long. */
function daysBack(days: number): string {
  const today = todayString();
  return addDays(today, -(days - 1));
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

function rememberSession(key: string, client: WilmaClient): void {
  const store = sessionStore;
  if (!store) return;
  const save = () => store.save(key, client.exportSession()).catch(() => {});
  client.onLogin(() => void save());
  void save();
}

/** Identifies one Wilma account and password (a changed password starts fresh). */
function poolKey(profile: WilmaProfile): string {
  const { baseUrl, username, password } = profile;
  // The password is part of the key, so a changed password starts a fresh session.
  return createHash("sha256")
    .update(`${baseUrl.replace(/\/$/, "")}\n${username.toLowerCase()}\n${password}`)
    .digest("hex");
}

/**
 * Keep a session that is already logged in — e.g. the one the login page just
 * verified — so the first tool call needs no second login (and, with two-step
 * verification, no second code).
 */
export function adoptSession(profile: WilmaProfile, client: WilmaClient): void {
  const key = poolKey(profile);
  pool.set(key, { client: Promise.resolve(client), lastUsed: Date.now() });
  rememberSession(key, client);
}

/** Save any sessions still being written (call before a short-lived process exits). */
export async function flushSessions(): Promise<void> {
  if (!sessionStore) return;
  for (const [key, entry] of pool) {
    const client = await entry.client.catch(() => null);
    if (client) await sessionStore.save(key, client.exportSession()).catch(() => {});
  }
}

function pooledSession(account: AccessAccount): Promise<WilmaClient> {
  const now = Date.now();
  for (const [key, entry] of pool) {
    if (now - entry.lastUsed > POOL_IDLE_MS) pool.delete(key);
  }
  const key = poolKey(account.profile);
  let entry = pool.get(key);
  if (!entry) {
    const profile = { ...account.profile, studentNumber: null };
    const client = (async () => {
      // A saved session first; it logs in again by itself if Wilma has ended it.
      const saved = sessionStore ? await sessionStore.load(key).catch(() => null) : null;
      const resumed = saved ? WilmaClient.resume(profile, saved, account.mfa) : null;
      const fresh = resumed ?? (await WilmaClient.login(profile, account.mfa));
      rememberSession(key, fresh);
      return fresh;
    })();
    const created = { client, lastUsed: now };
    entry = created;
    pool.set(key, created);
    client.catch(() => {
      if (pool.get(key) === created) pool.delete(key);
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

export class WilmaAccess {
  private readonly accounts: AccessAccount[];
  private studentsCache: AccountStudent[] | null = null;
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
    const seen = new Set<string>();
    let firstError: unknown = null;
    let worked = 0;
    for (const result of fetched) {
      const account = this.accounts[result.index];
      if (!("list" in result) || !result.list) {
        firstError ??= result.error;
        const message = result.error instanceof Error ? result.error.message : String(result.error);
        this.problems.push({ wilma: this.labelOf(result.index), message });
        continue;
      }
      worked += 1;
      // One at a time: these write the saved config.
      await account.onStudents?.(result.list);
      const list = result.list.length
        ? result.list
        : account.knownStudents?.length
          ? // An empty answer keeps the children saved with the login.
            account.knownStudents.map((s) => ({ ...s, href: `/!${s.studentNumber}/` }))
          : // Accounts that list no students still work against the default page.
            [{ studentNumber: account.profile.studentNumber ?? "", name: "", href: "/" }];
      for (const student of list) {
        // Two guardians' logins on the same Wilma list the same children once.
        const key = `${account.profile.baseUrl}|${student.studentNumber}`;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push({ ...student, account: result.index });
      }
    }
    if (!worked) throw firstError instanceof Error ? firstError : new Error("Could not log in to Wilma");
    this.studentsCache = all;
    return all;
  }

  /** The children as tools and commands show them (with their Wilma when there are several). */
  async studentList(): Promise<StudentRef[]> {
    return (await this.students()).map((s) => this.ref(s));
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

  async schedule(opts: { student?: string; when?: (typeof SCHEDULE_WHEN)[number]; date?: string; weekday?: string } = {}) {
    const selection = resolveScheduleDateSelection(opts);
    const range =
      selection.startDate === selection.endDate
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

  async grades(opts: { student?: string; limit?: number } = {}) {
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
      const messages = await client.messages.list(opts.folder ?? "inbox");
      return { messages: messages.slice(0, opts.limit ?? 20) };
    });
  }

  async message(opts: { id: number; student?: string }) {
    const { student, item } = await this.firstStudentWith(opts.student, (client) => client.messages.get(opts.id));
    return { student, message: item };
  }

  async news(opts: { student?: string; limit?: number; includeOlder?: boolean } = {}) {
    return this.perStudent(opts.student, async (client) => ({
      news: selectNews(await client.news.list(), { limit: opts.limit, includeOlder: opts.includeOlder }),
    }));
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
