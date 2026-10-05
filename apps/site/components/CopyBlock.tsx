"use client";

import { useEffect, useId, useRef, useState } from "react";

/** Labels for a "message": its copy button and the toggle that unfolds a long one. */
export interface MessageLabels {
  copy: string;
  show: string;
  hide: string;
}

// A long message shows this many lines until it's unfolded.
const PREVIEW_LINES = 3;

/**
 * Copyable text. "command" is terminal input (dark, monospace); "message" is
 * something the parent sends to their assistant (light, regular text). A long
 * message is folded to its first lines: the parent only needs to copy it, so
 * the copy button is the main thing.
 */
export default function CopyBlock({
  text,
  variant = "command",
  copyLabel,
  copiedLabel,
  messageLabels
}: {
  text: string;
  variant?: "command" | "message";
  copyLabel: string;
  copiedLabel: string;
  messageLabels?: MessageLabels;
}) {
  const [copied, setCopied] = useState(false);
  // Assume long until measured, so a long message doesn't flash open on load.
  const [long, setLong] = useState(true);
  const [open, setOpen] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);
  const textId = useId();

  useEffect(() => {
    const element = textRef.current;
    if (variant !== "message" || !element) return;
    const measure = () => {
      const line = parseFloat(getComputedStyle(element).lineHeight);
      setLong(element.scrollHeight > line * PREVIEW_LINES + 4);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [variant, text]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  if (variant === "message") {
    return (
      <div className="message">
        <div className={`message-block ${long && !open ? "folded" : ""}`}>
          <p className="message-text" id={textId} ref={textRef}>
            {text}
          </p>
        </div>
        <div className="message-actions">
          <button className="button primary small" onClick={copy} type="button" aria-live="polite">
            {copied ? copiedLabel : (messageLabels?.copy ?? copyLabel)}
          </button>
          {long && messageLabels ? (
            <button
              className="message-toggle"
              type="button"
              aria-expanded={open}
              aria-controls={textId}
              onClick={() => setOpen(!open)}
            >
              {open ? messageLabels.hide : messageLabels.show}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="code-block">
      <button className="copy" onClick={copy} type="button" aria-live="polite">
        {copied ? copiedLabel : copyLabel}
      </button>
      <pre>{text}</pre>
    </div>
  );
}
