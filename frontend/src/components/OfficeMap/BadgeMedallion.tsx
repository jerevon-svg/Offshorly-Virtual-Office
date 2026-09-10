import { useId, type ReactNode } from "react";

// BADGE MEDALLION — the collectible artwork a Pinned Badge shows.
//
// The gallery's <Emblem> is a *card* treatment: a HUD icon dropped into a metal ring. That reads
// as an icon, not as something you'd be proud to display. This is a purpose-built award instead,
// drawn as one vector so it stays crisp at any size and needs no new image assets:
//
//   scalloped seal body  ->  turned edge  ->  engraved double rim  ->  recessed disc  ->  emblem
//
// Every badge shares that construction (one coherent VO language); only the EMBLEM changes per
// badge and only the METAL changes per tier — so Bronze -> Platinum re-materialises the whole
// physical object, not just a caption colour.
//
// A ribbon-backed variant was built and rejected: at the ~82px the sidebar actually renders, the
// tails shrink to two dark-green spikes that read as leaves and break the silhouette. The seal
// fills the frame instead, which is what survives at that size.
//
// Nothing here reads the progression API or the gallery's styles; it takes an emblem key and a
// tier and draws. The gallery is deliberately untouched.

/** The metal a tier is struck in. `sheen` scales the specular sweep: matte bronze -> icy platinum. */
interface Metal {
  light: string;
  base: string;
  deep: string;
  edge: string;
  sheen: number;
}

const METALS: readonly Metal[] = [
  { light: "#e6e3dc", base: "#aca79d", deep: "#7d786f", edge: "#5f5b53", sheen: 0.16 }, // 0 locked
  { light: "#f7cf9d", base: "#c47c3c", deep: "#7e441a", edge: "#5f3212", sheen: 0.2 }, // 1 bronze
  { light: "#fbfcfe", base: "#b6bfc9", deep: "#6f7a86", edge: "#525c67", sheen: 0.3 }, // 2 silver
  { light: "#fff2be", base: "#eeb322", deep: "#a06a09", edge: "#7a5005", sheen: 0.36 }, // 3 gold
  { light: "#ffffff", base: "#c2d6e6", deep: "#7793aa", edge: "#5a768d", sheen: 0.42 }, // 4 platinum
];

function metalFor(tier: number): Metal {
  return METALS[Math.max(0, Math.min(METALS.length - 1, tier))];
}

/* ---- silhouette ---------------------------------------------------------------------------
   A wax-seal scallop: `lobes` tips on radius R joined by quadratic curves whose control point is
   pulled in to 0.849R, which lands the valleys at ~0.90R. Deeper notches than that turn the
   silhouette into a cog; this stays a soft struck seal. */
function sealPath(cx: number, cy: number, r: number, lobes: number): string {
  const rc = r * 0.849;
  const step = (Math.PI * 2) / lobes;
  const f = (n: number) => Math.round(n * 100) / 100;
  const at = (a: number, rad: number) => `${f(cx + Math.cos(a) * rad)},${f(cy + Math.sin(a) * rad)}`;
  let d = `M${at(-Math.PI / 2, r)}`;
  for (let i = 0; i < lobes; i++) {
    const a0 = -Math.PI / 2 + i * step;
    d += ` Q${at(a0 + step / 2, rc)} ${at(a0 + step, r)}`;
  }
  return `${d} Z`;
}

const CX = 60;
const CY = 56;
const SEAL = sealPath(CX, CY, 46, 10);
const SEAL_INNER = sealPath(CX, CY, 41, 10);

/* ---- emblems -------------------------------------------------------------------------------
   Each glyph is drawn in its own 40x40 box and struck into the disc twice (a shade copy pushed
   down, then the lit copy) so it reads as raised metal rather than a sticker. `currentColor` is
   what the two passes recolour, so a glyph never hard-codes a tier. */
const GLYPHS: Readonly<Record<string, ReactNode>> = {
  // clock — "Regular": here at the same time, every day.
  regular: (
    <>
      <circle cx="20" cy="20" r="13.5" fill="none" stroke="currentColor" strokeWidth="3.6" />
      <path d="M20 11.5 V20.6 L26.4 24.2" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  // flame — "Streak": consecutive days kept alight.
  streak: (
    <path
      d="M20 4.2 C24.8 11 28.8 14.6 28.8 21 C28.8 26.2 24.9 30.4 20 30.4 C15.1 30.4 11.2 26.2 11.2 21 C11.2 17.2 13.4 14.6 15.4 11.6 C16.2 14.2 17.2 15.5 18.5 16.2 C18 11.4 18.6 7.6 20 4.2 Z"
      fill="currentColor"
    />
  ),
  // hub — time spent in the shared space.
  hub_regular: (
    <>
      <path d="M20 4.5 L33 12 V27 L20 34.5 L7 27 V12 Z" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinejoin="round" />
      <circle cx="20" cy="19.5" r="4.6" fill="currentColor" />
    </>
  ),
  // speech bubble — "Connector": conversations started.
  connector: (
    <path
      d="M12.5 5.5 H27.5 A6 6 0 0 1 33.5 11.5 V21 A6 6 0 0 1 27.5 27 H21 L12.5 33.5 V27 A6 6 0 0 1 6.5 21 V11.5 A6 6 0 0 1 12.5 5.5 Z"
      fill="currentColor"
    />
  ),
  // footprints — "Approachable": walked over to say hello.
  approachable: (
    <>
      <ellipse cx="14.5" cy="15" rx="5.2" ry="8" fill="currentColor" transform="rotate(-14 14.5 15)" />
      <ellipse cx="26" cy="24.5" rx="5.2" ry="8" fill="currentColor" transform="rotate(14 26 24.5)" />
    </>
  ),
  // star — "Cheerleader": Kudos given.
  cheerleader: (
    <path d="M20 3.6 L24.9 14.7 L36.8 16 L27.9 24.1 L30.5 35.9 L20 29.8 L9.5 35.9 L12.1 24.1 L3.2 16 L15.1 14.7 Z" fill="currentColor" />
  ),
  // check — "Mission Runner": missions completed.
  mission_runner: (
    <path d="M7.5 20.5 L16.4 29.5 L32.5 10.5" fill="none" stroke="currentColor" strokeWidth="5.2" strokeLinecap="round" strokeLinejoin="round" />
  ),
  // pennant — "Pathfinder": quests finished.
  pathfinder: (
    <>
      <path d="M13 5.5 V34.5" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" />
      <path d="M15.3 7.5 L33 13.4 L15.3 19.3 Z" fill="currentColor" />
    </>
  ),
};

const DEFAULT_GLYPH: ReactNode = <path d="M20 4 L34 20 L20 36 L6 20 Z" fill="currentColor" />;

export interface BadgeMedallionProps {
  /** Stable emblem key from the badge record (see data/badgeEmblems.ts). */
  emblem: string;
  /** 0 locked … 4 platinum — selects the metal the whole object is struck in. */
  tier: number;
  /** For the DOM hook the profile's tests read. */
  badgeId?: string;
}

export function BadgeMedallion({ emblem, tier, badgeId }: BadgeMedallionProps) {
  // useId keeps the gradient ids unique — three medallions on one screen would otherwise share
  // (and cross-apply) each other's metal.
  const uid = useId().replace(/:/g, "");
  const m = metalFor(tier);
  const glyph = GLYPHS[emblem] ?? DEFAULT_GLYPH;

  const body = `b${uid}`;
  const disc = `d${uid}`;
  const discShade = `s${uid}`;
  const gloss = `g${uid}`;

  return (
    <svg
      viewBox="0 0 120 112"
      width="100%"
      role="img"
      aria-hidden="true"
      focusable="false"
      data-testid={badgeId ? `medallion-${badgeId}` : "medallion"}
      data-tier={tier}
    >
      <defs>
        {/* Body: a RADIAL key light from the upper left. A linear ramp made the seal look like a
            flat sticker; a radial one gives it the rounded clay volume the VO art has. */}
        <radialGradient id={body} cx="0.33" cy="0.24" r="0.86">
          <stop offset="0" stopColor={m.light} />
          <stop offset="0.46" stopColor={m.base} />
          <stop offset="1" stopColor={m.deep} />
        </radialGradient>
        {/* Disc: the ramp RUNS THE OTHER WAY and stays mostly in the dark half, so the disc reads
            as sunk into the seal and always sits darker than the emblem struck on it. */}
        <linearGradient id={disc} x1="0.22" y1="0" x2="0.78" y2="1">
          <stop offset="0" stopColor={m.deep} />
          <stop offset="0.72" stopColor={m.base} />
          <stop offset="1" stopColor={m.light} />
        </linearGradient>
        {/* The occlusion under the disc's top lip — what actually says "recessed". */}
        <radialGradient id={discShade} cx="0.5" cy="0.06" r="0.95">
          <stop offset="0" stopColor="#100d18" stopOpacity="0.3" />
          <stop offset="0.62" stopColor="#100d18" stopOpacity="0" />
        </radialGradient>
        {/* Specular sweep across the top-left, strengthening with the tier. */}
        <linearGradient id={gloss} x1="0.12" y1="0" x2="0.72" y2="0.86">
          <stop offset="0" stopColor="#fff" stopOpacity={m.sheen} />
          <stop offset="0.44" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* A soft cast shadow, so the medallion sits on the card rather than floating over it. */}
      <ellipse cx={CX} cy="105" rx="32" ry="5.5" fill="#1a1626" opacity="0.11" />

      {/* Seal body. */}
      <path d={SEAL} fill={`url(#${body})`} />
      {/* Turned outer edge: a darker hairline plus a lit inner scallop = real thickness. */}
      <path d={SEAL} fill="none" stroke={m.edge} strokeWidth="1.3" opacity="0.6" />
      <path d={SEAL_INNER} fill="none" stroke={m.light} strokeWidth="1.8" opacity="0.5" />

      {/* Engraved double rim ring — the struck-metal detail that separates an award from an icon. */}
      <circle cx={CX} cy={CY} r="32.5" fill="none" stroke={m.edge} strokeWidth="1.6" opacity="0.45" />
      <circle cx={CX} cy={CY} r="30.7" fill="none" stroke={m.light} strokeWidth="1.3" opacity="0.5" />

      {/* Recessed disc the emblem is struck into. */}
      <circle cx={CX} cy={CY} r="29" fill={`url(#${disc})`} />
      <circle cx={CX} cy={CY} r="29" fill={`url(#${discShade})`} />
      <circle cx={CX} cy={CY} r="29" fill="none" stroke={m.edge} strokeWidth="1.2" opacity="0.4" />

      {/* Emblem, struck in two passes: a shade pushed down, then the lit face. The glyphs paint
          with currentColor (strokes included), which a gradient paint-server cannot be inherited
          into — so the FORM comes from the offset pair, and the contrast comes from the disc
          being held in its dark half above. */}
      <g transform={`translate(${CX - 17} ${CY - 17}) scale(0.85)`}>
        <g color={m.edge} opacity="0.72" transform="translate(0 2.1)">
          {glyph}
        </g>
        <g color={m.light}>{glyph}</g>
      </g>

      {/* Gloss last, over the whole struck object, so the layers read as one material. */}
      <path d={SEAL} fill={`url(#${gloss})`} />
    </svg>
  );
}

export default BadgeMedallion;
