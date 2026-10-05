"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { AgentGuide, AgentId, ComingLater } from "../lib/agents";
import AgentSetup, { type SetupLabels } from "./AgentSetup";

export interface PickerLabels extends SetupLabels {
  picker: string;
  help: string;
  helpLink: string;
  comingLaterTitle: string;
  comingLaterNote: string;
}

/**
 * Assistant picker with every setup guide on the page. The URL hash names the
 * open guide (/fi#chatgpt), so links to one assistant's steps can be shared.
 */
export default function AgentPicker({
  items,
  comingLater,
  labels
}: {
  items: { id: AgentId; logo: string; guide: AgentGuide }[];
  comingLater: ComingLater[];
  labels: PickerLabels;
}) {
  const [activeId, setActiveId] = useState<AgentId>(items[0].id);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = items.find((item) => item.id === activeId) ?? items[0];

  useEffect(() => {
    // Opens a guide and shows it with its section heading ("Choose your assistant").
    const open = (id: string) => {
      const match = items.find((item) => item.id === id);
      if (!match) return false;
      setActiveId(match.id);
      const target = rootRef.current?.closest("section") ?? rootRef.current;
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
      return true;
    };
    open(window.location.hash.slice(1));
    const onHashChange = () => open(window.location.hash.slice(1));
    // Links to a guide elsewhere on the page (#claude, #openclaw). Handled here
    // because a link to the hash already in the address fires no hashchange.
    const onClick = (event: MouseEvent) => {
      const href = (event.target as Element | null)?.closest?.("a")?.getAttribute("href");
      if (!href?.startsWith("#") || !open(href.slice(1))) return;
      event.preventDefault();
      history.replaceState(null, "", href);
    };
    window.addEventListener("hashchange", onHashChange);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      document.removeEventListener("click", onClick);
    };
  }, [items]);

  const choose = (id: AgentId) => {
    setActiveId(id);
    history.replaceState(null, "", `#${id}`);
  };

  // Tabs pattern: arrow keys (and Home/End) move between assistants.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const index = items.findIndex((item) => item.id === active.id);
    const next =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? (index + 1) % items.length
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? (index - 1 + items.length) % items.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : -1;
    if (next === -1) return;
    event.preventDefault();
    choose(items[next].id);
    document.getElementById(`tab-${items[next].id}`)?.focus();
  };

  return (
    <div className="picker" ref={rootRef}>
      <div className="picker-tiles" role="tablist" aria-label={labels.picker} onKeyDown={onKeyDown}>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={item.id === active.id}
            aria-controls="picker-panel"
            tabIndex={item.id === active.id ? 0 : -1}
            className={`picker-tile ${item.id === active.id ? "active" : ""}`}
            onClick={() => choose(item.id)}
          >
            <span className="picker-name">
              {item.guide.name}
              <Image className="logo" src={item.logo} alt="" width={20} height={20} />
            </span>
            <span className="picker-tagline">{item.guide.tagline}</span>
          </button>
        ))}
      </div>
      <div className="picker-panel" id="picker-panel" role="tabpanel" aria-labelledby={`tab-${active.id}`}>
        <div className="picker-panel-head">
          <h3>
            {active.guide.name}
            <Image className="logo" src={active.logo} alt="" width={24} height={24} />
          </h3>
          {active.guide.status ? <span className="status-chip">{active.guide.status}</span> : null}
        </div>
        <AgentSetup guide={active.guide} labels={labels} />
        <p className="picker-help">
          {labels.help}{" "}
          <a href="https://github.com/aikarjal/wilmai/issues" target="_blank" rel="noreferrer">
            {labels.helpLink}
          </a>
        </p>
      </div>
      <div className="coming-later">
        <p className="coming-later-title">{labels.comingLaterTitle}</p>
        <ul>
          {comingLater.map((item) => (
            <li key={item.name}>
              <Image className="logo" src={item.logo} alt="" width={18} height={18} />
              <span>
                <strong>{item.name}</strong> — {item.note}
              </span>
            </li>
          ))}
        </ul>
        <p className="coming-later-note">{labels.comingLaterNote}</p>
      </div>
    </div>
  );
}
