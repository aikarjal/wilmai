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
  guide: Record<Lang, AgentGuide>;
}

const MCPB_DOWNLOAD = "/get/claude";
const REPO = "https://github.com/aikarjal/wilmai";

const firstAsk = {
  en: "For example: “What do the kids have at school tomorrow?” The first time, a login page opens in your browser. Pick your school's Wilma and log in — your login is saved on your computer.",
  fi: "Esimerkiksi: ”Mitä lapsilla on huomenna koulussa?” Ensimmäisellä kerralla selaimeen avautuu kirjautumissivu. Valitse koulusi Wilma ja kirjaudu — kirjautumistiedot tallentuvat omalle koneellesi."
};

const chatgptMessage = {
  en: `Please set up WilmAI so you can read my kids' school information from Wilma.
Add the plugin marketplace aikarjal/wilmai and install the wilma plugin from it. The plugin runs with Node.js, so if Node.js isn't installed on this computer, install the LTS version first.
Tell me when it's ready.`,
  fi: `Ota WilmAI käyttöön, jotta voit lukea lasteni koulutiedot Wilmasta.
Lisää plugin marketplace aikarjal/wilmai ja asenna sieltä wilma-plugin. Plugin toimii Node.js:n avulla, joten jos koneella ei ole Node.js:ää, asenna ensin sen LTS-versio.
Kerro, kun se on valmis.`
};

const grokMessage = {
  en: `Please set up WilmAI so you can read my kids' school information from Wilma.
1. Install the CLI: npm install -g @wilm-ai/wilma-cli
2. Add the Wilma skill from ${REPO} (skills/wilma).
3. Log me in with: wilma login
   If you run on my computer, it opens a login page in my browser.
   If you run on your own cloud computer, ask me which city my kids' school is in, find our Wilma with "wilma tenants <city>" and let me pick it. Then ask me to add WILMA_USERNAME and WILMA_PASSWORD to your secret settings, and set WILMA_TENANT to the Wilma I picked.
Never ask me to type my Wilma password into this chat.`,
  fi: `Ota WilmAI käyttöön, jotta voit lukea lasteni koulutiedot Wilmasta.
1. Asenna CLI: npm install -g @wilm-ai/wilma-cli
2. Lisää Wilma-taito osoitteesta ${REPO} (skills/wilma).
3. Kirjaa minut sisään komennolla: wilma login
   Jos toimit minun koneellani, se avaa kirjautumissivun selaimeeni.
   Jos toimit omalla pilvikoneellasi, kysy missä kaupungissa lasteni koulu on, etsi Wilmamme komennolla "wilma tenants <kaupunki>" ja anna minun valita se. Pyydä sitten minua lisäämään WILMA_USERNAME ja WILMA_PASSWORD salaisuusasetuksiisi, ja aseta WILMA_TENANT valitsemaani Wilmaan.
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

const hostedLater = {
  claude: {
    en: "Claude on the web and the Claude phone app need a hosted connection, which we're testing. Coming later.",
    fi: "Selaimessa ja puhelinsovelluksessa toimiva Claude tarvitsee verkossa toimivan yhteyden, jota testaamme. Tulossa myöhemmin."
  },
  chatgpt: {
    en: "ChatGPT on the web and the ChatGPT phone app need a hosted connection, which we're testing. Coming later.",
    fi: "Selaimessa ja puhelinsovelluksessa toimiva ChatGPT tarvitsee verkossa toimivan yhteyden, jota testaamme. Tulossa myöhemmin."
  }
};

export const agents: Agent[] = [
  {
    id: "claude",
    guide: {
      en: {
        name: "Claude",
        tagline: "Claude Desktop for Mac and Windows",
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
            intro: "Add the WilmAI plugin: the Wilma tools plus the wilma and wilma-triage skills.",
            steps: [
              {
                title: "Run these in Claude Code",
                action: { kind: "command", text: "/plugin marketplace add aikarjal/wilmai\n/plugin install wilma@wilmai" }
              }
            ]
          }
        ],
        notes: [hostedLater.claude.en]
      },
      fi: {
        name: "Claude",
        tagline: "Claude Desktop Macille ja Windowsille",
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
            intro: "Lisää WilmAI-lisäosa: Wilma-työkalut sekä wilma- ja wilma-triage-taidot.",
            steps: [
              {
                title: "Aja nämä Claude Codessa",
                action: { kind: "command", text: "/plugin marketplace add aikarjal/wilmai\n/plugin install wilma@wilmai" }
              }
            ]
          }
        ],
        notes: [hostedLater.claude.fi]
      }
    }
  },
  {
    id: "chatgpt",
    guide: {
      en: {
        name: "ChatGPT",
        tagline: "ChatGPT desktop app",
        summary: "ChatGPT's desktop app can set WilmAI up for you. Send it one message and approve what it asks.",
        steps: [
          {
            title: "Send this to ChatGPT",
            body: "In the ChatGPT desktop app on your computer.",
            action: { kind: "message", text: chatgptMessage.en },
            alternative: {
              title: "Prefer to add it yourself?",
              body: "Open Settings, find MCP servers and add a STDIO server named Wilma with this command. It needs Node.js (nodejs.org).",
              action: { kind: "command", text: "npx -y @wilm-ai/wilma-cli mcp" }
            }
          },
          {
            title: "Approve the setup",
            body: "ChatGPT asks before it installs anything. Allow it, and restart the app if it asks you to."
          },
          { title: "Ask ChatGPT about school", body: firstAsk.en }
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
        notes: [hostedLater.chatgpt.en]
      },
      fi: {
        name: "ChatGPT",
        tagline: "ChatGPT-työpöytäsovellus",
        summary: "ChatGPT:n työpöytäsovellus osaa ottaa WilmAI:n käyttöön puolestasi. Lähetä sille yksi viesti ja hyväksy, mitä se kysyy.",
        steps: [
          {
            title: "Lähetä tämä ChatGPT:lle",
            body: "Tietokoneesi ChatGPT-työpöytäsovelluksessa.",
            action: { kind: "message", text: chatgptMessage.fi },
            alternative: {
              title: "Haluatko lisätä sen itse?",
              body: "Avaa asetukset, etsi MCP servers ja lisää STDIO-palvelin nimeltä Wilma tällä komennolla. Se vaatii Node.js:n (nodejs.org).",
              action: { kind: "command", text: "npx -y @wilm-ai/wilma-cli mcp" }
            }
          },
          {
            title: "Hyväksy asennus",
            body: "ChatGPT kysyy ennen kuin asentaa mitään. Salli se, ja käynnistä sovellus uudelleen, jos se pyytää."
          },
          { title: "Kysy ChatGPT:ltä koulusta", body: firstAsk.fi }
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
        notes: [hostedLater.chatgpt.fi]
      }
    }
  },
  {
    id: "grok",
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
    guide: {
      en: {
        name: "Terminal",
        tagline: "No assistant needed",
        summary: "Prefer the command line? The wilma CLI shows the same information in your terminal, and --json gives scripts and agents structured output.",
        steps: [
          {
            title: "Install",
            body: "Needs Node.js 18 or newer.",
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
            action: { kind: "command", text: "wilma summary --all-students\nwilma schedule list --when tomorrow\nwilma exams list --all-students --json" }
          }
        ]
      },
      fi: {
        name: "Terminaali",
        tagline: "Ilman avustajaa",
        summary: "Komentorivi tuntuu omimmalta? wilma-CLI näyttää samat tiedot terminaalissa, ja --json antaa jäsenneltyä dataa skripteille ja agenteille.",
        steps: [
          {
            title: "Asenna",
            body: "Vaatii Node.js:n version 18 tai uudemman.",
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
            action: { kind: "command", text: "wilma summary --all-students\nwilma schedule list --when tomorrow\nwilma exams list --all-students --json" }
          }
        ]
      }
    }
  }
];

/** Assistants not yet usable from Finland. */
export const comingLater: Record<Lang, { name: string; note: string }[]> = {
  en: [
    { name: "Meta Muse", note: "Not available in Finland yet." },
    { name: "OpenAI dots", note: "Only on business plans in Finland so far." },
    { name: "Instinct", note: "Not available in Finland yet." }
  ],
  fi: [
    { name: "Meta Muse", note: "Ei vielä saatavilla Suomessa." },
    { name: "OpenAI dots", note: "Suomessa toistaiseksi vain yritystileillä." },
    { name: "Instinct", note: "Ei vielä saatavilla Suomessa." }
  ]
};
