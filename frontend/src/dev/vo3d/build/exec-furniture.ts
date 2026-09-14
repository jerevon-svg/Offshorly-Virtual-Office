// vo3d build — EXECUTIVE ROOM FURNITURE. Room-specific geometry, not a re-skin.
//
// WHY ITS OWN MODULE. build/furniture.ts is the shared catalogue the Design Room, Reception, Meeting,
// Project, Gaming and the Central Hub all draw from, and its pieces carry those rooms' identity: soft
// pods, white task chairs, pale oak tops, olive cushions. Recolouring them does not make an executive
// suite — the SILHOUETTES are wrong. The Executive reference is a different furniture language entirely:
// barrel-backed leather visitor chairs on slim brass sleds, channelled high-back leather executive
// chairs, a dark walnut block coffee table, wing-backed lounge chairs, plain cream rugs.
//
// So these are new builders. What IS reused is the arithmetic and the helpers: the sofa's cushion
// constants (so the room's LoungeSeatSlot data stays exactly the geometry it sits on), Baker/rbox/cyl/
// lathe, the material cache, and the placed()/localSize() facing convention. Nothing here duplicates a
// system; it duplicates no other room's look either.
//
// This module imports NOTHING from rooms/ — rooms/executive.ts reads its metrics, and build/executive.ts
// (the room's static fit-out) reads rooms/executive.ts. One direction, no cycle.
import * as THREE from "three";
import type { Entity } from "../world/WorldState";
import type { Facing } from "../core/coords";
import { Baker, cyl, lathe, placed, localSize, rbox, rnd, sphereGeo } from "./helpers";
import { canvas2d, contactShadowMat, fabric, mat, type MatKey } from "../render/Materials";
import { foliage, leafGeometry } from "./plants";
import type { SwayNode } from "../render/Sway";
import { SOFA_CUSHION_GAP, SOFA_CUSHION_LOCAL_X, SOFA_CUSHION_MARGIN, SOFA_ARM_W, sofaCushionZ } from "./furniture";

/** The entity kinds this module builds. build/registry.ts routes them here. */
export const EXEC_KINDS = [
  "exec-chair", "exec-task-chair", "exec-visitor-chair", "exec-lounge-chair",
  "exec-sofa", "exec-coffee-table", "exec-planter", "exec-rug",
] as const;
export type ExecKind = (typeof EXEC_KINDS)[number];

/** Seat-contact planes, EXPORTED so rooms/executive.ts derives its seat metadata from the same numbers
 *  the meshes use and the two can never drift. */
export const EXEC_CHAIR = { cushionTop: 15.2, cushionLocalZ: 0.4 };
export const EXEC_TASK_CHAIR = { cushionTop: 14.4, cushionLocalZ: 0.4 };
export const EXEC_VISITOR = { cushionTop: 15.4, contactLocalZ: 1.2 };
export const EXEC_LOUNGE_CHAIR = { cushionTop: 14.2, contactLocalZ: 1.5 };

// ---- palette shorthands ---------------------------------------------------------------------------
// Every colour still comes from the room THEME through the entity's props; these are only the defaults.
const leather = (k?: MatKey) => mat(k ?? "execLeather", 0.52);
const leatherSeat = (k?: MatKey) => mat(k ?? "execLeatherSeat", 0.55);
const brass = () => mat("execBrass", 0.28, { metalness: 0.78 });
const walnut = (k?: MatKey) => mat(k ?? "execWalnut", 0.62);
const walnutDark = () => mat("execWalnutDark", 0.78);

const key = (e: Entity, prop: string, fallback: MatKey): MatKey => (typeof e.props[prop] === "string" ? (e.props[prop] as MatKey) : fallback);
const num = (e: Entity, prop: string, fallback: number): number => (typeof e.props[prop] === "number" ? (e.props[prop] as number) : fallback);
const rectOf = (e: Entity) => {
  const w = num(e, "w", 24), d = num(e, "d", 24);
  return { x: e.transform.pos.x - w / 2, z: e.transform.pos.z - d / 2, w, d };
};
const facingOf = (e: Entity): Facing => (typeof e.props.facing === "string" ? (e.props.facing as Facing) : "north");
const shadow = (g: THREE.Group, w: number, d: number, o = 0.15): void => {
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.08, d * 1.08), contactShadowMat(o));
  p.rotation.x = -Math.PI / 2;
  p.position.y = 0.06;
  p.castShadow = p.receiveShadow = false;
  g.add(p);
};

// ---- executive chairs ------------------------------------------------------------------------------
/** A five-star castor base in dark metal with BRASS caps — the reference's one piece of hardware jewellery.
 *  Shared by both executive chairs so the pair reads as one family. */
function castorBase(b: Baker, spread: number, liftTo: number): void {
  const frame = mat("execWalnutDark", 0.45, { metalness: 0.35 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const arm = rbox(spread, 1.5, 1.8, frame, 0, 1.5, 0, 0.6);
    arm.position.set(Math.cos(a) * spread * 0.5, 2.2, Math.sin(a) * spread * 0.5);
    arm.rotation.y = -a;
    b.add(arm);
    const castor = new THREE.Mesh(sphereGeo, frame);
    castor.scale.setScalar(1.25);
    castor.position.set(Math.cos(a) * spread * 0.95, 1.25, Math.sin(a) * spread * 0.95);
    b.add(castor as unknown as THREE.Mesh);
  }
  b.add(cyl(2.4, 1.0, brass(), 0, 3.0, 0)); //            brass collar over the star
  b.add(cyl(1.5, liftTo - 4.0, frame, 0, 4.0, 0)); //     gas lift
  b.add(cyl(2.1, 0.9, brass(), 0, liftTo - 1.0, 0)); //   brass cap under the seat
}

/** CEO / CTO chair: a substantial high-back leather seat with horizontally CHANNELLED back panels, a
 *  padded headrest, sculpted leather arms on brass posts, and the brass-capped castor base. The channels
 *  are what make it read as executive leather rather than as a big task chair. */
function execChair(e: Entity, tall: boolean): THREE.Group {
  const g = placed(rectOf(e), facingOf(e));
  const { w, d } = localSize(rectOf(e), facingOf(e));
  const hide = leather(key(e, "color", "execLeather"));
  const hideSeat = leatherSeat(key(e, "colorSeat", "execLeatherSeat"));
  shadow(g, w * 0.92, d * 0.92, 0.17);
  const b = new Baker();
  const seatW = w * 0.78, seatD = d * 0.72;
  const seatTop = tall ? 13.4 : 12.8;
  castorBase(b, w * 0.46, seatTop - 1.2);
  b.add(rbox(seatW, 3.0, seatD, hide, 0, seatTop - 3.0, 0.3, 1.5)); //  seat pan
  const cushionH = (tall ? EXEC_CHAIR : EXEC_TASK_CHAIR).cushionTop - seatTop;
  b.add(rbox(seatW - 2.2, cushionH, seatD - 2.4, hideSeat, 0, seatTop, 0.4, 1.6, 3)); // seat cushion
  // BACK: three (tall) or two (task) stacked channels on a slightly reclined spine
  const back = new THREE.Group();
  back.position.set(0, seatTop, seatD / 2 - 1.0);
  back.rotation.x = -0.14;
  g.add(back);
  const bb = new Baker();
  const panels = tall ? 3 : 2, panelH = tall ? 6.6 : 6.2, gap = 0.9;
  bb.add(rbox(seatW * 0.92, panels * (panelH + gap) + 2, 2.2, hide, 0, 0, 0.9, 1.2)); // back shell
  for (let i = 0; i < panels; i++)
    bb.add(rbox(seatW * 0.84, panelH, 2.6, hideSeat, 0, 1.4 + i * (panelH + gap), -0.4, 1.4, 3));
  const headY = panels * (panelH + gap) + 2;
  if (tall) {
    bb.add(rbox(seatW * 0.72, 5.4, 3.0, hideSeat, 0, headY - 0.4, -0.2, 2.0, 3)); // headrest pillow
    bb.add(rbox(seatW * 0.74, 0.8, 3.2, brass(), 0, headY - 1.6, -0.3, 0.3)); //    brass reveal under it
  }
  bb.bakeInto(back, "exec-chair-back");
  // ARMS: a leather pad on a brass post, exactly the reference's detail
  for (const s of [-1, 1]) {
    b.add(cyl(0.8, 6.4, brass(), s * (seatW / 2 + 0.6), seatTop - 1.4, 1.2));
    b.add(rbox(2.8, 2.2, seatD * 0.62, hide, s * (seatW / 2 + 0.6), seatTop + 5.0, -0.6, 1.0, 3));
  }
  b.bakeInto(g, "exec-chair-body");
  return g;
}

/** VISITOR CHAIR: a barrel-backed dark-leather shell on a slim BRASS sled — the reference's signature
 *  piece, four to a desk. Nothing about it is a Design Room pod: it has a real seat, a real wrapped
 *  backrest with a stitch line, low arms, and gold legs that are visible from every angle. */
function execVisitorChair(e: Entity): THREE.Group {
  const g = placed(rectOf(e), facingOf(e));
  const { w, d } = localSize(rectOf(e), facingOf(e));
  const hide = leather(key(e, "color", "execLeather"));
  const hideSeat = leatherSeat(key(e, "colorSeat", "execLeatherSeat"));
  shadow(g, w, d, 0.14);
  const b = new Baker();
  const seatTop = EXEC_VISITOR.cushionTop; // 15.4
  // brass sled: two front legs joined by a curved bow, two rear legs raked back
  const m = brass();
  for (const s of [-1, 1]) {
    const front = cyl(0.75, 11.5, m, s * (w / 2 - 2.2), 0, -d / 2 + 2.4);
    front.rotation.z = s * 0.1;
    front.rotation.x = -0.1;
    b.add(front);
    const rear = cyl(0.7, 11.0, m, s * (w / 2 - 3.0), 0, d / 2 - 2.6);
    rear.rotation.z = s * 0.09;
    rear.rotation.x = 0.12;
    b.add(rear);
    b.add(rbox(0.9, 0.9, d - 5.6, m, s * (w / 2 - 2.6), 10.4, 0, 0.35)); // side rail
  }
  b.add(rbox(w - 4.0, 0.9, 0.9, m, 0, 4.2, -d / 2 + 2.6, 0.35)); // front bow, low
  b.add(rbox(w - 5.0, 0.9, 0.9, m, 0, 4.0, d / 2 - 2.8, 0.35)); // rear stretcher
  // seat block + cushion
  b.add(rbox(w - 1.6, 4.2, d - 2.6, hide, 0, seatTop - 6.4, 0.4, 2.4, 3));
  b.add(rbox(w - 4.2, 2.4, d - 5.4, hideSeat, 0, seatTop - 2.4, 0.2, 1.6, 3));
  // barrel back: a wrapped shell rising behind, with two low arms curving into it
  b.add(rbox(w - 1.0, 10.5, 3.4, hide, 0, seatTop - 2.0, d / 2 - 1.9, 2.6, 3));
  b.add(rbox(w - 5.0, 0.7, 3.6, mat("execWalnutDark", 0.8), 0, seatTop + 2.6, d / 2 - 1.9, 0.25)); // stitch line
  for (const s of [-1, 1])
    b.add(rbox(2.6, 5.2, d - 6.0, hide, s * (w / 2 - 1.3), seatTop - 2.0, 1.0, 1.6, 3)); // arms
  b.add(rbox(w - 4.0, 0.7, 1.1, m, 0, seatTop + 8.1, d / 2 - 0.7, 0.3)); // brass cap on the back rail
  b.bakeInto(g, "exec-visitor-chair");
  return g;
}

/** LOUNGE CHAIR: the olive wing-backed executive armchair that faces the sofas. High shaped back, rolled
 *  arms, a piped cushion and turned walnut legs — a formal lounge chair, not a soft tub. */
function execLoungeChair(e: Entity): THREE.Group {
  const g = placed(rectOf(e), facingOf(e));
  const { w, d } = localSize(rectOf(e), facingOf(e));
  const body = fabric(key(e, "color", "execOlive"));
  const pad = fabric(key(e, "colorSeat", "execOliveSeat"));
  shadow(g, w, d, 0.16);
  const b = new Baker();
  const deckH = 8.6, armW = w * 0.14, backD = d * 0.16;
  b.add(rbox(w, deckH, d, body, 0, 2.6, 0, 3, 3)); //                                   deck
  b.add(rbox(w, 19.5, backD, body, 0, 2.6, d / 2 - backD / 2, 3.6, 3)); //              back shell
  // WINGS: the shaped ears that make it a wing chair rather than a tub
  for (const s of [-1, 1])
    b.add(rbox(armW * 0.9, 13.5, d * 0.30, body, s * (w / 2 - armW * 0.45), 8.6, d / 2 - backD - d * 0.13, 2.6, 3));
  for (const s of [-1, 1])
    b.add(rbox(armW, 10.5, d - backD - 1.5, body, s * (w / 2 - armW / 2), 2.6, -backD / 2 - 0.5, 2.8, 3)); // rolled arms
  b.add(rbox(w - 2 * armW - 2.0, EXEC_LOUNGE_CHAIR.cushionTop - deckH - 2.6 + 2.6, d - backD - 3.0, pad,
    0, deckH + 2.6 - (EXEC_LOUNGE_CHAIR.cushionTop - deckH - 2.6 + 2.6) + EXEC_LOUNGE_CHAIR.cushionTop - deckH - 2.6, -backD / 2 - 0.4, 2.0, 3));
  const bc = rbox(w - 2 * armW - 3.0, 11.5, 3.8, pad, 0, deckH + 3.4, d / 2 - backD - 1.6, 2.4, 3);
  bc.rotation.x = 0.1;
  b.add(bc);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const leg = lathe([[1.5, 0], [1.4, 1.0], [0.9, 3.4], [1.1, 4.2], [0, 4.2]], walnut(), sx * (w / 2 - 3.4), 0, sz * (d / 2 - 3.4), 10);
      b.add(leg);
    }
  b.bakeInto(g, "exec-lounge-chair");
  // a single cream cushion, as the reference shows
  const p = rbox(9.5, 3.4, 9.5, fabric("execCreamSeat"), w * 0.16, deckH + 5.6, -d * 0.08, 2, 3);
  p.rotation.y = -0.4;
  g.add(p);
  return g;
}

/** SOFA: the lounge's cream run. Built on the SHARED cushion arithmetic (sofaCushionZ /
 *  SOFA_CUSHION_LOCAL_X / SOFA_CUSHION_TOP), so the room's LoungeSeatSlots keep landing exactly on the
 *  cushions — but the piece itself is executive: a low tailored frame, square arms, welted cushions and a
 *  folded throw, instead of the plump lounge sofa the other rooms share. */
function execSofa(e: Entity): THREE.Group {
  const r = rectOf(e);
  const g = placed(r, "north");
  if (e.props.mirrored) g.rotation.y += Math.PI;
  const { w, d } = r;
  const body = fabric(key(e, "color", "execCream"));
  const pad = fabric(key(e, "colorSeat", "execCreamSeat"));
  const seats = Math.max(1, num(e, "seats", 3));
  shadow(g, w, d, 0.15);
  const b = new Baker();
  const deckH = 8.0, backW = 9, armW = SOFA_ARM_W;
  b.add(rbox(w, deckH, d, body, 0, 2.4, 0, 2.2, 3)); //                             deck
  b.add(rbox(backW, 17.5, d - 1, body, -w / 2 + backW / 2, 2.4, 0, 2.4, 3)); //     back panel
  for (const s of [-1, 1])
    b.add(rbox(w - backW + 1, 12.5, armW, body, backW / 2, 2.4, s * (d / 2 - armW / 2), 1.8, 3)); // square arms
  const cushD = (d - 2 * armW - (seats - 1) * SOFA_CUSHION_GAP - 2 * SOFA_CUSHION_MARGIN) / seats;
  for (let i = 0; i < seats; i++) {
    const lz = sofaCushionZ(i, seats, cushD);
    b.add(rbox(w - backW - 1.5, 5.6, cushD, pad, SOFA_CUSHION_LOCAL_X, deckH + 2, lz, 1.6, 3)); // seat → top 15.6
    const bk = rbox(5.6, 12, cushD - 1, pad, -w / 2 + backW + 1.8, deckH + 2, lz, 1.8, 3);
    bk.rotation.z = -0.1;
    b.add(bk);
    b.add(rbox(w - backW - 2.6, 0.5, cushD - 1.2, mat("execRugBorder", 0.95), SOFA_CUSHION_LOCAL_X, deckH + 7.6, lz, 0.2)); // welt
  }
  for (let i = 0; i < 4; i++)
    b.add(cyl(1.0, 2.4, walnut(), (i % 2 ? 1 : -1) * (w / 2 - 3), 0, (i < 2 ? 1 : -1) * (d / 2 - 4), 0.8));
  b.bakeInto(g, "exec-sofa");
  // a folded throw over one arm and two cushions — the reference's only softness
  const throwM = fabric("execCreamSeat");
  const th = rbox(w - backW - 4, 1.4, 13, throwM, SOFA_CUSHION_LOCAL_X, deckH + 7.8, -d * 0.34, 0.8, 3);
  th.rotation.z = 0.04;
  g.add(th);
  for (const s of [-1, 1]) {
    const p = rbox(9, 3.2, 9, throwM, SOFA_CUSHION_LOCAL_X - 1.5, deckH + 8.0, s * d * 0.31, 2, 3);
    p.rotation.y = s * 0.4;
    g.add(p);
  }
  return g;
}

/** COFFEE TABLE: a dark walnut block on a recessed plinth, with the reference's tray, book and plant. */
function execCoffeeTable(e: Entity): THREE.Group {
  const r = rectOf(e);
  const g = placed(r, "north");
  const { w, d } = r;
  const h = 15;
  shadow(g, w, d, 0.18);
  const b = new Baker();
  b.add(rbox(w - 7, h - 3.4, d - 7, walnutDark(), 0, 0, 0, 0.8)); //     recessed plinth
  b.add(rbox(w, 3.4, d, walnut(), 0, h - 3.4, 0, 0.7)); //               thick top
  b.add(rbox(w - 1.6, 0.6, d - 1.6, walnutDark(), 0, h - 3.9, 0, 0.25)); // shadow reveal under it
  b.bakeInto(g, "exec-coffee-table");
  // dressing: a dark tray with two books, and a low plant
  g.add(rbox(15, 0.7, 11, mat("execWalnutDark", 0.5), -w * 0.14, h, d * 0.2, 0.4)); //          tray
  g.add(rbox(12, 0.8, 8.4, mat("execCreamSeat", 0.9), -w * 0.14, h + 0.7, d * 0.2, 0.3)); //    two books,
  g.add(rbox(10.4, 0.7, 7.2, mat("execRugBorder", 0.9), -w * 0.12, h + 1.5, d * 0.21, 0.3)); // restrained
  g.add(deskPlant(w * 0.05, h, -d * 0.22, 4.2));
  return g;
}

/** A small potted plant: the one on every executive desk and on the coffee table. Four leaf blades on a
 *  short stem in a dark pot — five meshes, not a tree. */
export function deskPlant(cx: number, y0: number, cz: number, r: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(cx, y0, cz);
  g.add(lathe([[r * 0.72, 0], [r * 0.82, 0.4], [r, r * 1.5], [r * 0.92, r * 1.5]], mat("execWalnutDark", 0.7), 0, 0, 0, 14));
  const geo = leafGeometry();
  for (let i = 0; i < 12; i++) {
    const leaf = new THREE.Mesh(geo, foliage(i % 2 === 0));
    const a = (i / 12) * Math.PI * 2 + rnd() * 0.5;
    leaf.position.set(Math.cos(a) * r * 0.25, r * 1.45, Math.sin(a) * r * 0.25);
    leaf.rotation.set(-0.8 - rnd() * 0.6, a, 0);
    leaf.scale.setScalar(r * (0.62 + rnd() * 0.3));
    g.add(leaf);
  }
  return g;
}

/** PLANTER: the dark round pots that stand at the sofa ends in the reference. */
function execPlanter(e: Entity, sway: SwayNode[]): THREE.Group {
  const g = new THREE.Group();
  g.position.set(e.transform.pos.x, 0, e.transform.pos.z);
  const r = num(e, "r", 9);
  shadow(g, r * 2.3, r * 2.3, 0.16);
  g.add(lathe([[r * 0.7, 0], [r * 0.8, 1], [r, r * 1.2], [r * 0.98, r * 1.45], [r * 0.9, r * 1.45], [r * 0.86, r * 1.3]],
    mat("execWalnutDark", 0.55), 0, 0, 0, 18));
  const crown = new THREE.Group();
  crown.position.y = r * 1.4;
  g.add(crown);
  sway.push({ obj: crown, axis: "x", amp: 0.012, freq: 0.6 + rnd() * 0.2, phase: rnd() * Math.PI * 2, base: 0 });
  // A pot read from directly overhead is almost all canopy, so the shrub gets enough blades to fill the
  // rim in plan as well as in elevation — a sparse crown reads as an empty pot from the game camera.
  const geo = leafGeometry();
  for (let i = 0; i < 22; i++) {
    const leaf = new THREE.Mesh(geo, foliage(i % 3 === 0));
    const a = (i / 22) * Math.PI * 2 + rnd() * 0.5;
    const out = 0.18 + rnd() * 0.42;
    leaf.rotation.set(-0.55 - rnd() * 0.75, a, 0);
    leaf.position.set(Math.cos(a) * r * out, rnd() * r * 0.35, Math.sin(a) * r * out);
    leaf.scale.setScalar(r * (0.62 + rnd() * 0.34));
    crown.add(leaf);
  }
  return g;
}

/** RUG: deliberately the plainest object in the room. A low cream pile with one restrained inset border
 *  a half-tone darker — no graphic, no glow, no colour. The reference's rugs exist to define a zone on
 *  the tiled floor and nothing else, which is exactly why they must not look like the Gaming Room's. */
function execRug(e: Entity): THREE.Group {
  const r = rectOf(e);
  const g = placed(r, "north");
  const { w, d } = r;
  const pile = mat(key(e, "color", "execRug"), 1);
  const base = rbox(w, 0.7, d, pile, 0, 0, 0, 1.4);
  base.castShadow = false;
  g.add(base);
  const border = mat(key(e, "accent", "execRugBorder"), 1);
  const t = 1.4, inset = 6;
  for (const [bw, bd, bx, bz] of [
    [w - inset * 2, t, 0, -(d / 2 - inset)], [w - inset * 2, t, 0, d / 2 - inset],
    [t, d - inset * 2, -(w / 2 - inset), 0], [t, d - inset * 2, w / 2 - inset, 0],
  ] as const) {
    const line = rbox(bw, 0.12, bd, border, bx, 0.7, bz, 0.1);
    line.castShadow = line.receiveShadow = false;
    g.add(line);
  }
  return g;
}

// ---- nameplate -------------------------------------------------------------------------------------
/** The engraved desk nameplate the reference puts on every executive desk. Brass lettering on a dark
 *  plate; without a canvas (tests) it falls back to the plain plate, which is the honest degradation. */
export function nameplate(text: string, cx: number, y0: number, cz: number, w = 34, h = 7): THREE.Group {
  const g = new THREE.Group();
  g.add(rbox(w, 1.6, h, mat("execWalnutDark", 0.5), cx, y0, cz, 0.4));
  const ctx = canvas2d(256, 64);
  if (ctx) {
    ctx.fillStyle = "#211a15";
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = "#c9a468";
    ctx.font = "bold 30px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 128, 34);
    const tex = new THREE.CanvasTexture(ctx.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w - 1.6, h - 1.4),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0.1 }));
    face.rotation.x = -Math.PI / 2;
    face.position.set(cx, y0 + 1.62, cz);
    face.castShadow = false;
    g.add(face);
  }
  return g;
}

/** A desk organiser: a small walnut caddy with brass-tipped pens, as the close reference shows. */
export function deskOrganiser(cx: number, y0: number, cz: number): THREE.Group {
  const g = new THREE.Group();
  const b = new Baker();
  b.add(rbox(13, 4.4, 9, walnut(), cx, y0, cz, 0.4));
  b.add(rbox(11.4, 3.0, 7.4, walnutDark(), cx, y0 + 1.2, cz, 0.3));
  b.bakeInto(g, "desk-organiser");
  for (let i = 0; i < 4; i++) {
    const p = cyl(0.32, 7.5, i % 2 ? brass() : mat("execWalnutDark", 0.5), cx + 2.2 + i * 1.5, y0 + 3.2, cz - 1.2);
    p.rotation.z = 0.1 - i * 0.05;
    g.add(p);
  }
  return g;
}

/** The reference's brass desk lamp: a weighted disc base, a slim stem and a tilted dome shade. */
export function brassDeskLamp(cx: number, y0: number, cz: number, lean: 1 | -1): THREE.Group {
  const g = new THREE.Group();
  const m = brass();
  g.add(cyl(3.6, 0.9, m, cx, y0, cz, 3.8));
  g.add(cyl(0.55, 13.5, m, cx, y0 + 0.9, cz));
  const arm = rbox(9.5, 0.7, 0.7, m, cx + lean * 4.0, y0 + 13.9, cz, 0.3);
  g.add(arm);
  const shade = lathe([[0, 0], [4.4, 0], [4.0, 3.6], [1.0, 4.6], [0, 4.6]], m, cx + lean * 8.2, y0 + 9.6, cz, 16);
  shade.rotation.x = Math.PI;
  shade.position.y = y0 + 14.2;
  g.add(shade);
  return g;
}

/** The dark leather desk MAT the reference lays under the laptop and monitor. */
export function deskMat(cx: number, y0: number, cz: number, w: number, d: number): THREE.Mesh {
  const m = rbox(w, 0.35, d, mat("execLeather", 0.72), cx, y0, cz, 0.4);
  m.castShadow = false;
  return m;
}

/** Router for build/registry.ts: returns null for anything this module does not own. */
export function buildExecFurniture(e: Entity, sway: SwayNode[]): THREE.Group | null {
  switch (e.kind as ExecKind) {
    case "exec-chair": return execChair(e, true);
    case "exec-task-chair": return execChair(e, false);
    case "exec-visitor-chair": return execVisitorChair(e);
    case "exec-lounge-chair": return execLoungeChair(e);
    case "exec-sofa": return execSofa(e);
    case "exec-coffee-table": return execCoffeeTable(e);
    case "exec-planter": return execPlanter(e, sway);
    case "exec-rug": return execRug(e);
    default: return null;
  }
}
