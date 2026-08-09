import * as cheerio from "cheerio";
import { parseWilmaTimestamp } from "./dates.js";
import type { NewsItem } from "../types.js";

export function parseNewsList(data: unknown): NewsItem[] {
  if (Array.isArray(data)) {
    const now = new Date();
    return data.flatMap((item) => {
      try {
        const wilmaId = Number(item["id"] ?? item["Id"]);
        const title = String(item["Title"] ?? item["title"] ?? "");
        const published = parseWilmaTimestamp(item["Published"] ?? item["published"]);
        return [
          {
            wilmaId,
            title,
            published,
            fetchedAt: now,
          },
        ];
      } catch {
        return [];
      }
    });
  }
  return [];
}

export function parseNewsDetailJson(newsId: number, data: Record<string, unknown>): NewsItem {
  return {
    wilmaId: newsId,
    title: String(data["title"] ?? data["Title"] ?? ""),
    subtitle: (data["subtitle"] ?? data["Subtitle"]) as string | null,
    author: (data["author"] ?? data["Author"]) as string | null,
    published: parseWilmaTimestamp(data["Published"] ?? data["published"]),
    content: (data["content"] ?? data["Content"]) as string | null,
    fetchedAt: new Date(),
  };
}

export function parseNewsDetailHtml(html: string, newsId: number): NewsItem {
  const $ = cheerio.load(html);

  let title = $("title").text().trim();
  if (title.endsWith(" - Wilma")) {
    title = title.slice(0, -8).trim();
  }
  if (!title) {
    const titleElem = $("#page-content-area h1, #main-content h1, h1").first();
    title = titleElem.text().trim();
  }

  const subtitleElem = $("p.sub-text, .subtitle").first();
  const subtitle = subtitleElem.length ? subtitleElem.text().trim() : null;

  let content: string | null = null;
  const contentElem = $(".panel-body, .news-content, .content, .ckeditor, article").first();
  if (contentElem.length) {
    contentElem.find("script, style").remove();
    // Some bulletins have no prose body — the entire payload is a single link
    // (e.g. a SharePoint PDF loaded into the #content-wrapper iframe). Cheerio's
    // .text() drops href URLs, leaving only header/footer. Inline each anchor's
    // URL next to its text so link-only bulletins keep their actionable content.
    contentElem.find("a[href]").each((_, el) => {
      const anchor = $(el);
      const href = (anchor.attr("href") ?? "").trim();
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) {
        return;
      }
      const label = anchor.text().trim();
      // Avoid duplicating when the visible text already is the URL.
      if (label === href) {
        return;
      }
      anchor.text(label ? `${label} (${href})` : href);
    });
    content = contentElem.text().trim();
  }

  return {
    wilmaId: newsId,
    title,
    subtitle,
    author: null,
    published: null,
    content,
    fetchedAt: new Date(),
  };
}

export function parseNewsListHtml(html: string): NewsItem[] {
  const $ = cheerio.load(html);
  const now = new Date();
  const newsItems: NewsItem[] = [];
  const seenIds = new Set<number>();

  const headers = $("div.left h2.no-border, h2.no-border");
  if (!headers.length) {
    return newsItems;
  }

  headers.each((_, header) => {
    const headerEl = $(header);
    const timestampRaw = headerEl.text().trim();
    const published = parseWilmaTimestamp(timestampRaw);

    let sib = headerEl.next();
    while (sib.length) {
      if (sib.is("h2") && sib.hasClass("no-border")) {
        break;
      }
      if (sib.is("div") && (sib.hasClass("well") || sib.hasClass("margin-bottom"))) {
        const container = sib;
        const linkTag = container.find("a[href*='/news/']").first();
        const href = linkTag.attr("href") ?? "";
        const match = /\/news\/(\d+)/.exec(href);
        const newsId = match ? Number(match[1]) : null;
        if (!newsId || seenIds.has(newsId)) {
          sib = sib.next();
          continue;
        }
        seenIds.add(newsId);

        const titleElem = container.find("h1, h2, h3, h4").first();
        const title = titleElem.text().trim() || linkTag.text().trim() || "Untitled News";

        const subtitleElem = container.find("p.sub-text").first();
        const subtitle = subtitleElem.length ? subtitleElem.text().trim() : null;

        let author: string | null = null;
        const metaP = container.find("p.small").first();
        if (metaP.length) {
          const authorLink = metaP.find("a.profile-link").first();
          if (authorLink.length) {
            author = authorLink.attr("title") ?? authorLink.text().trim();
          } else {
            const tooltip = metaP.find("span.tooltip").first();
            if (tooltip.length) {
              author = tooltip.attr("title") ?? tooltip.text().trim();
            } else {
              const metaSpan = metaP.find("span.horizontal-link-container.small").first();
              if (metaSpan.length) {
                const metaText = metaSpan.text().trim();
                if (metaText.toLowerCase().includes("ylläpidon tiedote")) {
                  author = "Ylläpito";
                } else if (metaText.split(/\s+/).length < 5 && metaText !== linkTag.text().trim()) {
                  author = metaText;
                }
              }
            }
          }
        }

        newsItems.push({
          wilmaId: newsId,
          title,
          subtitle,
          author,
          published,
          fetchedAt: now,
        });
      }

      sib = sib.next();
    }
  });

  return newsItems;
}
