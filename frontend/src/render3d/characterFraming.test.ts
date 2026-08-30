import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { computeFramingBox, computeStableFramingBox } from "./CharacterCanvas";

// Builds a minimal stand-in for a Meshy rig: a root Object3D holding bones
// laid out like a T-pose — a tall spine plus arms spanning much wider in X
// than the body is deep in Z. That X-vs-Z asymmetry is exactly what made the
// old world-space framing box (and therefore the solved camera zoom) change
// with the character's heading.
function makeRig(): THREE.Object3D {
  const root = new THREE.Object3D();
  const at = (x: number, y: number, z: number) => {
    const b = new THREE.Bone();
    b.position.set(x, y, z);
    root.add(b);
  };
  at(0, 0, 0);        // hips
  at(0, 0.9, 0);      // spine
  at(0, 1.6, 0);      // head
  at(-0.8, 1.4, 0);   // left hand  — wide in X
  at(0.8, 1.4, 0);    // right hand
  at(0, 0.9, 0.12);   // chest front — shallow in Z
  at(0, 0.9, -0.12);  // back
  root.updateMatrixWorld(true);
  return root;
}

const HEADINGS = [0, Math.PI / 4, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];

describe("CharacterCanvas framing bounds", () => {
  it("computeFramingBox (world-space) DOES change with heading — the defect being guarded against", () => {
    const root = makeRig();
    const sizes = HEADINGS.map((y) => {
      root.rotation.y = y;
      root.updateMatrixWorld(true);
      const s = new THREE.Vector3();
      computeFramingBox(root).getSize(s);
      return s.z;
    });
    // Rotating the wide X arm-span into Z changes the box's depth by a lot.
    expect(Math.max(...sizes) / Math.min(...sizes)).toBeGreaterThan(2);
  });

  it("computeStableFramingBox is identical at every heading", () => {
    const root = makeRig();
    const boxes = HEADINGS.map((y) => {
      root.rotation.y = y;
      root.updateMatrixWorld(true);
      const b = computeStableFramingBox(root);
      return [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z];
    });
    for (const b of boxes) {
      for (let i = 0; i < 6; i++) expect(b[i]).toBeCloseTo(boxes[0][i], 10);
    }
  });

  it("computeStableFramingBox equals the heading-0 world box, so the tuned framing is unchanged", () => {
    const root = makeRig();
    root.rotation.y = 0;
    root.updateMatrixWorld(true);
    const atZero = computeFramingBox(root);
    root.rotation.y = Math.PI / 2;
    root.updateMatrixWorld(true);
    const stable = computeStableFramingBox(root);
    for (const k of ["x", "y", "z"] as const) {
      expect(stable.min[k]).toBeCloseTo(atZero.min[k], 10);
      expect(stable.max[k]).toBeCloseTo(atZero.max[k], 10);
    }
  });

  it("restores the model's heading after measuring (no visible rotation side-effect)", () => {
    const root = makeRig();
    root.rotation.y = 1.234;
    root.updateMatrixWorld(true);
    computeStableFramingBox(root);
    expect(root.rotation.y).toBe(1.234);
    // world matrix must be back in sync with that heading, not left at 0
    const v = new THREE.Vector3(1, 0, 0).applyMatrix4(root.matrixWorld);
    expect(v.x).toBeCloseTo(Math.cos(1.234), 10);
  });
});
