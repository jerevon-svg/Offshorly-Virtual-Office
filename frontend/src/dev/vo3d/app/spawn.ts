// vo3d app — THE HOME-DESK CONTRACT, the Phase 3 counterpart to identity.ts.
//
// Same split, same reason: the V1 side (adapters/v1HomeDesk.ts) reads V1's stores and therefore pulls in
// V1's auth store, while app/world.ts must stay loadable by the standalone dev page with no V1 auth
// anywhere in its graph. The type both sides name lives here, in a module that imports nothing but V2's
// own coordinate leaf, so world.ts can speak this shape without importing the adapter.
//
// WHAT A HOME DESK IS — AND IS NOT.
//
// It is V1's answer to "which desk is this employee's", resolved by exactly the rule V1's own office uses
// (data/homeSeat.ts, the module components/OfficeMap/OfficeMap.tsx now delegates to): their assigned room,
// then the seat in it nearest that room's door-in stand point. Nothing more.
//
// It is NOT attendance, and it is NOT a restored position. V1's spawn decision (spawnPlacement.ts) is
// gated on a server-authoritative work session — CHECKED_OUT puts a person on the SIDEWALK, and a
// persisted interior position is only valid while CHECKED_IN. V2 reads NONE of that: no attendance call,
// no movement socket, no employee_positions. So this is a PREVIEW — "here is where your desk is" — and
// the one reading it must never present it as "you are checked in", nor stand an employee in Reception as
// a substitute for the sidewalk V1 would have put them on.
//
// COORDINATES ARE V1'S, deliberately. `point` is in the V1 frame — the same basis the painted grid, the
// manifest and the seat centroids are authored in. V2 rooms may be BUILT away from their V1 art box
// (rooms/design-room WORLD_SHIFT_Z: the Design Room stands 16 units south of it), and that shift is V2's
// own fact about its own geometry. Applying it is world.ts's job, through homeDeskWorldPoint() below, so
// the adapter never has to know a V2 room moved and the shift keeps exactly one source.
import { pointInRect, type Facing, type Rect, type Vec2 } from "../core/coords";

export interface Vo3dHomeDesk {
  /** The flat (`rooms`/`teamRooms`-namespace) V1 room id the desk was resolved in, e.g. "design-team".
   *  Carried for the dev readout and for tests; V2 geometry is not keyed on it. */
  roomId: string;
  /** The seat centroid, IN V1 FRAME UNITS. Already a CENTRE point — roomSeats.ts builds it as the
   *  centroid of the painted chair blob — so there is no sprite top-left to undo here, and none is
   *  undone. A future conversion that does start from a persisted top-left position must use THAT
   *  employee's own manifest layer dimensions; it must never reuse Bon's box (adapters/v1Pathfinding.ts
   *  does exactly that, and is a TESTS-ONLY oracle for precisely that reason). */
  point: Vec2;
  /** The seat's OWN fixed direction, translated from V1's sprite facing. The direction belongs to the
   *  chair, never to whoever last sat in it. */
  facing: Facing;
}

/** A room as the V1 manifest paints it — its art box, BEFORE any V2 world shift. `adapters/v1Floor`'s
 *  `v1Rooms()` returns exactly this shape; declared structurally so this module stays a leaf. */
export interface V1ArtBox {
  id: string;
  rect: Rect;
}

/** WHERE A V1 DESK POINT ACTUALLY IS IN THE BUILT V2 WORLD.
 *
 *  A declared world shift moves a room as ONE unit — geometry, regions, seats and stand points together
 *  (rooms/ground-floor ROOM_WORLD_SHIFT_Z) — so a point inside a room's V1 art box lands at that point
 *  plus the room's shift. Rooms with no entry in the table (every room but the Design Room today) return
 *  the point unchanged, and so does a point in no room's art box at all, which is the corridor case.
 *
 *  Pure, and given its inputs rather than importing them, so the world and its tests can run the very
 *  same arithmetic instead of two copies that agree until one is edited. */
export function homeDeskWorldPoint(point: Vec2, artBoxes: readonly V1ArtBox[], shifts: Record<string, number>): Vec2 {
  const box = artBoxes.find((r) => pointInRect(point, r.rect));
  const dz = box ? shifts[box.id] ?? 0 : 0;
  return { x: point.x, z: point.z + dz };
}

/** THE INVERSE of homeDeskWorldPoint: a point in the BUILT world, expressed back in V1 frame units.
 *
 *  Needed the moment V2 stopped only READING V1's coordinates and started PUBLISHING into them (Phase 5:
 *  the signed-in employee's own movement). The forward direction asks which V1 art box contains a V1
 *  point; the inverse has to ask which room's SHIFTED rect — where the room actually stands in the world —
 *  contains the world point, and then undo that room's shift.
 *
 *  Only rooms with a declared shift are consulted, because a room with no shift returns the point
 *  unchanged either way, and a point in no shifted room is the corridor/exterior case — also unchanged.
 *
 *  NOT A BIJECTION IN THE SEAM BAND, and deliberately not faked into one: a shifted room's art box and
 *  its shifted rect overlap over all but `dz` units, and the `dz`-deep strip each end belongs to exactly
 *  one of the two. A point there resolves to whichever rect actually contains it, which is the honest
 *  answer — that strip is the room's own wall/floor seam, not a place a body stands and walks from.
 *
 *  Pure, and given its inputs rather than importing them, exactly like homeDeskWorldPoint above. */
export function v1FramePoint(p: Vec2, artBoxes: readonly V1ArtBox[], shifts: Record<string, number>): Vec2 {
  for (const box of artBoxes) {
    const dz = shifts[box.id] ?? 0;
    if (dz === 0) continue;
    if (pointInRect(p, { ...box.rect, z: box.rect.z + dz })) return { x: p.x, z: p.z - dz };
  }
  return p;
}
