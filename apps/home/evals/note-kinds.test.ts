import test from "node:test";
import assert from "node:assert/strict";
import { labelKinds, noteKind, noteKindFrom, noteKinds } from "../src/data/notes";
import { NOTE_LABEL_QS } from "../src/jev/questions";
import type { JevRecord } from "../src/data/model";

// Without AI answers: the label's words decide.
const kind = (typeLabel: string) => noteKind({ typeLabel, typeClass: "" }, {});

test("without AI, a school's own note labels get their kind from their words", () => {
  // Labels one Helsinki school uses, with what a parent or pupil reads them as.
  assert.equal(kind("Hyvä!"), "praise");
  assert.equal(kind("Otit hienosti vastuuta omasta oppimisestasi"), "praise");
  assert.equal(kind("Osasit toimia ryhmän vastuullisena jäsenenä"), "praise");
  assert.equal(kind("Jaksoit työskennellä pitkäjänteisesti ja sinnikkäästi"), "praise");
  assert.equal(kind("Sinulla oli tehtäviä tekemättä"), "forgot");
  assert.equal(kind("Sinulta puuttui opiskeluvälineitä"), "forgot");
  assert.equal(kind("Myöhästyminen"), "late");
  assert.equal(kind("Terveydellinen syy"), "absence");
  assert.equal(kind("Ennalta anottu vapaa"), "absence");
  assert.equal(kind("Tiedoksi"), "other");
  assert.equal(kind("Opiskelu muualla"), "other");
});

test("effort words count as praise only in their positive form", () => {
  assert.equal(kind("Teit parhaasi"), "praise");
  assert.equal(kind("Et jaksanut keskittyä"), "other");
});

const answer = (label: string, praise: number, choice: string, confidence: number): [string, JevRecord] => [
  `label:${label}`,
  { qs: NOTE_LABEL_QS, hash: "h", model: "gpt-6-luna", at: 0, answers: { praise: { type: "noul", noul: praise }, note_kind: { type: "choice", choice, confidence, probabilities: { [choice]: confidence } } } } as unknown as JevRecord,
];

test("with AI, the model's answers about a label decide; an unexplained absence stays Wilma's own state", () => {
  const kinds = labelKinds(Object.fromEntries([
    answer("Teit parhaasi tänään", 0.93, "other", 0.8), // praise on its own question
    answer("Tiedoksi", 0.1, "other", 0.4), // not sure enough of the kind: the words decide
    answer("Myöhästyit", 0.02, "late", 0.9),
    answer("Selvittämätön poissaolo", 0.01, "other", 0.9),
  ]));
  assert.deepEqual(kinds, { "Teit parhaasi tänään": "praise", "Myöhästyit": "late", "Selvittämätön poissaolo": "other" });
  assert.equal(noteKind({ typeLabel: "Teit parhaasi tänään", typeClass: "" }, kinds), "praise");
  assert.equal(noteKind({ typeLabel: "Tiedoksi", typeClass: "" }, kinds), "other");
  assert.equal(noteKind({ typeLabel: "Selvittämätön poissaolo", typeClass: "" }, kinds), "explain");
});

test("the parent's word on a note type wins over the AI's and the words, but not over Wilma's unexplained absence", () => {
  const jev = Object.fromEntries([answer("Hienoa työskentelyä", 0.9, "other", 0.8)]);
  const set = { "Hienoa työskentelyä": "other" as const, Myöhästyminen: "absence" as const };
  const kinds = noteKinds(jev, set);
  assert.equal(noteKind({ typeLabel: "Hienoa työskentelyä", typeClass: "" }, kinds), "other");
  assert.equal(noteKind({ typeLabel: "Myöhästyminen", typeClass: "" }, kinds), "absence");
  assert.equal(noteKind({ typeLabel: "Selvittämätön poissaolo", typeClass: "" }, { "Selvittämätön poissaolo": "other" }), "explain");
  assert.equal(noteKindFrom("Hienoa työskentelyä", jev, set), "parent");
  assert.equal(noteKindFrom("Hienoa työskentelyä", jev, undefined), "ai");
  assert.equal(noteKindFrom("Myöhästyminen", {}, undefined), "words");
});

