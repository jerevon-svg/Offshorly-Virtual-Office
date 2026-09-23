// vo3d app — DND ROOM LOCKS, THE PHYSICAL HALF. V1 parity for feature spec sections 2/3/6/8.
//
// WHAT V1 DOES. A room is LOCKED while one of its live occupants is DND (data/roomLock.ts, from the
// room_presence and dnd_status broadcasts). A walk into a locked room stops at the door's outside stand
// point and RoomLockedToast offers Request Entry; an accepted knock resumes the exact held continuation,
// once; the occupant themselves is never gated (feature spec section 6: no persistent whitelist, and the
// person inside can always leave).
//
// WHAT THIS DOES. It DECIDES NOTHING ABOUT LOCKS — which rooms are locked arrives from the host, resolved by
// V1's own isRoomLocked over V1's own feeds. It turns that answer into the one thing V1's office cannot give
// a 3D body: a closed doorway. Each door entity the world already has (capabilities.door, owned by its
// entity's roomId) is held by a Walkability RESERVATION over its crossing band — the SAME mechanism, rank
// and reach as Reception's gate lanes and the exit door (app/world.ts GATE_RESERVATION / EXIT_RESERVATION),
// so the router, click-to-walk, every approach and PLAYER mode all obey it at once, and the sliding door
// stays shut without touching SlidingDoor (it opens for a body in its crossing or a route through it, and
// a reservation makes both impossible).
//
// THE DOORWAY, AND ONLY THE DOORWAY. The crossing band is the leaf's sweep — the threshold itself. Nothing
// of the hall outside, nothing of the room inside; a person standing beside a locked door can still walk
// the corridor past it.
//
// NEVER A CAGE. A door is held only while the body is OUTSIDE its room. An occupant of a locked room (the
// DND person, or anybody who was let in) always has an open door out; the moment they have left, the hold
// is back — the same "repeat entry requires a fresh knock" V1 states. A body already in the threshold is
// never clamped either: the hold waits for it to finish crossing.
//
// ROOM IDENTITY. Everything here speaks the world's manifest room id ("design-room"); the host translates
// V1's flat id ("design-team") through data/office-layout's flatRoomIdForRoomLayer, the one existing
// bridge — this file adds no table.
//
// LIMIT. A room with no door entity (Meeting, Project, the hub) has no threshold to hold; routing intent
// into it is still refused by the world's walk entry point (see world.ts), but PLAYER mode can walk in.
import { CELL, type Cell } from "../adapters/v1Grid";
import { circleOverlapsRect, pointInRect, type Rect, type Vec2 } from "../core/coords";
import type { WorldState } from "../world/WorldState";
import { segmentHitsRect } from "../interact/Door";

/** How far beyond the crossing, on the OUTSIDE, the "standing at a locked door" zone reaches. Two cells:
 *  where a walk to the door stops, and where a PLAYER pressing against the shut door stands. */
export const LOCK_APPROACH_DEPTH = 2 * CELL;
/** Reservation owner prefix — one owner per door so doors are held and released independently. */
export const ROOM_LOCK_RESERVATION = "dnd-room-lock";

export interface LockedDoor {
  entityId: string;
  /** The manifest room this door belongs to (the entity's roomId). */
  roomId: string;
  /** The leaf's sweep band — what is reserved. */
  crossing: Rect;
  /** Where somebody stopped by the lock stands: just outside the crossing, centred on the doorway. */
  standPoint: Vec2;
  /** The outside approach band: the crossing pushed LOCK_APPROACH_DEPTH outward. */
  approach: Rect;
  cells: Cell[];
}

function rasterise(r: Rect): Cell[] {
  const out: Cell[] = [];
  for (let cy = Math.floor(r.z / CELL); cy <= Math.floor((r.z + r.d - 0.001) / CELL); cy++)
    for (let cx = Math.floor(r.x / CELL); cx <= Math.floor((r.x + r.w - 0.001) / CELL); cx++) out.push({ cx, cy });
  return out;
}

/** Every door the world has, with its outside worked out from the world's own regions: the side of the
 *  crossing whose floor is NOT this door's room. A door whose both sides read as its room (or as nothing)
 *  falls back to the far side of the room's centre. */
export function collectLockableDoors(world: WorldState): LockedDoor[] {
  const out: LockedDoor[] = [];
  for (const e of world.entities.values()) {
    const door = e.capabilities.door;
    if (!door) continue;
    const c = door.crossing;
    const centre = { x: c.x + c.w / 2, z: c.z + c.d / 2 };
    // The thin axis of the crossing is the direction through the doorway.
    const alongX = c.w < c.d; // thin in x → the doorway runs along z, cross it in x
    const half = (alongX ? c.w : c.d) / 2;
    const probe = half + CELL;
    const plus = alongX ? { x: centre.x + probe, z: centre.z } : { x: centre.x, z: centre.z + probe };
    const minus = alongX ? { x: centre.x - probe, z: centre.z } : { x: centre.x, z: centre.z - probe };
    const plusIsRoom = world.regionAt(plus)?.roomId === e.roomId;
    const minusIsRoom = world.regionAt(minus)?.roomId === e.roomId;
    let outward = 1;
    if (plusIsRoom && !minusIsRoom) outward = -1;
    else if (!plusIsRoom && minusIsRoom) outward = 1;
    else {
      const room = world.rooms.get(e.roomId);
      const rc = room ? { x: room.rect.x + room.rect.w / 2, z: room.rect.z + room.rect.d / 2 } : centre;
      outward = (alongX ? centre.x - rc.x : centre.z - rc.z) >= 0 ? 1 : -1;
    }
    const standPoint = alongX
      ? { x: centre.x + outward * (half + LOCK_APPROACH_DEPTH / 2), z: centre.z }
      : { x: centre.x, z: centre.z + outward * (half + LOCK_APPROACH_DEPTH / 2) };
    const approach: Rect = alongX
      ? { x: outward > 0 ? c.x + c.w : c.x - LOCK_APPROACH_DEPTH, z: c.z, w: LOCK_APPROACH_DEPTH, d: c.d }
      : { x: c.x, z: outward > 0 ? c.z + c.d : c.z - LOCK_APPROACH_DEPTH, w: c.w, d: LOCK_APPROACH_DEPTH };
    out.push({ entityId: e.id, roomId: e.roomId, crossing: c, standPoint, approach, cells: rasterise(c) });
  }
  return out;
}

export interface RoomLockWalkability {
  reserve(owner: string, cells: Cell[]): void;
  release(owner: string): void;
}

export interface RoomLockSnapshot {
  locked: string[];
  authorized: string | null;
  held: string[];
}

/**
 * The controller. Holds the set of locked rooms and at most one one-shot entry authorisation, and applies
 * them to the walkability as door reservations from the body's real position, each frame, writing only on
 * change (exactly as app/world.ts's applyExitGate does).
 */
export class RoomLockController {
  private readonly doors: LockedDoor[];
  private readonly walkability: RoomLockWalkability;
  private readonly roomAt: (p: Vec2) => string | null;
  private readonly bodyRadius: number;
  private locked = new Set<string>();
  private authorized: string | null = null;
  private readonly heldNow = new Set<string>();

  constructor(doors: LockedDoor[], walkability: RoomLockWalkability, roomAt: (p: Vec2) => string | null, bodyRadius: number) {
    this.doors = doors;
    this.walkability = walkability;
    this.roomAt = roomAt;
    this.bodyRadius = bodyRadius;
  }

  /** Which manifest rooms are locked right now — V1's answer, translated by the host. */
  setLocked(roomIds: Iterable<string>): void {
    this.locked = new Set(roomIds);
    // A lock that lifted takes any authorisation for that room with it: there is nothing left to spend
    // it on, and it must not linger for a later, separate lock.
    if (this.authorized !== null && !this.locked.has(this.authorized)) this.authorized = null;
  }

  /** ONE entry into `roomId`, spent the moment the body is inside that room. Null withdraws it. */
  authorize(roomId: string | null): void {
    this.authorized = roomId;
  }

  isLocked(roomId: string | null | undefined): boolean {
    return roomId != null && this.locked.has(roomId);
  }

  /** Is this room shut against the body standing at `at`? Locked, not authorised, and the body outside. */
  refuses(roomId: string | null | undefined, at: Vec2): boolean {
    if (!this.isLocked(roomId)) return false;
    if (this.authorized === roomId) return false;
    return this.roomAt(at) !== roomId;
  }

  doorsOf(roomId: string): LockedDoor[] {
    return this.doors.filter((d) => d.roomId === roomId);
  }

  /** The door of `roomId` nearest to `to` — where a refused walk goes instead. Null for a doorless room. */
  nearestDoor(roomId: string, to: Vec2): LockedDoor | null {
    let best: LockedDoor | null = null;
    let bestD = Infinity;
    for (const d of this.doorsOf(roomId)) {
      const dist = Math.hypot(d.standPoint.x - to.x, d.standPoint.z - to.z);
      if (dist < bestD) { bestD = dist; best = d; }
    }
    return best;
  }

  /**
   * Apply from the body's real position. Returns true when a reservation was written (so the caller can
   * refresh its navigation debug layer), and spends the authorisation once the body is inside that room.
   */
  apply(at: Vec2): boolean {
    const here = this.roomAt(at);
    if (this.authorized !== null && here === this.authorized) this.authorized = null; // spent on entry
    let changed = false;
    for (const d of this.doors) {
      const hold =
        this.locked.has(d.roomId) &&
        this.authorized !== d.roomId &&
        here !== d.roomId &&
        // Never clamp a body already in the threshold — let it finish crossing, either way.
        !circleOverlapsRect(at, this.bodyRadius, d.crossing);
      const was = this.heldNow.has(d.entityId);
      if (hold === was) continue;
      changed = true;
      if (hold) {
        this.heldNow.add(d.entityId);
        this.walkability.reserve(`${ROOM_LOCK_RESERVATION}:${d.entityId}`, d.cells);
      } else {
        this.heldNow.delete(d.entityId);
        this.walkability.release(`${ROOM_LOCK_RESERVATION}:${d.entityId}`);
      }
    }
    return changed;
  }

  /** Is the body standing at a HELD door, on the outside? The room it is being kept out of, or null. */
  interceptedAt(at: Vec2): string | null {
    for (const d of this.doors) {
      if (!this.heldNow.has(d.entityId)) continue;
      if (pointInRect(at, d.approach) || circleOverlapsRect(at, this.bodyRadius, d.approach)) return d.roomId;
    }
    return null;
  }

  /** Does this planned route pass through any held doorway? (A route planned before the hold landed.)
   *  Judged on the route's SEGMENTS, as SlidingDoor judges its own opening — waypoints are sparse. */
  routeCrossesHeld(path: readonly Vec2[]): boolean {
    if (path.length === 0) return false;
    for (const d of this.doors) {
      if (!this.heldNow.has(d.entityId)) continue;
      let prev = path[0];
      if (pointInRect(prev, d.crossing)) return true;
      for (const p of path) { if (segmentHitsRect(prev, p, d.crossing)) return true; prev = p; }
    }
    return false;
  }

  snapshot(): RoomLockSnapshot {
    return { locked: [...this.locked].sort(), authorized: this.authorized, held: [...this.heldNow].sort() };
  }

  /** Release everything (dispose). */
  clear(): void {
    for (const id of this.heldNow) this.walkability.release(`${ROOM_LOCK_RESERVATION}:${id}`);
    this.heldNow.clear();
  }
}
