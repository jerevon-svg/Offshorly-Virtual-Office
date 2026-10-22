// vo3d human — BODY CLEARANCE: HumanBase knows its own anatomy and keeps its limbs out of itself.
//
// ANATOMICAL ENVELOPES. Each logical region (torso, pelvis, upper arm, forearm, hand, thigh, lower leg …) is a
// CAPSULE between two joints, its radius MEASURED once from the base body's own skin (the 90th percentile of the
// region's vertex distances to the bone segment), plus the thickness of whatever garment is worn over it. They are
// not separate meshes or draw calls — only spatial knowledge, evaluated from bone world positions each frame.
//
// DETERMINISTIC CONSTRAINTS, NOT PHYSICS. After the shared clip and the behaviours have posed the body (and before hair
// motion), each arm chain is tested against the torso, the pelvis and the thighs at four points (mid-forearm, wrist,
// palm, fingertip): a penetrating point rotates its upper arm out about the shoulder by exactly the angle that clears
// it (a few iterations). Legs are kept from collapsing into each other (knees, ankles and thighs keep a minimum gap).
// INTENTIONAL contacts are never undone: a hand owned by a behaviour (packet, keyboard, scooter grips) is skipped.
// Nothing accumulates in the bones — the avatar restores the clip pose every frame before its layers run.
//
// EASED, NOT RE-DECIDED. The solve picks one worst point / obstacle / push axis per iteration, so as an idle sways
// the push it asks for jumps (on/off, or to another axis) between frames — read on screen as twitching hands. The arm
// therefore EASES toward the solve's correction (kept as a rotation relative to the clip pose, in the arm's own frame),
// and a hard guard at the bare envelope (no margin) still pushes whatever the ease has not yet cleared — so the hands
// never sink into the body, and the margin itself is reached smoothly.
import * as THREE from "three";
import { BODY_REGIONS, SIDE_PREFIX, type BodyRegion, type Side } from "./humanBaseContract";
import { rotateWorld, type HumanRig } from "./humanRig";

/** `pct`: which percentile of the region's distances to its bone segment is the envelope radius — core volumes are not
 *  round (a chest is wider than deep), so a lower percentile tracks the SIDES the limbs actually meet */
export type Capsule = { id: string; a: string; b: string; regions: BodyRegion[]; r: number; pct?: number };
/** the region capsules (radius filled in by measureEnvelopes) */
export const ENVELOPES: readonly Omit<Capsule, "r">[] = [
  { id: "torso", a: "Spine02", b: "neck", regions: ["CHEST", "BELLY"], pct: 0.62 },
  { id: "pelvis", a: "LeftUpLeg", b: "RightUpLeg", regions: ["PELVIS"], pct: 0.45 },
  ...(["L", "R"] as const).flatMap((s) => {
    const p = SIDE_PREFIX[s];
    return [
      { id: `upperArm${s}`, a: `${p}Arm`, b: `${p}ForeArm`, regions: [`UPPERARM_${s}` as BodyRegion], pct: 0.7 },
      { id: `forearm${s}`, a: `${p}ForeArm`, b: `${p}Hand`, regions: [`FOREARM_${s}` as BodyRegion], pct: 0.7 },
      { id: `hand${s}`, a: `${p}Hand`, b: `${p}Fingers2`, regions: [`HAND_${s}` as BodyRegion], pct: 0.4 },
      { id: `thigh${s}`, a: `${p}UpLeg`, b: `${p}Leg`, regions: [`THIGH_${s}` as BodyRegion], pct: 0.6 },
      { id: `shin${s}`, a: `${p}Leg`, b: `${p}Foot`, regions: [`SHIN_${s}` as BodyRegion], pct: 0.35 },
    ];
  }),
];

const _p = new THREE.Vector3(), _q = new THREE.Vector3();
function segDist(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, out?: THREE.Vector3): number {
  const ab = _q.copy(b).sub(a), t = Math.min(1, Math.max(0, _p.copy(p).sub(a).dot(ab) / Math.max(1e-9, ab.lengthSq())));
  const c = (out ?? new THREE.Vector3()).copy(a).addScaledVector(ab, t);
  return p.distanceTo(c);
}

/** Measure every envelope's radius from the base body's bind geometry (native units). Cached per geometry. */
const cache = new WeakMap<THREE.BufferGeometry, Capsule[]>();
export function measureEnvelopes(body: THREE.SkinnedMesh): Capsule[] {
  const hit = cache.get(body.geometry); if (hit) return hit;
  const g = body.geometry, pos = g.getAttribute("position"), reg = g.getAttribute("_region");
  const bindPos = (name: string) => {
    const i = body.skeleton.bones.findIndex((b) => b.name === name);
    return new THREE.Vector3().setFromMatrixPosition(body.skeleton.boneInverses[i].clone().invert());
  };
  const out: Capsule[] = [];
  for (const e of ENVELOPES) {
    const a = bindPos(e.a), b = bindPos(e.b), ids = new Set<number>(e.regions.map((r) => BODY_REGIONS[r]));
    const d: number[] = []; const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) if (ids.has(Math.round(reg.getX(i)))) d.push(segDist(v.fromBufferAttribute(pos, i), a, b));
    d.sort((x, y) => x - y);
    out.push({ ...e, r: d.length ? d[Math.floor(d.length * (e.pct ?? 0.9))] : 0.05 });
  }
  cache.set(body.geometry, out);
  return out;
}

export type ClearanceStats = { pushes: number; maxPenetration: number; legSpread: number };

export class BodyClearance {
  private caps: Capsule[];
  /** extra radius per capsule from worn garments (native units), set by the avatar on every equip */
  extra: Record<string, number> = {};
  /** a hand owned by a behaviour is never pushed (packet, keyboard, grips) */
  intentional: (side: Side) => boolean = () => false;
  enabled = true;
  /** clearance margin beyond the envelope (native units) */
  margin = 0.004;
  /** how fast the arm eases toward the solve's correction (1/s) */
  easeRate = 14;
  readonly stats: ClearanceStats = { pushes: 0, maxPenetration: 0, legSpread: 0 };
  /** per arm: last frame's applied correction, relative to the clip pose in the upper arm's own frame */
  private readonly eased: Record<Side, THREE.Quaternion> = { L: new THREE.Quaternion(), R: new THREE.Quaternion() };
  lastMs = 0;
  private readonly rig: HumanRig;
  private readonly scale: number;

  constructor(rig: HumanRig, body: THREE.SkinnedMesh, worldScale: number) {
    this.rig = rig; this.scale = worldScale; this.caps = measureEnvelopes(body);
  }
  get envelopes(): readonly Capsule[] { return this.caps; }
  /** V1.2 MEASURED GARMENT STANDOFF: how far a worn garment really stands off each capsule it covers — the same percentile
   *  of the garment's own bind-pose distances to that capsule's bone segment (each vertex to its nearest covered capsule),
   *  minus the body's radius. A typed thickness under-states baggy cloth (joggers): the hands then sank into the thighs. */
  garmentStandoff(src: Pick<THREE.SkinnedMesh, "skeleton" | "geometry">, capIds: readonly string[]): Record<string, number> {
    const sk = src.skeleton, bind = (n: string) => { const i = sk.bones.findIndex((b) => b.name === n); return i < 0 ? null : new THREE.Vector3().setFromMatrixPosition(sk.boneInverses[i].clone().invert()); };
    const caps = this.caps.filter((c) => capIds.includes(c.id)).map((c) => ({ c, a: bind(c.a), b: bind(c.b), d: [] as number[] })).filter((q) => q.a && q.b);
    const pos = src.geometry.getAttribute("position"), v = new THREE.Vector3(), out: Record<string, number> = {};
    if (!caps.length || !pos) return out;
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); let best = Infinity, bq: (typeof caps)[number] | null = null; for (const q of caps) { const d = segDist(v, q.a!, q.b!); if (d < best) { best = d; bq = q; } } bq?.d.push(best); }
    for (const q of caps) { if (q.d.length < 20) continue; q.d.sort((x, y) => x - y); out[q.c.id] = Math.max(0, q.d[Math.floor(q.d.length * (q.c.pct ?? 0.9))] - q.c.r); }
    return out;
  }
  radius(id: string): number { const c = this.caps.find((q) => q.id === id); return c ? (c.r + (this.extra[c.id] ?? 0)) * this.scale : 0; }
  private ends(id: string): [THREE.Vector3, THREE.Vector3] {
    const c = this.caps.find((q) => q.id === id)!;
    return [this.rig.bone(c.a).getWorldPosition(new THREE.Vector3()), this.rig.bone(c.b).getWorldPosition(new THREE.Vector3())];
  }

  layer(): { id: string; order: number; update: (dt: number) => void } { return { id: "body-clearance", order: 60, update: (dt) => this.update(dt) }; }

  /** `dt` omitted = no easing (the correction is applied at once, as a single solve) */
  update(dt?: number): void {
    if (!this.enabled) { this.eased.L.identity(); this.eased.R.identity(); return; }
    const t0 = performance.now();
    this.stats.pushes = 0; this.stats.maxPenetration = 0;
    for (const s of ["L", "R"] as const) {
      if (this.intentional(s)) { this.eased[s].identity(); continue; }
      const arm = this.rig.bone(`${SIDE_PREFIX[s]}Arm`), clip = arm.quaternion.clone();
      this.clearArm(s, this.margin);                                       // the solve's correction this frame…
      const target = clip.clone().invert().multiply(arm.quaternion);
      const k = dt === undefined ? 1 : 1 - Math.exp(-this.easeRate * Math.max(0, dt));
      arm.quaternion.copy(clip).multiply(this.eased[s].slerp(target, k)); // …eased toward…
      arm.updateMatrixWorld(true);
      this.clearArm(s, 0);                                                 // …never inside the bare envelope
      this.eased[s].copy(clip.invert().multiply(arm.quaternion));
    }
    this.clearLegs();
    this.lastMs = performance.now() - t0;
  }

  /** the worst remaining arm-into-body penetration now (native units) — tests and the panel */
  armPenetration(s: Side): number {
    const other: Side = s === "L" ? "R" : "L", obstacles = ["torso", "pelvis", `thigh${s}`, `thigh${other}`];
    const handR = this.radius(`hand${s}`) * 0.6, foreR = this.radius(`forearm${s}`) * 0.8;
    let worst = 0;
    this.armPoints(s).forEach((pt, k) => { for (const id of obstacles) { const [a, b] = this.ends(id); worst = Math.max(worst, this.radius(id) + (k === 0 ? foreR : handR) - segDist(pt, a, b)); } });
    return worst / this.scale;
  }

  /** the arm chain's sample points: mid-forearm, wrist, palm, fingertip */
  private armPoints(s: Side): THREE.Vector3[] {
    const p = SIDE_PREFIX[s], fore = this.rig.bone(`${p}ForeArm`).getWorldPosition(new THREE.Vector3()), wrist = this.rig.bone(`${p}Hand`).getWorldPosition(new THREE.Vector3());
    return [fore.clone().lerp(wrist, 0.5), wrist, this.rig.handFrame(s, "palm"), this.rig.handFrame(s, "tip")];
  }

  private clearArm(s: Side, margin: number): void {
    const other: Side = s === "L" ? "R" : "L";
    const obstacles = ["torso", "pelvis", `thigh${s}`, `thigh${other}`];
    const arm = this.rig.bone(`${SIDE_PREFIX[s]}Arm`);
    const handR = this.radius(`hand${s}`) * 0.6, foreR = this.radius(`forearm${s}`) * 0.8;
    // CONTINUOUS: each step blends every penetrating point's own clearing rotation (weighted by depth²) rather than
    // taking the single worst one, so the push changes smoothly as the pose does instead of hopping between points
    for (let it = 0; it < 4; it++) {
      let worst = 0, wsum = 0;
      const S = arm.getWorldPosition(new THREE.Vector3()), rot = new THREE.Vector3();
      this.armPoints(s).forEach((pt, k) => {
        const own = k === 0 ? foreR : handR;
        for (const id of obstacles) {
          const [a, b] = this.ends(id), c = new THREE.Vector3();
          const pen = this.radius(id) + own + margin * this.scale - segDist(pt, a, b, c);
          if (pen <= 0) continue;
          const n = pt.clone().sub(c).setY(0); if (n.lengthSq() < 1e-8) n.set(s === "L" ? 1 : -1, 0, 0); n.normalize();
          const lever = pt.clone().sub(S), axis = new THREE.Vector3().crossVectors(lever, n);
          if (axis.lengthSq() < 1e-10) continue;
          const w = pen * pen; wsum += w; worst = Math.max(worst, pen);
          rot.addScaledVector(axis.normalize(), w * Math.min(0.6, (pen * 1.08) / lever.length()));
        }
      });
      if (worst <= 0 || wsum <= 0) break;
      this.stats.maxPenetration = Math.max(this.stats.maxPenetration, worst / this.scale);
      const angle = rot.length() / wsum;
      if (angle < 1e-6) break;
      rotateWorld(arm, new THREE.Quaternion().setFromAxisAngle(rot.normalize(), angle));
      this.stats.pushes++;
    }
  }

  /** knees, ankles and mid-thighs keep at least their two envelopes apart (legs never collapse into each other) */
  private clearLegs(): void {
    this.stats.legSpread = 0;
    const L = this.rig.bone("LeftUpLeg"), R = this.rig.bone("RightUpLeg");
    for (let it = 0; it < 3; it++) {
      const pairs: [THREE.Vector3, THREE.Vector3, number][] = [];
      const kL = this.rig.bone("LeftLeg").getWorldPosition(new THREE.Vector3()), kR = this.rig.bone("RightLeg").getWorldPosition(new THREE.Vector3());
      const aL = this.rig.bone("LeftFoot").getWorldPosition(new THREE.Vector3()), aR = this.rig.bone("RightFoot").getWorldPosition(new THREE.Vector3());
      const hL = L.getWorldPosition(new THREE.Vector3()), hR = R.getWorldPosition(new THREE.Vector3());
      // chibi thighs legitimately touch under the pelvis: only the knees and ankles must stay apart (bare-skin radii)
      void hL; void hR;
      const sh = (this.caps.find((c) => c.id === "shinL")!.r + this.caps.find((c) => c.id === "shinR")!.r) * this.scale;
      pairs.push([kL, kR, sh * 0.95]);
      pairs.push([aL, aR, sh * 0.8]);
      let worst = 0, wa: THREE.Vector3 | null = null, wb: THREE.Vector3 | null = null;
      for (const [a, b, need] of pairs) { const pen = need - a.distanceTo(b); if (pen > worst) { worst = pen; wa = a; wb = b; } }
      if (!wa || !wb || worst <= 0) break;
      this.stats.legSpread = Math.max(this.stats.legSpread, worst / this.scale);
      for (const [hip, pt, sign] of [[L, wa, 1], [R, wb, -1]] as const) {
        const H = hip.getWorldPosition(new THREE.Vector3()), lever = (pt as THREE.Vector3).clone().sub(H);
        const push = (wa as THREE.Vector3).clone().sub(wb as THREE.Vector3).setY(0).normalize().multiplyScalar(sign);
        const axis = new THREE.Vector3().crossVectors(lever, push); if (axis.lengthSq() < 1e-10) continue;
        rotateWorld(hip, new THREE.Quaternion().setFromAxisAngle(axis.normalize(), Math.min(0.3, (worst * 0.55) / lever.length())));
      }
    }
  }
}
