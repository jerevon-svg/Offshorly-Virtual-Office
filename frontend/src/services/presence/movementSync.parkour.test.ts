import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyArrived, applySnapshot, applyStarted, type PeerMovementState } from "./movementSync";

// PARKOUR V1 — the movement store's two additions: the published FEET height (somebody standing on a furniture top)
// and the `peer_parkour` relay (double jump with its flip, landing roll with its duration). Both admitted only in
// the shape specified; anything else is simply absent, exactly as an older client's payload is.

const pt = { x: 10, y: 20 };
const started = (feet?: unknown) =>
  applyStarted(new Map(), { email: "A@x.com", movementId: "m1", revision: 1, origin: pt, path: [pt], roomId: null, durationMs: 400, startedAt: 1, ...(feet !== undefined ? { feet } : {}) } as never);
const arrived = (prev: Map<string, PeerMovementState>, feet?: unknown) =>
  applyArrived(prev, { email: "a@x.com", movementId: "m1", revision: 2, at: pt, facing: "front", state: "standing", seatKey: null, roomId: null, ...(feet !== undefined ? { feet } : {}) } as never);

describe("movementSync — feet", () => {
  it("carries a sane feet height on a walk and on an arrival", () => {
    const s = started(15.6);
    expect(s.get("a@x.com")!.active!.feet).toBe(15.6);
    expect(arrived(s, 15.6).get("a@x.com")!.stable.feet).toBe(15.6);
  });

  it("drops anything else — and an arrival without one clears it (back on the floor)", () => {
    for (const bad of [Number.NaN, -1, 0, 999, "15", true]) expect(started(bad).get("a@x.com")!.active!.feet).toBeUndefined();
    expect(arrived(started(15.6)).get("a@x.com")!.stable.feet).toBeUndefined();
  });

  it("arrives in a snapshot for a late joiner — stable and in flight", () => {
    const m = applySnapshot(new Map(), {
      serverTime: 5,
      entries: [{ email: "a@x.com", revision: 3, pos: pt, facing: "front", state: "standing", seatKey: null, roomId: null, updatedAt: 1, feet: 21, active: null }],
    } as never);
    expect(m.get("a@x.com")!.stable.feet).toBe(21);
  });
});

describe("movementSync — the parkour relay", () => {
  beforeEach(() => vi.resetModules());

  async function socket() {
    const handlers = new Map<string, (p?: unknown) => void>();
    const emit = vi.fn();
    vi.doMock("socket.io-client", () => ({ io: () => ({ on: (n: string, fn: (p?: unknown) => void) => handlers.set(n, fn), emit, disconnect: () => {} }) }));
    vi.doMock("../api/client", () => ({ getAuthToken: () => "t" }));
    const mod = await import("./movementSync");
    return { mod, handlers, emit };
  }

  it("validates peer_parkour: an allowed kind, a real server time; seq and a bounded roll duration pass through", async () => {
    const { mod, handlers } = await socket();
    const seen: unknown[] = [];
    mod.subscribePeerParkour((e) => seen.push(e));
    const fire = handlers.get("peer_parkour")!;
    fire({ email: "a@b.c", at: 1, kind: "triple" });
    fire({ email: "a@b.c", kind: "double" });
    fire({ email: "", at: 1, kind: "roll" });
    expect(seen).toEqual([]);
    fire({ email: "A@B.c", at: 9, kind: "double", seq: 4 });
    fire({ email: "a@b.c", at: 10, kind: "roll", seq: 5, ms: 880 });
    fire({ email: "a@b.c", at: 11, kind: "roll", seq: 6, ms: 99999 });
    expect(seen).toEqual([
      { email: "a@b.c", at: 9, kind: "double", seq: 4 },
      { email: "a@b.c", at: 10, kind: "roll", seq: 5, ms: 880 },
      { email: "a@b.c", at: 11, kind: "roll", seq: 6 },
    ]);
    mod.__resetForTests();
  });

  it("emits exactly the contract: a plain jump is still just 'jump'; actions carry kind, seq and a roll's ms", async () => {
    const { mod, emit } = await socket();
    mod.emitJump();
    mod.emitJump(7);
    mod.emitParkour("double", 8);
    mod.emitParkour("roll", 9, 860);
    expect(emit.mock.calls).toEqual([["jump"], ["jump", { seq: 7 }], ["parkour", { kind: "double", seq: 8 }], ["parkour", { kind: "roll", seq: 9, ms: 860 }]]);
    mod.emitWalkArrived({ movementId: "m", at: pt, facing: "front", state: "standing", seatKey: null, roomId: null, feet: 15.6 });
    expect(emit.mock.calls.at(-1)).toEqual(["walk_arrived", expect.objectContaining({ feet: 15.6 })]);
    mod.__resetForTests();
  });
});
