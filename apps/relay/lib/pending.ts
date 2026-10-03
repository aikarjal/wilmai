import { REQUEST_TTL, type SealedPending, type SealedRequest } from "./oauth";
import { now, unseal } from "./seal";

/** Unseal the logins collected so far on this authorization page, bound to the same request. */
export function readPending(blob: unknown, request: SealedRequest): SealedPending | null {
  const pending = unseal<SealedPending>("pending", typeof blob === "string" ? blob : null);
  if (!pending || pending.cid !== request.cid || pending.ru !== request.ru) return null;
  return pending;
}

export function emptyPending(request: SealedRequest): SealedPending {
  return { cs: [], ac: [], cid: request.cid, ru: request.ru, exp: now() + REQUEST_TTL };
}
