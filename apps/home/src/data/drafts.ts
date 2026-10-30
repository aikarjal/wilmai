/*
 * New-message drafts on this device: a child's drafts, one per recipient, so a draft only comes back when writing
 * to the person it was written to. What the app fills in (a note's subject, say) isn't a draft until the parent
 * writes something; the composer decides that, these are the rules for what's kept and what opens.
 */

import type { Outgoing } from "../ai/outgoing";

/** What the parent wrote, and its Finnish when they write in another language (ai/outgoing.ts). */
export type Draft = { subject: string; text: string; finnish?: Outgoing };
/** A child's drafts by who they're to (`draftTo`); "" is one from before drafts knew who they were to. */
export type Drafts = Record<string, Draft>;

/** Who a compose link writes to: its recipient parameters ("r_teacher=3001"), the same in every list Wilma names them in. */
export function draftTo(composePath: string): string {
  const params = [...new URL(composePath, "https://wilma.invalid").searchParams].filter(([k]) => k.startsWith("r_"));
  return params.length ? params.map(([k, v]) => `${k}=${v}`).sort().join("&") : composePath;
}

const isDraft = (d: unknown): d is Draft => Boolean(d) && typeof (d as Draft).subject === "string" && typeof (d as Draft).text === "string";

/** A child's drafts as stored. The old form, one draft to no one in particular, comes back under "" if it has a message in it. */
export function readDrafts(raw: string | null): Drafts {
  let value: unknown;
  try {
    value = JSON.parse(raw ?? "{}");
  } catch {
    return {};
  }
  if (!value || typeof value !== "object") return {};
  // Up to 0.1.6: { subject, text }. A subject alone was most likely filled in from a note, not written.
  if (isDraft(value)) return value.text.trim() ? { "": { subject: value.subject, text: value.text } } : {};
  return Object.fromEntries(Object.entries(value).filter(([, d]) => isDraft(d))) as Drafts;
}

/** The drafts stored again: null when there are none left. */
export function writeDrafts(drafts: Drafts): string | null {
  return Object.keys(drafts).length ? JSON.stringify(drafts) : null;
}

/**
 * What the composer opens with when writing to `to`, before the parent has written anything: their draft, unless it's
 * only a subject and the parent came with one (from a note); else that subject. `anyone`: opened without a teacher in
 * mind, when an old draft to no one in particular can come back too. `from` is the draft that opened, if one did.
 */
export function openDraft(drafts: Drafts, to: string, initialSubject: string | null, anyone: boolean): { words: Draft; from: string | null } {
  const from = to in drafts ? to : anyone && "" in drafts ? "" : null;
  const saved = from === null ? null : drafts[from];
  if (saved && (saved.text || !initialSubject)) return { words: { ...saved }, from };
  return { words: { subject: initialSubject || "", text: "" }, from: null };
}

/** The drafts once the parent's words are saved as theirs to `to`, moved from `from` (the draft they opened); no words, no draft. */
export function saveDraft(drafts: Drafts, to: string, words: Draft, from: string | null): Drafts {
  const next = { ...drafts };
  if (from !== null) delete next[from];
  if (words.subject || words.text) next[to] = { subject: words.subject, text: words.text, ...(words.finnish ? { finnish: words.finnish } : {}) };
  else delete next[to];
  return next;
}
