import type { WalkDirection } from "./bonWalkFrames";

// Fixed facing direction per seat — a seat's direction belongs to the CHAIR,
// never to whoever last sat in it. roomSeats.ts's seatsForRoomId() looks up
// each seat's direction here (by exact centroid cellKey), falling back to
// the room's own default direction, then to "front" if the room has no
// default either.
//
// Authoring is a plain code table (NOT a walkable-PNG repaint) — position-
// keyed by the seat's centroid coordinates, formatted via seatCellKey()
// below. See frontend/SEAT_DIRECTIONS_TODO.md for the full dump of every
// detected seat (room id + x,y) still needing a real assignment; this table
// is deliberately left mostly empty for now — filling in real directions for
// every seat (sofas, beanbags, visitor chairs, round meeting-room seats,
// dev-team overflow chairs, etc.) is explicitly deferred, not part of this
// change.
//
// Coordinates come from roomSeats.ts's centroidOf(), which can produce
// non-integer floats — seatCellKey() rounds to 2 decimal places so the key
// used here matches the key roomSeats.ts computes at lookup time, and
// matches what SEAT_DIRECTIONS_TODO.md dumps.
export function seatCellKey(x: number, y: number): string {
  return `${x.toFixed(2)},${y.toFixed(2)}`;
}

export interface RoomSeatDirections {
  /** Optional fallback for every seat in this room with no per-seat override
   *  below. Omit to fall through to the global "front" default instead. */
  default?: WalkDirection;
  /** Per-seat overrides, keyed by seatCellKey(seat.x, seat.y). */
  seats?: Record<string, WalkDirection>;
}

// Keyed by roomId (the `rooms`/teamRooms-namespace id from office-layout.ts,
// e.g. "dev-team", "design-team" — the same id seatsForRoomId() is called
// with). Empty/near-empty by design — see file header.
export const SEAT_DIRECTIONS: Record<string, {
  default?: WalkDirection;
  seats?: Record<string, WalkDirection>;
}> = {
  "ai-room": { seats: { "176.00,70.12": "front", "163.00,118.86": "back", "189.00,118.86": "back", "72.87,172.01": "right", "117.08,172.01": "left", "152.61,172.01": "right", "196.82,172.01": "left", "232.35,172.01": "right", "276.56,172.01": "left", "72.87,203.98": "right", "117.08,203.98": "left", "152.61,203.98": "right", "196.82,203.98": "left", "232.35,203.98": "right", "276.56,203.98": "left", "72.87,235.94": "right", "117.08,235.94": "left", "152.61,235.94": "right", "196.82,235.94": "left", "232.35,235.94": "right", "276.56,235.94": "left" } },
  "executive-team": { seats: { "588.41,91.68": "front", "864.22,91.68": "front", "726.20,158.69": "front", "551.46,162.22": "back", "576.09,162.22": "back", "600.72,162.22": "back", "625.35,162.22": "back", "827.26,162.22": "back", "851.90,162.22": "back", "876.53,162.22": "back", "901.16,162.22": "back", "680.00,178.22": "right", "769.78,178.22": "left", "680.00,205.33": "right", "769.78,205.33": "left", "680.00,232.44": "right", "769.78,232.44": "left", "726.20,254.84": "back", "880.95,258.18": "front" } },
  "dev-team": { seats: { "1207.81,75.02": "front", "1335.33,75.02": "front", "1196.41,118.49": "back", "1219.21,118.49": "back", "1323.93,118.49": "back", "1346.73,118.49": "back", "1176.71,156.47": "front", "1197.44,156.47": "front", "1218.18,156.47": "front", "1238.91,156.47": "front", "1304.23,156.47": "front", "1324.96,156.47": "front", "1345.70,156.47": "front", "1366.43,156.47": "front", "1174.68,232.78": "back", "1196.46,232.78": "back", "1218.23,232.78": "back", "1240.00,232.78": "back", "1302.20,232.78": "back", "1323.98,232.78": "back", "1345.75,232.78": "back", "1367.52,232.78": "back", "1144.47,252.71": "right", "1144.47,273.50": "right", "1144.47,294.28": "right" } },
  "cms-team": { seats: { "1240.00,408.00": "front", "1336.00,408.00": "front", "1208.00,504.00": "back", "1256.00,504.00": "back", "1320.00,504.00": "back", "1368.00,504.00": "back", "1216.00,536.00": "front", "1176.00,544.00": "right", "1256.00,552.00": "back", "1320.00,552.00": "back", "1368.00,552.00": "back" } },
  "qa-room": { seats: { "160.00,648.00": "front", "152.00,696.00": "back", "184.00,696.00": "back", "120.00,720.00": "right", "224.00,720.00": "left", "59.56,740.44": "right", "120.00,768.00": "right", "224.00,768.00": "left" } },
  "design-team": { seats: { "164.79,397.49": "front", "94.22,401.72": "left", "235.36,401.72": "right", "94.22,434.21": "left", "235.36,434.21": "right", "48.17,486.10": "right", "114.66,487.89": "back", "164.80,487.89": "back", "214.93,487.89": "back", "48.17,509.59": "right", "48.17,533.08": "right", "107.27,534.15": "front" } },
  "gaming-room": { seats: { "1400.00,688.00": "front", "1216.00,704.00": "right", "1328.00,704.00": "left", "1272.00,744.00": "front", "1392.00,744.00": "back", "1200.00,792.00": "front", "1248.00,792.00": "front", "1296.00,792.00": "front", "1344.00,792.00": "front" } },
  "project-room": { seats: { "1136.00,1008.00": "right", "1264.00,1008.00": "left", "1168.00,1088.00": "right", "1232.00,1088.00": "left" } },
  "meeting-room": { seats: { "128.00,984.00": "front", "176.00,984.00": "front", "216.00,984.00": "front", "128.00,1048.00": "back", "176.00,1048.00": "back", "216.00,1048.00": "back" } },
  "reception-room": { seats: { "477.82,1017.45": "front", "962.18,1017.45": "front", "416.00,1056.00": "right", "1024.00,1056.00": "left", "480.00,1112.00": "front", "960.00,1112.00": "back" } },
};

export function directionForSeat(roomId: string, x: number, y: number): WalkDirection {
  const room = SEAT_DIRECTIONS[roomId];
  const override = room?.seats?.[seatCellKey(x, y)];
  if (override) return override;
  if (room?.default) return room.default;
  return "front";
}
