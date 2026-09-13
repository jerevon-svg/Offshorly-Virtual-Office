// vo3d render — FLOOR OVERLAY ORDERING.
//
// One pass, run once per room after it is built, that copies each material's declared FLOOR_LAYER slot
// (render/Materials.ts) onto the meshes using it. See FLOOR_LAYER for why this exists: without it the
// transparent depth sort decides whether a multiply tint lands before or after the additive glows stacked
// on the same floor, and that decision changes as the camera rotates — which is what made the Gaming
// rug's print and LED border, and other flat decoration, fade in and out with the view.
//
// Deliberately NOT a heuristic: a mesh is ordered only if its material says so. Anything untagged keeps
// three.js' default renderOrder of 0.
import * as THREE from "three";

export function applyFloorLayerOrder(root: THREE.Object3D): number {
  let tagged = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh && !(mesh as unknown as THREE.InstancedMesh).isInstancedMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const slot = m?.userData?.floorLayer as number | undefined;
      if (typeof slot !== "number") continue;
      mesh.renderOrder = slot;
      tagged++;
      break;
    }
  });
  return tagged;
}
