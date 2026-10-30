/*
 * What the local bridge and the desktop app's main process share: forwarding
 * one request to a Wilma or to Jev, and (on a developer's machine) borrowing
 * the WilmAI CLI's saved login. Nothing is stored here.
 */
import { createHash } from "node:crypto";
import { request as localHttpRequest } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import tenantList from "../../../packages/wilma-client/tenant_list.json" with { type: "json" };
import { ollamaEndpoint } from "../src/ai/config.ts";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36";
const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const MAX_BODY = 2 * 1024 * 1024;

export function wilmaHosts(): Set<string> {
  const hosts = new Set((tenantList as { wilmat: { url: string }[] }).wilmat.map((t) => new URL(t.url).host));
  for (const extra of (process.env.WILMAI_EXTRA_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean)) {
    hosts.add(extra);
  }
  return hosts;
}

export interface WireRequest {
  url: string;
  method: "GET" | "POST";
  body?: string;
  contentType?: string;
  cookie?: string;
  headers?: Record<string, string>;
}

export async function readJson<T>(req: AsyncIterable<unknown>): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "Request too large");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    throw new HttpError(400, "Expected JSON");
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export async function forwardToWilma(hosts: Set<string>, wire: WireRequest) {
  let url: URL;
  try {
    url = new URL(wire.url);
  } catch {
    throw new HttpError(400, "Bad URL");
  }
  if (url.protocol !== "https:" || !hosts.has(url.host)) throw new HttpError(403, `Not a known Wilma: ${url.host}`);
  const headers = new Headers({ "User-Agent": USER_AGENT, Referer: `${url.origin}/` });
  if (wire.cookie) headers.set("Cookie", wire.cookie);
  if (wire.contentType) headers.set("Content-Type", wire.contentType);
  // Only what Wilma's own pages add (an invitation sign-up); the rest is ours.
  for (const [name, value] of Object.entries(wire.headers ?? {})) {
    if (/^(accept|x-requested-with)$/i.test(name) && typeof value === "string") headers.set(name, value);
  }
  const resp = await fetch(url, {
    method: wire.method === "POST" ? "POST" : "GET",
    body: wire.method === "POST" ? (wire.body ?? "") : undefined,
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  return {
    status: resp.status,
    url: url.href,
    location: resp.headers.get("location"),
    setCookie: resp.headers.getSetCookie(),
    contentType: resp.headers.get("content-type") ?? "",
    body: await resp.text(),
  };
}

const OPENAI_URL = "https://api.openai.com";
/** OpenAI, for the Luna experiment: only these two endpoints. */
const OPENAI_PATHS = ["/v1/responses", "/v1/decisions"];

export async function forwardToOpenAI(key: unknown, path: unknown, body: unknown) {
  if (typeof key !== "string" || !key.trim()) throw new HttpError(400, "No OpenAI key");
  if (typeof path !== "string" || !OPENAI_PATHS.includes(path)) throw new HttpError(400, "Not an endpoint the app uses");
  // OpenAI's API never redirects: a redirect is a network standing in for it (a block page), so it isn't followed.
  const resp = await fetch(`${OPENAI_URL}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${key.trim()}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    redirect: "manual",
    signal: AbortSignal.timeout(120_000),
  });
  return { status: resp.status, retryAfter: resp.headers.get("retry-after"), body: await resp.text(), fromOpenai: fromOpenAI(resp.headers) };
}

/** OpenAI's own headers: every answer from its API has them; a block page or a proxy's error doesn't. */
const fromOpenAI = (headers: Headers) => headers.has("x-request-id") || [...headers.keys()].some((name) => name.startsWith("openai-"));

/** Can this computer reach OpenAI at all? One request without a key (OpenAI answers 401 with its own headers). */
export async function openAIReach(): Promise<{ reachable: boolean; reason: string | null; detail: string | null }> {
  try {
    const resp = await fetch(`${OPENAI_URL}/v1/models`, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
    await resp.body?.cancel();
    return fromOpenAI(resp.headers) ? { reachable: true, reason: null, detail: null } : { reachable: false, reason: "intercepted", detail: `HTTP ${resp.status}` };
  } catch (err) {
    return { reachable: false, reason: "network", detail: err instanceof Error ? err.message : String(err) };
  }
}

const ANTHROPIC_URL = "https://api.anthropic.com";
/** The Messages API version the app's requests are written for (`output_config`; no sampling parameters). */
export const ANTHROPIC_VERSION = "2026-10-21";

/** Anthropic, when Claude is the AI: only the Messages endpoint. */
export async function forwardToAnthropic(key: unknown, body: unknown) {
  if (typeof key !== "string" || !key.trim()) throw new HttpError(400, "No Anthropic key");
  // Anthropic's API never redirects either: a redirect is a network standing in for it.
  const resp = await fetch(`${ANTHROPIC_URL}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": key.trim(), "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
    body: JSON.stringify(body),
    redirect: "manual",
    signal: AbortSignal.timeout(120_000),
  });
  return { status: resp.status, retryAfter: resp.headers.get("retry-after"), body: await resp.text(), fromAnthropic: fromAnthropic(resp.headers) };
}

/** Anthropic's own headers: every answer from its API has a request-id (and anthropic-* headers); a block page doesn't. */
const fromAnthropic = (headers: Headers) => headers.has("request-id") || [...headers.keys()].some((name) => name.startsWith("anthropic-"));

/** Can this computer reach Anthropic at all? One request without a key (Anthropic answers 401 with its own headers). */
export async function anthropicReach(): Promise<{ reachable: boolean; reason: string | null; detail: string | null }> {
  try {
    const resp = await fetch(`${ANTHROPIC_URL}/v1/models`, { headers: { "anthropic-version": ANTHROPIC_VERSION }, redirect: "manual", signal: AbortSignal.timeout(20_000) });
    await resp.body?.cancel();
    return fromAnthropic(resp.headers) ? { reachable: true, reason: null, detail: null } : { reachable: false, reason: "intercepted", detail: `HTTP ${resp.status}` };
  } catch (err) {
    return { reachable: false, reason: "network", detail: err instanceof Error ? err.message : String(err) };
  }
}

const OLLAMA_GET = ["/api/version", "/api/tags", "/api/ps"];
const OLLAMA_POST = ["/api/chat", "/v1/systemone", "/api/show", "/api/generate"];
export async function forwardToOllama(wire: { endpoint: string; path: string; body?: unknown }) {
  const endpoint = ollamaEndpoint(wire.endpoint);
  const get = OLLAMA_GET.includes(wire.path);
  if (!get && !OLLAMA_POST.includes(wire.path)) throw new HttpError(400, "Not a local model endpoint the app uses");
  // /api/generate is only used to unload a model; text extraction uses /api/chat.
  if (wire.path === "/api/generate" && (!wire.body || Object.keys(wire.body as object).sort().join(",") !== "keep_alive,model" || (wire.body as { keep_alive: unknown }).keep_alive !== 0)) throw new HttpError(400, "Only model unloading is allowed here");
  // Native HTTP bypasses environment proxies and has no redirect handler.
  return new Promise<{ status: number; retryAfter: null; body: string }>((resolve, reject) => {
    const req = localHttpRequest(`${endpoint}${wire.path}`, { method: get ? "GET" : "POST", agent: false, headers: { "content-type": "application/json" } }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY) req.destroy(new Error("Ollama's response was too large"));
        else chunks.push(chunk);
      });
      res.on("error", reject);
      res.on("end", () => resolve({ status: res.statusCode ?? 502, retryAfter: null, body: Buffer.concat(chunks).toString("utf8") }));
    });
    const timeout = setTimeout(() => req.destroy(new Error("Ollama's request timed out")), get ? 10_000 : 300_000);
    req.on("close", () => clearTimeout(timeout));
    req.on("error", reject);
    req.end(get ? undefined : JSON.stringify(wire.body));
  });
}

export async function forwardToJev(key: unknown, body: unknown) {
  if (typeof key !== "string" || !key.trim()) throw new HttpError(400, "No Jev key");
  const resp = await fetch(JEV_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${key.trim()}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  return { status: resp.status, retryAfter: resp.headers.get("retry-after"), body: await resp.text() };
}

/* ------------------------------------------------------------------ */
/*  The CLI's saved login (this machine only)                          */
/* ------------------------------------------------------------------ */

async function cliModules(repoRoot: string) {
  const dist = (p: string) => pathToFileURL(resolve(repoRoot, p)).href;
  const [config, credentials, sessions, client] = await Promise.all([
    import(dist("packages/wilma-cli/dist/config.js")),
    import(dist("packages/wilma-cli/dist/credentials.js")),
    import(dist("packages/wilma-cli/dist/session-store.js")),
    import(dist("packages/wilma-client/dist/index.js")),
  ]);
  // Sessions this bridge saves are the app's (the sign-in history says who started one).
  sessions.nameSessionOwner?.("home");
  return { config, credentials, sessions, client };
}

/** Same key as the CLI's session pool, so the app and the CLI share one Wilma session. */
function poolKey(profile: { baseUrl: string; username: string; password: string }): string {
  return createHash("sha256")
    .update(`${profile.baseUrl.replace(/\/$/, "")}\n${profile.username.toLowerCase()}\n${profile.password}`)
    .digest("hex");
}

export async function cliAccounts(repoRoot: string) {
  const { config, credentials } = await cliModules(repoRoot);
  const accounts = await credentials.resolveAccounts(await config.loadConfig());
  return (accounts as { profile: { baseUrl: string; username: string; password: string }; stored?: { tenantName?: string; students?: unknown[] } }[]).map(
    (a, index) => ({
      index,
      baseUrl: a.profile.baseUrl,
      username: a.profile.username,
      tenantName: a.stored?.tenantName ?? null,
      students: a.stored?.students ?? [],
      // The shared session's key (not the password), so a page signed in with this login can share its session.
      key: poolKey(a.profile),
    })
  );
}

/**
 * The CLI's saved session for one login (or a new login with its saved
 * password when Wilma has ended it), handed to the page as wilma-client's
 * session state. The password itself never leaves this process.
 */
export async function cliSession(repoRoot: string, index: number) {
  const { config, credentials, sessions, client } = await cliModules(repoRoot);
  const accounts = await credentials.resolveAccounts(await config.loadConfig());
  const account = accounts[index];
  if (!account) throw new HttpError(404, "No such CLI login");
  const profile = { ...account.profile, studentNumber: null };
  const key = poolKey(profile);
  const mfa = credentials.mfaCallbackFor(account.totpSecret);
  const saved: string | null = await sessions.fileSessionStore.load(key);
  const savedInfo: { savedAt: number; by: string | null } | null = saved ? await sessions.sessionInfo?.(key) : null;
  let wilma = saved ? client.WilmaClient.resume(profile, saved, mfa) : null;
  let loggedIn = !wilma;
  wilma ??= await client.WilmaClient.login(profile, mfa);
  wilma.onLogin(() => (loggedIn = true));
  // Reading the children checks the session (and logs in again if Wilma ended it).
  const students = await wilma.students();
  const state: string = wilma.exportSession();
  if (loggedIn) await sessions.fileSessionStore.save(key, state);
  return {
    baseUrl: profile.baseUrl.replace(/\/$/, ""),
    username: profile.username,
    tenantName: account.stored?.tenantName ?? null,
    students,
    state,
    /** The shared session's key (the CLI's), for continuing sessions other WilmAI programs save. */
    key,
    /** A session another program saved, continued (null: this bridge logged in). */
    continued: loggedIn ? null : { savedAt: savedInfo?.savedAt ?? null, by: savedInfo?.by ?? null },
  };
}

const SESSION_KEY = /^[0-9a-f]{64}$/;

/** WilmAI's shared session file (the CLI's), read and written with the CLI's own code. */
export async function sharedSessionGet(repoRoot: string, key: unknown): Promise<{ state: string | null; savedAt: number | null; by: string | null }> {
  if (typeof key !== "string" || !SESSION_KEY.test(key)) throw new HttpError(400, "Not a WilmAI session key");
  const { sessions } = await cliModules(repoRoot);
  const state: string | null = await sessions.fileSessionStore.load(key);
  const info = state ? await sessions.sessionInfo?.(key) : null;
  return { state, savedAt: info?.savedAt ?? null, by: info?.by ?? null };
}

export async function sharedSessionSet(repoRoot: string, key: unknown, state: unknown): Promise<{ ok: true }> {
  if (typeof key !== "string" || !SESSION_KEY.test(key)) throw new HttpError(400, "Not a WilmAI session key");
  if (typeof state !== "string" || state.length > 65536 || !state.includes("Wilma2SID")) throw new HttpError(400, "Not a WilmAI session");
  const { sessions } = await cliModules(repoRoot);
  await sessions.fileSessionStore.save(key, state);
  return { ok: true };
}
