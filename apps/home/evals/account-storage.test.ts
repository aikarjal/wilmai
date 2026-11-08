import "./shim.ts";
import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { get, set } from "idb-keyval";
import { accountKey, accountScope, accountStorageKey, activateAccount, flushPersisted, getState, loadPersisted, passwordOf, saveSession, savedSession, setState, updateSettings } from "../src/data/store.ts";
import { leaveDemo, resetApp, resume, signInDemo, signOut } from "../src/data/engine.ts";
import { DEFAULT_SETTINGS, emptySnapshot, type AccountInfo, type LunaRecord } from "../src/data/model.ts";
import { overrideBridge } from "../src/wilma/transport.ts";
import { loadCases, snapshotOf } from "./lib.ts";
import { lunaBacklog, runLuna } from "../src/luna/events.ts";
import { runJev, jevBacklog } from "../src/jev/runner.ts";

const own: AccountInfo = { baseUrl: "https://school.inschool.fi", username: "Parent", tenantName: "Example school", via: "password" };
const other: AccountInfo = { ...own, username: "other-parent" };
const record: LunaRecord = { v: "test", hash: "cached", at: 1, model: "test", action: null, events: [], dropped: 0 };

function installAccount(account = own) {
  activateAccount(account);
  const fixture = loadCases(new URL("./cases", import.meta.url).pathname).find((c) => c.id === "relative-tomorrow")!;
  const snapshot = snapshotOf(fixture);
  snapshot.account = account;
  setState({ snapshot, phase: "ready" });
}

function fakeAI(onCall: () => void) {
  overrideBridge(async (path, init) => {
    if (path !== "openai") return { accounts: [] };
    onCall();
    const body = init.body as { questions?: { name: string; type: string; choices?: { value: string }[]; levels?: { label: string }[] }[] };
    if (!body.questions) return { status: 200, body: JSON.stringify({ output: [{ content: [{ type: "output_text", text: '{"action":{"quote":null,"title":null,"deadline":null},"events":[]}' }] }], usage: { input_tokens: 100, output_tokens: 10 } }) };
    const answers = body.questions.map((q) => q.type === "predicate" ? { type: q.type, name: q.name, probability: 0 } : q.type === "choice" ? { type: q.type, name: q.name, choice: q.choices![0].value, probabilities: q.choices!.map((c, i) => ({ value: c.value, probability: i ? 0 : 1 })), confidence: 1 } : { type: q.type, name: q.name, score: 0, probabilities: q.levels!.map((c, i) => ({ value: String(i), label: c.label, probability: i ? 0 : 1 })), confidence: 1 });
    return { status: 200, body: JSON.stringify({ answers, usage: { input_tokens: 100 } }) };
  });
}

test("normal sign-out survives restart and reuses unchanged AI answers with no calls", async () => {
  await resetApp();
  installAccount();
  updateSettings({ ...DEFAULT_SETTINGS, aiProvider: "openai", openaiKey: "fictional-test-key", staySignedIn: true, wilmaPassword: "fictional-password" });
  let calls = 0;
  fakeAI(() => calls++);
  try {
    await runJev(); await runLuna();
    assert.ok(calls > 0);
    assert.deepEqual(jevBacklog().new, []);
    assert.deepEqual(jevBacklog().changed, []);
    assert.equal(lunaBacklog().length, 0);
    const cached = getState().luna;
    const usage = getState().usage;
    localStorage.setItem(accountStorageKey("draft.801"), "Own draft");
    await saveSession({ account: own, state: "fictional-cookie" });
    await signOut();
    assert.equal(getState().phase, "signed-out");
    assert.equal(getState().snapshot?.account.username, "Parent", "the family stays on the Wilma page");
    assert.equal(getState().settings.openaiKey, "fictional-test-key");
    assert.equal(passwordOf(own), "fictional-password", "kept for signing in again with one click");
    assert.equal(getState().settings.staySignedIn, true, "the parent's choice stays; nothing signs in from the start page");
    assert.equal(await savedSession(), null);
    assert.deepEqual(getState().usage, usage);
    const loaded = await loadPersisted();
    await resume(loaded.session);
    assert.equal(getState().phase, "signed-out", "restart does not automatically sign in");
    activateAccount({ ...own, baseUrl: `${own.baseUrl}/`, username: "parent", via: "cli" });
    setState({ phase: "ready" });
    assert.deepEqual(getState().luna, cached);
    assert.equal(localStorage.getItem(accountStorageKey("draft.801")), "Own draft");
    const before = calls;
    await runJev(); await runLuna();
    assert.equal(calls, before, "same messages and AI configuration reuse the cache");
  } finally { overrideBridge(null); await signOut(); }
});

test("the Wilma password is remembered unless turned off, and signing out keeps it", async () => {
  await resetApp();
  installAccount();
  // The one login's password from before there were several Wilmas, or (once the family changes) kept by login.
  const kept = () => localStorage.getItem("wilmai.wilmaPassword") ?? localStorage.getItem("wilmai.passwords");
  updateSettings({ ...DEFAULT_SETTINGS, wilmaPassword: "fictional-password" });
  assert.ok(kept(), "remembered by default, without staying signed in");
  assert.ok(!kept()!.includes("fictional-password"), "scrambled, not as typed");
  updateSettings({ rememberPassword: false });
  assert.equal(kept(), null, "not remembered when turned off");
  updateSettings({ staySignedIn: true });
  assert.ok(kept(), "staying signed in keeps it either way");
  updateSettings({ staySignedIn: false, rememberPassword: true });
  await signOut();
  assert.ok(kept(), "signing out keeps it: the start page signs in again with one click");
  assert.equal(passwordOf(own), "fictional-password");
  updateSettings({ rememberPassword: false, wilmaPassword: "", passwords: {} });
  assert.equal(kept(), null, "forgotten when the parent asks");
});

test("sample family and two Wilma accounts keep overlapping item IDs and drafts separate", async () => {
  await resetApp();
  installAccount();
  updateSettings({ openaiKey: "fictional-test-key", aiProvider: "off" });
  setState({ luna: { "m:801": record }, local: { opened: { "m:801": 1 }, done: {} } });
  const key = accountStorageKey("draft.801");
  localStorage.setItem(key, "Own draft");
  const scope = accountScope();
  await signInDemo();
  assert.notEqual(accountScope(), scope);
  assert.equal(getState().snapshot?.account.via, "demo");
  assert.deepEqual(getState().luna, {});
  assert.equal(localStorage.getItem(accountStorageKey("draft.801")), null);
  setState({ luna: { "m:801": { ...record, hash: "demo-only" } } });
  await leaveDemo();
  activateAccount(own);
  assert.equal(getState().luna["m:801"].hash, "cached");
  assert.equal(localStorage.getItem(key), "Own draft");
  activateAccount(other);
  assert.equal(getState().snapshot, null);
  setState({ snapshot: emptySnapshot(other), luna: { "m:801": { ...record, hash: "other-only" } } });
  localStorage.setItem(accountStorageKey("draft.801"), "Other draft");
  await signOut();
  await loadPersisted();
  activateAccount(own);
  assert.equal(getState().luna["m:801"].hash, "cached");
  assert.equal(localStorage.getItem(accountStorageKey("draft.801")), "Own draft");
  activateAccount(other);
  assert.equal(getState().luna["m:801"].hash, "other-only");
  assert.equal(localStorage.getItem(accountStorageKey("draft.801")), "Other draft");
  await signInDemo();
  assert.equal(getState().luna["m:801"].hash, "demo-only");
});

test("legacy snapshot, AI results, drafts and child filter migrate to the original account", async () => {
  await resetApp();
  await set("snapshot", emptySnapshot(own));
  await set("luna", { "m:801": record });
  localStorage.setItem("wilmai.draft.801", "Legacy draft");
  localStorage.setItem("wilmai.newmsg.42", "Legacy new message");
  localStorage.setItem("wilmai.children", '["42"]');
  await loadPersisted();
  await signInDemo();
  await leaveDemo();
  await loadPersisted();
  activateAccount(own);
  assert.equal(getState().luna["m:801"].hash, "cached");
  assert.equal(localStorage.getItem(accountStorageKey("draft.801")), "Legacy draft");
  assert.equal(localStorage.getItem(accountStorageKey("newmsg.42")), "Legacy new message");
  assert.equal(localStorage.getItem(accountStorageKey("children")), '["42"]');
  assert.equal(localStorage.getItem("wilmai.draft.801"), null);
});

test("reset deletes every account and key without a pending persistence write restoring them", async () => {
  await resetApp();
  installAccount();
  updateSettings({ openaiKey: "fictional-test-key", jevKey: "fictional-jev-key" });
  localStorage.setItem(accountStorageKey("draft.801"), "Draft");
  localStorage.setItem("wilmai.tenant", "school");
  localStorage.setItem("unrelated.app", "keep");
  setState({ luna: { "m:801": record }, usage: { "2026-10": { items: 1, decisions: { input: 1000, calls: 1, estimated: false } } } });
  await resetApp();
  await flushPersisted();
  assert.equal(getState().settings.openaiKey, "");
  assert.equal(getState().settings.jevKey, "");
  assert.deepEqual(getState().usage, {});
  assert.equal(localStorage.getItem("wilmai.openaiKey"), null);
  assert.equal(localStorage.getItem("wilmai.tenant"), null);
  assert.equal(localStorage.getItem("unrelated.app"), "keep");
  assert.equal(await get("accounts"), undefined);
  assert.equal((await loadPersisted()).session, null);
  activateAccount(own);
  assert.equal(getState().snapshot, null);
  assert.deepEqual(getState().luna, {});
  assert.equal(localStorage.getItem(accountStorageKey("draft.801")), null);
  assert.notEqual(accountKey(own), accountKey(other));
});

test("a late AI extraction cannot publish into another account or start verification there", async () => {
  await resetApp();
  installAccount();
  updateSettings({ aiProvider: "openai", openaiKey: "fictional-test-key" });
  let arrived!: () => void;
  const started = new Promise<void>((resolve) => arrived = resolve);
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => finish = resolve);
  let calls = 0;
  overrideBridge(async (path) => {
    assert.equal(path, "openai"); calls++;
    arrived(); await pending;
    return { status: 200, body: JSON.stringify({ output: [{ content: [{ type: "output_text", text: '{"action":{"quote":null,"title":null,"deadline":null},"events":[]}' }] }] }) };
  });
  try {
    const reading = runLuna();
    await started;
    activateAccount(other);
    setState({ snapshot: emptySnapshot(other), phase: "signed-out" });
    finish(); await reading;
    assert.equal(calls, 1, "no verification follows the obsolete extraction");
    assert.deepEqual(getState().luna, {});
    assert.equal(getState().lunaStatus.error, null);
  } finally { overrideBridge(null); }
});


test("a late decision answer cannot overwrite another account with the same message ID", async () => {
  await resetApp();
  installAccount();
  updateSettings({ aiProvider: "openai", openaiKey: "fictional-test-key" });
  let arrived!: () => void;
  const started = new Promise<void>((resolve) => arrived = resolve);
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => finish = resolve);
  overrideBridge(async (path) => {
    assert.equal(path, "openai");
    arrived(); await pending;
    return { status: 200, body: '{"answers":[]}' };
  });
  try {
    const reading = runJev(); await started;
    activateAccount(other);
    setState({ snapshot: emptySnapshot(other), phase: "signed-out" });
    finish(); await reading;
    assert.deepEqual(getState().jev, {});
    assert.equal(getState().jevStatus.error, null);
  } finally { overrideBridge(null); }
});

test("a reply received after reset cannot restore erased usage or AI answers", async () => {
  await resetApp(); installAccount();
  updateSettings({ aiProvider: "openai", openaiKey: "fictional-test-key" });
  let arrived!: () => void;
  const started = new Promise<void>((resolve) => arrived = resolve);
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => finish = resolve);
  overrideBridge(async (path) => {
    // The reset's own calls (the shared session file) answer at once; OpenAI's reply is the late one.
    if (path !== "openai") return { ok: true };
    arrived(); await pending;
    return { status: 200, body: JSON.stringify({ output: [{ content: [{ type: "output_text", text: '{"action":{"quote":null,"title":null,"deadline":null},"events":[]}' }] }], usage: { input_tokens: 1000, output_tokens: 200 } }) };
  });
  try {
    const reading = runLuna(); await started;
    await resetApp(); finish(); await reading; await flushPersisted();
    assert.deepEqual(getState().usage, {});
    assert.deepEqual(getState().luna, {});
    assert.equal(getState().settings.openaiKey, "");
    assert.deepEqual(await get("usage"), {});
  } finally { overrideBridge(null); }
});
