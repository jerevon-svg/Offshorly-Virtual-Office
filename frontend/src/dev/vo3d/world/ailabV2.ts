// vo3d world — AI LAB V2: THE TREEHOUSE LAB, as data. STRUCTURAL BLOCKOUT, behind `?ailab=v2` (world/labVariant).
//
//   TREEHOUSE = HOME · LAB FLOOR = WORK · PHYSICAL MOVEMENT = WORKFLOW
//
// ONE AUTHORITY. Everything the V2 Lab is — its wall, plinth, treehouse levels, branches, stations, props — is
// declared HERE, once. build/ailabV2 draws it, `aiLabV2StandTest` collides the player against it, and
// `buildLabV2Graph` derives the MonkeyAgent traversal graph (world/monkeyTraversal) from the very same numbers,
// so the architecture and the routes the agents take through it cannot drift apart.
//
// DESIGNED AROUND THE MONKEYAGENT BODY (Phase 1, avatar/monkeyMotion), not around people:
//   · ≥ 44 headroom under every deck (L1 top 48 → L2 underside 92)
//   · the trunk climb rises through a ~30-wide hatch beside the trunk and side-mantles onto the deck
//   · ladders lean 78°; the fire pole stands 1.5 off a deck edge, 9 to the side of its ledge spot
//   · hang bars ~17 above the surface the hanger stands on, running along its facing
//   · branches ≥ 4.5 radius; jumps ≤ 55 horizontal
//   · stations: stool 12 / footrest 7 / bench 18 (seated), bench 13 (standing), screens ≥ 14 in front of the spine
//   · handoffs side by side, 26 apart
//
// WHAT IS KEPT FROM V1 (world/ailab): the centre line x 740, the south entrance and porch, the lake gap, spur,
// terrace and steps, the approach legs, the deck datum. What changes: the wall widens to x 100–1380 and the
// plinth with it (plus two reserved pads on the lakeside corners for future Agents 5–6).
import type { Rect, Vec2 } from "../core/coords";
import {
  APRON, DECK_Y, ENTRY_X0, ENTRY_X1, LAKE_GAP_X0, LAKE_GAP_X1, LAKE_SPUR, LAKE_TERRACE, LEG_N, PATH_IN, PATH_LINK, PATH_W,
  PLINTH_MARGIN, PORCH, WALL_H, WALL_T,
} from "./ailab";
import { v3, type TLink, type TNode, type TraversalGraph, type V3 } from "./monkeyTraversal";
import { STATIONS, stationNodeId, stationSolids, stationTemplate, stationWork } from "./labStations";

export { DECK_Y, WALL_H, WALL_T };
/** THE FLOOR THE LAB STANDS ON, in world y: the exterior ground model's Lab-interior surface (world/exteriorGround
 *  LAB_FLOOR_Y, mirrored here to keep the import graph acyclic — a test pins them equal). The player stands on
 *  it, so the MonkeyAgents' graph and every Lab surface are measured from it: y 0 here IS the floor's top. */
export const LAB2_FLOOR_Y = 0.75;

// ============================== THE FOOTPRINT =================================================================
export const LAB2_OUTER: Rect = { x: 100, z: -980, w: 1280, d: 540 };
/** the perimeter: ten runs, chamfered corners, the two V1 openings (south entrance, north lake gap) kept */
export const WALL_SEGS_V2: readonly (readonly [Vec2, Vec2])[] = [
  [{ x: 180, z: -980 }, { x: LAKE_GAP_X0, z: -980 }],
  [{ x: LAKE_GAP_X1, z: -980 }, { x: 1300, z: -980 }],
  [{ x: 1300, z: -980 }, { x: 1380, z: -900 }],
  [{ x: 1380, z: -900 }, { x: 1380, z: -520 }],
  [{ x: 1380, z: -520 }, { x: 1320, z: -440 }],
  [{ x: 1320, z: -440 }, { x: ENTRY_X1, z: -440 }],
  [{ x: ENTRY_X0, z: -440 }, { x: 160, z: -440 }],
  [{ x: 160, z: -440 }, { x: 100, z: -520 }],
  [{ x: 100, z: -520 }, { x: 100, z: -900 }],
  [{ x: 100, z: -900 }, { x: 180, z: -980 }],
];
/** the plinth: the wall grown by the V1 terrace margin, corners cut, the V1 porch notch, and two lakeside
 *  "ears" carrying the reserved pads for future Agents 5–6 (each ≥ 30 clear of the lake's shore band) */
export const LAB2_PLINTH: readonly Vec2[] = (() => {
  const m = PLINTH_MARGIN, x0 = LAB2_OUTER.x - m, x1 = LAB2_OUTER.x + LAB2_OUTER.w + m, z0 = LAB2_OUTER.z - m, z1 = LAB2_OUTER.z + LAB2_OUTER.d + m;
  const c = 150;
  const px0 = PORCH.x - 54, px1 = PORCH.x + PORCH.w + 54, pz = PORCH.z + PORCH.d + 54;
  return [
    { x: x0, z: -900 }, { x: 110, z: -1090 }, { x: 300, z: -1090 }, { x: 330, z: z0 },
    { x: 1150, z: z0 }, { x: 1180, z: -1090 }, { x: 1370, z: -1090 }, { x: x1, z: -900 },
    { x: x1, z: z1 - c }, { x: x1 - c, z: z1 },
    { x: px1 + 30, z: z1 }, { x: px1, z: pz }, { x: px0, z: pz }, { x: px0 - 30, z: z1 },
    { x: x0 + c, z: z1 }, { x: x0, z: z1 - c },
  ];
})();
/** the finished lakeside PAVILIONS on the plinth's ears (outside the wall): the SPECIALIST bays' future home */
export const FUTURE_PODS: readonly Rect[] = [{ x: 122, z: -1076, w: 170, d: 84 }, { x: 1188, z: -1076, w: 170, d: 84 }];
/** V1's terrace shrubs that still stand outside the wider wall (the two flank ones are now inside it) */
export const LAB2_TERRACE_SHRUBS: readonly { x: number; z: number; r: number }[] = [
  { x: 590, z: -404, r: 15 }, { x: 900, z: -398, r: 13 }, { x: 1010, z: -430, r: 11 },
];

// ============================== THE TREEHOUSE =================================================================
export const TREE = { x: 740, z: -735 } as const;
/** polar offset from the tree: angle in DEGREES from +x toward +z (south), radius */
export const polar = (deg: number, r: number, y = 0): V3 => v3(TREE.x + r * Math.cos((deg * Math.PI) / 180), y, TREE.z + r * Math.sin((deg * Math.PI) / 180));
const pxz = (deg: number, r: number): Vec2 => { const p = polar(deg, r); return { x: p.x, z: p.z }; };

/** the trunk: a climbable column (r 27) to the climb top, then tapering into the crown */
export const TRUNK = { r: 27, climbTop: 72, rMid: 23, midY: 110, rTop: 15, topY: 178 } as const;
/** the root plaza: the mature root spread the trunk stands in */
export const PLAZA_R = 150;
/** ROOTS: [angle°, length beyond the trunk]. None across the climb slot (≈70°) or due south (the Toucan's view). */
export const ROOTS: readonly (readonly [number, number])[] = [[20, 64], [125, 76], [162, 82], [205, 96], [246, 90], [286, 100], [322, 86]];
export const ROOT_H = 14;

/** the TRUNK CLIMB: up the bark of the trunk's south-south-east face (70°), inside an open SLOT through L1 that
 *  faces the briefing ring — so the climb is seen from the entrance and the VO camera, not hidden under the deck */
export const CLIMB = { deg: 70, slotHalf: 17, slotOut: 78 } as const;
const CD = { x: Math.cos((CLIMB.deg * Math.PI) / 180), z: Math.sin((CLIMB.deg * Math.PI) / 180) };
const CN = { x: -CD.z, z: CD.x };
/** a point on the climb slot's frame: `s` out along the climb face's normal, `l` sideways (+ = toward CN) */
const slotPt = (s: number, l: number): Vec2 => ({ x: TREE.x + CD.x * s + CN.x * l, z: TREE.z + CD.z * s + CN.z * l });
export const CLIMB_OUT = v3(CD.x, 0, CD.z);

/** L1 — THE LIVING DECK: top 48 (44 headroom under it), an irregular ring round the trunk with a south prow */
export const L1 = {
  y: 48, t: 4,
  /** [angle°, radius] — every 30° */
  rim: [[0, 112], [30, 100], [60, 96], [90, 104], [120, 96], [150, 110], [180, 126], [210, 118], [240, 112], [270, 120], [300, 116], [330, 110]] as const,
};
/** the climb slot cut through L1: from the trunk out to a timber bridge strip at the rim */
export const l1Slot = (): Vec2[] => [slotPt(TRUNK.r, -CLIMB.slotHalf), slotPt(CLIMB.slotOut, -CLIMB.slotHalf), slotPt(CLIMB.slotOut, CLIMB.slotHalf), slotPt(TRUNK.r, CLIMB.slotHalf)];
/** L2 — HOME LEVEL: top 96 (44 over L1), offset north-east, with an east balcony past L1 for the pole and a deep
 *  north half carrying the RESIDENCE */
export const L2 = {
  y: 96, t: 4, cx: 765, cz: -755,
  rim: [[0, 110], [16, 88], [50, 70], [90, 60], [135, 70], [180, 74], [200, 77], [225, 118], [250, 118], [270, 112], [295, 114], [315, 118], [344, 98]] as const,
};
export const HEADROOM = 44;
export const l1Rim = (): Vec2[] => L1.rim.map(([a, r]) => pxz(a, r));
export const l2Rim = (): Vec2[] => L2.rim.map(([a, r]) => ({ x: L2.cx + r * Math.cos((a * Math.PI) / 180), z: L2.cz + r * Math.sin((a * Math.PI) / 180) }));
/** L1's rim radius at any angle (linear between the 30° stations) */
export function l1RimRadius(deg: number): number {
  const d = ((deg % 360) + 360) % 360, i = Math.floor(d / 30), k = (d - i * 30) / 30;
  return L1.rim[i % 12][1] * (1 - k) + L1.rim[(i + 1) % 12][1] * k;
}
/** posts carrying L1 down to the floor, 12 in from its rim (clear of the climb slot, the stair and the roots) */
export const L1_POSTS: readonly Vec2[] = [10, 110, 150, 195, 265, 300].map((a) => pxz(a, l1RimRadius(a) - 12));
export const L2_POSTS: readonly Vec2[] = [{ x: 822, z: -712 }, { x: 714, z: -706 }, { x: 700, z: -790 }, { x: 810, z: -836 }, { x: 732, z: -846 }];

// ---- THE RESIDENCE: the MonkeyAgents' home, built round the tree on L2 --------------------------------------
/** Three timber volumes wrapping the north of the trunk: a two-storey MAIN HALL behind the trunk, a sleeping
 *  WEST WING, and the ENTRY WING to the east whose door is the residence's way in and out. An upper BALCONY runs
 *  across the main hall's south face. The interior is not modelled: an agent that goes in is simply not drawn
 *  until it comes out again (the traversal graph's `interior` links) — the home of every agent not on show. */
export const RESIDENCE = {
  main: { x0: 726, x1: 810, z0: -855, z1: -813, eave: 160, ridge: 180, upper: 140 },
  west: { x0: 690, x1: 730, z0: -840, z1: -806, eave: 132, ridge: 150 },
  east: { x0: 806, x1: 848, z0: -836, z1: -800, eave: 132, ridge: 152 },
  /** the upper balcony: y, its depth out from the main hall's south face, and its span */
  balcony: { y: 140, x0: 732, x1: 806, z0: -813, z1: -799 },
  /** the doors: the ENTRY door (L2 deck level, east wing south face), the BALCONY door (main hall upper floor) */
  doors: { entry: v3(828, 96, -800), balcony: v3(770, 140, -813) },
  /** where an agent is when it is inside (never drawn) */
  inside: v3(770, 96, -836),
} as const;

// ---- routes on and off the tree (every one sized by the Phase 1 locomotion rules) ---------------------------
/** L0 → L1 RAMP: a planked gangway off L1's north-west edge — the PLAYER-SCALE way up (≤ 18°, 24 wide). It crosses
 *  the plaza walkway HIGH (41 up) and only then drops, landing beside the design studio's partition. */
export const RAMP = { path: [v3(668, 48, -810), v3(655, 48, -818), v3(598, 41, -842), v3(522, 14, -866), v3(490, 0, -874), v3(484, 0, -874)], w: 24 } as const;
/** L1 → L2 SHIP STAIR (60°): a steep timber stair with handrails off L2's west edge — a person can take it; a
 *  MonkeyAgent climbs it hand-over-hand like a ladder. `out` is the side it is climbed from. */
export const STAIR = (() => {
  const deg = 200, r = 77, angle = 60;
  const out = v3(Math.cos((deg * Math.PI) / 180), 0, Math.sin((deg * Math.PI) / 180));
  const top = v3(L2.cx + r * out.x, 96, L2.cz + r * out.z);
  const run = 48 / Math.tan((angle * Math.PI) / 180);
  const bottom = v3(top.x + run * out.x, 48, top.z + run * out.z);
  return { top, bottom, out, angle, width: 18, tread: 8 } as const;
})();
/** L2 → ground FIRE POLE: 1.5 off the east balcony's edge, 9 to the right of the ledge spot */
export const POLE = { x: 876.5, z: -746, r: 1.6, top: 116, ledge: v3(875, 96, -755) } as const;
/** the WEST LIMB: walked straight off L1's west edge, rising a little to PIP's perch at the tip */
export const WEST_LIMB = { r: 6, path: [v3(628, 48, -722), v3(614, 48, -720), v3(585, 54, -715), v3(560, 58, -712), v3(546, 60, -710)] } as const;
/** the HANG twig: a bar 17 above the limb, beside the head of a monkey standing there, the body hanging south */
export const HANG = { stand: v3(585, 54, -715), grip: v3(585, 71, -704), along: v3(-1, 0, 0), out: v3(0, 0, 1), bar: { x0: 568, x1: 604 } } as const;
/** the SOUTH-WEST BRANCH: an angled limb from L1's south-west edge down to the plaza floor — PIP's way down.
 *  (It lands INSIDE the plaza ring at ~41°, so the main walkway never passes under its low end.) */
export const SW_BRANCH = { r: 6, path: [v3(680, 48, -675), v3(668, 48, -664), v3(626, 6, -641), v3(619.5, 0, -637.5), v3(611, 0, -632)] } as const;
/** the JUMP PAD: a stump east of L1 — L1 edge → pad (52 across, 24 down) → floor (30 across) */
export const JUMP_PAD = { x: 880, z: -790, r: 12, y: 24, from: v3(838, 48, -780), land: v3(918, 0, -806) } as const;
/** the TOUCAN'S LANDING BRANCH: a low limb leaving the trunk south-west of the climb slot and curving to its
 *  perch over the briefing ring's north edge */
export const TOUCAN_LIMB = { from: polar(130, 24, 24), mid: v3(728, 30, -660), tip: v3(740, 34, -603), r: 4.5 } as const;

/** THE CROWN ENVELOPE: the volumes the canopy's leaf clusters live in (flattened ellipsoids; `ry` vertical). It
 *  WRAPS THE BACK of the tree like a hood and keeps its south face open, so the south faces of L1, L2 and the
 *  residence, every agent home and every route down stay visible from the VO camera (pitch 52 from the south).
 *  ~420 across, ~271 to its top. build/labTree fills these with clusters; the sightline tests read them. */
export const CANOPY: readonly { x: number; y: number; z: number; r: number; ry: number }[] = [
  { x: 740, y: 196, z: -935, r: 120, ry: 74 }, { x: 578, y: 182, z: -928, r: 72, ry: 44 }, { x: 900, y: 184, z: -850, r: 80, ry: 50 },
  { x: 742, y: 236, z: -860, r: 70, ry: 43 }, { x: 812, y: 160, z: -930, r: 56, ry: 35 }, { x: 650, y: 160, z: -925, r: 52, ry: 32 },
];

// ============================== THE WORK FLOOR =================================================================
/** the BAYS: each work zone's floor and identity (labels hidden, it still reads as its own place) */
export const ZONES2 = {
  design: { x: 150, z: -935, w: 320, d: 235 },
  flex: { x: 150, z: -660, w: 320, d: 190 },
  build: { x: 1010, z: -935, w: 330, d: 235 },
  review: { x: 1010, z: -660, w: 330, d: 190 },
} as const;
/** the briefing ring before the tree, the Toucan's perch on its north edge, the physical job board beside it */
export const BRIEFING = { x: 740, z: -545, r: 58 } as const;
export const TOUCAN_PERCH = TOUCAN_LIMB.tip;
export const JOB_BOARD = { x: 800, z: -612, w: 44, h: 26, y: 12 } as const;
/** THE RESULT GALLERY: a wall of artifact frames (2 rows × 3: the future delivery queue) over a delivery counter
 *  with three packet docks. ARTIFACT.dock is the middle one — the dock the Phase 2 proof uses. */
export const ARTIFACT = {
  x: 948, z: -643, w: 106, h: 46,
  counter: { x0: 905, x1: 991, z0: -625, z1: -605, h: 13 },
  docks: [v3(920, 13, -615), v3(948, 13, -615), v3(976, 13, -615)],
  dock: { x: 948, z: -615 },
  slots: 6,
} as const;
/** the MASTER / orchestration overlook: two raised wings framing the lake axis (future MASTER agents) */
export const OVERLOOK = { y: 16, wings: [{ x: 530, z: -972, w: 140, d: 66 }, { x: 810, z: -972, w: 140, d: 66 }] as Rect[] } as const;

/** monkey-proportioned station furniture (avatar/monkeyMotion): seated stool/bench, standing bench */
export const STATION = { seat: 12, foot: 7, bench: 18, stand: 13 } as const;
export type PropKind = "bench" | "riser" | "screen" | "screen-dim" | "rack" | "board" | "storage" | "stool" | "tablet" | "device" | "lamps" | "console" | "wall" | "dock" | "post";
/** a box prop: footprint, height, base, what it is, and whether a body at floor level collides with it */
export type Prop = { id: string; kind: PropKind; x: number; z: number; w: number; d: number; h: number; y?: number; yaw?: number; solid?: boolean };

/** THE BAY FURNISHINGS — what makes each zone its kind of place, around its station modules (world/labStations) */
export const BAY_PROPS: readonly Prop[] = [
  // ---- DESIGN studio ----
  { id: "design-pinboard", kind: "board", x: 180, z: -918, w: 284, d: 4, h: 30, y: 12, solid: true },
  { id: "design-flatfiles", kind: "storage", x: 158, z: -900, w: 28, d: 140, h: 16, solid: true },
  { id: "design-partition", kind: "wall", x: 466, z: -935, w: 6, d: 105, h: 24, solid: true },
  { id: "design-lighttable", kind: "bench", x: 300, z: -740, w: 54, d: 34, h: 16, solid: true },
  { id: "design-samples", kind: "bench", x: 200, z: -735, w: 44, d: 30, h: 16, solid: true },
  { id: "design-materials", kind: "storage", x: 396, z: -746, w: 68, d: 13, h: 34, solid: true },
  // ---- BUILD bay ----
  { id: "build-partition", kind: "wall", x: 1008, z: -935, w: 6, d: 105, h: 24, solid: true },
  { id: "build-rack-a", kind: "rack", x: 1266, z: -928, w: 20, d: 18, h: 40, solid: true },
  { id: "build-rack-b", kind: "rack", x: 1290, z: -928, w: 20, d: 18, h: 40, solid: true },
  { id: "build-rack-c", kind: "rack", x: 1314, z: -928, w: 20, d: 18, h: 40, solid: true },
  { id: "build-devices", kind: "bench", x: 1150, z: -780, w: 80, d: 22, h: STATION.bench, solid: true },
  { id: "build-assembly", kind: "bench", x: 1060, z: -728, w: 100, d: 24, h: STATION.bench, solid: true },
  { id: "build-toolwall", kind: "board", x: 1338, z: -790, w: 4, d: 80, h: 30, y: 6, solid: true },
  // ---- REVIEW lab ----
  { id: "review-partition", kind: "wall", x: 1008, z: -660, w: 6, d: 85, h: 22, solid: true },
  { id: "review-devicewall", kind: "wall", x: 1238, z: -658, w: 94, d: 6, h: 44, solid: true },
  { id: "review-checklist", kind: "board", x: 1030, z: -656, w: 44, d: 4, h: 32, y: 6, solid: true },
  { id: "review-compare", kind: "bench", x: 1030, z: -520, w: 70, d: 20, h: STATION.stand, solid: true },
  { id: "review-cabinet", kind: "storage", x: 1300, z: -500, w: 36, d: 22, h: 30, solid: true },
  { id: "review-signoff", kind: "dock", x: 1040, z: -640, w: 14, d: 14, h: 14, solid: true },
  // ---- FLEX bay ----
  { id: "flex-sofa", kind: "storage", x: 300, z: -486, w: 60, d: 18, h: 9, solid: true },
  { id: "flex-whiteboard", kind: "board", x: 156, z: -640, w: 4, d: 90, h: 34, y: 6, solid: true },
  // ---- BRIEFING: the physical job board beside the Toucan's perch ----
  { id: "job-board-post", kind: "post", x: JOB_BOARD.x - 2, z: JOB_BOARD.z - 2, w: 4, d: 4, h: JOB_BOARD.y, solid: true },
  // ---- RESULT gallery ----
  { id: "artifact-wall", kind: "wall", x: ARTIFACT.x - ARTIFACT.w / 2, z: ARTIFACT.z - 4, w: ARTIFACT.w, d: 8, h: ARTIFACT.h, solid: true },
  { id: "artifact-counter", kind: "bench", x: ARTIFACT.counter.x0, z: ARTIFACT.counter.z0, w: ARTIFACT.counter.x1 - ARTIFACT.counter.x0, d: ARTIFACT.counter.z1 - ARTIFACT.counter.z0, h: ARTIFACT.counter.h, solid: true },
];

/** handoff pairs: side by side, 26 apart, facing the camera (south) turned in toward each other */
export const HANDOFFS = {
  novaMilo: { give: v3(600, 0, -530), take: v3(626, 0, -530) },
  miloPip: { give: v3(854, 0, -530), take: v3(880, 0, -530) },
} as const;
/** the three gather spots on the briefing ring, facing the perch */
export const BRIEF_SPOTS = { nova: v3(700, 0, -550), pip: v3(740, 0, -535), milo: v3(780, 0, -550) } as const;
export const ROOT_SEATS = { w: v3(620, 0, -700), e: v3(832, 0, -648) } as const;

// ============================== THE PLAYER'S COLLISION =========================================================
/** the walkable union (V1's rule: a body's centre and rim must land in it; adjoining rects overlap > 2·radius) */
export const CORE2: Rect = { x: 175, z: -962, w: 1130, d: 510 };
export const WEST2: Rect = { x: 108, z: -892, w: 90, d: 364 };
export const EAST2: Rect = { x: 1282, z: -892, w: 90, d: 364 };
export const WALK2: readonly Rect[] = [CORE2, WEST2, EAST2, PORCH, LAKE_SPUR, LAKE_TERRACE, APRON, LEG_N, PATH_LINK, PATH_W, PATH_IN];

/** EVERYTHING ON THE FLOOR THAT STOPS A BODY: trunk and roots, deck posts, the low ends of the ramp and the SW
 *  branch, the Toucan's limb, the pole, the jump pad, every station module, every bay furnishing, the wings */
export function labV2Solids(): { rects: Rect[]; circles: { x: number; z: number; r: number }[] } {
  const circles: { x: number; z: number; r: number }[] = [{ x: TREE.x, z: TREE.z, r: TRUNK.r + 4 }];
  for (const [a, L] of ROOTS) for (const [k, rr] of [[0.25, 9], [0.55, 7], [0.85, 5]] as const) { const p = polar(a, TRUNK.r + L * k); circles.push({ x: p.x, z: p.z, r: rr }); }
  for (const p of L1_POSTS) circles.push({ x: p.x, z: p.z, r: 4 });
  circles.push({ x: POLE.x, z: POLE.z, r: POLE.r + 1 }, { x: JUMP_PAD.x, z: JUMP_PAD.z, r: JUMP_PAD.r });
  // the low ends of the ramp and the SW branch (below head height: nobody walks under them)
  const lowEnd = (path: readonly V3[], halfW: number) => { for (let i = 1; i < path.length; i++) { const a = path[i - 1], b = path[i]; for (let k = 0; k <= 4; k++) { const t = k / 4, y = a.y + (b.y - a.y) * t; if (y < 38 && y > 6) circles.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, r: halfW }); } } };
  lowEnd(RAMP.path.slice(1, 5), RAMP.w / 2 + 2);
  lowEnd(SW_BRANCH.path.slice(1, 4), SW_BRANCH.r + 3);
  // the Toucan's limb runs at ~24–34 high from the trunk to the perch
  for (const p of [TOUCAN_LIMB.from, TOUCAN_LIMB.mid, TOUCAN_LIMB.tip]) circles.push({ x: p.x, z: p.z, r: 6 });
  const rects: Rect[] = [
    ...BAY_PROPS.filter((p) => p.solid).map((p) => ({ x: p.x, z: p.z, w: p.w, d: p.d })),
    ...stationSolids(),
    ...OVERLOOK.wings,
  ];
  return { rects, circles };
}
const SOLIDS2 = labV2Solids();

const inRect = (p: Vec2, r: Rect, grow = 0): boolean => p.x >= r.x - grow && p.x <= r.x + r.w + grow && p.z >= r.z - grow && p.z <= r.z + r.d + grow;
const inWalk = (p: Vec2): boolean => WALK2.some((r) => inRect(p, r));
const RIM: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** May a body of `radius` stand at `p`? The V2 Lab's whole player collision model (same rule as V1's). */
export function aiLabV2StandTest(p: Vec2, radius: number): boolean {
  if (!inWalk(p)) return false;
  for (const [ox, oz] of RIM) if (!inWalk({ x: p.x + ox * radius, z: p.z + oz * radius })) return false;
  for (const s of SOLIDS2.rects) if (inRect(p, s, radius)) return false;
  for (const c of SOLIDS2.circles) if (Math.hypot(p.x - c.x, p.z - c.z) <= c.r + radius) return false;
  return true;
}
export function inAiLabV2Zone(p: Vec2, radius: number): boolean {
  return WALK2.some((r) => r.w > 2 * radius && r.d > 2 * radius && inRect(p, r, -radius));
}

// ============================== THE RESIDENCE'S VISIBLE LIFE ===================================================
/** EXTERIOR REST SPOTS — where idle agents are SHOWN (world/labPopulation's idle budget fills these), beyond the
 *  founders' own homes. Leaning on rails, sitting on the decks and the balcony, the root seats, the perches. */
export const IDLE_SPOTS = [
  { id: "idle-l2-rail-s", at: v3(766, 96, -704), yaw: 0, action: "lean" },
  { id: "idle-l2-rail-se", at: v3(806, 96, -713), yaw: 0.65, action: "lean" },
  { id: "idle-l2-deck", at: v3(790, 96, -782), yaw: 0.3, action: "sit" },
  { id: "idle-bal-w", at: v3(748, 140, -806), yaw: 0, action: "lean" },
  { id: "idle-bal-e", at: v3(792, 140, -806), yaw: 0.1, action: "lean" },
  { id: "idle-l1-se", at: v3(806, 48, -697), yaw: 0.9, action: "sit" },
  { id: "idle-l1-n", at: v3(735, 48, -842), yaw: Math.PI + 0.4, action: "sit" },
] as const;

// ============================== THE MONKEYAGENT TRAVERSAL GRAPH ================================================
const N = (id: string, at: V3, extra: Partial<TNode> = {}): TNode => ({ id, at, ...extra });
const floor = (id: string, a: string, b: string, path: V3[]): TLink => ({ id, from: a, to: b, geom: { kind: "ground", path, surface: "floor" } });
const deck = floor;
/** yaw facing a direction (x, z) */
const yawTo = (dx: number, dz: number) => Math.atan2(dx, dz);
const NORTH = Math.PI;

/** how each floor station is reached from the plaza ring: [ring°, waypoints before its approach spot] */
const STATION_ROUTES: Readonly<Record<string, { ring: number; via: V3[] }>> = {
  DESIGN_01: { ring: 180, via: [v3(470, 0, -770)] }, DESIGN_02: { ring: 180, via: [v3(470, 0, -770)] },
  BUILD_01: { ring: 0, via: [v3(1000, 0, -770)] }, BUILD_02: { ring: 0, via: [v3(1000, 0, -770), v3(1120, 0, -792)] },
  QA_01: { ring: 30, via: [v3(880, 0, -590), v3(1000, 0, -560)] }, QA_02: { ring: 30, via: [v3(880, 0, -590), v3(1000, 0, -560), v3(1180, 0, -520)] },
  FLEX_01: { ring: 150, via: [v3(470, 0, -545)] }, FLEX_02: { ring: 150, via: [v3(470, 0, -545)] },
};

/** THE GRAPH, from the same constants the geometry is built from: the ground ring round the plaza, spokes to every
 *  station / handoff / briefing / dock spot, the L1 ring, L2 and the residence, and the structured links. */
export function buildLabV2Graph(): TraversalGraph {
  const ringR = 168;
  const ring = Array.from({ length: 12 }, (_, i) => polar(i * 30, ringR));
  const nodes: TNode[] = ring.map((p, i) => N(`g-ring-${i * 30}`, p));
  const links: TLink[] = ring.map((p, i) => floor(`g:ring-${i * 30}`, `g-ring-${i * 30}`, `g-ring-${((i + 1) % 12) * 30}`, [p, polar(i * 30 + 15, ringR + 4), ring[(i + 1) % 12]]));
  const add = (n: TNode) => { nodes.push(n); return n.id; };
  const spoke = (id: string, from: string, path: V3[], node: TNode) => { add(node); links.push(floor(id, from, node.id, path)); };
  const R = (deg: number) => `g-ring-${deg}`;

  // ---- the floor: briefing, handoffs, root seats, the docks, the overlook foot ----
  spoke("g:brief-pip", R(90), [polar(90, ringR), BRIEF_SPOTS.pip], N("g-brief-pip", BRIEF_SPOTS.pip, { yaw: NORTH }));
  spoke("g:brief-nova", R(120), [polar(120, ringR), v3(690, 0, -578), BRIEF_SPOTS.nova], N("g-brief-nova", BRIEF_SPOTS.nova, { yaw: NORTH + 0.25 }));
  spoke("g:brief-milo", R(60), [polar(60, ringR), v3(790, 0, -578), BRIEF_SPOTS.milo], N("g-brief-milo", BRIEF_SPOTS.milo, { yaw: NORTH - 0.25 }));
  const H = HANDOFFS;
  spoke("g:nm-give", R(150), [polar(150, ringR), v3(615, 0, -560), H.novaMilo.give], N("g-nm-give", H.novaMilo.give, { yaw: 0.42, action: "handoff" }));
  spoke("g:nm-take", R(120), [polar(120, ringR), v3(640, 0, -556), H.novaMilo.take], N("g-nm-take", H.novaMilo.take, { yaw: -0.42, action: "handoff" }));
  spoke("g:mp-give", R(60), [polar(60, ringR), v3(840, 0, -556), H.miloPip.give], N("g-mp-give", H.miloPip.give, { yaw: 0.42, action: "handoff" }));
  spoke("g:mp-take", R(30), [polar(30, ringR), v3(880, 0, -560), H.miloPip.take], N("g-mp-take", H.miloPip.take, { yaw: -0.42, action: "handoff" }));
  ARTIFACT.docks.forEach((d, i) => spoke(`g:dock-${i + 1}`, R(30), [polar(30, ringR), v3(880, 0, -590), v3(d.x, 0, -592), v3(d.x, 0, d.z + 17)], N(`g-dock-${i + 1}`, v3(d.x, 0, d.z + 17), { yaw: NORTH, action: "stand" })));
  spoke("g:seat-w", R(150), [polar(150, ringR), v3(600, 0, -690), ROOT_SEATS.w], N("g-seat-w", ROOT_SEATS.w, { yaw: yawTo(-1, 0.6), action: "sit" }));
  spoke("g:seat-e", R(60), [polar(60, ringR), ROOT_SEATS.e], N("g-seat-e", ROOT_SEATS.e, { yaw: yawTo(1, 1), action: "sit" }));
  spoke("g:master-foot", R(270), [polar(270, ringR), v3(740, 0, -935)], N("g-master-foot", v3(740, 0, -935), { yaw: NORTH }));

  // ---- the WORKSTATIONS, from the station registry ----
  for (const st of STATIONS) {
    if (!st.approach) continue;
    const route = STATION_ROUTES[st.id];
    if (!route) continue;
    const app = `${stationNodeId(st)}-app`;
    spoke(`g:${st.id}-app`, R(route.ring), [polar(route.ring, ringR), ...route.via, st.approach], N(app, st.approach));
    const t = stationTemplate(st);
    spoke(`g:${st.id}`, app, [st.approach, st.at], N(stationNodeId(st), st.at, { yaw: st.yaw, action: t.posture === "seated" ? "work-seated" : "work-standing", work: stationWork(st) }));
  }
  // the MASTER consoles, up the overlook wings' stairs
  for (const st of STATIONS.filter((s) => s.type === "master")) {
    const west = st.at.x < TREE.x, edge = west ? 670 : 810, step = west ? 1 : -1;
    const foot = v3(edge + step * 26, 0, -940), top = v3(edge - step * 2, OVERLOOK.y, -940);
    spoke(`g:${st.id}`, "g-master-foot", [v3(740, 0, -935), foot, top, v3(st.at.x, OVERLOOK.y, -940), st.at], N(stationNodeId(st), st.at, { yaw: st.yaw, action: "work-standing", work: stationWork(st) }));
  }

  // the trunk climb's foot, the pole's landing, the jump landing, the ramp foot, the SW branch foot, the drop
  const climbFoot = v3(TREE.x + CD.x * (TRUNK.r + 11), 0, TREE.z + CD.z * (TRUNK.r + 11));
  spoke("g:climb-foot", R(90), [polar(90, ringR), polar(78, 120), climbFoot], N("g-climb-foot", climbFoot, { yaw: yawTo(-CD.x, -CD.z) }));
  const poleLand = v3(POLE.x + POLE.r + 6.2, 0, POLE.z);
  spoke("g:pole-land", R(0), [polar(0, ringR), poleLand], N("g-pole-land", poleLand));
  spoke("g:jump-land", R(330), [polar(330, ringR), JUMP_PAD.land], N("g-jump-land", JUMP_PAD.land));
  spoke("g:ramp-foot", R(210), [polar(210, ringR), v3(520, 0, -805), v3(486, 0, -828), RAMP.path[5]], N("g-ramp-foot", RAMP.path[5]));
  const d1 = STATIONS.find((s) => s.id === "DESIGN_01")!;
  links.push(floor("g:ramp-design", "g-ramp-foot", `${stationNodeId(d1)}-app`, [RAMP.path[5], v3(484, 0, -820), v3(440, 0, -806), d1.approach!]));
  spoke("g:swb-foot", R(150), [polar(150, ringR), SW_BRANCH.path[4]], N("g-swb-foot", SW_BRANCH.path[4]));
  spoke("g:drop", R(180), [polar(180, ringR), v3(585, 0, -690)], N("g-drop", v3(585, 0, -690)));

  // ---- L1: a ring of deck spots round the trunk; it crosses the climb slot over its bridge strip ----
  const l1 = [[0, 95], [45, 87], [70, 91], [90, 80], [135, 85], [180, 100], [226, 104], [270, 105], [317, 103]] as const;
  for (const [a, r] of l1) add(N(`u1-${a}`, polar(a, r, L1.y)));
  for (let i = 0; i < l1.length; i++) { const [a, r] = l1[i], [b, s] = l1[(i + 1) % l1.length]; links.push(deck(`u1:${a}-${b}`, `u1-${a}`, `u1-${b}`, [polar(a, r, L1.y), polar(b, s, L1.y)])); }
  add(N("u1-nova-home", v3(650, L1.y, -762), { yaw: -Math.PI / 2 - 0.3, action: "sit" }));
  links.push(deck("u1:nova-home", "u1-180", "u1-nova-home", [polar(180, 100, L1.y), v3(650, L1.y, -762)]));
  // the climb's top: the side mantle onto the slot's south-west lip
  const lip = slotPt(TRUNK.r + 5, CLIMB.slotHalf), top = { x: lip.x + CN.x * 9, z: lip.z + CN.z * 9 };
  add(N("u1-climb-top", v3(top.x, L1.y, top.z)));
  links.push(deck("u1:climb-s", "u1-climb-top", "u1-90", [v3(top.x, L1.y, top.z), polar(90, 80, L1.y)]));
  const stairFoot = v3(STAIR.bottom.x + STAIR.out.x * 9, L1.y, STAIR.bottom.z + STAIR.out.z * 9);
  add(N("u1-stair-foot", stairFoot));
  links.push(deck("u1:stair", "u1-180", "u1-stair-foot", [polar(180, 100, L1.y), v3(640, L1.y, -778), stairFoot]));
  add(N("u1-limb", WEST_LIMB.path[0]));
  links.push(deck("u1:limb", "u1-180", "u1-limb", [polar(180, 100, L1.y), WEST_LIMB.path[0]]));
  add(N("u1-ramp-top", RAMP.path[0]));
  links.push(deck("u1:ramp-top", "u1-226", "u1-ramp-top", [polar(226, 104, L1.y), RAMP.path[0]]));
  add(N("u1-swb", SW_BRANCH.path[0]));
  links.push(deck("u1:swb", "u1-135", "u1-swb", [polar(135, 85, L1.y), SW_BRANCH.path[0]]));
  add(N("u1-jump", JUMP_PAD.from));
  links.push(deck("u1:jump", "u1-317", "u1-jump", [polar(317, 103, L1.y), JUMP_PAD.from]));

  // ---- L2: the stair top, the hub, Milo's sleeping porch, the balcony, the lookout, the residence door ----
  const u2 = (id: string, at: V3, extra: Partial<TNode> = {}) => add(N(id, at, extra));
  const stairTop = v3(STAIR.top.x - STAIR.out.x * 9, L2.y, STAIR.top.z - STAIR.out.z * 9);
  u2("u2-stair-top", stairTop);
  u2("u2-hub", v3(792, L2.y, -760));
  u2("u2-milo-home", v3(712, L2.y, -792), { yaw: yawTo(0.35, 1), action: "sleep" });
  const balcony = v3(POLE.ledge.x - 6, L2.y, POLE.ledge.z);
  u2("u2-balcony", balcony, { yaw: Math.PI / 2 });
  u2("u2-lookout", v3(700, L2.y, -760), { yaw: -Math.PI / 2, action: "perch" });
  const door = RESIDENCE.doors.entry;
  u2("u2-res-door", v3(door.x, L2.y, door.z + 10), { yaw: NORTH });
  links.push(
    deck("u2:stair-hub", "u2-stair-top", "u2-hub", [stairTop, v3(722, L2.y, -752), v3(760, L2.y, -712), v3(792, L2.y, -760)]),
    deck("u2:stair-milo", "u2-stair-top", "u2-milo-home", [stairTop, v3(712, L2.y, -792)]),
    deck("u2:hub-balcony", "u2-hub", "u2-balcony", [v3(792, L2.y, -760), balcony]),
    deck("u2:hub-door", "u2-hub", "u2-res-door", [v3(792, L2.y, -760), v3(door.x, L2.y, door.z + 10)]),
    deck("u2:stair-lookout", "u2-stair-top", "u2-lookout", [stairTop, v3(700, L2.y, -760)]),
  );
  // ---- the residence: in through the entry door, out onto the upper balcony (the interior is never drawn) ----
  add(N("res-inside", RESIDENCE.inside, { action: "inside", yaw: NORTH }));
  links.push({ id: "i:entry", from: "u2-res-door", to: "res-inside", geom: { kind: "interior", dur: 1.6 } });
  const bd = RESIDENCE.doors.balcony;
  add(N("bal-door", v3(bd.x, RESIDENCE.balcony.y, bd.z + 8), { yaw: 0 }));
  links.push({ id: "i:balcony", from: "res-inside", to: "bal-door", geom: { kind: "interior", dur: 2.4 } });
  // ---- the exterior rest spots (idle population), each a short walk from its deck's network ----
  const hubOf: Record<number, string> = { 96: "u2-hub", 140: "bal-door", 48: "u1-0" };
  for (const s of IDLE_SPOTS) {
    add(N(s.id, s.at, { yaw: s.yaw, action: s.action }));
    const from = s.id === "idle-l1-n" ? "u1-270" : s.id === "idle-l1-se" ? "u1-45" : hubOf[s.at.y];
    const fromAt = nodes.find((n) => n.id === from)!.at;
    links.push(deck(`idle:${s.id}`, from, s.id, [fromAt, s.at]));
  }

  // ---- the west limb, Pip's perch at its tip, the hang twig ----
  add(N("b-hang-ledge", HANG.stand));
  add(N("b-tip", WEST_LIMB.path[4], { yaw: -Math.PI / 2 - 0.2, action: "perch", branch: { r: WEST_LIMB.r, rise: 0.14 } }));
  links.push({ id: "b:limb-in", from: "u1-limb", to: "b-hang-ledge", geom: { kind: "ground", surface: "branch", radius: WEST_LIMB.r, path: WEST_LIMB.path.slice(0, 3) as V3[] } });
  links.push({ id: "b:limb-tip", from: "b-hang-ledge", to: "b-tip", geom: { kind: "ground", surface: "branch", radius: WEST_LIMB.r, path: WEST_LIMB.path.slice(2) as V3[] } });
  add(N("b-hang", HANG.grip, { yaw: -Math.PI / 2, action: "hang", out: HANG.out }));
  links.push({ id: "h:twig", from: "b-hang-ledge", to: "b-hang", geom: { kind: "hang", grip: HANG.grip, along: HANG.along, out: HANG.out } });
  links.push({ id: "h:drop", from: "b-hang", to: "g-drop", geom: { kind: "drop" } });

  // ---- structured links ----
  links.push({ id: "c:trunk", from: "g-climb-foot", to: "u1-climb-top", geom: {
    kind: "climb", bottom: v3(TREE.x, 0, TREE.z), top: v3(TREE.x, TRUNK.climbTop, TREE.z), radius: TRUNK.r, out: CLIMB_OUT,
    topLedge: { edge: v3(lip.x, L1.y, lip.z), inward: v3(CN.x, 0, CN.z) },
  } });
  links.push({ id: "c:stair", from: "u1-stair-foot", to: "u2-stair-top", geom: {
    kind: "ladder", bottom: STAIR.bottom, top: STAIR.top, out: STAIR.out, rung: STAIR.tread, width: STAIR.width,
    topLedge: { edge: STAIR.top, inward: v3(-STAIR.out.x, 0, -STAIR.out.z) },
  } });
  links.push({ id: "c:pole", from: "u2-balcony", to: "g-pole-land", geom: { kind: "pole", top: v3(POLE.x, POLE.top, POLE.z), bottom: v3(POLE.x, 0, POLE.z), radius: POLE.r, ledge: { edge: POLE.ledge, inward: v3(-1, 0, 0) } } });
  links.push({ id: "r:ramp", from: "u1-ramp-top", to: "g-ramp-foot", geom: { kind: "ground", surface: "floor", path: RAMP.path.slice() as V3[] } });
  links.push({ id: "b:sw", from: "u1-swb", to: "g-swb-foot", geom: { kind: "ground", surface: "branch", radius: SW_BRANCH.r, path: SW_BRANCH.path.slice() as V3[] } });
  add(N("j-pad", v3(JUMP_PAD.x, JUMP_PAD.y, JUMP_PAD.z), { yaw: Math.PI / 2, action: "perch" }));
  links.push({ id: "j:l1-pad", from: "u1-jump", to: "j-pad", geom: { kind: "jump", apex: 8 } });
  links.push({ id: "j:pad-floor", from: "j-pad", to: "g-jump-land", oneWay: true, geom: { kind: "jump", apex: 4 } });

  const st = (id: string) => stationNodeId(STATIONS.find((s) => s.id === id)!);
  const destinations: Record<string, string> = {
    NOVA_HOME: "u1-nova-home", MILO_HOME: "u2-milo-home", PIP_HOME: "b-tip", PIP_HANG: "b-hang", L2_LOOKOUT: "u2-lookout",
    RESIDENCE_DOOR: "u2-res-door", RESIDENCE_INSIDE: "res-inside", RESIDENCE_BALCONY: "bal-door",
    BRIEFING_RING: "g-brief-pip", BRIEFING_NOVA: "g-brief-nova", BRIEFING_MILO: "g-brief-milo", BRIEFING_PIP: "g-brief-pip",
    ARTIFACT_DOCK: "g-dock-2", ARTIFACT_DOCK_1: "g-dock-1", ARTIFACT_DOCK_2: "g-dock-2", ARTIFACT_DOCK_3: "g-dock-3",
    HANDOFF_NOVA_MILO: "g-nm-give", HANDOFF_NOVA_MILO_RECV: "g-nm-take", HANDOFF_MILO_PIP: "g-mp-give", HANDOFF_MILO_PIP_RECV: "g-mp-take",
    ROOT_SEAT_W: "g-seat-w", ROOT_SEAT_E: "g-seat-e", MASTER_OVERLOOK_FOOT: "g-master-foot",
    TRUNK_FOOT: "g-climb-foot", CLIMB_TOP: "u1-climb-top", STAIR_FOOT: "u1-stair-foot", STAIR_TOP: "u2-stair-top", POLE_TOP: "u2-balcony", POLE_FOOT: "g-pole-land",
    JUMP_EDGE: "u1-jump", JUMP_PAD: "j-pad", JUMP_LAND: "g-jump-land", RAMP_TOP: "u1-ramp-top", RAMP_FOOT: "g-ramp-foot", SW_BRANCH_TOP: "u1-swb", SW_BRANCH_FOOT: "g-swb-foot",
    LIMB_START: "u1-limb", HANG_LEDGE: "b-hang-ledge", DROP_LAND: "g-drop",
    // the founders' stations by their role names (aliases of the registry ids)
    NOVA_DESIGN_STATION: st("DESIGN_01"), MILO_BUILD_STATION: st("BUILD_01"), PIP_QA_STATION: st("QA_01"),
    ...Object.fromEntries(STATIONS.filter((s) => s.state !== "future").map((s) => [s.id, stationNodeId(s)])),
    ...Object.fromEntries(IDLE_SPOTS.map((s) => [s.id.toUpperCase().replace(/-/g, "_"), s.id])),
  };
  return { nodes, links, destinations };
}

/** non-monkey anchors the orchestration layer will use (the Toucan lands; it does not walk the graph) */
export const LAB2_ANCHORS = { TOUCAN_PERCH, JOB_BOARD: v3(JOB_BOARD.x, JOB_BOARD.y, JOB_BOARD.z), ARTIFACT_WALL: v3(ARTIFACT.x, 8, ARTIFACT.z), BRIEFING_CENTRE: v3(BRIEFING.x, 0, BRIEFING.z) } as const;
export const LAB2_CENTRE: Vec2 = { x: LAB2_OUTER.x + LAB2_OUTER.w / 2, z: LAB2_OUTER.z + LAB2_OUTER.d / 2 };
