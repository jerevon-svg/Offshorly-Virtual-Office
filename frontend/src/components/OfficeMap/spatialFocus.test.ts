import { describe, expect, it } from "vitest";
import {
  CLUSTER_PADDING, PAIR_SCALE_CAP, GROUP_SCALE_CAP,
  clusterBounds, computeClusterFocus, readMapTransform, shouldRefocus,
} from "./spatialFocus";

const VP_W = 1512, VP_H = 982;
const MIN = 1.05, MAX = 1.05 * 5;
const person = (x: number, y: number) => ({ x, y, width: 26, height: 37 });

describe("spatial conversation focus camera", () => {
  it("returns null for an empty cluster", () => {
    expect(clusterBounds([])).toBeNull();
  });

  it("bounds the union of every participant", () => {
    const b = clusterBounds([person(100, 100), person(200, 160)])!;
    expect(b.x).toBe(100);
    expect(b.y).toBe(100);
    expect(b.width).toBe(126);
    expect(b.height).toBe(97);
  });

  it("a two-person cluster centres and zooms in close", () => {
    const b = clusterBounds([person(700, 600), person(760, 600)])!;
    const t = computeClusterFocus(b, 2, VP_W, VP_H, MIN, MAX);
    expect(t.scale).toBeGreaterThan(MIN * 2);       // meaningfully closer than default
    expect(t.scale).toBeLessThanOrEqual(MIN * PAIR_SCALE_CAP + 1e-9);
    // horizontally the cluster is centred exactly
    const cx = (b.x + b.width / 2) * t.scale + t.x;
    expect(cx).toBeCloseTo(VP_W / 2, 0);
    // vertically it is the PADDED box that is centred — the extra headroom
    // above (for name labels) intentionally seats the characters just below
    // the middle rather than dead-centre
    const py = b.y - CLUSTER_PADDING.top;
    const ph = b.height + CLUSTER_PADDING.top + CLUSTER_PADDING.bottom;
    expect((py + ph / 2) * t.scale + t.y).toBeCloseTo(VP_H / 2, 0);
    const cy = (b.y + b.height / 2) * t.scale + t.y;
    expect(cy).toBeGreaterThan(VP_H / 2);
  });

  it("a three-person cluster fits everyone, with padding, without clipping", () => {
    const boxes = [person(600, 600), person(700, 610), person(800, 590)];
    const b = clusterBounds(boxes)!;
    const t = computeClusterFocus(b, 3, VP_W, VP_H, MIN, MAX);
    for (const p of boxes) {
      const left = p.x * t.scale + t.x;
      const right = (p.x + p.width) * t.scale + t.x;
      const top = p.y * t.scale + t.y;
      const bottom = (p.y + p.height) * t.scale + t.y;
      expect(left).toBeGreaterThanOrEqual(0);
      expect(right).toBeLessThanOrEqual(VP_W);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(bottom).toBeLessThanOrEqual(VP_H);
    }
    // label headroom above the topmost participant is preserved
    const topMost = Math.min(...boxes.map((p) => p.y));
    expect(topMost * t.scale + t.y).toBeGreaterThanOrEqual(CLUSTER_PADDING.top * t.scale - 1);
  });

  it("a group is framed wider than a pair", () => {
    const pair = computeClusterFocus(clusterBounds([person(700, 600), person(740, 600)])!, 2, VP_W, VP_H, MIN, MAX);
    const group = computeClusterFocus(clusterBounds([person(700, 600), person(740, 600)])!, 4, VP_W, VP_H, MIN, MAX);
    expect(group.scale).toBeLessThan(pair.scale);
    expect(group.scale).toBeLessThanOrEqual(MIN * GROUP_SCALE_CAP + 1e-9);
  });

  it("never exceeds the map's own zoom limits", () => {
    const tiny = computeClusterFocus(clusterBounds([person(700, 600)])!, 1, VP_W, VP_H, MIN, MAX);
    expect(tiny.scale).toBeLessThanOrEqual(MAX);
    const huge = computeClusterFocus({ x: 0, y: 0, width: 1440, height: 1244 }, 8, VP_W, VP_H, MIN, MAX);
    expect(huge.scale).toBeGreaterThanOrEqual(MIN);
  });

  describe("when to refocus", () => {
    const s = (sessionId: string, members: string[]) => ({ sessionId, members });
    it("fires on entering a conversation", () => {
      expect(shouldRefocus(null, s("c1", ["a", "b"]))).toBe(true);
    });
    it("fires when the conversation changes", () => {
      expect(shouldRefocus(s("c1", ["a", "b"]), s("c2", ["a", "b"]))).toBe(true);
    });
    it("fires when a participant joins or leaves", () => {
      expect(shouldRefocus(s("c1", ["a", "b"]), s("c1", ["a", "b", "c"]))).toBe(true);
      expect(shouldRefocus(s("c1", ["a", "b", "c"]), s("c1", ["a", "b"]))).toBe(true);
    });
    it("does NOT fire while the same session continues — the user keeps their pan/zoom", () => {
      expect(shouldRefocus(s("c1", ["a", "b"]), s("c1", ["a", "b"]))).toBe(false);
      expect(shouldRefocus(s("c1", ["a", "b"]), s("c1", ["b", "a"]))).toBe(false);
    });
    it("does not fire on leaving (the exit path restores the captured transform instead)", () => {
      expect(shouldRefocus(s("c1", ["a", "b"]), null)).toBe(false);
    });
  });

  describe("reading the live map transform (the second-participant crash)", () => {
    // Shaped exactly like react-zoom-pan-pinch's ReactZoomPanPinchRef:
    // scale/positionX/positionY on the ref, and an `instance` that has NO
    // `transformState`. The old code read ref.instance.transformState.
    const realisticRef = {
      state: { scale: 2.5, positionX: -120, positionY: -80, previousScale: 1 },
      instance: { wrapperComponent: {}, contentComponent: {}, isInitialized: true },
    };

    it("reads scale and pan off the ref itself", () => {
      expect(readMapTransform(realisticRef)).toEqual({ x: -120, y: -80, scale: 2.5 });
    });

    it("the old instance.transformState path is undefined on that same ref", () => {
      const instance = realisticRef.instance as Record<string, unknown>;
      expect(instance.transformState).toBeUndefined();
      // ...which is why dereferencing it threw inside the focus effect
      expect(() => {
        const st = instance.transformState as { positionX: number };
        return st.positionX;
      }).toThrow(TypeError);
    });

    it("returns null instead of throwing when the ref is not ready", () => {
      expect(readMapTransform(null)).toBeNull();
      expect(readMapTransform(undefined)).toBeNull();
      expect(readMapTransform({} as never)).toBeNull();
    });
  });

  it("uses the session's own sessionId field, which is what the store provides", () => {
    // SpatialSessionEntry is { sessionId, members } — there is no `id`, so the
    // old `s.id` read produced undefined session identity and defeated the
    // refocus comparison.
    const entry: { sessionId: string; members: string[] } = {
      sessionId: "conv-1",
      members: ["a@x.com", "b@x.com"],
    };
    expect((entry as unknown as { id?: string }).id).toBeUndefined();
    expect(shouldRefocus(null, { sessionId: entry.sessionId, members: entry.members })).toBe(true);
    expect(
      shouldRefocus(
        { sessionId: undefined as unknown as string, members: entry.members },
        { sessionId: undefined as unknown as string, members: entry.members },
      ),
    ).toBe(false);
  });
});
