/*
 * The eval suite for the app's reading: the app's own code (the same question
 * sets, the same prompts, the same calendar code) run on fixed cases with
 * known right answers (evals/cases/*.json, see evals/README.md), under named
 * configurations (evals/configs.json: which models read and decide, how).
 *
 * Each case is a small family on a fixed day: messages, bulletins, teachers'
 * notes and exam marks. The runner builds the app's state from it, runs the
 * decisions (runJev: triage, tone, marks) and the reading (runLuna: the
 * guardian's step and its deadline, the calendar's dates), then checks what
 * the app would show: needs-you, the step, the marks as shown, the calendar.
 *
 *   op run --env-file evals/keys.env -- pnpm eval                          # the default config (luna-low)
 *   op run --env-file evals/keys.env -- pnpm eval --config gated --repeat 3
 *   op run --env-file evals/keys.env -- pnpm eval --matrix --repeat 3      # every config marked "matrix", side by side (in parallel)
 *   op run --env-file evals/keys.env -- pnpm eval --matrix --save-baseline # their results become the baselines (evals/baselines/)
 *   pnpm eval --matrix --accept                                            # or accept the latest results afterwards (no calls)
 *   pnpm eval --config a,b,c --summarize                                   # the latest results of these configs side by side (no calls)
 *   pnpm eval --check                                                      # the cases are well formed (no keys, no calls)
 *   pnpm eval --only makeup-exam-note,autumn-holiday --tag whose           # some cases (by id, by tag)
 *   pnpm eval --fail-under 0.95 --fail-on-regression                      # for CI: exit 1 below the bar or worse than the baseline
 *
 * Ad hoc instead of a config: --model, --effort, --strategy fixed|gated|tiered,
 * --sol, --jev. Keys come from the environment (OPENAI_API_KEY, JEV_API_KEY),
 * never from files in the repo; results go to evals/results/ (not in git).
 */
import { RealDate, setNow } from "./shim.ts";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const list = (name: string) => (arg(name) ?? "").split(",").filter(Boolean);
const only = list("--only");
const tagsWanted = list("--tag");
const repeat = Math.max(1, Number(arg("--repeat") ?? 1) || 1);
const failUnder = arg("--fail-under") !== undefined ? Number(arg("--fail-under")) : null;

/** A way the app can read: who decides, which model reads, how (evals/configs.json). */
interface EvalConfig {
  label: string;
  decider?: "luna" | "jev";
  localDecisions?: boolean;
  localReading?: boolean;
  localProfile?: "small" | "medium";
  localThink?: boolean;
  decisionsModel?: string;
  readingStrategy: "fixed" | "gated" | "tiered";
  readingModel: string;
  readingEffort?: "low" | "medium" | "high";
  escalateToSol?: boolean;
  /** Experiments with more of the decisions (Settings.lunaChecks): choices, fields, crossItem. */
  checks?: { choices?: boolean; fields?: boolean; crossItem?: boolean };
  matrix?: boolean;
}
const configsFile = JSON.parse(readFileSync(join(here, "configs.json"), "utf8")) as Record<string, EvalConfig | string>;
const named = Object.fromEntries(Object.entries(configsFile).filter((e): e is [string, EvalConfig] => typeof e[1] === "object"));
const adHoc = ["--model", "--effort", "--strategy", "--sol", "--jev"].some((f) => args.includes(f));
const strategyArg = arg("--strategy");
const configs: [string, EvalConfig][] = args.includes("--matrix")
  ? Object.entries(named).filter(([, c]) => c.matrix)
  : arg("--config")
    ? list("--config").map((n): [string, EvalConfig] => {
        if (!named[n]) throw new Error(`No config "${n}" in evals/configs.json (${Object.keys(named).join(", ")})`);
        return [n, named[n]];
      })
    : adHoc
      ? [
          [
            "custom",
            {
              label: "Ad hoc",
              decider: args.includes("--jev") ? "jev" : "luna",
              readingStrategy: strategyArg === "gated" || strategyArg === "tiered" ? strategyArg : "fixed",
              readingModel: arg("--model") ?? "gpt-6-luna",
              readingEffort: (arg("--effort") as EvalConfig["readingEffort"]) ?? "low",
              escalateToSol: args.includes("--sol"),
            },
          ],
        ]
      : [["luna-low", named["luna-low"]]];

const { overrideBridge } = await import("../src/wilma/transport.ts");
const store = await import("../src/data/store.ts");
const { DEFAULT_SETTINGS } = await import("../src/data/model.ts");
const { runJev } = await import("../src/jev/runner.ts");
const { runLuna, lunaBacklog } = await import("../src/luna/events.ts");
const { READING_MODELS, costOf, totalUsage } = await import("../src/luna/client.ts");
const { LOCAL_MODEL_PROFILES } = await import("../src/ai/config.ts");
const { checkOllama, probeOllama } = await import("../src/ai/ollama.ts");
const { forwardToAnthropic, forwardToOllama } = await import("../bridge/core.ts");
for (const [name, cfg] of configs) {
  if (Boolean(cfg.localDecisions) !== Boolean(cfg.localReading)) throw new Error(`${name}: choose fully local or fully cloud intelligence; mixed providers are not supported.`);
  if (cfg.localProfile && !LOCAL_MODEL_PROFILES[cfg.localProfile]) throw new Error(`${name}: unknown local model profile ${cfg.localProfile}`);
  if (!cfg.localReading && !READING_MODELS[cfg.readingModel]) throw new Error(`${name}: not a reading model: ${cfg.readingModel} (${Object.keys(READING_MODELS).join(", ")})`);
}

const OPENAI_KEY = process.env.OPENAI_API_KEY ?? "";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? "";
/** A config reads with Claude when its reading model is Anthropic's (decisions then go to Claude too). */
const claudeConfig = (cfg: EvalConfig) => !cfg.localReading && READING_MODELS[cfg.readingModel]?.provider === "anthropic";
const JEV_KEY = process.env.JEV_API_KEY ?? "";

// The app's bridge calls go straight to OpenAI, Anthropic and Jev with the keys from the environment.
overrideBridge(async (path, init) => {
  const send = async (url: string, key: string) => {
    const resp = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(init.body) });
    return { status: resp.status, retryAfter: resp.headers.get("retry-after"), body: await resp.text() };
  };
  if (path === "openai") return send(`https://api.openai.com${init.headers?.["x-openai-path"]}`, OPENAI_KEY);
  if (path === "anthropic") return forwardToAnthropic(ANTHROPIC_KEY, init.body);
  if (path === "jev") return send("https://api.typesafe.ai/v1/systemone", JEV_KEY);
  if (path === "ollama") return forwardToOllama(init.body as Parameters<typeof forwardToOllama>[0]);
  return { error: `The eval suite has no route ${path}`, status: 404 };
});

// ---- Cases (evals/lib.ts) ----
const { loadSuite, snapshotOf, scoreCase, at } = await import("./lib.ts");
type Case = import("./lib.ts").Case;
type Check = import("./lib.ts").Check;
const cases: Case[] = loadSuite(here).filter(
  (c) => (!only.length || only.includes(c.id)) && (!tagsWanted.length || (c.tags ?? []).some((t) => tagsWanted.includes(t)))
);

// --check: the cases are well formed (no keys, no calls). Run it after writing a case.
if (args.includes("--check")) {
  const problems: string[] = [];
  const isDate = (d: unknown) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(RealDate.parse(d));
  const ids = new Set<string>();
  for (const c of cases) {
    const say = (what: string) => problems.push(`${c.id}: ${what}`);
    if (ids.has(c.id)) say("the id is used twice");
    ids.add(c.id);
    if (!c.why) say("no why");
    if (!c.tags?.length) say("no tags");
    if (!isDate(c.today)) say(`today isn't a date: ${c.today}`);
    const items = new Map(c.items.map((i) => [i.id, i]));
    if (items.size !== c.items.length) say("an item id is used twice");
    const need = (id: number, types: string[], task: string) => {
      const item = items.get(id);
      if (!item) say(`${task}: no item ${id}`);
      else if (!types.includes(item.type)) say(`${task}: item ${id} is a ${item.type}`);
    };
    for (const i of c.items) {
      const pupils = i.type === "message" || i.type === "news" ? i.pupils : [i.pupil];
      for (const p of pupils) if (!c.pupils[p]) say(`item ${i.id}: no pupil ${p}`);
      if (i.type === "note" || i.type === "mark" || i.type === "exam" || i.type === "lesson") if (!isDate(i.date)) say(`item ${i.id}: the date isn't a date`);
    }
    for (const t of c.expect.triage ?? []) need(t.item, ["message", "news"], "triage");
    for (const t of c.expect.action ?? []) need(t.item, ["message", "news"], "action");
    for (const t of c.expect.noteExam ?? []) {
      need(t.item, ["note"], "noteExam");
      if (t.date !== undefined && t.date !== null && !isDate(t.date)) say("noteExam: bad resolved date");
      if (t.originalExam !== undefined && t.originalExam !== null) need(t.originalExam, ["exam"], "noteExam original exam");
    }
    for (const t of c.expect.tone ?? []) need(t.item, ["note"], "tone");
    for (const t of c.expect.noteKind ?? []) {
      need(t.item, ["note"], "noteKind");
      if (!["praise", "absence", "late", "forgot", "remark", "other"].includes(t.kind)) say(`noteKind: no kind ${t.kind}`);
    }
    for (const t of c.expect.marks ?? []) need(t.item, ["mark"], "marks");
    const cal = c.expect.calendar;
    for (const e of cal?.events ?? []) {
      if (!isDate(e.date) || (e.endDate !== undefined && !isDate(e.endDate))) say(`calendar: a bad date ${e.date}${e.endDate ? `–${e.endDate}` : ""}`);
      if (e.date < c.today) say(`calendar: ${e.date} is before today (the calendar starts today)`);
      if (e.pupil !== undefined && !c.pupils[e.pupil]) say(`calendar: no pupil ${e.pupil}`);
      if (e.start !== undefined && !/^\d{2}:\d{2}$/.test(e.start)) say(`calendar: a start is written HH:MM (${e.start})`);
    }
    for (const n of cal?.not ?? []) if (!isDate(n.date)) say(`calendar: a bad date ${n.date}`);
    for (const n of cal?.atMost ?? []) if (!isDate(n.date) || !(n.max >= 0)) say(`calendar: atMost needs a date and a max (${n.date})`);
    for (const t of cal?.titlesNot ?? []) {
      try {
        new RegExp(t, "i");
      } catch {
        say(`calendar: not a regular expression: ${t}`);
      }
    }
    if (!Object.keys(c.expect).length) say("expects nothing");
  }
  const tagCount = new Map<string, number>();
  for (const c of cases) for (const t of c.tags ?? []) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
  console.log(`${cases.length} cases. Tags: ${[...tagCount].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(", ")}`);
  if (problems.length) {
    console.log(problems.map((p) => `- ${p}`).join("\n"));
    process.exit(1);
  }
  console.log("The cases are well formed.");
  process.exit(0);
}

// --accept: the latest results of these configs (--config, --matrix; else every config with results) become their baselines. No calls.
if (args.includes("--accept")) {
  const names = arg("--config") || args.includes("--matrix") ? configs.map(([n]) => n) : Object.keys(named);
  mkdirSync(join(here, "baselines"), { recursive: true });
  for (const name of names) {
    const from = join(here, "results", `latest-${name}.json`);
    if (!existsSync(from)) continue;
    const summary = JSON.parse(readFileSync(from, "utf8")) as { all: { ok: number; n: number }; repeat: number; at: string };
    writeFileSync(join(here, "baselines", `${name}.json`), readFileSync(from, "utf8").trimEnd() + "\n");
    console.log(`${name}: the run of ${summary.at.slice(0, 16).replace("T", " ")} (${summary.repeat} runs, ${Math.round((100 * summary.all.ok) / summary.all.n)} %) is the baseline`);
  }
  process.exit(0);
}

const allLocal = (cfg: EvalConfig) => cfg.localDecisions && cfg.localReading;
const localProfiles = [...new Set(configs.filter(([, c]) => allLocal(c)).map(([, c]) => c.localProfile ?? "small"))];
if (localProfiles.length > 1) throw new Error("Evaluate one local model pack at a time so its runtime and memory results are unambiguous.");
const localPack = LOCAL_MODEL_PROFILES[localProfiles[0] ?? "small"];
const localSettings = { ...DEFAULT_SETTINGS, localAI: { endpoint: process.env.WILMAI_OLLAMA_URL ?? "http://127.0.0.1:11434", decisionModel: localPack.decision, readingModel: localPack.reading } };
if (!OPENAI_KEY && !args.includes("--summarize") && configs.some(([, c]) => !allLocal(c))) throw new Error("OPENAI_API_KEY isn't set (op run --env-file evals/keys.env -- pnpm eval)");
if (configs.some(([, c]) => c.decider === "jev") && !JEV_KEY) throw new Error("JEV_API_KEY isn't set (a config has Jev decide)");
const localStatus = !args.includes("--summarize") && configs.some(([, c]) => c.localDecisions || c.localReading)
  ? await checkOllama(localSettings) : null;
if (localStatus) await probeOllama(localSettings);

async function runCase(
  c: Case,
  cfg: EvalConfig
): Promise<{ checks: Check[]; events: Record<string, string[]>; routes: Route[]; cost: number; ms: number; items: number; readings: Record<string, unknown>; decisions: Record<string, unknown> }> {
  const started = RealDate.now();
  setNow(at(c.today).getTime());
  const snap = snapshotOf(c);
  store.setState({
    snapshot: snap,
    jev: {},
    jevBaseline: {},
    luna: {},
    usage: {},
    local: { opened: {}, done: {} },
    settings: {
      ...DEFAULT_SETTINGS,
      aiProvider: allLocal(cfg) ? "local" : claudeConfig(cfg) ? "anthropic" : "openai",
      openaiKey: OPENAI_KEY ? "from the environment" : "",
      anthropicKey: ANTHROPIC_KEY ? "from the environment" : "",
      jevKey: JEV_KEY ? "from the environment" : "",
      decider: cfg.localDecisions ? "local" : cfg.decider ?? "luna",
      decisionsModel: cfg.decisionsModel,
      readingModel: cfg.localReading ? localPack.reading : cfg.readingModel,
      localAI: { ...localSettings.localAI, fingerprint: localStatus?.fingerprint, think: cfg.localThink ?? true },
      readingEffort: cfg.readingEffort ?? "low",
      readingStrategy: cfg.readingStrategy,
      escalateToSol: Boolean(cfg.escalateToSol),
      lunaChecks: cfg.checks,
    },
  });
  await runJev();
  await runLuna();
  // A busy moment at OpenAI leaves an item for the next run (the app's next check): the suite runs it once more too.
  if (lunaBacklog().length) await runLuna();
  const state = store.getState();
  if (state.jevStatus.error) throw new Error(`Sorting stopped: ${state.jevStatus.error}`);
  if (state.lunaStatus.error) throw new Error(`Luna's reading stopped: ${state.lunaStatus.error}`);
  const { checks, events } = scoreCase(c, { ...state, snapshot: snap });
  // How each item was read (the tiered strategy's route): skipped, the rung it ended on, whether it went up.
  const routes = Object.values(store.getState().luna).map((r) => r.route ?? null);
  const usage = totalUsage(store.getState().usage);
  // The readings and the decisions as stored (every probability, whose, the links): for looking into a failure, and for
  // scoring the same answers again with other thresholds (calibrate.ts).
  const readings = store.getState().luna;
  const decisions = store.getState().jev;
  return { checks, events, routes, cost: costOf(usage), ms: RealDate.now() - started, items: Object.keys(readings).length, readings, decisions };
}

// ---- Run ----
type Route = import("../src/data/model.ts").LunaRecord["route"] | null;
type Result = {
  id: string;
  checks: Check[];
  events: Record<string, string[]>;
  routes?: Route[];
  cost: number;
  ms: number;
  items: number;
  readings?: Record<string, unknown>;
  decisions?: Record<string, unknown>;
  error?: string;
};

/**
 * A case's checks over its runs, matched by what they check (not by position: a run can have a check another didn't
 * get to): each check once, in the order of the run that has the most, with that check's result in every run (or
 * undefined where a run hasn't it).
 */
function alignChecks(runs: Check[][]): { check: Check; per: (Check | undefined)[] }[] {
  const keyed = runs.map((checks) => {
    const seen = new Map<string, number>();
    return checks.map((x) => {
      const base = `${x.task}|${x.what}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      return { key: `${base}|${n}`, x };
    });
  });
  const order = [...keyed].sort((a, b) => b.length - a.length)[0] ?? [];
  const all = [...order, ...keyed.flat().filter((k) => !order.some((o) => o.key === k.key))];
  const unique = all.filter((k, i) => all.findIndex((o) => o.key === k.key) === i);
  return unique.map(({ key, x }) => ({ check: x, per: keyed.map((run) => run.find((k) => k.key === key)?.x) }));
}

/** A check's id across runs and baselines: the case and what it checks. */
const checkId = (caseId: string, x: Check) => `${caseId} · ${x.task}: ${x.what}`;
const pct = ({ ok, n }: { ok: number; n: number }) => (n ? `${Math.round((100 * ok) / n)} %` : "–");
const quantile = (xs: number[], q: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * q))] : 0);
const TASKS = ["triage", "action", "tone", "marks", "calendar"] as const;

interface Summary {
  localRuntime?: typeof localStatus;
  caseSnapshotSHA256?: string;
  config: string;
  label: string;
  at: string;
  cases: number;
  repeat: number;
  /** Each check's pass rate over the runs, by checkId: what the baselines compare. */
  checks: Record<string, number>;
  all: { ok: number; n: number };
  byTask: Record<string, { ok: number; n: number }>;
  byTag: Record<string, { ok: number; n: number }>;
  costPerRun: number;
  /** Seconds a case takes, all its items read (the decisions and the reading), median and 90th percentile. */
  secondsPerCase: number;
  secondsP90: number;
  errors: number;
  routes?: string;
  /** Against the baseline, when there is one. */
  worse?: number;
  better?: number;
}

const outDir = join(here, "results");
const baseDir = join(here, "baselines");
mkdirSync(outDir, { recursive: true });
const stamp = new RealDate().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const startedAt = RealDate.now();

/** One config over the cases (--repeat times): the report, the summary, the baseline compared and maybe saved. */
async function runConfig(name: string, cfg: EvalConfig): Promise<Summary> {
  console.log(`\n== ${name}: ${cfg.label}${repeat > 1 ? ` (${repeat} runs)` : ""}`);
  // The models' answers vary between runs: --repeat N runs every case N times and counts each check over the runs.
  const runs: Result[][] = [];
  const progressPath = join(outDir, `progress-${name}.json`);
  const saveProgress = (current: Result[]) => {
    if (!allLocal(cfg)) return;
    const file = `${progressPath}.tmp`;
    writeFileSync(file, JSON.stringify({
      config: name, status: "in-progress", requestedRepeat: repeat,
      caseSnapshotSHA256: createHash("sha256").update(JSON.stringify(cases)).digest("hex"),
      localRuntime: localStatus, cases, completedRuns: runs.length,
      runs: [...runs, current],
    }, null, 2));
    renameSync(file, progressPath);
  };
  for (let r = 0; r < repeat; r += 1) {
    if (repeat > 1) console.log(`— run ${r + 1} of ${repeat}`);
    const results: Result[] = [];
    for (const c of cases) {
      process.stdout.write(`${c.id} … `);
      try {
        const out = await runCase(c, cfg);
        results.push({ id: c.id, ...out });
        const failed = out.checks.filter((x) => !x.ok && !x.gap).length;
        console.log(`${out.checks.length - failed}/${out.checks.length}${failed ? " ✗" : " ✓"}  $${out.cost.toFixed(5)}  ${(out.ms / 1000).toFixed(1)} s`);
      } catch (err) {
        results.push({ id: c.id, checks: [], events: {}, cost: 0, ms: 0, items: 0, error: err instanceof Error ? err.message : String(err) });
        console.log(`error: ${err instanceof Error ? err.message : String(err)}`);
      }
      saveProgress(results);
    }
    runs.push(results);
  }

  // Each check's pass rate over the runs, by its id. A run that failed with an error, or didn't get as far as a check
  // (one that's there only when an earlier one passed), fails it.
  const rates: Record<string, number> = {};
  const counted = (x: Check) => !x.gap;
  for (const c of cases) {
    const mine = runs.map((results) => results.find((r) => r.id === c.id)!);
    for (const { check, per } of alignChecks(mine.map((r) => r.checks))) {
      if (!counted(check)) continue;
      rates[checkId(c.id, check)] = per.filter((y) => y?.ok).length / mine.length;
    }
  }
  const tagsOf = (id: string) => cases.find((c) => c.id === id)?.tags ?? [];
  const flat = runs.flat().flatMap((r) => r.checks.map((x) => ({ x, tags: tagsOf(r.id) }))).filter(({ x }) => counted(x));
  const tally = (pick: (e: { x: Check; tags: string[] }) => boolean) => {
    const xs = flat.filter(pick);
    return { ok: xs.filter((e) => e.x.ok).length, n: xs.length };
  };
  const tags = [...new Set(cases.flatMap((c) => c.tags ?? []))].sort();
  const timed = runs.flat().filter((r) => !r.error).map((r) => r.ms / 1000);
  const summary: Summary = {
    caseSnapshotSHA256: createHash("sha256").update(JSON.stringify(cases)).digest("hex"),
    localRuntime: cfg.localDecisions || cfg.localReading ? localStatus : null,
    config: name,
    label: cfg.label,
    at: new RealDate().toISOString(),
    cases: cases.length,
    repeat,
    checks: rates,
    all: tally(() => true),
    byTask: Object.fromEntries(TASKS.map((t) => [t, tally((e) => e.x.task === t)])),
    byTag: Object.fromEntries(tags.map((t) => [t, tally((e) => e.tags.includes(t))])),
    costPerRun: runs.flat().reduce((sum, r) => sum + r.cost, 0) / repeat,
    secondsPerCase: quantile(timed, 0.5),
    secondsP90: quantile(timed, 0.9),
    errors: runs.flat().filter((r) => r.error).length,
  };
  if (cfg.readingStrategy !== "fixed") {
    const routes = runs.flat().flatMap((r) => r.routes ?? []).filter((r): r is NonNullable<Route> => Boolean(r));
    const n = routes.length || 1;
    const share = (k: number) => `${Math.round((100 * k) / n)} %`;
    const ended = (rung: string) => routes.filter((r) => r.rungs[r.rungs.length - 1] === rung).length;
    summary.routes = `skipped by the gate ${share(routes.filter((r) => !r.rungs.length).length)}, Luna low ${share(ended("gpt-6-luna/low"))}, Luna medium ${share(ended("gpt-6-luna/medium"))}, Sol ${share(ended("gpt-6.1-sol/low"))}, read twice ${share(routes.filter((r) => r.rungs.length > 1).length)}`;
  }

  // Against the baseline: a check that passes clearly less often than it did (by more than a run in three) is worse.
  const basePath = join(baseDir, `${name}.json`);
  const base = existsSync(basePath) ? (JSON.parse(readFileSync(basePath, "utf8")) as Summary) : null;
  const worse = base ? Object.entries(rates).filter(([id, r]) => id in base.checks && r < base.checks[id] - 0.34) : [];
  const better = base ? Object.entries(rates).filter(([id, r]) => id in base.checks && r > base.checks[id] + 0.34) : [];
  const fresh = base ? Object.keys(rates).filter((id) => !(id in base.checks)) : [];
  if (base) Object.assign(summary, { worse: worse.length, better: better.length });

  // The config's report: the summary, against the baseline, by tag, then every case's checks.
  const lines: string[] = [];
  lines.push(`# Eval: ${name} — ${cfg.label} · ${summary.at.slice(0, 16).replace("T", " ")}`, "");
  lines.push(
    `${cases.length} cases${repeat > 1 ? ` × ${repeat} runs` : ""}: all ${pct(summary.all)} (${summary.all.ok}/${summary.all.n}). ${TASKS.map((t) => `${t === "action" ? "step" : t} ${pct(summary.byTask[t])}`).join(" · ")}. Cost $${summary.costPerRun.toFixed(4)} a run; ${summary.secondsPerCase.toFixed(1)} s a case (median, p90 ${summary.secondsP90.toFixed(1)} s)${summary.errors ? `; ${summary.errors} errors` : ""}.`,
    ""
  );
  if (summary.localRuntime) {
    lines.push(`Local runtime fingerprint: \`${summary.localRuntime.fingerprint}\`.`, "");
    lines.push("Models:", "", ...summary.localRuntime.models.map((m) => `- \`${m.name}\`: \`${m.digest}\` (${(m.size / 1e9).toFixed(2)} GB on disk).`), "");
  }
  if (summary.routes) lines.push(`Routes: ${summary.routes}.`, "");
  if (base) {
    lines.push(`Against the baseline (${base.at.slice(0, 10)}, ${pct(base.all)}, $${base.costPerRun.toFixed(4)} a run): ${worse.length} worse, ${better.length} better, ${fresh.length} new checks.`, "");
    for (const [id, r] of worse) lines.push(`- worse: ${id} (${Math.round(base.checks[id] * 100)} % → ${Math.round(r * 100)} %)`);
    for (const [id, r] of better) lines.push(`- better: ${id} (${Math.round(base.checks[id] * 100)} % → ${Math.round(r * 100)} %)`);
    if (worse.length || better.length) lines.push("");
  }
  lines.push("By tag: " + tags.map((t) => `${t} ${pct(summary.byTag[t])}`).join(" · "), "");
  for (const c of cases) {
    const mine = runs.map((results) => results.find((r) => r.id === c.id)!);
    lines.push(`## ${c.id}`, "", c.why, "");
    if (c.tags?.length) lines.push(`Tags: ${c.tags.join(", ")}`, "");
    if (c.gap) lines.push(`Known gap (not counted): ${c.gap}`, "");
    for (const r of mine) if (r.error) lines.push(`**Error:** ${r.error}`, "");
    // Each check over the runs: ✓ every run, ~ some runs, ✗ none (with what the last failing run showed).
    for (const { check: x, per } of alignChecks(mine.map((r) => r.checks))) {
      const passed = per.filter((y) => y?.ok).length;
      const miss = per.filter((y) => y && !y.ok).pop() ?? (per.some((y) => !y) ? { got: "not checked in a run" } : undefined);
      const mark = passed === mine.length ? "✓" : x.gap ? "○" : passed ? "~" : "✗";
      lines.push(`- ${mark} ${x.task}: ${x.what}${repeat > 1 ? ` (${passed}/${mine.length})` : ""}${miss ? ` · got ${miss.got}` : ""}`);
    }
    for (const [reader, evs] of Object.entries(mine[mine.length - 1].events)) if (evs.length) lines.push("", `Events (${reader}${repeat > 1 ? ", last run" : ""}):`, ...evs.map((e) => `- ${e}`));
    lines.push("");
  }
  writeFileSync(join(outDir, `${stamp}-${name}.md`), lines.join("\n"));
  writeFileSync(join(outDir, `${stamp}-${name}.json`), JSON.stringify({ summary, cases, runs }, null, 2));
  writeFileSync(join(outDir, `latest-${name}.md`), lines.join("\n"));
  writeFileSync(join(outDir, `latest-${name}.json`), JSON.stringify(summary, null, 2));
  if (allLocal(cfg)) {
    writeFileSync(`${progressPath}.tmp`, JSON.stringify({ status: "complete", summary, cases, runs }, null, 2));
    renameSync(`${progressPath}.tmp`, progressPath);
  }
  if (args.includes("--save-baseline")) {
    mkdirSync(baseDir, { recursive: true });
    writeFileSync(basePath, JSON.stringify(summary, null, 2) + "\n");
  }
  console.log(
    `${lines[2]}${summary.routes ? `\nRoutes: ${summary.routes}.` : ""}${base ? `\nAgainst the baseline: ${worse.length} worse, ${better.length} better.` : ""}${args.includes("--save-baseline") ? `\nSaved as the baseline: evals/baselines/${name}.json` : ""}\nReport: evals/results/latest-${name}.md`
  );
  return summary;
}

/** The configs side by side: accuracy by task and tag, cost, time, against their baselines. */
function writeMatrix(summaries: Summary[]) {
  const tags = [...new Set(summaries.flatMap((s) => Object.keys(s.byTag)))].sort();
  const title = (t: string) => (t === "action" ? "Step" : t[0].toUpperCase() + t.slice(1));
  const runs = summaries[0]?.repeat ?? repeat;
  const m: string[] = [`# Eval matrix · ${new RealDate().toISOString().slice(0, 16).replace("T", " ")}`, "", `${summaries[0]?.cases ?? 0} cases${runs > 1 ? `, ${runs} runs each` : ""}.`, ""];
  m.push(`| Config | All | ${TASKS.map(title).join(" | ")} | Cost a run | s a case (p90) | vs baseline |`);
  m.push(`| --- | ---: | ${TASKS.map(() => "---:").join(" | ")} | ---: | ---: | --- |`);
  for (const s of summaries)
    m.push(
      `| ${s.config} | ${pct(s.all)} | ${TASKS.map((t) => pct(s.byTask[t])).join(" | ")} | $${s.costPerRun.toFixed(4)} | ${s.secondsPerCase.toFixed(1)} (${s.secondsP90.toFixed(1)}) | ${s.worse === undefined ? "–" : `${s.worse} worse, ${s.better} better`} |`
    );
  m.push("", "By tag:", "", `| Tag | ${summaries.map((s) => s.config).join(" | ")} |`, `| --- | ${summaries.map(() => "---:").join(" | ")} |`);
  for (const t of tags) m.push(`| ${t} | ${summaries.map((s) => pct(s.byTag[t] ?? { ok: 0, n: 0 })).join(" | ")} |`);
  const routed = summaries.filter((s) => s.routes);
  if (routed.length) m.push("", "Routes:", "", ...routed.map((s) => `- ${s.config}: ${s.routes}`));
  // The checks that tell the configs apart: passed by some, failed by others.
  const ids = [...new Set(summaries.flatMap((s) => Object.keys(s.checks)))].sort();
  const split = ids.filter((id) => {
    const rs = summaries.map((s) => s.checks[id]).filter((r) => r !== undefined);
    return rs.some((r) => r < 1) && rs.some((r) => r > 0);
  });
  if (split.length) {
    m.push("", "Where they differ (pass rate):", "", `| Check | ${summaries.map((s) => s.config).join(" | ")} |`, `| --- | ${summaries.map(() => "---:").join(" | ")} |`);
    for (const id of split) m.push(`| ${id.replace(/\|/g, "\\|")} | ${summaries.map((s) => (s.checks[id] === undefined ? "–" : `${Math.round(s.checks[id] * 100)} %`)).join(" | ")} |`);
  }
  const failing = ids.filter((id) => summaries.every((s) => (s.checks[id] ?? 0) === 0));
  if (failing.length) m.push("", "Failed by every config:", "", ...failing.map((id) => `- ${id}`));
  writeFileSync(join(outDir, `${stamp}-matrix.md`), m.join("\n"));
  writeFileSync(join(outDir, "latest-matrix.md"), m.join("\n"));
  console.log(`\n${m.slice(4, 6 + summaries.length).join("\n")}\nMatrix: evals/results/latest-matrix.md`);
}

/** For CI: below the bar, or worse than the baseline, fails. */
const failed = (s: Summary) => s.errors > 0 || (failUnder !== null && s.all.n > 0 && s.all.ok / s.all.n < failUnder) || (args.includes("--fail-on-regression") && (s.worse ?? 0) > 0);

if (args.includes("--summarize")) {
  // The latest results of these configs side by side again (no calls): after configs were run at different times.
  const summaries = configs
    .map(([name]) => join(outDir, `latest-${name}.json`))
    .filter(existsSync)
    .map((f) => JSON.parse(readFileSync(f, "utf8")) as Summary);
  writeMatrix(summaries);
  process.exit(0);
}

if (configs.length > 1 && !args.includes("--serial") && !configs.some(([, c]) => c.localDecisions || c.localReading)) {
  // Several configs: each in its own process at once (the app's state is one per process), then side by side.
  const rest: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--matrix") continue;
    if (args[i] === "--config") {
      i += 1;
      continue;
    }
    rest.push(args[i]);
  }
  const codes = await Promise.all(
    configs.map(
      ([name]) =>
        new Promise<number>((resolve) => {
          const child = spawn(process.execPath, [...process.execArgv, process.argv[1], ...rest, "--config", name], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
          let partial = "";
          const relay = (chunk: Buffer) => {
            const text = partial + chunk.toString();
            const lines = text.split("\n");
            partial = lines.pop() ?? "";
            for (const line of lines) if (line.trim()) console.log(`[${name}] ${line}`);
          };
          child.stdout.on("data", relay);
          child.stderr.on("data", relay);
          child.on("close", (code) => {
            if (partial.trim()) console.log(`[${name}] ${partial}`);
            resolve(code ?? 1);
          });
        })
    )
  );
  // Only this run's summaries: a config that stopped early leaves an older file behind.
  const summaries = configs
    .map(([name]) => join(outDir, `latest-${name}.json`))
    .filter(existsSync)
    .map((f) => JSON.parse(readFileSync(f, "utf8")) as Summary)
    .filter((s) => RealDate.parse(s.at) >= startedAt);
  writeMatrix(summaries);
  if (codes.some((c) => c !== 0)) process.exit(1);
} else {
  const summaries: Summary[] = [];
  for (const [name, cfg] of configs) summaries.push(await runConfig(name, cfg));
  if (summaries.length > 1) writeMatrix(summaries);
  const below = summaries.filter(failed);
  if (below.length) console.log(`\nFailed the bar: ${below.map((s) => `${s.config} ${pct(s.all)}${s.worse ? `, ${s.worse} worse than the baseline` : ""}`).join("; ")}`);
  if (below.length) process.exit(1);
}
