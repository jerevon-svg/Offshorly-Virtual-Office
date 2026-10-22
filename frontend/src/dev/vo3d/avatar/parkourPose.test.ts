import { beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { loadRosterGlb, normaliseLikeAvatar, ROSTER_LOD0 } from "./rosterGlb.testutil";
import { loadHumanGlb } from "../human/humanGlb.testutil";
import { findRig } from "./gaitPose";
import { PARKOUR_MS, ParkourPose, type ParkourMove } from "./parkourPose";

// PARKOUR V1 — THE ARTICULATED FLIP, ROLL AND ABSORB, on REAL rigs: the shared HumanBase body and two legacy roster
// characters. What is held: the body changes SHAPE (knees to the chest in the tuck, hips down over planted feet in
// the absorb and the roll's crouch), the roll turns about a diagonal and never goes into the floor, every joint
// stays inside its limits, and the clip's own pose is back exactly when the move ends or is cut short.

const H = 36;
const RIGS = ["humanbase", ...Object.keys(ROSTER_LOD0).slice(0, 2)];
const glbs = new Map<string, GLTF>();
beforeAll(async () => {
  for (const id of RIGS) glbs.set(id, id === "humanbase" ? await loadHumanGlb("avatars/human-base-v1/human-base.glb") : await loadRosterGlb(id));
}, 300000);

/** root (placed, yawed) → the parkour wrapper → the model frame → the normalised scene, exactly as avatar/Avatar */
function holder(id: string) {
  const scene = cloneSkinned(glbs.get(id)!.scene);
  normaliseLikeAvatar(scene, H);
  const root = new THREE.Group(), frame = new THREE.Group();
  const pose = new ParkourPose(H);
  root.add(pose.node);
  pose.node.add(frame);
  frame.add(scene);
  root.position.set(120, 0, -40);
  root.rotation.y = 0.8;
  root.updateMatrixWorld(true);
  pose.setScene(scene);
  const rig = findRig(scene)!;
  const rest = rig.bones.map((b) => b.quaternion.clone());
  return { scene, root, pose, rig, rest };
}

const wp = (o: THREE.Object3D): THREE.Vector3 => { o.updateMatrixWorld(true); return o.getWorldPosition(new THREE.Vector3()); };
function play(pose: ParkourPose, move: ParkourMove, toMs: number, each?: () => void): void {
  pose.start(move);
  for (let ms = 0; ms < toMs; ms += 1000 / 60) { pose.update(1 / 60); each?.(); }
}
/** the knee's bend: the angle between the thigh and the shin, 0 = a straight leg */
function kneeBend(rig: ReturnType<typeof findRig> & object): number {
  const hip = wp(rig.thighs[0]), knee = wp(rig.shins[0]), foot = wp(rig.feet[0]);
  return knee.clone().sub(hip).angleTo(foot.clone().sub(knee));
}
const lowestFoot = (rig: ReturnType<typeof findRig> & object): number => Math.min(...rig.feet.map((f) => wp(f).y));
const hips = (rig: ReturnType<typeof findRig> & object): THREE.Object3D => rig.thighs[0].parent!;
/** EXACTLY the clip's pose again (component-wise: these rigs' quaternions are float32 data, not quite unit length,
 *  so an angle between two identical ones reads ~4e-4 rather than 0) */
const restored = (h: ReturnType<typeof holder>): boolean =>
  h.rig.bones.every((b, i) => Math.max(Math.abs(b.quaternion.x - h.rest[i].x), Math.abs(b.quaternion.y - h.rest[i].y), Math.abs(b.quaternion.z - h.rest[i].z), Math.abs(b.quaternion.w - h.rest[i].w)) < 1e-9);
const turnOf = (pose: ParkourPose): number => 2 * Math.acos(Math.min(1, Math.abs(pose.node.quaternion.w)));

describe.each(RIGS)("parkour pose on %s", (id) => {
  it("finds the standard chain, so the body can be articulated", () => {
    expect(holder(id).pose.articulated).toBe(true);
  });

  it("THE FLIP TUCKS: knees bend hard and come up to the chest while the body turns forward", () => {
    const h = holder(id);
    const restBend = kneeBend(h.rig);
    const restKneeToNeck = wp(h.rig.shins[0]).distanceTo(wp(h.rig.neck ?? h.rig.spines[0]));
    let tucked = { bend: 0, gap: Infinity, turn: 0 };
    play(h.pose, "flip", PARKOUR_MS.flip * 0.45, () => {
      tucked = { bend: kneeBend(h.rig), gap: wp(h.rig.shins[0]).distanceTo(wp(h.rig.neck ?? h.rig.spines[0])), turn: turnOf(h.pose) };
    });
    expect(tucked.bend - restBend).toBeGreaterThan(1.2); // the knee is folded, not a straight leg spun round
    expect(tucked.bend).toBeLessThan(2.45); //           …and never past a human knee
    expect(tucked.gap).toBeLessThan(restKneeToNeck * 0.8); // the knees are drawn up toward the chest
    expect(tucked.turn).toBeGreaterThan(Math.PI * 0.4); //   mid-rotation
  });

  it("THE FLIP UNTUCKS before it lands and gives the clip its pose back exactly", () => {
    const h = holder(id);
    let lateBend = 0;
    play(h.pose, "flip", PARKOUR_MS.flip * 0.93, () => { lateBend = kneeBend(h.rig); });
    expect(lateBend).toBeLessThan(1.0); // the legs are reaching for the floor again, only a little bent
    for (let i = 0; i < 30; i++) h.pose.update(1 / 60);
    expect(h.pose.active).toBeNull();
    expect(restored(h)).toBe(true);
    expect(h.pose.node.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6);
  });

  it("THE ABSORB: hips come down over feet that stay planted", () => {
    const h = holder(id);
    const foot0 = lowestFoot(h.rig), hip0 = wp(hips(h.rig)).y;
    let at = { foot: 0, hip: 0, bend: 0 };
    play(h.pose, "land", PARKOUR_MS.land * 0.32, () => { at = { foot: lowestFoot(h.rig), hip: wp(hips(h.rig)).y, bend: kneeBend(h.rig) }; });
    expect(Math.abs(at.foot - foot0)).toBeLessThan(0.4);
    expect(hip0 - at.hip).toBeGreaterThan(2);
    expect(at.bend).toBeGreaterThan(0.6);
  });

  /** the roll's frame-by-frame record: feet, hips, lowest joint, forearms, and the wrapper's turn axis */
  function rollTrace(h: ReturnType<typeof holder>, ms: number) {
    const floor = h.root.position.y;
    const out: { t: number; foot: number; hip: number; low: number; lead: number; trail: number; axisZ: number; turn: number }[] = [];
    let t = 0;
    play(h.pose, "roll", ms * 0.98, () => {
      t += 1000 / 60;
      const joints = [...h.rig.feet, ...h.rig.shins, ...h.rig.fores, ...h.rig.thighs].map((b) => wp(b).y);
      if (h.rig.neck) joints.push(wp(h.rig.neck).y - H * 0.14);
      const q = h.pose.node.quaternion, sn = Math.sqrt(Math.max(0, 1 - q.w * q.w));
      out.push({
        t: t / ms, foot: lowestFoot(h.rig) - floor, hip: wp(hips(h.rig)).y - floor, low: Math.min(...joints) - floor,
        lead: wp(h.rig.fores[0]).y - floor, trail: wp(h.rig.fores[1]).y - floor,
        axisZ: sn > 1e-6 ? Math.abs(q.z / sn) : 0, turn: turnOf(h.pose),
      });
    });
    return out;
  }

  it("THE ROLL, A — IMPACT: a deep crouch over feet that stay where they landed", () => {
    const h = holder(id);
    const foot0 = lowestFoot(h.rig) - h.root.position.y, hip0 = wp(hips(h.rig)).y - h.root.position.y;
    const a = rollTrace(h, PARKOUR_MS.roll).filter((f) => f.t > 0.13 && f.t < 0.18);
    expect(a.length).toBeGreaterThan(0);
    for (const f of a) {
      expect(Math.abs(f.foot - foot0)).toBeLessThan(0.45);
      expect(hip0 - f.hip).toBeGreaterThan(hip0 * 0.25); // the centre of mass goes well down (a quarter of hip height)
    }
  });

  it("THE ROLL, B+C — onto the LEAD shoulder and diagonally across the back, held low and in contact with the floor", () => {
    const h = holder(id);
    const trace = rollTrace(h, PARKOUR_MS.roll);
    const entry = trace.filter((f) => f.t > 0.26 && f.t < 0.34);
    for (const f of entry) expect(f.lead).toBeLessThan(f.trail - 1); //    the lead arm goes down first: asymmetric
    const roll = trace.filter((f) => f.t > 0.38 && f.t < 0.7);
    expect(roll.length).toBeGreaterThan(5);
    for (const f of roll) {
      expect(f.low).toBeGreaterThan(-0.3); //  never into the floor…
      // …and never lifted off it: ground contact all the way (these are JOINT heights: a joint ~1.7 above the floor is
      // the limb's own surface on it — the layer holds its padded lowest point 0.6 over the floor)
      expect(f.low).toBeLessThan(2.4);
      // the body stays low: even at the top of the revolution, where the hips pass over the shoulder as they do in a
      // real roll, they stay near half the standing height (a flip carries them a body's height into the air)
      expect(f.hip).toBeLessThan(H * 0.55);
    }
    // diagonal: the turn axis carries a large forward component (a flip's is purely side-to-side)
    expect(Math.max(...roll.map((f) => f.axisZ))).toBeGreaterThan(0.4);
  });

  it("THE ROLL, D — recovery: feet back under the body, up, and the clip's pose back exactly", () => {
    const h = holder(id);
    const foot0 = lowestFoot(h.rig) - h.root.position.y;
    const d = rollTrace(h, PARKOUR_MS.roll).filter((f) => f.t > 0.82);
    for (const f of d) expect(Math.abs(f.foot - foot0)).toBeLessThan(0.45);
    expect(d[d.length - 1].turn).toBeLessThan(0.05); // upright again
    for (let i = 0; i < 30; i++) h.pose.update(1 / 60);
    expect(h.pose.active).toBeNull();
    expect(restored(h)).toBe(true);
  });

  it("THE FLIP AND THE ROLL ARE DIFFERENT MOVEMENTS: a symmetric side-to-side pitch vs a banked, asymmetric, diagonal roll", () => {
    const f = holder(id);
    let flip = { axisZ: 0, asym: 0 };
    play(f.pose, "flip", PARKOUR_MS.flip * 0.5, () => {
      const q = f.pose.node.quaternion, sn = Math.sqrt(Math.max(0, 1 - q.w * q.w));
      flip = { axisZ: sn > 1e-6 ? Math.abs(q.z / sn) : 0, asym: Math.abs(wp(f.rig.fores[0]).y - wp(f.rig.fores[1]).y) };
    });
    const r = rollTrace(holder(id), PARKOUR_MS.roll).find((x) => x.t > 0.5)!;
    expect(flip.axisZ).toBeLessThan(0.05);
    expect(r.axisZ).toBeGreaterThan(0.4);
    expect(flip.asym).toBeLessThan(1.0);
  });

  it("a roll lasts exactly as long as it is asked to (its published travel takes that long), within bounds", () => {
    const h = holder(id);
    h.pose.start("roll", 950);
    let ms = 0;
    while (h.pose.active && ms < 3000) { h.pose.update(1 / 60); ms += 1000 / 60; }
    expect(ms).toBeGreaterThan(930);
    expect(ms).toBeLessThan(990);
    h.pose.start("roll", 99999);
    ms = 0;
    while (h.pose.active && ms < 3000) { h.pose.update(1 / 60); ms += 1000 / 60; }
    expect(ms).toBeLessThan(1020); // clamped to ROLL_MS_RANGE.max
  });

  it("CANCELLED mid-move (a seat, a ride, a handoff): upright and back to the clip at once", () => {
    const h = holder(id);
    play(h.pose, "flip", PARKOUR_MS.flip * 0.5);
    expect(restored(h)).toBe(false);
    h.pose.cancel();
    expect(restored(h)).toBe(true);
    expect(h.pose.node.position.length()).toBe(0);
    expect(h.pose.node.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-9);
  });

  it("never writes a NaN into a bone or the wrapper, through every move", () => {
    const h = holder(id);
    for (const move of ["flip", "roll", "land"] as const) {
      play(h.pose, move, PARKOUR_MS[move] + 50, () => {
        for (const b of h.rig.bones) expect(Number.isFinite(b.quaternion.w)).toBe(true);
        expect(Number.isFinite(h.pose.node.position.y)).toBe(true);
      });
    }
  });
});

// PARKOUR V2 — THE VAULT AND THE MANTLE, on the same real rigs: articulated limb by limb (hands planted / reaching,
// hips and knees drawn up, a lead knee onto the top), never a rigid body slid over the obstacle.
const bendOf = (rig: ReturnType<typeof findRig> & object, i: number): number => {
  const hip = wp(rig.thighs[i]), knee = wp(rig.shins[i]), foot = wp(rig.feet[i]);
  return knee.clone().sub(hip).angleTo(foot.clone().sub(knee));
};
/** how far a bone has turned from the clip's pose, radians. (The arms are measured as joint rotation, not hand
 *  position: these rigs' bind pose holds the arms out in a T/A, unlike the idle frame the game poses over.) */
const turned = (h: ReturnType<typeof holder>, bone: THREE.Object3D): number => {
  const q = h.rest[h.rig.bones.indexOf(bone as THREE.Bone)];
  return 2 * Math.acos(Math.min(1, Math.abs(bone.quaternion.clone().normalize().dot(q.clone().normalize()))));
};
function playTo(pose: ParkourPose, move: ParkourMove, ms: number, frac: number, each?: () => void): void {
  pose.start(move, ms);
  for (let t = 0; t < ms * frac; t += 1000 / 60) { pose.update(1 / 60); each?.(); }
}

describe.each(RIGS)("parkour V2 pose on %s", (id) => {
  it("THE VAULT: hands reach forward for the top, then hips and knees draw up with the body banked over the planted hand", () => {
    const h = holder(id);
    const rest = { bend0: bendOf(h.rig, 0), bend1: bendOf(h.rig, 1) };
    playTo(h.pose, "vault", 650, 0.16);
    expect(turned(h, h.rig.arms[0])).toBeGreaterThan(0.6); // both arms swing forward to the top
    expect(turned(h, h.rig.arms[1])).toBeGreaterThan(0.6);
    playTo(h.pose, "vault", 650, 0.4);
    expect(bendOf(h.rig, 0) - rest.bend0).toBeGreaterThan(1.0);
    expect(bendOf(h.rig, 1) - rest.bend1).toBeGreaterThan(1.0);
    expect(bendOf(h.rig, 0)).toBeLessThan(2.45);
    expect(turnOf(h.pose)).toBeGreaterThan(0.3); // banked (and pitched) about the hips
  });

  it("THE VAULT LANDS under control: the hips come down over planted feet, then the clip's pose is back exactly", () => {
    const h = holder(id);
    const restHip = wp(hips(h.rig)).y, restFoot = lowestFoot(h.rig);
    playTo(h.pose, "vault", 650, 0.86);
    expect(wp(hips(h.rig)).y).toBeLessThan(restHip - H * 0.04);
    expect(Math.abs(lowestFoot(h.rig) - restFoot)).toBeLessThan(H * 0.02);
    while (h.pose.active) h.pose.update(1 / 60);
    expect(restored(h)).toBe(true);
    expect(turnOf(h.pose)).toBeLessThan(1e-9);
  });

  it("THE MANTLE: arms reach up to grip, then the elbows bend to pull, then the LEAD knee comes up onto the top", () => {
    const h = holder(id);
    playTo(h.pose, "mantle", 850, 0.16);
    for (const i of [0, 1]) expect(turned(h, h.rig.arms[i])).toBeGreaterThan(1.5); // the reach: shoulders well up
    playTo(h.pose, "mantle", 850, 0.42);
    for (const i of [0, 1]) expect(turned(h, h.rig.fores[i])).toBeGreaterThan(1.2); // the pull: elbows bent
    playTo(h.pose, "mantle", 850, 0.62);
    expect(bendOf(h.rig, 0) - bendOf(h.rig, 1)).toBeGreaterThan(0.6); // asymmetric: one knee up, one leg trailing
    while (h.pose.active) h.pose.update(1 / 60);
    expect(restored(h)).toBe(true);
  });

  it("a late start picks the move up part-way through; durations stay in their bounds; never a NaN", () => {
    const h = holder(id);
    h.pose.start("mantle", 850, 600);
    let ms = 0;
    while (h.pose.active && ms < 3000) { h.pose.update(1 / 60); ms += 1000 / 60; }
    expect(ms).toBeLessThan(300);
    for (const move of ["vault", "mantle"] as const) {
      h.pose.start(move, 99999);
      ms = 0;
      while (h.pose.active && ms < 3000) {
        h.pose.update(1 / 60);
        ms += 1000 / 60;
        for (const b of h.rig.bones) expect(Number.isFinite(b.quaternion.w)).toBe(true);
        expect(Number.isFinite(h.pose.node.position.y)).toBe(true);
      }
      expect(ms).toBeLessThan(1220);
    }
  });
});
