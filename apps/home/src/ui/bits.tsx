import type { CSSProperties, ReactNode } from "react";
import mascot from "../assets/mascot-128.png";
import type { Child, Snapshot } from "../data/model";
import type { FeedItem } from "../data/feed";
import { isNeedsYou } from "../data/feed";
import { useListed } from "../data/translations";
import { clock, dateOf, shortDate, whenShort } from "../data/dates";
import { shortLabel, tSense, urgencyLabel } from "./shared";
import { KINDS } from "../jev/questions";
import { toggleDoneWithUndo } from "./done";
import { plural, t } from "../i18n";

/* ---------- The app's name, with the mascot (also the app icon) ---------- */

export function Brand({ style }: { style?: CSSProperties }) {
  return (
    <div className="brand" style={style}>
      <img className="brand-mark" src={mascot} alt="" width={34} height={34} />
      WilmAI <small>home</small>
      <span className="beta-label">Beta</span>
    </div>
  );
}

/* ---------- Icons ---------- */

const paths: Record<string, ReactNode> = {
  today: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  inbox: <><path d="M3 13h5l1.5 3h5L16 13h5" /><path d="M5.5 5h13L21 13v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z" /></>,
  week: <><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4M7.5 13.5h3M13.5 13.5h3M7.5 17h3" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" /><path d="M4 3.5V8h4.5" /><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" /><path d="M20 20.5V16h-4.5" /></>,
  check: <path d="M4.5 12.5l5 5L19.5 7" />,
  undo: <><path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>,
  pin: <><path d="M12 16.5V21.5" /><path d="M8.5 3.5h7M9.5 3.5v5.2L6.5 13v1.5h11V13l-3-4.3V3.5" /></>,
  reply: <><path d="M9 17l-5-5 5-5" /><path d="M4 12h11a5 5 0 0 1 5 5v2" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>,
  back: <path d="M15 5l-7 7 7 7" />,
  left: <path d="M15 5l-7 7 7 7" />,
  right: <path d="M9 5l7 7-7 7" />,
  up: <path d="M5 15l7-7 7 7" />,
  down: <path d="M5 9l7 7 7-7" />,
  lock: <><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></>,
  device: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
  laptop: <><rect x="4" y="3.5" width="16" height="12" rx="2" /><path d="M4 15.5L2 19a1 1 0 0 0 1 1.5h18a1 1 0 0 0 1-1.5l-2-3.5M9 17.5h6" /></>,
  bell: <><path d="M6 16.5V11a6 6 0 0112 0v5.5l1.5 1.5h-15L6 16.5z" /><path d="M10 20.5a2 2 0 004 0" /></>,
  spark: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />,
  sparkles: <><path d="M9.5 3l2.1 5.9 5.9 2.1-5.9 2.1L9.5 19l-2.1-5.9L1.5 11l5.9-2.1zM19 2v4M17 4h4M20 16v6M17 19h6" /></>,
  star: <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />,
  book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" /></>,
  flag: <><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  bulletin: <><path d="M4 5h16v14H4z" /><path d="M8 9h8M8 13h8M8 17h5" /></>,
  note: <><path d="M5 3.5h10l4 4v13H5z" /><path d="M15 3.5v4h4M8.5 12h7M8.5 16h5" /></>,
  message: <path d="M4 5.5h16v11H9l-5 4z" />,
  pen: <><path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z" /><path d="M14.5 6.5l3 3" /></>,
  translate: <><path d="M4 5h7" /><path d="M9 3v2c0 4.4-2.2 8-5 8" /><path d="M5 9c0 2.1 3 3.9 6.7 4" /><path d="M12 20l4-9 4 9" /><path d="M19.1 18h-6.2" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  print: <><path d="M7 8.5V3.5h10v5" /><rect x="3.5" y="8.5" width="17" height="8" rx="2" /><path d="M7 13.5h10v7H7z" /></>,
  shirt: <path d="M8.5 3.5L3.5 6l1.6 4.2 2.4-1v11.3h9V9.2l2.4 1L20.5 6l-5-2.5c-.5 1.5-1.9 2.4-3.5 2.4s-3-.9-3.5-2.4z" />,
  grades: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  exam: <><rect x="5" y="4" width="14" height="17" rx="2.5" /><path d="M9 4V3h6v1M8.5 11l2 2 4-4M8.5 16.5h7" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" /></>,
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z" />,
  auto: <><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" /></>,
  sidebar: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M9 4v16" /></>,
  panel: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M15 4v16" /></>,
};

export function Icon({ name, className = "icon", label }: { name: keyof typeof paths | string; className?: string; label?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden={label ? undefined : true} role={label ? "img" : undefined} aria-label={label}>
      {paths[name]}
    </svg>
  );
}

/* ---------- Children ---------- */

/**
 * A child's tab in their colour: their name (or nickname), or short, their initials. The emoji only where it's asked
 * for (`emoji`: Settings' preview), or everywhere when the family chose it for that child (Settings → Children).
 */
export function Tab({ child, full = false, emoji = false }: { child: Child | undefined; full?: boolean; emoji?: boolean }) {
  if (!child) return null;
  const withEmoji = Boolean(child.emoji && (emoji || child.emojiTabs));
  return (
    <span className={`tab c${child.color % 16}${full ? " tab-name" : ""}`} title={child.name}>
      {full ? (
        <>
          {withEmoji ? <span className="tab-emoji">{child.emoji}</span> : null}
          {child.nick ?? child.first}
        </>
      ) : withEmoji ? (
        <span className="tab-emoji">{child.emoji}</span>
      ) : (
        shortLabel(child)
      )}
    </span>
  );
}

export function Tabs({ snap, numbers }: { snap: Snapshot; numbers: string[] }) {
  return (
    <span className="tabs">
      {numbers.map((n) => (
        <Tab key={n} child={snap.children.find((c) => c.number === n)} />
      ))}
    </span>
  );
}

/* ---------- Jev's mark ---------- */

/** Text with its web addresses as links (they open in the browser). */
export function Linked({ text }: { text: string }) {
  return (
    <>
      {text.split(/(https?:\/\/[^\s)]+)/g).map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noreferrer">
            {part}
          </a>
        ) : (
          part
        )
      )}
    </>
  );
}

export function Mark({ on, sweep, index = 0, children }: { on: boolean; sweep?: boolean; index?: number; children: ReactNode }) {
  return (
    <span className={`mark${on ? (sweep ? " on sweep" : " on") : ""}`} style={{ ["--i" as string]: index }}>
      {children}
    </span>
  );
}

export function TriageChips({ item, compact = false }: { item: FeedItem; compact?: boolean }) {
  const triage = item.triage;
  const chips: ReactNode[] = [];
  if (isNeedsYou(item)) {
    const when = item.task ? item.task.label : urgencyLabel(item);
    chips.push(
      <span key="act" className="chip chip-marker">
        {when ? t("Needs you · {when}", { when }) : t("Needs you")}
      </span>
    );
  }
  if (triage && triage.kindConfidence >= 0.45 && !(compact && triage.kind === "general")) {
    chips.push(
      <span key="kind" className="chip">
        {/* Jev's labels stay English in questions.ts (they're model input); translated only here. */}
        {t(KINDS[triage.kind]?.label ?? triage.kind)}
      </span>
    );
  }
  if (triage && triage.scope === "pupil" && triage.scopeConfidence >= 0.5) chips.push(<span key="about" className="chip chip-pen">{t("About your child")}</span>);
  else if (triage && triage.scope === "wider" && triage.scopeConfidence >= 0.5 && !compact) chips.push(<span key="wider" className="chip">{t("City or association")}</span>);
  if (item.tone === "praise") chips.push(<span key="tone" className="chip chip-good">{t("Praise")}</span>);
  if (item.tone === "concern" && !item.task) chips.push(<span key="tone" className="chip chip-warn">{t("Heads-up")}</span>);
  if (triage?.preliminary && isNeedsYou(item) && !compact) chips.push(<span key="pre" className="chip">{t("From the subject only")}</span>);
  if (item.invite) {
    const extra = item.invite.extra?.replace(/^(\d{1,2})\.(\d{1,2})\.\d{4}/, "$1.$2.");
    if (item.invite.chosen?.start) chips.push(<span key="inv" className="chip chip-good">{t("Signed up · {when}", { when: `${shortDate(dateOf(item.invite.chosen.start))} ${clock(item.invite.chosen.start)}` })}</span>);
    else if (item.invite.data?.declined || /dismiss/i.test(item.invite.status ?? "")) chips.push(<span key="inv" className="chip">{t("Won't attend")}</span>);
    else if (item.invite.status === "Applied") chips.push(<span key="inv" className="chip chip-good">{extra ? t("Signed up · {when}", { when: extra }) : t("Signed up")}</span>);
    else if (item.invite.status === "ExpiredReg") chips.push(<span key="inv" className="chip">{t("Sign-up closed")}</span>);
    else if (!item.task) chips.push(<span key="inv" className="chip chip-pen">{t("Invitation")}</span>);
  }
  if (item.replyCount > 0) chips.push(<span key="rep" className="chip">{plural(item.replyCount, "{n} reply", "{n} replies")}</span>);
  return chips.length ? <div className="row-chips">{chips}</div> : null;
}

const KIND_ICON: Record<FeedItem["kind"], string> = { message: "message", news: "bulletin", note: "note" };

export function ItemRow({
  item,
  snap,
  current = false,
  index = 0,
  sweep = false,
  href,
}: {
  item: FeedItem;
  snap: Snapshot;
  current?: boolean;
  index?: number;
  sweep?: boolean;
  href: string;
}) {
  const needs = isNeedsYou(item);
  const listed = useListed(item);
  const subject =
    item.kind === "note" && item.note
      ? `${listed.title === item.title ? item.note.typeLabel : listed.title} · ${item.note.subjects.length > 2 ? plural(item.note.subjects.length, "{n} lesson", "{n} lessons") : item.note.subjects.join(", ")}`
      : listed.title;
  return (
    <a className={`row kind-${item.kind}${item.done ? " done" : ""}`} href={href} aria-current={current ? "true" : undefined} data-key={item.key}>
      <Tabs snap={snap} numbers={item.children} />
      <div className="row-title">
        {item.isNew && !item.done ? <span className="new-dot" title={tSense("New", "one item")} /> : null}
        {item.pinnedAt ? <Icon name="pin" className="icon row-pin" label={t("Pinned")} /> : null}
        <Mark on={needs} sweep={sweep} index={index}>
          {subject}
        </Mark>
      </div>
      <div className="row-when">{whenShort(item.at)}</div>
      <div className="row-sub">
        <Icon name={KIND_ICON[item.kind]} className="icon" />
        {item.from ? <span className="from">{item.from}</span> : null}
        {needs && listed.action ? (
          // The school's own sentence saying what to do (Jev pointed to it; nothing is generated), translated when the item is.
          <span className="pv act" title={listed.action}>
            → {listed.action}
          </span>
        ) : (
          <span className="pv">{listed.preview}</span>
        )}
      </div>
      <TriageChips item={item} compact />
      <button
        className="btn btn-quiet btn-sm check"
        title={item.done ? t("Move back to open (E)") : t("Mark done (E). Only in this app; nothing changes in Wilma.")}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleDoneWithUndo(item);
        }}
      >
        <Icon name={item.done ? "undo" : "check"} />
        <span className="sr-only">{item.done ? t("Move back to open") : t("Mark done")}</span>
      </button>
    </a>
  );
}
