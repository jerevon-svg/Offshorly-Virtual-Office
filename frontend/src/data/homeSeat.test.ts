// The home-desk rule, now that it is shared. These cases pin the behaviour that moved out of
// components/OfficeMap/OfficeMap.tsx unchanged, so the V1 office and the VO3D V2 preview keep being two
// readers of ONE decision rather than two decisions that resemble each other.
import { describe, expect, it } from "vitest";
import { nearestSeatTo, resolveHomeDesk } from "./homeSeat";
import { doorStandForRoom } from "./doorStandPoints";
import { seatsForRoomId } from "./roomSeats";
import { FALLBACK_ROOM_ID } from "./roomIdentity";

describe("nearestSeatTo", () => {
  it("returns the seat closest to the point, by straight-line distance", () => {
    const seats = seatsForRoomId("design-team");
    expect(seats.length).toBeGreaterThan(0);
    const probe = { x: seats[0].x, y: seats[0].y };
    const best = nearestSeatTo("design-team", probe)!;
    const closest = Math.min(...seats.map((s) => Math.hypot(s.x - probe.x, s.y - probe.y)));
    expect(Math.hypot(best.x - probe.x, best.y - probe.y)).toBeCloseTo(closest, 6);
  });

  it("returns null for a room with no painted seats", () => {
    expect(nearestSeatTo("not-a-room", { x: 0, y: 0 })).toBeNull();
  });
});

describe("resolveHomeDesk", () => {
  it("measures from the room's door-in stand point when it has one", () => {
    const pair = doorStandForRoom("design-team");
    expect(pair, "design-team is expected to have a painted door stand pair").not.toBeNull();
    expect(resolveHomeDesk("jerevon@offshorly.com", null).seat)
      .toEqual(nearestSeatTo("design-team", pair!.inStand));
  });

  it("honours the per-person room override ahead of the department", () => {
    // lui is pinned to dev-team by email even with a department that says otherwise.
    expect(resolveHomeDesk("lui@offshorly.com", "Design").roomId).toBe("dev-team");
  });

  it("resolves the room from the department when there is no override", () => {
    expect(resolveHomeDesk("nobody@offshorly.com", "AI Team").roomId).toBe("ai-room");
  });

  it("falls back to Reception for an unrecognised person — V1's floor must still show them", () => {
    // V2's preview refuses this fallback (adapters/v1HomeDesk asks roomIdForPerson itself first), but
    // V1's own office depends on it: an unmapped employee is visible in Reception, not dropped.
    expect(resolveHomeDesk("nobody@offshorly.com", null).roomId).toBe(FALLBACK_ROOM_ID);
  });

  it("carries the seat's own fixed direction", () => {
    const { seat } = resolveHomeDesk("jerevon@offshorly.com", null);
    expect(seat).not.toBeNull();
    expect(["front", "back", "left", "right"]).toContain(seat!.direction);
  });
});
