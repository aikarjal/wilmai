/*
 * Signing in, keeping the session, and syncing Wilma into the snapshot.
 *
 * Polite to Wilma: at most three requests at a time, details only for what's
 * recent, and nothing re-read that hasn't changed. Unread messages are not
 * opened in the background unless the parent allows it, because opening a
 * message marks it read in Wilma.
 */
import {
  APIError,
  AuthenticationError,
  SessionEndedError,
  WilmaClient,
  addExamTimes,
  type GradebookEntry,
  type PastExam,
  type InvitationListing,
  type LessonNote,
  type Message,
  type MessageRecipient,
  type NewsItem,
  type ScheduleLesson,
} from "@wilma-client/src/core";
import * as write from "@wilma-client/src/write";
import { bridgeCall, clearReports, isDesktopApp, savedLoginSecret, sharedKeyFor, sharedSessionFor, wilmaTransport } from "../wilma/transport";
import { totpCallback } from "../wilma/totp";
import { recordSession, sessionCookieOf } from "./history";
import { addDays, clock, dateOf, daysBetween, mondayOf, today } from "./dates";
import { emptySnapshot, intelligenceOn, type AccountInfo, type Contacts, type Login, type MessageRec, type NewsRec, type Snapshot, type Viewer } from "./model";
import {
  accountKey,
  accountScope,
  activateAccount,
  familyFor,
  flushPersisted,
  forgetEverything,
  forgetFamily,
  knownFamilies,
  getState,
  passwordOf,
  rememberPasswordOf,
  savedLinkedSessions,
  savedSession,
  saveLinkedSession,
  saveSession,
  setState,
  setViewAs,
  updateSettings,
  viewer,
  type LoginStatus,
  type SavedSession,
} from "./store";
import { aboutShown, accountOf, familyChild, familyChildren, familyId, loginOf, loginOfChild, loginOfId, logins, sameWilma, schoolOf, slotFor, wilmaIdOf, wilmaNumber } from "./logins";
import { demoContacts, demoSnapshot } from "../demo/demo";
import { runJev } from "../jev/runner";
import { runLuna } from "../luna/events";
import { t } from "../i18n";
import { retainedScheduleWeeks } from "./schedule";
import { TENANTS } from "./tenants";
import { SignInAttempt, SignInCancelledError } from "./sign-in-attempt";

type Session = { client: WilmaClient; account: AccountInfo; sharedKey?: string };
type Student = { studentNumber: string; name: string; role?: Viewer };
/** A login waiting for the two-step code the parent types, or done (null). */
type Next = { mfa: (code: string) => Promise<void> } | null;

/** The family's signed-in Wilmas, by slot (data/logins.ts): wilma-client, which never logs in again by itself here. */
const sessions = new Map<number, Session>();
let syncing: Promise<void> | null = null;
let syncAgain = false;
let endingSession: Promise<unknown> = Promise.resolve();

const sessionOf = (slot: number): Session | null => sessions.get(slot) ?? null;

/**
 * The sign-in under way for each Wilma, by slot (the start page's first sign-in, before the family has slots, as
 * START): signing that Wilma out, the parent signing it in again, a reset or another family cancels it, so a late
 * answer from Wilma can't bring back what the parent has left (sign-in-attempt.ts).
 */
const signIns = new Map<number, SignInAttempt>();
const START = -1;
/** The app doesn't sign a Wilma in by itself over the parent's own sign-in for this long (a code being typed, say). */
const PARENT_SIGN_IN_MS = 10 * 60_000;

function beginSignIn(slot: number, by: SignInAttempt["by"]): SignInAttempt {
  signIns.get(slot)?.cancel();
  const attempt = new SignInAttempt(by);
  signIns.set(slot, attempt);
  return attempt;
}

function cancelSignIn(slot: number) {
  signIns.get(slot)?.cancel();
  signIns.delete(slot);
}

function cancelSignIns() {
  for (const attempt of signIns.values()) attempt.cancel();
  signIns.clear();
}

/** The parent signing this Wilma in themself right now: the app leaves it to them. */
function parentSigningIn(slot: number): boolean {
  const attempt = signIns.get(slot);
  return Boolean(attempt && attempt.by === "parent" && attempt.current && !attempt.committed && Date.now() - attempt.started < PARENT_SIGN_IN_MS);
}

/** A sign-in cancelled after Wilma took its login: Wilma's session ends too. One continued from another program stays theirs. */
function dropLate(attempt: SignInAttempt, client: WilmaClient): never {
  if (attempt.loggedIn) {
    attempt.ending = true;
    void client.logout().catch(() => {});
  }
  throw new SignInCancelledError();
}

/** The client for one child, on the child's own Wilma. */
function kid(number: string): WilmaClient {
  const session = sessionOf(loginOfChild(number));
  if (!session) throw new SessionEndedError();
  return session.client.forStudent(wilmaNumber(number));
}

/** Keep a login's session (Wilma's cookies) for the next start: the first login's in its own place, as before there were more. */
function keep(slot: number) {
  const session = sessions.get(slot);
  if (!session) return;
  const saved = { account: session.account, state: session.client.exportSession(), sharedKey: session.sharedKey };
  if (slot) void saveLinkedSession(session.account, saved);
  else void saveSession(saved);
}

/** Forget a login's kept session, or keep only its shared key (the next check continues another WilmAI program's session). */
function forgetSession(slot: number, account: AccountInfo, sharedKey?: string) {
  const ended = sharedKey ? { account, state: "", sharedKey } : null;
  return slot ? saveLinkedSession(account, ended) : saveSession(ended);
}

function setStatus(slot: number, status: LoginStatus | null) {
  setState((s) => {
    const loginStatus = { ...s.loginStatus };
    if (status) loginStatus[slot] = status;
    else delete loginStatus[slot];
    return { loginStatus };
  });
}

const LIVE: LoginStatus = { live: true, why: null, rejoinAt: null, failed: null };

/** Every Wilma of the family signed in: the app shows. Otherwise the Wilmas page, where the parent signs in. */
function settle() {
  const snap = getState().snapshot;
  if (!snap || snap.account.via === "demo") return;
  const all = logins(snap);
  const ready = all.length > 0 && all.every((l) => sessions.has(l.slot));
  if ((getState().phase === "ready") !== ready) setState({ phase: ready ? "ready" : "signed-out" });
}

/**
 * Client options: this app's transport, never logging in by itself, and WilmAI's shared session when the login's key is
 * known. For a sign-in (`attempt`), until it's accepted: its requests stop when it's cancelled, and its login isn't
 * saved for the other programs (finishLogin does that once it's accepted).
 */
function clientOptions(sharedKey: string | undefined, attempt?: SignInAttempt) {
  const shared = sharedKey ? sharedSessionFor(sharedKey) : undefined;
  if (!attempt) return { transport: wilmaTransport, sharedSession: shared };
  const transport: typeof wilmaTransport = (req) => {
    if (attempt.committed || attempt.ending) return wilmaTransport(req);
    attempt.assertCurrent();
    return attempt.wait(wilmaTransport(req));
  };
  const sharedSession: typeof shared = shared && {
    get last() {
      return shared.last;
    },
    entry: () => (attempt.committed ? shared.entry() : attempt.wait(shared.entry())),
    load: () => (attempt.committed ? shared.load() : attempt.wait(shared.load())),
    save: async (state: string) => {
      if (attempt.committed) await shared.save(state);
      else attempt.loggedIn = true;
    },
  };
  return { transport, sharedSession };
}

/** With more than one Wilma, the sign-in history names each entry's. */
function labelOf(account: AccountInfo): { wilma?: string } {
  const snap = getState().snapshot;
  return snap && logins(snap).some((l) => !sameWilma(l.account.baseUrl, account.baseUrl)) ? { wilma: schoolOf(account) } : {};
}

/**
 * Note in the sign-in history when the client, finding this app's session
 * ended, continued the one another WilmAI program saved (that program's
 * login is what ended it).
 */
function watchSession(client: WilmaClient, shared: ReturnType<typeof sharedSessionFor> | undefined, slot: number, account: AccountInfo) {
  client.onSessionEvent((event) => {
    if (event !== "adopted") return;
    const last = shared?.last;
    recordSession({ kind: "continued", by: last?.by ?? null, savedAt: last?.savedAt ?? null, midway: true, ...labelOf(account) });
    keep(slot);
  });
}

function limiter(max: number, current = () => true) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((resolve) => queue.push(resolve));
    active += 1;
    try {
      if (!current()) throw new SessionEndedError();
      return await task();
    } finally {
      active -= 1;
      queue.shift()?.();
    }
  };
}

/* ------------------------------------------------------------------ */
/*  Sessions                                                           */
/* ------------------------------------------------------------------ */

/*
 * Wilma allows one live session per account, and every login ends the
 * parent's others (their own Wilma tab, the phone app). So the app logs in
 * only when the parent signs in here, or (Stay signed in) when the parent
 * has asked it to sign in again by itself. It shares its sessions with the
 * other WilmAI programs on this computer (the CLI, assistants' connectors)
 * through the CLI's session file: when Wilma ends the app's session, the
 * client first continues one of theirs.
 *
 * A family can have a login on each school's Wilma (data/logins.ts). The app
 * shows only when every one of them is signed in; when Wilma ends one, the
 * Wilmas page shows until it's back, and everything already read stays.
 * Different Wilmas don't touch each other's sessions.
 *
 * While signed out, every check (getBack) first looks for a live session
 * another WilmAI program saved (no login), then, staying signed in, signs in.
 * A session the app signed into by itself that Wilma ends again within
 * minutes means that Wilma is in use elsewhere (a browser): the app waits,
 * longer each time, rather than race the parent.
 */

/** A session the app signed into by itself, ended sooner than this: Wilma is in use elsewhere. */
const RACE_MS = 15 * 60_000;
/** Then the app waits this long before signing in again, doubling each time up to the most. */
const PAUSE_MS = 30 * 60_000;
const MOST_PAUSE_MS = 2 * 3_600_000;
/** Staying signed in, per login: when the app last signed it in by itself, and its pause now. */
const paces = new Map<number, { last: number; pause: number }>();
const gettingBack = new Map<number, Promise<boolean>>();

/**
 * Staying signed in, a session just ended: how long to wait before signing in again (0: at once). Ended soon after
 * the app's own sign-in means Wilma is in use elsewhere: 30 minutes, then double each time, at most two hours.
 */
export function rejoinPause(lastAutomaticAt: number, now: number, previousPause: number): number {
  const racing = lastAutomaticAt > 0 && now - lastAutomaticAt < RACE_MS;
  return racing ? Math.min(previousPause ? previousPause * 2 : PAUSE_MS, MOST_PAUSE_MS) : 0;
}

/** Start from what this device remembers: show the cache at once, then refresh. */
export async function resume(saved: SavedSession | null) {
  const snapshot = getState().snapshot;
  if (snapshot?.account.via === "demo") {
    setState({ phase: "ready" });
    void runJev();
    void runLuna();
    return;
  }
  if (!snapshot) {
    setState({ phase: "signed-out" });
    return;
  }
  // Browser development: a session from "Continue as" made before sessions were shared learns its login's key.
  if (saved && !saved.sharedKey && saved.account.via === "cli") {
    saved.sharedKey = (await cliAccounts()).find((a) => a.index === (saved.account.cliIndex ?? 0))?.key;
  }
  await restoreSessions(saved);
  setState({ phase: "signed-out" });
  settle();
  if (getState().phase !== "ready") return;
  void runJev();
  void runLuna();
  void syncNow();
}

/**
 * The family's sessions as the last start left them, or (when Wilma ended one) the session another WilmAI program
 * saved for that login. One with neither waits for the parent (the Wilmas page) or, staying signed in, getBack.
 */
async function restoreSessions(first: SavedSession | null) {
  const snap = getState().snapshot;
  if (!snap) return;
  const scope = accountScope();
  const others = await savedLinkedSessions();
  await Promise.all(
    logins(snap).map(async ({ slot, account }) => {
      if (sessions.has(slot)) return;
      const attempt = beginSignIn(slot, "app");
      const kept = slot ? others[accountKey(account)!] : first && accountKey(first.account) === accountKey(account) ? first : null;
      let state = kept?.state || null;
      const shared = !state && kept?.sharedKey ? await attempt.wait(sharedSessionFor(kept.sharedKey).entry().catch(() => null)).catch(() => null) : null;
      state ||= shared?.state ?? null;
      const options = clientOptions(kept?.sharedKey, attempt);
      const client = state ? WilmaClient.resumeSession(account.baseUrl, state, options) : null;
      if (!attempt.current || scope !== accountScope() || sessions.has(slot)) return;
      if (!client) return setStatus(slot, { live: false, why: null, rejoinAt: null, failed: null });
      attempt.committed = true;
      sessions.set(slot, { client, account, sharedKey: kept?.sharedKey });
      if (shared) recordSession({ kind: "continued", by: shared.by, savedAt: shared.savedAt, midway: false, ...labelOf(account) });
      watchSession(client, options.sharedSession, slot, account);
      setStatus(slot, LIVE);
    })
  );
}

/** What finishing a sign-in notes in the sign-in history. */
type HistoryEvent = Parameters<typeof recordSession>[0] & { kind: "signed-in" | "continued" };

/**
 * A login's Wilma is signed in: its session kept, its children as Wilma lists them now, and its password remembered
 * when passwords are kept. Only the family's first login can be a student's own: a student has one Wilma.
 */
async function finishLogin(
  slot: number,
  account: AccountInfo,
  client: WilmaClient,
  sharedKey: string | undefined,
  event: HistoryEvent,
  opts: { attempt: SignInAttempt; scope: number; students?: Student[]; password?: string; automatic?: boolean; wait?: boolean }
) {
  const { attempt } = opts;
  const students = opts.students?.length ? opts.students : await attempt.wait(client.students());
  // Cancelled (signed out, a newer sign-in, a reset), or another family, meanwhile: this login isn't theirs.
  if (!attempt.current || opts.scope !== accountScope() || !getState().snapshot) dropLate(attempt, client);
  const role = roleOf(students);
  if (role === "student" && logins(getState().snapshot!).some((l) => l.slot !== slot)) {
    await client.logout().catch(() => {});
    throw new Error(t("That's a student's own login. Only a guardian's login can be added."));
  }
  // Accepted: nothing waits from here to the end, so nothing can cancel it halfway.
  attempt.committed = true;
  recordSession({ ...event, ...labelOf(account) });
  const shared = sharedKey ? sharedSessionFor(sharedKey) : undefined;
  client.useSharedSession(shared);
  // The client's own save at its login waited for this: the other WilmAI programs continue the app's new session.
  if (attempt.loggedIn) void shared?.save(client.exportSession()).catch(() => {});
  const before = sessions.get(slot);
  // Another username on the same Wilma: its session isn't needed any more.
  if (before && before.client !== client && before.account.username.toLowerCase() !== account.username.toLowerCase()) void before.client.logout().catch(() => {});
  const known = loginOf(getState().snapshot!, slot);
  // A student's own login reads as a student; the choice in Settings still wins (viewerOf).
  const wilmaRole = role ?? known?.account.wilmaRole ?? account.wilmaRole;
  const signedIn: AccountInfo = { ...account, ...(wilmaRole ? { wilmaRole } : {}) };
  sessions.set(slot, { client, account: signedIn, sharedKey });
  watchSession(client, shared, slot, signedIn);
  keep(slot);
  if (opts.password !== undefined && signedIn.via === "password") rememberPasswordOf(signedIn, opts.password);
  // Another user in this Wilma's place: the one before's password isn't needed any more.
  if (known && accountKey(known.account) !== accountKey(signedIn)) rememberPasswordOf(known.account, null);
  const pace = paces.get(slot) ?? { last: 0, pause: 0 };
  paces.set(slot, opts.automatic ? { ...pace, last: Date.now() } : { last: 0, pause: 0 });
  patchSnapshot((s) => {
    const { signedOut: _, ...was } = loginOf(s, slot) ?? { slot, account: signedIn };
    // An empty answer from Wilma keeps the children it listed before.
    const listed = students.length ? students.map((x) => ({ number: familyChild(slot, x.studentNumber), name: x.name })) : (was.students ?? []);
    const next = [...logins(s).filter((l) => l.slot !== slot), { ...was, slot, account: signedIn, students: listed }].sort((a, b) => a.slot - b.slot);
    return {
      ...s,
      account: accountKey(s.account) === accountKey(signedIn) ? signedIn : s.account,
      logins: next,
      lastSlot: Math.max(s.lastSlot ?? 0, slot),
      children: familyChildren(next),
    };
  }, opts.scope);
  setStatus(slot, LIVE);
  settle();
  if (opts.wait) await syncNow(true);
  else void syncNow(true);
}

/** Wilma's refusals in words for the sign-in page. */
/** Wilma refused the username and password (a remembered password is then forgotten: it was changed). */
export class PasswordRefusedError extends Error {
  constructor() {
    super(t("Wilma didn't accept that username and password."));
    this.name = "PasswordRefusedError";
  }
}

function signInError(err: unknown): Error {
  if (err instanceof AuthenticationError && /OTP|MFA/i.test(err.message)) return new Error(t("Wilma didn't accept that code. Check the code in your authenticator app."));
  if (err instanceof AuthenticationError) return new PasswordRefusedError();
  return err instanceof Error ? err : new Error(String(err));
}

/** The login can't continue (Wilma refused the code twice): start again from the password. */
export class SignInAgainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignInAgainError";
  }
}

/**
 * One login to a Wilma, then `finish` with the client. With the authenticator key the code is made here; without it,
 * when Wilma asks for a two-step code, returns `mfa` for the code the parent types, and a refused code can be typed
 * again once (Wilma's own limit for one login).
 */
async function logIn(
  credentials: { baseUrl: string; username: string; password: string },
  totpSecret: string | null | undefined,
  sharedKey: string,
  attempt: SignInAttempt,
  finish: (client: WilmaClient) => Promise<void>
): Promise<Next> {
  attempt.assertCurrent();
  const options = { ...clientOptions(sharedKey, attempt), relogin: false };
  /** The login, ended in Wilma too when it finishes after its sign-in was cancelled. */
  const started = (login: Promise<WilmaClient>) => {
    login.then((client) => {
      if (!attempt.current && !attempt.committed) {
        attempt.ending = true;
        void client.logout().catch(() => {});
      }
    }, () => {});
    return login;
  };
  if (totpSecret) {
    const client = await attempt.wait(started(WilmaClient.login(credentials, totpCallback(totpSecret), options))).catch((err) => {
      throw signInError(err);
    });
    await finish(client);
    return null;
  }
  let giveCode: ((code: string) => void) | null = null;
  let codeAsked: () => void = () => {};
  let asked = new Promise<void>((resolve) => (codeAsked = resolve));
  const onMfa = () =>
    new Promise<string>((resolve) => {
      giveCode = resolve;
      codeAsked();
    });
  const login = started(WilmaClient.login(credentials, onMfa, options));
  const first = await attempt.wait(Promise.race([login.then((client) => client), asked.then(() => null)])).catch((err) => {
    throw signInError(err);
  });
  if (first) {
    await finish(first);
    return null;
  }
  return {
    mfa: async (code: string) => {
      attempt.assertCurrent();
      asked = new Promise<void>((resolve) => (codeAsked = resolve));
      giveCode?.(code.trim());
      // Either the login finishes, or Wilma refused the code and asks again.
      const client = await attempt.wait(Promise.race([login, asked.then(() => null)])).catch((err) => {
        if (err instanceof SignInCancelledError) throw err;
        throw new SignInAgainError(t("{error} Sign in again with your password.", { error: signInError(err).message }));
      });
      if (!client) throw new Error(t("Wilma didn't accept that code. Type the newest code from your authenticator app."));
      await finish(client);
    },
  };
}

/**
 * A login the WilmAI CLI saved on this computer (no secrets). New sign-ins type the password; logins made with the
 * CLI's saved login before still sign in with it (signInLogin).
 */
interface CliAccount {
  index: number;
  /** The CLI's id for the login (desktop app). */
  id?: string;
  baseUrl: string;
  username: string;
  tenantName: string | null;
  hasTotp?: boolean;
  /** The shared session's key (browser setup). */
  key?: string;
}

async function cliAccounts(): Promise<CliAccount[]> {
  try {
    return (await bridgeCall<{ accounts: CliAccount[] }>("cli/accounts")).accounts;
  } catch {
    return [];
  }
}

type Finish = (account: AccountInfo, client: WilmaClient, sharedKey: string | undefined, event: HistoryEvent, students?: Student[]) => Promise<void>;

/**
 * A login made with the CLI's saved login, signed in again with it. First a live session another WilmAI program saved
 * (no login, so Wilma on the phone stays signed in too), and only when there is none, a login with the saved password
 * (and code, when the CLI keeps the authenticator key). Returns `mfa` when Wilma asks for a code it can't make.
 */
async function cliLogIn(account: AccountInfo, cli: CliAccount, automatic: boolean, attempt: SignInAttempt, finish: Finish): Promise<Next> {
  if (!isDesktopApp) {
    // Browser development: the bridge continues or makes the CLI's session itself and hands it over.
    const data = await attempt.wait(
      bridgeCall<{ tenantName: string | null; students: Student[]; state: string; key: string; continued: { savedAt: number | null; by: string | null } | null }>("cli/session", { body: { index: cli.index } })
    );
    const client = WilmaClient.resumeSession(account.baseUrl, data.state, clientOptions(data.key, attempt));
    if (!client) throw new Error(t("The CLI's login has no Wilma session."));
    const event: HistoryEvent = data.continued ? { kind: "continued", ...data.continued, midway: false } : { kind: "signed-in", how: "saved-login" };
    await finish({ ...account, tenantName: data.tenantName ?? account.tenantName }, client, data.key, event, data.students);
    return null;
  }
  const secret = await attempt.wait(savedLoginSecret(cli.id ?? "")).catch((err) => {
    if (err instanceof SignInCancelledError) throw err;
    throw new Error(t(err instanceof Error ? err.message : String(err)));
  });
  const sharedKey = await attempt.wait(sharedKeyFor(account.baseUrl, account.username, secret.password));
  const entry = await attempt.wait(sharedSessionFor(sharedKey).entry().catch(() => null));
  const client = entry ? WilmaClient.resumeSession(account.baseUrl, entry.state, clientOptions(sharedKey, attempt)) : null;
  if (entry && client) {
    try {
      const students = await attempt.wait(client.students());
      await finish(account, client, sharedKey, { kind: "continued", by: entry.by, savedAt: entry.savedAt, midway: false }, students);
      return null;
    } catch (err) {
      // Ended too: sign in below. Anything else (Wilma unreachable) is for the parent to see.
      if (!(err instanceof SessionEndedError)) throw err;
    }
  }
  const event: HistoryEvent = { kind: "signed-in", how: automatic ? "automatic" : "saved-login" };
  return logIn({ baseUrl: account.baseUrl, username: account.username, password: secret.password }, secret.totpSecret, sharedKey, attempt, (c) => finish(account, c, sharedKey, event));
}

/** The school's name for a Wilma address, from the list of Wilmas. */
const tenantNameOf = (baseUrl: string): string | null => TENANTS.find((x) => sameWilma(x.url, baseUrl))?.name ?? null;

/**
 * The first sign-in on the start page: a new family, or (a login of a family on this computer, its first or one added
 * to it) that family back, with its other Wilmas to sign in too.
 */
async function startFamily(
  attempt: SignInAttempt,
  account: AccountInfo,
  client: WilmaClient,
  sharedKey: string | undefined,
  event: HistoryEvent,
  students: Student[] | undefined,
  viewAs: Viewer | undefined,
  password?: string
) {
  // Read before the family shows, so the screens go straight from the start page to signed in (no wait in between).
  const listed = students?.length ? students : await attempt.wait(client.students());
  // Cancelled meanwhile (the sample family picked, say): the family doesn't take the page's place.
  if (!attempt.current) dropLate(attempt, client);
  const family = familyFor(account) ?? account;
  if (accountKey(getState().snapshot?.account) !== accountKey(family)) activateAccount(family);
  if (!getState().snapshot) setState({ snapshot: emptySnapshot(account) });
  if (viewAs) setViewAs(viewAs);
  const snap = getState().snapshot!;
  const known = logins(snap).find((l) => sameWilma(l.account.baseUrl, account.baseUrl));
  const slot = known?.slot ?? (logins(snap).some((l) => l.slot === 0) ? slotFor(snap, account) : 0);
  await finishLogin(slot, account, client, sharedKey, event, { attempt, scope: accountScope(), students: listed, password });
}

/**
 * Sign in on the start page with the parent's username and password. When Wilma asks for a two-step code, returns
 * `mfa` for the code the parent types. A saved login (`saved`) answers the code itself when it has the authenticator
 * key.
 */
export async function signInWithPassword(
  baseUrl: string,
  username: string,
  password: string,
  saved?: { account: AccountInfo; totpSecret: string | null },
  automatic = false,
  viewAs?: Viewer
): Promise<Next> {
  const attempt = beginSignIn(START, automatic ? "app" : "parent");
  await attempt.wait(endingSession);
  const base = baseUrl.replace(/\/$/, "");
  const account: AccountInfo = saved?.account ?? { baseUrl: base, username, tenantName: tenantNameOf(base), via: "password" };
  const event: HistoryEvent = { kind: "signed-in", how: automatic ? "automatic" : saved ? "saved-login" : "password" };
  // The CLI's key for this login: the app and the other WilmAI programs then share one session.
  const sharedKey = await attempt.wait(sharedKeyFor(account.baseUrl, username, password));
  return logIn({ baseUrl: account.baseUrl, username, password }, saved?.totpSecret, sharedKey, attempt, (client) =>
    startFamily(attempt, account, client, sharedKey, event, undefined, viewAs, account.via === "password" ? password : undefined)
  );
}

/* ------------------------------------------------------------------ */
/*  The family's Wilmas                                                */
/* ------------------------------------------------------------------ */

/** Whether a Wilma can be added: to a parent's family only (a student has one Wilma), and each Wilma once. */
function checkAddable(baseUrl: string): Snapshot {
  const snap = getState().snapshot;
  if (!snap || snap.account.via === "demo") throw new Error(t("Sign in to your own Wilma first."));
  if (viewer() === "student") throw new Error(t("Only a parent's account can have other Wilmas added."));
  if (logins(snap).some((l) => sameWilma(l.account.baseUrl, baseUrl))) throw new Error(t("This Wilma is in the app already."));
  return snap;
}

/** Add a guardian's login on another school's Wilma. Returns `mfa` when Wilma asks for a two-step code. */
export async function addWilma(baseUrl: string, username: string, password: string): Promise<Next> {
  const base = baseUrl.replace(/\/$/, "");
  const snap = checkAddable(base);
  const slot = slotFor(snap, { baseUrl: base });
  const account: AccountInfo = { baseUrl: base, username, tenantName: tenantNameOf(base), via: "password" };
  const attempt = beginSignIn(slot, "parent");
  const sharedKey = await attempt.wait(sharedKeyFor(base, username, password));
  const scope = accountScope();
  return logIn({ baseUrl: base, username, password }, null, sharedKey, attempt, (client) =>
    finishLogin(slot, account, client, sharedKey, { kind: "signed-in", how: "password" }, { attempt, scope, password })
  );
}

/** Whether a login signs in without the parent typing: its password is remembered, or it's the CLI's saved login. */
export function loginKept(account: AccountInfo): boolean {
  return account.via === "cli" || Boolean(passwordOf(account));
}

/**
 * Sign one of the family's Wilmas in: with the password typed, else the remembered one or the CLI's saved login. With
 * another `username`, that user takes the Wilma's place (signed in, its children are the ones Wilma lists for them).
 * Returns `mfa` when Wilma asks for a two-step code.
 */
export async function signInLogin(
  slot: number,
  password?: string,
  automatic = false,
  username?: string,
  attempt = beginSignIn(slot, automatic ? "app" : "parent")
): Promise<Next> {
  await attempt.wait(endingSession);
  const snap = getState().snapshot;
  const known = snap ? accountOf(snap, slot) : null;
  if (!known) throw new Error(t("That Wilma isn't in the app any more."));
  const account = otherUser(known, username) ? { ...known, username: username!.trim(), via: "password" as const } : known;
  const scope = accountScope();
  if (account.via === "cli" && !password) {
    const cli = (await attempt.wait(cliAccounts())).find((a) => sameWilma(a.baseUrl, account.baseUrl) && a.username.toLowerCase() === account.username.toLowerCase());
    if (!cli) throw new Error(t("The WilmAI CLI's saved login isn't on this computer any more."));
    return cliLogIn(account, cli, automatic, attempt, (named, client, sharedKey, event, students) => finishLogin(slot, named, client, sharedKey, event, { attempt, scope, students, automatic }));
  }
  const typed = password || passwordOf(account);
  if (!typed) throw new Error(t("Type the password for this Wilma."));
  const sharedKey = await attempt.wait(sharedKeyFor(account.baseUrl, account.username, typed));
  const event: HistoryEvent = { kind: "signed-in", how: automatic ? "automatic" : "password" };
  const signedIn = account.via === "cli" ? { ...account, via: "password" as const } : account;
  try {
    return await logIn({ baseUrl: account.baseUrl, username: account.username, password: typed }, null, sharedKey, attempt, (client) =>
      finishLogin(slot, signedIn, client, sharedKey, event, { attempt, scope, password: typed, automatic })
    );
  } catch (err) {
    // Changed in Wilma: forgotten, so the parent types the new one (not by a sign-in that was cancelled meanwhile).
    if (err instanceof PasswordRefusedError && !password && attempt.current) rememberPasswordOf(account, null);
    throw err;
  }
}

/** Another username than the Wilma's own, typed on the Wilma page. */
const otherUser = (account: AccountInfo, username?: string) => Boolean(username?.trim()) && username!.trim().toLowerCase() !== account.username.toLowerCase();

/** A Wilma back in without a login: the live session another WilmAI program saved for it, if there's one. */
async function continueShared(slot: number, attempt: SignInAttempt): Promise<boolean> {
  const snap = getState().snapshot;
  const account = snap ? accountOf(snap, slot) : null;
  if (!account || sessions.has(slot)) return false;
  const scope = accountScope();
  const kept = slot ? (await attempt.wait(savedLinkedSessions()))[accountKey(account)!] : await attempt.wait(savedSession());
  if (!kept?.sharedKey || accountKey(kept.account) !== accountKey(account)) return false;
  const entry = await attempt.wait(sharedSessionFor(kept.sharedKey).entry().catch(() => null));
  const client = entry ? WilmaClient.resumeSession(account.baseUrl, entry.state, clientOptions(kept.sharedKey, attempt)) : null;
  if (!entry || !client) return false;
  try {
    const students = await attempt.wait(client.students());
    await finishLogin(slot, account, client, kept.sharedKey, { kind: "continued", by: entry.by, savedAt: entry.savedAt, midway: false }, { attempt, scope, students });
    return true;
  } catch (err) {
    if (err instanceof SessionEndedError) return false;
    throw err;
  }
}

/** What signing a Wilma in came to: in, a code or the password to ask, why not, or cancelled (nothing to show). */
export type Attempt = { ok: true } | { mfa: (code: string) => Promise<void> } | { password: true } | { error: string } | { cancelled: true };

/** What came of signing in, in words for the page: in, a code or the password to ask, or why not. */
async function attempt(sign: () => Promise<Next>): Promise<Attempt> {
  try {
    const next = await sign();
    return next ? { mfa: next.mfa } : { ok: true };
  } catch (err) {
    if (err instanceof SignInCancelledError) return { cancelled: true };
    if (err instanceof PasswordRefusedError) return { password: true };
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** One Wilma in: another WilmAI program's live session first (no login), else a login with what's typed or kept. */
export async function signInOne(slot: number, password?: string): Promise<Attempt> {
  return attempt(async () => {
    const snap = getState().snapshot;
    const account = snap ? accountOf(snap, slot) : null;
    const signing = beginSignIn(slot, "parent");
    if (!password && (await continueShared(slot, signing))) return null;
    if (!password && account && !loginKept(account)) throw new PasswordRefusedError();
    return signInLogin(slot, password, false, undefined, signing);
  });
}

/** Every Wilma of the family that isn't signed in, at once (signInOne each), with the passwords typed, by slot; less `skip`. */
export async function signInAll(typed: Record<number, string> = {}, skip: number[] = []): Promise<Record<number, Attempt>> {
  const snap = getState().snapshot;
  if (!snap) return {};
  const waiting = logins(snap).filter((l) => !sessions.has(l.slot) && !skip.includes(l.slot));
  const results = await Promise.all(waiting.map(async (l) => [l.slot, await signInOne(l.slot, typed[l.slot] || undefined)] as const));
  return Object.fromEntries(results);
}

/**
 * A signed-out Wilma of the family signed in as another login (Change user on the Wilma page): another user, another
 * school's Wilma, or both. With one Wilma that's another account: its own family, as on an empty page (this one stays
 * on this computer, back when its login signs in). With more, that Wilma's place: the same school's other user, or
 * the other school's Wilma instead of it (once it's in). The same login is just signed in.
 */
export async function changeLogin(slot: number, baseUrl: string, username: string, password: string, viewAs?: Viewer): Promise<Attempt> {
  const known = getState().snapshot ? loginOf(getState().snapshot!, slot) : null;
  const base = baseUrl.replace(/\/$/, "");
  // Whatever was signing this Wilma in (the app by itself, say) gives way to the parent's choice.
  cancelSignIn(slot);
  if (known && sameWilma(base, known.account.baseUrl) && !otherUser(known.account, username)) return signInOne(slot, password || undefined);
  return attempt(async () => {
    const snap = getState().snapshot;
    const login = snap ? loginOf(snap, slot) : null;
    if (!snap || !login) throw new Error(t("That Wilma isn't in the app any more."));
    const school = sameWilma(base, login.account.baseUrl);
    if (!password) throw new PasswordRefusedError();
    if (logins(snap).length === 1) return signInWithPassword(base, username.trim(), password, undefined, false, viewAs);
    if (school) return signInLogin(slot, password, false, username);
    const next = await addWilma(base, username.trim(), password);
    if (!next) return void (await removeWilma(slot)), null;
    return { mfa: async (code: string) => (await next.mfa(code), await removeWilma(slot)) };
  });
}

/**
 * While signed out (the background check, every ten minutes): each Wilma not signed in back without the parent, if
 * there's a way (getBackLogin). True when every Wilma is in.
 */
export async function getBack(): Promise<boolean> {
  const snap = getState().snapshot;
  if (getState().phase !== "signed-out" || !snap || snap.account.via === "demo") return false;
  await Promise.all(logins(snap).filter((l) => !sessions.has(l.slot)).map((l) => getBackLogin(l.slot)));
  return getState().phase === "ready";
}

/**
 * One Wilma back without the parent: another WilmAI program's live session (no login), else, staying signed in and
 * not pausing, a login with what's kept. Never one the parent signed out of. Wilma asking for a two-step code the app
 * can't give, or refusing the login, ends trying until the parent signs it in.
 */
function getBackLogin(slot: number): Promise<boolean> {
  const pending = gettingBack.get(slot);
  if (pending) return pending;
  const trying = (async () => {
    const { snapshot, settings, loginStatus } = getState();
    const login = snapshot ? loginOf(snapshot, slot) : null;
    if (!login || login.signedOut || sessions.has(slot) || parentSigningIn(slot)) return false;
    const scope = accountScope();
    const signing = beginSignIn(slot, "app");
    try {
      if (await continueShared(slot, signing)) return true;
    } catch {
      return false; // Wilma unreachable: the next check tries again
    }
    const status = loginStatus[slot];
    if (!settings.staySignedIn || !loginKept(login.account) || status?.failed || (status?.rejoinAt && Date.now() < status.rejoinAt)) return false;
    try {
      if (await signInLogin(slot, undefined, true, undefined, signing)) throw new Error(t("Wilma asked for a two-step code."));
      return true;
    } catch (err) {
      // Cancelled (signed out, or the parent signing in themself): nothing to say about it.
      if (err instanceof SignInCancelledError || !signing.current) return false;
      const why = err instanceof Error ? err.message : String(err);
      if (scope === accountScope()) setStatus(slot, { live: false, why: t("Signing in again didn't work: {why}", { why }), rejoinAt: null, failed: why });
      return false;
    }
  })().finally(() => gettingBack.delete(slot));
  gettingBack.set(slot, trying);
  return trying;
}

/**
 * Wilma ended a login's session: Sign in again shows until it's back. Staying signed in, it signs in again by
 * itself, at once or (ended soon after the app's own sign-in: that Wilma is in use elsewhere) after a pause.
 */
function endLogin(slot: number) {
  const session = sessions.get(slot);
  if (!session) return;
  sessions.delete(slot);
  void recordEnd(session.client.exportSession(), session.sharedKey, labelOf(session.account).wilma);
  // Its shared key stays: the next check continues a session another WilmAI program saved meanwhile.
  void forgetSession(slot, session.account, session.sharedKey);
  const { settings, loginStatus } = getState();
  if (settings.staySignedIn && !loginStatus[slot]?.failed) {
    const pace = paces.get(slot) ?? { last: 0, pause: 0 };
    pace.pause = rejoinPause(pace.last, Date.now(), pace.pause);
    paces.set(slot, pace);
    const at = pace.pause ? Date.now() + pace.pause : null;
    setStatus(slot, {
      live: false,
      why: at ? t("Wilma ended the session again soon after: it seems to be in use elsewhere. The app signs in again at {time}.", { time: clock(new Date(at)) }) : t("Wilma ended the session. Signing in again…"),
      rejoinAt: at,
      failed: null,
    });
    settle();
    if (!at) void getBackLogin(slot);
    return;
  }
  setStatus(slot, { live: false, why: t("Wilma ended the session."), rejoinAt: null, failed: null });
  settle();
}

/** Sign out of one Wilma (to use it in a browser, say): Sign in again shows until the parent signs it in. Its password stays. */
export async function signOutWilma(slot: number) {
  const snap = getState().snapshot;
  const login = snap ? loginOf(snap, slot) : null;
  if (!login) return;
  cancelSignIn(slot);
  const session = sessions.get(slot);
  sessions.delete(slot);
  patchSnapshot((s) => ({ ...s, logins: logins(s).map((l) => (l.slot === slot ? { ...l, signedOut: true } : l)) }));
  setStatus(slot, { live: false, why: t("You signed out."), rejoinAt: null, failed: null });
  settle();
  await forgetSession(slot, login.account);
  await session?.client.logout().catch(() => {});
}

/** Take a Wilma out of the app: its session ends, and its children and what was read from it go. The last one signs out. */
export async function removeWilma(slot: number) {
  const snap = getState().snapshot;
  const login = snap ? loginOf(snap, slot) : null;
  if (!snap || !login) return;
  if (logins(snap).length === 1) return signOut();
  cancelSignIn(slot);
  const session = sessions.get(slot);
  sessions.delete(slot);
  paces.delete(slot);
  rememberPasswordOf(login.account, null);
  patchSnapshot((s) => {
    const theirs = (child: string) => loginOfChild(child) === slot;
    const ours = <T,>(items: Record<number, T>) => Object.fromEntries(Object.entries(items).filter(([id]) => loginOfId(Number(id)) !== slot)) as Record<number, T>;
    const next = logins(s).filter((l) => l.slot !== slot);
    return {
      ...s,
      logins: next,
      lastSlot: Math.max(s.lastSlot ?? 0, slot),
      children: familyChildren(next),
      perChild: Object.fromEntries(Object.entries(s.perChild).filter(([child]) => !theirs(child))),
      messages: ours(s.messages),
      news: ours(s.news),
    };
  });
  setStatus(slot, null);
  settle();
  await forgetSession(slot, login.account);
  await session?.client.logout().catch(() => {});
  if (getState().phase === "ready") void syncNow();
}

/** Show a child (ticked) or not. An unticked child isn't read from Wilma, and what was read about them stays. */
export function setChildShown(child: string, shown: boolean) {
  const slot = loginOfChild(child);
  patchSnapshot((s) => {
    const next = logins(s).map((l): Login => {
      if (l.slot !== slot) return l;
      const hidden = (l.hidden ?? []).filter((c) => c !== child);
      return { ...l, hidden: shown ? hidden : [...hidden, child] };
    });
    return { ...s, logins: next, children: familyChildren(next) };
  });
  if (shown && getState().phase === "ready") void syncNow(true);
}

/** A family signed in here before, back on the Wilma page (one click to sign in when its passwords are kept). */
export function openFamily(account: AccountInfo) {
  cancelSignIns();
  activateAccount(account);
  setState({ phase: "signed-out" });
}

/** End every session of the family on this computer (Wilma's own Log out), without waiting, and every sign-in under way. */
function endSessions() {
  cancelSignIns();
  const previous = [...sessions.values()];
  sessions.clear();
  paces.clear();
  endingSession = Promise.all(previous.map((session) => session.client.logout().catch(() => {})));
}

export async function signInDemo() {
  endSessions();
  const demo = demoSnapshot();
  activateAccount(demo.account);
  setState({ snapshot: getState().snapshot ?? demo, phase: "ready" });
  await saveSession(null);
  await saveLinkedSession(null, null);
  await flushPersisted();
  void runJev();
  void runLuna();
}

/** Back from the sample family to the Wilma page: the family signed in here last, or an empty page. */
export async function leaveDemo() {
  cancelSignIns();
  activateAccount(null);
  const [family] = knownFamilies();
  if (family) openFamily(family.account);
  setState({ phase: "signed-out" });
  await flushPersisted();
}

/** Delete this family's data from this computer (its children, AI answers and passwords): an empty Wilma page, as at first. */
export async function forgetThisFamily() {
  const snap = getState().snapshot;
  endSessions();
  activateAccount(null);
  if (snap) forgetFamily(snap.account);
  setState({ phase: "signed-out" });
  await saveSession(null);
  await saveLinkedSession(null, null);
  await flushPersisted();
  await endingSession;
}

/**
 * Sign out of every Wilma of the family: the Wilma page shows, with the family as it was and (as chosen there) its
 * passwords, so signing in again is one click. Signed out by the parent, nothing signs in by itself.
 */
export async function signOut() {
  endSessions();
  const snap = getState().snapshot;
  if (snap && snap.account.via !== "demo") {
    patchSnapshot((s) => ({ ...s, logins: logins(s).map((l) => ({ ...l, signedOut: true })) }));
    for (const l of logins(snap)) setStatus(l.slot, { live: false, why: t("You signed out."), rejoinAt: null, failed: null });
  }
  setState({ phase: "signed-out" });
  await saveSession(null); // Deliberate sign-out must never automatically rejoin.
  await saveLinkedSession(null, null);
  await flushPersisted();
  await endingSession;
}

/** Explicit destructive reset, separate from ending a Wilma session. */
export async function resetApp() {
  endSessions();
  activateAccount(null);
  setState({ phase: "loading" });
  try {
    await saveSession(null);
    await saveLinkedSession(null, null);
    await flushPersisted();
    await endingSession;
    await forgetEverything();
    await clearReports();
  } finally {
    setState({ phase: "signed-out" });
  }
}

/** Logins whose role was asked for in this run. */
const roleAsked = new Set<string>();

/** Whose login it is: a student's own when Wilma lists only the student themself, a guardian's when it says so. */
function roleOf(students: { role?: Viewer }[]): Viewer | undefined {
  if (students.length && students.every((s) => s.role === "student")) return "student";
  return students.some((s) => s.role === "guardian") ? "guardian" : undefined;
}

/** A session that Wilma ended, or a login it refused. */
const sessionGone = (err: unknown) => err instanceof SessionEndedError || err instanceof AuthenticationError;

/** What went wrong reading Wilma: a login's session ended (`slot`: whose), or anything else, said in the sync line. */
function handleError(err: unknown, slot = 0) {
  if (sessionGone(err)) return endLogin(slot);
  setState((s) => ({ sync: { ...s.sync, running: false, step: null, error: err instanceof Error ? err.message : String(err) } }));
}

/**
 * The sign-in history's note on an ended session: whether another WilmAI
 * program's login (saved in the shared file, a different session from this
 * app's) is what ended it, or none did, which leaves Wilma on a phone or in
 * a browser, or Wilma's own time limit.
 */
async function recordEnd(ourState: string, sharedKey: string | undefined, wilma?: string) {
  const entry = sharedKey ? await sharedSessionFor(sharedKey).entry().catch(() => null) : null;
  // A session this app saved itself isn't another program's login (its cookie may since have been renewed).
  const other = Boolean(entry && entry.by !== "home" && sessionCookieOf(entry.state) && sessionCookieOf(entry.state) !== sessionCookieOf(ourState));
  recordSession({
    kind: "ended",
    other,
    by: other ? (entry?.by ?? null) : null,
    savedAt: other ? (entry?.savedAt ?? null) : null,
    lastOk: getState().sync.lastOk,
    ...(wilma ? { wilma } : {}),
  });
}

/**
 * Wilma ended the session while the parent was doing something (writing a
 * message): note it in the history and show the Wilmas page, where a
 * remembered password is one click. The route stays, so the parent comes
 * back to the same screen, and drafts are kept on this device.
 */
export function signInAgain(slot = 0): void {
  handleError(new SessionEndedError(), slot);
}

export const isSessionEnded = (err: unknown): boolean => err instanceof SessionEndedError;

/**
 * Keep the sessions alive while the app is open but out of sight (Wilma ends
 * idle sessions; the app refreshes every ten minutes only while it shows).
 * One small read each; never a login. A session found ended goes the usual way.
 */
export async function keepAlive(): Promise<void> {
  if (!sessions.size || syncing) return;
  const scope = accountScope();
  await Promise.all(
    [...sessions].map(async ([slot, session]) => {
      try {
        await session.client.students();
      } catch (err) {
        if (scope === accountScope() && sessionOf(slot) === session && sessionGone(err)) handleError(err, slot);
      }
    })
  );
}

/* ------------------------------------------------------------------ */
/*  Sync                                                               */
/* ------------------------------------------------------------------ */

function patchSnapshot(update: (snap: Snapshot) => Snapshot, scope = accountScope()) {
  if (scope !== accountScope()) return;
  const snap = getState().snapshot;
  if (snap) setState({ snapshot: update(snap) });
}

/** Children in the family's order (not in the order a sync happened to read them). */
function inFamilyOrder(numbers: string[]): string[] {
  const family = getState().snapshot?.children.map((c) => c.number) ?? [];
  const rank = (n: string) => (family.includes(n) ? family.indexOf(n) : family.length);
  return [...new Set(numbers)].sort((a, b) => rank(a) - rank(b));
}

function mergeMessages(current: Record<number, MessageRec>, lists: [string, Message[]][]): Record<number, MessageRec> {
  const next: Record<number, MessageRec> = {};
  for (const [child, list] of lists) {
    for (const m of list) {
      const before = next[m.wilmaId] ?? current[m.wilmaId];
      const replyCount = m.replyCount ?? 0;
      next[m.wilmaId] = {
        id: m.wilmaId,
        subject: m.subject,
        sender: m.senderName ?? null,
        sentAt: m.sentAt,
        unreadInWilma: Boolean(m.unread),
        replyCount,
        children: inFamilyOrder([...(next[m.wilmaId]?.children ?? []), child]),
        // A new reply means the thread must be read again.
        thread: before?.thread && before.replyCount === replyCount ? before.thread : undefined,
      };
    }
  }
  return next;
}

/**
 * Adds what the family sent, from Wilma's Sent folder. A thread someone answered is in the inbox too, and the inbox's
 * listing wins (its sender is the family, data/feed.ts).
 */
export function withSent(next: Record<number, MessageRec>, before: Record<number, MessageRec>, lists: [string, Message[]][]): Record<number, MessageRec> {
  for (const [child, list] of lists) {
    for (const m of list) {
      const listed = next[m.wilmaId];
      if (listed && !listed.sent) continue;
      const was = listed ?? before[m.wilmaId];
      const replyCount = m.replyCount ?? 0;
      next[m.wilmaId] = {
        id: m.wilmaId,
        subject: m.subject,
        // Who the Sent folder names isn't the sender; the thread says who it went to.
        sender: null,
        sentAt: m.sentAt,
        unreadInWilma: false,
        replyCount,
        children: inFamilyOrder([...(listed?.children ?? []), child]),
        thread: was?.thread && was.replyCount === replyCount ? was.thread : undefined,
        sent: true,
      };
    }
  }
  return next;
}

/** Wilma's Sent folder read again after a message goes, so it shows at once, with its text. */
async function loadSent(child: string) {
  const scope = accountScope();
  const slot = loginOfChild(child);
  const sent = (await kid(child).messages.list("outbox")).map((m) => ({ ...m, wilmaId: familyId(slot, m.wilmaId) }));
  if (scope !== accountScope()) return;
  patchSnapshot((s) => ({ ...s, messages: withSent({ ...s.messages }, s.messages, [[child, sent]]) }), scope);
  const unread = sent.filter((m) => !getState().snapshot?.messages[m.wilmaId]?.thread).slice(0, 3);
  await Promise.all(unread.map((m) => loadThread(m.wilmaId)));
}

/** Marks invitations, and reads one again when its sign-up state changed in Wilma. */
function withInvites(next: Record<number, MessageRec>, before: Record<number, MessageRec>, lists: [string, InvitationListing[]][]): Record<number, MessageRec> {
  for (const [, list] of lists) {
    for (const { message, status, extra } of list) {
      const rec = next[message.wilmaId];
      if (!rec) continue;
      const changed = before[message.wilmaId]?.invite?.status !== status;
      next[message.wilmaId] = { ...rec, invite: { status, extra }, thread: changed ? undefined : rec.thread };
    }
  }
  return next;
}

function mergeNews(current: Record<number, NewsRec>, lists: [string, NewsItem[]][]): Record<number, NewsRec> {
  const next: Record<number, NewsRec> = {};
  for (const [child, list] of lists) {
    for (const n of list) {
      const before = next[n.wilmaId] ?? current[n.wilmaId];
      next[n.wilmaId] = {
        id: n.wilmaId,
        title: n.title,
        subtitle: n.subtitle ?? null,
        author: n.author ?? null,
        published: n.published ?? null,
        pinned: Boolean(n.pinned),
        children: inFamilyOrder([...(next[n.wilmaId]?.children ?? []), child]),
        // Text read by an older wilma-client (bulletins kept the page's raw layout before 2) is read again.
        detail: before?.detail?.v === NEWS_TEXT_V ? before.detail : undefined,
      };
    }
  }
  return next;
}

/**
 * Read Wilma now (one sync at a time). `again`: something changed that a running sync may have missed (a Wilma was
 * added), so read once more after it.
 */
export function syncNow(again = false): Promise<void> {
  if (!sessions.size) return Promise.resolve();
  if (syncing) {
    syncAgain ||= again;
    return syncing;
  }
  syncing = (async () => {
    do {
      syncAgain = false;
      const scope = accountScope();
      await runSync();
      // Another account meanwhile: read it too.
      if (scope !== accountScope()) syncAgain = true;
    } while (syncAgain && sessions.size);
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

/** What one login's Wilma listed for its children, with family ids (data/logins.ts). */
interface LoginLists {
  messages: [string, Message[]][];
  sent: [string, Message[]][];
  news: [string, NewsItem[]][];
  invites: [string, InvitationListing[]][];
}

/** One login's records of the family's messages or bulletins (their ids carry the login). */
function ofLogin<T>(items: Record<number, T>, slot: number): Record<number, T> {
  return Object.fromEntries(Object.entries(items).filter(([id]) => loginOfId(Number(id)) === slot)) as Record<number, T>;
}

async function runSync() {
  const scope = accountScope();
  const current = () => scope === accountScope() && sessions.size > 0;
  const patch = (update: (snap: Snapshot) => Snapshot) => patchSnapshot(update, scope);
  const snap = getState().snapshot;
  if (!snap || !sessions.size) return;
  const step = (text: string) => current() && setState((s) => ({ sync: { ...s.sync, running: true, step: text, error: null } }));
  step(t("Checking Wilma"));
  const now = today();
  const monday = mondayOf(now);
  const reading = new Map(sessions);
  // At most three requests at a time to each Wilma.
  const limits = new Map([...reading.keys()].map((slot) => [slot, limiter(3, () => current() && Boolean(sessionOf(slot)))] as const));
  const lists = new Map<number, LoginLists>();
  const failed = new Map<number, unknown>();
  try {
    // A login whose Wilma listed no children when it signed in asks again; an installation from before the role was
    // read learns it, once per run (Wilmas without the roles API never say).
    await Promise.all(
      logins(snap).map(async (login) => {
        const session = reading.get(login.slot);
        const identity = accountKey(login.account) === accountKey(snap.account);
        const askRole = identity && !snap.account.wilmaRole && !roleAsked.has(snap.account.username);
        if (!session || (login.students?.length && !askRole)) return;
        if (identity) roleAsked.add(snap.account.username);
        try {
          const students = await session.client.students();
          const wilmaRole = roleOf(students);
          patch((s) => {
            const next = logins(s).map((l) => (l.slot !== login.slot ? l : { ...l, students: l.students?.length ? l.students : students.map((x) => ({ number: familyChild(l.slot, x.studentNumber), name: x.name })) }));
            return { ...s, logins: next, children: familyChildren(next), account: identity && wilmaRole ? { ...s.account, wilmaRole } : s.account };
          });
        } catch (err) {
          failed.set(login.slot, err);
        }
      })
    );
    if (!current()) return;
    const children = getState().snapshot!.children;

    // Each Wilma at once: one ending its session leaves the others' reading as it is.
    await Promise.all(
      [...reading.keys()].filter((slot) => !failed.has(slot)).map(async (slot) => {
        const limit = limits.get(slot)!;
        const read: LoginLists = { messages: [], sent: [], news: [], invites: [] };
        // Wilma's ids, as the family's (the first login's stay as they are).
        const ours = <T extends { wilmaId: number }>(list: T[]) => list.map((m) => ({ ...m, wilmaId: familyId(slot, m.wilmaId) }));
        try {
          await Promise.all(
            children.filter((child) => loginOfChild(child.number) === slot).map(async (child) => {
              const c = kid(child.number);
              const overview = await limit(() => c.overview.get());
              const [lessons, messages, sent, news, notes, calendar, invites] = await Promise.all([
                limit(() => c.schedule.list({ from: monday, to: addDays(monday, 13) })),
                limit(() => c.messages.list("inbox")),
                // What the family sent and nobody has answered yet is only in the Sent folder.
                limit(() => c.messages.list("outbox")),
                // Some Wilmas refuse a guardian's bulletins page (Helsinki answers /news with 403): no bulletins, not nothing read.
                limit(() => c.news.list().catch((err) => (err instanceof APIError && (err.status === 403 || err.status === 404) ? [] : Promise.reject(err)))),
                // The weeks ahead too: a teacher may note a make-up exam on a coming lesson (for the calendar).
                limit(() => c.attendance.list({ from: addDays(now, -20), to: addDays(now, 60) })),
                // Start times are a bonus; upcoming exams themselves come with the overview.
                limit(() => c.exams.calendarOrEmpty()),
                limit(() => c.invitations.list().catch((err) => (err instanceof SessionEndedError ? Promise.reject(err) : []))),
              ]);
              const exams = addExamTimes(overview.upcomingExams, calendar);
              // The class, once a week (one page): the readers tell an "8. lk" event from the child's own by it.
              const known = getState().snapshot?.perChild[child.number]?.className;
              const className =
                known && Date.now() - new Date(known.fetchedAt).getTime() < 7 * 86_400_000
                  ? known
                  : await limit(() => c.student.get())
                      .then((details) => ({ value: details.className, fetchedAt: new Date() }))
                      .catch((err) => (err instanceof SessionEndedError ? Promise.reject(err) : known));
              read.messages.push([child.number, ours(messages)], [child.number, ours(invites.map((i) => i.message))]);
              read.sent.push([child.number, ours(sent)]);
              read.news.push([child.number, ours(news)]);
              read.invites.push([child.number, invites.map((i) => ({ ...i, message: { ...i.message, wilmaId: familyId(slot, i.message.wilmaId) } }))]);
              patch((s) => ({
                ...s,
                // What the views read when shown (past exams, the grade book, other weeks, the year's notes, contacts) stays.
                perChild: { ...s.perChild, [child.number]: { ...s.perChild[child.number], overview, lessons, notes, exams, className, weeks: retainedScheduleWeeks(s.perChild[child.number], new Date()), syncedAt: new Date() } },
              }));
              step(t("Read {name}'s Wilma", { name: child.first }));
            })
          );
          lists.set(slot, read);
        } catch (err) {
          failed.set(slot, err);
        }
      })
    );

    if (!current()) return;
    // Each login read replaces its own records; one that wasn't read keeps what it had, and so do unticked children.
    patch((s) => {
      const messages = { ...s.messages };
      const news = { ...s.news };
      const unshown = <T extends { children: string[] }>(items: Record<number, T>) => Object.fromEntries(Object.entries(items).filter(([, x]) => !aboutShown(s, x.children)));
      for (const [slot, read] of lists) {
        const before = ofLogin(s.messages, slot);
        for (const id of Object.keys(before)) delete messages[Number(id)];
        Object.assign(messages, unshown(before), withInvites(withSent(mergeMessages(before, read.messages), before, read.sent), before, read.invites));
        const beforeNews = ofLogin(s.news, slot);
        for (const id of Object.keys(beforeNews)) delete news[Number(id)];
        Object.assign(news, unshown(beforeNews), mergeNews(beforeNews, read.news));
      }
      return {
        ...s,
        messages,
        news,
        firstSyncAt: s.firstSyncAt ?? Date.now(),
        // The first login's is the snapshot's own (from before there were more).
        logins: s.logins?.map((l) => (l.slot && lists.has(l.slot) && !l.firstSyncAt ? { ...l, firstSyncAt: Date.now() } : l)),
      };
    });

    // Details: recent bulletins, and messages Wilma already shows as read (or all, if allowed).
    const s = getState().snapshot!;
    // Opening unread messages ahead (Wilma then shows them as read) is for the AI: without one, they wait for the parent.
    const allowUnread = getState().settings.backgroundRead && intelligenceOn(getState().settings);
    const wasRead = (id: number) => lists.has(loginOfId(id));
    const news = Object.values(s.news)
      .filter((n) => wasRead(n.id) && !n.detail && (n.pinned || (n.published && daysBetween(dateOf(n.published), now) <= 45)))
      .sort((a, b) => (b.published?.getTime() ?? 0) - (a.published?.getTime() ?? 0))
      .slice(0, 20);
    // A thread read before its opening message's own time was kept is read once more, for that time.
    const messages = Object.values(s.messages)
      .filter((m) => wasRead(m.id) && (!m.thread || (m.thread.replies.length > 0 && !m.thread.sentAt)) && (allowUnread || !m.unreadInWilma) && daysBetween(dateOf(m.sentAt), now) <= 120)
      .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())
      .slice(0, 30);
    if (news.length || messages.length) step(t("Reading new messages and bulletins"));
    // One that doesn't load (a slow or busy network) doesn't fail the check: it's tried again next time. None loading is worth saying.
    const missed: unknown[] = [];
    const detail = (id: number, load: () => Promise<void>) => {
      const slot = loginOfId(id);
      return limits.get(slot)!(load).catch((err) => {
        if (!sessionGone(err)) return void missed.push(err);
        failed.set(slot, err);
      });
    };
    await Promise.all([...news.map((n) => detail(n.id, () => loadNews(n.id))), ...messages.map((m) => detail(m.id, () => loadThread(m.id)))]);
    if (missed.length && missed.length === news.length + messages.length) throw missed[0];

    if (!current()) return;
    // A Wilma whose session ended waits for signing in again (the Wilmas page); what the others read stands.
    for (const [slot, err] of failed) if (sessionGone(err) && sessionOf(slot) === reading.get(slot)) handleError(err, slot);
    for (const slot of lists.keys()) if (!failed.has(slot)) keep(slot);
    if (lists.size) patch((x) => ({ ...x, syncedAt: new Date() }));
    // A Wilma that couldn't be read (a slow network, not an ended session) is said in the sync line, by its school when there are more.
    const [slot, unread] = [...failed].find(([, err]) => !sessionGone(err)) ?? [0, null];
    const account = getState().snapshot ? accountOf(getState().snapshot!, slot) : null;
    const why = unread instanceof Error ? unread.message : unread ? String(unread) : null;
    const many = getState().snapshot ? logins(getState().snapshot!).length > 1 : false;
    const error = why && many && account ? t("Couldn't read {school}: {why}", { school: schoolOf(account), why }) : why;
    setState((x) => ({ sync: { running: false, step: null, error, lastOk: lists.size ? Date.now() : x.sync.lastOk } }));
  } catch (err) {
    if (current()) handleError(err);
  }
  if (!current()) return;
  void runJev();
  void runLuna();
}

async function loadThread(id: number) {
  const scope = accountScope();
  const patch = (update: (snap: Snapshot) => Snapshot) => patchSnapshot(update, scope);
  const rec = getState().snapshot?.messages[id];
  if (!rec) return;
  const message = await kid(rec.children[0]).messages.get(wilmaIdOf(id));
  patch((s) => {
    const current = s.messages[id];
    if (!current) return s;
    return {
      ...s,
      messages: {
        ...s.messages,
        [id]: {
          ...current,
          unreadInWilma: false,
          replyCount: message.replies?.length ?? current.replyCount,
          thread: {
            content: message.content ?? "",
            sentAt: message.sentAt,
            recipients: message.recipients ?? null,
            replies: (message.replies ?? []).map((r) => ({ id: r.id, sentAt: r.sentAt, senderName: r.senderName, content: r.content })),
            collated: Boolean(message.discussion),
            invite: message.invitation ?? null,
            fetchedAt: new Date(),
          },
        },
      },
    };
  });
}

/** How bulletin text is read: 2 = as text with its paragraphs and lists (wilma-client's htmlToText). */
const NEWS_TEXT_V = 2;

async function loadNews(id: number) {
  const scope = accountScope();
  const patch = (update: (snap: Snapshot) => Snapshot) => patchSnapshot(update, scope);
  const rec = getState().snapshot?.news[id];
  if (!rec) return;
  const item = await kid(rec.children[0]).news.get(wilmaIdOf(id));
  patch((s) => {
    const current = s.news[id];
    if (!current) return s;
    return {
      ...s,
      news: {
        ...s.news,
        [id]: {
          ...current,
          author: current.author ?? item.author ?? null,
          published: current.published ?? item.published ?? null,
          detail: { content: item.content ?? "", resources: item.resources, fetchedAt: new Date(), v: NEWS_TEXT_V },
        },
      },
    };
  });
}

/** Open a message in the app: reads it from Wilma when its text isn't here yet (Wilma then shows it as read). */
export async function openMessage(id: number) {
  const rec = getState().snapshot?.messages[id];
  if (!rec || rec.thread || !sessionOf(loginOfId(id))) return;
  try {
    await loadThread(id);
    void runJev();
    void runLuna();
  } catch (err) {
    handleError(err, loginOfId(id));
  }
}

export async function openNews(id: number) {
  const rec = getState().snapshot?.news[id];
  if (!rec || rec.detail || !sessionOf(loginOfId(id))) return;
  try {
    await loadNews(id);
    void runJev();
    void runLuna();
  } catch (err) {
    handleError(err, loginOfId(id));
  }
}

export function replyApi(messageId: number) {
  const rec = getState().snapshot?.messages[messageId];
  if (!rec || !sessionOf(loginOfId(messageId))) return null;
  const child = kid(rec.children[0]);
  return {
    prepare: () => write.prepareReply(child, wilmaIdOf(messageId)),
    send: async (form: write.ReplyForm, text: string) => {
      await write.sendReply(child, form, text);
      await loadThread(messageId);
    },
  };
}

/** Sign up for, or cancel, one slot of an invitation. wilma-client reads the invitation back to confirm. */
export async function answerInvitation(messageId: number, slotId: string, action: "apply" | "cancel"): Promise<string> {
  const scope = accountScope();
  const patch = (update: (snap: Snapshot) => Snapshot) => patchSnapshot(update, scope);
  const snap = getState().snapshot;
  const rec = snap?.messages[messageId];
  if (!snap || !rec?.thread?.invite) throw new Error(t("Open the invitation first."));
  if (snap.account.via === "demo") {
    const slots = rec.thread.invite.slots.map((slot) => ({
      ...slot,
      selected: action === "apply" ? slot.id === slotId : slot.id === slotId ? false : slot.selected,
      peopleCount: slot.id === slotId ? slot.peopleCount + (action === "apply" ? 1 : -1) : slot.peopleCount,
    }));
    patch((s) => ({
      ...s,
      messages: { ...s.messages, [messageId]: { ...rec, invite: { status: action === "apply" ? "Applied" : null, extra: null }, thread: { ...rec.thread!, invite: { ...rec.thread!.invite!, slots } } } },
    }));
    return action === "apply" ? t("Sample family: signed up here only.") : t("Sample family: cancelled here only.");
  }
  try {
    const { notice } = await write.answerInvitation(kid(rec.children[0]), wilmaIdOf(messageId), slotId, action);
    return notice;
  } finally {
    // Whatever happened, show the invitation as Wilma has it now.
    await loadThread(messageId).catch(() => undefined);
  }
}

/** Tell Wilma the family won't attend ("En osallistu"), or take that back. wilma-client reads the invitation back to confirm. */
export async function declineInvitation(messageId: number, undo = false): Promise<string> {
  const scope = accountScope();
  const patch = (update: (snap: Snapshot) => Snapshot) => patchSnapshot(update, scope);
  const snap = getState().snapshot;
  const rec = snap?.messages[messageId];
  if (!snap || !rec?.thread?.invite) throw new Error(t("Open the invitation first."));
  if (snap.account.via === "demo") {
    const invite = rec.thread.invite;
    const slots = invite.slots.map((slot) => ({
      ...slot,
      declined: slot.canDecline && !undo,
      // Declining cancels a sign-up, as in Wilma.
      ...(undo || !slot.selected ? {} : { selected: false, wilmaState: "available", peopleCount: slot.peopleCount - 1 }),
    }));
    patch((s) => ({
      ...s,
      messages: { ...s.messages, [messageId]: { ...rec, invite: { status: null, extra: null }, thread: { ...rec.thread!, invite: { ...invite, slots, declined: !undo } } } },
    }));
    return undo ? t("Sample family: taken back here only.") : t("Sample family: answered here only.");
  }
  try {
    const { notice } = await write.declineInvitation(kid(rec.children[0]), wilmaIdOf(messageId), { undo });
    return notice;
  } finally {
    await loadThread(messageId).catch(() => undefined);
  }
}

/* ------------------------------------------------------------------ */
/*  Other weeks                                                        */
/* ------------------------------------------------------------------ */

/** Wilma's grade book for one child (Suoritukset: subject > course), read when the Grades view shows it, kept twelve hours. */
export async function loadGradebook(child: string): Promise<GradebookEntry[]> {
  const scope = accountScope();
  const patch = (update: (snap: Snapshot) => Snapshot) => patchSnapshot(update, scope);
  const data = getState().snapshot?.perChild[child];
  const kept = data?.gradebook;
  if (kept && Date.now() - new Date(kept.fetchedAt).getTime() < 12 * 3_600_000) return kept.entries;
  if (isDemo()) return kept?.entries ?? [];
  try {
    const entries = await kid(child).gradebook.get();
    patch((s) => {
      const d = s.perChild[child] ?? { lessons: [], notes: [], exams: [] };
      return { ...s, perChild: { ...s.perChild, [child]: { ...d, gradebook: { entries, fetchedAt: new Date() } } } };
    });
    return entries;
  } catch (err) {
    if (scope === accountScope() && err instanceof SessionEndedError) handleError(err, loginOfChild(child));
    throw err;
  }
}

/** Kept past exams read by an older parser are read again (2: exams without a name). */
const PAST_EXAMS_V = 2;

/**
 * One child's past exams with grades, from Wilma's past-exams list reaching
 * back nine school years (as far as the school keeps them; one request),
 * read when the Grades view shows them and kept six hours. The front page's
 * newest grades fill in between (see examResults).
 */
export async function loadPastExams(child: string): Promise<PastExam[]> {
  const scope = accountScope();
  const patch = (update: (snap: Snapshot) => Snapshot) => patchSnapshot(update, scope);
  const data = getState().snapshot?.perChild[child];
  const kept = data?.pastExams;
  if (kept && kept.v === PAST_EXAMS_V && Date.now() - new Date(kept.fetchedAt).getTime() < 6 * 3_600_000) return kept.exams;
  if (isDemo()) return kept?.exams ?? [];
  const now = today();
  const year = Number(now.slice(0, 4)) - (Number(now.slice(5, 7)) >= 8 ? 0 : 1);
  try {
    const exams = await kid(child).exams.past({ from: `${year - 8}-08-01`, to: now });
    patch((s) => {
      const d = s.perChild[child] ?? { lessons: [], notes: [], exams: [] };
      return { ...s, perChild: { ...s.perChild, [child]: { ...d, pastExams: { exams, fetchedAt: new Date(), v: PAST_EXAMS_V } } } };
    });
    // Jev reads the marks it hasn't read yet (what each is: a grade, points, another scale…).
    if (scope === accountScope()) void runJev();
    return exams;
  } catch (err) {
    if (scope === accountScope() && err instanceof SessionEndedError) handleError(err, loginOfChild(child));
    throw err;
  }
}

/** The whole school year's lesson notes for one child (one request, Wilma's "whole year" view), kept six hours. */
export async function loadYearNotes(child: string): Promise<LessonNote[]> {
  const scope = accountScope();
  const patch = (update: (snap: Snapshot) => Snapshot) => patchSnapshot(update, scope);
  const data = getState().snapshot?.perChild[child];
  const kept = data?.yearNotes;
  if (kept && Date.now() - new Date(kept.fetchedAt).getTime() < 6 * 3_600_000) return kept.notes;
  if (isDemo()) return data?.notes ?? [];
  try {
    const notes = await kid(child).attendance.schoolYear();
    patch((s) => {
      const d = s.perChild[child] ?? { lessons: [], notes: [], exams: [] };
      return { ...s, perChild: { ...s.perChild, [child]: { ...d, yearNotes: { notes, fetchedAt: new Date() } } } };
    });
    return notes;
  } catch (err) {
    if (scope === accountScope() && err instanceof SessionEndedError) handleError(err, loginOfChild(child));
    throw err;
  }
}

/**
 * The lessons of one week the sync doesn't read (it reads this week and
 * next): read when the Week view shows it, kept (a past week for good, a
 * future one for a day, as timetables still change).
 */
export async function loadWeek(child: string, monday: string): Promise<ScheduleLesson[]> {
  const scope = accountScope();
  const patch = (update: (snap: Snapshot) => Snapshot) => patchSnapshot(update, scope);
  const kept = getState().snapshot?.perChild[child]?.weeks?.[monday];
  const past = monday < mondayOf(today());
  if (kept && (past || Date.now() - new Date(kept.fetchedAt).getTime() < 86_400_000)) return kept.lessons;
  if (isDemo()) return [];
  try {
    const lessons = await kid(child).schedule.list({ from: monday, to: addDays(monday, 4) });
    patch((s) => {
      const data = s.perChild[child] ?? { lessons: [], notes: [], exams: [] };
      return { ...s, perChild: { ...s.perChild, [child]: { ...data, weeks: { ...data.weeks, [monday]: { lessons, fetchedAt: new Date() } } } } };
    });
    return lessons;
  } catch (err) {
    if (scope === accountScope() && err instanceof SessionEndedError) handleError(err, loginOfChild(child));
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/*  Writing a new message                                              */
/* ------------------------------------------------------------------ */

const CONTACTS_FRESH_MS = 7 * 86_400_000;

/**
 * Who the parent can write to about a child: the front page's class teacher
 * and supervisors, and Wilma's recipient list. Read when the parent starts a
 * message (three pages), kept for a week.
 */
export async function loadContacts(child: string, refresh = false): Promise<Contacts> {
  const scope = accountScope();
  const patch = (update: (snap: Snapshot) => Snapshot) => patchSnapshot(update, scope);
  const kept = getState().snapshot?.perChild[child]?.contacts;
  if (kept && !refresh && Date.now() - new Date(kept.fetchedAt).getTime() < CONTACTS_FRESH_MS) return kept;
  if (isDemo()) return demoContacts(child);
  try {
    const k = kid(child);
    const [details, recipients] = await Promise.all([k.student.get(), k.messages.recipients()]);
    const contacts: Contacts = { details, recipients, fetchedAt: new Date() };
    patch((s) => ({
      ...s,
      perChild: { ...s.perChild, [child]: { ...(s.perChild[child] ?? { lessons: [], notes: [], exams: [] }), contacts, className: { value: details.className, fetchedAt: new Date() } } },
    }));
    return contacts;
  } catch (err) {
    if (scope === accountScope() && err instanceof SessionEndedError) handleError(err, loginOfChild(child));
    throw err;
  }
}

/** Prepare and send a new message about one child (the sample family sends nothing). */
export function messageApi(child: string) {
  return {
    prepare: async (recipient: MessageRecipient): Promise<write.MessageForm> => {
      if (isDemo()) {
        return { kind: "message", recipients: [recipient.name], form: { action: "", fields: [], buttons: [], selects: [], textareas: [] }, subjectField: "Subject", bodyField: "BodyText" };
      }
      return write.prepareMessage(kid(child), recipient);
    },
    send: async (form: write.MessageForm, subject: string, text: string): Promise<void> => {
      if (isDemo()) {
        // Nothing is sent; the message shows as sent, as a real one does.
        patchSnapshot((s) => {
          const id = Math.max(0, ...Object.keys(s.messages).map(Number)) + 1;
          const now = new Date();
          const thread = { content: text, sentAt: now, recipients: form.recipients, replies: [], collated: false, fetchedAt: now };
          return { ...s, messages: { ...s.messages, [id]: { id, subject, sender: null, sentAt: now, unreadInWilma: false, replyCount: 0, children: [child], thread, sent: true } } };
        });
        return;
      }
      try {
        await write.sendMessage(kid(child), form, { subject, text });
        keep(loginOfChild(child));
        // Sent: it shows in the inbox now, not only once someone answers. A failure here doesn't undo the sending.
        void loadSent(child).catch(() => {});
      } catch (err) {
        if (err instanceof SessionEndedError) handleError(err, loginOfChild(child));
        throw err;
      }
    },
  };
}

/** The day Wilma will record an absence for: today until 12:00, then tomorrow. */
export function absenceDay(): string {
  const now = today();
  return nowMinutesHelsinki() < 12 * 60 ? now : addDays(now, 1);
}

function nowMinutesHelsinki(): number {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Helsinki", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()).split(":").map(Number);
  return h * 60 + m;
}

export async function prepareAbsenceReport(child: string): Promise<write.AbsenceReportForm> {
  if (isDemo()) {
    const date = absenceDay();
    return {
      kind: "absence-report",
      date,
      dateLabel: date === today() ? "Tänään" : "Huomenna",
      reasons: [{ value: "83", label: "Terveydellinen syy" }],
      acceptsText: true,
      guidance: "Voit ilmoittaa tämän päivän poissaolosta klo 12 asti, ja klo 12 jälkeen seuraavan päivän poissaolosta. Poissaoloilmoitus näkyy opettajilla Wilmassa.",
      form: { action: "", fields: [], buttons: [], selects: [], textareas: [] },
      reasonField: "type",
      textField: "text",
      noticesBefore: [],
    };
  }
  return write.prepareAbsenceReport(kid(child));
}

export async function sendAbsenceReport(child: string, form: write.AbsenceReportForm, reason: string, text: string): Promise<string | null> {
  const said = isDemo() ? t("Sample family: nothing was sent.") : (await write.sendAbsenceReport(kid(child), form, { reason, text })).notice;
  const date = form.date ?? absenceDay();
  const label = form.reasons.find((r) => r.value === reason)?.label ?? reason;
  setState((s) => ({
    local: {
      ...s.local,
      reported: { ...s.local.reported, [child]: { ...(s.local.reported?.[child] ?? {}), [date]: { at: Date.now(), reason: label } } },
    },
  }));
  return said;
}

/**
 * A send stopped because the session changed (another WilmAI program's
 * session continued, or none is alive): nothing was sent. Prepare the form
 * again under the session now in use and return it; when no session is alive,
 * show the sign-in page (drafts stay) and return null.
 */
export async function preparedAgain<T>(err: unknown, prepare: () => Promise<T>, slot = 0): Promise<T | null> {
  if (!(err instanceof SessionEndedError)) throw err;
  try {
    return await prepare();
  } catch (again) {
    handleError(again, slot);
    return null;
  }
}

/** The English text (the dictionary key); show sessionChangedNote(), or t(SESSION_CHANGED_NOTE). */
export const SESSION_CHANGED_NOTE = "The Wilma session changed, so nothing was sent. Check it and send again.";

/** SESSION_CHANGED_NOTE in the app's language. */
export const sessionChangedNote = (): string => t(SESSION_CHANGED_NOTE);

export function isDemo(): boolean {
  return getState().snapshot?.account.via === "demo";
}
