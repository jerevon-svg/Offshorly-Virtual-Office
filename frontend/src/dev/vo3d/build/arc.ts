// vo3d build — CURVED-FORM PRIMITIVES. Promoted VERBATIM out of build/reception.ts in Phase 6B, where the
// arc counter was the only caller. The Central Hub's four bench/planter arcs need exactly the same three
// operations, so they finally live somewhere both rooms can reach. Reception imports them from here and is
// otherwise untouched — same geometry, same segment counts, same output.
import * as THREE from "three";
import { shadowed } from "./helpers";

/** Ring-segment helper: a horizontal annulus slice as a THREE.Shape, in world x/z.
 *  `a0`/`a1` are standard shape-space angles from +x toward +z (= toward SOUTH). */
export function ringShape(cx: number, cz: number, rIn: number, rOut: number, a0: number, a1: number): THREE.Shape {
  const sh = new THREE.Shape();
  sh.absarc(cx, cz, rOut, a0, a1, false);
  sh.absarc(cx, cz, rIn, a1, a0, true);
  sh.closePath();
  return sh;
}

/** Extrude a horizontal shape (given in world x/z) into a flat slab spanning y0 … y0+t.
 *  NOTE: helpers.slab() cannot be used here — it maps shape y to NEGATIVE world z, which is invisible for
 *  the origin-centred shapes it was written for but mirrors a shape authored at absolute world coordinates.
 *  rotateX(+π/2) maps shape y → +world z and the extrude depth → −world y, so we lift by t. */
export function flatRing(shape: THREE.Shape, t: number, m: THREE.Material, y0: number, curveSegments = 64): THREE.Mesh {
  const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, y0 + t, 0);
  return shadowed(new THREE.Mesh(geo, m));
}

/** Partial vertical cylinder wall. three.js' cylinder theta runs from +z toward +x, so a shape-space
 *  angle φ (from +x toward +z) maps to θ = π/2 − φ. */
export function arcWall(r: number, rTop: number, h: number, y0: number, m: THREE.Material, a0: number, a1: number, cx: number, cz: number, segments = 96): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(rTop, r, h, segments, 1, true, Math.PI / 2 - a1, a1 - a0);
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(cx, y0 + h / 2, cz);
  return shadowed(mesh);
}

/** COMPASS degrees (0 = north, 90 = east) → the shape-space angle the three helpers above take.
 *  Room data is authored in compass bearings because that is how the source plan reads; the geometry
 *  layer works in +x→+z shape space. One conversion, in one place. */
export const shapeAngle = (compassDeg: number): number => ((compassDeg - 90) * Math.PI) / 180;

/** A point on a circle at a COMPASS bearing. */
export function polar(cx: number, cz: number, r: number, compassDeg: number): { x: number; z: number } {
  const t = (compassDeg * Math.PI) / 180;
  return { x: cx + Math.sin(t) * r, z: cz - Math.cos(t) * r };
}
