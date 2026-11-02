# Changelog

## Unreleased

**In short:** the CLI and MCP tools read what WilmAI Home reads: the class and teachers, past exams, invitation answers and any week's lessons; and a parent's and a child's own login on one Wilma work together.

### Added

- **Class and teachers: `wilma contacts` and the `wilma_contacts` tool.** Each child's class, class teacher and other supervisors (with their role as Wilma names it), and their own teachers with the subjects each teaches them in this and next week's timetable. These are the pages WilmAI Home reads when you write to a teacher. A Wilma that doesn't show its recipient list gives the rest, with `unavailable: ["teachers"]`.
- **Past exams for a period: `wilma grades --from <date>`, and `from`/`to` on `wilma_grades`.** Wilma's list of past exams (Kokeet > Menneet) for the period, as far back as the school keeps them, including exams still waiting for a grade (`grade: null`), as Home's Grades view shows them. Without `from`, grades come from the front page as before.
- **Invitations with the family's answer.** In the appointments folder (`wilma messages --folder appointments`, `wilma_list_messages`) and in the summary, event invitations carry `invitationStatus` as Wilma lists it: `"Applied"` with the chosen time in `invitationInfo`, `"ExpiredReg"` when the sign-up has closed, or null. It's the same request as before.
- **Any week's lessons: `wilma schedule --from <date> [--to <date>]`, and `from`/`to` on `wilma_schedule`.** A week further ahead or back (to that week's Friday), or a period of up to 31 days, e.g. a few weeks to see the usual school days.
- **Lesson notes ahead.** `wilma_lesson_notes` takes `from`/`to`, as `wilma notes` already did, and `to` can be after today: a teacher may note a make-up exam on a coming lesson.
- **A login page that works like WilmAI Home's Wilma page.** One page instead of steps: who uses WilmAI (a parent or a student), one row per Wilma, *Add another school's Wilma*, and one button that logs in every new row. A saved Wilma shows its username and children; you can untick a child Wilma lists twice (a new school gives a new profile), log in again on its row (a changed password, or another user), or remove it, which ends its Wilma session. Unticked children aren't read by any command or tool; `wilma accounts` lists them under `hidden`, and `wilma_account` marks them `hidden: true`. As in Home, the page keeps one login per Wilma; `wilma login --tenant` can still save a second user for a Wilma. Opened when logins are saved already, the page starts from them and says it's for adding a Wilma or logging in again.
- **Whose login it is.** `wilma_account`, `wilma students` and `wilma accounts` give `role`: `"guardian"`, or `"student"` for a student's own login, as Wilma's roles say. It's saved with each login's children, so `wilma accounts` shows it without logging in.

### Fixed

- **A parent's and a child's own login on the same Wilma.** Both list the child, and every command and tool read that child through whichever login was used last, so the child's messages switched between the parent's inbox and the student's own, and `wilma_account` showed the child under one login only. The child is now read through the guardian's login, whatever the order. `wilma_account` lists the child under both logins, and on the student's own login the child has `readVia` with the parent's username. With two guardians' logins, the active one still comes first.

### Changed

- **Clearer tool descriptions.** Five MCP tools now say what they return, how far back they go and which tool to use instead: `wilma_grades` (single exam grades; course and report-card grades are in `wilma_gradebook`), `wilma_gradebook`, `wilma_schedule`, `wilma_homework` and `wilma_upcoming_exams`. Their `limit` says its default. Glama's tool-quality review rated these five lowest.

## 2.3.2 (2026-11-02)

_Releases: wilma-cli 2.3.2, wilma-client 1.9.0; the `wilma` skill and plugin 2.3.2; WilmAI in the MCP Registry as `ai.wilm/wilma`._

**In short:** WilmAI is in the official MCP Registry, and students can use it with their own Wilma login.

### Added

- **The MCP Registry.** The CLI's MCP server (`npx @wilm-ai/wilma-cli mcp`) is listed in the official MCP Registry as `ai.wilm/wilma`, so assistants and apps that look there find it. wilm.ai proves the name (`/.well-known/mcp-registry-auth`), and the CLI's `package.json` names it (`mcpName`).
- client 1.9.0: **a message to several recipients.** `composeToAll()` joins recipients' compose links into one, as Wilma's own "message all teachers" links are made. `prepareMessage()` says whether Wilma's form has its "recipients see each other's replies" box (`collatedReplies`) and how it's set, and `sendMessage()` can tick or clear it. A form's checkboxes, ticked or not, are in `WilmaForm.checkboxes`. WilmAI Home 0.3.0 uses these.

### Changed

- **Students can use WilmAI too.** The npm, Claude Desktop, plugin and marketplace descriptions, the READMEs, `wilma login` help and the `wilma` skill say a student can use their own Wilma login; parents stay first. The MCP instructions tell the assistant a login may be a student's own, and the login page lists "Found on this login" instead of "Children found".

## 2.3.1 (2026-11-01)

_Releases: wilma-cli 2.3.1, wilma-client 1.8.0._

**In short:** the summary works on a Wilma that doesn't show a guardian its bulletins, such as Helsinki's.

### Fixed

- **A Wilma that refuses its bulletins page.** Helsinki's Wilma answers a guardian's bulletins page with 403, and the summary (`wilma summary`, `wilma_summary`) failed for that child. Bulletins are now optional there, as meeting invitations and lesson notes already were: the summary lists `news` under `unavailable` and reads the rest, and `wilma news` and `wilma_list_news` return no bulletins with `unavailable: ["news"]` ("This Wilma doesn't show bulletins to this account.") instead of an error. client 1.8.0: the new `news.listIfShown()` returns null there. Reported, with the same fix for WilmAI Home, by rockaholiciam in #22.

## 2.3.0 (2026-10-24)

_Releases: wilma-cli 2.3.0, wilma-client 1.7.1; the `wilma` skill and plugin 2.3.0 (2026-10-27)._

**In short:** security fixes, and `wilma home` says where to download WilmAI Home, the Wilma app for Mac and Windows.

### Added

- **`wilma home`**: where to download WilmAI Home, the Wilma app for your computer from the same project, and what its first start asks for (it isn't signed by Apple or Microsoft yet). The links are wilm.ai's own, which always lead to the current installer. The JSON has the download per platform with its requirements, and a hint that downloading and installing is the user's step. Needs no login. `wilma --help` lists it, so an agent can find the app and suggest it when someone wants a Wilma app of their own.
- **The `wilma` skill** lists `wilma home`, and says that WilmAI only reads Wilma: when someone wants to reply to a message, sign up for an event or report an absence, or wants a Wilma app of their own, the agent can point to WilmAI Home.

### Fixed

- **Security updates.** client 1.7.1 requires undici 6.29.1: a server could crash the process with a response that has too many content-encodings (GHSA-xjj6-f33q-929c), and the client opens bulletin links that school staff write. The CLI requires zod 4.6.6 (GHSA-mrhx-c7xc-m3w5, memory use while validating). The Claude Desktop extension is built with the fixed undici, zod, body-parser, fast-uri and ip-address.

## 2.2.0 (2026-10-22)

_Releases: wilma-cli 2.2.0, wilma-client 1.7.0; the `wilma` skill and plugin 2.2.0._

**In short:** when you want to use Wilma in your browser, ask your assistant to log out of Wilma, or run `wilma logout`.

### Added

- **Log out: `wilma logout` and the `wilma_logout` tool.** Wilma allows one session per account, and every WilmAI login logs the parent out of Wilma in their browser. Logging out ends WilmAI's session the way Wilma's own Log out does (the front page's logout form posts its formkey to `/logout`) and deletes it from `wilmai-sessions.json`. The saved logins stay; the next command or tool call logs in again. It covers every login commands use; `wilma logout <number|Wilma name|username>` picks one saved login, numbered as in `wilma accounts` (`--student` is refused, since a session belongs to a login, not a child). It never logs in just to log out: a session Wilma has already ended needs nothing. If Wilma can't be reached, the session is kept and logging out can be tried again.
- The tool is annotated as not read-only and idempotent. It also drops the MCP server's own copy of the session, so the next tool call starts a new one. The MCP instructions and the `wilma` skill tell assistants to call Wilma again only when the user asks.
- client 1.7.0: `WilmaClient.logout()` (and `WilmaSession.logout()`) returns whether a live session was ended. Afterwards the client doesn't log in again by itself.
- client 1.7.0: **`@wilm-ai/wilma-client/core`**, the client for any JavaScript runtime (a desktop app's web view, a browser extension). Requests go through a transport the app provides; the main entry point is core plus Node's defaults (undici). `relogin: false` and `WilmaClient.resumeSession()` (no password kept) never log in behind the parent's back: an ended session fails with `SessionEndedError` instead.
- client 1.7.0: **event invitations**: `invitations.list()` with whether the family has answered, and `invitations.get()` with the time slots, including a slot the other guardian signed up for. `messages.get()` also says whether a thread is an open discussion (`discussion`), whether Wilma allows answering it (`canReply`), and carries an invitation's slots (`invitation`).
- client 1.7.0: **past exams**: `exams.past()` reads Wilma's list of past exams (Kokeet > Menneet) with grades as Wilma writes them ("9½", "K", "19,5/24"), the verbal assessment, the teacher's notes and when a guardian saw the grade. Wilma shows this school year; `from`/`to` reach further back, as far as the school keeps exams. Exam grades from the front page (`overview.grades`) also carry `seen`.
- client 1.7.0: invitations say whether Wilma offers "En osallistu" and whether the family chose it (`canDecline`, `declined`, per slot and for the invitation); a "no" counts as an answer.
- client 1.7.0: **who's signed in**: `StudentInfo.role` is `"guardian"` or `"student"`, from Wilma's roles API, so an app can tell a student's own login from a guardian's (missing when a Wilma doesn't say).
- client 1.7.0: **class and recipients**: `student.get()` reads the child's class, class teacher and other supervisors from the front page, with their message links; `messages.recipients()` lists everyone the parent can write to (the child's own teachers, staff and teachers per school, the child, the other guardian).
- **One Wilma session for every WilmAI program on the computer.** Wilma keeps one session per account, so CLI commands, assistants' connectors and apps that each logged in ended each other's sessions. They now share the session file: when Wilma ends a session, the program first continues the newest session another one saved, and logs in only when that has ended too. A command no longer writes its older session over a newer one when it exits. Each saved session also names the program that saved it (`by`: `cli`, `mcp`), so an app can show which one started a session. client 1.7.0: `sharedSession` client option, `client.useSharedSession()`, and `client.onSessionEvent()`, which says when the client logged in, continued another program's session, or found its session ended.
- client 1.7.0, experimental: **`@wilm-ai/wilma-client/write`** reports absences, answers messages (open discussions and private answers), writes new messages (to anyone from the recipient list), signs up for invitations or cancels, and says the family won't attend (`declineInvitation`, Wilma's "En osallistu", with `undo`). Each write reads Wilma's form first, posts it once, never retries after a login, and reads the result back. A separate entry point; the CLI and MCP server stay read-only.

### Fixed

- **Bulletin text reads like the bulletin.** Bulletins came through with the page's own layout: list items indented with tabs, lines holding only a non-breaking space, nested lists flattened. Bulletin bodies are now turned into text the way messages are: paragraphs kept, list items bulleted ("- ", "1. " in numbered lists) and nested ones indented, links written with their address (CLI, MCP tools and the client). Lists in messages lose the blank lines Wilma's page put between items.
- **Message text keeps single line breaks.** Wilma's editor writes a line break followed by a newline in the page, and both were read as breaks, so messages showed an empty line wherever the writer had pressed Enter once (CLI, MCP tools and the client).
- **Removing a login no longer logs the other logins out.** `wilma accounts remove` deleted every saved session, so each remaining login logged in again on the next command, which logged the parent out of Wilma in the browser (and, with two-step verification, needed a new code). It now ends the removed login's session in Wilma and forgets only that one. If Wilma can't be reached, the login is removed anyway and the result says `session: "not_ended"`.

## 2.1.2 (2026-10-06)

_Releases: wilma-cli 2.1.2._

**In short:** the login page explains, before you type your password, that it runs on your own computer and where your password goes.

### Changed

- **A login page that puts people at ease.** Beside the form: the page runs on this computer (127.0.0.1) and WilmAI has no server; the password goes only to your school's Wilma, named once you pick it, and your assistant never sees it; WilmAI reads the same information you see in Wilma. The intro names the app that asked (Claude, Claude Code, Codex, ChatGPT…, from the name the app gives when it connects). Two columns on a computer, a Suomi/English switch, and links to how WilmAI handles your login and to the source code. Under the password field: "Sent only to <your Wilma>".

## 2.1.1 (2026-10-06)

_Releases: wilma-cli 2.1.1._

**In short:** the update notice comes at most once a day and links to what's new.

### Added

- **What's new link.** The CLI's update notice and the MCP server's update note link to https://wilm.ai/changes (this repository's releases), so an assistant can tell the user what changed.

### Fixed

- **The update notice appears at most once a day**, as the `wilma` skill says. 2.1.0 repeated it after every command until the update, so an agent's morning run of ten commands saw it ten times. A newly released version is still announced right away.

## 2.1.0 (2026-10-06)

_Releases: wilma-cli 2.1.0; the `wilma` skill and plugin 2.1.0._

**In short:** assistants and agents now tell you when a newer WilmAI is out.

### Added

- **Update notices reach agents and the Claude Desktop extension.** The once-a-day npm check used to run only in a terminal. Commands run by agents (OpenClaw and the like) now print `Update available: … Run "wilma update"` on stderr too, and the `wilma` skill tells the agent to update. The MCP server adds a one-time "Update note" to its first Wilma answer, which the assistant passes on: the Claude Desktop extension says to download the new extension from wilm.ai/get/claude, an npm install says to run `wilma update`. Nothing changes under `npx`, which already runs the newest version. `WILMAI_NO_UPDATE_CHECK=1` turns the check off.

### Changed

- Removed the hooks only the dropped hosted connection used (login page extras, `ToolHost.inlineAttachmentLimit`). No change for users.

## 2.0.1 (2026-10-05)

_Releases: wilma-cli 2.0.1, wilma-client 1.6.1._

**In short:** lesson subjects show course names again, and teachers' written notes are no longer missed.

### Fixed

- **Lesson subjects are names again** ([#18](https://github.com/aikarjal/wilmai/issues/18), thanks @taimila). Since 2.0.0, `schedule` (and the summary's lessons) for a date read Wilma's timetable JSON and used the lesson's caption, which is the course code (`yRUB1.1`) in upper secondary schools. `subject` is now the course name (`Ruotsi`) as in 1.x, falling back to the caption for lessons without a course (lunch, a class teacher's hour); `subjectCode` is unchanged.
- **Free-text lesson notes are no longer dropped** ([#16](https://github.com/aikarjal/wilmai/pull/16), by Timo Taskinen). Remarks such as praise or behaviour notes are `at-tp-other` cells on the attendance page; they are now parsed with their label, subject, teacher and the teacher's words in `note`, and the footnote marker never leaks into a field. Ported to the 2.0 parser, with Timo's test.
- The attendance request test from [#17](https://github.com/aikarjal/wilmai/pull/17) (Timo Taskinen) joins the suite; 2.0 already asks Wilma for the exact day.
- MCP tools tell the assistant to write dates in the reader's language style (Finnish `ke 7.10.`, English `Wed 7 Oct`), as the skills already do.

## 2.0.0 (2026-10-05)

_Releases: wilma-cli 2.0.0, wilma-client 1.6.0. One release for the browser login, the MCP server and Claude Desktop extension, the plugin marketplace, more Wilma data, and a CLI rebuilt for agents._

**In short:** use WilmAI from Claude, ChatGPT and other assistants. You log in to Wilma once in your browser, and every question covers all your children.

### CLI 2.0: built for agents (changes for scripts)

Nearly everyone running the CLI is an AI agent, so its defaults and output now suit them. Measured on a family account before the change: a command without `--student` covered one of two children, the same data came in three JSON shapes, times were in UTC, a third of the JSON was whitespace, and a daily triage run took 9 logins.

- **Every child by default**, like the MCP tools; `--student` narrows to one. (`--all-students` is still accepted.)
- **One JSON shape, the MCP tools' own:** `{ students: [{ student, … }] }`, from the same code, so the CLI and the tools can't drift (about 400 duplicated lines are gone). Reading one item: `{ student, message }` / `{ student, news }`.
- **Times in Finnish time with their offset** (`2026-10-02T13:37:00+03:00`) instead of UTC, in the CLI and the MCP tools; unknown times are `null`.
- **JSON when a program reads the output, text in a terminal**; `--json` / `--text` force either. JSON is compact, without bookkeeping fields (`fetchedAt`, internal type classes, sender ids).
- **One login, not one per command.** Commands and the local MCP server continue the last Wilma session (saved next to the login, readable only by the user) and log in again only when Wilma has ended it. Each login used to log the parent out of Wilma in their browser and, with two-step verification, need a fresh code; three commands in a row now log in at most once. `wilma login` keeps the session it verified. `WILMAI_NO_SESSION_CACHE=1` turns this off.
- **Shorter commands, matching the tool names:** `wilma schedule tomorrow` (also `week`, `next-week`, a date or a weekday), `wilma notes` (lesson notes; `notes summary`), `wilma messages <id>`, `wilma news <id>`, `wilma news <id> download <resource>`, `wilma printouts <id>`, `wilma students`, `wilma find-school <city>`. The 1.x spellings still work. Dates accept `today`, `yesterday` and `tomorrow`.
- **A summary for a whole morning briefing:** lesson notes since the previous school day, unread messages (meeting invitations included) and reply counts, exam start times, and `--since <date>` for only what's new (daily runs need one call instead of nine). Parts Wilma can't give are listed in `unavailable`.
- **Help per command** with examples and the JSON shape: `wilma help <command>` or `wilma <command> --help`. `wilma` without arguments from a program prints the help.
- **Errors with codes:** `{ status: "error", code, message, hint?, cause? }` — `invalid_argument`, `unknown_command`, `not_logged_in`, `unknown_student` / `ambiguous_student` (with the children listed), `not_found`, `login_failed`, `mfa_required`, `mfa_failed`, `network`, `wilma_error`, `config_invalid` — and exit codes 2 (usage), 3 (not logged in), 1 (other).
- Fixed on the way: when Wilma's student list came back empty, the shared code showed a nameless student and could save the empty list over the saved children; it now keeps the saved list.
- MCP: `wilma_summary` takes `since`; `wilma_schedule` takes `next-week`; `wilma_find_school` returns `{ wilmas, hint? }`.
- client 1.6.0: `WilmaClient.resume()` / `exportSession()` / `onLogin()` to continue a session in another process, and `finnishIsoString()`.

### New commands

- **`wilma login`** opens a one-time login page in the browser (served on `127.0.0.1` with a random path token, an Origin check and a strict CSP). Pick your school's Wilma from a search box, log in, and the verified login is saved to the config file. The password is never typed into a terminal prompt or an agent's chat. Accounts with two-step verification are asked for the authenticator setup key.
- **`wilma login --tenant <url|city> --username <name>`** logs in without a browser, reading the password from `WILMA_PASSWORD` or `--password-stdin` (a `--password` flag is refused so it never lands in shell history).
- **`wilma find-school <city or school>`** searches Wilma addresses, so agents can help a parent pick theirs.
- **`wilma mcp`** runs a stdio MCP server with 18 read-only tools (summary, schedule, homework, exams, grades, gradebook, lesson notes and their summary, messages, news, bulletin attachments, printouts, account status, school search, login). Tools cover all children by default. When nobody is logged in, tools open the browser login and tell the assistant what to relay.

### New

- **Several Wilmas per family:** children on different Wilmas (a city school and a private school or lukio, say) work together. The login page offers *Add another Wilma*; every saved login is used at once by the MCP tools, `--student` and `--all-students`, and children are labelled with their Wilma. If one Wilma is down, the others still answer and the problem is reported. `wilma accounts` lists saved logins and `wilma accounts remove <number>` removes one.
- **Environment-variable accounts:** `WILMA_TENANT`, `WILMA_USERNAME`, `WILMA_PASSWORD` (and `WILMA_TOTP_SECRET`) work for every command without a saved login — for agents that keep secrets in their own store.
- **Claude Desktop extension:** `pnpm --filter @wilm-ai/wilma-cli build:mcpb` builds `wilmai.mcpb`; a release workflow attaches it to each CLI release and to a rolling `claude-desktop` release, which `wilm.ai/get/claude` points to (so a newer wilma-client release can't break the link).
- **Plugin marketplace:** `.claude-plugin/marketplace.json` publishes the `skills/` folder as the `wilma` plugin (both skills plus the MCP server) for Claude Code and Codex. The plugin runs `@wilm-ai/wilma-cli@2`, so a future major release won't reach it unannounced.
- Skills: `wilma` 2.0.0 prefers the MCP tools when present and documents the new login and the 2.0 commands; its script uses an installed CLI only when it is 2.x and otherwise runs 2.x through npx, so an agent with CLI 1.x installed keeps working; `wilma-triage` 2.0.0 runs on one `summary --since` call and works with any calendar tool instead of requiring `gog`.

### Changed

- **One login per command instead of one per child.** Wilma allows one live session per account — every new login cancels the previous one (and logs the parent out of Wilma in their own browser). `wilma summary --all-students` for two children went from 4 logins and 26 requests (~2.8 s) to 1 login and 10 requests (~1.9 s); an unused up-front login in every CLI command is gone.
- **MCP tool calls share a session.** Tool calls in one process (the local MCP server) reuse one session per account for up to 10 idle minutes, so parallel tool calls no longer cancel each other's sessions. Five parallel calls: ~0.8 s with one login, ~0.3 s on the next round with none.
- **wilma-client 1.6.0:** `client.students()` and `client.forStudent(number)` let one login serve every child; a session cancelled by another login (HTTP 403) or expired (401) logs in again by itself — once, even when many requests notice at the same time — including the two-step verification step.
- **Two-step verification (TOTP) is robust to code reuse.** Logins less than 30 seconds apart share one code, which a server may reject. The session the login page verifies is now kept for the first questions (no second login or code), and if Wilma rejects a code, the client asks once more and gets a fresh code from the next 30-second window — no delay unless Wilma actually refuses. The login page explains where to find the authenticator setup key. Covered by an end-to-end test against a mock Wilma that enforces TOTP (`MFA_STRICT=1` also rejects reused codes).
- Running `wilma` without arguments outside a terminal (e.g. from an agent) prints what to run instead of hanging in an interactive prompt.
- Student lookups for `--student` / `--all-students` now pass the two-step verification callback, so they work on MFA accounts.
- Config writes are atomic (temp file + rename), so concurrent commands never read a half-written config.

### Fixed

- **Wrong usernames and passwords were accepted (wilma-client 1.6.0).** Wilma answers a failed login with a redirect to `?loginfailed` and an empty body; the client only checked the body, so any username and password "logged in" with no children. A `?loginfailed` redirect now fails with `AuthenticationError`, and a redirect only counts as a login when Wilma sets its session cookie.
- **Messages came back empty after another login.** When another login (the parent's phone, say) cancelled the session, Wilma answers the message list with a redirect to its login page; the client followed it and read the login page as an empty inbox. A redirect to the login page now counts as a logged-out session: the client logs in again and returns the messages.
- Wilma search now matches municipality names (the tenant list uses `name_fi`/`name_sv`, which the old search never read), and ranks a city's own Wilma first.

### Wilma data: more of it, from JSON where Wilma has it

Compared field by field against a real Wilma 2.36 account before switching; parsers are tested against anonymised copies of real pages (`packages/wilma-client/test/fixtures/real`, made with `scripts/anonymize-fixture.mjs`).

- **Gradebook** (`wilma gradebook`, `wilma_gradebook`): completed courses and grades by subject, including term and school-year (report card) grades, as a tree with credits and dates.
- **Printouts** (`wilma printouts`, `wilma printouts <id>`, `wilma_list_printouts`, `wilma_get_printout`): the PDFs a school offers, such as report cards or absence reports.
- **Lesson notes for a period and a summary.** `wilma notes --days 14` (or `--from`/`--to`) and `wilma_lesson_notes` with `days`; `wilma notes summary` and `wilma_lesson_notes_summary` count notes by kind (absences for health reasons, lateness, praise, missing study materials…) for the school year or a period. Teachers' feedback ("forgot books", "did well") lives here.
- **The teacher's own words** on a lesson note are a separate `note` field. They used to be glued onto the label, and a note without a lesson took its label for the subject; labels now come from the page's own legend.
- **Message threads with replies.** Messages are read from Wilma's thread JSON (`?format=json`): the body, recipients and every reply, with link addresses kept. Before, replies were dropped (or one replaced the message). Lists show the sender, unread messages and reply counts. Older Wilma versions fall back to the message page.
- **Schedule from the timetable API** (`/api/v1/schedules/timetable`) for any date or week: the same lessons as the schedule page (checked over four weeks, 157 lessons), plus rooms and every teacher of co-taught lessons. Older Wilma versions fall back to the schedule page.
- **All bulletins.** Pinned bulletins (*Pysyvät tiedotteet*, e.g. the school-year bulletin) and older ones (*Vanhat tiedotteet*) were missing — 22 of 42 on the test account. Lists now include the newest dated ones plus every pinned one (`pinned: true`), and older ones with `--older` / `include_older` (`archived: true`). A bulletin's own page now gives its date and author.
- **Exam start times.** Upcoming exams (`wilma exams`, the summary, `wilma_upcoming_exams`) include `time` when the school gives one ("08:30"). Exams still come from the front page's JSON; the time is only on the exam calendar page, which is matched by date and course code (and the exam's name when a course has two exams that day). If the calendar can't be read, exams come without times.
- Searching for a school that has no Wilma of its own suggests searching for its city instead (many city schools share the city's Wilma), in the CLI, the agent tool and the login page.

### Security and reliability audit

A review of the whole codebase before this release. Each item has a regression test (`packages/wilma-client/test/audit.mjs`, `packages/wilma-cli/test/audit.mjs`).

- **Bulletin links can't reach private networks.** Links in school bulletins are written by staff (or whoever controls a staff account). Downloads now go only to public internet addresses on ports 80/443: loopback, private, link-local (cloud metadata) and other special ranges are refused at every redirect and again after DNS resolution (IPv6 forms that carry an IPv4 address, such as NAT64 and 6to4, are judged by that address). A download fails after a minute without progress, so big files on slow connections still finish.
- **Wilma's cookies stay on Wilma.** Requests follow redirects hop by hop: a redirect to another site never carries the session cookie, another site can't overwrite it, and a request path can't point outside Wilma. A file Wilma hands to another site is fetched like any external link. A request fails after 30 seconds without progress, including while its body is read, and reports a timeout instead of a raw abort error.
- **No retry storm after a password change.** Wilma's explicit "login failed" answer stops further login attempts for that session (each one could count towards an account lockout). Other refusals — an outage (HTTP 5xx, also from the login token and two-step check), a rate limit, a firewall, a maintenance page — are reported as such, never as a wrong password, and the session recovers once Wilma does. A Wilma address that sends its login page to another site says which address to use.
- **Dates follow Finnish time on any computer.** Wilma times were read in the computer's own time zone, so an agent on a UTC cloud machine shifted every message, bulletin and exam by 2–3 hours, and the CLI printed dates in UTC (items between midnight and 3 a.m. showed the previous day). Lesson notes without `--date` now default to today in Finland.
- **Download file names are safe.** A name like `" .npmrc"` could save a hidden config file into the current folder; names are now cleaned of leading dots and spaces, control and text-direction characters, and Windows device names.
- **`--student` matches strictly**, like the agent tools: a number, the full name, or the start of a name part. `--student Ella` no longer picks "Daniella".
- **Reliable `--json`.** Every error is JSON (unknown commands, options and subcommands, missing values, unknown students, missing ids, two-step verification) — with codes and exit codes in 2.0, above. Unknown options are refused instead of ignored; `--limit`, `--days`, `--when`, `--folder` and `--date` are validated; `--student --json` no longer reads `--json` as a name. Debug output goes to stderr.
- **A damaged config is never overwritten.** It was read as empty, so the next login replaced every saved login; now the CLI stops and says how to fix it. The config file and folder are tightened to the user's own access when found open.
- **Text from Wilma can't control the terminal:** escape sequences (window title changes, screen clearing, clipboard writes) and carriage returns are removed from printed output and menu choices; `--json` keeps the text intact, escaped.
- **Interactive two-step verification:** switching between logins no longer reuses another login's key or typed code, and a setup key typed during a new login is saved with that login. New logins in the interactive menu are saved like `wilma login` (one entry per account, any username case).
- `wilma --version` and update notices work when the install path has spaces or non-ASCII letters, and on Windows. `wilma update` works on Windows. The daily update check no longer delays commands (a failed check also counts, for agents without internet access).
- Parsers skip messages and bulletins without a valid id, accept non-string bulletin content, keep students with an empty role name, and no longer mistake menu links or names containing menu words for students (a child linked only through a deeper link is still found).
- **Requirements:** Node.js 20.18.1 or newer (already required by the HTML parser; the site and extension said 18). Packages declare `engines`, a license and repository links, and importing `@wilm-ai/wilma-cli` no longer runs the CLI.
- **Dependencies:** undici 6.29 and 7.30, Next.js 15.5 for the site (Next 14 is no longer patched), and patched transitive packages; `pnpm audit` is down from 63 advisories to 2 in build tools (no fixed versions yet).
- **Site:** security headers (content security policy, no framing, no MIME sniffing, referrer policy), a sandboxed GitHub button, and accessibility fixes.
- **CI:** a GitHub Actions workflow builds, type-checks and runs every offline test on Node 20 and 22, and builds the site.

## 1.6.2 (2026-08-27)

_Releases: wilma-cli 1.6.2, wilma-client 1.5.2._

### Fixed

- Guardian child discovery now prefers `GET /api/v1/accounts/me/roles` and accepts homepage role links without a trailing slash, fixing empty `kids list` results on Wilma 2.36.
- Exact numeric `--student` selectors no longer depend on a fresh child-list response. Empty refreshes preserve the saved child list, so `messages read` and `news read` consistently accept IDs previously returned by the CLI.

## 1.6.1 (2026-08-19)

_Releases: wilma-cli 1.6.1, wilma-client 1.5.1._

### Fixed

- **Transport failures are no longer reported as a bare `fetch failed`.** `fetch` rejects with an opaque `TypeError: fetch failed` and puts the real reason on `error.cause`, which the CLI discarded — so the most common real cause on a managed laptop, a TLS-intercepting proxy re-signing certificates with a private root CA, was indistinguishable from being offline. Failures now report the underlying cause code (`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, `ENOTFOUND`, `ECONNREFUSED`, timeouts, …) together with remediation. With `--json`, `code` and `hint` accompany the existing `status` and `message`.

### New in wilma-client

- `NetworkError` (exported) carries `code`, `hint` and `origin` for any request that never produced an HTTP response, preserving the original error as `cause`. Both fetch call sites raise it — the authenticated session, and the isolated external-resource fetch used by `news resource download`. Non-transport errors pass through untouched.
- `describeNetworkCode()`, `extractCauseCode()` and `wrapNetworkError()` are exported for reuse. The classifier is pure and covered by offline tests. Only a request's origin is ever placed in a message, never the path, since Wilma paths embed student numbers.

## 1.6.0 (2026-08-09)

_Releases: wilma-cli 1.6.0, wilma-client 1.5.0._

### Fixed

- **`wilma news read`** no longer drops link-only bulletin payloads. Some Wilma bulletins hide their real `#news-content` while rendering an external document in an iframe. The parser now returns those links as structured `resources` instead of losing the `href` or mixing URLs into prose.

### New commands

- **`wilma news resource download <news-id> <resource-id>`** downloads any bulletin resource to an output directory (default: current directory). The resource id accepts the bare number (`1` for `resource-1`). The CLI never guesses whether a URL is a downloadable file and carries no provider-specific URL rules — it attempts the download and reports the outcome: `downloaded`, `not_a_file` (the URL answered with a web page, e.g. a sharing link behind a sign-in wall — open it in a browser instead), or an `error` (as JSON with `--json`). Wilma-hosted files download through the authenticated session; external URLs are fetched with an isolated, unauthenticated request (fresh in-memory cookie jar, browser-style redirects) that never sends Wilma credentials. Downloads are capped at 50 MB, filenames are sanitized, and existing files are never overwritten.
- The interactive CLI offers the same downloads: reading a bulletin with resources shows a per-resource download menu with a directory prompt.

### New in wilma-client

- `NewsItem.resources` exposes resource IDs, labels, absolute URLs, an `authContext` (`"wilma"` session download vs `"external"` isolated public fetch), and a `fileName` naming hint. Resources are extracted on both the HTML and JSON news-detail paths.
- `client.news.fetchResource(newsId, resourceId, { item? })` attempts any resource and resolves to `status: "fetched"` with the response, or `status: "not_a_file"` when every attempt answered with an HTML page. For external URLs it retries with conventional download parameters (`download=1`, `dl=1`) after an HTML answer.
- Added parser, client, and CLI end-to-end coverage for link-only bulletins, safe URL filtering, deduplication, external file downloads, RFC 5987 filename decoding, collision-safe naming, the size cap, and the `not_a_file` handoff.

## 1.5.3 (2026-07-11)

### Fixed

- The published CLI package now uses a valid semver dependency on `@wilm-ai/wilma-client`, fixing global npm installs that failed with `EUNSUPPORTEDPROTOCOL` on the leaked `workspace:^` specifier.

## 1.5.2 (2026-07-06)

### Fixed

- **`wilma schedule list --date YYYY-MM-DD`** now fetches Wilma's schedule page for the requested date instead of relying only on the `/overview` payload, which can omit published future timetables.
- **`wilma schedule list --weekday ...`** and `--all-students` schedule lookups use the same date-aware schedule fetch path.

### New in wilma-client (1.4.2)

- Added `client.schedule.list({ date })` for date-specific schedule retrieval.
- Added parser coverage for Wilma schedule page `eventsJSON` HTML payloads.

## 1.5.1 (2026-05-30)

### Fixed

- **`wilma messages`** now extracts the latest non-self threaded reply content from Wilma message detail pages instead of returning the original parent message.
- Reply sender and timestamp metadata are parsed from Wilma threaded reply headers, including plain-text senders and absolute `DD.MM.YYYY HH:MM` timestamps.

### New in wilma-client (1.4.1)

- Added parser coverage for threaded Wilma message replies and fallback behavior when a thread only contains the user's own replies.

## 1.5.0 (2026-05-06)

### New commands

- **`wilma attendance list`** - View student attendance / lesson notes (merkinnät) for a given date (defaults to today). Supports `--date YYYY-MM-DD`, `--all-students`, and `--json`.

### New in wilma-client (1.4.0)

- Added `client.attendance.list()` method that scrapes the Wilma `/attendance/view` page.
- Added `LessonNote` type with date, start/end time, subject, teacher, and type label.
- Hour mapping derived from the `<thead>` colspans, so schedules outside the default 08:00–15:00 range and rows with `colspan` cells are handled correctly.

## 1.1.0 (2026-02-09)

### New commands

- **`wilma summary`** - Daily briefing that combines today's and tomorrow's schedule, upcoming exams, recent homework, news, and messages into one view. Designed for AI agents to surface buried important information.
- **`wilma schedule list`** - View the student's class timetable. Supports `--when today|tomorrow|week`.
- **`wilma homework list`** - View recent homework assignments across all courses.
- **`wilma grades list`** - View past exam results with grades.

### Changed

- **`wilma exams list`** now shows only upcoming exams (previously mixed past and future). Past exam results with grades are now under `wilma grades list`.
- Exams, schedule, homework, and grades are powered by the Wilma `/overview` JSON endpoint instead of HTML scraping, providing richer and more reliable data.
- Interactive mode menu now includes all new commands.

### New in wilma-client

- Added `client.overview.get()` method that fetches the Wilma `/overview` endpoint.
- New types: `ScheduleLesson`, `UpcomingExam`, `ExamGrade`, `HomeworkItem`, `OverviewData`.

## 0.0.11 (2025-12-15)

- Bump wilma-cli version.
- Add `wilma update` command and version notification.
- Require `--student` flag for read commands with multiple students.
