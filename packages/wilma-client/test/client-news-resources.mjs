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
  if (req.method === "GET" && req.url === "/!123/news/42") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`
      <title>Retkilupa - Wilma</title>
      <div id="news-content">
        <p>Palauta lupa perjantaihin mennessa.</p>
        <a href="/files/retkilupa.pdf" download>Retkilupa</a>
      </div>
    `);
    return;
  }
  if (req.method === "GET" && req.url === "/!123/files/retkilupa.pdf") {
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="retkilupa.pdf"',
    });
    res.end("test-pdf-bytes");
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
    studentNumber: "123",
  });

  const item = await client.news.get(42);
  assert.equal(item.resources?.[0]?.kind, "wilma_attachment");
  assert.deepEqual(item.resources?.[0]?.availableActions, ["open", "download"]);

  const { resource, response } = await client.news.fetchResource(42, "resource-1");
  assert.equal(resource.fileName, "retkilupa.pdf");
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(await response.text(), "test-pdf-bytes");
  assert(requests.includes("/!123/files/retkilupa.pdf"));
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

console.log("client-news-resources: all assertions passed");
