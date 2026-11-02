/*
 * Lesson notes (tuntimerkinnät) by kind, for counting and colouring. Wilma
 * gives each note its school's own label ("Terveydellinen syy", "Sinulta
 * puuttui opiskeluvälineitä", "Hyvä!"). With AI, the model says what kind each
 * label is, once per label (jev/questions.ts, NOTE_LABEL_QS); without it, or
 * until it has answered, the label's words decide (Finnish, Swedish, English).
 * The parent's word, set at a note in Notes (LocalState.noteKinds), wins over both.
 * An unexplained absence is always a code rule: it's Wilma's own state, and it
 * makes a task. A label that fits no kind is "other".
 */
import type { LessonNote } from "@wilma-client/src/core";
import type { JevRecord, LocalState } from "./model";
import { getState, useApp } from "./store";
import { NOTE_LABEL_QS } from "../jev/questions";

export type NoteKind = "explain" | "absence" | "late" | "forgot" | "remark" | "praise" | "other";

/** In the order the Notes view shows them: what needs you first, praise last. */
export const NOTE_KINDS: NoteKind[] = ["explain", "absence", "late", "forgot", "remark", "praise", "other"];

const RULES: [NoteKind, RegExp][] = [
  ["explain", /selvittämät|selvitettäv|unexplained|ej utredd|outredd|oklar frånvaro/i],
  ["late", /myöh|late|försen|sen ankomst/i],
  ["forgot", /unoh|tekemättä|puuttui|puuttu|välineet puuttu|forgot|missing|glömt|saknade/i],
  ["remark", /häiri|kiellet|puhelin|käytö|disturb|stör|anmärkning/i],
  // Praise, also for effort: "Jaksoit työskennellä pitkäjänteisesti ja sinnikkäästi", "Teit parhaasi" (not "et jaksanut").
  ["praise", /hyvä|hienosti|positiiv|kiitos|erinomai|onnistu|osasit|otit|vastuu|huomioon|ahkera|aktiivi|innokas|reipas|loistava|upea|jaksoit|pitkäjänteis|sinnik|teit parhaasi|keskityit|edistyit|autoit|kannustit|praise|positive|great|persever|bra jobbat|beröm|uthållig/i],
  // Absences, also time off asked for beforehand ("Ennalta anottu vapaa", "Loma-anomus").
  ["absence", /poissa|terveydellinen|sairau|luvallinen|\bsyy\b|vapaa|anottu|anomus|frånvaro|ledig|sjuk|\babsen|leave/i],
];

/** Wilma marks the absence unexplained until a guardian explains it. */
export const isUnexplained = (note: Pick<LessonNote, "typeLabel" | "typeClass">): boolean => RULES[0][1].test(`${note.typeLabel} ${note.typeClass}`);

/** Where the model's answer about a label is kept (state.jev, per account). */
export const labelKey = (label: string) => `label:${label}`;

/** The model's kinds for the labels it has answered about with some certainty. */
export function labelKinds(jev: Record<string, JevRecord>): Record<string, NoteKind> {
  const out: Record<string, NoteKind> = {};
  for (const [key, record] of Object.entries(jev)) {
    if (record.qs !== NOTE_LABEL_QS || !key.startsWith("label:")) continue;
    const label = key.slice("label:".length);
    const praise = record.answers.praise;
    const answer = record.answers.note_kind;
    if (praise?.type === "noul" && praise.noul >= 0.6) out[label] = "praise";
    else if (answer?.type === "choice" && answer.confidence >= 0.5 && (NOTE_KINDS as string[]).includes(answer.choice)) out[label] = answer.choice as NoteKind;
  }
  return out;
}

type Set = LocalState["noteKinds"];
let known: { jev: Record<string, JevRecord>; set: Set; kinds: Record<string, NoteKind> } | null = null;
/** Each label's kind for the current account: the parent's word, else the model's; worked out once per change of either. */
export function noteKinds(jev: Record<string, JevRecord> = getState().jev, set: Set = getState().local.noteKinds): Record<string, NoteKind> {
  if (known?.jev !== jev || known.set !== set) known = { jev, set, kinds: { ...labelKinds(jev), ...set } };
  return known.kinds;
}
/** The same, for a view: it shows again when the model answers or the parent changes a kind. */
export const useNoteKinds = () => useApp((s) => noteKinds(s.jev, s.local.noteKinds));

/** Who said what kind a label is: the parent, the AI, or the label's words. */
export function noteKindFrom(label: string, jev: Record<string, JevRecord>, set: Set): "parent" | "ai" | "words" {
  return set?.[label] ? "parent" : labelKinds(jev)[label] ? "ai" : "words";
}

export function noteKind(note: Pick<LessonNote, "typeLabel" | "typeClass">, kinds: Record<string, NoteKind> = noteKinds()): NoteKind {
  if (isUnexplained(note)) return "explain";
  const asked = kinds[note.typeLabel];
  if (asked) return asked;
  const label = `${note.typeLabel} ${note.typeClass}`;
  return RULES.find(([, re]) => re.test(label))?.[0] ?? "other";
}

/** Each kind's name (English key, shown through t()). */
export const NOTE_KIND_LABEL: Record<NoteKind, string> = {
  explain: "To explain",
  absence: "Absences",
  late: "Late",
  forgot: "Forgot things",
  remark: "Remarks",
  praise: "Praise",
  other: "Other",
};
