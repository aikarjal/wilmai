/*
 * Everything the app knows, in this browser only: the Wilma snapshot,
 * what the parent did here, Jev's answers (IndexedDB) and settings
 * (localStorage). Nothing is sent anywhere except Wilma and, when turned
 * on, Jev.
 *
 * Secrets, the remembered Wilma passwords and the OpenAI key: in the desktop
 * app, in the system keychain (the macOS Keychain, Windows Credential
 * Manager), one entry read once at start (loadSecrets) and written whole
 * after a change. In a browser, and in the desktop app while the keychain
 * can't be used, in localStorage, scrambled (base64 with a prefix, as
 * `obfuscateSecret` in the CLI), not encrypted, as before 0.4.0: anyone with
 * the user's account can read them, and the README says so. The Jev key stays
 * in localStorage (Jev isn't used). The Wilma session is in IndexedDB.
 */
import { useSyncExternalStore } from "react";
import { clear, del, get, set } from "idb-keyval";
import { oldKeychain, secretsKeychain } from "../wilma/transport";
import { t } from "../i18n";
import { DEFAULT_SETTINGS, keepsPassword, viewerOf, type AccountInfo, type Child, type ChildLook, type GradeKind, type ItemTranslation, type JevRecord, type LocalState, type LunaRecord, type Settings, type Snapshot, type UsageBucket, type Viewer } from "./model";
import type { NoteKind } from "./notes";
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
  /** Where the passwords and the OpenAI key are (see loadSecrets). */
  secrets: SecretsPlace;
}

/**
 * Where the secrets are: "keychain" (desktop app; also while it's being read at start), "app" (a browser: localStorage),
 * "app-for-now" (the keychain couldn't be used: localStorage until the next start tries it again).
 */
export type SecretsPlace = "keychain" | "app" | "app-for-now";

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
  /** The login's v1 label in WilmAI's shared session file, made while the app had its password (see SharedLogin). */
  v1Key?: string;
}

/**
 * Sessions saved before the app used wilma-client kept bare cookie pairs. Before 0.4.0 the shared file's label was
 * kept as `sharedKey`: a v1 label (or, for a test Wilma, one with a "test:" prefix, which isn't needed any more).
 */
function upgradeSession(saved: (SavedSession & { cookies?: [string, string][]; sharedKey?: string }) | undefined): SavedSession | null {
  if (!saved?.account) return null;
  const { cookies, sharedKey, ...session } = saved;
  if (!session.v1Key && sharedKey && /^[0-9a-f]{64}$/.test(sharedKey)) session.v1Key = sharedKey;
  if (typeof session.state === "string") return session;
  if (!Array.isArray(cookies)) return null;
  const domain = new URL(saved.account.baseUrl).hostname;
  const pairs = cookies.map(([key, value]) => ({ key, value, domain, path: "/", hostOnly: true }));
  return { account: saved.account, state: JSON.stringify({ cookies: pairs }), ...(session.v1Key ? { v1Key: session.v1Key } : {}) };
}

const SETTINGS_KEY = "wilmai.settings";
const JEV_KEY = "wilmai.jevKey";
const OPENAI_KEY = "wilmai.openaiKey";
const WILMA_PASSWORD = "wilmai.wilmaPassword";
const PASSWORDS = "wilmai.passwords";
/** Set once the key in the old keychain place has been looked for (so macOS asks at most once more). */
const MOVED_KEY = "wilmai.keyMoved";
/** The copies here are every secret (a keychain write failed after the entry was read): they replace the entry. */
const SECRETS_WHOLE = "wilmai.secretsWhole";
/** Reset app couldn't delete the keychain entry: the next start deletes it before reading anything. */
const SECRETS_DELETE = "wilmai.secretsDelete";
const SECRET_PREFIX = "wilmai::";

/* The keychain's state (see loadSecrets), declared before the settings load at the start. */
/** The entry was read this start: changes are written to it. */
let keychainRead = false;
/** What the entry holds now, as last read or written (null: no entry; undefined: not known, after a failure). */
let keychainValue: string | null | undefined;
/** The secrets to write next (the newest change), and the writes, one at a time. */
let pendingSecrets: Secrets | null = null;
let keychainWrites: Promise<void> = Promise.resolve();
let secretsLoaded: Promise<void> = Promise.resolve();

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
  secrets: secretsKeychain() ? "keychain" : "app",
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
  // Each child as the family set them up (Settings → Children), whenever the children or the settings change.
  if (("snapshot" in next || "local" in next) && state.snapshot) {
    const children = dressChildren(state.snapshot.children, state.local.looks);
    if (children !== state.snapshot.children) state = { ...state, snapshot: { ...state.snapshot, children } };
  }
  for (const listener of listeners) listener();
  schedulePersist(next);
}

/** The children with their chosen colour, nickname and emoji (the same list when nothing changes). */
export function dressChildren(children: Child[], looks: LocalState["looks"]): Child[] {
  let changed = false;
  const dressed = children.map((c) => {
    const look = looks?.[c.number];
    const base = c.base ?? c.color;
    const emoji = look?.emoji || undefined;
    const next: Child = { ...c, base, color: look?.color ?? base, nick: look?.nickname?.trim() || undefined, emoji, emojiTabs: (emoji && look?.emojiTabs) || undefined };
    if (next.color === c.color && next.base === c.base && next.nick === c.nick && next.emoji === c.emoji && next.emojiTabs === c.emojiTabs) return c;
    changed = true;
    return next;
  });
  return changed ? dressed : children;
}

/** Change how a child shows (a field undefined: back to the default). */
export function setChildLook(child: string, look: Partial<ChildLook>) {
  setState((s) => {
    const merged: ChildLook = { ...s.local.looks?.[child], ...look };
    for (const key of Object.keys(merged) as (keyof ChildLook)[]) if (merged[key] === undefined || merged[key] === "") delete merged[key];
    return { local: { ...s.local, looks: { ...s.local.looks, [child]: merged } } };
  });
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
  const { jevKey, openaiKey, wilmaPassword, passwords, ...rest } = state.settings;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(rest));
  // The Wilma passwords while they're remembered (one-click sign-in) or staying signed in needs them.
  const secrets = keptSecrets({ openaiKey, wilmaPassword, passwords }, keepsPassword(rest));
  if (keychainRead && secretsKeychain()) void saveToKeychain(secrets);
  else saveHere(secrets);
  if (jevKey) localStorage.setItem(JEV_KEY, scramble(jevKey));
  else localStorage.removeItem(JEV_KEY);
}

/* ------------------------------------------------------------------ */
/*  Secrets in the keychain                                            */
/* ------------------------------------------------------------------ */

/*
 * The passwords and the OpenAI key, in the desktop app: one keychain entry
 * holding them all as JSON (src-tauri/src/lib.rs), so a start reads the
 * keychain once and Reset app deletes one entry. Until the entry has been
 * read this start, nothing writes it (a write would replace what's there):
 * changes go to the copies here, which the next read takes in.
 *
 * Moving (each start, loadSecrets): read the entry, take in the copies here
 * (the copies win; versions before 0.4.0 kept everything here), write the
 * result, read it back, and only when it's the same, delete the copies. If
 * the keychain doesn't do it, the copies stay, and the next start tries again.
 * Settings says where they are (AppState.secrets).
 */
type Secrets = Pick<Settings, "openaiKey" | "wilmaPassword" | "passwords">;


/** What's kept: the passwords only while passwords are kept (keepsPassword). */
function keptSecrets(secrets: Secrets, keeps: boolean): Secrets {
  return { openaiKey: secrets.openaiKey ?? "", wilmaPassword: keeps ? (secrets.wilmaPassword ?? "") : "", passwords: keeps ? { ...secrets.passwords } : {} };
}

/** The copies in localStorage, scrambled as before 0.4.0. */
function secretsHere(): Secrets {
  return {
    openaiKey: unscramble(localStorage.getItem(OPENAI_KEY)) ?? "",
    wilmaPassword: unscramble(localStorage.getItem(WILMA_PASSWORD)) ?? "",
    passwords: passwordsOf(unscramble(localStorage.getItem(PASSWORDS))),
  };
}

function saveHere(secrets: Secrets) {
  if (secrets.wilmaPassword) localStorage.setItem(WILMA_PASSWORD, scramble(secrets.wilmaPassword));
  else localStorage.removeItem(WILMA_PASSWORD);
  if (Object.keys(secrets.passwords).length) localStorage.setItem(PASSWORDS, scramble(JSON.stringify(secrets.passwords)));
  else localStorage.removeItem(PASSWORDS);
  if (secrets.openaiKey) localStorage.setItem(OPENAI_KEY, scramble(secrets.openaiKey));
  else localStorage.removeItem(OPENAI_KEY);
}

function deleteHere() {
  for (const key of [WILMA_PASSWORD, PASSWORDS, OPENAI_KEY, SECRETS_WHOLE]) localStorage.removeItem(key);
}

const hasSecrets = (s: Secrets) => Boolean(s.openaiKey || s.wilmaPassword || Object.keys(s.passwords).length);

/** The entry's value: JSON, everything past ASCII escaped so every keychain hands it back unchanged (null: nothing to keep). */
function encodeSecrets(secrets: Secrets): string | null {
  if (!hasSecrets(secrets)) return null;
  const json = JSON.stringify({ v: 1, openaiKey: secrets.openaiKey, wilmaPassword: secrets.wilmaPassword, passwords: secrets.passwords });
  return json.replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** The entry's secrets; throws on a value this version doesn't know (left as it is, not overwritten). */
function decodeSecrets(value: string | null): Secrets {
  if (value === null) return { openaiKey: "", wilmaPassword: "", passwords: {} };
  const parsed = JSON.parse(value) as { v?: unknown; openaiKey?: unknown; wilmaPassword?: unknown; passwords?: unknown };
  if (!parsed || parsed.v !== 1) throw new Error("Not an entry this version of WilmAI Home knows");
  const text = (x: unknown) => (typeof x === "string" ? x : "");
  const passwords = parsed.passwords && typeof parsed.passwords === "object" ? Object.fromEntries(Object.entries(parsed.passwords).filter(([, p]) => typeof p === "string" && p)) : {};
  return { openaiKey: text(parsed.openaiKey), wilmaPassword: text(parsed.wilmaPassword), passwords: passwords as Record<string, string> };
}

/** The entry's secrets with the copies here taken in: a copy wins over the entry's for the same thing. */
function mergeSecrets(entry: Secrets, here: Secrets): Secrets {
  return { openaiKey: here.openaiKey || entry.openaiKey, wilmaPassword: here.wilmaPassword || entry.wilmaPassword, passwords: { ...entry.passwords, ...here.passwords } };
}

/** Put the secrets in the settings in memory, without saving them anywhere. */
function applySecrets(secrets: Secrets) {
  setState((s) => ({ settings: { ...s.settings, ...secrets } }));
}

function setSecretsPlace(place: SecretsPlace) {
  if (state.secrets !== place) setState({ secrets: place });
}

/**
 * Write the secrets to the keychain (the newest of the changes waiting), read them back, and delete the copies here.
 * When the keychain doesn't do it, everything is kept here, marked whole, until a later write or start manages.
 */
function saveToKeychain(secrets: Secrets): Promise<void> {
  pendingSecrets = secrets;
  const keychain = secretsKeychain();
  keychainWrites = keychainWrites.then(async () => {
    const next = pendingSecrets;
    if (!next || !keychain) return;
    pendingSecrets = null;
    const value = encodeSecrets(next);
    try {
      if (value !== keychainValue) {
        keychainValue = undefined;
        if (value === null) await keychain.remove();
        else await keychain.write(value);
        if ((await keychain.read()) !== value) throw new Error("The keychain gave back something else");
        keychainValue = value;
      }
      deleteHere();
      setSecretsPlace("keychain");
    } catch (err) {
      console.warn("WilmAI Home: the keychain didn't keep the secrets; kept in the app's own data for now.", err);
      // The newest secrets, in case another change came meanwhile (it's written after this).
      const kept = pendingSecrets ?? next;
      saveHere(kept);
      if (hasSecrets(kept)) localStorage.setItem(SECRETS_WHOLE, "1");
      setSecretsPlace("app-for-now");
    }
  });
  return keychainWrites;
}

/**
 * Read the keychain at start (desktop app) and move the copies here into it (see above). Features that need a secret
 * wait for this (main.tsx: the sign-ins and the AI start after it). A browser keeps the secrets here.
 */
export function loadSecrets(): Promise<void> {
  secretsLoaded = moveSecrets();
  return secretsLoaded;
}

/** Done once the keychain has been read this start (or couldn't be). */
export const secretsRead = (): Promise<void> => secretsLoaded;

/** The keychain writes done (tests). */
export const secretsWritten = (): Promise<void> => keychainWrites;

async function moveSecrets(): Promise<void> {
  const keychain = secretsKeychain();
  keychainRead = false;
  if (!keychain) return setSecretsPlace("app");
  const generation = resetScope();
  keychainValue = undefined;
  // What the start took from here (loadSettings): the copies, if any.
  applySecrets(keptSecrets(secretsHere(), keepsPassword(state.settings)));
  setSecretsPlace("keychain");
  let raw: string | null;
  let entry: Secrets;
  try {
    if (localStorage.getItem(SECRETS_DELETE)) {
      await keychain.remove();
      localStorage.removeItem(SECRETS_DELETE);
    }
    raw = await keychain.read();
    entry = decodeSecrets(raw);
  } catch (err) {
    console.warn("WilmAI Home: the keychain couldn't be read; the app's own copies stay, and the next start tries again.", err);
    if (generation === resetScope()) setSecretsPlace("app-for-now");
    return;
  }
  if (generation !== resetScope()) return;
  // The copies now, with anything typed while the keychain was being read.
  const here = secretsHere();
  const whole = Boolean(localStorage.getItem(SECRETS_WHOLE));
  const merged = keptSecrets(whole ? here : mergeSecrets(entry, here), keepsPassword(state.settings));
  // From here the settings in memory are the secrets, and every change goes to the keychain (this one first).
  keychainValue = raw;
  keychainRead = true;
  applySecrets(merged);
  await saveToKeychain(merged);
}

/**
 * Reset app: the keychain entry goes. If the keychain doesn't do it now, the next start deletes it before reading
 * anything, and until then new secrets stay here.
 */
async function deleteKeychainEntry(): Promise<void> {
  const keychain = secretsKeychain();
  if (!keychain) return;
  pendingSecrets = null;
  keychainWrites = keychainWrites.then(async () => {
    try {
      keychainValue = undefined;
      await keychain.remove();
      // Known to be empty now: new secrets can go to it.
      keychainValue = null;
      keychainRead = true;
      setSecretsPlace("keychain");
    } catch (err) {
      console.warn("WilmAI Home: the keychain entry couldn't be deleted now; the next start deletes it.", err);
      keychainRead = false;
      localStorage.setItem(SECRETS_DELETE, "1");
      setSecretsPlace("app-for-now");
    }
  });
  await keychainWrites;
}

/**
 * Desktop app: earlier versions kept the Jev key in the system keychain,
 * where macOS asks for the password again after every new build of an app
 * that isn't signed with a Developer ID. Look there once, move the key into
 * the app's own storage, and never look again. Nothing waits for this but
 * Jev: the app shows at once and Jev starts when the key is in.
 */
export async function moveOldJevKey(): Promise<void> {
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
  return Object.fromEntries(
    Object.entries(saved ?? {}).flatMap(([key, s]) => {
      const session = upgradeSession(s);
      return session ? [[key, session]] : [];
    })
  );
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

/** Forget everything this app stored on this device, the keychain entry too. */
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
  await deleteKeychainEntry();
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

/** Count a subject in a child's school hours again, or leave it out (only in this app). */
export function setLeftOut(child: string, subject: string, out: boolean) {
  setState((s) => {
    const leftOut = { ...s.local.leftOut };
    const subjects = (leftOut[child] ?? []).filter((x) => x !== subject);
    if (out) subjects.push(subject);
    if (subjects.length) leftOut[child] = subjects;
    else delete leftOut[child];
    return { local: { ...s.local, leftOut } };
  });
}

/** Whether a subject is PE, as the parent says (null: back to the AI's reading, or the name's). */
/** A subject's record with the parent's word set, or taken back (null) so the AI's reading or the name decides again. */
function withWord<T extends { set?: unknown }>(records: Record<string, T> | undefined, subject: string, value: T["set"] | null): Record<string, T> {
  const out = { ...records };
  const { set: _, ...rest } = out[subject] ?? ({} as T);
  out[subject] = (value === null ? rest : { ...rest, set: value }) as T;
  return out;
}

export function setPE(subject: string, value: boolean | null) {
  setState((s) => ({ local: { ...s.local, pe: withWord(s.local.pe, subject, value) } }));
}

/** Whether the child packs for a subject (the Bring line in Homework), or null to go back to the AI's or the name's. */
export function setBring(subject: string, value: boolean | null) {
  setState((s) => ({ local: { ...s.local, bring: withWord(s.local.bring, subject, value) } }));
}

/** Whether a homework gives the class something to do (by data/homework.ts homeworkKey), or null to go back to the AI's reading or the words. */
export function setHomework(key: string, value: boolean | null) {
  setState((s) => {
    const homework = { ...s.local.homework };
    if (value === null) delete homework[key];
    else homework[key] = value;
    return { local: { ...s.local, homework } };
  });
}

/** What kind a lesson note's type is, shown under in Notes, or null to go back to the AI's or the label's words. */
export function setNoteKind(label: string, kind: Exclude<NoteKind, "explain"> | null) {
  setState((s) => {
    const noteKinds = { ...s.local.noteKinds };
    if (kind === null) delete noteKinds[label];
    else noteKinds[label] = kind;
    return { local: { ...s.local, noteKinds } };
  });
}

/** What a report-card subject is (academic, another subject, behaviour), or null to go back to the AI's or the name's. */
export function setGradeKind(subject: string, value: GradeKind | null) {
  setState((s) => ({ local: { ...s.local, gradeKinds: withWord(s.local.gradeKinds, subject, value) } }));
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
