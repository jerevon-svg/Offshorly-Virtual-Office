import { describe, expect, it } from "vitest";
import { CHAIR_BACKREST_FRACTION, DEFAULT_BACKREST_FRACTION, getBackrestCropFraction } from "./chairBackrestCrop";

describe("getBackrestCropFraction", () => {
  it("returns the table entry for a known chair style", () => {
    expect(getBackrestCropFraction("assets/office/furniture/dev-team/dev-visitor-chair.png")).toBe(
      CHAIR_BACKREST_FRACTION["assets/office/furniture/dev-team/dev-visitor-chair.png"],
    );
  });

  it("returns every known style's fraction as a value strictly between 0 and 1", () => {
    for (const fraction of Object.values(CHAIR_BACKREST_FRACTION)) {
      expect(fraction).toBeGreaterThan(0);
      expect(fraction).toBeLessThan(1);
    }
  });

  it("falls back to DEFAULT_BACKREST_FRACTION for an unlisted chair style", () => {
    expect(getBackrestCropFraction("assets/office/furniture/some-room/unlisted-chair.png")).toBe(
      DEFAULT_BACKREST_FRACTION,
    );
  });
});
