/*
 * Writing to the school in Finnish or Swedish (ai/outgoing.ts), in the composers: the parent's words and their
 * translation side by side, the translation made when they ask for it, and exactly what's shown is what's sent.
 * Words changed after translating mean translating again before Send. Per message, the parent can send their own
 * words instead; what's already written in the language goes as it is.
 */
import { useState } from "react";
import { useApp } from "../data/store";
import { currentOutgoing, translateOutgoing, writeLanguage, writtenIn, type Outgoing, type WriteLanguage } from "../ai/outgoing";
import { t } from "../i18n";

const SENT_IN: Record<WriteLanguage, string> = { fi: "Sent in Finnish", sv: "Sent in Swedish" };
const SEND_IN: Record<WriteLanguage, string> = { fi: "Send in Finnish", sv: "Send in Swedish" };
const GOES_IN: Record<WriteLanguage, string> = { fi: "It goes in Finnish, as shown.", sv: "It goes in Swedish, as shown." };
const WRITTEN_IN: Record<WriteLanguage, string> = { fi: "Written in Finnish: it goes as you wrote it.", sv: "Written in Swedish: it goes as you wrote it." };

/** One message's translation, for a composer: `subject` null for an answer, which has none. */
export function useOutgoing(subject: string | null, text: string) {
  const language = useApp((s) => writeLanguage(s.settings));
  const [on, setOn] = useState(true);
  const [made, setMade] = useState<Outgoing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const already = Boolean(language && on && text.trim() && writtenIn(language, subject, text));
  /** This message goes translated (a language is chosen, it's on for this message, and it isn't written in it). */
  const translating = Boolean(language && on && !already);
  const current = currentOutgoing(made, subject, text);
  const translate = async () => {
    if (!language || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setMade(await translateOutgoing(language, subject, text));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  /** What goes to Wilma: the translation shown, or the parent's own words; null until the translation is of these words. */
  const sent = translating ? (current ? { subject: current.subject, text: current.text } : null) : { subject: subject?.trim() ?? "", text };
  return { language, on, setOn, already, translating, made, current, busy, error, translate, sent, reset: () => (setMade(null), setError(null)) };
}

export type OutgoingState = ReturnType<typeof useOutgoing>;

/** What's sent, beside the parent's words: the translation (and what it says), or why there's none yet. */
export function OutgoingPane({ o, subject }: { o: OutgoingState; subject: boolean }) {
  if (!o.translating || !o.language) return null;
  const shown = o.current ?? o.made;
  return (
    <section className="out-pane" aria-label={t(SENT_IN[o.language])}>
      <div className="out-head">
        <span className="label">{t(SENT_IN[o.language])}</span>
        <button type="button" className="btn btn-sm" onClick={() => void o.translate()} disabled={o.busy}>
          {o.busy ? t("Translating…") : o.made ? t("Translate again") : t("Translate")}
        </button>
      </div>
      {shown ? (
        <div className={`out-words${o.current ? "" : " stale"}`} lang={o.language}>
          {subject && shown.subject ? <b className="out-subject">{shown.subject}</b> : null}
          <div className="out-text">{shown.text}</div>
        </div>
      ) : (
        <p className="help">{t("Translate to see your message as it will be sent, before you send it.")}</p>
      )}
      {o.made && !o.current ? <div className="notice">{t("Your words changed after translating. Translate again before sending.")}</div> : null}
      {o.current?.back ? (
        <p className="out-back">
          <span>{t("What it says:")}</span> {o.current.back}
        </p>
      ) : null}
      {o.error ? <div className="notice err">{t("The translation didn't work: {why}", { why: o.error })}</div> : null}
    </section>
  );
}

/** The switch for this message, by the Send button: translated, or the parent's own words. */
export function OutgoingSwitch({ o }: { o: OutgoingState }) {
  if (!o.language) return null;
  return (
    <span className="out-switch">
      <label>
        <input type="checkbox" checked={o.on} onChange={(e) => o.setOn(e.target.checked)} />
        {t(SEND_IN[o.language])}
      </label>
      {o.already ? <span className="hint">{t(WRITTEN_IN[o.language])}</span> : null}
    </span>
  );
}

/** Said in the confirmation when the translation is what goes. */
export const goesIn = (o: OutgoingState): string | null => (o.translating && o.language ? t(GOES_IN[o.language]) : null);

