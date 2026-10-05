import Image from "next/image";
import GitHubChip from "./GitHubChip";
import LanguageToggle from "./LanguageToggle";
import { GITHUB_URL as GITHUB } from "../lib/github-stars";
import type { Dictionary, Lang } from "../lib/i18n";

/** `stars`: the repository's star count from build time, null if GitHub didn't answer. */
export function TopBar({ lang, stars }: { lang: Lang; stars: number | null }) {
  return (
    <header className="topbar">
      <a className="wordmark" href={`/${lang}`}>
        <Image
          src="/wilmai-mascot.png"
          alt=""
          width={1024}
          height={1024}
          className="wordmark-mascot"
          priority
        />
        WilmAI
      </a>
      <div className="nav-links">
        <GitHubChip initial={stars} locale={lang === "fi" ? "fi-FI" : "en-US"} />
        <LanguageToggle lang={lang} />
      </div>
    </header>
  );
}

export function Footer({ t }: { t: Dictionary }) {
  return (
    <footer className="footer">
      <Image
        src="/wilmai-mascot.png"
        alt="WilmAI mascot"
        width={1024}
        height={1024}
        className="footer-logo"
      />
      <div className="footer-links">
        <a href={GITHUB} target="_blank" rel="noreferrer">
          GitHub
        </a>
        <a href={`${GITHUB}#readme`} target="_blank" rel="noreferrer">
          {t.footer.docs}
        </a>
        <a href={`${GITHUB}/issues`} target="_blank" rel="noreferrer">
          {t.footer.issues}
        </a>
      </div>
      <p className="footer-disclaimer">{t.hero.disclaimer}</p>
      <span>{t.footer.licensed}</span>
    </footer>
  );
}
