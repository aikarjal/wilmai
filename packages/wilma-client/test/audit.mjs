// Regression tests for the security and robustness audit: the private-network
// guard for bulletin links, Wilma-only redirects and cookies, no retry storm
// after a refused login, Finnish time on any machine, and parser edge cases.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { WilmaClient, parseWilmaTimestamp, parseStudentsFromHome } from "../dist/index.js";
import { assertPublicUrl, isBlockedAddress } from "../dist/external-fetch.js";
import { parseStudentsFromAccountsRoles } from "../dist/parsers/students.js";
import { parseMessagesList } from "../dist/parsers/messages.js";
import { parseNewsDetailJson, parseNewsList } from "../dist/parsers/news.js";
import { parseAttendanceHtml } from "../dist/parsers/attendance.js";

delete process.env.WILMAI_ALLOW_PRIVATE_NETWORK;

/* ---------------- private-network guard ---------------- */
for (const address of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"]) {
  assert.equal(isBlockedAddress(address), true, `${address} must be blocked`);
}
// IPv6 forms that carry an IPv4 address are judged by that address.
for (const address of ["::7f00:1", "::ffff:7f00:1", "::ffff:0:7f00:1", "64:ff9b::a9fe:a9fe", "64:ff9b::10.0.0.1", "2002:7f00:1::", "64:ff9b:1::1", "2001:0:4136:e378::1"]) {
  assert.equal(isBlockedAddress(address), true, `${address} must be blocked`);
}
for (const address of ["8.8.8.8", "1.1.1.1", "2001:4860:4860::8888", "::ffff:8.8.8.8", "64:ff9b::808:808", "2002:808:808::1"]) {
  assert.equal(isBlockedAddress(address), false, `${address} is public`);
}
for (const url of ["http://127.0.0.1/x", "http://2130706433/x", "http://[::1]/x", "http://localhost/x", "http://foo.localhost/x", "https://example.com:8080/x", "ftp://example.com/x", "http://169.254.169.254/latest/meta-data"]) {
  assert.throws(() => assertPublicUrl(new URL(url)), /won't fetch/, url);
}
assertPublicUrl(new URL("https://example.com/file.pdf"));
assertPublicUrl(new URL("http://example.com:80/file.pdf"));

/* ---------------- mock Wilma ---------------- */
let password = "right";
let loginPosts = 0;
let loginOutage = null; // e.g. 429: Wilma refuses for now, not because of the password
let tokenOutage = false;
let stallBody = false;
let currentSid = 0;
const externalHits = [];
const external = createServer((req, res) => {
  externalHits.push({ url: req.url, cookie: req.headers.cookie ?? null });
  res.writeHead(200, { "Content-Type": "application/pdf", "Set-Cookie": "Wilma2SID=attacker; Path=/" });
  res.end("external-file");
});
await new Promise((r) => external.listen(0, "127.0.0.1", r));
const externalUrl = `http://127.0.0.1:${external.address().port}`;

// Today in Helsinki as Wilma writes it (D.M.YYYY).
const helsinki = Object.fromEntries(
  new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Helsinki", day: "numeric", month: "numeric", year: "numeric" })
    .formatToParts(new Date())
    .map((p) => [p.type, p.value])
);
const today = `${Number(helsinki.day)}.${Number(helsinki.month)}.${helsinki.year}`;

const wilma = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const base = `http://127.0.0.1:${wilma.address().port}`;
  const sid = /Wilma2SID=s(\d+)/.exec(req.headers.cookie ?? "")?.[1];
  const send = (status, headers = {}, text = "") => {
    res.writeHead(status, headers);
    res.end(text);
  };
  if (req.method === "GET" && req.url === "/login") {
    // Without a SESSIONID on the page, the client asks /token.
    return send(200, { "Content-Type": "text/html" }, tokenOutage ? "" : '<input type="hidden" name="SESSIONID" value="x">');
  }
  if (req.url === "/token") return send(503);
  if (req.method === "POST" && req.url === "/login") {
    loginPosts += 1;
    if (loginOutage) return send(loginOutage);
    if (new URLSearchParams(body).get("Password") !== password) return send(303, { Location: `${base}/?loginfailed` });
    currentSid += 1;
    return send(303, { Location: `${base}/?checkcookie`, "Set-Cookie": `Wilma2SID=s${currentSid}; Path=/` });
  }
  if (req.url === "/?checkcookie") return send(200, { "Content-Type": "text/html" }, "home");
  if (!sid) return send(401);
  // Like Wilma, the messages page sends a cancelled session to the login page.
  if (Number(sid) !== currentSid && req.url === "/!1/messages/list") return send(302, { Location: `${base}/login` });
  if (Number(sid) !== currentSid) return send(403);
  if (req.url === "/!1/messages/list") {
    return send(200, { "Content-Type": "application/json" }, JSON.stringify({ Messages: [{ Id: 7, Subject: "Retki", TimeStamp: "2026-02-05 14:00" }] }));
  }
  if (req.url === "/api/v1/accounts/me/roles") return send(404);
  if (req.url === "/") return send(200, { "Content-Type": "text/html" }, '<a href="/!1/">Lapsi</a>');
  if (req.url === "/!1/news/5") {
    return send(200, { "Content-Type": "text/html" }, `<title>T - Wilma</title><div id="news-content"><a href="/files/x.pdf">Liite</a></div>`);
  }
  // Wilma hands the file to another site.
  if (req.url === "/!1/files/x.pdf") return send(302, { Location: `${externalUrl}/stored/x.pdf` });
  if (req.url === "/!1/elsewhere") return send(302, { Location: `${externalUrl}/page` });
  if (req.url === "/!1/attendance/view") {
    return send(200, { "Content-Type": "text/html" }, `<table><thead><tr><th>Pv</th><th>Pvm</th><th colspan="1">8</th></tr></thead>
      <tbody><tr><td>Ma</td><td>${today}</td><td class="at-tp1" title="Myöhästyminen /Opettaja">M</td></tr></tbody></table>`);
  }
  if (req.url === "/!1/overview") return send(200, { "Content-Type": "application/json" }, "{}");
  if (req.url === "/!1/slow") {
    // Headers at once, then the body stalls.
    res.writeHead(200, { "Content-Type": "application/pdf" });
    res.write("part");
    if (!stallBody) res.end("-rest");
    return;
  }
  send(404);
});
await new Promise((r) => wilma.listen(0, "127.0.0.1", r));
const baseUrl = `http://127.0.0.1:${wilma.address().port}`;

try {
  const client = await WilmaClient.login({ baseUrl, username: "parent", password: "right" });
  const kid = client.forStudent("1");

  // A request path can't leave Wilma (student paths get a "/!n" prefix, so
  // check on the account-level session).
  const account = client.forStudent(null).session;
  await assert.rejects(account.get("//evil.example/x"), /outside Wilma/);
  await assert.rejects(account.get("https://evil.example/x"), /outside Wilma/);

  // A redirect from Wilma to another site is an error for normal requests...
  await assert.rejects(kid.session.get("/elsewhere"), /redirected to another site/);

  // ...and for a download it continues on that site without Wilma's cookies,
  // and the other site can't overwrite Wilma's session cookie. (Allow the
  // loopback "external" server for this step only.)
  process.env.WILMAI_ALLOW_PRIVATE_NETWORK = "1";
  const fetched = await kid.news.fetchResource(5, "resource-1");
  delete process.env.WILMAI_ALLOW_PRIVATE_NETWORK;
  assert.equal(fetched.status, "fetched");
  assert.equal(await fetched.response.text(), "external-file");
  assert.equal(externalHits.at(-1).cookie, null, "no cookie sent to the other site");
  await kid.overview.get(); // still logged in: the session cookie wasn't replaced

  // The guard is on by default: the same file on a loopback address is refused.
  await assert.rejects(kid.news.fetchResource(5, "resource-1"), /won't fetch/);

  // Lesson notes without a date default to today in Finnish time.
  const notes = await kid.attendance.list();
  assert.equal(notes.length, 1, "today's notes are found without --date");

  // A cancelled session answered with a redirect to the login page logs in
  // again, instead of reading the login page as an empty inbox.
  await WilmaClient.login({ baseUrl, username: "parent", password: "right" }); // cancels our session
  assert.deepEqual((await kid.messages.list("inbox")).map((m) => m.wilmaId), [7]);

  // A body that stalls mid-way fails as a timeout, like a request that never answers.
  stallBody = true;
  const slow = await kid.session.get("/slow", undefined, { timeoutMs: 300 });
  await assert.rejects(slow.text(), (err) => err.name === "NetworkError" && err.code === "TIMEOUT");
  stallBody = false;
  assert.equal(await (await kid.session.get("/slow")).text(), "part-rest");

  // Wilma refusing a re-login for now (rate limit, firewall, outage) is not a
  // wrong password: once Wilma recovers, the same session works again.
  await WilmaClient.login({ baseUrl, username: "parent", password: "right" }); // cancels our session
  loginOutage = 429;
  await assert.rejects(kid.overview.get(), (err) => err.name === "APIError" && err.status === 429);
  loginOutage = null;
  await kid.overview.get();
  await WilmaClient.login({ baseUrl, username: "parent", password: "right" });
  tokenOutage = true;
  await assert.rejects(kid.overview.get(), (err) => err.name === "APIError" && err.status === 503, "an outage is not a wrong password");
  tokenOutage = false;
  await kid.overview.get();

  // After the password changes, a refused re-login stops further login attempts.
  await WilmaClient.login({ baseUrl, username: "parent", password: "right" }); // cancels our session
  password = "changed";
  loginPosts = 0;
  for (let i = 0; i < 4; i++) await assert.rejects(kid.overview.get());
  assert.equal(loginPosts, 1, "one refused login, then no more attempts (no account lockout)");
} finally {
  wilma.close();
  external.close();
}

/* ---------------- Finnish time on any machine ---------------- */
for (const tz of ["UTC", "America/Los_Angeles", "Europe/Helsinki"]) {
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", `
    import { parseWilmaTimestamp } from "${new URL("../dist/index.js", import.meta.url).href}";
    process.stdout.write(parseWilmaTimestamp("2026-02-05 14:00").toISOString() + " " + parseWilmaTimestamp("5.7.2026 9:30").toISOString());
  `], { env: { ...process.env, TZ: tz }, encoding: "utf8" });
  assert.equal(out, "2026-02-05T12:00:00.000Z 2026-07-05T06:30:00.000Z", `Wilma times in ${tz}`);
}
assert.equal(parseWilmaTimestamp("2026-02-05 14:00").toISOString(), "2026-02-05T12:00:00.000Z");

/* ---------------- parser edge cases ---------------- */
// A name containing a menu word is still a name; menu links are ignored.
assert.deepEqual(
  parseStudentsFromHome('<a href="/!42/">Ella Newsome</a><a href="/!42/news">News</a>').map((s) => s.name),
  ["Ella Newsome"]
);
// A child linked only deeper than their root is kept, by that link's text.
assert.deepEqual(
  parseStudentsFromHome('<a href="/!7/">Aino Lapsi</a><a href="/!8/overview">Eino Lapsi</a><a href="/!7/messages">Viestit</a>').map((s) => s.name),
  ["Aino Lapsi", "Eino Lapsi"]
);
// An empty role name keeps the student (named by number).
assert.equal(parseStudentsFromAccountsRoles({ payload: [{ type: "guardian", slug: "!77", name: "" }] }).length, 1);
// Items without a usable id are skipped instead of carrying NaN.
assert.deepEqual(parseMessagesList([{ Subject: "x" }, { Id: 9, Subject: "y", TimeStamp: "2026-02-05 14:00" }], "inbox").map((m) => m.wilmaId), [9]);
assert.deepEqual(parseNewsList([{ Title: "x" }, { Id: 3, Title: "y" }]).map((n) => n.wilmaId), [3]);
// Non-string content doesn't throw.
assert.equal(parseNewsDetailJson(1, { Title: "t", Content: { html: "x" } }).content, null);
// Attendance rows are matched against the given date.
assert.equal(parseAttendanceHtml("<table><thead><tr><th>8</th></tr></thead></table>", "2026-02-05").length, 0);

console.log("audit: all assertions passed");
