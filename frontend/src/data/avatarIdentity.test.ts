import { describe, expect, it } from "vitest";
import { avatarIdForEmail, avatarIdForPerson, isKnownAvatarId } from "./avatarIdentity";

describe("avatarIdForEmail", () => {
  it("resolves a registry-mapped email (localpart differs from sprite id)", () => {
    expect(avatarIdForEmail("jerevon@offshorly.com")).toBe("bon");
    // Case/whitespace-insensitive, matching every other email-keyed lookup
    // in this app.
    expect(avatarIdForEmail("  JEREVON@Offshorly.com  ")).toBe("bon");

    // Lui's real Atlas login ("louiejie") also differs from his sprite id.
    expect(avatarIdForEmail("louiejie@offshorly.com")).toBe("lui");
  });

  it("resolves via the localpart convention when there's no explicit registry entry", () => {
    // micah/alex/lui/chris aren't in the registry override table — their
    // localpart already equals their sprite id, and that id is a real
    // character layer.
    expect(avatarIdForEmail("micah@offshorly.com")).toBe("micah");
    expect(avatarIdForEmail("alex@offshorly.com")).toBe("alex");
    expect(avatarIdForEmail("lui@offshorly.com")).toBe("lui");
    expect(avatarIdForEmail("chris@offshorly.com")).toBe("chris");
  });

  it("returns null (not 'bon') for an unmapped email with no matching localpart", () => {
    expect(avatarIdForEmail("brand-new-hire@offshorly.com")).toBeNull();
  });

  it("returns null for a localpart that collides with nothing real", () => {
    expect(isKnownAvatarId("brand-new-hire")).toBe(false);
    expect(avatarIdForEmail("brand-new-hire@offshorly.com")).toBeNull();
  });

  it("returns null (not the decorative stock character) when a localpart collides with a hardcoded office-decoration id", () => {
    // "nicole" is one of the 16 old Figma stock-art placeholder characters in
    // office-assets-manifest.json — decoration only, no animated sprite set.
    // A real Atlas employee named Nicole must fall through to null (the
    // faceless placeholder), not resolve to that decoration's flat PNG.
    expect(isKnownAvatarId("nicole")).toBe(false);
    expect(avatarIdForEmail("nicole@offshorly.com")).toBeNull();
  });

  it("returns null for null/undefined/empty input", () => {
    expect(avatarIdForEmail(null)).toBeNull();
    expect(avatarIdForEmail(undefined)).toBeNull();
    expect(avatarIdForEmail("")).toBeNull();
  });
});

describe("avatarIdForPerson", () => {
  it("resolves the same way for either the user_email or email field shape", () => {
    expect(avatarIdForPerson({ user_email: "jerevon@offshorly.com" })).toBe("bon");
    expect(avatarIdForPerson({ email: "jerevon@offshorly.com" })).toBe("bon");
    expect(avatarIdForPerson({ email: "unmapped-person@offshorly.com" })).toBeNull();
  });
});

// The `?as=<email>` mock-self path end to end: the email must resolve to an
// avatar id, that id must be a registry key, and the person must exist in the
// mock roster. Angelo is the case that needs all three — he ships a live-3D
// asset set but has no 2D AvatarSpriteSet, so he is known only via
// LIVE_3D_ONLY_AVATAR_IDS.
describe("mock self URLs (?as=<email>&deviceTier=T2)", () => {
  it("micah and angelo both resolve to a registered live-3D character", async () => {
    const { LIVE_3D_CHARACTERS } = await import("../render3d/live3dCharacters");
    const { MockOfficeService } = await import("../services/office/MockOfficeService");
    const roster = await new MockOfficeService().getFloor();

    for (const [email, id] of [
      ["micah@offshorly.com", "micah"],
      ["angelo@offshorly.com", "angelo"],
    ] as const) {
      expect(avatarIdForEmail(email)).toBe(id);
      expect(isKnownAvatarId(id)).toBe(true);
      expect(LIVE_3D_CHARACTERS[id]).toBeDefined();
      expect(roster.some((p) => p.user_email === email)).toBe(true);
    }
  });

  it("angelo skips avatar onboarding: he already has an assigned character", async () => {
    // OfficeMap's dev "Create your avatar" prompt fires only when the viewer
    // has NO assigned character. It used to ask "hasOwnSpriteSet", which is
    // false for angelo (3D shipped, sprite sheets not baked) — so it opened
    // the creator over his existing character and collapsed his player layer
    // to __no_character__. The gate is now "sprite set OR live-3D registered".
    const { SPRITE_SET_BY_AVATAR_ID } = await import("./bonWalkFrames");
    const { isLive3dEligible } = await import("../render3d/live3dCharacters");
    const id = avatarIdForEmail("angelo@offshorly.com");
    expect(id).toBe("angelo");
    expect(SPRITE_SET_BY_AVATAR_ID[id!]).toBeUndefined();  // the old gate said "new user"
    expect(isLive3dEligible(id!)).toBe(true);              // the new gate says "already has one"
  });

  it("angelo is returned by mock floor/presence with a valid deterministic placement", async () => {
    const { MockOfficeService } = await import("../services/office/MockOfficeService");
    const { mergeFloorWithPresence } = await import("../services/office/floorMerge");
    const { officePeopleToLayers } = await import("./rosterLayers");
    const svc = new MockOfficeService();
    const [floor, presence] = await Promise.all([svc.getFloor(), svc.getPresence()]);
    expect(floor.some((p) => p.user_email === "angelo@offshorly.com")).toBe(true);
    expect(presence.some((p) => p.user_email === "angelo@offshorly.com")).toBe(true);

    const people = mergeFloorWithPresence(floor, presence);
    const angelo = people.find((p) => p.email === "angelo@offshorly.com")!;
    expect(angelo.avatarId).toBe("angelo");
    expect(angelo.roomId).toBeTruthy();

    // exactly one layer, placed by the same seating convention as everyone else
    const layers = officePeopleToLayers(people);
    const his = layers.filter((l) => l.id.toLowerCase() === "angelo@offshorly.com");
    expect(his).toHaveLength(1);
    expect(Number.isFinite(his[0].x)).toBe(true);
    expect(Number.isFinite(his[0].y)).toBe(true);
    expect(his[0].path).toMatch(/angelo/);
  });

  it("angelo is served his gelo-v1 set and has no fabricated 2D sprite set", async () => {
    const { LIVE_3D_CHARACTERS } = await import("../render3d/live3dCharacters");
    const { SPRITE_SET_BY_AVATAR_ID } = await import("./bonWalkFrames");
    // `-hq-idle9` since the 2026-08-31 masculine-idle rebuild; matched loosely
    // on the chain name so a later variant folder doesn't break this test's
    // actual subject (identity -> asset mapping, not which build ships).
    const glbUrls = Object.entries(LIVE_3D_CHARACTERS.angelo)
      .filter(([key, value]) => typeof value === "string" && key.toLowerCase().endsWith("glburl"))
      .map(([, value]) => value as string);
    expect(glbUrls.length).toBeGreaterThan(0);
    for (const url of glbUrls) {
      expect(url).toMatch(/\/avatars\/gelo-v1(?:-[a-z0-9]+)*\/gelo-v1-lod\d\.glb$/);
    }
    // no invented sprite sheets — below the live-3D tier he falls back to the
    // shared faceless placeholder, exactly like any unmapped person.
    expect(SPRITE_SET_BY_AVATAR_ID.angelo).toBeUndefined();
  });
});
