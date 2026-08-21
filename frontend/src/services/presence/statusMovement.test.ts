import { describe, expect, it } from "vitest";
import { resolveManualStatusMovement } from "./statusMovement";
import type { OfficeStatus } from "./status";

const ALL_STATUSES: OfficeStatus[] = [
  "AVAILABLE",
  "BUSY",
  "AWAY",
  "BREAK",
  "LUNCH",
  "IN_CONVERSATION",
  "IN_CALL",
  "DND",
  "OFFLINE",
];

const HUB_STATUSES = new Set<OfficeStatus>(["BREAK", "LUNCH"]);

describe("resolveManualStatusMovement", () => {
  // Explicit matrix from the confirmed spec.
  it.each([
    ["BREAK", "LUNCH", null],
    ["LUNCH", "BREAK", null],
    ["LUNCH", "AVAILABLE", "DESK"],
    ["BREAK", "AVAILABLE", "DESK"],
    ["BREAK", "BUSY", null],
    ["BREAK", "DND", null],
    ["AVAILABLE", "BREAK", "HUB"],
    ["AVAILABLE", "LUNCH", "HUB"],
    ["DND", "BREAK", "HUB"],
    ["BUSY", "LUNCH", "HUB"],
    ["AVAILABLE", "BUSY", null],
    ["AVAILABLE", "DND", null],
    ["BUSY", "DND", null],
    ["DND", "AVAILABLE", null],
  ] as const)("%s -> %s => %s", (prev, next, expected) => {
    expect(resolveManualStatusMovement(prev, next)).toBe(expected);
  });

  // Same-status "transitions" (no-op guard belongs to the caller, but the
  // pure function itself should never suggest movement when nothing changed).
  it.each(ALL_STATUSES)("no movement when prev === next (%s)", (status) => {
    expect(resolveManualStatusMovement(status, status)).toBeNull();
  });

  // Full 9x9 matrix, derived independently from the spec's own rule
  // (entering a hub status from a non-hub status => HUB; leaving a hub
  // status straight to AVAILABLE => DESK; everything else => null) so this
  // acts as a from-first-principles cross-check against every reachable
  // pair, not just the spec's named examples above.
  for (const prev of ALL_STATUSES) {
    for (const next of ALL_STATUSES) {
      const wasInHub = HUB_STATUSES.has(prev);
      const isInHub = HUB_STATUSES.has(next);
      const expected = isInHub && !wasInHub ? "HUB" : next === "AVAILABLE" && wasInHub ? "DESK" : null;

      it(`matrix: ${prev} -> ${next} => ${expected}`, () => {
        expect(resolveManualStatusMovement(prev, next)).toBe(expected);
      });
    }
  }

  it("BREAK <-> LUNCH is always a no-op in both directions", () => {
    expect(resolveManualStatusMovement("BREAK", "LUNCH")).toBeNull();
    expect(resolveManualStatusMovement("LUNCH", "BREAK")).toBeNull();
  });

  it("Break/Lunch to Busy or DND never triggers movement", () => {
    expect(resolveManualStatusMovement("BREAK", "BUSY")).toBeNull();
    expect(resolveManualStatusMovement("BREAK", "DND")).toBeNull();
    expect(resolveManualStatusMovement("LUNCH", "BUSY")).toBeNull();
    expect(resolveManualStatusMovement("LUNCH", "DND")).toBeNull();
  });

  it("entering Break/Lunch from any auto/manual non-hub status triggers HUB", () => {
    for (const prev of ALL_STATUSES) {
      if (HUB_STATUSES.has(prev)) continue;
      expect(resolveManualStatusMovement(prev, "BREAK")).toBe("HUB");
      expect(resolveManualStatusMovement(prev, "LUNCH")).toBe("HUB");
    }
  });

  it("DND -> AVAILABLE is null (DND was never a hub stay)", () => {
    expect(resolveManualStatusMovement("DND", "AVAILABLE")).toBeNull();
  });
});
