import { createHmac } from "node:crypto";

/** Accept either a bare base32 key or an otpauth:// URI and return the base32 key. */
export function parseTotpSecret(raw: string): string {
  const value = raw.trim();
  if (value.startsWith("otpauth://")) {
    const url = new URL(value);
    const secret = url.searchParams.get("secret");
    if (!secret) {
      throw new Error("No 'secret' parameter found in otpauth:// URI.");
    }
    return secret;
  }
  return value.replace(/[\s-]/g, "");
}

export const TOTP_PERIOD_MS = 30_000;

/** The 30-second time step a moment falls in. */
export function totpCounter(timeMs: number = Date.now()): number {
  return Math.floor(timeMs / TOTP_PERIOD_MS);
}

export function generateTOTP(secret: string, timeMs: number = Date.now()): string {
  // TOTP: RFC 6238 — HMAC-SHA1 based, 6-digit, 30-second period
  const base32Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  // Decode base32 secret
  const cleanSecret = secret.replace(/[\s=-]+/g, "").toUpperCase();
  let bits = "";
  for (const c of cleanSecret) {
    const val = base32Chars.indexOf(c);
    if (val === -1) throw new Error(`Invalid base32 character: ${c}`);
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }

  const counter = totpCounter(timeMs);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter >>> 0, 4);

  const hmac = createHmac("sha1", Buffer.from(bytes));
  hmac.update(counterBuf);
  const hash = hmac.digest();

  const offset = hash[hash.length - 1] & 0x0f;
  const code =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);

  return (code % 1000000).toString().padStart(6, "0");
}
