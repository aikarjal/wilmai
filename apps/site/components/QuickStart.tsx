"use client";

import { useState } from "react";

const agentText = `# 1) Install the CLI\nnpm install -g @wilm-ai/wilma-cli\n\n# 2) Login once (interactive)\nwilma\n\n# 3) Add the Wilma skill to your agent\nnpx skills add aikarjal/wilmai`;

const cliText = `# 1) Install the CLI\nnpm install -g @wilm-ai/wilma-cli\n\n# 2) Login once (interactive)\nwilma\n\n# 3) Query data\nwilma kids list --json`;

export interface QuickStartLabels {
  tabAgent: string;
  tabAgentCaption: string;
  tabCli: string;
  tabCliCaption: string;
  copy: string;
  copied: string;
}

export default function QuickStart({ labels }: { labels: QuickStartLabels }) {
  const tabs = [
    {
      id: "agent",
      label: labels.tabAgent,
      caption: labels.tabAgentCaption,
      text: agentText
    },
    {
      id: "cli",
      label: labels.tabCli,
      caption: labels.tabCliCaption,
      text: cliText
    }
  ] as const;

  const [activeId, setActiveId] = useState<(typeof tabs)[number]["id"]>("agent");
  const [copied, setCopied] = useState(false);
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

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
              setActiveId(tab.id);
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
            {copied ? labels.copied : labels.copy}
          </button>
          <pre>{active.text}</pre>
        </div>
      </div>
    </div>
  );
}
