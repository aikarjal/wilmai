/*
 * The screens of the Home page's hero tour (components/HomeTour.tsx), taken from WilmAI Home itself: the app's
 * development build with the made-up sample family, in its light theme, No AI, the clock frozen on a school-day
 * morning, at 1305×816 CSS px and 2× pixels. Nothing is edited by hand afterwards. In English the family is shown
 * translated into English, as Settings → Translating messages does it: the sample family comes with its English
 * (apps/home/src/demo), so that needs no AI.
 *
 * It writes, for each language, public/home-tour/<lang>/<screen>.webp (2×, lossless: what a large display shows)
 * and <screen>-1x.webp (1×, for phones), and lib/home-tour.json: each screen's size and where its parts are, in 2× px.
 * The tour moves and lifts those parts, so a new capture keeps it right without measuring anything.
 *
 * The site's other pictures of the app come from the same run: public/home-today-<lang>.png (Today whole: the Home
 * page's share image and the front page's card), home-thumb-<lang>.png (the banner), home-parent-<lang>.png (both
 * children's week) and home-student-<lang>.png (a student's own Today), and the main README's assets/readme-home-top.png.
 *
 * Run it after the app's look changes (Google Chrome drives it; nothing is downloaded):
 *   pnpm --filter @wilm-ai/site capture:home-tour
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import sharp from "sharp";

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOME = resolve(SITE, "../home");
const README_TOP = resolve(SITE, "../../assets/readme-home-top.png");
const PORT = 5197;
const APP = `http://127.0.0.1:${PORT}/`;
const W = 1305, H = 816, DPR = 2;
// A Wednesday morning in a school week: the sample family is built around "today".
const NOW = new Date("2026-10-21T09:40:00+03:00");
const LANGS = { en: "en-GB", fi: "fi-FI" };
/** Each language's settings on top of the common ones, the message opened and answered, and the search. */
const IN = {
  en: { settings: { translateTo: "en" }, message: "School starts at 10.15 tomorrow", reply: "Thank you for letting me know!", search: "exam" },
  fi: { settings: {}, message: "Huomenna koulu alkaa", reply: "Kiitos tiedosta!", search: "koe" },
};

/** The app's dev server, on a port of its own, for as long as the capture runs. */
async function startApp() {
  const vite = spawn("pnpm", ["--dir", HOME, "exec", "vite", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { stdio: "ignore", detached: true });
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(APP)).ok) return vite;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  process.kill(-vite.pid);
  throw new Error("WilmAI Home's dev server didn't start");
}

/**
 * Where elements are on the page, in 2× px of the whole page: [x0, y0, x1, y1] each. A selector ending in " @in <box>"
 * keeps only the ones wholly inside that box (rows in a scrolled list, say).
 */
function rectsOf(page, selector) {
  return page.evaluate(
    ([spec, dpr]) => {
      const [sel, within] = spec.split(" @in ");
      const box = within ? document.querySelector(within).getBoundingClientRect() : null;
      return [...document.querySelectorAll(sel)]
        .map((n) => n.getBoundingClientRect())
        .filter((r) => !box || (r.top >= box.top && r.bottom <= box.bottom))
        .map((r) => [r.left + scrollX, r.top + scrollY, r.right + scrollX, r.bottom + scrollY].map((v) => Math.round(v * dpr)));
    },
    [selector, DPR]
  );
}

/** Where the text typed into a field sits: its first line, from the field's padding to the text's end, in 2× px. */
function typedIn(page, selector) {
  return page.evaluate(
    ([sel, dpr]) => {
      const field = document.querySelector(sel);
      const css = getComputedStyle(field);
      // The words' width as the page draws them: a canvas given the field's font shorthand fell back to its own
      // small default and measured two thirds of it.
      const probe = document.createElement("span");
      probe.textContent = field.value;
      for (const p of ["fontFamily", "fontSize", "fontWeight", "fontStyle", "fontStretch", "fontVariant", "fontFeatureSettings", "fontVariationSettings", "letterSpacing", "wordSpacing"]) probe.style[p] = css[p];
      Object.assign(probe.style, { position: "absolute", visibility: "hidden", whiteSpace: "pre" });
      document.body.appendChild(probe);
      const width = probe.getBoundingClientRect().width;
      probe.remove();
      const r = field.getBoundingClientRect();
      const x0 = r.left + parseFloat(css.borderLeftWidth) + parseFloat(css.paddingLeft);
      const y0 = r.top + parseFloat(css.borderTopWidth) + parseFloat(css.paddingTop);
      const line = parseFloat(css.lineHeight) || parseFloat(css.fontSize) * 1.4;
      return [[x0, y0, x0 + width + 2, y0 + line].map((v, i) => Math.round((v + (i % 2 ? scrollY : scrollX)) * dpr))];
    },
    [selector, DPR]
  );
}

const manifest = {};

async function capture(lang, locale) {
  const out = resolve(SITE, "public/home-tour", lang);
  await mkdir(out, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, colorScheme: "light", locale, timezoneId: "Europe/Helsinki" });
  // The app's language, the light theme, and No AI chosen (so the menu has no "Choose AI" cue); in English, translating
  // into English.
  const words = IN[lang];
  await context.addInitScript(([language, extra]) => {
    if (!localStorage.getItem("wilmai.settings")) localStorage.setItem("wilmai.settings", JSON.stringify({ language, theme: "light", aiProvider: "off", ...extra }));
  }, [lang, words.settings]);
  const page = await context.newPage();
  await page.clock.setFixedTime(NOW);
  await page.goto(APP);
  await page.locator(".wilmas-foot .linkish").click(); // Look around with a sample family
  await page.locator(".nav").waitFor();
  // Still: no transitions, carets or animations; and the menu's foot (the sample family's way out, the version) left
  // out, so Settings sits at the menu's foot as it does for a signed-in family.
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; } .nav-wilmas-wrap, .nav-meta { display: none !important; }" });

  const plates = {};
  /** One screen: the window (or the whole page, `full`), and its parts (a selector, or a function of the page). */
  async function shot(name, parts, { full = false } = {}) {
    await page.waitForTimeout(500);
    const png = await page.screenshot({ fullPage: full });
    const meta = await sharp(png).metadata();
    await sharp(png).webp({ lossless: true, effort: 6 }).toFile(resolve(out, `${name}.webp`));
    // Downscaled, lossless is larger than lossy at this quality, and a phone can't tell them apart.
    await sharp(png).resize(Math.round(meta.width / DPR)).webp({ quality: 88, effort: 6 }).toFile(resolve(out, `${name}-1x.webp`));
    const rects = {};
    for (const [key, part] of Object.entries(parts)) rects[key] = typeof part === "function" ? await part(page) : await rectsOf(page, part);
    plates[name] = { w: meta.width, h: meta.height, rects };
    console.log(`${lang}/${name}: ${meta.width}×${meta.height}`, Object.fromEntries(Object.entries(rects).map(([k, v]) => [k, v.length])));
  }

  const go = async (hash) => {
    await page.evaluate((h) => { location.hash = h; }, hash);
    await page.waitForTimeout(400);
  };

  /** A still of the window (or the whole page) as a PNG, for the site's pictures and the README. */
  const png = async (full = false) => {
    await page.waitForTimeout(500);
    return page.screenshot({ fullPage: full });
  };
  const savePng = (image, file) => sharp(image).png({ compressionLevel: 9 }).toFile(file);

  // Today, the whole page (the tour scrolls it): the summary, each child's school day, and what needs you.
  await go("#/today");
  await shot("today", { main: ".main", days: ".sd-row", needs: ".card.needs" }, { full: true });
  // The same page for the site and the README: whole, its top for the banner (1305×870 at 480×320), and in English
  // the README's top strip (1305×372 at 2×).
  const today = await png(true);
  await savePng(today, resolve(SITE, `public/home-today-${lang}.png`));
  await sharp(today).extract({ left: 0, top: 0, width: W * DPR, height: 870 * DPR }).resize(480, 320).png({ compressionLevel: 9 }).toFile(resolve(SITE, `public/home-thumb-${lang}.png`));
  if (lang === "en") await sharp(today).extract({ left: 0, top: 0, width: W * DPR, height: 372 * DPR }).png({ compressionLevel: 9 }).toFile(README_TOP);

  // The inbox where messages and bulletins mix, and an answer being written to today's message from a teacher (short,
  // so the whole of it shows with the answer under it).
  await go("#/inbox");
  await page.locator(".inbox-list a.row").filter({ hasText: words.message }).first().click();
  await page.locator(".reader-wrap .body").first().waitFor();
  await page.keyboard.press("r"); // Reply
  await page.locator(".composer textarea").waitFor();
  await page.locator(".composer textarea").fill(words.reply);
  await page.evaluate(() => {
    document.querySelector(".composer").scrollIntoView({ block: "nearest" });
    // the list where messages and bulletins mix: the first bulletin a little over halfway down
    const list = document.querySelector(".inbox-list");
    const news = list.querySelector("a.row.kind-news");
    list.scrollTop += news.getBoundingClientRect().top - list.getBoundingClientRect().top - list.clientHeight * 0.6;
  });
  await shot("message", {
    main: ".main",
    lines: ".inbox-list .group-head, .inbox-list a.row @in .inbox-list",
    news: ".inbox-list a.row.kind-news @in .inbox-list",
    composer: ".composer",
    typed: (p) => typedIn(p, ".composer textarea"),
  });

  // Search everything with ⌘K, over Today.
  await go("#/today");
  await page.keyboard.press("Meta+k");
  await page.locator(".cmdk-search").waitFor();
  await page.keyboard.type(words.search, { delay: 30 });
  await shot("search", { main: ".main", menu: "dialog.cmdk", input: ".cmdk-search input", query: (p) => typedIn(p, ".cmdk-search input"), lines: ".cmdk-group, .cmdk-item" });
  await page.keyboard.press("Escape");

  // Both children's week side by side, as a parent sees it (the site's picture), then with today's first lesson
  // clicked: its day's schedule opens beside the week.
  await go("#/week");
  await savePng(await png(), resolve(SITE, `public/home-parent-${lang}.png`));
  await page.locator(".week .col.is-today .les").first().click();
  await page.locator(".details-docked .dp-top").waitFor();
  await shot("week", {
    main: ".main",
    cols: ".week .col",
    picked: ".week .col.is-today .les",
    day: ".details-docked .details-head, .details-docked .dp-top, .details-docked .dp-tl",
  });

  // Grades.
  await go("#/grades");
  await shot("grades", { main: ".main", rows: ".xs-row" });

  // A student's own Today (the site's picture): Kiia picked and the app read as the student. A student's own login
  // has one child, so no children's picker (the sample family has two).
  await go("#/today");
  await page.locator(".kids button", { hasText: "Kiia" }).first().click();
  await page.evaluate(async () => (await import("/src/data/store.ts")).setViewAs("student"));
  await page.addStyleTag({ content: ".topbar .kids { visibility: hidden !important; }" });
  await savePng(await png(), resolve(SITE, `public/home-student-${lang}.png`));

  manifest[lang] = plates;
  await browser.close();
}

const app = await startApp();
try {
  for (const [lang, locale] of Object.entries(LANGS)) await capture(lang, locale);
  await writeFile(resolve(SITE, "lib/home-tour.json"), `${JSON.stringify({ window: [W * DPR, H * DPR], ...manifest })}\n`);
} finally {
  process.kill(-app.pid);
}
