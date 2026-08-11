import { describe, expect, it } from "vitest";
import { savedAvatarsToLayers } from "./savedAvatarLayers";
import type { SavedAvatar } from "../services/avatar/types";

function makeAvatar(overrides: Partial<SavedAvatar> = {}): SavedAvatar {
  return {
    avatarId: "avatar-1",
    previewUrl: "preview.png",
    confidence: 0.9,
    seed: "seed-1",
    generatedAt: new Date().toISOString(),
    outfitId: "hoodie",
    employeeName: "Test",
    nickname: "Testy",
    roomId: "design-team",
    savedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("savedAvatarsToLayers", () => {
  it("marks a layer as static (animatable: false) when spriteSet is absent", () => {
    const [layer] = savedAvatarsToLayers([makeAvatar()]);
    expect(layer.animatable).toBe(false);
  });

  it("marks a layer as animatable when spriteSet is present", () => {
    const spriteSet = {
      walk: { left: ["l1", "l2"], right: ["r1", "r2"], front: ["f1", "f2"], back: ["b1", "b2"] },
      idle: { left: "li", right: "ri", front: "fi", back: "bi" },
      pat: { left: ["lp1", "lp2"], right: ["rp1", "rp2"], front: ["fp1", "fp2"], back: ["bp1", "bp2"] },
    } as SavedAvatar["spriteSet"];

    const [layer] = savedAvatarsToLayers([makeAvatar({ spriteSet })]);
    expect(layer.animatable).toBe(true);
  });

  it("skips avatars with an unknown/legacy roomId rather than mis-placing them", () => {
    const layers = savedAvatarsToLayers([makeAvatar({ roomId: "nonexistent-room" })]);
    expect(layers).toHaveLength(0);
  });
});
