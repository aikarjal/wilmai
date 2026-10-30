import { useEffect, useRef, useState, type ReactNode } from "react";
import { accountStorageKey, markOpened, setState, toggleDone, togglePinned, useApp, useViewer } from "../data/store";
import { toggleDoneWithUndo } from "./done";
import { answerInvitation, declineInvitation, isDemo, isSessionEnded, openMessage, openNews, replyApi, preparedAgain, signInAgain, SESSION_CHANGED_NOTE } from "../data/engine";
import { loginOfId, wilmaPage } from "../data/logins";
import { showToast } from "./Toast";
import { slotState, type InvitationSlot as InviteSlot } from "@wilma-client/src/core";
import { NEEDS_YOU, isNeedsYou, type FeedItem } from "../data/feed";
import { awaitingReply, type JevAnswer, type MessageRec, type Snapshot } from "../data/model";
import { clock, dateOf, deadlineText, mentionedDates, relativeDay, shortDate, today, whenLong } from "../data/dates";
import { KINDS, PUPIL_SCOPES, SCOPES, TRIAGE_PUPIL_QS } from "../jev/questions";
import type { ReplyForm } from "@wilma-client/src/write";
import { Icon, Mark, Tabs, TriageChips } from "./bits";
import { TranslationNote, TranslationSwitch, useTranslation } from "./Translated";
import { InFinnish } from "./InFinnish";
import { currentOutgoing, outgoingAvailable, readOutgoing, type Outgoing } from "../ai/outgoing";
import { go, jevReadingOpen } from "./shared";
import { language, plural, t, tx } from "../i18n";

/** "61%" / "61 %" */
function percent(share: number): string {
  const n = Math.round(share * 100);
  return language() === "en" ? `${n}%` : `${n}\u00a0%`;
}

/** A translated sentence with **bold** parts (so the bold words can move with Finnish word order). */
function withBold(text: string): ReactNode {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part));
}

/* Links and dates picked out of a piece of text. */
function richParts(text: string, anchor: string, keyBase: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(https?:\/\/[^\s)]+)|((?<![\d.])\d{1,2}\.\d{1,2}\.(?:\d{4})?(?!\d))/g;
  let last = 0;
  const now = today();
  for (const match of text.matchAll(re)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(text.slice(last, index));
    if (match[1]) {
      parts.push(
        <a key={`${keyBase}${index}`} href={match[1]} target="_blank" rel="noreferrer noopener">
          {match[1]}
        </a>
      );
    } else {
      const iso = mentionedDates(match[2], anchor)[0];
      parts.push(
        iso ? (
          <time key={`${keyBase}${index}`} dateTime={iso} className={iso < now ? "past" : undefined} title={shortDate(iso)}>
            {match[2]}
          </time>
        ) : (
          match[2]
        )
      );
    }
    last = index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** The message text, with the sentence Jev pointed to (if any) drawn in highlighter. */
function RichText({ text, anchor, highlight, why }: { text: string; anchor: string; highlight?: string | null; why?: string }) {
  const at = highlight ? text.indexOf(highlight) : -1;
  if (!highlight || at < 0) return <div className="body">{richParts(text, anchor, "t")}</div>;
  return (
    <div className="body">
      {richParts(text.slice(0, at), anchor, "a")}
      <span className="mark on sweep" title={why ?? t("The AI points to this sentence as what needs you")}>
        {richParts(highlight, anchor, "h")}
      </span>
      {richParts(text.slice(at + highlight.length), anchor, "b")}
    </div>
  );
}

/**
 * A message, bulletin or note in full. In the Inbox, with the list's buttons
 * and a reply; beside another view (`inPanel`, the Calendar), the same
 * reading with a way to the Inbox, and `highlight` marks the line that view
 * is about.
 */
export function Reader({
  item,
  snap,
  onDone,
  inPanel = false,
  highlight = null,
}: {
  item: FeedItem;
  snap: Snapshot;
  onDone?: () => void;
  inPanel?: boolean;
  highlight?: string | null;
}) {
  useEffect(() => {
    markOpened(item.key);
    if (item.kind === "message" && item.id) void openMessage(item.id);
    if (item.kind === "news" && item.id) void openNews(item.id);
  }, [item.key, item.kind, item.id]);

  const message = item.kind === "message" && item.id ? snap.messages[item.id] : null;
  const news = item.kind === "news" && item.id ? snap.news[item.id] : null;
  const needs = isNeedsYou(item);
  const anchor = dateOf(item.at);
  // An invitation that has waited for an answer in this view keeps its card on top once answered.
  const waiting = Boolean(item.invite && item.task && !item.done);
  const [topFor, setTopFor] = useState<string | null>(null);
  if (waiting && topFor !== item.key) setTopFor(item.key);
  const inviteOnTop = waiting || topFor === item.key;
  const heading = item.kind === "note" && item.note ? `${item.note.typeLabel}` : item.title;
  // A thread is translated whole: its messages in order (ai/translate.ts translationSource).
  const tr = useTranslation(item, snap);
  const translated = tr.shown;

  return (
    <article className={`reader${inPanel ? " in-panel" : ""}`} aria-labelledby="reader-title">
      {inPanel ? null : (
        <div className="reader-top">
          <button className="btn btn-quiet btn-sm" onClick={() => go("inbox")} aria-label={t("Back to the list")}>
            <Icon name="back" /> {t("List")}
          </button>
          <span className="spacer" />
          <TranslationSwitch tr={tr} />
          {item.kind !== "note" ? (
            <button
              className={`btn btn-sm${item.pinnedAt ? " pinned" : ""}`}
              aria-pressed={Boolean(item.pinnedAt)}
              onClick={() => togglePinned(item.key)}
              title={item.pinnedAt ? t("Unpin (P)") : t("Pin to the top of Messages (P). Only in this app; nothing changes in Wilma.")}
            >
              <Icon name="pin" />
              {item.pinnedAt ? t("Pinned") : t("Pin")}
            </button>
          ) : null}
          <button
            className="btn btn-sm"
            onClick={() => (onDone ? onDone() : toggleDoneWithUndo(item))}
            title={item.done ? t("Move back to open (E)") : t("Mark done (E). Only in this app; nothing changes in Wilma.")}
          >
            <Icon name={item.done ? "undo" : "check"} />
            {item.done ? t("Move back to open") : t("Done")}
          </button>
        </div>
      )}
      <TriageChips item={item} />
      <h2 id="reader-title" style={{ marginTop: 12 }}>
        <Mark on={needs} sweep>
          {translated ? translated.title : heading}
        </Mark>
      </h2>
      <div className="meta">
        <Tabs snap={snap} numbers={item.children} />
        {item.from ? <span className="from">{item.from}</span> : null}
        <span className="sep">·</span>
        <span>{whenLong(item.at)}</span>
        {item.note ? (
          <>
            <span className="sep">·</span>
            <span>
              {item.note.subjects.join(", ")}
              {item.note.start ? ` ${item.note.start}–${item.note.end ?? ""}` : ""}
            </span>
          </>
        ) : null}
        {message?.thread?.recipients?.length && !message.sent ? (
          <>
            <span className="sep">·</span>
            <span>
              {t("to {names}", {
                names: `${message.thread.recipients.slice(0, 3).join(", ")}${message.thread.recipients.length > 3 ? ` +${message.thread.recipients.length - 3}` : ""}`,
              })}
            </span>
          </>
        ) : null}
      </div>

      {inviteOnTop ? (
        // An invitation that waits for an answer is answered here, right under the ask. It stays here once
        // answered (until another message opens), so Wilma's answer shows where the parent clicked.
        <div className="task-box task-invite">
          {item.task && !item.done ? <span>{item.task.reason}</span> : null}
          <InviteCard item={item} messageId={item.id!} />
        </div>
      ) : item.task && !item.done && !item.invite ? (
        <div className="task-box">
          <span>{item.task.reason}</span>
          {item.kind !== "note" ? null : isDemo() ? (
            <span className="chip">{t("Sample family: no real Wilma")}</span>
          ) : (
            // A note to explain: Wilma's "Selvitä" page lists exactly those.
            <a className="btn btn-primary btn-sm" href={wilmaPage(snap, item.children[0], "attendance")} target="_blank" rel="noreferrer noopener">
              {item.task.label} ↗
            </a>
          )}
        </div>
      ) : null}

      <TranslationNote tr={tr} />

      {item.kind === "note" ? (
        item.text ? (
          <RichText text={translated?.texts[0] ?? item.text} anchor={anchor} />
        ) : (
          <p className="waiting">{t("The teacher didn't write anything else.")}</p>
        )
      ) : message?.thread?.replies.length ? (
        <Thread
          key={item.key}
          opening={{ who: message.sender ?? t("Someone"), at: openedAt(message), text: translated?.texts[0] ?? message.thread.content }}
          replies={translated ? message.thread.replies.map((r, i) => ({ ...r, content: translated.texts[i + 1] ?? r.content })) : message.thread.replies}
          anchor={anchor}
          // The AI's line is quoted from the original, so it marks only the original.
          highlight={translated ? null : inPanel ? highlight : needs ? item.actionLine : null}
          why={inPanel ? t("The calendar's date is read from this line") : undefined}
        />
      ) : item.text !== null ? (
        <RichText
          text={translated?.texts[0] ?? item.text}
          anchor={anchor}
          highlight={translated ? null : inPanel ? highlight : needs ? item.actionLine : null}
          why={inPanel ? t("The calendar's date is read from this line") : undefined}
        />
      ) : (
        <p className="waiting">{t("Opening it from Wilma…")}</p>
      )}

      {news?.detail?.resources?.length ? (
        <ul>
          {news.detail.resources.map((r) => (
            <li key={r.id}>
              <a href={r.url} target="_blank" rel="noreferrer noopener">
                {r.label || r.fileName || t("Attachment")}
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      {item.invite && !inviteOnTop ? <InviteCard item={item} messageId={item.id!} /> : null}

      {inPanel ? (
        <div className="dp-actions">
          <button className="btn btn-sm" onClick={() => go("inbox", item.key)}>
            <Icon name="inbox" /> {t("Open in Messages")}
          </button>
        </div>
      ) : null}

      {message && message.thread && !inPanel && !awaitingReply(message) ? (
        <Composer key={message.id} messageId={message.id} to={message.sender} collated={message.thread.collated} onSent={() => !item.done && toggleDone(item.key)} />
      ) : null}

      {item.triage && !inPanel ? <JevReading item={item} /> : null}
    </article>
  );
}

/* ---------- Threads ---------- */

type ThreadMessage = { who: string; at: Date | null; text: string };

/**
 * When a thread's opening message was sent. A thread read before that time was kept (it's read again at the
 * next check) has the list's time, which can be the newest reply's: then none, rather than a wrong one.
 */
function openedAt(message: MessageRec): Date | null {
  const thread = message.thread!;
  if (thread.sentAt) return thread.sentAt;
  const first = thread.replies[0]?.sentAt;
  return !first || message.sentAt <= first ? message.sentAt : null;
}

/** About a screenful of text: when the messages before the newest are longer, they fold to a line each. */
const FOLD_AFTER = 900;

/**
 * A message with its replies, oldest first as in Wilma, each with who wrote it
 * and when, the newest marked. When the earlier messages would push the newest
 * out of view, they fold to a line each (a click opens one), so the newest
 * shows first; the one holding the line the AI points to stays open.
 */
function Thread({
  opening,
  replies,
  anchor,
  highlight,
  why,
}: {
  opening: ThreadMessage;
  replies: { sentAt: Date; senderName: string | null; content: string }[];
  /** The item's day, for dates in a message without a time of its own. */
  anchor: string;
  highlight: string | null;
  why?: string;
}) {
  const messages: ThreadMessage[] = [opening, ...replies.map((r) => ({ who: r.senderName ?? t("Someone"), at: r.sentAt, text: r.content }))];
  const last = messages.length - 1;
  // A line per message of its own (who, when), about 80 characters' worth.
  const fold = messages.slice(0, last).reduce((sum, m) => sum + m.text.length + 80, 0) > FOLD_AFTER;
  const [opened, setOpened] = useState<number[]>([]);
  const [all, setAll] = useState(false);
  const isOpen = (i: number) => !fold || all || i === last || opened.includes(i) || Boolean(highlight && messages[i].text.includes(highlight));
  return (
    <section className="thread" aria-label={t("Messages in this thread")}>
      <div className="thread-head">
        <span>{plural(messages.length, "{n} message, oldest first", "{n} messages, oldest first")}</span>
        {fold ? (
          <button
            type="button"
            className="linkish"
            onClick={() => {
              setAll(!all);
              setOpened([]);
            }}
          >
            {all ? t("Fold the earlier ones") : t("Show all")}
          </button>
        ) : null}
      </div>
      {messages.map((m, i) =>
        isOpen(i) ? (
          <div className={`msg${i === last ? " msg-last" : ""}`} key={i}>
            <div className="msg-who">
              <b>{m.who}</b>
              {m.at ? <span>{whenLong(m.at)}</span> : null}
              {i === last ? <em className="msg-latest">{t("Latest")}</em> : null}
            </div>
            <RichText text={m.text} anchor={m.at ? dateOf(m.at) : anchor} highlight={highlight} why={why} />
          </div>
        ) : (
          <button type="button" className="msg msg-folded" key={i} onClick={() => setOpened([...opened, i])} title={t("Show this message")}>
            <span className="msg-who">
              <b>{m.who}</b>
              {m.at ? <span>{whenLong(m.at)}</span> : null}
            </span>
            <span className="msg-snippet">{m.text.replace(/\s+/g, " ").trim()}</span>
          </button>
        )
      )}
    </section>
  );
}

/* ---------- Invitations ---------- */

function slotTime(slot: InviteSlot): string {
  if (!slot.start) return t("Time not given");
  const day = shortDate(dateOf(slot.start));
  const end = slot.end && dateOf(slot.end) === dateOf(slot.start) ? `–${clock(slot.end)}` : "";
  return `${day} ${clock(slot.start)}${end}`;
}

/** A write that didn't go as asked, in the app's language (Wilma's own words when it refused). */
function inviteError(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err);
  if (name === "WriteUnconfirmedError") return t("Wilma took the request, but the invitation doesn't show the change yet. Check it in Wilma before trying again.");
  if (name === "WriteRefusedError") return t("Wilma didn't take it: {why}", { why: message });
  if (name === "NotOfferedError") return t("Wilma doesn't offer that for this invitation now. Open it again to see where it stands.");
  if (isSessionEnded(err)) return t("Wilma ended the session. Sign in again and try again.");
  return message;
}

type Pending = { action: "apply" | "cancel"; slot: InviteSlot } | { action: "decline" | "undecline" };

function InviteCard({ item, messageId }: { item: FeedItem; messageId: number }) {
  const invite = item.invite?.data;
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  // A student sees the times and what the family chose; a guardian signs up (Wilma's sign-up is the guardian's).
  const student = useViewer() === "student";
  if (!invite) return <p className="waiting">{t("Reading the invitation's times from Wilma…")}</p>;
  const chosen = invite.slots.some((slot) => slot.selected);

  const run = async () => {
    if (!pending) return;
    setBusy(true);
    setNote(null);
    try {
      const said =
        pending.action === "apply" || pending.action === "cancel"
          ? await answerInvitation(messageId, pending.slot.id, pending.action)
          : await declineInvitation(messageId, pending.action === "undecline");
      const done = {
        apply: t("Signed up. Wilma shows it on the invitation."),
        cancel: t("Cancelled in Wilma."),
        decline: t("Wilma now shows you won't attend."),
        undecline: t("Taken back. Wilma no longer shows you won't attend."),
      }[pending.action];
      setNote({ ok: true, text: said || done });
      setPending(null);
    } catch (err) {
      setNote({ ok: false, text: inviteError(err) });
    } finally {
      setBusy(false);
    }
  };

  const question =
    pending?.action === "apply" || pending?.action === "cancel"
      ? tx(pending.action === "apply" ? "Sign up for {time} in Wilma?" : "Cancel your sign-up for {time} in Wilma?", { time: <b>{slotTime(pending.slot)}</b> })
      : pending?.action === "decline"
      ? chosen
        ? t("Tell Wilma you won't attend? This cancels your sign-up.")
        : t("Tell Wilma you won't attend?")
      : t("Take back that you won't attend?");
  const confirmLabel = {
    apply: t("Sign up"),
    cancel: t("Cancel sign-up"),
    decline: t("Won't attend"),
    undecline: t("Take back"),
  }[pending?.action ?? "apply"];

  return (
    <section className="invite" aria-label={t("Sign-up")}>
      <h4>{invite.mustApply ? t("Sign-up") : t("Times")}</h4>
      {student && invite.mustApply ? <p className="help-line">{t("A guardian signs up for a time in their own Wilma.")}</p> : null}
      {invite.slots.map((slot) => {
        const state = slotState(slot, new Date(), invite);
        const action = (() => {
          switch (state) {
            case "chosen":
              if (student) return <span className="chip chip-good">{t("Signed up")}</span>;
              return (
                <>
                  <span className="chip chip-good">{t("You're signed up")}</span>
                  <button className="btn btn-sm" disabled={busy} onClick={() => setPending({ slot, action: "cancel" })}>
                    {t("Cancel")}
                  </button>
                </>
              );
            case "chosen-locked":
              return <span className="chip chip-good">{t("Signed up (the cancel deadline has passed)")}</span>;
            case "chosen-by-other":
              return (
                <span className="chip chip-good" title={t("Another guardian signed up in Wilma")}>
                  {t("Signed up by {name}", {
                    name: slot.selectedByOther ?? "",
                  })}
                </span>
              );
            case "taken":
              return (
                <span className="chip" title={t("The family has another time; cancel that one first")}>
                  {t("Another time chosen")}
                </span>
              );
            case "open":
              if (student) return <span className="chip">{t("Available")}</span>;
              return (
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => setPending({ slot, action: "apply" })}>
                  {t("Sign up")}
                </button>
              );
            case "full":
              return <span className="chip">{t("Full")}</span>;
            case "not-yet":
              return (
                <span className="chip">
                  {slot.enrollStart
                    ? t("Opens {when}", {
                        when: `${shortDate(dateOf(slot.enrollStart))} ${clock(slot.enrollStart)}`,
                      })
                    : t("Opens later")}
                </span>
              );
            default:
              return <span className="chip">{t("Sign-up closed")}</span>;
          }
        })();
        return (
          <div className={`slot${slot.selected || slot.selectedByOther ? " chosen" : ""}`} key={slot.id}>
            <div>
              <b>{slotTime(slot)}</b>
              {slot.subject || slot.info ? <small>{[slot.subject, slot.info].filter(Boolean).join(" · ")}</small> : null}
              <small>
                {[
                  slot.maxPeople
                    ? t("{count}/{max} signed up", {
                        count: slot.peopleCount,
                        max: slot.maxPeople,
                      })
                    : t("{count} signed up", { count: slot.peopleCount }),
                  slot.enrollEnd && state === "open"
                    ? t("sign up by {when}", {
                        when: deadlineText(slot.enrollEnd),
                      })
                    : null,
                  slot.cancelUntil && state === "chosen"
                    ? t("can cancel until {when}", {
                        when: deadlineText(slot.cancelUntil),
                      })
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
            </div>
            <div className="slot-act">{action}</div>
          </div>
        );
      })}
      {invite.declined ? (
        <div className="slot invite-decline declined">
          <span className="chip">{t("You told Wilma you won't attend")}</span>
          {invite.canDecline && !student ? (
            <button className="btn btn-quiet btn-sm" disabled={busy} onClick={() => setPending({ action: "undecline" })}>
              {t("Take back")}
            </button>
          ) : null}
        </div>
      ) : invite.canDecline && !student ? (
        <div className="slot invite-decline">
          <span className="ov-none">{chosen ? t("Can't come after all?") : t("Not coming?")}</span>
          <button className="btn btn-quiet btn-sm" disabled={busy} onClick={() => setPending({ action: "decline" })}>
            {t("Won't attend")}
          </button>
        </div>
      ) : null}
      {pending ? (
        <div className="confirm">
          <span>
            {question}
            {isDemo() ? ` ${t("(Sample family: nothing is really sent.)")}` : ""}
          </span>
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm" disabled={busy} onClick={() => setPending(null)}>
            {t("Keep as is")}
          </button>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void run()}>
            {busy ? t("Sending…") : confirmLabel}
          </button>
        </div>
      ) : null}
      {note ? (
        <div className={`notice ${note.ok ? "ok" : "err"}`} style={{ marginTop: 10 }}>
          {note.text}
        </div>
      ) : null}
    </section>
  );
}

/* ---------- How Jev read it ---------- */

/** For the curious: a small toggle, closed until opened (and then remembered open), since there's nothing to do with it. */
function JevReading({ item }: { item: FeedItem }) {
  const open = jevReadingOpen.use();
  return (
    <div className="jev-reading">
      <button type="button" className="btn btn-quiet btn-sm jev-toggle" aria-expanded={open} onClick={() => jevReadingOpen.set(!open)}>
        <Icon name="spark" className="icon" /> {t("How the AI read this")}
        <Icon name={open ? "up" : "down"} className="icon chev" />
      </button>
      {open ? <JevCard item={item} /> : null}
    </div>
  );
}

function confidence(answer: JevAnswer | undefined): string {
  return answer?.type === "choice" ? percent(answer.confidence) : "";
}

/* Jev's answer names (KINDS, SCOPES) stay English in questions.ts, as model input; they're translated only on screen. */
function JevCard({ item }: { item: FeedItem }) {
  const triage = item.triage!;
  const d = triage.detail;
  const urgencyLevels = [t("No date ahead"), t("Within three weeks"), t("Within a week"), t("Today or tomorrow")];
  const rows: { id: string; label: string; value: number }[] = [
    { id: "needs", label: t("Needs you"), value: triage.needsAction },
    {
      id: "kind",
      label: t("Kind: {kind}", {
        kind: t(KINDS[triage.kind]?.label ?? triage.kind),
      }),
      value: triage.kindConfidence,
    },
    {
      id: "scope",
      label: t("Written to: {scope}", {
        scope: t((triage.qs === TRIAGE_PUPIL_QS ? PUPIL_SCOPES : SCOPES)[triage.scope]?.label ?? triage.scope),
      }),
      value: triage.scopeConfidence,
    },
    { id: "praise", label: t("Praise"), value: triage.praise },
  ];
  const dateLine = (iso: string | null) =>
    iso ? (
      <>
        <b>{relativeDay(iso)}</b> {shortDate(iso) !== relativeDay(iso) ? `(${shortDate(iso)})` : ""}
      </>
    ) : null;
  const foot = [
    triage.preliminary ? t("Read from the subject only; it's read again once the message is opened.") : null,
    isNeedsYou(item) || triage.needsAction < NEEDS_YOU ? null : item.own ? t("Not counted as needing you: your family wrote it.") : t("Not counted as needing you: it's from outside the school, or its dates have passed."),
    t("The AI saw this item with your children's first names and classes, nothing else. It keeps only the school's own words and says how sure it is of each."),
  ];
  return (
    <section className="jev-card" aria-label={t("How the AI read this")}>
      <h4>
        <Icon name="spark" className="icon" /> {t("How the AI read this")}
      </h4>
      {rows.map(({ id, label, value }) => (
        <div className="jev-row" key={id}>
          <span>{label}</span>
          <span className="bar">
            <i className={id === "needs" && value >= NEEDS_YOU ? "hot" : undefined} style={{ width: `${Math.round(value * 100)}%` }} />
          </span>
          <span className="v">{percent(value)}</span>
        </div>
      ))}
      {d ? (
        <div className="jev-stage">
          <span className="q">{t("The school's own words")}</span>
          {d.actionLine ? (
            <>
              <span>{d.confirm != null ? t("What to do · required {p}", { p: percent(d.confirm) }) : t("What to do")}</span>
              <blockquote>{d.actionLine}</blockquote>
            </>
          ) : (
            <span>{t("No sentence asks you to do something.")}</span>
          )}
          {d.deadline ? <span>{tx("Deadline: {date}", { date: dateLine(d.deadline) })}</span> : null}
          {d.events.map((e, i) => (
            <span key={i}>
              {dateLine(e.date)}
              {e.start ? ` ${e.start}` : ""} · {e.title} · {t("date {date}, for this family {calendar}", { date: percent(e.pDate), calendar: percent(e.pCalendar) })}
            </span>
          ))}
          {d.confirm != null && triage.firstNeedsAction >= 0.45 && triage.firstNeedsAction < 0.75 ? (
            <span>
              {t("Checked again because the first answer was unsure ({first}): {confirm} needs you.", {
                first: percent(triage.firstNeedsAction),
                confirm: percent(d.confirm),
              })}
            </span>
          ) : null}
          <span>
            {t("How soon (worked out from the date): {level}", {
              level: urgencyLevels[triage.urgency],
            })}
          </span>
        </div>
      ) : null}
      <div className="foot">{foot.filter(Boolean).join(" ")}</div>
    </section>
  );
}

/* ---------- Answering ---------- */

type Stage =
  | { kind: "closed" }
  | { kind: "preparing" }
  | { kind: "ready"; form: ReplyForm }
  | { kind: "confirm"; form: ReplyForm; note?: string }
  | { kind: "sending"; form: ReplyForm }
  | { kind: "sent" }
  | { kind: "error"; message: string; form?: ReplyForm; ended?: boolean };

/** Wilma ending the session says so in words, with "Sign in again" (the draft stays on this device). */
const replyError = (err: unknown, form?: ReplyForm): Stage =>
  isSessionEnded(err)
    ? {
        kind: "error",
        ended: true,
        form,
        message: t("Wilma ended the session. Your draft is saved on this device; sign in again to send it."),
      }
    : {
        kind: "error",
        form,
        message: err instanceof Error ? err.message : String(err),
      };

function Composer({ messageId, to, collated, onSent }: { messageId: number; to: string | null; collated: boolean; onSent: () => void }) {
  const draftKey = accountStorageKey(`draft.${messageId}`);
  const [text, setText] = useState(() => localStorage.getItem(draftKey) ?? "");
  const [stage, setStage] = useState<Stage>({ kind: "closed" });
  const area = useRef<HTMLTextAreaElement>(null);
  const demo = isDemo();
  const snap = useApp((s) => s.snapshot);
  // The sender's name without Wilma's "(role)" suffix; null when Wilma didn't give one.
  const who = to?.replace(/\s*\(.*\)\s*$/, "") || null;
  // Written in the parent's language, sent in Finnish (InFinnish.tsx): the Finnish is kept with the draft.
  const fiKey = `${draftKey}.fi`;
  const canFinnish = useApp((s) => outgoingAvailable(s.settings, language()));
  const [inFinnish, setInFinnish] = useState(true);
  const [fi, setFi] = useState<Outgoing | null>(() => readOutgoing(localStorage.getItem(fiKey)));
  const finnish = canFinnish && inFinnish;
  const ready = finnish ? currentOutgoing(fi, null, text) : null;
  // What goes to Wilma: the Finnish the parent saw, or what they wrote.
  const body = finnish ? (ready?.text ?? "") : text;

  useEffect(() => {
    if (text) localStorage.setItem(draftKey, text);
    else localStorage.removeItem(draftKey);
  }, [text, draftKey]);
  useEffect(() => {
    if (fi) localStorage.setItem(fiKey, JSON.stringify(fi));
    else localStorage.removeItem(fiKey);
  }, [fi, fiKey]);

  const open = async () => {
    setStage({ kind: "preparing" });
    setTimeout(() => area.current?.focus(), 0);
    if (demo) {
      setStage({
        kind: "ready",
        form: {
          kind: "reply",
          messageId,
          mode: collated ? "discussion" : "private",
          subject: null,
          recipients: [],
          form: {
            action: "",
            fields: [],
            buttons: [],
            selects: [],
            textareas: [],
          },
          bodyField: "",
        },
      });
      return;
    }
    const api = replyApi(messageId);
    if (!api)
      return setStage({
        kind: "error",
        message: t("Sign in again to answer."),
      });
    try {
      setStage({ kind: "ready", form: await api.prepare() });
    } catch (err) {
      setStage(replyError(err));
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "r" || (e.target as HTMLElement).closest("input, textarea") || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      if (stage.kind === "closed") void open();
      else area.current?.focus();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  const send = async (form: ReplyForm) => {
    setStage({ kind: "sending", form });
    if (demo) {
      // Sample family: nothing is sent; the answer is only added here.
      const message = snap?.messages[messageId];
      if (snap && message?.thread) {
        const reply = {
          id: Date.now(),
          sentAt: new Date(),
          senderName: t("You (sample, not sent)"),
          content: body,
        };
        setState({
          snapshot: {
            ...snap,
            messages: {
              ...snap.messages,
              [messageId]: {
                ...message,
                replyCount: message.replyCount + 1,
                thread: {
                  ...message.thread,
                  replies: [...message.thread.replies, reply],
                },
              },
            },
          },
        });
      }
      setText("");
      setFi(null);
      setStage({ kind: "sent" });
      onSent();
      return;
    }
    try {
      await replyApi(messageId)!.send(form, body);
      setText("");
      setFi(null);
      setStage({ kind: "sent" });
      onSent();
    } catch (err) {
      try {
        const fresh = await preparedAgain(err, () => replyApi(messageId)!.prepare(), loginOfId(messageId));
        if (fresh)
          setStage({
            kind: "confirm",
            form: fresh,
            note: t(SESSION_CHANGED_NOTE),
          });
      } catch (again) {
        setStage(replyError(isSessionEnded(again) ? again : err, form));
      }
    }
  };

  if (stage.kind === "closed" || stage.kind === "sent") {
    return (
      <div
        style={{
          marginTop: 28,
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <button className="btn" onClick={() => void open()}>
          <Icon name="reply" /> {collated ? t("Answer in the discussion") : who ? t("Reply to {name}", { name: who }) : t("Reply to the sender")}
        </button>
        {stage.kind === "sent" ? (
          <span className="notice ok">{t("Sent. Wilma shows your answer in the thread, and this is marked done.")}</span>
        ) : text ? (
          <span className="chip">{t("Draft saved")}</span>
        ) : null}
      </div>
    );
  }

  const form = "form" in stage ? stage.form : undefined;
  const mode = form?.mode ?? (collated ? "discussion" : "private");
  const sendQuestion =
    mode === "discussion"
      ? withBold(t("Send this to **everyone on this thread** in Wilma?"))
      : who
      ? tx("Send this to {name} in Wilma?", { name: <b>{who}</b> })
      : withBold(t("Send this to **the sender** in Wilma?"));

  return (
    <div className="composer">
      <div className="composer-head">
        <Icon name="reply" />
        {mode === "discussion" ? (
          <span>{withBold(t("Open discussion: **everyone on this thread** sees your answer."))}</span>
        ) : (
          <span>
            {who ? tx("Private answer to {name}", { name: <b>{who}</b> }) : withBold(t("Private answer to **the sender**"))}
            {form?.subject ? ` · ${t("“{subject}”", { subject: form.subject })}` : null}
          </span>
        )}
        {stage.kind === "preparing" ? <span className="chip">{t("Opening Wilma's answer form…")}</span> : null}
      </div>
      <textarea
        ref={area}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("Write your answer")}
        aria-label={t("Your answer")}
        disabled={stage.kind === "sending"}
      />
      {canFinnish ? <InFinnish on={inFinnish} setOn={setInFinnish} subject={null} text={text} value={fi} onChange={setFi} disabled={stage.kind === "sending" || stage.kind === "confirm"} /> : null}
      {stage.kind === "error" ? (
        <div className="notice err composer-error">
          <span>{stage.message}</span>
          {stage.ended ? (
            <button type="button" className="btn btn-sm" onClick={() => signInAgain(loginOfId(messageId))}>
              {t("Sign in again")}
            </button>
          ) : null}
        </div>
      ) : null}
      {stage.kind === "confirm" || stage.kind === "sending" ? (
        <div className="confirm">
          {finnish && ready ? <blockquote className="outgoing-preview" lang="fi">{ready.text}</blockquote> : null}
          <span>
            {stage.kind === "confirm" && stage.note ? <>{stage.note} </> : null}
            {sendQuestion}
            {demo ? ` ${t("(Sample family: nothing is really sent.)")}` : ""}
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
          <span className="hint">{text ? t("Draft saved on this device") : t("Drafts stay on this device until you send")}</span>
          {text ? (
            <button
              className="btn btn-quiet btn-sm"
              onClick={() => {
                const kept = text;
                const keptFi = fi;
                setText("");
                setFi(null);
                setStage({ kind: "closed" });
                showToast(t("Draft discarded"), () => (setText(kept), setFi(keptFi)));
              }}
            >
              {t("Discard draft")}
            </button>
          ) : null}
          <button className="btn btn-quiet btn-sm" onClick={() => setStage({ kind: "closed" })}>
            {t("Close")}
          </button>
          <button className="btn btn-primary btn-sm" disabled={!text.trim() || !form || stage.kind === "preparing" || (finnish && !ready)} onClick={() => form && setStage({ kind: "confirm", form })}>
            {t("Send…")}
          </button>
        </div>
      )}
    </div>
  );
}
