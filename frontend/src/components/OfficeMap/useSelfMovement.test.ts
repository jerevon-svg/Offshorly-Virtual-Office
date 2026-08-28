import { describe, expect, it, vi } from "vitest";
import { makeMoveSelf } from "./useSelfMovement";
import * as movementSync from "../../services/presence/movementSync";

vi.mock("../../services/presence/movementSync", async () => {
  const actual = await vi.importActual<typeof import("../../services/presence/movementSync")>(
    "../../services/presence/movementSync",
  );
  return {
    ...actual,
    emitWalkStarted: vi.fn(),
    emitWalkArrived: vi.fn(),
  };
});

describe("useSelfMovement / moveSelf", () => {
  it("emits walk_started with movementId/durationMs/roomId, runs walkTo with the same durationMs, then emits walk_arrived", () => {
    let pos = { x: 0, y: 0 };
    const direction: { current: "front" | "back" | "left" | "right" } = { current: "front" };
    const walkTo = vi.fn((_input, onArrive, _opts) => {
      pos = { x: 10, y: 0 };
      onArrive?.();
    });
    const moveSelf = makeMoveSelf({
      walkTo,
      getPos: () => pos,
      getDirection: () => direction.current,
    });

    const onArrive = vi.fn();
    moveSelf({ path: [{ x: 10, y: 0 }], roomId: "r1", onArrive });

    expect(movementSync.emitWalkStarted).toHaveBeenCalledTimes(1);
    const startedArg = (movementSync.emitWalkStarted as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(startedArg.roomId).toBe("r1");
    expect(startedArg.origin).toEqual({ x: 0, y: 0 });
    expect(startedArg.path).toEqual([{ x: 10, y: 0 }]);
    expect(typeof startedArg.movementId).toBe("string");
    expect(startedArg.durationMs).toBeGreaterThan(0);

    expect(walkTo).toHaveBeenCalledTimes(1);
    const walkToOpts = walkTo.mock.calls[0][2];
    expect(walkToOpts.durationMs).toBe(startedArg.durationMs);

    expect(movementSync.emitWalkArrived).toHaveBeenCalledTimes(1);
    const arrivedArg = (movementSync.emitWalkArrived as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arrivedArg.movementId).toBe(startedArg.movementId);
    expect(arrivedArg.at).toEqual({ x: 10, y: 0 });
    expect(arrivedArg.facing).toBe("front");
    expect(arrivedArg.state).toBe("standing");
    expect(arrivedArg.seatKey).toBeNull();

    expect(onArrive).toHaveBeenCalledTimes(1);
  });

  it("rounds a fractional walkDurationMs to an integer for BOTH the emitted payload and the local walkTo opts (backend requires an int; a dropped float silently strands the walk for peers)", () => {
    const pos = { x: 0, y: 0 };
    const walkTo = vi.fn((_input, onArrive, _opts) => onArrive?.());
    const moveSelf = makeMoveSelf({ walkTo, getPos: () => pos, getDirection: () => "front" });

    // 300.7 * 3.4 = 1022.38 — fractional, and safely inside the
    // [500, 3500] clamp useCharacterWalk's walkDurationMs already applies,
    // so this exercises the rounding path specifically, not the clamp.
    moveSelf({ path: [{ x: 300.7, y: 0 }], roomId: null });

    const startedArg = (movementSync.emitWalkStarted as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];
    expect(Number.isInteger(startedArg.durationMs)).toBe(true);
    expect(startedArg.durationMs).toBe(1022);

    const walkToOpts = walkTo.mock.calls.at(-1)![2];
    expect(walkToOpts.durationMs).toBe(startedArg.durationMs);
  });

  it("sitting arrival carries seatKey and explicit facing", () => {
    const pos = { x: 0, y: 0 };
    const walkTo = vi.fn((_input, onArrive) => onArrive?.());
    const moveSelf = makeMoveSelf({ walkTo, getPos: () => pos, getDirection: () => "front" });

    moveSelf({
      path: [{ x: 5, y: 5 }],
      roomId: "r2",
      arrival: { state: "sitting", seatKey: "seat-42", facing: "back" },
    });

    const arrivedArg = (movementSync.emitWalkArrived as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];
    expect(arrivedArg.state).toBe("sitting");
    expect(arrivedArg.seatKey).toBe("seat-42");
    expect(arrivedArg.facing).toBe("back");
  });

  it("zero-length path: skips both emits and calls onArrive directly", () => {
    vi.mocked(movementSync.emitWalkStarted).mockClear();
    vi.mocked(movementSync.emitWalkArrived).mockClear();
    const pos = { x: 3, y: 3 };
    const walkTo = vi.fn();
    const moveSelf = makeMoveSelf({ walkTo, getPos: () => pos, getDirection: () => "front" });
    const onArrive = vi.fn();

    moveSelf({ path: [], roomId: null, onArrive });
    expect(movementSync.emitWalkStarted).not.toHaveBeenCalled();
    expect(movementSync.emitWalkArrived).not.toHaveBeenCalled();
    expect(walkTo).not.toHaveBeenCalled();
    expect(onArrive).toHaveBeenCalledTimes(1);

    // Also zero-length when the single path point equals the current pos
    // (walkDurationMs computes 0 distance).
    moveSelf({ path: [{ x: 3, y: 3 }], roomId: null, onArrive });
    expect(movementSync.emitWalkStarted).not.toHaveBeenCalled();
    expect(onArrive).toHaveBeenCalledTimes(2);
  });
});
