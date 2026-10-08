// vo3d avatar — THE CONSTRUCTION CREW. Five workers built on Bon's rigged body, dressed and set to work on a
// world/construction site. Reusable: give it any ConstructionSite and member i takes work spot i.
//
// ONE BODY, FIVE PEOPLE, NO NEW ASSETS. Each worker is a SkeletonUtils clone of the shared Bon prototype
// (avatar/CastPrototypes — one parse for every body, LOD2) — the PLAYABLE Bon is never touched: the clone
// gets its own skeleton, mixer and material instances. On top of it each wears WORKWEAR built at runtime:
// hard hat, hi-vis vest with reflective bands, work trousers, boots, gloves, and a tool or accessory. The
// workwear is ONE skinned mesh per worker whose every vertex copies the skin weights of the nearest body
// vertex (a proximity weight transfer), so it bends with the knees, elbows and spine exactly like the skin
// under it — one extra draw per worker, any rig, no authoring.
//
// WORK IS A PURE FUNCTION OF THE WALL CLOCK, like world/traffic: every client sees the same worker at the
// same point in the same swing. The motions are the rig's own clips (idle, walking) plus a small post-mixer
// layer of world-axis arm/head rotations (hammering, drilling, holding a tablet, shouldering a load).
//
// COST, and its gate: each body is LOD2 (~40.6k triangles) plus ~1.5k of workwear, two draws, one skinning
// pass. The whole crew is hidden — and its mixers not advanced — whenever the camera is more than
// CREW_SHOW_RANGE from the site or the exterior is not drawn at all.
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { prototypeFor, type CastPrototype } from "./CastPrototypes";
import { CLIP_IDLE, CLIP_WALK } from "../adapters/v1Avatar";
import { CREW, type ConstructionSite, type CrewActivity, type CrewLook } from "../world/construction";
import { Part, lin } from "../build/exteriorGeo";

/** beyond this distance (camera to site centre) the crew is not drawn or animated */
export const CREW_SHOW_RANGE = 1250;
/** an NPC's calm walking pace (the player walks at 70) */
const CREW_WALK_SPEED = 38;
/** the walking clip is authored for the player's pace; slow it to match, or the feet skate */
const WALK_TIME_SCALE = CREW_WALK_SPEED / 70;

// ---- measuring the base body in its bind space ---------------------------------------------------------
type BodyMeasure = {
  body: THREE.SkinnedMesh;
  /** every body vertex in bind (scene) space, with its four skin indices and weights */
  pos: Float32Array;
  idx: ArrayLike<number>;
  wgt: ArrayLike<number>;
  /** the dominant bone's name per vertex */
  dom: string[];
  /** +1 when the character faces +z in bind space, −1 for −z */
  fwd: number;
  /** +1 when the character's RIGHT side is +x in bind space */
  right: number;
  height: number;
  minY: number;
  grid: Map<string, number[]>;
  cell: number;
};
const measures = new WeakMap<CastPrototype, BodyMeasure>();

function measure(proto: CastPrototype): BodyMeasure {
  const cached = measures.get(proto);
  if (cached) return cached;
  let body: THREE.SkinnedMesh | null = null;
  proto.scene.traverse((o) => { if (!body && (o as THREE.SkinnedMesh).isSkinnedMesh) body = o as THREE.SkinnedMesh; });
  if (!body) throw new Error("ConstructionCrew: the base character has no skinned mesh");
  const b = body as THREE.SkinnedMesh;
  const g = b.geometry;
  const P = g.getAttribute("position"), SI = g.getAttribute("skinIndex"), SW = g.getAttribute("skinWeight");
  const n = P.count, pos = new Float32Array(n * 3), dom: string[] = new Array(n);
  const v = new THREE.Vector3();
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(P, i).applyMatrix4(b.bindMatrix);
    pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
    minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    let best = 0, bw = -1;
    for (let k = 0; k < 4; k++) { const w = SW.getComponent(i, k); if (w > bw) { bw = w; best = SI.getComponent(i, k); } }
    dom[i] = b.skeleton.bones[best]?.name ?? "";
  }
  const idx = new Uint16Array(n * 4), wgt = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) { idx[i * 4 + k] = SI.getComponent(i, k); wgt[i * 4 + k] = SW.getComponent(i, k); }
  const height = maxY - minY;
  // FACING: the toes lie forward of the ankles
  const bonePos = (name: string) => {
    const i = b.skeleton.bones.findIndex((x) => x.name === name);
    return i < 0 ? null : new THREE.Vector3().setFromMatrixPosition(b.skeleton.boneInverses[i].clone().invert());
  };
  const foot = bonePos("LeftFoot"), toe = bonePos("LeftToeBase"), rArm = bonePos("RightArm"), lArm = bonePos("LeftArm");
  const fwd = foot && toe ? Math.sign(toe.z - foot.z) || 1 : 1;
  const right = rArm && lArm ? Math.sign(rArm.x - lArm.x) || -1 : -1;
  // a coarse grid for nearest-vertex lookups
  const cell = height / 24, grid = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const key = `${Math.floor(pos[i * 3] / cell)},${Math.floor(pos[i * 3 + 1] / cell)},${Math.floor(pos[i * 3 + 2] / cell)}`;
    let l = grid.get(key);
    if (!l) grid.set(key, (l = []));
    l.push(i);
  }
  const m: BodyMeasure = { body: b, pos, idx, wgt, dom, fwd, right, height, minY, grid, cell };
  measures.set(proto, m);
  return m;
}

/** a sphere in the body MESH's own space that holds every pose the crew strikes */
function bindSphere(M: BodyMeasure): THREE.Sphere {
  const g = M.body.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  const s = g.boundingBox!.getBoundingSphere(new THREE.Sphere());
  s.radius *= 1.6;
  return s;
}

/** KEEP THE BODY INSIDE ITS WORKWEAR. On this worker's OWN copy of the body material (never the shared
 *  prototype's, never the playable Bon's), each vertex is taken into bind space before skinning and:
 *    · hair above the hard hat's brim that would poke through the dome is drawn inside it
 *    · the shoe is drawn inside its boot shell (the white sole no longer shows below the boot)
 *    · the torso under the vest is drawn in a little, so the shirt never pierces it at the shoulders
 *  Then it goes back to mesh space and is skinned exactly as before. A handful of ALU per vertex. */
function contain(mat: THREE.MeshStandardMaterial, body: THREE.SkinnedMesh, c: Contain): THREE.MeshStandardMaterial {
  const f = (i: number) => c.feet[i] ?? { c: new THREE.Vector3(0, -1e6, 0), r: new THREE.Vector3(1, 1, 1) };
  const uniforms = {
    uCBind: { value: body.bindMatrix.clone() },
    uCBindInv: { value: body.bindMatrix.clone().invert() },
    uHat: { value: new THREE.Vector4(c.hat.c.x, c.hat.c.y, c.hat.c.z, c.hat.r) },
    uHatSy: { value: c.hat.sy }, uHatBase: { value: c.hat.base },
    uFootC0: { value: f(0).c }, uFootR0: { value: f(0).r }, uFootC1: { value: f(1).c }, uFootR1: { value: f(1).r },
    uTorso: { value: new THREE.Vector4(c.torso.y0, c.torso.y1, c.torso.cx, c.torso.cz) }, uTorsoHx: { value: c.torso.hx }, uTorsoK: { value: c.torso.k },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `uniform mat4 uCBind; uniform mat4 uCBindInv; uniform vec4 uHat; uniform float uHatSy; uniform float uHatBase;
      uniform vec3 uFootC0; uniform vec3 uFootR0; uniform vec3 uFootC1; uniform vec3 uFootR1; uniform vec4 uTorso; uniform float uTorsoHx; uniform float uTorsoK;
      vec3 crewFoot(vec3 p, vec3 c, vec3 r) {
        vec3 d = (p - c) / r;
        // the shoe only: near this foot, from the ground to three-quarters of the boot's height
        if (d.y > 0.75 || length(d.xz) > 1.6) return p;
        // drawn in HORIZONTALLY to the shell's own radius at this height, with a little room to spare
        float t = clamp(d.y, 0.0, 0.75), rh = sqrt(max(0.0, 0.8 - t * t)) * 0.97, L = length(d.xz);
        if (L > rh) d.xz *= rh / L;
        return c + d * r;
      }
      ${shader.vertexShader}`.replace("#include <begin_vertex>", `#include <begin_vertex>
      {
        vec3 bp = (uCBind * vec4(transformed, 1.0)).xyz;
        if (bp.y > uHatBase) {
          vec3 d = bp - uHat.xyz; d.y /= uHatSy;
          float L = length(d), lim = uHat.w * 0.93;
          if (L > lim) { d *= lim / L; d.y *= uHatSy; bp = uHat.xyz + d; }
        }
        bp = crewFoot(bp, uFootC0, uFootR0);
        bp = crewFoot(bp, uFootC1, uFootR1);
        if (bp.y > uTorso.x && bp.y < uTorso.y && abs(bp.x - uTorso.z) < uTorsoHx) {
          bp.xz = uTorso.zw + (bp.xz - uTorso.zw) * uTorsoK;
        }
        transformed = (uCBindInv * vec4(bp, 1.0)).xyz;
      }`);
  };
  mat.customProgramCacheKey = () => "crew-contain";
  return mat;
}

function nearest(M: BodyMeasure, x: number, y: number, z: number, only?: (bone: string) => boolean): number {
  const cx = Math.floor(x / M.cell), cy = Math.floor(y / M.cell), cz = Math.floor(z / M.cell);
  let best = -1, bd = Infinity;
  for (let r = 0; r < 6 && best < 0; r++) {
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) {
      if (Math.max(Math.abs(i), Math.abs(j), Math.abs(k)) !== r) continue;
      const l = M.grid.get(`${cx + i},${cy + j},${cz + k}`);
      if (!l) continue;
      for (const q of l) {
        if (only && !only(M.dom[q])) continue;
        const dx = M.pos[q * 3] - x, dy = M.pos[q * 3 + 1] - y, dz = M.pos[q * 3 + 2] - z, d = dx * dx + dy * dy + dz * dz;
        if (d < bd) { bd = d; best = q; }
      }
    }
  }
  return best < 0 ? 0 : best;
}

/** the extents of the body's vertices owned by `bones` within a height band */
function band(M: BodyMeasure, bones: (n: string) => boolean, y0: number, y1: number, side = 0): { cx: number; cz: number; rx: number; rz: number; n: number } {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, n = 0;
  for (let i = 0; i < M.dom.length; i++) {
    const y = M.pos[i * 3 + 1];
    if (y < y0 || y > y1 || !bones(M.dom[i])) continue;
    const x = M.pos[i * 3];
    if (side && Math.sign(x) !== side) continue;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    const z = M.pos[i * 3 + 2];
    z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    n++;
  }
  return n ? { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, rx: (x1 - x0) / 2, rz: (z1 - z0) / 2, n } : { cx: 0, cz: 0, rx: 0, rz: 0, n: 0 };
}
function bbox(M: BodyMeasure, bones: (n: string) => boolean): THREE.Box3 {
  const b = new THREE.Box3();
  for (let i = 0; i < M.dom.length; i++) if (bones(M.dom[i])) b.expandByPoint(new THREE.Vector3(M.pos[i * 3], M.pos[i * 3 + 1], M.pos[i * 3 + 2]));
  return b;
}

// ---- the workwear --------------------------------------------------------------------------------------
const TORSO = (n: string) => n === "Spine" || n === "Spine01" || n === "Spine02" || n === "Hips" || n === "LeftShoulder" || n === "RightShoulder";
const HEAD = (n: string) => n === "Head" || n === "head_end" || n === "headfront" || n === "neck";
const legOf = (side: "Left" | "Right") => (n: string) => n === `${side}UpLeg` || n === `${side}Leg`;
const footOf = (side: "Left" | "Right") => (n: string) => n === `${side}Foot` || n === `${side}ToeBase`;
const handOf = (side: "Left" | "Right") => (n: string) => n === `${side}Hand`;

/** an elliptical tube through rings of (y, cx, cz, rx, rz), open at both ends */
function ringTube(P: Part, rings: { y: number; cx: number; cz: number; rx: number; rz: number; col: THREE.Color }[], seg: number): void {
  const ids = rings.map((r) => Array.from({ length: seg }, (_, k) => {
    const a = (k / seg) * Math.PI * 2;
    return P.v(r.cx + Math.cos(a) * r.rx, r.y, r.cz + Math.sin(a) * r.rz, r.col);
  }));
  // outward-facing whichever way the rings were listed (the vest is built upward, the trousers downward)
  const upward = rings[rings.length - 1].y > rings[0].y;
  for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < seg; k++) {
    const k2 = (k + 1) % seg;
    if (upward) P.quad(ids[i][k], ids[i + 1][k], ids[i + 1][k2], ids[i][k2]);
    else P.quad(ids[i][k], ids[i][k2], ids[i + 1][k2], ids[i + 1][k]);
  }
}
/** a closed box (as a Part) from its centre and half sizes, coloured `col` */
function partBox(P: Part, c: THREE.Vector3, h: THREE.Vector3, col: THREE.Color): void {
  const v: number[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) v.push(P.v(c.x + sx * h.x, c.y + sy * h.y, c.z + sz * h.z, col));
  // index = (sx>0)*4 + (sy>0)*2 + (sz>0)
  const f = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
  for (const [a, b, c2, d] of f) P.quad(v[a], v[b], v[c2], v[d]);
}
/** a closed ellipsoid (as a Part): a glove round a mitten hand reads as a hand, a box round it as a board */
function ellipsoid(P: Part, c: THREE.Vector3, r: THREE.Vector3, col: THREE.Color): void {
  const seg = 8, rings = 5, ids: number[][] = [];
  for (let i = 0; i <= rings; i++) {
    const t = (i / rings) * Math.PI;
    ids.push(Array.from({ length: seg }, (_, k) => {
      const a = (k / seg) * Math.PI * 2;
      return P.v(c.x + Math.sin(t) * Math.cos(a) * r.x, c.y + Math.cos(t) * r.y, c.z + Math.sin(t) * Math.sin(a) * r.z, col);
    }));
  }
  // the rings run top → bottom, so this winding is the outward one (ringTube's downward case)
  for (let i = 0; i < rings; i++) for (let k = 0; k < seg; k++) P.quad(ids[i][k], ids[i][(k + 1) % seg], ids[i + 1][(k + 1) % seg], ids[i + 1][k]);
}

/** a tapered cylinder (as a Part) from a to b, radii ra → rb */
function partCyl(P: Part, a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, col: THREE.Color, seg = 6): void {
  const axis = b.clone().sub(a).normalize();
  const n = Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0).cross(axis).normalize() : new THREE.Vector3(1, 0, 0).cross(axis).normalize();
  const m = axis.clone().cross(n).normalize();
  const ring = (c: THREE.Vector3, r: number) => Array.from({ length: seg }, (_, k) => {
    const t = (k / seg) * Math.PI * 2;
    const p = c.clone().addScaledVector(n, Math.cos(t) * r).addScaledVector(m, Math.sin(t) * r);
    return P.v(p.x, p.y, p.z, col);
  });
  const A = ring(a, ra), B = ring(b, rb), ca = P.v(a.x, a.y, a.z, col), cb = P.v(b.x, b.y, b.z, col);
  for (let k = 0; k < seg; k++) {
    const k2 = (k + 1) % seg;
    P.quad(A[k], A[k2], B[k2], B[k]);
    P.tri(ca, A[k2], A[k]);
    P.tri(cb, B[k], B[k2]);
  }
}

/** a dome (the hard hat): a squashed half-sphere over `c` plus its brim */
function hat(P: Part, c: THREE.Vector3, r: number, fwd: number, col: THREE.Color): void {
  const seg = 12, rings = 4, H = 0.86;
  const top = P.v(c.x, c.y + r * H, c.z, col.clone().multiplyScalar(1.08));
  const ring: number[][] = [];
  for (let i = 1; i <= rings; i++) {
    const t = (i / rings) * (Math.PI / 2);
    ring.push(Array.from({ length: seg }, (_, k) => {
      const a = (k / seg) * Math.PI * 2;
      return P.v(c.x + Math.cos(a) * Math.sin(t) * r, c.y + Math.cos(t) * r * H, c.z + Math.sin(a) * Math.sin(t) * r, col);
    }));
  }
  for (let k = 0; k < seg; k++) P.tri(top, ring[0][(k + 1) % seg], ring[0][k]);
  for (let i = 0; i < rings - 1; i++) for (let k = 0; k < seg; k++) P.quad(ring[i][k], ring[i][(k + 1) % seg], ring[i + 1][(k + 1) % seg], ring[i + 1][k]);
  // the brim, wider at the front (the peak)
  const brim = Array.from({ length: seg }, (_, k) => {
    const a = (k / seg) * Math.PI * 2;
    const peak = 1 + 0.22 * Math.max(0, Math.sin(a) * fwd);
    return P.v(c.x + Math.cos(a) * r * 1.07 * peak, c.y - r * 0.04, c.z + Math.sin(a) * r * 1.07 * peak, col.clone().multiplyScalar(0.9));
  });
  for (let k = 0; k < seg; k++) {
    const k2 = (k + 1) % seg;
    P.quad(ring[rings - 1][k], ring[rings - 1][k2], brim[k2], brim[k]);
    P.quad(brim[k], brim[k2], ring[rings - 1][k2], ring[rings - 1][k]); // underside
  }
  // the ridge along the crown
  partBox(P, new THREE.Vector3(c.x, c.y + r * (H - 0.04), c.z), new THREE.Vector3(r * 0.06, r * 0.06, r * 0.62), col.clone().multiplyScalar(1.12));
}

/** a flat-bottomed half-ellipsoid shell (a boot): radii rx/rz across, height h, standing on `base` */
function shell(P: Part, base: THREE.Vector3, rx: number, h: number, rz: number, col: THREE.Color, welt: THREE.Color): void {
  const seg = 10, rings = 4;
  const ring = (t: number, c: THREE.Color) => Array.from({ length: seg }, (_, k) => {
    const a = (k / seg) * Math.PI * 2;
    return P.v(base.x + Math.cos(a) * rx * Math.cos(t), base.y + Math.sin(t) * h, base.z + Math.sin(a) * rz * Math.cos(t), c);
  });
  const rs = [ring(0, welt), ring(0.12, welt)];
  for (let i = 1; i <= rings; i++) rs.push(ring(0.12 + (i / rings) * (Math.PI / 2 - 0.3), col));
  const top = P.v(base.x, base.y + h, base.z, col);
  // outward-facing (the same winding as ringTube's upward case and the hat's crown)
  for (let i = 0; i < rs.length - 1; i++) for (let k = 0; k < seg; k++) P.quad(rs[i][k], rs[i + 1][k], rs[i + 1][(k + 1) % seg], rs[i][(k + 1) % seg]);
  const last = rs[rs.length - 1];
  for (let k = 0; k < seg; k++) P.tri(top, last[(k + 1) % seg], last[k]);
}

/** WHAT THE WORKWEAR MUST HIDE, in the base body's bind space: the hard hat's dome, each boot's shell and the
 *  vest's torso band. The worker's own body material pulls its vertices inside these (see contain()). */
type Contain = {
  hat: { c: THREE.Vector3; r: number; sy: number; base: number };
  feet: { c: THREE.Vector3; r: THREE.Vector3 }[];
  torso: { y0: number; y1: number; cx: number; cz: number; hx: number; k: number };
};
type Wear = { geo: THREE.BufferGeometry; carried: THREE.BufferGeometry | null; contain: Contain };

/** BUILD ONE WORKER'S WORKWEAR in the base body's bind space, then give every vertex the skin weights of
 *  the nearest body vertex (restricted to the part it dresses, so a sleeve never inherits a hip). */
function workwear(M: BodyMeasure, look: CrewLook): Wear {
  const H = M.height, fwd = M.fwd, R = M.right;
  const P = new Part();
  const owners: ((n: string) => boolean)[] = []; // per vertex: which bones it may take weights from
  const mark = (from: number, who: (n: string) => boolean) => { while (owners.length < P.p.length / 3) owners.push(who); void from; };

  // HARD HAT — over the top 40% of the head
  const head = bbox(M, HEAD);
  const headTop = head.max.y, headH = head.max.y - head.min.y;
  const hb = band(M, HEAD, headTop - headH * 0.45, headTop);
  // sized to the head's crown (the hair's core), set high enough that the spikes stay under the shell
  const hr = Math.max(hb.rx, hb.rz) * 0.96;
  const hatC = new THREE.Vector3(hb.cx, headTop - headH * 0.27, hb.cz);
  hat(P, hatC, hr, fwd, lin(look.hat));
  const feetContain: Contain["feet"] = [];
  mark(0, HEAD);
  if (look.extras.includes("earmuffs")) {
    for (const s of [-1, 1]) partBox(P, new THREE.Vector3(hb.cx + s * hb.rx * 1.02, headTop - headH * 0.52, hb.cz), new THREE.Vector3(hr * 0.16, hr * 0.26, hr * 0.26), lin(0xd23b2f));
    mark(0, HEAD);
  }
  if (look.extras.includes("glasses")) {
    partBox(P, new THREE.Vector3(hb.cx, headTop - headH * 0.55, hb.cz + fwd * hb.rz * 1.02), new THREE.Vector3(hb.rx * 0.62, headH * 0.05, hr * 0.04), lin(0x2a2d33));
    mark(0, HEAD);
  }

  // HI-VIS VEST — rings measured off the torso from the waist to the shoulders
  const torso = bbox(M, TORSO);
  // the hem sits low enough to overlap the trousers' waistband — no shirt between them
  const tY0 = torso.min.y + (torso.max.y - torso.min.y) * 0.15, tY1 = torso.max.y - (torso.max.y - torso.min.y) * 0.06;
  const vest = lin(look.vest), bandC = lin(look.band);
  const vr: { y: number; cx: number; cz: number; rx: number; rz: number; col: THREE.Color }[] = [];
  for (let i = 0; i <= 6; i++) {
    const y = tY0 + ((tY1 - tY0) * i) / 6;
    const b = band(M, TORSO, y - H * 0.02, y + H * 0.02);
    if (!b.n) continue;
    const shoulder = i === 6 ? 0.82 : 1;
    const isBand = i === 1 || i === 3;
    // loose enough that the shirt under it never shows through, as a vest worn over clothes does
    vr.push({ y, cx: b.cx, cz: b.cz, rx: (b.rx * 1.2 + H * 0.016) * shoulder, rz: b.rz * 1.38 + H * 0.02, col: isBand ? bandC : vest });
  }
  // THE YOKE: the vest closes over the shoulder tops to the neck, so no shirt shows above it
  if (vr.length) {
    const t = vr[vr.length - 1];
    vr.push({ ...t, y: torso.max.y + H * 0.01, rx: t.rx * 0.7, rz: t.rz * 0.82 });
  }
  if (vr.length >= 2) {
    ringTube(P, vr, 14);
    mark(0, TORSO);
  }
  if (look.extras.includes("toolbelt") && vr.length) {
    const w = vr[0];
    ringTube(P, [{ ...w, y: w.y - H * 0.012, rx: w.rx * 1.04, rz: w.rz * 1.06, col: lin(0x5a3a22) }, { ...w, y: w.y + H * 0.012, rx: w.rx * 1.04, rz: w.rz * 1.06, col: lin(0x5a3a22) }], 14);
    for (const s of [-1, 1]) partBox(P, new THREE.Vector3(w.cx + s * w.rx * 0.95, w.y - H * 0.02, w.cz + fwd * w.rz * 0.3), new THREE.Vector3(w.rx * 0.16, H * 0.025, w.rz * 0.3), lin(0x6b4a2c));
    mark(0, TORSO);
  }
  if (look.extras.includes("backpack") && vr.length > 3) {
    const r = vr[4] ?? vr[vr.length - 1];
    partBox(P, new THREE.Vector3(r.cx, r.y - H * 0.03, r.cz - fwd * r.rz * 1.15), new THREE.Vector3(r.rx * 0.6, H * 0.07, r.rz * 0.3), lin(0x34404d));
    mark(0, TORSO);
  }

  // WORK TROUSERS — a seat round the hips, then each leg from the crotch to the ankle
  const trous = lin(look.trousers), trousDark = lin(look.trousers).multiplyScalar(0.8);
  const legs = (["Left", "Right"] as const).map((side) => bbox(M, legOf(side)));
  const crotch = Math.max(legs[0].max.y, legs[1].max.y) - (Math.max(legs[0].max.y, legs[1].max.y) - Math.min(legs[0].min.y, legs[1].min.y)) * 0.12;
  {
    const top = tY0 + H * 0.035, rings = [];
    for (let i = 0; i <= 2; i++) {
      const y = top + (crotch - top) * (i / 2);
      const b = band(M, (n) => TORSO(n) || n.includes("UpLeg"), y - H * 0.02, y + H * 0.02);
      if (b.n) rings.push({ y, cx: b.cx, cz: b.cz, rx: b.rx * 1.14 + H * 0.008, rz: b.rz * 1.2 + H * 0.008, col: trous });
    }
    if (rings.length >= 2) { ringTube(P, rings, 14); mark(0, (n) => TORSO(n) || n.includes("UpLeg")); }
  }
  for (const side of ["Left", "Right"] as const) {
    const lb = legs[side === "Left" ? 0 : 1];
    const sx = Math.sign((lb.min.x + lb.max.x) / 2) || (side === "Right" ? R : -R);
    const foot = bbox(M, footOf(side));
    const ankle = foot.max.y + H * 0.005;
    const rings = [];
    for (let i = 0; i <= 7; i++) {
      const y = crotch + (ankle - crotch) * (i / 7);
      const b = band(M, legOf(side), y - H * 0.015, y + H * 0.015, sx);
      if (b.n) rings.push({ y, cx: b.cx, cz: b.cz, rx: b.rx * 1.26 + H * 0.011, rz: b.rz * 1.26 + H * 0.011, col: i === 7 ? trousDark : trous });
    }
    if (rings.length >= 2) { ringTube(P, rings, 10); mark(0, legOf(side)); }
    // BOOTS — the foot's box, a little proud of it, with a darker sole
    const fc = foot.getCenter(new THREE.Vector3()), fs = foot.getSize(new THREE.Vector3());
    // ROUNDED, not boxed: the chibi's shoes are wide and nearly touch, so two boxes read as one plinth.
    // A shell just outside each shoe, flat-bottomed on the ground, with a darker welt round its foot.
    shell(P, new THREE.Vector3(fc.x, foot.min.y, fc.z), fs.x * 0.53, fs.y * 1.02, fs.z * 0.53, lin(look.boots), lin(0x1e1c1a));
    feetContain.push({ c: new THREE.Vector3(fc.x, foot.min.y, fc.z), r: new THREE.Vector3(fs.x * 0.53, fs.y * 1.02, fs.z * 0.53) });
    mark(0, footOf(side));
    // GLOVES
    const hand = bbox(M, handOf(side)), hc = hand.getCenter(new THREE.Vector3()), hs = hand.getSize(new THREE.Vector3());
    // fitted, not boxed round: a glove is the hand a size up, in leather or in the labourer's yellow rigger
    ellipsoid(P, hc, hs.clone().multiplyScalar(0.6), lin(look.tool === "gloves" ? 0xd9b24a : 0x6b5a48));
    mark(0, handOf(side));
  }

  // THE TOOL, in the hand that uses it
  const rightHand = handOf("Right"), leftHand = handOf("Left");
  const rh = bbox(M, rightHand), lh = bbox(M, leftHand);
  const rc = rh.getCenter(new THREE.Vector3()), lc = lh.getCenter(new THREE.Vector3());
  const u = H * 0.02; // a tool-sized unit
  if (look.tool === "hammer") {
    // a claw hammer: tapered hickory handle with a dark grip, a steel head — striking face one side, claw the other
    partCyl(P, new THREE.Vector3(rc.x, rc.y, rc.z + fwd * u * 0.4), new THREE.Vector3(rc.x, rc.y, rc.z + fwd * u * 5.2), u * 0.32, u * 0.24, lin(0xb88a52), 6);
    partCyl(P, new THREE.Vector3(rc.x, rc.y, rc.z - fwd * u * 0.3), new THREE.Vector3(rc.x, rc.y, rc.z + fwd * u * 1.6), u * 0.4, u * 0.36, lin(0x2b2d31), 6);
    partCyl(P, new THREE.Vector3(rc.x, rc.y - u * 0.2, rc.z + fwd * u * 5.6), new THREE.Vector3(rc.x, rc.y + u * 1.5, rc.z + fwd * u * 5.6), u * 0.42, u * 0.38, lin(0x4a4f57), 6);
    partBox(P, new THREE.Vector3(rc.x, rc.y - u * 0.8, rc.z + fwd * u * 5.9), new THREE.Vector3(u * 0.22, u * 0.7, u * 0.18), lin(0x4a4f57));
    mark(0, rightHand);
  } else if (look.tool === "drill") {
    // a cordless drill: motor barrel along the aim, chuck and bit, a raked grip down into the hand, the battery under it
    const top = rc.y + u * 1.9;
    partCyl(P, new THREE.Vector3(rc.x, top, rc.z - fwd * u * 1.2), new THREE.Vector3(rc.x, top, rc.z + fwd * u * 2.6), u * 0.95, u * 0.82, lin(0xe0b32c), 8);
    partCyl(P, new THREE.Vector3(rc.x, top, rc.z + fwd * u * 2.6), new THREE.Vector3(rc.x, top, rc.z + fwd * u * 3.6), u * 0.5, u * 0.42, lin(0x2b2d31), 8);
    partCyl(P, new THREE.Vector3(rc.x, top, rc.z + fwd * u * 3.6), new THREE.Vector3(rc.x, top, rc.z + fwd * u * 5.6), u * 0.12, u * 0.08, lin(0xb8bec4), 4);
    partCyl(P, new THREE.Vector3(rc.x, top - u * 0.4, rc.z), new THREE.Vector3(rc.x, rc.y - u * 0.6, rc.z - fwd * u * 0.5), u * 0.45, u * 0.5, lin(0x2b2d31), 6);
    partBox(P, new THREE.Vector3(rc.x, rc.y - u * 1.1, rc.z - fwd * u * 0.5), new THREE.Vector3(u * 0.75, u * 0.45, u * 1.1), lin(0x3a3e45));
    mark(0, rightHand);
  } else if (look.tool === "tablet") {
    // a rugged tablet: rubber bumper frame round a lit screen
    const tc = new THREE.Vector3(lc.x, lc.y + u * 0.6, lc.z + fwd * u * 1.2);
    partBox(P, tc, new THREE.Vector3(u * 2.3, u * 0.28, u * 3.1), lin(0xe0b32c));
    partBox(P, tc.clone().add(new THREE.Vector3(0, u * 0.06, 0)), new THREE.Vector3(u * 1.95, u * 0.26, u * 2.7), lin(0x1d2a33));
    partBox(P, tc.clone().add(new THREE.Vector3(0, u * 0.1, 0)), new THREE.Vector3(u * 1.75, u * 0.24, u * 2.45), lin(0x5aa9d6));
    mark(0, leftHand);
  }

  // weights: the nearest body vertex among the owners of each piece
  const n = P.p.length / 3;
  while (owners.length < n) owners.push(() => true);
  const geo = skinnedFrom(P, M, owners);

  // THE CARRIED LOAD (plank for the hauler, a cement bag for the labourer): its own little mesh, shown only
  // while it is being carried, riding the chest/shoulder
  let carried: THREE.BufferGeometry | null = null;
  if (look.tool === "plank" || look.tool === "gloves") {
    const C = new Part();
    const sh = band(M, TORSO, torso.max.y - H * 0.04, torso.max.y);
    const sideX = sh.cx + R * sh.rx * 0.55, topY = torso.max.y + H * 0.01;
    if (look.tool === "plank") partBox(C, new THREE.Vector3(sideX, topY + u * 0.7, sh.cz), new THREE.Vector3(u * 1.4, u * 0.6, u * 16), lin(0xd2ad74));
    else partBox(C, new THREE.Vector3(sideX, topY + u * 1.2, sh.cz), new THREE.Vector3(u * 2.6, u * 1.1, u * 3.6), lin(0xe6dfcd));
    const own = new Array(C.p.length / 3).fill(TORSO);
    carried = skinnedFrom(C, M, own);
  }
  const contain: Contain = {
    hat: { c: hatC, r: hr, sy: 0.86, base: hatC.y - hr * 0.04 },
    feet: feetContain,
    torso: { y0: tY0 - H * 0.02, y1: torso.max.y + H * 0.02, cx: (torso.min.x + torso.max.x) / 2, cz: (torso.min.z + torso.max.z) / 2, hx: (torso.max.x - torso.min.x) / 2 * 1.04, k: 0.9 },
  };
  return { geo, carried, contain };
}

function skinnedFrom(P: Part, M: BodyMeasure, owners: ((n: string) => boolean)[]): THREE.BufferGeometry {
  const n = P.p.length / 3;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const q = nearest(M, P.p[i * 3], P.p[i * 3 + 1], P.p[i * 3 + 2], owners[i]);
    for (let k = 0; k < 4; k++) { si[i * 4 + k] = M.idx[q * 4 + k] as number; sw[i * 4 + k] = M.wgt[q * 4 + k] as number; }
  }
  // positions into the body mesh's own space (the bind space → mesh-local)
  const inv = M.body.bindMatrix.clone().invert(), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.set(P.p[i * 3], P.p[i * 3 + 1], P.p[i * 3 + 2]).applyMatrix4(inv);
    P.p[i * 3] = v.x; P.p[i * 3 + 1] = v.y; P.p[i * 3 + 2] = v.z;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(P.p, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(P.c, 3));
  g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(P.i);
  g.computeVertexNormals();
  return g;
}

// ---- the post-mixer pose layer -----------------------------------------------------------------------
/** WORLD-AXIS BONE ROTATIONS ON TOP OF THE MIXER. A bone's local quaternion is re-based every frame from
 *  whatever the mixer last wrote; three's PropertyMixer skips writing a value that did not change, so the
 *  layer restores that base itself rather than compounding its own rotation (the riderPose gotcha). */
class PoseLayer {
  private readonly base = new Map<THREE.Bone, THREE.Quaternion>();
  private readonly wrote = new Map<THREE.Bone, THREE.Quaternion>();
  private readonly pq = new THREE.Quaternion();
  private readonly rq = new THREE.Quaternion();
  /** take the mixer's output as this frame's base (call right after mixer.update) */
  rebase(bones: THREE.Bone[]): void {
    for (const b of bones) {
      const w = this.wrote.get(b), base = this.base.get(b);
      if (w && base && b.quaternion.equals(w)) b.quaternion.copy(base);
      else this.base.set(b, b.quaternion.clone());
    }
  }
  /** rotate `bone` by `angle` about a WORLD axis, pivoting on the bone */
  rotate(bone: THREE.Bone, axisWorld: THREE.Vector3, angle: number): void {
    if (!angle) return;
    bone.parent!.updateWorldMatrix(true, false);
    bone.parent!.getWorldQuaternion(this.pq);
    this.rq.setFromAxisAngle(axisWorld, angle);
    // local' = parent⁻¹ · R · parent · local
    const inv = this.pq.clone().invert();
    bone.quaternion.premultiply(inv.multiply(this.rq).multiply(this.pq));
  }
  /** remember what was written so the next rebase can tell the mixer's write from ours */
  seal(bones: THREE.Bone[]): void {
    for (const b of bones) {
      const w = this.wrote.get(b);
      if (w) w.copy(b.quaternion);
      else this.wrote.set(b, b.quaternion.clone());
    }
  }
}

// ---- one worker ------------------------------------------------------------------------------------
type Bones = Partial<Record<"rArm" | "rFore" | "lArm" | "lFore" | "head" | "chest", THREE.Bone>>;
class Worker {
  readonly root = new THREE.Group();
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions: Record<string, THREE.AnimationAction> = {};
  private current = "";
  private readonly bones: Bones = {};
  private readonly layered: THREE.Bone[];
  private readonly pose = new PoseLayer();
  private readonly carriedMesh: THREE.SkinnedMesh | null;
  private readonly scene: THREE.Object3D;
  /** +1 when the base body faces +z, and its right is +x — to turn "raise the arm forward" into an axis */
  private readonly fwd: number;
  readonly triangles: number;
  readonly look: CrewLook;
  readonly work: CrewActivity;
  readonly phase: number;

  constructor(proto: CastPrototype, M: BodyMeasure, look: CrewLook, work: CrewActivity, phase: number, wear: Wear, wearMat: THREE.Material) {
    this.look = look; this.work = work; this.phase = phase;
    const body = cloneSkinned(proto.scene) as THREE.Group;
    this.scene = body;
    this.fwd = M.fwd;
    this.root.name = `crew:${look.id}`;
    this.root.add(body);
    this.root.scale.setScalar(look.scale);
    // SKIN/MATERIAL VARIATION: this worker's own copy of the base material, gently tinted — never the shared one
    let skinned: THREE.SkinnedMesh | null = null;
    body.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      skinned ??= m;
      m.castShadow = false; // the shadow map is drawn on demand — a moving caster would leave its shadow behind
      // CULLED LIKE ANY MESH: a skinned body's bounds do not follow its pose, so it is given a generous fixed
      // sphere round its bind pose (the work poses stay well inside it) rather than drawn whatever the view
      m.frustumCulled = true;
      m.boundingSphere = bindSphere(M);
      m.material = (Array.isArray(m.material) ? m.material : [m.material]).map((x) => {
        const c = (x as THREE.MeshStandardMaterial).clone();
        c.color.multiply(new THREE.Color(look.skin));
        return contain(c, m, wear.contain);
      })[0];
    });
    const s = skinned as THREE.SkinnedMesh | null;
    if (!s) throw new Error("ConstructionCrew: clone has no skinned mesh");
    const dress = (geo: THREE.BufferGeometry, name: string): THREE.SkinnedMesh => {
      const w = new THREE.SkinnedMesh(geo, wearMat);
      w.name = name;
      w.bindMode = s.bindMode;
      s.parent!.add(w);
      w.position.copy(s.position); w.quaternion.copy(s.quaternion); w.scale.copy(s.scale);
      w.bind(s.skeleton, s.bindMatrix);
      w.frustumCulled = true;
      w.boundingSphere = bindSphere(M);
      w.castShadow = false;
      w.receiveShadow = true;
      return w;
    };
    dress(wear.geo, `crew-wear:${look.id}`);
    this.carriedMesh = wear.carried ? dress(wear.carried, `crew-load:${look.id}`) : null;
    this.triangles = proto.triangles + Math.round((wear.geo.index?.count ?? 0) / 3 + (wear.carried?.index?.count ?? 0) / 3);

    const byName = (n: string) => (body.getObjectByName(n) as THREE.Bone | undefined);
    this.bones = { rArm: byName("RightArm"), rFore: byName("RightForeArm"), lArm: byName("LeftArm"), lFore: byName("LeftForeArm"), head: byName("Head"), chest: byName("Spine") };
    this.layered = Object.values(this.bones).filter((b): b is THREE.Bone => !!b);
    this.mixer = new THREE.AnimationMixer(body);
    for (const clip of proto.clips) this.actions[clip.name] = this.mixer.clipAction(clip);
    this.play(CLIP_IDLE, 0);
    const idle = this.actions[CLIP_IDLE];
    if (idle) idle.time = phase * (idle.getClip().duration || 1);
  }

  private play(name: string, fade = 0.3, timeScale = 1): void {
    const next = this.actions[name];
    if (!next) return;
    next.timeScale = timeScale;
    if (this.current === name) return;
    const prev = this.actions[this.current];
    next.reset().setEffectiveWeight(1).play();
    if (prev && fade > 0) prev.crossFadeTo(next, fade, false);
    else if (prev) prev.stop();
    this.current = name;
  }

  /** the body's world-space "raise forward" axis (rotating a hanging arm toward the face) and its up */
  private axes(): { lift: THREE.Vector3; up: THREE.Vector3 } {
    const q = this.scene.getWorldQuaternion(new THREE.Quaternion());
    return { lift: new THREE.Vector3(-this.fwd, 0, 0).applyQuaternion(q).normalize(), up: new THREE.Vector3(0, 1, 0) };
  }

  /** WHERE AND WHAT, at wall-clock `t`. Pure in `t`; called every frame while the crew is shown. */
  update(t: number, dt: number): { x: number; z: number; y: number } {
    const w = this.work;
    const T = t + this.phase * 37;
    let x = 0, z = 0, y = 0, yaw = 0, walking = false, carrying = false;
    // the activity's arm/head targets (radians): shoulders and elbows raise forward; head pitches down +
    let rS = 0, rE = 0, lS = 0, lE = 0, headPitch = 0, headYaw = 0, chest = 0;
    if (w.kind === "carry" || w.kind === "supply") {
      const dx = w.to.x - w.from.x, dz = w.to.z - w.from.z, L = Math.hypot(dx, dz);
      const leg = L / CREW_WALK_SPEED, restA = w.kind === "carry" ? 3.2 : 4.5, restB = w.kind === "carry" ? 2.6 : 3.8;
      const period = 2 * leg + restA + restB;
      const u = ((T % period) + period) % period;
      const there = Math.atan2(dx, dz), back = Math.atan2(-dx, -dz);
      if (u < restA) { x = w.from.x; z = w.from.z; yaw = there; carrying = false; } // picking up
      else if (u < restA + leg) { const f = (u - restA) / leg; x = w.from.x + dx * f; z = w.from.z + dz * f; yaw = there; walking = true; carrying = true; }
      else if (u < restA + leg + restB) { x = w.to.x; z = w.to.z; yaw = back; carrying = false; } // set down
      else { const f = (u - restA - leg - restB) / leg; x = w.to.x - dx * f; z = w.to.z - dz * f; yaw = back; walking = true; }
      y = w.y ?? 0;
      if (carrying) { rS = 2.25; rE = 1.5; } // the near hand up on the load
      if (!walking && u < restA) { chest = 0.35 * Math.sin((u / restA) * Math.PI); } // bend to lift
    } else {
      x = w.at.x; z = w.at.z; y = w.y ?? 0; yaw = w.yaw;
      if (w.kind === "hammer") {
        // a 1.6 s cycle: a slow lift, a fast strike, a short settle — three strikes, then a look at the work
        const c = T % 7.2, k = c < 4.8 ? (c % 1.6) / 1.6 : -1;
        const lift = k < 0 ? 0 : k < 0.62 ? Math.sin((k / 0.62) * Math.PI / 2) : k < 0.74 ? Math.cos(((k - 0.62) / 0.12) * Math.PI / 2) : 0;
        rS = 0.95 + 0.85 * lift; rE = 0.55 + 0.9 * lift;
        lS = 0.75; lE = 0.6; // the other hand steadies the board
        headPitch = 0.38; chest = 0.12;
      } else if (w.kind === "inspect") {
        const c = T % 11;
        const looking = c > 6.5 && c < 9.5;
        lS = 1.05; lE = 1.25; rS = looking ? 0.2 : 0.7; rE = looking ? 0.2 : 0.9;
        headPitch = looking ? -0.05 : 0.42;
        headYaw = looking ? Math.atan2(Math.sin(w.lookYaw - w.yaw), Math.cos(w.lookYaw - w.yaw)) * 0.6 : 0;
      } else if (w.kind === "tool") {
        const c = T % 4.4, on = c < 2.2;
        const buzz = on ? Math.sin(T * 95) * 0.025 : 0;
        rS = 1.35 + buzz; rE = 0.75; lS = 1.2 + buzz; lE = 0.95; chest = 0.14 + (on ? 0.04 : 0); headPitch = 0.12;
      }
    }
    this.root.position.set(x, y, z);
    this.root.rotation.set(0, yaw, 0);
    if (walking) this.play(CLIP_WALK, 0.25, WALK_TIME_SCALE);
    else this.play(CLIP_IDLE, 0.3, 1);
    if (this.carriedMesh) this.carriedMesh.visible = carrying;
    this.mixer.update(dt);
    // the post-mixer layer
    this.root.updateMatrixWorld(true);
    this.pose.rebase(this.layered);
    const { lift, up } = this.axes();
    const B = this.bones;
    if (B.chest) this.pose.rotate(B.chest, lift, -chest);
    if (B.rArm) this.pose.rotate(B.rArm, lift, rS);
    if (B.rFore) this.pose.rotate(B.rFore, lift, rE);
    if (B.lArm) this.pose.rotate(B.lArm, lift, lS);
    if (B.lFore) this.pose.rotate(B.lFore, lift, lE);
    if (B.head) { this.pose.rotate(B.head, lift, -headPitch); this.pose.rotate(B.head, up, headYaw); }
    this.pose.seal(this.layered);
    return { x, z, y };
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.scene);
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (m.name.startsWith("crew-")) m.geometry.dispose();
      else (m.material as THREE.Material).dispose(); // our tinted copy; the prototype's geometry is shared
    });
  }
}

/** THE CREW SYSTEM. `group` is added under the exterior root (so it follows the shared exterior's anchor
 *  and its visibility). Call `update` once a frame with the wall clock and the camera position in the
 *  exterior's own frame. */
export class ConstructionCrew {
  readonly group = new THREE.Group();
  private workers: Worker[] = [];
  private readonly shadows: THREE.InstancedMesh;
  private readonly centre: THREE.Vector3;
  private disposed = false;
  /** null until loaded; the number of bodies, their triangles (body + workwear) and draws */
  stats: { workers: number; triangles: number; draws: number } | null = null;

  readonly site: ConstructionSite;
  private readonly members: readonly CrewLook[];

  constructor(site: ConstructionSite, members: readonly CrewLook[] = CREW) {
    this.site = site; this.members = members;
    this.group.name = `construction-crew:${site.id}`;
    this.group.visible = false;
    const y = site.yard;
    this.centre = new THREE.Vector3(y.x + y.w / 2, 0, y.z + y.d / 2);
    // soft contact shadows (the crew casts none — see Worker)
    const disc = new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2);
    const n = disc.getAttribute("position").count, c = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) c[i * 4 + 3] = i === 0 ? 0.55 : 0;
    disc.setAttribute("color", new THREE.BufferAttribute(c, 4));
    this.shadows = new THREE.InstancedMesh(disc, new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), members.length);
    this.shadows.name = "crew-contact-shadows";
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = 1;
    this.group.add(this.shadows);
  }

  /** load the base body once and dress the crew. Resolves false when the character could not be loaded. */
  async load(lod: 0 | 1 | 2 = 2): Promise<boolean> {
    const proto = await prototypeFor("bon", lod).catch(() => null);
    if (!proto || this.disposed) return false;
    this.adopt(proto);
    return true;
  }
  /** dress the crew from an already-parsed prototype (tests hand one in) */
  adopt(proto: CastPrototype): void {
    const M = measure(proto);
    const wearMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });
    this.workers = this.members.map((look, i) => {
      const work = this.site.work[i % this.site.work.length];
      const w = new Worker(proto, M, look, work, i * 0.173, workwear(M, look), wearMat);
      this.group.add(w.root);
      return w;
    });
    this.stats = { workers: this.workers.length, triangles: this.workers.reduce((n, w) => n + w.triangles, 0), draws: this.workers.length * 2 + this.workers.filter((w) => w.look.tool === "plank" || w.look.tool === "gloves").length + 1 };
  }

  private readonly m4 = new THREE.Matrix4();
  /** @param t wall-clock seconds @param camLocal the camera, in the exterior root's frame (null: no gate) */
  update(t: number, dt: number, camLocal: THREE.Vector3 | null): void {
    if (!this.workers.length) return;
    const near = !camLocal || Math.hypot(camLocal.x - this.centre.x, camLocal.z - this.centre.z) < CREW_SHOW_RANGE;
    this.group.visible = near;
    if (!near) return;
    this.workers.forEach((w, i) => {
      const p = w.update(t, dt);
      this.shadows.setMatrixAt(i, this.m4.makeScale(7 * w.look.scale, 1, 5.5 * w.look.scale).setPosition(p.x, p.y + 0.35, p.z));
    });
    this.shadows.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.disposed = true;
    for (const w of this.workers) w.dispose();
    this.workers = [];
    this.shadows.geometry.dispose();
    this.group.removeFromParent();
  }
}
