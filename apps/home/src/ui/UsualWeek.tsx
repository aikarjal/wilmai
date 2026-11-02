/*
 * The usual week: when each child's school day starts and ends, Monday to
 * Friday, as the sheet on the fridge door shows it. A row per weekday with a
 * bar per child along the hours, so long and short days, late starts and the
 * times the children go together are seen at a glance; a shirt on PE days.
 * "Print for the fridge" shows the same chart as an A4 sheet first, in a
 * season's look (spring, summer, autumn or winter), then prints it.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { Child, Snapshot } from "../data/model";
import { allTogether, together, usualWeek, type UsualDay } from "../data/schedule";
import { addDays, dayName, dayNameLong, longDate, minutes, mondayOf, today } from "../data/dates";
import { useWilma } from "../data/phrases";
import { plural, t } from "../i18n";
import { Icon, Tab } from "./bits";
import { useApp } from "../data/store";
import { SeasonGround, SeasonScene, type Season } from "./FridgeArt";

/** What all the children's days share: "Same start", "Same finish", "Same hours", or nothing. */
export function togetherLabel(times: ({ start: string; end: string } | undefined)[]): string | null {
  const all = allTogether(times);
  return all.start && all.end ? t("Same hours") : all.start ? t("Same start") : all.end ? t("Same finish") : null;
}

/** One weekday's row: each child's usual day there (undefined: no lessons that weekday). */
interface Row {
  date: string;
  days: (UsualDay | undefined)[];
}

export function UsualWeek({ snap, children, leftOut }: { snap: Snapshot; children: Child[]; leftOut: Record<string, string[]> | undefined }) {
  const w = useWilma();
  const pe = useApp((s) => s.local.pe);
  const weeks = children.map((c) => usualWeek(snap.perChild[c.number], leftOut?.[c.number], pe));
  const read = Math.max(0, ...weeks.map((u) => u.weeks));
  const monday = mondayOf(today());
  const rows: Row[] = [0, 1, 2, 3, 4].map((wd) => ({ date: addDays(monday, wd), days: weeks.map((u) => u.days.find((d) => d.weekday === wd)) }));
  const left = children.flatMap((c) => (leftOut?.[c.number] ?? []).map((subject) => ({ child: c, subject })));
  const [preview, setPreview] = useState(false);

  if (!read) return <p className="week-state">{t("The timetable hasn't been read yet.")}</p>;
  return (
    <section className="card usual-week" aria-label={t("Usual week")}>
      <div className="uw-head">
        <div className="uw-kids">
          {children.map((c) => (
            <Tab key={c.number} child={c} full />
          ))}
        </div>
        <button type="button" className="btn btn-sm" onClick={() => setPreview(true)}>
          <Icon name="print" /> {t("Print for the fridge")}
        </button>
      </div>
      <WeekChart children={children} rows={rows} />
      <p className="uw-note">
        {plural(read, "Each weekday's most common times in the {n} week of the timetable read so far.", "Each weekday's most common times in the {n} weeks of the timetable read so far.")}{" "}
        {children.length > 1 ? t("“Same” means within a quarter of an hour.") : null}
      </p>
      <p className="uw-note">
        {left.length
          ? t("Not counted in the school day: {list}. To change it, pick the lesson in a week.", {
              list: left.map((x) => (children.length > 1 ? `${w(x.subject)} (${x.child.first})` : w(x.subject))).join(", "),
            })
          : t("Is an optional lesson, such as remedial teaching or a club, stretching a day? Pick it in a week and untick “Counts in the school day”.")}
      </p>
      {preview ? <PrintPreview children={children} rows={rows} weeks={read} onClose={() => setPreview(false)} /> : null}
    </section>
  );
}

/**
 * The chart: hours along the top, a row per weekday, in it a bar per child from the start to the end of their day
 * (the times at its ends, a shirt on PE days). Where all the children start or finish together, a band runs across
 * their bars, and the row says so on the right; where only some of them do (three or more children), those times
 * are marked.
 */
function WeekChart({ children, rows, big = false }: { children: Child[]; rows: Row[]; big?: boolean }) {
  const lanes = children.length;
  const known = rows.flatMap((r) => r.days.filter((d) => d !== undefined));
  const from = Math.min(8, ...known.map((d) => Math.floor(minutes(d.start) / 60)));
  const until = Math.max(15, ...known.map((d) => Math.ceil(minutes(d.end) / 60)));
  const at = (time: string) => `${((minutes(time) - from * 60) / ((until - from) * 60)) * 100}%`;
  const hours = Array.from({ length: until - from + 1 }, (_, i) => from + i);
  return (
    <div className={`uw-chart lanes-${Math.min(lanes, 4)}${big ? " big" : ""}${lanes > 1 ? " several" : ""}`}>
      <div className="uw-axis">
        <span />
        <div className="uw-track">
          {hours.map((h) => (
            <span key={h} className="uw-hour" style={{ left: `${((h - from) / (until - from)) * 100}%` }}>
              {h}
            </span>
          ))}
        </div>
        {lanes > 1 ? <span /> : null}
      </div>
      {rows.map((row, r) => {
        const all = allTogether(row.days);
        const near = together(row.days);
        const shared = (i: number, side: "start" | "end") => (!all[side] && near[i][side].length ? " shared" : "");
        const band = (side: "start" | "end") => {
          const times = row.days.filter((d) => d !== undefined).map((d) => d[side]);
          const first = times.reduce((a, b) => (minutes(a) <= minutes(b) ? a : b));
          const last = times.reduce((a, b) => (minutes(a) >= minutes(b) ? a : b));
          return <span key={side} className="uw-band" style={{ left: `calc(${at(first)} - 3px)`, width: `calc(${at(last)} - ${at(first)} + 6px)` }} />;
        };
        return (
          <div key={row.date} className="uw-row" style={{ "--tilt": `${[-2, 1.5, -1, 2, -1.5][r]}deg` } as CSSProperties}>
            <div className="uw-day">
              <span className="uw-day-short">{dayName(row.date)}</span>
              <span className="uw-day-long">{dayNameLong(row.date)}</span>
            </div>
            <div className="uw-track">
              {hours.map((h) => (
                <span key={h} className="uw-line" style={{ left: `${((h - from) / (until - from)) * 100}%` }} />
              ))}
              {all.start ? band("start") : null}
              {all.end ? band("end") : null}
              {children.map((c, i) => {
                const day = row.days[i];
                const lane = { "--lane": i } as CSSProperties;
                if (!day) {
                  return (
                    <span key={c.number} className="uw-off" style={lane}>
                      {lanes > 1 ? `${c.first}: ` : ""}
                      {t("No lessons")}
                    </span>
                  );
                }
                return (
                  <div
                    key={c.number}
                    className={`uw-bar c${c.color % 16}`}
                    style={{ ...lane, left: at(day.start), width: `calc(${at(day.end)} - ${at(day.start)})` }}
                    title={`${c.first}: ${day.start}–${day.end}${day.pe ? ` · ${t("PE")}` : ""}`}
                  >
                    <span className={`uw-time${shared(i, "start")}`}>{day.start}</span>
                    {/* The name, when the bar is long enough for it beside the times (the colours say whose it is). */}
                    {lanes > 1 && minutes(day.end) - minutes(day.start) >= (until - from) * 60 * 0.4 ? <span className="uw-who">{c.nick ?? c.first}</span> : null}
                    {day.pe ? <Icon name="shirt" className="icon uw-pe" label={t("PE")} /> : null}
                    <span className={`uw-time uw-end${shared(i, "end")}`}>{day.end}</span>
                  </div>
                );
              })}
            </div>
            {lanes > 1 ? <div className="uw-same">{togetherLabel(row.days)}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

type Theme = Season;
const THEMES: { id: Theme; name: string }[] = [
  { id: "spring", name: "Spring" },
  { id: "summer", name: "Summer" },
  { id: "autumn", name: "Autumn" },
  { id: "winter", name: "Winter" },
];
const THEME_KEY = "wilmai.fridgeTheme";
/** The season's look: spring March–May, summer June–August, autumn September–November, winter December–February. */
const seasonNow = (): Theme => {
  const month = Number(today().slice(5, 7));
  return month >= 3 && month <= 5 ? "spring" : month >= 6 && month <= 8 ? "summer" : month >= 9 && month <= 11 ? "autumn" : "winter";
};
/** The look chosen last on this computer (only a convenience: it can be gone), else the season's. */
function savedTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (THEMES.some((x) => x.id === saved)) return saved as Theme;
  } catch {
    // Storage unavailable: the season's look.
  }
  return seasonNow();
}

/**
 * The sheet as it will print, on an A4 page scaled to the window, with the season's looks to pick from. The sheet
 * itself is ready for the printer while this is open (outside the app, shown only in print), so printing doesn't
 * depend on when the print dialog reads the page.
 */
function PrintPreview({ children, rows, weeks, onClose }: { children: Child[]; rows: Row[]; weeks: number; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [theme, setTheme] = useState<Theme>(savedTheme);
  const fit = () => Math.min(0.62, Math.max(0.3, (window.innerHeight - 110) / 1123));
  const [scale, setScale] = useState(fit);
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
    const resize = () => setScale(fit());
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const choose = (next: Theme) => {
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Not remembered; it still prints.
    }
  };
  return (
    <dialog ref={ref} className="lesson-dialog print-dialog" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()} aria-labelledby="print-title">
      <div className="pp">
        <div className="pp-frame" style={{ width: 794 * scale, height: 1123 * scale }}>
          <div className="pp-page" style={{ transform: `scale(${scale})` }}>
            <FridgeSheet children={children} rows={rows} weeks={weeks} theme={theme} />
          </div>
        </div>
        <div className="pp-side">
          <div className="lesson-top">
            <h2 id="print-title" style={{ margin: 0 }}>
              {t("Print for the fridge")}
            </h2>
            <span style={{ flex: 1 }} />
            <button className="btn btn-quiet btn-sm" onClick={onClose} aria-label={t("Close")}>
              ✕
            </button>
          </div>
          <p className="pp-help">{t("Pick a look. The page stays white, so the printer only spends ink on the timetable and a few drawings.")}</p>
          <div className="pp-themes" role="radiogroup" aria-label={t("Look")}>
            {THEMES.map((x) => (
              <button key={x.id} type="button" role="radio" aria-checked={theme === x.id} className={`pp-theme theme-${x.id}`} onClick={() => choose(x.id)}>
                <svg className="pp-swatch" viewBox="160 0 284 170" aria-hidden="true">
                  <SeasonScene season={x.id} />
                </svg>
                <span>{t(x.name)}</span>
              </button>
            ))}
          </div>
          <div className="pp-actions">
            <button type="button" className="btn btn-primary" onClick={() => window.print()}>
              <Icon name="print" /> {t("Print…")}
            </button>
            <button type="button" className="btn" onClick={onClose}>
              {t("Close")}
            </button>
          </div>
        </div>
      </div>
      {createPortal(
        <div className="print-sheet">
          <FridgeSheet children={children} rows={rows} weeks={weeks} theme={theme} />
        </div>,
        document.body
      )}
    </dialog>
  );
}

/** The printed sheet (A4): a title to see from across the kitchen, the children, the chart, and what the marks mean. */
function FridgeSheet({ children, rows, weeks, theme }: { children: Child[]; rows: Row[]; weeks: number; theme: Theme }) {
  const pe = rows.some((r) => r.days.some((d) => d?.pe));
  return (
    <div className={`fridge theme-${theme}`}>
      <svg className="fridge-decor" viewBox="0 0 440 170" aria-hidden="true">
        <SeasonScene season={theme} />
      </svg>
      <svg className="fridge-ground" viewBox="0 0 760 56" aria-hidden="true">
        <SeasonGround season={theme} />
      </svg>
      <header>
        <h1>{t("School week")}</h1>
        <svg className="fridge-squiggle" viewBox="0 -4 300 24" preserveAspectRatio="none" aria-hidden="true">
          <path d="M2 10 C 22 2, 42 2, 62 10 S 102 18, 122 10 S 162 2, 182 10 S 222 18, 242 10 S 282 2, 298 8" />
        </svg>
        <div className="fridge-kids">
          {children.map((c) => (
            <span key={c.number} className={`fridge-kid c${c.color % 16}`}>
              {c.emoji ? `${c.emoji} ` : ""}
              {c.nick ?? c.first}
            </span>
          ))}
        </div>
      </header>
      <WeekChart children={children} rows={rows} big />
      <footer>
        <div className="fridge-key">
          {pe ? (
            <span>
              <Icon name="shirt" /> {t("PE: pack the gym kit")}
            </span>
          ) : null}
          {children.length > 1 ? (
            <span>
              <i className="fridge-band" /> {t("They start or finish together (within a quarter of an hour)")}
            </span>
          ) : null}
        </div>
        <small>
          {t(weeks === 1 ? "The usual week from {n} week of the timetable · WilmAI Home · {date}" : "The usual week from {n} weeks of the timetable · WilmAI Home · {date}", { n: weeks, date: longDate(today()) })}
        </small>
      </footer>
    </div>
  );
}
