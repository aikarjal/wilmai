import { chmod, mkdir, readFile, rename, stat, writeFile, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";

export interface StoredProfile {
  id: string;
  tenantUrl: string;
  tenantName?: string | null;
  username: string;
  /** Scrambled password: a login kept in this file (absent for a keychain login). */
  passwordObfuscated?: string;
  totpSecretObfuscated?: string | null;
  /** "keychain": the password and authenticator key are in the OS keychain, entry `secretId`. Absent: in this file. */
  secrets?: "keychain" | string;
  /** The login's keychain entry (random; also kept in CliConfig.keychainLogins). */
  secretId?: string;
  /** Random, new whenever the login's secrets change; not secret. Part of a keychain login's pool key. */
  credentialsStamp?: string;
  /** Whether an authenticator key is saved (so listings don't read the keychain). */
  hasTotp?: boolean;
  /** When moving the login to the keychain last failed (background moves wait a day). */
  moveFailedAt?: string;
  /** The children the login lists; `role` says whose login it is for each (a guardian's, or the student's own). */
  students?: SavedStudent[];
  /** Student numbers of children unticked on the login page (a profile Wilma lists twice): not read. */
  hidden?: string[];
  lastStudentNumber?: string | null;
  lastStudentName?: string | null;
  lastUsedAt: string;
}

export interface SavedStudent {
  studentNumber: string;
  name: string;
  role?: "guardian" | "student";
}

/** A child as saved with a login: the number, the name, and the role when Wilma says it. */
export function savedStudent(s: SavedStudent): SavedStudent {
  return { studentNumber: s.studentNumber, name: s.name, ...(s.role ? { role: s.role } : {}) };
}

export interface CliConfig {
  profiles: StoredProfile[];
  lastProfileId?: string | null;
  /** Where new secrets go: "file" (default), "auto" or "keychain" (`wilma config secrets`). */
  secretStore?: string;
  /** Every keychain entry this config made, by login id, written before the entry itself. */
  keychainLogins?: Record<string, string>;
}

const SALT = "wilmai::";

export function getConfigPath(): string {
  const override = process.env.WILMAI_CONFIG_PATH;
  if (override) {
    return resolve(override);
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg ? resolve(xdg) : resolve(homedir(), ".config");
  return resolve(base, "wilmai", "config.json");
}

export async function loadConfig(): Promise<CliConfig> {
  const path = getConfigPath();
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { profiles: [] };
    throw err;
  }
  let data: CliConfig;
  try {
    data = JSON.parse(raw) as CliConfig;
  } catch (err) {
    // Treating a damaged file as empty would overwrite every saved login on the next save.
    throw new Error(
      `The WilmAI config at ${path} isn't valid JSON (${(err as Error).message}). ` +
        "Fix the file, or remove it with `wilma config clear` and log in again."
    );
  }
  await tightenPermissions(path);
  if (!data || !Array.isArray(data.profiles)) {
    return { profiles: [] };
  }
  // Backward-compat: migrate single-student fields if present
  data.profiles = data.profiles.map((p: StoredProfile & { studentNumber?: string | null; studentName?: string | null }) => {
    if (!p.students && p.studentNumber) {
      p.students = [{ studentNumber: p.studentNumber, name: p.studentName ?? p.studentNumber }];
    }
    if (!p.lastStudentNumber && p.studentNumber) {
      p.lastStudentNumber = p.studentNumber;
      p.lastStudentName = p.studentName ?? p.studentNumber;
    }
    if (!p.tenantName) {
      p.tenantName = p.tenantUrl;
    }
    delete (p as { studentNumber?: string | null }).studentNumber;
    delete (p as { studentName?: string | null }).studentName;
    return p as StoredProfile;
  });
  return data;
}

/**
 * The config holds Wilma passwords (encoded, not encrypted), so it should be
 * readable by this user only. Older versions could leave the folder or file
 * open to other users of the computer; fix that when found.
 */
async function tightenPermissions(path: string): Promise<void> {
  if (process.platform === "win32") return;
  const tighten = async (target: string, mode: number) => {
    try {
      if (((await stat(target)).mode & 0o077) !== 0) await chmod(target, mode);
    } catch {
      // Missing, or not ours to fix (owned by another user): leave it.
    }
  };
  await tighten(path, 0o600);
  // Only the default folder: a custom WILMAI_CONFIG_PATH may live in a shared folder.
  if (!process.env.WILMAI_CONFIG_PATH) await tighten(dirname(path), 0o700);
}

export async function saveConfig(config: CliConfig): Promise<void> {
  const path = getConfigPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await tightenPermissions(path);
  // Write to a temp file and rename, so a concurrent reader never sees a half-written file.
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(config, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 });
  await rename(tmp, path);
}

/**
 * Change the saved config from a fresh read, so a save never overwrites what
 * another process wrote meanwhile (moves, logins, refreshed child lists).
 * `edit` returns false to leave the file as it is.
 */
export async function editConfig(edit: (config: CliConfig) => boolean | void | Promise<boolean | void>): Promise<CliConfig> {
  const config = await loadConfig();
  if ((await edit(config)) !== false) await saveConfig(config);
  return config;
}

/** The config as far as it can be read, or null (for `wilma config clear`, the way out of a damaged file). */
export async function loadConfigLenient(): Promise<CliConfig | null> {
  try {
    return await loadConfig();
  } catch {
    return null;
  }
}

export async function clearConfig(): Promise<void> {
  const path = getConfigPath();
  await rm(path, { force: true });
}

export function obfuscateSecret(value: string): string {
  return Buffer.from(SALT + value, "utf-8").toString("base64");
}

export function revealSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const decoded = Buffer.from(value, "base64").toString("utf-8");
    if (!decoded.startsWith(SALT)) {
      return null;
    }
    return decoded.slice(SALT.length);
  } catch {
    return null;
  }
}
