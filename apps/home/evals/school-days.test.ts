import "./shim.ts";
import test from "node:test";
import assert from "node:assert/strict";
import type { ScheduleLesson } from "@wilma-client/src/core";
import type { ChildData } from "../src/data/model.ts";
import { allTogether, codeInName, dayLessons, dayTimes, isPE, peOf, subjectsByTeacher, teacherSubjects, together, unusualDays, usualWeek } from "../src/data/schedule.ts";

// The children's school days side by side, as a parent with a first-grader keeps them on the fridge: who starts and
// finishes together, the PE days, the usual week, and an optional lesson (remedial teaching) that shouldn't stretch the day.

const lesson = (date: string, start: string, end: string, subject: string, extra: Partial<ScheduleLesson> = {}): ScheduleLesson => ({
  date,
  dayOfWeek: 1,
  start,
  end,
  subject,
  subjectCode: "",
  teacher: "",
  teacherCode: "",
  groupId: 0,
  ...extra,
});
const child = (lessons: ScheduleLesson[]): ChildData => ({ lessons, notes: [], exams: [] });

test("children start or finish together within a quarter of an hour", () => {
  const near = together([{ start: "08:15", end: "14:30" }, { start: "08:30", end: "12:45" }, undefined, { start: "09:10", end: "12:40" }]);
  assert.deepEqual(near[0], { start: [1], end: [] });
  assert.deepEqual(near[1], { start: [0], end: [3] }, "a quarter of an hour is still together; 08:15 and 09:10 aren't");
  assert.deepEqual(near[2], { start: [], end: [] }, "no lessons: nobody to go with");
  // The day's label ("Same start") is for when all of them at school that day do; a child without lessons doesn't count.
  assert.deepEqual(allTogether([{ start: "08:15", end: "14:30" }, undefined, { start: "08:30", end: "12:45" }]), { start: true, end: false });
  assert.deepEqual(allTogether([{ start: "08:15", end: "14:30" }, { start: "08:30", end: "12:45" }, { start: "09:10", end: "12:40" }]), { start: false, end: false }, "two of three is marked on their bars instead");
  assert.deepEqual(allTogether([{ start: "08:15", end: "14:30" }, undefined]), { start: false, end: false }, "one child at school");
});

test("a lesson left out of the school day still shows but doesn't stretch it", () => {
  // Monday is usually 08:15–13:00; this Monday has remedial teaching to 14:30.
  const weeks = ["2026-10-19", "2026-10-26", "2026-11-02"].flatMap((monday) => [lesson(monday, "08:15", "13:00", "Matematiikka")]);
  const remedial = lesson("2026-11-02", "13:45", "14:30", "Tukiopetus");
  const data = child([...weeks, remedial]);
  assert.equal(dayTimes(data.lessons).get("2026-11-02")?.end, "14:30");
  assert.equal(unusualDays(data, ["2026-11-02"]).length, 1, "counted, it's a day that ends late");
  assert.deepEqual(dayLessons(data.lessons, ["Tukiopetus"]).includes(remedial), false);
  assert.equal(dayTimes(dayLessons(data.lessons, ["Tukiopetus"])).get("2026-11-02")?.end, "13:00");
  assert.deepEqual(unusualDays(data, ["2026-11-02"], ["Tukiopetus"]), [], "left out, it's an ordinary Monday");
});

test("the usual week: each weekday's most common hours, and PE when it's on that day most weeks", () => {
  const mondays = ["2026-10-19", "2026-10-26", "2026-11-02"];
  const lessons = mondays.flatMap((m, i) => [
    lesson(m, "08:15", "09:45", "Äidinkieli"),
    lesson(m, "10:00", i === 2 ? "12:30" : "13:15", "Liikunta", { subjectCode: "LI_3B" }),
    // Tuesday: PE only one week in three is not a PE day.
    lesson(addDays(m, 1), "09:00", "13:00", i === 0 ? "Liikunta" : "Matematiikka"),
  ]);
  const usual = usualWeek(child([...lessons, lesson("2026-11-03", "13:30", "15:00", "Kerho")]), ["Kerho"]);
  assert.equal(usual.weeks, 3);
  assert.deepEqual(usual.days, [
    { weekday: 0, start: "08:15", end: "13:15", pe: true },
    { weekday: 1, start: "09:00", end: "13:00", pe: false },
  ]);
});

test("PE: the parent's word, else the AI's reading of the subject, else the subject's name", () => {
  const sport = { subject: "Sporttikurssi", subjectCode: "SPO" };
  const gym = { subject: "Liikunta", subjectCode: "LI_3B" };
  // Without the AI, the name's usual words.
  assert.deepEqual([peOf(gym, undefined), peOf(sport, undefined)], [{ pe: true, from: "name" }, { pe: false, from: "name" }]);
  assert.ok(isPE({ subject: "Idrott och hälsa", subjectCode: "" }, undefined));
  // The AI reads a name the words don't know, and can say a name with the word isn't PE.
  const ai = { Sporttikurssi: { ai: 0.92, by: "x" }, Liikunta: { ai: 0.97, by: "x" }, "Liikuntatieto (teoria)": { ai: 0.2, by: "x" } };
  assert.deepEqual(peOf(sport, ai), { pe: true, from: "ai" });
  assert.deepEqual(peOf({ subject: "Liikuntatieto (teoria)", subjectCode: "LIT" }, ai), { pe: false, from: "ai" });
  // The parent's word wins over both.
  assert.deepEqual(peOf(sport, { Sporttikurssi: { ai: 0.92, by: "x", set: false } }), { pe: false, from: "parent" });
  assert.deepEqual(peOf({ subject: "Uinti", subjectCode: "UI" }, { Uinti: { set: true } }), { pe: true, from: "parent" });
});

test("what a teacher teaches the child, by the code in a message's name or by the timetable's name", () => {
  const data = child([
    lesson("2026-11-02", "08:15", "09:00", "Matematiikka", { teacher: "Korhonen Jussi", teacherCode: "KOJ" }),
    // Two teachers on one lesson: both teach it.
    lesson("2026-11-02", "09:00", "09:45", "Kemia", { teacher: "Korhonen Jussi, Mäkinen Laura", teacherCode: "KOJ, MÄL" }),
  ]);
  assert.deepEqual(subjectsByTeacher(data).get("MÄL"), ["Kemia"]);
  assert.deepEqual(teacherSubjects(data, "Korhonen Jussi (KOJ)"), ["Matematiikka", "Kemia"]);
  assert.deepEqual(teacherSubjects(data, "Laura Mäkinen"), ["Kemia"]);
  assert.deepEqual(teacherSubjects(data, "Mäkinen Laura (Mäl)"), ["Kemia"], "Wilma's messages can write the code in mixed case");
  assert.deepEqual(teacherSubjects(data, "Salo Pekka (rehtori)"), [], "a role in brackets isn't a teacher code");
  assert.equal(codeInName("Rantanen Tiina (huoltaja)"), null);
});

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
