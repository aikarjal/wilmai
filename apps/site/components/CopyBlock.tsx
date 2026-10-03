"use client";

import { useState } from "react";

/**
 * Copyable text. "command" is terminal input (dark, monospace); "message" is
 * something the parent sends to their assistant (light, regular text).
 */
export default function CopyBlock({
  text,
  variant = "command",
  copyLabel,
  copiedLabel
}: {
  text: string;
  variant?: "command" | "message";
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const button = (
    <button className="copy" onClick={copy} type="button" aria-live="polite">
      {copied ? copiedLabel : copyLabel}
    </button>
  );

  if (variant === "message") {
    return (
      <div className="message-block">
        <p className="message-text">{text}</p>
        {button}
      </div>
    );
  }

  return (
    <div className="code-block">
      {button}
      <pre>{text}</pre>
    </div>
  );
}
