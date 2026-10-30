/*
 * OpenAI (or Anthropic, with Claude chosen) can't be reached from this network (school and work networks can block
 * it): what that means, and a way to check again. Settings shows it instead of the key field, and Today while AI is
 * paused (luna/client.ts).
 */
import { useState } from "react";
import { cloudOf, intelligenceOn, intelligenceProvider } from "../data/model";
import { useApp } from "../data/store";
import { t } from "../i18n";
import { checkOpenAIAgain } from "../luna/events";

export function OpenAIBlocked({ where }: { where: "settings" | "today" }) {
  const blocked = useApp((s) => s.openaiBlocked);
  const settings = useApp((s) => s.settings);
  const [checking, setChecking] = useState(false);
  if (!blocked || (where === "today" && (!intelligenceOn(settings) || !cloudOf(settings)))) return null;
  const claude = intelligenceProvider(settings) === "anthropic";
  const again = async () => {
    setChecking(true);
    try { await checkOpenAIAgain(); }
    finally { setChecking(false); }
  };
  const detail = !blocked.detail
    ? null
    : blocked.reason === "intercepted"
      ? claude
        ? t("Another server answered in Anthropic's place ({detail}), usually the network's filter.", { detail: blocked.detail })
        : t("Another server answered in OpenAI's place ({detail}), usually the network's filter.", { detail: blocked.detail })
      : t("Connection error: {detail}", { detail: blocked.detail });
  return (
    <div className="notice err ai-blocked" role="alert">
      <div>
        {claude ? (
          <>
            <b>{where === "today" ? t("AI paused: this network can't reach Anthropic") : t("This computer can't reach Anthropic")}</b>
            <p>
              {where === "today"
                ? t("School and work networks sometimes block Anthropic. Everything from Wilma still shows, and the AI tries again in a few minutes.")
                : t("School and work networks sometimes block Anthropic (api.anthropic.com), and then AI with Claude can't work on this computer. Choose No AI, or use Claude on another network.")}
            </p>
          </>
        ) : (
          <>
            <b>{where === "today" ? t("AI paused: this network can't reach OpenAI") : t("This computer can't reach OpenAI")}</b>
            <p>
              {where === "today"
                ? t("School and work networks sometimes block OpenAI. Everything from Wilma still shows, and the AI tries again in a few minutes.")
                : t("School and work networks sometimes block OpenAI (api.openai.com), and then AI with OpenAI can't work on this computer. Choose No AI, or use OpenAI on another network.")}
            </p>
          </>
        )}
        {detail ? <small>{detail}</small> : null}
      </div>
      <button type="button" className="btn btn-sm" onClick={() => void again()} disabled={checking}>
        {checking ? t("Checking…") : t("Check again")}
      </button>
    </div>
  );
}
