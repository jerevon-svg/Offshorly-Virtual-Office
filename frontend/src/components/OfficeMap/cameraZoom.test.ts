import { describe, expect, it } from "vitest";
import { ROOM_FIT_MULTIPLIER } from "./OfficeMap";
import { computeCenterTransform } from "./panMath";
import { rooms } from "../../data/office-layout";
import { FRAME_HEIGHT, FRAME_WIDTH } from "../../data/office-layout";

// Cheap, pure assertions covering the room-fit camera stage added for
// door-gated walks (check-in / chat/approach / checkout exit) — no
// component rendering required.
describe("ROOM_FIT_MULTIPLIER (room-fit camera stage)", () => {
  it("sits strictly between full-map (1.0) and the tight-focus multiplier (2.5)", () => {
    expect(ROOM_FIT_MULTIPLIER).toBeGreaterThan(1.0);
    expect(ROOM_FIT_MULTIPLIER).toBeLessThan(2.5);
  });

  it("keeps a couple of real room rects within the frame's pannable bounds at room-fit scale", () => {
    // Representative viewport + a plausible initialScale (cover-fit scales
    // are always < 1 for a frame far larger than any single viewport).
    const viewportW = 1280;
    const viewportH = 800;
    // Mirrors computeCoverScale() in OfficeMap.tsx: cover-fit scale so the
    // frame always fully covers this viewport (max of the two fit ratios).
    const initialScale = Math.max(viewportW / FRAME_WIDTH, viewportH / FRAME_HEIGHT);
    const scale = initialScale * ROOM_FIT_MULTIPLIER;
    const contentW = FRAME_WIDTH * scale;
    const contentH = FRAME_HEIGHT * scale;

    const sample = rooms.slice(0, 2);
    expect(sample.length).toBeGreaterThan(0);
    for (const room of sample) {
      const { x, y } = computeCenterTransform(room, scale, viewportW, viewportH);
      // computeCenterTransform clamps into [viewportW - contentW, 0] /
      // [viewportH - contentH, 0] — asserting that range holds confirms the
      // pan stays within the frame's max pannable bounds, never revealing
      // background beyond the frame.
      expect(x).toBeLessThanOrEqual(0);
      expect(x).toBeGreaterThanOrEqual(viewportW - contentW);
      expect(y).toBeLessThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(viewportH - contentH);
    }
  });
});
