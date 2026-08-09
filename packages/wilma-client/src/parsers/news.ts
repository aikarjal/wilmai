import * as cheerio from "cheerio";
import { parseWilmaTimestamp } from "./dates.js";
import type { NewsItem, NewsResource } from "../types.js";

const FILE_EXTENSION_RE = /\.(?:pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|txt|csv|zip|7z|png|jpe?g|gif|webp)$/i;

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

export function parseNewsDetailJson(
  newsId: number,
  data: Record<string, unknown>,
  baseUrl?: string
): NewsItem {
  const content = (data["content"] ?? data["Content"]) as string | null;
  let resources: NewsResource[] = [];
  if (content && content.includes("<a")) {
    const $ = cheerio.load(content);
    resources = extractNewsResources($, $.root(), baseUrl);
  }
  return {
    wilmaId: newsId,
    title: String(data["title"] ?? data["Title"] ?? ""),
    subtitle: (data["subtitle"] ?? data["Subtitle"]) as string | null,
    author: (data["author"] ?? data["Author"]) as string | null,
    published: parseWilmaTimestamp(data["Published"] ?? data["published"]),
    content,
    resources,
    fetchedAt: new Date(),
  };
}

export function parseNewsDetailHtml(html: string, newsId: number, baseUrl?: string): NewsItem {
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
  let resources: NewsResource[] = [];
  // Wilma can hide link-only bulletin content when it renders the target in an
  // iframe. Prefer the dedicated container even when it carries .hidden.
  const dedicatedContent = $("#news-content").first();
  const contentElem = dedicatedContent.length
    ? dedicatedContent
    : $(".news-content, .content, .ckeditor, article, .panel-body").first();
  if (contentElem.length) {
    resources = extractNewsResources($, contentElem, baseUrl);

    const cleanContent = contentElem.clone();
    cleanContent.find("script, style").remove();
    const text = cleanContent.text().trim();

    // A container made entirely from resource anchors has no prose body. Keep
    // the labels in resources instead of duplicating them in content.
    const proseOnly = cleanContent.clone();
    proseOnly.find("a[href]").remove();
    content = proseOnly.text().trim() ? text : null;
  }

  return {
    wilmaId: newsId,
    title,
    subtitle,
    author: null,
    published: null,
    content,
    resources,
    fetchedAt: new Date(),
  };
}

function extractNewsResources(
  $: cheerio.CheerioAPI,
  contentElem: cheerio.Cheerio<any>,
  baseUrl?: string
): NewsResource[] {
  const resources: NewsResource[] = [];
  const seen = new Set<string>();

  contentElem.find("a[href]").each((_, element) => {
    const anchor = $(element);
    const rawHref = (anchor.attr("href") ?? "").trim();
    const url = resolveSafeHttpUrl(rawHref, baseUrl);
    if (!url || seen.has(url.href)) {
      return;
    }
    seen.add(url.href);

    const authContext = baseUrl && url.origin === new URL(baseUrl).origin ? "wilma" : "external";
    // Only a naming hint — never used to decide whether a download may be
    // attempted. The download attempt itself reveals whether a URL is a file.
    const fileName = FILE_EXTENSION_RE.test(decodeURIComponentSafely(url.pathname))
      ? fileNameFromUrl(url)
      : null;
    const label = anchor.text().trim() || fileName || url.host;

    resources.push({
      id: `resource-${resources.length + 1}`,
      label,
      url: url.href,
      authContext,
      fileName,
    });
  });

  return resources;
}

function resolveSafeHttpUrl(rawHref: string, baseUrl?: string): URL | null {
  if (!rawHref || rawHref.startsWith("#")) {
    return null;
  }
  try {
    const url = baseUrl ? new URL(rawHref, baseUrl) : new URL(rawHref);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function fileNameFromUrl(url: URL): string | null {
  const lastSegment = url.pathname.split("/").filter(Boolean).at(-1);
  return lastSegment ? decodeURIComponentSafely(lastSegment) : null;
}

function decodeURIComponentSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
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
