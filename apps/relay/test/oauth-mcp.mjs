// End-to-end test of the relay: OAuth discovery, dynamic client registration,
// the Wilma login page, PKCE token exchange, refresh, and MCP calls with the
// bearer token — against a mock Wilma. Starts `next dev` itself.
//
//   pnpm --filter @wilm-ai/relay test
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = 3299;
const BASE = `http://localhost:${PORT}`;

const wilma = createServer(async (req, res) => {
  const send = (status, type, body, headers = {}) => {
    res.writeHead(status, { "Content-Type": type, ...headers });
    res.end(body);
  };
  if (req.method === "GET" && req.url === "/login") return send(200, "text/html", '<input type="hidden" name="SESSIONID" value="s">');
  if (req.method === "POST" && req.url === "/login") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const form = new URLSearchParams(body);
    if (form.get("Login") === "test-user" && form.get("Password") === "test-password") {
      return send(200, "text/plain", "ok", { "Set-Cookie": "Wilma2SID=c; Path=/; HttpOnly" });
    }
    return send(200, "text/html", "<div>loginfailed</div>");
  }
  if (req.url === "/") return send(200, "text/html", '<a href="/!123/">Test Student</a>');
  if (req.url === "/!123/overview") return send(200, "application/json", "{}");
  if (req.url === "/!123/news") return send(200, "application/json", "[]");
  if (req.url === "/!123/messages/list") return send(200, "application/json", '{"Messages": []}');
  send(404, "text/plain", "nope");
});
await new Promise((r) => wilma.listen(0, "127.0.0.1", r));
const wilmaUrl = `http://127.0.0.1:${wilma.address().port}`;

// A second school's Wilma, for a family with children on two Wilmas.
const wilma2 = createServer(async (req, res) => {
  const send = (status, type, body, headers = {}) => {
    res.writeHead(status, { "Content-Type": type, ...headers });
    res.end(body);
  };
  if (req.method === "GET" && req.url === "/login") return send(200, "text/html", '<input type="hidden" name="SESSIONID" value="s">');
  if (req.method === "POST" && req.url === "/login") return send(200, "text/plain", "ok", { "Set-Cookie": "Wilma2SID=c; Path=/; HttpOnly" });
  if (req.url === "/") return send(200, "text/html", '<a href="/!789/">Eino Kolmas</a>');
  if (req.url === "/!789/overview") return send(200, "application/json", "{}");
  if (req.url === "/!789/news") return send(200, "application/json", "[]");
  if (req.url === "/!789/messages/list") return send(200, "application/json", '{"Messages": []}');
  send(404, "text/plain", "nope");
});
await new Promise((r) => wilma2.listen(0, "127.0.0.1", r));
const wilma2Url = `http://127.0.0.1:${wilma2.address().port}`;

const relay = spawn("pnpm", ["exec", "next", "dev", "--port", String(PORT)], {
  cwd: new URL("..", import.meta.url).pathname,
  env: {
    ...process.env,
    RELAY_SECRET: randomBytes(32).toString("hex"),
    RELAY_ALLOWED_USERS: "test-user,second-parent",
    RELAY_ALLOW_ANY_TENANT: "1",
    RELAY_ORIGIN: BASE,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let relayLog = "";
relay.stdout.on("data", (d) => (relayLog += d));
relay.stderr.on("data", (d) => (relayLog += d));

async function waitForRelay() {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${BASE}/.well-known/oauth-authorization-server`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`relay did not start:\n${relayLog}`);
}

try {
  await waitForRelay();

  // Unauthenticated MCP call points at the resource metadata.
  const anon = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(anon.status, 401);
  assert.match(anon.headers.get("www-authenticate") ?? "", /resource_metadata="http:\/\/localhost:3299\/\.well-known\/oauth-protected-resource\/mcp"/);

  const prm = await (await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`)).json();
  assert.equal(prm.resource, `${BASE}/mcp`);
  const asm = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
  assert.deepEqual(asm.code_challenge_methods_supported, ["S256"]);

  // Dynamic client registration.
  const redirectUri = "https://claude.ai/api/mcp/auth_callback";
  const reg = await fetch(asm.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ redirect_uris: [redirectUri], client_name: "Test client" }),
  });
  assert.equal(reg.status, 201);
  const { client_id } = await reg.json();
  const badReg = await fetch(asm.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ redirect_uris: ["http://evil.example/cb"] }),
  });
  assert.equal(badReg.status, 400);

  // Authorization request -> login page.
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authUrl = new URL(asm.authorization_endpoint);
  authUrl.search = new URLSearchParams({
    response_type: "code",
    client_id,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "xyz",
    resource: `${BASE}/mcp`,
  }).toString();
  const page = await fetch(authUrl, { redirect: "manual" });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Log in to Wilma/);
  assert.match(html, /stores nothing/);
  const extra = JSON.parse(/const EXTRA = (\{.*?\});/.exec(html)[1]);

  // A redirect URI that wasn't registered is refused without redirecting.
  const wrongRedirect = new URL(authUrl);
  wrongRedirect.searchParams.set("redirect_uri", "https://attacker.example/cb");
  assert.equal((await fetch(wrongRedirect, { redirect: "manual" })).status, 400);

  // Desktop/CLI clients (Claude Code) register a loopback callback without a port
  // and use a random port at runtime; that must match (RFC 8252 §7.3).
  const loopback = await (await fetch(asm.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ redirect_uris: ["http://localhost/callback"] }),
  })).json();
  const loopbackAuth = new URL(authUrl);
  loopbackAuth.searchParams.set("client_id", loopback.client_id);
  loopbackAuth.searchParams.set("redirect_uri", "http://localhost:54321/callback");
  assert.equal((await fetch(loopbackAuth, { redirect: "manual" })).status, 200);
  loopbackAuth.searchParams.set("redirect_uri", "http://localhost:54321/other");
  assert.equal((await fetch(loopbackAuth, { redirect: "manual" })).status, 400, "path must still match");
  loopbackAuth.searchParams.set("redirect_uri", "http://127.0.0.1:54321/callback");
  assert.equal((await fetch(loopbackAuth, { redirect: "manual" })).status, 400, "host must still match");

  const tenants = await (await fetch(`${BASE}/authorize/tenants?q=helsinki`)).json();
  assert.equal(tenants.tenants[0].url, "https://helsinki.inschool.fi");

  const login = (body, headers = {}) =>
    fetch(`${BASE}/authorize/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: BASE, ...headers },
      body: JSON.stringify({ ...extra, tenantUrl: wilmaUrl, tenantName: "Test", ...body }),
    }).then((r) => r.json());

  assert.equal((await login({ username: "someone-else", password: "x" })).code, "not_allowed");
  assert.equal((await login({ username: "test-user", password: "wrong" })).code, "bad_credentials");
  assert.equal((await login({ username: "test-user", password: "test-password", totpSecret: "123456" })).code, "bad_totp");
  const ok = await login({ username: "test-user", password: "test-password" });
  assert.equal(ok.status, "ok");
  assert.ok(ok.pending, "logins so far come back sealed");
  assert.ok(!ok.pending.includes("test-password"));

  // Add another Wilma on the same page, then Continue.
  const added = await login({ pending: ok.pending, tenantUrl: wilma2Url, tenantName: "Second", username: "second-parent", password: "pw" });
  assert.equal(added.status, "ok");
  assert.deepEqual(added.accounts.map((a) => a.students), [["Test Student"], ["Eino Kolmas"]]);
  const done = await fetch(`${BASE}/authorize/done`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ ...extra, pending: added.pending }),
  }).then((r) => r.json());
  assert.equal(done.status, "ok");
  const callback = new URL(done.redirect);
  assert.equal(callback.origin + callback.pathname, redirectUri);
  assert.equal(callback.searchParams.get("state"), "xyz");
  const code = callback.searchParams.get("code");
  assert.ok(!code.includes("test-password"), "code is sealed");

  // Token exchange: wrong verifier fails, right one succeeds.
  const token = (params) =>
    fetch(asm.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const bad = await token({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id, code_verifier: "x".repeat(43) });
  assert.equal(bad.body.error, "invalid_grant");
  const tokens = await token({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id, code_verifier: verifier });
  assert.equal(tokens.status, 200);
  assert.equal(tokens.body.token_type, "Bearer");

  const refreshed = await token({ grant_type: "refresh_token", refresh_token: tokens.body.refresh_token, client_id });
  assert.equal(refreshed.status, 200);
  // An access token is not accepted as a refresh token.
  assert.equal((await token({ grant_type: "refresh_token", refresh_token: tokens.body.access_token })).body.error, "invalid_grant");

  // MCP with the bearer token.
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${refreshed.body.access_token}` } },
  });
  const client = new Client({ name: "relay-test", version: "0" });
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.ok(tools.some((t) => t.name === "wilma_summary"));
  assert.ok(!tools.some((t) => t.name === "wilma_login"), "no local login tool on the relay");
  const summary = await client.callTool({ name: "wilma_summary", arguments: {} });
  assert.ok(!summary.isError, JSON.stringify(summary));
  assert.deepEqual(JSON.parse(summary.content[0].text).students.map((s) => s.student.name), ["Test Student", "Eino Kolmas"]);
  const account = JSON.parse((await client.callTool({ name: "wilma_account", arguments: {} })).content[0].text);
  assert.deepEqual(account.wilmas.map((w) => w.username), ["test-user", "second-parent"]);
  await client.close();

  // Tampered token is rejected.
  const tampered = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokens.body.access_token.slice(0, -2)}xx`, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(tampered.status, 401);

  console.log("relay oauth-mcp: all assertions passed");
} catch (err) {
  console.error(relayLog.split("\n").slice(-40).join("\n"));
  throw err;
} finally {
  relay.kill("SIGTERM");
  wilma.close();
  wilma2.close();
}
