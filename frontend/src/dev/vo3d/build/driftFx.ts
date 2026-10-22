// vo3d build — S3: A DRIFT, SEEN. Skid marks behind the rear wheel and sparks off it, for every rider this
// browser draws (its own and everybody else's, from the S2 stream's `fx`) — TWO draws for all of them.
//
//   skids   short dark translucent strips laid wheel-point to wheel-point while a drift is slipping, faded by
//           narrowing over their last second (no per-instance alpha, no shader). A ring buffer: the oldest
//           strip is reused, so the cost is fixed whatever anybody does.
//   sparks  a small additive point pool off the rear wheel. Their rate and colour follow the charge — a few faint
//           warm ones while it builds, amber at the first tier, Offshorly's mint-green at full charge and while
//           the mini-boost runs. Additive, so a spent spark is simply black.
//
// The world feeds each rider once a frame (`feed`) and steps the lot once (`update`). A rider not fed this
// frame lays no more skid and throws no more sparks; what is already on the ground finishes on its own.
import * as THREE from "three";
import type { ScooterFx } from "../world/scooters";
import { DRIFT } from "../player/ScooterDrift";

const SKIDS = 240;
const SKID_LIFE_S = 3.5;
const SKID_FADE_S = 1.2;
const SKID_W = 2.2;
const SKID_STEP = 3;
const SPARKS = 128;
const SPARK_GRAVITY = 240;

const WARM = new THREE.Color(0xd8b48a);
const AMBER = new THREE.Color(0xffb547);
const MINT = new THREE.Color(0x7ef0b0);

type Vec2 = { x: number; z: number };

export class DriftFx {
  readonly group = new THREE.Group();
  private readonly skids: THREE.InstancedMesh;
  private readonly skidBorn = new Float32Array(SKIDS).fill(-1e9);
  private readonly skidSeg: { x: number; z: number; y: number; yaw: number; len: number }[] = Array.from({ length: SKIDS }, () => ({ x: 0, z: 0, y: 0, yaw: 0, len: 0 }));
  private skidNext = 0;
  private readonly sparks: THREE.Points;
  private readonly sPos = new Float32Array(SPARKS * 3);
  private readonly sCol = new Float32Array(SPARKS * 3);
  private readonly sVel = new Float32Array(SPARKS * 3);
  private readonly sLife = new Float32Array(SPARKS);
  private readonly sAge = new Float32Array(SPARKS).fill(1);
  private readonly sTint: THREE.Color[] = Array.from({ length: SPARKS }, () => new THREE.Color());
  private sparkNext = 0;
  private time = 0;
  /** per rider: where the last strip ended (null between drifts), how many sparks are owed, fed this frame */
  private readonly riders = new Map<string, { last: Vec2 | null; owed: number; fed: boolean }>();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  /** live skid strips and sparks (tests, the readout) */
  readonly stats = { skids: 0, sparks: 0 };

  constructor() {
    this.group.name = "drift-fx";
    const strip = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const skidM = new THREE.MeshBasicMaterial({ color: 0x1d1f22, transparent: true, opacity: 0.28, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.skids = new THREE.InstancedMesh(strip, skidM, SKIDS);
    this.skids.name = "drift-skids";
    this.skids.frustumCulled = false;
    this.skids.castShadow = false;
    this.skids.receiveShadow = false;
    for (let i = 0; i < SKIDS; i++) this.skids.setMatrixAt(i, this.hidden);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.sPos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(this.sCol, 3));
    const sparkM = new THREE.PointsMaterial({ size: 1.9, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    this.sparks = new THREE.Points(g, sparkM);
    this.sparks.name = "drift-sparks";
    this.sparks.frustumCulled = false;
    this.group.add(this.skids, this.sparks);
  }

  /** ONE RIDER, THIS FRAME: the rear wheel's ground point and height, the ride's travel heading (forward =
   *  (sin h, −cos h)), its speed and the drift (`fx`, absent when there is none) */
  feed(key: string, rear: Vec2, y: number, heading: number, speed: number, fx: ScooterFx | undefined, dt: number): void {
    let r = this.riders.get(key);
    if (!r) { r = { last: null, owed: 0, fed: false }; this.riders.set(key, r); }
    r.fed = true;
    const drifting = (fx?.drift ?? 0) !== 0 && Math.abs(fx?.slip ?? 0) > 0.1 && speed > 20;
    // the skid: strip by strip while the deck slips, a clean break between drifts
    if (drifting) {
      if (!r.last) r.last = { ...rear };
      const dx = rear.x - r.last.x, dz = rear.z - r.last.z, len = Math.hypot(dx, dz);
      if (len >= SKID_STEP) {
        this.laySkid((rear.x + r.last.x) / 2, (rear.z + r.last.z) / 2, y, Math.atan2(dx, dz), len);
        r.last = { ...rear };
      }
    } else r.last = null;
    // the sparks: more, and brighter, as the drift charges; a green trail while the mini-boost runs
    const charge = fx?.charge ?? 0;
    const boosting = fx?.boost === true;
    const rate = drifting ? (charge >= DRIFT.tier2 ? 46 : charge >= DRIFT.tier1 ? 28 : 10) : boosting ? 22 : 0;
    const tint = boosting || charge >= DRIFT.tier2 ? MINT : charge >= DRIFT.tier1 ? AMBER : WARM;
    r.owed += rate * Math.max(0, dt);
    const side = -(fx?.drift ?? 0); // sparks fly OUT of the turn
    while (r.owed >= 1) {
      r.owed -= 1;
      this.spark(rear, y, heading, side, tint, drifting ? 1 : 0.6);
    }
  }

  private laySkid(x: number, z: number, y: number, yaw: number, len: number): void {
    const i = this.skidNext;
    this.skidNext = (this.skidNext + 1) % SKIDS;
    this.skidBorn[i] = this.time;
    const seg = this.skidSeg[i];
    seg.x = x; seg.z = z; seg.y = y + 0.18; seg.yaw = yaw; seg.len = len + 0.4;
  }

  private spark(at: Vec2, y: number, heading: number, side: number, tint: THREE.Color, power: number): void {
    const i = this.sparkNext;
    this.sparkNext = (this.sparkNext + 1) % SPARKS;
    const fx = Math.sin(heading), fz = -Math.cos(heading);
    const rx = Math.cos(heading), rz = Math.sin(heading); // the rider's right
    const back = (30 + Math.random() * 30) * power, lat = (side * 18 + (Math.random() - 0.5) * 24) * power;
    this.sPos[i * 3] = at.x; this.sPos[i * 3 + 1] = y + 1; this.sPos[i * 3 + 2] = at.z;
    this.sVel[i * 3] = -fx * back + rx * lat;
    this.sVel[i * 3 + 1] = (25 + Math.random() * 30) * power;
    this.sVel[i * 3 + 2] = -fz * back + rz * lat;
    this.sLife[i] = 0.25 + Math.random() * 0.15;
    this.sAge[i] = 0;
    this.sTint[i].copy(tint);
  }

  /** step everything once a frame */
  update(dt: number): void {
    this.time += Math.max(0, dt);
    for (const [k, r] of this.riders) {
      if (!r.fed) { r.last = null; r.owed = 0; if (k !== "self") this.riders.delete(k); }
      r.fed = false;
    }
    let skids = 0;
    for (let i = 0; i < SKIDS; i++) {
      const age = this.time - this.skidBorn[i];
      if (age < 0 || age > SKID_LIFE_S) { this.skids.setMatrixAt(i, this.hidden); continue; }
      skids++;
      const fade = Math.min(1, (SKID_LIFE_S - age) / SKID_FADE_S);
      const seg = this.skidSeg[i];
      this.q.setFromAxisAngle(this.up, seg.yaw);
      this.m.compose(this.v.set(seg.x, seg.y, seg.z), this.q, this.s.set(SKID_W * fade, 1, seg.len));
      this.skids.setMatrixAt(i, this.m);
    }
    this.skids.instanceMatrix.needsUpdate = true;
    let sparks = 0;
    for (let i = 0; i < SPARKS; i++) {
      if (this.sAge[i] >= this.sLife[i]) { this.sCol[i * 3] = this.sCol[i * 3 + 1] = this.sCol[i * 3 + 2] = 0; continue; }
      sparks++;
      this.sAge[i] += dt;
      this.sVel[i * 3 + 1] -= SPARK_GRAVITY * dt;
      this.sPos[i * 3] += this.sVel[i * 3] * dt;
      this.sPos[i * 3 + 1] += this.sVel[i * 3 + 1] * dt;
      this.sPos[i * 3 + 2] += this.sVel[i * 3 + 2] * dt;
      const k = Math.max(0, 1 - this.sAge[i] / this.sLife[i]);
      const t = this.sTint[i];
      this.sCol[i * 3] = t.r * k; this.sCol[i * 3 + 1] = t.g * k; this.sCol[i * 3 + 2] = t.b * k;
    }
    (this.sparks.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.sparks.geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
    this.stats.skids = skids;
    this.stats.sparks = sparks;
  }

  /** everything gone at once (leaving the ground floor, a teardown) */
  clear(): void {
    this.skidBorn.fill(-1e9);
    this.sAge.fill(1);
    this.riders.clear();
    this.update(0);
  }

  dispose(): void {
    this.skids.geometry.dispose();
    (this.skids.material as THREE.Material).dispose();
    this.sparks.geometry.dispose();
    (this.sparks.material as THREE.Material).dispose();
  }
}
