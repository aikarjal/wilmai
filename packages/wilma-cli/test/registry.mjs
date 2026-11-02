// server.json, the MCP Registry entry, has to name the npm package and version
// being published, and the registry checks it against package.json's mcpName.
// A release that raises the version in one place but not the other fails here
// rather than at `mcp-publisher publish`.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const server = JSON.parse(await readFile(new URL("../server.json", import.meta.url), "utf8"));
const npm = server.packages.find((p) => p.registryType === "npm");

assert.equal(server.name, pkg.mcpName);
assert.equal(server.version, pkg.version);
assert.equal(npm.identifier, pkg.name);
assert.equal(npm.version, pkg.version);
assert.deepEqual(npm.packageArguments, [{ type: "positional", value: "mcp" }]);
assert.ok(server.description.length <= 100, "the registry allows 100 characters");

console.log("registry: all assertions passed");
