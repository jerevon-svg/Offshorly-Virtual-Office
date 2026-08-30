import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WalkDirection } from "../../data/bonWalkFrames";

const emitted: { facing: string }[] = [];
vi.mock("../../services/presence/movementSync", () => ({
  emitWalkStarted: () => {},
  emitWalkArrived: (p: { facing: string }) => { emitted.push(p); },
}));

const { makeMoveSelf } = await import("./useSelfMovement");

// Reproduces the facing-reset defect and pins the fix.
//
// useCharacterWalk tracks the last non-zero segment direction in a ref that is
// updated DURING the walk. Arrival facing is resolved inside onArrive, which
// fires from the walk's rAF loop AFTER moveSelf's closures were captured, so
// reading the render-scoped `direction` state there returned the PRE-walk
// facing — the character snapped back to whichever way they faced before
// walking (commonly "right"). The fix passes a live accessor instead.
function harness(startFacing: WalkDirection, endFacing: WalkDirection) {
  const live = { current: startFacing };          // stands in for dirRef
  const stale = startFacing;                      // stands in for `direction` state
  const faced: WalkDirection[] = [];
  const moveSelf = makeMoveSelf({
    walkTo: (_path, onArrive) => { live.current = endFacing; onArrive?.(); },
    getPos: () => ({ x: 0, y: 0 }),
    getDirection: () => live.current,
    face: (d) => { faced.push(d); live.current = d; },
  });
  return { moveSelf, faced, live, stale };
}
const GO = { path: [{ x: 400, y: 400 }], roomId: null };

beforeEach(() => { emitted.length = 0; });

describe("facing after a walk", () => {
  for (const dir of ["left", "right", "front", "back"] as WalkDirection[]) {
    it(`walking ${dir} stops facing ${dir}`, () => {
      const h = harness("right", dir);
      h.moveSelf(GO);
      expect(h.live.current).toBe(dir);
      expect(h.faced.at(-1)).toBe(dir);
    });
  }

  it("walking then stopping does not reset to the pre-walk facing", () => {
    const h = harness("right", "left");
    h.moveSelf(GO);
    expect(h.live.current).toBe("left");
    expect(h.faced).not.toContain("right");
  });

  it("would have snapped back if arrival read the stale render-scoped direction", () => {
    // guards the actual regression: a getDirection() that closes over the
    // pre-walk value reintroduces the bug
    const live = { current: "right" as WalkDirection };
    const faced: WalkDirection[] = [];
    const moveSelf = makeMoveSelf({
      walkTo: (_p, onArrive) => { live.current = "left"; onArrive?.(); },
      getPos: () => ({ x: 0, y: 0 }),
      getDirection: () => "right",           // stale closure (the old behaviour)
      face: (d) => { faced.push(d); live.current = d; },
    });
    moveSelf(GO);
    expect(faced.at(-1)).toBe("right");      // <- the defect, reproduced
  });

  it("broadcasts to peers the exact facing it applied locally", () => {
    const h = harness("right", "back");
    h.moveSelf(GO);
    expect(emitted.at(-1)?.facing).toBe("back");
    expect(h.faced.at(-1)).toBe(emitted.at(-1)?.facing);
  });

  it("an explicit seat arrival facing overrides the final walk segment", () => {
    const h = harness("right", "left");
    h.moveSelf({ ...GO, arrival: { facing: "back", state: "sitting", seatKey: "s1" } });
    expect(h.faced.at(-1)).toBe("back");
    expect(emitted.at(-1)?.facing).toBe("back");
  });

  it("an explicit spatial-conversation facing overrides the final walk segment", () => {
    const h = harness("front", "left");
    h.moveSelf({ ...GO, arrival: { facing: "right", state: "standing" } });
    expect(h.faced.at(-1)).toBe("right");
    expect(emitted.at(-1)?.facing).toBe("right");
  });

  it("with no explicit facing and no movement, nothing is broadcast or re-faced", () => {
    const h = harness("front", "front");
    h.moveSelf({ path: [], roomId: null });
    expect(emitted).toHaveLength(0);
    expect(h.faced).toHaveLength(0);
    expect(h.live.current).toBe("front");    // default facing survives untouched
  });
});
