<p align="center">
  <img src="assets/wilmai_mascot.png" alt="wilmai mascot" width="200">
</p>

# wilmai

[![npm downloads](https://img.shields.io/npm/dt/%40wilm-ai%2Fwilma-cli?label=downloads&color=2e9e93)](https://www.npmjs.com/package/@wilm-ai/wilma-cli)
[![npm version](https://img.shields.io/npm/v/%40wilm-ai%2Fwilma-cli?label=wilma-cli&color=1b2b34)](https://www.npmjs.com/package/@wilm-ai/wilma-cli)
[![license](https://img.shields.io/badge/license-MIT-ffd84d)](LICENSE)

**WilmAI** ([wilm.ai](https://wilm.ai)) connects Finland's Wilma school system to the AI assistant you already use — Claude, ChatGPT, Grok Bot, OpenClaw — so you can ask about schedules, homework, exams, grades, lesson notes, messages and news in plain words. It also works on its own as a command-line tool.

> **Disclaimer:** This is an independent open-source project by a parent, not affiliated with, endorsed by, or connected to Visma or the official Wilma service.

## Add WilmAI to your assistant

Step-by-step guides in English and Finnish: **[wilm.ai](https://wilm.ai/en#quickstart)**.

| Assistant | How | Guide |
|---|---|---|
| **Claude Desktop** (Mac, Windows) | Download [`wilmai.mcpb`](https://wilm.ai/get/claude) and open it | [wilm.ai#claude](https://wilm.ai/en#claude) |
| **Claude Code** | `claude mcp add --scope user wilma -- npx -y @wilm-ai/wilma-cli@2 mcp` | [wilm.ai#claude](https://wilm.ai/en#claude) |
| **ChatGPT desktop app** | In Work mode (not Chat), send ChatGPT one message and it installs the plugin; or add the MCP server `npx -y @wilm-ai/wilma-cli@2 mcp` yourself | [wilm.ai#chatgpt](https://wilm.ai/en#chatgpt) |
| **Codex** | `codex plugin marketplace add aikarjal/wilmai` then `codex plugin add wilma@wilmai` | [wilm.ai#chatgpt](https://wilm.ai/en#chatgpt) |
| **Grok Bot** | Send one message; the bot installs the CLI and skill itself | [wilm.ai#grok](https://wilm.ai/en#grok) |
| **OpenClaw** | `clawhub install wilma` ([ClawHub](https://clawhub.ai/aikarjal/wilma)) | [wilm.ai#openclaw](https://wilm.ai/en#openclaw) |
| **Terminal** | `npm i -g @wilm-ai/wilma-cli`, then `wilma login` | [wilm.ai#cli](https://wilm.ai/en#cli) |

The first time you ask about school, a login page opens in your browser: pick your school's Wilma and log in. The login is saved on your computer.

Not supported: Claude and ChatGPT on the web and phone. Your login stays on your own devices and WilmAI runs no server in between; for updates on the phone, use an always-on assistant such as OpenClaw. Not yet available in Finland: Meta Muse, OpenAI dots on consumer plans, Instinct.

## What's inside

- `packages/wilma-client` – TypeScript Wilma client (auth + parsing + tenant list)
- `packages/wilma-cli` – CLI (`wilma`), browser login (`wilma login`), and MCP server (`wilma mcp`)
- `skills/` – Agent skills (`wilma`, `wilma-triage`); also the plugin root for Claude Code and Codex
- `apps/site` – wilm.ai (Next.js, built as static files and served by Cloudflare Workers)

## Logging in

```bash
wilma login
```

Opens a one-time page on `127.0.0.1` in your browser. Pick your school's Wilma, log in, and the verified login is saved to `~/.config/wilmai/config.json` (or `$XDG_CONFIG_HOME/wilmai/config.json`; override with `WILMAI_CONFIG_PATH`). The password is entered on that page — never in an agent's chat.

Children on different Wilmas (say, a city school and a private school or lukio)? Press **Add another Wilma** on the same page, or run `wilma login` again. Every saved login is used together: every command covers all your children. `wilma accounts` lists the saved logins and `wilma accounts remove <number>` removes one.

Without a browser (scripts, agents on cloud computers), first find the Wilma address:

```bash
wilma find-school <city or school>
```

then:

```bash
WILMA_PASSWORD=... wilma login --tenant <city> --username you@example.com
printf '%s' "$PASSWORD" | wilma login --tenant https://<school>.inschool.fi --username you@example.com --password-stdin
```

Or skip the saved login entirely by setting environment variables, e.g. in an agent's secret settings:

| Variable | Value |
|---|---|
| `WILMA_TENANT` | Wilma address (`https://<school>.inschool.fi`) or city/school name |
| `WILMA_USERNAME` | Wilma username |
| `WILMA_PASSWORD` | Wilma password |
| `WILMA_TOTP_SECRET` | Authenticator setup key, if the account uses two-step verification |

Running `wilma` without arguments still opens the interactive menu.

## MCP server

```bash
wilma mcp
```

A stdio MCP server with read-only tools: `wilma_summary`, `wilma_schedule`, `wilma_homework`, `wilma_upcoming_exams`, `wilma_grades`, `wilma_gradebook`, `wilma_lesson_notes`, `wilma_lesson_notes_summary`, `wilma_list_messages`, `wilma_read_message`, `wilma_list_news`, `wilma_read_news`, `wilma_get_news_attachment`, `wilma_list_printouts`, `wilma_get_printout`, `wilma_account`, `wilma_find_school`, `wilma_login`. Every tool covers all children unless `student` is given, and the JSON is the same as the CLI's. If nobody is logged in, tools open the browser login and tell the assistant what to relay.

Any MCP client can run it with `npx -y @wilm-ai/wilma-cli@2 mcp`. For Claude Code: `claude mcp add --scope user wilma -- npx -y @wilm-ai/wilma-cli@2 mcp` (`--scope user` makes it available in every project).

Build the Claude Desktop extension locally with `pnpm --filter @wilm-ai/wilma-cli build:mcpb` (output: `packages/wilma-cli/build/wilmai.mcpb`). The release workflow attaches it to each GitHub release.

## CLI

```bash
npm i -g @wilm-ai/wilma-cli

wilma summary                 # daily briefing for every child
wilma schedule tomorrow
wilma exams
wilma notes --days 7          # absences and teachers' feedback
wilma messages 27164611       # one message with its replies
wilma news 73291 download 1   # a file linked from a bulletin
wilma help <command>
```

Every command covers all children (`--student` narrows), prints JSON when another program reads it and text in a terminal, and gives times in Finnish time. Commands continue the last Wilma session instead of logging in each time. See the [CLI README](packages/wilma-cli/README.md).

News JSON includes structured `resources` for every link in a bulletin. Any resource can be downloaded with `wilma news <news-id> download <resource-id> --output <directory>`. Wilma-hosted files download through the authenticated session; external URLs are fetched with an isolated, unauthenticated request that never carries Wilma credentials. The CLI does not guess whether a URL is a file — it attempts the download and reports `downloaded` or `not_a_file` (a web page answered, e.g. a sign-in wall).

### Skills

```bash
npx skills add aikarjal/wilmai
```

### From source

```bash
pnpm install
pnpm --filter @wilm-ai/wilma-cli build
node packages/wilma-cli/dist/index.js
```

## Troubleshooting

### `fetch failed` on a managed or corporate laptop

If any command fails with a TLS certificate error, your network is very likely
intercepting TLS ("break-and-inspect") and re-signing certificates with a private
root CA — standard on devices behind a corporate secure web gateway. Node ships its
own CA bundle and ignores the operating system trust store, so a root your browser
already trusts is invisible to Node.

The CLI reports the underlying cause code (for example
`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`) and the fix. In order of preference:

```bash
# 1. Node >=22.19 / >=24.6
NODE_USE_SYSTEM_CA=1 wilma summary

# 2. Node >=22.15 (the flag has wider version support than the env var)
node --use-system-ca "$(command -v wilma)" summary

# 3. Point Node at the proxy root explicitly
NODE_EXTRA_CA_CERTS=/path/to/root-ca.pem wilma summary
```

Never set `NODE_TLS_REJECT_UNAUTHORIZED=0`. It disables certificate verification
entirely, on a network that is already inspecting your traffic.

Two things that make this hard to recognise:

- **A working `npm install` proves nothing.** Inspection policies commonly exempt
  `registry.npmjs.org`, so installing the CLI succeeds while every Wilma request
  fails.
- **`curl` and your browser work fine**, because they use the OS trust store. Only
  Node is affected, which makes the network look healthy.

## Credentials & Privacy

Your Wilma login is stored locally in `~/.config/wilmai/config.json` (or `$XDG_CONFIG_HOME/wilmai/config.json`), readable only by your user account. The password is obfuscated (not encrypted) for convenience — this is a personal productivity tool, not a vault. The current Wilma session is kept next to it (`wilmai-sessions.json`, same protection, at most 6 hours) so commands don't log in each time; set `WILMAI_NO_SESSION_CACHE=1` to turn that off. `wilma config clear` removes both.

The CLI, the MCP server and the Claude Desktop extension have no server behind them: they log in only to your school's Wilma. Besides Wilma, they open links from school bulletins when you ask for an attachment (only public websites, never with your Wilma login), and the CLI checks npm once a day for a newer version when you use it in a terminal. When an AI assistant uses WilmAI, the school information it reads goes to that assistant's provider, the same as pasting it into a chat; your password does not.

**Do not share your config file.** It accesses the same data as the official Wilma app or website; it is your responsibility to handle that data appropriately.

## License
MIT
