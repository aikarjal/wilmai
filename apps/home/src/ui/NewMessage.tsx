/*
 * Writing a new message in Wilma: the child it's about (chosen once, then
 * fixed: recipients and the form are that child's), who it goes to (one or
 * several, in one compose link as Wilma's own group links are), then the
 * message. Recipients come from Wilma's own lists (the class teacher and
 * supervisors on the child's front page, and Wilma's recipient list), the
 * form is Wilma's, and the message is sent once, after a confirmation.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { MessageRecipient } from "@wilma-client/src/core";
import { composeToAll, type MessageForm } from "@wilma-client/src/write";
import { accountStorageKey, useApp } from "../data/store";
import { isDemo, isSessionEnded, loadContacts, messageApi, preparedAgain, signInAgain, SESSION_CHANGED_NOTE } from "../data/engine";
import { draftTo, openDraft, readDrafts, saveDraft, writeDrafts, type Drafts } from "../data/drafts";
import { OutgoingPane, OutgoingSwitch, goesIn, useOutgoing } from "./Outgoing";
import { loginOfChild } from "../data/logins";
import type { Contacts } from "../data/model";
import { Icon, Tab } from "./bits";
import { go, hrefFor, useChildFilter } from "./shared";
import { showToast } from "./Toast";
import { language, plural, t, tx } from "../i18n";
import { useWilma } from "../data/phrases";
import { subjectsByTeacher, teacherCodeFor } from "../data/schedule";

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

/** Several recipients as one: their names, and one compose link to them all (as Wilma's own group links are made). */
function toAll(list: MessageRecipient[]): MessageRecipient {
  if (list.length === 1) return list[0];
  return { name: list.map((r) => r.name).join(", "), group: "", school: null, kind: "group", composePath: composeToAll(list.map((r) => r.composePath)) };
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
  const w = useWilma();
  const data = useApp((s) => s.snapshot?.perChild[child]);
  const [contacts, setContacts] = useState<Contacts | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Who it goes to: people and groups as Wilma lists them, picked one by one ("Add a recipient").
  const [chosen, setChosen] = useState<MessageRecipient[]>([]);
  const [adding, setAdding] = useState(false);
  // Ticked in the list (by compose link), to write to them all at once; a click on a name writes to that one straight away.
  const [ticked, setTicked] = useState<Map<string, MessageRecipient>>(new Map());
  const recipient = useMemo(() => (chosen.length ? toAll(chosen) : null), [chosen]);
  const tick = (r: MessageRecipient) =>
    setTicked((was) => {
      const next = new Map(was);
      if (next.has(r.composePath)) next.delete(r.composePath);
      else next.set(r.composePath, r);
      return next;
    });
  /** The list again, to add people: those written to already are ticked there. */
  const addMore = () => {
    setTicked(new Map(chosen.map((r) => [r.composePath, r])));
    setAdding(true);
  };
  // Several people get it (picked, or a group): only then does it matter whether they see each other's replies.
  const several = chosen.length > 1 || chosen.some((r) => r.kind === "group");
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<Stage>({ kind: "choosing" });
  const draftKey = accountStorageKey(`newmsg.${child}`);
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  // Written in the parent's language, sent in Finnish or Swedish when they've chosen so (Settings).
  const outgoing = useOutgoing(subject, text);
  // Until the parent writes, the words are what the app filled in (or a saved draft as it was): nothing to save.
  const [written, setWritten] = useState(false);
  // Recipients see each other's replies unless the parent unticks it (Wilma's own form has it off): with several
  // teachers on a message, each sees whether another has already answered.
  const [collated, setCollated] = useState(true);
  // The saved draft the words opened from, so it moves with them if the parent sends them to someone else.
  const draftFrom = useRef<string | null>(null);
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
    store(saveDraft(stored(), to, { subject, text }, draftFrom.current));
    draftFrom.current = subject || text ? to : null;
  }, [subject, text, written, recipient, draftKey]);

  /** The words gone, and their draft (sent or thrown away). */
  const forget = () => {
    if (recipient) store(saveDraft(stored(), draftTo(recipient.composePath), { subject: "", text: "" }, draftFrom.current));
    draftFrom.current = null;
    setWritten(false);
    setSubject("");
    setText("");
  };

  // What each teacher teaches this child, from the timetable's teacher codes.
  const subjects = useMemo(() => subjectsByTeacher(data), [data]);
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
    if (r.kind === "group" || r.kind === "guardian") return null;
    const id = teacherIdOf(r.composePath);
    // By the code in the name or the list's, else by the name as the timetable writes it.
    const code = codeOf(r.name) ?? (id ? codeById.get(id) : undefined) ?? teacherCodeFor(data, r.name);
    const list = code ? subjects.get(code.toUpperCase()) : undefined;
    return list?.length ? list.map(w).join(", ") : null;
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

  /** Write to these (none: back to choosing), with Wilma's form for them. */
  const pick = async (next: MessageRecipient[]) => {
    const fresh = !chosen.length;
    setChosen(next);
    setAdding(false);
    setTicked(new Map());
    if (!next.length) {
      setStage({ kind: "choosing" });
      return;
    }
    const to = toAll(next);
    if (!written && fresh) {
      // Nothing written yet: the draft to them, if there is one, else the subject the parent came with.
      const opened = openDraft(stored(), draftTo(to.composePath), initialSubject, !initialTeacher);
      draftFrom.current = opened.from;
      setSubject(opened.words.subject);
      setText(opened.words.text);
    }
    setStage({ kind: "preparing" });
    try {
      const form = await messageApi(child).prepare(to);
      setStage({ kind: "ready", form });
      setTimeout(() => subjectRef.current?.focus(), 0);
    } catch (err) {
      setStage(errorStage(err));
    }
  };
  // From the list: that one alone, or (adding to the message) with those ticked, the ones written to already among them.
  const choose = (r: MessageRecipient) => pick(adding ? [...[...ticked.values()].filter((x) => x.composePath !== r.composePath), r] : [r]);

  const send = async (form: MessageForm) => {
    // What's shown is what's sent: the translation of these words, or the parent's own (Send waits until there's one).
    const words = outgoing.sent;
    if (!words) return;
    setStage({ kind: "sending", form });
    try {
      await messageApi(child).send(form, words.subject.trim(), words.text, several && form.collatedReplies != null ? collated : undefined);
      setStage({ kind: "sent", to: form.recipients.join(", ") || recipient?.name || "" });
      forget();
      outgoing.reset();
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
          <button className="btn" onClick={() => (setChosen([]), setStage({ kind: "choosing" }))}>
            {t("Write another")}
          </button>
          <a className="btn btn-quiet" href={hrefFor("inbox")} style={{ textDecoration: "none" }}>
            {t("Back to Messages")}
          </a>
        </div>
      </div>
    );
  }

  if (!recipient || adding) {
    const drafted = new Set(Object.keys(stored()));
    return (
      <div className="reader compose-page">
        {head}
        {adding ? (
          <div className="to-line">
            <span className="help">{t("Add a recipient")}</span>
            <button className="btn btn-quiet btn-sm" onClick={() => setAdding(false)}>
              {t("Back to the message")}
            </button>
          </div>
        ) : null}
        <Picker
          ticked={ticked}
          onTick={tick}
          contacts={contacts}
          error={loadError}
          first={kid?.first ?? null}
          query={query}
          setQuery={setQuery}
          teaches={teaches}
          drafted={(r) => drafted.has(draftTo(r.composePath))}
          onPick={(r) => void choose(r)}
        />
        {ticked.size ? (
          <div className="picker-bar">
            <span>{[...ticked.values()].map((r) => r.name.replace(/\s*\([^)]*\)\s*$/, "")).join(", ")}</span>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void pick([...ticked.values()])}>
              <Icon name="pen" /> {plural(ticked.size, "Write to {n} recipient", "Write to {n} recipients")}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  const form = "form" in stage ? stage.form : undefined;
  const to = form?.recipients.length ? form.recipients.join(", ") : recipient.name;
  const saved = (written || draftFrom.current !== null) && Boolean(subject || text);
  const sending = stage.kind === "sending";
  return (
    <div className="reader compose-page">
      {head}
      <div className="to-line">
        <span className="help">{t("To")}</span>
        {chosen.map((r) => (
          <span key={r.composePath} className="to-person">
            <b>{r.name}</b>
            {teaches(r) ? <span className="chip">{teaches(r)}</span> : null}
            {chosen.length > 1 ? (
              <button type="button" className="to-remove" onClick={() => void pick(chosen.filter((x) => x !== r))} disabled={sending} aria-label={t("Remove {name}", { name: r.name })}>
                <Icon name="close" />
              </button>
            ) : null}
          </span>
        ))}
        <button className="btn btn-quiet btn-sm" onClick={addMore} disabled={sending}>
          + {t("Add a recipient")}
        </button>
        {chosen.length === 1 ? (
          <button className="btn btn-quiet btn-sm" onClick={() => (setChosen([]), setStage({ kind: "choosing" }))} disabled={sending}>
            {t("Change")}
          </button>
        ) : null}
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
        <div className={outgoing.translating ? "out-pair" : undefined}>
          <textarea value={text} onChange={(e) => (setText(e.target.value), setWritten(true))} placeholder={t("Write your message")} aria-label={t("Your message")} disabled={stage.kind === "sending"} />
          <OutgoingPane o={outgoing} subject />
        </div>
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
            <span>
              {stage.kind === "confirm" && stage.note ? <>{t(stage.note)} </> : null}
              {tx(demo ? "Send “{subject}” to {to} in Wilma (sample family: nothing is really sent)?" : "Send “{subject}” to {to} in Wilma?", {
                subject: (outgoing.sent?.subject ?? subject).trim(),
                to: <b>{to}</b>,
              })}
              {goesIn(outgoing) ? <> {goesIn(outgoing)}</> : null}
            </span>
            <span style={{ flex: 1 }} />
            <button className="btn btn-sm" onClick={() => setStage({ kind: "ready", form: stage.form })} disabled={stage.kind === "sending"}>
              {t("Keep editing")}
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => void send(stage.form)} disabled={stage.kind === "sending" || !outgoing.sent}>
              {stage.kind === "sending" ? t("Sending…") : t("Send now")}
            </button>
          </div>
        ) : (
          <div className="composer-foot">
            <OutgoingSwitch o={outgoing} />
            {form && several && form.collatedReplies != null ? (
              <span className="out-switch">
                <label title={t("Teachers see whether someone has already answered.")}>
                  <input type="checkbox" checked={collated} onChange={(e) => setCollated(e.target.checked)} />
                  {t("Recipients see each other's replies")}
                </label>
              </span>
            ) : null}
            <span className="hint">{saved ? t("Draft saved on this device") : t("Drafts stay on this device until you send")}</span>
            {/* Always a way out: throw the draft away (with Undo), or leave when nothing is written. */}
            <button type="button" className="btn btn-sm" onClick={saved ? discard : () => go("inbox")}>
              {saved ? t("Discard draft") : t("Close")}
            </button>
            <button
              className="btn btn-primary btn-sm"
              disabled={!form || !subject.trim() || !text.trim() || !outgoing.sent}
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
  ticked,
  onTick,
  contacts,
  error,
  first,
  query,
  setQuery,
  teaches,
  drafted,
  onPick,
}: {
  /** Those ticked to write to at once (by compose link), and ticking one. */
  ticked: Map<string, MessageRecipient>;
  onTick: (r: MessageRecipient) => void;
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
  // The box ticks them for writing to several at once; the name writes to them alone.
  const person = (r: MessageRecipient, note: string | null) => {
    const shown = drafted(r) ? [t("Draft"), note].filter(Boolean).join(" · ") : note;
    return (
      <div key={`${r.group}|${r.composePath}`} className={`person-row${ticked.has(r.composePath) ? " is-ticked" : ""}`}>
        <input type="checkbox" checked={ticked.has(r.composePath)} onChange={() => onTick(r)} aria-label={t("Choose {name}", { name: r.name })} />
        <button type="button" className="person" onClick={() => onPick(r)}>
          <span>{r.name}</span>
          {shown ? <small>{shown}</small> : null}
        </button>
      </div>
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
