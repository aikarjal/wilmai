// Regression tests for the CLI audit: safe download names, strict --student
// matching, argument checks, errors as JSON, a damaged config left alone,
// config permissions, Finnish dates, terminal escapes and install paths with
// spaces. Runs the built CLI against a mock Wilma with two children.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fileNameFromResponse, sanitizeFileName } from "../dist/downloads.js";
import { matchStudents } from "../dist/agent-data.js";

/* ---------------- download names ---------------- */
assert.equal(sanitizeFileName(" .npmrc"), "npmrc", "no hidden files via a leading space");
assert.equal(sanitizeFileName(".. "), "");
assert.equal(sanitizeFileName("CON.txt"), "_CON.txt", "Windows device names");
assert.equal(sanitizeFileName("lasku‮fdp.exe"), "laskufdp.exe", "no text-direction tricks");
assert.equal(sanitizeFileName("a\u0085b/c"), "a_b_c");
assert.equal(fileNameFromResponse({ id: "resource-1", label: "..", url: "x" }, null, "application/pdf"), "wilma-resource.pdf");
assert.equal(fileNameFromResponse({ id: "r", label: "x", url: "x" }, 'attachment; filename=" .bashrc"', null), "bashrc");

/* ---------------- strict student matching ---------------- */
const kids = [
  { studentNumber: "7", name: "Daniella Korhonen" },
  { studentNumber: "8", name: "Emilia Mattila" },
];
assert.throws(() => matchStudents(kids, "Ella"), /No student matching "Ella"/, "a substring is not a match");
assert.throws(() => matchStudents(kids, "Emma"), /No student matching/);
assert.equal(matchStudents(kids, "emi")[0].studentNumber, "8", "start of a name");
assert.equal(matchStudents(kids, "Mattila")[0].studentNumber, "8", "start of a name part");
assert.equal(matchStudents(kids, "7")[0].name, "Daniella Korhonen");

/* ---------------- mock Wilma ---------------- */
const wilma = createServer(async (req, res) => {
  for await (const _ of req);
  const send = (status, type, body, headers = {}) => {
    res.writeHead(status, { "Content-Type": type, ...headers });
    res.end(body);
  };
  const base = `http://127.0.0.1:${wilma.address().port}`;
  if (req.method === "GET" && req.url === "/login") return send(200, "text/html", '<input type="hidden" name="SESSIONID" value="s">');
  if (req.method === "POST" && req.url === "/login") {
    return send(303, "text/plain", "", { Location: `${base}/?checkcookie`, "Set-Cookie": "Wilma2SID=ok; Path=/" });
  }
  if (req.url === "/?checkcookie") return send(200, "text/html", "home");
  if (!/Wilma2SID=ok/.test(req.headers.cookie ?? "")) return send(401, "text/plain", "");
  if (req.url === "/api/v1/accounts/me/roles") return send(404, "text/plain", "");
  if (req.url === "/") return send(200, "text/html", '<a href="/!7/">Daniella Korhonen</a><a href="/!8/">Emilia Mattila</a>');
  if (/^\/!\d+\/messages\/list$/.test(req.url)) {
    // 01:30 Finnish time is still the previous day in UTC.
    return send(200, "application/json", JSON.stringify({
      Messages: [{ Id: 41, Subject: "\u001b]0;pwned\u0007Retki\u001b[2J huomenna\u009b", TimeStamp: "2026-02-05 01:30", Sender: "Opettaja" }],
    }));
  }
  if (/^\/!\d+\/overview$/.test(req.url)) return send(200, "application/json", "{}");
  send(404, "text/plain", "");
});
await new Promise((r) => wilma.listen(0, "127.0.0.1", r));
const wilmaUrl = `http://127.0.0.1:${wilma.address().port}`;

const tempDirectory = await mkdtemp(join(tmpdir(), "wilmai-audit-"));
const cliPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const configPath = join(tempDirectory, "config.json");
const config = {
  profiles: [{
    id: `${wilmaUrl}|parent`,
    tenantUrl: wilmaUrl,
    tenantName: "Mock Wilma",
    username: "parent",
    passwordObfuscated: Buffer.from("wilmai::pw").toString("base64"),
    students: kids,
    lastUsedAt: new Date().toISOString(),
  }],
  lastProfileId: `${wilmaUrl}|parent`,
};
await writeFile(configPath, JSON.stringify(config));
// A fresh update check result, so the tests never contact npm.
await writeFile(join(tempDirectory, "version-check.json"), JSON.stringify({ latestVersion: "0.0.1", checkedAt: Date.now() }));

const env = { ...process.env, WILMAI_CONFIG_PATH: configPath, WILMAI_NO_BROWSER: "1" };
for (const key of ["WILMA_TENANT", "WILMA_USERNAME", "WILMA_PASSWORD", "WILMA_TOTP_SECRET"]) delete env[key];
const run = (args, opts = {}) =>
  new Promise((resolve) =>
    execFile(process.execPath, [opts.cli ?? cliPath, ...args], { env: opts.env ?? env }, (error, stdout, stderr) =>
      resolve({ code: error ? error.code : 0, stdout, stderr })
    )
  );
const jsonError = async (args, pattern, label) => {
  const result = await run([...args, "--json"]);
  assert.equal(result.code, 1, `${label}: exit code`);
  const body = JSON.parse(result.stdout);
  assert.equal(body.status, "error", label);
  assert.match(body.message, pattern, label);
};

try {
  // Errors are JSON with --json, and exit 1.
  await jsonError(["sumary"], /Unknown command "sumary"/, "unknown command");
  await jsonError(["news", "lsit"], /Unknown subcommand "lsit"/, "unknown subcommand");
  await jsonError(["messages", "list", "--studnet", "Emilia"], /Unknown option "--studnet"/, "unknown flag");
  await jsonError(["messages", "list", "--student"], /--student needs a value/, "flag without a value");
  await jsonError(["messages", "list", "--limit", "-1"], /--limit must be a whole number/, "negative limit");
  await jsonError(["messages", "list", "--folder", "spam"], /--folder must be one of/, "unknown folder");
  await jsonError(["schedule", "list", "--when", "someday"], /--when must be one of/, "unknown --when");
  await jsonError(["attendance", "list", "--date", "2026-02-30"], /Invalid date/, "impossible date");
  await jsonError(["news", "read"], /Missing news id/, "read without an id");
  await jsonError(["messages", "list", "--student", "Ella"], /No student matching "Ella"/, "no loose name match");
  await jsonError(["messages", "read", "41"], /Several students on this login/, "reading needs a student");

  // A strict match works, and human output is in Finnish time without terminal escapes.
  const list = await run(["messages", "list", "--student", "Emilia"]);
  assert.equal(list.code, 0, list.stderr);
  assert.match(list.stdout, /2026-02-05 Retki huomenna/, "Finnish date, text kept");
  assert.ok(!/[\u001b\u0007]/.test(list.stdout), "escape sequences removed");
  const listRaw = (await run(["messages", "list", "--student", "emi", "--json"])).stdout;
  assert.ok(!/[\u001b\u0007\u009b]/.test(listRaw), "JSON output is escaped, not raw");
  const listJson = JSON.parse(listRaw);
  assert.equal(listJson[0].wilmaId, 41);
  assert.equal(listJson[0].subject, "\u001b]0;pwned\u0007Retki\u001b[2J huomenna\u009b", "JSON keeps the data as it is");

  // A loose config file is tightened to this user only.
  if (process.platform !== "win32") {
    await chmod(configPath, 0o644);
    await run(["accounts", "--json"]);
    assert.equal((await stat(configPath)).mode & 0o777, 0o600, "config.json is private");
  }

  // A damaged config is reported, never overwritten.
  const damaged = JSON.stringify(config).replace(/}$/, ",}");
  await writeFile(configPath, damaged);
  const broken = await run(["accounts", "--json"]);
  assert.equal(broken.code, 1);
  assert.match(JSON.parse(broken.stdout).message, /isn't valid JSON/);
  assert.equal(await readFile(configPath, "utf8"), damaged, "file left as it was");
  await writeFile(configPath, JSON.stringify(config));

  // --version works from an install path with a space and non-ASCII letters.
  const installDir = join(tempDirectory, "Jyrki Mäkelä", "wilma-cli");
  await mkdir(installDir, { recursive: true });
  const packageDir = fileURLToPath(new URL("..", import.meta.url));
  await cp(join(packageDir, "dist"), join(installDir, "dist"), { recursive: true });
  await cp(join(packageDir, "package.json"), join(installDir, "package.json"));
  await symlink(join(packageDir, "node_modules"), join(installDir, "node_modules"));
  const version = await run(["--version"], { cli: join(installDir, "dist", "index.js") });
  assert.equal(version.code, 0, version.stderr);
  assert.equal(version.stdout.trim(), JSON.parse(await readFile(join(packageDir, "package.json"), "utf8")).version);

  console.log("cli-audit: all assertions passed");
} finally {
  wilma.close();
  await rm(tempDirectory, { recursive: true, force: true });
}
