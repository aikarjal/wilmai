import { CODE_TTL, jsonResponse, originOf, type SealedCode, type SealedRequest } from "../../../lib/oauth";
import { readPending } from "../../../lib/pending";
import { now, seal, unseal } from "../../../lib/seal";

export const runtime = "nodejs";

// The parent pressed Continue: issue one authorization code carrying every
// Wilma login they added, and send them back to their AI app.
export async function POST(req: Request) {
  const origin = originOf(req);
  if (req.headers.get("origin") !== origin || !(req.headers.get("content-type") ?? "").includes("application/json")) {
    return jsonResponse({ status: "error", message: "Forbidden" }, 403);
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ status: "error", message: "Bad request" }, 400);
  }
  const request = unseal<SealedRequest>("req", typeof body.request === "string" ? body.request : null);
  const pending = request ? readPending(body.pending, request) : null;
  if (!request || !pending || !pending.cs.length) {
    return jsonResponse({ status: "error", message: "This login page has expired. Start again from your AI app." }, 400);
  }
  const code: SealedCode = {
    cs: pending.cs,
    cid: request.cid,
    ru: request.ru,
    rx: request.rx,
    cc: request.cc,
    sc: request.sc,
    exp: now() + CODE_TTL,
  };
  const redirect = new URL(request.ru);
  redirect.searchParams.set("code", seal("code", code));
  if (request.st) redirect.searchParams.set("state", request.st);
  redirect.searchParams.set("iss", origin);
  return jsonResponse({ status: "ok", redirect: redirect.toString() });
}
