// Design Room true-3D reconstruction POC — GEOMETRY BUILDERS (art pass v2).
//
// Everything is composed from primitives (rounded boxes, lathes, low-poly
// spheres, extruded organic shapes) so the room has real volume, real side
// faces and real shadows, while keeping the production footprints,
// proportions, orientation and colours. No GLBs; the only textures are a
// canvas-drawn whiteboard and a procedural wood grain.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { BAKED, FURNITURE, PALETTE, ROOM, SHELL, type BoxSpec, type Facing, type FurnitureItem, type PlantSpec, type Rect } from "./layout";

export type BuildOptions = {
  wallHeight: number;
  frontWall: "low" | "full" | "hidden";
};

export const DEFAULT_BUILD_OPTIONS: BuildOptions = { wallHeight: SHELL.wallHeight, frontWall: "low" };

/** One animated node of the hero plant: rotates about `axis` by amp·sin(t·freq + phase) around `base`. */
export type SwayNode = { obj: THREE.Object3D; axis: "x" | "z"; amp: number; freq: number; phase: number; base: number };

// ---- shared materials -------------------------------------------------------------------
type MatKey = keyof typeof PALETTE;
const materials = new Map<string, THREE.Material>();

function canvas2d(w: number, h: number): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c.getContext("2d");
}

// Soft procedural wood grain: warm base + low-contrast streaks. Used at two
// UV scales (rounded boxes have per-face 0..1 UVs; extruded tops have UVs in
// world units).
let woodTex: THREE.CanvasTexture | null | undefined;
function woodTexture(): THREE.CanvasTexture | null {
  if (woodTex !== undefined) return woodTex;
  const ctx = canvas2d(256, 256);
  if (!ctx) return (woodTex = null);
  ctx.fillStyle = "#dab887"; // ≈ production wood (205,165,115) after lighting
  ctx.fillRect(0, 0, 256, 256);
  let s = 3;
  const r = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  for (let i = 0; i < 70; i++) {
    const y = r() * 256, wdt = 1 + r() * 3, a = 0.05 + r() * 0.08;
    ctx.strokeStyle = `rgba(130,90,50,${a})`;
    ctx.lineWidth = wdt;
    ctx.beginPath();
    ctx.moveTo(-10, y);
    ctx.bezierCurveTo(80, y + (r() - 0.5) * 14, 170, y + (r() - 0.5) * 14, 270, y + (r() - 0.5) * 8);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return (woodTex = tex);
}

export function mat(key: MatKey, roughness = 0.9, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  const id = `${key}:${roughness}:${JSON.stringify(extra)}`;
  let m = materials.get(id) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: PALETTE[key], roughness, metalness: 0, ...extra });
    materials.set(id, m);
  }
  return m;
}
function wood(kind: "box" | "extrude" = "box", light = false): THREE.MeshStandardMaterial {
  const id = `wood:${kind}:${light}`;
  let m = materials.get(id) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    const tex = woodTexture();
    let map: THREE.Texture | null = null;
    if (tex) {
      map = tex.clone();
      map.needsUpdate = true;
      if (kind === "extrude") map.repeat.set(0.02, 0.02);
    }
    // with a grain map the map carries the wood colour; tint only lightly so it does not go orange
    const color = map ? (light ? 0xfff8ee : 0xffffff) : light ? PALETTE.woodLight : PALETTE.wood;
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0, map });
    materials.set(id, m);
  }
  return m;
}
const fabric = (key: MatKey = "green") => mat(key, 0.98);
const plastic = (key: MatKey = "white") => mat(key, 0.45);
const metal = () => mat("metal", 0.35, { metalness: 0.7 });
function screenMat(): THREE.MeshStandardMaterial {
  return mat("screen", 0.25, { emissive: 0x3a5a86, emissiveIntensity: 0.55 });
}
function glassMat(): THREE.MeshStandardMaterial {
  let m = materials.get("glass") as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: PALETTE.glass, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.42, side: THREE.DoubleSide, envMapIntensity: 1.2 });
    materials.set("glass", m);
  }
  return m;
}

// ---- shared geometry helpers ------------------------------------------------------------
const sphereGeo = new THREE.IcosahedronGeometry(1, 1); // chair casters only
const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 20);

let seed = 7;
function rnd(): number {
  seed = (seed * 1664525 + 1013904223) % 4294967296; // deterministic LCG: every rebuild is identical
  return seed / 4294967296;
}
export function resetSeed(): void {
  seed = 7;
}

function shadowed<T extends THREE.Object3D>(o: T, cast = true, receive = true): T {
  o.castShadow = cast;
  o.receiveShadow = receive;
  return o;
}

/** Rounded box with its base at y0, centred on (cx, cz). */
export function rbox(w: number, h: number, d: number, m: THREE.Material, cx: number, y0: number, cz: number, radius = 0.8, segments = 2): THREE.Mesh {
  const r = Math.min(radius, w / 2, h / 2, d / 2);
  const g = r > 0.05 ? new RoundedBoxGeometry(w, h, d, segments, r) : new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(cx, y0 + h / 2, cz);
  return shadowed(mesh);
}
function boxFromSpec(b: BoxSpec, m: THREE.Material, radius = 0.8, y0 = 0): THREE.Mesh {
  return rbox(b.w, b.h, b.d, m, b.x + b.w / 2, y0, b.z + b.d / 2, radius);
}
export function cyl(r: number, h: number, m: THREE.Material, cx: number, y0: number, cz: number, rTop = r): THREE.Mesh {
  const mesh = new THREE.Mesh(rTop === r ? unitCyl : new THREE.CylinderGeometry(rTop / r, 1, 1, 20), m);
  mesh.scale.set(r, h, r);
  mesh.position.set(cx, y0 + h / 2, cz);
  return shadowed(mesh);
}
/** Revolved profile (points are [radius, height]); base at y0. */
function lathe(profile: [number, number][], m: THREE.Material, cx: number, y0: number, cz: number, segments = 24): THREE.Mesh {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(pts, segments), m);
  mesh.position.set(cx, y0, cz);
  return shadowed(mesh);
}
/** Extruded shape lying flat (shape y → world z), thickness `t`, base at y0. */
function slab(shape: THREE.Shape, t: number, m: THREE.Material, y0: number, bevel = 0.6): THREE.Mesh {
  const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel * 0.7, bevelSegments: 2, curveSegments: 12 });
  const mesh = new THREE.Mesh(g, m);
  mesh.rotation.x = -Math.PI / 2; // shape +y → world -z … flip below so shape +y → world +z
  mesh.scale.z = -1;
  mesh.position.y = y0 + (bevel > 0 ? bevel * 0.7 : 0);
  return shadowed(mesh);
}

const FACING_Y: Record<Facing, number> = { north: 0, west: Math.PI / 2, south: Math.PI, east: -Math.PI / 2 };

/** Group positioned at a rect's centre, rotated so its local -z points `facing`. */
function placed(rect: Rect, facing: Facing): THREE.Group {
  const g = new THREE.Group();
  g.position.set(rect.x + rect.w / 2, 0, rect.z + rect.d / 2);
  g.rotation.y = FACING_Y[facing];
  return g;
}
function localSize(rect: Rect, facing: Facing): { w: number; d: number } {
  return facing === "east" || facing === "west" ? { w: rect.d, d: rect.w } : { w: rect.w, d: rect.d };
}

// ---- props ---------------------------------------------------------------------------------
function pot(r: number, h: number, m: THREE.Material, cx: number, y0: number, cz: number): THREE.Group {
  const g = new THREE.Group();
  // tapered planter with a rolled lip
  g.add(lathe([[r * 0.68, 0], [r * 0.72, 0.4], [r * 0.9, h * 0.75], [r, h * 0.92], [r * 1.02, h], [r * 0.9, h], [r * 0.86, h - 0.6]], m, cx, y0, cz));
  g.add(cyl(r * 0.84, 0.6, mat("potDark", 0.95), cx, y0 + h - 0.9, cz)); // soil
  return g;
}

function laptop(cx: number, y0: number, cz: number): THREE.Group {
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
function monitor(cx: number, y0: number, cz: number, w = 15, h = 8.5): THREE.Group {
  const g = new THREE.Group();
  g.add(cyl(3.2, 0.5, mat("charcoal", 0.5), cx, y0, cz + 1.2, 2.6));
  g.add(rbox(1.2, 4, 1.8, mat("charcoal", 0.5), cx, y0 + 0.5, cz + 1.2, 0.3));
  g.add(rbox(w, h, 0.9, mat("charcoal", 0.45), cx, y0 + 3.6, cz + 0.6, 0.5));
  g.add(rbox(w - 1.2, h - 1.2, 0.15, screenMat(), cx, y0 + 4.2, cz + 0.6 - 0.5, 0.2));
  return g;
}
function mug(cx: number, y0: number, cz: number): THREE.Group {
  const g = new THREE.Group();
  g.add(lathe([[1.1, 0], [1.25, 0.3], [1.3, 2.2], [1.1, 2.2], [1.05, 0.4]], plastic("white"), cx, y0, cz, 16));
  g.add(rbox(0.5, 1.3, 0.35, plastic("white"), cx + 1.55, y0 + 0.6, cz, 0.15));
  return g;
}
function book(cx: number, y0: number, cz: number, w: number, d: number, key: MatKey, rot = 0): THREE.Mesh {
  const b = rbox(w, 0.9, d, mat(key, 0.85), cx, y0, cz, 0.15);
  b.rotation.y = rot;
  return b;
}

// ---- furniture ------------------------------------------------------------------------------
const DESK_H = 24;
const TOP_T = 2.4;

function deskTop(w: number, d: number, radius = 1.8): THREE.Mesh {
  return rbox(w, TOP_T, d, wood(), 0, DESK_H - TOP_T, 0, radius, 3);
}
/** Olive drawer pedestal with two drawer fronts and small bar handles. */
function pedestal(w: number, d: number, cx: number, cz: number, h = DESK_H - TOP_T - 0.8): THREE.Group {
  const g = new THREE.Group();
  g.add(rbox(w, h, d, fabric("green"), cx, 0.8, cz, 1.0, 3));
  g.add(rbox(w - 1, 0.8, d - 1, mat("greenDark", 0.9), cx, 0, cz, 0.2)); // plinth
  for (let i = 0; i < 2; i++) {
    const y = 0.8 + h * (0.12 + i * 0.44);
    g.add(rbox(w - 1.6, h * 0.36, 0.5, mat("greenSeat", 0.9), cx, y, cz + d / 2 + 0.05, 0.4)); // drawer front
    g.add(rbox(w * 0.45, 0.5, 0.5, metal(), cx, y + h * 0.36 - 1.2, cz + d / 2 + 0.55, 0.2)); // handle
  }
  return g;
}
function deskLeg(cx: number, cz: number): THREE.Mesh {
  return rbox(1.4, DESK_H - TOP_T, 1.4, metal(), cx, 0, cz, 0.5);
}

function leadDesk(item: FurnitureItem): THREE.Group {
  // production: an asymmetric curved top (straight back edge, soft bulging front-right)
  // over a fluted olive plinth, monitor centred, notebook left, pad + plant + mug right
  const g = placed(item.rect, item.facing);
  const { w, d } = localSize(item.rect, item.facing);
  const hw = w / 2, hd = d / 2;
  const top = new THREE.Shape();
  top.moveTo(-hw + 6, -hd);
  top.lineTo(hw - 8, -hd);
  top.bezierCurveTo(hw + 1, -hd, hw + 1, -hd * 0.1, hw - 1, hd * 0.55);
  top.bezierCurveTo(hw - 3, hd * 1.05, hw * 0.35, hd * 1.05, 0, hd * 0.9);
  top.bezierCurveTo(-hw * 0.5, hd * 0.75, -hw * 0.95, hd * 0.9, -hw, hd * 0.35);
  top.bezierCurveTo(-hw - 1, -hd * 0.3, -hw - 0.5, -hd, -hw + 6, -hd);
  g.add(slab(top, TOP_T, wood("extrude", true), DESK_H - TOP_T, 0.8));
  // base: inset copy of the top outline, olive, with vertical flutes on the camera-facing run
  const base = new THREE.Shape();
  const k = 0.78;
  base.moveTo((-hw + 6) * k, -hd * k);
  base.lineTo((hw - 8) * k, -hd * k);
  base.bezierCurveTo((hw + 1) * k, -hd * k, (hw + 1) * k, -hd * 0.1 * k, (hw - 1) * k, hd * 0.55 * k);
  base.bezierCurveTo((hw - 3) * k, hd * 1.05 * k, hw * 0.35 * k, hd * 1.05 * k, 0, hd * 0.9 * k);
  base.bezierCurveTo(-hw * 0.5 * k, hd * 0.75 * k, -hw * 0.95 * k, hd * 0.9 * k, -hw * k, hd * 0.35 * k);
  base.bezierCurveTo((-hw - 1) * k, -hd * 0.3 * k, (-hw - 0.5) * k, -hd * k, (-hw + 6) * k, -hd * k);
  g.add(slab(base, DESK_H - TOP_T - 1.2, fabric("green"), 0.6, 0.3));
  for (let i = -6; i <= 6; i++) {
    // flutes: thin olive-dark ribs along the front bulge
    const t = i / 6;
    const x = t * hw * 0.62;
    const z = hd * k * (0.92 - 0.12 * t * t) + 0.35;
    g.add(rbox(1.1, DESK_H - TOP_T - 2.4, 0.9, mat("greenDark", 0.9), x, 1.2, z, 0.35));
  }
  g.add(monitor(0, DESK_H, 0));
  g.add(book(-w * 0.32, DESK_H, -1, 6.5, 8.5, "greenDark", 0.08));
  g.add(rbox(6, 0.35, 7.5, plastic("white"), w * 0.24, DESK_H, 2.5, 0.2));
  g.add(smallPot(w * 0.38, DESK_H, -2.5, 1.7));
  g.add(mug(w * 0.3, DESK_H, 7));
  return g;
}

function memberDesk(item: FurnitureItem): THREE.Group {
  // column desk: wood top, olive pedestal on the wall side, slim metal leg on the open side,
  // olive modesty lip along the wall edge, laptop, two small pots, mug
  const g = placed(item.rect, item.facing);
  const { w, d } = localSize(item.rect, item.facing);
  g.add(deskTop(w, d));
  g.add(pedestal(w * 0.36, d * 0.86, -w * 0.3, 0));
  g.add(deskLeg(w * 0.42, -d * 0.42));
  g.add(deskLeg(w * 0.42, d * 0.42));
  g.add(rbox(w * 0.94, 3.2, 1.1, fabric("green"), 0, DESK_H - 3.2 - TOP_T, d / 2 - 0.9, 0.4)); // apron
  g.add(rbox(w * 0.9, 1.6, 1.2, mat("greenDark", 0.9), 0, DESK_H - 0.4, d / 2 - 0.6, 0.4)); // back lip
  g.add(laptop(w * 0.08, DESK_H, 0.5));
  g.add(smallPot(-w * 0.32, DESK_H, -d * 0.32, 1.4));
  g.add(smallPot(-w * 0.32, DESK_H, d * 0.32, 1.4));
  g.add(mug(w * 0.34, DESK_H, -d * 0.36));
  return g;
}

function deskPanel(item: FurnitureItem): THREE.Group {
  // bottom row of the U: wide top, olive drawer pedestals both ends, modesty panel, laptop, pots
  const g = placed(item.rect, item.facing);
  const { w, d } = localSize(item.rect, item.facing);
  g.add(deskTop(w, d));
  g.add(pedestal(w * 0.22, d * 0.78, -w * 0.37, 0.5));
  g.add(pedestal(w * 0.22, d * 0.78, w * 0.37, 0.5));
  g.add(rbox(w * 0.98, DESK_H - TOP_T - 6, 1.1, fabric("green"), 0, 5, -d / 2 + 0.7, 0.5)); // modesty panel
  g.add(laptop(0, DESK_H, 1.5));
  g.add(smallPot(-w * 0.27, DESK_H, -d * 0.25, 1.5));
  g.add(smallPot(-w * 0.27, DESK_H, d * 0.27, 1.5));
  g.add(smallPot(w * 0.3, DESK_H, d * 0.27, 1.5));
  g.add(mug(w * 0.28, DESK_H, -d * 0.28));
  return g;
}

function curveDesk(item: FurnitureItem): THREE.Group {
  // corner wedge joining the column desk to the bottom row: top with the inner
  // corner cut on a soft diagonal, olive base + flutes along the diagonal
  const { w, d } = item.rect;
  const mx = (x: number) => (item.mirrored ? w - x : x);
  const shapeOf = (inset: number): THREE.Shape => {
    const s = new THREE.Shape();
    const pts: [number, number][] = [
      [mx(inset), inset],
      [mx(w * 0.48), inset],
      [mx(w - inset), d * 0.5],
      [mx(w - inset), d - inset],
      [mx(inset), d - inset],
    ];
    pts.forEach(([x, y], i) => (i === 0 ? s.moveTo(x, y) : s.lineTo(x, y)));
    s.closePath();
    return s;
  };
  const g = new THREE.Group();
  const top = slab(shapeOf(0), TOP_T, wood("extrude"), DESK_H - TOP_T, 0.7);
  const base = slab(shapeOf(2.4), DESK_H - TOP_T - 1.4, fabric("green"), 0.6, 0.3);
  top.position.x = item.rect.x;
  top.position.z = item.rect.z;
  base.position.x = item.rect.x;
  base.position.z = item.rect.z;
  g.add(top, base);
  g.add(smallPot(item.rect.x + mx(w * 0.6), DESK_H, item.rect.z + d * 0.72, 1.5));
  const pad = rbox(7, 0.5, 5, plastic("white"), item.rect.x + mx(w * 0.62), DESK_H, item.rect.z + d * 0.33, 0.2);
  pad.rotation.y = item.mirrored ? -0.5 : 0.5;
  g.add(pad);
  return g;
}

function sideDesk(item: FurnitureItem): THREE.Group {
  const g = placed(item.rect, item.facing);
  const r = Math.min(item.rect.w, item.rect.d) / 2;
  const h = 19;
  g.add(lathe([[0, h - TOP_T], [r - 1.2, h - TOP_T], [r, h - TOP_T + 0.6], [r, h - 0.5], [r - 0.6, h], [0, h]], wood("box", true), 0, 0, 0, 40));
  g.add(cyl(2.4, h - TOP_T, wood(), 0, 0.8, 0));
  g.add(lathe([[0, 0], [r * 0.55, 0], [r * 0.5, 0.9], [2.6, 1.2], [0, 1.2]], wood(), 0, 0, 0, 32));
  g.add(smallPot(0.5, h, -4, 1.7));
  g.add(book(2, h, 5, 7, 5, "white", 0.15));
  g.add(book(1.6, h + 0.9, 5.2, 6, 4.4, "greenDark", -0.1));
  return g;
}

function sofa(item: FurnitureItem): THREE.Group {
  // along the left wall: soft deck, two puffy seat cushions, two back cushions
  // against a rounded back panel, rounded arms, short feet, two pillows
  const g = placed(item.rect, "north");
  const { w, d } = item.rect;
  const deckH = 8, armW = 5, backW = 7;
  g.add(rbox(w, deckH, d, fabric("green"), 0, 2, 0, 3, 3));
  for (let i = 0; i < 4; i++) g.add(cyl(1, 2, mat("greenDark", 0.8), (i % 2 ? 1 : -1) * (w / 2 - 3), 0, (i < 2 ? 1 : -1) * (d / 2 - 4)));
  g.add(rbox(backW, 22, d - 1, fabric("greenDark"), -w / 2 + backW / 2, 2, 0, 3, 3)); // back panel (wall side)
  for (const s of [-1, 1]) g.add(rbox(w - backW + 1, 15, armW, fabric("green"), backW / 2, 2, s * (d / 2 - armW / 2), 2.4, 3)); // arms
  const cushW = w - backW - 1.5, cushD = (d - 2 * armW - 3) / 2;
  for (const s of [-1, 1]) {
    g.add(rbox(cushW, 4.2, cushD, fabric("greenSeat"), backW / 2 + 0.5, deckH + 2, s * (cushD / 2 + 0.6), 2, 3)); // seat cushions
    const back = rbox(4.5, 12, cushD - 1, fabric("greenSeat"), -w / 2 + backW + 1.6, deckH + 2, s * (cushD / 2 + 0.6), 2, 3); // back cushions
    back.rotation.z = -0.12;
    g.add(back);
  }
  const p1 = rbox(8.5, 3.2, 8.5, fabric("cushionGray"), backW / 2 + 0.5, deckH + 6.2, -d * 0.2, 1.6, 3);
  p1.rotation.y = 0.35;
  const p2 = rbox(8.5, 3.2, 8.5, fabric("cushionCream"), backW / 2 + 1, deckH + 6.2, d * 0.22, 1.6, 3);
  p2.rotation.y = -0.45;
  g.add(p1, p2);
  return g;
}

function beanbag(item: FurnitureItem): THREE.Group {
  // inflated bag: revolved profile with a soft top dimple and a pinched base
  const g = placed(item.rect, "north");
  const r = Math.min(item.rect.w, item.rect.d) / 2;
  const h = r * 1.05;
  const prof: [number, number][] = [[0, 0.2], [r * 0.55, 0], [r * 0.9, h * 0.18], [r, h * 0.42], [r * 0.9, h * 0.72], [r * 0.6, h * 0.94], [r * 0.25, h], [0, h * 0.95]];
  const bag = lathe(prof, fabric("green"), 0, 0, 0, 28);
  bag.rotation.y = 0.6;
  g.add(bag);
  g.add(cyl(1.4, 0.5, mat("greenDark"), 0, h * 0.94, 0));
  return g;
}

function rug(item: FurnitureItem): THREE.Group {
  const g = placed(item.rect, "north");
  const r = Math.min(item.rect.w, item.rect.d) / 2;
  const m = cyl(r, 0.7, mat("rug", 1), 0, 0, 0);
  m.castShadow = false;
  g.add(m);
  // woven rings
  for (let i = 1; i <= 3; i++) g.add(cyl(r * (1 - i * 0.22), 0.12, mat("wood", 1), 0, 0.7, 0));
  return g;
}

function chair(item: FurnitureItem, style: "a" | "b" | "lead"): THREE.Group {
  // sculpted task chair: five tapered legs with casters, gas lift, seat pan,
  // rounded cushion, two-part contoured back (lumbar + upper) with a slight
  // recline, and L-shaped arms (styles a/lead)
  const g = placed(item.rect, item.facing);
  const { w, d } = localSize(item.rect, item.facing);
  const seatW = Math.min(w, d) * 0.8;
  const seatH = 13;
  const frame = style === "lead" ? mat("charcoal", 0.5) : plastic("white");
  const cushion = fabric(style === "lead" ? "greenDark" : "greenSeat");
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const len = seatW * 0.52;
    const leg = rbox(len, 1.3, 1.5, frame, 0, 0.7, 0, 0.5);
    leg.geometry.translate(len / 2, 0, 0);
    leg.rotation.y = -a;
    leg.rotation.z = 0.08;
    g.add(leg);
    const wheel = new THREE.Mesh(sphereGeo, mat("charcoal", 0.6));
    wheel.scale.set(1, 0.9, 1);
    wheel.position.set(Math.cos(a) * len * 0.97, 0.9, Math.sin(a) * len * 0.97);
    g.add(shadowed(wheel));
  }
  g.add(cyl(1.15, seatH - 3.5, metal(), 0, 1.4, 0));
  g.add(cyl(2.4, 1.2, frame, 0, seatH - 3.6, 0));
  g.add(rbox(seatW * 0.9, 1.4, seatW * 0.9, frame, 0, seatH - 3.2, 0.3, 0.6)); // seat pan
  g.add(rbox(seatW, 3.4, seatW, cushion, 0, seatH - 2, 0.3, 1.7, 3)); // cushion
  // back: lumbar block + upper shell, tilted back around the rear seat edge
  const back = new THREE.Group();
  back.position.set(0, seatH - 0.5, seatW / 2 - 1.2);
  back.rotation.x = -0.14;
  const backH = style === "lead" ? 20 : style === "a" ? 16 : 13;
  back.add(rbox(seatW * 0.86, backH * 0.42, 3.2, cushion, 0, 0, 0, 1.5, 3));
  const upper = rbox(seatW * 0.92, backH * 0.62, 2.6, cushion, 0, backH * 0.38, -0.6, 1.6, 3);
  upper.rotation.x = -0.1;
  back.add(upper);
  back.add(rbox(seatW * 0.16, backH * 0.9, 0.8, frame, 0, 0.8, 1.6, 0.35)); // slim spine
  back.add(rbox(seatW * 0.96, 1.1, 1.0, frame, 0, backH * 0.98, -0.2, 0.4)); // top rim
  g.add(back);
  if (style !== "b") {
    for (const s of [-1, 1]) {
      g.add(rbox(1.2, 6.5, 1.2, frame, s * (seatW / 2 - 0.9), seatH - 0.5, 1.5, 0.4));
      g.add(rbox(2.2, 1.3, seatW * 0.62, frame, s * (seatW / 2 - 0.9), seatH + 6, 0.4, 0.6, 3));
    }
  }
  return g;
}

export function buildFurniture(item: FurnitureItem): THREE.Group {
  switch (item.kind) {
    case "lead-desk":
      return leadDesk(item);
    case "member-desk":
      return memberDesk(item);
    case "desk-panel":
      return deskPanel(item);
    case "curve-desk":
      return curveDesk(item);
    case "side-desk":
      return sideDesk(item);
    case "sofa":
      return sofa(item);
    case "beanbag":
      return beanbag(item);
    case "rug":
      return rug(item);
    case "chair-a":
      return chair(item, "a");
    case "chair-b":
      return chair(item, "b");
    case "lead-chair":
      return chair(item, "lead");
  }
}

// ---- plants ------------------------------------------------------------------------------------
// One coherent family, tiered by size (production location/size decide the tier):
//   large   (r ≥ 7)   trunk + radiating branches + blade-leaf fans; trunk/branch/leaf sway
//   medium  (3 ≤ r<7) pot + splayed stems each ending in 2-3 leaves; stem + leaf sway
//   hanging           wall pot + hanging vine chains with alternating leaflets; very slow sway
//   small   (desk pots) static succulent rosettes — pots, soil and leaves are INSTANCED
//                     (three draw calls for every desk plant in the room, see finalizeSucculents)
// Leaf geometry and foliage materials are shared by every tier.
export type PlantTier = "large" | "medium" | "hanging" | "small";
export function tierFor(p: PlantSpec): PlantTier {
  if (p.hanging) return "hanging";
  if (p.r >= 7) return "large";
  return "medium";
}

let leafGeo: THREE.ShapeGeometry | null = null;
function leafGeometry(): THREE.ShapeGeometry {
  if (leafGeo) return leafGeo;
  // pointed leaf blade, base at the origin, tip along +y (length 1)
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.22, 0.15, 0.3, 0.55, 0, 1);
  s.bezierCurveTo(-0.3, 0.55, -0.22, 0.15, 0, 0);
  leafGeo = new THREE.ShapeGeometry(s, 6);
  return leafGeo;
}
const foliage = (light: boolean) => mat(light ? "foliageLight" : "foliage", 0.85, { side: THREE.DoubleSide });
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
  const potH = p.h * 0.34;
  g.add(pot(p.r * 0.8, potH, mat("potDark", 0.7), 0, 0, 0));
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
  const branches = 6 + Math.round(3 * k);
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
    const leaves = 4 + Math.floor(rnd() * 2) + Math.round(2 * k);
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
// is assembled and world transforms are known.
const SUCCULENT_KEY = "succulent";
function smallPot(cx: number, y0: number, cz: number, r = 1.5): THREE.Group {
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

/** Advance every sway node to time `t` (seconds). Cheap: two sins per node. */
export function animateSway(nodes: readonly SwayNode[], t: number): void {
  for (const n of nodes) {
    const v = n.base + n.amp * Math.sin(t * n.freq + n.phase) + n.amp * 0.35 * Math.sin(t * n.freq * 2.3 + n.phase * 1.7);
    if (n.axis === "x") n.obj.rotation.x = v;
    else n.obj.rotation.z = v;
  }
}

// ---- baked items ---------------------------------------------------------------------------------
function whiteboardTexture(): THREE.Texture | null {
  const ctx = canvas2d(512, 256);
  if (!ctx) return null;
  ctx.fillStyle = "#fbfaf7";
  ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = "#d9463b";
  ctx.font = "bold 40px 'Comic Sans MS', 'Marker Felt', sans-serif";
  ctx.textAlign = "center";
  ["ALWAYS GIVE", "A 100% AT", "WORK"].forEach((t, i) => ctx.fillText(t, 256, 58 + i * 46));
  ctx.font = "22px 'Comic Sans MS', 'Marker Felt', sans-serif";
  ctx.textAlign = "left";
  ["MON - 11%", "TUES - 24%", "WED - 40%", "THURS - 23%", "FRI - 2%"].forEach((t, i) => ctx.fillText(t, 40, 178 + i * 19));
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function rearCabinet(): THREE.Group {
  // long white credenza on a dark plinth: alternating wood / olive doors with a
  // groove and a bar handle, top items: coffee machine, frames, books, small pots
  const g = new THREE.Group();
  const b = BAKED.rearCabinet;
  g.add(boxFromSpec(b, plastic("white"), 1.4));
  g.add(rbox(b.w - 3, 1.2, b.d - 3, mat("charcoal", 0.8), b.x + b.w / 2, -0.1, b.z + b.d / 2, 0.2)); // plinth shadow line
  const n = BAKED.rearCabinetModules;
  const mw = (b.w - 4) / n;
  for (let i = 0; i < n; i++) {
    const cx = b.x + 2 + mw * (i + 0.5), fz = b.z + b.d - 0.2;
    const isWood = i % 3 !== 1;
    const door = rbox(mw - 1.2, b.h - 4.5, 1.2, isWood ? wood() : fabric("green"), cx, 2.2, fz, 0.5);
    g.add(door);
    g.add(rbox(mw - 3, 0.35, 0.3, mat("charcoal", 0.8), cx, 2.2 + (b.h - 4.5) * 0.55, fz + 0.5, 0.1)); // groove
    g.add(rbox(mw * 0.3, 0.6, 0.6, metal(), cx, 2.2 + (b.h - 4.5) * 0.62, fz + 0.7, 0.2)); // handle
  }
  // coffee machine: body, tray, cup, top tank
  const cm = BAKED.coffeeMachine;
  const cmx = cm.x + cm.w / 2, cmz = cm.z + cm.d / 2;
  g.add(rbox(cm.w * 0.75, cm.h, cm.d * 0.8, mat("charcoal", 0.45), cmx, b.h, cmz - cm.d * 0.05, 0.9));
  g.add(rbox(cm.w * 0.8, 1, cm.d * 0.95, metal(), cmx, b.h, cmz, 0.3));
  g.add(rbox(cm.w * 0.5, cm.h * 0.3, cm.d * 0.3, mat("charcoal", 0.3), cmx, b.h + cm.h, cmz - cm.d * 0.1, 0.4));
  g.add(mug(cmx, b.h + 1, cmz + cm.d * 0.35));
  const bk = BAKED.rearBooks;
  for (let i = 0; i < 5; i++) {
    const bw = bk.w / 6;
    const bb = rbox(bw, bk.h * (0.7 + (i % 3) * 0.15), bk.d * 0.6, mat(i % 2 ? "green" : "wood", 0.85), bk.x + bw * (i + 0.5) + 1, b.h, bk.z + bk.d / 2, 0.25);
    g.add(bb);
  }
  for (const f of BAKED.rearFrames) {
    g.add(rbox(f.w, f.h, 0.8, plastic("white"), f.x + f.w / 2, b.h, f.z + f.d / 2, 0.25));
    g.add(rbox(f.w * 0.7, f.h * 0.6, 0.2, mat("boardPin", 0.9), f.x + f.w / 2, b.h + f.h * 0.2, f.z + f.d / 2 + 0.5, 0.1));
  }
  g.add(smallPot(b.x + b.w * 0.42, b.h, b.z + b.d * 0.45, 1.6));
  g.add(smallPot(b.x + b.w * 0.86, b.h, b.z + b.d * 0.5, 1.8));
  return g;
}

function whiteboard(): THREE.Group {
  const g = new THREE.Group();
  const wb = BAKED.whiteboard;
  const w = wb.x1 - wb.x0, h = wb.yTop - wb.yBottom;
  const z = SHELL.wallThickness + 0.9;
  g.add(rbox(w + 2, h + 2, 1.4, metal(), wb.x0 + w / 2, wb.yBottom - 1, z - 0.3, 0.4));
  const tex = whiteboardTexture();
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), tex ? new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 }) : plastic("white"));
  face.position.set(wb.x0 + w / 2, wb.yBottom + h / 2, z + 0.5);
  g.add(shadowed(face, false, true));
  g.add(rbox(w * 0.6, 1.2, 1.8, metal(), wb.x0 + w / 2, wb.yBottom - 1.4, z + 0.6, 0.3)); // marker tray
  return g;
}

function leftBoards(): THREE.Group {
  const g = new THREE.Group();
  const x = SHELL.wallThickness + 0.8;
  for (const b of BAKED.boards) {
    const len = b.z1 - b.z0, h = b.yTop - b.yBottom;
    g.add(rbox(1.2, h, len, mat("boardBg", 0.95), x, b.yBottom, b.z0 + len / 2, 0.3));
    g.add(rbox(1.0, h + 1.2, len + 1.2, wood(), x - 0.3, b.yBottom - 0.6, b.z0 + len / 2, 0.3)); // frame
    for (let i = 0; i < 8; i++) {
      const pin = rbox(0.5, 4.5, 3.6, mat(i % 3 === 0 ? "boardPin" : i % 3 === 1 ? "wood" : "cushionCream", 0.9), x + 0.9, b.yBottom + 3 + (i % 4) * 7.5, b.z0 + 5 + Math.floor(i / 4) * (len / 2) + (i % 4) * 4, 0.15);
      g.add(pin);
    }
  }
  return g;
}

function bottomCabinets(): THREE.Group {
  // open shelving units: light carcass, one shelf, dividers, books/boxes inside; printer on unit 2
  const g = new THREE.Group();
  BAKED.bottomCabinets.forEach((b, idx) => {
    const carcass = mat("cushionGray", 0.85);
    g.add(rbox(b.w, 1.4, b.d, carcass, b.x + b.w / 2, b.h - 1.4, b.z + b.d / 2, 0.5)); // top
    g.add(rbox(b.w, 1.2, b.d, carcass, b.x + b.w / 2, 0, b.z + b.d / 2, 0.3)); // bottom
    g.add(rbox(b.w, b.h, 1.2, carcass, b.x + b.w / 2, 0, b.z + 0.6, 0.3)); // back
    const n = Math.max(2, Math.round(b.w / 24));
    const cw = b.w / n;
    for (let i = 0; i <= n; i++) g.add(rbox(1.2, b.h, b.d, carcass, b.x + Math.min(b.w - 0.6, Math.max(0.6, cw * i)), 0, b.z + b.d / 2, 0.3));
    g.add(rbox(b.w - 2, 0.9, b.d - 1.5, carcass, b.x + b.w / 2, b.h * 0.5, b.z + b.d / 2 - 0.4, 0.2)); // shelf
    for (let i = 0; i < n; i++) {
      const cx = b.x + cw * (i + 0.5);
      if (i % 2 === 0) {
        g.add(rbox(cw * 0.6, b.h * 0.36, b.d * 0.6, mat(i % 4 === 0 ? "green" : "wood", 0.85), cx, 1.2, b.z + b.d / 2, 0.3)); // box
      } else {
        for (let k = 0; k < 3; k++) g.add(rbox(1.2, b.h * 0.34 - k * 0.6, b.d * 0.55, mat(k % 2 ? "greenDark" : "cushionCream", 0.85), cx - 2 + k * 1.8, 1.2, b.z + b.d / 2, 0.15)); // books
      }
    }
    if (idx === 1) {
      const pr = BAKED.printer;
      const px2 = pr.x + pr.w / 2, pz2 = pr.z + pr.d / 2;
      g.add(rbox(pr.w, pr.h * 0.7, pr.d, mat("charcoal", 0.5), px2, b.h, pz2, 0.9));
      g.add(rbox(pr.w * 0.9, pr.h * 0.3, pr.d * 0.8, mat("cushionGray", 0.5), px2, b.h + pr.h * 0.7, pz2 - pr.d * 0.05, 0.6));
      g.add(rbox(pr.w * 0.7, 0.5, 2.5, plastic("white"), px2, b.h + pr.h * 0.35, pz2 + pr.d / 2 + 1, 0.15)); // paper tray
    }
  });
  return g;
}

function plantRack(): THREE.Group {
  const g = new THREE.Group();
  const r = BAKED.plantRack;
  for (const y of [r.h - 1, r.h * 0.5]) g.add(rbox(r.w, 1, r.d, wood(), r.x + r.w / 2, y, r.z + r.d / 2, 0.3));
  for (const [sx, sz] of [[0, 0], [1, 0], [0, 1], [1, 1]] as [number, number][]) {
    g.add(rbox(1, r.h, 1, metal(), r.x + 0.5 + sx * (r.w - 1), 0, r.z + 0.5 + sz * (r.d - 1), 0.2));
  }
  return g;
}

// ---- shell ------------------------------------------------------------------------------------------
function shell(opts: BuildOptions): THREE.Group {
  const g = new THREE.Group();
  const W = ROOM.width, D = ROOM.height, T = SHELL.wallThickness, H = opts.wallHeight, R = SHELL.capRadius;
  const frontZ = SHELL.frontWallZ;
  const wallM = mat("wall", 0.96);
  const m = SHELL.exteriorMargin;
  const ext = rbox(W + 2 * m, 3, D + 2 * m, mat("exterior", 1), W / 2, -3, D / 2, 1);
  ext.castShadow = false;
  g.add(ext);
  const floor = rbox(W - 2 * T + 0.2, 1.2, frontZ - T + 0.2, mat("floor", 0.82), W / 2, -1.2, (T + frontZ) / 2, 0.2);
  floor.castShadow = false;
  g.add(floor);
  g.add(rbox(W, 1.6, D - frontZ - T, mat("wallFace", 1), W / 2, -1.6, frontZ + T + (D - frontZ - T) / 2, 0.3)); // exterior ledge
  // skirting inside the rear and left walls
  g.add(rbox(W - 2 * T, 1.6, 0.8, plastic("white"), W / 2, 0, T + 0.4, 0.2));
  g.add(rbox(0.8, 1.6, frontZ - T, plastic("white"), T + 0.4, 0, (T + frontZ) / 2, 0.2));
  g.add(rbox(W, H, T, wallM, W / 2, 0, T / 2, R));
  g.add(rbox(T, H, frontZ + T, wallM, T / 2, 0, (frontZ + T) / 2, R));
  const gz = SHELL.glass;
  const rx = W - T / 2;
  g.add(rbox(T, H, gz.z0, wallM, rx, 0, gz.z0 / 2, R));
  g.add(rbox(T, H, frontZ + T - gz.z1, wallM, rx, 0, gz.z1 + (frontZ + T - gz.z1) / 2, R));
  const glassH = H - 6;
  g.add(rbox(T, 3, gz.z1 - gz.z0, plastic("white"), rx, 0, (gz.z0 + gz.z1) / 2, 0.6));
  g.add(rbox(T, 3, gz.z1 - gz.z0, plastic("white"), rx, glassH + 3, (gz.z0 + gz.z1) / 2, 0.6));
  const postZs = new Set([gz.z0, gz.doorZ1, gz.z1]);
  for (let z = gz.doorZ1 + gz.postEvery; z < gz.z1 - 4; z += gz.postEvery) postZs.add(z);
  for (const z of postZs) g.add(rbox(T, glassH, 2, plastic("white"), rx, 3, z, 0.4));
  g.add(rbox(T * 0.6, 1.4, gz.z1 - gz.z0, plastic("white"), rx, 3 + glassH * 0.55, (gz.z0 + gz.z1) / 2, 0.4));
  const doorPane = new THREE.Mesh(new THREE.PlaneGeometry(gz.doorZ1 - gz.z0 - 2, glassH - 1), glassMat());
  doorPane.rotation.y = Math.PI / 2;
  doorPane.position.set(rx, 3 + glassH / 2, (gz.z0 + gz.doorZ1) / 2);
  g.add(shadowed(doorPane, false, false));
  g.add(rbox(1, 8, 1.2, metal(), rx - T / 2 - 0.6, 24, gz.doorZ1 - 6, 0.3));
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(gz.z1 - gz.doorZ1 - 2, glassH - 1), glassMat());
  pane.rotation.y = Math.PI / 2;
  pane.position.set(rx, 3 + glassH / 2, (gz.doorZ1 + gz.z1) / 2);
  g.add(shadowed(pane, false, false));
  if (opts.frontWall !== "hidden") {
    const fh = opts.frontWall === "full" ? H : SHELL.frontWallHeight;
    g.add(rbox(W, fh, T, wallM, W / 2, 0, frontZ + T / 2, R));
  }
  return g;
}

// ---- whole room -----------------------------------------------------------------------------------------
export type PlantStats = { animated: Record<PlantTier, number>; succulents: number; swayNodes: number };
/** index of the large plant by the glass wall (group name `plant-${HERO_PLANT_INDEX}`) */
export const HERO_PLANT_INDEX = BAKED.plants.length - 1;

export function buildRoom(opts: BuildOptions = DEFAULT_BUILD_OPTIONS): THREE.Group {
  resetSeed();
  const sway: SwayNode[] = [];
  const root = new THREE.Group();
  root.name = "design-room-3d";
  root.add(shell(opts));
  root.add(rearCabinet(), whiteboard(), leftBoards(), bottomCabinets(), plantRack());
  const animated: Record<PlantTier, number> = { large: 0, medium: 0, hanging: 0, small: 0 };
  BAKED.plants.forEach((p, i) => {
    const g = plantFor(p, sway);
    g.name = `plant-${i}`; // stable dev id (plant-10 = the hero plant by the glass wall)
    root.add(g);
    animated[tierFor(p)]++;
  });
  const ordered = [...FURNITURE].sort((a, b) => (a.kind === "rug" ? -1 : b.kind === "rug" ? 1 : 0));
  for (const item of ordered) {
    const g = buildFurniture(item);
    g.name = item.id; // manifest id, so dev interactions can find a specific piece (getObjectByName)
    root.add(g);
  }
  const succ = finalizeSucculents(root);
  root.userData.sway = sway;
  root.userData.plantStats = { animated, succulents: succ.plants, swayNodes: sway.length } satisfies PlantStats;
  return root;
}

export function plantStatsOf(root: THREE.Object3D): PlantStats | undefined {
  return root.userData.plantStats as PlantStats | undefined;
}

export function swayNodesOf(root: THREE.Object3D): SwayNode[] {
  return (root.userData.sway as SwayNode[] | undefined) ?? [];
}

export function countMeshes(o: THREE.Object3D): { meshes: number; triangles: number; materials: number } {
  let meshes = 0, triangles = 0;
  const mats = new Set<string>();
  o.traverse((c) => {
    const mesh = c as THREE.Mesh;
    if (mesh.isMesh) {
      meshes++;
      const geo = mesh.geometry;
      const idx = geo.getIndex();
      triangles += idx ? idx.count / 3 : geo.getAttribute("position").count / 3;
      mats.add((mesh.material as THREE.Material).uuid);
    }
  });
  return { meshes, triangles: Math.round(triangles), materials: mats.size };
}
