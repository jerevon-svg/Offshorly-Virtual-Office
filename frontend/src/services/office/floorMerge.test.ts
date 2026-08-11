import { describe, expect, it } from "vitest";
import { groupByRoomId, mergeFloorWithPresence, resolveRoomId } from "./floorMerge";
import type { FloorPerson, Presence } from "./types";

function floorPerson(overrides: Partial<FloorPerson> = {}): FloorPerson {
  return {
    user_email: "bon@offshorly.com",
    display_name: "Bon",
    status: "OFFLINE",
    department_name: "dev-team",
    team_room_id: null,
    current_room_id: null,
    source: "test",
    current_activity: null,
    job_title: null,
    ...overrides,
  };
}

function presenceRow(overrides: Partial<Presence> = {}): Presence {
  return {
    user_email: "bon@offshorly.com",
    full_name: "Bon",
    photo_url: null,
    job_title: null,
    department_name: "dev-team",
    status: "ONLINE",
    source: "cliq",
    current_room_id: null,
    avatar_x: null,
    avatar_y: null,
    checked_in_at: null,
    last_seen_at: null,
    current_activity: null,
    ...overrides,
  };
}

describe("resolveRoomId", () => {
  it("places an offline person at their department desk", () => {
    expect(resolveRoomId("OFFLINE", null, "dev-team")).toEqual({
      roomId: "dev-team",
      inEphemeralRoom: false,
    });
  });

  it("slugifies a human department name onto a room id", () => {
    expect(resolveRoomId("OFFLINE", null, "Design Team").roomId).toBe("design-team");
  });

  it("falls back to reception when the department maps to nothing", () => {
    expect(resolveRoomId("OFFLINE", null, "Accounts Payable").roomId).toBe(
      "reception-room",
    );
  });

  it("falls back to reception when there is no department at all", () => {
    expect(resolveRoomId("ONLINE", null, null).roomId).toBe("reception-room");
  });

  it("keeps a non-ONLINE person at their desk even with a live room set", () => {
    // Matches Atlas's own rule: an ephemeral room must never hold someone
    // who isn't actually online.
    const result = resolveRoomId("ON_LEAVE", "cliq-channel-42", "qa-room");
    expect(result).toEqual({ roomId: "qa-room", inEphemeralRoom: false });
  });

  it("marks an ONLINE person in an unmappable room as elsewhere, at their desk", () => {
    const result = resolveRoomId("ONLINE", "cliq-channel-42", "qa-room");
    expect(result).toEqual({ roomId: "qa-room", inEphemeralRoom: true });
  });
});

describe("mergeFloorWithPresence", () => {
  it("keeps everyone from /floor even with no presence row", () => {
    const merged = mergeFloorWithPresence(
      [
        floorPerson({ user_email: "a@offshorly.com" }),
        floorPerson({ user_email: "b@offshorly.com" }),
      ],
      [],
    );
    expect(merged).toHaveLength(2);
  });

  it("never invents people who are only in /presence", () => {
    const merged = mergeFloorWithPresence(
      [floorPerson({ user_email: "a@offshorly.com" })],
      [presenceRow({ user_email: "ghost@offshorly.com" })],
    );
    expect(merged.map((p) => p.email)).toEqual(["a@offshorly.com"]);
  });

  it("lets a presence row override status and room", () => {
    const merged = mergeFloorWithPresence(
      [floorPerson({ status: "OFFLINE" })],
      [presenceRow({ status: "ONLINE", current_room_id: "cliq-1" })],
    );
    expect(merged[0].status).toBe("ONLINE");
    expect(merged[0].atlasRoomId).toBe("cliq-1");
    expect(merged[0].inEphemeralRoom).toBe(true);
  });

  it("joins on email case-insensitively", () => {
    // Zoho, Cliq and Atlas do not agree on capitalization; matching raw
    // would silently drop the live status for these people.
    const merged = mergeFloorWithPresence(
      [floorPerson({ user_email: "Bon@Offshorly.com", status: "OFFLINE" })],
      [presenceRow({ user_email: "bon@offshorly.com", status: "ONLINE" })],
    );
    expect(merged[0].status).toBe("ONLINE");
  });

  it("resolves the sprite through the identity join", () => {
    const merged = mergeFloorWithPresence(
      [floorPerson({ user_email: "bon@offshorly.com" })],
      [],
    );
    expect(merged[0].avatarId).toBe("bon");
  });

  it("gives an unmapped person the fallback sprite rather than failing", () => {
    const merged = mergeFloorWithPresence(
      [floorPerson({ user_email: "nobody.here@offshorly.com" })],
      [],
    );
    expect(merged[0].avatarId).toBe("bon");
  });
});

describe("groupByRoomId", () => {
  it("buckets people by their resolved room", () => {
    const merged = mergeFloorWithPresence(
      [
        floorPerson({ user_email: "a@offshorly.com", department_name: "dev-team" }),
        floorPerson({ user_email: "b@offshorly.com", department_name: "dev-team" }),
        floorPerson({ user_email: "c@offshorly.com", department_name: "qa-room" }),
      ],
      [],
    );
    const byRoom = groupByRoomId(merged);
    expect(byRoom.get("dev-team")).toHaveLength(2);
    expect(byRoom.get("qa-room")).toHaveLength(1);
  });
});
