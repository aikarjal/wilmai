import Image from "next/image";
import { homeCopy } from "../lib/home";
import type { Lang } from "../lib/i18n";

/**
 * The strip across the very top of the front page: WilmAI Home, a picture of it, what it gives you in a line, and a
 * button into its page. On phones, the picture, the name and the button.
 */
export default function HomeBanner({ lang }: { lang: Lang }) {
  const t = homeCopy[lang].announce;
  return (
    <a className="home-banner" href={`/${lang}/home`}>
      <span className="home-banner-inner">
        <Image className="home-banner-shot" src={`/home-thumb-${lang}.png`} alt="" width={240} height={160} priority />
        <span className="home-banner-text">
          <span className="home-banner-title">
            <span className="home-banner-badge">
              <svg className="home-sparkle" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 1.5c.7 4.6 2.5 7.2 7 8.4.6.2.6 1 0 1.2-4.5 1.2-6.3 3.8-7 8.4-.1.7-1 .7-1.1 0-.7-4.6-2.5-7.2-7-8.4-.6-.2-.6-1 0-1.2 4.5-1.2 6.3-3.8 7-8.4.1-.7 1-.7 1.1 0Z" />
              </svg>
              {t.badge}
            </span>
            <b>{t.text}</b>
            <span className="home-banner-comma">, </span>
            <span className="home-banner-more">{t.more}</span>
          </span>
          <span className="home-banner-detail">{t.detail}</span>
        </span>
        <span className="home-banner-cta">
          {t.cta} <span className="home-banner-arrow" aria-hidden="true">→</span>
        </span>
      </span>
    </a>
  );
}
