/*
 * Writing to the school in Finnish or Swedish, Finland's official languages: what the parent writes is translated
 * before it's sent, with a translation back into the language they wrote in, so they can check what it says. It's
 * chosen in Settings (the AI card, "Writing to the school"), goes with OpenAI, and always with its most accurate
 * translator: these words go to a teacher in the parent's name. Nothing is sent from here and nothing is hidden: the
 * composers show the translation beside the parent's words and send exactly what they show (ui/Outgoing.tsx).
 *
 * The counterpart of translating what comes in (ai/translate.ts). After rockaholiciam's idea in pull request #22.
 */
import type { Settings } from "../data/model";
import { respond } from "../luna/client";
import { guessLanguage, translationAvailable } from "./translate";

export type WriteLanguage = "fi" | "sv";
/** The languages offered, each named in itself. */
export const WRITE_LANGUAGES: Record<WriteLanguage, string> = { fi: "Suomi", sv: "Svenska" };
const IN_ENGLISH: Record<WriteLanguage, string> = { fi: "Finnish", sv: "Swedish" };
/** How each writes a day and a time, as schools there do. */
const DATES: Record<WriteLanguage, string> = { fi: "pe 30.10. klo 14.15", sv: "fre 30.10 kl. 14.15" };

/** The most accurate translator (ai/translate.ts TRANSLATORS), whatever translates what comes in. */
export const OUTGOING_TRANSLATOR = "gpt-6.1-sol";
/** About what translating one message costs with it, rounded up. */
export const OUTGOING_PER_MESSAGE = 0.003;

/** The language what the parent writes goes to the school in: null when that's off, or OpenAI isn't the AI. */
export function writeLanguage(s: Settings): WriteLanguage | null {
  if (!translationAvailable(s) || !s.writeIn || s.writeIn === "off") return null;
  return s.writeIn;
}

/** A message's translation, and the words it was made from (`of`): changed words mean translating again. */
export interface Outgoing {
  language: WriteLanguage;
  /** The subject translated ("" for an answer, which has none). */
  subject: string;
  text: string;
  /** The translation translated back into the language the parent wrote in, to check what it says. */
  back: string;
  of: string;
}

/** What a translation is of: the subject (null for an answer) and the text. */
export const wordsOf = (subject: string | null, text: string) => JSON.stringify([subject === null ? null : subject.trim(), text.trim()]);

/** The translation when it's of these words now; else null (translate again before sending). */
export const currentOutgoing = (o: Outgoing | null, subject: string | null, text: string): Outgoing | null => (o && o.of === wordsOf(subject, text) ? o : null);

/** The parent already wrote in the language it goes in, as far as can be told: nothing to translate. */
export const writtenIn = (language: WriteLanguage, subject: string | null, text: string) => guessLanguage(`${subject ?? ""}\n${text}`) === language;

const instructions = (language: WriteLanguage) =>
  [
    `You translate what a parent writes to their child's school in Finland through Wilma (a new message, or an answer to a teacher or other staff) into ${IN_ENGLISH[language]}.`,
    `The input is JSON: a subject (empty for an answer in a thread) and the text.`,
    `Write natural, polite ${IN_ENGLISH[language]}, as a parent writes to a teacher: friendly and plain, not stiff. Keep the parent's tone and the way they address the reader.`,
    `Keep the meaning and every detail. Add nothing and leave nothing out: no greeting or signature the parent didn't write.`,
    `Keep the line breaks and paragraphs. Keep people's names, class and group names (7G, 3B), course codes, numbers and links exactly as written.`,
    `Write days, dates and times as schools in Finland write them in ${IN_ENGLISH[language]} (${DATES[language]}).`,
    `In "subject", the subject in ${IN_ENGLISH[language]} (empty when there's none). In "text", the text in ${IN_ENGLISH[language]}.`,
    `In "back", your ${IN_ENGLISH[language]} text translated back into the language the parent wrote in, faithfully, so they can check what it says.`,
  ].join("\n");

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "text", "back"],
  properties: { subject: { type: "string" }, text: { type: "string" }, back: { type: "string" } },
};

/** What the parent wrote (`subject` null for an answer), translated into `language`, with the translation back. */
export async function translateOutgoing(language: WriteLanguage, subject: string | null, text: string): Promise<Outgoing> {
  const answer = await respond<{ subject: string; text: string; back: string }>({
    name: "outgoing",
    instructions: instructions(language),
    input: JSON.stringify({ subject: subject ?? "", text }),
    schema: SCHEMA,
    effort: "low",
    model: OUTGOING_TRANSLATOR,
  });
  if (!answer.text.trim() || (subject !== null && subject.trim() && !answer.subject.trim())) throw new Error("The translation came back empty.");
  return { language, subject: subject === null ? "" : answer.subject.trim(), text: answer.text, back: answer.back, of: wordsOf(subject, text) };
}
