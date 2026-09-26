import assert from "node:assert/strict";
import { parseAttendanceHtml } from "../dist/parsers/attendance.js";

// Modelled on a real /attendance/view page (Wilma 2.36): the hour headers use
// mixed colspans, absence-type marks are <td class="at-tpN"> cells whose text
// is the teacher code, and free-text remarks are <td class="at-tp-other">
// cells whose text is a <small> label with an optional <sup> footnote marker.
// The remark itself is only in the title attribute (and repeated in the
// trailing "Huomioita" column). Names and codes below are fictional.
const html = `
<table class="datatable first attendance-single table bottom-margin-inline">
  <thead>
  <tr>
    <th colspan="2" align="left">Päivämäärä </th>
    <th colspan="2" class="center">8</th>
    <th colspan="2" class="center">9</th>
    <th colspan="2" class="center">10</th>
    <th colspan="3" class="center">11</th>
    <th colspan="3" class="center">12</th>
    <th colspan="2" class="center">13</th>
    <th class="center">14</th>
    <th class="center">15</th>
    <th class="center">Yhteensä </th>
    <th style="min-width:300px;">Huomioita<br></th>
  </tr>
  </thead>
  <tbody>
  <tr class="odd">
    <td>To </td>
    <td align="right">24.9.2026 </td>
      <td>&#160;</td>
      <td class="event at-bl at-tp-other" title="LI02; Hyvää pari- / ryhmätyöskentelyä; Syysmarkkinoilla hyvää käytöstä ja iloista asiakaspalvelua! /Anna Esimerkki"><small>Hyvää pari- / ryhmätyöskentelyä</small><sup>1</sup></td>
      <td colspan="2">&#160;</td>
      <td colspan="2">&#160;</td>
      <td colspan="3">&#160;</td>
      <td colspan="2">&#160;</td>
      <td class="event at-bl at-tp-other" colspan="2" title="UEEL02; Hyvää tuntityöskentelyä /Tiina Testaaja"><small>Hyvää tuntityöskentelyä</small></td>
      <td>&#160;</td>
      <td>&#160;</td>
      <td>&#160;</td>
    <td class="total zero" align="center">0 </td>
    <td><small>1: Syysmarkkinoilla hyvää käytöstä ja iloista asiakaspalvelua! <span class="lem">/ESIA</span><br></small></td>
  </tr>
  <tr>
    <td>Pe </td>
    <td align="right">18.9.2026 </td>
      <td colspan="2">&#160;</td>
      <td colspan="2">&#160;</td>
      <td colspan="2">&#160;</td>
      <td colspan="3">&#160;</td>
      <td colspan="3">&#160;</td>
      <td colspan="2">&#160;</td>
      <td>&#160;</td>
      <td>&#160;</td>
    <td class="total zero" align="center">0 </td>
    <td>&#160;<br></td>
  </tr>
  <tr class="odd">
    <td>To </td>
    <td align="right">3.9.2026 </td>
      <td>&#160;</td>
      <td class="event at-bl at-tp4" title="LI02; SAIRAUS /Anna Esimerkki">ESIA</td>
      <td>&#160;</td>
      <td class="event at-bl at-tp4" title="LI02; SAIRAUS /Anna Esimerkki">ESIA</td>
      <td>&#160;</td>
      <td class="event at-bl at-tp4" colspan="2" title="AI02; SAIRAUS /Anna Esimerkki">ESIA</td>
      <td>&#160;</td>
      <td class="event at-bl at-tp4" colspan="2" title="AI02; SAIRAUS /Anna Esimerkki">ESIA</td>
      <td>&#160;</td>
      <td class="event at-bl at-tp4" colspan="2" title="UEEL02; SAIRAUS /Anna Esimerkki">ESIA</td>
      <td>&#160;</td>
      <td>&#160;</td>
      <td>&#160;</td>
    <td class="total" align="center">5 </td>
    <td>&#160;<br></td>
  </tr>
  </tbody>
  <tfoot class="summary">
  <tr class="total semi-bold">
    <td colspan="18">Yhteensä </td>
    <td align="center">5</td>    <td>&#160;<br></td>
  </tr>
  </tfoot>
</table>

<div class="legend">
  <table>
    <tr><td class="at-tp2 text-center">S</td><td>Selvittämätön poissaolo</td></tr>
    <tr><td class="at-tp4 text-center">LS</td><td>Luvallinen poissaolo, sairaus</td></tr>
  </table>
</div>
`;

// --- Free-text remarks (at-tp-other cells) -------------------------------

const remarks = parseAttendanceHtml(html, "2026-09-24");
assert.equal(remarks.length, 2, "both at-tp-other remark cells must be parsed");

assert.deepEqual(remarks[0], {
  date: "2026-09-24",
  start: "08:00",
  end: "08:45",
  subject: "LI02",
  typeLabel: "Hyvää pari- / ryhmätyöskentelyä",
  typeClass: "at-tp-other",
  teacher: "Anna Esimerkki",
  note: "Syysmarkkinoilla hyvää käytöstä ja iloista asiakaspalvelua!",
});

assert.deepEqual(remarks[1], {
  date: "2026-09-24",
  start: "12:00",
  end: "13:45",
  subject: "UEEL02",
  typeLabel: "Hyvää tuntityöskentelyä",
  typeClass: "at-tp-other",
  teacher: "Tiina Testaaja",
  note: "",
});

// The <sup> footnote marker must never leak into any field.
for (const note of remarks) {
  for (const value of Object.values(note)) {
    assert.ok(!/1$/.test(String(value)) || value === note.date, `footnote marker leaked into ${JSON.stringify(note)}`);
  }
}

// --- Absence marks (numeric at-tpN cells) keep working ---------------------

const absences = parseAttendanceHtml(html, "2026-09-03");
assert.equal(absences.length, 5, "one note per at-tp4 cell");

assert.deepEqual(
  absences.map((n) => [n.start, n.end, n.subject]),
  [
    ["08:00", "08:45", "LI02"],
    ["09:00", "09:45", "LI02"],
    ["10:00", "11:45", "AI02"],
    ["11:00", "12:45", "AI02"],
    ["12:00", "13:45", "UEEL02"],
  ]
);
for (const note of absences) {
  assert.equal(note.date, "2026-09-03");
  assert.equal(note.typeLabel, "SAIRAUS");
  assert.equal(note.typeClass, "at-tp4");
  assert.equal(note.teacher, "Anna Esimerkki");
  assert.equal(note.note, "");
}

// --- Rows without marks and unknown dates ----------------------------------

assert.deepEqual(parseAttendanceHtml(html, "2026-09-18"), [], "row with no marks yields nothing");
assert.deepEqual(parseAttendanceHtml(html, "2026-09-25"), [], "date not in table yields nothing");
assert.deepEqual(parseAttendanceHtml(html, ""), [], "empty date yields nothing");

// The legend table has at-tpN cells but no hour headers; it must be ignored.
const legendOnly = parseAttendanceHtml(
  `<div class="legend"><table><tr><td class="at-tp4 text-center">LS</td><td>Sairaus</td></tr></table></div>`,
  "2026-09-03"
);
assert.deepEqual(legendOnly, []);

// --- Title without a subject segment ---------------------------------------

const noSubject = parseAttendanceHtml(
  `<table><thead><tr><th colspan="2">Pvm</th><th>8</th></tr></thead>
   <tbody><tr><td>Ma</td><td>1.9.2026</td><td class="event at-tp1" title="Myöhästyminen /Tiina Testaaja">TEST</td></tr></tbody></table>`,
  "2026-09-01"
);
assert.deepEqual(noSubject, [
  {
    date: "2026-09-01",
    start: "08:00",
    end: "08:45",
    subject: "",
    typeLabel: "Myöhästyminen",
    typeClass: "at-tp1",
    teacher: "Tiina Testaaja",
    note: "",
  },
]);

// A numeric cell with no title keeps the visible teacher code as before.
const noTitle = parseAttendanceHtml(
  `<table><thead><tr><th colspan="2">Pvm</th><th>8</th></tr></thead>
   <tbody><tr><td>Ma</td><td>1.9.2026</td><td class="event at-tp1">TEST</td></tr></tbody></table>`,
  "2026-09-01"
);
assert.equal(noTitle.length, 1);
assert.equal(noTitle[0].teacher, "TEST");
assert.equal(noTitle[0].typeLabel, "Type 1");

console.log("attendance parser tests passed");
