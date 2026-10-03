import { randomBytes } from "node:crypto";
import { REQUEST_TTL, SCOPE, describeRedirect, originOf, redirectUriMatches, resolveClient, type SealedRequest } from "../../lib/oauth";
import { now, seal } from "../../lib/seal";
import { renderLoginPage } from "../../lib/wilma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVACY = {
  en: "This is WilmAI's hosted connection, in private testing. Your login is checked with your school's Wilma and then sealed (encrypted) into the access token your AI app keeps. The relay stores nothing — no database, no logs of your login or school data.",
  fi: "Tämä on WilmAI:n verkkoyhteys, yksityisessä testauksessa. Tunnuksesi tarkistetaan koulusi Wilmasta ja salataan sitten käyttöoikeustunnisteeseen, jota tekoälysovelluksesi säilyttää. Välityspalvelin ei tallenna mitään — ei tietokantaa, ei lokeja tunnuksistasi tai koulun tiedoista.",
};

function errorPage(message: string, status = 400): Response {
  const safe = message.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>WilmAI</title><body style="font-family:system-ui,sans-serif;max-width:480px;margin:48px auto;padding:0 16px"><h1>WilmAI</h1><p>${safe}</p></body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  );
}

function redirectWithError(redirectUri: string, state: string | null, error: string, description: string, origin: string) {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  url.searchParams.set("iss", origin);
  return Response.redirect(url.toString(), 302);
}

// OAuth 2.1 authorization endpoint: shows the Wilma login page.
export async function GET(req: Request) {
  const origin = originOf(req);
  const params = new URL(req.url).searchParams;
  const clientId = params.get("client_id") ?? "";
  const client = clientId ? await resolveClient(clientId) : null;
  if (!client) return errorPage("Unknown client. Start the connection again from your AI app.");

  let redirectUri = params.get("redirect_uri");
  const redirectExplicit = redirectUri !== null;
  if (!redirectUri && client.redirectUris.length === 1) redirectUri = client.redirectUris[0];
  if (!redirectUri || !client.redirectUris.some((registered) => redirectUriMatches(registered, redirectUri!))) {
    return errorPage("This redirect address isn't registered for the client.");
  }

  // From here on, errors go back to the client.
  const state = params.get("state");
  if (params.get("response_type") !== "code") {
    return redirectWithError(redirectUri, state, "unsupported_response_type", "Only response_type=code is supported", origin);
  }
  const challenge = params.get("code_challenge") ?? "";
  if (params.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
    return redirectWithError(redirectUri, state, "invalid_request", "PKCE with S256 is required", origin);
  }
  const resource = params.get("resource");
  if (resource && resource.replace(/\/$/, "") !== `${origin}/mcp`) {
    return redirectWithError(redirectUri, state, "invalid_target", "Unknown resource", origin);
  }

  const request: SealedRequest = {
    cid: clientId,
    ru: redirectUri,
    rx: redirectExplicit,
    st: state ?? undefined,
    cc: challenge,
    sc: params.get("scope") ?? SCOPE,
    exp: now() + REQUEST_TTL,
  };
  const nonce = randomBytes(16).toString("base64");
  const html = renderLoginPage({
    nonce,
    apiBase: "/authorize",
    privacy: PRIVACY,
    extra: { request: seal("req", request) },
    finishLabel: { en: "Continue", fi: "Jatka" },
    // Consent: say which app is asking and where the parent will be sent back.
    notice: {
      en: `Connecting WilmAI to ${client.name ?? "an app"}. After logging in you'll be sent back to ${describeRedirect(redirectUri)}.`,
      fi: `Yhdistetään WilmAI sovellukseen ${client.name ?? "(nimetön sovellus)"}. Kirjautumisen jälkeen palaat osoitteeseen ${describeRedirect(redirectUri)}.`,
    },
  });
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": [
        "default-src 'none'",
        `script-src 'nonce-${nonce}'`,
        `style-src 'nonce-${nonce}'`,
        "connect-src 'self'",
        "img-src 'self' data:",
        "form-action 'none'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
      ].join("; "),
    },
  });
}
