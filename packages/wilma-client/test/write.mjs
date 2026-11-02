/*
 * The write entry point against a fake Wilma: each form is sent exactly as a
 * browser without scripts would (asserted byte for byte), once, and the result
 * is read back. Pages follow the structure of Wilma's own (Helsinki, Oct 2026).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SessionEndedError, WilmaClient, awaitingAnswer, slotState } from "../dist/core.js";
import {
  NotOfferedError,
  WriteRefusedError,
  WriteUnconfirmedError,
  answerInvitation,
  composeToAll,
  declineInvitation,
  editorBody,
  prepareAbsenceReport,
  prepareMessage,
  prepareReply,
  sendAbsenceReport,
  sendMessage,
  sendReply,
  wilmaDayToIso,
} from "../dist/write.js";
import { parseInvitation } from "../dist/parsers/invitations.js";

const S = "/!1234567";
const html = (body) => `<!doctype html><html><body>
<form id="logout-form" action="/logout" method="post"><input type="hidden" name="formkey" value="logout-key"></form>
${body}</body></html>`;

/** "2026-10-14 18:00" for an offset in days from now (Wilma's format; the hour is approximate, which these tests don't need). */
const wilmaDay = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 16).replace("T", " ");

function fakeWilma() {
  const state = {
    sid: 0,
    alive: null,
    posts: [],
    requests: [],
    absenceAnswer: "saved", // saved | refused | silent
    discussionReplies: [{ Id: 1, TimeStamp: "2026-10-01 10:00", Sender: "Opettaja Testi", ContentHtml: "<p>Tervetuloa</p>" }],
    outbox: [{ Id: 800, Subject: "Vanha viesti", TimeStamp: "2026-09-01 09:00" }],
    countDiscussionReply: true,
    chosen: new Set(),
    dismissed: false,
    applyProblem: false,
  };
  const reply = (status, { headers = {}, setCookies = [], body = "" } = {}) => ({ status, headers: new Headers(headers), setCookies, body });
  const page = (body) => reply(200, { headers: { "content-type": "text/html; charset=utf-8" }, body: html(body) });
  const json = (data) => reply(200, { headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
  const thread = (id, extra) => ({ messages: [{ Id: id, Subject: "Aihe", TimeStamp: "2026-10-01 09:00", Sender: "Opettaja Testi", ContentHtml: "<p>Viesti</p>", ...extra }] });
  const eventData = () =>
    JSON.stringify({
      MustApply: true,
      Events: [
        // As Wilma sends them (8 Oct 2026): "selected-cancellable" for a sign-up that can still be cancelled.
        { EventID: 7001, Start: wilmaDay(7), End: wilmaDay(7), EnrollStart: wilmaDay(-1), EnrollEnd: wilmaDay(5), CancelDate: wilmaDay(5), Info: "Sali", MaxPeople: 10, PeopleCount: 3, State: state.chosen.has("7001") ? "selected-cancellable" : "available", CanDismissEvent: true, ...(state.dismissed ? { IsDismissed: true } : {}) },
        { EventID: 7002, Start: wilmaDay(8), End: wilmaDay(8), EnrollStart: wilmaDay(-1), EnrollEnd: wilmaDay(5), MaxPeople: 2, PeopleCount: 2, State: "full", CanDismissEvent: true, ...(state.dismissed ? { IsDismissed: true } : {}) },
        { EventID: 7003, Start: wilmaDay(9), End: wilmaDay(9), EnrollStart: wilmaDay(-1), EnrollEnd: wilmaDay(5), MaxPeople: 0, State: "available", CanDismissEvent: true, ...(state.dismissed ? { IsDismissed: true } : {}) },
      ],
    });

  const transport = async (req) => {
    const url = new URL(req.url);
    const path = url.pathname + url.search;
    const sid = /Wilma2SID=([^;]+)/.exec(req.headers.cookie ?? "")?.[1] ?? null;
    state.requests.push(`${req.method} ${path}`);
    if (url.pathname === "/login" && req.method === "GET") return reply(200, { body: '<input type="hidden" name="SESSIONID" value="s">' });
    if (url.pathname === "/login" && req.method === "POST") {
      state.sid += 1;
      state.alive = `s${state.sid}`;
      return reply(303, { headers: { location: "/" }, setCookies: [`Wilma2SID=${state.alive}; Path=/; HttpOnly`] });
    }
    if (!sid || sid !== state.alive) return reply(req.method === "POST" ? 403 : 302, { headers: { location: "/login" } });
    if (req.method === "POST") state.posts.push({ path, body: req.body, headers: req.headers });

    switch (`${req.method} ${path}`) {
      case "GET /api/v1/accounts/me/roles":
        return json({ payload: [{ type: "guardian", slug: "!1234567", name: "Testi Lapsi" }] });

      // Absence report
      case `GET ${S}/attendance/report`:
        return page(`<div class="alert alert-info">Ilmoitus näkyy opettajille Wilmassa.</div>
<h3>Poissaolon ajankohta: Huomenna, 7.10.</h3>
<form action="${S}/attendance/savereport" method="post">
  <input type="hidden" name="formkey" value="fk-1"><input type="hidden" name="ReportDate" value="46302">
  <select name="type"><option value="0">-</option><option value="83">Terveydellinen syy</option></select>
  <input type="text" name="text" value="">
  <button type="submit" name="savebtn" value="Tallenna">Tallenna</button>
</form>`);
      case `POST ${S}/attendance/savereport`:
        if (state.absenceAnswer === "refused") return page('<div class="alert alert-danger">Ilmoitusta ei voi tehdä tälle päivälle.</div>');
        return reply(303, { headers: { location: `${S}/attendance/report?${state.absenceAnswer}` } });
      case `GET ${S}/attendance/report?saved`:
        return page('<div class="alert alert-info">Ilmoitus näkyy opettajille Wilmassa.</div><div class="alert alert-success">Poissaoloilmoitus tallennettu.</div>');
      case `GET ${S}/attendance/report?silent`:
        return page('<div class="alert alert-info">Ilmoitus näkyy opettajille Wilmassa.</div>');

      // An open discussion
      case `GET ${S}/messages/100?format=json`:
        return json(thread(100, { AllowCollatedReply: true, ReplyList: state.discussionReplies }));
      case `GET ${S}/messages/100`:
        return page(`<form id="quickreply-form" action="${S}/messages/collatedreply/100" method="post">
  <input type="hidden" name="formkey" value="fk-2"><input type="hidden" name="wysiwyg" value="false">
  <textarea name="bodytext"></textarea><input type="submit" name="quickbtn" value="Lähetä">
</form>`);
      case `POST ${S}/messages/collatedreply/100`: {
        const text = new URLSearchParams(req.body).get("bodytext");
        if (state.countDiscussionReply) state.discussionReplies = [...state.discussionReplies, { Id: 0, TimeStamp: "2026-10-07 12:00", Sender: "Huoltaja", ContentHtml: `<p>${text}</p>` }];
        return reply(303, { headers: { location: `${S}/messages/100` } });
      }

      // An ordinary message: a private answer
      case `GET ${S}/messages/200?format=json`:
        return json(thread(200, { Subject: "Retki" }));
      case `GET ${S}/messages/200`:
        return page(`<h1>Retki</h1><ul class="dropdown-menu">
  <li><a href="${S}/messages/compose?replyid=200&amp;forward">Välitä viesti edelleen</a></li>
  <li><a href="${S}/messages/compose?replyid=200">Vastaa viestin lähettäjälle</a></li></ul>`);
      case `GET ${S}/messages/compose?replyid=200`:
      case `GET ${S}/messages/compose?r_teacher=555`: {
        const subject = url.searchParams.has("replyid") ? "VS: Retki" : "";
        return page(`<form action="${S}/messages/compose" method="post">
  <input type="hidden" name="formkey" value="fk-4"><input type="hidden" name="wysiwyg" value="ckeditor">
  ${url.searchParams.has("replyid") ? '<input type="hidden" name="replyid" value="200">' : ""}
  <input type="text" name="Subject" value="${subject}">
  <button name="select_recipients" id="recipients-open">Valitse vastaanottajat</button>
  <span class="recipient-item"><input type="hidden" name="r_teacher" value="555"><span>Testi Opettaja (TES)</span></span>
  <textarea name="BodyText">quoted</textarea>
  <input type="checkbox" name="ShowRecipients" value="1">
  <input type="checkbox" name="CollatedReplies" checked>
  <input type="submit" name="draftbtn" value="Tallenna luonnos">
  <input type="submit" name="addsavebtn" value="Lähetä">
  <input type="submit" name="cancelbtn" value="Peruuta">
</form>`);
      }
      case `POST ${S}/messages/compose`: {
        const subject = new URLSearchParams(req.body).get("Subject");
        state.outbox = [{ Id: 900 + state.outbox.length, Subject: subject, TimeStamp: "2026-10-07 12:00" }, ...state.outbox];
        return reply(303, { headers: { location: `${S}/messages` } });
      }
      case `GET ${S}/messages`:
        return page("<h1>Viestit</h1>");
      case `GET ${S}/messages/list/outbox`:
        return json({ Messages: state.outbox });

      // An event invitation
      case `GET ${S}/messages/list/appointments`:
        return json({ Messages: [{ Id: 300, Subject: "Vanhempainilta", TimeStamp: "2026-10-01 12:00", Status: 0, IsEvent: true, Applying: { Status: "Applied", ExtraInfo: " 14.10. klo 18:00 " } }] });
      case `GET ${S}/messages/300?format=json`:
        return json(thread(300, { Subject: "Vanhempainilta", IsEvent: true, EventData: eventData() }));
      case `GET ${S}/messages/300`:
        return page(`<h1>Vanhempainilta</h1><form id="appointment"><input type="hidden" name="formkey" value="fk-3"></form>`);
      case `POST ${S}/messages/apply/`: {
        const form = new URLSearchParams(req.body);
        if (state.applyProblem) return json({ resultmessage: { message: "Aika on täynnä", problem: "problem" } });
        if (form.get("action") === "apply") state.chosen.add(form.get("apptId"));
        if (form.get("action") === "cancel") state.chosen.delete(form.get("apptId"));
        return json({ resultmessage: { message: "Tallennettu", problem: "" } });
      }
      // "En osallistu": no slot; declining also cancels a sign-up.
      case `POST ${S}/messages/apply`: {
        const form = new URLSearchParams(req.body);
        if (form.get("action") === "dismiss") {
          state.dismissed = true;
          state.chosen.clear();
        }
        if (form.get("action") === "canceldismiss") state.dismissed = false;
        return json({ resultmessage: { message: "Tallennettu", problem: "" } });
      }
      // A message without any answer
      case `GET ${S}/messages/400`:
        return page("<h1>Tiedote</h1><p>Ei vastauksia.</p>");
    }
    return reply(404);
  };
  return { state, transport };
}

const profile = { baseUrl: "https://fake.inschool.fi", username: "parent", password: "right" };
async function setup() {
  const wilma = fakeWilma();
  const account = await WilmaClient.login(profile, undefined, { transport: wilma.transport, relogin: false });
  return { wilma, account, child: account.forStudent("1234567") };
}
const posts = (wilma) => wilma.state.posts.map((p) => `${p.path} ${p.body}`);

// 1. Absence report: Wilma's day, reasons, the exact post, and its confirmation.
{
  const { wilma, child } = await setup();
  const form = await prepareAbsenceReport(child);
  assert.equal(form.date, "2026-10-07");
  assert.equal(wilmaDayToIso("46302"), "2026-10-07");
  assert.equal(form.dateLabel, "Huomenna, 7.10.");
  assert.deepEqual(form.reasons, [{ value: "83", label: "Terveydellinen syy" }]);
  assert.equal(form.acceptsText, true);
  assert.match(form.guidance, /näkyy opettajille/);
  assert.equal(wilma.state.posts.length, 0, "preparing sends nothing");
  await assert.rejects(() => sendAbsenceReport(child, form, { reason: "99" }), TypeError);
  const result = await sendAbsenceReport(child, form, { reason: "83", text: "Kuumetta & yskää" });
  assert.equal(result.notice, "Poissaoloilmoitus tallennettu.");
  assert.deepEqual(posts(wilma), [`${S}/attendance/savereport formkey=fk-1&ReportDate=46302&type=83&text=Kuumetta+%26+ysk%C3%A4%C3%A4&savebtn=Tallenna`]);

  wilma.state.absenceAnswer = "refused";
  await assert.rejects(() => sendAbsenceReport(child, form, { reason: "83" }), WriteRefusedError);
  wilma.state.absenceAnswer = "silent"; // only the notice that was already on the form page
  await assert.rejects(() => sendAbsenceReport(child, form, { reason: "83" }), WriteUnconfirmedError);
  assert.equal(wilma.state.posts.length, 3, "one post per send, never repeated");
}

// 2. Answering an open discussion: the quick-reply form, confirmed in the thread.
{
  const { wilma, child } = await setup();
  const form = await prepareReply(child, 100);
  assert.equal(form.mode, "discussion");
  await assert.rejects(() => sendReply(child, form, "   "), TypeError);
  await sendReply(child, form, "Kiitos, tulemme!");
  assert.deepEqual(posts(wilma), [`${S}/messages/collatedreply/100 formkey=fk-2&wysiwyg=false&bodytext=Kiitos%2C+tulemme%21&quickbtn=L%C3%A4het%C3%A4`]);
  wilma.state.countDiscussionReply = false; // Wilma took it but the thread doesn't show it
  await assert.rejects(() => sendReply(child, form, "Toinen vastaus"), WriteUnconfirmedError);
}

// 3. A private answer: the compose form Wilma links to, never its draft or cancel buttons, confirmed in sent messages.
{
  const { wilma, child } = await setup();
  const form = await prepareReply(child, 200);
  assert.equal(form.mode, "private");
  assert.equal(form.subject, "VS: Retki");
  assert.deepEqual(form.recipients, ["Testi Opettaja (TES)"]);
  await sendReply(child, form, "Hyvä, kiitos.");
  // Not the forward link before it; the body as the editor sends it.
  assert.deepEqual(posts(wilma), [
    `${S}/messages/compose formkey=fk-4&wysiwyg=ckeditor&replyid=200&Subject=VS%3A+Retki&r_teacher=555&BodyText=%3Cp%3EHyv%C3%A4%2C+kiitos.%3C%2Fp%3E&CollatedReplies=on&addsavebtn=L%C3%A4het%C3%A4`,
  ]);
  await assert.rejects(() => prepareReply(child, 400), NotOfferedError);
}

// 4. A new message to a teacher.
{
  const { wilma, child } = await setup();
  const form = await prepareMessage(child, { teacherId: 555 });
  await assert.rejects(() => prepareMessage(child, { teacherId: "555&r_group=1" }), TypeError);
  await sendMessage(child, form, { subject: "Kysymys", text: "Milloin koe on?" });
  assert.deepEqual(posts(wilma), [
    `${S}/messages/compose formkey=fk-4&wysiwyg=ckeditor&Subject=Kysymys&r_teacher=555&BodyText=%3Cp%3EMilloin+koe+on%3F%3C%2Fp%3E&CollatedReplies=on&addsavebtn=L%C3%A4het%C3%A4`,
  ]);
  assert.equal(wilma.state.outbox[0].Subject, "Kysymys");

  // Recipients seeing each other's replies: as Wilma's form has it, or as asked (ticked with the box's own value, or cleared).
  assert.equal(form.collatedReplies, true);
  await sendMessage(child, form, { subject: "Erikseen", text: "Vain minulle.", collatedReplies: false });
  assert.ok(!posts(wilma)[1].includes("CollatedReplies"), "cleared");
  const unticked = { ...form, form: { ...form.form, fields: form.form.fields.filter(([n]) => n !== "CollatedReplies"), checkboxes: [{ name: "CollatedReplies", value: "true", checked: false }] } };
  await sendMessage(child, unticked, { subject: "Kaikille", text: "Näkyy kaikille.", collatedReplies: true });
  assert.ok(posts(wilma)[2].includes("&CollatedReplies=true&"), "ticked");

  // A recipient's link from messages.recipients() or student.get(), kept to this child's compose page.
  const viaLink = await prepareMessage(child, { composePath: `${S}/messages/compose?r_teacher=555` });
  assert.deepEqual(viaLink.recipients, ["Testi Opettaja (TES)"]);
  await assert.rejects(() => prepareMessage(child, { composePath: "/!7654321/messages/compose?r_teacher=555" }), TypeError, "another child's link");
  await assert.rejects(() => prepareMessage(child, { composePath: `${S}/messages/apply/?r_teacher=555` }), TypeError, "not a compose page");
  await assert.rejects(() => prepareMessage(child, { composePath: "https://elsewhere.example/messages/compose?r_teacher=555" }), TypeError);
}

// 4a. Several recipients in one message: their r_ parameters together, as Wilma's own group links are.
{
  const one = `${S}/messages/compose?r_teacher=555`;
  assert.equal(composeToAll([one]), one, "one recipient: the link as Wilma gave it");
  assert.equal(
    composeToAll([one, `${S}/messages/compose?r_teacher=556`, `${S}/messages/compose?r_personnel=7&r_teacher=555`]),
    `${S}/messages/compose?r_teacher=555&r_teacher=556&r_personnel=7&showrecipients=1&collatedreplies=1`
  );
  assert.throws(() => composeToAll([one, "/!7654321/messages/compose?r_teacher=1"]), TypeError, "another child's");
}

// 4b. Text as Wilma's editor sends it: paragraphs, line breaks, and nothing read as markup.
{
  const editor = { action: "/x", fields: [["wysiwyg", "ckeditor"]], buttons: [], selects: [], textareas: [] };
  assert.equal(editorBody(editor, "Hei!\n\nTulemme <molemmat> & sisko.\nTerveisin\r\nAntti\n"), "<p>Hei!</p>\n<p>Tulemme &lt;molemmat&gt; &amp; sisko.<br />\nTerveisin<br />\nAntti</p>");
  assert.equal(editorBody({ ...editor, fields: [["wysiwyg", "false"]] }, "a\nb"), "a\nb", "a plain form gets the text as is");
  assert.equal(editorBody({ ...editor, fields: [] }, "a\nb"), "a\nb");
}

// 5. Invitations: the list, slots, signing up and cancelling as Wilma's own page does.
{
  const { wilma, child } = await setup();
  const [listing] = await child.invitations.list();
  assert.equal(listing.message.wilmaId, 300);
  assert.equal(listing.status, "Applied");
  assert.equal(listing.extra, "14.10. klo 18:00");
  const invitation = await child.invitations.get(300);
  assert.equal(invitation.mustApply, true);
  assert.deepEqual(invitation.slots.map((s) => slotState(s, new Date(), invitation)), ["open", "full", "open"]);
  assert.equal(awaitingAnswer(invitation), true);
  assert.equal(await child.invitations.get(200), null, "an ordinary message isn't an invitation");

  await assert.rejects(() => answerInvitation(child, 300, "7002", "apply"), NotOfferedError, "a full slot isn't offered");
  await assert.rejects(() => answerInvitation(child, 300, "7001", "cancel"), NotOfferedError, "nothing to cancel yet");
  assert.equal(wilma.state.posts.length, 0);

  const applied = await answerInvitation(child, 300, "7001", "apply");
  assert.equal(applied.notice, "Tallennettu");
  assert.equal(applied.invitation.slots[0].selected, true);
  assert.equal(slotState(applied.invitation.slots[0]), "chosen");
  assert.equal(slotState(applied.invitation.slots[2], new Date(), applied.invitation), "taken");
  await assert.rejects(() => answerInvitation(child, 300, "7003", "apply"), NotOfferedError, "one time per family");
  assert.equal(wilma.state.posts.length, 1);
  assert.deepEqual(posts(wilma), [`${S}/messages/apply/ formkey=fk-3&apptId=7001&action=apply&appliedpersons=1&kortti=300`]);
  assert.equal(wilma.state.posts[0].headers["x-requested-with"], "XMLHttpRequest");

  const cancelled = await answerInvitation(child, 300, "7001", "cancel");
  assert.equal(cancelled.invitation.slots[0].selected, false);

  wilma.state.applyProblem = true;
  await assert.rejects(() => answerInvitation(child, 300, "7001", "apply"), (err) => err instanceof WriteRefusedError && /täynnä/.test(err.message));
  wilma.state.applyProblem = false;

  // "En osallistu" (won't attend), and taking it back: no slot, the message only.
  assert.equal(invitation.canDecline, true);
  assert.equal(invitation.declined, false);
  const before = wilma.state.posts.length;
  const declined = await declineInvitation(child, 300);
  assert.equal(declined.invitation.declined, true);
  assert.equal(awaitingAnswer(declined.invitation), false, "a no is an answer");
  assert.equal(posts(wilma)[before], `${S}/messages/apply formkey=fk-3&action=dismiss&kortti=300`);
  await assert.rejects(() => declineInvitation(child, 300), NotOfferedError, "already declined");
  const undone = await declineInvitation(child, 300, { undo: true });
  assert.equal(undone.invitation.declined, false);
  assert.equal(posts(wilma)[before + 1], `${S}/messages/apply formkey=fk-3&action=canceldismiss&kortti=300`);
  assert.equal(awaitingAnswer(undone.invitation), true);
}

// 5b. Wilma's slot words: a sign-up past its cancel time is "selected", and "En osallistu" is gone then.
{
  const slot = (State, extra = {}) => ({ EventID: 1, Start: "2026-10-21 17:30", End: "2026-10-21 18:30", EnrollEnd: "2099-01-01 00:00", CancelDate: "2099-01-01 00:00", State, CanDismissEvent: true, ...extra });
  const open = parseInvitation({ MustApply: true, Events: [slot("available")] });
  assert.equal(slotState(open.slots[0], new Date(), open), "open");
  assert.equal(open.canDecline, true);
  const mine = parseInvitation({ MustApply: true, Events: [slot("selected-cancellable")] });
  assert.equal(mine.slots[0].selected, true);
  assert.equal(slotState(mine.slots[0]), "chosen");
  assert.equal(mine.canDecline, true, "a cancellable sign-up can still be declined");
  const locked = parseInvitation({ MustApply: true, Events: [slot("selected")] });
  assert.equal(slotState(locked.slots[0]), "chosen-locked", "Wilma: Perumisaika on umpeutunut");
  assert.equal(locked.canDecline, false);
  const no = parseInvitation({ MustApply: true, Events: [slot("available", { IsDismissed: true })] });
  assert.equal(no.declined, true);
  assert.equal(awaitingAnswer(no), false);
  assert.equal(slotState(parseInvitation({ Events: [slot("full")] }).slots[0]), "full");
  assert.equal(slotState(parseInvitation({ Events: [slot("pending")] }).slots[0]), "not-yet");
}

// 6. Wilma ended the session between preparing and sending: nothing is sent, and no login happens.
{
  const { wilma, child } = await setup();
  const form = await prepareAbsenceReport(child);
  wilma.state.alive = "someone-else";
  const logins = wilma.state.requests.filter((r) => r === "POST /login").length;
  await assert.rejects(() => sendAbsenceReport(child, form, { reason: "83" }), SessionEndedError);
  assert.equal(wilma.state.posts.length, 0, "the stale session's post reached nothing");
  assert.equal(wilma.state.requests.filter((r) => r === "POST /login").length, logins, "no login to retry a write");
}

// 6b. The session changed between preparing and sending (another program's session continued): nothing is posted.
{
  const wilma = fakeWilma();
  const saved = { state: null };
  const shared = { load: async () => saved.state, save: async (state) => void (saved.state = state) };
  const app = await WilmaClient.login(profile, undefined, { transport: wilma.transport, relogin: false, sharedSession: shared });
  const child = app.forStudent("1234567");
  const form = await prepareMessage(child, { teacherId: 555 });
  await WilmaClient.login(profile, undefined, { transport: wilma.transport, sharedSession: shared }); // the CLI, elsewhere
  await assert.rejects(() => sendMessage(child, form, { subject: "Kysymys", text: "Hei" }), (err) => err instanceof SessionEndedError && /Prepare it again/.test(err.message));
  assert.equal(wilma.state.posts.length, 0, "the old form's key was never posted");
  const again = await prepareMessage(child, { teacherId: 555 });
  await sendMessage(child, again, { subject: "Kysymys", text: "Hei" });
  assert.equal(wilma.state.posts.length, 1, "prepared again under the continued session, sent once");
}

// 7. Writes are per child.
{
  const { account } = await setup();
  await assert.rejects(() => prepareAbsenceReport(account), /forStudent/);
}

// 8. The real forms (anonymised copies, 7 Oct 2026): what would be posted to Wilma, field by field.
{
  const real = (name) => readFileSync(new URL(`./fixtures/real/${name}`, import.meta.url), "utf8");
  const replyPage = real("thread-private.html");
  const R = /\/!(\d+)\//.exec(replyPage)[1];
  const messageId = Number(/compose\?replyid=(\d+)"/.exec(replyPage)[1]);
  const absencePage = real("absence-report.html");
  const teacherForm = real("compose-to-teacher.html");
  const teacherId = /name="r_teacher" value="(\d+)"/.exec(teacherForm)[1];
  const state = { sid: null, posts: [] };
  const reply = (status, { headers = {}, setCookies = [], body = "" } = {}) => ({ status, headers: new Headers(headers), setCookies, body });
  const transport = async (req) => {
    const url = new URL(req.url);
    const path = url.pathname + url.search;
    if (url.pathname === "/login" && req.method === "GET") return reply(200, { body: '<input type="hidden" name="SESSIONID" value="s">' });
    if (url.pathname === "/login") return reply(303, { headers: { location: "/" }, setCookies: ["Wilma2SID=r1; Path=/"] });
    if (req.method === "POST") {
      state.posts.push({ path, form: new URLSearchParams(req.body) });
      return reply(303, { headers: { location: `/!${R}/messages` } });
    }
    const pages = {
      [`/!${R}/attendance/report`]: absencePage,
      [`/!${R}/messages/${messageId}`]: replyPage,
      [`/!${R}/messages/compose?replyid=${messageId}`]: real("compose-reply.html"),
      [`/!${R}/messages/compose?r_teacher=${teacherId}`]: teacherForm,
      [`/!${R}/messages/compose`]: real("compose-new.html"),
      [`/!${R}/messages`]: "<html><body><h1>Viestit</h1></body></html>",
      [`/!${R}/`]: real("student-home.html"),
      [`/!${R}/messages/recipients`]: real("messages-recipients.html"),
    };
    if (path.startsWith(`/!${R}/messages/recipients/ownteachers/`)) return reply(200, { headers: { "content-type": "text/html" }, body: real("recipients-ownteachers.html") });
    if (pages[path]) return reply(200, { headers: { "content-type": "text/html" }, body: pages[path] });
    const json = (data) => reply(200, { headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
    if (path === `/!${R}/messages/${messageId}?format=json`) return json({ messages: [{ Id: messageId, Subject: "x", TimeStamp: "2026-10-01 09:00", ReplyList: [] }] });
    if (path === `/!${R}/messages/list/outbox`) return json({ Messages: [] });
    return reply(404);
  };
  const account = await WilmaClient.login({ baseUrl: "https://example.inschool.fi", username: "u", password: "p" }, undefined, { transport, relogin: false });
  const kid = account.forStudent(R);

  // The reads that feed new messages: the front page's supervisors and Wilma's recipient list (own teachers load separately).
  const details = await kid.student.get();
  assert.equal(details.supervisors.length, 3);
  const recipients = await kid.messages.recipients();
  assert.equal(recipients.length, 58 + 13);
  assert.equal(recipients.filter((r) => r.group === "Omat opettajat" && r.kind === "teacher").length, 13);

  const absence = await prepareAbsenceReport(kid);
  const day = /name="ReportDate" value="(\d+)"/.exec(absencePage)[1];
  assert.equal(absence.date, wilmaDayToIso(day));
  assert.equal(absence.dateLabel, "Tänään, 7.10.");
  assert.deepEqual(absence.reasons, [{ value: "83", label: "Terveydellinen syy" }], "the --- placeholder isn't a reason");
  assert.equal(absence.acceptsText, true);
  assert.deepEqual(
    [...absence.form.fields.map(([name]) => name), ...absence.form.buttons.map((b) => b.name)],
    ["formkey", "ReportDate", "type", "text", "savebtn"]
  );

  const answer = await prepareReply(kid, messageId);
  assert.equal(answer.mode, "private");
  assert.equal(answer.subject, /name="Subject"[^>]*value="([^"]+)"/.exec(real("compose-reply.html"))[1], "the \"VS: …\" subject Wilma filled in");
  assert.equal(answer.recipients.length, 1);
  const message = await prepareMessage(kid, { teacherId });
  assert.equal(message.recipients.length, 1);
  await assert.rejects(() => prepareMessage(kid, { composePath: `/!${R}/messages/compose` }), NotOfferedError, "a form without a recipient sends nothing");

  // What sendReply posts (its read-back can't run on these pages, so it reports "unconfirmed").
  await assert.rejects(() => sendReply(kid, answer, "Kiitos!\nTulemme."), WriteUnconfirmedError);
  const posted = state.posts.at(-1);
  assert.equal(posted?.path, `/!${R}/messages/compose`);
  assert.deepEqual([...posted.form.keys()], ["formkey", "wysiwyg", "replyid", "Subject", "r_teacher", "BodyText", "addsavebtn"], "no unchecked boxes, no draft, cancel or recipient-picker button");
  assert.equal(posted.form.get("wysiwyg"), "ckeditor");
  assert.equal(posted.form.get("BodyText"), "<p>Kiitos!<br />\nTulemme.</p>");
  assert.equal(posted.form.get("addsavebtn"), "Lähetä viesti");
  assert.equal(posted.form.get("replyid"), String(messageId));
}

console.log("write: all assertions passed");
