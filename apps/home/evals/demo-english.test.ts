import "./shim.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../src/data/model.ts";
import { getState, setState } from "../src/data/store.ts";
import { buildFeed } from "../src/data/feed.ts";
import { currentTranslation, translationSource, translationTarget } from "../src/ai/translate.ts";
import { demoEnglish, demoSnapshot } from "../src/demo/demo.ts";
import { demoPhrase, demoTranslations } from "../src/demo/translations.ts";

// The sample family comes translated into English (the Home page's tour shows it so), without AI: each of its Finnish
// texts is written with its English (src/demo/demo.ts). A new text without its English shows here.
const settings = { ...DEFAULT_SETTINGS, aiProvider: "off" as const, translateTo: "en" as const };

test("the sample family translates into English without AI, and only into English", () => {
  setState({ snapshot: demoSnapshot(), settings });
  assert.equal(translationTarget(settings), "en");
  assert.equal(translationTarget({ ...settings, translateTo: "sv" }), null);
  assert.equal(translationTarget({ ...settings, translateTo: "off" }), null);
});

test("every message, bulletin and note of it has its English", () => {
  setState({ snapshot: demoSnapshot(), settings });
  const state = getState();
  const translations = demoTranslations(state);
  const missing = buildFeed(state)
    .filter((item) => !currentTranslation(translations[item.key], translationSource(item, state.snapshot!), "en"))
    .map((item) => item.title);
  assert.deepEqual(missing, []);
});

test("its subjects, notes and homework have their English, inside the app's own words too", () => {
  assert.equal(demoPhrase("en", "Matematiikka"), "Maths");
  assert.equal(demoPhrase("en", "Selvittämätön poissaolo"), "Unexplained absence");
  assert.equal(demoPhrase("en", "Sign up: Kutsu oppimiskeskusteluun"), "Sign up: Invitation to a learning discussion");
  assert.equal(demoPhrase("sv", "Matematiikka"), undefined);
  for (const [finnish, english] of demoEnglish()) assert.notEqual(english, finnish, finnish);
});
