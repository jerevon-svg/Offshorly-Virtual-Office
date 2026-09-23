import { beforeEach, describe, expect, it } from "vitest";
import { applyExperienceTheme, clearExperienceTheme, currentExperienceTheme } from "./experienceTheme";

const ATTR = "data-vo-experience";

beforeEach(() => {
  document.documentElement.removeAttribute(ATTR);
});

// The UI skin (styles/halloweenTheme.css) is scoped entirely to this attribute, so these cases are
// the whole activation and teardown contract: what the attribute says is what the interface wears.

describe("which experiences dress the interface", () => {
  it("leaves the ordinary 3D office and Classic completely unstyled", () => {
    applyExperienceTheme("v2");
    expect(currentExperienceTheme()).toBeNull();
    applyExperienceTheme("classic");
    expect(currentExperienceTheme()).toBeNull();
    // Not "reset back to default" — the attribute is never set, so no rule in the skin ever matches.
    expect(document.documentElement.hasAttribute(ATTR)).toBe(false);
  });

  it("dresses the interface for Halloween", () => {
    applyExperienceTheme("halloween");
    expect(currentExperienceTheme()).toBe("halloween");
  });

  it("leaves a season with no decoration layer unstyled", () => {
    // Christmas is a known identifier with no implementation; a half-themed UI over an undecorated
    // world would be worse than neither.
    applyExperienceTheme("christmas");
    expect(currentExperienceTheme()).toBe("christmas");
  });

  it("treats no experience at all as unstyled", () => {
    applyExperienceTheme(null);
    expect(currentExperienceTheme()).toBeNull();
  });
});

describe("taking it off", () => {
  it("switching away restores the original UI with nothing left behind", () => {
    applyExperienceTheme("halloween");
    applyExperienceTheme("v2");
    expect(currentExperienceTheme()).toBeNull();
    expect(document.documentElement.hasAttribute(ATTR)).toBe(false);
  });

  it("clearing is idempotent and total", () => {
    applyExperienceTheme("halloween");
    clearExperienceTheme();
    clearExperienceTheme();
    expect(document.documentElement.hasAttribute(ATTR)).toBe(false);
  });

  it("is safe to apply the same experience repeatedly", () => {
    applyExperienceTheme("halloween");
    applyExperienceTheme("halloween");
    expect(currentExperienceTheme()).toBe("halloween");
  });
});
