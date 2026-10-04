---
name: wilma-triage
version: 2.0.0
description: Daily triage of Wilma school notifications for Finnish parents. Fetches exams, messages, news, schedules, homework, and lesson notes (merkinnät) — filters for actionable items, downloads and reads important bulletin attachments, syncs exams to the family calendar, and reports via chat. Requires the `wilma` skill (WilmAI MCP tools or wilma CLI); calendar sync uses whatever calendar tool the agent has (e.g. the `gog` CLI on OpenClaw, or a calendar connector).
metadata:
  {
    "openclaw":
      {
        "requires":
          {
            "bins": ["wilma"],
            "skills": ["wilma"],
            "configPaths": ["~/.config/wilmai/config.json"],
          },
        "credentials":
          {
            "note": "Requires a Wilma login (~/.config/wilmai/config.json from `wilma login`, or WILMA_* environment variables) for school data access. Calendar sync is optional and uses the gog CLI (Google OAuth) when installed.",
          },
      },
  }
---

# Wilma Triage

Automated daily triage of Wilma school data for parents. Filters noise, surfaces actionable items, and syncs exams/events to the family calendar.

## Dependencies

- **Wilma access** — the WilmAI MCP tools (`wilma_*`) or the `wilma` skill and CLI (`clawhub install wilma`; this skill's commands need wilma-cli 2.0+). The `wilma` skill maps each MCP tool to its CLI command; use whichever is available.
- **Calendar (optional)** — any calendar tool the agent has: the `gog` skill on OpenClaw (`clawhub install gog`), or the assistant's own calendar connector. Without one, list new dates in the report instead of syncing.
- **Notes** — this skill stores setup and preferences in the agent's notes. On OpenClaw that is **TOOLS.md** and **MEMORY.md**; elsewhere use the assistant's memory or project instructions wherever this skill says TOOLS.md or MEMORY.md.

## First Run Setup

On first use, collect and store configuration:

1. **Discover kids:** Call `wilma_account` or run `wilma students` to get student names and numbers
2. **Calendar:** List the available calendars with the agent's calendar tool (e.g. `gog calendar calendars`). Ask the user which calendar to use for school events. Store the calendar ID in **TOOLS.md** under a `## Wilma Triage` section along with naming conventions for events. Skip this step if no calendar tool is available.
3. **Preferences:** Ask about any kid-specific rules (e.g., subject overrides like ET instead of religion). Store in **MEMORY.md** as part of the Wilma triage context.

Over time, the user will give feedback on what to report and what to skip — store these preferences in MEMORY.md. The triage gets smarter with use.

## Workflow

1. **Fetch data** — one call covers what's new for every child: `wilma_summary` with `since`, or the CLI below. Use the date of the last run (stored in MEMORY.md), or yesterday. It returns today's and the next school day's lessons, upcoming exams (with start times when given), homework, lesson notes (teachers' feedback and absences), bulletins and messages from that day on, plus every unread message.
   ```bash
   wilma summary --since <last-run-date-or-yesterday>

   # Drill into specifics as needed
   wilma messages <id>                 # full text and every reply
   wilma news <id>                     # full text and linked resources
   wilma exams                         # all upcoming exams
   wilma schedule tomorrow
   wilma notes --from <date>           # lesson notes for a longer period
   ```
   The CLI prints JSON when an agent runs it; results come per child (`students[].student`), and times are Finnish time. With the MCP tools, `wilma_read_message`, `wilma_read_news`, `wilma_upcoming_exams`, `wilma_schedule` and `wilma_lesson_notes` are the equivalents. Every tool and command covers all children by default.

2. **Download and read important attachments** — many bulletins are link-only: the `content` field is empty (or just defers to an attachment), and the actionable information — dates, deadlines, forms, required materials, schedule details — lives inside the attached document. Skipping these means missing exactly the items triage exists to catch.

   After reading a bulletin or message, inspect the `resources` array in the JSON. Attempt a download when **all** of these hold:
   - the resource looks like a document (a `fileName` hint, a document-like URL, or otherwise clearly a file rather than a web page), and
   - the bulletin is high-value (annual/term info sheets, teacher letters, school office bulletins, permission slips), and
   - the bulletin text is empty or defers to the attachment.

   ```bash
   wilma news <news-id> download <resource-id> --output <dir>
   ```

   With the MCP tools, call `wilma_get_news_attachment` instead; it returns the file content directly.

   Handle the returned `status`:
   - `downloaded` (CLI) or `fetched` (MCP) — read the file (use the PDF reader for PDFs) and extract actionable items into the report.
   - `not_a_file` — the link is a web page or requires external sign-in. Report the URL so the parent can open it themselves. Do **not** retry in a loop.
   - `error` — report the message.

   **What NOT to download:**
   - Generic informational web links, social-media pages, and multilingual duplicates of the same notice — a single bulletin may carry many of these.
   - Do not iterate the whole `resources` array; target only genuine document attachments on high-value, actionable bulletins.

   **Sandbox note:** image/PDF reader tools may reject files in certain temp paths (e.g. system temp dirs). Download attachments into a workspace-relative directory (e.g. `./attachments/`) before reading, and clean up afterward if desired.

3. **Filter** — apply triage rules below plus any kid-specific rules from MEMORY.md. Bulletin lists always include pinned bulletins (`pinned: true`, e.g. the school-year bulletin), so they reappear every day: report a bulletin only when its date is within the triage period. A message whose `replyCount` has grown since the last run (keep the counts in MEMORY.md) has a new reply — read the thread.

4. **Calendar sync** — add missing exams and actionable events with the calendar tool noted in TOOLS.md (skip if there is none). An exam with a `time` gets a timed event; others are all-day events.
   - **ALWAYS check for existing events before adding** to avoid duplicates
   - Use naming conventions stored in TOOLS.md
   - Remove cancelled events from calendar

5. **Report** — if actionable items found, send details. If nothing actionable, stay silent or send a brief confirmation. Check MEMORY.md for the user's notification preference. Then store today's date in MEMORY.md as the last run (the next run's `--since`).

## Calendar Sync

Refer to TOOLS.md for the calendar ID, naming conventions, and the exact calendar commands or tools to use.

**NO DUPLICATES rule:**
1. Before adding any event, check calendar for that date range
2. If a matching event exists (same date + child + subject keywords), skip it
3. Only add if not already there

## Understanding Wilma Messages

Wilma messages come from different sources and have very different signal-to-noise ratios. Knowing the difference is critical for good triage:

- **Viikkoviesti / weekly letter** (from class teacher) — **HIGH VALUE.** These are the class teacher's weekly updates. They look like casual newsletters but frequently contain buried actionable items: upcoming exams, materials to bring, schedule changes, field trips, deadlines. **Always read the full content.** Never skip based on subject line.
- **Teacher messages** (from subject teachers) — Usually about specific exams, homework, or class events. High signal.
- **School office / rehtori messages** — Administrative: schedule changes, events, policy updates. Medium signal — skim for actions.
- **Kuukausitiedote / monthly newsletter** (from school office) — **Read these.** They typically contain important dates: holidays, school year start/end, event schedules, enrollment deadlines. Don't skip based on the generic subject line.
- **Municipality notices** (from the city/municipality education department) — Health campaigns, transport info, surveys. Usually noise for daily triage. Skim subject, skip unless clearly actionable.
- **Parent union / vanhempainyhdistys** — Low signal by default (fundraising, volunteer calls). However, check MEMORY.md — if the parent is actively involved in the union, these become high priority.

**Rule of thumb:** If a message is from a teacher (class teacher or subject teacher), always read it. If it's from the school office or city, skim the subject and skip unless it's clearly actionable.

If a high-value message or bulletin references or attaches a document, download and read it per workflow step 2 — the actionable details are often only in the attachment.

## Understanding Lesson Notes (merkinnät)

Lesson notes are short per-lesson remarks teachers leave in Wilma. They fall into a few categories — signal varies a lot:

- **Behavioral concerns** (e.g. "Sinulta puuttui opiskeluvälineitä" = "you were missing study materials", "Häiritsi tuntia" = "disrupted class") — **Report.** Parents typically want to know and may want to follow up.
- **Unexplained absences** ("Selvittämätön poissaolo") — **Report immediately.** Could indicate truancy or that the parent forgot to file an excuse in Wilma.
- **Explained absences** ("Terveydellinen syy" = medical, "Muu selvitetty poissaolo" = other-explained) — **Report briefly** as confirmation that the absence is logged. Skip if MEMORY.md says the parent doesn't want absence confirmations.
- **Positive feedback** ("Hyvä!", "Osasit toimia ryhmän vastuullisena jäsenenä") — **Skip by default.** Mention occasionally if MEMORY.md indicates the parent wants positive notes too.
- **The teacher's own words** (`note`, e.g. "Lähti 13.00" = "left at 13:00", or what exactly was missing) — often the most useful part. Surface it.

`typeLabel` is the Finnish label, `note` the teacher's words (or null), and `subject` the course code (e.g. `MA_8LV`; empty for notes not tied to a lesson). Group consecutive same-subject same-type notes when reporting (one absence often spans multiple periods). For a term overview, `wilma notes summary` (`wilma_lesson_notes_summary`) counts notes by type.

## Triage Rules

### Always Report (Actionable)
- Forms, permission slips, replies needed
- Deadlines (sign-ups, payments, materials to bring)
- Schedule changes (early dismissal, cancelled classes, substitute arrangements)
- Special gear/materials needed (e.g., "bring ski gear", "outdoor clothing")
- After-school events kids might want to attend (discos, movie nights)
- Exam schedule updates or new exams
- Cancelled events that are on the calendar → remove them
- Behavioral lesson notes or unexplained absences (see merkinnät section above)

### Report Briefly (Worth Mentioning)
- Field trips, themed days with date info
- School closures, holiday schedule changes
- Health notices (lice alerts, illness outbreaks)
- New grades (brief mention with grade)
- Explained absences logged in lesson notes (confirmation only)

### Important: Always Read Weekly Letters (viikkoviesti)
Weekly letters from class teachers often contain actionable items buried in the text: exams, materials to bring, schedule changes, field trips. **Always read the full content** of viikkoviesti messages — do not skip based on subject line alone. If the letter references or attaches a document (info sheet, schedule, form), download and read it too per workflow step 2.

### Day-Before Logistics (critical!)

Viikkoviestit and teacher messages often contain **operational details for upcoming days** that don't map to calendar events but are essential for parents the day/evening before:

- **Modified start/end times** (e.g., "9:30 kouluun" instead of the normal 8:30)
- **What to bring/pack** (water bottle, outdoor clothes, snacks, specific gear)
- **Which lessons are cancelled** due to trips or events (e.g., no ET, no electives)
- **Pickup/return time changes** (e.g., "paluu koululle noin klo 15")
- **Order of the day** (e.g., "exam first, then trip immediately after")

**These details are just as important as exams and schedule changes.** A parent who knows there's a field trip but doesn't know school starts at 9:30 instead of 8:30 has incomplete information.

**Workflow:**
1. When reading viikkoviestit, extract ALL day-specific logistics for the next 2-3 school days
2. If today's triage finds logistics for tomorrow or the day after, **always report them** even if the underlying event (trip, exam) is already on the calendar
3. Include: modified times, what to bring, cancelled lessons, transport details, return times
4. Don't assume calendar sync = job done — the calendar has the event but not the logistics

**Example of what gets missed without this:** Calendar shows "Activity park trip" and "History exam" on Friday. But the viikkoviesti says school starts at 9:30 (not 8:30), history exam is first, bring water bottle + snacks, no ET or electives, return around 15:00. All of that is critical for the parent to know the evening before.

### Skip Silently
- Concerts, cultural performances (FYI only)
- Generic "welcome back" or seasonal greetings
- City-wide informational notices (health campaigns, transport info, surveys)
- Parent union messages (unless user is actively involved — check MEMORY.md)
- Positive lesson notes (unless MEMORY.md says otherwise)

**Check MEMORY.md for additional skip/report rules** the user has provided over time (e.g., subject overrides, school-specific filtering).

## Suggested Cron Setup

Run daily at 07:00 local time. On OpenClaw, as an isolated agentTurn job; in other assistants, use their scheduled-task feature if they have one:

```
Schedule: 07:00 daily
Timeout: 180s
Task: "Read the wilma-triage skill, then run the full triage workflow. Report actionable findings."
```

Stagger with other morning jobs (e.g., email check at 07:05) to avoid API rate limits.

## Output Format Example

```
📚 Wilma Update

Child A (8th grade)
• Math exam tomorrow — yhtälöt, kpl 1-8
• Friday short day (9:20-12:35) — kulttuuripäivä, bring laptop + outdoor clothes
• Lesson note (yesterday, MA_8LV): "Sinulta puuttui opiskeluvälineitä" — kirja jäi kotiin

Child B (6th grade)
• No actionable items

📅 Calendar: Added Child A math exam (10 Feb), removed cancelled disco (11 Feb)
```

Keep it brief. One line per item. Silence is better than noise.

When you write dates for the user, follow the language you answer in: Finnish `ke 7.10.` (with the final period), English `Wed 7 Oct`. Wilma's own texts use the Finnish style; convert it instead of mixing the two (not `Wed 7.10`).
