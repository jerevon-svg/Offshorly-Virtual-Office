// vo3d season/christmas — WHICH ROOM GETS WHAT, and how much of it.
//
// The GEOMETRY of placement — corners, wall runs, door clearance, the floor guard, the spread — is
// season-agnostic and lives in season/placement.ts, which Halloween and Christmas both import. This
// module is only the Christmas half: its vocabulary, its per-room table and its density steps.
//
// ══ THE ONE RULE THIS FILE ADDS ══
//
// TREES ARE CORNER PIECES, and `TREE_HUG` is why. Everything else in the season obeys the shared
// WALL_HUG of 11; a tree is 26–40 units tall and its skirt is a third of that wide, so it is pulled
// further in from the wall AND is only ever handed corner spots by the layer. See the exception note
// in christmas/decor.ts for why a tall piece is allowed at all — a tree in a corner cannot stand
// between the camera and a face, and one on an open floor could.
import type { Density } from "../placement";

/** How far from a wall a TREE may sit — further than everything else, because a tree has a skirt. */
export const TREE_HUG = 20;

/** A ROOM'S OWN WINTER PERSONALITY. The brief's ingredients are a vocabulary, not a checklist to
 *  repeat everywhere: two rooms at the same density but different characters must not look alike. */
export type WinterCharacter =
  /** a stand of snow-covered trees and frosted planting — the office as a winter wood */
  | "grove"
  /** ice crystal, icicles and hanging flakes — the cold, glittering end of the palette */
  | "crystal"
  /** lanterns, fairy lights and piles of white gifts — warm, close, festive */
  | "hearth"
  /** silver ornament, wreaths and garland — the restrained, expensive one */
  | "boutique"
  /** drifted snow, sparkle and very little else — quiet rooms and thoroughfares */
  | "drift";

export interface WinterDecorPlan {
  density: Density;
  character: WinterCharacter;
  /** Rooms whose composition a screenshot of "the Christmas office" actually is. */
  hero?: "hub" | "reception";
}

/** THE ONE PLACE A ROOM'S SEASONAL TREATMENT IS DECIDED.
 *
 *  A room absent from this table still gets the full baseline treatment — a forgotten room would be
 *  the one undecorated room in a decorated building. Being listed only changes HOW MUCH and WHICH
 *  half of the vocabulary. */
export const WINTER_ROOM_DECOR: Record<string, WinterDecorPlan> = {
  // The two spaces everybody passes through, and the two the brief singles out.
  "central-hub": { density: "hero", character: "crystal", hero: "hub" },
  "reception-room": { density: "hero", character: "grove", hero: "reception" },
  // Social rooms carry more than work rooms, which is also how a real office decorates.
  "gaming-room": { density: "rich", character: "hearth" },
  "project-room": { density: "rich", character: "grove" },
  "meeting-room": { density: "rich", character: "crystal" },
  // Departments each get a different lean, so walking between them is walking between moods.
  "executive-room": { density: "normal", character: "boutique" },
  "design-room": { density: "normal", character: "boutique" },
  "cms-room": { density: "normal", character: "hearth" },
  "ai-room": { density: "normal", character: "crystal" },
  "dev-room": { density: "normal", character: "grove" },
  "qa-room": { density: "normal", character: "drift" },
};

export const WINTER_DEFAULT_PLAN: WinterDecorPlan = { density: "normal", character: "drift" };

/** What each character places ON TOP of the shared baseline (garlands, hanging flakes, icicles at the
 *  wall head, a dusting of drift). Counts are per room and are scaled by density through `spread`. */
export const WINTER_CHARACTER: Record<
  WinterCharacter,
  { trees: number; branches: number; crystals: number; gifts: number; wreaths: number; fairy: number; sparkles: number }
> = {
  grove:    { trees: 3, branches: 8, crystals: 1, gifts: 2, wreaths: 1, fairy: 2, sparkles: 4 },
  crystal:  { trees: 2, branches: 3, crystals: 6, gifts: 1, wreaths: 1, fairy: 2, sparkles: 7 },
  hearth:   { trees: 2, branches: 4, crystals: 1, gifts: 5, wreaths: 2, fairy: 4, sparkles: 4 },
  boutique: { trees: 2, branches: 4, crystals: 3, gifts: 3, wreaths: 3, fairy: 3, sparkles: 5 },
  drift:    { trees: 1, branches: 6, crystals: 2, gifts: 1, wreaths: 1, fairy: 1, sparkles: 6 },
};

/** How much of the BASELINE a density buys: the elements every room gets whatever its character.
 *
 *  Held deliberately close to Halloween's steps, for one measured reason: the per-material static bake
 *  means density costs draw calls per MATERIAL, not per prop, so the expensive number here is not the
 *  count but the number of distinct materials — and this season has about as many as that one did. */
export const WINTER_DENSITY: Record<
  Density,
  { lanterns: number; garlands: number; flakes: number; icicleRuns: number; drifts: number }
> = {
  // GARLAND COUNTS CAME DOWN AFTER THE SECOND CAPTURE. At eight per hero room the swags read from the
  // office camera as parallel STRIPES across the floor rather than as hanging decoration — the same
  // failure Halloween's drapes had, in the opposite colour. Five is enough to fill the upper band and
  // few enough that the eye reads each one as an object.
  hero:   { lanterns: 8, garlands: 5, flakes: 40, icicleRuns: 4, drifts: 7 },
  rich:   { lanterns: 6, garlands: 4, flakes: 30, icicleRuns: 4, drifts: 6 },
  normal: { lanterns: 5, garlands: 3, flakes: 22, icicleRuns: 3, drifts: 5 },
  light:  { lanterns: 3, garlands: 2, flakes: 14, icicleRuns: 2, drifts: 3 },
};
