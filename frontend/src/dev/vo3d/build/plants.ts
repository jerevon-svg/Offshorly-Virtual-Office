// vo3d build — tiered plant family (promoted from designRoom3d/build.ts). Positions are WORLD units.
// Sway nodes are pushed into the caller's array and registered per entity by the scene mirror.
import * as THREE from "three";
import { cyl, rbox, rnd, shadowed } from "./helpers";
import { mat, metal, type MatKey } from "../render/Materials";
import { pot } from "./props";
import type { SwayNode } from "../render/Sway";

// ---- plants ------------------------------------------------------------------------------------
// One coherent family, tiered by size (production location/size decide the tier):
//   large   (r ≥ 7)   trunk + radiating branches + blade-leaf fans; trunk/branch/leaf sway
//   medium  (3 ≤ r<7) pot + splayed stems each ending in 2-3 leaves; stem + leaf sway
//   hanging           wall pot + hanging vine chains with alternating leaflets; very slow sway
//   small   (desk pots) static succulent rosettes — pots, soil and leaves are INSTANCED
//                     (three draw calls for every desk plant in the room, see finalizeSucculents)
// Leaf geometry and foliage materials are shared by every tier.
export type PlantSpec = {
  x: number; z: number; r: number; h: number; hanging?: boolean; y?: number;
  /** foliage density multiplier (1 = the Design Room's plants); the reception planters use ~1.7 */
  lush?: number;
  /** false = no pot; the plant stands in a planter that is built separately */
  pot?: boolean;
};
export type PlantTier = "large" | "medium" | "hanging" | "small";
export function tierFor(p: PlantSpec): PlantTier {
  if (p.hanging) return "hanging";
  if (p.r >= 7) return "large";
  return "medium";
}

let leafGeo: THREE.ShapeGeometry | null = null;
export function leafGeometry(): THREE.ShapeGeometry {
  if (leafGeo) return leafGeo;
  // pointed leaf blade, base at the origin, tip along +y (length 1)
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.22, 0.15, 0.3, 0.55, 0, 1);
  s.bezierCurveTo(-0.3, 0.55, -0.22, 0.15, 0, 0);
  leafGeo = new THREE.ShapeGeometry(s, 6);
  return leafGeo;
}
export const foliage = (light: boolean) => mat(light ? "foliageLight" : "foliage", 0.85, { side: THREE.DoubleSide });
const stemMat = () => mat("greenDark", 0.9);

/** A blade leaf on its own pivot at (x, y, z) inside `parent`; optional sway node. */
function leaf(parent: THREE.Object3D, x: number, y: number, z: number, size: number, rotY: number, droop: number, sway: SwayNode[] | null, amp: number, freq: number): THREE.Group {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  pivot.rotation.y = rotY;
  const l = new THREE.Mesh(leafGeometry(), foliage(rnd() > 0.45));
  l.scale.set(size * 0.72, size * 1.05, 1);
  l.rotation.x = droop;
  shadowed(l);
  pivot.add(l);
  parent.add(pivot);
  if (sway) sway.push({ obj: pivot, axis: "x", amp, freq, phase: rnd() * Math.PI * 2, base: 0 });
  return pivot;
}

/**
 * Large floor plant: planter, leaning trunk of three segments, radiating
 * branches each carrying a fan of blade leaves. Every branch and leaf gets its
 * own sway node (amplitude / frequency / phase) so the plant moves like foliage
 * in gentle airflow, never as one rigid object. Complexity scales with r.
 */
export function largePlant(p: PlantSpec, sway: SwayNode[]): THREE.Group {
  const g = new THREE.Group();
  const lush = p.lush ?? 1;
  const potH = p.pot === false ? 0 : p.h * 0.34;
  if (p.pot !== false) g.add(pot(p.r * 0.8, potH, mat("potDark", 0.7), 0, 0, 0));
  const k = Math.min(1, (p.r - 5) / 4); // 0.5 at r7 … 1 at r9: motion + density scale
  const trunk = new THREE.Group();
  trunk.position.y = potH - 0.5;
  g.add(trunk);
  sway.push({ obj: trunk, axis: "x", amp: 0.008 + 0.004 * k, freq: 0.45 + rnd() * 0.2, phase: rnd() * Math.PI * 2, base: 0 });
  let cursor: THREE.Group = trunk;
  const segH = p.h * 0.22;
  for (let i = 0; i < 3; i++) {
    cursor.add(cyl(1.6 - i * 0.35, segH, mat("potDark", 0.9), 0, 0, 0, 1.3 - i * 0.35));
    const next = new THREE.Group();
    next.position.y = segH;
    next.rotation.z = 0.08;
    next.rotation.x = -0.05;
    cursor.add(next);
    cursor = next;
  }
  const branches = Math.round((6 + Math.round(3 * k)) * lush);
  for (let i = 0; i < branches; i++) {
    const a = (i / branches) * Math.PI * 2 + rnd() * 0.5;
    const tilt = 0.55 + rnd() * 0.5;
    const len = p.r * (1.1 + rnd() * 0.7);
    const b = new THREE.Group();
    b.position.y = -segH * rnd() * 0.9;
    b.rotation.y = a;
    b.rotation.z = tilt;
    b.add(cyl(0.35, len, stemMat(), 0, 0, 0, 0.2));
    sway.push({ obj: b, axis: "z", amp: (0.03 + rnd() * 0.02) * (0.7 + 0.3 * k), freq: 0.7 + rnd() * 0.5, phase: rnd() * Math.PI * 2, base: tilt });
    const leaves = Math.round((4 + Math.floor(rnd() * 2) + Math.round(2 * k)) * Math.min(lush, 1.5));
    for (let j = 0; j < leaves; j++) {
      leaf(b, 0, len - rnd() * len * 0.25, 0, p.r * (0.7 + rnd() * 0.5), (j / leaves) * Math.PI * 2 + rnd() * 0.6, -0.55 - rnd() * 0.5, sway, (0.05 + rnd() * 0.04) * (0.7 + 0.3 * k), 1.4 + rnd() * 0.9);
    }
    cursor.add(b);
  }
  g.position.set(p.x, p.y ?? 0, p.z);
  return g;
}

/** Medium plant: pot + 5-6 splayed stems, each ending in 2-3 leaves. Smaller, calmer sway. */
export function mediumPlant(p: PlantSpec, sway: SwayNode[], potColor: MatKey = "potGray"): THREE.Group {
  const g = new THREE.Group();
  const potH = p.h * 0.36;
  g.add(pot(p.r * 0.72, potH, mat(potColor, 0.75), 0, 0, 0));
  const stems = 5 + Math.floor(rnd() * 2);
  for (let i = 0; i < stems; i++) {
    const a = (i / stems) * Math.PI * 2 + rnd() * 0.7;
    const tilt = 0.25 + rnd() * 0.35;
    const len = (p.h - potH) * (0.55 + rnd() * 0.45);
    const s = new THREE.Group();
    s.position.y = potH - 0.5;
    s.rotation.y = a;
    s.rotation.z = tilt;
    s.add(cyl(0.22, len, stemMat(), 0, 0, 0, 0.15));
    sway.push({ obj: s, axis: "z", amp: 0.018 + rnd() * 0.012, freq: 0.8 + rnd() * 0.6, phase: rnd() * Math.PI * 2, base: tilt });
    const n = 2 + Math.floor(rnd() * 2);
    for (let j = 0; j < n; j++) {
      leaf(s, 0, len - j * len * 0.18, 0, p.r * (0.75 + rnd() * 0.4), (j / n) * Math.PI * 2 + rnd() * 1.2, -0.5 - rnd() * 0.5, sway, 0.03 + rnd() * 0.02, 1.2 + rnd() * 0.8);
    }
    g.add(s);
  }
  g.position.set(p.x, p.y ?? 0, p.z);
  return g;
}

/** Hanging plant on the rear wall: wall pot + vine chains of three segments with alternating leaflets. */
export function hangingPlant(p: PlantSpec, sway: SwayNode[]): THREE.Group {
  const g = new THREE.Group();
  const potH = p.r * 0.9;
  const potGroup = pot(p.r * 0.55, potH, mat("potGray", 0.75), 0, p.h, 0);
  g.add(potGroup);
  g.add(rbox(1.2, 4, 2.2, metal(), 0, p.h + potH - 1, -p.r * 0.6, 0.3)); // wall bracket
  const vines = 7;
  for (let i = 0; i < vines; i++) {
    const a = (i / vines) * Math.PI * 2 + rnd() * 0.4;
    const root = new THREE.Group();
    root.position.set(Math.cos(a) * p.r * 0.45, p.h + potH - 0.5, Math.sin(a) * p.r * 0.45 + p.r * 0.2);
    root.rotation.y = a;
    root.rotation.z = 0.35 + rnd() * 0.3; // spill over the rim, then hang
    sway.push({ obj: root, axis: "x", amp: 0.012 + rnd() * 0.008, freq: 0.35 + rnd() * 0.25, phase: rnd() * Math.PI * 2, base: 0 });
    let cursor: THREE.Group = root;
    const segLen = p.h * (0.2 + rnd() * 0.12);
    for (let s = 0; s < 3; s++) {
      const seg = new THREE.Group();
      seg.rotation.z = s === 0 ? 0 : -0.35 - rnd() * 0.25; // curve downward
      const stem = cyl(0.18, segLen, stemMat(), 0, 0, 0, 0.14);
      stem.position.y = -segLen / 2;
      seg.add(stem);
      sway.push({ obj: seg, axis: "x", amp: 0.008 + rnd() * 0.006, freq: 0.5 + rnd() * 0.3, phase: rnd() * Math.PI * 2, base: 0 });
      for (let j = 0; j < 2; j++) {
        const lf = leaf(seg, 0, -segLen * (0.35 + j * 0.45), 0, p.r * 0.42, (j % 2 ? 1 : -1) * 1.4 + rnd() * 0.4, -1.1, sway, 0.02 + rnd() * 0.015, 0.9 + rnd() * 0.5);
        lf.rotation.z = (j % 2 ? -1 : 1) * 0.8; // leaflets alternate sideways off the vine
      }
      cursor.add(seg);
      const next = new THREE.Group();
      next.position.y = -segLen;
      seg.add(next);
      cursor = next;
    }
    g.add(root);
  }
  g.position.set(p.x, p.y ?? 0, p.z);
  return g;
}

export function plantFor(p: PlantSpec, sway: SwayNode[]): THREE.Group {
  const tier = tierFor(p);
  if (tier === "hanging") return hangingPlant(p, sway);
  if (tier === "large") return largePlant(p, sway);
  return mediumPlant(p, sway, p.h >= 28 ? "potDark" : "potGray");
}

// Small desk/cabinet plants are succulent rosettes and deliberately static.
// smallPot() only drops an ANCHOR; finalizeSucculents() turns every anchor
// into instances of three shared meshes (pot, soil, leaf) once the room graph
