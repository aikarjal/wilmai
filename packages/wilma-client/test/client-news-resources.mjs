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
      <title>Jaettu asiakirja - Wilma</title>
      <div id="news-content" class="hidden">
        <a href="https://files.example.com/share/token?e=abc">Tiedote</a>
      </div>
    `);
    return;
  }
  if (req.method === "GET" && req.url === "/!123/news/44") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`
      <title>Verkkosivu - Wilma</title>
      <div id="news-content">
        <a href="https://www.example.org/info/page">Lue lisaa</a>
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

  // Wilma-hosted attachments download through the authenticated session.
  const item = await client.news.get(42);
  assert.equal(item.resources?.[0]?.authContext, "wilma");
  assert.equal(item.resources?.[0]?.fileName, "retkilupa.pdf");

  const wilmaFetch = await client.news.fetchResource(42, "resource-1", { item });
  assert.equal(wilmaFetch.status, "fetched");
  assert.equal(wilmaFetch.resource.fileName, "retkilupa.pdf");
  assert.equal(wilmaFetch.response.headers.get("content-type"), "application/pdf");
  assert.equal(await wilmaFetch.response.text(), "test-pdf-bytes");
  assert(requests.includes("/!123/files/retkilupa.pdf"));

  const mockAgent = new MockAgent();
  mockAgent.enableNetConnect(/^127\.0\.0\.1:/);
  setGlobalDispatcher(mockAgent);

  // A sharing link that serves an HTML viewer page as-is, but returns the file
  // when the conventional download parameter is added — via a cross-host
  // redirect that sets a cookie along the way.
  const sharingHost = mockAgent.get("https://files.example.com");
  sharingHost.intercept({
    method: "GET",
    path: "/share/token?e=abc",
  }).reply(200, "<html>viewer</html>", {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  sharingHost.intercept({
    method: "GET",
    path: "/share/token?e=abc&download=1",
  }).reply(302, "", {
    headers: {
      location: "https://cdn.example.net/files/document.pdf",
      "set-cookie": "ShareSession=test-cookie; Path=/; Secure",
    },
  });
  const cdnHost = mockAgent.get("https://cdn.example.net");
  cdnHost.intercept({
    method: "GET",
    path: "/files/document.pdf",
  }).reply(200, "external-pdf-bytes", {
    headers: { "content-type": "application/pdf" },
  });

  const externalItem = await client.news.get(43);
  assert.equal(externalItem.resources?.[0]?.authContext, "external");
  const externalFetch = await client.news.fetchResource(43, "resource-1", { item: externalItem });
  assert.equal(externalFetch.status, "fetched");
  assert.equal(externalFetch.response?.headers.get("content-type"), "application/pdf");
  assert.equal(await externalFetch.response?.text(), "external-pdf-bytes");

  // A link that answers with HTML for every candidate is reported as
  // not_a_file — no guessing, the attempt itself is the classifier.
  const webHost = mockAgent.get("https://www.example.org");
  for (const path of ["/info/page", "/info/page?download=1", "/info/page?dl=1"]) {
    webHost.intercept({ method: "GET", path }).reply(200, "<html>page</html>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  const pageItem = await client.news.get(44);
  const pageFetch = await client.news.fetchResource(44, "resource-1", { item: pageItem });
  assert.equal(pageFetch.status, "not_a_file");
  assert.equal(pageFetch.response, null);

  await mockAgent.close();
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

console.log("client-news-resources: all assertions passed");
