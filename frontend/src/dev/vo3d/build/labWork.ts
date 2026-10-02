// vo3d build — THE WORK FLOOR: station modules, bay furnishings, the result gallery.
//
// STATIONS ARE MODULES. Every station is drawn from its TYPE's template (world/labStations) — the same boxes the
// player collides with and the operator's ergonomics are read from — and dressed by its SEED, so two design
// desks are clearly the same product but never copy-pasted: the desktop finish, the drawer side, the lamp, the
// plant, the clutter all vary deterministically. Each station's screens go into the shared ScreenBank under its
// id, so its STATE (active / idle / offline / future) is a UV + brightness change, never a new material — and a
// status puck on every desk says the same thing in the room.
//
// THE BAYS are furnished from world/ailabV2 BAY_PROPS (the solids are the data; this file is how they look).
// THE RESULT GALLERY is six frames over a three-dock delivery counter, each frame its own ScreenBank owner with
// a state lamp: the queue a future job system fills.
import * as THREE from "three";
import { prng } from "./exteriorGeo";
import { shrubGeometry } from "./exteriorFoliage";
import { pool, type Cell, type ScreenBank } from "./labMaterials";
import { openShelf, type LabBakers } from "./labShell";
import { ARTIFACT, BAY_PROPS, type Prop } from "../world/ailabV2";
import { STATIONS, stationTemplate, toWorld, type LocalBox, type ScreenKind, type StationDef, type StationState } from "../world/labStations";

const STATE_LAMP: Record<StationState, number> = { active: 0x7fe0c8, idle: 0xf2c06b, offline: 0x7a828c, future: 0x6d7580 };
const IDLE_CELL: Record<ScreenKind, Cell> = {
  design: "design-idle", reference: "design-idle", code: "code-idle", terminal: "code-idle", review: "review-idle", compare: "review-idle",
  devices: "devices-idle", general: "general-idle", orchestration: "orchestration-idle", status: "general-idle",
};
const TOPS = [0xe9e2d4, 0xd8bf98, 0xc9a173, 0xf0ece4];
const LEGS = [0x3c434d, 0x5d6670, 0x8c6644];

/** a station-local placer: boxes, tubes and screens in the template frame, landing in the world */
function placer(st: StationDef) {
  const yawW = st.yaw - Math.PI, y0 = st.at.y;
  const w = (x: number, z: number) => toWorld(st, x, z);
  return {
    yawW, y0, w,
    box(B: { box: (w: number, h: number, d: number, x: number, y: number, z: number, c: number, yaw?: number) => unknown }, x0: number, x1: number, z0: number, z1: number, ya: number, h: number, c: number, dyaw = 0) {
      const p = w((x0 + x1) / 2, (z0 + z1) / 2);
      B.box(x1 - x0, h, z1 - z0, p.x, y0 + ya, p.z, c, yawW + dyaw);
    },
    pt(x: number, y: number, z: number) { const p = w(x, z); return { x: p.x, y: y0 + y, z: p.z }; },
  };
}

// ============================== STATION MODULES =================================================================
function desk(B: LabBakers, P: ReturnType<typeof placer>, b: LocalBox, top: number, leg: number, pedestalSide: number): void {
  const t = 1.8;
  P.box(B.timber, b.x0, b.x1, b.z0, b.z1, b.h - t, t, top);
  P.box(B.dark, b.x0 + 0.6, b.x1 - 0.6, b.z0 + 0.6, b.z1 - 0.6, b.h - t - 0.5, 0.5, 0x2f353d);
  // legs: panel ends, a modesty panel at the back, a cable tray under it
  for (const x of [b.x0 + 1.2, b.x1 - 1.2]) P.box(B.metal, x - 0.8, x + 0.8, b.z0 + 2, b.z1 - 2, 0, b.h - t, leg);
  P.box(B.dark, b.x0 + 2, b.x1 - 2, b.z0 + 2, b.z0 + 3, 4, b.h - t - 6, 0x4a525c);
  P.box(B.metal, b.x0 + 6, b.x1 - 6, b.z0 + 4, b.z0 + 8, b.h - t - 4, 1, 0x8d969f);
  // a drawer pedestal on the seed's side
  const px = pedestalSide > 0 ? b.x1 - 16 : b.x0 + 2;
  P.box(B.plaster, px, px + 14, b.z0 + 3, b.z1 - 3, 0.5, b.h - t - 1.5, 0xe6e1d8);
  for (let k = 0; k < 3; k++) P.box(B.dark, px + 4, px + 10, b.z1 - 3.1, b.z1 - 2.6, 3 + k * 5, 0.8, 0x6b7280);
  const c = P.w((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2);
  B.contact.rect(c.x, c.z, b.x1 - b.x0, b.z1 - b.z0, P.yawW, 0.24, 6, P.y0 + 0.4);
}
function stool(B: LabBakers, P: ReturnType<typeof placer>, seatY: number, cushion: number): void {
  const s = P.pt(0, 0, 0);
  B.metal.cyl(5.2, 0.8, s.x, s.y + 0.1, s.z, 0x5d6670, 14);
  B.metal.cyl(1, seatY - 2.6, s.x, s.y + 0.9, s.z, 0x8d969f, 8);
  B.metal.add(new THREE.TorusGeometry(4.4, 0.4, 4, 18).rotateX(Math.PI / 2), new THREE.Matrix4().makeTranslation(s.x, s.y + 7, s.z), 0x8d969f);
  B.fabric.cyl(6, 2.4, s.x, s.y + seatY - 2.4, s.z, cushion, 16, 5.6);
  B.contact.disc(s.x, s.z, 5, 0.28, 4, s.y + 0.4);
}
function screenSet(B: LabBakers, screens: ScreenBank, st: StationDef, P: ReturnType<typeof placer>, surfaceY: number, onWall: boolean): void {
  for (const s of stationTemplate(st).screens) {
    const lx = (s.x0 + s.x1) / 2, w = s.x1 - s.x0, h = s.y1 - s.y0, cy = (s.y0 + s.y1) / 2;
    const yaw = P.yawW + (s.yaw ?? 0), tilt = onWall ? 0 : 0.09;
    const n = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const nT = n.clone().multiplyScalar(Math.cos(tilt)).add(new THREE.Vector3(0, Math.sin(tilt), 0));
    const up = new THREE.Vector3(0, Math.cos(tilt), 0).addScaledVector(n, -Math.sin(tilt));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const c = new THREE.Vector3().copy(P.pt(lx, cy, s.z) as THREE.Vector3Like);
    screens.upright(st.id, s.kind as Cell, c.x, c.y, c.z, w, h, yaw, IDLE_CELL[s.kind], 1, tilt);
    // A REAL MONITOR: the glass sits INSET in a bezel that stands proud of it, on a back shell with a rear housing
    const at = (o: THREE.Vector3) => o;
    const shell = at(c.clone().addScaledVector(nT, -0.95));
    B.dark.boxAt(w + 1.6, h + 1.6, 1.4, shell.x, shell.y, shell.z, 0x3d434b, yaw, -tilt);
    for (const sy of [-1, 1]) { const q = c.clone().addScaledVector(up, sy * (h / 2 + 0.4)).addScaledVector(nT, 0.12); B.dark.boxAt(w + 1.6, 0.8, 0.55, q.x, q.y, q.z, 0x2b3038, yaw, -tilt); }
    for (const sx of [-1, 1]) { const q = c.clone().addScaledVector(right, sx * (w / 2 + 0.4)).addScaledVector(nT, 0.12); B.dark.boxAt(0.8, h + 1.6, 0.55, q.x, q.y, q.z, 0x2b3038, yaw, -tilt); }
    const back = c.clone().addScaledVector(nT, -2.0).addScaledVector(up, -h * 0.05);
    B.dark.boxAt(w * 0.55, h * 0.5, 1.4, back.x, back.y, back.z, 0x4a515a, yaw, -tilt);
    if (!onWall) {
      // a neck from a weighted foot up to a hinge behind the panel's lower third
      const hinge = c.clone().addScaledVector(nT, -2.6).addScaledVector(up, -h * 0.12);
      const foot = new THREE.Vector3(hinge.x - n.x * 1.4, P.y0 + surfaceY, hinge.z - n.z * 1.4);
      B.metal.tube(foot, hinge, 0.75, 0x8d969f, 8);
      B.metal.boxAt(2.2, 2.2, 2.2, hinge.x, hinge.y, hinge.z, 0x6b737c, yaw);
      B.metal.box(Math.min(11, w * 0.5), 0.6, 6.5, foot.x + n.x * 1.2, P.y0 + surfaceY, foot.z + n.z * 1.2, 0x8d969f, yaw);
    }
  }
}
function lamp(B: LabBakers, P: ReturnType<typeof placer>, x: number, z: number, surfaceY: number): void {
  const a = P.pt(x, surfaceY, z), b = P.pt(x + 2, surfaceY + 12, z + 4), c = P.pt(x + 6, surfaceY + 14, z + 9);
  B.metal.cyl(2.4, 0.8, a.x, a.y, a.z, 0x3c434d, 10);
  B.metal.tube(a, b, 0.45, 0x3c434d, 4);
  B.metal.tube(b, c, 0.45, 0x3c434d, 4);
  B.lanterns.box(3.6, 1.6, 3.6, c.x, c.y - 1.6, c.z, 0xfff0d0);
}
function plant(B: LabBakers, x: number, y: number, z: number, seed: number, s = 0.32): void {
  B.dark.cyl(3, 4.4, x, y, z, 0xd9d2c4, 10, 3.6);
  B.leaves.push(shrubGeometry(seed).clone().scale(s, s * 1.2, s).translate(x, y + 4, z));
}
function puck(B: LabBakers, P: ReturnType<typeof placer>, x: number, z: number, surfaceY: number, state: StationState): void {
  const p = P.pt(x, surfaceY, z);
  B.dark.cyl(2.2, 0.8, p.x, p.y, p.z, 0x2f353d, 12);
  B.indicators.cyl(1.5, 0.9, p.x, p.y + 0.6, p.z, STATE_LAMP[state], 12);
}

function station(B: LabBakers, screens: ScreenBank, st: StationDef): void {
  const t = stationTemplate(st), P = placer(st), rnd = prng(st.seed * 97 + 5);
  // after dusk a working station sits in its own pool of task light (an idle one in a dimmer one)
  if (st.state !== "future") { const c = P.pt(0, 0.32, -16); B.spill.add(pool(st.type === "master" ? 40 : 54, st.state === "active" ? 0xb08c64 : 0x725c44), new THREE.Matrix4().makeTranslation(c.x, c.y, c.z)); }
  const top = TOPS[st.seed % TOPS.length], leg = LEGS[(st.seed >> 1) % LEGS.length], side = rnd() < 0.5 ? -1 : 1;
  const cushion = [0x9db6c9, 0xd77a5a, 0x8fb08c, 0xf2c06b][st.seed % 4];
  const S = t.surfaceY;
  switch (st.type) {
    case "design": {
      desk(B, P, t.solids[0], top, leg, side);
      stool(B, P, t.seatY!, cushion);
      screenSet(B, screens, st, P, S, false);
      // a drawing tablet + stylus, loose sketch sheets, a swatch fan, a pen cup
      P.box(B.dark, -16, 4, -16, -6, S, 0.8, 0x2b3038, 0.04);
      P.box(B.metal, 6, 7, -14, -6, S + 0.8, 0.6, 0xc9a25a, 0.5);
      // stacked sheets and swatch strips: each 0.1 thick with a 0.08 gap above the one under it (never coplanar)
      for (let k = 0; k < 3; k++) P.box(B.fabric, -50 + k * 7, -38 + k * 7, -22 + k, -10 + k, S + 0.06 + k * 0.18, 0.1, 0xf6efe0, (rnd() - 0.5) * 0.6);
      for (let k = 0; k < 5; k++) P.box(B.fabric, 28, 40, -14, -11, S + 0.06 + k * 0.18, 0.1, [0xd77a5a, 0xf2c06b, 0x7fb7a4, 0x6b8fd6, 0xc58f7a][k], k * 0.22);
      { const p = P.pt(-26, S, -28); B.dark.cyl(1.8, 4, p.x, p.y, p.z, 0x8c6644, 8); for (let k = 0; k < 3; k++) B.metal.tube({ x: p.x, y: p.y + 2, z: p.z }, { x: p.x + (k - 1) * 0.9, y: p.y + 7.5, z: p.z + 0.4 }, 0.3, [0xd77a5a, 0x2b3038, 0x6b8fd6][k], 3); }
      lamp(B, P, side > 0 ? -52 : 46, -30, S);
      if (rnd() < 0.75) { const p = P.pt(side > 0 ? 50 : -52, S, -26); plant(B, p.x, p.y, p.z, st.seed * 7); }
      puck(B, P, side > 0 ? 40 : -40, -34, S, st.state);
      break;
    }
    case "build": {
      desk(B, P, t.solids[0], top, leg, -1);
      const r = t.solids[1];
      desk(B, P, r, top, leg, 1);
      stool(B, P, t.seatY!, cushion);
      screenSet(B, screens, st, P, S, false);
      // keyboard, mouse, a mug, a dev board with LEDs, a tower under the return, a rubber duck on the seed
      P.box(B.dark, -12, 12, -14, -7, S, 0.9, 0x2b3038);
      for (let k = 0; k < 4; k++) P.box(B.plaster, -11 + k * 5.6, -6.6 + k * 5.6, -13.4, -7.6, S + 0.9, 0.3, 0x59616b);
      P.box(B.dark, 15, 18, -12, -8, S, 1, 0x2b3038);
      { const p = P.pt(-24, S, -12); B.fabric.cyl(1.6, 3.4, p.x, p.y, p.z, [0xd77a5a, 0xf0e6d6, 0x6b8fd6][st.seed % 3], 10); }
      P.box(B.dark, 64, 82, -6, 10, S, 1, 0x26573d);
      for (let k = 0; k < 4; k++) { const p = P.pt(66 + k * 4.4, S + 1, 8); B.indicators.box(1, 0.6, 1, p.x, p.y, p.z, [0x7fe0c8, 0xf2c06b, 0x7fe0c8, 0xd77a5a][k]); }
      // the tower stands under the return, clear of its drawer pedestal (x 72–86)
      P.box(B.dark, 61.5, 70.5, 18, 34, 0, 15, 0x2b3038);
      { const p = P.pt(66, 11, 34.3); B.indicators.box(6, 1, 0.6, p.x, p.y, p.z, 0x7fe0c8, P.yawW); }
      if (st.seed % 2 === 1) { const p = P.pt(44, S, -12); B.fabric.box(3, 2.6, 3.4, p.x, p.y, p.z, 0xf2d04a, P.yawW + 0.5); B.fabric.box(1.8, 1.8, 1.8, p.x, p.y + 2.6, p.z, 0xf2d04a); }
      { const p = P.pt(-52, S, -24); plant(B, p.x, p.y, p.z, st.seed * 7, 0.28); }
      puck(B, P, 50, -34, S, st.state);
      break;
    }
    case "review": {
      const b = t.solids[0], riser = t.solids[1];
      // a standing bench: a thick top on a steel frame, a footrail, under-shelf bins
      P.box(B.timber, b.x0, b.x1, b.z0, b.z1, b.h - 1.8, 1.8, top);
      for (const x of [b.x0 + 2, b.x1 - 2]) for (const z of [b.z0 + 2, b.z1 - 2]) P.box(B.metal, x - 0.9, x + 0.9, z - 0.9, z + 0.9, 0, b.h - 1.8, 0x5d6670);
      P.box(B.metal, b.x0 + 2, b.x1 - 2, b.z1 - 3, b.z1 - 2, 3, 0.8, 0x8d969f);
      P.box(B.plaster, b.x0 + 4, b.x1 - 4, b.z0 + 3, b.z1 - 3, 4, 0.8, 0xe6e1d8);
      for (let k = 0; k < 4; k++) P.box(B.fabric, b.x0 + 8 + k * 26, b.x0 + 26 + k * 26, b.z0 + 5, b.z1 - 5, 4.8, 4, [0x7fb7a4, 0xd9d2c4, 0x6b8fd6, 0xd9d2c4][k]);
      // the riser + its mounted review screen
      P.box(B.dark, riser.x0, riser.x1, riser.z0, riser.z1, 0, riser.h, 0x3c434d);
      P.box(B.dark, riser.x0 + 2, riser.x1 - 2, riser.z0 + 1, riser.z1 - 1, riser.h, 38, 0x2f353d);
      screenSet(B, screens, st, P, S, true);
      // devices in cradles across the bench, each its own small screen
      for (let k = 0; k < 4; k++) {
        const x = -40 + k * 13 + (k > 1 ? 30 : 0), p = P.pt(x, S + 4.6, -22);
        B.dark.box(6.4, 9.6, 1, p.x, p.y - 4.8, p.z, 0x3d434b, P.yawW - 0.12);
        screens.upright(st.id, "devices", p.x + Math.sin(P.yawW) * 0.6, p.y, p.z + Math.cos(P.yawW) * 0.6, 5.2, 8.4, P.yawW - 0.12, "devices-idle", 0.95);
        P.box(B.metal, x - 3.6, x + 3.6, -24, -20, S, 0.8, 0x8d969f);
      }
      P.box(B.fabric, -8, 6, -16, -8, S, 0.4, 0xf6efe0, 0.1);
      P.box(B.dark, -6.5, 4.5, -15.5, -15, S + 0.4, 0.8, 0x8c6644, 0.1);
      { const a = P.pt(30, S, -12), b2 = P.pt(30, S + 9, -16); B.metal.tube(a, b2, 0.5, 0x3c434d, 4); B.metal.add(new THREE.TorusGeometry(3, 0.6, 5, 14), new THREE.Matrix4().makeTranslation(b2.x, b2.y, b2.z), 0x3c434d); }
      puck(B, P, -54, -26, S, st.state);
      const c = P.w(0, (b.z0 + b.z1) / 2);
      B.contact.rect(c.x, c.z, b.x1 - b.x0, b.z1 - b.z0, P.yawW, 0.24, 6, P.y0 + 0.4);
      break;
    }
    case "flex": {
      desk(B, P, t.solids[0], top, leg, side);
      stool(B, P, t.seatY!, cushion);
      screenSet(B, screens, st, P, S, false);
      P.box(B.fabric, -14, 0, -14, -6, S, 0.9, [0xd77a5a, 0x6b8fd6][st.seed % 2], 0.12);
      { const p = P.pt(side > 0 ? 40 : -42, S, -24); plant(B, p.x, p.y, p.z, st.seed * 7); }
      { const p = P.pt(14, S, -12); B.fabric.cyl(1.6, 3.4, p.x, p.y, p.z, 0xf0e6d6, 10); }
      puck(B, P, side > 0 ? -40 : 34, -30, S, st.state);
      break;
    }
    case "specialist":
    case "master": {
      const b = t.solids[0], master = st.type === "master";
      // a console: a plinth body, an angled top, a front trim light
      P.box(B.dark, b.x0, b.x1, b.z0, b.z1, 0, b.h - 2, master ? 0x3c434d : 0x4a525c);
      P.box(B.timber, b.x0 - 1, b.x1 + 1, b.z0 - 1, b.z1 + 1, b.h - 2, 2, master ? 0x9c7550 : top);
      { const p = P.w(0, b.z1 + 0.2); B.indicators.box(b.x1 - b.x0 - 8, 0.6, 0.4, p.x, P.y0 + b.h - 3.4, p.z, STATE_LAMP[st.state], P.yawW); }
      screenSet(B, screens, st, P, S, false);
      if (master) { P.box(B.dark, -10, 10, -12, -6, S, 0.8, 0x2b3038); for (let k = 0; k < 3; k++) { const p = P.pt(-6 + k * 6, S + 0.8, -9); B.indicators.box(2, 0.4, 2, p.x, p.y, p.z, [0x7fe0c8, 0xf2c06b, 0x8a9cf0][k]); } }
      if (st.state === "future") { P.box(B.fabric, b.x0 + 4, b.x1 - 4, b.z0 + 2, b.z1 - 2, b.h, 0.6, 0xd9d2c4); }
      puck(B, P, b.x1 - 6, b.z0 + 4, S, st.state);
      const c = P.w(0, (b.z0 + b.z1) / 2);
      B.contact.rect(c.x, c.z, b.x1 - b.x0, b.z1 - b.z0, P.yawW, 0.26, 5, P.y0 + 0.4);
      break;
    }
  }
}

// ============================== BAY FURNISHINGS =================================================================
function faceOf(p: Prop): number {
  if (p.w >= p.d) return p.z < -700 && p.id !== "artifact-wall" ? 0 : 0;
  return p.x < 740 ? Math.PI / 2 : -Math.PI / 2;
}
function board(B: LabBakers, p: Prop, cell: Cell): void {
  const y = p.y ?? 0, cx = p.x + p.w / 2, cz = p.z + p.d / 2, yaw = faceOf(p), long = Math.max(p.w, p.d);
  const nx = Math.sin(yaw), nz = Math.cos(yaw);
  // two legs, a timber frame, a cork backing, and the printed content (several sheets on a long board)
  for (const s of [-1, 1]) { const ox = p.w >= p.d ? s * (long / 2 - 3) : 0, oz = p.w >= p.d ? 0 : s * (long / 2 - 3); B.dark.box(2.4, y + p.h, 2.4, cx + ox, 0, cz + oz, 0x5b4128); }
  B.timber.box(p.w + (p.w >= p.d ? 2 : 0), p.h + 2, p.d + (p.w >= p.d ? 0 : 2), cx, y - 1, cz, 0x8c6644);
  B.fabric.box(p.w >= p.d ? p.w - 2 : p.d + 0.4, p.h - 2, p.w >= p.d ? p.d + 0.4 : p.d - 2, cx, y, cz, 0xc9a77c, p.w >= p.d ? 0 : Math.PI / 2);
  const sheets = Math.max(1, Math.round(long / 60)), sw = Math.min(56, long / sheets - 6);
  for (let k = 0; k < sheets; k++) {
    const off = -long / 2 + (long / sheets) * (k + 0.5);
    const c = new THREE.Vector3(cx + (p.w >= p.d ? off : 0) + nx * (Math.min(p.w, p.d) / 2 + 0.5), y + p.h / 2, cz + (p.w >= p.d ? 0 : off) + nz * (Math.min(p.w, p.d) / 2 + 0.5));
    B.prints.add(k % 3 === 2 && cell === "pinboard" ? "map" : cell, c, sw, p.h - 6, yaw);
  }
  B.contact.rect(cx, cz, p.w + 4, p.d + 6, 0, 0.18, 4);
}
function cabinet(B: LabBakers, p: Prop, rnd: () => number, shelf = false): void {
  const cx = p.x + p.w / 2, cz = p.z + p.d / 2, along = p.w >= p.d;
  B.timber.box(p.w, p.h, p.d, cx, 0, cz, 0xd8c3a0);
  B.timber.box(p.w + 1.4, 1.2, p.d + 1.4, cx, p.h, cz, 0x9c7550);
  const L = along ? p.w : p.d, n = Math.max(2, Math.round(L / 14));
  const face = along ? (p.z > -700 ? p.z : p.z + p.d) : p.x < 740 ? p.x + p.w : p.x;
  for (let k = 0; k < n; k++) {
    const s = -L / 2 + (L / n) * (k + 0.5);
    for (let r = 0; r < (shelf ? 3 : 2); r++) {
      const y = 2.5 + (r * (p.h - 4)) / (shelf ? 3 : 2);
      if (shelf) {
        // open shelving with sample boxes and binders
        const bx = along ? cx + s : face + (p.x < 740 ? -3 : 3), bz = along ? face + (p.z > -700 ? 3 : -3) : cz + s;
        for (let j = 0; j < 3; j++) B.fabric.box(along ? 2.4 : 6, 7 + rnd() * 3, along ? 6 : 2.4, bx + (along ? (j - 1) * 3.2 : 0), y, bz + (along ? 0 : (j - 1) * 3.2), [0xd77a5a, 0x6b8fd6, 0xf2c06b, 0x7fb7a4, 0xf0e6d6][Math.floor(rnd() * 5)]);
      } else {
        const bx = along ? cx + s : face, bz = along ? face : cz + s;
        B.dark.box(along ? L / n - 2 : 0.6, 0.8, along ? 0.6 : L / n - 2, bx, y + (p.h - 4) / 4, bz, 0x6b5a48);
      }
    }
  }
  if (!shelf && rnd() < 0.8) B.leaves.push(shrubGeometry(Math.round(p.x)).clone().scale(0.3, 0.36, 0.3).translate(cx + (along ? p.w / 2 - 8 : 0), p.h + 1.2, cz + (along ? 0 : p.d / 2 - 8)));
  B.contact.rect(cx, cz, p.w, p.d, 0, 0.26, 5);
}
function partition(B: LabBakers, p: Prop, rnd: () => number): void {
  const cx = p.x + p.w / 2, cz = p.z + p.d / 2, along = p.w >= p.d, L = along ? p.w : p.d;
  B.stone.box(p.w + 1, 3, p.d + 1, cx, 0, cz, 0xb5ab99);
  for (let s = -L / 2 + 2; s < L / 2 - 1; s += 3.6) B.timber.box(along ? 2.4 : p.w - 1, p.h - 7, along ? p.d - 1 : 2.4, along ? cx + s : cx, 3, along ? cz : cz + s, [0xb98a5c, 0xa97d52, 0xc49567][Math.floor(rnd() * 3)]);
  B.timber.box(p.w + 2, 4, p.d + 2, cx, p.h - 4, cz, 0x8c6644);
  B.soil.box(p.w - 1, 0.5, p.d - 1, cx, p.h, cz, 0x6e523a);
  for (let s = -L / 2 + 10; s < L / 2 - 6; s += 18) B.leaves.push(shrubGeometry(Math.round(s * 13 + p.x)).clone().scale(0.38, 0.4, 0.38).translate(along ? cx + s : cx, p.h, along ? cz : cz + s));
  B.contact.rect(cx, cz, p.w, p.d, 0, 0.24, 4);
}
function bench(B: LabBakers, screens: ScreenBank, p: Prop, rnd: () => number): void {
  const cx = p.x + p.w / 2, cz = p.z + p.d / 2;
  B.timber.box(p.w, 1.8, p.d, cx, p.h - 1.8, cz, p.id.startsWith("build") ? 0x9c7550 : 0xe9e2d4);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.metal.box(1.8, p.h - 1.8, 1.8, cx + sx * (p.w / 2 - 2), 0, cz + sz * (p.d / 2 - 2), 0x5d6670);
  B.plaster.box(p.w - 4, 0.8, p.d - 4, cx, 4, cz, 0xe6e1d8);
  const top = p.h;
  switch (p.id) {
    case "design-lighttable": {
      // a glowing light table with transparencies on it
      screens.add("lab", "lighttable", [new THREE.Vector3(cx - p.w / 2 + 3, top + 0.15, cz + p.d / 2 - 3), new THREE.Vector3(cx + p.w / 2 - 3, top + 0.15, cz + p.d / 2 - 3), new THREE.Vector3(cx + p.w / 2 - 3, top + 0.15, cz - p.d / 2 + 3), new THREE.Vector3(cx - p.w / 2 + 3, top + 0.15, cz - p.d / 2 + 3)], "lighttable", 1);
      for (let k = 0; k < 3; k++) B.fabric.box(12, 0.12, 9, cx - 14 + k * 13, top + 0.2, cz + (rnd() - 0.5) * 8, 0xf6efe0, rnd() - 0.5);
      break;
    }
    case "design-samples": for (let k = 0; k < 12; k++) B.fabric.box(5, 0.5 + (k % 3) * 0.3, 5, cx - 16 + (k % 6) * 6.4, top, cz - 5 + Math.floor(k / 6) * 9, [0xd77a5a, 0xf2c06b, 0x7fb7a4, 0x6b8fd6, 0xc58f7a, 0x8fb08c][k % 6]); break;
    case "build-devices":
      for (let k = 0; k < 5; k++) {
        const x = cx - 32 + k * 16;
        B.dark.box(9, 1, 7, x, top, cz, 0x26573d);
        B.indicators.box(1, 0.6, 1, x + 3, top + 1, cz + 2.4, [0x7fe0c8, 0xf2c06b, 0xd77a5a, 0x7fe0c8, 0x8a9cf0][k]);
        if (k % 2 === 0) { B.dark.box(5, 8.4, 0.8, x - 6, top, cz - 4, 0x3d434b, 0.15); screens.upright("lab", "devices", x - 6 + Math.sin(0.15) * 0.5, top + 4.2, cz - 3.5, 4.4, 7.4, 0.15, "devices-idle", 0.95); }
      }
      break;
    case "build-assembly":
      // a vise, parts bins, a small robot arm, a cable reel
      B.metal.box(6, 4, 5, cx - 40, top, cz, 0x5d6670);
      for (let k = 0; k < 6; k++) B.fabric.box(6, 3.4, 6, cx - 26 + k * 7, top, cz - 6, [0x6b8fd6, 0xd77a5a, 0xf2c06b][k % 3]);
      { const b0 = { x: cx + 26, y: top, z: cz }, b1 = { x: cx + 28, y: top + 9, z: cz - 2 }, b2 = { x: cx + 36, y: top + 12, z: cz + 2 }; B.metal.cyl(3, 2, b0.x, b0.y, b0.z, 0xe6e1d8, 12); B.metal.tube({ ...b0, y: b0.y + 2 }, b1, 1.1, 0xe6e1d8, 6); B.metal.tube(b1, b2, 0.9, 0xe6e1d8, 6); B.indicators.box(1, 1, 1, b2.x, b2.y - 0.5, b2.z, 0xf2c06b); }
      B.dark.cyl(4, 3, cx + 44, top, cz + 4, 0xd77a5a, 12);
      break;
    case "review-compare":
      for (const s of [-1, 1]) { B.dark.box(18, 12, 1.2, cx + s * 15, top + 1, cz - 3, 0x3d434b, -s * 0.2); screens.upright("QA_01", "compare", cx + s * 15 + Math.sin(-s * 0.2) * 0.7, top + 7.2, cz - 3 + Math.cos(-s * 0.2) * 0.7, 16.4, 10.6, -s * 0.2, "review-idle"); }
      break;
    default: break;
  }
  B.contact.rect(cx, cz, p.w, p.d, 0, 0.24, 5);
}
function rack(B: LabBakers, p: Prop, rnd: () => number): void {
  const cx = p.x + p.w / 2, cz = p.z + p.d / 2, fz = p.z + p.d + 0.3;
  B.dark.box(p.w, p.h, p.d, cx, 0, cz, 0x2b3038);
  B.dark.box(p.w + 1, 1.4, p.d + 1, cx, p.h, cz, 0x3c434d);
  for (let k = 0; k < 8; k++) {
    const y = 4 + k * 4.4;
    B.dark.box(p.w - 3, 3.4, 0.6, cx, y, fz, 0x3a4048);
    for (let j = 0; j < 3; j++) if (rnd() < 0.75) B.indicators.box(0.9, 0.7, 0.4, cx - p.w / 2 + 4 + j * 2, y + 1.4, fz + 0.4, rnd() < 0.8 ? 0x7fe0c8 : 0xf2c06b);
    B.metal.box(p.w - 12, 0.4, 0.4, cx + 3, y + 1.6, fz + 0.4, 0x5d6670);
  }
  // a cable tray across the rack tops
  B.metal.box(p.w + 4, 1, 8, cx, p.h + 6, cz, 0x8d969f);
  B.metal.box(1, 6, 1, cx, p.h + 1.4, cz, 0x8d969f);
  B.contact.rect(cx, cz, p.w, p.d, 0, 0.34, 6);
}

// ============================== THE RESULT GALLERY ==============================================================
export type ArtifactSlotState = "ready" | "input" | "approval" | "empty";
const SLOT_CELL: Record<ArtifactSlotState, Cell> = { ready: "artifact-ready", input: "artifact-input", approval: "artifact-approval", empty: "artifact-empty" };
const SLOT_LAMP: Record<ArtifactSlotState, number> = { ready: 0x7fe0c8, input: 0xf2c06b, approval: 0x8a9cf0, empty: 0x6d7580 };
/** the preview queue the gallery is built showing (a future job system drives it) */
export const ARTIFACT_PREVIEW: readonly ArtifactSlotState[] = ["ready", "input", "approval", "empty", "empty", "empty"];
/** the gallery as the LIVE orchestration starts it: nothing delivered yet (a slot fills only when a job's
 *  artifact is physically docked — app/labWorkforce) */
export const ARTIFACT_LIVE: readonly ArtifactSlotState[] = ["empty", "empty", "empty", "empty", "empty", "empty"];
export const artifactCell = (s: ArtifactSlotState): Cell => SLOT_CELL[s];
export const slotLampColor = (s: ArtifactSlotState): number => SLOT_LAMP[s];
/** WHERE THE GALLERY'S LAMPS ARE (Lab-local): one beside each frame, one on the counter front under each dock. The
 *  live Lab draws these as state-driven instances (build/ailabV2) instead of baking their colour in. */
export function galleryLampSpots(): { frames: THREE.Vector3[]; docks: THREE.Vector3[] } {
  const A = ARTIFACT, fz = A.z + 4, c = A.counter;
  const frames = [0, 1, 2, 3, 4, 5].map((i) => { const x = A.x + ((i % 3) - 1) * 34, y = Math.floor(i / 3) === 0 ? 31 : 14; return new THREE.Vector3(x + 13.4, y + 8.6, fz + 1); });
  const docks = A.docks.map((d) => new THREE.Vector3(d.x, 6, c.z1 + 0.3));
  return { frames, docks };
}
function gallery(B: LabBakers, screens: ScreenBank, preview: readonly ArtifactSlotState[]): void {
  const A = ARTIFACT, x0 = A.x - A.w / 2, fz = A.z + 4;
  // the wall: plaster body on a stone base, a timber frame, a header with the gallery's sign
  B.stone.box(A.w + 2, 3, 10.8, A.x, 0, A.z, 0xb5ab99); // deeper than the posts: their faces never coincide
  B.plaster.box(A.w, A.h - 3, 8, A.x, 3, A.z, 0xece4d6);
  B.timber.box(A.w + 4, 2, 10, A.x, A.h, A.z, 0x9c7550);
  for (const x of [x0, x0 + A.w]) B.timber.box(3, A.h, 10, x, 0, A.z, 0x8c6644);
  B.dark.box(66, 9, 2, A.x, A.h + 2, A.z + 2, 0x4b3a2a);
  B.prints.add("sign-results", new THREE.Vector3(A.x, A.h + 6.5, A.z + 3.15), 62, 8, 0, true);
  // the six frames (2 rows × 3), each its own owner so a slot changes state alone, a lamp beside each
  preview.forEach((s, i) => {
    const col = i % 3, row = Math.floor(i / 3), x = A.x + (col - 1) * 34, y = row === 0 ? 31 : 14;
    B.dark.box(31, 16, 1.2, x, y - 8, fz + 0.2, 0x2f353d);
    B.timber.box(32.4, 1.2, 2, x, y - 9.2, fz + 0.6, 0x8c6644);
    screens.upright(`artifact-${i + 1}`, SLOT_CELL[s], x, y, fz + 0.9, 29, 14.4, 0, "artifact-empty");
    if (preview !== ARTIFACT_LIVE) B.indicators.cyl(1.1, 0.8, x + 13.4, y + 8.6, fz + 1, SLOT_LAMP[s], 10);
  });
  // the delivery counter: plaster body, a timber top, three inset docks with lit lips
  const c = A.counter, cx = (c.x0 + c.x1) / 2, cz = (c.z0 + c.z1) / 2;
  B.plaster.box(c.x1 - c.x0, c.h - 1.6, c.z1 - c.z0, cx, 0, cz, 0xe6e1d8);
  B.timber.box(c.x1 - c.x0 + 2, 1.6, c.z1 - c.z0 + 2, cx, c.h - 1.6, cz, 0xb98a5c);
  B.stone.box(c.x1 - c.x0 + 1, 1.4, c.z1 - c.z0 + 1, cx, 0, cz, 0xb5ab99);
  A.docks.forEach((d, i) => {
    B.metal.box(14, 0.5, 10, d.x, c.h - 0.1, d.z, 0x8d969f);
    B.indicators.box(14, 0.4, 0.6, d.x, c.h + 0.2, d.z + 5.2, i === 1 ? 0x7fe0c8 : 0xc9a25a);
    if (preview !== ARTIFACT_LIVE) B.indicators.box(3, 0.3, 0.6, d.x, 6, c.z1 + 0.3, preview[i] === "empty" ? 0x6d7580 : SLOT_LAMP[preview[i]]);
  });
  B.contact.rect(cx, cz, c.x1 - c.x0, c.z1 - c.z0, 0, 0.26, 6);
  B.contact.rect(A.x, A.z, A.w, 8, 0, 0.22, 6);
}

/** BUILD THE WORK FLOOR into the shared bakers */
export function buildLabWork(B: LabBakers, screens: ScreenBank, gallerySlots: readonly ArtifactSlotState[] = ARTIFACT_PREVIEW): void {
  const rnd = prng(57);
  for (const st of STATIONS) station(B, screens, st);
  for (const p of BAY_PROPS) {
    switch (p.kind) {
      case "board": board(B, p, p.id.includes("whiteboard") || p.id.includes("checklist") ? "whiteboard" : "pinboard"); break;
      case "storage":
        if (p.id === "flex-sofa") sofa(B, p);
        else if (p.id === "design-materials") { openShelf(B.timber, B.fabric, rnd, p.x + p.w / 2, p.z + p.d / 2, 0, p.w, p.h, p.d, 0, 3); B.contact.rect(p.x + p.w / 2, p.z + p.d / 2, p.w, p.d, 0, 0.26, 5); }
        else cabinet(B, p, rnd, false);
        break;
      case "wall": if (p.id.endsWith("partition")) partition(B, p, rnd); else if (p.id === "review-devicewall") deviceWall(B, screens, p); break;
      case "bench": if (p.id !== "artifact-counter") bench(B, screens, p, rnd); break;
      case "rack": rack(B, p, rnd); break;
      case "dock": signoff(B, p); break;
      default: break;
    }
  }
  gallery(B, screens, gallerySlots);
}
function sofa(B: LabBakers, p: Prop): void {
  const cx = p.x + p.w / 2, cz = p.z + p.d / 2;
  B.dark.box(p.w, 3, p.d, cx, 0, cz, 0x6b5a48);
  B.fabric.box(p.w - 2, 4, p.d - 6, cx, 3, cz + 2, 0x86a98f);
  B.fabric.box(p.w - 2, 8, 5, cx, 3, p.z + 2.5, 0x7a9c83);
  for (const s of [-1, 1]) B.fabric.box(5, 6, p.d, cx + s * (p.w / 2 - 2.5), 3, cz, 0x7a9c83);
  for (let k = 0; k < 3; k++) B.fabric.box(16, 2, p.d - 9, cx - 18 + k * 18, 7, cz + 2, 0x95b79e);
  B.fabric.boxAt(8, 6, 2.6, cx + 16, 11, p.z + 6, 0xf2c06b, 0.2, -0.3);
  B.timber.box(26, 6, 14, cx, 0, cz - 26, 0x9c7550);
  B.contact.rect(cx, cz, p.w, p.d, 0, 0.26, 6);
}
function deviceWall(B: LabBakers, screens: ScreenBank, p: Prop): void {
  const cx = p.x + p.w / 2, cz = p.z + p.d / 2, fz = p.z + p.d + 0.2;
  B.dark.box(p.w, p.h, p.d, cx, 0, cz, 0x3c434d);
  B.timber.box(p.w + 2, 2, p.d + 2, cx, p.h, cz, 0x8c6644);
  // a grid of mounted devices under test: phones, tablets, a laptop, each a tiny screen
  for (let r = 0; r < 3; r++) for (let k = 0; k < 6; k++) {
    const w = k % 3 === 2 ? 12 : 6.4, x = p.x + 8 + k * 14.4, y = 9 + r * 12;
    B.dark.box(w + 1.4, 10, 0.8, x, y - 5, fz + 0.3, 0x3d434b);
    screens.upright("QA_02", "devices", x, y, fz + 0.8, w, 8.6, 0, "devices-idle", 0.92);
  }
  B.contact.rect(cx, cz, p.w, p.d, 0, 0.26, 5);
}
function signoff(B: LabBakers, p: Prop): void {
  const cx = p.x + p.w / 2, cz = p.z + p.d / 2;
  B.stone.box(p.w, p.h - 1.4, p.d, cx, 0, cz, 0xcfc5b3);
  B.timber.box(p.w + 1, 1.4, p.d + 1, cx, p.h - 1.4, cz, 0x9c7550);
  B.dark.box(5, 2, 5, cx - 2, p.h, cz, 0x6b5a48);
  B.dark.cyl(1, 3, cx - 2, p.h + 2, cz, 0x2b3038, 8);
  B.indicators.cyl(1.6, 0.6, cx + 3.5, p.h, cz + 2, 0x7fe0c8, 12);
  B.contact.rect(cx, cz, p.w, p.d, 0, 0.26, 4);
}
