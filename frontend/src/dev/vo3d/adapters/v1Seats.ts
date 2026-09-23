// vo3d adapter — THE ONE JOIN BETWEEN V2's CHAIRS AND V1's SEATS. Phase 6C.
//
// V1 identifies a seat by the centroid of its painted chair (data/emptySeats.ts seatCentroidKey, the
// `seatKey` on walk_arrived and in employee_positions). V2 identifies a sittable spot by an entity id
// (app/seats.ts). Neither side knows the other's vocabulary, and every Phase before this one published
// `seatKey: null` for exactly that reason (adapters/v1SelfMovement's old "NEVER CLAIMS A SEAT" rule).
//
// THE MAPPING IS EXPLICIT AND VALIDATED, NOT A RUNTIME PROXIMITY GUESS. It is computed ONCE from two
// static tables — V1's painted/manifest seats and V2's authored room data — and every anchor resolves to
// AT MOST ONE V1 seat, by these rules in order:
//
//   1. an explicit override (EXPLICIT_SEAT_KEYS), for the day a chair needs a hand decision;
//   2. V1 PROVENANCE: an entity derived from the production manifest carries the V1 furniture layer id
//      (adapters/v1Manifest `source.v1LayerId`), and V1's manifest-driven seats carry the same id as
//      `furnitureId` — an exact identity, no geometry involved. Refused when that furniture is split into
//      several V1 sub-seats (a sofa), because the id alone cannot say which cushion;
//   3. GEOMETRY, strictly: the anchor's position undone into V1 frame units (the same v1FramePoint the
//      movement sink publishes through) must have EXACTLY ONE V1 seat within TOLERANCE. Two candidates
//      is ambiguous and is refused, whatever their distances — the second-nearest being a little farther
//      is not a decision this module is allowed to make on somebody's behalf.
//
// Then ONE-TO-ONE is enforced over the whole result: a V1 seat claimed by two anchors is released from
// both. Whatever is left unmapped is reported, by id and by reason, as V2-ONLY.
//
// A V2-ONLY SEAT IS STILL A SEAT. A sit in one is published as V1's `state: "sitting"` with a NAMESPACED
// seat key — `v2:<anchor id>` (v2SeatKey below) — never a fabricated centroid key. The namespace is what
// keeps V1 honest about it: V1's own keys are "x,y" centroids, so this can collide with none of them;
// V1's occupancy read adds it to a set that no painted chair matches (nothing is hidden); V1's own seated
// restore finds no seat for it and takes its existing "desk" fallback; and V1's peer sprite sits at the
// published body position, which is where the person is. The backend stores it as the opaque string
// seat_key already is (String(255)) and its occupancy check works on any string, so two V2 sessions
// cannot both be granted one café chair. Nothing about V1's tables or rules changes.
//
// Pure, and given its inputs rather than importing them, in `buildSeatMapping`; `seatMapping()` is the
// memoised production instance over the real tables.
import { rooms } from "../../../data/office-layout";
import { seatsForRoomId } from "../../../data/roomSeats";
import { seatCentroidKey } from "../../../data/emptySeats";
import type { WalkDirection } from "../../../data/bonWalkFrames";
import { ROOM_WORLD_SHIFT_Z } from "../rooms/ground-floor";
import { v1FramePoint } from "../app/spawn";
import { groundFloorSeatAnchors, type Vo3dSeatAnchor } from "../app/seats";
import { v1Rooms } from "./v1Floor";
import type { Vec2 } from "../core/coords";

/** One V1 seat as V1 itself defines it — the centroid, the chair's own direction, and the key that goes
 *  on the wire. `roomId` is the flat rooms/teamRooms-namespace id seatsForRoomId is called with. */
export interface V1SeatIdentity {
  key: string;
  roomId: string;
  /** the centroid, V1 frame units — V1 draws a seated sprite centred here */
  x: number;
  y: number;
  direction: WalkDirection;
  furnitureId?: string;
}

export type SeatUnsupportedReason = "no-v1-seat" | "ambiguous-v1-seats" | "shared-v1-seat";

export interface Vo3dSeatMapping {
  /** anchor id → the V1 seat it IS */
  byAnchor: ReadonlyMap<string, V1SeatIdentity>;
  /** V1 seat key → the anchor it IS */
  byKey: ReadonlyMap<string, Vo3dSeatAnchor>;
  /** every anchor with no V1 identity, and why — V2-only chairs, clearly named */
  unsupported: readonly { id: string; reason: SeatUnsupportedReason }[];
  /** V1 seats no anchor claims — a V1 sitter there reads to V2 as standing at the centroid */
  unmatchedV1Keys: readonly string[];
}

/** How far, in V1 frame units, an anchor may be from a V1 centroid and still be the same chair. A V1
 *  chair art box is about 16–26 units across and a flood-filled centroid can sit a few units off the
 *  chair's centre; the tightest real neighbours on the floor are the dev sofa's cushions (17 apart) and
 *  the executive visitor row (25 apart), so 14 never admits a second candidate for a chair that has one
 *  match, while the executive east sofa's mirrored cushions (11.5 off) still resolve. */
export const SEAT_MATCH_TOLERANCE = 14;

/** Hand decisions. Empty today: every mapping below is derived and validated. An entry here wins over
 *  provenance and geometry for its anchor, and is still subject to the one-to-one rule. */
export const EXPLICIT_SEAT_KEYS: Readonly<Record<string, string>> = {
  // Reception's sofas: V1 flood-fills each as ONE seat at its centre, 20 units from either of V2's two
  // cushions — geometry alone cannot choose, so the north cushion carries V1's identity (a V1 sitter
  // appears there; a V2 sitter there is V1's sofa seat). The south cushion stays V2-only.
  "reception-room/sofa-west#sofa-west-north": "416,1056",
  "reception-room/sofa-east#sofa-east-north": "1024,1056",
};

/** The namespace of a V2-ONLY seat's wire key. A V1 centroid key is "x,y" and can never start with this. */
export const V2_SEAT_KEY_PREFIX = "v2:";
/** The wire key for a V2-only anchor. */
export const v2SeatKey = (anchorId: string): string => `${V2_SEAT_KEY_PREFIX}${anchorId}`;
export const isV2SeatKey = (key: string | null | undefined): boolean => typeof key === "string" && key.startsWith(V2_SEAT_KEY_PREFIX);

/** Every V1 seat on the floor, across every flat room, with its wire key. */
export function allV1Seats(): V1SeatIdentity[] {
  const out: V1SeatIdentity[] = [];
  for (const room of rooms) {
    for (const seat of seatsForRoomId(room.id)) {
      out.push({ key: seatCentroidKey(seat.x, seat.y), roomId: room.id, x: seat.x, y: seat.y, direction: seat.direction, ...(seat.furnitureId ? { furnitureId: seat.furnitureId } : {}) });
    }
  }
  return out;
}

export interface SeatMappingOptions {
  /** world point → V1 frame point (room shifts undone). Defaults to the identity for tests. */
  toV1Frame?: (p: Vec2) => Vec2;
  tolerance?: number;
  explicit?: Readonly<Record<string, string>>;
}

export function buildSeatMapping(anchors: readonly Vo3dSeatAnchor[], v1Seats: readonly V1SeatIdentity[], opts: SeatMappingOptions = {}): Vo3dSeatMapping {
  const toV1Frame = opts.toV1Frame ?? ((p) => p);
  const tolerance = opts.tolerance ?? SEAT_MATCH_TOLERANCE;
  const explicit = opts.explicit ?? EXPLICIT_SEAT_KEYS;

  const byKeyV1 = new Map<string, V1SeatIdentity>();
  const byFurniture = new Map<string, V1SeatIdentity[]>();
  for (const s of v1Seats) {
    byKeyV1.set(s.key, s);
    if (s.furnitureId) {
      const list = byFurniture.get(s.furnitureId) ?? [];
      list.push(s);
      byFurniture.set(s.furnitureId, list);
    }
  }

  const tentative = new Map<string, V1SeatIdentity>();
  const unsupported: { id: string; reason: SeatUnsupportedReason }[] = [];
  for (const anchor of anchors) {
    const forced = explicit[anchor.id];
    if (forced !== undefined) {
      const s = byKeyV1.get(forced);
      if (s) { tentative.set(anchor.id, s); continue; }
      unsupported.push({ id: anchor.id, reason: "no-v1-seat" });
      continue;
    }
    if (anchor.v1LayerId) {
      const same = byFurniture.get(anchor.v1LayerId);
      if (same && same.length === 1) { tentative.set(anchor.id, same[0]); continue; }
    }
    const p = toV1Frame(anchor.point);
    const near = v1Seats.filter((s) => Math.hypot(s.x - p.x, s.y - p.z) <= tolerance);
    if (near.length === 1) tentative.set(anchor.id, near[0]);
    else unsupported.push({ id: anchor.id, reason: near.length === 0 ? "no-v1-seat" : "ambiguous-v1-seats" });
  }

  // ONE-TO-ONE. A V1 seat two anchors both resolve to is nobody's.
  const claims = new Map<string, string[]>();
  for (const [id, s] of tentative) {
    const list = claims.get(s.key) ?? [];
    list.push(id);
    claims.set(s.key, list);
  }
  const byAnchor = new Map<string, V1SeatIdentity>();
  const byKey = new Map<string, Vo3dSeatAnchor>();
  const anchorById = new Map(anchors.map((a) => [a.id, a]));
  for (const [key, ids] of claims) {
    if (ids.length !== 1) {
      for (const id of ids) unsupported.push({ id, reason: "shared-v1-seat" });
      continue;
    }
    const s = byKeyV1.get(key)!;
    byAnchor.set(ids[0], s);
    byKey.set(key, anchorById.get(ids[0])!);
  }
  unsupported.sort((a, b) => a.id.localeCompare(b.id));
  const unmatchedV1Keys = v1Seats.filter((s) => !byKey.has(s.key)).map((s) => s.key);
  return { byAnchor, byKey, unsupported, unmatchedV1Keys };
}

let memo: Vo3dSeatMapping | null = null;
/** THE PRODUCTION MAPPING, over the real ground floor and the real painted seats, through the same room
 *  shift table the movement sink publishes through. Computed once per session. */
export function seatMapping(): Vo3dSeatMapping {
  if (!memo) {
    const frameRooms = v1Rooms();
    memo = buildSeatMapping(groundFloorSeatAnchors(), allV1Seats(), { toV1Frame: (p) => v1FramePoint(p, frameRooms, ROOM_WORLD_SHIFT_Z) });
  }
  return memo;
}

/** The V1 seat a V2 anchor IS, or null for an unsupported (V2-only) chair. */
export const v1SeatForAnchor = (anchorId: string): V1SeatIdentity | null => seatMapping().byAnchor.get(anchorId) ?? null;
/** The V2 anchor a wire seat key IS — a V1 centroid key through the mapping, or a `v2:` key naming an
 *  anchor that exists on this floor — or null when V2 has no chair for it. */
export function anchorForSeatKey(seatKey: string | null | undefined): Vo3dSeatAnchor | null {
  if (!seatKey) return null;
  if (isV2SeatKey(seatKey)) {
    const id = seatKey.slice(V2_SEAT_KEY_PREFIX.length);
    return groundFloorSeatAnchors().find((a) => a.id === id) ?? null;
  }
  return seatMapping().byKey.get(seatKey) ?? null;
}

/** Test-only: forget the memoised production mapping. */
export function __resetSeatMappingForTests(): void { memo = null; }
