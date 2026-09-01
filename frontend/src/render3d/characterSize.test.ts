import { describe, expect, it } from "vitest";
import {
  CANONICAL_STANDING_FRAME_UNITS, MAX_STANDING_CANVAS_FRACTION,
  canonicalStandingFraction, canonicalTop,
} from "./characterSize";

// The two shipped characters' manifest layer heights.
const BON_LAYER = 37.2;
const ALEX_LAYER = 34.46;
// Standing fraction each one's framing produced BEFORE the canonical rule,
// measured with three.js against the real HQ GLBs (Box3.setFromObject, i.e.
// WITHOUT double-applying the Armature's 0.01 scale).
const BON_SOLVED_FRACTION = 0.8922;
const ALEX_SOLVED_FRACTION = 0.6847;

describe("canonical character size", () => {
  it("gives every character the same visible standing height", () => {
    const bonVisible = canonicalStandingFraction(BON_LAYER) * BON_LAYER;
    const alexVisible = canonicalStandingFraction(ALEX_LAYER) * ALEX_LAYER;
    expect(Math.abs(bonVisible - alexVisible) / bonVisible).toBeLessThan(0.02);
  });

  it("leaves bon — the canonical baseline — essentially unchanged", () => {
    const top = canonicalTop(1, BON_SOLVED_FRACTION, BON_LAYER);
    expect(top).toBeCloseTo(1, 2);
  });

  it("zooms alex in so he stops rendering short", () => {
    const top = canonicalTop(1, ALEX_SOLVED_FRACTION, ALEX_LAYER);
    expect(top).toBeLessThan(1);
  });

  it("never lets a standing character exceed the headroom ceiling", () => {
    // a pathologically short layer would otherwise demand >100% of the canvas
    expect(canonicalStandingFraction(1)).toBe(MAX_STANDING_CANVAS_FRACTION);
  });

  it("a future character inherits the rule with no per-character constant", () => {
    for (const layerHeight of [20, 25, 30, 34.46, 37.2, 45]) {
      const visible = canonicalStandingFraction(layerHeight) * layerHeight;
      const clamped = CANONICAL_STANDING_FRAME_UNITS / layerHeight > MAX_STANDING_CANVAS_FRACTION;
      if (!clamped) expect(visible).toBeCloseTo(CANONICAL_STANDING_FRAME_UNITS, 6);
    }
  });

  it("falls back to bon's framing when no layer height is known", () => {
    expect(canonicalStandingFraction(0)).toBeCloseTo(0.8887, 4);
    expect(canonicalTop(2, 0.8887, 0)).toBeCloseTo(2, 6);
  });

  it("is a pure zoom change — proportions are never touched", () => {
    // same solved fraction, different layer -> only the returned top differs
    expect(canonicalTop(1, 0.9, 37.2)).not.toBe(canonicalTop(1, 0.9, 34.46));
    // and it is exactly linear in the solved top (no clamping of the model)
    expect(canonicalTop(2, 0.9, 37.2)).toBeCloseTo(2 * canonicalTop(1, 0.9, 37.2), 10);
  });
});
