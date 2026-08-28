import { describe, expect, it } from "vitest";
import { DND_POLICY, formatDurationShort } from "./dndPolicy";

describe("DND_POLICY", () => {
  it("every duration option is within the max session length", () => {
    for (const opt of DND_POLICY.durationOptions) {
      expect(opt.ms).toBeLessThanOrEqual(DND_POLICY.maxSessionMs);
    }
  });

  it("max session length does not exceed the daily allowance", () => {
    expect(DND_POLICY.maxSessionMs).toBeLessThanOrEqual(DND_POLICY.dailyAllowanceMs);
  });
});

describe("formatDurationShort", () => {
  it("formats whole hours", () => {
    expect(formatDurationShort(2 * 60 * 60_000)).toBe("2h");
  });

  it("formats whole minutes under an hour", () => {
    expect(formatDurationShort(30 * 60_000)).toBe("30m");
  });

  it("formats mixed hours and minutes", () => {
    expect(formatDurationShort(90 * 60_000)).toBe("1h 30m");
  });

  it("rounds down to 0m rather than going negative", () => {
    expect(formatDurationShort(-5000)).toBe("0m");
  });
});
