/**
 * The Worker's daily numbers (/api/stats): npm downloads and GitHub stars.
 * Fetched once per page load and shared by the counters, which start with the
 * numbers from build time and keep them if this fails (e.g. under `next dev`,
 * which has no Worker).
 */
export interface LiveStats {
  downloads: number | null;
  stars: number | null;
}

let pending: Promise<LiveStats | null> | null = null;

export function liveStats(): Promise<LiveStats | null> {
  pending ??= fetch("/api/stats")
    .then((response) => (response.ok ? response.json() : null))
    .then((body: { downloads?: unknown; stars?: unknown } | null) =>
      body
        ? {
            downloads: typeof body.downloads === "number" ? body.downloads : null,
            stars: typeof body.stars === "number" ? body.stars : null
          }
        : null
    )
    .catch(() => null);
  return pending;
}
