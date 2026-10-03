/*
 * Fetching files that school bulletins link to on other sites.
 *
 * Bulletin links are written by school staff (or by whoever controls a staff
 * account), and this code also runs on a hosted relay. So external fetches:
 *  - never carry Wilma credentials (an isolated, empty cookie jar per fetch),
 *  - only go to public internet addresses on ports 80/443: private, loopback,
 *    link-local and other special ranges are refused at every redirect hop and
 *    again at connect time, after DNS resolution (which also stops DNS
 *    rebinding),
 *  - fail when the site stops sending for a while (an idle timeout, so a big
 *    file on a slow connection still finishes).
 */
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";
import { CookieJar } from "tough-cookie";
import { Agent, fetch, Headers, type Response } from "undici";
import { APIError } from "./session.js";
import { NetworkError } from "./network-error.js";
import { IdleTimer, asNetworkError, watchBody } from "./timeouts.js";

/** How long a download may stall (before answering, or mid-file) before it fails. */
export const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 10;

const EXTERNAL_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36";

const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, cloud metadata services
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
] as const) {
  blocked.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const) {
  blocked.addSubnet(network, prefix, "ipv6");
}

/** Tests serve "external" files from 127.0.0.1; nothing else should set this. */
function privateNetworkAllowed(): boolean {
  return process.env.WILMAI_ALLOW_PRIVATE_NETWORK === "1";
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family === 6) {
    const words = ipv6Words(address);
    if (!words) return true;
    const zero = (from: number, to: number) => words.slice(from, to).every((w) => w === 0);
    const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
    // IPv6 forms that carry an IPv4 address: judge them by that address.
    if (zero(0, 5) && words[5] === 0xffff) return blocked.check(v4(words[6], words[7]), "ipv4"); // ::ffff:a.b.c.d
    if (zero(0, 4) && words[4] === 0xffff && words[5] === 0) return blocked.check(v4(words[6], words[7]), "ipv4"); // ::ffff:0:a.b.c.d
    if (zero(0, 6)) return blocked.check(v4(words[6], words[7]), "ipv4"); // ::a.b.c.d (and :: / ::1)
    if (words[0] === 0x64 && words[1] === 0xff9b && zero(2, 6)) return blocked.check(v4(words[6], words[7]), "ipv4"); // NAT64
    if (words[0] === 0x2002) return blocked.check(v4(words[1], words[2]), "ipv4"); // 6to4
    // Local-use NAT64 (64:ff9b:1::/48) and Teredo (2001::/32) map to addresses we can't check.
    if ((words[0] === 0x64 && words[1] === 0xff9b && words[2] === 1) || (words[0] === 0x2001 && words[1] === 0)) return true;
    return blocked.check(address, "ipv6");
  }
  return false;
}

/** The eight 16-bit words of an IPv6 address (null if it can't be read). */
function ipv6Words(address: string): number[] | null {
  let text = address.toLowerCase().split("%")[0];
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    text = text.slice(0, dotted.index) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const words = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail].map((w) => parseInt(w, 16));
  return words.every((w) => Number.isInteger(w) && w >= 0 && w <= 0xffff) ? words : null;
}

/** Refuse URLs that point at private or special addresses, or at unusual ports. */
export function assertPublicUrl(url: URL): void {
  if (privateNetworkAllowed()) return;
  const refuse = () => {
    throw new NetworkError(`WilmAI won't fetch ${url.protocol}//${url.host}: links must point to a public website`, {
      code: "BLOCKED_ADDRESS",
      origin: url.origin,
    });
  };
  if (url.protocol !== "https:" && url.protocol !== "http:") refuse();
  if (url.port && url.port !== "80" && url.port !== "443") refuse();
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) refuse();
  // IP literals skip DNS, so check them here (the URL parser has already turned
  // forms like "2130706433" into dotted notation).
  if (isIP(host) && isBlockedAddress(host)) refuse();
}

// Checks the addresses a host name resolves to, at connect time.
function guardedLookup(
  hostname: string,
  options: { all?: boolean; family?: number },
  callback: (err: NodeJS.ErrnoException | null, address?: string | LookupAddress[], family?: number) => void
): void {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = addresses as LookupAddress[];
    if (!privateNetworkAllowed() && list.some((entry) => isBlockedAddress(entry.address))) {
      const blockedErr: NodeJS.ErrnoException = new Error(`${hostname} resolves to a private address`);
      blockedErr.code = "BLOCKED_ADDRESS";
      return callback(blockedErr);
    }
    if (options?.all) return callback(null, list);
    return callback(null, list[0]?.address, list[0]?.family);
  });
}

const guardedAgent = new Agent({ connect: { lookup: guardedLookup as never } });

export function isHtmlResponse(response: { headers: { get(name: string): string | null } }): boolean {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  return contentType.startsWith("text/html") || contentType.startsWith("application/xhtml");
}

// Some document hosts serve an HTML viewer page for a sharing URL but return
// the file itself when a conventional download parameter is present. These are
// generic retry variants, not provider detection: the original URL is always
// attempted first, and a variant is tried only after an HTML answer.
const DOWNLOAD_PARAM_VARIANTS: Array<[string, string]> = [
  ["download", "1"],
  ["dl", "1"],
];

function buildDownloadCandidates(rawUrl: string): URL[] {
  const original = new URL(rawUrl);
  const candidates = [original];
  for (const [param, value] of DOWNLOAD_PARAM_VARIANTS) {
    if (!original.searchParams.has(param)) {
      const variant = new URL(original.href);
      variant.searchParams.set(param, value);
      candidates.push(variant);
    }
  }
  return candidates;
}

/**
 * Fetch an external URL the way a signed-out browser would: an isolated
 * in-memory cookie jar, redirects followed across hosts, and no Wilma
 * credentials anywhere. Returns null when every candidate answered with an
 * HTML page instead of a file; throws for HTTP errors and refused addresses.
 */
export async function fetchExternalFile(rawUrl: string): Promise<Response | null> {
  let failedStatus: number | null = null;
  for (const candidate of buildDownloadCandidates(rawUrl)) {
    const response = await fetchFollowingRedirects(candidate);
    if (!response) {
      continue;
    }
    if (!response.ok) {
      failedStatus ??= response.status;
      await response.body?.cancel();
      continue;
    }
    if (isHtmlResponse(response)) {
      await response.body?.cancel();
      continue;
    }
    return response;
  }
  if (failedStatus !== null) {
    throw new APIError(`The linked site answered HTTP ${failedStatus}`, failedStatus);
  }
  return null;
}

async function fetchFollowingRedirects(initialUrl: URL): Promise<Response | null> {
  const cookieJar = new CookieJar();
  const idle = new IdleTimer(DOWNLOAD_TIMEOUT_MS);
  let currentUrl = initialUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    try {
      assertPublicUrl(currentUrl);
    } catch (err) {
      idle.stop();
      throw err;
    }
    const headers = new Headers({
      "User-Agent": EXTERNAL_USER_AGENT,
      "Accept": "*/*",
    });
    const cookieHeader = cookieJar.getCookieStringSync(currentUrl.href);
    if (cookieHeader) {
      headers.set("Cookie", cookieHeader);
    }

    let response: Response;
    try {
      idle.touch();
      response = await fetch(currentUrl, {
        headers,
        redirect: "manual",
        signal: idle.signal,
        dispatcher: privateNetworkAllowed() ? undefined : guardedAgent,
      });
    } catch (err) {
      idle.stop();
      const cause = (err as { cause?: { code?: string } }).cause;
      if (cause?.code === "BLOCKED_ADDRESS") {
        throw new NetworkError(`WilmAI won't fetch ${currentUrl.host}: it points to a private address`, {
          code: "BLOCKED_ADDRESS",
          origin: currentUrl.origin,
          cause: err,
        });
      }
      throw asNetworkError(err, currentUrl.origin);
    }
    const setCookies = (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    for (const cookie of setCookies) {
      cookieJar.setCookieSync(cookie, currentUrl.href, { ignoreError: true });
    }
    if (!setCookies.length) {
      const cookie = response.headers.get("set-cookie");
      if (cookie) cookieJar.setCookieSync(cookie, currentUrl.href, { ignoreError: true });
    }

    if (response.status < 300 || response.status >= 400) {
      return watchBody(response, idle, currentUrl.origin);
    }
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) {
      idle.stop();
      return null;
    }
    const nextUrl = new URL(location, currentUrl);
    if (nextUrl.protocol !== "https:" && nextUrl.protocol !== "http:") {
      idle.stop();
      return null;
    }
    currentUrl = nextUrl;
  }
  idle.stop();
  throw new Error("External resource exceeded the redirect limit");
}
