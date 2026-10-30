import { setNow } from "./shim.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../src/data/model.ts";
import { setState } from "../src/data/store.ts";
import { currentOutgoing, outgoingAvailable, readOutgoing, sourceOf, toFinnish } from "../src/ai/outgoing.ts";
import { openDraft, readDrafts, saveDraft, writeDrafts } from "../src/data/drafts.ts";
import { overrideBridge } from "../src/wilma/transport.ts";

// Writing to the school in your own language: the Finnish is what's sent, and only while it's of the words as they are.
const claude = { ...DEFAULT_SETTINGS, aiProvider: "anthropic" as const, anthropicKey: "sk-ant-synthetic" };
const openai = { ...DEFAULT_SETTINGS, aiProvider: "openai" as const, openaiKey: "sk-synthetic" };

test("it's offered with a cloud AI in an app that isn't in Finnish", () => {
  assert.equal(outgoingAvailable(claude, "en"), true);
  assert.equal(outgoingAvailable(openai, "sv"), true);
  assert.equal(outgoingAvailable(claude, "fi"), false, "nothing to translate");
  assert.equal(outgoingAvailable({ ...DEFAULT_SETTINGS, aiProvider: "local" }, "en"), false);
  assert.equal(outgoingAvailable(DEFAULT_SETTINGS, "en"), false);
});

test("the Finnish counts only for the words it was made from", () => {
  const fi = { subject: "Poissaolo", text: "Aino on huomenna poissa.", back: "Aino is away tomorrow.", of: sourceOf("Absence", "Aino is away tomorrow.") };
  assert.equal(currentOutgoing(fi, "Absence", "Aino is away tomorrow.  "), fi, "trailing space doesn't matter");
  assert.equal(currentOutgoing(fi, "Absence", "Aino is away on Friday."), null, "changed words: translate again");
  assert.equal(currentOutgoing({ ...fi, text: " " }, "Absence", "Aino is away tomorrow."), null, "emptied Finnish isn't sent");
  assert.equal(currentOutgoing({ ...fi, subject: "" }, "Absence", "Aino is away tomorrow."), null, "a new message needs its subject");
  const reply = { ...fi, subject: "", of: sourceOf(null, "Thank you!") };
  assert.equal(currentOutgoing(reply, null, "Thank you!"), reply, "an answer has no subject of its own");
  assert.equal(readOutgoing(JSON.stringify(fi))?.text, fi.text);
  assert.equal(readOutgoing("{oops"), null);
  assert.equal(readOutgoing({ subject: 1 }), null);
});

test("a new message's draft keeps its Finnish, and opens with it", () => {
  const finnish = { subject: "Retki", text: "Pääseekö Aino retkelle?", back: "Can Aino go on the trip?", of: sourceOf("Trip", "Can Aino come on the trip?") };
  const drafts = readDrafts(writeDrafts(saveDraft({}, "r_teacher=1", { subject: "Trip", text: "Can Aino come on the trip?", finnish }, null)));
  assert.deepEqual(openDraft(drafts, "r_teacher=1", null, false).words.finnish, finnish);
  // No Finnish, none kept.
  assert.ok(!("finnish" in saveDraft({}, "r_teacher=2", { subject: "x", text: "y" }, null)["r_teacher=2"]));
});

test("the Finnish comes from the chosen AI's accurate translator, with a translation back", async () => {
  setNow(Date.parse("2026-10-21T08:00:00Z"));
  setState({ settings: { ...claude, translateModel: "claude-haiku-5-5" }, usage: {}, openaiBlocked: null });
  let body: Record<string, any> = {};
  overrideBridge(async (_path, init) => {
    body = init.body as Record<string, any>;
    return {
      status: 200,
      retryAfter: null,
      fromAnthropic: true,
      body: JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ subject: "ignored", text: "Kiitos!", back: "Thank you!" }) }], stop_reason: "end_turn", usage: {} }),
    };
  });
  try {
    const fi = await toFinnish(null, "Thanks!", "en");
    assert.equal(body.model, "claude-sonnet-5-5", "never the fast one: it goes to a teacher in the parent's name");
    assert.match(body.system[0].text, /into Finnish/);
    assert.match(body.system[0].text, /back into English/);
    assert.deepEqual(fi, { subject: "", text: "Kiitos!", back: "Thank you!", of: sourceOf(null, "Thanks!") });
  } finally {
    overrideBridge(null);
  }
});
