// vo3d build — A CONSTRUCTION SITE (world/construction), drawn. Fence and hoarding, scaffold, site cabin,
// material stacks, plant and tools, a half-laid paving bay and a half-built block wall, tripod work lights
// and the sign.
//
// FOUR DRAWS FOR THE WHOLE SITE, whatever it holds: every solid piece is painted with its colour as a
// vertex attribute and merged into ONE mesh (build/exteriorGeo ColorBaker); the light lenses are a second,
// their ground pools a third, and the sign face (a canvas) the fourth. Materials come from the caller —
// the exterior's own tintable/practical set — so night, rain and the lamps' practical level apply here
// exactly as they do to the rest of the campus.
import * as THREE from "three";
import { ColorBaker, place, prng } from "./exteriorGeo";
import type { ConstructionSite, SiteProp } from "../world/construction";

const COL = {
  galv: 0xb7bcc2, galvDark: 0x8d939a, foot: 0x9c988e, hoarding: 0x26332c, hoardingTrim: 0xf2c230,
  wood: 0xc79f66, woodDark: 0x9c7748, woodPale: 0xdcbf8d, ply: 0xc8ab78,
  block: 0xa9a59c, blockDark: 0x8c887f, bag: 0xe6dfcd, bagPrint: 0x5a8fc8, rebar: 0x7b4a33,
  cabin: 0xe9e5dc, cabinTrim: 0x9aa0a6, door: 0x3d4650, glass: 0x34495a, roof: 0xbfc3c7,
  orange: 0xe9742a, yellow: 0xe0b32c, red: 0xc23b30, white: 0xf1efe8, dark: 0x2b2d31, tyre: 0x232428,
  sand: 0xd8c38f, paving: 0xd0c8b9, soil: 0x6a5a45, mortar: 0xbab3a3,
} as const;

export type SiteMaterials = {
  /** the vertex-coloured body (tintable, white base) */
  body: THREE.Material;
  /** a lamp lens (practical emissive) */
  lens: THREE.Material;
  /** an additive ground pool (practical opacity) */
  spill: THREE.Material;
  /** the sign face, given the canvas it should show (null in a test runner) */
  sign: (canvas: HTMLCanvasElement | null) => THREE.Material;
};

export type SiteBuild = { group: THREE.Group; tris: number; draws: number };

export function buildConstructionSite(site: ConstructionSite, mats: SiteMaterials, poolGeo: THREE.BufferGeometry): SiteBuild {
  const g = new THREE.Group();
  g.name = `construction-site:${site.id}`;
  const B = new ColorBaker();
  const lens = new ColorBaker();
  const rnd = prng(0x5172e ^ site.id.length);

  fence(B, site);
  if (site.scaffold) scaffold(B, site.scaffold);
  for (const p of site.props) prop(B, p, site, rnd);
  const pools: { x: number; z: number; y: number }[] = [];
  for (const l of site.lights) {
    // a lamp standing on a scaffold lift is clamped to the scaffold; one on the ground stands on a tripod
    if (site.scaffold && l.y > site.groundY + 1) clampLight(B, lens, l.x, l.y, l.z, l.yaw);
    else tripodLight(B, lens, l.x, l.y, l.z, l.yaw);
    pools.push({ x: l.x + Math.sin(l.yaw) * 30, z: l.z + Math.cos(l.yaw) * 30, y: l.y + 0.4 });
  }

  let tris = 0, draws = 0;
  const body = B.geometry();
  if (body) {
    const m = new THREE.Mesh(body, mats.body);
    m.name = `construction-body:${site.id}`;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    tris += body.getAttribute("position").count / 3; draws++;
  }
  const lg = lens.geometry();
  if (lg) {
    const m = new THREE.Mesh(lg, mats.lens);
    m.name = `construction-lenses:${site.id}`;
    g.add(m);
    tris += lg.getAttribute("position").count / 3; draws++;
  }
  if (pools.length) {
    const im = new THREE.InstancedMesh(poolGeo, mats.spill, pools.length);
    im.name = `construction-pools:${site.id}`;
    pools.forEach((p, i) => im.setMatrixAt(i, place(p.x, p.y, p.z, 0, 0, 0, 0.75)));
    im.frustumCulled = false;
    im.renderOrder = 2;
    g.add(im);
    tris += (poolGeo.index ? poolGeo.index.count : poolGeo.getAttribute("position").count) / 3 * pools.length; draws++;
  }
  // THE SIGN, on the hoarding's outer face
  const sign = signPlate(site, mats);
  if (sign) { g.add(sign); tris += 2; draws++; }
  return { group: g, tris: Math.round(tris), draws };
}

// ---- the fence and hoarding ---------------------------------------------------------------------------
function fence(B: ColorBaker, s: ConstructionSite): void {
  const y0 = s.groundY, h = s.fenceH, Y = s.yard;
  const runs: { side: ConstructionSite["hoardingSide"]; a: [number, number]; b: [number, number]; out: [number, number] }[] = [
    { side: "north", a: [Y.x, Y.z], b: [Y.x + Y.w, Y.z], out: [0, -1] },
    { side: "south", a: [Y.x, Y.z + Y.d], b: [Y.x + Y.w, Y.z + Y.d], out: [0, 1] },
    { side: "west", a: [Y.x, Y.z], b: [Y.x, Y.z + Y.d], out: [-1, 0] },
    { side: "east", a: [Y.x + Y.w, Y.z], b: [Y.x + Y.w, Y.z + Y.d], out: [1, 0] },
  ];
  for (const r of runs) {
    const dx = r.b[0] - r.a[0], dz = r.b[1] - r.a[1], len = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);
    const n = Math.max(1, Math.round(len / 40)), pw = len / n;
    if (r.side === s.hoardingSide) {
      // SOLID HOARDING: painted ply on timber studs, a yellow trim line, braced from inside
      const hh = h + 12;
      const mx = (r.a[0] + r.b[0]) / 2, mz = (r.a[1] + r.b[1]) / 2;
      B.box(3, hh, len, mx, y0, mz, COL.hoarding, yaw);
      B.box(3.4, 2.2, len, mx + r.out[0] * 0.3, y0 + 2, mz + r.out[1] * 0.3, COL.hoardingTrim, yaw);
      B.box(3.4, 1.4, len + 1, mx, y0 + hh, mz, COL.woodDark, yaw);
      for (let i = 0; i <= n; i++) {
        const t = i / n, x = r.a[0] + dx * t, z = r.a[1] + dz * t;
        B.box(4, hh + 1, 4, x - r.out[0] * 2.5, y0, z - r.out[1] * 2.5, COL.woodDark, yaw);
        // the raking brace and its kentledge block, inside
        B.boxAt(2.4, 30, 2.4, x - r.out[0] * 12, y0 + 13, z - r.out[1] * 12, COL.wood, yaw, 0, 0.62 * (r.out[0] || r.out[1]));
        B.box(9, 4, 6, x - r.out[0] * 20, y0, z - r.out[1] * 20, COL.foot, yaw);
      }
      continue;
    }
    // MESH PANELS on concrete feet: posts, top and bottom rails, a light weld-mesh of thin bars
    for (let i = 0; i < n; i++) {
      const t0 = i / n, x0 = r.a[0] + dx * t0, z0 = r.a[1] + dz * t0;
      const cx = x0 + (dx / n) / 2, cz = z0 + (dz / n) / 2;
      B.box(10, 3.2, 5, x0, y0, z0, COL.foot, yaw + Math.PI / 2);
      B.cyl(0.8, h, x0, y0 + 2, z0, COL.galv, 5);
      for (const yy of [3.5, h + 1]) B.box(1, 1, pw - 1.6, cx, y0 + yy, cz, COL.galv, yaw);
      for (let k = 1; k < 8; k++) {
        const tt = k / 8 - 0.5;
        B.box(0.35, h - 3, 0.35, cx + (dx / n) * tt, y0 + 4, cz + (dz / n) * tt, COL.galvDark, yaw);
      }
      for (const yy of [h * 0.42, h * 0.72]) B.box(0.3, 0.3, pw - 2, cx, y0 + yy, cz, COL.galvDark, yaw);
    }
    B.box(10, 3.2, 5, r.b[0], y0, r.b[1], COL.foot, yaw + Math.PI / 2);
    B.cyl(0.8, h, r.b[0], y0 + 2, r.b[1], COL.galv, 5);
  }
}

// ---- the scaffold -------------------------------------------------------------------------------------
function scaffold(B: ColorBaker, s: NonNullable<ConstructionSite["scaffold"]>): void {
  const zIn = s.zWall + 3, zOut = s.zWall + s.depth, y0 = s.deckY;
  const top = Math.max(...s.lifts) + 20;
  const xs = Array.from({ length: s.bays + 1 }, (_, i) => s.x0 + ((s.x1 - s.x0) * i) / s.bays);
  const V = (x: number, y: number, z: number) => ({ x, y, z });
  for (const x of xs) for (const z of [zIn, zOut]) {
    B.box(5, 0.8, 5, x, y0, z, COL.galvDark); // base plate
    B.tube(V(x, y0 + 0.8, z), V(x, y0 + top, z), 0.9, COL.galv);
  }
  for (const lift of [10, ...s.lifts]) {
    for (const z of [zIn, zOut]) B.tube(V(s.x0, y0 + lift, z), V(s.x1, y0 + lift, z), 0.7, COL.galv); // ledgers
    for (const x of xs) B.tube(V(x, y0 + lift, zIn - 2), V(x, y0 + lift, zOut + 2), 0.7, COL.galv); // transoms
  }
  for (const lift of s.lifts) {
    // boards, laid bay by bay with a little play, a toe board and two guard rails on the open face
    for (let b = 0; b < s.bays; b++) {
      const bx0 = xs[b], bx1 = xs[b + 1];
      for (let k = 0; k < 4; k++) {
        const z = zIn + 1.5 + k * ((zOut - zIn - 3) / 3.4);
        B.box(bx1 - bx0 - 0.6, 1.3, 4.6, (bx0 + bx1) / 2, y0 + lift + 0.7, z + 2.2, k % 2 ? COL.wood : COL.woodPale);
      }
      B.box(bx1 - bx0, 4, 0.8, (bx0 + bx1) / 2, y0 + lift + 2, zOut + 0.6, COL.yellow);
    }
    for (const r of [10, 18]) B.tube(V(s.x0, y0 + lift + r, zOut), V(s.x1, y0 + lift + r, zOut), 0.6, COL.galv);
  }
  // facade braces, one per pair of bays, on the open face
  for (let b = 0; b < s.bays; b += 2) B.tube(V(xs[b], y0 + 2, zOut + 1), V(xs[Math.min(b + 2, s.bays)], y0 + top - 4, zOut + 1), 0.6, COL.galvDark);
  // a ladder up the west bay
  const lx = s.x0 + 9, lz = zOut - 3;
  for (const dx of [-3.2, 3.2]) B.tube(V(lx + dx, y0, lz + 3), V(lx + dx, y0 + s.lifts[0] + 12, lz - 2), 0.45, COL.yellow);
  for (let y = 4; y < s.lifts[0] + 10; y += 5) B.box(6.4, 0.6, 0.8, lx, y0 + y, lz + 3 - (5 * y) / (s.lifts[0] + 12), COL.galvDark);
  // the striped barrier board along the foot
  for (let x = s.x0; x < s.x1 - 1; x += 12) B.box(12, 4, 1.2, x + 6, y0 + 5, zOut + 2.6, Math.round((x - s.x0) / 12) % 2 ? COL.red : COL.white);
  // NEW WORK: the wall's capping half installed — fresh precast caps on the west half, the rest bare
  const wallTop = y0 + 24;
  for (let x = s.x0 + 6; x < (s.x0 + s.x1) / 2; x += 22) B.box(21.4, 3, 12, x + 11, wallTop, s.zWall - 4.5, COL.paving);
  for (let x = (s.x0 + s.x1) / 2 + 4; x < s.x1 - 10; x += 30) B.box(2, 6, 2, x, wallTop, s.zWall - 4.5, COL.rebar); // starter bars
}

// ---- props --------------------------------------------------------------------------------------------
function prop(B: ColorBaker, p: SiteProp, s: ConstructionSite, rnd: () => number): void {
  const y0 = p.kind === "cone" && s.scaffold ? s.scaffold.deckY : s.groundY;
  const c = Math.cos(p.yaw), sn = Math.sin(p.yaw);
  /** a point in the prop's own frame (x right, z toward its front) */
  const at = (lx: number, lz: number): [number, number] => [p.x + lx * c + lz * sn, p.z - lx * sn + lz * c];
  const box = (w: number, h: number, d: number, lx: number, ly: number, lz: number, col: number, dyaw = 0, pitch = 0, roll = 0) => { const [x, z] = at(lx, lz); B.box(w, h, d, x, y0 + ly, z, col, p.yaw + dyaw, pitch, roll); };
  const pallet = (lx: number, lz: number, w: number, d: number) => {
    for (const k of [-1, 0, 1]) box(w, 1.6, 3, lx, 0, lz + k * (d / 2 - 1.5), COL.woodDark);
    for (let k = 0; k < 5; k++) box(4, 1, d, lx - w / 2 + 2 + k * ((w - 4) / 4), 1.6, lz, COL.wood);
  };
  switch (p.kind) {
    case "cabin": {
      box(72, 2.2, 30, 0, 0, 0, COL.dark); // skids
      box(70, 26, 28, 0, 2.2, 0, COL.cabin);
      box(73, 1.6, 31, 0, 28, 0, COL.roof);
      box(10, 18, 0.8, 18, 3, 14.2, COL.door);
      box(26, 9, 0.8, -12, 12, 14.2, COL.glass);
      box(27.5, 1, 1.2, -12, 11.4, 14.6, COL.cabinTrim);
      box(12, 1.2, 6, 18, 0, 17.8, COL.galvDark); // step
      box(0.6, 6, 6, -35.4, 14, -6, COL.cabinTrim); // a wall unit
      for (let x = -30; x <= 30; x += 10) box(0.4, 26, 0.5, x, 2.2, -14.1, COL.cabinTrim); // ribbing
      break;
    }
    case "lumber": {
      for (const lz of [-6, 6]) box(46, 2, 3, 0, 0, lz, COL.woodDark, Math.PI / 2 * 0); // bearers
      for (let layer = 0; layer < 3; layer++) {
        for (let k = 0; k < 5; k++) {
          const tone = [COL.wood, COL.woodPale, COL.ply][Math.floor(rnd() * 3)];
          box(5, 2.4, 52 - layer * 4, -11 + k * 5.4, 2 + layer * 3, (rnd() - 0.5) * 2, tone, Math.PI / 2);
        }
        box(30, 0.6, 1.4, 0, 4.4 + layer * 3, -14, COL.woodDark);
        box(30, 0.6, 1.4, 0, 4.4 + layer * 3, 14, COL.woodDark);
      }
      box(3, 4, 3, 30, 0, 8, COL.woodDark, 0.3); // an offcut
      break;
    }
    case "blocks": {
      pallet(0, 0, 26, 26);
      for (let layer = 0; layer < 3; layer++)
        for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
          if (layer === 2 && i === 2) continue; // the top course already part-used
          box(7.6, 4.4, 11.6, -8 + i * 8, 2.6 + layer * 4.5, -6 + j * 12, (i + j + layer) % 3 ? COL.block : COL.blockDark);
        }
      break;
    }
    case "bags": {
      pallet(0, 0, 26, 26);
      for (let layer = 0; layer < 3; layer++)
        for (let i = 0; i < 2; i++) {
          const along = layer % 2 === 0;
          box(along ? 22 : 10, 3.6, along ? 10 : 22, along ? 0 : -6 + i * 12, 2.7 + layer * 3.7, along ? -6 + i * 12 : 0, COL.bag, (rnd() - 0.5) * 0.08);
          box(along ? 8 : 3, 0.2, along ? 3 : 8, along ? 0 : -6 + i * 12, 6.35 + layer * 3.7, along ? -6 + i * 12 : 0, COL.bagPrint);
        }
      break;
    }
    case "rebar": {
      for (const lx of [-20, 20]) box(4, 2.5, 18, lx, 0, 0, COL.woodDark);
      for (let k = 0; k < 14; k++) {
        const lx = -32, ly = 3.2 + (k % 3) * 1.1, lz = -5 + (k % 5) * 2.4;
        const [x0, z0] = at(lx, lz), [x1, z1] = at(32 + (k % 4), lz);
        B.tube({ x: x0, y: y0 + ly, z: z0 }, { x: x1, y: y0 + ly, z: z1 }, 0.45, COL.rebar, 4);
      }
      break;
    }
    case "sawhorse": {
      for (const lx of [-16, 16]) for (const lz of [-1, 1]) {
        const [xb, zb] = at(lx, lz * 6), [xt, zt] = at(lx * 0.95, lz * 1.6);
        B.tube({ x: xb, y: y0, z: zb }, { x: xt, y: y0 + 14, z: zt }, 0.9, COL.woodDark, 4);
      }
      box(40, 3, 4.5, 0, 14, 0, COL.wood);
      box(54, 1.6, 9, 4, 17, 1, COL.woodPale, 0.06); // the board being worked
      box(2.5, 1.2, 2.5, -8, 18.6, 0, COL.galv); // a nail tin
      break;
    }
    case "mixer": {
      box(6, 1.6, 26, 0, 3, 0, COL.dark);
      for (const lz of [-10, 10]) { const [x, z] = at(-9, lz); B.add(new THREE.CylinderGeometry(4.4, 4.4, 2.4, 10), place(x, y0 + 4.4, z, p.yaw, 0, Math.PI / 2), COL.tyre); }
      box(3, 18, 3, 0, 3, -6, COL.orange);
      const [dx, dz] = at(2, 2);
      B.add(new THREE.CylinderGeometry(7, 10.5, 16, 10), place(dx, y0 + 21, dz, p.yaw, 0.85, 0), COL.orange);
      B.add(new THREE.CylinderGeometry(5.4, 7, 4, 10), place(dx + Math.sin(p.yaw) * 7, y0 + 28, dz + Math.cos(p.yaw) * 7, p.yaw, 0.85, 0), COL.dark);
      break;
    }
    case "barrow": {
      box(14, 1, 20, 0, 6, 1, COL.dark, 0, -0.05);
      box(16, 6.5, 1, 0, 6.5, 11, COL.orange, 0, 0.35);
      box(1, 6.5, 20, -7.6, 6.5, 1, COL.orange, 0, 0, -0.25);
      box(1, 6.5, 20, 7.6, 6.5, 1, COL.orange, 0, 0, 0.25);
      box(13, 1, 18, 0, 8.4, 1, COL.sand); // a load of sand
      for (const lx of [-5, 5]) {
        const [x0, z0] = at(lx, 10), [x1, z1] = at(lx * 1.3, -16);
        B.tube({ x: x0, y: y0 + 6, z: z0 }, { x: x1, y: y0 + 8.5, z: z1 }, 0.7, COL.galvDark, 4);
      }
      const [wx, wz] = at(0, 14);
      B.add(new THREE.CylinderGeometry(4, 4, 2.4, 10), place(wx, y0 + 4, wz, p.yaw, 0, Math.PI / 2), COL.tyre);
      break;
    }
    case "skip": {
      box(40, 3, 20, 0, 0, 0, COL.dark);
      box(42, 14, 1.4, 0, 3, -10.6, COL.yellow, 0, -0.18);
      box(42, 14, 1.4, 0, 3, 10.6, COL.yellow, 0, 0.18);
      box(1.4, 14, 20, -20.6, 3, 0, COL.yellow);
      box(1.4, 14, 20, 20.6, 3, 0, COL.yellow);
      for (let k = 0; k < 9; k++) box(4 + rnd() * 8, 2 + rnd() * 3, 3 + rnd() * 5, (rnd() - 0.5) * 32, 12 + rnd() * 3, (rnd() - 0.5) * 14, [COL.woodDark, COL.blockDark, COL.ply, COL.galvDark][k % 4], rnd() * 3, 0, (rnd() - 0.5) * 0.4);
      break;
    }
    case "generator": {
      box(22, 2, 12, 0, 0, 0, COL.dark);
      box(20, 12, 11, 0, 2, 0, COL.yellow);
      box(8, 6, 0.6, -4, 5, 5.6, COL.dark);
      box(3, 3, 3, 7, 14, 0, COL.dark); // exhaust
      for (const lx of [-11, 11]) box(1, 9, 1, lx, 2, 0, COL.dark); // the frame
      break;
    }
    case "toolbox": {
      // a cantilever box: body, a lid with a lip, a carry handle on two posts, latches — and its tray of tools
      box(12, 5.4, 6.4, 0, 0, 0, COL.red);
      box(12.6, 1.4, 7, 0, 5.4, 0, COL.red, 0, 0, 0);
      box(12.8, 0.4, 7.2, 0, 5.3, 0, COL.dark);
      for (const lx of [-3.6, 3.6]) box(0.8, 2.2, 0.8, lx, 6.8, 0, COL.dark);
      box(8, 0.8, 1.2, 0, 8.6, 0, COL.dark);
      for (const lx of [-4.5, 4.5]) box(1.4, 1.6, 0.4, lx, 3.6, 3.3, COL.galv);
      box(5, 0.6, 0.6, 9, 0, 1.5, COL.galvDark, 0.5); // a spanner left beside it
      box(1.2, 0.8, 4.5, 11, 0, -1, COL.yellow, -0.3); // and a tape measure
      break;
    }
    case "cone": {
      B.add(new THREE.CylinderGeometry(0.6, 4.2, 12, 8), place(p.x, y0 + 7, p.z), COL.orange);
      B.add(new THREE.CylinderGeometry(2, 3, 2.4, 8), place(p.x, y0 + 7.4, p.z), COL.white);
      B.box(9, 1, 9, p.x, y0, p.z, COL.dark);
      break;
    }
    case "paving-works": {
      // a sand bed with a string line: the near half laid, the far half bare, the slabs stacked beside it
      box(70, 0.6, 40, 0, 0, 0, COL.sand);
      for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) {
        if (i > 2 && !(i === 3 && j < 2)) continue;
        box(10.8, 1.1, 9.4, -30 + i * 11.4 + 5.4, 0.4, -15 + j * 10, COL.paving);
      }
      for (const lx of [-36, 36]) for (const lz of [-21, 21]) box(1, 6, 1, lx, 0, lz, COL.woodDark);
      for (const lz of [-21, 21]) { const [x0, z0] = at(-36, lz), [x1, z1] = at(36, lz); B.tube({ x: x0, y: y0 + 4.6, z: z0 }, { x: x1, y: y0 + 4.6, z: z1 }, 0.12, COL.orange, 3); }
      for (let k = 0; k < 7; k++) box(10.8, 1.1, 9.4, -46, 0 + k * 1.2, -8, COL.paving, (rnd() - 0.5) * 0.06);
      box(3, 2.6, 8, 24, 0.6, 6, COL.galvDark, 0.5); // a plate compactor's base
      box(2, 16, 2, 24, 3, 9, COL.yellow, 0.5, -0.5);
      break;
    }
    case "blockwall": {
      // a new planter wall going up course by course, raking back at its unfinished end, mortar board beside
      box(66, 1.6, 12, 0, 0, 0, COL.mortar);
      for (let course = 0; course < 5; course++) {
        const blocks = 7 - Math.max(0, course - 1) * 1;
        for (let k = 0; k < blocks; k++) box(8.6, 4.2, 9, -27 + k * 9 + (course % 2) * 4.5, 1.6 + course * 4.5, 0, (k + course) % 3 ? COL.block : COL.blockDark);
      }
      box(12, 1, 12, 40, 0, 6, COL.ply);
      box(9, 1.6, 9, 40, 1, 6, COL.mortar);
      break;
    }
  }
}

// ---- lights -------------------------------------------------------------------------------------------
function tripodLight(B: ColorBaker, lens: ColorBaker, x: number, y: number, z: number, yaw: number): void {
  const top = { x, y: y + 34, z };
  for (let k = 0; k < 3; k++) {
    const a = yaw + (k / 3) * Math.PI * 2;
    B.tube({ x: x + Math.sin(a) * 9, y, z: z + Math.cos(a) * 9 }, { x, y: y + 22, z }, 0.6, COL.galvDark, 4);
  }
  B.tube({ x, y: y + 20, z }, top, 0.8, COL.galv, 5);
  const hx = x + Math.sin(yaw) * 2, hz = z + Math.cos(yaw) * 2;
  B.box(14, 10, 4, hx, top.y - 3, hz, COL.yellow, yaw, -0.45);
  lens.box(11.6, 7.6, 0.6, hx + Math.sin(yaw) * 2.1, top.y - 1.6, hz + Math.cos(yaw) * 2.1, 0xffffff, yaw, -0.45);
}

/** a work light clamped to a scaffold standard: a short bracket and the head, aimed down at the work */
function clampLight(B: ColorBaker, lens: ColorBaker, x: number, y: number, z: number, yaw: number): void {
  const hy = y + 22;
  B.box(3, 2, 3, x, hy - 1, z, COL.galvDark);
  const hx = x + Math.sin(yaw) * 3, hz = z + Math.cos(yaw) * 3;
  B.box(10, 7, 3.4, hx, hy - 3.5, hz, COL.yellow, yaw, -0.6);
  lens.box(8.4, 5.2, 0.5, hx + Math.sin(yaw) * 1.8, hy - 2.6, hz + Math.cos(yaw) * 1.8, 0xffffff, yaw, -0.6);
}

// ---- the sign -----------------------------------------------------------------------------------------
function signPlate(s: ConstructionSite, mats: SiteMaterials): THREE.Mesh | null {
  const Y = s.yard;
  const side = s.hoardingSide;
  const len = side === "north" || side === "south" ? Y.w : Y.d;
  const w = Math.min(len - 16, 170), h = w * (160 / 512);
  const canvas = signCanvas(s);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mats.sign(canvas));
  m.name = `construction-sign:${s.id}`;
  const cy = s.groundY + (s.fenceH + 12) / 2 + 2;
  if (side === "east") { m.position.set(Y.x + Y.w + 1.8, cy, Y.z + Y.d / 2); m.rotation.y = Math.PI / 2; }
  else if (side === "west") { m.position.set(Y.x - 1.8, cy, Y.z + Y.d / 2); m.rotation.y = -Math.PI / 2; }
  else if (side === "south") { m.position.set(Y.x + Y.w / 2, cy, Y.z + Y.d + 1.8); }
  else { m.position.set(Y.x + Y.w / 2, cy, Y.z - 1.8); m.rotation.y = Math.PI; }
  m.castShadow = false;
  m.receiveShadow = true;
  return m;
}

function signCanvas(s: ConstructionSite): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 320;
  const g = c.getContext("2d");
  if (!g) return null;
  g.fillStyle = "#22302a";
  g.fillRect(0, 0, 1024, 320);
  // a hazard band along the foot
  for (let x = -40; x < 1064; x += 40) {
    g.fillStyle = (x / 40) % 2 === 0 ? "#f2c230" : "#1d2420";
    g.beginPath(); g.moveTo(x, 320); g.lineTo(x + 40, 320); g.lineTo(x + 64, 286); g.lineTo(x + 24, 286); g.fill();
  }
  g.fillStyle = "#9fe08a";
  g.fillRect(0, 0, 1024, 8);
  g.textAlign = "center";
  g.fillStyle = "#f4f1e8";
  g.font = "700 76px system-ui, -apple-system, Segoe UI, sans-serif";
  g.fillText(s.title, 512, 130, 968); // held inside the board (a longer title is condensed, never clipped)
  g.fillStyle = "#b9d1c1";
  g.font = "400 38px system-ui, -apple-system, Segoe UI, sans-serif";
  g.fillText(s.subtitle, 512, 196);
  g.fillStyle = "#f2c230";
  g.font = "600 30px system-ui, -apple-system, Segoe UI, sans-serif";
  g.fillText("HARD HATS · HI-VIS · AUTHORISED PERSONNEL ONLY", 512, 252);
  return c;
}
