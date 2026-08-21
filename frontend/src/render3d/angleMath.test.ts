import { describe, expect, it } from "vitest";
import {
  normalizeAngleDegrees,
  shortestAngleDeltaDegrees,
  stepAngleTowardsDegrees,
} from "./angleMath";

describe("normalizeAngleDegrees", () => {
  it("leaves angles already in (-180, 180] unchanged", () => {
    expect(normalizeAngleDegrees(0)).toBe(0);
    expect(normalizeAngleDegrees(90)).toBe(90);
    expect(normalizeAngleDegrees(-90)).toBe(-90);
    expect(normalizeAngleDegrees(180)).toBe(180);
  });

  it("wraps angles above 180 down into range", () => {
    expect(normalizeAngleDegrees(181)).toBe(-179);
    expect(normalizeAngleDegrees(270)).toBe(-90);
    expect(normalizeAngleDegrees(360)).toBe(0);
    expect(normalizeAngleDegrees(720)).toBe(0);
  });

  it("wraps angles at or below -180 up into range", () => {
    expect(normalizeAngleDegrees(-180)).toBe(180);
    expect(normalizeAngleDegrees(-181)).toBe(179);
    expect(normalizeAngleDegrees(-270)).toBe(90);
    // -360 % 360 in JS yields -0, not +0 — normalizeAngleDegrees passes it
    // through unchanged (it's already in (-180, 180]); toBeCloseTo treats
    // -0 and 0 as equal, unlike toBe's Object.is semantics.
    expect(normalizeAngleDegrees(-360)).toBeCloseTo(0, 10);
  });
});

describe("shortestAngleDeltaDegrees", () => {
  it("returns 0 when from equals to", () => {
    expect(shortestAngleDeltaDegrees(45, 45)).toBe(0);
  });

  it("returns the direct delta for a simple within-range turn", () => {
    expect(shortestAngleDeltaDegrees(0, 90)).toBe(90);
    expect(shortestAngleDeltaDegrees(90, 0)).toBe(-90);
  });

  it("takes the short way around the +/-180deg wrap boundary", () => {
    // 170 -> -170 the "long way" is -340; the short way is +20.
    expect(shortestAngleDeltaDegrees(170, -170)).toBe(20);
    // -170 -> 170 the short way is -20.
    expect(shortestAngleDeltaDegrees(-170, 170)).toBe(-20);
  });

  it("never exceeds 180deg in magnitude", () => {
    for (let from = -180; from < 180; from += 37) {
      for (let to = -180; to < 180; to += 53) {
        const delta = shortestAngleDeltaDegrees(from, to);
        expect(Math.abs(delta)).toBeLessThanOrEqual(180);
      }
    }
  });
});

describe("stepAngleTowardsDegrees", () => {
  it("reaches the target exactly when within maxDelta, never overshooting", () => {
    expect(stepAngleTowardsDegrees(0, 10, 30)).toBe(10);
    expect(stepAngleTowardsDegrees(0, -10, 30)).toBe(-10);
  });

  it("steps by at most maxDelta toward the target when farther away", () => {
    expect(stepAngleTowardsDegrees(0, 90, 30)).toBe(30);
    expect(stepAngleTowardsDegrees(0, -90, 30)).toBe(-30);
  });

  it("holds exactly at the target once reached (idempotent)", () => {
    const target = 45;
    let current = 0;
    for (let i = 0; i < 20; i++) {
      current = stepAngleTowardsDegrees(current, target, 10);
    }
    expect(current).toBe(target);
    // One more step at the target should not move it.
    expect(stepAngleTowardsDegrees(current, target, 10)).toBe(target);
  });

  it("takes the shortest path across the wrap boundary", () => {
    // From 170 toward -170 (short way is +20) with a generous max delta.
    expect(stepAngleTowardsDegrees(170, -170, 100)).toBe(-170);
    // Partial step across the same boundary.
    const stepped = stepAngleTowardsDegrees(170, -170, 5);
    expect(stepped).toBe(175);
  });

  it("returns a normalized (-180, 180] angle even when starting outside that range", () => {
    const result = stepAngleTowardsDegrees(0, 720, 1000);
    expect(result).toBeGreaterThan(-180);
    expect(result).toBeLessThanOrEqual(180);
  });
});
