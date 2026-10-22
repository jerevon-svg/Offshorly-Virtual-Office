// vo3d human — SEATED WORK & REST: what a seated HumanBase body does with its hands, for every host (the signed-in body in
// avatar/Avatar, every peer in world/Coworkers). Seat interactions keep owning the body's placement and its seated clip;
// this only decides, once the body has settled, whether it sits at a WORKSTATION — and then types on it with the
// playground's DeskWork (fingertips on keys, mouse sessions, a look at the monitor, a small lean) — or otherwise rests
// its hands on its lap (sofas, armchairs, cafe and visitor chairs) instead of the clip's armrest pose floating over a
// seat that has no arms. Both are HandContacts goals, eased in and out; nothing here touches the seat or the clip.
//
// NO PER-DESK DATA. A workstation is DETECTED from the scene the body sits in, once per sit: the NEAR EDGE of a level work
// surface ahead of the body, between the lap and just above the shoulders (VO's desks were built for the legacy cast: a
// seated chibi's shoulders come up to about the desk top), and something standing on the desk beyond it (the monitor) —
// a cafe table has the surface but no monitor. The invisible key grid (humanInteraction.workstationKeys) is laid just in
// from that edge, facing the body, so the fingertips land on the real desk.
//
// UPRIGHT AT THE DESK. The shared seated clip slumps the torso ~25° forward. While typing, the spine is turned (at its
// root, Spine02) so the neck stands over the hips with only a slight forward lean, before the hands are solved — the
// clip keeps the hips and legs on the chair, the typing pose owns the torso, arms, hands and head.
import * as THREE from "three";
import { HUMAN_WORLD_SCALE as W, SIDE_PREFIX, type Side } from "./humanBaseContract";
import type { HumanAvatar } from "./HumanAvatar";
import { DeskWork, HandContacts, elbowPole, type HandGoal } from "./humanBehavior";
import { DESK, WORKSTATION, workstationKeys } from "./humanInteraction";
import { rotateWorld } from "./humanRig";
import { isSolidSurface } from "../interact/seatContact";

export type SeatedMode = "none" | "settling" | "typing" | "resting" | "leaving";
/** seated clip held, body still, for this long before the scene is probed (the slide into the desk has ended) */
const SETTLE_S = 0.6;
/** how far ahead of the shoulders the keyboard may sit (the playground's is 0.36; the chibi arm reaches 0.46) */
const KEYBOARD_REACH = Array.from({ length: 16 }, (_, i) => i * 0.03 * W);
/** the keyboard sits this far in from the desk's near edge */
const KEYBOARD_INSET = 0.07 * W;
/** the typing torso's forward lean (radians) — upright, just inclined toward the screen */
const TYPING_LEAN = 0.1;
const SIDES: readonly Side[] = ["L", "R"];
/** every body probes at most once per ~frame — peers restored seated on page load do not all probe together */
let lastProbeMs = -Infinity;

/** `keyboard` is where the KEY TOPS are (world): the desk's own keyboard or laptop deck when it has one */
export type Workstation = {
  keyboard: THREE.Vector3; forward: THREE.Vector3; mouse: THREE.Vector3 | null;
  /** the keys are the desk's OWN (a keyboard or a laptop deck found on it), not the desk-edge stand-in */
  device: boolean;
  /** the desk top's height and how far ahead of the shoulders its near edge is (diagnostics, audits) */
  deskY: number; edge: number;
};

export class SeatedWork {
  mode: SeatedMode = "none";
  readonly contacts = new HandContacts();
  /** the desk found by the last probe, or null (diagnostic) */
  workstation: Workstation | null = null;
  private desk: DeskWork | null = null;
  private readonly station = { root: new THREE.Group(), keys: workstationKeys(), mouse: new THREE.Object3D() };
  private settle = 0;
  private readonly last = new THREE.Vector3(Infinity, 0, 0);
  private wired = false;
  private readonly h: HumanAvatar;
  constructor(h: HumanAvatar) {
    this.h = h;
    this.station.mouse.position.set(DESK.mouse.x, DESK.topY + 0.012 * W, DESK.mouse.z);
    this.station.root.add(this.station.mouse);
  }

  /** the host's word on the seat: true = a work desk's chair, false = anything else (a lounge, a café, a meeting table),
   *  undefined = unknown (the scene alone decides: a desk with a screen on it). Set before the body settles. */
  atWorkstation: boolean | undefined = undefined;
  /** once per frame BEFORE the avatar's own update: `seated` = the body is in its seated clip, in a seat */
  update(dt: number, seated: boolean): void {
    if (!seated) {
      if (this.mode === "typing" || this.mode === "resting") this.leave();
      else if (this.mode === "settling") this.mode = "none";
      if (this.mode === "leaving" && this.idle()) this.unwire();
      return;
    }
    if (this.mode === "typing" || this.mode === "resting") return;
    const p = this.h.root.getWorldPosition(new THREE.Vector3());
    this.settle = p.distanceToSquared(this.last) < (0.01 * W) ** 2 ? this.settle + dt : 0;
    this.last.copy(p);
    this.mode = "settling";
    const now = performance.now();
    if (this.settle >= SETTLE_S && now - lastProbeMs > 12) { lastProbeMs = now; this.begin(); }
  }

  dispose(): void { this.unwire(); this.mode = "none"; }

  private begin(): void {
    this.workstation = this.atWorkstation === false ? null : findWorkstation(this.h, undefined, this.atWorkstation === true);
    this.wire();
    const c = this.contacts;
    if (this.workstation) {
      const { keyboard, forward, mouse } = this.workstation, yaw = Math.atan2(forward.x, forward.z) + Math.PI;   // station -z faces the body's forward
      // the key grid's tops (station-local y = DESK.topY + 1.1·key height) land ON the desk's own key surface
      const local = new THREE.Vector3(0, DESK.topY + DESK.keyboard.h * 1.1, DESK.keyboard.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      this.station.root.rotation.set(0, yaw, 0);
      this.station.root.position.copy(keyboard).sub(local);
      this.station.root.updateMatrixWorld(true);
      // the hand's mouse sessions go to the desk's own mouse when it has one
      this.station.mouse.position.copy(mouse ? this.station.root.worldToLocal(mouse.clone()) : new THREE.Vector3(DESK.mouse.x, DESK.topY + 0.012 * W, DESK.mouse.z));
      if (this.desk) this.h.removeLayer("desk-work");
      this.desk = new DeskWork(this.h, c, this.station, WORKSTATION);
      this.h.addLayer(this.desk.layer());
      this.h.addLayer({ id: "seated-upright", order: 45, update: () => this.upright() });
      this.desk.workInPlace();
      c.lean.pitch = 0;          // the torso is set upright by `upright`, not leaned by the contacts
      c.look.want = 0.6;         // eyes on the screen, the head not craned
      this.mode = "typing";
    } else {
      // relaxed: palms on the thighs, a slight lean back, nothing to look at
      if (this.desk) { this.h.removeLayer("desk-work"); this.h.removeLayer("seated-upright"); this.desk.phase = "idle"; this.desk = null; }
      c.blend = 0.5; c.look.target = null;
      for (const s of SIDES) { c.goal[s] = () => this.lapGoal(s); c.want[s] = 1; }
      c.look.want = 0; c.lean.pitch = -0.06; c.lean.want = 1;
      this.mode = "resting";
    }
  }

  /** the typing torso: neck over hips with TYPING_LEAN forward, eased by the contacts' lean weight (in on sit-to-type,
   *  out on standing) */
  private upright(): void {
    const w = this.contacts.lean.w;
    if (w <= 0) return;
    const rig = this.h.rig, hips = rig.bone("Hips").getWorldPosition(new THREE.Vector3()), k = w * w * (3 - 2 * w);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.h.root.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
    const want = new THREE.Vector3(0, Math.cos(TYPING_LEAN), 0).addScaledVector(fwd, Math.sin(TYPING_LEAN));
    // the spine turns about Spine02, a little above the hips the lean is measured from: a few passes converge it
    for (let i = 0; i < 3; i++) {
      const cur = rig.bone("neck").getWorldPosition(new THREE.Vector3()).sub(hips).normalize();
      rotateWorld(rig.bone("Spine02"), new THREE.Quaternion().slerp(new THREE.Quaternion().setFromUnitVectors(cur, want), k));
    }
  }

  private lapGoal(side: Side): HandGoal {
    const rig = this.h.rig, p = SIDE_PREFIX[side];
    const hip = rig.bone(`${p}UpLeg`).getWorldPosition(new THREE.Vector3()), knee = rig.bone(`${p}Leg`).getWorldPosition(new THREE.Vector3());
    const along = knee.clone().sub(hip);
    const pos = hip.addScaledVector(along, 0.6);
    pos.y += this.h.clearance.radius(`thigh${side}`) + 0.012 * W;   // on the (clothed) thigh, not in it
    return { frame: "palm", pos, fwd: along.setY(Math.min(0, along.y)).normalize(), palm: new THREE.Vector3(0, -1, 0), pole: elbowPole(this.h, side), curl: { Thumb: 0.25, Index: 0.3, Fingers: 0.4 } };
  }

  private leave(): void {
    this.desk?.release();
    const c = this.contacts;
    c.want.L = c.want.R = 0; c.look.want = 0; c.lean.want = 0;
    this.mode = "leaving";
  }
  private idle(): boolean { const c = this.contacts; return c.w.L <= 0 && c.w.R <= 0 && c.look.w <= 0 && c.lean.w <= 0; }

  private wire(): void {
    if (this.wired) return;
    this.wired = true;
    this.h.addLayer(this.contacts.layer());
    // hands the contacts own are intentional: body clearance leaves them where they were put
    this.h.clearance.intentional = (s) => this.contacts.w[s] > 0.02;
  }
  private unwire(): void {
    if (!this.wired) return;
    this.wired = false;
    this.h.removeLayer("desk-work"); this.h.removeLayer("seated-upright"); this.h.removeLayer("hand-contacts");
    if (this.desk) this.desk.phase = "idle";
    this.desk = null;
    const c = this.contacts;
    c.goal.L = c.goal.R = null; c.look.target = null; c.w.L = c.w.R = 0; c.want.L = c.want.R = 0; c.look.w = c.lean.w = 0;
    this.h.clearance.intentional = () => false;
    this.mode = "none";
  }
}

/** A workstation in front of this seated body: a level surface at typing height within reach, and something at eye
 *  height beyond it. Null for any other seat. Reads the scene the body is in; ignores the body itself and other skinned
 *  bodies, and anything hidden. */
/** `why`, when given, collects the reason a seat is not a workstation (diagnostics, audits). `known`: the seat itself is a
 *  work desk's chair (its SeatCapability says so), so no screen has to prove it — some places carry only a keyboard. */
export function findWorkstation(h: HumanAvatar, why?: string[], known = false): Workstation | null {
  let scene: THREE.Object3D = h.root;
  while (scene.parent) scene = scene.parent;
  const meshes: THREE.Object3D[] = [];
  scene.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || !isSolidSurface(m)) return;
    for (let a: THREE.Object3D | null = o; a; a = a.parent) if (a === h.root) return;
    meshes.push(o);
  });
  if (!meshes.length) return null;
  scene.updateMatrixWorld(true);
  const rig = h.rig, wp = (n: string) => rig.bone(n).getWorldPosition(new THREE.Vector3());
  const sh = wp("LeftArm").add(wp("RightArm")).multiplyScalar(0.5), hips = wp("Hips"), head = wp("Head");
  // never the seat itself: whatever stands under the hips (the chair, its armrests) is not a desk
  const box = new THREE.Box3();
  for (let i = meshes.length - 1; i >= 0; i--) {
    box.setFromObject(meshes[i]);
    if (hips.x >= box.min.x && hips.x <= box.max.x && hips.z >= box.min.z && hips.z <= box.max.z && box.min.y < hips.y) meshes.splice(i, 1);
  }
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(h.root.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
  const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
  const up = (i: THREE.Intersection) => !i.face || i.face.normal.clone().transformDirection(i.object.matrixWorld).y > 0.7;
  /** the highest level surface under a point ahead of the shoulders (forward d, sideways x), between lo and hi */
  const surface = (d: number, x: number, lo: number, hi: number): number | null => {
    const from = sh.clone().addScaledVector(forward, d).addScaledVector(right, x); from.y = hi + 0.05 * W;
    ray.set(from, down); ray.near = 0; ray.far = from.y - lo;
    const hit = ray.intersectObjects(meshes, false).find((i) => i.point.y <= hi && up(i));
    return hit ? hit.point.y : null;
  };
  // THE DESK: the near edge of a level surface above the lap, no higher than a little over the (seated) shoulders
  let deskY: number | null = null, edge = 0;
  for (const d of KEYBOARD_REACH) { const y = surface(d, 0, hips.y + 0.05 * W, sh.y + 0.3 * W); if (y !== null) { deskY = y; edge = d; break; } }
  if (deskY === null) { why?.push(`no desk ahead (shoulders y ${sh.y.toFixed(1)})`); return null; }
  // the desk TOP is the LOWEST level that covers a fair share (≥ 20%) of a wide, deep patch past the edge — not the first
  // thing met (a moulded rim under the top's lip covers a sliver) nor the commonest (a gaming keyboard can cover more
  // of the front than the desk itself does)
  const heights = new Map<number, number>();
  let samples = 0;
  for (let k = 0; k <= 10; k++) for (let x = -18; x <= 18; x += 3) {
    const y = surface(edge + k * 1.2, x, hips.y + 0.05 * W, sh.y + 0.3 * W);
    if (y !== null) { samples++; const key = Math.round(y * 10) / 10; heights.set(key, (heights.get(key) ?? 0) + 1); }
  }
  deskY = [...heights].filter(([, n]) => n >= samples * 0.2).sort((p, q) => p[0] - q[0])[0]?.[0] ?? deskY;
  // THE KEYBOARD (or a laptop's deck): the nearest raised, level plateau on the desk, wide enough to type on — a row of
  // samples standing 0.3–2.2 above the desk top; a mouse is a narrow one beside it, on the typing hand's side
  let keyboard: THREE.Vector3 | null = null, mouse: THREE.Vector3 | null = null, reach = edge;
  const LAT = Array.from({ length: 15 }, (_, i) => i - 7);
  for (let d = edge; d <= edge + 0.6 * W && !keyboard; d += 0.6) {
    const row = LAT.map((x) => surface(d, x, deskY + 0.3, deskY + 2.2));
    let best: [number, number] | null = null;   // the longest run of raised samples nearest the middle
    for (let a = 0; a < row.length; a++) {
      if (row[a] === null) continue;
      let b = a; while (b + 1 < row.length && row[b + 1] !== null) b++;
      if (b - a + 1 >= 4 && (!best || b - a > best[1] - best[0] || (b - a === best[1] - best[0] && Math.abs(LAT[a] + LAT[b]) < Math.abs(LAT[best[0]] + LAT[best[1]])))) best = [a, b];
      a = b;
    }
    if (!best) continue;
    const xs = LAT.slice(best[0], best[1] + 1);
    const kd = d + 0.07 * W, kx = (xs[0] + xs[xs.length - 1]) / 2;
    // the key FIELD's height: across the keyboard's middle, not its front lip
    const mid = xs.map((x) => surface(kd, x, deskY + 0.3, deskY + 2.2)).filter((y): y is number => y !== null);
    const top = Math.max(...(mid.length ? mid : (row.slice(best[0], best[1] + 1) as number[])));
    keyboard = sh.clone().addScaledVector(forward, kd).addScaledVector(right, kx); keyboard.y = top;
    reach = kd;
    // a mouse: a small raised object just right of the keyboard
    for (let mx = xs[xs.length - 1] + 1.5; mx <= xs[xs.length - 1] + 7 && !mouse; mx += 0.75)
      for (const md of [kd - 1, kd, kd + 1]) { const y = surface(md, mx, deskY + 0.3, deskY + 2.2); if (y !== null) { mouse = sh.clone().addScaledVector(forward, md).addScaledVector(right, mx); mouse.y = y; break; } }
  }
  const device = keyboard !== null;
  // no device on the desk (another room's desk): type on the desk top just in from its near edge, as before
  if (!keyboard) { keyboard = sh.clone().addScaledVector(forward, edge + KEYBOARD_INSET); keyboard.y = deskY + DESK.keyboard.h * 1.1; reach = edge + KEYBOARD_INSET; }
  // the monitor: something standing on the desk beyond the keyboard — probed at two heights over the surface (a screen on
  // its stand), never so low that a mug or a lamp base counts; far enough for a bench's screens on its centre lip
  const eye = head.clone();
  ray.near = reach; ray.far = reach + 2.2 * W;
  const screen = [0.18, 0.28, 0.38].some((u) => { eye.y = deskY! + u * W; ray.set(eye, forward); return ray.intersectObjects(meshes, false).length > 0; });
  if (!screen && !known) { why?.push(`desk ${deskY.toFixed(1)} at ${edge.toFixed(1)}, no screen`); return null; }
  return { keyboard, forward, mouse, device, deskY, edge };
}
