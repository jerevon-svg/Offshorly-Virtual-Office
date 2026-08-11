import { describe, expect, it } from "vitest";
import { officePeopleToLayers, rosterSrcById, seatOverflowsRoom } from "./rosterLayers";
import { rooms } from "./office-layout";
import type { OfficePerson } from "../services/office/floorMerge";

function person(overrides: Partial<OfficePerson> = {}): OfficePerson {
  return {
    email: "bon@offshorly.com",
    displayName: "Bon",
    status: "ONLINE",
    departmentName: "dev-team",
    jobTitle: null,
    currentActivity: null,
    lastMessage: null,
    avatarId: "bon",
    roomId: "dev-team",
    atlasRoomId: null,
    inEphemeralRoom: false,
    ...overrides,
  };
}

describe("officePeopleToLayers", () => {
  it("keys layers by email, not sprite, so shared fallbacks stay distinct", () => {
    // Two different people both falling back to the "bon" sprite must be
    // two nodes — keying by avatarId would collide and drop one.
    const layers = officePeopleToLayers([
      person({ email: "a@offshorly.com" }),
      person({ email: "b@offshorly.com" }),
    ]);
    expect(layers.map((l) => l.id)).toEqual(["a@offshorly.com", "b@offshorly.com"]);
  });

  it("carries the display name through for the canvas label", () => {
    const layers = officePeopleToLayers([person({ displayName: "Jan Michael" })]);
    expect(layers[0].name).toBe("Jan Michael");
  });

  it("seats people inside their room's rect", () => {
    const room = rooms.find((r) => r.id === "dev-team")!;
    const layers = officePeopleToLayers([person()]);
    expect(layers[0].x).toBeGreaterThanOrEqual(room.x);
    expect(layers[0].y).toBeGreaterThanOrEqual(room.y);
    expect(layers[0].x).toBeLessThan(room.x + room.width);
  });

  it("does not stack two people in the same spot", () => {
    const layers = officePeopleToLayers([
      person({ email: "a@offshorly.com" }),
      person({ email: "b@offshorly.com" }),
    ]);
    expect({ x: layers[0].x, y: layers[0].y }).not.toEqual({
      x: layers[1].x,
      y: layers[1].y,
    });
  });

  it("seats each room independently", () => {
    const layers = officePeopleToLayers([
      person({ email: "a@offshorly.com", roomId: "dev-team" }),
      person({ email: "b@offshorly.com", roomId: "qa-room" }),
    ]);
    const devRoom = rooms.find((r) => r.id === "dev-team")!;
    const qaRoom = rooms.find((r) => r.id === "qa-room")!;
    expect(layers[0].x).toBeGreaterThanOrEqual(devRoom.x);
    expect(layers[1].x).toBeGreaterThanOrEqual(qaRoom.x);
  });

  it("drops a person whose room has no rect instead of drawing them at 0,0", () => {
    const layers = officePeopleToLayers([person({ roomId: "not-a-room" })]);
    expect(layers).toHaveLength(0);
  });

  it("never marks a borrowed body as animatable", () => {
    // Walk/pat frame sets are keyed to authored character ids; a borrowed
    // sprite has no guarantee of matching frames.
    const layers = officePeopleToLayers([person()]);
    expect(layers[0].animatable).toBe(false);
  });
});

describe("crowded rooms", () => {
  function crowd(roomId: string, count: number) {
    return Array.from({ length: count }, (_, i) =>
      person({ email: `p${i}@offshorly.com`, roomId }),
    );
  }

  it("keeps a real-sized team inside its room's rect", () => {
    // AI Team is the largest department at 18 people.
    const room = rooms.find((r) => r.id === "ai-room")!;
    const layers = officePeopleToLayers(crowd("ai-room", 18));
    expect(layers).toHaveLength(18);
    for (const layer of layers) {
      expect(layer.x + layer.width).toBeLessThanOrEqual(room.x + room.width);
      expect(layer.y + layer.height).toBeLessThanOrEqual(room.y + room.height);
    }
  });

  it("does not shrink anyone at today's headcount", () => {
    // Sprites are small relative to the rooms, so 18 people fit at full
    // size. If this ever fails, the art or the room rects changed.
    const solo = officePeopleToLayers(crowd("ai-room", 1));
    const team = officePeopleToLayers(crowd("ai-room", 18));
    expect(team[0].width).toBe(solo[0].width);
  });

  it("shrinks seats once a room genuinely cannot fit everyone", () => {
    const solo = officePeopleToLayers(crowd("ai-room", 1));
    const packed = officePeopleToLayers(crowd("ai-room", 200));
    expect(packed[0].width).toBeLessThan(solo[0].width);
  });

  it("scales each room independently", () => {
    const layers = officePeopleToLayers([
      ...crowd("ai-room", 200),
      person({ email: "solo@offshorly.com", roomId: "qa-room" }),
    ]);
    const inAi = layers.find((l) => l.id === "p0@offshorly.com")!;
    const inQa = layers.find((l) => l.id === "solo@offshorly.com")!;
    expect(inQa.width).toBeGreaterThan(inAi.width);
  });

  it("still gives everyone a distinct seat when packed", () => {
    const layers = officePeopleToLayers(crowd("ai-room", 18));
    const spots = new Set(layers.map((l) => `${l.x},${l.y}`));
    expect(spots.size).toBe(18);
  });
});

describe("rosterSrcById", () => {
  it("resolves each layer's art through the manifest table", () => {
    const layers = officePeopleToLayers([person()]);
    const srcs = rosterSrcById(layers);
    expect(srcs[layers[0].id]).toBeTruthy();
  });
});

describe("seatOverflowsRoom", () => {
  it("is false for a room that comfortably fits its people", () => {
    expect(seatOverflowsRoom("dev-team", 1)).toBe(false);
  });

  it("detects a room packed past its own height", () => {
    expect(seatOverflowsRoom("dev-team", 500)).toBe(true);
  });

  it("is false for an unknown room rather than throwing", () => {
    expect(seatOverflowsRoom("not-a-room", 500)).toBe(false);
  });
});
