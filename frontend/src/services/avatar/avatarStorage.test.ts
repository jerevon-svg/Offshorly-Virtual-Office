import { beforeEach, describe, expect, it } from "vitest";
import {
  findSavedAvatarByOwnerEmail,
  loadSavedAvatars,
  persistSavedAvatar,
} from "./avatarStorage";
import type { SaveAvatarRequest } from "./types";

beforeEach(() => {
  window.localStorage.clear();
});

function req(overrides: Partial<SaveAvatarRequest> = {}): SaveAvatarRequest {
  return {
    avatar: {
      avatarId: "avatar-1",
      previewUrl: "preview.png",
      confidence: 0.9,
      seed: "seed-1",
      generatedAt: new Date().toISOString(),
    },
    outfitId: "hoodie",
    employeeName: "Test Employee",
    nickname: "Testy",
    roomId: "design-team",
    ...overrides,
  };
}

describe("persistSavedAvatar — ownerEmail", () => {
  it("stamps ownerEmail onto the persisted record when provided", () => {
    const saved = persistSavedAvatar(req({ ownerEmail: "micah@offshorly.com" }));
    expect(saved.ownerEmail).toBe("micah@offshorly.com");

    const stored = loadSavedAvatars();
    expect(stored).toHaveLength(1);
    expect(stored[0].ownerEmail).toBe("micah@offshorly.com");
  });

  it("omits ownerEmail (stays undefined) when no owner is provided — colleague-on-behalf-of case", () => {
    const saved = persistSavedAvatar(req());
    expect(saved.ownerEmail).toBeUndefined();
  });
});

describe("findSavedAvatarByOwnerEmail", () => {
  it("finds a previously saved avatar by owner email, round-tripped through localStorage", () => {
    persistSavedAvatar(req({ ownerEmail: "micah@offshorly.com", avatar: { ...req().avatar, avatarId: "a1" } }));
    persistSavedAvatar(req({ ownerEmail: "lui@offshorly.com", avatar: { ...req().avatar, avatarId: "a2" } }));

    const found = findSavedAvatarByOwnerEmail("micah@offshorly.com");
    expect(found?.avatarId).toBe("a1");
  });

  it("matches case-/whitespace-insensitively", () => {
    persistSavedAvatar(req({ ownerEmail: "micah@offshorly.com" }));
    expect(findSavedAvatarByOwnerEmail("  MICAH@Offshorly.com  ")?.ownerEmail).toBe(
      "micah@offshorly.com",
    );
  });

  it("returns null when nobody with that ownerEmail has saved an avatar", () => {
    persistSavedAvatar(req({ ownerEmail: "micah@offshorly.com" }));
    expect(findSavedAvatarByOwnerEmail("nobody@offshorly.com")).toBeNull();
  });

  it("returns null for null/undefined/empty input", () => {
    expect(findSavedAvatarByOwnerEmail(null)).toBeNull();
    expect(findSavedAvatarByOwnerEmail(undefined)).toBeNull();
    expect(findSavedAvatarByOwnerEmail("")).toBeNull();
  });

  it("ignores legacy records saved before ownerEmail existed", () => {
    persistSavedAvatar(req()); // no ownerEmail
    expect(findSavedAvatarByOwnerEmail("test@offshorly.com")).toBeNull();
  });
});
