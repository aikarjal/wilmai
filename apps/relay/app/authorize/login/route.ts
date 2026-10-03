import { MAX_LOGINS, REQUEST_TTL, isAllowedUser, jsonResponse, originOf, type SealedPending, type SealedRequest } from "../../../lib/oauth";
import { attemptKeys, clearFailures, recordFailure, tooManyAttempts } from "../../../lib/attempts";
import { emptyPending, readPending } from "../../../lib/pending";
import { now, seal, unseal } from "../../../lib/seal";
import {
  AuthenticationError,
  TotpSecretInvalidError,
  TotpSecretRequiredError,
  findTenant,
  normalizeTenantUrl,
  adoptSession,
  verifyLoginSession,
} from "../../../lib/wilma";

export const runtime = "nodejs";
export const preferredRegion = "arn1";
export const maxDuration = 30;

// Called by the login page. Verifies one Wilma login and adds it to the sealed
// list of logins for this authorization (a family can add several Wilmas).
// The page finishes with /authorize/done, which issues the authorization code.
export async function POST(req: Request) {
  const origin = originOf(req);
  if (req.headers.get("origin") !== origin || !(req.headers.get("content-type") ?? "").includes("application/json")) {
    return jsonResponse({ status: "error", message: "Forbidden" }, 403);
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ status: "error", code: "missing_fields" }, 400);
  }
  const request = unseal<SealedRequest>("req", typeof body.request === "string" ? body.request : null);
  if (!request) {
    return jsonResponse({ status: "error", message: "This login page has expired. Start again from your AI app." }, 400);
  }
  const pending = body.pending ? readPending(body.pending, request) : emptyPending(request);
  if (!pending) {
    return jsonResponse({ status: "error", message: "This login page has expired. Start again from your AI app." }, 400);
  }
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const tenantUrl = str(body.tenantUrl).trim();
  const username = str(body.username).trim();
  const password = str(body.password);
  const totpSecret = str(body.totpSecret).trim() || null;
  if (!username || !password || !tenantUrl) return jsonResponse({ status: "error", code: "missing_fields" }, 400);
  // Only Wilma addresses from the official tenant list, so the relay can't be pointed at other hosts.
  const tenant = findTenant(tenantUrl);
  // Test-only escape hatch for mock Wilmas; never honoured in production builds.
  const anyTenant = process.env.RELAY_ALLOW_ANY_TENANT === "1" && process.env.NODE_ENV !== "production";
  if (!tenant && !anyTenant) {
    return jsonResponse({ status: "error", message: "Pick your school's Wilma from the list." }, 400);
  }

  // Check the allowlist before contacting Wilma, so the relay can't be used to test logins.
  if (!isAllowedUser(username, normalizeTenantUrl(tenantUrl))) return jsonResponse({ status: "error", code: "not_allowed" });

  // Slow down password guessing (and protect the parent's Wilma account from lockout).
  const keys = attemptKeys(req, username);
  if (tooManyAttempts(keys)) return jsonResponse({ status: "error", code: "too_many_attempts" }, 429);

  let students;
  try {
    const verified = await verifyLoginSession({ tenantUrl, username, password, totpSecret });
    students = verified.students;
    clearFailures(keys);
    // This instance usually serves the first tool calls too: keep the session.
    adoptSession({ baseUrl: normalizeTenantUrl(tenantUrl), username, password }, verified.client);
  } catch (err) {
    if (err instanceof TotpSecretRequiredError) return jsonResponse({ status: "mfa_required" });
    if (err instanceof TotpSecretInvalidError) {
      recordFailure(keys);
      return jsonResponse({ status: "error", code: "bad_totp", message: err.message });
    }
    if (err instanceof AuthenticationError) {
      recordFailure(keys);
      return jsonResponse({ status: "error", code: "bad_credentials" });
    }
    return jsonResponse({ status: "error", message: "Could not reach Wilma. Try again in a moment." });
  }

  const baseUrl = normalizeTenantUrl(tenantUrl);
  const wilma = tenant?.name ?? (str(body.tenantName) || baseUrl);
  // Logging in to the same Wilma again replaces that login.
  const same = (c: { t: string; u: string }) => c.t === baseUrl && c.u.toLowerCase() === username.toLowerCase();
  const keep = pending.cs.map((c, i) => ({ c, a: pending.ac[i] })).filter(({ c }) => !same(c));
  if (keep.length >= MAX_LOGINS) {
    return jsonResponse({ status: "error", message: `Up to ${MAX_LOGINS} Wilma logins can be connected at once.` });
  }
  const next: SealedPending = {
    cs: [...keep.map(({ c }) => c), { t: baseUrl, n: wilma, u: username, p: password, s: totpSecret }],
    ac: [...keep.map(({ a }) => a), { wilma, students: students.map((s) => s.name) }],
    cid: request.cid,
    ru: request.ru,
    exp: now() + REQUEST_TTL,
  };
  return jsonResponse({
    status: "ok",
    students: students.map((s) => s.name),
    accounts: next.ac,
    pending: seal("pending", next),
  });
}
