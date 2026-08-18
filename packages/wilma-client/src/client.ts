import { WilmaSession, MfaRequiredError } from "./session.js";
import type { Exam, Message, MessageFolder, NewsItem, NewsResource, OverviewData, WilmaProfile, StudentInfo, LessonNote } from "./types.js";
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
import { CookieJar } from "tough-cookie";
import { fetch, Headers, type Response } from "undici";
import { wrapNetworkError } from "./network-error.js";

const EXTERNAL_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36";

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
        const response = await this.session.get(`${url.pathname}${url.search}`);
        if (isHtmlResponse(response)) {
          await response.body?.cancel();
          return { resource, response: null, status: "not_a_file" };
        }
        return { resource, response: response as unknown as Response, status: "fetched" };
      }

      const response = await fetchExternalFile(resource.url);
      if (!response) {
        return { resource, response: null, status: "not_a_file" };
      }
      return { resource, response, status: "fetched" };
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

// Some document hosts serve an HTML viewer page for a sharing URL but return
// the file itself when a conventional download parameter is present. These are
// generic retry variants, not provider detection: the original URL is always
// attempted first, and a variant is tried only after an HTML answer.
const DOWNLOAD_PARAM_VARIANTS: Array<[string, string]> = [
  ["download", "1"],
  ["dl", "1"],
];

function buildDownloadCandidates(rawUrl: string): URL[] {
  const original = new URL(rawUrl);
  const candidates = [original];
  for (const [param, value] of DOWNLOAD_PARAM_VARIANTS) {
    if (!original.searchParams.has(param)) {
      const variant = new URL(original.href);
      variant.searchParams.set(param, value);
      candidates.push(variant);
    }
  }
  return candidates;
}

function isHtmlResponse(response: { headers: { get(name: string): string | null } }): boolean {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  return contentType.startsWith("text/html") || contentType.startsWith("application/xhtml");
}

// Fetch an external URL the way a signed-out browser would: an isolated
// in-memory cookie jar, redirects followed across hosts, and no Wilma
// credentials anywhere. Returns null when every candidate answered with an
// HTML page instead of a file.
async function fetchExternalFile(rawUrl: string): Promise<Response | null> {
  for (const candidate of buildDownloadCandidates(rawUrl)) {
    const response = await fetchFollowingRedirects(candidate);
    if (!response) {
      continue;
    }
    if (response.ok && isHtmlResponse(response)) {
      await response.body?.cancel();
      continue;
    }
    return response;
  }
  return null;
}

async function fetchFollowingRedirects(initialUrl: URL): Promise<Response | null> {
  const cookieJar = new CookieJar();
  let currentUrl = initialUrl;
  for (let redirectCount = 0; redirectCount <= 10; redirectCount += 1) {
    const headers = new Headers({
      "User-Agent": EXTERNAL_USER_AGENT,
      "Accept": "*/*",
    });
    const cookieHeader = cookieJar.getCookieStringSync(currentUrl.href);
    if (cookieHeader) {
      headers.set("Cookie", cookieHeader);
    }

    let response: Response;
    try {
      response = await fetch(currentUrl, { headers, redirect: "manual" });
    } catch (err) {
      throw wrapNetworkError(err, currentUrl.href);
    }
    const setCookies = (response.headers as unknown as { getSetCookie?: () => string[] })
      .getSetCookie?.() ?? [];
    for (const cookie of setCookies) {
      cookieJar.setCookieSync(cookie, currentUrl.href, { ignoreError: true });
    }
    if (!setCookies.length) {
      const cookie = response.headers.get("set-cookie");
      if (cookie) cookieJar.setCookieSync(cookie, currentUrl.href, { ignoreError: true });
    }

    if (response.status < 300 || response.status >= 400) {
      return response;
    }
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) {
      return null;
    }
    const nextUrl = new URL(location, currentUrl);
    if (nextUrl.protocol !== "https:" && nextUrl.protocol !== "http:") {
      return null;
    }
    currentUrl = nextUrl;
  }
  throw new Error("External resource exceeded the redirect limit");
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
