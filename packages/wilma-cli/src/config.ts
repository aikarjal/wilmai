import { mkdir, readFile, rename, writeFile, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";

export interface StoredProfile {
  id: string;
  tenantUrl: string;
  tenantName?: string | null;
  username: string;
  passwordObfuscated: string;
  totpSecretObfuscated?: string | null;
  students?: { studentNumber: string; name: string }[];
  lastStudentNumber?: string | null;
  lastStudentName?: string | null;
  lastUsedAt: string;
}

export interface CliConfig {
  profiles: StoredProfile[];
  lastProfileId?: string | null;
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
  try {
    const raw = await readFile(path, "utf-8");
    const data = JSON.parse(raw) as CliConfig;
    if (!data.profiles) {
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
  } catch {
    return { profiles: [] };
  }
}

export async function saveConfig(config: CliConfig): Promise<void> {
  const path = getConfigPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // Write to a temp file and rename, so a concurrent reader never sees a half-written file.
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(config, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 });
  await rename(tmp, path);
}

export async function clearConfig(): Promise<void> {
  const path = getConfigPath();
  await rm(path, { force: true });
}

export function obfuscateSecret(value: string): string {
  return Buffer.from(SALT + value, "utf-8").toString("base64");
}

export function revealSecret(value: string): string | null {
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
