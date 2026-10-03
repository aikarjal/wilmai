import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/*
 * Stateless sealed tokens. The relay keeps no database: a parent's Wilma
 * login exists only inside AES-256-GCM sealed OAuth codes and tokens, which
 * the AI app (Claude, ChatGPT) holds. The relay unseals a token in memory for
 * each request and never writes or logs it. Rotating RELAY_SECRET revokes
 * every token at once.
 */

export type TokenKind = "client" | "req" | "pending" | "code" | "access" | "refresh";

const VERSION = 1;

function key(): Buffer {
  const secret = process.env.RELAY_SECRET ?? "";
  if (secret.length < 32) {
    throw new Error("RELAY_SECRET must be set to at least 32 characters");
  }
  return createHash("sha256").update(`wilmai-relay-v${VERSION}|${secret}`).digest();
}

export function seal(kind: TokenKind, payload: object): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  // The kind is authenticated, so one token type can't be replayed as another.
  cipher.setAAD(Buffer.from(kind));
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, body, cipher.getAuthTag()]).toString("base64url");
}

/** Returns null for anything tampered, expired, of the wrong kind, or sealed with another secret. */
export function unseal<T extends { exp?: number }>(kind: TokenKind, token: string | null | undefined): T | null {
  if (!token || token.length > 8192) return null;
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 1 + 12 + 16 || raw[0] !== VERSION) return null;
    const iv = raw.subarray(1, 13);
    const tag = raw.subarray(raw.length - 16);
    const body = raw.subarray(13, raw.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAAD(Buffer.from(kind));
    decipher.setAuthTag(tag);
    const payload = JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8")) as T;
    if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export const now = () => Math.floor(Date.now() / 1000);
