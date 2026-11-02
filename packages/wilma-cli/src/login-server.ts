import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { AuthenticationError } from "@wilm-ai/wilma-client";
import { getConfigPath, loadConfig, saveConfig, type StoredProfile } from "./config.js";
import { adoptSession, roleOf } from "./agent-data.js";
import { removeLogin, setHiddenChildren } from "./access.js";
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

/** Each saved login, as the page shows it: its Wilma, username, whose it is, and its children (unticked ones hidden). */
function accountsSummary(profiles: StoredProfile[]): SavedLogin[] {
  return profiles.map((p) => {
    const role = roleOf(p.students ?? []);
    return {
      id: p.id,
      wilma: p.tenantName ?? p.tenantUrl,
      url: p.tenantUrl,
      username: p.username,
      ...(role ? { role } : {}),
      children: (p.students ?? []).map((s) => ({ number: s.studentNumber, name: s.name, ...(p.hidden?.includes(s.studentNumber) ? { hidden: true } : {}) })),
    };
  });
}

const savedLogins = async () => accountsSummary((await loadConfig()).profiles);

/**
 * Serve a one-time login page on 127.0.0.1, laid out like WilmAI Home's Wilma
 * page: who uses WilmAI, one row per Wilma (a saved one with its children to
 * tick, Log in again and Remove; a new one to fill in), Add another school's
 * Wilma, and one button that logs in every new row. Each verified login is
 * saved to the local config file — the password never passes through an
 * agent's chat. One login per Wilma, as in Home. The page closes when the
 * parent presses Done or after 15 idle minutes.
 */
/**
 * The assistant app that asked for the login (by the name it gives when it
 * connects to the MCP server), named in the page's intro so the parent can
 * connect the page to what they just did.
 */
export type OpenedBy = { app: string };

/** A plain app name from the name an MCP client reports, or undefined if unknown. */
export function appName(client?: { name?: string; title?: string }): string | undefined {
  const raw = `${client?.title ?? ""} ${client?.name ?? ""}`.toLowerCase();
  if (raw.includes("claude-code") || raw.includes("claude code")) return "Claude Code";
  if (raw.includes("claude")) return "Claude";
  if (raw.includes("codex")) return "Codex";
  if (raw.includes("chatgpt") || raw.includes("openai")) return "ChatGPT";
  if (raw.includes("cursor")) return "Cursor";
  if (raw.includes("openclaw")) return "OpenClaw";
  // Another app: its own display name, if it gave one.
  const title = client?.title?.trim();
  return title && title.length <= 40 ? title : undefined;
}

export async function startLoginServer(
  opts: { timeoutMs?: number; onSaved?: (profile: StoredProfile) => void; openedBy?: OpenedBy } = {}
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
      // The logins already saved, so adding another Wilma (or logging in again) starts from what's there.
      const accounts = await savedLogins().catch(() => []);
      res.end(renderLoginPage({ nonce, apiBase: `${base}/api`, configPath: getConfigPath(), openedBy: opts.openedBy, accounts }));
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

    // Remove a saved login (its Wilma session ends), or untick children: the page's own buttons.
    if ((url.pathname === `${base}/api/remove` || url.pathname === `${base}/api/children`) && req.method === "POST") {
      if (!fromOwnPage(req)) {
        sendJson(res, 403, { status: "error", message: "Forbidden" });
        return;
      }
      const body = (await readJson(req)) as { id?: unknown; hidden?: unknown };
      if (typeof body.id !== "string") {
        sendJson(res, 400, { status: "error", code: "missing_fields" });
        return;
      }
      resetIdle();
      if (url.pathname.endsWith("/remove")) {
        await removeLogin(body.id);
        saved.splice(0, saved.length, ...saved.filter((p) => p.id !== body.id));
      } else {
        const hidden = Array.isArray(body.hidden) ? body.hidden.filter((x): x is string => typeof x === "string") : [];
        await setHiddenChildren(body.id, hidden);
      }
      sendJson(res, 200, { status: "ok", accounts: await savedLogins() });
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
        /** A saved login this one takes the place of (Log in again on its row). */
        replace?: string;
      };
      const tenantUrl = (body.tenantUrl ?? "").trim();
      const username = (body.username ?? "").trim();
      const password = body.password ?? "";
      const totpSecret = (body.totpSecret ?? "").trim() || null;
      if (!/^https?:\/\//i.test(tenantUrl) || !username || !password) {
        sendJson(res, 400, { status: "error", code: "missing_fields" });
        return;
      }
      // One login per Wilma, as in WilmAI Home: another user for a Wilma already saved goes through its row (Log in again).
      const before = await loadConfig();
      const wilmaUrl = normalizeTenantUrl(tenantUrl);
      const onWilma = (p: StoredProfile) => normalizeTenantUrl(p.tenantUrl) === wilmaUrl;
      const replaced = before.profiles.find((p) => p.id === body.replace);
      const again = before.profiles.some((p) => onWilma(p) && p.username.toLowerCase() === username.toLowerCase());
      if (!again && before.profiles.some((p) => onWilma(p) && p !== replaced)) {
        sendJson(res, 200, { status: "error", code: "taken" });
        return;
      }
      try {
        const { client, students } = await verifyLoginSession({ tenantUrl, username, password, totpSecret });
        // Keep this verified session for the assistant's first questions (no second login or code).
        adoptSession({ baseUrl: wilmaUrl, username, password }, client);
        const config = await loadConfig();
        const stored = await saveLogin(config, {
          tenantUrl: wilmaUrl,
          tenantName: body.tenantName ?? null,
          username,
          password,
          totpSecret,
          students,
        });
        if (replaced && replaced.id !== stored.id) await takePlace(stored.id, replaced.id);
        // Every Wilma login saved so far, so the page can show the whole family.
        sendJson(res, 200, { status: "ok", accounts: await savedLogins() });
        // What this page saved, for `wilma login` to report (a replaced login isn't).
        saved.splice(0, saved.length, ...saved.filter((p) => p.id !== stored.id && p.id !== replaced?.id), stored);
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

/** A new login in the place of the one it replaces (Log in again with another user or Wilma), which is removed. */
async function takePlace(id: string, replacedId: string): Promise<void> {
  const config = await loadConfig();
  const login = config.profiles.find((p) => p.id === id);
  const at = config.profiles.findIndex((p) => p.id === replacedId);
  if (login && at !== -1) {
    config.profiles = config.profiles.filter((p) => p !== login);
    config.profiles.splice(at, 0, login);
    await saveConfig(config);
  }
  await removeLogin(replacedId);
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

/** A saved login as the page shows it (see accountsSummary). */
export interface SavedLogin {
  id: string;
  wilma: string;
  url: string;
  username: string;
  role?: "guardian" | "student";
  children: { number: string; name: string; hidden?: boolean }[];
}

export interface LoginPageOptions {
  nonce: string;
  apiBase: string;
  /** Shown in the privacy note under the form. */
  configPath?: string;
  openedBy?: OpenedBy;
  /** The logins already saved. */
  accounts?: SavedLogin[];
}

/**
 * The login page, laid out like WilmAI Home's Wilma page. The API answers
 * {status: "ok", accounts} after a login, a removal or a tick.
 */
export function renderLoginPage(opts: LoginPageOptions): string {
  const strings = {
    en: {
      title: "Log in to Wilma — WilmAI",
      heading: "Log in to Wilma",
      intro: "Connect your Wilma account once. Your assistant can then check schedules, homework, exams, messages and news for you.",
      introApp: "{app} asked to connect to your Wilma. Log in once, and {app} can then check schedules, homework, exams, messages and news for you.",
      introMore: "Add another school's Wilma, or log in again if a password has changed. The logins already saved stay as they are.",
      introMoreApp: "{app} opened this page. Add another school's Wilma, or log in again if a password has changed. The logins already saved stay as they are.",
      who: "Who uses WilmAI",
      parent: "A parent",
      student: "A student",
      whoParent: "All your children, from every school's Wilma.",
      whoStudent: "Your own lessons, exams and homework, from your Wilma.",
      oneWilma: "A student has one Wilma. Remove the others first.",
      school: "Your school's Wilma",
      otherSchool: "The other school's Wilma",
      schoolHint: "Type your city or school name",
      schoolHelp: "Start typing, then pick your Wilma from the list. Or tap your city:",
      change: "Change",
      noResults: "No Wilma found. Many schools use their city's Wilma, so try the city or municipality. You can also paste the address, e.g. https://yourcity.inschool.fi",
      taken: "This Wilma is here already. To use another username there, press Log in again on its row.",
      username: "Wilma username",
      password: "Password",
      mfaTitle: "Two-step verification",
      mfaBody: "Your account uses two-step verification. So your assistant can check Wilma without asking you for a code each time, paste the setup key from your authenticator app (a base32 key or an otpauth:// link).",
      mfaLabel: "Authenticator setup key",
      mfaHelp: "Where to find it: some authenticator apps (and password managers like 1Password or Bitwarden) can show the key for an existing entry. If yours can't, set up two-step verification again in Wilma and copy the key while the QR code is on screen — setup screens usually offer it as text. Add it to your authenticator app as usual and paste the same key here. WilmAI then makes the 6-digit codes itself.",
      saved: "Saved",
      ownLogin: "student's own login",
      again: "Log in again",
      cancel: "Cancel",
      remove: "Remove",
      removeAsk: "Remove {school}? Its Wilma session ends, and your assistant no longer reads it.",
      kidsLabel: "Children to read from {school}",
      twice: "Wilma lists {name} twice: a new school gives a new profile. Untick the one you don't need.",
      noChildren: "No children found on this login.",
      addAnother: "Add another school's Wilma",
      addAnotherHint: "For a child at a school with its own Wilma: another town, an upper secondary school, a private school.",
      submit: "Log in",
      working: "Checking with Wilma…",
      done: "Done",
      finishedTitle: "All set",
      finishedBody: "You can close this tab and go back to your assistant.",
      badCredentials: "Wilma didn't accept that username and password.",
      badTotp: "Wilma didn't accept the two-step verification. Paste the authenticator setup key (a long base32 key or an otpauth:// link), not a 6-digit code.",
      tooMany: "Too many attempts. Close this tab and start again from your assistant.",
      missing: "Choose the school's Wilma, and type the username and password.",
      expired: "This login page is no longer active. Start the login again from your assistant, or run wilma login.",
      privacy: "Your login is saved only on this computer, in {path}, readable only by your user account. To remove it, run wilma config clear or delete that file.",
      trustLocalTitle: "On your own computer",
      trustLocal: "This page isn't a website. It runs on this computer (that's what 127.0.0.1 in the address bar means), and WilmAI has no server.",
      trustWilmaTitle: "Only to your school's Wilma",
      trustWilma: "Your password goes from this computer straight to your school's Wilma. Your assistant never sees it.",
      trustWilmaHost: "Your password goes from this computer straight to {host}. Your assistant never sees it.",
      trustReadTitle: "The same information you see",
      trustRead: "WilmAI reads schedules, messages, news and the rest just as you see them in Wilma.",
      sentTo: "Sent only to {host}",
      learnMore: "How WilmAI handles your login",
      sourceCode: "Source code",
      disclaimer: "WilmAI is an independent open-source project, not affiliated with Visma or the Wilma service.",
    },
    fi: {
      title: "Kirjaudu Wilmaan — WilmAI",
      heading: "Kirjaudu Wilmaan",
      intro: "Yhdistä Wilma-tunnuksesi kerran. Sen jälkeen avustajasi voi tarkistaa lukujärjestykset, läksyt, kokeet, viestit ja tiedotteet puolestasi.",
      introApp: "{app} pyysi yhteyttä Wilmaasi. Kirjaudu kerran, niin {app} voi sen jälkeen tarkistaa lukujärjestykset, läksyt, kokeet, viestit ja tiedotteet puolestasi.",
      introMore: "Lisää toisen koulun Wilma tai kirjaudu uudelleen, jos salasana on vaihtunut. Jo tallennetut tunnukset säilyvät ennallaan.",
      introMoreApp: "{app} avasi tämän sivun. Lisää toisen koulun Wilma tai kirjaudu uudelleen, jos salasana on vaihtunut. Jo tallennetut tunnukset säilyvät ennallaan.",
      who: "Kuka käyttää WilmAI:ta",
      parent: "Huoltaja",
      student: "Oppilas",
      whoParent: "Kaikki lapsesi, jokaisen koulun Wilmasta.",
      whoStudent: "Omat tuntisi, kokeesi ja läksysi Wilmastasi.",
      oneWilma: "Oppilaalla on yksi Wilma. Poista ensin muut.",
      school: "Koulusi Wilma",
      otherSchool: "Toisen koulun Wilma",
      schoolHint: "Kirjoita kaupunki tai koulun nimi",
      schoolHelp: "Ala kirjoittaa ja valitse Wilmasi listalta. Tai napauta kaupunkiasi:",
      change: "Vaihda",
      noResults: "Wilmaa ei löytynyt. Monen koulun Wilma löytyy kaupungin tai kunnan nimellä, joten kokeile sitä. Voit myös liittää osoitteen, esim. https://kaupunki.inschool.fi",
      taken: "Tämä Wilma on jo täällä. Jos haluat käyttää siinä toista käyttäjätunnusta, paina sen kohdalla Kirjaudu uudelleen.",
      username: "Wilma-käyttäjätunnus",
      password: "Salasana",
      mfaTitle: "Kaksivaiheinen tunnistautuminen",
      mfaBody: "Tunnuksessasi on kaksivaiheinen tunnistautuminen. Jotta avustajasi voi tarkistaa Wilman kysymättä sinulta joka kerta koodia, liitä todennussovelluksesi asetusavain (base32-avain tai otpauth://-linkki).",
      mfaLabel: "Todennussovelluksen asetusavain",
      mfaHelp: "Mistä sen löytää: jotkin todennussovellukset (ja salasanojen hallintaohjelmat, kuten 1Password tai Bitwarden) näyttävät avaimen olemassa olevalle tunnukselle. Jos sovelluksesi ei näytä sitä, ota kaksivaiheinen tunnistautuminen uudelleen käyttöön Wilmassa ja kopioi avain, kun QR-koodi on näkyvissä — käyttöönottonäkymä tarjoaa sen yleensä myös tekstinä. Lisää se todennussovellukseesi tavalliseen tapaan ja liitä sama avain tähän. WilmAI tekee sen jälkeen 6-numeroiset koodit itse.",
      saved: "Tallennettu",
      ownLogin: "oppilaan omat tunnukset",
      again: "Kirjaudu uudelleen",
      cancel: "Peru",
      remove: "Poista",
      removeAsk: "Poistetaanko {school}? Sen Wilma-istunto päättyy, eikä avustajasi enää lue sitä.",
      kidsLabel: "Luettavat lapset: {school}",
      twice: "Wilma näyttää lapsen {name} kahdesti: uusi koulu antaa uuden profiilin. Poista valinta siltä, jota et tarvitse.",
      noChildren: "Näillä tunnuksilla ei löytynyt lapsia.",
      addAnother: "Lisää toisen koulun Wilma",
      addAnotherHint: "Lapselle, jonka koululla on oma Wilma: toinen paikkakunta, lukio tai yksityinen koulu.",
      submit: "Kirjaudu",
      working: "Tarkistetaan Wilmasta…",
      done: "Valmis",
      finishedTitle: "Kaikki valmista",
      finishedBody: "Voit sulkea tämän välilehden ja palata avustajaasi.",
      badCredentials: "Wilma ei hyväksynyt käyttäjätunnusta ja salasanaa.",
      badTotp: "Wilma ei hyväksynyt kaksivaiheista tunnistautumista. Liitä todennussovelluksen asetusavain (pitkä base32-avain tai otpauth://-linkki), ei 6-numeroista koodia.",
      tooMany: "Liian monta yritystä. Sulje välilehti ja aloita uudelleen avustajasi kautta.",
      missing: "Valitse koulun Wilma ja kirjoita käyttäjätunnus ja salasana.",
      expired: "Tämä kirjautumissivu ei ole enää käytössä. Aloita kirjautuminen uudelleen avustajasi kautta tai komennolla wilma login.",
      privacy: "Kirjautumistietosi tallennetaan vain tälle tietokoneelle, tiedostoon {path}, jota vain sinun käyttäjätilisi voi lukea. Voit poistaa ne komennolla wilma config clear tai poistamalla tiedoston.",
      trustLocalTitle: "Omalla koneellasi",
      trustLocal: "Tämä sivu ei ole verkkosivusto. Se toimii tällä koneella (sitä osoiterivin 127.0.0.1 tarkoittaa), eikä WilmAI:lla ole palvelinta.",
      trustWilmaTitle: "Vain koulusi Wilmaan",
      trustWilma: "Salasanasi lähtee tältä koneelta suoraan koulusi Wilmaan. Avustajasi ei näe sitä.",
      trustWilmaHost: "Salasanasi lähtee tältä koneelta suoraan osoitteeseen {host}. Avustajasi ei näe sitä.",
      trustReadTitle: "Samat tiedot kuin sinulla",
      trustRead: "WilmAI lukee lukujärjestykset, viestit, tiedotteet ja muut tiedot samoin kuin näet ne Wilmassa.",
      sentTo: "Lähetetään vain osoitteeseen {host}",
      learnMore: "Miten WilmAI käsittelee kirjautumisen (englanniksi)",
      sourceCode: "Lähdekoodi",
      disclaimer: "WilmAI on itsenäinen avoimen lähdekoodin projekti, eikä se liity Vismaan tai Wilma-palveluun.",
    },
  };
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
  main { max-width:920px; margin:0 auto; padding:32px 16px 48px; }
  .layout { display:grid; grid-template-columns:minmax(0, 1fr) minmax(0, 1fr); gap:24px 48px; align-items:start; }
  .layout .card { margin:0 0 16px; }
  .foot { max-width:560px; margin-top:28px; }
  @media (max-width:760px) { main { max-width:480px; } .layout { grid-template-columns:minmax(0, 1fr); } }
  h1 { font-size:28px; line-height:1.2; margin:0 0 8px; }
  h1 mark { background:linear-gradient(transparent 55%, var(--yellow) 55%); color:inherit; padding:0 2px; }
  @media (prefers-color-scheme: dark) { h1 mark { background:linear-gradient(transparent 60%, rgba(255,216,77,.4) 60%); } }
  p { margin:0 0 16px; }
  .muted { color:var(--muted); font-size:14px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:20px; margin:20px 0; }
  label, .label { display:block; font-weight:600; margin:14px 0 6px; }
  .school > label:first-child { margin-top:0; }
  input { width:100%; font:inherit; padding:10px 12px; border:1px solid var(--line); border-radius:8px; background:var(--paper); color:var(--ink); }
  input:focus { outline:2px solid var(--teal); outline-offset:1px; }
  input[type=checkbox] { width:auto; margin:0; accent-color:var(--teal); }
  ul.results { list-style:none; margin:6px 0 0; padding:0; border:1.5px solid var(--teal); border-radius:10px; max-height:340px; overflow:auto; background:var(--card); box-shadow:0 8px 20px rgba(0,0,0,.08); }
  ul.results:empty { display:none; }
  ul.results button { display:block; width:100%; text-align:left; background:none; border:0; border-bottom:1px solid var(--line); padding:11px 14px; font:inherit; font-weight:600; line-height:1.35; color:inherit; cursor:pointer; }
  ul.results li:last-child button { border-bottom:0; }
  ul.results button:hover, ul.results button:focus, ul.results button.hl { background:var(--paper); }
  ul.results button.hl { box-shadow: inset 3px 0 0 var(--teal); }
  ul.results small { display:block; margin-top:2px; font-weight:400; font-size:13px; color:var(--muted); }
  .help { font-size:14px; color:var(--muted); margin:8px 0 6px; }
  .chips { display:flex; flex-wrap:wrap; gap:6px; }
  .chips button { font:inherit; font-size:14px; padding:4px 12px; border-radius:999px; border:1px solid var(--line); background:var(--paper); color:var(--ink); cursor:pointer; }
  .chips button:hover, .chips button:focus { border-color:var(--teal); }
  .chosen { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:10px 12px; border:1px solid var(--teal); border-radius:8px; }
  .chosen small { display:block; color:var(--muted); word-break:break-all; }
  .link { background:none; border:0; color:var(--teal); font:inherit; cursor:pointer; padding:0; text-decoration:underline; }
  .quiet { background:none; border:1px solid var(--line); border-radius:8px; color:var(--ink); font:inherit; font-size:14px; padding:4px 10px; cursor:pointer; white-space:nowrap; }
  .quiet:hover, .quiet:focus { border-color:var(--teal); }
  .danger { background:var(--err); border:0; border-radius:8px; color:#fff; font:inherit; font-size:14px; font-weight:700; padding:5px 12px; cursor:pointer; }
  .primary { width:100%; margin-top:18px; padding:12px; font:inherit; font-weight:700; border:0; border-radius:8px; background:var(--teal); color:#fff; cursor:pointer; }
  .primary:disabled { opacity:.6; cursor:wait; }
  .secondary { padding:8px 14px; font:inherit; font-size:15px; font-weight:700; border:1px solid var(--teal); border-radius:8px; background:transparent; color:var(--teal); cursor:pointer; }
  .who { display:flex; gap:0; border:1px solid var(--line); border-radius:999px; padding:3px; width:fit-content; }
  .who button { font:inherit; font-size:15px; padding:5px 16px; border:0; border-radius:999px; background:transparent; color:var(--muted); cursor:pointer; }
  .who button[aria-pressed="true"] { background:var(--teal); color:#fff; font-weight:700; }
  .who-field { margin-bottom:16px; }
  .who-field .label { margin-top:0; }
  .wilma-row { position:relative; border:1px solid var(--line); border-radius:10px; padding:14px; margin:0 0 12px; }
  .wilma-row.new { border-style:dashed; }
  .wilma-head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
  .wilma-head small { display:block; color:var(--muted); font-size:14px; }
  .row-cancel { position:absolute; top:10px; right:10px; }
  .kids { margin-top:10px; display:flex; flex-direction:column; gap:6px; }
  .kid { display:flex; align-items:center; gap:10px; font-weight:400; margin:0; cursor:pointer; }
  .kids .help { margin:2px 0 0; }
  .remove { margin-top:10px; font-size:14px; }
  .confirm { display:flex; flex-wrap:wrap; align-items:center; gap:8px; color:var(--err); }
  .confirm span { flex:1 1 100%; }
  .mfa { margin-top:6px; }
  .add { margin-top:22px; padding-top:16px; border-top:1px solid var(--line); }
  .add .help { margin-top:8px; }
  .error { color:var(--err); margin:10px 0 0; font-size:15px; }
  .done h2 { margin:0 0 8px; }
  .top { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:28px; }
  .brand { font-weight:800; font-size:18px; letter-spacing:-0.01em; }
  .lang { display:flex; gap:4px; }
  .lang button { font:inherit; font-size:13px; padding:3px 10px; border-radius:999px; border:1px solid var(--line); background:transparent; color:var(--muted); cursor:pointer; }
  .lang button[aria-pressed="true"] { background:var(--yellow); border-color:var(--yellow); color:#1b2b34; font-weight:700; }
  .trust { list-style:none; margin:20px 0 0; padding:0; display:flex; flex-direction:column; gap:12px; }
  .trust li { display:flex; gap:12px; align-items:flex-start; }
  .trust svg { flex:none; width:22px; height:22px; margin-top:1px; fill:none; stroke:var(--teal); stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
  .trust strong { display:block; font-size:15px; line-height:1.35; }
  .trust span { display:block; font-size:14px; line-height:1.45; color:var(--muted); }
  .sent-to { font-size:13px; color:var(--muted); margin:6px 0 0; }
  .links a { color:var(--teal); }
  [hidden] { display:none !important; }
</style>
</head>
<body>
<main>
  <header class="top">
    <span class="brand">WilmAI</span>
    <span class="lang" role="group" aria-label="Kieli / Language">
      <button type="button" id="lang-fi" lang="fi">Suomi</button>
      <button type="button" id="lang-en" lang="en">English</button>
    </span>
  </header>
  <div class="layout">
  <div class="about">
  <h1 id="heading"></h1>
  <p id="intro"></p>
  <ul class="trust">
    <li><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg><div><strong id="trust-local-title"></strong><span id="trust-local"></span></div></li>
    <li><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg><div><strong id="trust-wilma-title"></strong><span id="trust-wilma"></span></div></li>
    <li><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg><div><strong id="trust-read-title"></strong><span id="trust-read"></span></div></li>
  </ul>
  </div>
  <div class="forms">
  <section class="card" id="wilmas">
    <div class="who-field">
      <span class="label" id="who-label"></span>
      <div class="who" role="group" aria-labelledby="who-label">
        <button type="button" id="who-guardian"></button>
        <button type="button" id="who-student"></button>
      </div>
      <p class="help" id="who-help"></p>
    </div>
    <div id="rows"></div>
    <p class="error" id="note" role="alert" hidden></p>
    <button class="primary" id="go" type="button"></button>
    <div class="add" id="add-box">
      <button class="secondary" id="add" type="button"></button>
      <p class="help" id="add-help"></p>
    </div>
  </section>
  <section class="card done" id="finished" hidden>
    <h2 id="finished-title"></h2>
    <p id="finished-body"></p>
  </section>
  </div>
  </div>
  <div class="foot">
  <p class="muted" id="privacy"></p>
  <p class="muted links"><a id="learn-more" href="https://github.com/aikarjal/wilmai#credentials--privacy" target="_blank" rel="noreferrer"></a> · <a id="source-code" href="https://github.com/aikarjal/wilmai" target="_blank" rel="noreferrer"></a></p>
  <p class="muted" id="disclaimer"></p>
  </div>
</main>
<script nonce="${nonce}">
(() => {
  const STRINGS = ${jsonForScript(strings)};
  const API = ${jsonForScript(opts.apiBase)};
  const CONFIG_PATH = ${jsonForScript(opts.configPath ?? "")};
  const OPENED_BY = ${jsonForScript(opts.openedBy ?? null)};
  // Every saved login, as the page opened and after each change here.
  let accounts = ${jsonForScript(opts.accounts ?? [])};
  // Opened with logins saved already: the page is for another Wilma, or logging in again.
  const more = accounts.length > 0;
  let lang = (navigator.language || "en").toLowerCase().startsWith("fi") ? "fi" : "en";
  let t = STRINGS[lang];
  // Rows being filled in: new Wilmas, and saved ones logging in again (replace: the saved login's id).
  let drafts = [];
  let lastId = 0;
  const newDraft = (replace = null, tenant = null, username = "") => ({ id: ++lastId, replace, tenant, username, password: "", totp: "", mfa: false, error: "" });
  if (!accounts.length) drafts.push(newDraft());
  let who = accounts.length && accounts.every((a) => a.role === "student") ? "student" : "guardian";
  let note = "";
  let busy = false;

  const $ = (id) => document.getElementById(id);
  const text = (id, value) => { $(id).textContent = value; };
  const hostOf = (url) => { try { return new URL(url).host; } catch { return url; } };
  const focus = (id) => setTimeout(() => $(id) && $(id).focus(), 0);
  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children.filter((child) => child !== null && child !== undefined));
    return node;
  };
  const post = async (path, body) => {
    const res = await fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return res.json();
  };
  const sameWilma = (a, b) => a.replace(/\\/$/, "").toLowerCase() === b.replace(/\\/$/, "").toLowerCase();
  // One login per Wilma, as in WilmAI Home: a Wilma another row has already is taken.
  const taken = (url, draft) =>
    accounts.some((a) => a.id !== draft.replace && sameWilma(a.url, url)) || drafts.some((d) => d !== draft && d.tenant && sameWilma(d.tenant.url, url));
  const filled = (d) => Boolean(d.tenant || d.username.trim() || d.password);

  // Every text on the page, in the chosen language (the switch at the top re-runs this).
  function applyText() {
    t = STRINGS[lang];
    document.documentElement.lang = lang;
    document.title = t.title;
    $("heading").replaceChildren(t.heading.split(" ").slice(0, -1).join(" ") + " ");
    const mark = document.createElement("mark"); mark.textContent = t.heading.split(" ").slice(-1)[0]; $("heading").append(mark);
    const intro = more ? (OPENED_BY ? t.introMoreApp : t.introMore) : OPENED_BY ? t.introApp : t.intro;
    text("intro", OPENED_BY ? intro.split("{app}").join(OPENED_BY.app) : intro);
    text("trust-local-title", t.trustLocalTitle); text("trust-local", t.trustLocal);
    text("trust-wilma-title", t.trustWilmaTitle);
    text("trust-read-title", t.trustReadTitle); text("trust-read", t.trustRead);
    text("who-label", t.who); text("who-guardian", t.parent); text("who-student", t.student);
    text("add", t.addAnother); text("add-help", t.addAnotherHint);
    text("finished-title", t.finishedTitle); text("finished-body", t.finishedBody);
    text("privacy", t.privacy.replace("{path}", CONFIG_PATH));
    text("learn-more", t.learnMore); text("source-code", t.sourceCode);
    text("disclaimer", t.disclaimer);
    for (const code of ["fi", "en"]) $("lang-" + code).setAttribute("aria-pressed", String(code === lang));
    render();
  }

  // The rows: each saved login (or its login form while logging in again), then the new ones.
  function render() {
    const box = $("rows");
    box.replaceChildren();
    for (const account of accounts) {
      const draft = drafts.find((d) => d.replace === account.id);
      box.append(draft ? draftRow(draft, t.school) : savedRow(account));
    }
    drafts.filter((d) => !d.replace).forEach((d, i) => box.append(draftRow(d, !accounts.length && i === 0 ? t.school : t.otherSchool)));
    for (const v of ["guardian", "student"]) $("who-" + v).setAttribute("aria-pressed", String(who === v));
    text("who-help", who === "guardian" ? t.whoParent : t.whoStudent);
    $("add-box").hidden = who !== "guardian";
    $("note").textContent = note; $("note").hidden = !note;
    showHost();
    updateGo();
  }

  function updateGo() {
    const go = $("go");
    go.disabled = busy;
    go.textContent = busy ? t.working : drafts.some(filled) || !accounts.length ? t.submit : t.done;
  }

  // Where the password goes, once a Wilma is picked.
  function showHost() {
    const hosts = [...new Set(drafts.filter((d) => d.tenant).map((d) => hostOf(d.tenant.url)))];
    text("trust-wilma", hosts.length === 1 ? t.trustWilmaHost.replace("{host}", hosts[0]) : t.trustWilma);
  }

  function savedRow(account) {
    const row = el("div", { className: "wilma-row" });
    const who_ = account.username + " · " + (account.role === "student" ? t.ownLogin : t.saved);
    row.append(el("div", { className: "wilma-head" },
      el("div", {}, el("b", { textContent: account.wilma }), el("small", { textContent: who_ })),
      el("button", { type: "button", className: "quiet", textContent: t.again, onclick: () => {
        const draft = newDraft(account.id, { url: account.url, name: account.wilma }, account.username);
        drafts.push(draft); note = ""; render(); focus("pass-" + draft.id);
      } })));
    const kids = account.children || [];
    if (!kids.length) row.append(el("p", { className: "help", textContent: t.noChildren }));
    else if (who === "guardian") {
      const group = el("div", { className: "kids" });
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", t.kidsLabel.replace("{school}", account.wilma));
      for (const kid of kids) {
        const tick = el("input", { type: "checkbox", checked: !kid.hidden });
        tick.addEventListener("change", () => setShown(account, kid.number, tick.checked));
        group.append(el("label", { className: "kid" }, tick, el("span", { textContent: kid.name })));
      }
      const names = kids.map((k) => k.name);
      const twice = names.find((name, i) => names.indexOf(name) !== i);
      if (twice) group.append(el("p", { className: "help", textContent: t.twice.replace("{name}", twice.split(" ")[0]) }));
      row.append(group);
    }
    if (accounts.length > 1) row.append(removeLink(account));
    return row;
  }

  // Remove asks first: the login goes, and its Wilma session ends.
  function removeLink(account) {
    const box = el("div", { className: "remove" });
    const link = el("button", { type: "button", className: "link", textContent: t.remove, onclick: () => {
      box.replaceChildren(el("div", { className: "confirm" },
        el("span", { textContent: t.removeAsk.replace("{school}", account.wilma) }),
        el("button", { type: "button", className: "danger", textContent: t.remove, onclick: () => remove(account) }),
        el("button", { type: "button", className: "quiet", textContent: t.cancel, onclick: () => box.replaceChildren(link) })));
    } });
    box.append(link);
    return box;
  }

  function draftRow(d, label) {
    const row = el("div", { className: "wilma-row new" });
    const fresh = drafts.filter((x) => !x.replace);
    if (d.replace || accounts.length || fresh.length > 1) {
      row.append(el("button", { type: "button", className: "quiet row-cancel", textContent: t.cancel, onclick: () => {
        drafts = drafts.filter((x) => x !== d);
        if (!accounts.length && !drafts.length) drafts.push(newDraft());
        note = ""; render();
      } }));
    }
    row.append(schoolField(d, label));
    const user = el("input", { id: "user-" + d.id, value: d.username, autocomplete: "username", autocapitalize: "none", spellcheck: false });
    user.addEventListener("input", () => { d.username = user.value; updateGo(); });
    const pass = el("input", { id: "pass-" + d.id, type: "password", value: d.password, autocomplete: "current-password" });
    pass.addEventListener("input", () => { d.password = pass.value; updateGo(); });
    pass.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    row.append(el("label", { htmlFor: user.id, textContent: t.username }), user, el("label", { htmlFor: pass.id, textContent: t.password }), pass);
    if (d.tenant) row.append(el("p", { className: "sent-to", textContent: t.sentTo.replace("{host}", hostOf(d.tenant.url)) }));
    if (d.mfa) {
      const key = el("input", { id: "totp-" + d.id, value: d.totp, autocomplete: "off", spellcheck: false });
      key.addEventListener("input", () => { d.totp = key.value; });
      key.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
      row.append(el("div", { className: "mfa" },
        el("span", { className: "label", textContent: t.mfaTitle }),
        el("p", { className: "muted", textContent: t.mfaBody }),
        el("label", { htmlFor: key.id, textContent: t.mfaLabel }), key,
        el("p", { className: "muted", textContent: t.mfaHelp })));
    }
    if (d.error) row.append(el("p", { className: "error", textContent: d.error }));
    return row;
  }

  function schoolField(d, label) {
    const box = el("div", { className: "school" });
    const id = "school-" + d.id;
    if (d.tenant) {
      box.append(el("span", { className: "label", textContent: label }), el("div", { className: "chosen" },
        el("div", {}, el("span", { textContent: d.tenant.name || d.tenant.url }), el("small", { textContent: d.tenant.url })),
        d.mfa ? null : el("button", { type: "button", className: "link", textContent: t.change, onclick: () => { d.tenant = null; d.error = ""; render(); focus(id); } })));
      return box;
    }
    const input = el("input", { id, autocomplete: "off", spellcheck: false, placeholder: t.schoolHint });
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    const results = el("ul", { className: "results", id: "results-" + d.id });
    results.setAttribute("role", "listbox");
    input.setAttribute("aria-controls", results.id);
    const help = el("p", { className: "help", textContent: t.schoolHelp });
    const chips = el("div", { className: "chips" });
    const none = el("p", { className: "muted", textContent: t.noResults, hidden: true });
    let seq = 0;
    let timer = null;
    let highlighted = 0;
    const pick = (tenant) => {
      d.error = taken(tenant.url, d) ? t.taken : "";
      if (!d.error) d.tenant = tenant;
      render();
      focus(d.tenant ? "user-" + d.id : id);
    };
    const highlight = (index) => {
      const buttons = [...results.querySelectorAll("button")];
      if (!buttons.length) return;
      highlighted = (index + buttons.length) % buttons.length;
      buttons.forEach((b, i) => { b.classList.toggle("hl", i === highlighted); b.setAttribute("aria-selected", String(i === highlighted)); });
      buttons[highlighted].scrollIntoView({ block: "nearest" });
    };
    const show = (list) => {
      results.replaceChildren();
      input.setAttribute("aria-expanded", String(list.length > 0));
      // While results are showing, the hint and city chips step aside so the list is easy to read.
      help.hidden = list.length > 0;
      chips.hidden = list.length > 0;
      for (const item of list) {
        const b = el("button", { type: "button", textContent: item.name || item.url }, el("small", { textContent: item.url.replace(/^https?:\\/\\//, "") }));
        b.setAttribute("role", "option");
        b.addEventListener("click", () => pick(item));
        results.append(el("li", {}, b));
      }
      highlight(0);
    };
    const search = async (q) => {
      const mine = ++seq;
      const trimmed = q.trim();
      if (/^https?:\\/\\//i.test(trimmed)) return show([{ url: trimmed.replace(/\\/$/, ""), name: trimmed.replace(/\\/$/, "") }]);
      if (!trimmed) { show([]); none.hidden = true; return; }
      const res = await fetch(API + "/tenants?q=" + encodeURIComponent(trimmed));
      if (!res.ok) throw new Error("search failed");
      const data = await res.json();
      if (mine !== seq) return;
      show(data.tenants || []);
      none.hidden = (data.tenants || []).length > 0;
    };
    const failed = () => { note = t.expired; render(); };
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => search(input.value).catch(failed), 150);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); highlight(highlighted + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); highlight(highlighted - 1); }
      else if (e.key === "Enter") { const b = results.querySelectorAll("button")[highlighted]; if (b) b.click(); }
    });
    for (const city of ["Helsinki", "Espoo", "Tampere", "Vantaa", "Oulu", "Turku", "Jyväskylä"]) {
      chips.append(el("button", { type: "button", textContent: city, onclick: () => { input.value = city; search(city).catch(failed); input.focus(); } }));
    }
    box.append(el("label", { htmlFor: id, textContent: label }), input, results, help, chips, none);
    return box;
  }

  // Log in every row filled in, one after another; with none, Done.
  async function submit() {
    if (busy) return;
    note = "";
    const ready = drafts.filter(filled);
    if (!ready.length) {
      if (accounts.length) return finish();
      note = t.missing; render(); return;
    }
    busy = true; updateGo();
    let first = null;
    for (const d of ready) {
      d.error = "";
      if (!d.tenant || !d.username.trim() || !d.password) { d.error = t.missing; first ??= d; continue; }
      try {
        const data = await post("/login", {
          tenantUrl: d.tenant.url, tenantName: d.tenant.name, username: d.username.trim(), password: d.password,
          totpSecret: d.totp.trim() || undefined, replace: d.replace || undefined,
        });
        if (data.status === "ok") { accounts = data.accounts; drafts = drafts.filter((x) => x !== d); continue; }
        first ??= d;
        if (data.status === "mfa_required") { d.mfa = true; continue; }
        if (data.code === "bad_totp") { d.mfa = true; d.error = lang === "fi" ? t.badTotp : data.message || t.badTotp; }
        else d.error = { bad_credentials: t.badCredentials, too_many_attempts: t.tooMany, missing_fields: t.missing, taken: t.taken }[data.code] || data.message || "Error";
      } catch {
        // The page stops after Done, a timeout, or too many attempts.
        note = t.expired;
        break;
      }
    }
    // Empty rows go once something is saved; a page with nothing saved keeps one to fill in.
    if (accounts.length) drafts = drafts.filter(filled);
    busy = false;
    render();
    if (first && drafts.includes(first)) focus(first.mfa ? "totp-" + first.id : "pass-" + first.id);
    else focus("go");
  }

  async function finish() {
    busy = true; updateGo();
    try {
      const data = await post("/done", {});
      if (data.status !== "ok") { note = data.message || t.expired; busy = false; render(); return; }
    } catch {
      // The page may already have closed; the logins are saved either way.
    }
    $("wilmas").hidden = true; $("finished").hidden = false;
  }

  async function change(path, body) {
    try {
      const data = await post(path, body);
      if (data.status === "ok") accounts = data.accounts;
      else note = data.message || t.expired;
    } catch {
      note = t.expired;
    }
    render();
  }

  // A child unticked isn't read (a profile Wilma lists twice); ticking it again reads it again.
  const setShown = (account, number, shown) =>
    change("/children", { id: account.id, hidden: account.children.filter((k) => (k.number === number ? !shown : k.hidden)).map((k) => k.number) });

  async function remove(account) {
    drafts = drafts.filter((d) => d.replace !== account.id);
    await change("/remove", { id: account.id });
    if (!accounts.length && !drafts.length) { drafts.push(newDraft()); render(); }
  }

  for (const v of ["guardian", "student"]) {
    $("who-" + v).addEventListener("click", () => {
      note = "";
      if (v === "student" && accounts.length + drafts.filter((d) => !d.replace).length > 1) note = t.oneWilma;
      else who = v;
      render();
    });
  }
  for (const code of ["fi", "en"]) $("lang-" + code).addEventListener("click", () => { lang = code; applyText(); });
  $("add").addEventListener("click", () => {
    const draft = newDraft();
    drafts.push(draft); note = ""; render(); focus("school-" + draft.id);
  });
  $("go").addEventListener("click", () => submit());
  applyText();
  focus(drafts.length ? "school-" + drafts[0].id : "go");
})();
</script>
</body>
</html>`;
}
