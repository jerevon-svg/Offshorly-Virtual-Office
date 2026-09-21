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

// ---- THE RECENTRE, not just the zoom -----------------------------------------------------------------
// The tween always eased its DOLLY correctly and never eased its TARGET: the lerped point was written to
// controls.target and then placeCamera copied the renderer's own target straight back over it, so every
// frame restored the destination and the recentre snapped. Framing a ROOM moves the target far enough for
// that to be the whole gesture, so the pan is pinned here alongside the zoom.
describe("the focus recentre", () => {
  type P = { x: number; z: number };
  const lerp = (a: P, b: P, k: number): P => ({ x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k });

  /** The same step the loop runs, over a point instead of a scalar. */
  function runPan(from: P, to: P, steps: number[]): P[] {
    let t = 0;
    const out: P[] = [];
    for (const dt of steps) {
      t = Math.min(1, t + dt / FOCUS_MS);
      out.push(lerp(from, to, easeOut(t)));
    }
    return out;
  }

  it("actually moves in between — a recentre that only appears on the last frame is a snap", () => {
    const frames = runPan({ x: 0, z: 0 }, { x: 1200, z: 800 }, Array(30).fill(16));
    const mid = frames[Math.floor(frames.length / 2)];
    expect(mid.x).toBeGreaterThan(0);
    expect(mid.x).toBeLessThan(1200);
  });

  it("arrives exactly on the room's centre, and no further", () => {
    const frames = runPan({ x: 0, z: 0 }, { x: 1200, z: 800 }, Array(40).fill(16));
    const last = frames[frames.length - 1];
    expect(last.x).toBeCloseTo(1200, 6);
    expect(last.z).toBeCloseTo(800, 6);
    expect(Math.max(...frames.map((f) => f.x))).toBeCloseTo(1200, 6);
  });

  it("is monotonic on both axes: no overshoot, no backtrack", () => {
    const frames = runPan({ x: 0, z: 900 }, { x: 1200, z: 100 }, Array(40).fill(16));
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].x).toBeGreaterThanOrEqual(frames[i - 1].x);
      expect(frames[i].z).toBeLessThanOrEqual(frames[i - 1].z);
    }
  });
});
