/*
 * wilm.ai on Cloudflare. The site itself is static files (`next build` writes
 * them to out/) served straight from Cloudflare; this Worker only answers
 * "/", which sends the visitor to /en or /fi (see run_worker_first in
 * wrangler.jsonc).
 */

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
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
  }
};
