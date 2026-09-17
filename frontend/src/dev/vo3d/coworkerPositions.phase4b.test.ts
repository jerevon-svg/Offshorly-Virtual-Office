// Phase 4B — the JOIN between V1's roster seating and V1's persisted positions, against the real tables.
//
// Everything here is the pure adapter (adapters/v1CoworkerPositions.ts). No socket, no world, no scene:
// the point of the split is that the whole "which fact is this person's position" decision is testable as
// arithmetic, and only the snapping is left to the scene module.
import { describe, expect, it } from "vitest";
import { applyLivePositions, countLivePositions, isUsablePosition } from "./adapters/v1CoworkerPositions";
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
