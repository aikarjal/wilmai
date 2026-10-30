/*
 * Claude as WilmAI Intelligence, with the parent's own Anthropic key: the same two jobs OpenAI does (luna/client.ts),
 * answered in the same shapes, so everything above them reads Claude's answers as it reads OpenAI's. This file only
 * builds the Messages API requests and reads the answers; luna/client.ts sends them, counts the tokens and keeps the
 * monthly limit.
 *  - Reading: Claude reads a text and answers in the JSON schema (structured outputs, `output_config.format`).
 *  - Decisions: Anthropic has no Decisions endpoint, so the typed questions become one JSON schema, each answered with
 *    the probabilities Claude gives. They're Claude's own estimates, not token probabilities as OpenAI's are; the
 *    thresholds that read them (feed.ts, "needs you" at 0.6) stay as they are.
 */
import type { ReadingUsage } from "../data/model";
import type { DecisionAnswer, DecisionQuestion } from "../luna/client";

/** Reads (and translates) the hard part: careful, and still a fraction of a cent an item. */
export const CLAUDE_READER = "claude-sonnet-5-5";
/** Answers the typed questions: fast and cheap, as many questions come with every item. */
export const CLAUDE_DECIDER = "claude-haiku-5-5";

/** Room for the answer and the thinking before it; answers here are a few hundred tokens. */
const MAX_TOKENS = 16_000;

/** Claude's least effort is low (OpenAI's "none" asks for no reasoning; Claude decides how much it needs). */
const effortOf = (effort: "none" | "low" | "medium" | "high") => (effort === "none" ? "low" : effort);

/** A Messages request that reads `input` and answers in `schema`. The instructions come first and are cached. */
export function readingRequest(opts: { instructions: string; input: string; schema: Record<string, unknown> }, model: string, effort: "none" | "low" | "medium" | "high") {
  return {
    model,
    max_tokens: MAX_TOKENS,
    system: [{ type: "text", text: opts.instructions, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: opts.input }],
    output_config: { effort: effortOf(effort), format: { type: "json_schema", schema: opts.schema } },
  };
}

export interface MessagesReply {
  content?: { type: string; text?: string }[];
  stop_reason?: string | null;
  stop_details?: { explanation?: string | null } | null;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
}

/** What a call used, in the app's terms: all input (cached included), the cached part, and the output (thinking included). */
export function usageOf(reply: MessagesReply): ReadingUsage {
  const u = reply.usage ?? {};
  const cached = u.cache_read_input_tokens ?? 0;
  return { calls: 1, input: (u.input_tokens ?? 0) + cached + (u.cache_creation_input_tokens ?? 0), cached, output: u.output_tokens ?? 0, reasoning: 0 };
}

/** The answer's text, or why there's none: Claude declined, or the answer was cut off. */
export function answerOf(reply: MessagesReply): { text: string } | { refusal: string } | { cut: true } {
  if (reply.stop_reason === "refusal") return { refusal: reply.stop_details?.explanation ?? "" };
  if (reply.stop_reason === "max_tokens") return { cut: true };
  return { text: (reply.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("") };
}

/*
 * Decisions. The questions go in the system prompt (a question set is the same for every item, so it's cached), the
 * item in the message. Each question is one property of the answer: a yes/no its probability of yes, a choice or a
 * level one probability per option.
 */
const DECISIONS_INSTRUCTIONS = [
  "You answer typed questions about one item from a Finnish school's Wilma (a message, a bulletin or a teacher's note), for the parent or pupil who received it.",
  "Answer every question with probabilities: how likely each answer is to be right, given only the text.",
  "For a yes/no question, give the probability that the answer is yes. For a choice or a level, give a probability for every option; together they add up to 1.",
  "Be calibrated: about 0.5 when the text doesn't tell, close to 0 or 1 only when it says so plainly.",
].join("\n");

function questionText(q: DecisionQuestion): string {
  if (q.type === "predicate") return `## ${q.name} (yes/no)\n${q.instructions}`;
  if (q.type === "choice") return `## ${q.name} (choose one)\n${q.instructions}\nOptions:\n${q.choices.map((c) => `- ${c.value}: ${c.description}`).join("\n")}`;
  return `## ${q.name} (a level)\n${q.instructions}\nLevels:\n${q.levels.map((l) => `- ${l.label}: ${l.description}`).join("\n")}`;
}

const options = (q: DecisionQuestion): string[] => (q.type === "choice" ? q.choices.map((c) => c.value) : q.type === "score" ? q.levels.map((l) => l.label) : []);

function questionSchema(q: DecisionQuestion): Record<string, unknown> {
  if (q.type === "predicate") return { type: "object", additionalProperties: false, required: ["probability"], properties: { probability: { type: "number" } } };
  const values = options(q);
  return {
    type: "object",
    additionalProperties: false,
    required: ["probabilities"],
    properties: { probabilities: { type: "object", additionalProperties: false, required: values, properties: Object.fromEntries(values.map((v) => [v, { type: "number" }])) } },
  };
}

/** A Messages request that answers `questions` about `input`. */
export function decisionsRequest(input: string, questions: DecisionQuestion[], model: string) {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: questions.map((q) => q.name),
    properties: Object.fromEntries(questions.map((q) => [q.name, questionSchema(q)])),
  };
  return {
    model,
    max_tokens: MAX_TOKENS,
    system: [{ type: "text", text: `${DECISIONS_INSTRUCTIONS}\n\n# Questions\n\n${questions.map(questionText).join("\n\n")}`, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: input }],
    output_config: { effort: "low", format: { type: "json_schema", schema } },
  };
}

const weight = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, n) : 0);
const clamp = (n: unknown) => Math.min(1, weight(n));

/** The options' probabilities, scaled to add up to 1 (all alike when Claude gave none). */
function spread(values: string[], given: Record<string, unknown> | undefined): { value: string; probability: number }[] {
  const raw = values.map((value) => ({ value, probability: weight(given?.[value]) }));
  const sum = raw.reduce((n, r) => n + r.probability, 0);
  return raw.map((r) => ({ value: r.value, probability: sum > 0 ? r.probability / sum : 1 / values.length }));
}

/** The most likely option; on a tie the first, which is the neutral one (the questions put it first). */
const likeliest = <T extends { probability: number }>(list: T[]): T => list.reduce((best, x) => (x.probability > best.probability ? x : best));

/** Claude's answer in the Decisions endpoint's shape; a refusal answers every question as refused. */
export function decisionsOf(reply: MessagesReply, questions: DecisionQuestion[]): DecisionAnswer[] {
  const answer = answerOf(reply);
  if ("refusal" in answer) return questions.map((q) => ({ type: "refusal", name: q.name }));
  if ("cut" in answer) throw new Error("The AI's answer was cut off.");
  const data = JSON.parse(answer.text) as Record<string, { probability?: unknown; probabilities?: Record<string, unknown> } | undefined>;
  return questions.map((q): DecisionAnswer => {
    const a = data[q.name];
    if (q.type === "predicate") return { type: "predicate", name: q.name, probability: clamp(a?.probability) };
    const probabilities = spread(options(q), a?.probabilities);
    const best = likeliest(probabilities);
    if (q.type === "choice") return { type: "choice", name: q.name, choice: best.value, probabilities, confidence: best.probability };
    return {
      type: "score",
      name: q.name,
      score: Number(best.value),
      probabilities: probabilities.map((p) => ({ value: Number(p.value), label: p.value, probability: p.probability })),
      confidence: best.probability,
    };
  });
}
