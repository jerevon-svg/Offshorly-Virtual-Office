import { describe, expect, it } from "vitest";
import { MAX_ANISOTROPY_CAP, growSurface } from "./SharedRenderer";

describe("SharedRenderer grow-only surface (quality pass 2026-08-29)", () => {
  it("grows to fit the largest requested render and never shrinks back for a smaller one", () => {
    let s = growSurface({ width: 0, height: 0 }, 210, 298);
    expect(s).toEqual({ width: 210, height: 298, grew: true });
    s = growSurface(s, 160, 276); // alex, smaller: no reallocation
    expect(s.grew).toBe(false);
    expect([s.width, s.height]).toEqual([210, 298]);
    s = growSurface(s, 315, 447); // bon at 1.5x zoom bucket
    expect(s).toEqual({ width: 315, height: 447, grew: true });
    s = growSurface(s, 210, 298);
    expect(s.grew).toBe(false);
  });

  it("caps anisotropy at a safe level", () => {
    expect(MAX_ANISOTROPY_CAP).toBe(8);
  });
});
