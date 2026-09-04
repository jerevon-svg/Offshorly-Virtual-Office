import { describe, expect, it } from "vitest";
import type { Seat } from "../../data/roomSeats";
import {
  canOfferCheckIn,
  canSelfFreeWalk,
  insideOfficeValidator,
  resolveSpawnPlacement,
  type PlacementContext,
  type SelfStableSnapshot,
} from "./spawnPlacement";

const SIZE = { w: 20, h: 40 };
const SEAT: Seat = { x: 110, y: 220, direction: "front" };
const SEAT_KEY = "seat-110-220";

function ctx(overrides: Partial<PlacementContext> = {}): PlacementContext {
  return {
    avatarSize: SIZE,
    isInsideOffice: () => true,
    isWalkable: () => true,
    isRoomLocked: () => false,
    findSeat: (_c, key) => (key === SEAT_KEY ? SEAT : null),
    ...overrides,
  };
}

const standing: SelfStableSnapshot = {
  pos: { x: 100, y: 200 },
  facing: "left",
  state: "standing",
  seatKey: null,
  roomId: "central-hub",
};
const seated: SelfStableSnapshot = { ...standing, state: "sitting", seatKey: SEAT_KEY, roomId: "dev-room" };

describe("resolveSpawnPlacement", () => {
  it("waits while attendance is unknown", () => {
    expect(resolveSpawnPlacement("UNKNOWN", "IDLE", standing, ctx())).toBeNull();
  });

  it("checked out → sidewalk regardless of any persisted interior position", () => {
    expect(resolveSpawnPlacement("CHECKED_OUT", "IDLE", standing, ctx())).toEqual({ kind: "sidewalk" });
    expect(resolveSpawnPlacement("CHECKED_OUT", "IDLE", seated, ctx())).toEqual({ kind: "sidewalk" });
    // Today's checkout already completed locally wins over a stale server CHECKED_IN.
    expect(resolveSpawnPlacement("CHECKED_IN", "CHECKED_OUT", standing, ctx())).toEqual({ kind: "sidewalk" });
  });

  it("checked in → restores a valid standing position (room or Central Hub) with its facing", () => {
    expect(resolveSpawnPlacement("CHECKED_IN", "IDLE", standing, ctx())).toEqual({
      kind: "standing",
      pos: { x: 100, y: 200 },
      facing: "left",
    });
  });

  it("checked in → restores a valid seated position on the matching painted seat", () => {
    expect(resolveSpawnPlacement("CHECKED_IN", "IDLE", seated, ctx())).toEqual({
      kind: "seated",
      seat: SEAT,
      pos: { x: SEAT.x - SIZE.w / 2, y: SEAT.y - SIZE.h / 2 },
    });
  });

  it("checked in → falls back to the own desk when the persisted position is invalid or unsafe", () => {
    // No record / non-finite coordinates.
    expect(resolveSpawnPlacement("CHECKED_IN", "IDLE", null, ctx())).toEqual({ kind: "desk" });
    expect(resolveSpawnPlacement("CHECKED_IN", "IDLE", { ...standing, pos: { x: NaN, y: 1 } }, ctx())).toEqual({ kind: "desk" });
    // Outside the building (sidewalk / mid check-in walk).
    expect(resolveSpawnPlacement("CHECKED_IN", "IDLE", standing, ctx({ isInsideOffice: () => false }))).toEqual({ kind: "desk" });
    // Non-walkable cell (furniture moved, stale grid).
    expect(resolveSpawnPlacement("CHECKED_IN", "IDLE", standing, ctx({ isWalkable: () => false }))).toEqual({ kind: "desk" });
    // DND-locked room must not be bypassed by a reload.
    expect(resolveSpawnPlacement("CHECKED_IN", "IDLE", standing, ctx({ isRoomLocked: () => true }))).toEqual({ kind: "desk" });
    expect(resolveSpawnPlacement("CHECKED_IN", "IDLE", seated, ctx({ isRoomLocked: () => true }))).toEqual({ kind: "desk" });
    // Stale or missing seat.
    expect(resolveSpawnPlacement("CHECKED_IN", "IDLE", { ...seated, seatKey: "gone" }, ctx())).toEqual({ kind: "desk" });
    expect(resolveSpawnPlacement("CHECKED_IN", "IDLE", { ...seated, seatKey: null }, ctx())).toEqual({ kind: "desk" });
  });
});

describe("insideOfficeValidator (sidewalk layer is the only 'outside')", () => {
  // Real manifest sidewalk rect: x 8..1422, y 1161..1237.
  const inside = insideOfficeValidator({ x: 8, y: 1161, width: 1414, height: 76 });

  it("treats corridors between rooms and the Central Hub as inside", () => {
    expect(inside({ x: 420, y: 150 })).toBe(true); // corridor between ai-room and executive
    expect(inside({ x: 700, y: 590 })).toBe(true); // Central Hub
    expect(inside({ x: 400, y: 700 })).toBe(true); // shared walking area west of the hub
  });

  it("treats the sidewalk as outside", () => {
    expect(inside({ x: 700, y: 1200 })).toBe(false);
    expect(inside({ x: 16 + 10, y: 1161 + 20 })).toBe(false); // lineup slot 0
  });

  it("cannot prove anything outside without a sidewalk layer", () => {
    expect(insideOfficeValidator(null)({ x: 700, y: 1200 })).toBe(true);
  });

  it("restores a checked-in corridor standing position through the real validator", () => {
    const corridor: SelfStableSnapshot = {
      pos: { x: 410, y: 130 },
      facing: "back",
      state: "standing",
      seatKey: null,
      roomId: null,
    };
    expect(resolveSpawnPlacement("CHECKED_IN", "IDLE", corridor, ctx({ isInsideOffice: inside }))).toEqual({
      kind: "standing",
      pos: { x: 410, y: 130 },
      facing: "back",
    });
    const sidewalk: SelfStableSnapshot = { ...corridor, pos: { x: 6, y: 1161 } };
    expect(resolveSpawnPlacement("CHECKED_IN", "IDLE", sidewalk, ctx({ isInsideOffice: inside }))).toEqual({ kind: "desk" });
  });
});

describe("canOfferCheckIn", () => {
  it("offers Check In only while attendance is CHECKED_OUT, in IDLE or a historical CHECKED_OUT flow state", () => {
    expect(canOfferCheckIn("CHECKED_OUT", "IDLE")).toBe(true);
    expect(canOfferCheckIn("CHECKED_OUT", "CHECKED_OUT")).toBe(true);
    expect(canOfferCheckIn("CHECKED_OUT", "EDITING_TIME_LOG")).toBe(false);
    expect(canOfferCheckIn("CHECKED_IN", "IDLE")).toBe(false);
    expect(canOfferCheckIn("UNKNOWN", "IDLE")).toBe(false);
  });
});

describe("canSelfFreeWalk", () => {
  it("rejects manual movement while CHECKED_OUT or UNKNOWN", () => {
    expect(canSelfFreeWalk("CHECKED_OUT", true, false)).toBe(false);
    expect(canSelfFreeWalk("UNKNOWN", true, false)).toBe(false);
  });
  it("allows manual movement only when CHECKED_IN, onboarding done and checkout not busy", () => {
    expect(canSelfFreeWalk("CHECKED_IN", true, false)).toBe(true);
    expect(canSelfFreeWalk("CHECKED_IN", false, false)).toBe(false); // mid check-in walk
    expect(canSelfFreeWalk("CHECKED_IN", true, true)).toBe(false); // mid checkout walk
  });
});
