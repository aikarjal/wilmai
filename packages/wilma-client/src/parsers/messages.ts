import * as cheerio from "cheerio";
import { parseWilmaTimestamp } from "./dates.js";
import { htmlToText } from "./html-text.js";
import type { Message, MessageFolder, MessageReply } from "../types.js";

export function parseMessagesList(data: unknown, folder: MessageFolder): Message[] {
  const now = new Date();
  const list = normalizeMessagesList(data);

  return list.flatMap((item) => {
    try {
      const wilmaId = Number(item["id"] ?? item["Id"]);
      // Without a usable id a message can't be opened; skip it rather than carry NaN.
      if (!Number.isInteger(wilmaId) || wilmaId <= 0) return [];
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
      const sender = item["Sender"] ?? item["sender"];
      return [
        {
          wilmaId,
          subject,
          sentAt: parseWilmaTimestamp(timeValue),
          folder,
          senderName: typeof sender === "string" && sender.trim() ? compactText(sender) : null,
          // Wilma marks unopened messages with a truthy Status (shown in bold).
          unread: Boolean(item["Status"]),
          replyCount: Number(item["Replies"]) || 0,
          fetchedAt: now,
        },
      ];
    } catch {
      return [];
    }
  });
}

/**
 * A message thread from `/messages/<id>?format=json`: the message, who it went
 * to, and every reply. Returns null when the data isn't a thread (older Wilma
 * versions answer with the HTML page instead).
 */
export function parseMessageDetailJson(data: unknown, messageId: number): Message | null {
  const list = (data as { messages?: unknown } | null)?.messages;
  const m = Array.isArray(list) ? (list[0] as Record<string, unknown> | undefined) : undefined;
  if (!m || typeof m !== "object") return null;
  const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  const recipients = Array.isArray(m["Recipients"])
    ? (m["Recipients"] as unknown[]).map(str).filter((r): r is string => Boolean(r))
    : str(m["Recipient"])
      ? [str(m["Recipient"]) as string]
      : null;
  const replies: MessageReply[] = Array.isArray(m["ReplyList"])
    ? (m["ReplyList"] as Record<string, unknown>[]).flatMap((reply) => {
        if (!reply || typeof reply !== "object") return [];
        return [
          {
            id: Number(reply["Id"]) || 0,
            sentAt: parseWilmaTimestamp(reply["TimeStamp"]),
            senderName: str(reply["Sender"]),
            content: htmlToText(str(reply["ContentHtml"])),
          },
        ];
      })
    : [];
  replies.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
  return {
    wilmaId: Number(m["Id"]) || messageId,
    subject: compactText(String(m["Subject"] ?? "")),
    sentAt: parseWilmaTimestamp(m["TimeStamp"]),
    folder: String(m["Folder"] ?? "unknown"),
    senderId: typeof m["SenderId"] === "number" ? m["SenderId"] : null,
    senderType: typeof m["SenderType"] === "number" ? m["SenderType"] : null,
    senderName: str(m["Sender"]),
    content: htmlToText(str(m["ContentHtml"])),
    recipients,
    replies,
    fetchedAt: new Date(),
  };
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
