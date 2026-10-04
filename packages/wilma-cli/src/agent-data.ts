import {
  WilmaClient,
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

/* ------------------------------------------------------------------ */
/*  Date helpers shared by the CLI and agent tools                     */
/* ------------------------------------------------------------------ */

// School days follow Finnish time, even when an agent runs on a UTC cloud computer.
const SCHOOL_TIME_ZONE = "Europe/Helsinki";

/** YYYY-MM-DD for an instant, in Finnish time. */
export function finnishDate(d: Date = new Date()): string {
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

export function todayString(): string {
  return finnishDate();
}

export function nextSchoolDay(from?: string): string {
  let d = addDays(from ?? todayString(), 1);
  // Skip Saturday (6) and Sunday (0)
  while (weekdayOf(d) === 0 || weekdayOf(d) === 6) {
    d = addDays(d, 1);
  }
  return d;
}

export function currentWeekBounds(): [string, string] {
  const today = todayString();
  const dayOfWeek = weekdayOf(today); // 0=Sun, 1=Mon, ...
  const monday = addDays(today, dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
  return [monday, addDays(monday, 4)];
}

export function parseIsoDate(raw: string): string {
  const value = (raw ?? "").trim();
  // Accept YYYY-MM-DD only.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid date "${raw}". Expected YYYY-MM-DD.`);
  }
  // Validate date is real.
  const d = new Date(value + "T12:00:00Z");
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid date "${raw}". Expected a real calendar date.`);
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

export function nextDateForWeekday(rawWeekday: string): string {
  const target = WEEKDAYS[(rawWeekday ?? "").trim().toLowerCase()];
  if (target === undefined) {
    throw new Error(
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

export function resolveScheduleDateSelection(opts: { when?: string; date?: string; weekday?: string }): ScheduleDateSelection {
  const when = opts.when || "week";

  if (opts.date && opts.weekday) {
    throw new Error("Use either --date or --weekday, not both.");
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

  const [startDate, endDate] = currentWeekBounds();
  return { when, startDate, endDate, outputWhen: when };
}

export function buildSummaryData(
  overview: OverviewData,
  news: Awaited<ReturnType<WilmaClient["news"]["list"]>>,
  messages: Awaited<ReturnType<WilmaClient["messages"]["list"]>>,
  days: number,
  studentLabel?: string
) {
  const today = todayString();
  const tomorrow = nextSchoolDay();
  const daysAgo = (n: number) => addDays(today, -n);
  const cutoffDate = daysAgo(days);
  const homeworkCutoff = daysAgo(3);

  const todaySchedule = overview.schedule.filter((l) => l.date === today);
  const tomorrowSchedule = overview.schedule.filter((l) => l.date === tomorrow);
  const upcomingExams = overview.upcomingExams;
  const recentHomework = overview.homework.filter((h) => h.date >= homeworkCutoff);
  const recentNews = news
    .filter((n) => n.published && finnishDate(n.published) >= cutoffDate)
    .slice(0, 5)
    .map((n) => ({
      wilmaId: n.wilmaId,
      title: n.title,
      published: n.published?.toISOString() ?? null,
    }));
  const recentMessages = messages
    .filter((m) => finnishDate(m.sentAt) >= cutoffDate)
    .slice(0, 5)
    .map((m) => ({
      wilmaId: m.wilmaId,
      subject: m.subject,
      sentAt: m.sentAt.toISOString(),
      senderName: m.senderName ?? null,
    }));

  return {
    generatedAt: new Date().toISOString(),
    student: studentLabel ?? null,
    today,
    tomorrow,
    todaySchedule,
    tomorrowSchedule,
    upcomingExams,
    recentHomework,
    recentNews,
    recentMessages,
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
export function selectNews(news: NewsItem[], opts: { limit?: number; includeOlder?: boolean } = {}): NewsItem[] {
  const dated = news.filter((item) => !item.archived && item.published).slice(0, opts.limit ?? 20);
  const pinnedUndated = news.filter((item) => !item.archived && !item.published);
  const older = opts.includeOlder ? news.filter((item) => item.archived) : [];
  return [...dated, ...pinnedUndated, ...older];
}

/** The first day of a period ending today that is `days` long. */
export function daysBack(days: number): string {
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
  pool.set(poolKey(profile), { client: Promise.resolve(client), lastUsed: Date.now() });
}

function pooledSession(account: AccessAccount): Promise<WilmaClient> {
  const now = Date.now();
  for (const [key, entry] of pool) {
    if (now - entry.lastUsed > POOL_IDLE_MS) pool.delete(key);
  }
  const key = poolKey(account.profile);
  let entry = pool.get(key);
  if (!entry) {
    const client = WilmaClient.login({ ...account.profile, studentNumber: null }, account.mfa);
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
  if (!matches.length) throw new Error(`No student matching "${student}". Students on this account: ${names}`);
  throw new Error(`"${student}" matches several students (${matches.map((s) => s.name).join(", ")}). Use the full name or student number.`);
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
      throw new Error(
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

  async summary(opts: { student?: string; days?: number } = {}) {
    const result = await this.perStudent(opts.student, async (client, s) => {
      const [overview, news, messages] = await Promise.all([
        client.overview.get(),
        client.news.list(),
        client.messages.list("inbox"),
      ]);
      return { summary: buildSummaryData(overview, news, messages, opts.days ?? 7, s.name) };
    });
    return { generatedAt: new Date().toISOString(), ...result };
  }

  async schedule(opts: { student?: string; when?: "today" | "tomorrow" | "week"; date?: string; weekday?: string } = {}) {
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
      const overview = await client.overview.get();
      return { exams: overview.upcomingExams.slice(0, opts.limit ?? 20) };
    });
  }

  async grades(opts: { student?: string; limit?: number } = {}) {
    return this.perStudent(opts.student, async (client) => {
      const overview = await client.overview.get();
      return { grades: overview.grades.slice(0, opts.limit ?? 20) };
    });
  }

  /** Lesson notes for one day (default today), or the last `days` days. */
  async lessonNotes(opts: { student?: string; date?: string; days?: number } = {}) {
    if (opts.days && opts.date) throw new Error("Use either a date or a number of days, not both.");
    if (opts.days) {
      const from = daysBack(opts.days);
      const to = todayString();
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
      const { printout, response } = await client.printouts.fetch(opts.id);
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
        throw new Error(`Resource "${opts.resourceId}" not found in news item ${opts.newsId} (available: ${known})`);
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
