import { gsap } from "gsap";

/*
 * The playback both hero tours share (HomeTour on the Home page, AssistantTour on the front page), made the way the
 * product tours in my decks are: sections in a GSAP timeline, a line under the window that changes with them, and a
 * timeline of the sections under it. Each tour builds its own window and sections; this plays them.
 *
 * - It plays only while it's on screen (and the tab is shown). The button by the timeline (or a click on the window)
 *   pauses and resumes it, and the timeline jumps to a section.
 * - With less motion asked for, each section is one still frame, and the timeline steps between them.
 *
 * The tour's markup: the window (`frame`), a `.ht-paused` tag in it, a `.ht-play` button, a `.ht-seg` button per
 * section (with a `.ht-bar i` to fill) and the `.ht-caption` line.
 */

export interface TourStep {
  id: string;
  /**
   * The line under the window, from these seconds into the section's build; with a third, where it goes (called as
   * its words change, while it's out of sight: the Home tour's sits beside what each part is about).
   */
  heads: [number, string, (() => void)?][];
  /** Seconds into the section's build that its still frame shows. */
  still: number;
  reset?: () => void;
  /** The section's view coming in, before its build. */
  enter?: () => gsap.core.Timeline;
  build: (tl: gsap.core.Timeline, t: number) => void;
}

export interface TourOptions {
  steps: TourStep[];
  /** The window: a click on it pauses and resumes. */
  frame: HTMLElement;
  labels: { play: string; pause: string };
  /** What a section clears when it starts (faded out, then put back in place). */
  transients: HTMLElement[];
  /** Ready to move (the first screen loaded, say): until then the page shows what it has. */
  ready: Promise<void>;
  /** Once a section's view is drawn (the Home tour's first screen goes). */
  drawn?: () => void;
  /** The first section begins at its still frame (it's in the page already) and goes on from there. */
  firstFromStill?: boolean;
  /** For checks: window[name] has showStill, goTo, the steps and the state. */
  name: string;
}

/** Moves stay 2D: a 3D layer gets its own texture at its unscaled size, which a phone runs out of memory for. */
export const timeline = (vars?: gsap.TimelineVars) => gsap.timeline({ ...vars, defaults: { force3D: false } });

export function playTour(host: HTMLElement, o: TourOptions): () => void {
  const { steps, frame, labels, transients } = o;
  const q = <T extends Element>(sel: string) => host.querySelector<T>(sel)!;
  const headline = q<HTMLParagraphElement>(".ht-caption");
  const pausedTag = q<HTMLSpanElement>(".ht-paused");
  const playBtn = q<HTMLButtonElement>(".ht-play");
  const segs = [...host.querySelectorAll<HTMLButtonElement>(".ht-seg")];
  const fills = segs.map((s) => s.querySelector("i")!);

  let current: gsap.core.Timeline | null = null;
  let index = -1;
  let still = false; // less motion: each section is one frame
  let paused = false; // the viewer paused it
  let seen = false; // on screen
  const running = () => !still && !paused && seen && !document.hidden;

  function clearTransients() {
    const tl = timeline();
    tl.to(transients, { autoAlpha: 0, duration: 0.25, ease: "sine.in" }, 0);
    tl.call(() => gsap.set(transients, { x: 0, y: 0, scale: 1, clearProps: "boxShadow" }), undefined, 0.26);
    return tl;
  }

  // The line under the window changes: out upwards, the new words in from below (as in the decks' tours).
  function caption(text: string, place?: () => void) {
    const tl = timeline();
    tl.to(headline, { autoAlpha: 0, y: -10, duration: 0.22, ease: "power2.in" }, 0);
    tl.call(() => {
      headline.textContent = text;
      place?.();
    }, undefined, 0.23);
    tl.fromTo(headline, { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: "expo.out", immediateRender: false }, 0.24);
    return tl;
  }

  /** Section i from its start (`instant`: from where its build begins, or `at` seconds into the build). */
  function goTo(i: number, { instant = false, at }: { instant?: boolean; at?: number } = {}) {
    current?.kill();
    const step = steps[i];
    index = i;
    segs.forEach((s, j) => {
      s.classList.toggle("active", j === i);
      s.setAttribute("aria-current", j === i ? "step" : "false");
      gsap.set(fills[j], { scaleX: j < i ? 1 : 0 });
    });
    const tl = timeline({
      onUpdate: () => {
        gsap.set(fills[i], { scaleX: tl.progress() });
      },
      onComplete: () => {
        if (running()) goTo((i + 1) % steps.length);
      },
    });
    tl.add(clearTransients(), 0);
    tl.call(() => step.reset?.(), undefined, 0.27);
    if (step.enter) tl.add(step.enter(), 0.28);
    // what the page showed stays up until a view is drawn over it (no frames yet: it stays)
    if (o.drawn) tl.call(o.drawn, undefined, 0.75);
    tl.addLabel("in", 1.0);
    // the section's first line comes with its view; the rest at their moments
    step.heads.forEach(([when, text, place], j) => {
      // A section's first line, already showing (the page put it there): placed, not shown again.
      const showing = j === 0 && headline.textContent === text && getComputedStyle(headline).visibility !== "hidden";
      if (!showing) tl.add(caption(text, place), j ? 1.0 + when - 0.24 : 0.1);
      else if (place) tl.call(place, undefined, 0.1);
    });
    step.build(tl, 1.0);
    tl.to({}, { duration: 1.0 });
    current = tl;
    if (at !== undefined) tl.seek(tl.labels.in + at, false);
    else if (instant) tl.seek("in", false);
    if (!running()) tl.pause();
  }

  // One frame of a section: its key moment, with the section's bar full.
  function showStill(i: number) {
    goTo(i, { instant: true });
    current!.pause();
    current!.seek(current!.labels.in + steps[i].still, false);
    gsap.set(fills[i], { scaleX: 1 });
  }

  function paint() {
    host.classList.toggle("ht-still", still);
    playBtn.hidden = still;
    playBtn.classList.toggle("is-paused", paused);
    playBtn.setAttribute("aria-label", paused ? labels.play : labels.pause);
    gsap.to(pausedTag, { autoAlpha: paused && !still ? 1 : 0, duration: 0.2, overwrite: true });
  }

  // Plays when on screen and not paused, from where it was.
  function sync() {
    paint();
    if (!current || still) return;
    if (!running()) current.pause();
    else if (current.progress() === 1) goTo((index + 1) % steps.length);
    else current.resume();
  }

  const less = matchMedia("(prefers-reduced-motion: reduce)");
  function start() {
    still = less.matches;
    if (still) showStill(index < 0 ? 0 : index);
    else if (index < 0) goTo(0, o.firstFromStill ? { at: steps[0].still } : {});
    else goTo(index, { instant: true });
    sync();
  }

  // ---------------------------------------------------------------- controls
  const toggle = () => {
    if (still) return;
    paused = !paused;
    sync();
  };
  playBtn.addEventListener("click", toggle);
  frame.addEventListener("click", toggle);
  const jumps = segs.map((s, i) => {
    const jump = () => {
      if (still) showStill(i);
      else {
        goTo(i, { instant: true });
        sync();
      }
    };
    s.addEventListener("click", jump);
    return jump;
  });

  // On screen or not, from where it is (an IntersectionObserver's first word can be late, or not come at all in a
  // page that isn't being drawn). It counts as on screen once about 40% of it shows (of the screen's height, for
  // a tour taller than that), so a part doesn't play out under the fold to nobody.
  const look = () => {
    const r = host.getBoundingClientRect();
    const shows = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
    const now = shows > 0.4 * Math.min(r.height, innerHeight);
    if (now !== seen) {
      seen = now;
      sync();
    }
  };
  addEventListener("scroll", look, { passive: true });
  addEventListener("resize", look);
  const onVisibility = () => sync();
  document.addEventListener("visibilitychange", onVisibility);
  less.addEventListener("change", start);

  (window as unknown as Record<string, object>)[o.name] = {
    showStill,
    goTo,
    steps: steps.map((s) => s.id),
    get state() {
      return { index, still, paused, seen, time: current?.time(), playing: current ? !current.paused() : false };
    },
  };

  let alive = true;
  o.ready.then(() => {
    if (!alive || index >= 0) return;
    start();
    look();
  });

  return () => {
    alive = false;
    current?.kill();
    gsap.killTweensOf([...transients, pausedTag, headline, ...fills]);
    removeEventListener("scroll", look);
    removeEventListener("resize", look);
    document.removeEventListener("visibilitychange", onVisibility);
    less.removeEventListener("change", start);
    playBtn.removeEventListener("click", toggle);
    frame.removeEventListener("click", toggle);
    segs.forEach((s, i) => s.removeEventListener("click", jumps[i]));
  };
}

/** An image loaded (not decode(): that can wait for good in a page that isn't being drawn), or two seconds at most. */
export function loaded(url: string): Promise<void> {
  return new Promise<void>((done) => {
    const img = new Image();
    img.onload = img.onerror = () => done();
    setTimeout(done, 2000);
    img.src = url;
    if (img.complete) done();
  });
}
