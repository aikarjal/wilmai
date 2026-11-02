import test from "node:test";
import assert from "node:assert/strict";
import type { HomeworkItem } from "@wilma-client/src/types";
import { homeworkKey, homeworkParts, homeworkSentences, isForChild, type HomeworkJudged } from "../src/data/homework";
import { HOMEWORK_QS } from "../src/jev/questions";
import type { JevRecord } from "../src/data/model";

const hw = (homework: string): HomeworkItem => ({ date: "2026-11-03", subject: "Englanti", subjectCode: "ENA_7", homework, teacher: "", teacherCode: "" });
const none: HomeworkJudged = { jev: {}, set: undefined };
/** The AI's answers about a text: whether it's for the class, and each sentence's "only for pupils who were away". */
const read = (item: HomeworkItem, forClass: number, away: number[], set?: boolean): HomeworkJudged => ({
  jev: {
    [homeworkKey(item)]: {
      qs: HOMEWORK_QS,
      hash: "h",
      model: "gpt-6-luna",
      at: 0,
      answers: { for_class: { type: "noul", noul: forClass }, ...Object.fromEntries(away.map((p, i) => [`away_${i + 1}`, { type: "noul", noul: p }])) },
    } as JevRecord,
  },
  set: set === undefined ? undefined : { [homeworkKey(item)]: set },
});

test("a homework text's sentences: its punctuation and lines, not a page number or an abbreviation", () => {
  assert.deepEqual(homeworkSentences("Tehtävät 5–8 s. 34."), ["Tehtävät 5–8 s. 34."]);
  assert.deepEqual(homeworkSentences("Lue kpl 4.\nPOISSAOLIJAT: katsokaa diat."), ["Lue kpl 4.\n", "POISSAOLIJAT: katsokaa diat."]);
  assert.deepEqual(homeworkSentences("Ei läksyä. Poissaolleiden tehtävät tulevat Classroomiin."), ["Ei läksyä. ", "Poissaolleiden tehtävät tulevat Classroomiin."]);
});

test("without the AI, the text's words decide; only instructions for pupils who were away leave nothing for the class", () => {
  const both = homeworkParts(hw("Lue kpl 4.\nPOISSAOLIJAT: katsokaa diat."), none);
  assert.deepEqual(both, { main: "Lue kpl 4", absentees: "POISSAOLIJAT: katsokaa diat.", splitBy: "words", forClass: true, from: "words" });
  assert.equal(homeworkParts(hw("POISSAOLIJAT: katsokaa tunnin video."), none).forClass, false);
  assert.equal(homeworkParts(hw("Ei läksyä."), none).forClass, false);
  // A form the words don't know stays in the class's part.
  assert.equal(homeworkParts(hw("Ei läksyä. Poissaolleiden tehtävät tulevat Classroomiin."), none).absentees, null);
});

test("with the AI, its reading decides, sentence by sentence, wherever the part for pupils who were away is", () => {
  const item = hw("Ei läksyä. Poissaolleiden tehtävät tulevat Classroomiin.");
  const judged = read(item, 0.08, [0.03, 0.94]);
  assert.deepEqual(homeworkParts(item, judged), { main: "Ei läksyä.", absentees: "Poissaolleiden tehtävät tulevat Classroomiin.", splitBy: "ai", forClass: false, from: "ai" });
  assert.equal(isForChild(undefined, item, judged), false);
  // Those who were away first, the class second.
  const first = hw("Poissaolijat: tehkää tehtävät 1–4. Kaikki: lue kappale 6.");
  const parts = homeworkParts(first, read(first, 0.9, [0.95, 0.04]));
  assert.equal(parts.main, "Kaikki: lue kappale 6.");
  assert.equal(parts.absentees, "Poissaolijat: tehkää tehtävät 1–4.");
  // A sentence left unanswered: the words split it instead.
  assert.equal(homeworkParts(item, read(item, 0.08, [0.03])).splitBy, "words");
});

test("the parent's word on whether the class has something to do wins; the AI's split stays", () => {
  const item = hw("Ei läksyä, seuraavalla kerralla koe.");
  const parts = homeworkParts(item, read(item, 0.2, [0.01], true));
  assert.equal(parts.forClass, true);
  assert.equal(parts.from, "parent");
  assert.equal(parts.splitBy, "ai");
  assert.ok(isForChild(undefined, item, read(item, 0.2, [0.01], true)));
});
