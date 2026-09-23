// vo3d build — DEV ROOM FURNITURE. Room-specific geometry, not a re-skin.
//
// WHY ITS OWN MODULE. The same reason build/exec-furniture.ts, build/cms-furniture.ts and
// build/ai-furniture.ts exist: the shared catalogue in build/furniture.ts carries the Design Room's,
// Reception's and Gaming's identity, and none of the other three room modules carries the dev team's.
// The EIGHT separated V1 assets say precisely what these pieces are:
//
//   dev-bay-desk.png      a long ESPRESSO WALNUT bench, four places a side back to back, split down its
//                         whole length by a PLANTER TROUGH of low green foliage, with a blue neon line
//                         washing the floor from a recess in its base rail. Dressed both ways: a monitor,
//                         keyboard, mouse, headphone hoop, water bottle, mug and notebook per place.
//   dev-lead-desk.png     the same walnut slab in a single-person size on a black plinth, carrying an
//                         ultrawide monitor, two open laptops, an angle-poise lamp, two plants and a mug.
//   dev-chair.png         a BLACK LEATHER high-back executive chair: three horizontal stitched bolsters
//                         up the back, thick padded arms, a polished five-star base.
//   dev-visitor-chair.png a BLACK round-back task chair with GREY tubular arms on a five-star castor
//                         base — the same seat family, half the back height.
//   dev-side-desk.png     a small walnut side table: plant, mug and a book on top, black plinth below.
//   dev-side-sofa.png     a black two-and-a-half-seat sofa with GREY bolster cushions and one black
//                         "CTRL ALT DEL" scatter pillow.
//   dev-side-mat.png      a plain grey textured rug.
//   dev-side-plant.png    a big broadleaf plant in a black pot (built by build/plants, not here).
//
// Each is rebuilt here as real geometry at that description. What IS reused is the arithmetic and the
// helpers: Baker/rbox/cyl/lathe, the material cache, the placed()/localSize() facing convention and
// build/props' laptop, monitor and mug.
//
// This module imports NOTHING from rooms/ — rooms/dev.ts reads its metrics, and build/dev.ts (the room's
// static fit-out) reads rooms/dev.ts. One direction, no cycle.
import * as THREE from "three";
import type { Entity } from "../world/WorldState";
import type { Facing } from "../core/coords";
import { Baker, cyl, lathe, placed, localSize, rbox, rnd, sphereGeo } from "./helpers";
import { contactShadowMat, emissiveMat, fabric, glowMat, mat, metal, plastic, type MatKey } from "../render/Materials";
import { leafAnchor } from "./plants";
import { laptop, monitor, mug } from "./props";
import { SOFA_ARM_W, SOFA_CUSHION_GAP, SOFA_CUSHION_MARGIN, sofaCushionZ } from "./furniture";

/** The entity kinds this module builds. build/registry.ts routes them here. */
export const DEV_KINDS = [
  "dev-bay-desk", "dev-lead-desk", "dev-side-desk",
  "dev-exec-chair", "dev-task-chair", "dev-sofa", "dev-rug",
] as const;
export type DevKind = (typeof DEV_KINDS)[number];

/** Seat-contact planes, EXPORTED so rooms/dev.ts derives its seat metadata from the same numbers the
 *  meshes use and the two can never drift. */
export const DEV_EXEC_CHAIR = { cushionTop: 15.0, cushionLocalZ: 0.4 };
export const DEV_TASK_CHAIR = { cushionTop: 14.2, cushionLocalZ: 0.3 };
export const DEV_SOFA = { cushionTop: 15.4, cushionLocalX: 5.0 };
/** work-surface height, shared by all three desk builders and by build/dev.ts when it dresses them */
export const DEV_DESK_TOP = 24;
/** the planter trough down the middle of a bay bench — the asset's signature part */
export const TROUGH_W = 13;

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
const walnut = (k?: MatKey) => mat(k ?? "devWalnut", 0.62);
const walnutDark = (k?: MatKey) => mat(k ?? "devWalnutDark", 0.8);
const ink = (k?: MatKey) => mat(k ?? "devInk", 0.7);
const frameMat = (k?: MatKey) => mat(k ?? "devFrame", 0.4, { metalness: 0.45 });
const rubber = () => mat("devInkDeep", 0.95);

/** ONE lit neon line, as the whole room draws them: an emissive core with an additive halo either side.
 *  Two meshes, no real-time light — the same zero-light budget every room since Gaming works to. */
export function neonLine(g: THREE.Group, w: number, h: number, d: number, x: number, y: number, z: number, k: MatKey = "devNeon"): void {
  const core = rbox(w, h, d, emissiveMat(k, 1.6, 0.3), x, y, z, Math.min(w, h, d) * 0.3);
  core.castShadow = core.receiveShadow = false;
  g.add(core);
  const halo = rbox(w * 1.05 + 1.4, h + 1.8, d * 1.05 + 1.4, glowMat(k, 0.26), x, y - 0.9, z, 0.7);
  halo.castShadow = halo.receiveShadow = false;
  g.add(halo);
}

/** a run of low broadleaf foliage in a trough — the bay bench's centre planter, and the same routine
 *  build/dev.ts uses to green the north run's ledge */
export function troughPlanting(g: THREE.Group, x0: number, x1: number, y: number, z: number, spread: number): void {
  const n = Math.max(3, Math.round((x1 - x0) / 7));
  for (let i = 0; i < n; i++) {
    const cx = x0 + ((x1 - x0) * (i + 0.5)) / n;
    for (let j = 0; j < 5; j++) {
      const leaf = leafAnchor(j % 2 === 0, false);
      const a = (j / 5) * Math.PI * 2 + rnd() * 0.7;
      leaf.position.set(cx + Math.cos(a) * spread * 0.3, y, z + Math.sin(a) * spread * 0.3);
      leaf.rotation.set(-0.95 - rnd() * 0.5, a, 0);
      leaf.scale.setScalar(2.4 + rnd() * 1.3);
      g.add(leaf);
    }
  }
}

/** the small potted succulent the dev desks carry */
function deskPot(g: THREE.Group, cx: number, y0: number, cz: number, r: number): void {
  const p = new THREE.Group();
  p.position.set(cx, y0, cz);
  p.add(lathe([[r * 0.7, 0], [r * 0.8, 0.4], [r, r * 1.4], [r * 0.92, r * 1.4]], ink("devInkDeep"), 0, 0, 0, 14));
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

/** the black keyboard + mouse pair every dev place is laid out with */
function peripherals(b: Baker, x: number, y: number, z: number, faceSign: 1 | -1): void {
  b.add(rbox(13.0, 0.9, 4.4, ink(), x, y, z + faceSign * 2.6, 0.3));
  b.add(rbox(11.8, 0.25, 3.4, ink("devInkDeep"), x, y + 0.9, z + faceSign * 2.6, 0.15)); // key field
  b.add(rbox(2.4, 1.1, 3.8, ink(), x + 9.0, y, z + faceSign * 2.4, 1.0)); //               mouse
}

/** the headphone hoop and water bottle the bay art stands beside every second place */
function deskKit(b: Baker, x: number, y: number, z: number): void {
  b.add(cyl(1.0, 6.6, ink(), x, y, z, 1.0)); //                     bottle
  b.add(cyl(1.15, 0.8, mat("devNeonDeep", 0.6), x, y + 6.6, z));
  b.add(rbox(1.0, 5.0, 1.0, ink(), x + 5.2, y, z, 0.4)); //         headphone stand post
  b.add(rbox(4.6, 1.2, 1.2, ink("devInkDeep"), x + 5.2, y + 5.0, z, 0.5));
}

// ---- desks -----------------------------------------------------------------------------------------
/** BAY BENCH (dev-bay-desk.png). A 106-long, 66-deep espresso walnut bench, four places a side back to
 *  back, split down the whole length by a planter trough of low foliage, on a black base rail whose recess
 *  throws the asset's blue neon wash onto the floor. Authored with its long axis in LOCAL X. */
function bayDesk(e: Entity): THREE.Group {
  const r = rectOf(e);
  const g = placed(r, facingOf(e));
  const { w, d } = localSize(r, facingOf(e));
  const h = num(e, "h", DEV_DESK_TOP);
  const top = walnut(key(e, "color", "devWalnut"));
  const base = ink(key(e, "accent", "devInk"));
  const neon = key(e, "neon", "devNeon");
  const places = Math.max(1, num(e, "places", 4));
  shadow(g, w, d, 0.2);
  const b = new Baker();
  // BASE RAIL: one black plinth running the bench's length, held 3 off the floor so the neon reveal under
  // it reads as the asset's floor glow rather than as a skirting
  b.add(rbox(w - 10, h - 6.0, d - 18, base, 0, 3.0, 0, 0.8));
  b.add(rbox(w - 15, 3.0, d - 22, mat("devInkDeep", 0.92), 0, 0, 0, 0.4));
  // TOPS: two walnut decks either side of the centre trough
  const deckD = (d - TROUGH_W) / 2;
  for (const s of [-1, 1] as const) {
    b.add(rbox(w, 2.6, deckD, top, 0, h - 2.6, s * (TROUGH_W + deckD) / 2, 1.6, 3));
    b.add(rbox(w + 0.4, 0.8, deckD + 0.3, walnutDark(), 0, h - 3.4, s * (TROUGH_W + deckD) / 2, 0.35));
  }
  // TROUGH: a black liner between the two decks, planted the whole way
  b.add(rbox(w - 2, 5.0, TROUGH_W, mat("devInkDeep", 0.9), 0, h - 5.0, 0, 0.5));
  b.bakeInto(g, "dev-bay-body");
  troughPlanting(g, -w / 2 + 3, w / 2 - 3, h - 0.6, 0, TROUGH_W * 0.55);
  // THE NEON REVEAL under the base rail, plus its floor wash
  for (const s of [-1, 1] as const) neonLine(g, w - 12, 0.7, 0.9, 0, 2.0, s * (d / 2 - 9), neon);
  const wash = rbox(w - 6, 0.02, d - 6, glowMat(neon, 0.18), 0, 0.12, 0, 1.2);
  wash.castShadow = wash.receiveShadow = false;
  g.add(wash);
  // DRESSING: `places` places a side, each a monitor on the trough lip with a keyboard in front of it
  for (let i = 0; i < places; i++) {
    const lx = -w / 2 + (w * (i + 0.5)) / places;
    for (const s of [-1, 1] as const) {
      const lz = s * (TROUGH_W / 2 + deckD * 0.55);
      const deck = new Baker();
      peripherals(deck, lx, h, lz, s);
      if (i % 2 === 0) deskKit(deck, lx - 9.0, h, lz - s * 3.0);
      deck.bakeInto(g, `dev-bay-kit-${i}-${s > 0 ? "s" : "n"}`);
      const mon = monitor(lx, h + 1.2, s * (TROUGH_W / 2 + 1.6), 15, 8.6);
      mon.rotation.y = s > 0 ? 0 : Math.PI;
      g.add(mon);
      if (i === places - 1) g.add(mug(lx + 7.0, h, lz + s * 6.0));
    }
  }
  return g;
}

/** LEAD DESK (dev-lead-desk.png). A single walnut slab on a black plinth, carrying the asset's ultrawide
 *  monitor, two laptops, an angle-poise lamp, two plants and a mug. */
function leadDesk(e: Entity): THREE.Group {
  const r = rectOf(e);
  const g = placed(r, facingOf(e));
  const { w, d } = localSize(r, facingOf(e));
  const h = num(e, "h", DEV_DESK_TOP);
  const top = walnut(key(e, "color", "devWalnut"));
  const neon = key(e, "neon", "devNeon");
  shadow(g, w, d, 0.18);
  const b = new Baker();
  b.add(rbox(w, 3.0, d, top, 0, h - 3.0, 0, 1.8, 3)); //                        the slab
  b.add(rbox(w + 0.4, 0.9, d + 0.4, walnutDark(), 0, h - 3.9, 0, 0.35));
  b.add(rbox(w - 6, h - 5.5, d - 9, ink("devInk"), 0, 2.5, 0, 0.7)); //         black plinth
  b.add(rbox(w - 11, 2.5, d - 13, mat("devInkDeep", 0.92), 0, 0, 0, 0.4));
  b.bakeInto(g, "dev-lead-desk");
  neonLine(g, w - 10, 0.6, 0.8, 0, 1.6, d / 2 - 6, neon);
  const wash = rbox(w - 4, 0.02, d - 4, glowMat(neon, 0.15), 0, 0.12, 0, 1.0);
  wash.castShadow = wash.receiveShadow = false;
  g.add(wash);
  // DRESSING, straight off the asset: ultrawide centred, a laptop either side, lamp, plants, mug
  const ultra = monitor(0, h + 1.0, -d * 0.22, 26, 9.4);
  ultra.rotation.y = Math.PI;
  g.add(ultra);
  for (const s of [-1, 1] as const) {
    const lap = laptop(s * (w * 0.28), h, d * 0.02);
    lap.rotation.y = Math.PI;
    g.add(lap);
  }
  const lamp = new Baker();
  lamp.add(cyl(2.6, 0.8, ink(), -w * 0.40, h, -d * 0.22));
  lamp.add(cyl(0.6, 11.0, ink(), -w * 0.40, h + 0.8, -d * 0.22));
  lamp.add(rbox(4.4, 1.6, 2.6, ink("devInk"), -w * 0.36, h + 11.0, -d * 0.16, 0.7));
  lamp.bakeInto(g, "dev-lead-lamp");
  deskPot(g, w * 0.40, h, -d * 0.20, 2.3);
  deskPot(g, -w * 0.22, h, d * 0.22, 2.0);
  g.add(mug(w * 0.30, h, d * 0.20));
  return g;
}

/** SIDE TABLE (dev-side-desk.png): a small walnut top on a black plinth, with the asset's plant, mug and
 *  paperback on it. The lounge's one work surface. */
function sideDesk(e: Entity): THREE.Group {
  const r = rectOf(e);
  const g = placed(r, facingOf(e));
  const { w, d } = localSize(r, facingOf(e));
  const h = num(e, "h", 20);
  shadow(g, w, d, 0.16);
  const b = new Baker();
  b.add(rbox(w, 2.6, d, walnut(key(e, "color", "devWalnut")), 0, h - 2.6, 0, 1.4, 3));
  b.add(rbox(w + 0.4, 0.8, d + 0.4, walnutDark(), 0, h - 3.4, 0, 0.3));
  b.add(rbox(w - 5, h - 4.6, d - 6, ink(), 0, 2.0, 0, 0.6));
  b.add(rbox(w - 9, 2.0, d - 10, mat("devInkDeep", 0.92), 0, 0, 0, 0.3));
  b.bakeInto(g, "dev-side-desk");
  deskPot(g, 0, h, -d * 0.24, 2.4);
  g.add(mug(w * 0.14, h, d * 0.04));
  const bookSlab = rbox(7.0, 0.9, 9.0, mat("devNeonDeep", 0.7), -w * 0.10, h, d * 0.26, 0.2);
  bookSlab.rotation.y = 0.18;
  g.add(bookSlab);
  return g;
}

// ---- chairs ----------------------------------------------------------------------------------------
/** the polished five-star base + castors every chair in this room stands on */
function starBase(b: Baker, seatW: number, seatTop: number, fr: THREE.Material): void {
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.35, spread = seatW * 0.54;
    const arm = rbox(spread, 1.4, 2.0, fr, 0, 1.6, 0, 0.55);
    arm.position.set(Math.cos(a) * spread * 0.5, 2.0, Math.sin(a) * spread * 0.5);
    arm.rotation.y = -a;
    b.add(arm);
    const caster = new THREE.Mesh(sphereGeo, rubber());
    caster.scale.setScalar(1.2);
    caster.position.set(Math.cos(a) * spread * 0.97, 1.2, Math.sin(a) * spread * 0.97);
    b.add(caster as unknown as THREE.Mesh);
  }
  b.add(cyl(2.0, 0.9, fr, 0, 3.0, 0));
  b.add(cyl(1.4, seatTop - 6.6, fr, 0, 3.9, 0)); // gas lift
  b.add(cyl(2.1, 0.8, fr, 0, seatTop - 2.7, 0));
}

/** EXECUTIVE CHAIR (dev-chair.png): the black leather high-back — a deep bucket seat, THREE horizontal
 *  stitched bolsters up a tall reclined back, thick padded arms on chunky black posts. This silhouette is
 *  the whole reason the room does not read like the AI Room's white-and-silver task chairs. */
function execChair(e: Entity): THREE.Group {
  const r = rectOf(e);
  const g = placed(r, facingOf(e));
  const { w, d } = localSize(r, facingOf(e));
  const hide = fabric(key(e, "color", "devLeather"));
  const panel = fabric(key(e, "colorSeat", "devLeatherSeat"));
  const fr = frameMat(key(e, "frame", "devFrame"));
  shadow(g, w * 0.98, d * 0.98, 0.17);
  const b = new Baker();
  const seatW = Math.min(w, d) * 0.86, seatTop = DEV_EXEC_CHAIR.cushionTop;
  starBase(b, seatW, seatTop, fr);
  // SEAT: a deep bucket — a squared pad with raised side bolsters, as the asset draws it
  b.add(rbox(seatW, 4.2, seatW * 1.02, hide, 0, seatTop - 4.2, 0, 1.6, 3));
  b.add(rbox(seatW * 0.66, 1.2, seatW * 0.92, panel, 0, seatTop - 1.2, 0, 1.0, 3));
  for (const s of [-1, 1] as const)
    b.add(rbox(seatW * 0.17, 2.6, seatW * 0.92, hide, s * seatW * 0.41, seatTop - 2.4, 0, 1.2, 3));
  // BACK: three stacked bolsters on a reclined carrier, the asset's signature
  const back = new THREE.Group();
  back.position.set(0, seatTop - 1.8, d * 0.30);
  back.rotation.x = -0.17;
  g.add(back);
  const bb = new Baker();
  bb.add(rbox(seatW * 0.96, 22.0, 2.4, hide, 0, 0.6, 0.9, 1.6, 3)); // the shell
  for (let i = 0; i < 3; i++)
    bb.add(rbox(seatW * (0.80 - i * 0.03), 5.6, 2.8, panel, 0, 2.4 + i * 6.6, -0.5, 1.6, 3));
  for (const s of [-1, 1] as const) { //                                side wings
    const wing = rbox(2.6, 19.0, 3.0, hide, s * (seatW * 0.46), 1.2, -0.4, 1.3, 3);
    wing.rotation.y = -s * 0.26;
    bb.add(wing);
  }
  bb.bakeInto(back, "dev-exec-back");
  // ARMS: thick black pads on chunky posts
  for (const s of [-1, 1] as const) {
    b.add(rbox(2.6, 7.0, 2.6, hide, s * (seatW * 0.55), seatTop - 4.4, d * 0.16, 0.7));
    b.add(rbox(3.4, 2.2, d * 0.52, hide, s * (seatW * 0.55), seatTop + 2.6, -d * 0.02, 1.0, 3));
  }
  b.bakeInto(g, "dev-exec-chair");
  return g;
}

/** TASK CHAIR (dev-visitor-chair.png): the black ROUND-BACK seat with GREY tubular arms on a five-star
 *  castor base — the same leather family as the executive chair at half the back height. */
function taskChair(e: Entity): THREE.Group {
  const r = rectOf(e);
  const g = placed(r, facingOf(e));
  const { w, d } = localSize(r, facingOf(e));
  const hide = fabric(key(e, "color", "devLeather"));
  const fr = frameMat(key(e, "frame", "devFrame"));
  shadow(g, w * 0.95, d * 0.95, 0.15);
  const b = new Baker();
  const seatW = Math.min(w, d) * 0.84, seatTop = DEV_TASK_CHAIR.cushionTop;
  starBase(b, seatW, seatTop, fr);
  // SEAT: a round dished pad — the asset reads as a disc from above, not as a square
  b.add(cyl(seatW * 0.50, 3.4, hide, 0, seatTop - 3.4, 0, seatW * 0.52));
  b.add(cyl(seatW * 0.44, 1.0, fabric(key(e, "colorSeat", "devLeatherSeat")), 0, seatTop - 1.0, 0, seatW * 0.47));
  // BACK: a round shell, barely reclined
  const back = new THREE.Group();
  back.position.set(0, seatTop - 1.2, d * 0.30);
  back.rotation.x = -0.16;
  g.add(back);
  const bb = new Baker();
  bb.add(lathe([[seatW * 0.52, 0], [seatW * 0.54, 4.0], [seatW * 0.50, 9.6], [seatW * 0.36, 12.4], [0, 12.8]], hide, 0, 0, 0, 20));
  bb.add(rbox(seatW * 0.86, 2.0, 3.0, hide, 0, 12.0, -0.6, 1.2, 3));
  bb.bakeInto(back, "dev-task-back");
  // ARMS: grey tubes looping from the back post out over the seat
  for (const s of [-1, 1] as const) {
    const post = cyl(0.9, 8.0, fr, s * (seatW * 0.54), seatTop - 4.6, d * 0.20);
    post.rotation.z = -s * 0.10;
    b.add(post);
    b.add(rbox(2.0, 1.5, d * 0.46, fr, s * (seatW * 0.56), seatTop + 2.6, -d * 0.02, 0.7));
  }
  b.bakeInto(g, "dev-task-chair");
  return g;
}

// ---- lounge ----------------------------------------------------------------------------------------
/** SOFA (dev-side-sofa.png): the black lounge sofa with GREY bolster cushions and the "CTRL ALT DEL"
 *  scatter pillow. Authored back-to-WEST with its long axis in local z, so rooms/dev.ts places it with no
 *  rotation at all — the same convention CMS's sofa uses. */
function devSofa(e: Entity): THREE.Group {
  const r = rectOf(e);
  const g = placed(r, "north");
  const { w, d } = r;
  const body = fabric(key(e, "color", "devSofa"));
  const pad = fabric(key(e, "colorSeat", "devSofaSeat"));
  const seats = Math.max(1, num(e, "seats", 3));
  shadow(g, w, d, 0.16);
  const b = new Baker();
  const deckH = 7.6, backW = 7.6, armW = SOFA_ARM_W;
  b.add(rbox(w, deckH, d, body, 0, 2.0, 0, 1.8, 3)); //                                 deck
  b.add(rbox(backW, 17.0, d - 1, body, -w / 2 + backW / 2, 2.0, 0, 2.0, 3)); //         back
  for (const s of [-1, 1] as const)
    b.add(rbox(w - backW + 1, 12.0, armW, body, backW / 2, 2.0, s * (d / 2 - armW / 2), 1.6, 3)); // arms
  const cushD = (d - 2 * armW - (seats - 1) * SOFA_CUSHION_GAP - 2 * SOFA_CUSHION_MARGIN) / seats;
  for (let i = 0; i < seats; i++) {
    const lz = sofaCushionZ(i, seats, cushD);
    b.add(rbox(w - backW - 1.4, 5.8, cushD, pad, DEV_SOFA.cushionLocalX, deckH + 2.0, lz, 1.4, 3)); // → top 15.4
    const bk = rbox(5.0, 11.5, cushD - 1, pad, -w / 2 + backW + 1.5, deckH + 2.0, lz, 1.6, 3);
    bk.rotation.z = -0.1;
    b.add(bk);
  }
  for (let i = 0; i < 4; i++)
    b.add(cyl(0.9, 2.0, mat("devInkDeep", 0.7), (i % 2 ? 1 : -1) * (w / 2 - 3), 0, (i < 2 ? 1 : -1) * (d / 2 - 4), 0.75));
  b.bakeInto(g, "dev-sofa");
  // the asset's one black scatter pillow, square and square-on
  const p = rbox(8.8, 3.0, 8.8, fabric("devInk"), DEV_SOFA.cushionLocalX - 2.2, deckH + 8.0, d * 0.28, 1.8, 3);
  p.rotation.y = 0.28;
  p.rotation.z = 0.12;
  g.add(p);
  return g;
}

/** RUG (dev-side-mat.png): the plain grey pile square with one inset border line — the same flat, cheap,
 *  correct device the Executive and CMS rugs use. */
function devRug(e: Entity): THREE.Group {
  const r = rectOf(e);
  const g = placed(r, "north");
  const { w, d } = r;
  const base = rbox(w, 0.7, d, mat(key(e, "color", "devMat"), 1), 0, 0, 0, 1.4);
  base.castShadow = false;
  g.add(base);
  const border = mat(key(e, "accent", "devMatBorder"), 1);
  const t = 1.4, inset = 5;
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

// ---- shared dressing used by build/dev.ts ----------------------------------------------------------
/** a row of spine-out books on a shelf — the north bookcase and the west tool wall both use it */
export function bookRow(g: THREE.Group, x0: number, x1: number, y: number, z: number, h: number): void {
  const b = new Baker();
  let x = x0;
  while (x < x1 - 1.6) {
    const t = 1.4 + rnd() * 1.6;
    const key2: MatKey = rnd() > 0.62 ? "devNeonDeep" : rnd() > 0.4 ? "devWalnutDark" : "devInk";
    b.add(rbox(t, h * (0.78 + rnd() * 0.22), 8.0, mat(key2, 0.85), x + t / 2, y, z, 0.15));
    x += t + 0.35;
  }
  b.bakeInto(g, "dev-books");
}

/** the white ceramic mug + pour-over stack the pantry counter carries */
export function pantryProps(g: THREE.Group, cx: number, y: number, cz: number): void {
  const b = new Baker();
  for (let i = 0; i < 6; i++)
    b.add(cyl(2.0, 2.4, plastic("white"), cx - 9 + (i % 3) * 9, y + Math.floor(i / 3) * 2.4, cz, 2.0));
  b.add(rbox(9.0, 1.0, 7.0, metal(), cx + 16, y, cz, 0.3));
  b.bakeInto(g, "dev-pantry-props");
}

export function buildDevFurniture(e: Entity): THREE.Group | null {
  switch (e.kind as DevKind) {
    case "dev-bay-desk": return bayDesk(e);
    case "dev-lead-desk": return leadDesk(e);
    case "dev-side-desk": return sideDesk(e);
    case "dev-exec-chair": return execChair(e);
    case "dev-task-chair": return taskChair(e);
    case "dev-sofa": return devSofa(e);
    case "dev-rug": return devRug(e);
    default: return null;
  }
}
