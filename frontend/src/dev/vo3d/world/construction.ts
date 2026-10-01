// vo3d world — CONSTRUCTION SITES AND THE CREW THAT WORKS THEM, as data. Pure; no THREE.
//
// REUSABLE BY DESIGN. A site is a fenced YARD, an optional SCAFFOLD against a wall, a sign, its props, and
// a list of WORK SPOTS. The crew is five people defined once (CREW: what each wears and how they move);
// avatar/ConstructionCrew puts member i on work spot i of whichever site it is given. Moving the crew to a
// future development is a new ConstructionSite literal — no builder, crew or ground code changes.
//
// The builder (build/constructionSite) draws exactly what is here; the ground model (world/exteriorGround)
// reads `constructionSolids` from the same data, so the fence and the scaffold stop a body exactly where
// they stand and nothing invisible is ever added.
import type { Rect, Vec2 } from "../core/coords";
import { DECK_Y, GRADE } from "./ailab";

/** WHAT A WORKER DOES, deterministically (a pure function of the wall clock — every client agrees):
 *    hammer   stand at a bench and drive nails: the hammer arm rises and falls on a steady beat
 *    carry    shoulder a plank and walk it from `from` to `to`, set it down, walk back
 *    inspect  hold a tablet, study it, look up at the works, nod
 *    tool     brace a power drill against the work, in bursts
 *    supply   push supplies between two points with a rest at each end */
export type CrewActivity =
  | { kind: "hammer"; at: Vec2; yaw: number; y?: number }
  | { kind: "carry"; from: Vec2; to: Vec2; y?: number }
  | { kind: "inspect"; at: Vec2; yaw: number; lookYaw: number; y?: number }
  | { kind: "tool"; at: Vec2; yaw: number; y?: number }
  | { kind: "supply"; from: Vec2; to: Vec2; y?: number };

/** HOW A CREW MEMBER LOOKS. Colours are sRGB hex. `skin` multiplies the base character's material (a
 *  restrained warm/cool/deeper shift); `scale` is a small, safe proportion change (±5%). */
export type CrewLook = {
  id: string;
  hat: number;
  vest: number;
  /** the vest's reflective band */
  band: number;
  trousers: number;
  boots: number;
  skin: number;
  scale: number;
  /** what they hold: a hammer, a tablet, a drill, a plank on the shoulder, or work gloves only */
  tool: "hammer" | "tablet" | "drill" | "plank" | "gloves";
  /** accessories that change the silhouette */
  extras: ("toolbelt" | "earmuffs" | "glasses" | "backpack")[];
};

/** THE CREW: five people, one rig. Distinct at a glance by hat, vest, trousers, size and what they carry. */
export const CREW: readonly CrewLook[] = [
  { id: "crew-foreman", hat: 0xf4f1e8, vest: 0xff8a1f, band: 0xe8eef0, trousers: 0x2f3a4d, boots: 0x3a2a1e, skin: 0xffffff, scale: 1.04, tool: "tablet", extras: ["glasses"] },
  { id: "crew-carpenter", hat: 0xf2c230, vest: 0xd8f03a, band: 0xd6dde0, trousers: 0x4d5a2f, boots: 0x5a3c22, skin: 0xf3dcc8, scale: 0.97, tool: "hammer", extras: ["toolbelt"] },
  { id: "crew-hauler", hat: 0xe8622a, vest: 0xff8a1f, band: 0xe8eef0, trousers: 0x3b4252, boots: 0x2b2420, skin: 0xd9b79a, scale: 1.05, tool: "plank", extras: ["backpack"] },
  { id: "crew-fitter", hat: 0x2f78d4, vest: 0xd8f03a, band: 0xd6dde0, trousers: 0x6b5a45, boots: 0x3a2a1e, skin: 0xe8c9ad, scale: 0.95, tool: "drill", extras: ["earmuffs", "toolbelt"] },
  { id: "crew-labourer", hat: 0x3fae5a, vest: 0xff6a3a, band: 0xe8eef0, trousers: 0x2c2f36, boots: 0x4a3524, skin: 0xc9a283, scale: 1.0, tool: "gloves", extras: [] },
];

export type SiteProp =
  | { kind: "cabin"; x: number; z: number; yaw: number }
  | { kind: "lumber"; x: number; z: number; yaw: number }
  | { kind: "blocks"; x: number; z: number; yaw: number }
  | { kind: "bags"; x: number; z: number; yaw: number }
  | { kind: "rebar"; x: number; z: number; yaw: number }
  | { kind: "sawhorse"; x: number; z: number; yaw: number }
  | { kind: "mixer"; x: number; z: number; yaw: number }
  | { kind: "barrow"; x: number; z: number; yaw: number }
  | { kind: "skip"; x: number; z: number; yaw: number }
  | { kind: "generator"; x: number; z: number; yaw: number }
  | { kind: "toolbox"; x: number; z: number; yaw: number }
  | { kind: "cone"; x: number; z: number; yaw: number }
  | { kind: "paving-works"; x: number; z: number; yaw: number }
  | { kind: "blockwall"; x: number; z: number; yaw: number };

export type ConstructionSite = {
  id: string;
  /** the sign's two lines */
  title: string;
  subtitle: string;
  /** the fenced laydown yard, on the lawn at `groundY` */
  yard: Rect;
  groundY: number;
  fenceH: number;
  /** the yard side carrying the solid hoarding and the sign (the side facing the approach) */
  hoardingSide: "north" | "south" | "east" | "west";
  /** a scaffold standing against a wall run: standards from x0 to x1 in front of a wall face at zWall,
   *  `depth` deep (toward +z), lifts (platform heights above `deckY`) */
  scaffold: { x0: number; x1: number; zWall: number; depth: number; deckY: number; lifts: number[]; bays: number } | null;
  props: readonly SiteProp[];
  /** tripod work lights: a lit head and a pool after dark */
  lights: readonly { x: number; z: number; yaw: number; y: number }[];
  /** where each crew member works, in CREW order */
  work: readonly CrewActivity[];
};

/** THE AI LAB'S SITE. The Lab is open but unfinished: the yard sits on the rear lawn beside the junction of
 *  the rear path and the turn-in (PATH_W / PATH_IN), clear of both, between the Lab's screen planting and
 *  the rear bed; the scaffold stands on the terrace against the south wall's west run, shallow enough that
 *  the terrace still passes in front of it (33 clear). */
export const AI_LAB_SITE: ConstructionSite = {
  id: "ai-lab",
  title: "AI LAB — UNDER CONSTRUCTION",
  subtitle: "Offshorly R&D · Phase 2 works in progress",
  yard: { x: 404, z: -320, w: 272, d: 120 },
  groundY: GRADE,
  fenceH: 22,
  hoardingSide: "east",
  scaffold: { x0: 392, x1: 568, zWall: -435.5, depth: 24, deckY: DECK_Y, lifts: [26, 50], bays: 4 },
  props: [
    { kind: "cabin", x: 449, z: -301, yaw: 0 },
    { kind: "lumber", x: 530, z: -306, yaw: 0 },
    { kind: "blocks", x: 584, z: -307, yaw: 0.08 },
    { kind: "bags", x: 618, z: -307, yaw: -0.1 },
    { kind: "rebar", x: 520, z: -210, yaw: 0 },
    { kind: "sawhorse", x: 500, z: -246, yaw: 0 },
    { kind: "mixer", x: 430, z: -228, yaw: 0.6 },
    { kind: "barrow", x: 563, z: -216, yaw: -0.5 },
    { kind: "skip", x: 638, z: -213, yaw: 0 },
    { kind: "generator", x: 470, z: -212, yaw: 0.3 },
    { kind: "toolbox", x: 520, z: -238, yaw: 0.4 },
    { kind: "paving-works", x: 590, z: -256, yaw: 0 },
    { kind: "blockwall", x: 440, z: -262, yaw: 0 },
    // the scaffold's own: a toolbox on the terrace foot, cones at its ends
    { kind: "cone", x: 384, z: -405, yaw: 0 },
    { kind: "cone", x: 576, z: -405, yaw: 0 },
  ],
  lights: [
    { x: 418, z: -244, yaw: -0.6, y: GRADE },
    { x: 664, z: -300, yaw: 2.4, y: GRADE },
    // the scaffold's own lamp, clamped to its outer standard at the top lift (no tripod on the boards)
    { x: 568, z: -410, yaw: 3.0, y: DECK_Y + 26 },
  ],
  work: [
    // the foreman inside the hoarding, tablet in hand, looking north to the Lab between checks
    { kind: "inspect", at: { x: 641, z: -292 }, yaw: Math.PI * 0.9, lookYaw: Math.PI * 1.1 },
    // the carpenter at the sawhorse, facing it (north)
    { kind: "hammer", at: { x: 500, z: -231 }, yaw: Math.PI },
    // the hauler: timber from the stack to the paving works
    { kind: "carry", from: { x: 534, z: -288 }, to: { x: 632, z: -238 } },
    // the fitter on the scaffold's first lift, drilling the wall's new capping
    { kind: "tool", at: { x: 486, z: -425 }, yaw: Math.PI, y: DECK_Y + 26 + 1 },
    // the labourer: from the cabin door to the mixer and the barrow and back, resting at each end
    { kind: "supply", from: { x: 452, z: -279 }, to: { x: 585, z: -228 } },
  ],
};
export const CONSTRUCTION_SITES: readonly ConstructionSite[] = [AI_LAB_SITE];

/** what stops a body on a site: the fence (four thin runs; the hoarding is one of them) and the scaffold's
 *  footprint. Everything else stands inside the fence. */
export function constructionSolids(site: ConstructionSite): { id: string; rect: Rect }[] {
  const y = site.yard, t = 6;
  const out = [
    { id: `site:${site.id}:fence-n`, rect: { x: y.x - t / 2, z: y.z - t / 2, w: y.w + t, d: t } },
    { id: `site:${site.id}:fence-s`, rect: { x: y.x - t / 2, z: y.z + y.d - t / 2, w: y.w + t, d: t } },
    { id: `site:${site.id}:fence-w`, rect: { x: y.x - t / 2, z: y.z - t / 2, w: t, d: y.d + t } },
    { id: `site:${site.id}:fence-e`, rect: { x: y.x + y.w - t / 2, z: y.z - t / 2, w: t, d: y.d + t } },
  ];
  const s = site.scaffold;
  if (s) out.push({ id: `site:${site.id}:scaffold`, rect: { x: s.x0 - 4, z: s.zWall, w: s.x1 - s.x0 + 8, d: s.depth + 3 } });
  return out;
}
