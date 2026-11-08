/*
 * Where saved Wilma passwords (and authenticator keys) are kept: in the config
 * file, scrambled, as always (the default), or in the operating system's
 * keychain when the user or a program turns that on (`wilma config secrets`,
 * WILMAI_SECRET_STORE). See docs/secret-store.md.
 *
 * One keychain entry per login: service "ai.wilm.wilma-cli", account the
 * login's random `secretId`, value JSON {password, totpSecret}.
 *
 * - macOS: through /usr/bin/security, in a child process with a hard
 *   timeout. Items trust /usr/bin/security only (-T), so any node binary (a
 *   Homebrew upgrade, Claude Desktop's own Node) and WilmAI Home read them
 *   without macOS asking for the Mac password.
 * - Windows and Linux: @napi-rs/keyring, an optional dependency loaded only
 *   when needed (Credential Manager; the Secret Service, never the kernel
 *   keyring, which is empty after a reboot).
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const KEYCHAIN_SERVICE = "ai.wilm.wilma-cli";
export const SECRET_STORE_SETTINGS = ["file", "auto", "keychain"] as const;
export type SecretStoreSetting = (typeof SECRET_STORE_SETTINGS)[number];
export type SecretErrorReason = "missing" | "refused" | "unavailable";

/** How long one keychain call may take (a prompt waiting for a person counts as refused). WILMAI_KEYCHAIN_TIMEOUT_MS is a test hook. */
const CALL_TIMEOUT_MS = Number(process.env.WILMAI_KEYCHAIN_TIMEOUT_MS) || 15_000;
/** The macOS child process is killed after this. */
const SECURITY_TIMEOUT_MS = 10_000;
/** After a refusal, no new read for this long (so several children don't each show a prompt). */
const REFUSED_PAUSE_MS = 60_000;

export interface LoginSecrets {
  password: string;
  totpSecret?: string | null;
}

/** A keychain entry couldn't be read, written or deleted; `reason` says what the user can do. */
export class SecretStoreError extends Error {
  readonly reason: SecretErrorReason;
  constructor(reason: SecretErrorReason, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "SecretStoreError";
    this.reason = reason;
  }
}

/** The message a parent sees for each kind of failure (`wilma` names the Wilma when known). */
export function secretErrorMessage(reason: SecretErrorReason, wilma?: string | null): string {
  switch (reason) {
    case "missing":
      return `The saved password for ${wilma ?? "this Wilma login"} isn't in the keychain any more. Log in again (\`wilma login\`).`;
    case "refused":
      return "The keychain on this computer didn't hand over WilmAI's saved Wilma password. If the computer is locked or asking for a password, unlock it, then try again.";
    case "unavailable":
      return "This login's password is saved in the keychain, which this copy of WilmAI can't open here. Update WilmAI, or log in again to save it where it can.";
  }
}

function storeError(reason: SecretErrorReason, detail?: string, cause?: unknown, wilma?: string | null): SecretStoreError {
  const message = secretErrorMessage(reason, wilma) + (detail ? ` (${detail})` : "");
  return new SecretStoreError(reason, message, cause);
}

/** The setting in effect: WILMAI_SECRET_STORE for this process, else the saved one, else the file. */
export function effectiveSecretStore(saved: string | null | undefined, env: NodeJS.ProcessEnv = process.env): SecretStoreSetting {
  const fromEnv = env.WILMAI_SECRET_STORE?.trim();
  if (fromEnv) {
    if ((SECRET_STORE_SETTINGS as readonly string[]).includes(fromEnv)) return fromEnv as SecretStoreSetting;
    throw new Error(`WILMAI_SECRET_STORE must be file, auto or keychain (it is "${fromEnv}").`);
  }
  return (SECRET_STORE_SETTINGS as readonly string[]).includes(saved ?? "") ? (saved as SecretStoreSetting) : "file";
}

export const newSecretId = (): string => randomBytes(16).toString("hex");
export const newCredentialsStamp = (): string => randomBytes(8).toString("hex");

// ---------------------------------------------------------------------------
// Backends

interface KeychainBackend {
  readonly kind: "macos" | "keyring" | "fake";
  /** null when the keychain can be used here; otherwise why not. */
  check(): Promise<string | null>;
  /** The entry's value, or null when there is none. */
  get(account: string): Promise<string | null>;
  set(account: string, value: string): Promise<void>;
  /** True when an entry was deleted. */
  delete(account: string): Promise<boolean>;
}

const service = () => process.env.WILMAI_KEYCHAIN_SERVICE || KEYCHAIN_SERVICE; // a test hook
/** A test hook: a keychain file to use on macOS instead of the default (login) keychain. */
const keychainFile = (): string[] => (process.env.WILMAI_KEYCHAIN_PATH ? [process.env.WILMAI_KEYCHAIN_PATH] : []);

type Run = { code: number | null; stdout: string; stderr: string; spawnError?: Error; timedOut: boolean };

function runSecurity(args: string[], input = ""): Promise<Run> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (run: Run) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(run);
    };
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = spawn("/usr/bin/security", args, { stdio: ["pipe", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, SECURITY_TIMEOUT_MS);
    child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    child.on("error", (spawnError) => done({ code: null, stdout, stderr, spawnError, timedOut }));
    child.on("close", (code) => done({ code, stdout, stderr, timedOut }));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

/** A failed `security` run as a store error: not runnable = unavailable, anything else = refused. */
function securityFailure(run: Run, what: string): SecretStoreError {
  if (run.spawnError) return storeError("unavailable", `${what}: ${run.spawnError.message}`, run.spawnError);
  if (run.timedOut) return storeError("refused", `${what}: no answer from the keychain in time`);
  const detail = run.stderr.trim().split("\n").pop() || `exit ${run.code}`;
  return storeError("refused", `${what}: ${detail}`);
}

const macosBackend: KeychainBackend = {
  kind: "macos",
  async check() {
    if (process.platform !== "darwin" && !process.env.WILMAI_KEYCHAIN_BACKEND) return "not macOS";
    try {
      await access("/usr/bin/security");
      return null;
    } catch {
      return "/usr/bin/security isn't there";
    }
  },
  async get(account) {
    const run = await runSecurity(["find-generic-password", "-s", service(), "-a", account, "-w", ...keychainFile()]);
    if (run.code === 0) return run.stdout.replace(/\n$/, "");
    if (run.code === 44) return null; // errSecItemNotFound
    throw securityFailure(run, "reading");
  },
  async set(account, value) {
    // Never change an item in place (-U): macOS asks for authorization to change an item's content, a dialog
    // nobody answers in a background run, and the keychain refuses everything else until it's answered.
    // Deleting and adding again asks nothing. (Parent Recap's ADR 0009 does the same.)
    const removed = await runSecurity(["delete-generic-password", "-s", service(), "-a", account, ...keychainFile()]);
    if (removed.code !== 0 && removed.code !== 44) throw securityFailure(removed, "saving");
    // The command goes in on stdin (never on a command line), the value as hex (nothing to quote).
    const hex = Buffer.from(value, "utf8").toString("hex");
    const target = keychainFile().map((path) => ` "${path}"`).join("");
    const command = `add-generic-password -s ${service()} -a ${account} -l "WilmAI saved login" -T /usr/bin/security -X ${hex}${target}\n`;
    const run = await runSecurity(["-i"], command);
    if (run.code !== 0 || /returned -\d+/.test(run.stderr)) throw securityFailure(run, "saving");
  },
  async delete(account) {
    const run = await runSecurity(["delete-generic-password", "-s", service(), "-a", account, ...keychainFile()]);
    if (run.code === 0) return true;
    if (run.code === 44) return false;
    throw securityFailure(run, "deleting");
  },
};

/** The parts of @napi-rs/keyring used here. */
interface KeyringEntry {
  getPassword(): Promise<string | null | undefined>;
  setPassword(password: string): Promise<void>;
  deletePassword(): Promise<boolean>;
}
interface KeyringModule {
  AsyncEntry: new (service: string, account: string, options?: { linux?: { store?: "secret-service" | "keyutils" } }) => KeyringEntry;
}

let keyringModule: Promise<KeyringModule | null> | null = null;
function loadKeyring(): Promise<KeyringModule | null> {
  // A name in a variable: bundlers leave the optional dependency out (it's loaded from node_modules when there).
  const name = "@napi-rs/keyring";
  keyringModule ??= import(name).then(
    (mod) => ((mod as { AsyncEntry?: unknown }).AsyncEntry ? (mod as KeyringModule) : ((mod as { default?: KeyringModule }).default ?? null)),
    () => null
  );
  return keyringModule;
}

async function keyringEntry(account: string): Promise<KeyringEntry> {
  const mod = await loadKeyring();
  if (!mod) throw storeError("unavailable", "this copy of WilmAI was installed without keychain support");
  try {
    // Linux: the Secret Service only. The library would otherwise fall back to the kernel keyring, which forgets everything at a reboot.
    return new mod.AsyncEntry(service(), account, process.platform === "linux" ? { linux: { store: "secret-service" } } : undefined);
  } catch (err) {
    throw storeError("unavailable", err instanceof Error ? err.message : String(err), err);
  }
}

/** Windows sessions without credentials (an SSH key login) and a missing store are "can't be used", the rest refused. */
function keyringFailure(err: unknown, what: string): SecretStoreError {
  if (err instanceof SecretStoreError) return err;
  const message = err instanceof Error ? err.message : String(err);
  // @napi-rs/keyring 2.1 says "Couldn't access platform storage: ..." when there is no store to use (no Secret
  // Service, a Windows session without credentials); "Platform failure: ..." covers refusals and the rest.
  const unusable = /couldn't access platform|platform secure storage|NoStorageAccess|no.such.logon.session|secret service|org\.freedesktop|dbus/i.test(message);
  return storeError(unusable ? "unavailable" : "refused", `${what}: ${message}`, err);
}

const keyringBackend: KeychainBackend = {
  kind: "keyring",
  async check() {
    if (!(await loadKeyring())) return "installed without keychain support";
    if (process.platform === "linux" && !process.env.DBUS_SESSION_BUS_ADDRESS) return "no Secret Service here (no desktop session)";
    try {
      const entry = await keyringEntry(`probe-${process.pid}`);
      await withTimeout(entry.getPassword(), CALL_TIMEOUT_MS, "checking");
      return null;
    } catch (err) {
      return keyringFailure(err, "checking").message;
    }
  },
  async get(account) {
    const entry = await keyringEntry(account);
    try {
      return (await entry.getPassword()) ?? null;
    } catch (err) {
      throw keyringFailure(err, "reading");
    }
  },
  async set(account, value) {
    const entry = await keyringEntry(account);
    try {
      await entry.setPassword(value);
    } catch (err) {
      throw keyringFailure(err, "saving");
    }
  },
  async delete(account) {
    const entry = await keyringEntry(account);
    try {
      return await entry.deletePassword();
    } catch (err) {
      const failure = keyringFailure(err, "deleting");
      if (/no (matching )?entry|not found/i.test(failure.message)) return false;
      throw failure;
    }
  },
};

/**
 * For tests: a keychain in a JSON file shared by processes,
 * WILMAI_KEYCHAIN_BACKEND=fake:/path. `{"entries": {...}}`, plus `"check"`
 * (why it can't be used), `"fail": {"get"|"set"|"delete": reason}` and
 * `"hangMs"` to simulate a prompt nobody answers.
 */
function fakeBackend(path: string): KeychainBackend {
  type Fake = { entries?: Record<string, string>; check?: string | null; fail?: Record<string, SecretErrorReason>; hangMs?: number };
  const load = async (): Promise<Fake> => {
    try {
      return JSON.parse(await readFile(path, "utf8")) as Fake;
    } catch {
      return {};
    }
  };
  const save = async (fake: Fake) => {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, JSON.stringify(fake, null, 2));
    await rename(tmp, path);
  };
  const maybeFail = async (fake: Fake, op: string) => {
    if (fake.hangMs) await new Promise((r) => setTimeout(r, fake.hangMs));
    const reason = fake.fail?.[op];
    if (reason) throw storeError(reason, `fake ${op}`);
  };
  return {
    kind: "fake",
    async check() {
      return (await load()).check ?? null;
    },
    async get(account) {
      const fake = await load();
      await maybeFail(fake, "get");
      return fake.entries?.[account] ?? null;
    },
    async set(account, value) {
      const fake = await load();
      await maybeFail(fake, "set");
      await save({ ...fake, entries: { ...fake.entries, [account]: value } });
    },
    async delete(account) {
      const fake = await load();
      await maybeFail(fake, "delete");
      if (!fake.entries || !(account in fake.entries)) return false;
      delete fake.entries[account];
      await save(fake);
      return true;
    },
  };
}

function backend(): KeychainBackend {
  const forced = process.env.WILMAI_KEYCHAIN_BACKEND; // a test hook
  if (forced?.startsWith("fake:")) return fakeBackend(forced.slice(5));
  if (forced === "keyring") return keyringBackend;
  if (forced === "macos") return macosBackend;
  return process.platform === "darwin" ? macosBackend : keyringBackend;
}

/**
 * Keychain calls that timed out but are still running. A native call can't be
 * cancelled (Windows, Linux) and keeps the process alive, so a CLI command
 * exits by itself once its output is written (abandonedKeychainCalls).
 */
let abandonedCalls = 0;

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      abandonedCalls += 1;
      reject(storeError("refused", `${what}: no answer from the keychain in time`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        if (timedOut) abandonedCalls -= 1;
        else resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        if (timedOut) abandonedCalls -= 1;
        else reject(err);
      }
    );
  });
}

// ---------------------------------------------------------------------------
// Using it

let checked: Promise<string | null> | null = null;
/** null when the keychain can be used here (checked once per process); otherwise why not. */
export function keychainProblem(): Promise<string | null> {
  checked ??= backend()
    .check()
    .catch((err) => (err instanceof Error ? err.message : String(err)));
  return checked;
}

/** Which keychain this process would use, for `wilma config secrets`. */
export function keychainKind(): string {
  const kind = backend().kind;
  if (kind === "macos") return "macOS Keychain";
  if (kind === "fake") return "test keychain";
  return process.platform === "win32" ? "Windows Credential Manager" : process.platform === "darwin" ? "macOS Keychain" : "Secret Service";
}

/** JSON with everything past ASCII escaped, so every keychain hands it back unchanged. */
function encode(secrets: LoginSecrets): string {
  return JSON.stringify({ password: secrets.password, totpSecret: secrets.totpSecret ?? null }).replace(
    /[\u007f-￿]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

function decode(raw: string, wilma?: string | null): LoginSecrets {
  try {
    const parsed = JSON.parse(raw) as { password?: unknown; totpSecret?: unknown };
    if (typeof parsed.password === "string" && parsed.password) {
      return { password: parsed.password, totpSecret: typeof parsed.totpSecret === "string" && parsed.totpSecret ? parsed.totpSecret : null };
    }
  } catch {
    // fall through
  }
  return storeErrorThrow("missing", "the keychain entry is damaged", wilma);
}

function storeErrorThrow(reason: SecretErrorReason, detail: string, wilma?: string | null): never {
  throw storeError(reason, detail, undefined, wilma);
}

/**
 * Per process, per entry and credentials stamp: what reading it gave.
 * Machine 2 in docs/secret-store.md: a value is kept; "missing" and
 * "unavailable" stay until the stamp changes; after "refused" no new read for
 * a minute; a call that timed out but may still answer ("abandoned") starts
 * no new read, and a late value is kept.
 */
type ReadState = {
  pending?: Promise<LoginSecrets>;
  value?: LoginSecrets;
  error?: SecretStoreError;
  retryAt?: number;
  abandoned?: boolean;
};
const reads = new Map<string, ReadState>();

export interface SecretRef {
  secretId: string;
  credentialsStamp?: string | null;
  /** The Wilma's name, for messages. */
  wilma?: string | null;
}

/** A login's password and authenticator key from the keychain: read once per process, only when needed. */
export function readLoginSecrets(ref: SecretRef): Promise<LoginSecrets> {
  const key = `${ref.secretId}|${ref.credentialsStamp ?? ""}`;
  let state = reads.get(key);
  if (!state) {
    state = {};
    reads.set(key, state);
  }
  if (state.value) return Promise.resolve(state.value);
  if (state.pending) return state.pending;
  if (state.abandoned) return Promise.reject(storeError("refused", "still waiting for the keychain to answer an earlier request"));
  if (state.error && (state.error.reason !== "refused" || Date.now() < (state.retryAt ?? 0))) return Promise.reject(state.error);
  const s = state;
  s.error = undefined;
  const settle = (outcome: { value: LoginSecrets } | { error: SecretStoreError }) => {
    if ("value" in outcome) s.value = outcome.value;
    else {
      s.error = outcome.error;
      s.retryAt = Date.now() + REFUSED_PAUSE_MS;
    }
  };
  const call = (async () => {
    let raw = await backend().get(ref.secretId);
    if (raw === null) {
      // Saving deletes the entry and adds it again (macOS): a read in between finds nothing for a moment
      // (two short `security` runs). Well inside the call's own timeout.
      await new Promise((r) => setTimeout(r, Math.min(150, CALL_TIMEOUT_MS / 4)));
      raw = await backend().get(ref.secretId);
    }
    if (raw === null) storeErrorThrow("missing", "no keychain entry", ref.wilma);
    return decode(raw, ref.wilma);
  })();
  s.pending = new Promise<LoginSecrets>((resolve, reject) => {
    let answered = false;
    const timer = setTimeout(() => {
      if (answered) return;
      answered = true;
      // The call can't be cancelled (Windows, Linux): wait for it, start no new one, keep a late value.
      s.pending = undefined;
      s.abandoned = true;
      abandonedCalls += 1;
      reject(storeError("refused", "no answer from the keychain in time"));
    }, CALL_TIMEOUT_MS);
    const late = () => {
      s.abandoned = false;
      abandonedCalls -= 1;
    };
    call.then(
      (value) => {
        settle({ value });
        if (answered) late();
        else {
          answered = true;
          clearTimeout(timer);
          s.pending = undefined;
          resolve(value);
        }
      },
      (err) => {
        const error = keyringFailure(err, "reading");
        settle({ error });
        if (answered) late();
        else {
          answered = true;
          clearTimeout(timer);
          s.pending = undefined;
          reject(error);
        }
      }
    );
  });
  return s.pending;
}

/** Save a login's secrets in its keychain entry (replacing what was there). */
export async function writeLoginSecrets(secretId: string, secrets: LoginSecrets): Promise<void> {
  try {
    await withTimeout(backend().set(secretId, encode(secrets)), CALL_TIMEOUT_MS, "saving");
  } catch (err) {
    throw keyringFailure(err, "saving");
  }
  forgetReads(secretId);
}

/** Forget what was read from an entry, except reads still waiting (they must stay counted). */
function forgetReads(secretId: string): void {
  for (const [key, state] of [...reads]) if (key.startsWith(`${secretId}|`) && !state.pending && !state.abandoned) reads.delete(key);
}

/**
 * Read an entry straight from the keychain (no per-process memory), e.g. to
 * check what was just written. A Windows read right after a write on another
 * thread can briefly miss, so a miss is tried once more.
 */
export async function readBackLoginSecrets(secretId: string): Promise<LoginSecrets | null> {
  for (let attempt = 0; ; attempt++) {
    const raw = await withTimeout(backend().get(secretId), CALL_TIMEOUT_MS, "reading").catch((err) => {
      throw keyringFailure(err, "reading");
    });
    if (raw !== null) return decode(raw);
    if (attempt >= 1) return null;
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** Delete a login's keychain entry; true when there was one. */
export async function deleteLoginSecrets(secretId: string): Promise<boolean> {
  forgetReads(secretId);
  try {
    return await withTimeout(backend().delete(secretId), CALL_TIMEOUT_MS, "deleting");
  } catch (err) {
    throw keyringFailure(err, "deleting");
  }
}

/** Whether a keychain call timed out and may still be running (the process should then exit when done). */
export function abandonedKeychainCalls(): boolean {
  return abandonedCalls > 0;
}

/** For tests in one process: forget what was read. */
export function forgetSecretReads(): void {
  reads.clear();
  checked = null;
}
