import { CookieJar, type Cookie } from "tough-cookie";
import { fetch, type RequestInit, type Response } from "undici";
import { IdleTimer, asNetworkError, watchBody } from "./timeouts.js";

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}
export class MfaRequiredError extends Error {
  formkey: string;
  constructor(formkey: string) {
    super("MFA verification required");
    this.name = "MfaRequiredError";
    this.formkey = formkey;
  }
}
export class APIError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "APIError";
    this.status = status;
  }
}

/** How long Wilma may go silent (before answering, or mid-body) before a request fails. */
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 10;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36";
const LOGIN_FAIL_RE = /loginFailed/i;

/**
 * Login state shared by a session and every per-student session made from it.
 * Wilma allows one live session per account — a new login cancels the previous
 * one (its requests then get 403) — so everything shares one login and
 * re-logs in at most once at a time.
 */
interface SessionAuth {
  cookieJar: CookieJar;
  loggedIn: boolean;
  username?: string;
  password?: string;
  onMfa?: (formkey: string) => Promise<string>;
  relogin: Promise<void> | null;
  /** Bumped on every successful login, so a late 401/403 from an older login isn't mistaken for a new problem. */
  generation: number;
  /** Called after every successful login (first or again), e.g. to save the session. */
  onLogin?: () => void;
  /**
   * Set when Wilma refused the saved login itself (its explicit "login
   * failed" answer, or a code is needed and there is no way to make one).
   * Further requests fail at once instead of retrying — repeated failed
   * logins can lock the Wilma account. Outages and other refusals (rate
   * limits, firewalls, maintenance pages) don't set it.
   */
  failed: Error | null;
}

export class WilmaSession {
  private baseUrl: string;
  private auth: SessionAuth;
  private studentNumber?: string | null;
  private debug = false;

  constructor(baseUrl: string, opts?: { studentNumber?: string | null; debug?: boolean }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.auth = { cookieJar: new CookieJar(), loggedIn: false, relogin: null, generation: 0, failed: null };
    this.studentNumber = opts?.studentNumber ?? null;
    this.debug = Boolean(opts?.debug);
  }

  /** The login's cookies, so another process can resume the session (see resumeState). */
  exportState(): string {
    return JSON.stringify(this.auth.cookieJar.serializeSync());
  }

  /**
   * Continue a session saved by exportState() instead of logging in. If Wilma
   * has ended it meanwhile, the first request notices (401/403 or the login
   * page) and logs in again with these credentials. Returns false when the
   * state holds no session to resume.
   */
  resumeState(state: string, username: string, password: string): boolean {
    let jar: CookieJar;
    try {
      jar = CookieJar.deserializeSync(JSON.parse(state));
    } catch {
      return false;
    }
    if (!jar.getCookiesSync(this.baseUrl).some((cookie: Cookie) => cookie.key === "Wilma2SID")) return false;
    this.auth.cookieJar = jar;
    this.auth.loggedIn = true;
    this.auth.generation += 1;
    this.auth.username = username;
    this.auth.password = password;
    return true;
  }

  /** Called after every successful login (first or again). */
  onLogin(callback: (() => void) | undefined): void {
    this.auth.onLogin = callback;
  }

  /** Used to answer the two-step verification challenge when the session has to log in again. */
  setMfaCallback(onMfa?: (formkey: string) => Promise<string>): void {
    this.auth.onMfa = onMfa;
  }

  /**
   * A session for another student on the same account. It shares this
   * session's login (cookies and credentials), so no new login is needed —
   * Wilma picks the student from the "/!<number>/" path prefix.
   */
  forStudent(studentNumber: string | null): WilmaSession {
    const session = new WilmaSession(this.baseUrl, { studentNumber, debug: this.debug });
    session.auth = this.auth;
    return session;
  }

  get urlPrefix(): string | null {
    return this.studentNumber ? `!${this.studentNumber}` : null;
  }

  getPrefixedPath(path: string): string {
    if (this.urlPrefix && !path.startsWith("/!")) {
      if (path.startsWith("/")) {
        return `/${this.urlPrefix}${path}`;
      }
      return `/${this.urlPrefix}/${path}`;
    }
    return path;
  }

  async login(username: string, password: string): Promise<void> {
    if (this.auth.loggedIn) {
      return;
    }

    const loginFields = await this.getLoginFormFields();
    let sessionId = loginFields.SESSIONID;
    if (!sessionId) {
      sessionId = await this.getLoginToken();
    }

    const form = new URLSearchParams({
      ...loginFields,
      Login: username,
      Password: password,
      SESSIONID: sessionId,
    });

    const resp = await this.rawRequest("/login", {
      method: "POST",
      body: form.toString(),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      redirect: "manual",
    });

    const hasSessionCookie = this.auth.cookieJar
      .getCookiesSync(this.baseUrl)
      .some((c: Cookie) => c.key === "Wilma2SID");

    const text = await resp.text();
    const location = resp.headers.get("location") ?? "";

    // Wilma itself failing is temporary — not a verdict on the username and password.
    if (resp.status >= 500) {
      throw new APIError(`Wilma answered HTTP ${resp.status} while logging in`, resp.status);
    }

    // Wilma answers a wrong username or password with a redirect to
    // "?loginfailed" — empty body, no session cookie (older versions: a page
    // saying so).
    if (LOGIN_FAIL_RE.test(location) || (resp.status < 300 && !isLoginOk(text))) {
      throw new AuthenticationError("Wilma login failed");
    }

    // Check for MFA challenge by following the post-login redirect
    if (resp.status >= 300 && resp.status < 400 && hasSessionCookie && location) {
      const next = new URL(location, `${this.baseUrl}/`);
      if (next.origin === new URL(this.baseUrl).origin) {
        const redirectResp = await this.rawRequest(next.pathname + next.search, { method: "GET" });
        const redirectText = await redirectResp.text();
        const mfaFormkeyMatch = /id="mfa-formkey"\s+value="([^"]+)"/.exec(redirectText);
        if (mfaFormkeyMatch) {
          if (this.debug) {
            console.error(`[wilmai] MFA challenge detected`);
          }
          // Store credentials so we can complete login after MFA
          this.auth.username = username;
          this.auth.password = password;
          throw new MfaRequiredError(mfaFormkeyMatch[1]);
        }
      }
    }

    // A redirect counts as a login only with a session cookie: its empty body
    // would otherwise pass the text check, accepting any username and password.
    if (resp.status < 400 && (hasSessionCookie || resp.status < 300)) {
      this.auth.loggedIn = true;
      this.auth.generation += 1;
      this.auth.failed = null;
      this.auth.username = username;
      this.auth.password = password;
      this.auth.onLogin?.();
      return;
    }

    // Not Wilma's "login failed" answer (a rate limit, a firewall, a
    // maintenance page): report it, but don't treat the password as wrong.
    throw new APIError(`Wilma didn't accept the login right now (HTTP ${resp.status})`, resp.status);
  }

  async submitMfaCode(formkey: string, otpCode: string): Promise<void> {
    // Wilma's MFA endpoint: POST /api/v1/accounts/me/mfa/otp/check
    // Body: formkey=<formkey>&payload={"otp":"<code>","action":"login"}
    // No student prefix — MFA is account-level, not student-level
    const path = `/api/v1/accounts/me/mfa/otp/check`;

    const body = new URLSearchParams({
      formkey,
      payload: JSON.stringify({ otp: otpCode, action: "login" }),
    });

    if (this.debug) {
      console.error(`[wilmai] POST ${path} (MFA OTP check)`);
    }

    const resp = await this.rawRequest(path, {
      method: "POST",
      body: body.toString(),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
    });

    // Wilma itself failing says nothing about the code.
    if (resp.status >= 500) {
      await resp.body?.cancel();
      throw new APIError(`Wilma answered HTTP ${resp.status} while checking the code`, resp.status);
    }
    const text = await resp.text();
    let success = false;
    try {
      const data = JSON.parse(text);
      // Response format: { statusCode, payload: { success } } or { success }
      success = data?.payload?.success ?? data?.success ?? false;
    } catch {
      throw new AuthenticationError("MFA verification failed: unexpected response");
    }

    if (!success) {
      throw new AuthenticationError("MFA verification failed: invalid OTP code");
    }

    this.auth.loggedIn = true;
    this.auth.generation += 1;
    this.auth.failed = null;
    this.auth.onLogin?.();
    if (this.debug) {
      console.error(`[wilmai] MFA verification successful`);
    }
  }

  private async getLoginFormFields(): Promise<Record<string, string>> {
    const resp = await this.rawRequest("/login", { method: "GET" });
    if (resp.status >= 500) {
      await resp.body?.cancel();
      throw new APIError(`Wilma answered HTTP ${resp.status} for its login page`, resp.status);
    }
    if (resp.status >= 300 && resp.status < 400) {
      // rawRequest follows redirects within Wilma, so this one leads elsewhere.
      await resp.body?.cancel();
      const target = safeOrigin(resp.headers.get("location"), this.baseUrl);
      throw new APIError(
        `${new URL(this.baseUrl).origin} sends its login page to ${target ?? "another site"}; ` +
          "log in with that Wilma address instead",
        resp.status
      );
    }
    if (resp.status >= 400) {
      await resp.body?.cancel();
      return {};
    }
    const html = await resp.text();
    return parseLoginFormFields(html);
  }

  /**
   * An authenticated request to this Wilma. Follows redirects within Wilma
   * only; a redirect to another site is an error unless `externalRedirect`
   * is "return" (then the 3xx response is handed back, e.g. so a download can
   * continue without Wilma credentials).
   */
  async request(
    path: string,
    init?: RequestInit,
    opts: { externalRedirect?: "error" | "return"; /** Idle timeout, e.g. longer for downloads. */ timeoutMs?: number } = {}
  ): Promise<Response> {
    const auth = this.auth;
    if (auth.failed) throw auth.failed;
    // A re-login in progress: wait for it (and share its outcome).
    if (auth.relogin) await auth.relogin;
    if (!auth.loggedIn) {
      // An earlier re-login failed (Wilma down, network blip): try again now.
      if (auth.username && auth.password) await this.relogin();
      else throw new AuthenticationError("WilmaSession not logged in – call login() first");
    }

    const prefixedPath = this.getPrefixedPath(path);
    const generation = auth.generation;
    // Some pages (messages) answer a cancelled session with a redirect to the
    // login page instead of 401/403: stop there rather than read the login
    // page as an empty answer.
    const authed = { ...init, stopAtLogin: true };
    let resp = await this.rawRequest(prefixedPath, authed, opts.timeoutMs);

    // 401 or a redirect to the login page: the session expired. 403: either
    // another login on the same account cancelled this session, or just this
    // one item is off-limits.
    const loggedOut = (r: Response) => r.status === 401 || this.isLoginRedirect(r);
    if ((loggedOut(resp) || resp.status === 403) && auth.username && auth.password) {
      const someoneElseLoggedIn = () => auth.generation !== generation || auth.relogin !== null;
      let retry = someoneElseLoggedIn();
      if (!retry && (loggedOut(resp) || !(await this.sessionAlive()))) {
        // Check again: another request may have logged in while we probed.
        if (!someoneElseLoggedIn()) await this.relogin();
        retry = true;
      }
      if (retry) {
        if (auth.relogin) await auth.relogin;
        await resp.body?.cancel();
        resp = await this.rawRequest(prefixedPath, authed, opts.timeoutMs);
      }
    }

    if (this.debug) {
      console.error(`[wilmai] ${init?.method ?? "GET"} ${redactPath(prefixedPath)} => ${resp.status}`);
    }

    if (this.isLoginRedirect(resp)) {
      await resp.body?.cancel();
      throw new APIError(`Wilma asked to log in again at ${redactPath(prefixedPath)}`, 401);
    }
    if (resp.status >= 300 && resp.status < 400) {
      // rawRequest follows redirects within Wilma, so this one leads elsewhere.
      if (opts.externalRedirect === "return") return resp;
      await resp.body?.cancel();
      throw new APIError(`Wilma redirected to another site at ${redactPath(prefixedPath)}`, resp.status);
    }
    if (resp.status >= 400) {
      await resp.body?.cancel();
      throw new APIError(`Wilma HTTP ${resp.status} at ${redactPath(prefixedPath)}`, resp.status);
    }

    return resp;
  }

  /** A redirect to this Wilma's login page: the session is gone. */
  private isLoginRedirect(resp: Response): boolean {
    if (resp.status < 300 || resp.status >= 400) return false;
    const location = resp.headers.get("location");
    if (!location) return false;
    try {
      const target = new URL(location, `${this.baseUrl}/`);
      return target.origin === new URL(this.baseUrl).origin && /^\/login\/?$/i.test(target.pathname);
    } catch {
      return false;
    }
  }

  /**
   * Is this login still live? A cancelled session gets 401/403 everywhere;
   * a live one answers the account roles API (or 404 on Wilmas without it).
   * Lets a 403 on one item be told apart from a cancelled session without
   * logging in again (which would log the parent out of their own browser).
   */
  private async sessionAlive(): Promise<boolean> {
    try {
      const probe = await this.rawRequest("/api/v1/accounts/me/roles", { method: "GET", redirect: "manual" });
      await probe.body?.cancel();
      return probe.status !== 401 && probe.status !== 403 && !(probe.status >= 300 && probe.status < 400);
    } catch {
      return false;
    }
  }

  /**
   * Answer a two-step verification challenge. If Wilma rejects the code (most
   * likely because it was already used — logins less than 30 seconds apart
   * share one), ask once more for the same challenge; the callback then
   * waits for a fresh code.
   */
  async answerMfa(formkey: string, onMfa: (formkey: string) => Promise<string>): Promise<void> {
    try {
      await this.submitMfaCode(formkey, await onMfa(formkey));
    } catch (err) {
      if (err instanceof AuthenticationError && /invalid OTP/i.test(err.message)) {
        await this.submitMfaCode(formkey, await onMfa(formkey));
      } else {
        throw err;
      }
    }
  }

  /** Log in again, once for everyone sharing this login even if many requests notice at the same time. */
  private async relogin(): Promise<void> {
    if (!this.auth.relogin) {
      const auth = this.auth;
      const attempt = (async () => {
        auth.loggedIn = false;
        // Start from a clean jar: a leftover session cookie must not make a
        // failed login look successful.
        auth.cookieJar.removeAllCookiesSync();
        if (this.debug) console.error("[wilmai] session cancelled or expired; logging in again");
        try {
          await this.login(auth.username!, auth.password!);
        } catch (err) {
          if (err instanceof MfaRequiredError && auth.onMfa) {
            await this.answerMfa(err.formkey, auth.onMfa);
          } else {
            throw err;
          }
        }
      })();
      // No overall deadline: every request in the login has its own idle
      // timeout, and an interactive code prompt may rightly take a while. (A
      // deadline would also let a second re-login start under this one.)
      auth.relogin = attempt
        .catch((err) => {
          // The saved login itself was refused: stop here instead of retrying on every request.
          if (isPermanentLoginFailure(err)) auth.failed = err as Error;
          throw err;
        })
        .finally(() => {
          auth.relogin = null;
        });
    }
    await this.auth.relogin;
  }

  async get(
    path: string,
    init?: RequestInit,
    opts?: { externalRedirect?: "error" | "return"; timeoutMs?: number }
  ): Promise<Response> {
    return this.request(path, { ...init, method: "GET" }, opts);
  }

  async post(path: string, init?: RequestInit): Promise<Response> {
    return this.request(path, { ...init, method: "POST" });
  }

  private async getLoginToken(): Promise<string> {
    const resp = await this.rawRequest("/token", { method: "GET" });
    if (resp.status !== 200) {
      // An outage or a changed login page, not a wrong password.
      await resp.body?.cancel();
      throw new APIError(`Wilma answered HTTP ${resp.status} for its login token`, resp.status);
    }

    const text = await resp.text();
    try {
      const data = JSON.parse(text) as { Wilma2LoginID?: string };
      if (data.Wilma2LoginID) {
        return data.Wilma2LoginID;
      }
    } catch {
      // fall through to regex
    }

    const match = /"Wilma2LoginID"\s*:\s*"([^"\s]+)"/.exec(text);
    if (!match) {
      throw new APIError("Wilma's login token wasn't in the expected format", resp.status);
    }

    return match[1];
  }

  /**
   * One request to this Wilma, following redirects within Wilma hop by hop
   * (cookies are stored per hop, and only for Wilma). A redirect to another
   * origin is returned as-is: Wilma's cookies never travel there.
   */
  private async rawRequest(
    path: string,
    init?: RequestInit & { stopAtLogin?: boolean },
    timeoutMs = REQUEST_TIMEOUT_MS
  ): Promise<Response> {
    const origin = new URL(this.baseUrl).origin;
    // Paths only: "//host/x" or "https://other/x" would leave Wilma.
    if (path.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(path)) {
      throw new APIError("Refusing a request outside Wilma", 400);
    }
    let url = new URL(path, `${this.baseUrl}/`);
    if (url.origin !== origin) {
      throw new APIError("Refusing a request outside Wilma", 400);
    }

    const baseHeaders = new Headers();
    if (init?.headers) {
      const incoming = init.headers;
      if (incoming instanceof Headers) {
        incoming.forEach((value, key) => baseHeaders.set(key, value));
      } else if (Array.isArray(incoming)) {
        for (const entry of incoming) {
          if (entry.length >= 2) {
            baseHeaders.set(entry[0], entry[1]);
          }
        }
      } else {
        for (const [key, value] of Object.entries(incoming)) {
          if (value !== undefined) {
            baseHeaders.set(key, String(value));
          }
        }
      }
    }
    baseHeaders.set("User-Agent", USER_AGENT);
    baseHeaders.set("Referer", `${this.baseUrl}/`);

    const { stopAtLogin, ...fetchInit } = init ?? {};
    const follow = init?.redirect !== "manual";
    const idle = new IdleTimer(timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, idle.signal]) : idle.signal;
    let method = (init?.method ?? "GET").toUpperCase();
    let body = init?.body;

    for (let hop = 0; ; hop += 1) {
      const headers = new Headers(baseHeaders);
      const cookieHeader = this.auth.cookieJar.getCookieStringSync(url.href);
      if (cookieHeader) headers.set("Cookie", cookieHeader);

      if (this.debug) {
        // Method and path only: never headers, bodies or query strings.
        console.error(`[wilmai] ${method} ${redactPath(url.pathname)}`);
      }

      let resp: Response;
      try {
        idle.touch();
        resp = await fetch(url, { ...fetchInit, method, body, headers, signal, redirect: "manual" });
      } catch (err) {
        idle.stop();
        // Timeouts, and `fetch failed` with its cause code and remediation attached.
        throw asNetworkError(err, origin);
      }

      const headersAny = resp.headers as unknown as { getSetCookie?: () => string[] };
      const setCookies = headersAny.getSetCookie?.() ?? [];
      const single = setCookies.length ? [] : [resp.headers.get("set-cookie")].filter((c): c is string => !!c);
      for (const cookie of [...setCookies, ...single]) {
        // A cookie Wilma isn't allowed to set (e.g. for another domain) is dropped, not fatal.
        this.auth.cookieJar.setCookieSync(cookie, url.href, { ignoreError: true });
      }

      const location = resp.headers.get("location");
      if (!follow || resp.status < 300 || resp.status >= 400 || !location) {
        return watchBody(resp, idle, origin);
      }
      const next = new URL(location, url);
      if (next.origin !== origin) {
        return watchBody(resp, idle, origin); // hand the off-site redirect back to the caller
      }
      if (stopAtLogin && /^\/login\/?$/i.test(next.pathname)) {
        return watchBody(resp, idle, origin); // logged out: the caller decides
      }
      if (hop >= MAX_REDIRECTS) {
        idle.stop();
        await resp.body?.cancel();
        throw new APIError("Wilma redirected too many times", resp.status);
      }
      await resp.body?.cancel();
      // Like browsers: 303, and 301/302 after a POST, continue as GET without a body.
      if (resp.status === 303 || ((resp.status === 301 || resp.status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
        baseHeaders.delete("Content-Type");
      }
      url = next;
    }
  }
}

/** The origin of a redirect target, for messages (never its path). */
function safeOrigin(location: string | null, base: string): string | null {
  try {
    return location ? new URL(location, `${base}/`).origin : null;
  } catch {
    return null;
  }
}

/** A path for messages and logs: no student number, no query string. */
function redactPath(path: string): string {
  return path.replace(/^\/![^/]+/, "").split("?")[0] || "/";
}

function isPermanentLoginFailure(err: unknown): boolean {
  return (
    err instanceof MfaRequiredError ||
    (err instanceof AuthenticationError && /^Wilma login failed/.test(err.message))
  );
}

function isLoginOk(text: string): boolean {
  return !LOGIN_FAIL_RE.test(text);
}

function parseLoginFormFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const inputRegex = /<input[^>]+>/gi;
  const nameRegex = /name=['"]([^'"]+)['"]/i;
  const valueRegex = /value=['"]([^'"]*)['"]/i;
  const typeRegex = /type=['"]([^'"]+)['"]/i;

  const matches = html.match(inputRegex) ?? [];
  for (const tag of matches) {
    const name = nameRegex.exec(tag)?.[1];
    if (!name) continue;
    const type = typeRegex.exec(tag)?.[1]?.toLowerCase() ?? "text";
    if (name === "Login" || name === "Password") {
      continue;
    }
    if (type === "hidden" || type === "submit") {
      const value = valueRegex.exec(tag)?.[1] ?? "";
      fields[name] = value;
    }
  }
  return fields;
}
