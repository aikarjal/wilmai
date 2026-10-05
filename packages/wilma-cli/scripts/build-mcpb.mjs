// Build the Claude Desktop extension (MCP Bundle): one bundled server file,
// the tenant list, an icon, and a manifest whose tool list is read from the
// server itself so it can't drift from the code.
//
//   pnpm --filter @wilm-ai/wilma-cli build:mcpb  ->  packages/wilma-cli/build/wilmai.mcpb
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "build", "mcpb");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const require = (await import("node:module")).createRequire(import.meta.url);
// The client package has an exports map, so resolve its entry and step up from dist/.
const tenantList = join(dirname(require.resolve("@wilm-ai/wilma-client")), "..", "tenant_list.json");

await rm(out, { recursive: true, force: true });
await mkdir(join(out, "server"), { recursive: true });

await build({
  entryPoints: [join(root, "dist", "index.js")],
  outfile: join(out, "server", "index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  legalComments: "none",
  // Some dependencies are CommonJS and call require() at runtime.
  banner: { js: "import { createRequire as __wilmaiCreateRequire } from 'node:module'; const require = __wilmaiCreateRequire(import.meta.url);" },
});

// tenants.ts loads ../tenant_list.json relative to the module; readPackageVersion reads ../package.json.
await copyFile(tenantList, join(out, "tenant_list.json"));
await writeFile(
  join(out, "package.json"),
  JSON.stringify({ name: "wilmai-mcpb", version: pkg.version, private: true, type: "module" }, null, 2) + "\n"
);
await copyFile(join(root, "mcpb", "icon.png"), join(out, "icon.png"));

// Ask the bundled server for its tools.
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(out, "server", "index.js"), "mcp"],
  env: { ...process.env, WILMAI_CONFIG_PATH: join(out, ".no-config.json"), WILMAI_NO_BROWSER: "1", WILMAI_NO_UPDATE_CHECK: "1" },
});
const client = new Client({ name: "wilmai-build", version: pkg.version });
await client.connect(transport);
const { tools } = await client.listTools();
await client.close();

const manifest = JSON.parse(await readFile(join(root, "mcpb", "manifest.base.json"), "utf8"));
manifest.version = pkg.version;
manifest.tools = tools.map((t) => ({ name: t.name, description: t.description }));
await writeFile(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

const bundlePath = join(root, "build", "wilmai.mcpb");
const mcpb = join(root, "node_modules", "@anthropic-ai", "mcpb", "dist", "cli", "cli.js");
execFileSync(process.execPath, [mcpb, "pack", out, bundlePath], { stdio: "inherit" });
console.log(`\nBuilt ${bundlePath} (${tools.length} tools, v${pkg.version})`);
