import { describe, expect, it } from "vitest";
import {
  TILE, THRESHOLDS, MIN_TIER_HOLD_MS,
  resolveLodTier, applyTierDebounce, frameDistance, isLayerOnScreen,
  shouldUseMaxQuality, HD_QUALITY_ZOOM_ENTER, HD_QUALITY_ZOOM_EXIT, type LodTier,
} from "./adaptiveLod";

const at = (o: Partial<Parameters<typeof resolveLodTier>[0]>) =>
  ({ isSelf: false, isFocused: false, zoom: 1, distance: 10 * TILE, ...o });

describe("adaptive LOD tier selection", () => {
  it("self always gets the HQ tier, however far or zoomed out", () => {
    expect(resolveLodTier(at({ isSelf: true, zoom: 0.4, distance: 40 * TILE }), null)).toBe("lod0");
  });

  it("a focused spatial-conversation partner always gets the HQ tier", () => {
    expect(resolveLodTier(at({ isFocused: true, zoom: 0.4, distance: 40 * TILE }), null)).toBe("lod0");
  });

  it("zooming in past the HQ threshold promotes a distant peer", () => {
    expect(resolveLodTier(at({ zoom: THRESHOLDS.zoomHqEnter, distance: 20 * TILE }), null)).toBe("lod0");
  });

  it("a visible near peer gets HQ at the DEFAULT cover zoom — zoom cannot override proximity", () => {
    expect(resolveLodTier(at({ zoom: 1.0, distance: THRESHOLDS.nearEnterTiles * TILE }), null)).toBe("lod0");
  });

  it("a medium-distance visible peer floors at LOD1 at cover zoom — never the cracked LOD2", () => {
    expect(resolveLodTier(at({ zoom: 1.0, distance: 5 * TILE }), null)).toBe("lod1");
  });

  it("a distant peer at cover zoom is the only one demoted to LOD2", () => {
    expect(resolveLodTier(at({ zoom: 1.0, distance: THRESHOLDS.farEnterTiles * TILE }), null)).toBe("lod2");
  });

  it("an offscreen character is never promoted, however far the user zooms in", () => {
    expect(resolveLodTier(at({ zoom: 5, distance: 1 * TILE, isOnScreen: false }), null)).toBe("lod2");
    // ...but self and the focused partner still win, they are what is on show
    expect(resolveLodTier(at({ zoom: 5, isSelf: true, isOnScreen: false }), null)).toBe("lod0");
  });

  it("isLayerOnScreen culls only genuinely offscreen layers", () => {
    const view = { x: 100, y: 100, width: 400, height: 300 };
    expect(isLayerOnScreen({ x: 200, y: 200, width: 20, height: 30 }, view)).toBe(true);
    expect(isLayerOnScreen({ x: 900, y: 200, width: 20, height: 30 }, view)).toBe(false);
    expect(isLayerOnScreen({ x: 900, y: 200, width: 20, height: 30 }, null)).toBe(true);
  });

  it("zooming below cover demotes a MEDIUM peer", () => {
    expect(resolveLodTier(at({ zoom: THRESHOLDS.zoomFarEnter, distance: 5 * TILE }), null)).toBe("lod2");
  });

  describe("precedence — nothing overrides identity, attention or proximity", () => {
    for (const zoom of [0.2, 0.9, 1.0, 1.5, 5]) {
      it(`self stays LOD0 at zoom ${zoom}`, () => {
        expect(resolveLodTier(at({ isSelf: true, zoom, distance: 40 * TILE }), null)).toBe("lod0");
      });
      it(`a focused / spatial participant stays LOD0 at zoom ${zoom}`, () => {
        expect(resolveLodTier(at({ isFocused: true, zoom, distance: 40 * TILE }), null)).toBe("lod0");
      });
      it(`a visible near peer stays LOD0 at zoom ${zoom}`, () => {
        expect(resolveLodTier(at({ zoom, distance: 1 * TILE }), null)).toBe("lod0");
      });
    }

    it("zoom-out demotion reaches medium and distant peers only", () => {
      expect(resolveLodTier(at({ zoom: 0.5, distance: 5 * TILE }), null)).toBe("lod2");
      expect(resolveLodTier(at({ zoom: 0.5, distance: 20 * TILE }), null)).toBe("lod2");
      // ...but not near, self or focused
      expect(resolveLodTier(at({ zoom: 0.5, distance: 1 * TILE }), null)).toBe("lod0");
      expect(resolveLodTier(at({ zoom: 0.5, isSelf: true }), null)).toBe("lod0");
      expect(resolveLodTier(at({ zoom: 0.5, isFocused: true }), null)).toBe("lod0");
    });

    it("cover zoom never demotes by itself — distance decides at the default view", () => {
      expect(resolveLodTier(at({ zoom: 1.0, distance: 1 * TILE }), null)).toBe("lod0");
      expect(resolveLodTier(at({ zoom: 1.0, distance: 5 * TILE }), null)).toBe("lod1");
      expect(resolveLodTier(at({ zoom: 1.0, distance: 20 * TILE }), null)).toBe("lod2");
      expect(THRESHOLDS.zoomFarEnter).toBeLessThan(1.0);
    });
  });

  it("far away drops to the cheap tier", () => {
    expect(resolveLodTier(at({ zoom: 1.4, distance: THRESHOLDS.farEnterTiles * TILE }), null)).toBe("lod2");
  });

  it("mid distance / mid zoom uses the middle tier", () => {
    expect(resolveLodTier(at({ zoom: 1.4, distance: 5 * TILE }), null)).toBe("lod1");
  });

  describe("hysteresis", () => {
    it("holds lod0 through the gap between enter and exit zoom", () => {
      const mid = (THRESHOLDS.zoomHqEnter + THRESHOLDS.zoomHqExit) / 2;
      expect(resolveLodTier(at({ zoom: mid, distance: 20 * TILE }), null)).not.toBe("lod0");
      expect(resolveLodTier(at({ zoom: mid, distance: 20 * TILE }), "lod0")).toBe("lod0");
    });

    it("holds lod0 through the gap between enter and exit radius", () => {
      const d = ((THRESHOLDS.nearEnterTiles + THRESHOLDS.nearExitTiles) / 2) * TILE;
      expect(resolveLodTier(at({ zoom: 1.3, distance: d }), null)).not.toBe("lod0");
      expect(resolveLodTier(at({ zoom: 1.3, distance: d }), "lod0")).toBe("lod0");
    });

    it("holds lod2 through the gap between enter and exit zoom", () => {
      const z = (THRESHOLDS.zoomFarEnter + THRESHOLDS.zoomFarExit) / 2;
      expect(resolveLodTier(at({ zoom: z, distance: 5 * TILE }), null)).not.toBe("lod2");
      expect(resolveLodTier(at({ zoom: z, distance: 5 * TILE }), "lod2")).toBe("lod2");
    });

    it("holds lod2 through the gap between enter and exit radius", () => {
      const d = ((THRESHOLDS.farEnterTiles + THRESHOLDS.farExitTiles) / 2) * TILE;
      expect(resolveLodTier(at({ zoom: 1.4, distance: d }), null)).not.toBe("lod2");
      expect(resolveLodTier(at({ zoom: 1.4, distance: d }), "lod2")).toBe("lod2");
    });

    it("a viewer oscillating across a boundary never flip-flops", () => {
      let tier: LodTier | null = null;
      const seen = new Set<LodTier>();
      for (let i = 0; i < 40; i++) {
        const zoom = THRESHOLDS.zoomHqEnter + (i % 2 === 0 ? 0.01 : -0.15);
        tier = resolveLodTier(at({ zoom, distance: 20 * TILE }), tier);
        seen.add(tier);
      }
      // once it enters lod0 the exit threshold keeps it there
      expect(tier).toBe("lod0");
      expect(seen.size).toBeLessThanOrEqual(2);
    });
  });

  describe("debounce", () => {
    it("first resolve is immediate", () => {
      expect(applyTierDebounce("lod0", null, 0, 0)).toBe("lod0");
    });
    it("blocks a switch inside the hold window", () => {
      expect(applyTierDebounce("lod2", "lod0", 1000, 1000 + MIN_TIER_HOLD_MS - 1)).toBe("lod0");
    });
    it("allows a switch once the hold window elapses", () => {
      expect(applyTierDebounce("lod2", "lod0", 1000, 1000 + MIN_TIER_HOLD_MS)).toBe("lod2");
    });
    it("an unchanged tier is never treated as a switch", () => {
      expect(applyTierDebounce("lod0", "lod0", 1000, 1001)).toBe("lod0");
    });
  });

  it("frameDistance measures between layer centres", () => {
    const a = { x: 0, y: 0, width: 20, height: 40 };
    const b = { x: 30, y: 0, width: 20, height: 40 };
    expect(frameDistance(a, b)).toBeCloseTo(30, 6);
  });

  describe("maximum render quality by on-screen size", () => {
    const q = (o: Partial<Parameters<typeof shouldUseMaxQuality>[0]>, cur = false) =>
      shouldUseMaxQuality({ isSelf: false, isFocused: false, distance: 0, ...o }, cur);

    it("a spatial participant keeps the pin at any zoom", () => {
      for (const zoom of [undefined, 0.5, 1, 5]) expect(q({ isFocused: true, zoom })).toBe(true);
    });

    it("manual zoom to a Spatial-Chat-comparable size earns it without any chat", () => {
      expect(q({ zoom: HD_QUALITY_ZOOM_ENTER })).toBe(true);
      // Spatial Chat frames a pair at 4.2x cover, which is above the entry
      expect(q({ zoom: 4.2 })).toBe(true);
    });

    it("medium and default zoom do not", () => {
      expect(q({ zoom: 1 })).toBe(false);
      expect(q({ zoom: 2 })).toBe(false);
    });

    it("zooming back out restores adaptive quality", () => {
      expect(q({ zoom: 1 }, true)).toBe(false);
    });

    it("has hysteresis between entry and exit", () => {
      const mid = (HD_QUALITY_ZOOM_ENTER + HD_QUALITY_ZOOM_EXIT) / 2;
      expect(q({ zoom: mid }, false)).toBe(false);   // not enough to enter
      expect(q({ zoom: mid }, true)).toBe(true);     // but enough to hold
      expect(HD_QUALITY_ZOOM_EXIT).toBeLessThan(HD_QUALITY_ZOOM_ENTER);
    });

    it("never promotes anything offscreen, however far zoomed in", () => {
      expect(q({ zoom: 5, isOnScreen: false })).toBe(false);
      expect(q({ zoom: 5, isSelf: true, isOnScreen: false })).toBe(false);
      // a spatial participant is the one exception: they are the subject
      expect(q({ zoom: 5, isFocused: true, isOnScreen: false })).toBe(true);
    });

    it("with no zoom signal it stays adaptive rather than guessing", () => {
      expect(q({ zoom: undefined })).toBe(false);
    });

    it("manual zoom and Spatial Chat reach the SAME quality at comparable size", () => {
      const manual = { zoom: 4.2, isFocused: false };
      const chat = { zoom: 4.2, isFocused: true };
      expect(q(manual)).toBe(q(chat));
      expect(resolveLodTier({ isSelf: false, isFocused: false, zoom: 4.2, distance: 20 * TILE }, null))
        .toBe(resolveLodTier({ isSelf: false, isFocused: true, zoom: 4.2, distance: 20 * TILE }, null));
    });
  });
});
