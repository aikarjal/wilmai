import test from "node:test";
import assert from "node:assert/strict";
import { averageOf, isAcademic, isConduct, kindOf, spreadOf, termAverages, type SubjectGrades } from "../src/data/grades";

const subject = (name: string, grade: string, courses: [string, string][] = []): SubjectGrades => ({
  name,
  grade,
  courses: courses.map(([date, g]) => ({ code: null, grade: g, date, name })),
});

test("a report-card subject's kind: the parent's word, else the AI's reading, else the name's usual words", () => {
  // Without the AI, the name's usual words (Finnish, Swedish).
  assert.deepEqual(kindOf("Matematiikka", undefined), { kind: "academic", from: "name" });
  assert.deepEqual(kindOf("Musiikki", undefined), { kind: "other", from: "name" });
  assert.deepEqual(kindOf("Käyttäytyminen", undefined), { kind: "conduct", from: "name" });
  assert.deepEqual(kindOf("Läsförståelse", undefined), { kind: "other", from: "name" }); // a name the words don't know
  // The AI reads a name the words don't know.
  const ai = { Läsförståelse: { ai: "academic" as const, by: "x" }, "Toiminta ryhmässä": { ai: "conduct" as const, by: "x" } };
  assert.ok(isAcademic("Läsförståelse", ai));
  assert.ok(isConduct("Toiminta ryhmässä", ai));
  // The parent's word wins over both.
  assert.deepEqual(kindOf("Läsförståelse", { Läsförståelse: { ai: "academic", by: "x", set: "other" } }), { kind: "other", from: "parent" });
  assert.deepEqual(kindOf("Musiikki", { Musiikki: { set: "academic" } }), { kind: "academic", from: "parent" });
});

test("behaviour, however the school names it, stays out of the averages and the spread", () => {
  const subjects = [
    subject("Matematiikka", "9", [["2025-12-19", "8"], ["2026-05-29", "9"]]),
    subject("Kuvataide", "7", [["2025-12-19", "7"], ["2026-05-29", "7"]]),
    subject("Toiminta ryhmässä", "5", [["2025-12-19", "5"], ["2026-05-29", "5"]]),
  ];
  // Without the AI the words don't know the school's name for behaviour: it's counted.
  assert.deepEqual(averageOf(subjects, undefined), { mean: 7, count: 3 });
  const kinds = { "Toiminta ryhmässä": { ai: "conduct" as const, by: "x" } };
  assert.deepEqual(averageOf(subjects, kinds), { mean: 8, count: 2 });
  assert.deepEqual(spreadOf(subjects, kinds), [{ grade: 9, count: 1 }, { grade: 7, count: 1 }]);
  assert.deepEqual(termAverages(subjects, kinds), [{ key: "2025-2", mean: 7.5 }, { key: "2026-1", mean: 8 }]);
});
