/*
 * Who a parent can write to, and the child's class and supervisors.
 *
 * Seen 2026-10-07 (Helsinki, Wilma 2.36):
 * - the child's front page has a "Huollettavasi tiedot" panel of
 *   `.margin-bottom-inline` blocks, each a `<strong>Label:</strong><br>` and
 *   its value: the name, the class, the class teacher and other supervisors
 *   (each followed by a message link `compose?r_teacher=<id>`), and links to
 *   message all supervisors or all the child's teachers;
 * - `/messages/recipients` lists recipients as `button.recipient-block` with
 *   the compose page in `data-source`, grouped in panels (the child, the other
 *   guardians, all own teachers; staff and teachers per school tab). Disabled
 *   buttons (no data-source) can't be written to. "Omat opettajat" (own
 *   teachers) one by one loads from the panel link's data-source.
 */
import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { AnyNode } from "./forms.js";
import type { MessageRecipient, StudentDetails } from "../types.js";

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

/** A compose link as a path on this Wilma, or null for anything else. */
export function composePath(href: string | undefined, pageUrl: string): string | null {
  if (!href) return null;
  try {
    const page = new URL(pageUrl);
    const url = new URL(href, pageUrl);
    if (url.origin !== page.origin || !/^(\/![^/]+)?\/messages\/compose$/.test(url.pathname)) return null;
    return url.pathname + url.search;
  } catch {
    return null;
  }
}

/** What a compose link writes to, from its r_ parameters (a repeated or mixed one: several people). */
export function recipientKind(path: string): MessageRecipient["kind"] {
  const keys = [...new URL(path, "https://wilma.invalid").searchParams.keys()].filter((k) => k.startsWith("r_"));
  if (keys.length > 1) return "group";
  switch (keys[0]) {
    case "r_teacher":
      return "teacher";
    case "r_personnel":
      return "staff";
    case "r_student":
      return "student";
    case "r_guardian":
      return "guardian";
    case "r_ownteachers":
    case "r_groupteachers":
      return "group";
    default:
      return "other";
  }
}

/**
 * One compose link to several recipients, made as Wilma's own "to all teachers" links are: every r_… parameter of
 * theirs, each once, and for more than one person showrecipients=1&collatedreplies=1 (the recipients see who else
 * got it and each other's replies, which the message form can still untick). The links must be one child's.
 */
export function composeToAll(paths: string[]): string {
  if (!paths.length) throw new TypeError("No recipients");
  if (paths.length === 1) return paths[0];
  const urls = paths.map((p) => new URL(p, "https://wilma.invalid"));
  if (urls.some((u) => u.pathname !== urls[0].pathname)) throw new TypeError("The recipients are another child's");
  const params: [string, string][] = [];
  for (const u of urls) {
    for (const [k, v] of u.searchParams) if (k.startsWith("r_") && !params.some(([a, b]) => a === k && b === v)) params.push([k, v]);
  }
  const out = new URLSearchParams(params);
  if (params.length > 1 || recipientKind(`?${out}`) === "group") {
    out.set("showrecipients", "1");
    out.set("collatedreplies", "1");
  }
  return `${urls[0].pathname}?${out}`;
}

/** The child's class and supervisors from their front page (`/!<n>/`); empty fields when the panel isn't there. */
export function parseStudentDetailsHtml(html: string, pageUrl: string): StudentDetails {
  const $ = cheerio.load(html);
  const details: StudentDetails = { name: null, className: null, supervisors: [], messageGroups: [] };
  // The panel whose blocks carry labels in <strong>, with a class or a supervisor's message link.
  const panel = $(".panel-body")
    .filter((_, p) => $(p).find(".margin-bottom-inline > strong").length > 0)
    .filter((_, p) => /luokka|klass|class/i.test($(p).find(".margin-bottom-inline > strong").text()) || $(p).find("a[href*='r_teacher']").length > 0)
    .first();
  if (!panel.length) return details;
  const group = clean(panel.children("h1, h2").first().text());

  panel.find(".margin-bottom-inline").each((_, block) => {
    const label = clean($(block).children("strong").first().text()).replace(/:$/, "");
    if (!label) return;
    const entries = blockEntries($, block, pageUrl);
    if (/^(nimi|namn|name)$/i.test(label)) details.name = entries[0]?.text ?? null;
    else if (/^(luokka|klass|class)$/i.test(label)) details.className = entries[0]?.text ?? null;
    else if (entries.some((e) => e.link) || /ohjaaja|valvoja|handledare|föreståndare|supervisor|teacher|tutor/i.test(label)) {
      for (const entry of entries) {
        const recipient = entry.link ? { name: entry.text, group, school: null, kind: recipientKind(entry.link), composePath: entry.link } : null;
        details.supervisors.push({ name: entry.text, role: label, recipient });
      }
    }
  });

  panel.find("a.show-text[href], .margin-top a[href], .margin-top-inline a[href]").each((_, a) => {
    const path = composePath($(a).attr("href"), pageUrl);
    if (!path || details.messageGroups.some((g) => g.composePath === path)) return;
    const name = clean($(a).text()) || clean($(a).attr("title") ?? "");
    details.messageGroups.push({ name, group, school: null, kind: recipientKind(path), composePath: path });
  });
  return details;
}

/** A block's values: text up to each <br>, with the message link that follows a name. */
function blockEntries($: CheerioAPI, block: AnyNode, pageUrl: string): { text: string; link: string | null }[] {
  const entries: { text: string; link: string | null }[] = [];
  let text = "";
  let link: string | null = null;
  const flush = () => {
    const value = clean(text);
    if (value) entries.push({ text: value, link });
    text = "";
    link = null;
  };
  $(block)
    .contents()
    .each((_, node) => {
      if (node.type === "text") {
        text += (node as unknown as { data: string }).data;
        return;
      }
      const el = $(node);
      const tag = (node as { tagName?: string }).tagName?.toLowerCase();
      if (tag === "strong") return;
      if (tag === "br") return flush();
      const href = el.is("a") ? el.attr("href") : el.find("a[href]").first().attr("href");
      const path = composePath(href, pageUrl);
      if (path) link = path;
      else text += el.text();
    });
  flush();
  return entries;
}

/**
 * The recipients page (`/messages/recipients`), or a list it loads (own
 * teachers). Only recipients Wilma lets the parent write to are returned.
 */
export function parseRecipientsHtml(html: string, pageUrl: string, defaults: { group?: string } = {}): MessageRecipient[] {
  const $ = cheerio.load(html);
  const tabNames = new Map<string, string>();
  $("a[href^='#'][data-toggle='tab'], .nav-tabs a[href^='#'], ul.nav a[href^='#']").each((_, a) => {
    tabNames.set(($(a).attr("href") ?? "").slice(1), clean($(a).text()));
  });
  const out: MessageRecipient[] = [];
  $(".recipient-block").each((_, button) => {
    const el = $(button);
    if (el.attr("disabled") !== undefined) return;
    const path = composePath(el.attr("data-source"), pageUrl);
    if (!path || out.some((r) => r.composePath === path)) return;
    const panel = el.closest(".panel");
    const group = clean(panel.find(".panel-title").first().text()) || defaults.group || "";
    const tab = el.closest(".tab-pane").attr("id");
    const school = tab && tabNames.has(tab) && !/common/i.test(tab) ? tabNames.get(tab)! : null;
    out.push({ name: clean(el.text()), group, school, kind: recipientKind(path), composePath: path });
  });
  return out;
}

/** Lists the recipients page loads on demand (own teachers one by one): [panel title, path]. */
export function recipientListSources(html: string, pageUrl: string): [string, string][] {
  const $ = cheerio.load(html);
  const page = new URL(pageUrl);
  return $("a.disclosure[data-source]")
    .map((_, a) => {
      try {
        const url = new URL($(a).attr("data-source")!, pageUrl);
        if (url.origin !== page.origin || !/\/messages\/recipients\//.test(url.pathname)) return null;
        return [[clean($(a).text()), url.pathname + url.search] as [string, string]];
      } catch {
        return null;
      }
    })
    .get()
    .filter(Boolean) as [string, string][];
}
