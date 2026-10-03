import Image from "next/image";
import LanguageToggle from "./LanguageToggle";
import type { Dictionary, Lang } from "../lib/i18n";

const GITHUB = "https://github.com/aikarjal/wilmai";

export function TopBar({ lang }: { lang: Lang }) {
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
        <a className="chip" href={GITHUB} target="_blank" rel="noreferrer">
          <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          GitHub
        </a>
        <iframe
          className="github-stars"
          title="GitHub stars"
          src="https://ghbtns.com/github-btn.html?user=aikarjal&repo=wilmai&type=star&count=true&size=large"
          frameBorder="0"
          scrolling="0"
          width="130"
          height="30"
          loading="lazy"
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        />
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
      <span>{t.footer.licensed}</span>
    </footer>
  );
}
