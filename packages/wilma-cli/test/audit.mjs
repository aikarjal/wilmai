// Regression tests for the CLI audit: safe download names, strict --student
// matching, argument checks, errors as JSON, a damaged config left alone,
// config permissions, Finnish dates, terminal escapes and install paths with
// spaces. Runs the built CLI against a mock Wilma with two children.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fileNameFromResponse, sanitizeFileName } from "../dist/downloads.js";
import { matchStudents } from "../dist/agent-data.js";

// Anonymised real pages, shared with the client's tests.
const real = (name) => readFileSync(new URL(`../../wilma-client/test/fixtures/real/${name}`, import.meta.url), "utf8");

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
let logins = 0;
const wilma = createServer(async (req, res) => {
  for await (const _ of req);
  const send = (status, type, body, headers = {}) => {
    res.writeHead(status, { "Content-Type": type, ...headers });
    res.end(body);
  };
  const base = `http://127.0.0.1:${wilma.address().port}`;
  if (req.method === "GET" && req.url === "/login") return send(200, "text/html", '<input type="hidden" name="SESSIONID" value="s">');
  if (req.method === "POST" && req.url === "/login") {
    logins += 1;
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
  if (/^\/!\d+\/messages\/41\?format=json$/.test(req.url)) return send(200, "application/json", real("message-thread.json"));
  if (/^\/!\d+\/news$/.test(req.url)) return send(200, "text/html", real("news-list.html"));
  if (/^\/!\d+\/attendance\/view/.test(req.url)) return send(200, "text/html", real("attendance.html"));
  if (/^\/!7\/gradebook$/.test(req.url)) return send(200, "text/html", real("gradebook.html"));
  if (/^\/!8\/gradebook$/.test(req.url)) return send(200, "text/html", real("gradebook-empty.html"));
  if (/^\/!\d+\/printouts$/.test(req.url)) return send(200, "text/html", real("printouts.html"));
  if (/^\/!\d+\/printouts\/\d+\.pdf$/.test(req.url)) return send(200, "application/pdf", "%PDF-1.4 test");
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

const env = { ...process.env, WILMAI_CONFIG_PATH: configPath, WILMAI_NO_BROWSER: "1", WILMAI_NO_UPDATE_CHECK: "1" };
for (const key of ["WILMA_TENANT", "WILMA_USERNAME", "WILMA_PASSWORD", "WILMA_TOTP_SECRET"]) delete env[key];
const run = (args, opts = {}) =>
  new Promise((resolve) =>
    execFile(process.execPath, [opts.cli ?? cliPath, ...args], { env: opts.env ?? env }, (error, stdout, stderr) =>
      resolve({ code: error ? error.code : 0, stdout, stderr })
    )
  );
const json = async (args, opts) => {
  const result = await run(args, opts);
  assert.equal(result.code, 0, `${args.join(" ")}: ${result.stdout} ${result.stderr}`);
  return JSON.parse(result.stdout);
};
const jsonError = async (args, code, pattern, label, exitCode = code === "invalid_argument" || code === "unknown_command" ? 2 : 1) => {
  const result = await run(args);
  assert.equal(result.code, exitCode, `${label}: exit code`);
  const body = JSON.parse(result.stdout);
  assert.equal(body.status, "error", label);
  assert.equal(body.code, code, label);
  assert.match(body.message, pattern, label);
  return body;
};

try {
  // Errors are JSON (piped output is JSON without --json), with a code and exit code 2 for usage errors.
  await jsonError(["sumary"], "unknown_command", /Unknown command "sumary"/, "unknown command");
  await jsonError(["news", "lsit"], "invalid_argument", /Invalid news id "lsit"/, "not a news id");
  await jsonError(["messages", "--studnet", "Emilia"], "invalid_argument", /Unknown option "--studnet"/, "unknown flag");
  await jsonError(["messages", "--student"], "invalid_argument", /--student needs a value/, "flag without a value");
  await jsonError(["messages", "--limit", "-1"], "invalid_argument", /--limit must be a whole number/, "negative limit");
  await jsonError(["messages", "--folder", "spam"], "invalid_argument", /--folder must be one of/, "unknown folder");
  await jsonError(["schedule", "someday"], "invalid_argument", /Unknown period "someday"/, "unknown period");
  await jsonError(["notes", "--date", "2026-02-30"], "invalid_argument", /Invalid date/, "impossible date");
  await jsonError(["news", "read"], "invalid_argument", /Missing news id/, "read without an id");
  const unknown = await jsonError(["messages", "--student", "Ella"], "unknown_student", /No student matching "Ella"/, "no loose name match");
  assert.deepEqual(unknown.students.map((s) => s.name), ["Daniella Korhonen", "Emilia Mattila"], "the error lists the children");
  await jsonError(["notes", "--days", "3", "--date", "2026-09-30"], "invalid_argument", /Use one of/, "conflicting periods");
  const noLogin = await run(["summary"], { env: { ...env, WILMAI_CONFIG_PATH: join(tempDirectory, "none.json") } });
  assert.equal(noLogin.code, 3);
  assert.equal(JSON.parse(noLogin.stdout).code, "not_logged_in");

  // Help: the overview, and per command with examples.
  assert.match((await run(["--help"])).stdout, /summary .*start here/);
  assert.match((await run(["help", "schedule"])).stdout, /Usage: wilma schedule[\s\S]*Examples:/);
  assert.match((await run(["notes", "--help"])).stdout, /Usage: wilma notes/);
  assert.match((await run([])).stdout, /Usage: wilma <command>/, "no command from a program: help, not a prompt");

  // Every child by default; a strict --student narrows; text in Finnish time without terminal escapes.
  const all = await json(["messages"]);
  assert.deepEqual(all.students.map((s) => s.student.name), ["Daniella Korhonen", "Emilia Mattila"]);
  const list = await run(["messages", "--student", "Emilia", "--text"]);
  assert.equal(list.code, 0, list.stderr);
  assert.match(list.stdout, /2026-02-05 Retki huomenna/, "Finnish date, text kept");
  assert.ok(!/[\u001b\u0007]/.test(list.stdout), "escape sequences removed");
  const listRaw = (await run(["messages", "--student", "emi"])).stdout;
  assert.ok(!/[\u001b\u0007\u009b]/.test(listRaw), "JSON output is escaped, not raw");
  assert.ok(!/fetchedAt|typeClass|sendersJson/.test(listRaw), "no bookkeeping fields");
  assert.ok(!listRaw.includes("\n  "), "compact JSON for programs");
  const message = JSON.parse(listRaw).students[0].messages[0];
  assert.equal(message.wilmaId, 41);
  assert.equal(message.sentAt, "2026-02-05T01:30:00+02:00", "Finnish time with its offset, not UTC");
  assert.equal(message.subject, "\u001b]0;pwned\u0007Retki\u001b[2J huomenna\u009b", "JSON keeps the data as it is");

  // Bulletins: newest dated ones and every pinned one by default; older ones with --older.
  const news = (await json(["news", "--student", "8"])).students[0].news;
  assert.equal(news.length, 24);
  assert.equal(news.filter((n) => n.pinned).length, 11);
  assert.equal((await json(["news", "list", "--student", "8", "--older", "--json"])).students[0].news.length, 42, "1.x spelling");
  assert.match((await run(["news", "--student", "8", "--text"])).stdout, /\[pinned\]/);

  // A thread's replies, in JSON and in the terminal — no --student needed to read one.
  const thread = await json(["messages", "41"]);
  assert.equal(thread.message.replies.length, 1);
  assert.equal(thread.student.name, "Daniella Korhonen");
  assert.match((await run(["messages", "read", "41", "--text"])).stdout, /--- Reply from .+\n\S/);

  // Lesson notes with the teacher's words, and the summary (1.x `attendance` spelling too).
  const notes = await json(["notes", "--student", "8", "--from", "2026-08-01", "--to", "2026-10-31"]);
  assert.equal(notes.from, "2026-08-01");
  assert.equal(notes.students[0].notes.length, 57);
  assert.ok(notes.students[0].notes.some((n) => n.note));
  assert.equal((await json(["attendance", "list", "--student", "8", "--from", "2026-08-01", "--to", "2026-10-31"])).students[0].notes.length, 57);
  assert.equal((await json(["notes", "summary", "--student", "8"])).students[0].summary.total, 57);

  // The summary has lesson notes, unread counts and Finnish times.
  const summary = await json(["summary", "--since", "2026-01-01"]);
  const daniella = summary.students[0].summary;
  assert.equal(summary.since, "2026-01-01");
  assert.ok(Array.isArray(daniella.lessonNotes) && "unreadMessages" in daniella);
  assert.equal(daniella.messages[0].sentAt, "2026-02-05T01:30:00+02:00");

  // Gradebook (one child graded, one not yet) and printouts.
  const gradebooks = await json(["gradebook"]);
  assert.deepEqual(gradebooks.students.map((s) => s.gradebook.length), [21, 0]);
  assert.match((await run(["gradebook", "--student", "8", "--text"])).stdout, /No graded courses yet/);
  const printouts = (await json(["printouts", "--student", "8"])).students[0].printouts;
  assert.equal(printouts.length, 1);
  const dl = await mkdtemp(join(tmpdir(), "wilmai-printout-"));
  const saved = await json(["printouts", printouts[0].id, "--student", "8", "--output", dl]);
  assert.equal(saved.status, "downloaded");
  assert.equal(await readFile(saved.path, "utf8"), "%PDF-1.4 test");
  await rm(dl, { recursive: true, force: true });

  // 1.x spellings still work.
  assert.equal((await json(["kids", "list", "--json"])).students.length, 2);
  assert.ok((await json(["tenants", "helsinki"])).wilmas.length > 0);

  // One login for all of the above: commands continue the saved session.
  assert.equal(logins, 1, `logins: ${logins}`);

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
  assert.equal(JSON.parse(broken.stdout).code, "config_invalid");
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
