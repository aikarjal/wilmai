import { CookieJar, type Cookie } from "tough-cookie";
import { fetch, type RequestInit, type Response } from "undici";
import { wrapNetworkError } from "./network-error.js";

export class AuthenticationError extends Error {}
export class MfaRequiredError extends Error {
  formkey: string;
  constructor(formkey: string) {
    super("MFA verification required");
    this.formkey = formkey;
  }
}
export class APIError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

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
}

export class WilmaSession {
  private baseUrl: string;
  private auth: SessionAuth;
  private studentNumber?: string | null;
  private debug = false;

  constructor(baseUrl: string, opts?: { studentNumber?: string | null; debug?: boolean }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.auth = { cookieJar: new CookieJar(), loggedIn: false, relogin: null, generation: 0 };
    this.studentNumber = opts?.studentNumber ?? null;
    this.debug = Boolean(opts?.debug);
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

    // Wilma answers a wrong username or password with a redirect to
    // "?loginfailed" — empty body, no session cookie.
    if (LOGIN_FAIL_RE.test(location)) {
      throw new AuthenticationError("Wilma login failed");
    }

    // Check for MFA challenge by following the post-login redirect
    if (resp.status >= 300 && resp.status < 400 && hasSessionCookie) {
      const location = resp.headers.get("location");
      if (location) {
        const redirectResp = await this.rawRequest(
          new URL(location).pathname + new URL(location).search,
          { method: "GET" }
        );
        const redirectText = await redirectResp.text();
        const mfaFormkeyMatch = /id="mfa-formkey"\s+value="([^"]+)"/.exec(redirectText);
        if (mfaFormkeyMatch) {
          if (this.debug) {
            console.log(`[wilmai] MFA challenge detected`);
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
    if (hasSessionCookie || (resp.status < 300 && isLoginOk(text))) {
      this.auth.loggedIn = true;
    this.auth.generation += 1;
      this.auth.username = username;
      this.auth.password = password;
      return;
    }

    throw new AuthenticationError("Wilma login failed");
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
      console.log(`[wilmai] POST ${path} (MFA OTP check)`);
    }

    const resp = await this.rawRequest(path, {
      method: "POST",
      body: body.toString(),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
    });

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
    if (this.debug) {
      console.log(`[wilmai] MFA verification successful`);
    }
  }

  private async getLoginFormFields(): Promise<Record<string, string>> {
    const resp = await this.rawRequest("/login", { method: "GET" });
    if (resp.status >= 400) {
      return {};
    }
    const html = await resp.text();
    return parseLoginFormFields(html);
  }

  async request(path: string, init?: RequestInit): Promise<Response> {
    const auth = this.auth;
    // A re-login in progress: wait for it (and share its outcome).
    if (auth.relogin) await auth.relogin;
    if (!auth.loggedIn) {
      // An earlier re-login failed (Wilma down, network blip): try again now.
      if (auth.username && auth.password) await this.relogin();
      else throw new AuthenticationError("WilmaSession not logged in – call login() first");
    }

    const prefixedPath = this.getPrefixedPath(path);
    const generation = auth.generation;
    let resp = await this.rawRequest(prefixedPath, init);

    // 401: the session expired. 403: either another login on the same account
    // cancelled this session, or just this one item is off-limits.
    if ((resp.status === 401 || resp.status === 403) && auth.username && auth.password) {
      if (auth.generation !== generation || auth.relogin) {
        // Someone already logged in again since this request was sent: just retry.
        if (auth.relogin) await auth.relogin;
        resp = await this.rawRequest(prefixedPath, init);
      } else if (resp.status === 401 || !(await this.sessionAlive())) {
        await this.relogin();
        resp = await this.rawRequest(prefixedPath, init);
      }
    }

    if (this.debug) {
      console.log(`[wilmai] ${init?.method ?? "GET"} ${prefixedPath} => ${resp.status}`);
    }

    if (resp.status >= 400) {
      throw new APIError(`Wilma HTTP ${resp.status} at ${prefixedPath}`, resp.status);
    }

    return resp;
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
      auth.relogin = (async () => {
        auth.loggedIn = false;
        // Start from a clean jar: a leftover session cookie must not make a
        // failed login look successful.
        auth.cookieJar.removeAllCookiesSync();
        if (this.debug) console.log("[wilmai] session cancelled or expired; logging in again");
        try {
          await this.login(auth.username!, auth.password!);
        } catch (err) {
          if (err instanceof MfaRequiredError && auth.onMfa) {
            await this.answerMfa(err.formkey, auth.onMfa);
          } else {
            throw err;
          }
        }
      })().finally(() => {
        auth.relogin = null;
      });
    }
    await this.auth.relogin;
  }

  async get(path: string, init?: RequestInit): Promise<Response> {
    return this.request(path, { ...init, method: "GET" });
  }

  async post(path: string, init?: RequestInit): Promise<Response> {
    return this.request(path, { ...init, method: "POST" });
  }

  private async getLoginToken(): Promise<string> {
    const resp = await this.rawRequest("/token", { method: "GET" });
    if (resp.status !== 200) {
      throw new AuthenticationError("/token fetch failed");
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
      throw new AuthenticationError("Wilma2LoginID not found in /token response");
    }

    return match[1];
  }

  private async rawRequest(path: string, init?: RequestInit): Promise<Response> {
    const url = new URL(path, this.baseUrl).toString();
    const cookieHeader = this.auth.cookieJar.getCookieStringSync(url);

    const headers = new Headers();
    if (init?.headers) {
      const incoming = init.headers;
      if (incoming instanceof Headers) {
        incoming.forEach((value, key) => headers.set(key, value));
      } else if (Array.isArray(incoming)) {
        for (const entry of incoming) {
          if (entry.length >= 2) {
            headers.set(entry[0], entry[1]);
          }
        }
      } else {
        for (const [key, value] of Object.entries(incoming)) {
          if (value !== undefined) {
            headers.set(key, String(value));
          }
        }
      }
    }

    headers.set("User-Agent", USER_AGENT);
    headers.set("Referer", `${this.baseUrl}/`);
    if (cookieHeader) {
      headers.set("Cookie", cookieHeader);
    }

    if (this.debug) {
      const method = init?.method ?? "GET";
      // Avoid logging sensitive headers or body
      console.log(`[wilmai] ${method} ${url}`);
    }

    let resp: Response;
    try {
      resp = await fetch(url, {
        ...init,
        headers,
      });
    } catch (err) {
      // `fetch failed` on its own is undiagnosable; re-throw with the cause code
      // and remediation attached.
      throw wrapNetworkError(err, url);
    }

    const headersAny = resp.headers as unknown as { getSetCookie?: () => string[] };
    const setCookies = headersAny.getSetCookie?.() ?? [];
    if (setCookies.length) {
      for (const cookie of setCookies) {
        this.auth.cookieJar.setCookieSync(cookie, url);
      }
    } else {
      const single = resp.headers.get("set-cookie");
      if (single) {
        this.auth.cookieJar.setCookieSync(single, url);
      }
    }

    return resp;
  }
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
