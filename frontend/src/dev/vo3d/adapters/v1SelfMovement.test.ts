// Phase 5 — the WRITE side, tested against V1's real tables rather than a mock of them. The point of
// these cases is the same as Phase 2's and 4B's: what V2 publishes has to be what V1 would have
// published for the same body, down to the sprite-top-left origin and the room id.
//
// Only the two emit functions are stubbed, because they are the socket. Everything they are handed is
// computed from V1's own manifest, V1's own room lookup and V1's own facing table.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const emitWalkStarted = vi.fn();
const emitWalkArrived = vi.fn();
vi.mock("../../../services/presence/movementSync", () => ({
  emitWalkStarted: (...args: unknown[]) => emitWalkStarted(...args),
  emitWalkArrived: (...args: unknown[]) => emitWalkArrived(...args),
}));

import { createV1SelfMovementSink, resolveV1SelfPosition, selfSpriteBox } from "./v1SelfMovement";
import { resetCurrentUserForTests, setCurrentUserFromMeResponse } from "../../../auth/currentUserStore";
import { __resetCurrentUserIdForTest } from "../../../auth/useAuthGate";
import { bonLayer, npcCharacterLayers } from "../../../data/office-layout";
import { roomOf } from "../../../data/officePathfinding";
import type { PeerMovementState } from "../../../services/presence/movementSync";

const BON_EMAIL = "jerevon@offshorly.com";

function signIn(email = BON_EMAIL, full_name = "Bon") {
  setCurrentUserFromMeResponse({ id: "atlas-1", email, full_name, role: "dev", team: null });
}

/** A movement-store row in the shape movementSync actually holds. */
function peer(email: string, pos: { x: number; y: number }, facing: PeerMovementState["stable"]["facing"] = "left"): PeerMovementState {
  return {
    email,
    revision: 7,
    stable: { pos, facing, state: "standing", seatKey: null, roomId: null },
    active: null,
  };
}

beforeEach(() => {
  resetCurrentUserForTests();
  __resetCurrentUserIdForTest();
  emitWalkStarted.mockClear();
  emitWalkArrived.mockClear();
});
afterEach(() => {
  resetCurrentUserForTests();
  __resetCurrentUserIdForTest();
});

describe("selfSpriteBox", () => {
  it("is V1's own playerCharacterLayer rule: bon's box, or that character's own manifest box", () => {
    expect(selfSpriteBox("bon")).toEqual({ width: bonLayer.width, height: bonLayer.height });
    const micah = npcCharacterLayers.find((l) => l.id === "micah");
    expect(micah).toBeDefined();
    expect(selfSpriteBox("micah")).toEqual({ width: micah!.width, height: micah!.height });
    // micah is deliberately taller than bon (raised-arm headroom) — which is exactly why reusing bon's
    // halves for everybody would offset them on every peer's screen and in the DB.
    expect(micah!.height).not.toBe(bonLayer.height);
  });

  it("falls back to bon's box for an unmapped or absent character, like V1 does", () => {
    expect(selfSpriteBox(null)).toEqual({ width: bonLayer.width, height: bonLayer.height });
    expect(selfSpriteBox("nobody-at-all")).toEqual({ width: bonLayer.width, height: bonLayer.height });
  });
});

describe("createV1SelfMovementSink", () => {
  it("is null with no signed-in employee, so nothing can be published as a guess", () => {
    expect(createV1SelfMovementSink()).toBeNull();
  });

  it("publishes V1's own event with the sprite TOP-LEFT origin, the real path and the room id", () => {
    signIn();
    const sink = createV1SelfMovementSink()!;
    expect(sink).not.toBeNull();
    const half = { x: bonLayer.width / 2, y: bonLayer.height / 2 };

    // Two points in the central hub, in V1 frame units, given as CENTRES (the basis the world hands over).
    const origin = { x: 600, z: 500 };
    const end = { x: 640, z: 520 };
    sink.started(origin, [end], 1234.6);

    expect(emitWalkStarted).toHaveBeenCalledTimes(1);
    const payload = emitWalkStarted.mock.calls[0][0];
    expect(payload.origin).toEqual({ x: origin.x - half.x, y: origin.z - half.y });
    expect(payload.path).toEqual([{ x: end.x - half.x, y: end.z - half.y }]);
    // The duration is passed through untouched — V1's own emitWalkStarted owns the round + clamp, and
    // re-doing it here would be a second copy of the backend's window.
    expect(payload.durationMs).toBe(1234.6);
    // The room the walk is FOR, by V1's own lookup on the destination CENTRE — same call, same argument,
    // that every moveSelf call site in OfficeMap.tsx makes.
    expect(payload.roomId).toBe(roomOf({ x: end.x, y: end.z })?.id ?? null);
    expect(typeof payload.movementId).toBe("string");
    expect(payload.movementId.length).toBeGreaterThan(0);
    expect(sink.state).toMatchObject({ started: 1, arrived: 0, refused: 0 });
  });

  it("pairs the arrival with the SAME movement id, standing, with no seat claimed", () => {
    signIn();
    const sink = createV1SelfMovementSink()!;
    sink.started({ x: 600, z: 500 }, [{ x: 640, z: 520 }], 900);
    sink.arrived({ x: 640, z: 520 }, "west");

    const started = emitWalkStarted.mock.calls[0][0];
    const arrived = emitWalkArrived.mock.calls[0][0];
    expect(arrived.movementId).toBe(started.movementId);
    expect(arrived.at).toEqual({ x: 640 - bonLayer.width / 2, y: 520 - bonLayer.height / 2 });
    // V1's sprite vocabulary, through the one table both directions share.
    expect(arrived.facing).toBe("left");
    // NOT a seat and NOT a session: V2 publishes where the body is and claims nothing else.
    expect(arrived.state).toBe("standing");
    expect(arrived.seatKey).toBeNull();
    expect(arrived.roomId).toBe(started.roomId);
    expect(sink.state).toMatchObject({ started: 1, arrived: 1, refused: 0 });
  });

  it("never sends an arrival for a movement it did not publish", () => {
    // An unpaired walk_arrived is rejected server-side (no matching active movementId) and would be a
    // claim about a walk that never happened.
    signIn();
    const sink = createV1SelfMovementSink()!;
    sink.arrived({ x: 600, z: 500 }, "south");
    expect(emitWalkArrived).not.toHaveBeenCalled();
    expect(sink.state.arrived).toBe(0);
  });

  it("refuses a movement that leaves the V1 frame WHOLE, rather than clamping it inside", () => {
    // The Championship CAVE stands at x 2600 — V2 world, no V1 floor. Publishing the part of the walk
    // that happens to be inside the frame would broadcast a route the employee did not take.
    signIn();
    const sink = createV1SelfMovementSink()!;
    sink.started({ x: 600, z: 500 }, [{ x: 900, z: 500 }, { x: 2600, z: 520 }], 4000);
    expect(emitWalkStarted).not.toHaveBeenCalled();
    expect(sink.state).toMatchObject({ started: 0, arrived: 0, refused: 1 });
    // ...and the arrival that follows it is not sent either: there is no movement to resolve.
    sink.arrived({ x: 2600, z: 520 }, "south");
    expect(emitWalkArrived).not.toHaveBeenCalled();
  });

  it("refuses an origin outside the frame too", () => {
    signIn();
    const sink = createV1SelfMovementSink()!;
    sink.started({ x: 2600, z: 400 }, [{ x: 600, z: 500 }], 4000);
    expect(emitWalkStarted).not.toHaveBeenCalled();
    expect(sink.state.refused).toBe(1);
  });

  it("leaves a published movement unresolved when the body ends somewhere V1 cannot hold", () => {
    signIn();
    const sink = createV1SelfMovementSink()!;
    sink.started({ x: 600, z: 500 }, [{ x: 640, z: 520 }], 900);
    sink.arrived({ x: 2600, z: 520 }, "south"); // walked on into the CAVE before the leg resolved
    expect(emitWalkArrived).not.toHaveBeenCalled();
    expect(sink.state).toMatchObject({ started: 1, arrived: 0, refused: 1 });
  });

  it("gives each movement its own id", () => {
    signIn();
    const sink = createV1SelfMovementSink()!;
    sink.started({ x: 600, z: 500 }, [{ x: 620, z: 500 }], 500);
    sink.started({ x: 620, z: 500 }, [{ x: 640, z: 500 }], 500);
    const [a, b] = emitWalkStarted.mock.calls.map((c) => c[0].movementId);
    expect(a).not.toBe(b);
  });
});

describe("resolveV1SelfPosition", () => {
  const box = { width: 20, height: 40 };

  it("is null before V1's first positions_snapshot — an empty store is not 'nobody has moved'", () => {
    signIn();
    expect(resolveV1SelfPosition([peer(BON_EMAIL, { x: 600, y: 500 })], false, box)).toBeNull();
  });

  it("is null with no signed-in employee, and null when V1 holds no row for them", () => {
    expect(resolveV1SelfPosition([peer(BON_EMAIL, { x: 600, y: 500 })], true, box)).toBeNull();
    signIn();
    expect(resolveV1SelfPosition([peer("someone@else.com", { x: 600, y: 500 })], true, box)).toBeNull();
  });

  it("converts self's own persisted top-left back to a CENTRE through their own box", () => {
    signIn();
    const got = resolveV1SelfPosition([peer(BON_EMAIL, { x: 600, y: 500 }, "back")], true, box);
    expect(got).toEqual({ point: { x: 610, z: 520 }, facing: "north" });
  });

  it("matches the row case-insensitively, like every other V1 feed join", () => {
    signIn();
    const got = resolveV1SelfPosition([peer("JEREVON@Offshorly.com", { x: 600, y: 500 })], true, box);
    expect(got).not.toBeNull();
  });

  it("refuses a corrupt persisted position rather than placing a body on it", () => {
    signIn();
    expect(resolveV1SelfPosition([peer(BON_EMAIL, { x: 1e9, y: 500 })], true, box)).toBeNull();
    expect(resolveV1SelfPosition([peer(BON_EMAIL, { x: NaN, y: 500 })], true, box)).toBeNull();
  });
});

describe("the wire log (the evidence surface)", () => {
  it("records each movement's own id, and gives a redirect a distinct one", () => {
    // The "two walk_started for one walkTo" question could not be answered from counters alone. This is
    // what answers it: distinct ids, and an explicit supersedes link when one movement replaces another.
    signIn();
    const sink = createV1SelfMovementSink()!;
    sink.started({ x: 600, z: 1050 }, [{ x: 600, z: 900 }], 2100);
    sink.started({ x: 600, z: 980 }, [{ x: 500, z: 700 }], 4200);
    sink.arrived({ x: 500, z: 700 }, "north");

    const ids = emitWalkStarted.mock.calls.map((c) => c[0].movementId);
    expect(new Set(ids).size).toBe(2);
    expect(sink.state.wire).toHaveLength(3);
    expect(sink.state.wire[0]).toMatch(/^started id=\w+ pts=1 ms=2100 room=/);
    expect(sink.state.wire[1]).toContain(`supersedes=${ids[0].slice(0, 8)}`);
    expect(sink.state.wire[2]).toMatch(/^arrived id=\w+ facing=back$/);
    // The arrival answers the SECOND movement — the first was abandoned, exactly as V1 abandons one.
    expect(emitWalkArrived.mock.calls[0][0].movementId).toBe(ids[1]);
  });

  it("records a refusal, so a silent drop is never invisible", () => {
    signIn();
    const sink = createV1SelfMovementSink()!;
    sink.started({ x: 2600, z: 400 }, [{ x: 2600, z: 420 }], 500);
    expect(sink.state.wire).toEqual(["refused-started pts=1"]);
  });

  it("carries no coordinates, and is bounded", () => {
    // It is read from the dev console and the verification harness; one employee's position does not
    // belong in either. Same redaction rule as the DOM readout.
    signIn();
    const sink = createV1SelfMovementSink()!;
    for (let i = 0; i < 40; i++) {
      sink.started({ x: 600, z: 1050 }, [{ x: 601 + i, z: 900 }], 2100);
      sink.arrived({ x: 601 + i, z: 900 }, "north");
    }
    expect(sink.state.wire.length).toBeLessThanOrEqual(24);
    for (const line of sink.state.wire) {
      expect(line).not.toMatch(/\b(600|900|1050)\b/);
      expect(line).not.toContain("x=");
    }
  });
});
