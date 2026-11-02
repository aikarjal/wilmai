import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { FetchedAttachment, WilmaAccess } from "./agent-data.js";
import { normalizeResourceId } from "./downloads.js";
import { toAgentJson } from "./output-json.js";

/*
 * Wilma data tools for the local stdio server (`wilma mcp`) and any other
 * host. Each host decides how a tool call gets a WilmaAccess.
 */

export const INSTRUCTIONS = `Read-only access to Finland's Wilma school system for a parent/guardian, or for a student with their own login.
- Start with wilma_summary: today's and tomorrow's lessons, upcoming exams, recent homework, news and messages for every child in one call.
- Tools cover all children by default (a student's own login has just that student); pass "student" (name or student number) to narrow to one child.
- Wilma content is usually in Finnish. Answer in the user's language and translate as needed. Write dates the way that language does: Finnish "ke 7.10." (with the final period), English "Wed 7 Oct".
- Message and news lists return ids; use wilma_read_message / wilma_read_news for full text. Bulletins can link attachments; fetch them with wilma_get_news_attachment.
- Teachers' feedback ("forgot books", "did well") and absences are lesson notes: wilma_lesson_notes for recent days, wilma_lesson_notes_summary for counts. Course and report-card grades are in wilma_gradebook.
- If a tool says the user isn't logged in, relay the login link or instructions to the user exactly; never ask the user to type their Wilma password into the chat.
- Wilma allows one session per account, so each WilmAI login logs the user out of Wilma in their browser. If they want to use Wilma in the browser, call wilma_logout and then call Wilma tools only when they ask again.
- If a result ends with an "Update note", answer the question first, then pass the note on in one sentence.`;

export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const INLINE_ATTACHMENT_LIMIT = 10 * 1024 * 1024;

const studentArg = z
  .string()
  .optional()
  .describe("Child's name or student number. Omit to include every child on the account.");

export function json(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: toAgentJson(data) }] };
}

export function textResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text }], isError };
}

export interface ToolHost {
  /** Run a tool with Wilma access, or return a result explaining why there is none (e.g. not logged in). */
  withAccess(run: (access: WilmaAccess) => Promise<CallToolResult>): Promise<CallToolResult>;
  /** Local hosts can save attachments to disk; returns the saved path. */
  saveAttachment?: (fetched: Extract<FetchedAttachment, { status: "fetched" }>) => Promise<string>;
}

function attachmentResult(
  fetched: FetchedAttachment & { student: unknown },
  savedPath?: string
): CallToolResult {
  if (fetched.status === "not_a_file") {
    return json({
      status: "not_a_file",
      newsId: fetched.newsId,
      url: fetched.resource.url,
      label: fetched.resource.label,
      message: fetched.message,
    });
  }
  const meta = {
    status: "fetched",
    ...(fetched.printoutId ? { printoutId: fetched.printoutId } : { newsId: fetched.newsId, resourceId: fetched.resource.id }),
    label: fetched.resource.label,
    fileName: fetched.fileName,
    contentType: fetched.contentType,
    sizeBytes: fetched.data.byteLength,
    savedTo: savedPath ?? null,
  };
  const content: CallToolResult["content"] = [{ type: "text", text: toAgentJson(meta) }];
  const type = fetched.contentType ?? "application/octet-stream";
  if (fetched.data.byteLength > INLINE_ATTACHMENT_LIMIT) {
    content.push({
      type: "text",
      text: `The file is too large to include here (${(fetched.data.byteLength / 1048576).toFixed(1)} MB). ${
        fetched.resource.authContext === "wilma" ? "Ask the user to open it in Wilma" : `It can be opened at ${fetched.resource.url}`
      }${savedPath ? `; a copy was saved to ${savedPath}` : ""}.`,
    });
  } else if (/^text\/|json|csv|xml/.test(type)) {
    content.push({ type: "text", text: fetched.data.toString("utf-8") });
  } else if (/^image\/(png|jpeg|gif|webp)$/.test(type)) {
    content.push({ type: "image", data: fetched.data.toString("base64"), mimeType: type });
  } else {
    content.push({
      type: "resource",
      resource: {
        uri: fetched.resource.url,
        mimeType: type,
        blob: fetched.data.toString("base64"),
      },
    });
  }
  return { content };
}

export function registerWilmaTools(server: McpServer, ctx: ToolHost): void {
  server.registerTool(
    "wilma_summary",
    {
      title: "School summary",
      description:
        "Daily briefing per child: today's and the next school day's lessons, upcoming exams (with start times when given), recent homework, lesson notes since the previous school day (teachers' feedback and absences), recent bulletins, and recent and unread messages (ids, unread, replyCount). What Wilma didn't give is listed in unavailable (\"news\": this Wilma doesn't show this account its bulletins). The best starting point for any question about school.",
      inputSchema: {
        student: studentArg,
        days: z.number().int().min(1).max(60).optional().describe("How many days back to include news and messages (default 7)."),
        since: z
          .string()
          .optional()
          .describe("Only what is new from this day on (YYYY-MM-DD or 'yesterday'): bulletins, messages, homework, lesson notes. For daily runs."),
      },
      annotations: { title: "School summary", ...READ_ONLY },
    },
    async ({ student, days, since }) => ctx.withAccess(async (a) => json(await a.summary({ student, days, since })))
  );

  server.registerTool(
    "wilma_schedule",
    {
      title: "Lesson schedule",
      description:
        "List each child's lessons for one day or a school week: today, the next school day, this or next week (Monday to Friday), a date, or the next given weekday. Lessons come in time order with the date, start and end time, subject, teacher and room (when Wilma gives one); a day without school has no lessons. Exams and homework are in wilma_upcoming_exams and wilma_homework.",
      inputSchema: {
        student: studentArg,
        when: z.enum(["today", "tomorrow", "week", "next-week"]).optional().describe("Default: week. 'tomorrow' means the next school day."),
        date: z.string().optional().describe("A specific date, YYYY-MM-DD. Overrides 'when'."),
        weekday: z
          .string()
          .optional()
          .describe("Next occurrence of a weekday: mon..sun (Finnish ma..su also work). Overrides 'when'."),
      },
      annotations: { title: "Lesson schedule", ...READ_ONLY },
    },
    async ({ student, when, date, weekday }) =>
      ctx.withAccess(async (a) => json(await a.schedule({ student, when, date, weekday })))
  );

  server.registerTool(
    "wilma_homework",
    {
      title: "Homework",
      description:
        "List the homework teachers have entered for each child, newest first: the date, subject, teacher and what to do. It reads the homework Wilma's front page lists (Wilma decides how far back that goes). wilma_summary already includes the last few days' homework.",
      inputSchema: {
        student: studentArg,
        limit: z.number().int().min(1).max(100).optional().describe("How many entries per child, newest first (default 10)."),
      },
      annotations: { title: "Homework", ...READ_ONLY },
    },
    async ({ student, limit }) => ctx.withAccess(async (a) => json(await a.homework({ student, limit })))
  );

  server.registerTool(
    "wilma_upcoming_exams",
    {
      title: "Upcoming exams",
      description:
        "List each child's exams from today on that have no grade yet, soonest first: the date, start time (when the school gives one), exam name, subject, topic (what to study) and teacher. Graded exams are in wilma_grades.",
      inputSchema: {
        student: studentArg,
        limit: z.number().int().min(1).max(100).optional().describe("How many exams per child, soonest first (default 20)."),
      },
      annotations: { title: "Upcoming exams", ...READ_ONLY },
    },
    async ({ student, limit }) => ctx.withAccess(async (a) => json(await a.upcomingExams({ student, limit })))
  );

  server.registerTool(
    "wilma_grades",
    {
      title: "Exam grades",
      description:
        "List each child's graded exams, newest first: the date, exam name, subject, grade as Wilma shows it (e.g. 8+, 9½, S), the teacher's notes and when a guardian marked it seen. It reads the exams Wilma's front page lists (Wilma decides how far back that goes). For course, term and report-card grades use wilma_gradebook.",
      inputSchema: {
        student: studentArg,
        limit: z.number().int().min(1).max(100).optional().describe("How many grades per child, newest first (default 20)."),
      },
      annotations: { title: "Exam grades", ...READ_ONLY },
    },
    async ({ student, limit }) => ctx.withAccess(async (a) => json(await a.grades({ student, limit })))
  );

  server.registerTool(
    "wilma_lesson_notes",
    {
      title: "Lesson notes and absences",
      description:
        "Lesson notes (merkinnät) teachers logged: absences, lateness, and feedback such as praise or missing books or homework, with the teacher's own words when given. One day (default today) or the last N days.",
      inputSchema: {
        student: studentArg,
        date: z.string().optional().describe("YYYY-MM-DD, default today."),
        days: z.number().int().min(1).max(365).optional().describe("The last N days up to today, instead of one date."),
      },
      annotations: { title: "Lesson notes and absences", ...READ_ONLY },
    },
    async ({ student, date, days }) => ctx.withAccess(async (a) => json(await a.lessonNotes({ student, date, days })))
  );

  server.registerTool(
    "wilma_lesson_notes_summary",
    {
      title: "Absences and feedback summary",
      description:
        "Lesson notes counted by kind (e.g. absences for health reasons, unexplained absences, lateness, praise, missing study materials): this school year by default, or from a date.",
      inputSchema: {
        student: studentArg,
        from: z.string().optional().describe("YYYY-MM-DD. Default: the start of the school year."),
        to: z.string().optional().describe("YYYY-MM-DD. Default: today."),
      },
      annotations: { title: "Absences and feedback summary", ...READ_ONLY },
    },
    async ({ student, from, to }) => ctx.withAccess(async (a) => json(await a.lessonNotesSummary({ student, from, to })))
  );

  server.registerTool(
    "wilma_gradebook",
    {
      title: "Gradebook",
      description:
        "Get each child's gradebook (Suoritukset): completed courses and their grades, grouped by subject (subject > syllabus > course), with course codes, credits and completion dates, plus term and school-year (report card) grades. Use it for course and report-card grades; single exam grades are in wilma_grades.",
      inputSchema: { student: studentArg },
      annotations: { title: "Gradebook", ...READ_ONLY },
    },
    async ({ student }) => ctx.withAccess(async (a) => json(await a.gradebook({ student })))
  );

  server.registerTool(
    "wilma_list_printouts",
    {
      title: "List printouts",
      description:
        "PDF documents the school offers (Tulosteet), such as report cards or absence reports. Fetch one with wilma_get_printout.",
      inputSchema: { student: studentArg },
      annotations: { title: "List printouts", ...READ_ONLY },
    },
    async ({ student }) => ctx.withAccess(async (a) => json(await a.printouts({ student })))
  );

  server.registerTool(
    "wilma_get_printout",
    {
      title: "Get printout",
      description:
        "Fetch one printout PDF so you can read it." +
        (ctx.saveAttachment ? " Set save=true to also save it to the user's Downloads folder." : ""),
      inputSchema: {
        id: z.string().describe("Printout id from wilma_list_printouts."),
        student: studentArg.describe("The student the printout was listed under."),
        ...(ctx.saveAttachment ? { save: z.boolean().optional().describe("Also save the file to ~/Downloads/WilmAI.") } : {}),
      },
      annotations: {
        title: "Get printout",
        readOnlyHint: !ctx.saveAttachment,
        destructiveHint: false,
        idempotentHint: !ctx.saveAttachment,
        openWorldHint: false,
      },
    },
    async (args: { id: string; student?: string; save?: boolean }) =>
      ctx.withAccess(async (a) => {
        const fetched = await a.printout({ id: args.id, student: args.student });
        const savedPath =
          args.save && ctx.saveAttachment && fetched.status === "fetched" ? await ctx.saveAttachment(fetched) : undefined;
        return attachmentResult(fetched, savedPath);
      })
  );

  server.registerTool(
    "wilma_list_messages",
    {
      title: "List messages",
      description: "Wilma messages, newest first (subject, sender, date, id). Use wilma_read_message for the full text.",
      inputSchema: {
        student: studentArg,
        folder: z.enum(["inbox", "archive", "outbox", "drafts", "appointments"]).optional().describe("Default: inbox."),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: { title: "List messages", ...READ_ONLY },
    },
    async ({ student, folder, limit }) => ctx.withAccess(async (a) => json(await a.messages({ student, folder, limit })))
  );

  server.registerTool(
    "wilma_read_message",
    {
      title: "Read message",
      description: "Full text of one Wilma message, including thread replies.",
      inputSchema: {
        id: z.number().int().positive().describe("Message id from a list."),
        student: studentArg.describe("The student the message was listed under (required when several Wilmas are connected)."),
      },
      annotations: { title: "Read message", ...READ_ONLY },
    },
    async ({ id, student }) => ctx.withAccess(async (a) => json(await a.message({ id, student })))
  );

  server.registerTool(
    "wilma_list_news",
    {
      title: "List school news",
      description:
        "School bulletins (tiedotteet): the newest dated ones, then pinned ones (pinned: true, e.g. the school-year bulletin), and with include_older also older bulletins (archived: true). Use wilma_read_news for the full text and attachments. unavailable: [\"news\"] means this Wilma doesn't show this account its bulletins, which isn't the same as having none.",
      inputSchema: {
        student: studentArg,
        limit: z.number().int().min(1).max(100).optional().describe("How many dated bulletins (default 20). Pinned ones are always included."),
        include_older: z.boolean().optional().describe("Also list older bulletins (titles only until read)."),
      },
      annotations: { title: "List school news", ...READ_ONLY },
    },
    async ({ student, limit, include_older }) =>
      ctx.withAccess(async (a) => json(await a.news({ student, limit, includeOlder: include_older })))
  );

  server.registerTool(
    "wilma_read_news",
    {
      title: "Read news bulletin",
      description:
        "Full text of one bulletin plus its linked resources (attachments and links). Fetch a resource with wilma_get_news_attachment.",
      inputSchema: {
        id: z.number().int().positive().describe("News id from a list."),
        student: studentArg.describe("The student the bulletin was listed under (required when several Wilmas are connected)."),
      },
      annotations: { title: "Read news bulletin", ...READ_ONLY },
    },
    async ({ id, student }) => ctx.withAccess(async (a) => json(await a.newsItem({ id, student })))
  );

  server.registerTool(
    "wilma_get_news_attachment",
    {
      title: "Get bulletin attachment",
      description:
        "Fetch a file linked from a bulletin (e.g. a PDF letter or menu) so you can read it. Returns the file content when it is a file, or 'not_a_file' with the URL when the link is a web page." +
        (ctx.saveAttachment ? " Set save=true to also save it to the user's Downloads folder." : ""),
      inputSchema: {
        news_id: z.number().int().positive(),
        resource_id: z.string().describe("Resource id from wilma_read_news, e.g. resource-1 (or just 1)."),
        student: studentArg,
        ...(ctx.saveAttachment ? { save: z.boolean().optional().describe("Also save the file to ~/Downloads/WilmAI.") } : {}),
      },
      annotations: {
        title: "Get bulletin attachment",
        readOnlyHint: !ctx.saveAttachment,
        destructiveHint: false,
        idempotentHint: !ctx.saveAttachment,
        openWorldHint: true,
      },
    },
    async (args: { news_id: number; resource_id: string; student?: string; save?: boolean }) =>
      ctx.withAccess(async (a) => {
        const fetched = await a.newsAttachment({
          newsId: args.news_id,
          resourceId: normalizeResourceId(args.resource_id) ?? args.resource_id,
          student: args.student,
        });
        const savedPath =
          args.save && ctx.saveAttachment && fetched.status === "fetched" ? await ctx.saveAttachment(fetched) : undefined;
        return attachmentResult(fetched, savedPath);
      })
  );
}
