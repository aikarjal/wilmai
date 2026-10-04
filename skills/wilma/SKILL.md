---
name: wilma
version: 1.7.0
description: Access Finland's Wilma school system from AI agents. Fetch schedules, homework, exams, grades and the gradebook, lesson notes (merkinnät) and absence summaries, messages with replies, news, printouts and linked news resources — through the WilmAI MCP tools (`wilma_*`) when connected, or the wilma CLI. Start with a summary, drill into messages and news, and fetch linked attachments.
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
            "note": "Requires a Wilma login: either the local config file (~/.config/wilmai/config.json or $XDG_CONFIG_HOME/wilmai/config.json) created by `wilma login`, or WILMA_TENANT / WILMA_USERNAME / WILMA_PASSWORD (and WILMA_TOTP_SECRET for two-step verification) set in the agent's secret settings.",
          },
      },
  }
---

# Wilma Skill

## Overview

Wilma is the Finnish school information system used by schools and municipalities to share messages, news, exams, schedules, homework, and other student-related updates with parents/guardians.

There are two ways to reach Wilma. Both return the same data.

1. **MCP tools** — if tools named `wilma_*` are available (the WilmAI connector, desktop extension or plugin), use them. No shell needed, and every tool covers all children unless you pass `student`.
2. **CLI** — otherwise use the `wilma` / `wilmai` CLI in non-interactive mode. Prefer `--json` outputs and avoid interactive prompts.

| MCP tool | CLI command |
|---|---|
| `wilma_summary` | `wilma summary --all-students --json` |
| `wilma_schedule` | `wilma schedule list --json` |
| `wilma_homework` | `wilma homework list --json` |
| `wilma_upcoming_exams` | `wilma exams list --json` |
| `wilma_grades` | `wilma grades list --json` |
| `wilma_lesson_notes` | `wilma attendance list --json` |
| `wilma_lesson_notes_summary` | `wilma attendance summary --json` |
| `wilma_gradebook` | `wilma gradebook --json` |
| `wilma_list_printouts` / `wilma_get_printout` | `wilma printouts list` / `download <id>` |
| `wilma_list_messages` / `wilma_read_message` | `wilma messages list` / `read <id>` |
| `wilma_list_news` / `wilma_read_news` | `wilma news list` / `read <id>` |
| `wilma_get_news_attachment` | `wilma news resource download` |
| `wilma_account` | `wilma kids list --json` |
| `wilma_find_school` | `wilma tenants <city> --json` |
| `wilma_login` | `wilma login` |

## Logging in

The user logs in once; the login is saved on their computer.

- **On the user's own computer:** run `wilma login` (or call `wilma_login`). It opens a page in the user's browser where they pick their school's Wilma and log in. Wait for the command to finish.
- **On a cloud computer the user can't see** (no browser they can reach):
  1. Ask which city or school their children's Wilma belongs to. Run `wilma tenants <city> --json` (or call `wilma_find_school`) and let the user pick from the results — one city often has several Wilmas (city schools, private schools, colleges).
  2. Ask the user to add `WILMA_USERNAME` and `WILMA_PASSWORD` to your secret or environment settings, plus `WILMA_TOTP_SECRET` if the account uses two-step verification, and set `WILMA_TENANT` to the Wilma address they picked. Every command then works without a saved login. Alternatively: `wilma login --tenant <url> --username <name> --password-stdin`.
- Don't run `wilma` without arguments from an agent: it opens an interactive menu that needs a person at a terminal.
- **Never ask the user to type their Wilma password into the chat.**
- **Children on different Wilmas** (e.g. a city school and a private school): the user adds each login on the login page ("Add another Wilma") or with another `wilma login`. All saved logins are used together; students then carry a `wilma` field naming their Wilma. `wilma accounts` lists the logins.

## Quick start

### Install
```bash
npm i -g @wilm-ai/wilma-cli
```

1. Ensure the user has logged in once (see "Logging in" above).
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
`--weekday` also accepts Finnish short forms: `ma`, `ti`, `ke`, `to`, `pe`, `la`, `su`. Use `--date` or `--weekday`, not both. Lessons include the teacher(s) and, when Wilma gives one, the `room`.

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

### Gradebook (course and report-card grades)
```bash
wilma gradebook --student <id|name> --json
```
The gradebook (Suoritukset) as a tree: subject → syllabus → course, each with `grade`, `credits` and completion `date`. Course codes ending in `LV` are usually school-year (report card) grades. An empty list means nothing has been graded yet.

### Attendance / lesson notes (merkinnät)
```bash
wilma attendance list --student <id|name> --json
wilma attendance list --date 2026-03-10 --student <id|name> --json
wilma attendance list --days 14 --all-students --json
wilma attendance summary --student <id|name> --json
```
Returns Wilma's per-lesson notes ("merkinnät"): positive feedback, behavioral remarks, missing books or homework, and absence categorizations (medical, explained, unexplained). One day (default today), `--days N` for the last N days, or `--from`/`--to`. Teachers usually fill notes during or after class, so for a morning agent run prefer `--date <yesterday>` or `--days 2`. When the teacher wrote something, it's in `note`.

`attendance summary` counts the notes by `typeLabel` for this school year (or `--from`/`--to`), e.g. how many lessons were missed for health reasons.

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
`news list` returns the newest dated bulletins plus every pinned one (`pinned: true`, e.g. the school-year bulletin); add `--older` for older bulletins (`archived: true`, dated once read). In message lists, `unread` marks unopened messages and `replyCount` threads with replies; `messages read` returns the thread with its `replies`.

#### Printouts
```bash
wilma printouts list --student <id|name> --json
wilma printouts download <id> --student <id|name> --output <directory> --json
```
PDF documents the school offers, such as report cards or absence reports (it varies by school).

#### News resources and attachments

Always inspect the `resources` array returned by `wilma news read <id> --json`. Each resource has:

- `id` — stable within the bulletin (`resource-1`, `resource-2`, …); the download command also accepts the bare number (`1`).
- `label` — the link text from the bulletin.
- `url` — absolute URL.
- `authContext` — `"wilma"`: a download uses the authenticated Wilma session. `"external"`: a download uses an isolated, unauthenticated fetch that never sends Wilma credentials (like opening the link in a signed-out browser).
- `fileName` — naming hint when the URL path looks like a file; may be null even for real files.

**Any resource can be attempted with the download command.** There is no reliable way to know in advance whether a URL serves a file publicly, requires sign-in, or is a plain web page — so the CLI does not guess: it attempts the download and reports what actually happened. When a document is relevant to the user's request, attempt it:

```bash
wilma news resource download <news-id> <resource-id> --student <id|name> --output <directory> --json
```

Handle the returned `status`:

- `downloaded` — the file was written. Use the returned absolute `path`, and trust `contentType`/`sizeBytes` over any guess from the bulletin label.
- `not_a_file` — every attempt answered with a web page instead of a file. This usually means the document requires signing in (for example a private cloud-drive sharing link), or the link is simply a web page. Report this to the user; if access matters, open the `url` in a user-authorized browser session that has the external service's authentication. Never retry the download in a loop.
- `error` (exit code 1) — the attempt itself failed (HTTP error, network problem, size limit). Report the `message`.

Keep downloads in a task-scoped directory via `--output` (defaults to the current working directory). Existing files are never overwritten — a numeric suffix is appended.

Prefer resource metadata over URLs embedded in `content`; `content` is prose and can be null for link-only bulletins.

With the MCP tools, `wilma_get_news_attachment` returns the file itself (text inline, images as images, other files such as PDFs as an embedded file) plus the same `not_a_file` handling. Pass `save: true` to also save a copy to the user's `Downloads/WilmAI` folder.

### Fetch data for all students
All list commands support `--all-students`:
```bash
wilma summary --all-students --json
wilma homework list --all-students --json
wilma exams list --all-students --json
```

You can also pass a name fragment for `--student` (fuzzy match).

## MFA (two-step verification)
If the Wilma account has MFA/TOTP enabled, logins need the authenticator setup key (a base32 key or `otpauth://` URI) so they can run unattended:

- **`wilma login`:** the login page asks for the setup key when Wilma requires it and saves it with the login.
- **Environment:** set `WILMA_TOTP_SECRET`.
- **One-off:** pass `--totp-secret <base32-key|otpauth://...>` to any command.

## Notes
- If no `--student` is provided, the CLI uses the last selected student from `~/.config/wilmai/config.json` (or `$XDG_CONFIG_HOME/wilmai/config.json`).
- If multiple students exist and no default is set, the CLI will print a helpful error with the list of students.
- When the account has multiple students, `--student` is **required** for read commands.
- If auth fails or the CLI says no saved login, run `wilma login` again, or use `wilma config clear` to reset.
- Run `wilma update` to update the CLI to the latest version.
- **TLS errors on managed machines.** If a command fails with a `code` such as `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, the network is intercepting TLS and re-signing certificates with a private root CA that Node does not trust. With `--json` the failure carries `code` and `hint` fields — read the `hint` and report it rather than retrying. The fix is to run the CLI with `NODE_USE_SYSTEM_CA=1` (Node >=22.19/>=24.6), or `node --use-system-ca "$(command -v wilma)"` (Node >=22.15). Never suggest `NODE_TLS_REJECT_UNAUTHORIZED=0`; it disables verification entirely. Note that a working `npm install` does not prove TLS is healthy — the npm registry is commonly exempt from inspection.

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
