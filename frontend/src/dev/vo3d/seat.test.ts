import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { Avatar } from "./avatar/Avatar";
import { ControllerStack, NavigationController } from "./avatar/Controller";
import { SeatInteraction } from "./interact/Seat";
import { WorldState } from "./world/WorldState";
import { DESIGN_ROOM, CHAIR_4_ID, designRoomEntities } from "./rooms/design-room";

function rig() {
  const w = new WorldState(); w.addRoom(DESIGN_ROOM); for (const e of designRoomEntities()) w.addEntity(e);
  const chairE = w.get(CHAIR_4_ID); const spec = chairE.capabilities.seat!;
  const scene = new THREE.Object3D(); const chair = new THREE.Object3D(); chair.position.set(chairE.transform.pos.x, 0, chairE.transform.pos.z); scene.add(chair);
  const av = new Avatar({ height: 36, lit: true }); scene.add(av.root); av.setPosition({ x: spec.approach.x + 95, z: spec.approach.z });
  const stack = new ControllerStack(); const nav = new NavigationController(av, stack);
  const seat = new SeatInteraction(av, stack, chair, spec, (to) => ({ ok: true, destination: to, path: [to], cell: { cx: 11, cy: 31 } }));
  const run = (s: number) => { for (let t = 0; t < s; t += 1 / 60) { seat.update(1 / 60); nav.update(1 / 60); } };
  return { w, spec, scene, chair, av, stack, nav, seat, run, rest: chair.position.clone() };
}

describe("vo3d seat interaction (design-member-chair-4)", () => {
  it("runs sit → seated (attached, tucked 7) → stand → idle with the chair restored EXACTLY and ownership released", () => {
    const { spec, scene, chair, av, stack, seat, run, rest } = rig();
    expect(seat.sit()?.ok).toBe(true); expect(stack.owner).toBe("Interaction");
    let maxStep = 0, prev = av.worldPosition(), maxPull = 0;
    for (let t = 0; t < 15 && seat.state !== "seated"; t += 1 / 60) { seat.update(1 / 60); scene.updateMatrixWorld(true); const p = av.worldPosition(); maxStep = Math.max(maxStep, p.distanceTo(prev)); prev = p; maxPull = Math.max(maxPull, chair.position.distanceTo(rest)); }
    expect(seat.state).toBe("seated");
    expect(maxStep).toBeLessThan(1.6); // no teleport
    expect(maxPull).toBeCloseTo(spec.pullDistance, 3);
    expect(chair.position.distanceTo(rest)).toBeCloseTo(spec.seatedTuck, 6);
    expect(av.root.parent).toBe(chair);
    expect(av.currentClip === null || av.currentClip === "sit-on-chair-arms").toBe(true); // no GLB in tests → clips are no-ops
    seat.stand(); run(15);
    expect(seat.state).toBe("idle"); expect(stack.owner).toBe("Idle"); expect(av.root.parent).toBe(scene);
    expect(chair.position.distanceTo(rest)).toBeLessThan(1e-9); expect(seat.chairRestError()).toBeLessThan(1e-6);
    expect(av.root.position.x).toBeCloseTo(spec.approach.x, 6); expect(av.root.position.z).toBeCloseTo(spec.approach.z, 6);
  });
  it("5 cycles: zero drift; sit/stand refused in the wrong state; navigation cannot steal the avatar while seated", () => {
    const { chair, av, stack, nav, seat, run, rest } = rig();
    for (let i = 0; i < 5; i++) {
      expect(seat.sit()?.ok).toBe(true); expect(seat.sit()).toBeNull(); run(15); expect(seat.state).toBe("seated");
      expect(nav.setPath([{ x: 0, z: 0 }])).toBe(false); expect(stack.owner).toBe("Interaction");
      seat.stand(); run(15); expect(seat.state).toBe("idle");
    }
    expect(chair.position.distanceTo(rest)).toBeLessThan(1e-9);
    expect(av.root.position.distanceTo(new THREE.Vector3(av.position.x, 0, av.position.z))).toBeLessThan(1e-9);
    seat.stand(); expect(seat.state).toBe("idle");
    expect(nav.setPath([{ x: 0, z: 0 }])).toBe(true); // free again
  });
  it("reset mid-interaction restores the chair and releases ownership", () => {
    const { chair, stack, seat, run, rest } = rig();
    seat.sit(); run(3); expect(seat.state).not.toBe("idle");
    seat.reset(); expect(seat.state).toBe("idle"); expect(chair.position.distanceTo(rest)).toBeLessThan(1e-9); expect(stack.owner).toBe("Idle");
  });
});
