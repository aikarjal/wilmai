import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const tempDirectory = await mkdtemp(join(tmpdir(), "wilmai-cli-resource-"));
const execFileAsync = promisify(execFile);
const configPath = join(tempDirectory, "config.json");
const outputDirectory = join(tempDirectory, "downloads");

let externalPort = 0;
const externalServer = createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/external/file.pdf") {
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": "attachment; filename*=UTF-8''Liite%20%C3%A4iti.pdf",
    });
    res.end("external-pdf-bytes");
    return;
  }
  if (url.pathname === "/external/page") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<html>just a web page</html>");
    return;
  }
  if (url.pathname === "/external/big.pdf") {
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Length": String(60 * 1024 * 1024),
    });
    res.end();
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end(`Unexpected ${req.method} ${req.url}`);
});

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
    // Exact numeric selectors must work even when live student enumeration is empty.
    res.end("<html></html>");
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
        <a href="http://127.0.0.1:${externalPort}/external/page">Avaa sivu</a>
      </div>
    `);
    return;
  }
  if (req.method === "GET" && req.url === "/!123/news/45") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`
      <title>Liitetiedote - Wilma</title>
      <div id="news-content" class="hidden">
        <a href="http://127.0.0.1:${externalPort}/external/file.pdf">Julkinen liite</a>
      </div>
    `);
    return;
  }
  if (req.method === "GET" && req.url === "/!123/news/46") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`
      <title>Iso liite - Wilma</title>
      <div id="news-content" class="hidden">
        <a href="http://127.0.0.1:${externalPort}/external/big.pdf">Iso liite</a>
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

await new Promise((resolveServer) => externalServer.listen(0, "127.0.0.1", resolveServer));
externalPort = externalServer.address().port;
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

  const cliPath = resolve(new URL("../dist/index.js", import.meta.url).pathname);
  const runJson = async (args, options = {}) => {
    try {
      const { stdout } = await execFileAsync(process.execPath, [cliPath, ...args], {
        cwd: options.cwd ?? tempDirectory,
        encoding: "utf8",
        env: { ...process.env, WILMAI_CONFIG_PATH: configPath },
      });
      return { exitCode: 0, output: JSON.parse(stdout) };
    } catch (error) {
      if (typeof error?.code === "number" && error.stdout) {
        return { exitCode: error.code, output: JSON.parse(error.stdout) };
      }
      throw error;
    }
  };

  // Empty live enumeration preserves and returns the cached student list.
  const kids = await runJson(["kids", "list", "--json"]);
  assert.equal(kids.exitCode, 0);
  assert.deepEqual(kids.output, [{
    studentNumber: "123",
    name: "Test Student",
    href: "/!123/",
  }]);

  // Every resource is attemptable; no kind guessing in the schema.
  const read = await runJson(["news", "read", "42", "--student", "123", "--json"]);
  assert.equal(read.output.resources[0].authContext, "wilma");
  assert.equal(read.output.resources[0].fileName, "retkilupa.pdf");
  assert.equal(read.output.resources[0].kind, undefined);

  // Wilma-hosted attachment downloads via the session.
  const downloaded = await runJson([
    "news", "resource", "download", "42", "resource-1",
    "--student", "123", "--output", outputDirectory, "--json",
  ]);
  assert.equal(downloaded.output.status, "downloaded");
  assert.equal(await readFile(downloaded.output.path, "utf8"), "test-pdf-bytes");

  // Numeric shorthand resolves to resource-1; collision naming appends -1.
  const shorthand = await runJson([
    "news", "resource", "download", "42", "1",
    "--student", "123", "--output", outputDirectory, "--json",
  ]);
  assert.equal(shorthand.output.status, "downloaded");
  assert.equal(basename(shorthand.output.path), "retkilupa-1.pdf");

  // A public external file downloads without any Wilma credentials, and the
  // RFC 5987 encoded filename is decoded.
  const external = await runJson([
    "news", "resource", "download", "45", "resource-1",
    "--student", "123", "--output", outputDirectory, "--json",
  ]);
  assert.equal(external.output.status, "downloaded");
  assert.equal(basename(external.output.path), "Liite äiti.pdf");
  assert.equal(await readFile(external.output.path, "utf8"), "external-pdf-bytes");

  // An external link that answers with HTML reports not_a_file plus a
  // browser fallback — the attempt is the classifier.
  const page = await runJson([
    "news", "resource", "download", "43", "resource-1",
    "--student", "123", "--output", outputDirectory, "--json",
  ]);
  assert.equal(page.output.status, "not_a_file");
  assert.deepEqual(page.output.availableActions, ["open_in_browser"]);
  assert.ok(page.output.resource.url.includes("/external/page"));

  // Oversized downloads fail with a JSON error envelope and exit code 1.
  const oversized = await runJson([
    "news", "resource", "download", "46", "resource-1",
    "--student", "123", "--output", outputDirectory, "--json",
  ]);
  assert.equal(oversized.exitCode, 1);
  assert.equal(oversized.output.status, "error");
  assert.match(oversized.output.message, /50 MB/);

  // --output defaults to the current working directory.
  const defaultDir = join(tempDirectory, "cwd-download");
  await mkdir(defaultDir, { recursive: true });
  const defaulted = await runJson([
    "news", "resource", "download", "42", "resource-1",
    "--student", "123", "--json",
  ], { cwd: defaultDir });
  assert.equal(defaulted.output.status, "downloaded");
  assert.equal(basename(defaulted.output.path), "retkilupa.pdf");
  assert.equal(await readFile(join(defaultDir, "retkilupa.pdf"), "utf8"), "test-pdf-bytes");

  console.log("cli-news-resources: all assertions passed");
} finally {
  await new Promise((resolveServer, rejectServer) => {
    server.close((error) => (error ? rejectServer(error) : resolveServer()));
  });
  await new Promise((resolveServer, rejectServer) => {
    externalServer.close((error) => (error ? rejectServer(error) : resolveServer()));
  });
  await rm(tempDirectory, { recursive: true, force: true });
}
