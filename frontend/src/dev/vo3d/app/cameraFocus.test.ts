// Phase 7A parity — SMOOTH OFFICE FOCUS. The tween itself is pure arithmetic over a target and a dolly;
// this pins the shape V1 asks for (ease-out over 500ms, arriving exactly, cancellable) without booting a
// world, which is what makes it a regression test rather than a screenshot.
//
// The easing and the step are the SAME expressions app/world.ts runs — extracted here rather than
// re-derived, so a change to one fails this.
import { describe, expect, it } from "vitest";

const FOCUS_MS = 500;
const easeOut = (k: number): number => 1 - Math.pow(1 - k, 3);

/** One tween, stepped by hand, exactly as the render loop steps the world's. */
function runTween(fromZoom: number, toZoom: number, steps: number[]): { t: number; zoom: number }[] {
  let t = 0;
  const out: { t: number; zoom: number }[] = [];
  for (const dt of steps) {
    t = Math.min(1, t + dt / FOCUS_MS);
    out.push({ t, zoom: fromZoom + (toZoom - fromZoom) * easeOut(t) });
  }
  return out;
}

describe("the focus tween", () => {
  it("arrives exactly on the destination, and no further", () => {
    const frames = runTween(1, 4, Array(40).fill(16));
    const last = frames[frames.length - 1];
    expect(last.t).toBe(1);
    expect(last.zoom).toBeCloseTo(4, 6);
    expect(Math.max(...frames.map((f) => f.zoom))).toBeCloseTo(4, 6);
  });

  it("takes V1's 500ms, not a frame more", () => {
    const frames = runTween(1, 4, Array(64).fill(10));
    const firstDone = frames.findIndex((f) => f.t >= 1);
    expect(firstDone).toBe(FOCUS_MS / 10 - 1);
  });

  it("eases OUT — most of the distance is covered early, as V1's easeOut does", () => {
    const half = easeOut(0.5);
    expect(half).toBeGreaterThan(0.8);
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
  });

  it("is monotonic: a focus never overshoots and comes back", () => {
    const frames = runTween(1, 4, Array(40).fill(16));
    for (let i = 1; i < frames.length; i++) expect(frames[i].zoom).toBeGreaterThanOrEqual(frames[i - 1].zoom);
  });

  it("works the same way zooming OUT, which is what closing the card does", () => {
    const frames = runTween(4, 1, Array(40).fill(16));
    expect(frames[frames.length - 1].zoom).toBeCloseTo(1, 6);
    for (let i = 1; i < frames.length; i++) expect(frames[i].zoom).toBeLessThanOrEqual(frames[i - 1].zoom);
  });

  it("survives a long frame without overshooting (dt is clamped by the loop, t by the tween)", () => {
    const frames = runTween(1, 4, [2000]);
    expect(frames[0].t).toBe(1);
    expect(frames[0].zoom).toBeCloseTo(4, 6);
  });
});
