import * as cheerio from "cheerio";

const BLOCKS = "p, div, tr, h1, h2, h3, h4, h5, h6, blockquote, table, ul, ol";

/**
 * Readable text from a fragment of Wilma HTML (message and reply bodies):
 * paragraphs and line breaks kept, list items bulleted, and links written as
 * "label (address)" so the address isn't lost.
 */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  const $ = cheerio.load(`<div id="wilmai-root">${html}</div>`);
  const root = $("#wilmai-root");
  root.find("script, style").remove();
  root.find("a[href]").each((_, anchor) => {
    const link = $(anchor);
    const href = (link.attr("href") ?? "").trim();
    const label = link.text().replace(/\s+/g, " ").trim();
    if (!/^(https?:|mailto:)/i.test(href)) return;
    const address = href.replace(/^mailto:/i, "");
    if (!label) link.text(address);
    else if (!label.includes(address) && !address.includes(label)) link.text(`${label} (${address})`);
  });
  root.find("br").replaceWith("\n");
  root.find("li").each((_, item) => {
    $(item).prepend("- ");
    $(item).append("\n");
  });
  root.find(BLOCKS).each((_, block) => {
    $(block).prepend("\n");
    $(block).append("\n");
  });
  return root
    .text()
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
