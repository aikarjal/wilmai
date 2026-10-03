// Pressure test for the relay: hostile inputs, forged and replayed tokens,
// concurrency, and Wilma outages. With --live it also runs real tool calls
// through the relay using the login saved by `wilma login` (sealed in-process;
// the password is never printed).
//
//   node test/pressure.mjs [--live]
import assert from "node:assert/strict";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const LIVE = process.argv.includes("--live");
const PORT = 3298;
const BASE = `http://localhost:${PORT}`;
const SECRET = randomBytes(32).toString("hex");
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(["ok", name]);
  } catch (err) {
    results.push(["FAIL", name, err.message]);
  }
};

// Same format as lib/seal.ts, so the test can forge tokens with the real secret.
function seal(kind, payload, secret = SECRET) {
  const key = createHash("sha256").update(`wilmai-relay-v1|${secret}`).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(kind));
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), iv, body, cipher.getAuthTag()]).toString("base64url");
}
const now = () => Math.floor(Date.now() / 1000);

/* ---------------- mock Wilma (can be "taken down") ---------------- */
let wilmaDown = false;
let wilmaDelayMs = 0;
let wilmaRequests = 0;
const wilma = createServer(async (req, res) => {
  wilmaRequests += 1;
  if (wilmaDown) {
    res.writeHead(503);
    return res.end("down");
  }
  if (wilmaDelayMs) await new Promise((r) => setTimeout(r, wilmaDelayMs));
  const send = (status, type, body, headers = {}) => {
    res.writeHead(status, { "Content-Type": type, ...headers });
    res.end(body);
  };
  if (req.method === "GET" && req.url === "/login") return send(200, "text/html", '<input type="hidden" name="SESSIONID" value="s">');
  if (req.method === "POST" && req.url === "/login") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const form = new URLSearchParams(body);
    if (form.get("Password") === "test-password") return send(200, "text/plain", "ok", { "Set-Cookie": "Wilma2SID=c; Path=/" });
    return send(200, "text/html", "<div>loginfailed</div>");
  }
  if (req.url === "/") return send(200, "text/html", '<a href="/!123/">Test Student</a><a href="/!456/">Toinen Oppilas</a>');
  if (/\/overview$/.test(req.url)) return send(200, "application/json", "{}");
  if (/\/news$/.test(req.url)) return send(200, "application/json", "[]");
  if (/\/messages\/list$/.test(req.url)) return send(200, "application/json", '{"Messages": []}');
  send(404, "text/plain", "nope");
});
await new Promise((r) => wilma.listen(0, "127.0.0.1", r));
const wilmaUrl = `http://127.0.0.1:${wilma.address().port}`;

/* ---------------- optional live account ---------------- */
let live = null;
if (LIVE) {
  const { loadConfig } = await import("@wilm-ai/wilma-cli/dist/config.js");
  const { resolveAccount } = await import("@wilm-ai/wilma-cli/dist/credentials.js");
  const account = await resolveAccount(await loadConfig());
  if (!account) throw new Error("--live needs a saved login (wilma login)");
  live = {
    creds: { t: account.profile.baseUrl, n: account.stored?.tenantName ?? null, u: account.profile.username, p: account.profile.password, s: account.totpSecret ?? null },
  };
}

const relay = spawn("pnpm", ["exec", "next", "dev", "--port", String(PORT)], {
  cwd: new URL("..", import.meta.url).pathname,
  env: {
    ...process.env,
    RELAY_SECRET: SECRET,
    RELAY_ALLOWED_USERS: ["test-user", "parent-1", "parent-2", "parent-3", "parent-4", "parent-5", live?.creds.u].filter(Boolean).join(","),
    RELAY_ALLOW_ANY_TENANT: "1",
    RELAY_ORIGIN: BASE,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let relayLog = "";
relay.stdout.on("data", (d) => (relayLog += d));
relay.stderr.on("data", (d) => (relayLog += d));
for (let i = 0; i < 120; i++) {
  try {
    if ((await fetch(`${BASE}/.well-known/oauth-authorization-server`)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}

let replayAccepted = false;
let latency = null;
const mockCreds = { t: wilmaUrl, n: "Mock", u: "test-user", p: "test-password", s: null };
const access = (creds = mockCreds, extra = {}) => seal("access", { cs: [creds], cid: "test", exp: now() + 3600, ...extra });
const mcpRaw = (token, body = { jsonrpc: "2.0", id: 1, method: "tools/list" }, headers = {}) =>
  fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
const callTool = async (token, name, args = {}) => {
  const res = await mcpRaw(token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  return { status: res.status, body: res.status === 200 ? await res.json() : await res.text() };
};
const register = async (redirect_uris, extra = {}) =>
  fetch(`${BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ redirect_uris, ...extra }),
  });
const token = (params) =>
  fetch(`${BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

try {
  const { client_id } = await (await register(["https://claude.ai/api/mcp/auth_callback"])).json();
  const challenge = createHash("sha256").update("v".repeat(43)).digest("base64url");
  const authorize = (params) => {
    const url = new URL(`${BASE}/authorize`);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id,
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
      code_challenge: challenge,
      code_challenge_method: "S256",
      ...params,
    }).toString();
    return fetch(url, { redirect: "manual" });
  };

  /* ---------------- registration ---------------- */
  await check("DCR rejects javascript:, data:, plain-http and fragment redirect URIs", async () => {
    for (const uri of ["javascript:alert(1)", "data:text/html,x", "http://example.com/cb", "https://ok.example/cb#frag"]) {
      assert.equal((await register([uri])).status, 400, uri);
    }
  });
  await check("DCR refuses redirect hosts other than Claude, ChatGPT and loopback", async () => {
    assert.equal((await register(["https://evil.example/cb"])).status, 400);
    assert.equal((await register(["https://claude.ai.evil.example/cb"])).status, 400);
    assert.equal((await register(["https://chatgpt.com/connector_platform_oauth_redirect"])).status, 201);
  });
  await check("Login page names the connecting app and can't be injected through its name", async () => {
    const evil = await (await register(["https://claude.ai/api/mcp/auth_callback"], { client_name: '</script><h1>Fake login</h1>' })).json();
    const url = new URL(`${BASE}/authorize`);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: evil.client_id,
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
      code_challenge: createHash("sha256").update("v".repeat(43)).digest("base64url"),
      code_challenge_method: "S256",
    }).toString();
    const html = await (await fetch(url)).text();
    assert.equal((html.match(/<script/g) || []).length, 1, "no injected script tags");
    assert.ok(!html.includes("<h1>Fake login</h1>"), "no injected markup");
    assert.match(html, /Connecting WilmAI to/);
    assert.match(html, /claude\.ai/);
  });
  await check("DCR allows loopback http (desktop clients)", async () => {
    assert.equal((await register(["http://127.0.0.1:33418/callback"])).status, 201);
  });
  await check("DCR rejects more than 10 redirect URIs and non-JSON bodies", async () => {
    assert.equal((await register(Array.from({ length: 11 }, (_, i) => `https://x.example/${i}`))).status, 400);
    const res = await fetch(`${BASE}/register`, { method: "POST", body: "not json" });
    assert.equal(res.status, 400);
  });
  await check("A forged client_id (sealed with another secret) is unknown", async () => {
    const forged = seal("client", { r: ["https://attacker.example/cb"] }, "x".repeat(64));
    const res = await authorize({ client_id: forged, redirect_uri: "https://attacker.example/cb" });
    assert.equal(res.status, 400);
  });

  /* ---------------- authorization ---------------- */
  await check("PKCE plain / missing challenge is refused (error goes back to client)", async () => {
    const plain = await authorize({ code_challenge_method: "plain" });
    assert.equal(plain.status, 302);
    assert.match(plain.headers.get("location"), /error=invalid_request/);
    const missing = await authorize({ code_challenge: "" });
    assert.match(missing.headers.get("location"), /error=invalid_request/);
  });
  await check("Unknown resource is refused", async () => {
    const res = await authorize({ resource: "https://evil.example/mcp" });
    assert.match(res.headers.get("location"), /error=invalid_target/);
  });
  await check("state is never reflected into the login page (no XSS)", async () => {
    const res = await authorize({ state: '"><script>alert(1)</script>' });
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.ok(!html.includes("<script>alert(1)"));
    assert.match(res.headers.get("content-security-policy"), /script-src 'nonce-/);
  });
  const page = await (await authorize({ state: "s1" })).text();
  const extra = JSON.parse(/const EXTRA = (\{.*?\});/.exec(page)[1]);
  const login = (body, headers = { Origin: BASE, "Content-Type": "application/json" }) =>
    fetch(`${BASE}/authorize/login`, { method: "POST", headers, body: JSON.stringify({ ...extra, tenantUrl: wilmaUrl, ...body }) });

  await check("Login API refuses cross-site posts and form posts", async () => {
    assert.equal((await login({ username: "test-user", password: "test-password" }, { Origin: "https://evil.example", "Content-Type": "application/json" })).status, 403);
    assert.equal((await login({ username: "test-user", password: "test-password" }, { "Content-Type": "application/json" })).status, 403);
    assert.equal((await login({ username: "test-user", password: "test-password" }, { Origin: BASE, "Content-Type": "text/plain" })).status, 403);
  });
  await check("Allowlist is checked before contacting Wilma", async () => {
    const before = wilmaRequests;
    const body = await (await login({ username: "intruder", password: "x" })).json();
    assert.equal(body.code, "not_allowed");
    assert.equal(wilmaRequests, before, "no Wilma request for non-allowlisted users");
  });
  await check("Allowlist matching ignores case and spaces", async () => {
    const body = await (await login({ username: "  Test-User ", password: "test-password" })).json();
    assert.equal(body.status, "ok");
  });
  await check("A login request blob from another secret is refused", async () => {
    const forged = seal("req", { cid: client_id, ru: "https://attacker.example/cb", cc: challenge, exp: now() + 600 }, "y".repeat(64));
    const res = await login({ request: forged, username: "test-user", password: "test-password" });
    assert.equal(res.status, 400);
  });
  await check("Login page reports Wilma being down without leaking details", async () => {
    wilmaDown = true;
    const body = await (await login({ username: "test-user", password: "test-password" })).json();
    wilmaDown = false;
    assert.equal(body.status, "error");
    assert.ok(!/test-password/.test(JSON.stringify(body)));
  });

  /* ---------------- tokens ---------------- */
  const ok = await (await login({ username: "test-user", password: "test-password" })).json();
  const finish = (body, headers = { Origin: BASE, "Content-Type": "application/json" }) =>
    fetch(`${BASE}/authorize/done`, { method: "POST", headers, body: JSON.stringify({ ...extra, ...body }) });
  await check("Continue refuses cross-site posts and pending blobs from another request", async () => {
    assert.equal((await finish({ pending: ok.pending }, { Origin: "https://evil.example", "Content-Type": "application/json" })).status, 403);
    const otherPending = seal("pending", { cs: [mockCreds], ac: [], cid: "other-client", ru: "https://attacker.example/cb", exp: now() + 600 });
    assert.equal((await finish({ pending: otherPending })).status, 400);
    assert.equal((await finish({})).status, 400);
  });
  await check("At most 5 Wilma logins per connection", async () => {
    let pending = ok.pending;
    for (let i = 1; i <= 4; i++) {
      const r = await (await login({ pending, username: `parent-${i}`, password: "test-password" })).json();
      assert.equal(r.status, "ok");
      pending = r.pending;
    }
    const sixth = await (await login({ pending, username: "parent-5", password: "test-password" })).json();
    assert.equal(sixth.status, "error");
  });
  const done = await (await finish({ pending: ok.pending })).json();
  const code = new URL(done.redirect).searchParams.get("code");
  await check("Code is bound to redirect_uri, client and verifier", async () => {
    assert.equal((await token({ grant_type: "authorization_code", code, redirect_uri: "https://other.example/cb", code_verifier: "v".repeat(43) })).body.error, "invalid_grant");
    assert.equal((await token({ grant_type: "authorization_code", code, client_id: "someone-else", redirect_uri: "https://claude.ai/api/mcp/auth_callback", code_verifier: "v".repeat(43) })).body.error, "invalid_grant");
    assert.equal((await token({ grant_type: "authorization_code", code, redirect_uri: "https://claude.ai/api/mcp/auth_callback", code_verifier: "w".repeat(43) })).body.error, "invalid_grant");
  });
  await check("Code exchange works (and records whether a replay is accepted)", async () => {
    const first = await token({ grant_type: "authorization_code", code, redirect_uri: "https://claude.ai/api/mcp/auth_callback", code_verifier: "v".repeat(43) });
    assert.equal(first.status, 200);
    const second = await token({ grant_type: "authorization_code", code, redirect_uri: "https://claude.ai/api/mcp/auth_callback", code_verifier: "v".repeat(43) });
    replayAccepted = second.status === 200;
  });
  await check("Expired, wrong-kind, foreign-secret and truncated tokens get 401", async () => {
    const cases = {
      expired: access(mockCreds, { exp: now() - 1 }),
      refreshAsAccess: seal("refresh", { cs: [mockCreds], cid: "test", exp: now() + 3600 }),
      codeAsAccess: seal("code", { cs: [mockCreds], cid: "test", ru: "x", cc: "x", exp: now() + 60 }),
      foreignSecret: seal("access", { cs: [mockCreds], cid: "test", exp: now() + 3600 }, "z".repeat(64)),
      truncated: access().slice(0, 40),
      garbage: "a".repeat(9000),
    };
    for (const [name, tok] of Object.entries(cases)) {
      const res = await mcpRaw(tok);
      assert.equal(res.status, 401, name);
      assert.match(res.headers.get("www-authenticate") ?? "", /invalid_token/, name);
    }
  });
  await check("A token for a user removed from the allowlist stops working", async () => {
    const res = await mcpRaw(access({ ...mockCreds, u: "removed-user" }));
    assert.equal(res.status, 401);
  });
  await check("Refresh cannot be exchanged by a different client", async () => {
    const refresh = seal("refresh", { cs: [mockCreds], cid: "client-a", exp: now() + 3600 });
    assert.equal((await token({ grant_type: "refresh_token", refresh_token: refresh, client_id: "client-b" })).body.error, "invalid_grant");
    assert.equal((await token({ grant_type: "client_credentials" })).body.error, "unsupported_grant_type");
  });

  await check("redirect_uri at /token is optional only if /authorize omitted it", async () => {
    const single = await (await register(["https://claude.ai/api/mcp/auth_callback"])).json();
    const verifier = "q".repeat(43);
    const cc = createHash("sha256").update(verifier).digest("base64url");
    const codeFor = async (withRedirect) => {
      const url = new URL(`${BASE}/authorize`);
      const params = { response_type: "code", client_id: single.client_id, code_challenge: cc, code_challenge_method: "S256" };
      if (withRedirect) params.redirect_uri = "https://claude.ai/api/mcp/auth_callback";
      url.search = new URLSearchParams(params).toString();
      const pageHtml = await (await fetch(url)).text();
      const req = JSON.parse(/const EXTRA = (\{.*?\});/.exec(pageHtml)[1]);
      const ok1 = await (await fetch(`${BASE}/authorize/login`, { method: "POST", headers: { Origin: BASE, "Content-Type": "application/json" }, body: JSON.stringify({ ...req, tenantUrl: wilmaUrl, username: "test-user", password: "test-password" }) })).json();
      const done1 = await (await fetch(`${BASE}/authorize/done`, { method: "POST", headers: { Origin: BASE, "Content-Type": "application/json" }, body: JSON.stringify({ ...req, pending: ok1.pending }) })).json();
      return new URL(done1.redirect).searchParams.get("code");
    };
    const omitted = await token({ grant_type: "authorization_code", code: await codeFor(false), code_verifier: verifier });
    assert.equal(omitted.status, 200);
    const required = await token({ grant_type: "authorization_code", code: await codeFor(true), code_verifier: verifier });
    assert.equal(required.body.error, "invalid_grant");
  });

  /* ---------------- MCP behaviour ---------------- */
  await check("GET/DELETE /mcp are 405; OPTIONS preflight is 204", async () => {
    assert.equal((await fetch(`${BASE}/mcp`)).status, 405);
    assert.equal((await fetch(`${BASE}/mcp`, { method: "DELETE" })).status, 405);
    assert.equal((await fetch(`${BASE}/token`, { method: "OPTIONS" })).status, 204);
  });
  await check("Tool list matches the local server minus local-only tools", async () => {
    const res = await mcpRaw(access());
    const names = (await res.json()).result.tools.map((t) => t.name);
    assert.ok(names.includes("wilma_summary") && names.includes("wilma_account"));
    assert.ok(!names.includes("wilma_login") && !names.includes("wilma_find_school"));
    const attachment = (await (await mcpRaw(access())).json()).result.tools.find((t) => t.name === "wilma_get_news_attachment");
    assert.ok(!("save" in attachment.inputSchema.properties), "no save-to-disk on the relay");
  });
  await check("Wilma outage becomes a tool error, not a 500", async () => {
    wilmaDown = true;
    const r = await callTool(access(), "wilma_summary");
    wilmaDown = false;
    assert.equal(r.status, 200);
    assert.equal(r.body.result.isError, true);
  });
  await check("Wrong password in a token becomes a reconnect message", async () => {
    const r = await callTool(access({ ...mockCreds, p: "changed" }), "wilma_summary");
    assert.equal(r.body.result.isError, true);
    assert.match(r.body.result.content[0].text, /reconnect/i);
  });
  await check("30 concurrent tool calls all succeed", async () => {
    wilmaDelayMs = 50;
    const tok = access();
    const started = Date.now();
    const times = await Promise.all(
      Array.from({ length: 30 }, async () => {
        const t0 = Date.now();
        const r = await callTool(tok, "wilma_summary");
        assert.equal(r.status, 200);
        assert.ok(!r.body.result.isError, JSON.stringify(r.body.result));
        return Date.now() - t0;
      })
    );
    wilmaDelayMs = 0;
    times.sort((a, b) => a - b);
    latency = { total: Date.now() - started, p50: times[15], p95: times[28] };
  });
  await check("Access token size stays well under header limits", async () => {
    assert.ok(access().length < 2048, `token is ${access().length} chars`);
  });

  // Last, because it uses up this test's failed-attempt budget.
  await check("Password guessing is cut off after 5 failures", async () => {
    let last;
    for (let i = 0; i < 6; i++) last = await login({ username: "test-user", password: `guess-${i}` });
    assert.equal(last.status, 429);
    assert.equal((await last.json()).code, "too_many_attempts");
  });

  /* ---------------- live Wilma through the relay ---------------- */
  if (live) {
    await check("LIVE: summary, schedule, news and attachment through the relay", async () => {
      const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${access(live.creds)}` } },
      });
      const client = new Client({ name: "pressure-live", version: "0" });
      await client.connect(transport);
      const t0 = Date.now();
      const summary = await client.callTool({ name: "wilma_summary", arguments: {} });
      assert.ok(!summary.isError, summary.content?.[0]?.text);
      const students = JSON.parse(summary.content[0].text).students;
      assert.ok(students.length >= 1);
      const schedule = await client.callTool({ name: "wilma_schedule", arguments: { when: "tomorrow" } });
      assert.ok(!schedule.isError);
      const news = JSON.parse((await client.callTool({ name: "wilma_list_news", arguments: { limit: 5 } })).content[0].text);
      const firstNews = news.students.flatMap((s) => s.news.map((n) => ({ id: n.wilmaId, student: s.student.name })))[0];
      if (firstNews) {
        const item = await client.callTool({ name: "wilma_read_news", arguments: { id: firstNews.id, student: firstNews.student } });
        assert.ok(!item.isError, item.content?.[0]?.text);
      }
      live.summaryMs = Date.now() - t0;
      live.students = students.length;
      await client.close();
    });
  }
} finally {
  relay.kill("SIGTERM");
  wilma.close();
}

for (const [status, name, err] of results) console.log(`${status === "ok" ? "✔" : "✘"} ${name}${err ? ` — ${err}` : ""}`);
console.log(`\nCode replay on the same instance accepted: ${replayAccepted ? "yes" : "no"}`);
if (latency) console.log(`30 concurrent summaries (mock Wilma +50ms): total ${latency.total} ms, p50 ${latency.p50} ms, p95 ${latency.p95} ms`);
if (live?.summaryMs) console.log(`Live: ${live.students} children, summary+schedule+news via relay in ${live.summaryMs} ms`);
const failed = results.filter((r) => r[0] !== "ok");
if (failed.length) {
  console.log(relayLog.split("\n").filter((l) => /⨯|Error/.test(l)).slice(-10).join("\n"));
  process.exit(1);
}
