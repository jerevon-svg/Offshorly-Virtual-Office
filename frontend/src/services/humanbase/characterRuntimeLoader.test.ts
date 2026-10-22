import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const studio = vi.hoisted(() => ({ getRuntimeAvatars: vi.fn() }));
const wardrobe = vi.hoisted(() => ({ getAllOutfits: vi.fn() }));
vi.mock("./characterStudio", async (orig) => ({ ...(await orig<typeof import("./characterStudio")>()), ...studio }));
vi.mock("../avatar/wardrobeClient", () => wardrobe);

import { castIdForEmail, prepareCharacterRuntime, resetCharacterRuntimeLoaderForTests } from "./characterRuntimeLoader";
import { outfitFor, resetCharacterRuntimeForTests, runtimeAvatar } from "../../dev/vo3d/avatar/characterRuntime";

const head = { artifactHash: "a".repeat(64), pipelineVersion: "p", mount: { scale: 0.9, pitchDeg: 0 }, bindingHash: "b".repeat(64), validatedAt: "2026-10-13T00:00:00Z" };
const rec = (castId: string, email: string | null) => ({ castId, email, file: `scripts/x/${castId}-v1.glb`, tag: "corr-v1", head });
const TEE = { assetId: "tee-offshorly", colorway: "sky" };

beforeEach(() => { vi.stubEnv("VITE_CHARACTER_STUDIO", "1"); resetCharacterRuntimeLoaderForTests(); resetCharacterRuntimeForTests(); });
afterEach(() => { vi.unstubAllEnvs(); studio.getRuntimeAvatars.mockReset(); wardrobe.getAllOutfits.mockReset(); });

describe("prepareCharacterRuntime", () => {
  it("registers approved heads and dresses each body with its own employee's outfit", async () => {
    studio.getRuntimeAvatars.mockResolvedValue([rec("newhire", "new.hire@offshorly.com")]);
    wardrobe.getAllOutfits.mockResolvedValue({ "new.hire@offshorly.com": { top: TEE }, "jerevon@offshorly.com": { top: { assetId: "hoodie-crrn", colorway: "bone" } }, "nobody@offshorly.com": { top: TEE } });
    await prepareCharacterRuntime();
    expect(runtimeAvatar("newhire")?.url).toBe(`${import.meta.env.BASE_URL}scripts/x/newhire-v1.glb`);
    expect(castIdForEmail("new.hire@offshorly.com")).toBe("newhire");
    expect(outfitFor("newhire")).toEqual({ top: TEE });
    expect(outfitFor("bon")).toEqual({ top: { assetId: "hoodie-crrn", colorway: "bone" } });
    expect(outfitFor("nobody")).toBeNull();
  });
  it("never hands a head to an owner whose own app identity is someone else's character", async () => {
    studio.getRuntimeAvatars.mockResolvedValue([rec("lui", "jerevon@offshorly.com")]);   // jerevon@ is Bon in the app's registry
    wardrobe.getAllOutfits.mockResolvedValue({});
    await prepareCharacterRuntime();
    expect(runtimeAvatar("lui")).toBeNull();
  });
  it("off (every production build) it asks nobody and changes nothing; a failing Studio or backend is just empty", async () => {
    vi.stubEnv("VITE_CHARACTER_STUDIO", "");
    await prepareCharacterRuntime();
    expect(studio.getRuntimeAvatars).not.toHaveBeenCalled(); expect(wardrobe.getAllOutfits).not.toHaveBeenCalled();
    vi.stubEnv("VITE_CHARACTER_STUDIO", "1");
    studio.getRuntimeAvatars.mockRejectedValue(new Error("down")); wardrobe.getAllOutfits.mockResolvedValue({});
    await expect(prepareCharacterRuntime()).resolves.toBeUndefined();
    expect(runtimeAvatar("newhire")).toBeNull();
  });
  it("the normal mock VO (mode mock, no Character Studio) draws approved heads but never loads outfits; real mode and =0 stay off", async () => {
    vi.stubEnv("VITE_CHARACTER_STUDIO", ""); vi.stubEnv("MODE", "mock");
    studio.getRuntimeAvatars.mockResolvedValue([rec("newhire", "newhire@offshorly.com")]);
    await prepareCharacterRuntime();
    expect(runtimeAvatar("newhire")?.url).toMatch(/newhire-v1\.glb$/); expect(wardrobe.getAllOutfits).not.toHaveBeenCalled();
    for (const [mode, flag] of [["development", undefined], ["mock", "0"]] as const) {
      resetCharacterRuntimeLoaderForTests(); resetCharacterRuntimeForTests(); studio.getRuntimeAvatars.mockClear();
      vi.stubEnv("MODE", mode); if (flag) vi.stubEnv("VITE_HUMANBASE_RUNTIME", flag);
      await prepareCharacterRuntime();
      expect(studio.getRuntimeAvatars).not.toHaveBeenCalled(); expect(runtimeAvatar("newhire")).toBeNull();
    }
  });
});
