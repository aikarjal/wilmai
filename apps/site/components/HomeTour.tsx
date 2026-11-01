"use client";

import { gsap } from "gsap";
import { useEffect, useRef } from "react";
import tour from "../lib/home-tour.json";
import { loaded, playTour, timeline, type TourStep } from "./tour-engine";

/*
 * The hero's tour of WilmAI Home, made the way the product tours in my decks are: screens of the app, put in motion
 * with GSAP. scripts/capture-home-tour.mjs takes the screens from the app itself, with where their parts are
 * (lib/home-tour.json), so a new capture keeps the tour right; nothing is edited or measured by hand.
 *
 * Everything inside the window is laid out in the screens' own pixels (2×, "plate px") and scaled once to the
 * window's width. A section's moving parts are windows onto its screen (sprites), and the detail that matters lifts
 * where it is, as a card over its own place in the page. It moves between views the way the app does, never with a
 * cursor: the menu's selection moves and the page beside it changes at once, its rows arriving with it. Search
 * opens over the page you're on. A line under the window says what each part shows, changing with it. Playing,
 * pausing and the timeline: tour-engine.ts.
 *
 * - Without JavaScript, the first screen shows.
 * - Phones load the 1× screens, and a lifted card (and the search menu) grows to the window's width there, so it
 *   can be read.
 */

export const TOUR_SECTIONS = ["today", "message", "search", "week", "grades"] as const;
type Section = (typeof TOUR_SECTIONS)[number];
/** The timeline's labels, and the line under the window: Today and the inbox have two each. */
export type TourLabels = Record<Section, string> & {
  sections: string;
  paused: string;
  play: string;
  pause: string;
  captions: { today: [string, string]; message: [string, string]; search: string; week: string; grades: string };
};
type Lang = "en" | "fi";
type Rect = number[];
type Plate = { w: number; h: number; rects: Record<string, Rect[]> };

const [WW, WH] = tour.window;

export function HomeTour({ lang, label, labels }: { lang: Lang; label: string; labels: TourLabels }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => buildTour(root.current!, lang, labels), [lang, labels]);
  return (
    <div className="ht" ref={root}>
      <div className="ht-frame" role="img" aria-label={label}>
        {/* The first screen, until the tour is built (and for anyone without JavaScript). */}
        <img className="ht-poster" src={`/home-tour/${lang}/today.webp`} alt="" width={WW / 2} height={WH / 2} />
        <div className="ht-scaled" aria-hidden="true">
          <div className="ht-screen" />
          <div className="ht-pop" />
        </div>
        <span className="ht-paused" aria-hidden="true">{labels.paused}</span>
      </div>
      <div className="ht-controls">
        {/* Until the tour runs there's nothing to pause, and the first part is the one on show. */}
        <button type="button" className="ht-play" aria-label={labels.pause} hidden />
        <nav className="ht-timeline" aria-label={labels.sections}>
          {TOUR_SECTIONS.map((id, i) => (
            <button type="button" className={`ht-seg${i ? "" : " active"}`} aria-current={i ? undefined : "step"} key={id}>
              <span className="ht-bar">
                <i />
              </span>
              <span className="ht-lbl">{labels[id]}</span>
            </button>
          ))}
        </nav>
      </div>
      {/* What each part shows (the window's label says it all for screen readers). */}
      <p className="ht-caption" aria-hidden="true">
        {labels.captions.today[0]}
      </p>
    </div>
  );
}

interface View {
  v: HTMLDivElement;
  side: HTMLDivElement;
  main: HTMLDivElement;
  mv: HTMLDivElement;
}
interface Step extends TourStep {
  id: Section;
  view: string;
}

function buildTour(host: HTMLElement, lang: Lang, labels: TourLabels): () => void {
  const plates = tour[lang] as Record<string, Plate>;
  const small = matchMedia("(max-width: 760px)").matches;
  const src = (plate: string) => `/home-tour/${lang}/${plate}${small ? "-1x" : ""}.webp`;
  const q = <T extends Element>(sel: string) => host.querySelector<T>(sel)!;
  const frame = q<HTMLDivElement>(".ht-frame"), scaled = q<HTMLDivElement>(".ht-scaled");
  const screen = q<HTMLDivElement>(".ht-screen"), pop = q<HTMLDivElement>(".ht-pop");
  const poster = q<HTMLImageElement>(".ht-poster");
  const said = labels.captions;

  // ---------------------------------------------------------------- the window's scale
  const fit = () => {
    scaled.style.transform = `scale(${frame.clientWidth / WW})`;
  };
  const sized = new ResizeObserver(fit);
  sized.observe(frame);
  fit();

  // ---------------------------------------------------------------- building blocks (plate px)
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: Element) => {
    const n = document.createElement(tag);
    n.className = cls;
    parent.appendChild(n);
    return n;
  };
  const place = <T extends HTMLElement>(n: T, [x0, y0, x1, y1]: Rect) => {
    Object.assign(n.style, { left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
    (n as T & { _rect: Rect })._rect = [x0, y0, x1, y1];
    return n;
  };
  // A window onto `plate` at `rect`, drawn at the same spot.
  const sprite = (parent: Element, plate: string, rect: Rect, cls = "ht-sp") => {
    const n = place(el("div", cls, parent), rect);
    n.style.backgroundImage = `url(${src(plate)})`;
    n.style.backgroundPosition = `${-rect[0]}px ${-rect[1]}px`;
    n.style.backgroundSize = `${plates[plate].w}px ${plates[plate].h}px`;
    return n;
  };
  const box = (parent: Element, rect: Rect, color: string, cls = "ht-box") => {
    const n = place(el("div", cls, parent), rect);
    n.style.background = color;
    return n;
  };
  const centre = (r: Rect) => [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];
  const union = (rs: Rect[]): Rect => [Math.min(...rs.map((r) => r[0])), Math.min(...rs.map((r) => r[1])), Math.max(...rs.map((r) => r[2])), Math.max(...rs.map((r) => r[3]))];
  const SHEET = "#ffffff"; // the app's cards, light theme

  const views: Record<string, View> = {};
  // A view: the menu stays put while the page beside it (mv) moves.
  const view = (id: string, plate: string) => {
    const { w, h } = plates[plate];
    const side = plates[plate].rects.main[0][0];
    const v = el("div", "ht-view", screen);
    const img = (parent: Element) => {
      const i = el("img", "", parent);
      i.src = src(plate);
      i.alt = "";
      Object.assign(i.style, { width: `${w}px`, height: `${h}px` });
    };
    const sideBox = place(el("div", "ht-side", v), [0, 0, side, WH]);
    img(sideBox);
    const main = place(el("div", "ht-main", v), [side, 0, WW, WH]);
    const mv = el("div", "ht-mv", main);
    Object.assign(mv.style, { left: `${-side}px`, width: `${w}px`, height: `${h}px` });
    img(mv);
    return (views[id] = { v, side: sideBox, main, mv });
  };

  // ---------------------------------------------------------------- shared moments
  const transients: HTMLElement[] = [];
  const keep = <T extends HTMLElement>(n: T) => (transients.push(n), n);
  // A card that starts exactly over its source pixels, then lifts where it is.
  const card = (plate: string, rect: Rect) => keep(sprite(pop, plate, rect, "ht-sp ht-card"));
  /** Something at `r` grown by `scale` around its own middle, moved only as far as it takes to stay inside the
   *  window with a gutter. On a phone the whole window is too small to read, so it grows to the window's width. */
  const grow = (r: Rect, scale: number) => {
    const w = r[2] - r[0], h = r[3] - r[1];
    const to = small ? Math.max(scale, Math.min((0.92 * WW) / w, (0.84 * WH) / h)) : scale;
    const inside = (mid: number, size: number, room: number) => {
      const half = (size * to) / 2, gutter = 0.04 * room;
      return half + gutter > room - half - gutter ? room / 2 : Math.min(Math.max(mid, half + gutter), room - half - gutter);
    };
    const [hx, hy] = centre(r);
    return { x: inside(hx, w, WW) - hx, y: inside(hy, h, WH) - hy, scale: to };
  };
  // It covers its own place in the page, so it shows once, and what it's about stays in view around it.
  const lift = (tl: gsap.core.Timeline, c: HTMLElement, scale: number, at: number) => {
    tl.set(c, { autoAlpha: 1, x: 0, y: 0, scale: 1 }, at);
    tl.to(c, { ...grow((c as HTMLElement & { _rect: Rect })._rect, scale), duration: 0.7, ease: "expo.out", boxShadow: "0 0 0 6px rgba(15,23,42,0.06), 0 70px 160px rgba(15,23,42,0.30)" }, at);
  };
  const settle = (tl: gsap.core.Timeline, c: HTMLElement, at: number) => {
    tl.to(c, { x: 0, y: 0, scale: 1, duration: 0.5, ease: "power3.inOut", boxShadow: "0 0 0 6px rgba(15,23,42,0), 0 0 0 rgba(15,23,42,0)" }, at);
    tl.set(c, { autoAlpha: 0 }, at + 0.5);
  };
  const shared = {
    // Under a lifted card, the app dims a little.
    dim: keep(box(screen, [0, 0, WW, WH], "#0f172a", "ht-layer")),
    ring: keep(el("div", "ht-layer ht-ring", screen)),
  };
  const dim = (tl: gsap.core.Timeline, at: number, on: boolean) => tl.to(shared.dim, { autoAlpha: on ? 0.08 : 0, duration: 0.4, ease: "sine.inOut" }, at);
  const ring = (tl: gsap.core.Timeline, r: Rect, at: number, off: number) => {
    const pad = 12;
    tl.set(shared.ring, { left: r[0] - pad, top: r[1] - pad, width: r[2] - r[0] + 2 * pad, height: r[3] - r[1] + 2 * pad }, at);
    tl.fromTo(shared.ring, { autoAlpha: 0, scale: 1.06 }, { autoAlpha: 1, scale: 1, duration: 0.45, ease: "expo.out", immediateRender: false }, at);
    tl.to(shared.ring, { autoAlpha: 0, duration: 0.25 }, off);
  };
  // Rows that arrive one by one, each a window onto the screen, over a cover that hides the originals.
  const rowsIn = (v: View, plate: string, rects: Rect[], cover = SHEET) => {
    box(v.mv, union(rects), cover);
    return rects.map((r) => sprite(v.mv, plate, r));
  };

  // ---------------------------------------------------------------- sections
  const STEPS: Step[] = [];
  // A page's rows start arriving as soon as the page is there (seconds before its part's view is in), so no list
  // sits empty in between.
  const ARRIVE = 0.6;
  // What Messages ends on, which Search opens over.
  let messagesDone = () => {};
  // The tour's first view takes over from the picture the page shows before it runs (.ht-poster): Today, whole. So
  // the first time it's drawn, its rows are already in, as in the picture, and nothing changes as one becomes the
  // other.
  let opening = true;

  // Today: each child's school day arrives, what needs you lifts out, then the page runs down to the results.
  (() => {
    const r = plates.today.rects;
    const v = view("today", "today");
    const days = rowsIn(v, "today", r.days);
    const needs = card("today", r.needs[0]);
    const down = Math.max(0, plates.today.h - WH);
    STEPS.push({
      id: "today", view: "today", still: 2.0, heads: [[0, said.today[0]], [1.3, said.today[1]]],
      reset() {
        gsap.set(days, opening ? { autoAlpha: 1, y: 0 } : { autoAlpha: 0, y: 24 });
        gsap.set(v.mv, { y: 0 });
      },
      build(tl, t) {
        if (!opening) tl.to(days, { autoAlpha: 1, y: 0, duration: 0.55, ease: "expo.out", stagger: 0.14 }, t - ARRIVE);
        dim(tl, t + 1.3, true);
        lift(tl, needs, 1.3, t + 1.3);
        dim(tl, t + 4.0, false);
        settle(tl, needs, t + 4.0);
        tl.to(v.mv, { y: -down, duration: 1.8, ease: "power2.inOut" }, t + 4.7);
      },
    });
  })();

  // The inbox: messages and bulletins arrive in one list, then an answer to a teacher lifts out and is typed.
  (() => {
    const r = plates.message.rects;
    const v = view("message", "message");
    const lines = rowsIn(v, "message", r.lines);
    const [composer] = r.composer, [typed] = r.typed;
    const reply = card("message", composer);
    // the answer, typed into the lifted card: the field starts empty and lets its words in a letter at a time
    const local = (x: Rect): Rect => [x[0] - composer[0], x[1] - composer[1], x[2] - composer[0], x[3] - composer[1]];
    box(reply, local(typed), SHEET);
    const words = place(el("div", "ht-sp", reply), local(typed));
    Object.assign(words.style, { backgroundImage: `url(${src("message")})`, backgroundPosition: `${-typed[0]}px ${-typed[1]}px`, backgroundSize: `${plates.message.w}px ${plates.message.h}px` });
    // with a caret at the end of what's typed so far (it holds still while keys go down, then blinks)
    const [wx0, wy0, wx1, wy1] = local(typed);
    const caret = place(el("div", "ht-caret", reply), [wx0, wy0, wx0 + 4, wy1]);
    // and the field under it empty too, until the card settles back with the words in it
    const empty = box(v.mv, typed, SHEET);
    messagesDone = () => {
      gsap.set(lines, { autoAlpha: 1, y: 0 });
      gsap.set(empty, { autoAlpha: 0 });
    };
    STEPS.push({
      id: "message", view: "message", still: 4.2, heads: [[0, said.message[0]], [2.3, said.message[1]]],
      reset() {
        gsap.set(lines, { autoAlpha: 0, y: 18 });
        gsap.set(words, { clipPath: "inset(0% 100% 0% 0%)" });
        gsap.set(caret, { autoAlpha: 0, x: 0 });
        gsap.set(empty, { autoAlpha: 1 });
      },
      build(tl, t) {
        tl.to(lines, { autoAlpha: 1, y: 0, duration: 0.5, ease: "expo.out", stagger: 0.07 }, t - ARRIVE);
        if (r.news[0]) ring(tl, r.news[0], t + 1.1, t + 2.1);
        dim(tl, t + 2.4, true);
        lift(tl, reply, 1.12, t + 2.4);
        tl.set(caret, { autoAlpha: 1 }, t + 2.8);
        const keys = { v: 0 };
        tl.add(
          gsap.to(keys, {
            v: 16,
            duration: 0.9,
            ease: "none",
            onUpdate: () => {
              const k = Math.floor(keys.v) / 16;
              words.style.clipPath = `inset(0% ${(1 - k) * 100}% 0% 0%)`;
              caret.style.transform = `translateX(${k * (wx1 - wx0)}px)`;
              caret.classList.toggle("is-typing", keys.v > 0 && keys.v < 16);
            },
          }),
          t + 3.1,
        );
        dim(tl, t + 5.2, false);
        settle(tl, reply, t + 5.2);
        tl.set(empty, { autoAlpha: 0 }, t + 5.2);
      },
    });
  })();

  // Search: ⌘K over the page you're on (Messages), the query typed, the results in.
  (() => {
    const r = plates.search.rects;
    const backdrop = keep(box(screen, [0, 0, WW, WH], "rgba(15,23,42,0.28)", "ht-layer")); // the app's ::backdrop
    const [mx, my] = r.menu[0];
    const menu = keep(sprite(screen, "search", r.menu[0], "ht-layer ht-sp ht-menu"));
    // What changes in the menu is drawn in it (in its own px), so it arrives and moves with the menu.
    const inMenu = (x: Rect): Rect => [x[0] - mx, x[1] - my, x[2] - mx, x[3] - my];
    const part = (x: Rect) => {
      const n = place(el("div", "ht-sp", menu), inMenu(x));
      Object.assign(n.style, { backgroundImage: `url(${src("search")})`, backgroundPosition: `${-x[0]}px ${-x[1]}px`, backgroundSize: `${plates.search.w}px ${plates.search.h}px` });
      return n;
    };
    const field = r.input[0];
    // the query, typed: the field starts empty and its text is let in a letter at a time
    box(menu, inMenu(field), SHEET);
    const typed = part(field);
    // its headings and results, in the page's order
    box(menu, inMenu(union(r.lines)), SHEET);
    const lines = r.lines.map(part);
    STEPS.push({
      id: "search", view: "message", still: 2.0, heads: [[0, said.search]],
      reset() {
        // Messages as it ends (it's there already when the tour plays on; a jump from elsewhere lands on it so)
        messagesDone();
        gsap.set(typed, { clipPath: "inset(0% 100% 0% 0%)" });
        gsap.set(lines, { autoAlpha: 0, y: 16 });
      },
      build(tl, t) {
        // It opens as the line under the window changes, and the query goes in as soon as it's open, so the menu
        // isn't left empty for long.
        const o = t - 0.4;
        tl.fromTo(backdrop, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3, ease: "sine.out", immediateRender: false }, o);
        tl.fromTo(menu, { autoAlpha: 0, scale: 0.97, y: 20 }, { autoAlpha: 1, ...grow(r.menu[0], 1), duration: 0.5, ease: "expo.out", immediateRender: false }, o);
        // the query ("koe", "exam"), a step at a time across where its words are in the field
        const [fx0, , fx1] = field;
        const [qx0, , qx1] = r.query?.[0] ?? [fx0, 0, fx0 + (fx1 - fx0) / 8];
        const STEPS = 4;
        for (let k = 1; k <= STEPS; k++) {
          const right = k === STEPS ? 0 : (100 * (fx1 - (qx0 + ((qx1 - qx0) * k) / STEPS))) / (fx1 - fx0);
          tl.to(typed, { clipPath: `inset(0% ${right}% 0% 0%)`, duration: 0.01 }, o + 0.33 + k * 0.12);
        }
        tl.to(lines, { autoAlpha: 1, y: 0, duration: 0.45, ease: "expo.out", stagger: 0.09 }, o + 0.9);
      },
    });
  })();

  // The week: both children's days drawn in, a lesson picked, and its day's schedule (beside the week) lifts out.
  (() => {
    const r = plates.week.rects;
    const v = view("week", "week");
    const cols = rowsIn(v, "week", r.cols);
    const day = card("week", union(r.day));
    STEPS.push({
      id: "week", view: "week", still: 2.8, heads: [[0, said.week]],
      reset() {
        gsap.set(cols, { clipPath: "inset(0% 0% 100% 0%)" });
      },
      build(tl, t) {
        tl.to(cols, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.8, ease: "expo.out", stagger: 0.1 }, t - ARRIVE);
        ring(tl, r.picked[0], t + 1.0, t + 1.9);
        dim(tl, t + 1.9, true);
        lift(tl, day, 1.15, t + 1.9);
        dim(tl, t + 4.6, false);
        settle(tl, day, t + 4.6);
      },
    });
  })();

  // Grades: each child's results arrive, and the newest lifts out.
  (() => {
    const r = plates.grades.rects;
    const v = view("grades", "grades");
    const rows = rowsIn(v, "grades", r.rows.slice(0, 6)).concat(rowsIn(v, "grades", r.rows.slice(6)));
    const newest = card("grades", r.rows[1]);
    STEPS.push({
      id: "grades", view: "grades", still: 2.1, heads: [[0, said.grades]],
      reset() {
        gsap.set(rows, { autoAlpha: 0, y: 18 });
      },
      build(tl, t) {
        tl.to(rows, { autoAlpha: 1, y: 0, duration: 0.5, ease: "expo.out", stagger: 0.07 }, t - ARRIVE);
        dim(tl, t + 1.4, true);
        lift(tl, newest, 1.06, t + 1.4);
        dim(tl, t + 4.0, false);
        settle(tl, newest, t + 4.0);
      },
    });
  })();

  gsap.set(transients, { autoAlpha: 0 });
  gsap.set(Object.values(views).map((x) => x.v), { autoAlpha: 0 });

  // ---------------------------------------------------------------- views
  let shown: View | null = null;

  // As in the app: the menu's selection moves (its two looks crossfade quickly, like a click) and the page beside it
  // changes at once, its rows arriving next. Nothing slides or shows through, so the app's frame holds still.
  function switchView(id: string) {
    const next = views[id];
    const prev = shown;
    opening = !prev;
    const tl = timeline();
    Object.values(views).forEach((x) => {
      if (x !== next && x !== prev) gsap.set(x.v, { autoAlpha: 0 });
    });
    if (prev === next) {
      gsap.set(next.v, { autoAlpha: 1, zIndex: 2 });
      return tl;
    }
    if (prev) {
      gsap.set(prev.v, { zIndex: 1 });
      tl.fromTo(next.side, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.12, ease: "sine.out" }, 0);
      gsap.set(next.main, { autoAlpha: 0 });
      tl.set(next.main, { autoAlpha: 1 }, 0.06);
      tl.set(prev.v, { autoAlpha: 0 }, 0.15);
    } else tl.fromTo([next.side, next.main], { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.45, ease: "sine.inOut" }, 0);
    gsap.set(next.v, { autoAlpha: 1, zIndex: 2 });
    shown = next;
    return tl;
  }

  const stop = playTour(host, {
    steps: STEPS.map((step) => ({ ...step, enter: () => switchView(step.view) })),
    frame,
    labels,
    transients,
    // The first screen loaded before anything moves, so the window never shows empty.
    ready: loaded(src("today")),
    // the first screen stays up until a view is drawn over it
    drawn: () => gsap.set(poster, { autoAlpha: 0 }),
    name: "__homeTour",
  });

  return () => {
    stop();
    sized.disconnect();
    screen.replaceChildren();
    pop.replaceChildren();
    gsap.set(poster, { autoAlpha: 1 });
  };
}
