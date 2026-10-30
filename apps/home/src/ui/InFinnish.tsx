/*
 * Under a composer, when the app isn't in Finnish and a cloud AI is on: "Send it in Finnish". The parent writes in
 * their language, the app translates it (ai/outgoing.ts), and the Finnish shows here to check and edit, with what it
 * says in their language under it. The composer sends the Finnish, and only once it's of the words as they are now.
 */
import { useState } from "react";
import { currentOutgoing, toFinnish, type Outgoing } from "../ai/outgoing";
import { language, t } from "../i18n";
import { Icon } from "./bits";

export function InFinnish({
  on,
  setOn,
  subject,
  text,
  value,
  onChange,
  disabled,
}: {
  on: boolean;
  setOn: (on: boolean) => void;
  /** The subject the parent wrote; null for an answer in a thread (no subject of its own). */
  subject: string | null;
  text: string;
  value: Outgoing | null;
  onChange: (value: Outgoing | null) => void;
  disabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = currentOutgoing(value, subject, text);
  const translate = async () => {
    setBusy(true);
    setError(null);
    try {
      onChange(await toFinnish(subject, text, language()));
    } catch (err) {
      setError(t("Couldn't translate it: {why}", { why: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(false);
    }
  };
  const edit = (patch: Partial<Outgoing>) => value && onChange({ ...value, ...patch });
  return (
    <div className="in-finnish">
      <label className="switch">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} disabled={disabled} />
        <div>
          <b>{t("Send it in Finnish")}</b>
          <span>{t("Write in your own language. The AI translates it into Finnish, and you check the Finnish before it goes.")}</span>
        </div>
      </label>
      {on ? (
        <>
          {value ? (
            <div className="in-finnish-text" lang="fi">
              {subject !== null ? (
                <input className="subject" value={value.subject} onChange={(e) => edit({ subject: e.target.value })} aria-label={t("Subject in Finnish")} disabled={disabled} />
              ) : null}
              <textarea value={value.text} onChange={(e) => edit({ text: e.target.value })} aria-label={t("Your message in Finnish")} disabled={disabled} />
            </div>
          ) : null}
          {value?.back ? (
            <p className="in-finnish-back">
              <Icon name="translate" /> <span>{t("What the Finnish says: {text}", { text: value.back })}</span>
            </p>
          ) : null}
          {value && !current && text.trim() ? <p className="help-line">{t("You changed your words after they were translated. Translate again before sending.")}</p> : null}
          {error ? <div className="notice err">{error}</div> : null}
          <button type="button" className="btn btn-sm" onClick={() => void translate()} disabled={disabled || busy || !text.trim() || (subject !== null && !subject.trim()) || Boolean(current)}>
            <Icon name="translate" /> {busy ? t("Translating…") : value ? t("Translate again") : t("Translate into Finnish")}
          </button>
        </>
      ) : null}
    </div>
  );
}
