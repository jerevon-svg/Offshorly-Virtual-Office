// vo3d rooms — THE CHAMPIONSHIP CAVE (data only, WORLD coordinates).
//
// The immersive 270° theatre you reach through the Boxing Championship monument in the Central Hub.
//
// ============================= WHY IT IS NOT UNDER THE MONUMENT =================================
// It does not fit, and pretending otherwise would cost far more than it buys.
//
// The monument's footprint is 72 × 72 and CANNOT GROW: past a 72 base it swallows the cell row that
// connects the west and east bench gaps to the rest of the hub floor (see MONUMENT in central-hub.ts).
// A theatre that holds a company gathering is an order of magnitude larger than that. So the CAVE is a
// SEPARATE INTERIOR VOLUME standing in its own world space, reached through the monument's portal by a
// deterministic transition — the oldest trick in level design, and the honest one: the interior really
// is that big, it is just not literally inside the thing you walked into.
//
// ============================= WHERE IT STANDS ==================================================
// EAST OF THE V1 FRAME, clear of it by 1,146 units. That matters for three separate reasons:
//   • the V1 walkability grid is 90 × 78 cells covering x 0…1440, z 0…1244 and is READ-ONLY. Nothing out
//     here can touch a cell of it, so the office's navigation is provably unaffected by this file.
//   • the eleven reconstructed rooms and the hall keep every square unit they own. No region moves.
//   • the campus (world/campus.ts) is laid out around the frame; this sits outside its block entirely.
//
// The volume is NEVER DRAWN while nobody is inside it (interact/CaveTransition), so its distance from
// the office is invisible in both directions: the office never sees a dark box on its horizon, and the
// CAVE never sees the office through its own walls.
//
// ============================= NAVIGATION =======================================================
// The CAVE is outside the V1 grid, so it is NOT V1-governed and NOT DerivedNav-governed — both are
// indexed by that 90 × 78 lattice. It answers its own "can a body stand here?" from its own geometry
// (`caveStandTest` below), composed into the player's stand test beside the office's. That is the same
// question the rest of the world answers, asked of the only geometry that describes this room. It is
// NOT a bypass: the screen ring, the shell and the back wall genuinely stop a body, and the numbers
// below are the only place that is decided.
import { FACING_YAW, type Rect, type Vec2 } from "../core/coords";
import type { ApproachCapability, Entity, RoomDef } from "../world/WorldState";
import type { MatKey } from "../render/Materials";

export const CAVE_ID = "cave-theater";

// ============================= THEME ============================================================
/** ROOM-LEVEL COLOUR TABLE, on the 5B rule: no builder in this room names a palette key directly. */
export const THEME = {
  /** the ceiling, the shell behind the screen — everything meant to vanish */
  void: "caveVoid",
  /** the floor plate */
  floor: "caveFloor",
  /** the screen plinth, the truss runs, the vestibule reveal */
  graphite: "caveGraphite",
  /** edge trims and truss webs */
  steel: "caveSteel",
  /** the one architectural light: the cool perimeter / threshold line */
  cove: "caveCove",
  /** the low floor cushions along the back wall */
  cushion: "caveCushion",
  /** the monument's bronze, carried into the portal threshold */
  bronze: "caveBronze",
} satisfies Record<string, MatKey>;

// ============================= THE VOLUME =======================================================
/** North-west corner of the INTERIOR floor, in world space. Everything below is measured from here. */
export const ORIGIN: Vec2 = { x: 2600, z: 380 };

/** THE ROOM, in interior units. Bon is 36 units tall (≈1.8 m), so one unit ≈ 5 cm:
 *
 *      560 × 440 × 240  ≈  28 m × 22 m × 12 m
 *
 *  That is a genuine event hall — 616 m² gross, ~456 m² of it walkable after the screen standoff. At a
 *  comfortable standing density (2 m²/person) it holds well over 200 avatars, and at gathering density
 *  many more; the number that actually matters is that NOTHING about it assumes one occupant. There is
 *  no seating to compete for, no corridor to queue in, and the entrance threshold is 96 wide — twelve
 *  bodies abreast at NAV_RADIUS. See the multiplayer note at the bottom of this file. */
export const ROOM = {
  /** interior floor, x (east) × z (south) */
  w: 560,
  d: 440,
  /** interior height. The reference CAVE reads as a tall black box; this is 6.6 × Bon. */
  ceiling: 240,
  /** shell thickness (walls, ceiling slab, floor plate) */
  wallT: 14,
};

/** world rect of the interior floor — the room's main walkable region */
export const FLOOR_RECT: Rect = { x: ORIGIN.x, z: ORIGIN.z, w: ROOM.w, d: ROOM.d };
/** world rect of the whole built volume, shell included — what the world bounds must cover */
export const OUTER_RECT: Rect = {
  x: ORIGIN.x - ROOM.wallT, z: ORIGIN.z - ROOM.wallT,
  w: ROOM.w + 2 * ROOM.wallT, d: ROOM.d + 2 * ROOM.wallT,
};

/** interior-local → world */
export const toWorld = (x: number, z: number): Vec2 => ({ x: ORIGIN.x + x, z: ORIGIN.z + z });

// ============================= THE 270° SCREEN ==================================================
/** THE WRAPAROUND DISPLAY, as a plan path: a rounded "U" open to the south, hugging the west, north and
 *  east walls. It is ONE continuous surface — one mesh, one material, one texture, one draw call — and
 *  the corner radius is what makes 270° read as a single screen instead of three televisions.
 *
 *  THE VIDEO FITS THE FRONT PANEL EXACTLY, and that is not a coincidence:
 *
 *      height 180  ×  16/9  =  320  =  the flat front chord
 *
 *  So SUNTOUCAN.mp4 (1920 × 1080) plays at TRUE ASPECT on the wall you are facing — no squashed faces —
 *  and the curves and wings carry a MIRRORED continuation of the same frame (THREE.MirroredRepeatWrapping
 *  on one shared VideoTexture). Mirror-repeat is continuous at the seam, so the picture flows off the
 *  front panel and around you rather than stopping at a bezel. One decode, one upload, 270° of image. */
export const SCREEN = {
  /** standoff from the west, north and east interior faces (the service gap the cove hides in) */
  inset: 24,
  /** plan radius of the two front corners — the whole reason this reads as a CAVE */
  cornerR: 96,
  /** how far south of the north wall each wing runs */
  wingZ: 320,
  /** image band: bottom edge above the floor, and its height */
  bottom: 16,
  height: 180,
  /** the source's aspect. 1920 × 1080. */
  aspect: 16 / 9,
  /** EDGE CROP, as a fraction of the source frame trimmed off EACH side before the picture is mirrored.
   *
   *  SUNTOUCAN.mp4 is not pillarboxed — a max-luminance column profile over twelve frames reaches 254 at
   *  column 0 — but most of its frames DO fall to black at the left and right edges (a lit ring against a
   *  dark arena). Mirroring puts two of those dark edges back to back, and the result reads as a bezel
   *  exactly where the flat front panel meets the curved wings: the one place a 270° screen must not look
   *  like three televisions. Trimming 1.8% off each side folds the mirror on live picture instead, and
   *  costs 35 of 1920 columns — nothing the eye can find on a 320-unit-wide panel. */
  edgeCrop: 0.018,
  /** plan samples per corner quadrant — 14 is smooth at 96 radius and costs 4 × 14 × 2 vertices */
  arcSegments: 14,
  /** how far the floor reflection of the screen reaches inward */
  reflect: 120,
};

/** the video's width ON THE SCREEN, in world units: exactly the front chord (see SCREEN). */
export const VIDEO_WIDTH = SCREEN.height * SCREEN.aspect;
/** the flat front panel's chord, between the two corner arcs */
export const FRONT_CHORD = ROOM.w - 2 * SCREEN.inset - 2 * SCREEN.cornerR;

/** THE SCREEN PATH, interior-local, west wing → north → east wing. A segment is a straight run or a
 *  quadrant arc; build/cave.ts walks this once and never invents a point of its own.
 *
 *  ARC ANGLES are plain plane angles in the (x, z) plane: a point is `centre + r · (cos a, sin a)`, and
 *  a segment always runs from `from` to `to` with `from < to`. The tangent is therefore (−sin a, cos a)
 *  and the INWARD normal — the side the picture faces — is (−tangent.z, tangent.x) on every segment,
 *  straight and curved alike, which is the one rule build/cave.ts needs. */
export type ScreenSegment =
  | { kind: "line"; from: Vec2; to: Vec2 }
  | { kind: "arc"; centre: Vec2; r: number; from: number; to: number };

export function screenPath(): ScreenSegment[] {
  const { inset, cornerR, wingZ } = SCREEN;
  const xw = inset, xe = ROOM.w - inset, zn = inset;
  const cw = { x: xw + cornerR, z: zn + cornerR }; // north-WEST arc centre
  const ce = { x: xe - cornerR, z: zn + cornerR }; // north-EAST arc centre
  return [
    { kind: "line", from: { x: xw, z: wingZ }, to: { x: xw, z: cw.z } },
    { kind: "arc", centre: cw, r: cornerR, from: Math.PI, to: 1.5 * Math.PI },
    { kind: "line", from: { x: cw.x, z: zn }, to: { x: ce.x, z: zn } },
    { kind: "arc", centre: ce, r: cornerR, from: 1.5 * Math.PI, to: 2 * Math.PI },
    { kind: "line", from: { x: xe, z: ce.z }, to: { x: xe, z: wingZ } },
  ];
}

// ============================= THE THRESHOLD ====================================================
/** Where you arrive, and where you leave from. The vestibule is a recess in the SOUTH wall, centred:
 *  wide enough that a crowd never queues, and far enough from the spawn point that the exit prompt
 *  cannot steal the first look at the screen. */
const THRESHOLD_W = 96;
const THRESHOLD_DEPTH = 26;
export const THRESHOLD = {
  /** vestibule opening width and height, and how deep it cuts into the south wall */
  w: THRESHOLD_W,
  h: 46,
  depth: THRESHOLD_DEPTH,
  /** interior-local z of the south interior face */
  get z(): number { return ROOM.d; },
};

/** THE VESTIBULE POCKET, as its own world region.
 *
 *  It has to be one. A region answers "whose floor is this?", and PlayerMode scopes its interaction
 *  candidates to the room the body's region names — so a body standing in a recess that belongs to NO
 *  region targets nothing at all, which is precisely where the way out lives. The pocket is south of
 *  FLOOR_RECT, so one rect cannot describe both without claiming solid wall either side of the mouth.
 *  Two rects, same roomId. (Registered after FLOOR_RECT; they do not overlap, so the order is free.) */
export const VESTIBULE_RECT: Rect = {
  x: ORIGIN.x + ROOM.w / 2 - THRESHOLD_W / 2, z: ORIGIN.z + ROOM.d,
  w: THRESHOLD_W, d: THRESHOLD_DEPTH,
};

/** WHERE THE PLAYER LANDS. Face-on to the screen, a third of the way in, with the exit 76 behind him —
 *  past PlayerTargeting.REACH (62), so the very first frame inside shows the video and nothing else. */
export const SPAWN: Vec2 = toWorld(ROOM.w / 2, 330);
/** WHICH WAY HE IS POINTED, as a DIRECTION rather than an angle — deliberately.
 *
 *  This world carries two yaw conventions that differ by π: an avatar's heading is `atan2(dx, dz)`
 *  (core/coords headingFor), while the player camera's is `atan2(dx, −dz)` (PlayerCamera.forward is
 *  `(sin y, −cos y)`). Handing a transition one number means picking one of them and getting the other
 *  backwards — which is exactly how the first build of this spawned the player facing the back wall
 *  with a 270° video behind his head. A direction has no convention to get wrong, so that is what the
 *  portal moves people with, and each rig converts once, at the point where it is applied. */
export const SPAWN_LOOK: Vec2 = { x: 0, z: -1 }; // due north, straight at the front panel
/** AND SLIGHTLY UP. The player camera's resting pitch is 0.34 rad DOWN — the right angle for walking an
 *  office, and the wrong one for arriving in a room whose whole point is 180 units of picture standing
 *  over you: at 306 units back it puts the top of the frame barely 43 above the eye line, so the first
 *  thing you see of a 270° theatre is the bottom third of it. Tilting the arrival 7° up instead frames
 *  the wall of image. The player is free to look anywhere from the next mouse movement onward. */
export const SPAWN_PITCH = -0.12;
/** the avatar-heading spelling of SPAWN_LOOK, for anything that wants the angle */
export const SPAWN_YAW = FACING_YAW.north;

/** The walk-up point for leaving: INSIDE the vestibule mouth, not at its lip.
 *
 *  PlayerTargeting offers anything within CLOSE_ENOUGH (20) regardless of which way you are facing, and
 *  only applies its facing cone beyond that. Putting the point a body's length into the recess therefore
 *  means "step into the vestibule and the way out is offered" — in first person, in third person, and
 *  whichever way you happened to turn while doing it — instead of "stand on an exact spot and look the
 *  right way". Crossing the mouth's lip is the gesture; aiming is not. */
export const EXIT_POINT: Vec2 = toWorld(ROOM.w / 2, ROOM.d + 12);
/** The walk-up point for the screen's own dev controls (play / pause), in front of the front panel. */
export const SCREEN_POINT: Vec2 = toWorld(ROOM.w / 2, SCREEN.inset + 46);

// ============================= WALKABILITY ======================================================
// GEOMETRY, not a painted grid. The walkable floor is the interior minus the screen standoff on three
// sides minus the body radius, with the two front corners cut on the SAME arcs the screen is built from
// — so "you cannot walk into the screen" is one statement, made once, used by both the renderer and the
// collision test. The south edge stops at the back wall except in the vestibule mouth, which is the one
// place a body may stand further south than the wall line.

/** how far clear of the screen surface a body must stay, on top of its own radius */
export const SCREEN_CLEARANCE = 4;

/** May a body of `radius` stand at world point `p`? The CAVE's whole collision model. */
export function caveStandTest(p: Vec2, radius: number): boolean {
  const x = p.x - ORIGIN.x, z = p.z - ORIGIN.z;
  const m = radius + SCREEN_CLEARANCE;
  const { inset, cornerR } = SCREEN;
  // the vestibule mouth: the one pocket south of the back wall a body may occupy
  const inMouth = Math.abs(x - ROOM.w / 2) <= THRESHOLD.w / 2 - radius && z > ROOM.d - m && z <= ROOM.d + THRESHOLD.depth - m;
  if (inMouth) return true;
  if (x < inset + m || x > ROOM.w - inset - m) return false;
  if (z < inset + m || z > ROOM.d - m) return false;
  // the two front corners, cut on the screen's own arcs
  const cw = { x: inset + cornerR, z: inset + cornerR };
  const ce = { x: ROOM.w - inset - cornerR, z: inset + cornerR };
  if (x < cw.x && z < cw.z && Math.hypot(x - cw.x, z - cw.z) > cornerR - m) return false;
  if (x > ce.x && z < ce.z && Math.hypot(x - ce.x, z - ce.z) > cornerR - m) return false;
  return true;
}

/** Is this world point inside the CAVE's volume at all? Used to route the stand test and to tell the
 *  office's own collision to keep its hands off. Generous by a wall thickness so the threshold counts. */
export function inCave(p: Vec2): boolean {
  return p.x >= OUTER_RECT.x && p.x <= OUTER_RECT.x + OUTER_RECT.w && p.z >= OUTER_RECT.z && p.z <= OUTER_RECT.z + OUTER_RECT.d;
}

// ============================= THE ROOM DEF + ENTITIES ==========================================
export const CAVE_ROOM: RoomDef = {
  id: CAVE_ID,
  name: "Championship Cave",
  rect: OUTER_RECT,
  floorRect: FLOOR_RECT,
  // Not a V1 room, so no shell spec and no door: the volume owns all of its own architecture.
  // EXPLICITLY EMPTY rather than absent — this room's walls are real, they are simply not expressed as
  // DerivedNav solids because DerivedNav is indexed by the V1 lattice and this room is outside it.
  wallSolids: [],
};

export const EXIT_INTERACTION_ID = `${CAVE_ID}/exit-interaction`;
export const SCREEN_INTERACTION_ID = `${CAVE_ID}/screen-interaction`;

/** Back out through the portal, to the Central Hub. */
export const exitApproach = (): ApproachCapability => ({
  point: { ...EXIT_POINT }, yaw: FACING_YAW.south,
  label: "Leave the Championship", action: "Back to the Hub",
});
/** The screen's own controls. Dev/testing affordance: pause the wall you are standing in front of. */
export const screenApproach = (): ApproachCapability => ({
  point: { ...SCREEN_POINT }, yaw: FACING_YAW.north,
  label: "Championship Screen", action: "Play / pause",
});

function approachEntity(id: string, pick: string, approach: ApproachCapability): Entity {
  return {
    id, kind: "solid", roomId: CAVE_ID,
    transform: { pos: { ...approach.point }, yaw: approach.yaw },
    capabilities: { approach }, props: { pick }, source: { baked: true },
  };
}

/** The CAVE's interactables. Both are approach points on footprint-free entities: the room's geometry is
 *  static (build/cave.ts owns all of it), exactly as the Central Hub's bench seating is. */
export function caveEntities(): Entity[] {
  return [
    approachEntity(EXIT_INTERACTION_ID, "cave-vestibule", exitApproach()),
    approachEntity(SCREEN_INTERACTION_ID, "cave-screen", screenApproach()),
  ];
}

// ============================= MULTIPLAYER READINESS ============================================
// NOT IMPLEMENTED, and deliberately not stubbed. What is done is the part that would be expensive to
// retrofit — the SHAPE of the space:
//   • one open floor, ~456 m² of it, with no internal corridor and nothing to walk around
//   • a 96-wide threshold (12 bodies abreast at NAV_RADIUS 8) instead of a doorway
//   • no seating, so no per-occupant slot to contend for and no single-occupant interaction anywhere
//   • the two interactables are read-only verbs that any number of people may perform at once
//   • the arrival point is a POINT, not a seat: a spawn ring around it is a later, purely local change
// The media is the one genuinely shared thing in here, and it already lives behind a single owner
// (media/CaveMedia) rather than per-viewer state, which is where a network sync would attach.
