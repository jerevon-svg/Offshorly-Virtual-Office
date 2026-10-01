// vo3d build — THE VEHICLE LIBRARY: procedural, stylized, premium soft-3D vehicles for the campus.
//
// WHAT IT REPLACES. The first exterior parked stacked rounded boxes — a box for the body, a smaller box for
// the cabin — which read as placeholders at every distance. These are SILHOUETTES FIRST: every kind is
// recognisable from the normal office camera before any detail is resolved.
//
//   supercar / supercarWing  low mid-engine wedge: cab-forward glass canopy, fender bulges over a dipped
//                            hood, side intakes, splitter, diffuser, (wing variant) a rear wing
//   sport                    front-engine sporty road car: long hood, fastback greenhouse, full-width tail
//   pickup                   angular utility: one straight rake from nose to apex, one to the tail,
//                            hexagonal arches, black cladding, light bars front and rear
//   sportbike                faired sports motorcycle: nose fairing, screen, tank, stepped seat, tail
//   tricycle                 motorcycle + roofed sidecar — the Philippine street tricycle
//   etrike                   the enclosed modern electric tricycle: one front wheel, a tall glazed pod
//   jeepney                  long passenger body behind a lower hood, chrome grille and bull bar, round
//                            lamps, open window band, striped flanks, flat roof with its route board
//   kalesa                   horse + two big-wheeled carriage under a canopy (ambient only)
//
// NOTHING IS A REAL MODEL. No brand, badge, livery text or exact commercial shape — the references set the
// category, the stance and the proportions, and everything is re-drawn in the office's own soft language.
//
// HOW IT IS DRAWN. Each kind builds THREE geometries, all non-indexed with position/normal/color only, so
// every kind fits one BatchedMesh per material (build/exterior):
//   paint   vertex colour WHITE — multiplied by the per-vehicle colour set on its batch instance
//   gloss   baked vertex colours: glass, chrome, lights, liveries (a low-roughness material)
//   matte   baked vertex colours: tyres, trim, grilles, fabric, the horse (a high-roughness material)
// Conventions: front is local −z, y is up from the ground, x is across. Units are world units (a person
// is 36 tall; a sports car ~112 long).
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries, toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { VehicleKind } from "../world/campus";
import { SCOOTER_GEOMETRY } from "../world/scooters";

export type VehicleGeos = { paint: THREE.BufferGeometry; gloss: THREE.BufferGeometry; matte: THREE.BufferGeometry; lights: THREE.BufferGeometry };

// ---- palette (baked detail colours) -------------------------------------------------------------------
const C = {
  glass: 0x1c2733, glassLight: 0x2c3c4b, tyre: 0x1b1c20, rimDark: 0x2c3036, rimSilver: 0xc9ced4, chrome: 0xdfe3e8,
  trim: 0x16181c, grille: 0x0f1013, head: 0xf3f5f7, drl: 0xdff4ff, tail: 0xd8263a, amber: 0xf2a33a,
  seat: 0x23252a, fabric: 0x1f2126, board: 0xf07a2a, jeepYellow: 0xf5c542, jeepRed: 0xd9383a, jeepOrange: 0xf0892a,
  jeepGreen: 0x3aa55a, horse: 0x7a4a2c, horseDark: 0x3a2618, hoof: 0x26201c, wood: 0xe0b23a, canopy: 0xefe6cf,
  kalesaGreen: 0x2e7d4f, kalesaRed: 0xc9372f, accent: 0x2aa6a0, white: 0xffffff,
} as const;

// ---- geometry plumbing ----------------------------------------------------------------------------------
/** one attribute layout for everything: non-indexed position + normal + color */
function finish(g: THREE.BufferGeometry, hex: number, crease = 0): THREE.BufferGeometry {
  let out = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(out.attributes)) if (name !== "position" && name !== "normal") out.deleteAttribute(name);
  out = crease > 0 ? toCreasedNormals(out, crease) : out;
  if (!out.getAttribute("normal")) out.computeVertexNormals();
  if (out.index) out = out.toNonIndexed();
  const n = out.getAttribute("position").count;
  const c = new THREE.Color(hex);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  out.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return out;
}
/** a box centred at (x, y, z) — `r` > 0 rounds it (the soft-3D edge), `ry` tilts it about x, `yy` about y */
function box(w: number, h: number, d: number, x: number, y: number, z: number, hex: number, r = 0, rx = 0, ryaw = 0, rz = 0): THREE.BufferGeometry {
  const rr = Math.min(r, w / 2 - 0.01, h / 2 - 0.01, d / 2 - 0.01);
  const g = rr > 0.05 ? new RoundedBoxGeometry(w, h, d, 1, rr) : new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  if (ryaw) g.rotateY(ryaw);
  g.translate(x, y, z);
  return finish(g, hex, rr > 0.05 ? Math.PI / 3 : 0);
}
/** a cylinder along x (an axle-axis part), centred at (x, y, z) */
function cylX(r: number, len: number, x: number, y: number, z: number, hex: number, seg = 12): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return finish(g, hex, Math.PI / 4);
}
/** a cylinder along z (a lamp facing ±z), centred at (x, y, z) */
function cylZ(r: number, len: number, x: number, y: number, z: number, hex: number, seg = 12): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return finish(g, hex, Math.PI / 4);
}
/** a cylinder between two points (tubes, legs, forks, spokes) */
function tube(a: THREE.Vector3, b: THREE.Vector3, r: number, hex: number, seg = 6): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q);
  const m = a.clone().add(b).multiplyScalar(0.5);
  g.translate(m.x, m.y, m.z);
  return finish(g, hex, Math.PI / 4);
}
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

type Pt = [number, number];
/** A SIDE PROFILE (points as [z, y]) extruded across the width and centred on x = 0. The bevel rounds
 *  every edge, which is most of the soft-3D read. The silhouette grows by `bevel` all round. */
function side(outline: Pt[], width: number, bevel: number, segs = 2): THREE.BufferGeometry {
  const s = new THREE.Shape();
  outline.forEach(([z, y], i) => (i ? s.lineTo(z, y) : s.moveTo(z, y)));
  s.closePath();
  const depth = Math.max(0.2, width - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(s, { depth, steps: 1, curveSegments: 1, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: segs });
  g.rotateY(-Math.PI / 2); // shape x → vehicle z, extrusion → −x
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  g.translate(-(bb.min.x + bb.max.x) / 2, 0, 0);
  return g;
}
/** reshape a geometry's x (its width) as a function of its own (x, y, z) — tumblehome, nose pinch, fender
 *  bulge — so a side extrusion stops reading as a slab in plan */
function shapeX(g: THREE.BufferGeometry, f: (x: number, y: number, z: number) => number): THREE.BufferGeometry {
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * f(p.getX(i), p.getY(i), p.getZ(i)));
  p.needsUpdate = true;
  return g;
}
/** reshape y the same way (the hood dip between the fender bulges) */
function shapeY(g: THREE.BufferGeometry, f: (x: number, y: number, z: number) => number): THREE.BufferGeometry {
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setY(i, f(p.getX(i), p.getY(i), p.getZ(i)));
  p.needsUpdate = true;
  return g;
}
const smooth = (a: number, b: number, t: number) => { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return u * u * (3 - 2 * u); };

/** A body outline: `top` runs from the front-bottom corner over the car to the rear-bottom corner; the
 *  bottom edge is generated back to the front with an arch cut round every wheel (`n` segments — few for
 *  an angular arch). The arch clears the tyre by `pad` plus the bevel the extrusion will add. */
function withArches(top: Pt[], wheels: { z: number; r: number }[], clearance: number, pad: number, n = 10): Pt[] {
  const out = [...top];
  for (const w of [...wheels].sort((a, b) => b.z - a.z)) {
    const a = w.r + pad;
    const t0 = Math.asin(Math.max(-1, Math.min(1, (clearance - w.r) / a)));
    for (let i = 0; i <= n; i++) {
      const t = t0 + ((Math.PI - 2 * t0) * i) / n;
      out.push([w.z + a * Math.cos(t), w.r + a * Math.sin(t)]);
    }
  }
  return out;
}

/** A WHEEL: a rounded tyre (lathe) with a spoked rim face on the OUTBOARD side only (the inboard face is
 *  never seen). `side` is −1 for a left wheel, +1 for a right one. */
function wheel(r: number, w: number, x: number, z: number, sideSign: number, rimHex: number, spokes: number, into: { gloss: THREE.BufferGeometry[]; matte: THREE.BufferGeometry[] }, hubY = r, barrelHex: number = C.rimDark): void {
  const pts: THREE.Vector2[] = [];
  const ri = r * 0.64, hw = w / 2, k = Math.min(hw, (r - ri) / 2) * 0.9;
  pts.push(new THREE.Vector2(ri, -hw), new THREE.Vector2(r - k, -hw), new THREE.Vector2(r - k * 0.3, -hw + k * 0.3), new THREE.Vector2(r, -hw + k),
    new THREE.Vector2(r, hw - k), new THREE.Vector2(r - k * 0.3, hw - k * 0.3), new THREE.Vector2(r - k, hw), new THREE.Vector2(ri, hw));
  const tyre = new THREE.LatheGeometry(pts, 14);
  tyre.rotateZ(Math.PI / 2);
  tyre.translate(x, hubY, z);
  into.matte.push(finish(tyre, C.tyre, Math.PI / 3));
  const face = x + sideSign * (hw - 0.6);
  // the dished rim: a dark barrel with the spokes and the hub standing on its face
  (barrelHex === C.rimDark ? into.matte : into.gloss).push(cylX(ri * 0.98, 1, face - sideSign * 0.8, hubY, z, barrelHex, 14));
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const g = new THREE.BoxGeometry(1.2, ri * 0.92, ri * 0.3);
    g.translate(0, ri * 0.46, 0);
    g.rotateX(a);
    g.translate(face, hubY, z);
    into.gloss.push(finish(g, rimHex));
  }
  // a disc wheel (no spokes) gets a dark centre cap so it still reads as a wheel, not a plate
  into.gloss.push(cylX(ri * (spokes ? 0.2 : 0.34), 1.8, face + sideSign * 0.2, hubY, z, spokes ? rimHex : C.rimDark, 8));
}
const pair = (fn: (s: number) => void) => { fn(-1); fn(1); };

/** `lights` are the head/tail lamps and DRLs: parked vehicles draw them with the gloss detail, moving
 *  traffic draws them UNLIT so they read as lit lamps after dark (build/exterior) */
type Parts = { paint: THREE.BufferGeometry[]; gloss: THREE.BufferGeometry[]; matte: THREE.BufferGeometry[]; lights: THREE.BufferGeometry[] };
const parts = (): Parts => ({ paint: [], gloss: [], matte: [], lights: [] });
function done(p: Parts): VehicleGeos {
  const merge = (list: THREE.BufferGeometry[]) => {
    const g = mergeGeometries(list, false);
    if (!g) throw new Error("vehicles: merge failed");
    return g;
  };
  // a kind with no lamps (the kalesa) still gets a lights geometry — one degenerate triangle — so every kind
  // has the same four parts and the same batch plumbing
  if (!p.lights.length) {
    const g = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
    p.lights.push(finish(g, C.trim));
  }
  return { paint: merge(p.paint), gloss: merge(p.gloss), matte: merge(p.matte), lights: merge(p.lights) };
}

// ---- SUPERCAR ---------------------------------------------------------------------------------------------
function supercar(wing: boolean): VehicleGeos {
  const P = parts();
  const B = 2.5, W = 50, R = 9.5, RR = 10, ZF = -35, ZR = 34, CL = 3.2;
  const top: Pt[] = [[-52, 4], [-54.5, 8], [-52, 11], [-45, 14.5], [-37, 19], [-27, 20], [-18, 19.5], [0, 20.5], [14, 21.5], [24, 23.5], [34, 24.5], [44, 24], [51, 21.5], [54, 17], [54, 11], [52, 5.5], [49, 4]];
  const body = side(withArches(top, [{ z: ZF, r: R }, { z: ZR, r: RR }], CL, 1.2 + B), W, B, 3);
  // plan: the nose pinches, the rear haunches swell; section: the hood dips between two fender bulges
  shapeX(body, (_x, y, z) => (1 - 0.14 * smooth(-38, -56, z)) * (1 + 0.035 * smooth(8, 30, z) * smooth(10, 22, y)));
  shapeY(body, (x, y, z) => (z < -16 && y > 14 ? y - 3.6 * (1 - Math.min(1, (x / (W / 2 - 3)) ** 2)) * smooth(-16, -24, z) : y));
  P.paint.push(finish(body, C.white, Math.PI / 5));
  // the glass canopy — cab-forward, fastback over the engine cover, dark all the way over the roof
  const glass = side([[-21, 17.5], [-15, 21], [-1, 30], [12, 31], [20, 29.6], [40, 23.4], [42, 21.5], [-21, 16.5]], 38, 2.6, 3);
  shapeX(glass, (_x, y) => 1 - 0.22 * smooth(21, 31, y));
  P.gloss.push(finish(glass, C.glass, Math.PI / 5));
  // intakes: a deep scoop behind each door, and three mouths across the nose
  pair((s) => P.matte.push(finish(shapeX(side([[10, 8], [26, 19.5], [31, 19.5], [31, 8]], 2.2, 0.4), () => 1).translate(s * (W / 2 - 0.4), 0, 0), C.grille)));
  P.matte.push(box(46, 1.6, 12, 0, 3.4, -49, C.trim, 0.6)); //                        splitter
  // (every face detail sits ON the bevelled surface — the extrusion grows the silhouette by B all round)
  P.matte.push(box(15, 5.5, 2, 0, 7.6, -56.8, C.grille, 0.8)); //                     centre mouth
  pair((s) => P.matte.push(box(10, 5, 2, s * 14.5, 8, -56.2, C.grille, 0.8, 0, s * 0.3)));
  P.matte.push(box(42, 5, 6, 0, 5.2, 55.4, C.trim, 0.8)); //                          diffuser
  // lamps: two blade headlights laid along the raked hood, a DRL line on the nose, a full-width tail bar
  pair((s) => P.lights.push(box(14, 1.8, 8, s * 16.5, 15.3, -46, C.head, 0.6, -0.46, s * 0.42)));
  pair((s) => P.lights.push(box(10, 1.1, 1.2, s * 13.5, 10.8, -57.2, C.drl, 0.3, 0, s * 0.3)));
  P.lights.push(box(40, 2.4, 1.6, 0, 15.2, 56.9, C.tail, 0.6));
  pair((s) => P.gloss.push(cylZ(1.8, 3, s * 6, 8.2, 57.2, C.chrome, 10)));
  // mirrors on short stalks at the canopy's foot
  pair((s) => { P.paint.push(box(5.5, 3.2, 6, s * 26.5, 21.5, -15, C.white, 1.2)); P.matte.push(box(4, 1.2, 1.6, s * 23.5, 20.5, -15, C.trim)); });
  if (wing) {
    P.matte.push(box(46, 1.4, 10, 0, 34.5, 47, C.trim, 0.6, -0.08));
    pair((s) => P.matte.push(box(1.6, 10, 4, s * 14, 29.5, 47.5, C.trim, 0.4)));
    pair((s) => P.matte.push(box(1.2, 5, 10, s * 23, 32.5, 47, C.trim, 0.4)));
  }
  pair((s) => {
    wheel(R, 9, s * 21.5, ZF, s, C.rimDark, 5, P);
    wheel(RR, 10.5, s * 22, ZR, s, C.rimDark, 5, P, RR);
  });
  return done(P);
}

// ---- SPORTY ROAD CAR --------------------------------------------------------------------------------------
function sport(): VehicleGeos {
  const P = parts();
  const B = 2.5, W = 48, R = 9, ZF = -35, ZR = 35, CL = 3.8;
  const top: Pt[] = [[-52, 5], [-54.5, 9], [-54, 13.5], [-47, 16.5], [-32, 19], [-21, 20], [0, 21], [20, 21.2], [36, 22], [47, 21.5], [53, 19.5], [55, 15], [55, 9], [52, 5]];
  const body = side(withArches(top, [{ z: ZF, r: R }, { z: ZR, r: R }], CL, 1.2 + B), W, B, 3);
  shapeX(body, (_x, _y, z) => 1 - 0.1 * smooth(-40, -57, z) - 0.05 * smooth(44, 57, z));
  shapeY(body, (x, y, z) => (z < -20 && y > 15 ? y - 1.6 * (1 - Math.min(1, (x / (W / 2 - 3)) ** 2)) * smooth(-20, -28, z) : y));
  P.paint.push(finish(body, C.white, Math.PI / 5));
  const glass = side([[-23, 18.5], [-9, 30], [6, 32], [24, 31.2], [35, 27], [42, 21.8], [42, 19.5], [-23, 17.5]], 40, 2.6, 3);
  shapeX(glass, (_x, y) => 1 - 0.2 * smooth(22, 32, y));
  P.gloss.push(finish(glass, C.glass, Math.PI / 5));
  // a body-colour roof band over the glass so it reads as a closed coupé, not a canopy
  const roof = side([[-7, 31.2], [6, 33.1], [24, 32.3], [31, 30], [24, 31.3], [6, 32.1], [-6, 30.4]], 32, 0.8, 2);
  P.paint.push(finish(roof, C.white, Math.PI / 5));
  P.matte.push(box(28, 5, 2, 0, 9, -57.3, C.grille, 1)); //                          grille
  pair((s) => P.matte.push(box(8, 4, 2, s * 17, 7, -56.6, C.grille, 0.8)));
  P.matte.push(box(40, 3, 6, 0, 4.6, 56, C.trim, 0.8));
  pair((s) => P.lights.push(box(12, 2, 7, s * 16.5, 17.3, -50, C.head, 0.6, -0.4, s * 0.3)));
  P.lights.push(box(42, 2.4, 1.6, 0, 14.2, 58, C.tail, 0.6));
  pair((s) => { P.paint.push(box(5, 3, 5.5, s * 25.5, 22, -18, C.white, 1.1)); P.matte.push(box(3.4, 1.2, 1.5, s * 22.8, 21, -18, C.trim)); });
  pair((s) => P.gloss.push(cylZ(1.7, 3, s * 14, 6.8, 57.8, C.chrome, 10)));
  pair((s) => { wheel(R, 9, s * 20.5, ZF, s, C.rimSilver, 5, P, R, 0x7d838b); wheel(R, 9.5, s * 20.5, ZR, s, C.rimSilver, 5, P, R, 0x7d838b); });
  return done(P);
}

// ---- ANGULAR UTILITY (PICKUP) -----------------------------------------------------------------------------
function pickup(): VehicleGeos {
  const P = parts();
  const B = 0.8, W = 54, R = 12.5, ZF = -44, ZR = 43, CL = 7;
  // two straight rakes meeting at one apex: that single line IS the silhouette
  const top: Pt[] = [[-63, 9], [-65, 25], [-63, 27.5], [-3, 49], [64, 34], [65, 13], [62, 9]];
  const body = side(withArches(top, [{ z: ZF, r: R }, { z: ZR, r: R }], CL, 2 + B, 4), W, B, 1);
  P.paint.push(finish(body, C.white, 0));
  // flush glazing: a slightly wider slab of glass pokes through both flanks and the rake
  P.gloss.push(finish(side([[-39, 31.3], [-4, 48.3], [21, 42.6], [21, 31.3]], W + 0.9, 0.2, 1), C.glass, 0));
  // the windscreen proper on the front rake
  P.gloss.push(finish(side([[-40, 32.2], [-5, 49.2], [-3, 48.6], [-38, 31.4]], W - 8, 0.2, 1), C.glassLight, 0));
  P.matte.push(box(W + 0.8, 5, 128, 0, 10.5, 0, C.trim)); //                        black lower cladding
  pair((s) => {
    // hexagonal arch flares in the cladding tone
    for (const zc of [ZF, ZR]) P.matte.push(finish(side(withArches([[zc - 17, 9], [zc - 17, 12], [zc - 12, 27], [zc + 12, 27], [zc + 17, 12], [zc + 17, 9]], [{ z: zc, r: R }], CL, 2.2, 4), 2, 0.3, 1).translate(s * (W / 2 + 0.6), 0, 0), C.trim));
  });
  P.lights.push(box(W - 2, 1.4, 1, 0, 25.6, -66.2, C.drl)); //                      front light bar
  P.lights.push(box(W - 2, 1.6, 1, 0, 32.4, 66.2, C.tail)); //                      rear light bar
  P.matte.push(box(W - 6, 5, 2, 0, 13, -66.2, C.grille)); //                        lower intake
  pair((s) => { P.paint.push(box(6, 3.5, 3, s * 29, 32, -30, C.white, 0.5)); });
  P.matte.push(box(W - 6, 0.8, 58, 0, 36.2, 36, C.trim)); //                        tonneau seam
  pair((s) => { wheel(R, 11, s * 23, ZF, s, C.rimDark, 6, P); wheel(R, 11, s * 23, ZR, s, C.rimDark, 6, P); });
  return done(P);
}

// ---- SPORTS MOTORCYCLE ------------------------------------------------------------------------------------
function sportbike(): VehicleGeos {
  const P = parts();
  const R = 8.5, ZF = -18, ZR = 18;
  // a lean fairing: raked nose, tank hump, stepped seat, a high thin tail — and a HIGH belly, so the dark
  // engine and the wheels carry the lower half the way a real sports bike's do
  const fairing = side([[-24, 14], [-27.5, 18.5], [-25, 23.5], [-19, 26], [-9, 26.5], [-3, 25], [3, 22.8], [14, 23.8], [24, 26.2], [24.5, 24.5], [14, 20.5], [4, 16.5], [-6, 16], [-16, 13.5], [-21, 13]], 11, 2.2, 3);
  shapeX(fairing, (_x, y, z) => 1 - 0.3 * smooth(-18, -28, z) - 0.25 * smooth(14, 27, z) + 0.12 * smooth(12, 18, y) * smooth(-12, -2, z) * smooth(4, -4, z));
  P.paint.push(finish(fairing, C.white, Math.PI / 5));
  P.gloss.push(finish(side([[-25, 24.5], [-19, 31.5], [-14.5, 30.5], [-18.5, 25]], 9, 0.8, 2), C.glass, Math.PI / 5)); // screen
  P.matte.push(box(8.5, 2, 13, 0, 24.4, 8, C.seat, 0.9)); //                    rider seat
  P.matte.push(box(7, 2, 7, 0, 26.2, 18.5, C.seat, 0.8)); //                    pillion hump
  P.matte.push(box(9, 10, 17, 0, 12, 0, C.trim, 1.2)); //                       engine block
  pair((s) => P.matte.push(tube(v3(s * 3.2, R, ZF), v3(s * 3.2, 25, ZF - 4), 1.1, C.trim)));
  P.matte.push(tube(v3(0, R, ZR), v3(0, 13, 4), 1.6, C.trim)); //                swingarm
  pair((s) => P.matte.push(box(6, 1.3, 1.6, s * 5, 27.5, -17, C.trim)));
  P.gloss.push(tube(v3(4.5, 10, 6), v3(4.8, 15.5, 25), 1.9, C.chrome, 10)); //  exhaust
  P.lights.push(box(5, 2.4, 1.2, 0, 19, -27.8, C.head, 0.5));
  P.lights.push(box(4, 1.2, 1, 0, 26.2, 26.8, C.tail, 0.4));
  wheel(R, 5, 0, ZF, 1, C.rimSilver, 5, P);
  wheel(R, 6, 0, ZR, 1, C.rimSilver, 5, P);
  pair((s) => P.matte.push(cylX(R * 0.62, 0.8, s * 2.4, R, ZF, C.rimSilver, 12))); // brake discs
  return done(P);
}

// ---- TRICYCLE (motorcycle + roofed sidecar) ---------------------------------------------------------------
function tricycle(): VehicleGeos {
  const P = parts();
  const bx = -11, sx = 12, R = 8.5;
  // the bike: tank + seat + fork, upright commuter proportions
  P.paint.push(finish(side([[-12, 15], [-8, 22], [3, 21.5], [9, 19], [9, 15.5]], 9, 2, 2).translate(bx, 0, 0), C.white, Math.PI / 5));
  P.matte.push(box(8, 2.2, 12, bx, 22.5, 7, C.seat, 0.9));
  P.matte.push(box(8, 8, 12, bx, 12, -2, C.trim, 1));
  P.matte.push(tube(v3(bx, R, -22), v3(bx, 27, -17), 1.1, C.trim));
  P.matte.push(box(16, 1.3, 1.6, bx, 27.5, -17, C.trim));
  P.lights.push(cylZ(2.6, 2, bx, 23.5, -20.5, C.head, 12));
  P.gloss.push(tube(v3(bx + 4, 8, 4), v3(bx + 4.5, 9, 20), 1.3, C.chrome));
  wheel(R, 4, bx, -22, -1, C.rimSilver, 8, P, R, 0x7d838b);
  wheel(R, 4.5, bx, 12, -1, C.rimSilver, 8, P, R, 0x7d838b);
  // the sidecar: a deep tub with a raked front, windscreen, route board, open inboard side
  const tub = side([[-24, 6], [-26, 16], [-22, 23], [22, 23], [25, 13], [22, 5]], 26, 3, 2);
  P.paint.push(finish(tub.translate(sx, 0, 0), C.white, Math.PI / 5));
  P.gloss.push(finish(side([[-23, 23], [-21, 38], [-16, 38], [-18, 23]], 22, 1, 2).translate(sx, 0, 0), C.glassLight, Math.PI / 5));
  P.gloss.push(box(18, 9, 1.4, sx, 16, -29.3, C.board, 0.6, -0.12));
  P.matte.push(box(22, 3, 16, sx, 24, 6, C.seat, 1)); //                        bench
  P.matte.push(box(22, 12, 2.5, sx, 30, 14, C.seat, 1)); //                     backrest
  // the canopy over sidecar AND rider, on four chrome stanchions
  P.matte.push(box(46, 2.6, 50, 1, 40.5, -2, C.fabric, 1.2));
  for (const [x, z] of [[sx + 11, -19], [sx + 11, 18], [sx - 11, -19], [sx - 11, 18]] as const) P.gloss.push(box(1.4, 17, 1.4, x, 31.5, z, C.chrome));
  P.gloss.push(box(1.4, 1.4, 32, bx + 7, 20, -4, C.chrome)); //                  side rail
  wheel(R, 5, sx + 13, 10, 1, C.rimSilver, 8, P, R, 0x7d838b);
  return done(P);
}

// ---- E-TRIKE (enclosed electric tricycle) -----------------------------------------------------------------
function etrike(): VehicleGeos {
  const P = parts();
  const W = 42;
  const shell = side(withArches([[-31, 11], [-34, 16], [-33, 23], [-26, 26], [30, 26], [35, 22], [35, 9], [31, 6]], [{ z: 24, r: 8.5 }], 6, 3.5), W, 4, 3);
  shapeX(shell, (_x, _y, z) => 1 - 0.3 * smooth(-18, -35, z));
  P.paint.push(finish(shell, C.white, Math.PI / 5));
  // the fabric-and-frame upper cabin, glazed front and sides
  const cab = side([[-27, 25], [-22, 50], [-17, 54], [31, 54], [34, 50], [34, 25]], 40, 3, 2);
  shapeX(cab, (_x, _y, z) => 1 - 0.18 * smooth(-12, -27, z));
  P.matte.push(finish(cab, C.fabric, Math.PI / 5));
  P.gloss.push(finish(shapeX(side([[-26.5, 27], [-21.5, 49.5], [-16, 50], [-20.5, 27]], 38, 0.3, 1), (_x, _y, z) => 1 - 0.18 * smooth(-12, -27, z)), C.glassLight, 0));
  P.gloss.push(finish(side([[-11, 30], [-11, 48], [27, 48], [27, 30]], 41, 0.2, 1), C.glass, 0));
  P.paint.push(box(46, 2.6, 66, 0, 55.5, 2, C.white, 1.2)); //                     roof
  P.gloss.push(box(W + 0.6, 1.6, 50, 0, 21.5, 4, C.accent)); //                    accent band
  pair((s) => P.lights.push(cylZ(2.4, 1.6, s * 8.5, 18, -38.3, C.head, 12)));
  pair((s) => P.lights.push(box(4, 3, 1, s * 17, 19, 39.2, C.tail, 0.5)));
  pair((s) => { P.matte.push(tube(v3(s * 20, 45, -18), v3(s * 26, 46, -21), 0.6, C.trim)); P.matte.push(box(2, 4.5, 3, s * 26.5, 46, -21, C.trim, 0.6)); });
  P.matte.push(tube(v3(0, 7.5, -26), v3(0, 20, -24), 1.2, C.trim)); //           front fork
  wheel(7.5, 5, 0, -26, 1, C.rimSilver, 6, P, 7.5, 0x7d838b);
  pair((s) => wheel(8.5, 5, s * 20, 24, s, C.rimSilver, 6, P, 8.5, 0x7d838b));
  return done(P);
}

// ---- JEEPNEY -----------------------------------------------------------------------------------------------
function jeepney(): VehicleGeos {
  const P = parts();
  const W = 58, R = 14, ZF = -62, ZR = 60, CL = 7;
  // one silhouette: a lower, narrower hood and a tall passenger body under a flat roof
  const top: Pt[] = [[-86, 10], [-89, 20], [-88, 36], [-84, 38.5], [-50, 40], [-45, 41], [-44, 64], [88, 64], [89, 14], [86, 8]];
  const body = side(withArches(top, [{ z: ZF, r: R }, { z: ZR, r: R }], CL, 2 + 2.5), W - 2, 2.5, 2);
  shapeX(body, (_x, y, z) => (z < -45 ? 0.84 + 0.05 * smooth(20, 10, y) : 1));
  P.paint.push(finish(body, C.white, Math.PI / 5));
  // flared front fenders over the front wheels
  pair((s) => P.paint.push(finish(side(withArches([[-84, 16], [-80, 26], [-46, 27], [-42, 16]], [{ z: ZF, r: R }], 12, 3.2, 8), 7, 2, 2).translate(s * 26, 0, 0), C.white, Math.PI / 5)));
  // the flat roof with its overhang, rails and the blank route board on the front edge
  P.paint.push(box(62, 3, 182, 0, 66.5, 2, C.white, 1.2));
  pair((s) => P.gloss.push(box(1.6, 2.4, 176, s * 29.5, 69.2, 2, C.chrome)));
  P.gloss.push(box(44, 8, 2.4, 0, 72, -86, C.jeepYellow, 0.8));
  // windscreen, and the open window band down both flanks with body-colour posts
  P.gloss.push(box(46, 16, 1.4, 0, 52, -47.4, C.glass, 0.6));
  P.matte.push(box(W + 0.5, 14, 118, 0, 51.5, 22, C.grille));
  for (let z = -36; z <= 80; z += 16.5) P.paint.push(box(W + 1.1, 14, 2.4, 0, 51.5, z, C.white));
  // the flanks: chrome belt and the colour stripes that make it a jeepney
  P.gloss.push(box(W + 1.2, 1.6, 132, 0, 42.8, 22, C.chrome));
  P.gloss.push(box(W + 1.3, 2.2, 128, 0, 38.8, 22, C.jeepOrange));
  P.gloss.push(box(W + 1.3, 2.2, 128, 0, 36.2, 22, C.jeepYellow));
  P.gloss.push(box(W + 1.3, 2.2, 128, 0, 33.6, 22, C.jeepRed));
  P.gloss.push(box(W + 1.3, 1.6, 128, 0, 17, 22, C.jeepGreen));
  // the face: tall chrome grille with dark slots, big round lamps, fog lamps, bumper and bull bar
  P.gloss.push(box(30, 20, 2, 0, 27, -91.6, C.chrome, 0.8));
  for (let i = -2; i <= 2; i++) P.matte.push(box(2.2, 15, 1, i * 5, 27, -92.8, C.grille));
  pair((s) => { P.lights.push(cylZ(4.6, 2.2, s * 18, 30, -91.8, C.head, 14)); P.gloss.push(cylZ(5.4, 1.4, s * 18, 30, -91.2, C.chrome, 14)); });
  for (const x of [-8, 0, 8]) P.gloss.push(cylZ(2.4, 2, x, 14.5, -94.4, C.jeepYellow, 10));
  P.gloss.push(box(62, 5, 4, 0, 10, -92.5, C.chrome, 1));
  P.gloss.push(tube(v3(-26, 18, -95), v3(26, 18, -95), 1.3, C.chrome, 8));
  pair((s) => P.gloss.push(tube(v3(s * 16, 8, -95), v3(s * 16, 22, -95), 1.3, C.chrome, 8)));
  P.gloss.push(box(4, 5, 8, 0, 42.5, -80, C.chrome, 1)); //                      hood mascot
  pair((s) => P.gloss.push(box(2.5, 6, 3, s * 21, 43, -84, C.amber, 0.6)));
  // the open rear with its grab rails and step
  P.matte.push(box(30, 34, 1, 0, 33, 91.4, C.grille));
  pair((s) => P.gloss.push(box(1.4, 34, 1.4, s * 16, 33, 92.2, C.chrome)));
  P.matte.push(box(34, 2, 8, 0, 9, 94, C.trim));
  pair((s) => P.lights.push(box(4, 5, 1, s * 25, 20, 91.6, C.tail, 0.5)));
  // pressed-steel disc wheels in chrome, dark centre caps
  pair((s) => { wheel(R, 9, s * 24.5, ZF, s, C.chrome, 0, P, R, C.chrome); wheel(R, 10, s * 25, ZR, s, C.chrome, 0, P, R, C.chrome); });
  return done(P);
}

// ---- KALESA (ambient horse carriage) ------------------------------------------------------------------------
function kalesa(): VehicleGeos {
  const P = parts();
  const OFF = -36; // the whole rig re-centred so its bounding length is centred on the origin
  // THE HORSE: a side silhouette extruded thin and rounded, four legs, mane, tail, blinders
  const horse = side([[22, 34], [8, 33], [-10, 35.5], [-18, 46], [-24, 52], [-30, 50], [-38, 42.5], [-38.5, 37.5], [-28, 38], [-20, 34], [-18, 24], [-10, 20], [14, 20], [24, 24], [25.5, 30]], 12, 4, 3);
  shapeX(horse, (_x, y, z) => 1 - 0.35 * smooth(-12, -30, z) * smooth(36, 46, y) + 0.1 * smooth(28, 22, y) * smooth(-14, 0, z) * smooth(22, 6, z));
  P.matte.push(finish(horse.translate(0, 0, OFF), C.horse, Math.PI / 4));
  for (const [x, z] of [[-3.4, -14], [3.4, -12], [-3.4, 17], [3.4, 19]] as const) {
    P.matte.push(tube(v3(x, 21, z + OFF), v3(x, 2.4, z + OFF), 2.1, C.horse, 7));
    P.matte.push(box(4.6, 2.6, 4.6, x, 1.3, z + OFF, C.hoof, 0.6));
  }
  P.matte.push(finish(side([[-12, 36], [-18, 47], [-24, 53], [-22, 54.5], [-16, 49], [-9, 38]], 4, 1, 2).translate(0, 0, OFF), C.horseDark, Math.PI / 4));
  P.matte.push(tube(v3(0, 31, 25 + OFF), v3(0, 16, 30 + OFF), 2.2, C.horseDark, 7));
  pair((s) => P.matte.push(box(0.8, 4, 4, s * 4.2, 45, -31 + OFF, C.trim)));
  P.matte.push(box(13, 3, 20, 0, 34.5, 2 + OFF, C.trim, 1)); //                   saddle pad / harness
  // THE SHAFTS from the harness back to the carriage
  pair((s) => P.gloss.push(tube(v3(s * 8, 30, -6 + OFF), v3(s * 12, 22, 60 + OFF), 1, C.wood, 6)));
  // THE CARRIAGE: a painted box on two tall spoked wheels, a canopy on posts
  const cz = 74 + OFF;
  P.paint.push(box(40, 14, 52, 0, 26, cz, C.white, 2));
  P.gloss.push(box(41, 2, 53, 0, 20, cz, C.kalesaRed));
  P.gloss.push(box(41, 1.6, 53, 0, 33.6, cz, C.wood));
  P.matte.push(box(34, 3, 14, 0, 35, cz + 14, C.seat, 1)); //                      bench
  P.paint.push(box(36, 14, 2.4, 0, 42, cz + 21, C.white, 1));
  P.matte.push(box(30, 2.4, 10, 0, 34.5, cz - 22, C.seat, 1)); //                  driver's footboard
  for (const [x, z] of [[-18, cz - 24], [18, cz - 24], [-18, cz + 24], [18, cz + 24]] as const) P.gloss.push(box(1.6, 34, 1.6, x, 50, z, C.wood));
  const roof = side([[-30, 66], [-10, 70], [10, 70], [30, 66], [30, 64], [10, 68], [-10, 68], [-30, 64]], 46, 1, 2);
  P.matte.push(finish(roof.translate(0, 0, cz), C.canopy, Math.PI / 4));
  P.gloss.push(box(47, 3, 60, 0, 63.5, cz, C.kalesaGreen, 0.8)); //                canopy valance
  // two tall wheels, yellow spokes round a green hub
  pair((s) => {
    const x = s * 24, z = cz + 6, r = 20;
    const ring = new THREE.TorusGeometry(r - 1.2, 1.6, 6, 22);
    ring.rotateY(Math.PI / 2);
    ring.translate(x, r, z);
    P.gloss.push(finish(ring, C.wood, Math.PI / 4));
    P.matte.push(finish(new THREE.TorusGeometry(r, 0.9, 4, 22).rotateY(Math.PI / 2).translate(x, r, z), C.tyre, Math.PI / 4));
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      P.gloss.push(tube(v3(x, r, z), v3(x, r + Math.sin(a) * (r - 2), z + Math.cos(a) * (r - 2)), 0.6, C.wood, 4));
    }
    P.gloss.push(cylX(3, 3, x, r, z, C.kalesaGreen, 10));
  });
  P.gloss.push(tube(v3(-24, 20, cz + 6), v3(24, 20, cz + 6), 1, C.wood, 6)); //   axle
  return done(P);
}

// ---- SHARED STAND-UP E-SCOOTER ---------------------------------------------------------------------------
// The shared-fleet silhouette: a low dark deck on two small fat wheels, a tall single stem in the fleet
// colour (the paint part — its instance colour), a flat bar with grips and a small display, a lamp on the
// stem and a tail lamp on the rear fender, a kickstand. Deck top at DECK_TOP (world/scooters) so a rider's
// feet stand on it; every rider-facing proportion (bar, grips, rake, wheelbase) is world/scooters
// SCOOTER_GEOMETRY, sized to the chibi cast so both hands really reach the grips.
function scooter(): VehicleGeos {
  const P = parts();
  const { wheelR: R, frontZ: ZF, rearZ: ZR, stemBase: SB, bar: B, gripX: GX } = SCOOTER_GEOMETRY;
  const top = B.y - 0.6; //                                                          the stem ends just under the bar
  const stemZ = (y: number) => SB.z + ((y - SB.y) * (B.z - 0.1 - SB.z)) / (top - SB.y); // on the raked stem
  const deckZ0 = ZF + 1.4, deckZ1 = ZR + 0.8, deckMid = (deckZ0 + deckZ1) / 2, deckLen = deckZ1 - deckZ0;
  P.matte.push(box(10, 2.6, deckLen, 0, 4.9, deckMid, C.trim, 1.2)); //             deck
  P.matte.push(box(8.4, 0.5, deckLen - 4.5, 0, 6.35, deckMid + 0.4, C.seat, 0.2)); // grip tape
  P.paint.push(box(10.4, 1.2, deckLen + 0.4, 0, 3.8, deckMid, C.white, 0.5)); //      coloured deck skirt
  P.paint.push(finish(side([[ZR - 4.5, 7.5], [ZR - 0.5, 10.2], [ZR + 5.5, 9.6], [ZR + 6.5, 7.8], [ZR - 0.5, 8.6]], 5.5, 0.8, 2), C.white, Math.PI / 5)); // rear fender
  P.matte.push(tube(v3(0, R, ZF), v3(0, 13, ZF + 0.6), 1.3, C.trim, 8)); //         fork
  P.paint.push(tube(v3(0, SB.y, SB.z), v3(0, top, B.z - 0.1), 1.6, C.white, 10)); // the stem, in the fleet colour, raked back
  P.matte.push(finish(side([[ZF - 4.5, 7.6], [ZF - 2, 10.2], [ZF + 2.5, 10.2], [ZF + 4, 8]], 5, 0.7, 2), C.trim, Math.PI / 5)); // front mudguard
  P.matte.push(box(2 * GX - 1.2, 1, 1.1, 0, B.y, B.z, C.trim, 0.4)); //            bar
  // GRIPS thinner than a fist (the cast's hands are 1.7–2.1 thick) and longer than one is wide (3.7–4.6),
  // so a closed hand hides the rubber and the grip still shows either side of it; their centres are the
  // rider's targets (avatar/riderPose)
  pair((s) => P.matte.push(box(4.4, 1.25, 1.3, s * GX, B.y, B.z, C.seat, 0.5)));
  pair((s) => P.matte.push(box(0.5, 1.4, 1.45, s * (GX + 2.4), B.y, B.z, C.trim, 0.2))); // bar-end caps, just proud of the grip
  P.gloss.push(box(4, 1, 2.6, 0, B.y + 1, B.z + 0.1, C.glass, 0.4)); //              display
  P.lights.push(cylZ(1.3, 1.2, 0, 15, stemZ(15) - 1.6, C.head, 10)); //              stem lamp
  P.lights.push(box(3, 1, 0.8, 0, 9.6, ZR + 6.7, C.tail, 0.3)); //                   tail lamp
  P.gloss.push(box(1.2, 1.2, 4, 0, 13.2, stemZ(13.2) + 0.3, C.chrome, 0.4)); //      folding clamp
  P.matte.push(tube(v3(-4.4, 3.8, ZR - 7.5), v3(-6.6, 0.2, ZR - 4.5), 0.5, C.trim, 5)); // kickstand
  wheel(R, 3.2, 0, ZF, 1, C.rimDark, 5, P);
  wheel(R, 3.2, 0, ZR, 1, C.rimDark, 5, P);
  return done(P);
}

/** A SCOOTER DOCK / RACK: a low kerbed slab under `count` docks, a charging rail with a post per dock at
 *  the nose end, and a slim totem with a lit panel at one end. Local frame: docks along x at `spacing`,
 *  their noses toward −z, centred on the origin. Same three-part layout as a vehicle, so it batches with
 *  the fleet at no extra draw. */
export function scooterDockGeos(count: number, spacing: number): VehicleGeos {
  const P = parts();
  const W = count * spacing + 16;
  P.matte.push(box(W, 1.4, 48, 0, 0.7, 2, 0x8f8a83, 0.6)); //                        slab
  P.gloss.push(box(W - 2, 0.3, 2, 0, 1.5, -20, C.accent)); //                        painted edge line
  P.matte.push(box(W - 8, 2.4, 2.4, 0, 9, -20, C.trim, 0.8)); //                      charging rail
  for (let i = 0; i < count; i++) {
    const x = (i - (count - 1) / 2) * spacing;
    P.matte.push(box(3.4, 9, 3.4, x, 5.5, -20, C.trim, 0.8)); //                     dock post
    P.lights.push(box(2.2, 0.8, 0.5, x, 8.4, -21.8, C.drl, 0.2)); //                 charge indicator
  }
  const tx = W / 2 - 3;
  P.matte.push(box(4, 34, 5, tx, 17, -18, C.trim, 1)); //                            totem
  P.paint.push(box(4.4, 18, 5.4, tx, 24, -18, C.white, 0.8)); //                     totem panel (fleet colour)
  P.lights.push(box(0.6, 12, 3.6, tx - 2.4, 24, -18, C.drl, 0.3)); //                lit strip
  return done(P);
}

// ---- the library ------------------------------------------------------------------------------------------
const BUILDERS: Record<VehicleKind, () => VehicleGeos> = {
  supercar: () => supercar(false), supercarWing: () => supercar(true), sport, pickup, sportbike, tricycle, etrike, jeepney, kalesa, scooter,
};
/** Build one kind's three geometries. Deterministic; the exterior calls it once per kind it parks. */
export function vehicleGeos(kind: VehicleKind): VehicleGeos {
  return BUILDERS[kind]();
}
/** triangles in one vehicle of a kind (all three parts) — for budgets and tests */
export function vehicleTriangles(g: VehicleGeos): number {
  return (g.paint.getAttribute("position").count + g.gloss.getAttribute("position").count + g.matte.getAttribute("position").count + g.lights.getAttribute("position").count) / 3;
}
