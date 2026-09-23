import { describe, expect, it } from "vitest";
import { seasonForExperience } from "./season";
import { KNOWN_OFFICE_EXPERIENCES } from "../../../services/settings/officeExperience";

// PHASE 9A ships the seam and no decoration. These cases pin the mapping's SHAPE so the eventual
// decoration layer has something to be wired into, and pin the one safety rule: the ordinary office
// is the answer to every question this function cannot answer.

describe("which season an experience asks for", () => {
  it("is none for the two permanent offices", () => {
    expect(seasonForExperience("v2")).toBe("none");
    expect(seasonForExperience("classic")).toBe("none");
  });

  it("names the season for a seasonal experience", () => {
    expect(seasonForExperience("halloween")).toBe("halloween");
    expect(seasonForExperience("christmas")).toBe("christmas");
  });

  it("is none for nothing at all", () => {
    expect(seasonForExperience(null)).toBe("none");
    expect(seasonForExperience(undefined)).toBe("none");
  });

  it("answers for every identifier this build knows — no experience has an undefined season", () => {
    for (const experience of KNOWN_OFFICE_EXPERIENCES) {
      expect(["none", "halloween", "christmas"]).toContain(seasonForExperience(experience));
    }
  });
});
