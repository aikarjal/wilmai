/*
 * A family's Wilma logins. A parent with children at schools on different Wilmas (another town, an upper secondary
 * school with its own Wilma) signs in to each, and the app shows them together; a student has one Wilma. Every login
 * has a slot: 0 for the first one, 1, 2, … for those added later (never reused).
 *
 * Each Wilma numbers its own children, messages and bulletins, so two Wilmas can use the same numbers. In the
 * family's snapshot an added login's child is "12345@1", and its message and bulletin ids are slot × 2³² + Wilma's own
 * id. The first login's keep Wilma's own numbers, so nothing stored before (AI answers, Done, drafts) changes.
 *
 * Wilma can list a child twice (a new profile at a new school, the old one for a while): the parent unticks the one
 * not wanted (Login.hidden). An unticked child isn't read from Wilma or shown, and what was read stays.
 */
import { firstName, type AccountInfo, type Child, type Login, type Snapshot } from "./model";

/** Wilma's ids are 32-bit; an added login's ids start above them. */
const SLOT = 2 ** 32;

export const familyId = (slot: number, wilmaId: number): number => slot * SLOT + wilmaId;
export const loginOfId = (id: number): number => Math.floor(id / SLOT);
export const wilmaIdOf = (id: number): number => id % SLOT;

export const familyChild = (slot: number, number: string): string => (slot ? `${number}@${slot}` : number);
export const loginOfChild = (child: string): number => Number(/@(\d+)$/.exec(child)?.[1] ?? 0);
export const wilmaNumber = (child: string): string => child.replace(/@\d+$/, "");

type Family = Pick<Snapshot, "account" | "logins" | "children" | "firstSyncAt">;

/** The family's logins, in slot order. An installation from before has its first login only. */
export function logins(snap: Family): Login[] {
  return snap.logins ?? [{ slot: 0, account: snap.account, students: snap.children.map((c) => ({ number: c.number, name: c.name })), firstSyncAt: snap.firstSyncAt }];
}

export function loginOf(snap: Family, slot: number): Login | null {
  return logins(snap).find((l) => l.slot === slot) ?? null;
}

export function accountOf(snap: Family, slot: number): AccountInfo | null {
  return loginOf(snap, slot)?.account ?? null;
}

/** When the app first read a login's Wilma: what came before doesn't count as new, nor notify. */
export function firstSyncOf(snap: Family, slot: number): number {
  return loginOf(snap, slot)?.firstSyncAt ?? (slot ? 0 : (snap.firstSyncAt ?? 0));
}

/** Whose login an item came through: its first child's. */
export const loginOfItem = (item: { children: string[] }): number => (item.children[0] ? loginOfChild(item.children[0]) : 0);

/** The school's Wilma as people know it: its name in the list of Wilmas, else its address. */
export const schoolOf = (account: Pick<AccountInfo, "tenantName" | "baseUrl">): string => account.tenantName ?? new URL(account.baseUrl).host;

/** A page of one child's own Wilma: wilmaPage(snap, "12345@1", "attendance"). */
export function wilmaPage(snap: Family, child: string, path: string): string {
  const account = accountOf(snap, loginOfChild(child)) ?? snap.account;
  return `${account.baseUrl}/!${wilmaNumber(child)}/${path}`;
}

/** The same Wilma: one login per Wilma in a family (another guardian's login there would list the same children). */
export const sameWilma = (a: string, b: string): boolean => a.replace(/\/$/, "").toLowerCase() === b.replace(/\/$/, "").toLowerCase();

/** The slot for a login: its own when the family has that Wilma already, else one never used before. */
export function slotFor(snap: Family & Pick<Snapshot, "lastSlot">, account: Pick<AccountInfo, "baseUrl">): number {
  const all = logins(snap);
  const known = all.find((l) => sameWilma(l.account.baseUrl, account.baseUrl));
  if (known) return known.slot;
  return Math.max(snap.lastSlot ?? 0, ...all.map((l) => l.slot)) + 1;
}

/**
 * The children shown: each login's as its Wilma lists them, in slot order, less the unticked. Colours go by place
 * among all of them, so ticking one doesn't recolour the others.
 */
export function familyChildren(all: Login[]): Child[] {
  const hidden = new Set(all.flatMap((l) => l.hidden ?? []));
  return [...all]
    .sort((a, b) => a.slot - b.slot)
    .flatMap((l) => l.students ?? [])
    .map((s, i) => ({ number: s.number, name: s.name, first: firstName(s.name), color: i }))
    .filter((c) => !hidden.has(c.number));
}

/** Whether an item is about a child shown (an unticked child's messages and bulletins stay, unshown and unread). */
export const aboutShown = (snap: Pick<Snapshot, "children">, children: string[]): boolean => children.some((c) => snap.children.some((k) => k.number === c));

/**
 * Which screen shows: the app, once every Wilma of the family is signed in; otherwise the Wilma page, where the parent
 * (or student) sets everything up and signs in. The Wilma page also shows from the app (#/wilmas). The sample family
 * is always in the app, and its Wilma page (#/wilmas) shows its two schools as signed in, to look at.
 */
export function screenFor(phase: "loading" | "signed-out" | "ready", via: AccountInfo["via"] | null, view: string): "loading" | "wilmas" | "app" {
  if (phase === "loading") return "loading";
  if (via === "demo") return view === "wilmas" ? "wilmas" : "app";
  return phase === "ready" && view !== "wilmas" ? "app" : "wilmas";
}
