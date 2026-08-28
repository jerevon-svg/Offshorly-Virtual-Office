import { describe, expect, it } from "vitest";
// Vite `?raw` import — loads OfficeMap.tsx's own source text as a string, so
// this guard can regex-scan it without any Node fs/path builtins (keeps this
// test runnable under the same browser-like module resolution as the rest
// of the suite).
import officeMapSource from "./OfficeMap.tsx?raw";

// Source-level guard: every self-movement call site in OfficeMap.tsx must go
// through the single moveSelf funnel (see useSelfMovement.ts) — no bare
// `walkTo(`, `walkToRaw(`, or `emitAndWalkTo(` self-movement call may exist
// outside moveSelf's own implementation (the `function walkTo(...)` wrapper
// and its one `walkToRaw(...)` call), except the alex/micah/lui/saved-avatar
// NPC demo walkers (runWalkDemo), which are explicitly visual-only and use
// their OWN useCharacterWalk instances, never bon's self-movement pipeline.

// Exact trimmed line content allowed to contain a bare `walkTo(` call —
// the NPC "walk demo" action-menu item (runWalkDemo), which resolves
// `walkTo` to a LOCAL variable shadowing alex/micah/lui/savedAvatar's own
// dedicated useCharacterWalk hook instances, never bon's self-movement
// `walkTo` wrapper. See runWalkDemo's doc comment.
const ALLOWED_BARE_WALKTO_LINES = new Set(["walkTo([out, start]);"]);

describe("OfficeMap.tsx self-movement funnel guard", () => {
  const source = officeMapSource;
  const lines: string[] = source.split("\n");

  it("never calls the removed emitAndWalkTo helper", () => {
    expect(source).not.toContain("emitAndWalkTo(");
  });

  it("never calls walkToRaw outside the moveSelf-backing walkTo wrapper implementation", () => {
    const violations = lines.filter((line) => /\bwalkToRaw\(/.test(line) && !line.trim().startsWith("walkToRaw(input, onArrive, opts)"));
    expect(violations).toEqual([]);
  });

  it("has no bare self walkTo( calls outside the allowlisted NPC-demo line and the wrapper's own declaration", () => {
    const violations: string[] = [];
    for (const line of lines) {
      if (!/\bwalkTo\(/.test(line)) continue;
      const trimmed = line.trim();
      if (trimmed.startsWith("function walkTo(")) continue; // the wrapper's own declaration
      if (ALLOWED_BARE_WALKTO_LINES.has(trimmed)) continue; // NPC demo walker
      violations.push(trimmed);
    }
    expect(violations).toEqual([]);
  });

  it("every self-movement call site funnels through moveSelf( — sanity count is non-trivial", () => {
    const moveSelfCalls = lines.filter((line) => /\bmoveSelf\(/.test(line));
    // Right-click (2), walkToAssignedDepartment (4), walkOutOfRoomThenTo (3),
    // walkToSeat (2), walkToHub (1), approachCharacter (3), spatial settle
    // (1), Ask-to-Join joiner (1), lineup nudge (1), reception onboarding
    // walk (1) — comfortably more than 10 distinct call sites.
    expect(moveSelfCalls.length).toBeGreaterThanOrEqual(10);
  });
});
