import Image from "next/image";
import AgentPicker from "../../components/AgentPicker";
import DownloadCount from "../../components/DownloadCount";
import { Footer, TopBar } from "../../components/SiteChrome";
import { agents, comingLater } from "../../lib/agents";
import { dictionaries, isLang, type Lang } from "../../lib/i18n";
import { totalDownloads } from "../../lib/npm-downloads";

export default async function HomePage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: requested } = await params;
  const lang: Lang = isLang(requested) ? requested : "en";
  const t = dictionaries[lang];
  // The count at build time; the counter updates itself in the browser.
  const downloads = await totalDownloads({ signal: AbortSignal.timeout(5000) }).catch(() => null);

  return (
    <main>
      <TopBar lang={lang} />

      <section className="hero">
        <p className="taped-note">{t.hero.tapedNote}</p>
        <h1>
          {t.hero.h1Pre}
          <span className="marker">{t.hero.h1Marker}</span>.
        </h1>
        <p className="disclaimer">{t.hero.disclaimer}</p>
        <DownloadCount
          initial={downloads}
          locale={lang === "fi" ? "fi-FI" : "en-US"}
          label={t.hero.downloads}
          proof={t.hero.proof}
          fallback={t.hero.downloadsFallback}
        />
        <p className="hero-sub">{t.hero.sub}</p>
        <div className="hero-actions">
          <a className="button primary" href="#quickstart">
            {t.hero.ctaPrimary}
          </a>
          <a className="button secondary" href="#cli">
            {t.hero.ctaSecondary}
          </a>
        </div>

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

      <section className="section" id="quickstart">
        <div className="section-head">
          <p className="eyebrow">{t.quickstart.eyebrow}</p>
          <h2>{t.quickstart.title}</h2>
        </div>
        <p className="lead">{t.quickstart.lead}</p>
        <AgentPicker
          items={agents.map((agent) => ({ id: agent.id, logo: agent.logo, guide: agent.guide[lang] }))}
          comingLater={comingLater[lang]}
          labels={{
            copy: t.quickstart.copy,
            copied: t.quickstart.copied,
            picker: t.quickstart.picker,
            help: t.quickstart.help,
            helpLink: t.quickstart.helpLink,
            comingLaterTitle: t.quickstart.comingLaterTitle,
            comingLaterNote: t.quickstart.comingLaterNote
          }}
        />
      </section>

      <section className="section">
        <div className="section-head">
          <p className="eyebrow">{t.how.eyebrow}</p>
          <h2>{t.how.title}</h2>
        </div>
        <div className="step-list">
          {t.how.steps.map((step, i) => (
            <div className="step" key={step.title}>
              <span className="step-num">{i + 1}</span>
              <strong>{step.title}</strong>
              <span>{step.body}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
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

      <section className="section">
        <div className="section-head">
          <p className="eyebrow">{t.recipe.eyebrow}</p>
          <h2>
            {t.recipe.title}
            <Image className="recipe-lobster" src="/logos/openclaw.svg" alt="" width={44} height={44} />
          </h2>
        </div>
        <p className="lead">{t.recipe.lead}</p>
        <div className="recipe-card">
          <p className="recipe-quote">{t.recipe.quote}</p>
          <p className="recipe-tail">
            {t.recipe.tail}{" "}
            <a
              href="https://clawhub.ai/aikarjal/wilma"
              target="_blank"
              rel="noreferrer"
            >
              {t.recipe.linkLabel}
            </a>
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
      </section>

      <Footer t={t} />
    </main>
  );
}
