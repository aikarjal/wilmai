#!/usr/bin/env node
/*
 * Turn real Wilma pages into test fixtures that keep the markup and drop the
 * people. Every word that isn't a date, time, number, course code or a Wilma
 * label is replaced with a made-up word of the same length (the same word maps
 * to the same stand-in everywhere in one run, so an HTML page and a JSON
 * response of the same week still agree). Long numbers (student numbers, ids)
 * are remapped, links point to example.com, and scripts, forms and e-mail
 * addresses are removed.
 *
 *   node scripts/anonymize-fixture.mjs <in> <out> [--keep <css>] [--allow <css>]... [<in> <out> ...]
 *
 * --keep   keep only these elements of an HTML page (default: the whole body)
 * --allow  also keep the words found in these elements (e.g. a legend of
 *          generic labels); applies to every file in the run
 * JSON files (by extension) are walked; string fields ending in "Html" are
 * treated as HTML.
 *
 * Always read the result before committing it.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import * as cheerio from "cheerio";

// Wilma's own labels that parsers rely on, plus weekday abbreviations.
const WILMA_WORDS = new Set(
  `julkaistu pysyvät vanhat tiedotteet tiedote yhteensä päivämäärä huomioita arvosana laajuus suorituspäivä
   oppimäärä tai kurssi tulostettava versio opettaja kokeen lisätiedot lähettäjä vastaanottajat lähetetty klo
   ma ti ke to pe la su wilma`
    .split(/\s+/)
    .filter(Boolean)
);
const SALT = randomBytes(16);
const allowed = new Set();
const numberMap = new Map();

function hash(value) {
  return createHash("sha256").update(SALT).update(value).digest();
}

const CONSONANTS = "bdfghjklmnprstv";
const VOWELS = "aeiouy";
function fakeWord(word) {
  const bytes = hash(word.toLowerCase());
  let out = "";
  for (let i = 0; out.length < word.length; i += 1) {
    out += i % 2 === 0 ? CONSONANTS[bytes[i % 32] % CONSONANTS.length] : VOWELS[bytes[i % 32] % VOWELS.length];
  }
  out = out.slice(0, word.length);
  if (word === word.toUpperCase() && word.length > 1) return out.toUpperCase();
  if (word[0] === word[0].toUpperCase()) return out[0].toUpperCase() + out.slice(1);
  return out;
}

function fakeNumber(digits) {
  if (!numberMap.has(digits)) {
    const bytes = hash(digits);
    let out = "";
    for (let i = 0; out.length < digits.length; i += 1) out += String(bytes[i % 32] % 10);
    if (digits[0] !== "0" && out[0] === "0") out = "1" + out.slice(1);
    numberMap.set(digits, out);
  }
  return numberMap.get(digits);
}

const DATE_OR_TIME = /^(\d{1,2}\.\d{1,2}\.(\d{2,4})?|\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?|\d{1,2}[:.]\d{2})$/;
const COURSE_CODE = /^[\p{Lu}\p{Ll}\d]*_[\p{L}\d._]*$/u;

/** Anonymize free text, keeping its shape. */
export function anonymizeText(text) {
  return text.replace(/[\p{L}\p{N}_.:-]+/gu, (token) => {
    const bare = token.replace(/[.:-]+$/u, "");
    const tail = token.slice(bare.length);
    if (!bare) return token;
    if (DATE_OR_TIME.test(bare) || DATE_OR_TIME.test(token)) return token;
    if (/^\d{1,3}$/.test(bare)) return token;
    if (/^\d+$/.test(bare)) return fakeNumber(bare) + tail;
    if (COURSE_CODE.test(bare)) return token;
    const lower = bare.toLowerCase();
    if (WILMA_WORDS.has(lower) || allowed.has(lower)) return token;
    return bare
      .split(/([.:-])/)
      .map((part) => (/^[.:-]$/.test(part) || !part ? part : /^\d+$/.test(part) ? (part.length > 3 ? fakeNumber(part) : part) : fakeWord(part)))
      .join("") + tail;
  });
}

function anonymizeUrl(value) {
  if (/^(javascript|mailto|tel):/i.test(value)) return "#";
  if (/email-protection/.test(value)) return "#";
  let url = value.replace(/\d{4,}/g, (digits) => fakeNumber(digits));
  if (/^https?:\/\//i.test(url)) {
    const parsed = new URL(url);
    const extension = /\.[a-z0-9]{2,5}$/i.exec(parsed.pathname)?.[0] ?? "";
    const path = parsed.pathname
      .replace(/\.[a-z0-9]{2,5}$/i, "")
      .split("/")
      .map((part) => (part && !/^!?\d+$/.test(part) ? fakeWord(part.replace(/[^\p{L}\d]/gu, "x")) : part))
      .join("/");
    url = `${parsed.protocol}//example.com${path}${extension}${parsed.search ? "?" + anonymizeText(parsed.search.slice(1)) : ""}`;
  }
  return url;
}

export function anonymizeHtml(html, keep) {
  const $ = cheerio.load(html);
  $("script, style, noscript, iframe, form input, form select, form textarea, svg, link, meta").remove();
  $("*").contents().filter((_, node) => node.type === "comment").remove();
  const title = $("title").text();
  const kept = keep ? $(keep) : $("body").children();
  const out = cheerio.load(`<!DOCTYPE html><html><head><title></title></head><body></body></html>`);
  out("title").text(anonymizeText(title));
  kept.each((_, el) => out("body").append($.html(el)));

  out("*").each((_, el) => {
    for (const [name, value] of Object.entries(el.attribs ?? {})) {
      if (name.startsWith("data-") || name.startsWith("on") || name === "style" || name === "value") out(el).removeAttr(name);
      else if (name === "href" || name === "src" || name === "action") out(el).attr(name, anonymizeUrl(value));
      else if (name === "title" || name === "alt" || name === "aria-label" || name === "placeholder") out(el).attr(name, anonymizeText(value));
      else if (name === "id" || name === "class" || name === "colspan" || name === "rowspan" || name === "type" || name === "name") continue;
      else out(el).removeAttr(name);
    }
  });
  out("body *")
    .contents()
    .filter((_, node) => node.type === "text")
    .each((_, node) => {
      node.data = anonymizeText(node.data);
    });
  return out.html();
}

export function anonymizeJson(value, key = "") {
  if (Array.isArray(value)) return value.map((item) => anonymizeJson(item, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, anonymizeJson(v, k)]));
  }
  if (typeof value === "string") {
    if (/html$/i.test(key)) return anonymizeHtml(value).replace(/^[\s\S]*<body>|<\/body>[\s\S]*$/g, "");
    return anonymizeText(value);
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 1000) return Number(fakeNumber(String(value)));
  return value;
}

async function main(argv) {
  const jobs = [];
  const allowSelectors = [];
  let keep = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--keep") keep = argv[++i];
    else if (argv[i] === "--allow") allowSelectors.push(argv[++i]);
    else {
      jobs.push({ input: argv[i], output: argv[i + 1], keep });
      keep = null;
      i += 1;
    }
  }
  if (!jobs.length) {
    console.error("Usage: anonymize-fixture.mjs <in> <out> [--keep <css>] [--allow <css>]...");
    process.exit(1);
  }
  const sources = await Promise.all(jobs.map((job) => readFile(job.input, "utf8")));
  // Words from --allow regions (e.g. generic labels) stay readable in every file.
  for (const source of sources) {
    if (source.trimStart().startsWith("{") || source.trimStart().startsWith("[")) continue;
    const $ = cheerio.load(source);
    for (const selector of allowSelectors) {
      $(selector).each((_, el) => {
        for (const word of $(el).text().toLowerCase().match(/[\p{L}]+/gu) ?? []) allowed.add(word);
      });
    }
  }
  for (const [index, job] of jobs.entries()) {
    const source = sources[index];
    const isJson = /\.json$/i.test(job.input);
    const result = isJson ? JSON.stringify(anonymizeJson(JSON.parse(source)), null, 1) : anonymizeHtml(source, job.keep);
    await writeFile(job.output, result + "\n");
    console.log(`${job.input} -> ${job.output} (${result.length} bytes)`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main(process.argv.slice(2));
}
