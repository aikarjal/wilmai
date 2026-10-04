import { finnishIsoString } from "@wilm-ai/wilma-client";
import type {
  ExamGrade,
  GradebookEntry,
  HomeworkItem,
  LessonNote,
  LessonNoteSummary,
  Message,
  NewsItem,
  Printout,
  ScheduleLesson,
  UpcomingExam,
} from "@wilm-ai/wilma-client";
import type { StudentRef } from "./agent-data.js";

/*
 * Text output for a person at a terminal. Commands produce data (the same
 * data the JSON output and the MCP tools give); these functions turn it into
 * readable lines, one section per child.
 */

type PerStudent<K extends string, T> = { students: ({ student: StudentRef } & Record<K, T>)[]; problems?: { wilma: string; message: string }[] };

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function compactText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** Multi-line text with single blank lines between blocks. */
export function formatContent(value: string): string {
  const lines = value
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line, index, arr) => line !== "" || arr[index - 1] !== "");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** "2026-10-02 13:37" in Finnish time. */
export function finnishDateTime(d: Date | null | undefined): string {
  if (!d || Number.isNaN(d.getTime()) || d.getTime() <= 0) return "";
  return finnishIsoString(d).slice(0, 16).replace("T", " ");
}

function finnishDay(d: Date | null | undefined): string {
  return finnishDateTime(d).slice(0, 10);
}

function weekday(isoDate: string): string {
  return DAY_NAMES[new Date(`${isoDate}T12:00:00Z`).getUTCDay()];
}

function heading(student: StudentRef, several: boolean): string[] {
  if (!several) return [];
  return ["", `${student.name}${student.wilma ? ` (${student.wilma})` : ""}`];
}

/** A title line, then the per-child sections (a blank line between when there are several children). */
function titled(title: string, result: { students: unknown[] }, body: string): string {
  return result.students.length > 1 ? `${title}\n\n${body}` : `${title}\n${body}`;
}

function perStudent<K extends string, T>(
  result: PerStudent<K, T>,
  key: K,
  render: (value: T, student: StudentRef) => string[]
): string {
  const several = result.students.length > 1;
  const lines: string[] = [];
  for (const entry of result.students) {
    lines.push(...heading(entry.student, several), ...render(entry[key], entry.student));
  }
  for (const problem of result.problems ?? []) lines.push("", `Couldn't read ${problem.wilma}: ${problem.message}`);
  return lines.join("\n").replace(/^\n/, "");
}

export function lessonLine(l: ScheduleLesson): string {
  const teacher = l.teacher ? ` — ${l.teacher}` : "";
  const room = l.room ? `, ${l.room}` : "";
  return `${l.start}-${l.end}  ${l.subject}${teacher}${room}`;
}

export function examLine(exam: UpcomingExam): string {
  const when = exam.time ? `${exam.date} ${exam.time}` : exam.date;
  const topic = exam.topic ? ` — ${compactText(exam.topic)}` : "";
  return `${when}  ${exam.subject}${exam.name ? `: ${exam.name}` : ""}${topic}`;
}

export function newsLine(item: Pick<NewsItem, "wilmaId" | "title" | "published" | "pinned" | "archived">): string {
  const date = item.published ? `${finnishDay(item.published)} ` : "";
  const mark = item.pinned ? " [pinned]" : item.archived ? " [older]" : "";
  return `${date}${compactText(item.title)}${mark} (id ${item.wilmaId})`;
}

export function messageLine(msg: Pick<Message, "wilmaId" | "subject" | "sentAt" | "senderName" | "unread" | "replyCount">): string {
  const sender = msg.senderName ? ` — ${compactText(msg.senderName)}` : "";
  const replies = msg.replyCount ? ` [${msg.replyCount} ${msg.replyCount === 1 ? "reply" : "replies"}]` : "";
  return `${finnishDay(msg.sentAt)} ${compactText(msg.subject)}${sender}${msg.unread ? " [new]" : ""}${replies} (id ${msg.wilmaId})`;
}

export function lessonNoteLine(note: LessonNote, withDate: boolean): string {
  const date = withDate ? `${note.date} ` : "";
  const time = note.start ? `${note.start} ` : "";
  const subject = note.subject ? ` [${note.subject}]` : "";
  const teacher = note.teacher ? ` ${note.teacher}` : "";
  const words = note.note ? `: ${compactText(note.note)}` : "";
  return `${date}${time}${note.typeLabel}${subject}${teacher}${words}`;
}

function scheduleLines(lessons: ScheduleLesson[]): string[] {
  if (!lessons.length) return ["  No lessons."];
  const lines: string[] = [];
  let day = "";
  for (const lesson of lessons) {
    if (lesson.date !== day) {
      day = lesson.date;
      lines.push(`  ${weekday(day)} ${day}`);
    }
    lines.push(`    ${lessonLine(lesson)}`);
  }
  return lines;
}

function gradebookLines(entries: GradebookEntry[], depth = 0): string[] {
  if (!entries.length && depth === 0) return ["  No graded courses yet."];
  return entries.flatMap((entry) => {
    const code = entry.code ? `${entry.code} ` : "";
    const grade = entry.grade ? `  ${entry.grade}` : "";
    const credits = entry.credits ? `  (${entry.credits})` : "";
    const date = entry.date ? `  ${entry.date}` : "";
    return [`${"  ".repeat(depth + 1)}${code}${compactText(entry.name)}${grade}${credits}${date}`, ...gradebookLines(entry.children, depth + 1)];
  });
}

type SummaryData = {
  today: string;
  tomorrow: string;
  todaySchedule: ScheduleLesson[];
  tomorrowSchedule: ScheduleLesson[];
  upcomingExams: UpcomingExam[];
  homework: HomeworkItem[];
  lessonNotes: LessonNote[];
  news: { wilmaId: number; title: string; published: Date | null | undefined; pinned: boolean }[];
  messages: { wilmaId: number; subject: string; sentAt: Date; senderName: string | null; unread: boolean; replyCount: number }[];
  unreadMessages: number;
  unavailable?: string[];
};

function summaryLines(s: SummaryData): string[] {
  const section = (title: string, lines: string[], empty?: string) =>
    lines.length ? ["", title, ...lines.map((line) => `  ${line}`)] : empty ? ["", title, `  ${empty}`] : [];
  return [
    ...section(`Today ${weekday(s.today)} ${s.today}`, s.todaySchedule.map(lessonLine), "No lessons."),
    ...section(`Next school day ${weekday(s.tomorrow)} ${s.tomorrow}`, s.tomorrowSchedule.map(lessonLine), "No lessons."),
    ...section("Upcoming exams", s.upcomingExams.map(examLine)),
    ...section("Homework", s.homework.map((h) => `${h.date}  ${h.subject}: ${compactText(h.homework)}`)),
    ...section("Lesson notes", s.lessonNotes.map((n) => lessonNoteLine(n, true))),
    ...section("Bulletins", s.news.map((n) => newsLine(n))),
    ...section(`Messages${s.unreadMessages ? ` (${s.unreadMessages} unread)` : ""}`, s.messages.map((m) => messageLine(m))),
    ...(s.unavailable?.length ? ["", `(Not available from Wilma right now: ${s.unavailable.join(", ")})`] : []),
  ];
}

/** Text for a command's result. */
export function formatText(command: string, action: string | null, result: any): string {
  switch (command) {
    case "summary":
      return perStudent(result, "summary", (s: SummaryData) => summaryLines(s));
    case "schedule": {
      const period = result.weekStart ? `${result.weekStart} – ${result.weekEnd}` : result.date;
      return titled(`Schedule ${period}`, result, perStudent(result, "lessons", scheduleLines));
    }
    case "homework":
      return perStudent(result, "homework", (items: HomeworkItem[]) =>
        items.length ? items.map((h) => `  ${h.date}  ${h.subject}: ${compactText(h.homework)}`) : ["  No recent homework."]
      );
    case "exams":
      return perStudent(result, "exams", (items: UpcomingExam[]) => (items.length ? items.map((e) => `  ${examLine(e)}`) : ["  No upcoming exams."]));
    case "grades":
      return perStudent(result, "grades", (items: ExamGrade[]) =>
        items.length ? items.map((g) => `  ${g.date}  ${g.subject}: ${g.name} — ${g.grade}`) : ["  No exam grades."]
      );
    case "gradebook":
      return perStudent(result, "gradebook", (entries: GradebookEntry[]) => gradebookLines(entries));
    case "notes": {
      if (action === "summary") {
        return perStudent(result, "summary", (s: LessonNoteSummary) => [
          `  Lesson notes, ${s.from ? `${s.from} – ${s.to}` : "this school year"}: ${s.total}`,
          ...s.byType.map((t) => `    ${t.type}: ${t.count}`),
        ]);
      }
      const period = result.from ? `${result.from} – ${result.to}` : result.date;
      return titled(
        `Lesson notes ${period}`,
        result,
        perStudent(result, "notes", (notes: LessonNote[]) =>
          notes.length ? notes.map((n) => `  ${lessonNoteLine(n, Boolean(result.from))}`) : ["  No lesson notes."]
        )
      );
    }
    case "messages": {
      if (action === "read") {
        const msg = result.message as Message;
        return [
          msg.subject,
          ...(msg.senderName ? [`From: ${msg.senderName}`] : []),
          ...(msg.recipients?.length ? [`To: ${msg.recipients.join(", ")}`] : []),
          `Sent: ${finnishDateTime(msg.sentAt)}`,
          ...(msg.content ? ["", formatContent(msg.content)] : []),
          ...(msg.replies ?? []).flatMap((reply) => [
            "",
            `--- Reply from ${reply.senderName ?? "unknown"}, ${finnishDateTime(reply.sentAt)}`,
            ...(reply.content ? [formatContent(reply.content)] : []),
          ]),
        ].join("\n");
      }
      return perStudent(result, "messages", (items: Message[]) => (items.length ? items.map((m) => `  ${messageLine(m)}`) : ["  No messages."]));
    }
    case "news": {
      if (action === "read") {
        const item = result.news as NewsItem;
        return [
          item.title,
          ...(item.subtitle ? [item.subtitle] : []),
          ...(item.published ? [`Published: ${finnishDay(item.published)}${item.author ? ` by ${item.author}` : ""}`] : []),
          ...(item.content ? ["", formatContent(item.content)] : []),
          ...(item.resources?.length
            ? ["", `Links (${item.resources.length}):`, ...item.resources.map((r) => `  [${r.id}] ${compactText(r.label)} — ${r.url}`), "", `Download one: wilma news ${item.wilmaId} download <resource>`]
            : []),
        ].join("\n");
      }
      return perStudent(result, "news", (items: NewsItem[]) => {
        const lines = items.length ? items.map((n) => `  ${newsLine(n)}`) : ["  No bulletins."];
        return lines;
      });
    }
    case "printouts":
      return perStudent(result, "printouts", (items: Printout[]) =>
        items.length ? [...items.map((p) => `  ${compactText(p.title)} (id ${p.id})`)] : ["  No printouts."]
      );
    case "students":
      return (result.students as StudentRef[])
        .map((s) => `${s.studentNumber}  ${s.name}${s.wilma ? `  (${s.wilma})` : ""}`)
        .join("\n");
    default:
      return JSON.stringify(result, null, 2);
  }
}
