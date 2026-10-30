/*
 * The local bridge: a stateless pipe on 127.0.0.1 for the parts a web page
 * can't do by itself.
 *
 * Wilma and Jev both refuse calls from web pages on other origins (CORS), so
 * a page can't reach them directly. A browser extension can (that's the real
 * packaging, see extension/); in development this bridge plays that role.
 * It forwards one request at a time and keeps nothing: cookies, credentials,
 * the Jev key and every answer live in the browser. Requests go out from this
 * computer, like Wilma in the parent's own browser.
 *
 * Guards: it answers only pages served from this same 127.0.0.1/localhost
 * address (Host and Origin checked, custom header required so other sites
 * can't send "simple" requests), and it forwards only to Wilma hosts from the
 * tenant list and to Jev's one endpoint. It is never an open proxy.
 *
 * Optional extra for this machine: reuse the WilmAI CLI's saved login
 * (/bridge/cli/*), so trying the app doesn't start a second Wilma session.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { HttpError, cliAccounts, cliSession, anthropicReach, forwardToAnthropic, forwardToJev, forwardToOpenAI, forwardToOllama, forwardToWilma, openAIReach, readJson, sharedSessionGet, sharedSessionSet, wilmaHosts, type WireRequest } from "./core.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

function send(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

/** Only this server's own pages may use the bridge. */
function checkCaller(req: IncomingMessage) {
  const host = req.headers.host ?? "";
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) throw new HttpError(403, "Bridge answers local pages only");
  const origin = req.headers.origin;
  if (origin && origin !== `http://${host}`) throw new HttpError(403, "Bridge answers its own pages only");
  if (req.headers["x-wilmai-bridge"] !== "1") throw new HttpError(403, "Missing bridge header");
}

export function bridge(): Plugin {
  const hosts = wilmaHosts();
  const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = (req.url ?? "").split("?")[0];
    if (!path.startsWith("/bridge/")) return next();
    try {
      checkCaller(req);
      if (req.method !== "POST" && req.method !== "GET") throw new HttpError(405, "Method not allowed");
      if (path === "/bridge/wilma" && req.method === "POST") {
        return send(res, 200, await forwardToWilma(hosts, await readJson<WireRequest>(req)));
      }
      if (path === "/bridge/jev" && req.method === "POST") {
        return send(res, 200, await forwardToJev(req.headers["x-jev-key"], await readJson<unknown>(req)));
      }
      if (path === "/bridge/openai" && req.method === "POST") {
        return send(res, 200, await forwardToOpenAI(req.headers["x-openai-key"], req.headers["x-openai-path"], await readJson<unknown>(req)));
      }
      if (path === "/bridge/openai-reach") {
        return send(res, 200, await openAIReach());
      }
      if (path === "/bridge/anthropic" && req.method === "POST") {
        return send(res, 200, await forwardToAnthropic(req.headers["x-anthropic-key"], await readJson<unknown>(req)));
      }
      if (path === "/bridge/anthropic-reach") {
        return send(res, 200, await anthropicReach());
      }
      if (path === "/bridge/ollama" && req.method === "POST") {
        return send(res, 200, await forwardToOllama(await readJson<{ endpoint: string; path: string; body?: unknown }>(req)));
      }
      if (path === "/bridge/cli/accounts" && req.method === "GET") {
        return send(res, 200, { accounts: await cliAccounts(REPO_ROOT).catch(() => []) });
      }
      if (path === "/bridge/cli/session" && req.method === "POST") {
        const { index } = await readJson<{ index: number }>(req);
        return send(res, 200, await cliSession(REPO_ROOT, Number(index) || 0));
      }
      if (path === "/bridge/session/get" && req.method === "POST") {
        const { key } = await readJson<{ key: unknown }>(req);
        return send(res, 200, await sharedSessionGet(REPO_ROOT, key));
      }
      if (path === "/bridge/session/set" && req.method === "POST") {
        const { key, state } = await readJson<{ key: unknown; state: unknown }>(req);
        return send(res, 200, await sharedSessionSet(REPO_ROOT, key, state));
      }
      throw new HttpError(404, "No such bridge route");
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 502;
      const message = err instanceof Error ? err.message : String(err);
      // Method and route only: never bodies, cookies or keys.
      console.error(`[bridge] ${req.method} ${path} -> ${status} ${message}`);
      send(res, status, { error: message, name: err instanceof Error ? err.name : "Error" });
    }
  };
  return {
    name: "wilmai-bridge",
    configureServer(server) {
      server.middlewares.use((req, res, next) => void handle(req, res, next));
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => void handle(req, res, next));
    },
  };
}
