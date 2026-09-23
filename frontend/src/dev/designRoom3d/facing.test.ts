import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { Avatar, type Ground } from "./avatar";
import { planWalk } from "./nav";
import { DynamicNav } from "./edit";
import { CHAIR_4_SPEC, SeatInteraction } from "./sit";

// Regression: the avatar's FORWARD vector must match its actual X/Z displacement on every
// leg, for production paths, DynamicNav paths, after re-parenting (chair ride), and after
// a full sit/stand cycle. Forward = the model's +z axis rotated by the root (getWorldDirection).
const fwd = new THREE.Vector3();
function forwardXZ(o: THREE.Object3D): { x: number; z: number } {
  o.updateMatrixWorld(true);
  o.getWorldDirection(fwd);
  return { x: fwd.x, z: fwd.z };
}
/** Walk the queue to completion, asserting on every frame that forward ≈ displacement (after the turn settles). */
function walkAndCheck(av: Avatar, label: string): void {
  let settle = 0;
  for (let i = 0; i < 4000 && av.moving; i++) {
    const before = av.root.getWorldPosition(new THREE.Vector3());
    av.stepPath(1 / 60, true);
    const after = av.root.getWorldPosition(new THREE.Vector3());
    const dx = after.x - before.x, dz = after.z - before.z, len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const f = forwardXZ(av.root);
    const dot = (f.x * dx + f.z * dz) / len; // cosine between forward and movement
    if (dot > 0.98) settle = 0;
    else settle++;
    // a corner takes ≤ ~0.5 s (heading turns at 7 rad/s); anything longer is a real facing bug
    expect(settle, `${label}: facing away from movement for >0.5s (cos=${dot.toFixed(2)} at ${after.x.toFixed(0)},${after.z.toFixed(0)})`).toBeLessThan(30);
  }
}
function place(av: Avatar, p: Ground): void {
  av.root.position.set(p.x, 0, p.z);
}
const LEGS: [string, Ground, Ground][] = [
  ["north", { x: 270.5, z: 190 }, { x: 270.5, z: 56 }],
  ["south", { x: 270.5, z: 56 }, { x: 270.5, z: 190 }],
  ["east", { x: 40, z: 56 }, { x: 290, z: 56 }],
  ["west", { x: 290, z: 56 }, { x: 40, z: 56 }],
  ["diagonal", { x: 290, z: 56 }, { x: 200, z: 125 }],
];

describe("avatar faces its movement direction", () => {
  it("production paths: north/south/east/west/diagonal", () => {
    const av = new Avatar({ height: 36, lit: true });
    for (const [label, from, to] of LEGS) {
      place(av, from);
      const r = planWalk(from, to);
      expect(r.ok, label).toBe(true);
      if (r.ok) { av.setPath(r.path); walkAndCheck(av, `production ${label}`); }
    }
  });

  it("DynamicNav paths (plant on column 17) including the forced detour", () => {
    const dyn = new DynamicNav();
    dyn.setObstacle("plant", { x: 270.5, z: 125 }, 8);
    const av = new Avatar({ height: 36, lit: true });
    for (const [label, from, to] of LEGS) {
      place(av, from);
      const r = planWalk(from, to, dyn);
      expect(r.ok, label).toBe(true);
      if (r.ok) { av.setPath(r.path); walkAndCheck(av, `dynamic ${label}`); }
    }
  });

  it("after a chair ride (attach at yaw π → detach) the avatar still faces north when walking north", () => {
    const scene = new THREE.Object3D(), chair = new THREE.Object3D();
    scene.add(chair);
    const av = new Avatar({ height: 36, lit: true });
    scene.add(av.root);
    place(av, { x: 270.5, z: 190 });
    av.heading = Math.PI; // seated facing north, exactly π — the Euler-decomposition edge case
    av.root.rotation.y = av.heading;
    chair.attach(av.root);
    scene.attach(av.root);
    const r = planWalk({ x: 270.5, z: 190 }, { x: 270.5, z: 56 });
    expect(r.ok).toBe(true);
    if (r.ok) { av.setPath(r.path); walkAndCheck(av, "post-attach north"); }
    const r2 = planWalk(av.position, { x: 270.5, z: 190 });
    if (r2.ok) { av.setPath(r2.path); walkAndCheck(av, "post-attach south"); }
  });

  it("after a full sit → stand cycle through SeatInteraction, walking in every direction faces correctly", () => {
    const scene = new THREE.Object3D(), chair = new THREE.Object3D();
    chair.position.set(155.3, 0, 171.7);
    scene.add(chair);
    const av = new Avatar({ height: 36, lit: true });
    scene.add(av.root);
    place(av, { x: 270, z: 190 });
    const seat = new SeatInteraction(av, chair, CHAIR_4_SPEC, (to) => ({ ok: true, destination: to, path: [{ x: 270, z: 187.8 }, to], cell: { cx: 11, cy: 31 } }));
    expect(seat.sit()?.ok).toBe(true);
    for (let t = 0; t < 15 && seat.state !== "seated"; t += 1 / 60) { seat.update(1 / 60); av.update(1 / 60); }
    expect(seat.state).toBe("seated");
    seat.stand();
    for (let t = 0; t < 15 && seat.state !== "idle"; t += 1 / 60) { seat.update(1 / 60); av.update(1 / 60); }
    expect(seat.state).toBe("idle");
    for (const [label, , to] of LEGS) {
      const r = planWalk(av.position, to);
      expect(r.ok, label).toBe(true);
      if (r.ok) { av.setPath(r.path); walkAndCheck(av, `post-sit ${label}`); }
    }
  });
});
