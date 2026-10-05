// Two-step verification end to end against a mock Wilma that enforces a TOTP
// challenge like the real one: login page asks for the setup key, the key is
// saved, MCP tools log in with generated codes, and a session cancelled by
// another login recovers with a fresh code.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { generateTOTP } from "../dist/totp.js";
import { mfaCallbackFor } from "../dist/credentials.js";

/* ---------------- unit: the code generator ---------------- */
// RFC 6238 test vector (SHA-1): secret "12345678901234567890", T=59s -> 94287082 (6 digits: 287082).
assert.equal(generateTOTP("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000), "287082");
// A rejected code asked again for the same challenge waits for the next 30-second window.
{
  let now = 1_000_000_000_000 + 5_000;
  const slept = [];
  const cb = mfaCallbackFor("JBSWY3DPEHPK3PXP", { now: () => now, sleep: async (ms) => { slept.push(ms); now += ms; } });
  const first = await cb("challenge-1");
  const second = await cb("challenge-1");
  assert.notEqual(first, second, "retry for the same challenge gets a fresh code");
  assert.equal(slept.length, 1);
  assert.ok(slept[0] > 0 && slept[0] <= 30_050);
  const other = await cb("challenge-2");
  assert.equal(slept.length, 1, "a new challenge does not wait");
  assert.equal(other, second);
}

// MFA_STRICT=1: the mock rejects reused codes, as a careful server would (slower: waits for fresh codes).
const STRICT = process.env.MFA_STRICT === "1";

const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const tempDirectory = await mkdtemp(join(tmpdir(), "wilmai-mfa-"));
const cliPath = resolve(new URL("../dist/index.js", import.meta.url).pathname);

let sidCounter = 0;
let currentSid = null; // the account's one live, verified session
const pending = new Map(); // sid -> formkey awaiting a code
const usedCodes = []; // every code Wilma received
let reusedCode = false;

const wilma = createServer(async (req, res) => {
  const send = (status, type, body, headers = {}) => {
    res.writeHead(status, { "Content-Type": type, ...headers });
    res.end(body);
  };
  const base = `http://127.0.0.1:${wilma.address().port}`;
  const sid = /Wilma2SID=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
  let body = "";
  for await (const chunk of req) body += chunk;

  if (req.method === "GET" && req.url === "/login") return send(200, "text/html", '<input type="hidden" name="SESSIONID" value="s">');
  if (req.method === "POST" && req.url === "/login") {
    const form = new URLSearchParams(body);
    if (form.get("Login") !== "mfa-parent" || form.get("Password") !== "pw") {
      return send(303, "text/plain", "", { Location: `${base}/?loginfailed` });
    }
    const newSid = `s${++sidCounter}`;
    pending.set(newSid, `fk-${newSid}`);
    return send(303, "text/plain", "", { Location: `${base}/?mfa`, "Set-Cookie": `Wilma2SID=${newSid}; Path=/` });
  }
  if (req.url === "/?mfa") return send(200, "text/html", `<input id="mfa-formkey" value="${pending.get(sid)}">`);
  if (req.method === "POST" && req.url === "/api/v1/accounts/me/mfa/otp/check") {
    const form = new URLSearchParams(body);
    const otp = JSON.parse(form.get("payload") ?? "{}").otp;
    const reuse = usedCodes.includes(otp);
    if (reuse) reusedCode = true;
    usedCodes.push(otp);
    const ok = pending.get(sid) === form.get("formkey") && otp === generateTOTP(SECRET) && !(STRICT && reuse);
    if (ok) {
      pending.delete(sid);
      currentSid = sid; // a new verified login cancels the previous session
    }
    return send(200, "application/json", JSON.stringify({ payload: { success: ok } }));
  }
  // Everything else needs the current, verified session.
  if (!sid) return send(401, "text/plain", "");
  if (sid !== currentSid) return send(403, "text/plain", "");
  if (req.url === "/api/v1/accounts/me/roles") return send(404, "text/plain", "");
  if (req.url === "/") return send(200, "text/html", '<a href="/!7/">Mfa Lapsi</a>');
  if (req.url === "/!7/overview") return send(200, "application/json", "{}");
  if (req.url === "/!7/news") return send(200, "application/json", "[]");
  if (req.url === "/!7/messages/list") return send(200, "application/json", '{"Messages": []}');
  send(404, "text/plain", "");
});
await new Promise((r) => wilma.listen(0, "127.0.0.1", r));
const wilmaUrl = `http://127.0.0.1:${wilma.address().port}`;

const configPath = join(tempDirectory, "config.json");
const env = { ...process.env, WILMAI_CONFIG_PATH: configPath, WILMAI_NO_BROWSER: "1", WILMAI_NO_UPDATE_CHECK: "1" };
for (const key of ["WILMA_TENANT", "WILMA_USERNAME", "WILMA_PASSWORD", "WILMA_TOTP_SECRET"]) delete env[key];

try {
  const client = new Client({ name: "mfa-test", version: "0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [cliPath, "mcp"], env, stderr: "pipe" }));

  // Not logged in: the tool hands back the login page.
  const first = await client.callTool({ name: "wilma_summary", arguments: {} });
  const loginUrl = /http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]+\//.exec(first.content[0].text)[0];
  const origin = new URL(loginUrl).origin;
  const login = (extra) =>
    fetch(loginUrl + "api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ tenantUrl: wilmaUrl, tenantName: "MFA Wilma", username: "mfa-parent", password: "pw", ...extra }),
    }).then((r) => r.json());

  assert.equal((await login({})).status, "mfa_required", "page asks for the setup key");
  assert.equal((await login({ totpSecret: "123456" })).code, "bad_totp", "a 6-digit code is refused");
  assert.equal((await login({ totpSecret: "JBSWY3DPEHPK3PXQJBSWY3DPEHPK3PXQ" })).code, "bad_totp", "a wrong key is reported as such");
  const ok = await login({ totpSecret: `otpauth://totp/Wilma:mfa-parent?secret=${SECRET}&issuer=Wilma` });
  assert.equal(ok.status, "ok", JSON.stringify(ok));
  const saved = JSON.parse(await readFile(configPath, "utf8"));
  assert.ok(saved.profiles[0].totpSecretObfuscated, "key saved with the login");
  assert.ok(!JSON.stringify(saved).includes(SECRET), "key is not stored in plain text");

  // The first question reuses the session the login page verified: no new login, no new code.
  const codesBefore = usedCodes.length;
  const summary = await client.callTool({ name: "wilma_summary", arguments: {} });
  assert.equal(usedCodes.length, codesBefore, "no second code right after logging in");
  assert.ok(!summary.isError, summary.content[0].text);
  assert.equal(JSON.parse(summary.content[0].text).students[0].student.name, "Mfa Lapsi");

  // Another login on the account (say, the parent's phone) cancels our session;
  // the next tool call recovers by logging in again with a code.
  currentSid = "someone-else";
  const again = await client.callTool({ name: "wilma_homework", arguments: {} });
  assert.ok(!again.isError, again.content[0].text);

  // The CLI too: another process, but it continues the saved session — no
  // new login, no new code.
  const { execFile } = await import("node:child_process");
  const codesBeforeCli = usedCodes.length;
  const out = await new Promise((r, j) =>
    execFile(process.execPath, [cliPath, "students"], { env }, (e, so, se) => (e ? j(new Error(se || e.message)) : r(so)))
  );
  assert.equal(JSON.parse(out).students[0].name, "Mfa Lapsi");
  assert.equal(usedCodes.length, codesBeforeCli, "the CLI reused the saved session");

  // When that session has ended, the CLI logs in again with a generated code.
  currentSid = "someone-else";
  const again2 = await new Promise((r, j) =>
    execFile(process.execPath, [cliPath, "students"], { env }, (e, so, se) => (e ? j(new Error(se || e.message)) : r(so)))
  );
  assert.equal(JSON.parse(again2).students[0].name, "Mfa Lapsi");
  assert.ok(usedCodes.length > codesBeforeCli, "a fresh code for the new login");
  await client.close();

  console.log(`mfa${STRICT ? " (strict: reused codes rejected)" : ""}: all assertions passed (${usedCodes.length} codes sent; ${reusedCode ? "a reused code was " + (STRICT ? "rejected and retried" : "accepted") : "no code reused"})`);
} finally {
  wilma.close();
  await rm(tempDirectory, { recursive: true, force: true });
}
