/*
 * Writing a new message in Wilma: the child it's about (chosen once, then
 * fixed: recipients and the form are that child's), who it goes to, then the
 * message. Recipients come from Wilma's own lists (the class teacher and
 * supervisors on the child's front page, and Wilma's recipient list), the
 * form is Wilma's, and the message is sent once, after a confirmation.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { MessageRecipient } from "@wilma-client/src/core";
import type { MessageForm } from "@wilma-client/src/write";
import { accountStorageKey, useApp } from "../data/store";
import { isDemo, isSessionEnded, loadContacts, messageApi, preparedAgain, signInAgain, SESSION_CHANGED_NOTE } from "../data/engine";
import { draftTo, openDraft, readDrafts, saveDraft, writeDrafts, type Drafts } from "../data/drafts";
import { loginOfChild } from "../data/logins";
import type { Contacts } from "../data/model";
import { Icon, Tab } from "./bits";
import { InFinnish } from "./InFinnish";
import { currentOutgoing, outgoingAvailable, readOutgoing, type Outgoing } from "../ai/outgoing";
import { go, hrefFor, useChildFilter } from "./shared";
import { showToast } from "./Toast";
import { language, plural, t, tx } from "../i18n";

/* Wilma's words in English (Wilma's own word when there's no match, and always in Finnish). */
const GROUPS: [RegExp, string, string][] = [
  [/^omat opettajat$/i, "Own teachers", "Egna lärare"],
  [/^opettajat$/i, "Teachers", "Lärare"],
  [/^henkilökunta$/i, "Staff", "Personal"],
  [/^opiskelija$/i, "Your child", "Ditt barn"],
  [/^muut huoltajat$/i, "Other guardian", "Andra vårdnadshavare"],
];
const ROLES: [RegExp, string, string][] = [
  [/ryhmänohjaaja|luokanvalvoja/i, "Class teacher", "Klassföreståndare"],
  [/muut ohjaajat/i, "Supervisor", "Handledare"],
];
/** Wilma's Finnish label in English or Swedish, when the app is (else as it is). */
const english = (table: [RegExp, string, string][], text: string) => {
  if (language() === "fi") return text;
  const row = table.find(([re]) => re.test(text));
  return row ? (language() === "sv" ? row[2] : row[1]) : text;
};

/** A message group link (to all teachers or all supervisors): in English or Swedish, what it means; in Finnish, Wilma's own words. */
function groupLinkLabel(name: string, first: string | null): string {
  if (language() === "fi") return name;
  const sv = language() === "sv";
  if (/kaikille ohjaajille/i.test(name)) return sv ? "Alla handledare" : "All supervisors";
  if (/kaikille opettajille/i.test(name)) return first ? (sv ? `Alla lärare som ${first} har` : `All of ${first}'s teachers`) : sv ? "Alla ditt barns lärare" : "All of your child's teachers";
  return name;
}

/** "Korhonen Jussi (KOJ)" → "KOJ": the teacher code the timetable uses too. */
const codeOf = (name: string) => /\(([^)]+)\)\s*$/.exec(name)?.[1]?.toUpperCase() ?? null;
/** The teacher a compose link writes to (one r_teacher), for matching lists that name people differently. */
const teacherIdOf = (path: string) => {
  const ids = new URL(path, "https://wilma.invalid").searchParams.getAll("r_teacher");
  return ids.length === 1 ? ids[0] : null;
};

type Stage =
  | { kind: "choosing" }
  | { kind: "preparing" }
  | { kind: "ready"; form: MessageForm }
  | { kind: "confirm"; form: MessageForm; note?: string }
  | { kind: "sending"; form: MessageForm }
  | { kind: "sent"; to: string }
  | { kind: "error"; message: string; form?: MessageForm; ended?: boolean };

/**
 * `initialTeacher`: a teacher code ("KOJ") or a name ("Jussi Korhonen") to write to; `initialSubject`: a subject
 * to start with (from a note, say), used unless there's already a draft with text to that teacher.
 */
/** An error for the composer: Wilma ending the session says so in words, with "Sign in again" (the draft stays). */
function errorStage(err: unknown, form?: MessageForm): Stage {
  if (isSessionEnded(err)) return { kind: "error", ended: true, form, message: t("Wilma ended the session. Your draft is saved on this device; sign in again to send it.") };
  return { kind: "error", form, message: err instanceof Error ? err.message : String(err) };
}

export function NewMessage({ initialChild, initialTeacher, initialSubject }: { initialChild: string | null; initialTeacher?: string | null; initialSubject?: string | null }) {
  const snap = useApp((s) => s.snapshot)!;
  const { selected } = useChildFilter();
  const known = (n: string | null | undefined) => (n && snap.children.some((c) => c.number === n) ? n : null);
  // Started from a child's card, with one child showing, or with only one child: that child. Otherwise ask first.
  const [child, setChild] = useState<string | null>(
    () => known(initialChild) ?? (selected.length === 1 ? known(selected[0]) : null) ?? (snap.children.length === 1 ? snap.children[0].number : null)
  );
  if (!child) {
    return (
      <div className="reader compose-page">
        <a className="btn btn-quiet btn-sm back-link" href={hrefFor("inbox")}>
          <Icon name="back" /> {t("Messages")}
        </a>
        <h2>{t("New message")}</h2>
        <p className="lede-small">{t("Who is it about?")}</p>
        <div className="child-pick">
          {snap.children.map((c) => (
            <button key={c.number} className="child-choice" onClick={() => setChild(c.number)}>
              <Tab child={c} />
              <span>{c.name}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }
  return <Writer child={child} initialTeacher={initialTeacher ?? null} initialSubject={initialSubject ?? null} />;
}

function Writer({ child, initialTeacher, initialSubject }: { child: string; initialTeacher: string | null; initialSubject: string | null }) {
  const snap = useApp((s) => s.snapshot)!;
  const kid = snap.children.find((c) => c.number === child);
  const lessons = useApp((s) => s.snapshot?.perChild[child]?.lessons);
  const [contacts, setContacts] = useState<Contacts | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recipient, setRecipient] = useState<MessageRecipient | null>(null);
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<Stage>({ kind: "choosing" });
  const draftKey = accountStorageKey(`newmsg.${child}`);
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  // Until the parent writes, the words are what the app filled in (or a saved draft as it was): nothing to save.
  const [written, setWritten] = useState(false);
  // The saved draft the words opened from, so it moves with them if the parent sends them to someone else.
  const draftFrom = useRef<string | null>(null);
  // Written in the parent's language, sent in Finnish (InFinnish.tsx): the Finnish is kept with the draft.
  const canFinnish = useApp((s) => outgoingAvailable(s.settings, language()));
  const [inFinnish, setInFinnish] = useState(true);
  const [fi, setFi] = useState<Outgoing | null>(null);
  const finnish = canFinnish && inFinnish;
  const ready = finnish ? currentOutgoing(fi, subject, text) : null;
  // What goes to Wilma: the Finnish the parent saw, or what they wrote.
  const outgoing = finnish ? { subject: ready?.subject.trim() ?? "", text: ready?.text ?? "" } : { subject: subject.trim(), text };
  const subjectRef = useRef<HTMLInputElement>(null);
  const demo = isDemo();
  const stored = () => readDrafts(localStorage.getItem(draftKey));
  const store = (drafts: Drafts) => {
    const raw = writeDrafts(drafts);
    if (raw) localStorage.setItem(draftKey, raw);
    else localStorage.removeItem(draftKey);
  };

  // The child's contacts.
  useEffect(() => {
    let live = true;
    loadContacts(child)
      .then((c) => live && setContacts(c))
      .catch((err) => live && setLoadError(err instanceof Error ? err.message : String(err)));
    return () => {
      live = false;
    };
  }, [child]);

  // What the parent writes is their draft to whoever it's to.
  useEffect(() => {
    if (!written || !recipient) return;
    const to = draftTo(recipient.composePath);
    store(saveDraft(stored(), to, { subject, text, finnish: fi ?? undefined }, draftFrom.current));
    draftFrom.current = subject || text ? to : null;
  }, [subject, text, fi, written, recipient, draftKey]);

  /** The words gone, and their draft (sent or thrown away). */
  const forget = () => {
    if (recipient) store(saveDraft(stored(), draftTo(recipient.composePath), { subject: "", text: "" }, draftFrom.current));
    draftFrom.current = null;
    setWritten(false);
    setSubject("");
    setText("");
    setFi(null);
  };

  // What each teacher teaches this child, from the timetable's teacher codes.
  const subjects = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const l of lessons ?? []) {
      if (!l.teacherCode) continue;
      const code = l.teacherCode.toUpperCase();
      if (!map.has(code)) map.set(code, new Set());
      map.get(code)!.add(l.subject);
    }
    return map;
  }, [lessons]);
  // The front page names supervisors without a code; the recipient list has it, under the same teacher id.
  const codeById = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of contacts?.recipients ?? []) {
      const id = teacherIdOf(r.composePath);
      const code = codeOf(r.name);
      if (id && code) map.set(id, code);
    }
    return map;
  }, [contacts]);
  const teaches = (r: MessageRecipient) => {
    const id = teacherIdOf(r.composePath);
    const code = codeOf(r.name) ?? (id ? codeById.get(id) : undefined);
    const list = code ? subjects.get(code) : undefined;
    return list ? [...list].join(", ") : null;
  };

  // Opened for one teacher (from a lesson in the week): pick them once the lists are in; otherwise search for them.
  const teacherPicked = useRef(false);
  useEffect(() => {
    if (!initialTeacher || !contacts || teacherPicked.current) return;
    teacherPicked.current = true;
    const code = initialTeacher.toUpperCase();
    // A code ("KOJ") as the timetable gives it, else a name in either order ("Jussi Korhonen", "Korhonen Jussi").
    const words = initialTeacher.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
    const byCode = contacts.recipients.filter((r) => r.kind === "teacher" && codeOf(r.name) === code);
    const byName = byCode.length || words.length < 2 ? [] : contacts.recipients.filter((r) => r.kind === "teacher" && words.every((w) => r.name.toLowerCase().includes(w)));
    const match = byCode.length ? byCode : byName;
    const own = match.find((r) => /^omat opettajat$/i.test(r.group)) ?? match[0];
    if (own) void choose(own);
    else setQuery(words.length > 1 ? words[words.length - 1] : initialTeacher);
  }, [contacts, initialTeacher]);

  const choose = async (r: MessageRecipient) => {
    setRecipient(r);
    if (!written) {
      // Nothing written yet: the draft to this person, if there is one, else the subject the parent came with.
      const opened = openDraft(stored(), draftTo(r.composePath), initialSubject, !initialTeacher);
      draftFrom.current = opened.from;
      setSubject(opened.words.subject);
      setText(opened.words.text);
      setFi(readOutgoing(opened.words.finnish));
    }
    setStage({ kind: "preparing" });
    try {
      const form = await messageApi(child).prepare(r);
      setStage({ kind: "ready", form });
      setTimeout(() => subjectRef.current?.focus(), 0);
    } catch (err) {
      setStage(errorStage(err));
    }
  };

  const send = async (form: MessageForm) => {
    setStage({ kind: "sending", form });
    try {
      await messageApi(child).send(form, outgoing.subject, outgoing.text);
      setStage({ kind: "sent", to: form.recipients.join(", ") || recipient?.name || "" });
      forget();
    } catch (err) {
      try {
        const fresh = recipient ? await preparedAgain(err, () => messageApi(child).prepare(recipient), loginOfChild(child)) : null;
        if (fresh) setStage({ kind: "confirm", form: fresh, note: SESSION_CHANGED_NOTE });
        else if (!recipient) throw err;
      } catch (again) {
        setStage(errorStage(isSessionEnded(again) ? again : err, form));
      }
    }
  };

  /** Throw the draft away (on this device), with Undo for a slip. */
  const discard = () => {
    const kept = localStorage.getItem(draftKey);
    const back = location.hash;
    forget();
    go("inbox");
    showToast(t("Draft discarded"), () => {
      if (kept) localStorage.setItem(draftKey, kept);
      location.hash = back;
    });
  };

  const head = (
    <>
      <a className="btn btn-quiet btn-sm back-link" href={hrefFor("inbox")}>
        <Icon name="back" /> {t("Messages")}
      </a>
      <h2>{t("New message")}</h2>
      {snap.children.length > 1 && kid ? (
        <div className="about-child">
          <span className="help">{t("About")}</span>
          <Tab child={kid} full />
          {contacts?.details?.className ? <span className="help">{t("class {name}", { name: contacts.details.className })}</span> : null}
        </div>
      ) : null}
    </>
  );

  if (stage.kind === "sent") {
    return (
      <div className="reader compose-page">
        {head}
        <div className="notice ok">
          {demo
            ? t("Sample family: nothing was sent to {to}.", { to: stage.to })
            : tx("Sent to {to}. It's in your sent messages in Wilma.", { to: <b>{stage.to}</b> })}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button className="btn" onClick={() => (setRecipient(null), setStage({ kind: "choosing" }))}>
            {t("Write another")}
          </button>
          <a className="btn btn-quiet" href={hrefFor("inbox")} style={{ textDecoration: "none" }}>
            {t("Back to Messages")}
          </a>
        </div>
      </div>
    );
  }

  if (!recipient) {
    const drafted = new Set(Object.keys(stored()));
    return (
      <div className="reader compose-page">
        {head}
        <Picker
          contacts={contacts}
          error={loadError}
          first={kid?.first ?? null}
          query={query}
          setQuery={setQuery}
          teaches={teaches}
          drafted={(r) => drafted.has(draftTo(r.composePath))}
          onPick={(r) => void choose(r)}
        />
      </div>
    );
  }

  const form = "form" in stage ? stage.form : undefined;
  const to = form?.recipients.length ? form.recipients.join(", ") : recipient.name;
  const saved = (written || draftFrom.current !== null) && Boolean(subject || text);
  return (
    <div className="reader compose-page">
      {head}
      <div className="to-line">
        <span className="help">{t("To")}</span>
        <b>{to}</b>
        {teaches(recipient) ? <span className="chip">{teaches(recipient)}</span> : null}
        <button className="btn btn-quiet btn-sm" onClick={() => (setRecipient(null), setStage({ kind: "choosing" }))} disabled={stage.kind === "sending"}>
          {t("Change")}
        </button>
      </div>
      <div className="composer" style={{ marginTop: 0 }}>
        {stage.kind === "preparing" ? (
          <div className="composer-head">
            <span className="chip">{t("Opening Wilma's message form…")}</span>
          </div>
        ) : null}
        <input
          ref={subjectRef}
          className="subject"
          value={subject}
          onChange={(e) => (setSubject(e.target.value), setWritten(true))}
          placeholder={t("Subject")}
          aria-label={t("Subject")}
          disabled={stage.kind === "sending"}
        />
        <textarea value={text} onChange={(e) => (setText(e.target.value), setWritten(true))} placeholder={t("Write your message")} aria-label={t("Your message")} disabled={stage.kind === "sending"} />
        {canFinnish ? <InFinnish on={inFinnish} setOn={setInFinnish} subject={subject} text={text} value={fi} onChange={(v) => (setFi(v), setWritten(true))} disabled={stage.kind === "sending" || stage.kind === "confirm"} /> : null}
        {stage.kind === "error" ? (
          <div className="notice err composer-error">
            <span>{stage.message}</span>
            {stage.ended ? (
              <button type="button" className="btn btn-sm" onClick={() => signInAgain(loginOfChild(child))}>
                {t("Sign in again")}
              </button>
            ) : null}
          </div>
        ) : null}
        {stage.kind === "confirm" || stage.kind === "sending" ? (
          <div className="confirm">
            {finnish && ready ? <blockquote className="outgoing-preview" lang="fi">{ready.text}</blockquote> : null}
            <span>
              {stage.kind === "confirm" && stage.note ? <>{t(stage.note)} </> : null}
              {tx(demo ? "Send “{subject}” to {to} in Wilma (sample family: nothing is really sent)?" : "Send “{subject}” to {to} in Wilma?", {
                subject: outgoing.subject,
                to: <b>{to}</b>,
              })}
            </span>
            <span style={{ flex: 1 }} />
            <button className="btn btn-sm" onClick={() => setStage({ kind: "ready", form: stage.form })} disabled={stage.kind === "sending"}>
              {t("Keep editing")}
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => void send(stage.form)} disabled={stage.kind === "sending"}>
              {stage.kind === "sending" ? t("Sending…") : t("Send now")}
            </button>
          </div>
        ) : (
          <div className="composer-foot">
            <span className="hint">{saved ? t("Draft saved on this device") : t("Drafts stay on this device until you send")}</span>
            {saved ? (
              <button type="button" className="btn btn-quiet btn-sm" onClick={discard}>
                {t("Discard draft")}
              </button>
            ) : null}
            <button
              className="btn btn-primary btn-sm"
              disabled={!form || !subject.trim() || !text.trim() || (finnish && !ready)}
              onClick={() => form && setStage({ kind: "confirm", form })}
            >
              {t("Send…")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Picker({
  contacts,
  error,
  first,
  query,
  setQuery,
  teaches,
  drafted,
  onPick,
}: {
  contacts: Contacts | null;
  error: string | null;
  first: string | null;
  query: string;
  setQuery: (q: string) => void;
  teaches: (r: MessageRecipient) => string | null;
  drafted: (r: MessageRecipient) => boolean;
  onPick: (r: MessageRecipient) => void;
}) {
  if (error) return <div className="notice err">{error}</div>;
  if (!contacts) return <p className="waiting">{t("Reading who you can write to from Wilma…")}</p>;

  const details = contacts.details;
  const own = contacts.recipients.filter((r) => r.kind === "teacher" && /^omat opettajat$/i.test(r.group));
  const guardians = contacts.recipients.filter((r) => r.kind === "guardian");
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const found = words.length
    ? contacts.recipients
        .filter((r) => r.kind !== "group")
        .filter((r) => {
          const hay = `${r.name} ${teaches(r) ?? ""} ${english(GROUPS, r.group)} ${r.school ?? ""}`.toLowerCase();
          return words.every((w) => hay.includes(w));
        })
        // The same person can be listed as an own teacher and in the school list: show them once.
        .filter((r, i, all) => all.findIndex((o) => o.name === r.name) === i)
        .slice(0, 40)
    : [];

  // A draft to someone opens only when writing to them, so the list says who has one.
  const person = (r: MessageRecipient, note: string | null) => {
    const shown = drafted(r) ? [t("Draft"), note].filter(Boolean).join(" · ") : note;
    return (
      <button key={`${r.group}|${r.composePath}`} className="person" onClick={() => onPick(r)}>
        <span>{r.name}</span>
        {shown ? <small>{shown}</small> : null}
      </button>
    );
  };

  return (
    <>
      <label className="search picker-search">
        <Icon name="search" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Find a teacher, a subject or staff")} aria-label={t("Find a recipient")} autoFocus />
      </label>
      {words.length ? (
        <div className="people">
          {found.length ? found.map((r) => person(r, teaches(r) ?? [english(GROUPS, r.group), r.school].filter(Boolean).join(" · "))) : <p className="waiting">{t("Nobody in Wilma's list matches “{query}”.", { query })}</p>}
        </div>
      ) : (
        <>
          {details && (details.supervisors.length || details.messageGroups.length) ? (
            <>
              <div className="people-head">{details.className ? t("Class {name}", { name: details.className }) : t("Class")}</div>
              <div className="people">
                {details.supervisors
                  .filter((s) => s.recipient)
                  .map((s) => person(s.recipient!, [english(ROLES, s.role), teaches(s.recipient!)].filter(Boolean).join(" · ")))}
                {details.messageGroups.map((g) => person({ ...g, name: groupLinkLabel(g.name, first) }, t("Everyone at once")))}
              </div>
            </>
          ) : null}
          {own.length ? (
            <>
              <div className="people-head">{first ? t("{name}'s teachers", { name: first }) : t("Your child's teachers")}</div>
              <div className="people">{own.map((r) => person(r, teaches(r)))}</div>
            </>
          ) : null}
          {guardians.length ? (
            <>
              <div className="people-head">{plural(guardians.length, "Other guardian", "Other guardians")}</div>
              <div className="people">{guardians.map((r) => person(r, null))}</div>
            </>
          ) : null}
          <p className="hint-line">{t("Search to find anyone else at the school: other teachers, the nurse, the principal.")}</p>
        </>
      )}
    </>
  );
}
