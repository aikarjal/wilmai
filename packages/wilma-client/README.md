# @wilm-ai/wilma-client

A TypeScript client for **Wilma**, the Finnish school information system, as a parent (guardian) sees it: schedule, homework, exams and grades, the gradebook, lesson notes and absences, messages with their replies, event invitations, bulletins and their attachments, and printouts. The main entry point only reads (and logs out); an experimental, separate entry point writes.

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
  const results = await kid.exams.past({ from: "2024-08-01" }); // past exams with grades and topics; default: this school year
  const lessons = await kid.schedule.list({ from: "2026-10-05", to: "2026-10-09" }); // teachers and rooms
  const notes = await kid.attendance.list({ from: "2026-09-01", to: "2026-09-30" });  // lesson notes, with the teacher's words
  const summary = await kid.attendance.summary();    // counts by kind for the school year
  const gradebook = await kid.gradebook.get();       // subject > syllabus > course, with grades and dates
  const messages = await kid.messages.list("inbox"); // unread and replyCount included
  const thread = await kid.messages.get(messages[0].wilmaId); // the message and its replies
  const invitations = await kid.invitations.list();   // event invitations, with whether the family has answered
  const details = await kid.student.get();            // class, class teacher and supervisors, with message links
  const recipients = await kid.messages.recipients(); // who the parent can write to: own teachers, staff, the other guardian
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
- The password for `resume()` can be a function, e.g. one reading a keychain: `WilmaClient.resume({ baseUrl, username, password: () => readFromKeychain() }, saved)`. It's called only when Wilma has ended the session and a new login is needed, never while the saved one works, and once for many requests. If it fails, the request fails with `CredentialsUnavailableError` (with `reason` and `cause` from your error) and the next request tries again: unlike a password Wilma refuses, it never stops the client for good.
- A login that Wilma refuses before the password is sent (HTTP 403 for its login token) fails with `LoginBlockedError`, with a `hint` to show. Some Wilmas accept connections only from Finland, so this is where the computer is (a cloud server abroad, say), not the username or password. Like `CredentialsUnavailableError`, it never stops the client for good.
- `client.logout()` ends the session, as Wilma's own Log out does, so the parent can use Wilma in the browser. It never logs in: a session Wilma has already ended needs nothing, and it returns `false`. Afterwards the client and its `forStudent()` clients don't log in again by themselves. If Wilma can't be reached it throws and keeps the session, so it can be tried again.

### Any JavaScript runtime

`@wilm-ai/wilma-client/core` is the same client without Node-only code, for a browser extension, a desktop app's web view or Node. It sends every request through a transport you give it: one function that makes a single HTTP exchange without following redirects and returns the status, headers, `Set-Cookie` values and body. Cookies, redirects and timeouts stay in the client.

```ts
import { WilmaClient, SessionEndedError } from "@wilm-ai/wilma-client/core";

const client = await WilmaClient.login(profile, onMfa, { transport, relogin: false });
const saved = client.exportSession();
// Later, without keeping the password:
const again = WilmaClient.resumeSession(profile.baseUrl, saved, { transport });
```

With `relogin: false` (and always with `resumeSession`), a session Wilma has ended isn't logged in again behind the parent's back: requests fail with `SessionEndedError`, and the app asks.

### One session for every program on the computer

Programs that each log in end each other's sessions (Wilma keeps one per account). Pass `sharedSession: { load, save }` (or call `client.useSharedSession(...)`) with a place they all use, such as the `wilma` CLI's session file: when Wilma ends a client's session, it first continues the newest session another program saved, and logs in only when that one has ended too; after its own login it saves the session for the others. `client.onSessionEvent(event => …)` tells an app what happened: `"login"`, `"adopted"` (another program's session continued) or `"ended"`. A form prepared under one session is never posted under another (see Writing). Downloading files that bulletins link to on other sites needs the main (Node) entry point, which can guard those requests.

### Times

Wilma's times are Finnish wall-clock times. The client reads them as such wherever it runs (dates are correct on a UTC server too), and exports helpers: `finnishDateString()`, `finnishTime()`, and `finnishIsoString(date)` for output like `2026-10-02T13:37:00+03:00`.

### Where the data comes from

JSON wherever Wilma has it: the account's roles, the front page (overview), message lists and threads, and the timetable API. Bulletins, lesson notes, the gradebook, printouts and the exam calendar exist only as pages and are parsed; the parsers are tested against anonymised copies of real pages. Older Wilma versions without the JSON endpoints fall back to the pages.

### Safety

- Requests stay on the Wilma address; redirects to other sites never carry Wilma's cookies.
- Files linked from bulletins are fetched without the Wilma login and only from public internet addresses (private, loopback and cloud-metadata addresses are refused, also after DNS resolution).
- Requests and downloads fail after a while without progress instead of hanging.

## Writing (experimental)

`@wilm-ai/wilma-client/write` answers messages, writes to teachers, signs up for event invitations and reports absences. It's a separate entry point, so read-only tools such as the `wilma` CLI don't carry it.

```ts
import { prepareAbsenceReport, sendAbsenceReport } from "@wilm-ai/wilma-client/write";

const kid = client.forStudent(studentNumber);          // writes are per child
const form = await prepareAbsenceReport(kid);          // reads Wilma's form; changes nothing
// form.date is the day Wilma will record (today until 12:00, then tomorrow); form.reasons are the school's.
await sendAbsenceReport(kid, form, { reason: form.reasons[0].value, text: "Fever" });
```

- **Two steps, like Wilma's own pages.** `prepare…` reads Wilma's form; `send…` posts it once, as Wilma's page would: the fields Wilma filled in plus what the parent wrote (message bodies as HTML, since Wilma's message forms come with an editor). Also `prepareReply`/`sendReply` (an open discussion's quick reply, or a private answer to the sender), `prepareMessage`/`sendMessage` (to anyone from `messages.recipients()` or `student.get()`, or a teacher by id), and `answerInvitation(kid, messageId, slotId, "apply" | "cancel")`. Prepared forms say who a message goes to (`recipients`).
- **Never sent twice.** A send isn't repeated, and never retried after a login: if Wilma has ended the session it fails with `SessionEndedError`, and nothing was sent.
- **Checked afterwards.** Wilma's answer is checked, and the result read back where Wilma shows it (the thread, sent messages, the invitation). `WriteRefusedError`: Wilma said no and nothing changed. `WriteUnconfirmedError`: it may have gone through, so check Wilma before sending again. `NotOfferedError`: Wilma doesn't offer this here (no answer form, sign-up closed).

The forms follow Wilma's pages as seen in October 2026, and the tests prepare them from anonymised copies of the real pages. A new message and an answer in an open discussion have been sent on the real Wilma (October 2026). A private answer, signing up for an invitation and an absence report have been tested against a simulated Wilma only, so how they're confirmed may still need adjusting after the first real use. "Won't attend" on invitations isn't supported.

### Not covered

Rarely used parts of Wilma stay there: applications and decisions (`/decisions`, e.g. leave from school), forms such as basic information and consents, surveys, assessment discussions, support plans, notification settings and course selection. Explaining absences ("Selvitä") waits until a real case shows its form. Students' own logins (Wilma for students, EDU) aren't supported; this is a guardian's client.

## License

MIT
