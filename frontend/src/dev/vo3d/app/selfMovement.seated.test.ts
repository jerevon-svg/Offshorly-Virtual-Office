// Phase 6C — how a V2 sit becomes a V1 sitting arrival, and how nothing the chair does afterwards leaks
// onto the wire until the body stands up.
//
// Pure and clock-free like selfMovement.test.ts: the feed is driven frame by frame and the sink's calls
// are asserted. The anchor id is opaque here — what V1 is told about it is adapters/v1SelfMovement's job.
import { describe, expect, it } from "vitest";
import { SelfMovementFeed, type Vo3dSelfMovementSink } from "./selfMovement";
import { FACING_YAW, type Facing, type Vec2 } from "../core/coords";

type Call =
  | { call: "started"; origin: Vec2; path: Vec2[]; durationMs: number; pacing?: string }
  | { call: "arrived"; at: Vec2; facing: Facing; yaw: number; seat?: string };

function recorder(): { sink: Vo3dSelfMovementSink; calls: Call[] } {
  const calls: Call[] = [];
  const sink: Vo3dSelfMovementSink = {
    state: { started: 0, arrived: 0, refused: 0, wire: [] },
    started: (origin, path, durationMs, pacing) => { calls.push({ call: "started", origin, path: [...path], durationMs, ...(pacing ? { pacing } : {}) }); },
    arrived: (at, facing, yaw, seat) => { calls.push({ call: "arrived", at, facing, yaw, ...(seat ? { seat } : {}) }); },
  };
  return { sink, calls };
}

/** Walk in 16 ms frames along a straight line, as an interaction stepping the body itself does. */
function drive(feed: SelfMovementFeed, from: Vec2, dx: number, dz: number, ms: number, speed: number, yaw = 0): Vec2 {
  let pos = { ...from };
  for (let t = 0; t < ms; t += 16) {
    const step = (speed * 16) / 1000;
    pos = { x: pos.x + dx * step, z: pos.z + dz * step };
    feed.frame(16, pos, yaw, false);
  }
  return pos;
}
/** Hold still for `ms`. */
function still(feed: SelfMovementFeed, pos: Vec2, ms: number, yaw = 0): void {
  for (let t = 0; t < ms; t += 16) feed.frame(16, pos, yaw, false);
}

const CHAIR = "dev-room/bay-chair-n1";

describe("approaching a chair", () => {
  it("publishes the walk up to the chair as ordinary free legs — no invisible movement", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.frame(16, { x: 0, z: 0 }, 0, false);
    // SeatInteraction.walkStep drives the body at the walk speed toward the approach cell: the feed sees
    // free movement and closes it into legs.
    drive(feed, { x: 0, z: 0 }, 1, 0, 1200, 30);
    const starts = calls.filter((c) => c.call === "started");
    expect(starts.length).toBeGreaterThanOrEqual(2);
    for (const s of starts) expect(s.pacing).toBe("linear");
  });
});

describe("sitting down", () => {
  it("resolves the leg that brought the body to the chair AS the seated arrival, then holds", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.frame(16, { x: 0, z: 0 }, 0, false);
    const end = drive(feed, { x: 0, z: 0 }, 1, 0, 300, 30); // a leg in progress (under LEG_MS)
    feed.seated(end, FACING_YAW.south, CHAIR);
    // The accumulating leg is closed and published...
    const starts = calls.filter((c) => c.call === "started");
    expect(starts).toHaveLength(1);
    expect(starts[0].origin).toEqual({ x: 0, z: 0 });
    // ...and its arrival is held back for the replay, exactly as a leg's always is.
    expect(calls.filter((c) => c.call === "arrived")).toHaveLength(0);
    still(feed, end, starts[0].durationMs + 32);
    const arrived = calls.filter((c) => c.call === "arrived") as Extract<Call, { call: "arrived" }>[];
    expect(arrived).toHaveLength(1);
    expect(arrived[0].seat).toBe(CHAIR);
    expect(arrived[0].facing).toBe("south");
    expect(arrived[0].yaw).toBe(FACING_YAW.south);
    expect(feed.isSeated).toBe(true);
  });

  it("re-points an arrival already held for the previous leg at the seat", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.frame(16, { x: 0, z: 0 }, 0, false);
    const end = drive(feed, { x: 0, z: 0 }, 1, 0, 200, 30);
    still(feed, end, 130); // the body settled: leg closed, arrival pending
    expect(calls.map((c) => c.call)).toEqual(["started"]);
    feed.seated({ x: end.x + 1, z: end.z }, FACING_YAW.north, CHAIR);
    still(feed, end, 400);
    const arrived = calls.filter((c) => c.call === "arrived") as Extract<Call, { call: "arrived" }>[];
    expect(arrived).toHaveLength(1);
    expect(arrived[0].seat).toBe(CHAIR);
    expect(arrived[0].at).toEqual({ x: end.x + 1, z: end.z });
    expect(calls.filter((c) => c.call === "started")).toHaveLength(1); // no second movement invented
  });

  it("with nothing in flight publishes one minimum-duration movement resolved seated at once", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.frame(16, { x: 50, z: 50 }, 0, false);
    feed.seated({ x: 50, z: 50 }, FACING_YAW.east, CHAIR);
    expect(calls).toEqual([
      { call: "started", origin: { x: 50, z: 50 }, path: [{ x: 50, z: 50 }], durationMs: 100 },
      { call: "arrived", at: { x: 50, z: 50 }, facing: "east", yaw: FACING_YAW.east, seat: CHAIR },
    ]);
  });

  it("publishes NOTHING while seated — the chair tucking in and the seated clip are not movements", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.frame(16, { x: 50, z: 50 }, 0, false);
    feed.seated({ x: 50, z: 50 }, FACING_YAW.south, CHAIR);
    const before = calls.length;
    // The chair slides the attached body 7 units over 760 ms, then it sits for a while.
    drive(feed, { x: 50, z: 50 }, 0, -1, 760, 9.2);
    still(feed, { x: 50, z: 43 }, 3000);
    expect(calls.length).toBe(before);
    expect(feed.isSeated).toBe(true);
  });

  it("is idempotent: a second seated() while seated changes nothing", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.frame(16, { x: 50, z: 50 }, 0, false);
    feed.seated({ x: 50, z: 50 }, 0, CHAIR);
    const n = calls.length;
    feed.seated({ x: 50, z: 50 }, 0, CHAIR);
    expect(calls.length).toBe(n);
  });

  it("resolves a PLANNED walk that ended in a chair as the seated arrival", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.planned({ x: 0, z: 0 }, [{ x: 100, z: 0 }], 1428);
    feed.frame(16, { x: 60, z: 0 }, FACING_YAW.east, true);
    feed.seated({ x: 100, z: 0 }, FACING_YAW.west, CHAIR);
    expect(calls).toEqual([
      { call: "started", origin: { x: 0, z: 0 }, path: [{ x: 100, z: 0 }], durationMs: 1428 },
      { call: "arrived", at: { x: 100, z: 0 }, facing: "west", yaw: FACING_YAW.west, seat: CHAIR },
    ]);
  });
});

describe("turning in the chair (a facing edit while seated)", () => {
  it("republishes the same seat as one snap movement with the new yaw, and stays seated", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.frame(16, { x: 50, z: 50 }, 0, false);
    feed.seated({ x: 50, z: 50 }, FACING_YAW.south, CHAIR);
    const n = calls.length;
    feed.reseated({ x: 50, z: 50 }, FACING_YAW.west, CHAIR);
    expect(calls.slice(n)).toEqual([
      { call: "started", origin: { x: 50, z: 50 }, path: [{ x: 50, z: 50 }], durationMs: 100 },
      { call: "arrived", at: { x: 50, z: 50 }, facing: "west", yaw: FACING_YAW.west, seat: CHAIR },
    ]);
    expect(feed.isSeated).toBe(true);
    still(feed, { x: 50, z: 50 }, 500);
    expect(calls.length).toBe(n + 2);
  });

  it("is a no-op while not seated", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.frame(16, { x: 0, z: 0 }, 0, false);
    feed.reseated({ x: 0, z: 0 }, 0, CHAIR);
    expect(calls).toEqual([]);
  });
});

describe("standing up", () => {
  it("ends the hold; the roll-out, the stand and the walk away publish as ordinary legs, standing", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.frame(16, { x: 50, z: 50 }, 0, false);
    feed.seated({ x: 50, z: 50 }, FACING_YAW.south, CHAIR);
    const n = calls.length;
    feed.stood({ x: 50, z: 50 }, FACING_YAW.south);
    expect(feed.isSeated).toBe(false);
    // the roll-out and stand-up glide, then a walk away
    const end = drive(feed, { x: 50, z: 50 }, 0, 1, 900, 30);
    still(feed, end, 200);
    const after = calls.slice(n);
    expect(after[0].call).toBe("started");
    expect((after[0] as Extract<Call, { call: "started" }>).origin).toEqual({ x: 50, z: 50 });
    const arrivals = after.filter((c) => c.call === "arrived") as Extract<Call, { call: "arrived" }>[];
    expect(arrivals.length).toBeGreaterThan(0);
    for (const a of arrivals) expect(a.seat).toBeUndefined();
  });

  it("is a no-op while not seated", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.frame(16, { x: 0, z: 0 }, 0, false);
    feed.stood({ x: 0, z: 0 }, 0);
    expect(calls).toEqual([]);
  });
});

describe("interruptions and teardown while seated", () => {
  it("dispose() while seated publishes NO standing arrival — V1 keeps the seat for the reload", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.frame(16, { x: 50, z: 50 }, 0, false);
    feed.seated({ x: 50, z: 50 }, 0, CHAIR);
    const n = calls.length;
    feed.dispose();
    expect(calls.length).toBe(n);
  });

  it("dispose() flushes a seated arrival still held for its leg, so it is never lost", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.frame(16, { x: 0, z: 0 }, 0, false);
    const end = drive(feed, { x: 0, z: 0 }, 1, 0, 300, 30);
    feed.seated(end, 0, CHAIR);
    expect(calls.filter((c) => c.call === "arrived")).toHaveLength(0);
    feed.dispose();
    const arrived = calls.filter((c) => c.call === "arrived") as Extract<Call, { call: "arrived" }>[];
    expect(arrived).toHaveLength(1);
    expect(arrived[0].seat).toBe(CHAIR);
  });

  it("interrupt() while seated does not stand the body up on the wire", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.frame(16, { x: 50, z: 50 }, 0, false);
    feed.seated({ x: 50, z: 50 }, 0, CHAIR);
    const n = calls.length;
    feed.interrupt({ x: 50, z: 50 }, 0);
    expect(calls.length).toBe(n);
    expect(feed.isSeated).toBe(true);
  });

  it("a seated RESTORE is a silent placement into the hold; the first thing published is the stand", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.placed({ x: 50, z: 50 }, true);
    still(feed, { x: 50, z: 50 }, 500);
    expect(calls).toEqual([]);
    expect(feed.isSeated).toBe(true);
    feed.stood({ x: 50, z: 50 }, 0);
    const end = drive(feed, { x: 50, z: 50 }, 1, 0, 500, 30);
    still(feed, end, 200);
    expect(calls[0].call).toBe("started");
  });

  it("Phase 6A/6B regression: a plain walk with no seat still publishes start/arrive with the exact yaw", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.planned({ x: 0, z: 0 }, [{ x: 100, z: 0 }], 1428);
    feed.frame(16, { x: 100, z: 0 }, 0.4, false);
    expect(calls).toEqual([
      { call: "started", origin: { x: 0, z: 0 }, path: [{ x: 100, z: 0 }], durationMs: 1428 },
      { call: "arrived", at: { x: 100, z: 0 }, facing: "south", yaw: 0.4 },
    ]);
  });
});
