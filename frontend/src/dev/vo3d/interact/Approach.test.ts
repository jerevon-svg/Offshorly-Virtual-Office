// vo3d interact — PHASE 7E STEP 1: THE ARRIVAL NOTIFICATION.
//
// What is under test is ONE fact and its edges: an approach that was given an entity id notifies exactly
// once, at the moment the turn finishes, and never at any other moment. Everything else about
// ApproachInteraction is unchanged and is deliberately not restated here.
//
// The avatar and the controller stack are the REAL ControllerStack and a two-field avatar stub, because
// the class only ever reads `yaw` and calls `setYaw` — loading the real Avatar would pull three.js in for
// no assertion. `requestWalk` is a stub returning the planner's own NavResult shape.
// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only) — the same
// exemption app/spawn.phase5.test.ts takes. vitest runs with cwd = frontend/.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ApproachInteraction } from "./Approach";
import { ControllerStack } from "../avatar/Controller";
import type { Avatar } from "../avatar/Avatar";
import type { NavResult } from "../nav/planner";
import type { ApproachCapability } from "../world/WorldState";
// THE REAL RECEPTION KIOSK, not a hand-written fixture: the point of the last test is that the entity the
// world already ships can drive this seam, so it has to be that entity's own capability.
import { KIOSK_APPROACH, KIOSK_INTERACTION_ID, receptionEntities } from "../rooms/reception";

const SPEC: ApproachCapability = { point: { x: 10, z: 20 }, yaw: 0, label: "test fixture", action: "use it" };

function ok(spec: ApproachCapability): NavResult {
  return { ok: true, destination: { ...spec.point }, path: [{ ...spec.point }], cell: { cx: 0, cy: 0 } };
}

function harness(walk: (to: { x: number; z: number }) => NavResult = () => ok(SPEC)) {
  const avatar = { yaw: Math.PI, setYaw(y: number) { this.yaw = y; } };
  const stack = new ControllerStack();
  const approach = new ApproachInteraction(avatar as unknown as Avatar, stack, walk);
  const onArrived = vi.fn();
  approach.onArrivedAtTarget = onArrived;
  return { approach, stack, avatar, onArrived };
}

/** Turn to completion: the class turns at 4.2 rad/s, so a second of dt settles any yaw used here. */
function settle(approach: ApproachInteraction): void {
  for (let i = 0; i < 20; i++) approach.update(0.05);
}

describe("ApproachInteraction — arrival notification (Phase 7E)", () => {
  it("fires once with the entity id when the turn completes", () => {
    const { approach, onArrived } = harness();
    approach.begin(SPEC, "some-room/some-fixture");
    expect(onArrived).not.toHaveBeenCalled();

    approach.onArrived(); // the walk controller reports arrival at the approach point
    expect(approach.state).toBe("turning");
    expect(onArrived).not.toHaveBeenCalled(); // still turning — not there yet

    settle(approach);
    expect(approach.state).toBe("arrived");
    expect(onArrived).toHaveBeenCalledTimes(1);
    expect(onArrived).toHaveBeenCalledWith("some-room/some-fixture");
  });

  it("releases the avatar before notifying, so a listener may act immediately", () => {
    const { approach, stack, onArrived } = harness();
    onArrived.mockImplementation(() => {
      // What Step 2's kiosk card will need: the body is free the instant the host hears about it.
      expect(stack.owner).toBe("Idle");
    });
    approach.begin(SPEC, "some-room/some-fixture");
    approach.onArrived();
    expect(stack.owner).toBe("Interaction");
    settle(approach);
    expect(onArrived).toHaveBeenCalledTimes(1);
  });

  it("does not fire again on the frames that keep arriving after arrival", () => {
    const { approach, onArrived } = harness();
    approach.begin(SPEC, "some-room/some-fixture");
    approach.onArrived();
    settle(approach);
    expect(onArrived).toHaveBeenCalledTimes(1);

    settle(approach); // 20 more frames in the `arrived` state
    approach.onArrived(); // a duplicate arrival report from the walk controller
    settle(approach);
    expect(onArrived).toHaveBeenCalledTimes(1);
  });

  it("fires again for a genuinely new approach to the same entity", () => {
    const { approach, onArrived } = harness();
    approach.begin(SPEC, "some-room/some-fixture");
    approach.onArrived();
    settle(approach);

    approach.begin({ ...SPEC, yaw: Math.PI / 2 }, "some-room/some-fixture");
    approach.onArrived();
    settle(approach);
    expect(onArrived).toHaveBeenCalledTimes(2);
  });

  it("never fires for an approach that was cancelled mid-walk", () => {
    const { approach, onArrived } = harness();
    approach.begin(SPEC, "some-room/some-fixture");
    approach.cancel();
    approach.onArrived(); // the queued walk reports in after the interruption
    settle(approach);
    expect(approach.state).toBe("idle");
    expect(onArrived).not.toHaveBeenCalled();
  });

  it("never fires for an approach that was cancelled mid-turn", () => {
    const { approach, stack, onArrived } = harness();
    approach.begin(SPEC, "some-room/some-fixture");
    approach.onArrived();
    approach.update(0.02); // part-way round
    approach.cancel();
    expect(stack.owner).toBe("Idle"); // the avatar is handed back, as it always was
    settle(approach);
    expect(onArrived).not.toHaveBeenCalled();
  });

  it("never fires for an unreachable approach, and leaves no target behind", () => {
    const { approach, onArrived } = harness(() => ({ ok: false, reason: "unreachable", destination: null, cell: null }));
    const r = approach.begin(SPEC, "some-room/some-fixture");
    expect(r.ok).toBe(false);
    expect(approach.state).toBe("idle");
    approach.onArrived();
    settle(approach);
    expect(onArrived).not.toHaveBeenCalled();
  });

  it("does not fire for an approach begun without an entity id", () => {
    const { approach, onArrived } = harness();
    approach.begin(SPEC); // every pre-7E caller shape
    approach.onArrived();
    settle(approach);
    expect(approach.state).toBe("arrived"); // unchanged behaviour
    expect(onArrived).not.toHaveBeenCalled();
  });

  it("carries no target over from a previous approach that named one", () => {
    const { approach, onArrived } = harness();
    approach.begin(SPEC, "some-room/some-fixture");
    approach.onArrived();
    settle(approach);
    onArrived.mockClear();

    approach.begin({ ...SPEC, yaw: Math.PI / 2 }); // an anonymous approach right after a named one
    approach.onArrived();
    settle(approach);
    expect(onArrived).not.toHaveBeenCalled();
  });
});

describe("the Reception kiosk drives the seam end to end", () => {
  it("is still an entity carrying an approach capability", () => {
    const kiosk = receptionEntities().find((e) => e.id === KIOSK_INTERACTION_ID);
    expect(kiosk?.capabilities.approach).toEqual(KIOSK_APPROACH);
  });

  it("notifies with the kiosk's own id after walking to its point and turning to it", () => {
    const kiosk = receptionEntities().find((e) => e.id === KIOSK_INTERACTION_ID);
    const spec = kiosk!.capabilities.approach!;
    const walk = vi.fn(() => ok(spec));
    const { approach, avatar, onArrived } = harness(walk);

    // Exactly what app/world.ts's startApproach does with this entity.
    approach.begin(spec, KIOSK_INTERACTION_ID);
    expect(walk).toHaveBeenCalledWith(spec.point);

    approach.onArrived();
    settle(approach);

    expect(onArrived).toHaveBeenCalledTimes(1);
    expect(onArrived).toHaveBeenCalledWith(KIOSK_INTERACTION_ID);
    expect(avatar.yaw).toBe(spec.yaw); // facing the kiosk, which is what "arrived" means here
  });
});

// ---- the world/host boundary ----------------------------------------------------------------------
// app/world.ts builds a WebGL world and cannot be instantiated in jsdom, so the two structural promises
// it makes are asserted against its source — the same exemption app/spawn.phase5.test.ts takes, and for
// the same reason: a behavioural test cannot show an absence.
const worldSrc = readFileSync("src/dev/vo3d/app/world.ts", "utf8");
/** Source with its comments removed: a prose mention is the documentation doing its job. */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("app/world.ts bridges the arrival to the host contract and decides nothing itself", () => {
  it("hands every walk-up its entity id and forwards the arrival to the host handlers", () => {
    const src = code(worldSrc);
    expect(src).toContain("approachCtl.begin(spec, entityId)");
    expect(src).toContain("approachCtl.onArrivedAtTarget = (entityId) => coworkerInteractions?.onInteractionArrived?.(entityId)");
  });

  it("still knows nothing about attendance", () => {
    // The Phase 5 invariant, restated here because Step 1 is the first thing to touch this path since:
    // the world walks a body to a fixture and says so. What the fixture MEANS stays on the host side.
    const src = code(worldSrc);
    expect(src).not.toContain("attendanceService");
    expect(src).not.toContain("CHECKED_IN");
    expect(src).not.toContain("CHECKED_OUT");
  });
});
