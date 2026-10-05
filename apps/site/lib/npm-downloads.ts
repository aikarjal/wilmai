/*
 * All-time npm downloads of the CLI, for the counter in the hero. Used at build
 * time (the number in the static page) and by the Worker's /api/downloads
 * (the live number), so it must not depend on Next.
 */

export const NPM_PACKAGE = "@wilm-ai/wilma-cli";
export const NPM_PAGE = `https://www.npmjs.com/package/${NPM_PACKAGE}`;

const FIRST_RELEASE = "2026-02-05";
const DAY = 24 * 60 * 60 * 1000;

// npm answers at most 18 months per query, so count a year at a time.
function yearRanges(from: string, now: Date): [string, string][] {
  const iso = (time: number) => new Date(time).toISOString().slice(0, 10);
  const ranges: [string, string][] = [];
  for (let start = Date.parse(from); start <= now.getTime(); start += 365 * DAY) {
    ranges.push([iso(start), iso(Math.min(start + 364 * DAY, now.getTime()))]);
  }
  return ranges;
}

export async function totalDownloads(init: RequestInit = {}, now = new Date()): Promise<number> {
  const counts = await Promise.all(
    yearRanges(FIRST_RELEASE, now).map(async ([start, end]) => {
      const response = await fetch(
        `https://api.npmjs.org/downloads/point/${start}:${end}/${NPM_PACKAGE}`,
        init
      );
      if (!response.ok) throw new Error(`npm downloads API answered ${response.status}`);
      const body = (await response.json()) as { downloads?: unknown };
      if (typeof body.downloads !== "number") throw new Error("npm downloads API: no count");
      return body.downloads;
    })
  );
  return counts.reduce((sum, count) => sum + count, 0);
}
