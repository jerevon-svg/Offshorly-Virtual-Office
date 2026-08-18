import { describe, expect, it } from "vitest";
import { computeEmptySeats, seatCentroidKey } from "./emptySeats";
import { seatsForRoomId } from "./roomSeats";
import { rooms } from "./office-layout";

describe("computeEmptySeats", () => {
  it("reports every seat in a room as empty when nobody occupies it", () => {
    const seats = seatsForRoomId("ai-room");
    expect(seats.length).toBeGreaterThan(0);

    const empty = computeEmptySeats(new Set());
    const aiRoomEmpty = empty.filter((s) => s.roomId === "ai-room");
    expect(aiRoomEmpty).toHaveLength(seats.length);
  });

  it("excludes only the occupied seats in a partially-filled room", () => {
    const seats = seatsForRoomId("ai-room");
    expect(seats.length).toBeGreaterThan(1);
    const occupied = new Set([seatCentroidKey(seats[0].x, seats[0].y)]);

    const empty = computeEmptySeats(occupied);
    const aiRoomEmpty = empty.filter((s) => s.roomId === "ai-room");
    expect(aiRoomEmpty).toHaveLength(seats.length - 1);
    expect(aiRoomEmpty.some((s) => s.x === seats[0].x && s.y === seats[0].y)).toBe(false);
  });

  it("reports zero empty seats for a fully-occupied room", () => {
    const seats = seatsForRoomId("ai-room");
    const occupied = new Set(seats.map((s) => seatCentroidKey(s.x, s.y)));

    const empty = computeEmptySeats(occupied);
    expect(empty.filter((s) => s.roomId === "ai-room")).toHaveLength(0);
  });

  it("reports zero empty seats for a room when overflow occupies every real chair plus more", () => {
    // Overflow (more people than painted chairs) means every real seat is
    // occupied by someone — the overflow remainder itself has no seat
    // centroid at all (packed grid, see rosterLayers.ts), so it never shows
    // up as an "occupied" key in the first place, and every real seat is
    // still correctly excluded here.
    const seats = seatsForRoomId("dev-team");
    expect(seats.length).toBeGreaterThan(0);
    const occupied = new Set(seats.map((s) => seatCentroidKey(s.x, s.y)));

    const empty = computeEmptySeats(occupied);
    expect(empty.filter((s) => s.roomId === "dev-team")).toHaveLength(0);
  });

  it("excludes the viewer's own current seat when they are sitting in it", () => {
    const seats = seatsForRoomId("qa-room");
    expect(seats.length).toBeGreaterThan(0);
    const viewerSeat = seats[0];
    const occupied = new Set([seatCentroidKey(viewerSeat.x, viewerSeat.y)]);

    const empty = computeEmptySeats(occupied);
    expect(
      empty.some(
        (s) => s.roomId === "qa-room" && s.x === viewerSeat.x && s.y === viewerSeat.y,
      ),
    ).toBe(false);
    // The rest of qa-room's seats remain reported as empty.
    expect(empty.filter((s) => s.roomId === "qa-room")).toHaveLength(seats.length - 1);
  });

  it("every returned seat's key is unique and encodes roomId + index", () => {
    const empty = computeEmptySeats(new Set());
    const keys = new Set(empty.map((s) => s.key));
    expect(keys.size).toBe(empty.length);
    for (const seat of empty) {
      expect(seat.key).toBe(`${seat.roomId}#${seat.index}`);
    }
  });

  it("covers every room in the rooms table", () => {
    const empty = computeEmptySeats(new Set());
    const totalSeats = rooms.reduce((sum, room) => sum + seatsForRoomId(room.id).length, 0);
    expect(empty).toHaveLength(totalSeats);
  });
});
