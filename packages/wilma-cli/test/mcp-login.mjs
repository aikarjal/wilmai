import assert from "node:assert/strict";
import vm from "node:vm";
import { createServer } from "node:http";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { appName } from "../dist/login-server.js";

const execFileAsync = promisify(execFile);
const tempDirectory = await mkdtemp(join(tmpdir(), "wilmai-mcp-login-"));
const cliPath = resolve(new URL("../dist/index.js", import.meta.url).pathname);

// Minimal mock Wilma: one guardian account with two children.
const wilma = createServer(async (req, res) => {
  const send = (status, type, body, headers = {}) => {
    res.writeHead(status, { "Content-Type": type, ...headers });
    res.end(body);
  };
  if (req.method === "GET" && req.url === "/login") {
    return send(200, "text/html", '<input type="hidden" name="SESSIONID" value="test-session">');
  }
  if (req.method === "POST" && req.url === "/login") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const form = new URLSearchParams(body);
    // Wilma usernames are case-insensitive.
    if (form.get("Login")?.toLowerCase() === "test-user" && form.get("Password") === "test-password") {
      return send(200, "text/plain", "ok", { "Set-Cookie": "Wilma2SID=test-cookie; Path=/; HttpOnly" });
    }
    return send(200, "text/html", "<div>loginfailed</div>");
  }
  if (req.method === "GET" && req.url === "/") {
    return send(200, "text/html", '<a href="/!123/">Test Student</a><a href="/!456/">Toinen Oppilas</a>');
  }
  const student = /^\/!(123|456)(\/.*)$/.exec(req.url ?? "");
  if (student) {
    const path = student[2];
    if (path === "/overview") return send(200, "application/json", "{}");
    if (path === "/news") return send(200, "application/json", "[]");
    if (path === "/messages/list") return send(200, "application/json", '{"Messages": []}');
    if (path === "/news/42" && student[1] === "123") {
      return send(200, "text/html", `
        <title>Retkilupa - Wilma</title>
        <div id="news-content">
          <p>Palauta lupa perjantaihin mennessa.</p>
          <a href="/files/retkilupa.pdf" download>Retkilupa</a>
        </div>`);
    }
    if (path === "/files/retkilupa.pdf" && student[1] === "123") {
      return send(200, "application/pdf", "test-pdf-bytes", {
        "Content-Disposition": 'attachment; filename="retkilupa.pdf"',
      });
    }
  }
  send(404, "text/plain", `Unexpected ${req.method} ${req.url}`);
});
await new Promise((r) => wilma.listen(0, "127.0.0.1", r));
const wilmaUrl = `http://127.0.0.1:${wilma.address().port}`;

// A second school's Wilma: one more child, and it can be "taken down".
let secondDown = false;
const wilma2 = createServer(async (req, res) => {
  const send = (status, type, body, headers = {}) => {
    res.writeHead(status, { "Content-Type": type, ...headers });
    res.end(body);
  };
  if (secondDown) return send(503, "text/plain", "down");
  if (req.method === "GET" && req.url === "/login") return send(200, "text/html", '<input type="hidden" name="SESSIONID" value="s2">');
  if (req.method === "POST" && req.url === "/login") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const form = new URLSearchParams(body);
    if (form.get("Login") === "parent2" && form.get("Password") === "pw2") {
      return send(200, "text/plain", "ok", { "Set-Cookie": "Wilma2SID=c2; Path=/; HttpOnly" });
    }
    return send(200, "text/html", "<div>loginfailed</div>");
  }
  if (req.url === "/") return send(200, "text/html", '<a href="/!789/">Eino Kolmas</a>');
  if (req.url === "/!789/overview") return send(200, "application/json", "{}");
  if (req.url === "/!789/news") return send(200, "application/json", "[]");
  if (req.url === "/!789/messages/list") return send(200, "application/json", '{"Messages": []}');
  send(404, "text/plain", "nope");
});
await new Promise((r) => wilma2.listen(0, "127.0.0.1", r));
const wilma2Url = `http://127.0.0.1:${wilma2.address().port}`;

const baseEnv = (configPath, extra = {}) => {
  const env = { ...process.env, WILMAI_CONFIG_PATH: configPath, WILMAI_NO_BROWSER: "1", WILMAI_NO_UPDATE_CHECK: "1", ...extra };
  for (const key of ["WILMA_TENANT", "WILMA_USERNAME", "WILMA_PASSWORD", "WILMA_TOTP_SECRET"]) {
    if (!(key in extra)) delete env[key];
  }
  return env;
};

const textOf = (result) => result.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
const jsonOf = (result) => JSON.parse(result.content[0].text);

try {
  /* ---------------- MCP: not logged in -> browser login -> data ---------------- */
  const mcpConfig = join(tempDirectory, "mcp-config.json");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliPath, "mcp"],
    env: baseEnv(mcpConfig),
    stderr: "pipe",
  });
  // Named like Claude Desktop, so the login page says who opened it.
  const client = new Client({ name: "claude-ai", version: "0.0.0" });
  await client.connect(transport);

  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  for (const expected of [
    "wilma_account", "wilma_find_school", "wilma_get_news_attachment", "wilma_grades", "wilma_homework", "wilma_lesson_notes",
    "wilma_list_messages", "wilma_list_news", "wilma_login", "wilma_read_message", "wilma_read_news",
    "wilma_schedule", "wilma_summary", "wilma_upcoming_exams",
  ]) {
    assert.ok(names.includes(expected), `missing tool ${expected}`);
  }
  for (const tool of tools) {
    assert.ok(tool.title || tool.annotations?.title, `${tool.name} has no title`);
    assert.equal(typeof tool.annotations?.readOnlyHint, "boolean", `${tool.name} lacks readOnlyHint`);
    assert.equal(tool.annotations?.destructiveHint, false, `${tool.name} should not be destructive`);
  }

  const schools = jsonOf(await client.callTool({ name: "wilma_find_school", arguments: { query: "Tampere" } }));
  assert.equal(schools.wilmas[0].url, "https://opetustampere.inschool.fi");

  const notLoggedIn = await client.callTool({ name: "wilma_summary", arguments: {} });
  assert.equal(notLoggedIn.isError, true);
  const loginUrl = /http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]+\//.exec(textOf(notLoggedIn))?.[0];
  assert.ok(loginUrl, "login URL in tool result");
  assert.match(textOf(notLoggedIn), /WILMA_PASSWORD/);

  // The page needs the one-time token; the root path is not served.
  const origin = new URL(loginUrl).origin;
  assert.equal((await fetch(origin + "/")).status, 404);
  const page = await fetch(loginUrl);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  const pageHtml = await page.text();
  assert.match(pageHtml, /Log in to Wilma/);
  // Who opened the page: the app's own name, mapped to a plain one; unknown apps get no line.
  assert.match(pageHtml, /const OPENED_BY = \{"app":"Claude"\};/);
  assert.match(pageHtml, /This page isn't a website/);
  assert.equal(appName({ name: "claude-code" }), "Claude Code");
  assert.equal(appName({ name: "codex-mcp-client" }), "Codex");
  assert.equal(appName({ name: "some-mcp-client" }), undefined);
  assert.equal(appName({ name: "x", title: "Goose" }), "Goose");
  // The page's script must at least parse (a template-literal escaping slip once broke it).
  const pageScript = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(pageHtml)[1];
  assert.doesNotThrow(() => new vm.Script(pageScript), "login page script has a syntax error");

  // Municipality search matches Swedish names and puts the city's Wilma first.
  const tenants = await (await fetch(loginUrl + "api/tenants?q=helsingfors")).json();
  assert.equal(tenants.tenants[0].url, "https://helsinki.inschool.fi");

  const post = (body, headers = {}) =>
    fetch(loginUrl + "api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin, ...headers },
      body: JSON.stringify(body),
    });
  const creds = { tenantUrl: wilmaUrl, tenantName: "Test Wilma", username: "test-user", password: "test-password" };

  assert.equal((await post(creds, { Origin: "https://evil.example" })).status, 403);
  assert.equal((await (await post({ ...creds, password: "wrong" })).json()).code, "bad_credentials");
  const ok = await (await post(creds)).json();
  assert.equal(ok.status, "ok");
  assert.deepEqual(ok.students, ["Test Student", "Toinen Oppilas"]);

  const saved = JSON.parse(await readFile(mcpConfig, "utf8"));
  assert.equal(saved.profiles[0].tenantUrl, wilmaUrl);
  assert.equal(saved.profiles[0].students.length, 2);
  assert.ok(!JSON.stringify(saved).includes("test-password"), "password is not stored in plain text");

  const summary = await client.callTool({ name: "wilma_summary", arguments: {} });
  assert.ok(!summary.isError, textOf(summary));
  const summaryData = jsonOf(summary);
  assert.equal(summaryData.students.length, 2);
  assert.ok("todaySchedule" in summaryData.students[0].summary);

  const one = jsonOf(await client.callTool({ name: "wilma_homework", arguments: { student: "toinen" } }));
  assert.deepEqual(one.students.map((s) => s.student.name), ["Toinen Oppilas"]);

  const noSuch = await client.callTool({ name: "wilma_homework", arguments: { student: "Nobody" } });
  assert.equal(noSuch.isError, true);
  assert.match(textOf(noSuch), /Test Student, Toinen Oppilas/);

  const badDate = await client.callTool({ name: "wilma_schedule", arguments: { date: "2026-02-30" } });
  assert.equal(badDate.isError, true);

  // Reading without a student tries each child until one can open the item.
  const news = jsonOf(await client.callTool({ name: "wilma_read_news", arguments: { id: 42 } }));
  assert.equal(news.student.name, "Test Student");
  assert.equal(news.news.resources[0].id, "resource-1");

  const attachment = await client.callTool({
    name: "wilma_get_news_attachment",
    arguments: { news_id: 42, resource_id: "1" },
  });
  assert.ok(!attachment.isError, textOf(attachment));
  assert.equal(jsonOf(attachment).fileName, "retkilupa.pdf");
  const blob = attachment.content.find((c) => c.type === "resource");
  assert.equal(blob.resource.mimeType, "application/pdf");
  assert.equal(Buffer.from(blob.resource.blob, "base64").toString("utf8"), "test-pdf-bytes");

  const account = jsonOf(await client.callTool({ name: "wilma_account", arguments: {} }));
  assert.equal(account.connected, true);
  assert.equal(account.wilmas.length, 1);
  assert.equal(account.wilmas[0].children.length, 2);

  /* ---------------- several Wilmas (children at different schools) ---------------- */
  // The login page stays open after a login, so a second Wilma can be added on it.
  const second = await (await post({ tenantUrl: wilma2Url, tenantName: "Second Wilma", username: "parent2", password: "pw2" })).json();
  assert.equal(second.status, "ok");
  assert.deepEqual(second.accounts.map((a) => a.students.length), [2, 1]);

  // Same account, different capitalisation: updates the saved login instead of adding one.
  const recased = await (await post({ ...creds, username: "TEST-User" })).json();
  assert.equal(recased.status, "ok");
  assert.equal(recased.accounts.length, 2, "no duplicate login for a different-case username");
  // An older config that already holds both spellings still yields one session per account.
  const { resolveAccounts } = await import("../dist/credentials.js");
  const dupConfig = JSON.parse(await readFile(mcpConfig, "utf8"));
  const original = dupConfig.profiles.find((p) => p.tenantUrl === wilmaUrl);
  dupConfig.profiles.push({ ...original, id: `${wilmaUrl}|test-user`, username: "test-user" });
  assert.equal((await resolveAccounts(dupConfig, {})).length, 2, "case duplicates resolve to one account");

  const family = jsonOf(await client.callTool({ name: "wilma_summary", arguments: {} }));
  assert.deepEqual(family.students.map((s) => s.student.name).sort(), ["Eino Kolmas", "Test Student", "Toinen Oppilas"]);
  assert.equal(family.students.find((s) => s.student.name === "Eino Kolmas").student.wilma, "Second Wilma");
  const einoOnly = jsonOf(await client.callTool({ name: "wilma_homework", arguments: { student: "eino" } }));
  assert.deepEqual(einoOnly.students.map((s) => s.student.name), ["Eino Kolmas"]);
  const familyAccount = jsonOf(await client.callTool({ name: "wilma_account", arguments: {} }));
  assert.equal(familyAccount.wilmas.length, 2);

  // One Wilma down: the other still answers, and the problem is reported.
  secondDown = true;
  const partial = jsonOf(await client.callTool({ name: "wilma_summary", arguments: {} }));
  secondDown = false;
  assert.equal(partial.students.length, 2);
  assert.equal(partial.problems[0].wilma, "Second Wilma");

  // Done closes the page.
  assert.equal((await (await fetch(loginUrl + "api/done", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: "{}" })).json()).status, "ok");
  await new Promise((r) => setTimeout(r, 500));
  await assert.rejects(fetch(loginUrl));
  await client.close();

  /* ---------------- CLI across several Wilmas ---------------- */
  const kids = JSON.parse((await execFileAsync(process.execPath, [cliPath, "kids", "list", "--json"], { env: baseEnv(mcpConfig) })).stdout);
  assert.deepEqual(kids.students.map((k) => k.name).sort(), ["Eino Kolmas", "Test Student", "Toinen Oppilas"]);
  assert.ok(kids.students.every((k) => k.wilma), "children are labelled with their Wilma");
  const einoSummary = JSON.parse((await execFileAsync(process.execPath, [cliPath, "summary", "--student", "Eino", "--json"], { env: baseEnv(mcpConfig) })).stdout);
  assert.deepEqual(einoSummary.students.map((s) => s.student.name), ["Eino Kolmas"]);
  // Every child by default, on both Wilmas; --all-students is still accepted.
  const allSummary = JSON.parse((await execFileAsync(process.execPath, [cliPath, "summary"], { env: baseEnv(mcpConfig) })).stdout);
  assert.equal(allSummary.students.length, 3);
  assert.equal(JSON.parse((await execFileAsync(process.execPath, [cliPath, "summary", "--all-students"], { env: baseEnv(mcpConfig) })).stdout).students.length, 3);
  const accountsList = JSON.parse((await execFileAsync(process.execPath, [cliPath, "accounts", "--json"], { env: baseEnv(mcpConfig) })).stdout);
  assert.deepEqual(accountsList.accounts.map((a) => a.wilma), ["Test Wilma", "Second Wilma"]);
  await execFileAsync(process.execPath, [cliPath, "accounts", "remove", "2"], { env: baseEnv(mcpConfig) });
  const afterRemove = JSON.parse((await execFileAsync(process.execPath, [cliPath, "accounts", "--json"], { env: baseEnv(mcpConfig) })).stdout);
  assert.deepEqual(afterRemove.accounts.map((a) => a.wilma), ["Test Wilma"]);

  /* ---------------- CLI: non-interactive login ---------------- */
  const cliConfig = join(tempDirectory, "cli-config.json");
  const { stdout: loginOut } = await execFileAsync(
    process.execPath,
    [cliPath, "login", "--tenant", wilmaUrl, "--username", "test-user", "--json"],
    { env: baseEnv(cliConfig, { WILMA_PASSWORD: "test-password" }) }
  );
  assert.equal(JSON.parse(loginOut).status, "ok");
  assert.deepEqual(JSON.parse(loginOut).students, ["Test Student", "Toinen Oppilas"]);

  // Password via stdin works too; a --password flag is refused.
  const piped = spawn(process.execPath, [cliPath, "login", "--tenant", wilmaUrl, "--username", "test-user", "--password-stdin", "--json"], {
    env: baseEnv(join(tempDirectory, "stdin-config.json")),
  });
  piped.stdin.end("test-password\n");
  let pipedOut = "";
  piped.stdout.on("data", (d) => (pipedOut += d));
  assert.equal(await new Promise((r) => piped.on("close", r)), 0);
  assert.equal(JSON.parse(pipedOut).status, "ok");

  await assert.rejects(
    execFileAsync(process.execPath, [cliPath, "login", "--tenant", wilmaUrl, "--username", "u", "--password", "x"], {
      env: baseEnv(cliConfig),
    }),
    (err) => {
      const failure = JSON.parse(err.stdout);
      return err.code === 2 && failure.code === "invalid_argument" && /shell history/.test(failure.message);
    }
  );

  /* ---------------- CLI: env-var account, no config ---------------- */
  const { stdout: kidsOut } = await execFileAsync(process.execPath, [cliPath, "kids", "list", "--json"], {
    env: baseEnv(join(tempDirectory, "missing.json"), {
      WILMA_TENANT: wilmaUrl,
      WILMA_USERNAME: "test-user",
      WILMA_PASSWORD: "test-password",
    }),
  });
  assert.deepEqual(JSON.parse(kidsOut).students.map((s) => s.name), ["Test Student", "Toinen Oppilas"]);

  /* ---------------- CLI: browser login flow ---------------- */
  const browserConfig = join(tempDirectory, "browser-config.json");
  const child = spawn(process.execPath, [cliPath, "login", "--no-browser", "--json"], { env: baseEnv(browserConfig) });
  let childOut = "";
  child.stdout.on("data", (d) => (childOut += d));
  const waiting = await new Promise((r) => {
    let buffer = "";
    child.stderr.on("data", (d) => {
      buffer += d;
      const line = buffer.split("\n").find((l) => l.includes('"waiting"'));
      if (line) r(JSON.parse(line));
    });
  });
  const res = await fetch(waiting.url + "api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: new URL(waiting.url).origin },
    body: JSON.stringify(creds),
  });
  assert.equal((await res.json()).status, "ok");
  // The CLI waits for Done on the page (another Wilma could still be added).
  await fetch(waiting.url + "api/done", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: new URL(waiting.url).origin },
    body: "{}",
  });
  assert.equal(await new Promise((r) => child.on("close", r)), 0);
  assert.equal(JSON.parse(childOut).logins[0].username, "test-user");

  console.log("mcp-login: all assertions passed");
} finally {
  wilma.close();
  wilma2.close();
  await rm(tempDirectory, { recursive: true, force: true });
}
