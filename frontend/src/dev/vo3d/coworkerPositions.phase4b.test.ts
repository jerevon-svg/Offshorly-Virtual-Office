// Phase 4B — the JOIN between V1's roster seating and V1's persisted positions, against the real tables.
//
// Everything here is the pure adapter (adapters/v1CoworkerPositions.ts). No socket, no world, no scene:
// the point of the split is that the whole "which fact is this person's position" decision is testable as
// arithmetic, and only the snapping is left to the scene module.
import { describe, expect, it } from "vitest";
import { applyLivePositions, countLivePositions, countWalking, isUsablePosition, resolveWalk } from "./adapters/v1CoworkerPositions";
import type { Vo3dCoworker, Vo3dCoworkerSet } from "./app/coworkers";
import type { PeerMovementState } from "../../services/presence/movementSync";

const BON_BOX = { width: 26, height: 37.2 };
/** micah's box is deliberately TALLER than bon's — the raised-arm headroom calibration. Using it in the
 *  conversion tests is what makes "their own box, never bonLayer's" a measurable claim rather than a note. */
const TALL_BOX = { width: 30, height: 48 };

function coworker(email: string, box = BON_BOX, point = { x: 100, z: 200 }): Vo3dCoworker {
  return {
    email,
    displayName: email.split("@")[0],
    avatarId: "bon",
    point,
    box,
    posSource: "desk",
    facing: "south",
  };
}

function setOf(...coworkers: Vo3dCoworker[]): Vo3dCoworkerSet {
  return { coworkers, missingAvatar: [] };
}

function peer(
  email: string,
  pos: { x: number; y: number },
  stable: Partial<PeerMovementState["stable"]> = {},
  active: PeerMovementState["active"] = null,
): PeerMovementState {
  return {
    email,
    revision: 7,
    stable: { pos, facing: "front", state: "standing", seatKey: null, roomId: null, ...stable },
    active,
  };
}

describe("applyLivePositions — when a desk stays a desk", () => {
  it("does nothing at all before V1's first positions_snapshot", () => {
    const set = setOf(coworker("a@x.com"));
    // A position is present in the store, and is still not believed: until the snapshot flag flips there
    // is no way to tell an empty store from an office where nobody has ever moved.
    expect(applyLivePositions(set, [peer("a@x.com", { x: 900, y: 900 })], false)).toBe(set);
  });

  it("keeps a person's derived desk when V1 holds no position for them", () => {
    const set = setOf(coworker("a@x.com"));
    expect(applyLivePositions(set, [peer("someone-else@x.com", { x: 900, y: 900 })], true)).toBe(set);
  });

  it("returns the very same set by reference when nothing applies, so the host pushes no new roster", () => {
    const set = setOf(coworker("a@x.com"));
    expect(applyLivePositions(set, [], true)).toBe(set);
    expect(applyLivePositions({ coworkers: [], missingAvatar: ["lui"] }, [peer("a@x.com", { x: 1, y: 1 })], true))
      .toEqual({ coworkers: [], missingAvatar: ["lui"] });
  });

  it("moves only the people V1 has positions for, and leaves the rest on their desks", () => {
    const set = setOf(coworker("a@x.com"), coworker("b@x.com", BON_BOX, { x: 500, z: 600 }));
    const out = applyLivePositions(set, [peer("a@x.com", { x: 0, y: 0 })], true);
    expect(out.coworkers[0].posSource).toBe("live");
    expect(out.coworkers[1].posSource).toBe("desk");
    expect(out.coworkers[1].point).toEqual({ x: 500, z: 600 });
  });
});

describe("applyLivePositions — the conversion", () => {
  it("undoes V1's sprite TOP-LEFT origin through THAT person's own box", () => {
    const out = applyLivePositions(setOf(coworker("a@x.com", TALL_BOX)), [peer("a@x.com", { x: 300, y: 400 })], true);
    expect(out.coworkers[0].point).toEqual({ x: 300 + 30 / 2, z: 400 + 48 / 2 });
  });

  it("NEVER borrows bon's box for somebody whose box is taller", () => {
    const tall = applyLivePositions(setOf(coworker("a@x.com", TALL_BOX)), [peer("a@x.com", { x: 0, y: 0 })], true);
    const bon = applyLivePositions(setOf(coworker("a@x.com", BON_BOX)), [peer("a@x.com", { x: 0, y: 0 })], true);
    expect(tall.coworkers[0].point.z).not.toEqual(bon.coworkers[0].point.z);
    expect(tall.coworkers[0].point.z).toBe(24);
    expect(bon.coworkers[0].point.z).toBe(18.6);
  });

  it("maps V1's y onto V2's z — the frame is the same basis the desk centroid is in", () => {
    const out = applyLivePositions(setOf(coworker("a@x.com", { width: 0, height: 0 })), [peer("a@x.com", { x: 12, y: 34 })], true);
    expect(out.coworkers[0].point).toEqual({ x: 12, z: 34 });
  });

  it("does NOT apply a room shift — the result is still in V1 frame units for world.ts to convert", () => {
    // A point deep inside the Design Room's art box. If this adapter were applying the +16 z shift, the
    // answer would be 16 units south of the raw conversion; world.ts owns that, through one table.
    const out = applyLivePositions(setOf(coworker("a@x.com", { width: 0, height: 0 })), [peer("a@x.com", { x: 214, y: 446 })], true);
    expect(out.coworkers[0].point).toEqual({ x: 214, z: 446 });
  });

  it("takes V1's recorded arrival facing, translated out of the sprite vocabulary", () => {
    const set = setOf(coworker("a@x.com"));
    expect(applyLivePositions(set, [peer("a@x.com", { x: 0, y: 0 }, { facing: "back" })], true).coworkers[0].facing).toBe("north");
    expect(applyLivePositions(set, [peer("a@x.com", { x: 0, y: 0 }, { facing: "left" })], true).coworkers[0].facing).toBe("west");
    expect(applyLivePositions(set, [peer("a@x.com", { x: 0, y: 0 }, { facing: "right" })], true).coworkers[0].facing).toBe("east");
    expect(applyLivePositions(set, [peer("a@x.com", { x: 0, y: 0 }, { facing: "front" })], true).coworkers[0].facing).toBe("south");
  });

  it("reads the ARRIVED half only — a walk in flight moves nobody", () => {
    // stable says they are still where they last stopped; `active` says they are half way across the
    // office. Phase 4B is a snap, so the in-flight half must not be consulted at all.
    const inFlight = peer(
      "a@x.com",
      { x: 100, y: 100 },
      {},
      { movementId: "m1", origin: { x: 100, y: 100 }, path: [{ x: 900, y: 900 }], roomId: null, durationMs: 4000, startedAt: 0 },
    );
    const out = applyLivePositions(setOf(coworker("a@x.com", { width: 0, height: 0 })), [inFlight], true);
    expect(out.coworkers[0].point).toEqual({ x: 100, z: 100 });
  });
});

describe("applyLivePositions — what it refuses", () => {
  it("keeps the desk for a position that is not a number", () => {
    const set = setOf(coworker("a@x.com"));
    for (const bad of [{ x: NaN, y: 0 }, { x: 0, y: NaN }, { x: Infinity, y: 0 }, { x: 0, y: -Infinity }]) {
      expect(applyLivePositions(set, [peer("a@x.com", bad)], true)).toBe(set);
    }
  });

  it("keeps the desk for a position nowhere near the V1 frame", () => {
    const set = setOf(coworker("a@x.com"));
    expect(applyLivePositions(set, [peer("a@x.com", { x: 1e9, y: 1e9 })], true)).toBe(set);
    expect(applyLivePositions(set, [peer("a@x.com", { x: -5000, y: 500 })], true)).toBe(set);
  });

  it("still believes a position on the frame's edge — the slack is for corruption, not for edges", () => {
    expect(isUsablePosition({ x: 0, y: 0 })).toBe(true);
    expect(isUsablePosition({ x: 1440, y: 1244 })).toBe(true);
    expect(isUsablePosition({ x: -10, y: -10 })).toBe(true);
    expect(isUsablePosition(null)).toBe(false);
    expect(isUsablePosition(undefined)).toBe(false);
  });

  it("CANNOT ADD ANYBODY — a peer with no coworker row is not drawn", () => {
    // The movement store is append-only and outlives the people in it: ex-employees, people in no V1 room,
    // and everyone the roster filters/offline predicate/avatar gate already dropped are all still in here.
    // This is the guard that stops stale movement data resurrecting a checked-out employee at a desk.
    const set = setOf(coworker("a@x.com"));
    const out = applyLivePositions(
      set,
      [peer("a@x.com", { x: 10, y: 10 }), peer("ghost@x.com", { x: 20, y: 20 }), peer("gone@x.com", { x: 30, y: 30 })],
      true,
    );
    expect(out.coworkers).toHaveLength(1);
    expect(out.coworkers[0].email).toBe("a@x.com");
  });

  it("carries the missing-avatar list through untouched — a position cannot cure a missing character", () => {
    const out = applyLivePositions(
      { coworkers: [coworker("a@x.com")], missingAvatar: ["Lui"] },
      [peer("a@x.com", { x: 10, y: 10 })],
      true,
    );
    expect(out.missingAvatar).toEqual(["Lui"]);
  });

  it("does not mutate the set it was given", () => {
    const set = setOf(coworker("a@x.com"));
    applyLivePositions(set, [peer("a@x.com", { x: 700, y: 700 })], true);
    expect(set.coworkers[0].point).toEqual({ x: 100, z: 200 });
    expect(set.coworkers[0].posSource).toBe("desk");
  });
});

describe("countLivePositions", () => {
  it("counts only the people standing on a live position", () => {
    const set = setOf(coworker("a@x.com"), coworker("b@x.com"), coworker("c@x.com"));
    expect(countLivePositions(set)).toBe(0);
    const out = applyLivePositions(set, [peer("a@x.com", { x: 1, y: 1 }), peer("c@x.com", { x: 2, y: 2 })], true);
    expect(countLivePositions(out)).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------------
// Phase 6A — the OTHER half of the same feed: the walk still in flight. Same module, same purity, same
// per-person box; what is new is that a movement in progress is now readable at all.
// ---------------------------------------------------------------------------------------------------

/** An in-flight movement in the shape movementSync holds, with TOP-LEFT points as the wire carries them. */
function active(
  movementId: string,
  origin: { x: number; y: number },
  path: { x: number; y: number }[],
  durationMs = 3000,
  startedAt = 1_000_000,
): PeerMovementState["active"] {
  return { movementId, origin, path, roomId: null, durationMs, startedAt };
}

describe("resolveWalk", () => {
  const NOW = 1_002_000; // two seconds after the movements below started, on the local clock

  it("is null for somebody standing still — the normal case for almost everybody", () => {
    expect(resolveWalk(null, BON_BOX, 0, NOW)).toBeNull();
  });

  it("converts every point through THAT PERSON'S OWN box, origin first", () => {
    const w = resolveWalk(
      active("m1", { x: 100, y: 200 }, [{ x: 100, y: 300 }, { x: 200, y: 300 }]),
      TALL_BOX,
      0,
      NOW,
    );
    expect(w).not.toBeNull();
    // top-left + half the box = the ground centre, exactly as the stable half is converted.
    expect(w!.path).toEqual([
      { x: 115, z: 224 },
      { x: 115, z: 324 },
      { x: 215, z: 324 },
    ]);
    expect(w!.movementId).toBe("m1");
    expect(w!.durationMs).toBe(3000);
  });

  it("carries V1's own duration rather than recomputing one from the distance", () => {
    // Every other viewer is replaying against the publisher's figure; deriving a second one here is how
    // two offices end up disagreeing about how long the same walk takes.
    const w = resolveWalk(active("m1", { x: 100, y: 200 }, [{ x: 100, y: 900 }], 777), BON_BOX, 0, NOW);
    expect(w!.durationMs).toBe(777);
  });

  it("computes elapsed from V1's server clock offset, and clamps it", () => {
    const at = (offset: number, now: number) =>
      resolveWalk(active("m1", { x: 100, y: 200 }, [{ x: 100, y: 300 }], 3000, 1_000_000), BON_BOX, offset, now)!
        .elapsedMs;
    expect(at(0, 1_001_500)).toBe(1500);
    // The server is 500 ms ahead of this client: the walk is that much further along than the local clock
    // alone would say. The same arithmetic V1's PeerWalker fast-forwards with.
    expect(at(500, 1_001_500)).toBe(2000);
    // Skew must not rewind a walk or push it past its own end.
    expect(at(-9_000_000, 1_001_500)).toBe(0);
    expect(at(9_000_000, 1_001_500)).toBe(3000);
  });

  it("refuses a route it cannot express, WHOLE rather than in part", () => {
    // Same predicate the stable half is judged by. A walk out to the campus or the CAVE is not a V1 walk,
    // and drawing the inside half of it would be somebody else's journey.
    expect(resolveWalk(active("m1", { x: 100, y: 200 }, [{ x: 2600, y: 400 }]), BON_BOX, 0, NOW)).toBeNull();
    expect(resolveWalk(active("m1", { x: 2600, y: 400 }, [{ x: 100, y: 200 }]), BON_BOX, 0, NOW)).toBeNull();
    expect(resolveWalk(active("m1", { x: NaN, y: 200 }, [{ x: 100, y: 200 }]), BON_BOX, 0, NOW)).toBeNull();
  });

  it("refuses an empty path or a duration the arithmetic cannot use", () => {
    expect(resolveWalk(active("m1", { x: 100, y: 200 }, []), BON_BOX, 0, NOW)).toBeNull();
    expect(resolveWalk(active("m1", { x: 100, y: 200 }, [{ x: 100, y: 300 }], 0), BON_BOX, 0, NOW)).toBeNull();
    expect(resolveWalk(active("m1", { x: 100, y: 200 }, [{ x: 100, y: 300 }], -1), BON_BOX, 0, NOW)).toBeNull();
  });
});

describe("applyLivePositions with a walk in flight", () => {
  it("attaches the walk AND keeps the stable position authoritative", () => {
    const set = setOf(coworker("micah@offshorly.com", TALL_BOX));
    const out = applyLivePositions(
      set,
      [peer("micah@offshorly.com", { x: 400, y: 500 }, {}, active("m1", { x: 400, y: 500 }, [{ x: 400, y: 700 }]))],
      true,
      0,
    );
    const c = out.coworkers[0];
    // `point` is still V1's last ARRIVED position — the thing the body settles on.
    expect(c.point).toEqual({ x: 415, z: 524 });
    expect(c.posSource).toBe("live");
    expect(c.walk?.movementId).toBe("m1");
    expect(c.walk?.path[0]).toEqual({ x: 415, z: 524 });
  });

  it("attaches a walk even when that person's persisted position is unusable", () => {
    // Two independent facts: a corrupt stable row is no reason to refuse a route that is fine. The body
    // keeps its derived desk as the thing it settles on.
    const set = setOf(coworker("micah@offshorly.com", BON_BOX, { x: 100, z: 200 }));
    const out = applyLivePositions(
      set,
      [peer("micah@offshorly.com", { x: 1e9, y: 500 }, {}, active("m1", { x: 400, y: 500 }, [{ x: 400, y: 700 }]))],
      true,
      0,
    );
    const c = out.coworkers[0];
    expect(c.point).toEqual({ x: 100, z: 200 });
    expect(c.posSource).toBe("desk");
    expect(c.walk?.movementId).toBe("m1");
  });

  it("attaches nothing before V1's first positions_snapshot", () => {
    const set = setOf(coworker("micah@offshorly.com"));
    const out = applyLivePositions(
      set,
      [peer("micah@offshorly.com", { x: 400, y: 500 }, {}, active("m1", { x: 400, y: 500 }, [{ x: 400, y: 700 }]))],
      false,
      0,
    );
    expect(out).toBe(set);
    expect(out.coworkers[0].walk).toBeUndefined();
  });

  it("leaves a standing coworker with no walk field at all", () => {
    const out = applyLivePositions(setOf(coworker("micah@offshorly.com")), [peer("micah@offshorly.com", { x: 400, y: 500 })], true, 0);
    expect(out.coworkers[0].walk).toBeUndefined();
    expect(countWalking(out)).toBe(0);
  });

  it("counts who is walking, and nothing more", () => {
    const out = applyLivePositions(
      setOf(coworker("a@x.com"), coworker("b@x.com")),
      [
        peer("a@x.com", { x: 400, y: 500 }, {}, active("m1", { x: 400, y: 500 }, [{ x: 400, y: 700 }])),
        peer("b@x.com", { x: 600, y: 500 }),
      ],
      true,
      0,
    );
    expect(countWalking(out)).toBe(1);
    expect(countLivePositions(out)).toBe(2);
  });
});


describe("Phase 6B — the exact yaw and the pacing come through the adapter, or not at all", () => {
  it("surfaces a stable yaw wrapped to (-π, π], and nothing when V1 relayed none", () => {
    const set = setOf(coworker("a@x.com"));
    const withYaw = applyLivePositions(set, [peer("a@x.com", { x: 100, y: 100 }, { yaw: 3.5 })], true);
    expect(withYaw.coworkers[0].yaw).toBeCloseTo(3.5 - 2 * Math.PI, 10);
    const legacy = applyLivePositions(set, [peer("a@x.com", { x: 100, y: 100 })], true);
    expect("yaw" in legacy.coworkers[0]).toBe(false);
    expect(legacy.coworkers[0].facing).toBe("south"); // the four-word account is still there
  });

  it("surfaces a linear pacing on the walk and leaves an eased or absent one implicit", () => {
    const set = setOf(coworker("a@x.com"));
    const active = { movementId: "m1", origin: { x: 100, y: 100 }, path: [{ x: 140, y: 100 }], roomId: null, durationMs: 400, startedAt: 0 };
    const linear = applyLivePositions(set, [peer("a@x.com", { x: 100, y: 100 }, {}, { ...active, pacing: "linear" })], true, 0);
    expect(linear.coworkers[0].walk?.pacing).toBe("linear");
    const eased = applyLivePositions(set, [peer("a@x.com", { x: 100, y: 100 }, {}, active)], true, 0);
    expect(eased.coworkers[0].walk).toBeDefined();
    expect("pacing" in eased.coworkers[0].walk!).toBe(false);
  });
});

// PHASE 7D — THE PLACE A POSITION CANNOT DESCRIBE.
//
// The CAVE is outside V1's coordinate frame, so somebody inside it publishes their last real in-frame
// point (the portal) plus the place NAME on the wire's existing `roomId`. This adapter's only job is to
// carry that name through: it does not know what "championship-cave" refers to — the world owns its own
// geometry — and it must not drop a fact peers need.
describe("applyLivePositions — a named place", () => {
  const set = (c: Partial<Vo3dCoworker> = {}): Vo3dCoworkerSet => ({
    coworkers: [
      {
        email: "b@x.com", displayName: "B", avatarId: "a1",
        box: { width: 26, height: 37 }, point: { x: 0, z: 0 }, posSource: "desk", ...c,
      } as Vo3dCoworker,
    ],
    missingAvatar: [],
  });

  it("carries the place through beside the position", () => {
    const out = applyLivePositions(
      set(),
      [peer("b@x.com", { x: 100, y: 200 }, { roomId: "championship-cave" })],
      true,
    );
    expect(out.coworkers[0].place).toBe("championship-cave");
    // The POSITION is still the real in-frame one — nothing is invented, and a client that does not
    // understand the place still draws them somewhere true.
    expect(out.coworkers[0].posSource).toBe("live");
    expect(out.coworkers[0].point).toBeTruthy();
  });

  it("carries an ordinary V1 room through the same way, and leaves it absent when there is none", () => {
    const withRoom = applyLivePositions(set(), [peer("b@x.com", { x: 1, y: 2 }, { roomId: "design-team" })], true);
    expect(withRoom.coworkers[0].place).toBe("design-team");

    const without = applyLivePositions(set(), [peer("b@x.com", { x: 1, y: 2 })], true);
    expect(without.coworkers[0].place).toBeUndefined();
  });

  it("drops the place when the peer comes back into the frame with none", () => {
    const inCave = applyLivePositions(set(), [peer("b@x.com", { x: 1, y: 2 }, { roomId: "championship-cave" })], true);
    expect(inCave.coworkers[0].place).toBe("championship-cave");

    const back = applyLivePositions(set(), [peer("b@x.com", { x: 1, y: 2 }, { roomId: null })], true);
    expect(back.coworkers[0].place).toBeUndefined();
  });

  it("never invents a worldPoint — only the world may resolve a place to its own geometry", () => {
    const out = applyLivePositions(set(), [peer("b@x.com", { x: 1, y: 2 }, { roomId: "championship-cave" })], true);
    expect(out.coworkers[0].worldPoint).toBeUndefined();
  });
});

// PHASE 7D — THE SIGNED-IN EMPLOYEE'S OWN RESTORE, from the same persisted row peers read.
//
// The bug this closes: a reload put the person back at `point` — the portal — while every other browser,
// reading the SAME row, correctly drew them inside the CAVE. The fact was on the wire the whole time;
// only the self resolver dropped it.
describe("resolveV1SelfPosition — the persisted place", () => {
  const SELF = "self@x.com";

  function selfPeer(stable: Partial<PeerMovementState["stable"]> = {}): PeerMovementState {
    return peer(SELF, { x: 400, y: 300 }, stable);
  }

  it("carries the place through beside the position", async () => {
    const { resolveV1SelfPosition } = await import("./adapters/v1SelfMovement");
    const { setCurrentUserFromMeResponse } = await import("../../auth/currentUserStore");
    setCurrentUserFromMeResponse({ email: SELF, name: "Self" } as never);

    const out = resolveV1SelfPosition([selfPeer({ roomId: "championship-cave" })], true, { width: 26, height: 37 });
    expect(out?.place).toBe("championship-cave");
    // The POSITION is untouched — a world that does not recognise the place restores exactly as before.
    expect(out?.point).toEqual({ x: 413, z: 318.5 });
  });

  it("leaves the place absent when V1 holds none, so ordinary restores are unchanged", async () => {
    const { resolveV1SelfPosition } = await import("./adapters/v1SelfMovement");
    const { setCurrentUserFromMeResponse } = await import("../../auth/currentUserStore");
    setCurrentUserFromMeResponse({ email: SELF, name: "Self" } as never);

    expect(resolveV1SelfPosition([selfPeer()], true, { width: 26, height: 37 })?.place).toBeUndefined();
  });

  it("carries an unrecognised place through unchanged — the world decides what it knows", async () => {
    const { resolveV1SelfPosition } = await import("./adapters/v1SelfMovement");
    const { setCurrentUserFromMeResponse } = await import("../../auth/currentUserStore");
    setCurrentUserFromMeResponse({ email: SELF, name: "Self" } as never);

    const out = resolveV1SelfPosition([selfPeer({ roomId: "somewhere-that-no-longer-exists" })], true, { width: 26, height: 37 });
    expect(out?.place).toBe("somewhere-that-no-longer-exists");
    // And the position is still a real one to fall back to.
    expect(out?.point).toEqual({ x: 413, z: 318.5 });
  });

  it("agrees with what the PEER adapter resolves from the very same row", async () => {
    const { resolveV1SelfPosition } = await import("./adapters/v1SelfMovement");
    const { setCurrentUserFromMeResponse } = await import("../../auth/currentUserStore");
    setCurrentUserFromMeResponse({ email: SELF, name: "Self" } as never);

    const row = selfPeer({ roomId: "championship-cave" });
    const mine = resolveV1SelfPosition([row], true, { width: 26, height: 37 });
    const theirs = applyLivePositions(
      {
        coworkers: [{
          email: SELF, displayName: "Self", avatarId: "a1",
          box: { width: 26, height: 37 }, point: { x: 0, z: 0 }, posSource: "desk",
        } as Vo3dCoworker],
        missingAvatar: [],
      },
      [row],
      true,
    );
    // The disagreement that caused the bug is impossible when both read the same field.
    expect(mine?.place).toBe(theirs.coworkers[0].place);
  });
});

// PHASE 7D — REAL MOVEMENT INSIDE A PLACE V1 CANNOT DESCRIBE.
//
// The previous round gave membership only: a peer in the Cave was pinned to a hash-of-email slot and
// never moved. The wire now carries the real position and the real walk in the place's own frame,
// beside the V1 coordinates that keep their original meaning.
describe("applyLivePositions / resolveWalk — a place's own frame", () => {
  const set = (): Vo3dCoworkerSet => ({
    coworkers: [{
      email: "b@x.com", displayName: "B", avatarId: "a1",
      box: { width: 26, height: 37 }, point: { x: 0, z: 0 }, posSource: "desk",
    } as Vo3dCoworker],
    missingAvatar: [],
  });

  it("uses the published local position, not a slot and not the V1 point", () => {
    const out = applyLivePositions(
      set(),
      [peer("b@x.com", { x: 1400, y: 600 }, { roomId: "championship-cave", localPos: { x: 2733, y: 851 } })],
      true,
    );
    expect(out.coworkers[0].localPoint).toEqual({ x: 2733, z: 851 });
    // The V1 point is still the in-frame one, untouched — nothing out-of-frame became a V1 coordinate.
    expect(out.coworkers[0].point).toEqual({ x: 1413, z: 618.5 });
  });

  it("leaves localPoint absent when the peer has not published one yet", () => {
    const out = applyLivePositions(
      set(),
      [peer("b@x.com", { x: 1400, y: 600 }, { roomId: "championship-cave" })],
      true,
    );
    // The portal is the honest fallback until they take a step.
    expect(out.coworkers[0].localPoint).toBeUndefined();
    expect(out.coworkers[0].place).toBe("championship-cave");
  });

  it("replays the LOCAL path when one is in flight, so a peer walks rather than teleports", () => {
    const walk = resolveWalk(
      {
        movementId: "m1",
        origin: { x: 1400, y: 600 },
        path: [{ x: 1400, y: 600 }],
        localOrigin: { x: 2700, y: 800 },
        localPath: [{ x: 2760, y: 800 }, { x: 2820, y: 840 }],
        roomId: "championship-cave",
        durationMs: 400,
        startedAt: 1_000,
      } as never,
      { width: 26, height: 37 },
      0,
      1_200,
    );
    // The real walk, in the place's frame, with no sprite-box conversion applied to it.
    expect(walk?.path).toEqual([
      { x: 2700, z: 800 }, { x: 2760, z: 800 }, { x: 2820, z: 840 },
    ]);
    // And it interpolates: halfway through a 400ms leg.
    expect(walk?.elapsedMs).toBe(200);
    expect(walk?.durationMs).toBe(400);
  });

  it("falls back to the V1 path when no local one was published", () => {
    const walk = resolveWalk(
      {
        movementId: "m1", origin: { x: 100, y: 100 }, path: [{ x: 200, y: 100 }],
        roomId: null, durationMs: 400, startedAt: 1_000,
      } as never,
      { width: 26, height: 37 },
      0,
      1_200,
    );
    // Converted through the box halves, exactly as an ordinary office walk always was.
    expect(walk?.path).toEqual([{ x: 113, z: 118.5 }, { x: 213, z: 118.5 }]);
  });

  it("refuses a local path with a non-finite point rather than replaying it", () => {
    const walk = resolveWalk(
      {
        movementId: "m1", origin: { x: 1400, y: 600 }, path: [{ x: 1400, y: 600 }],
        localOrigin: { x: 2700, y: 800 }, localPath: [{ x: Number.NaN, y: 800 }],
        roomId: "championship-cave", durationMs: 400, startedAt: 1_000,
      } as never,
      { width: 26, height: 37 },
      0,
      1_200,
    );
    // Falls back to the V1 path — never NaN into the interpolation.
    expect(walk?.path).toEqual([{ x: 1413, z: 618.5 }, { x: 1413, z: 618.5 }]);
  });
});
