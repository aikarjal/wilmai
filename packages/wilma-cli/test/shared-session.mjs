// WilmAI's programs on one computer share one Wilma session through the
// session store: a running MCP server (an assistant's connector) continues a
// session another program saved (the desktop app, a CLI command) instead of
// logging in, which would end that program's session.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const tempDirectory = await mkdtemp(join(tmpdir(), "wilmai-shared-"));
const cliPath = resolve(new URL("../dist/index.js", import.meta.url).pathname);

// A Wilma with one live session per account: a login ends the previous one.
const wilma = { loginPosts: 0, currentSid: null, sidCounter: 0 };
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
    wilma.currentSid = String(++wilma.sidCounter);
    return send(303, "text/plain", "", { Location: `${wilma.url}/?checkcookie`, "Set-Cookie": `Wilma2SID=${wilma.currentSid}; Path=/` });
  }
  if (req.url === "/?checkcookie") return send(200, "text/html", "<html>home</html>");
  if (req.url === "/api/v1/accounts/me/roles") return send(!sid ? 401 : live ? 200 : 403, "application/json", live ? '{"payload":[]}' : "");
  if (req.method === "GET" && req.url === "/") {
    if (!live) return send(302, "text/plain", "", { Location: `${wilma.url}/login` });
    return send(200, "text/html", '<a href="/!1/">Lapsi Yksi</a>');
  }
  send(404, "text/plain", `Unexpected ${req.method} ${req.url}`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
wilma.url = `http://127.0.0.1:${server.address().port}`;

const configPath = join(tempDirectory, "config.json");
const sessionsPath = join(tempDirectory, "wilmai-sessions.json");
const env = { ...process.env, WILMAI_CONFIG_PATH: configPath, WILMAI_NO_BROWSER: "1", WILMAI_NO_UPDATE_CHECK: "1" };
for (const key of ["WILMA_TENANT", "WILMA_USERNAME", "WILMA_PASSWORD", "WILMA_TOTP_SECRET", "WILMAI_NO_SESSION_CACHE"]) delete env[key];
const run = (args, extra = {}) =>
  new Promise((done) => execFile(process.execPath, [cliPath, ...args], { env: { ...env, ...extra } }, (error, stdout) => done({ code: error ? error.code : 0, stdout })));
const key = createHash("sha256").update(`${wilma.url}\nparent\nright`).digest("hex");
const stored = async () => JSON.parse(await readFile(sessionsPath, "utf8"))[key];
const storedSid = async () => JSON.parse((await stored()).state).cookies.find((c) => c.key === "Wilma2SID").value;

/** Another program (the desktop app) logs in and saves its session in the shared store. */
async function anotherProgramLogsIn() {
  wilma.loginPosts += 1;
  wilma.currentSid = String(++wilma.sidCounter);
  const state = JSON.stringify({ cookies: [{ key: "Wilma2SID", value: wilma.currentSid, domain: "127.0.0.1", path: "/", hostOnly: true }] });
  const all = JSON.parse(await readFile(sessionsPath, "utf8").catch(() => "{}"));
  all[key] = { state, savedAt: Date.now(), by: "home" };
  await writeFile(sessionsPath, JSON.stringify(all));
}

let mcp;
try {
  assert.equal(JSON.parse((await run(["login", "--tenant", wilma.url, "--username", "parent", "--json"], { WILMA_PASSWORD: "right" })).stdout).status, "ok");
  assert.equal(wilma.loginPosts, 1);
  assert.equal((await stored()).by, "cli", "each saved session names the program that saved it");

  mcp = new Client({ name: "test-client", version: "0.0.0" });
  await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [cliPath, "mcp"], env, stderr: "pipe" }));
  const account = async () => {
    const result = await mcp.callTool({ name: "wilma_account", arguments: {} });
    assert.ok(!result.isError, JSON.stringify(result.content));
  };
  await account();
  assert.equal(wilma.loginPosts, 1, "the connector continues the saved session");

  // The desktop app logs in and saves its session: the connector continues it on its next call, no login.
  await anotherProgramLogsIn();
  const appSid = wilma.currentSid;
  await account();
  assert.equal(wilma.loginPosts, 2, "no login by the connector");
  assert.equal(wilma.currentSid, appSid, "the app's session is still the live one");

  // A CLI command meanwhile: the same session, no login.
  assert.equal((await run(["students", "--json"])).code, 0);
  assert.equal(wilma.loginPosts, 2);

  // Wilma ended that one too (a login on the phone) and nothing newer is saved: the connector logs in and saves it for the others.
  wilma.currentSid = "phone";
  await account();
  assert.equal(wilma.loginPosts, 3, "now a login is the only way");
  // Saved in the background right after the login.
  for (let i = 0; i < 50 && (await storedSid()) !== wilma.currentSid; i += 1) await new Promise((r) => setTimeout(r, 20));
  assert.equal(await storedSid(), wilma.currentSid, "and its session is saved for the other programs");
  assert.equal((await stored()).by, "mcp");

  // The labels overlap (v1 with the password, v2 without): what the connector just saved is under both.
  const v2key = createHash("sha256").update(`wilmai-session-v2\n${wilma.url}\nparent`).digest("hex");
  const all = () => readFile(sessionsPath, "utf8").then(JSON.parse);
  assert.equal((await all())[v2key]?.state, (await stored()).state, "saved under the new label too");

  // A newer program saves under the new label only (Home 0.4.0 also writes the old one; a keychain login doesn't):
  // a CLI command continues it, no login.
  wilma.loginPosts += 1;
  wilma.currentSid = String(++wilma.sidCounter);
  const newer = await all();
  newer[v2key] = { state: JSON.stringify({ cookies: [{ key: "Wilma2SID", value: wilma.currentSid, domain: "127.0.0.1", path: "/", hostOnly: true }] }), savedAt: Date.now(), by: "home" };
  await writeFile(sessionsPath, JSON.stringify(newer));
  const logins = wilma.loginPosts;
  assert.equal((await run(["students", "--json"])).code, 0);
  assert.equal(wilma.loginPosts, logins, "found under the new label: no login");

  // The store itself: the newest entry among a login's labels wins, saving writes every label in one go, removing clears them all.
  process.env.WILMAI_CONFIG_PATH = join(tempDirectory, "unit", "config.json");
  const { fileSessionStore } = await import("../dist/session-store.js");
  await fileSessionStore.save("a", "older");
  await new Promise((r) => setTimeout(r, 5));
  await fileSessionStore.save("b", "newer");
  assert.equal(await fileSessionStore.loadNewest(["a", "b"]), "newer");
  assert.equal(await fileSessionStore.loadNewest(["b", "a"]), "newer", "whatever the order");
  await fileSessionStore.saveAll(["a", "b"], "both");
  assert.equal(await fileSessionStore.load("a"), "both");
  assert.equal(await fileSessionStore.load("b"), "both");
  await fileSessionStore.removeAll(["a", "b"]);
  assert.equal(await fileSessionStore.loadNewest(["a", "b"]), null);
  console.log("shared-session: all assertions passed");
} finally {
  await mcp?.close().catch(() => {});
  server.close();
  await rm(tempDirectory, { recursive: true, force: true });
}
