import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { getConfigPath } from "./config.js";

/*
 * "A newer WilmAI is available." The CLI prints it on stderr at most once a day
 * (people in a terminal and agents like OpenClaw both read it there); the MCP
 * server adds it once to a tool result so the assistant can tell the user. How
 * to update depends on how WilmAI was installed.
 */

const VERSION_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * - npm: installed with npm (`wilma update` updates it)
 * - claude-desktop: the Claude Desktop extension (a new .mcpb file updates it)
 * - npx: run through npx, which already fetches the newest version, so no notice
 */
export type InstallKind = "npm" | "claude-desktop" | "npx";

export function installKind(
  env: NodeJS.ProcessEnv = process.env,
  scriptPath = fileURLToPath(import.meta.url)
): InstallKind {
  // Set in the extension's manifest (mcpb/manifest.base.json).
  if (env.WILMAI_INSTALL === "claude-desktop") return "claude-desktop";
  if (scriptPath.includes(`${sep}_npx${sep}`)) return "npx";
  return "npm";
}

export function updateChecksEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.WILMAI_NO_UPDATE_CHECK !== "1" && installKind(env) !== "npx";
}

export function isNewerVersion(latest: string, current: string): boolean {
  const latestParts = latest.split(".").map(Number);
  const currentParts = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const l = latestParts[i] ?? 0;
    const c = currentParts[i] ?? 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

/** The CLI's notice, for a person or an agent reading stderr. */
/** Release notes: a wilm.ai redirect, so the target can move without a CLI release. */
export const CHANGES_URL = "https://wilm.ai/changes";

export function cliUpdateNotice(current: string, latest: string): string {
  return `Update available: ${current} → ${latest}\nWhat's new: ${CHANGES_URL}\nRun "wilma update" to update.`;
}

/** The note the MCP server adds for the assistant, who passes it on. */
export function mcpUpdateNote(kind: InstallKind, current: string, latest: string): string {
  const how =
    kind === "claude-desktop"
      ? "download https://wilm.ai/get/claude and open the file; Claude Desktop asks to install it"
      : 'run "wilma update" in a terminal';
  return `Update note: WilmAI ${latest} is available (this computer has ${current}; what's new: ${CHANGES_URL}). After answering, tell the user in one sentence that they can update: ${how}.`;
}

interface VersionCache {
  latestVersion: string | null;
  checkedAt: number;
  /** The version the CLI last told the user about, and when. */
  notifiedVersion?: string;
  notifiedAt?: number;
}

function versionCachePath(): string {
  return resolve(dirname(getConfigPath()), "version-check.json");
}

async function readVersionCache(): Promise<VersionCache | null> {
  try {
    return JSON.parse(await readFile(versionCachePath(), "utf-8")) as VersionCache;
  } catch {
    return null;
  }
}

async function writeVersionCache(cache: VersionCache): Promise<void> {
  const path = versionCachePath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(cache), { encoding: "utf-8", mode: 0o600 });
}

export interface UpdateCheck {
  /** The latest version on npm, or null if unknown. */
  result: Promise<string | null>;
  /** Stop a check still in flight, so it never keeps the command running. */
  cancel(): void;
}

/**
 * Ask npm for the latest version at most once a day. A failed check counts as
 * a check too: agents in sandboxes without internet access shouldn't pay for
 * a timeout on every command.
 */
export function startUpdateCheck(): UpdateCheck {
  const controller = new AbortController();
  let cancelled = false;
  const result = (async (): Promise<string | null> => {
    const cache = await readVersionCache();
    if (cache && Date.now() - cache.checkedAt < VERSION_CHECK_INTERVAL_MS) {
      return cache.latestVersion;
    }
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch("https://registry.npmjs.org/@wilm-ai/wilma-cli/latest", { signal: controller.signal });
      const data = response.ok ? ((await response.json()) as { version?: string }) : {};
      const latestVersion = data.version ?? cache?.latestVersion ?? null;
      await writeVersionCache({ ...cache, latestVersion, checkedAt: Date.now() });
      return latestVersion;
    } catch {
      // Cancelled because the command finished: try again next time.
      if (!cancelled) await writeVersionCache({ ...cache, latestVersion: cache?.latestVersion ?? null, checkedAt: Date.now() }).catch(() => {});
      return cache?.latestVersion ?? null;
    } finally {
      clearTimeout(timeout);
    }
  })().catch(() => null);
  return {
    result,
    cancel() {
      cancelled = true;
      controller.abort();
    },
  };
}

/**
 * Whether to show the CLI's notice for `latest` now, and if so, record it: at
 * most once a day, and right away for a version not announced before. An
 * agent's morning run of ten commands should see it once, not ten times.
 */
export async function claimNotice(latest: string, now = Date.now()): Promise<boolean> {
  const cache = await readVersionCache();
  if (cache?.notifiedVersion === latest && now - (cache.notifiedAt ?? 0) < VERSION_CHECK_INTERVAL_MS) return false;
  await writeVersionCache({
    latestVersion: cache?.latestVersion ?? latest,
    checkedAt: cache?.checkedAt ?? now,
    notifiedVersion: latest,
    notifiedAt: now,
  });
  return true;
}

/** The latest version if the check has an answer within `waitMs`, else null. */
export async function latestWithin(check: UpdateCheck, waitMs: number): Promise<string | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      check.result,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), waitMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
