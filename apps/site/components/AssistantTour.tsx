"use client";

import { gsap } from "gsap";
import { Fragment, useEffect, useRef, type ReactNode } from "react";
import type { AssistantScene, AssistantTourText } from "../lib/i18n";
import { playTour, timeline, type TourStep } from "./tour-engine";

/*
 * The front page's tour: an assistant at work, with the made-up family. Each part is one question typed into the
 * chat window and sent, the assistant reading Wilma, and its answer coming in line by line, the words that matter
 * highlighted. It plays the way the Home page's tour does (tour-engine.ts), but the window is the page's own text,
 * not screens: the questions and answers are in lib/i18n.tsx, so changing them is all it takes.
 *
 * The conversation carries on from part to part: a new question goes in at the bottom and the earlier ones move up
 * under the title bar, so the window is always full and nothing plays backwards. Three turns are in the window at a
 * time (the one being asked and the two before it); the oldest has gone up out of sight before it leaves.
 *
 * Without JavaScript, or before it runs, the first question shows answered under the end of the last one; that's
 * where the tour starts too.
 */

/** "==words==" highlighted, as a marker would. */
function marked(text: string): ReactNode {
  return text.split(/==(.+?)==/).map((part, i) => (i % 2 ? <mark className="at-mark" key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>));
}

/** Room that opens with what's in it (a grid row from 0fr to 1fr), so a new line carries the conversation up. */
function Fold({ className, children }: { className: string; children: ReactNode }) {
  return (
    <div className={`at-fold ${className}`}>
      <div className="at-fold-in">{children}</div>
    </div>
  );
}

function Turn({ scene, age }: { scene: AssistantScene; age?: number }) {
  const [first, ...rest] = scene.answer;
  const line = (l: AssistantScene["answer"][number]) => (
    <p className="at-line">
      {l.name ? <strong>{l.name}: </strong> : null}
      {marked(l.text)}
    </p>
  );
  return (
    <div className="at-turn" data-age={age}>
      <Fold className="at-ask-fold">
        <p className="chat-bubble chat-user">{scene.question}</p>
      </Fold>
      <Fold className="at-tool-fold">
        <p className="at-tool">
          <span className="at-dots">
            <i />
            <i />
            <i />
          </span>
          <span className="at-tick">✓</span>
          <span className="at-tool-text">
            <span className="at-reading">{scene.tool[0]}</span>
            <span className="at-read">{scene.tool[1]}</span>
          </span>
        </p>
      </Fold>
      <Fold className="at-answer-fold">
        <div className="chat-bubble chat-assistant">
          {line(first)}
          {rest.map((l) => (
            <Fold className="at-line-fold" key={l.text}>
              {line(l)}
            </Fold>
          ))}
        </div>
      </Fold>
    </div>
  );
}

/** How many parts ago a turn was asked, with part `current` on show: 0 is on show, 3 has gone. */
const ageOf = (turn: number, current: number, n: number) => Math.min((current - turn + n) % n, 3);

export function AssistantTour({ title, tour }: { title: string; tour: AssistantTourText }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => buildTour(root.current!, tour), [tour]);
  const n = tour.scenes.length;
  return (
    <div className="at" ref={root}>
      <div className="chat at-window" role="img" aria-label={tour.label}>
        <div className="chat-chrome">
          <span className="dot red" />
          <span className="dot yellow" />
          <span className="dot green" />
          <span className="chat-title">{title}</span>
        </div>
        <div className="chat-body at-body" aria-hidden="true">
          {/* Unseen, every turn in one place: the window is as tall as the longest turn (and a glimpse of the one
              before it), in either language and at any width, so nothing on the page moves. */}
          <div className="at-sizer">
            {tour.scenes.map((scene) => (
              <Turn scene={scene} key={scene.id} />
            ))}
          </div>
          <div className="at-thread">
            {tour.scenes.map((scene, i) => (
              <Turn scene={scene} age={ageOf(i, 0, n)} key={scene.id} />
            ))}
          </div>
        </div>
        <div className="at-composer" aria-hidden="true">
          <span className="at-field">
            <span className="at-placeholder">{tour.ask}</span>
            <span className="at-input">
              <span className="at-input-line">
                <span className="at-typed" />
                <span className="at-caret" />
              </span>
            </span>
          </span>
          <span className="at-send">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 12 7-7 7 7" />
              <path d="M12 19V5" />
            </svg>
          </span>
        </div>
        <span className="ht-paused" aria-hidden="true">
          {tour.paused}
        </span>
      </div>
      <div className="ht-controls">
        {/* Until the tour runs there's nothing to pause, and the first part is the one on show. */}
        <button type="button" className="ht-play" aria-label={tour.pause} hidden />
        <nav className="ht-timeline" aria-label={tour.sections} style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
          {tour.scenes.map((scene, i) => (
            <button type="button" className={`ht-seg${i ? "" : " active"}`} aria-current={i ? undefined : "step"} key={scene.id}>
              <span className="ht-bar">
                <i />
              </span>
              <span className="ht-lbl">{scene.tab}</span>
            </button>
          ))}
        </nav>
      </div>
      <p className="ht-caption" aria-hidden="true">
        {tour.scenes[0].caption}
      </p>
    </div>
  );
}

function buildTour(host: HTMLElement, tour: AssistantTourText): () => void {
  const n = tour.scenes.length;
  const frame = host.querySelector<HTMLElement>(".at-window")!;
  const thread = host.querySelector<HTMLElement>(".at-thread")!;
  const turns = [...thread.querySelectorAll<HTMLElement>(".at-turn")];
  const sized = [...host.querySelectorAll<HTMLElement>(".at-sizer .at-turn")];
  const composer = host.querySelector<HTMLElement>(".at-composer")!;
  const placeholder = composer.querySelector<HTMLElement>(".at-placeholder")!;
  const typed = composer.querySelector<HTMLElement>(".at-typed")!;
  const caret = composer.querySelector<HTMLElement>(".at-caret")!;
  const send = composer.querySelector<HTMLElement>(".at-send")!;

  const all = <T extends Element>(el: Element, sel: string) => [...el.querySelectorAll<T>(sel)];
  const folds = (turn: HTMLElement) => all<HTMLElement>(turn, ".at-fold");
  const shut = (fold: HTMLElement) => (fold.style.gridTemplateRows = "0fr");

  /** What a turn shows once it's answered: everything open, the highlights drawn. */
  function answered(turn: HTMLElement) {
    folds(turn).forEach((f) => (f.style.gridTemplateRows = ""));
    gsap.set(all(turn, ".at-fold-in > *, .at-line"), { clearProps: "opacity,visibility,transform" });
    gsap.set(all(turn, ".at-dots, .at-reading"), { autoAlpha: 0 });
    gsap.set(all(turn, ".at-tick, .at-read"), { autoAlpha: 1 });
    gsap.set(all(turn, ".at-mark"), { backgroundSize: "100% 45%" });
  }

  /** The composer, empty and waiting. */
  function idle() {
    typed.textContent = "";
    composer.classList.remove("is-typing", "is-ready");
    gsap.set(placeholder, { autoAlpha: 1 });
    gsap.set(caret, { autoAlpha: 0 });
    gsap.set(send, { scale: 1 });
  }

  /** Part i about to be asked: the two before it answered above, its own turn shut at the bottom. */
  function arrange(i: number) {
    turns.forEach((turn, j) => {
      const age = ageOf(j, i, n);
      turn.dataset.age = String(age);
      if (age === 1 || age === 2) answered(turn);
    });
    const turn = turns[i];
    folds(turn).forEach(shut);
    gsap.set(all(turn, ".at-fold-in > *, .chat-assistant > .at-line"), { autoAlpha: 0 });
    gsap.set(all(turn, ".at-dots, .at-reading"), { autoAlpha: 1 });
    gsap.set(all(turn, ".at-tick, .at-read"), { autoAlpha: 0 });
    gsap.set(all(turn, ".at-mark"), { backgroundSize: "0% 45%" });
    idle();
  }

  /** A tween of a plain number, kept out of the timeline's defaults (they're for elements). */
  const count = (from: number, to: number, duration: number, ease: string, draw: (v: number) => void) => {
    const p = { v: from };
    return gsap.to(p, { v: to, duration, ease, onUpdate: () => draw(p.v) });
  };
  /** A fold opening: the room first, what's in it fading in as the room finishes, so no edge cuts through words. */
  const open = (tl: gsap.core.Timeline, fold: HTMLElement, at: number, room = 0.4) => {
    tl.add(count(0, 1, room, "power2.inOut", (v) => (fold.style.gridTemplateRows = `${v}fr`)), at);
    return at + room * 0.55;
  };
  const glideEase = "sine.inOut";
  const glided = gsap.parseEase(glideEase);
  /** How far into a glide (0 to 1 of its time) it has come `part` of its way. */
  const whenAt = (part: number) => {
    let lo = 0, hi = 1;
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      if (glided(mid) < part) lo = mid;
      else hi = mid;
    }
    return lo;
  };

  const steps: TourStep[] = tour.scenes.map((scene, i) => {
    const turn = turns[i];
    const [askFold, toolFold, answerFold] = all<HTMLElement>(turn, ":scope > .at-fold");
    const ask = askFold.querySelector<HTMLElement>(".chat-user")!;
    const tool = toolFold.querySelector<HTMLElement>(".at-tool")!;
    const [dots, tick, reading, read] = [".at-dots", ".at-tick", ".at-reading", ".at-read"].map((s) => tool.querySelector<HTMLElement>(s)!);
    const bubble = answerFold.querySelector<HTMLElement>(".chat-assistant")!;
    const [firstLine] = all<HTMLElement>(bubble, ":scope > .at-line");
    const lineFolds = all<HTMLElement>(bubble, ":scope > .at-line-fold");

    // Timings: the question typed and sent, Wilma read, then the answer a line at a time, each line's highlights
    // drawn as it lands. The typing goes at an even pace however long the question is, and starts as the line
    // under the window changes (t is when the part's view is in; its caption comes in from t - 0.9).
    const chars = scene.question.length;
    const typing = Math.min(1.6, chars * 0.034);
    const typed0 = -0.3;
    const sent = typed0 + typing + 0.35;
    const reads = sent + 0.65, readDone = sent + 1.65, answers = sent + 1.95;
    const glide = 0.5 + lineFolds.length * 0.6;
    const end = answers + glide + 0.5;
    const marks = (line: HTMLElement, at: number, tl: gsap.core.Timeline) => {
      const m = all(line, ".at-mark");
      if (m.length) tl.to(m, { backgroundSize: "100% 45%", duration: 0.5, ease: "power2.inOut", stagger: 0.15 }, at);
    };

    return {
      id: scene.id,
      heads: [[0, scene.caption]],
      still: end + 0.3,
      // Played on from the part before, nothing on screen changes; a jump from the timeline lands on it as it is.
      enter: () => timeline().call(() => arrange(i), undefined, 0),
      build(tl, t) {
        // The question, typed (the caret holds still while keys go down, as it does) and sent.
        tl.to(caret, { autoAlpha: 1, duration: 0.01 }, t + typed0 - 0.2);
        tl.add(
          count(0, chars, typing, "none", (v) => {
            const k = Math.round(v);
            typed.textContent = scene.question.slice(0, k);
            composer.classList.toggle("is-typing", k > 0 && k < chars);
            composer.classList.toggle("is-ready", k > 0);
            gsap.set(placeholder, { autoAlpha: k ? 0 : 1 });
          }),
          t + typed0,
        );
        tl.to(send, { scale: 0.86, duration: 0.09, ease: "power2.in" }, t + sent - 0.1);
        tl.to(send, { scale: 1, duration: 0.3, ease: "back.out(3)" }, t + sent);
        tl.call(idle, undefined, t + sent + 0.02);
        // It rises out of the message box as its room opens (the conversation's bottom edge is the box's top).
        open(tl, askFold, t + sent, 0.5);
        tl.to(ask, { autoAlpha: 1, duration: 0.15 }, t + sent);

        // Wilma read: dots, then a tick and what it read.
        tl.to(tool, { autoAlpha: 1, duration: 0.3 }, open(tl, toolFold, t + reads, 0.3));
        tl.to([dots, reading], { autoAlpha: 0, duration: 0.2 }, t + readDone);
        tl.to([tick, read], { autoAlpha: 1, duration: 0.3 }, t + readDone + 0.1);

        // The answer streams in: one glide for all of it, the bubble arriving with its first line, each later line
        // fading in as its room opens. The rooms are measured on the unseen copy of this turn, so the glide keeps
        // one speed however long each line is.
        const sizedAnswer = sized[i].querySelector<HTMLElement>(".at-answer-fold")!;
        const sizedLines = all<HTMLElement>(sizedAnswer, ".at-line-fold").map((f) => f.offsetHeight);
        const rooms = [sizedAnswer.offsetHeight - sizedLines.reduce((a, b) => a + b, 0), ...sizedLines];
        const starts = rooms.map((_, k) => rooms.slice(0, k).reduce((a, b) => a + b, 0));
        const total = starts[rooms.length - 1] + rooms[rooms.length - 1];
        const streamed = [answerFold, ...lineFolds];
        const at = (px: number) => t + answers + glide * whenAt(px / total);
        tl.add(
          count(0, total, glide, glideEase, (v) =>
            streamed.forEach((fold, k) => (fold.style.gridTemplateRows = `${Math.min(1, Math.max(0, (v - starts[k]) / rooms[k]))}fr`)),
          ),
          t + answers,
        );
        tl.to(bubble, { autoAlpha: 1, duration: 0.25, ease: "power1.out" }, at(rooms[0] * 0.3));
        tl.to(firstLine, { autoAlpha: 1, duration: 0.3, ease: "power1.out" }, at(rooms[0] * 0.55));
        marks(firstLine, at(rooms[0]) + 0.2, tl);
        lineFolds.forEach((fold, k) => {
          const line = fold.querySelector<HTMLElement>(".at-line")!;
          tl.to(line, { autoAlpha: 1, duration: 0.3, ease: "power1.out" }, at(starts[k + 1] + rooms[k + 1] * 0.7));
          marks(line, at(starts[k + 1] + rooms[k + 1]) + 0.2, tl);
        });
        // The answer holds a while; the part ends there.
        tl.to({}, { duration: 1.3 }, t + end);
      },
    };
  });

  const stop = playTour(host, {
    steps,
    frame,
    labels: tour,
    transients: [],
    // The words are in the page already: only the fonts, so lines don't move once they're laid out.
    ready: document.fonts ? document.fonts.ready.then(() => undefined) : Promise.resolve(),
    firstFromStill: true,
    name: "__assistantTour",
  });

  return () => {
    stop();
    const parts = [thread, ...all(thread, "*"), composer, ...all(composer, "*")];
    gsap.killTweensOf(parts);
    gsap.set(parts, { clearProps: "all" });
    turns.forEach((turn, j) => {
      turn.dataset.age = String(ageOf(j, 0, n));
      folds(turn).forEach((f) => (f.style.gridTemplateRows = ""));
    });
    typed.textContent = "";
    composer.classList.remove("is-typing", "is-ready");
  };
}
