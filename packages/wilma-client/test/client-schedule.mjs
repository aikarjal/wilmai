import assert from "node:assert/strict";
import { createServer } from "node:http";
import { WilmaClient } from "../dist/index.js";

const requests = [];

const server = createServer((req, res) => {
  requests.push(req.url);

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

  if (req.method === "GET" && req.url === "/schedule?date=13.08.2026") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<script>var eventsJSON = { Events : [], ActiveTyyppi: \"\" };</script>");
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end(`Unexpected ${req.method} ${req.url}`);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

try {
  const address = server.address();
  assert(address && typeof address === "object");

  const client = await WilmaClient.login({
    baseUrl: `http://127.0.0.1:${address.port}`,
    username: "test-user",
    password: "test-password",
  });

  await client.schedule.list({ date: "2026-08-13" });
  assert(requests.includes("/schedule?date=13.08.2026"));
} finally {
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
