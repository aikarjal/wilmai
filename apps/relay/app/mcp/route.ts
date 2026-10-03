import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CORS_HEADERS, preflight } from "../../lib/cors";
import { isAllowedUser, originOf, type SealedToken } from "../../lib/oauth";
import { unseal } from "../../lib/seal";
import {
  AuthenticationError,
  INSTRUCTIONS,
  READ_ONLY,
  WilmaAccess,
  isMfaFailure,
  json,
  mfaCallbackFor,
  registerWilmaTools,
  textResult,
} from "../../lib/wilma";

export const runtime = "nodejs";
export const preferredRegion = "arn1";
export const maxDuration = 60;

function unauthorized(origin: string, error?: string): Response {
  const parts = [`resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`];
  if (error) parts.push(`error="${error}"`);
  return new Response(JSON.stringify({ error: error ?? "unauthorized" }), {
    status: 401,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json", "WWW-Authenticate": `Bearer ${parts.join(", ")}` },
  });
}

// Stateless Streamable HTTP MCP endpoint. Each request carries the sealed
// login in its bearer token; nothing survives the request.
export async function POST(req: Request) {
  const origin = originOf(req);
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!bearer) return unauthorized(origin);
  const token = unseal<SealedToken>("access", bearer);
  // Every login was allowlist-checked at sign-in; re-check so removing a user takes effect at once.
  const creds = (token?.cs ?? []).filter((c) => isAllowedUser(c.u, c.t));
  if (!token || !creds.length) return unauthorized(origin, "invalid_token");

  const accounts = creds.map((c) => ({
    profile: { baseUrl: c.t, username: c.u, password: c.p },
    mfa: mfaCallbackFor(c.s),
    label: c.n ?? c.t,
  }));

  const server = new McpServer({ name: "wilma", title: "WilmAI", version: "1.7.0" }, { instructions: INSTRUCTIONS });
  registerWilmaTools(server, {
    // Vercel caps a function response at 4.5 MB; base64 adds a third.
    inlineAttachmentLimit: 3 * 1024 * 1024,
    withAccess: async (run) => {
      try {
        return await run(new WilmaAccess(accounts));
      } catch (err) {
        if (isMfaFailure(err)) {
          return textResult(
            "Wilma rejected the two-step verification code. Ask the user to reconnect WilmAI in their AI app's connector settings.",
            true
          );
        }
        if (err instanceof AuthenticationError) {
          return textResult(
            "Wilma rejected the saved login (the password may have changed). Ask the user to reconnect WilmAI in their AI app's connector settings.",
            true
          );
        }
        return textResult(err instanceof Error ? err.message : String(err), true);
      }
    },
  });
  server.registerTool(
    "wilma_account",
    {
      title: "Wilma account status",
      description: "Which Wilma logins are connected and which children each one has.",
      inputSchema: {},
      annotations: { title: "Wilma account status", ...READ_ONLY },
    },
    async () => {
      try {
        const access = new WilmaAccess(accounts);
        const students = await access.students();
        return json({
          connected: true,
          wilmas: creds.map((c, index) => ({
            wilma: c.n ?? c.t,
            username: c.u,
            children: students.filter((s) => s.account === index && s.name).map((s) => ({ name: s.name, studentNumber: s.studentNumber })),
          })),
          ...(access.problems.length ? { problems: access.problems } : {}),
        });
      } catch (err) {
        return textResult(err instanceof Error ? err.message : String(err), true);
      }
    }
  );

  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const res = await transport.handleRequest(req);
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
}

// Stateless server: no standalone SSE stream and no sessions to delete.
export function GET() {
  return new Response("Method Not Allowed", { status: 405, headers: { ...CORS_HEADERS, Allow: "POST" } });
}

export const DELETE = GET;
export const OPTIONS = preflight;
