import assert from "node:assert/strict";
import { createServer } from "node:http";
import { AuthenticationError, WilmaClient } from "../dist/index.js";

let loginPosts = 0;
let currentSid = 0;
let loginDelayMs = 0;
let failNextLogins = 0;
let staleResponseDelayMs = 0;
const paths = [];

// Mirrors Wilma's real answers: a wrong login redirects to "?loginfailed" with an
// empty body and no Wilma2SID cookie; a right one redirects and sets Wilma2SID.
const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/login") {
    res.writeHead(200, { "Content-Type": "text/html", "Set-Cookie": "Wilma2LoginID=x; Path=/" });
    return res.end('<input type="hidden" name="SESSIONID" value="s">');
  }
  if (req.method === "POST" && req.url === "/login") {
    loginPosts += 1;
    if (loginDelayMs) await new Promise((r) => setTimeout(r, loginDelayMs));
    if (failNextLogins > 0) {
      failNextLogins -= 1;
      res.writeHead(503);
      return res.end("down");
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    const form = new URLSearchParams(body);
    const base = `http://127.0.0.1:${server.address().port}`;
    if (form.get("Login") === "parent" && form.get("Password") === "right") {
      // Like Wilma: one live session per account; a new login cancels the old one.
      currentSid += 1;
      res.writeHead(303, { Location: `${base}/?checkcookie`, "Set-Cookie": `Wilma2SID=ok${currentSid}; Path=/` });
      return res.end();
    }
    res.writeHead(303, { Location: `${base}/?loginfailed` });
    return res.end();
  }
  if (req.url?.startsWith("/?checkcookie")) {
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end("<html>home</html>");
  }
  if (req.url === "/api/v1/accounts/me/roles") {
    // Like Wilma: a cancelled session gets 403; a live one 404 here (older Wilma without the API).
    const roleSid = /Wilma2SID=ok(\d+)/.exec(req.headers.cookie ?? "")?.[1];
    res.writeHead(!roleSid ? 401 : Number(roleSid) !== currentSid ? 403 : 404);
    return res.end();
  }
  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end('<a href="/!1/">Lapsi Yksi</a><a href="/!2/">Lapsi Kaksi</a>');
  }
  if (req.url === "/!1/secret") {
    // Off-limits item on a live session.
    res.writeHead(403);
    return res.end();
  }
  if (/^\/!\d+\/overview$/.test(req.url ?? "")) {
    paths.push(req.url);
    // Only the account's current session gets data; a cancelled one gets 403.
    const sid = /Wilma2SID=ok(\d+)/.exec(req.headers.cookie ?? "")?.[1];
    if (!sid) {
      res.writeHead(401);
      return res.end();
    }
    if (Number(sid) !== currentSid) {
      if (staleResponseDelayMs) await new Promise((r) => setTimeout(r, staleResponseDelayMs));
      res.writeHead(403);
      return res.end();
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end("{}");
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

try {
  await assert.rejects(
    WilmaClient.listStudents({ baseUrl, username: "parent", password: "wrong" }),
    AuthenticationError,
    "a ?loginfailed redirect must be a failed login"
  );
  await assert.rejects(
    WilmaClient.listStudents({ baseUrl, username: "nobody", password: "x" }),
    AuthenticationError
  );
  const students = await WilmaClient.listStudents({ baseUrl, username: "parent", password: "right" });
  assert.deepEqual(students.map((s) => s.name), ["Lapsi Yksi", "Lapsi Kaksi"]);

  // One login serves the whole family: list the children, then each child's data.
  loginPosts = 0;
  const family = await WilmaClient.login({ baseUrl, username: "parent", password: "right" });
  const kids = await family.students();
  for (const kid of kids) await family.forStudent(kid.studentNumber).overview.get();
  assert.equal(loginPosts, 1, "one login for listing and every child");
  assert.deepEqual(paths, ["/!1/overview", "/!2/overview"]);

  // Another login on the same account cancels our session (403). Both children's
  // requests notice at once; the shared session logs in again exactly once.
  await WilmaClient.login({ baseUrl, username: "parent", password: "right" });
  loginPosts = 0;
  await Promise.all(kids.map((kid) => family.forStudent(kid.studentNumber).overview.get()));
  assert.equal(loginPosts, 1, "one re-login for both children after the session was cancelled");

  // A 403 for one item on a live session is just that: no new login.
  loginPosts = 0;
  await assert.rejects(family.forStudent("1").session.get("/secret"), /403/);
  assert.equal(loginPosts, 0, "a forbidden item doesn't cost a login");

  // Wilma fails while we log in again: that call fails, and the next one recovers.
  await WilmaClient.login({ baseUrl, username: "parent", password: "right" }); // cancels ours
  failNextLogins = 1;
  await assert.rejects(family.forStudent("1").overview.get());
  await family.forStudent("1").overview.get();

  // A request that starts during a slow re-login waits for it instead of failing.
  await WilmaClient.login({ baseUrl, username: "parent", password: "right" });
  loginPosts = 0;
  loginDelayMs = 300;
  const first = family.forStudent("1").overview.get();
  await new Promise((r) => setTimeout(r, 100));
  const second = family.forStudent("2").overview.get();
  await Promise.all([first, second]);
  loginDelayMs = 0;
  assert.equal(loginPosts, 1, "requests during a re-login share it");

  // A 403 that arrives after someone else already logged in again: retry, don't log in again.
  await WilmaClient.login({ baseUrl, username: "parent", password: "right" });
  loginPosts = 0;
  staleResponseDelayMs = 400;
  const slow = family.forStudent("1").overview.get(); // its 403 comes back late
  await new Promise((r) => setTimeout(r, 50));
  staleResponseDelayMs = 0;
  await family.forStudent("2").overview.get(); // notices first and logs in again
  await slow;
  assert.equal(loginPosts, 1, "a late 403 from before the re-login doesn't log in again");
  // Two-step verification: Wilma rejects the first code (e.g. already used);
  // the client asks the callback once more for the same challenge.
  const mfaServer = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const base = `http://127.0.0.1:${mfaServer.address().port}`;
    if (req.method === "GET" && req.url === "/login") {
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end('<input type="hidden" name="SESSIONID" value="s">');
    }
    if (req.method === "POST" && req.url === "/login") {
      res.writeHead(303, { Location: `${base}/?mfa`, "Set-Cookie": "Wilma2SID=pending; Path=/" });
      return res.end();
    }
    if (req.url === "/?mfa") {
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end('<input id="mfa-formkey" value="fk1">');
    }
    if (req.url === "/api/v1/accounts/me/mfa/otp/check") {
      const otp = JSON.parse(new URLSearchParams(body).get("payload")).otp;
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ payload: { success: otp === "222222" } }));
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => mfaServer.listen(0, "127.0.0.1", r));
  try {
    const asked = [];
    const codes = ["111111", "222222"];
    await WilmaClient.login(
      { baseUrl: `http://127.0.0.1:${mfaServer.address().port}`, username: "u", password: "p" },
      async (formkey) => {
        asked.push(formkey);
        return codes.shift();
      }
    );
    assert.deepEqual(asked, ["fk1", "fk1"], "asked twice for the same challenge");
  } finally {
    mfaServer.close();
  }

  console.log("login: all assertions passed");
} finally {
  server.close();
}
