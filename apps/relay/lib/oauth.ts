import { createHash } from "node:crypto";
import { now, seal, unseal } from "./seal";

/* ------------------------------------------------------------------ */
/*  Shapes sealed into tokens                                          */
/* ------------------------------------------------------------------ */

/** A Wilma login, short keys to keep tokens small. */
export interface SealedCreds {
  t: string; // tenant URL
  n?: string | null; // tenant name
  u: string; // username
  p: string; // password
  s?: string | null; // TOTP secret
}

export interface SealedClient {
  r: string[]; // redirect URIs
  n?: string; // client name
}

export interface SealedRequest {
  cid: string;
  ru: string;
  /** Whether the client sent redirect_uri (then /token must repeat it). */
  rx?: boolean;
  st?: string;
  cc: string;
  sc?: string;
  exp: number;
}

/** Logins verified so far on one authorization page (a family can add several Wilmas). */
export interface SealedPending {
  cs: SealedCreds[];
  ac: { wilma: string; students: string[] }[];
  cid: string;
  ru: string;
  exp: number;
}

export interface SealedCode {
  cs: SealedCreds[];
  cid: string;
  ru: string;
  rx?: boolean;
  cc: string;
  sc?: string;
  exp: number;
}

export interface SealedToken {
  cs: SealedCreds[];
  cid: string;
  sc?: string;
  exp: number;
}

export const ACCESS_TTL = 60 * 60; // 1 hour
export const REFRESH_TTL = 60 * 60 * 24 * 60; // 60 days
export const CODE_TTL = 5 * 60;
export const REQUEST_TTL = 30 * 60;
export const MAX_LOGINS = 5;
export const SCOPE = "wilma";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Public origin of this deployment, honouring Vercel's forwarded headers. */
export function originOf(req: Request): string {
  if (process.env.RELAY_ORIGIN) return process.env.RELAY_ORIGIN.replace(/\/$/, "");
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

export function oauthError(error: string, description: string, status = 400): Response {
  return jsonResponse({ error, error_description: description }, status);
}

export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  return createHash("sha256").update(verifier).digest("base64url") === challenge;
}

/**
 * Where the relay will send a sign-in back to. While in private testing:
 * Claude, ChatGPT and apps on the user's own computer (loopback). Override
 * with RELAY_REDIRECT_HOSTS (comma-separated host names).
 */
const DEFAULT_REDIRECT_HOSTS = ["claude.ai", "claude.com", "chatgpt.com", "chat.openai.com"];
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

export function isAllowedRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.hash) return false;
    if (url.protocol === "http:") return LOOPBACK_HOSTS.includes(url.hostname);
    if (url.protocol !== "https:") return false;
    const hosts = (process.env.RELAY_REDIRECT_HOSTS ?? DEFAULT_REDIRECT_HOSTS.join(","))
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
    return hosts.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/** What the login page tells the parent: which app is connecting and where they'll be sent back. */
export function describeRedirect(redirectUri: string): string {
  const url = new URL(redirectUri);
  return LOOPBACK_HOSTS.includes(url.hostname) ? "localhost" : url.hostname;
}

/**
 * Does a requested redirect URI match a registered one? Exact match, except
 * loopback redirects (desktop and CLI apps like Claude Code) match on any port,
 * as RFC 8252 section 7.3 requires: the app picks a free port at runtime.
 */
export function redirectUriMatches(registered: string, requested: string): boolean {
  if (registered === requested) return true;
  try {
    const a = new URL(registered);
    const b = new URL(requested);
    const loopback = (u: URL) => u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    return loopback(a) && loopback(b) && a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search;
  } catch {
    return false;
  }
}

/**
 * Resolve a client_id to its redirect URIs. Two kinds:
 * - Dynamic Client Registration: the client_id is a sealed {redirect URIs} blob (no database).
 * - Client ID Metadata Document: the client_id is an https URL serving the client's metadata.
 */
export async function resolveClient(clientId: string): Promise<{ redirectUris: string[]; name?: string } | null> {
  if (/^https:\/\//.test(clientId)) return fetchClientMetadata(clientId);
  const client = unseal<SealedClient & { exp?: number }>("client", clientId);
  return client ? { redirectUris: client.r.filter(isAllowedRedirectUri), name: client.n } : null;
}

const MAX_METADATA_BYTES = 64 * 1024;

/** Client ID Metadata Document: fetch the client_id URL, carefully (it's attacker-chosen). */
async function fetchClientMetadata(clientId: string): Promise<{ redirectUris: string[]; name?: string } | null> {
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return null;
  }
  // A real host name with a path: no IP literals, no localhost, no bare hosts.
  const host = url.hostname;
  if (url.pathname === "/" || !host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[")) {
    return null;
  }
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok || !res.body) return null;
    // Stop reading at the size cap instead of buffering whatever the host sends.
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_METADATA_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const doc = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      client_id?: string;
      redirect_uris?: unknown;
      client_name?: string;
    };
    if (doc.client_id !== clientId || !Array.isArray(doc.redirect_uris)) return null;
    const redirectUris = doc.redirect_uris.filter((u): u is string => typeof u === "string" && isAllowedRedirectUri(u));
    return { redirectUris, name: typeof doc.client_name === "string" ? doc.client_name.slice(0, 80) : undefined };
  } catch {
    return null;
  }
}

/**
 * Private testing: only listed logins may connect. Entries are a username
 * (any Wilma) or "https://<school>.inschool.fi|username" (that Wilma only).
 * Unset means nobody.
 */
export function isAllowedUser(username: string, tenantUrl?: string): boolean {
  const user = username.trim().toLowerCase();
  const tenant = tenantUrl?.trim().replace(/\/$/, "").toLowerCase();
  return (process.env.RELAY_ALLOWED_USERS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => {
      const bar = entry.lastIndexOf("|");
      if (bar === -1) return entry === user;
      return tenant !== undefined && entry.slice(0, bar).replace(/\/$/, "") === tenant && entry.slice(bar + 1) === user;
    });
}

export function issueTokens(creds: SealedCreds[], clientId: string, scope?: string) {
  const issued = now();
  return {
    access_token: seal("access", { cs: creds, cid: clientId, sc: scope, exp: issued + ACCESS_TTL } satisfies SealedToken),
    token_type: "Bearer",
    expires_in: ACCESS_TTL,
    refresh_token: seal("refresh", { cs: creds, cid: clientId, sc: scope, exp: issued + REFRESH_TTL } satisfies SealedToken),
    scope: scope ?? SCOPE,
  };
}
