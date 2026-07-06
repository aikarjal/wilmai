import assert from "node:assert/strict";
import { parseScheduleHtml } from "../dist/parsers/schedule.js";

const html = `
<script>
var eventsJSON = {
  ViewOnly: true,
  Events : [{
    "Id": "123",
    "Date": "13.08.2026",
    "Start": 510,
    "End": 555,
    "Text": { "0": "MAT Mathematics" },
    "LongText": { "0": "MAT Mathematics long" },
    "OpeInfo": { "0": { "0": { "lyhenne": "Tea", "nimi": "Teacher Name" } } }
  }],
  ActiveTyyppi: ""
};
</script>`;

const lessons = parseScheduleHtml(html);
assert.equal(lessons.length, 1);
assert.deepEqual(lessons[0], {
  date: "2026-08-13",
  dayOfWeek: 4,
  start: "08:30",
  end: "09:15",
  subject: "MAT Mathematics",
  subjectCode: "MAT",
  teacher: "Teacher Name",
  teacherCode: "Tea",
  groupId: 123,
});

console.log("schedule parser tests passed");
