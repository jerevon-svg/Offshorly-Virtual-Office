// vo3d build — QA ROOM FURNITURE. Room-specific geometry, not a re-skin.
//
// WHY ITS OWN MODULE, AND WHY IT MATTERS MOST HERE. The QA room is the ONLY room on the floor with no
// separated production assets at all — one flat PNG and nothing else. That makes borrowing another room's
// furniture the single easiest mistake available, and the one that would quietly cost the room its
// identity. So every piece below is modelled from what the flat reference actually DRAWS, at the near-
// top-down angle it is drawn at (which is why QA is the most legible plan on the floor):
//
//   the bench pods     TWO white laminate benches, each two places long, on slim tapered chrome legs, with
//                      a TEAL cross-rail splitting the two places and a TEAL privacy screen standing on the
//                      bench's inner edge. Dressed with laptops, notebooks, a pen tidy and one succulent.
//   the lead desk      the same white laminate in a single wide slab on a light OAK apron, with a laptop,
//                      a teal folder, a small plant and the "TEAM LEAD" plate the render puts on its edge.
//   the chairs         CREAM LINEN mid-back task chairs — a soft squared pad, a gently curved back, pale
//                      arms and a five-star base. The lead's is the same chair with a taller, plusher back.
//   the sofa           a deep cream three-seat with square arms, two scatter cushions (one TEAL, one
//                      cream) and short pale feet.
//   the pouf           a round deep-TEAL ottoman with radial button seaming — the one saturated object in
//                      the room, and what the whole palette is built around.
//   the coffee table   a round light OAK disc on three tapered legs, with a plant and an open magazine.
//   the rug            a plain oatmeal pile square with one inset border line.
//
// What IS reused is the arithmetic and the helpers: Baker/rbox/cyl/lathe, the material cache, the
// placed()/localSize() facing convention and build/props' laptop, book and mug.
//
// This module imports NOTHING from rooms/ — rooms/qa.ts reads its metrics, and build/qa.ts (the room's
// static fit-out) reads rooms/qa.ts. One direction, no cycle.
import * as THREE from "three";
import type { Entity } from "../world/WorldState";
import type { Facing } from "../core/coords";
import { Baker, cyl, lathe, placed, localSize, rbox, rnd, sphereGeo } from "./helpers";
import { contactShadowMat, fabric, mat, plastic, type MatKey } from "../render/Materials";
import { leafAnchor } from "./plants";
import { laptop, mug } from "./props";
import { SOFA_ARM_W, SOFA_CUSHION_GAP, SOFA_CUSHION_MARGIN, sofaCushionZ } from "./furniture";

/** The entity kinds this module builds. build/registry.ts routes them here. */
export const QA_KINDS = [
  "qa-bench-desk", "qa-lead-desk", "qa-lead-chair", "qa-task-chair",
  "qa-sofa", "qa-pouf", "qa-round-table", "qa-rug",
] as const;
export type QaKind = (typeof QA_KINDS)[number];

/** Seat-contact planes, EXPORTED so rooms/qa.ts derives its seat metadata from the same numbers the meshes
 *  use and the two can never drift. */
export const QA_TASK_CHAIR = { cushionTop: 14.4, cushionLocalZ: 0.3 };
export const QA_LEAD_CHAIR = { cushionTop: 15.0, cushionLocalZ: 0.4 };
export const QA_SOFA = { cushionTop: 15.2, cushionLocalX: 5.0 };
export const QA_POUF = { cushionTop: 13.2, contactLocalZ: 0.6 };
/** work-surface height, shared by both desk builders and by build/qa.ts when it dresses them */
export const QA_DESK_TOP = 24;
/** the teal privacy screen standing on a bench's inner edge — the pod art's signature part */
export const SCREEN_D = 3, SCREEN_H = 15;

// ---- helpers --------------------------------------------------------------------------------------
const key = (e: Entity, prop: string, fallback: MatKey): MatKey => (typeof e.props[prop] === "string" ? (e.props[prop] as MatKey) : fallback);
const num = (e: Entity, prop: string, fallback: number): number => (typeof e.props[prop] === "number" ? (e.props[prop] as number) : fallback);
const str = (e: Entity, prop: string, fallback: string): string => (typeof e.props[prop] === "string" ? (e.props[prop] as string) : fallback);
const rectOf = (e: Entity) => {
  const w = num(e, "w", 24), d = num(e, "d", 24);
  return { x: e.transform.pos.x - w / 2, z: e.transform.pos.z - d / 2, w, d };
};
const facingOf = (e: Entity): Facing => (typeof e.props.facing === "string" ? (e.props.facing as Facing) : "north");
/** flat contact shadow under a piece — the same device every other room's furniture uses */
function shadow(g: THREE.Group, w: number, d: number, o = 0.14): void {
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.08, d * 1.08), contactShadowMat(o));
  p.rotation.x = -Math.PI / 2;
  p.position.y = 0.06;
  p.castShadow = p.receiveShadow = false;
  g.add(p);
}
const laminate = (k?: MatKey) => mat(k ?? "qaWhite", 0.5);
const oak = (k?: MatKey) => mat(k ?? "qaOak", 0.68);
const oakDark = (k?: MatKey) => mat(k ?? "qaOakDark", 0.8);
const teal = (k?: MatKey) => mat(k ?? "qaTeal", 0.62);
const frameMat = (k?: MatKey) => mat(k ?? "qaFrame", 0.38, { metalness: 0.42 });

/** the small potted succulent every QA surface carries — the room's one repeated prop */
export function deskPot(g: THREE.Group, cx: number, y0: number, cz: number, r: number): void {
  const p = new THREE.Group();
  p.position.set(cx, y0, cz);
  p.add(lathe([[r * 0.7, 0], [r * 0.82, 0.4], [r, r * 1.4], [r * 0.92, r * 1.4]], plastic("white"), 0, 0, 0, 14));
  for (let i = 0; i < 11; i++) {
    const leaf = leafAnchor(i % 2 === 0, false);
    const a = (i / 11) * Math.PI * 2 + rnd() * 0.5;
    leaf.position.set(Math.cos(a) * r * 0.25, r * 1.35, Math.sin(a) * r * 0.25);
    leaf.rotation.set(-0.85 - rnd() * 0.6, a, 0);
    leaf.scale.setScalar(r * (0.7 + rnd() * 0.3));
    p.add(leaf);
  }
  g.add(p);
}

/** the teal-bound notebook, pen tidy and pale mouse every QA place is laid out with */
function placeKit(b: Baker, g: THREE.Group, x: number, y: number, z: number, tealKey: MatKey): void {
  const note = rbox(9.0, 1.1, 11.0, mat(tealKey, 0.7), x, y, z, 0.5);
  note.rotation.y = 0.12;
  b.add(note);
  b.add(cyl(1.6, 3.0, plastic("white"), x + 8.6, y, z - 4.0, 1.6));
  b.add(rbox(2.2, 1.0, 3.4, plastic("white"), x + 8.2, y, z + 5.0, 0.9));
  void g;
}

// ---- desks -----------------------------------------------------------------------------------------
/** BENCH POD: a white laminate bench two places long on slim tapered chrome legs, with a TEAL cross-rail
 *  between the two places and a TEAL privacy screen standing on its inner edge. `screen` names which side
 *  the screen is on, because the room's two pods mirror each other across the central aisle. */
function benchDesk(e: Entity): THREE.Group {
  const r = rectOf(e);
  const g = placed(r, facingOf(e));
  const { w, d } = localSize(r, facingOf(e));
  const h = num(e, "h", QA_DESK_TOP);
  const top = laminate(key(e, "color", "qaWhite"));
  const accent = teal(key(e, "accent", "qaTeal"));
  const fr = frameMat(key(e, "frame", "qaFrame"));
  const screenSide = str(e, "screen", "east") === "west" ? -1 : 1;
  const places = Math.max(1, num(e, "places", 2));
  // the screen stands ON the bench's inner edge, so the WORKTOP is the entity's width minus it
  const topW = w - SCREEN_D;
  const topCx = -screenSide * SCREEN_D / 2;
  shadow(g, w, d, 0.16);
  const b = new Baker();
  b.add(rbox(topW, 2.4, d, top, topCx, h - 2.4, 0, 1.2, 3)); //                        the slab
  b.add(rbox(topW + 0.3, 0.7, d + 0.3, mat("qaLinenDeep", 0.8), topCx, h - 3.1, 0, 0.3)); // shadow line
  // slim tapered legs at the four corners, plus a pair under the cross-rail
  for (const sx of [-1, 1] as const) for (const sz of [-1, 1] as const) {
    const leg = cyl(1.15, h - 3.1, fr, topCx + sx * (topW / 2 - 3.5), 0, sz * (d / 2 - 3.5), 0.85);
    leg.rotation.z = -sx * 0.05;
    leg.rotation.x = sz * 0.05;
    b.add(leg);
  }
  // THE TEAL CROSS-RAIL between the two places — the pod art's strongest line in plan
  for (let i = 1; i < places; i++) {
    const lz = -d / 2 + (d * i) / places;
    b.add(rbox(topW, 3.6, 5.0, accent, topCx, h - 3.4, lz, 0.5));
    b.add(rbox(topW - 6, 1.6, 3.0, mat("qaTealDeep", 0.7), topCx, h - 5.0, lz, 0.3)); // its cable tray
  }
  // THE PRIVACY SCREEN on the inner edge
  b.add(rbox(SCREEN_D, SCREEN_H, d - 2, accent, screenSide * (w / 2 - SCREEN_D / 2), h - 2.4, 0, 1.0, 3));
  b.bakeInto(g, "qa-bench-body");
  // DRESSING: one place per bay — a laptop, a notebook kit and a succulent, alternating sides
  for (let i = 0; i < places; i++) {
    const lz = -d / 2 + (d * (i + 0.5)) / places;
    const deck = new Baker();
    placeKit(deck, g, topCx - screenSide * 3.0, h, lz + (i % 2 ? 6 : -6), key(e, "accent", "qaTeal"));
    deck.bakeInto(g, `qa-bench-kit-${i}`);
    const lap = laptop(topCx + screenSide * 2.0, h, lz + (i % 2 ? -5 : 5));
    lap.rotation.y = screenSide > 0 ? -Math.PI / 2 : Math.PI / 2;
    g.add(lap);
    deskPot(g, topCx + screenSide * (topW / 2 - 5), h, lz, 2.2);
    if (i === 0) g.add(mug(topCx - screenSide * (topW / 2 - 5), h, lz + 8));
  }
  return g;
}

/** LEAD DESK: the same white laminate in a single wide slab on a light OAK apron, with the render's
 *  laptop, teal folder, small plant and the "TEAM LEAD" plate on its front edge. */
function leadDesk(e: Entity): THREE.Group {
  const r = rectOf(e);
  const g = placed(r, facingOf(e));
  const { w, d } = localSize(r, facingOf(e));
  const h = num(e, "h", QA_DESK_TOP);
  const top = laminate(key(e, "color", "qaWhite"));
  shadow(g, w, d, 0.16);
  const b = new Baker();
  b.add(rbox(w, 2.6, d, top, 0, h - 2.6, 0, 1.4, 3)); //                           the slab
  b.add(rbox(w + 0.3, 0.8, d + 0.3, oakDark(), 0, h - 3.4, 0, 0.3));
  b.add(rbox(w - 6, 4.6, d - 7, oak(key(e, "accent", "qaOak")), 0, h - 8.0, 0, 0.6)); // the oak apron
  for (const sx of [-1, 1] as const) for (const sz of [-1, 1] as const) {
    const leg = cyl(1.3, h - 8.0, oakDark(), sx * (w / 2 - 4.5), 0, sz * (d / 2 - 4.5), 1.0);
    leg.rotation.z = -sx * 0.06;
    b.add(leg);
  }
  b.bakeInto(g, "qa-lead-desk");
  // THE "TEAM LEAD" PLATE on the front (local +z, the visitor side) edge
  const plate = rbox(w * 0.24, 1.6, 1.0, teal(), 0, h - 2.2, d / 2 - 1.2, 0.4);
  g.add(plate);
  // DRESSING, straight off the reference: laptop centred, teal folder right, plant left, mug beside it
  const lap = laptop(-w * 0.06, h, -d * 0.10);
  lap.rotation.y = Math.PI;
  g.add(lap);
  const folder = rbox(11.0, 1.4, 14.0, teal(), w * 0.26, h, -d * 0.04, 0.6);
  folder.rotation.y = -0.08;
  g.add(folder);
  deskPot(g, -w * 0.32, h, d * 0.06, 2.4);
  g.add(mug(w * 0.06, h, d * 0.16));
  return g;
}

// ---- chairs ----------------------------------------------------------------------------------------
/** the pale five-star base + castors every chair in this room stands on */
function starBase(b: Baker, seatW: number, seatTop: number, fr: THREE.Material): void {
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.35, spread = seatW * 0.54;
    const arm = rbox(spread, 1.3, 1.8, fr, 0, 1.5, 0, 0.5);
    arm.position.set(Math.cos(a) * spread * 0.5, 2.0, Math.sin(a) * spread * 0.5);
    arm.rotation.y = -a;
    b.add(arm);
    const caster = new THREE.Mesh(sphereGeo, mat("qaFrame", 0.8));
    caster.scale.setScalar(1.1);
    caster.position.set(Math.cos(a) * spread * 0.97, 1.1, Math.sin(a) * spread * 0.97);
    b.add(caster as unknown as THREE.Mesh);
  }
  b.add(cyl(1.9, 0.9, fr, 0, 2.9, 0));
  b.add(cyl(1.3, seatTop - 6.4, fr, 0, 3.8, 0)); // gas lift
  b.add(cyl(2.0, 0.8, fr, 0, seatTop - 2.6, 0));
}

/** ONE cream linen chair, at `backH` of back. Both QA chairs are this object at two heights, which is
 *  exactly how the reference draws them — the lead's is the same seat with a taller, plusher back. */
function linenChair(e: Entity, metrics: { cushionTop: number }, backH: number, plush: boolean): THREE.Group {
  const r = rectOf(e);
  const g = placed(r, facingOf(e));
  const { w, d } = localSize(r, facingOf(e));
  const hide = fabric(key(e, "color", "qaLinen"));
  const piping = fabric(key(e, "colorSeat", "qaLinenDeep"));
  const fr = frameMat(key(e, "frame", "qaFrame"));
  shadow(g, w * 0.95, d * 0.95, 0.14);
  const b = new Baker();
  const seatW = Math.min(w, d) * 0.84, seatTop = metrics.cushionTop;
  starBase(b, seatW, seatTop, fr);
  // SEAT: a soft squared pad with a rolled front edge and a piped seam round its base
  b.add(rbox(seatW, 3.8, seatW * 0.96, hide, 0, seatTop - 3.8, 0, 1.8, 3));
  b.add(rbox(seatW + 0.4, 0.8, seatW * 0.96 + 0.4, piping, 0, seatTop - 4.4, 0, 0.3));
  b.add(cyl(seatW * 0.40, 0.9, hide, 0, seatTop - 0.9, 0, seatW * 0.44));
  // BACK: a gently curved wrap on a slight recline; the lead's is taller and carries a second pad
  const back = new THREE.Group();
  back.position.set(0, seatTop - 1.4, d * 0.30);
  back.rotation.x = -0.17;
  g.add(back);
  const bb = new Baker();
  bb.add(rbox(seatW * 0.94, backH, 2.8, hide, 0, 0, 0, 1.8, 3));
  bb.add(rbox(seatW * 0.78, 2.0, 3.2, hide, 0, backH - 2.0, -0.4, 1.2, 3)); //      rolled top edge
  if (plush) bb.add(rbox(seatW * 0.80, backH * 0.42, 3.0, hide, 0, backH * 0.50, -0.6, 1.6, 3));
  for (const s of [-1, 1] as const) { //                                            the wrap's two wings
    const wing = rbox(2.4, backH * 0.82, 3.0, hide, s * (seatW * 0.45), 0.5, -1.0, 1.2, 3);
    wing.rotation.y = -s * 0.32;
    bb.add(wing);
  }
  bb.bakeInto(back, "qa-chair-back");
  // ARMS: pale loops from the back posts out over the seat
  for (const s of [-1, 1] as const) {
    const post = rbox(1.4, 7.6, 1.4, fr, s * (seatW * 0.54), seatTop - 4.4, d * 0.18, 0.5);
    post.rotation.z = -s * 0.08;
    b.add(post);
    b.add(rbox(2.2, 1.5, d * 0.46, hide, s * (seatW * 0.56), seatTop + 2.8, -d * 0.02, 0.8, 3));
  }
  b.bakeInto(g, "qa-chair");
  return g;
}

// ---- lounge ----------------------------------------------------------------------------------------
/** SOFA: the reference's deep cream three-seater — a low deck, a square back, square arms, three cushions
 *  and the teal-and-cream scatter pair. Authored back-to-WEST with its long axis in local z, so rooms/qa.ts
 *  places it with no rotation at all. */
function qaSofa(e: Entity): THREE.Group {
  const r = rectOf(e);
  const g = placed(r, "north");
  const { w, d } = r;
  const body = fabric(key(e, "color", "qaLinen"));
  const pad = fabric(key(e, "colorSeat", "qaLinen"));
  const seats = Math.max(1, num(e, "seats", 3));
  shadow(g, w, d, 0.15);
  const b = new Baker();
  const deckH = 7.2, backW = 7.6, armW = SOFA_ARM_W;
  b.add(rbox(w, deckH, d, fabric("qaLinenDeep"), 0, 2.2, 0, 1.8, 3)); //                deck
  b.add(rbox(backW, 16.0, d - 1, body, -w / 2 + backW / 2, 2.2, 0, 2.0, 3)); //         back
  for (const s of [-1, 1] as const)
    b.add(rbox(w - backW + 1, 11.0, armW, body, backW / 2, 2.2, s * (d / 2 - armW / 2), 1.8, 3)); // arms
  const cushD = (d - 2 * armW - (seats - 1) * SOFA_CUSHION_GAP - 2 * SOFA_CUSHION_MARGIN) / seats;
  for (let i = 0; i < seats; i++) {
    const lz = sofaCushionZ(i, seats, cushD);
    b.add(rbox(w - backW - 1.4, 5.8, cushD, pad, QA_SOFA.cushionLocalX, deckH + 2.2, lz, 1.6, 3)); // → top 15.2
    const bk = rbox(5.0, 10.5, cushD - 1, pad, -w / 2 + backW + 1.6, deckH + 2.2, lz, 1.8, 3);
    bk.rotation.z = -0.1;
    b.add(bk);
  }
  for (let i = 0; i < 4; i++)
    b.add(cyl(0.9, 2.2, oakDark(), (i % 2 ? 1 : -1) * (w / 2 - 3), 0, (i < 2 ? 1 : -1) * (d / 2 - 4), 0.75));
  b.bakeInto(g, "qa-sofa");
  // the reference's two scatter cushions: one TEAL, one cream, both toward the south end
  for (const [k, lz, tilt] of [["qaTeal", d * 0.20, 0.38], ["qaLinenDeep", d * 0.31, -0.30]] as const) {
    const p = rbox(8.6, 3.0, 8.6, fabric(k as MatKey), QA_SOFA.cushionLocalX - 2.2, deckH + 7.8, lz, 2.0, 3);
    p.rotation.y = tilt;
    p.rotation.z = 0.12;
    g.add(p);
  }
  return g;
}

/** POUF: the round deep-TEAL ottoman with radial button seaming. The ONE saturated object in the room and
 *  the piece its whole palette is built around, so the seams are real geometry, not a texture. */
function qaPouf(e: Entity): THREE.Group {
  const g = placed(rectOf(e), facingOf(e));
  const r = num(e, "r", 10);
  const shell = fabric(key(e, "color", "qaTeal"));
  shadow(g, r * 2.1, r * 2.1, 0.16);
  const b = new Baker();
  const h = 13.2;
  // a low drum, widest at the shoulder and drawn in at the base, with a dished top
  b.add(lathe([[r * 0.82, 0], [r * 0.95, 1.6], [r, h * 0.58], [r * 0.94, h], [r * 0.52, h - 0.9], [0, h - 1.4]],
    shell, 0, 0, 0, 26));
  // radial seams all the way round — the render's whole character in plan
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const seam = rbox(0.7, 1.0, r * 0.86, fabric("qaTealDeep"), Math.sin(a) * r * 0.44, h - 1.0, Math.cos(a) * r * 0.44, 0.25);
    seam.rotation.y = a;
    b.add(seam);
  }
  b.add(cyl(1.3, 0.6, fabric("qaTealDeep"), 0, h - 1.5, 0, 1.0)); // the centre button
  b.bakeInto(g, "qa-pouf");
  return g;
}

/** ROUND COFFEE TABLE: a light oak disc on three tapered legs, with the render's plant and open magazine. */
function qaRoundTable(e: Entity): THREE.Group {
  const g = placed(rectOf(e), "north");
  const r = num(e, "r", 12);
  const top = oak(key(e, "color", "qaOak"));
  const leg = oakDark(key(e, "accent", "qaOakDark"));
  const h = 14;
  shadow(g, r * 2, r * 2, 0.14);
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
  b.bakeInto(g, "qa-round-table");
  deskPot(g, -r * 0.18, h, -r * 0.24, 2.4);
  const mag = rbox(7.4, 0.5, 5.2, plastic("white"), r * 0.26, h, r * 0.30, 0.12);
  mag.rotation.y = 0.3;
  g.add(mag);
  const cover = rbox(3.2, 0.16, 4.2, teal(), r * 0.12, h + 0.5, r * 0.30, 0.1);
  cover.rotation.y = 0.3;
  g.add(cover);
  return g;
}

/** RUG: the oatmeal pile square with one inset border line — the same flat, cheap, correct device the
 *  Executive, CMS and Dev rugs use. */
function qaRug(e: Entity): THREE.Group {
  const r = rectOf(e);
  const g = placed(r, "north");
  const { w, d } = r;
  const base = rbox(w, 0.7, d, mat(key(e, "color", "qaRug"), 1), 0, 0, 0, 1.4);
  base.castShadow = false;
  g.add(base);
  const border = mat(key(e, "accent", "qaRugBorder"), 1);
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

export function buildQaFurniture(e: Entity): THREE.Group | null {
  switch (e.kind as QaKind) {
    case "qa-bench-desk": return benchDesk(e);
    case "qa-lead-desk": return leadDesk(e);
    case "qa-lead-chair": return linenChair(e, QA_LEAD_CHAIR, 15.5, true);
    case "qa-task-chair": return linenChair(e, QA_TASK_CHAIR, 11.0, false);
    case "qa-sofa": return qaSofa(e);
    case "qa-pouf": return qaPouf(e);
    case "qa-round-table": return qaRoundTable(e);
    case "qa-rug": return qaRug(e);
    default: return null;
  }
}
