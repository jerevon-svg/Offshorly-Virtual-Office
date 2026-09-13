// vo3d nav — LOGICAL SOLIDS: the physical obstructions of a reconstructed room, as cheap analytic shapes.
//
// THE ONE RULE OF THIS FILE: nothing here ever reads a THREE object. Every shape is produced from authored
// room data (wall constants, footprints, door capabilities) that already exists in WorldState. Derived
// navigation is therefore a function of the LOGICAL world, not of whatever the renderer happens to have
// built — which is what lets it run in a test with no canvas, and what stops a decorative mesh from
// silently becoming an obstacle.
//
// Three providers, one shape vocabulary:
//   walls   ← RoomDef.wallSolids        (pure rects, authored per room)
//   entity  ← Entity.footprint          (rect / circle, `solid: false` opts out)
//   door    ← DoorCapability            (static jambs + the LIVE leaf at its open fraction)
import type { Rect, Vec2 } from "../core/coords";
import { isSolid, type Entity, type WorldState } from "../world/WorldState";

/** An annulus SECTOR: the shape a curved bench actually occupies. Bearings are COMPASS degrees (0 = north,
 *  90 = east), matching how the Central Hub's arcs are authored, and `to` may exceed 360 to wrap. */
export type AnnulusSector = { c: Vec2; rIn: number; rOut: number; from: number; to: number };

export type SolidShape =
  | { kind: "rect"; rect: Rect }
  | { kind: "circle"; c: Vec2; r: number }
  | { kind: "sector"; sector: AnnulusSector };

/** One obstruction, tagged with where it came from so the diagnostic can explain a blocked cell. */
export type Solid = { id: string; from: "wall" | "entity" | "door"; shape: SolidShape };

// ---- distance ------------------------------------------------------------------------------------
/** Distance from `p` to the rect's boundary, 0 when inside. */
export function distToRect(p: Vec2, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dz = Math.max(r.z - p.z, 0, p.z - (r.z + r.d));
  return Math.hypot(dx, dz);
}

/** Distance from `p` to a segment a→b, 0 when on it. */
function distToSegment(p: Vec2, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax, vz = bz - az;
  const len2 = vx * vx + vz * vz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - ax) * vx + (p.z - az) * vz) / len2));
  return Math.hypot(p.x - (ax + vx * t), p.z - (az + vz * t));
}

/** Compass bearing (0 = north / −z, 90 = east / +x) of `p` about `c`, in [0, 360). */
function bearing(c: Vec2, p: Vec2): number {
  const deg = (Math.atan2(p.x - c.x, -(p.z - c.z)) * 180) / Math.PI;
  return (deg + 360) % 360;
}
const spanContains = (s: AnnulusSector, deg: number): boolean => {
  const from = ((s.from % 360) + 360) % 360;
  const width = s.to - s.from;
  const d = ((deg - from) % 360 + 360) % 360;
  return d <= width;
};

/** Distance from `p` to an annulus sector, 0 when inside it. */
export function distToSector(p: Vec2, s: AnnulusSector): number {
  const r = Math.hypot(p.x - s.c.x, p.z - s.c.z);
  if (spanContains(s, bearing(s.c, p))) return Math.max(0, s.rIn - r, r - s.rOut);
  // outside the wedge: the nearest point is on one of the two radial edges
  let best = Infinity;
  for (const deg of [s.from, s.to]) {
    const t = (deg * Math.PI) / 180;
    const ux = Math.sin(t), uz = -Math.cos(t);
    best = Math.min(best, distToSegment(p, s.c.x + ux * s.rIn, s.c.z + uz * s.rIn, s.c.x + ux * s.rOut, s.c.z + uz * s.rOut));
  }
  return best;
}

export function distToShape(p: Vec2, sh: SolidShape): number {
  if (sh.kind === "rect") return distToRect(p, sh.rect);
  if (sh.kind === "circle") return Math.max(0, Math.hypot(p.x - sh.c.x, p.z - sh.c.z) - sh.r);
  return distToSector(p, sh.sector);
}

/** Conservative world-space bounding rect — used only to decide which cells a solid can possibly touch. */
export function shapeBounds(sh: SolidShape): Rect {
  if (sh.kind === "rect") return sh.rect;
  if (sh.kind === "circle") return { x: sh.c.x - sh.r, z: sh.c.z - sh.r, w: 2 * sh.r, d: 2 * sh.r };
  const { c, rOut } = sh.sector;
  return { x: c.x - rOut, z: c.z - rOut, w: 2 * rOut, d: 2 * rOut };
}

// ---- providers -----------------------------------------------------------------------------------
/** An entity's footprint as a solid shape, or null when it has none / is decorative floor dressing. */
export function entityShape(e: Entity): SolidShape | null {
  if (!isSolid(e.footprint)) return null;
  const fp = e.footprint!;
  const { pos } = e.transform;
  if (fp.shape === "circle") return { kind: "circle", c: { ...pos }, r: fp.r };
  if (fp.shape === "sector") return { kind: "sector", sector: { c: { ...pos }, rIn: fp.rIn, rOut: fp.rOut, from: fp.from, to: fp.to } };
  return { kind: "rect", rect: { x: pos.x - fp.w / 2, z: pos.z - fp.d / 2, w: fp.w, d: fp.d } };
}

/** Every solid an entity contributes: its own footprint, plus the architecture a door capability carries. */
export function entitySolids(e: Entity, doorOpen: (id: string) => number): Solid[] {
  const out: Solid[] = [];
  const own = entityShape(e);
  if (own) out.push({ id: e.id, from: "entity", shape: own });
  const door = e.capabilities.door;
  if (door) {
    door.clearance.solids.forEach((rect, i) => out.push({ id: `${e.id}#jamb${i}`, from: "door", shape: { kind: "rect", rect } }));
    // An AUTOMATIC door is never an obstacle to a route (see DoorCapability.automatic): it is modelled at
    // its parked extent. Anything else contributes its leaf where the leaf actually is.
    const fraction = door.automatic ? 1 : doorOpen(e.id);
    const t = door.slideDistance * fraction;
    if (door.leaf) out.push({ id: `${e.id}#leaf`, from: "door", shape: { kind: "rect", rect: { ...door.leaf, x: door.leaf.x + door.slide.x * t, z: door.leaf.z + door.slide.z * t } } });
    if (door.leafOpposed) out.push({ id: `${e.id}#leafOpposed`, from: "door", shape: { kind: "rect", rect: { ...door.leafOpposed, x: door.leafOpposed.x - door.slide.x * t, z: door.leafOpposed.z - door.slide.z * t } } });
  }
  return out;
}

/** Every solid inside `roomIds`: walls first (they bound the room), then entities and doors. */
export function roomSolids(world: WorldState, roomIds: ReadonlySet<string>, doorOpen: (id: string) => number = () => 0): Solid[] {
  const out: Solid[] = [];
  for (const id of roomIds) {
    const room = world.rooms.get(id);
    if (!room) throw new Error(`nav/solids: derived room ${id} has no RoomDef`);
    if (!room.wallSolids) throw new Error(`nav/solids: room ${id} has no wallSolids — it is not migrated to derived navigation`);
    room.wallSolids.forEach((rect, i) => out.push({ id: `${id}#wall${i}`, from: "wall", shape: { kind: "rect", rect } }));
  }
  for (const e of world.entities.values()) if (roomIds.has(e.roomId)) out.push(...entitySolids(e, doorOpen));
  return out;
}
