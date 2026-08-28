import { describe, expect, it } from "vitest";
import { LIVE_3D_CHARACTERS, resolveLive3dGlbUrl } from "./live3dCharacters";

// Asset-file integrity (old jerevon rollback set present + unmodified, bon-v2 files present) is
// verified in the shell as part of the commit validation (sha256 of public/avatars/jerevon/*),
// since the app tsconfig has no Node typings for fs access from tests.
describe("live3dCharacters registry (bon promoted to bon-v2, 2026-08-28)", () => {
  it("bon resolves to the bon-v2 LODs per tier: T2 lod0, T1 lod1, static-frame bucket lod2", () => {
    const bon = LIVE_3D_CHARACTERS.bon;
    expect(resolveLive3dGlbUrl(bon, "T2", false)).toMatch(/\/avatars\/bon-v2\/bon-v2-lod0\.glb$/);
    expect(resolveLive3dGlbUrl(bon, "T1", false)).toMatch(/\/avatars\/bon-v2\/bon-v2-lod1\.glb$/);
    expect(resolveLive3dGlbUrl(bon, "T0", true)).toMatch(/\/avatars\/bon-v2\/bon-v2-lod2\.glb$/);
  });

  it("Old Jerevon rollback paths are not referenced by the registry anymore, and bon is still the only entry", () => {
    expect(Object.keys(LIVE_3D_CHARACTERS)).toEqual(["bon"]);
    for (const url of Object.values(LIVE_3D_CHARACTERS.bon).filter((v): v is string => typeof v === "string")) {
      expect(url).not.toMatch(/jerevon/);
    }
  });
});
