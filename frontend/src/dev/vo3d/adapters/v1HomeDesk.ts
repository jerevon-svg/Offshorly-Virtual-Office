// vo3d adapter — READ-ONLY view of the desk V1 has ALREADY assigned to the signed-in employee.
//
// Same contract as adapters/v1Identity.ts and for the same reasons: every input is either a module
// constant parsed at build time (the painted seats, the room table, the door stand points) or state V1
// resolved before the V2 route could render (currentUserStore, populated by useAuthGate's one
// GET /api/v1/auth/me). So this is synchronous, has no loading state, and cannot issue a request — which
// is what keeps apiFetch's 401 -> /login redirect off this route.
//
// THE RULE IS NOT RESTATED HERE. data/homeSeat.ts holds it, and V1's own office
// (components/OfficeMap/OfficeMap.tsx resolveOwnSeat) calls the same function — so "V2 lands you at your
// desk" and "V1 lands you at your desk" are one decision, not two that look alike.
//
// WHAT THIS DELIBERATELY DOES NOT DO:
//   • It does not read attendance. V1's spawn gate (spawnPlacement.ts) is the only thing entitled to say
//     where a person actually IS: CHECKED_OUT belongs on the sidewalk, and a persisted interior position
//     is valid only while CHECKED_IN. V2 reads none of that, so what it produces is a PREVIEW of a desk,
//     never a claim about a work session — and it must never be dressed up as one.
//   • It does not fall back to Reception. roomIdForPerson() returns null for anyone whose department maps
//     to no hand-drawn room, and V1 substitutes FALLBACK_ROOM_ID (reception-room) at that point so the
//     person is still visible on its floor. V2 has no such duty, and standing an unplaced employee in
//     Reception here would read as "checked in, waiting at the front desk" — the exact thing the sidewalk
//     placement exists to say instead. Unresolved means NO desk, and the world keeps its own default.
//   • It does not persist, publish or move anything. No socket, no walk_arrived, no employee_positions.
import { getCurrentUser } from "../../../auth/currentUserStore";
import { resolveHomeDesk } from "../../../data/homeSeat";
import { roomIdForPerson } from "../../../data/roomIdentity";
import type { WalkDirection } from "../../../data/bonWalkFrames";
import type { Facing } from "../core/coords";
import type { Vo3dHomeDesk } from "../app/spawn";

/** V1's sprite facing → V2's world facing. V1 names the direction the CAMERA sees ("front" = the sprite's
 *  front is toward the viewer); V2 names the compass direction the body looks along. The office is drawn
 *  with south toward the viewer, so the two vocabularies line up one-to-one — the same reading every
 *  reconstructed room's seat comments already record ("facing 'front' = south into its desk"). */
const FACING_BY_DIRECTION: Record<WalkDirection, Facing> = {
  front: "south",
  back: "north",
  left: "west",
  right: "east",
};

/**
 * The signed-in employee's own desk, or NULL when V1 does not know of one.
 *
 * Null is returned — not a guess and not a fallback seat — in every one of these cases, and the world
 * then keeps the default spawn it has always had:
 *   • V1 could not parse an identity at all (currentUserStore is empty).
 *   • The employee resolves to no assigned room (see the Reception note above).
 *   • Their assigned room has no hand-painted seats yet, so there is no desk to stand at.
 */
export function resolveVo3dHomeDesk(): Vo3dHomeDesk | null {
  const user = getCurrentUser();
  if (!user || !user.email) return null;

  // Asked FIRST, and separately from resolveHomeDesk() below, because the two questions have different
  // answers: resolveHomeDesk applies V1's reception fallback internally (it must — V1 has a floor to
  // fill), while this preview refuses it. Same function, same arguments, so the two can never disagree
  // about which room a person who HAS one belongs to.
  const assigned = roomIdForPerson(user.email, user.team ?? null);
  if (!assigned) return null;

  const { roomId, seat } = resolveHomeDesk(user.email, user.team ?? null);
  if (!seat) return null;

  return {
    roomId,
    // The seat centroid IS the centre point; nothing is offset by a sprite box here. See Vo3dHomeDesk.
    point: { x: seat.x, z: seat.y },
    facing: FACING_BY_DIRECTION[seat.direction],
  };
}
