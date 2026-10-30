import { aiBudgetState, normalizeAIBudget } from "../data/ai-budget";
import { shortDate } from "../data/dates";
import { cloudOf, intelligenceOn } from "../data/model";
import { useApp } from "../data/store";
import { t } from "../i18n";
import { costOf, nextMonth, thisMonth } from "../luna/client";
import { go } from "./shared";

export function AIBudgetWarning() {
  const settings = useApp((s) => s.settings);
  const usage = useApp((s) => s.usage[thisMonth()]);
  const spent = usage ? costOf(usage) : 0;
  const limit = normalizeAIBudget(settings.aiMonthlyBudgetUsd);
  const status = aiBudgetState(spent, limit);
  if (!intelligenceOn(settings) || !cloudOf(settings) || status === "ok") return null;

  return (
    <div className={`notice ai-budget-warning ${status === "paused" ? "err" : "near"}`} role={status === "paused" ? "alert" : "status"}>
      <div>
        <b>{status === "paused" ? t("AI paused: this month's limit reached") : t("{percent}% of this month's AI limit used", { percent: Math.floor(spent / limit * 100 + 1e-9) })}</b>
        <p>{t("{spent} of {limit} used this month (USD).", { spent: `$${spent.toFixed(2)}`, limit: `$${limit.toFixed(2)}` })} {status === "paused" ? t("Raise the limit in Settings to carry on, or wait until {date}.", { date: shortDate(nextMonth()) }) : t("AI pauses at the limit. You can raise it in Settings.")}</p>
      </div>
      <button type="button" className="btn btn-sm" onClick={() => go("settings")}>{t("Change the limit")}</button>
    </div>
  );
}
