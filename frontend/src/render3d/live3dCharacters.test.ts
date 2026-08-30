import { describe, expect, it } from "vitest";
import { LIVE_3D_CHARACTERS, isLive3dEligible, resolveLive3dGlbUrl } from "./live3dCharacters";

// Asset-file integrity (old jerevon + bon-v2 rollback sets present + unmodified, bon-v3 files present) is
// verified in the shell as part of the commit validation (sha256 of public/avatars/jerevon/*),
// since the app tsconfig has no Node typings for fs access from tests.
describe("live3dCharacters registry (bon promoted to bon-v3 2026-08-30, alex added 2026-08-29)", () => {
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

  it("registry holds exactly bon and alex; neither references the jerevon rollback set or the other's assets", () => {
    expect(Object.keys(LIVE_3D_CHARACTERS).sort()).toEqual(["alex", "bon"]);
    expect(isLive3dEligible("alex")).toBe(true);
    expect(isLive3dEligible("micah")).toBe(false);
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
