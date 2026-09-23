// vo3d rooms — RECEPTION definition (data only, WORLD coordinates).
// 3B: architecture + primary structural geometry.  3C: the arc counter, both lounges, kiosk and planters.
// Still deferred to 3D/3E: counter succulents, monitors/mugs/props, the Offshorly logo, emissive/LED
// polish, door animation, seat capabilities.
//
// Every number below is DERIVED, never invented:
//   • rect            → the READ-ONLY V1 asset manifest
//   • gate lanes      → the '+' cells of the V1 walkability grid (rows 52–56, cols 40–41 / 44–46 / 48–49)
//   • façade plane    → FACADE_Z, the north face of the V1 south door band (rows 70–74)
//   • door opening    → the '+' cells of that band (cols 40–49)
//   • everything else → measured off src/assets/office/rooms/reception-room.png at 0.18285 units/px
//
// The flat PNG is a BLUEPRINT. Nothing here renders it.
import type { Rect } from "../core/coords";
import type { ApproachCapability, ClearanceCapability, DoorCapability, Entity, LoungeSeatCapability, LoungeSeatSlot, RoomDef } from "../world/WorldState";
import { FACING_YAW } from "../core/coords";
import { SOFA_CUSHION_GAP, SOFA_CUSHION_LOCAL_X, SOFA_CUSHION_MARGIN, SOFA_CUSHION_TOP, TUB_CUSHION_TOP } from "../build/furniture";
import { v1RoomRect } from "../adapters/v1Manifest";
import { FACADE_Z } from "../adapters/v1Floor";
import { CELL } from "../adapters/v1Grid";
import { kindFootprint } from "./footprint";

export const RECEPTION_ROOM_ID = "reception-room";
export const RECT: Rect = v1RoomRect(RECEPTION_ROOM_ID); // x 332.33, z 838.47, w 748.955, d 399.102

/** The artwork's mirror axis. NOT the rect centre (706.8) — confirmed independently by the V1 seat table,
 *  the gate-lane spans and pixel measurement. Every east/west pair reflects about this line. */
export const AXIS = 720;

/** Structure shared with the rest of the ground floor so the bar reads as one building. */
export const STRUCT = {
  wallThickness: 6, // = Design Room shell + ground-floor footprint walls
  wallHeight: 46, //   = Design Room shell
  railHeight: 22, //   = ground-floor frontWallHeight: the balustrade is a waist-high partition
  capRadius: 1.4,
};

/** Bon's skinned bounding box measures 19.6 × 16.9 units walking → 10.5 covers his widest extent
 *  (the same figure the Design Room door uses). */
const BODY_RADIUS = 10.5;

/** North gate line. The V1 grid blocks rows 52–56 (z 832…912) except three '+' lanes — those lanes are
 *  gameplay truth and NO mesh may intrude on them. Pedestals are therefore snapped to the centre of the
 *  BLOCKED spans between the lanes (art measured them at 626/687/756/814; only 756→760 moved, by 4 units). */
export const GATE = {
  /** the balustrade/gate plane, measured off the art (inside the band, clear of every lane in z) */
  z: 890,
  bandZ0: 52 * CELL, // 832
  bandZ1: 57 * CELL, // 912
  /** V1 '+' cells — the three walk-through lanes, in world x */
  lanes: [
    { x0: 40 * CELL, x1: 42 * CELL }, // 640…672
    { x0: 44 * CELL, x1: 47 * CELL }, // 704…752  (the wide / accessible lane)
    { x0: 48 * CELL, x1: 50 * CELL }, // 768…800
  ],
  /** speed-gate pedestal centres, each inside a blocked span between lanes */
  pedestals: [626, 688, 760, 814],
  pedestal: { w: 14, d: 56, h: 30, zCentre: 873 },
  /** The slim divider post of the wide accessible lane, CENTRED between gates 2 and 3.
   *  Painted at x 718 (r 2.0). Reading it as a true divider — two passages, one either side — fixes it:
   *      west passage  gate2(695.2) … 725.0  = 29.8   east passage  729.0 … gate3(752.8) = 23.8
   *  both wider than the 21-unit body, so it is architecturally honest rather than an obstruction. The
   *  16-unit V1 cell grid offers one centre inside either passage (col 44, x 712 → +2.5 clearance); the
   *  clearance layer closes the rest. Radius is unchanged from the measured artwork width. */
  bollard: { x: 727, r: 2.0, h: 26 },
  /** where the artwork paints it, kept for reference/tests */
  bollardPainted: { x: 718, r: 2.0 },
  /** the balustrade glass stops here on each side; the gate cluster fills the middle */
  glassEnd: { west: 612, east: 828 },
  /** measured panel pitch of the balustrade glass */
  panelPitch: 38,
};

/** SCANNER ZONES — read-only proximity volumes used ONLY to drive the blue→green status light.
 *  They touch no navigation, no grid and no gameplay: the ambient system reads the avatar's position and
 *  sets a visual state. Each gate lights when someone is in either lane it borders. */
export const GATE_SCANNER_IDS = ["gate-0", "gate-1", "gate-2", "gate-3"];
export const ENTRY_SCANNER_ID = "entry";
/** PHASE 7E — THE KIOSK'S OWN STATUS CHANNEL. Not a proximity zone like the four above: the kiosk is the
 *  ATTENDANCE READOUT, so what lights it is V1's answer about this employee's work session, not where
 *  anybody is standing. Green = checked in, red = checked out. The mesh, the LED and the materials are the
 *  ones build/reception.ts already builds for a scanner-wired kiosk — this only names the channel. */
export const KIOSK_SCANNER_ID = "reception-kiosk";

/** GATE CLEARANCE. The V1 '+' lanes are authored at 16-unit cells and are deliberately generous: a body of
 *  10.5 radius standing on a lane cell centre overhangs the painted lane by 2.5 units on each side, and the
 *  blocked spans between lanes are only 16–32 wide against 14-wide pedestals. Rather than edit the
 *  authoritative grid, Reception declares the same kind of clearance the Design Room door already uses —
 *  cells whose body circle hits a pedestal or the bollard drop out, and every lane keeps a clear route:
 *      lane 1 → cols 40, 41    lane 2 → cols 44, 45    lane 3 → col 49
 *  Measured worst-case clearances after this: +4.1 / +6.3 / +2.5 / +18 / +4.3. */
export const GATE_CLEARANCE: ClearanceCapability = {
  bodyRadius: BODY_RADIUS,
  band: { x: GATE.lanes[0].x0 - 40, z: GATE.bandZ0, w: GATE.lanes[2].x1 - GATE.lanes[0].x0 + 80, d: GATE.bandZ1 - GATE.bandZ0 },
  solids: [
    // pedestal bodies plus the 0.25 the lane-facing light lines stand proud of them
    ...GATE.pedestals.map((cx) => ({ x: cx - GATE.pedestal.w / 2 - 0.3, z: GATE.pedestal.zCentre - GATE.pedestal.d / 2, w: GATE.pedestal.w + 0.6, d: GATE.pedestal.d })),
    { x: GATE.bollard.x - GATE.bollard.r, z: GATE.pedestal.zCentre - GATE.bollard.r, w: 2 * GATE.bollard.r, d: 2 * GATE.bollard.r },
  ],
};

/** Footprint-free entity whose only job is to carry GATE_CLEARANCE into the navigation layer. */
export const GATE_CLEARANCE_ID = `${RECEPTION_ROOM_ID}/gate-clearance`;
function gateClearanceEntity(): Entity {
  return {
    id: GATE_CLEARANCE_ID,
    kind: "solid", // no view: the pedestals are static geometry, this is the logical half
    roomId: RECEPTION_ROOM_ID,
    transform: { pos: { x: AXIS, z: GATE.pedestal.zCentre }, yaw: 0 },
    capabilities: { clearance: GATE_CLEARANCE },
    props: {},
    source: { baked: true },
  };
}

/** South street façade. Plane and door span are both V1-grid-derived and are SHARED with Meeting/Project. */
export const FACADE = {
  z: FACADE_Z, // 1120 — north face of the band
  /** the V1 '+' door span (grid cols 40–49): the clear opening, exactly */
  door: { x0: 40 * CELL, x1: 50 * CELL }, // 640…800
  /** pilasters bracket the opening without narrowing it */
  pilasterW: 12,
  panelPitch: 38,
  /** vertical tubular pull handles, measured off the art */
  handleInset: 6,
};

/** Walkable floor region (world). Deliberately NOT the geometry:
 *   • north edge = the rect edge, so the three gate lanes (rows 52–56) are inside a walkable region and the
 *     V1 grid alone decides which of their cells are open;
 *   • west/east  = the FULL rect width — Reception has no side walls, and the rect abuts (never overlaps)
 *     Meeting's and Project's interiorRects, so region priority stays unambiguous;
 *   • south edge = the sidewalk rect's north edge, so the entry threshold hands off to exterior:sidewalk
 *     with no gap (cell row 72 centre z=1160 → Reception, row 73 centre z=1176 → sidewalk).
 *  The east/west transitions stay closed at the REGION layer until Meeting/Project are reconstructed —
 *  no geometry blocks them, and none may be invented. */
const SIDEWALK_Z0 = 1161.23;
export const FLOOR_RECT: Rect = { x: RECT.x, z: RECT.z, w: RECT.w, d: SIDEWALK_Z0 - RECT.z };

/** The tiled interior plate: full rect width (so it meets Meeting's and Project's plates with no gap),
 *  from the rect's north edge to the façade plane. */
export const TILE_RECT: Rect = { x: RECT.x, z: RECT.z, w: RECT.w, d: FACADE.z - RECT.z };

/** RECEPTION'S PHYSICAL ARCHITECTURE, as pure data for derived navigation (7C).
 *
 *  Reception has NO side walls and no north wall — the room is bounded by a waist-high glass BALUSTRADE on
 *  the gate line and by the street façade on the south, and that is all. Only what physically stands in the
 *  room is declared here; nothing is invented to make the room look enclosed, because nothing else is there.
 *
 *    • balustrade — two glass runs on the gate plane (z 890), t = wallThickness/2, stopping at `glassEnd`
 *      either side so the gate cluster fills the middle. The three '+' LANES between the pedestals are left
 *      wide open: they are the way in, and the pedestals below are what narrows them.
 *    • façade     — the south glass wall on FACADE.z, broken by the V1 door span. The two leaves are the
 *      entry door's own solids (automatic, so parked); the pilasters are already in its clearance band.
 *
 *  Every number is the one build/reception.ts extrudes. Nothing is measured off a mesh. */
export const RECEPTION_WALLS: Rect[] = (() => {
  const T = STRUCT.wallThickness;
  const railT = T * 0.5;
  const xEast = RECT.x + RECT.w;
  return [
    // north glass balustrade, west and east of the gate cluster
    { x: RECT.x, z: GATE.z - railT / 2, w: GATE.glassEnd.west - RECT.x, d: railT },
    { x: GATE.glassEnd.east, z: GATE.z - railT / 2, w: xEast - GATE.glassEnd.east, d: railT },
    // south street façade, either side of the V1 door span
    { x: RECT.x, z: FACADE.z, w: FACADE.door.x0 - RECT.x, d: T },
    { x: FACADE.door.x1, z: FACADE.z, w: xEast - FACADE.door.x1, d: T },
  ];
})();

export const RECEPTION_ROOM: RoomDef = {
  id: RECEPTION_ROOM_ID,
  name: "Reception",
  rect: RECT,
  floorRect: FLOOR_RECT,
  wallSolids: RECEPTION_WALLS,
  // no `shell`: ShellSpec describes the Design Room's shape (solid north+west, glass east, low south band).
  // Reception is the inverse — glass north, glass south, nothing east or west — so it supplies its own
  // static builder instead of forcing a union onto ShellSpec. See build/reception.ts.
};

// ============================= 3C PRIMARY FORMS =================================================
// Positions come from TWO sources used together: the V1 walkability grid (authoritative for gameplay)
// and the artwork measured at 0.18285 units/px. Where they disagree the SILHOUETTE follows the artwork
// and the grid keeps deciding navigation — geometry never defines walkability.

/** THE HERO: the arc reception counter.
 *  Circle fitted to the V1 blocked cells (8 independent columns, ±3 units) gave centre (720, 880).
 *  A radial scan of the artwork from that centre then measured the visible bands directly:
 *      bronze fascia   r 174 … 196   (rock-steady across ±30°)
 *      white worktop   r ~144 … 173
 *  The grid's blocked footprint reaches r ≈ 210 — that outer 36 units is the LED cove wash plus staff
 *  clearance V1 baked in, NOT counter. Building to it would make the counter bulky and wrong, so the
 *  VISIBLE counter is the measured 144…176 ring and the grid keeps its larger block.
 *  The bronze band in plan (174…196) is the fascia's HEIGHT seen in projection, not extra depth. */
export const COUNTER = {
  centre: { x: AXIS, z: 880 },
  /** worktop ring; 2 units of outer overhang past the fascia for a crisp shadow line */
  innerR: 144,
  outerR: 176,
  fasciaR: 173,
  /** recessed toe-kick / cove — structural only in 3C, ready for emissive treatment in 3D */
  toeR: 165,
  toeH: 4.5,
  topY: 27, // transaction height; the Design Room's desks are 24
  topT: 3,
  /** ±60° from due south. Measured tips (578, 966) and (877, 969) → mean offset 149.5 / 87.5 → 59.7° */
  halfAngleDeg: 60,
};

type Chair = { x: number; z: number; w: number; d: number; facing: "north" | "south" };
/** One lounge composition, given for the WEST side; the east side is this mirrored about AXIS.
 *  Sofa and north armchair are measured connected components; the north armchair centre (475, 1018)
 *  matches V1 seatDirections' (477.82, 1017.45) to within 3 units. South armchairs and table centres
 *  come from V1 seatDirections + the gap between the measured chairs. */
/** The glazing's innermost surface: the façade run is centred on FACADE.z + T/2 and its mullion posts are
 *  T·1.35 deep, so nothing in the lounge may reach past this or it is standing inside the glass wall. */
export const FACADE_INNER_Z = FACADE_Z + STRUCT.wallThickness / 2 - (STRUCT.wallThickness * 1.35) / 2; // 1118.95

export const LOUNGE_WEST = {
  // DRAWN z 1010…1122, i.e. 3 units through the glazing's inner face (1118.95) — the same baked-perspective
  // southward projection the south armchair shows. Pulled north 5 so the sofa BACKS ON to the façade (as the
  // artwork reads) instead of piercing it; depth, width and x are the measured ones.
  sofa: { x: 385, z: 1005, w: 50, d: 112 },
  chairs: [
    { x: 475, z: 1019, w: 46, d: 46, facing: "south" }, // olive z 995…1043; faces the table
    { x: 478, z: 1097, w: 44, d: 44, facing: "north" }, // see BAKED_PERSPECTIVE note below
  ] as Chair[],
  // DRAWN at z 1045…1090 (r 22.5) between armchairs drawn at 995…1043 and 1108…1152 — an 18-unit gap to the
  // south chair. Pulling that chair north to 1075…1119 (below) closes the real gap to 37.1 units, so the
  // painted table no longer fits: at r 21 its top overhung the south chair's cushion. Recentred in the gap
  // the chairs actually leave and sized to it, keeping ~2.5 units clear of each chair's front lip.
  table: { x: 477, z: 1058.5, r: 16 },
};
/** The south armchairs are DRAWN at z 1108…1152 — through the façade plane at 1120. That overhang is the
 *  flat render's baked perspective (objects south of the image centre project southward over the wall),
 *  flagged as an ambiguity in the 3A assessment. In true 3D the chair is pulled north to z 1075…1119 so it
 *  stands inside the building; its silhouette then sits ~1 V1 cell north of the painted one. */

/** Dark screened totem west of the counter, and the two tall cylindrical planters that flank the arc.
 *  NOTE: the planters are NOT a mirrored pair in the source — the west one shares the kiosk's column
 *  (x 542…572) while the east one stands free at x 880…914. Measured positions are kept rather than
 *  forced, because faking symmetry here would visibly detach the west planter from its totem. */
export const KIOSK = { x: 550, z: 1016, w: 36, d: 62, h: 32 };
export const PLANTERS = [
  // measured column centre is 554; nudged 4 units west so the pot clears the arc's west tip (569, 967)
  { x: 550, z: 964, r: 16, h: 30 }, // west, on the kiosk column
  { x: 897, z: 964, r: 16, h: 30 }, // east, free-standing
];

// Lane approach volumes (the '+' lane span, widened a little, running the full gate band plus a short
// approach on each side). Pedestal i borders lanes i-1 and i.
// Margins are asymmetric: 26 units of approach on the HALL side (you are walking at the gates), but only 12
// on the Reception side. Measured: a symmetric 26 lit three gates for someone merely walking PAST the bank
// along the first interior circulation row (z 936) without entering any lane. 12 keeps the immediate
// threshold row (z 920) triggering while that parallel pass-by stays blue.
const laneZone = (i: number): Rect => ({ x: GATE.lanes[i].x0 - 6, z: GATE.bandZ0 - 26, w: GATE.lanes[i].x1 - GATE.lanes[i].x0 + 12, d: GATE.bandZ1 - GATE.bandZ0 + 38 });
/** gate index → the lane rects that light it */
export const GATE_ZONES: Rect[][] = [[laneZone(0)], [laneZone(0), laneZone(1)], [laneZone(1), laneZone(2)], [laneZone(2)]];
/** the entrance mat: the door span seen from BOTH sides — the inside approach, the threshold, and the
 *  sidewalk stand cells (V1 grid rows 75–76), because a door sensor sees people coming either way */
export const ENTRY_ZONE: Rect = { x: FACADE.door.x0 - 4, z: FACADE.z - 20, w: FACADE.door.x1 - FACADE.door.x0 + 8, d: 100 };

// ---- 3E.1: the automatic bi-parting glass entrance --------------------------------------------------
/** The leaf track plane. The two panels run along the OUTSIDE face of the façade, south of the pilasters
 *  (which are 11.4 deep, z 1117.3…1128.7) — the only plane where a parked leaf clears them AND lands over
 *  V1-blocked cells (grid row 70, cols 35–39 / 50–54), so a parked panel can never be walked into. */
export const ENTRY_DOOR_Z = 1130.2;
/** each panel is half the V1 opening and slides its own full width, so the '+' span opens completely */
export const ENTRY_LEAF_W = (FACADE.door.x1 - FACADE.door.x0) / 2; // 80
export const ENTRY_LEAF_CLOSED = {
  west: { x: FACADE.door.x0 + ENTRY_LEAF_W / 2, z: ENTRY_DOOR_Z }, // 680
  east: { x: FACADE.door.x1 - ENTRY_LEAF_W / 2, z: ENTRY_DOOR_Z }, // 760
};
export const ENTRY_DOOR_WEST_ID = `${RECEPTION_ROOM_ID}/entry-door-west`;
export const ENTRY_DOOR_EAST_ID = `${RECEPTION_ROOM_ID}/entry-door-east`;

export const ENTRY_DOOR: DoorCapability = {
  slide: { x: -1, z: 0 }, // the WEST panel drives; the east one mirrors it (SlidingDoor `opposed`)
  slideDistance: ENTRY_LEAF_W,
  automatic: true,
  /** the two panels where they rest CLOSED, spanning the V1 opening between them */
  leaf: { x: ENTRY_LEAF_CLOSED.west.x - ENTRY_LEAF_W / 2, z: ENTRY_DOOR_Z - STRUCT.wallThickness / 2, w: ENTRY_LEAF_W, d: STRUCT.wallThickness },
  leafOpposed: { x: ENTRY_LEAF_CLOSED.east.x - ENTRY_LEAF_W / 2, z: ENTRY_DOOR_Z - STRUCT.wallThickness / 2, w: ENTRY_LEAF_W, d: STRUCT.wallThickness },
  /** the doorway itself: while a body overlaps this the door must be open and may not close */
  crossing: { x: FACADE.door.x0 - 4, z: ENTRY_DOOR_Z - 18, w: FACADE.door.x1 - FACADE.door.x0 + 8, d: 42 },
  /** approach region. At 30 units/s a body covers the 70-unit approach in 2.3 s and the leaves take 0.9 s,
   *  so the opening is complete well before anyone reaches the threshold. Being INSIDE this is not enough —
   *  SlidingDoor also requires the remaining route to pass through the doorway, so a pass-by never triggers. */
  trigger: { x: FACADE.door.x0 - 40, z: ENTRY_DOOR_Z - 72, w: FACADE.door.x1 - FACADE.door.x0 + 80, d: 150 },
  clearance: {
    bodyRadius: BODY_RADIUS,
    band: { x: FACADE.door.x0, z: FACADE.z, w: FACADE.door.x1 - FACADE.door.x0, d: 5 * CELL }, // the V1 '+' band
    solids: [
      { x: FACADE.door.x0 - FACADE.pilasterW, z: FACADE.z, w: FACADE.pilasterW, d: STRUCT.wallThickness },
      { x: FACADE.door.x1, z: FACADE.z, w: FACADE.pilasterW, d: STRUCT.wallThickness },
    ],
  },
  timings: { openMs: 900, closeMs: 1100, holdMs: 700 },
};

/** The two glass panels as world entities, so SceneMirror gives each a view the door controller can move. */
export function entryDoorEntities(): Entity[] {
  const common = { kind: "glass-door-leaf", roomId: RECEPTION_ROOM_ID, source: { baked: true } as const };
  return [
    {
      ...common, id: ENTRY_DOOR_WEST_ID,
      transform: { pos: { ...ENTRY_LEAF_CLOSED.west }, yaw: 0 },
      capabilities: { door: ENTRY_DOOR },
      props: { w: ENTRY_LEAF_W, h: STRUCT.wallHeight, handle: 1 }, // handle on the leading (east) stile
    },
    {
      ...common, id: ENTRY_DOOR_EAST_ID,
      transform: { pos: { ...ENTRY_LEAF_CLOSED.east }, yaw: 0 },
      capabilities: {},
      props: { w: ENTRY_LEAF_W, h: STRUCT.wallHeight, handle: -1 },
    },
  ];
}

/** The Offshorly floor inlay's region, in the staff pocket north of the counter.
 *  Identified in 3D by measuring the painted logo (x 661.3…801.7, z 950.9…971.0). The lockup itself keeps
 *  the brand SVG's own aspect (never distorted) and is centred here, so it spans a little more in z than the
 *  painted one — the flat art's lockup is squashed relative to the real asset.
 *  Verified clear of the counter: every corner lies inside the arc's staff pocket (r < 144 from (720,880)). */
export const LOGO_AREA: Rect = { x: 659, z: 938, w: 144, d: 46 };

/** mirror a world x about the composition axis */
export const mirrorX = (x: number): number => 2 * AXIS - x;

function furnitureEntity(id: string, kind: string, x: number, z: number, w: number, d: number, facing: string, mirrored = false): Entity {
  return {
    id: `${RECEPTION_ROOM_ID}/${id}`,
    kind,
    roomId: RECEPTION_ROOM_ID,
    transform: { pos: { x, z }, yaw: 0 },
    footprint: kindFootprint(kind, w, d),
    capabilities: {},
    props: { w, d, facing, mirrored, tone: "lounge" },
  };
}

// ============================= 3E.3 INTERACTIONS =================================================
// Every approach point below is a REAL V1-walkable cell whose body circle (r 10.5) clears the thing it
// serves — measured, not chosen by eye. Nothing here adds a framework: the counter and kiosk use the
// `approach` capability (interact/Approach.ts) and the lounge chairs reuse the Design Room's `seat`
// capability and SeatInteraction unchanged.

/** Visitor side of the hero counter: V1 stand cell (col 45, row 68). 216 from the arc centre against a
 *  176 outer radius → 29.5 of body clearance. Faces north, into the counter. */
export const COUNTER_APPROACH: ApproachCapability = {
  point: { x: 45 * CELL + 8, z: 68 * CELL + 8 }, // (728, 1096)
  yaw: FACING_YAW.north,
  label: "Reception desk",
  action: "Ask at reception",
};

/** In front of the kiosk's screen (which faces south). Row 66 col 34 → 6.5 clear of the totem. */
export const KIOSK_APPROACH: ApproachCapability = {
  point: { x: 34 * CELL + 8, z: 66 * CELL + 8 }, // (552, 1064)
  yaw: FACING_YAW.north,
  label: "Check-in kiosk",
  action: "Use kiosk",
};

/** THE KIOSK'S DETECTION ZONE — the floor an employee stands on to use it, measured around its own
 *  approach point above. The SAME read-only proximity test the gates and the Meeting terminal use
 *  (app/world.ts updateScanners), so the kiosk's status lamp rests BLUE like everything else and only
 *  answers while somebody is actually standing at it. Touches no navigation, no grid and no gameplay. */
export const KIOSK_ZONE: Rect = { x: KIOSK_APPROACH.point.x - 20, z: KIOSK_APPROACH.point.z - 16, w: 40, d: 36 };

/** FIXED lounge seating for a north tub chair, given for the WEST side; the east one mirrors about AXIS.
 *  The chair never moves — see interact/LoungeSeat.ts. Contact metadata is measured, not eyeballed:
 *
 *    tub chair build (build/furniture.ts): TUB_CUSHION_TOP, derived from the exported TUB_CHAIR dims
 *      so the metadata and the geometry can never drift apart
 *    the sitter's pelvis underside is placed on that surface by interact/seatContact.ts
 *
 *  `sink` is the soft-cushion compression a body makes in this upholstery. A tub cushion is deep foam, so
 *  a little sink reads correct; 0 would perch the avatar exactly on the undeformed surface. */
export const TUB_CUSHION_TOP_Y = TUB_CUSHION_TOP;
/** light foam compression: the pelvis settles this far into the cushion, so it reads as resting ON it */
export const TUB_SINK = 0.3;
function loungeSlot(mirror: boolean): LoungeSeatSlot {
  const m = (x: number) => (mirror ? mirrorX(x) : x);
  return {
    id: `lounge-${mirror ? "east" : "west"}-north`,
    // local z is toward the chair's BACK (placed() points local −z at `facing` = south)
    contactLocal: { x: 0, y: TUB_CUSHION_TOP_Y, z: 3.5 },
    seatedYaw: FACING_YAW.south,
    approach: { x: m(29 * CELL + 8), z: 61 * CELL + 8 }, // (472, 984) — a real V1 stand cell
    approachToSeat: [{ x: m(474), z: 996 }],
    sink: TUB_SINK,
    timings: { sitMs: 750, standMs: 700 },
  };
}
export const LOUNGE_SEATS: LoungeSeatCapability[] = [{ slots: [loungeSlot(false)] }, { slots: [loungeSlot(true)] }];

export const LOUNGE_SEAT_IDS = [`${RECEPTION_ROOM_ID}/tub-chair-west-0`, `${RECEPTION_ROOM_ID}/tub-chair-east-0`];

/** PHASE 6C — THE REST OF THE LOUNGE IS SITTABLE TOO: each sofa's two cushions and the south tub chair,
 *  on each side. Until now they were decorative by decision ("do not make every decorative object
 *  interactable"); the seating phase reverses that for anything a person can sit on. V1 already counts
 *  them as seats (seatDirections "reception-room": the sofas at 416/1024,1056 and the south chairs at
 *  480/960,1112), so this also closes a V1↔V2 gap: a V1 sitter there was drawn standing.
 *
 *  Contact metadata is the builders' own: the sofa is the SAME `sofa` builder the Executive Room's slots
 *  are measured against (SOFA_CUSHION_TOP / SOFA_CUSHION_LOCAL_X, cushions along local z at the builder's
 *  two-cushion spacing), the chair the same tub chair. The stand point for a sofa is the one V1-walkable
 *  strip between its front and the lounge table; each cushion's last waypoint is level with itself. */
const SOFA_CONTACT_FORWARD = 1.5;
const SOFA_SINK = 0.3;
/** the `sofa` builder's two-cushion centres along local z (lounge tone: 6.5-unit arms) */
function sofaCushionOffsets(d: number): number[] {
  const armW = 6.5, seats = 2;
  const cushD = (d - 2 * armW - (seats - 1) * SOFA_CUSHION_GAP - 2 * SOFA_CUSHION_MARGIN) / seats;
  return [-(cushD / 2 + 0.6), cushD / 2 + 0.6];
}
function sofaSlots(mirror: boolean): LoungeSeatCapability {
  const m = (x: number) => (mirror ? mirrorX(x) : x);
  const s = LOUNGE_WEST.sofa;
  const cz = s.z + s.d / 2;
  const side = mirror ? "east" : "west";
  return {
    slots: sofaCushionOffsets(s.d).map((lz, i) => ({
      id: `sofa-${side}-${i === 0 ? "north" : "south"}`,
      // the builder is authored back-to-west and the east piece is mirrored by its transform, so one local works for both
      contactLocal: { x: SOFA_CUSHION_LOCAL_X + SOFA_CONTACT_FORWARD, y: SOFA_CUSHION_TOP, z: lz },
      seatedYaw: mirror ? FACING_YAW.west : FACING_YAW.east, // authored fallback; data/seatFacing.json decides
      approach: { x: m(448), z: cz }, // the 26-unit strip between the sofa's front (x 435) and the table (x 461), clear of both tub chairs
      approachToSeat: [{ x: m(440), z: cz + lz }],
      sink: SOFA_SINK,
      timings: { sitMs: 750, standMs: 700 },
    })),
  };
}
function southChairSlot(mirror: boolean): LoungeSeatCapability {
  const m = (x: number) => (mirror ? mirrorX(x) : x);
  const c = LOUNGE_WEST.chairs[1];
  return {
    slots: [{
      id: `lounge-${mirror ? "east" : "west"}-south`,
      contactLocal: { x: 0, y: TUB_CUSHION_TOP_Y, z: 3.5 },
      seatedYaw: FACING_YAW.north, // the chair faces north, toward the table; the table decides
      approach: { x: m(c.x + 34), z: c.z }, // east of the chair, in the lane toward the kiosk column
      approachToSeat: [{ x: m(c.x + 24), z: c.z }],
      sink: TUB_SINK,
      timings: { sitMs: 750, standMs: 700 },
    }],
  };
}
export const RECEPTION_LOUNGE_IDS = [...LOUNGE_SEAT_IDS, `${RECEPTION_ROOM_ID}/sofa-west`, `${RECEPTION_ROOM_ID}/sofa-east`, `${RECEPTION_ROOM_ID}/tub-chair-west-1`, `${RECEPTION_ROOM_ID}/tub-chair-east-1`];

/** The two walk-up interaction points, as footprint-free entities carrying an `approach` capability.
 *  `pick` names the static scene group a click must hit to offer the action. */
export const COUNTER_INTERACTION_ID = `${RECEPTION_ROOM_ID}/counter-interaction`;
export const KIOSK_INTERACTION_ID = `${RECEPTION_ROOM_ID}/kiosk-interaction`;
function approachEntities(): Entity[] {
  const make = (id: string, pick: string, approach: ApproachCapability): Entity => ({
    id, kind: "solid", roomId: RECEPTION_ROOM_ID,
    transform: { pos: { ...approach.point }, yaw: approach.yaw },
    capabilities: { approach }, props: { pick }, source: { baked: true },
  });
  return [
    make(COUNTER_INTERACTION_ID, "reception-arc-counter", COUNTER_APPROACH),
    make(KIOSK_INTERACTION_ID, "reception-kiosk", KIOSK_APPROACH),
  ];
}

/** RECEPTION'S STATIC ARCHITECTURE AS LOGICAL SOLIDS (7C).
 *
 *  build/reception.ts draws these; until now navigation knew about none of them and leaned on the V1 grid's
 *  painted block. Each is authored from the SAME constant the builder extrudes.
 *
 *  The arc counter is a SECTOR, not a box — it is a 32-unit-deep ring segment sweeping ±60° about due
 *  south, and the staff pocket inside it is real floor V1 blocks wholesale. Compass bearings: due south is
 *  180°, so the counter spans 120°…240°. */
export function receptionArchitectureSolids(): Entity[] {
  const solid = (id: string, footprint: Entity["footprint"], x: number, z: number): Entity => ({
    id: `${RECEPTION_ROOM_ID}/${id}`, kind: "solid", roomId: RECEPTION_ROOM_ID,
    transform: { pos: { x, z }, yaw: 0 }, footprint, capabilities: {}, props: {}, source: { baked: true },
  });
  const rect = (id: string, r: Rect): Entity => solid(id, { shape: "rect", w: r.w, d: r.d }, r.x + r.w / 2, r.z + r.d / 2);
  const out: Entity[] = [
    solid("counter-solid", { shape: "sector", rIn: COUNTER.innerR, rOut: COUNTER.outerR, from: 180 - COUNTER.halfAngleDeg, to: 180 + COUNTER.halfAngleDeg }, COUNTER.centre.x, COUNTER.centre.z),
    rect("kiosk-solid", { x: KIOSK.x - KIOSK.w / 2, z: KIOSK.z - KIOSK.d / 2, w: KIOSK.w, d: KIOSK.d }),
  ];
  // the four speed-gate pedestals and the accessible lane's divider post — the same bodies GATE_CLEARANCE
  // already names, now as solids in their own right so the gate lanes are narrowed by geometry
  GATE.pedestals.forEach((cx, i) => out.push(rect(`gate-pedestal-${i}`, { x: cx - GATE.pedestal.w / 2, z: GATE.pedestal.zCentre - GATE.pedestal.d / 2, w: GATE.pedestal.w, d: GATE.pedestal.d })));
  out.push(solid("gate-bollard", { shape: "circle", r: GATE.bollard.r }, GATE.bollard.x, GATE.pedestal.zCentre));
  PLANTERS.forEach((p, i) => out.push(solid(`planter-pot-${i}`, { shape: "circle", r: p.r }, p.x, p.z)));
  return out;
}

/** Reception's 3C primary forms as world entities. The arc counter, kiosk and planter pots are static
 *  architecture-scale geometry (build/reception.ts); the lounge furniture and the two hero plants are
 *  entities so 3E can hang seat capabilities and the editor off them. */
export function receptionEntities(): Entity[] {
  const out: Entity[] = [...entryDoorEntities(), gateClearanceEntity(), ...approachEntities(), ...receptionArchitectureSolids()];
  for (const side of ["west", "east"] as const) {
    const m = side === "west" ? (v: number) => v : mirrorX;
    const s = LOUNGE_WEST.sofa;
    const sofaCx = m(s.x + s.w / 2);
    // the sofa builder is authored back-to-west; `mirrored` puts the east sofa's back on the east side
    const sofa = furnitureEntity(`sofa-${side}`, "sofa", sofaCx, s.z + s.d / 2, s.w, s.d, "south", side === "east");
    sofa.capabilities = { ...sofa.capabilities, lounge: sofaSlots(side === "east") }; // Phase 6C: two cushions each
    out.push(sofa);
    LOUNGE_WEST.chairs.forEach((c, i) => {
      const e = furnitureEntity(`tub-chair-${side}-${i}`, "tub-chair", m(c.x), c.z, c.w, c.d, c.facing);
      // both chairs are sittable (Phase 6C); the tables stay decorative
      e.capabilities = { ...e.capabilities, lounge: i === 0 ? LOUNGE_SEATS[side === "east" ? 1 : 0] : southChairSlot(side === "east") };
      out.push(e);
    });
    const t = LOUNGE_WEST.table;
    out.push(furnitureEntity(`table-${side}`, "round-table", m(t.x), t.z, 2 * t.r, 2 * t.r, "north"));
  }
  // the two hero plants standing IN the flanking planters (the pots themselves are static geometry)
  PLANTERS.forEach((p, i) =>
    out.push({
      id: `${RECEPTION_ROOM_ID}/planter-plant-${i}`,
      kind: "plant",
      roomId: RECEPTION_ROOM_ID,
      transform: { pos: { x: p.x, z: p.z }, yaw: 0 },
      capabilities: { sway: true },
      // fuller foliage than the Design Room's plants (source shows dense crowns); the tall pot is static geometry
      props: { r: 14, h: 34, hanging: false, y: p.h - 1.5, lush: 1.7, pot: false },
      source: { baked: true },
    }),
  );
  return out;
}
