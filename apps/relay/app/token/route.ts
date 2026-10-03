import { CORS_HEADERS, preflight } from "../../lib/cors";
import { issueTokens, jsonResponse, oauthError, pkceMatches, type SealedCode, type SealedToken } from "../../lib/oauth";
import { createHash } from "node:crypto";
import { unseal } from "../../lib/seal";

// Authorization codes are single-use. The relay has no database, so this is a
// best-effort guard per server instance; codes also expire after 5 minutes and
// are useless without the client's PKCE verifier.
const usedCodes = new Map<string, number>();
function markCodeUsed(code: string, exp: number): boolean {
  const nowSec = Math.floor(Date.now() / 1000);
  for (const [key, expiry] of usedCodes) if (expiry < nowSec) usedCodes.delete(key);
  const key = createHash("sha256").update(code).digest("base64url");
  if (usedCodes.has(key)) return false;
  usedCodes.set(key, exp);
  return true;
}

export const runtime = "nodejs";

// OAuth 2.1 token endpoint for public clients (PKCE, no client secret).
export async function POST(req: Request) {
  const form = new URLSearchParams(await req.text());
  const grant = form.get("grant_type");
  const clientId = form.get("client_id");
  const withCors = (res: Response) => {
    for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
    return res;
  };

  if (grant === "authorization_code") {
    const code = unseal<SealedCode>("code", form.get("code"));
    if (!code) return withCors(oauthError("invalid_grant", "Authorization code is invalid or expired"));
    if (clientId && clientId !== code.cid) return withCors(oauthError("invalid_grant", "Code was issued to another client"));
    // redirect_uri must be repeated exactly if the authorization request had one (RFC 6749 §4.1.3).
    const redirectUri = form.get("redirect_uri");
    if (redirectUri !== null ? redirectUri !== code.ru : code.rx !== false) {
      return withCors(oauthError("invalid_grant", "redirect_uri does not match"));
    }
    if (!pkceMatches(form.get("code_verifier") ?? "", code.cc)) {
      return withCors(oauthError("invalid_grant", "PKCE verification failed"));
    }
    if (!markCodeUsed(form.get("code")!, code.exp)) {
      return withCors(oauthError("invalid_grant", "Authorization code was already used"));
    }
    return withCors(jsonResponse(issueTokens(code.cs, code.cid, code.sc)));
  }

  if (grant === "refresh_token") {
    const refresh = unseal<SealedToken>("refresh", form.get("refresh_token"));
    if (!refresh) return withCors(oauthError("invalid_grant", "Refresh token is invalid or expired"));
    if (clientId && clientId !== refresh.cid) return withCors(oauthError("invalid_grant", "Token was issued to another client"));
    return withCors(jsonResponse(issueTokens(refresh.cs, refresh.cid, refresh.sc)));
  }

  return withCors(oauthError("unsupported_grant_type", "Use authorization_code or refresh_token"));
}

export const OPTIONS = preflight;
