/*
 * Settings → Children: how each child shows in the app. Their colour, a
 * nickname, and an emoji beside their coloured dot. Only on this computer, and
 * only for the screen: Wilma, the messages and the AI keep the child's real name.
 */
import { useEffect, useRef, useState } from "react";
import { COLORS, PALETTE, type Child } from "../data/model";
import { setChildLook, useApp } from "../data/store";
import { t } from "../i18n";
import { Tab } from "./bits";

/** Emojis children tend to pick, by kind (the first of each is its tab). */
const EMOJIS: { name: string; list: string[] }[] = [
  {
    name: "Animals",
    list: ["🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐸", "🐵", "🐶", "🐱", "🐰", "🐹", "🐭", "🦄", "🐲", "🦖", "🦕", "🐢", "🐙", "🦋", "🐝", "🐞", "🐧", "🦉", "🐬", "🐳", "🦈", "🐠", "🦒", "🐘", "🦓", "🦔", "🐿️", "🦜", "🦩", "🐴", "🐮", "🐷", "🐔", "🦦"],
  },
  { name: "Nature and sky", list: ["🌟", "⭐", "🌈", "☀️", "🌙", "⚡", "🔥", "❄️", "🌸", "🌻", "🌷", "🌵", "🍀", "🍁", "🌊", "🌍", "🪐", "☁️", "🌋", "🍄", "🌴", "🌺", "💧", "☃️"] },
  { name: "Food", list: ["🍓", "🍉", "🍌", "🍒", "🍎", "🍇", "🍍", "🥑", "🥕", "🌽", "🍕", "🍔", "🍟", "🌮", "🍩", "🍪", "🧁", "🍦", "🍭", "🍫", "🥨", "🍿", "🥞", "🧃"] },
  { name: "Sports and play", list: ["⚽", "🏀", "🏈", "⚾", "🎾", "🏐", "🏒", "⛸️", "🛹", "🚲", "🏊", "🤸", "🥋", "🎯", "🎳", "🏓", "🛷", "⛷️", "🏆", "🥇", "🧗", "🏇", "🤾", "🛼"] },
  { name: "Fun things", list: ["🎨", "🎸", "🎹", "🥁", "🎮", "🎲", "🧩", "🚀", "🛸", "🚂", "🚗", "🏎️", "✈️", "🎈", "🎁", "👑", "💎", "🏰", "🎪", "🤖", "📚", "🔭", "🪁", "🧸"] },
  { name: "Faces", list: ["😀", "😎", "🤓", "🥳", "😺", "🤠", "👻", "👽", "🦸", "🧙", "🧚", "🧜", "🥷", "🤩", "😜", "🙃", "🤗", "😇", "🤡", "💩", "❤️", "💜", "💙", "💚"] },
];
/** One emoji typed or pasted (its first character as one sees it), or null when it isn't one. */
function oneEmoji(text: string): string | null {
  const first = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text.trim())][0]?.segment;
  return first && /\p{Extended_Pictographic}/u.test(first) ? first : null;
}
const COLOR_NAMES = ["Blue", "Red", "Green", "Amber", "Violet", "Pink", "Teal", "Slate"];

export function ChildLooks() {
  const children = useApp((s) => s.snapshot?.children ?? []);
  if (!children.length) return null;
  return (
    <section className="card">
      <h2>{t("Children")}</h2>
      <p>{t("How each child shows in the app: a colour, a nickname and an emoji. Only here: Wilma, the messages and the AI keep their real names.")}</p>
      <div className="looks">
        {children.map((c) => (
          <LookRow key={c.number} child={c} />
        ))}
      </div>
    </section>
  );
}

function LookRow({ child }: { child: Child }) {
  const [nick, setNick] = useState(child.nick ?? "");
  useEffect(() => setNick(child.nick ?? ""), [child.nick]);
  return (
    <div className="look-row">
      <div className="look-preview">
        <Tab child={child} full emoji />
        <small>{child.name}</small>
      </div>
      <input
        className="look-name"
        value={nick}
        maxLength={20}
        placeholder={child.first}
        aria-label={t("Nickname for {name}", { name: child.first })}
        onChange={(e) => setNick(e.target.value)}
        onBlur={() => setChildLook(child.number, { nickname: nick.trim() || undefined })}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      {/* The strong colours above, the light ones (filled pale: an emoji says enough) under them. */}
      <div className="look-swatches" role="radiogroup" aria-label={t("Colour for {name}", { name: child.first })}>
        {Array.from({ length: COLORS }, (_, i) => {
          const name = i < PALETTE ? t(COLOR_NAMES[i]) : t("{color}, light", { color: t(COLOR_NAMES[i - PALETTE]) });
          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={child.color % COLORS === i}
              className={`look-swatch c${i}`}
              title={name}
              aria-label={name}
              onClick={() => setChildLook(child.number, { color: i === child.base ? undefined : i })}
            />
          );
        })}
      </div>
      <EmojiPicker child={child} />
    </div>
  );
}

/** The emoji button, and a grid of emojis to pick from (or none). */
function EmojiPicker({ child }: { child: Child }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const [kind, setKind] = useState(0);
  const [typed, setTyped] = useState("");
  const pick = (emoji: string | undefined) => {
    setChildLook(child.number, { emoji });
    setOpen(false);
    setTyped("");
  };
  return (
    <div className="look-emoji" ref={box}>
      <button type="button" className={child.emoji ? "set" : undefined} onClick={() => setOpen(!open)} aria-expanded={open} aria-label={t("Emoji for {name}", { name: child.first })} title={t("Emoji for {name}", { name: child.first })}>
        {child.emoji ?? "＋"}
      </button>
      {open ? (
        <div className="emoji-pop" role="dialog" aria-label={t("Emoji for {name}", { name: child.first })}>
          <div className="emoji-kinds" role="tablist">
            {EMOJIS.map((k, i) => (
              <button key={k.name} type="button" role="tab" aria-selected={kind === i} title={t(k.name)} aria-label={t(k.name)} onClick={() => setKind(i)}>
                {k.list[0]}
              </button>
            ))}
          </div>
          <div className="emoji-grid" role="radiogroup" aria-label={t(EMOJIS[kind].name)}>
            {EMOJIS[kind].list.map((e) => (
              <button key={e} type="button" role="radio" aria-checked={child.emoji === e} onClick={() => pick(e)}>
                {e}
              </button>
            ))}
          </div>
          <form
            className="emoji-own"
            onSubmit={(e) => {
              e.preventDefault();
              const emoji = oneEmoji(typed);
              if (emoji) pick(emoji);
            }}
          >
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t("Or type or paste any emoji")} aria-label={t("Or type or paste any emoji")} />
            <button type="submit" className="btn btn-sm" disabled={!oneEmoji(typed)}>
              {t("Use")}
            </button>
          </form>
          {child.emoji ? (
            <>
              <label className="emoji-tabs">
                <input type="checkbox" checked={Boolean(child.emojiTabs)} onChange={(e) => setChildLook(child.number, { emojiTabs: e.target.checked || undefined })} />
                <span>{t("Show {emoji} in place of {name}'s initials across the app", { emoji: child.emoji, name: child.nick ?? child.first })}</span>
              </label>
              <button type="button" className="linkish" onClick={() => pick(undefined)}>
                {t("No emoji")}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
