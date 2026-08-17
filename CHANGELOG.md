# Changelog

## Unreleased

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
