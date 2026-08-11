import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSavedAvatars, MockAvatarService } from "./MockAvatarService";

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
      nickname: "Testy",
      roomId: "design-team",
    });

    expect(saved.outfitId).toBe("hoodie");
    expect(saved.employeeName).toBe("Test Employee");
    expect(saved.nickname).toBe("Testy");
    expect(saved.roomId).toBe("design-team");
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
    // MockAvatarService uses randomized real-time delays (up to 2000ms per
    // generate/regenerate + 800ms per save). Two full round trips can exceed
    // vitest's default 5000ms testTimeout depending on the random draw,
    // causing intermittent failures. Fake timers remove the wall-clock
    // dependency entirely.
    vi.useFakeTimers();
    try {
      const service = new MockAvatarService();

      const generate1 = service.generateAvatar({ photoDataUrl: "data:image/png;base64,abc" });
      await vi.advanceTimersByTimeAsync(2000);
      const avatar1 = await generate1;

      const save1 = service.saveAvatar({
        avatar: avatar1,
        outfitId: "polo",
        employeeName: "A",
        nickname: "Nick A",
        roomId: "qa-room",
      });
      await vi.advanceTimersByTimeAsync(800);
      await save1;

      const generate2 = service.generateAvatar({ photoDataUrl: "data:image/png;base64,abc" });
      await vi.advanceTimersByTimeAsync(2000);
      const avatar2 = await generate2;

      const save2 = service.saveAvatar({
        avatar: avatar2,
        outfitId: "uniform",
        employeeName: "B",
        nickname: "Nick B",
        roomId: "dev-team",
      });
      await vi.advanceTimersByTimeAsync(800);
      await save2;

      const raw = window.localStorage.getItem("offshorly.avatars");
      const stored = JSON.parse(raw as string);
      expect(stored).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("loadSavedAvatars — legacy records without spriteSet", () => {
  it("loads a SavedAvatar JSON object without spriteSet without crashing", () => {
    const legacy = {
      avatarId: "avatar-legacy",
      previewUrl: "preview.png",
      confidence: 0.9,
      seed: "seed-legacy",
      generatedAt: new Date().toISOString(),
      outfitId: "polo",
      employeeName: "Legacy Employee",
      nickname: "Legacy",
      roomId: "qa-room",
      savedAt: new Date().toISOString(),
      // no spriteSet field — mirrors every record saved before this slice
    };
    window.localStorage.setItem("offshorly.avatars", JSON.stringify([legacy]));

    const loaded = loadSavedAvatars();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].spriteSet).toBeUndefined();
    expect(loaded[0].previewUrl).toBe("preview.png");
  });
});
