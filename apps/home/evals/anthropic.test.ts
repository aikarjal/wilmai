import { setNow } from "./shim.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, cloudOf, intelligenceOn, intelligenceProvider } from "../src/data/model.ts";
import { getState, setState, updateSettings } from "../src/data/store.ts";
import { LunaError, costOf, decide, openAIPaused, openAIReady, readingModel, respond, thisMonth } from "../src/luna/client.ts";
import { providerIdentity } from "../src/ai/config.ts";
import { translationModel, translationTarget } from "../src/ai/translate.ts";
import { overrideBridge } from "../src/wilma/transport.ts";

// Claude as the app's AI: the parent chooses OpenAI or Claude, one at a time, and everything above the client reads
// Claude's answers in the shapes OpenAI's come in.
const start = Date.parse("2026-10-21T08:00:00Z");
const claude = { ...DEFAULT_SETTINGS, aiProvider: "anthropic" as const, anthropicKey: "sk-ant-synthetic-test-key" };

function setup(settings = claude) {
  setNow(start);
  setState({ settings, usage: {}, openaiBlocked: null });
}

/** A Messages API answer with `json` as its text. */
const reply = (json: unknown, extra: Record<string, unknown> = {}) => ({
  status: 200,
  retryAfter: null,
  fromAnthropic: true,
  body: JSON.stringify({
    content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify(json) }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1000, cache_read_input_tokens: 500, output_tokens: 200 },
    ...extra,
  }),
});

test("Claude is a choice of its own, on with its own key", () => {
  assert.equal(intelligenceProvider(claude), "anthropic");
  assert.equal(intelligenceOn(claude), true);
  assert.equal(intelligenceOn({ ...claude, anthropicKey: "" }), false, "no key, no AI");
  // An OpenAI key kept from before doesn't turn Claude on, and isn't what's sent.
  assert.equal(intelligenceOn({ ...claude, anthropicKey: "", openaiKey: "sk-openai" }), false);
  assert.deepEqual(cloudOf({ ...claude, openaiKey: "sk-openai" }), { provider: "anthropic", key: "sk-ant-synthetic-test-key" });
  assert.deepEqual(cloudOf({ ...DEFAULT_SETTINGS, openaiKey: "sk-openai" }), { provider: "openai", key: "sk-openai" });
  assert.equal(cloudOf({ ...DEFAULT_SETTINGS, aiProvider: "local" }), null);
});

test("OpenAI's and local AI's cache identity is as before; Claude's is its own", () => {
  const openai = { ...DEFAULT_SETTINGS, aiProvider: "openai" as const, openaiKey: "k" };
  assert.ok(!providerIdentity(openai).includes("provider"), "earlier answers aren't read again");
  assert.notEqual(providerIdentity(claude), providerIdentity(openai));
});

test("Claude's questions go to Haiku in one Messages call, answered in the Decisions shape", async () => {
  setup();
  const sent: { path: string; key?: string; body: Record<string, any> }[] = [];
  overrideBridge(async (path, init) => {
    sent.push({ path, key: init.headers?.["x-anthropic-key"], body: init.body as Record<string, any> });
    return reply({ needed: { probability: 1.4 }, kind: { probabilities: { general: 1, event: 3 } }, level: { probabilities: { "0": 0, "1": 0, "2": 0 } } });
  });
  try {
    const answers = await decide("Huomenna on retki.", [
      { type: "predicate", name: "needed", instructions: "Does this need a response?" },
      { type: "choice", name: "kind", instructions: "What kind?", choices: [{ value: "general", description: "general" }, { value: "event", description: "an event" }] },
      { type: "score", name: "level", instructions: "How urgent?", levels: ["low", "mid", "high"].map((d, i) => ({ label: String(i), description: d })) },
    ]);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].path, "anthropic");
    assert.equal(sent[0].key, "sk-ant-synthetic-test-key");
    assert.equal(sent[0].body.model, "claude-haiku-5-5");
    assert.equal(sent[0].body.output_config.format.type, "json_schema");
    assert.deepEqual(sent[0].body.output_config.format.schema.required, ["needed", "kind", "level"]);
    assert.equal(sent[0].body.messages[0].content, "Huomenna on retki.");
    assert.ok(!("temperature" in sent[0].body), "no sampling parameters on API version 2026-10-21");
    assert.deepEqual(answers.needed, { type: "predicate", name: "needed", probability: 1 }, "kept between 0 and 1");
    assert.equal(answers.kind.type === "choice" && answers.kind.choice, "event");
    assert.equal(answers.kind.type === "choice" && answers.kind.confidence, 0.75, "the probabilities add up to 1");
    // No probabilities given: all alike, and the first (neutral) level wins the tie.
    assert.equal(answers.level.type === "score" && answers.level.score, 0);
    // Tokens count under Haiku, at its list prices: (1500 - 500) × $0.10 + 500 × $0.01 + 200 × $0.50, per million.
    const month = getState().usage[thisMonth()];
    assert.equal(month.decisions.calls, 1);
    assert.equal(month.reading?.["claude-haiku-5-5"].input, 1500);
    assert.ok(Math.abs(costOf(month) - (1000 * 0.1 + 500 * 0.01 + 200 * 0.5) / 1e6) < 1e-12);
  } finally {
    overrideBridge(null);
  }
});

test("Claude reads with Sonnet and answers in the schema; a refusal isn't an answer", async () => {
  setup();
  assert.equal(readingModel(), "claude-sonnet-5-5", "the saved OpenAI reading model doesn't count with Claude");
  let body: Record<string, any> = {};
  overrideBridge(async (_path, init) => {
    body = init.body as Record<string, any>;
    return reply({ events: [] });
  });
  try {
    const schema = { type: "object", additionalProperties: false, required: ["events"], properties: { events: { type: "array", items: { type: "string" } } } };
    assert.deepEqual(await respond({ name: "reading", instructions: "Read it.", input: "Retki pe 30.10.", schema, effort: "none" }), { events: [] });
    assert.equal(body.model, "claude-sonnet-5-5");
    assert.equal(body.output_config.effort, "low", "Claude's least effort is low");
    assert.deepEqual(body.output_config.format.schema, schema);
    assert.equal(body.system[0].text, "Read it.");
    // An OpenAI model asked for by name reads with Claude's own instead.
    await respond({ name: "reading", instructions: "Read it.", input: "x", schema, model: "gpt-6.1-sol" });
    assert.equal(body.model, "claude-sonnet-5-5");

    overrideBridge(async () => reply({}, { stop_reason: "refusal", stop_details: { explanation: "Not this one." } }));
    await assert.rejects(respond({ name: "reading", instructions: "Read it.", input: "x", schema }), (err) => err instanceof LunaError && !err.retryable && /Not this one/.test(err.message));
  } finally {
    overrideBridge(null);
  }
});

test("a key Anthropic refuses stops at once, with Anthropic's name", async () => {
  setup();
  overrideBridge(async () => ({ status: 401, retryAfter: null, fromAnthropic: true, body: JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }) }));
  try {
    await assert.rejects(decide("Hei", [{ type: "predicate", name: "x", instructions: "?" }]), (err) => err instanceof LunaError && !err.retryable && /Anthropic/.test(err.message));
  } finally {
    overrideBridge(null);
  }
});

test("a network that blocks Anthropic pauses Claude, and the check after asks Anthropic", async () => {
  setup();
  const paths: string[] = [];
  overrideBridge(async (path) => {
    paths.push(path);
    if (path === "anthropic-reach") return { reachable: true, reason: null, detail: null };
    return { status: 200, retryAfter: null, fromAnthropic: false, body: "<html>Blocked</html>" };
  });
  try {
    await assert.rejects(decide("Hei", [{ type: "predicate", name: "x", instructions: "?" }]), (err) => err instanceof LunaError && /Claude can't be reached/.test(err.message));
    assert.equal(openAIPaused(), true);
    setNow(start + 6 * 60_000);
    assert.equal(await openAIReady(), true);
    assert.deepEqual(paths, ["anthropic", "anthropic-reach"]);
  } finally {
    overrideBridge(null);
  }
});

test("translation comes with Claude too, with Claude's translators", () => {
  assert.equal(translationTarget({ ...claude, translateTo: "en" }), "en");
  assert.equal(translationModel(claude), "claude-sonnet-5-5");
  assert.equal(translationModel({ ...claude, translateModel: "claude-haiku-5-5" }), "claude-haiku-5-5");
  // A translator chosen with OpenAI before isn't sent to Anthropic.
  assert.equal(translationModel({ ...claude, translateModel: "gpt-6-luna" }), "claude-sonnet-5-5");
  assert.equal(translationModel({ ...DEFAULT_SETTINGS, openaiKey: "k" }), "gpt-6.1-sol");
});

test("the Anthropic key is kept scrambled apart from the settings, and goes when turned off", () => {
  updateSettings({ aiProvider: "anthropic", anthropicKey: "sk-ant-fictional" });
  assert.ok(!(localStorage.getItem("wilmai.settings") ?? "").includes("sk-ant-fictional"));
  const kept = localStorage.getItem("wilmai.anthropicKey") ?? "";
  assert.ok(kept && !kept.includes("sk-ant-fictional"), "scrambled");
  updateSettings({ aiProvider: "off", anthropicKey: "" });
  assert.equal(localStorage.getItem("wilmai.anthropicKey"), null);
});
