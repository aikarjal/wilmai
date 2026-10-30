/*
 * WilmAI Intelligence in Settings: No AI, recommended OpenAI, Claude (Anthropic) or an opt-in local pack.
 * Adding an OpenAI or Anthropic API key or completing local installation enables it. Cloud
 * usage has a light-use cost estimate, recorded spending in
 * USD and a separate pause limit (luna/client.ts). The tokens and prices
 * behind the recorded spending are under Details.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getState, updateSettings, useApp, useViewer } from "../data/store";
import { useLocalEdition } from "../data/edition";
import { shortDate } from "../data/dates";
import { AI_BUDGET_STEP, MAX_AI_BUDGET, MIN_AI_BUDGET, budgetText, normalizeAIBudget } from "../data/ai-budget";
import { intelligenceOn, intelligenceProvider, type CloudProvider, type Settings as SettingsModel, type UsageBucket } from "../data/model";
import { buildFeed } from "../data/feed";
import { TRANSLATION_LANGUAGES, itemsPerMonth, needsTranslation, translationAvailable, translationModel, translationSource, translatorsOf } from "../ai/translate";
import { runTranslations } from "../data/translations";
import { localPackStatus, stopLocalSetup } from "../ai/managed";
import { LocalAISetup } from "./LocalAISetup";
import { OpenAIBlocked } from "./OpenAIBlocked";
import { DECISIONS_INPUT_PRICE, LUNA, LunaError, READING_MODELS, costOf, monthCost, nextMonth, openAIBlockedMessage, openAIReach, overLimit, readingModel, readingTotal, thisMonth, totalUsage } from "../luna/client";
import { checkOpenAIKey, forgetLuna, lunaBacklog, runLuna } from "../luna/events";
import { runJev } from "../jev/runner";
import { isDesktopApp } from "../wilma/transport";
import { CLAUDE_DECIDER } from "../ai/anthropic";
import { Icon } from "./bits";
import { language, plural, t } from "../i18n";

/** Recorded API costs stay in USD. */
const money = (n: number): string => `$${n.toFixed(2)}`;
const precise = (n: number) => `$${n.toFixed(n < 0.01 ? 4 : n < 1 ? 3 : 2)}`;
const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : n >= 1e4 ? `${Math.round(n / 1e3)} k` : String(n));

/** A sentence translated whole, with the part between asterisks wrapped in markup. */
function marked(text: string, wrap: (part: string) => ReactNode): ReactNode {
  const [before, part, after = ""] = text.split("*");
  return part === undefined ? text : (
    <>
      {before}
      {wrap(part)}
      {after}
    </>
  );
}

/** A fraction of a cent, in dollars as OpenAI bills them: "$0.0001", "$0.005". */
const dollars = (n: number) => `$${n.toFixed(Math.max(2, -Math.floor(Math.log10(n))))}`;

/** With a cloud AI (OpenAI or Claude), in the AI card: what messages are translated into as they come, or nothing, and which model translates (data/translations.ts). */
function TranslationSettings({ settings }: { settings: SettingsModel }) {
  const chosen = settings.translateTo ?? "off";
  const translator = translationModel(settings);
  const translators = translatorsOf(settings);
  const status = useApp((s) => s.translationStatus);
  // A usual month's cost, from what this family gets in another language than the one chosen.
  const snapshot = useApp((s) => s.snapshot);
  const local = useApp((s) => s.local);
  const monthly = useMemo(() => {
    if (!snapshot || chosen === "off") return 0;
    const items = buildFeed({ snapshot, local, jev: {}, luna: {} }).filter((i) => needsTranslation(translationSource(i, snapshot), chosen));
    return Math.round(itemsPerMonth(items));
  }, [snapshot, local, chosen]);
  const change = (patch: Partial<SettingsModel>) => {
    updateSettings(patch);
    void runTranslations();
  };
  return (
    <section className="ai-part" aria-labelledby="ai-translate-title">
      <h3 id="ai-translate-title">
        <Icon name="translate" /> {t("Translating messages")}
      </h3>
      <p>{t("Messages, bulletins and notes in another language are translated as they come in, titles too. Choose the language, or none.")}</p>
      <div role="group" aria-label={t("Translate into")} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button className="seg" aria-pressed={chosen === "off"} onClick={() => change({ translateTo: "off" })}>
          {t("No translations")}
        </button>
        {Object.entries(TRANSLATION_LANGUAGES).map(([id, name]) => (
          <button key={id} className="seg" lang={id} aria-pressed={chosen === id} onClick={() => change({ translateTo: id as keyof typeof TRANSLATION_LANGUAGES })}>
            {name}
          </button>
        ))}
      </div>
      {chosen !== "off" ? (
        <fieldset className="translator">
          <legend>{t("Translator")}</legend>
          {translators.map((x) => (
            <label key={x.model} className="switch">
              <input type="radio" name="translator" checked={translator === x.model} onChange={() => change({ translateModel: x.model })} />
              <div>
                <b>
                  {t(x.label)}
                  {x.model === translators[0].model ? <span className="translator-badge">{t("Recommended")}</span> : null}
                </b>
                <span className="translator-cost">
                  {monthly
                    ? t("About {cost} a message, usually about {month} a month.", { cost: dollars(x.perMessage), month: dollars(monthly * x.perMessage) })
                    : t("About {cost} a message.", { cost: dollars(x.perMessage) })}
                </span>
                <span>
                  {t(x.help)}
                </span>
              </div>
            </label>
          ))}
          <p className="help-line">
            {monthly ? `${plural(monthly, "About {n} message, bulletin or note a month comes in another language.", "About {n} messages, bulletins and notes a month come in another language.")} ` : ""}
            {t(
              "Choosing a language also translates the last 30 days and the titles in your lists, once. That usually costs a few tens of cents, well within your monthly limit of {limit}, and WilmAI never spends more than the limit.",
              { limit: budgetText(normalizeAIBudget(settings.aiMonthlyBudgetUsd)) }
            )}
          </p>
          {status.running ? <p className="help-line">{t("Translating: {done} of {total}…", { done: status.done, total: status.total })}</p> : null}
          {status.error ? <div className="notice err">{t("Translating stopped: {why}", { why: status.error })}</div> : null}
        </fieldset>
      ) : null}
    </section>
  );
}

const AI_CHOICES = [
  { value: "off", label: "No AI", badge: "Default", icon: "book", help: "You read and sort everything yourself.", detail: "Free" },
  { value: "openai", label: "OpenAI", badge: "Recommended", icon: "sparkles", help: "Fast and accurate. Translates messages too.", detail: "Your own API key · tens of cents a month" },
  { value: "anthropic", label: "Claude", badge: "Anthropic", icon: "spark", help: "Careful and accurate. Translates messages too.", detail: "Your own API key · tens of cents a month" },
  { value: "local", label: "Local AI", badge: "On this Mac", icon: "laptop", help: "Nothing goes to an AI service. Slower, less accurate, and no translations.", detail: "9.1 GB download · works the Mac hard" },
] as const;

const isCloud = (choice: string): choice is CloudProvider => choice === "openai" || choice === "anthropic";

/** What Settings says of each AI service: the same words, its own name. */
const SERVICE = {
  openai: {
    keyField: "openaiKey",
    models: { decider: "luna", decisionsModel: LUNA, readingModel: LUNA },
    howTo: () => `https://wilm.ai/${language() === "fi" ? "fi" : "en"}/home#openai-key`,
    addKey: () => t("Add your OpenAI API key"),
    paste: () => t("Paste your OpenAI API key"),
    sentOnly: () => t("Sent only to OpenAI."),
    answered: () => t("On. OpenAI answered."),
    noTest: (error: string) => t("Saved, but OpenAI didn't answer the test: {error}", { error }),
    reaching: () => t("Checking that this computer can reach OpenAI…"),
    usually: (limit: string) => t("For a family, OpenAI usually costs tens of cents a month. OpenAI bills your key directly, and the app pauses AI if a month reaches your limit ({limit}).", { limit }),
    details: () => t("OpenAI key, limit and usage"),
    keyLabel: () => t("OpenAI API key"),
    bills: (date: string) => t("OpenAI bills your key directly. If a month reaches the limit, WilmAI Intelligence pauses until {date} and says so here.", { date }),
    dollars: () => t("The first reading of your older messages costs a little more. Amounts are in US dollars, as OpenAI bills them."),
  },
  anthropic: {
    keyField: "anthropicKey",
    // Claude reads with Sonnet (luna/client.ts readingModel) and answers the questions with Haiku.
    models: { decider: "luna", decisionsModel: CLAUDE_DECIDER },
    howTo: () => "https://platform.claude.com/settings/keys",
    addKey: () => t("Add your Anthropic API key"),
    paste: () => t("Paste your Anthropic API key"),
    sentOnly: () => t("Sent only to Anthropic."),
    answered: () => t("On. Claude answered."),
    noTest: (error: string) => t("Saved, but Claude didn't answer the test: {error}", { error }),
    reaching: () => t("Checking that this computer can reach Anthropic…"),
    usually: (limit: string) => t("For a family, Claude usually costs tens of cents a month. Anthropic bills your key directly, and the app pauses AI if a month reaches your limit ({limit}).", { limit }),
    details: () => t("Anthropic key, limit and usage"),
    keyLabel: () => t("Anthropic API key"),
    bills: (date: string) => t("Anthropic bills your key directly. If a month reaches the limit, WilmAI Intelligence pauses until {date} and says so here.", { date }),
    dollars: () => t("The first reading of your older messages costs a little more. Amounts are in US dollars, as Anthropic bills them."),
  },
} as const;

/**
 * Can this computer run local AI? Only the Mac build has the runtime, and it needs Apple Silicon with 16 GB of
 * memory (local_ai.rs decides). null while asking. In the browser (development) the setup panel can be looked at.
 */
function useLocalSupport(): boolean | null {
  const localEdition = useLocalEdition();
  const [supported, setSupported] = useState<boolean | null>(isDesktopApp ? null : true);
  useEffect(() => {
    if (!isDesktopApp || localEdition !== true) return;
    let live = true;
    localPackStatus().then((s) => { if (live) setSupported(s.supported); }).catch(() => { if (live) setSupported(false); });
    return () => { live = false; };
  }, [localEdition]);
  return localEdition === false ? false : supported;
}

export function AISettings() {
  const localSupport = useLocalSupport();
  const settings = useApp((s) => s.settings);
  const reading = useApp((s) => s.lunaStatus);
  const sorting = useApp((s) => s.jevStatus);
  const usage = useApp((s) => s.usage);
  const luna = useApp((s) => s.luna);
  const on = intelligenceOn(settings);
  const student = useViewer() === "student";
  const [choice, setChoice] = useState(settings.localAI?.setupPending ? "local" as const : intelligenceProvider(settings));
  const sourceGeneration = useRef(0);
  // The key being typed: shown when there's none yet, or while replacing it.
  const [key, setKey] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [check, setCheck] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const blocked = useApp((s) => s.openaiBlocked);
  const [reaching, setReaching] = useState(false);
  // The AI service chosen (its words and key), or the one shown when none is: OpenAI's.
  const service = SERVICE[isCloud(choice) ? choice : "openai"];
  const savedKey = isCloud(choice) ? (settings[SERVICE[choice].keyField] ?? "").trim() : "";

  // Choosing a cloud AI checks the network first: when it blocks the service, no key can help, so none is asked for.
  useEffect(() => {
    if (!isCloud(choice) || on) return;
    let live = true;
    setReaching(true);
    void openAIReach().finally(() => { if (live) setReaching(false); });
    return () => { live = false; };
  }, [choice, on]);

  const turnOn = async () => {
    const token = ++sourceGeneration.current;
    const value = key.trim();
    if (!value || !isCloud(choice)) return;
    const chosen = SERVICE[choice];
    setBusy(true);
    setCheck(null);
    try {
      // Unreachable: nothing is saved, and the notice says why.
      if (!(await openAIReach()).reachable || sourceGeneration.current !== token) return;
      updateSettings({ aiProvider: choice, ...chosen.models, [chosen.keyField]: value });
      await checkOpenAIKey();
      if (sourceGeneration.current !== token) return;
      setCheck({ ok: true, text: chosen.answered() });
      setKey("");
      setReplacing(false);
      void runJev();
      void runLuna();
    } catch (err) {
      if (sourceGeneration.current !== token) return;
      // A key the service refuses isn't kept (it would only fail later), nor one it couldn't be asked about (the typed key
      // stays in the field for Check again); a busy service keeps it, to try again.
      if (err instanceof LunaError && !err.retryable) {
        updateSettings({ [chosen.keyField]: "" });
        if (getState().openaiBlocked) setCheck(null);
        else {
          setKey("");
          setCheck({ ok: false, text: err.message });
        }
      } else setCheck({ ok: false, text: chosen.noTest(err instanceof Error ? err.message : String(err)) });
    } finally {
      setBusy(false);
    }
  };
  const turnOff = () => {
    ++sourceGeneration.current;
    updateSettings({ aiProvider: "off", [service.keyField]: "" });
    setChoice("off");
    setKey("");
    setReplacing(false);
    setCheck({ ok: true, text: t("Turned off. The key was removed from this app.") });
  };
  const changeSource = (value: typeof choice) => {
    ++sourceGeneration.current;
    setChoice(value);
    setCheck(null);
    setReplacing(false);
    updateSettings({ aiProvider: value === "local" ? "off" : value, ...(isCloud(value) ? SERVICE[value].models : {}) });
    void stopLocalSetup().catch((err) => setCheck({ ok: false, text: String(err) }));
    // A key kept for the service chosen again picks up where it left off.
    if (isCloud(value) && (settings[SERVICE[value].keyField] ?? "").trim()) { void runJev(); void runLuna(); }
  };

  const total = totalUsage(usage);
  const spent = monthCost();
  const limit = normalizeAIBudget(settings.aiMonthlyBudgetUsd);
  const limitText = budgetText(limit);
  const changeBudget = (value: number) => {
    const next = normalizeAIBudget(value);
    updateSettings({ aiMonthlyBudgetUsd: next });
    if (next > limit && on && isCloud(choice) && !overLimit()) { void runJev(); void runLuna(); }
  };

  const records = Object.values(luna);
  const found = records.reduce((n, r) => n + r.events.length, 0);
  const dropped = records.reduce((n, r) => n + r.dropped, 0);
  const failed = records.filter((r) => r.error).length;
  const waiting = on ? lunaBacklog().length : 0;
  const price = READING_MODELS[readingModel()] ?? READING_MODELS["gpt-6-luna"];
  // While OpenAI is unreachable, its notice says so once (and how to check again).
  const errors = on ? [...new Set([sorting.error, reading.error].filter((e): e is string => Boolean(e) && !(blocked && e === openAIBlockedMessage())))] : [];
  const kept = isDesktopApp ? t("Kept on this computer in the app's own data, scrambled but not encrypted.") : t("Kept in this browser only, scrambled but not encrypted.");

  const keyInput = (
    <div className="ai-key">
      <input
        id="openai-key"
        className="input"
        type="password"
        autoComplete="off"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void turnOn();
        }}
        placeholder={service.paste()}
      />
      <button className="btn btn-primary" onClick={() => void turnOn()} disabled={busy || !key.trim()}>
        {busy ? t("Checking…") : on ? t("Save the new key") : t("Turn on")}
      </button>
      {replacing ? (
        <button className="btn btn-quiet" onClick={() => setReplacing(false)}>
          {t("Cancel")}
        </button>
      ) : null}
    </div>
  );

  const row = (label: string, b: UsageBucket | undefined) => (
    <tr>
      <th scope="row">{label}</th>
      <td>{b ? b.items : 0}</td>
      <td>
        {b ? readingTotal(b).calls : 0} · {tokens(b ? readingTotal(b).input : 0)} / {tokens(b ? readingTotal(b).output : 0)}
      </td>
      <td>
        {b ? b.decisions.calls : 0} · {b?.decisions.estimated ? "~" : ""}
        {tokens(b?.decisions.input ?? 0)}
      </td>
      <td>
        <b>{precise(b ? costOf(b) : 0)}</b>
      </td>
    </tr>
  );

  return (
    <section className="card ai-settings" aria-labelledby="ai-settings-title">
      <h2 id="ai-settings-title">
        <Icon name="sparkles" /> {t("WilmAI Intelligence")}
        {on ? <span className="ai-on">{t("On")}</span> : null}
      </h2>
      <p>
        {t(
          "WilmAI Intelligence reads new messages, bulletins and teachers' notes for you, and picks out what needs you, by when, and the dates for your calendar. It's optional, and you can change your choice any time."
        )}
      </p>
      <fieldset className="ai-choices">
        <legend>{t("Choose your AI")}</legend>
        {AI_CHOICES.map(({ value, label, badge, icon, help, detail }) => {
          // Local AI stays in the list on computers that can't run it, greyed out with the reason.
          const unavailable = value === "local" && localSupport !== true;
          return (
            <label key={value} className={`ai-choice ai-choice-${value}${choice === value ? " selected" : ""}${unavailable ? " unavailable" : ""}`}>
              <span className="ai-choice-top">
                <span className="ai-choice-badge" id={`ai-${value}-badge`}>
                  {value === "openai" ? <Icon name="star" /> : null}{t(badge)}
                </span>
                <input type="radio" name="ai-source" value={value} checked={choice === value} onChange={() => changeSource(value)} disabled={busy || unavailable}
                  onClick={() => { if (value === "off" && choice === "off" && settings.aiProvider === undefined) changeSource("off"); }}
                  aria-labelledby={`ai-${value}-label`} aria-describedby={`ai-${value}-badge ai-${value}-help ai-${value}-detail`} />
              </span>
              <span className="ai-choice-art" aria-hidden="true">
                <Icon name={icon} />
                {value === "local" ? <span className="ai-choice-emoji">🔒</span> : null}
              </span>
              <b id={`ai-${value}-label`}>{t(label)}</b>
              <small id={`ai-${value}-help`}>{t(help)}</small>
              <span className="ai-choice-detail" id={`ai-${value}-detail`}>
                {unavailable && localSupport === false ? t("Needs an Apple Silicon Mac with 16 GB of memory") : t(detail)}
              </span>
            </label>
          );
        })}
      </fieldset>
      {/* What each AI sees, by the choice. */}
      <p className="help-line">
        {choice === "anthropic" ? marked(
          student
            ? t("*Anthropic sees one item at a time,* with your first name and class, when you choose Claude. Local AI reads everything on this Mac, and No AI reads nothing.")
            : t("*Anthropic sees one item at a time,* with your children's first names and classes, when you choose Claude. Local AI reads everything on this Mac, and No AI reads nothing."),
          (part) => <b>{part}</b>
        ) : marked(
          student
            ? t("*OpenAI sees one item at a time,* with your first name and class, when you choose OpenAI. Local AI reads everything on this Mac, and No AI reads nothing.")
            : t("*OpenAI sees one item at a time,* with your children's first names and classes, when you choose OpenAI. Local AI reads everything on this Mac, and No AI reads nothing."),
          (part) => <b>{part}</b>
        )}
      </p>
      {choice === "local" ? (
        <>
          <LocalAISetup />
          {sorting.running ? <p className="help-line">{t("Sorting: {done} of {total}…", { done: sorting.done, total: sorting.total })}</p> : null}
          {reading.running ? <p className="help-line">{t("Reading: {done} of {total}…", { done: reading.done, total: reading.total })}</p> : null}
          {errors.map((e) => <div key={e} className="notice err">{e}</div>)}
        </>
      ) : choice === "off" ? (
        <p className="notice">{t("Without AI you see everything Wilma has, as Wilma shows it, but nothing picks out what needs you, deadlines or dates from the text. AI answers from earlier stay.")}</p>
      ) : !on && blocked ? (
        <OpenAIBlocked where="settings" />
      ) : !on && reaching ? (
        <p className="help-line">{service.reaching()}</p>
      ) : !on ? (
        <>
          <div className="field">
            <div className="ai-key-label">
              <label htmlFor="openai-key">{service.addKey()}</label>
              {/* Step by step on the website, for anyone who has never made one */}
              <a className="linkish" href={service.howTo()} target="_blank" rel="noreferrer">{t("How to get a key")} ↗</a>
            </div>
            {keyInput}
            <span className="help">
              {kept} {service.sentOnly()}
            </span>
          </div>
          <p className="ai-reassure">
            <Icon name="check" />
            <span>
              {service.usually(limitText)}
            </span>
          </p>
        </>
      ) : (
        <>
          <div className="ai-month">
            <div className="ai-month-line">
              <span>{t("This month {spent} of {limit}", { spent: money(spent), limit: limitText })}</span>
              {reading.running ? (
                <span>{t("Reading: {done} of {total}…", { done: reading.done, total: reading.total })}</span>
              ) : sorting.running ? (
                <span>{t("Sorting: {done} of {total}…", { done: sorting.done, total: sorting.total })}</span>
              ) : waiting && !errors.length && !blocked ? (
                <span>{plural(waiting, "{n} item waits to be read.", "{n} items wait to be read.")}</span>
              ) : null}
            </div>
            <div className="ai-meter" aria-hidden="true">
              <i style={{ width: `${Math.min(100, (spent / limit) * 100)}%` }} />
            </div>
          </div>
          <OpenAIBlocked where="settings" />
          {errors.map((e) => (
            <div key={e} className="notice err">
              {e}
            </div>
          ))}
        </>
      )}
      {check ? <div className={`notice ${check.ok ? "ok" : "err"}`}>{check.text}</div> : null}
      {on && isCloud(choice) && translationAvailable(settings) ? <TranslationSettings settings={settings} /> : null}

      {on && isCloud(choice) ? (
        <details className="ai-details">
          <summary>{service.details()}</summary>
          <div className="field ai-key-row">
            <label htmlFor="openai-key">{service.keyLabel()}</label>
            {replacing ? (
              keyInput
            ) : (
              <div className="ai-key">
                <span className="ai-key-saved">{t("Saved ({end})", { end: `…${savedKey.slice(-4)}` })}</span>
                <button className="btn btn-sm" onClick={() => setReplacing(true)}>
                  {t("Replace key")}
                </button>
                <button className="btn btn-sm btn-quiet" onClick={turnOff}>
                  {t("Turn off")}
                </button>
              </div>
            )}
            <span className="help">
              {kept} {service.sentOnly()}
            </span>
          </div>
          <div className="field ai-budget-control">
            <label htmlFor="ai-monthly-budget">{t("Monthly limit (USD)")} <output htmlFor="ai-monthly-budget">{limitText}</output></label>
            <input id="ai-monthly-budget" type="range" min={MIN_AI_BUDGET} max={MAX_AI_BUDGET} step={AI_BUDGET_STEP} value={limit} onChange={(e) => changeBudget(Number(e.target.value))} aria-valuetext={t("{amount} US dollars per month", { amount: limit })} aria-describedby="ai-budget-help" disabled={busy || reading.running || sorting.running} />
            <div className="ai-budget-scale" aria-hidden="true"><span>{budgetText(MIN_AI_BUDGET)}</span><span>{budgetText(MAX_AI_BUDGET)}</span></div>
            <span id="ai-budget-help" className="help">
              {t("$0.50–$3 a month, $1 to start with. Today warns you at 80%, and AI pauses at the limit. Raising the limit picks up what's waiting.")}{" "}
              {service.bills(shortDate(nextMonth()))}{" "}
              {service.dollars()}
            </span>
          </div>
          <div className="stats">
            <div>
              <b>{records.length}</b>
              <span>{plural(records.length, "item read", "items read")}</span>
            </div>
            <div>
              <b>{found}</b>
              <span>{plural(found, "date found", "dates found")}</span>
            </div>
            <div>
              <b>{dropped}</b>
              <span>{t("left out: the words weren't in the text")}</span>
            </div>
          </div>
          {failed ? <p className="help-line">{plural(failed, "The answer for {n} item wasn't readable.", "The answers for {n} items weren't readable.")}</p> : null}
          <table className="luna-usage">
            <thead>
              <tr>
                <th />
                <th scope="col">{t("Items")}</th>
                <th scope="col">{t("Reading: calls · tokens in / out")}</th>
                <th scope="col">{t("Questions: calls · tokens")}</th>
                <th scope="col">{t("Cost (USD)")}</th>
              </tr>
            </thead>
            <tbody>
              {row(t("This month"), usage[thisMonth()])}
              {row(t("All"), total)}
            </tbody>
          </table>
          <p className="help-line">
            {choice === "anthropic" ? t(
              "Counted on this computer from the tokens Anthropic reports, at Anthropic's list prices (30 Oct 2026, per million tokens: Claude Sonnet ${input} in, ${cached} cached, ${output} out; questions with Claude Haiku ${decisions} in, ${decisionsOut} out). The bill itself is in your Anthropic account.",
              {
                input: price.input.toFixed(2),
                cached: price.cached.toFixed(2),
                output: price.output.toFixed(2),
                decisions: READING_MODELS[CLAUDE_DECIDER].input.toFixed(2),
                decisionsOut: READING_MODELS[CLAUDE_DECIDER].output.toFixed(2),
              }
            ) : t(
              "Counted on this computer from the tokens OpenAI reports, at OpenAI's list prices for GPT-6 Luna (8 Oct 2026, per million tokens: ${input} in, ${cached} cached, ${output} out; questions ${decisions} in). The bill itself is in your OpenAI account.",
              {
                input: price.input.toFixed(2),
                cached: price.cached.toFixed(2),
                output: price.output.toFixed(2),
                decisions: DECISIONS_INPUT_PRICE.toFixed(2),
              }
            )}
            {total.decisions.estimated ? ` ${t("Questions don't report their tokens: ~ is estimated from the length.")}` : null}
          </p>
          <button className="btn btn-sm" onClick={() => void forgetLuna()} disabled={reading.running}>
            <Icon name="refresh" /> {t("Read everything again")}
          </button>
        </details>
      ) : null}
    </section>
  );
}
