/*
 * Wilma shows times in Finnish local time. The code may run anywhere — a
 * parent's laptop, or a server in UTC — so conversions go through
 * Europe/Helsinki explicitly instead of the machine's time zone.
 */

const TIME_ZONE = "Europe/Helsinki";

const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export interface FinnishParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The Finnish wall-clock time of an instant. */
export function finnishParts(date: Date): FinnishParts {
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

/** YYYY-MM-DD of an instant in Finnish time. */
export function finnishDateString(date: Date = new Date()): string {
  const p = finnishParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function offsetMs(instant: number): number {
  const p = finnishParts(new Date(instant));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant / 1000) * 1000;
}

/** The instant of a Finnish wall-clock time (handles summer time). */
export function finnishTime(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let instant = asUtc - offsetMs(asUtc);
  // Near a daylight-saving switch the offset at the guess can differ; recheck once.
  const corrected = asUtc - offsetMs(instant);
  if (corrected !== instant) instant = corrected;
  return new Date(instant);
}
