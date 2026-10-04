import * as cheerio from "cheerio";
import type { Exam, UpcomingExam } from "../types.js";

export function parseExamsHtml(html: string): Exam[] {
  const $ = cheerio.load(html);
  const exams: Exam[] = [];
  let autoId = 1;
  const now = new Date();

  $("div.table-responsive.margin-bottom").each((_, block) => {
    const table = $(block).find("table.table-grey").first();
    if (!table.length) {
      return;
    }

    const rows = table.find("tr");
    if (!rows.length) {
      return;
    }

    const firstCells = $(rows.get(0)).find("td");
    if (firstCells.length < 2) {
      return;
    }

    const dateText = $(firstCells.get(0)).text().trim();
    const match = /(\d{1,2}\.\d{1,2}\.\d{4})/.exec(dateText);
    if (!match) {
      return;
    }

    const [d, m, y] = match[1].split(".").map(Number);
    // Use midday UTC to avoid timezone date shifts in JSON output
    const examDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    // Also store as local date string to avoid any serialization issues
    const dateString = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    // "Pe 30.10.2026 Klo 08:30": some exams have a start time.
    const timeMatch = /klo\s*(\d{1,2})[:.](\d{2})/i.exec(dateText);
    const time = timeMatch ? `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}` : null;

    // Compact whitespace first to normalize the text before parsing
    const subjDesc = compactText($(firstCells.get(1)).text());
    let subject = subjDesc;
    let description: string | null = null;
    if (subjDesc.includes(":")) {
      const parts = subjDesc.split(":");
      description = parts[0].trim();
      subject = parts.slice(1).join(":").trim();
    }

    let teacher: string | null = null;
    let notes: string | null = null;

    rows.slice(1).each((_, row) => {
      const th = $(row).find("th").first();
      const td = $(row).find("td").first();
      if (!th.length || !td.length) {
        return;
      }
      const header = th.text().trim().toLowerCase();
      const value = td.text().trim();
      if (header.includes("opettaja")) {
        const names = td
          .find("a.profile-link")
          .toArray()
          .map((a) => $(a).text().trim())
          .filter(Boolean);
        teacher = names.length ? names.join(", ") : value;
      } else if (header.includes("lisätiedot") || header.includes("notes")) {
        notes = value;
      }
    });

    exams.push({
      wilmaId: autoId,
      examDate,
      dateString,
      subject: compactText(subject || "(N/A)"),
      description: description ? compactText(description) : null,
      teacher: teacher ? compactText(teacher) : null,
      notes: notes ? compactText(notes) : null,
      time,
      fetchedAt: now,
    });

    autoId += 1;
  });

  return exams;
}

/**
 * Add start times from the exam calendar to upcoming exams (the front page's
 * exam list has dates only). An exam is matched by date and its course code
 * (e.g. "MA_91" appears in the calendar entry), or by date alone when it is
 * the only exam that day in both lists.
 */
export function addExamTimes(upcoming: UpcomingExam[], calendar: Exam[]): UpcomingExam[] {
  return upcoming.map((exam) => {
    const sameDay = calendar.filter((entry) => entry.dateString === exam.date);
    const code = exam.subjectCode ? new RegExp(`(^|\\s)${escapeRegExp(exam.subjectCode)}(\\s|$|[.,:])`) : null;
    const text = (entry: Exam) => `${entry.description ?? ""} ${entry.subject}`;
    let byCode = code ? sameDay.filter((entry) => code.test(text(entry))) : [];
    if (byCode.length > 1) {
      // Several exams of one course that day: the exam's name tells them apart.
      const nameWords = words(exam.name);
      const scored = byCode.map((entry) => {
        const entryWords = new Set(words(text(entry)));
        return { entry, score: nameWords.filter((word) => entryWords.has(word)).length };
      });
      const best = Math.max(...scored.map((s) => s.score));
      byCode = best > 0 ? scored.filter((s) => s.score === best).map((s) => s.entry) : byCode;
    }
    const onlyOne = sameDay.length === 1 && upcoming.filter((other) => other.date === exam.date).length === 1;
    const match = byCode.length === 1 ? byCode[0] : onlyOne ? sameDay[0] : null;
    return { ...exam, time: match?.time ?? null };
  });
}

function words(value: string): string[] {
  return value.toLowerCase().match(/[\p{L}\d]{3,}/gu) ?? [];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
