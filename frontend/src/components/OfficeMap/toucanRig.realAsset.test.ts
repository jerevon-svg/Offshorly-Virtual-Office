import { describe, expect, it } from "vitest";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import * as THREE from "three";

// Regression cover for the "wings flap left -> right -> left" bug, read off
// the REAL shipped GLB rather than a synthetic rig — because the bug lived
// entirely in a property of this asset's skeleton that a hand-built fixture
// would not reproduce.
//
// public/toucan/toucan.glb is a Meshy biped auto-rig whose LeftShoulder and
// RightShoulder carry MIRRORED bind quaternions, so the two arm bones' local
// axes already point in opposite world directions. ToucanFlyer therefore
// composes the SAME-signed stroke rotation onto both bind poses; negating one
// side (as the original code did) mirrors an already-mirrored frame and
// drives both wingtips the same way in world space — one lifting while the
// other drops, which is what read as alternating wings.
//
// These assertions fail loudly if a future toucan GLB drops that mirroring,
// which is exactly when the same-sign convention in ToucanFlyer.tsx /
// toucanWingRhythm.ts would need revisiting.
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const GLB = "public/toucan/toucan.glb";

const doc = await io.read(GLB);
const root = doc.getRoot();
const nodesByName = new Map(root.listNodes().map((n) => [n.getName(), n]));

// The exact axis ToucanFlyer flaps about (its FLAP_AXIS).
const FLAP_AXIS = new THREE.Vector3(1, 0, 0);
const LEFT_CHAIN = ["Armature", "Hips", "Spine02", "Spine01", "Spine", "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand"];
const RIGHT_CHAIN = ["Armature", "Hips", "Spine02", "Spine01", "Spine", "RightShoulder", "RightArm", "RightForeArm", "RightHand"];

/**
 * World position of a wingtip proxy (a point out along the last bone), with
 * one bone's local rotation optionally post-multiplied by a flap rotation —
 * i.e. exactly what `bone.quaternion.copy(bind).multiply(flapQuat)` does at
 * runtime.
 */
function wingtipWorld(chain: string[], flapBone: string, angle: number): THREE.Vector3 {
  const world = new THREE.Matrix4();
  for (const name of chain) {
    const node = nodesByName.get(name);
    if (!node) throw new Error(`missing bone ${name} in ${GLB}`);
    const quat = new THREE.Quaternion(...node.getRotation());
    if (name === flapBone && angle !== 0) {
      quat.multiply(new THREE.Quaternion().setFromAxisAngle(FLAP_AXIS, angle));
    }
    world.multiply(
      new THREE.Matrix4().compose(
        new THREE.Vector3(...node.getTranslation()),
        quat,
        new THREE.Vector3(...node.getScale()),
      ),
    );
  }
  return new THREE.Vector3(0, 10, 0).applyMatrix4(world);
}

function wingtipDelta(chain: string[], flapBone: string, angle: number): THREE.Vector3 {
  return wingtipWorld(chain, flapBone, angle).sub(wingtipWorld(chain, flapBone, 0));
}

const STROKE = 0.55; // a representative full downstroke

describe("toucan.glb rig", () => {
  it("ships the wing bones ToucanFlyer drives", () => {
    for (const name of [...LEFT_CHAIN, ...RIGHT_CHAIN]) {
      expect(nodesByName.has(name), `expected bone ${name}`).toBe(true);
    }
  });

  it("has no flight/flap clip, so the procedural flap is the only source", () => {
    // If this ever fails, a real flying clip arrived and ToucanFlyer's
    // FLIGHT_CLIP_RE branch takes over from the procedural path.
    const names = root.listAnimations().map((a) => a.getName());
    expect(names).toEqual(["Running", "Walking"]);
    expect(names.some((n) => /fly|flap|wing|glide|soar/i.test(n))).toBe(false);
  });

  it("carries mirrored Left/Right shoulder bind quaternions", () => {
    const left = nodesByName.get("LeftShoulder")!.getRotation();
    const right = nodesByName.get("RightShoulder")!.getRotation();
    // Mirror signature: x and w agree, y and z are negated. Meshy's auto-rig
    // fits the two shoulders independently, so the mirror is approximate
    // (~0.006 apart here) rather than exact — this tolerance is still an
    // order of magnitude tighter than the ~0.45-0.56 component magnitudes.
    const MIRROR_TOL = 0.02;
    expect(Math.abs(right[0] - left[0])).toBeLessThan(MIRROR_TOL);
    expect(Math.abs(right[3] - left[3])).toBeLessThan(MIRROR_TOL);
    expect(Math.abs(right[1] + left[1])).toBeLessThan(MIRROR_TOL);
    expect(Math.abs(right[2] + left[2])).toBeLessThan(MIRROR_TOL);
  });
});

describe("wing stroke sign convention", () => {
  it("moves both wingtips the SAME world direction with the SAME-signed angle", () => {
    const left = wingtipDelta(LEFT_CHAIN, "LeftArm", STROKE);
    const right = wingtipDelta(RIGHT_CHAIN, "RightArm", STROKE);
    // Vertical (world Y) is the axis a wingbeat reads on. Both must agree in
    // sign — that is a synchronized wingbeat.
    expect(Math.sign(left.y)).toBe(Math.sign(right.y));
    // ...and by a comparable amount, so neither wing lags visually.
    expect(Math.abs(left.y)).toBeGreaterThan(0.05);
    expect(right.y / left.y).toBeGreaterThan(0.75);
    expect(right.y / left.y).toBeLessThan(1.25);
  });

  it("reproduces the alternating-wings bug when one side is negated", () => {
    // This is the OLD code path (right wing got -flapAngle). Documented as a
    // failing configuration so nobody reintroduces it thinking it supplies
    // the left/right mirroring — the bind poses already do.
    const left = wingtipDelta(LEFT_CHAIN, "LeftArm", STROKE);
    const rightNegated = wingtipDelta(RIGHT_CHAIN, "RightArm", -STROKE);
    expect(Math.sign(left.y)).not.toBe(Math.sign(rightNegated.y));
  });

  it("lifts the wingtip for a NEGATIVE angle, which is why the glide pose is negative", () => {
    // Pins toucanWingRhythm's GLIDE_SPREAD_ANGLE sign: negative == raised.
    expect(wingtipDelta(LEFT_CHAIN, "LeftArm", -0.3).y).toBeGreaterThan(0);
    expect(wingtipDelta(RIGHT_CHAIN, "RightArm", -0.3).y).toBeGreaterThan(0);
  });
});
