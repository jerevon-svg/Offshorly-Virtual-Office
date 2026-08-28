import { describe, expect, it } from "vitest";
import { isRoomLocked } from "./roomLock";

describe("isRoomLocked", () => {
  it("returns false for a null roomId", () => {
    expect(isRoomLocked(null, [], new Set())).toBe(false);
  });

  it("returns false when the room has no occupancy entry", () => {
    const rooms = [{ roomId: "dev-team", members: ["a@example.com"] }];
    expect(isRoomLocked("design-team", rooms, new Set(["a@example.com"]))).toBe(false);
  });

  it("returns false when no occupant is DND", () => {
    const rooms = [{ roomId: "design-team", members: ["a@example.com", "b@example.com"] }];
    expect(isRoomLocked("design-team", rooms, new Set())).toBe(false);
  });

  it("returns true when at least one occupant is DND", () => {
    const rooms = [{ roomId: "design-team", members: ["a@example.com", "b@example.com"] }];
    expect(isRoomLocked("design-team", rooms, new Set(["b@example.com"]))).toBe(true);
  });

  it("returns false once the only DND occupant is no longer listed as an occupant", () => {
    const rooms = [{ roomId: "design-team", members: ["a@example.com"] }];
    // b was DND but has left the room (room-presence snapshot no longer lists them here) —
    // their stale DND membership must not lock a room they're no longer in.
    expect(isRoomLocked("design-team", rooms, new Set(["b@example.com"]))).toBe(false);
  });
});
