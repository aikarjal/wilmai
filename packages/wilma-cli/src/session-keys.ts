import { createHash } from "node:crypto";

/*
 * The key a login's session is saved under in wilmai-sessions.json, shared by
 * the CLI, the MCP server and WilmAI Home (which computes the same keys).
 *
 * - v1, file and environment logins (as always): SHA-256 of the address,
 *   username and password, so a changed password starts a fresh session.
 * - v2, every login over time: SHA-256 of "wilmai-session-v2", the address
 *   and the username. No password: the session is found without reading a
 *   keychain, and the file holds nothing derived from the password.
 */

const address = (baseUrl: string) => baseUrl.replace(/\/$/, "");

export function sessionKeyV1(baseUrl: string, username: string, password: string): string {
  return createHash("sha256").update(`${address(baseUrl)}\n${username.toLowerCase()}\n${password}`).digest("hex");
}

export function sessionKeyV2(baseUrl: string, username: string): string {
  return createHash("sha256").update(`wilmai-session-v2\n${address(baseUrl)}\n${username.toLowerCase()}`).digest("hex");
}

/**
 * Where a login's session lives: the session-file keys it is saved under (all
 * of them) and looked up under (the newest entry wins), and the key of its
 * client in a process's pool.
 *
 * The labels overlap while v1 is retired (docs/secret-store.md, the plan):
 * file and environment logins use v2 and v1, so programs that only know v1
 * (CLI 2.4.0 and older, an old Claude Desktop extension, Home 0.3.1 and older)
 * keep sharing their session; keychain logins use v2 only.
 */
export interface SessionKeys {
  sessionKeys: string[];
  /** In-memory only: v1 for a file login (a new password makes a new client), v2 plus the credentials stamp for a keychain login. */
  poolKey: string;
}

export function fileLoginKeys(baseUrl: string, username: string, password: string): SessionKeys {
  const v1 = sessionKeyV1(baseUrl, username, password);
  return { sessionKeys: [sessionKeyV2(baseUrl, username), v1], poolKey: v1 };
}

export function keychainLoginKeys(baseUrl: string, username: string, credentialsStamp: string | null | undefined): SessionKeys {
  const v2 = sessionKeyV2(baseUrl, username);
  return { sessionKeys: [v2], poolKey: `${v2}|${credentialsStamp ?? ""}` };
}
