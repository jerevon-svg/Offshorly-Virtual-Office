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

  it("PARKOUR V2: a vault or a mantle carries its duration and bounded heights, both ways; nothing else rides along", async () => {
    const { mod, handlers, emit } = await socket();
    const seen: unknown[] = [];
    mod.subscribePeerParkour((e) => seen.push(e));
    const fire = handlers.get("peer_parkour")!;
    fire({ email: "a@b.c", at: 20, kind: "vault", seq: 1, ms: 640, rise: 0, apex: 25, to: { x: 1 } });
    fire({ email: "a@b.c", at: 21, kind: "mantle", seq: 2, ms: 900, rise: 24, apex: 24 });
    fire({ email: "a@b.c", at: 22, kind: "mantle", seq: 3, ms: 900, rise: 400, apex: -1 });
    fire({ email: "a@b.c", at: 23, kind: "double", seq: 4, rise: 5, apex: 5 });
    expect(seen).toEqual([
      { email: "a@b.c", at: 20, kind: "vault", seq: 1, ms: 640, rise: 0, apex: 25 },
      { email: "a@b.c", at: 21, kind: "mantle", seq: 2, ms: 900, rise: 24, apex: 24 },
      { email: "a@b.c", at: 22, kind: "mantle", seq: 3, ms: 900 },
      { email: "a@b.c", at: 23, kind: "double", seq: 4 },
    ]);
    mod.emitParkour("vault", 10, 640, { rise: 0, apex: 25 });
    expect(emit.mock.calls.at(-1)).toEqual(["parkour", { kind: "vault", seq: 10, ms: 640, rise: 0, apex: 25 }]);
    mod.__resetForTests();
  });

  it("PARKOUR V3: a route relay carries the declared route, its way and how far along; a halt its end; a snapshot its traversal", async () => {
    const { mod, handlers, emit } = await socket();
    const seen: unknown[] = [];
    mod.subscribePeerParkour((e) => seen.push(e));
    const fire = handlers.get("peer_parkour")!;
    fire({ email: "a@b.c", at: 30, kind: "route", seq: 1, ms: 4078, route: "lab/zipline", dir: "a", p0: 0 });
    fire({ email: "a@b.c", at: 31, kind: "route", seq: 2, route: "lab/zipline" });               // no way: dropped
    fire({ email: "a@b.c", at: 32, kind: "route", seq: 3, route: "<script>", dir: "a" });        // not a route id: dropped
    fire({ email: "a@b.c", at: 33, kind: "halt", seq: 4, route: "lab/zipline", end: "exit" });
    expect(seen).toEqual([
      { email: "a@b.c", at: 30, kind: "route", seq: 1, ms: 4078, route: "lab/zipline", dir: "a", p0: 0 },
      { email: "a@b.c", at: 33, kind: "halt", seq: 4, route: "lab/zipline", end: "exit" },
    ]);
    mod.emitParkour("route", 9, 3587, undefined, { route: "lab/trunk-ladder", dir: "b", p0: 0.4 });
    expect(emit.mock.calls.at(-1)).toEqual(["parkour", { kind: "route", seq: 9, ms: 3587, route: "lab/trunk-ladder", dir: "b", p0: 0.4 }]);
    const m = applySnapshot(new Map(), {
      serverTime: 5,
      entries: [{ email: "a@x.com", revision: 3, pos: pt, facing: "front", state: "standing", seatKey: null, roomId: "ai-lab", updatedAt: 1, active: null, traversal: { route: "lab/zipline", dir: "a", p0: 0, at: 100, ms: 4078, seq: 2 } }],
    } as never);
    expect(m.get("a@x.com")!.traversal).toEqual({ route: "lab/zipline", dir: "a", p0: 0, at: 100, ms: 4078, seq: 2 });
    mod.__resetForTests();
  });
});
