// vo3d season — WHERE DECORATIONS GO. One module, every room, derived rather than hand-typed.
//
// ══ WHY THIS IS RULES AND NOT A LIST OF COORDINATES ══
//
// The office has eleven reconstructed rooms plus a hall and an atrium. A hand-authored table of a few
// hundred (x, z) pairs would be the single most fragile thing in the codebase: it could not survive a
// room being re-measured, it could not be reviewed, and every entry would be a chance to drop a pumpkin
// inside a desk. So placement is DERIVED from what the world already knows — each room's own rect and
// floorRect — through a handful of named rules, and the per-room table below only carries what a rule
// cannot know: how dense this room should be, and whether it deserves a hero composition.
//
// ══ THE SAFETY RULES, AND WHY THEY ARE GEOMETRIC RATHER THAN A CHECKLIST ══
//
// Decorations are nav-inert by construction (nav/solids.ts never reads a THREE object), so they cannot
// block movement whatever they do. What they CAN do is stand in front of someone. That is prevented by
// where, not by what:
//
//   · FLOOR PIECES HUG WALLS. Every floor placement sits within `WALL_HUG` of a wall, in the band
//     furniture and circulation already leave clear. Nothing is ever placed out in a floor.
//   · FLOOR PIECES ARE SHORT. Under ~14 units — knee height on an avatar — so they can never occlude a
//     face, a nameplate or a status ring.
//   · HANGING PIECES ARE HIGH. Above `HANG_Y`, clear of every avatar and every nameplate anchor, and
//     below the 46-unit wall head so nothing pokes through a roof.
//   · DOORWAYS ARE KEPT CLEAR. Every placement is tested against every door opening's centre and
//     dropped inside `DOOR_CLEARANCE`. This is belt-and-braces — a decoration cannot close a door — but
//     a pumpkin visually parked in a doorway still looks like an obstacle, and looking like one is its
//     own problem.
//   · CORNERS FIRST. Corners are where a room has no furniture, no seat, no interaction and no traffic,
//     which is exactly why the reference piles its decoration there too.
import type { Rect } from "../core/coords";
import type { DoorOpening } from "../adapters/v1Floor";

/** How far from a wall a floor decoration may sit. Inside this band is furniture-and-skirting country. */
export const WALL_HUG = 11;
/** Nothing is placed within this of a door opening's centre. */
export const DOOR_CLEARANCE = 34;
/** The lowest a hanging decoration may be. An avatar is ~30 tall; nameplates float above that. */
export const HANG_Y = 34;
/** The office's wall head. Nothing hanging may reach it. */
export const WALL_HEAD = 46;

export type Density = "hero" | "rich" | "normal" | "light";

/** A ROOM'S OWN SPOOKY PERSONALITY. The brief's ingredients are not a checklist to repeat in every
 *  room — they are a vocabulary, and a room picks from it. Two rooms with the same density but
 *  different characters should not look like each other. */
export type Character =
  /** dead greenery and heavy web — the office slowly being reclaimed */
  | "overgrown"
  /** bone and ornament — a collection that has been left too long */
  | "ossuary"
  /** spectral green light and ground fog — something is still here */
  | "haunted"
  /** scarecrow silhouettes and harvest gourds — the barn at the edge of the field */
  | "harvest"
  /** candle-lit study: warm, dense, close */
  | "wake";

export interface RoomDecorPlan {
  /** How much decoration this room gets. */
  density: Density;
  /** Which half of the vocabulary this room leans on. */
  character: Character;
  /** Rooms whose composition the reference-matching depends on get an extra hand-placed group. */
  hero?: "hub" | "reception";
}

/** THE ONE PLACE A ROOM'S SEASONAL TREATMENT IS DECIDED.
 *
 *  Rooms absent from this table still get the baseline treatment — the whole office is decorated in one
 *  pass, and a room that was forgotten here would be the one undecorated room in a decorated building.
 *  Being listed only changes HOW MUCH. */
export const ROOM_DECOR: Record<string, RoomDecorPlan> = {
  // The two spaces everybody passes through, and the two the brief singles out. Their compositions
  // are what a screenshot of "the Halloween office" is actually a screenshot of.
  "central-hub": { density: "hero", character: "haunted", hero: "hub" },
  "reception-room": { density: "hero", character: "wake", hero: "reception" },
  // Social rooms carry more than work rooms, which is also how a real office decorates.
  "gaming-room": { density: "rich", character: "haunted" },
  "project-room": { density: "rich", character: "overgrown" },
  "meeting-room": { density: "rich", character: "wake" },
  // Departments each get a different lean, so walking between them is walking between moods.
  "executive-room": { density: "normal", character: "ossuary" },
  "design-room": { density: "normal", character: "overgrown" },
  "cms-room": { density: "normal", character: "wake" },
  "ai-room": { density: "normal", character: "haunted" },
  "dev-room": { density: "normal", character: "ossuary" },
  "qa-room": { density: "normal", character: "harvest" },
};

/** Any room not listed still gets the full baseline treatment — a forgotten room would be the one
 *  undecorated room in a decorated building. */
export const DEFAULT_PLAN: RoomDecorPlan = { density: "normal", character: "overgrown" };

/** What each character actually places, on top of the shared baseline (webs, swags, bats, pumpkins,
 *  candles). Counts are per room and scale with density through `spread`. */
export const CHARACTER: Record<Character, { withered: number; skulls: number; ghosts: number; fog: number; decay: number; scarecrows: number }> = {
  // GHOSTS ARE RATIONED. At four per room the capture read as a rendering fault rather than as
  // atmosphere — a green blob in every room is not eerie, it is noise. They are now the signature of
  // the `haunted` character alone, at two, and absent everywhere else.
  overgrown: { withered: 10, skulls: 3, ghosts: 0, fog: 6, decay: 9, scarecrows: 1 },
  ossuary:   { withered: 5,  skulls: 10, ghosts: 0, fog: 5, decay: 8, scarecrows: 0 },
  haunted:   { withered: 5,  skulls: 5, ghosts: 2, fog: 9, decay: 8, scarecrows: 0 },
  harvest:   { withered: 7,  skulls: 3, ghosts: 0, fog: 6, decay: 8, scarecrows: 2 },
  wake:      { withered: 6,  skulls: 5, ghosts: 1, fog: 6, decay: 9, scarecrows: 1 },
};

/** How many of each kind a density buys. Tuned against the reference, whose density is high: it has
 *  webbing in every corner, a bat flock, and pumpkins or candles on every horizontal surface. */
export const DENSITY: Record<Density, { clusters: number; jacks: number; candleRows: number; bats: number; swags: number; lanterns: number }> = {
  // RAISED ACROSS THE BOARD for the final pass. The previous numbers left rooms reading as "the
  // office with pumpkins in it"; the references are DENSE — decoration on every surface, webbing
  // over the whole ceiling, clustered lanterns rather than single ones. The static bake means this
  // costs draw calls per MATERIAL, not per prop, so density is close to free now.
  hero:   { clusters: 12, jacks: 9, candleRows: 9, bats: 44, swags: 9, lanterns: 6 },
  rich:   { clusters: 9, jacks: 7, candleRows: 6, bats: 30, swags: 7, lanterns: 4 },
  normal: { clusters: 7, jacks: 5, candleRows: 5, bats: 22, swags: 6, lanterns: 3 },
  light:  { clusters: 4, jacks: 3, candleRows: 3, bats: 14, swags: 4, lanterns: 2 },
};

export interface Spot { x: number; z: number }

/** The four interior corners of a floor, pulled in by `inset`. */
export function corners(floor: Rect, inset: number): Spot[] {
  return [
    { x: floor.x + inset, z: floor.z + inset },
    { x: floor.x + floor.w - inset, z: floor.z + inset },
    { x: floor.x + inset, z: floor.z + floor.d - inset },
    { x: floor.x + floor.w - inset, z: floor.z + floor.d - inset },
  ];
}

/** Evenly spaced points along the four wall runs, hugging the wall by `hug`.
 *
 *  `perSide` points per wall, placed at the MIDDLES of equal divisions rather than at their edges, so
 *  no point ever lands exactly in a corner (where the corner rules already put something) or exactly at
 *  a wall's midpoint (where a door usually is). */
export function wallSpots(floor: Rect, perSide: number, hug = WALL_HUG): Spot[] {
  const out: Spot[] = [];
  if (perSide <= 0) return out;
  for (let i = 0; i < perSide; i++) {
    const t = (i + 0.5) / perSide;
    const x = floor.x + floor.w * t;
    const z = floor.z + floor.d * t;
    out.push({ x, z: floor.z + hug });                 // north wall
    out.push({ x, z: floor.z + floor.d - hug });       // south wall
    out.push({ x: floor.x + hug, z });                 // west wall
    out.push({ x: floor.x + floor.w - hug, z });       // east wall
  }
  return out;
}

/** Drop every spot too close to a doorway. */
export function clearOfDoors(spots: readonly Spot[], doors: readonly DoorOpening[], clearance = DOOR_CLEARANCE): Spot[] {
  if (doors.length === 0) return [...spots];
  return spots.filter((s) =>
    doors.every((d) => {
      const dx = s.x - d.centre.x, dz = s.z - d.centre.z;
      return dx * dx + dz * dz > clearance * clearance;
    }),
  );
}

/** Drop every spot outside the room's own floor — a guard for rooms whose floorRect is smaller than
 *  their rect, so a rule derived from one never places into the other's wall. */
export function insideFloor(spots: readonly Spot[], floor: Rect, margin = 2): Spot[] {
  return spots.filter(
    (s) =>
      s.x > floor.x + margin &&
      s.x < floor.x + floor.w - margin &&
      s.z > floor.z + margin &&
      s.z < floor.z + floor.d - margin,
  );
}

/** Take up to `n` spots, spread across the list rather than taken from the front — otherwise a low
 *  density would decorate one wall and leave the other three bare. */
export function spread<T>(items: readonly T[], n: number): T[] {
  if (n <= 0 || items.length === 0) return [];
  if (n >= items.length) return [...items];
  const step = items.length / n;
  return Array.from({ length: n }, (_, i) => items[Math.floor(i * step)]);
}
