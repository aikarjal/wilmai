/*
 * The Wilma page (data/logins.ts): everything about signing in, on one page. It shows whenever not every Wilma of the
 * family is signed in (at first, after signing out, when Wilma ends a session), and from the app (#/wilmas).
 *
 * - Who uses the app: a parent (any number of schools' Wilmas, the children to show) or a student (one Wilma).
 * - The Wilmas: one signed in shows its children to tick and Sign out; one signed out is a login again (its school,
 *   the username to change, the password remembered or to type, the code when Wilma asks); new ones to fill in. Each
 *   can be removed.
 * - One Sign in for everything; when every Wilma is in, the app opens (new Wilmas stay here, to show their children).
 * - Its settings, sliding in over the panel's form (PageSettings): the app's language, what the app does when Wilma
 *   signs it out, deleting this family's data from this computer, and resetting the app.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { accountKey, forgetPasswordsIfAsked, getState, passwordOf, setViewAs, updateSettings, useApp } from "../data/store";
import { SignInAgainError, addWilma, changeLogin, type Attempt, forgetThisFamily, loginKept, removeWilma, resetApp, setChildShown, signInAll, signInDemo, signInWithPassword, signOutWilma } from "../data/engine";
import { SignInCancelledError } from "../data/sign-in-attempt";
import { logins, sameWilma, schoolOf } from "../data/logins";
import { viewerOf, type Login, type Viewer } from "../data/model";
import { TENANTS, type Tenant } from "../data/tenants";
import { Intro, SchoolPicker, lastUsername, rememberUsername } from "./SignIn";
import { UpdatesCard } from "./Update";
import { LanguageChoice, ThemeChoice } from "./Settings";
import { Icon } from "./bits";
import { go } from "./shared";
import { isDesktopApp } from "../wilma/transport";
import { t } from "../i18n";
import { runJev } from "../jev/runner";
import { runLuna } from "../luna/events";

/** A Wilma being added: its school, username and password, until it's signed in. */
interface Draft {
  id: number;
  tenant: Tenant | null;
  username: string;
  password: string;
}

/** Another login typed for a signed-out Wilma (Change user): its school and username; the password is with the typed ones. */
interface Change {
  tenant: Tenant | null;
  username: string;
}

/** What a row still needs to sign in, or why it didn't. */
type Ask = { mfa: (code: string) => Promise<void> } | { password: true } | { error: string };

let drafts = 0;
const newDraft = (): Draft => ({ id: (drafts += 1), tenant: null, username: "", password: "" });
const complete = (d: Draft) => Boolean(d.tenant && d.username.trim() && d.password);

export function Wilmas() {
  const snap = useApp((s) => s.snapshot);
  const status = useApp((s) => s.loginStatus);
  const local = useApp((s) => s.local);
  useApp((s) => s.settings); // remembered passwords show as they change
  // The sample family's Wilmas show as signed in, to look at: nothing here signs in or out of them.
  const demo = snap?.account.via === "demo";
  const family = snap && !demo ? snap : null;
  const all = family ? logins(family) : demo ? logins(snap!) : [];
  const [chosen, setChosen] = useState<Viewer>("guardian");
  const who: Viewer = family ? viewerOf(family.account, local) : chosen;
  const [news, setNews] = useState<Draft[]>(() => (family || demo ? [] : [newDraft()]));
  const [typed, setTyped] = useState<Record<number, string>>({});
  const [changes, setChanges] = useState<Record<number, Change>>({});
  const [asks, setAsks] = useState<Record<string, Ask>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const settings = useApp((s) => s.settings);
  const out = demo ? [] : all.filter((l) => !status[l.slot]?.live);
  const ready = news.filter(complete);
  const open = (Boolean(family) || demo) && !out.length && !ready.length;
  // A first setup (or a family forgotten here) starts with one Wilma to fill in, and the recommended choice unless one
  // was made before.
  useEffect(() => {
    if (family || demo) return;
    setNews((list) => (list.length ? list : [newDraft()]));
    if (getState().settings.staySignedIn === undefined) updateSettings({ staySignedIn: true, rememberPassword: true });
  }, [family]);
  // Another family on the page (signed in as another account): nothing typed for the one before stays.
  const familyKey = family ? accountKey(family.account) : null;
  useEffect(() => {
    setTyped({});
    setChanges({});
  }, [familyKey]);
  const setChange = (slot: number, change: Change | null) =>
    setChanges((x) => {
      const { [slot]: _, ...rest } = x;
      return change ? { ...rest, [slot]: change } : rest;
    });
  const dropDraft = (id: number) => setNews((list) => list.filter((d) => d.id !== id));
  const setDraft = (id: number, patch: Partial<Draft>) => setNews((list) => list.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const setAsk = (key: string, ask: Ask | null) =>
    setAsks((x) => {
      const next = { ...x };
      if (ask) next[key] = ask;
      else delete next[key];
      return next;
    });

  const choose = (next: Viewer) => {
    setNote(null);
    if (next === "student" && all.length + news.length > 1) return setNote(t("A student has one Wilma. Remove the others first."));
    if (!family) return setChosen(next);
    if (next === who) return;
    setViewAs(next === family.account.wilmaRole ? null : next);
    // The AI reads for whoever reads the app: its answers for the other one aren't used.
    void runJev();
    void runLuna();
  };

  /** Everything not signed in, at once: new Wilmas first (the first one starts the family), then the family's. */
  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    if (open) return go("today");
    setNote(null);
    if (!family && !ready.length) return setNote(t("Choose the school's Wilma, and type the username and password."));
    setBusy(true);
    const asked: Record<string, Ask> = {};
    const done = new Set<number>();
    /** One new Wilma: in (true), or what it needs on its row. */
    const attempt = async (d: Draft, sign: () => Promise<{ mfa: (code: string) => Promise<void> } | null>) => {
      try {
        const next = await sign();
        rememberUsername(d.tenant!.url, d.username.trim());
        if (!next) return done.add(d.id), true;
        asked[`d${d.id}`] = { mfa: async (code) => (await next.mfa(code), dropDraft(d.id)) };
      } catch (err) {
        // Cancelled (the sample family picked meanwhile, say): nothing to show.
        if (!(err instanceof SignInCancelledError)) asked[`d${d.id}`] = { error: err instanceof Error ? err.message : String(err) };
      }
      return false;
    };
    try {
      // New Wilmas: the page stays afterwards, to show the children they list.
      if (ready.length) go("wilmas");
      const pending = [...ready];
      if (!family) {
        const first = pending.shift()!;
        if (!(await attempt(first, () => signInWithPassword(first.tenant!.url, first.username.trim(), first.password, undefined, false, who)))) return;
      }
      for (const d of pending) await attempt(d, () => addWilma(d.tenant!.url, d.username.trim(), d.password));
      // Signed-out Wilmas changed to another login (another account's family, when it's the only one).
      const changed = Object.entries(changes)
        .map(([slot, c]) => [Number(slot), c] as const)
        .filter(([slot]) => all.some((l) => l.slot === slot && !status[slot]?.live));
      const results: Record<number, Attempt> = {};
      for (const [slot, c] of changed) {
        if (!c.tenant || !c.username.trim()) {
          asked[`s${slot}`] = { error: t("Choose the school's Wilma, and type the username and password.") };
          continue;
        }
        const r = await changeLogin(slot, c.tenant.url, c.username.trim(), typed[slot] ?? "", who);
        results[slot] = r;
        if ("ok" in r) rememberUsername(c.tenant.url, c.username.trim());
        if ("mfa" in r) asked[`s${slot}`] = { mfa: async (code) => (await r.mfa(code), setChange(slot, null)) };
        else if (!("ok" in r) && !("cancelled" in r)) asked[`s${slot}`] = r;
      }
      Object.assign(results, await signInAll(typed, changed.map(([slot]) => slot)));
      for (const [slot, r] of Object.entries(results)) if (!("ok" in r) && !("cancelled" in r) && !asked[`s${slot}`]) asked[`s${slot}`] = r;
      // What's typed stays on a Wilma that isn't in yet, except a password Wilma refused.
      const keep = <T,>(typedIn: Record<number, T>, drop: (r: Attempt) => boolean) =>
        Object.fromEntries(Object.entries(typedIn).filter(([slot]) => !results[Number(slot)] || !drop(results[Number(slot)])));
      setTyped((x) => keep(x, (r) => "ok" in r || "password" in r));
      setChanges((x) => keep(x, (r) => "ok" in r));
    } finally {
      setNews((list) => list.filter((d) => !done.has(d.id)));
      setAsks(asked);
      setBusy(false);
    }
  };

  return (
    <div className="signin wilmas">
      <Intro />
      <section className="signin-panel" aria-labelledby={menu ? "drawer-h" : "wilmas-h"}>
        <div className="wilmas-body">
          {menu ? <PageSettings family={Boolean(family)} onClose={() => setMenu(false)} /> : null}
          {isDesktopApp && !family && !menu ? <UpdatesCard compact /> : null}
          <form className="wilma-page" onSubmit={(e) => void signIn(e)} hidden={menu}>
            <h2 id="wilmas-h">{t("Sign in with Wilma")}</h2>

            <div className="field" style={{ marginBottom: 0 }}>
              <span className="label" id="who-label">{t("Who uses WilmAI Home")}</span>
              <div className="who-choice" role="group" aria-labelledby="who-label">
                {(["guardian", "student"] as const).map((v) => (
                  <button type="button" key={v} className="seg" aria-pressed={who === v} onClick={() => choose(v)}>
                    {v === "guardian" ? t("A parent") : t("A student")}
                  </button>
                ))}
              </div>
              <span className="help">{who === "guardian" ? t("All your children, from every school's Wilma.") : t("Your own tasks, exams and homework, from your Wilma.")}</span>
            </div>

            <div className="wilma-list">
              {all.map((login) => (
                <WilmaRow
                  key={login.slot}
                  login={login}
                  demo={demo}
                  many={all.length > 1}
                  kids={who === "guardian"}
                  ask={asks[`s${login.slot}`]}
                  typed={typed[login.slot] ?? ""}
                  onType={(value) => setTyped((x) => ({ ...x, [login.slot]: value }))}
                  change={changes[login.slot]}
                  onChange={(change) => setChange(login.slot, change)}
                  taken={(url) => all.some((l) => l.slot !== login.slot && sameWilma(l.account.baseUrl, url)) || news.some((x) => Boolean(x.tenant) && sameWilma(x.tenant!.url, url))}
                  onAsk={(ask) => setAsk(`s${login.slot}`, ask)}
                />
              ))}
              {news.map((d, i) => (
                <DraftRow
                  key={d.id}
                  draft={d}
                  taken={(url) => all.some((l) => sameWilma(l.account.baseUrl, url)) || news.some((x) => x.id !== d.id && Boolean(x.tenant) && sameWilma(x.tenant!.url, url))}
                  label={!family && i === 0 ? t("Your school's Wilma") : t("The other school's Wilma")}
                  ask={asks[`d${d.id}`]}
                  onChange={(patch) => setDraft(d.id, patch)}
                  onRemove={family || news.length > 1 ? () => dropDraft(d.id) : undefined}
                  onAsk={(ask) => setAsk(`d${d.id}`, ask)}
                />
              ))}
            </div>
            {note ? <div className="notice err">{note}</div> : null}
            <button className="btn btn-primary wilmas-go" type="submit" disabled={busy}>
              {busy ? t("Signing in…") : open ? t("Open WilmAI Home") : t("Sign in")}
            </button>
            <p className="help-line wilma-signing">
              {settings.staySignedIn
                ? t("The app stays signed in automatically.")
                : settings.rememberPassword !== false
                  ? t("Signing in again takes one click.")
                  : t("Passwords aren't kept: the app asks for them each time.")}{" "}
              <button type="button" className="linkish" onClick={() => setMenu(true)}>
                {t("Change this")}
              </button>
            </p>

            {who === "guardian" ? (
              <div className="add-wilma">
                <button type="button" className="btn btn-sm" onClick={() => setNews((list) => [...list, newDraft()])}>
                  {t("Add another school's Wilma")}
                </button>
                <span className="help">{t("For a child at a school with its own Wilma: another town, an upper secondary school, a private school.")}</span>
              </div>
            ) : null}
          </form>

          {menu ? null : (
            <div className="wilmas-foot">
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setMenu(true)}>
                <Icon name="settings" />
                <span>{t("Settings")}</span>
              </button>
              {family ? null : (
                <button type="button" className="linkish" onClick={() => { go("today"); void signInDemo(); }}>
                  {t("Look around with a sample family")}
                </button>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * The Wilma page's settings, in the panel in place of the form: the app's language, what the app does when Wilma signs
 * it out, deleting this family's data from this computer, and resetting the app (every family, the keys and the
 * settings).
 */
function PageSettings({ family, onClose }: { family: boolean; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  // Ask for the password each time, as the settings close: the kept passwords go then (not at the click, so trying
  // the choices on the way to another one doesn't lose them).
  useEffect(() => () => forgetPasswordsIfAsked(), []);
  return (
    <div className="drawer">
      <div className="drawer-head">
        <button type="button" className="btn btn-quiet btn-sm" onClick={onClose} autoFocus>
          <Icon name="back" />
          <span>{t("Back to signing in")}</span>
        </button>
        <h2 id="drawer-h">{t("Sign-in settings")}</h2>
      </div>
      <section>
        <h3>{t("App language")}</h3>
        <LanguageChoice />
      </section>
      <section>
        <h3>{t("Theme")}</h3>
        <ThemeChoice />
      </section>
      <section>
        <h3>{t("Staying signed in")}</h3>
        <SigningIn />
      </section>
      {/* The choices count as they're made: Done goes back. */}
      <button type="button" className="btn btn-primary wilmas-go" onClick={onClose}>
        {t("All set")}
      </button>
      <section className="drawer-danger">
        <h3>{t("Deleting data from this computer")}</h3>
        {family ? (
          <div className="drawer-danger-item">
            <p className="help-line">{t("Deletes this family's children, messages, AI answers and passwords from this computer. Wilma itself keeps everything, and signing in again reads it back.")}</p>
            <Confirm button label={t("Delete this family's data")} question={t("Delete this family's data from this computer?")} onYes={() => void forgetThisFamily().then(onClose)} />
          </div>
        ) : null}
        <div className="drawer-danger-item">
          <p className="help-line">{t("Signs out of Wilma and permanently deletes all accounts' messages, AI answers, drafts, settings, usage history and API keys saved by this app on this computer.")}</p>
          <ResetApp onDone={onClose} />
        </div>
      </section>
    </div>
  );
}

/** Resetting the app, after saying it can't be undone. */
function ResetApp({ onDone }: { onDone: () => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="drawer-reset">
      {asking ? (
        <div className="settings-reset-confirm">
          <p>{t("This can't be undone. Afterwards you sign in and choose your AI from the start, and your messages are read again.")}</p>
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await resetApp();
                go("today");
                onDone();
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
                setBusy(false);
              }
            }}
          >
            {busy ? t("Resetting…") : t("Delete all data and reset")}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => setAsking(false)}>
            {t("Cancel")}
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-sm" onClick={() => setAsking(true)}>
          {t("Reset app")}
        </button>
      )}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}

/**
 * One of the family's Wilmas. Signed in: its school and username, its children to tick, Sign out. Signed out: a login
 * form filled in with its school, username and (dots for) the password when it's kept, as a browser fills one, so Sign
 * in is all it takes; any of them can be changed (another user or school, `changeLogin`). No children until it's in.
 */
function WilmaRow({ login, demo, many, kids, ask, typed, onType, change, onChange, taken, onAsk }: { login: Login; demo: boolean; many: boolean; kids: boolean; ask: Ask | undefined; typed: string; onType: (value: string) => void; change: Change | undefined; onChange: (change: Change | null) => void; taken: (url: string) => boolean; onAsk: (ask: Ask | null) => void }) {
  const snap = useApp((s) => s.snapshot)!;
  const status = useApp((s) => s.loginStatus[login.slot]);
  // The sample family's are signed in, to look at (no Sign out, Remove or unticking).
  const live = demo || Boolean(status?.live);
  const school = schoolOf(login.account);
  const students = login.students ?? [];
  const hidden = new Set(login.hidden ?? []);
  const twice = students.filter((s, i) => students.findIndex((x) => x.name === s.name) !== i).map((s) => s.name.split(" ")[0]);
  const remove = many && !demo ? (
    <Confirm
      label={t("Remove from the app")}
      question={t("Remove {school} from the app? Its children and what was read from it leave the app, and its Wilma session ends.", { school })}
      onYes={() => void removeWilma(login.slot)}
    />
  ) : null;
  if (!live) {
    const tenant = change ? change.tenant : tenantOf(login.account);
    const username = change ? change.username : login.account.username;
    // The same login as before, with its password kept: dots in the password field.
    const same = Boolean(tenant && sameWilma(tenant.url, login.account.baseUrl)) && username.trim().toLowerCase() === login.account.username.toLowerCase();
    // Why it isn't in, when Wilma (not the parent) ended it or signing in again didn't work.
    const why = !login.signedOut && status?.why && (status.failed || status.rejoinAt !== undefined) ? status.why : null;
    return (
      <DraftRow
        draft={{ id: -1 - login.slot, tenant, username, password: typed }}
        kept={same && loginKept(login.account) && !(ask && "password" in ask)}
        taken={taken}
        label={t("Your school's Wilma")}
        ask={ask}
        notice={why}
        onChange={(patch) => {
          if (patch.password !== undefined) onType(patch.password);
          const { password: _, ...rest } = patch;
          if (Object.keys(rest).length) onChange({ tenant, username, ...rest });
        }}
        onAsk={onAsk}
        footer={remove}
      />
    );
  }
  return (
    <div className="wilma-row">
      <div className="wilma-head">
        <Icon name="book" />
        <div>
          <b>{school}</b>
          <small>
            {login.account.username} · <span className="wilma-on">{t("Signed in")}</span>
          </small>
        </div>
        {demo ? null : (
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => void signOutWilma(login.slot)}>
            {t("Sign out")}
          </button>
        )}
      </div>
      {kids && students.length ? (
        <div className="wilma-kids" role="group" aria-label={t("Children to show from {school}", { school })}>
          {students.map((s) => {
            const cls = snap.perChild[s.number]?.className?.value;
            return (
              <label key={s.number} className="remember">
                <input type="checkbox" checked={!hidden.has(s.number)} disabled={demo} onChange={(e) => setChildShown(s.number, e.target.checked)} />
                <span>{cls ? `${s.name} · ${cls}` : s.name}</span>
              </label>
            );
          })}
          {twice.length ? <p className="help-line">{t("Wilma lists {name} twice: a new school gives a new profile. Untick the one you don't need.", { name: twice[0] })}</p> : null}
        </div>
      ) : null}
      {remove}
    </div>
  );
}

/** Wilma's two-step code for one row, typed and checked there. */
function CodeField({ id, onCode }: { id: string; onCode: (code: string) => Promise<void> }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="wilma-ask">
      <label htmlFor={id}>{t("Code from your authenticator app")}</label>
      <div className="ai-key">
        <input id={id} className="input" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" autoFocus />
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={!code || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onCode(code.trim());
            } finally {
              setBusy(false);
              setCode("");
            }
          }}
        >
          {t("Check the code")}
        </button>
      </div>
    </div>
  );
}

/** A Wilma being added: the school, a username and password, and a code when Wilma asks. */
function DraftRow({ draft, kept = false, taken, label, ask, notice, onChange, onRemove, onAsk, footer }: { draft: Draft; kept?: boolean; taken: (url: string) => boolean; label: string; ask: Ask | undefined; notice?: string | null; onChange: (patch: Partial<Draft>) => void; onRemove?: () => void; onAsk: (ask: Ask | null) => void; footer?: ReactNode }) {
  const host = draft.tenant ? new URL(draft.tenant.url).host : null;
  const mfa = ask && "mfa" in ask ? ask.mfa : null;
  // A kept password shows as dots until it's typed over (focus selects them, so typing replaces them).
  const [edited, setEdited] = useState(false);
  const dots = kept && !edited && !draft.password;
  return (
    <div className="wilma-row wilma-new">
      {onRemove ? (
        <button type="button" className="btn btn-quiet btn-sm wilma-cancel" onClick={onRemove}>
          {t("Cancel")}
        </button>
      ) : null}
      <SchoolPicker
        tenant={draft.tenant}
        onPick={(tenant) => {
          if (taken(tenant.url)) return onAsk({ error: t("This Wilma is in the app already.") });
          onAsk(null);
          onChange({ tenant, username: draft.username || lastUsername(tenant.url) });
        }}
        onChange={() => onChange({ tenant: null })}
        locked={Boolean(mfa)}
        label={label}
        id={`school-${draft.id}`}
      />
      {!mfa ? (
        <div className="wilma-fields">
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor={`user-${draft.id}`}>{t("Username")}</label>
            <input id={`user-${draft.id}`} className="input" value={draft.username} onChange={(e) => onChange({ username: e.target.value })} autoComplete="username" />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor={`pass-new-${draft.id}`}>{t("Password")}</label>
            <input
              id={`pass-new-${draft.id}`}
              className="input"
              type="password"
              value={dots ? KEPT : draft.password}
              onFocus={(e) => dots && e.target.select()}
              onChange={(e) => {
                setEdited(true);
                const value = e.target.value;
                onChange({ password: !dots ? value : value.startsWith(KEPT) ? value.slice(KEPT.length) : KEPT.startsWith(value) ? "" : value });
              }}
              autoComplete="current-password"
            />
            <span className="help">{host ? t("Sent only to {host}.", { host }) : t("Sent only to your school's Wilma.")}</span>
          </div>
        </div>
      ) : null}
      {mfa ? (
        <CodeField
          id={`code-new-${draft.id}`}
          onCode={async (code) => {
            try {
              await mfa(code);
              onAsk(null);
            } catch (err) {
              onAsk(err instanceof SignInAgainError || err instanceof SignInCancelledError ? null : { error: err instanceof Error ? err.message : String(err) });
            }
          }}
        />
      ) : null}
      {notice && !ask ? <div className="notice">{notice}</div> : null}
      {ask && "error" in ask ? <div className="notice err">{ask.error}</div> : null}
      {ask && "password" in ask ? <div className="notice err">{t("Type the password for this Wilma.")}</div> : null}
      {footer}
    </div>
  );
}

/** What a kept password shows as: dots of a fixed length, never the password itself. */
const KEPT = "\u2022".repeat(10);

/** A login's school as the list of Wilmas has it (or by its address, if it isn't listed). */
const tenantOf = (account: Login["account"]): Tenant => TENANTS.find((x) => sameWilma(x.url, account.baseUrl)) ?? { url: account.baseUrl, name: schoolOf(account), municipalities: [] };

/** A quiet link (or a button) that asks before doing something that can't be undone here. */
function Confirm({ label, question, onYes, button = false }: { label: string; question: string; onYes: () => void; button?: boolean }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className={button ? "btn btn-sm" : "linkish wilma-remove"} onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }
  return (
    <div className="notice err login-remove">
      <span>{question}</span>
      <button type="button" className="btn btn-sm btn-danger" onClick={onYes}>
        {label}
      </button>
      <button type="button" className="btn btn-sm btn-quiet" onClick={() => setAsking(false)}>
        {t("Cancel")}
      </button>
    </div>
  );
}

type Signing = "stay" | "click" | "type";

/**
 * What the app does when Wilma signs it out, one choice (here and in Settings): keep the app signed in (the passwords
 * kept), ask and sign in with one click (the passwords kept), or ask for the password each time (nothing kept).
 */
export function SigningIn() {
  const settings = useApp((s) => s.settings);
  const snap = useApp((s) => s.snapshot);
  const failed = useApp((s) => Object.values(s.loginStatus).find((x) => x.failed)?.failed ?? null);
  const value: Signing = settings.staySignedIn ? "stay" : settings.rememberPassword !== false ? "click" : "type";
  const choose = (v: Signing) =>
    updateSettings(
      v === "stay" ? { staySignedIn: true, rememberPassword: true } : v === "click" ? { staySignedIn: false, rememberPassword: true } : { staySignedIn: false, rememberPassword: false }
    );
  const missing = value !== "type" && snap && snap.account.via !== "demo" ? logins(snap).filter((l) => l.account.via === "password" && !passwordOf(l.account)).map((l) => schoolOf(l.account)) : [];
  const options: { id: Signing; title: ReactNode; help: string }[] = [
    {
      id: "stay",
      title: (
        <>
          {t("Keep the app signed in")} <span className="translator-badge">{t("Recommended")}</span>
        </>
      ),
      help: t("The app keeps working and notifications keep coming. If Wilma keeps signing it out, it waits half an hour or more before trying again, so it doesn't race you."),
    },
    { id: "click", title: t("Ask me, and sign in with one click"), help: t("The app waits until you sign in again.") },
    { id: "type", title: t("Ask me for the password each time"), help: t("Nothing is kept on this computer. Choose this on a shared computer.") },
  ];
  return (
    <div className="signing-in" role="radiogroup" aria-label={t("Staying signed in")}>
      {options.map((o) => (
        <label key={o.id} className="switch">
          <input type="radio" name="signing-in" checked={value === o.id} onChange={() => choose(o.id)} />
          <div>
            <b>{o.title}</b>
            {value === o.id ? <span>{o.help}</span> : null}
          </div>
        </label>
      ))}
      <p className="help-line">{value === "type" ? t("Passwords go only to each school's Wilma.") : t("Passwords are kept on this computer, scrambled but not encrypted.")}</p>
      {missing.length ? (
        <p className="help-line">
          {t(missing.length === 1 ? "The password for {schools} is kept from the next time you sign in." : "The passwords for {schools} are kept from the next time you sign in.", { schools: missing.join(", ") })}
        </p>
      ) : null}
      {value === "stay" && failed ? <div className="notice err">{t("Signing in again didn't work: {why} Sign in once yourself to start again.", { why: failed })}</div> : null}
    </div>
  );
}
