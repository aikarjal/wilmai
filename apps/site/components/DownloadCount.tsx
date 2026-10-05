"use client";

import { useEffect, useState } from "react";
import { NPM_PACKAGE, NPM_PAGE } from "../lib/npm-downloads";

/**
 * The CLI's npm download count, big, under the headline. The page is built
 * with the number from build time; the Worker's /api/downloads then brings it
 * up to date.
 */
export default function DownloadCount({
  initial,
  locale,
  label,
  proof,
  fallback
}: {
  initial: number | null;
  locale: string;
  label: string;
  proof: string;
  fallback: string;
}) {
  const [total, setTotal] = useState(initial);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/downloads", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { total?: unknown } | null) => {
        if (typeof body?.total === "number") setTotal(body.total);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  if (total === null) {
    return (
      <p className="hero-stat-fallback">
        {fallback} · {proof}
      </p>
    );
  }
  return (
    <div className="hero-stat">
      <a className="hero-stat-count" href={NPM_PAGE} target="_blank" rel="noreferrer" title={`npm: ${NPM_PACKAGE}`}>
        {total.toLocaleString(locale)}
      </a>
      <p className="hero-stat-label">
        <strong>{label}</strong>
        {proof}
      </p>
    </div>
  );
}
