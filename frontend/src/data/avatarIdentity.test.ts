import { describe, expect, it } from "vitest";
import { avatarIdForEmail, avatarIdForPerson, isKnownAvatarId } from "./avatarIdentity";

describe("avatarIdForEmail", () => {
  it("resolves a registry-mapped email (localpart differs from sprite id)", () => {
    expect(avatarIdForEmail("jerevon@offshorly.com")).toBe("bon");
    // Case/whitespace-insensitive, matching every other email-keyed lookup
    // in this app.
    expect(avatarIdForEmail("  JEREVON@Offshorly.com  ")).toBe("bon");
  });

  it("resolves via the localpart convention when there's no explicit registry entry", () => {
    // micah/alex/lui aren't in the registry override table — their localpart
    // already equals their sprite id, and that id is a real character layer.
    expect(avatarIdForEmail("micah@offshorly.com")).toBe("micah");
    expect(avatarIdForEmail("alex@offshorly.com")).toBe("alex");
    expect(avatarIdForEmail("lui@offshorly.com")).toBe("lui");
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
