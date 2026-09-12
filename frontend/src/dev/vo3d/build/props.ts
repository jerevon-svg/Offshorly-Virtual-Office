// vo3d build — small props shared by furniture and decor (promoted from designRoom3d/build.ts).
// Desk succulents are anchors turned into three InstancedMeshes by finalizeSucculents().
import * as THREE from "three";
import { cyl, lathe, rbox, rnd, shadowed } from "./helpers";
import { mat, metal, plastic, screenMat, type MatKey } from "../render/Materials";
import { foliage, leafGeometry } from "./plants";

export function pot(r: number, h: number, m: THREE.Material, cx: number, y0: number, cz: number): THREE.Group {
  const g = new THREE.Group();
  // tapered planter with a rolled lip
  g.add(lathe([[r * 0.68, 0], [r * 0.72, 0.4], [r * 0.9, h * 0.75], [r, h * 0.92], [r * 1.02, h], [r * 0.9, h], [r * 0.86, h - 0.6]], m, cx, y0, cz));
  g.add(cyl(r * 0.84, 0.6, mat("potDark", 0.95), cx, y0 + h - 0.9, cz)); // soil
  return g;
}

export function laptop(cx: number, y0: number, cz: number): THREE.Group {
  const g = new THREE.Group();
  g.add(rbox(9.5, 0.7, 6.6, metal(), cx, y0, cz, 0.35));
  g.add(rbox(7.6, 0.15, 3, mat("charcoal", 0.7), cx, y0 + 0.7, cz - 0.6, 0.1)); // keyboard
  g.add(rbox(3, 0.1, 1.8, mat("metal", 0.5), cx, y0 + 0.7, cz + 2, 0.1)); // trackpad
  const lid = new THREE.Group();
  lid.position.set(cx, y0 + 0.7, cz - 3.2);
  lid.rotation.x = -0.22;
  lid.add(rbox(9.5, 6.4, 0.45, mat("charcoal", 0.5), 0, 0, 0, 0.35));
  lid.add(rbox(8.6, 5.4, 0.12, screenMat(), 0, 0.5, 0.25, 0.15));
  g.add(lid);
  return g;
}
/** Phase 5B: the desk monitor gained a small options bag so a GAMING station can use the same builder.
 *  Every field is optional and every default reproduces the original 15 x 8.5 office monitor exactly, so
 *  existing callers are untouched. */
export type MonitorOpts = {
  /** screen surface — pass a uiScreenMat/emissive material for a powered display */
  screen?: THREE.Material;
  /** 1 = flat (default). 3 splits the panel into a centre and two toed-in wings: a curved ultrawide. */
  segments?: number;
  /** how far the wings toe in, radians (segments > 1 only) */
  curve?: number;
  /** slimmer bezel + lower stand, as gaming panels have */
  slim?: boolean;
};
export function monitor(cx: number, y0: number, cz: number, w = 15, h = 8.5, opts: MonitorOpts = {}): THREE.Group {
  const g = new THREE.Group();
  const screen = opts.screen ?? screenMat();
  const bezel = opts.slim ? 0.7 : 1.2;
  const standH = opts.slim ? 3.2 : 4;
  g.add(cyl(opts.slim ? 4.2 : 3.2, 0.5, mat("charcoal", 0.5), cx, y0, cz + 1.2, opts.slim ? 3.4 : 2.6));
  g.add(rbox(opts.slim ? 1.6 : 1.2, standH, 1.8, mat("charcoal", 0.5), cx, y0 + 0.5, cz + 1.2, 0.3));
  const segs = Math.max(1, opts.segments ?? 1);
  const curve = opts.curve ?? 0.14;
  const segW = w / segs;
  const yPanel = y0 + standH - 0.4;
  for (let i = 0; i < segs; i++) {
    const off = (i - (segs - 1) / 2) * segW;
    const panel = new THREE.Group();
    // toe the outer segments in around the panel centre so the run reads curved from the game camera
    panel.position.set(cx + off * Math.cos(curve * Math.sign(off)), 0, cz + 0.6 + Math.abs(off) * Math.sin(curve) * (segs > 1 ? 1 : 0));
    panel.rotation.y = -Math.sign(off) * curve * (segs > 1 ? 1 : 0);
    panel.add(rbox(segW + 0.2, h, 0.9, mat("charcoal", 0.45), 0, yPanel, 0, 0.5));
    panel.add(rbox(segW - bezel * (segs > 1 ? 0.15 : 1), h - bezel, 0.15, screen, 0, yPanel + bezel * 0.5, -0.5, 0.2));
    g.add(panel);
  }
  return g;
}
export function mug(cx: number, y0: number, cz: number): THREE.Group {
  const g = new THREE.Group();
  g.add(lathe([[1.1, 0], [1.25, 0.3], [1.3, 2.2], [1.1, 2.2], [1.05, 0.4]], plastic("white"), cx, y0, cz, 16));
  g.add(rbox(0.5, 1.3, 0.35, plastic("white"), cx + 1.55, y0 + 0.6, cz, 0.15));
  return g;
}
export function book(cx: number, y0: number, cz: number, w: number, d: number, key: MatKey, rot = 0): THREE.Mesh {
  const b = rbox(w, 0.9, d, mat(key, 0.85), cx, y0, cz, 0.15);
  b.rotation.y = rot;
  return b;
}

const SUCCULENT_KEY = "succulent";
export function smallPot(cx: number, y0: number, cz: number, r = 1.5): THREE.Group {
  const g = new THREE.Group();
  g.position.set(cx, y0, cz);
  g.userData[SUCCULENT_KEY] = r;
  return g;
}
const SUCCULENT_LEAVES = 6;
export function finalizeSucculents(root: THREE.Object3D): { plants: number; meshes: THREE.InstancedMesh[] } {
  root.updateMatrixWorld(true);
  const anchors: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (typeof o.userData[SUCCULENT_KEY] === "number") anchors.push(o);
  });
  if (anchors.length === 0) return { plants: 0, meshes: [] };
  const potGeo = new THREE.LatheGeometry([[0.68, 0], [0.72, 0.15], [0.9, 1.2], [1, 1.5], [1.02, 1.6], [0.9, 1.6], [0.86, 1.4]].map(([r, y]) => new THREE.Vector2(r, y)), 18);
  const soilGeo = new THREE.CylinderGeometry(0.84, 0.84, 0.25, 18);
  const pots = new THREE.InstancedMesh(potGeo, plastic("white"), anchors.length);
  const soils = new THREE.InstancedMesh(soilGeo, mat("potDark", 0.95), anchors.length);
  const leaves = new THREE.InstancedMesh(leafGeometry(), foliage(false), anchors.length * SUCCULENT_LEAVES);
  const m = new THREE.Matrix4(), local = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  anchors.forEach((a, i) => {
    const r = a.userData[SUCCULENT_KEY] as number;
    const world = a.matrixWorld;
    pots.setMatrixAt(i, m.copy(world).multiply(local.makeScale(r, r, r)));
    soils.setMatrixAt(i, m.copy(world).multiply(local.compose(new THREE.Vector3(0, r * 1.45, 0), q.identity(), new THREE.Vector3(r, r, r))));
    for (let j = 0; j < SUCCULENT_LEAVES; j++) {
      e.set(-0.85 - rnd() * 0.25, (j / SUCCULENT_LEAVES) * Math.PI * 2 + rnd() * 0.5, 0, "YXZ");
      q.setFromEuler(e);
      local.compose(new THREE.Vector3(0, r * 1.5, 0), q, new THREE.Vector3(r * 0.9, r * 1.4, 1));
      leaves.setMatrixAt(i * SUCCULENT_LEAVES + j, m.copy(world).multiply(local));
    }
  });
  const out = [pots, soils, leaves];
  for (const im of out) {
    im.instanceMatrix.needsUpdate = true;
    shadowed(im);
    root.add(im);
  }
  return { plants: anchors.length, meshes: out };
}

