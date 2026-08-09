import Image from "next/image";
import QuickStart from "../components/QuickStart";

export default function HomePage() {
  return (
    <main>
      <header className="topbar">
        <a className="wordmark" href="#">
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
        </div>
      </header>

      <section className="hero">
        <p className="taped-note">Ready for the new school year!</p>
        <h1>
          Wilma access for <span className="marker">AI&nbsp;agents</span>.
        </h1>
        <p className="disclaimer">
          This is an independent open-source project by a parent, not affiliated with,
          endorsed by, or connected to Visma or the official Wilma service.
        </p>
        <p className="hero-sub">
          An open-source CLI that lets AI agents read schedules, homework, exams,
          grades, messages, and news from Wilma. One command gives a full daily briefing.
        </p>
        <div className="hero-actions">
          <a className="button primary" href="#quickstart">
            Add Skill to Agent
          </a>
          <a className="button secondary" href="#quickstart">
            Install CLI
          </a>
        </div>

        <div className="terminal-stage">
          <p className="hand-note" aria-hidden="true">
            one command → the whole week
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
          <p className="eyebrow">copy, paste, done</p>
          <h2>Quick Start</h2>
        </div>
        <p className="lead">
          Choose your setup and copy the commands directly into your terminal.
        </p>
        <QuickStart />
      </section>

      <section className="section">
        <div className="section-head">
          <p className="eyebrow">three steps, one evening</p>
          <h2>How It Works</h2>
        </div>
        <div className="step-list">
          <div className="step">
            <span className="step-num">1</span>
            <strong>Pick your tenant (city)</strong>
            <span>WilmAI ships with a list of all Wilma tenants.</span>
          </div>
          <div className="step">
            <span className="step-num">2</span>
            <strong>Authenticate once</strong>
            <span>Your credentials are stored locally for fast re-use.</span>
          </div>
          <div className="step">
            <span className="step-num">3</span>
            <strong>Query your kids</strong>
            <span>Use JSON output or let your agent do the filtering.</span>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <p className="eyebrow">you ask, your agent runs it</p>
          <h2>What can I do with Wilma CLI?</h2>
        </div>
        <p className="lead">
          Run the CLI interactively or let your AI agent call the right command automatically.
          Every command works with multiple students and returns structured JSON for agents.
        </p>
        <div className="cards">
          <div className="note note-yellow">
            <h3>Daily briefing</h3>
            <p className="card-prompt">&quot;What do my kids have going on at school this week?&quot;</p>
            <code className="cmd">wilma summary</code>
          </div>
          <div className="note note-teal">
            <h3>Tomorrow&apos;s schedule</h3>
            <p className="card-prompt">&quot;What classes does Kiia have tomorrow?&quot;</p>
            <code className="cmd">wilma schedule</code>
          </div>
          <div className="note note-blue">
            <h3>Homework check</h3>
            <p className="card-prompt">&quot;Is there any homework due this week?&quot;</p>
            <code className="cmd">wilma homework</code>
          </div>
          <div className="note note-pink">
            <h3>Upcoming exams</h3>
            <p className="card-prompt">&quot;Are there any exams coming up? What should she study?&quot;</p>
            <code className="cmd">wilma exams</code>
          </div>
          <div className="note note-blue">
            <h3>Grades</h3>
            <p className="card-prompt">&quot;How did the last exams go?&quot;</p>
            <code className="cmd">wilma grades</code>
          </div>
          <div className="note note-yellow">
            <h3>Lesson notes</h3>
            <p className="card-prompt">&quot;Any feedback or absences logged today?&quot;</p>
            <code className="cmd">wilma attendance</code>
          </div>
          <div className="note note-blue">
            <h3>Messages</h3>
            <p className="card-prompt">&quot;Any new messages from school?&quot;</p>
            <code className="cmd">wilma messages</code>
          </div>
          <div className="note note-teal">
            <h3>School news</h3>
            <p className="card-prompt">&quot;What&apos;s happening at school this week?&quot;</p>
            <code className="cmd">wilma news</code>
          </div>
          <div className="note note-yellow">
            <h3>Multi-kid families</h3>
            <p className="card-prompt">&quot;Give me a summary for all my children.&quot;</p>
            <code className="cmd">--all-students</code>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <p className="eyebrow">good questions</p>
          <h2>FAQ</h2>
        </div>
        <div className="faq">
          <details>
            <summary>Where do my credentials live?</summary>
            <p>Locally on your machine. Nothing is stored on a server.</p>
          </details>
          <details>
            <summary>Do I need a backend?</summary>
            <p>No. WilmAI is a CLI and skill you run on your own machine.</p>
          </details>
          <details>
            <summary>What if my tenant changes?</summary>
            <p>Run login again and select a different tenant.</p>
          </details>
          <details>
            <summary>Is this officially endorsed by Wilma or Visma?</summary>
            <p>No. This is a hobby project made by a parent who was frustrated with the Wilma app. It is not officially supported or endorsed by Visma or the Wilma service.</p>
          </details>
          <details>
            <summary>Is this secure?</summary>
            <p>Your credentials are stored locally on your computer. We don&apos;t store any information outside of your control. It&apos;s up to you to decide how to handle them.</p>
          </details>
          <details>
            <summary>What about data security and compliance?</summary>
            <p>The CLI accesses the same data as the official Wilma app or website that parents already use. It&apos;s up to you to decide how it is appropriate to use that data.</p>
          </details>
        </div>
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
            Docs
          </a>
          <a href="https://github.com/aikarjal/wilmai/issues" target="_blank" rel="noreferrer">
            Issues
          </a>
        </div>
        <span>MIT Licensed</span>
      </footer>
    </main>
  );
}
