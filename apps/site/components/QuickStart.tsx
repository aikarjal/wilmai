"use client";

import { useState } from "react";

const agentText = `# 1) Install the CLI\nnpm install -g @wilm-ai/wilma-cli\n\n# 2) Login once (interactive)\nwilma\n\n# 3) Add the Wilma skill to your agent\nnpx skills add aikarjal/wilmai`;

const cliText = `# 1) Install the CLI\nnpm install -g @wilm-ai/wilma-cli\n\n# 2) Login once (interactive)\nwilma\n\n# 3) Query data\nwilma kids list --json`;

const tabs = [
  {
    id: "agent",
    label: "Agent",
    caption: "Use this if you want Wilma as a skill for OpenAI, Claude Code, or OpenClaw.",
    text: agentText
  },
  {
    id: "cli",
    label: "CLI-only",
    caption: "Use this if you just want terminal access.",
    text: cliText
  }
] as const;

export default function QuickStart() {
  const [active, setActive] = useState<(typeof tabs)[number]>(tabs[0]);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(active.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="quickstart">
      <div className="tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`tab ${active.id === tab.id ? "active" : ""}`}
            onClick={() => {
              setActive(tab);
              setCopied(false);
            }}
            role="tab"
            aria-selected={active.id === tab.id}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="qs-card">
        <p className="lead">{active.caption}</p>
        <div className="code-block">
          <button className="copy" onClick={copy} type="button">
            {copied ? "Copied" : "Copy"}
          </button>
          <pre>{active.text}</pre>
        </div>
      </div>
    </div>
  );
}
