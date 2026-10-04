# @wilm-ai/wilma-client

A TypeScript client for **Wilma**, the Finnish school information system, as a parent (guardian) sees it: schedule, homework, exams and grades, the gradebook, lesson notes and absences, messages with their replies, bulletins and their attachments, and printouts. Read-only.

It powers the [`wilma` CLI and MCP server](https://www.npmjs.com/package/@wilm-ai/wilma-cli) ([wilm.ai](https://wilm.ai)).

> Independent open-source project, not affiliated with, endorsed by, or connected to Visma or the official Wilma service.

Needs Node.js 20.18.1 or newer.

```bash
npm i @wilm-ai/wilma-client
```

## Use

```ts
import { WilmaClient, listTenants } from "@wilm-ai/wilma-client";

// Find the Wilma address (most city schools share their city's Wilma).
const wilmas = await listTenants();

// Log in once; every child shares the login.
const client = await WilmaClient.login({ baseUrl: "https://<school>.inschool.fi", username, password }, onMfa);
for (const student of await client.students()) {
  const kid = client.forStudent(student.studentNumber);
  const overview = await kid.overview.get();          // this week's lessons, homework, exams, exam grades
  const exams = await kid.exams.upcoming();           // with start times when the school gives one
  const lessons = await kid.schedule.list({ from: "2026-10-05", to: "2026-10-09" }); // teachers and rooms
  const notes = await kid.attendance.list({ from: "2026-09-01", to: "2026-09-30" });  // lesson notes, with the teacher's words
  const summary = await kid.attendance.summary();    // counts by kind for the school year
  const gradebook = await kid.gradebook.get();       // subject > syllabus > course, with grades and dates
  const messages = await kid.messages.list("inbox"); // unread and replyCount included
  const thread = await kid.messages.get(messages[0].wilmaId); // the message and its replies
  const news = await kid.news.list();                 // dated, pinned and older bulletins
  const printouts = await kid.printouts.list();       // PDFs such as report cards
}
```

`onMfa(formkey)` returns a one-time code for accounts with two-step verification (e.g. generated from the authenticator setup key).

### One session per account

Wilma allows one live session per account: a new login ends the previous one, and also logs the parent out of Wilma in their own browser. So:

- **Log in once** and use `client.forStudent(number)` for each child; they share the login.
- A session that Wilma ends (another login, or expiry) **logs in again by itself** on the next request — once, even when many requests notice at the same time, including the two-step verification step. A refused password stops further attempts, so a changed password can't lock the account.
- To continue a session in another process, save `client.exportSession()` (treat it like the password) and later call `WilmaClient.resume(profile, saved, onMfa)`. `client.onLogin(callback)` tells you when a new session should be saved.

### Times

Wilma's times are Finnish wall-clock times. The client reads them as such wherever it runs (dates are correct on a UTC server too), and exports helpers: `finnishDateString()`, `finnishTime()`, and `finnishIsoString(date)` for output like `2026-10-02T13:37:00+03:00`.

### Where the data comes from

JSON wherever Wilma has it: the account's roles, the front page (overview), message lists and threads, and the timetable API. Bulletins, lesson notes, the gradebook, printouts and the exam calendar exist only as pages and are parsed; the parsers are tested against anonymised copies of real pages. Older Wilma versions without the JSON endpoints fall back to the pages.

### Safety

- Requests stay on the Wilma address; redirects to other sites never carry Wilma's cookies.
- Files linked from bulletins are fetched without the Wilma login and only from public internet addresses (private, loopback and cloud-metadata addresses are refused, also after DNS resolution).
- Requests and downloads fail after a while without progress instead of hanging.

## License

MIT
