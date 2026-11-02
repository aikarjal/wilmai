/*
 * @wilm-ai/wilma-client/write: changing things in Wilma (answering messages,
 * writing to teachers, signing up for event invitations, reporting an
 * absence). Experimental. A separate entry point, so read-only tools such as
 * the wilma CLI and its MCP server don't carry it.
 *
 * Every write takes two steps, like Wilma's own pages. Prepare reads Wilma's
 * form and changes nothing. Send posts that form once, as Wilma's page would:
 * the fields Wilma filled in, plus what the parent wrote (as HTML where the
 * page has an editor, as Wilma's message forms do). A send is never repeated, and never retried after a login: when
 * Wilma has ended the session it fails with SessionEndedError and nothing was
 * sent. A form prepared under one session is never posted under another
 * (another program's session continued, or a new login): that also fails
 * with SessionEndedError, and preparing again gives a form for the session
 * now in use. Afterwards Wilma's answer is checked and, where Wilma shows it,
 * the result is read back:
 *  - WriteRefusedError: Wilma said no; nothing changed.
 *  - WriteUnconfirmedError: the form reached Wilma but the result didn't
 *    show; it may have gone through, so check Wilma before sending again.
 *
 * Writes are per child: pass client.forStudent(studentNumber).
 */
import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { WilmaClient } from "./client.js";
import { SessionEndedError, type WilmaSession } from "./session.js";
import { sessionOf } from "./internal.js";
import { pageErrors, pageFormkey, pageNotices, readForm, setField, wilmaPath, type WilmaForm } from "./parsers/forms.js";
import { slotState } from "./parsers/invitations.js";
import { composePath } from "./parsers/recipients.js";
export { composeToAll } from "./parsers/recipients.js";
import type { Invitation, MessageRecipient } from "./types.js";

export type { WilmaForm } from "./parsers/forms.js";
export { FormOutsideWilmaError } from "./parsers/forms.js";

/** Wilma doesn't offer this here right now (no answer form, absence reports closed…). Nothing was sent. */
export class NotOfferedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotOfferedError";
  }
}

/** Wilma turned the form down and said so. Nothing changed. */
export class WriteRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WriteRefusedError";
  }
}

/** The form reached Wilma, but the result didn't show. It may have gone through: check Wilma before sending again. */
export class WriteUnconfirmedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WriteUnconfirmedError";
  }
}

// ---------------------------------------------------------------------------
// Absence reports ("Ilmoita poissaolosta")

/**
 * Wilma's absence report form for one child. Seen 2026-10-06 (Helsinki):
 * `/attendance/report` posts to `/attendance/savereport` with formkey,
 * ReportDate (a day number Wilma fills in), type (the reason), text, savebtn.
 */
export interface AbsenceReportForm {
  readonly kind: "absence-report";
  /** The session the form belongs to (WilmaSession.sessionMark); not posted under another. */
  readonly sessionMark?: number;
  /** The day the report is for (YYYY-MM-DD). Wilma decides: today until 12:00, the next day after that. */
  readonly date: string | null;
  /** Wilma's words for that day, e.g. "Huomenna, 7.10.". */
  readonly dateLabel: string;
  /** The reasons this school offers (Helsinki offers one: "Terveydellinen syy"). */
  readonly reasons: { value: string; label: string }[];
  /** The form has a field for details. */
  readonly acceptsText: boolean;
  /** Wilma's instructions on the form page, if any. */
  readonly guidance: string;
  /** What send posts. */
  readonly form: WilmaForm;
  readonly reasonField: string;
  readonly textField: string | null;
  /** Notices already on the form page, so a new one after sending can be told apart. */
  readonly noticesBefore: string[];
}

/** Wilma's day numbers count days from 30 December 1899 (46302 = 7 October 2026). */
export function wilmaDayToIso(value: string): string | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 30000 || n > 80000) return null;
  return new Date(Date.UTC(1899, 11, 30) + n * 86_400_000).toISOString().slice(0, 10);
}

export async function prepareAbsenceReport(client: WilmaClient): Promise<AbsenceReportForm> {
  const session = sessionFor(client);
  const { $, url } = await page(session, "/attendance/report");
  const el = $("form")
    .filter((_, f) => /savereport/i.test($(f).attr("action") ?? ""))
    .first();
  if (!el.length) throw new NotOfferedError("Wilma doesn't offer an absence report for this child right now.");
  const form = readForm($, el, url);
  const select = form.selects[0];
  const reasons = (select?.options ?? [])
    .filter((o) => o.value && o.value !== "0" && !/^-*$/.test(o.label))
    .map(({ value, label }) => ({ value, label }));
  if (!select || !reasons.length) throw new NotOfferedError("Wilma's absence form has no reasons to choose from.");

  const reportDate = form.fields.find(([name]) => /^reportdate$/i.test(name))?.[1];
  const heading = $("h1, h2, h3, h4")
    .map((_, h) => clean($(h).text()))
    .get()
    .find((t) => /poissaolon ajankohta|frånvarons tidpunkt|time of absence/i.test(t));
  const guidance =
    $(".panel-body p, .alert, .info, .notification")
      .map((_, p) => clean($(p).text()))
      .get()
      .find((t) => /ilmoit|anmäl|report/i.test(t)) ?? "";
  const textField = el.find("input[type=text][name], textarea[name]").first().attr("name") ?? null;
  return {
    kind: "absence-report",
    sessionMark: session.sessionMark,
    date: reportDate ? wilmaDayToIso(reportDate) : null,
    dateLabel: heading ? heading.replace(/^[^:]*:\s*/, "") : "",
    reasons,
    acceptsText: textField !== null,
    guidance,
    form,
    reasonField: select.name,
    textField,
    noticesBefore: pageNotices($),
  };
}

/** Report the absence (once). Returns Wilma's confirmation. */
export async function sendAbsenceReport(
  client: WilmaClient,
  prepared: AbsenceReportForm,
  input: { reason: string; text?: string }
): Promise<{ notice: string }> {
  const session = sessionFor(client);
  if (prepared.kind !== "absence-report") throw new TypeError("Expected a form from prepareAbsenceReport()");
  if (!prepared.reasons.some((r) => r.value === input.reason)) throw new TypeError("Pick one of the form's reasons");
  let fields = setField(prepared.form.fields, prepared.reasonField, input.reason);
  if (prepared.textField) fields = setField(fields, prepared.textField, input.text ?? "");
  fields = withButton(fields, prepared.form, "savebtn");

  sameSession(session, prepared);
  const answer = await read(await session.submit(prepared.form.action, fields), "The report");
  const refused = pageErrors(answer.$);
  if (refused) throw new WriteRefusedError(`Wilma didn't take the report: ${refused}`);
  const notice = pageNotices(answer.$).find((n) => !prepared.noticesBefore.includes(n));
  if (notice) return { notice };
  throw new WriteUnconfirmedError("Wilma didn't confirm the report. Check the child's lesson notes in Wilma before reporting again.");
}

// ---------------------------------------------------------------------------
// Answering a message

/**
 * Wilma has two kinds of answer, and the message page says which applies
 * (approach from jmccrosky/wilma-mcp, MIT):
 *  - discussion: an open discussion ("avoin keskustelu") has a quick-reply
 *    form posting to `/messages/collatedreply/<id>`; everyone on the thread
 *    sees the answer;
 *  - private: an ordinary message links to a compose form with the sender
 *    and "VS:" subject filled in; the answer goes to the sender alone.
 */
export interface ReplyForm {
  readonly kind: "reply";
  /** The session the form belongs to (WilmaSession.sessionMark); not posted under another. */
  readonly sessionMark?: number;
  readonly messageId: number;
  readonly mode: "discussion" | "private";
  /** The subject Wilma filled in for a private answer ("VS: …"); null for a discussion. */
  readonly subject: string | null;
  /** Who a private answer goes to, as Wilma's form shows them; empty for a discussion. */
  readonly recipients: string[];
  /** What send posts. */
  readonly form: WilmaForm;
  readonly bodyField: string;
}

export async function prepareReply(client: WilmaClient, messageId: number): Promise<ReplyForm> {
  const session = sessionFor(client);
  const { $, url } = await page(session, `/messages/${messageId}`);

  const quick = $("form#quickreply-form").first();
  if (quick.length && quick.attr("action")) {
    const form = readForm($, quick, url);
    sendButton(form, "quickbtn");
    return { kind: "reply", sessionMark: session.sessionMark, messageId, mode: "discussion", subject: null, recipients: [], form, bodyField: form.textareas[0] ?? "bodytext" };
  }

  let href: string | undefined;
  $("a[href]").each((_, a) => {
    const candidate = $(a).attr("href") ?? "";
    // "Vastaa viestin lähettäjälle" links to compose?replyid=<id>; its neighbour "Välitä" adds &forward.
    if (href || candidate.startsWith("#") || /forward/i.test(candidate)) return;
    if (/^\s*(vastaa|svara|reply)\b/i.test($(a).text()) || /compose.*(answer|reply|replyid)/i.test(candidate)) href = candidate;
  });
  if (!href) throw new NotOfferedError("Wilma doesn't offer an answer to this message.");
  const compose = await composeForm(session, wilmaPath(href, url));
  return {
    kind: "reply",
    sessionMark: session.sessionMark,
    messageId,
    mode: "private",
    subject: compose.subject,
    recipients: compose.recipients,
    form: compose.form,
    bodyField: compose.bodyField,
  };
}

/** Send the answer (once). */
export async function sendReply(client: WilmaClient, prepared: ReplyForm, text: string): Promise<void> {
  const session = sessionFor(client);
  if (prepared.kind !== "reply") throw new TypeError("Expected a form from prepareReply()");
  if (!text.trim()) throw new TypeError("The answer is empty");
  const before = await sentState(client, prepared.messageId);
  const body = editorBody(prepared.form, text);
  const fields = withButton(setField(prepared.form.fields, prepared.bodyField, body), prepared.form, prepared.mode === "discussion" ? "quickbtn" : "addsavebtn");
  sameSession(session, prepared);
  const answer = await read(await session.submit(prepared.form.action, fields), "The answer");
  const refused = pageErrors(answer.$);
  if (refused) throw new WriteRefusedError(`Wilma didn't send the answer: ${refused}`);
  if (await wasSent(client, before, { messageId: prepared.messageId, subject: prepared.subject, text })) return;
  throw new WriteUnconfirmedError("Wilma didn't show the answer as sent. Check the thread in Wilma before answering again.");
}

// ---------------------------------------------------------------------------
// Writing a new message

/**
 * A new message. Wilma's compose page with the recipient filled in
 * (`/messages/compose?r_teacher=<id>`, or a recipient's link from
 * messages.recipients() or student.get()) has the fields formkey, wysiwyg
 * ("ckeditor": the body is HTML), the recipients as r_… fields, Subject,
 * BodyText, ShowRecipients and CollatedReplies; it's sent with addsavebtn,
 * never draftbtn, cancelbtn or select_recipients.
 */
export interface MessageForm {
  readonly kind: "message";
  /** The session the form belongs to (WilmaSession.sessionMark); not posted under another. */
  readonly sessionMark?: number;
  /** Who it goes to, as Wilma's form shows them. */
  readonly recipients: string[];
  /** What send posts. */
  readonly form: WilmaForm;
  readonly subjectField: string;
  readonly bodyField: string;
  /**
   * Whether the recipients see each other's replies (Wilma's CollatedReplies box, which makes the thread an open
   * discussion), as Wilma's form has it; null when the form has no such box.
   */
  readonly collatedReplies?: boolean | null;
}

const COLLATED = "CollatedReplies";

export async function prepareMessage(client: WilmaClient, to: { teacherId: string | number } | Pick<MessageRecipient, "composePath">): Promise<MessageForm> {
  const session = sessionFor(client);
  let path: string;
  if ("composePath" in to) {
    // A link Wilma gave, kept to its own compose page and this child.
    const own = composePath(to.composePath, `${client.origin}/`);
    if (!own || (own.startsWith("/!") && !own.startsWith(session.getPrefixedPath("/")))) throw new TypeError("Not a compose link for this child");
    path = own;
  } else {
    const id = String(to.teacherId);
    if (!/^\d+$/.test(id)) throw new TypeError("A teacher id is a number");
    path = `/messages/compose?r_teacher=${id}`;
  }
  const compose = await composeForm(session, path);
  if (!compose.subjectField) throw new NotOfferedError("Wilma's message form has no subject field.");
  const collated = compose.form.checkboxes?.find((c) => c.name === COLLATED);
  return {
    kind: "message",
    sessionMark: session.sessionMark,
    recipients: compose.recipients,
    form: compose.form,
    subjectField: compose.subjectField,
    bodyField: compose.bodyField,
    collatedReplies: collated ? collated.checked : null,
  };
}

/**
 * Send the message (once). `collatedReplies` ticks or clears Wilma's "recipients see each other's replies" box
 * when the form has one; left out, the box stays as Wilma's form has it.
 */
export async function sendMessage(client: WilmaClient, prepared: MessageForm, input: { subject: string; text: string; collatedReplies?: boolean }): Promise<void> {
  const session = sessionFor(client);
  if (prepared.kind !== "message") throw new TypeError("Expected a form from prepareMessage()");
  if (!input.subject.trim()) throw new TypeError("The subject is empty");
  if (!input.text.trim()) throw new TypeError("The message is empty");
  const before = await sentState(client, null);
  let fields = prepared.form.fields;
  const box = prepared.form.checkboxes?.find((c) => c.name === COLLATED);
  if (box && input.collatedReplies !== undefined) {
    fields = input.collatedReplies ? setField(fields, box.name, box.value) : fields.filter(([name]) => name !== box.name);
  }
  fields = setField(fields, prepared.subjectField, input.subject);
  fields = withButton(setField(fields, prepared.bodyField, editorBody(prepared.form, input.text)), prepared.form, "addsavebtn");
  sameSession(session, prepared);
  const answer = await read(await session.submit(prepared.form.action, fields), "The message");
  const refused = pageErrors(answer.$);
  if (refused) throw new WriteRefusedError(`Wilma didn't send the message: ${refused}`);
  if (await wasSent(client, before, { messageId: null, subject: input.subject, text: input.text })) return;
  throw new WriteUnconfirmedError("Wilma didn't show the message as sent. Check sent messages in Wilma before sending again.");
}

// ---------------------------------------------------------------------------
// Event invitations

/**
 * Sign up for an invitation's time slot, or cancel the sign-up. This is what
 * Wilma's own page sends (appointments.js): POST `/messages/apply/` with the
 * page's formkey, apptId (the slot), action, appliedpersons and kortti (the
 * message), answered with JSON {resultmessage: {message, problem}}. Checks
 * the slot's state first, like Wilma's page, and reads the invitation back
 * afterwards. Opening the invitation marks it read, as in Wilma.
 */
export async function answerInvitation(
  client: WilmaClient,
  messageId: number,
  slotId: string,
  action: "apply" | "cancel",
  opts: { persons?: number } = {}
): Promise<{ notice: string; invitation: Invitation }> {
  const session = sessionFor(client);
  const invitation = (await client.messages.get(messageId)).invitation;
  if (!invitation) throw new NotOfferedError("This message isn't an event invitation.");
  const slot = invitation.slots.find((s) => s.id === slotId);
  if (!slot) throw new NotOfferedError("The invitation has no such time slot.");
  const state = slotState(slot, new Date(), invitation);
  if (action === "apply" && state !== "open") throw new NotOfferedError(`Signing up isn't open for this time (${state}).`);
  if (action === "cancel" && state !== "chosen") throw new NotOfferedError(`This sign-up can't be cancelled (${state}).`);

  const { $ } = await page(session, `/messages/${messageId}`);
  const mark = session.sessionMark;
  const formkey = pageFormkey($);
  if (!formkey) throw new NotOfferedError("Wilma's invitation page has no form key.");
  const fields: [string, string][] = [
    ["formkey", formkey],
    ["apptId", slotId],
    ["action", action],
    ["appliedpersons", String(opts.persons ?? 1)],
    ["kortti", String(messageId)],
  ];
  sameSession(session, { sessionMark: mark });
  const resp = await session.submit("/messages/apply/", fields, {
    headers: { "X-Requested-With": "XMLHttpRequest", Accept: "application/json, text/javascript, */*; q=0.01" },
  });
  const answer = await read(resp, "The sign-up");
  let result: { resultmessage?: { message?: unknown; problem?: unknown } };
  try {
    result = JSON.parse(answer.html);
  } catch {
    throw new WriteUnconfirmedError("Wilma's answer wasn't what its own page expects. Check the invitation in Wilma.");
  }
  const notice = typeof result.resultmessage?.message === "string" ? clean(result.resultmessage.message) : "";
  if (result.resultmessage?.problem === "problem") throw new WriteRefusedError(notice || "Wilma refused the change.");

  const after = (await client.messages.get(messageId)).invitation;
  const chosen = after?.slots.find((s) => s.id === slotId)?.selected;
  if (!after || chosen !== (action === "apply")) {
    throw new WriteUnconfirmedError("The invitation doesn't show the change yet. Check it in Wilma before trying again.");
  }
  return { notice, invitation: after };
}

/**
 * Say the family won't attend ("En osallistu"), or take that back (`undo`).
 * This is what Wilma's own page sends (appointments.js, dismissAppt): POST
 * `/messages/apply` with the page's formkey, action "dismiss" (or
 * "canceldismiss") and kortti (the message), no slot. Declining also cancels
 * a sign-up that can still be cancelled, as Wilma's page warns. Reads the
 * invitation back afterwards.
 */
export async function declineInvitation(
  client: WilmaClient,
  messageId: number,
  opts: { undo?: boolean } = {}
): Promise<{ notice: string; invitation: Invitation }> {
  const session = sessionFor(client);
  const invitation = (await client.messages.get(messageId)).invitation;
  if (!invitation) throw new NotOfferedError("This message isn't an event invitation.");
  if (!invitation.canDecline) throw new NotOfferedError("Wilma doesn't offer \"won't attend\" for this invitation.");
  if (opts.undo ? !invitation.declined : invitation.declined) {
    throw new NotOfferedError(opts.undo ? "The family hasn't said it won't attend." : "The family has already said it won't attend.");
  }

  const { $ } = await page(session, `/messages/${messageId}`);
  const mark = session.sessionMark;
  const formkey = pageFormkey($);
  if (!formkey) throw new NotOfferedError("Wilma's invitation page has no form key.");
  const fields: [string, string][] = [
    ["formkey", formkey],
    ["action", opts.undo ? "canceldismiss" : "dismiss"],
    ["kortti", String(messageId)],
  ];
  sameSession(session, { sessionMark: mark });
  const resp = await session.submit("/messages/apply", fields, {
    headers: { "X-Requested-With": "XMLHttpRequest", Accept: "application/json, text/javascript, */*; q=0.01" },
  });
  const answer = await read(resp, "The answer");
  let result: { resultmessage?: { message?: unknown; problem?: unknown } };
  try {
    result = JSON.parse(answer.html);
  } catch {
    throw new WriteUnconfirmedError("Wilma's answer wasn't what its own page expects. Check the invitation in Wilma.");
  }
  const notice = typeof result.resultmessage?.message === "string" ? clean(result.resultmessage.message) : "";
  if (result.resultmessage?.problem === "problem") throw new WriteRefusedError(notice || "Wilma refused the change.");

  const after = (await client.messages.get(messageId)).invitation;
  if (!after || after.declined !== !opts.undo) {
    throw new WriteUnconfirmedError("The invitation doesn't show the change yet. Check it in Wilma before trying again.");
  }
  return { notice, invitation: after };
}

// ---------------------------------------------------------------------------

/** A form's key belongs to the session it was read in: refuse to post it under another one. */
function sameSession(session: WilmaSession, prepared: { sessionMark?: number }): void {
  if (prepared.sessionMark !== undefined && prepared.sessionMark !== session.sessionMark) {
    throw new SessionEndedError("The Wilma session changed after the form was prepared; nothing was sent. Prepare it again.");
  }
}

function sessionFor(client: WilmaClient): WilmaSession {
  const session = sessionOf.get(client);
  if (!session) throw new TypeError("Expected a WilmaClient");
  if (session.getPrefixedPath("/") === "/") throw new TypeError("Writes are per child: pass client.forStudent(studentNumber)");
  return session;
}

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

async function page(session: WilmaSession, path: string): Promise<{ $: CheerioAPI; url: string }> {
  const resp = await session.get(path);
  const html = await resp.text();
  return { $: cheerio.load(html), url: resp.url };
}

/** Wilma's answer to a sent form. 5xx: it may have been saved before failing. */
async function read(resp: Response, what: string): Promise<{ $: CheerioAPI; html: string; url: string }> {
  const html = await resp.text();
  if (resp.status >= 500) {
    throw new WriteUnconfirmedError(`Wilma answered HTTP ${resp.status}. ${what} may or may not have gone through: check Wilma before trying again.`);
  }
  if (resp.status >= 400) throw new WriteRefusedError(`Wilma answered HTTP ${resp.status}; nothing was changed.`);
  return { $: cheerio.load(html), html, url: resp.url };
}

/** Wilma's compose form (new message or private answer): the form with a text area, never logout. */
async function composeForm(
  session: WilmaSession,
  path: string
): Promise<{ form: WilmaForm; recipients: string[]; bodyField: string; subjectField: string | null; subject: string | null }> {
  const { $, url } = await page(session, path);
  const el = $("form")
    .filter((_, f) => !/logout/i.test($(f).attr("action") ?? "") && $(f).find("textarea[name]").length > 0)
    .first();
  if (!el.length) throw new NotOfferedError("Wilma's message form wasn't where it usually is.");
  const form = readForm($, el, url);
  // A recipient Wilma filled in (r_teacher, r_groupteachers…): without one nothing would be delivered.
  if (!form.fields.some(([name]) => /^[rs]_/.test(name))) {
    throw new NotOfferedError("Wilma's message form has no recipient, so nothing would be delivered.");
  }
  sendButton(form, "addsavebtn");
  const subjectField = form.fields.find(([name]) => /^subject$/i.test(name))?.[0] ?? null;
  return {
    form,
    recipients: el
      .find(".recipient-item")
      .map((_, item) => clean($(item).children("span").first().text() || $(item).text()))
      .get()
      .filter(Boolean),
    bodyField: form.textareas.find((name) => /body/i.test(name)) ?? form.textareas[0],
    subjectField,
    subject: subjectField ? (form.fields.find(([name]) => name === subjectField)?.[1] ?? null) : null,
  };
}

/**
 * The form's send button, by Wilma's name for it. Never another one: a form
 * also has buttons that save a draft, cancel, or open the recipient picker.
 */
function sendButton(form: WilmaForm, name: string): { name: string; value: string } {
  const button = form.buttons.find((b) => b.name === name);
  if (!button) throw new NotOfferedError("Wilma's form has no send button where it usually is; nothing was sent.");
  return button;
}

function withButton(fields: [string, string][], form: WilmaForm, name: string): [string, string][] {
  const button = sendButton(form, name);
  return [...fields, [button.name, button.value]];
}

/**
 * What goes in the body field. Wilma's message forms say `wysiwyg=ckeditor`:
 * its editor sends HTML, so plain text becomes paragraphs (blank lines) and
 * line breaks, with <, > and & escaped. Other forms get the text as is.
 */
export function editorBody(form: WilmaForm, text: string): string {
  const mode = form.fields.find(([name]) => name.toLowerCase() === "wysiwyg")?.[1] ?? "";
  if (!mode || /^(0|false|no|plain|text)$/i.test(mode)) return text;
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return text
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => `<p>${escape(paragraph.trim()).replace(/\n/g, "<br />\n")}</p>`)
    .join("\n");
}

interface SentState {
  outbox: Set<number>;
  replies: number;
}

/** What's sent so far: outbox ids, and the thread's answers when there is a thread. */
async function sentState(client: WilmaClient, messageId: number | null): Promise<SentState> {
  const [outbox, thread] = await Promise.all([
    outboxIds(client),
    messageId === null ? null : client.messages.get(messageId),
  ]);
  return { outbox, replies: thread?.replies?.length ?? 0 };
}

async function outboxIds(client: WilmaClient): Promise<Set<number>> {
  return new Set((await client.messages.list("outbox")).map((m) => m.wilmaId));
}

/** Did it arrive: a new answer with this text in the thread, or a new message with this subject in sent messages? */
async function wasSent(
  client: WilmaClient,
  before: SentState,
  sent: { messageId: number | null; subject: string | null; text: string }
): Promise<boolean> {
  const opening = clean(sent.text).slice(0, 40);
  if (sent.messageId !== null) {
    const replies = (await client.messages.get(sent.messageId)).replies ?? [];
    if (replies.slice(before.replies).some((r) => clean(r.content).includes(opening))) return true;
  }
  const outbox = await client.messages.list("outbox");
  return outbox.some((m) => !before.outbox.has(m.wilmaId) && (!sent.subject || clean(m.subject) === clean(sent.subject)));
}
