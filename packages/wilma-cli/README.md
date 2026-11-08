# @wilm-ai/wilma-cli

Command line interface for Wilma (Finnish school system), built for parents and AI agents. Students can use it with their own Wilma login too.

## Install
Needs Node.js 20.18.1 or newer.
```bash
npm i -g @wilm-ai/wilma-cli
# or
pnpm add -g @wilm-ai/wilma-cli
```

## Log in
```bash
wilma login
```
Opens a one-time login page in your browser: pick your school's Wilma and log in. The login is saved to `~/.config/wilmai/config.json` (the password can go to the keychain instead: see Config).

Without a browser: `wilma login --tenant <url|city> --username <name>` with the password in `WILMA_PASSWORD` or piped via `--password-stdin`. Or set `WILMA_TENANT`, `WILMA_USERNAME`, `WILMA_PASSWORD` (and `WILMA_TOTP_SECRET`) and skip the saved login.

## Log out
```bash
wilma logout                  # every saved login; `wilma logout 2` for one (numbers from `wilma accounts`)
```
Wilma allows one session per account: when WilmAI logs in, Wilma logs you out in your browser, and the other way round. `wilma logout` ends WilmAI's session, as Wilma's own Log out does, so you can use Wilma in the browser. The logins stay saved, and the next command logs in again. `wilma config clear` deletes the logins as well.

## Use it
```bash
wilma summary                 # the daily briefing for every child — start here
wilma schedule tomorrow       # today | tomorrow | week | next-week | 2026-10-07 | thu
wilma exams                   # upcoming exams, with topics and start times
wilma homework
wilma notes --days 7          # lesson notes: absences and teachers' feedback
wilma notes summary           # those counted by kind for the school year
wilma messages                # newest first; [new] and reply counts
wilma messages 27164611       # one message with its whole thread
wilma news                    # dated bulletins plus pinned ones; --older for the rest
wilma news 73291              # one bulletin with its links
wilma news 73291 download 1   # a file linked from it
wilma grades                  # recent exam grades
wilma gradebook               # course and report-card grades
wilma printouts               # PDFs such as report cards; `wilma printouts <id>` saves one
wilma students
wilma help <command>          # usage, examples and the JSON shape
```

- **Every child by default.** `--student <number|name>` narrows to one (a number, the full name, or the start of a first or last name — never a loose match).
- **JSON for programs, text for people.** Output is JSON when another program reads it (agents, pipes) and text in a terminal; `--json` or `--text` forces either. The JSON is the same as the MCP tools' — `{ students: [{ student, … }] }` — compact, with times in Finnish time and their offset (`2026-10-02T13:37:00+03:00`).
- **Dates** are `YYYY-MM-DD`, `today`, `yesterday` or `tomorrow`.
- **One login, not one per command.** Commands continue the last Wilma session (saved next to the login, readable only by you) and log in again only when Wilma has ended it. Each login would otherwise log you out of Wilma in your browser and, with two-step verification, need a new code. `WILMAI_NO_SESSION_CACHE=1` turns this off.
- **For daily runs:** `wilma summary --since yesterday` returns only what is new: bulletins, messages, homework and lesson notes from that day on, plus anything unread.
- **Errors** are JSON too: `{ "status": "error", "code": "unknown_student", "message": "…" }`, with exit code 2 for usage errors, 3 when not logged in, and 1 otherwise. Codes include `invalid_argument`, `unknown_command`, `not_logged_in`, `unknown_student`, `ambiguous_student`, `not_found`, `login_failed`, `mfa_required`, `network` and `wilma_error`.

The 1.x spellings still work: `kids list`, `tenants`, `attendance list`, `<command> list`, `messages read <id>`, `news read <id>`, `news resource download <id> <resource>`, `printouts download <id>` and `--all-students`.

Running `wilma` without arguments in a terminal opens an interactive menu.

## Use with AI assistants (MCP)
```bash
wilma mcp
```
Starts a stdio MCP server with read-only Wilma tools (`wilma_summary`, `wilma_schedule`, `wilma_read_news`, …) that return the same data as the commands, plus `wilma_logout`, which ends WilmAI's Wilma session like `wilma logout`. Add it to any MCP client as `npx -y @wilm-ai/wilma-cli@2 mcp`. Setup guides for Claude, ChatGPT, Grok Bot and OpenClaw: https://wilm.ai

## Bulletin attachments
`wilma news <id>` lists every link in a bulletin (`resources`). Any resource can be downloaded with `wilma news <id> download <resource> [--output <directory>]` (the resource id also accepts a bare number, e.g. `1` for `resource-1`). Wilma-hosted files download through the session; external links are fetched without your Wilma login, and only from public websites. The result's `status` says what happened: `downloaded` (use the returned `path`) or `not_a_file` when the link answered with a web page (for example a sharing link that needs signing in — open it in a browser instead). `--output` defaults to the current directory; existing files are never overwritten.

## Several Wilmas
Children at schools on different Wilmas need one login per Wilma. Run `wilma login` again (or press "Add another school's Wilma" on the login page); commands then cover every child, and each child carries the `wilma` it belongs to.
```bash
wilma accounts                     # saved logins, numbered
wilma accounts remove <number>     # or the Wilma name or username; also ends that login's Wilma session
```

## Find your Wilma
```bash
wilma find-school <city or school>
```

## Other
```bash
wilma update                       # when a newer version is out, a command says so on stderr, at most once a day (WILMAI_NO_UPDATE_CHECK=1 turns it off)
wilma config secrets               # where saved passwords are kept; `wilma config secrets auto` moves them to the keychain
wilma config clear                 # deletes every saved login and session
wilma home                         # where to download WilmAI Home, the Wilma app for Mac and Windows
wilma --version
```

## MFA (Multi-Factor Authentication)

If your Wilma account has MFA/TOTP enabled:

**Recommended:** run `wilma login`. When Wilma asks for a code, the login page asks for your authenticator's setup key (base32 or `otpauth://` URI) and saves it with the login, so later logins make their own codes. In the interactive menu (`wilma`), choose "Save TOTP secret for automatic login".

**Without a saved login:** set `WILMA_TOTP_SECRET` along with the other `WILMA_*` variables. `--totp-secret <key>` also works, but a key on the command line ends up in shell history and is visible to other programs on the computer.

## Config
Logins are saved in `~/.config/wilmai/config.json` (or `$XDG_CONFIG_HOME/wilmai/config.json`; override with `WILMAI_CONFIG_PATH`) and the current Wilma sessions in `wilmai-sessions.json` next to it, both readable only by you. `wilma logout` ends the sessions and deletes them, keeping the logins; `wilma config clear` deletes both.

### Passwords in the keychain (optional)
By default the password and authenticator key are in that file too, scrambled (not encrypted), like aws, npm or kubectl keep theirs. To keep them in the operating system's keychain instead:

```bash
wilma config secrets auto       # the keychain where there is one, the file where there isn't
wilma config secrets keychain   # the keychain only; saving fails where there is none
wilma config secrets file       # back to the file
wilma config secrets            # where each login's password is now
```

The file stays the default, and stays available: on a server or anything unattended (cron, CI, an agent such as OpenClaw) there's no logged-in user to unlock a keychain, so keep the file there. On headless Linux `auto` keeps the file by itself, but **on a Mac `auto` always picks the Keychain**, so on a Mac used as a server (say, a Mac mini running an agent) don't turn it on: after a restart before anyone has logged in, or over SSH, the Keychain can be locked, and the next new Wilma login fails with `secret_refused` until someone unlocks it. If that happens: unlock it (sign in at the Mac), then `wilma config secrets file` moves the logins back. While it's still locked that command can't read the password out, but new logins then go to the file, so `wilma login` once saves the login there. Changing the setting moves the saved logins without logging in again. The keychain is the macOS Keychain (through `/usr/bin/security`, so no prompts after a Node.js upgrade), Windows Credential Manager, or a Linux desktop's Secret Service (headless Linux has none: `auto` keeps the file there). `WILMAI_SECRET_STORE=file|auto|keychain` decides where new logins go for one process, for tools that run the CLI; it never moves saved logins.

What stays in files: the rest of the login (Wilma, username, children) and the current Wilma sessions, which give the same access as the password while they last (Wilma ends them after a few hours). The keychain keeps the password out of backups, synced dotfiles and anything that reads files; it doesn't protect against a program running as you, which can ask the keychain too. On Windows, saved credentials roam with a roaming profile. Older copies of the config (backups, synced dotfiles) still hold the password; changing the Wilma password makes them useless. A keychain entry left behind by a config deleted by hand is named `ai.wilm.wilma-cli` in Keychain Access or Credential Manager.

Errors: `secret_missing` (the entry is gone: `wilma login`), `secret_refused` (the keychain is locked or said no), `secret_unavailable` (no keychain this copy can use), all with exit code 4. The Linux binaries of the optional `@napi-rs/keyring` dependency statically link libdbus (`AFL-2.1 OR GPL-2.0-or-later`).

## Troubleshooting: TLS errors on a managed laptop

A TLS certificate error means the network is intercepting TLS and re-signing with a
private root CA (common behind a corporate secure web gateway). Node ignores the OS
trust store, so `curl` and your browser keep working while every Wilma request fails.
A successful `npm install` is not evidence that TLS is healthy — the npm registry is
commonly exempt from inspection.

```bash
NODE_USE_SYSTEM_CA=1 wilma summary                        # Node >=22.19 / >=24.6
node --use-system-ca "$(command -v wilma)" summary        # Node >=22.15
NODE_EXTRA_CA_CERTS=/path/to/root-ca.pem wilma summary    # explicit root
```

Never use `NODE_TLS_REJECT_UNAUTHORIZED=0` — it turns verification off entirely.

In JSON, transport failures have the code `network`, with the underlying `cause` and a
`hint`, so agents can branch on it:

```json
{
  "status": "error",
  "code": "network",
  "message": "TLS certificate verification failed for https://example.inschool.fi (UNABLE_TO_GET_ISSUER_CERT_LOCALLY)",
  "cause": "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "hint": "..."
}
```

## Notes
- Credentials and TOTP secrets are stored with lightweight obfuscation (not encryption) in a file only your user can read, or in the OS keychain with `wilma config secrets auto` (see Config).
- Bulletin links are fetched only from public websites (never local or private network addresses), without your Wilma login.
- Commands cover every child; `--student <number|name>` narrows to one.
