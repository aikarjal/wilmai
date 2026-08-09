---
name: wilma
description: Access Finland's Wilma school system from AI agents. Fetch schedules, homework, exams, grades, attendance/lesson notes (merkinnät), messages, news, and linked news resources via the wilma CLI. Start with `wilma summary --json`, drill into news with `news read --json`, and use explicit resource actions for Wilma attachments or external document links.
metadata:
  {
    "openclaw":
      {
        "requires":
          {
            "bins": ["wilma"],
            "configPaths": ["~/.config/wilmai/config.json"],
          },
        "install":
          [
            {
              "id": "node",
              "kind": "node",
              "package": "@wilm-ai/wilma-cli",
              "bins": ["wilma"],
              "label": "Install Wilma CLI (npm)",
            },
          ],
        "credentials":
          {
            "note": "Requires a local Wilma config file (~/.config/wilmai/config.json or $XDG_CONFIG_HOME/wilmai/config.json) created by running the CLI interactively once. This stores Wilma session credentials for accessing student data.",
          },
      },
  }
---

# Wilma Skill

## Overview

Wilma is the Finnish school information system used by schools and municipalities to share messages, news, exams, schedules, homework, and other student-related updates with parents/guardians.

Use the `wilma` / `wilmai` CLI in non-interactive mode to retrieve Wilma data for AI agents. Prefer `--json` outputs and avoid interactive prompts.

## Quick start

### Install
```bash
npm i -g @wilm-ai/wilma-cli
```

1. Ensure the user has run the interactive CLI once to create `~/.config/wilmai/config.json`.
2. Use non-interactive commands with `--json`.

## Core tasks

### Daily briefing (start here)
```bash
wilma summary --student <id|name> --json
wilma summary --all-students --json
```
Returns today's and tomorrow's schedule, upcoming exams, recent homework, recent news, and recent messages in one call. This is the best starting point for any parent-facing summary.

### Schedule
```bash
wilma schedule list --when today --student <id|name> --json
wilma schedule list --when tomorrow --student <id|name> --json
wilma schedule list --when week --student <id|name> --json
wilma schedule list --date 2026-03-10 --student <id|name> --json
wilma schedule list --weekday thu --student <id|name> --json
```
`--weekday` also accepts Finnish short forms: `ma`, `ti`, `ke`, `to`, `pe`, `la`, `su`. Use `--date` or `--weekday`, not both.

### Homework
```bash
wilma homework list --student <id|name> --json
```

### Upcoming exams
```bash
wilma exams list --student <id|name> --json
```

### Exam grades
```bash
wilma grades list --student <id|name> --json
```

### Attendance / lesson notes (merkinnät)
```bash
wilma attendance list --student <id|name> --json
wilma attendance list --date 2026-03-10 --student <id|name> --json
wilma attendance list --all-students --json
```
Returns Wilma's per-lesson notes ("merkinnät") for a single day: positive feedback, behavioral remarks, missing materials, and absence categorizations (medical, explained, unexplained). Defaults to today if `--date` is omitted; teachers usually fill notes during or after class, so for a morning agent run prefer `--date <yesterday>`.

Each note has `start`/`end` times derived from Wilma's hour-grid headers — accurate to the lesson hour, with 45-minute period assumed. `subject` is the Wilma course code (e.g. `MA_8LV` = math, 8th grade), and `typeLabel` is the human-readable Finnish reason or remark.

### List students
```bash
wilma kids list --json
```

### News and messages
```bash
wilma news list --student <id|name> --json
wilma news read <id> --student <id|name> --json
wilma messages list --student <id|name> --folder inbox --json
wilma messages read <id> --student <id|name> --json
```

#### News resources and attachments

Always inspect the `resources` array returned by `wilma news read <id> --json`. Treat each resource according to `kind`, `authContext`, and `availableActions`:

- For `wilma_attachment` with `download` in `availableActions`, download only when the document is relevant to the user's request:
  ```bash
  wilma news resource download <news-id> <resource-id> --student <id|name> --output <directory> --json
  ```
  Use the returned absolute `path` to inspect or summarize the file. Keep downloads in a task-scoped directory and do not overwrite existing files.
- For `external_attachment` with `download` in `availableActions`, use the same CLI download command. Recognized SharePoint sharing links are fetched directly by the CLI with an isolated temporary cookie jar; do not open a browser first.
- For `external_link`, use the passed-through `url`. Do not call the download command or fetch the URL automatically. If access is necessary, open it in a user-authorized browser session that has the external service's authentication.
- If an external attachment download returns `external_access_required`, report that direct access failed and only then use `availableActions` to choose an authenticated-browser fallback.
- Never infer that an external link is a PDF solely from its bulletin label. Use returned content metadata after a successful download.

Prefer resource metadata over URLs embedded in `content`; `content` is prose and can be null for link-only bulletins.

### Fetch data for all students
All list commands support `--all-students`:
```bash
wilma summary --all-students --json
wilma homework list --all-students --json
wilma exams list --all-students --json
```

You can also pass a name fragment for `--student` (fuzzy match).

## MFA (Multi-Factor Authentication)
If the Wilma account has MFA/TOTP enabled:

**Interactive setup (recommended):** Run `wilma` interactively. When MFA is detected, choose "Save TOTP secret for automatic login" and paste your TOTP secret or `otpauth://` URI. Future logins will auto-authenticate.

**Non-interactive (one-off):** Pass the TOTP secret directly:
```bash
wilma schedule list --totp-secret <base32-key> --student "Stella" --json
wilma schedule list --totp-secret 'otpauth://totp/...' --student "Stella" --json
```
If the TOTP secret has been saved via interactive setup, `--totp-secret` is not needed — the CLI auto-authenticates from the stored config.

## Notes
- If no `--student` is provided, the CLI uses the last selected student from `~/.config/wilmai/config.json` (or `$XDG_CONFIG_HOME/wilmai/config.json`).
- If multiple students exist and no default is set, the CLI will print a helpful error with the list of students.
- When the account has multiple students, `--student` is **required** for read commands.
- If auth expires or the CLI says no saved profile, re-run `wilma` interactively or use `wilma config clear` to reset.
- Run `wilma update` to update the CLI to the latest version.

## Actionability guidance (for parents)

Wilma contains a mix of urgent items and general info. When summarizing for parents, prioritize **actionable** items:

**Include** items that:
- Require action or preparation (forms, replies, permissions, materials to bring).
- Announce a deadline or time-specific requirement.
- Describe a schedule deviation or noteworthy event (trips, themed days, school closures, exams).
- Mention homework, exams, or upcoming deadlines.

**De-prioritize** items that:
- Are purely informational with no action, deadline, or schedule impact.
- Are generic announcements unrelated to the target period.

When in doubt, **include** and let the parent decide. Prefer a short, structured summary with dates and IDs.

## Scripts

Use `scripts/wilma-cli.sh` for a stable wrapper around the CLI.

## Links
- **GitHub:** https://github.com/aikarjal/wilmai
- **Website:** https://wilm.ai
