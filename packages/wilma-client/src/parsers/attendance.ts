import * as cheerio from "cheerio";
import type { LessonNote, LessonNoteSummary } from "../types.js";

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
 * Two kinds of event cells: absence-type marks (`<td class="at-tpN">`, whose
 * text is the teacher's code) and free-text remarks such as praise or
 * behaviour notes (`<td class="at-tp-other">`, whose text is a `<small>`
 * label plus an optional `<sup>` footnote marker pointing at the
 * "Huomioita" column). The title attribute carries the details:
 * "TypeLabel /TeacherName", "SubjectCode; TypeLabel /TeacherName" or
 * "SubjectCode; TypeLabel; teacher's note /TeacherName".
 */
export function parseAttendanceHtml(html: string, date?: string): LessonNote[] {
  const $ = cheerio.load(html);
  const notes: LessonNote[] = [];
  // One day, or every day the page shows (the page covers a chosen period).
  const targetFinnish = date ? dateToFinnish(date) : null;
  // The legend table: type class (at-tpN) -> label.
  const legend = new Map<string, string>();
  $("tr").each((_, row) => {
    const cells = $(row).find("td");
    const tp = (($(cells[0]).attr("class") ?? "").match(/\bat-tp\d+\b/) ?? [])[0];
    const label = $(cells[cells.length - 1]).text().trim();
    if (tp && cells.length === 2 && label && !legend.has(tp)) legend.set(tp, label);
  });

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
      if (!rowDate || (targetFinnish && rowDate !== targetFinnish)) return;
      const rowIso = finnishToIso(rowDate);
      if (!rowIso) return;

      // Walk event-grid cells. Indices 0..1 are weekday + date (outside grid).
      let gridCol = 0;
      for (let i = 2; i < cells.length; i++) {
        const $cell = $(cells[i]);
        const colspan = parseInt($cell.attr("colspan") ?? "1", 10) || 1;
        const tpClass = (($cell.attr("class") ?? "").match(/\bat-tp(?:\d+|-other)\b/) ?? [])[0];

        if (tpClass) {
          const isRemark = tpClass === "at-tp-other";
          const title = ($cell.attr("title") ?? "").trim();
          // The visible text: a remark's <small> label, or an absence mark's
          // teacher code; a <sup> footnote marker is never part of either.
          const $small = $cell.find("small");
          const cellText = ($small.length ? $small.text() : $cell.clone().find("sup").remove().end().text()).trim();

          // Title formats observed:
          //   "TypeLabel /TeacherFullName"
          //   "SubjectCode; TypeLabel /TeacherFullName"
          //   "SubjectCode; TypeLabel; teacher's note /TeacherFullName"
          //   "TypeLabel; teacher's note /TeacherFullName" (no lesson)
          // The page's legend names each type class, which tells the label
          // apart from a subject code or a note.
          let subject = "";
          let typeLabel = "";
          let note: string | null = null;
          // A remark's cell text is its label, never a teacher.
          let teacher = isRemark ? "" : cellText;

          if (title) {
            let rest = title;
            const slashIdx = rest.lastIndexOf(" /");
            if (slashIdx > 0) {
              teacher = rest.slice(slashIdx + 2).trim();
              rest = rest.slice(0, slashIdx).trim();
            }
            const parts = rest.split(";").map((part) => part.trim());
            const known = legend.get(tpClass);
            let labelAt = known ? parts.indexOf(known) : -1;
            if (labelAt < 0) {
              // No legend: a leading course code (no spaces, e.g. "MA_71") is the subject.
              labelAt = parts.length > 1 && !/\s/.test(parts[0]) ? 1 : 0;
            }
            subject = parts.slice(0, labelAt).join("; ");
            typeLabel = parts[labelAt] ?? "";
            note = parts.slice(labelAt + 1).join("; ") || null;
          }

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
            date: rowIso,
            start,
            end,
            subject,
            typeLabel: typeLabel || (isRemark ? cellText : tpClass.replace("at-tp", "Type ")),
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

/** Count lesson notes by kind (absences, lateness, feedback…), most common first. */
export function summarizeLessonNotes(notes: LessonNote[], from: string | null, to: string | null): LessonNoteSummary {
  const counts = new Map<string, number>();
  for (const note of notes) counts.set(note.typeLabel, (counts.get(note.typeLabel) ?? 0) + 1);
  return {
    from,
    to,
    total: notes.length,
    byType: [...counts].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
  };
}

function finnishToIso(value: string): string | null {
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : null;
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
