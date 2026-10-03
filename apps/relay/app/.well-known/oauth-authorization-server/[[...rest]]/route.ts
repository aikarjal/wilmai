import { CORS_HEADERS, preflight } from "../../../../lib/cors";
import { SCOPE, jsonResponse, originOf } from "../../../../lib/oauth";

// RFC 8414 authorization server metadata.
export function GET(req: Request) {
  const origin = originOf(req);
  return jsonResponse(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/authorize`,
      token_endpoint: `${origin}/token`,
      registration_endpoint: `${origin}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [SCOPE],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    },
    200,
    CORS_HEADERS
  );
}

export const OPTIONS = preflight;
