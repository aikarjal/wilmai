/*
 * Writing to the school in your own language: what the parent wrote, translated into Finnish for Wilma, with a
 * translation back so they can check what the Finnish says. It goes with the AI service chosen (OpenAI or Claude),
 * always with its accurate translator: these words go to a teacher in the parent's name. Nothing is sent from here;
 * the composers (NewMessage.tsx, Reader.tsx) send the Finnish only after the parent has seen it and confirmed.
 */
import type { Settings } from "../data/model";
import { getState } from "../data/store";
import { respond } from "../luna/client";
import { translationAvailable, translatorsOf } from "./translate";

/** A message's Finnish, and what it was made from (`of`): changed words need translating again. */
export interface Outgoing {
  subject: string;
  text: string;
  /** The Finnish translated back into the parent's language, to check the meaning. */
  back: string;
  of: string;
}

/** Translating what the parent writes needs a cloud AI, and an app that isn't in Finnish already. */
export const outgoingAvailable = (s: Settings, appLanguage: string) => translationAvailable(s) && appLanguage !== "fi";

/** What the Finnish is a translation of: the subject (none for a reply) and the text. */
export const sourceOf = (subject: string | null, text: string) => JSON.stringify([subject ?? "", text.trim()]);

/** The Finnish when it's of these words now, and has words in it (else null: translate again before sending). */
export const currentOutgoing = (o: Outgoing | null, subject: string | null, text: string): Outgoing | null =>
  o && o.of === sourceOf(subject, text) && o.text.trim() && (subject === null || o.subject.trim()) ? o : null;

/** A stored Finnish version, or null when there's none or it isn't one. */
export function readOutgoing(raw: unknown): Outgoing | null {
  const o = typeof raw === "string" ? (() => { try { return JSON.parse(raw) as unknown; } catch { return null; } })() : raw;
  if (!o || typeof o !== "object") return null;
  const { subject, text, back, of } = o as Record<string, unknown>;
  return typeof subject === "string" && typeof text === "string" && typeof back === "string" && typeof of === "string" ? { subject, text, back, of } : null;
}

const LANGUAGE_NAMES: Record<string, string> = { en: "English", sv: "Swedish" };

const instructions = (back: string) =>
  [
    "You translate what a parent writes to their child's school in Finland, through Wilma (a message or an answer to a teacher or other staff), into Finnish.",
    "The input is JSON: a subject (empty for an answer in a thread) and the text.",
    "Write natural, polite Finnish, as a Finnish parent writes to a teacher: friendly and plain, not stiff. Keep the parent's tone; Finnish parents and teachers usually say sinä to each other, so use it unless the parent is formal.",
    "Keep the meaning and every detail. Add nothing and leave nothing out: no greeting or signature the parent didn't write.",
    "Keep the line breaks and paragraphs. Keep people's names, class and group names (7G, 3B), course codes, numbers and links exactly as written.",
    "Write days, dates and times the Finnish way (pe 30.10. klo 14.15) when the parent names them.",
    "In subject, the subject in Finnish (empty when there's none). In text, the text in Finnish.",
    `In back, your Finnish text translated back into ${back}, faithfully, so the parent can check what it says.`,
  ].join("\n");

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "text", "back"],
  properties: { subject: { type: "string" }, text: { type: "string" }, back: { type: "string" } },
};

/** The parent's words in Finnish, with the translation back into `appLanguage` ("en", "sv"). */
export async function toFinnish(subject: string | null, text: string, appLanguage: string): Promise<Outgoing> {
  const answer = await respond<{ subject: string; text: string; back: string }>({
    name: "outgoing",
    instructions: instructions(LANGUAGE_NAMES[appLanguage] ?? "English"),
    input: JSON.stringify({ subject: subject ?? "", text }),
    schema: SCHEMA,
    effort: "low",
    model: translatorsOf(getState().settings)[0].model,
  });
  if (!answer.text.trim()) throw new Error("The translation came back empty.");
  return { subject: subject === null ? "" : answer.subject, text: answer.text, back: answer.back, of: sourceOf(subject, text) };
}
