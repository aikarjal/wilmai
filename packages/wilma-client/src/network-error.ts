/**
 * Classification of network-level request failures.
 *
 * `fetch` rejects with an opaque `TypeError: fetch failed` and puts the real
 * reason on `error.cause`. Reporting only `error.message` therefore tells the
 * user nothing at all — the most common real cause, a TLS-intercepting proxy on
 * the network, is indistinguishable from being offline.
 *
 * This module walks the cause chain, extracts the underlying code, and pairs it
 * with actionable remediation text.
 */

/** A request that never produced an HTTP response (DNS, TCP or TLS failure). */
export class NetworkError extends Error {
  /** Underlying cause code, e.g. `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`. */
  readonly code?: string;
  /** Multi-line remediation text, when the cause is recognised. */
  readonly hint?: string;
  /** Origin that failed (scheme and host only — never a path). */
  readonly origin?: string;

  constructor(
    message: string,
    options: { code?: string; hint?: string; origin?: string; cause?: unknown } = {}
  ) {
    super(message, { cause: options.cause });
    this.name = "NetworkError";
    this.code = options.code;
    this.hint = options.hint;
    this.origin = options.origin;
  }
}

/**
 * Certificate-chain failures. Every one of these means "Node could not build a
 * trust path", which on a managed device almost always means TLS interception.
 */
const TLS_TRUST_CODES = new Set([
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_UNTRUSTED",
]);

const DNS_CODES = new Set(["ENOTFOUND", "EAI_AGAIN"]);

const TIMEOUT_CODES = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "ETIMEDOUT",
]);

function tlsTrustHint(): string {
  return [
    "The network appears to intercept TLS traffic (\"break-and-inspect\"), re-signing",
    "certificates with a private root CA. This is common on managed devices behind a",
    "corporate secure web gateway. Node ships its own CA bundle and ignores the",
    "operating system trust store, so a root your browser already trusts is invisible",
    "to Node.",
    "",
    "Fix, in order of preference:",
    "  1. Node >=22.19 / >=24.6   NODE_USE_SYSTEM_CA=1 wilma <command>",
    "  2. Node >=22.15            node --use-system-ca \"$(command -v wilma)\" <command>",
    "  3. Trust the root directly NODE_EXTRA_CA_CERTS=/path/to/root-ca.pem wilma <command>",
    "",
    "Do not set NODE_TLS_REJECT_UNAUTHORIZED=0. It disables certificate verification",
    "entirely, on a network that is already inspecting your traffic.",
  ].join("\n");
}

/** Human-readable summary plus remediation for a known cause code. */
export function describeNetworkCode(
  code: string | undefined,
  origin?: string
): { summary: string; hint?: string } {
  const where = origin ? ` for ${origin}` : "";

  if (code && TLS_TRUST_CODES.has(code)) {
    return {
      summary: `TLS certificate verification failed${where} (${code})`,
      hint: tlsTrustHint(),
    };
  }

  if (code === "CERT_HAS_EXPIRED") {
    return {
      summary: `The certificate presented${where} has expired (${code})`,
      hint: [
        "Check the system clock first — a clock that is wrong by days will produce this.",
        "If the clock is correct, a TLS-intercepting proxy on the network may be",
        "presenting a stale certificate.",
      ].join("\n"),
    };
  }

  if (code === "ERR_TLS_CERT_ALTNAME_INVALID") {
    return {
      summary: `The certificate presented${where} does not match that hostname (${code})`,
      hint: [
        "Check that the tenant URL is correct. A TLS-intercepting proxy can also cause",
        "this if it re-signs with a certificate issued for a different name.",
      ].join("\n"),
    };
  }

  if (code && DNS_CODES.has(code)) {
    return {
      summary: `Could not resolve the Wilma host${where} (${code})`,
      hint: [
        "Check the tenant URL and that you are online. On a VPN or split-tunnel network",
        "the host may only resolve while connected.",
      ].join("\n"),
    };
  }

  if (code === "ECONNREFUSED") {
    return {
      summary: `Connection refused${where} (${code})`,
      hint: "The host may be down, or a local firewall or proxy may be blocking the request.",
    };
  }

  if (code && TIMEOUT_CODES.has(code)) {
    return {
      summary: `Connection timed out${where} (${code})`,
      hint: "Check your network. A proxy or firewall may be silently dropping the request.",
    };
  }

  if (code === "ECONNRESET") {
    return {
      summary: `Connection reset${where} (${code})`,
      hint: "This is often a proxy or firewall interrupting the request.",
    };
  }

  // Unrecognised: still surface the code rather than swallowing it.
  return {
    summary: code
      ? `Request failed${where} (${code})`
      : `Request failed${where}`,
  };
}

/** Walk the cause chain for the first string `code` property. */
export function extractCauseCode(error: unknown, maxDepth = 5): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < maxDepth && current; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) {
      return code;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * Scheme and host only. Wilma paths embed student numbers, so the full URL must
 * never reach an error message or a log line.
 */
function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

function looksLikeFetchFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message === "fetch failed" || error.name === "TypeError";
}

/**
 * Convert a thrown `fetch` rejection into a `NetworkError` carrying an
 * actionable hint. Anything that is not a transport failure is returned
 * unchanged, so callers can `throw wrapNetworkError(err, url)` safely.
 */
export function wrapNetworkError(error: unknown, url: string): unknown {
  if (error instanceof NetworkError) {
    return error;
  }

  const code = extractCauseCode(error);
  if (!code && !looksLikeFetchFailure(error)) {
    return error;
  }

  const origin = safeOrigin(url);
  const { summary, hint } = describeNetworkCode(code, origin);
  return new NetworkError(summary, { code, hint, origin, cause: error });
}
