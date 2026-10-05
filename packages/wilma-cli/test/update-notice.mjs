// The "newer WilmAI is available" notice: on stderr for people and agents, and
// once per MCP server as a note the assistant passes on. A fresh version-check
// cache stands in for npm, so nothing here goes online.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { installKind, isNewerVersion, mcpUpdateNote } from "../dist/update-check.js";

const execFileAsync = promisify(execFile);
const cliPath = resolve(new URL("../dist/index.js", import.meta.url).pathname);
const version = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version;
const tempDirectory = await mkdtemp(join(tmpdir(), "wilmai-update-notice-"));

// Where WilmAI runs from decides how it updates.
assert.equal(installKind({}, `${sep}usr${sep}lib${sep}node_modules${sep}@wilm-ai${sep}wilma-cli${sep}dist${sep}update-check.js`), "npm");
assert.equal(installKind({}, `${sep}home${sep}me${sep}.npm${sep}_npx${sep}0a1b${sep}node_modules${sep}@wilm-ai${sep}wilma-cli${sep}dist${sep}update-check.js`), "npx");
assert.equal(installKind({ WILMAI_INSTALL: "claude-desktop" }), "claude-desktop");
assert.ok(isNewerVersion("2.0.10", "2.0.9"));
assert.ok(isNewerVersion("3.0.0", "2.9.9"));
assert.ok(!isNewerVersion("2.0.1", "2.0.1"));
assert.ok(!isNewerVersion("2.0.0", "2.1.0"));
assert.match(mcpUpdateNote("claude-desktop", "2.0.1", "2.1.0"), /wilm\.ai\/get\/claude/);
assert.match(mcpUpdateNote("npm", "2.0.1", "2.1.0"), /wilma update/);

/** A config directory whose version check already "knows" about `latest`. */
async function configWithLatest(name, latest) {
  const configPath = join(tempDirectory, name, "config.json");
  await mkdir(join(tempDirectory, name), { recursive: true });
  await writeFile(join(tempDirectory, name, "version-check.json"), JSON.stringify({ latestVersion: latest, checkedAt: Date.now() }));
  return configPath;
}

try {
  // CLI, run by an agent (no terminal): the notice is on stderr, the JSON on stdout untouched.
  const cliConfig = await configWithLatest("cli", "99.0.0");
  const env = { ...process.env, WILMAI_CONFIG_PATH: cliConfig, WILMAI_NO_BROWSER: "1" };
  const found = await execFileAsync(process.execPath, [cliPath, "find-school", "Tampere"], { env });
  assert.ok(JSON.parse(found.stdout).wilmas.length > 0);
  assert.match(found.stderr, new RegExp(`Update available: ${version.replace(/\./g, "\\.")} → 99\\.0\\.0`));
  assert.match(found.stderr, /wilma update/);

  // Up to date, or turned off: no notice.
  const current = await configWithLatest("current", version);
  assert.doesNotMatch((await execFileAsync(process.execPath, [cliPath, "find-school", "Tampere"], { env: { ...env, WILMAI_CONFIG_PATH: current } })).stderr, /Update available/);
  assert.doesNotMatch((await execFileAsync(process.execPath, [cliPath, "find-school", "Tampere"], { env: { ...env, WILMAI_NO_UPDATE_CHECK: "1" } })).stderr, /Update available/);

  // MCP server inside the Claude Desktop extension: the first Wilma tool result
  // carries the note with the extension's way to update; later ones don't.
  const mcpConfig = await configWithLatest("mcp", "99.0.0");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliPath, "mcp"],
    env: { ...process.env, WILMAI_CONFIG_PATH: mcpConfig, WILMAI_NO_BROWSER: "1", WILMAI_INSTALL: "claude-desktop" },
  });
  const client = new Client({ name: "update-notice-test", version: "1" });
  await client.connect(transport);
  const instructions = client.getInstructions() ?? "";
  assert.match(instructions, /Update note/);
  const first = await client.callTool({ name: "wilma_summary", arguments: {} });
  const firstText = first.content.map((c) => c.text ?? "").join("\n");
  assert.match(firstText, /Update note: WilmAI 99\.0\.0 is available/);
  assert.match(firstText, /wilm\.ai\/get\/claude/);
  const second = await client.callTool({ name: "wilma_summary", arguments: {} });
  assert.doesNotMatch(second.content.map((c) => c.text ?? "").join("\n"), /Update note/);
  await client.close();
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}

console.log("update-notice: all assertions passed");
