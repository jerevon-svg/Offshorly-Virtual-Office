// avatar/riderPose — the scooter rider's hands-on-grips pose, on EVERY real roster rig (decoded from the
// shipped GLBs by avatar/rosterGlb.testutil), and its hand-off back to ordinary animation.
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { loadRosterGlb, normaliseLikeAvatar, ROSTER_LOD0 } from "./rosterGlb.testutil";
import { RIDER_BLEND, RIDER_STANCE_LIMIT, RiderPose } from "./riderPose";
import { Avatar } from "./Avatar";
import { ControllerStack } from "./Controller";
import { PlayerMode } from "../player/PlayerMode";
import { WorldState } from "../world/WorldState";
import { RIDER_GRIPS, SCOOTER_GEOMETRY, DECK_TOP, scooterToRider } from "../world/scooters";
import { CLIP_IDLE } from "../adapters/v1Avatar";
import { vehicleGeos } from "../build/vehicles";

const IDS = Object.keys(ROSTER_LOD0);
const TOUCHED = ["Spine", "neck", "LeftArm", "LeftForeArm", "LeftHand", "RightArm", "RightForeArm", "RightHand"];
/** the largest lean ScooterMotion produces (SCOOTER.maxLean) */
const MAX_LEAN = 0.16;

const rigs = new Map<string, GLTF>();
beforeAll(async () => {
  for (const id of IDS) rigs.set(id, await loadRosterGlb(id));
}, 300000);

/** an Avatar-shaped holder: root (placed, yawed) → frame (the model group) → the normalised scene, with the
 *  mounted idle frozen on its first frame — the worst case for leaks, because the mixer never rewrites it */
function rider(id: string) {
  const gltf = rigs.get(id)!;
  // each test its own skeleton, cloned from the untouched decoded scene (as world/Coworkers clones bodies)
  const scene = cloneSkinned(gltf.scene);
  normaliseLikeAvatar(scene);
  const root = new THREE.Group(), frame = new THREE.Group();
  root.add(frame); frame.add(scene);
  root.position.set(812, DECK_TOP, -270); root.rotation.y = 2.1;
  root.updateMatrixWorld(true);
  const mixer = new THREE.AnimationMixer(scene);
  const idle = mixer.clipAction(gltf.animations.find((c) => c.name === CLIP_IDLE)!);
  idle.play(); idle.timeScale = 0; idle.time = 0;
  mixer.update(0);
  const pose = new RiderPose(frame, RIDER_GRIPS);
  pose.setScene(scene);
  const bone = (n: string) => scene.getObjectByName(n)!;
  const frameStep = (dt = 1 / 60) => { mixer.update(dt); pose.update(dt); scene.updateMatrixWorld(true); };
  return { scene, root, frame, mixer, pose, bone, frameStep };
}
/** the angle between two rotations. The clips' quaternions come from float32 data and are not exactly unit
 *  length, so they are normalised first — angleTo on a raw one reports ~4e-4 against ITSELF. */
const angle = (a: THREE.Quaternion, b: THREE.Quaternion) => a.clone().normalize().angleTo(b.clone().normalize());
const elbowDeg = (bone: (n: string) => THREE.Object3D, side: "Left" | "Right") => {
  const S = bone(`${side}Arm`).getWorldPosition(new THREE.Vector3()), E = bone(`${side}ForeArm`).getWorldPosition(new THREE.Vector3()), W = bone(`${side}Hand`).getWorldPosition(new THREE.Vector3());
  return THREE.MathUtils.radToDeg(S.sub(E).angleTo(W.sub(E)));
};

describe("scooter geometry the rider reaches for", () => {
  it("the grips the pose targets are the grips the model draws", () => {
    const g = vehicleGeos("scooter"), box = new THREE.Box3();
    for (const p of [g.paint, g.gloss, g.matte, g.lights]) if (p.attributes.position) { p.computeBoundingBox(); box.union(p.boundingBox!); }
    const { bar, gripX } = SCOOTER_GEOMETRY;
    // the bar (with its grips and caps) spans past each grip centre, at the bar's height, ahead of the deck
    expect(box.max.x).toBeGreaterThan(gripX + 2);
    expect(box.max.y).toBeCloseTo(bar.y + 1.5, 0);
    expect(RIDER_GRIPS.left).toEqual(scooterToRider({ x: -gripX, y: bar.y, z: bar.z }));
    expect(RIDER_GRIPS.left.x).toBeGreaterThan(0); // the rider's left is +x in their own frame
    expect(RIDER_GRIPS.left.y).toBeGreaterThan(11); // ~12.5 above the deck
    expect(RIDER_GRIPS.left.y).toBeLessThan(14);
  });
});

describe.each(IDS)("rider pose — %s", (id) => {
  it("both palms land on the grips, elbows bent, nothing invalid — straight, leaning, and pitched on a slope", () => {
    const r = rider(id);
    r.pose.set(true);
    // straight, at full lean either way, and PHASE 4 — pitched up a ramp / down a kerb while leaning
    for (const [lean, pitch] of [[0, 0], [MAX_LEAN, 0], [-MAX_LEAN, 0], [0, 0.1], [MAX_LEAN, -0.1], [-MAX_LEAN, 0.1]]) {
      r.pose.setLean(lean);
      r.pose.setPitch(pitch);
      for (let k = 0; k < 20; k++) r.frameStep();
      expect(r.pose.weight).toBe(1);
      expect(r.pose.stats.error.left).toBeLessThan(0.05);
      expect(r.pose.stats.error.right).toBeLessThan(0.05);
      for (const side of ["Left", "Right"] as const) {
        const e = elbowDeg(r.bone, side);
        expect(e, `${side} elbow`).toBeGreaterThan(105); // bent, never inverted into a hairpin
        expect(e, `${side} elbow`).toBeLessThan(160); //  never locked straight
      }
      for (const n of TOUCHED) {
        const q = r.bone(n).quaternion;
        expect([q.x, q.y, q.z, q.w].every(Number.isFinite), n).toBe(true);
        expect(Math.abs(q.length() - 1)).toBeLessThan(1e-6);
      }
      for (const v of [r.frame.position, r.frame.quaternion]) expect(v.toArray().every(Number.isFinite)).toBe(true);
    }
    expect(Math.abs(r.pose.stats.stance)).toBeLessThanOrEqual(RIDER_STANCE_LIMIT);
  });

  it("is steady on a frozen idle: the same pose every frame, never compounding", () => {
    const r = rider(id);
    r.pose.set(true);
    for (let k = 0; k < 20; k++) r.frameStep();
    const a = r.bone("LeftForeArm").quaternion.clone();
    for (let k = 0; k < 30; k++) r.frameStep();
    expect(angle(r.bone("LeftForeArm").quaternion, a)).toBeLessThan(1e-6);
  });

  it("dismounting hands everything back exactly: the frame at rest and the mixer's own bones", () => {
    const r = rider(id);
    const before = TOUCHED.map((n) => r.bone(n).quaternion.clone());
    for (let cycle = 0; cycle < 3; cycle++) {
      r.pose.set(true);
      r.pose.setLean(MAX_LEAN);
      for (let k = 0; k < 30; k++) r.frameStep();
      r.pose.set(false);
      // blends out over RIDER_BLEND, then lets go
      r.frameStep(RIDER_BLEND / 2);
      expect(r.pose.weight).toBeGreaterThan(0);
      for (let k = 0; k < 10; k++) r.frameStep();
      expect(r.pose.weight).toBe(0);
      expect(r.frame.position.length()).toBeLessThan(1e-9);
      expect(r.frame.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-9);
      // EXACTLY the mixer's values — even on a frozen idle, which the mixer itself never rewrites
      TOUCHED.forEach((n, i) => expect(r.bone(n).quaternion.toArray(), n).toEqual(before[i].toArray()));
    }
  });
});

describe("rider pose through the real Avatar and PlayerMode (mount → ride → dismount)", () => {
  it("freezes the idle while mounted, restores it running after, and leaves no pose behind", () => {
    const av = new Avatar({ height: 36, lit: true });
    const src = rigs.get("clang")!;
    av.adopt({ ...src, scene: cloneSkinned(src.scene) as THREE.Group });
    const stack = new ControllerStack();
    const pm = new PlayerMode({
      avatar: av, stack, world: new WorldState(), canStand: () => true, cameraProbe: () => true,
      camera: new THREE.PerspectiveCamera(), canvas: document.createElement("canvas"), overlayRoot: new THREE.Scene(),
      radius: 8, avatarHeight: 36, speed: () => 70, activate: vi.fn(() => true), canStandUp: () => false, standUp: () => {},
      yieldAvatar: vi.fn(), guided: () => false, freeLook: () => false,
    });
    expect(pm.enter()).toBe(true);
    const idleClip = av.gltf!.animations.find((c) => c.name === CLIP_IDLE)!;
    const idle = () => av.mixer!.existingAction(idleClip)!;
    const hooks = { canStand: () => true, place: vi.fn(), forceEnd: vi.fn(), deckTop: DECK_TOP };
    const frame = (n: number) => { for (let k = 0; k < n; k++) { pm.update(1 / 60); av.update(1 / 60); } };
    for (let cycle = 0; cycle < 3; cycle++) {
      expect(pm.startRide(hooks, Math.PI / 2)).toBe(true);
      frame(30);
      expect(av.ridingWeight).toBe(1);
      expect(av.currentClip).toBe(CLIP_IDLE);
      expect(idle().timeScale).toBe(0); // no sway, no walk cycle while mounted
      expect(av.riderStats.error.left).toBeLessThan(0.05);
      expect(av.riderStats.error.right).toBeLessThan(0.05);
      expect(av.root.position.y).toBe(DECK_TOP);
      expect(hooks.place).toHaveBeenCalled();
      pm.endRide({ x: 20, z: 0 });
      frame(30);
      expect(av.ridingWeight).toBe(0);
      expect(idle().timeScale).toBe(1); // the standing idle runs again
      expect(av.root.position.y).toBe(0);
      expect(av.root.children[0].position.length()).toBeLessThan(1e-9); // the model group is back at rest
      expect(av.root.children[0].quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-9);
    }
    // and the controls are untouched: a ride still steers, accelerates and ends through the same hooks
    expect(hooks.forceEnd).not.toHaveBeenCalled();
    pm.dispose();
  });

  it("the pose update is cheap (the measured per-rider cost)", () => {
    const r = rider("bon");
    r.pose.set(true);
    for (let k = 0; k < 30; k++) r.frameStep();
    const t0 = performance.now();
    const N = 2000;
    for (let k = 0; k < N; k++) r.pose.update(1 / 60);
    const perFrame = (performance.now() - t0) / N;
    // generous for CI jsdom; the reported figure comes from this same loop
    expect(perFrame).toBeLessThan(0.5);
  });
});
