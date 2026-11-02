/*
 * Homework, as Wilma gives it: per course, the date it was set and the text.
 * Wilma has no due dates, so "homework for Wednesday" means: for each course
 * on Wednesday's timetable, the latest homework set before Wednesday (within
 * two weeks).
 */
import type { ScheduleLesson } from "@wilma-client/src/core";
import type { HomeworkItem } from "@wilma-client/src/types";
import { useMemo } from "react";
import type { ChildData, JevRecord, LocalState } from "./model";
import { addDays, daysBetween } from "./dates";
import { hash } from "./hash";
import { noteKind } from "./notes";
import { useApp } from "./store";

/** "MA_91" (homework) and "MA_" (timetable) are the same course: "MA". */
export const courseKey = (code: string) => code.split("_")[0].trim().toUpperCase();

export function sameCourse(lesson: ScheduleLesson, hw: HomeworkItem): boolean {
  const a = courseKey(lesson.subjectCode || "");
  const b = courseKey(hw.subjectCode || "");
  if (a && b) return a === b;
  return Boolean(hw.subject) && lesson.subject.trim().toLowerCase() === hw.subject.trim().toLowerCase();
}

export interface DueHomework {
  lesson: ScheduleLesson;
  item: HomeworkItem;
}

export function homeworkFor(data: ChildData | undefined, date: string): DueHomework[] {
  const all = data?.overview?.homework ?? [];
  const lessons = (data?.lessons ?? []).filter((l) => l.date === date).sort((a, b) => a.start.localeCompare(b.start));
  const out: DueHomework[] = [];
  const seen = new Set<string>();
  for (const lesson of lessons) {
    const course = courseKey(lesson.subjectCode || lesson.subject);
    if (seen.has(course)) continue;
    const item = all
      .filter((hw) => hw.date && hw.date < date && hw.date >= addDays(date, -14) && sameCourse(lesson, hw))
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (item) {
      seen.add(course);
      out.push({ lesson, item });
    }
  }
  return out;
}

/** The homework for one lesson: the latest set for its course before (or on) its day, within two weeks. */
export function homeworkForLesson(data: ChildData | undefined, lesson: ScheduleLesson): HomeworkItem | null {
  return (
    (data?.overview?.homework ?? [])
      .filter((hw) => hw.date && hw.date <= lesson.date && hw.date >= addDays(lesson.date, -14) && sameCourse(lesson, hw))
      .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null
  );
}

export function recentHomework(data: ChildData | undefined, now: string, days = 7): HomeworkItem[] {
  return (data?.overview?.homework ?? [])
    .filter((hw) => hw.date && daysBetween(hw.date, now) <= days && hw.date <= now)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Homework by the lesson it's due: each item once, on its course's first
 * lesson after the day it was set, when that lesson is one of `days`. Items
 * set more than three days before the first of `days` are left out: their
 * due lesson may have been earlier still, which isn't known here.
 */
export function dueHomework(data: ChildData | undefined, lessons: ScheduleLesson[], days: string[], judged: HomeworkJudged): DueHomework[] {
  if (!days.length) return [];
  const ordered = [...lessons].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const first = [...days].sort()[0];
  const seen = new Set<string>();
  const out: DueHomework[] = [];
  for (const item of data?.overview?.homework ?? []) {
    if (!item.date || item.date < addDays(first, -3)) continue;
    // "Ei läksyä." with instructions only for pupils who were away isn't homework for a child who was there.
    if (!isForChild(data, item, judged)) continue;
    const lesson = ordered.find((l) => l.date > item.date && sameCourse(l, item));
    const key = `${lesson?.date}|${item.subject}|${item.homework}`;
    if (!lesson || !days.includes(lesson.date) || seen.has(key)) continue;
    seen.add(key);
    out.push({ lesson, item });
  }
  return out.sort((a, b) => (a.lesson.date + a.lesson.start).localeCompare(b.lesson.date + b.lesson.start));
}

/** Whether the child was away from the lesson a homework was given in (an absence note that day for that course). */
export function absentWhenGiven(data: ChildData | undefined, item: HomeworkItem): boolean {
  const notes = data?.yearNotes?.notes ?? data?.notes ?? [];
  const course = courseKey(item.subjectCode || item.subject);
  return notes.some((n) => n.date === item.date && courseKey(n.subject || "") === course && ["absence", "explain"].includes(noteKind(n)));
}

/* ---------- What a homework text says ---------- */

/** What the app knows about homework texts beyond their words: the AI's answers (state.jev) and the parent's word (LocalState.homework). */
export interface HomeworkJudged {
  jev: Record<string, JevRecord>;
  set: LocalState["homework"];
}

/** The AI's answers and the parent's word, for the homework helpers. */
export function useHomeworkJudged(): HomeworkJudged {
  const jev = useApp((s) => s.jev);
  const set = useApp((s) => s.local.homework);
  return useMemo(() => ({ jev, set }), [jev, set]);
}

/** A homework text's key: the same text for the same course on the same day is one homework, for siblings too. */
export const homeworkKey = (item: Pick<HomeworkItem, "date" | "subject" | "subjectCode" | "homework">): string =>
  `hw:${item.date}:${courseKey(item.subjectCode || item.subject)}:${hash(item.homework)}`;

/** The most sentences the AI is asked about one by one; a longer text is split by its words. */
export const MAX_SENTENCES = 12;

/**
 * A homework text's sentences, as the text's own punctuation and lines divide it (with their spaces, to join again).
 * A piece starting with a digit or a small letter goes on the one before: "s. 34", "kpl. 2", "esim. tehtävä".
 */
export function homeworkSentences(text: string): string[] {
  const out: string[] = [];
  for (const { segment } of new Intl.Segmenter("fi", { granularity: "sentence" }).segment(text)) {
    if (out.length && !/\n\s*$/.test(out[out.length - 1]) && /^[\p{Ll}\p{Nd}]/u.test(segment)) out[out.length - 1] += segment;
    else out.push(segment);
  }
  return out.filter((s) => s.trim());
}

export interface HomeworkParts {
  /** What the whole class is told, without the instructions for pupils who were away. */
  main: string;
  /** The instructions only for pupils who missed the lesson, if any. */
  absentees: string | null;
  /** Who split them: the AI, sentence by sentence, or the text's words. */
  splitBy: "ai" | "words";
  /** Whether it gives the whole class something to do. */
  forClass: boolean;
  /** Who said whether it's for the class: the parent, the AI reading the text, or the text's words. */
  from: "parent" | "ai" | "words";
}

/**
 * What a homework text says: the parent's word on whether the class has something to do, else the AI's reading of
 * the text (jev/runner.ts, HOMEWORK_QS: whether it's for the class, and which sentences are only for pupils who were
 * away), else the text's words.
 */
export function homeworkParts(item: HomeworkItem, judged: HomeworkJudged): HomeworkParts {
  const key = homeworkKey(item);
  const answers = judged.jev[key]?.answers;
  const sure = (name: string) => {
    const a = answers?.[name];
    return a?.type === "noul" ? a.noul >= 0.5 : null;
  };
  const sentences = homeworkSentences(item.homework);
  const away = sentences.length <= MAX_SENTENCES ? sentences.map((_, i) => sure(`away_${i + 1}`)) : [];
  const read = answers && away.length && away.every((a) => a !== null);
  const split = read
    ? {
        main: sentences.filter((_, i) => !away[i]).join("").trim(),
        absentees: sentences.filter((_, i) => away[i]).join("").trim() || null,
        splitBy: "ai" as const,
      }
    : { ...splitAbsentees(item.homework), splitBy: "words" as const };
  const set = judged.set?.[key];
  if (set !== undefined) return { ...split, forClass: set, from: "parent" };
  const forClass = sure("for_class");
  if (forClass !== null) return { ...split, forClass, from: "ai" };
  // Only instructions for pupils who were away leave nothing for the class.
  return { ...split, forClass: Boolean(split.main) && !saysNoHomework(split.main), from: "words" };
}

/** Whether a homework item is something this child has to do: something for the class, or instructions for pupils who were away when they were. */
export function isForChild(data: ChildData | undefined, item: HomeworkItem, judged: HomeworkJudged): boolean {
  const { forClass, absentees } = homeworkParts(item, judged);
  return forClass || (Boolean(absentees) && absentWhenGiven(data, item));
}

/* ---------- Without the AI: the text's words ---------- */

/**
 * Teachers often add instructions for pupils who missed the lesson
 * ("POISSAOLIJAT 1. Lue …"), sometimes most of the text. Split them off,
 * so the list can show what the class has to do and fold the rest.
 */
function splitAbsentees(text: string): { main: string; absentees: string | null } {
  const m = /\b(poissaolijat|poissaolleet|poissa olleet|poissaolijoille|poissa olleille|poissaoleville|tunnilta poissa olleet|frånvarande)\b/i.exec(text);
  if (!m) return { main: text, absentees: null };
  return { main: text.slice(0, m.index).replace(/[\s.,;:–-]+$/, "").trim(), absentees: text.slice(m.index).trim() };
}

/** "Ei läksyä." / "No homework": the class has nothing to do (instructions for pupils who were away may follow). */
// (No \\b after "ä": JavaScript's word boundary only knows a–z.)
export const saysNoHomework = (text: string): boolean => /^\s*(ei (läksyä|läksyjä|kotitehtävää|kotitehtäviä)|no homework|ingen läxa)(?=[\s.,;:!]|$)/i.test(text);
