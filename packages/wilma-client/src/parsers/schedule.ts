import * as cheerio from "cheerio";
import type { ScheduleLesson } from "../types.js";

interface RawScheduleEvent {
  Id?: string | number;
  Date?: string;
  Start?: number;
  End?: number;
  Text?: Record<string, string>;
  LongText?: Record<string, string>;
  OpeInfo?: Record<string, Record<string, RawSchedulePerson>>;
}

interface RawSchedulePerson {
  lyhenne?: string;
  nimi?: string;
}

export function parseScheduleHtml(html: string): ScheduleLesson[] {
  const $ = cheerio.load(html);
  const scripts = $("script:not([src])")
    .map((_, el) => $(el).html() ?? "")
    .get();
  const script = scripts.find((text) => text.includes("eventsJSON") && text.includes("Events"));
  if (!script) {
    return [];
  }

  const match = /Events\s*:\s*(\[[\s\S]*?\])\s*,\s*ActiveTyyppi/.exec(script);
  if (!match) {
    return [];
  }

  let events: RawScheduleEvent[];
  try {
    events = JSON.parse(match[1]) as RawScheduleEvent[];
  } catch {
    return [];
  }

  return events
    .map(parseScheduleEvent)
    .filter((lesson): lesson is ScheduleLesson => lesson !== null)
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}

function parseScheduleEvent(event: RawScheduleEvent): ScheduleLesson | null {
  const date = finnishDateToIso(event.Date ?? "");
  if (!date) {
    return null;
  }

  const subject = firstRecordValue(event.Text) || firstRecordValue(event.LongText);
  const teacher = firstTeacher(event.OpeInfo);
  const dateObj = new Date(`${date}T12:00:00`);

  return {
    date,
    dayOfWeek: dateObj.getDay(),
    start: minutesToTime(event.Start),
    end: minutesToTime(event.End),
    subject,
    subjectCode: firstSubjectToken(subject),
    teacher: teacher.name,
    teacherCode: teacher.code,
    groupId: Number(event.Id) || 0,
  };
}

function finnishDateToIso(value: string): string {
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value.trim());
  if (!match) {
    return "";
  }
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function minutesToTime(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "";
  }
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function firstRecordValue(record: Record<string, string> | undefined): string {
  if (!record) {
    return "";
  }
  return Object.values(record).find((value) => value.trim()) ?? "";
}

function firstTeacher(
  groups: Record<string, Record<string, RawSchedulePerson>> | undefined
): { name: string; code: string } {
  if (!groups) {
    return { name: "", code: "" };
  }

  for (const group of Object.values(groups)) {
    for (const person of Object.values(group)) {
      if (person?.nimi || person?.lyhenne) {
        return { name: person.nimi ?? "", code: person.lyhenne ?? "" };
      }
    }
  }

  return { name: "", code: "" };
}

function firstSubjectToken(subject: string): string {
  return subject.trim().split(/\s+/, 1)[0] ?? "";
}

interface TimetableLesson {
  startAt?: string;
  endsAt?: string;
  dates?: string[];
  modules?: {
    id?: number;
    caption?: string;
    teachers?: { firstname?: string; lastname?: string; abbreviation?: string }[];
    rooms?: { abbreviation?: string; caption?: string }[];
  }[];
}

/**
 * Lessons from the timetable API (`/api/v1/schedules/timetable`): one entry
 * per date a lesson takes place, with every teacher and room. Field values
 * match the schedule page's ("BI_ Biologia", "Lastname Firstname").
 */
export function parseTimetableJson(payload: unknown): ScheduleLesson[] {
  if (!Array.isArray(payload)) return [];
  const lessons: ScheduleLesson[] = [];
  for (const lesson of payload as TimetableLesson[]) {
    const start = (lesson.startAt ?? "").slice(0, 5);
    const end = (lesson.endsAt ?? "").slice(0, 5);
    for (const rawDate of lesson.dates ?? []) {
      const date = rawDate.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      for (const module of lesson.modules ?? []) {
        const subject = (module.caption ?? "").trim();
        const teachers = module.teachers ?? [];
        const rooms = (module.rooms ?? []).map((room) => (room.abbreviation ?? room.caption ?? "").trim()).filter(Boolean);
        lessons.push({
          date,
          dayOfWeek: new Date(`${date}T12:00:00Z`).getUTCDay(),
          start,
          end,
          subject,
          subjectCode: firstSubjectToken(subject),
          teacher: teachers.map((t) => [t.lastname, t.firstname].filter(Boolean).join(" ")).join(", "),
          teacherCode: teachers.map((t) => t.abbreviation ?? "").filter(Boolean).join(", "),
          groupId: Number(module.id) || 0,
          room: rooms.length ? rooms.join(", ") : null,
        });
      }
    }
  }
  return lessons.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}
