// Go Together Phase 2 — the world closure the rendezvous walk depends on and no unit test can reach
// (createVo3dWorld needs WebGL), pinned by source like world.seatWiring.test.ts.
import { describe, expect, it } from "vitest";
import src from "./app/world.ts?raw";

describe("app/world.ts — an abandoned lift trip does not survive PLAYER taking the body", () => {
  it("yieldAvatar drops the lift trip and Walk There waiting on the approach it cancels", () => {
    // THE ROOT CAUSE of Bon not moving in the Phase 2 live test: Walk There (a lift trip = pendingFloor +
    // meetingWalk behind an approach), then PLAYER re-entered → yieldAvatar cancelled the approach but left
    // pendingFloor set, so the port reported `holding` forever and the rendezvous walk never started.
    const line = src.split("\n").find((l) => l.includes("yieldAvatar: () =>")) ?? "";
    expect(line).toContain("approachCtl.cancel();");
    expect(line).toContain("pendingFloor = null;");
    expect(line).toContain("meetingWalk = null;");
  });

  it("the port's `holding` is exactly the lift-trip state yieldAvatar clears", () => {
    expect(src).toContain("holding: pendingFloor !== null,");
  });
});

describe("app/world.ts — Phase 3 wiring", () => {
  it("a walk-up approach is PUBLISHED like any routed walk (the leader no longer looks frozen elsewhere)", () => {
    const body = src.slice(src.indexOf("function startApproach("), src.indexOf("function startLoungeSit("));
    expect(body).toContain("if (navCtl.setPath(r.path)) selfFeed?.planned(origin, r.path, plannedDurationMs(origin, r.path, navCtl.speed), guidedPacing());");
  });

  it("the old leader-held lift is gone: the party's barrier is the server's ride leg", () => {
    expect(src).not.toContain("heldLift");
    expect(src).not.toContain("holdDeparture");
    expect(src).not.toContain("holdArrival");
  });

  it("a party ride boards this body into its own slot, and its plan is in place before callElevator runs", () => {
    expect(src).toContain("return floorTransition.start(to, plan?.self ?? null);");
    const ride = src.slice(src.indexOf("    ride: (to, plan) => {"), src.indexOf("    setHooks: (hooks) => {"));
    expect(ride.indexOf("pendingLift = plan ?")).toBeLessThan(ride.indexOf("callElevator(to)"));
  });

  it("the doors wait for the party and the riders leave WITH the body", () => {
    expect(src).toContain("holdClose: (waitedMs) => {");
    expect(src).toContain("onLeaving: () => exitLiftRiders(specOf(currentFloor)),");
  });

  it("the Guided Journey frames a little wider, and a ride hands back to that framing", () => {
    expect(src).toContain("const GUIDED_JOURNEY_BOOM = 1.2;");
    expect(src).toContain("playerMode.camera.boomScale = journeyBoom();");
  });

  it("every lift start stands the player body where the avatar is (a walk to the doors in OFFICE was refused)", () => {
    const body = src.slice(src.indexOf("function startLiftRide("), src.indexOf("// ---- GO TOGETHER: the other party members"));
    expect(body).toContain("if (!playerMode.active) playerMode.body.pos = { x: avatar.position.x, z: avatar.position.z };");
  });

  it("every routed walk a Guided Journey drives is published LINEAR (how it really moves); others stay V1-eased", () => {
    expect(src).toContain('return stack.guided ? "linear" : undefined;');
    expect((src.match(/selfFeed\?\.planned\([^\n]*guidedPacing\(\)\)/g) ?? []).length).toBe(3);
    expect(src).not.toMatch(/selfFeed\?\.planned\([^\n]*navCtl\.speed\)\);/);
  });
});
