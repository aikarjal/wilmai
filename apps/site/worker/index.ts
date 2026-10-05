/*
 * wilm.ai on Cloudflare. The site itself is static files (`next build` writes
 * them to out/) served straight from Cloudflare; this Worker only answers
 * "/", which sends the visitor to /en or /fi, and /api/* (see run_worker_first
 * in wrangler.jsonc): /api/stats, the live numbers in the page (npm downloads
 * and GitHub stars), and /api/badge/downloads, the same download count as a
 * shields.io badge for the GitHub README. A daily cron job fetches the numbers
 * and keeps them in KV.
 */

import { githubStars } from "../lib/github-stars";
import { totalDownloads } from "../lib/npm-downloads";

interface KVNamespace {
  get(key: string, options: { type: "json"; cacheTtl?: number }): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
}

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** The daily numbers, under STATS_KEY. */
  STATS: KVNamespace;
  /**
   * Optional secret: a GitHub token with no permissions. GitHub limits
   * anonymous API requests per IP address, and Cloudflare's are shared.
   */
  GITHUB_TOKEN?: string;
}

const LANGS = ["en", "fi"] as const;

/** The language picked with the EN/FI toggle, else the browser's, else English. */
export function preferredLang(request: Request): string {
  const cookie = request.headers.get("cookie") ?? "";
  const picked = /(?:^|;\s*)lang=([^;]+)/.exec(cookie)?.[1];
  if (picked && (LANGS as readonly string[]).includes(picked)) return picked;
  for (const part of (request.headers.get("accept-language") ?? "").split(",")) {
    const tag = part.split(";")[0].trim().toLowerCase();
    if (tag === "fi" || tag.startsWith("fi-")) return "fi";
    if (tag === "en" || tag.startsWith("en-")) return "en";
  }
  return "en";
}

/** The CLI's all-time npm downloads and the repository's GitHub stars; null if never fetched. */
interface Stats {
  downloads: number | null;
  stars: number | null;
  updated: string;
}

const STATS_KEY = "stats";

async function readStats(env: Env): Promise<Stats | null> {
  // The numbers change once a day, so each Cloudflare location may keep them an hour.
  const stored = (await env.STATS.get(STATS_KEY, { type: "json", cacheTtl: 3600 }).catch(() => null)) as Stats | null;
  return stored && typeof stored.updated === "string" ? stored : null;
}

/**
 * Fetch both numbers; one that fails keeps its last value. Each failure is
 * logged with console.error, which Workers Logs keeps and Workers Issues
 * turns into an issue (observability in wrangler.jsonc).
 */
async function refreshStats(env: Env): Promise<{ stats: Stats; failed: string[] }> {
  const previous = await readStats(env);
  const [downloads, stars] = await Promise.allSettled([
    totalDownloads({ signal: AbortSignal.timeout(10_000) }),
    githubStars({ signal: AbortSignal.timeout(10_000) }, env.GITHUB_TOKEN)
  ]);
  const failed: string[] = [];
  if (downloads.status === "rejected") {
    failed.push("npm downloads");
    console.error("stats: npm downloads failed:", String(downloads.reason));
  }
  if (stars.status === "rejected") {
    failed.push("GitHub stars");
    console.error("stats: GitHub stars failed:", String(stars.reason));
  }
  const stats: Stats = {
    downloads: downloads.status === "fulfilled" ? downloads.value : (previous?.downloads ?? null),
    stars: stars.status === "fulfilled" ? stars.value : (previous?.stars ?? null),
    updated: new Date().toISOString()
  };
  await env.STATS.put(STATS_KEY, JSON.stringify(stats));
  console.log("stats:", JSON.stringify(stats));
  return { stats, failed };
}

/** The stored numbers; fetched right away only before the first cron run. */
async function currentStats(env: Env): Promise<Stats | null> {
  return (await readStats(env)) ?? (await refreshStats(env).then((r) => r.stats, () => null));
}

async function statsResponse(env: Env): Promise<Response> {
  const stats = await currentStats(env);
  if (!stats) {
    return Response.json({ error: "no numbers yet" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json(
    { downloads: stats.downloads, stars: stats.stars },
    { headers: { "Cache-Control": "public, max-age=3600" } }
  );
}

/**
 * The download count for a shields.io endpoint badge (the README's). shields'
 * own npm badge counts only the last 18 months and rounds (5.8k); this is the
 * site's all-time number.
 */
async function downloadsBadge(env: Env): Promise<Response> {
  const downloads = (await currentStats(env))?.downloads ?? null;
  return Response.json(
    downloads === null
      ? { schemaVersion: 1, label: "downloads", message: "unavailable", color: "lightgrey" }
      : { schemaVersion: 1, label: "downloads", message: downloads.toLocaleString("en-US"), color: "2e9e93", cacheSeconds: 3600 },
    { headers: { "Cache-Control": "public, max-age=3600" } }
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/stats") return statsResponse(env);
    if (url.pathname === "/api/badge/downloads") return downloadsBadge(env);
    if (url.pathname !== "/") return env.ASSETS.fetch(request);
    url.pathname = `/${preferredLang(request)}`;
    return new Response(null, {
      status: 307,
      headers: {
        Location: url.toString(),
        Vary: "Accept-Language, Cookie",
        "Cache-Control": "private, no-store"
      }
    });
  },

  /**
   * The daily cron job (triggers in wrangler.jsonc). A failed fetch fails the
   * run, so it shows as an error in the Worker's cron events and logs.
   */
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    const { failed } = await refreshStats(env);
    if (failed.length) throw new Error(`Daily stats: ${failed.join(" and ")} failed; the last values stay.`);
  }
};
