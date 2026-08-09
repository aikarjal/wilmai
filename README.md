<p align="center">
  <img src="assets/wilmai_mascot.png" alt="wilmai mascot" width="200">
</p>

# wilmai

**wilmai** (wilm.ai) is an independent, open-source CLI that reads data from Finland's Wilma school system — schedules, homework, exams, grades, attendance/lesson notes, messages, and news.

Use it **interactively as a parent** to quickly scan what matters across your kids, or wire it into **AI agents** (OpenClaw, Claude Code, etc.) as a skill so they can help you keep up with school life.

> **Disclaimer:** This is an independent open-source project by a parent, not affiliated with, endorsed by, or connected to Visma or the official Wilma service.

## Why
- Parents need a fast, reliable way to check **what matters today**.
- AI agents need a stable, scriptable interface so they can summarize, remind, and assist.
- Works across all Wilma tenants with a consistent JSON output.

## What’s inside
- `packages/wilma-client` – TypeScript Wilma client (auth + parsing + tenant list)
- `packages/wilma-cli` – Interactive CLI and non‑interactive command mode
- `apps/site` – Landing page (Vercel)

## Quick start
```bash
pnpm install
pnpm --filter @wilm-ai/wilma-cli build
node packages/wilma-cli/dist/index.js
```

### Install globally
```bash
npm i -g @wilm-ai/wilma-cli
# or
pnpm add -g @wilm-ai/wilma-cli
```

### Install as a skill (npx skills)
```bash
npx skills add aikarjal/wilmai
```

### Non‑interactive (for agents / skills)
```bash
wilma summary --all-students --json
wilma schedule list --when tomorrow --json
wilma homework list --all-students --json
wilma exams list --all-students --json
wilma grades list --all-students --json
wilma attendance list --all-students --json
wilma news read <id> --student <id|name> --json
```

News JSON includes structured `resources` for every link in a bulletin. Any resource can be downloaded with `wilma news resource download <news-id> <resource-id> --student <id|name> --output <directory> --json`. Wilma-hosted files download through the authenticated session; external URLs are fetched with an isolated, unauthenticated request that never carries Wilma credentials. The CLI does not guess whether a URL is a file — it attempts the download and reports `downloaded` or `not_a_file` (a web page answered, e.g. a sign-in wall).

Config is stored in `~/.config/wilmai/config.json` (or `$XDG_CONFIG_HOME/wilmai/config.json`). Override with `WILMAI_CONFIG_PATH`.

## Credentials & Privacy

Your Wilma credentials are stored locally in `~/.config/wilmai/config.json` (or `$XDG_CONFIG_HOME/wilmai/config.json`) after first login. The password is obfuscated (not encrypted) for convenience — this is a personal productivity tool, not a vault.

**Do not share your config file.** If you're on a shared machine, consider deleting the config after use (`rm -rf ~/.config/wilmai`).

The CLI accesses the same data as the official Wilma app or website. It is your responsibility to handle that data appropriately.

## Vision
wilmai is designed to be **open‑source**, **portable**, and **agent‑friendly**:
- CLI for humans
- JSON output for AI tools
- Skills integration for AI agents

## License
MIT
