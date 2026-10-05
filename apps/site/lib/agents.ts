import type { Lang } from "./i18n";

/*
 * Setup guides per assistant, shown in the home-page picker. When an
 * assistant becomes available in Finland, move it from `comingLater` into
 * `agents`.
 */

export const agentIds = ["claude", "chatgpt", "grok", "openclaw", "cli"] as const;
export type AgentId = (typeof agentIds)[number];

/**
 * - message: text the parent sends to their assistant (light, chat-style).
 * - command: something typed into a terminal or Claude Code (dark).
 */
export type Action =
  | { kind: "download"; href: string; label: string }
  | { kind: "message"; text: string }
  | { kind: "command"; text: string }
  | { kind: "link"; href: string; label: string };

export interface Alternative {
  title: string;
  body?: string;
  action?: Action;
}

export interface SetupStep {
  title: string;
  body?: string;
  action?: Action;
  /** Another way to do this step, shown in a separate "Alternative" box. */
  alternative?: Alternative;
}

export interface SetupVariant {
  title: string;
  intro?: string;
  steps: SetupStep[];
}

export interface AgentGuide {
  name: string;
  /** Short line under the name in the picker. */
  tagline: string;
  /** Only for assistants with a caveat, e.g. "Business plans only". Fully available ones have none. */
  status?: string;
  /** One or two sentences at the top of the guide. */
  summary: string;
  /** The main way to set it up. */
  steps: SetupStep[];
  /** The same assistant's other apps (e.g. Claude Code), shown as alternatives. */
  others?: SetupVariant[];
  notes?: string[];
}

export interface Agent {
  id: AgentId;
  /**
   * Small logo next to the name, from public/logos: the assistants' own logos
   * (SVGs via Lobe Icons, Instinct's favicon); terminal.svg is ours.
   */
  logo: string;
  guide: Record<Lang, AgentGuide>;
}

const MCPB_DOWNLOAD = "/get/claude";
const REPO = "https://github.com/aikarjal/wilmai";

const firstAsk = {
  en: "For example: “What do the kids have at school tomorrow?” The first time, a login page opens in your browser. Pick your school's Wilma and log in — your login is saved on your computer.",
  fi: "Esimerkiksi: ”Mitä lapsilla on huomenna koulussa?” Ensimmäisellä kerralla selaimeen avautuu kirjautumissivu. Valitse koulusi Wilma ja kirjaudu — kirjautumistiedot tallentuvat omalle koneellesi."
};

// A message the parent pastes into ChatGPT; ChatGPT does the installing.
const chatgptMessage = {
  en: `Please install WilmAI so you can read my kids' school information from Wilma.
Add the plugin marketplace aikarjal/wilmai and install the wilma plugin from it, together with anything it needs to run on this computer.
Tell me when it's ready.`,
  fi: `Asenna WilmAI, jotta voit lukea lasteni koulutiedot Wilmasta.
Lisää plugin marketplace aikarjal/wilmai ja asenna sieltä wilma-plugin sekä kaikki, mitä se tarvitsee toimiakseen tällä koneella.
Kerro, kun se on valmis.`
};

const grokMessage = {
  en: `Please set up WilmAI so you can read my kids' school information from Wilma.
1. Install the CLI: npm install -g @wilm-ai/wilma-cli
2. Add the Wilma skill from ${REPO} (skills/wilma).
3. Log me in with: wilma login
   If you run on my computer, it opens a login page in my browser.
   If you run on your own cloud computer, ask me which city my kids' school is in, find our Wilma with "wilma find-school <city>" and let me pick it. Then ask me to add WILMA_USERNAME and WILMA_PASSWORD to your secret settings, and set WILMA_TENANT to the Wilma I picked.
Never ask me to type my Wilma password into this chat.`,
  fi: `Ota WilmAI käyttöön, jotta voit lukea lasteni koulutiedot Wilmasta.
1. Asenna CLI: npm install -g @wilm-ai/wilma-cli
2. Lisää Wilma-taito osoitteesta ${REPO} (skills/wilma).
3. Kirjaa minut sisään komennolla: wilma login
   Jos toimit minun koneellani, se avaa kirjautumissivun selaimeeni.
   Jos toimit omalla pilvikoneellasi, kysy missä kaupungissa lasteni koulu on, etsi Wilmamme komennolla "wilma find-school <kaupunki>" ja anna minun valita se. Pyydä sitten minua lisäämään WILMA_USERNAME ja WILMA_PASSWORD salaisuusasetuksiisi, ja aseta WILMA_TENANT valitsemaani Wilmaan.
Älä koskaan pyydä minua kirjoittamaan Wilma-salasanaani tähän keskusteluun.`
};

const openclawMessage = {
  en: `Please set up WilmAI so you can read my kids' school information from Wilma.
1. Install the CLI: npm install -g @wilm-ai/wilma-cli
2. Install the wilma skill: clawhub install wilma
3. Log me in with: wilma login (it opens a login page in my browser)
Never ask me to type my Wilma password into this chat.`,
  fi: `Ota WilmAI käyttöön, jotta voit lukea lasteni koulutiedot Wilmasta.
1. Asenna CLI: npm install -g @wilm-ai/wilma-cli
2. Asenna wilma-taito: clawhub install wilma
3. Kirjaa minut sisään komennolla: wilma login (se avaa kirjautumissivun selaimeeni)
Älä koskaan pyydä minua kirjoittamaan Wilma-salasanaani tähän keskusteluun.`
};

// Why the web and phone apps can't use WilmAI, and what to use instead.
const phoneNote = {
  claude: {
    en: "Claude on the web and in the phone app can't reach WilmAI: your login stays on your own computer, and WilmAI has no server in between. For updates on your phone, an always-on assistant such as OpenClaw can send them to you in chat.",
    fi: "Selaimessa ja puhelinsovelluksessa toimiva Claude ei pääse WilmAI:hin: kirjautumistietosi pysyvät omalla koneellasi, eikä välissä ole WilmAI:n palvelinta. Jos haluat kuulumiset puhelimeesi, jatkuvasti toimiva avustaja, kuten OpenClaw, voi lähettää ne sinulle viestinä."
  },
  chatgpt: {
    en: "ChatGPT on the web and in the phone app can't reach WilmAI: your login stays on your own computer, and WilmAI has no server in between. For updates on your phone, an always-on assistant such as OpenClaw can send them to you in chat.",
    fi: "Selaimessa ja puhelinsovelluksessa toimiva ChatGPT ei pääse WilmAI:hin: kirjautumistietosi pysyvät omalla koneellasi, eikä välissä ole WilmAI:n palvelinta. Jos haluat kuulumiset puhelimeesi, jatkuvasti toimiva avustaja, kuten OpenClaw, voi lähettää ne sinulle viestinä."
  }
};

export const agents: Agent[] = [
  {
    id: "claude",
    logo: "/logos/claude.svg",
    guide: {
      en: {
        name: "Claude Desktop",
        tagline: "For Mac and Windows",
        summary: "The simplest setup: download one file and open it. Claude can then answer questions about your kids' school day.",
        steps: [
          {
            title: "Download WilmAI for Claude",
            body: "A small extension file, wilmai.mcpb.",
            action: { kind: "download", href: MCPB_DOWNLOAD, label: "Download for Claude Desktop" }
          },
          {
            title: "Open the file",
            body: "Double-click it. Claude Desktop opens and asks whether to install WilmAI. Click Install."
          },
          { title: "Ask Claude about school", body: firstAsk.en }
        ],
        others: [
          {
            title: "Using Claude Code?",
            intro: "Add the Wilma tools with one command.",
            steps: [
              {
                title: "Run this in your terminal",
                action: { kind: "command", text: "claude mcp add --scope user wilma -- npx -y @wilm-ai/wilma-cli@2 mcp" }
              }
            ]
          }
        ],
        notes: [phoneNote.claude.en]
      },
      fi: {
        name: "Claude Desktop",
        tagline: "Macille ja Windowsille",
        summary: "Helpoin tapa: lataa yksi tiedosto ja avaa se. Sen jälkeen Claude vastaa kysymyksiin lastesi koulupäivästä.",
        steps: [
          {
            title: "Lataa WilmAI Claudelle",
            body: "Pieni laajennustiedosto, wilmai.mcpb.",
            action: { kind: "download", href: MCPB_DOWNLOAD, label: "Lataa Claude Desktopille" }
          },
          {
            title: "Avaa tiedosto",
            body: "Kaksoisnapsauta sitä. Claude Desktop aukeaa ja kysyy, asennetaanko WilmAI. Valitse Install."
          },
          { title: "Kysy Claudelta koulusta", body: firstAsk.fi }
        ],
        others: [
          {
            title: "Käytätkö Claude Codea?",
            intro: "Lisää Wilma-työkalut yhdellä komennolla.",
            steps: [
              {
                title: "Aja tämä terminaalissa",
                action: { kind: "command", text: "claude mcp add --scope user wilma -- npx -y @wilm-ai/wilma-cli@2 mcp" }
              }
            ]
          }
        ],
        notes: [phoneNote.claude.fi]
      }
    }
  },
  {
    id: "chatgpt",
    logo: "/logos/openai.svg",
    guide: {
      en: {
        name: "ChatGPT Desktop",
        tagline: "For Mac and Windows",
        summary: "ChatGPT Desktop can install WilmAI itself. Switch to Work, copy one message into it and allow what it asks.",
        steps: [
          {
            title: "Switch to Work and copy this message",
            body: "In the ChatGPT app on your computer (not in the browser), pick Work instead of Chat at the top left. Paste the message and send it.",
            action: { kind: "message", text: chatgptMessage.en }
          },
          {
            title: "Allow the installation",
            body: "ChatGPT asks before it installs anything. Allow it, and restart the app if it asks you to."
          },
          { title: "Ask about school in Work", body: firstAsk.en }
        ],
        others: [
          {
            title: "Using Codex?",
            intro: "Add the WilmAI plugin: the Wilma tools plus the wilma and wilma-triage skills.",
            steps: [
              {
                title: "Run these in a terminal",
                action: { kind: "command", text: "codex plugin marketplace add aikarjal/wilmai\ncodex plugin add wilma@wilmai" }
              }
            ]
          }
        ],
        notes: [
          "WilmAI works in ChatGPT's Work mode. In Chat, ChatGPT doesn't use it, so ask about school in Work.",
          phoneNote.chatgpt.en
        ]
      },
      fi: {
        name: "ChatGPT Desktop",
        tagline: "Macille ja Windowsille",
        summary: "ChatGPT Desktop osaa asentaa WilmAI:n itse. Vaihda Work-tilaan, kopioi sille yksi viesti ja salli, mitä se kysyy.",
        steps: [
          {
            title: "Vaihda Work-tilaan ja kopioi tämä viesti",
            body: "Valitse tietokoneesi ChatGPT-sovelluksessa (ei selaimessa) vasemmasta yläkulmasta Work eikä Chat. Liitä viesti ja lähetä.",
            action: { kind: "message", text: chatgptMessage.fi }
          },
          {
            title: "Salli asennus",
            body: "ChatGPT kysyy ennen kuin asentaa mitään. Salli se, ja käynnistä sovellus uudelleen, jos se pyytää."
          },
          { title: "Kysy koulusta Work-tilassa", body: firstAsk.fi }
        ],
        others: [
          {
            title: "Käytätkö Codexia?",
            intro: "Lisää WilmAI-lisäosa: Wilma-työkalut sekä wilma- ja wilma-triage-taidot.",
            steps: [
              {
                title: "Aja nämä terminaalissa",
                action: { kind: "command", text: "codex plugin marketplace add aikarjal/wilmai\ncodex plugin add wilma@wilmai" }
              }
            ]
          }
        ],
        notes: [
          "WilmAI toimii ChatGPT:n Work-tilassa. Chat-tilassa ChatGPT ei käytä sitä, joten kysy koulusta Work-tilassa.",
          phoneNote.chatgpt.fi
        ]
      }
    }
  },
  {
    id: "grok",
    logo: "/logos/grok.svg",
    guide: {
      en: {
        name: "Grok Bot",
        tagline: "Send one message",
        summary: "Grok Bot has its own computer, so it can install WilmAI itself. You send one message and log in when it asks.",
        steps: [
          { title: "Send this to your bot", action: { kind: "message", text: grokMessage.en } },
          {
            title: "Log in to Wilma",
            body: "If the bot runs on your computer, a login page opens in your browser. If it runs on its own cloud computer, it asks you to add your Wilma login to its secret settings. Don't type your Wilma password into the chat."
          },
          {
            title: "Ask about school",
            body: "Try: “Every weekday at 7, send me a school briefing for both kids.”"
          }
        ]
      },
      fi: {
        name: "Grok Bot",
        tagline: "Lähetä yksi viesti",
        summary: "Grok Botilla on oma tietokone, joten se osaa asentaa WilmAI:n itse. Lähetät yhden viestin ja kirjaudut, kun se pyytää.",
        steps: [
          { title: "Lähetä tämä botillesi", action: { kind: "message", text: grokMessage.fi } },
          {
            title: "Kirjaudu Wilmaan",
            body: "Jos botti toimii omalla koneellasi, kirjautumissivu avautuu selaimeesi. Jos se toimii omalla pilvikoneellaan, se pyytää sinua lisäämään Wilma-tunnuksesi sen salaisuusasetuksiin. Älä kirjoita Wilma-salasanaasi keskusteluun."
          },
          {
            title: "Kysy koulusta",
            body: "Kokeile: ”Lähetä minulle joka arkiaamu klo 7 kooste molempien lasten koulupäivästä.”"
          }
        ]
      }
    }
  },
  {
    id: "openclaw",
    logo: "/logos/openclaw.svg",
    guide: {
      en: {
        name: "OpenClaw",
        tagline: "Skill from ClawHub",
        summary: "Install the wilma skill from ClawHub, then tell your agent what mornings should look like.",
        steps: [
          {
            title: "Send this to OpenClaw",
            action: { kind: "message", text: openclawMessage.en },
            alternative: {
              title: "Prefer the terminal?",
              body: "Run these yourself instead:",
              action: { kind: "command", text: "npm install -g @wilm-ai/wilma-cli\nwilma login\nclawhub install wilma" }
            }
          },
          {
            title: "Make it a routine",
            body: "For a daily briefing that also puts new exams in your calendar, add the ready-made wilma-triage skill.",
            action: { kind: "link", href: `${REPO}/tree/main/skills/wilma-triage`, label: "wilma-triage skill" }
          }
        ],
        notes: ["The wilma skill on ClawHub: https://clawhub.ai/aikarjal/wilma"]
      },
      fi: {
        name: "OpenClaw",
        tagline: "Taito ClawHubista",
        summary: "Asenna wilma-taito ClawHubista ja kerro agentillesi, miltä aamujen pitäisi näyttää.",
        steps: [
          {
            title: "Lähetä tämä OpenClaw'lle",
            action: { kind: "message", text: openclawMessage.fi },
            alternative: {
              title: "Terminaali tuntuu omimmalta?",
              body: "Aja nämä itse:",
              action: { kind: "command", text: "npm install -g @wilm-ai/wilma-cli\nwilma login\nclawhub install wilma" }
            }
          },
          {
            title: "Tee siitä rutiini",
            body: "Päivittäistä koostetta varten, joka lisää myös uudet kokeet kalenteriin, lisää valmis wilma-triage-taito.",
            action: { kind: "link", href: `${REPO}/tree/main/skills/wilma-triage`, label: "wilma-triage-taito" }
          }
        ],
        notes: ["wilma-taito ClawHubissa: https://clawhub.ai/aikarjal/wilma"]
      }
    }
  },
  {
    id: "cli",
    logo: "/logos/terminal.svg",
    guide: {
      en: {
        name: "Terminal",
        tagline: "No assistant needed",
        summary: "Prefer the command line? The wilma CLI shows the same information in your terminal, and gives scripts and agents JSON.",
        steps: [
          {
            title: "Install",
            body: "Needs Node.js 20 or newer.",
            action: { kind: "command", text: "npm install -g @wilm-ai/wilma-cli" }
          },
          {
            title: "Log in",
            body: "Opens a login page in your browser.",
            action: { kind: "command", text: "wilma login" }
          },
          {
            title: "Look things up",
            body: "Run wilma on its own for an interactive menu, or wilma --help for every command.",
            action: { kind: "command", text: "wilma summary\nwilma schedule tomorrow\nwilma exams" }
          }
        ]
      },
      fi: {
        name: "Terminaali",
        tagline: "Ilman avustajaa",
        summary: "Komentorivi tuntuu omimmalta? wilma-CLI näyttää samat tiedot terminaalissa ja antaa skripteille ja agenteille jäsenneltyä dataa (JSON).",
        steps: [
          {
            title: "Asenna",
            body: "Vaatii Node.js:n version 20 tai uudemman.",
            action: { kind: "command", text: "npm install -g @wilm-ai/wilma-cli" }
          },
          {
            title: "Kirjaudu",
            body: "Avaa kirjautumissivun selaimeesi.",
            action: { kind: "command", text: "wilma login" }
          },
          {
            title: "Hae tietoja",
            body: "Pelkkä wilma avaa valikon, ja wilma --help listaa kaikki komennot.",
            action: { kind: "command", text: "wilma summary\nwilma schedule tomorrow\nwilma exams" }
          }
        ]
      }
    }
  }
];

/** Assistants not yet usable from Finland. */
export interface ComingLater {
  name: string;
  logo: string;
  note: string;
}

export const comingLater: Record<Lang, ComingLater[]> = {
  en: [
    { name: "Meta Muse", logo: "/logos/meta.svg", note: "Not available in Finland yet." },
    { name: "OpenAI dots", logo: "/logos/openai.svg", note: "Only on business plans in Finland so far." },
    { name: "Instinct", logo: "/logos/instinct.png", note: "Not available in Finland yet." }
  ],
  fi: [
    { name: "Meta Muse", logo: "/logos/meta.svg", note: "Ei vielä saatavilla Suomessa." },
    { name: "OpenAI dots", logo: "/logos/openai.svg", note: "Suomessa toistaiseksi vain yritystileillä." },
    { name: "Instinct", logo: "/logos/instinct.png", note: "Ei vielä saatavilla Suomessa." }
  ]
};
