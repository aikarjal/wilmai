/*
 * The fridge sheet's drawings, one set a season: a scene beside the title and
 * a strip along the foot of the page. Light colours with thin outlines, on the
 * white page, so a printer spends little ink on them.
 */
import type { ReactNode } from "react";

export type Season = "spring" | "summer" | "autumn" | "winter";

/** The colours, pale enough to print lightly. */
const C = {
  ink: "#47506b",
  blossom: "#f7b8cf",
  blossomDeep: "#ec8fb0",
  heart: "#ffd36b",
  leaf: "#b5e3ae",
  stem: "#86c97e",
  bark: "#c9a184",
  bird: "#a9d1f5",
  birdDeep: "#7fb4e6",
  belly: "#fff1d6",
  beak: "#f4a65f",
  lilac: "#cdbdf3",
  butter: "#ffe28a",
  sun: "#ffd84d",
  sea: "#d9eefa",
  wave: "#86c3ea",
  sail: "#ffffff",
  sailLine: "#9cc6ef",
  hull: "#f6b48f",
  cone: "#f2c891",
  mint: "#bfe8cf",
  rust: "#f0a27a",
  amber: "#f6c76a",
  berry: "#e98f8f",
  cap: "#ee8b80",
  stalk: "#f8eddc",
  stalkLine: "#dcc6a8",
  acorn: "#e3b680",
  acornCap: "#bf9474",
  snow: "#f3f8ff",
  snowLine: "#a9cff2",
  pine: "#bfe3cd",
  pineLine: "#8ccaa6",
  scarf: "#ef8f8f",
  carrot: "#f4a65f",
};

/* ---------- Pieces ---------- */

const Blossom = ({ x, y, r = 7, deep = false }: { x: number; y: number; r?: number; deep?: boolean }) => (
  <g transform={`translate(${x} ${y})`}>
    {[0, 72, 144, 216, 288].map((a) => (
      <circle key={a} cx="0" cy={-r} r={r} fill={deep ? C.blossomDeep : C.blossom} transform={`rotate(${a})`} />
    ))}
    <circle r={r * 0.5} fill={C.heart} />
  </g>
);

const Leaf = ({ x, y, rot = 0, s = 1, fill = C.leaf }: { x: number; y: number; rot?: number; s?: number; fill?: string }) => (
  <path d="M0 0 C 6 -8, 18 -8, 24 0 C 18 8, 6 8, 0 0 Z" fill={fill} transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`} />
);

const Tulip = ({ x, y, s = 1, fill }: { x: number; y: number; s?: number; fill: string }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <path d="M0 0 C 1 -14, -1 -26, 0 -38" stroke={C.stem} strokeWidth="3" fill="none" strokeLinecap="round" />
    <path d="M0 -8 C -12 -14, -16 -24, -14 -32 C -6 -26, -2 -18, 0 -8 Z" fill={C.leaf} />
    <path d="M-10 -38 C -10 -50, -6 -54, -4 -48 L 0 -54 L 4 -48 C 6 -54, 10 -50, 10 -38 C 10 -32, -10 -32, -10 -38 Z" fill={fill} />
  </g>
);

const Daisy = ({ x, y, s = 1 }: { x: number; y: number; s?: number }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <path d="M0 0 V -22" stroke={C.stem} strokeWidth="2.5" strokeLinecap="round" />
    <g transform="translate(0 -26)">
      {Array.from({ length: 8 }, (_, i) => (
        <ellipse key={i} cx="0" cy="-6" rx="3" ry="6" fill="#ffffff" stroke="#e5e9f2" strokeWidth="1" transform={`rotate(${i * 45})`} />
      ))}
      <circle r="3.5" fill={C.heart} />
    </g>
  </g>
);

const Butterfly = ({ x, y, s = 1, rot = 0 }: { x: number; y: number; s?: number; rot?: number }) => (
  <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`}>
    <ellipse cx="-9" cy="-6" rx="10" ry="8" fill={C.lilac} transform="rotate(-25 -9 -6)" />
    <ellipse cx="9" cy="-6" rx="10" ry="8" fill={C.lilac} transform="rotate(25 9 -6)" />
    <ellipse cx="-7" cy="7" rx="6" ry="5" fill={C.butter} />
    <ellipse cx="7" cy="7" rx="6" ry="5" fill={C.butter} />
    <path d="M0 -10 V 12 M0 -10 C -2 -16, -5 -18, -7 -18 M0 -10 C 2 -16, 5 -18, 7 -18" stroke={C.ink} strokeWidth="1.4" fill="none" strokeLinecap="round" />
  </g>
);

const Bird = ({ x, y }: { x: number; y: number }) => (
  <g transform={`translate(${x} ${y})`}>
    <path d="M-16 4 L-30 -4 L-26 8 Z" fill={C.birdDeep} />
    <ellipse cx="0" cy="2" rx="18" ry="14" fill={C.bird} />
    <ellipse cx="4" cy="7" rx="11" ry="8" fill={C.belly} />
    <circle cx="14" cy="-10" r="10" fill={C.bird} />
    <path d="M-8 -2 C 0 -8, 8 -4, 6 4 C 0 6, -6 4, -8 -2 Z" fill={C.birdDeep} />
    <circle cx="17" cy="-12" r="1.8" fill={C.ink} />
    <path d="M23 -10 L31 -8 L23 -5 Z" fill={C.beak} />
    <path d="M-2 15 V 21 M5 15 V 21" stroke={C.beak} strokeWidth="2" strokeLinecap="round" />
  </g>
);

const Sun = ({ x, y, r = 30 }: { x: number; y: number; r?: number }) => (
  <g transform={`translate(${x} ${y})`}>
    {Array.from({ length: 12 }, (_, i) => (
      <line key={i} x1="0" y1={-(r + 8)} x2="0" y2={-(r + 18)} stroke={C.sun} strokeWidth="5" strokeLinecap="round" transform={`rotate(${i * 30})`} />
    ))}
    <circle r={r} fill={C.sun} />
    <path d={`M${-r * 0.42} ${-r * 0.12} q 4 -5 8 0 M${r * 0.42 - 8} ${-r * 0.12} q 4 -5 8 0`} stroke={C.ink} strokeWidth="2" fill="none" strokeLinecap="round" />
    <path d={`M${-r * 0.35} ${r * 0.22} q ${r * 0.35} ${r * 0.3} ${r * 0.7} 0`} stroke={C.ink} strokeWidth="2" fill="none" strokeLinecap="round" />
    <circle cx={-r * 0.55} cy={r * 0.15} r="4" fill="#ffb3a7" />
    <circle cx={r * 0.55} cy={r * 0.15} r="4" fill="#ffb3a7" />
  </g>
);

const Cloud = ({ x, y, s = 1 }: { x: number; y: number; s?: number }) => (
  <path
    d="M0 0 C -2 -10, 10 -16, 18 -10 C 22 -20, 40 -20, 44 -8 C 54 -10, 60 0, 54 6 H 4 C -4 6, -6 2, 0 0 Z"
    fill="#ffffff"
    stroke="#cfe3f5"
    strokeWidth="2"
    transform={`translate(${x} ${y}) scale(${s})`}
  />
);

const Gull = ({ x, y, s = 1 }: { x: number; y: number; s?: number }) => (
  <path d="M0 0 q 7 -7 14 0 q 7 -7 14 0" stroke={C.ink} strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.6" transform={`translate(${x} ${y}) scale(${s})`} />
);

const Boat = ({ x, y }: { x: number; y: number }) => (
  <g transform={`translate(${x} ${y})`}>
    <path d="M0 -60 V 0" stroke={C.ink} strokeWidth="2" opacity="0.7" />
    <path d="M2 -58 L2 -4 L40 -4 Z" fill={C.sail} stroke={C.sailLine} strokeWidth="2" strokeLinejoin="round" />
    <path d="M-2 -48 L-2 -4 L-26 -4 Z" fill={C.butter} stroke="#f0cf6a" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M0 -60 L12 -56 L0 -52 Z" fill={C.berry} />
    <path d="M-36 0 H 46 L 36 14 H -26 Z" fill={C.hull} />
  </g>
);

const Waves = ({ x, y, width, rows = 2 }: { x: number; y: number; width: number; rows?: number }) => {
  const line = (dy: number) => {
    let d = `M${x} ${y + dy}`;
    for (let i = 0; i < width / 30; i += 1) d += " q 7.5 -7 15 0 t 15 0";
    return d;
  };
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <path key={i} d={line(i * 12)} stroke={C.wave} strokeWidth="2.5" fill="none" strokeLinecap="round" opacity={1 - i * 0.35} />
      ))}
    </>
  );
};

const IceCream = ({ x, y }: { x: number; y: number }) => (
  <g transform={`translate(${x} ${y})`}>
    <path d="M-11 0 L11 0 L0 30 Z" fill={C.cone} />
    <path d="M-7 4 L4 22 M0 2 L7 14 M7 4 L-3 22" stroke="#e0b06f" strokeWidth="1.2" />
    <circle cx="-6" cy="-5" r="8" fill={C.blossom} />
    <circle cx="6" cy="-5" r="8" fill={C.mint} />
    <circle cx="0" cy="-15" r="7.5" fill={C.butter} />
  </g>
);

const Shell = ({ x, y, s = 1 }: { x: number; y: number; s?: number }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <path d="M0 0 L-12 -6 C -12 -20, 12 -20, 12 -6 Z" fill="#fde3d3" stroke="#f0bfa4" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M0 0 L-6 -15 M0 0 L0 -17 M0 0 L6 -15" stroke="#f0bfa4" strokeWidth="1.2" />
  </g>
);

const Fish = ({ x, y, s = 1 }: { x: number; y: number; s?: number }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <ellipse cx="0" cy="0" rx="12" ry="7" fill={C.amber} />
    <path d="M10 0 L20 -7 L20 7 Z" fill={C.amber} />
    <circle cx="-6" cy="-1.5" r="1.5" fill={C.ink} />
  </g>
);

/** A maple leaf (five points), its stalk, and the veins. */
const Maple = ({ x, y, s = 1, rot = 0, fill }: { x: number; y: number; s?: number; rot?: number; fill: string }) => (
  <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`}>
    <path d="M0 -20 L4 -10 L11 -14 L9 -5 L19 -6 L13 2 L17 7 L6 7 L7 14 L1 10 L0 20 L-1 10 L-7 14 L-6 7 L-17 7 L-13 2 L-19 -6 L-9 -5 L-11 -14 L-4 -10 Z" fill={fill} strokeLinejoin="round" />
    <path d="M0 10 V 26 M0 8 L0 -14 M0 4 L12 -2 M0 4 L-12 -2" stroke="rgb(0 0 0 / 16%)" strokeWidth="1.3" fill="none" strokeLinecap="round" />
  </g>
);

const Mushroom = ({ x, y, s = 1 }: { x: number; y: number; s?: number }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <path d="M-7 -2 H 7 V 18 Q 7 22 3 22 H -3 Q -7 22 -7 18 Z" fill={C.stalk} stroke={C.stalkLine} strokeWidth="1.5" />
    <path d="M-24 0 C -24 -22, 24 -22, 24 0 Z" fill={C.cap} />
    <circle cx="-11" cy="-9" r="3" fill="#ffffff" />
    <circle cx="3" cy="-13" r="2.5" fill="#ffffff" />
    <circle cx="13" cy="-6" r="2.8" fill="#ffffff" />
    <circle cx="-2" cy="-4" r="2" fill="#ffffff" />
  </g>
);

const Acorn = ({ x, y, s = 1, rot = 0 }: { x: number; y: number; s?: number; rot?: number }) => (
  <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`}>
    <ellipse cx="0" cy="6" rx="8" ry="10" fill={C.acorn} />
    <path d="M-10 0 C -10 -8, 10 -8, 10 0 Z" fill={C.acornCap} />
    <path d="M0 -6 V -11" stroke={C.acornCap} strokeWidth="2.5" strokeLinecap="round" />
  </g>
);

const Flake = ({ x, y, s = 1 }: { x: number; y: number; s?: number }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    {[0, 60, 120].map((a) => (
      <g key={a} transform={`rotate(${a})`}>
        <line x1="0" y1="-14" x2="0" y2="14" stroke={C.snowLine} strokeWidth="2.4" strokeLinecap="round" />
        <path d="M-4 -10 L0 -6 L4 -10 M-4 10 L0 6 L4 10" stroke={C.snowLine} strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    ))}
  </g>
);

const Pine = ({ x, y, s = 1 }: { x: number; y: number; s?: number }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <rect x="-3" y="-4" width="6" height="8" fill={C.bark} />
    <path d="M0 -58 L14 -36 H7 L20 -18 H10 L24 -4 H-24 L-10 -18 H-20 L-7 -36 H-14 Z" fill={C.pine} stroke={C.pineLine} strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M-6 -36 H 6 M-10 -18 H 10" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
  </g>
);

const Snowman = ({ x, y }: { x: number; y: number }) => (
  <g transform={`translate(${x} ${y})`}>
    <path d="M-16 -50 L-40 -66 M-34 -62 L-38 -72 M16 -50 L40 -64" stroke={C.bark} strokeWidth="3" strokeLinecap="round" />
    <circle cx="0" cy="-22" r="26" fill={C.snow} stroke={C.snowLine} strokeWidth="2.2" />
    <circle cx="0" cy="-60" r="19" fill={C.snow} stroke={C.snowLine} strokeWidth="2.2" />
    <circle cx="0" cy="-90" r="14" fill={C.snow} stroke={C.snowLine} strokeWidth="2.2" />
    <path d="M-14 -77 C -6 -73, 6 -73, 14 -77 L 14 -71 C 6 -67, -6 -67, -14 -71 Z" fill={C.scarf} />
    <path d="M8 -72 L12 -56 L5 -57 Z" fill={C.scarf} />
    <rect x="-10" y="-118" width="20" height="16" rx="2" fill={C.ink} opacity="0.75" />
    <rect x="-15" y="-104" width="30" height="4" rx="2" fill={C.ink} opacity="0.75" />
    <circle cx="-5" cy="-93" r="1.8" fill={C.ink} />
    <circle cx="5" cy="-93" r="1.8" fill={C.ink} />
    <path d="M0 -88 L13 -86 L0 -84 Z" fill={C.carrot} />
    <circle cx="0" cy="-62" r="2.2" fill={C.ink} opacity="0.7" />
    <circle cx="0" cy="-52" r="2.2" fill={C.ink} opacity="0.7" />
  </g>
);

/* ---------- Scenes ---------- */

/** The scene beside the title (viewBox 0 0 440 170: drawn on its right two thirds). */
export function SeasonScene({ season }: { season: Season }): ReactNode {
  if (season === "spring") {
    return (
      <>
        <path d="M442 6 C 402 16, 362 38, 302 44 S 248 54, 216 74" stroke={C.bark} strokeWidth="5" fill="none" strokeLinecap="round" />
        <path d="M354 34 C 348 52, 334 64, 318 72" stroke={C.bark} strokeWidth="3" fill="none" strokeLinecap="round" />
        <Leaf x={380} y={26} rot={-160} />
        <Leaf x={282} y={52} rot={20} s={0.8} />
        <Leaf x={240} y={64} rot={-150} s={0.7} />
        <Blossom x={414} y={14} />
        <Blossom x={370} y={36} r={6} deep />
        <Blossom x={318} y={74} r={6} />
        <Blossom x={262} y={58} r={6.5} />
        <Blossom x={222} y={76} r={5} deep />
        <Bird x={316} y={22} />
        <Butterfly x={168} y={58} s={1.1} rot={-12} />
        <circle cx="200" cy="104" r="3.5" fill={C.blossom} />
        <circle cx="236" cy="118" r="2.5" fill={C.blossom} />
        <Tulip x={372} y={168} fill={C.blossom} />
        <Tulip x={396} y={168} s={1.15} fill={C.butter} />
        <Tulip x={420} y={168} s={0.9} fill={C.lilac} />
        <Daisy x={344} y={168} s={0.9} />
      </>
    );
  }
  if (season === "summer") {
    return (
      <>
        <Sun x={388} y={58} />
        <Cloud x={262} y={40} s={1.1} />
        <Cloud x={196} y={84} s={0.7} />
        <Gull x={320} y={100} />
        <Gull x={350} y={88} s={0.7} />
        <Boat x={252} y={146} />
        <Waves x={180} y={162} width={170} />
        <IceCream x={410} y={128} />
      </>
    );
  }
  if (season === "autumn") {
    return (
      <>
        <path d="M232 22 C 260 40, 236 70, 268 92" stroke={C.ink} strokeWidth="1.5" strokeDasharray="3 6" fill="none" opacity="0.35" />
        <Maple x={410} y={34} s={1.25} rot={18} fill={C.rust} />
        <Maple x={346} y={64} s={1} rot={-24} fill={C.amber} />
        <Maple x={232} y={22} s={0.8} rot={40} fill={C.berry} />
        <Maple x={284} y={102} s={0.9} rot={-8} fill={C.rust} />
        <Leaf x={186} y={64} rot={30} s={0.9} fill={C.amber} />
        <Mushroom x={392} y={140} s={1.05} />
        <Mushroom x={424} y={150} s={0.7} />
        <Acorn x={340} y={150} rot={-20} />
        <Acorn x={316} y={156} s={0.8} rot={25} />
        <path d="M300 168 H 440" stroke={C.stalkLine} strokeWidth="2" strokeLinecap="round" />
      </>
    );
  }
  return (
    <>
      <Flake x={232} y={26} s={0.9} />
      <Flake x={292} y={64} s={0.6} />
      <Flake x={330} y={20} s={1.1} />
      <Flake x={196} y={86} s={0.55} />
      <Flake x={436} y={30} s={0.7} />
      <path d="M220 168 C 260 150, 300 150, 340 160 S 410 150, 444 158 V 170 H 220 Z" fill={C.snow} stroke={C.snowLine} strokeWidth="2" strokeLinejoin="round" />
      <Pine x={274} y={160} s={0.95} />
      <Pine x={306} y={164} s={0.7} />
      <Snowman x={392} y={162} />
    </>
  );
}

/** The strip along the foot of the page (viewBox 0 0 760 56). */
export function SeasonGround({ season }: { season: Season }): ReactNode {
  if (season === "spring") {
    return (
      <>
        <path d="M0 44 C 60 36, 120 36, 190 42 S 320 50, 390 42 S 520 34, 600 42 S 720 48, 760 40 V 56 H 0 Z" fill="#e7f6e4" />
        {[30, 150, 300, 470, 640].map((x, i) => <Tulip key={x} x={x} y={52} s={0.62} fill={[C.blossom, C.butter, C.lilac][i % 3]} />)}
        {[90, 220, 380, 560, 710].map((x) => <Daisy key={x} x={x} y={50} s={0.7} />)}
        <Butterfly x={520} y={14} s={0.6} rot={10} />
      </>
    );
  }
  if (season === "summer") {
    return (
      <>
        <path d="M0 34 q 19 -9 38 0 t 38 0 t 38 0 t 38 0 t 38 0 t 38 0 t 38 0 t 38 0 t 38 0 t 38 0 t 38 0 t 38 0 t 38 0 t 38 0 t 38 0 t 38 0 t 38 0 t 38 0 t 38 0 t 38 0 V 56 H 0 Z" fill={C.sea} />
        <Waves x={0} y={44} width={760} rows={1} />
        <Shell x={110} y={30} s={0.9} />
        <Shell x={610} y={32} s={0.75} />
        <Fish x={360} y={48} s={0.8} />
        <Fish x={420} y={52} s={0.6} />
      </>
    );
  }
  if (season === "autumn") {
    const fills = [C.rust, C.amber, C.berry];
    return (
      <>
        <path d="M0 50 H 760" stroke={C.stalkLine} strokeWidth="2" strokeLinecap="round" />
        {[20, 70, 140, 210, 300, 380, 450, 530, 600, 680, 740].map((x, i) => (
          <Maple key={x} x={x} y={40 + (i % 3) * 3} s={0.45 + (i % 2) * 0.15} rot={(i * 47) % 360} fill={fills[i % 3]} />
        ))}
        <Mushroom x={250} y={38} s={0.55} />
        <Acorn x={500} y={38} s={0.7} rot={15} />
      </>
    );
  }
  return (
    <>
      <path d="M0 44 C 80 30, 160 30, 240 40 S 400 50, 480 38 S 640 30, 760 42 V 56 H 0 Z" fill={C.snow} stroke={C.snowLine} strokeWidth="2" strokeLinejoin="round" />
      {[60, 90, 640, 676, 704].map((x, i) => <Pine key={x} x={x} y={44 - (i % 2) * 3} s={0.5 + (i % 2) * 0.12} />)}
      {[180, 300, 420, 540].map((x, i) => <Flake key={x} x={x} y={14 + (i % 2) * 10} s={0.45} />)}
    </>
  );
}
