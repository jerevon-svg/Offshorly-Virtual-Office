import { afterEach, describe, expect, it } from "vitest";
import { cleanOutfit, outfitFor, registerRuntimeAvatars, resetCharacterRuntimeForTests, runtimeAvatar, runtimeCastIdForEmail, setOutfit, setOutfits, wearOutfit } from "./characterRuntime";
import { appearanceFor, hasHumanBody, HUMANBASE_CATALOGUE, HUMANBASE_ENABLED, humanBodyFor, humanCatalogue } from "./humanBody";

// CHARACTER RUNTIME — approved, unpromoted heads and saved outfits, worn by the office at runtime (dev-only). The properties under
// test: a production character is never replaced; an outfit only ever dresses its own employee and only with catalogue garments;
// an empty runtime changes nothing.
const head = { artifactHash: "a".repeat(64), pipelineVersion: "p", mount: { scale: 0.91, pitchDeg: 0 }, bindingHash: "b".repeat(64), validatedAt: "2026-10-13T00:00:00Z" };
const isStatic = (id: string) => HUMANBASE_ENABLED.has(id);
afterEach(() => resetCharacterRuntimeForTests());

describe("outfits", () => {
  it("keep only garments and colourways the catalogue carries for that slot", () => {
    expect(cleanOutfit({ top: { assetId: "tee-offshorly", colorway: "sky" }, bottom: { assetId: "tee-offshorly", colorway: "sky" }, shoes: { assetId: "rocket-boots", colorway: "red" } }))
      .toEqual({ top: { assetId: "tee-offshorly", colorway: "sky" } });
    expect(cleanOutfit({ top: { assetId: "hoodie-crrn", colorway: "neon" } })).toEqual({});
    expect(cleanOutfit(null)).toEqual({});
  });
  it("are worn over an appearance without touching its head, hair or accessories", () => {
    const bon = appearanceFor("bon")!;
    const dressed = wearOutfit(bon, { top: { assetId: "hoodie-crrn", colorway: "bone" } });
    expect(dressed.top).toEqual({ assetId: "hoodie-crrn", colorway: "bone" });
    expect(dressed.identity).toEqual(bon.identity); expect(dressed.hair).toEqual(bon.hair); expect(dressed.bottom).toEqual(bon.bottom);
    expect(wearOutfit(bon, null)).toBe(bon);
  });
  it("dress only the employee they belong to", () => {
    setOutfits(new Map([["bon", { top: { assetId: "hoodie-crrn", colorway: "bone" } }]]));
    expect(humanBodyFor("bon", "")?.top).toEqual({ assetId: "hoodie-crrn", colorway: "bone" });
    expect(humanBodyFor("micah", "")?.top).toEqual(appearanceFor("micah")!.top);
    setOutfit("bon", {}); expect(outfitFor("bon")).toBeNull();
  });
});

describe("runtime-delivered heads", () => {
  it("draw an approved, unpromoted employee with the mount their record carries, from the served file", () => {
    expect(hasHumanBody("newhire", "")).toBe(false);
    registerRuntimeAvatars([{ castId: "newhire", email: "New.Hire@offshorly.com", url: "/virtual-office/scripts/x/newhire-v1.glb", head }], isStatic);
    expect(hasHumanBody("newhire", "")).toBe(true);
    expect(runtimeCastIdForEmail("new.hire@offshorly.com")).toBe("newhire");
    const cfg = humanBodyFor("newhire", "")!;
    expect(cfg.identity.headAssetId).toBe("humanbase:newhire");
    expect(cfg.identity.mount).toEqual({ scale: 0.91, pitchDeg: 0 });
    expect(humanCatalogue().get("humanbase:newhire")?.url).toBe("/virtual-office/scripts/x/newhire-v1.glb");
    expect(humanBodyFor("newhire", "?humanbase=0")).toBeNull();
  });
  it("never replace a production character, and an ambiguous owner gets nothing", () => {
    registerRuntimeAvatars([
      { castId: "bon", email: "jerevon@offshorly.com", url: "/evil.glb", head },
      { castId: "x1", email: "two@offshorly.com", url: "/x1.glb", head },
      { castId: "x2", email: "two@offshorly.com", url: "/x2.glb", head },
      { castId: "../etc", email: null, url: "/y.glb", head },
    ], isStatic);
    expect(runtimeAvatar("bon")).toBeNull();
    expect(humanCatalogue().get("humanbase:bon")?.url).toBe(HUMANBASE_CATALOGUE.get("humanbase:bon")?.url);
    expect(runtimeAvatar("x1")).toBeNull(); expect(runtimeAvatar("x2")).toBeNull(); expect(runtimeAvatar("../etc")).toBeNull();
  });
  it("an empty runtime is the production catalogue itself", () => {
    expect(humanCatalogue()).toBe(HUMANBASE_CATALOGUE);
  });
});
