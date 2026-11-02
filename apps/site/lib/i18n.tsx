import Link from "next/link";
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

interface FaqItem {
  q: string;
  a: ReactNode;
}

/** One line of the assistant's answer: a child's name first, if it's about one; ==words== are highlighted. */
export interface ChatLine {
  name?: string;
  text: string;
}

/** One question and its answer in the hero's tour (components/AssistantTour.tsx). */
export interface AssistantScene {
  id: string;
  /** The tour's timeline. */
  tab: string;
  /** The line under the window. */
  caption: string;
  question: string;
  /** While the assistant reads Wilma, and what it read. */
  tool: [string, string];
  answer: ChatLine[];
}

export interface AssistantTourText {
  /** What the window shows, for screen readers. */
  label: string;
  /** The empty message box under the conversation. */
  ask: string;
  sections: string;
  paused: string;
  play: string;
  pause: string;
  scenes: AssistantScene[];
}

export interface Dictionary {
  meta: { title: string; description: string };
  hero: {
    tapedNote: string;
    h1Pre: string;
    h1Marker: string;
    /** Always visible under the headline; opens to `disclaimer`. */
    disclaimerShort: string;
    /** Also in the footer. */
    disclaimer: string;
    sub: string;
    ctaPrimary: string;
    ctaSecondary: string;
    /** Before the row of assistant logos under the buttons. */
    worksWith: string;
    /** Next to the CLI's npm download count, above `proof`. */
    downloads: string;
    /** Instead of the count when the number isn't available. */
    downloadsFallback: string;
    proof: string;
    handNote: string;
    chatTitle: string;
    tour: AssistantTourText;
  };
  quickstart: {
    eyebrow: string;
    title: string;
    lead: string;
    copy: string;
    copyMessage: string;
    copied: string;
    showMessage: string;
    hideMessage: string;
    picker: string;
    /** Above the second row of tiles: Claude Code, Codex, Terminal. */
    terminalRow: string;
    /** Phones only: setup needs a computer. */
    phoneNote: string;
    phoneShare: string;
    phoneCopied: string;
    /** Phones only, instead of a download button. */
    downloadOnComputer: string;
    help: string;
    helpLink: string;
    comingLater: string;
  };
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
  closing: { eyebrow: string; text: string; signature: string };
  footer: { docs: string; issues: string; privacy: string; licensed: string };
}

const en: Dictionary = {
  meta: {
    title: "WilmAI — Wilma in your AI assistant",
    description:
      "WilmAI connects Wilma to Claude, ChatGPT and other AI assistants — schedules, homework, exams, messages, and news as one daily briefing for the whole family."
  },
  hero: {
    tapedNote: "Free, and set up in a few minutes.",
    h1Pre: "Wilma access for ",
    h1Marker: "your AI assistant",
    disclaimerShort: "Independent project, not affiliated with Visma",
    disclaimer:
      "This is an independent open-source project by a parent, not affiliated with, endorsed by, or connected to Visma or the official Wilma service.",
    sub: "Keeping up with school is work, especially with more than one kid. WilmAI lets Claude, ChatGPT and other assistants read Wilma, so you can ask in plain words and get one briefing for the whole family.",
    ctaPrimary: "Choose your assistant",
    ctaSecondary: "What can I ask?",
    worksWith: "Works with",
    downloads: "downloads",
    downloadsFallback: "Downloaded thousands of times",
    proof: "by parents across Finland",
    handNote: "one question → every kid's day",
    chatTitle: "Your assistant",
    tour: {
      label:
        "An assistant answering a made-up family's questions from Wilma: tomorrow's school day for each child, what needs doing this week, the next exams, and this week's bulletins in a few lines.",
      ask: "Ask anything",
      sections: "Parts of the tour",
      paused: "Paused",
      play: "Play the tour",
      pause: "Pause the tour",
      scenes: [
        {
          id: "tomorrow",
          tab: "Tomorrow",
          caption: "Every child's day, from one question.",
          question: "What do the kids have at school tomorrow?",
          tool: ["Reading Wilma…", "Read Wilma: timetables and messages"],
          answer: [
            { name: "Kiia", text: "8:30–14:00: crafts, geography and math. ==English exam on Thursday==, units 7–9." },
            { name: "Eino", text: "Starts at 9:15 with swimming. ==Pack a swimsuit and a towel.==" }
          ]
        },
        {
          id: "needs",
          tab: "Needs you",
          caption: "What needs you, and by when.",
          question: "Is there anything I need to do this week?",
          tool: ["Reading Wilma…", "Read Wilma: messages, bulletins and notes"],
          answer: [
            { text: "Two things:" },
            { name: "Eino", text: "Friday's trip needs your permission: ==return the form by Wednesday==." },
            { name: "Kiia", text: "Monday's art lesson is marked as an absence. ==Explain it in Wilma.==" }
          ]
        },
        {
          id: "exams",
          tab: "Exams",
          caption: "Exams and trips, from every message and note.",
          question: "When are the next exams?",
          tool: ["Reading Wilma…", "Read Wilma: exams, messages and notes"],
          answer: [
            { name: "Kiia", text: "English on ==Thursday== (units 7–9), then math ==next Tuesday== (chapters 3–4)." },
            { name: "Eino", text: "No exams. The class trip to the nature centre is on ==Friday==." }
          ]
        },
        {
          id: "bulletins",
          tab: "Bulletins",
          caption: "Long bulletins in a few lines, in your language.",
          question: "Sum up this week's bulletins in English.",
          tool: ["Reading Wilma…", "Read Wilma: 4 bulletins"],
          answer: [
            { text: "Three things for your family:" },
            { text: "Picture day is ==next Wednesday==. Order forms come home in school bags." },
            { text: "Parents' evening for 8th grade: ==Tuesday at 18:00==, no sign-up needed." },
            { text: "From Monday, phones stay in bags during lessons." }
          ]
        }
      ]
    }
  },
  quickstart: {
    eyebrow: "pick the one you use",
    title: "Choose your assistant",
    lead: "Use the assistant you already have. Your Wilma login stays on your computer.",
    copy: "Copy",
    copyMessage: "Copy message",
    copied: "Copied",
    showMessage: "Show the whole message",
    hideMessage: "Show less",
    picker: "Assistant",
    terminalRow: "If you use a terminal",
    phoneNote: "Setup happens on your computer. Send yourself this link and open it there.",
    phoneShare: "Send yourself the link",
    phoneCopied: "Link copied",
    downloadOnComputer: "Open this page on your computer to download it.",
    help: "Stuck? Tell me what happened:",
    helpLink: "open an issue on GitHub",
    comingLater:
      "Coming later: Instinct (not in Finland yet), and OpenAI dots (only on business plans in Finland so far). I'll add setup steps when they work here."
  },
  ask: {
    eyebrow: "you ask, your assistant answers",
    title: "What can you ask?",
    lead: "Ask in your own words. Every question works across all your children.",
    cards: [
      {
        title: "The week ahead",
        prompt: "“What do my kids have going on at school this week?”",
        color: "yellow"
      },
      {
        title: "Homework",
        prompt: "“Is there any homework for tomorrow?”",
        color: "blue"
      },
      {
        title: "Upcoming exams",
        prompt: "“Are there any exams coming up? What should she study?”",
        color: "pink"
      },
      {
        title: "Lesson notes",
        prompt: "“Has any teacher left a note about Eino this month?”",
        color: "teal"
      },
      {
        title: "Messages and news",
        prompt: "“Any new messages from school? Read the attached letter too.”",
        color: "yellow"
      },
      {
        title: "Grades",
        prompt: "“How did the last exams go? What was on the spring report card?”",
        color: "blue"
      }
    ]
  },
  recipe: {
    eyebrow: "a recipe",
    title: "Pairs well with OpenClaw",
    lead: "Install the skill, then tell your agent what mornings should look like. Parents run things like:",
    quote:
      "“Every weekday at 7, post a school briefing for both kids to the family channel, and put new exams in the family calendar.”",
    tail: "One instruction — your agent handles the rest. The ready-made wilma-triage skill does exactly this, exams in the calendar included.",
    linkLabel: "Set it up →"
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
            computer, like Grok Bot, Meta Muse and OpenClaw, can install WilmAI themselves.
          </p>
        )
      },
      {
        q: "Is there an app of its own, without an assistant?",
        a: (
          <p>
            Yes: <Link href="/en/home">WilmAI Home</Link>, a fast desktop Wilma app for students and
            parents, for Mac and Windows, free and open, now in beta. You use it yourself, with AI if you want
            it. It notifies you when something needs you, and it can also reply to teachers and sign you up for
            things.
          </p>
        )
      },
      {
        q: "What does it cost?",
        a: (
          <p>
            Nothing. WilmAI is free and open source. Your assistant costs what it already
            does.
          </p>
        )
      },
      {
        q: "Does it work with my school?",
        a: (
          <p>
            If your child&apos;s school uses Wilma, yes. When you log in, type your city or
            school name and pick your Wilma from the list. You don&apos;t need to know its
            address.
          </p>
        )
      },
      {
        q: "Where does my Wilma login live?",
        a: (
          <p>
            In one folder on your computer, <code>~/.config/wilmai</code>: the login, and
            the current Wilma session so your assistant doesn&apos;t have to log in again
            every time. Only your user account can read them. To remove both, delete that
            folder, or run <code>wilma config clear</code> in a terminal. If your assistant
            runs on its own cloud computer, the login lives in that assistant&apos;s secret
            settings instead.
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
            Partly. Agents that run on their own computer, like Grok Bot, Meta Muse and OpenClaw, can be
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
        q: "Can students use it too?",
        a: (
          <p>
            Yes. A student can log in with their own Wilma account, and the assistant then sees
            what the student sees: their own lessons, homework, exams, grades and messages.
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
    eyebrow: "why does this exist?",
    text: "Parents keep telling me the same thing: they've never been this up to date with what's happening at school. It brings more joy than you'd expect. I hope it does the same for your family.",
    signature: "— Antti"
  },
  footer: { docs: "Docs", issues: "Issues", privacy: "Privacy", licensed: "MIT Licensed" }
};

const fi: Dictionary = {
  meta: {
    title: "WilmAI — Wilma tekoälyavustajaasi",
    description:
      "WilmAI yhdistää Wilman Claudeen, ChatGPT:hen ja muihin tekoälyavustajiin — lukujärjestykset, läksyt, kokeet, viestit ja tiedotteet yhtenä päivittäisenä koosteena koko perheelle."
  },
  hero: {
    tapedNote: "Ilmainen, ja käytössä muutamassa minuutissa.",
    h1Pre: "Wilma suoraan ",
    h1Marker: "tekoälyavustajaasi",
    disclaimerShort: "Itsenäinen projekti, ei liity Vismaan",
    disclaimer:
      "Tämä on vanhemman tekemä itsenäinen avoimen lähdekoodin projekti. Kyseessä ei ole Visman tai virallisen Wilma-palvelun tekemä, tukema tai hyväksymä ratkaisu.",
    sub: "Koulun kuulumisten mukana pysyminen on työtä, varsinkin kun lapsia on useampi. WilmAI antaa Clauden, ChatGPT:n ja muiden avustajien lukea Wilmaa, joten voit kysyä omin sanoin ja saada koko perheen kuulumiset yhteen koosteeseen.",
    ctaPrimary: "Valitse avustajasi",
    ctaSecondary: "Mitä voin kysyä?",
    worksWith: "Toimii näiden kanssa",
    downloads: "latausta",
    downloadsFallback: "Ladattu tuhansia kertoja",
    proof: "perheissä ympäri Suomen",
    handNote: "yksi kysymys → jokaisen lapsen päivä",
    chatTitle: "Avustajasi",
    tour: {
      label:
        "Avustaja vastaa kuvitteellisen perheen kysymyksiin Wilmasta: kunkin lapsen huominen koulupäivä, mitä tällä viikolla pitää tehdä, seuraavat kokeet ja viikon tiedotteet muutamalla rivillä.",
      ask: "Kysy mitä vain",
      sections: "Esittelyn osat",
      paused: "Tauko",
      play: "Jatka esittelyä",
      pause: "Keskeytä esittely",
      scenes: [
        {
          id: "tomorrow",
          tab: "Huomenna",
          caption: "Jokaisen lapsen päivä yhdellä kysymyksellä.",
          question: "Mitä lapsilla on huomenna koulussa?",
          tool: ["Luetaan Wilmaa…", "Luettu Wilmasta: lukujärjestykset ja viestit"],
          answer: [
            { name: "Kiia", text: "8.30–14.00: käsityö, maantieto ja matematiikka. ==Englannin koe torstaina==, kappaleet 7–9." },
            { name: "Eino", text: "Koulu alkaa 9.15 uinnilla. ==Mukaan uimapuku ja pyyhe.==" }
          ]
        },
        {
          id: "needs",
          tab: "Odottaa sinua",
          caption: "Mikä odottaa sinua, ja mihin mennessä.",
          question: "Onko minulla tällä viikolla jotain tehtävää?",
          tool: ["Luetaan Wilmaa…", "Luettu Wilmasta: viestit, tiedotteet ja merkinnät"],
          answer: [
            { text: "Kaksi asiaa:" },
            { name: "Eino", text: "Perjantain retkeen tarvitaan lupasi: ==palauta lupalappu keskiviikkoon mennessä==." },
            { name: "Kiia", text: "Maanantain kuvataiteen tunti on merkitty poissaoloksi. ==Selvitä se Wilmassa.==" }
          ]
        },
        {
          id: "exams",
          tab: "Kokeet",
          caption: "Kokeet ja retket jokaisesta viestistä ja merkinnästä.",
          question: "Milloin on seuraavat kokeet?",
          tool: ["Luetaan Wilmaa…", "Luettu Wilmasta: kokeet, viestit ja merkinnät"],
          answer: [
            { name: "Kiia", text: "Englanti ==torstaina== (kappaleet 7–9), sitten matematiikka ==ensi tiistaina== (luvut 3–4)." },
            { name: "Eino", text: "Ei kokeita. Luokan retki luontokeskukseen on ==perjantaina==." }
          ]
        },
        {
          id: "bulletins",
          tab: "Tiedotteet",
          caption: "Pitkät tiedotteet muutamalla rivillä.",
          question: "Tiivistä tämän viikon tiedotteet.",
          tool: ["Luetaan Wilmaa…", "Luettu Wilmasta: 4 tiedotetta"],
          answer: [
            { text: "Kolme asiaa perheellesi:" },
            { text: "Kuvauspäivä on ==ensi keskiviikkona==. Tilauslomakkeet tulevat repussa kotiin." },
            { text: "8. luokkien vanhempainilta on ==tiistaina klo 18==, ei ilmoittautumista." },
            { text: "Maanantaista alkaen puhelimet pysyvät tunneilla repussa." }
          ]
        }
      ]
    }
  },
  quickstart: {
    eyebrow: "valitse se, jota käytät",
    title: "Valitse avustajasi",
    lead: "Käytä avustajaa, joka sinulla jo on. Wilma-tunnuksesi pysyvät omalla koneellasi.",
    copy: "Kopioi",
    copyMessage: "Kopioi viesti",
    copied: "Kopioitu",
    showMessage: "Näytä koko viesti",
    hideMessage: "Näytä vähemmän",
    picker: "Avustaja",
    terminalRow: "Jos käytät terminaalia",
    phoneNote: "Käyttöönotto tehdään tietokoneella. Lähetä tämä linkki itsellesi ja avaa se koneella.",
    phoneShare: "Lähetä linkki itsellesi",
    phoneCopied: "Linkki kopioitu",
    downloadOnComputer: "Avaa tämä sivu tietokoneella, niin voit ladata tiedoston.",
    help: "Jäitkö jumiin? Kerro mitä tapahtui:",
    helpLink: "avaa issue GitHubissa",
    comingLater:
      "Tulossa myöhemmin: Instinct (ei vielä Suomessa) sekä OpenAI dots (Suomessa toistaiseksi vain yritystileillä). Lisään ohjeet, kun ne toimivat täällä."
  },
  ask: {
    eyebrow: "sinä kysyt, avustajasi vastaa",
    title: "Mitä voit kysyä?",
    lead: "Kysy omin sanoin. Jokainen kysymys toimii kaikkien lastesi osalta.",
    cards: [
      {
        title: "Tuleva viikko",
        prompt: "”Mitä lapsilla on koulussa tällä viikolla?”",
        color: "yellow"
      },
      {
        title: "Läksyt",
        prompt: "”Onko huomiseksi läksyjä?”",
        color: "blue"
      },
      {
        title: "Tulevat kokeet",
        prompt: "”Onko kokeita tulossa? Mitä pitäisi kerrata?”",
        color: "pink"
      },
      {
        title: "Tuntimerkinnät",
        prompt: "”Onko Einosta tullut opettajilta merkintöjä tässä kuussa?”",
        color: "teal"
      },
      {
        title: "Viestit ja tiedotteet",
        prompt: "”Onko koululta uusia viestejä? Lue liitekirjekin.”",
        color: "yellow"
      },
      {
        title: "Arvosanat",
        prompt: "”Miten viime kokeet menivät? Mitä kevään todistukseen tuli?”",
        color: "blue"
      }
    ]
  },
  recipe: {
    eyebrow: "resepti",
    title: "Toimii hienosti OpenClaw'n kanssa",
    lead: "Asenna taito ja kerro agentillesi, miltä aamujen pitäisi näyttää. Vanhemmat käyttävät esimerkiksi tällaista:",
    quote:
      "”Joka arkiaamu klo 7: kokoa molempien lasten päivän kooste perhekanavalle ja lisää uudet kokeet perhekalenteriin.”",
    tail: "Yksi ohje — agenttisi hoitaa loput. Valmis wilma-triage-taito tekee juuri tämän ja vie kokeet kalenteriin.",
    linkLabel: "Ota käyttöön →"
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
            joilla on oma tietokone, kuten Grok Bot, Meta Muse ja OpenClaw, osaavat asentaa WilmAI:n
            itse.
          </p>
        )
      },
      {
        q: "Onko WilmAI:sta omaa sovellusta, ilman avustajaa?",
        a: (
          <p>
            On: <Link href="/fi/home">WilmAI Home</Link>, nopea Wilma-työpöytäsovellus oppilaille ja
            vanhemmille, Macille ja Windowsille, ilmainen ja avoin, nyt beetana. Käytät sitä itse, tekoälyn
            kanssa, jos haluat. Se ilmoittaa, kun jokin vaatii sinua, ja sillä voi myös vastata opettajille ja
            ilmoittautua.
          </p>
        )
      },
      {
        q: "Mitä se maksaa?",
        a: (
          <p>
            Ei mitään. WilmAI on ilmainen ja avointa lähdekoodia. Avustajasi maksaa saman
            kuin ennenkin.
          </p>
        )
      },
      {
        q: "Toimiiko se lapseni koulussa?",
        a: (
          <p>
            Kyllä, jos lapsesi koulu käyttää Wilmaa. Kirjautuessa kirjoitat kaupungin tai
            koulun nimen ja valitset Wilmasi listalta. Osoitetta ei tarvitse tietää.
          </p>
        )
      },
      {
        q: "Missä Wilma-tunnukseni säilyvät?",
        a: (
          <p>
            Yhdessä kansiossa omalla koneellasi, <code>~/.config/wilmai</code>: tunnukset
            ja voimassa oleva Wilma-istunto, jotta avustajan ei tarvitse kirjautua joka
            kerta uudelleen. Vain oma käyttäjätilisi voi lukea niitä. Voit poistaa molemmat
            poistamalla kansion tai ajamalla terminaalissa <code>wilma config clear</code>.
            Jos avustajasi toimii omalla pilvikoneellaan, tunnukset ovat sen sijaan avustajan
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
            Osittain. Agentteja, jotka toimivat omalla koneellaan, kuten Grok Botia, Meta Musea ja
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
        q: "Voiko oppilas käyttää sitä itse?",
        a: (
          <p>
            Voi. Oppilas voi kirjautua omilla Wilma-tunnuksillaan, jolloin avustaja näkee
            saman kuin oppilas: omat tunnit, läksyt, kokeet, arvosanat ja viestit.
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
    eyebrow: "miksi tämä on olemassa?",
    text: "Vanhemmat kertovat minulle samaa: he eivät ole koskaan olleet näin hyvin perillä siitä, mitä koulussa tapahtuu. Se tuo yllättävän paljon iloa. Toivottavasti se tuo sitä myös teidän perheellenne.",
    signature: "— Antti"
  },
  footer: { docs: "Ohjeet", issues: "Issues", privacy: "Tietosuoja", licensed: "MIT-lisensoitu" }
};

export const dictionaries: Record<Lang, Dictionary> = { en, fi };
