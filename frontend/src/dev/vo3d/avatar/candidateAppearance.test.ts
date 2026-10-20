// candidateAppearance.test.ts — a NEW employee can be gated and previewed (2026-10-13): the candidate-review appearance falls back to
// the generic Offshorly recipe only where no production appearance exists, and never changes what renders.
import { describe, expect, it } from "vitest";
import { appearanceFor, candidateAppearance, hasHumanBody, humanBodyFor, identityHeadAsset } from "./humanBody";

describe("candidate review appearance (gate + preview only)", () => {
  it("an approved employee keeps exactly their production appearance", () => {
    for (const id of ["bon", "micah", "angelo", "clang", "france", "lui"]) expect(candidateAppearance(id)).toEqual(appearanceFor(id));
  });
  it("a new employee wears the generic recipe: their own head, the Offshorly uniform, the preset from their recipe", () => {
    const a = candidateAppearance("newperson"), f = candidateAppearance("newperson", undefined, "feminine");
    expect(a.identity.headAssetId).toBe("humanbase:newperson"); expect(a.bodyPreset).toBe("standard"); expect(a.idleProfile).toBe("masculine");
    expect(a.top.assetId).toBe("tee-offshorly"); expect(a.identity.mount).toBeUndefined();
    expect(f.bodyPreset).toBe("feminine"); expect(f.idleProfile).toBe("feminine");
  });
  it("takes the gate-validated mount when one is given", () => {
    const v = { newperson: { artifactHash: "a", pipelineVersion: "p", mount: { scale: 0.905, pitchDeg: 0 }, bindingHash: "b", validatedAt: "t" } };
    expect(candidateAppearance("newperson", v).identity.mount).toEqual({ scale: 0.905, pitchDeg: 0 });
  });
  it("its head asset is served from the candidate file, for known and new employees alike", () => {
    expect(identityHeadAsset("newperson", "/c.glb")).toMatchObject({ id: "humanbase:newperson", slot: "identity", url: "/c.glb" });
    expect(identityHeadAsset("bon", "/c.glb")).toMatchObject({ id: "humanbase:bon", url: "/c.glb" });
  });
  it("never changes what renders: a new employee is still not enabled in the office", () => {
    expect(humanBodyFor("newperson", "")).toBeNull(); expect(hasHumanBody("newperson", "")).toBe(false); expect(appearanceFor("newperson")).toBeNull();
  });
});

describe("a PROMOTED new employee renders in the office (appearanceFor with a validated record)", () => {
  it("wears the generic recipe with the validated mount and the preset its record carries", () => {
    const v = { newperson: { artifactHash: "a", pipelineVersion: "p", mount: { scale: 0.9, pitchDeg: 0 }, bindingHash: "b", validatedAt: "t", bodyPreset: "feminine" as const } };
    const a = appearanceFor("newperson", v)!; expect(a.identity.headAssetId).toBe("humanbase:newperson"); expect(a.identity.mount).toEqual({ scale: 0.9, pitchDeg: 0 }); expect(a.bodyPreset).toBe("feminine");
  });
});
