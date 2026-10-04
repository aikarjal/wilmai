import * as cheerio from "cheerio";
import type { GradebookEntry } from "../types.js";

/**
 * The gradebook (Suoritukset): subjects, their syllabi and courses, each with
 * a grade, scope and completion date. Rows carry their depth as a class
 * ("level1", "level2", …), which gives the tree. An empty gradebook (nothing
 * graded yet) has no table and gives [].
 */
export function parseGradebookHtml(html: string): GradebookEntry[] {
  const $ = cheerio.load(html);
  const roots: GradebookEntry[] = [];
  const stack: { depth: number; entry: GradebookEntry }[] = [];

  $("table tbody tr").each((_, row) => {
    const depthMatch = /\blevel(\d+)\b/.exec($(row).attr("class") ?? "");
    const cells = $(row).find("td");
    if (!depthMatch || cells.length < 2) return;
    const depth = Number(depthMatch[1]);
    const text = (index: number) => $(cells[index]).text().replace(/\s+/g, " ").trim();

    const label = text(0);
    if (!label) return;
    const codeMatch = /^([\p{L}\d]+_[\p{L}\d.]*)\s+(.*)$/u.exec(label);
    const entry: GradebookEntry = {
      name: codeMatch ? codeMatch[2] : label,
      code: codeMatch ? codeMatch[1] : null,
      grade: text(1) || null,
      credits: cells.length > 3 ? text(2) || null : null,
      date: isoDate(text(cells.length > 3 ? 3 : 2)),
      children: [],
    };

    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    if (stack.length) stack[stack.length - 1].entry.children.push(entry);
    else roots.push(entry);
    stack.push({ depth, entry });
  });

  return roots;
}

function isoDate(value: string): string | null {
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : null;
}
