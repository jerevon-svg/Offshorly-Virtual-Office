// vo3d build — WHAT YOU SEE THROUGH FLOOR 2'S WINDOWS.
//
// THE PROBLEM. Floor 2 stands in its own world space because this world's regions, navigation and stand
// tests are indexed on (x, z) and have no y — "above" is not a coordinate any of them can express
// (rooms/floor2.ts). That is an implementation detail and it must never be visible. The office's own
// campus would otherwise be sitting off the west windows, 4,500 units away.
//
// THE RULE. Do not invent scenery. Every piece below is the GROUND FLOOR'S OWN — world/campus.ts's roads,
// car park, lots, tree lines, groves and pond, and world/ailab.ts's footprint — reproduced at the SAME
// offset from this floor's plate that it has from the V1 frame, and dropped one storey. So the
// directions agree with the building you just left:
//
//   WEST   the staff car park and its drive, the west street and its verge of tall trees
//   SOUTH  the main street the office fronts onto, its two tree lines, the drop-off
//   NORTH  the rear campus: the AI Lab's massing, the groves that screen it, and the lake behind it
//   EAST   the east street and its verge
//
// Coarse on purpose: at this distance and this angle they are silhouettes, and the real campus is
// several hundred thousand triangles of instanced foliage that has no business being built twice.
// Nothing here is navigable, nothing casts a shadow, and none of it is drawn unless somebody is upstairs.
import * as THREE from "three";
import { rbox } from "./helpers";
import { mat } from "../render/Materials";
import { GROVES, PARKING, PARK_DRIVE, POND, ROADS, TREE_LINES, roadRect, streetLightSpots } from "../world/campus";
import { LAB_OUTER } from "../world/ailab";
import { FRAME as V1_FRAME } from "../adapters/v1Floor";
import { FRAME as FLOOR2_FRAME } from "../rooms/floor2";

/** HOW FAR BELOW THIS FLOOR THE GROUND SITS: one storey of this building, so the same landscape reads
 *  from above rather than from the pavement. */
export const DROP = 62;
/** how far past the plate the ground runs before the sky takes over */
const REACH = 3400;
/** this floor's corner minus the V1 frame's — the one offset every piece takes */
const OFF = { x: FLOOR2_FRAME.x - V1_FRAME.x, z: FLOOR2_FRAME.z - V1_FRAME.z };
const at = (x: number, z: number): [number, number] => [x + OFF.x, z + OFF.z];

export function buildFloor2Context(): THREE.Group {
  const g = new THREE.Group();
  g.name = "floor-2-context";
  const F = FLOOR2_FRAME;
  const cx = F.x + F.w / 2, cz = F.z + F.d / 2;
  const flat = (m: THREE.Mesh): THREE.Mesh => { m.castShadow = false; m.receiveShadow = false; return m; };
  const add = (m: THREE.Mesh): void => { g.add(flat(m)); };

  // ---- the ground, and the podium this building stands on ----------------------------------------
  add(rbox(F.w + 2 * REACH, 8, F.d + 2 * REACH, mat("green", 1), cx, -DROP - 8, cz, 0));
  add(rbox(F.w + 96, DROP, F.d + 96, mat("plinth", 1), cx, -DROP, cz, 2));

  // ---- the street grid ---------------------------------------------------------------------------
  const roadM = mat("charcoal", 0.95), kerbM = mat("sidewalk", 0.95);
  for (const r of ROADS) {
    const rr = roadRect(r);
    const [x, z] = at(rr.x, rr.z);
    const x0 = Math.max(x, F.x - REACH), x1 = Math.min(x + rr.w, F.x + F.w + REACH);
    const z0 = Math.max(z, F.z - REACH), z1 = Math.min(z + rr.d, F.z + F.d + REACH);
    if (x1 <= x0 || z1 <= z0) continue;
    add(rbox(x1 - x0 + 18, 1.8, z1 - z0 + 18, kerbM, (x0 + x1) / 2, -DROP - 0.9, (z0 + z1) / 2, 0));
    add(rbox(x1 - x0, 1.6, z1 - z0, roadM, (x0 + x1) / 2, -DROP - 0.1, (z0 + z1) / 2, 0));
  }

  // ---- WEST: the staff car park, its drive, and a few vehicles in it ------------------------------
  const paveM = mat("sidewalk", 0.92);
  for (const r of [PARKING, PARK_DRIVE]) {
    const [x, z] = at(r.x, r.z);
    add(rbox(r.w, 1.6, r.d, paveM, x + r.w / 2, -DROP - 0.2, z + r.d / 2, 0));
  }
  const carTones = ["gamingBlue", "denyRed", "white", "charcoal", "cyan"] as const;
  for (let i = 0; i < 10; i++) {
    const [x, z] = at(PARKING.x + 70 + (i % 2) * 190, PARKING.z + 80 + Math.floor(i / 2) * 150);
    add(rbox(46, 15, 88, mat(carTones[i % carTones.length], 0.5, { metalness: 0.3 }), x, -DROP + 1.4, z, 5));
  }

  // ---- NORTH: the AI Lab's massing and the lake behind it -----------------------------------------
  const [lx, lz] = at(LAB_OUTER.x, LAB_OUTER.z);
  add(rbox(LAB_OUTER.w, 26, LAB_OUTER.d, mat("wall", 0.95), lx + LAB_OUTER.w / 2, -DROP + 1.4, lz + LAB_OUTER.d / 2, 3));
  add(rbox(LAB_OUTER.w + 20, 2.4, LAB_OUTER.d + 20, mat("plinth", 1), lx + LAB_OUTER.w / 2, -DROP + 27, lz + LAB_OUTER.d / 2, 2));
  const [px, pz] = at(POND.x, POND.z);
  add(rbox(POND.rx * 2, 1.4, POND.rz * 2, mat("glass", 0.2, { metalness: 0.4 }), px, -DROP - 0.4, pz, POND.rz * 0.5));

  // ---- the planting: the office's own lines and groves, as silhouettes ----------------------------
  const trunkM = mat("walnutDark", 0.9), leafM = mat("foliage", 0.85), leafDarkM = mat("greenDark", 0.9);
  const tree = (x: number, z: number, h: number, r: number, dark = false): void => {
    add(rbox(7, h * 0.4, 7, trunkM, x, -DROP, z, 1));
    add(rbox(r * 2, h * 0.66, r * 2, dark ? leafDarkM : leafM, x, -DROP + h * 0.36, z, r * 0.6));
  };
  for (const line of TREE_LINES) {
    for (let v = line.from; v <= line.to; v += line.spacing) {
      const [x, z] = line.axis === "x" ? at(v, line.at) : at(line.at, v);
      tree(x, z, line.kind === "tall" ? 88 : 64, line.kind === "tall" ? 20 : 26);
    }
  }
  let seed = 20260924;
  const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000);
  for (const grove of GROVES) {
    const n = Math.min(grove.count, 9);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd());
      const [x, z] = at(grove.x + Math.cos(a) * grove.rx * r, grove.z + Math.sin(a) * grove.rz * r);
      tree(x, z, 62 + rnd() * 34, 20 + rnd() * 12, true);
    }
  }

  // ---- the street lamps, on the office's own rhythm ------------------------------------------------
  const poleM = mat("charcoal", 0.6), armM = mat("metal", 0.5, { metalness: 0.6 });
  for (const spot of streetLightSpots(420)) {
    const [x, z] = at(spot.x, spot.z);
    if (Math.abs(x - cx) > F.w / 2 + REACH || Math.abs(z - cz) > F.d / 2 + REACH) continue;
    add(rbox(4, 62, 4, poleM, x, -DROP, z, 1));
    add(rbox(24, 3, 5, armM, x + 10, -DROP + 59, z, 1));
  }

  g.visible = false;
  return g;
}
