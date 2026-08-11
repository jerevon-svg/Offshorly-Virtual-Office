import { describe, expect, it } from "vitest";
import { manilaHourDecimal, phaseForHour } from "./officePhase";

describe("phaseForHour", () => {
  it.each([
    [5.99, "night"],
    [6, "morning"],
    [9.99, "morning"],
    [10, "day"],
    [16.99, "day"],
    [17, "sunset"],
    [18.99, "sunset"],
    [19, "night"],
    [23.99, "night"],
    [0, "night"],
  ] as const)("phaseForHour(%f) === %s", (hour, expected) => {
    expect(phaseForHour(hour)).toBe(expected);
  });
});

describe("manilaHourDecimal", () => {
  it("returns a number in [0, 24)", () => {
    const h = manilaHourDecimal();
    expect(typeof h).toBe("number");
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(24);
  });
});
