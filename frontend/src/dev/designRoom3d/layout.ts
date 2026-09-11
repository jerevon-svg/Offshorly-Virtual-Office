// Design Room true-3D reconstruction POC — LAYOUT SPEC.
//
// Isolated dev prototype (dev/design-room-3d.html). Reads the production
// manifest READ-ONLY to place every separated Design Room furniture piece at
// its real footprint, and hand-measures the items that are baked into the
// room plate (cabinets, whiteboard, plants, boards, glass wall) from
// design-room.png native pixels. Nothing here is imported by production code.
//
// Units: room-relative frame units. x → east (screen right), z → south
// (screen down, the plate's +y), y → up. 1 unit ≈ 1 frame unit of the office.
import manifest from "../../data/office-assets-manifest.json";

type ManifestEntry = {
  id: string;
  kind: string;
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

const entries = manifest as ManifestEntry[];
const roomEntry = entries.find((e) => e.id === "design-room");
if (!roomEntry) throw new Error("designRoom3d: manifest has no design-room layer");

export const ROOM = { x: roomEntry.x, y: roomEntry.y, width: roomEntry.width, height: roomEntry.height };
export const NATIVE = { width: 1360, height: 1156 }; // design-room.png
export const SCALE_X = ROOM.width / NATIVE.width;
export const SCALE_Z = ROOM.height / NATIVE.height;
/** native px → room-relative x */
export const px = (v: number): number => v * SCALE_X;
/** native px → room-relative z */
export const pz = (v: number): number => v * SCALE_Z;

export type Rect = { x: number; z: number; w: number; d: number };
export type Facing = "north" | "south" | "east" | "west";
export type FurnitureKind =
  | "lead-desk"
  | "member-desk"
  | "desk-panel"
  | "curve-desk"
  | "side-desk"
  | "sofa"
  | "beanbag"
  | "rug"
  | "chair-a"
  | "chair-b"
  | "lead-chair";

export type FurnitureItem = {
  id: string;
  kind: FurnitureKind;
  /** footprint = the manifest wrapper box (what is visible on the stage) */
  rect: Rect;
  facing: Facing;
  /** curve desks: the right-hand piece is the mirror of the left one */
  mirrored: boolean;
};

export function kindForPath(path: string): FurnitureKind | null {
  const f = path.split("/").pop() ?? "";
  if (f === "design-lead-desk.png") return "lead-desk";
  if (f === "design-member-desk.png") return "member-desk";
  if (f === "design-desk-panel.png") return "desk-panel";
  if (f === "design-curve-desk.png") return "curve-desk";
  if (f === "design-side-desk.png") return "side-desk";
  if (f === "design-side-sofa.png") return "sofa";
  if (f === "design-side-beanbag.png") return "beanbag";
  if (f === "design-side-mat.png") return "rug";
  if (f === "design-member-chair-a.png") return "chair-a";
  if (f === "design-member-chair-b.png") return "chair-b";
  if (f === "design-lead-chair.png") return "lead-chair";
  return null;
}

// Facing is derived from geometry, not from gameplay seat data: a chair faces
// the desk it serves. Left-column chairs sit east of their desks and face
// west; right-column chairs face east; the bottom row sits south of the desk
// panels and faces north; the lead chair sits north of the lead desk and
// faces south. Desks present their drawer fronts to the sitter.
export function facingFor(kind: FurnitureKind, rect: Rect): Facing {
  const cx = rect.x + rect.w / 2;
  switch (kind) {
    case "chair-a":
    case "member-desk":
      return cx < ROOM.width / 2 ? "west" : "east";
    case "chair-b":
      return "north";
    case "lead-chair":
    case "lead-desk":
      return "south";
    case "desk-panel":
    case "curve-desk":
      return "north";
    default:
      return "south";
  }
}

export const FURNITURE: FurnitureItem[] = entries
  .filter((e) => (e.kind === "furniture" || e.kind === "decor") && kindForPath(e.path) !== null)
  .filter((e) => e.path.includes("design"))
  .map((e) => {
    const kind = kindForPath(e.path) as FurnitureKind;
    const rect: Rect = { x: e.x - ROOM.x, z: e.y - ROOM.y, w: e.width, d: e.height };
    return { id: e.id, kind, rect, facing: facingFor(kind, rect), mirrored: rect.x + rect.w / 2 > ROOM.width / 2 };
  });

// ---- shell -------------------------------------------------------------------
export const SHELL = {
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

// ---- baked items measured from design-room.png --------------------------------
// x values were read off a 0.75-scale grid render (display px), so they are
// scaled by 4/3 to native; y values were read from the grid labels and are
// already native. Verified against pixel scans of the plate: bottom cabinets at
// native x 519-862 / 893-1111, y ≈ 900-1048; left boards at native y 282-565.
const D = 4 / 3;
const dpx = (v: number): number => px(v * D);
export type PlantSpec = { x: number; z: number; r: number; h: number; hanging?: boolean; /** base height: 0 = floor, else the surface it stands on */ y?: number };
export type BoxSpec = Rect & { h: number };

export const BAKED = {
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

// ---- palette (the room's warm cream / wood / olive identity) --------------------
export const PALETTE = {
  floor: 0xf0e8e2,
  exterior: 0xd9cbbf,
  wall: 0xfaf8f5,
  wallFace: 0xf1ece7,
  wood: 0xcfa876,
  woodLight: 0xdcb98a,
  green: 0x7b8a45,
  greenDark: 0x66733a,
  greenSeat: 0x8a9a55,
  white: 0xf7f7f4,
  charcoal: 0x2b2b2e,
  potGray: 0x9a9a96,
  potDark: 0x5e5a56,
  foliage: 0x4f8a3a,
  foliageLight: 0x6fa74a,
  rug: 0xc6a36e,
  cushionGray: 0xb9b3ab,
  cushionCream: 0xe9dfcf,
  metal: 0xc9cbcc,
  glass: 0xcfe3f2,
  boardBg: 0xf4efe6,
  boardPin: 0x6f8a3d,
  screen: 0x1f2430,
};
