// vo3d build — THE TREEHOUSE: decks, railings, routes, the MonkeyAgent RESIDENCE and the props of home.
//
// TIMBER AND A LITTLE STEEL. Everything here is a premium modern treehouse — planked decks scan-cut to their real
// outlines, round timber posts on steel shoes, knee braces off the trunk, balustrades with rope, a ship stair, a
// brass fire pole — wrapped round the hero tree (build/labTree) and built from world/ailabV2's numbers, so every
// edge an agent mantles onto, every rung it climbs and every rail it leans on is where its traversal says it is.
//
// THE RESIDENCE is the diegetic home of every agent not on show: three joined board-and-batten volumes with
// standing-seam hip roofs, warm windows that glimpse (never model) an interior, an entry door, an upper balcony
// and a covered sleeping porch. Its windows are a PRACTICAL, so by day they read as glass and after dusk the
// whole home glows warm against the Lab's cool screens.
import * as THREE from "three";
import { ColorBaker, Part, prng, lin } from "./exteriorGeo";
import { shrubGeometry, tube, BARK } from "./exteriorFoliage";
import { pool, cellUV, type Cell, type ScreenBank } from "./labMaterials";
import { openShelf } from "./labShell";
import {
  CLIMB, HANG, JUMP_PAD, L1, L1_POSTS, L2, L2_POSTS, POLE, RAMP, RESIDENCE, STAIR, SW_BRANCH, TOUCAN_LIMB, TREE, TRUNK, WEST_LIMB,
  IDLE_SPOTS, JOB_BOARD, l1Rim, l1Slot, l2Rim, polar,
} from "../world/ailabV2";
import type { Vec2 } from "../core/coords";
import type { V3 } from "../world/monkeyTraversal";

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const tv = (p: V3) => V(p.x, p.y, p.z);
const TIMBER = [0xb98a5c, 0xc49567, 0xad7f53, 0xbf9161, 0xb28457];
const T_DARK = 0x7d5b3c, T_EDGE = 0x8c6644, STEEL = 0x5d6670, BRASS = 0xc9a25a;

/** the pieces the treehouse hands back, one geometry per material (merged by the Lab builder) */
export type TreehouseParts = {
  timber: ColorBaker; dark: ColorBaker; metal: ColorBaker; roof: ColorBaker; fabric: ColorBaker; plaster: ColorBaker;
  bark: Part; leaves: THREE.BufferGeometry[]; lanterns: ColorBaker; spill: ColorBaker; windows: WindowBank; indicators: ColorBaker;
};

// ============================== WINDOWS ======================================================================
/** the residence's glazing: quads into the atlas's interior cells, one practical material for all */
export class WindowBank {
  readonly pos: number[] = [];
  readonly uv: number[] = [];
  /** `crop`: take a centred band of the cell matching the quad's aspect (long signs), instead of stretching it */
  add(cell: Cell, c: THREE.Vector3, w: number, h: number, yaw: number, crop = false): void {
    const r = V(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(w / 2), up = V(0, h / 2, 0);
    const p = [c.clone().sub(r).sub(up), c.clone().add(r).sub(up), c.clone().add(r).add(up), c.clone().sub(r).add(up)];
    const u = cellUV(cell, crop ? 2 : 22);
    if (crop) { const vc = (u.v0 + u.v1) / 2, half = ((u.u1 - u.u0) * 2 * (h / w)) / 2; u.v0 = vc - half; u.v1 = vc + half; }
    const uvs = [[u.u0, u.v0], [u.u1, u.v0], [u.u1, u.v1], [u.u0, u.v1]];
    for (const k of [0, 1, 2, 0, 2, 3]) { this.pos.push(p[k].x, p[k].y, p[k].z); this.uv.push(uvs[k][0], uvs[k][1]); }
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    return g;
  }
}

// ============================== DECKS ========================================================================
const inPoly = (p: Vec2, poly: readonly Vec2[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
};
/** PLANKS: scan the outline (minus its holes) in strips across `angle`, one plank box per covered run, each its
 *  own shade — a real deck, cut to the shape, with the joints the strips make */
function planks(T: ColorBaker, poly: readonly Vec2[], holes: readonly (readonly Vec2[])[], y: number, angle: number, rnd: () => number, w = 5.2, t = 1.2): void {
  const c = Math.cos(angle), s = Math.sin(angle);
  const toL = (p: Vec2) => ({ u: p.x * c + p.z * s, v: -p.x * s + p.z * c });
  const toW = (u: number, v: number) => ({ x: u * c - v * s, z: u * s + v * c });
  const ls = poly.map(toL);
  const v0 = Math.min(...ls.map((p) => p.v)), v1 = Math.max(...ls.map((p) => p.v)), u0 = Math.min(...ls.map((p) => p.u)) - 2, u1 = Math.max(...ls.map((p) => p.u)) + 2;
  const inside = (u: number, v: number) => { const p = toW(u, v); return inPoly(p, poly) && !holes.some((h) => inPoly(p, h)); };
  for (let v = v0 + w / 2; v < v1; v += w) {
    let start: number | null = null;
    for (let u = u0; u <= u1 + 2; u += 2) {
      const ok = u <= u1 && inside(u, v);
      if (ok && start === null) start = u;
      if (!ok && start !== null) {
        const len = u - start;
        if (len > 3) {
          // long runs are laid as boards of 40–70 with staggered butt joints
          let a = start;
          while (a < u - 1) {
            const L = Math.min(u - a, 40 + rnd() * 30);
            const m = toW(a + L / 2, v);
            T.boxAt(L - 0.35, t, w - 0.45, m.x, y - t / 2, m.z, TIMBER[Math.floor(rnd() * TIMBER.length)], angle === 0 ? 0 : -angle);
            a += L;
          }
        }
        start = null;
      }
    }
  }
}
/** the slab under the planks (seen from below and at the edge), with the deck's holes cut through it */
function deckSlab(D: ColorBaker, poly: readonly Vec2[], holes: readonly (readonly Vec2[])[], top: number, t: number): void {
  const sh = new THREE.Shape();
  poly.forEach((p, i) => (i ? sh.lineTo(p.x, -p.z) : sh.moveTo(p.x, -p.z)));
  for (const h of holes) { const pa = new THREE.Path(); h.forEach((p, i) => (i ? pa.lineTo(p.x, -p.z) : pa.moveTo(p.x, -p.z))); sh.holes.push(pa); }
  const g = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, top - t - 1.2, 0);
  D.add(g, null, T_DARK);
}
/** the edge beam round an outline, under its planks' outer edge (its top sits 0.12 below the plank tops: the
 *  two were coplanar along every rim, which z-fought as the camera moved) */
function fascia(T: ColorBaker, poly: readonly Vec2[], top: number, h = 4.4): void {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], L = Math.hypot(b.x - a.x, b.z - a.z);
    T.boxAt(2.2, h, L + 2, (a.x + b.x) / 2, top - 0.12 - h / 2, (a.z + b.z) / 2, T_EDGE, Math.atan2(b.x - a.x, b.z - a.z));
  }
}
/** A BALUSTRADE along a polyline: posts, a capped top rail, a rope mid-rail and slim balusters. Segments whose
 *  middle comes within 22 of an opening are left open. */
function rail(T: ColorBaker, M: ColorBaker, path: readonly Vec2[], y: number, openings: readonly Vec2[], closed = true, h = 14): void {
  const n = closed ? path.length : path.length - 1;
  for (let i = 0; i < n; i++) {
    const a = path[i], b = path[(i + 1) % path.length];
    const L = Math.hypot(b.x - a.x, b.z - a.z), parts = Math.max(1, Math.round(L / 14));
    for (let k = 0; k < parts; k++) {
      const p0 = { x: a.x + ((b.x - a.x) * k) / parts, z: a.z + ((b.z - a.z) * k) / parts }, p1 = { x: a.x + ((b.x - a.x) * (k + 1)) / parts, z: a.z + ((b.z - a.z) * (k + 1)) / parts };
      const mid = { x: (p0.x + p1.x) / 2, z: (p0.z + p1.z) / 2 };
      if (openings.some((o) => Math.hypot(o.x - mid.x, o.z - mid.z) < 22)) continue;
      const yaw = Math.atan2(p1.x - p0.x, p1.z - p0.z), sl = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      T.box(2, h, 2, p0.x, y, p0.z, T_EDGE);
      T.boxAt(2.6, 1.4, sl + 2.6, mid.x, y + h + 0.7, mid.z, TIMBER[(i + k) % TIMBER.length], yaw);
      T.boxAt(1.4, 1, sl, mid.x, y + 1.8, mid.z, T_EDGE, yaw);
      M.tube({ x: p0.x, y: y + h * 0.55, z: p0.z }, { x: p1.x, y: y + h * 0.55, z: p1.z }, 0.35, 0xd8c39a, 4);
      for (let q = 1; q < 4; q++) { const t = q / 4; T.box(0.9, h - 2, 0.9, p0.x + (p1.x - p0.x) * t, y + 1.8, p0.z + (p1.z - p0.z) * t, T_DARK); }
    }
  }
}
const ring = (poly: readonly Vec2[], inset: number, cx: number, cz: number) => poly.map((p) => { const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz); return { x: cx + (dx / d) * (d - inset), z: cz + (dz / d) * (d - inset) }; });

// ============================== THE RESIDENCE ================================================================
type Vol = { x0: number; x1: number; z0: number; z1: number; eave: number; ridge: number };
/** a STANDING-SEAM HIP ROOF over a footprint (with overhang): two trapezoids, two hips, fascia, seams, ridge cap */
function hipRoof(R: ColorBaker, T: ColorBaker, v: Vol, over = 5): void {
  const x0 = v.x0 - over, x1 = v.x1 + over, z0 = v.z0 - over, z1 = v.z1 + over, e = v.eave, r = v.ridge;
  const alongX = x1 - x0 >= z1 - z0;
  const half = (alongX ? z1 - z0 : x1 - x0) / 2;
  const P = new Part(), col = lin(0x5c8f80), colD = lin(0x4c7a6c);
  const c = (x: number, y: number, z: number, cc = col) => P.v(x, y, z, cc);
  if (alongX) {
    const rz = (z0 + z1) / 2, rx0 = x0 + half, rx1 = x1 - half;
    const a = c(x0, e, z0), b = c(x1, e, z0), cc1 = c(x1, e, z1), d = c(x0, e, z1), r0 = c(rx0, r, rz), r1 = c(rx1, r, rz);
    const a2 = c(x0, e, z0, colD), d2 = c(x0, e, z1, colD), r0b = c(rx0, r, rz, colD), b2 = c(x1, e, z0, colD), c2 = c(x1, e, z1, colD), r1b = c(rx1, r, rz, colD);
    P.tri(a, r0, r1); P.tri(a, r1, b); P.tri(d, cc1, r1); P.tri(d, r1, r0); P.tri(a2, d2, r0b); P.tri(b2, r1b, c2);
    // seams down the two long faces
    for (let x = x0 + 4; x < x1 - 2; x += 5.5) {
      const t = Math.min(1, Math.max(0, x < rx0 ? (x - x0) / half : x > rx1 ? (x1 - x) / half : 1));
      const zt = rz - half * (1 - t), zb = rz + half * (1 - t);
      R.tube({ x, y: e + 0.2, z: z0 }, { x, y: e + (r - e) * t + 0.2, z: zt }, 0.25, 0x7aa898, 3);
      R.tube({ x, y: e + 0.2, z: z1 }, { x, y: e + (r - e) * t + 0.2, z: zb }, 0.25, 0x7aa898, 3);
    }
    R.tube({ x: rx0, y: r + 0.5, z: rz }, { x: rx1, y: r + 0.5, z: rz }, 0.9, 0x40665a, 6);
  } else {
    const rx = (x0 + x1) / 2, rz0 = z0 + half, rz1 = z1 - half;
    const a = c(x0, e, z0), b = c(x1, e, z0), cc1 = c(x1, e, z1), d = c(x0, e, z1), r0 = c(rx, r, rz0), r1 = c(rx, r, rz1);
    P.tri(a, r1, r0); P.tri(a, d, r1); P.tri(b, r0, r1); P.tri(b, r1, cc1); P.tri(a, r0, b); P.tri(d, cc1, r1);
    R.tube({ x: rx, y: r + 0.5, z: rz0 }, { x: rx, y: r + 0.5, z: rz1 }, 0.9, 0x40665a, 6);
  }
  R.add(P.geometry(false), null);
  // the fascia board round the eaves
  for (const [ax, az, bx, bz] of [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]]) T.boxAt(Math.hypot(bx - ax, bz - az) + 1, 2.2, 1.4, (ax + bx) / 2, e - 0.6, (az + bz) / 2, T_EDGE, Math.abs(bz - az) < 1e-6 ? 0 : Math.PI / 2);
}
/** a timber volume: sill, board-and-batten walls, corner posts, a top plate */
function volume(T: ColorBaker, D: ColorBaker, v: Vol, base: number, rnd: () => number): void {
  const w = v.x1 - v.x0, d = v.z1 - v.z0, h = v.eave - base;
  D.box(w + 2, 2.2, d + 2, (v.x0 + v.x1) / 2, base, (v.z0 + v.z1) / 2, 0x6a4a30);
  T.box(w, h, d, (v.x0 + v.x1) / 2, base + 2, (v.z0 + v.z1) / 2, 0xd2b48c);
  // battens on all four faces
  for (let x = v.x0 + 3; x < v.x1 - 1; x += 5.2) for (const z of [v.z0 - 0.5, v.z1 + 0.5]) T.box(1, h - 2, 1, x, base + 2, z, rnd() < 0.5 ? 0xbf9a6c : 0xc6a273);
  for (let z = v.z0 + 3; z < v.z1 - 1; z += 5.2) for (const x of [v.x0 - 0.5, v.x1 + 0.5]) T.box(1, h - 2, 1, x, base + 2, z, rnd() < 0.5 ? 0xbf9a6c : 0xc6a273);
  for (const [x, z] of [[v.x0, v.z0], [v.x1, v.z0], [v.x0, v.z1], [v.x1, v.z1]]) T.box(3, h + 1, 3, x, base + 1.5, z, T_EDGE);
  T.box(w + 3, 1.6, d + 3, (v.x0 + v.x1) / 2, v.eave - 1.6, (v.z0 + v.z1) / 2, T_EDGE);
}
/** a framed window on a south (+z) face: frame, sill, mullion, and its pane into the window bank */
function windowS(T: ColorBaker, W: WindowBank, cell: Cell, x: number, y: number, z: number, w: number, h: number): void {
  T.boxAt(w + 3, 1.6, 2.4, x, y - h / 2 - 0.8, z + 1.2, T_DARK);
  T.boxAt(w + 2, 1.2, 1.6, x, y + h / 2 + 0.6, z + 0.8, T_EDGE);
  for (const sx of [-1, 1]) T.boxAt(1.2, h + 2, 1.6, x + (sx * (w + 1)) / 2, y, z + 0.8, T_EDGE);
  T.boxAt(0.8, h, 1, x, y, z + 1, T_EDGE);
  W.add(cell, V(x, y, z + 0.35), w, h, 0);
}

function residence(p: TreehouseParts, rnd: () => number): void {
  const { timber: T, dark: D, roof: R, metal: M, lanterns: LN, spill: SP, windows: W, fabric: F } = p;
  const base = L2.y;
  const { main, west, east, balcony: bal } = RESIDENCE;
  // the three volumes (the main hall two storeys — its upper floor is the balcony level)
  volume(T, D, { ...west, ridge: west.ridge }, base, rnd);
  volume(T, D, { ...east, ridge: east.ridge }, base, rnd);
  volume(T, D, { ...main, ridge: main.ridge }, base, rnd);
  hipRoof(R, T, west); hipRoof(R, T, east); hipRoof(R, T, main, 6);
  // a stone chimney through the main roof, and a vent stack on the east wing
  D.box(9, main.ridge - main.eave + 14, 9, main.x1 - 18, main.eave - 6, main.z0 + 12, 0x8a8a84);
  D.box(11, 2, 11, main.x1 - 18, main.ridge + 8, main.z0 + 12, 0x6d6d68);
  M.cyl(1.6, 12, east.x1 - 12, east.ridge - 4, east.z0 + 10, STEEL, 8);
  // GROUND-FLOOR WINDOWS on the south faces (warm interiors glimpsed), side windows, the upper floor's dormers
  windowS(T, W, "window-bunks", west.x0 + 14, base + 18, west.z1, 16, 14);
  windowS(T, W, "window-warm", main.x0 + 22, base + 20, main.z1, 18, 16);
  windowS(T, W, "window-lounge", main.x1 - 22, base + 20, main.z1, 18, 16);
  windowS(T, W, "window-hall", main.x0 + 22, bal.y + 10, main.z1, 14, 12);
  windowS(T, W, "window-warm", main.x1 - 22, bal.y + 10, main.z1, 14, 12);
  windowS(T, W, "window-lounge", east.x1 - 12, base + 20, east.z1, 12, 14);
  // side windows (east and west faces)
  W.add("window-warm", V(west.x0 - 0.6, base + 18, (west.z0 + west.z1) / 2), 12, 12, -Math.PI / 2);
  W.add("window-hall", V(east.x1 + 0.6, base + 18, (east.z0 + east.z1) / 2), 12, 12, Math.PI / 2);
  // the ENTRY DOOR (east wing): frame, leaf with a round porthole, a hood on brackets, a lantern
  const de = RESIDENCE.doors.entry;
  D.boxAt(14, 26, 1.6, de.x, base + 13, de.z + 0.8, 0x6a4a30);
  T.boxAt(11, 23, 1.2, de.x, base + 12, de.z + 1.6, 0xa0703f);
  W.add("window-warm", V(de.x, base + 17, de.z + 2.3), 5, 5, 0);
  M.boxAt(1.2, 1.2, 1.6, de.x + 3.5, base + 11, de.z + 2.6, BRASS);
  R.boxAt(20, 1.4, 9, de.x, base + 28, de.z + 4.5, 0x4c7a6c, 0, -0.2);
  LN.box(2.6, 3.8, 2.6, de.x + 9, base + 20, de.z + 2.4, 0xffe0a8);
  SP.add(pool(16, 0xffc070), new THREE.Matrix4().makeTranslation(de.x, base + 0.3, de.z + 10));
  // the BALCONY DOOR (main hall, upper floor)
  const db = RESIDENCE.doors.balcony;
  D.boxAt(12, 18, 1.6, db.x, bal.y + 9, db.z + 0.8, 0x6a4a30);
  W.add("window-hall", V(db.x, bal.y + 9, db.z + 1.8), 9, 15, 0);
  // THE UPPER BALCONY: planks on brackets, a balustrade, two lanterns, a pair of stools
  const balPoly = [{ x: bal.x0, z: bal.z0 }, { x: bal.x1, z: bal.z0 }, { x: bal.x1, z: bal.z1 }, { x: bal.x0, z: bal.z1 }];
  planks(T, balPoly, [], bal.y, 0, rnd, 4.6);
  D.box(bal.x1 - bal.x0, 3, bal.z1 - bal.z0, (bal.x0 + bal.x1) / 2, bal.y - 4.2, (bal.z0 + bal.z1) / 2, T_DARK);
  for (const x of [bal.x0 + 6, (bal.x0 + bal.x1) / 2, bal.x1 - 6]) M.tube({ x, y: bal.y - 18, z: bal.z0 + 0.5 }, { x, y: bal.y - 3, z: bal.z1 - 1 }, 0.9, STEEL, 5);
  rail(T, M, [{ x: bal.x0, z: bal.z0 }, { x: bal.x0, z: bal.z1 }, { x: bal.x1, z: bal.z1 }, { x: bal.x1, z: bal.z0 }], bal.y, [], false, 13);
  for (const x of [bal.x0 + 3, bal.x1 - 3]) { LN.box(2.4, 3.4, 2.4, x, bal.y + 14, bal.z1 - 1, 0xffe0a8); }
  for (const x of [bal.x0 + 30, bal.x0 + 42]) { T.cyl(3.2, 9, x, bal.y, bal.z0 + 6, 0xb98a5c, 10); F.cyl(3.3, 1.4, x, bal.y + 9, bal.z0 + 6, 0x8fb08c, 10); }
  // MILO'S SLEEPING PORCH: a lean-to roof off the west wing on two posts, a mat, a pillow, a blanket
  const pz0 = west.z1, pz1 = west.z1 + 16;
  for (const x of [west.x0 + 2, west.x1 - 2]) T.box(2.4, 26, 2.4, x, base, pz1, T_EDGE);
  R.boxAt(west.x1 - west.x0 + 8, 1.4, pz1 - pz0 + 4, (west.x0 + west.x1) / 2, base + 27, (pz0 + pz1) / 2, 0x5c8f80, 0, 0.16);
  F.box(22, 2.2, 13, 712, base, -793, 0x9db6c9);
  F.box(9, 3.2, 6, 704, base + 2.2, -798, 0xf0e6d6);
  F.boxAt(16, 0.8, 10, 715, base + 2.6, -791, 0xd77a5a, 0.15);
  LN.box(2.4, 3.4, 2.4, west.x1 - 3, base + 23, pz1 - 1, 0xffe0a8);
  // a cubby rack by the entry: hooks and little bags (the agents' belongings)
  T.box(16, 2, 4, de.x - 16, base + 18, de.z + 2, T_DARK);
  for (let k = 0; k < 4; k++) F.box(3, 5, 2.6, de.x - 22 + k * 4, base + 13, de.z + 2.4, [0xd77a5a, 0x7fb7a4, 0xf2c06b, 0x6b8fd6][k]);
  // string lights along the residence eaves
  for (let x = main.x0 + 4; x < main.x1; x += 7) LN.box(0.9, 1.2, 0.9, x, main.eave - 3.5, main.z1 + 6, 0xffe6b8);
}

// ============================== THE BUILD ====================================================================
export function buildTreehouse(screens: ScreenBank): TreehouseParts {
  const rnd = prng(7);
  const p: TreehouseParts = {
    timber: new ColorBaker(), dark: new ColorBaker(), metal: new ColorBaker(), roof: new ColorBaker(), fabric: new ColorBaker(), plaster: new ColorBaker(),
    bark: new Part(), leaves: [], lanterns: new ColorBaker(), spill: new ColorBaker(), windows: new WindowBank(), indicators: new ColorBaker(),
  };
  const { timber: T, dark: D, metal: M, fabric: F, lanterns: LN, spill: SP, indicators: IN } = p;

  // ---- L1 ----
  const rim1 = l1Rim(), slot = l1Slot();
  deckSlab(D, rim1, [slot], L1.y, 3.2);
  planks(T, rim1, [slot], L1.y, 0.35, rnd);
  fascia(T, rim1, L1.y);
  fascia(T, slot, L1.y, 3.2);
  // the south prow is OPEN — a low curb and planter boxes instead of a rail (the stage the Lab looks up at)
  const prowOpen = [polar(78, 100), polar(92, 104), polar(104, 101), polar(62, 98)].map((q) => ({ x: q.x, z: q.z }));
  const routeGaps = [RAMP.path[1], WEST_LIMB.path[1], SW_BRANCH.path[1], { x: 846, y: 0, z: -780 }].map((q) => ({ x: q.x, z: q.z }));
  rail(T, M, rim1, L1.y, [...prowOpen, ...routeGaps]);
  // the slot: a rail along its north-east side and across its outer end; its south-west LIP is the mantle edge
  rail(T, M, [slot[0], slot[1], slot[2]], L1.y, [], false, 12);
  for (const a of [70, 84, 98]) { const q = polar(a, 101); T.box(16, 6, 8, q.x, L1.y, q.z, 0x8c6644); p.leaves.push(shrubGeometry(30 + a).clone().scale(0.6, 0.5, 0.6).translate(q.x, L1.y + 6, q.z)); }
  // posts on steel shoes, knee braces off the trunk, radial joists
  for (const q of L1_POSTS) { T.cyl(3.4, L1.y - 4, q.x, 0, q.z, 0x9a7350, 12); M.box(9, 1.6, 9, q.x, 0, q.z, STEEL); M.tube({ x: q.x, y: L1.y - 18, z: q.z }, { x: q.x + (TREE.x - q.x) * 0.22, y: L1.y - 5, z: q.z + (TREE.z - q.z) * 0.22 }, 0.9, STEEL, 5); }
  for (const a of [10, 55, 130, 175, 220, 265, 310, 350]) {
    if (Math.abs(a - CLIMB.deg) < 26) continue;
    T.tube(polar(a, TRUNK.r - 2, 16), polar(a, 82, L1.y - 5), 2.0, T_EDGE, 7);
    D.boxAt(4, 4, 86, polar(a, 66).x, L1.y - 6.5, polar(a, 66).z, T_DARK, (90 - a) * Math.PI / 180);
  }
  // a steel collar where the deck meets the trunk
  M.add(new THREE.TorusGeometry(TRUNK.r + 1, 1.4, 6, 36).rotateX(Math.PI / 2), new THREE.Matrix4().makeTranslation(TREE.x, L1.y - 2, TREE.z), STEEL);

  // ---- L2 ----
  const rim2 = l2Rim();
  deckSlab(D, rim2, [], L2.y, 3.2);
  planks(T, rim2, [], L2.y, -0.25, rnd);
  fascia(T, rim2, L2.y);
  const resFront = [{ x: 700, z: -862 }, { x: 760, z: -872 }, { x: 830, z: -862 }];
  rail(T, M, rim2, L2.y, [{ x: STAIR.top.x, z: STAIR.top.z }, { x: POLE.ledge.x, z: POLE.ledge.z }, ...resFront], true, 13);
  for (const q of L2_POSTS) T.cyl(2.8, L2.y - L1.y - 4, q.x, L1.y, q.z, 0x9a7350, 10);
  // timber knee braces off the trunk carrying L2 (none across the south face, where the climb and the homes are seen)
  for (const a of [160, 215, 250, 290, 320]) T.tube(polar(a, TRUNK.rMid - 2, L2.y - 36), { x: L2.cx + (polar(a, 60).x - TREE.x), y: L2.y - 4, z: L2.cz + (polar(a, 60).z - TREE.z) }, 2.2, T_EDGE, 7);
  M.add(new THREE.TorusGeometry(TRUNK.rMid + 1.2, 1.3, 6, 32).rotateX(Math.PI / 2), new THREE.Matrix4().makeTranslation(TREE.x + 2, L2.y - 2, TREE.z - 9), STEEL);
  // string lights along L2's south rail
  for (let a = 30; a <= 170; a += 9) { const q = { x: L2.cx + Math.cos((a * Math.PI) / 180) * 64, z: L2.cz + Math.sin((a * Math.PI) / 180) * 64 }; LN.box(0.9, 1.2, 0.9, q.x, L2.y + 12, q.z, 0xffe6b8); }

  residence(p, rnd);

  // ---- the SHIP STAIR (L1 → L2): stringers, treads, two handrails ----
  {
    const s = STAIR, b = tv(s.bottom), t = tv(s.top), side = V(-s.out.z, 0, s.out.x).multiplyScalar(s.width / 2);
    for (const sg of [-1, 1]) {
      T.tube(b.clone().addScaledVector(side, sg), t.clone().addScaledVector(side, sg).add(V(0, 2, 0)), 1.6, T_EDGE, 6);
      M.tube(b.clone().addScaledVector(side, sg * 1.05).add(V(0, 15, 0)), t.clone().addScaledVector(side, sg * 1.05).add(V(0, 15, 0)), 0.55, BRASS, 6);
      M.tube(b.clone().addScaledVector(side, sg * 1.05), b.clone().addScaledVector(side, sg * 1.05).add(V(0, 15, 0)), 0.5, STEEL, 4);
      M.tube(t.clone().addScaledVector(side, sg * 1.05), t.clone().addScaledVector(side, sg * 1.05).add(V(0, 15, 0)), 0.5, STEEL, 4);
    }
    // treads every `tread` ALONG the stair's axis — exactly where a climbing MonkeyAgent's hands and feet snap
    const len = b.distanceTo(t), axis = t.clone().sub(b).normalize();
    for (let k = 1; k * s.tread < len - 2; k++) { const q = b.clone().addScaledVector(axis, k * s.tread); T.boxAt(s.width - 1, 1.4, 7, q.x, q.y - 0.7, q.z, TIMBER[k % TIMBER.length], Math.atan2(s.out.x, s.out.z)); }
  }
  // ---- the FIRE POLE: brass on a steel arm, a rubber mat at its foot ----
  M.cyl(POLE.r, POLE.top, POLE.x, 0, POLE.z, BRASS, 12);
  M.tube({ x: POLE.x, y: POLE.top - 2, z: POLE.z }, { x: POLE.ledge.x - 4, y: POLE.top - 2, z: POLE.ledge.z }, 1.1, STEEL, 6);
  for (const y of [POLE.top - 8, L2.y + 4]) M.cyl(POLE.r + 0.8, 1.4, POLE.x, y, POLE.z, STEEL, 10);
  D.cyl(10, 0.35, POLE.x + 4, 0, POLE.z, 0x3c4048, 18);
  // ---- the RAMP: planks across, stringers, posts on the high stretch, rope rails, lanterns ----
  for (let i = 1; i < RAMP.path.length; i++) {
    const a = tv(RAMP.path[i - 1]), c = tv(RAMP.path[i]), d = c.clone().sub(a), L = d.length();
    if (L < 1) continue;
    const yaw = Math.atan2(d.x, d.z), sd = V(-d.z, 0, d.x).normalize().multiplyScalar(RAMP.w / 2);
    for (let s = 1.5; s < L; s += 3.2) { const q = a.clone().addScaledVector(d, s / L); T.boxAt(RAMP.w, 1.3, 2.9, q.x, q.y - 0.6, q.z, TIMBER[Math.floor(s) % TIMBER.length], yaw, -Math.atan2(d.y, Math.hypot(d.x, d.z))); }
    for (const sg of [-1, 1]) {
      D.tube(a.clone().addScaledVector(sd, sg).add(V(0, -2.5, 0)), c.clone().addScaledVector(sd, sg).add(V(0, -2.5, 0)), 1.5, T_DARK, 5);
      for (const q of [a, c]) T.box(1.8, 13, 1.8, q.x + sd.x * sg, q.y, q.z + sd.z * sg, T_EDGE);
      M.tube(a.clone().addScaledVector(sd, sg).add(V(0, 12, 0)), c.clone().addScaledVector(sd, sg).add(V(0, 12, 0)), 0.45, 0xd8c39a, 4);
      M.tube(a.clone().addScaledVector(sd, sg).add(V(0, 6, 0)), c.clone().addScaledVector(sd, sg).add(V(0, 6, 0)), 0.35, 0xd8c39a, 4);
    }
    if (a.y > 8) for (const sg of [-1, 1]) T.cyl(1.8, a.y - 2.5, a.x + sd.x * sg, 0, a.z + sd.z * sg, 0x9a7350, 8);
  }
  for (const q of [RAMP.path[2], RAMP.path[3]]) { LN.box(2.4, 3.2, 2.4, q.x, q.y + 13, q.z, 0xffe0a8); SP.add(pool(12, 0xffc070), new THREE.Matrix4().makeTranslation(q.x, q.y + 0.4, q.z)); }
  // ---- the JUMP STUMP, with a landing mat beyond it ----
  tube(p.bark, [V(JUMP_PAD.x, -1, JUMP_PAD.z), V(JUMP_PAD.x, JUMP_PAD.y * 0.5, JUMP_PAD.z), V(JUMP_PAD.x, JUMP_PAD.y, JUMP_PAD.z)], [JUMP_PAD.r * 1.25, JUMP_PAD.r * 1.04, JUMP_PAD.r], 14, { grooves: 6, depth: 0.12, flare: { n: 5, amp: 0.35, phase: 1 }, cap: false });
  T.cyl(JUMP_PAD.r - 0.6, 0.8, JUMP_PAD.x, JUMP_PAD.y - 0.3, JUMP_PAD.z, 0xd8b98a, 18);
  for (let r = 3; r < JUMP_PAD.r - 1; r += 3) M.add(new THREE.TorusGeometry(r, 0.25, 3, 24).rotateX(Math.PI / 2), new THREE.Matrix4().makeTranslation(JUMP_PAD.x, JUMP_PAD.y + 0.6, JUMP_PAD.z), 0xb08a5c);
  // the landing mat: a round rubber pad with a target ring
  D.cyl(13, 0.35, JUMP_PAD.land.x, 0, JUMP_PAD.land.z, 0x4f5f58, 24);
  M.add(new THREE.TorusGeometry(8, 0.5, 3, 28).rotateX(Math.PI / 2), new THREE.Matrix4().makeTranslation(JUMP_PAD.land.x, 0.36, JUMP_PAD.land.z), 0xe6b45a);
  // ---- the HANG twig: a rope-wrapped grip on a short upright ----
  tube(p.bark, [V(HANG.bar.x0, HANG.grip.y, HANG.grip.z), V((HANG.bar.x0 + HANG.bar.x1) / 2, HANG.grip.y + 0.6, HANG.grip.z), V(HANG.bar.x1, HANG.grip.y, HANG.grip.z)], [1.6, 1.45, 1.2], 8, { cap: true });
  tube(p.bark, [V(HANG.bar.x1, HANG.stand.y - 4, HANG.stand.z), V(HANG.bar.x1, (HANG.stand.y + HANG.grip.y) / 2, (HANG.stand.z + HANG.grip.z) / 2), V(HANG.bar.x1, HANG.grip.y, HANG.grip.z)], [2.2, 1.8, 1.5], 8, { cap: true });
  for (let k = 0; k < 6; k++) M.add(new THREE.TorusGeometry(1.55, 0.22, 4, 10).rotateY(Math.PI / 2), new THREE.Matrix4().makeTranslation(HANG.grip.x - 4 + k * 1.5, HANG.grip.y, HANG.grip.z), 0xd8c39a);
  // ---- the TOUCAN'S PERCH at the branch tip: a timber perch bar, a brass cuff, a status ring ----
  const tip = tv(TOUCAN_LIMB.tip);
  T.tube(tip.clone().add(V(-8, 2.2, 0)), tip.clone().add(V(8, 2.2, 0)), 1.1, 0xa47a50, 6);
  M.add(new THREE.TorusGeometry(TOUCAN_LIMB.r + 0.6, 0.8, 6, 18), new THREE.Matrix4().makeTranslation(tip.x, tip.y, tip.z - 3), BRASS);
  IN.add(new THREE.TorusGeometry(TOUCAN_LIMB.r + 0.5, 0.42, 5, 20), new THREE.Matrix4().makeTranslation(tip.x, tip.y, tip.z - 6), 0x7fe0c8);
  // ---- the JOB BOARD: a timber post, a framed board under a little roof, three status lamps ----
  {
    const jb = JOB_BOARD, top = jb.y + jb.h;
    T.box(4, top + 4, 4, jb.x, 0, jb.z - 1, T_EDGE);
    D.boxAt(jb.w + 4, jb.h + 4, 3, jb.x, jb.y + jb.h / 2, jb.z, 0x5b4128);
    p.roof.boxAt(jb.w + 10, 1.4, 9, jb.x, top + 4, jb.z + 1, 0x4c7a6c, 0, -0.18);
    screens.upright("lab", "job", jb.x, jb.y + jb.h / 2, jb.z + 1.7, jb.w - 4, jb.h - 4, 0);
    for (let k = 0; k < 3; k++) IN.add(new THREE.SphereGeometry(1.4, 8, 6), new THREE.Matrix4().makeTranslation(jb.x - 8 + k * 8, jb.y - 2.5, jb.z + 1.8), [0x7fe0c8, 0xf2c06b, 0x6b8fd6][k]);
    T.box(jb.w, 1.2, 4, jb.x, jb.y - 1, jb.z + 2.4, T_DARK);
  }

  // ---- HOME ----
  // Nova's reading nook: a cushioned bench, a book stack shelf, a reading lantern, a sketchbook
  // she sits on a floor cushion at u1-nova-home facing out west; the cushioned bench is her BACKREST
  F.cyl(9, 0.5, 650, L1.y, -762, 0xc58f7a, 20);
  T.box(26, 5, 7, 658.6, L1.y, -759.4, 0xa47a50, 1.27);
  F.box(25, 4.6, 6, 658.6, L1.y + 5, -759.4, 0xc58f7a, 1.27);
  openShelf(T, F, rnd, 625, -786, L1.y, 26, 18, 10, Math.PI / 2, 3, 0x9a7350);
  LN.box(2.4, 3.4, 2.4, 631, L1.y + 22, -772, 0xffe0a8);
  F.boxAt(7, 0.9, 5, 662, L1.y + 10.1, -771, 0xf6efe0, 0.4);
  // the hearth corner on L1's north: a low table, floor cushions, a fruit bowl, mugs
  T.box(22, 6, 14, 740, L1.y, -842, 0x9a7350);
  for (const [dx, dz] of [[-16, 0], [16, 0], [0, 12]]) F.box(10, 2.6, 10, 740 + dx, L1.y, -842 + dz, [0x9db6c9, 0xd77a5a, 0x8fb08c][(dx + 16) % 3]);
  T.cyl(5, 2.4, 740, L1.y + 6, -842, 0x8c6644, 12);
  for (let k = 0; k < 5; k++) F.boxAt(1.6, 1.6, 5, 738 + k * 1.2, L1.y + 8.6, -842 + (k % 2), 0xf2d04a, k * 0.6, 0, 0.3);
  for (const dx of [-7, 7]) M.cyl(1.1, 2.4, 740 + dx, L1.y + 6, -845, [0xf0e6d6, 0x6b8fd6][dx > 0 ? 1 : 0], 8);
  // cushions at the idle spots, a telescope at the lookout, planter boxes along L2's south edge
  // thin floor cushions at the sitting rest spots (a seated pelvis rests ON them, not in them)
  IDLE_SPOTS.forEach((s, i) => { if (s.action !== "sit") return; const c = [0xd77a5a, 0x7fb7a4, 0xf2c06b][i % 3]; F.cyl(8, 0.45, s.at.x, s.at.y, s.at.z, c, 18); F.cyl(5.6, 0.12, s.at.x, s.at.y + 0.45, s.at.z, 0xf0e6d6, 16); });
  M.tube({ x: 696, y: L2.y, z: -756 }, { x: 698, y: L2.y + 16, z: -758 }, 0.5, STEEL, 4);
  M.tube({ x: 702, y: L2.y, z: -760 }, { x: 698, y: L2.y + 16, z: -758 }, 0.5, STEEL, 4);
  M.tube({ x: 696, y: L2.y + 17, z: -760 }, { x: 686, y: L2.y + 21, z: -754 }, 1.4, BRASS, 8);
  for (const a of [60, 110, 150]) { const q = { x: L2.cx + Math.cos((a * Math.PI) / 180) * 56, z: L2.cz + Math.sin((a * Math.PI) / 180) * 56 }; T.box(14, 5, 6, q.x, L2.y, q.z, 0x8c6644); p.leaves.push(shrubGeometry(70 + a).clone().scale(0.45, 0.4, 0.45).translate(q.x, L2.y + 5, q.z)); }
  // L1 lanterns at the rim corners
  for (const a of [0, 140, 230, 300]) { const q = polar(a, l1Rim()[Math.round(a / 30) % 12] ? 104 : 100); LN.box(2.4, 3.4, 2.4, q.x, L1.y + 16, q.z, 0xffe0a8); SP.add(pool(14, 0xffc070), new THREE.Matrix4().makeTranslation(q.x, L1.y + 0.5, q.z)); }
  return p;
}

/** bark used by the build's own small woody pieces matches the tree */
export const BARK_HEX = BARK.base;
export { ring };
