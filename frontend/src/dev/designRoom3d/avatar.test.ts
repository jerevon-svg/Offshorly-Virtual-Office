import { describe, expect, it } from "vitest";
import { AVATAR_LODS, CLIP_IDLE, CLIP_WALK, ROUTE, blockedRects, headingFor, insideFloor, pointInRect, stepAngle } from "./avatar";

describe("design room 3d character proof — scripted route", () => {
  const blocked = blockedRects(1.5);

  it("keeps every waypoint on the floor and clear of furniture, cabinets and the rack", () => {
    expect(ROUTE.length).toBeGreaterThanOrEqual(8);
    for (const w of ROUTE) {
      expect(insideFloor(w.x, w.z)).toBe(true);
      const hits = blocked.filter((r) => pointInRect(w.x, w.z, r));
      expect(hits, `${w.label} intersects ${hits.length} rect(s)`).toHaveLength(0);
    }
  });

  it("keeps every route segment clear of blocking rects (sampled every unit)", () => {
    for (let i = 0; i < ROUTE.length; i++) {
      const a = ROUTE[i], b = ROUTE[(i + 1) % ROUTE.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      for (let d = 0; d <= len; d += 1) {
        const t = d / len, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        const hit = blocked.find((r) => pointInRect(x, z, r));
        expect(hit, `segment ${a.label} → ${b.label} clips a rect at (${x.toFixed(1)}, ${z.toFixed(1)})`).toBeUndefined();
        expect(insideFloor(x, z)).toBe(true);
      }
    }
  });

  it("faces the movement direction with the production heading convention (front = +z = 0)", () => {
    expect(headingFor(0, 1)).toBeCloseTo(0, 6); // south / toward camera = "front"
    expect(headingFor(0, -1)).toBeCloseTo(Math.PI, 6); // north = "back"
    expect(headingFor(1, 0)).toBeCloseTo(Math.PI / 2, 6); // east = "right"
    expect(headingFor(-1, 0)).toBeCloseTo(-Math.PI / 2, 6); // west = "left"
    // shortest-path turning, clamped per step
    expect(stepAngle(0, Math.PI / 2, 0.1)).toBeCloseTo(0.1, 6);
    expect(stepAngle(-3, 3, 10)).toBeCloseTo(-3 - (2 * Math.PI - 6), 6);
    expect(stepAngle(1, 1.05, 10)).toBeCloseTo(1.05, 6);
  });

  it("reuses the shipped production asset set and clip names", () => {
    expect(Object.values(AVATAR_LODS).every((u) => /\/avatars\/bon-v3-hq-idle9\/bon-v3-lod[012]\.glb$/.test(u))).toBe(true);
    expect([CLIP_IDLE, CLIP_WALK]).toEqual(["idle-9", "walking"]);
  });
});
