import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { FetchedAttachment, WilmaAccess } from "./agent-data.js";
import { normalizeResourceId } from "./downloads.js";

/*
 * Wilma data tools shared by the local stdio server (`wilma mcp`) and the
 * hosted relay. Each host decides how a tool call gets a WilmaAccess.
 */

export const INSTRUCTIONS = `Read-only access to Finland's Wilma school system for a parent/guardian.
- Start with wilma_summary: today's and tomorrow's lessons, upcoming exams, recent homework, news and messages for every child in one call.
- Tools cover all children by default; pass "student" (name or student number) to narrow to one child.
- Wilma content is usually in Finnish. Answer in the user's language and translate as needed.
- Message and news lists return ids; use wilma_read_message / wilma_read_news for full text. Bulletins can link attachments; fetch them with wilma_get_news_attachment.
- If a tool says the user isn't logged in, relay the login link or instructions to the user exactly; never ask the user to type their Wilma password into the chat.`;

export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const INLINE_ATTACHMENT_LIMIT = 10 * 1024 * 1024;

export const studentArg = z
  .string()
  .optional()
  .describe("Child's name or student number. Omit to include every child on the account.");

export function json(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export function textResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text }], isError };
}

export interface ToolHost {
  /** Run a tool with Wilma access, or return a result explaining why there is none (e.g. not logged in). */
  withAccess(run: (access: WilmaAccess) => Promise<CallToolResult>): Promise<CallToolResult>;
  /** Largest attachment to return inline (the relay sets less: Vercel caps responses at 4.5 MB). */
  inlineAttachmentLimit?: number;
  /** Local hosts can save attachments to disk; returns the saved path. */
  saveAttachment?: (fetched: Extract<FetchedAttachment, { status: "fetched" }>) => Promise<string>;
}

export function attachmentResult(
  fetched: FetchedAttachment & { student: unknown },
  savedPath?: string,
  inlineLimit = INLINE_ATTACHMENT_LIMIT
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
    newsId: fetched.newsId,
    resourceId: fetched.resource.id,
    label: fetched.resource.label,
    fileName: fetched.fileName,
    contentType: fetched.contentType,
    sizeBytes: fetched.data.byteLength,
    savedTo: savedPath ?? null,
  };
  const content: CallToolResult["content"] = [{ type: "text", text: JSON.stringify(meta, null, 2) }];
  const type = fetched.contentType ?? "application/octet-stream";
  if (fetched.data.byteLength > inlineLimit) {
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
        "Daily briefing per child: today's and tomorrow's lessons, upcoming exams, homework from the last few days, and recent news and messages (ids only). The best starting point for any question about school.",
      inputSchema: {
        student: studentArg,
        days: z.number().int().min(1).max(60).optional().describe("How many days back to include news and messages (default 7)."),
      },
      annotations: { title: "School summary", ...READ_ONLY },
    },
    async ({ student, days }) => ctx.withAccess(async (a) => json(await a.summary({ student, days })))
  );

  server.registerTool(
    "wilma_schedule",
    {
      title: "Lesson schedule",
      description:
        "Lessons for today, the next school day, this week, a specific date, or the next occurrence of a weekday.",
      inputSchema: {
        student: studentArg,
        when: z.enum(["today", "tomorrow", "week"]).optional().describe("Default: week. 'tomorrow' means the next school day."),
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
      description: "Recent homework entries by lesson, newest first.",
      inputSchema: { student: studentArg, limit: z.number().int().min(1).max(100).optional() },
      annotations: { title: "Homework", ...READ_ONLY },
    },
    async ({ student, limit }) => ctx.withAccess(async (a) => json(await a.homework({ student, limit })))
  );

  server.registerTool(
    "wilma_upcoming_exams",
    {
      title: "Upcoming exams",
      description: "Upcoming exams with subject, date and topic (what to study).",
      inputSchema: { student: studentArg, limit: z.number().int().min(1).max(100).optional() },
      annotations: { title: "Upcoming exams", ...READ_ONLY },
    },
    async ({ student, limit }) => ctx.withAccess(async (a) => json(await a.upcomingExams({ student, limit })))
  );

  server.registerTool(
    "wilma_grades",
    {
      title: "Exam grades",
      description: "Recent exam grades.",
      inputSchema: { student: studentArg, limit: z.number().int().min(1).max(100).optional() },
      annotations: { title: "Exam grades", ...READ_ONLY },
    },
    async ({ student, limit }) => ctx.withAccess(async (a) => json(await a.grades({ student, limit })))
  );

  server.registerTool(
    "wilma_lesson_notes",
    {
      title: "Lesson notes and absences",
      description:
        "Attendance and lesson notes (merkinnät) for a day: absences, lateness, feedback and other markings teachers logged.",
      inputSchema: { student: studentArg, date: z.string().optional().describe("YYYY-MM-DD, default today.") },
      annotations: { title: "Lesson notes and absences", ...READ_ONLY },
    },
    async ({ student, date }) => ctx.withAccess(async (a) => json(await a.lessonNotes({ student, date })))
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
      description: "School bulletins (tiedotteet), newest first. Use wilma_read_news for the full text and attachments.",
      inputSchema: { student: studentArg, limit: z.number().int().min(1).max(100).optional() },
      annotations: { title: "List school news", ...READ_ONLY },
    },
    async ({ student, limit }) => ctx.withAccess(async (a) => json(await a.news({ student, limit })))
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
        return attachmentResult(fetched, savedPath, ctx.inlineAttachmentLimit);
      })
  );
}
