import Image from "next/image";
import QuickStart from "../../components/QuickStart";
import LanguageToggle from "../../components/LanguageToggle";
import { dictionaries, isLang, type Lang } from "../../lib/i18n";

export default function HomePage({ params }: { params: { lang: string } }) {
  const lang: Lang = isLang(params.lang) ? params.lang : "en";
  const t = dictionaries[lang];

  return (
    <main>
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
          <a
            className="chip"
            href="https://github.com/aikarjal/wilmai"
            target="_blank"
            rel="noreferrer"
          >
            <svg
              viewBox="0 0 16 16"
              width="18"
              height="18"
              fill="currentColor"
              aria-hidden="true"
            >
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
          />
          <a
            className="chip"
            href="https://clawhub.ai/aikarjal/wilma"
            target="_blank"
            rel="noreferrer"
          >
            🦞 ClawHub
          </a>
          <LanguageToggle lang={lang} />
        </div>
      </header>

      <section className="hero">
        <p className="taped-note">{t.hero.tapedNote}</p>
        <h1>
          {t.hero.h1Pre}
          <span className="marker">{t.hero.h1Marker}</span>.
        </h1>
        <p className="disclaimer">{t.hero.disclaimer}</p>
        <p className="hero-sub">{t.hero.sub}</p>
        <div className="hero-actions">
          <a className="button primary" href="#quickstart">
            {t.hero.ctaPrimary}
          </a>
          <a className="button secondary" href="#quickstart">
            {t.hero.ctaSecondary}
          </a>
        </div>
        <p className="hero-proof">{t.hero.proof}</p>

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
          <div className="terminal">
            <div className="terminal-chrome">
              <span className="dot red" />
              <span className="dot yellow" />
              <span className="dot green" />
              <span className="terminal-title">wilma-cli</span>
            </div>
            <pre className="terminal-body">
              <span className="t-prompt">$</span>{" "}
              <span className="t-cmd">wilma summary --student &quot;Kiia&quot;</span>
              {`

Summary for Kiia (2025-03-10)

`}
              <span className="t-head">TODAY (2025-03-10)</span>
              {`
  `}
              <span className="t-dim">08:30-09:15</span>
              {`  Liikunta
  `}
              <span className="t-dim">10:30-11:15</span>
              {`  Matematiikka
  `}
              <span className="t-dim">11:15-12:15</span>
              {`  Suomen kieli ja kirjallisuus

`}
              <span className="t-head">TOMORROW (2025-03-11)</span>
              {`
  `}
              <span className="t-dim">08:30-09:15</span>
              {`  Matematiikka
  `}
              <span className="t-dim">09:15-10:00</span>
              {`  Musiikki
  `}
              <span className="t-dim">10:30-11:15</span>
              {`  Englanti, A1

`}
              <span className="t-head">UPCOMING EXAMS</span>
              {`
  `}
              <span className="t-dim">2025-03-18</span>
              {`  Englanti, A1: Unit 3 koe — Kpl 7, 8 ja 9

`}
              <span className="t-head">RECENT HOMEWORK</span>
              {`
  `}
              <span className="t-dim">2025-03-10</span>
              {`  Englanti, A1: Opettele kpl 8 sanat
  `}
              <span className="t-dim">2025-03-09</span>
              {`  Matematiikka: s. 117 teht. 2-4

`}
              <span className="t-head">NEWS (last 7 days)</span>
              {`
  `}
              <span className="t-dim">2025-03-08</span>
              {`  Luistelupäivä tiistaina 11.3. (id:4501)

`}
              <span className="t-head">MESSAGES (last 7 days)</span>
              {`
  `}
              <span className="t-dim">2025-03-09</span>
              {`  Retken tiedot ja luvat (id:12345)
  `}
              <span className="t-dim">2025-03-07</span>
              {`  Uimahallikäynti pe 14.3. (id:12300)`}
            </pre>
          </div>
        </div>
      </section>

      <section className="section" id="quickstart">
        <div className="section-head">
          <p className="eyebrow">{t.quickstart.eyebrow}</p>
          <h2>{t.quickstart.title}</h2>
        </div>
        <p className="lead">{t.quickstart.lead}</p>
        <QuickStart
          labels={{
            tabAgent: t.quickstart.tabAgent,
            tabAgentCaption: t.quickstart.tabAgentCaption,
            tabCli: t.quickstart.tabCli,
            tabCliCaption: t.quickstart.tabCliCaption,
            copy: t.quickstart.copy,
            copied: t.quickstart.copied
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
            <div className={`note note-${card.color}`} key={card.cmd}>
              <h3>{card.title}</h3>
              <p className="card-prompt">{card.prompt}</p>
              <code className="cmd">{card.cmd}</code>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <p className="eyebrow">{t.recipe.eyebrow}</p>
          <h2>{t.recipe.title}</h2>
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

      <footer className="footer">
        <Image
          src="/wilmai-mascot.png"
          alt="WilmAI mascot"
          width={1024}
          height={1024}
          className="footer-logo"
        />
        <div className="footer-links">
          <a href="https://github.com/aikarjal/wilmai" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href="https://github.com/aikarjal/wilmai#readme" target="_blank" rel="noreferrer">
            {t.footer.docs}
          </a>
          <a href="https://github.com/aikarjal/wilmai/issues" target="_blank" rel="noreferrer">
            {t.footer.issues}
          </a>
        </div>
        <span>{t.footer.licensed}</span>
      </footer>
    </main>
  );
}
