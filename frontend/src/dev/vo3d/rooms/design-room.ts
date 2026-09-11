// vo3d rooms — DESIGN ROOM definition (data only). World rect comes from the READ-ONLY V1 manifest;
// shell/baked measurements are room-local (they position a static group at the room origin);
// every ENTITY below is in WORLD coordinates.
import type { Rect } from "../core/coords";
import type { Entity, RoomDef, ShellSpec } from "../world/WorldState";
import { v1FurnitureEntities, v1RoomRect } from "../adapters/v1Manifest";
import type { DesignBaked } from "../build/baked";
import type { BoxSpec } from "../build/helpers";
import type { PlantSpec } from "../build/plants";

export const DESIGN_ROOM_ID = "design-room";
export const RECT: Rect = v1RoomRect(DESIGN_ROOM_ID);
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

export const DESIGN_ROOM: RoomDef = {
  id: DESIGN_ROOM_ID,
  name: "Design Team",
  rect: RECT,
  floorRect: { x: wx(SHELL.wallThickness), z: wz(SHELL.wallThickness), w: RECT.w - 2 * SHELL.wallThickness, d: SHELL.frontWallZ - SHELL.wallThickness },
  shell: SHELL,
  baked: BAKED,
};

/** world rects of baked decor that placement must treat as solid (visuals come from build/baked.ts) */
export const DESIGN_SOLIDS: Rect[] = [BAKED.rearCabinet, ...BAKED.bottomCabinets, BAKED.plantRack].map((b) => ({ x: wx(b.x), z: wz(b.z), w: b.w, d: b.d }));

export const HERO_PLANT_ID = `${DESIGN_ROOM_ID}/plant-10`;
export const CHAIR_4_ID = `${DESIGN_ROOM_ID}/design-member-chair-4`;

function plantEntities(): Entity[] {
  return (BAKED_LOCAL.plants as PlantSpec[]).map((p, i) => {
    const id = `${DESIGN_ROOM_ID}/plant-${i}`;
    const hero = i === BAKED_LOCAL.plants.length - 1;
    return {
      id,
      kind: "plant",
      roomId: DESIGN_ROOM_ID,
      transform: { pos: { x: wx(p.x), z: wz(p.z) }, yaw: 0 },
      footprint: hero ? { shape: "circle", r: 8 } : undefined, // pot radius 7.2 + clearance
      placement: hero ? { movable: true, clearance: 1.5 } : undefined,
      capabilities: hero ? { sway: true, editable: true, navBlocker: true } : { sway: true },
      props: { r: p.r, h: p.h, hanging: p.hanging ?? false, y: p.y ?? 0 },
      source: { baked: true },
    } satisfies Entity;
  });
}

export function designRoomEntities(): Entity[] {
  const furniture = v1FurnitureEntities(DESIGN_ROOM_ID, "design-team", RECT);
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
  return [...furniture, ...plantEntities()];
}
