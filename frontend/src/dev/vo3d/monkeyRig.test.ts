// MonkeyAgent rig poser — rest-aligned FK, two-bone IK and contact orientation on a synthetic contract skeleton.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { MonkeyRig, qx, qz } from "./avatar/monkeyRig";
import { MONKEY_SKELETON_JOINTS, MONKEY_SKELETON_PARENTS, type MonkeyJoint } from "./world/monkeyAgentContract";
import { MONKEY_PERSONAS } from "./world/monkeyPersona";

/** a contract-shaped T-pose skeleton in native units (the landmarks' shape), under a model scaled to 36 tall */
function synthetic(): { model: THREE.Object3D; bones: Map<string, THREE.Bone>; skeleton: THREE.Skeleton } {
  const at: Record<MonkeyJoint, [number, number, number]> = {
    Hips: [0, 0.445, 0], LeftUpLeg: [0.085, 0.4, 0], LeftLeg: [0.147, 0.216, 0.028], LeftFoot: [0.161, 0.095, 0.019], LeftToeBase: [0.165, 0.02, 0.09],
    RightUpLeg: [-0.085, 0.4, 0], RightLeg: [-0.147, 0.216, 0.028], RightFoot: [-0.161, 0.095, 0.019], RightToeBase: [-0.165, 0.02, 0.09],
    Spine02: [0, 0.534, 0], Spine01: [0, 0.624, 0], Spine: [0, 0.716, 0], LeftShoulder: [0.06, 0.72, 0], LeftArm: [0.154, 0.733, 0],
    LeftForeArm: [0.356, 0.703, 0], LeftHand: [0.55, 0.7, 0], RightShoulder: [-0.06, 0.72, 0], RightArm: [-0.154, 0.733, 0],
    RightForeArm: [-0.356, 0.703, 0], RightHand: [-0.55, 0.7, 0], neck: [0, 0.773, 0], Head: [0, 0.841, 0], head_end: [0, 1.6, 0], headfront: [0, 1.1, 0.3],
  };
  const model = new THREE.Group();
  model.scale.setScalar(36 / 1.7);
  const bones = new Map<string, THREE.Bone>();
  for (const j of MONKEY_SKELETON_JOINTS) {
    const b = new THREE.Bone(); b.name = j; bones.set(j, b);
    const p = MONKEY_SKELETON_PARENTS[j];
    const here = new THREE.Vector3(...at[j]);
    if (p) { b.position.copy(here.sub(new THREE.Vector3(...at[p]))); bones.get(p)!.add(b); } else { b.position.copy(here); model.add(b); }
  }
  model.updateMatrixWorld(true);
  // bind = this pose, in the model's own (unscaled) space, as a skin would carry it
  const skeleton = new THREE.Skeleton([...bones.values()], [...bones.values()].map((b) => {
    const m = new THREE.Matrix4().copy(model.matrixWorld).invert().multiply(b.matrixWorld);
    return m.invert();
  }));
  return { model, bones, skeleton };
}

describe("MonkeyRig", () => {
  it("measures the chibi limbs in world units from the bind pose", () => {
    const rig = new MonkeyRig(synthetic());
    const [ua, fa] = rig.len.armL;
    expect(ua + fa).toBeGreaterThan(8);
    expect(ua + fa).toBeLessThan(9);
    expect(rig.len.legL[0] + rig.len.legL[1]).toBeGreaterThan(6);
  });

  it("an all-rest pose is the bind pose", () => {
    const h = synthetic();
    const rig = new MonkeyRig(h);
    const before = rig.pos("LeftHand").clone();
    rig.applyPose({ rot: {} });
    expect(rig.pos("LeftHand").distanceTo(before)).toBeLessThan(1e-4);
  });

  it("composes rotations down the chain in the model's rest axes (lowering the left arm points it down)", () => {
    const rig = new MonkeyRig(synthetic());
    rig.applyPose({ rot: { LeftArm: qz(-Math.PI / 2) } });
    const d = rig.pos("LeftHand").clone().sub(rig.pos("LeftArm")).normalize();
    expect(d.y).toBeLessThan(-0.99);
    // and a chest pitch carries the (lowered) arm rigidly with it: bowing forward swings the hanging arm
    // back with the chest, by exactly the pitch
    rig.applyPose({ rot: { Spine: qx(0.6), LeftArm: qz(-Math.PI / 2) } });
    const d2 = rig.pos("LeftHand").clone().sub(rig.pos("LeftArm")).normalize();
    expect(d2.z).toBeCloseTo(-Math.sin(0.6), 2);
  });

  it("two-bone IK lands the hand and foot exactly on reachable targets, bending toward the pole", () => {
    const rig = new MonkeyRig(synthetic());
    rig.applyPose({ rot: { LeftArm: qz(-1.2) } });
    const shoulder = rig.pos("LeftArm").clone();
    for (const off of [[3, -4, 4], [5, -2, 2], [2, -6, 1]] as const) {
      const target = shoulder.clone().add(new THREE.Vector3(...off));
      rig.solveLimb("armL", target, shoulder.clone().add(new THREE.Vector3(4, -2, -8)), 1);
      expect(rig.pos("LeftHand").distanceTo(target)).toBeLessThan(1e-3);
      // the elbow bends toward the pole side (behind)
      const elbow = rig.pos("LeftForeArm");
      const line = target.clone().sub(shoulder).normalize();
      const offLine = elbow.clone().sub(shoulder).addScaledVector(line, -elbow.clone().sub(shoulder).dot(line));
      expect(offLine.z).toBeLessThan(0);
    }
    const hip = rig.pos("LeftUpLeg").clone();
    const foot = hip.clone().add(new THREE.Vector3(1, -5, 2));
    rig.solveLimb("legL", foot, hip.clone().add(new THREE.Vector3(0, -3, 10)), 1);
    expect(rig.pos("LeftFoot").distanceTo(foot)).toBeLessThan(1e-3);
  });

  it("never stretches a limb: an out-of-reach target gets a straight limb pointing at it", () => {
    const rig = new MonkeyRig(synthetic());
    const shoulder = rig.pos("LeftArm").clone();
    const far = shoulder.clone().add(new THREE.Vector3(0, -30, 0));
    const reach = rig.solveLimb("armL", far, shoulder.clone().add(new THREE.Vector3(0, 0, -5)), 1);
    expect(reach).toBeGreaterThan(1);
    const L = rig.len.armL[0] + rig.len.armL[1];
    expect(rig.pos("LeftHand").distanceTo(shoulder)).toBeCloseTo(L, 1);
    expect(rig.pos("LeftHand").clone().sub(shoulder).normalize().y).toBeLessThan(-0.99);
  });

  it("orients a hand onto a contact frame (fingers forward, palm down)", () => {
    const rig = new MonkeyRig(synthetic());
    rig.orientEnd("LeftHand", new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0), 1);
    const q = rig.bone("LeftHand").getWorldQuaternion(new THREE.Quaternion());
    const rest = new THREE.Quaternion(); // the synthetic bones have identity rest orientation
    const fingers = new THREE.Vector3(1, 0, 0).applyQuaternion(rest.invert().premultiply(q));
    expect(fingers.z).toBeGreaterThan(0.99);
  });
});

describe("MonkeyAgent motion personas", () => {
  it("are deterministic data, distinct per identity, inside sane ranges", () => {
    const ids = Object.keys(MONKEY_PERSONAS);
    expect(ids.sort()).toEqual(["milo", "nova", "pip"]);
    const phases = new Set(ids.map((i) => MONKEY_PERSONAS[i].profile.stridePhase));
    expect(phases.size).toBe(3);
    for (const id of ids) {
      const p = MONKEY_PERSONAS[id].profile;
      expect(p.speed.walk).toBeLessThan(p.speed.scamper);
      expect(p.speed.scamper).toBeLessThan(p.speed.knuckle);
      expect(p.tempo).toBeGreaterThan(0.75);
      expect(p.tempo).toBeLessThan(1.25);
    }
    expect(MONKEY_PERSONAS.pip.profile.knuckleFrom).toBeLessThan(MONKEY_PERSONAS.milo.profile.knuckleFrom);
  });
});
