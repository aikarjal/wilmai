import { createHash } from "node:crypto";

/*
 * The key a login's session is saved under in wilmai-sessions.json, shared by
 * the CLI, the MCP server and WilmAI Home (which computes the same keys).
 *
 * - v1, file and environment logins (as always): SHA-256 of the address,
 *   username and password, so a changed password starts a fresh session.
 * - v2, keychain logins: SHA-256 of "wilmai-session-v2", the address and the
 *   username. No password: the session is found without reading the
 *   keychain, and the file holds nothing derived from the password.
 */

const address = (baseUrl: string) => baseUrl.replace(/\/$/, "");

export function sessionKeyV1(baseUrl: string, username: string, password: string): string {
  return createHash("sha256").update(`${address(baseUrl)}\n${username.toLowerCase()}\n${password}`).digest("hex");
}

export function sessionKeyV2(baseUrl: string, username: string): string {
  return createHash("sha256").update(`wilmai-session-v2\n${address(baseUrl)}\n${username.toLowerCase()}`).digest("hex");
}

/** Where a login's session lives: the session-file key, and the key of its client in a process's pool. */
export interface SessionKeys {
  sessionKey: string;
  /** Differs from sessionKey for keychain logins: the credentials stamp, so a new password makes a new client. */
  poolKey: string;
}

export function fileLoginKeys(baseUrl: string, username: string, password: string): SessionKeys {
  const key = sessionKeyV1(baseUrl, username, password);
  return { sessionKey: key, poolKey: key };
}

export function keychainLoginKeys(baseUrl: string, username: string, credentialsStamp: string | null | undefined): SessionKeys {
  const key = sessionKeyV2(baseUrl, username);
  return { sessionKey: key, poolKey: `${key}|${credentialsStamp ?? ""}` };
}
