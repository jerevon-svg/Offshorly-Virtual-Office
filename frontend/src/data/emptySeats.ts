import { rooms } from "./office-layout";
import { seatsForRoomId, type Seat } from "./roomSeats";

// A clickable "empty seat" marker target — a real painted chair (Seat) plus
// enough identity (roomId + index within that room's seatsForRoomId() array)
// to walk to it and to build a stable React key. `key` intentionally does
// NOT encode the seat's coordinates (unlike seatCentroidKey below) — it only
// needs to be unique per seat across renders, which room+index already
// guarantees since seatsForRoomId's ordering is stable (see roomSeats.ts).
export interface SeatTarget extends Seat {
  roomId: string;
  index: number;
  key: string;
}

// Rounds a seat centroid into a stable string key for occupancy comparison.
// Seat centroids are computed once at module load (roomSeats.ts) and never
// change, so exact float equality would work too, but rounding guards
// against any future floating-point drift between two independently-computed
// references to "the same" seat (e.g. a roster layer's center vs. the raw
// Seat.x/y it was built from).
export function seatCentroidKey(x: number, y: number): string {
  return `${Math.round(x)},${Math.round(y)}`;
}

// Every painted seat, across every room, that is NOT in `occupiedCentroidKeys`
// — i.e. every seat safe to render as a "click to sit" marker. Occupied seats
// (someone already seated there, including the viewer's own current seat)
// get no marker at all, per the click-to-sit feature's design decision.
export function computeEmptySeats(occupiedCentroidKeys: Set<string>): SeatTarget[] {
  const result: SeatTarget[] = [];
  for (const room of rooms) {
    const seats = seatsForRoomId(room.id);
    seats.forEach((seat, index) => {
      if (occupiedCentroidKeys.has(seatCentroidKey(seat.x, seat.y))) return;
      result.push({
        ...seat,
        roomId: room.id,
        index,
        key: `${room.id}#${index}`,
      });
    });
  }
  return result;
}
