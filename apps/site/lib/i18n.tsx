import type { ReactNode } from "react";

export const locales = ["en", "fi"] as const;
export type Lang = (typeof locales)[number];

export function isLang(value: string): value is Lang {
  return (locales as readonly string[]).includes(value);
}

interface Card {
  title: string;
  prompt: string;
  cmd: string;
  color: "yellow" | "teal" | "blue" | "pink";
}

interface Step {
  title: string;
  body: string;
}

interface FaqItem {
  q: string;
  a: ReactNode;
}

export interface Dictionary {
  meta: { title: string; description: string };
  hero: {
    tapedNote: string;
    h1Pre: string;
    h1Marker: string;
    disclaimer: string;
    sub: string;
    ctaPrimary: string;
    ctaSecondary: string;
    proof: string;
    handNote: string;
  };
  quickstart: {
    eyebrow: string;
    title: string;
    lead: string;
    tabAgent: string;
    tabAgentCaption: string;
    tabCli: string;
    tabCliCaption: string;
    copy: string;
    copied: string;
  };
  how: { eyebrow: string; title: string; steps: Step[] };
  ask: { eyebrow: string; title: string; lead: string; cards: Card[] };
  recipe: {
    eyebrow: string;
    title: string;
    lead: string;
    quote: string;
    tail: string;
    linkLabel: string;
  };
  faq: { eyebrow: string; title: string; items: FaqItem[] };
  closing: { eyebrow: string; text: string };
  footer: { docs: string; issues: string; licensed: string };
}

const en: Dictionary = {
  meta: {
    title: "WilmAI — School data for AI agents",
    description:
      "WilmAI gives your AI agent read access to Wilma — schedules, homework, exams, messages, and news — as one daily briefing for the whole family."
  },
  hero: {
    tapedNote: "New school year? Ten-minute setup.",
    h1Pre: "Wilma access for ",
    h1Marker: "your AI agent",
    disclaimer:
      "This is an independent open-source project by a parent, not affiliated with, endorsed by, or connected to Visma or the official Wilma service.",
    sub: "Keeping up with school is work — schedules, homework, exams, messages, and news, times every kid, sometimes across different schools. WilmAI is an open-source CLI that lets your AI agent read Wilma and hand you one plain briefing for the whole family.",
    ctaPrimary: "Add Skill to Agent",
    ctaSecondary: "Install the CLI",
    proof: "Downloaded thousands of times · in daily use by parents across Finland",
    handNote: "one command → the whole week"
  },
  quickstart: {
    eyebrow: "copy, paste, done",
    title: "Quick Start",
    lead: "Pick your setup and paste three commands into your terminal.",
    tabAgent: "With an AI agent",
    tabAgentCaption: "Adds Wilma as a skill for Claude Code, OpenAI, or OpenClaw.",
    tabCli: "Terminal only",
    tabCliCaption: "Plain CLI, no agent involved.",
    copy: "Copy",
    copied: "Copied"
  },
  how: {
    eyebrow: "three steps, ten minutes",
    title: "How It Works",
    steps: [
      {
        title: "Find your city's Wilma",
        body: "WilmAI knows every Wilma address in Finland. Pick yours from the list."
      },
      {
        title: "Log in once",
        body: "Your credentials stay in one file on your machine — never on a server."
      },
      {
        title: "Ask about your kids",
        body: "Plain language in, one briefing out. Your agent picks the right command."
      }
    ]
  },
  ask: {
    eyebrow: "you ask, your agent runs it",
    title: "What can you ask?",
    lead: "Run the CLI yourself or let your agent call it. Every command works with multiple students and returns structured JSON for agents.",
    cards: [
      {
        title: "Daily briefing",
        prompt: "“What do my kids have going on at school this week?”",
        cmd: "wilma summary",
        color: "yellow"
      },
      {
        title: "Tomorrow's schedule",
        prompt: "“What classes does Kiia have tomorrow?”",
        cmd: "wilma schedule",
        color: "teal"
      },
      {
        title: "Homework check",
        prompt: "“Is there any homework due this week?”",
        cmd: "wilma homework",
        color: "blue"
      },
      {
        title: "Upcoming exams",
        prompt: "“Are there any exams coming up? What should she study?”",
        cmd: "wilma exams",
        color: "pink"
      },
      {
        title: "Grades",
        prompt: "“How did the last exams go?”",
        cmd: "wilma grades",
        color: "blue"
      },
      {
        title: "Lesson notes",
        prompt: "“Any feedback or absences logged today?”",
        cmd: "wilma attendance",
        color: "yellow"
      },
      {
        title: "Messages",
        prompt: "“Any new messages from school?”",
        cmd: "wilma messages",
        color: "blue"
      },
      {
        title: "School news",
        prompt: "“What's happening at school this week?”",
        cmd: "wilma news",
        color: "teal"
      },
      {
        title: "Multi-kid families",
        prompt: "“Give me a summary for all my children.”",
        cmd: "--all-students",
        color: "yellow"
      }
    ]
  },
  recipe: {
    eyebrow: "a recipe",
    title: "Pairs well with OpenClaw",
    lead: "Install the skill, then tell your agent what mornings should look like. Parents run things like:",
    quote:
      "“Every weekday at 7, post a school briefing for both kids to the family channel, and put new exams in the family calendar.”",
    tail: "One instruction — your agent handles the rest. Or skip the setup and grab the ready-made wilma-triage skill from the repo.",
    linkLabel: "Get the skill on ClawHub →"
  },
  faq: {
    eyebrow: "good questions",
    title: "FAQ",
    items: [
      {
        q: "Where do my credentials live?",
        a: (
          <p>
            In one file on your computer: <code>~/.config/wilmai/config.json</code>,
            readable only by your user account. Remove it any time with{" "}
            <code>wilma config clear</code>.
          </p>
        )
      },
      {
        q: "Do I need a backend?",
        a: (
          <p>
            No. WilmAI runs entirely on your machine. There is no server, no
            account, and nothing to sign up for.
          </p>
        )
      },
      {
        q: "Is this secure?",
        a: (
          <p>
            WilmAI talks only to your school&apos;s official Wilma servers, using
            your own login. There is no middleman, no analytics, and no telemetry.
            It is also read-only — it can&apos;t send messages or change anything
            in Wilma.
          </p>
        )
      },
      {
        q: "Does school data end up with an AI company?",
        a: (
          <p>
            Not from the CLI — it sends data nowhere except Wilma. If you connect
            an agent, that agent reads the CLI&apos;s output, the same as if you
            pasted it into a chat. Pick a provider you trust, or stay
            terminal-only.
          </p>
        )
      },
      {
        q: "What data can it see?",
        a: (
          <p>
            Exactly what you already see as a parent in the Wilma app, fetched
            with your own login. Nothing extra, nothing scraped.
          </p>
        )
      },
      {
        q: "What if my tenant changes?",
        a: (
          <p>
            Run login again and pick the new city — you can keep several profiles
            side by side.
          </p>
        )
      },
      {
        q: "Is this officially endorsed by Wilma or Visma?",
        a: (
          <p>
            No. This is a hobby project made by a parent who wanted a better way
            to keep up. It is not officially supported or endorsed by Visma or
            the Wilma service.
          </p>
        )
      }
    ]
  },
  closing: {
    eyebrow: "why this exists",
    text: "Parents keep telling me the same thing: they've never been this up to date with what's happening at school. It brings more joy than you'd expect. I hope it does the same for your family."
  },
  footer: { docs: "Docs", issues: "Issues", licensed: "MIT Licensed" }
};

const fi: Dictionary = {
  meta: {
    title: "WilmAI — Wilma tekoälyagenteille",
    description:
      "WilmAI antaa tekoälyagentillesi lukuoikeuden Wilmaan — lukujärjestykset, läksyt, kokeet, viestit ja tiedotteet yhtenä päivittäisenä koosteena koko perheelle."
  },
  hero: {
    tapedNote: "Uusi lukuvuosi? Käyttöön 10 minuutissa.",
    h1Pre: "Wilma suoraan ",
    h1Marker: "tekoälyagentillesi",
    disclaimer:
      "Tämä on vanhemman tekemä itsenäinen avoimen lähdekoodin projekti. Kyseessä ei ole Visman tai virallisen Wilma-palvelun tekemä, tukema tai hyväksymä ratkaisu.",
    sub: "Koulun kuulumisten mukana pysyminen on työtä — lukujärjestykset, läksyt, kokeet, viestit ja tiedotteet, jokaisen lapsen osalta, joskus eri kouluissa. WilmAI on avoimen lähdekoodin komentorivityökalu, jonka avulla tekoälyagenttisi lukee Wilmaa ja kokoaa koko perheen kuulumiset yhteen selkeään koosteeseen.",
    ctaPrimary: "Lisää taito agentillesi",
    ctaSecondary: "Asenna CLI",
    proof: "Ladattu tuhansia kertoja · päivittäisessä käytössä suomalaisperheissä",
    handNote: "yksi komento → koko viikko"
  },
  quickstart: {
    eyebrow: "kopioi, liitä, valmis",
    title: "Pika-aloitus",
    lead: "Valitse tapasi ja liitä kolme komentoa terminaaliin.",
    tabAgent: "Tekoälyagentilla",
    tabAgentCaption: "Lisää Wilman taidoksi Claude Codeen, OpenAI:hin tai OpenClaw'hun.",
    tabCli: "Vain terminaali",
    tabCliCaption: "Pelkkä CLI, ilman agenttia.",
    copy: "Kopioi",
    copied: "Kopioitu"
  },
  how: {
    eyebrow: "kolme vaihetta, kymmenen minuuttia",
    title: "Näin se toimii",
    steps: [
      {
        title: "Etsi koulusi Wilma",
        body: "WilmAI tuntee kaikki Suomen Wilma-osoitteet. Valitse omasi listalta."
      },
      {
        title: "Kirjaudu kerran",
        body: "Tunnuksesi pysyvät yhdessä tiedostossa omalla koneellasi — eivät koskaan palvelimella."
      },
      {
        title: "Kysy lasten kuulumisia",
        body: "Kysymys sisään, kooste ulos. Agenttisi valitsee oikean komennon."
      }
    ]
  },
  ask: {
    eyebrow: "sinä kysyt, agenttisi hoitaa",
    title: "Mitä voit kysyä?",
    lead: "Käytä komentorivityökalua itse tai anna agenttisi kutsua sitä. Jokainen komento toimii usealla oppilaalla ja palauttaa jäsenneltyä JSONia agenteille.",
    cards: [
      {
        title: "Päivän kooste",
        prompt: "”Mitä lapsilla on koulussa tällä viikolla?”",
        cmd: "wilma summary",
        color: "yellow"
      },
      {
        title: "Huomisen lukujärjestys",
        prompt: "”Mitä tunteja Kiialla on huomenna?”",
        cmd: "wilma schedule",
        color: "teal"
      },
      {
        title: "Läksyt",
        prompt: "”Onko tällä viikolla läksyjä?”",
        cmd: "wilma homework",
        color: "blue"
      },
      {
        title: "Tulevat kokeet",
        prompt: "”Onko kokeita tulossa? Mitä pitäisi kerrata?”",
        cmd: "wilma exams",
        color: "pink"
      },
      {
        title: "Arvosanat",
        prompt: "”Miten viime kokeet menivät?”",
        cmd: "wilma grades",
        color: "blue"
      },
      {
        title: "Tuntimerkinnät",
        prompt: "”Onko tänään merkintöjä tai poissaoloja?”",
        cmd: "wilma attendance",
        color: "yellow"
      },
      {
        title: "Viestit",
        prompt: "”Onko koululta uusia viestejä?”",
        cmd: "wilma messages",
        color: "blue"
      },
      {
        title: "Tiedotteet",
        prompt: "”Mitä koululla tapahtuu tällä viikolla?”",
        cmd: "wilma news",
        color: "teal"
      },
      {
        title: "Usean lapsen perheet",
        prompt: "”Kokoa kooste kaikista lapsistani.”",
        cmd: "--all-students",
        color: "yellow"
      }
    ]
  },
  recipe: {
    eyebrow: "resepti",
    title: "Toimii hienosti OpenClaw'n kanssa",
    lead: "Asenna taito ja kerro agentillesi, miltä aamujen pitäisi näyttää. Vanhemmat käyttävät esimerkiksi tällaista:",
    quote:
      "”Joka arkiaamu klo 7: kokoa molempien lasten päivän kooste perhekanavalle ja lisää uudet kokeet perhekalenteriin.”",
    tail: "Yksi ohje — agenttisi hoitaa loput. Tai ohita säätäminen ja ota valmis wilma-triage-taito suoraan reposta.",
    linkLabel: "Hae taito ClawHubista →"
  },
  faq: {
    eyebrow: "hyviä kysymyksiä",
    title: "UKK",
    items: [
      {
        q: "Missä tunnukseni säilyvät?",
        a: (
          <p>
            Yhdessä tiedostossa omalla koneellasi:{" "}
            <code>~/.config/wilmai/config.json</code>, vain oman käyttäjätilisi
            luettavissa. Voit poistaa sen milloin tahansa komennolla{" "}
            <code>wilma config clear</code>.
          </p>
        )
      },
      {
        q: "Tarvitsenko palvelimen?",
        a: (
          <p>
            Et. WilmAI toimii kokonaan omalla koneellasi. Ei palvelinta, ei
            tiliä, ei rekisteröitymistä.
          </p>
        )
      },
      {
        q: "Onko tämä turvallinen?",
        a: (
          <p>
            WilmAI keskustelee vain koulusi virallisten Wilma-palvelinten kanssa
            omilla tunnuksillasi. Ei välikäsiä, ei analytiikkaa, ei telemetriaa.
            Se on myös vain lukeva — se ei voi lähettää viestejä tai muuttaa
            mitään Wilmassa.
          </p>
        )
      },
      {
        q: "Päätyykö koulun data tekoäly-yhtiölle?",
        a: (
          <p>
            Ei CLI:stä — se ei lähetä tietoja minnekään muualle kuin Wilmaan.
            Jos kytket agentin, agentti lukee CLI:n tulosteen, aivan kuin
            liittäisit sen keskusteluun. Valitse palveluntarjoaja, johon luotat,
            tai käytä pelkkää terminaalia.
          </p>
        )
      },
      {
        q: "Mitä tietoja se näkee?",
        a: (
          <p>
            Täsmälleen samat, jotka näet itse huoltajana Wilman sovelluksessa,
            omilla tunnuksillasi haettuna. Ei mitään ylimääräistä.
          </p>
        )
      },
      {
        q: "Entä jos koulu vaihtuu?",
        a: (
          <p>
            Kirjaudu uudelleen ja valitse uusi Wilma listalta — profiileja voi
            olla useita rinnakkain.
          </p>
        )
      },
      {
        q: "Onko Wilma tai Visma hyväksynyt tämän?",
        a: (
          <p>
            Ei. Tämä on vanhemman harrasteprojekti, joka syntyi halusta pysyä
            paremmin kärryillä. Se ei ole Visman tai Wilma-palvelun virallisesti
            tukema.
          </p>
        )
      }
    ]
  },
  closing: {
    eyebrow: "miksi tämä on olemassa",
    text: "Vanhemmat kertovat minulle samaa: he eivät ole koskaan olleet näin hyvin perillä siitä, mitä koulussa tapahtuu. Se tuo yllättävän paljon iloa. Toivottavasti se tuo sitä myös teidän perheellenne."
  },
  footer: { docs: "Ohjeet", issues: "Issues", licensed: "MIT-lisensoitu" }
};

export const dictionaries: Record<Lang, Dictionary> = { en, fi };
