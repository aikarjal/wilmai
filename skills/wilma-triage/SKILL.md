---
name: wilma-triage
version: 1.2.0
description: Daily triage of Wilma school notifications for Finnish parents. Fetches exams, messages, news, schedules, homework, and lesson notes (merkinnät) — filters for actionable items, syncs exams to Google Calendar, and reports via chat. Requires the `wilma` skill and `gog` CLI (or `gog` skill from ClawHub) for calendar access.
metadata:
  {
    "openclaw":
      {
        "requires":
          {
            "bins": ["wilma", "gog"],
            "skills": ["wilma"],
            "configPaths":
              [
                "~/.config/wilmai/config.json",
                "~/Library/Application Support/gogcli/",
              ],
          },
        "credentials":
          {
            "note": "Requires local Wilma credentials (~/.config/wilmai/config.json) for school data access and gog CLI auth (Google OAuth) for calendar sync. Both must be set up interactively before use.",
          },
      },
  }
---

# Wilma Triage

Automated daily triage of Wilma school data for parents. Filters noise, surfaces actionable items, and syncs exams/events to Google Calendar.

## Dependencies

- **wilma skill** — install from ClawHub (`clawhub install wilma`) for Wilma CLI commands and setup
- **gog skill** — install from ClawHub (`clawhub install gog`) for Google Calendar sync

## First Run Setup

On first use, collect and store configuration:

1. **Discover kids:** Run `wilma kids list --json` to get student names, numbers, and schools
2. **Calendar ID:** Run `gog calendar calendars` to list available calendars. Ask the user which calendar to use for school events. Store the calendar ID in **TOOLS.md** under a `## Wilma Triage` section along with naming conventions for events.
3. **Preferences:** Ask about any kid-specific rules (e.g., subject overrides like ET instead of religion). Store in **MEMORY.md** as part of the Wilma triage context.

Over time, the user will give feedback on what to report and what to skip — store these preferences in MEMORY.md. The triage gets smarter with use.

## Workflow

1. **Fetch data** — check TOOLS.md for student details, then start with summary:
   ```bash
   # Best starting point — returns schedule, exams, homework, news, messages
   wilma summary --all-students --json

   # Drill into specifics as needed
   wilma exams list --all-students --json
   wilma schedule list --when today --all-students --json
   wilma schedule list --when tomorrow --all-students --json
   wilma homework list --all-students --limit 10 --json
   wilma grades list --all-students --limit 5 --json
   wilma messages list --all-students --limit 10 --json
   wilma news list --all-students --limit 10 --json

   # Lesson notes (merkinnät) — fetch yesterday's notes during a morning run,
   # since teachers fill them during/after class. For a same-day check later
   # in the afternoon, omit --date.
   wilma attendance list --all-students --date <yesterday-YYYY-MM-DD> --json

   # Read full content when subject line looks actionable
   wilma messages read <id> --student <name> --json
   wilma news read <id> --student <name> --json
   ```

2. **Filter** — apply triage rules below plus any kid-specific rules from MEMORY.md

3. **Calendar sync** — add missing exams and actionable events using gog CLI commands from TOOLS.md
   - **ALWAYS check for existing events before adding** to avoid duplicates
   - Use naming conventions stored in TOOLS.md
   - Remove cancelled events from calendar

4. **Report** — if actionable items found, send details. If nothing actionable, stay silent or send a brief confirmation. Check MEMORY.md for the user's notification preference.

## Calendar Sync

Refer to TOOLS.md for the calendar ID, naming conventions, and exact gog CLI commands.

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
- **City-wide notices** (from Helsinki/municipality) — Health campaigns, transport info, surveys. Usually noise for daily triage. Skim subject, skip unless clearly actionable.
- **Parent union / vanhempainyhdistys** — Low signal by default (fundraising, volunteer calls). However, check MEMORY.md — if the parent is actively involved in the union, these become high priority.

**Rule of thumb:** If a message is from a teacher (class teacher or subject teacher), always read it. If it's from the school office or city, skim the subject and skip unless it's clearly actionable.

## Understanding Lesson Notes (merkinnät)

Lesson notes are short per-lesson remarks teachers leave in Wilma. They fall into a few categories — signal varies a lot:

- **Behavioral concerns** (e.g. "Sinulta puuttui opiskeluvälineitä" = "you were missing study materials", "Häiritsi tuntia" = "disrupted class") — **Report.** Parents typically want to know and may want to follow up.
- **Unexplained absences** ("Selvittämätön poissaolo") — **Report immediately.** Could indicate truancy or that the parent forgot to file an excuse in Wilma.
- **Explained absences** ("Terveydellinen syy" = medical, "Muu selvitetty poissaolo" = other-explained) — **Report briefly** as confirmation that the absence is logged. Skip if MEMORY.md says the parent doesn't want absence confirmations.
- **Positive feedback** ("Hyvä!", "Osasit toimia ryhmän vastuullisena jäsenenä") — **Skip by default.** Mention occasionally if MEMORY.md indicates the parent wants positive notes too.
- **Note with parenthetical detail** (e.g. "Muu selvitetty poissaolo; Lähti 13.00" = "left at 13:00") — the extra clause after the semicolon is often the most useful part. Surface it.

The `typeLabel` field in the JSON is the full Finnish reason; `subject` is the course code (e.g. `MA_8LV`). Group consecutive same-subject same-type notes when reporting (one absence often spans multiple periods).

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
Weekly letters from class teachers often contain actionable items buried in the text: exams, materials to bring, schedule changes, field trips. **Always read the full content** of viikkoviesti messages — do not skip based on subject line alone.

### Day-Before Logistics (critical!)

Viikkoviestit and teacher messages often contain **operational details for upcoming days** that don't map to calendar events but are essential for parents the day/evening before:

- **Modified start/end times** (e.g., "9:30 kouluun" instead of the normal 8:30)
- **What to bring/pack** (water bottle, outdoor clothes, snacks, specific gear)
- **Which lessons are cancelled** due to trips or events (e.g., no ET, no electives)
- **Pickup/return time changes** (e.g., "paluu koululle noin klo 15")
- **Order of the day** (e.g., "exam first, then trip immediately after")

**These details are just as important as exams and schedule changes.** A parent who knows there's a Superpark trip but doesn't know school starts at 9:30 instead of 8:30 has incomplete information.

**Workflow:**
1. When reading viikkoviestit, extract ALL day-specific logistics for the next 2-3 school days
2. If today's triage finds logistics for tomorrow or the day after, **always report them** even if the underlying event (trip, exam) is already on the calendar
3. Include: modified times, what to bring, cancelled lessons, transport details, return times
4. Don't assume calendar sync = job done — the calendar has the event but not the logistics

**Example of what gets missed without this:** Calendar shows "Superpark trip" and "History exam" on Friday. But the viikkoviesti says school starts at 9:30 (not 8:30), history exam is first, bring water bottle + snacks, no ET or electives, return around 15:00. All of that is critical for the parent to know the evening before.

### Skip Silently
- Concerts, cultural performances (FYI only)
- Generic "welcome back" or seasonal greetings
- City-wide informational notices (health campaigns, transport info, surveys)
- Parent union messages (unless user is actively involved — check MEMORY.md)
- Positive lesson notes (unless MEMORY.md says otherwise)

**Check MEMORY.md for additional skip/report rules** the user has provided over time (e.g., subject overrides, school-specific filtering).

## Suggested Cron Setup

Run daily at 07:00 local time as an isolated agentTurn job:

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

📅 Calendar: Added Child A math exam (Feb 10), removed cancelled disco (Feb 11)
```

Keep it brief. One line per item. Silence is better than noise.
