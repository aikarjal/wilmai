// Saved passwords in the OS keychain (docs/secret-store.md), against a fake
// Wilma and a fake keychain shared by processes (WILMAI_KEYCHAIN_BACKEND=fake:<file>):
// - the file stays the default and the keychain is never touched without opting in;
// - `wilma config secrets auto|keychain|file` moves logins both ways without a new Wilma login;
// - a saved session is used without reading the keychain; it's read only for a new login;
// - failures are secret_missing / secret_refused / secret_unavailable (exit 4), never a Wilma login;
// - the login order: a keychain that can't be used stops before Wilma is contacted;
// - interrupted moves (F+, a tagged v1 leftover) and an old version's rewrite are repaired;
// - `wilma config clear` deletes the entries it knows, even from a damaged config.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFile } from "node:child_process";

const tempDirectory = await mkdtemp(join(tmpdir(), "wilmai-secrets-"));
const cliPath = resolve(new URL("../dist/index.js", import.meta.url).pathname);

// A Wilma with one live session per account: a login ends the previous one.
const wilma = { loginPosts: 0, currentSid: null, sidCounter: 0, password: "right" };
const server = createServer(async (req, res) => {
  const send = (status, type, body, headers = {}) => {
    res.writeHead(status, { "Content-Type": type, ...headers });
    res.end(body);
  };
  const sid = /Wilma2SID=(\w+)/.exec(req.headers.cookie ?? "")?.[1] ?? null;
  const live = sid !== null && sid === wilma.currentSid;
  let body = "";
  for await (const chunk of req) body += chunk;
  if (req.method === "GET" && req.url === "/login") return send(200, "text/html", '<input type="hidden" name="SESSIONID" value="s">');
  if (req.method === "POST" && req.url === "/login") {
    wilma.loginPosts += 1;
    const form = new URLSearchParams(body);
    if (form.get("Password") !== wilma.password) return send(303, "text/plain", "", { Location: `${wilma.url}/?loginfailed` });
    wilma.currentSid = String(++wilma.sidCounter);
    return send(303, "text/plain", "", { Location: `${wilma.url}/?checkcookie`, "Set-Cookie": `Wilma2SID=${wilma.currentSid}; Path=/` });
  }
  if (req.url === "/?checkcookie") return send(200, "text/html", "<html>home</html>");
  if (req.url === "/?loginfailed") return send(200, "text/html", "<html>loginFailed</html>");
  if (req.url === "/api/v1/accounts/me/roles") return send(!sid ? 401 : live ? 200 : 403, "application/json", live ? '{"payload":[]}' : "");
  if (req.method === "GET" && req.url === "/") {
    if (!live) return send(302, "text/plain", "", { Location: `${wilma.url}/login` });
    return send(200, "text/html", `<form action="/logout" id="logout-form" method="post"><input type="hidden" name="formkey" value="g:1:${sid}"></form><a href="/!1/">Lapsi Yksi</a>`);
  }
  if (req.method === "POST" && req.url === "/logout") {
    if (live) wilma.currentSid = null;
    return send(303, "text/plain", "", { Location: `${wilma.url}/?logout`, "Set-Cookie": "Wilma2SID=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT" });
  }
  if (req.url === "/?logout") return send(200, "text/html", "<html>out</html>");
  send(404, "text/plain", `Unexpected ${req.method} ${req.url}`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
wilma.url = `http://127.0.0.1:${server.address().port}`;

let configPath;
let sessionsPath;
let keychainPath;
function useFolder(name) {
  configPath = join(tempDirectory, name, "config.json");
  sessionsPath = join(tempDirectory, name, "wilmai-sessions.json");
  keychainPath = join(tempDirectory, name, "keychain.json");
}
useFolder("main");

const baseEnv = { ...process.env, WILMAI_NO_BROWSER: "1", WILMAI_NO_UPDATE_CHECK: "1", WILMAI_KEYCHAIN_TIMEOUT_MS: "300" };
for (const key of ["WILMA_TENANT", "WILMA_USERNAME", "WILMA_PASSWORD", "WILMA_TOTP_SECRET", "WILMAI_NO_SESSION_CACHE", "WILMAI_SECRET_STORE"]) delete baseEnv[key];
const run = (args, extra = {}) =>
  new Promise((done) =>
    execFile(
      process.execPath,
      [cliPath, ...args],
      { env: { ...baseEnv, WILMAI_CONFIG_PATH: configPath, WILMAI_KEYCHAIN_BACKEND: `fake:${keychainPath}`, ...extra } },
      (error, stdout, stderr) => done({ code: error ? error.code : 0, stdout, stderr })
    )
  );
const json = async (args, extra, expectCode = 0) => {
  const result = await run([...args, "--json"], extra);
  assert.equal(result.code, expectCode, `${args.join(" ")} exited ${result.code}: ${result.stdout} ${result.stderr}`);
  return JSON.parse(result.stdout);
};
const login = (extra = {}) => json(["login", "--tenant", wilma.url, "--username", "parent"], { WILMA_PASSWORD: "right", ...extra });

const readJson = async (path, fallback) => JSON.parse(await readFile(path, "utf8").catch(() => JSON.stringify(fallback)));
const config = () => readJson(configPath, { profiles: [] });
const sessions = () => readJson(sessionsPath, {});
const keychain = () => readJson(keychainPath, {});
const setKeychain = async (fake) => {
  await mkdir(dirname(keychainPath), { recursive: true });
  await writeFile(keychainPath, JSON.stringify(fake));
};
const v1 = (password = "right") => createHash("sha256").update(`${wilma.url}\nparent\n${password}`).digest("hex");
const v2 = () => createHash("sha256").update(`wilmai-session-v2\n${wilma.url}\nparent`).digest("hex");
const students = () => json(["students"]);

try {
  // --- The default: the file, as always; the keychain isn't touched.
  {
    useFolder("default");
    assert.equal((await login()).secrets, "file");
    const saved = await config();
    assert.ok(saved.profiles[0].passwordObfuscated, "password in the file");
    assert.equal(saved.profiles[0].secrets, undefined);
    assert.equal(saved.keychainLogins, undefined);
    assert.ok((await sessions())[v1()], "session under the old label");
    assert.ok((await sessions())[v2()], "and the new one");
    assert.equal((await sessions())[v1()].state, (await sessions())[v2()].state, "the same session");
    await students();
    const status = await json(["config", "secrets"]);
    assert.equal(status.setting, "file");
    assert.deepEqual(status.logins.map((l) => l.store), ["file"]);
    assert.deepEqual(await keychain(), {}, "nothing written to the keychain");
  }

  // --- Turning it on moves the login, its session too: no Wilma login, no keychain read afterwards.
  useFolder("main");
  {
    await login();
    const before = wilma.loginPosts;
    const status = await json(["config", "secrets", "auto"]);
    assert.equal(status.setting, "auto");
    assert.deepEqual(status.moved.map((m) => m.outcome), ["moved"]);
    assert.ok(status.note.includes("Older copies"), "says once that backups may hold old copies");
    const profile = (await config()).profiles[0];
    assert.equal(profile.secrets, "keychain");
    assert.ok(/^[0-9a-f]{32}$/.test(profile.secretId));
    assert.equal(profile.passwordObfuscated, undefined, "the scrambled password is gone from the file");
    assert.equal((await config()).keychainLogins[profile.id], profile.secretId);
    const entry = JSON.parse((await keychain()).entries[profile.secretId]);
    assert.deepEqual(entry, { password: "right", totpSecret: null });
    const saved = await sessions();
    assert.ok(saved[v2()], "the session moved to the key without the password");
    assert.equal(saved[v1()], undefined, "nothing derived from the password left in the session file");
    assert.equal(wilma.loginPosts, before, "no Wilma login to move");

    // A valid saved session needs no keychain read: a keychain that refuses everything doesn't matter.
    await setKeychain({ ...(await keychain()), fail: { get: "refused" } });
    assert.equal((await students()).students.length, 1);
    assert.equal(wilma.loginPosts, before, "the saved session was used");
  }

  // --- Wilma ends the session: refused keychain = secret_refused, exit 4, no Wilma login attempted.
  {
    wilma.currentSid = null;
    const before = wilma.loginPosts;
    const failed = await json(["students"], {}, 4);
    assert.equal(failed.code, "secret_refused");
    assert.match(failed.message, /didn't hand over/);
    assert.equal(wilma.loginPosts, before, "never logs in without the password");

    // Keychain fine again: read once, log in once, session saved under v2.
    const fake = await keychain();
    delete fake.fail;
    await setKeychain(fake);
    assert.equal((await students()).students.length, 1);
    assert.equal(wilma.loginPosts, before + 1);
    assert.ok((await sessions())[v2()]);
    assert.equal((await sessions())[v1()], undefined);
  }

  // --- The entry deleted outside WilmAI: secret_missing (the one that says to log in again).
  {
    const id = (await config()).profiles[0].secretId;
    const saved = await keychain();
    const kept = saved.entries[id];
    delete saved.entries[id];
    await setKeychain(saved);
    wilma.currentSid = null;
    const failed = await json(["students"], {}, 4);
    assert.equal(failed.code, "secret_missing");
    assert.match(failed.message, /wilma login/);
    // Logging in again: a new entry under the same secretId (K-gone -> K).
    await login();
    assert.equal((await config()).profiles[0].secretId, id);
    assert.equal(JSON.parse((await keychain()).entries[id]).password, "right");
    void kept;
  }

  // --- WILMAI_SECRET_STORE=file doesn't move a keychain login, and logging in again keeps it there.
  {
    assert.equal((await login({ WILMAI_SECRET_STORE: "file" })).secrets, "keychain");
  }

  // --- Moving back: `wilma config secrets file`.
  {
    const id = (await config()).profiles[0].secretId;
    const before = wilma.loginPosts;
    const status = await json(["config", "secrets", "file"]);
    assert.deepEqual(status.moved.map((m) => m.outcome), ["moved"]);
    const saved = await config();
    assert.ok(saved.profiles[0].passwordObfuscated);
    assert.equal(saved.profiles[0].secrets, undefined);
    assert.equal(saved.profiles[0].secretId, undefined);
    assert.deepEqual(saved.keychainLogins, {}, "the reservation is gone");
    assert.equal((await keychain()).entries[id], undefined, "the entry is deleted");
    assert.ok((await sessions())[v1()], "the session moved back");
    assert.ok((await sessions())[v2()], "a file login keeps both labels");
    await students();
    assert.equal(wilma.loginPosts, before, "no Wilma login");
  }

  // --- `keychain` with no usable keychain: refused before anything changes, and a login stops before Wilma.
  {
    useFolder("strict");
    await setKeychain({ check: "no keychain here" });
    const refused = await json(["config", "secrets", "keychain"], {}, 4);
    assert.equal(refused.code, "secret_unavailable");
    assert.equal((await config()).secretStore, undefined, "the setting wasn't saved");
    const before = wilma.loginPosts;
    const failed = await json(["login", "--tenant", wilma.url, "--username", "parent"], { WILMA_PASSWORD: "right", WILMAI_SECRET_STORE: "keychain" }, 4);
    assert.equal(failed.code, "secret_unavailable");
    assert.match(failed.message, /Nothing was sent to Wilma/);
    assert.equal(wilma.loginPosts, before, "Wilma wasn't contacted");
    assert.deepEqual((await config()).profiles, []);
    // `auto` falls back to the file and says so.
    const saved = await login({ WILMAI_SECRET_STORE: "auto" });
    assert.equal(saved.secrets, "file");
    assert.match(saved.note, /no keychain/);
  }

  // --- The environment variable only decides where new logins go: it never moves saved ones.
  {
    useFolder("env-only");
    await login();
    await students();
    const status = await json(["config", "secrets"], { WILMAI_SECRET_STORE: "auto" });
    assert.equal(status.envOverride, "auto");
    assert.deepEqual(status.logins.map((l) => l.store), ["file"], "not moved by the variable");
    // Logging in again with the variable set keeps a saved file login in the file.
    assert.equal((await login({ WILMAI_SECRET_STORE: "auto" })).secrets, "file");
    assert.deepEqual(await keychain(), {});
  }

  // --- A move gives a new credentials stamp (keychain -> file -> keychain), so a running MCP server makes a new client.
  {
    useFolder("stamps");
    await login();
    await json(["config", "secrets", "auto"]);
    const first = (await config()).profiles[0].credentialsStamp;
    await json(["config", "secrets", "file"]);
    const second = (await config()).profiles[0].credentialsStamp;
    await json(["config", "secrets", "auto"]);
    const third = (await config()).profiles[0].credentialsStamp;
    assert.equal(new Set([first, second, third]).size, 3);
  }

  // --- A keychain write nobody answers: the command reports it and exits, instead of waiting for the call.
  {
    useFolder("hang");
    await login();
    await setKeychain({ hangMs: 4000 });
    const started = Date.now();
    const hung = await run(["config", "secrets", "auto", "--json"]);
    assert.ok(Date.now() - started < 3000, `exited after ${Date.now() - started} ms`);
    assert.equal(hung.code, 4);
    assert.equal(JSON.parse(hung.stdout).moved[0].outcome, "failed");
    assert.equal((await config()).profiles[0].secrets, undefined, "still a file login");
  }

  // --- Interrupted moves and an old version's rewrite are repaired by the next run.
  {
    useFolder("repair");
    await login();
    await json(["config", "secrets", "auto"]);
    const k = await config();
    const profile = k.profiles[0];
    const secretId = profile.secretId;
    // An old CLI's `wilma login` rebuilt the profile as a file login; it kept keychainLogins (F+).
    const { secrets: _s, secretId: _i, hasTotp: _t, ...fileLogin } = profile;
    fileLogin.passwordObfuscated = Buffer.from("wilmai::right", "utf-8").toString("base64");
    await writeFile(configPath, JSON.stringify({ ...k, profiles: [fileLogin] }));
    // ...and saved a v1 session.
    const all = await sessions();
    all[v1()] = { ...all[v2()] };
    await writeFile(sessionsPath, JSON.stringify(all));
    // The next command (the saved setting is auto) moves it back under the same entry.
    await students();
    const repaired = (await config()).profiles[0];
    assert.equal(repaired.secrets, "keychain");
    assert.equal(repaired.secretId, secretId, "the reserved entry is reused, nothing left over");
    assert.equal(repaired.passwordObfuscated, undefined);
    assert.equal((await sessions())[v1()], undefined, "the v1 session went too");
    assert.equal(Object.keys((await keychain()).entries).length, 1);

    // A crash after the flip left a tagged v1 entry: any later run deletes it.
    const leftover = await sessions();
    leftover[v1()] = { ...leftover[v2()], login: repaired.id };
    await writeFile(sessionsPath, JSON.stringify(leftover));
    await json(["accounts"]);
    await students();
    assert.equal((await sessions())[v1()], undefined, "the tagged leftover is gone");
  }

  // --- A failed background move waits a day instead of trying (and printing) on every run.
  {
    useFolder("backoff");
    await login();
    await writeFile(configPath, JSON.stringify({ ...(await config()), secretStore: "keychain" }));
    await setKeychain({ fail: { set: "refused" } });
    const first = await run(["students", "--json"]);
    assert.equal(first.code, 0, "a background move never fails the command");
    assert.match(first.stderr, /couldn't move the password/);
    assert.ok((await config()).profiles[0].moveFailedAt);
    const second = await run(["students", "--json"]);
    assert.equal(second.stderr.includes("couldn't move"), false, "not tried again within a day");
    assert.equal((await config()).profiles[0].secrets, undefined, "still a file login");
  }

  // --- Removing a login deletes its entry; `wilma config clear` deletes the ones it knows, even from a damaged config.
  {
    useFolder("remove");
    await json(["config", "secrets", "auto"]);
    await login();
    // An entry that can't be deleted stays recorded, so `wilma config clear` can try again.
    {
      const { id: loginId, secretId: id } = (await config()).profiles[0];
      await setKeychain({ ...(await keychain()), fail: { delete: "refused" } });
      const left = await json(["accounts", "remove", "1"]);
      assert.ok(left.keychainEntryLeft, "reported");
      assert.equal((await config()).keychainLogins[loginId], id, "still recorded");
      const fixed = await keychain();
      delete fixed.fail;
      await setKeychain(fixed);
      await json(["config", "clear"]);
      assert.equal((await keychain()).entries[id], undefined, "clear deleted it");
      await json(["config", "secrets", "auto"]); // clear deleted the setting too
      await login();
    }
    const { id: loginId, secretId: id } = (await config()).profiles[0];
    assert.ok((await keychain()).entries[id]);
    const removed = await json(["accounts", "remove", "1"]);
    assert.equal(removed.status, "removed");
    assert.equal(removed.session, "ended", "its session ended without the password");
    assert.equal((await keychain()).entries[id], undefined);
    assert.equal((await config()).keychainLogins[loginId], undefined, "the reservation went with it");

    await login();
    const entry = (await config()).profiles[0].secretId;
    const cleared = await json(["config", "clear"]);
    assert.equal(cleared.status, "cleared");
    assert.equal((await keychain()).entries[entry], undefined);

    await json(["config", "secrets", "auto"]);
    await login();
    const another = (await config()).profiles[0].secretId;
    assert.ok((await keychain()).entries[another]);
    await writeFile(configPath, (await readFile(configPath, "utf8")).slice(0, -20)); // damaged
    assert.equal((await run(["students", "--json"])).code !== 0, true);
    assert.equal((await json(["config", "clear"])).status, "cleared", "clear works on a damaged config");
    assert.equal((await keychain()).entries[another], undefined, "the entries a damaged config names are deleted too");
  }

  // --- The store's read states in one process: kept value, refused pause, late answer.
  {
    useFolder("states");
    process.env.WILMAI_KEYCHAIN_BACKEND = `fake:${keychainPath}`;
    process.env.WILMAI_KEYCHAIN_TIMEOUT_MS = "150";
    const store = await import("../dist/secret-store.js");
    await store.writeLoginSecrets("aa", { password: "pä", totpSecret: "JBSWY3DPEHPK3PXP" });
    assert.match((await keychain()).entries.aa, /\\u00e4/, "non-ASCII escaped in the entry");
    assert.deepEqual(await store.readLoginSecrets({ secretId: "aa", credentialsStamp: "1" }), { password: "pä", totpSecret: "JBSWY3DPEHPK3PXP" });
    await setKeychain({ ...(await keychain()), fail: { get: "refused" } });
    assert.equal((await store.readLoginSecrets({ secretId: "aa", credentialsStamp: "1" })).password, "pä", "a value read is kept");
    await assert.rejects(store.readLoginSecrets({ secretId: "aa", credentialsStamp: "2" }), (err) => err.reason === "refused");
    const fixed = await keychain();
    delete fixed.fail;
    await setKeychain(fixed);
    await assert.rejects(store.readLoginSecrets({ secretId: "aa", credentialsStamp: "2" }), (err) => err.reason === "refused", "no new read for a minute after a refusal");
    assert.equal((await store.readLoginSecrets({ secretId: "aa", credentialsStamp: "3" })).password, "pä", "a new stamp starts fresh");
    // A prompt nobody answers in time: refused, no new read while it runs, and a late value is kept.
    await setKeychain({ ...(await keychain()), hangMs: 400 });
    await assert.rejects(store.readLoginSecrets({ secretId: "aa", credentialsStamp: "4" }), (err) => err.reason === "refused");
    assert.equal(store.abandonedKeychainCalls(), true);
    await assert.rejects(store.readLoginSecrets({ secretId: "aa", credentialsStamp: "4" }), /still waiting/);
    await new Promise((r) => setTimeout(r, 450));
    assert.equal(store.abandonedKeychainCalls(), false);
    assert.equal((await store.readLoginSecrets({ secretId: "aa", credentialsStamp: "4" })).password, "pä", "the late value is kept");
    assert.throws(() => store.effectiveSecretStore("auto", { WILMAI_SECRET_STORE: "vault" }), /must be file, auto or keychain/);
    assert.equal(store.effectiveSecretStore("auto", {}), "auto");
    assert.equal(store.effectiveSecretStore(undefined, {}), "file");
  }

  console.log("secret-store: all assertions passed");
} finally {
  server.close();
  await rm(tempDirectory, { recursive: true, force: true });
}
