import type { Lang } from "./i18n";

/**
 * The privacy page (/en/privacy, /fi/privacy). Every line here is checked
 * against the code it describes; when that code changes, so does this, with
 * the date. Sections are in reading order: a new one (Google Calendar, with
 * Google's Limited Use statement) goes after WilmAI Home, before Cookies.
 */
interface PrivacySection { id: string; title: string; paragraphs: string[] }

export interface PrivacyCopy {
  meta: { title: string; description: string };
  back: string;
  eyebrow: string;
  title: string;
  lead: string;
  updated: string;
  sections: PrivacySection[];
  /** Ends with a link to the GitHub issues. */
  questions: { title: string; text: string; link: string };
  /** Ends with a link to this page's history on GitHub. */
  changes: { title: string; text: string; link: string };
}

const en: PrivacyCopy = {
  meta: {
    title: "Privacy · WilmAI",
    description: "What WilmAI, its website and the WilmAI Home app do with your data: no WilmAI server, no accounts, no tracking. School data stays on your computer."
  },
  back: "WilmAI",
  eyebrow: "privacy",
  title: "Your data stays with you",
  lead: "WilmAI has no server that holds your data, no accounts and no tracking. Your Wilma login and your school data stay on your own computer, and go only where you send them.",
  updated: "Updated 2 November 2026",
  sections: [
    {
      id: "who",
      title: "Who runs WilmAI",
      paragraphs: [
        "WilmAI is an open-source hobby project by me, Antti Karjalainen, a parent in Finland. It is not affiliated with, endorsed by, or connected to Visma or the official Wilma service.",
        "All of the code is public on GitHub, so you can check everything this page says."
      ]
    },
    {
      id: "school-data",
      title: "Your children's school data",
      paragraphs: [
        "The project never receives it. WilmAI's programs run on your computer and read Wilma with your own login, the way your browser does. Nothing goes through a WilmAI server, because there isn't one.",
        "Where school data goes from your computer is up to you: to the AI assistant you connect, or in WilmAI Home to OpenAI, if you choose it. Both are described below."
      ]
    },
    {
      id: "website",
      title: "This website, wilm.ai",
      paragraphs: [
        "The site is static pages served by Cloudflare. It has no analytics or advertising scripts and loads nothing from other sites; even the fonts come from wilm.ai.",
        "Cloudflare handles each request, your IP address included, to deliver the page. The few addresses that run code at Cloudflare (sending you to your language, the download buttons, and the download and star counts) log their requests for three days, to catch errors.",
        "I look only at totals that Cloudflare keeps anyway: how many times the pages were viewed and the installers downloaded, roughly how many visitors there were and from which countries, and how many update checks came in. They are counts, not people.",
        "The download and star numbers on the pages are fetched by the site itself once a day. Your browser doesn't contact npm or GitHub for them."
      ]
    },
    {
      id: "cli",
      title: "The CLI, the MCP server and the skills",
      paragraphs: [
        "They run on your computer. Your Wilma login is saved in ~/.config/wilmai/config.json, readable only by your user account, with the password scrambled, not encrypted. The current Wilma session is kept next to it for at most six hours.",
        "When you connect an AI assistant (Claude, ChatGPT, Codex, OpenClaw or another), what it reads from Wilma goes to that assistant's provider under their terms, the same as if you pasted it into a chat. Your Wilma password doesn't: you type it into the login page, never into the chat.",
        "Besides your school's Wilma, the CLI asks npm at most once a day whether there's a newer version (WILMAI_NO_UPDATE_CHECK=1 turns this off), and opens links in school bulletins when you ask for an attachment."
      ]
    },
    {
      id: "home",
      title: "WilmAI Home",
      paragraphs: [
        "The app runs on your computer and talks to your school's Wilma directly. Messages, timetables, drafts and AI answers are stored in the app, on your computer.",
        "When you sign in with a password, the app remembers it on your computer, scrambled, not encrypted, so signing in again is one click. On a shared computer, untick Remember on this computer. Forget it in Settings, or signing out, removes it. An OpenAI API key is kept the same way. Reset app in Settings deletes all of it.",
        "No AI, the default: nothing goes to an AI service. Local AI: the models are downloaded once from Hugging Face, and the reading happens on your Mac, so no school data leaves it.",
        "OpenAI, with your own API key: the app sends one message, bulletin or lesson note at a time, with your children's first names and classes so it can tell whom it's about, straight from your computer to OpenAI. It asks OpenAI not to store the readings. To mark PE days, it also sends the names of the subjects in your children's timetables, once. If you turn on translations, it also sends the texts it translates the same way: messages and bulletins, and Wilma's shorter texts such as subject names, list titles and teachers' notes. If you choose to write to the school in Finnish or Swedish, Translate sends what you wrote, with its subject, the same way. OpenAI handles the data under its API terms, and bills your key.",
        "A few times a day the app asks wilm.ai whether there's a newer version. The request carries no identifier, only what any request carries: your computer's IP address, and the updater's name and version. Updates and installers are downloaded from GitHub. Look for new versions in Settings turns the checks off.",
        "The app has no telemetry, no crash reports and no accounts. GitHub tells me only how many times each installer was downloaded."
      ]
    },
    {
      id: "cookies",
      title: "Cookies",
      paragraphs: [
        "wilm.ai has one cookie, and only when you set it: picking EN or FI with the language switch saves lang=en or lang=fi in your browser for a year, so the site opens in your language. It holds nothing else and goes nowhere but wilm.ai.",
        "As it only remembers a choice you made, the law allows it without asking first (section 205 of Finland's Act on Electronic Communications Services, which follows the EU's ePrivacy rules). There are no analytics, advertising or third-party cookies, and so no cookie banner.",
        "Cloudflare's bot-detection cookies are off for this site. Only if Cloudflare ever has to check a visitor during an attack does it set its own security cookie, cf_clearance, which is strictly necessary for that.",
        "To remove the language cookie, clear wilm.ai's cookies in your browser. The CLI and WilmAI Home keep their data in files and app storage on your computer, not in cookies."
      ]
    },
    {
      id: "gdpr",
      title: "Personal data and your rights (GDPR)",
      paragraphs: [
        "For this website and WilmAI Home's update checks, I'm the controller of the only personal data involved: the IP address and browser details in each request to wilm.ai. Cloudflare processes them for me under its Data Processing Addendum. I use them only to deliver the site and the updates and to keep both working and secure, which is my legitimate interest (GDPR Article 6(1)(f)). The site's logs are kept for three days and Cloudflare's own request statistics as its service sets; I look only at totals.",
        "Visitors in Finland are usually served from Cloudflare's data centres in the Nordics, but its logs and statistics can be kept elsewhere, the US included, and as a US company Cloudflare is subject to US law. Such transfers rely on the EU–US Data Privacy Framework, which Cloudflare takes part in, and on the EU's standard contractual clauses in its Data Processing Addendum.",
        "I'm not the controller of your Wilma login or your school data. The CLI and WilmAI Home process them on your own computer, at your direction, and I never receive them. When you send them on, to an AI assistant or to OpenAI with your own key, that service handles them under your own agreement with it. GitHub handles downloads under its own privacy statement.",
        "Nothing on my side makes automated decisions about you or profiles anyone.",
        "You have the right to access your personal data, to have it corrected or erased, to restrict or object to its processing, and to data portability where it applies. As I hold nothing that identifies you beyond three days of request logs, there's usually nothing to hand over or delete, but you can always ask: write to privacy@wilm.ai. You can also complain to the Office of the Data Protection Ombudsman, Finland's supervisory authority (tietosuoja.fi)."
      ]
    }
  ],
  questions: {
    title: "Questions",
    text: "Ask on GitHub, or write to feedback@wilm.ai. Please leave out messages, children's names and logins. For anything about your personal data, write to privacy@wilm.ai.",
    link: "Open an issue"
  },
  changes: {
    title: "Changes",
    text: "When this page changes, the date at the top changes too, and every earlier version stays in the project's history.",
    link: "This page's history on GitHub"
  }
};

const fi: PrivacyCopy = {
  meta: {
    title: "Tietosuoja · WilmAI",
    description: "Mitä WilmAI, sen verkkosivusto ja WilmAI Home -sovellus tekevät tiedoillesi: ei WilmAI-palvelinta, ei käyttäjätilejä, ei seurantaa. Koulun tiedot pysyvät omalla koneellasi."
  },
  back: "WilmAI",
  eyebrow: "tietosuoja",
  title: "Tietosi pysyvät sinulla",
  lead: "WilmAI:lla ei ole palvelinta, jolla tietosi olisivat, eikä käyttäjätilejä tai seurantaa. Wilma-tunnuksesi ja koulun tiedot pysyvät omalla tietokoneellasi ja menevät vain sinne, minne itse ne lähetät.",
  updated: "Päivitetty 2.11.2026",
  sections: [
    {
      id: "who",
      title: "Kuka WilmAI:n takana on",
      paragraphs: [
        "WilmAI on minun, Antti Karjalaisen, avoimen lähdekoodin harrastusprojekti. Olen itsekin vanhempi. WilmAI ei ole Visman tai virallisen Wilma-palvelun tekemä, tukema tai hyväksymä.",
        "Kaikki koodi on julkisesti GitHubissa, joten voit tarkistaa kaiken, mitä tällä sivulla kerrotaan."
      ]
    },
    {
      id: "school-data",
      title: "Lasten koulutiedot",
      paragraphs: [
        "Projekti ei saa niitä koskaan. WilmAI:n ohjelmat toimivat omalla koneellasi ja lukevat Wilmaa sinun tunnuksillasi, samaan tapaan kuin selaimesi. Mikään ei kulje WilmAI:n palvelimen kautta, koska sellaista ei ole.",
        "Sinä päätät, minne koulutiedot koneeltasi menevät: avustajalle, jonka yhdistät, tai WilmAI Homessa OpenAI:lle, jos valitset sen. Molemmista kerrotaan alempana."
      ]
    },
    {
      id: "website",
      title: "Tämä sivusto, wilm.ai",
      paragraphs: [
        "Sivusto on staattisia sivuja, jotka Cloudflare toimittaa. Siinä ei ole analytiikka- eikä mainosskriptejä, eikä se lataa mitään muilta sivustoilta; fontitkin tulevat wilm.ai:sta.",
        "Cloudflare käsittelee jokaisen pyynnön, myös IP-osoitteesi, toimittaakseen sivun. Ne harvat osoitteet, joissa Cloudflarella ajetaan koodia (kieleen ohjaus, latauspainikkeet sekä lataus- ja tähtimäärät), kirjaavat pyyntönsä lokiin kolmeksi päiväksi virheiden löytämiseksi.",
        "Katson vain kokonaismääriä, jotka Cloudflarella on joka tapauksessa: montako kertaa sivuja katsottiin ja asennusohjelmia ladattiin, suunnilleen montako kävijää oli ja mistä maista, ja montako päivitystarkistusta tuli. Ne ovat lukumääriä, eivät ihmisiä.",
        "Sivujen lataus- ja tähtimäärät sivusto hakee itse kerran päivässä. Selaimesi ei ota niiden takia yhteyttä npm:ään eikä GitHubiin."
      ]
    },
    {
      id: "cli",
      title: "Komentorivi, MCP-palvelin ja taidot",
      paragraphs: [
        "Ne toimivat omalla koneellasi. Wilma-tunnuksesi tallennetaan tiedostoon ~/.config/wilmai/config.json, jota vain käyttäjätilisi voi lukea. Salasana on siinä peitettynä, ei salattuna. Voimassa oleva Wilma-istunto pidetään sen vieressä enintään kuusi tuntia.",
        "Kun yhdistät tekoälyavustajan (Claude, ChatGPT, Codex, OpenClaw tai jokin muu), se mitä avustaja lukee Wilmasta menee avustajan tarjoajalle sen ehdoin, aivan kuin liittäisit tekstin keskusteluun. Wilma-salasanasi ei mene: kirjoitat sen kirjautumissivulle, et koskaan keskusteluun.",
        "Koulusi Wilman lisäksi komentorivi kysyy npm:stä enintään kerran päivässä, onko uudempaa versiota (WILMAI_NO_UPDATE_CHECK=1 ottaa tämän pois), ja avaa tiedotteiden linkkejä, kun pyydät liitettä."
      ]
    },
    {
      id: "home",
      title: "WilmAI Home",
      paragraphs: [
        "Sovellus toimii koneellasi ja on yhteydessä suoraan koulusi Wilmaan. Viestit, lukujärjestykset, luonnokset ja tekoälyn vastaukset tallennetaan sovellukseen omalle koneellesi.",
        "Kun kirjaudut salasanalla, sovellus muistaa sen koneellasi peitettynä, ei salattuna, joten uudelleen kirjautuminen on yksi klikkaus. Yhteiskäyttöisellä koneella jätä Muista tällä koneella pois. Asetusten Unohda se tai uloskirjautuminen poistaa salasanan. OpenAI:n API-avain säilytetään samalla tavalla. Asetusten Nollaa sovellus poistaa ne kaikki.",
        "Ei tekoälyä, oletus: mitään ei lähetetä tekoälypalveluun. Paikallinen tekoäly: mallit ladataan kerran Hugging Facesta, ja lukeminen tapahtuu Macillasi, joten koulutiedot eivät lähde siltä.",
        "OpenAI omalla API-avaimellasi: sovellus lähettää yhden viestin, tiedotteen tai tuntimerkinnän kerrallaan suoraan koneeltasi OpenAI:lle, mukana lasten etunimet ja luokat, jotta se tietää, ketä asia koskee. Sovellus pyytää OpenAI:ta olemaan tallentamatta lukemiaan. Liikuntapäivien merkitsemiseksi se lähettää kerran myös lasten lukujärjestysten oppiaineiden nimet. Jos otat käännökset käyttöön, sovellus lähettää samalla tavalla myös kääntämänsä tekstit: viestit ja tiedotteet sekä Wilman lyhyemmät tekstit, kuten aineiden nimet, listojen otsikot ja opettajien merkinnät. Jos valitset kirjoittavasi koululle suomeksi tai ruotsiksi, Käännä lähettää samalla tavalla kirjoittamasi viestin otsikkoineen. OpenAI käsittelee tiedot API-ehtojensa mukaan ja laskuttaa avaintasi.",
        "Muutaman kerran päivässä sovellus kysyy wilm.ai:sta, onko uudempaa versiota. Pyynnössä ei ole mitään tunnistetta, vain se mikä missä tahansa pyynnössä: koneesi IP-osoite sekä päivittäjän nimi ja versio. Päivitykset ja asennusohjelmat ladataan GitHubista. Asetusten Tarkista uudet versiot ottaa tarkistukset pois.",
        "Sovelluksessa ei ole telemetriaa, virheraportointia eikä käyttäjätilejä. GitHub kertoo minulle vain, montako kertaa kukin asennusohjelma on ladattu."
      ]
    },
    {
      id: "cookies",
      title: "Evästeet",
      paragraphs: [
        "wilm.ai käyttää yhtä evästettä, ja vain jos itse asetat sen: kun valitset kielivalitsimesta EN tai FI, selaimesi tallentaa vuodeksi lang=en tai lang=fi, jotta sivusto aukeaa valitsemallasi kielellä. Siinä ei ole muuta, eikä se mene minnekään muualle kuin wilm.ai:hin.",
        "Koska eväste vain muistaa tekemäsi valinnan, laki sallii sen ilman ennakkosuostumusta (sähköisen viestinnän palveluista annetun lain 205 §, joka perustuu EU:n sähköisen viestinnän tietosuojasääntöihin). Analytiikka-, mainos- tai kolmannen osapuolen evästeitä ei ole, joten evästebanneriakaan ei ole.",
        "Cloudflaren bottien tunnistusevästeet ovat tällä sivustolla pois päältä. Vain jos Cloudflaren pitää joskus hyökkäyksen aikana tarkistaa kävijä, se asettaa oman tietoturvaevästeensä cf_clearance, joka on siihen välttämätön.",
        "Kielievästeen saat pois tyhjentämällä wilm.ai:n evästeet selaimestasi. Komentorivi ja WilmAI Home pitävät tietonsa tiedostoissa ja sovelluksen tallennustilassa koneellasi, eivät evästeissä."
      ]
    },
    {
      id: "gdpr",
      title: "Henkilötiedot ja oikeutesi (GDPR)",
      paragraphs: [
        "Tämän sivuston ja WilmAI Homen päivitystarkistusten osalta olen rekisterinpitäjä ainoille niissä liikkuville henkilötiedoille: jokaisen wilm.ai:hin tulevan pyynnön IP-osoitteelle ja selaimen tiedoille. Cloudflare käsittelee niitä puolestani tietojenkäsittelyehtojensa (Data Processing Addendum) mukaisesti. Käytän niitä vain sivuston ja päivitysten toimittamiseen sekä niiden toiminnan ja turvallisuuden varmistamiseen, mikä on oikeutettu etuni (tietosuoja-asetuksen 6 artiklan 1 kohdan f alakohta). Sivuston lokit säilyvät kolme päivää ja Cloudflaren omat pyyntötilastot sen palvelun mukaisesti; itse katson vain kokonaismääriä.",
        "Suomesta tulevat kävijät saavat sivut yleensä Cloudflaren Pohjoismaiden datakeskuksista, mutta sen lokit ja tilastot voidaan säilyttää muuallakin, myös Yhdysvalloissa, ja yhdysvaltalaisena yhtiönä Cloudflare on Yhdysvaltain lain alainen. Siirrot perustuvat EU:n ja Yhdysvaltojen väliseen tietosuojakehykseen (Data Privacy Framework), johon Cloudflare on sitoutunut, sekä sen tietojenkäsittelyehtojen EU:n vakiosopimuslausekkeisiin.",
        "En ole Wilma-tunnustesi enkä koulutietojen rekisterinpitäjä. Komentorivi ja WilmAI Home käsittelevät niitä omalla koneellasi sinun ohjauksessasi, enkä saa niitä koskaan. Kun lähetät niitä eteenpäin, tekoälyavustajalle tai omalla avaimellasi OpenAI:lle, palvelu käsittelee niitä sinun ja sen välisen sopimuksen mukaisesti. GitHub käsittelee lataukset oman tietosuojaselosteensa mukaisesti.",
        "En tee sinusta automaattisia päätöksiä enkä profiloi ketään.",
        "Sinulla on oikeus saada pääsy henkilötietoihisi, oikaista tai poistattaa ne, rajoittaa niiden käsittelyä tai vastustaa sitä sekä siirtää ne, kun se on mahdollista. Koska minulla ei ole sinusta tunnistettavia tietoja kolmen päivän pyyntölokeja lukuun ottamatta, luovutettavaa tai poistettavaa ei yleensä ole, mutta voit aina kysyä: kirjoita osoitteeseen privacy@wilm.ai. Voit myös tehdä valituksen tietosuojavaltuutetun toimistolle (tietosuoja.fi)."
      ]
    }
  ],
  questions: {
    title: "Kysymykset",
    text: "Kysy GitHubissa tai kirjoita osoitteeseen feedback@wilm.ai. Jätä pois viestit, lasten nimet ja tunnukset. Henkilötietojasi koskevissa asioissa kirjoita osoitteeseen privacy@wilm.ai.",
    link: "Avaa issue"
  },
  changes: {
    title: "Muutokset",
    text: "Kun tämä sivu muuttuu, myös päivämäärä ylhäällä muuttuu, ja jokainen aiempi versio säilyy projektin historiassa.",
    link: "Sivun historia GitHubissa"
  }
};

export const privacyCopy: Record<Lang, PrivacyCopy> = { en, fi };
