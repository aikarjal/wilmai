import Image from "next/image";
import AgentPicker from "../../components/AgentPicker";
import DownloadCount from "../../components/DownloadCount";
import { Footer, TopBar } from "../../components/SiteChrome";
import { agents } from "../../lib/agents";
import { githubStars } from "../../lib/github-stars";
import { dictionaries, isLang, type Lang } from "../../lib/i18n";
import { totalDownloads } from "../../lib/npm-downloads";

export default async function HomePage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: requested } = await params;
  const lang: Lang = isLang(requested) ? requested : "en";
  const t = dictionaries[lang];
  // The counts at build time; the download counter updates itself in the browser.
  const [downloads, stars] = await Promise.all([
    totalDownloads({ signal: AbortSignal.timeout(5000) }).catch(() => null),
    githubStars({ signal: AbortSignal.timeout(5000) }).catch(() => null)
  ]);
  // The recipe heading ends with OpenClaw's lobster; it stays on the line of the last word.
  const recipeSplit = t.recipe.title.lastIndexOf(" ");

  return (
    <main>
      <TopBar lang={lang} stars={stars} />

      <section className="hero">
        <p className="taped-note">{t.hero.tapedNote}</p>
        <h1>
          {t.hero.h1Pre}
          <span className="marker">{t.hero.h1Marker}</span>.
        </h1>
        <details className="disclaimer">
          <summary>{t.hero.disclaimerShort}</summary>
          <p>{t.hero.disclaimer}</p>
        </details>
        <DownloadCount
          initial={downloads}
          locale={lang === "fi" ? "fi-FI" : "en-US"}
          label={t.hero.downloads}
          proof={t.hero.proof}
          fallback={t.hero.downloadsFallback}
        />
        <p className="hero-sub">{t.hero.sub}</p>
        <div className="hero-actions">
          <a className="button primary" href="#claude">
            {t.hero.ctaPrimary}
          </a>
          <a className="button secondary" href="#ask">
            {t.hero.ctaSecondary}
          </a>
        </div>
        <p className="works-with">
          <span className="works-with-label">{t.hero.worksWith}</span>
          {agents
            .filter((agent) => agent.brand)
            .map((agent) => (
              <a key={agent.id} href={`#${agent.id}`}>
                <Image className="logo" src={agent.logo} alt="" width={18} height={18} />
                {agent.brand}
              </a>
            ))}
        </p>

        <div className="terminal-stage">
          <p className="hand-note" aria-hidden="true">
            {t.hero.handNote}
            <svg
              className="hand-arrow"
              viewBox="0 0 120 60"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M6 8 C 30 44, 72 52, 106 34"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <path
                d="M94 30 L 107 33.5 L 98 44"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </p>
          <Image
            src="/wilmai-mascot.png"
            alt="WilmAI mascot"
            width={1024}
            height={1024}
            className="terminal-sticker"
          />
          <div className="chat" role="figure" aria-label={t.hero.chatTitle}>
            <div className="chat-chrome">
              <span className="dot red" />
              <span className="dot yellow" />
              <span className="dot green" />
              <span className="chat-title">{t.hero.chatTitle}</span>
            </div>
            <div className="chat-body">
              <p className="chat-bubble chat-user">{t.hero.chatQuestion}</p>
              <div className="chat-bubble chat-assistant">
                {t.hero.chatAnswer.map((line) => (
                  <p key={line.text}>
                    {line.name ? <strong>{line.name}: </strong> : null}
                    {line.text}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="ask">
        <div className="section-head">
          <p className="eyebrow">{t.ask.eyebrow}</p>
          <h2>{t.ask.title}</h2>
        </div>
        <p className="lead">{t.ask.lead}</p>
        <div className="cards">
          {t.ask.cards.map((card) => (
            <div className={`note note-${card.color}`} key={card.title}>
              <h3>{card.title}</h3>
              <p className="card-prompt">{card.prompt}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section" id="quickstart">
        <div className="section-head">
          <p className="eyebrow">{t.quickstart.eyebrow}</p>
          <h2>{t.quickstart.title}</h2>
        </div>
        <p className="lead">{t.quickstart.lead}</p>
        <AgentPicker
          items={agents.map((agent) => ({
            id: agent.id,
            logo: agent.logo,
            terminal: agent.terminal,
            guide: agent.guide[lang]
          }))}
          labels={{
            copy: t.quickstart.copy,
            copyMessage: t.quickstart.copyMessage,
            copied: t.quickstart.copied,
            showMessage: t.quickstart.showMessage,
            hideMessage: t.quickstart.hideMessage,
            downloadOnComputer: t.quickstart.downloadOnComputer,
            picker: t.quickstart.picker,
            terminalRow: t.quickstart.terminalRow,
            phoneNote: t.quickstart.phoneNote,
            phoneShare: t.quickstart.phoneShare,
            phoneCopied: t.quickstart.phoneCopied,
            help: t.quickstart.help,
            helpLink: t.quickstart.helpLink,
            comingLater: t.quickstart.comingLater
          }}
        />
      </section>

      <section className="section">
        <div className="section-head">
          <p className="eyebrow">{t.recipe.eyebrow}</p>
          <h2>
            {t.recipe.title.slice(0, recipeSplit + 1)}
            <span className="nowrap">
              {t.recipe.title.slice(recipeSplit + 1)}
              <Image className="recipe-lobster" src="/logos/openclaw.svg" alt="" width={40} height={40} />
            </span>
          </h2>
        </div>
        <p className="lead">{t.recipe.lead}</p>
        <div className="recipe-card">
          <p className="recipe-quote">{t.recipe.quote}</p>
          <p className="recipe-tail">
            {t.recipe.tail}{" "}
            <a href="#openclaw">{t.recipe.linkLabel}</a>
          </p>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <p className="eyebrow">{t.faq.eyebrow}</p>
          <h2>{t.faq.title}</h2>
        </div>
        <div className="faq">
          {t.faq.items.map((item) => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              {item.a}
            </details>
          ))}
        </div>
      </section>

      <section className="closing">
        <p className="eyebrow">{t.closing.eyebrow}</p>
        <p className="closing-text">{t.closing.text}</p>
        <p className="closing-signature">{t.closing.signature}</p>
        <a className="button primary" href="#claude">
          {t.hero.ctaPrimary}
        </a>
      </section>

      <Footer t={t} />
    </main>
  );
}
