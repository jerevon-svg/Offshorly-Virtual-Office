// Phase 5 — how V2's continuous movement becomes V1 movements.
//
// The feed is pure and clock-free by design (frame() is handed its own dt), so these drive it exactly as
// the render loop does and assert on the calls a sink would have received. Nothing here mocks a socket:
// what reaches V1 is adapters/v1SelfMovement's problem, and it has its own tests.
import { describe, expect, it } from "vitest";
import { plannedDurationMs, SelfMovementFeed, type Vo3dSelfMovementSink } from "./selfMovement";
import { FACING_YAW, facingForYaw, type Facing, type Vec2 } from "../core/coords";

type Call =
  | { call: "started"; origin: Vec2; path: Vec2[]; durationMs: number }
  | { call: "arrived"; at: Vec2; facing: Facing };

function recorder(): { sink: Vo3dSelfMovementSink; calls: Call[] } {
  const calls: Call[] = [];
  const sink: Vo3dSelfMovementSink = {
    state: { started: 0, arrived: 0, refused: 0, wire: [] },
    started: (origin, path, durationMs) => {
      sink.state.started++;
      calls.push({ call: "started", origin, path: [...path], durationMs });
    },
    arrived: (at, facing) => {
      sink.state.arrived++;
      calls.push({ call: "arrived", at, facing });
    },
  };
  return { sink, calls };
}

/** Walk the feed in 16 ms frames along a straight line at `speed` units/s, starting from `from`. */
function drive(feed: SelfMovementFeed, from: Vec2, dx: number, dz: number, ms: number, speed: number, yaw = 0): Vec2 {
  let pos = { ...from };
  for (let t = 0; t < ms; t += 16) {
    const step = (speed * 16) / 1000;
    pos = { x: pos.x + dx * step, z: pos.z + dz * step };
    feed.frame(16, pos, yaw, false);
  }
  return pos;
}

describe("plannedDurationMs", () => {
  it("is the time V2's own walker will really take, including the leg to the first waypoint", () => {
    // 70 units at 70 units/s is one second — NOT V1's walkDurationMs (which would clamp 70 × 3.4 up to
    // its 500 ms floor). The duration is a fact about this walk, not a rule to be reused.
    expect(plannedDurationMs({ x: 0, z: 0 }, [{ x: 30, z: 0 }, { x: 70, z: 0 }], 70)).toBeCloseTo(1000);
  });

  it("is zero for a path with no distance in it, which is what makes it unpublishable", () => {
    expect(plannedDurationMs({ x: 5, z: 5 }, [{ x: 5, z: 5 }], 70)).toBe(0);
  });
});

describe("facingForYaw", () => {
  it("is the exact inverse of FACING_YAW, so a facing V1 gave us round-trips back unchanged", () => {
    for (const f of ["north", "south", "east", "west"] as Facing[]) {
      expect(facingForYaw(FACING_YAW[f])).toBe(f);
    }
  });

  it("resolves an exact diagonal onto the north/south axis, like V1's own directionBetween", () => {
    expect(facingForYaw(Math.PI / 4)).toBe("south");
  });
});

describe("a planned walk (Office View click-to-walk)", () => {
  it("is announced up front, once, with the planner's own path", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    const path = [{ x: 100, z: 0 }, { x: 100, z: 100 }];
    feed.planned({ x: 0, z: 0 }, path, 2857);
    expect(calls).toEqual([{ call: "started", origin: { x: 0, z: 0 }, path, durationMs: 2857 }]);
  });

  it("resolves the moment the planner goes quiet, at the position the body actually reached", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.planned({ x: 0, z: 0 }, [{ x: 100, z: 0 }], 1428);
    feed.frame(16, { x: 40, z: 0 }, FACING_YAW.east, true); // still walking
    expect(calls).toHaveLength(1);
    feed.frame(16, { x: 100, z: 0 }, FACING_YAW.east, false); // waypoints consumed
    expect(calls[1]).toEqual({ call: "arrived", at: { x: 100, z: 0 }, facing: "east" });
  });

  it("resolves an INTERRUPTED walk where the body really stopped, not at the path's end", () => {
    // An interaction taking the avatar, or PLAYER mode taking over, leaves the planner empty mid-route.
    // Publishing the destination there would tell every peer this employee is somewhere they are not.
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.planned({ x: 0, z: 0 }, [{ x: 400, z: 0 }], 5714);
    feed.frame(16, { x: 90, z: 0 }, FACING_YAW.east, true);
    feed.frame(16, { x: 90, z: 0 }, FACING_YAW.east, false);
    expect(calls[1]).toEqual({ call: "arrived", at: { x: 90, z: 0 }, facing: "east" });
  });

  it("redirects exactly as V1 does: the new start supersedes, and no arrival is sent for the old walk", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.planned({ x: 0, z: 0 }, [{ x: 400, z: 0 }], 5714);
    feed.frame(16, { x: 90, z: 0 }, 0, true);
    feed.planned({ x: 90, z: 0 }, [{ x: 90, z: 300 }], 4285);
    expect(calls.map((c) => c.call)).toEqual(["started", "started"]);
  });

  it("publishes nothing at all for a zero-distance walk", () => {
    const { sink, calls } = recorder();
    new SelfMovementFeed(sink).planned({ x: 5, z: 5 }, [{ x: 5, z: 5 }], 0);
    expect(calls).toEqual([]);
  });
});

describe("free movement (PLAYER mode, and anything that walks the body itself)", () => {
  it("publishes nothing for the world's first frame — a spawn is a placement, not a movement", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.frame(16, { x: 600, z: 600 }, 0, false);
    feed.frame(16, { x: 600, z: 600 }, 0, false);
    expect(calls).toEqual([]);
  });

  it("closes a leg once the body has been still long enough, and publishes the route it took", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.frame(16, { x: 0, z: 0 }, FACING_YAW.south, false); // seeds `last`
    const end = drive(feed, { x: 0, z: 0 }, 0, 1, 320, 70, FACING_YAW.south);
    expect(calls).toEqual([]); // nothing yet: the leg is still open
    for (let t = 0; t < 160; t += 16) feed.frame(16, end, FACING_YAW.south, false);

    const started = calls[0];
    expect(started.call).toBe("started");
    if (started.call !== "started") throw new Error("unreachable");
    expect(started.origin).toEqual({ x: 0, z: 0 });
    expect(started.path[started.path.length - 1]).toEqual(end);
    // Intermediate waypoints were sampled: peers replay the route, not a straight jump to the end.
    expect(started.path.length).toBeGreaterThan(1);
    // The duration is the time the body was really moving, so a peer's replay runs at the real speed.
    expect(started.durationMs).toBeGreaterThanOrEqual(300);
    expect(started.durationMs).toBeLessThanOrEqual(340);
  });

  it("holds the arrival back until the replay would have finished, so peers see a walk not a snap", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.frame(16, { x: 0, z: 0 }, 0, false);
    const end = drive(feed, { x: 0, z: 0 }, 0, 1, 320, 70);
    for (let t = 0; t < 160; t += 16) feed.frame(16, end, 0, false);
    expect(calls.map((c) => c.call)).toEqual(["started"]);
    // ...and only after the leg's own duration has passed does the arrival go out.
    for (let t = 0; t < 400; t += 16) feed.frame(16, end, 0, false);
    expect(calls.map((c) => c.call)).toEqual(["started", "arrived"]);
    expect(calls[1]).toEqual({ call: "arrived", at: end, facing: "south" });
  });

  it("splits a continuous walk into legs, always started/arrived in strict pairs", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.frame(16, { x: 0, z: 0 }, 0, false);
    drive(feed, { x: 0, z: 0 }, 0, 1, 2400, 70); // four LEG_MS legs' worth of continuous walking
    // Four legs closed; the last one's arrival is still being held, so five calls have gone out.
    expect(calls.length).toBeGreaterThanOrEqual(5);
    // Never two starts in a row and never two arrivals in a row: a started that overtook its own
    // arrival would be rejected by the backend (wrong active movementId).
    for (let i = 1; i < calls.length; i++) expect(calls[i].call).not.toBe(calls[i - 1].call);
    expect(calls[0].call).toBe("started");
  });

  it("ignores sub-unit jitter rather than bumping a revision for numeric noise", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.frame(16, { x: 0, z: 0 }, 0, false);
    feed.frame(16, { x: 0.2, z: 0 }, 0, false);
    feed.frame(16, { x: 0.4, z: 0 }, 0, false);
    for (let t = 0; t < 200; t += 16) feed.frame(16, { x: 0.4, z: 0 }, 0, false);
    expect(calls).toEqual([]);
  });

  it("publishes a teleport as the snap it is, resolved immediately", () => {
    // A seat attaching the body, or the CAVE portal. A leg would claim the employee sprinted there.
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.frame(16, { x: 100, z: 100 }, 0, false);
    feed.frame(16, { x: 600, z: 400 }, FACING_YAW.north, false);
    expect(calls).toEqual([
      { call: "started", origin: { x: 100, z: 100 }, path: [{ x: 600, z: 400 }], durationMs: 100 },
      { call: "arrived", at: { x: 600, z: 400 }, facing: "north" },
    ]);
  });
});

describe("teardown", () => {
  it("publishes the leg still in flight, so the durable position is not left one leg stale", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.frame(16, { x: 0, z: 0 }, 0, false);
    const end = drive(feed, { x: 0, z: 0 }, 0, 1, 320, 70);
    expect(calls).toEqual([]);
    feed.dispose();
    expect(calls.map((c) => c.call)).toEqual(["started", "arrived"]);
    expect(calls[1]).toEqual({ call: "arrived", at: end, facing: "south" });
  });

  it("resolves a planned walk that was still running", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.planned({ x: 0, z: 0 }, [{ x: 400, z: 0 }], 5714);
    feed.frame(16, { x: 120, z: 0 }, FACING_YAW.east, true);
    feed.dispose();
    expect(calls[1]).toEqual({ call: "arrived", at: { x: 120, z: 0 }, facing: "east" });
  });

  it("is safe with nothing in flight, and emits nothing twice", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.dispose();
    feed.dispose();
    expect(calls).toEqual([]);
  });
});

describe("a placement is not a movement", () => {
  it("publishes nothing for the V1 position restore, and does not turn it into a leg", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.frame(16, { x: 100, z: 100 }, 0, false); // the desk preview, drawn for a frame or two
    feed.frame(16, { x: 100, z: 100 }, 0, false);
    feed.placed({ x: 600, z: 500 }); // ...then V1's own persisted position lands
    feed.frame(16, { x: 600, z: 500 }, 0, false);
    for (let t = 0; t < 200; t += 16) feed.frame(16, { x: 600, z: 500 }, 0, false);
    expect(calls).toEqual([]);
  });

  it("drops an accumulating leg rather than publishing one that spans the placement", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.frame(16, { x: 100, z: 100 }, 0, false);
    drive(feed, { x: 100, z: 100 }, 0, 1, 200, 70);
    feed.placed({ x: 600, z: 500 });
    for (let t = 0; t < 300; t += 16) feed.frame(16, { x: 600, z: 500 }, 0, false);
    expect(calls).toEqual([]);
  });

  it("still publishes real movement after a placement, from the placed position", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.placed({ x: 600, z: 500 });
    const end = drive(feed, { x: 600, z: 500 }, 0, 1, 320, 70);
    for (let t = 0; t < 200; t += 16) feed.frame(16, end, 0, false);
    const started = calls[0];
    if (started.call !== "started") throw new Error("expected a started call");
    expect(started.origin).toEqual({ x: 600, z: 500 });
  });
});

describe("the edge of V1's coordinate frame", () => {
  // V1 exists only inside its 1440 x 1244 frame. V2's campus legs, the AI Lab (negative z) and the CAVE
  // (x 2600) are all outside it, and these are the cases that used to leave peers stranded.
  const FRAME = { x: 0, z: 0, w: 1440, d: 1244 };
  const inFrame = (p: Vec2) => p.x >= 0 && p.x <= FRAME.w && p.z >= 0 && p.z <= FRAME.d;

  it("closes the leg at the LAST in-frame position when the body walks out", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink, inFrame);
    feed.frame(16, { x: 1400, z: 600 }, 0, false);
    // east, out through the frame edge at x 1440
    const last = drive(feed, { x: 1400, z: 600 }, 1, 0, 300, 70);
    expect(calls).toEqual([]);
    feed.frame(16, { x: 1460, z: 600 }, 0, false); // now outside
    const started = calls[0];
    if (started.call !== "started") throw new Error("expected a started call");
    // The published end is a real position the body really occupied, inside the frame — not the edge
    // (which it never stood on) and not the outside sample (which V1 cannot hold).
    expect(started.path[started.path.length - 1]).toEqual(last);
    expect(inFrame(started.path[started.path.length - 1])).toBe(true);
  });

  it("publishes nothing at all while the body is outside", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink, inFrame);
    feed.frame(16, { x: 1460, z: 600 }, 0, false);
    drive(feed, { x: 1460, z: 600 }, 0, -1, 2000, 70); // up the east leg toward the Lab
    for (let t = 0; t < 400; t += 16) feed.frame(16, { x: 1460, z: -800 }, 0, false);
    expect(calls).toEqual([]);
  });

  it("SNAPS on the way back in, then resumes real legs from there", () => {
    // This is the fix. The walk that brought them back happened where V1 has no coordinates, so the only
    // honest statement is "they are here now" — and then normal legs continue.
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink, inFrame);
    feed.frame(16, { x: 1460, z: 600 }, 0, false); // outside
    feed.frame(16, { x: 1460, z: 600 }, 0, false);
    feed.frame(16, { x: 1430, z: 600 }, FACING_YAW.west, false); // first in-frame sample
    expect(calls).toEqual([
      { call: "started", origin: { x: 1430, z: 600 }, path: [{ x: 1430, z: 600 }], durationMs: 100 },
      { call: "arrived", at: { x: 1430, z: 600 }, facing: "west" },
    ]);

    calls.length = 0;
    const end = drive(feed, { x: 1430, z: 600 }, -1, 0, 320, 70, FACING_YAW.west);
    for (let t = 0; t < 200; t += 16) feed.frame(16, end, FACING_YAW.west, false);
    const started = calls[0];
    if (started.call !== "started") throw new Error("expected a started call");
    expect(started.origin).toEqual({ x: 1430, z: 600 });
  });

  it("does not open a world with a spurious re-entry snap", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink, inFrame);
    feed.frame(16, { x: 600, z: 500 }, 0, false);
    feed.frame(16, { x: 600, z: 500 }, 0, false);
    expect(calls).toEqual([]);
  });

  it("resolves a planned walk at the frame edge rather than at a destination outside it", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink, inFrame);
    feed.planned({ x: 1400, z: 600 }, [{ x: 1430, z: 600 }], 430);
    feed.frame(16, { x: 1420, z: 600 }, FACING_YAW.east, true);
    feed.frame(16, { x: 1460, z: 600 }, FACING_YAW.east, true); // stepped outside mid-walk
    expect(calls[1]).toEqual({ call: "arrived", at: { x: 1420, z: 600 }, facing: "east" });
  });

  it("follows the body through a placement that crosses the boundary", () => {
    // The CAVE portal teleports across the frame edge. Without the flag following the body, the next
    // frame would read as a transition that never happened and publish a snap for it.
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink, inFrame);
    feed.frame(16, { x: 600, z: 500 }, 0, false);
    feed.placed({ x: 2600, z: 400 }); // into the CAVE
    for (let t = 0; t < 300; t += 16) feed.frame(16, { x: 2600, z: 400 }, 0, false);
    expect(calls).toEqual([]);
  });
});

describe("free-movement latency, measured rather than asserted by eye", () => {
  // Phase 5's third correction. A free walk cannot be announced before it happens, so a peer's view is
  // always "observe one leg, then replay one leg" and the lag is bounded by two leg lengths. These cases
  // pin the bound down in units of ground, so a future change to LEG_MS cannot quietly regress it.
  const SPEED = 100; // sprinting — the worst case for distance per unit of time

  /** Walk continuously and track the worst gap between the body and the last position a peer has been
   *  told about (the endpoint of the most recently RESOLVED movement). */
  function worstResolvedGap(): number {
    const calls: { call: string; at?: Vec2; path?: Vec2[] }[] = [];
    const sink: Vo3dSelfMovementSink = {
      state: { started: 0, arrived: 0, refused: 0, wire: [] },
      started: (_o, path) => calls.push({ call: "started", path: [...path] }),
      arrived: (at) => calls.push({ call: "arrived", at }),
    };
    const feed = new SelfMovementFeed(sink);
    let pos = { x: 0, z: 0 };
    feed.frame(16, pos, 0, false);
    let worst = 0;
    let resolved: Vec2 = pos;
    for (let t = 0; t < 4000; t += 16) {
      pos = { x: pos.x, z: pos.z + (SPEED * 16) / 1000 };
      feed.frame(16, pos, 0, false);
      for (const c of calls.splice(0)) if (c.call === "arrived" && c.at) resolved = c.at;
      worst = Math.max(worst, Math.hypot(pos.x - resolved.x, pos.z - resolved.z));
    }
    return worst;
  }

  it("keeps a peer's confirmed position within two leg lengths of ground", () => {
    const gap = worstResolvedGap();
    // Two 400 ms legs at 100 units/s is 80 units, plus a frame. Before the retune (600 ms legs) the same
    // walk ran to ~120; the assertion is the budget, not the measurement.
    expect(gap).toBeLessThan(90);
    expect(gap).toBeGreaterThan(0); // the test is measuring something
  });

  it("publishes a planned walk with NO observation lag at all", () => {
    // The Office View's click-to-walk knows its whole path up front, so peers replay it in step with the
    // local walk. Nothing about the leg length applies to it, which is why the retune is a free-movement
    // change only.
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.planned({ x: 0, z: 0 }, [{ x: 0, z: 400 }], 4000);
    expect(calls).toHaveLength(1);
    const started = calls[0];
    if (started.call !== "started") throw new Error("expected a started call");
    expect(started.path[0]).toEqual({ x: 0, z: 400 });
    expect(started.durationMs).toBe(4000);
  });
});

describe("an interruption that moves the body in the same tick", () => {
  it("resolves the in-flight planned walk where the body IS, before the placement", () => {
    // app/world.ts's ejectFromOffice: V1 confirms a checkout, the walker is stopped and the body is stood
    // back on Reception's public side, all in one call. Without interrupt() the walk_started already sent
    // would never be answered — peers replay a route nobody finished and nothing durable is written.
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.planned({ x: 600, z: 730 }, [{ x: 400, z: 400 }], 5200);
    feed.frame(16, { x: 540, z: 700 }, FACING_YAW.north, true);
    expect(calls.map((c) => c.call)).toEqual(["started"]);

    feed.interrupt({ x: 540, z: 700 }, FACING_YAW.north);
    expect(calls[1]).toEqual({ call: "arrived", at: { x: 540, z: 700 }, facing: "north" });

    feed.placed({ x: 600, z: 1096 });
    for (let t = 0; t < 400; t += 16) feed.frame(16, { x: 600, z: 1096 }, 0, false);
    // The placement itself is not a movement, so nothing further goes out.
    expect(calls).toHaveLength(2);
  });

  it("closes an in-flight FREE leg the same way", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.frame(16, { x: 600, z: 700 }, 0, false);
    const end = drive(feed, { x: 600, z: 700 }, 0, -1, 250, 70);
    expect(calls).toEqual([]);
    feed.interrupt(end, FACING_YAW.north);
    expect(calls.map((c) => c.call)).toEqual(["started", "arrived"]);
    expect(calls[1]).toEqual({ call: "arrived", at: end, facing: "north" });
  });

  it("is a no-op with nothing in flight, and is safe to repeat", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.frame(16, { x: 600, z: 700 }, 0, false);
    feed.interrupt({ x: 600, z: 700 }, 0);
    feed.interrupt({ x: 600, z: 700 }, 0);
    expect(calls).toEqual([]);
  });
});

describe("event counts per walk (the 'two walk_started' investigation)", () => {
  // A two-session run once showed ONE driven walkTo against a counter that had advanced by two. The
  // traces settled it: the counter is cumulative per world, a V2 walk is several seconds long, and the
  // second walk had been issued into an unfinished first one. These cases pin the accounting down so the
  // question does not have to be re-investigated from logs.
  it("publishes exactly ONE started per planned walk", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.planned({ x: 600, z: 1050 }, [{ x: 600, z: 900 }, { x: 500, z: 700 }], 8000);
    // ...and keeps publishing nothing for the whole length of it, however many frames that takes.
    for (let t = 0; t < 8000; t += 16) feed.frame(16, { x: 600 - t / 100, z: 1050 - t / 50 }, 0, true);
    expect(calls.filter((c) => c.call === "started")).toHaveLength(1);
    expect(sink.state.started).toBe(1);
    expect(sink.state.arrived).toBe(0);
  });

  it("publishes a SECOND started for a redirect, with no arrival for the walk it replaced", () => {
    // V1's own rule, unchanged: makeMoveSelf never sends an arrival for a superseded walk either, and the
    // backend rejects an arrival whose movementId is not the active one. Two starteds and one arrival is
    // therefore the CORRECT shape of "walked, changed my mind, then arrived" — not a duplicate.
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.planned({ x: 600, z: 1050 }, [{ x: 400, z: 400 }], 9000);
    feed.frame(16, { x: 590, z: 1020 }, 0, true);
    feed.planned({ x: 590, z: 1020 }, [{ x: 300, z: 470 }], 8000);
    feed.frame(16, { x: 580, z: 1000 }, 0, true);
    feed.frame(16, { x: 580, z: 1000 }, 0, false);
    expect(calls.map((c) => c.call)).toEqual(["started", "started", "arrived"]);
    expect(sink.state).toMatchObject({ started: 2, arrived: 1, refused: 0 });
  });

  it("publishes one started and one arrival for a walk that runs to its end", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink);
    feed.planned({ x: 600, z: 1050 }, [{ x: 600, z: 900 }], 2100);
    for (let t = 0; t < 2100; t += 16) feed.frame(16, { x: 600, z: 1050 - t / 14 }, 0, true);
    feed.frame(16, { x: 600, z: 900 }, 0, false);
    expect(calls.map((c) => c.call)).toEqual(["started", "arrived"]);
  });
});
