"use client";

import { useEffect, useState } from "react";
import { liveStats } from "../lib/live-stats";
import { NPM_PACKAGE, NPM_PAGE } from "../lib/npm-downloads";

/**
 * The CLI's npm download count, big, under the headline. The page is built
 * with the number from build time; the Worker's daily number then replaces it.
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
    let current = true;
    liveStats().then((stats) => {
      if (current && stats?.downloads != null) setTotal(stats.downloads);
    });
    return () => {
      current = false;
    };
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
