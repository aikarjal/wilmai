/*
 * Wilma's short texts on screen, in the language chosen for translations (Settings → Translating messages): subject
 * names, the labels and comments of teachers' notes, exam topics, homework, the titles of the dates the AI found.
 * Messages and bulletins are translated whole (data/translations.ts); these are asked for as they show, a batch at a
 * time, and kept by language and text, so each is paid for once. Until one comes, the original shows.
 */
import { useCallback } from "react";
import { getState, setState, useApp } from "./store";
import { hash } from "./hash";
import { guessLanguage, sampleFamilyTranslated, translationModel, translationTarget } from "../ai/translate";
import { LunaError, respond } from "../luna/client";
import type { TranslationLanguage } from "./model";
import { demoPhrase } from "../demo/translations";

const IN_ENGLISH: Record<TranslationLanguage, string> = { fi: "Finnish", sv: "Swedish", en: "English", uk: "Ukrainian", ar: "Arabic" };
/** A batch: up to this many texts, or about this many characters. */
const BATCH = 40;
const BATCH_CHARS = 6000;
/** Batches asked at once. */
const PARALLEL = 3;
/** After OpenAI refuses (the key, the monthly limit, no connection), asking again waits this long. */
const PAUSE_MS = 5 * 60_000;

export const phraseKey = (language: TranslationLanguage, text: string) => `${language}:${hash(text)}`;

const waiting = new Map<string, { language: TranslationLanguage; text: string }>();
/** Asked for, or failed, while the app is open: not asked again. */
const asked = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = 0;
let pausedUntil = 0;

/** Worth translating: it has words, and they aren't already in the language (when that can be told). */
const worth = (text: string, language: TranslationLanguage) => /\p{L}{2}/u.test(text) && guessLanguage(text) !== language;

function ask(language: TranslationLanguage, text: string) {
  const key = phraseKey(language, text);
  if (asked.has(key) || waiting.has(key) || !worth(text, language)) return;
  waiting.set(key, { language, text });
  timer ??= setTimeout(pump, 300);
}

/** Send what's waiting, a batch at a time, up to PARALLEL at once (the texts first asked for go first). */
function pump() {
  timer = null;
  while (inFlight < PARALLEL && waiting.size) {
    inFlight += 1;
    void send().finally(() => {
      inFlight -= 1;
      if (waiting.size) timer ??= setTimeout(pump, 0);
    });
  }
}

async function send() {
  const language = translationTarget(getState().settings);
  // The sample family's phrases come with it when there's no AI to ask (demo/translations.ts).
  if (!language || Date.now() < pausedUntil || sampleFamilyTranslated(getState().settings)) return waiting.clear();
  const batch: [string, string][] = [];
  let chars = 0;
  for (const [key, w] of waiting) {
    if (w.language !== language) {
      waiting.delete(key);
      continue;
    }
    if (batch.length >= BATCH || (batch.length && chars + w.text.length > BATCH_CHARS)) break;
    batch.push([key, w.text]);
    chars += w.text.length;
  }
  for (const [key] of batch) {
    waiting.delete(key);
    asked.add(key);
  }
  if (batch.length) {
    try {
      const answer = await respond<{ translations: string[] }>({
        name: "phrases",
        instructions: [
          `You translate short texts from a Finnish school's Wilma into ${IN_ENGLISH[language]}: subject and course names, the labels and comments on teachers' notes, exam topics, homework and the titles of school events.`,
          `The input is a JSON array of texts. Answer with one translation per text, in the same order, as many as there are texts.`,
          `Keep people's names, class and group names (7G, 3B), course codes, page and chapter numbers, times and dates exactly as written. Add nothing and explain nothing.`,
          `A text already in ${IN_ENGLISH[language]} stays as it is.`,
        ].join("\n"),
        input: JSON.stringify(batch.map(([, text]) => text)),
        schema: { type: "object", additionalProperties: false, required: ["translations"], properties: { translations: { type: "array", items: { type: "string" } } } },
        effort: translationModel(getState().settings) === "gpt-6-luna" ? "none" : "low",
        model: translationModel(getState().settings),
      });
      if (answer.translations.length === batch.length && translationTarget(getState().settings) === language) {
        setState((s) => ({ phrases: { ...s.phrases, ...Object.fromEntries(batch.map(([key], i) => [key, answer.translations[i]])) } }));
      }
    } catch (err) {
      // Refused or unreachable: wait a while; anything else leaves these in the original until the app opens again.
      if (err instanceof LunaError && !err.retryable) pausedUntil = Date.now() + PAUSE_MS;
    }
  }
}

/**
 * For showing Wilma's text: `w(text)` is its translation into the language chosen, when there's one (else the text,
 * and it's asked for). Not for people's names, rooms or codes.
 */
export function useWilma(): (text: string | null | undefined) => string {
  const language = useApp((s) => translationTarget(s.settings));
  const phrases = useApp((s) => s.phrases);
  const demo = useApp((s) => sampleFamilyTranslated(s.settings));
  return useCallback(
    (text) => {
      if (!text || !language) return text ?? "";
      if (demo) return demoPhrase(language, text) ?? text;
      const done = phrases[phraseKey(language, text)];
      if (done !== undefined) return done;
      ask(language, text);
      return text;
    },
    [language, phrases, demo]
  );
}
