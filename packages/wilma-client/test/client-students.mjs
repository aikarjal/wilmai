import assert from "node:assert/strict";
import { createServer } from "node:http";
import { NetworkError, WilmaClient } from "../dist/index.js";

let mode = "accounts";
let homeRequests = 0;

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/login") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end('<input type="hidden" name="SESSIONID" value="test-session">');
    return;
  }
  if (req.method === "POST" && req.url === "/login") {
    res.writeHead(200, {
      "Content-Type": "text/plain",
      "Set-Cookie": "Wilma2SID=test-cookie; Path=/; HttpOnly",
    });
    res.end("ok");
    return;
  }
  if (req.method === "GET" && req.url === "/api/v1/accounts/me/roles") {
    if (mode === "accounts") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        statusCode: 200,
        payload: [
          { name: "Account", type: "passwd", slug: "" },
          { name: "Ada Example", type: "guardian", slug: "/!12345678" },
        ],
      }));
    } else if (mode === "home") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not available");
    } else {
      req.socket.destroy();
    }
    return;
  }
  if (req.method === "GET" && req.url === "/") {
    homeRequests += 1;
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end('<a href="/!87654321">Grace Example</a>');
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end(`Unexpected ${req.method} ${req.url}`);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

try {
  const address = server.address();
  assert(address && typeof address === "object");
  const profile = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    username: "test-user",
    password: "test-password",
    studentNumber: "99999999",
  };

  const fromAccounts = await WilmaClient.listStudents(profile);
  assert.deepEqual(fromAccounts, [{
    studentNumber: "12345678",
    name: "Ada Example",
    href: "/!12345678/",
  }]);
  assert.equal(homeRequests, 0, "roles API should be preferred over homepage scraping");

  mode = "home";
  const fromHome = await WilmaClient.listStudents(profile);
  assert.deepEqual(fromHome, [{
    studentNumber: "87654321",
    name: "Grace Example",
    href: "/!87654321",
  }]);
  assert.equal(homeRequests, 1, "homepage should be used when the roles API is unavailable");

  mode = "network";
  await assert.rejects(
    WilmaClient.listStudents(profile),
    (error) => error instanceof NetworkError,
    "roles API transport failures should not be hidden by a fallback"
  );
  assert.equal(homeRequests, 1, "transport failures should stop before homepage fallback");

  console.log("client-students: all assertions passed");
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
