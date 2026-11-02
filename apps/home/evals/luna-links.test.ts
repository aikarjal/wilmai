import { setNow } from "./shim.ts";
import test from "node:test";
import assert from "node:assert/strict";
import type { LunaEvent, LunaRecord } from "../src/data/model.ts";
import { lunaEventId } from "../src/data/model.ts";
import { setState } from "../src/data/store.ts";
import { linkJobs } from "../src/luna/links.ts";
import { buildFeed } from "../src/data/feed.ts";
import { calendarEvents } from "../src/data/calendar.ts";
import { demoSnapshot } from "../src/demo/demo.ts";

// A later item is asked (by the AI) whether earlier items' events are the same event said again. A school with a busy
// autumn gave a dozen events before its concert, so a reminder about the concert (with another title) was never asked
// about the concert at all, and the calendar showed it twice. The earlier events on the item's own days come first.
setNow(new Date("2026-11-02T09:00:00+02:00").getTime());

test("a later item is asked about the earlier events on its own days, however many come sooner", () => {
  const snapshot = demoSnapshot();
  const [earlier, later] = Object.values(snapshot.messages)
    .filter((m) => !m.sent && m.thread?.content && m.children.length)
    .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())
    .filter((m, _, all) => m.children.some((c) => all[0].children.includes(c)));
  const sentDay = later.sentAt.toISOString().slice(0, 10);
  const day = (n: number) => new Date(Date.parse(`${sentDay}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const event = (date: string, title: string, start: string | null = null): LunaEvent => ({ date, endDate: null, start, end: null, title, kind: "event", forWhom: "pupils_class", quote: title, pDate: 1, pCalendar: 0.95, pOptional: 0 });
  const record = (events: LunaEvent[]): LunaRecord => ({ v: "1", hash: "h", at: 0, action: null, events, dropped: 0 });
  const concert = event(day(20), "Syyskonsertti", "17:00");
  const busy = Array.from({ length: 12 }, (_, i) => event(day(1 + i), `Tapahtuma ${i + 1}`));
  setState({ snapshot, luna: { [`m:${earlier.id}`]: record([...busy, concert]), [`m:${later.id}`]: record([event(day(20), "Krunan syyskonsertti", "17:00")]) } });
  const job = linkJobs().find((j) => j.later.key === `m:${later.id}`);
  assert.ok(job, "the later item has earlier events to be asked about");
  assert.equal(job.asked.length, 12, "still at most a dozen");
  assert.equal(job.asked[0].id, lunaEventId(`m:${earlier.id}`, concert), "the concert on its own day first");
});

test("what the AI calls the same event is shown once a time, the bulletin's day without a time going into it", () => {
  const snapshot = demoSnapshot();
  const [first, second] = Object.values(snapshot.messages)
    .filter((m) => !m.sent && m.thread?.content && m.children.length)
    .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
  const bulletin = Object.values(snapshot.news).find((n) => n.detail?.content)!;
  const date = "2026-11-05";
  const event = (title: string, start: string | null): LunaEvent => ({ date, endDate: null, start, end: null, title, kind: "event", forWhom: "pupils_class", quote: title, pDate: 1, pCalendar: 0.95, pOptional: 0 });
  const same = (what: string) => ({ cancelled: 0, moved: 0, same: 1, what: `${date} ${what}` });
  const [b, m1, m2] = [`n:${bulletin.id}`, `m:${first.id}`, `m:${second.id}`];
  const earlier = [event("Syyskonsertit", null), event("Syyskonsertti", "17:00"), event("Syyskonsertti", "19:00")];
  const luna: Record<string, LunaRecord> = {
    [b]: { v: "1", hash: "h", at: 0, action: null, events: [earlier[0]], dropped: 0 },
    [m1]: { v: "1", hash: "h", at: 0, action: null, events: [earlier[1], earlier[2]], dropped: 0 },
    // The reminder, with another title: the AI said it's the bulletin's concerts and the first message's (one id for both times).
    [m2]: {
      v: "1",
      hash: "h",
      at: 0,
      action: null,
      events: [event("Krunan syyskonsertti", "17:00"), event("Krunan syyskonsertti", "19:00")],
      dropped: 0,
      links: { hash: "h", about: { [lunaEventId(b, earlier[0])]: same("Syyskonsertit"), [lunaEventId(m1, earlier[1])]: same("Syyskonsertti") } },
    },
  };
  const state = { snapshot, local: { opened: {}, done: {} }, jev: {}, luna };
  const day = calendarEvents(snapshot, buildFeed(state), undefined, { from: date, until: date, children: [] }, luna).filter((e) => e.kind === "event");
  assert.deepEqual(
    day.map((e) => [e.start, e.aliases ?? []]),
    [
      ["17:00", [`${m2}:${date}@17:00`]],
      ["19:00", [`${m2}:${date}@19:00`]],
    ]
  );
});
