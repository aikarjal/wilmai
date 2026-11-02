// A family with two Wilmas, and a parent's and a child's own login on the
// same one: which login reads each child, what wilma_account and `wilma
// accounts` say, and the reads WilmAI Home has (class and teachers, past
// exams, invitation answers, any week's lessons, lesson notes ahead). Runs
// the built CLI and MCP server against two mock Wilmas.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Anonymised real pages, shared with the client's tests.
const real = (name) => readFileSync(new URL(`../../wilma-client/test/fixtures/real/${name}`, import.meta.url), "utf8");

/** YYYY-MM-DD in Finnish time, `days` from today. */
const finnishDay = (days = 0) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Helsinki" }).format(new Date(Date.now() + days * 86_400_000));
const addDays = (iso, days) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const today = finnishDay();
const monday = addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
// Wilma's date forms: the past-exams list's "1.8.2026", the lesson notes page's "01.08.2026".
const fi = (iso) => iso.split("-").reverse().map(Number).join(".");
const dmy = (iso) => iso.split("-").reverse().join(".");

// One lesson this week by the own teacher "Gusitutemu Lebit (Mas)" of the recipient list.
const lesson = JSON.parse(real("timetable.json")).payload[0];
const timetable = JSON.stringify({
  payload: [{ ...lesson, dates: [monday], modules: [{ ...lesson.modules[0], courseName: "Matematiikka", teachers: [{ ...lesson.modules[0].teachers[0], abbreviation: "Mas" }] }] }],
});

/**
 * A mock Wilma: each username is a login with its role, children and inbox.
 * Requests are recorded, to check what was asked for.
 */
function mockWilma(name, users) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const send = (status, type, text, headers = {}) => {
      res.writeHead(status, { "Content-Type": type, ...headers });
      res.end(text);
    };
    const base = `http://127.0.0.1:${server.address().port}`;
    if (req.url === "/login" && req.method === "GET") return send(200, "text/html", '<input type="hidden" name="SESSIONID" value="s">');
    if (req.url === "/login") {
      const login = new URLSearchParams(body).get("Login");
      return send(303, "text/plain", "", { Location: `${base}/?checkcookie`, "Set-Cookie": `Wilma2SID=${login}; Path=/` });
    }
    if (req.url === "/?checkcookie") return send(200, "text/html", "home");
    const username = /Wilma2SID=(\w+)/.exec(req.headers.cookie ?? "")?.[1];
    const user = users[username];
    if (!user) return send(401, "text/plain", "");
    requests.push(`${username} ${req.url}`);
    const url = req.url;
    if (url === "/api/v1/accounts/me/roles") {
      return send(200, "application/json", JSON.stringify({ payload: user.children.map(([number, child]) => ({ type: user.role, slug: `!${number}`, name: child })) }));
    }
    if (/^\/!\d+\/messages\/list$/.test(url)) {
      return send(200, "application/json", JSON.stringify({ Messages: user.inbox.map(([Id, Subject]) => ({ Id, Subject, TimeStamp: "2026-11-01 10:00", Sender: `Opettaja ${name}` })) }));
    }
    if (/^\/!\d+\/messages\/list\/appointments$/.test(url)) return send(200, "application/json", user.appointments ? real("appointments-list.json") : '{"Messages": []}');
    const read = /^\/!\d+\/messages\/(\d+)\?format=json$/.exec(url);
    if (read) {
      const found = user.inbox.find(([id]) => String(id) === read[1]);
      if (!found) return send(404, "text/plain", "");
      return send(200, "application/json", JSON.stringify({ messages: [{ Id: found[0], Subject: found[1], TimeStamp: "2026-11-01 10:00", Sender: `Opettaja ${name}`, ContentHtml: `<p>${name} ${username}</p>` }] }));
    }
    if (/^\/!\d+\/overview$/.test(url)) return send(200, "application/json", "{}");
    if (/^\/!\d+\/news$/.test(url)) return send(200, "application/json", "[]");
    if (/^\/!\d+\/attendance\/view/.test(url)) return send(200, "text/html", "<html></html>");
    if (/^\/!\d+\/exams\/calendar$/.test(url)) return send(200, "text/html", "<html></html>");
    if (/^\/!\d+\/exams\/calendar\/past/.test(url)) return send(200, "text/html", real("exams-past.html"));
    if (/^\/!\d+\/api\/v1\/schedules\/timetable/.test(url)) return send(200, "application/json", timetable);
    // Without contacts: a bare front page, and no recipient list.
    if (/^\/!\d+\/$/.test(url)) return send(200, "text/html", user.contacts ? real("student-home.html") : "<html><body></body></html>");
    if (!user.contacts) return send(404, "text/plain", "");
    if (/\/messages\/recipients$/.test(url)) return send(200, "text/html", real("messages-recipients.html"));
    if (/\/messages\/recipients\/ownteachers\/\d+$/.test(url)) return send(200, "text/html", real("recipients-ownteachers.html"));
    send(404, "text/plain", "");
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, requests, url: `http://127.0.0.1:${server.address().port}` })));
}

// The city's Wilma: a parent with two children, and one of them with her own login. A college's Wilma: the parent and a third child.
const city = await mockWilma("A", {
  parent: { role: "guardian", children: [["7", "Kiia Example"], ["8", "Eeli Example"]], inbox: [[41, "Vanhempainilta"]], appointments: true, contacts: true },
  kiia: { role: "student", children: [["7", "Kiia Example"]], inbox: [[51, "Kokeen tulos"]] },
});
const college = await mockWilma("B", { parent: { role: "guardian", children: [["9", "Aino Example"]], inbox: [[41, "Retki"]] } });

const tempDirectory = await mkdtemp(join(tmpdir(), "wilmai-family-"));
const cliPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const configPath = join(tempDirectory, "config.json");
const saved = (wilma, tenantName, username, children) => ({
  id: `${wilma.url}|${username}`,
  tenantUrl: wilma.url,
  tenantName,
  username,
  passwordObfuscated: Buffer.from("wilmai::pw").toString("base64"),
  students: children.map(([studentNumber, name]) => ({ studentNumber, name })),
  lastUsedAt: new Date().toISOString(),
});
await writeFile(
  configPath,
  JSON.stringify({
    profiles: [
      saved(city, "City Wilma", "parent", [["7", "Kiia Example"], ["8", "Eeli Example"]]),
      saved(college, "College Wilma", "parent", [["9", "Aino Example"]]),
      saved(city, "City Wilma", "kiia", [["7", "Kiia Example"]]),
    ],
    // Kiia logged in last, so her own login comes first.
    lastProfileId: `${city.url}|kiia`,
  })
);
await writeFile(join(tempDirectory, "version-check.json"), JSON.stringify({ latestVersion: "0.0.1", checkedAt: Date.now() }));

const env = { ...process.env, WILMAI_CONFIG_PATH: configPath, WILMAI_NO_BROWSER: "1", WILMAI_NO_UPDATE_CHECK: "1", WILMAI_NO_SESSION_CACHE: "1" };
for (const key of ["WILMA_TENANT", "WILMA_USERNAME", "WILMA_PASSWORD", "WILMA_TOTP_SECRET"]) delete env[key];
const run = (args) =>
  new Promise((resolve) => execFile(process.execPath, [cliPath, ...args], { env }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr })));
const json = async (args) => {
  const result = await run(args);
  assert.equal(result.code, 0, `${args.join(" ")}: ${result.stdout} ${result.stderr}`);
  return JSON.parse(result.stdout);
};
const jsonError = async (args, code, pattern) => {
  const body = JSON.parse((await run(args)).stdout);
  assert.equal(body.code, code, args.join(" "));
  assert.match(body.message, pattern, args.join(" "));
};
const byName = (result, name) => result.students.find((entry) => entry.student.name === name);

try {
  /* ---------------- which login reads each child ---------------- */
  const { students } = await json(["students"]);
  assert.deepEqual(
    students.map((s) => [s.name, s.wilma, s.role]),
    [
      ["Kiia Example", "City Wilma", "guardian"],
      ["Eeli Example", "City Wilma", "guardian"],
      ["Aino Example", "College Wilma", "guardian"],
    ],
    "each child once, Kiia through the parent's login although her own logged in last"
  );
  const messages = await json(["messages"]);
  assert.deepEqual(byName(messages, "Kiia Example").messages.map((m) => m.subject), ["Vanhempainilta"], "the parent's inbox for Kiia");
  assert.deepEqual(byName(messages, "Aino Example").messages.map((m) => m.subject), ["Retki"], "the college's own inbox");
  // Ids are only unique within one Wilma: reading one needs the child it was listed under.
  await jsonError(["messages", "41"], "student_required", /Pass the student/);
  assert.equal((await json(["messages", "41", "--student", "Aino"])).message.content, "B parent");
  assert.equal((await json(["messages", "41", "--student", "Kiia"])).message.content, "A parent");

  // The refreshed lists are saved with whose login each is, so `wilma accounts` says it without logging in.
  const { accounts } = await json(["accounts"]);
  assert.deepEqual(
    accounts.map((a) => [a.number, a.wilma, a.username, a.role]),
    [
      [1, "City Wilma", "parent", "guardian"],
      [2, "College Wilma", "parent", "guardian"],
      [3, "City Wilma", "kiia", "student"],
    ]
  );
  assert.match((await run(["accounts", "--text"])).stdout, /3\. City Wilma — kiia \(Kiia Example\), the student's own login/);

  /* ---------------- reads Home has ---------------- */
  // Class and teachers: the class teacher and supervisors, and the own teachers with what they teach (from the timetable's codes).
  const contacts = await json(["contacts", "--student", "Kiia"]);
  const kiia = contacts.students[0].contacts;
  assert.equal(kiia.className, "DE");
  assert.deepEqual(kiia.supervisors.map((s) => s.role), ["Ryhmänohjaaja/Luokanvalvoja", "Muut ohjaajat", "Muut ohjaajat"]);
  assert.equal(kiia.teachers.length, 13, "the own teachers, not the school's 49");
  assert.deepEqual(kiia.teachers.find((t) => t.name === "Gusitutemu Lebit (Mas)").subjects, ["Matematiikka"]);
  assert.ok(kiia.teachers.filter((t) => t.name !== "Gusitutemu Lebit (Mas)").every((t) => t.subjects.length === 0));
  assert.ok(!JSON.stringify(contacts).includes("compose"), "no compose links");
  assert.match((await run(["contacts", "--student", "Kiia", "--text"])).stdout, /Class: DE[\s\S]*Gusitutemu Lebit \(Mas\) — Matematiikka/);

  // Past exams for a period, graded or not yet.
  const grades = await json(["grades", "--from", "2026-08-01", "--student", "Kiia"]);
  assert.equal(grades.from, "2026-08-01");
  assert.equal(grades.to, today);
  assert.equal(grades.students[0].grades.length, 55, "every exam of the period without --limit");
  assert.ok(grades.students[0].grades.some((g) => g.grade === null), "exams waiting for a grade");
  assert.ok(city.requests.includes(`parent /!7/exams/calendar/past?range=-3&first=1.8.2026&last=${encodeURIComponent(fi(today))}`));
  assert.equal((await json(["grades", "--from", "2026-08-01", "--limit", "3", "--student", "Kiia"])).students[0].grades.length, 3);
  await jsonError(["grades", "--to", "2026-10-01"], "invalid_argument", /needs a start date/);

  // Invitations with the family's answer.
  const invitations = await json(["messages", "--folder", "appointments", "--student", "Kiia"]);
  assert.deepEqual(invitations.students[0].messages.slice(0, 2).map((m) => [m.invitationStatus, m.invitationInfo]), [
    ["Applied", "29.05.2026 13:00"],
    ["ExpiredReg", "25.05.2026 14:00"],
  ]);
  const summary = await json(["summary", "--student", "Kiia", "--since", "2025-01-01"]);
  assert.equal(summary.students[0].summary.messages.find((m) => m.folder !== "inbox").invitationStatus, "Applied", "the summary too");
  assert.equal(summary.students[0].summary.messages.find((m) => m.folder === "inbox").invitationStatus, undefined, "not on other messages");

  // Any week, or a period.
  const week = await json(["schedule", "--from", addDays(monday, 14), "--student", "Kiia"]);
  assert.deepEqual([week.when, week.from, week.to], ["period", addDays(monday, 14), addDays(monday, 18)], "from a Monday to its Friday");
  assert.ok(city.requests.includes(`parent /!7/api/v1/schedules/timetable?startdate=${addDays(monday, 14)}&enddate=${addDays(monday, 18)}`));
  const fortnight = await json(["schedule", "--from", monday, "--to", addDays(monday, 11), "--student", "Kiia"]);
  assert.deepEqual(fortnight.students[0].lessons.map((l) => [l.date, l.subject]), [[monday, "Matematiikka"]]);
  await jsonError(["schedule", "--from", monday, "--to", addDays(monday, 40)], "invalid_argument", /at most 31 days/);
  await jsonError(["schedule", "--from", monday, "--to", addDays(monday, -1)], "invalid_argument", /ends .* before it starts/);
  await jsonError(["schedule", "--date", monday, "--from", monday], "invalid_argument", /Use one of/);

  /* ---------------- the MCP tools ---------------- */
  const client = new Client({ name: "family-test", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [cliPath, "mcp"], env, stderr: "pipe" }));
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true, `${name}: ${result.content[0].text}`);
    return JSON.parse(result.content[0].text);
  };
  try {
    const { tools } = await client.listTools();
    const contactsTool = tools.find((t) => t.name === "wilma_contacts");
    assert.ok(contactsTool, "wilma_contacts is listed");
    assert.equal(contactsTool.annotations.readOnlyHint, true);
    for (const [tool, params] of [["wilma_schedule", ["from", "to"]], ["wilma_grades", ["from", "to"]], ["wilma_lesson_notes", ["from", "to"]]]) {
      const schema = tools.find((t) => t.name === tool).inputSchema.properties;
      for (const param of params) assert.ok(schema[param], `${tool} takes ${param}`);
    }
    // Every Wilma tool still only reads (the log in and out tools, and saving a copy of a file, aside).
    const writes = tools.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name).sort();
    assert.deepEqual(writes, ["wilma_get_news_attachment", "wilma_get_printout", "wilma_login", "wilma_logout"]);

    const account = await call("wilma_account");
    assert.deepEqual(
      account.wilmas.map((w) => [w.wilma, w.username, w.role, w.children.map((c) => [c.name, c.readVia ?? null])]),
      [
        ["City Wilma", "kiia", "student", [["Kiia Example", "parent"]]],
        ["City Wilma", "parent", "guardian", [["Kiia Example", null], ["Eeli Example", null]]],
        ["College Wilma", "parent", "guardian", [["Aino Example", null]]],
      ],
      "the student's own login says its child is read through the parent's"
    );

    // A Wilma that shows no recipient list: the rest comes, and the teachers are unavailable.
    const all = await call("wilma_contacts");
    assert.equal(byName(all, "Eeli Example").contacts.className, "DE");
    assert.deepEqual(byName(all, "Aino Example").contacts, { className: null, supervisors: [], teachers: [], unavailable: ["teachers"] });

    // Lesson notes for a period that reaches ahead (a make-up exam noted on a coming lesson).
    const notes = await call("wilma_lesson_notes", { student: "Aino", from: today, to: addDays(today, 30) });
    assert.deepEqual([notes.from, notes.to], [today, addDays(today, 30)]);
    assert.ok(college.requests.includes(`parent /!9/attendance/view?range=-3&first=${dmy(today)}&last=${dmy(addDays(today, 30))}`));

    const past = await call("wilma_grades", { student: "Kiia", from: "2026-08-01", limit: 2 });
    assert.equal(past.students[0].grades.length, 2);
  } finally {
    await client.close();
  }

  console.log("family: all assertions passed");
} finally {
  city.server.close();
  college.server.close();
  await rm(tempDirectory, { recursive: true, force: true });
}
