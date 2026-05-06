import * as cheerio from "cheerio";
import type { LessonNote } from "../types.js";

/**
 * Parse Wilma's /attendance/view HTML page into structured LessonNote objects.
 *
 * The attendance page renders lesson notes in a table where:
 * - First <td> = weekday abbreviation (Ma, Ti, Ke, To, Pe)
 * - Second <td> = date in DD.M.YYYY format
 * - Subsequent <td> with class 'at-tpNN' = lesson notes at time positions
 * - title attribute on note cells = "SubjectCode; TypeLabel; TeacherCode"
 * - A separate legend table maps type codes to labels (we skip this entirely)
 */
export function parseAttendanceHtml(
  html: string,
  date: string
): LessonNote[] {
  const $ = cheerio.load(html);
  const notes: LessonNote[] = [];

  // Convert target date to Finnish format DD.M.YYYY for comparison
  // Input is YYYY-MM-DD
  const targetFinnish = dateToFinnish(date);

  // Find the main attendance table (the one with at-tp cells in tbody)
  // Skip legend tables by only looking at the tbody of the first table with date cells
  $("table tbody").each((_, tbody) => {
    $(tbody).find("tr").each((_, row) => {
      const cells = $(row).find("td").toArray();
      if (cells.length < 3) return; // need at least weekday, date, and one note

      // First cell = weekday, second cell = date
      const rowDate = $(cells[1]).text().trim();
      if (!rowDate) return;

      // Skip if this row is not for the requested date
      if (rowDate !== targetFinnish) return;

      // Process remaining cells for notes
      for (let i = 2; i < cells.length; i++) {
        const cell = cells[i];
        const classes = ($(cell).attr("class") ?? "").split(/\s+/);
        const tpClass = classes.find(c => /^at-tp\d+$/.test(c));

        if (tpClass) {
          const title = ($(cell).attr("title") ?? "").trim();
          const cellText = $(cell).text().trim();

          // Parse title. Two formats observed:
          //   "TypeLabel /TeacherFullName"
          //   "SubjectCode; TypeLabel /TeacherFullName"
          let subject = "";
          let typeLabel = "";
          let teacher = cellText;

          if (title) {
            let rest = title;
            // Check for subject prefix before semicolon
            const semiIdx = rest.indexOf(";");
            if (semiIdx > 0) {
              subject = rest.slice(0, semiIdx).trim();
              rest = rest.slice(semiIdx + 1).trim();
            }
            // Split type label and teacher by " /" or " / "
            const slashIdx = rest.lastIndexOf(" /");
            if (slashIdx > 0) {
              // Check if there's a space after the slash too
              const afterSlash = rest.slice(slashIdx + 2);
              const spaceAfter = afterSlash.startsWith(" ") ? 1 : 0;
              typeLabel = rest.slice(0, slashIdx).trim();
              teacher = rest.slice(slashIdx + 2 + spaceAfter).trim();
            }
          }

          // Derive start/end time from column position.
          // Columns 2+ (i=2,3,4...) correspond to hours 08:00, 09:00, 10:00...
          // Assumption: 45-minute lessons starting at 08:00, one column per hour.
          // This matches the default Wilma timetable layout in most Finnish schools.
          // If Wilma changes the column-to-time mapping, this needs updating.
          const hour = 8 + (i - 2);
          let start = null;
          let end = null;
          if (hour >= 8 && hour <= 15) {
            start = `${String(hour).padStart(2, "0")}:00`;
            end = `${String(hour).padStart(2, "0")}:45`;
          }

          notes.push({
            date,
            start,
            end,
            subject,
            typeLabel: typeLabel || tpClass.replace("at-tp", "Type "),
            typeClass: tpClass,
            teacher,
          });
        }
      }
    });
  });

  return notes;
}

function dateToFinnish(date: string): string {
  // Convert YYYY-MM-DD to D.M.YYYY (Finnish format, no leading zeros)
  if (!date) return "";
  const parts = date.split("-");
  if (parts.length !== 3) return date;
  const day = parseInt(parts[2], 10);
  const month = parseInt(parts[1], 10);
  const year = parts[0];
  return `${day}.${month}.${year}`;
}
