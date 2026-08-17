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

export class WilmaSession {
  private baseUrl: string;
  private cookieJar: CookieJar;
  private loggedIn = false;
  private username?: string;
  private password?: string;
  private studentNumber?: string | null;
  private debug = false;

  constructor(baseUrl: string, opts?: { studentNumber?: string | null; debug?: boolean }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.cookieJar = new CookieJar();
    this.studentNumber = opts?.studentNumber ?? null;
    this.debug = Boolean(opts?.debug);
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
    if (this.loggedIn) {
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

    const hasSessionCookie = this.cookieJar
      .getCookiesSync(this.baseUrl)
      .some((c: Cookie) => c.key === "Wilma2SID");

    const text = await resp.text();

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
          this.username = username;
          this.password = password;
          throw new MfaRequiredError(mfaFormkeyMatch[1]);
        }
      }
    }

    if (hasSessionCookie || isLoginOk(text)) {
      this.loggedIn = true;
      this.username = username;
      this.password = password;
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

    this.loggedIn = true;
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
    if (!this.loggedIn) {
      throw new AuthenticationError("WilmaSession not logged in – call login() first");
    }

    const prefixedPath = this.getPrefixedPath(path);
    let resp = await this.rawRequest(prefixedPath, init);

    if (resp.status === 401 && this.username && this.password) {
      this.loggedIn = false;
      await this.login(this.username, this.password);
      resp = await this.rawRequest(prefixedPath, init);
    }

    if (this.debug) {
      console.log(`[wilmai] ${init?.method ?? "GET"} ${prefixedPath} => ${resp.status}`);
    }

    if (resp.status >= 400) {
      throw new APIError(`Wilma HTTP ${resp.status} at ${prefixedPath}`, resp.status);
    }

    return resp;
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
    const cookieHeader = this.cookieJar.getCookieStringSync(url);

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
        this.cookieJar.setCookieSync(cookie, url);
      }
    } else {
      const single = resp.headers.get("set-cookie");
      if (single) {
        this.cookieJar.setCookieSync(single, url);
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
