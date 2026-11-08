// `wilma logout` and the wilma_logout tool against a mock Wilma that, like
// the real one, keeps one live session per account and ends it on POST
// /logout with the formkey from the page's logout form.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const tempDirectory = await mkdtemp(join(tmpdir(), "wilmai-logout-"));
const cliPath = resolve(new URL("../dist/index.js", import.meta.url).pathname);

/** A mock Wilma with one guardian account and its state, which the tests read and change. */
async function startWilma(username, password, children) {
  const wilma = { loginPosts: 0, currentSid: null, homeOutage: false, logoutPosts: [], sidCounter: 0 };
  const server = createServer(async (req, res) => {
    const send = (status, type, body, headers = {}) => {
      res.writeHead(status, { "Content-Type": type, ...headers });
      res.end(body);
    };
    const sid = /Wilma2SID=(\d+)/.exec(req.headers.cookie ?? "")?.[1] ?? null;
    const live = sid !== null && sid === wilma.currentSid;
    let body = "";
    for await (const chunk of req) body += chunk;

    if (req.method === "GET" && req.url === "/login") return send(200, "text/html", '<input type="hidden" name="SESSIONID" value="s">');
    if (req.method === "POST" && req.url === "/login") {
      wilma.loginPosts += 1;
      const form = new URLSearchParams(body);
      if (form.get("Login") !== username || form.get("Password") !== password) {
        return send(303, "text/plain", "", { Location: `${wilma.url}/?loginfailed` });
      }
      wilma.currentSid = String(++wilma.sidCounter); // a new login cancels the previous session
      return send(303, "text/plain", "", { Location: `${wilma.url}/?checkcookie`, "Set-Cookie": `Wilma2SID=${wilma.currentSid}; Path=/` });
    }
    if (req.url === "/?checkcookie") return send(200, "text/html", "<html>home</html>");
    if (req.method === "GET" && req.url === "/") {
      if (wilma.homeOutage) return send(503, "text/plain", "down");
      if (!live) return send(200, "text/html", '<form action="/login" method="post"><input name="Login"></form>');
      return send(
        200,
        "text/html",
        `<form action="/logout" id="logout-form" method="post"><input type="hidden" name="formkey" value="guardian:7:${sid}"></form>
         ${children.map((name, i) => `<a href="/!${i + 1}/">${name}</a>`).join("")}`
      );
    }
    if (req.method === "POST" && req.url === "/logout") {
      const formkey = new URLSearchParams(body).get("formkey");
      wilma.logoutPosts.push({ sid, formkey });
      if (live && formkey === `guardian:7:${sid}`) wilma.currentSid = null;
      return send(303, "text/plain", "", { Location: `${wilma.url}/?logout` });
    }
    if (req.url === "/api/v1/accounts/me/roles") return send(!sid ? 401 : live ? 200 : 403, "application/json", live ? '{"payload":[]}' : "");
    send(404, "text/plain", `Unexpected ${req.method} ${req.url}`);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  wilma.url = `http://127.0.0.1:${server.address().port}`;
  wilma.close = () => server.close();
  return wilma;
}

const wilma = await startWilma("parent", "right", ["Lapsi Yksi", "Lapsi Kaksi"]);
const wilmaUrl = wilma.url;
// A second school's Wilma, for families with two logins.
const other = await startWilma("parent2", "pw2", ["Eino Kolmas"]);

const configPath = join(tempDirectory, "config.json");
const sessionsPath = join(tempDirectory, "wilmai-sessions.json");
const baseEnv = (extra = {}, config = configPath) => {
  const env = { ...process.env, WILMAI_CONFIG_PATH: config, WILMAI_NO_BROWSER: "1", WILMAI_NO_UPDATE_CHECK: "1", ...extra };
  for (const key of ["WILMA_TENANT", "WILMA_USERNAME", "WILMA_PASSWORD", "WILMA_TOTP_SECRET", "WILMAI_NO_SESSION_CACHE"]) {
    if (!(key in extra)) delete env[key];
  }
  return env;
};
const run = (args, extraEnv = {}, config) =>
  new Promise((done) =>
    execFile(process.execPath, [cliPath, ...args], { env: baseEnv(extraEnv, config) }, (error, stdout, stderr) =>
      done({ code: error ? error.code : 0, stdout, stderr })
    )
  );
const json = async (args, extraEnv, config) => {
  const result = await run(args, extraEnv, config);
  assert.equal(result.code, 0, `${args.join(" ")}: ${result.stdout} ${result.stderr}`);
  return JSON.parse(result.stdout);
};
const savedSessions = async (path = sessionsPath) => Object.keys(JSON.parse(await readFile(path, "utf8").catch(() => "{}")));
// One login's session is saved under two labels while the old one is retired (v1 with the password, v2 without):
// count sessions, not entries.
const distinctSessions = async (path = sessionsPath) =>
  new Set(Object.values(JSON.parse(await readFile(path, "utf8").catch(() => "{}"))).map((entry) => entry.state)).size;
const textOf = (result) => result.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");

let mcp;
try {
  /* ---------------- CLI ---------------- */
  // Log in once; the next command continues that session.
  assert.equal((await json(["login", "--tenant", wilmaUrl, "--username", "parent", "--json"], { WILMA_PASSWORD: "right" })).status, "ok");
  await json(["students"]);
  assert.equal(wilma.loginPosts, 1, "one login so far");
  assert.equal(await distinctSessions(), 1, "the session is saved");
  assert.equal((await savedSessions()).length, 2, "under both labels");

  // Logging out ends that session in Wilma and forgets it; the login stays saved.
  const out = await json(["logout"]);
  assert.equal(out.status, "ok");
  assert.deepEqual(out.logins, [{ wilma: wilmaUrl, username: "parent", session: "ended" }]);
  assert.match(out.hint, /logins stay saved/);
  assert.deepEqual(wilma.logoutPosts, [{ sid: "1", formkey: "guardian:7:1" }], "posted the page's formkey with the session's cookie");
  assert.equal(wilma.currentSid, null, "Wilma no longer has the session");
  assert.equal(wilma.loginPosts, 1, "logging out never logs in");
  assert.deepEqual(await savedSessions(), [], "the saved session is gone");
  assert.equal(JSON.parse(await readFile(configPath, "utf8")).profiles.length, 1, "the login is kept");

  // Again: nothing to end, no requests that change anything, no error.
  assert.deepEqual((await json(["logout"])).logins, [{ wilma: wilmaUrl, username: "parent", session: "none" }]);
  assert.equal(wilma.logoutPosts.length, 1);
  assert.equal(wilma.loginPosts, 1);
  const text = await run(["logout", "--text"]);
  assert.equal(text.code, 0);
  assert.match(text.stdout, /No open session: parent @ /);
  assert.match(text.stdout, /next wilma command logs in again/);

  // One login by its number from `wilma accounts`; sessions belong to logins, not children.
  await json(["students"]); // logs in again
  assert.equal(wilma.loginPosts, 2);
  assert.equal((await json(["logout", "1"])).logins[0].session, "ended");
  assert.equal(wilma.currentSid, null);
  const unknown = await run(["logout", "5"]);
  assert.equal(unknown.code, 1);
  assert.equal(JSON.parse(unknown.stdout).code, "unknown_account");
  const byStudent = await run(["logout", "--student", "Lapsi"]);
  assert.equal(byStudent.code, 2);
  assert.equal(JSON.parse(byStudent.stdout).code, "invalid_argument");
  assert.match((await run(["help", "logout"])).stdout, /Usage: wilma logout/);
  assert.match((await run(["--help"])).stdout, /logout/);

  // Wilma down: the error is reported and the saved session kept for another try.
  await json(["students"]);
  wilma.homeOutage = true;
  const down = await run(["logout"]);
  wilma.homeOutage = false;
  assert.equal(down.code, 1);
  assert.equal(JSON.parse(down.stdout).status, "error");
  assert.equal(await distinctSessions(), 1, "the session is kept");
  assert.notEqual(wilma.currentSid, null);
  assert.equal((await json(["logout"])).logins[0].session, "ended", "the retry ends it");
  assert.equal(wilma.currentSid, null);

  // A login from the environment (an agent's secret settings).
  const envConfig = join(tempDirectory, "env", "config.json");
  const envAccount = { WILMA_TENANT: wilmaUrl, WILMA_USERNAME: "parent", WILMA_PASSWORD: "right" };
  await json(["students"], envAccount, envConfig);
  assert.equal((await json(["logout"], envAccount, envConfig)).logins[0].session, "ended");
  assert.equal(wilma.currentSid, null);

  // Nothing saved: nothing to do.
  const empty = await json(["logout"], {}, join(tempDirectory, "none", "config.json"));
  assert.deepEqual(empty.logins, []);

  // Removing a login ends only that login's session; the other logins keep theirs.
  const familyConfig = join(tempDirectory, "family", "config.json");
  const familySessions = join(tempDirectory, "family", "wilmai-sessions.json");
  await json(["login", "--tenant", wilmaUrl, "--username", "parent", "--json"], { WILMA_PASSWORD: "right" }, familyConfig);
  await json(["login", "--tenant", other.url, "--username", "parent2", "--json"], { WILMA_PASSWORD: "pw2" }, familyConfig);
  assert.equal(await distinctSessions(familySessions), 2);
  const keptSid = wilma.currentSid;
  const removed = await json(["accounts", "remove", "2"], {}, familyConfig);
  assert.deepEqual(removed, { status: "removed", wilma: other.url, username: "parent2", session: "ended" });
  assert.equal(other.currentSid, null, "the removed login's session was ended in Wilma");
  assert.equal(wilma.currentSid, keptSid, "the other login's session is untouched");
  assert.equal(await distinctSessions(familySessions), 1, "only the removed login's session is forgotten");
  assert.equal((await savedSessions(familySessions)).length, 2, "both of its labels are gone, the other login's stay");
  wilma.loginPosts = 0;
  await json(["students"], {}, familyConfig);
  assert.equal(wilma.loginPosts, 0, "the other login continues its session without logging in");

  // Wilma unreachable: the login is removed anyway, and its saved session forgotten.
  await json(["login", "--tenant", other.url, "--username", "parent2", "--json"], { WILMA_PASSWORD: "pw2" }, familyConfig);
  other.homeOutage = true;
  const unreachable = await json(["accounts", "remove", "2"], {}, familyConfig);
  other.homeOutage = false;
  assert.equal(unreachable.session, "not_ended");
  assert.match(unreachable.message, /503/);
  assert.equal((await json(["accounts"], {}, familyConfig)).accounts.length, 1);
  assert.equal(await distinctSessions(familySessions), 1);
  assert.equal(wilma.currentSid, keptSid);

  /* ---------------- MCP ---------------- */
  mcp = new Client({ name: "test-client", version: "0.0.0" });
  await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [cliPath, "mcp"], env: baseEnv(), stderr: "pipe" }));
  const tool = (await mcp.listTools()).tools.find((t) => t.name === "wilma_logout");
  assert.ok(tool, "wilma_logout is listed");
  assert.deepEqual(
    { readOnly: tool.annotations.readOnlyHint, idempotent: tool.annotations.idempotentHint, destructive: tool.annotations.destructiveHint },
    { readOnly: false, idempotent: true, destructive: false }
  );
  const call = (name) => mcp.callTool({ name, arguments: {} });

  wilma.loginPosts = 0;
  const before = await call("wilma_account");
  assert.ok(!before.isError, textOf(before));
  assert.equal(wilma.loginPosts, 1);
  const loggedOut = await call("wilma_logout");
  assert.ok(!loggedOut.isError, textOf(loggedOut));
  assert.deepEqual(JSON.parse(textOf(loggedOut)).logins, [{ wilma: wilmaUrl, username: "parent", session: "ended" }]);
  assert.equal(wilma.currentSid, null);
  assert.equal(wilma.loginPosts, 1, "no login to log out");

  // The next call logs in again with a new session: the logged-out client isn't reused.
  const after = await call("wilma_account");
  assert.ok(!after.isError, textOf(after));
  assert.deepEqual(JSON.parse(textOf(after)).wilmas[0].children.map((c) => c.name), ["Lapsi Yksi", "Lapsi Kaksi"]);
  assert.equal(wilma.loginPosts, 2);

  // Another process logged in since (cancelling the server's session): the
  // newer, saved session is the one ended.
  await json(["login", "--tenant", wilmaUrl, "--username", "parent", "--json"], { WILMA_PASSWORD: "right" });
  const newer = wilma.currentSid;
  wilma.logoutPosts.length = 0;
  assert.equal(JSON.parse(textOf(await call("wilma_logout"))).logins[0].session, "ended");
  assert.equal(wilma.currentSid, null);
  assert.ok(wilma.logoutPosts.some((post) => post.sid === newer), "the live, saved session was logged out");
  assert.equal(JSON.parse(textOf(await call("wilma_logout"))).logins[0].session, "none", "idempotent");

  // Wilma down: an error result, and the session can be ended on a retry.
  await call("wilma_account");
  wilma.homeOutage = true;
  const failed = await call("wilma_logout");
  wilma.homeOutage = false;
  assert.equal(failed.isError, true);
  assert.match(textOf(failed), /Couldn't log out of Wilma/);
  assert.notEqual(wilma.currentSid, null);
  assert.equal(JSON.parse(textOf(await call("wilma_logout"))).logins[0].session, "ended");
  assert.equal(wilma.currentSid, null);

  console.log("logout: all assertions passed");
} finally {
  await mcp?.close();
  wilma.close();
  other.close();
  await rm(tempDirectory, { recursive: true, force: true });
}
