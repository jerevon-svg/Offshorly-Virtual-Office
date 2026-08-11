import { describe, expect, it } from "vitest";
import {
  FALLBACK_ROOM_ID,
  isEphemeralRoomType,
  isKnownRoomId,
  normalizeDepartmentKey,
  roomIdForDepartment,
} from "./roomIdentity";

// The eight department_name values actually present on ACTIVE employees.
// If Zoho gains or renames a department this suite is what fails first —
// which is the point: an unmapped department is invisible in the UI (the
// person just quietly appears in reception).
const LIVE_DEPARTMENTS = [
  "AI Team",
  "Dev",
  "Operations",
  "CMS",
  "Design",
  "Product Excellence Team",
  "Management",
  "External",
] as const;

describe("normalizeDepartmentKey", () => {
  it("lowercases and hyphenates", () => {
    expect(normalizeDepartmentKey("Product Excellence Team")).toBe(
      "product-excellence-team",
    );
  });

  it("treats underscores and runs of whitespace as separators", () => {
    expect(normalizeDepartmentKey("  DEV_TEAM  ")).toBe("dev-team");
  });

  it("drops punctuation that would never appear in a room id", () => {
    expect(normalizeDepartmentKey("R&D / Labs")).toBe("rd--labs");
  });
});

describe("roomIdForDepartment", () => {
  it.each([
    ["AI Team", "ai-room"],
    ["Dev", "dev-team"],
    ["CMS", "cms-team"],
    ["Design", "design-team"],
    ["Management", "executive-team"],
    ["Product Excellence Team", "qa-room"],
    ["Operations", "reception-room"],
  ])("maps %s to %s", (department, expected) => {
    expect(roomIdForDepartment(department)).toBe(expected);
  });

  it("leaves External unmapped so it takes the fallback", () => {
    // Contractors/client-side people aren't a department room; asserting
    // them into a team would be wrong, reception is the honest answer.
    expect(roomIdForDepartment("External")).toBeNull();
  });

  it("resolves every live department to a real room or null, never a bad id", () => {
    for (const department of LIVE_DEPARTMENTS) {
      const roomId = roomIdForDepartment(department);
      if (roomId !== null) expect(isKnownRoomId(roomId)).toBe(true);
    }
  });

  it("does not put the whole company in reception", () => {
    // The regression this suite exists for: before the table was filled in,
    // none of the real names slugified onto a room id and all 65 employees
    // landed in the fallback room.
    const mapped = LIVE_DEPARTMENTS.filter(
      (d) => roomIdForDepartment(d) !== null,
    );
    expect(mapped.length).toBeGreaterThanOrEqual(LIVE_DEPARTMENTS.length - 1);
  });

  it("still honours the slug convention for a future well-named department", () => {
    expect(roomIdForDepartment("Gaming Room")).toBe("gaming-room");
  });

  it("returns null for an unknown department and for no department", () => {
    expect(roomIdForDepartment("Accounts Payable")).toBeNull();
    expect(roomIdForDepartment(null)).toBeNull();
    expect(roomIdForDepartment("")).toBeNull();
  });
});

describe("FALLBACK_ROOM_ID", () => {
  it("is a real room, so unmapped people stay visible and clickable", () => {
    expect(isKnownRoomId(FALLBACK_ROOM_ID)).toBe(true);
  });
});

describe("isEphemeralRoomType", () => {
  it("treats project and channel rooms as ephemeral", () => {
    expect(isEphemeralRoomType("PROJECT")).toBe(true);
    expect(isEphemeralRoomType("CLIQ_CHANNEL")).toBe(true);
  });

  it("treats seeded rooms as stable", () => {
    expect(isEphemeralRoomType("TEAM")).toBe(false);
    expect(isEphemeralRoomType("CUSTOM")).toBe(false);
  });
});
