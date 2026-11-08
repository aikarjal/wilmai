/*
 * WilmAI Home's own secrets in the keychain (data/store.ts, src-tauri/src/lib.rs), against a fake keychain: the first
 * start of 0.4.0 moves the passwords and the OpenAI key out of localStorage; a keychain that fails leaves them there
 * and the next start tries again; Reset app deletes the entry and Sign out keeps it. Then WilmAI's shared session file
 * (bridge/core.ts, as the native side): both labels, the newer read, and nothing read from the CLI's settings.
 */
import "./shim.ts";
import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { accountKey, getState, loadSecrets, passwordOf, rememberPasswordOf, secretsWritten, updateSettings } from "../src/data/store.ts";
import { resetApp, signOut } from "../src/data/engine.ts";
import { DEFAULT_SETTINGS, type AccountInfo } from "../src/data/model.ts";
import { overrideBridge, overrideKeychain, sessionKeyV1, type SecretsKeychain } from "../src/wilma/transport.ts";

const own: AccountInfo = { baseUrl: "https://school.inschool.fi", username: "Parent", tenantName: "Example school", via: "password" };
const other: AccountInfo = { ...own, baseUrl: "https://other.inschool.fi" };
const COPIES = ["wilmai.openaiKey", "wilmai.passwords", "wilmai.wilmaPassword"];
const copies = () => COPIES.filter((key) => localStorage.getItem(key) !== null);

/** A keychain in memory. `failing.write` "after-delete": the entry is deleted, then adding it again fails (macOS writes so). */
function fakeKeychain(value: string | null = null) {
  const k = {
    value,
    failing: { read: false, write: false as boolean | "after-delete", remove: false },
    calls: [] as string[],
  };
  const keychain: SecretsKeychain = {
    read: async () => {
      k.calls.push("read");
      if (k.failing.read) throw new Error("locked");
      return k.value;
    },
    write: async (next) => {
      k.calls.push("write");
      if (k.failing.write === "after-delete") k.value = null;
      if (k.failing.write) throw new Error("refused");
      k.value = next;
    },
    remove: async () => {
      k.calls.push("remove");
      if (k.failing.remove) throw new Error("refused");
      const had = k.value !== null;
      k.value = null;
      return had;
    },
  };
  return { k, keychain };
}

const entryOf = (value: string | null) => JSON.parse(value ?? "null") as { v: number; openaiKey: string; wilmaPassword: string; passwords: Record<string, string> } | null;

/** A browser's setup, as versions before 0.4.0 kept it: the secrets in localStorage. */
async function before040(secrets: Partial<{ openaiKey: string; passwords: Record<string, string> }>) {
  overrideKeychain(null);
  overrideBridge(async () => ({ ok: true }));
  await resetApp();
  updateSettings({ ...DEFAULT_SETTINGS, rememberPassword: true, jevKey: "fictional-jev-key", ...secrets });
}

test("the first start of 0.4.0 moves the passwords and the OpenAI key into the keychain, then empties localStorage", async () => {
  await before040({ openaiKey: "fictional-openai-key", passwords: { [accountKey(own)!]: "fictional-pässi" } });
  assert.deepEqual(copies(), ["wilmai.openaiKey", "wilmai.passwords"], "kept here before");
  const { k, keychain } = fakeKeychain();
  overrideKeychain(keychain);
  try {
    await loadSecrets();
    assert.deepEqual(copies(), [], "moved: nothing left here");
    assert.ok(localStorage.getItem("wilmai.jevKey"), "the Jev key stays where it was");
    assert.deepEqual(k.calls, ["read", "write", "read"], "read, written, read back");
    const entry = entryOf(k.value)!;
    assert.equal(entry.openaiKey, "fictional-openai-key");
    assert.equal(entry.passwords[accountKey(own)!], "fictional-pässi");
    assert.doesNotMatch(k.value!, /[^\x20-\x7e]/, "ASCII only: the rest escaped");
    assert.equal(getState().secrets, "keychain");
    assert.equal(passwordOf(own), "fictional-pässi", "in use as before");
    assert.equal(getState().settings.openaiKey, "fictional-openai-key");

    // A change goes to the keychain, not here.
    updateSettings({ openaiKey: "fictional-openai-key-2" });
    await secretsWritten();
    assert.equal(entryOf(k.value)!.openaiKey, "fictional-openai-key-2");
    assert.deepEqual(copies(), []);

    // The next start reads them from the keychain, and writes nothing.
    k.calls = [];
    await loadSecrets();
    assert.deepEqual(k.calls, ["read"]);
    assert.equal(passwordOf(own), "fictional-pässi");
    assert.equal(getState().settings.openaiKey, "fictional-openai-key-2");

    // Asked for the password each time: none kept, in the keychain either.
    updateSettings({ rememberPassword: false, staySignedIn: false });
    await secretsWritten();
    assert.deepEqual(entryOf(k.value)!.passwords, {});
    assert.equal(entryOf(k.value)!.openaiKey, "fictional-openai-key-2", "the key stays");
    // Nothing left to keep: no entry.
    updateSettings({ openaiKey: "" });
    await secretsWritten();
    assert.equal(k.value, null);
  } finally {
    overrideKeychain(undefined);
    overrideBridge(null);
  }
});

test("a keychain that fails keeps the copies here, and the next start tries again", async () => {
  await before040({ openaiKey: "fictional-openai-key", passwords: { [accountKey(own)!]: "fictional-password" } });
  const { k, keychain } = fakeKeychain();
  overrideKeychain(keychain);
  try {
    // Locked: nothing moves, nothing is lost.
    k.failing.read = true;
    await loadSecrets();
    assert.deepEqual(copies(), ["wilmai.openaiKey", "wilmai.passwords"]);
    assert.equal(getState().secrets, "app-for-now");
    assert.equal(passwordOf(own), "fictional-password", "still signs in");
    assert.deepEqual(k.calls, ["read"], "never written without being read");
    // A password kept meanwhile goes here too.
    updateSettings({ passwords: { ...getState().settings.passwords, [accountKey(other)!]: "fictional-other" } });
    await secretsWritten();
    assert.equal(k.value, null);

    // The next start: moved.
    k.failing.read = false;
    await loadSecrets();
    assert.deepEqual(copies(), []);
    assert.deepEqual(Object.values(entryOf(k.value)!.passwords).sort(), ["fictional-other", "fictional-password"]);
    assert.equal(getState().secrets, "keychain");

    // Copies an older version left (the parent went back to 0.3 and typed a new key): taken in, the copy winning.
    localStorage.setItem("wilmai.openaiKey", btoa("wilmai::fictional-openai-key-3"));
    await loadSecrets();
    assert.equal(entryOf(k.value)!.openaiKey, "fictional-openai-key-3");
    assert.equal(Object.keys(entryOf(k.value)!.passwords).length, 2, "the entry's passwords stay");
    assert.deepEqual(copies(), []);

    // Written, but deleted and not added again (the keychain refused halfway): everything is kept here, whole.
    k.failing.write = "after-delete";
    rememberPasswordOf(other, null);
    await secretsWritten();
    assert.equal(k.value, null, "the entry is gone");
    assert.deepEqual(copies(), ["wilmai.openaiKey", "wilmai.passwords"]);
    assert.equal(localStorage.getItem("wilmai.secretsWhole"), "1");
    assert.equal(getState().secrets, "app-for-now");
    assert.equal(passwordOf(own), "fictional-password", "nothing lost");
    // The next start writes the copies as they are: the password forgotten meanwhile doesn't come back.
    k.failing.write = false;
    k.value = JSON.stringify({ v: 1, openaiKey: "", wilmaPassword: "", passwords: { [accountKey(other)!]: "fictional-other" } });
    await loadSecrets();
    assert.deepEqual(entryOf(k.value)!.passwords, { [accountKey(own)!]: "fictional-password" });
    assert.deepEqual(copies(), []);
    assert.equal(localStorage.getItem("wilmai.secretsWhole"), null);

    // Read back as something else: not trusted, kept here.
    keychain.read = async () => {
      k.calls.push("read");
      return k.value === null ? null : `${k.value} `;
    };
    localStorage.setItem("wilmai.openaiKey", btoa("wilmai::fictional-openai-key-4"));
    await loadSecrets();
    assert.equal(getState().secrets, "app-for-now");
    assert.deepEqual(copies(), ["wilmai.openaiKey", "wilmai.passwords"]);
    assert.equal(getState().settings.openaiKey, "fictional-openai-key-4");

    // An entry a newer version wrote is left alone.
    const newer = JSON.stringify({ v: 2, everything: "else" });
    const { k: k2, keychain: keychain2 } = fakeKeychain(newer);
    overrideKeychain(keychain2);
    await loadSecrets();
    assert.equal(k2.value, newer);
    assert.deepEqual(k2.calls, ["read"]);
    assert.equal(getState().secrets, "app-for-now");
    assert.equal(passwordOf(own), "fictional-password");
  } finally {
    overrideKeychain(undefined);
    overrideBridge(null);
  }
});

test("Reset app deletes the keychain entry; Sign out keeps it", async () => {
  await before040({ openaiKey: "fictional-openai-key", passwords: { [accountKey(own)!]: "fictional-password" } });
  const { k, keychain } = fakeKeychain();
  overrideKeychain(keychain);
  try {
    await loadSecrets();
    const moved = k.value;
    assert.ok(moved);
    await signOut();
    await secretsWritten();
    assert.equal(k.value, moved, "Sign out keeps the key and the passwords");

    await resetApp();
    assert.equal(k.value, null, "Reset app deletes the entry");
    assert.deepEqual(copies(), []);
    assert.equal(getState().settings.openaiKey, "");
    assert.equal(getState().secrets, "keychain");
    // A key typed after the reset goes to the keychain.
    updateSettings({ openaiKey: "fictional-openai-key-2" });
    await secretsWritten();
    assert.equal(entryOf(k.value)!.openaiKey, "fictional-openai-key-2");

    // The keychain refuses the delete: the next start deletes it before reading anything.
    k.failing.remove = true;
    await resetApp();
    assert.equal(entryOf(k.value)!.openaiKey, "fictional-openai-key-2", "still there");
    assert.equal(localStorage.getItem("wilmai.secretsDelete"), "1");
    assert.equal(getState().secrets, "app-for-now");
    updateSettings({ openaiKey: "fictional-openai-key-3" });
    await secretsWritten();
    assert.equal(entryOf(k.value)!.openaiKey, "fictional-openai-key-2", "kept here until the entry is gone");
    k.failing.remove = false;
    k.calls = [];
    await loadSecrets();
    assert.deepEqual(k.calls, ["remove", "read", "write", "read"]);
    assert.equal(entryOf(k.value)!.openaiKey, "fictional-openai-key-3", "only what came after the reset");
    assert.equal(localStorage.getItem("wilmai.secretsDelete"), null);
    assert.deepEqual(copies(), []);
  } finally {
    overrideKeychain(undefined);
    overrideBridge(null);
    await resetApp();
  }
});

test("a browser keeps the secrets in its own storage, as before", async () => {
  await before040({ openaiKey: "fictional-openai-key" });
  await loadSecrets();
  assert.deepEqual(copies(), ["wilmai.openaiKey"]);
  assert.equal(getState().secrets, "app");
  await resetApp();
});

/* ------------------------------------------------------------------ */
/*  The shared session file                                            */
/* ------------------------------------------------------------------ */

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cliBuilt = (() => {
  try {
    readFileSync(join(repo, "packages/wilma-cli/dist/session-store.js"));
    return true;
  } catch {
    return false;
  }
})();

test("session labels like the CLI's", async () => {
  assert.equal(await sessionKeyV1("https://example.inschool.fi", "Matti.M", "pw"), "c4cb441cdc450d3151d3de14dd1576b4aa3235ea224813cac8e8d9c982dd3507");
  assert.equal(await sessionKeyV1("https://example.inschool.fi/", "matti.m", "pw"), "c4cb441cdc450d3151d3de14dd1576b4aa3235ea224813cac8e8d9c982dd3507");
  const { sessionKeysOf } = await import("../bridge/core.ts");
  assert.deepEqual(sessionKeysOf({ baseUrl: "https://example.inschool.fi/", username: "Matti.M" }), ["18e7bcf46ac5969e085d0b5eac867bbbf4ffe590073dce493c82445fd120f6d9"]);
  assert.deepEqual(sessionKeysOf({ baseUrl: "https://example.inschool.fi", username: "Matti.M", v1Key: "c4cb441cdc450d3151d3de14dd1576b4aa3235ea224813cac8e8d9c982dd3507" }).length, 2);
  assert.throws(() => sessionKeysOf({ baseUrl: "https://example.inschool.fi", username: "Matti.M", v1Key: "../x" }));
});

test("the shared session file: saved under both labels, the newer read, both removed, the CLI's settings never read", { skip: !cliBuilt && "build the CLI first (its session store)" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "wilmai-home-sessions-"));
  const previous = process.env.WILMAI_CONFIG_PATH;
  process.env.WILMAI_CONFIG_PATH = join(dir, "config.json");
  // Settings the CLI couldn't read either: reading them would fail.
  writeFileSync(join(dir, "config.json"), "{ not the CLI's settings");
  try {
    const { sharedSessionGet, sharedSessionRemove, sharedSessionSet } = await import("../bridge/core.ts");
    const base = "https://example.inschool.fi";
    const v1 = await sessionKeyV1(base, "Matti.M", "pw");
    const v2 = createHash("sha256").update(`wilmai-session-v2\n${base}\nmatti.m`).digest("hex");
    const login = { baseUrl: `${base}/`, username: "Matti.M", v1Key: v1 };
    const file = () => JSON.parse(readFileSync(join(dir, "wilmai-sessions.json"), "utf8")) as Record<string, { state: string; savedAt: number; by: string }>;

    await sharedSessionSet(repo, login, '{"Wilma2SID":"home"}');
    assert.deepEqual(Object.keys(file()).sort(), [v1, v2].sort(), "under both");
    assert.equal(file()[v2].by, "home");

    // An older program saved a newer one under v1; a keychain login of the CLI's, under v2 only.
    const now = Date.now();
    writeFileSync(join(dir, "wilmai-sessions.json"), JSON.stringify({ [v2]: { state: "v2", savedAt: now - 5000, by: "cli" }, [v1]: { state: "v1", savedAt: now - 1000, by: "mcp" } }));
    assert.deepEqual(await sharedSessionGet(repo, login), { state: "v1", savedAt: now - 1000, by: "mcp" }, "the newer wins");
    writeFileSync(join(dir, "wilmai-sessions.json"), JSON.stringify({ [v2]: { state: "v2", savedAt: now - 1000, by: "cli" }, [v1]: { state: "v1", savedAt: now - 5000, by: "mcp" } }));
    assert.equal((await sharedSessionGet(repo, login)).state, "v2");
    assert.equal((await sharedSessionGet(repo, { baseUrl: base, username: "matti.m" })).state, "v2", "no password needed for v2");

    await sharedSessionRemove(repo, login);
    assert.deepEqual(file(), {}, "both gone");
    assert.equal(readFileSync(join(dir, "config.json"), "utf8"), "{ not the CLI's settings", "the settings untouched");
  } finally {
    if (previous === undefined) delete process.env.WILMAI_CONFIG_PATH;
    else process.env.WILMAI_CONFIG_PATH = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("nothing in the app reads the CLI's saved logins", () => {
  const source = (path: string) => readFileSync(join(repo, "apps/home", path), "utf8");
  const native = source("src-tauri/src/lib.rs");
  for (const word of ["passwordObfuscated", "cli_login", "profiles", "ai.wilm.wilma-cli"]) assert.ok(!native.includes(word), `lib.rs: ${word}`);
  const bridge = source("bridge/core.ts") + source("bridge/bridge.ts");
  for (const word of ["dist/config.js", "dist/credentials.js", "loadConfig", "/bridge/cli/"]) assert.ok(!bridge.includes(word), `bridge: ${word}`);
  const transport = source("src/wilma/transport.ts");
  assert.ok(!transport.includes('"cli/'), "no CLI routes for the window");
});
