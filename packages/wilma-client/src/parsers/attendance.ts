import * as cheerio from "cheerio";
import type { LessonNote } from "../types.js";

/**
 * Parse Wilma's /attendance/view HTML page into structured LessonNote objects.
 *
 * The attendance table is a fine-grained grid: <thead> declares hour-group
 * headers like `<th colspan="3">9</th>`, and tbody rows mix `<td>` cells with
 * varying colspans (filler `<td colspan="2">`, event `<td colspan="3">`, etc).
 * To map an event `<td>` to its hour, we walk cumulative grid columns (sum of
 * colspans) within the row and look up the column's hour group from the thead.
 *
 * Counting `<td>` indices alone is wrong: a `<td colspan="3">` filler skips
 * three grid columns but consumes one index, so by the third or fourth cell
 * the index has drifted from the true grid column.
 *
 * Two kinds of event cells exist. Absence-type marks are `<td class="at-tpN">`
 * whose text is the teacher code. Free-text remarks (positive feedback,
 * behavioural notes) are `<td class="at-tp-other">` whose text is a `<small>`
 * label, optionally followed by a `<sup>` footnote marker that points at the
 * trailing "Huomioita" column. Both must be accepted.
 *
 * Title attribute on event cells carries up to three `;`-separated segments
 * before the teacher: "TypeLabel /TeacherName",
 * "SubjectCode; TypeLabel /TeacherName" or
 * "SubjectCode; TypeLabel; Remark /TeacherName". The remark is exposed as
 * `note`; it is the same text the footnote column repeats.
 */
export function parseAttendanceHtml(html: string, date: string): LessonNote[] {
  const $ = cheerio.load(html);
  const notes: LessonNote[] = [];
  const targetFinnish = dateToFinnish(date);

  $("table").each((_, table) => {
    const $table = $(table);

    // Build a flat array indexed by grid-column whose value is the hour.
    // thead has hour-labeled <th>s with colspans (e.g. <th colspan="3">9</th>);
    // replicate each hour by its colspan to get a column->hour lookup.
    // Non-numeric headers (Päivämäärä, Yhteensä, Huomioita) are skipped.
    const hourMap: number[] = [];
    $table.find("thead th").each((_, th) => {
      const text = $(th).text().trim();
      const hour = parseInt(text, 10);
      if (!Number.isNaN(hour) && hour >= 0 && hour <= 23) {
        const colspan = parseInt($(th).attr("colspan") ?? "1", 10) || 1;
        for (let i = 0; i < colspan; i++) hourMap.push(hour);
      }
    });
    if (hourMap.length === 0) return; // not the attendance table (e.g. legend)

    $table.find("tbody tr").each((_, row) => {
      const cells = $(row).find("td").toArray();
      if (cells.length < 3) return; // need at least weekday, date, and one slot

      const rowDate = $(cells[1]).text().trim();
      if (!rowDate || rowDate !== targetFinnish) return;

      // Walk event-grid cells. Indices 0..1 are weekday + date (outside grid).
      let gridCol = 0;
      for (let i = 2; i < cells.length; i++) {
        const $cell = $(cells[i]);
        const colspan = parseInt($cell.attr("colspan") ?? "1", 10) || 1;
        const tpClass = (($cell.attr("class") ?? "").match(/\bat-tp(?:\d+|-other)\b/) ?? [])[0];

        if (tpClass) {
          const isOther = tpClass === "at-tp-other";
          const title = ($cell.attr("title") ?? "").trim();
          // Visible label: the <small> text for remark cells, otherwise the
          // cell text with any <sup> footnote marker removed.
          const $small = $cell.find("small");
          const cellLabel = ($small.length ? $small.text() : $cell.clone().find("sup").remove().end().text()).trim();

          // Title formats observed:
          //   "TypeLabel /TeacherFullName"
          //   "SubjectCode; TypeLabel /TeacherFullName"
          //   "SubjectCode; TypeLabel; Remark /TeacherFullName"
          // The type label itself may contain " / " (e.g. "pari- / ryhmätyö"),
          // so the teacher is split off at the last " /".
          let subject = "";
          let typeLabel = "";
          let note = "";
          let teacher = "";

          if (title) {
            let rest = title;
            const slashIdx = rest.lastIndexOf(" /");
            if (slashIdx > 0) {
              teacher = rest.slice(slashIdx + 2).trim();
              rest = rest.slice(0, slashIdx).trim();
            }
            const segments = rest.split(";").map((seg) => seg.trim()).filter(Boolean);
            if (segments.length > 1) subject = segments.shift() ?? "";
            typeLabel = segments.shift() ?? "";
            note = segments.join("; ");
          }

          if (!typeLabel) typeLabel = isOther ? cellLabel : tpClass.replace("at-tp", "Type ");
          // Absence cells show the teacher code as their text; remark cells
          // show the label, which must never be mistaken for a teacher.
          if (!teacher && !isOther) teacher = cellLabel;

          // Map cell's grid range to start/end via the thead-derived map.
          // start = hour at the cell's first grid column.
          // end   = hour at the cell's last grid column + 45 min.
          // If the cell extends past the mapped grid (shouldn't happen with
          // well-formed tables), report null so consumers don't see a wrong time.
          const startHour = hourMap[gridCol];
          const endHour = hourMap[gridCol + colspan - 1];
          let start: string | null = null;
          let end: string | null = null;
          if (startHour !== undefined && endHour !== undefined) {
            start = `${pad(startHour)}:00`;
            end = `${pad(endHour)}:45`;
          }

          notes.push({
            date,
            start,
            end,
            subject,
            typeLabel,
            typeClass: tpClass,
            teacher,
            note,
          });
        }
        gridCol += colspan;
      }
    });
  });

  return notes;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function dateToFinnish(date: string): string {
  // Convert YYYY-MM-DD to D.M.YYYY (Finnish format, no leading zeros).
  if (!date) return "";
  const parts = date.split("-");
  if (parts.length !== 3) return date;
  const day = parseInt(parts[2], 10);
  const month = parseInt(parts[1], 10);
  const year = parts[0];
  return `${day}.${month}.${year}`;
}
