// Emblem artwork seam for the Achievements Gallery. The server sends a STABLE `emblem` key per
// badge (today equal to the badge id); this map turns it into what the card draws. Each key now
// carries the locked VO clay artwork, which replaces the old styled glyph without any component
// change — the glyph stays as the fallback for a key that has no art yet. Unknown keys get a
// neutral default.
//
// Seven emblems REUSE clay icons the office already ships (the same asset the matching Quest or
// Mission row uses, so a badge and the activity that earns it read alike); only `streak` needed
// new art. Tier (Bronze/Silver/Gold/Platinum) is a frame treatment applied by the gallery's CSS,
// not a separate image per tier — one emblem serves all four tiers.
import chatArt from "../assets/hud-icons/chat.png";
import clockArt from "../assets/hud-icons/clock.png";
import flameArt from "../assets/hud-icons/flame.png";
import footstepsArt from "../assets/hud-icons/footsteps.png";
import hubArt from "../assets/hud-icons/hub.png";
import kudosArt from "../assets/hud-icons/kudos.png";
import missionsArt from "../assets/tasks-art/missions.png";
import questsArt from "../assets/tasks-art/quests.png";

export interface Emblem {
  glyph: string;
  /** Accent colour behind the glyph; tier colours layer on top of it. */
  accent: string;
  /** Resolved artwork URL (a bundled import, or a path under public/); replaces the glyph. */
  artwork?: string;
}

const EMBLEMS: Readonly<Record<string, Emblem>> = {
  regular: { glyph: "⌂", accent: "#5b7cfa", artwork: clockArt },
  streak: { glyph: "⚡", accent: "#f7a541", artwork: flameArt },
  hub_regular: { glyph: "◈", accent: "#41b3a3", artwork: hubArt },
  connector: { glyph: "✉", accent: "#9b6bff", artwork: chatArt },
  approachable: { glyph: "☺", accent: "#ff7ab6", artwork: footstepsArt },
  cheerleader: { glyph: "★", accent: "#ffd23f", artwork: kudosArt },
  mission_runner: { glyph: "➶", accent: "#3fbf7f", artwork: missionsArt },
  pathfinder: { glyph: "⚑", accent: "#59c3ff", artwork: questsArt },
};

const DEFAULT_EMBLEM: Emblem = { glyph: "◆", accent: "#8a8fa8" };

export function emblemFor(key: string): Emblem {
  return EMBLEMS[key] ?? DEFAULT_EMBLEM;
}

export function emblemArtworkUrl(emblem: Emblem): string | null {
  if (!emblem.artwork) return null;
  // A bundled import is already a resolved URL; only a bare public/ path needs BASE_URL.
  if (/^(https?:|data:|blob:|\/)/.test(emblem.artwork)) return emblem.artwork;
  return `${import.meta.env.BASE_URL}${emblem.artwork}`;
}
