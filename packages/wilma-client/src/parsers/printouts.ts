import * as cheerio from "cheerio";
import type { Printout } from "../types.js";

/** Printouts (Tulosteet): PDF documents the school offers, e.g. report cards or absence reports. */
export function parsePrintoutsHtml(html: string): Printout[] {
  const $ = cheerio.load(html);
  const printouts: Printout[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_, anchor) => {
    const href = $(anchor).attr("href") ?? "";
    const match = /^(?:https?:\/\/[^/]+)?(\/(?:![^/]+\/)?printouts\/(\d+)\.pdf)(?:[?#].*)?$/.exec(href);
    if (!match || seen.has(match[2])) return;
    seen.add(match[2]);
    printouts.push({
      id: match[2],
      title: $(anchor).text().replace(/\s+/g, " ").trim() || `Printout ${match[2]}`,
      path: match[1],
    });
  });
  return printouts;
}
