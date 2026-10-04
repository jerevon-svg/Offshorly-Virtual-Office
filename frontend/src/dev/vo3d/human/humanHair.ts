// vo3d human — HAIR SECONDARY MOTION: one shared, preset-driven joint-chain system for every hairstyle.
//
// A hairstyle (a hair module, or the fused hair of an identity head) declares CHAINS of module-owned joints under
// Head, and a MOTION PRESET. Every frame, after the clip and the behaviours have posed the head (layer order 70 — after
// clearance, before the face), each chain is reset to its rest pose, then each segment end is simulated as a damped
// spring toward where it would hang from where the head now is: lag on head turns, sway when walking, a small reaction
// on start/stop, a gentle settle. Segments keep their length, are pushed out of head / neck / shoulder / upper-back
// colliders, and are clamped to a safe swing that grows toward the tips. Applied as world rotations, so it follows any
// body preset (colliders are bones). Nothing accumulates: the rest pose is restored first every frame.
//
// PRESETS (motion feel, per hairstyle): rigid (no motion) · short (tips/fringe only, stiff) · medium (restrained sway)
// · long (more segments, softer, more swing at the ends). LOD: 0 = full, 1 = every other frame, 2 = off (rest pose).
import * as THREE from "three";
import { rotateWorld } from "./humanRig";

export type HairMotionPreset = "rigid" | "short" | "medium" | "long";
export const HAIR_MOTION: Record<HairMotionPreset, { stiffness: number; damping: number; maxSwing: number; hang: number; sway: number }> = {
  rigid: { stiffness: 0, damping: 0, maxSwing: 0, hang: 0, sway: 0 },
  short: { stiffness: 320, damping: 26, maxSwing: 0.07, hang: 0.15, sway: 0 },
  medium: { stiffness: 150, damping: 17, maxSwing: 0.22, hang: 0.45, sway: 0.008 },
  long: { stiffness: 105, damping: 13, maxSwing: 0.32, hang: 0.55, sway: 0.012 },
};

/** joints: hinge-first; `ends[k]` = where segment k ends at rest (scene space). Legacy 2-joint chains use mid/tip. */
export type HairChain = { id: string; joints: string[]; hinge: number[]; ends?: number[][]; mid?: number[]; tip?: number[]; hang?: number };
type Seg = { j: THREE.Bone; r: THREE.Quaternion; endL: THREE.Vector3; p: THREE.Vector3; v: THREE.Vector3; swing: number };
type Sim = { segs: Seg[]; init: boolean; hang: number; phase: number };

const DOWN = new THREE.Vector3(0, -1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion();

export class HairDynamics {
  private sims: Sim[] = [];
  private colliders: { bone: THREE.Object3D; r: number; offset: THREE.Vector3 }[] = [];
  stiffness: number; damping: number; maxSwing: number; sway: number;
  readonly preset: HairMotionPreset;
  /** 0 full · 1 half rate · 2 off (rest pose) — set by the scene from camera distance */
  lod = 0;
  enabled = true;
  lastMs = 0;
  private frame = 0;
  private time = 0;

  /** `ibm(name)` → that joint's inverse bind matrix (scene space → joint local), from the hair module's skeleton */
  constructor(chains: readonly HairChain[], bones: ReadonlyMap<string, THREE.Bone>, ibm: (name: string) => THREE.Matrix4, worldScale: number, preset: HairMotionPreset = "medium") {
    this.preset = preset; const P = HAIR_MOTION[preset];
    this.stiffness = P.stiffness; this.damping = P.damping; this.maxSwing = P.maxSwing; this.sway = P.sway;
    chains.forEach((c, ci) => {
      const ends = c.ends ?? [c.mid ?? c.hinge, c.tip ?? c.hinge];
      const segs: Seg[] = [];
      c.joints.forEach((name, k) => { const j = bones.get(name); if (!j || !ends[k]) return;
        segs.push({ j, r: j.quaternion.clone(), endL: new THREE.Vector3(...ends[k]).applyMatrix4(ibm(name)), p: new THREE.Vector3(), v: new THREE.Vector3(),
          swing: (k + 1) / c.joints.length }); });
      if (!segs.length) return;
      // legacy hint by id: curtains hang less (combed over the face edge), the back hangs most
      const hang = c.hang ?? (/Curtain/.test(c.id) ? 0.2 : /Side/.test(c.id) ? 0.4 : P.hang);
      this.sims.push({ segs, init: false, hang, phase: ci * 1.7 });
    });
    // colliders: head, neck, shoulders, upper back (world radius); the head collider sits a little above the Head joint
    const H = (y: number) => new THREE.Vector3(0, y, 0);
    for (const [n, r, off] of [["Head", 0.40, H(45)], ["neck", 0.12, H(0)], ["LeftArm", 0.13, H(0)], ["RightArm", 0.13, H(0)], ["LeftShoulder", 0.12, H(0)], ["RightShoulder", 0.12, H(0)], ["Spine", 0.17, H(0)]] as const) {
      const b = bones.get(n); if (b) this.colliders.push({ bone: b, r: r * worldScale, offset: off });
    }
  }

  /** NATURAL A (default) or NATURAL B — a slightly more responsive feel for medium/long hair only (~25% more
   *  follow-through: softer spring, a little less damping, more swing room); short and rigid hair are unaffected */
  tuning: "A" | "B" = "A";
  setTuning(t: "A" | "B"): void {
    this.tuning = t; const P = HAIR_MOTION[this.preset], b = t === "B" && (this.preset === "medium" || this.preset === "long");
    this.stiffness = P.stiffness * (b ? 0.72 : 1); this.damping = P.damping * (b ? 0.86 : 1); this.maxSwing = P.maxSwing * (b ? 1.25 : 1); this.sway = P.sway * (b ? 1.2 : 1);
  }

  layer(): { id: string; order: number; update: (dt: number) => void } { return { id: "hair-dynamics", order: 70, update: (dt) => this.update(dt) }; }

  private update(dt: number): void {
    const t0 = performance.now();
    this.frame++; this.time += dt;
    const off = !this.enabled || this.lod >= 2 || this.preset === "rigid";
    const skip = this.lod === 1 && this.frame % 2 === 1;
    const h = Math.min(0.033, Math.max(1e-4, this.lod === 1 ? dt * 2 : dt));
    for (const s of this.sims) {
      for (const g of s.segs) g.j.quaternion.copy(g.r);
      if (off) { s.init = false; continue; }
      for (const g of s.segs) { g.j.updateMatrixWorld(true); this.segment(s, g, h, skip); }
      s.init = true;
    }
    this.lastMs = performance.now() - t0;
  }

  private segment(s: Sim, g: Seg, h: number, skip: boolean): void {
    const hinge = g.j.getWorldPosition(_a);
    const rest = _b.copy(g.endL).applyMatrix4(g.j.matrixWorld);
    const len = rest.distanceTo(hinge);
    if (len < 1e-5) return;
    const restDir = rest.clone().sub(hinge).normalize();
    // where it would hang: the rest direction pulled toward gravity; a slow, tiny idle sway near the ends
    const want = restDir.clone().lerp(DOWN, s.hang).normalize().lerp(restDir, 0.5).normalize();
    if (this.sway) want.x += Math.sin(this.time * 1.3 + s.phase) * this.sway * g.swing, want.z += Math.sin(this.time * 0.9 + s.phase * 0.7) * this.sway * 0.6 * g.swing;
    const target = hinge.clone().addScaledVector(want.normalize(), len);
    if (!s.init) { g.p.copy(target); g.v.set(0, 0, 0); }
    if (!skip) {
      g.v.addScaledVector(_c.copy(target).sub(g.p), this.stiffness * h).multiplyScalar(Math.max(0, 1 - this.damping * h));
      g.p.addScaledVector(g.v, h);
    }
    // keep the segment length, keep out of the colliders
    g.p.sub(hinge).setLength(len).add(hinge);
    for (const c of this.colliders) {
      const cp = c.offset.lengthSq() ? c.bone.localToWorld(_c.copy(c.offset)) : c.bone.getWorldPosition(_c);
      const d = g.p.distanceTo(cp);
      if (d < c.r && d > 1e-6) g.p.copy(cp).addScaledVector(g.p.clone().sub(cp).normalize(), c.r);
    }
    let dir = g.p.clone().sub(hinge).normalize();
    const lim = this.maxSwing * (0.5 + 0.5 * g.swing), ang = restDir.angleTo(dir);
    if (ang > lim) { dir = restDir.clone().lerp(dir, lim / ang).normalize(); g.p.copy(hinge).addScaledVector(dir, len); }
    rotateWorld(g.j, _q.setFromUnitVectors(restDir, dir));
  }
}
