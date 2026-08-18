import assert from "node:assert/strict";
import {
  NetworkError,
  describeNetworkCode,
  extractCauseCode,
  wrapNetworkError,
} from "../dist/network-error.js";

const EXAMPLE_URL = "https://example.inschool.fi/!01234567/schedule";

// --- extractCauseCode: the code lives on error.cause, not on the error itself ---

const fetchFailed = new TypeError("fetch failed", {
  cause: Object.assign(new Error("unable to get local issuer certificate"), {
    code: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  }),
});
assert.equal(extractCauseCode(fetchFailed), "UNABLE_TO_GET_ISSUER_CERT_LOCALLY");

// nested one level deeper
const nested = new TypeError("fetch failed", {
  cause: new Error("outer", {
    cause: Object.assign(new Error("inner"), { code: "ECONNRESET" }),
  }),
});
assert.equal(extractCauseCode(nested), "ECONNRESET");

assert.equal(extractCauseCode(new Error("no code anywhere")), undefined);
assert.equal(extractCauseCode(undefined), undefined);

// a self-referencing cause chain must not hang
const cyclic = new Error("cyclic");
cyclic.cause = cyclic;
assert.equal(extractCauseCode(cyclic), undefined);

// --- describeNetworkCode: every trust-chain code gets the interception hint ---

for (const code of [
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_UNTRUSTED",
]) {
  const { summary, hint } = describeNetworkCode(code, "https://example.inschool.fi");
  assert.ok(summary.includes(code), `summary should name the code: ${code}`);
  assert.ok(hint, `expected a hint for ${code}`);
  assert.ok(hint.includes("NODE_USE_SYSTEM_CA=1"), "hint offers the env var first");
  assert.ok(hint.includes("--use-system-ca"), "hint offers the flag fallback");
  assert.ok(hint.includes("NODE_EXTRA_CA_CERTS"), "hint offers the explicit-root fallback");
  assert.ok(
    hint.includes("Do not set NODE_TLS_REJECT_UNAUTHORIZED=0"),
    "hint must warn against disabling verification"
  );
}

// distinct causes get distinct guidance, not the interception boilerplate
const expired = describeNetworkCode("CERT_HAS_EXPIRED");
assert.ok(expired.hint.includes("system clock"));
assert.ok(!expired.hint.includes("NODE_USE_SYSTEM_CA"));

const altname = describeNetworkCode("ERR_TLS_CERT_ALTNAME_INVALID");
assert.ok(altname.hint.includes("tenant URL"));

for (const code of ["ENOTFOUND", "EAI_AGAIN"]) {
  assert.ok(describeNetworkCode(code).hint.includes("online"));
}
assert.ok(describeNetworkCode("ECONNREFUSED").hint.includes("firewall"));
for (const code of ["UND_ERR_CONNECT_TIMEOUT", "ETIMEDOUT"]) {
  assert.ok(describeNetworkCode(code).summary.includes("timed out"));
}

// unknown code: surfaced, never swallowed, and no invented advice
const unknown = describeNetworkCode("SOME_NEW_CODE");
assert.ok(unknown.summary.includes("SOME_NEW_CODE"));
assert.equal(unknown.hint, undefined);

// no code at all
assert.equal(describeNetworkCode(undefined).hint, undefined);

// --- wrapNetworkError ---

const wrapped = wrapNetworkError(fetchFailed, EXAMPLE_URL);
assert.ok(wrapped instanceof NetworkError);
assert.equal(wrapped.code, "UNABLE_TO_GET_ISSUER_CERT_LOCALLY");
assert.equal(wrapped.name, "NetworkError");
assert.equal(wrapped.cause, fetchFailed, "original error is preserved as cause");
assert.ok(wrapped.message !== "fetch failed", "must not still be the opaque message");

// the URL path embeds a student number, so only the origin may be exposed
assert.equal(wrapped.origin, "https://example.inschool.fi");
assert.ok(!wrapped.message.includes("01234567"), "student number must not leak into the message");
assert.ok(!wrapped.message.includes("/schedule"), "path must not leak into the message");

// non-network errors pass through untouched — no over-capture
const domainError = new Error("Multiple students found");
assert.equal(wrapNetworkError(domainError, EXAMPLE_URL), domainError);

// already-wrapped errors are returned as-is, not double-wrapped
assert.equal(wrapped, wrapNetworkError(wrapped, EXAMPLE_URL));

// an unparseable URL must not throw
const badUrl = wrapNetworkError(fetchFailed, "not-a-url");
assert.ok(badUrl instanceof NetworkError);
assert.equal(badUrl.origin, undefined);

console.log("network-error: all assertions passed");
