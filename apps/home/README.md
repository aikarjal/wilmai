# WilmAI Home

**Wilma, rethought with AI built in.** A desktop app for students and parents,
in beta, for Apple Silicon Macs and Windows:
[download](https://wilm.ai/en/home#download) ·
[wilm.ai/home](https://wilm.ai/en/home) ·
[releases](https://github.com/aikarjal/wilmai/releases?q=home-v).

Messages, timetables, homework, exams and grades for every child in one app,
a notification when something new needs you, and optional AI (OpenAI with your
own key, or local AI on a Mac) that reads each new message and picks out what
needs you and by when. It also replies to teachers, writes new messages, signs
up for parents' evenings and reports absences. Wilma's data, the session and
any keys stay on the computer; there is no WilmAI server.

This README is the developer's notebook: how to run and build it, how it works,
and what has been verified. Releasing is in
[docs/local-releases.md](docs/local-releases.md), the eval suite in
[evals/README.md](evals/README.md).

## Try it

```bash
pnpm install --ignore-workspace
```

The desktop app (Tauri; needs Rust 1.90+, first build takes a few minutes),
while developing:

```bash
pnpm app                 # on a Mac, with local AI (src-tauri/tauri.macos.conf.json)
```

As a real app in /Applications, built from this checkout and signed ad hoc. Run
it again to update; it quits the app and reopens it. Settings shows which build
is running. The first start of a downloaded or ad hoc build goes through System
Settings → Privacy & Security → Open Anyway (right-click → Open no longer gets
past it on macOS 15 and later).

```bash
pnpm install:app
```

Releases (0.1.x Beta) are a Mac download for Apple Silicon with local AI
included as an option, and a Windows installer (no notifications or local AI
there yet). Neither is signed by Apple or Microsoft yet; both are signed for
updates, so new versions install inside the app. See
[local release preparation](docs/local-releases.md) for building and signing on
this Mac, the update feed and download counts.

In a browser, for quick UI work (a local bridge stands in for the desktop app):

```bash
pnpm dev
```

Then open http://127.0.0.1:5199.

- **Sign in** with a school, username and password (two-step codes work). The
  password goes only to the school's Wilma. The app doesn't offer the WilmAI
  CLI's saved logins: it signs in with what the parent types here (a login
  made with one before still signs in with it).
- **Test schools** (the development server only, `pnpm dev` or `pnpm app`):
  search "testi" for Testikoulu Pohjoinen and Testikoulu Etelä, answered in
  memory with anonymised real pages (`src/demo/test-wilma.ts`). Pohjoinen:
  `huoltaja` / `testi` (Aino, listed twice as after a school change, and
  Veeti), `oppilas` / `testi` (Aino's own login). Etelä: `huoltaja` / `testi`
  (Eino). Release builds leave them out.
- **Look around with a sample family**: made-up data, safe for screenshots.
- **Settings → WilmAI Intelligence**: choose No AI, recommended OpenAI
  with the parent's own key, or local AI (Clef-flash + Qwen3.5 4B). On a
  computer that can't run local AI (not an Apple Silicon Mac with 16 GB of
  memory), that choice is shown greyed out with the reason.
  Local setup downloads one 9.1 GB pack, verifies it, probes both roles and then
  enables AI. The native runtime ships with the app; no Ollama installation is needed.
  Local processing is slower and less accurate, with no external AI processing. The key
  stays on the device. See [local setup and evaluation](docs/local-ai.md).
- **The menu bar and notifications** (desktop app, `src-tauri/src/shell.rs`,
  `src/data/notify.ts`): closing the window keeps WilmAI Home in the menu
  bar (Open, Check Wilma now, Quit; how many things need you beside the
  icon). It checks Wilma every ten minutes, shown or not (the native side
  wakes the hidden page), and notifies once when something new needs you:
  what "Odottaa sinua" shows, from WilmAI Intelligence or from Wilma's own
  data (an invitation's sign-up, so it works without a key too). The
  evening before a deadline that isn't done, a reminder. Clicking a
  notification opens the item. Never for what was there when notifications
  began, what's opened or done, or anything twice. Settings → Notifications:
  Notify me (on by default) and a test notification. Quiet hours are
  macOS's own (Focus). The notifications use macOS's older notification API
  (`mac-notification-sys`), which macOS 26 still delivers; the first one
  makes macOS ask for permission.
- **When Wilma signs the app out** (every Wilma login ends the others; in
  the sign-in history it happened 5–6 times a day, never by another WilmAI
  program): the checks go on while signed out. Each one first continues a
  live session another WilmAI program on this computer saved (no login).
  - *Keep the app signed in* (recommended; the Wilma page and Settings,
    "When Wilma signs the app out"): the app signs in again by itself, with
    the password kept here, scrambled. A
    session the app signed into itself that Wilma ends within 15 minutes
    means Wilma is in use elsewhere (a browser): it waits 30 minutes, then
    an hour, at most two, so it doesn't race the parent. A login Wilma
    refuses, or a two-step code it can't give, stops it until the parent
    signs in. The sign-in history marks automatic sign-ins, to see whether
    the phone app competes too.
  - Off (or failed): one notification ("Wilma signed WilmAI Home out"),
    "!" beside the menu bar icon, and "Sign in to Wilma…" in its menu.
- **Signing in, and the family's Wilmas**: one page, the Wilma page
  (`src/ui/Wilmas.tsx`, `src/data/logins.ts`). The app shows once every Wilma
  of the family is signed in; otherwise the Wilma page (`screenFor`). The
  menu item under Settings opens it (Wilma accounts, with the school, or how
  many Wilmas, under it; the schools on hover); in the sample family that
  item leaves it. Under them, the theme and the fold button, then the
  version. On the Wilma page, all at once:
  - who uses the app: a parent (any number of schools' Wilmas, the children
    to show) or a student (one Wilma); the app's Settings doesn't ask again;
  - each Wilma: signed in, its school and username, its children to tick
    and Sign out; signed out, a login form filled in as a browser fills one
    (the school, the username, dots for a kept password, typed over to
    change it), the code when Wilma asks; no children until it's in.
    Another school or user there signs in that login: with one Wilma it's
    another account, its own family (this one stays on this computer);
    with more, it takes that Wilma's place (`changeLogin`). A new Wilma's
    row has Cancel by its label. Each can be removed. New ones to fill
    in (the school, a username filled in from the last time, a password),
    and Add another school's Wilma (a school in another town, an upper
    secondary school or a private school with its own Wilma);
  - one Sign in for everything, right under the Wilmas, with a line saying
    what happens when Wilma signs the app out (Change). When every Wilma is
    in, the app opens; a Wilma just added keeps the page open to show the
    children it lists;
  - Settings (the button under everything), sliding in over the form within
    the panel (Done, Back or Esc returns): the app's language and theme
    (light, dark or the computer's; also beside the version under the menu);
    choosing to be asked for the password each time stops using the kept
    passwords at once and deletes them when the settings close (so trying
    the choices on the way to another loses nothing);
    when Wilma
    signs the app out (keep
    the app signed in, recommended and chosen for a first setup; ask and
    sign in with one click; or ask for the password each time, nothing
    kept); then, apart below Done and quiet until they ask, deleting this
    family's data from this computer and resetting the app. The app's own
    Settings has none of these.
  - Sign out (a Wilma's own, on the page) keeps the family and, as chosen,
    its password: Sign in is one click. Signed out by the parent, nothing
    signs in by itself. The sample family is on the page only, not in
    Settings.
  - Only a guardian's login can be added, one per Wilma. Each Wilma numbers
    its own children, messages and bulletins, so an added login's carry its
    slot (child `12345@1`, ids slot × 2³² + Wilma's own); the first login's
    keep Wilma's own numbers, so nothing stored before changes. Any Wilma
    can be removed, the first too.
  - A child at a new school gets a new profile, even on the same Wilma, so
    Wilma can list them twice for a while: the parent unticks the old one.
    An unticked child isn't read from Wilma or shown, and what was read
    stays for ticking again.
  - An added Wilma's items count as new, and notify, only from when the app
    first read it. Signing in with any of the family's logins brings the
    family back.
  - Tested against two fake Wilmas with the same numbers
    (`evals/logins.test.ts`) and by hand with the test schools; not yet with
    a real second Wilma.

**Secrets on this computer**, kept the way the WilmAI CLI keeps its saved
logins: the Wilma session (cookies) in the app's IndexedDB, the OpenAI key
in its localStorage, scrambled (base64 with a `wilmai::` prefix, as the CLI's
`obfuscateSecret`). Scrambled, not encrypted: it keeps them out of a glance
at the files, but anyone who can use your account can read them. A leaked
key is deleted in the OpenAI account; Sign out ends the Wilma session and keeps the API key and each account's
messages, drafts and AI answers on this computer. Reset app, the red action
at the bottom of Settings, deletes all of them. A released app might move these to the keychain; a build signed
with a Developer ID can read its own keychain items without asking.

Wilma allows one live session per account: signing in here signs you out of
Wilma elsewhere (a browser, the phone app), and the other way round. Within
WilmAI there's one session: the app, the CLI and assistants' connectors share
the CLI's session file (`~/.config/wilmai/wilmai-sessions.json`), so when one
of them signs in, the others continue that session instead of signing in
again. The app never signs in by itself; only when no WilmAI session is alive
(Wilma opened on the phone or in a browser) does it ask you. A send that meets
a changed session posts nothing, prepares the form again and asks again.

## What it does

- **Today**: what a parent checks in the morning or the evening before.
  First each child's today and next school day: start to end (today says
  when school ends, or that it's over), what's different (a start or end off
  the usual, an exam, an event that day), and only whether there's homework.
  Report an absence or write to a teacher from there. The times, an exam or
  the homework open that child's day beside the page as a timeline: hours
  from 8 down the side, each lesson a block as long as it lasts, so a late
  start and the breaks show. A block's details (room, teacher, the exam and
  what it covers, homework, writing to the teacher) appear under the
  timeline, which doesn't move. Then the top three
  things that need you, one line each with the deadline; *Recent results*:
  exam grades from the last three weeks, a new one marked (not yet seen in
  Wilma or here), each opening in Grades; and *This week and next*: exams,
  events and deadlines, and schedule changes, each shown even when empty
  ("No exams.").
- **Exams** list Wilma's own exam list and, as the calendar does, exams read
  from teachers' notes and messages that the list doesn't have ("Fysiikan
  rästikoe klo 15.20" on a lesson's note), marked as such with the school's
  own words and a way to open the note; Today's glance counts them too. A
  read exam is taken for Wilma's own exam that day only when it's the same
  one: at the same time, from a note on the same subject (the lesson's code,
  "FY_91"), or from a message its teacher sent. Another exam the same day
  stays.
- **Exams page**: on top, the coming school days as in Homework, two weeks to a
  row and as many rows as the exams need (up to eight weeks): each day with
  its exams per child as subject codes (MA, ENA1), today ringed. A day opens
  its exams right under its row, pointing up at the day (again, it closes). Then everything coming up for the children shown, by
  week: how soon
  ("Tomorrow", "In 9 days"), day and time, room and teacher from the
  timetable, and the teacher's whole description of what it covers, with the
  exam's day beside the page and writing to the teacher. Results are under
  Grades. Today's and the Week's exam lines link here (`G E`).
- **Grades** (Arvosanat), in two tabs, both by subject with the latest
  first (`G R`).
  - *Exam results* (Wilma's past exams, Kokeet > Menneet) comes first, since
    exams change every week; the period is this term, this school year or
    everything Wilma keeps. A card per child shows the exam average, then a
    row per subject, the subject with the newest exam on top: the latest
    result highlighted, the trend (the last three grades against the three
    before, half a grade or more), the results before it, and the subject's
    exam average for the period (a shaded "Average" column).
  - *Report cards* is the grade book (Suoritukset): the average (behaviour
    isn't counted, as at school; all subjects or lukuaineet), the average
    term by term, how the grades spread, and a row per subject: the grade
    now, highlighted, the trend, then each term's grade, newest first.

  A subject opens in place as one timeline: a chart of its exams (dots) and
  report-card grades (squares) over the terms, then term by term, newest
  first, the term's report-card grade with that term's exams, each with what
  the teacher wrote (three lines, the rest on request). Opened from Exam
  results it covers the period picked ("Show the whole history" for the
  rest); from Report cards, everything.

  Marks are free text that every school writes its own way: school
  grades, but also points ("24" with the note "Pisteet /25p.", "21,5/24"),
  other scales ("4" with "Arviointi 1-5"), letters (K, H, T), "poissa". So
  Jev reads each mark with the exam's name and the teacher's note, one exam
  per request, once (`markQuestions` in `src/jev/questions.ts`):
  - what it is: a school grade, points, another scale, letters,
    pass/fail, or no result;
  - how good it is on its own scale;
  - which number in the text is its maximum (24 → 24/25).

  Code only does arithmetic (the value of "8+"). Without Jev's reading (no
  key, or not read yet) a mark written like a school grade counts as one,
  and the rest show as written; the page says which.
  Only school grades are averaged and drawn; the rest is outlined and shaded
  by how good Jev read it to be. Data: the grade book (twelve hours) and the past
  exams (six hours) are read when the view opens, one request per child; the
  front page's grades, read at every sync, fill in a grade given since. A
  small dot on Grades marks a result from the last three weeks not yet seen
  in Wilma or here.
- **Notes** (tuntimerkinnät): the children's notes for the last week,
  month (the default), three months or school year, the list first: a line
  per child with how many of each kind (a count shows only those), then the
  notes by week, newest first, with subject names (not course codes), the
  teacher's own words, "Explain in Wilma" where one is needed, and a button
  to write to the teacher about it (the teacher picked from the timetable,
  the subject filled in). "By subject" opens a compact heat map per child:
  a row per subject, a column per kind, each cell shaded by its count; a
  cell, a subject or a kind shows only those notes. Days in a row of the
  same kind without the teacher's words are one line. The sync keeps the
  last 20 days; the whole year is read when the view opens (Wilma's "whole
  year" page, one request per child, kept six hours). The kind comes from
  the note's label (`src/data/notes.ts`).
- **Homework** (Läksyt), made to glance at. "Given today" first (did they
  get any?), then the two weeks' school days as a strip, as in Exams: each
  day with the subjects that have homework due (subject codes, per child),
  today ringed, past days dimmed. A day opens right under the strip, with a
  pointer to it: per child, what to bring (the day's subjects) and the
  homework, two lines each; the next school day is open to begin with.
  Below, every homework coming up, by the day it's due. The whole text opens
  beside the page, with the teacher and "Show the day". Instructions
  teachers add for pupils who missed the lesson ("POISSAOLIJAT …") are folded
  away unless the notes say the child was away; "Ei läksyä" with only those
  isn't counted. Or by subject: a matrix per child, a row per subject on
  the timetable, a column per school day of the same two weeks (today
  marked): a dot for a lesson, a mark in the child's colour for homework
  due (the key is in each card's header), and the next task's text (two
  lines); a mark or the text opens the homework beside the page, a dot that
  lesson's day.
- **Menu**: Today, Messages, Week and Calendar; then Homework, Notes, Exams and Grades
  (from the most often looked at to the least);
  Settings at the foot, above the school's name and where the data is (on
  hover, the full sentence). Badges only for what needs you (Messages, notes
  to explain); a small dot on Exams when there's an exam today or on the
  next school day, on Grades for a new exam result, and on Notes for a note
  dated today not yet seen there.
- **Children**: one control at the top: Everyone, or one child (a click on
  the child shown goes back to Everyone, so the view is never empty).
  ⌘- or Shift-click adds or removes a child; keys `0` and `1`–`9`.
- **Messages**: conversations (sent ones included), bulletins and **event
  invitations** for every child in one list (teacher notes are in Notes), with child filter, search and
  keys (`j`/`k`, `e` done, `r` reply, `/` search). An invitation waiting for
  an answer shows its times with "Sign up" (and "Won't attend", Wilma's "En
  osallistu", with a way to take it back) right under the ask, at the top
  of the message (a sign-up deadline at midnight reads as the day before,
  as Wilma shows it: "by Sat 17.10."); only a note to explain links out, to
  Wilma's "Selvitä" page.
- **Drafts** (new messages and replies) stay on this device until sent or
  discarded ("Discard draft", with Undo). If Wilma ends the session while
  writing, the app says so and offers "Sign in again" (a remembered
  password is one click), then comes back to the same message. A message to a teacher
  about a note gets a Finnish subject whatever the app's language.
- **Replying**: Wilma's own answer form. Open discussions answer everyone on
  the thread; other messages get a private answer with Wilma's "VS:" subject.
- **Invitations**: the time slots with their state (open, full, opens later,
  closed, chosen); sign up or cancel.
- **Absence report**: Wilma's own form. Wilma picks the day (today until
  12:00, then tomorrow) and the reasons; the app shows both.
- **Week**: both children's timetables side by side, exams marked; earlier
  and later weeks are read when shown.
- **Calendar** (Kalenteri): the school's dates a family keeps in its
  calendar, for every child together, a month at a time and drawn the way a
  family calendar shows them: each event as it will read there ("Kiia:
  Maantiedon koe"; a holiday for every child is just "Syysloma"), a time
  first when it has one, a holiday as a bar across its days. From Wilma's
  own data, exactly: exams (at their lesson's time), school days off their
  usual hours or without lessons, the time signed up for in an invitation
  and its sign-up deadline. From messages, bulletins and teachers' lesson
  notes (a make-up exam noted on a coming lesson), as Luna read them: trips,
  events, holidays, changed days and deadlines, each with a short title and
  the words it's from (see The Luna experiment). A period to apply in becomes
  its last day; other periods over two weeks (a course, a weekly group)
  aren't drawn. The month's arrows sit on the calendar and stay in sight
  while it scrolls. Beside it, as in the Week: Luna's suggestions (Add or
  Dismiss) and what's in the calendar for the next four weeks. An event
  opens where it comes from in the same panel: an exam or a note in the
  child's day (the lesson picked, with the note; a day further out reads
  its timetable then), a message or bulletin as Messages shows it with the
  date's line marked. A day opens its list there. "To the family calendar"
  sets which kinds go (all but deadlines, at first); the grid shows only
  those. The same event twice (Jev and the timetable, two siblings) is one.
  Google Calendar comes next: a calendar of its own in the family's
  account, kept by each event's key, so a change updates the event and a
  removal removes it.
- **Week at a glance**: beside the week, the same sections as Today's plus
  homework (a count; opened on request), always all of them. A lesson in
  the grid opens its day in the same panel as Today's. Each day's
  header shows every child's start and end time, a change from the usual in
  red ("usual" is the same weekday in other weeks). Clicking a lesson, exam or homework shows that
  lesson there instead, with the child's whole day; Escape goes back. In a
  narrower window the overview sits under the week and a lesson slides over
  the page. The menu on the left folds to icons (the button at its foot or
  `⌘\`).
- **Sign-in history** (Settings): when this app's session started, which
  WilmAI program's session it continued, and when Wilma ended it, with what
  ended it: another WilmAI program's login, or none (then it was Wilma on a
  phone or in a browser, or Wilma's own time limit).
- **Sign out** returns to the start screen and ends the Wilma session, keeping the OpenAI key and account-specific messages, drafts and AI results. The sample family has its own cache, so showing it does not replace your account.
- **Reset app and delete all data**, at the very bottom of Settings, permanently deletes all accounts' local data, settings, usage history and API keys after an explicit confirmation.

Every write (reply, sign-up, absence report) has a confirm step that says
exactly what goes where, and is checked by reading Wilma back where Wilma
allows it.

## How it's built

```
 app window (React; all state on the device: IndexedDB + localStorage)
 ┌────────────────────────────────────────────────┐
 │ UI → feed rules → wilma-client (core + write)   │
 │                  └── src/jev (question sets)    │
 └──────┬─────────────────────────────────┬───────┘
        │ desktop: Tauri commands          │ browser dev: 127.0.0.1 bridge
        │ wilma_send, jev_call (Rust)      │ (bridge/, same rules in Node)
        ▼                                  ▼
   the school's Wilma (*.inschool.fi)   TypeSafe Jev (optional)
```

- **Vite** builds the React app; **Tauri** is the desktop shell (the system's
  own web view, a ~10 MB app). The Rust side (`src-tauri/src/lib.rs`) has a
  few small commands: `wilma_send` and `jev_call` forward one request and keep
  nothing (`wilma_send` only to Wilmas from wilma-client's tenant list,
  redirects not followed, so the app sees every cookie); `secret_get` reads a
  Jev key an earlier build kept in the keychain, once, to move it;
  `shared_session_get/set` read and write the
  shared session file; `cli_logins` lists the CLI's saved logins without
  secrets and `cli_login_secret` reads one login's password, only for a
  login made with the CLI's saved login before; `update_manifest` checks
  wilm.ai for a newer version.
  The window may only call those, move itself and open https links in the
  browser (`src-tauri/capabilities`).
- Wilma itself is **wilma-client**: its runtime-neutral `core` entry for
  reading and its experimental `write` entry for answers, sign-ups and absence
  reports, with `src/wilma/transport.ts` as the transport (the Tauri command,
  or the bridge). The app logs in only when the parent signs in here
  (`relogin: false`, `resumeSession`): when Wilma ends the session, the app
  says so instead of logging in behind the parent's back. How Wilma's
  guardian pages work is in
  [docs/wilma-guardian-map.md](docs/wilma-guardian-map.md).
- Requests come from the parent's own computer and connection, like Wilma in
  their browser.

## Jev

Jev answers typed questions with probabilities, not prose. The design follows
TypeSafe's guidance: give each question only what it needs ("fetch precisely,
then judge"), keep arithmetic and dates in code, put the neutral option first
(Choice answers lean to the first option), and let code decide with
thresholds. Two stages (`src/jev/questions.ts`):

**Stage 1, `wilma-triage@3`**, every message and bulletin, one call:

| Question | Type |
| --- | --- |
| needs_action: a *required* step for the guardian (not an optional invitation) | Noul |
| kind: general, newsletter, practical, schoolwork, schedule, event, feedback, wellbeing | Choice |
| scope: whole school / their class / this pupil / city or association | Choice |
| praise | Noul |

**On this branch, what an item says is read, not pointed at.** Jev's second
stage (`wilma-detail@1`: the text as numbered lines and the dates code found
as numbered candidates, Jev choosing the action line, the deadline and the
day) and its calendar stage (`wilma-calendar@2`, choices over code's date
candidates) are replaced by Luna's reading (below); they're in the
`home-jev-only` version. The decisions keep classifying: triage, the tone of
a note (`wilma-note-tone@1`) and an exam mark's kind and level
(`wilma-exam-mark@4`; the maximum of points or a scale is read, not picked
among numbers code found).

What the app does with it (`src/data/feed.ts`): the step Luna quoted becomes
the item's one-liner and is highlighted in the message (the school's own
sentence, nothing generated); urgency ("Tomorrow", "By Friday") is computed from the
deadline or day; Coming up shows exactly the deadline and the day; a passed
deadline or event day ends "needs you". *Needs you* = required action ≥ 0.6,
not from the city or an association. Facts Wilma states exactly beat the
model: an **unexplained absence** always needs you (until Wilma shows it
explained), an **invitation** needs you only while it waits for an answer.
Nothing Jev answers can send anything: every write needs the parent's click.

Each call carries one item and the child's first name; answers are cached by
question set and content. The sample family is 15 stage-1 and 9 stage-2 calls
(about 24k input tokens, about five seconds); a real inbox re-sort earlier was
33 calls, about 61k tokens. Both are fractions of a cent.

## The Luna experiment (branch `experiment/luna`)

The Jev-only version is tagged `home-jev-only`. The cloud option runs on OpenAI, with the parent's own key: models read what each item says, Luna's
decisions classify. The feature is **WilmAI Intelligence**; in the app's
views it's "the AI" ("tekoäly"). Settings has three exclusive choices: No AI, recommended OpenAI, and experimental
Local AI. The local implementation and comparisons are in [local intelligence](docs/local-ai.md).
For OpenAI:

- Without a key: what it does (with OpenAI GPT-6 Luna), the key field
  ("Turn on"), and the usual cost, tens of cents a month for a family. Costs can rise
  with history size and re-reading. A key OpenAI refuses isn't kept.
- With a key, kept short: one line with *this month* against the limit (a thin bar, and
  what's being read), then *Translating messages* in the same card (it's OpenAI's), and
  one disclosure, *OpenAI key, limit and usage*, with the key, the usage table and a
  saved *monthly limit (USD)* slider from $0.50 to $3 in 50-cent steps, defaulting to
  $1 for both new and older installations (a higher limit saved before becomes $3). No call starts once
  the recorded month's cost is within a cent of the selected budget (`luna/client.ts`); it
  pauses and says so until the 1st. The cost is counted on this computer from the
  tokens OpenAI reports. The key shows as "Saved (…abcd)" with Replace key
  and Turn off (removes the key). Choosing No AI or Local keeps a saved key
  without using it.
- Monthly cost guidance is an estimate; the pause budget is recorded in USD. Reading older items for the first time and rereading after changes
  can raise costs. The previous per-item monthly estimate assumed one read
  per item and understated observed usage (27 cents in a few days).
- The tokens, the prices and "Read everything again" are folded under
  Details.
- Today shows a warning at 80% of the selected budget and a prominent pause
  notice when the limit is reached, with a link to adjust it in Settings.
  Raising the budget resumes waiting work; lowering it stops new calls if
  spending is already over the new limit. Local AI has no cloud budget warning.

1. **Reading** (`/v1/responses`, strict structured outputs, reasoning
   `low`, `store: false`; `src/luna/events.ts`): every message, bulletin
   and lesson note with words (120 days back; notes 60 days ahead), once,
   with its facts (sender, day sent, the pupils' first names, a note's
   lesson). The model gives the one sentence that says what the guardian
   must do and its deadline, and the dated events for the calendar: date
   (relative words resolved), end date, time, a short title in the text's
   language, a kind, whom it's for (the pupil, the class, the whole school,
   only if needed) and the words each is from. A last day to sign up,
   reply or return something is its own deadline event.
2. **Code checks** only that every quote is in the text word for word
   (case, spaces, dashes aside) and that dates and times are dates and
   times; no date patterns. What isn't there is left out (counted in
   Settings).
3. **Luna's Decisions** (`/v1/decisions`, the Jev-like endpoint,
   `gpt-6-luna`): each event's date (a deadline's as its last day, "by",
   not "on") and whether it belongs in this family's calendar (not school
   as usual, nothing cancelled, nothing only for those who choose to take
   part; both high, ≥ 0.7 and ≥ 0.75: in the calendar; from 0.5 and 0.45:
   a suggestion); whose it is, one question for each pupil with their
   class ("Aino (9C)": a 9th grade's evening is hers, an 8A lecture
   isn't; a guardians' evening counts as the class's); and whether the
   step is required of the guardian (the second look at "needs you" when
   the first was unsure). Jev's question sets (triage, tone, marks) go to
   Decisions too (`src/luna/decisions.ts` translates: a noul is a
   predicate with its yes and no spelled out).

An exam mark that is points or a scale has its maximum read the same way
(`src/luna/marks.ts`: "25" from "Pisteet /25p."), kept only when that number
is written in the mark, the name or the note.

**The reading model** is GPT-6 Luna at medium reasoning; the eval suite
tries others (`readingModel`, `readingEffort`). The Week shows the
calendar's events at the top of each day, opening their source beside the
week as in the Calendar.

**How items are read** (`readingStrategy`, the suite's configurations):

- *one pass*: the reading model reads every item;
- *gated*: a Decisions call first asks whether the item gives dates or
  asks for a step, and how its dates are written (none, a few, many or by
  class). An item with neither isn't read (a fifth of the cases, 18 % of
  a real inbox); the rest are read by Luna at medium, or by Sol for
  "many" when Sol is allowed (a third of a real inbox);
- *tiered*: the gate, Luna low, then a rung up (Luna medium, Sol) when
  the decisions are unsure of a date or whose it is, or a critic thinks a
  date was missed. It read more and gained nothing over one pass at medium.

**Compared with Jev.** Jev's own earlier answers were put aside once
(`jevBaseline`); after each reading the app writes how often Luna's
decisions agree, with the material (every item with what was read from
it, the source for new eval cases), to
`~/Library/Application Support/ai.wilm.home/`.

**The eval suite** (`evals/`, see its README) runs the app's own code on
made-up cases with right answers: needs-you, the step and its deadline,
tones, marks as shown, and the calendar. Every reading bug gets a case.
Configurations (`evals/configs.json`) name the ways to read; a new model
is a new entry, run side by side with the others and compared with each
config's committed baseline. On 8 Oct 2026 (61 cases, 13 from patterns in a
real inbox; 244 checks, each case run 3 times; decisions Luna):

| Config | Passed | Calendar | Cost a run | Seconds a case |
| --- | ---: | ---: | ---: | ---: |
| Luna, low | 98 % | 97 % | $0.027 | 4.3 |
| **Luna, medium** (the default) | **98 %** (the most checks) | **98 %** | $0.031 | 5.1 |
| Gate, then Luna medium | 98 % | 96 % | $0.035 | 5.4 |
| Gate, Sol for the hard ones | 98 % | 98 % | $0.079 | 5.4 |
| Sol 6.1 | 98 % | 96 % | $0.147 | 5.2 |

They miss different things: Sol keeps an optional test out of the calendar
but misses the parents' evening's time and a grade's lecture; Luna puts the
optional test in. The gate skips a fifth of the items but costs more than it
saves (every item goes to Decisions first). One check fails everywhere: a
TET contract "palautetaan opolle" read as the pupil's step, not the
guardian's (a call for the product, not the models).

**What a month costs** (`evals/replay.ts`: the family's own last 30 days,
41 items for two children, read by each config): Luna medium $0.026, Luna
low $0.022, gated $0.028, gated with Sol $0.097, Sol for everything $0.126;
the decisions are $0.00013 an item. Reading 120 days back when the app (or
the reading) is new costs about $0.05 once in this replay. These single-pass
replays do not establish typical monthly spending: live use includes
rereading after changes and additional calls. User-facing guidance is cents per month, often under $1 for light use, as an
estimate; the app pauses at the selected $0.50–$3 monthly
budget, defaulting to $1 in recorded usage.

**More of the decisions** (experiments, `Settings.lunaChecks`; the suite's
`choices`, `fields`, `cross` and `checks-all` configs). The Decisions
endpoint costs only its input, so the reading can be checked more:

- *cross-item* (`src/luna/links.ts`): each later item is asked about the
  events earlier items gave for the days after it: cancelled, moved, or
  the same event again. The calendar leaves out what a later item cancels
  or moves and shows a repeated event once. Each item read alone kept a
  cancelled trip, a moved exam's old day, a parents' evening's old time,
  a put-off concert and duplicates; with it, all of them pass in every run.
  On the family's real inbox it found 23 repeats (a parents' evening
  announced three times, the sports day four) and wrongly removed nothing.
- *choices*: a date asked as a choice among nearby days that code offers
  (a week either way, a day either way, the other year), so the decisions
  can settle on the right day instead of only doubting the reading's;
  whose as one choice among the pupils; and "only for those who choose to
  join" (an optional test, an association meeting, a talk for any parent)
  asked on its own, making the event a suggestion at most. Asking "is it
  the family's" as a choice among kinds of thing didn't work: the answer
  lost probability to its neighbours (a pupil's own make-up exam to "if
  needed"), so it stays a yes or no.
- *fields*: the time, the step's deadline and the kind each checked on
  its own; a doubted time or deadline is cleared rather than shown wrong.

On 8 Oct 2026 (70 cases, 3 runs each):

| Config | Passed | Calendar | Cost a run | A real month |
| --- | ---: | ---: | ---: | ---: |
| Luna medium (the app today) | 96 % | 94 % | $0.037 | $0.026 |
| + choices | 97 % | 94 % | $0.040 | |
| + fields | 97 % | 95 % | $0.041 | |
| + cross-item | 98 % | 98 % | $0.037 | |
| **+ all three** | **99 %** | **99 %** | $0.044 | $0.039 |

The app runs with all three (`lunaChecks` on by default). With all three,
what's left is two calls for the product: the TET
contract "palautetaan opolle" (the guardian's step or the pupil's?) and
the 9th grade's info evening for parents on Teams, no sign-up (the
optional question makes it a suggestion; the case wants it in the
calendar).

**Thresholds** (`LUNA_THRESHOLDS`): `pnpm calibrate` scores the stored
answers again with other thresholds, tuned on half the cases and scored on
the other half. No tuning held up there (±1 check), so the app's stay. The
probabilities are mostly well calibrated: an event at 0.9 or more for "the
family's" was right 94–99 % of the time, a later item's "cancelled or
moved" was always 0 or 1 and always right, and a step at 0.5–0.7 for
"required" was always required (under-confident there).

**Cost** (Settings): the tokens OpenAI reports, priced at OpenAI's list
prices (8 Oct 2026, per 1M tokens: Luna $0.10 in, $0.01 cached, $0.50
out; Sol 6.1 $2 / $0.10 / $10; Decisions $0.10 in,
no output charge), by month and model, with the cost per item and what this
family's monthly volume would cost. Decisions don't report tokens in the
guide's examples, so until they do they're estimated from the request's
length (marked ~).

## Claude (Anthropic) as the AI

Settings has Claude as a fourth choice, next to No AI, OpenAI and local AI: one AI at a time, and the one chosen
does everything AI does here (what needs you and by when, the calendar's dates, translating messages, and writing
to the school in Finnish). OpenAI's and local AI's behaviour is unchanged, and their earlier answers keep their
cache identity.

- **Key**: the parent's own Anthropic key, kept scrambled like the OpenAI key (`wilmai.anthropicKey`), sent only to
  `api.anthropic.com/v1/messages` (Rust `anthropic_call`, the dev bridge's `/bridge/anthropic`), API version
  `2026-10-21`, no redirects followed. A block page is told from Anthropic's answer by its `request-id` and
  `anthropic-*` headers, and pauses AI as a blocked OpenAI does.
- **Reading** (`src/ai/anthropic.ts`, plugged into `respond()`): Claude Sonnet 5.5 answers in the same JSON schema
  through structured outputs (`output_config.format`), with the instructions as a cached system prompt.
- **Decisions** (`decide()`): Anthropic has no Decisions endpoint, so Claude Haiku 5.5 answers a question set in one
  call, a probability per answer, in the Decisions shape. They're Claude's own estimates, not token probabilities;
  `pnpm eval --config claude` (with `ANTHROPIC_API_KEY`) is how to check them against the thresholds.
- **Cost**: counted from the tokens Anthropic reports at its list prices, under the same monthly limit.
- **Translating**: Claude Sonnet ("Most accurate") or Haiku ("Fast"); a translator chosen with the other AI isn't sent.

**Writing in your own language** (`src/ai/outgoing.ts`, `src/ui/InFinnish.tsx`), with either cloud AI when the app
isn't in Finnish: under a new message or an answer, "Send it in Finnish". The accurate translator turns the parent's
words into Finnish, with a translation back to check the meaning; the Finnish can be edited, the confirmation shows
exactly the Finnish that goes, and changed words need translating again before Send. A new message's draft keeps its
Finnish. Not yet sent for real to a teacher.

## Verified, and not yet

Verified against a real Helsinki Wilma (6 Oct 2026): reading everything
(timetables, messages and threads, bulletins, notes, exams, homework,
invitations with their slots), reply preparation for both kinds of answer, the
absence form's structure, Jev sorting, and the earlier Electron and extension
builds end to end.

Since 7 Oct 2026 the app runs on wilma-client (core and write) instead of its
own copy; that move is checked with the sample family, the client's tests
(a simulated Wilma, every form's exact request) and the Rust tests, not yet
against the real Wilma.

The past-exams list was read for real on 7 Oct 2026 (with the session the
app already had, no login): both children's pages parse, the default period
is the school year so far, and a wider period reaches back to the first
year at the school (123 exams, 115 graded, for the older child). The test
fixture is that page anonymized, with the grades scrambled.

Logging out was verified for real on 7 Oct 2026 (through the CLI, which uses
the same `logout()`): Wilma ended the session and rejected it afterwards.

A new message was sent for real on 7 Oct 2026 (a test to the other guardian,
from the browser setup): Wilma took the form (303 to the messages page), the
app confirmed it in sent messages, and Wilma stored the body as sent:
paragraphs, a line break, and `& < >` escaped. Exactly one message went.

An answer in an open discussion was sent for real the same day (Wilma's
quick-reply form: `wysiwyg=ckeditor`, the text as HTML, `quickbtn`; 303 back
to the thread, where it shows).

Signing up for an invitation was done for real on 8 Oct 2026 (the
parents' evening, from the installed app): Wilma took it (the list says
"Applied", 21.10.2026 17:30). The app's read-back then said the change
didn't show: Wilma calls a sign-up that can still be cancelled
"selected-cancellable", and the client knew only "selected" (which Wilma
uses once cancelling has closed). Both are read now. "En osallistu" (won't
attend) follows Wilma's script (POST `/messages/apply`, action `dismiss`, or
`canceldismiss` to take it back, no slot) but hasn't been sent for real.

Not yet done for real (each would contact a teacher or change Wilma):
a private answer, "En osallistu" and reporting an absence. They follow the requests Wilma's own pages send; try
each the first time you actually need it.

### Open gaps (7 Oct 2026)

- **Wilma's answer to the other writes is unseen.** New messages are settled
  (7 Oct: 303 to the messages page, then found in sent messages). For the
  rest it's still a guess: the absence report counts as confirmed only when
  a new success notice appears (otherwise the app says to check Wilma), and
  replies are confirmed from the thread or sent messages. The first real
  send of each kind settles it; then update wilma-client's checks.
- **Does reading the past exams mark grades seen?** Wilma records when a
  guardian saw a grade ("Nähty"); every graded exam was already seen, so
  whether opening the list (or the front page, which the app reads anyway)
  sets it couldn't be told. The app never posts Wilma's "seen" form. Check
  the next time a grade appears: open Grades here before Wilma.
- **Explaining absences ("Selvitä"):** `/attendance` was empty for both
  children, so the list and its form are unseen. The empty page has no
  marker, only text. Capture it the next time a note needs explaining.
- **Open discussions' quick reply** works for real (7 Oct), but there's no
  anonymised fixture of the form yet.

## Releasing

See [docs/local-releases.md](docs/local-releases.md). Still to come: Apple's
Developer ID (signing and notarization, so macOS doesn't stop the first start)
and a Windows signing service. Replies follow jmccrosky/wilma-mcp (MIT).
