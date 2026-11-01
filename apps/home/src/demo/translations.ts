/*
 * The sample family comes translated into English (Settings → Translating messages), without AI: its English is
 * written with it (demo.ts). Its messages, bulletins and notes get their translations kept as an AI's would be
 * (data/translations.ts), and its short texts (subjects, notes' labels, homework) come as phrases (data/phrases.ts),
 * so the app shows them in the same places and the same way. English only: in any other language the sample family
 * shows as it is.
 */
import type { AppState } from "../data/store";
import type { ItemTranslation, TranslationLanguage } from "../data/model";
import { buildFeed } from "../data/feed";
import { sampleFamilyTranslated, sourceHash, translationSource } from "../ai/translate";
import { demoEnglish } from "./demo";

const LANGUAGE: TranslationLanguage = "en";

/** The sample family's items in English, by item key (those whose every text has its English). */
export function demoTranslations(state: AppState): Record<string, ItemTranslation> {
  if (!state.snapshot || !sampleFamilyTranslated(state.settings)) return {};
  const english = demoEnglish();
  const out: Record<string, ItemTranslation> = {};
  for (const item of buildFeed(state)) {
    const source = translationSource(item, state.snapshot);
    const title = english.get(source.title);
    const texts = source.texts.map((text) => english.get(text));
    if (title === undefined || texts.some((text) => text === undefined)) continue;
    const action = source.action ? english.get(source.action) ?? null : null;
    out[item.key] = { hash: sourceHash(source), language: LANGUAGE, model: "", from: "fi", title, texts: texts as string[], action, at: Date.now() };
  }
  return out;
}

/**
 * One of the sample family's short texts in `language` (undefined when it has none in that language), also when it's
 * inside the app's own words ("Sign up: {title}"), where the AI would translate the whole line.
 */
export function demoPhrase(language: TranslationLanguage, text: string): string | undefined {
  if (language !== LANGUAGE) return undefined;
  const english = demoEnglish();
  const whole = english.get(text);
  if (whole !== undefined) return whole;
  let inside = "";
  for (const finnish of english.keys()) if (finnish.length > inside.length && finnish.length >= 8 && text.includes(finnish)) inside = finnish;
  return inside ? text.replace(inside, english.get(inside)!) : undefined;
}
