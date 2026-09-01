import { describe, expect, it } from "vitest";
import { FRAME_WIDTH } from "../../data/office-layout";
import {
  attendFacePointFor,
  decideSummon,
  parkPointFor,
  toucanRenderPx,
  travelDurationFor,
  uprightPitchTarget,
  yawToward,
} from "./ToucanFlyer";

// Focused unit tests for the Stage 1 "Call Toucan" summon state machine only
// (ToucanFlyer's decideSummon/parkPointFor). Deliberately says nothing about
// the roaming waypoint logic, the flight interpolation or the wing rhythm —
// all of that is unchanged and covered by its own existing tests.

const AT = (x: number, y: number) => ({ x, y });

describe("parkPointFor", () => {
  it("parks beside the character, never above it", () => {
    const center = AT(400, 600);
    const park = parkPointFor(center);
    expect(park.y).toBe(center.y); // no vertical offset — labels live up there
    // Tuned down from 55 so the bird parks plainly "with" the user.
    expect(Math.abs(park.x - center.x)).toBe(32);
  });

  it("parks toward the middle of the map from either half", () => {
    expect(parkPointFor(AT(100, 500)).x).toBeGreaterThan(100); // left half -> to the right
    expect(parkPointFor(AT(FRAME_WIDTH - 100, 500)).x).toBeLessThan(FRAME_WIDTH - 100);
  });

  it("clamps so the bird never parks off the frame edge", () => {
    expect(parkPointFor(AT(2, 500)).x).toBeGreaterThanOrEqual(32);
    expect(parkPointFor(AT(FRAME_WIDTH - 2, 500)).x).toBeLessThanOrEqual(FRAME_WIDTH - 32);
  });
});

describe("decideSummon", () => {
  it("does nothing while roaming with no summon", () => {
    for (const phase of ["flying", "paused"] as const) {
      expect(decideSummon({ center: null, phase, pos: AT(0, 0), to: AT(0, 0) })).toEqual({ kind: "hold" });
    }
  });

  it("enters the approach from both roaming phases", () => {
    for (const phase of ["flying", "paused"] as const) {
      const d = decideSummon({ center: AT(400, 600), phase, pos: AT(0, 0), to: AT(0, 0) });
      expect(d.kind).toBe("approach");
    }
  });

  it("holds an in-progress approach when the park point barely moves", () => {
    // Player shuffled 10px: inside the 40px deadband, so travelT is not reset.
    const d = decideSummon({
      center: AT(410, 600),
      phase: "approaching",
      pos: AT(0, 0),
      to: parkPointFor(AT(400, 600)),
    });
    expect(d).toEqual({ kind: "hold" });
  });

  it("re-aims an in-progress approach when the player really walks", () => {
    const d = decideSummon({
      center: AT(700, 600),
      phase: "approaching",
      pos: AT(0, 0),
      to: parkPointFor(AT(400, 600)),
    });
    expect(d.kind).toBe("retarget");
  });

  it("latches attending inside the arrival radius", () => {
    const park = parkPointFor(AT(400, 600));
    const d = decideSummon({
      center: AT(400, 600),
      phase: "approaching",
      pos: AT(park.x + 8, park.y),
      to: park,
    });
    expect(d).toEqual({ kind: "attend" });
  });

  it("does not latch early enough to park noticeably short of the user", () => {
    // Regression guard for the live-measured bug: with a 32px park offset, a
    // loose arrival radius made the bird stop ~44px away. The radius must
    // stay small relative to the offset.
    const center = AT(400, 600);
    const park = parkPointFor(center);
    const d = decideSummon({
      center,
      phase: "approaching",
      // 20px short of the park point, i.e. ~52px from the user.
      pos: AT(park.x + 20, park.y),
      to: park,
    });
    expect(d.kind).not.toBe("attend");
  });

  it("ignores small movement while attending (no chasing/jitter)", () => {
    const park = parkPointFor(AT(400, 600));
    const d = decideSummon({ center: AT(430, 600), phase: "attending", pos: park, to: park });
    expect(d).toEqual({ kind: "hold" });
  });

  it("catches up when the player walks far away while attending", () => {
    const park = parkPointFor(AT(400, 600));
    const d = decideSummon({ center: AT(900, 600), phase: "attending", pos: park, to: park });
    expect(d.kind).toBe("approach");
  });

  it("releases back to roaming from both summon phases", () => {
    for (const phase of ["approaching", "attending"] as const) {
      expect(decideSummon({ center: null, phase, pos: AT(1, 1), to: AT(1, 1) })).toEqual({
        kind: "release",
      });
    }
  });
});

describe("travelDurationFor", () => {
  it("leaves normal roaming exactly as it was (distance/55, clamped 4-18s, times jitter)", () => {
    // Long leg: the raw distance/speed term is what governs.
    expect(travelDurationFor(550, "roaming")).toBeCloseTo(10, 5);
    // Short leg: roaming's 4s floor still applies...
    expect(travelDurationFor(50, "roaming")).toBeCloseTo(4, 5);
    // ...the 18s ceiling still applies...
    expect(travelDurationFor(5000, "roaming")).toBeCloseTo(18, 5);
    // ...and the jitter is still a plain multiplier on the clamped value.
    expect(travelDurationFor(550, "roaming", 0.85)).toBeCloseTo(8.5, 5);
    expect(travelDurationFor(50, "roaming", 1.15)).toBeCloseTo(4.6, 5);
  });

  it("flies a summoned approach faster than the same roaming leg", () => {
    for (const dist of [400, 700, 1200]) {
      expect(travelDurationFor(dist, "summon")).toBeLessThan(travelDurationFor(dist, "roaming"));
    }
    // 1.8x on the speed term itself.
    expect(travelDurationFor(990, "summon")).toBeCloseTo(10, 5);
    expect(travelDurationFor(990, "roaming")).toBeCloseTo(18, 5);
  });

  it("keeps a summon responsive on the short hops roaming's 4s floor would swallow", () => {
    expect(travelDurationFor(50, "summon")).toBeCloseTo(0.9, 5);
    expect(travelDurationFor(200, "summon")).toBeLessThan(2.5);
  });

  it("ignores jitter on a summon, so a click always responds identically", () => {
    expect(travelDurationFor(600, "summon", 0.85)).toBe(travelDurationFor(600, "summon", 1.15));
  });
});

describe("uprightPitchTarget", () => {
  it("is exactly zero for both roaming phases at every distance", () => {
    for (const phase of ["flying", "paused"] as const) {
      for (const d of [0, 50, 320, 1000, Infinity]) {
        expect(uprightPitchTarget(phase, d)).toBe(0);
      }
    }
  });

  it("eases in as a summoned bird closes on the user", () => {
    const far = uprightPitchTarget("approaching", 1000);
    const mid = uprightPitchTarget("approaching", 160);
    const near = uprightPitchTarget("approaching", 0);
    expect(far).toBe(0);
    expect(mid).toBeGreaterThan(0);
    expect(near).toBeGreaterThan(mid);
  });

  it("holds the bird upright while parked", () => {
    expect(uprightPitchTarget("attending", 0)).toBeGreaterThan(0);
    expect(uprightPitchTarget("attending", 999)).toBe(uprightPitchTarget("attending", 0));
  });
});

describe("attendFacePointFor", () => {
  it("latches the user's centre on arrival", () => {
    expect(attendFacePointFor(null, AT(400, 600))).toEqual(AT(400, 600));
  });

  it("ignores small movement so a parked bird never swivels on noise", () => {
    const latched = AT(400, 600);
    expect(attendFacePointFor(latched, AT(415, 610))).toBe(latched);
  });

  it("re-latches once the user really walks", () => {
    const latched = AT(400, 600);
    expect(attendFacePointFor(latched, AT(600, 600))).toEqual(AT(600, 600));
  });
});

describe("yawToward", () => {
  it("points the bird's head at the target, not away from it", () => {
    // Target directly "north" (-y) of the bird: local -Z (the head) must end
    // up pointing that way, which in this convention is yaw 0 (mod 2*PI).
    const yaw = yawToward(AT(500, 500), AT(500, 300));
    expect(Math.sin(yaw)).toBeCloseTo(0, 6);
    expect(Math.cos(yaw)).toBeCloseTo(1, 6);
    // Opposite direction must differ by half a turn.
    const back = yawToward(AT(500, 500), AT(500, 700));
    expect(Math.abs(Math.cos(back) - Math.cos(yaw))).toBeCloseTo(2, 6);
  });

  it("is what an attending bird uses to face the user beside it", () => {
    // Parked 32px to the user's right -> must face left (-x), i.e. yaw where
    // local -Z maps to (-1, 0).
    const yaw = yawToward(AT(532, 600), AT(500, 600));
    expect(Math.sin(yaw)).toBeCloseTo(1, 6);
  });
});

describe("toucanRenderPx (zoom-aware render resolution)", () => {
  // Bird CSS box is RENDER_SIZE(28) x zoom; base raster is 28 * SUPERSAMPLE(3) * dpr.
  it("keeps exactly the previous fixed raster at normal zoom", () => {
    expect(toucanRenderPx(28, 1)).toBe(84); // 28 * 3 * 1
    expect(toucanRenderPx(28, 2)).toBe(168); // 28 * 3 * 2
  });

  it("never renders below that base when zoomed out", () => {
    expect(toucanRenderPx(10, 2)).toBe(168);
    expect(toucanRenderPx(0, 2)).toBe(168); // not laid out yet
  });

  it("raises resolution as the bird grows on screen", () => {
    // ~1.6x zoom: still inside the base, unchanged.
    expect(toucanRenderPx(45, 2)).toBe(168);
    // Max zoom (5x -> 140 CSS px) on a 2x display needs 280 device px, which
    // the old fixed 168 could only upscale. Now it clears it.
    expect(toucanRenderPx(140, 2)).toBeGreaterThanOrEqual(280);
  });

  it("is monotonic in on-screen size and capped for performance", () => {
    const sizes = [28, 45, 70, 100, 140, 200, 400];
    const px = sizes.map((s) => toucanRenderPx(s, 2));
    for (let i = 1; i < px.length; i++) expect(px[i]).toBeGreaterThanOrEqual(px[i - 1]);
    // Top bucket is 3x base — a deep zoom cannot run away with fill cost.
    expect(Math.max(...px)).toBe(168 * 3);
  });

  it("caps device pixel ratio the same way the character policy does", () => {
    // A 3x display is treated as 2x (MAX_EFFECTIVE_DPR).
    expect(toucanRenderPx(140, 3)).toBe(toucanRenderPx(140, 2));
  });
});
