import { CORS_HEADERS, preflight } from "../../../../lib/cors";
import { SCOPE, jsonResponse, originOf } from "../../../../lib/oauth";

// RFC 9728. Served at both /.well-known/oauth-protected-resource and the
// path-suffixed /.well-known/oauth-protected-resource/mcp.
export function GET(req: Request) {
  const origin = originOf(req);
  return jsonResponse(
    {
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      scopes_supported: [SCOPE],
      bearer_methods_supported: ["header"],
      resource_name: "WilmAI",
      resource_documentation: "https://wilm.ai",
    },
    200,
    CORS_HEADERS
  );
}

export const OPTIONS = preflight;
