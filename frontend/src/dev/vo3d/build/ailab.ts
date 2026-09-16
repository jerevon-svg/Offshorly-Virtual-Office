// vo3d build — THE OFFSHORLY AI LAB, as geometry.
//
// SCENERY-SHAPED, like the campus and the pond: one group, added straight to the scene by app/bootstrap,
// never to the world graph, the room mirror, the editor, the nav grid or the shadow-caster set. It holds
// no reference to WorldState, Walkability, CameraModes, the avatar or the graphics controller, so it is
// structurally incapable of affecting any of them. Deleting this file and three lines of bootstrap
// removes it completely.
//
// THREE COST RULES, and every one of them is a rule the office already works to:
//
//   1. NO REAL LIGHTS. Every lit thing in here is an emissive mesh with an additive halo, exactly as
//      build/ai-furniture.ledLine does it. The scene's light rig is untouched.
//   2. NO SHADOWS, CAST OR RECEIVED. The office's static shadow map is sized from the viewport, and a
//      750-unit structure 900 units north of the building would either fall outside that frustum or
//      force it wider — which would cost shadow resolution across the WHOLE office. So the Lab is out
//      of the shadow pass entirely and carries its own painted contact shading instead.
//   3. ONE MESH PER MATERIAL. Everything static goes through Baker, because the office frame is
//      draw-call bound (~9,900 calls for 2.3M triangles), not triangle bound.
//
// The only meshes that escape Baker are the three agent robots (each carries a UNIQUE status material,
// so it cannot merge with its neighbours) and the four labels (each carries its own CanvasTexture).
import * as THREE from "three";
import { Baker, rbox, cyl, slab } from "./helpers";
import { tiledFloor } from "./tile";
import { opsRobot } from "./ai-furniture";
import { pot as taperedPot } from "./props";
import { ledgePlanter } from "./frontbar";
import { largePlant, mediumPlant } from "./plants";
import { FoliageSystem } from "../render/Foliage";
import { SwaySystem } from "../render/Sway";
import type { SwayNode } from "../render/Sway";
import { mat, emissiveMat, emissiveMatUnique, glowMat, glowMatUnique } from "../render/Materials";
import {
  CORNER_TREES, DECK_Y, ENTRY_X0, ENTRY_X1, GRADE, HALL, HUB, INTERIOR_POTS, LAB_OUTER, LAKE_GAP_X0,
  LAKE_GAP_X1, LAKE_SPUR, LAKE_TERRACE, PAVED, PERIMETER_POTS, PILASTERS, PLINTH_MARGIN, PORCH,
  SOUTH_BAY, STEP_COUNT, WALL_BEDS, WALL_H, WALL_SEGS, WALL_T, ZONES,
  type Planter, type PlantKind,
} from "../world/ailab";
import { AGENTS, AUX_STATUS, STATUS_LABEL, STATUS_PULSE, STATUS_TINT, agentById } from "../world/aiAgents";
import type { Rect, Vec2 } from "../core/coords";

/** deck thickness: the plate stands proud of the lawn by exactly the office podium's own rise */
const DECK_T = DECK_Y - GRADE; // 8.2
const DESK_TOP = 24;

export type AiLabBuild = {
  group: THREE.Group;
  tick(t: number): void;
  stats: { draws: number; agents: number; blades: number };
};

type Mats = ReturnType<typeof materials>;
function materials() {
  return {
    /** the plinth, the terrace and every paved band: the campus's own warm concrete */
    stone: mat("hubStone", 0.9),
    /** the paler paving used for inlays and bench seats — the V1 hall's own exterior tone */
    paving: mat("exterior", 0.9),
    /** the low walls and partitions: the front bar's warm cream plaster */
    plaster: mat("plaster", 0.9),
    reveal: mat("aiCarbonDeep", 0.7),
    carbon: mat("aiCarbon", 0.7),
    deskTop: mat("aiCounter", 0.5),
    deskBody: mat("aiPlaster", 0.72),
    frame: mat("aiFrame", 0.38, { metalness: 0.45 }),
    seat: mat("aiSeat", 0.8),
    screen: emissiveMat("aiScreenUi", 0.9, 0.3),
    ledCore: emissiveMat("aiLed", 1.5, 0.3),
    ledHalo: glowMat("aiLed", 0.28),
    foliage: mat("foliage", 0.85),
    foliageLight: mat("foliageLight", 0.85),
    soil: mat("potDark", 1),
  };
}

// ---- primitives -----------------------------------------------------------------------------------
/** a wall run between two points, at any angle — the corner cuts are diagonal, so an axis-aligned box
 *  cannot express this perimeter. One box, rotated about Y to the segment's bearing. */
function wallSeg(b: Baker, a: Vec2, c: Vec2, h: number, t: number, m: THREE.Material, led?: THREE.Material): void {
  const dx = c.x - a.x, dz = c.z - a.z;
  const len = Math.hypot(dx, dz);
  const mid = { x: (a.x + c.x) / 2, z: (a.z + c.z) / 2 };
  const yaw = Math.atan2(dx, dz);
  const run = rbox(t, h, len + t, m, 0, 0, 0, 1.2);
  run.position.set(mid.x, DECK_Y, mid.z);
  run.rotation.y = yaw;
  b.add(run);
  if (led) {
    const cap = rbox(t * 0.34, 1.2, len - 4, led, 0, 0, 0, 0.4);
    cap.position.set(mid.x, DECK_Y + h - 0.6, mid.z);
    cap.rotation.y = yaw;
    b.add(cap);
  }
}

/** a shrub: two offset lumps of leaf, the cheapest thing that reads as planting from every angle */
function shrub(b: Baker, cx: number, y: number, cz: number, r: number, M: Mats): void {
  b.add(cyl(r, r * 1.5, M.foliage, cx, y, cz, r * 0.55));
  b.add(cyl(r * 0.66, r * 1.1, M.foliageLight, cx + r * 0.3, y + r * 0.7, cz - r * 0.25, r * 0.3));
}

/** a planted pot: shell, soil, planting. The reference sets these along every wall and between zones. */
function pot(b: Baker, r: Rect, M: Mats, tall = false): void {
  const cx = r.x + r.w / 2, cz = r.z + r.d / 2, s = Math.min(r.w, r.d);
  b.add(rbox(r.w, tall ? 20 : 15, r.d, M.reveal, cx, DECK_Y, cz, 1.4));
  b.add(rbox(r.w - 5, 1.5, r.d - 5, M.soil, cx, DECK_Y + (tall ? 19 : 14), cz, 0.8));
  shrub(b, cx, DECK_Y + (tall ? 20 : 15), cz, s * 0.34, M);
}

/** a tree, in the campus's own read: trunk plus three lumps of canopy */
function tree(b: Baker, cx: number, cz: number, s: number, M: Mats): void {
  b.add(cyl(5.5 * s, 42 * s, M.reveal, cx, DECK_Y, cz, 4 * s));
  b.add(cyl(30 * s, 38 * s, M.foliage, cx, DECK_Y + 36 * s, cz, 14 * s));
  b.add(cyl(22 * s, 24 * s, M.foliageLight, cx - 10 * s, DECK_Y + 56 * s, cz + 7 * s, 9 * s));
}

/** a bench: seat plate on two stone cheeks, as the reference lines the walls with */
function bench(b: Baker, cx: number, cz: number, w: number, yaw: number, M: Mats): void {
  const g = (mesh: THREE.Mesh) => { mesh.position.set(cx + mesh.position.x, mesh.position.y, cz + mesh.position.z); b.add(mesh); };
  const along = Math.abs(Math.cos(yaw)) > 0.5;
  const sw = along ? w : 16, sd = along ? 16 : w;
  g(rbox(sw, 4, sd, M.paving, 0, DECK_Y + 10, 0, 1));
  for (const o of [-1, 1]) g(rbox(along ? 8 : 12, 10, along ? 12 : 8, M.stone, along ? o * (w / 2 - 8) : 0, DECK_Y, along ? 0 : o * (w / 2 - 8), 0.6));
}

/** ONE DESK with its screens and chair. `yaw` is the direction its operator FACES (0 = north). */
function desk(b: Baker, r: Rect, yaw: number, screens: number, M: Mats): void {
  const cx = r.x + r.w / 2, cz = r.z + r.d / 2;
  const fx = Math.sin(yaw), fz = -Math.cos(yaw); // the operator's facing vector
  const along = r.w >= r.d;
  const halfDepth = (along ? r.d : r.w) / 2;
  b.add(rbox(r.w - 10, DESK_TOP - 4, r.d - 8, M.deskBody, cx, DECK_Y, cz, 1));
  b.add(rbox(r.w, 4, r.d, M.deskTop, cx, DECK_Y + DESK_TOP - 4, cz, 1));
  // the lit spine along the operator's edge
  const ex = cx - fx * (halfDepth - 3), ez = cz - fz * (halfDepth - 3);
  b.add(rbox(along ? r.w - 16 : 1.4, 1.2, along ? 1.4 : r.d - 16, M.ledCore, ex, DECK_Y + DESK_TOP - 6, ez, 0.5));
  b.add(rbox(along ? r.w - 14 : 3, 2.4, along ? 3 : r.d - 14, M.ledHalo, ex, DECK_Y + DESK_TOP - 7, ez, 0.8));
  // SCREENS. Small, low and grouped over the middle of the desk — equipment sitting ON a workstation,
  // not a dark architectural bar spanning it. The old bank was 30 tall across the desk's whole width and
  // it was the strongest shape in the room from overhead; this is 18 tall over 55% of the width, on a
  // thin riser, which reads as technology and lets the desks, the island and the trees carry the massing.
  const sx = cx + fx * (halfDepth - 8), sz = cz + fz * (halfDepth - 8);
  const span = ((along ? r.w : r.d) - 30) * 0.55;
  const wide = Math.min(38, span / screens + 4);
  b.add(rbox(along ? span + wide : 5, 2.4, along ? 5 : span + wide, M.carbon, sx, DECK_Y + DESK_TOP, sz, 0.6));
  for (let i = 0; i < screens; i++) {
    const t = screens === 1 ? 0 : (i / (screens - 1) - 0.5) * span;
    const px = sx + (along ? t : 0), pz = sz + (along ? 0 : t);
    b.add(rbox(along ? wide : 1.8, 18, along ? 1.8 : wide, M.carbon, px, DECK_Y + DESK_TOP + 2, pz, 0.5));
    b.add(rbox(along ? wide - 4 : 0.7, 14, along ? 0.7 : wide - 4, M.screen, px - fx * 1.2, DECK_Y + DESK_TOP + 4, pz - fz * 1.2, 0.3));
  }
  // the chair, offset along the desk so it never shares ground with the station's agent
  const ox = along ? r.w * 0.3 : 0, oz = along ? 0 : r.d * 0.3;
  const chx = cx - fx * (halfDepth + 22) + ox, chz = cz - fz * (halfDepth + 22) + oz;
  b.add(cyl(11, 1.6, M.frame, chx, DECK_Y, chz, 11));
  b.add(cyl(2.4, 11, M.frame, chx, DECK_Y + 1.6, chz));
  b.add(rbox(26, 4, 26, M.seat, chx, DECK_Y + 12.6, chz, 1.6));
  b.add(rbox(26, 22, 4, M.seat, chx - fx * 11, DECK_Y + 16.6, chz - fz * 11, 1.6));
}

/** A TECHNICAL CONSOLE: a low equipment run with a tight bank of small monitors on it. This replaces the
 *  old `screenWall` — a 190 x 42 slab of carbon that read from overhead as a piece of architecture rather
 *  than as kit. Same information, a fifth of the visual weight. */
function console(b: Baker, r: Rect, M: Mats): void {
  const cx = r.x + r.w / 2, cz = r.z + r.d / 2;
  const along = r.w >= r.d;
  b.add(rbox(r.w, 16, r.d, M.deskBody, cx, DECK_Y, cz, 1));
  b.add(rbox(r.w + 3, 2.6, r.d + 3, M.deskTop, cx, DECK_Y + 16, cz, 0.8));
  const span = (along ? r.w : r.d) * 0.62;
  for (let i = 0; i < 3; i++) {
    const t = (i / 2 - 0.5) * span;
    const px = cx + (along ? t : 0), pz = cz + (along ? 0 : t);
    b.add(rbox(along ? span / 3 : 1.6, 14, along ? 1.6 : span / 3, M.carbon, px, DECK_Y + 18, pz, 0.4));
    b.add(rbox(along ? span / 3 - 4 : 0.6, 11, along ? 0.6 : span / 3 - 4, M.screen, px, DECK_Y + 19.5, pz - 1, 0.3));
  }
  b.add(rbox(along ? r.w - 8 : 1.2, 1, along ? 1.2 : r.d - 8, M.ledCore, cx, DECK_Y + 15.4, cz, 0.4));
}

/** a round meeting table with three stools, as the reference sets beside each cluster of desks */
function meetingTable(b: Baker, t: { x: number; z: number; r: number }, M: Mats): void {
  b.add(cyl(t.r * 0.18, 26, M.frame, t.x, DECK_Y, t.z, t.r * 0.3));
  b.add(cyl(t.r * 0.5, 1.2, M.frame, t.x, DECK_Y, t.z, t.r * 0.5));
  b.add(cyl(t.r, 3.4, M.deskTop, t.x, DECK_Y + 26, t.z, t.r));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.6;
    const sx = t.x + Math.cos(a) * (t.r + 17), sz = t.z + Math.sin(a) * (t.r + 17);
    b.add(cyl(9, 15, M.seat, sx, DECK_Y, sz, 8));
    b.add(cyl(9.5, 2.4, M.frame, sx, DECK_Y + 15, sz, 9.5));
  }
}

// ============================ VEGETATION ==========================================================
// FIVE LEVELS, as the reference uses them, all built from planting languages the office already has:
//
//   1 DESK DETAIL        a small succulent on a work surface                    (deskDetail)
//   2 WORKSTATION        a medium leafy plant beside a desk or partition        (build/plants mediumPlant)
//   3 ARCHITECTURAL      long cream beds and troughs that define the zones      (bed / WALL_BEDS)
//   4 FEATURE            the island's layered garden and the large corner plants (build/plants largePlant)
//   5 PERIMETER          the exterior groves, untouched by this pass            (world/campus)
//
// The blades come from the office's OWN leaf family: `mediumPlant`/`largePlant` emit leaf ANCHORS, and
// render/Foliage batches every one of them into a single InstancedMesh per material. That is why a much
// lusher room costs almost nothing in draw calls.

/** a cream stone planting bed: rim frame + recessed soil — the Central Hub's pantry-planter language.
 *  `fill` scatters low planting across the soil so the bed reads as ONE PLANTED MASS rather than as a
 *  trough with a single object standing in it. That is the whole difference between our old composition
 *  and the reference's: fewer, bigger, fuller. */
function bed(b: Baker, r: Rect, h: number, M: Mats, fill = 0): void {
  const cx = r.x + r.w / 2, cz = r.z + r.d / 2;
  b.add(rbox(r.w, h, r.d, M.stone, cx, DECK_Y, cz, 1.2));
  b.add(rbox(r.w - 5, 1.4, r.d - 5, M.soil, cx, DECK_Y + h - 1.5, cz, 0.4));
  for (let i = 0; i < fill; i++) {
    const t = (i + 0.5) / fill;
    const along = r.w >= r.d;
    const px = r.x + (along ? 10 + t * (r.w - 20) : r.w * (i % 2 ? 0.36 : 0.64));
    const pz = r.z + (along ? r.d * (i % 2 ? 0.36 : 0.64) : 10 + t * (r.d - 20));
    shrub(b, px, DECK_Y + h - 1, pz, 5.5 + (i % 3) * 2.2, M);
  }
}

/** THE PLANTER, in whichever of the four forms this one is. Returns the height its planting starts at. */
function planter(b: Baker, p: Planter, M: Mats): number {
  const cx = p.x + p.w / 2, cz = p.z + p.d / 2, s = Math.min(p.w, p.d);
  switch (p.form) {
    case "bed":
      bed(b, p, 15, M, 3);
      return DECK_Y + 14;
    case "corner":
      bed(b, { x: p.x - 5, z: p.z - 5, w: p.w + 10, d: p.d + 10 }, 19, M, 4);
      b.add(rbox(p.w + 4, 1.6, p.d + 4, M.paving, cx, DECK_Y + 18, cz, 0.6)); // cream nosing
      return DECK_Y + 18;
    case "tech": {
      const g = ledgePlanter(cx, cz, s * 0.5, 17);
      for (const c of [...g.children]) if (c instanceof THREE.Mesh) { g.remove(c); b.add(c); }
      return DECK_Y + 16;
    }
    default: {
      const g = taperedPot(s * 0.5, 18, M.plaster, cx, DECK_Y, cz);
      for (const c of [...g.children]) if (c instanceof THREE.Mesh) { g.remove(c); b.add(c); }
      return DECK_Y + 17;
    }
  }
}

/** what stands in it. `medium` and `large` are the office's own tiered plants, so their blades join the
 *  instanced foliage batch; `shrub` and `grass` are cheap lumps for the small technical troughs. */
function planting(b: Baker, flora: THREE.Group, sway: SwayNode[], kind: PlantKind, cx: number, y: number, cz: number, s: number, M: Mats): void {
  if (kind === "large") flora.add(largePlant({ x: cx, z: cz, y, r: 7.4 * s, h: 44 * s, pot: false, lush: 1.2 }, sway));
  else if (kind === "medium") flora.add(mediumPlant({ x: cx, z: cz, y, r: 5.4 * s, h: 26 * s, lush: 1.5 }, sway, "potGray"));
  else if (kind === "shrub") shrub(b, cx, y, cz, 8 * s, M);
  else for (let i = 0; i < 4; i++) { // grass: a tuft of upright blades
    const a = (i / 4) * Math.PI * 2 + 0.7;
    b.add(cyl(2.2 * s, 15 * s, M.foliage, cx + Math.cos(a) * 3.4 * s, y, cz + Math.sin(a) * 3.4 * s, 0.6));
  }
}

/** LEVEL 1: the small things on a work surface — a keyboard, a device and, on some desks, a succulent. */
function deskDetail(b: Baker, r: Rect, yaw: number, withPlant: boolean, M: Mats): void {
  const cx = r.x + r.w / 2, cz = r.z + r.d / 2;
  const fx = Math.sin(yaw), fz = -Math.cos(yaw);
  const along = r.w >= r.d;
  const top = DECK_Y + DESK_TOP;
  const kx = cx - fx * 9, kz = cz - fz * 9;
  b.add(rbox(along ? 34 : 12, 1.1, along ? 12 : 34, M.carbon, kx, top, kz, 0.4)); // keyboard
  b.add(rbox(along ? 30 : 8.6, 0.3, along ? 8.6 : 30, M.screen, kx, top + 1.1, kz, 0.2)); // its lit face
  const dx = cx + (along ? 26 : 0), dz = cz + (along ? 0 : 26);
  b.add(rbox(7, 4, 7, M.deskBody, dx, top, dz, 0.8)); // a small device
  b.add(rbox(4.4, 0.5, 4.4, M.ledCore, dx, top + 4, dz, 0.3));
  if (withPlant) {
    const px = cx - (along ? r.w * 0.34 : 0), pz = cz - (along ? 0 : r.d * 0.34);
    b.add(cyl(4.2, 5, M.plaster, px, top, pz, 3.6));
    shrub(b, px, top + 5, pz, 4.2, M);
  }
}

/** THE CENTRAL HUB: segmented cream plinth, lit rim, ring bench, raised planter, a substantial tree. */
function hub(b: Baker, flora: THREE.Group, sway: SwayNode[], M: Mats): void {
  const { x, z, r } = HUB;
  b.add(cyl(r, 9, M.stone, x, DECK_Y, z, r));
  b.add(cyl(r - 5, 2, M.paving, x, DECK_Y + 9, z, r - 5));
  b.add(cyl(r + 1.4, 1.4, M.ledCore, x, DECK_Y + 7.2, z, r + 1.4));
  b.add(cyl(r + 3.4, 3, M.ledHalo, x, DECK_Y + 6.4, z, r + 3.4));
  // SEGMENTED ring bench — four arcs with gaps, which is what the reference draws and what stops the
  // island reading as a drum
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const br = r - 22;
    const seat = rbox(52, 13, 20, M.plaster, x + Math.cos(a) * br, DECK_Y + 9, z + Math.sin(a) * br, 1.4);
    seat.rotation.y = -a;
    b.add(seat);
  }
  // THE RAISED PLANTER, with its soil visible above the rim — the layer the old island was missing
  b.add(cyl(r - 42, 24, M.stone, x, DECK_Y + 9, z, r - 42));
  b.add(cyl(r - 40, 2.4, M.paving, x, DECK_Y + 31, z, r - 40)); // cream coping
  b.add(cyl(r - 46, 25, M.soil, x, DECK_Y + 9, z, r - 46));
  // A LAYERED GARDEN, and the PRIMARY CANOPY IS DELIBERATELY HIGH AND NARROW. At s1.5 the old tree put a
  // 45-unit canopy over an 88-unit island, which from any overhead angle was a green dome with the whole
  // garden hidden beneath it. This is the same amount of greenery redistributed: a tall slim trunk
  // carrying a 26-unit crown well clear of the ground, so soil, shrubs and the secondary tree all read.
  b.add(cyl(6, 64, M.reveal, x + 4, DECK_Y + 30, z - 6, 4.4));
  b.add(cyl(26, 30, M.foliage, x + 4, DECK_Y + 86, z - 6, 12));
  b.add(cyl(17, 18, M.foliageLight, x - 6, DECK_Y + 104, z + 2, 7));
  tree(b, x - 30, z + 20, 0.66, M);
  tree(b, x + 26, z + 26, 0.5, M);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.45;
    shrub(b, x + Math.cos(a) * (r - 58), DECK_Y + 33, z + Math.sin(a) * (r - 58), 7.5 + (i % 3) * 1.6, M);
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 1.9;
    shrub(b, x + Math.cos(a) * (r - 74), DECK_Y + 36, z + Math.sin(a) * (r - 74), 5.4, M);
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.2;
    flora.add(mediumPlant({ x: x + Math.cos(a) * (r - 64), z: z + Math.sin(a) * (r - 64), y: DECK_Y + 34, r: 5, h: 25, lush: 1.6, pot: false }, sway, "potDark"));
  }
}

/** THE ARRIVAL: a broad flight up the plinth's south face into the entrance, flanked by planting.
 *
 *  THE ONE COMPROMISE AGAINST THE REFERENCE, stated plainly. The player body is 2D (player/PlayerBody
 *  carries no y) so there is no elevation to climb: the walking surface through the entrance is FLAT and
 *  continuous, at the plinth datum, which is exactly why the route cannot break. The steps model the
 *  8.2-unit rise from lawn to plinth that genuinely exists — they read as the arrival from every camera
 *  and they are the plinth's own south face, not an obstacle laid across the path. */
function entranceStair(b: Baker, M: Mats): void {
  const z0 = PORCH.z + PORCH.d; // the porch's south lip
  const w = PORCH.w + 60;
  for (let i = 0; i < STEP_COUNT; i++) {
    const t = i / STEP_COUNT;
    const rise = DECK_T * (1 - t);
    b.add(rbox(w + i * 26, rise, 20, M.stone, PORCH.x + PORCH.w / 2, GRADE, z0 + 10 + i * 20, 0.8));
  }
  // the cheek walls either side of the flight, and the pots that frame it
  for (const o of [-1, 1]) {
    b.add(rbox(16, DECK_T + 12, PORCH.d + 46, M.plaster, PORCH.x + PORCH.w / 2 + o * (w / 2 + 4), GRADE, z0 - PORCH.d / 2 + 14, 1));
    pot(b, { x: PORCH.x + PORCH.w / 2 + o * (w / 2 + 4) - 19, z: z0 - 6, w: 38, d: 38 }, M, true);
  }
}

/** THE PLINTH, as a chamfered plan that follows the wall polygon, grown by the terrace margin.
 *
 *  NOTE THE AXIS. `slab()` rotates an XY shape by -90 degrees about X, which maps shape-y to MINUS world
 *  z (see its own comment: an asymmetric shape "compensates locally"). This plan is asymmetric in z, so
 *  every z is negated on the way in. Authored straight, the plinth lands mirrored across the office. */
function plinthShape(): THREE.Shape {
  const m = PLINTH_MARGIN;
  const O = LAB_OUTER;
  const x0 = O.x - m, x1 = O.x + O.w + m, z0 = O.z - m, z1 = O.z + O.d + m;
  const c = 150;
  const px0 = PORCH.x - 54, px1 = PORCH.x + PORCH.w + 54, pz = PORCH.z + PORCH.d + 54;
  const Y = (wz: number) => -wz;
  const sh = new THREE.Shape();
  sh.moveTo(x0 + c, Y(z0));
  sh.lineTo(x1 - c, Y(z0));
  sh.lineTo(x1, Y(z0 + c));
  sh.lineTo(x1, Y(z1 - c));
  sh.lineTo(x1 - c, Y(z1));
  sh.lineTo(px1 + 30, Y(z1));
  sh.lineTo(px1, Y(pz));
  sh.lineTo(px0, Y(pz));
  sh.lineTo(px0 - 30, Y(z1));
  sh.lineTo(x0 + c, Y(z1));
  sh.lineTo(x0, Y(z1 - c));
  sh.lineTo(x0, Y(z0 + c));
  sh.closePath();
  return sh;
}

/** a world-space CanvasTexture panel — used for the agent labels and the one branding plate */
function panel(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, cw = 512, ch = 192): THREE.Mesh {
  const c = document.createElement("canvas");
  c.width = cw; c.height = ch;
  const g = c.getContext("2d");
  if (g) draw(g);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.castShadow = m.receiveShadow = false;
  return m;
}

const label = (name: string, status: string, task: string, tint: number): THREE.Mesh =>
  panel(96, 36, (g) => {
    g.fillStyle = "rgba(10,21,38,0.88)";
    g.fillRect(0, 0, 512, 192);
    g.fillStyle = `#${tint.toString(16).padStart(6, "0")}`;
    g.fillRect(0, 0, 10, 192);
    g.font = "bold 58px system-ui, sans-serif";
    g.fillStyle = "#f4f5f5";
    g.fillText(name, 38, 70);
    g.font = "bold 34px system-ui, sans-serif";
    g.fillStyle = `#${tint.toString(16).padStart(6, "0")}`;
    g.fillText(status, 38, 116);
    g.font = "28px system-ui, sans-serif";
    g.fillStyle = "#aab4c4";
    g.fillText(task, 38, 160);
  });

/** the plaque on the wall: small, dark, restrained */
const brandPlate = (): THREE.Mesh =>
  panel(120, 30, (g) => {
    g.fillStyle = "rgba(10,21,38,0.9)";
    g.fillRect(0, 0, 1024, 256);
    g.fillStyle = "#2376e5";
    g.fillRect(0, 0, 1024, 8);
    g.font = "bold 74px system-ui, sans-serif";
    g.fillStyle = "#f4f5f5";
    g.fillText("offshorly", 60, 122);
    g.font = "bold 92px system-ui, sans-serif";
    g.fillStyle = "#4da3ff";
    g.fillText("AI LAB", 60, 214);
  }, 1024, 256);

/** THE PLAZA LOGO, painted onto the floor rather than standing on it. The old version was a filled navy
 *  panel laid flat, which from overhead was one of the strongest rectangles in the room — precisely the
 *  weight the architecture and the planting are supposed to carry. Transparent ground, mark only. */
const brandFloor = (): THREE.Mesh =>
  panel(190, 48, (g) => {
    g.clearRect(0, 0, 1024, 256);
    g.textAlign = "center";
    g.font = "bold 86px system-ui, sans-serif";
    g.fillStyle = "rgba(42,58,78,0.55)";
    g.fillText("offshorly", 512, 116);
    g.font = "bold 104px system-ui, sans-serif";
    g.fillStyle = "rgba(35,118,229,0.62)";
    g.fillText("AI LAB", 512, 224);
  }, 1024, 256);

export function buildAiLab(): AiLabBuild {
  const root = new THREE.Group();
  root.name = "ai-lab";
  const M = materials();
  const b = new Baker();
  // THE PLANT GROUP. Everything from the office's tiered plant family goes here so its blades can be
  // batched in one pass; `sway` is collected and deliberately never registered, so the Lab's planting
  // stands in its rest pose rather than joining the office's sway budget.
  const flora = new THREE.Group();
  flora.name = "ai-lab-flora";
  root.add(flora);
  const sway: SwayNode[] = [];

  // ---- 1. the approach. ONLY the rear lawn legs are drawn: the east flank of the journey is the
  //         office's OWN podium margin, already there and already paved, so the Lab gets no dedicated
  //         corridor pointing at it.
  for (const r of PAVED) {
    b.add(rbox(r.w, DECK_T, r.d, M.stone, r.x + r.w / 2, GRADE, r.z + r.d / 2, 1.2));
    b.add(rbox(r.w - 10, 0.5, r.d - 10, M.paving, r.x + r.w / 2, DECK_Y - 0.3, r.z + r.d / 2, 1));
  }

  // ---- 2. the plinth, the lakeside terrace, and the office's own floor inside the wall line --------
  b.add(slab(plinthShape(), DECK_T, M.stone, GRADE, 1.2));
  for (const r of [LAKE_SPUR, LAKE_TERRACE]) {
    b.add(rbox(r.w + 16, DECK_T, r.d + 16, M.stone, r.x + r.w / 2, GRADE, r.z + r.d / 2, 1.2));
    b.add(rbox(r.w, 0.5, r.d, M.paving, r.x + r.w / 2, DECK_Y - 0.3, r.z + r.d / 2, 1));
  }
  entranceStair(b, M);
  // tiledFloor builds with its top at y 0 (the office datum); the room's floor sits a hair above it
  for (const r of [HALL, SOUTH_BAY, PORCH]) {
    const f = tiledFloor(r, 1.2, "hubTerrazzo");
    f.position.y = DECK_Y - 0.05;
    root.add(f);
  }

  // ---- 3. THE PAVING PLAN. Bands of the campus's warm concrete laid into the tile to read the
  //         circulation the reference draws: the entrance spine, the ring round the hub, and a cross
  //         axis out to the two lower zones.
  b.add(rbox(150, 0.5, HALL.d + SOUTH_BAY.d, M.paving, HUB.x, DECK_Y + 0.06, HALL.z + (HALL.d + SOUTH_BAY.d) / 2 - 20, 1));
  b.add(rbox(HALL.w - 60, 0.5, 110, M.paving, HALL.x + HALL.w / 2, DECK_Y + 0.06, HUB.z, 1));
  b.add(cyl(HUB.r + 58, 0.6, M.paving, HUB.x, DECK_Y + 0.06, HUB.z, HUB.r + 58));

  // ---- 4. the open-top perimeter: ten runs with two openings, cut corners included ----------------
  for (const [a, c] of WALL_SEGS) wallSeg(b, a, c, WALL_H, WALL_T, M.plaster, M.ledCore);
  // lit jambs at both openings
  for (const [x, z] of [[ENTRY_X0, -440], [ENTRY_X1, -440], [LAKE_GAP_X0, -980], [LAKE_GAP_X1, -980]] as const) {
    b.add(rbox(5, WALL_H + 11, WALL_T + 3, M.carbon, x, DECK_Y, z, 1));
    b.add(rbox(2, WALL_H + 5, 2, M.ledCore, x, DECK_Y + 4, z + 8, 0.6));
    b.add(rbox(3.6, WALL_H + 7, 3.6, M.ledHalo, x, DECK_Y + 3, z + 8, 0.8));
  }

  // ---- 5. the four zones ---------------------------------------------------------------------------
  let agents = 0;
  const pulses: { core: THREE.MeshStandardMaterial; halo: THREE.MeshBasicMaterial; base: number; period: number; swing: number }[] = [];
  let robotDraws = 0;
  let aux = 0;
  for (const zone of ZONES) {
    for (let i = 0; i < zone.stations.length; i++) {
      const st = zone.stations[i];
      desk(b, st.rect, st.yaw, st.screens, M);
      deskDetail(b, st.rect, st.yaw, i !== 1, M); // LEVEL 1: kit on the surface, a succulent on most
    }
    for (const c of zone.consoles) console(b, c, M);
    for (const t of zone.tables) meetingTable(b, t, M);
    // only two zones carry a partition, and they run in different directions
    const p = zone.partition;
    if (p) {
      b.add(rbox(p.w, 19, p.d, M.plaster, p.x + p.w / 2, DECK_Y, p.z + p.d / 2, 1));
      b.add(rbox(p.w >= p.d ? p.w - 2 : 1.2, 1, p.w >= p.d ? 1.2 : p.d - 2, M.ledCore, p.x + p.w / 2, DECK_Y + 18.4, p.z + p.d / 2, 0.4));
    }
    // LEVEL 2 + 3: the zone's own planting, in whichever form this planter is
    for (const pl of zone.planters) planting(b, flora, sway, pl.plant, pl.x + pl.w / 2, planter(b, pl, M), pl.z + pl.d / 2, 1, M);

    // THE AGENTS. Each carries a UNIQUE status material so its colour and pulse are its own, which is
    // also why they cannot join the bake — one material per agent.
    for (const slot of zone.slots) {
      const named = slot.agent ? agentById(slot.agent) : null;
      const status = named ? named.status : AUX_STATUS[aux++ % AUX_STATUS.length];
      const tint = STATUS_TINT[status];
      const g = opsRobot(slot.x, slot.z, named ? 11 : 10, named ? 34 : 31);
      g.rotation.y = slot.yaw;
      const core = emissiveMatUnique("aiLed", 1.8, 0.3);
      core.color.setHex(tint);
      core.emissive.setHex(tint);
      const halo = glowMatUnique("aiLed", 0.3);
      halo.color.setHex(tint);
      const rb = new Baker();
      const loose: THREE.Object3D[] = [];
      for (const child of [...g.children]) {
        if (!(child instanceof THREE.Mesh)) { loose.push(child); continue; }
        const m = child.material as THREE.Material;
        if (m instanceof THREE.MeshBasicMaterial) child.material = halo;
        else if (m instanceof THREE.MeshStandardMaterial && m.emissive && m.emissive.getHex() !== 0) child.material = core;
        child.castShadow = child.receiveShadow = false;
        g.remove(child);
        rb.add(child);
      }
      robotDraws += rb.bakeInto(g, `ai-lab-agent-${slot.agent ?? "aux"}`) + loose.length;
      root.add(g);
      agents++;
      const sp = STATUS_PULSE[status];
      pulses.push({ core, halo, base: core.emissiveIntensity, period: sp.period, swing: sp.swing });

      // only the three PRINCIPALS are labelled. Labelling the workforce would bury the room in signage.
      if (named) {
        const l = label(named.name, STATUS_LABEL[named.status], named.task, tint);
        l.position.set(slot.x, DECK_Y + 60, slot.z + 34);
        root.add(l);
      }
    }
  }

  // ---- 6. the hub, the planting, and the benches --------------------------------------------------
  hub(b, flora, sway, M);
  for (const r of [...PERIMETER_POTS, ...INTERIOR_POTS])
    planting(b, flora, sway, r.plant, r.x + r.w / 2, planter(b, r, M), r.z + r.d / 2, 1, M);
  // LEVEL 3: the deep architectural beds in the band between the floor and the wall. Nothing walks
  // there, so these carry no collision at all — they are pure landscape.
  for (const wb of WALL_BEDS) {
    bed(b, wb, 17, M, wb.plants + 2);
    const along = wb.w >= wb.d;
    for (let i = 0; i < wb.plants; i++) {
      const t = wb.plants === 1 ? 0.5 : i / (wb.plants - 1);
      const px = wb.x + (along ? 16 + t * (wb.w - 32) : wb.w / 2);
      const pz = wb.z + (along ? wb.d / 2 : 16 + t * (wb.d - 32));
      if (i % 2 === 0) flora.add(mediumPlant({ x: px, z: pz, y: DECK_Y + 16, r: 5.6, h: 27, lush: 1.6, pot: false }, sway, "potDark"));
      else shrub(b, px, DECK_Y + 16, pz, 9, M);
    }
  }
  // wall piers, so the perimeter has depth from above rather than reading as one flat ribbon
  for (const r of PILASTERS) b.add(rbox(r.w, WALL_H - 3, r.d, M.plaster, r.x + r.w / 2, DECK_Y, r.z + r.d / 2, 1));
  // LEVEL 4: the cut corners. Each gets a bed, a feature plant and a tree at its own scale, and the
  // canopies are offset so no two corners read as the same object.
  // LEVEL 4: THE CUT CORNERS. These triangles are entirely outside the walkable floor, so they take the
  // Lab's biggest planted masses at zero circulation cost — a deep bed, two trees at different scales,
  // a feature plant and an understorey, composed as one garden rather than as a tree with a pot by it.
  for (let i = 0; i < CORNER_TREES.length; i++) {
    const t = CORNER_TREES[i];
    bed(b, { x: t.x - 34, z: t.z - 30, w: 68, d: 60 }, 16, M, 5);
    tree(b, t.x + (i % 2 ? 10 : -10), t.z + (i < 2 ? 6 : -6), t.s, M);
    tree(b, t.x + (i % 2 ? -18 : 18), t.z + (i < 2 ? -14 : 14), t.s * 0.54, M);
    flora.add(largePlant({ x: t.x + (i % 2 ? -22 : 22), z: t.z + (i < 2 ? 22 : -22), y: DECK_Y + 15, r: 7.4, h: 44, pot: false, lush: 1.2 }, sway));
  }
  // benches inside the wall, on the two long sides and either side of the entrance
  for (const [bx, bz, bw, byaw] of [[520, -952, 80, 0], [960, -952, 80, 0], [1146, -790, 80, Math.PI / 2],
    [352, -800, 80, Math.PI / 2], [560, -470, 76, 0], [930, -470, 76, 0]] as const)
    bench(b, bx, bz, bw, byaw, M);
  // the lakeside terrace's own seats, looking out over the water
  bench(b, 668, -1038, 76, 0, M);
  bench(b, 812, -1038, 76, 0, M);
  // planting that frames the arrival, out on the terrace where the steps land
  for (const [sx, sz, sr] of [[590, -404, 15], [900, -398, 13], [1010, -430, 11], [470, -424, 12],
    [318, -600, 14], [1160, -640, 13], [330, -1000, 15], [1150, -1004, 12]] as const)
    shrub(b, sx, DECK_Y, sz, sr, M);

  const baked = b.bakeInto(root, "ai-lab");

  // ---- 7. branding, worked into the architecture rather than hung off it --------------------------
  const brand = brandFloor();
  brand.position.set(HUB.x, DECK_Y + 0.4, HUB.z + HUB.r + 96);
  brand.rotation.x = -Math.PI / 2; // painted flat into the plaza, as the reference sets it
  root.add(brand);
  const wallBrand = brandPlate();
  wallBrand.position.set(HUB.x, DECK_Y + 40, LAB_OUTER.z + WALL_T + 3);
  root.add(wallBrand);

  // BATCH THE BLADES. Every leaf the plant family emitted is an anchor, not a mesh; render/Foliage turns
  // the lot into one InstancedMesh per material. Then FLATTEN what is left: bake() works on a mesh's
  // LOCAL matrix, so a plant's nested trunk/branch groups have to be re-parented (Object3D.attach keeps
  // the world transform) before they can be merged by material like everything else.
  const blades = new FoliageSystem(new SwaySystem()).collect("ai-lab", flora);
  const loose: THREE.Mesh[] = [];
  flora.traverse((o) => { if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh)) loose.push(o); });
  const fb = new Baker();
  for (const m of loose) { flora.attach(m); fb.add(m); }
  // bakeInto ADDS the merged meshes; it does not take the originals out of the graph. Detach them or
  // every plant is drawn twice — once as its parts and once as the bake.
  for (const m of loose) flora.remove(m);
  const floraDraws = fb.bakeInto(flora, "ai-lab-flora");

  // NOTHING IN THE LAB CASTS OR RECEIVES A SHADOW — see the cost rules at the top of this file.
  root.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });

  return {
    group: root,
    tick(t: number): void {
      for (const p of pulses) {
        const k = 1 + Math.sin((t / p.period) * Math.PI * 2) * p.swing;
        p.core.emissiveIntensity = p.base * k;
        p.halo.opacity = 0.3 * k;
      }
    },
    stats: { draws: baked + floraDraws + robotDraws + AGENTS.length + 2, agents, blades },
  };
}
