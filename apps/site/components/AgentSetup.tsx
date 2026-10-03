import type { Action, AgentGuide, SetupStep } from "../lib/agents";
import CopyBlock from "./CopyBlock";

export interface SetupLabels {
  copy: string;
  copied: string;
  alternative: string;
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
    return <CopyBlock text={action.text} variant={action.kind} copyLabel={labels.copy} copiedLabel={labels.copied} />;
  }
  if (action.kind === "download") {
    return (
      <a className="button primary setup-download" href={action.href}>
        {action.label}
      </a>
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
          {step.alternative ? (
            <div className="setup-alt">
              <span className="setup-alt-label">{labels.alternative}</span>
              <strong>{step.alternative.title}</strong>
              {step.alternative.body ? <p>{step.alternative.body}</p> : null}
              {step.alternative.action ? <ActionView action={step.alternative.action} labels={labels} /> : null}
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/** Renders an assistant's setup guide: the main steps, then other apps as alternatives. */
export default function AgentSetup({ guide, labels }: { guide: AgentGuide; labels: SetupLabels }) {
  return (
    <div className="setup">
      <p className="setup-summary">{guide.summary}</p>
      <Steps steps={guide.steps} labels={labels} />
      {guide.others?.map((other) => (
        <section className="setup-alt setup-other" key={other.title}>
          <span className="setup-alt-label">{labels.alternative}</span>
          <strong>{other.title}</strong>
          {other.intro ? <p>{other.intro}</p> : null}
          <Steps steps={other.steps} labels={labels} />
        </section>
      ))}
      {guide.notes?.length ? (
        <ul className="setup-notes">
          {guide.notes.map((note) => (
            <li key={note}>{linkify(note)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
