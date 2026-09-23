// ROOM DETAILS — CAMERA FOCUS. The three decisions behind "click a room and the camera goes there"
// (app/roomFocus.ts), plus the tween shape the room framing rides on.
//
// The OFFICE framing itself is NOT asserted here and deliberately so: app/world.ts re-runs the shipped
// render/CameraModes.focus rather than re-deriving it, so there is nothing of its own to test — and a
// second expectation of that arithmetic here is exactly the drift the arrangement prevents.
import { describe, expect, it } from "vitest";
import { exploreFrameZoom, ROOM_FRAME_FILL, roomFrameMode, roomFrameRect } from "./roomFocus";
import type { Rect } from "../core/coords";

const rect = (x: number, z: number, w: number, d: number): Rect => ({ x, z, w, d });

describe("which view is reframed", () => {
  it("OFFICE re-runs the shipped framing; 3D EXPLORE only pans and dollies", () => {
    expect(roomFrameMode("office", false, "dev-room")).toBe("office");
    expect(roomFrameMode("explore", false, "dev-room")).toBe("pan");
  });

  it("PLAYER is never reframed — the camera belongs to the body there", () => {
    expect(roomFrameMode("player", true, "dev-room")).toBe("none");
    // …and it stays refused even if the mode string has not caught up with the player controller.
    expect(roomFrameMode("office", true, "dev-room")).toBe("none");
    expect(roomFrameMode("explore", true, "dev-room")).toBe("none");
  });

  it("dropping a selection frames nothing — leaving is not a place to go", () => {
    expect(roomFrameMode("office", false, null)).toBe("none");
    expect(roomFrameMode("explore", false, null)).toBe("none");
  });
});

describe("which rect a room is framed against", () => {
  const source = {
    floorRectOf: (id: string) => (id === "design-room" ? rect(100, 300, 200, 180) : undefined),
    regions: [
      { id: "footprint:dev-room", rect: rect(1100, 0, 320, 330), roomId: "dev-room" },
      // a door band: same roomId, out in the corridor, and it must never win
      { id: "threshold:dev-room/door", rect: rect(1180, 330, 48, 16), roomId: "dev-room" },
      { id: "shared:ground-floor", rect: rect(0, 0, 1440, 1244) },
    ],
  };

  it("a reconstructed room is framed on its own walkable floor", () => {
    expect(roomFrameRect(source, "design-room")).toEqual(rect(100, 300, 200, 180));
  });

  it("a room V2 has not rebuilt yet falls back to its footprint stand-in", () => {
    expect(roomFrameRect(source, "dev-room")).toEqual(rect(1100, 0, 320, 330));
  });

  it("never frames on a door threshold, which would drag the view into the corridor", () => {
    const thresholdOnly = { floorRectOf: () => undefined, regions: [source.regions[1]] };
    expect(roomFrameRect(thresholdOnly, "dev-room")).toBeNull();
  });

  it("a room this world has no rect for is simply not framed", () => {
    expect(roomFrameRect(source, "cave-theater")).toBeNull();
  });
});

describe("the 3D Explore dolly", () => {
  // camera.top is the frustum half-height; visible half-height is camera.top / camera.zoom, so the zoom
  // that fits a room is top / (half its longer side, divided by the fill).
  const TOP = 400;

  it("fits the room's LONGER side, so the framing holds at any orbit angle", () => {
    const wide = exploreFrameZoom(rect(0, 0, 300, 120), TOP, ROOM_FRAME_FILL, 0.05, 6);
    const deep = exploreFrameZoom(rect(0, 0, 120, 300), TOP, ROOM_FRAME_FILL, 0.05, 6);
    expect(wide).toBeCloseTo(deep, 10);
    expect(wide).toBeCloseTo(TOP / (300 / 2 / ROOM_FRAME_FILL), 10);
  });

  it("leaves a margin around the room rather than filling the frame edge to edge", () => {
    expect(ROOM_FRAME_FILL).toBeLessThan(1);
    const filled = exploreFrameZoom(rect(0, 0, 300, 300), TOP, 1, 0.05, 6);
    expect(exploreFrameZoom(rect(0, 0, 300, 300), TOP, ROOM_FRAME_FILL, 0.05, 6)).toBeLessThan(filled);
  });

  it("never exceeds the mode's own zoom limits — no excessive zoom on a tiny room", () => {
    expect(exploreFrameZoom(rect(0, 0, 4, 4), TOP, ROOM_FRAME_FILL, 0.05, 6)).toBe(6);
    expect(exploreFrameZoom(rect(0, 0, 40000, 40000), TOP, ROOM_FRAME_FILL, 0.05, 6)).toBe(0.05);
  });

  it("cannot divide by zero on a degenerate rect", () => {
    expect(Number.isFinite(exploreFrameZoom(rect(0, 0, 0, 0), TOP, ROOM_FRAME_FILL, 0.05, 6))).toBe(true);
  });
});
