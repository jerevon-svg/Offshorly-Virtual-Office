// A person's HOME DESK — the room they belong to, and the seat in it they are given.
//
// Lifted VERBATIM out of components/OfficeMap/OfficeMap.tsx (nearestSeatTo + resolveOwnSeat's body),
// which is still the only caller inside V1: that component now delegates here instead of holding its
// own copy. Nothing about the rule changed in the move — same order of checks, same fallbacks, same
// "null means the room has no painted seats" answer.
//
// WHY IT LEFT THE COMPONENT. The VO3D V2 preview has to land the signed-in employee at the SAME desk
// V1 would (see dev/vo3d/adapters/v1HomeDesk.ts). Re-deriving that in V2 would be a second rule that
// looks right until one of them is edited; importing OfficeMap.tsx would drag a React component and
// its whole world into a dev-only adapter. So the rule moved down here, to the data layer both sides
// already read, and the decision has exactly one home.
//
// PURE and SYNCHRONOUS: every input is a module constant parsed at build time. No React, no store, no
// fetch, no attendance. This says where a person's desk IS — never whether they are at it.
import { doorStandForRoom } from "./doorStandPoints";
import { rooms } from "./office-layout";
import { FALLBACK_ROOM_ID, roomIdForPerson } from "./roomIdentity";
import { seatsForRoomId, type Seat } from "./roomSeats";
import type { Pt } from "./walkable-zones";

// Plain nearest-seat lookup for a room's hand-painted seats, used only to
// give the LIVE player (bon) a real seat to walk to on check-in — deliberately
// separate from rosterLayers.ts's email-sorted seat assignment for OTHER
// colleagues' static portraits, since bon isn't part of that roster list.
// Returns null if the room has no painted seats yet (fallback: don't add a
// walk leg, keep today's exact behavior).
export function nearestSeatTo(roomId: string, point: Pt): Seat | null {
  const seats = seatsForRoomId(roomId);
  if (seats.length === 0) return null;
  let best = seats[0];
  let bestDist = Infinity;
  for (const seat of seats) {
    const dx = seat.x - point.x;
    const dy = seat.y - point.y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = seat;
    }
  }
  return best;
}

/** A home desk: the flat (`rooms`/`teamRooms`-namespace) room id, and the seat inside it — `null` when
 *  that room has no painted seats at all, which callers treat as "stand, don't sit". */
export interface HomeDesk {
  roomId: string;
  seat: Seat | null;
}

// The person's own seat — nearest real detected seat to the room's door-in
// point (or the room's center, for rooms with no painted door stand-point
// pair yet), NEVER the roster's email-sorted seats[i] assignment
// (rosterLayers.ts's officePeopleToLayers), which any other roster person can
// land past into the overflow fallback.
//
// Always carries the seat's OWN fixed direction (roomSeats/seatDirections) —
// a seat's facing belongs to the chair, not to whoever last sat in it.
// Callers that have a better answer for a LIVE session (self's last synced
// facing) override it themselves; this function has no session to read.
export function resolveHomeDesk(
  email: string | null | undefined,
  departmentName: string | null | undefined,
): HomeDesk {
  const roomId = roomIdForPerson(email, departmentName) ?? FALLBACK_ROOM_ID;
  const doorPair = doorStandForRoom(roomId);
  if (doorPair) return { roomId, seat: nearestSeatTo(roomId, doorPair.inStand) };
  const flatRoom = rooms.find((r) => r.id === roomId);
  if (!flatRoom) return { roomId, seat: null };
  const center = { x: flatRoom.x + flatRoom.width / 2, y: flatRoom.y + flatRoom.height / 2 };
  return { roomId, seat: nearestSeatTo(roomId, center) };
}
