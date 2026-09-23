import { describe, expect, it } from "vitest";
import type { Rect } from "../core/coords";
import type { DoorOpening } from "../adapters/v1Floor";
import {
  DOOR_CLEARANCE, HANG_Y, WALL_HEAD, WALL_HUG,
  clearOfDoors, corners, insideFloor, spread, wallSpots,
} from "./placement";

const FLOOR: Rect = { x: 100, z: 200, w: 240, d: 160 };

// The safety properties are GEOMETRIC, so they are asserted geometrically rather than by eyeballing a
// screenshot. Nav-inertness is guaranteed by the architecture (nav never reads a THREE object); what
// these pin is the other half — a decoration must not stand in front of a person, a door or a desk.

describe("floor decorations stay out of the way", () => {
  it("hugs the walls — nothing is ever placed out in the open floor", () => {
    for (const s of [...corners(FLOOR, WALL_HUG), ...wallSpots(FLOOR, 4)]) {
      const nearest = Math.min(
        s.x - FLOOR.x, FLOOR.x + FLOOR.w - s.x,
        s.z - FLOOR.z, FLOOR.z + FLOOR.d - s.z,
      );
      expect(nearest).toBeLessThanOrEqual(WALL_HUG + 0.001);
    }
  });

  it("keeps every doorway clear", () => {
    const door: DoorOpening = {
      roomId: "r", side: "north", from: 0, to: 1, cells: [],
      centre: { x: FLOOR.x + FLOOR.w / 2, z: FLOOR.z + WALL_HUG },
    };
    const kept = clearOfDoors(wallSpots(FLOOR, 6), [door]);
    for (const s of kept) {
      expect(Math.hypot(s.x - door.centre.x, s.z - door.centre.z)).toBeGreaterThan(DOOR_CLEARANCE);
    }
    // ...and it actually removed something, or the assertion above is vacuous.
    expect(kept.length).toBeLessThan(wallSpots(FLOOR, 6).length);
  });

  it("never places outside the room it is decorating", () => {
    for (const s of insideFloor(wallSpots(FLOOR, 5), FLOOR)) {
      expect(s.x).toBeGreaterThan(FLOOR.x);
      expect(s.x).toBeLessThan(FLOOR.x + FLOOR.w);
      expect(s.z).toBeGreaterThan(FLOOR.z);
      expect(s.z).toBeLessThan(FLOOR.z + FLOOR.d);
    }
  });
});

describe("hanging decorations clear every head and every roof", () => {
  it("hangs above avatars and nameplates, and below the wall head", () => {
    // An avatar is ~30 tall. Anything hanging lower would cross a face or a nameplate.
    expect(HANG_Y).toBeGreaterThan(30);
    expect(HANG_Y).toBeLessThan(WALL_HEAD);
    expect(WALL_HEAD).toBe(46); // the office's own wall head — a season must never poke through a roof
  });
});

describe("spreading", () => {
  it("takes points from across the list, not off the front", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    // Decorating one wall and leaving three bare is what taking a prefix would do.
    expect(spread(items, 4)).toEqual([1, 3, 5, 7]);
    expect(spread(items, 0)).toEqual([]);
    expect(spread(items, 99)).toEqual(items);
  });
});
