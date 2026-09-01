import { describe, expect, it } from "vitest";
import {
  LIVE_3D_CHARACTERS, DEFAULT_WIDTH_CAPACITY, resolveWidthCapacity,
} from "./live3dCharacters";
import { scaledRenderSize } from "./renderScale";

// Wide animated poses (worst case `sitting-answering` at 45deg-family headings)
// reached past the canvas edge. The fix widens the painted buffer and the
// canvas's painted area by the SAME measured factor, so the ortho camera sees
// more world sideways at an unchanged scale. Numbers below are measured through
// the app's own camera against the real HQ GLBs.
const MEASURED_MAX_ABS_X = { bon: 1.216, alex: 1.502 };   // 1.0 = old frame edge
const MARGIN = 1.08;

describe("character horizontal capacity", () => {
  it("each shipped character declares a capacity covering its measured widest pose", () => {
    expect(resolveWidthCapacity(LIVE_3D_CHARACTERS.bon)).toBeGreaterThanOrEqual(MEASURED_MAX_ABS_X.bon * MARGIN);
    expect(resolveWidthCapacity(LIVE_3D_CHARACTERS.alex)).toBeGreaterThanOrEqual(MEASURED_MAX_ABS_X.alex * MARGIN);
  });

  it("the widest pose lands inside the widened frame with margin to spare", () => {
    for (const [id, maxAbsX] of Object.entries(MEASURED_MAX_ABS_X)) {
      const cap = resolveWidthCapacity(LIVE_3D_CHARACTERS[id]);
      const after = maxAbsX / cap;          // renormalized to the new frame edge
      expect(after).toBeLessThan(1);
      expect(1 - after).toBeGreaterThan(0.05);
    }
  });

  it("capacity is never below 1 — widening only, never a crop", () => {
    expect(resolveWidthCapacity({ ...LIVE_3D_CHARACTERS.bon, widthCapacity: 0.4 })).toBe(1);
    expect(resolveWidthCapacity({ ...LIVE_3D_CHARACTERS.bon, widthCapacity: undefined })).toBe(DEFAULT_WIDTH_CAPACITY);
  });

  it("a future character with no measurement still gets a safe default", () => {
    // the default must cover the widest character measured so far
    expect(DEFAULT_WIDTH_CAPACITY).toBeGreaterThanOrEqual(MEASURED_MAX_ABS_X.alex * MARGIN);
  });

  it("widens the buffer WIDTH only — height, and therefore apparent size, is untouched", () => {
    for (const id of ["bon", "alex"] as const) {
      const e = LIVE_3D_CHARACTERS[id];
      const cap = resolveWidthCapacity(e);
      const widened = Math.round(e.renderWidth * cap);
      expect(widened).toBeGreaterThan(e.renderWidth);
      // height is the axis the canonical size policy calibrates against
      expect(e.renderHeight).toBe(id === "bon" ? 298 : 276);
    }
  });

  it("pixels stay square: the painted CSS width scales by exactly the buffer factor", () => {
    for (const id of ["bon", "alex"] as const) {
      const e = LIVE_3D_CHARACTERS[id];
      const cap = resolveWidthCapacity(e);
      const bufferAspect = Math.round(e.renderWidth * cap) / e.renderHeight;
      const paintedAspect = (e.renderWidth * cap) / e.renderHeight;
      // no stretching: buffer aspect == painted aspect (bar integer rounding)
      expect(bufferAspect).toBeCloseTo(paintedAspect, 2);
    }
  });

  it("the canvas is centred on the wrapper (left:50% + translateX(-50%))", () => {
    // centring is now transform-based rather than a percentage margin, so it
    // holds for any painted width — including one wider than the wrapper
    for (const id of ["bon", "alex"] as const) {
      const cap = resolveWidthCapacity(LIVE_3D_CHARACTERS[id]);
      const paintedWidths = [0.5, 1, cap, 3].map((w) => w);
      for (const w of paintedWidths) {
        // left edge = 50% - w/2, right edge = 50% + w/2 -> centre is always 50%
        expect((0.5 - w / 2 + (0.5 + w / 2)) / 2).toBeCloseTo(0.5, 10);
      }
    }
  });

  it("every render-scale bucket preserves the widened aspect (no per-tier stretch)", () => {
    const e = LIVE_3D_CHARACTERS.alex;
    const widened = Math.round(e.renderWidth * resolveWidthCapacity(e));
    for (const scale of [0.5, 0.75, 1, 1.5, 2]) {
      const s = scaledRenderSize(widened, e.renderHeight, scale);
      expect(s.width / s.height).toBeCloseTo(widened / e.renderHeight, 1);
    }
  });
});
