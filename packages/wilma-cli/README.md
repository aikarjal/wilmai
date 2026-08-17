# @wilm-ai/wilma-cli

Command line interface for Wilma (Finnish school system), built for parents and AI agents.

## Install
```bash
npm i -g @wilm-ai/wilma-cli
# or
pnpm add -g @wilm-ai/wilma-cli
```

## Run
```bash
wilma
# or
wilmai
```

## Commands

### Daily briefing
```bash
wilma summary [--days 7] [--student <id|name>] [--all-students] [--json]
```
Combines today's and tomorrow's schedule, upcoming exams, recent homework, news, and messages into one view. Designed for AI agents to surface what matters.

### Schedule
```bash
wilma schedule list [--when today|tomorrow|week] [--date YYYY-MM-DD] [--weekday mon|tue|wed|thu|fri|sat|sun] [--student <id|name>] [--all-students] [--json]
```

Examples:
```bash
# Specific day by date
wilma schedule list --date 2026-02-25 --student "Stella" --json

# Next Thursday (also accepts Finnish short forms like to/ke/pe)
wilma schedule list --weekday thu --student "Stella" --json

# Tomorrow
wilma schedule list --when tomorrow --student "Stella" --json
```

### Homework
```bash
wilma homework list [--limit 10] [--student <id|name>] [--all-students] [--json]
```

### Upcoming exams
```bash
wilma exams list [--limit 20] [--student <id|name>] [--all-students] [--json]
```

### Exam grades
```bash
wilma grades list [--limit 20] [--student <id|name>] [--all-students] [--json]
```

### News and messages
```bash
wilma news list [--limit 20] [--student <id|name>] [--all-students] [--json]
wilma news read <id> [--student <id|name>] [--json]
wilma news resource download <news-id> <resource-id> [--student <id|name>] [--output <directory>] [--json]
wilma messages list [--folder inbox] [--limit 20] [--student <id|name>] [--all-students] [--json]
wilma messages read <id> [--student <id|name>] [--json]
```

`news read --json` includes a `resources` array with every link in the bulletin. Any resource can be passed to the download command (the resource id also accepts a bare number, e.g. `1` for `resource-1`). Wilma-hosted files download through the authenticated session; external URLs are fetched with an isolated, unauthenticated request — no Wilma credentials are ever sent to external hosts. The result `status` reports what actually happened: `downloaded` (use the returned `path`), or `not_a_file` when the URL answered with a web page instead of a file (for example a sharing link that requires signing in — open it in a browser instead). `--output` defaults to the current directory; existing files are never overwritten.

### Attendance / lesson notes
```bash
wilma attendance list [--date YYYY-MM-DD] [--student <id|name>] [--all-students] [--json]
```

Shows lesson notes (type labels, subjects, teachers) for a given date. Defaults to today if --date is omitted.

### Other
```bash
wilma kids list [--json]
wilma update
wilma config clear
```

## MFA (Multi-Factor Authentication)

If your Wilma account has MFA/TOTP enabled:

**Interactive (recommended):** Run `wilma` and choose "Save TOTP secret for automatic login" when prompted. Paste your base32 key or `otpauth://` URI from your authenticator app. Future logins auto-authenticate.

**Non-interactive:** Pass the secret directly:
```bash
wilma schedule list --totp-secret <base32-key> --json
wilma schedule list --totp-secret 'otpauth://totp/...' --json
```

If you've saved your TOTP secret via interactive setup, `--totp-secret` is not needed.

## Config
Local config is stored in `~/.config/wilmai/config.json` (or `$XDG_CONFIG_HOME/wilmai/config.json`).
Use `wilma config clear` to remove it. Override with `WILMAI_CONFIG_PATH`.

## Troubleshooting: TLS errors on a managed laptop

A TLS certificate error means the network is intercepting TLS and re-signing with a
private root CA (common behind a corporate secure web gateway). Node ignores the OS
trust store, so `curl` and your browser keep working while every Wilma request fails.
A successful `npm install` is not evidence that TLS is healthy — the npm registry is
commonly exempt from inspection.

```bash
NODE_USE_SYSTEM_CA=1 wilma summary --json                        # Node >=22.19 / >=24.6
node --use-system-ca "$(command -v wilma)" summary --json        # Node >=22.15
NODE_EXTRA_CA_CERTS=/path/to/root-ca.pem wilma summary --json    # explicit root
```

Never use `NODE_TLS_REJECT_UNAUTHORIZED=0` — it turns verification off entirely.

With `--json`, transport failures carry a `code` and a `hint` alongside `status` and
`message`, so agents can branch on the cause:

```json
{
  "status": "error",
  "message": "TLS certificate verification failed for https://example.inschool.fi (UNABLE_TO_GET_ISSUER_CERT_LOCALLY)",
  "code": "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "hint": "..."
}
```

## Notes
- Credentials and TOTP secrets are stored with lightweight obfuscation for convenience.
- For multi-child accounts, you can pass `--student <id|name>` or `--all-students`.
- All list commands support `--json` for agent-friendly structured output.
