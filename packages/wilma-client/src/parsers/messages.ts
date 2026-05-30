import * as cheerio from "cheerio";
import { parseWilmaTimestamp } from "./dates.js";
import type { Message, MessageFolder } from "../types.js";

export function parseMessagesList(data: unknown, folder: MessageFolder): Message[] {
  const now = new Date();
  const list = normalizeMessagesList(data);

  return list.flatMap((item) => {
    try {
      const wilmaId = Number(item["id"] ?? item["Id"]);
      const subject = compactText(String(item["Subject"] ?? item["subject"] ?? ""));
      // Try many possible field names for the timestamp
      const timeValue =
        item["Time"] ??
        item["time"] ??
        item["TimeStamp"] ??
        item["Timestamp"] ??
        item["timestamp"] ??
        item["SentAt"] ??
        item["sentAt"] ??
        item["Sent"] ??
        item["sent"] ??
        item["Date"] ??
        item["date"] ??
        item["Created"] ??
        item["created"] ??
        item["CreatedAt"] ??
        item["createdAt"];
      return [
        {
          wilmaId,
          subject,
          sentAt: parseWilmaTimestamp(timeValue),
          folder,
          fetchedAt: now,
        },
      ];
    } catch {
      return [];
    }
  });
}

export function parseMessageDetailHtml(html: string, messageId: number): Message {
  const $ = cheerio.load(html);

  const panelBody = $("div#page-content-area.panel-body");
  const subjElem = panelBody.length ? panelBody.children("h1").first() : $("h1, h2, .panel-title, .msg-subject").first();
  const subject = subjElem.text().trim();

  let senderName: string | null = null;
  let sentAt = new Date();
  let sendersJson: Record<string, unknown> | null = null;

  const propTable = $("table.proptable");
  if (propTable.length) {
    propTable.find("tr").each((_, row) => {
      const th = $(row).find("th").first();
      const td = $(row).find("td").first();
      if (!th.length || !td.length) {
        return;
      }
      const header = th.text().trim().toLowerCase();
      if (header.includes("lähettäjä") || header.includes("sender")) {
        const senderLink = td.find("a.profile-link").first();
        if (senderLink.length) {
          senderName = senderLink.text().trim();
          sendersJson = {
            senders: [
              {
                Name: senderName,
                Href: senderLink.attr("href"),
              },
            ],
          };
        } else {
          senderName = td.text().trim();
        }
      } else if (header.includes("lähetetty") || header.includes("sent")) {
        const sentText = td.text().trim();
        sentAt = parseWilmaTimestamp(sentText);
      }
    });
  }

  let content: string | null = null;

  const replyBoxes = $("div.m-replybox.hidden");
  if (replyBoxes.length > 0) {
    const otherReplies = replyBoxes.filter(function () {
      return !$(this).hasClass("m-replybox-me");
    });
    if (otherReplies.length > 0) {
      const latest = otherReplies.last();
      const inner = latest.find("div.inner.hidden");
      if (inner.length) {
        content = inner.text().trim();
        const replyHeaderText = latest.find("h2").first().text().trim();
        const replySender = latest.find("a.profile-link").first();

        if (replySender.length) {
          senderName = replySender.text().trim();
          sendersJson = {
            senders: [
              {
                Name: senderName,
                Href: replySender.attr("href"),
              },
            ],
          };
        } else {
          const replySenderName = extractReplySenderName(replyHeaderText);
          if (replySenderName) {
            senderName = replySenderName;
            sendersJson = {
              senders: [
                {
                  Name: senderName,
                },
              ],
            };
          }
        }

        if (replyHeaderText) {
          sentAt = parseWilmaTimestamp(extractReplyTimestampText(replyHeaderText));
        }
      }
    }
  }

  if (!content) {
    const hidden = $("div.ckeditor.hidden").first();
    if (hidden.length) {
      content = hidden.text().trim();
    }
  }

  if (!content && panelBody.length) {
    const clone = cheerio.load(panelBody.html() ?? "");
    ["table.proptable", "h1", "iframe", "script", "style"].forEach((sel) => {
      clone(sel).remove();
    });
    const text = clone.root().text().trim();
    if (text) {
      content = text;
    }
  }

  if (!content) {
    const fallback = $(".message-body, .msg-content").first();
    if (fallback.length) {
      fallback.find("script, style").remove();
      content = fallback.text().trim();
    }
  }

  if (!content || !content.trim()) {
    content = "(Could not extract content body)";
  }

  return {
    wilmaId: messageId,
    subject,
    sentAt,
    folder: "unknown",
    senderName,
    sendersJson,
    content,
    fetchedAt: new Date(),
  };
}

function normalizeMessagesList(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) {
    return data as Array<Record<string, unknown>>;
  }
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const list = (obj["messages"] ?? obj["Messages"]) as unknown;
    if (Array.isArray(list)) {
      return list as Array<Record<string, unknown>>;
    }
  }
  return [];
}

/** Export for debugging - returns raw field names from first message */
export function debugMessageFields(data: unknown): string[] {
  const list = normalizeMessagesList(data);
  if (list.length > 0) {
    return Object.keys(list[0]);
  }
  return [];
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractReplyTimestampText(headerText: string): string {
  const absoluteDateTime = /(\d{1,2}\.\d{1,2}\.\d{4}\s+\d{1,2}:\d{2})/.exec(headerText);
  return absoluteDateTime?.[1] ?? headerText;
}

function extractReplySenderName(headerText: string): string | null {
  const match = /^(.+?)\s+(?:vastasi|svarade|replied)\b/i.exec(compactText(headerText));
  const sender = match?.[1]?.trim();
  return sender || null;
}
