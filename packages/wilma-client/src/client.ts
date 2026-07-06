import { WilmaSession, MfaRequiredError } from "./session.js";
import type { Exam, Message, MessageFolder, NewsItem, OverviewData, WilmaProfile, StudentInfo, LessonNote } from "./types.js";
import { parseWilmaTimestamp } from "./parsers/dates.js";
import { parseMessagesList, parseMessageDetailHtml } from "./parsers/messages.js";
import {
  parseNewsDetailHtml,
  parseNewsDetailJson,
  parseNewsList,
  parseNewsListHtml,
} from "./parsers/news.js";
import { parseExamsHtml } from "./parsers/exams.js";
import { parseAttendanceHtml } from "./parsers/attendance.js";
import { parseOverview } from "./parsers/overview.js";
import { parseScheduleHtml } from "./parsers/schedule.js";
import { parseStudentsFromHome } from "./parsers/students.js";

export type MfaCallback = (formkey: string) => Promise<string>;

export class WilmaClient {
  private session: WilmaSession;

  private constructor(session: WilmaSession) {
    this.session = session;
  }

  static async login(profile: WilmaProfile, onMfaRequired?: MfaCallback): Promise<WilmaClient> {
    const session = new WilmaSession(profile.baseUrl, {
      studentNumber: profile.studentNumber ?? null,
      debug: profile.debug ?? false,
    });
    try {
      await session.login(profile.username, profile.password);
    } catch (err) {
      if (err instanceof MfaRequiredError && onMfaRequired) {
        const otpCode = await onMfaRequired(err.formkey);
        await session.submitMfaCode(err.formkey, otpCode);
      } else {
        throw err;
      }
    }
    return new WilmaClient(session);
  }

  static async listStudents(profile: WilmaProfile, onMfaRequired?: MfaCallback): Promise<StudentInfo[]> {
    const session = new WilmaSession(profile.baseUrl);
    try {
      await session.login(profile.username, profile.password);
    } catch (err) {
      if (err instanceof MfaRequiredError && onMfaRequired) {
        const otpCode = await onMfaRequired(err.formkey);
        await session.submitMfaCode(err.formkey, otpCode);
      } else {
        throw err;
      }
    }
    const resp = await session.get("/");
    const html = await resp.text();
    return parseStudentsFromHome(html);
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

    get: async (messageId: number): Promise<Message> => {
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

    get: async (newsId: number): Promise<NewsItem> => {
      const resp = await this.session.get(`/news/${newsId}`);
      const contentType = resp.headers.get("content-type")?.toLowerCase() ?? "";
      const text = await resp.text();
      if (!contentType.includes("text/html")) {
        const data = safeJson(text) as Record<string, unknown>;
        if (Object.keys(data).length) {
          return parseNewsDetailJson(newsId, data);
        }
      }
      return parseNewsDetailHtml(text, newsId);
    },
  };

  exams = {
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
  };

  attendance = {
    list: async (opts?: { date?: string }): Promise<LessonNote[]> => {
      const params = new URLSearchParams();
      if (opts?.date) {
        params.set("date", opts.date);
      }
      const query = params.toString();
      const path = query ? `/attendance/view?${query}` : "/attendance/view";
      const resp = await this.session.get(path);
      const text = await resp.text();
      return parseAttendanceHtml(text, opts?.date ?? "");
    },
  };

  schedule = {
    list: async (opts?: { date?: string }): Promise<OverviewData["schedule"]> => {
      if (!opts?.date) {
        return (await this.overview.get()).schedule;
      }
      const params = new URLSearchParams();
      params.set("date", isoDateToFinnish(opts.date));
      const resp = await this.session.get(`/schedule?${params.toString()}`);
      const text = await resp.text();
      return parseScheduleHtml(text);
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
