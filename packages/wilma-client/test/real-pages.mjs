// Parsers against anonymised copies of real Wilma pages (test/fixtures/real,
// made with scripts/anonymize-fixture.mjs from a Wilma 2.36 account). Names
// and text are made up; markup, dates, codes and Wilma's labels are real, so a
// change in Wilma's pages shows up here instead of as an empty list.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseNewsDetailHtml, parseNewsListHtml } from "../dist/parsers/news.js";
import { parseAttendanceHtml, summarizeLessonNotes } from "../dist/parsers/attendance.js";
import { parseGradebookHtml } from "../dist/parsers/gradebook.js";
import { parsePrintoutsHtml } from "../dist/parsers/printouts.js";
import { parseMessageDetailJson, parseMessagesList } from "../dist/parsers/messages.js";
import { parseTimetableJson } from "../dist/parsers/schedule.js";
import { addExamTimes, parseExamsHtml } from "../dist/parsers/exams.js";
import { parseOverview } from "../dist/parsers/overview.js";

const fixture = (name) => readFileSync(new URL(`./fixtures/real/${name}`, import.meta.url), "utf8");
const finnishDay = (date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Helsinki" }).format(date);

/* ---------------- bulletins ---------------- */
{
  const news = parseNewsListHtml(fixture("news-list.html"));
  assert.equal(news.length, 42, "dated, pinned and older bulletins");
  assert.equal(new Set(news.map((n) => n.wilmaId)).size, 42);
  const dated = news.filter((n) => n.published);
  assert.equal(dated.length, 20);
  assert.equal(news.filter((n) => n.pinned).length, 11, "pinned: padlock icon or the pinned panel");
  assert.equal(dated.filter((n) => n.pinned).length, 7);
  assert.equal(news.filter((n) => n.archived).length, 18, "older bulletins from the side panel");
  assert.ok(news.every((n) => n.title && n.title !== "Untitled News"));
  assert.ok(news.filter((n) => n.archived).every((n) => !n.pinned && n.published === null));
  // Newest first among the dated ones.
  assert.ok(dated.every((n, i) => i === 0 || n.published <= dated[i - 1].published));

  const detail = parseNewsDetailHtml(fixture("news-detail.html"), 1, "https://example.inschool.fi/!1/news/1");
  assert.equal(finnishDay(detail.published), "2025-10-07", "Julkaistu 7.10.2025");
  assert.ok(detail.author, "author from the profile link next to the date");
  assert.equal(detail.resources.length, 9);
  assert.ok(detail.resources.every((r) => r.authContext === "external" && r.url.startsWith("https://example.com/")));
  assert.ok(detail.content && detail.content.length > 100);
}

/* ---------------- lesson notes ---------------- */
{
  const html = fixture("attendance.html");
  const notes = parseAttendanceHtml(html);
  assert.equal(notes.length, 57, "every day the page shows");
  assert.equal(notes.filter((n) => n.note).length, 20, "the teacher's own words, kept apart from the label");
  const legend = new Set([...html.matchAll(/<td class="at-tp\d+ text-center">([^<]+)<\/td>/g)].map((m) => m[1].trim()));
  assert.equal(legend.size, 26);
  assert.ok(notes.every((n) => legend.has(n.typeLabel)), "labels come from the legend");
  assert.ok(notes.every((n) => !legend.has(n.subject)), "a label is never taken for a subject");
  assert.ok(notes.every((n) => !n.typeLabel.includes(";")));
  // A note without a lesson: "Label; words /Teacher".
  const noLesson = notes.find((n) => n.typeLabel === "Muu koulutyö - läsnä");
  assert.equal(noLesson.subject, "");
  assert.ok(noLesson.note);
  assert.ok(notes.every((n) => /^\d{4}-\d{2}-\d{2}$/.test(n.date) && n.teacher));
  assert.equal(parseAttendanceHtml(html, "2026-09-30").length, 1, "one day");

  const summary = summarizeLessonNotes(notes, null, null);
  assert.equal(summary.total, 57);
  assert.deepEqual(summary.byType[0], { type: "Hyvä!", count: 20 });
  assert.equal(summary.byType.reduce((n, t) => n + t.count, 0), 57);
  assert.equal(summary.byType.find((t) => t.type === "Sinulta puuttui opiskeluvälineitä").count, 3);
}

/* ---------------- gradebook ---------------- */
{
  const gradebook = parseGradebookHtml(fixture("gradebook.html"));
  const count = (entries) => entries.reduce((n, e) => n + 1 + count(e.children), 0);
  assert.equal(gradebook.length, 21, "subjects");
  assert.equal(count(gradebook), 89, "every row, as a tree");
  const conduct = gradebook[0];
  assert.equal(conduct.code, null);
  assert.equal(conduct.children.length, 4);
  assert.ok(conduct.children.every((c) => c.code && /^\d{4}-\d{2}-\d{2}$/.test(c.date) && c.grade));
  // Three levels: subject > syllabus > course.
  assert.ok(gradebook.some((s) => s.children.some((c) => c.children.length)));
  assert.deepEqual(parseGradebookHtml(fixture("gradebook-empty.html")), [], "nothing graded yet");
}

/* ---------------- printouts ---------------- */
{
  const printouts = parsePrintoutsHtml(fixture("printouts.html"));
  assert.equal(printouts.length, 1);
  assert.match(printouts[0].path, /^\/!\d+\/printouts\/\d+\.pdf$/);
  assert.equal(printouts[0].id, /printouts\/(\d+)/.exec(printouts[0].path)[1]);
  assert.ok(printouts[0].title);
}

/* ---------------- messages (JSON) ---------------- */
{
  const list = parseMessagesList(JSON.parse(fixture("messages-list.json")), "inbox");
  assert.equal(list.length, 7);
  assert.equal(list.filter((m) => m.unread).length, 1, "Status marks unread");
  assert.deepEqual(list.filter((m) => m.replyCount).map((m) => m.replyCount), [1, 2]);
  assert.ok(list.every((m) => m.senderName));

  const thread = parseMessageDetailJson(JSON.parse(fixture("message-thread.json")), 1);
  assert.equal(thread.replies.length, 1, "replies are part of the thread");
  assert.ok(thread.replies[0].content && thread.replies[0].senderName);
  assert.equal(thread.recipients.length, 1);
  assert.ok(!/<[a-z]/i.test(thread.content), "plain text");
  assert.ok(thread.replies[0].content.includes("\n\n"), "paragraphs kept");
  assert.ok(thread.sentAt.getTime() > 0 && thread.replies[0].sentAt > thread.sentAt);
  assert.equal(parseMessageDetailJson({}, 1), null, "not a thread: fall back to the page");
}

/* ---------------- timetable (JSON) ---------------- */
{
  const data = JSON.parse(fixture("timetable.json"));
  const lessons = parseTimetableJson(data.payload);
  assert.equal(lessons.length, 27);
  const perDay = {};
  for (const l of lessons) perDay[l.date] = (perDay[l.date] ?? 0) + 1;
  assert.deepEqual(perDay, { "2026-10-05": 6, "2026-10-06": 5, "2026-10-07": 5, "2026-10-08": 6, "2026-10-09": 5 });
  assert.equal(lessons.filter((l) => l.room).length, 20, "rooms when Wilma gives one");
  assert.ok(lessons.every((l) => /^\d{2}:\d{2}$/.test(l.start) && /^\d{2}:\d{2}$/.test(l.end) && l.dayOfWeek >= 1 && l.dayOfWeek <= 5));
  const first = data.payload[0].modules[0];
  const lesson = lessons.find((l) => l.groupId === first.id);
  // Issue #18: the subject is the course name; the caption starts with the code.
  assert.equal(lesson.subject, first.courseName);
  assert.equal(lesson.subjectCode, first.caption.split(" ")[0]);
  // A lesson without a course name keeps its caption (e.g. lunch).
  const noCourse = data.payload.flatMap((l) => l.modules).find((m) => !m.courseName);
  assert.equal(lessons.find((l) => l.groupId === noCourse.id).subject, noCourse.caption);
  // Upper secondary style (issue #18): the caption is only the course code.
  const [code] = parseTimetableJson([
    { startAt: "08:15", endsAt: "09:30", dates: ["2026-10-06"], modules: [{ id: 1, caption: "yRUB1.1", abbreviation: "yRUB1.1", courseName: "Ruotsi", teachers: [] }] },
  ]);
  assert.equal(code.subject, "Ruotsi");
  assert.equal(code.subjectCode, "yRUB1.1");
  assert.ok(lesson.teacher.startsWith(`${first.teachers[0].lastname} ${first.teachers[0].firstname}`), "Lastname Firstname, like the schedule page");
}

/* ---------------- exams: front page JSON + start times from the calendar ---------------- */
{
  const calendar = parseExamsHtml(fixture("exams-calendar.html"));
  assert.equal(calendar.length, 12);
  assert.deepEqual(calendar.filter((e) => e.time).map((e) => `${e.dateString} ${e.time}`), ["2026-10-30 08:30", "2026-11-02 08:30"]);
  const upcoming = parseOverview(JSON.parse(fixture("overview.json")), new Date("2026-10-04T12:00:00+03:00")).upcomingExams;
  assert.equal(upcoming.length, 12, "the calendar and the front page list the same exams");
  const timed = addExamTimes(upcoming, calendar).filter((e) => e.time);
  assert.deepEqual(timed.map((e) => `${e.date} ${e.time} ${e.subjectCode}`), ["2026-10-30 08:30 MA_91", "2026-11-02 08:30 BI_9LV"]);
  // Two exams of one course on 30.10: only the one the calendar times gets the time.
  const sameDay = addExamTimes(upcoming, calendar).filter((e) => e.date === "2026-10-30" && e.subjectCode === "MA_91");
  assert.equal(sameDay.length, 2);
  assert.equal(sameDay.filter((e) => e.time).length, 1);
  assert.deepEqual(addExamTimes(upcoming, []).filter((e) => e.time), [], "no calendar, no times");
}

console.log("real-pages: all assertions passed");
