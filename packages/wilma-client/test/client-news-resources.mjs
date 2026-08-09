import assert from "node:assert/strict";
import { createServer } from "node:http";
import { MockAgent, setGlobalDispatcher } from "undici";
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
  if (req.method === "GET" && req.url === "/!123/news/43") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`
      <title>SharePoint-tiedote - Wilma</title>
      <div id="news-content" class="hidden">
        <a href="https://example.sharepoint.com/:b:/g/personal/example/token?e=abc">Tiedote</a>
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

  const mockAgent = new MockAgent();
  mockAgent.enableNetConnect(/^127\.0\.0\.1:/);
  setGlobalDispatcher(mockAgent);
  const sharePoint = mockAgent.get("https://example.sharepoint.com");
  sharePoint.intercept({
    method: "GET",
    path: "/:b:/g/personal/example/token?e=abc&download=1",
  }).reply(302, "", {
    headers: {
      location: "/personal/example/document.pdf",
      "set-cookie": "SharePointSession=test-cookie; Path=/; Secure",
    },
  });
  sharePoint.intercept({
    method: "GET",
    path: "/personal/example/document.pdf",
    headers: { cookie: "SharePointSession=test-cookie" },
  }).reply(200, "sharepoint-pdf-bytes", {
    headers: { "content-type": "application/pdf" },
  });

  const externalItem = await client.news.get(43);
  assert.equal(externalItem.resources?.[0]?.kind, "external_attachment");
  assert.deepEqual(externalItem.resources?.[0]?.availableActions, ["open", "download"]);
  const externalFetch = await client.news.fetchResource(43, "resource-1");
  assert.equal(externalFetch.status, "fetched");
  assert.equal(externalFetch.response?.headers.get("content-type"), "application/pdf");
  assert.equal(await externalFetch.response?.text(), "sharepoint-pdf-bytes");
  await mockAgent.close();
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

console.log("client-news-resources: all assertions passed");
