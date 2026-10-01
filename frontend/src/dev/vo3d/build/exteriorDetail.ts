// vo3d build — THE EXTERIOR'S CONSTRUCTION DETAIL, as geometry (EXTERIOR POLISH). build/exterior lays the
// world out; this module gives it the pieces that make the layout read as BUILT rather than as flat plates:
//
//   · terrain CELLS at grade, so open country meets the lots and the far sidewalks without a lip
//   · real KERB STONES (a chamfered profile) where every carriageway meets its curb band
//   · drainage gullies and manhole covers
//   · edge kerbs and tactile strips on the ramps; stone edging round the planting beds
//   · soft DECALS: worn verges along every path, contact shading round the Lab's plinth and causeways
//   · the LAKE (ring mesh carrying `aShore`, world/water's distance-from-waterline) and its graded beach
//   · the HORIZON: a continuous ridge ring and a belt of distant trees that keeps off the road corridors
//   · where the GROUND COVER goes (grass, flowers, ferns, reeds, stones), judged by the ground model itself
//
// Every function is deterministic and pure in its inputs; nothing here consumes the shared scatter stream.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Rect, Vec2 } from "../core/coords";
import {
  BED_Y, CURB_Y, GRADE, LOTS, MARK_Y, PAVING_Y, PLANTING_BEDS, POND_PATH, PARK_PATHS, RAMPS, ROADS, ROAD_Y, SHORE_Y,
  SIDEWALK_W, TERRAIN_Y, WALKS, WORLD_CENTRE, WORLD_RADIUS, campusShrubSpots, campusTreeSpots, roadVisibleSpan, type Ramp,
} from "../world/campus";
import { PAVED } from "../world/ailab";
import { LAB_FP } from "../world/labVariant";
const LAB_PLINTH = LAB_FP.plinth;
import { LAKE } from "../world/water";
import { exteriorGround, campusTrees, type SurfaceKind } from "../world/exteriorGround";
import { Part, lin, prng } from "./exteriorGeo";

/** a flat-ground geometry with the Baker's layout (position, normal, uv) from triangles in x/z at `y` */
function flatTris(tris: number[][], y: number): THREE.BufferGeometry {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [];
  for (const t of tris) for (let k = 0; k < 3; k++) { pos.push(t[k * 2], y, t[k * 2 + 1]); nrm.push(0, 1, 0); uv.push(0, 0); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
/** a convex polygon (x/z, any winding) as up-facing triangles */
function fan(poly: Vec2[]): number[][] {
  const out: number[][] = [];
  // signed area in x/z: an up-facing triangle is CLOCKWISE seen from above in x-right/z-down
  let area = 0;
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; area += a.x * b.z - b.x * a.z; }
  const p = area > 0 ? poly : [...poly].reverse();
  for (let i = 1; i < p.length - 1; i++) out.push([p[0].x, p[0].z, p[i + 1].x, p[i + 1].z, p[i].x, p[i].z]);
  return out;
}
/** clip a convex polygon to a rect (Sutherland–Hodgman) */
function clipToRect(poly: Vec2[], r: Rect): Vec2[] {
  let out = poly;
  const edges: [(p: Vec2) => number][] = [[(p) => p.x - r.x], [(p) => r.x + r.w - p.x], [(p) => p.z - r.z], [(p) => r.z + r.d - p.z]];
  for (const [f] of edges) {
    const inp = out;
    out = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[i], b = inp[(i + 1) % inp.length], fa = f(a), fb = f(b);
      if (fa >= 0) out.push(a);
      if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }); }
    }
    if (!out.length) break;
  }
  return out;
}

// ---- terrain ------------------------------------------------------------------------------------------
/** THE STREET CORRIDORS as drawn: carriageway plus both sidewalks, over each road's visible span */
export function corridorRects(): Rect[] {
  return ROADS.map((r) => {
    const s = roadVisibleSpan(r), half = r.width / 2 + SIDEWALK_W;
    return r.axis === "x" ? { x: s.from, z: r.at - half, w: s.to - s.from, d: 2 * half } : { x: r.at - half, z: s.from, w: 2 * half, d: s.to - s.from };
  });
}
/** OPEN COUNTRY: the world disc minus the street corridors and the lots, as non-overlapping convex cells at
 *  TERRAIN_Y — so it can sit 0.3 under the lawns without ever sharing a pixel's depth with one. */
export function terrainGeometry(): THREE.BufferGeometry {
  const covered = [...corridorRects(), ...LOTS.map((l) => l.rect)];
  const xs = new Set<number>([WORLD_CENTRE.x - WORLD_RADIUS, WORLD_CENTRE.x + WORLD_RADIUS]);
  const zs = new Set<number>([WORLD_CENTRE.z - WORLD_RADIUS, WORLD_CENTRE.z + WORLD_RADIUS]);
  for (const r of covered) { xs.add(r.x); xs.add(r.x + r.w); zs.add(r.z); zs.add(r.z + r.d); }
  const X = [...xs].filter((x) => Math.abs(x - WORLD_CENTRE.x) <= WORLD_RADIUS).sort((a, b) => a - b);
  const Z = [...zs].filter((z) => Math.abs(z - WORLD_CENTRE.z) <= WORLD_RADIUS).sort((a, b) => a - b);
  const circle: Vec2[] = Array.from({ length: 128 }, (_, i) => ({ x: WORLD_CENTRE.x + Math.cos((i / 128) * Math.PI * 2) * WORLD_RADIUS, z: WORLD_CENTRE.z + Math.sin((i / 128) * Math.PI * 2) * WORLD_RADIUS }));
  const tris: number[][] = [];
  for (let i = 0; i < X.length - 1; i++) for (let j = 0; j < Z.length - 1; j++) {
    const cell: Rect = { x: X[i], z: Z[j], w: X[i + 1] - X[i], d: Z[j + 1] - Z[j] };
    const cx = cell.x + cell.w / 2, cz = cell.z + cell.d / 2;
    if (covered.some((r) => cx > r.x && cx < r.x + r.w && cz > r.z && cz < r.z + r.d)) continue;
    const poly = clipToRect(circle, cell);
    if (poly.length >= 3) tris.push(...fan(poly));
  }
  return flatTris(tris, TERRAIN_Y);
}

// ---- kerbs, drainage, ramps, beds --------------------------------------------------------------------
/** A KERB STONE RUN: a chamfered profile swept along a straight line. `u` runs across it, away from the
 *  carriageway; the run's top is CURB_Y (the ground model's kerb height), its foot below the carriageway. */
function sweptProfile(a: Vec2, b: Vec2, across: Vec2, profile: [number, number][]): THREE.BufferGeometry {
  const pos: number[] = [];
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), D = new THREE.Vector3(), n = new THREE.Vector3(), want = new THREE.Vector3();
  for (let k = 0; k < profile.length - 1; k++) {
    const [u0, y0] = profile[k], [u1, y1] = profile[k + 1];
    A.set(a.x + across.x * u0, y0, a.z + across.z * u0); B.set(a.x + across.x * u1, y1, a.z + across.z * u1);
    C.set(b.x + across.x * u1, y1, b.z + across.z * u1); D.set(b.x + across.x * u0, y0, b.z + across.z * u0);
    // the profile's outside, in its own plane: (−dy, du) — toward the carriageway on the face, up on the top
    want.set(across.x * -(y1 - y0), u1 - u0, across.z * -(y1 - y0));
    n.subVectors(B, A).cross(C.clone().sub(A));
    const q = n.dot(want) >= 0 ? [A, B, C, A, C, D] : [A, C, B, A, D, C];
    for (const v of q) pos.push(v.x, v.y, v.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.computeVertexNormals();
  return g;
}
export function kerbGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const r of ROADS) {
    const s = roadVisibleSpan(r);
    for (const side of [-1, 1] as const) {
      const e = r.at + (side * r.width) / 2;
      const a: Vec2 = r.axis === "x" ? { x: s.from, z: e } : { x: e, z: s.from };
      const b: Vec2 = r.axis === "x" ? { x: s.to, z: e } : { x: e, z: s.to };
      const across: Vec2 = r.axis === "x" ? { x: 0, z: side } : { x: side, z: 0 };
      // the carriageway face, its chamfered arris, the top — then the sidewalk takes over at u 0
      const prof: [number, number][] = [[-5, ROAD_Y - 0.2], [-5, CURB_Y - 0.75], [-4.1, CURB_Y], [0.5, CURB_Y]];
      parts.push(sweptProfile(a, b, across, prof));
    }
  }
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()), false)!;
  return g;
}

/** GULLIES at the gutters and MANHOLE COVERS in the lanes and the campus walks — near the block only */
export function drainageGeometry(): THREE.BufferGeometry {
  const rnd = prng(0xd7a1);
  const parts: THREE.BufferGeometry[] = [];
  const NEAR = 2600;
  const grate = (x: number, z: number, along: "x" | "z", y: number) => {
    const g = new THREE.PlaneGeometry(along === "x" ? 13 : 7, along === "x" ? 7 : 13).rotateX(-Math.PI / 2).translate(x, y, z);
    parts.push(g);
    for (let k = -2; k <= 2; k++) parts.push(new THREE.PlaneGeometry(along === "x" ? 1 : 5.4, along === "x" ? 5.4 : 1).rotateX(-Math.PI / 2).translate(x + (along === "x" ? k * 2.4 : 0), y + 0.02, z + (along === "x" ? 0 : k * 2.4)));
  };
  const cover = (x: number, z: number, y: number, r = 7) => parts.push(new THREE.CircleGeometry(r, 12).rotateX(-Math.PI / 2).translate(x, y, z), new THREE.RingGeometry(r * 0.55, r * 0.62, 12).rotateX(-Math.PI / 2).translate(x, y + 0.02, z));
  for (const r of ROADS) {
    const s = roadVisibleSpan(r), c = r.axis === "x" ? WORLD_CENTRE.x : WORLD_CENTRE.z;
    for (let t = Math.max(s.from, c - NEAR); t < Math.min(s.to, c + NEAR); t += 290) {
      for (const side of [-1, 1] as const) {
        const u = r.at + side * (r.width / 2 - 9);
        if (r.axis === "x") grate(t + 40, u, "x", MARK_Y + 0.04); else grate(u, t + 40, "z", MARK_Y + 0.04);
      }
      if (rnd() < 0.55) {
        const u = r.at + (rnd() < 0.5 ? -1 : 1) * r.width * 0.24;
        if (r.axis === "x") cover(t + 170, u, MARK_Y + 0.05); else cover(u, t + 170, MARK_Y + 0.05);
      }
    }
  }
  for (const w of WALKS) if (w.w * w.d > 6000) cover(w.x + w.w * (0.3 + rnd() * 0.4), w.z + w.d * (0.3 + rnd() * 0.4), PAVING_Y + 0.05, 5.5);
  return mergeGeometries(parts.map((p) => { const q = p.index ? p.toNonIndexed() : p; for (const k of Object.keys(q.attributes)) if (k !== "position" && k !== "normal" && k !== "uv") q.deleteAttribute(k); return q; }), false)!;
}

/** EDGE KERBS along both long sides of a ramp, riding its slope 1.1 proud, and a stone cheek face below */
export function rampEdgeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const r of RAMPS) parts.push(...rampKerbs(r));
  return mergeGeometries(parts, false)!;
}
function rampKerbs(r: Ramp): THREE.BufferGeometry[] {
  const along = r.axis === "x" ? r.rect.w : r.rect.d;
  const W = 2.6, base = GRADE - 0.5;
  const sh = new THREE.Shape();
  sh.moveTo(0, r.fromY + 1.1); sh.lineTo(along, r.toY + 1.1); sh.lineTo(along, base); sh.lineTo(0, base); sh.closePath();
  // the same frame as build/exterior rampWedge: shape x along the ramp, the extrusion (+z) across it; for a
  // z ramp, rotation −π/2 about y sends shape x → world +z and the extrusion → world −x
  return [0, 1].map((side) => {
    const g = new THREE.ExtrudeGeometry(sh, { depth: W, bevelEnabled: false });
    const m = new THREE.Matrix4();
    if (r.axis === "x") m.makeTranslation(r.rect.x, 0, side === 0 ? r.rect.z - W : r.rect.z + r.rect.d);
    else m.makeRotationY(-Math.PI / 2).setPosition(side === 0 ? r.rect.x : r.rect.x + r.rect.w + W, 0, r.rect.z);
    g.applyMatrix4(m);
    return g.toNonIndexed();
  });
}
/** tactile warning strips across the top and the foot of each ramp (flat, a hair above its surface) */
export function rampStripGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const r of RAMPS) for (const end of [0, 1]) {
    const y = (end ? r.toY : r.fromY) + 0.08, d = 5;
    const g = r.axis === "x"
      ? new THREE.PlaneGeometry(d, r.rect.d - 4).rotateX(-Math.PI / 2).translate(end ? r.rect.x + r.rect.w - d / 2 - 1 : r.rect.x + d / 2 + 1, y, r.rect.z + r.rect.d / 2)
      : new THREE.PlaneGeometry(r.rect.w - 4, d).rotateX(-Math.PI / 2).translate(r.rect.x + r.rect.w / 2, y, end ? r.rect.z + r.rect.d - d / 2 - 1 : r.rect.z + d / 2 + 1);
    parts.push(g.toNonIndexed());
  }
  return mergeGeometries(parts, false)!;
}
/** stone edging round the campus planting beds, just inside their rects */
export function bedEdgingGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const w = 2.6, h = 1.7;
  for (const b of PLANTING_BEDS) {
    const y = BED_Y - 0.4 + h / 2;
    parts.push(new THREE.BoxGeometry(b.w, h, w).translate(b.x + b.w / 2, y, b.z + w / 2));
    parts.push(new THREE.BoxGeometry(b.w, h, w).translate(b.x + b.w / 2, y, b.z + b.d - w / 2));
    parts.push(new THREE.BoxGeometry(w, h, b.d - 2 * w).translate(b.x + w / 2, y, b.z + b.d / 2));
    parts.push(new THREE.BoxGeometry(w, h, b.d - 2 * w).translate(b.x + b.w - w / 2, y, b.z + b.d / 2));
  }
  return mergeGeometries(parts.map((p) => p.toNonIndexed()), false)!;
}

// ---- decals: worn verges and contact shading ---------------------------------------------------------
/** SOFT GROUND DECALS with vertex RGBA: a band out from an edge, opaque-ish at the edge and gone at its far
 *  side. Worn grass along every path; darker contact shading round the Lab's plinth and causeways (the Lab
 *  is out of the shadow pass, so without this it floats on the lawn). */
export function decalGeometry(): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], nrm: number[] = [];
  const band = (a: Vec2, b: Vec2, out: Vec2, width: number, y: number, c: THREE.Color, alpha: number) => {
    const A = [a.x, y, a.z], B = [b.x, y, b.z], C = [b.x + out.x * width, y, b.z + out.z * width], D = [a.x + out.x * width, y, a.z + out.z * width];
    // wound so its face is up whichever side `out` points
    const cross = (b.x - a.x) * out.z - (b.z - a.z) * out.x;
    const tris = cross > 0 ? [A, C, B, A, D, C] : [A, B, C, A, C, D];
    for (const v of tris) {
      const edge = v === A || v === B;
      pos.push(v[0], v[1], v[2]); nrm.push(0, 1, 0);
      col.push(c.r, c.g, c.b, edge ? alpha : 0);
    }
  };
  const rectBands = (r: Rect, width: number, y: number, c: THREE.Color, alpha: number) => {
    band({ x: r.x, z: r.z }, { x: r.x + r.w, z: r.z }, { x: 0, z: -1 }, width, y, c, alpha);
    band({ x: r.x + r.w, z: r.z + r.d }, { x: r.x, z: r.z + r.d }, { x: 0, z: 1 }, width, y, c, alpha);
    band({ x: r.x, z: r.z + r.d }, { x: r.x, z: r.z }, { x: -1, z: 0 }, width, y, c, alpha);
    band({ x: r.x + r.w, z: r.z }, { x: r.x + r.w, z: r.z + r.d }, { x: 1, z: 0 }, width, y, c, alpha);
  };
  const worn = lin(0x9c9862), contact = lin(0x2a3324);
  for (const w of [...WALKS, POND_PATH, ...PARK_PATHS]) rectBands(w, 9, GRADE + 0.06, worn, 0.7);
  for (const p of PAVED) rectBands(p, 14, GRADE + 0.07, contact, 0.5);
  // the Lab plinth's outline, pushed outward from its centroid
  const cx = LAB_PLINTH.reduce((a, p) => a + p.x, 0) / LAB_PLINTH.length, cz = LAB_PLINTH.reduce((a, p) => a + p.z, 0) / LAB_PLINTH.length;
  for (let i = 0; i < LAB_PLINTH.length; i++) {
    const a = LAB_PLINTH[i], b = LAB_PLINTH[(i + 1) % LAB_PLINTH.length];
    let ox = b.z - a.z, oz = -(b.x - a.x);
    const len = Math.hypot(ox, oz);
    ox /= len; oz /= len;
    if (ox * ((a.x + b.x) / 2 - cx) + oz * ((a.z + b.z) / 2 - cz) < 0) { ox = -ox; oz = -oz; }
    band(a, b, { x: ox, z: oz }, 22, GRADE + 0.08, contact, 0.6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
  return g;
}

// ---- the lake ----------------------------------------------------------------------------------------
/** THE LAKE'S RINGS: the waterline scaled toward the centre (the outline is star-shaped), denser toward
 *  the shore. Each vertex carries `aShore` — its distance in from the waterline along the ray, the very
 *  number world/water shoreDistance computes — so the shader's shallow shelf IS the data's shallow shelf. */
export function lakeGeometry(rings = 10): THREE.BufferGeometry {
  const c = LAKE.centre, pts = LAKE.outline.slice(0, -1);
  const pos: number[] = [0, 0, 0], shore: number[] = [], idx: number[] = [];
  const r0 = pts.reduce((a, p) => a + Math.hypot(p.x - c.x, p.z - c.z), 0) / pts.length;
  shore.push(r0);
  for (let k = 1; k <= rings; k++) {
    const t = 1 - Math.pow(1 - k / rings, 1.7);
    for (const p of pts) {
      pos.push((p.x - c.x) * t, 0, (p.z - c.z) * t);
      shore.push((1 - t) * Math.hypot(p.x - c.x, p.z - c.z));
    }
  }
  const n = pts.length, at = (k: number, i: number) => 1 + (k - 1) * n + (i % n);
  for (let i = 0; i < n; i++) idx.push(0, at(1, i + 1), at(1, i));
  for (let k = 1; k < rings; k++) for (let i = 0; i < n; i++) {
    const a = at(k, i), b = at(k, i + 1), cc = at(k + 1, i + 1), d = at(k + 1, i);
    idx.push(a, b, cc, a, cc, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aShore", new THREE.Float32BufferAttribute(shore, 1));
  // wound for an up face whichever way the outline runs
  const p0 = new THREE.Vector3(pos[idx[0] * 3], 0, pos[idx[0] * 3 + 2]), p1 = new THREE.Vector3(pos[idx[1] * 3], 0, pos[idx[1] * 3 + 2]), p2 = new THREE.Vector3(pos[idx[2] * 3], 0, pos[idx[2] * 3 + 2]);
  if (p1.sub(p0).cross(p2.sub(p0)).y < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  g.setIndex(idx);
  const nn = new Float32Array((pos.length / 3) * 3);
  for (let i = 0; i < pos.length / 3; i++) nn[i * 3 + 1] = 1;
  g.setAttribute("normal", new THREE.BufferAttribute(nn, 3));
  g.translate(c.x, 0, c.z);
  return g;
}
/** THE BEACH: from under the waterline out past the shore band, wet and dark at the water, dry sand
 *  behind, feathering into the lawn's own green at its outer rim */
export function shoreGeometry(band: number): THREE.BufferGeometry {
  const c = LAKE.centre, pts = LAKE.outline.slice(0, -1);
  const rx = pts.reduce((a, p) => Math.max(a, Math.abs(p.x - c.x)), 0);
  const g1 = 1 + band / rx;
  const rings: { t: number; col: THREE.Color }[] = [
    { t: 0.92, col: lin(0x6f6552) }, { t: 1.0, col: lin(0x857a63) }, { t: 1.012, col: lin(0x9a8e75) },
    { t: (1 + g1) / 2, col: lin(0xb4a78b) }, { t: g1 - 0.006, col: lin(0xa9a27d) }, { t: g1, col: lin(0x93a46a) },
  ];
  const P = new Part();
  const ids = rings.map((r) => pts.map((p) => P.v(c.x + (p.x - c.x) * r.t, 0, c.z + (p.z - c.z) * r.t, r.col)));
  const n = pts.length;
  for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < n; i++) P.quad(ids[k][i], ids[k][(i + 1) % n], ids[k + 1][(i + 1) % n], ids[k + 1][i]);
  const g = P.geometry(false);
  if (g.getAttribute("normal").getY(0) < 0) {
    const p = g.getAttribute("position") as THREE.BufferAttribute, cl = g.getAttribute("color") as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i += 3) for (const a of [p, cl]) { const t = [a.getX(i + 1), a.getY(i + 1), a.getZ(i + 1)]; a.setXYZ(i + 1, a.getX(i + 2), a.getY(i + 2), a.getZ(i + 2)); a.setXYZ(i + 2, t[0], t[1], t[2]); }
    g.computeVertexNormals();
  }
  g.translate(0, SHORE_Y, 0);
  return g;
}

// ---- the horizon ------------------------------------------------------------------------------------
/** THE RIDGE: one continuous faceted ring of low hills round the world, rising behind the tree belt and
 *  catching the ends of the streets — no gaps, no single blob reading as a stamped hill. */
export function ridgeGeometry(): THREE.BufferGeometry {
  const seg = 192;
  const rnd = prng(0x81d6e);
  const ph = [rnd() * 6, rnd() * 6, rnd() * 6, rnd() * 6, rnd() * 6];
  // RESTRAINED VARIATION: the rolling base line, a handful of named summits (broad, a few sharper) and two
  // saddles, so the horizon has landmarks to read against instead of one even swell all the way round
  const summits = Array.from({ length: 7 }, () => ({ a: rnd() * Math.PI * 2, amp: 70 + rnd() * 120, w: 0.09 + rnd() * 0.16 }));
  const saddles = Array.from({ length: 2 }, () => ({ a: rnd() * Math.PI * 2, amp: 45 + rnd() * 30, w: 0.18 + rnd() * 0.1 }));
  const bump = (a: number, b: { a: number; amp: number; w: number }) => { const d = Math.atan2(Math.sin(a - b.a), Math.cos(a - b.a)) / b.w; return b.amp * Math.exp(-d * d); };
  const crest = (a: number) => {
    let h = 150 + 95 * Math.sin(3 * a + ph[0]) + 60 * Math.sin(5 * a + ph[1]) + 38 * Math.sin(9 * a + ph[2]) + 22 * Math.sin(17 * a + ph[3]) + 10 * Math.sin(29 * a + ph[4]);
    for (const s of summits) h += bump(a, s);
    for (const s of saddles) h -= bump(a, s);
    return Math.max(70, h); // never sinks below the road ends it closes
  };
  // the crest line wanders in and out a little, so the ring is not a drawn circle
  const wander = (a: number) => 70 * Math.sin(4 * a + ph[1]) + 40 * Math.sin(7 * a + ph[3]);
  const radial: { r: number; h: number; col: number; wander: number }[] = [
    { r: 4720, h: -4, col: 0x6f925f, wander: 0 }, { r: 4920, h: 0.42, col: 0x6a8d5e, wander: 0 }, { r: 5090, h: 1, col: 0x7e9a79, wander: 1 },
    { r: 5260, h: 0.72, col: 0x8ea48f, wander: 0.8 }, { r: 5480, h: 0.18, col: 0x98ac9c, wander: 0.4 },
  ];
  const rock = lin(0xa3aa9c);
  const P = new Part();
  const ids = radial.map((rr) => Array.from({ length: seg }, (_, i) => {
    const a = (i / seg) * Math.PI * 2, j = 1 + (prng(i * 31 + rr.r)() - 0.5) * 0.1;
    const c = crest(a);
    const h = rr.h < 0 ? GRADE + rr.h : GRADE + c * rr.h * j;
    const r = rr.r + wander(a) * rr.wander;
    // the high summits show a paler, rockier crown
    const col = lin(rr.col).lerp(rock, rr.h >= 0.72 ? Math.max(0, Math.min(1, (c - 260) / 120)) * 0.6 : 0);
    return P.v(WORLD_CENTRE.x + Math.cos(a) * r, h, WORLD_CENTRE.z + Math.sin(a) * r, col);
  }));
  for (let k = 0; k < radial.length - 1; k++) for (let i = 0; i < seg; i++) {
    const i2 = (i + 1) % seg;
    P.quad(ids[k][i], ids[k + 1][i], ids[k + 1][i2], ids[k][i2]);
  }
  const g = P.geometry(false);
  // faces up/inward: flip if the first face points down
  if (g.getAttribute("normal").getY(0) < 0) {
    const p = g.getAttribute("position") as THREE.BufferAttribute, cl = g.getAttribute("color") as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i += 3) for (const at of [p, cl]) { const t = [at.getX(i + 1), at.getY(i + 1), at.getZ(i + 1)]; at.setXYZ(i + 1, at.getX(i + 2), at.getY(i + 2), at.getZ(i + 2)); at.setXYZ(i + 2, t[0], t[1], t[2]); }
    g.computeVertexNormals();
  }
  return g;
}

/** THE DISTANT BELT: cheap but recognisable trees (a fir, a broadleaf) on three staggered rows, kept off the
 *  street corridors so each road runs out between them to the ridge. */
export function beltGeometries(): THREE.BufferGeometry[] {
  const fir = new Part(), broad = new Part();
  const dark = lin(0x3d5f46), mid = lin(0x4f7a4c), light = lin(0x6b9361), trunk = lin(0x5b4636);
  // fir: two star tiers and a stub
  const tier = (P: Part, y0: number, h: number, r: number, n: number, c0: THREE.Color, c1: THREE.Color) => {
    const apex = P.v(0, y0 + h, 0, c1), rim = Array.from({ length: n }, (_, k) => P.v(Math.cos((k / n) * Math.PI * 2) * r * (k % 2 ? 0.75 : 1), y0, Math.sin((k / n) * Math.PI * 2) * r * (k % 2 ? 0.75 : 1), c0));
    for (let k = 0; k < n; k++) P.tri(apex, rim[(k + 1) % n], rim[k]);
  };
  tier(fir, 14, 46, 22, 8, dark, mid);
  tier(fir, 40, 40, 15, 6, mid, light);
  const stub = (P: Part, h: number) => { const a = P.v(-2, 0, 0, trunk), b = P.v(2, 0, 0, trunk), c = P.v(0, h, 0, trunk), d = P.v(0, 0, 2, trunk); P.tri(a, c, b); P.tri(b, c, d); P.tri(d, c, a); };
  stub(fir, 16);
  // broadleaf: one jittered mass on a stub
  const rnd = prng(0xbe17);
  const t = (1 + Math.sqrt(5)) / 2;
  const V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((v) => new THREE.Vector3(...v).normalize());
  const F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const ids = V.map((v) => { const j = 1 + (rnd() - 0.5) * 0.3; return broad.v(v.x * 28 * j, 40 + v.y * 26 * j, v.z * 28 * j, v.y > 0.3 ? light : v.y < -0.3 ? dark : mid); });
  for (const [a, b, c] of F) broad.tri(ids[a], ids[b], ids[c]);
  stub(broad, 22);
  return [fir.geometry(false), broad.geometry(false)];
}
export type BeltSpot = { x: number; z: number; s: number; yaw: number; kind: 0 | 1 };
export function beltSpots(): BeltSpot[] {
  const rnd = prng(0x4e17);
  const corridors = corridorRects().map((r) => ({ x: r.x - 40, z: r.z - 40, w: r.w + 80, d: r.d + 80 }));
  const out: BeltSpot[] = [];
  for (const [radius, count, spread] of [[3990, 200, 160], [4330, 180, 200], [4660, 150, 220]] as const) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rnd() * 0.02;
      const rr = radius + (rnd() - 0.5) * spread;
      const x = WORLD_CENTRE.x + Math.cos(a) * rr, z = WORLD_CENTRE.z + Math.sin(a) * rr;
      const s = 1.05 + rnd() * 0.9, yaw = rnd() * 6.28, kind = (rnd() < 0.45 ? 0 : 1) as 0 | 1;
      if (corridors.some((r) => x > r.x && x < r.x + r.w && z > r.z && z < r.z + r.d)) continue;
      out.push({ x, z, s, yaw, kind });
    }
  }
  return out;
}

// ---- ground cover placement ---------------------------------------------------------------------------
export type CoverKind = "tuft" | "tuftTall" | "tuftWide" | "flowerWhite" | "flowerYellow" | "flowerViolet" | "fern" | "reed" | "pebble" | "stone" | "boulder";
export type CoverSpot = { kind: CoverKind; x: number; z: number; y: number; s: number; yaw: number };
const GRASSY = new Set<SurfaceKind>(["lawn", "terrain", "shore", "bed"]);
/** WHERE THE GROUND COVER GOES — composed like the trees, never a uniform scatter: round tree bases, along
 *  path edges, in a handful of meadow drifts, at the water's edge and in the beds. Each spot is checked
 *  against the ground model, so nothing grows on paving or in the lake, and stands on the surface it is on. */
export function coverSpots(): CoverSpot[] {
  const G = exteriorGround();
  const rnd = prng(0xc0ffee);
  const out: CoverSpot[] = [];
  const put = (kind: CoverKind, x: number, z: number, s: number, allow = GRASSY) => {
    const g = G.groundAt({ x, z });
    if (!allow.has(g.kind)) return;
    out.push({ kind, x, z, y: g.y, s, yaw: rnd() * 6.283 });
  };
  const grassKind = (): CoverKind => { const r = rnd(); return r < 0.5 ? "tuft" : r < 0.8 ? "tuftTall" : "tuftWide"; };
  const flower = (): CoverKind => { const r = rnd(); return r < 0.45 ? "flowerWhite" : r < 0.8 ? "flowerYellow" : "flowerViolet"; };
  // 1. round every tree's base: tufts in the root zone, now and then a fern or a flower
  const trees = campusTrees();
  for (const kind of Object.keys(trees) as (keyof typeof trees)[]) for (const t of trees[kind]) {
    if (t.y !== undefined) continue; // the car park's island trees stand on kerbed soil
    const n = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.283, r = (6 + rnd() * 14) * t.s;
      put(rnd() < 0.18 ? "fern" : rnd() < 0.12 ? flower() : grassKind(), t.x + Math.cos(a) * r, t.z + Math.sin(a) * r, 0.8 + rnd() * 0.5);
    }
  }
  // 2. along the path edges: the uncut fringe where the mower does not reach
  for (const w of [...WALKS, ...PAVED, POND_PATH, ...PARK_PATHS]) {
    const edges: [Vec2, Vec2, Vec2][] = [
      [{ x: w.x, z: w.z }, { x: w.x + w.w, z: w.z }, { x: 0, z: -1 }], [{ x: w.x, z: w.z + w.d }, { x: w.x + w.w, z: w.z + w.d }, { x: 0, z: 1 }],
      [{ x: w.x, z: w.z }, { x: w.x, z: w.z + w.d }, { x: -1, z: 0 }], [{ x: w.x + w.w, z: w.z }, { x: w.x + w.w, z: w.z + w.d }, { x: 1, z: 0 }],
    ];
    for (const [a, b, o] of edges) {
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      for (let d = 6; d < L - 4; d += 15 + rnd() * 10) {
        const f = d / L, off = 3 + rnd() * 7;
        put(rnd() < 0.1 ? flower() : grassKind(), a.x + (b.x - a.x) * f + o.x * off, a.z + (b.z - a.z) * f + o.z * off, 0.7 + rnd() * 0.5);
      }
    }
  }
  // 3. MEADOW DRIFTS: wild corners left uncut, each a loose ellipse of grasses and flowers
  const drifts: [number, number, number, number, number][] = [
    // x, z, rx, rz, count — round the lake, the Lab's flanks, the rear campus margins, the parcels and fields
    [120, -1180, 120, 70, 34], [1380, -1180, 130, 80, 34], [740, -1830, 260, 70, 40], [260, -560, 70, 120, 22], [1280, -520, 70, 110, 22],
    [-520, -380, 150, 90, 28], [1900, -560, 160, 110, 30], [1960, 760, 110, 160, 26], [-560, 1240, 120, 70, 20],
    [3200, -300, 260, 200, 40], [-1700, 400, 240, 200, 40], [600, 2500, 300, 160, 40], [-300, -2600, 320, 160, 40], [2000, -2700, 300, 150, 36],
  ];
  for (const [x, z, rx, rz, count] of drifts) for (let i = 0; i < count; i++) {
    const a = rnd() * 6.283, rr = Math.sqrt(rnd());
    const r = rnd();
    put(r < 0.4 ? "tuftTall" : r < 0.72 ? flower() : r < 0.86 ? "fern" : "tuftWide", x + Math.cos(a) * rx * rr, z + Math.sin(a) * rz * rr, 0.8 + rnd() * 0.6);
  }
  // 4. THE WATER'S EDGE: reeds in three arcs, pebbles along the waterline, a few stones and boulders
  const c = LAKE.centre, pts = LAKE.outline;
  for (const [a0, a1] of [[0.3, 1.15], [2.5, 3.2], [4.3, 5.1]] as const)
    for (let i = 0; i < 9; i++) {
      const a = a0 + (a1 - a0) * (i / 8) + (rnd() - 0.5) * 0.05;
      const p = pts[Math.floor(((a / 6.283) % 1) * (pts.length - 1))];
      const t = 1.02 + rnd() * 0.05;
      put("reed", c.x + (p.x - c.x) * t, c.z + (p.z - c.z) * t, 0.9 + rnd() * 0.4, new Set(["shore", "lawn"]));
    }
  for (let i = 0; i < pts.length - 1; i++) {
    for (let k = 0; k < 2; k++) {
      const p = pts[i], q = pts[i + 1], f = rnd();
      const t = 1.005 + rnd() * 0.035;
      const x = c.x + (p.x + (q.x - p.x) * f - c.x) * t, z = c.z + (p.z + (q.z - p.z) * f - c.z) * t;
      put(rnd() < 0.82 ? "pebble" : "stone", x, z, 0.6 + rnd() * 0.8, new Set(["shore"]));
    }
  }
  for (const [x, z] of [[160, -1300], [1330, -1560], [520, -1720], [1100, -1180], [300, -1520]] as const) put("boulder", x, z, 0.9 + rnd() * 0.5, new Set(["shore", "lawn"]));
  // 5. THE BEDS: low planting between their shrubs
  for (const b of PLANTING_BEDS) {
    const n = Math.max(6, Math.round((b.w * b.d) / 2600));
    for (let i = 0; i < n; i++) put(rnd() < 0.5 ? flower() : rnd() < 0.5 ? "fern" : "tuftWide", b.x + 8 + rnd() * (b.w - 16), b.z + 8 + rnd() * (b.d - 16), 0.8 + rnd() * 0.4);
  }
  // 6. the foot of the Lab's plinth: a fringe where the mower stops short of the stone
  for (let i = 0; i < LAB_PLINTH.length; i++) {
    const a = LAB_PLINTH[i], b = LAB_PLINTH[(i + 1) % LAB_PLINTH.length], L = Math.hypot(b.x - a.x, b.z - a.z);
    const cx = 740, cz = -710;
    for (let d = 8; d < L; d += 20 + rnd() * 14) {
      const f = d / L, x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f;
      const ox = x - cx, oz = z - cz, ol = Math.hypot(ox, oz) || 1;
      put(rnd() < 0.15 ? "stone" : grassKind(), x + (ox / ol) * (3 + rnd() * 6), z + (oz / ol) * (3 + rnd() * 6), 0.8 + rnd() * 0.4);
    }
  }
  return out;
}
/** reproduce the planting stream for the shrubs (exported for build/exterior, which resumes it) */
export const shrubStream = (): ReturnType<typeof campusShrubSpots> => campusShrubSpots(campusTreeSpots().seedAfter);
