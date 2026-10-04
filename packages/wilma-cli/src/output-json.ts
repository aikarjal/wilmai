import { finnishIsoString } from "@wilm-ai/wilma-client";

/*
 * JSON as agents get it, from the CLI and the MCP tools alike:
 * - times in Finnish time with their offset ("2026-10-02T13:37:00+03:00"), so
 *   nobody reads UTC as the time on the school's clock;
 * - no bookkeeping fields that cost tokens and say nothing (when the client
 *   fetched an item, Wilma's internal type classes and sender ids);
 * - compact unless asked for pretty output.
 */

const NOISE = new Set(["fetchedAt", "typeClass", "sendersJson", "senderId", "senderType"]);

export function toAgentJson(value: unknown, pretty = false): string {
  return JSON.stringify(
    value,
    function (this: Record<string, unknown>, key, converted) {
      if (NOISE.has(key)) return undefined;
      const raw = this[key];
      // Wilma's numeric message status; `unread` says the same in words.
      if (key === "status" && typeof raw === "number") return undefined;
      if (raw instanceof Date) {
        const time = raw.getTime();
        // Unknown timestamps are kept as the epoch internally.
        return Number.isNaN(time) || time <= 0 ? null : finnishIsoString(raw);
      }
      return converted;
    },
    pretty ? 2 : undefined
  );
}
