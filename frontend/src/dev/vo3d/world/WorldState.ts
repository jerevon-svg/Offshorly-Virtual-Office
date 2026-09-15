// vo3d world — the AUTHORITATIVE logical state. No THREE here.
// The Three.js scene mirrors this by stable entity id (render/SceneMirror.ts);
// navigation derives its dynamic layer from it (nav/Walkability.ts).
import { pointInRect, type Rect, type Vec2 } from "../core/coords";
import { Emitter } from "../core/events";

export type EntityId = string; // "<roomId>/<local-name>", stable, human-readable
export type Transform2 = { pos: Vec2; yaw: number }; // floor objects: position + yaw only

/** Logical footprint, centred on transform.pos (rect is axis-aligned in world space).
 *
 *  `solid` is the NAVIGATION semantics (7B): physical furniture defaults to SOLID and therefore carves the
 *  derived walkability field of a reconstructed room. Decorative floor dressing — rugs, mats, floor inlays —
 *  declares `solid: false`: it has an extent (placement still keeps pieces off it where that matters) but a
 *  body walks straight over it. Nothing here is ever read from a render mesh. */
export type FootprintShape =
  | { shape: "rect"; w: number; d: number }
  | { shape: "circle"; r: number }
  /** an annulus SECTOR centred on transform.pos — what a curved bench run actually occupies.
   *  Bearings are COMPASS degrees (0 = north, 90 = east), matching how curved architecture is authored. */
  | { shape: "sector"; rIn: number; rOut: number; from: number; to: number };
export type Footprint = FootprintShape & { solid?: boolean };
/** the one place the default lives: absent `solid` means SOLID */
export const isSolid = (fp: Footprint | undefined): boolean => fp !== undefined && fp.solid !== false;

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

/** Automatic sliding door (world coords). Consumed by interact/Door.ts (animation) and nav/clearance.ts (routing). */
export type DoorCapability = {
  /** unit slide axis from CLOSED (= the entity transform) toward OPEN, and how far the leaf travels */
  slide: Vec2;
  slideDistance: number;
  /** the leaf's sweep band across the doorway: while Bon's body overlaps it the door must be open and may not close */
  crossing: Rect;
  /** The CLOSED-state leaf footprint in world space. Derived navigation slides it along `slide` by
   *  `slideDistance × openFraction` to get the leaf's live solid (nav/solids.ts). Pure data: the animated
   *  view in interact/Door.ts is mirrored FROM the same numbers, never read back INTO them. */
  leaf?: Rect;
  /** the counter-sliding second panel of a BI-PARTING door; it moves by the negated `slide`, exactly as
   *  SlidingDoor's `opposed` leaf does */
  leafOpposed?: Rect;
  /** AUTOMATIC: the door opens for whoever walks up to it, so it is never an obstacle to a ROUTE.
   *
   *  This matters more than it looks. SlidingDoor only opens when the remaining route already passes
   *  through its crossing band — so if navigation treated the closed leaf as solid, no route would ever be
   *  planned through the doorway, the door would never be asked to open, and the room would be sealed. An
   *  automatic door is therefore modelled at its PARKED extent, which is also what `clearance.solids`
   *  already describes ("parked leaf + fixed pane + wall"). The live-fraction path stays for a door that
   *  genuinely obstructs — a manual or locked one — and is exercised by the tests. */
  automatic?: true;
  /** approach region: a route that will pass through `crossing` starts the door opening from here */
  trigger: Rect;
  /** architecture the V1 door band does not know precisely (jambs, fixed pane, parked leaf). Only cells whose centre
   *  lies in `band` (the doorway's cell column) are judged: they stay walkable only if a body of `bodyRadius` on the
   *  cell centre clears every solid. Hall cells hugging the wall keep V1's cell-granularity verdict. */
  clearance: { band: Rect; solids: Rect[]; bodyRadius: number };
  timings: { openMs: number; closeMs: number; holdMs: number };
};

/** Architectural clearance: cells inside `band` stay walkable only if a body of `bodyRadius` standing on
 *  the cell centre clears every solid. The V1 grid is authored at 16-unit cells and is deliberately
 *  generous; this is how reconstructed architecture narrower than a cell reconciles with it. */
export type ClearanceCapability = { band: Rect; solids: Rect[]; bodyRadius: number };

/** A contextual standing point: where to walk to interact with something, and which way to face there.
 *  Consumed by interact/Approach.ts. `pick` names the scene group a click must hit to offer this action. */
export type ApproachCapability = {
  /** world point the avatar walks to (a real V1-walkable, body-clear cell) */
  point: Vec2;
  /** yaw the avatar turns to on arrival (core/coords FACING_YAW) */
  yaw: number;
  label: string;
  /** the contextual action offered once there (dev-safe: no backend workflow in this phase) */
  action: string;
};

/** ONE slot of a FIXED lounge seat (tub chair, sofa cushion, bench place). The furniture never moves, so a
 *  slot describes only where the sitter ends up. Multiple slots per piece let a sofa declare seat-left /
 *  seat-center / seat-right; `id` is the occupancy identity a future multi-avatar pass will key on. */
export type LoungeSeatSlot = {
  id: string;
  /** cushion CONTACT point in FURNITURE-LOCAL space. y is the seat SURFACE, not the furniture origin. */
  contactLocal: { x: number; y: number; z: number };
  /** world yaw while seated */
  seatedYaw: number;
  /** V1-walkable stand cell the sitter walks to first */
  approach: Vec2;
  /** explicit waypoints approach → in front of the slot (the grid is too coarse for the last step) */
  approachToSeat: Vec2[];
  /** how far the pelvis settles BELOW the surface (soft cushion compression). 0 = rests exactly on top. */
  sink?: number;
  timings: { sitMs: number; standMs: number };
};

/** FIXED seating: the furniture does not move at any point of the interaction. Distinct from
 *  SeatCapability, which is MOVABLE desk-chair seating (pull out → enter → tuck in → stand → return). */
export type LoungeSeatCapability = { slots: LoungeSeatSlot[] };

/** Small composable optional capabilities — add fields, never a union. */
export type Capabilities = {
  seat?: SeatCapability;
  door?: DoorCapability;
  /** static architecture (gate pedestals, bollards …) that the V1 grid resolves too coarsely */
  clearance?: ClearanceCapability;
  /** walk-up-and-face interaction (reception counter, kiosk …) */
  approach?: ApproachCapability;
  /** FIXED seating (lounge chair / sofa). Mutually exclusive with `seat`, which is MOVABLE desk seating. */
  lounge?: LoungeSeatCapability;
  /** foliage sway animation nodes are registered for this entity */
  sway?: true;
  /** can be selected/moved by the room editor */
  editable?: true;
  /** LEGACY (pre-7B) opt-in: its footprint blocks navigation dynamically on the V1-governed layer, because
   *  the static V1 grid already covers V1-authored furniture and nothing else was consulted. In a room
   *  running DERIVED navigation this flag is irrelevant — every solid footprint blocks automatically — and
   *  Walkability skips derived-room entities on this layer so the two can never double-count. */
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
  /** ShellSpec describes the Design Room's wall arrangement (solid north+west, glass east, low south band).
   *  Rooms whose architecture does not fit that shape omit it and supply their own ROOM_STATIC builder
   *  instead — see rooms/reception.ts. Deliberately NOT generalised into a union until a third and fourth
   *  room shape exist to generalise from. */
  shell?: ShellSpec;
  /** room-local measured decor for the static shell builder (credenza, boards, cabinets, rack, whiteboard) */
  baked?: Record<string, unknown>;
  /** PURE-DATA world rects of this room's physical walls, for derived navigation (nav/solids.ts).
   *  Taken from the room's own authored wall constants — NEVER traversed out of a THREE scene. A wall-less
   *  room (the Central Hub) declares an empty array; `undefined` means "not migrated yet". */
  wallSolids?: Rect[];
}

/** A registered walkable (or deliberately non-walkable) part of the ONE world, in world space.
 *  Regions are checked in registration order; a point belongs to the first region whose rect contains it
 *  and none of whose `holes` do. Navigation bounds = the union of `walkable` regions. */
export type RegionKind = "room-floor" | "shared-floor" | "exterior";
export interface WorldRegion {
  id: string;
  kind: RegionKind;
  rect: Rect;
  /** cut-outs (e.g. the shared floor minus every room footprint) */
  holes?: Rect[];
  /** false = modelled footprint whose interior is not yet walkable (unreconstructed room) */
  walkable: boolean;
  roomId?: string;
}

export type WorldChange = { changed: EntityId[]; version: number; added?: EntityId[]; removed?: EntityId[] };

/** The write surface of ONE world transaction. Everything a commit may do to the world lives here, so a
 *  caller cannot half-apply a change: the version bump and the single change event cover all of it.
 *  Slice 2 adds `setCapabilities` (gameplay anchors ride the transform — editor/anchors.ts) and
 *  `add`/`remove` (the editor's asset library places and deletes real entities). */
export type WorldTx = {
  setTransform: (id: EntityId, t: Transform2) => void;
  setCapabilities: (id: EntityId, caps: Capabilities) => void;
  add: (e: Entity) => void;
  remove: (id: EntityId) => void;
};

export class WorldState {
  readonly rooms = new Map<string, RoomDef>();
  readonly entities = new Map<EntityId, Entity>();
  readonly regions: WorldRegion[] = [];
  /** the world's outer boundary (the V1 frame once the ground floor is registered) */
  bounds: Rect | null = null;
  version = 0;
  readonly changes = new Emitter<WorldChange>();

  addRoom(room: RoomDef): void {
    this.rooms.set(room.id, room);
  }
  addRegion(region: WorldRegion): void {
    if (this.regions.some((r) => r.id === region.id)) throw new Error(`duplicate region id ${region.id}`);
    this.regions.push(region);
  }
  /** the first region owning `p` (registration order), or null when `p` is outside the modelled world */
  regionAt(p: Vec2): WorldRegion | null {
    if (this.bounds && !pointInRect(p, this.bounds)) return null;
    for (const r of this.regions) if (pointInRect(p, r.rect) && !r.holes?.some((h) => pointInRect(p, h))) return r;
    return null;
  }
  /** navigation bounds: inside a walkable registered region */
  walkableAt(p: Vec2): boolean {
    return this.regionAt(p)?.walkable === true;
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
  /** Atomic transaction: every write inside is committed together with one version bump + one change event. */
  commit(fn: (tx: WorldTx) => void): WorldChange {
    const changed: EntityId[] = [];
    const added: EntityId[] = [];
    const removed: EntityId[] = [];
    const touch = (id: EntityId): void => { if (!changed.includes(id)) changed.push(id); };
    fn({
      setTransform: (id, t) => {
        const e = this.get(id);
        this.entities.set(id, { ...e, transform: { pos: { ...t.pos }, yaw: t.yaw } });
        touch(id);
      },
      setCapabilities: (id, caps) => {
        const e = this.get(id);
        this.entities.set(id, { ...e, capabilities: caps });
        touch(id);
      },
      add: (e) => {
        this.addEntity(e);
        added.push(e.id);
      },
      remove: (id) => {
        if (!this.entities.delete(id)) throw new Error(`unknown entity ${id}`);
        removed.push(id);
      },
    });
    this.version++;
    const change: WorldChange = { changed, version: this.version, added, removed };
    if (changed.length || added.length || removed.length) this.changes.emit(change);
    return change;
  }
  /** Solid footprints (as world rects; circles → bounding squares) of every entity except `except`,
   *  each tagged with the entity it came from. Non-solid footprints (rugs, mats) are extents, not
   *  obstacles, and are skipped. */
  solidEntityRects(except?: EntityId): { id: EntityId; rect: Rect }[] {
    const out: { id: EntityId; rect: Rect }[] = [];
    for (const e of this.entities.values()) {
      if (e.id === except || !e.footprint || !isSolid(e.footprint)) continue;
      const { pos } = e.transform;
      if (e.footprint.shape === "rect") out.push({ id: e.id, rect: { x: pos.x - e.footprint.w / 2, z: pos.z - e.footprint.d / 2, w: e.footprint.w, d: e.footprint.d } });
      // a sector's BOUNDING square: placement is a coarse keep-out test, and erring wide is the safe side
      else if (e.footprint.shape === "sector") out.push({ id: e.id, rect: { x: pos.x - e.footprint.rOut, z: pos.z - e.footprint.rOut, w: 2 * e.footprint.rOut, d: 2 * e.footprint.rOut } });
      else out.push({ id: e.id, rect: { x: pos.x - e.footprint.r, z: pos.z - e.footprint.r, w: 2 * e.footprint.r, d: 2 * e.footprint.r } });
    }
    return out;
  }
  /** the same solids, untagged */
  solidRects(except?: EntityId): Rect[] {
    return this.solidEntityRects(except).map((s) => s.rect);
  }
}
