// Client methods against a mock Wilma that serves the anonymised real pages:
// the timetable API (and the page fallback), message threads as JSON (and the
// page fallback), lesson notes for a period and their summary, the gradebook
// and printouts.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { WilmaClient } from "../dist/index.js";

const fixture = (name) => readFileSync(new URL(`./fixtures/real/${name}`, import.meta.url), "utf8");
const PDF = Buffer.from("%PDF-1.4\n% test printout\n");
const requests = [];

const server = createServer((req, res) => {
  requests.push(req.url);
  const send = (status, type, body) => {
    res.writeHead(status, { "Content-Type": type });
    res.end(body);
  };
  const base = `http://127.0.0.1:${server.address().port}`;
  if (req.method === "GET" && req.url === "/login") return send(200, "text/html", '<input type="hidden" name="SESSIONID" value="s">');
  if (req.method === "POST" && req.url === "/login") {
    res.writeHead(303, { Location: `${base}/?checkcookie`, "Set-Cookie": "Wilma2SID=ok; Path=/" });
    return res.end();
  }
  if (req.url === "/?checkcookie") return send(200, "text/html", "home");
  const url = new URL(req.url, base);
  const path = url.pathname;

  // Student 1: a current Wilma. Student 2: an older one without the APIs.
  if (path === "/!1/api/v1/schedules/timetable") return send(200, "application/json", fixture("timetable.json"));
  if (path === "/!2/schedule") {
    const events = [{ Id: "7", Date: "7.10.2026", Start: 510, End: 555, Text: { 0: "MA_ Matematiikka" }, OpeInfo: { 0: { kokonimi: "Opettaja Olli", lyhenne: "Oll" } } }];
    return send(200, "text/html", `<script>var eventsJSON = { Events : ${JSON.stringify(events)}, ActiveTyyppi: "" };</script>`);
  }
  if (path === "/!1/messages/5" && url.searchParams.get("format") === "json") return send(200, "application/json", fixture("message-thread.json"));
  if (path === "/!2/messages/6" && !url.search) {
    return send(200, "text/html", '<div id="page-content-area" class="panel-body"><h1>Vanha viesti</h1><table class="proptable"><tr><th>Lähettäjä</th><td>Opettaja</td></tr><tr><th>Lähetetty</th><td>5.10.2026 klo 8:00</td></tr></table><div class="inner">Sisältö</div></div>');
  }
  if (path === "/!1/attendance/view") return send(200, "text/html", fixture("attendance.html"));
  if (path === "/!1/gradebook") return send(200, "text/html", fixture("gradebook.html"));
  if (path === "/!1/printouts") return send(200, "text/html", fixture("printouts.html"));
  if (/^\/!\d+\/printouts\/\d+\.pdf$/.test(path)) {
    res.writeHead(200, { "Content-Type": "application/pdf", "Content-Length": PDF.length });
    return res.end(PDF);
  }
  if (path === "/!1/news") return send(200, "text/html", fixture("news-list.html"));
  if (/^\/![12]\/overview$/.test(path)) return send(200, "application/json", fixture("overview.json"));
  if (path === "/!1/exams/calendar") return send(200, "text/html", fixture("exams-calendar.html"));
  if (path === "/!2/exams/calendar") return send(500, "text/plain", "");
  send(404, "text/plain", `Unexpected ${req.method} ${req.url}`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

try {
  const client = await WilmaClient.login({ baseUrl: `http://127.0.0.1:${server.address().port}`, username: "u", password: "p" });
  const kid = client.forStudent("1");
  const older = client.forStudent("2");

  // Schedule: the timetable API for a period, with rooms.
  const week = await kid.schedule.list({ from: "2026-10-05", to: "2026-10-09" });
  assert.equal(week.length, 27);
  assert.ok(week.some((l) => l.room));
  assert.equal((await kid.schedule.list({ date: "2026-10-07" })).length, 5, "one day from the same API");
  // An older Wilma without the API: the schedule page for that date.
  const day = await older.schedule.list({ date: "2026-10-07" });
  assert.equal(day.length, 1);
  assert.equal(day[0].subject, "MA_ Matematiikka");
  assert.ok(requests.some((r) => r.startsWith("/!2/api/v1/schedules/timetable")) && requests.includes("/!2/schedule?date=07.10.2026"));

  // Messages: the thread as JSON; an older Wilma falls back to the page.
  const thread = await kid.messages.get(5);
  assert.equal(thread.replies.length, 1);
  assert.equal(thread.recipients.length, 1);
  const legacy = await older.messages.get(6);
  assert.equal(legacy.subject, "Vanha viesti");
  assert.ok(requests.includes("/!2/messages/6?format=json") && requests.includes("/!2/messages/6"));

  // Lesson notes for a period: Wilma's own period selection, filtered to the dates asked.
  const september = await kid.attendance.list({ from: "2026-09-01", to: "2026-09-30" });
  assert.ok(requests.includes("/!1/attendance/view?range=-3&first=01.09.2026&last=30.09.2026"));
  assert.ok(september.length > 0 && september.every((n) => n.date >= "2026-09-01" && n.date <= "2026-09-30"));
  assert.equal((await kid.attendance.list({ date: "2026-09-30" })).length, 1);
  const year = await kid.attendance.summary();
  assert.ok(requests.includes("/!1/attendance/view?range=-4"), "the school year");
  assert.equal(year.total, 57);
  assert.equal(year.from, null);
  const septemberSummary = await kid.attendance.summary({ from: "2026-09-01", to: "2026-09-30" });
  assert.equal(septemberSummary.total, september.length);

  // Gradebook and printouts.
  assert.equal((await kid.gradebook.get()).length, 21);
  const printouts = await kid.printouts.list();
  assert.equal(printouts.length, 1);
  const { response } = await kid.printouts.fetch(printouts[0].id);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), PDF);
  await assert.rejects(kid.printouts.fetch("999"), /not found/);

  // Exams: the front page's list, with times from the calendar when it can be read.
  const exams = await kid.exams.upcoming();
  const withoutCalendar = await older.exams.upcoming();
  assert.equal(exams.length, withoutCalendar.length, "a broken calendar page costs only the times");
  assert.ok(withoutCalendar.every((e) => !e.time));
  assert.ok(requests.includes("/!1/exams/calendar"));

  // Bulletins: dated, pinned and older ones.
  const news = await kid.news.list();
  assert.equal(news.length, 42);
} finally {
  server.close();
}

console.log("client-features: all assertions passed");
