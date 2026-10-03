// Metadata, registration and token endpoints are public OAuth endpoints that
// browser-based MCP clients also call, so they allow any origin. The login
// endpoint does not (it checks Origin itself).
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
};

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
