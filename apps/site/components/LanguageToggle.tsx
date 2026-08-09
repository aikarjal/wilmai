"use client";

import type { Lang } from "../lib/i18n";

const labels: Record<Lang, string> = { en: "EN", fi: "FI" };

export default function LanguageToggle({ lang }: { lang: Lang }) {
  const remember = (next: Lang) => {
    document.cookie = `lang=${next};path=/;max-age=31536000;SameSite=Lax`;
  };

  return (
    <div className="lang-toggle" aria-label="Language">
      {(Object.keys(labels) as Lang[]).map((code) => (
        <a
          key={code}
          href={`/${code}`}
          className={`lang-option ${code === lang ? "active" : ""}`}
          aria-current={code === lang ? "true" : undefined}
          lang={code}
          hrefLang={code}
          onClick={() => remember(code)}
        >
          {labels[code]}
        </a>
      ))}
    </div>
  );
}
