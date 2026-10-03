import { finnishParts, finnishTime } from "../finnish-time.js";

export function parseWilmaTimestamp(value: unknown): Date {
  if (value === null || value === undefined) {
    return fallbackDate();
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return fallbackDate();
    }
    // Wilma can provide Unix seconds or milliseconds.
    // Values >= 1e12 are treated as milliseconds.
    const millis = Math.abs(value) >= 1_000_000_000_000 ? value : value * 1000;
    return new Date(millis);
  }

  const raw = String(value).trim();

  // Try ISO 8601 format first (e.g., "2026-02-05T13:56:42.737Z")
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const parsed = new Date(raw);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  // Try YYYY-MM-DD HH:MM format (e.g., "2026-02-05 14:00")
  const isoLikeMatch = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})$/.exec(raw);
  if (isoLikeMatch) {
    const [, y, m, d, h, mi] = isoLikeMatch.map(Number);
    return finnishTime(y, m, d, h, mi);
  }

  // Try Unix timestamp as string
  if (/^\d{10,13}$/.test(raw)) {
    const num = Number(raw);
    // 10 digits = seconds, 13 digits = milliseconds
    return new Date(raw.length === 10 ? num * 1000 : num);
  }

  const text = raw
    .toLowerCase()
    .replace("klo", "")
    .replace("julkaistu", "")
    .trim();

  const now = new Date();
  const todayParts = finnishParts(now);

  const rel: Record<string, number> = {
    "tänään": 0,
    "eilen": 1,
    today: 0,
    yesterday: 1,
    idag: 0,
    "i dag": 0,
    "igår": 1,
    "i går": 1,
  };

  for (const [kw, daysAgo] of Object.entries(rel)) {
    if (text.includes(kw)) {
      const timeMatch = /(\d{1,2})[:.](\d{2})/.exec(text);
      const h = timeMatch ? Number(timeMatch[1]) : 0;
      const m = timeMatch ? Number(timeMatch[2]) : 0;
      // Day arithmetic in UTC on the Finnish calendar date, then back to Finnish time.
      const day = new Date(Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day - daysAgo));
      return finnishTime(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h, m);
    }
  }

  for (const fmt of ["dateTime", "dateOnly"]) {
    if (fmt === "dateTime") {
      const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})$/.exec(text);
      if (match) {
        const [, d, m, y, h, mi] = match.map(Number);
        return finnishTime(y, m, d, h, mi);
      }
    } else {
      const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
      if (match) {
        const [, d, m, y] = match.map(Number);
        return finnishTime(y, m, d);
      }
    }
  }

  const shortMatch = /^(\d{1,2})\.(\d{1,2})\.$/.exec(text);
  if (shortMatch) {
    const [, dStr, mStr] = shortMatch;
    const day = Number(dStr);
    const month = Number(mStr);
    // A day and month without a year: this year, unless that is over six months ahead.
    let candidate = finnishTime(todayParts.year, month, day);
    if (candidate.getTime() > now.getTime() + 180 * 24 * 60 * 60 * 1000) {
      candidate = finnishTime(todayParts.year - 1, month, day);
    }
    return candidate;
  }

  return fallbackDate();
}

function fallbackDate(): Date {
  // Keep unknown timestamps deterministic and old so recency filters
  // do not treat undated items as fresh.
  return new Date(0);
}
