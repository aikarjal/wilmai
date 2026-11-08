/*
 * A family with children on two Wilmas (data/logins.ts): two fake Wilmas in memory, both with child 1234 and the same
 * anonymised pages (wilma-client's real-page fixtures), so every id collides unless the app keeps them apart. The app
 * shows only when every Wilma is signed in; otherwise the Wilmas page.
 */
import "./shim.ts";
import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accountKey, activateAccount, forgetPasswordsIfAsked, getState, knownFamilies, passwordOf, savedLinkedSessions, updateSettings } from "../src/data/store.ts";
import { addWilma, changeLogin, forgetThisFamily, getBack, leaveDemo, openMessage, removeWilma, resetApp, setChildShown, signInAll, signInDemo, signInWithPassword, signOut, signOutWilma, syncNow } from "../src/data/engine.ts";
import { familyChild, familyChildren, familyId, loginOfChild, loginOfId, logins, screenFor, slotFor, wilmaIdOf, wilmaNumber, wilmaPage } from "../src/data/logins.ts";
import { buildFeed } from "../src/data/feed.ts";
import { DEFAULT_SETTINGS, type AccountInfo } from "../src/data/model.ts";
import { overrideBridge, type WireRequest, type WireResponse } from "../src/wilma/transport.ts";

const fixture = (name: string) => readFileSync(new URL(`../../../packages/wilma-client/test/fixtures/real/${name}`, import.meta.url), "utf8");

interface Fake {
  user: string;
  password: string;
  role: "guardian" | "student";
  alive: string | null;
  sid: number;
  requests: string[];
  /** Answers a guardian's bulletins page with 403, as Helsinki's Wilma does. */
  refusesNews?: boolean;
}

/** A fake Wilma per host: one live session per account, a front page with Wilma's logout form, the fixtures' pages. */
function fakeWilmas(fakes: Record<string, Fake>) {
  const answer = (url: string, status: number, body = "", more: Partial<WireResponse> = {}): WireResponse => ({ status, url, location: null, setCookie: [], contentType: "text/html", body, ...more });
  return async (path: string, init: { body?: unknown }): Promise<unknown> => {
    if (path === "session/get") return { state: null };
    if (path === "session/set") return { ok: true };
    if (path === "cli/accounts") return { accounts: [] };
    if (path !== "wilma") return { error: `No ${path} here`, status: 404 };
    const wire = init.body as WireRequest;
    const url = new URL(wire.url);
    const fake = fakes[url.host];
    if (!fake) return { error: "Unknown Wilma", status: 502 };
    const where = url.pathname + url.search;
    fake.requests.push(`${wire.method} ${where}`);
    const sid = /Wilma2SID=([^;]+)/.exec(wire.cookie ?? "")?.[1] ?? null;
    if (url.pathname === "/login" && wire.method === "GET") return answer(wire.url, 200, '<input type="hidden" name="SESSIONID" value="s">');
    if (url.pathname === "/login") {
      const form = new URLSearchParams(wire.body);
      if (form.get("Login") !== fake.user || form.get("Password") !== fake.password) return answer(wire.url, 303, "", { location: "/?loginfailed" });
      fake.sid += 1;
      fake.alive = `${url.host}-${fake.sid}`;
      return answer(wire.url, 303, "", { location: "/", setCookie: [`Wilma2SID=${fake.alive}; Path=/; HttpOnly`] });
    }
    if (!sid || sid !== fake.alive) return answer(wire.url, 302, "", { location: "/login" });
    if (url.pathname === "/logout") {
      fake.alive = null;
      return answer(wire.url, 303, "", { location: "/" });
    }
    if (url.pathname === "/") return answer(wire.url, 200, '<html><form id="logout-form" action="/logout"><input name="formkey" value="fk"></form></html>');
    if (url.pathname === "/api/v1/accounts/me/roles")
      return answer(wire.url, 200, JSON.stringify({ payload: [{ type: fake.role, slug: "!1234", name: fake.role === "student" ? "Oma Oppilas" : `Lapsi ${url.host.split(".")[0]}` }] }), { contentType: "application/json" });
    const page = url.pathname.replace(/^\/!1234/, "");
    const json = (name: string) => answer(wire.url, 200, fixture(name), { contentType: "application/json" });
    if (page === "/overview") return json("overview.json");
    if (page === "/api/v1/schedules/timetable") return json("timetable.json");
    if (page === "/messages/list") return json("messages-list.json");
    if (page === "/messages/list/outbox") return answer(wire.url, 200, '{"Messages":[]}', { contentType: "application/json" });
    if (page === "/messages/list/appointments") return json("appointments-list.json");
    if (/^\/messages\/\d+$/.test(page)) return json("message-thread.json");
    if (page === "/news") return fake.refusesNews ? answer(wire.url, 403, "Forbidden") : answer(wire.url, 200, fixture("news-list.html"));
    if (/^\/news\/\d+$/.test(page)) return answer(wire.url, 200, fixture("news-detail.html"));
    if (page === "/attendance/view") return answer(wire.url, 200, fixture("attendance.html"));
    if (page.startsWith("/exams/calendar")) return answer(wire.url, 200, fixture("exams-calendar.html"));
    if (page === "/" || page === "") return answer(wire.url, 200, fixture("student-home.html"));
    return answer(wire.url, 404);
  };
}

const NORTH = "https://north.inschool.fi";
const SOUTH = "https://south.inschool.fi";
const EAST = "https://east.inschool.fi";

function family() {
  const fakes: Record<string, Fake> = {
    "north.inschool.fi": { user: "parent", password: "fictional-north", role: "guardian", alive: null, sid: 0, requests: [] },
    "south.inschool.fi": { user: "parent", password: "fictional-south", role: "guardian", alive: null, sid: 0, requests: [] },
    "east.inschool.fi": { user: "pupil", password: "fictional-east", role: "student", alive: null, sid: 0, requests: [] },
  };
  overrideBridge(fakeWilmas(fakes));
  return { north: fakes["north.inschool.fi"], south: fakes["south.inschool.fi"], east: fakes["east.inschool.fi"] };
}

test("an added login's numbers carry its slot; the first login's stay Wilma's own", () => {
  assert.equal(familyId(0, 11551667), 11551667);
  const id = familyId(2, 11551667);
  assert.equal(loginOfId(id), 2);
  assert.equal(wilmaIdOf(id), 11551667);
  assert.equal(familyChild(0, "1234"), "1234");
  assert.equal(familyChild(3, "1234"), "1234@3");
  assert.equal(loginOfChild("1234@3"), 3);
  assert.equal(wilmaNumber("1234@3"), "1234");
  const account = (baseUrl: string): AccountInfo => ({ baseUrl, username: "parent", tenantName: null, via: "password" });
  const snap = { account: account(NORTH), logins: [{ slot: 0, account: account(NORTH) }, { slot: 1, account: account(SOUTH) }], lastSlot: 4, children: [] };
  assert.equal(wilmaPage(snap, "1234@1", "attendance"), `${SOUTH}/!1234/attendance`);
  assert.equal(wilmaPage(snap, "1234", "attendance"), `${NORTH}/!1234/attendance`);
  assert.equal(slotFor(snap, { baseUrl: `${SOUTH}/` }), 1, "the same Wilma keeps its slot");
  assert.equal(slotFor(snap, { baseUrl: EAST }), 5, "a removed login's slot isn't given again");
  const old = { account: account(NORTH), children: [{ number: "7", name: "Aino Esimerkki", first: "Aino", color: 0 }] };
  assert.deepEqual(logins(old).map((l) => [l.slot, l.students?.map((s) => s.number)]), [[0, ["7"]]], "an installation from before has its first login only");
  const kids = familyChildren([
    { slot: 1, account: account(SOUTH), students: [{ number: "1@1", name: "Veeti Esimerkki" }] },
    { slot: 0, account: account(NORTH), students: [{ number: "1", name: "Aino Esimerkki" }, { number: "2", name: "Aino Esimerkki" }], hidden: ["1"] },
  ]);
  assert.deepEqual(kids.map((c) => [c.number, c.first, c.color]), [["2", "Aino", 1], ["1@1", "Veeti", 2]], "slot order, unticked left out, colours by place among all");
});

test("two screens: the app once every Wilma is signed in, otherwise the Wilma page", () => {
  assert.equal(screenFor("loading", null, "today"), "loading");
  assert.equal(screenFor("signed-out", null, "today"), "wilmas", "no family yet");
  assert.equal(screenFor("signed-out", "password", "today"), "wilmas", "a Wilma not signed in");
  assert.equal(screenFor("ready", "password", "wilmas"), "wilmas", "opened from the app");
  assert.equal(screenFor("ready", "password", "today"), "app");
  assert.equal(screenFor("ready", "demo", "today"), "app");
  assert.equal(screenFor("ready", "demo", "wilmas"), "wilmas", "the sample family's two schools, to look at");
});

test("two Wilmas with the same numbers read side by side, and the app shows only while both are signed in", async () => {
  await resetApp();
  updateSettings({ ...DEFAULT_SETTINGS });
  const { north, south, east } = family();
  try {
    assert.equal(await signInWithPassword(NORTH, "parent", "fictional-north", undefined, false, "guardian"), null);
    assert.equal(getState().phase, "ready");
    await syncNow();
    const alone = Object.keys(getState().snapshot!.messages).length;
    assert.ok(alone > 0, "the first Wilma's messages");

    assert.equal(await addWilma(SOUTH, "parent", "fictional-south"), null);
    await syncNow();
    let snap = getState().snapshot!;
    assert.deepEqual(snap.children.map((c) => c.number), ["1234", "1234@1"], "the same child number on two Wilmas is two children");
    assert.deepEqual(logins(snap).map((l) => [l.slot, l.account.baseUrl]), [[0, NORTH], [1, SOUTH]]);
    assert.equal(Object.keys(snap.messages).length, alone * 2, "the same message ids on two Wilmas are two messages");
    assert.ok(snap.perChild["1234@1"]?.syncedAt && snap.perChild["1234@1"].overview, "the added child's own reading");
    const theirs = Object.values(snap.messages).filter((m) => loginOfId(m.id) === 1);
    assert.ok(theirs.every((m) => m.children.every((c) => c === "1234@1")), "an added login's messages are its children's");
    const keys = buildFeed({ snapshot: snap, local: getState().local, jev: {}, luna: {} }).map((i) => i.key);
    assert.equal(new Set(keys).size, keys.length, "every item has its own key");
    assert.ok(south.requests.some((r) => r.startsWith("GET /!1234/overview")), "the added child was read from its own Wilma");
    assert.equal(getState().loginStatus[1]?.live, true);
    assert.ok(getState().settings.passwords[JSON.stringify([SOUTH, "parent"])], "remembered like the first password");
    assert.equal(Object.keys(await savedLinkedSessions()).length, 1, "its session is kept for the next start");

    // A message of the second Wilma opens from it, by Wilma's own id.
    const message = theirs.find((m) => !m.thread)!;
    south.requests.length = 0;
    north.requests.length = 0;
    await openMessage(message.id);
    assert.ok(south.requests.includes(`GET /!1234/messages/${wilmaIdOf(message.id)}?format=json`), south.requests.join("\n"));
    assert.equal(north.requests.length, 0);
    assert.ok(getState().snapshot!.messages[message.id].thread);

    await assert.rejects(addWilma(NORTH, "parent", "fictional-north"), /in the app already/);
    await assert.rejects(addWilma(EAST, "pupil", "fictional-east"), /student's own login/);
    assert.equal(east.alive, null, "the student's session was ended again");
    assert.equal(logins(getState().snapshot!).length, 2);

    // The second Wilma ends its session: back to the Wilmas page, the first still signed in, and nothing read is lost.
    south.alive = null;
    await syncNow();
    snap = getState().snapshot!;
    assert.equal(getState().phase, "signed-out");
    assert.equal(getState().loginStatus[0]?.live, true);
    assert.equal(getState().loginStatus[1]?.live, false);
    assert.match(getState().loginStatus[1]?.why ?? "", /ended the session/);
    assert.equal(Object.keys(snap.messages).length, alone * 2);

    // One Sign in for every Wilma not in, with the remembered password, into the same slot.
    assert.deepEqual(await signInAll(), { 1: { ok: true } });
    assert.equal(getState().phase, "ready");
    assert.deepEqual(logins(getState().snapshot!).map((l) => l.slot), [0, 1]);

    // Unticked: not shown and not read, and what was read stays for ticking again.
    await syncNow();
    setChildShown("1234@1", false);
    south.requests.length = 0;
    await syncNow();
    snap = getState().snapshot!;
    assert.deepEqual(snap.children.map((c) => c.number), ["1234"]);
    assert.ok(!south.requests.some((r) => r.includes("/!1234/")), "nothing read about an unticked child");
    assert.equal(Object.keys(snap.messages).length, alone * 2, "their messages stay");
    assert.ok(snap.perChild["1234@1"]?.overview, "and their reading");
    assert.ok(buildFeed({ snapshot: snap, local: getState().local, jev: {}, luna: {} }).every((i) => i.children.every((c) => c === "1234")), "but don't show");
    setChildShown("1234@1", true);
    await syncNow();
    assert.deepEqual(getState().snapshot!.children.map((c) => c.number), ["1234", "1234@1"]);

    // The first Wilma taken out (a child moved on): the second carries on as it was.
    await removeWilma(0);
    snap = getState().snapshot!;
    assert.deepEqual(logins(snap).map((l) => l.slot), [1]);
    assert.deepEqual(snap.children.map((c) => c.number), ["1234@1"]);
    assert.equal(Object.keys(snap.messages).length, alone);
    assert.ok(Object.keys(snap.messages).every((id) => loginOfId(Number(id)) === 1));
    assert.equal(north.alive, null, "its session ended");
    assert.equal(getState().phase, "ready");
    assert.equal(snap.lastSlot, 1);
  } finally {
    overrideBridge(null);
    await signOut();
  }
});

test("staying signed in, a Wilma signs in again by itself, and pauses when that Wilma is in use elsewhere", async () => {
  await resetApp();
  updateSettings({ ...DEFAULT_SETTINGS });
  const { south } = family();
  try {
    await signInWithPassword(NORTH, "parent", "fictional-north", undefined, false, "guardian");
    await addWilma(SOUTH, "parent", "fictional-south");
    await syncNow();
    updateSettings({ staySignedIn: true });
    const first = south.sid;
    south.alive = null;
    await syncNow();
    await getBack(); // the sign-in that's under way
    assert.equal(getState().loginStatus[1]?.live, true, "back in by itself");
    assert.equal(getState().phase, "ready");
    assert.equal(south.sid, first + 1, "with one login");
    // Ended again right after the app's own sign-in: someone uses that Wilma, so the app waits.
    south.alive = null;
    await syncNow();
    const status = getState().loginStatus[1];
    assert.equal(status?.live, false);
    assert.equal(getState().phase, "signed-out");
    assert.ok(status?.rejoinAt && status.rejoinAt > Date.now() + 25 * 60_000, "a pause of half an hour");
    await getBack();
    assert.equal(south.sid, first + 1, "no login during the pause");
  } finally {
    overrideBridge(null);
    await signOut();
  }
});

test("a Wilma the parent signs out of stays out until they sign in, even staying signed in", async () => {
  await resetApp();
  updateSettings({ ...DEFAULT_SETTINGS, staySignedIn: true });
  const { south } = family();
  try {
    await signInWithPassword(NORTH, "parent", "fictional-north", undefined, false, "guardian");
    await addWilma(SOUTH, "parent", "fictional-south");
    await syncNow();
    await signOutWilma(1);
    assert.equal(south.alive, null);
    assert.equal(getState().phase, "signed-out");
    assert.equal(logins(getState().snapshot!).find((l) => l.slot === 1)?.signedOut, true);
    const sid = south.sid;
    await getBack();
    assert.equal(south.sid, sid, "not signed in by itself");
    assert.deepEqual(await signInAll(), { 1: { ok: true } });
    assert.equal(getState().phase, "ready");
    assert.equal(logins(getState().snapshot!).find((l) => l.slot === 1)?.signedOut, undefined);
  } finally {
    overrideBridge(null);
    await signOut();
  }
});

test("signing out keeps the family on the Wilma page: one click signs every Wilma in again, nothing by itself", async () => {
  await resetApp();
  updateSettings({ ...DEFAULT_SETTINGS, staySignedIn: true });
  const { north, south } = family();
  try {
    await signInWithPassword(NORTH, "parent", "fictional-north", undefined, false, "guardian");
    await addWilma(SOUTH, "parent", "fictional-south");
    await syncNow();
    const first = getState().snapshot!.account;
    await signOut();
    assert.equal(north.alive, null);
    assert.equal(south.alive, null);
    assert.equal(getState().phase, "signed-out");
    assert.deepEqual(getState().snapshot!.account, first, "the family stays on the page");
    assert.ok(logins(getState().snapshot!).every((l) => l.signedOut));
    const sids = [north.sid, south.sid];
    await getBack();
    assert.deepEqual([north.sid, south.sid], sids, "signed out by the parent, nothing signs in by itself");
    assert.deepEqual(await savedLinkedSessions(), {});

    // One click: every Wilma with its remembered password.
    assert.deepEqual(await signInAll(), { 0: { ok: true }, 1: { ok: true } });
    assert.equal(getState().phase, "ready");
    assert.deepEqual(getState().snapshot!.children.map((c) => c.number), ["1234", "1234@1"]);

    // From the sample family back to the Wilma page: the family signed in here last.
    await signInDemo();
    await leaveDemo();
    assert.deepEqual(getState().snapshot!.account, first);
    assert.deepEqual(await signInAll(), { 0: { ok: true }, 1: { ok: true } });

    // With no family on the page, signing in with the added Wilma's login brings the same family back.
    await signOut();
    activateAccount(null);
    await signInWithPassword(SOUTH, "parent", "fictional-south", undefined, false, "guardian");
    assert.deepEqual(getState().snapshot!.account, first, "the same family");
    assert.equal(getState().phase, "signed-out", "the first Wilma isn't in yet");
    assert.deepEqual(await signInAll(), { 0: { ok: true } });

    // Asked for the password each time: nothing kept, and the Wilmas ask for it.
    await signOut();
    updateSettings({ rememberPassword: false, staySignedIn: false, wilmaPassword: "", passwords: {} });
    assert.deepEqual(await signInAll(), { 0: { password: true }, 1: { password: true } });
    assert.deepEqual(await signInAll({ 0: "fictional-north", 1: "fictional-south" }), { 0: { ok: true }, 1: { ok: true } });
    assert.deepEqual(getState().settings.passwords, {}, "still not kept");

    // Forgotten: an empty page, as at first.
    await forgetThisFamily();
    assert.equal(getState().snapshot, null);
    assert.equal(knownFamilies().length, 0);
  } finally {
    overrideBridge(null);
    await resetApp();
  }
});

test("Change user with one Wilma signs in another account: its own family, and the first stays on this computer", async () => {
  await resetApp();
  updateSettings({ ...DEFAULT_SETTINGS, staySignedIn: false });
  const { north, south } = family();
  try {
    await signInWithPassword(NORTH, "parent", "fictional-north", undefined, false, "guardian");
    const first = accountKey(getState().snapshot!.account);
    await signOut();
    // The same login (in any case, spaces around): just signed in, with the password kept.
    assert.deepEqual(await changeLogin(0, NORTH, " Parent ", ""), { ok: true });
    assert.equal(accountKey(getState().snapshot!.account), first);
    await signOut();

    // Another user on the same Wilma: its password is asked, then it's another family.
    Object.assign(north, { user: "other", password: "fictional-other" });
    assert.deepEqual(await changeLogin(0, NORTH, "other", ""), { password: true });
    assert.deepEqual(await changeLogin(0, NORTH, "other", "fictional-other", "guardian"), { ok: true });
    assert.equal(getState().snapshot!.account.username, "other");
    assert.equal(getState().phase, "ready");
    assert.equal(knownFamilies().length, 2, "the first family stays on this computer");

    // Another school's Wilma: another family again.
    await signOut();
    assert.deepEqual(await changeLogin(0, SOUTH, "parent", "fictional-south", "guardian"), { ok: true });
    assert.equal(getState().snapshot!.account.baseUrl, SOUTH);
    assert.equal(knownFamilies().length, 3);
    assert.equal(south.alive !== null, true);

    // And the first login brings the first family back.
    Object.assign(north, { user: "parent", password: "fictional-north" });
    await signOut();
    assert.deepEqual(await changeLogin(0, NORTH, "parent", "fictional-north"), { ok: true });
    assert.equal(accountKey(getState().snapshot!.account), first);
  } finally {
    overrideBridge(null);
    await resetApp();
  }
});

test("Change user on one of two Wilmas takes that Wilma's place: the same school's other user, or another school's Wilma", async () => {
  await resetApp();
  updateSettings({ ...DEFAULT_SETTINGS, staySignedIn: false });
  const { south, east } = family();
  try {
    await signInWithPassword(NORTH, "parent", "fictional-north", undefined, false, "guardian");
    await addWilma(SOUTH, "parent", "fictional-south");
    const first = accountKey(getState().snapshot!.account);
    await signOut();

    // The other guardian on the second school's Wilma: in its place, in the same family.
    Object.assign(south, { user: "other", password: "fictional-other" });
    assert.deepEqual(await changeLogin(1, SOUTH, "other", "fictional-other"), { ok: true });
    assert.deepEqual(logins(getState().snapshot!).map((l) => `${l.slot} ${l.account.username}`), ["0 parent", "1 other"]);
    assert.equal(accountKey(getState().snapshot!.account), first);

    // Another school's Wilma instead of the second: added, then the second goes (its children and password too).
    Object.assign(east, { user: "parent", password: "fictional-east", role: "guardian" });
    await signOutWilma(1);
    assert.deepEqual(await changeLogin(1, EAST, "parent", "fictional-east"), { ok: true });
    assert.deepEqual(logins(getState().snapshot!).map((l) => `${l.slot} ${l.account.baseUrl}`), [`0 ${NORTH}`, `2 ${EAST}`]);
    assert.equal(accountKey(getState().snapshot!.account), first);
    assert.equal(getState().snapshot!.children.some((c) => c.number.endsWith("@1")), false);
    assert.equal(Object.keys(getState().settings.passwords).some((k) => k.includes("south")), false);

    // The first Wilma, still signed out, signs in with the rest.
    assert.deepEqual(await signInAll(), { 0: { ok: true } });
    assert.equal(getState().phase, "ready");
  } finally {
    overrideBridge(null);
    await resetApp();
  }
});

test("asking for the password each time: kept passwords aren't used, and go only once the settings close", async () => {
  await resetApp();
  updateSettings({ ...DEFAULT_SETTINGS, staySignedIn: true, rememberPassword: true });
  family();
  try {
    await signInWithPassword(NORTH, "parent", "fictional-north", undefined, false, "guardian");
    const account = getState().snapshot!.account;
    assert.equal(passwordOf(account), "fictional-north");
    // Tried on the way to another choice: not used meanwhile, and back once a choice keeps passwords again.
    updateSettings({ staySignedIn: false, rememberPassword: false });
    assert.equal(passwordOf(account), "");
    updateSettings({ rememberPassword: true });
    assert.equal(passwordOf(account), "fictional-north");
    // Chosen as the settings close: gone.
    updateSettings({ rememberPassword: false });
    forgetPasswordsIfAsked();
    assert.deepEqual(getState().settings.passwords, {});
    updateSettings({ rememberPassword: true });
    assert.equal(passwordOf(account), "");
  } finally {
    overrideBridge(null);
    await resetApp();
  }
});

/*
 * A sign-in still on its way when the parent does something else (signs a Wilma out, picks the sample family, signs it
 * in themself) is cancelled: it can't bring the Wilma back, take the page's place, or save its session. Wilma's answer
 * is what's late here: Wilma has already taken the login when the app hears back, as on a slow connection.
 */
function heldAnswer(fakes: ReturnType<typeof family>, when: (url: URL, wire: WireRequest) => boolean) {
  const bridge = fakeWilmas({ "north.inschool.fi": fakes.north, "south.inschool.fi": fakes.south, "east.inschool.fi": fakes.east });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let reached!: () => void;
  const arrived = new Promise<void>((resolve) => (reached = resolve));
  let held = false;
  /** The shared session file's writes (the login each). */
  const shared: string[] = [];
  overrideBridge(async (path, init) => {
    if (path === "session/set") {
      const { login } = init.body as { login: { baseUrl: string; username: string } };
      shared.push(`${login.baseUrl} ${login.username}`);
    }
    const result = await bridge(path, init);
    const wire = init.body as WireRequest;
    if (path === "wilma" && !held && when(new URL(wire.url), wire)) {
      held = true;
      reached();
      await gate;
    }
    return result;
  });
  return { arrived, release, shared };
}

const loginPost = (host: string) => (url: URL, wire: WireRequest) => wire.method === "POST" && url.host === host && url.pathname === "/login";

test("a Wilma signed out while the app signs it in again by itself stays out, its session unsaved", async () => {
  await resetApp();
  updateSettings({ ...DEFAULT_SETTINGS, staySignedIn: true });
  const fakes = family();
  try {
    await signInWithPassword(NORTH, "parent", "fictional-north", undefined, false, "guardian");
    await addWilma(SOUTH, "parent", "fictional-south");
    await syncNow();
    const south = logins(getState().snapshot!).find((l) => l.slot === 1)!.account;
    const hold = heldAnswer(fakes, loginPost("south.inschool.fi"));
    fakes.south.alive = null;
    await syncNow(); // Wilma ended it: the app signs in again at once
    await hold.arrived;
    const writes = hold.shared.length;
    await signOutWilma(1);
    hold.release();
    await getBack(); // the sign-in that was under way, to its end
    assert.equal(getState().loginStatus[1]?.live, false, "still out");
    assert.equal(getState().loginStatus[1]?.why, "You signed out.");
    assert.equal(logins(getState().snapshot!).find((l) => l.slot === 1)?.signedOut, true);
    assert.equal(getState().phase, "signed-out");
    assert.ok(!(await savedLinkedSessions())[accountKey(south)!]?.state, "no session kept for the next start");
    assert.deepEqual(hold.shared.slice(writes), [], "nothing written to the shared session file");
  } finally {
    overrideBridge(null);
    await resetApp();
  }
});

test("the sample family picked while a sign-in is on its way: the sign-in doesn't take its place", async () => {
  await resetApp();
  updateSettings({ ...DEFAULT_SETTINGS });
  const fakes = family();
  try {
    const hold = heldAnswer(fakes, loginPost("north.inschool.fi"));
    // Cancelled the moment the sample family is picked: what it comes to is read at the end.
    const outcome = signInWithPassword(NORTH, "parent", "fictional-north", undefined, false, "guardian").then(() => "signed in", (err: Error) => err.name);
    await hold.arrived;
    await signInDemo();
    hold.release();
    assert.equal(await outcome, "SignInCancelledError");
    assert.equal(getState().snapshot?.account.via, "demo", "still the sample family");
    assert.equal(getState().phase, "ready");
    assert.deepEqual(hold.shared, [], "nothing written to the shared session file");
    assert.ok(!knownFamilies().some((f) => f.account.baseUrl === NORTH), "no family made from the late sign-in");
  } finally {
    overrideBridge(null);
    await resetApp();
  }
});

test("the parent signing a Wilma in while the app does it by itself: the parent's sign-in is the one that stays", async () => {
  await resetApp();
  updateSettings({ ...DEFAULT_SETTINGS, staySignedIn: true });
  const fakes = family();
  try {
    await signInWithPassword(NORTH, "parent", "fictional-north", undefined, false, "guardian");
    await addWilma(SOUTH, "parent", "fictional-south");
    await syncNow();
    const hold = heldAnswer(fakes, loginPost("south.inschool.fi"));
    fakes.south.alive = null;
    await syncNow();
    await hold.arrived;
    assert.deepEqual(await signInAll({ 1: "fictional-south" }), { 1: { ok: true } });
    const parents = fakes.south.alive;
    hold.release();
    await getBack();
    await syncNow();
    assert.equal(fakes.south.alive, parents, "Wilma's live session is still the parent's");
    assert.equal(getState().loginStatus[1]?.live, true);
    assert.equal(getState().phase, "ready");
  } finally {
    overrideBridge(null);
    await resetApp();
  }
});

test("the app doesn't sign a Wilma in by itself while the parent is signing it in", async () => {
  await resetApp();
  updateSettings({ ...DEFAULT_SETTINGS, staySignedIn: false });
  const fakes = family();
  try {
    await signInWithPassword(NORTH, "parent", "fictional-north", undefined, false, "guardian");
    await addWilma(SOUTH, "parent", "fictional-south");
    await syncNow();
    fakes.south.alive = null;
    await syncNow(); // Wilma ended it, and nothing signs in by itself yet
    const hold = heldAnswer(fakes, loginPost("south.inschool.fi"));
    const parents = signInAll({ 1: "fictional-south" });
    await hold.arrived;
    updateSettings({ staySignedIn: true });
    const logins = () => fakes.south.requests.filter((r) => r === "POST /login").length;
    const before = logins();
    await getBack();
    assert.equal(logins(), before, "no login of its own");
    hold.release();
    assert.deepEqual(await parents, { 1: { ok: true } });
    assert.equal(getState().phase, "ready");
  } finally {
    overrideBridge(null);
    await resetApp();
  }
});

test("a Wilma that doesn't show a guardian its bulletins still has everything else read", async () => {
  await resetApp();
  updateSettings({ ...DEFAULT_SETTINGS });
  const fakes = family();
  fakes.south.refusesNews = true;
  try {
    await signInWithPassword(NORTH, "parent", "fictional-north", undefined, false, "guardian");
    await addWilma(SOUTH, "parent", "fictional-south");
    await syncNow();
    const snap = getState().snapshot!;
    assert.equal(getState().sync.error, null, "no 'Couldn't read' for the Wilma that refused /news");
    const fromSouth = <T,>(items: Record<number, T>) => Object.keys(items).filter((id) => loginOfId(Number(id)) === 1).length;
    assert.ok(fromSouth(snap.messages) > 0, "its messages are read");
    assert.equal(fromSouth(snap.news), 0, "and it has no bulletins");
    assert.ok(Object.keys(snap.news).length > 0, "the other Wilma's bulletins are there");
    assert.ok(snap.perChild[familyChild(1, "1234")]?.overview, "its front page is read");
  } finally {
    overrideBridge(null);
    await resetApp();
  }
});
