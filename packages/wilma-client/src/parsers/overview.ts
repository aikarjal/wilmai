import { finnishDateString } from "../finnish-time.js";
import type {
  ScheduleLesson,
  UpcomingExam,
  ExamGrade,
  HomeworkItem,
  OverviewData,
} from "../types.js";

/* ------------------------------------------------------------------ */
/*  Raw API shapes (internal)                                         */
/* ------------------------------------------------------------------ */

interface RawScheduleEntry {
  ReservationID?: number;
  Day?: number;
  Start?: string;
  End?: string;
  Class?: string;
  DateArray?: string[];
  Groups?: {
    Id?: number;
    CourseId?: number;
    ShortCaption?: string;
    Caption?: string;
    FullCaption?: string;
    Teachers?: { Id?: number; Caption?: string; LongCaption?: string }[];
  }[];
}

interface RawGroupExam {
  Id?: number;
  Date?: string;
  // Upcoming exams: Caption + Topic, no Grade
  Caption?: string;
  Topic?: string;
  // Past exams: Name + Grade + Info
  Name?: string;
  Grade?: string;
  VerbalGrade?: string;
  Info?: string;
}

interface RawHomework {
  RowNumber?: number;
  Date?: string;
  Homework?: string;
}

interface RawGroup {
  Id?: number;
  CourseId?: number;
  CourseName?: string;
  CourseCode?: string;
  Teachers?: { TeacherId?: number; TeacherName?: string; TeacherCode?: string }[];
  Homework?: RawHomework[];
  Exams?: RawGroupExam[];
}

interface RawTopLevelExam {
  Id?: number;
  ExamId?: number;
  Course?: string;
  CourseId?: number;
  Name?: string;
  CourseTitle?: string;
  Grade?: string;
  ExamSeen?: string;
  Date?: string;
  Info?: string;
  Teachers?: { TeacherId?: number; TeacherName?: string; TeacherCode?: string }[];
}

interface RawOverview {
  Role?: string;
  Schedule?: RawScheduleEntry[];
  Exams?: RawTopLevelExam[];
  Groups?: RawGroup[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** "4.9.2025" → "2025-09-04", passes through "2025-09-04" unchanged */
function parseFinnishDate(raw: string): string {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(trimmed);
  if (m) {
    return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return trimmed;
}

function firstTeacher(
  teachers?: { TeacherId?: number; TeacherName?: string; TeacherCode?: string }[]
): { name: string; code: string } {
  const t = teachers?.[0];
  return { name: t?.TeacherName ?? "", code: t?.TeacherCode ?? "" };
}

function firstScheduleTeacher(
  teachers?: { Id?: number; Caption?: string; LongCaption?: string }[]
): { name: string; code: string } {
  const t = teachers?.[0];
  return { name: t?.LongCaption ?? "", code: t?.Caption ?? "" };
}

/* ------------------------------------------------------------------ */
/*  Main parser                                                       */
/* ------------------------------------------------------------------ */

/** `now` decides which exams are upcoming (default: the current time). */
export function parseOverview(raw: unknown, now: Date = new Date()): OverviewData {
  const data = (raw ?? {}) as RawOverview;
  const today = finnishDateString(now);

  return {
    schedule: parseSchedule(data.Schedule ?? []),
    upcomingExams: parseUpcomingExams(data.Groups ?? [], today),
    grades: parseTopLevelGrades(data.Exams ?? []),
    homework: parseHomework(data.Groups ?? []),
    fetchedAt: now,
  };
}

/* ------------------------------------------------------------------ */
/*  Schedule                                                          */
/* ------------------------------------------------------------------ */

function parseSchedule(entries: RawScheduleEntry[]): ScheduleLesson[] {
  const lessons: ScheduleLesson[] = [];

  for (const entry of entries) {
    const dates = entry.DateArray ?? [];
    const groups = entry.Groups ?? [];
    const day = entry.Day ?? 0;
    const start = entry.Start ?? "";
    const end = entry.End ?? "";

    for (const date of dates) {
      for (const group of groups) {
        const teacher = firstScheduleTeacher(group.Teachers);
        lessons.push({
          date,
          dayOfWeek: day,
          start,
          end,
          subject: group.FullCaption ?? group.Caption ?? "",
          subjectCode: group.ShortCaption ?? "",
          teacher: teacher.name,
          teacherCode: teacher.code,
          groupId: group.Id ?? 0,
        });
      }
    }
  }

  lessons.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  return lessons;
}

/* ------------------------------------------------------------------ */
/*  Exams & Grades (from Groups[].Exams[])                            */
/* ------------------------------------------------------------------ */

/** Upcoming exams from Groups[].Exams[] — has ungraded exams with Caption/Topic */
function parseUpcomingExams(groups: RawGroup[], today: string): UpcomingExam[] {
  const upcoming: UpcomingExam[] = [];

  for (const group of groups) {
    const teacher = firstTeacher(group.Teachers);
    const subject = group.CourseName ?? "";
    const subjectCode = group.CourseCode ?? "";

    for (const exam of group.Exams ?? []) {
      // Skip exams that already have a grade
      if (exam.Grade != null && String(exam.Grade).trim() !== "") continue;

      const date = parseFinnishDate(exam.Date ?? "");
      // Only include today or future
      if (date < today) continue;

      upcoming.push({
        examId: exam.Id ?? 0,
        date,
        name: exam.Caption ?? exam.Name ?? "",
        subject,
        subjectCode,
        topic: exam.Topic?.trim() || null,
        teacher: teacher.name,
        teacherCode: teacher.code,
      });
    }
  }

  upcoming.sort((a, b) => a.date.localeCompare(b.date));
  return upcoming;
}

/** Grades from top-level Exams[] — authoritative source for all graded exams */
function parseTopLevelGrades(exams: RawTopLevelExam[]): ExamGrade[] {
  const grades: ExamGrade[] = [];

  for (const exam of exams) {
    const grade = String(exam.Grade ?? "").trim();
    if (!grade) continue;

    const date = parseFinnishDate(exam.Date ?? "");
    const teacher = exam.Teachers?.[0];

    grades.push({
      examId: exam.ExamId ?? exam.Id ?? 0,
      date,
      name: exam.Name ?? "",
      subject: exam.CourseTitle ?? "",
      subjectCode: (exam.Course ?? "").split(" ")[0],
      grade,
      verbalGrade: null,
      info: exam.Info?.trim() || null,
      teacher: teacher?.TeacherName ?? "",
      teacherCode: teacher?.TeacherCode ?? "",
    });
  }

  grades.sort((a, b) => b.date.localeCompare(a.date));
  return grades;
}

/* ------------------------------------------------------------------ */
/*  Homework (from Groups[].Homework[])                               */
/* ------------------------------------------------------------------ */

function parseHomework(groups: RawGroup[]): HomeworkItem[] {
  const items: HomeworkItem[] = [];

  for (const group of groups) {
    const teacher = firstTeacher(group.Teachers);
    const subject = group.CourseName ?? "";
    const subjectCode = group.CourseCode ?? "";

    for (const hw of group.Homework ?? []) {
      const text = (hw.Homework ?? "").replace(/\r\n/g, "\n").trim();
      if (!text) continue;

      items.push({
        date: hw.Date ?? "",
        subject,
        subjectCode,
        homework: text,
        teacher: teacher.name,
        teacherCode: teacher.code,
      });
    }
  }

  items.sort((a, b) => b.date.localeCompare(a.date));
  return items;
}
