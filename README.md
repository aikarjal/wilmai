<p align="center">
  <img src="assets/wilmai_mascot.png" alt="WilmAI mascot" width="160">
</p>

<h1 align="center">WilmAI</h1>

<p align="center">
  <strong>Wilma access for your AI assistant or agent.</strong><br>
  Ask Claude, ChatGPT, OpenClaw, Grok Bot or Codex about school in plain words, or let your agent post one briefing for the whole family every morning.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@wilm-ai/wilma-cli"><img alt="npm downloads" src="https://img.shields.io/endpoint?url=https%3A%2F%2Fwilm.ai%2Fapi%2Fbadge%2Fdownloads"></a>
  <a href="https://github.com/aikarjal/wilmai/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/aikarjal/wilmai?label=stars&color=17545b&style=flat"></a>
  <a href="https://www.npmjs.com/package/@wilm-ai/wilma-cli"><img alt="npm version" src="https://img.shields.io/npm/v/%40wilm-ai%2Fwilma-cli?label=wilma-cli&color=1b2b34"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-ffd84d"></a>
</p>

<p align="center">
  <a href="https://wilm.ai/en">wilm.ai</a> · <a href="https://wilm.ai/fi">suomeksi</a> · <a href="#add-wilmai-to-your-assistant">Set up</a> · <a href="CHANGELOG.md">Changelog</a>
</p>

> **You:** What do the kids have at school tomorrow?
>
> **Your assistant:** Kiia has crafts 8:30–11:00, then geography and math; her English exam is on Thursday (units 7–9). Eino starts at 9:15 with swimming at the pool hall, so pack a swimsuit and towel. There's also a new message from the class teacher about Friday's trip: the permission form is due Wednesday.

WilmAI connects Wilma, the system Finnish schools use for schedules, homework, exams, grades and messages, to the AI assistant or agent you already use. It's an MCP server, a command-line tool and two agent skills, free and open source.

> **Disclaimer:** This is an independent open-source project by a parent, not affiliated with, endorsed by, or connected to Visma or the official Wilma service.

## What you get

- **18 read-only MCP tools.** Summary, schedule, homework, exams, grades and the gradebook, lesson notes and absences, messages with replies, news with attachments, printouts. One call covers every child, across every Wilma the family uses.
- **A CLI for people and agents.** Text in a terminal, JSON when a program reads it: the same JSON as the MCP tools. `wilma summary --since yesterday` returns only what's new, for daily runs.
- **It all runs on your computer.** No WilmAI server, no account, no telemetry. It logs in only to your school's Wilma and can't send messages or change anything there. The password goes into a local login page, never into a chat.
- **Agent skills.** `wilma` teaches an agent the tools and commands; `wilma-triage` turns them into a morning briefing that flags what needs doing and puts exams in the family calendar.
- **Any school on Wilma.** The login page finds your school's Wilma by city or school name. Two-step verification and families with several Wilmas work.

## Try it in one line

```bash
# Claude Code
claude mcp add --scope user wilma -- npx -y @wilm-ai/wilma-cli@2 mcp

# Codex
codex plugin marketplace add aikarjal/wilmai && codex plugin add wilma@wilmai

# Any MCP client
npx -y @wilm-ai/wilma-cli@2 mcp

# Just the terminal (Node.js 20.18 or newer)
npm i -g @wilm-ai/wilma-cli && wilma login && wilma summary
```

Then ask about school. The first time, a login page opens in your browser: pick your school's Wilma and log in. The login is saved on your computer.

## Add WilmAI to your assistant

Step-by-step guides for parents, in English and Finnish: **[wilm.ai](https://wilm.ai/en#quickstart)**.

| Assistant | How | Guide |
|---|---|---|
| **Claude Desktop** (Mac, Windows) | Download [`wilmai.mcpb`](https://wilm.ai/get/claude) and open it; Claude asks whether to install it | [wilm.ai#claude](https://wilm.ai/en#claude) |
| **ChatGPT desktop app** (Mac, Windows) | In Work mode (not Chat), send ChatGPT one message and it installs the plugin itself; or add the MCP server `npx -y @wilm-ai/wilma-cli@2 mcp` yourself | [wilm.ai#chatgpt](https://wilm.ai/en#chatgpt) |
| **Grok Bot** | Send one message; the bot installs the CLI and skill itself | [wilm.ai#grok](https://wilm.ai/en#grok) |
| **OpenClaw** | Send one message and OpenClaw installs the CLI and the [`wilma`](https://clawhub.ai/aikarjal/skills/wilma) skill; a second one starts a daily briefing with [`wilma-triage`](https://clawhub.ai/aikarjal/skills/wilma-triage) | [wilm.ai#openclaw](https://wilm.ai/en#openclaw) |
| **Claude Code** | `claude mcp add --scope user wilma -- npx -y @wilm-ai/wilma-cli@2 mcp` | [wilm.ai#claude-code](https://wilm.ai/en#claude-code) |
| **Codex** | `codex plugin marketplace add aikarjal/wilmai`, then `codex plugin add wilma@wilmai` | [wilm.ai#codex](https://wilm.ai/en#codex) |
| **Terminal** | `npm i -g @wilm-ai/wilma-cli`, then `wilma login` | [wilm.ai#cli](https://wilm.ai/en#cli) |

Not supported: Claude and ChatGPT on the web and in the phone apps. Your login stays on your own devices and WilmAI runs no server in between; for updates on your phone, use an agent with its own computer, such as OpenClaw or Grok Bot. Not yet available in Finland: Meta Muse, Instinct, and OpenAI dots on consumer plans.

## What you can ask

In your own words; every question covers all your children.

- "What do my kids have going on at school this week?"
- "Is there any homework for tomorrow?"
- "Are there any exams coming up? What should she study?"
- "Has any teacher left a note about Eino this month?"
- "Any new messages from school? Read the attached letter too."
- "How did the last exams go? What was on the spring report card?"

Or give an agent a routine: "Every weekday at 7, post a school briefing for both kids to the family channel, and put new exams in the family calendar." The `wilma-triage` skill does exactly that.

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

Running `wilma` without arguments in a terminal opens an interactive menu.

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

Working on WilmAI or releasing it: [DEVELOPING.md](DEVELOPING.md). Tests: [TESTING.md](TESTING.md).

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

The CLI, the MCP server and the Claude Desktop extension have no server behind them: they log in only to your school's Wilma. Besides Wilma, they open links from school bulletins when you ask for an attachment (only public websites, never with your Wilma login), and once a day they ask npm whether a newer version is out (not when started through `npx`, which fetches the newest version itself; `WILMAI_NO_UPDATE_CHECK=1` turns it off). When an AI assistant uses WilmAI, the school information it reads goes to that assistant's provider, the same as pasting it into a chat; your password does not.

**Do not share your config file.** It accesses the same data as the official Wilma app or website; it is your responsibility to handle that data appropriately.

## License

MIT. Questions, bugs and ideas: [GitHub issues](https://github.com/aikarjal/wilmai/issues). If WilmAI is useful to you, a star helps other parents find it.
