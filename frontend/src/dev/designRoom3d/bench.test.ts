import { describe, expect, it } from "vitest";
import { Capture, FrameWindow, PRESETS, percentile, summarize } from "./bench";

describe("design room 3d benchmark statistics", () => {
  it("summarises frame samples into fps / percentiles / averages", () => {
    const samples = [16, 16, 17, 16, 33, 16, 50, 16, 16, 16].map((dt, i) => ({ dt, calls: 1700 + i, triangles: 160000 }));
    const s = summarize(samples, 1);
    expect(s.frames).toBe(10);
    expect(s.worstFrameMs).toBe(50);
    expect(s.medianFrameMs).toBe(16);
    expect(s.p95FrameMs).toBe(50);
    expect(s.avgFrameMs).toBeCloseTo(21.2, 1);
    expect(s.avgFps).toBeCloseTo(1000 / 21.2, 0);
    expect(s.onePercentLowFps).toBe(20);
    expect(s.avgDrawCalls).toBe(1705);
    expect(s.avgTriangles).toBe(160000);
    expect(summarize([], 1).frames).toBe(0);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    expect(percentile([1, 2, 3, 4], 100)).toBe(4);
  });

  it("rolls a live window by elapsed time and resolves a capture after its duration", async () => {
    const w = new FrameWindow(100);
    for (let i = 0; i < 20; i++) w.push({ dt: 10, calls: 1, triangles: 1 });
    expect(w.summary().frames).toBeLessThanOrEqual(11);
    const c = new Capture(0.05);
    expect(c.running).toBe(true);
    for (let i = 0; i < 4; i++) c.push({ dt: 20, calls: 5, triangles: 9 });
    const r = await c.done;
    expect(c.running).toBe(false);
    expect(r.frames).toBe(3);
    expect(r.avgDrawCalls).toBe(5);
  });

  it("defines the four presets A–D exactly as specified", () => {
    expect(PRESETS.map((p) => [p.id, p.shadows, p.ao, p.sway])).toEqual([
      ["A", true, true, true],
      ["B", true, false, true],
      ["C", false, false, true],
      ["D", true, false, false],
    ]);
  });
});
