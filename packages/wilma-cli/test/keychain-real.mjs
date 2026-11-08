// The real keychain on this computer (opt-in: WILMAI_REAL_KEYCHAIN_TEST=1;
// `pnpm --filter @wilm-ai/wilma-cli test:keychain`). Uses the service
// "ai.wilm.wilma-cli.test", never the real one, and deletes what it made.
// On macOS it covers /usr/bin/security and also @napi-rs/keyring (the
// Windows and Linux path) against the same keychain; elsewhere the library.
//
// WILMAI_REAL_KEYCHAIN_TEST=temp (macOS): the same through /usr/bin/security
// against a temporary keychain file made, unlocked and deleted here (the
// search list is left alone), for when the login keychain is locked. It also
// checks each item trusts /usr/bin/security only.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile, execFileSync } from "node:child_process";

// `--run` (any platform, e.g. Windows' cmd) or WILMAI_REAL_KEYCHAIN_TEST=1; `--temp` or =temp for macOS's temporary keychain.
const mode = process.argv.includes("--temp") ? "temp" : process.argv.includes("--run") ? "1" : process.env.WILMAI_REAL_KEYCHAIN_TEST;
if (mode !== "1" && mode !== "temp") {
  console.log("keychain-real: skipped (set WILMAI_REAL_KEYCHAIN_TEST=1 to run against this computer's keychain)");
  process.exit(0);
}

const SERVICE = "ai.wilm.wilma-cli.test";
process.env.WILMAI_KEYCHAIN_SERVICE = SERVICE;
const security = (...args) =>
  new Promise((done) => execFile("/usr/bin/security", args, (e, so, se) => done({ code: e ? e.code ?? 1 : 0, out: so, err: se })));
let tempKeychain = null;
let searchListBefore = null;
if (mode === "temp") {
  assert.equal(process.platform, "darwin", "temp mode is for macOS");
  tempKeychain = join(await mkdtemp(join(tmpdir(), "wilmai-kc-")), "test.keychain-db");
  searchListBefore = (await security("list-keychains", "-d", "user")).out;
  const pass = `t-${process.pid}-${Date.now()}`;
  assert.equal((await security("create-keychain", "-p", pass, tempKeychain)).code, 0, "temporary keychain made");
  assert.equal((await security("unlock-keychain", "-p", pass, tempKeychain)).code, 0, "and unlocked");
  await security("set-keychain-settings", tempKeychain); // no automatic lock while the test runs
  process.env.WILMAI_KEYCHAIN_PATH = tempKeychain;
}
process.on("exit", () => {
  if (tempKeychain) execFileSync("/usr/bin/security", ["delete-keychain", tempKeychain], { stdio: "ignore" });
});
const backends = mode === "temp" ? ["macos"] : process.platform === "darwin" ? ["macos", "keyring"] : ["keyring"];
const tricky = `p "q" \\ 'a' $(x) ä€😀 ${"x".repeat(200)}`;

for (const kind of backends) {
  process.env.WILMAI_KEYCHAIN_BACKEND = kind;
  const store = await import(`../dist/secret-store.js?${kind}`);
  const id = `test-${kind}-${process.pid}`;
  try {
    assert.equal(await store.keychainProblem(), null, `${kind}: the keychain can be used here`);
    assert.equal(await store.readBackLoginSecrets(id), null, `${kind}: nothing there yet`);
    await store.writeLoginSecrets(id, { password: tricky, totpSecret: "JBSWY3DPEHPK3PXP" });
    assert.deepEqual(await store.readBackLoginSecrets(id), { password: tricky, totpSecret: "JBSWY3DPEHPK3PXP" }, `${kind}: read back unchanged`);
    assert.equal((await store.readLoginSecrets({ secretId: id, credentialsStamp: "1" })).password, tricky);
    await store.writeLoginSecrets(id, { password: "second", totpSecret: null });
    assert.deepEqual(await store.readBackLoginSecrets(id), { password: "second", totpSecret: null }, `${kind}: updated in place`);
    assert.equal(await store.deleteLoginSecrets(id), true);
    assert.equal(await store.deleteLoginSecrets(id), false, `${kind}: deleting again finds nothing`);
    await assert.rejects(store.readLoginSecrets({ secretId: id, credentialsStamp: "2" }), (err) => err.reason === "missing");
    console.log(`keychain-real: ${kind} (${store.keychainKind()}) ok`);
  } finally {
    await store.deleteLoginSecrets(id).catch(() => {});
  }
}

// The CLI end to end with the real keychain: log in, use the session without
// reading the keychain, a new login reads it, move back to the file.
const wilma = { currentSid: null, sidCounter: 0, logins: 0 };
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
    wilma.logins += 1;
    if (new URLSearchParams(body).get("Password") !== tricky) return send(303, "text/plain", "", { Location: `${wilma.url}/?loginfailed` });
    wilma.currentSid = String(++wilma.sidCounter);
    return send(303, "text/plain", "", { Location: `${wilma.url}/?checkcookie`, "Set-Cookie": `Wilma2SID=${wilma.currentSid}; Path=/` });
  }
  if (req.url === "/?checkcookie") return send(200, "text/html", "<html>home</html>");
  if (req.url === "/?loginfailed") return send(200, "text/html", "<html>loginFailed</html>");
  if (req.url === "/api/v1/accounts/me/roles") return send(!sid ? 401 : live ? 200 : 403, "application/json", live ? '{"payload":[]}' : "");
  if (req.method === "GET" && req.url === "/") {
    if (!live) return send(302, "text/plain", "", { Location: `${wilma.url}/login` });
    return send(200, "text/html", '<a href="/!1/">Lapsi Yksi</a>');
  }
  send(404, "text/plain", "");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
wilma.url = `http://127.0.0.1:${server.address().port}`;
const dir = await mkdtemp(join(tmpdir(), "wilmai-real-keychain-"));
const configPath = join(dir, "config.json");
const cliPath = resolve(new URL("../dist/index.js", import.meta.url).pathname);
const env = { ...process.env, WILMAI_CONFIG_PATH: configPath, WILMAI_NO_BROWSER: "1", WILMAI_NO_UPDATE_CHECK: "1", WILMAI_KEYCHAIN_SERVICE: SERVICE };
delete env.WILMAI_KEYCHAIN_BACKEND; // the platform's own
for (const key of ["WILMA_TENANT", "WILMA_USERNAME", "WILMA_PASSWORD", "WILMA_TOTP_SECRET", "WILMAI_SECRET_STORE"]) delete env[key];
const cli = (args, extra = {}) =>
  new Promise((done) => execFile(process.execPath, [cliPath, ...args, "--json"], { env: { ...env, ...extra } }, (e, so, se) => done({ code: e ? e.code : 0, out: so, err: se })));
let secretId;
try {
  const login = await cli(["login", "--tenant", wilma.url, "--username", "parent"], { WILMA_PASSWORD: tricky, WILMAI_SECRET_STORE: "keychain" });
  assert.equal(login.code, 0, login.out + login.err);
  assert.equal(JSON.parse(login.out).secrets, "keychain");
  const saved = JSON.parse(await readFile(configPath, "utf8")).profiles[0];
  secretId = saved.secretId;
  assert.equal(saved.passwordObfuscated, undefined);
  if (tempKeychain) {
    // The item trusts /usr/bin/security and nothing else (so no node binary needs to be trusted, and none is).
    const dump = (await security("dump-keychain", "-a", tempKeychain)).out;
    const item = dump.split("keychain: ").find((block) => block.includes(secretId)) ?? "";
    const apps = [...item.matchAll(/\d+: (\/[^\s]+)/g)].map((m) => m[1]);
    assert.ok(apps.includes("/usr/bin/security"), `trusted: ${apps.join(", ") || "none listed"}`);
    assert.ok(!apps.some((a) => /node/.test(a)), "no node binary trusted");
    console.log(`keychain-real: the entry trusts ${[...new Set(apps)].join(", ")}`);
  }
  const logins = wilma.logins;
  assert.equal((await cli(["students"])).code, 0);
  assert.equal(wilma.logins, logins, "the saved session, no keychain read");
  wilma.currentSid = null; // Wilma ends the session
  const again = await cli(["students"]);
  assert.equal(again.code, 0, again.out + again.err);
  assert.equal(wilma.logins, logins + 1, "logged in again with the password from the keychain");
  const back = await cli(["config", "secrets", "file"]);
  assert.equal(back.code, 0, back.out + back.err);
  assert.equal(JSON.parse(back.out).moved[0].outcome, "moved");
  process.env.WILMAI_KEYCHAIN_BACKEND = backends[0];
  const store = await import(`../dist/secret-store.js?after`);
  assert.equal(await store.readBackLoginSecrets(secretId), null, "the entry was deleted");
  console.log("keychain-real: CLI end to end ok");
} finally {
  server.close();
  if (secretId) {
    process.env.WILMAI_KEYCHAIN_BACKEND = backends[0];
    const store = await import(`../dist/secret-store.js?cleanup`);
    await store.deleteLoginSecrets(secretId).catch(() => {});
  }
  await rm(dir, { recursive: true, force: true });
}
if (tempKeychain) {
  assert.equal((await security("delete-keychain", tempKeychain)).code, 0);
  tempKeychain = null;
  assert.equal((await security("list-keychains", "-d", "user")).out, searchListBefore, "the search list is as it was");
}
console.log("keychain-real: all assertions passed");
