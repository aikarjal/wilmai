/*
 * Translating messages, bulletins and teachers' notes into the language chosen in Settings, with OpenAI and the
 * parent's key: GPT-6.1 Sol or GPT-6 Luna as chosen, each at its least reasoning (which bills as output). Not with local
 * AI: its small model translates the languages offered poorly. What's translated, when, and where it's kept:
 * data/translations.ts; this is the call, and what decides what an item's translation is.
 */
import { intelligenceOn, intelligenceProvider, type ItemTranslation, type Settings, type Snapshot, type TranslationLanguage } from "../data/model";
import type { FeedItem } from "../data/feed";
import { getState } from "../data/store";
import { hash } from "../data/hash";
import { respond } from "../luna/client";

/** The languages offered, each named in itself. */
export const TRANSLATION_LANGUAGES: Record<TranslationLanguage, string> = { fi: "Suomi", sv: "Svenska", en: "English", uk: "Українська", ar: "العربية" };
const IN_ENGLISH: Record<TranslationLanguage, string> = { fi: "Finnish", sv: "Swedish", en: "English", uk: "Ukrainian", ar: "Arabic" };

/**
 * The two OpenAI translators offered, with what a message's translation costs at OpenAI's list prices, rounded up
 * (evals/translate.ts, 26 Oct 2026: made-up messages, bulletins and threads, Finnish and Swedish into the other four;
 * Sol $0.0024 on average and $0.0039 at most, all 180 checks; Luna $0.0001 and $0.0002, and a Swedish bulletin came
 * back untranslated into Finnish). Sol is the default: Luna's slip is caught (below), but Sol doesn't need catching.
 */
export const TRANSLATORS = [
  { model: "gpt-6.1-sol", label: "Most accurate", help: "Careful with long and tricky messages.", perMessage: 0.003 },
  { model: "gpt-6-luna", label: "Fast", help: "Good for everyday messages. If it can't translate one, Most accurate does.", perMessage: 0.0001 },
] as const;
export type Translator = (typeof TRANSLATORS)[number]["model"];
export const DEFAULT_TRANSLATOR: Translator = "gpt-6.1-sol";
/** The least reasoning a model takes: Sol's least is low (26 Oct 2026), Luna's none. */
const leastEffort = (model: string) => (model === "gpt-6-luna" ? "none" : "low") as "none" | "low";

/** Translation comes with OpenAI. */
export const translationAvailable = (s: Settings) => intelligenceProvider(s) === "openai" && intelligenceOn(s);

/** The sample family comes translated into English, so that needs no AI (demo/translations.ts). */
const sampleFamilyTranslated = (s: Settings) => getState().snapshot?.account.via === "demo" && s.translateTo === "en";

/** What everything is translated into: null when translation is off (until a language is chosen), or OpenAI isn't the AI. */
export function translationTarget(s: Settings): TranslationLanguage | null {
  if (sampleFamilyTranslated(s)) return "en";
  if (!translationAvailable(s) || !s.translateTo || s.translateTo === "off") return null;
  return s.translateTo;
}

export const translationModel = (s: Settings): string => s.translateModel ?? DEFAULT_TRANSLATOR;

/*
 * The language a text is most likely in, from its letters and its most common words: enough to leave alone what's
 * already in the parent's language. null when it can't tell (it's translated then).
 */
const COMMON: Partial<Record<TranslationLanguage, string[]>> = {
  fi: ["ja", "on", "ei", "että", "klo", "hei", "kiitos", "tai", "myös", "ovat", "voi", "kun", "olla", "koulu", "huomenna", "tänään", "oppilaat", "terveisin"],
  sv: ["och", "att", "det", "är", "på", "för", "med", "som", "inte", "hej", "vi", "till", "av", "har", "kan", "skolan", "eleverna", "tack", "hälsningar"],
  en: ["the", "and", "is", "to", "of", "for", "with", "you", "are", "we", "please", "thank", "school", "will", "your", "this"],
};

export function guessLanguage(text: string): TranslationLanguage | "other" | null {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length < 12) return null;
  const share = (re: RegExp) => letters.filter((c) => re.test(c)).length / letters.length;
  if (share(/\p{Script=Arabic}/u) > 0.3) return "ar";
  if (share(/\p{Script=Cyrillic}/u) > 0.3) return /[іїєґ]/iu.test(text) ? "uk" : "other";
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const scores = (Object.entries(COMMON) as [TranslationLanguage, string[]][])
    .map(([lang, common]) => [lang, words.filter((w) => common.includes(w)).length] as const)
    .sort((a, b) => b[1] - a[1]);
  const [best, second] = scores;
  return best[1] >= 3 && best[1] >= 2 * second[1] ? best[0] : null;
}

/**
 * What an item's translation covers: its title, its text (a thread's messages, in order; none for a message not yet
 * opened from Wilma), and the school's sentence on what to do (the AI's quote, shown in the lists).
 */
export interface TranslationSource {
  title: string;
  texts: string[];
  action: string | null;
}

export function translationSource(item: FeedItem, snap: Snapshot): TranslationSource {
  const thread = item.kind === "message" && item.id ? snap.messages[item.id]?.thread : null;
  const texts = thread?.replies.length ? [thread.content, ...thread.replies.map((r) => r.content)] : item.text ? [item.text] : [];
  return { title: item.kind === "note" && item.note ? item.note.typeLabel : item.title, texts, action: item.actionLine };
}

export const sourceHash = (source: TranslationSource) => hash([source.title, source.texts, source.action]);

/** Whether an item needs translating into `language`: it has words, and they aren't already in it (when that can be told). */
export const needsTranslation = (source: TranslationSource, language: TranslationLanguage) =>
  Boolean(source.title.trim() || source.texts.length) && guessLanguage([source.title, ...source.texts].join("\n")) !== language;

/** The item's translation when it's into `language` and of what the item says now (else null). */
export function currentTranslation(tr: ItemTranslation | undefined, source: TranslationSource, language: TranslationLanguage | null): ItemTranslation | null {
  return tr && !tr.error && language && tr.language === language && tr.hash === sourceHash(source) ? tr : null;
}

const instructions = (language: TranslationLanguage) =>
  [
    `You translate what a Finnish school sent through Wilma (a message, a bulletin or a teacher's note) into ${IN_ENGLISH[language]}, for a parent or a pupil.`,
    `The input is JSON: a title and texts. Translate the title, and each text in order, into one translation per text, so there are as many translations as texts.`,
    `Keep the meaning, the tone and every detail. Add nothing, explain nothing and leave nothing out.`,
    `Keep the line breaks, paragraphs, lists and links as they are.`,
    `Keep people's names, signatures, class and group names (7G, 3B), course codes, numbers, times, amounts and addresses exactly as written.`,
    `Translate weekday and month names, and keep dates' numbers as written (pe 30.10. becomes the weekday in ${IN_ENGLISH[language]} and 30.10.).`,
    `When the text names something the reader may need to find in Wilma or at school, such as a form, a page or a course, give the original word in brackets after its translation, the first time only.`,
    `In "from", give the ISO 639-1 code of the language the texts are written in (fi, sv, en…).`,
  ].join("\n");

const ALPHABET: Partial<Record<TranslationLanguage, RegExp>> = { uk: /\p{Script=Cyrillic}/gu, ar: /\p{Script=Arabic}/gu };

/**
 * The answer is still the original: every text unchanged, or into Ukrainian or Arabic mostly not in that alphabet
 * (names, codes and links stay in theirs), or still in the original language when that can be told. A title alone
 * (a message not yet opened) can be a name or a code that stays as it is.
 */
function untranslated(texts: string[], answer: string[], language: TranslationLanguage): boolean {
  if (!texts.length) return false;
  if (answer.every((text, i) => text.trim() === texts[i]?.trim())) return true;
  const all = answer.join("\n");
  const alphabet = ALPHABET[language];
  if (alphabet) return (all.match(alphabet) ?? []).length <= (all.match(/\p{L}/gu) ?? []).length / 2;
  const before = guessLanguage(texts.join("\n")), after = guessLanguage(all);
  return after !== null && after !== "other" && after !== language && after === before;
}

/**
 * Messages, bulletins and notes that come in a month (not the family's own messages), from the last 90 days, or from as
 * far back as the app has them when that's less, but at least a month: what a month's translations would cost.
 */
export function itemsPerMonth(items: { at: Date; own?: boolean }[], now = Date.now()): number {
  const day = 86_400_000;
  const theirs = items.filter((i) => !i.own && i.at.getTime() <= now);
  const recent = theirs.filter((i) => i.at.getTime() >= now - 90 * day);
  if (!recent.length) return 0;
  const earliest = Math.min(...theirs.map((i) => i.at.getTime()));
  const days = Math.min(90, Math.max(30, (now - earliest) / day));
  return (recent.length / days) * 30.4;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["from", "title", "texts"],
  properties: {
    from: { type: "string" },
    title: { type: "string" },
    texts: { type: "array", items: { type: "string" } },
  },
};

/** A translation, before it's kept with its item. */
export type Translation = Pick<ItemTranslation, "language" | "model" | "from" | "title" | "texts">;

/**
 * Translate a title and its texts. A Luna answer still in the original language goes to Sol once; Sol's, an error.
 * `options` is for the eval suite, which compares models and efforts (evals/translate.ts).
 */
export async function translate(
  title: string,
  texts: string[],
  language: TranslationLanguage,
  options: { model?: string; effort?: "none" | "low" | "medium" } = {}
): Promise<Translation> {
  const model = options.model ?? translationModel(getState().settings);
  const answer = await respond<{ from: string; title: string; texts: string[] }>({
    name: "translation",
    instructions: instructions(language),
    input: JSON.stringify({ title, texts }),
    schema: SCHEMA,
    effort: options.effort ?? leastEffort(model),
    model,
  });
  if (answer.texts.length !== texts.length) throw new Error(`The translation came back with ${answer.texts.length} texts for ${texts.length}.`);
  if (untranslated(texts, answer.texts, language)) {
    if (model !== "gpt-6.1-sol") return translate(title, texts, language, { model: "gpt-6.1-sol" });
    throw new Error("It came back in the original language.");
  }
  return { language, model, from: answer.from, title: answer.title, texts: answer.texts };
}
