import type { ReactNode } from "react";

export const locales = ["en", "fi"] as const;
export type Lang = (typeof locales)[number];

export function isLang(value: string): value is Lang {
  return (locales as readonly string[]).includes(value);
}

interface Card {
  title: string;
  prompt: string;
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

export interface ChatLine {
  name?: string;
  text: string;
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
    /** Next to the CLI's npm download count, above `proof`. */
    downloads: string;
    /** Instead of the count when the number isn't available. */
    downloadsFallback: string;
    proof: string;
    handNote: string;
    chatTitle: string;
    chatQuestion: string;
    chatAnswer: ChatLine[];
  };
  quickstart: {
    eyebrow: string;
    title: string;
    lead: string;
    copy: string;
    copied: string;
    alternative: string;
    picker: string;
    help: string;
    helpLink: string;
    comingLaterTitle: string;
    comingLaterNote: string;
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
    title: "WilmAI — Wilma in your AI assistant",
    description:
      "WilmAI connects Wilma to Claude, ChatGPT and other AI assistants — schedules, homework, exams, messages, and news as one daily briefing for the whole family."
  },
  hero: {
    tapedNote: "New school year? A few minutes to set up.",
    h1Pre: "Wilma access for ",
    h1Marker: "your AI assistant",
    disclaimer:
      "This is an independent open-source project by a parent, not affiliated with, endorsed by, or connected to Visma or the official Wilma service.",
    sub: "Keeping up with school is work — schedules, homework, exams, messages, and news, times every kid, sometimes across different schools. WilmAI connects Wilma to Claude, ChatGPT and other assistants, so you can ask in plain words and get one briefing for the whole family.",
    ctaPrimary: "Choose your assistant",
    ctaSecondary: "Use the terminal",
    downloads: "downloads",
    downloadsFallback: "Downloaded thousands of times",
    proof: "in daily use by parents across Finland",
    handNote: "one question → the whole week",
    chatTitle: "Your assistant",
    chatQuestion: "What do the kids have at school tomorrow?",
    chatAnswer: [
      { name: "Kiia", text: "8:30–11:00 crafts, then geography and math. English exam on Thursday: units 7–9." },
      { name: "Eino", text: "Starts at 9:15. Swimming at the pool hall — pack a swimsuit and towel." },
      { text: "One new message from the class teacher about Friday's trip: the permission form is due Wednesday." }
    ]
  },
  quickstart: {
    eyebrow: "a few minutes, once",
    title: "Choose your assistant",
    lead: "Use the assistant you already have. Your Wilma login stays on your computer.",
    copy: "Copy",
    copied: "Copied",
    alternative: "Alternative",
    picker: "Assistant",
    help: "Stuck? Tell us what happened:",
    helpLink: "open an issue on GitHub",
    comingLaterTitle: "Coming later",
    comingLaterNote: "We'll add setup steps when these work in Finland."
  },
  how: {
    eyebrow: "three steps, a few minutes",
    title: "How It Works",
    steps: [
      {
        title: "Pick your assistant",
        body: "Claude, ChatGPT, Grok Bot or OpenClaw — or the terminal on its own."
      },
      {
        title: "Log in to Wilma once",
        body: "A login page opens in your browser. Find your school's Wilma and log in. The login is saved on your computer, not on a server."
      },
      {
        title: "Ask about your kids",
        body: "Plain language in, one briefing out — in English or Finnish."
      }
    ]
  },
  ask: {
    eyebrow: "you ask, your assistant answers",
    title: "What can you ask?",
    lead: "Ask in your own words. Every question works across all your children.",
    cards: [
      {
        title: "Daily briefing",
        prompt: "“What do my kids have going on at school this week?”",
        color: "yellow"
      },
      {
        title: "Tomorrow's schedule",
        prompt: "“What classes does Kiia have tomorrow?”",
        color: "teal"
      },
      {
        title: "Homework check",
        prompt: "“Is there any homework due this week?”",
        color: "blue"
      },
      {
        title: "Upcoming exams",
        prompt: "“Are there any exams coming up? What should she study?”",
        color: "pink"
      },
      {
        title: "Grades",
        prompt: "“How did the last exams go? What was on the spring report card?”",
        color: "blue"
      },
      {
        title: "Lesson notes",
        prompt: "“Any feedback from teachers or absences this week?”",
        color: "yellow"
      },
      {
        title: "Messages",
        prompt: "“Any new messages from school?”",
        color: "blue"
      },
      {
        title: "School news",
        prompt: "“What's happening at school this week? Read the attached letter too.”",
        color: "teal"
      },
      {
        title: "Multi-kid families",
        prompt: "“Give me a summary for all my children.”",
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
        q: "Which assistant should I use?",
        a: (
          <p>
            The one you already use. Claude Desktop has the simplest setup: download one
            file and open it. ChatGPT works through its desktop app, in Work mode. Agents with their own
            computer, like Grok Bot and OpenClaw, can install WilmAI themselves.
          </p>
        )
      },
      {
        q: "Where does my Wilma login live?",
        a: (
          <p>
            In one folder on your computer, <code>~/.config/wilmai</code>: the login, and
            the current Wilma session so your assistant doesn&apos;t have to log in again
            every time. Only your user account can read them. Remove both any time with{" "}
            <code>wilma config clear</code>. If your assistant runs on its own cloud
            computer, the login lives in that assistant&apos;s secret settings instead.
          </p>
        )
      },
      {
        q: "Do I need an account or a server?",
        a: (
          <p>
            No. WilmAI runs on your computer, or on your agent&apos;s computer. There is no
            WilmAI server, no account, and nothing to sign up for.
          </p>
        )
      },
      {
        q: "Does it work on my phone?",
        a: (
          <p>
            Partly. Agents that run on their own computer, like Grok Bot and OpenClaw, can be
            used from your phone once they are set up, and they can send you the daily updates
            in chat. The Claude and ChatGPT phone apps can&apos;t reach WilmAI: your login stays
            on your own devices, and WilmAI has no server in between.
          </p>
        )
      },
      {
        q: "Is this secure?",
        a: (
          <p>
            WilmAI logs in only to your school&apos;s own Wilma, with your own
            login. There is no middleman, no analytics, and no telemetry. Besides
            Wilma, it opens links in school bulletins when you ask for an
            attachment, and checks once a day whether a newer version is out. It is also read-only — it can&apos;t send messages or change anything in
            Wilma.
          </p>
        )
      },
      {
        q: "Does school data end up with an AI company?",
        a: (
          <p>
            What your assistant reads from Wilma goes to that assistant&apos;s provider,
            the same as if you pasted it into a chat. Your Wilma password does not — you
            type it into the login page, never into the chat. Pick a provider you trust, or
            use the terminal on its own.
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
        q: "What if my school changes?",
        a: (
          <p>
            Log in again and pick the new school&apos;s Wilma — you can keep several logins
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
    title: "WilmAI — Wilma tekoälyavustajaasi",
    description:
      "WilmAI yhdistää Wilman Claudeen, ChatGPT:hen ja muihin tekoälyavustajiin — lukujärjestykset, läksyt, kokeet, viestit ja tiedotteet yhtenä päivittäisenä koosteena koko perheelle."
  },
  hero: {
    tapedNote: "Uusi lukuvuosi? Käyttöön muutamassa minuutissa.",
    h1Pre: "Wilma suoraan ",
    h1Marker: "tekoälyavustajaasi",
    disclaimer:
      "Tämä on vanhemman tekemä itsenäinen avoimen lähdekoodin projekti. Kyseessä ei ole Visman tai virallisen Wilma-palvelun tekemä, tukema tai hyväksymä ratkaisu.",
    sub: "Koulun kuulumisten mukana pysyminen on työtä — lukujärjestykset, läksyt, kokeet, viestit ja tiedotteet, jokaisen lapsen osalta, joskus eri kouluissa. WilmAI yhdistää Wilman Claudeen, ChatGPT:hen ja muihin avustajiin, joten voit kysyä omin sanoin ja saada koko perheen kuulumiset yhteen koosteeseen.",
    ctaPrimary: "Valitse avustajasi",
    ctaSecondary: "Käytä terminaalissa",
    downloads: "latausta",
    downloadsFallback: "Ladattu tuhansia kertoja",
    proof: "päivittäisessä käytössä suomalaisperheissä",
    handNote: "yksi kysymys → koko viikko",
    chatTitle: "Avustajasi",
    chatQuestion: "Mitä lapsilla on huomenna koulussa?",
    chatAnswer: [
      { name: "Kiia", text: "8.30–11.00 käsityö, sitten maantieto ja matematiikka. Englannin koe torstaina: kappaleet 7–9." },
      { name: "Eino", text: "Koulu alkaa 9.15. Uintia uimahallissa — mukaan uimapuku ja pyyhe." },
      { text: "Luokanopettajalta uusi viesti perjantain retkestä: lupalappu palautetaan keskiviikkona." }
    ]
  },
  quickstart: {
    eyebrow: "muutama minuutti, kerran",
    title: "Valitse avustajasi",
    lead: "Käytä avustajaa, joka sinulla jo on. Wilma-tunnuksesi pysyvät omalla koneellasi.",
    copy: "Kopioi",
    copied: "Kopioitu",
    alternative: "Vaihtoehto",
    picker: "Avustaja",
    help: "Jäitkö jumiin? Kerro mitä tapahtui:",
    helpLink: "avaa issue GitHubissa",
    comingLaterTitle: "Tulossa myöhemmin",
    comingLaterNote: "Lisäämme ohjeet, kun nämä toimivat Suomessa."
  },
  how: {
    eyebrow: "kolme vaihetta, muutama minuutti",
    title: "Näin se toimii",
    steps: [
      {
        title: "Valitse avustajasi",
        body: "Claude, ChatGPT, Grok Bot tai OpenClaw — tai pelkkä terminaali."
      },
      {
        title: "Kirjaudu Wilmaan kerran",
        body: "Selaimeen avautuu kirjautumissivu. Etsi koulusi Wilma ja kirjaudu. Tunnukset tallentuvat omalle koneellesi, eivät palvelimelle."
      },
      {
        title: "Kysy lasten kuulumisia",
        body: "Kysymys sisään, kooste ulos — suomeksi tai englanniksi."
      }
    ]
  },
  ask: {
    eyebrow: "sinä kysyt, avustajasi vastaa",
    title: "Mitä voit kysyä?",
    lead: "Kysy omin sanoin. Jokainen kysymys toimii kaikkien lastesi osalta.",
    cards: [
      {
        title: "Päivän kooste",
        prompt: "”Mitä lapsilla on koulussa tällä viikolla?”",
        color: "yellow"
      },
      {
        title: "Huomisen lukujärjestys",
        prompt: "”Mitä tunteja Kiialla on huomenna?”",
        color: "teal"
      },
      {
        title: "Läksyt",
        prompt: "”Onko tällä viikolla läksyjä?”",
        color: "blue"
      },
      {
        title: "Tulevat kokeet",
        prompt: "”Onko kokeita tulossa? Mitä pitäisi kerrata?”",
        color: "pink"
      },
      {
        title: "Arvosanat",
        prompt: "”Miten viime kokeet menivät? Mitä kevään todistukseen tuli?”",
        color: "blue"
      },
      {
        title: "Tuntimerkinnät",
        prompt: "”Onko tällä viikolla tullut opettajilta merkintöjä tai poissaoloja?”",
        color: "yellow"
      },
      {
        title: "Viestit",
        prompt: "”Onko koululta uusia viestejä?”",
        color: "blue"
      },
      {
        title: "Tiedotteet",
        prompt: "”Mitä koululla tapahtuu tällä viikolla? Lue liitekirjekin.”",
        color: "teal"
      },
      {
        title: "Usean lapsen perheet",
        prompt: "”Kokoa kooste kaikista lapsistani.”",
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
        q: "Mitä avustajaa minun kannattaa käyttää?",
        a: (
          <p>
            Sitä, jota jo käytät. Claude Desktopissa käyttöönotto on helpoin: lataa yksi
            tiedosto ja avaa se. ChatGPT toimii työpöytäsovelluksensa Work-tilassa. Agentit,
            joilla on oma tietokone, kuten Grok Bot ja OpenClaw, osaavat asentaa WilmAI:n
            itse.
          </p>
        )
      },
      {
        q: "Missä Wilma-tunnukseni säilyvät?",
        a: (
          <p>
            Yhdessä kansiossa omalla koneellasi, <code>~/.config/wilmai</code>: tunnukset
            ja voimassa oleva Wilma-istunto, jotta avustajan ei tarvitse kirjautua joka
            kerta uudelleen. Vain oma käyttäjätilisi voi lukea niitä. Voit poistaa
            molemmat milloin tahansa komennolla <code>wilma config clear</code>. Jos
            avustajasi toimii omalla pilvikoneellaan, tunnukset ovat sen sijaan avustajan
            salaisuusasetuksissa.
          </p>
        )
      },
      {
        q: "Tarvitsenko tilin tai palvelimen?",
        a: (
          <p>
            Et. WilmAI toimii omalla koneellasi tai agenttisi koneella. WilmAI:lla ei ole
            palvelinta, tiliä eikä rekisteröitymistä.
          </p>
        )
      },
      {
        q: "Toimiiko tämä puhelimessa?",
        a: (
          <p>
            Osittain. Agentteja, jotka toimivat omalla koneellaan, kuten Grok Botia ja
            OpenClaw&apos;ta, voi käyttää puhelimesta, kun ne on otettu käyttöön, ja ne voivat
            lähettää päivän kuulumiset sinulle viestinä. Clauden ja ChatGPT:n
            puhelinsovellukset eivät pääse WilmAI:hin: kirjautumistietosi pysyvät omilla
            laitteillasi, eikä välissä ole WilmAI:n palvelinta.
          </p>
        )
      },
      {
        q: "Onko tämä turvallinen?",
        a: (
          <p>
            WilmAI kirjautuu vain koulusi omaan Wilmaan omilla tunnuksillasi.
            Ei välikäsiä, ei analytiikkaa, ei telemetriaa. Wilman lisäksi se
            avaa tiedotteissa olevia linkkejä, kun pyydät liitettä, ja tarkistaa
            kerran päivässä, onko uudempi versio saatavilla.
            Se on myös vain
            lukeva — se ei voi lähettää viestejä tai muuttaa mitään Wilmassa.
          </p>
        )
      },
      {
        q: "Päätyykö koulun data tekoäly-yhtiölle?",
        a: (
          <p>
            Se, minkä avustajasi lukee Wilmasta, menee avustajan palveluntarjoajalle, aivan
            kuin liittäisit sen keskusteluun. Wilma-salasanasi ei mene — kirjoitat sen
            kirjautumissivulle, et koskaan keskusteluun. Valitse palveluntarjoaja, johon
            luotat, tai käytä pelkkää terminaalia.
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
            Kirjaudu uudelleen ja valitse uuden koulun Wilma — tunnuksia voi olla useita
            rinnakkain.
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
