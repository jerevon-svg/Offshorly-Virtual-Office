// vo3d build — CMS ROOM FURNITURE. Room-specific geometry, not a re-skin.
//
// WHY ITS OWN MODULE. The same reason build/exec-furniture.ts exists: the shared catalogue in
// build/furniture.ts carries the Design Room's, Reception's and Gaming's identity — pale-oak tops, white
// pods, olive cushions, black gaming shells — and recolouring them does not make the content team's room,
// because the SILHOUETTES are wrong. The four separated V1 assets say precisely what these pieces are:
//
//   cms-lead-desk.png    a BOW-FRONTED oak top on a wrapped blue base, monitor, black task lamp, pen cup
//   cms-lead-chair.png   a blue seat and a separate floating blue back on a pale tubular sled with arms
//   cms-member-desk.png  an oak top with a SLATE PRIVACY SCREEN pinned with notes, a blue three-drawer
//                        pedestal one side and slim round legs the other, laptop / plant / clock / bottle
//   cms-member-chair.png a blue barrel task chair, pale wrapped arms, five-star polished base
//
// Each is rebuilt here as real geometry at that description. What IS reused is the arithmetic and the
// helpers: the sofa's cushion constants (so the room's LoungeSeatSlot data stays exactly the geometry it
// sits on), Baker/rbox/cyl/lathe, the material cache, the placed()/localSize() facing convention and
// build/props' laptop and monitor.
//
// This module imports NOTHING from rooms/ — rooms/cms.ts reads its metrics, and build/cms.ts (the room's
// static fit-out) reads rooms/cms.ts. One direction, no cycle.
import * as THREE from "three";
import type { Entity } from "../world/WorldState";
import type { Facing } from "../core/coords";
import { Baker, cyl, lathe, placed, localSize, rbox, rnd, sphereGeo } from "./helpers";
import { contactShadowMat, fabric, mat, plastic, type MatKey } from "../render/Materials";
import { foliage, leafGeometry } from "./plants";
import { book, laptop, monitor } from "./props";
import { SOFA_CUSHION_GAP, SOFA_CUSHION_MARGIN, SOFA_ARM_W, sofaCushionZ } from "./furniture";

/** The entity kinds this module builds. build/registry.ts routes them here. */
export const CMS_KINDS = [
  "cms-lead-desk", "cms-member-desk", "cms-lead-chair", "cms-task-chair",
  "cms-sofa", "cms-pouf", "cms-round-table", "cms-rug",
] as const;
export type CmsKind = (typeof CMS_KINDS)[number];

/** Seat-contact planes, EXPORTED so rooms/cms.ts derives its seat metadata from the same numbers the
 *  meshes use and the two can never drift. */
export const CMS_TASK_CHAIR = { cushionTop: 14.6, cushionLocalZ: 0.3 };
export const CMS_LEAD_CHAIR = { cushionTop: 15.0, cushionLocalZ: 0.4 };
export const CMS_SOFA = { cushionTop: 15.2, cushionLocalX: 5.0 };
export const CMS_POUF = { cushionTop: 13.4, contactLocalZ: 0.8 };
/** work-surface height, shared by both desk builders and by build/cms.ts when it dresses them */
export const CMS_DESK_TOP = 24;

// ---- helpers --------------------------------------------------------------------------------------
const key = (e: Entity, prop: string, fallback: MatKey): MatKey => (typeof e.props[prop] === "string" ? (e.props[prop] as MatKey) : fallback);
const num = (e: Entity, prop: string, fallback: number): number => (typeof e.props[prop] === "number" ? (e.props[prop] as number) : fallback);
const rectOf = (e: Entity) => {
  const w = num(e, "w", 24), d = num(e, "d", 24);
  return { x: e.transform.pos.x - w / 2, z: e.transform.pos.z - d / 2, w, d };
};
const facingOf = (e: Entity): Facing => (typeof e.props.facing === "string" ? (e.props.facing as Facing) : "north");
/** flat contact shadow under a piece — the same device every other room's furniture uses */
function shadow(g: THREE.Group, w: number, d: number, o = 0.15): void {
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.08, d * 1.08), contactShadowMat(o));
  p.rotation.x = -Math.PI / 2;
  p.position.y = 0.06;
  p.castShadow = p.receiveShadow = false;
  g.add(p);
}
const oak = (k?: MatKey) => mat(k ?? "cmsOak", 0.62);
const oakDark = (k?: MatKey) => mat(k ?? "cmsOakDark", 0.72);
const blue = (k?: MatKey) => mat(k ?? "cmsBlue", 0.7);
const blueDeep = (k?: MatKey) => mat(k ?? "cmsBlueDeep", 0.72);
const frameMat = (k?: MatKey) => mat(k ?? "cmsFrame", 0.42, { metalness: 0.35 });
const rubber = () => mat("charcoal", 0.85);

/** The coloured sticky notes that are this room's running motif — on the privacy screens, the whiteboard
 *  and the east wall board. Six squares on a face, deterministic, two meshes each. */
export const STICKY_COLOURS: MatKey[] = ["neonCyan", "coveWarm", "neonPink", "readyGreen", "cmsBlue", "gateLed"];
export function stickyNotes(b: Baker, count: number, x0: number, x1: number, y: number, z: number, size: number, plane: "xy" | "zy" = "xy"): void {
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const along = x0 + (x1 - x0) * t;
    const m = mat(STICKY_COLOURS[i % STICKY_COLOURS.length], 0.95);
    const jitter = (rnd() - 0.5) * size * 0.35;
    b.add(plane === "xy"
      ? rbox(size, size, 0.25, m, along, y + jitter, z, 0.12)
      : rbox(0.25, size, size, m, z, y + jitter, along, 0.12));
  }
}

// ---- desks -----------------------------------------------------------------------------------------
/** MEMBER DESK. The asset's four defining parts, in order: the oak top, the slate privacy screen standing
 *  on its far edge with notes pinned to it, the blue three-drawer pedestal under one end, and the slim
 *  round legs under the other. Dressed with the laptop, plant, clock, bottle and notepad the art shows. */
function memberDesk(e: Entity): THREE.Group {
  const r = rectOf(e);
  const g = placed(r, facingOf(e));
  const { w, d } = localSize(r, facingOf(e));
  const h = num(e, "h", CMS_DESK_TOP);
  const top = oak(key(e, "color", "cmsOak"));
  const ped = blueDeep(key(e, "accent", "cmsBlueDeep"));
  shadow(g, w, d, 0.16);
  const b = new Baker();
  // TOP: a 2.2 slab with a darker edge band, so it reads as a real worktop from eye level
  b.add(rbox(w, 2.2, d, top, 0, h - 2.2, 0, 0.5));
  b.add(rbox(w + 0.5, 0.6, d + 0.5, oakDark(), 0, h - 2.6, 0, 0.25));
  // PEDESTAL: three drawers with pale pulls, under the RIGHT end (local +x), as the art draws it
  const pw = 11, pd = d - 4, px = w / 2 - pw / 2 - 1.2;
  b.add(rbox(pw, h - 4.2, pd, ped, px, 2.0, 0, 0.6));
  for (let i = 0; i < 3; i++) {
    const y = 4.4 + i * ((h - 8) / 3);
    b.add(rbox(pw + 0.3, 0.5, pd + 0.3, blue(), px, y + (h - 8) / 3 - 0.5, 0, 0.15)); // drawer reveal
    b.add(rbox(0.9, 0.7, 5.2, plastic("white"), px + pw / 2 - 0.2, y + 2.2, 0, 0.25)); // pull
  }
  // LEGS: two slim round posts under the left end
  for (const s of [-1, 1]) b.add(cyl(0.9, h - 2.2, frameMat(), -w / 2 + 2.4, 0, s * (d / 2 - 3.2)));
  b.add(rbox(3.4, 1.0, d - 5, frameMat(), -w / 2 + 2.4, 0, 0, 0.3)); // its foot rail
  b.bakeInto(g, "cms-member-desk");
  // PRIVACY SCREEN on the FAR (local −z) edge, with the art's pinned notes on the desk side
  const sc = new Baker();
  const screenM = fabric(key(e, "screen", "cmsScreen"));
  const scH = 14, scZ = -d / 2 + 1.4;
  sc.add(rbox(w - 1, scH, 2.4, screenM, 0, h - 1.2, scZ, 0.8));
  sc.add(rbox(w - 1, 0.9, 3.0, frameMat(), 0, h - 1.2 + scH - 0.9, scZ, 0.3)); // capping rail
  stickyNotes(sc, 6, -w / 2 + 5, w / 2 - 5, h + 3.5, scZ + 1.4, 2.6);
  sc.bakeInto(g, "cms-member-screen");
  // DRESSING, straight off the asset
  g.add(laptop(-1.0, h, 1.4));
  deskPot(g, -w / 2 + 5.5, h, -d / 2 + 6.5, 2.0);
  const kit = new Baker();
  kit.add(rbox(3.4, 2.2, 1.8, mat("charcoal", 0.6), -w / 2 + 4.0, h, d / 2 - 4.2, 0.3)); //   desk clock
  kit.add(rbox(2.9, 1.0, 1.4, mat("readyGreen", 0.4), -w / 2 + 4.0, h + 0.6, d / 2 - 4.9, 0.1));
  kit.bakeInto(g, "cms-desk-clock");
  g.add(cyl(1.5, 5.4, blueDeep(), w / 2 - 8.0, h, -d / 2 + 6.0, 1.35)); //                     water bottle
  g.add(cyl(1.2, 0.9, mat("charcoal", 0.5), w / 2 - 8.0, h + 5.4, -d / 2 + 6.0));
  g.add(book(w / 2 - 7.0, h, d / 2 - 5.0, 5.0, 6.4, "cmsBlueDeep", 0.12)); //                  notepad
  return g;
}

/** LEAD DESK. The asset is a BOW-FRONTED oak top whose blue base wraps the curve — that bow is the whole
 *  difference between this and a member desk, so it is built as real geometry: a rectangular back slab
 *  plus a flattened half-round lobe at the front, both repeated in the base below. */
function leadDesk(e: Entity): THREE.Group {
  const r = rectOf(e);
  const g = placed(r, facingOf(e));
  const { w, d } = localSize(r, facingOf(e));
  const h = num(e, "h", CMS_DESK_TOP);
  const top = oak(key(e, "color", "cmsOak"));
  const base = blueDeep(key(e, "accent", "cmsBlueDeep"));
  shadow(g, w, d * 1.05, 0.17);
  const backD = d * 0.58, lobeZ = d / 2 - d * 0.42;
  /** the bow: a cylinder squashed in z so the front edge sweeps the full width */
  const bow = (rad: number, th: number, m: THREE.Material, y0: number, z: number, squash: number): THREE.Mesh => {
    const c = cyl(rad, th, m, 0, y0, z);
    c.scale.z *= squash;
    return c;
  };
  const g1 = new THREE.Group();
  // BASE: the wrapped blue drum, held 2 off the floor on a recessed dark plinth
  g1.add(rbox(w - 2, h - 5.0, backD, base, 0, 2.4, -d / 2 + backD / 2, 1.2));
  g1.add(bow(w / 2 - 1, h - 5.0, base, 2.4, lobeZ, (d * 0.42) / (w / 2 - 1)));
  g1.add(rbox(w - 7, 2.4, d - 6, mat("charcoal", 0.8), 0, 0, 0, 0.4)); // recessed plinth
  // TOP: the oak slab, proud of the base all round, with a darker edge
  g1.add(rbox(w, 2.4, backD + 1.6, top, 0, h - 2.4, -d / 2 + (backD + 1.6) / 2, 0.7));
  g1.add(bow(w / 2 + 1.0, 2.4, top, h - 2.4, lobeZ, (d * 0.42 + 1.0) / (w / 2 + 1.0)));
  for (const m of g1.children) (m as THREE.Mesh).castShadow = true;
  g.add(g1);
  // DRESSING, straight off the asset: monitor centred, black task lamp and pen cup left, notebook right
  g.add(monitor(0, h, -d / 2 + 8.0, 17, 9.5));
  taskLamp(g, -w / 2 + 7.0, h, -d / 2 + 7.0);
  g.add(cyl(2.0, 4.6, blueDeep(), -w / 2 + 8.5, h, -d / 2 + 15.0, 1.9)); //   pen cup
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const pen = cyl(0.28, 6.0, mat(i % 2 ? "charcoal" : "cmsBlue", 0.5), -w / 2 + 8.5 + Math.cos(a) * 0.8, h + 3.4, -d / 2 + 15.0 + Math.sin(a) * 0.8);
    pen.rotation.z = Math.cos(a) * 0.18;
    g.add(pen);
  }
  g.add(book(w / 2 - 9.0, h, -d / 2 + 8.0, 7.5, 9.5, "cmsBlue", -0.1)); //    notebook
  g.add(book(w / 2 - 8.0, h, -d / 2 + 17.0, 6.0, 4.0, "cmsBlueDeep", 0.2)); // phone
  return g;
}

/** the black angle-poise the lead-desk asset puts on its left corner */
function taskLamp(g: THREE.Group, cx: number, y0: number, cz: number): void {
  const m = mat("charcoal", 0.5);
  const b = new Baker();
  b.add(cyl(2.6, 0.9, m, cx, y0, cz, 2.3));
  b.add(cyl(0.55, 7.5, m, cx, y0 + 0.9, cz));
  const arm = rbox(0.7, 6.6, 0.7, m, cx, y0 + 7.6, cz, 0.2);
  arm.rotation.x = 0.55;
  b.add(arm);
  const head = cyl(1.9, 3.0, m, cx, y0 + 12.2, cz + 3.0, 1.1);
  head.rotation.x = 2.5;
  b.add(head);
  b.bakeInto(g, "cms-task-lamp");
}

/** the small potted succulent on every member desk and on the coffee table */
function deskPot(g: THREE.Group, cx: number, y0: number, cz: number, r: number): void {
  const p = new THREE.Group();
  p.position.set(cx, y0, cz);
  p.add(lathe([[r * 0.7, 0], [r * 0.8, 0.4], [r, r * 1.4], [r * 0.92, r * 1.4]], plastic("white"), 0, 0, 0, 14));
  const geo = leafGeometry();
  for (let i = 0; i < 11; i++) {
    const leaf = new THREE.Mesh(geo, foliage(i % 2 === 0));
    const a = (i / 11) * Math.PI * 2 + rnd() * 0.5;
    leaf.position.set(Math.cos(a) * r * 0.25, r * 1.35, Math.sin(a) * r * 0.25);
    leaf.rotation.set(-0.85 - rnd() * 0.6, a, 0);
    leaf.scale.setScalar(r * (0.7 + rnd() * 0.3));
    p.add(leaf);
  }
  g.add(p);
}

// ---- chairs ----------------------------------------------------------------------------------------
/** TASK CHAIR (cms-member-chair.png): a blue barrel seat with a low wrapped back, pale arms with dark
 *  pads looping from the back to the front, on a five-star polished base with black casters. The barrel
 *  is what makes it read as THIS chair and not as the white pods next door. */
function taskChair(e: Entity): THREE.Group {
  const r = rectOf(e);
  const g = placed(r, facingOf(e));
  const { w, d } = localSize(r, facingOf(e));
  const hide = fabric(key(e, "color", "cmsSeat"));
  const fr = frameMat(key(e, "frame", "cmsFrame"));
  shadow(g, w * 0.95, d * 0.95, 0.16);
  const b = new Baker();
  const seatW = Math.min(w, d) * 0.82, seatTop = CMS_TASK_CHAIR.cushionTop;
  // five-star base + casters
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.35, spread = seatW * 0.52;
    const arm = rbox(spread, 1.3, 1.7, fr, 0, 1.5, 0, 0.5);
    arm.position.set(Math.cos(a) * spread * 0.5, 2.0, Math.sin(a) * spread * 0.5);
    arm.rotation.y = -a;
    b.add(arm);
    const caster = new THREE.Mesh(sphereGeo, rubber());
    caster.scale.setScalar(1.15);
    caster.position.set(Math.cos(a) * spread * 0.97, 1.15, Math.sin(a) * spread * 0.97);
    b.add(caster as unknown as THREE.Mesh);
  }
  b.add(cyl(1.9, 0.9, fr, 0, 2.9, 0));
  b.add(cyl(1.3, seatTop - 6.4, fr, 0, 3.8, 0)); // gas lift
  b.add(cyl(2.0, 0.8, fr, 0, seatTop - 2.6, 0));
  // BARREL: a squat drum of upholstery with a dished seat sunk into its top
  b.add(lathe([[seatW * 0.40, 0], [seatW * 0.50, 1.2], [seatW * 0.52, 4.4], [seatW * 0.50, 5.2], [0, 5.2]],
    hide, 0, seatTop - 5.2, 0, 20));
  b.add(cyl(seatW * 0.46, 1.2, fabric(key(e, "color", "cmsSeat")), 0, seatTop - 1.1, 0, seatW * 0.49));
  // low wrapped BACK, reclined a touch
  const back = new THREE.Group();
  back.position.set(0, seatTop - 1.0, d * 0.30);
  back.rotation.x = -0.16;
  g.add(back);
  const bb = new Baker();
  bb.add(rbox(seatW * 0.96, 7.4, 2.6, hide, 0, 0, 0, 1.6, 3));
  bb.add(rbox(seatW * 0.86, 2.0, 3.0, hide, 0, 6.2, -0.3, 1.0, 3)); // rolled top edge
  bb.bakeInto(back, "cms-task-back");
  // ARMS: a pale loop each side with a dark pad on top
  for (const s of [-1, 1]) {
    const loop = rbox(1.5, 7.6, 1.5, fr, s * (seatW * 0.54), seatTop - 4.4, d * 0.10, 0.5);
    loop.rotation.z = -s * 0.10;
    b.add(loop);
    b.add(rbox(2.0, 1.4, d * 0.42, fr, s * (seatW * 0.56), seatTop + 3.0, -d * 0.02, 0.6));
    b.add(rbox(1.4, 0.8, d * 0.30, mat("charcoal", 0.7), s * (seatW * 0.56), seatTop + 4.4, -d * 0.02, 0.35));
  }
  b.bakeInto(g, "cms-task-chair");
  return g;
}

/** LEAD CHAIR (cms-lead-chair.png): a square blue seat and a SEPARATE floating blue back, carried on a
 *  pale tubular sled whose arms run continuously from the back posts to the front legs, on small casters.
 *  The gap between seat and back is the asset's signature and is built, not implied. */
function leadChair(e: Entity): THREE.Group {
  const r = rectOf(e);
  const g = placed(r, facingOf(e));
  const { w, d } = localSize(r, facingOf(e));
  const hide = fabric(key(e, "color", "cmsSeatLead"));
  const fr = frameMat(key(e, "frame", "cmsFrame"));
  shadow(g, w * 0.98, d * 0.98, 0.16);
  const b = new Baker();
  const seatTop = CMS_LEAD_CHAIR.cushionTop, seatW = w * 0.78, seatD = d * 0.70;
  // four tubular legs on casters
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const lx = sx * (seatW / 2 - 0.4), lz = sz * (seatD / 2 - 0.4);
    b.add(cyl(0.8, seatTop - 3.2, fr, lx, 2.0, lz));
    const caster = new THREE.Mesh(sphereGeo, rubber());
    caster.scale.setScalar(1.1);
    caster.position.set(lx, 1.1, lz);
    b.add(caster as unknown as THREE.Mesh);
  }
  // seat frame rails + the seat pad itself
  for (const sz of [-1, 1]) b.add(rbox(seatW, 1.1, 1.1, fr, 0, seatTop - 3.4, sz * (seatD / 2 - 0.4), 0.4));
  b.add(rbox(seatW - 0.8, 1.8, seatD - 0.8, fr, 0, seatTop - 3.4, 0, 0.5));
  b.add(rbox(seatW - 1.0, 3.0, seatD - 1.0, hide, 0, seatTop - 3.0, 0, 1.4, 3));
  // BACK: a floating rounded panel on two posts, with the asset's clear gap under it
  for (const sx of [-1, 1]) b.add(cyl(0.7, 9.5, fr, sx * (seatW / 2 - 1.4), seatTop - 1.2, seatD / 2 - 0.8));
  const back = new THREE.Group();
  back.position.set(0, seatTop + 5.4, seatD / 2 - 1.0);
  back.rotation.x = -0.14;
  g.add(back);
  const bb = new Baker();
  bb.add(rbox(seatW * 0.96, 8.2, 2.8, hide, 0, 0, 0, 2.2, 3));
  bb.bakeInto(back, "cms-lead-back");
  // ARMS: one continuous pale loop each side, back post → armrest → front leg
  for (const sx of [-1, 1]) {
    b.add(rbox(1.3, 1.3, seatD - 1.0, fr, sx * (seatW / 2 + 0.7), seatTop + 3.4, -0.2, 0.5));
    b.add(cyl(0.65, 4.6, fr, sx * (seatW / 2 + 0.7), seatTop - 1.2, -seatD / 2 + 0.6));
    b.add(cyl(0.65, 5.8, fr, sx * (seatW / 2 + 0.7), seatTop - 1.2, seatD / 2 - 0.8));
  }
  b.bakeInto(g, "cms-lead-chair");
  return g;
}

// ---- lounge ----------------------------------------------------------------------------------------
/** SOFA: the reference's chunky blue three-seater — a deep deck, a low square back, square arms, three
 *  cushions and the navy and white scatter pillows the render puts on it. Authored back-to-WEST with its
 *  long axis in local z, so rooms/cms.ts places it with no rotation at all. */
function cmsSofa(e: Entity): THREE.Group {
  const r = rectOf(e);
  const g = placed(r, "north");
  const { w, d } = r;
  const body = fabric(key(e, "color", "cmsSofa"));
  const pad = fabric(key(e, "colorSeat", "cmsSofaSeat"));
  const seats = Math.max(1, num(e, "seats", 3));
  shadow(g, w, d, 0.15);
  const b = new Baker();
  const deckH = 7.4, backW = 8.0, armW = SOFA_ARM_W;
  b.add(rbox(w, deckH, d, body, 0, 2.0, 0, 2.0, 3)); //                                deck
  b.add(rbox(backW, 16.0, d - 1, body, -w / 2 + backW / 2, 2.0, 0, 2.2, 3)); //        back
  for (const s of [-1, 1])
    b.add(rbox(w - backW + 1, 11.5, armW, body, backW / 2, 2.0, s * (d / 2 - armW / 2), 1.8, 3)); // arms
  const cushD = (d - 2 * armW - (seats - 1) * SOFA_CUSHION_GAP - 2 * SOFA_CUSHION_MARGIN) / seats;
  for (let i = 0; i < seats; i++) {
    const lz = sofaCushionZ(i, seats, cushD);
    b.add(rbox(w - backW - 1.4, 5.8, cushD, pad, CMS_SOFA.cushionLocalX, deckH + 2.0, lz, 1.5, 3)); // → top 15.2
    const bk = rbox(5.2, 11.0, cushD - 1, pad, -w / 2 + backW + 1.6, deckH + 2.0, lz, 1.7, 3);
    bk.rotation.z = -0.1;
    b.add(bk);
  }
  for (let i = 0; i < 4; i++)
    b.add(cyl(0.9, 2.0, mat("cmsOakDark", 0.7), (i % 2 ? 1 : -1) * (w / 2 - 3), 0, (i < 2 ? 1 : -1) * (d / 2 - 4), 0.75));
  b.bakeInto(g, "cms-sofa");
  // scatter pillows: two navy and one white, exactly the render's three
  for (const [key2, lz, tilt] of [["cmsNavy", -d * 0.30, 0.42], ["white", -d * 0.14, -0.35], ["cmsNavy", d * 0.30, 0.30]] as const) {
    const p = rbox(8.5, 3.0, 8.5, fabric(key2 as MatKey), CMS_SOFA.cushionLocalX - 2.0, deckH + 7.8, lz, 2.0, 3);
    p.rotation.y = tilt;
    p.rotation.z = 0.12;
    g.add(p);
  }
  return g;
}

/** POUF: the deep navy barrel lounge chair in the corner of the rug. The art's whole character is the
 *  RADIAL PLEATING of its shell, so the ribs are real geometry around a lathed drum with a dished seat. */
function cmsPouf(e: Entity): THREE.Group {
  const g = placed(rectOf(e), facingOf(e));
  const r = num(e, "r", 12);
  const shell = fabric(key(e, "color", "cmsNavy"));
  shadow(g, r * 2.1, r * 2.1, 0.17);
  const b = new Baker();
  const h = 15.5;
  // drum: wide at the shoulder, drawn in at the base — the render's silhouette exactly
  b.add(lathe([[r * 0.80, 0], [r * 0.94, 2.0], [r, h * 0.62], [r * 0.97, h], [r * 0.62, h - 1.2], [r * 0.58, h * 0.5], [0, h * 0.42]],
    shell, 0, 0, 0, 26));
  // radial pleats around the back three-quarters; the front quarter is the opening
  const ribs = 16;
  for (let i = 0; i < ribs; i++) {
    const a = -Math.PI * 0.78 + (i / (ribs - 1)) * Math.PI * 1.56;
    const rib = rbox(1.9, h * 0.56, r * 0.30, shell, Math.sin(a) * r * 0.90, h * 0.44, Math.cos(a) * r * 0.90, 0.9, 3);
    rib.rotation.y = a;
    b.add(rib);
  }
  // the dished seat pad and its centre button
  b.add(cyl(r * 0.66, 2.4, shell, 0, CMS_POUF.cushionTop - 2.4, 0, r * 0.72));
  b.add(cyl(1.5, 0.7, fabric("cmsBlueDeep"), 0, CMS_POUF.cushionTop - 0.6, 0, 1.1));
  b.bakeInto(g, "cms-pouf");
  return g;
}

/** ROUND COFFEE TABLE: a light oak disc on three tapered legs, with the render's plant and open
 *  magazine on it. */
function cmsRoundTable(e: Entity): THREE.Group {
  const g = placed(rectOf(e), "north");
  const r = num(e, "r", 10);
  const top = oak(key(e, "color", "cmsOak"));
  const leg = oakDark(key(e, "accent", "cmsOakDark"));
  const h = 15;
  shadow(g, r * 2, r * 2, 0.15);
  const b = new Baker();
  b.add(cyl(r, 1.8, top, 0, h - 1.8, 0));
  b.add(cyl(r * 0.96, 0.5, leg, 0, h - 2.3, 0));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    const l = cyl(1.0, h - 2.3, leg, Math.cos(a) * r * 0.66, 0, Math.sin(a) * r * 0.66, 0.55);
    l.rotation.z = -Math.cos(a) * 0.10;
    l.rotation.x = Math.sin(a) * 0.10;
    b.add(l);
  }
  b.bakeInto(g, "cms-round-table");
  deskPot(g, -1.0, h, -1.6, 2.2);
  const mag = rbox(7.0, 0.5, 5.0, plastic("white"), 2.6, h, 3.2, 0.12);
  mag.rotation.y = 0.3;
  g.add(mag);
  const cover = rbox(3.2, 0.16, 4.2, mat("cmsBlue", 0.8), 1.3, h + 0.5, 3.2, 0.1);
  cover.rotation.y = 0.3;
  g.add(cover);
  return g;
}

/** RUG: the lounge's dusty blue square with one inset border line — the same flat, cheap, correct device
 *  the Executive Room's rugs use. */
function cmsRug(e: Entity): THREE.Group {
  const r = rectOf(e);
  const g = placed(r, "north");
  const { w, d } = r;
  const pile = mat(key(e, "color", "cmsRug"), 1);
  const base = rbox(w, 0.7, d, pile, 0, 0, 0, 1.4);
  base.castShadow = false;
  g.add(base);
  const border = mat(key(e, "accent", "cmsRugBorder"), 1);
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

export function buildCmsFurniture(e: Entity): THREE.Group | null {
  switch (e.kind as CmsKind) {
    case "cms-lead-desk": return leadDesk(e);
    case "cms-member-desk": return memberDesk(e);
    case "cms-lead-chair": return leadChair(e);
    case "cms-task-chair": return taskChair(e);
    case "cms-sofa": return cmsSofa(e);
    case "cms-pouf": return cmsPouf(e);
    case "cms-round-table": return cmsRoundTable(e);
    case "cms-rug": return cmsRug(e);
    default: return null;
  }
}
