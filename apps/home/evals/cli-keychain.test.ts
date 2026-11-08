/*
 * A Wilma login the WilmAI CLI keeps in the keychain, in the desktop app (the CLI's docs/secret-store.md, section 9).
 * The native side is a fake that answers as src-tauri/src/lib.rs does, over a fake CLI config, keychain, shared session
 * file and Wilma: the session file's key follows the CLI's config at every read and write, the keychain is read only
 * when Wilma needs a new login, and the app keeps no password for such a login.
 */
import "./shim.ts";
import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { WireRequest, WireResponse } from "../src/wilma/transport.ts";

// The desktop app: Tauri's bridge, answered by `native` below. Set before the app's modules load (they look once).
let native: (command: string, args: Record<string, unknown>) => Promise<unknown> = async () => null;
Object.assign(globalThis, { window: globalThis, __TAURI_INTERNALS__: { invoke: (command: string, args: Record<string, unknown>) => native(command, args) } });
const { accountKey, getState, passwordOf, rememberPasswordOf, updateSettings } = await import("../src/data/store.ts");
const { getBack, keepAlive, resetApp, signInAll, signInWithPassword, signOut, syncNow } = await import("../src/data/engine.ts");
const { logins } = await import("../src/data/logins.ts");
const { DEFAULT_SETTINGS } = await import("../src/data/model.ts");
const { isDesktopApp, sessionKeyV1 } = await import("../src/wilma/transport.ts");

const NORTH = "https://north.inschool.fi";
const HOST = "north.inschool.fi";
const PASSWORD = "fictional-north";
const SECRET_ID = "0123456789abcdef0123456789abcdef";
const MISSING = "The password the WilmAI CLI saved for this Wilma isn't in the keychain any more. Log in again with the CLI (`wilma login`), or type the password here.";
const REFUSED = "The keychain on this computer didn't hand over the password the WilmAI CLI saved. If the computer is locked or asking for a password, unlock it, then try again.";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const address = (url: string) => url.replace(/\/$/, "");
/** The CLI's keys (packages/wilma-cli/src/session-keys.ts). */
const keyV1 = (baseUrl: string, username: string, password: string) => sha256(`${address(baseUrl)}\n${username.toLowerCase()}\n${password}`);
const keyV2 = (baseUrl: string, username: string) => sha256(`wilmai-session-v2\n${address(baseUrl)}\n${username.toLowerCase()}`);
const fixture = (name: string) => readFileSync(new URL(`../../../packages/wilma-client/test/fixtures/real/${name}`, import.meta.url), "utf8");

type Profile = { id: string; tenantUrl: string; username: string; password?: string; secrets?: string; secretId?: string; hasTotp?: boolean };
type Login = { baseUrl: string; username: string; v1Key?: string };

/** The computer: the CLI's config and keychain entries, the shared session file, and the school's Wilma. */
function computer(secrets: "file" | "keychain") {
  const world = {
    profile: { id: `${NORTH}|parent`, tenantUrl: NORTH, username: "parent" } as Profile,
    keychain: new Map<string, string>(),
    refuse: false,
    /** Keychain reads, and the session file's entries and writes (by key). */
    reads: 0,
    sessions: new Map<string, { state: string; by: string }>(),
    writes: [] as string[],
    wilma: { alive: null as string | null, sid: 0, logins: 0, requests: [] as string[] },
    /** The CLI moves the login between its file and the keychain (the entry keeps the password). */
    move(to: "file" | "keychain") {
      if (to === "keychain") {
        world.profile = { id: world.profile.id, tenantUrl: NORTH, username: "parent", secrets: "keychain", secretId: SECRET_ID, hasTotp: false };
        world.keychain.set(SECRET_ID, JSON.stringify({ password: PASSWORD, totpSecret: null }));
      } else {
        world.profile = { id: world.profile.id, tenantUrl: NORTH, username: "parent", password: PASSWORD };
        world.keychain.delete(SECRET_ID);
      }
    },
    /** The CLI logs in (Wilma ends the app's session) and saves its session under its key now. */
    cliLogsIn() {
      world.wilma.sid += 1;
      world.wilma.alive = `cli-${world.wilma.sid}`;
      const key = world.profile.secrets === "keychain" ? keyV2(NORTH, "parent") : keyV1(NORTH, "parent", PASSWORD);
      world.sessions.set(key, { state: stateOf(world.wilma.alive), by: "cli" });
    },
  };
  world.move(secrets);
  /** As lib.rs: v2 while the CLI's config has the login in the keychain, else the app's v1 key. */
  const keyOf = (login: Login) => {
    const p = world.profile;
    const keychain = p.secrets === "keychain" && address(p.tenantUrl) === address(login.baseUrl) && p.username.toLowerCase() === login.username.toLowerCase();
    return keychain ? keyV2(login.baseUrl, login.username) : (login.v1Key ?? null);
  };
  native = async (command, args) => {
    const p = world.profile;
    switch (command) {
      case "cli_logins":
        return [{ id: p.id, baseUrl: NORTH, username: p.username, tenantName: null, hasTotp: Boolean(p.hasTotp), keychain: p.secrets === "keychain" }];
      case "cli_login_secret": {
        if (args.id !== p.id) throw "That saved login isn't there any more.";
        if (p.secrets !== "keychain") return { password: p.password, totpSecret: null };
        world.reads += 1;
        if (world.refuse) throw REFUSED;
        const entry = world.keychain.get(p.secretId!);
        if (!entry) throw MISSING;
        return JSON.parse(entry);
      }
      case "shared_session_get": {
        const key = keyOf(args.login as Login);
        const entry = key ? world.sessions.get(key) : undefined;
        return entry ? { state: entry.state, savedAt: Date.now(), by: entry.by } : null;
      }
      case "shared_session_set": {
        const key = keyOf(args.login as Login);
        if (key) {
          world.sessions.set(key, { state: String(args.state), by: "home" });
          world.writes.push(key);
        }
        return null;
      }
      case "wilma_send":
        return wilma(world.wilma, args.wire as WireRequest);
      default:
        return null;
    }
  };
  return world;
}

const stateOf = (sid: string) => JSON.stringify({ cookies: [{ key: "Wilma2SID", value: sid, domain: HOST, path: "/", hostOnly: true }] });

/** One school's Wilma: one live session per account, the fixtures' pages. */
function wilma(fake: { alive: string | null; sid: number; logins: number; requests: string[] }, wire: WireRequest): WireResponse {
  const answer = (status: number, body = "", more: Partial<WireResponse> = {}): WireResponse => ({ status, url: wire.url, location: null, setCookie: [], contentType: "text/html", body, ...more });
  const json = (name: string) => answer(200, fixture(name), { contentType: "application/json" });
  const url = new URL(wire.url);
  fake.requests.push(`${wire.method} ${url.pathname}`);
  const sid = /Wilma2SID=([^;]+)/.exec(wire.cookie ?? "")?.[1] ?? null;
  if (url.pathname === "/login" && wire.method === "GET") return answer(200, '<input type="hidden" name="SESSIONID" value="s">');
  if (url.pathname === "/login") {
    const form = new URLSearchParams(wire.body);
    if (form.get("Login") !== "parent" || form.get("Password") !== PASSWORD) return answer(303, "", { location: "/?loginfailed" });
    fake.sid += 1;
    fake.logins += 1;
    fake.alive = `home-${fake.sid}`;
    return answer(303, "", { location: "/", setCookie: [`Wilma2SID=${fake.alive}; Path=/; HttpOnly`] });
  }
  if (!sid || sid !== fake.alive) return answer(302, "", { location: "/login" });
  if (url.pathname === "/logout") {
    fake.alive = null;
    return answer(303, "", { location: "/" });
  }
  if (url.pathname === "/") return answer(200, '<html><form id="logout-form" action="/logout"><input name="formkey" value="fk"></form></html>');
  if (url.pathname === "/api/v1/accounts/me/roles") return answer(200, JSON.stringify({ payload: [{ type: "guardian", slug: "!1234", name: "Lapsi Esimerkki" }] }), { contentType: "application/json" });
  const page = url.pathname.replace(/^\/!1234/, "");
  if (page === "/overview") return json("overview.json");
  if (page === "/api/v1/schedules/timetable") return json("timetable.json");
  if (page === "/messages/list") return json("messages-list.json");
  if (page === "/messages/list/outbox") return answer(200, '{"Messages":[]}', { contentType: "application/json" });
  if (page === "/messages/list/appointments") return json("appointments-list.json");
  if (/^\/messages\/\d+$/.test(page)) return json("message-thread.json");
  if (page === "/news") return answer(200, fixture("news-list.html"));
  if (/^\/news\/\d+$/.test(page)) return answer(200, fixture("news-detail.html"));
  if (page === "/attendance/view") return answer(200, fixture("attendance.html"));
  if (page.startsWith("/exams/calendar")) return answer(200, fixture("exams-calendar.html"));
  if (page === "/" || page === "") return answer(200, fixture("student-home.html"));
  return answer(404);
}

const account = () => logins(getState().snapshot!)[0].account;

test("the keys are the CLI's", async () => {
  assert.ok(isDesktopApp, "these tests run as the desktop app");
  assert.equal(await sessionKeyV1("https://example.inschool.fi", "Matti.M", "pw"), "c4cb441cdc450d3151d3de14dd1576b4aa3235ea224813cac8e8d9c982dd3507");
  assert.equal(keyV2("https://example.inschool.fi/", "Matti.M"), "18e7bcf46ac5969e085d0b5eac867bbbf4ffe590073dce493c82445fd120f6d9", "the fake's v2 is the CLI's");
  assert.equal(keyV1("https://example.inschool.fi", "Matti.M", "pw"), await sessionKeyV1("https://example.inschool.fi/", "Matti.M", "pw"));
});

test("a keychain login: its session is shared under v2, the keychain is read only for a new login, and no password is kept", async () => {
  await resetApp();
  updateSettings({ ...DEFAULT_SETTINGS, staySignedIn: true });
  const world = computer("keychain");
  try {
    // The parent types the password on the start page.
    assert.equal(await signInWithPassword(NORTH, "parent", PASSWORD, undefined, false, "guardian"), null);
    await syncNow();
    assert.equal(getState().phase, "ready");
    assert.deepEqual(world.writes, [keyV2(NORTH, "parent")], "saved under v2: nothing in the file comes from the password");
    assert.equal(world.reads, 0, "the typed password signed in");
    assert.deepEqual(getState().settings.passwords, {}, "and isn't kept");
    assert.equal(passwordOf(account()), "");
    assert.equal(account().via, "cli", "from now on it signs in with the CLI's saved login");
    rememberPasswordOf(account(), PASSWORD);
    assert.deepEqual(getState().settings.passwords, {}, "the store keeps none for it either");

    // The CLI logs in: the app continues its session, without the keychain.
    world.cliLogsIn();
    await keepAlive();
    assert.equal(getState().phase, "ready");
    assert.equal(world.wilma.logins, 1, "no login of the app's own");
    assert.equal(world.reads, 0);

    // Wilma ends it (the phone, say), and nothing live is saved: staying signed in, the app logs in with the keychain's.
    world.wilma.alive = null;
    await keepAlive();
    await getBack(); // the sign-in under way
    assert.equal(getState().phase, "ready");
    assert.equal(world.reads, 1, "read once, for the new login");
    assert.equal(world.wilma.logins, 2);
    assert.deepEqual(world.writes, [keyV2(NORTH, "parent"), keyV2(NORTH, "parent")]);
    assert.deepEqual(getState().settings.passwords, {});
  } finally {
    await signOut();
  }
});

test("the key follows the CLI's config at every read and write, while the app is open", async () => {
  await resetApp();
  updateSettings({ ...DEFAULT_SETTINGS, staySignedIn: true });
  const world = computer("file");
  const v1 = keyV1(NORTH, "parent", PASSWORD);
  const v2 = keyV2(NORTH, "parent");
  try {
    // A file login: v1, and the typed password remembered, as before.
    await signInWithPassword(NORTH, "parent", PASSWORD, undefined, false, "guardian");
    await syncNow();
    assert.deepEqual(world.writes, [v1]);
    assert.equal(passwordOf(account()), PASSWORD);
    assert.equal(account().via, "password");

    // The CLI moves it to the keychain and logs in: the app's client, made before the move, reads the CLI's v2 save.
    world.move("keychain");
    world.cliLogsIn();
    await keepAlive();
    assert.equal(getState().phase, "ready", "continued");
    assert.equal(world.wilma.logins, 1);
    assert.equal(world.reads, 0);

    // A new login: with the keychain's password, written under v2, and the password remembered before goes.
    world.wilma.alive = null;
    await keepAlive();
    await getBack();
    assert.equal(getState().phase, "ready");
    assert.equal(world.reads, 1);
    assert.deepEqual(world.writes, [v1, v2], "never v1 again while it's in the keychain");
    assert.deepEqual(getState().settings.passwords, {});
    assert.equal(account().via, "cli");
    await syncNow(); // the reading its sign-in started

    // Back in the file: the next login (the parent's: the app waits after its own ended so soon) reads it there and writes v1.
    world.move("file");
    world.wilma.alive = null;
    await keepAlive();
    assert.deepEqual(await signInAll(), { 0: { ok: true } });
    assert.equal(world.reads, 1, "no keychain");
    assert.equal(world.wilma.logins, 3);
    assert.deepEqual(world.writes, [v1, v2, v1]);
  } finally {
    await signOut();
  }
});

test("a keychain entry that can't be read: the parent sees why, and a password typed then isn't kept", async () => {
  await resetApp();
  updateSettings({ ...DEFAULT_SETTINGS });
  const world = computer("keychain");
  try {
    await signInWithPassword(NORTH, "parent", PASSWORD, undefined, false, "guardian");
    await syncNow();
    await signOut();
    // One remembered from before the CLI moved the login to the keychain isn't used either.
    updateSettings({ passwords: { [accountKey(account())!]: PASSWORD } });
    world.refuse = true;
    assert.deepEqual(await signInAll(), { 0: { error: REFUSED } }, "the reason, and no other way in");
    world.refuse = false;
    world.keychain.clear();
    assert.deepEqual(await signInAll(), { 0: { error: MISSING } });
    assert.equal(world.reads, 2);
    assert.equal(world.wilma.logins, 1, "no login with the remembered password");

    // The parent types it: in, and nothing kept (the one remembered before goes too).
    assert.deepEqual(await signInAll({ 0: PASSWORD }), { 0: { ok: true } });
    assert.equal(getState().phase, "ready");
    assert.deepEqual(getState().settings.passwords, {});
    assert.equal(account().via, "cli");
    assert.ok(world.writes.every((key) => key === keyV2(NORTH, "parent")));
  } finally {
    await signOut();
  }
});

test("asked for the password each time, a keychain login stays one the parent types for, and nothing is kept", async () => {
  await resetApp();
  updateSettings({ ...DEFAULT_SETTINGS, rememberPassword: false, staySignedIn: false });
  const world = computer("keychain");
  try {
    await signInWithPassword(NORTH, "parent", PASSWORD, undefined, false, "guardian");
    await syncNow();
    assert.equal(account().via, "password", "not signed in with the CLI's saved login by one click");
    assert.deepEqual(getState().settings.passwords, {});
    assert.deepEqual(world.writes, [keyV2(NORTH, "parent")], "shared under v2 all the same");
    await signOut();
    assert.deepEqual(await signInAll(), { 0: { password: true } }, "the password is asked");
    assert.equal(world.reads, 0, "and the keychain isn't read");
  } finally {
    await signOut();
  }
});
