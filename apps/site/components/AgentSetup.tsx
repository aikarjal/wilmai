import type { Action, AgentGuide, SetupStep } from "../lib/agents";
import CopyBlock from "./CopyBlock";

export interface SetupLabels {
  copy: string;
  copyMessage: string;
  copied: string;
  showMessage: string;
  hideMessage: string;
  /** Phones only, instead of a download button. */
  downloadOnComputer: string;
}

function linkify(text: string) {
  return text.split(/(https?:\/\/\S+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noreferrer">
        {part.replace(/^https?:\/\//, "")}
      </a>
    ) : (
      part
    )
  );
}

function ActionView({ action, labels }: { action: Action; labels: SetupLabels }) {
  if (action.kind === "message" || action.kind === "command") {
    return (
      <CopyBlock
        key={action.text}
        text={action.text}
        variant={action.kind}
        copyLabel={labels.copy}
        copiedLabel={labels.copied}
        messageLabels={{ copy: labels.copyMessage, show: labels.showMessage, hide: labels.hideMessage }}
      />
    );
  }
  if (action.kind === "download") {
    // A phone can't install it: the button shows on computers, the note on phones.
    return (
      <>
        <a className="button primary setup-download" href={action.href}>
          {action.label}
        </a>
        <p className="download-on-computer">{labels.downloadOnComputer}</p>
      </>
    );
  }
  return (
    <a className="setup-link" href={action.href} target="_blank" rel="noreferrer">
      {action.label} →
    </a>
  );
}

function Steps({ steps, labels }: { steps: SetupStep[]; labels: SetupLabels }) {
  const numbered = steps.length > 1;
  return (
    <ol className={`setup-steps ${numbered ? "numbered" : ""}`}>
      {steps.map((step, i) => (
        <li className="setup-step" key={step.title}>
          {numbered ? (
            <span className="step-num" aria-hidden="true">
              {i + 1}
            </span>
          ) : null}
          <strong>{step.title}</strong>
          {step.body ? <p>{step.body}</p> : null}
          {step.action ? <ActionView action={step.action} labels={labels} /> : null}
        </li>
      ))}
    </ol>
  );
}

/**
 * Renders an assistant's setup guide: the steps, a short note, then the
 * terminal ways to set it up, folded so they don't crowd the simple path.
 */
export default function AgentSetup({ guide, labels }: { guide: AgentGuide; labels: SetupLabels }) {
  return (
    <div className="setup">
      <p className="setup-summary">{guide.summary}</p>
      <Steps steps={guide.steps} labels={labels} />
      {guide.notes?.length ? (
        <ul className="setup-notes">
          {guide.notes.map((note) => (
            <li key={note}>{linkify(note)}</li>
          ))}
        </ul>
      ) : null}
      {guide.others?.map((other) => (
        <details className="setup-other" key={other.title}>
          <summary>{other.title}</summary>
          {other.body ? <p>{other.body}</p> : null}
          <ActionView action={other.action} labels={labels} />
        </details>
      ))}
    </div>
  );
}
