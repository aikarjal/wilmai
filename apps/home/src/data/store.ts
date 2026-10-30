/*
 * Everything the app knows, in this browser only: the Wilma snapshot,
 * what the parent did here, Jev's answers (IndexedDB) and settings
 * (localStorage). Nothing is sent anywhere except Wilma and, when turned
 * on, Jev.
 *
 * Secrets are kept like the WilmAI CLI keeps its saved logins: on this
 * computer, scrambled (base64 with a prefix, as `obfuscateSecret` in the
 * CLI), not encrypted. The Wilma session is in IndexedDB, the Jev and
 * OpenAI keys in localStorage. Scrambled only so a glance at the files doesn't show them;
 * anyone with the user's account can read them, and the README says so.
 */
import { useSyncExternalStore } from "react";
import { clear, del, get, set } from "idb-keyval";
import { oldKeychain } from "../wilma/transport";
import { t } from "../i18n";
import { DEFAULT_SETTINGS, keepsPassword, viewerOf, type AccountInfo, type ItemTranslation, type JevRecord, type LocalState, type LunaRecord, type Settings, type Snapshot, type UsageBucket, type Viewer } from "./model";
import { normalizeAIBudget } from "./ai-budget";
import type { CalEvent } from "./calendar";

export interface SyncStatus {
  running: boolean;
  step: string | null;
  error: string | null;
  lastOk: number | null;
}

export interface JevStatus {
  running: boolean;
  done: number;
  total: number;
  error: string | null;
  calls: number;
  inputTokens: number;
  /** This visit's questions: about items Jev hadn't seen, and items whose content changed since (by part). */
  newItems: number;
  changedItems: number;
  changedParts: Record<string, number>;
}

export interface AppState {
  /** Signed out: not every Wilma of the family is signed in, and the Wilmas page shows (data/logins.ts). */
  phase: "loading" | "signed-out" | "ready";
  snapshot: Snapshot | null;
  local: LocalState;
  jev: Record<string, JevRecord>;
  /** Jev's own answers from before the experiment, put aside to compare Luna's with (luna/compare.ts). */
  jevBaseline: Record<string, JevRecord>;
  /** The Luna experiment: what Luna read, by item key, and the OpenAI usage by month. */
  luna: Record<string, LunaRecord>;
  usage: Record<string, UsageBucket>;
  /** Items translated into the language chosen in Settings, by item key (data/translations.ts). */
  translations: Record<string, ItemTranslation>;
  /** Wilma's short texts translated (data/phrases.ts), by language and text: for every account on this computer. */
  phrases: Record<string, string>;
  /** The translations' background run, and the items being translated now. */
  translationStatus: { running: boolean; done: number; total: number; error: string | null; busy: string[] };
  settings: Settings;
  sync: SyncStatus;
  jevStatus: JevStatus;
  lunaStatus: { running: boolean; done: number; total: number; error: string | null };
  /** A newer version published on wilm.ai (see data/updates.ts). */
  update: import("./update-state").UpdateState;
  /** OpenAI couldn't be reached from this network (blocked, or no connection), and since when: AI waits (luna/client.ts). */
  openaiBlocked: { at: number; reason: "network" | "intercepted"; detail: string | null } | null;
  /** Each Wilma login's session, by slot (data/logins.ts). */
  loginStatus: Record<number, LoginStatus>;
}

/** A Wilma login's session: live, or not (why, and when staying signed in tries again). */
export interface LoginStatus {
  live: boolean;
  /** Why it isn't live, for the parent (null: not signed in yet this time). */
  why: string | null;
  /** Staying signed in: when it signs in again by itself (a pause while that Wilma is in use elsewhere). */
  rejoinAt: number | null;
  /** Signing in again by itself didn't work: the parent signs in. */
  failed: string | null;
}

export interface SavedSession {
  account: AccountInfo;
  /** wilma-client's exportSession(): the login's cookies ("" when Wilma ended it). */
  state: string;
  /** The login's key in WilmAI's shared session file (see sharedSessionFor). */
  sharedKey?: string;
}

/** Sessions saved before the app used wilma-client kept bare cookie pairs. */
function upgradeSession(saved: (SavedSession & { cookies?: [string, string][] }) | undefined): SavedSession | null {
  if (!saved?.account) return null;
  if (typeof saved.state === "string") return saved;
  if (!Array.isArray(saved.cookies)) return null;
  const domain = new URL(saved.account.baseUrl).hostname;
  const cookies = saved.cookies.map(([key, value]) => ({ key, value, domain, path: "/", hostOnly: true }));
  return { account: saved.account, state: JSON.stringify({ cookies }) };
}

const SETTINGS_KEY = "wilmai.settings";
const JEV_KEY = "wilmai.jevKey";
const OPENAI_KEY = "wilmai.openaiKey";
const ANTHROPIC_KEY = "wilmai.anthropicKey";
const WILMA_PASSWORD = "wilmai.wilmaPassword";
const PASSWORDS = "wilmai.passwords";
/** Set once the key in the old keychain place has been looked for (so macOS asks at most once more). */
const MOVED_KEY = "wilmai.keyMoved";
const SECRET_PREFIX = "wilmai::";

/** Scrambled, not encrypted (the CLI's `obfuscateSecret`): base64 of a prefix and the secret. */
function scramble(value: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(SECRET_PREFIX + value)));
}

function unscramble(value: string | null): string | null {
  if (!value) return null;
  try {
    const text = new TextDecoder().decode(Uint8Array.from(atob(value), (c) => c.charCodeAt(0)));
    return text.startsWith(SECRET_PREFIX) ? text.slice(SECRET_PREFIX.length) : null;
  } catch {
    return null;
  }
}

function passwordsOf(json: string | null): Record<string, string> {
  try {
    const saved = JSON.parse(json ?? "{}") as unknown;
    return saved && typeof saved === "object" ? (saved as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function loadSettings(): Settings {
  try {
    // An older browser setup kept the key in the settings as it was; it moves out on the next save.
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<Settings>;
    // The app reads with GPT-6 Luna (another model was a choice during the experiment; the eval suite still tries others).
    const loaded: Settings = {
      ...DEFAULT_SETTINGS,
      ...saved,
      aiMonthlyBudgetUsd: normalizeAIBudget(saved.aiMonthlyBudgetUsd),
      readingModel: DEFAULT_SETTINGS.readingModel,
      jevKey: unscramble(localStorage.getItem(JEV_KEY)) ?? saved.jevKey ?? "",
      openaiKey: unscramble(localStorage.getItem(OPENAI_KEY)) ?? "",
      anthropicKey: unscramble(localStorage.getItem(ANTHROPIC_KEY)) ?? "",
      wilmaPassword: unscramble(localStorage.getItem(WILMA_PASSWORD)) ?? "",
      passwords: passwordsOf(unscramble(localStorage.getItem(PASSWORDS))),
    };
    // Asked each time, but closed before the sign-in settings were: what was kept goes now.
    return keepsPassword(loaded) ? loaded : { ...loaded, wilmaPassword: "", passwords: {} };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let state: AppState = {
  phase: "loading",
  snapshot: null,
  local: { opened: {}, done: {} },
  jev: {},
  jevBaseline: {},
  luna: {},
  usage: {},
  translations: {},
  phrases: {},
  translationStatus: { running: false, done: 0, total: 0, error: null, busy: [] },
  settings: loadSettings(),
  sync: { running: false, step: null, error: null, lastOk: null },
  jevStatus: { running: false, done: 0, total: 0, error: null, calls: 0, inputTokens: 0, newItems: 0, changedItems: 0, changedParts: {} },
  lunaStatus: { running: false, done: 0, total: 0, error: null },
  update: { available: null, current: null, checkedAt: null, error: null, phase: "idle", progress: null },
  openaiBlocked: null,
  loginStatus: {},
};

// A key an older version kept plainly in the settings moves to its scrambled place now.
try {
  if ("jevKey" in JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}")) saveSettings();
} catch {
  // Unreadable settings were already replaced by the defaults.
}

const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const next = typeof patch === "function" ? patch(state) : patch;
  if ("snapshot" in next && accountKey(next.snapshot?.account) !== accountKey(state.snapshot?.account)) accountGeneration += 1;
  state = { ...state, ...next };
  for (const listener of listeners) listener();
  schedulePersist(next);
}

/** Called after every change (outside React: notifications). */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useApp<T>(select: (s: AppState) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => select(state)
  );
}

/* Persistence: debounced, per part, so a burst of sync steps is one write. */
const dirty = new Set<"snapshot" | "local" | "jev" | "jevBaseline" | "luna" | "usage" | "translations" | "phrases">();
let timer: ReturnType<typeof setTimeout> | null = null;
type AccountCache = Pick<AppState, "snapshot" | "local" | "jev" | "jevBaseline" | "luna"> & Partial<Pick<AppState, "translations">>;
let accounts: Record<string, AccountCache> = {};
let accountGeneration = 0;
let resetGeneration = 0;
let writes: Promise<void> = Promise.resolve();

/** School and username identify a cache; sample data has a separate identity. */
export function accountKey(account?: AccountInfo): string | null {
  if (!account) return null;
  if (account.via === "demo") return "demo";
  return JSON.stringify([account.baseUrl.replace(/\/$/, "").toLowerCase(), account.username.trim().toLowerCase()]);
}

/** Async readers must not publish an old account's answer into a new account. */
export const accountScope = () => accountGeneration;
export const resetScope = () => resetGeneration;

function rememberAccount() {
  const key = accountKey(state.snapshot?.account);
  if (!key) return;
  const { snapshot, local, jev, jevBaseline, luna, translations } = state;
  accounts = { ...accounts, [key]: { snapshot, local, jev, jevBaseline, luna, translations } };
}

/** Keep the current account and restore the next one's cache before syncing Wilma. */
export function activateAccount(account: AccountInfo | null) {
  rememberAccount();
  // The one login's remembered password from before there were several Wilmas goes with its family, by login.
  if (state.settings.wilmaPassword && state.snapshot && state.snapshot.account.via !== "demo") rememberPasswordOf(state.snapshot.account, state.settings.wilmaPassword);
  const cached = account ? accounts[accountKey(account)!] : undefined;
  setState({
    snapshot: cached?.snapshot && account ? { ...cached.snapshot, account } : null,
    local: cached?.local ?? { opened: {}, done: {} },
    jev: cached?.jev ?? {}, jevBaseline: cached?.jevBaseline ?? {}, luna: cached?.luna ?? {}, translations: cached?.translations ?? {},
    translationStatus: { running: false, done: 0, total: 0, error: null, busy: [] },
    sync: { running: false, step: null, error: null, lastOk: cached?.snapshot?.syncedAt?.getTime() ?? null },
    jevStatus: { running: false, done: 0, total: 0, error: null, calls: 0, inputTokens: 0, newItems: 0, changedItems: 0, changedParts: {} },
    lunaStatus: { running: false, done: 0, total: 0, error: null },
    loginStatus: {},
  });
}

/** The family on this computer that has this login (as its first or an added one), by its first login. */
export function familyFor(account: AccountInfo): AccountInfo | null {
  const key = accountKey(account);
  rememberAccount();
  if (accounts[key!]?.snapshot) return accounts[key!].snapshot!.account;
  for (const { snapshot } of Object.values(accounts)) {
    if (snapshot?.logins?.some((l) => accountKey(l.account) === key)) return snapshot.account;
  }
  return null;
}

/** A login's remembered password ("" when none): by login, or (from before there were several Wilmas) the one login's. */
export function passwordOf(account: AccountInfo): string {
  const { settings, snapshot } = state;
  // Asked each time: none is used, even before they're deleted (forgetPasswordsIfAsked).
  if (!keepsPassword(settings)) return "";
  const key = accountKey(account)!;
  return settings.passwords[key] ?? (key === accountKey(snapshot?.account) ? settings.wilmaPassword : "");
}

/** With the password asked each time, none is kept: the ones kept before go (the sign-in settings closing, the app starting). */
export function forgetPasswordsIfAsked() {
  const { settings } = state;
  if (!keepsPassword(settings) && (Object.keys(settings.passwords).length || settings.wilmaPassword)) updateSettings({ wilmaPassword: "", passwords: {} });
}

/** Remember a login's password (when passwords are kept), or forget it (null). */
export function rememberPasswordOf(account: AccountInfo, password: string | null) {
  const { settings, snapshot } = state;
  const key = accountKey(account)!;
  if (password !== null && !keepsPassword(settings)) return;
  const { [key]: _, ...rest } = settings.passwords;
  updateSettings({ passwords: password === null ? rest : { ...rest, [key]: password }, ...(key === accountKey(snapshot?.account) ? { wilmaPassword: "" } : {}) });
}

/**
 * The families signed in on this computer before (not the sample family): what the start page offers back, one click
 * when their passwords are remembered. Each with its Wilma logins (the usernames always stay).
 */
export function knownFamilies(): { account: AccountInfo; logins: { slot: number; account: AccountInfo }[]; viewer: Viewer }[] {
  rememberAccount();
  return Object.values(accounts)
    .flatMap(({ snapshot, local }) => (snapshot && snapshot.account.via !== "demo" ? [{ snapshot, local }] : []))
    .map(({ snapshot, local }) => ({ account: snapshot.account, logins: snapshot.logins ?? [{ slot: 0, account: snapshot.account }], viewer: viewerOf(snapshot.account, local) }));
}

/** Forget a family on this computer: its data, AI answers and passwords (Reset app does it for all). */
export function forgetFamily(account: AccountInfo) {
  const key = accountKey(account)!;
  const family = accounts[key]?.snapshot;
  const gone = new Set((family?.logins ?? [{ account }]).map((l) => accountKey(l.account)));
  accounts = Object.fromEntries(Object.entries(accounts).filter(([k]) => k !== key));
  updateSettings({ passwords: Object.fromEntries(Object.entries(state.settings.passwords).filter(([k]) => !gone.has(k))) });
  dirty.add("snapshot");
  void flushPersisted();
}

/** Drafts and child filters belong to the account, even when item IDs overlap. */
export function accountStorageKey(part: string): string {
  return `wilmai.account.${encodeURIComponent(accountKey(state.snapshot?.account) ?? "signed-out")}.${part}`;
}

function migrateAccountStorage() {
  if (!state.snapshot) return;
  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const key = localStorage.key(i);
    if (!key || !/^wilmai\.(draft\.|newmsg\.|children$)/.test(key)) continue;
    localStorage.setItem(accountStorageKey(key.slice("wilmai.".length)), localStorage.getItem(key)!);
    localStorage.removeItem(key);
  }
}

function saveSettings() {
  const { jevKey, openaiKey, anthropicKey, wilmaPassword, passwords, ...rest } = state.settings;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(rest));
  // The Wilma password while it's remembered (one-click sign-in) or staying signed in needs it.
  if (wilmaPassword && keepsPassword(rest)) localStorage.setItem(WILMA_PASSWORD, scramble(wilmaPassword));
  else localStorage.removeItem(WILMA_PASSWORD);
  if (Object.keys(passwords ?? {}).length && keepsPassword(rest)) localStorage.setItem(PASSWORDS, scramble(JSON.stringify(passwords)));
  else localStorage.removeItem(PASSWORDS);
  if (jevKey) localStorage.setItem(JEV_KEY, scramble(jevKey));
  else localStorage.removeItem(JEV_KEY);
  if (openaiKey) localStorage.setItem(OPENAI_KEY, scramble(openaiKey));
  else localStorage.removeItem(OPENAI_KEY);
  if (anthropicKey) localStorage.setItem(ANTHROPIC_KEY, scramble(anthropicKey));
  else localStorage.removeItem(ANTHROPIC_KEY);
}

/**
 * Desktop app: earlier versions kept the Jev key in the system keychain,
 * where macOS asks for the password again after every new build of an app
 * that isn't signed with a Developer ID. Look there once, move the key into
 * the app's own storage, and never look again. Nothing waits for this: the
 * app shows at once and Jev starts when the key is in.
 */
export async function loadSecrets(): Promise<void> {
  const generation = resetScope();
  if (!oldKeychain || localStorage.getItem(MOVED_KEY)) return;
  localStorage.setItem(MOVED_KEY, "1");
  if (state.settings.jevKey) return;
  const stored = await oldKeychain.get("jev-key").catch(() => null);
  // A key typed in Settings meanwhile wins.
  if (generation === resetScope() && stored && !state.settings.jevKey) updateSettings({ jevKey: stored });
}

function schedulePersist(patch: Partial<AppState>) {
  if ("settings" in patch) saveSettings();
  if ("snapshot" in patch) dirty.add("snapshot");
  if ("local" in patch) dirty.add("local");
  if ("jev" in patch) dirty.add("jev");
  if ("luna" in patch) dirty.add("luna");
  if ("jevBaseline" in patch) dirty.add("jevBaseline");
  if ("usage" in patch) dirty.add("usage");
  if ("translations" in patch) dirty.add("translations");
  if ("phrases" in patch) dirty.add("phrases");
  if (!dirty.size || timer) return;
  timer = setTimeout(() => {
    void flushPersisted();
  }, 400);
}

/** Drain pending writes before switching accounts, closing or resetting. */
export function flushPersisted(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  const parts = [...dirty];
  dirty.clear();
  rememberAccount();
  const values = parts.map((part) => [part, state[part]] as const);
  const savedAccounts = accounts;
  writes = writes.then(async () => {
    // Usage and translations alone don't rewrite the accounts (a reset clears them): the next other change does.
    await Promise.all([...values.map(([part, value]) => set(part, value)), ...(parts.some((p) => p !== "usage" && p !== "translations" && p !== "phrases") ? [set("accounts", savedAccounts)] : [])]);
  }).catch(() => {}); // No IndexedDB in pure eval runs.
  return writes;
}

export async function loadPersisted(): Promise<{ session: SavedSession | null }> {
  const [snapshot, local, jev, session, luna, usage, jevBaseline, savedAccounts, translations, phrases] = await Promise.all([
    get<Snapshot>("snapshot"),
    get<LocalState>("local"),
    get<Record<string, JevRecord>>("jev"),
    get<SavedSession>("session"),
    get<Record<string, LunaRecord>>("luna"),
    get<Record<string, UsageBucket>>("usage"),
    get<Record<string, JevRecord>>("jevBaseline"),
    get<Record<string, AccountCache>>("accounts"),
    get<Record<string, ItemTranslation>>("translations"),
    get<Record<string, string>>("phrases"),
  ]).catch(() => [undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined] as const);
  state = {
    ...state,
    snapshot: snapshot ?? null,
    local: local ?? state.local,
    jev: jev ?? {},
    luna: luna ?? {},
    usage: usage ?? {},
    jevBaseline: jevBaseline ?? {},
    translations: translations ?? {},
    phrases: phrases ?? {},
  };
  accounts = savedAccounts ?? {};
  rememberAccount(); // Migrate the existing installation without losing its AI results.
  migrateAccountStorage();
  // The one login's remembered password from before there were several Wilmas, kept by login from now on.
  if (state.settings.wilmaPassword && state.snapshot && state.snapshot.account.via !== "demo") rememberPasswordOf(state.snapshot.account, state.settings.wilmaPassword);
  return { session: upgradeSession(session) };
}

/** The session kept for the next start (the login it came from, "" state when Wilma ended it). */
export async function savedSession(): Promise<SavedSession | null> {
  return upgradeSession(await get<SavedSession>("session").catch(() => undefined));
}

export function saveSession(session: SavedSession | null) {
  writes = writes.then(() => session ? set("session", session) : del("session")).catch(() => {});
  return writes;
}

/** The other Wilma logins' sessions (data/logins.ts; the first login's is "session") kept for the next start, by login (accountKey). */
export async function savedLinkedSessions(): Promise<Record<string, SavedSession>> {
  await writes; // One just ended or kept is read as written.
  const saved = await get<Record<string, SavedSession>>("linkedSessions").catch(() => undefined);
  return Object.fromEntries(Object.entries(saved ?? {}).flatMap(([key, s]) => (upgradeSession(s) ? [[key, s]] : [])));
}

/** Keep one of those sessions (null: forget it), or forget them all (no account). */
export function saveLinkedSession(account: AccountInfo | null, session: SavedSession | null) {
  writes = writes
    .then(async () => {
      if (!account) return del("linkedSessions");
      const saved = { ...((await get<Record<string, SavedSession>>("linkedSessions")) ?? {}) };
      if (session) saved[accountKey(account)!] = session;
      else delete saved[accountKey(account)!];
      await set("linkedSessions", saved);
    })
    .catch(() => {});
  return writes;
}

export function updateSettings(patch: Partial<Settings>) {
  setState((s) => ({ settings: { ...s.settings, ...patch, aiMonthlyBudgetUsd: normalizeAIBudget(patch.aiMonthlyBudgetUsd ?? s.settings.aiMonthlyBudgetUsd) } }));
}

/** Forget everything this app stored on this device. */
export async function forgetEverything() {
  resetGeneration += 1;
  if (timer) clearTimeout(timer);
  timer = null;
  dirty.clear();
  await writes;
  await clear();
  accounts = {};
  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const key = localStorage.key(i);
    if (key?.startsWith("wilmai.")) localStorage.removeItem(key);
  }
  // A reset must not import a key from an earlier version on the next launch.
  localStorage.setItem(MOVED_KEY, "1");
  setState({ settings: { ...DEFAULT_SETTINGS }, usage: {}, translations: {}, phrases: {} });
  await flushPersisted();
}

/** Who the app is for on the current account: a guardian or the student themself. */
export const viewer = (): Viewer => viewerOf(state.snapshot?.account, state.local);
export const useViewer = (): Viewer => useApp((s) => viewerOf(s.snapshot?.account, s.local));

/** Choose who the app is for on this account (Settings); null goes back to what Wilma says. */
export function setViewAs(viewAs: Viewer | null) {
  setState((s) => {
    const local = { ...s.local };
    if (viewAs) local.viewAs = viewAs;
    else delete local.viewAs;
    return { local };
  });
}

export function markOpened(key: string) {
  if (state.local.opened[key]) return;
  setState((s) => ({ local: { ...s.local, opened: { ...s.local.opened, [key]: Date.now() } } }));
}

/** Take ("yes") or dismiss ("no") a calendar event, or forget the answer (null): kept on its key, and off its other keys (a twin's). */
export function setCalendarDecision(e: Pick<CalEvent, "key" | "aliases">, decision: "yes" | "no" | null) {
  setState((s) => {
    const calendar = s.local.calendar ?? { decisions: {}, kinds: {} };
    const decisions = { ...calendar.decisions };
    for (const alias of e.aliases ?? []) delete decisions[alias];
    if (decision) decisions[e.key] = decision;
    else delete decisions[e.key];
    return { local: { ...s.local, calendar: { ...calendar, decisions } } };
  });
}

/** Whether a kind of event goes to the family calendar. */
export function setCalendarKind(kind: string, on: boolean) {
  setState((s) => {
    const calendar = s.local.calendar ?? { decisions: {}, kinds: {} };
    return { local: { ...s.local, calendar: { ...calendar, kinds: { ...calendar.kinds, [kind]: on } } } };
  });
}

/** Pin an item to the top of the inbox, or unpin it (only in this app; nothing changes in Wilma). */
export function togglePinned(key: string) {
  setState((s) => {
    const pinned = { ...s.local.pinned };
    if (pinned[key]) delete pinned[key];
    else pinned[key] = Date.now();
    return { local: { ...s.local, pinned } };
  });
}

export function toggleDone(key: string) {
  setState((s) => {
    const done = { ...s.local.done };
    if (done[key]) delete done[key];
    else done[key] = Date.now();
    return { local: { ...s.local, done } };
  });
}
