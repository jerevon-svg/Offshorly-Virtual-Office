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

  it("owner applies the explicit arrival facing locally (face) before broadcasting the identical facing to peers", () => {
    const pos = { x: 0, y: 0 };
    const order: string[] = [];
    const face = vi.fn((d: string) => order.push(`face:${d}`));
    (movementSync.emitWalkArrived as ReturnType<typeof vi.fn>).mockImplementationOnce((p: { facing: string }) =>
      order.push(`emit:${p.facing}`),
    );
    const walkTo = vi.fn((_input, onArrive) => onArrive?.());
    // Walking rightwards (last segment direction) but the spatial settle wants "left" (toward the anchor).
    const moveSelf = makeMoveSelf({ walkTo, getPos: () => pos, getDirection: () => "right", face });

    moveSelf({ path: [{ x: 40, y: 0 }], roomId: "r3", arrival: { state: "standing", facing: "left" } });

    expect(face).toHaveBeenCalledTimes(1);
    expect(face).toHaveBeenCalledWith("left");
    const arrivedArg = (movementSync.emitWalkArrived as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];
    expect(arrivedArg.facing).toBe("left");
    expect(order).toEqual(["face:left", "emit:left"]);
  });

  it("two-person settle: both owners face the shared anchor, so the broadcast facings are opposite (face-to-face) and each owner's local facing equals what peers receive", () => {
    // Mirrors OfficeMap's Mechanism-1 arrival facing: directionBetween(mySlotCenter, anchor).
    const anchor = { x: 500, y: 300 };
    const slotA = { x: 470, y: 300 }; // left of anchor -> faces right
    const slotB = { x: 530, y: 300 }; // right of anchor -> faces left
    const dir = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const dx = to.x - from.x, dy = to.y - from.y;
      return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "front" : "back";
    };
    const results: Record<string, { local: string; broadcast: string }> = {};
    for (const [who, slot] of [["a", slotA], ["b", slotB]] as const) {
      const face = vi.fn();
      const walkTo = vi.fn((_input, onArrive) => onArrive?.());
      const moveSelf = makeMoveSelf({ walkTo, getPos: () => ({ x: 0, y: 0 }), getDirection: () => "front", face });
      moveSelf({ path: [slot], roomId: "r", arrival: { state: "standing", facing: dir(slot, anchor) } });
      const arrivedArg = (movementSync.emitWalkArrived as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];
      results[who] = { local: face.mock.calls[0][0], broadcast: arrivedArg.facing };
    }
    expect(results.a).toEqual({ local: "right", broadcast: "right" });
    expect(results.b).toEqual({ local: "left", broadcast: "left" });
  });

  it("default facing (no explicit arrival.facing) is applied locally and broadcast identically", () => {
    const face = vi.fn();
    const walkTo = vi.fn((_input, onArrive) => onArrive?.());
    const moveSelf = makeMoveSelf({ walkTo, getPos: () => ({ x: 0, y: 0 }), getDirection: () => "back", face });
    moveSelf({ path: [{ x: 0, y: -20 }], roomId: null });
    expect(face).toHaveBeenCalledWith("back");
    expect((movementSync.emitWalkArrived as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0].facing).toBe("back");
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
