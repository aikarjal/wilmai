import assert from "node:assert/strict";
import { createServer } from "node:http";
import { AuthenticationError, CredentialsUnavailableError, SessionEndedError, WilmaClient } from "../dist/index.js";

// A password given as a function (e.g. a keychain read): called only when
// Wilma needs a new login, once for a burst of requests; a failure is not a
// refusal by Wilma (the next request tries again); logout() drops it.

let loginPosts = 0;
let sidCounter = 0;
let currentSid = null; // the account's one live session (Wilma allows one)

const server = createServer(async (req, res) => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const sid = /Wilma2SID=(\d+)/.exec(req.headers.cookie ?? "")?.[1] ?? null;
  const live = sid !== null && sid === currentSid;
  let body = "";
  for await (const chunk of req) body += chunk;

  if (req.method === "GET" && req.url === "/login") {
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end('<input type="hidden" name="SESSIONID" value="s">');
  }
  if (req.method === "POST" && req.url === "/login") {
    loginPosts += 1;
    const form = new URLSearchParams(body);
    if (form.get("Login") === "parent" && form.get("Password") === "right") {
      currentSid = String(++sidCounter);
      res.writeHead(303, { Location: `${base}/?checkcookie`, "Set-Cookie": `Wilma2SID=${currentSid}; Path=/` });
      return res.end();
    }
    res.writeHead(303, { Location: `${base}/?loginfailed` });
    return res.end();
  }
  if (req.url === "/?checkcookie") {
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end("<html>home</html>");
  }
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    if (!live) return res.end('<form action="/login" method="post"><input name="Login"></form>');
    return res.end(`<html><body>
      <form action="/logout" id="logout-form" method="post"><input type="hidden" name="formkey" value="guardian:1:${sid}"></form>
      <a href="/!1/">Lapsi Yksi</a></body></html>`);
  }
  if (req.method === "POST" && req.url === "/logout") {
    if (live) currentSid = null;
    res.writeHead(303, { Location: `${base}/?logout`, "Set-Cookie": "Wilma2SID=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT" });
    return res.end();
  }
  if (req.url === "/api/v1/accounts/me/roles") {
    res.writeHead(!sid ? 401 : live ? 200 : 403, { "Content-Type": "application/json" });
    return res.end(live ? '{"payload":[]}' : "");
  }
  if (req.url === "/!1/overview") {
    res.writeHead(live ? 200 : 403, { "Content-Type": "application/json" });
    return res.end(live ? "{}" : "");
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

/** A saved session to resume: log in once and export it. */
async function savedSession() {
  const first = await WilmaClient.login({ baseUrl, username: "parent", password: "right" });
  return first.exportSession();
}

/** A password function that records its calls and answers from a script. */
function source(...answers) {
  const fn = async () => {
    fn.calls += 1;
    const next = answers.length > 1 ? answers.shift() : answers[0];
    if (next instanceof Error) throw next;
    return next;
  };
  fn.calls = 0;
  return fn;
}

try {
  // While the saved session works, the password is never asked for.
  {
    const password = source("right");
    const client = WilmaClient.resume({ baseUrl, username: "parent", password }, await savedSession());
    loginPosts = 0;
    await client.forStudent("1").overview.get();
    await client.forStudent("1").overview.get();
    assert.equal(password.calls, 0, "no password read while the session works");
    assert.equal(loginPosts, 0);

    // Wilma ends the session: a burst of requests reads the password once and logs in once.
    currentSid = null;
    const kid = client.forStudent("1");
    await Promise.all([kid.overview.get(), kid.overview.get(), kid.overview.get()]);
    assert.equal(password.calls, 1, "one read for a burst of requests");
    assert.equal(loginPosts, 1, "one login");

    // The answer is kept: a second ending logs in again without reading it again.
    currentSid = null;
    await kid.overview.get();
    assert.equal(password.calls, 1, "the password read earlier is reused");
    assert.equal(loginPosts, 2);
  }

  // The function fails: CredentialsUnavailableError with its reason, no login
  // attempted, and the client isn't stopped for good: the next request tries again.
  {
    const refused = Object.assign(new Error("The keychain didn't hand over the password"), { reason: "refused" });
    const password = source(refused, "right");
    const events = [];
    const client = WilmaClient.resume({ baseUrl, username: "parent", password }, await savedSession());
    const kid = client.forStudent("1");
    currentSid = null;
    loginPosts = 0;
    await assert.rejects(kid.overview.get(), (err) => {
      assert.ok(err instanceof CredentialsUnavailableError, `got ${err?.name}`);
      assert.ok(!(err instanceof SessionEndedError), "not 'log in again'");
      assert.equal(err.reason, "refused");
      assert.equal(err.cause, refused);
      return true;
    });
    assert.equal(loginPosts, 0, "no login without a password");
    await kid.overview.get();
    assert.equal(password.calls, 2, "tried again on the next request");
    assert.equal(loginPosts, 1);
    void events;
  }

  // An error that already is a CredentialsUnavailableError passes through unchanged.
  {
    const own = new CredentialsUnavailableError("missing", { reason: "missing" });
    const client = WilmaClient.resume({ baseUrl, username: "parent", password: source(own) }, await savedSession());
    currentSid = null;
    await assert.rejects(client.forStudent("1").overview.get(), (err) => err === own);
  }

  // logout() drops the function: the next request neither logs in nor reads the password.
  {
    const password = source("right");
    const client = WilmaClient.resume({ baseUrl, username: "parent", password }, await savedSession());
    const kid = client.forStudent("1");
    await kid.overview.get();
    await client.logout();
    loginPosts = 0;
    await assert.rejects(kid.overview.get(), AuthenticationError);
    assert.equal(password.calls, 0);
    assert.equal(loginPosts, 0);
  }

  // logout() after Wilma had ended the session: the client stays logged out
  // and doesn't continue a session another program saved meanwhile.
  {
    let shared = null;
    const sharedSession = { load: async () => shared, save: async (state) => { shared = state; } };
    const client = WilmaClient.resume({ baseUrl, username: "parent", password: source(new Error("no keychain")) }, await savedSession(), undefined, { sharedSession });
    const kid = client.forStudent("1");
    currentSid = null;
    await assert.rejects(kid.overview.get(), CredentialsUnavailableError); // now "ended by Wilma"
    await client.logout();
    shared = await savedSession(); // another program logs in and saves its session
    loginPosts = 0;
    await assert.rejects(kid.overview.get(), AuthenticationError);
    assert.equal(loginPosts, 0);
  }

  // A function answering a wrong password: Wilma refuses, and the client stops
  // for good (as with a saved wrong password), reading the password only once.
  {
    const password = source("wrong");
    const client = WilmaClient.resume({ baseUrl, username: "parent", password }, await savedSession());
    const kid = client.forStudent("1");
    currentSid = null;
    loginPosts = 0;
    await assert.rejects(kid.overview.get(), /login failed/i);
    await assert.rejects(kid.overview.get(), /login failed/i);
    assert.equal(loginPosts, 1, "no second login after Wilma refused");
    assert.equal(password.calls, 1);
  }

  console.log("password-source: ok");
} finally {
  server.close();
}
