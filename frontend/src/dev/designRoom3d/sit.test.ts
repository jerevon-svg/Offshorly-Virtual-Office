import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CELL, isWalkable } from "../../data/officeGrid";
import { FURNITURE } from "./layout";
import { pointInRect, type Ground } from "./avatar";
import { groundToFrameCentre, planWalk } from "./nav";
import { CHAIR_4_SPEC, SeatInteraction, type SeatSpec } from "./sit";

const chairRect = FURNITURE.find((f) => f.id === CHAIR_4_SPEC.chairId)!.rect;
const deskRect = FURNITURE.find((f) => f.id === "design-member-desk-center")!.rect;

// Minimal stand-in for the Avatar surface the controller uses (no GLB, no mixer).
function fakeAvatar(start: Ground) {
  const root = new THREE.Object3D();
  root.position.set(start.x, 0, start.z);
  const clips: string[] = [];
  const av = {
    root,
    heading: 0,
    mode: "free" as "free" | "controlled",
    walkOverride: "auto" as "auto" | "idle" | "walk",
    playing: true,
    path: [] as Ground[],
    gltf: null,
    setPath(p: Ground[]) { this.path = [...p]; },
    get moving() { return this.path.length > 0; },
    play(name: string) { clips.push(name); },
    stepPath(dt: number) {
      let remaining = 30 * dt;
      while (remaining > 0 && this.path.length > 0) {
        const t = this.path[0];
        const dx = t.x - root.position.x, dz = t.z - root.position.z, dist = Math.hypot(dx, dz);
        if (dist <= remaining) { root.position.set(t.x, 0, t.z); remaining -= dist; this.path.shift(); }
        else { root.position.x += (dx / dist) * remaining; root.position.z += (dz / dist) * remaining; remaining = 0; }
      }
    },
    clips,
  };
  return av;
}

function run(seat: SeatInteraction, seconds: number, dt = 1 / 60): void {
  for (let t = 0; t < seconds; t += dt) seat.update(dt);
}

describe("chair pull + sit + stand proof (design-member-chair-4)", () => {
  it("uses the production stand-here cell as approach/exit and a pull that clears the desk", () => {
    const f = groundToFrameCentre(CHAIR_4_SPEC.approach);
    const cx = Math.floor(f.x / CELL), cy = Math.floor(f.y / CELL);
    expect([cx, cy]).toEqual([11, 31]);
    expect(isWalkable(cx, cy)).toBe(true);
    // pulled chair front edge clears the desk's south edge by > 8 units (room to step in)
    const pulledFrontZ = chairRect.z + CHAIR_4_SPEC.pullDistance;
    expect(pulledFrontZ - (deskRect.z + deskRect.d)).toBeGreaterThan(8);
    // pre-seat point lies in that gap, over neither the desk nor the pulled chair
    const ps = CHAIR_4_SPEC.preSeat;
    expect(pointInRect(ps.x, ps.z, deskRect)).toBe(false);
    expect(pointInRect(ps.x, ps.z, { ...chairRect, z: chairRect.z + CHAIR_4_SPEC.pullDistance })).toBe(false);
    // the production A* can reach the approach point from the entrance
    expect(planWalk({ x: 298, z: 125 }, CHAIR_4_SPEC.approach).ok).toBe(true);
  });

  it("runs a full sit → seated → stand cycle, restoring the chair EXACTLY and never teleporting Bon", () => {
    const chair = new THREE.Object3D();
    chair.position.set(chairRect.x + chairRect.w / 2, 0, chairRect.z + chairRect.d / 2);
    const scene = new THREE.Object3D();
    scene.add(chair);
    const av = fakeAvatar({ x: 270, z: 190 });
    scene.add(av.root);
    const rest = chair.position.clone();
    const seat = new SeatInteraction(av as never, chair, CHAIR_4_SPEC, (to) => ({ ok: true, destination: to, path: [{ x: 270, z: 187.8 }, to], cell: { cx: 11, cy: 31 } }));
    expect(seat.sit()?.ok).toBe(true);
    expect(av.mode).toBe("controlled");
    const world = () => av.root.getWorldPosition(new THREE.Vector3());
    let prev = world(), maxStep = 0, maxPull = 0;
    for (let t = 0; t < 12 && seat.state !== "seated"; t += 1 / 60) {
      seat.update(1 / 60);
      scene.updateMatrixWorld(true);
      const w = world();
      maxStep = Math.max(maxStep, w.distanceTo(prev)); // WORLD-space step (root is re-parented into the chair while riding)
      prev = w;
      maxPull = Math.max(maxPull, chair.position.distanceTo(rest));
    }
    expect(seat.state).toBe("seated");
    expect(maxStep).toBeLessThan(1.6); // ≤ ~1 unit/frame glide peak — no teleport (a teleport would be 10-20 units)
    expect(maxPull).toBeCloseTo(CHAIR_4_SPEC.pullDistance, 3);
    expect(av.root.parent).toBe(chair); // riding the chair
    expect(chair.position.distanceTo(rest)).toBeCloseTo(CHAIR_4_SPEC.seatedTuck, 6); // parked seatedTuck short of rest while occupied
    expect(av.clips).toContain("sit-on-chair-arms");
    // seated world position sits on/over the chair footprint
    const w = av.root.getWorldPosition(new THREE.Vector3());
    expect(pointInRect(w.x, w.z, { ...chairRect, x: chairRect.x - 4, w: chairRect.w + 8, z: chairRect.z - 4, d: chairRect.d + 8 })).toBe(true);

    seat.stand();
    run(seat, 12);
    expect(seat.state).toBe("idle");
    expect(av.mode).toBe("free");
    expect(av.root.parent).toBe(scene);
    expect(chair.position.distanceTo(rest)).toBeLessThan(1e-9);
    expect(seat.chairRestError()).toBeLessThan(1e-6);
    expect(av.root.position.x).toBeCloseTo(CHAIR_4_SPEC.approach.x, 6);
    expect(av.root.position.z).toBeCloseTo(CHAIR_4_SPEC.approach.z, 6);
    expect(av.root.position.y).toBeCloseTo(0, 6);
  });

  it("does not drift across repeated cycles and rejects sit/stand in the wrong state", () => {
    const chair = new THREE.Object3D();
    chair.position.set(chairRect.x + chairRect.w / 2, 0, chairRect.z + chairRect.d / 2);
    const scene = new THREE.Object3D();
    scene.add(chair);
    const av = fakeAvatar(CHAIR_4_SPEC.approach);
    scene.add(av.root);
    const rest = chair.position.clone();
    const seat = new SeatInteraction(av as never, chair, CHAIR_4_SPEC, (to) => ({ ok: true, destination: to, path: [to], cell: { cx: 11, cy: 31 } }));
    for (let i = 0; i < 5; i++) {
      expect(seat.sit()?.ok).toBe(true);
      expect(seat.sit()).toBeNull(); // already in progress
      run(seat, 8);
      expect(seat.state).toBe("seated");
      seat.stand();
      run(seat, 8);
      expect(seat.state).toBe("idle");
    }
    expect(chair.position.distanceTo(rest)).toBeLessThan(1e-9);
    expect(av.root.position.distanceTo(new THREE.Vector3(CHAIR_4_SPEC.approach.x, 0, CHAIR_4_SPEC.approach.z))).toBeLessThan(1e-6);
    seat.stand(); // no-op when idle
    expect(seat.state).toBe("idle");
  });

  it("reset() mid-interaction restores the chair and frees the avatar", () => {
    const chair = new THREE.Object3D();
    const scene = new THREE.Object3D();
    scene.add(chair);
    const av = fakeAvatar(CHAIR_4_SPEC.approach);
    scene.add(av.root);
    const spec: SeatSpec = { ...CHAIR_4_SPEC };
    const seat = new SeatInteraction(av as never, chair, spec, (to) => ({ ok: true, destination: to, path: [to], cell: { cx: 11, cy: 31 } }));
    seat.sit();
    run(seat, 2.5); // somewhere in pullingOut / sitting
    expect(seat.state).not.toBe("idle");
    seat.reset();
    expect(seat.state).toBe("idle");
    expect(seat.chairRestError()).toBeLessThan(1e-9);
    expect(av.mode).toBe("free");
    expect(av.root.parent).toBe(scene);
  });
});
