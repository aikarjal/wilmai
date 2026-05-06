# Changelog

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
