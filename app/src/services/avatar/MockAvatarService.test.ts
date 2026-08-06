import { beforeEach, describe, expect, it } from "vitest";
import { MockAvatarService } from "./MockAvatarService";

beforeEach(() => {
  window.localStorage.clear();
});

describe("MockAvatarService.generateAvatar", () => {
  it("returns a valid GeneratedAvatar shape", async () => {
    const service = new MockAvatarService();
    const result = await service.generateAvatar({ photoDataUrl: "data:image/png;base64,abc" });

    expect(result.avatarId).toBeTruthy();
    expect(result.previewUrl).toBeTruthy();
    expect(result.confidence).toBeGreaterThanOrEqual(0.82);
    expect(result.confidence).toBeLessThanOrEqual(0.97);
    expect(result.seed).toBeTruthy();
    expect(new Date(result.generatedAt).toString()).not.toBe("Invalid Date");
  });
});

describe("MockAvatarService.regenerateAvatar", () => {
  it("changes the seed and preview from the previous result", async () => {
    const service = new MockAvatarService();
    const first = await service.generateAvatar({ photoDataUrl: "data:image/png;base64,abc" });
    const second = await service.regenerateAvatar(first, {
      photoDataUrl: "data:image/png;base64,abc",
    });

    expect(second.seed).not.toBe(first.seed);
    expect(second.avatarId).not.toBe(first.avatarId);
  });
});

describe("MockAvatarService.saveAvatar", () => {
  it("persists to localStorage under offshorly.avatars and returns the right shape", async () => {
    const service = new MockAvatarService();
    const avatar = await service.generateAvatar({ photoDataUrl: "data:image/png;base64,abc" });
    const saved = await service.saveAvatar({
      avatar,
      outfitId: "hoodie",
      employeeName: "Test Employee",
    });

    expect(saved.outfitId).toBe("hoodie");
    expect(saved.employeeName).toBe("Test Employee");
    expect(saved.savedAt).toBeTruthy();
    expect(saved.avatarId).toBe(avatar.avatarId);

    const raw = window.localStorage.getItem("offshorly.avatars");
    expect(raw).toBeTruthy();
    const stored = JSON.parse(raw as string);
    expect(Array.isArray(stored)).toBe(true);
    expect(stored).toHaveLength(1);
    expect(stored[0].outfitId).toBe("hoodie");
  });

  it("appends multiple saved avatars rather than overwriting", async () => {
    const service = new MockAvatarService();
    const avatar1 = await service.generateAvatar({ photoDataUrl: "data:image/png;base64,abc" });
    await service.saveAvatar({ avatar: avatar1, outfitId: "polo", employeeName: "A" });
    const avatar2 = await service.generateAvatar({ photoDataUrl: "data:image/png;base64,abc" });
    await service.saveAvatar({ avatar: avatar2, outfitId: "uniform", employeeName: "B" });

    const raw = window.localStorage.getItem("offshorly.avatars");
    const stored = JSON.parse(raw as string);
    expect(stored).toHaveLength(2);
  });
});
