import type { Lang } from "./i18n";

/*
 * Setup guides per assistant, shown in the home-page picker. When an
 * assistant becomes available in Finland, take it out of the "Coming later"
 * line (quickstart.comingLater in i18n.tsx) and add its guide here.
 */

export const agentIds = ["claude", "chatgpt", "grok", "openclaw", "claude-code", "codex", "cli"] as const;
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

export interface SetupStep {
  title: string;
  body?: string;
  action?: Action;
}

/** Another way to set it up, for people at home in a terminal (shown folded). */
export interface SetupVariant {
  title: string;
  body?: string;
  action: Action;
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
  /** Another way to set it up from a terminal, folded under the guide. */
  others?: SetupVariant[];
  notes?: string[];
}

export interface Agent {
  id: AgentId;
  /**
   * Small logo next to the name, from public/logos: the assistants' own logos
   * (SVGs via Lobe Icons; OpenClaw's flattened to one red); terminal.svg is ours.
   */
  logo: string;
  /** Short name in the hero's "Works with" row; the row shows the agents that have one. */
  brand?: string;
  /** Second row of the picker, under "If you use a terminal". */
  terminal?: boolean;
  guide: Record<Lang, AgentGuide>;
}

const MCPB_DOWNLOAD = "/get/claude";
const CLAUDE_CODE_COMMAND = "claude mcp add --scope user wilma -- npx -y @wilm-ai/wilma-cli@2 mcp";
const CODEX_COMMANDS = "codex plugin marketplace add aikarjal/wilmai\ncodex plugin add wilma@wilmai";
const REPO = "https://github.com/aikarjal/wilmai";

const firstAsk = {
  en: "For example: “What do the kids have at school tomorrow?” The first time, you log in to Wilma in your browser.",
  fi: "Esimerkiksi: ”Mitä lapsilla on huomenna koulussa?” Ensimmäisellä kerralla kirjaudut Wilmaan selaimessa."
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

// The second OpenClaw message: the daily briefing (the wilma-triage skill).
const triageMessage = {
  en: `Please install the wilma-triage skill: clawhub install wilma-triage
Then run it every weekday at 7:00: send me a school briefing for all my kids here, and add new exams and school events to my calendar.
Ask me which calendar to use, and remember what I tell you to report or skip.`,
  fi: `Asenna wilma-triage-taito: clawhub install wilma-triage
Aja se sitten joka arkiaamu klo 7: lähetä minulle tänne koulukooste kaikista lapsistani ja lisää uudet kokeet ja koulun tapahtumat kalenteriini.
Kysy, mitä kalenteria käytetään, ja muista, mitä pyydän raportoimaan tai jättämään pois.`
};

// Where it works. The FAQ explains why not on the web or phone.
const whereNote = {
  claude: {
    en: "Works in the Claude app on your computer, not on the web or in the phone app.",
    fi: "Toimii tietokoneesi Claude-sovelluksessa, ei selaimessa eikä puhelinsovelluksessa."
  },
  chatgpt: {
    en: "Works in Work mode of the ChatGPT app on your computer: not in Chat, on the web or in the phone app.",
    fi: "Toimii tietokoneesi ChatGPT-sovelluksen Work-tilassa: ei Chat-tilassa, selaimessa eikä puhelinsovelluksessa."
  }
};

export const agents: Agent[] = [
  {
    id: "claude",
    logo: "/logos/claude.svg",
    brand: "Claude",
    guide: {
      en: {
        name: "Claude Desktop",
        tagline: "For Mac and Windows",
        summary: "Download one file and open it. Then ask Claude about school.",
        steps: [
          {
            title: "Download WilmAI for Claude",
            action: { kind: "download", href: MCPB_DOWNLOAD, label: "Download for Claude Desktop" }
          },
          { title: "Open the file", body: "Claude asks whether to install WilmAI. Click Install." },
          { title: "Ask Claude about school", body: firstAsk.en }
        ],
        notes: [whereNote.claude.en]
      },
      fi: {
        name: "Claude Desktop",
        tagline: "Macille ja Windowsille",
        summary: "Lataa yksi tiedosto ja avaa se. Sitten voit kysyä Claudelta koulupäivän kuulumiset.",
        steps: [
          {
            title: "Lataa WilmAI Claudelle",
            action: { kind: "download", href: MCPB_DOWNLOAD, label: "Lataa Claude Desktopille" }
          },
          { title: "Avaa tiedosto", body: "Claude kysyy, asennetaanko WilmAI. Valitse Install." },
          { title: "Kysy Claudelta koulusta", body: firstAsk.fi }
        ],
        notes: [whereNote.claude.fi]
      }
    }
  },
  {
    id: "chatgpt",
    logo: "/logos/openai.svg",
    brand: "ChatGPT",
    guide: {
      en: {
        name: "ChatGPT Desktop",
        tagline: "For Mac and Windows",
        summary: "ChatGPT installs WilmAI itself. Send it one message in Work mode.",
        steps: [
          {
            title: "Send this message in Work mode",
            body: "In the ChatGPT app on your computer, pick Work at the top of the window (not Chat), then send:",
            action: { kind: "message", text: chatgptMessage.en }
          },
          { title: "Allow the installation", body: "ChatGPT asks first. Allow it." },
          { title: "Ask about school in Work", body: firstAsk.en }
        ],
        notes: [whereNote.chatgpt.en]
      },
      fi: {
        name: "ChatGPT Desktop",
        tagline: "Macille ja Windowsille",
        summary: "ChatGPT asentaa WilmAI:n itse. Lähetä sille yksi viesti Work-tilassa.",
        steps: [
          {
            title: "Lähetä tämä viesti Work-tilassa",
            body: "Valitse tietokoneesi ChatGPT-sovelluksen yläreunasta Work (ei Chat) ja lähetä:",
            action: { kind: "message", text: chatgptMessage.fi }
          },
          { title: "Salli asennus", body: "ChatGPT kysyy ensin. Salli se." },
          { title: "Kysy koulusta Work-tilassa", body: firstAsk.fi }
        ],
        notes: [whereNote.chatgpt.fi]
      }
    }
  },
  {
    id: "grok",
    logo: "/logos/grok.svg",
    brand: "Grok",
    guide: {
      en: {
        name: "Grok Bot",
        tagline: "Send one message",
        summary: "Grok Bot installs WilmAI itself. Send it one message and log in when it asks.",
        steps: [
          { title: "Send this to your bot", action: { kind: "message", text: grokMessage.en } },
          {
            title: "Log in to Wilma",
            body: "The bot shows you how. Never type your Wilma password into the chat."
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
        summary: "Grok Bot asentaa WilmAI:n itse. Lähetä sille yksi viesti ja kirjaudu, kun se pyytää.",
        steps: [
          { title: "Lähetä tämä botillesi", action: { kind: "message", text: grokMessage.fi } },
          {
            title: "Kirjaudu Wilmaan",
            body: "Botti neuvoo, miten. Älä koskaan kirjoita Wilma-salasanaasi keskusteluun."
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
    brand: "OpenClaw",
    guide: {
      en: {
        name: "OpenClaw",
        tagline: "Daily briefings",
        summary: "OpenClaw installs WilmAI itself. One message sets it up, a second one starts a daily school briefing.",
        steps: [
          { title: "Send this to OpenClaw", action: { kind: "message", text: openclawMessage.en } },
          {
            title: "Start the daily briefing",
            body: "Then send this. OpenClaw asks which calendar to use, and from then on you get a briefing every school morning.",
            action: { kind: "message", text: triageMessage.en }
          },
          {
            title: "Tell it what matters",
            body: "Reply to a briefing with what to skip or always mention. It remembers."
          }
        ],
        notes: ["The skills on ClawHub: https://clawhub.ai/aikarjal/skills/wilma and https://clawhub.ai/aikarjal/skills/wilma-triage"],
        others: [
          {
            title: "Prefer the terminal?",
            body: "Run these yourself:",
            action: { kind: "command", text: "npm install -g @wilm-ai/wilma-cli\nwilma login\nclawhub install wilma" }
          }
        ]
      },
      fi: {
        name: "OpenClaw",
        tagline: "Päivittäiset koosteet",
        summary: "OpenClaw asentaa WilmAI:n itse. Yksi viesti ottaa sen käyttöön, toinen aloittaa päivittäisen koulukoosteen.",
        steps: [
          { title: "Lähetä tämä OpenClaw'lle", action: { kind: "message", text: openclawMessage.fi } },
          {
            title: "Aloita päivittäinen kooste",
            body: "Lähetä sitten tämä. OpenClaw kysyy, mitä kalenteria käytetään, ja sen jälkeen saat koosteen joka kouluaamu.",
            action: { kind: "message", text: triageMessage.fi }
          },
          {
            title: "Kerro, mikä on tärkeää",
            body: "Vastaa koosteeseen, mitä jättää pois tai mainita aina. Se muistaa sen."
          }
        ],
        notes: ["Taidot ClawHubissa: https://clawhub.ai/aikarjal/skills/wilma ja https://clawhub.ai/aikarjal/skills/wilma-triage"],
        others: [
          {
            title: "Terminaali tuntuu omimmalta?",
            body: "Aja nämä itse:",
            action: { kind: "command", text: "npm install -g @wilm-ai/wilma-cli\nwilma login\nclawhub install wilma" }
          }
        ]
      }
    }
  },
  {
    id: "claude-code",
    logo: "/logos/claude-code.svg",
    terminal: true,
    guide: {
      en: {
        name: "Claude Code",
        tagline: "One command",
        summary: "Add WilmAI to Claude Code with one command. It then works in every project.",
        steps: [
          {
            title: "Run this in a terminal",
            body: "Needs Node.js 20 or newer.",
            action: { kind: "command", text: CLAUDE_CODE_COMMAND }
          },
          { title: "Ask Claude about school", body: firstAsk.en }
        ]
      },
      fi: {
        name: "Claude Code",
        tagline: "Yksi komento",
        summary: "Lisää WilmAI Claude Codeen yhdellä komennolla. Se toimii sen jälkeen kaikissa projekteissa.",
        steps: [
          {
            title: "Aja tämä terminaalissa",
            body: "Vaatii Node.js:n version 20 tai uudemman.",
            action: { kind: "command", text: CLAUDE_CODE_COMMAND }
          },
          { title: "Kysy Claudelta koulusta", body: firstAsk.fi }
        ]
      }
    }
  },
  {
    id: "codex",
    logo: "/logos/codex.svg",
    terminal: true,
    guide: {
      en: {
        name: "Codex",
        tagline: "Two commands",
        summary: "Add the WilmAI plugin to Codex: the Wilma tools plus the wilma and wilma-triage skills.",
        steps: [
          {
            title: "Run these in a terminal",
            body: "Needs Node.js 20 or newer.",
            action: { kind: "command", text: CODEX_COMMANDS }
          },
          { title: "Ask Codex about school", body: firstAsk.en }
        ]
      },
      fi: {
        name: "Codex",
        tagline: "Kaksi komentoa",
        summary: "Lisää WilmAI-lisäosa Codexiin: Wilma-työkalut sekä wilma- ja wilma-triage-taidot.",
        steps: [
          {
            title: "Aja nämä terminaalissa",
            body: "Vaatii Node.js:n version 20 tai uudemman.",
            action: { kind: "command", text: CODEX_COMMANDS }
          },
          { title: "Kysy Codexilta koulusta", body: firstAsk.fi }
        ]
      }
    }
  },
  {
    id: "cli",
    logo: "/logos/terminal.svg",
    terminal: true,
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
