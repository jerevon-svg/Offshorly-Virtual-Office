import { describe, expect, it } from "vitest";
import { LIVE_3D_CHARACTERS, isLive3dEligible, resolveLive3dGlbUrl } from "./live3dCharacters";

// Asset-file integrity (old jerevon rollback set present + unmodified, bon-v2 files present) is
// verified in the shell as part of the commit validation (sha256 of public/avatars/jerevon/*),
// since the app tsconfig has no Node typings for fs access from tests.
describe("live3dCharacters registry (bon promoted to bon-v2 2026-08-28, alex added 2026-08-29)", () => {
  it("bon resolves to the bon-v2 LODs per tier: T2 lod0, T1 lod1, static-frame bucket lod2", () => {
    const bon = LIVE_3D_CHARACTERS.bon;
    expect(resolveLive3dGlbUrl(bon, "T2", false)).toMatch(/\/avatars\/bon-v2\/bon-v2-lod0\.glb$/);
    expect(resolveLive3dGlbUrl(bon, "T1", false)).toMatch(/\/avatars\/bon-v2\/bon-v2-lod1\.glb$/);
    expect(resolveLive3dGlbUrl(bon, "T0", true)).toMatch(/\/avatars\/bon-v2\/bon-v2-lod2\.glb$/);
  });

  it("alex resolves to his own LODs per tier: T2 lod0, T1 lod1, static-frame bucket lod2", () => {
    const alex = LIVE_3D_CHARACTERS.alex;
    expect(resolveLive3dGlbUrl(alex, "T2", false)).toMatch(/\/avatars\/alex\/alex-lod0\.glb$/);
    expect(resolveLive3dGlbUrl(alex, "T1", false)).toMatch(/\/avatars\/alex\/alex-lod1\.glb$/);
    expect(resolveLive3dGlbUrl(alex, "T0", true)).toMatch(/\/avatars\/alex\/alex-lod2\.glb$/);
    // Manifest aspect for alex is 20 / 34.46 — render size must keep it.
    expect(alex.renderWidth / alex.renderHeight).toBeCloseTo(20 / 34.46, 2);
  });

  it("registry holds exactly bon and alex; neither references the jerevon rollback set or the other's assets", () => {
    expect(Object.keys(LIVE_3D_CHARACTERS).sort()).toEqual(["alex", "bon"]);
    expect(isLive3dEligible("alex")).toBe(true);
    expect(isLive3dEligible("micah")).toBe(false);
    for (const url of Object.values(LIVE_3D_CHARACTERS.bon).filter((v): v is string => typeof v === "string")) {
      expect(url).not.toMatch(/jerevon|alex/);
    }
    for (const url of Object.values(LIVE_3D_CHARACTERS.alex).filter((v): v is string => typeof v === "string")) {
      expect(url).toMatch(/\/avatars\/alex\//);
      expect(url).not.toMatch(/bon/);
    }
  });
});
