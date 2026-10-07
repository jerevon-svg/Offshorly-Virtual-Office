// vo3d build — THE LAB SHELL: plinth, floor system, perimeter architecture, briefing ring, overlook, pavilions.
//
// THE FLOOR TELLS YOU WHERE YOU ARE. One pale stone field (the exterior's world-space paving joints) carries
// every zone as its own surface: warm oak plank in the design studio and the flex lounge, cool slate tile in the
// build bay, sage tile in the review lab, a warm running-bond path along the lake axis, round the tree and across
// the briefing line, and real SOIL round the tree — kerbed, mossy, planted with ferns and stones. Contact
// darkening grounds every piece of furniture on it.
//
// THE WALL IS ARCHITECTURE, NOT A FENCE: a stone base course, plaster panels between pilasters, a timber cap
// with a warm reveal light, conduits and vents on its inner face, a proper ENTRANCE PORTAL with the Lab's sign,
// and a lower slatted parapet along the lake so the water reads through it.
import * as THREE from "three";
import { ColorBaker, Part, lin, prng } from "./exteriorGeo";
import { shrubGeometry } from "./exteriorFoliage";
import { pool, type ScreenBank } from "./labMaterials";
import type { WindowBank } from "./labTreehouse";
import { labEntranceTreads, lakeStepTreads, PAVED, LAKE_SPUR, LAKE_TERRACE, PORCH, GRADE, ENTRY_X0, ENTRY_X1, LAKE_GAP_X0, LAKE_GAP_X1 } from "../world/ailab";
import {
  BRIEFING, BRIEF_SPOTS, LAB2_FLOOR_Y, FUTURE_PODS, LAB2_PLINTH, OVERLOOK, PLAZA_R, ROOTS, TREE, TRUNK, WALL_H, WALL_SEGS_V2, WALL_T, ZONES2, polar,
} from "../world/ailabV2";
import type { Rect, Vec2 } from "../core/coords";

/** the bakers every Lab builder paints into (one merged mesh per material in the end) */
export type LabBakers = {
  stone: ColorBaker; plaster: ColorBaker; timber: ColorBaker; dark: ColorBaker; metal: ColorBaker; roof: ColorBaker; fabric: ColorBaker;
  pave: ColorBaker; warm: ColorBaker; soil: ColorBaker; lanterns: ColorBaker; spill: ColorBaker; indicators: ColorBaker;
  leaves: THREE.BufferGeometry[]; bark: Part; contact: ContactBank; prints: WindowBank;
};

// ============================== CONTACT DARKENING ===============================================================
/** soft dark footprints under furniture: an inner quad at `alpha` feathering to 0 over `f` (RGBA vertex colour) */
export class ContactBank {
  private readonly p: number[] = [];
  private readonly c: number[] = [];
  rect(cx: number, cz: number, w: number, d: number, yaw = 0, alpha = 0.28, f = 5, y = 0.4): void {
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const at = (x: number, z: number): [number, number] => [cx + x * cs + z * sn, cz - x * sn + z * cs];
    const xs = [-w / 2 - f, -w / 2, w / 2, w / 2 + f], zs = [-d / 2 - f, -d / 2, d / 2, d / 2 + f];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const q = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
      for (const k of [0, 2, 1, 0, 3, 2]) {
        const [a, b] = q[k], [x, z] = at(xs[a], zs[b]);
        this.p.push(x, y, z);
        this.c.push(0, 0, 0, a === 0 || a === 3 || b === 0 || b === 3 ? 0 : alpha);
      }
    }
  }
  disc(cx: number, cz: number, r: number, alpha = 0.3, f = 6, y = 0.4): void {
    const n = 20;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
      const P = (a: number, rr: number) => [cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr];
      const tri = (pts: number[][], al: number[]) => pts.forEach((q, i) => { this.p.push(...q); this.c.push(0, 0, 0, al[i]); });
      tri([[cx, y, cz], P(a1, r), P(a0, r)], [alpha, alpha, alpha]);
      tri([P(a0, r), P(a1, r), P(a1, r + f)], [alpha, alpha, 0]);
      tri([P(a0, r), P(a1, r + f), P(a0, r + f)], [alpha, 0, 0]);
    }
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 4));
    return g;
  }
}

// ============================== helpers =========================================================================
/** AN OPEN SHELF: a real carcass (back, sides, top, base, shelf boards) and BOOKS standing in each compartment —
 *  each its own block with a small gap to the next, set back from the front edge and clear of the back panel, so
 *  no book face ever shares a plane with the carcass or a neighbour (the old shelves buried books in a solid box
 *  with their fronts coplanar to it, which shimmered). Local frame: width on x, the open front facing +z, `yaw`
 *  turns it (three's rotation.y), y0 is its base. */
export function openShelf(T: ColorBaker, F: ColorBaker, rnd: () => number, cx: number, cz: number, y0: number, w: number, h: number, d: number, yaw: number, rows: number, wood = 0xc9a77c): void {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const at = (lx: number, lz: number) => ({ x: cx + lx * c + lz * s, z: cz - lx * s + lz * c });
  const box = (B: ColorBaker, bw: number, bh: number, bd: number, lx: number, ly: number, lz: number, col: number, roll = 0) => { const p = at(lx, lz); B.box(bw, bh, bd, p.x, ly, p.z, col, yaw, 0, roll); };
  const t = 1.1, back = 0.7;
  box(T, w, h, back, 0, y0, -d / 2 + back / 2, 0x9c7550);
  for (const sx of [-1, 1]) box(T, t, h, d, sx * (w / 2 - t / 2), y0, 0, wood);
  box(T, w, t, d, 0, y0 + h - t, 0, wood);
  box(T, w - 2 * t, t, d, 0, y0, 0, wood);
  const inner = (h - 2 * t - (rows - 1) * 0.8) / rows;
  const BOOK = [0xd77a5a, 0x6b8fd6, 0xf2c06b, 0x7fb7a4, 0xf0e6d6, 0xc58fd8, 0x3f4a5c, 0x8fb08c];
  for (let r = 0; r < rows; r++) {
    const floor = y0 + t + r * (inner + 0.8);
    if (r > 0) box(T, w - 2 * t - 0.02, 0.8, d - back - 0.3, 0, floor - 0.8, back / 2 + 0.15, wood);
    // books from the left, each its own width/height/depth/colour; now and then a lean or a gap with a box file
    let x = -w / 2 + t + 0.5;
    while (x < w / 2 - t - 1.6) {
      const bw = 0.9 + rnd() * 1.3, bh = inner * (0.62 + rnd() * 0.3), bd = d - back - 1.6 - rnd() * 1.2;
      if (x + bw > w / 2 - t - 0.4) break;
      if (rnd() < 0.08) { box(F, 3.2, inner * 0.5, bd, x + 1.6, floor + 0.03, -d / 2 + back + 0.35 + bd / 2, 0x6b5a48); x += 3.6; continue; }
      const lean = rnd() < 0.07 ? 0.14 : 0;
      box(F, bw, bh, bd, x + bw / 2 + lean * bh * 0.5, floor + 0.03, -d / 2 + back + 0.35 + bd / 2, BOOK[Math.floor(rnd() * BOOK.length)], -lean);
      x += bw + 0.14 + lean * bh;
    }
  }
}
const extrude = (poly: readonly Vec2[], t: number, y0: number, holes: readonly (readonly Vec2[])[] = []) => {
  const sh = new THREE.Shape();
  poly.forEach((p, i) => (i ? sh.lineTo(p.x, -p.z) : sh.moveTo(p.x, -p.z)));
  for (const h of holes) { const pa = new THREE.Path(); h.forEach((p, i) => (i ? pa.lineTo(p.x, -p.z) : pa.moveTo(p.x, -p.z))); sh.holes.push(pa); }
  const g = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false, curveSegments: 24 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
};
const flat = (B: ColorBaker, r: Rect, y: number, colour: number, t = 0.3) => B.box(r.w, t, r.d, r.x + r.w / 2, y, r.z + r.d / 2, colour);
const INTERIOR: Vec2[] = WALL_SEGS_V2.map(([a]) => a).filter((p, i, arr) => i === 0 || Math.hypot(p.x - arr[i - 1].x, p.z - arr[i - 1].z) > 1);
const LAB_C = { x: 740, z: -710 };
/** THE FLOOR LAYER STACK — the TOP of each layer above the Lab floor datum (y 0 = the exterior's Lab-interior
 *  surface). Every layer clears the one under it by ≥ 0.04: a constant gap, never a coplanar pair, never a depth
 *  bias. (Soil rises 0.06–0.26 over its base; inlays sit on the briefing disc, which sits clear of the soil.) */
export const LAYER = { pave: 0.05, zone: 0.1, path: 0.1, ring: 0.14, soil: 0.12, kerb: 0.28, brief: 0.24, inlay: 0.29, inlayTop: 0.34, rugBase: 0.3, rugTop: 0.36 } as const;
const inBrief = (x: number, z: number, pad = 0) => Math.hypot(x - BRIEFING.x, z - BRIEFING.z) < BRIEFING.r + pad;

// ============================== THE FLOOR SYSTEM ================================================================
function floors(B: LabBakers, rnd: () => number): void {
  // the stone field: the whole interior, just over the exterior's lab-interior surface
  B.pave.add(extrude(INTERIOR, 0.3, LAYER.pave - 0.3), null, 0xd9d1c2);
  // BUILD bay: cool slate tile · REVIEW lab: pale sage tile (both the paving joint grid)
  flat(B.pave, ZONES2.build, LAYER.zone - 0.06, 0xa9b2b9, 0.06);
  flat(B.pave, ZONES2.review, LAYER.zone - 0.06, 0xc3d1c2, 0.06);
  // DESIGN studio + FLEX lounge: warm oak planks, laid north–south, each its own shade, a darker border
  const oak = [0xc9a173, 0xbf966a, 0xd1ab7e, 0xc49c6f, 0xb98f63];
  for (const [z, tone] of [[ZONES2.design, 0], [ZONES2.flex, 1]] as const) {
    const r = z;
    for (let x = r.x + 2; x < r.x + r.w - 2; x += 6.4) {
      let zz = r.z + 2;
      while (zz < r.z + r.d - 2) {
        const L = Math.min(r.z + r.d - 2 - zz, 34 + rnd() * 40);
        B.timber.box(6, 0.7, L - 0.4, x + 3, -0.48, zz + L / 2, oak[Math.floor(rnd() * oak.length)] + (tone ? 0x060606 : 0));
        zz += L;
      }
    }
    for (const [w, d, cx, cz] of [[r.w, 2, r.x + r.w / 2, r.z + 1], [r.w, 2, r.x + r.w / 2, r.z + r.d - 1], [2, r.d, r.x + 1, r.z + r.d / 2], [2, r.d, r.x + r.w - 1, r.z + r.d / 2]] as const)
      B.timber.box(w, 0.75, d, cx, -0.48, cz, 0x8c6644);
  }
  // the flex lounge's rug
  // the flex lounge's rug: a warm field, a terracotta border, a stripe band
  B.fabric.box(120, LAYER.rugBase - 0.2, 70, 300, 0.2, -520, 0xc0674a);
  B.fabric.box(112, LAYER.rugTop - 0.25, 62, 300, 0.25, -520, 0xe7d3b0);
  for (const dz of [-20, 20]) B.fabric.box(104, 0.04, 3, 300, LAYER.rugTop, -520 + dz, 0xd9a35a);
  // WARM PATHS: the lake axis (entrance → ring, plaza → lake gap), round the plaza, the briefing cross line
  B.warm.box(56, 0.2, 40, 740, LAYER.path - 0.2, -468, 0xe2cfae);
  B.warm.box(56, 0.2, 80, 740, LAYER.path - 0.2, -935, 0xe2cfae);
  B.warm.box(540, 0.2, 24, 740, LAYER.path - 0.2, -520, 0xe2cfae);
  B.warm.add(new THREE.RingGeometry(PLAZA_R - 2, PLAZA_R + 20, 72, 1).rotateX(-Math.PI / 2), new THREE.Matrix4().makeTranslation(TREE.x, LAYER.ring, TREE.z), 0xe0cba8);
  // flush path lights along the lake axis and the briefing line (no collision: they are set in the paving)
  for (const [x, z] of [[714, -455], [766, -455], [714, -475], [766, -475], ...[-910, -930, -950].flatMap((zz) => [[714, zz], [766, zz]]), ...[490, 530, 570, 610, 870, 910, 950, 990].flatMap((xx) => [[xx, -531], [xx, -509]])] as const) {
    B.indicators.box(2.4, 0.06, 2.4, x, LAYER.path, z, 0xffe2b0);
    B.spill.add(pool(9, 0x6a5038), new THREE.Matrix4().makeTranslation(x, 0.3, z));
  }
  // the design studio's rug under its making tables
  B.fabric.box(230, LAYER.rugBase - 0.2, 54, 300, 0.2, -727, 0x6b8fa8);
  B.fabric.box(222, LAYER.rugTop - 0.25, 46, 300, 0.25, -727, 0xd9cdb6);
  // slot drains along the north lake axis, with steel grates
  for (const x of [711, 769]) {
    B.dark.box(3, 0.06, 58, x, LAYER.path, -933, 0x3c4048);
    for (let z = -960; z < -905; z += 3) B.metal.box(3.2, 0.05, 0.7, x, LAYER.path + 0.06, z, 0x8d969f);
  }
  // THE TREE'S SOIL: a disc of real ground, darker toward the trunk, mossy round the roots
  {
    const P = new Part(), rings = 9, segs = 72;
    const soil = lin(0x7b5c40), soilL = lin(0x957454), moss = lin(0x5f7c38);
    const ids: number[][] = [];
    for (let i = 0; i <= rings; i++) {
      const r = 6 + ((PLAZA_R - 6) * i) / rings, row: number[] = [];
      for (let k = 0; k < segs; k++) {
        const a = (k / segs) * Math.PI * 2, x = TREE.x + Math.cos(a) * r, z = TREE.z + Math.sin(a) * r;
        const deg = ((a * 180) / Math.PI + 360) % 360;
        const nearRoot = ROOTS.some(([ra, L]) => Math.abs(((deg - ra + 540) % 360) - 180) < 12 && r < TRUNK.r + L + 16);
        const c = soil.clone().lerp(soilL, i / rings * 0.8 + rnd() * 0.2);
        if (nearRoot || (rnd() < 0.18 && i > 1)) c.lerp(moss, 0.55 + rnd() * 0.3);
        row.push(P.v(x, inBrief(x, z, 1) ? LAYER.soil : LAYER.soil + (i === rings ? 0 : 0.06 + rnd() * 0.2), z, c));
      }
      ids.push(row);
    }
    for (let i = 0; i < rings; i++) for (let k = 0; k < segs; k++) P.quad(ids[i][k], ids[i][(k + 1) % segs], ids[i + 1][(k + 1) % segs], ids[i + 1][k]);
    B.soil.add(P.geometry(false), null);
  }
  // its kerb: a flush stone ring, 3 wide
  for (let k = 0; k < 60; k++) {
    const a = ((k + 0.5) / 60) * Math.PI * 2;
    if (inBrief(TREE.x + Math.cos(a) * (PLAZA_R + 1), TREE.z + Math.sin(a) * (PLAZA_R + 1), 8)) continue;
    B.stone.box(15.4, 0.9, 3, TREE.x + Math.cos(a) * (PLAZA_R + 1), LAYER.kerb - 0.9, TREE.z + Math.sin(a) * (PLAZA_R + 1), k % 2 ? 0xc9c0ae : 0xc2b8a5, -a + Math.PI / 2);
  }
  // ferns and river stones round the soil (clear of the routes: the SW branch, the walkway, the briefing side)
  for (let k = 0; k < 26; k++) {
    const a = rnd() * 360, r = 52 + rnd() * 88, p = polar(a, r);
    if (a > 40 && a < 140) continue; // the south face (briefing / climb) stays open
    if (Math.hypot(p.x - 620, p.z - 640) < 40 || Math.hypot(p.x - 832, p.z - 648) < 22 || Math.hypot(p.x - 620, p.z - 700) < 18) continue;
    if (rnd() < 0.55) B.leaves.push(shrubGeometry(400 + k, { base: 0x4f7a37, dark: 0x2b4a24, light: 0x86ad55 }).clone().scale(0.42, 0.32, 0.42).translate(p.x, LAYER.soil + 0.05, p.z));
    else { const s = 2 + rnd() * 3.5; B.stone.add(new THREE.IcosahedronGeometry(1, 0), new THREE.Matrix4().compose(new THREE.Vector3(p.x, LAYER.soil + s * 0.25, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd(), rnd() * 6, rnd())), new THREE.Vector3(s * 1.3, s * 0.6, s)), 0xa7a196); }
  }
  B.contact.disc(TREE.x, TREE.z, TRUNK.r + 6, 0.32, 18, 0.42);
  // the treehouse's shade on its soil: L1's footprint, soft-edged
  B.contact.disc(TREE.x, TREE.z - 6, 88, 0.22, 26, 0.44);
}

// ============================== THE BRIEFING RING ===============================================================
function briefing(B: LabBakers): void {
  const { x, z, r } = BRIEFING;
  // THE DISC sits on the stack above the paths, the plaza ring and the (sunk) soil under it; every INLAY lies on
  // it as a thin solid with its own top — rings and rays never share a plane with the disc or with each other
  B.warm.add(new THREE.CylinderGeometry(r, r, 0.12, 96, 1), new THREE.Matrix4().makeTranslation(x, LAYER.brief - 0.06, z), 0xeadbb8);
  const ring = (r0: number, r1: number, top: number, hex: number) => B.metal.add(new THREE.RingGeometry(r0, r1, 128, 1).rotateX(-Math.PI / 2), new THREE.Matrix4().makeTranslation(x, top, z), hex);
  ring(r - 4, r - 2.6, LAYER.inlay, 0xc9a25a);
  ring(r - 0.9, r - 0.1, LAYER.inlay, 0x9c7c45);
  // a compass inlay: eight brass rays, the north ray toward the tree (and the Toucan) longest
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 - Math.PI / 2, L = k === 0 ? 34 : k % 2 ? 14 : 22;
    B.metal.box(1.2, LAYER.inlay - LAYER.brief, L, x + Math.cos(a) * (8 + L / 2), LAYER.brief, z + Math.sin(a) * (8 + L / 2), 0xc9a25a, -a + Math.PI / 2);
  }
  ring(5, 7, LAYER.inlayTop, 0xc9a25a);
  // where each agent stands at a briefing: a darker stone medallion, laid UNDER the inlays (rays and rings draw
  // over it, so where a medallion meets the compass the layering reads as intended, never as a smudge)
  for (const s of Object.values(BRIEF_SPOTS)) B.stone.add(new THREE.CylinderGeometry(8, 8, 0.025, 48, 1), new THREE.Matrix4().makeTranslation(s.x, LAYER.brief + 0.0125, s.z), 0xd7c6a3);
}

// ============================== THE PERIMETER ===================================================================
function walls(B: LabBakers, screens: ScreenBank, rnd: () => number): void {
  for (const [a, c] of WALL_SEGS_V2) {
    const dx = c.x - a.x, dz = c.z - a.z, L = Math.hypot(dx, dz), yaw = Math.atan2(dx, dz);
    const ux = dx / L, uz = dz / L;
    // the inward normal (toward the Lab's centre)
    let nx = -uz, nz = ux;
    if ((LAB_C.x - (a.x + c.x) / 2) * nx + (LAB_C.z - (a.z + c.z) / 2) * nz < 0) { nx = -nx; nz = -nz; }
    const lake = Math.abs(a.z + 980) < 1 && Math.abs(c.z + 980) < 1;
    const at = (s: number, off = 0) => ({ x: a.x + ux * s + nx * off, z: a.z + uz * s + nz * off });
    const m = at(L / 2);
    // base course, body, cap (the lake runs are a low wall with a slatted timber screen above it)
    B.stone.box(WALL_T + 2.4, 4, L + 2, m.x, 0, m.z, 0xb5ab99, yaw);
    if (lake) {
      B.plaster.box(WALL_T, 10, L, m.x, 4, m.z, 0xe9e1d2, yaw);
      B.timber.box(WALL_T + 2, 1.6, L + 2, m.x, 14, m.z, 0xa47a50, yaw);
      for (let s = 3; s < L - 1; s += 4.2) { const q = at(s); B.timber.box(1.6, 8.4, 3, q.x, 15.6, q.z, s % 8.4 < 4.2 ? 0xb98a5c : 0xa97d52, yaw); }
      B.timber.box(WALL_T - 2, 1.8, L + 1, m.x, WALL_H - 1.8, m.z, 0x9c7550, yaw);
    } else {
      B.plaster.box(WALL_T, WALL_H - 6.2, L, m.x, 4, m.z, 0xece4d6, yaw);
      B.timber.box(WALL_T + 3, 2.2, L + 3, m.x, WALL_H - 2.2, m.z, 0xa47a50, yaw);
      // the warm reveal under the cap, inner face only
      const r = at(L / 2, WALL_T / 2 + 0.3);
      B.indicators.box(0.5, 0.7, L - 6, r.x, WALL_H - 3.4, r.z, 0xffe2b0, yaw);
    }
    // pilasters every ~64 (both faces), and at every run's ends
    const n = Math.max(1, Math.round(L / 64));
    for (let k = 0; k <= n; k++) { const q = at((L * k) / n); B.stone.box(WALL_T + 4, lake ? 18 : WALL_H - 1, 7, q.x, 0, q.z, 0xd6ccba, yaw); }
    if (lake) continue;
    // a wall sconce on every inner pilaster, washing a pool of warm light onto the floor below it
    for (let k = 1; k < n; k++) {
      const q = at((L * k) / n, WALL_T / 2 + 3.4), f = at((L * k) / n, WALL_T / 2 + 12);
      B.metal.box(2.4, 1, 2.4, q.x, 19.5, q.z, 0x5d6670, yaw);
      B.lanterns.box(3, 3.6, 3, q.x, 15.9, q.z, 0xffe0a8, yaw);
      B.spill.add(pool(26, 0x9a7650), new THREE.Matrix4().makeTranslation(f.x, 0.3, f.z));
    }
    // the inner face: a conduit at 18 with junction boxes, vents low in alternate bays
    const p0 = at(4, WALL_T / 2 + 1.2), p1 = at(L - 4, WALL_T / 2 + 1.2);
    B.metal.tube({ x: p0.x, y: 18, z: p0.z }, { x: p1.x, y: 18, z: p1.z }, 0.6, 0x9aa2aa, 5);
    for (let k = 0; k < n; k++) {
      const s = (L * (k + 0.5)) / n, q = at(s, WALL_T / 2 + 1);
      B.metal.box(3.4, 3.4, 1.6, q.x, 16.3, q.z, 0x8d969f, yaw);
      if (k % 2 === 0 && rnd() < 0.8) {
        const v = at(s, WALL_T / 2 + 0.5);
        B.dark.box(10, 5, 0.8, v.x, 5, v.z, 0x4a525c, yaw + Math.PI / 2);
        for (let j = 0; j < 4; j++) B.metal.box(9.4, 0.5, 1.2, v.x, 5.6 + j * 1.2, v.z, 0x9aa2aa, yaw + Math.PI / 2);
      }
    }
  }
  // ---- THE ENTRANCE PORTAL: stone piers, a timber lintel on brackets, the Lab's sign both ways, lanterns ----
  const ez = -440;
  for (const x of [ENTRY_X0, ENTRY_X1]) {
    B.stone.box(18, 50, 18, x, 0, ez, 0xcfc5b3);
    B.stone.box(21, 3, 21, x, 50, ez, 0xbfb4a0);
    B.stone.box(21, 4, 21, x, 0, ez, 0xb5ab99);
    B.lanterns.box(3.4, 6, 3.4, x + (x < 740 ? 12 : -12), 30, ez + 9.5, 0xffe0a8);
    B.metal.box(1, 1, 6, x + (x < 740 ? 12 : -12), 36, ez + 7, 0x5d6670);
    B.spill.add(new THREE.CircleGeometry(22, 20).rotateX(-Math.PI / 2), new THREE.Matrix4().makeTranslation(x + (x < 740 ? 16 : -16), 0.3, ez + 16), 0xffc070);
  }
  B.timber.box(ENTRY_X1 - ENTRY_X0 + 30, 7, 12, 740, 53, ez, 0x9c7550);
  B.timber.box(ENTRY_X1 - ENTRY_X0 + 34, 1.6, 14, 740, 60, ez, 0x8c6644);
  for (const x of [700, 780]) { B.dark.box(1.6, 8, 1.6, x, 45, ez + 3, 0x5b4128); }
  B.dark.box(78, 16, 2.2, 740, 41, ez + 6.6, 0x4b3a2a);
  B.prints.add("sign-lab", new THREE.Vector3(740, 49, ez + 7.85), 74, 13, 0, true);
  B.dark.box(64, 8, 1.6, 740, 52.5, ez - 6.6, 0x4b3a2a);
  B.prints.add("sign-lab", new THREE.Vector3(740, 56.5, ez - 7.5), 60, 7, Math.PI, true);
  // planters flanking the portal outside, on the porch's edges
  for (const x of [ENTRY_X0 - 24, ENTRY_X1 + 24]) {
    B.stone.box(26, 9, 14, x, 0, ez + 12, 0xc9bfac);
    B.soil.box(23, 0.6, 11, x, 9, ez + 12, 0x6e523a);
    B.leaves.push(shrubGeometry(Math.round(x)).clone().scale(0.8, 0.7, 0.55).translate(x, 9, ez + 12));
  }
  void PORCH;
  // ---- the LAKE GAP: two slim piers and a timber threshold onto the spur ----
  for (const x of [LAKE_GAP_X0, LAKE_GAP_X1]) { B.stone.box(12, 30, 14, x, 0, -980, 0xcfc5b3); B.lanterns.box(3, 5, 3, x, 30, -980, 0xffe0a8); }
  B.timber.box(LAKE_GAP_X1 - LAKE_GAP_X0 - 12, 0.3, 12, 740, -0.2, -980, 0xb98a5c);
  // ---- CORNER PLANTING in the chamfered corners (outside every walkable rect) ----
  for (const [x, z, s, yaw] of [[145, -915, 26, Math.PI / 4], [1335, -915, 26, -Math.PI / 4], [135, -488, 20, -Math.PI / 4]] as const) {
    B.timber.box(s, 10, s, x, 0, z, 0x8c6644, yaw);
    B.soil.box(s - 3, 0.6, s - 3, x, 10, z, 0x6e523a, yaw);
    B.leaves.push(shrubGeometry(Math.round(x + z)).clone().scale(1.0, 1.25, 1.0).translate(x, 10, z));
    B.contact.rect(x, z, s, s, yaw, 0.3, 5);
  }
  B.dark.cyl(8, 12, 1350, 0, -506, 0x6d5a48, 14, 9);
  B.leaves.push(shrubGeometry(77).clone().scale(0.7, 1.3, 0.7).translate(1350, 12, -506));
  // planters along the north wall's inner foot, between the wings and the corners
  for (const [x0, x1] of [[200, 520], [960, 1280]] as const) for (let x = x0; x < x1; x += 64) {
    B.timber.box(40, 7, 10, x + 20, 0, -971, 0x8c6644);
    B.leaves.push(shrubGeometry(Math.round(x)).clone().scale(0.75, 0.6, 0.38).translate(x + 12, 7, -971), shrubGeometry(Math.round(x) + 1).clone().scale(0.6, 0.5, 0.36).translate(x + 30, 7, -971));
  }
  void screens;
}

// ============================== THE PLINTH (V1's stone, unchanged) ==============================================
function plinth(B: LabBakers): void {
  const y = GRADE - LAB2_FLOOR_Y, t = LAB2_FLOOR_Y - GRADE;
  B.stone.add(extrude(LAB2_PLINTH, t - 0.05, y), null, 0xcfc6b6);
  for (const r of PAVED) B.stone.box(r.w, t, r.d, r.x + r.w / 2, y, r.z + r.d / 2, 0xcfc6b6);
  for (const r of [LAKE_SPUR, LAKE_TERRACE]) B.stone.box(r.w + 16, t, r.d + 16, r.x + r.w / 2, y, r.z + r.d / 2, 0xcbc2b1);
  for (const tr of labEntranceTreads()) B.stone.box(tr.rect.w, tr.rise, tr.rect.d, tr.rect.x + tr.rect.w / 2, y, tr.rect.z + tr.rect.d / 2, 0xd3cab9);
  for (const tr of lakeStepTreads()) B.stone.box(tr.rect.w, tr.top - GRADE + 1, tr.rect.d, tr.rect.x + tr.rect.w / 2, y - 1, tr.rect.z + tr.rect.d / 2, 0xd3cab9);
  // the porch and the lake spur get the warm path surface
  B.warm.box(PORCH.w, 0.2, PORCH.d, PORCH.x + PORCH.w / 2, -0.14, PORCH.z + PORCH.d / 2, 0xe2cfae);
  B.warm.box(LAKE_SPUR.w, 0.2, LAKE_SPUR.d, LAKE_SPUR.x + LAKE_SPUR.w / 2, -0.14, LAKE_SPUR.z + LAKE_SPUR.d / 2, 0xe2cfae);
}

// ============================== THE MASTER OVERLOOK =============================================================
function overlook(B: LabBakers, screens: ScreenBank, rnd: () => number): void {
  for (const w of OVERLOOK.wings) {
    const cx = w.x + w.w / 2, cz = w.z + w.d / 2, y = OVERLOOK.y, inner = w.x < 740 ? w.x + w.w : w.x, dir = w.x < 740 ? 1 : -1;
    // a stone podium with a timber deck and a steel-and-cable balustrade on its open sides
    B.stone.box(w.w, y - 1.2, w.d, cx, 0, cz, 0xcfc5b3);
    B.stone.box(w.w + 2, 1.6, w.d + 2, cx, 0, cz, 0xb5ab99);
    for (let x = w.x + 3; x < w.x + w.w - 1; x += 5.4) B.timber.box(5, 1.2, w.d - 2, x + 2.2, y - 1.2, cz, [0xc49567, 0xb98a5c, 0xbf9161][Math.floor(rnd() * 3)]);
    for (let x = w.x + 4; x <= w.x + w.w - 4; x += 22) {
      B.metal.box(1.4, 15, 1.4, x, y, w.z + w.d - 1.5, 0x5d6670);
      if (x + 22 <= w.x + w.w - 4) for (const h of [5, 9.5, 14]) B.metal.tube({ x, y: y + h, z: w.z + w.d - 1.5 }, { x: x + 22, y: y + h, z: w.z + w.d - 1.5 }, h === 14 ? 0.7 : 0.25, h === 14 ? 0xa47a50 : 0xb8c0c8, 4);
    }
    // the stair at the inner end: four stone treads up to the deck, timber nosings
    for (let k = 1; k <= 4; k++) {
      const x = inner + dir * (6 + (4 - k) * 7);
      B.stone.box(7, (y * k) / 4.4, w.d - 12, x, 0, cz, 0xd3cab9);
      B.timber.box(7.2, 0.8, w.d - 12, x, (y * k) / 4.4, cz, 0xa47a50);
    }
    // the ORCHESTRATION WALL on the wing's back edge, facing the Lab: a framed display on two legs
    const owner = w.x < 740 ? "orch-w" : "orch-e";
    B.timber.box(104, 34, 3, cx, y + 2, w.z + 3.5, 0x8c6644);
    B.dark.box(100, 30, 1, cx, y + 4, w.z + 5.1, 0x3d434b);
    for (const sx of [-1, 1]) B.timber.box(4, y + 2, 4, cx + sx * 46, 0, w.z + 3.5, 0x7d5b3c);
    screens.upright(owner, "orchestration", cx - 22, y + 19, w.z + 5.2, 54, 28, 0, "orchestration-idle");
    screens.upright(owner, "map", cx + 28, y + 19, w.z + 5.2, 38, 28, 0, "map", 0.9);
    B.indicators.box(98, 0.6, 0.6, cx, y + 36.2, w.z + 5.2, 0x7fe0c8);
    // a planter at the outer end
    const ox = w.x < 740 ? w.x + 14 : w.x + w.w - 14;
    B.timber.box(18, 8, 18, ox, y, cz + 8, 0x8c6644);
    B.leaves.push(shrubGeometry(Math.round(ox)).clone().scale(0.7, 0.8, 0.7).translate(ox, y + 8, cz + 8));
    B.contact.rect(cx, cz, w.w, w.d, 0, 0.3, 7);
  }
}

// ============================== THE LAKESIDE PAVILIONS ==========================================================
/** finished pergola pavilions on the plinth's ears: the specialist bays' home (their consoles are built powered
 *  down by the station builder — the Lab's growth room, visibly ready) */
function pavilions(B: LabBakers, rnd: () => number): void {
  for (const p of FUTURE_PODS) {
    const cx = p.x + p.w / 2, cz = p.z + p.d / 2, H = 3, top = H + 34;
    B.stone.box(p.w + 4, H - 0.8, p.d + 4, cx, 0, cz, 0xc9bfac);
    for (let x = p.x + 2; x < p.x + p.w - 1; x += 5.6) B.timber.box(5.2, 0.9, p.d - 2, x + 2.4, H - 0.9, cz, [0xc49567, 0xb98a5c, 0xbf9161, 0xad7f53][Math.floor(rnd() * 4)]);
    const xs = [p.x + 4, cx, p.x + p.w - 4], zs = [p.z + 4, p.z + p.d - 4];
    for (const x of xs) for (const z of zs) { B.timber.box(4, top - H, 4, x, H, z, 0x9a7350); B.metal.box(6, 1.4, 6, x, H, z, 0x5d6670); }
    for (const z of zs) B.timber.box(p.w + 6, 4, 3, cx, top, z, 0x8c6644);
    for (const x of xs) B.timber.box(3, 3, p.d + 4, x, top + 4, cz, 0x8c6644);
    for (let x = p.x - 1; x <= p.x + p.w + 1; x += 6) B.timber.box(1.6, 2.4, p.d + 10, x, top + 7, cz, 0xa47a50);
    // a solid roof over the lake half, standing seam
    B.roof.boxAt(p.w + 10, 1.4, p.d * 0.55, cx, top + 10.5, p.z + p.d * 0.27, 0x5c8f80, 0, 0.12);
    for (let x = p.x - 3; x <= p.x + p.w + 3; x += 5.5) B.roof.boxAt(0.5, 0.6, p.d * 0.55, x, top + 11.3, p.z + p.d * 0.27, 0x7aa898, 0, 0.12);
    // a lake-side rail, planters at both ends, two hanging lanterns
    for (let x = p.x + 4; x < p.x + p.w - 4; x += 20) B.metal.tube({ x, y: H + 13, z: p.z + 2 }, { x: Math.min(x + 20, p.x + p.w - 4), y: H + 13, z: p.z + 2 }, 0.6, 0xa47a50, 4);
    for (const x of [p.x + 10, p.x + p.w - 10]) {
      B.timber.box(14, 8, 14, x, H, p.z + p.d - 10, 0x8c6644);
      B.leaves.push(shrubGeometry(Math.round(x * 3)).clone().scale(0.6, 0.7, 0.6).translate(x, H + 8, p.z + p.d - 10));
    }
    for (const x of [cx - 30, cx + 30]) { B.metal.tube({ x, y: top, z: cz }, { x, y: top - 8, z: cz }, 0.3, 0x5d6670, 3); B.lanterns.box(3, 4.4, 3, x, top - 12.4, cz, 0xffe0a8); }
    B.spill.add(pool(36, 0xffc070), new THREE.Matrix4().makeTranslation(cx, H + 0.4, cz));
  }
}

/** BUILD THE SHELL into the shared bakers */
export function buildLabShell(B: LabBakers, screens: ScreenBank): void {
  const rnd = prng(31);
  plinth(B);
  floors(B, rnd);
  briefing(B);
  walls(B, screens, rnd);
  overlook(B, screens, rnd);
  pavilions(B, rnd);
}
