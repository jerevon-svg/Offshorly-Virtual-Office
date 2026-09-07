// Emblem artwork seam for the Achievements Gallery. The server sends a STABLE `emblem` key per
// badge (today equal to the badge id); this map turns it into what the card draws. V1 ships a
// styled glyph + accent per key; drop a PNG/SVG at public/emblems/<key>.png and set `artwork`
// here to replace the glyph without touching any component. Unknown keys get a neutral default.

export interface Emblem {
  glyph: string;
  /** Accent colour behind the glyph; tier colours layer on top of it. */
  accent: string;
  /** Relative path under public/ for custom artwork; when set, replaces the glyph. */
  artwork?: string;
}

const EMBLEMS: Readonly<Record<string, Emblem>> = {
  regular: { glyph: "⌂", accent: "#5b7cfa" },
  streak: { glyph: "⚡", accent: "#f7a541" },
  hub_regular: { glyph: "◈", accent: "#41b3a3" },
  connector: { glyph: "✉", accent: "#9b6bff" },
  approachable: { glyph: "☺", accent: "#ff7ab6" },
  cheerleader: { glyph: "★", accent: "#ffd23f" },
  mission_runner: { glyph: "➶", accent: "#3fbf7f" },
  pathfinder: { glyph: "⚑", accent: "#59c3ff" },
};

const DEFAULT_EMBLEM: Emblem = { glyph: "◆", accent: "#8a8fa8" };

export function emblemFor(key: string): Emblem {
  return EMBLEMS[key] ?? DEFAULT_EMBLEM;
}

export function emblemArtworkUrl(emblem: Emblem): string | null {
  return emblem.artwork ? `${import.meta.env.BASE_URL}${emblem.artwork.replace(/^\/+/, "")}` : null;
}
