// vo3d world — the AUTHORITATIVE logical state. No THREE here.
// The Three.js scene mirrors this by stable entity id (render/SceneMirror.ts);
// navigation derives its dynamic layer from it (nav/Walkability.ts).
import type { Rect, Vec2 } from "../core/coords";
import { Emitter } from "../core/events";

export type EntityId = string; // "<roomId>/<local-name>", stable, human-readable
export type Transform2 = { pos: Vec2; yaw: number }; // floor objects: position + yaw only

/** Logical footprint, centred on transform.pos (rect is axis-aligned in world space). */
export type Footprint = { shape: "rect"; w: number; d: number } | { shape: "circle"; r: number };

export type Placement = {
  movable: boolean;
  /** extra clearance (units) kept from other solid footprints when placing */
  clearance: number;
};

/** Seat interaction data (world coords). Consumed by interact/Seat.ts; nothing here is logic. */
export type SeatCapability = {
  approach: Vec2; // production stand-here cell centre: A* target and exit point
  preSeat: Vec2; // in the gap between desk and pulled-out chair; sit-down starts here
  approachToSeat: Vec2[]; // walked waypoints approach → preSeat (grid blocks this gap)
  pullDir: Vec2;
  pullDistance: number;
  seatedTuck: number; // chair parks this far short of rest while occupied
  cushionTopY: number;
  cushionLocal: Vec2; // seat centre offset in chair-local x/z
  sitDepth: number; // pelvis offset toward the backrest (chair-local +z)
  seatedYaw: number;
  timings: { pullMs: number; sitMs: number; slideMs: number; standMs: number; returnMs: number };
};

/** Small composable optional capabilities — add fields, never a union. */
export type Capabilities = {
  seat?: SeatCapability;
  /** foliage sway animation nodes are registered for this entity */
  sway?: true;
  /** can be selected/moved by the room editor */
  editable?: true;
  /** its footprint blocks navigation dynamically (the static V1 grid already covers V1-authored furniture) */
  navBlocker?: true;
};

export interface Entity {
  id: EntityId;
  kind: string; // selects a builder (build/registry.ts)
  roomId: string;
  transform: Transform2;
  footprint?: Footprint;
  placement?: Placement;
  capabilities: Capabilities;
  /** small builder-specific bag (facing, mirrored, plant radius/height …) */
  props: Readonly<Record<string, number | string | boolean>>;
  /** V1 provenance, when derived from the production manifest */
  source?: { v1LayerId?: string; baked?: true };
}

export interface ShellSpec {
  wallHeight: number;
  wallThickness: number;
  capRadius: number;
  frontWallZ: number; // room-local z of the front (south) wall band
  frontWallHeight: number;
  glass: { z0: number; z1: number; doorZ1: number; postEvery: number }; // room-local, east wall
  exteriorMargin: number;
}

export interface RoomDef {
  id: string;
  name: string;
  rect: Rect; // world
  /** world rect of the walkable floor (inside walls, north of the front wall) */
  floorRect: Rect;
  shell: ShellSpec;
  /** room-local measured decor for the static shell builder (credenza, boards, cabinets, rack, whiteboard) */
  baked: Record<string, unknown>;
}

export type WorldChange = { changed: EntityId[]; version: number };

export class WorldState {
  readonly rooms = new Map<string, RoomDef>();
  readonly entities = new Map<EntityId, Entity>();
  version = 0;
  readonly changes = new Emitter<WorldChange>();

  addRoom(room: RoomDef): void {
    this.rooms.set(room.id, room);
  }
  addEntity(e: Entity): void {
    if (this.entities.has(e.id)) throw new Error(`duplicate entity id ${e.id}`);
    this.entities.set(e.id, e);
  }
  get(id: EntityId): Entity {
    const e = this.entities.get(id);
    if (!e) throw new Error(`unknown entity ${id}`);
    return e;
  }
  inRoom(roomId: string): Entity[] {
    return [...this.entities.values()].filter((e) => e.roomId === roomId);
  }
  /** Atomic transaction: every setTransform inside is committed together with one version bump + one change event. */
  commit(fn: (tx: { setTransform: (id: EntityId, t: Transform2) => void }) => void): WorldChange {
    const changed: EntityId[] = [];
    fn({
      setTransform: (id, t) => {
        const e = this.get(id);
        this.entities.set(id, { ...e, transform: { pos: { ...t.pos }, yaw: t.yaw } });
        changed.push(id);
      },
    });
    this.version++;
    const change = { changed, version: this.version };
    if (changed.length) this.changes.emit(change);
    return change;
  }
  /** Solid footprints (as world rects; circles → bounding squares) of every entity except `except`. */
  solidRects(except?: EntityId): Rect[] {
    const out: Rect[] = [];
    for (const e of this.entities.values()) {
      if (e.id === except || !e.footprint) continue;
      const { pos } = e.transform;
      if (e.footprint.shape === "rect") out.push({ x: pos.x - e.footprint.w / 2, z: pos.z - e.footprint.d / 2, w: e.footprint.w, d: e.footprint.d });
      else out.push({ x: pos.x - e.footprint.r, z: pos.z - e.footprint.r, w: 2 * e.footprint.r, d: 2 * e.footprint.r });
    }
    return out;
  }
}
