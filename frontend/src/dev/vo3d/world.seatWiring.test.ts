// Phase 6C — the lines in app/world.ts that seating depends on and that no unit test can reach (they are
// closures inside createVo3dWorld, which needs WebGL). Pinned by source, the way executive.test.ts pins
// the seat-controller tick block, because the first of them WAS the accepted-then-failed bug: the world's
// sink wrapper forwarded (at, facing, yaw) and dropped `seat`, so every sit left browser A as a standing
// arrival and every other browser stood the person beside the chair.
import { describe, expect, it } from "vitest";
import src from "./app/world.ts?raw";

describe("app/world.ts seating wiring", () => {
  it("forwards the seat anchor from the feed to the V1 sink — the A/B mismatch root cause", () => {
    expect(src).toContain("arrived: (at, facing, yaw, seat) => selfMovement.arrived(toV1Frame(at), facing, yaw, seat)");
    expect(src).not.toMatch(/arrived: \(at, facing, yaw\) =>/);
  });

  it("tells the feed when the body sits and when it stands, with the CHAIR's own yaw", () => {
    expect(src).toContain("selfFeed?.seated({ x: bp.x, z: bp.z }, seatedYawOf(currentSeatAnchor) ?? avatar.yaw, currentSeatAnchor)");
    expect(src).toContain("selfFeed?.stood({ x: bp.x, z: bp.z }, avatar.yaw)");
  });

  it("every sit starter records the anchor the feed will publish", () => {
    const starters = [...src.matchAll(/function start(\w+)Sit\(/g)].map((m) => m[1]);
    expect(starters.length).toBeGreaterThanOrEqual(9);
    for (const name of starters) {
      const body = src.slice(src.indexOf(`function start${name}Sit(`));
      const end = body.indexOf("\n  }\n");
      expect(body.slice(0, end), `start${name}Sit sets currentSeatAnchor`).toContain("currentSeatAnchor = ");
    }
  });

  it("every movable chair and every fixed cushion is sittable: generic fallbacks exist and are ticked", () => {
    expect(src).toContain("if (world.entities.has(id) && world.get(id).capabilities.seat) { startOtherSit(id); return true; }");
    expect(src).toContain("otherSeat?.update(dt / 1000);");
    expect(src).toContain("restoredSeat?.update(dt / 1000);");
    expect(src).toContain("restoredLounge?.update(dt / 1000);");
    expect(src).toContain("const unlistedLoungeIds = [...world.entities.values()].filter((e) => e.capabilities.lounge && !listedLoungeIds.has(e.id)).map((e) => e.id);");
    expect(src).toMatch(/loungeSeats = \[[^\]]*\.\.\.unlistedLoungeIds\]/);
  });

  it("every seated yaw comes from the configured facing: local interactions, peer poses, the published yaw", () => {
    // no interaction is ever handed the raw authored spec
    expect(src).not.toMatch(/new SeatInteraction\([^\n]*capabilities\.seat!/);
    expect(src).not.toMatch(/new LoungeSeatInteraction\([^\n]*s\.slot,/);
    expect((src.match(/new SeatInteraction\([^\n]*seatSpecFor\(/g) ?? []).length).toBeGreaterThanOrEqual(12);
    expect((src.match(/new LoungeSeatInteraction\([^\n]*slotFor\(/g) ?? []).length).toBe(2);
    expect(src).toContain('yaw: seatedYawFor(id, spec.seatedYaw), kind: "seat"');
    expect(src).toContain('yaw: seatedYawFor(id, slot.seatedYaw), kind: "lounge"');
    expect(src).toContain("return authored === undefined ? null : seatedYawFor(anchor, authored);");
    // the dev tool, and its project save
    expect(src).toContain('gui.addFolder("Seat facing (front / back / left / right)")');
    expect(src).toContain("__vo3d/seat-facing");
    expect(src).toContain("coworkers.reposeSeated(id)");
  });

  it("the click picker takes the first INTERACTABLE hit, not the first hit", () => {
    expect(src).toContain("for (const hit of hits) {");
    expect(src).not.toContain("for (let n: THREE.Object3D | null = hits[0].object; n; n = n.parent) {");
  });

  it("peers sit on this world's chairs, and an Office View chair click sits", () => {
    expect(src).toContain("seatAnchor: peerSeatAnchor");
    expect(src).toContain("releaseSeat: releasePeerSeat");
    expect(src).toContain('else if (ent.capabilities.seat) activateInteractable(picked, "seat");');
  });
});
