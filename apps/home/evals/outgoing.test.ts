import { setNow } from "./shim.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { currentOutgoing, translateOutgoing, wordsOf, writeLanguage, writtenIn } from "../src/ai/outgoing.ts";
import { DEFAULT_SETTINGS } from "../src/data/model.ts";
import { setState } from "../src/data/store.ts";
import { overrideBridge } from "../src/wilma/transport.ts";

// Writing to the school in Finnish or Swedish: chosen with AI on, translated with the most accurate translator, and a
// translation only counts for the words it was made from. Made-up words, as a parent writes them.
const ai = { ...DEFAULT_SETTINGS, aiProvider: "openai" as const, openaiKey: "synthetic-outgoing-test-key" };

test("writing to the school goes in Finnish or Swedish only with OpenAI on, and once chosen", () => {
  assert.equal(writeLanguage(ai), null, "off until chosen");
  assert.equal(writeLanguage({ ...ai, writeIn: "fi" }), "fi");
  assert.equal(writeLanguage({ ...ai, writeIn: "sv" }), "sv");
  assert.equal(writeLanguage({ ...ai, writeIn: "off" }), null);
  assert.equal(writeLanguage({ ...DEFAULT_SETTINGS, writeIn: "fi" }), null, "no AI, no translation");
  assert.equal(writeLanguage({ ...DEFAULT_SETTINGS, aiProvider: "local", writeIn: "fi" }), null, "not with local AI");
});

test("what's already in the language goes as written", () => {
  assert.equal(writtenIn("fi", null, "Hei! Otso on huomenna pois koulusta, koska hän on lääkärissä. Terveisin Sanna"), true);
  assert.equal(writtenIn("fi", "Otso tomorrow", "Hi! Otso will be away from school tomorrow because he has a doctor's appointment."), false);
  assert.equal(writtenIn("sv", null, "Hej! Otso är borta från skolan i morgon, eftersom han ska till läkaren. Hälsningar"), true);
});

test("a message is translated with the most accurate translator, and the translation is of those words only", async () => {
  setNow(Date.parse("2026-11-01T12:00:00Z"));
  setState({ settings: { ...ai, writeIn: "fi" }, usage: {} });
  let sent: { model: string; instructions: string; input: string } | null = null;
  const answer = { subject: "Otson poissaolo huomenna", text: "Hei!\n\nOtso on huomenna pois, koska hänellä on lääkäriaika.", back: "Hi!\n\nOtso is away tomorrow because he has a doctor's appointment." };
  overrideBridge(async (_path, init) => {
    sent = init.body as typeof sent;
    return { status: 200, retryAfter: null, fromOpenai: true, body: JSON.stringify({ output: [{ content: [{ type: "output_text", text: JSON.stringify(answer) }] }], usage: { input_tokens: 400, output_tokens: 120 } }) };
  });
  try {
    const subject = "Otso tomorrow", text = "Hi!\n\nOtso will be away tomorrow because he has a doctor's appointment.";
    const o = await translateOutgoing("fi", subject, text);
    assert.equal(sent!.model, "gpt-6.1-sol", "the words go to a teacher: the most accurate translator");
    assert.match(sent!.instructions, /into Finnish/);
    assert.match(sent!.instructions, /no greeting or signature the parent didn't write/);
    assert.deepEqual(JSON.parse(sent!.input), { subject, text });
    assert.deepEqual({ subject: o.subject, text: o.text, back: o.back }, answer);
    assert.equal(currentOutgoing(o, subject, text), o, "of these words");
    assert.equal(currentOutgoing(o, subject, `${text} Thank you!`), null, "changed words: translate again");
    assert.equal(currentOutgoing(o, "Otso on Friday", text), null, "a changed subject too");
    assert.equal(currentOutgoing(o, ` ${subject} `, `${text}\n`), o, "spaces around them don't count");

    // An answer has no subject: none asked for, none given.
    const reply = await translateOutgoing("fi", null, text);
    assert.deepEqual(JSON.parse(sent!.input), { subject: "", text });
    assert.equal(reply.subject, "");
    assert.equal(reply.of, wordsOf(null, text));
  } finally {
    overrideBridge(null);
  }
});

test("an empty translation is an error, not an empty message", async () => {
  setState({ settings: { ...ai, writeIn: "sv" }, usage: {} });
  overrideBridge(async () => ({ status: 200, retryAfter: null, fromOpenai: true, body: JSON.stringify({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ subject: "", text: " ", back: "" }) }] }], usage: {} }) }));
  try {
    await assert.rejects(translateOutgoing("sv", "Otso tomorrow", "Otso will be away tomorrow."), /came back empty/);
  } finally {
    overrideBridge(null);
  }
});
