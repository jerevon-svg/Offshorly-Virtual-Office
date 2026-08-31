import { describe, expect, it } from "vitest";
import { greetingAnchor, HEAD_LABEL_GAP_FRAME_UNITS } from "../components/OfficeMap/panMath";
import { FRAME_HEIGHT } from "../data/office-layout";
import { LIVE_3D_CHARACTERS, isLive3dEligible, resolveLive3dGlbUrl } from "./live3dCharacters";

// Asset-file integrity (old jerevon + bon-v2 rollback sets present + unmodified, bon-v3 files present) is
// verified in the shell as part of the commit validation (sha256 of public/avatars/jerevon/*),
// since the app tsconfig has no Node typings for fs access from tests.
describe("live3dCharacters registry (bon-v3 + alex-v2 2026-08-30; micah-v4 + angelo added 2026-08-30)", () => {
  it("bon resolves to the bon-v3-hq LODs per tier: T2 lod0, T1 lod1, static-frame bucket lod2", () => {
    const bon = LIVE_3D_CHARACTERS.bon;
    // Promoted 2026-08-30 to the bon-v3 set (built from the approved T-pose
    // master); the bon-v2 and jerevon sets stay on disk as rollbacks and must
    // NOT be referenced by the registry.
    expect(resolveLive3dGlbUrl(bon, "T2", false)).toMatch(/\/avatars\/bon-v3-hq\/bon-v3-lod0\.glb$/);
    expect(resolveLive3dGlbUrl(bon, "T1", false)).toMatch(/\/avatars\/bon-v3-hq\/bon-v3-lod1\.glb$/);
    expect(resolveLive3dGlbUrl(bon, "T0", true)).toMatch(/\/avatars\/bon-v3-hq\/bon-v3-lod2\.glb$/);
    // Manifest aspect for bon is 26.23 / 37.2 — render size must keep it.
    expect(bon.renderWidth / bon.renderHeight).toBeCloseTo(26.23 / 37.2, 2);
    for (const url of Object.values(bon).filter((v): v is string => typeof v === "string")) {
      expect(url).toMatch(/\/avatars\/bon-v3-hq\//);
    }
  });

  it("alex resolves to the alex-v2-hq LODs per tier: T2 lod0, T1 lod1, static-frame bucket lod2", () => {
    const alex = LIVE_3D_CHARACTERS.alex;
    expect(resolveLive3dGlbUrl(alex, "T2", false)).toMatch(/\/avatars\/alex-v2-hq\/alex-v2-lod0\.glb$/);
    expect(resolveLive3dGlbUrl(alex, "T1", false)).toMatch(/\/avatars\/alex-v2-hq\/alex-v2-lod1\.glb$/);
    expect(resolveLive3dGlbUrl(alex, "T0", true)).toMatch(/\/avatars\/alex-v2-hq\/alex-v2-lod2\.glb$/);
    // Manifest aspect for alex is 20 / 34.46 — render size must keep it.
    expect(alex.renderWidth / alex.renderHeight).toBeCloseTo(20 / 34.46, 2);
  });

  it("micah resolves to the micah-v5-hq LODs per tier: T2 lod0, T1 lod1, static-frame bucket lod2", () => {
    const micah = LIVE_3D_CHARACTERS.micah;
    expect(resolveLive3dGlbUrl(micah, "T2", false)).toMatch(/\/avatars\/micah-v5-hq\/micah-v5-lod0\.glb$/);
    expect(resolveLive3dGlbUrl(micah, "T1", false)).toMatch(/\/avatars\/micah-v5-hq\/micah-v5-lod1\.glb$/);
    expect(resolveLive3dGlbUrl(micah, "T0", true)).toMatch(/\/avatars\/micah-v5-hq\/micah-v5-lod2\.glb$/);
    // Manifest aspect for micah is 24.36 / 39.10 — render size must keep it.
    expect(micah.renderWidth / micah.renderHeight).toBeCloseTo(24.36 / 39.1, 2);
    // the rejected v1/v2/v3 chains must never be referenced
    for (const url of Object.values(micah).filter((v): v is string => typeof v === "string")) {
      expect(url).toMatch(/\/avatars\/micah-v5-hq\//);
      // every superseded chain stays on disk as a rollback but must never be referenced
      expect(url).not.toMatch(/avatars\/micah\/|micah-v2|micah-v3|micah-v4/);
    }
  });

  it("angelo resolves to the gelo-v1-hq LODs per tier: T2 lod0, T1 lod1, static-frame bucket lod2", () => {
    // Registry KEY is the roster/manifest id `angelo`; only the asset files
    // carry the pipeline chain name `gelo-v1`.
    const angelo = LIVE_3D_CHARACTERS.angelo;
    expect(resolveLive3dGlbUrl(angelo, "T2", false)).toMatch(/\/avatars\/gelo-v1-hq\/gelo-v1-lod0\.glb$/);
    expect(resolveLive3dGlbUrl(angelo, "T1", false)).toMatch(/\/avatars\/gelo-v1-hq\/gelo-v1-lod1\.glb$/);
    expect(resolveLive3dGlbUrl(angelo, "T0", true)).toMatch(/\/avatars\/gelo-v1-hq\/gelo-v1-lod2\.glb$/);
    // Manifest aspect for angelo is 28.18 / 39.85 — render size must keep it.
    expect(angelo.renderWidth / angelo.renderHeight).toBeCloseTo(28.18 / 39.85, 2);
  });

  it("registry holds exactly bon, alex, micah and angelo; none references a rollback or another character's assets", () => {
    expect(Object.keys(LIVE_3D_CHARACTERS).sort()).toEqual(["alex", "angelo", "bon", "micah"]);
    expect(isLive3dEligible("alex")).toBe(true);
    expect(isLive3dEligible("micah")).toBe(true);
    expect(isLive3dEligible("angelo")).toBe(true);
    expect(isLive3dEligible("lui")).toBe(false);
    for (const url of Object.values(LIVE_3D_CHARACTERS.bon).filter((v): v is string => typeof v === "string")) {
      expect(url).not.toMatch(/jerevon|alex/);
      // the bon-v2 rollback set must not be referenced either
      expect(url).not.toMatch(/bon-v2/);
    }
    for (const url of Object.values(LIVE_3D_CHARACTERS.alex).filter((v): v is string => typeof v === "string")) {
      expect(url).toMatch(/\/avatars\/alex-v2-hq\//);
      expect(url).not.toMatch(/bon/);
    }
  });
});

// Part B: the visible head-to-label gap must be the SAME for every live-3D
// employee, and must not depend on how much vertical animation headroom their
// layer box happens to carry.
describe("head-to-label gap", () => {
  const LAYER_HEIGHT: Record<string, number> = {
    bon: 37.2, alex: 34.46, micah: 39.1, angelo: 39.85,
  };
  // What the OLD layer-top anchor produced: head sits this far below the box
  // top, so the gap differed per character (this is the bug).
  const OLD_GAP: Record<string, number> = {
    bon: 4.002, alex: 2.937, micah: 4.686, angelo: 5.489,
  };

  it("every registered character carries a measured head offset", () => {
    for (const id of Object.keys(LIVE_3D_CHARACTERS)) {
      expect(LIVE_3D_CHARACTERS[id].headTopAboveCenter).toBeGreaterThan(0);
    }
  });

  it("reproduces the defect: the old layer-top anchor gave four different gaps", () => {
    const gaps = Object.values(OLD_GAP);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(2);
  });

  it("all four employees now share one gap, in their own layer AND in bon's seat box", () => {
    // rosterLayers.ts sizes every seated peer from bonLayer, so the same
    // character renders in a different box as a peer than as self. The gap must
    // survive both.
    for (const box of [null, 37.2] as const) {
      const gaps = Object.entries(LAYER_HEIGHT).map(([id, ownHeight]) => {
        const height = box ?? ownHeight;
        const head = LIVE_3D_CHARACTERS[id].headTopAboveCenter!;
        const { topPct } = greetingAnchor({ x: 0, y: 0, width: 10, height }, head);
        const labelY = (topPct / 100) * FRAME_HEIGHT;
        return height / 2 - head - labelY;
      });
      for (const g of gaps) expect(g).toBeCloseTo(HEAD_LABEL_GAP_FRAME_UNITS, 9);
      expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(1e-9);
    }
  });

  it("bon keeps his approved gap (no visible regression)", () => {
    expect(HEAD_LABEL_GAP_FRAME_UNITS).toBeCloseTo(OLD_GAP.bon, 1);
  });
});
