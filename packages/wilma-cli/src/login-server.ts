import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { AuthenticationError } from "@wilm-ai/wilma-client";
import { getConfigPath, loadConfig, type StoredProfile } from "./config.js";
import { adoptSession } from "./agent-data.js";
import { saveLogin, TotpSecretInvalidError, TotpSecretRequiredError, verifyLoginSession } from "./credentials.js";
import { normalizeTenantUrl, searchTenants } from "./tenant-search.js";

export interface LoginServer {
  url: string;
  /** Resolves with the first saved login, or null if the page closed without one. */
  result: Promise<StoredProfile | null>;
  /** Resolves with every login saved on this page once it closes (Done, idle timeout, or close()). */
  closed: Promise<StoredProfile[]>;
  close(): void;
}

const MAX_ATTEMPTS = 10;
const MAX_BODY_BYTES = 16 * 1024;
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

/** The children per connected Wilma, for the page's "You're connected" list. */
function accountsSummary(profiles: StoredProfile[]) {
  return profiles.map((p) => ({
    wilma: p.tenantName ?? p.tenantUrl,
    students: (p.students ?? []).map((s) => s.name),
  }));
}

/**
 * Serve a one-time login page on 127.0.0.1. The parent picks their school's
 * Wilma, logs in, and the verified login is saved to the local config file —
 * the password never passes through an agent's chat. Families with children
 * on different Wilmas can add another login on the same page; it closes when
 * the parent presses Done or after 15 idle minutes.
 */
export async function startLoginServer(
  opts: { timeoutMs?: number; onSaved?: (profile: StoredProfile) => void } = {}
): Promise<LoginServer> {
  const token = randomBytes(18).toString("base64url");
  const nonce = randomBytes(16).toString("base64");
  const base = `/${token}`;
  const saved: StoredProfile[] = [];
  let attempts = 0;
  let settleFirst: (value: StoredProfile | null) => void = () => {};
  const result = new Promise<StoredProfile | null>((resolve) => {
    settleFirst = resolve;
  });
  let settleClosed: (value: StoredProfile[]) => void = () => {};
  const closed = new Promise<StoredProfile[]>((resolve) => {
    settleClosed = resolve;
  });
  let origin = "";

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      sendJson(res, 500, { status: "error", message: err instanceof Error ? err.message : String(err) });
    });
  });

  // Only our own page may post here: browsers always send Origin on fetch POSTs.
  const fromOwnPage = (req: IncomingMessage) =>
    req.headers.origin === origin && (req.headers["content-type"] ?? "").includes("application/json");

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", origin);
    if (url.pathname === base || url.pathname === `${base}/`) {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Frame-Options": "DENY",
        "Content-Security-Policy": [
          "default-src 'none'",
          `script-src 'nonce-${nonce}'`,
          `style-src 'nonce-${nonce}'`,
          "connect-src 'self'",
          "img-src 'self' data:",
          "form-action 'none'",
          "frame-ancestors 'none'",
          "base-uri 'none'",
        ].join("; "),
      });
      res.end(renderLoginPage({ nonce, apiBase: `${base}/api`, configPath: getConfigPath() }));
      return;
    }

    if (url.pathname === `${base}/api/tenants` && req.method === "GET") {
      const tenants = await searchTenants(url.searchParams.get("q") ?? "", 12);
      sendJson(res, 200, { tenants: tenants.map((t) => ({ url: t.url, name: t.name })) });
      return;
    }

    if (url.pathname === `${base}/api/done` && req.method === "POST") {
      if (!fromOwnPage(req)) {
        sendJson(res, 403, { status: "error", message: "Forbidden" });
        return;
      }
      sendJson(res, 200, { status: "ok" });
      setTimeout(() => close(), 300).unref();
      return;
    }

    if (url.pathname === `${base}/api/login` && req.method === "POST") {
      if (!fromOwnPage(req)) {
        sendJson(res, 403, { status: "error", message: "Forbidden" });
        return;
      }
      attempts += 1;
      if (attempts > MAX_ATTEMPTS) {
        sendJson(res, 429, { status: "error", code: "too_many_attempts" });
        // Shut this page down so the next login attempt starts a fresh one.
        setTimeout(() => close(), 500).unref();
        return;
      }
      const body = (await readJson(req)) as {
        tenantUrl?: string;
        tenantName?: string;
        username?: string;
        password?: string;
        totpSecret?: string;
      };
      const tenantUrl = (body.tenantUrl ?? "").trim();
      const username = (body.username ?? "").trim();
      const password = body.password ?? "";
      const totpSecret = (body.totpSecret ?? "").trim() || null;
      if (!/^https?:\/\//i.test(tenantUrl) || !username || !password) {
        sendJson(res, 400, { status: "error", code: "missing_fields" });
        return;
      }
      try {
        const { client, students } = await verifyLoginSession({ tenantUrl, username, password, totpSecret });
        // Keep this verified session for the assistant's first questions (no second login or code).
        adoptSession({ baseUrl: normalizeTenantUrl(tenantUrl), username, password }, client);
        const config = await loadConfig();
        const stored = await saveLogin(config, {
          tenantUrl: normalizeTenantUrl(tenantUrl),
          tenantName: body.tenantName ?? null,
          username,
          password,
          totpSecret,
          students,
        });
        // Every Wilma login saved so far, so the page can show the whole family.
        sendJson(res, 200, {
          status: "ok",
          students: students.map((s) => s.name),
          accounts: accountsSummary(config.profiles),
        });
        saved.push(stored);
        attempts = 0;
        resetIdle();
        settleFirst(stored);
        opts.onSaved?.(stored);
      } catch (err) {
        if (err instanceof TotpSecretRequiredError) {
          sendJson(res, 200, { status: "mfa_required" });
        } else if (err instanceof TotpSecretInvalidError) {
          sendJson(res, 200, { status: "error", code: "bad_totp", message: err.message });
        } else if (err instanceof AuthenticationError) {
          sendJson(res, 200, { status: "error", code: "bad_credentials" });
        } else {
          sendJson(res, 200, { status: "error", message: err instanceof Error ? err.message : String(err) });
        }
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("Login server failed to start");
  origin = `http://127.0.0.1:${address.port}`;

  let timer: NodeJS.Timeout | undefined;
  function resetIdle() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => close(), opts.timeoutMs ?? IDLE_TIMEOUT_MS);
    timer.unref();
  }
  resetIdle();

  let isClosed = false;
  function close() {
    if (isClosed) return;
    isClosed = true;
    if (timer) clearTimeout(timer);
    server.close();
    server.closeAllConnections?.();
    settleFirst(null);
    settleClosed(saved);
  }

  return { url: `${origin}${base}/`, result, closed, close };
}

export type BrowserOpenResult = "opened" | "skipped" | "headless";

/** Best-effort: open a URL in the user's default browser. */
export function openBrowser(url: string, opts: { dryRun?: boolean } = {}): BrowserOpenResult {
  if (process.env.WILMAI_NO_BROWSER) return "skipped";
  const platform = process.platform;
  if (platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return "headless";
  if (opts.dryRun) return "skipped";
  const [command, args] =
    platform === "darwin"
      ? ["open", [url]]
      : platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(command, args as string[], { stdio: "ignore", detached: true });
    child.on("error", () => undefined);
    child.unref();
    return "opened";
  } catch {
    return "skipped";
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("Request too large");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    return {};
  }
}

/** JSON for embedding inside <script>: "<" escaped so a value can never close the script tag. */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export interface LoginPageOptions {
  nonce: string;
  apiBase: string;
  /** Shown under the form; "{path}" is replaced with the config path. */
  privacy?: { en: string; fi: string };
  configPath?: string;
  /** Extra fields posted with the login (e.g. a sealed OAuth request). */
  extra?: Record<string, string>;
  /** Label for the finishing button, for hosts that continue elsewhere after the login. */
  finishLabel?: { en: string; fi: string };
  /** Shown above the form, e.g. which app is connecting. */
  notice?: { en: string; fi: string };
}

/**
 * The login page. The login API answers {status: "ok", students, redirect?};
 * with a redirect the page navigates there (e.g. an OAuth callback).
 */
export function renderLoginPage(opts: LoginPageOptions): string {
  const strings = {
    en: {
      title: "Log in to Wilma — WilmAI",
      heading: "Log in to Wilma",
      intro: "Connect your Wilma account once. Your assistant can then check schedules, homework, exams, messages and news for you.",
      school: "Your school's Wilma",
      schoolHint: "Type your city or school name",
      schoolHelp: "Start typing, then pick your Wilma from the list. Or tap your city:",
      change: "Change",
      noResults: "No Wilma found. Many schools use their city's Wilma, so try the city or municipality. You can also paste the address, e.g. https://yourcity.inschool.fi",
      username: "Wilma username",
      password: "Password",
      mfaTitle: "Two-step verification",
      mfaBody: "Your account uses two-step verification. So your assistant can check Wilma without asking you for a code each time, paste the setup key from your authenticator app (a base32 key or an otpauth:// link).",
      mfaLabel: "Authenticator setup key",
      mfaHelp: "Where to find it: some authenticator apps (and password managers like 1Password or Bitwarden) can show the key for an existing entry. If yours can't, set up two-step verification again in Wilma and copy the key while the QR code is on screen — setup screens usually offer it as text. Add it to your authenticator app as usual and paste the same key here. WilmAI then makes the 6-digit codes itself.",
      submit: "Log in",
      working: "Checking with Wilma…",
      doneTitle: "You're connected",
      doneIntro: "Children found:",
      addAnother: "Add another Wilma",
      addAnotherHint: "If one of your children goes to a school with a different Wilma, add that login too.",
      finish: "Done",
      finishedTitle: "All set",
      finishedBody: "You can close this tab and go back to your assistant.",
      noChildren: "No children found on this login.",
      badCredentials: "Wilma didn't accept that username and password.",
      badTotp: "Wilma didn't accept the two-step verification. Paste the authenticator setup key (a long base32 key or an otpauth:// link), not a 6-digit code.",
      tooMany: "Too many attempts. Close this tab and start again from your assistant.",
      missing: "Pick your school's Wilma and fill in both fields.",
      notAllowed: "This Wilma account isn't on the test list for the hosted connection yet.",
      expired: "This login page is no longer active. Start the login again from your assistant, or run wilma login.",
      privacy: "Your login is saved only on this computer, in {path}. WilmAI has no server; it talks only to your school's Wilma.",
      disclaimer: "WilmAI is an independent open-source project, not affiliated with Visma or the Wilma service.",
    },
    fi: {
      title: "Kirjaudu Wilmaan — WilmAI",
      heading: "Kirjaudu Wilmaan",
      intro: "Yhdistä Wilma-tunnuksesi kerran. Sen jälkeen avustajasi voi tarkistaa lukujärjestykset, läksyt, kokeet, viestit ja tiedotteet puolestasi.",
      school: "Koulusi Wilma",
      schoolHint: "Kirjoita kaupunki tai koulun nimi",
      schoolHelp: "Ala kirjoittaa ja valitse Wilmasi listalta. Tai napauta kaupunkiasi:",
      change: "Vaihda",
      noResults: "Wilmaa ei löytynyt. Monen koulun Wilma löytyy kaupungin tai kunnan nimellä, joten kokeile sitä. Voit myös liittää osoitteen, esim. https://kaupunki.inschool.fi",
      username: "Wilma-käyttäjätunnus",
      password: "Salasana",
      mfaTitle: "Kaksivaiheinen tunnistautuminen",
      mfaBody: "Tunnuksessasi on kaksivaiheinen tunnistautuminen. Jotta avustajasi voi tarkistaa Wilman kysymättä sinulta joka kerta koodia, liitä todennussovelluksesi asetusavain (base32-avain tai otpauth://-linkki).",
      mfaLabel: "Todennussovelluksen asetusavain",
      mfaHelp: "Mistä sen löytää: jotkin todennussovellukset (ja salasanojen hallintaohjelmat, kuten 1Password tai Bitwarden) näyttävät avaimen olemassa olevalle tunnukselle. Jos sovelluksesi ei näytä sitä, ota kaksivaiheinen tunnistautuminen uudelleen käyttöön Wilmassa ja kopioi avain, kun QR-koodi on näkyvissä — käyttöönottonäkymä tarjoaa sen yleensä myös tekstinä. Lisää se todennussovellukseesi tavalliseen tapaan ja liitä sama avain tähän. WilmAI tekee sen jälkeen 6-numeroiset koodit itse.",
      submit: "Kirjaudu",
      working: "Tarkistetaan Wilmasta…",
      doneTitle: "Yhteys on valmis",
      doneIntro: "Löytyneet lapset:",
      addAnother: "Lisää toinen Wilma",
      addAnotherHint: "Jos joku lapsistasi käy koulua, jolla on eri Wilma, lisää myös sen tunnukset.",
      finish: "Valmis",
      finishedTitle: "Kaikki valmista",
      finishedBody: "Voit sulkea tämän välilehden ja palata avustajaasi.",
      noChildren: "Näillä tunnuksilla ei löytynyt lapsia.",
      badCredentials: "Wilma ei hyväksynyt käyttäjätunnusta ja salasanaa.",
      badTotp: "Wilma ei hyväksynyt kaksivaiheista tunnistautumista. Liitä todennussovelluksen asetusavain (pitkä base32-avain tai otpauth://-linkki), ei 6-numeroista koodia.",
      tooMany: "Liian monta yritystä. Sulje välilehti ja aloita uudelleen avustajasi kautta.",
      missing: "Valitse koulusi Wilma ja täytä molemmat kentät.",
      notAllowed: "Tämä Wilma-tunnus ei ole vielä verkkoyhteyden testilistalla.",
      expired: "Tämä kirjautumissivu ei ole enää käytössä. Aloita kirjautuminen uudelleen avustajasi kautta tai komennolla wilma login.",
      privacy: "Kirjautumistietosi tallennetaan vain tälle tietokoneelle, tiedostoon {path}. WilmAI:lla ei ole palvelinta; se on yhteydessä vain koulusi Wilmaan.",
      disclaimer: "WilmAI on itsenäinen avoimen lähdekoodin projekti, eikä se liity Vismaan tai Wilma-palveluun.",
    },
  };
  if (opts.finishLabel) {
    strings.en.finish = opts.finishLabel.en;
    strings.fi.finish = opts.finishLabel.fi;
  }
  if (opts.privacy) {
    strings.en.privacy = opts.privacy.en;
    strings.fi.privacy = opts.privacy.fi;
  }
  const nonce = escapeHtml(opts.nonce);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>WilmAI</title>
<style nonce="${nonce}">
  :root { --ink:#1b2b34; --muted:#5b6b73; --paper:#fbf8f1; --line:#e6dfcf; --teal:#2e9e93; --yellow:#ffd84d; --card:#fff; --err:#b3261e; }
  @media (prefers-color-scheme: dark) { :root { --ink:#eef2f3; --muted:#a8b5bb; --paper:#141c21; --line:#2c3a42; --card:#1b252b; --err:#ff8a80; } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--paper); color:var(--ink); font:16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
  main { max-width:440px; margin:0 auto; padding:40px 16px 48px; }
  h1 { font-size:28px; line-height:1.2; margin:0 0 8px; }
  h1 mark { background:linear-gradient(transparent 55%, var(--yellow) 55%); color:inherit; padding:0 2px; }
  p { margin:0 0 16px; }
  .muted { color:var(--muted); font-size:14px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:20px; margin:20px 0; }
  label { display:block; font-weight:600; margin:14px 0 6px; }
  label:first-child { margin-top:0; }
  input { width:100%; font:inherit; padding:10px 12px; border:1px solid var(--line); border-radius:8px; background:var(--paper); color:var(--ink); }
  input:focus { outline:2px solid var(--teal); outline-offset:1px; }
  ul.results { list-style:none; margin:6px 0 0; padding:0; border:1.5px solid var(--teal); border-radius:10px; max-height:340px; overflow:auto; background:var(--card); box-shadow:0 8px 20px rgba(0,0,0,.08); }
  ul.results:empty { display:none; }
  ul.results button { display:block; width:100%; text-align:left; background:none; border:0; border-bottom:1px solid var(--line); padding:11px 14px; font:inherit; font-weight:600; line-height:1.35; color:inherit; cursor:pointer; }
  ul.results li:last-child button { border-bottom:0; }
  ul.results button:hover, ul.results button:focus, ul.results button.hl { background:var(--paper); }
  ul.results button.hl { box-shadow: inset 3px 0 0 var(--teal); }
  .help { font-size:14px; color:var(--muted); margin:8px 0 6px; }
  .chips { display:flex; flex-wrap:wrap; gap:6px; }
  .chips button { font:inherit; font-size:14px; padding:4px 12px; border-radius:999px; border:1px solid var(--line); background:var(--paper); color:var(--ink); cursor:pointer; }
  .chips button:hover, .chips button:focus { border-color:var(--teal); }
  ul.results small { display:block; margin-top:2px; font-weight:400; font-size:13px; color:var(--muted); }
  .chosen { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:10px 12px; border:1px solid var(--teal); border-radius:8px; }
  .chosen small { display:block; color:var(--muted); word-break:break-all; }
  .link { background:none; border:0; color:var(--teal); font:inherit; cursor:pointer; padding:0; text-decoration:underline; }
  .primary { width:100%; margin-top:20px; padding:12px; font:inherit; font-weight:700; border:0; border-radius:8px; background:var(--teal); color:#fff; cursor:pointer; }
  .primary:disabled { opacity:.6; cursor:wait; }
  .secondary { width:100%; margin-top:10px; padding:11px; font:inherit; font-weight:700; border:1px solid var(--teal); border-radius:8px; background:transparent; color:var(--teal); cursor:pointer; }
  .wilma-name { font-weight:700; margin:14px 0 4px; }
  ul.children { margin:6px 0 0; padding-left:22px; }
  ul.children li { padding:3px 0; }
  .add-hint { margin-top:8px; }
  .notice { margin:0 0 16px; padding:10px 12px; border-radius:8px; background:var(--paper); border:1px solid var(--line); font-size:14px; }
  .error { color:var(--err); margin-top:12px; }
  .done h2 { margin:0 0 8px; }
  [hidden] { display:none !important; }
</style>
</head>
<body>
<main>
  <h1 id="heading"></h1>
  <p id="intro"></p>
  <section class="card" id="form-card">
    <p class="notice" id="notice" hidden></p>
    <div id="school-pick">
      <label for="school" id="school-label"></label>
      <input id="school" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-controls="results" aria-expanded="false">
      <ul class="results" id="results" role="listbox"></ul>
      <p class="help" id="school-help"></p>
      <div class="chips" id="chips"></div>
      <p class="muted" id="no-results" hidden></p>
    </div>
    <div id="school-chosen" hidden>
      <label id="school-label-2"></label>
      <div class="chosen"><div><span id="chosen-name"></span><small id="chosen-url"></small></div><button class="link" id="change" type="button"></button></div>
    </div>
    <label for="username" id="username-label"></label>
    <input id="username" autocomplete="username" autocapitalize="none" spellcheck="false">
    <label for="password" id="password-label"></label>
    <input id="password" type="password" autocomplete="current-password">
    <div id="mfa" hidden>
      <label id="mfa-title"></label>
      <p class="muted" id="mfa-body"></p>
      <label for="totp" id="mfa-label"></label>
      <input id="totp" autocomplete="off" spellcheck="false">
      <p class="muted" id="mfa-help"></p>
    </div>
    <p class="error" id="error" role="alert" hidden></p>
    <button class="primary" id="submit" type="button"></button>
  </section>
  <section class="card done" id="done" hidden>
    <h2 id="done-title"></h2>
    <div id="accounts"></div>
    <button class="primary" id="finish" type="button"></button>
    <button class="secondary" id="add-another" type="button"></button>
    <p class="muted add-hint" id="add-hint"></p>
  </section>
  <section class="card done" id="finished" hidden>
    <h2 id="finished-title"></h2>
    <p id="finished-body"></p>
  </section>
  <p class="muted" id="privacy"></p>
  <p class="muted" id="disclaimer"></p>
</main>
<script nonce="${nonce}">
(() => {
  const STRINGS = ${jsonForScript(strings)};
  const API = ${jsonForScript(opts.apiBase)};
  const CONFIG_PATH = ${jsonForScript(opts.configPath ?? "")};
  const EXTRA = ${jsonForScript(opts.extra ?? {})};
  const NOTICE = ${jsonForScript(opts.notice ?? null)};
  const lang = (navigator.language || "en").toLowerCase().startsWith("fi") ? "fi" : "en";
  const t = STRINGS[lang];
  document.documentElement.lang = lang;
  document.title = t.title;
  const $ = (id) => document.getElementById(id);
  const text = (id, value) => { $(id).textContent = value; };
  text("heading", ""); $("heading").append(t.heading.split(" ").slice(0, -1).join(" ") + " ");
  const mark = document.createElement("mark"); mark.textContent = t.heading.split(" ").slice(-1)[0]; $("heading").append(mark);
  text("intro", t.intro); text("school-label", t.school); text("school-label-2", t.school);
  $("school").placeholder = t.schoolHint; text("no-results", t.noResults); text("change", t.change);
  text("school-help", t.schoolHelp);
  for (const city of ["Helsinki", "Espoo", "Tampere", "Vantaa", "Oulu", "Turku", "Jyväskylä"]) {
    const b = document.createElement("button"); b.type = "button"; b.textContent = city;
    b.addEventListener("click", () => { $("school").value = city; search(city).catch(() => showError(t.expired)); $("school").focus(); });
    $("chips").append(b);
  }
  text("username-label", t.username); text("password-label", t.password);
  text("mfa-title", t.mfaTitle); text("mfa-body", t.mfaBody); text("mfa-label", t.mfaLabel); text("mfa-help", t.mfaHelp);
  text("submit", t.submit); text("done-title", t.doneTitle);
  text("finish", t.finish); text("add-another", t.addAnother); text("add-hint", t.addAnotherHint);
  text("finished-title", t.finishedTitle); text("finished-body", t.finishedBody);
  if (NOTICE) { text("notice", NOTICE[lang]); $("notice").hidden = false; }
  let pending = null;

  function renderAccounts(accounts) {
    const box = $("accounts"); box.replaceChildren();
    const intro = document.createElement("p"); intro.textContent = t.doneIntro; box.append(intro);
    for (const account of accounts) {
      if (accounts.length > 1) {
        const name = document.createElement("p"); name.className = "wilma-name"; name.textContent = account.wilma; box.append(name);
      }
      const ul = document.createElement("ul"); ul.className = "children";
      const kids = (account.students || []).filter(Boolean);
      if (!kids.length) { const li = document.createElement("li"); li.textContent = t.noChildren; ul.append(li); }
      for (const kid of kids) { const li = document.createElement("li"); li.textContent = kid; ul.append(li); }
      box.append(ul);
    }
  }

  $("add-another").addEventListener("click", () => {
    tenant = null;
    for (const id of ["school", "username", "password", "totp"]) $(id).value = "";
    render([]); showError("");
    $("mfa").hidden = true; $("school-chosen").hidden = true; $("school-pick").hidden = false;
    $("done").hidden = true; $("form-card").hidden = false;
    $("school").focus();
  });

  $("finish").addEventListener("click", async () => {
    const btn = $("finish"); btn.disabled = true;
    try {
      const res = await fetch(API + "/done", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...EXTRA, pending: pending || undefined }),
      });
      const data = await res.json();
      if (data.redirect) { window.location.assign(data.redirect); return; }
      if (data.status !== "ok") { showError(data.message || t.expired); btn.disabled = false; return; }
    } catch (err) {
      // The page may already have closed; the login is saved either way.
    }
    $("done").hidden = true; $("finished").hidden = false;
  });
  text("privacy", t.privacy.replace("{path}", CONFIG_PATH)); text("disclaimer", t.disclaimer);

  let tenant = null;
  let timer = null;
  let seq = 0;
  const showError = (msg) => { const el = $("error"); el.textContent = msg; el.hidden = !msg; };

  function choose(t2) {
    tenant = t2;
    text("chosen-name", t2.name || t2.url); text("chosen-url", t2.url);
    $("school-pick").hidden = true; $("school-chosen").hidden = false;
    $("username").focus();
  }
  $("change").addEventListener("click", () => {
    tenant = null; $("school-chosen").hidden = true; $("school-pick").hidden = false; $("school").focus();
  });

  async function search(q) {
    const mine = ++seq;
    const trimmed = q.trim();
    if (/^https?:\\/\\//i.test(trimmed)) {
      render([{ url: trimmed.replace(/\\/$/, ""), name: trimmed.replace(/\\/$/, "") }]);
      return;
    }
    if (!trimmed) { render([]); $("no-results").hidden = true; return; }
    const res = await fetch(API + "/tenants?q=" + encodeURIComponent(trimmed));
    if (!res.ok) throw new Error("search failed");
    const data = await res.json();
    if (mine !== seq) return;
    showError("");
    render(data.tenants || []);
    $("no-results").hidden = (data.tenants || []).length > 0;
  }
  let highlighted = 0;
  function highlight(index) {
    const buttons = [...$("results").querySelectorAll("button")];
    if (!buttons.length) return;
    highlighted = (index + buttons.length) % buttons.length;
    buttons.forEach((b, i) => { b.classList.toggle("hl", i === highlighted); b.setAttribute("aria-selected", String(i === highlighted)); });
    buttons[highlighted].scrollIntoView({ block: "nearest" });
  }
  function render(list) {
    const ul = $("results"); ul.replaceChildren();
    $("school").setAttribute("aria-expanded", String(list.length > 0));
    // While results are showing, hide the hint and city chips so the list is easy to read.
    $("school-help").hidden = list.length > 0;
    $("chips").hidden = list.length > 0;
    for (const item of list) {
      const li = document.createElement("li");
      const b = document.createElement("button"); b.type = "button";
      b.textContent = item.name || item.url;
      const small = document.createElement("small"); small.textContent = item.url.replace(/^https?:\\/\\//, ""); b.append(small);
      b.addEventListener("click", () => choose(item));
      b.setAttribute("role", "option");
      li.append(b); ul.append(li);
    }
    highlight(0);
  }
  $("school").addEventListener("input", (e) => {
    clearTimeout(timer);
    const q = e.target.value;
    timer = setTimeout(() => search(q).catch(() => showError(t.expired)), 150);
  });
  $("school").addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); highlight(highlighted + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); highlight(highlighted - 1); }
    else if (e.key === "Enter") { const b = $("results").querySelectorAll("button")[highlighted]; if (b) b.click(); }
  });
  $("password").addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  $("totp").addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  $("submit").addEventListener("click", () => submit());

  async function submit() {
    showError("");
    const username = $("username").value.trim();
    const password = $("password").value;
    if (!tenant || !username || !password) {
      showError(t.missing);
      if (!tenant) $("school").focus();
      return;
    }
    const btn = $("submit"); btn.disabled = true; btn.textContent = t.working;
    try {
      const res = await fetch(API + "/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...EXTRA, pending: pending || undefined, tenantUrl: tenant.url, tenantName: tenant.name, username, password, totpSecret: $("totp").value.trim() || undefined }),
      });
      const data = await res.json();
      if (data.status === "ok") {
        if (data.pending) pending = data.pending;
        renderAccounts(data.accounts || [{ wilma: tenant.name || tenant.url, students: data.students || [] }]);
        $("form-card").hidden = true; $("done").hidden = false;
        $("finish").focus();
        return;
      }
      if (data.status === "mfa_required") { $("mfa").hidden = false; $("totp").focus(); return; }
      if (data.code === "bad_credentials") showError(t.badCredentials);
      else if (data.code === "too_many_attempts") showError(t.tooMany);
      else if (data.code === "missing_fields") showError(t.missing);
      else if (data.code === "not_allowed") showError(t.notAllowed);
      else if (data.code === "bad_totp") { $("mfa").hidden = false; showError(lang === "fi" ? t.badTotp : (data.message || t.badTotp)); }
      else showError(data.message || "Error");
    } catch (err) {
      // The server stops after a login, a timeout, or too many attempts.
      showError(t.expired);
    } finally {
      btn.disabled = false; btn.textContent = t.submit;
    }
  }
  $("school").focus();
})();
</script>
</body>
</html>`;
}
