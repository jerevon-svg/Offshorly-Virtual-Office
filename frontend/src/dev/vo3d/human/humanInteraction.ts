// vo3d human — THE WORLD INTERACTION CONTRACT: how a world object tells any HumanBase body how to use it.
//
// An INTERACTABLE is data in the object's own local frame: one or more SLOTS (where a body stands or sits, which
// way it faces, the posture, the shared behaviour that runs there, which hand frame goes to which named TARGET,
// what the head attends, which props live there, how many may use it, and an optional paired slot), plus the
// named target frames themselves. The body never knows what a desk or a vending machine is; a behaviour reads the
// slot. Built for the proof: the workstation (keyboard + mouse). The other examples below are DATA ONLY — they
// prove the same contract describes the vending machine, the coffee machine, the dartboard and the billiards
// table without a new field (tests validate every one).
import * as THREE from "three";
import { HUMAN_WORLD_SCALE as W, type HandFrame, type Side } from "./humanBaseContract";

export type V3 = readonly [number, number, number];
/** a target frame in the interactable's local frame: a point, and (for hands) the fingers' and palm's directions */
export type TargetFrame = { position: V3; fwd?: V3; palm?: V3 };
export type InteractionSlot = {
  id: string;
  /** the floor point a body walks to first, and the yaw it turns to (radians, 0 = facing local +z) */
  approach: { point: readonly [number, number]; yaw: number };
  posture: "standing" | "seated";
  /** seated slots: where the pelvis rests (local) and the seated yaw */
  seat?: { point: V3; yaw: number };
  /** the shared behaviour that runs in this slot ("desk.type", "vending.buy", "dart.throw", …) */
  behavior: string;
  hands?: Partial<Record<Side, { target: string; frame: HandFrame }>>;
  /** the target the head attends */
  look?: string;
  props?: readonly { prop: string; at: string }[];
  occupancy: number;
  /** a slot another body takes for a paired interaction (handshake, handoff, a billiards break) */
  pairWith?: string;
};
export type Interactable = { id: string; kind: string; slots: readonly InteractionSlot[]; targets: Readonly<Record<string, TargetFrame>> };

/** every reference resolves, occupancy is sane, pairs point at real slots */
export function validateInteractable(it: Interactable): string[] {
  const out: string[] = [];
  const ids = new Set(it.slots.map((s) => s.id));
  for (const s of it.slots) {
    if (s.occupancy < 1) out.push(`${it.id}/${s.id}: occupancy < 1`);
    if (s.posture === "seated" && !s.seat) out.push(`${it.id}/${s.id}: seated without a seat`);
    for (const [side, h] of Object.entries(s.hands ?? {})) if (h && !it.targets[h.target]) out.push(`${it.id}/${s.id}: hand ${side} → unknown target ${h.target}`);
    if (s.look && !it.targets[s.look]) out.push(`${it.id}/${s.id}: look → unknown target ${s.look}`);
    for (const p of s.props ?? []) if (!it.targets[p.at]) out.push(`${it.id}/${s.id}: prop ${p.prop} at unknown target ${p.at}`);
    if (s.pairWith && !ids.has(s.pairWith)) out.push(`${it.id}/${s.id}: pairWith unknown slot ${s.pairWith}`);
  }
  return out;
}

/** a named target in world space for an interactable placed at `root` */
export function targetWorld(root: THREE.Object3D, it: Interactable, name: string): { pos: THREE.Vector3; fwd: THREE.Vector3; palm: THREE.Vector3 } {
  const t = it.targets[name];
  if (!t) throw new Error(`${it.id}: no target ${name}`);
  root.updateMatrixWorld(true);
  const q = root.getWorldQuaternion(new THREE.Quaternion());
  return {
    pos: new THREE.Vector3(...t.position).applyMatrix4(root.matrixWorld),
    fwd: new THREE.Vector3(...(t.fwd ?? [0, 0, 1])).applyQuaternion(q).normalize(),
    palm: new THREE.Vector3(...(t.palm ?? [0, -1, 0])).applyQuaternion(q).normalize(),
  };
}

// ---- the proof's workstation -----------------------------------------------------------------------------------
// Authored in native units ×W (world units), local frame: the sitter faces −z (toward the monitor). Every number is
// MEASURED on HumanBase_V1 holding the shared `sitting-answering` clip (the upright seated pose): hips 0.30 above the
// floor and 0.15 behind the shoulders, shoulders 0.68, knees 0.145. So the cushion is at 0.25, the desk top at 0.47,
// its front edge clear of the chest, and the keyboard 0.36 ahead of / 0.18 below the shoulders — inside the chibi
// reach (contract REACH.arm 0.46) with the elbows bent, not locked.
/** the shared seated base pose and where its Hips sit relative to the feet (root), measured on the base */
export const SEATED_CLIP = { name: "sitting-answering", phase: 0.5, hips: [0, 0.302 * W, -0.15 * W] } as const;
export const DESK = {
  topY: 0.47 * W, centerZ: -0.15 * W, depth: 0.5 * W, width: 1.2 * W, thick: 0.035 * W,
  seat: { z: 0.47 * W, y: 0.25 * W, hipY: 0.302 * W },
  keyboard: { z: -0.04 * W, w: 0.42 * W, d: 0.14 * W, h: 0.022 * W },
  mouse: { x: 0.31 * W, z: -0.02 * W },
  monitor: { z: -0.33 * W, y: 0.33 * W },
} as const;

export const WORKSTATION: Interactable = {
  id: "proof-workstation", kind: "desk",
  slots: [{
    // walk up beside the chair, face the desk, sit across onto it
    id: "seat", approach: { point: [-0.45 * W, DESK.seat.z], yaw: Math.PI }, posture: "seated",
    seat: { point: [0, DESK.seat.hipY, DESK.seat.z], yaw: Math.PI }, behavior: "desk.type",
    hands: { L: { target: "keyboard.left", frame: "tip" }, R: { target: "keyboard.right", frame: "tip" } },
    look: "monitor", props: [{ prop: "mouse", at: "mouse" }], occupancy: 1,
  }],
  targets: {
    "keyboard.left": { position: [-0.1 * W, DESK.topY + DESK.keyboard.h, DESK.keyboard.z], fwd: [0, 0, -1], palm: [0, -1, 0] },
    "keyboard.right": { position: [0.1 * W, DESK.topY + DESK.keyboard.h, DESK.keyboard.z], fwd: [0, 0, -1], palm: [0, -1, 0] },
    mouse: { position: [DESK.mouse.x, DESK.topY + 0.024 * W, DESK.mouse.z], fwd: [0, 0, -1], palm: [0, -1, 0] },
    monitor: { position: [0, DESK.topY + DESK.monitor.y, DESK.monitor.z] },
  },
};

/** DATA-ONLY examples: the same contract, no new field, for the interactions the library grows into next */
export const EXAMPLE_INTERACTABLES: readonly Interactable[] = [
  {
    id: "vending", kind: "vending-machine",
    slots: [{ id: "front", approach: { point: [0, 0.5 * W], yaw: Math.PI }, posture: "standing", behavior: "vending.buy",
      hands: { R: { target: "button", frame: "tip" } }, look: "panel", props: [{ prop: "soda-can", at: "tray" }], occupancy: 1 }],
    targets: { button: { position: [0.22 * W, 0.62 * W, 0.02 * W], fwd: [0, 0, -1], palm: [-1, 0, 0] }, panel: { position: [0.2 * W, 0.7 * W, 0] },
      tray: { position: [0, 0.18 * W, 0.08 * W], fwd: [0, 0, -1], palm: [0, -1, 0] } },
  },
  {
    id: "coffee", kind: "coffee-machine",
    slots: [{ id: "front", approach: { point: [0, 0.45 * W], yaw: Math.PI }, posture: "standing", behavior: "coffee.brew",
      hands: { R: { target: "cup", frame: "grip" } }, look: "cup", props: [{ prop: "cup", at: "cup" }], occupancy: 1 }],
    targets: { cup: { position: [0, 0.48 * W, 0.1 * W], fwd: [-1, 0, 0], palm: [0, 0, -1] } },
  },
  {
    id: "dartboard", kind: "dartboard",
    slots: [{ id: "throw-line", approach: { point: [0, 2.4 * W], yaw: Math.PI }, posture: "standing", behavior: "dart.throw",
      hands: { R: { target: "release", frame: "pinch" } }, look: "board", props: [{ prop: "dart", at: "release" }], occupancy: 1, pairWith: "waiting" },
    { id: "waiting", approach: { point: [0.7 * W, 2.6 * W], yaw: Math.PI }, posture: "standing", behavior: "idle.watch", look: "board", occupancy: 2 }],
    targets: { release: { position: [0.22 * W, 0.78 * W, 2.15 * W], fwd: [0, 0, -1], palm: [-1, 0, 0] }, board: { position: [0, 0.9 * W, 0] } },
  },
  {
    id: "billiards", kind: "billiards-table",
    slots: [
      { id: "break", approach: { point: [0, 1.5 * W], yaw: Math.PI }, posture: "standing", behavior: "billiards.shoot",
        hands: { L: { target: "bridge", frame: "palm" }, R: { target: "cue-butt", frame: "grip" } }, look: "cue-ball", props: [{ prop: "cue", at: "cue-butt" }], occupancy: 1, pairWith: "opponent" },
      { id: "opponent", approach: { point: [0, -1.5 * W], yaw: 0 }, posture: "standing", behavior: "idle.watch", look: "cue-ball", occupancy: 1, pairWith: "break" },
    ],
    targets: { bridge: { position: [0, 0.4 * W, 1.05 * W], fwd: [0, 0, -1], palm: [0, -1, 0] }, "cue-butt": { position: [0.18 * W, 0.45 * W, 1.45 * W], fwd: [0, 0, -1], palm: [-1, 0, 0] },
      "cue-ball": { position: [0, 0.4 * W, 0.5 * W] } },
  },
];

/** The workstation's geometry for the proof: desk, chair, keyboard (real key grid), mouse, monitor. */
export function buildWorkstation(): { root: THREE.Group; keys: Record<Side, THREE.Vector3[]>; mouse: THREE.Object3D } {
  const root = new THREE.Group(); root.name = "proof-workstation";
  const mat = (c: number, r = 0.7, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  const box = (w: number, h: number, d: number, c: THREE.Material, x: number, y: number, z: number) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), c); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; root.add(o); return o; };
  const wood = mat(0xc9a77c, 0.6), dark = mat(0x2a2d33, 0.6), grey = mat(0x8c9198, 0.5, 0.3), keyMat = mat(0xf1efe9, 0.55), screen = new THREE.MeshStandardMaterial({ color: 0x9cc8ff, emissive: 0x4d82c4, emissiveIntensity: 0.6, roughness: 0.3 });
  // desk
  box(DESK.width, DESK.thick, DESK.depth, wood, 0, DESK.topY - DESK.thick / 2, DESK.centerZ);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.03 * W, DESK.topY - DESK.thick, 0.03 * W, grey, sx * (DESK.width / 2 - 0.05 * W), (DESK.topY - DESK.thick) / 2, DESK.centerZ + sz * (DESK.depth / 2 - 0.05 * W));
  // keyboard: a base and a real 4 × 12 key grid (the fingertip targets are these keys)
  const kb = DESK.keyboard;
  box(kb.w, kb.h * 0.6, kb.d, dark, 0, DESK.topY + kb.h * 0.3, kb.z);
  const keys: Record<Side, THREE.Vector3[]> = { L: [], R: [] };
  const kw = kb.w / 12.6, kd = kb.d / 4.6;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 12; c++) {
    const x = -kb.w / 2 + kw * (c + 0.8) + (r % 2) * kw * 0.3, z = kb.z - kb.d / 2 + kd * (r + 0.8);
    box(kw * 0.84, kb.h * 0.5, kd * 0.82, keyMat, x, DESK.topY + kb.h * 0.85, z);
    const top = new THREE.Vector3(x, DESK.topY + kb.h * 1.1, z);
    if (r < 3) (c < 6 ? keys.L : keys.R).push(top);
  }
  // mouse
  const mouse = new THREE.Mesh(new THREE.CapsuleGeometry(0.022 * W, 0.03 * W, 6, 12), mat(0xf1efe9, 0.4));
  mouse.rotation.x = Math.PI / 2; mouse.scale.set(1, 1, 0.55);
  mouse.position.set(DESK.mouse.x, DESK.topY + 0.012 * W, DESK.mouse.z); mouse.castShadow = true; root.add(mouse);
  // monitor
  const mz = DESK.monitor.z, my = DESK.topY + DESK.monitor.y;
  box(0.05 * W, DESK.monitor.y - 0.15 * W, 0.04 * W, grey, 0, DESK.topY + (DESK.monitor.y - 0.15 * W) / 2, mz - 0.01 * W);
  box(0.6 * W, 0.34 * W, 0.03 * W, dark, 0, my, mz);
  box(0.56 * W, 0.3 * W, 0.005 * W, screen, 0, my, mz + 0.017 * W);
  // chair: seat, back, column, base
  const s = DESK.seat;
  box(0.36 * W, 0.04 * W, 0.34 * W, dark, 0, s.y - 0.02 * W, s.z);
  box(0.34 * W, 0.34 * W, 0.04 * W, dark, 0, s.y + 0.17 * W, s.z + 0.19 * W);
  box(0.04 * W, s.y - 0.04 * W, 0.04 * W, grey, 0, (s.y - 0.04 * W) / 2, s.z);
  box(0.32 * W, 0.02 * W, 0.32 * W, grey, 0, 0.01 * W, s.z);
  return { root, keys, mouse };
}
