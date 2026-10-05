# Developing WilmAI

Notes for working on WilmAI and releasing it. Tests are in [TESTING.md](TESTING.md), the website in [apps/site/README.md](apps/site/README.md).

## The pieces

| Part | Where | Published as | Version in |
|---|---|---|---|
| Wilma client | `packages/wilma-client` | npm `@wilm-ai/wilma-client` | its `package.json` |
| CLI and MCP server | `packages/wilma-cli` | npm `@wilm-ai/wilma-cli` | its `package.json` |
| Claude Desktop extension | built from the CLI (`packages/wilma-cli/mcpb`, `scripts/build-mcpb.mjs`) | `wilmai.mcpb` on each CLI GitHub release and on the rolling `claude-desktop` release, which https://wilm.ai/get/claude points to | the CLI's `package.json` |
| Skills | `skills/wilma`, `skills/wilma-triage` | ClawHub `wilma` and `wilma-triage`; also `npx skills add aikarjal/wilmai` | `version:` in each `SKILL.md` |
| Plugin (Claude Code, Codex, ChatGPT) | `skills/` (`skills/.claude-plugin/plugin.json`; marketplace in `.claude-plugin/marketplace.json`) | this GitHub repository, as the marketplace `aikarjal/wilmai` | `plugin.json` |
| Website | `apps/site` | wilm.ai on Cloudflare Workers, deployed from `main` | none |

## Setup

```bash
pnpm install
pnpm -r build
TZ=UTC pnpm -r test
```

Node 20.18.1 or newer. `.npmrc` sets `link-workspace-packages=true` so the CLI uses the local client instead of the one on npm.

## Before you start

- `git fetch` and check npm (`npm view @wilm-ai/wilma-cli dist-tags --prefer-online`). Other people push and publish too.
- Pull requests may be based on older code. Check them against `main` and port them (crediting the author with `Co-authored-by:`) rather than merging as is.

## Things learned the hard way

- **Wilma allows one live session per account.** A new login ends the previous session and logs the parent out of Wilma in their browser. Reuse sessions (the CLI and MCP server share `wilmai-sessions.json`); never write code or tests that log in again while a session is in use.
- **CI runs in UTC; WilmAI works in Finnish time.** Dates and "today" come from `Europe/Helsinki`. A test that reads the machine's date fails in CI every evening after 21:00 UTC. Run `TZ=UTC pnpm -r test` before pushing.
- **Tests stay offline.** They use mock Wilma servers; CLIs started by tests set a temporary `WILMAI_CONFIG_PATH`, `WILMAI_NO_BROWSER=1` and `WILMAI_NO_UPDATE_CHECK=1`.
- **Never ask for the Wilma password in a chat.** Logins go through the login page (`wilma login`, `wilma_login`) or an agent's secret settings.
- **WilmAI runs only on the parent's own devices.** There is no hosted service: it was explored and dropped in October 2026 (legal risk, and some cities' Wilmas block server traffic). Don't work around Wilma's bot protection.
- **Skills stay generic:** no city or brand names, no school hostnames.
- **Website copy is in English and Finnish** (`apps/site/lib/i18n.tsx`, `apps/site/lib/agents.ts`). Keep it plain and short; the maintainer proofreads the Finnish.

## How updates reach people

| Setup | How it updates |
|---|---|
| Claude Code, the ChatGPT/Codex plugin (`npx @wilm-ai/wilma-cli@2`) | By itself: npx fetches the newest 2.x when the app starts WilmAI. If WilmAI is also installed globally, npx runs that copy instead, and it shows the notice below. |
| CLI installed with npm (terminal, OpenClaw and other agents) | At most once a day (and right away for a newly released version), a command prints `Update available … Run "wilma update"` on stderr; the `wilma` skill tells agents to run it. |
| Claude Desktop extension | The first answer after Claude Desktop starts WilmAI carries an "Update note", and Claude tells the parent to download https://wilm.ai/get/claude again. Manually installed extensions don't update themselves. |
| Skills on ClawHub | `clawhub update` |

The plugin, the skill and the site pin `@wilm-ai/wilma-cli@2`. A 3.0 needs those pins changed, and a release note on what breaks.

## Versions

- The client and the CLI have their own versions (semver). The CLI requires the client with `^x.y.z`; raise it when the CLI needs a client fix, so new installs and the extension get it.
- Raise the skill's `version:` and `plugin.json`'s `version` when the skill text changes.
- A fix to an old major (say 1.x after 2.0) is published with `npm publish --tag v1`, so `latest` stays on the current major. Otherwise `wilma update` would move people back.
- `CHANGELOG.md` gets one section per release: `## 2.1.0 (unreleased)` while preparing, dated once it's out, with a `_Releases: …_` line naming what was published.

## Releasing

Only `aikarjal` can publish to npm and ClawHub.

1. **Prepare** (one commit, "release prep: …")
   - Raise the versions and write the changelog section.
   - Check:
     ```bash
     TZ=UTC pnpm -r test
     pnpm -r lint
     pnpm --filter @wilm-ai/site build
     (cd packages/wilma-cli && npm pack --dry-run)
     pnpm --filter @wilm-ai/wilma-cli build:mcpb
     claude plugin validate ./skills
     ```
   - Smoke-test the CLI as it will be installed: `npm pack` it, `npm install -g --prefix <empty dir> <tarball>`, then run `<dir>/bin/wilma --version` and a command.
   - Push `main` and wait for CI to pass.
2. **npm**, the client before the CLI: `npm publish` in the package folder.
   - Run it in an interactive terminal. npm prints an npmjs.com link to approve the publish in the browser; from a non-interactive shell it fails with `EOTP`.
   - `npm login` first if needed (a login lasts about two hours).
   - npm says the package "is being processed" for a few minutes; check with `npm view @wilm-ai/wilma-cli dist-tags --prefer-online`.
3. **GitHub:** tag the release-prep commit (`wilma-client@x.y.z`, `wilma-cli@x.y.z`), push the tags, and create the release:
   ```bash
   gh release create wilma-cli@x.y.z --title "wilma-cli x.y.z" --notes-file notes.md --latest
   ```
   The notes start with an "**Update:** `wilma update` …" line, followed by the changelog section. The `release-mcpb` workflow then attaches `wilmai.mcpb` and updates the `claude-desktop` release. Check that https://wilm.ai/get/claude serves the new version (`unzip -p wilmai.mcpb manifest.json`).
4. **ClawHub, last** (ClawHub can't withdraw a skill's latest version):
   ```bash
   npx clawhub publish skills/wilma --slug wilma --version x.y.z --changelog "…" \
     --source-repo aikarjal/wilmai --source-commit <sha> --source-ref wilma-cli@x.y.z --source-path skills/wilma
   ```
   The same for `wilma-triage` if it changed. `npx clawhub inspect wilma` shows when the security scan has passed and the version is public.
5. **Date the changelog** ("changelog: x.y.z released YYYY-MM-DD") and push.
6. **Check** that npx gets the new version on a machine without a global install:
   ```bash
   NPM_CONFIG_PREFIX=$(mktemp -d) npx -y @wilm-ai/wilma-cli@2 --version
   ```

**Rolling back**

- npm: `npm dist-tag add @wilm-ai/wilma-cli@<previous> latest`. People who already updated keep the new version.
- Claude Desktop download: mark the GitHub release as a pre-release and rebuild the previous one: `gh workflow run release-mcpb.yml -f tag=wilma-cli@<previous>`.
- ClawHub: publish a fixed version.
