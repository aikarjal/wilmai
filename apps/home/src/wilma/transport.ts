/*
 * How the app reaches Wilma. A web page can't call Wilma directly (no CORS),
 * so requests go through a pipe that sends one request and keeps nothing.
 * It follows no redirects and keeps no cookies: wilma-client does that, with
 * this pipe as its transport.
 *
 * - desktop app (Tauri): native commands, wilma_send, jev_call,
 *   openai_call and anthropic_call (src-tauri/src/lib.rs);
 * - development in a browser: the local 127.0.0.1 bridge in the Vite dev
 *   server (bridge/bridge.ts), which can also borrow the WilmAI CLI's login.
 */
import { invoke } from "@tauri-apps/api/core";
import type { SharedSession, WilmaTransport } from "@wilma-client/src/core";
import { t } from "../i18n";

export interface WireRequest {
  url: string;
  method: "GET" | "POST";
  body?: string;
  contentType?: string;
  cookie?: string;
  /** Only Accept and X-Requested-With pass (an invitation sign-up sends them as Wilma's own page does). */
  headers?: Record<string, string>;
}

export interface WireResponse {
  status: number;
  /** The URL that answered (after redirects when the transport follows them). */
  url: string;
  /** Redirect target, when the transport doesn't follow redirects itself. */
  location: string | null;
  setCookie: string[];
  contentType: string;
  body: string;
}

export class BridgeError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "BridgeError";
  }
}

interface DesktopBridge {
  wilma(wire: WireRequest): Promise<unknown>;
  sessionGet(key: string): Promise<unknown>;
  sessionSet(key: string, state: string): Promise<unknown>;
  jev(key: string | undefined, body: unknown): Promise<unknown>;
  openai(key: string | undefined, path: string | undefined, body: unknown): Promise<unknown>;
  openaiReach(): Promise<unknown>;
  anthropic(key: string | undefined, body: unknown): Promise<unknown>;
  anthropicReach(): Promise<unknown>;
  ollama(wire: unknown): Promise<unknown>;
  cliAccounts(): Promise<unknown>;
  cliSession(index: number): Promise<unknown>;
  cliSecret(id: string): Promise<unknown>;
}

/** Errors from the native side come back as { error } like the bridge's. */
async function native(command: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    return await invoke(command, args);
  } catch (err) {
    return { error: typeof err === "string" ? err : err instanceof Error ? err.message : String(err), status: 502 };
  }
}

export const isDesktopApp = "__TAURI_INTERNALS__" in globalThis;
/** The desktop app on Windows, where it goes on in the notification area by the clock rather than the menu bar. */
export const onWindows = isDesktopApp && /Windows/.test(globalThis.navigator?.userAgent ?? "");
let reportWrites: Promise<unknown> = Promise.resolve();

/** Write one of the experiment's reports to the app's data folder (desktop app); returns where. */
export async function saveReport(name: "luna-compare.md" | "luna-compare.json" | "luna-material.json", text: string): Promise<string | null> {
  if (!isDesktopApp) return null;
  const write = reportWrites.then(() => invoke<string>("save_report", { name, text }));
  reportWrites = write.catch(() => null);
  return write;
}

/** The reset also removes the local experiment's copies of the family's data. */
export async function clearReports(): Promise<void> {
  if (!isDesktopApp) return;
  await reportWrites;
  await invoke("clear_reports");
}

/**
 * Where earlier versions of the desktop app kept the Jev key (the system
 * keychain): read once, to move the key into the app's own storage.
 */
export const oldKeychain = isDesktopApp ? { get: (name: "jev-key") => invoke<string | null>("secret_get", { name }) } : null;
/**
 * Where the app keeps things: "on this computer" (desktop app) or "in this browser".
 * For whole sentences, choose the sentence by isDesktopApp instead: word order differs in Finnish.
 */
export const here = (): string => (isDesktopApp ? t("on this computer") : t("in this browser"));

const desktop: DesktopBridge | undefined = isDesktopApp
  ? {
      wilma: (wire) => native("wilma_send", { wire }),
      // { state, savedAt, by } or null; errors as { error }.
      sessionGet: async (key) => (await native("shared_session_get", { key })) ?? { state: null },
      sessionSet: async (key, state) => (await native("shared_session_set", { key, state })) ?? { ok: true },
      jev: (key, body) => native("jev_call", { key: key ?? "", body }),
      openai: (key, path, body) => native("openai_call", { key: key ?? "", path: path ?? "", body }),
      openaiReach: () => native("openai_reach", {}),
      anthropic: (key, body) => native("anthropic_call", { key: key ?? "", body }),
      anthropicReach: () => native("anthropic_reach", {}),
      ollama: (wire) => native("ollama_call", { wire }),
      // The CLI's saved logins on this computer (no secrets), for "Continue as".
      cliAccounts: async () => {
        const logins = await native("cli_logins", {});
        return { accounts: Array.isArray(logins) ? logins.map((login, index) => ({ index, ...login })) : [] };
      },
      // The browser setup's bridge signs in itself; the app signs in with cliSecret instead.
      cliSession: async () => ({ error: "Not in the desktop app", status: 404 }),
      cliSecret: (id) => native("cli_login_secret", { id }),
    }
  : undefined;

async function desktopCall(d: DesktopBridge, path: string, init: { body?: unknown; headers?: Record<string, string> }): Promise<unknown> {
  switch (path) {
    case "wilma":
      return d.wilma(init.body as WireRequest);
    case "session/get":
      return d.sessionGet((init.body as { key: string }).key);
    case "session/set":
      return d.sessionSet((init.body as { key: string }).key, (init.body as { state: string }).state);
    case "jev":
      return d.jev(init.headers?.["x-jev-key"], init.body);
    case "openai":
      return d.openai(init.headers?.["x-openai-key"], init.headers?.["x-openai-path"], init.body);
    case "openai-reach":
      return d.openaiReach();
    case "anthropic":
      return d.anthropic(init.headers?.["x-anthropic-key"], init.body);
    case "anthropic-reach":
      return d.anthropicReach();
    case "ollama":
      return d.ollama(init.body);
    case "cli/accounts":
      return d.cliAccounts();
    case "cli/session":
      return d.cliSession(Number((init.body as { index?: number } | undefined)?.index) || 0);
    case "cli/secret":
      return d.cliSecret(String((init.body as { id?: string } | undefined)?.id ?? ""));
    default:
      return { error: "No such route", status: 404 };
  }
}

type BridgeOverride = (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> }) => Promise<unknown>;
let bridgeOverride: BridgeOverride | null = null;

/** The eval suite (Node, evals/run.ts) answers bridge calls itself: OpenAI and Jev straight, no app, no dev bridge. */
export function overrideBridge(fn: BridgeOverride | null): void {
  bridgeOverride = fn;
}

export async function bridgeCall<T>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  if (bridgeOverride) {
    const result = (await bridgeOverride(path, init)) as T & { error?: string; status?: number };
    if (result && typeof result === "object" && "error" in result && result.error) throw new BridgeError(result.error, result.status ?? 502);
    return result;
  }
  if (desktop) {
    const result = (await desktopCall(desktop, path, init)) as T & { error?: string; status?: number };
    if (result && typeof result === "object" && "error" in result && result.error) throw new BridgeError(result.error, result.status ?? 502);
    return result;
  }
  let resp: Response;
  try {
    resp = await fetch(`/bridge/${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: { "x-wilmai-bridge": "1", "content-type": "application/json", ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new BridgeError(t("The local bridge isn't running. Start it with `pnpm dev`."), 0);
  }
  const data = (await resp.json().catch(() => ({}))) as T & { error?: string };
  if (!resp.ok) throw new BridgeError(data.error ?? t("Bridge answered {status}", { status: resp.status }), resp.status);
  return data;
}

/** One login's entry in the shared session file: the state, when it was saved, and by which program ("home", "cli", "mcp"; null when it doesn't say). */
export interface SharedEntry {
  state: string;
  savedAt: number | null;
  by: string | null;
}

/**
 * WilmAI's shared session for one login: the CLI's session file, which the
 * CLI, assistants' connectors and this app all use, so they continue one Wilma
 * session instead of ending each other's. `key` is the CLI's key for the login.
 * `entry()` also says who saved it; `last` is the entry the client last loaded.
 */
export function sharedSessionFor(key: string): SharedSession & { entry(): Promise<SharedEntry | null>; last: SharedEntry | null } {
  const test = key.startsWith(TEST_KEY);
  const shared = {
    last: null as SharedEntry | null,
    entry: async (): Promise<SharedEntry | null> => {
      if (test) return testShared.has(key) ? { state: testShared.get(key)!, savedAt: null, by: "home" } : null;
      const found = await bridgeCall<{ state: string | null; savedAt?: number | null; by?: string | null } | null>("session/get", { body: { key } });
      return found?.state ? { state: found.state, savedAt: found.savedAt ?? null, by: found.by ?? null } : null;
    },
    load: async () => {
      shared.last = await shared.entry();
      return shared.last?.state ?? null;
    },
    save: async (state: string) => {
      if (test) testShared.set(key, state);
      else await bridgeCall("session/set", { body: { key, state } });
    },
  };
  return shared;
}

/** The development server's test Wilmas (demo/test-wilma.ts): answered in memory, their sessions kept out of the shared file. */
const isTestWilma = (url: string) => typeof __TEST_WILMAS__ !== "undefined" && __TEST_WILMAS__ && /^https:\/\/[^/]+\.wilmai\.test(\/|$)/i.test(url);
const TEST_KEY = "test:";
const testShared = new Map<string, string>();

/** One saved login's password and authenticator key, read when the parent clicks "Continue as" (desktop app). */
export function savedLoginSecret(id: string): Promise<{ password: string; totpSecret: string | null }> {
  return bridgeCall("cli/secret", { body: { id } });
}

/** The CLI's key for a login (SHA-256 hex of the Wilma address, the lower-case username and the password). */
export async function sharedKeyFor(baseUrl: string, username: string, password: string): Promise<string> {
  const text = `${baseUrl.replace(/\/$/, "")}\n${username.toLowerCase()}\n${password}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const key = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return isTestWilma(baseUrl) ? TEST_KEY + key : key;
}

/** wilma-client's transport: one exchange through the native command or the bridge. */
export const wilmaTransport: WilmaTransport = async (req) => {
  // Written out, so a release build drops the test Wilmas whole.
  if (typeof __TEST_WILMAS__ !== "undefined" && __TEST_WILMAS__ && isTestWilma(req.url)) return (await import("../demo/test-wilma")).testWilma(req);
  const extra = Object.fromEntries(
    Object.entries(req.headers).filter(([name]) => name === "accept" || name === "x-requested-with")
  );
  const wire: WireRequest = {
    url: req.url,
    method: req.method === "POST" ? "POST" : "GET",
    body: req.body,
    contentType: req.headers["content-type"],
    cookie: req.headers["cookie"],
    headers: Object.keys(extra).length ? extra : undefined,
  };
  const call = bridgeCall<WireResponse>("wilma", { body: wire });
  // The pipe can't be cancelled; stop waiting when the client gives up.
  const answer = req.signal
    ? await Promise.race([
        call,
        new Promise<never>((_, reject) => {
          if (req.signal!.aborted) reject(req.signal!.reason);
          req.signal!.addEventListener("abort", () => reject(req.signal!.reason), { once: true });
        }),
      ])
    : await call;
  const headers = new Headers();
  if (answer.contentType) headers.set("content-type", answer.contentType);
  if (answer.location) headers.set("location", answer.location);
  // Node (the tests) has no Vite env.
  if (import.meta.env?.DEV) logExchange(wire, answer);
  return { status: answer.status, headers, setCookies: answer.setCookie, body: answer.body };
};

/**
 * Development builds only: each exchange in the console, for checking a write
 * against the real Wilma. Paths, statuses and, for a POST, the form fields;
 * never cookies or the form key.
 */
function logExchange(wire: WireRequest, answer: WireResponse) {
  const path = (url: string) => {
    try {
      const u = new URL(url, wire.url);
      return u.pathname + u.search;
    } catch {
      return url;
    }
  };
  const to = answer.location ? ` → ${path(answer.location)}` : "";
  if (wire.method !== "POST") {
    console.info(`[wilma] GET ${path(wire.url)} ${answer.status}${to}`);
    return;
  }
  const fields = [...new URLSearchParams(wire.body ?? "")].map(([k, v]) => [k, /formkey|secret|password|token|payload|sessionid/i.test(k) ? "(hidden)" : v]);
  console.info(`[wilma] POST ${path(wire.url)} ${answer.status}${to}`, JSON.stringify(fields), wire.headers ? JSON.stringify(wire.headers) : "");
}
