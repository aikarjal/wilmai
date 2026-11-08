import release from "./home-release.json";
import type { TourLabels } from "../components/HomeTour";
import type { Lang } from "./i18n";

/**
 * WilmAI Home's downloads, one per platform. A URL is filled in only after that
 * platform's release has been built and tried; until then the page says the
 * download is coming.
 */
export const homeRelease = release;
export const macDownload = release.downloads.find((d) => d.id === "macos-arm64")?.url ?? null;
export const windowsDownload = release.downloads.find((d) => d.id === "windows-x64")?.url ?? null;

/** One side of the page's two-column section: what the app is like for a student, or for a parent. */
interface Audience { label: string; title: string; points: string[]; alt: string }
interface Choice { title: string; badge: string; body: string; detail: string; link?: { label: string; href: string } }
interface KeyStep { title: string; body: string; visual: "signin" | "credit" | "key" | "app"; link?: { label: string; href: string } }
/** The translation sketch (components/TranslateVisual.tsx): a message as the app shows it translated. */
export interface TranslateVisualLabels { languages: string[]; chosen: string; title: string; from: string; note: string; showOriginal: string; text: string }
/** The several-Wilmas sketch (components/SchoolsVisual.tsx): the sign-in page with two schools' Wilmas. */
export interface SchoolsVisualLabels { title: string; signedIn: string; schools: { name: string; child: string }[]; add: string; open: string }
/** Words in the key steps' sketches (components/KeyVisual.tsx) that aren't OpenAI's own labels. */
export interface KeyVisualLabels { window: string; off: string; local: string; turnOn: string; once: string; reloadOff: string }
interface Faq { q: string; a: string }

export interface HomeCopy {
  meta: { title: string; description: string };
  back: string;
  hero: {
    tapedNote: string;
    disclaimerShort: string;
    disclaimer: string;
    tagline: string;
    sub: string;
    download: string;
    coming: string;
    more: string;
    requirements: string;
    sample: string;
    /** The hero's tour (components/HomeTour.tsx), for screen readers. */
    clip: string;
    /** The tour's timeline and play button. */
    tour: TourLabels;
  };
  /** Students and parents side by side, each with a screenshot (public/home-student-*.png, home-parent-*.png). */
  audiences: { eyebrow: string; title: string; students: Audience; parents: Audience };
  /** The teaser for what comes next, as a taped note. */
  next: { label: string; title: string; text: string };
  /** Several schools' Wilmas in one app (0.2.0), highlighted after the two audiences. */
  schools: { label: string; title: string; lead: string; points: string[]; visual: SchoolsVisualLabels };
  /** Live translation, highlighted after several Wilmas. */
  translate: { label: string; title: string; lead: string; points: string[]; visual: TranslateVisualLabels };
  why: { eyebrow: string; title: string; lines: string[] };
  ai: { eyebrow: string; title: string; lead: string; choices: Choice[] };
  /** Getting an OpenAI API key, for someone who has never made one. Facts from OpenAI's help centre, 21 October 2026. */
  key: { eyebrow: string; title: string; lead: string; steps: KeyStep[]; note: string; visual: KeyVisualLabels };
  beta: { eyebrow: string; title: string; items: string[]; feedback: string; link: string };
  faq: { eyebrow: string; title: string; items: Faq[] };
  get: {
    title: string;
    mac: string;
    macDetail: string;
    includes: string;
    /** macOS blocks an app that isn't notarized: how to open it the first time. */
    macNote: string;
    windows: string;
    windowsDetail: string;
    /** Windows warns about an unsigned installer: what to click, and what a school computer may do. */
    windowsNote: string;
    /** Captions of the first-start sketches (components/FirstStartVisual.tsx). */
    firstMac: string;
    firstWindows: string;
    /** The two Windows steps' labels: the browser's download warning (Edge), then the first start. */
    windowsSteps: { download: string; start: string };
    /** Above the installing steps, shown after a download button is clicked. */
    started: string;
    /** The steps for both, folded, for anyone who wants to read them first. */
    howTo: string;
    pending: string;
    others: string;
    cliLink: string;
  };
  closing: { eyebrow: string; text: string; signature: string; button: string };
  /** The banner across the very top of the front page. `more` and `cta` are left out on phones. */
  /** The strip across the top of the front page: what Home is, what it gives you (`detail`), and the way in. */
  announce: { badge: string; text: string; more: string; detail: string; cta: string };
  /** Home on the front page, after the setup guides: the app for those who'd rather not use an assistant. */
  card: { eyebrow: string; text: string; points: string[]; download: string; link: string };
}

const en: HomeCopy = {
  meta: {
    title: "WilmAI Home — a fast, modern Wilma app for students and parents",
    description:
      "A desktop app for Wilma: today's lessons, messages, homework, exams and grades in one view, a notification when something needs you, and AI if you want it. Free and open, now in beta, for Mac and Windows."
  },
  back: "WilmAI for AI assistants",
  hero: {
    tapedNote: "A desktop app for students and parents.",
    disclaimerShort: "Independent project, not affiliated with Visma",
    disclaimer:
      "WilmAI Home is an independent hobby project by a parent. It is not affiliated with, endorsed by, or connected to Visma or the official Wilma service.",
    tagline: "School, sorted.",
    sub: "A fast, modern Wilma app for your computer. Today's lessons, messages, homework, exams and grades in one view, in seconds.",
    download: "Download",
    coming: "Download coming soon",
    more: "What it does",
    requirements: "For Mac (Apple Silicon, macOS 13.3 or later) and Windows 10 or 11. Free and open, now in beta.",
    sample: "The app with a made-up sample family.",
    clip: "WilmAI Home in use: today's view, messages and bulletins with a reply being written, search, the week with a day's schedule open, and grades.",
    tour: {
      sections: "Parts of the tour",
      paused: "Paused",
      play: "Play the tour",
      pause: "Pause the tour",
      today: "Today",
      message: "Messages",
      translate: "Translation",
      ai: "AI",
      week: "Week",
      grades: "Grades",
      schools: "Schools",
      captions: {
        today: "Every child's day at a glance.",
        message: ["Messages, news and bulletins, all in one view.", "Reply right away, without opening Wilma.", "Search everything at once."],
        translate: "Messages in your language, the original a click away.",
        ai: "With AI, what needs you comes first, and by when.",
        week: "Week and calendar views for the whole family.",
        grades: "Grades and notes in one view, with averages and trends.",
        schools: "Children at different schools, in one view."
      }
    }
  },
  audiences: {
    eyebrow: "two ways to use it",
    title: "Made for students and parents",
    students: {
      label: "For students",
      title: "Everything in seconds",
      points: [
        "Your day at a glance: lessons, homework, coming exams and new messages on one screen.",
        "Messages that read like messages: a thread in order, the newest marked, and a reply in a click.",
        "Exams and grades: what's coming up, every result with its trend, and the report card.",
        "A notification when something needs you, and the evening before a deadline. On Mac and Windows.",
        "Quick to get around: ⌘K or Ctrl+K finds any message or note, the keyboard moves through your messages, and dark mode follows your computer."
      ],
      alt: "WilmAI Home for a student: one pupil's day, with lessons, homework, exams and messages."
    },
    parents: {
      label: "For parents",
      title: "All your children in one place",
      points: [
        "Every child side by side, even at schools on different Wilmas: timetables, homework, exams, grades and teachers' notes, without switching between children.",
        "Act without opening Wilma: reply to teachers, sign up for parents' evenings, report an absence.",
        "A notification when something needs you, and one click to sign back in when Wilma signs you out.",
        "Supercharge it with AI, if you want: it reads every message, bulletin and teacher's note, and puts what needs you first, with the deadline."
      ],
      alt: "WilmAI Home for a parent: two children's week side by side."
    }
  },
  next: {
    label: "Coming next",
    title: "Your family calendar",
    text: "Exams, events and deadlines straight into Google Calendar, kept up to date as Wilma changes."
  },
  schools: {
    label: "New in 0.2.0",
    title: "Children at different schools, in one view",
    lead: "Are your children at schools on different Wilmas: another town, an upper secondary school, a private school? Sign in to each school's Wilma, and WilmAI Home shows all your children together.",
    points: [
      "Today, Messages, the week, exams and grades show every child, whichever Wilma they're on.",
      "Notifications come from every school's Wilma.",
      "Add a school with Add another school's Wilma on the sign-in page. One Sign in signs in to all of them.",
      "A new school can give a child a new profile, so Wilma lists them twice: untick the one you don't need.",
      "A parent with children in two towns asked for this on GitHub."
    ],
    visual: {
      title: "Sign in with Wilma",
      signedIn: "Signed in",
      schools: [
        { name: "Espoon kaupunki", child: "Kiia" },
        { name: "Helsingin kaupunki", child: "Otso" }
      ],
      add: "Add another school's Wilma",
      open: "Open WilmAI Home"
    }
  },
  translate: {
    label: "Also new",
    title: "Messages in your language",
    lead: "Does your child go to a Swedish-speaking school, or is Finnish not your first language? Choose a language in Settings, and WilmAI Home translates messages, bulletins and teachers' notes as they arrive, titles too.",
    points: [
      "Into Finnish, Swedish, English, Ukrainian or Arabic.",
      "New messages arrive translated, and turning it on translates the last 30 days too.",
      "The original is always a click away.",
      "What you write to the school can go in Finnish or Swedish, with the translation beside your words before you send.",
      "It uses the app's OpenAI choice: usually a fraction of a cent a message, within the monthly limit you set.",
      "The app itself is in Finnish, Swedish or English."
    ],
    visual: {
      languages: ["Suomi", "Svenska", "English", "Українська", "العربية"],
      chosen: "English",
      title: "School starts at 10.15 tomorrow",
      from: "Mäkinen Laura (MÄL)",
      note: "Translated automatically from Finnish. Check times and dates against the original.",
      showOriginal: "Show original",
      text: "Hi! Because of a teachers' training day, 3B's school day starts at 10.15 tomorrow. The morning club is open as usual from 7.30."
    }
  },
  why: {
    eyebrow: "why it exists",
    title: "Wilma has everything. Finding it shouldn't take ten clicks.",
    lines: [
      "Messages, timetables, homework, exams and grades are all in Wilma, each behind its own page.",
      "WilmAI Home puts them in one view that opens in a second, and you can act right there: reply, sign up, report an absence.",
      "I built it over a weekend. My family uses it every day."
    ]
  },
  ai: {
    eyebrow: "AI is optional",
    title: "AI, if you want it",
    lead: "The app is complete without AI. Turn it on in Settings, and it reads everything new for you and puts what needs you first. You can change your mind any time.",
    choices: [
      {
        title: "No AI",
        badge: "Default",
        body: "Everything Wilma has, in one fast app. Nothing picks out what needs you or by when, and notifications come only for what Wilma itself flags, like sign-ups.",
        detail: "Free"
      },
      {
        title: "OpenAI",
        badge: "Recommended",
        body: "Fast and accurate. You add your own OpenAI API key, so it runs with your permission and on your account: OpenAI bills you directly, usually tens of cents a month for a family. You set a monthly limit in the app. It can also translate messages into your language.",
        detail: "Your own API key · tens of cents a month",
        link: { label: "How to get a key", href: "#openai-key" }
      },
      {
        title: "Local AI",
        badge: "On your Mac",
        body: "Everything is read on your Mac, and nothing goes to an AI service. But it's a big download, and it works the computer hard. It's also slower than OpenAI and makes more mistakes, especially with dates.",
        detail: "Apple Silicon with 16 GB of memory · 9.1 GB download"
      }
    ]
  },
  key: {
    eyebrow: "if you choose OpenAI",
    title: "How to get an OpenAI API key",
    lead: "An API key is like a password that lets the app use OpenAI on your account. Getting one takes about five minutes and a payment card. A ChatGPT subscription doesn't cover it: OpenAI bills its API separately.",
    steps: [
      {
        title: "Sign in to OpenAI's developer site",
        body: "Use your ChatGPT login if you have one, or create an account.",
        visual: "signin",
        link: { label: "platform.openai.com", href: "https://platform.openai.com/" }
      },
      {
        title: "Add $5 of credit",
        body: "Under Billing, add a payment card and buy credit. $5 is the smallest amount, and for a family it usually lasts many months; unused credit expires after a year. Turn off auto-reload, which is on at first, so nothing more is charged without you.",
        visual: "credit",
        link: { label: "Billing", href: "https://platform.openai.com/account/billing" }
      },
      {
        title: "Create a key",
        body: "On the API keys page, choose Create new secret key, name it WilmAI Home, and copy it. OpenAI shows the whole key only once. Leave Permissions on All (a read-only key won't work), and if it asks when the key expires, pick the longest time or none; an expired key just needs a new one, made the same way.",
        visual: "key",
        link: { label: "API keys", href: "https://platform.openai.com/api-keys" }
      },
      {
        title: "Paste it into the app",
        body: "In WilmAI Home, open Settings, choose OpenAI, paste the key and choose Turn on. The app tries it right away, keeps it on your computer, and sends it only to OpenAI.",
        visual: "app"
      }
    ],
    note: "If the key ever gets out, delete it on the same page and make a new one. OpenAI's Billing page shows what you've spent, and the app stops at the monthly limit you set.",
    visual: { window: "WilmAI Home · Settings", off: "No AI", local: "Local AI", turnOn: "Turn on", once: "The whole key is shown only once: copy it now.", reloadOff: "Turn auto-reload off." }
  },
  beta: {
    eyebrow: "it's a beta",
    title: "Before you try it",
    items: [
      "It's a beta, and I built it on my own. Some things are missing, and some will break.",
      "For Mac (Apple Silicon, M1 or newer, and macOS 13.3 or later) and for Windows 10 or 11. Linux may come later.",
      "On Windows, local AI isn't there yet.",
      "To check Wilma and notify you, the app needs to be running and the computer awake. Closing the window keeps it in the menu bar, or on Windows in the taskbar's notification area.",
      "AI can misread things, dates especially. Check anything important in the message itself.",
      "New versions arrive in the app, and you choose when to install them."
    ],
    feedback: "Found a bug? When you report it, please leave out messages, children's names and logins.",
    link: "Report a problem on GitHub"
  },
  faq: {
    eyebrow: "good questions",
    title: "FAQ",
    items: [
      {
        q: "Do I need to use AI?",
        a: "No. The app starts without AI and shows everything Wilma has. Without AI, though, nothing picks out what needs you or by when, and notifications come only for what Wilma itself flags, like sign-ups. You can turn AI on or off any time in Settings."
      },
      {
        q: "Can I run local AI?",
        a: "If your Mac has Apple Silicon (M1 or newer) and at least 16 GB of memory, yes. Choose Local AI in Settings, and the app downloads what it needs once, 9.1 GB. It works the Mac hard, and it's slower and less accurate than OpenAI, especially with dates. On other computers the choice is greyed out."
      },
      {
        q: "Can students use it?",
        a: "Yes. Sign in with the student's own Wilma account and choose “A student”. The app then reads things from the student's side: what they need to do themselves, not what's meant for their guardians. Sign-ups and absence reports stay with the guardians."
      },
      {
        q: "What does it cost?",
        a: "The app is free. If you choose OpenAI, OpenAI bills your own key: in my family it has been tens of cents a month, even with me testing it all the time. The app stops at a monthly limit you set, from 50 cents to $3."
      },
      {
        q: "My children's schools are on different Wilmas. Does that work?",
        a: "Yes, from version 0.2.0. On the sign-in page, choose Add another school's Wilma and sign in there too, and the app shows all the children together, with notifications from every school. Several Wilmas are for a guardian's login; a student's own login has one."
      },
      {
        q: "Can it translate messages?",
        a: "Yes, if you choose OpenAI. Pick a language in Settings (Finnish, Swedish, English, Ukrainian or Arabic), and messages, bulletins and notes in another language are translated as they come in, titles too, with the original a click away. It usually costs a fraction of a cent a message. It can also send what you write to the school in Finnish or Swedish: the translation shows beside your words, and only what's shown is sent. The app itself is in Finnish, Swedish or English."
      },
      {
        q: "What does OpenAI see?",
        a: "Only if you choose OpenAI: one message, bulletin or note at a time, with your children's first names and classes so it can tell who it's about. With translations on, also the texts it translates, and the messages you write when you translate them into Finnish or Swedish. Your Wilma password never goes there. With local AI or no AI, nothing goes to an AI service."
      },
      {
        q: "Where is my data?",
        a: "On your computer. Messages, timetables and AI answers are stored in the app so it opens instantly. There is no WilmAI server. Your Wilma password goes only to your school's Wilma; the app can remember it in your computer's keychain (the macOS Keychain or Windows Credential Manager), so signing in again takes one click. Your OpenAI key is kept there too."
      },
      {
        q: "Why isn't it a website?",
        a: "I'd like it to be. But a website can talk to Wilma only if Visma allows it, and I don't have Visma's permission, so browsers block those requests. An app on your own computer can talk to Wilma directly, the way your browser does when you use Wilma, and your login stays with you."
      },
      {
        q: "Why not a phone app?",
        a: "I'd like to make one, and maybe I will. But a phone app has to go through the App Store, and Visma could ask for it to be taken down, because it uses Wilma without their permission. A desktop app needs no store. It's my way of showing what a modern Wilma could look like."
      },
      {
        q: "How is it different from WilmAI for AI assistants?",
        a: "WilmAI for assistants lets Claude, ChatGPT or another assistant read Wilma for you, and it only reads. WilmAI Home is an app you use yourself, with AI or without, and it can also send replies, sign-ups and absence reports. You can use either, or both."
      }
    ]
  },
  get: {
    title: "Download WilmAI Home",
    mac: "Mac",
    macDetail: "Apple Silicon (M1 or newer) · macOS 13.3 or later",
    includes: "The Mac download includes optional local AI. Its 9.1 GB download happens only if you turn local AI on.",
    macNote: "The Mac app isn't signed by Apple yet, so macOS stops it the first time: choose Done, then open System Settings → Privacy & Security and choose Open Anyway for WilmAI Home. After that it opens normally.",
    windows: "Windows",
    windowsDetail: "Windows 10 or 11 · 64-bit",
    windowsNote: "The Windows installer isn't signed yet, so your browser may hold the download as not commonly downloaded. In Edge, point at the download and choose … → Keep, then Show more → Keep anyway. Windows warns once more before the first start: choose More info, then Run anyway. It installs for you only, with no administrator rights, but a school computer's settings may still block it.",
    firstMac: "On a Mac, the first time",
    firstWindows: "On Windows, the first time",
    windowsSteps: { download: "Downloading, in Edge", start: "Starting it" },
    started: "Your download is starting. Next:",
    howTo: "How installing works",
    pending: "The first downloads are on their way. They'll be here when they're ready.",
    others: "No Linux version yet.",
    cliLink: "WilmAI for AI assistants works there →"
  },
  closing: {
    eyebrow: "a note from me",
    text: "WilmAI Home is my experiment in what Wilma could be. It's a beta, and all feedback helps: what breaks, what's confusing, and what you'd want next.",
    signature: "— Antti",
    button: "Give feedback on GitHub"
  },
  announce: {
    badge: "New",
    text: "WilmAI Home",
    more: "a free Wilma app for your computer",
    detail: "Every child's day, messages in your language, and AI if you want it. For Mac and Windows.",
    cta: "See the app"
  },
  card: {
    eyebrow: "or an app of your own",
    text: "Don't use an AI assistant? WilmAI Home is a fast Wilma app for students and parents, on your own computer. It works without AI.",
    points: [
      "Every child's day, messages, exams and grades in one view.",
      "Messages translated into your language, the original a click away.",
      "AI that puts what needs you first, if you want it.",
      "Children at different schools, together."
    ],
    download: "Download for Mac or Windows",
    link: "See how it works"
  }
};

const fi: HomeCopy = {
  meta: {
    title: "WilmAI Home — nopea ja moderni Wilma-sovellus oppilaille ja vanhemmille",
    description:
      "Wilma-työpöytäsovellus: päivän tunnit, viestit, läksyt, kokeet ja arvosanat yhdessä näkymässä, ilmoitus, kun jokin vaatii sinua, ja tekoäly, jos haluat. Ilmainen ja avoin, nyt beetana, Macille ja Windowsille."
  },
  back: "Tekoälyavustajien WilmAI",
  hero: {
    tapedNote: "Työpöytäsovellus oppilaille ja vanhemmille.",
    disclaimerShort: "Itsenäinen projekti, ei liity Vismaan",
    disclaimer:
      "WilmAI Home on vanhemman tekemä itsenäinen harrastusprojekti. Se ei ole Visman tai virallisen Wilma-palvelun tekemä, tukema tai hyväksymä.",
    tagline: "Kouluasiat järjestyksessä.",
    sub: "Nopea ja moderni Wilma-sovellus tietokoneelle. Päivän tunnit, viestit, läksyt, kokeet ja arvosanat yhdessä näkymässä, sekunneissa.",
    download: "Lataa",
    coming: "Lataus tulossa pian",
    more: "Mitä se tekee",
    requirements: "Macille (Apple Silicon, macOS 13.3 tai uudempi) ja Windows 10:lle tai 11:lle. Ilmainen ja avoin, nyt beetana.",
    sample: "Sovellus kuvitteellisen esimerkkiperheen tiedoilla.",
    clip: "WilmAI Home käytössä: päivän näkymä, viestit ja tiedotteet sekä vastaus kirjoitettavana, haku, viikko päivän lukujärjestys auki, ja arvosanat.",
    tour: {
      sections: "Esittelyn osat",
      paused: "Tauko",
      play: "Jatka esittelyä",
      pause: "Keskeytä esittely",
      today: "Tänään",
      message: "Viestit",
      translate: "Käännös",
      ai: "Tekoäly",
      week: "Viikko",
      grades: "Arvosanat",
      schools: "Koulut",
      captions: {
        today: "Jokaisen lapsen päivä yhdellä silmäyksellä.",
        message: ["Viestit ja tiedotteet samassa näkymässä.", "Vastaa heti, avaamatta Wilmaa.", "Hae kaikesta kerralla."],
        translate: "Viestit omalla kielelläsi, alkuperäinen klikkauksen päässä.",
        ai: "Tekoäly nostaa ensin sen, mikä vaatii sinua, ja mihin mennessä.",
        week: "Viikko- ja kalenterinäkymä koko perheelle.",
        grades: "Arvosanat ja merkinnät keskiarvoineen.",
        schools: "Eri koulujen lapset samassa näkymässä."
      }
    }
  },
  audiences: {
    eyebrow: "kaksi tapaa käyttää",
    title: "Tehty oppilaille ja vanhemmille",
    students: {
      label: "Oppilaalle",
      title: "Kaikki sekunneissa",
      points: [
        "Päivä yhdellä silmäyksellä: tunnit, läksyt, tulevat kokeet ja uudet viestit samassa näkymässä.",
        "Viestit, joita on helppo lukea: keskustelu järjestyksessä, uusin merkittynä, ja vastaus yhdellä klikkauksella.",
        "Kokeet ja arvosanat: mitä on tulossa, jokainen tulos ja sen suunta sekä todistus.",
        "Ilmoitus, kun jokin vaatii sinua, ja määräajan edellisenä iltana. Macilla ja Windowsilla.",
        "Nopea käyttää: ⌘K tai Ctrl+K löytää minkä tahansa viestin tai merkinnän, näppäimistöllä liikut viesteissä, ja tumma tila seuraa koneesi asetusta."
      ],
      alt: "WilmAI Home oppilaalle: yhden oppilaan päivä tunteineen, läksyineen, kokeineen ja viesteineen."
    },
    parents: {
      label: "Vanhemmalle",
      title: "Kaikki lapset yhdessä paikassa",
      points: [
        "Kaikki lapset rinnakkain, vaikka koulut olisivat eri Wilmoissa: lukujärjestykset, läksyt, kokeet, arvosanat ja opettajien merkinnät, ilman lapsesta toiseen vaihtamista.",
        "Hoida asiat avaamatta Wilmaa: vastaa opettajalle, ilmoittaudu vanhempainiltaan, ilmoita poissaolo.",
        "Ilmoitus, kun jokin vaatii sinua, ja yksi klikkaus takaisin sisään, kun Wilma kirjaa sinut ulos.",
        "Tehosta tekoälyllä, jos haluat: se lukee jokaisen viestin, tiedotteen ja opettajan merkinnän ja nostaa ensimmäiseksi sen, mikä vaatii sinua, määräaikoineen."
      ],
      alt: "WilmAI Home vanhemmalle: kahden lapsen viikko rinnakkain."
    }
  },
  next: {
    label: "Tulossa seuraavaksi",
    title: "Perheen kalenteri",
    text: "Kokeet, tapahtumat ja määräajat suoraan Google-kalenteriin, ja ne pysyvät ajan tasalla, kun Wilma muuttuu."
  },
  schools: {
    label: "Uutta versiossa 0.2.0",
    title: "Eri koulujen lapset samassa näkymässä",
    lead: "Käyvätkö lapsesi kouluja, joilla on eri Wilma: toisella paikkakunnalla, lukiossa tai yksityiskoulussa? Kirjaudu kunkin koulun Wilmaan, niin WilmAI Home näyttää kaikki lapsesi yhdessä.",
    points: [
      "Tänään, viestit, viikko, kokeet ja arvosanat näyttävät jokaisen lapsen, oli hän missä Wilmassa tahansa.",
      "Ilmoitukset tulevat jokaisen koulun Wilmasta.",
      "Lisää koulu kirjautumissivulla kohdasta Lisää toisen koulun Wilma. Yksi Kirjaudu sisään kirjaa sisään kaikkiin.",
      "Uusi koulu voi antaa lapselle uuden profiilin, jolloin Wilma näyttää hänet kahdesti: poista valinta siltä, jota et tarvitse.",
      "Tätä toivoi GitHubissa vanhempi, jonka lapset käyvät koulua kahdella paikkakunnalla."
    ],
    visual: {
      title: "Kirjaudu Wilma-tunnuksilla",
      signedIn: "Kirjautunut",
      schools: [
        { name: "Espoon kaupunki", child: "Kiia" },
        { name: "Helsingin kaupunki", child: "Otso" }
      ],
      add: "Lisää toisen koulun Wilma",
      open: "Avaa WilmAI Home"
    }
  },
  translate: {
    label: "Myös uutta",
    title: "Viestit omalla kielelläsi",
    lead: "Käykö lapsesi ruotsinkielistä koulua, tai puhutaanko kotonanne muuta kieltä? Valitse kieli asetuksista, niin WilmAI Home kääntää viestit, tiedotteet ja opettajien merkinnät sitä mukaa kuin ne tulevat, otsikoita myöten.",
    points: [
      "Suomeksi, ruotsiksi, englanniksi, ukrainaksi tai arabiaksi.",
      "Uudet viestit tulevat valmiiksi käännettyinä, ja käyttöön ottaessa käännetään myös viimeiset 30 päivää.",
      "Alkuperäinen on aina klikkauksen päässä.",
      "Koululle kirjoittamasi viesti voi lähteä suomeksi tai ruotsiksi, ja käännös näkyy sanojesi vieressä ennen lähettämistä.",
      "Käyttää sovelluksen OpenAI-vaihtoehtoa: yleensä sentin murto-osa viestiltä, asettamasi kuukausirajan sisällä.",
      "Itse sovellus on suomeksi, ruotsiksi tai englanniksi."
    ],
    visual: {
      languages: ["Suomi", "Svenska", "English", "Українська", "العربية"],
      chosen: "Suomi",
      title: "Koulu alkaa huomenna klo 10.15",
      from: "Lindqvist Anna (LIA)",
      note: "Käännetty automaattisesti, alkuperäinen kieli: ruotsi. Tarkista ajat ja päivät alkuperäisestä.",
      showOriginal: "Näytä alkuperäinen",
      text: "Hei! Opettajien koulutuspäivän vuoksi 3B:n koulupäivä alkaa huomenna vasta klo 10.15. Aamukerho on auki tavalliseen tapaan klo 7.30 alkaen."
    }
  },
  why: {
    eyebrow: "miksi tämä on olemassa",
    title: "Wilmassa on kaikki. Sen löytämiseen ei pitäisi tarvita kymmentä klikkausta.",
    lines: [
      "Viestit, lukujärjestykset, läksyt, kokeet ja arvosanat ovat kaikki Wilmassa, kukin omalla sivullaan.",
      "WilmAI Home kokoaa ne yhteen näkymään, joka aukeaa sekunnissa, ja voit hoitaa asiat saman tien: vastata, ilmoittautua tai ilmoittaa poissaolon.",
      "Tein sen viikonlopun aikana. Perheessäni sitä käytetään joka päivä."
    ]
  },
  ai: {
    eyebrow: "tekoäly on vapaaehtoinen",
    title: "Tekoäly, jos haluat",
    lead: "Sovellus on valmis ilman tekoälyä. Kun otat sen asetuksista käyttöön, se lukee kaiken uuden puolestasi ja nostaa ensimmäiseksi sen, mikä vaatii sinua. Voit vaihtaa milloin tahansa.",
    choices: [
      {
        title: "Ei tekoälyä",
        badge: "Oletus",
        body: "Kaikki, mitä Wilmassa on, yhdessä nopeassa sovelluksessa. Mikään ei poimi, mikä vaatii sinulta jotain ja mihin mennessä, ja ilmoitukset tulevat vain siitä, minkä Wilma itse merkitsee, kuten ilmoittautumisista.",
        detail: "Maksuton"
      },
      {
        title: "OpenAI",
        badge: "Suositeltu",
        body: "Nopea ja tarkka. Lisäät oman OpenAI-avaimesi, joten se toimii sinun luvallasi ja sinun tililläsi: OpenAI laskuttaa suoraan, perheen käytössä yleensä kymmeniä senttejä kuussa. Kuukausirajan asetat sovelluksessa. Se voi myös kääntää viestit omalle kielellesi.",
        detail: "Oma API-avain · kymmeniä senttejä kuussa",
        link: { label: "Näin saat avaimen", href: "#openai-key" }
      },
      {
        title: "Paikallinen tekoäly",
        badge: "Omalla Macilla",
        body: "Kaikki luetaan omalla Macillasi, eikä mitään lähetetä tekoälypalveluun. Lataus on kuitenkin iso, ja tekoäly kuormittaa konetta paljon. Se on myös OpenAI:ta hitaampi ja tekee enemmän virheitä, varsinkin päivämäärissä.",
        detail: "Apple Silicon ja 16 Gt muistia · 9,1 Gt:n lataus"
      }
    ]
  },
  key: {
    eyebrow: "jos valitset OpenAI:n",
    title: "Näin saat OpenAI-avaimen",
    lead: "API-avain on kuin salasana, jolla sovellus käyttää OpenAI:ta sinun tililläsi. Sen hankkimiseen menee noin viisi minuuttia, ja tarvitset maksukortin. ChatGPT-tilaus ei kata sitä: OpenAI laskuttaa API-käytön erikseen.",
    steps: [
      {
        title: "Kirjaudu OpenAI:n kehittäjäsivustolle",
        body: "Käytä ChatGPT-tunnuksiasi, jos sinulla on sellaiset, tai luo tili.",
        visual: "signin",
        link: { label: "platform.openai.com", href: "https://platform.openai.com/" }
      },
      {
        title: "Lisää 5 dollaria saldoa",
        body: "Lisää Billing-sivulla maksukortti ja osta saldoa. Pienin summa on 5 dollaria, ja perheen käytössä se riittää yleensä monta kuukautta; käyttämätön saldo vanhenee vuodessa. Kytke pois automaattinen lisäys (auto-reload), joka on aluksi päällä, niin mitään ei veloiteta lisää ilman sinua.",
        visual: "credit",
        link: { label: "Billing", href: "https://platform.openai.com/account/billing" }
      },
      {
        title: "Luo avain",
        body: "Valitse API keys -sivulla Create new secret key, anna nimeksi WilmAI Home ja kopioi avain. OpenAI näyttää koko avaimen vain kerran. Jätä Permissions-kohtaan All (pelkkä lukuoikeus ei toimi), ja jos sivu kysyy vanhenemista, valitse pisin aika tai ei vanhenemista; vanhentuneen tilalle tehdään uusi samalla tavalla.",
        visual: "key",
        link: { label: "API keys", href: "https://platform.openai.com/api-keys" }
      },
      {
        title: "Liitä se sovellukseen",
        body: "Avaa WilmAI Homessa Asetukset, valitse OpenAI, liitä avain ja valitse Ota käyttöön. Sovellus kokeilee avainta heti, säilyttää sen tietokoneellasi ja lähettää sen vain OpenAI:lle.",
        visual: "app"
      }
    ],
    note: "Jos avain joskus päätyy vääriin käsiin, poista se samalla sivulla ja luo uusi. OpenAI:n Billing-sivulta näet, paljonko olet käyttänyt, ja sovellus pysähtyy asettamaasi kuukausirajaan.",
    visual: { window: "WilmAI Home · Asetukset", off: "Ei tekoälyä", local: "Paikallinen", turnOn: "Ota käyttöön", once: "Koko avain näytetään vain kerran: kopioi se heti.", reloadOff: "Kytke auto-reload pois." }
  },
  beta: {
    eyebrow: "beta-versio",
    title: "Ennen kuin kokeilet",
    items: [
      "Tämä on beta, jonka olen tehnyt yksin. Jotain puuttuu vielä, ja jotain menee rikki.",
      "Macille (Apple Silicon, M1 tai uudempi, ja macOS 13.3 tai uudempi) ja Windows 10:lle tai 11:lle. Linux voi tulla myöhemmin.",
      "Windowsissa paikallista tekoälyä ei vielä ole.",
      "Jotta sovellus voi tarkistaa Wilmaa ja ilmoittaa, sen pitää olla käynnissä ja tietokoneen hereillä. Kun suljet ikkunan, sovellus jää valikkoriville, Windowsissa tehtäväpalkin ilmoitusalueelle.",
      "Tekoäly voi lukea asioita väärin, varsinkin päivämääriä. Tarkista tärkeät asiat itse viestistä.",
      "Uudet versiot tulevat sovellukseen, ja päätät itse, milloin asennat ne."
    ],
    feedback: "Löysitkö virheen? Jätä ilmoituksesta pois viestit, lasten nimet ja tunnukset.",
    link: "Kerro ongelmasta GitHubissa"
  },
  faq: {
    eyebrow: "hyviä kysymyksiä",
    title: "UKK",
    items: [
      {
        q: "Pitääkö tekoälyä käyttää?",
        a: "Ei. Sovellus alkaa ilman tekoälyä ja näyttää kaiken, mitä Wilmassa on. Ilman tekoälyä mikään ei kuitenkaan poimi, mikä vaatii sinulta jotain ja mihin mennessä, ja ilmoitukset tulevat vain siitä, minkä Wilma itse merkitsee, kuten ilmoittautumisista. Voit ottaa tekoälyn käyttöön tai pois asetuksista milloin tahansa."
      },
      {
        q: "Voinko käyttää paikallista tekoälyä?",
        a: "Jos Macissasi on Apple Silicon (M1 tai uudempi) ja vähintään 16 Gt muistia, voit. Valitse asetuksista Paikallinen tekoäly, niin sovellus lataa tarvitsemansa kerran, 9,1 Gt. Se kuormittaa Macia paljon ja on OpenAI:ta hitaampi ja epätarkempi, varsinkin päivämäärissä. Muilla koneilla vaihtoehto näkyy harmaana."
      },
      {
        q: "Voiko oppilas käyttää sitä?",
        a: "Voi. Kirjaudu oppilaan omilla Wilma-tunnuksilla ja valitse Oppilas. Sovellus lukee silloin asiat oppilaan näkökulmasta: mitä hänen pitää itse tehdä, ei sitä, mikä on tarkoitettu huoltajille. Ilmoittautumiset ja poissaoloilmoitukset jäävät huoltajille."
      },
      {
        q: "Mitä se maksaa?",
        a: "Sovellus on maksuton. Jos valitset OpenAI:n, OpenAI laskuttaa omaa avaintasi: perheessäni se on maksanut kymmeniä senttejä kuussa, vaikka olen testannut sitä koko ajan. Sovellus pysähtyy asettamaasi kuukausirajaan, 50 sentistä 3 dollariin."
      },
      {
        q: "Lasteni koulut ovat eri Wilmoissa. Toimiiko se?",
        a: "Toimii, versiosta 0.2.0 alkaen. Valitse kirjautumissivulla Lisää toisen koulun Wilma ja kirjaudu sinnekin, niin sovellus näyttää kaikki lapset yhdessä ja ilmoitukset jokaisen koulun Wilmasta. Useita Wilmoja voi olla huoltajan tunnuksilla; oppilaan omilla tunnuksilla on yksi."
      },
      {
        q: "Voiko se kääntää viestejä?",
        a: "Kyllä, jos valitset OpenAI:n. Valitse asetuksista kieli (suomi, ruotsi, englanti, ukraina tai arabia), niin muunkieliset viestit, tiedotteet ja merkinnät käännetään sitä mukaa kuin ne tulevat, otsikoita myöten, ja alkuperäinen on klikkauksen päässä. Se maksaa yleensä sentin murto-osan viestiltä. Koululle kirjoittamasi viestin se voi myös lähettää suomeksi tai ruotsiksi: käännös näkyy sanojesi vieressä, ja vain se, mikä näkyy, lähetetään. Itse sovellus on suomeksi, ruotsiksi tai englanniksi."
      },
      {
        q: "Mitä OpenAI näkee?",
        a: "Vain jos valitset OpenAI:n: yhden viestin, tiedotteen tai merkinnän kerrallaan sekä lasten etunimet ja luokat, jotta se tietää, ketä asia koskee. Kun käännökset ovat päällä, myös käännettävät tekstit, ja kirjoittamasi viestit, kun käännät ne suomeksi tai ruotsiksi. Wilma-salasanasi ei koskaan mene sinne. Paikallisella tekoälyllä tai ilman tekoälyä mitään ei lähetetä tekoälypalveluun."
      },
      {
        q: "Missä tietoni ovat?",
        a: "Omalla tietokoneellasi. Viestit, lukujärjestykset ja tekoälyn vastaukset tallennetaan sovellukseen, jotta se aukeaa heti. WilmAI-palvelinta ei ole. Wilma-salasanasi menee vain koulusi Wilmaan; sovellus voi muistaa sen tietokoneesi avainnipussa (macOS:n Avainnippu tai Windowsin Tunnistetietojen hallinta), jotta uudelleen kirjautuminen on yksi klikkaus. Myös OpenAI-avaimesi säilytetään siellä."
      },
      {
        q: "Miksi tämä ei ole verkkosivusto?",
        a: "Haluaisin, että olisi. Verkkosivusto voi kuitenkin olla yhteydessä Wilmaan vain, jos Visma sallii sen, eikä minulla ole Visman lupaa, joten selain estää pyynnöt. Omalla koneellasi toimiva sovellus voi olla yhteydessä Wilmaan suoraan, samaan tapaan kuin selaimesi, kun käytät Wilmaa, ja tunnuksesi pysyvät sinulla."
      },
      {
        q: "Miksi ei puhelinsovellusta?",
        a: "Haluaisin tehdä sellaisen, ja ehkä teenkin. Puhelinsovellus on kuitenkin julkaistava App Storessa, ja Visma voisi vaatia sen poistamista, koska se käyttää Wilmaa ilman Visman lupaa. Työpöytäsovellus ei tarvitse sovelluskauppaa. Sillä näytän, millainen moderni Wilma voisi olla."
      },
      {
        q: "Miten tämä eroaa tekoälyavustajien WilmAI:sta?",
        a: "Avustajien WilmAI antaa Clauden, ChatGPT:n tai muun avustajan lukea Wilmaa puolestasi, ja se vain lukee. WilmAI Home on sovellus, jota käytät itse, tekoälyn kanssa tai ilman, ja se osaa myös lähettää vastauksia, ilmoittautumisia ja poissaoloilmoituksia. Voit käyttää kumpaa tahansa tai molempia."
      }
    ]
  },
  get: {
    title: "Lataa WilmAI Home",
    mac: "Mac",
    macDetail: "Apple Silicon (M1 tai uudempi) · macOS 13.3 tai uudempi",
    includes: "Macin latauksessa on mukana vapaaehtoinen paikallinen tekoäly. Sen 9,1 Gt:n lataus tehdään vain, jos otat paikallisen tekoälyn käyttöön.",
    macNote: "Mac-sovellusta ei ole vielä allekirjoitettu Applen kautta, joten macOS pysäyttää sen ensimmäisellä kerralla: valitse Valmis, avaa sitten Järjestelmäasetukset → Tietosuoja ja turvallisuus ja valitse WilmAI Homen kohdalla Avaa silti. Sen jälkeen sovellus aukeaa normaalisti.",
    windows: "Windows",
    windowsDetail: "Windows 10 tai 11 · 64-bittinen",
    windowsNote: "Windows-asennusohjelmaa ei ole vielä allekirjoitettu, joten selain voi pysäyttää latauksen, koska tiedostoa ei ladata usein. Vie Edgessä osoitin latauksen päälle ja valitse … → Säilytä ja sitten Näytä lisää → Säilytä silti. Windows varoittaa vielä ennen ensimmäistä käynnistystä: valitse Lisätietoja ja sitten Suorita silti. Se asentuu vain sinulle eikä tarvitse ylläpitäjän oikeuksia, mutta koulun tietokoneen asetukset voivat silti estää sen.",
    firstMac: "Macilla ensimmäisellä kerralla",
    firstWindows: "Windowsissa ensimmäisellä kerralla",
    windowsSteps: { download: "Lataus Edgessä", start: "Käynnistys" },
    started: "Lataus alkaa. Seuraavaksi:",
    howTo: "Näin asennus menee",
    pending: "Ensimmäiset lataukset ovat tulossa. Ne ilmestyvät tähän, kun ne ovat valmiita.",
    others: "Linux-versiota ei vielä ole.",
    cliLink: "Tekoälyavustajien WilmAI toimii siinäkin →"
  },
  closing: {
    eyebrow: "muutama sana minulta",
    text: "WilmAI Home on kokeiluni siitä, millainen Wilma voisi olla. Se on beta, ja kaikki palaute auttaa: mikä menee rikki, mikä on epäselvää ja mitä toivoisit seuraavaksi.",
    signature: "— Antti",
    button: "Anna palautetta GitHubissa"
  },
  announce: {
    badge: "Uutta",
    text: "WilmAI Home",
    more: "ilmainen Wilma-sovellus tietokoneellesi",
    detail: "Jokaisen lapsen päivä, viestit omalla kielelläsi ja tekoäly, jos haluat. Macille ja Windowsille.",
    cta: "Katso sovellus"
  },
  card: {
    eyebrow: "tai oma sovellus",
    text: "Etkö käytä tekoälyavustajaa? WilmAI Home on nopea Wilma-sovellus oppilaille ja vanhemmille omalle tietokoneellesi. Se toimii ilman tekoälyä.",
    points: [
      "Jokaisen lapsen päivä, viestit, kokeet ja arvosanat yhdessä näkymässä.",
      "Viestit käännettyinä omalle kielellesi, alkuperäinen klikkauksen päässä.",
      "Tekoäly nostaa ensin sen, mikä vaatii sinua, jos haluat.",
      "Eri koulujen lapset yhdessä."
    ],
    download: "Lataa Macille tai Windowsille",
    link: "Katso, miten se toimii"
  }
};

export const homeCopy: Record<Lang, HomeCopy> = { en, fi };
