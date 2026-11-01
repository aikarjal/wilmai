import { WilmaSession, MfaRequiredError, APIError, type SharedSession, type SessionEvent } from "./session.js";
import type {
  Exam,
  GradebookEntry,
  Invitation,
  InvitationListing,
  MessageRecipient,
  StudentDetails,
  LessonNote,
  LessonNoteSummary,
  Message,
  MessageFolder,
  NewsItem,
  NewsResource,
  OverviewData,
  PastExam,
  Printout,
  StudentInfo,
  UpcomingExam,
  WilmaProfile,
} from "./types.js";
import { parseWilmaTimestamp } from "./parsers/dates.js";
import { finnishDateString } from "./finnish-time.js";
import { parseMessagesList, parseMessageDetailHtml, parseMessageDetailJson } from "./parsers/messages.js";
import { parseInvitationListings } from "./parsers/invitations.js";
import { parseRecipientsHtml, parseStudentDetailsHtml, recipientListSources } from "./parsers/recipients.js";
import {
  parseNewsDetailHtml,
  parseNewsDetailJson,
  parseNewsList,
  parseNewsListHtml,
} from "./parsers/news.js";
import { addExamTimes, parseExamsHtml, parsePastExamsHtml } from "./parsers/exams.js";
import { parseAttendanceHtml, summarizeLessonNotes } from "./parsers/attendance.js";
import { parseGradebookHtml } from "./parsers/gradebook.js";
import { parsePrintoutsHtml } from "./parsers/printouts.js";
import { parseOverview } from "./parsers/overview.js";
import { parseScheduleHtml, parseTimetableJson } from "./parsers/schedule.js";
import { parseStudentsFromAccountsRoles, parseStudentsFromHome } from "./parsers/students.js";
import { NetworkError } from "./network-error.js";
import { DOWNLOAD_TIMEOUT_MS, getExternalFetcher, isHtmlResponse } from "./downloads.js";
import { sessionOf } from "./internal.js";
import type { WilmaTransport } from "./transport.js";

export type MfaCallback = (formkey: string) => Promise<string>;

export interface ClientOptions {
  /** How requests are sent (default: undici on Node; required with the "core" entry point unless a default is set). */
  transport?: WilmaTransport;
  /**
   * Log in again by itself when Wilma ends the session (default true). Every
   * login ends the parent's other Wilma sessions (browser, phone), so an app
   * the parent is looking at may prefer false: requests then fail with
   * SessionEndedError and the app asks.
   */
  relogin?: boolean;
  /**
   * Share the session with the other WilmAI programs on this computer (the
   * CLI, connectors, a desktop app) instead of each logging in and ending the
   * others' sessions. See SharedSession.
   */
  sharedSession?: SharedSession;
}

export class WilmaClient {
  private session: WilmaSession;

  private constructor(session: WilmaSession) {
    this.session = session;
    sessionOf.set(this, session);
  }

  static async login(profile: WilmaProfile, onMfaRequired?: MfaCallback, options: ClientOptions = {}): Promise<WilmaClient> {
    const session = new WilmaSession(profile.baseUrl, {
      studentNumber: profile.studentNumber ?? null,
      debug: profile.debug ?? false,
      transport: options.transport,
      relogin: options.relogin,
      shared: options.sharedSession,
    });
    session.setMfaCallback(onMfaRequired);
    try {
      await session.login(profile.username, profile.password);
    } catch (err) {
      if (err instanceof MfaRequiredError && onMfaRequired) {
        await session.answerMfa(err.formkey, onMfaRequired);
      } else {
        throw err;
      }
    }
    return new WilmaClient(session);
  }

  /**
   * A client on a session saved earlier with exportSession(), without logging
   * in. If Wilma has ended that session, the first request logs in again by
   * itself. Returns null when the saved state has no session.
   */
  static resume(profile: WilmaProfile, state: string, onMfaRequired?: MfaCallback, options: ClientOptions = {}): WilmaClient | null {
    const session = new WilmaSession(profile.baseUrl, {
      studentNumber: profile.studentNumber ?? null,
      debug: profile.debug ?? false,
      transport: options.transport,
      relogin: options.relogin,
      shared: options.sharedSession,
    });
    session.setMfaCallback(onMfaRequired);
    return session.resumeState(state, profile.username, profile.password) ? new WilmaClient(session) : null;
  }

  /**
   * A client on a saved session without any credentials: it never logs in.
   * When Wilma ends the session, requests fail with SessionEndedError. For
   * apps that don't keep the parent's password. Returns null when the saved
   * state has no session.
   */
  static resumeSession(baseUrl: string, state: string, options: Omit<ClientOptions, "relogin"> & { debug?: boolean } = {}): WilmaClient | null {
    const session = new WilmaSession(baseUrl, { debug: options.debug, transport: options.transport, relogin: false, shared: options.sharedSession });
    return session.resumeState(state) ? new WilmaClient(session) : null;
  }

  /** The Wilma this client talks to, e.g. "https://example.inschool.fi". */
  get origin(): string {
    return this.session.origin;
  }

  /** This login's session (cookies) as a string, for WilmaClient.resume() in a later process. Treat it like a password. */
  exportSession(): string {
    return this.session.exportState();
  }

  /**
   * End this login's session in Wilma (its "Log out"), e.g. so the parent can
   * use Wilma in the browser. Never logs in. Afterwards this client and its
   * forStudent() clients don't log in again by themselves. Returns true when
   * a live session was ended, false when there was none; throws (keeping the
   * session) when Wilma can't be reached.
   */
  logout(): Promise<boolean> {
    return this.session.logout();
  }

  /** Share the session with the other WilmAI programs on this computer from now on (see ClientOptions.sharedSession). */
  useSharedSession(shared: SharedSession | undefined): void {
    this.session.setShared(shared);
  }

  /** Run a callback after every successful login, e.g. to save the new session. */
  onLogin(callback: (() => void) | undefined): void {
    this.session.onLogin(callback);
  }

  /** Be told when this client logs in, continues another program's session, or finds its session ended (see SessionEvent). */
  onSessionEvent(callback: ((event: SessionEvent) => void) | undefined): void {
    this.session.onSessionEvent(callback);
  }

  static async listStudents(profile: WilmaProfile, onMfaRequired?: MfaCallback): Promise<StudentInfo[]> {
    const client = await WilmaClient.login({ ...profile, studentNumber: null }, onMfaRequired);
    return client.students();
  }

  /**
   * A client for one of the account's students that reuses this client's
   * login. Log in once, then call this per child instead of logging in again.
   */
  forStudent(studentNumber: string | null | undefined): WilmaClient {
    return new WilmaClient(this.session.forStudent(studentNumber || null));
  }

  /** The guardian's students, discovered with this client's login. */
  async students(): Promise<StudentInfo[]> {
    // Discovery pages live outside any student's "/!<number>/" prefix.
    const session = this.session.forStudent(null);
    try {
      const accountsResp = await session.get("/api/v1/accounts/me/roles");
      const accountsText = await accountsResp.text();
      const fromAccounts = parseStudentsFromAccountsRoles(safeJson(accountsText));
      if (fromAccounts.length > 0) {
        return fromAccounts;
      }
    } catch (err) {
      if (err instanceof NetworkError) {
        throw err;
      }
      // API missing or not JSON (e.g. 404 on older Wilma)
    }
    const resp = await session.get("/");
    const html = await resp.text();
    const fromHome = parseStudentsFromHome(html, resp.url);
    if (fromHome.length > 0) {
      return fromHome;
    }
    return [];
  }

  messages = {
    list: async (folder: MessageFolder = "inbox"): Promise<Message[]> => {
      const folderPaths: Record<MessageFolder, string> = {
        inbox: "/messages/list",
        archive: "/messages/list/archive",
        outbox: "/messages/list/outbox",
        drafts: "/messages/list/drafts",
        appointments: "/messages/list/appointments",
      };

      const path = folderPaths[folder] ?? "/messages/list";
      const resp = await this.session.get(path);
      const text = await resp.text();
      const data = safeJson(text);
      return parseMessagesList(data, folder);
    },

    /**
     * One message with its replies. Wilma answers `?format=json` with the whole
     * thread; older versions only have the HTML page, which is parsed instead.
     */
    get: async (messageId: number): Promise<Message> => {
      try {
        const resp = await this.session.get(`/messages/${messageId}?format=json`);
        const thread = parseMessageDetailJson(safeJson(await resp.text()), messageId);
        if (thread) return thread;
      } catch (err) {
        if (err instanceof NetworkError || !(err instanceof APIError) || err.status !== 404) throw err;
      }
      // Older versions: the message page (flat JSON on some, HTML on most).
      const resp = await this.session.get(`/messages/${messageId}`);
      const contentType = resp.headers.get("content-type")?.toLowerCase() ?? "";
      const text = await resp.text();
      if (contentType.includes("application/json")) {
        const data = safeJson(text) as Record<string, unknown>;
        return {
          wilmaId: messageId,
          subject: String(data["Subject"] ?? data["subject"] ?? ""),
          sentAt: parseWilmaTimestamp(data["TimeStamp"] ?? data["timestamp"]),
          folder: String(data["Folder"] ?? "unknown"),
          senderId: (data["SenderId"] as number | undefined) ?? null,
          senderType: (data["SenderType"] as number | undefined) ?? null,
          senderName: (data["Sender"] ?? data["sender"]) as string | null,
          sendersJson: (data["Senders"] ?? data["senders"]) as Record<string, unknown> | null,
          status: (data["Status"] as number | undefined) ?? null,
          content: (data["Content"] ?? data["content"]) as string | null,
          fetchedAt: new Date(),
        };
      }
      return parseMessageDetailHtml(text, messageId);
    },

    /**
     * Who the parent can write to (Wilma's recipient list): the child, the
     * other guardians, the child's own teachers, and the school's staff and
     * teachers. Pass one to prepareMessage() in the write entry point.
     */
    recipients: async (): Promise<MessageRecipient[]> => {
      const resp = await this.session.get("/messages/recipients");
      const html = await resp.text();
      const recipients = parseRecipientsHtml(html, resp.url);
      // Lists Wilma loads when opened (the child's own teachers, one by one).
      for (const [group, path] of recipientListSources(html, resp.url)) {
        const list = await this.session.get(path);
        for (const recipient of parseRecipientsHtml(await list.text(), list.url, { group })) {
          if (!recipients.some((r) => r.composePath === recipient.composePath && r.group === recipient.group)) recipients.push(recipient);
        }
      }
      return recipients;
    },
  };

  student = {
    /** The child's class and supervisors (class teacher, other supervisors), with their message links, from the front page. */
    get: async (): Promise<StudentDetails> => {
      const resp = await this.session.get("/");
      return parseStudentDetailsHtml(await resp.text(), resp.url);
    },
  };

  invitations = {
    /** Event invitations (Tapahtumakutsut), newest first, with whether this family has answered. */
    list: async (): Promise<InvitationListing[]> => {
      const resp = await this.session.get("/messages/list/appointments");
      const data = safeJson(await resp.text());
      return parseInvitationListings(data, parseMessagesList(data, "appointments"));
    },

    /**
     * One invitation's time slots and this family's choice; null when the
     * message isn't an invitation. Like opening it in Wilma, this marks the
     * message read.
     */
    get: async (messageId: number): Promise<Invitation | null> => {
      return (await this.messages.get(messageId)).invitation ?? null;
    },
  };

  news = {
    list: async (): Promise<NewsItem[]> => {
      const resp = await this.session.get("/news");
      const text = await resp.text();
      const data = safeJson(text);
      if (Array.isArray(data)) {
        return parseNewsList(data);
      }
      return parseNewsListHtml(text);
    },

    /**
     * The bulletins, or null when this Wilma doesn't show them to this account: it answers /news with 403 (Helsinki's
     * does, for a guardian) or 404 while the session is alive. Its other pages read as usual.
     */
    listIfShown: async (): Promise<NewsItem[] | null> => {
      try {
        return await this.news.list();
      } catch (err) {
        if (err instanceof APIError && (err.status === 403 || err.status === 404)) return null;
        throw err;
      }
    },

    get: async (newsId: number): Promise<NewsItem> => {
      const resp = await this.session.get(`/news/${newsId}`);
      const contentType = resp.headers.get("content-type")?.toLowerCase() ?? "";
      const text = await resp.text();
      if (!contentType.includes("text/html")) {
        const data = safeJson(text) as Record<string, unknown>;
        if (Object.keys(data).length) {
          return parseNewsDetailJson(newsId, data, resp.url);
        }
      }
      return parseNewsDetailHtml(text, newsId, resp.url);
    },

    fetchResource: async (
      newsId: number,
      resourceId: string,
      options?: { item?: NewsItem }
    ): Promise<
      | { resource: NewsResource; response: Response; status: "fetched" }
      | { resource: NewsResource; response: null; status: "not_a_file" }
    > => {
      const item = options?.item ?? (await this.news.get(newsId));
      const resource = item.resources?.find((candidate) => candidate.id === resourceId);
      if (!resource) {
        throw new Error(`News resource "${resourceId}" not found`);
      }

      if (resource.authContext === "wilma") {
        const url = new URL(resource.url);
        // Collapse leading slashes so the path can't turn into "//other-host/...".
        const path = `/${url.pathname.replace(/^\/+/, "")}${url.search}`;
        const response = await this.session.get(path, undefined, {
          externalRedirect: "return",
          timeoutMs: DOWNLOAD_TIMEOUT_MS,
        });
        if (response.status >= 300 && response.status < 400) {
          // Wilma handed the file off to another site: fetch it there, without Wilma credentials.
          const location = response.headers.get("location");
          await response.body?.cancel();
          const external = location ? await getExternalFetcher()(new URL(location, url).href) : null;
          return external
            ? { resource, response: external, status: "fetched" }
            : { resource, response: null, status: "not_a_file" };
        }
        if (isHtmlResponse(response)) {
          await response.body?.cancel();
          return { resource, response: null, status: "not_a_file" };
        }
        return { resource, response, status: "fetched" };
      }

      const response = await getExternalFetcher()(resource.url);
      if (!response) {
        return { resource, response: null, status: "not_a_file" };
      }
      return { resource, response, status: "fetched" };
    },
  };

  exams = {
    /**
     * Upcoming exams with topics and teachers (front page), plus the start
     * time when the school gives one (exam calendar). Without the calendar,
     * exams come back without times.
     */
    upcoming: async (): Promise<UpcomingExam[]> => {
      const [overview, calendar] = await Promise.all([this.overview.get(), this.exams.calendarOrEmpty()]);
      return addExamTimes(overview.upcomingExams, calendar);
    },

    /** The exam calendar, or [] if it can't be read (start times are a bonus). */
    calendarOrEmpty: async (): Promise<Exam[]> => {
      try {
        return await this.exams.list();
      } catch (err) {
        if (err instanceof NetworkError) throw err;
        return [];
      }
    },

    /** The exam calendar page: upcoming exams with dates, start times, teachers and notes. */
    list: async (opts?: { start?: string; end?: string }): Promise<Exam[]> => {
      const params = new URLSearchParams();
      if (opts?.start) {
        params.set("start", opts.start);
      }
      if (opts?.end) {
        params.set("end", opts.end);
      }
      const query = params.toString();
      const path = query ? `/exams/calendar?${query}` : "/exams/calendar";
      const resp = await this.session.get(path);
      const text = await resp.text();
      return parseExamsHtml(text);
    },

    /**
     * Past exams with their grades (Kokeet > Menneet), newest first. Wilma
     * shows this school year by default; `from` (YYYY-MM-DD, to `to` or today)
     * reaches further back, as far as the school keeps exams.
     */
    past: async (opts?: { from?: string; to?: string }): Promise<PastExam[]> => {
      let path = "/exams/calendar/past";
      if (opts?.from || opts?.to) {
        const to = opts.to ?? finnishDateString();
        const [y, m] = to.split("-").map(Number);
        // Without a start, the school year `to` falls in (from 1 August).
        const from = opts.from ?? `${m >= 8 ? y : y - 1}-08-01`;
        const fi = (iso: string) => iso.split("-").reverse().map(Number).join(".");
        // Wilma's own form: range -3 is "between these dates".
        path += `?${new URLSearchParams({ range: "-3", first: fi(from), last: fi(to) })}`;
      }
      const resp = await this.session.get(path);
      return parsePastExamsHtml(await resp.text());
    },
  };

  attendance = {
    /**
     * Lesson notes (merkinnät): absences, lateness and teachers' feedback, with
     * any words the teacher wrote. One day (default today), or a period with
     * `from`/`to` (YYYY-MM-DD).
     */
    list: async (opts?: { date?: string; from?: string; to?: string }): Promise<LessonNote[]> => {
      const from = opts?.from ?? opts?.date ?? finnishDateString();
      const to = opts?.to ?? opts?.date ?? from;
      const notes = parseAttendanceHtml(await this.attendancePage(`range=-3&first=${isoDateToFinnish(from)}&last=${isoDateToFinnish(to)}`));
      return notes.filter((note) => note.date >= from && note.date <= to);
    },

    /** Every lesson note of this school year (Wilma's own "whole year" view): one request. */
    schoolYear: async (): Promise<LessonNote[]> => parseAttendanceHtml(await this.attendancePage("range=-4")),

    /** How many lesson notes of each kind from `from` to `to` (default today); without `from`, this school year. */
    summary: async (opts?: { from?: string; to?: string }): Promise<LessonNoteSummary> => {
      if (!opts?.from) {
        const notes = await this.attendance.schoolYear();
        return summarizeLessonNotes(opts?.to ? notes.filter((note) => note.date <= opts.to!) : notes, null, opts?.to ?? null);
      }
      const to = opts.to ?? finnishDateString();
      return summarizeLessonNotes(await this.attendance.list({ from: opts.from, to }), opts.from, to);
    },
  };

  /** The lesson notes page for a period ("range" as Wilma's own period links use it). */
  private async attendancePage(range: string): Promise<string> {
    const resp = await this.session.get(`/attendance/view?${range}`);
    return resp.text();
  }

  schedule = {
    /**
     * Lessons on a date or in a period (YYYY-MM-DD), from Wilma's timetable
     * API, with teachers and rooms. Without dates: this week, from the front
     * page. Older Wilma versions without the API fall back to the schedule
     * page (one date) or the front page (this week).
     */
    list: async (opts?: { date?: string; from?: string; to?: string }): Promise<OverviewData["schedule"]> => {
      const from = opts?.from ?? opts?.date;
      const to = opts?.to ?? opts?.date ?? from;
      if (from && to) {
        try {
          const resp = await this.session.get(`/api/v1/schedules/timetable?startdate=${from}&enddate=${to}`);
          const data = safeJson(await resp.text()) as { payload?: unknown };
          if (Array.isArray(data.payload)) {
            return parseTimetableJson(data.payload).filter((lesson) => lesson.date >= from && lesson.date <= to);
          }
        } catch (err) {
          if (!(err instanceof APIError) || (err.status !== 403 && err.status !== 404)) throw err;
        }
        if (from === to) {
          const params = new URLSearchParams({ date: isoDateToFinnish(from) });
          const resp = await this.session.get(`/schedule?${params.toString()}`);
          return parseScheduleHtml(await resp.text()).filter((lesson) => lesson.date === from);
        }
        return (await this.overview.get()).schedule.filter((lesson) => lesson.date >= from && lesson.date <= to);
      }
      return (await this.overview.get()).schedule;
    },
  };

  gradebook = {
    /** Completed courses and grades (Suoritukset), as a tree: subject > syllabus > course. */
    get: async (): Promise<GradebookEntry[]> => {
      const resp = await this.session.get("/gradebook");
      return parseGradebookHtml(await resp.text());
    },
  };

  printouts = {
    /** PDF documents the school offers (Tulosteet): report cards, absence reports… */
    list: async (): Promise<Printout[]> => {
      const resp = await this.session.get("/printouts");
      return parsePrintoutsHtml(await resp.text());
    },

    /** Download one printout; the response body is the PDF. */
    fetch: async (id: string): Promise<{ printout: Printout; response: Response }> => {
      const printout = (await this.printouts.list()).find((candidate) => candidate.id === id);
      if (!printout) throw new Error(`Printout "${id}" not found`);
      const response = await this.session.get(printout.path, undefined, { timeoutMs: DOWNLOAD_TIMEOUT_MS });
      return { printout, response };
    },
  };

  overview = {
    get: async (): Promise<OverviewData> => {
      const resp = await this.session.get("/overview");
      const text = await resp.text();
      return parseOverview(safeJson(text));
    },
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function isoDateToFinnish(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    return date;
  }
  return `${match[3]}.${match[2]}.${match[1]}`;
}
