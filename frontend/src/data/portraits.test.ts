import { describe, expect, it } from "vitest";
import { PORTRAIT_LOCALPARTS, portraitSrcFor, profileImageFor } from "./portraits";

describe("portraits", () => {
  it("maps only the clearly matched employees, case- and whitespace-insensitively", () => {
    expect(PORTRAIT_LOCALPARTS.slice().sort()).toEqual(["alex", "angelo", "jerevon", "lui", "micah"]);
    expect(portraitSrcFor("jerevon@offshorly.com")).toMatch(/portraits\/jerevon\.png$/);
    expect(portraitSrcFor("  MICAH@Offshorly.com ")).toMatch(/portraits\/micah\.png$/);
    // Not guessed: jan (only "Janna.png" exists), unknowns, empties.
    expect(portraitSrcFor("jan@offshorly.com")).toBeNull();
    expect(portraitSrcFor("nobody@offshorly.com")).toBeNull();
    expect(portraitSrcFor(null)).toBeNull();
    expect(portraitSrcFor("")).toBeNull();
  });

  it("profileImageFor falls back to the caller's existing image when there is no portrait", () => {
    expect(profileImageFor("alex@offshorly.com", () => "sprite.png")).toMatch(/portraits\/alex\.png$/);
    expect(profileImageFor("jan@offshorly.com", () => "sprite.png")).toBe("sprite.png");
  });
});
