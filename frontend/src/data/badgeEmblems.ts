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
import pathfinderBronzeArt from "../assets/badge-art/pathfinder-bronze.png";
import pathfinderSilverArt from "../assets/badge-art/pathfinder-silver.png";
import pathfinderGoldArt from "../assets/badge-art/pathfinder-gold.png";
import pathfinderPlatinumArt from "../assets/badge-art/pathfinder-platinum.png";
import regularBronzeArt from "../assets/badge-art/regular-bronze.png";
import regularSilverArt from "../assets/badge-art/regular-silver.png";
import regularGoldArt from "../assets/badge-art/regular-gold.png";
import regularPlatinumArt from "../assets/badge-art/regular-platinum.png";
import connectorBronzeArt from "../assets/badge-art/connector-bronze.png";
import connectorSilverArt from "../assets/badge-art/connector-silver.png";
import connectorGoldArt from "../assets/badge-art/connector-gold.png";
import connectorPlatinumArt from "../assets/badge-art/connector-platinum.png";
import approachableBronzeArt from "../assets/badge-art/approachable-bronze.png";
import approachableSilverArt from "../assets/badge-art/approachable-silver.png";
import approachableGoldArt from "../assets/badge-art/approachable-gold.png";
import approachablePlatinumArt from "../assets/badge-art/approachable-platinum.png";
import hubRegularBronzeArt from "../assets/badge-art/hub-regular-bronze.png";
import hubRegularSilverArt from "../assets/badge-art/hub-regular-silver.png";
import hubRegularGoldArt from "../assets/badge-art/hub-regular-gold.png";
import hubRegularPlatinumArt from "../assets/badge-art/hub-regular-platinum.png";
import cheerleaderBronzeArt from "../assets/badge-art/cheerleader-bronze.png";
import cheerleaderSilverArt from "../assets/badge-art/cheerleader-silver.png";
import cheerleaderGoldArt from "../assets/badge-art/cheerleader-gold.png";
import cheerleaderPlatinumArt from "../assets/badge-art/cheerleader-platinum.png";
import missionRunnerBronzeArt from "../assets/badge-art/mission-runner-bronze.png";
import missionRunnerSilverArt from "../assets/badge-art/mission-runner-silver.png";
import missionRunnerGoldArt from "../assets/badge-art/mission-runner-gold.png";
import missionRunnerPlatinumArt from "../assets/badge-art/mission-runner-platinum.png";
import streakBronzeArt from "../assets/badge-art/streak-bronze.png";
import streakSilverArt from "../assets/badge-art/streak-silver.png";
import streakGoldArt from "../assets/badge-art/streak-gold.png";
import streakPlatinumArt from "../assets/badge-art/streak-platinum.png";

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

/* ---- production masters --------------------------------------------------------------------
   The emblems above are ACTIVITY icons dropped into a shared frame — every badge ends up the same
   circular medallion with a different picture in it. A MASTER is the opposite: one rendered
   collectible whose silhouette comes from what the badge means (Pathfinder is a mountain crest,
   not a disc) and whose material already carries the tier. So a master replaces the frame instead
   of sitting inside it, and it is keyed by `<emblem>-<tier>` because Bronze->Platinum is a
   different physical object, not a caption colour.

   All eight badges now ship all four metals, so `badgeMasterUrl` resolves for every earned tier
   and the framed-emblem path below is a fallback only for an unknown key. */

const BADGE_MASTERS: Readonly<Record<string, string>> = {
  "pathfinder-1": pathfinderBronzeArt,
  "pathfinder-2": pathfinderSilverArt,
  "pathfinder-3": pathfinderGoldArt,
  "pathfinder-4": pathfinderPlatinumArt,
  "regular-1": regularBronzeArt,
  "regular-2": regularSilverArt,
  "regular-3": regularGoldArt,
  "regular-4": regularPlatinumArt,
  "connector-1": connectorBronzeArt,
  "connector-2": connectorSilverArt,
  "connector-3": connectorGoldArt,
  "connector-4": connectorPlatinumArt,
  "approachable-1": approachableBronzeArt,
  "approachable-2": approachableSilverArt,
  "approachable-3": approachableGoldArt,
  "approachable-4": approachablePlatinumArt,
  "hub_regular-1": hubRegularBronzeArt,
  "hub_regular-2": hubRegularSilverArt,
  "hub_regular-3": hubRegularGoldArt,
  "hub_regular-4": hubRegularPlatinumArt,
  "cheerleader-1": cheerleaderBronzeArt,
  "cheerleader-2": cheerleaderSilverArt,
  "cheerleader-3": cheerleaderGoldArt,
  "cheerleader-4": cheerleaderPlatinumArt,
  "mission_runner-1": missionRunnerBronzeArt,
  "mission_runner-2": missionRunnerSilverArt,
  "mission_runner-3": missionRunnerGoldArt,
  "mission_runner-4": missionRunnerPlatinumArt,
  "streak-1": streakBronzeArt,
  "streak-2": streakSilverArt,
  "streak-3": streakGoldArt,
  "streak-4": streakPlatinumArt,
};

/** The full collectible for this badge at this tier, or null to fall back to the framed emblem. */
export function badgeMasterUrl(emblemKey: string, tier: number): string | null {
  return BADGE_MASTERS[`${emblemKey}-${tier}`] ?? null;
}
