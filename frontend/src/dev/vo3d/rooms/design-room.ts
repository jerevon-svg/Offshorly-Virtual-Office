// vo3d rooms — DESIGN ROOM definition (data only). World rect comes from the READ-ONLY V1 manifest;
// shell/baked measurements are room-local (they position a static group at the room origin);
// every ENTITY below is in WORLD coordinates.
import { FACING_YAW, headingFor, type Facing, type Rect, type Vec2 } from "../core/coords";
import type { DoorCapability, Entity, LoungeSeatCapability, RoomDef, SeatCapability, ShellSpec } from "../world/WorldState";
import { SOFA_CUSHION_GAP, SOFA_CUSHION_LOCAL_X, SOFA_CUSHION_MARGIN } from "../build/furniture";
import { v1FurnitureEntities, v1RoomRect } from "../adapters/v1Manifest";
import { CELL } from "../adapters/v1Grid";
import { BODY_RADIUS } from "../nav/clearance";
import type { DesignBaked } from "../build/baked";
import type { BoxSpec } from "../build/helpers";
import type { PlantSpec } from "../build/plants";

export const DESIGN_ROOM_ID = "design-room";

/** THE ROOM'S V1 ART BOX, exactly as the manifest paints it. This is the frame the V1 PAINTED GRID was
 *  authored in, so it stays available for the V1-fallback tests that check V2's planner still agrees with
 *  the V1 production oracle over the raw grid. Nothing in V2's geometry is positioned from it. */
export const V1_RECT: Rect = v1RoomRect(DESIGN_ROOM_ID);

/** WORLD SHIFT (Phase 9). The Design Room is BUILT 16 units SOUTH of its V1 art box.
 *
 *  WHY. Measured against reconstructed geometry, the band between the AI Room's south wall (z 300) and this
 *  room's north wall was 16.19 units of clear floor. A body at NAV_RADIUS 8 is 16 wide, so that band had
 *  0.19 units of legal centre freedom, and it throttled the AI Room's own entrance funnel to 8 — half the
 *  16 the Gaming Room's entrance gives, which is V2's narrowest accepted passage. The band on the QA side
 *  was 36.77 clear and carries no route: QA is unbuilt and its V1 door is on its EAST wall.
 *
 *  THE BUDGET. There are 52.96 units of clear floor either side of this room's 243.54-unit built depth.
 *  Two comfortable lanes would need 64, so the space goes where circulation actually is: 16 south leaves
 *  the AI side 32.19 and the QA side 20.77, both past the 16-unit body minimum.
 *
 *  HOW IT STAYS COHERENT. Every wall, entity, footprint, seat, stand point, approach, door rect and baked
 *  measurement in this file is expressed through RECT / wx() / wz(), and the static builder positions its
 *  group at room.rect — so the room translates as ONE unit, logical and visual together. The only part that
 *  does not follow RECT on its own is the separated V1 furniture (absolute world boxes in the manifest),
 *  which takes the same shift explicitly in designRoomEntities().
 *
 *  The V1 manifest, officeWalkabilityGrid.ts and seatDirections.ts are UNTOUCHED. This is a V2-only move:
 *  V2 navigation inside a reconstructed room comes from its CURRENT geometry (nav/derived.ts), which is
 *  what makes moving it honest. */
export const WORLD_SHIFT_Z = 16;
export const RECT: Rect = { ...V1_RECT, z: V1_RECT.z + WORLD_SHIFT_Z };
const NATIVE = { width: 1360, height: 1156 }; // design-room.png
const px = (v: number): number => v * (RECT.w / NATIVE.width);
const pz = (v: number): number => v * (RECT.d / NATIVE.height);
// x values were read off a 0.75-scale grid render (display px) → ×4/3; y values are native.
const D = 4 / 3;
const dpx = (v: number): number => px(v * D);


export const SHELL: ShellSpec = {
  wallHeight: 46,
  wallThickness: 6,
  capRadius: 1.4,
  /** the plate's front band (native y 1040..1156) is a low wall + exterior ledge */
  frontWallZ: pz(1040),
  frontWallHeight: 22,
  /** right (east) wall: glass run with the door leaf in its upper part */
  glass: { z0: pz(318), z1: pz(911), doorZ1: pz(728), postEvery: pz(200) },
  /** exterior slab margin around the room */
  exteriorMargin: 60,
};

/** room-local baked decor measurements + plant list (plants are converted to world entities below) */
const BAKED_LOCAL = {
  // long low credenza along the rear wall, alternating wood / green modules
  rearCabinet: { x: dpx(130), z: pz(30), w: dpx(570), d: pz(135), h: 24 } as BoxSpec,
  rearCabinetModules: 7,
  coffeeMachine: { x: dpx(140), z: pz(50), w: px(48), d: pz(60), h: 11 } as BoxSpec,
  rearFrames: [
    { x: dpx(255), z: pz(60), w: dpx(20), d: pz(40), h: 9 },
    { x: dpx(300), z: pz(55), w: dpx(30), d: pz(50), h: 11 },
    { x: dpx(560), z: pz(60), w: dpx(30), d: pz(50), h: 11 },
  ] as BoxSpec[],
  rearBooks: { x: dpx(455), z: pz(55), w: px(60), d: pz(55), h: 8 } as BoxSpec,
  whiteboard: { x0: dpx(760), x1: dpx(900), yBottom: 24, yTop: 50 },
  boards: [
    { z0: pz(282), z1: pz(410), yBottom: 16, yTop: 44 },
    { z0: pz(420), z1: pz(565), yBottom: 16, yTop: 44 },
  ],
  bottomCabinets: [
    { x: dpx(395), z: pz(890), w: dpx(241), d: pz(110), h: 20 },
    { x: dpx(686), z: pz(890), w: dpx(130), d: pz(110), h: 20 },
  ] as BoxSpec[],
  printer: { x: dpx(700), z: pz(892), w: dpx(50), d: pz(50), h: 12 } as BoxSpec,
  plantRack: { x: dpx(20), z: pz(780), w: dpx(50), d: pz(180), h: 26 } as BoxSpec,
  plants: [
    { x: dpx(85), z: pz(100), r: 8, h: 30 }, // top-left corner
    { x: dpx(655), z: pz(110), r: 7, h: 26 }, // rear, right of the cabinet run
    { x: dpx(730), z: pz(80), r: 6, h: 22, hanging: true }, // hanging plant on the rear wall
    { x: dpx(45), z: pz(615), r: 5, h: 18 }, // left wall column
    { x: dpx(45), z: pz(695), r: 5, h: 18 },
    { x: dpx(45), z: pz(870), r: 4.5, h: 20, y: 26 }, // on the rack's top shelf
    { x: dpx(45), z: pz(935), r: 4.5, h: 20, y: 26 },
    { x: dpx(430), z: pz(925), r: 4.5, h: 20, y: 20 }, // on bottom cabinet 1
    { x: dpx(495), z: pz(920), r: 5, h: 22, y: 20 },
    { x: dpx(785), z: pz(925), r: 4, h: 18, y: 20 }, // on bottom cabinet 2
    { x: dpx(900), z: pz(690), r: 9, h: 34 }, // big plant bottom-right
  ] as PlantSpec[],
};
export const BAKED: DesignBaked = BAKED_LOCAL;

/** world-space helpers */
const wx = (x: number): number => RECT.x + x;
const wz = (z: number): number => RECT.z + z;

/** THE PHYSICAL WALLS, as pure data for derived navigation (7B).
 *
 *  Derived from the ShellSpec that already builds them — the same four runs build/floorplan.ts extrudes, in
 *  world rects. NOT traversed out of the scene: this is the authored measurement, and the renderer is the
 *  thing that mirrors it, never the other way round. The east wall is the glass run the sliding door sits
 *  in, so it is declared whole here and the DOOR capability carves the opening back out (nav/solids.ts
 *  treats a door's jambs and its live leaf as the only solids inside the doorway's own band). */
const T = SHELL.wallThickness;
export const DESIGN_WALLS: Rect[] = [
  { x: RECT.x, z: RECT.z, w: RECT.w, d: T }, // north
  { x: RECT.x, z: RECT.z, w: T, d: SHELL.frontWallZ + T }, // west
  { x: wx(RECT.w - T), z: RECT.z, w: T, d: wz(SHELL.glass.z0) - RECT.z }, // east, north of the opening
  { x: wx(RECT.w - T), z: wz(SHELL.glass.doorZ1), w: T, d: SHELL.frontWallZ + T - SHELL.glass.doorZ1 }, // east, south of the opening (fixed pane + parked leaf pocket)
  { x: RECT.x, z: wz(SHELL.frontWallZ), w: RECT.w, d: T }, // south front band
];

export const DESIGN_ROOM: RoomDef = {
  id: DESIGN_ROOM_ID,
  name: "Design Team",
  rect: RECT,
  floorRect: { x: wx(SHELL.wallThickness), z: wz(SHELL.wallThickness), w: RECT.w - 2 * SHELL.wallThickness, d: SHELL.frontWallZ - SHELL.wallThickness },
  shell: SHELL,
  baked: BAKED,
  wallSolids: DESIGN_WALLS,
};

/** world rects of baked decor that placement must treat as solid (visuals come from build/baked.ts) */
export const DESIGN_SOLIDS: Rect[] = [BAKED.rearCabinet, ...BAKED.bottomCabinets, BAKED.plantRack].map((b) => ({ x: wx(b.x), z: wz(b.z), w: b.w, d: b.d }));

export const HERO_PLANT_ID = `${DESIGN_ROOM_ID}/plant-10`;
export const CHAIR_4_ID = `${DESIGN_ROOM_ID}/design-member-chair-4`;
export const DOOR_ID = `${DESIGN_ROOM_ID}/door-east`;

// ---- the east sliding door: every number below is DERIVED from the shell's measured glass run -----------------
// Opening = glass.z0 … glass.doorZ1 (the leaf sits 1 unit inside each end). The leaf slides SOUTH over the fixed pane
// (doorZ1 … z1) and on into the wall (z1 … frontWallZ + T): that pocket is 77.3 long, the leaf 91.6 wide, so an open
// leaf parks FLUSH with the wall's south end and its leading edge still stands inside the opening. The physically
// clear passage is therefore z0 … (z0 + 1 + slideDistance), narrower than the V1 '+' band (rows 24–30).
const DOOR_T = SHELL.wallThickness;
const DOOR_LEAF_W = SHELL.glass.doorZ1 - SHELL.glass.z0 - 2;
const DOOR_GLASS_H = SHELL.wallHeight - 6;
const DOOR_SLIDE = SHELL.frontWallZ + DOOR_T - (SHELL.glass.doorZ1 - 1); // parks flush with the wall end
const DOOR_CLOSED: Vec2 = { x: wx(RECT.w - DOOR_T / 2 - 0.6), z: wz((SHELL.glass.z0 + SHELL.glass.doorZ1) / 2) }; // 0.6 inside the wall's centre plane: never z-fights the fixed pane it slides over
const OPENING_Z0 = wz(SHELL.glass.z0);
const PARKED_EDGE_Z = wz(SHELL.glass.z0 + 1 + DOOR_SLIDE);
const WALL_X = wx(RECT.w - DOOR_T);
export const DESIGN_DOOR: DoorCapability = {
  slide: { x: 0, z: 1 },
  slideDistance: DOOR_SLIDE,
  automatic: true,
  crossing: { x: DOOR_CLOSED.x - (BODY_RADIUS + 4), z: OPENING_Z0, w: 2 * (BODY_RADIUS + 4), d: PARKED_EDGE_Z - OPENING_Z0 },
  /** the leaf where it rests CLOSED — spanning the opening, one unit inside each end. Derived navigation
   *  slides this by `slide × slideDistance × openFraction`, which is what makes the doorway route only
   *  while the door is actually open. */
  leaf: { x: DOOR_CLOSED.x - DOOR_T / 2, z: OPENING_Z0 + 1, w: DOOR_T, d: DOOR_LEAF_W },
  trigger: { x: DOOR_CLOSED.x - 72, z: OPENING_Z0 - 24, w: 144, d: PARKED_EDGE_Z - OPENING_Z0 + 48 }, // 72 units ≈ 2.4 s of walking: the leaf is fully open long before Bon's body reaches it
  clearance: {
    bodyRadius: BODY_RADIUS,
    band: { x: wx(RECT.w) - CELL, z: RECT.z, w: CELL, d: RECT.d }, // the cell column inside the east wall (grid col 19 = the V1 '+' band)
    solids: [
      { x: WALL_X, z: RECT.z, w: DOOR_T, d: OPENING_Z0 - RECT.z }, // north jamb (wall + frame post)
      { x: WALL_X, z: PARKED_EDGE_Z, w: DOOR_T, d: RECT.z + RECT.d - PARKED_EDGE_Z }, // parked leaf + fixed pane + wall
    ],
  },
  timings: { openMs: 650, closeMs: 800, holdMs: 450 },
};

function doorEntity(): Entity {
  return {
    id: DOOR_ID,
    kind: "sliding-door",
    roomId: DESIGN_ROOM_ID,
    transform: { pos: DOOR_CLOSED, yaw: 0 }, // the CLOSED rest transform; interact/Door.ts moves the view, never this
    capabilities: { door: DESIGN_DOOR },
    props: { leafW: DOOR_LEAF_W, glassH: DOOR_GLASS_H, handleX: -DOOR_T / 2, handleZ: (SHELL.glass.doorZ1 - SHELL.glass.z0) / 2 - 6 },
    source: { baked: true },
  };
}

function plantEntities(): Entity[] {
  return (BAKED_LOCAL.plants as PlantSpec[]).map((p, i) => {
    const id = `${DESIGN_ROOM_ID}/plant-${i}`;
    const hero = i === BAKED_LOCAL.plants.length - 1;
    // 7B: a plant STANDING ON THE FLOOR is a logical obstacle and gets a circle footprint; one sitting on a
    // cabinet or rack shelf (`y > 0`) or hanging from the wall is not in the way of anybody's feet and gets
    // none. Radius is the pot, not the canopy — a body brushes past leaves.
    const onFloor = !(p.hanging ?? false) && (p.y ?? 0) === 0;
    return {
      id,
      kind: "plant",
      roomId: DESIGN_ROOM_ID,
      transform: { pos: { x: wx(p.x), z: wz(p.z) }, yaw: 0 },
      footprint: hero ? { shape: "circle", r: 8 } : onFloor ? { shape: "circle", r: p.r * 0.9 } : undefined, // hero: pot radius 7.2 + clearance
      placement: hero ? { movable: true, clearance: 1.5 } : undefined,
      capabilities: hero ? { sway: true, editable: true, navBlocker: true } : { sway: true },
      props: { r: p.r, h: p.h, hanging: p.hanging ?? false, y: p.y ?? 0 },
      source: { baked: true },
    } satisfies Entity;
  });
}

/** THE OTHER SEVEN DESK CHAIRS (Phase 6C). Until now only chair 4 carried a seat capability ("proof
 *  scope"), so the Design Room's other chairs could not be sat in at all. Each now gets the SAME accepted
 *  numbers chair 4 was tuned with, expressed relative to the chair along its PULL axis (away from the desk,
 *  the opposite of the facing the manifest gave it) and a SIDE axis (which lane the body approaches from,
 *  chosen per chair so two neighbours never share a stand cell). Chair 4 itself keeps its literal block. */
const DESIGN_CHAIR = { side: 19.2, back: 16.1, preSeatBack: 6.8, waypointSide: 12.7, pullDistance: 22, seatedTuck: 7, cushionTopY: 14.4, cushionLocalZ: 0.3, sitDepth: 3.5,
  timings: { pullMs: 900, sitMs: 650, slideMs: 1000, standMs: 650, returnMs: 900 } };
const FORWARD: Record<Facing, Vec2> = { north: { x: 0, z: -1 }, south: { x: 0, z: 1 }, west: { x: -1, z: 0 }, east: { x: 1, z: 0 } };
/** +1 / −1 along (pull.z, −pull.x): for a north-facing chair +1 is east (chair 4's lane); for the west-facing
 *  pair at x 94 +1 is north; for the east-facing pair at x 235 +1 is south; for the lead chair +1 is west. The
 *  lower chair of each pair uses the lane BETWEEN the pair — south of it the curve desks leave no stand cell. */
export const DESIGN_CHAIR_SIDE: Readonly<Record<string, 1 | -1>> = {
  "design-chair-3": 1, "design-member-chair5": 1,
  "design-member-chair1": 1, "design-member-chair2": 1,
  "design-member-chair7": -1, "design-member-chair6": -1,
  "design-lead-chair": -1,
};
export function designChairSeat(pos: Vec2, facing: Facing, sideSign: 1 | -1): SeatCapability {
  const T = DESIGN_CHAIR;
  const f = FORWARD[facing];
  const pull = { x: -f.x, z: -f.z };
  const side = { x: pull.z * sideSign, z: -pull.x * sideSign };
  const at = (sideUnits: number, backUnits: number): Vec2 => ({ x: pos.x + side.x * sideUnits + pull.x * backUnits, z: pos.z + side.z * sideUnits + pull.z * backUnits });
  const preSeat = at(0, T.preSeatBack);
  return {
    approach: at(T.side, T.back),
    preSeat,
    approachToSeat: [at(T.waypointSide, T.preSeatBack), preSeat],
    pullDir: pull,
    pullDistance: T.pullDistance,
    seatedTuck: T.seatedTuck,
    cushionTopY: T.cushionTopY,
    cushionLocal: { x: 0, z: T.cushionLocalZ },
    sitDepth: T.sitDepth,
    // the yaw whose body forward IS `facing` (+z model): the authored fallback; data/seatFacing.json decides
    seatedYaw: headingFor(f.x, f.z),
    timings: T.timings,
  };
}
export const DESIGN_SEAT_IDS = [CHAIR_4_ID, ...Object.keys(DESIGN_CHAIR_SIDE).map((id) => `${DESIGN_ROOM_ID}/${id}`)];

/** THE SIDE SOFA AND THE BEANBAG (Phase 6C): fixed lounge seating, until now with no capability at all —
 *  so the click picker had no name for them and nothing could start a sit. V1 counts the sofa as three
 *  seats and the beanbag as one (seatDirections "design-team").
 *
 *  Contact metadata is the builders' own. The `sofa` builder (build/furniture.ts, plain tone: 5-unit
 *  arms, 4.2-unit cushions on an 8-unit deck at y 2) draws TWO cushions along local z, back to local −x —
 *  the piece is authored back-to-west and un-mirrored (x 48 is west of the room's centre), so its sitters
 *  face east into the room, V1's "right". The beanbag is a lathe of height 1.05·r; a body settles into its
 *  dimple. The sofa is boxed in on its east by the curve desk (to z 504) and the side desk (from z 518),
 *  so both cushions share the one stand cell on the open floor NORTH of the sofa and step in through the
 *  14-unit gap between the two desks; the beanbag is approached from the open cell NORTH of it — the floor
 *  to its east and south is inside the bottom cabinets' clearance (DESIGN_SOLIDS). */
export const DESIGN_SOFA_ID = `${DESIGN_ROOM_ID}/design-side-sofa`;
export const DESIGN_BEANBAG_ID = `${DESIGN_ROOM_ID}/design-side-beanbag`;
export const DESIGN_LOUNGE_IDS = [DESIGN_SOFA_ID, DESIGN_BEANBAG_ID];
const DESIGN_SOFA_CUSHION_TOP = 8 + 2 + 4.2; // deck at y 2, 8 high; plain-tone cushion 4.2 high
const DESIGN_SOFA_DEPTH_UNITS = 70.5; // the manifest box (design-side-sofa.png), which the builder fills
function designSofaLounge(pos: Vec2): LoungeSeatCapability {
  const armW = 5, seats = 2;
  const cushD = (DESIGN_SOFA_DEPTH_UNITS - 2 * armW - (seats - 1) * SOFA_CUSHION_GAP - 2 * SOFA_CUSHION_MARGIN) / seats;
  const gapZ = 511; // world z: the centre of the 14-unit gap between the curve desk (ends 504) and the side desk (starts 518)
  const approach = { x: pos.x, z: pos.z - DESIGN_SOFA_DEPTH_UNITS / 2 - 12 }; // open floor north of the sofa's north arm
  return {
    slots: [-(cushD / 2 + 0.6), cushD / 2 + 0.6].map((lz, i) => ({
      id: i === 0 ? "sofa-north" : "sofa-south",
      contactLocal: { x: SOFA_CUSHION_LOCAL_X + 1.5, y: DESIGN_SOFA_CUSHION_TOP, z: lz },
      seatedYaw: FACING_YAW.east, // authored fallback (label-by-value, as every room authors); data/seatFacing.json decides
      approach,
      approachToSeat: [{ x: pos.x + 14, z: approach.z + 6 }, { x: pos.x + 17, z: gapZ }],
      sink: 0.3,
      timings: { sitMs: 750, standMs: 700 },
    })),
  };
}
function designBeanbagLounge(pos: Vec2, r: number): LoungeSeatCapability {
  const h = r * 1.05;
  return {
    slots: [{
      id: "beanbag-seat",
      contactLocal: { x: 0, y: h * 0.8, z: 0 },
      seatedYaw: FACING_YAW.south, // V1 "front"; the table decides
      approach: { x: pos.x, z: pos.z - r - 10 },
      approachToSeat: [{ x: pos.x, z: pos.z - r - 2 }],
      sink: 1.2,
      timings: { sitMs: 750, standMs: 700 },
    }],
  };
}

export function designRoomEntities(): Entity[] {
  // the separated V1 furniture boxes are absolute WORLD positions in the manifest, so they are the one
  // part of this room that does not follow RECT on its own — they take the same shift explicitly
  const furniture = v1FurnitureEntities(DESIGN_ROOM_ID, "design-team", RECT, { x: 0, z: WORLD_SHIFT_Z });
  const chair = furniture.find((e) => e.id === CHAIR_4_ID);
  if (!chair) throw new Error("design room: chair-4 not found in manifest");
  // ONE interactive seat (proof scope). All values world-space; tuning accepted in the prototype.
  chair.capabilities = {
    seat: {
      approach: { x: wx(174.5), z: wz(187.8) }, // production stand-here cell (11,31)
      preSeat: { x: wx(155.3), z: wz(178.5) },
      approachToSeat: [{ x: wx(168), z: wz(178.5) }, { x: wx(155.3), z: wz(178.5) }],
      pullDir: { x: 0, z: 1 },
      pullDistance: 22,
      seatedTuck: 7,
      cushionTopY: 14.4,
      cushionLocal: { x: 0, z: 0.3 },
      sitDepth: 3.5,
      seatedYaw: Math.PI,
      timings: { pullMs: 900, sitMs: 650, slideMs: 1000, standMs: 650, returnMs: 900 },
    },
  };
  const sofa = furniture.find((e) => e.id === DESIGN_SOFA_ID);
  const beanbag = furniture.find((e) => e.id === DESIGN_BEANBAG_ID);
  if (!sofa || !beanbag) throw new Error("design room: side sofa / beanbag not found in manifest");
  sofa.capabilities = { ...sofa.capabilities, lounge: designSofaLounge(sofa.transform.pos) };
  beanbag.capabilities = { ...beanbag.capabilities, lounge: designBeanbagLounge(beanbag.transform.pos, Math.min(beanbag.props.w as number, beanbag.props.d as number) / 2) };
  for (const [layerId, sideSign] of Object.entries(DESIGN_CHAIR_SIDE)) {
    const e = furniture.find((x) => x.id === `${DESIGN_ROOM_ID}/${layerId}`);
    if (!e) throw new Error(`design room: ${layerId} not found in manifest`);
    e.capabilities = { ...e.capabilities, seat: designChairSeat(e.transform.pos, e.props.facing as Facing, sideSign) };
  }
  return [...furniture, ...plantEntities(), doorEntity()];
}
