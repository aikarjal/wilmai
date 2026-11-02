/*
 * Items read together (lunaChecks.crossItem): each item is read alone, so a
 * trip cancelled in a later message, or an exam moved to another day, stays
 * in the calendar as the earlier item read it. Here every later item is
 * asked, with Luna's Decisions, about the events earlier items gave for the
 * days after it was sent: is that event cancelled, moved, or the same event
 * again (a reminder, a second announcement)? One call a later item, a
 * question an earlier event; the answers are kept in the later item's
 * reading (`links`), asked again when either side changes.
 *
 * The calendar leaves out an event a later item cancels or moves (the moved
 * event's new day comes from the later item's own reading) and shows the
 * same event once (calendar.ts, linkVerdicts).
 */
import { accountScope, getState, setState } from "../data/store";
import { LUNA_THRESHOLDS, lunaEventId, type LunaEvent, type LunaLink } from "../data/model";
import { dateOf, daysBetween } from "../data/dates";
import { decide, LunaError } from "./client";
import { day, hash, lunaSources, type LunaSource } from "./events";
import { providerIdentity, usesLocalAI } from "../ai/config";
import { intelligenceOn } from "../data/model";
import { noteGroups } from "../data/feed";
import { noteExamEvent } from "../data/note-exams";

/** The links' version: a change here asks again. */
export const LUNA_LINKS = "luna-links@1";
/** An event this many days after the later item was sent is too far to be about. */
const HORIZON = 120;
/** At most this many earlier events asked about a later item: those on the days of its own events first, then the nearest. */
const MAX_ASKED = 12;
const CONCURRENCY = 3;

const KIND_NAME: Record<LunaSource["kind"], string> = { message: "message", news: "bulletin", note: "teacher's note" };

interface Asked {
  src: LunaSource;
  e: LunaEvent;
  id: string;
}

/** What to ask: for each later item, the earlier items' events still ahead when it was sent, for its pupils. */
export function linkJobs(): { later: LunaSource; asked: Asked[]; h: string }[] {
  const { snapshot, luna } = getState();
  if (!snapshot) return [];
  const sources = lunaSources(snapshot);
  const T = LUNA_THRESHOLDS;
  const nextExams = new Map(snapshot.children.flatMap((c) => noteGroups(c.number, snapshot.perChild[c.number]?.notes ?? []).map((n) => [n.key, noteExamEvent(snapshot, n, luna[n.key])] as const)));
  const kept: Asked[] = sources.flatMap((src) =>
    [...(luna[src.key]?.events ?? []), ...(nextExams.get(src.key) ? [nextExams.get(src.key)!] : [])]
      .filter((e) => e.pDate >= T.keepDate && e.pCalendar + (e.pOptional ?? 0) >= T.keepCalendar)
      .map((e) => ({ src, e, id: lunaEventId(src.key, e) }))
  );
  const jobs: { later: LunaSource; asked: Asked[]; h: string }[] = [];
  for (const later of sources) {
    const rec = luna[later.key];
    if (!rec || rec.error || !later.sent) continue;
    const sentDay = dateOf(new Date(later.sent));
    // An earlier event on a day this item gives an event of its own is the likeliest to be the same one said again (a
    // reminder with another title), so it's asked about even when many others come sooner.
    const own = rec.events ?? [];
    const onOwnDay = (k: Asked) => own.some((e) => k.e.date <= (e.endDate ?? e.date) && (k.e.endDate ?? k.e.date) >= e.date);
    const asked = kept
      .filter(
        (k) =>
          k.src.key !== later.key &&
          k.src.sent < later.sent &&
          (k.e.endDate ?? k.e.date) >= sentDay &&
          daysBetween(sentDay, k.e.date) <= HORIZON &&
          k.src.children.some((c) => later.children.includes(c))
      )
      .sort((a, b) => Number(onOwnDay(b)) - Number(onOwnDay(a)) || a.e.date.localeCompare(b.e.date))
      .slice(0, MAX_ASKED);
    if (!asked.length) continue;
    const h = hash([LUNA_LINKS, providerIdentity(getState().settings), later.input, asked.map((a) => a.id)]);
    if (rec.links?.hash !== h) jobs.push({ later, asked, h });
  }
  return jobs;
}

/** Ask one later item about the earlier events. */
async function askLinks(later: LunaSource, asked: Asked[]): Promise<Record<string, LunaLink>> {
  const answers = await decide(
    later.input,
    asked.map((a, k) => ({
      type: "choice" as const,
      name: `about_${k}`,
      instructions: `An earlier ${KIND_NAME[a.src.kind]} ("${a.src.title}", ${day(dateOf(new Date(a.src.sent)))}) gave this event: "${a.e.title}" on ${day(a.e.date)}${a.e.endDate ? ` to ${day(a.e.endDate)}` : ""}${a.e.start ? ` at ${a.e.start}` : ""}, from the words "${a.e.quote}". What does this newer item say about that event?`,
      choices: [
        { value: "cancelled", description: "It is cancelled, or won't happen" },
        { value: "moved", description: "It moves to another day or time, or is put off" },
        { value: "same", description: "It is about the same event, still on that day: a reminder, more details, or the same announcement again" },
        { value: "nothing", description: "Nothing about that event: another event, or another group's" },
      ],
    }))
  );
  const pc = (name: string, value: string) => {
    const a = answers[name];
    return a?.type === "choice" ? (a.probabilities.find((x) => x.value === value)?.probability ?? 0) : 0;
  };
  return Object.fromEntries(
    asked.map((a, k): [string, LunaLink] => [a.id, { cancelled: pc(`about_${k}`, "cancelled"), moved: pc(`about_${k}`, "moved"), same: pc(`about_${k}`, "same"), what: `${a.e.date} ${a.e.title}` }])
  );
}

/** Ask what's waiting (after the reading, when lunaChecks.crossItem is on). */
export async function runLinks(): Promise<void> {
  if (!getState().settings.lunaChecks?.crossItem) return;
  const jobs = linkJobs();
  const identity = providerIdentity(getState().settings);
  const scope = accountScope();
  const current = () => scope === accountScope() && intelligenceOn(getState().settings) && providerIdentity(getState().settings) === identity;
  let next = 0;
  let stop: string | null = null;
  const worker = async () => {
    while (next < jobs.length && !stop && current()) {
      const { later, asked, h } = jobs[next++];
      try {
        const about = await askLinks(later, asked);
        if (!current()) return;
        setState((s) => (s.luna[later.key] ? { luna: { ...s.luna, [later.key]: { ...s.luna[later.key], links: { hash: h, about } } } } : {}));
      } catch (err) {
        // As in the reading: a refused key stops; a busy moment is asked again on the next run.
        if (!(err instanceof LunaError) || !err.retryable) stop = err instanceof Error ? err.message : String(err);
      }
    }
  };
  await Promise.all(Array.from({ length: usesLocalAI(getState().settings) ? 1 : CONCURRENCY }, worker));
  if (stop && current()) setState((s) => ({ lunaStatus: { ...s.lunaStatus, error: stop } }));
}
