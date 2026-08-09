import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const tempDirectory = await mkdtemp(join(tmpdir(), "wilmai-cli-resource-"));
const execFileAsync = promisify(execFile);
const configPath = join(tempDirectory, "config.json");
const outputDirectory = join(tempDirectory, "downloads");
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
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end('<a href="/!123/">Test Student</a>');
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
      <title>Linkkitiedote - Wilma</title>
      <div id="news-content" class="hidden">
        <a href="https://example.sharepoint.com/document">Avaa asiakirja</a>
      </div>
    `);
    return;
  }
  if (req.method === "GET" && req.url === "/!123/files/retkilupa.pdf") {
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="retkilupa.pdf"',
      "Content-Length": String(Buffer.byteLength("test-pdf-bytes")),
    });
    res.end("test-pdf-bytes");
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end(`Unexpected ${req.method} ${req.url}`);
});

await new Promise((resolveServer) => server.listen(0, "127.0.0.1", resolveServer));

try {
  const address = server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const profileId = `${baseUrl}|test-user`;
  await writeFile(configPath, JSON.stringify({
    profiles: [{
      id: profileId,
      tenantUrl: baseUrl,
      tenantName: "Test Wilma",
      username: "test-user",
      passwordObfuscated: Buffer.from("wilmai::test-password", "utf8").toString("base64"),
      students: [{ studentNumber: "123", name: "Test Student" }],
      lastStudentNumber: "123",
      lastStudentName: "Test Student",
      lastUsedAt: new Date().toISOString(),
    }],
    lastProfileId: profileId,
  }, null, 2));
  await writeFile(join(tempDirectory, "version-check.json"), JSON.stringify({
    latestVersion: "1.5.3",
    checkedAt: Date.now(),
  }));

  const cliPath = resolve("dist/index.js");
  const runJson = async (args) => {
    const { stdout } = await execFileAsync(process.execPath, [cliPath, ...args], {
    cwd: resolve(new URL("..", import.meta.url).pathname),
    encoding: "utf8",
    env: { ...process.env, WILMAI_CONFIG_PATH: configPath },
    });
    return JSON.parse(stdout);
  };

  const item = await runJson(["news", "read", "42", "--student", "123", "--json"]);
  assert.equal(item.resources[0].kind, "wilma_attachment");
  assert.deepEqual(item.resources[0].availableActions, ["open", "download"]);

  const downloaded = await runJson([
    "news", "resource", "download", "42", "resource-1",
    "--student", "123", "--output", outputDirectory, "--json",
  ]);
  assert.equal(downloaded.status, "downloaded");
  assert.equal(await readFile(downloaded.path, "utf8"), "test-pdf-bytes");

  const external = await runJson([
    "news", "resource", "download", "43", "resource-1",
    "--student", "123", "--json",
  ]);
  assert.equal(external.status, "external_access_required");
  assert.deepEqual(external.availableActions, ["open_in_authenticated_browser"]);

  console.log("cli-news-resources: all assertions passed");
} finally {
  await new Promise((resolveServer, rejectServer) => {
    server.close((error) => (error ? rejectServer(error) : resolveServer()));
  });
  await rm(tempDirectory, { recursive: true, force: true });
}
