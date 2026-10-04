---
name: wilma
version: 2.0.0
description: Access Finland's Wilma school system from AI agents. Fetch schedules, homework, exams, grades and the gradebook, lesson notes (merkinnät) and absence summaries, messages with replies, news, printouts and linked news resources — through the WilmAI MCP tools (`wilma_*`) when connected, or the wilma CLI. Start with a summary, drill into messages and news, and fetch linked attachments. Requires wilma-cli 2.0+.
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

There are two ways to reach Wilma. Both return the same data, in the same JSON shape.

1. **MCP tools** — if tools named `wilma_*` are available (the WilmAI connector, desktop extension or plugin), use them. No shell needed.
2. **CLI** — otherwise use the `wilma` (or `wilmai`) command. It prints JSON when you run it (no `--json` needed), and `wilma help <command>` shows usage, examples and the JSON shape.

Both cover **every child by default**; pass `student` / `--student <number|name>` to narrow to one. Results come per child: `{ students: [{ student: { studentNumber, name, wilma? }, … }] }`. Times are Finnish time with their offset (`2026-10-02T13:37:00+03:00`) — report them as they are, without converting. When you write dates for the user, follow the language you answer in: Finnish `ke 7.10.` (with the final period), English `Wed 7 Oct`. Wilma's own texts use the Finnish style; convert it instead of mixing the two (not `Wed 7.10`).

| MCP tool | CLI command |
|---|---|
| `wilma_summary` | `wilma summary [--since <date>]` |
| `wilma_schedule` | `wilma schedule [today\|tomorrow\|week\|next-week\|<date>\|<weekday>]` |
| `wilma_homework` | `wilma homework` |
| `wilma_upcoming_exams` | `wilma exams` |
| `wilma_grades` | `wilma grades` |
| `wilma_gradebook` | `wilma gradebook` |
| `wilma_lesson_notes` | `wilma notes [--date <date> \| --days N]` |
| `wilma_lesson_notes_summary` | `wilma notes summary` |
| `wilma_list_messages` / `wilma_read_message` | `wilma messages` / `wilma messages <id>` |
| `wilma_list_news` / `wilma_read_news` | `wilma news` / `wilma news <id>` |
| `wilma_get_news_attachment` | `wilma news <id> download <resource>` |
| `wilma_list_printouts` / `wilma_get_printout` | `wilma printouts` / `wilma printouts <id>` |
| `wilma_account` | `wilma students`, `wilma accounts` |
| `wilma_find_school` | `wilma find-school <city>` |
| `wilma_login` | `wilma login` |

Dates are `YYYY-MM-DD`, `today`, `yesterday` or `tomorrow`.

## Logging in

The user logs in once; the login is saved on their computer.

- **On the user's own computer:** run `wilma login` (or call `wilma_login`). It opens a page in the user's browser where they pick their school's Wilma and log in. Wait for the command to finish.
- **On a cloud computer the user can't see** (no browser they can reach):
  1. Ask which city their children's school is in (or the school's name). Run `wilma find-school <city>` (or call `wilma_find_school`) and let the user pick from the results — one city often has several Wilmas (city schools, private schools, colleges).
  2. Ask the user to add `WILMA_USERNAME` and `WILMA_PASSWORD` to your secret or environment settings, plus `WILMA_TOTP_SECRET` if the account uses two-step verification, and set `WILMA_TENANT` to the Wilma address they picked. Every command then works without a saved login. Alternatively: `wilma login --tenant <url> --username <name> --password-stdin`.
- Don't run `wilma` without arguments to look things up: in a terminal it opens a menu for people (from a program it prints the help).
- **Never ask the user to type their Wilma password into the chat.**
- **Children on different Wilmas** (e.g. a city school and a private school): the user adds each login on the login page ("Add another Wilma") or with another `wilma login`. All saved logins are used together; children then carry a `wilma` field naming their Wilma. `wilma accounts` lists the logins.

Commands continue the last Wilma session instead of logging in each time (each login would log the parent out of Wilma in their own browser), so running several commands in a row is fine.

## Install
```bash
npm i -g @wilm-ai/wilma-cli
```

## Core tasks

### Daily briefing (start here)
```bash
wilma summary
wilma summary --since yesterday
```
Per child: today's and the next school day's lessons, upcoming exams (with start times when given), recent homework, lesson notes since the previous school day (teachers' feedback and absences), recent bulletins, and recent and unread messages (`unread`, `replyCount`). `--since <date>` keeps only what is from that day on — use it for scheduled daily runs. If Wilma couldn't give a part, `unavailable` names it.

### Schedule
```bash
wilma schedule tomorrow
wilma schedule week
wilma schedule next-week
wilma schedule 2026-03-10
wilma schedule thu --student <number|name>
```
Default: this week. `tomorrow` is the next school day; a weekday (`mon`…`sun`, or Finnish `ma`…`su`) is its next occurrence. Lessons include the teacher(s) and, when Wilma gives one, the `room`.

### Homework and exams
```bash
wilma homework
wilma exams
```
Each exam has its date, subject, name, topic (what to study) and teacher; `time` is the start time when the school gives one (otherwise null).

### Grades
```bash
wilma grades       # recent exam grades
wilma gradebook    # course and report-card grades
```
The gradebook (Suoritukset) is a tree: subject → syllabus → course, each with `grade`, `credits` and completion `date`. Course codes ending in `LV` are usually school-year (report card) grades. An empty list means nothing has been graded yet.

### Lesson notes (merkinnät)
```bash
wilma notes --date yesterday
wilma notes --days 14
wilma notes summary
```
Teachers' per-lesson notes: positive feedback, behavioural remarks, missing books or homework, and absence categorisations (medical, explained, unexplained). One day (default today), `--days N` for the last N days, or `--from`/`--to`. Teachers usually fill notes during or after class, so for a morning run use the previous day (the summary already does). When the teacher wrote something, it's in `note`.

`notes summary` counts the notes by `typeLabel` for this school year (or `--from`/`--to`), e.g. how many lessons were missed for health reasons.

Each note has `start`/`end` times from Wilma's hour grid (accurate to the lesson hour). `subject` is the course code (e.g. `MA_8LV` = math, 8th grade; empty when the note isn't about a lesson) and `typeLabel` is Wilma's Finnish label.

### Messages and bulletins
```bash
wilma messages
wilma messages --folder appointments
wilma messages <id>
wilma news
wilma news --older
wilma news <id>
```
Message lists mark `unread` messages and `replyCount`; `wilma messages <id>` returns the thread with its `replies`. `wilma news` returns the newest dated bulletins plus every pinned one (`pinned: true`, e.g. the school-year bulletin); `--older` adds older bulletins (`archived: true`, dated once read). Reading an item needs no `--student` unless several Wilmas are connected.

### Printouts
```bash
wilma printouts
wilma printouts <id> --output <directory>
```
PDF documents the school offers, such as report cards or absence reports (it varies by school).

### Bulletin attachments

Always inspect the `resources` array returned by `wilma news <id>`. Each resource has:

- `id` — stable within the bulletin (`resource-1`, `resource-2`, …); the download command also accepts the bare number (`1`).
- `label` — the link text from the bulletin.
- `url` — absolute URL.
- `authContext` — `"wilma"`: a download uses the Wilma session. `"external"`: a download uses an isolated, unauthenticated fetch that never sends Wilma credentials (like opening the link in a signed-out browser).
- `fileName` — naming hint when the URL path looks like a file; may be null even for real files.

**Any resource can be attempted.** There is no reliable way to know in advance whether a URL serves a file publicly, requires sign-in, or is a plain web page — so the CLI does not guess: it attempts the download and reports what actually happened. When a document is relevant to the user's request, attempt it:

```bash
wilma news <news-id> download <resource-id> --output <directory>
```

Handle the returned `status`:

- `downloaded` — the file was written. Use the returned absolute `path`, and trust `contentType`/`sizeBytes` over any guess from the bulletin label.
- `not_a_file` — the link answered with a web page instead of a file. This usually means the document requires signing in (for example a private cloud-drive sharing link), or the link is simply a web page. Report this to the user; if access matters, open the `url` in a user-authorized browser session that has the external service's authentication. Never retry the download in a loop.
- An error (see below) — the attempt itself failed (HTTP error, network problem, size limit). Report the `message`.

Keep downloads in a task-scoped directory via `--output` (defaults to the current working directory). Existing files are never overwritten — a numeric suffix is appended.

Prefer resource metadata over URLs embedded in `content`; `content` is prose and can be null for link-only bulletins.

With the MCP tools, `wilma_get_news_attachment` returns the file itself (text inline, images as images, other files such as PDFs as an embedded file) plus the same `not_a_file` handling. Pass `save: true` to also save a copy to the user's `Downloads/WilmAI` folder.

### Choosing a child

`--student` takes a student number, the full name, or the start of a first or last name (`Kiia` for "Kiia Example"). An unknown or ambiguous name is an error (`unknown_student` / `ambiguous_student`) that lists the children, so pass a number or full name from `wilma students` when unsure.

## Errors

Errors are JSON too: `{ "status": "error", "code": "…", "message": "…" }` (sometimes with `hint` and `cause`). Exit code 2 means a usage error (`invalid_argument`, `unknown_command` — fix the command; `wilma help <command>`), 3 means `not_logged_in` (see Logging in), 1 anything else: `unknown_student`, `ambiguous_student`, `not_found`, `login_failed` (the saved password no longer works — ask the user to run `wilma login` again), `mfa_required` / `mfa_failed`, `network`, `wilma_error`.

## MFA (two-step verification)
If the Wilma account has MFA/TOTP enabled, logins need the authenticator setup key (a base32 key or `otpauth://` URI) so they can run unattended:

- **`wilma login`:** the login page asks for the setup key when Wilma requires it and saves it with the login.
- **Environment:** set `WILMA_TOTP_SECRET`.
- **One-off:** `--totp-secret <base32-key|otpauth://...>` works on any command, but a key on the command line ends up in shell history; prefer the two above.

## Notes
- If the CLI says no saved login, run `wilma login` (logging in to the same Wilma again replaces that login). `wilma accounts` lists saved logins and `wilma accounts remove <number>` removes one; `wilma config clear` deletes every saved login.
- This skill is for WilmAI CLI 2.x. If `wilma --version` prints 1.x, run `wilma update` (until then `scripts/wilma-cli.sh` runs 2.x through npx).
- The 1.x spellings (`kids list`, `tenants`, `attendance list`, `<command> list`, `messages read <id>`, `news read <id>`, `news resource download …`, `--all-students`) still work.
- **TLS errors on managed machines.** If a command fails with code `network` and a `cause` such as `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, the network is intercepting TLS and re-signing certificates with a private root CA that Node does not trust. Read the `hint` and report it rather than retrying. The fix is to run the CLI with `NODE_USE_SYSTEM_CA=1` (Node >=22.19/>=24.6), or `node --use-system-ca "$(command -v wilma)"` (Node >=22.15). Never suggest `NODE_TLS_REJECT_UNAUTHORIZED=0`; it disables verification entirely. A working `npm install` does not prove TLS is healthy — the npm registry is commonly exempt from inspection.

## Actionability guidance (for parents)

Wilma contains a mix of urgent items and general info. When summarizing for parents, prioritize **actionable** items:

**Include** items that:
- Require action or preparation (forms, replies, permissions, materials to bring).
- Are lesson notes about missing study materials or homework, behaviour, or unexplained absences.
- Are replies in a thread the parent started (`replyCount` in message lists).
- Announce a deadline or time-specific requirement.
- Describe a schedule deviation or noteworthy event (trips, themed days, school closures, exams).
- Mention homework, exams, or upcoming deadlines.

**De-prioritize** items that:
- Are purely informational with no action, deadline, or schedule impact.
- Are generic announcements unrelated to the target period.

When in doubt, **include** and let the parent decide. Prefer a short, structured summary with dates and IDs.

## Scripts

`scripts/wilma-cli.sh` runs the installed `wilma` (or `wilmai`) when it is 2.x or newer, and otherwise the latest 2.x release through `npx`.

## Links
- **GitHub:** https://github.com/aikarjal/wilmai
- **Website:** https://wilm.ai
