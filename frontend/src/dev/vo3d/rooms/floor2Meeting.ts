// vo3d rooms — THE MEETING FLOOR's plan (data only, WORLD coordinates).
//
// ============================= THE COMPOSITION ==================================================
// One floor, composed on ONE AXIS: the lift opens at the centre of the west wall, and the arrival axis
// runs straight through the Commons to the boardroom's glass door at the east end. Everything is
// mirrored about that axis, so the floor balances north/south, and the two window bands are laid out
// symmetrically about the floor's centre line, so it balances east/west too.
//
//   z   12 ┌─────────┬┬───────┬┬─────┬┬───────┬┬─────────┐
//          │ HORIZON ││ ATLAS ││BIRCH││ MAPLE ││  VISTA  │   north window band — rooms between piers
//   z  290 ├─────────┴┴───────┴┴─────┴┴───────┴┴─────────┤
//          │                 NORTH STREET                 │
//   z  370 │ desks  [PINE]  café bar   ·   waiting lounge │ ┌────────┐
//          │                                           E  │ │        │
//   z  622 │[lift]══ arrival ══════ COMMONS ═════════ link═▶│ SUMMIT │   the arrival axis
//          │                                           I  │ │        │
//   z  874 │ nook   [REEF]  work bench  ·  window lounge  │ └────────┘
//          │                 SOUTH STREET                 │
//   z  954 ├─────────┬┬───────┬┬─────┬┬───────┬┬─────────┤
//          │ HARBOR  ││LAGOON ││TIDE ││ DELTA ││MERIDIAN │   south window band
//   z 1232 └─────────┴┴───────┴┴─────┴┴───────┴┴─────────┘
//
// ROOM FAMILIES: large 320 × 278 (8–10), standard 240 × 278 (6), compact 176 × 278 (4), huddle 150 × 170
// (2–3), and the boardroom, which is the axis' terminus and the floor's largest room. The window rooms are
// separated by solid plaster PIERS — built mass, not gaps — so each reads as a constructed room with its
// own glass front on the street, and the streets get an architectural rhythm.
//
// ============================= WHY THIS FILE IS DATA ===========================================
// Scheduled Meetings, room assignment, go-together, signage and room DND all need a STABLE room id, its
// door, where to stand outside, where to wait, every seat. The builder, the world's assembly and the
// stand test all READ this file; none of them re-measures anything.
import { pointInRect, type Facing, type Rect, type Vec2 } from "../core/coords";
import type { ApproachCapability, DoorCapability, Entity, LoungeSeatSlot, RoomDef, SeatCapability } from "../world/WorldState";
import { ARMCHAIR, CAFE_CHAIR, SOFA_CUSHION_LOCAL_X, SOFA_CUSHION_TOP, sofaCushionDepth, sofaCushionZ } from "../build/furniture";
import { MEETING_CHAIR_SEAT_TOP } from "../build/meetingChair";

/** Floor 2's plate origin (rooms/floor2.ts ORIGIN). A literal so this module stays a leaf. */
export const PLATE_ORIGIN: Vec2 = { x: 6000, z: 0 };
const OX = PLATE_ORIGIN.x, OZ = PLATE_ORIGIN.z;
const R = (x: number, z: number, w: number, d: number): Rect => ({ x: x + OX, z: z + OZ, w, d });
const P = (x: number, z: number): Vec2 => ({ x: x + OX, z: z + OZ });
const PLATE_ID = "floor-2";

/** THE ARRIVAL AXIS — the lift's door line, the Commons' centre line, the boardroom door. Local z. */
export const AXIS_Z = 622;

/** Interior glazing: frame depth and head height. The frame is a real 6-unit section (shoe, head, posts),
 *  so from above a glass wall reads as a constructed member, not a line. */
export const FRAME_D = 6;
export const GLASS_H = 46;
/** clear door opening, and the sliding leaf that closes it */
export const DOOR_W = 40;
export const LEAF_W = DOOR_W + 2;
/** the leaf rides this far OUTSIDE the wall's centre plane, clear of the frame, to slide past the glass */
export const LEAF_OFFSET = FRAME_D / 2 + 1.4;
const BODY_R = 8;

// ============================= CIRCULATION =======================================================

export const ZONES = {
  northStreet: R(12, 290, 1416, 80),
  southStreet: R(12, 874, 1416, 80),
  axis: R(90, AXIS_Z - 40, 1020, 80),
  eastLink: R(1040, 370, 70, 504),
  commons: R(400, 370, 640, 504),
} as const;

/** the stone runners — the floor itself drawing the main routes */
export const RUNNERS: Rect[] = [R(96, AXIS_Z - 26, 720 - 90 - 96, 52), R(720 + 90, AXIS_Z - 26, 1110 - 810, 52), R(12, 306, 1416, 48), R(12, 890, 1416, 48)];

/** THE PIERS between window rooms: solid plaster mass, full height, the streets' rhythm */
const PIER_XS: [number, number][] = [[332, 362], [602, 632], [808, 838], [1078, 1108]];
export const PIERS: Rect[] = PIER_XS.flatMap(([a, b]) => [R(a, 12, b - a, 278), R(a, 954, b - a, 278)]);

/** where people arrive, wait and gather */
export const COMMONS = {
  arrival: P(150, AXIS_Z),
  directory: { ...P(330, 560), facing: { x: -Math.SQRT1_2, z: Math.SQRT1_2 } },
  gather: [P(300, 650), P(360, 600), P(610, 600), P(830, 644), P(980, 600), P(1000, 650), P(1070, 420), P(1070, 830)],
} as const;

/** THE SOCIAL ISLAND — the floor's focal point, on the axis at the centre of the Commons: a round stone
 *  and walnut bench ring facing OUT, a planter ring inside it, and a slim lit information column at its
 *  heart, standing on a circular stone inlay. The one round thing on a floor of glass rectangles; the axis
 *  parts round it, which is what makes it a place rather than a corridor. */
export const ISLAND = { c: P(720, AXIS_Z), benchIn: 50, benchOut: 64, seatR: 57, planterR: 44, columnR: 10, inlayR: 86, seatTop: 12.6 };
export const ISLAND_SEATS = 6;

// ============================= ROOMS =============================================================

export type MeetingRoomKind = "huddle" | "standard" | "large" | "boardroom" | "project" | "lounge";
export type TableShape = "rect" | "boat" | "round" | "square" | "low";
export type ChairStyle = "task" | "lead" | "lounge";
export type BandStyle = "solid" | "dots" | "double";
export type RoomFinish = "stone" | "graphite";
export type Upholstery = "charcoal" | "stone" | "oat" | "cognac" | "olive";

export interface MeetingSeat { x: number; z: number; facing: Facing }

export interface MeetingDoor {
  side: Facing;
  from: number;
  to: number;
  centre: Vec2;
  out: Vec2;
  slide: Vec2;
  leafClosed: Vec2;
  opening: Rect;
  crossing: Rect;
  trigger: Rect;
}

export interface MeetingRoomSpec {
  /** stable identity: `floor-2/<slug>` — what Scheduled Meetings books, locks and signs against */
  id: string;
  name: string;
  kind: MeetingRoomKind;
  capacity: number;
  /** this room's meeting on the call store — same id ⇒ same call (backend `_MEETING_ID` rule) */
  meetingId: string;
  rect: Rect;
  interior: Rect;
  /** which of the room's four sides are GLASS (the rest are piers or the building's own walls) */
  glass: Facing[];
  door: MeetingDoor;
  approach: Vec2;
  entry: Vec2;
  sign: { x: number; z: number; facing: Facing };
  gather: Vec2[];
  table: { shape: TableShape; rect: Rect; tone: "oak" | "walnut" | "white" };
  seats: MeetingSeat[];
  chair: ChairStyle;
  finish: RoomFinish;
  upholstery: Upholstery;
  frame: "charcoal" | "bronze";
  band: BandStyle;
  /** the display; `mount: "wall"` hangs it on a solid pier, `"stand"` puts it on a media credenza */
  screen: { x: number; z: number; facing: Facing; w: number; mount: "wall" | "stand" };
  lounge?: { sofa: { rect: Rect; facing: Facing; seats: number; opens: Facing }; armchairs: MeetingSeat[] };
  /** a boardroom's side lounge: armchairs round a side table */
  corner?: { armchairs: MeetingSeat[]; table: Rect };
  pendant?: boolean;
  plants?: { x: number; z: number; r: number; h: number }[];
}

/** THE BODY'S YAW facing a direction: forward is +z at 0, so a body looking along (dx, dz) has yaw
 *  atan2(dx, dz). core/coords FACING_YAW mirrors east/west against this (see app/seats.ts seatFacingYaw):
 *  every east/west-facing seat authored through it sat looking backwards. Used for every seat and walk-up. */
export const bodyYaw = (f: Facing): number => ({ south: 0, north: Math.PI, east: Math.PI / 2, west: -Math.PI / 2 })[f];
const DIR: Record<Facing, Vec2> = { north: { x: 0, z: -1 }, south: { x: 0, z: 1 }, east: { x: 1, z: 0 }, west: { x: -1, z: 0 } };
const OPP: Record<Facing, Facing> = { north: "south", south: "north", east: "west", west: "east" };

function seatsAround(shape: TableShape, t: Rect, perSide: number, ends: 0 | 1, gap = 14): MeetingSeat[] {
  const out: MeetingSeat[] = [];
  const cx = t.x + t.w / 2, cz = t.z + t.d / 2;
  if (shape === "round") {
    const r = t.w / 2 + gap;
    for (let i = 0; i < perSide; i++) {
      const a = (i / perSide) * Math.PI * 2 + Math.PI / perSide;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const dx = cx - x, dz = cz - z;
      out.push({ x, z, facing: Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? "east" : "west") : dz > 0 ? "south" : "north" });
    }
    return out;
  }
  const alongX = t.w >= t.d;
  const len = alongX ? t.w : t.d;
  for (let i = 0; i < perSide; i++) {
    const s = (alongX ? t.x : t.z) + (len * (i + 0.5)) / perSide;
    if (alongX) out.push({ x: s, z: t.z - gap, facing: "south" }, { x: s, z: t.z + t.d + gap, facing: "north" });
    else out.push({ x: t.x - gap, z: s, facing: "east" }, { x: t.x + t.w + gap, z: s, facing: "west" });
  }
  if (ends) {
    if (alongX) out.push({ x: t.x - gap, z: cz, facing: "east" }, { x: t.x + t.w + gap, z: cz, facing: "west" });
    else out.push({ x: cx, z: t.z - gap, facing: "south" }, { x: cx, z: t.z + t.d + gap, facing: "north" });
  }
  return out;
}

type Draft = {
  slug: string; name: string; kind: MeetingRoomKind; capacity: number;
  rect: [number, number, number, number];
  glass: Facing[];
  door: Facing;
  table: { shape: TableShape; c: [number, number]; w: number; d: number; tone: "oak" | "walnut" | "white" };
  perSide: number; ends?: 0 | 1;
  seatsLocal?: MeetingSeat[];
  chair: ChairStyle; finish: RoomFinish; upholstery: Upholstery; frame: "charcoal" | "bronze"; band: BandStyle;
  screen: { x: number; z: number; facing: Facing; w: number; mount: "wall" | "stand" };
  lounge?: { sofa: { rect: [number, number, number, number]; facing: Facing; seats: number; opens: Facing }; armchairs: MeetingSeat[] };
  corner?: { armchairs: MeetingSeat[]; table: [number, number, number, number] };
  pendant?: boolean;
  plants?: { x: number; z: number; r: number; h: number }[];
};

/** the floor inside the walls: in from a glass side by half a frame, flush with a pier or the building */
function interiorOf(r: Rect, glass: Facing[]): Rect {
  const h = FRAME_D / 2;
  const x0 = r.x + (glass.includes("west") ? h : 0), x1 = r.x + r.w - (glass.includes("east") ? h : 0);
  const z0 = r.z + (glass.includes("north") ? h : 0), z1 = r.z + r.d - (glass.includes("south") ? h : 0);
  return { x: x0, z: z0, w: x1 - x0, d: z1 - z0 };
}

const loc = (p: MeetingSeat[]): MeetingSeat[] => p.map((s) => ({ ...s, x: s.x + OX, z: s.z + OZ }));

function finish(d: Draft): MeetingRoomSpec {
  const rect = R(...d.rect);
  const side = d.door;
  const horiz = side === "north" || side === "south";
  // EVERY DOOR IS CENTRED ON ITS FACADE, except the huddles', which open toward the Commons.
  const mid = horiz ? rect.x + rect.w / 2 + (d.kind === "huddle" ? 30 : 0) : rect.z + rect.d / 2;
  const from = mid - DOOR_W / 2, to = mid + DOOR_W / 2;
  const line = side === "north" ? rect.z : side === "south" ? rect.z + rect.d : side === "west" ? rect.x : rect.x + rect.w;
  const centre: Vec2 = horiz ? { x: mid, z: line } : { x: line, z: mid };
  const o = DIR[side];
  const along: Vec2 = horiz ? { x: 1, z: 0 } : { x: 0, z: 1 };
  const off = (k: number, a: number): Vec2 => ({ x: centre.x + o.x * k + along.x * a, z: centre.z + o.z * k + along.z * a });
  // the leaf parks toward the floor's centre line, the sign takes the other side of the door
  // THE LEAF PARKS WHERE THERE IS WALL FOR IT: toward the floor's centre line when both sides have room,
  // otherwise on the side that does. A huddle's off-centre door used to park its leaf — and hang its
  // track — past the room's own corner, out over the corridor.
  const lo = horiz ? rect.x : rect.z, hi = horiz ? rect.x + rect.w : rect.z + rect.d;
  const room = { minus: from - lo, plus: hi - to };
  const toward = horiz ? (mid < OX + 720 ? 1 : -1) : (mid < OZ + AXIS_Z ? 1 : -1);
  const parkSign = (toward > 0 ? room.plus : room.minus) >= LEAF_W + 4 ? toward : -toward;
  const slide: Vec2 = { x: along.x * parkSign, z: along.z * parkSign };
  const thick = (a: number): Rect => horiz ? { x: from, z: line - a, w: DOOR_W, d: 2 * a } : { x: line - a, z: from, w: 2 * a, d: DOOR_W };
  const t = d.table;
  const table = { shape: t.shape, rect: R(t.c[0] - t.w / 2, t.c[1] - t.d / 2, t.w, t.d), tone: t.tone };
  const seats = d.seatsLocal ? loc(d.seatsLocal) : seatsAround(t.shape, table.rect, d.perSide, d.ends ?? 0);
  const sign = off(FRAME_D / 2 + 0.2, -parkSign * (DOOR_W / 2 + 12));
  return {
    id: `floor-2/${d.slug}`, name: d.name, kind: d.kind, capacity: d.capacity, meetingId: `mf-${d.slug}`,
    rect, interior: interiorOf(rect, d.glass), glass: d.glass,
    door: {
      side, from, to, centre, out: o, slide, leafClosed: off(LEAF_OFFSET, 0),
      opening: thick(FRAME_D / 2 + 0.5), crossing: thick(13),
      trigger: horiz ? { x: from - 16, z: line - 52, w: DOOR_W + 32, d: 104 } : { x: line - 52, z: from - 16, w: 104, d: DOOR_W + 32 },
    },
    approach: off(32, 0), entry: off(-30, 0),
    sign: { x: sign.x, z: sign.z, facing: side },
    gather: [off(36, -parkSign * 46), off(36, parkSign * 54), off(58, -parkSign * 16)],
    table, seats, chair: d.chair, finish: d.finish, upholstery: d.upholstery, frame: d.frame, band: d.band,
    screen: { ...d.screen, x: d.screen.x + OX, z: d.screen.z + OZ },
    lounge: d.lounge ? { sofa: { ...d.lounge.sofa, rect: R(...d.lounge.sofa.rect) }, armchairs: loc(d.lounge.armchairs) } : undefined,
    corner: d.corner ? { armchairs: loc(d.corner.armchairs), table: R(...d.corner.table) } : undefined,
    pendant: d.pendant,
    plants: d.plants?.map((p) => ({ ...p, x: p.x + OX, z: p.z + OZ })),
  };
}

// the two window bands, mirrored: north rooms open SOUTH onto the North Street, south rooms open NORTH
const NB = 12, ND = 278, SB = 954;
const DRAFTS: Draft[] = [
  // ---- north window band -----------------------------------------------------------------------------
  { slug: "alpha", name: "Alpha", kind: "large", capacity: 10, rect: [12, NB, 320, ND], glass: ["south"], door: "south",
    table: { shape: "rect", c: [160, 140], w: 190, d: 60, tone: "oak" }, perSide: 4, ends: 1, chair: "task",
    finish: "stone", upholstery: "cognac", frame: "charcoal", band: "solid", pendant: true,
    screen: { x: 330, z: 140, facing: "west", w: 76, mount: "wall" }, plants: [{ x: 36, z: 36, r: 8, h: 34 }] },
  { slug: "bravo", name: "Bravo", kind: "standard", capacity: 6, rect: [362, NB, 240, ND], glass: ["south"], door: "south",
    table: { shape: "boat", c: [470, 140], w: 150, d: 56, tone: "walnut" }, perSide: 3, chair: "task",
    finish: "stone", upholstery: "stone", frame: "charcoal", band: "double",
    screen: { x: 600, z: 140, facing: "west", w: 60, mount: "wall" } },
  { slug: "charlie", name: "Charlie", kind: "standard", capacity: 4, rect: [632, NB, 176, ND], glass: ["south"], door: "south",
    table: { shape: "rect", c: [720, 136], w: 52, d: 100, tone: "white" }, perSide: 2, chair: "task",
    finish: "stone", upholstery: "charcoal", frame: "charcoal", band: "dots",
    screen: { x: 720, z: 24, facing: "south", w: 56, mount: "stand" } },
  { slug: "lima", name: "Lima", kind: "standard", capacity: 6, rect: [838, NB, 240, ND], glass: ["south"], door: "south",
    table: { shape: "boat", c: [970, 140], w: 150, d: 56, tone: "oak" }, perSide: 3, chair: "task",
    finish: "stone", upholstery: "cognac", frame: "charcoal", band: "double",
    screen: { x: 840, z: 140, facing: "east", w: 60, mount: "wall" } },
  { slug: "echo", name: "Echo", kind: "project", capacity: 10, rect: [1108, NB, 320, ND], glass: ["south"], door: "south",
    table: { shape: "rect", c: [1280, 140], w: 190, d: 60, tone: "white" }, perSide: 4, ends: 1, chair: "task",
    finish: "graphite", upholstery: "olive", frame: "bronze", band: "solid", pendant: true,
    screen: { x: 1110, z: 140, facing: "east", w: 84, mount: "wall" }, plants: [{ x: 1404, z: 36, r: 8, h: 34 }] },

  // ---- the middle: two huddles flanking the arrival, and the boardroom closing the axis --------------
  { slug: "foxtrot", name: "Foxtrot", kind: "huddle", capacity: 3, rect: [110, 370, 150, 170], glass: ["north", "south", "east", "west"], door: "south",
    table: { shape: "round", c: [170, 452], w: 40, d: 40, tone: "oak" }, perSide: 3, chair: "task",
    finish: "stone", upholstery: "olive", frame: "charcoal", band: "dots",
    screen: { x: 248, z: 452, facing: "west", w: 44, mount: "stand" } },
  { slug: "golf", name: "Golf", kind: "huddle", capacity: 2, rect: [110, 704, 150, 170], glass: ["north", "south", "east", "west"], door: "north",
    table: { shape: "square", c: [170, 796], w: 40, d: 40, tone: "walnut" }, perSide: 0, chair: "task",
    seatsLocal: [{ x: 170, z: 796 - 34, facing: "south" }, { x: 170, z: 796 + 34, facing: "north" }],
    finish: "stone", upholstery: "olive", frame: "charcoal", band: "dots",
    screen: { x: 248, z: 796, facing: "west", w: 44, mount: "stand" } },
  { slug: "hotel", name: "Hotel", kind: "boardroom", capacity: 14, rect: [1110, 370, 318, 504], glass: ["north", "south", "west"], door: "west",
    table: { shape: "boat", c: [1290, 596], w: 72, d: 280, tone: "walnut" }, perSide: 6, ends: 1, chair: "lead",
    finish: "graphite", upholstery: "charcoal", frame: "bronze", band: "double", pendant: true,
    screen: { x: 1290, z: 385, facing: "south", w: 96, mount: "stand" },
    corner: { armchairs: [{ x: 1180, z: 836, facing: "north" }, { x: 1250, z: 836, facing: "north" }], table: [1203, 826, 24, 20] },
    plants: [{ x: 1404, z: 850, r: 9, h: 40 }, { x: 1140, z: 396, r: 7, h: 32 }] },

  // ---- south window band (mirrors the north) ---------------------------------------------------------
  { slug: "india", name: "India", kind: "large", capacity: 8, rect: [12, SB, 320, ND], glass: ["north"], door: "north",
    table: { shape: "boat", c: [160, 1094], w: 180, d: 60, tone: "walnut" }, perSide: 3, ends: 1, chair: "task",
    finish: "stone", upholstery: "charcoal", frame: "charcoal", band: "solid", pendant: true,
    screen: { x: 330, z: 1094, facing: "west", w: 72, mount: "wall" }, plants: [{ x: 36, z: 1208, r: 8, h: 34 }] },
  { slug: "juliett", name: "Juliett", kind: "standard", capacity: 6, rect: [362, SB, 240, ND], glass: ["north"], door: "north",
    table: { shape: "boat", c: [470, 1094], w: 150, d: 56, tone: "oak" }, perSide: 3, chair: "task",
    finish: "stone", upholstery: "stone", frame: "charcoal", band: "double",
    screen: { x: 600, z: 1094, facing: "west", w: 60, mount: "wall" } },
  { slug: "kilo", name: "Kilo", kind: "lounge", capacity: 4, rect: [632, SB, 176, ND], glass: ["north"], door: "north",
    table: { shape: "low", c: [720, 1110], w: 56, d: 34, tone: "oak" }, perSide: 0, chair: "lounge", seatsLocal: [],
    finish: "graphite", upholstery: "cognac", frame: "bronze", band: "dots",
    screen: { x: 720, z: 1220, facing: "north", w: 56, mount: "stand" },
    lounge: { sofa: { rect: [670, 1030, 100, 36], facing: "east", seats: 2, opens: "south" }, armchairs: [{ x: 666, z: 1160, facing: "east" }, { x: 774, z: 1160, facing: "west" }] } },
  { slug: "delta", name: "Delta", kind: "standard", capacity: 6, rect: [838, SB, 240, ND], glass: ["north"], door: "north",
    table: { shape: "round", c: [966, 1098], w: 84, d: 84, tone: "walnut" }, perSide: 6, chair: "task",
    finish: "stone", upholstery: "oat", frame: "charcoal", band: "solid",
    screen: { x: 840, z: 1098, facing: "east", w: 60, mount: "wall" } },
  { slug: "mike", name: "Mike", kind: "large", capacity: 8, rect: [1108, SB, 320, ND], glass: ["north"], door: "north",
    table: { shape: "boat", c: [1280, 1094], w: 180, d: 60, tone: "oak" }, perSide: 3, ends: 1, chair: "lead",
    finish: "graphite", upholstery: "stone", frame: "charcoal", band: "double", pendant: true,
    screen: { x: 1110, z: 1094, facing: "east", w: 72, mount: "wall" }, plants: [{ x: 1404, z: 1208, r: 8, h: 34 }] },
];

export const MEETING_ROOMS: readonly MeetingRoomSpec[] = DRAFTS.map(finish);

/** ROOM DETAILS, derived from each room's own layout: a low walnut credenza under the window of every
 *  window room whose display is on a pier (the window wall is free), and a framed artwork on the pier
 *  opposite the display. Nothing is placed where a chair pulls out. */
export interface RoomDetails { credenza?: Rect; art?: { x: number; z: number; facing: Facing; w: number } }
export const ROOM_DETAILS: ReadonlyMap<string, RoomDetails> = new Map(MEETING_ROOMS.map((r): [string, RoomDetails] => {
  const d: RoomDetails = {};
  const north = r.rect.z - OZ < 100, south = r.rect.z + r.rect.d - OZ > 1200;
  const cx = r.table.rect.x + r.table.rect.w / 2;
  if ((north || south) && r.screen.mount === "wall") d.credenza = north ? { x: cx - 36, z: r.rect.z + 4, w: 72, d: 12 } : { x: cx - 36, z: r.rect.z + r.rect.d - 16, w: 72, d: 12 };
  if (r.id === "floor-2/hotel") d.credenza = { x: r.rect.x + r.rect.w - 16, z: r.rect.z + 100, w: 12, d: 250 };
  const piers = PIER_XS.map(([a, b]) => [a + OX, b + OX]);
  const onPier = (x: number): boolean => piers.some(([a, b]) => Math.abs(x - a) < 1 || Math.abs(x - b) < 1);
  const west = r.rect.x, east = r.rect.x + r.rect.w, midZ = r.rect.z + r.rect.d / 2;
  if (r.screen.mount === "wall" && r.screen.facing === "west" && onPier(west)) d.art = { x: west, z: midZ, facing: "east", w: 56 };
  else if (r.screen.mount === "wall" && r.screen.facing === "east" && onPier(east)) d.art = { x: east, z: midZ, facing: "west", w: 56 };
  else if (r.screen.mount === "stand" && onPier(west)) d.art = { x: west, z: midZ, facing: "east", w: 48 };
  return [r.id, d];
}));
export const meetingRoom = (id: string): MeetingRoomSpec | undefined => MEETING_ROOMS.find((r) => r.id === id);
export const meetingRoomAt = (p: Vec2): MeetingRoomSpec | null => MEETING_ROOMS.find((r) => pointInRect(p, r.interior)) ?? null;
export const MEETING_ROOM_IDS: ReadonlySet<string> = new Set(MEETING_ROOMS.map((r) => r.id));

// ============================= THE COMMONS AND THE SECONDARY SPACES ============================

export type Amenity =
  | { id: string; kind: "sofa"; rect: Rect; facing: Facing; seats: number; opens: Facing; color: string }
  | { id: string; kind: "armchair"; seat: MeetingSeat; color: string }
  | { id: string; kind: "lounge-table" | "side-table"; rect: Rect }
  | { id: string; kind: "rug"; rect: Rect }
  | { id: string; kind: "plant"; c: Vec2; r: number; h: number }
  | { id: string; kind: "column"; c: Vec2 }
  | { id: string; kind: "backbar" | "counter" | "shelf" | "feature-wall"; rect: Rect; facing: Facing }
  | { id: string; kind: "planter"; rect: Rect }
  | { id: string; kind: "screen"; rect: Rect }
  | { id: string; kind: "cabinet"; rect: Rect }
  | { id: string; kind: "cafe-table"; c: Vec2; chairs: MeetingSeat[] }
  | { id: string; kind: "worktable"; rect: Rect; chairs: MeetingSeat[] }
  | { id: string; kind: "desk"; rect: Rect; chair: MeetingSeat }
  | { id: string; kind: "glow"; rect: Rect };

/** THE COMMONS is four quarters about the axis, each with a job, framed by four structural columns:
 *    NW  the CAFÉ BAR — back bar with coffee machine, water and snacks; a standing counter; café tables
 *    NE  the WAITING LOUNGE — sofa, armchairs, a low table, before a meeting
 *    SW  the WORK BENCH — a shared touchdown table for a laptop between meetings
 *    SE  the WINDOW LOUNGE — soft seating to decompress after one
 *  The west pockets by the lift carry two touchdown desks (north) and a reading nook (south). Nothing
 *  stands on a street, the axis or the East Link. */
export const AMENITIES: Amenity[] = [
  // structure
  { id: "column-nw", kind: "column", c: P(420, 392) },
  { id: "column-ne", kind: "column", c: P(1020, 392) },
  { id: "column-sw", kind: "column", c: P(420, 852) },
  { id: "column-se", kind: "column", c: P(1020, 852) },
  // NW — café bar
  { id: "backbar", kind: "backbar", rect: R(450, 374, 240, 18), facing: "south" },
  { id: "counter", kind: "counter", rect: R(470, 452, 200, 18), facing: "north" },
  { id: "cafe-0", kind: "cafe-table", c: P(500, 532), chairs: [{ ...P(478, 532), facing: "east" }, { ...P(522, 532), facing: "west" }] },
  { id: "cafe-1", kind: "cafe-table", c: P(640, 532), chairs: [{ ...P(618, 532), facing: "east" }, { ...P(662, 532), facing: "west" }] },
  { id: "cafe-wall", kind: "feature-wall", rect: R(446, 366, 248, 5), facing: "south" },
  // NE — waiting lounge
  { id: "rug-ne", kind: "rug", rect: R(772, 396, 226, 156) },
  { id: "sofa-ne", kind: "sofa", rect: R(800, 402, 170, 36), facing: "east", seats: 3, opens: "south", color: "mfCharcoal" },
  { id: "table-ne", kind: "lounge-table", rect: R(843, 462, 84, 40) },
  { id: "armchair-ne-w", kind: "armchair", seat: { ...P(818, 530), facing: "north" }, color: "mfCognac" },
  { id: "armchair-ne-e", kind: "armchair", seat: { ...P(952, 530), facing: "north" }, color: "mfCognac" },
  { id: "planter-ne", kind: "planter", rect: R(826, 562, 168, 12) },
  // SW — the work bench
  { id: "rug-sw", kind: "rug", rect: R(444, 712, 236, 136) },
  { id: "bench-table", kind: "worktable", rect: R(485, 752, 180, 40), chairs: [
    { ...P(515, 738), facing: "south" }, { ...P(575, 738), facing: "south" }, { ...P(635, 738), facing: "south" },
    { ...P(515, 806), facing: "north" }, { ...P(575, 806), facing: "north" }, { ...P(635, 806), facing: "north" }] },
  // SE — window lounge (mirrors the NE)
  { id: "rug-se", kind: "rug", rect: R(772, 692, 226, 156) },
  { id: "sofa-se", kind: "sofa", rect: R(800, 806, 170, 36), facing: "west", seats: 3, opens: "north", color: "mfStone" },
  { id: "table-se", kind: "lounge-table", rect: R(843, 742, 84, 40) },
  { id: "armchair-se-w", kind: "armchair", seat: { ...P(818, 714), facing: "south" }, color: "mfOlive" },
  { id: "armchair-se-e", kind: "armchair", seat: { ...P(952, 714), facing: "south" }, color: "mfOlive" },
  { id: "planter-se", kind: "planter", rect: R(826, 670, 168, 12) },
  // the west pockets beside the lift
  { id: "desk-0", kind: "desk", rect: R(18, 392, 26, 44), chair: { ...P(58, 414), facing: "west" } },
  { id: "desk-1", kind: "desk", rect: R(18, 470, 26, 44), chair: { ...P(58, 492), facing: "west" } },
  { id: "shelf-sw", kind: "shelf", rect: R(16, 720, 14, 90), facing: "east" },
  { id: "armchair-nook", kind: "armchair", seat: { ...P(66, 790), facing: "east" }, color: "mfCognac" },
  { id: "side-nook", kind: "side-table", rect: R(56, 826, 20, 20) },
  // landscaping, only in pockets: column feet, the lift's flanks, the room corners
  { id: "plant-col-nw", kind: "plant", c: P(446, 404), r: 8, h: 34 },
  { id: "plant-col-ne", kind: "plant", c: P(994, 404), r: 8, h: 34 },
  { id: "plant-col-sw", kind: "plant", c: P(446, 840), r: 8, h: 34 },
  { id: "plant-col-se", kind: "plant", c: P(994, 840), r: 8, h: 34 },
  { id: "plant-lift-n", kind: "plant", c: P(40, 560), r: 9, h: 40 },
  { id: "plant-lift-s", kind: "plant", c: P(40, 690), r: 9, h: 40 },
  { id: "plant-nook", kind: "plant", c: P(92, 856), r: 7, h: 30 },
  { id: "plant-desk", kind: "plant", c: P(30, 540), r: 6, h: 26 },
  // THE COMMONS' SCREENS — "rooms without walls": framed ribbed-glass screens in the bays between the posts,
  // backing the lounges and the work bench and flanking the axis, each open where a route comes in (the
  // axis at west and east, the street gaps north and south). Translucent, so the whole Commons stays in view.
  { id: "screen-n", kind: "screen", rect: R(774, 390, 224, 4) },
  { id: "screen-s", kind: "screen", rect: R(774, 850, 224, 4) },
  { id: "screen-sw", kind: "screen", rect: R(462, 850, 238, 4) },
  { id: "screen-wn", kind: "screen", rect: R(418, 404, 4, 156) },
  { id: "screen-ws", kind: "screen", rect: R(418, 684, 4, 156) },
  { id: "screen-en", kind: "screen", rect: R(1018, 404, 4, 156) },
  { id: "screen-es", kind: "screen", rect: R(1018, 684, 4, 156) },
  // the huddles' own finish: a low cabinet on the quiet wall, a plant in the free corner
  { id: "cabinet-foxtrot", kind: "cabinet", rect: R(120, 374, 80, 12) },
  { id: "plant-foxtrot", kind: "plant", c: P(126, 526), r: 5, h: 22 },
  { id: "cabinet-golf", kind: "cabinet", rect: R(120, 859, 80, 12) },
  { id: "plant-golf", kind: "plant", c: P(124, 720), r: 5, h: 22 },
  // Kilo (the lounge room): a rug under the soft seating
  { id: "rug-kilo", kind: "rug", rect: R(648, 1020, 144, 170) },
  // the four street ends: a tall plant closing each view down a street
  { id: "plant-nw-end", kind: "plant", c: P(30, 330), r: 9, h: 42 },
  { id: "plant-ne-end", kind: "plant", c: P(1410, 330), r: 9, h: 42 },
  { id: "plant-sw-end", kind: "plant", c: P(30, 914), r: 9, h: 42 },
  { id: "plant-se-end", kind: "plant", c: P(1410, 914), r: 9, h: 42 },
];

// ============================= COLLISION =========================================================

export type Solid = { rect: Rect } | { c: Vec2; r: number };

export interface GlassRun { axis: "x" | "z"; at: number; from: number; to: number; door?: { from: number; to: number }; frame: "charcoal" | "bronze"; band: BandStyle; roomId: string }

/** Each room's own glass sides only — piers and building walls are not glass. Rooms never share a side. */
export const GLASS_RUNS: readonly GlassRun[] = MEETING_ROOMS.flatMap((r) => {
  const x0 = r.rect.x, x1 = r.rect.x + r.rect.w, z0 = r.rect.z, z1 = r.rect.z + r.rect.d;
  const sides: Record<Facing, { axis: "x" | "z"; at: number; from: number; to: number }> = {
    north: { axis: "x", at: z0, from: x0, to: x1 }, south: { axis: "x", at: z1, from: x0, to: x1 },
    west: { axis: "z", at: x0, from: z0, to: z1 }, east: { axis: "z", at: x1, from: z0, to: z1 },
  };
  return r.glass.map((f) => ({ ...sides[f], frame: r.frame, band: r.band, roomId: r.id, ...(r.door.side === f ? { door: { from: r.door.from, to: r.door.to } } : {}) }));
});

export function runRects(g: GlassRun): Rect[] {
  const spans = g.door ? [[g.from, g.door.from], [g.door.to, g.to]] : [[g.from, g.to]];
  return spans.filter(([a, b]) => b - a > 0.5).map(([a, b]) =>
    g.axis === "x" ? { x: a, z: g.at - FRAME_D / 2, w: b - a, d: FRAME_D } : { x: g.at - FRAME_D / 2, z: a, w: FRAME_D, d: b - a });
}

/** the display's footprint: a credenza for a stand, a shallow wall unit for a wall mount */
export function screenRect(s: MeetingRoomSpec["screen"]): Rect {
  const horiz = s.facing === "north" || s.facing === "south";
  const w = s.w + 12, d = s.mount === "wall" ? 8 : 12;
  const c = s.mount === "wall" ? { x: s.x + DIR[s.facing].x * 4, z: s.z + DIR[s.facing].z * 4 } : s;
  return horiz ? { x: c.x - w / 2, z: c.z - d / 2, w, d } : { x: c.x - d / 2, z: c.z - w / 2, w: d, d: w };
}

const armRect = (a: MeetingSeat): Rect => ({ x: a.x - 16, z: a.z - 16, w: 32, d: 32 });

/** EVERYTHING THAT STOPS A BODY. Chairs are NOT solid — a body steps between them to sit. */
export const MEETING_FLOOR_SOLIDS: readonly Solid[] = (() => {
  const out: Solid[] = [];
  for (const g of GLASS_RUNS) for (const rect of runRects(g)) out.push({ rect });
  for (const rect of PIERS) out.push({ rect });
  for (const r of MEETING_ROOMS) {
    const t = r.table.rect;
    out.push(r.table.shape === "round" ? { c: { x: t.x + t.w / 2, z: t.z + t.d / 2 }, r: t.w / 2 + 1 } : { rect: { x: t.x - 1, z: t.z - 1, w: t.w + 2, d: t.d + 2 } });
    out.push({ rect: screenRect(r.screen) });
    if (r.lounge) { out.push({ rect: r.lounge.sofa.rect }); for (const a of r.lounge.armchairs) out.push({ rect: armRect(a) }); }
    if (r.corner) { out.push({ rect: r.corner.table }); for (const a of r.corner.armchairs) out.push({ rect: armRect(a) }); }
    for (const p of r.plants ?? []) out.push({ c: { x: p.x, z: p.z }, r: p.r * 0.9 });
    // a chair is a body you walk round, not through — sized to its seat, so its own sit gesture (which
    // stands BESIDE it and steps in) is untouched
    for (const s of r.seats) out.push({ c: { x: s.x, z: s.z }, r: 7 });
    const det = ROOM_DETAILS.get(r.id);
    if (det?.credenza) out.push({ rect: det.credenza });
  }
  out.push({ c: ISLAND.c, r: ISLAND.benchOut });
  for (const a of AMENITIES) {
    switch (a.kind) {
      case "rug": case "glow": break;
      case "screen": out.push({ rect: a.rect }); break;
      case "plant": out.push({ c: a.c, r: a.r * 0.9 }); break;
      case "column": out.push({ rect: { x: a.c.x - 8, z: a.c.z - 8, w: 16, d: 16 } }); break;
      case "armchair": out.push({ rect: armRect(a.seat) }); break;
      case "cafe-table": out.push({ c: a.c, r: 9 }); for (const s of a.chairs) out.push({ c: { x: s.x, z: s.z }, r: 6 }); break;
      case "worktable": out.push({ rect: a.rect }); for (const s of a.chairs) out.push({ c: { x: s.x, z: s.z }, r: 7 }); break;
      case "desk": out.push({ rect: a.rect }); out.push({ c: { x: a.chair.x, z: a.chair.z }, r: 7 }); break;
      default: out.push({ rect: a.rect });
    }
  }
  out.push({ c: { x: COMMONS.directory.x, z: COMMONS.directory.z }, r: 13 });
  return out;
})();

const BUCKET = 64;
const buckets = new Map<number, Solid[]>();
const bkey = (i: number, j: number): number => i * 4096 + j;
for (const s of MEETING_FLOOR_SOLIDS) {
  const b = "rect" in s ? s.rect : { x: s.c.x - s.r, z: s.c.z - s.r, w: 2 * s.r, d: 2 * s.r };
  for (let i = Math.floor((b.x - OX) / BUCKET); i <= Math.floor((b.x + b.w - OX) / BUCKET); i++)
    for (let j = Math.floor((b.z - OZ) / BUCKET); j <= Math.floor((b.z + b.d - OZ) / BUCKET); j++) {
      const k = bkey(i, j);
      const list = buckets.get(k);
      if (list) list.push(s);
      else buckets.set(k, [s]);
    }
}
const hitsRect = (p: Vec2, radius: number, r: Rect): boolean => {
  const nx = Math.max(r.x, Math.min(p.x, r.x + r.w)), nz = Math.max(r.z, Math.min(p.z, r.z + r.d));
  return (p.x - nx) ** 2 + (p.z - nz) ** 2 < radius * radius;
};

// ============================= ROOM ACCESS (the doorway a private meeting shuts) ================
const shutDoorways = new Map<string, Rect>();
/** Written only by app/meetingRoomAccess; read by the stand test. */
export function setDoorwayShut(roomId: string, shut: boolean): boolean {
  const r = meetingRoom(roomId);
  if (!r || shutDoorways.has(roomId) === shut) return false;
  if (shut) shutDoorways.set(roomId, r.door.opening);
  else shutDoorways.delete(roomId);
  return true;
}
export const shutDoorwayIds = (): string[] => [...shutDoorways.keys()];

export function clearsMeetingFloor(p: Vec2, radius: number): boolean {
  const i0 = Math.floor((p.x - radius - OX) / BUCKET), i1 = Math.floor((p.x + radius - OX) / BUCKET);
  const j0 = Math.floor((p.z - radius - OZ) / BUCKET), j1 = Math.floor((p.z + radius - OZ) / BUCKET);
  for (let i = i0; i <= i1; i++)
    for (let j = j0; j <= j1; j++) {
      const list = buckets.get(bkey(i, j));
      if (!list) continue;
      for (const s of list) {
        if ("rect" in s) { if (hitsRect(p, radius, s.rect)) return false; }
        else if ((p.x - s.c.x) ** 2 + (p.z - s.c.z) ** 2 < (radius + s.r) ** 2) return false;
      }
    }
  for (const rect of shutDoorways.values()) if (hitsRect(p, radius, rect)) return false;
  return true;
}

/** The room's door as interact/Door's own capability: AUTOMATIC, so a closed leaf never refuses a route —
 *  a private meeting shuts the DOORWAY instead (setDoorwayShut). */
export function meetingDoorCapability(r: MeetingRoomSpec): DoorCapability {
  return {
    slide: r.door.slide, slideDistance: LEAF_W - 3, automatic: true,
    crossing: r.door.crossing, trigger: r.door.trigger,
    clearance: { band: r.door.crossing, solids: [], bodyRadius: BODY_R + 2 },
    timings: { openMs: 650, closeMs: 900, holdMs: 800 },
  };
}

// ============================= THE WORLD'S VIEW: rooms, regions, entities ========================

export const MEETING_ROOM_DEFS: RoomDef[] = MEETING_ROOMS.map((r) => ({
  id: r.id, name: r.name, rect: r.rect, floorRect: r.interior, wallSolids: GLASS_RUNS.filter((g) => g.roomId === r.id).flatMap(runRects),
}));

const add = (a: Vec2, b: Vec2, k = 1): Vec2 => ({ x: a.x + b.x * k, z: a.z + b.z * k });
const perp = (v: Vec2): Vec2 => ({ x: -v.z, z: v.x });
const standable = (p: Vec2): boolean =>
  p.x >= OX + 12 + BODY_R && p.x <= OX + 1428 - BODY_R && p.z >= OZ + 12 + BODY_R && p.z <= OZ + 1232 - BODY_R && clearsMeetingFloor(p, BODY_R);

/** MOVABLE SEAT: the ground floor's conference-chair gesture — stop beside the chair, the chair rolls back,
 *  step across into the gap. The side is whichever of the two is actually standable. */
function chairSeat(s: MeetingSeat, cushionTopY = MEETING_CHAIR_SEAT_TOP, pull = 14): SeatCapability {
  const toTable = DIR[s.facing], back = { x: -toTable.x, z: -toTable.z };
  const preSeat = add(s, toTable, 4);
  const pulled = add(s, back, pull);
  let side = perp(toTable);
  if (!standable(add(pulled, side, 22)) && standable(add(pulled, side, -22))) side = { x: -side.x, z: -side.z };
  return {
    approach: add(pulled, side, 22), preSeat, approachToSeat: [add(preSeat, side, 22), preSeat],
    pullDir: back, pullDistance: pull, seatedTuck: 6, cushionTopY, cushionLocal: { x: 0, z: 0 }, sitDepth: 3,
    seatedYaw: bodyYaw(s.facing),
    timings: { pullMs: 750, sitMs: 650, slideMs: 650, standMs: 650, returnMs: 750 },
  };
}

/** FIXED SEAT in front of a piece that opens `opens`. */
function slot(id: string, seat: Vec2, opens: Facing, contactLocal: { x: number; y: number; z: number }, frontAt = 26, stepAt = 16): LoungeSeatSlot {
  const o = DIR[opens];
  return { id, contactLocal, seatedYaw: bodyYaw(opens), approach: add(seat, o, frontAt), approachToSeat: [add(seat, o, stepAt)], sink: 1.4, timings: { sitMs: 760, standMs: 700 } };
}

/** build/furniture's sofa is authored back-to-WEST along local z and reads w/d as LOCAL depth/length;
 *  "east"/"west" give it the quarter turn. */
function sofaSlots(prefix: string, rect: Rect, facing: Facing, seats: number, opens: Facing): LoungeSeatSlot[] {
  const spun = facing === "east" || facing === "west";
  const cushD = sofaCushionDepth(spun ? rect.w : rect.d, seats);
  const c = { x: rect.x + rect.w / 2, z: rect.z + rect.d / 2 };
  const th = facing === "east" ? -Math.PI / 2 : facing === "west" ? Math.PI / 2 : 0;
  const toWorld = (lx: number, lz: number): Vec2 => ({ x: c.x + lx * Math.cos(th) + lz * Math.sin(th), z: c.z - lx * Math.sin(th) + lz * Math.cos(th) });
  return Array.from({ length: seats }, (_, i) => {
    const lz = sofaCushionZ(i, seats, cushD);
    return slot(`${prefix}-${i}`, toWorld(SOFA_CUSHION_LOCAL_X, lz), opens, { x: SOFA_CUSHION_LOCAL_X + 1.5, y: SOFA_CUSHION_TOP, z: lz });
  });
}
const sofaProps = (rect: Rect, facing: Facing): { w: number; d: number } =>
  facing === "east" || facing === "west" ? { w: rect.d, d: rect.w } : { w: rect.w, d: rect.d };

function sofaEntity(id: string, roomId: string, rect: Rect, facing: Facing, seats: number, opens: Facing, color: string): Entity {
  return {
    id, kind: "sofa", roomId, transform: { pos: { x: rect.x + rect.w / 2, z: rect.z + rect.d / 2 }, yaw: 0 },
    capabilities: { lounge: { slots: sofaSlots(id.split("/").pop()!, rect, facing, seats, opens) } },
    props: { ...sofaProps(rect, facing), facing, mirrored: false, seats, color },
  };
}
function armchairEntity(id: string, roomId: string, a: MeetingSeat, color: string): Entity {
  return {
    id, kind: "armchair", roomId, transform: { pos: { x: a.x, z: a.z }, yaw: 0 },
    capabilities: { lounge: { slots: [slot(id.split("/").pop()!, a, a.facing, { x: 0, y: ARMCHAIR.cushionTop, z: 1 }, 26, 17)] } },
    props: { w: 32, d: 32, facing: a.facing, mirrored: false, color },
  };
}
function chairEntity(id: string, roomId: string, s: MeetingSeat, style: "task" | "lead", color: string): Entity {
  return { id, kind: "mf-chair", roomId, transform: { pos: { x: s.x, z: s.z }, yaw: 0 }, capabilities: { seat: chairSeat(s) }, props: { facing: s.facing, style, color } };
}
function cafeChairEntity(id: string, s: MeetingSeat): Entity {
  return {
    id, kind: "cafe-chair", roomId: PLATE_ID, transform: { pos: { x: s.x, z: s.z }, yaw: 0 },
    capabilities: { seat: chairSeat(s, CAFE_CHAIR.cushionTop, 10) },
    props: { w: 18, d: 18, facing: s.facing, mirrored: false, color: "mfCharcoal" },
  };
}
function approachEntity(id: string, roomId: string, pick: string, approach: ApproachCapability): Entity {
  return { id, kind: "solid", roomId, transform: { pos: { ...approach.point }, yaw: approach.yaw }, capabilities: { approach }, props: { pick }, source: { baked: true } };
}

export const displayEntityId = (roomId: string): string => `${roomId}/display`;
export const displayPick = (roomId: string): string => `mf-display:${roomId}`;
function displayApproach(r: MeetingRoomSpec): ApproachCapability {
  const f = DIR[r.screen.facing];
  const point = add({ x: r.screen.x, z: r.screen.z }, f, r.screen.mount === "wall" ? 34 : 36);
  return { point, yaw: bodyYaw(OPP[r.screen.facing]), label: `${r.name} display`, action: "room-display" };
}

export const UPHOLSTERY_KEY: Record<Upholstery, string> = { charcoal: "mfCharcoal", stone: "mfStone", oat: "mfOat", cognac: "mfCognac", olive: "mfOlive" };

/** EVERY SEAT ON THE FLOOR AS A WORLD ENTITY WITH A REAL SEAT: meeting and work chairs (movable), café
 *  chairs (movable), sofas and armchairs (fixed), and every display a walk-up. Nothing that looks sittable
 *  is decorative. */
export function meetingFloorEntities(): Entity[] {
  const out: Entity[] = [];
  for (const r of MEETING_ROOMS) {
    r.seats.forEach((s, i) => out.push(chairEntity(`${r.id}/chair-${i}`, r.id, s, r.chair === "lead" ? "lead" : "task", UPHOLSTERY_KEY[r.upholstery])));
    if (r.lounge) {
      const sofa = r.lounge.sofa;
      out.push(sofaEntity(`${r.id}/sofa`, r.id, sofa.rect, sofa.facing, sofa.seats, sofa.opens, UPHOLSTERY_KEY[r.upholstery]));
      r.lounge.armchairs.forEach((a, i) => out.push(armchairEntity(`${r.id}/armchair-${i}`, r.id, a, UPHOLSTERY_KEY.oat)));
    }
    r.corner?.armchairs.forEach((a, i) => out.push(armchairEntity(`${r.id}/lounge-${i}`, r.id, a, UPHOLSTERY_KEY.cognac)));
    out.push(approachEntity(displayEntityId(r.id), r.id, displayPick(r.id), displayApproach(r)));
  }
  // THE ISLAND'S BENCH RING: six places facing out, on a footprint-only entity at the island's centre (the
  // Central Hub's bench idiom — the bench itself is baked architecture).
  const islandSlots: LoungeSeatSlot[] = Array.from({ length: ISLAND_SEATS }, (_, i) => {
    const t = (i / ISLAND_SEATS) * Math.PI * 2;
    const o = { x: Math.cos(t), z: Math.sin(t) };
    const seat = add(ISLAND.c, o, ISLAND.seatR);
    return {
      id: `island-${i}`, contactLocal: { x: seat.x - ISLAND.c.x, y: ISLAND.seatTop, z: seat.z - ISLAND.c.z },
      // facing OUT, in the body's convention (bodyYaw)
      seatedYaw: Math.atan2(o.x, o.z),
      approach: add(seat, o, 26), approachToSeat: [add(seat, o, 15)], sink: 1.2, timings: { sitMs: 760, standMs: 700 },
    };
  });
  out.push({ id: `${PLATE_ID}/island-bench`, kind: "solid", roomId: PLATE_ID, transform: { pos: { ...ISLAND.c }, yaw: 0 }, capabilities: { lounge: { slots: islandSlots } }, props: { pick: "mf-island" }, source: { baked: true } });
  for (const a of AMENITIES) {
    const id = `${PLATE_ID}/${a.id}`;
    if (a.kind === "sofa") out.push(sofaEntity(id, PLATE_ID, a.rect, a.facing, a.seats, a.opens, a.color));
    else if (a.kind === "armchair") out.push(armchairEntity(id, PLATE_ID, a.seat, a.color));
    else if (a.kind === "cafe-table") a.chairs.forEach((s, i) => out.push(cafeChairEntity(`${id}/chair-${i}`, s)));
    else if (a.kind === "worktable") a.chairs.forEach((s, i) => out.push(chairEntity(`${id}/chair-${i}`, PLATE_ID, s, "task", "mfStone")));
    else if (a.kind === "desk") out.push(chairEntity(`${id}/chair`, PLATE_ID, a.chair, "task", "mfCharcoal"));
  }
  return out;
}

/** THE CONFIGURED FACING for every cardinal Floor 2 seat, in data/seatFacing.json's words (app/seats.ts):
 *  front = south, back = north, left = west, right = east. The island's six bench places face out at 60°
 *  steps, which the four-word table cannot express, and keep their authored yaw. */
export function meetingFloorSeatFacings(): Record<string, "front" | "back" | "left" | "right"> {
  const word = (yaw: number): "front" | "back" | "left" | "right" | null => {
    const w = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    for (const [f, v] of [["front", 0], ["back", Math.PI], ["right", Math.PI / 2], ["left", -Math.PI / 2]] as const) if (Math.abs(Math.atan2(Math.sin(w - v), Math.cos(w - v))) < 1e-6) return f;
    return null;
  };
  const out: Record<string, "front" | "back" | "left" | "right"> = {};
  for (const e of meetingFloorEntities()) {
    if (e.capabilities.seat) { const f = word(e.capabilities.seat.seatedYaw); if (f) out[e.id] = f; }
    for (const sl of e.capabilities.lounge?.slots ?? []) { const f = word(sl.seatedYaw); if (f) out[`${e.id}#${sl.id}`] = f; }
  }
  return out;
}

export const meetingRoomRegions = () => MEETING_ROOMS.map((r) => ({ id: `floor:${r.id}`, kind: "room-floor" as const, rect: r.interior, walkable: true, roomId: r.id }));

export { OPP as OPPOSITE_FACING, DIR as FACING_DIR };
