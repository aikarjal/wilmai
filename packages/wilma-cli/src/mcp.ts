import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AuthenticationError } from "@wilm-ai/wilma-client";
import { type WilmaAccess, useSessionStore } from "./agent-data.js";
import { fileSessionStore } from "./session-store.js";
import { createAccess } from "./access.js";
import { loadConfig } from "./config.js";
import { ENV_VARS, isMfaFailure, resolveAccounts } from "./credentials.js";
import { createUniqueDownloadFile } from "./downloads.js";
import { openBrowser, startLoginServer, type LoginServer } from "./login-server.js";
import { z } from "zod";
import { INSTRUCTIONS, READ_ONLY, json, registerWilmaTools, textResult } from "./mcp-tools.js";
import { searchTenants } from "./tenant-search.js";
import { installKind, isNewerVersion, latestWithin, mcpUpdateNote, startUpdateCheck, updateChecksEnabled, type UpdateCheck } from "./update-check.js";

const SECRET_SETTINGS_HINT = [
  "If the user is not at this computer (for example, this agent runs on a cloud computer), the link won't work for them. Instead:",
  "  1. Ask which city their children's school is in (or the school's name), call wilma_find_school, and let them pick their Wilma from the results.",
  `  2. Ask them to add their Wilma login to this agent's secret or environment settings: ${ENV_VARS.username}=<username>, ${ENV_VARS.password}=<password>`,
  `     (${ENV_VARS.totpSecret}=<authenticator setup key> if the account uses two-step verification), and set ${ENV_VARS.tenant} to the Wilma address they picked.`,
  "Never ask the user to type their Wilma password into the chat.",
].join("\n");

let loginServerPromise: Promise<LoginServer> | null = null;

/** One login page at a time. Parallel tool calls share it; an explicit wilma_login starts a fresh one. */
async function ensureLoginServer(fresh: boolean): Promise<{ server: LoginServer; created: boolean }> {
  if (fresh && loginServerPromise) {
    (await loginServerPromise).close();
    loginServerPromise = null;
  }
  if (loginServerPromise) return { server: await loginServerPromise, created: false };
  const pending = startLoginServer().then((server) => {
    server.result.finally(() => {
      if (loginServerPromise === pending) loginServerPromise = null;
    });
    return server;
  });
  loginServerPromise = pending;
  return { server: await pending, created: true };
}

async function startBrowserLogin(requested = false): Promise<CallToolResult> {
  const { server, created } = await ensureLoginServer(requested);
  const opened = created ? openBrowser(server.url) : "skipped";
  if (opened === "headless") {
    server.close();
    return textResult(["Not logged in to Wilma, and this computer has no browser.", SECRET_SETTINGS_HINT].join("\n"), true);
  }
  const lead = requested ? "" : "The user is not logged in to Wilma yet. ";
  return textResult(
    [
      opened === "opened"
        ? `${lead}A login page has opened in the user's browser:`
        : created
          ? `${lead}Ask the user to open this login page in a browser on this computer:`
          : `${lead}A login page is already open (if the user can't find it, they can open this link on this computer):`,
      server.url,
      "They pick their school's Wilma and log in there; the password never goes through the chat. Then try again.",
      "",
      SECRET_SETTINGS_HINT,
    ].join("\n"),
    !requested
  );
}

let updateCheck: UpdateCheck | null = null;
let updateNoted = false;

/**
 * Once per server process, add a note when a newer WilmAI is out, so the
 * assistant can tell the user how to update (see INSTRUCTIONS).
 */
async function withUpdateNote(result: CallToolResult, version: string): Promise<CallToolResult> {
  if (!updateCheck || updateNoted) return result;
  const latest = await latestWithin(updateCheck, 300).catch(() => null);
  if (!latest) return result;
  updateNoted = true;
  if (!isNewerVersion(latest, version)) return result;
  return { ...result, content: [...result.content, { type: "text", text: mcpUpdateNote(installKind(), version, latest) }] };
}

async function withAccess(run: (access: WilmaAccess) => Promise<CallToolResult>): Promise<CallToolResult> {
  const config = await loadConfig();
  let accounts: Awaited<ReturnType<typeof resolveAccounts>>;
  try {
    accounts = await resolveAccounts(config);
  } catch (err) {
    return textResult(err instanceof Error ? err.message : String(err), true);
  }
  if (!accounts.length) return startBrowserLogin();
  const access = createAccess(accounts);
  try {
    return await run(access);
  } catch (err) {
    if (isMfaFailure(err)) {
      return textResult(
        "Wilma rejected the two-step verification code; the saved authenticator setup key may be wrong. Call wilma_login to log in again.",
        true
      );
    }
    if (err instanceof AuthenticationError) {
      return textResult(
        "Wilma rejected the saved login (the password may have changed). Call wilma_login to log in again.",
        true
      );
    }
    return textResult(err instanceof Error ? err.message : String(err), true);
  }
}

function createWilmaMcpServer(version: string): McpServer {
  const server = new McpServer({ name: "wilma", title: "WilmAI", version }, { instructions: INSTRUCTIONS });

  registerWilmaTools(server, {
    withAccess: async (run) => withUpdateNote(await withAccess(run), version),
    saveAttachment: async (fetched) => {
      const directory = resolve(homedir(), "Downloads", "WilmAI");
      await mkdir(directory, { recursive: true });
      const { path, handle } = await createUniqueDownloadFile(directory, fetched.fileName);
      await handle.close();
      await writeFile(path, fetched.data);
      return path;
    },
  });

  server.registerTool(
    "wilma_account",
    {
      title: "Wilma account status",
      description:
        "Which Wilma logins are connected and which children each one has. Families with children on different Wilmas can connect several (wilma_login adds another).",
      inputSchema: {},
      annotations: { title: "Wilma account status", ...READ_ONLY },
    },
    async () => {
      const config = await loadConfig();
      const accounts = await resolveAccounts(config);
      if (!accounts.length) return json({ connected: false, hint: "Call wilma_login to connect." });
      return withAccess(async (a) => {
        const students = await a.students();
        return json({
          connected: true,
          source: accounts[0].source,
          wilmas: accounts.map((account, index) => ({
            wilma: account.stored?.tenantName ?? account.profile.baseUrl,
            username: account.profile.username,
            children: students.filter((s) => s.account === index && s.name).map((s) => ({ name: s.name, studentNumber: s.studentNumber })),
          })),
          ...(a.problems.length ? { problems: a.problems } : {}),
        });
      });
    }
  );

  server.registerTool(
    "wilma_find_school",
    {
      title: "Find a school's Wilma",
      description:
        "Search Finland's Wilma addresses by city or by school or organisation name. Most city schools share their city's Wilma (big cities don't list each school), while many colleges, private schools and small municipalities' schools have their own. Use it to help the user pick their Wilma, e.g. when setting WILMA_TENANT; several can serve one city, so ask which is theirs.",
      inputSchema: { query: z.string().min(1).describe("City, municipality or school name, e.g. Tampere or Kalevan lukio.") },
      annotations: { title: "Find a school's Wilma", ...READ_ONLY },
    },
    async ({ query }) => {
      const found = await searchTenants(query, 15);
      return json({
        wilmas: found.map((t) => ({ url: t.url, name: t.name })),
        ...(found.length ? {} : { hint: `No Wilma found for "${query}". Many schools use their city's Wilma: try the city or municipality the school is in.` }),
      });
    }
  );

  server.registerTool(
    "wilma_login",
    {
      title: "Log in to Wilma",
      description:
        "Open a login page in the user's browser to connect a Wilma account, or add another one (for a child at a school with a different Wilma). The password is entered on that page, never in the chat.",
      inputSchema: {},
      annotations: { title: "Log in to Wilma", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => startBrowserLogin(true)
  );

  return server;
}

export async function runMcpServer(version: string): Promise<void> {
  // stdout carries JSON-RPC; route any stray logging to stderr.
  console.log = (...args: unknown[]) => console.error(...args);
  console.info = (...args: unknown[]) => console.error(...args);
  // Share saved sessions with the CLI: no login per process, no extra codes.
  useSessionStore(fileSessionStore);
  // Checked once a day at most; npx already runs the newest version.
  if (updateChecksEnabled()) updateCheck = startUpdateCheck();
  const server = createWilmaMcpServer(version);
  await server.connect(new StdioServerTransport());
}
