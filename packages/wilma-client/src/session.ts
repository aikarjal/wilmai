import * as cheerio from "cheerio";
import { CookieJar, type Cookie } from "tough-cookie";
import { IdleTimer, asNetworkError, watchedResponse } from "./timeouts.js";
import { getDefaultTransport, type WilmaTransport } from "./transport.js";

/** What a request may carry (a subset of fetch's RequestInit that every transport can send). */
export interface RequestInit {
  method?: string;
  headers?: Record<string, string | undefined> | Headers | [string, string][];
  body?: string;
  redirect?: "follow" | "manual";
  signal?: AbortSignal;
}

export interface SessionOptions {
  studentNumber?: string | null;
  debug?: boolean;
  /** How requests are sent (default: the transport set by the entry point; undici on Node). */
  transport?: WilmaTransport;
  /**
   * Log in again by itself when Wilma ends the session (default true, with
   * the credentials of the last login). Set false where a background login
   * would be unwelcome — every login ends the parent's other Wilma sessions:
   * requests then fail with SessionEndedError and the caller decides.
   */
  relogin?: boolean;
  /** Where the WilmAI programs on one computer keep this login's session (see SharedSession). */
  shared?: SharedSession;
}

/**
 * The session of one Wilma login, kept where every WilmAI program on the
 * computer finds it (the CLI, assistants' connectors, the desktop app).
 * Wilma allows one live session per account, so programs that each log in
 * keep ending each other's sessions. With a shared session, a client whose
 * session Wilma ended first continues the newest one another program saved,
 * and logs in only when that one has ended too; after its own login it saves
 * the session for the others.
 */
export interface SharedSession {
  /** The newest saved session (exportState() format), or null. */
  load(): Promise<string | null>;
  /** Save this client's session (after it logged in). */
  save(state: string): Promise<void>;
}

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
/**
 * Wilma answered 403 for its login token, the first step of every login,
 * before the password is sent: it refuses this computer, not the username or
 * password. Some Wilmas accept connections only from Finland (a service in
 * front of Wilma answers everyone else with 403), so a computer abroad, such
 * as a cloud server, can't log in there. Not an APIError on purpose: reads
 * that take a 403 to mean "this Wilma doesn't show it" mustn't hide it.
 */
export class LoginBlockedError extends Error {
  status: number;
  /** What to do about it, for people and assistants. */
  hint: string;
  constructor(status = 403) {
    super(`Wilma refused this computer's connection before the password was sent (HTTP ${status} for its login token)`);
    this.name = "LoginBlockedError";
    this.status = status;
    this.hint =
      "Some Wilmas accept connections only from Finland. If WilmAI runs on a server or cloud computer outside Finland, " +
      "run it on a computer in Finland instead, such as your own computer or a server located in Finland.";
  }
}
/**
 * Wilma ended the session (another login on the account, or it expired) and
 * this client doesn't log in again by itself (no saved credentials, or
 * `relogin: false`). Nothing was sent; log in again and retry.
 */
export class SessionEndedError extends APIError {
  constructor(message = "Wilma ended the session; log in again") {
    super(message, 401);
    this.name = "SessionEndedError";
  }
}

/**
 * The password, or where to get it: a function called only when Wilma needs a
 * new login (e.g. reading a keychain), not while a saved session works.
 */
export type PasswordSource = string | (() => Promise<string>);

/**
 * Wilma needed a new login and the password couldn't be had (the function
 * given as the password failed: a keychain locked, declined or missing the
 * entry). Not a refusal by Wilma, so it never stops the client for good;
 * the next request tries again. `reason` and `cause` come from the failure.
 */
export class CredentialsUnavailableError extends Error {
  reason: string;
  constructor(message: string, options: { reason?: string; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "CredentialsUnavailableError";
    this.reason = options.reason ?? "unavailable";
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
  transport: WilmaTransport;
  /** Whether an ended session is logged in again by itself (see SessionOptions.relogin). */
  reloginAllowed: boolean;
  shared?: SharedSession;
  loggedIn: boolean;
  /** Wilma ended the session (as opposed to never logged in, or logged out on purpose). */
  endedByWilma: boolean;
  username?: string;
  /** Empty after logout() ("logged out on purpose": never logs in again by itself). */
  password?: PasswordSource;
  onMfa?: (formkey: string) => Promise<string>;
  /** Getting a live session back (a shared one, or a login), shared by every request that noticed. */
  relogin: Promise<void> | null;
  /** Bumped on every successful login, so a late 401/403 from an older login isn't mistaken for a new problem. */
  generation: number;
  /** Called after every successful login (first or again), e.g. to save the session. */
  onLogin?: () => void;
  /** Told what happened to the session (see SessionEvent). */
  onEvent?: (event: SessionEvent) => void;
  /**
   * Set when Wilma refused the saved login itself (its explicit "login
   * failed" answer, or a code is needed and there is no way to make one).
   * Further requests fail at once instead of retrying — repeated failed
   * logins can lock the Wilma account. Outages and other refusals (rate
   * limits, firewalls, maintenance pages) don't set it.
   */
  failed: Error | null;
}

/**
 * What happened to a client's session, for a host that shows it (e.g. a
 * sign-in history): "login" (this client logged in), "adopted" (Wilma had
 * ended its session and it continued the one another WilmAI program saved),
 * "ended" (Wilma ended it and the client may not, or could not, get a live
 * one back by itself).
 */
export type SessionEvent = "login" | "adopted" | "ended";

export class WilmaSession {
  private baseUrl: string;
  private auth: SessionAuth;
  private studentNumber?: string | null;
  private debug = false;

  constructor(baseUrl: string, opts?: SessionOptions) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.auth = {
      cookieJar: new CookieJar(),
      transport: opts?.transport ?? getDefaultTransport(),
      reloginAllowed: opts?.relogin ?? true,
      shared: opts?.shared,
      loggedIn: false,
      endedByWilma: false,
      relogin: null,
      generation: 0,
      failed: null,
    };
    this.studentNumber = opts?.studentNumber ?? null;
    this.debug = Boolean(opts?.debug);
  }

  /** The address of this Wilma, e.g. "https://example.inschool.fi". */
  get origin(): string {
    return new URL(this.baseUrl).origin;
  }

  /** The login's cookies, so another process can resume the session (see resumeState). */
  exportState(): string {
    return JSON.stringify(this.auth.cookieJar.serializeSync());
  }

  /**
   * Continue a session saved by exportState() instead of logging in. If Wilma
   * has ended it meanwhile, the first request notices (401/403 or the login
   * page) and logs in again with these credentials; without credentials it
   * fails with SessionEndedError. Returns false when the state holds no
   * session to resume.
   */
  resumeState(state: string, username?: string, password?: PasswordSource): boolean {
    let jar: CookieJar;
    try {
      jar = CookieJar.deserializeSync(JSON.parse(state));
    } catch {
      return false;
    }
    if (!holdsSession(jar, this.baseUrl)) return false;
    this.auth.cookieJar = jar;
    this.auth.loggedIn = true;
    this.auth.endedByWilma = false;
    this.auth.generation += 1;
    this.auth.username = username;
    this.auth.password = password;
    return true;
  }

  /** Called after every successful login (first or again). */
  /** Share this login's session with the other WilmAI programs (see SharedSession). */
  setShared(shared: SharedSession | undefined): void {
    this.auth.shared = shared;
  }

  onLogin(callback: (() => void) | undefined): void {
    this.auth.onLogin = callback;
  }

  onSessionEvent(callback: ((event: SessionEvent) => void) | undefined): void {
    this.auth.onEvent = callback;
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
    const session = new WilmaSession(this.baseUrl, { studentNumber, debug: this.debug, transport: this.auth.transport });
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
      this.auth.endedByWilma = false;
      this.auth.generation += 1;
      this.auth.failed = null;
      this.auth.username = username;
      this.auth.password = password;
      this.loggedInNow();
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

    this.auth.endedByWilma = false;
    this.auth.generation += 1;
    this.auth.failed = null;
    this.loggedInNow();
    if (this.debug) {
      console.error(`[wilmai] MFA verification successful`);
    }
  }

  /**
   * End this login's session in Wilma, as its "Log out" button does: the
   * logout form on the front page posts its formkey to /logout. Never logs
   * in; a session Wilma has already ended needs nothing. The session is
   * shared with every per-student session made from this one, and afterwards
   * none of them logs in again by itself (call login() for a new session).
   * Returns true when a live session was ended, false when there was none.
   * If Wilma can't be reached, throws and keeps the session, so logging out
   * can be tried again.
   */
  async logout(): Promise<boolean> {
    const auth = this.auth;
    // A re-login in progress makes a new session: let it finish, then end that one.
    if (auth.relogin) await auth.relogin.catch(() => {});
    const ended = holdsSession(auth.cookieJar, this.baseUrl) ? await this.endSession() : false;
    auth.cookieJar.removeAllCookiesSync();
    auth.loggedIn = false;
    // Logged out on purpose: not "ended by Wilma", so the next request neither
    // logs in again nor continues a session another program saved.
    auth.endedByWilma = false;
    auth.username = undefined;
    auth.password = undefined;
    return ended;
  }

  private async endSession(): Promise<boolean> {
    // Only raw requests: request() would log in again if the session has ended.
    const home = await this.rawRequest("/", { method: "GET", stopAtLogin: true });
    if (home.status >= 500) {
      await home.body?.cancel();
      throw new APIError(`Wilma answered HTTP ${home.status} while logging out`, home.status);
    }
    let formkey: string | null = null;
    if (home.status === 200) formkey = logoutFormkey(await home.text());
    else await home.body?.cancel();
    if (!formkey) {
      // The login page, or a 401/403: nothing to end. A live session without
      // the form is kept rather than forgotten while still open.
      if (await this.sessionAlive()) throw new APIError("Wilma's front page had no logout form", home.status);
      return false;
    }
    const resp = await this.rawRequest("/logout", {
      method: "POST",
      body: new URLSearchParams({ formkey }).toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      redirect: "manual",
    });
    await resp.body?.cancel();
    if (resp.status >= 500 || (resp.status >= 400 && (await this.sessionAlive()))) {
      throw new APIError(`Wilma didn't log out (HTTP ${resp.status})`, resp.status);
    }
    return true;
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
    const canRelogin = () => auth.reloginAllowed && Boolean(auth.username && auth.password);
    if (!auth.loggedIn) {
      // Ended earlier (or an earlier re-login failed): another program may have a session now, or try logging in again.
      if (canRelogin() || auth.endedByWilma) await this.recover();
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
    if (loggedOut(resp) || resp.status === 403) {
      // Another request may have got a session back meanwhile (generation bumped, or recovering now).
      const recoveredElsewhere = () => auth.generation !== generation || auth.relogin !== null;
      let retry = recoveredElsewhere();
      // Tell an ended session apart from one item that's off-limits (403 with the session alive).
      if (!retry && (loggedOut(resp) || !(await this.sessionAlive()))) {
        await resp.body?.cancel();
        // Check again: another request may have recovered while we probed.
        if (!recoveredElsewhere()) await this.recover();
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

  /**
   * The password for a new login. A function given as the password is called
   * here, only now; its answer replaces it (as a login does). If it fails, the
   * session is "ended by Wilma" (never "logged out", never failed for good)
   * and the error is a CredentialsUnavailableError.
   */
  private async resolvePassword(): Promise<string> {
    const auth = this.auth;
    const source = auth.password;
    if (typeof source !== "function") return source ?? "";
    try {
      const password = await source();
      if (typeof password !== "string" || !password) throw new Error("No password was returned");
      // logout() may have cleared it meanwhile: then it stays cleared.
      if (auth.password === source) auth.password = password;
      return password;
    } catch (err) {
      auth.loggedIn = false;
      auth.endedByWilma = true;
      auth.onEvent?.("ended");
      if (err instanceof CredentialsUnavailableError) throw err;
      const reason = typeof (err as { reason?: unknown })?.reason === "string" ? (err as { reason: string }).reason : undefined;
      throw new CredentialsUnavailableError(err instanceof Error ? err.message : String(err), { reason, cause: err });
    }
  }

  /**
   * A live session after Wilma ended this one, once for everyone sharing this
   * login even if many requests notice at the same time: the newest session
   * another program saved (no login), else a login when this client may log
   * in again. Without either, SessionEndedError.
   */
  private async recover(): Promise<void> {
    if (!this.auth.relogin) {
      const auth = this.auth;
      const attempt = (async () => {
        if (await this.adoptShared()) return;
        if (!(auth.reloginAllowed && auth.username && auth.password)) {
          auth.loggedIn = false;
          auth.endedByWilma = true;
          auth.onEvent?.("ended");
          throw new SessionEndedError();
        }
        // Get the password before changing anything: if it can't be had, the
        // session stays "ended by Wilma" and the next request tries again.
        const password = await this.resolvePassword();
        auth.loggedIn = false;
        // Start from a clean jar: a leftover session cookie must not make a
        // failed login look successful.
        auth.cookieJar.removeAllCookiesSync();
        if (this.debug) console.error("[wilmai] session cancelled or expired; logging in again");
        try {
          await this.login(auth.username!, password);
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

  /** Continue the session another program saved, if it differs from ours and Wilma still accepts it. */
  private async adoptShared(): Promise<boolean> {
    const auth = this.auth;
    if (!auth.shared) return false;
    let jar: CookieJar;
    try {
      const state = await auth.shared.load();
      if (!state) return false;
      jar = CookieJar.deserializeSync(JSON.parse(state));
    } catch {
      return false;
    }
    const theirs = sessionCookie(jar, this.baseUrl);
    if (!theirs || theirs === sessionCookie(auth.cookieJar, this.baseUrl)) return false;
    const ours = auth.cookieJar;
    auth.cookieJar = jar;
    if (!(await this.sessionAlive())) {
      auth.cookieJar = ours;
      return false;
    }
    if (this.debug) console.error("[wilmai] continuing the session another program saved");
    auth.loggedIn = true;
    auth.endedByWilma = false;
    auth.failed = null;
    auth.generation += 1;
    auth.onEvent?.("adopted");
    return true;
  }

  /** After a login: tell the host (onLogin) and save the session for the other programs. */
  private loggedInNow(): void {
    this.auth.onLogin?.();
    this.auth.onEvent?.("login");
    void this.auth.shared?.save(this.exportState()).catch(() => {});
  }

  /** Changes whenever the session behind this client changes (a login, or another program's session continued). */
  get sessionMark(): number {
    return this.auth.generation;
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

  /**
   * Send a form that changes something in Wilma (a reply, a sign-up, an
   * absence report): one POST, never repeated. Unlike request(), it doesn't
   * log in again and retry when the session has ended — after a new login
   * the form's key is stale, and a write must not be sent twice — it fails
   * with SessionEndedError instead (nothing was sent; prepare the form
   * again). Redirects within Wilma are followed; the answer is returned for
   * the caller to check.
   */
  async submit(
    path: string,
    form: URLSearchParams | Record<string, string> | [string, string][],
    opts: { headers?: Record<string, string> } = {}
  ): Promise<Response> {
    const auth = this.auth;
    if (auth.failed) throw auth.failed;
    if (auth.relogin) await auth.relogin.catch(() => {});
    if (!auth.loggedIn) throw new SessionEndedError("Not logged in to Wilma; nothing was sent");
    const prefixedPath = this.getPrefixedPath(path);
    const body = (form instanceof URLSearchParams ? form : new URLSearchParams(form as Record<string, string>)).toString();
    const generation = auth.generation;
    const resp = await this.rawRequest(prefixedPath, {
      method: "POST",
      body,
      headers: { ...opts.headers, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      stopAtLogin: true,
    });
    // 403 is also how Wilma answers a session another login cancelled.
    const ended =
      resp.status === 401 ||
      this.isLoginRedirect(resp) ||
      (resp.status === 403 && auth.generation === generation && !(await this.sessionAlive()));
    if (ended) {
      await resp.body?.cancel();
      auth.loggedIn = false;
      auth.endedByWilma = true;
      auth.onEvent?.("ended");
      // The form belonged to the ended session. Preparing again (a read) continues another program's session, or logs in when allowed.
      throw new SessionEndedError("Wilma ended the session; nothing was sent. Prepare it again.");
    }
    if (resp.status >= 300 && resp.status < 400) {
      await resp.body?.cancel();
      throw new APIError(`Wilma redirected to another site at ${redactPath(prefixedPath)}`, resp.status);
    }
    return resp;
  }

  private async getLoginToken(): Promise<string> {
    const resp = await this.rawRequest("/token", { method: "GET" });
    if (resp.status === 403) {
      // Judged by the step and the status only: nothing has been sent but GETs.
      await resp.body?.cancel();
      throw new LoginBlockedError(resp.status);
    }
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

    const stopAtLogin = init?.stopAtLogin;
    const follow = init?.redirect !== "manual";
    const idle = new IdleTimer(timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, idle.signal]) : idle.signal;
    let method = (init?.method ?? "GET").toUpperCase();
    let body = init?.body;

    for (let hop = 0; ; hop += 1) {
      const headers: Record<string, string> = {};
      baseHeaders.forEach((value, key) => {
        headers[key] = value;
      });
      const cookieHeader = this.auth.cookieJar.getCookieStringSync(url.href);
      if (cookieHeader) headers["cookie"] = cookieHeader;

      if (this.debug) {
        // Method and path only: never headers, bodies or query strings.
        console.error(`[wilmai] ${method} ${redactPath(url.pathname)}`);
      }

      let resp: Response;
      try {
        idle.touch();
        const reply = await this.auth.transport({ url: url.href, method, headers, body, signal });
        for (const cookie of reply.setCookies) {
          // A cookie Wilma isn't allowed to set (e.g. for another domain) is dropped, not fatal.
          this.auth.cookieJar.setCookieSync(cookie, url.href, { ignoreError: true });
        }
        resp = watchedResponse({ status: reply.status, headers: reply.headers, body: reply.body, url: url.href }, idle, origin);
      } catch (err) {
        idle.stop();
        // Timeouts, and `fetch failed` with its cause code and remediation attached.
        throw asNetworkError(err, origin);
      }

      const location = resp.headers.get("location");
      if (!follow || resp.status < 300 || resp.status >= 400 || !location) {
        return resp;
      }
      const next = new URL(location, url);
      if (next.origin !== origin) {
        return resp; // hand the off-site redirect back to the caller
      }
      if (stopAtLogin && /^\/login\/?$/i.test(next.pathname)) {
        return resp; // logged out: the caller decides
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

/** Does the jar hold a Wilma session cookie for this Wilma? */
function holdsSession(jar: CookieJar, baseUrl: string): boolean {
  return sessionCookie(jar, baseUrl) !== null;
}

/** The Wilma session cookie's value, telling sessions apart. */
function sessionCookie(jar: CookieJar, baseUrl: string): string | null {
  return jar.getCookiesSync(baseUrl).find((cookie: Cookie) => cookie.key === "Wilma2SID")?.value ?? null;
}

/** The formkey of Wilma's logout form (`<form id="logout-form" action="/logout">`, on every page of a live session). */
function logoutFormkey(html: string): string | null {
  return cheerio.load(html)('form#logout-form input[name="formkey"]').attr("value") || null;
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
