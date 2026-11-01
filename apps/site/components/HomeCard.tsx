import Image from "next/image";
import { homeCopy, homeRelease } from "../lib/home";
import type { Lang } from "../lib/i18n";

/**
 * WilmAI Home on the front page, after the setup guides and the recipe (low on purpose: higher, it would pull parents
 * away from setting up their assistant): the app of your own, for a parent who doesn't use an AI assistant. A picture
 * of it, what it does in four lines, and the ways in (its download, its page).
 */
export default function HomeCard({ lang }: { lang: Lang }) {
  const t = homeCopy[lang].card;
  return (
    <section className="section home-card" aria-labelledby="home-card-title">
      <a className="home-card-shot" href={`/${lang}/home`} tabIndex={-1} aria-hidden="true">
        <Image src={`/home-today-${lang}.png`} alt="" width={1305} height={1134} />
      </a>
      <div className="home-card-copy">
        <p className="eyebrow">{t.eyebrow}</p>
        <h2 id="home-card-title">
          WilmAI Home <span className="home-beta">{homeRelease.version} Beta</span>
        </h2>
        <p className="home-card-text">{t.text}</p>
        <ul className="home-card-points">
          {t.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        <div className="home-card-actions">
          <a className="button primary small" href={`/${lang}/home#download`}>
            {t.download} ↓
          </a>
          <a className="button secondary small" href={`/${lang}/home`}>
            {t.link} →
          </a>
        </div>
      </div>
    </section>
  );
}
