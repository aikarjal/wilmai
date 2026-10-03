import { CORS_HEADERS, preflight } from "../../lib/cors";
import { isAllowedRedirectUri, jsonResponse, oauthError, type SealedClient } from "../../lib/oauth";
import { now, seal } from "../../lib/seal";

// RFC 7591 Dynamic Client Registration without a database: the client_id is
// the sealed registration itself.
export async function POST(req: Request) {
  let body: { redirect_uris?: unknown; client_name?: unknown };
  try {
    body = await req.json();
  } catch {
    return oauthError("invalid_client_metadata", "Body must be JSON");
  }
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  if (!redirectUris.length || redirectUris.length > 10 || !redirectUris.every((u) => typeof u === "string" && isAllowedRedirectUri(u))) {
    return oauthError("invalid_redirect_uri", "redirect_uris must be https URLs (or http on localhost)");
  }
  const name = typeof body.client_name === "string" ? body.client_name.slice(0, 120) : undefined;
  const client: SealedClient = { r: redirectUris as string[], n: name };
  return jsonResponse(
    {
      client_id: seal("client", client),
      client_id_issued_at: now(),
      client_name: name,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    201,
    CORS_HEADERS
  );
}

export const OPTIONS = preflight;
