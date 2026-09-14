// vo3d build — AI ROOM FURNITURE. Room-specific geometry, not a re-skin.
//
// WHY ITS OWN MODULE. The same reason build/exec-furniture.ts and build/cms-furniture.ts exist: the shared
// catalogue in build/furniture.ts carries the Design Room's, Reception's and Gaming's identity, and the
// CMS module carries the content team's blue oak — recolouring either does not make the AI team's room,
// because the SILHOUETTES are wrong. The five separated V1 assets say precisely what these pieces are:
//
//   ai-member-desk-1.png  a long CHARCOAL BENCH with soft-radiused corners, a lit BLUE CABLE SPINE running
//                         its whole length down the middle, and a recessed plinth that throws a blue glow
//                         onto the floor. Dressed both ways: monitors on the spine, keyboards, mice,
//                         laptops, a headphone cradle, a speaker puck, mugs and one plant at the centre.
//   ai-lead-desk.png      the same charcoal slab in a single-person size, on two dark tapered legs, with
//                         the blue LED line running along the underside of its front edge. Laptop, mug,
//                         one plant.
//   ai-member-chair.png   a WARM WHITE upholstered task chair — dished seat, curved wrap-around back,
//                         brushed SILVER arms looping from back to front, silver five-star base, black
//                         castors. White-and-silver is the whole difference from the CMS blue barrel.
//   ai-lead-chair.png     a light grey executive chair: three-panel tufted back with a separate HEADREST
//                         over it, dark grey arms, polished base.
//   (same sheet)          the two visitor chairs: low-back grey tub chairs with white arms, on castors.
//
// Each is rebuilt here as real geometry at that description. What IS reused is the arithmetic and the
// helpers: Baker/rbox/cyl/lathe, the material cache, the placed()/localSize() facing convention and
// build/props' laptop, monitor and mug.
//
// This module imports NOTHING from rooms/ — rooms/ai.ts reads its metrics, and build/ai.ts (the room's
// static fit-out) reads rooms/ai.ts. One direction, no cycle.
import * as THREE from "three";
import type { Entity } from "../world/WorldState";
import type { Facing } from "../core/coords";
import { Baker, cyl, lathe, placed, localSize, rbox, rnd, sphereGeo } from "./helpers";
import { contactShadowMat, emissiveMat, fabric, glowMat, mat, metal, plastic, type MatKey } from "../render/Materials";
import { foliage, leafGeometry } from "./plants";
import { laptop, monitor, mug } from "./props";

/** The entity kinds this module builds. build/registry.ts routes them here. */
export const AI_KINDS = ["ai-bench-desk", "ai-lead-desk", "ai-task-chair", "ai-lead-chair", "ai-visitor-chair"] as const;
export type AiKind = (typeof AI_KINDS)[number];

/** Seat-contact planes, EXPORTED so rooms/ai.ts derives its seat metadata from the same numbers the meshes
 *  use and the two can never drift. */
export const AI_TASK_CHAIR = { cushionTop: 14.4, cushionLocalZ: 0.3 };
export const AI_LEAD_CHAIR = { cushionTop: 15.2, cushionLocalZ: 0.4 };
export const AI_VISITOR_CHAIR = { cushionTop: 13.8, cushionLocalZ: 0.3 };
/** work-surface height, shared by both desk builders and by build/ai.ts when it dresses them */
export const AI_DESK_TOP = 24;
/** the lit cable spine's width and the height its glow plane floats at — the room's running motif */
export const SPINE_W = 5.2;

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
const slab = (k?: MatKey) => mat(k ?? "aiCharcoal", 0.58);
const carbon = (k?: MatKey) => mat(k ?? "aiCarbonDeep", 0.7);
const frameMat = (k?: MatKey) => mat(k ?? "aiFrame", 0.38, { metalness: 0.45 });
const rubber = () => mat("aiCarbonDeep", 0.9);

/** ONE lit LED line, as the whole room draws them: an emissive core with an additive halo either side of
 *  it. Two meshes, no real-time light — the same zero-light budget every room since Gaming works to. */
export function ledLine(g: THREE.Group, w: number, h: number, d: number, x: number, y: number, z: number, k: MatKey = "aiLed"): void {
  const core = rbox(w, h, d, emissiveMat(k, 1.5, 0.3), x, y, z, Math.min(w, h, d) * 0.3);
  core.castShadow = core.receiveShadow = false;
  g.add(core);
  const halo = rbox(w * 1.05 + 1.2, h + 1.6, d * 1.05 + 1.2, glowMat(k, 0.28), x, y - 0.8, z, 0.6);
  halo.castShadow = halo.receiveShadow = false;
  g.add(halo);
}

/** the small potted succulent every AI desk carries — the one warm thing in a carbon-and-blue room */
function deskPot(g: THREE.Group, cx: number, y0: number, cz: number, r: number): void {
  const p = new THREE.Group();
  p.position.set(cx, y0, cz);
  p.add(lathe([[r * 0.7, 0], [r * 0.8, 0.4], [r, r * 1.4], [r * 0.92, r * 1.4]], carbon("aiCarbon"), 0, 0, 0, 14));
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

/** the black keyboard + mouse pair the bench art lays out at every place */
function peripherals(b: Baker, x: number, y: number, z: number, faceSign: 1 | -1): void {
  b.add(rbox(13.5, 0.9, 4.6, carbon("aiCarbon"), x, y, z + faceSign * 2.4, 0.3));
  b.add(rbox(12.4, 0.25, 3.6, carbon(), x, y + 0.9, z + faceSign * 2.4, 0.15)); //  key field
  const m = rbox(2.4, 1.1, 3.8, carbon("aiCarbon"), x + 9.4, y, z + faceSign * 2.2, 1.0);
  b.add(m);
}

// ---- desks -----------------------------------------------------------------------------------------
/** BENCH DESK (ai-member-desk-1.png). A 116-long charcoal slab with soft-radiused corners, split down the
 *  middle by a lit blue CABLE SPINE, standing on a recessed carbon plinth whose reveal throws the art's
 *  blue underglow onto the floor. Dressed symmetrically: three places a side, monitors and a plant on the
 *  spine, laptops and peripherals on the decks. */
function benchDesk(e: Entity): THREE.Group {
  const r = rectOf(e);
  const g = placed(r, facingOf(e));
  const { w, d } = localSize(r, facingOf(e));
  const h = num(e, "h", AI_DESK_TOP);
  const top = slab(key(e, "color", "aiCharcoal"));
  const base = carbon(key(e, "accent", "aiCarbonDeep"));
  const led = key(e, "led", "aiLed");
  shadow(g, w, d, 0.18);
  const b = new Baker();
  // PLINTH: a single recessed pedestal running the bench's length, held 2.6 off the floor so the LED
  // reveal under it reads as the art's floor glow rather than as a skirting
  b.add(rbox(w - 9, h - 5.4, d - 14, base, 0, 2.6, 0, 0.8));
  b.add(rbox(w - 13, 2.6, d - 18, mat("aiCarbonDeep", 0.9), 0, 0, 0, 0.4));
  // TOP: a 2.4 slab, generously radiused — the art's corners are the softest in the office
  b.add(rbox(w, 2.4, d, top, 0, h - 2.4, 0, 2.4, 3));
  b.add(rbox(w + 0.4, 0.7, d + 0.4, mat("aiCarbonDeep", 0.75), 0, h - 2.9, 0, 0.4));
  b.bakeInto(g, "ai-bench-body");
  // THE SPINE: a shallow tray down the centre line, with the lit line inside it
  const sp = new Baker();
  sp.add(rbox(SPINE_W + 2.4, 1.0, d - 6, mat("aiCarbonDeep", 0.8), 0, h - 0.5, 0, 0.4));
  sp.bakeInto(g, "ai-bench-spine");
  ledLine(g, SPINE_W, 0.5, d - 10, 0, h + 0.3, 0, led);
  // the FLOOR GLOW under the plinth reveal — one additive plane, the cheapest honest reading of the art
  const wash = rbox(w - 5, 0.02, d - 10, glowMat(led, 0.20), 0, 0.12, 0, 1.0);
  wash.castShadow = wash.receiveShadow = false;
  g.add(wash);
  // DRESSING. Three places a side; the art gives the two end places a monitor on the spine and the middle
  // place a laptop, with one plant standing at the bench's centre.
  const places = [-d * 0.29, 0, d * 0.29];
  places.forEach((lz, i) => {
    for (const s of [-1, 1] as const) {
      const deck = new Baker();
      peripherals(deck, 0, h, lz, s);
      deck.bakeInto(g, `ai-bench-kit-${i}-${s > 0 ? "e" : "w"}`);
      if (i === 1) continue; // the centre place carries the shared plant instead
      if (i === 0) {
        const mon = monitor(0, h + 1.2, lz + s * 0.2, 14, 8.2);
        mon.rotation.y = s > 0 ? 0 : Math.PI;
        mon.position.x = s * 3.2;
        g.add(mon);
      } else {
        const lap = laptop(s * 5.4, h, lz);
        lap.rotation.y = s > 0 ? 0 : Math.PI;
        g.add(lap);
      }
    }
  });
  deskPot(g, 0, h + 1.0, 0, 2.2);
  g.add(mug(-w * 0.26, h, d * 0.12));
  g.add(mug(w * 0.26, h, -d * 0.12));
  // the headphone cradle and the speaker puck the art puts on the west deck
  const kit = new Baker();
  kit.add(rbox(4.4, 1.0, 4.4, carbon("aiCarbon"), -w * 0.27, h, -d * 0.06, 0.5));
  kit.add(cyl(2.0, 1.6, carbon("aiCarbon"), w * 0.27, h, d * 0.06, 2.0));
  kit.bakeInto(g, "ai-bench-props");
  return g;
}

/** LEAD DESK (ai-lead-desk.png). The same charcoal slab in a single-person size, on two dark tapered legs,
 *  with the blue LED line running the full width under its front edge — the asset's signature. */
function leadDesk(e: Entity): THREE.Group {
  const r = rectOf(e);
  const g = placed(r, facingOf(e));
  const { w, d } = localSize(r, facingOf(e));
  const h = num(e, "h", AI_DESK_TOP);
  const top = slab(key(e, "color", "aiCharcoal"));
  const led = key(e, "led", "aiLed");
  shadow(g, w, d, 0.17);
  const b = new Baker();
  b.add(rbox(w, 2.6, d, top, 0, h - 2.6, 0, 2.2, 3)); //                       the slab
  b.add(rbox(w + 0.4, 0.7, d + 0.4, mat("aiCarbonDeep", 0.75), 0, h - 3.1, 0, 0.4));
  // two tapered legs, set well in from the ends as the art draws them
  for (const s of [-1, 1]) {
    const leg = rbox(2.6, h - 3.1, d - 7, carbon("aiCarbon"), s * (w / 2 - 4.5), 0, 0, 0.6);
    b.add(leg);
  }
  b.add(rbox(w - 12, 1.4, 1.6, carbon(), 0, h - 9.0, d / 2 - 1.4, 0.3)); //     modesty rail
  b.bakeInto(g, "ai-lead-desk");
  // THE LED LINE under the front (local +z, the visitor side) edge, plus its floor wash
  ledLine(g, w - 2, 0.7, 1.0, 0, h - 3.6, d / 2 - 0.5, led);
  const wash = rbox(w - 4, 0.02, d - 6, glowMat(led, 0.16), 0, 0.12, 0, 1.0);
  wash.castShadow = wash.receiveShadow = false;
  g.add(wash);
  // DRESSING, straight off the asset: laptop centred, mug and plant to the sitter's right
  g.add(laptop(-2.0, h, -d / 2 + 12.0));
  g.add(mug(w * 0.18, h, -d / 2 + 12.0));
  deskPot(g, w * 0.34, h, -d / 2 + 12.0, 2.2);
  return g;
}

// ---- chairs ----------------------------------------------------------------------------------------
/** the brushed five-star base + castors every chair in this room stands on */
function starBase(b: Baker, seatW: number, seatTop: number, fr: THREE.Material, legs = 5): void {
  for (let i = 0; i < legs; i++) {
    const a = (i / legs) * Math.PI * 2 + 0.35, spread = seatW * 0.54;
    const arm = rbox(spread, 1.3, 1.8, fr, 0, 1.5, 0, 0.5);
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
}

/** TASK CHAIR (ai-member-chair.png): a warm WHITE dished seat under a curved wrap-around back, with
 *  brushed SILVER arms looping from the back posts to the front of the seat. The white-and-silver pairing
 *  is what makes it read as THIS chair and not as the CMS blue barrel or the Design Room's pods. */
function taskChair(e: Entity): THREE.Group {
  const r = rectOf(e);
  const g = placed(r, facingOf(e));
  const { w, d } = localSize(r, facingOf(e));
  const hide = fabric(key(e, "color", "aiSeat"));
  const fr = frameMat(key(e, "frame", "aiFrame"));
  shadow(g, w * 0.95, d * 0.95, 0.15);
  const b = new Baker();
  const seatW = Math.min(w, d) * 0.84, seatTop = AI_TASK_CHAIR.cushionTop;
  starBase(b, seatW, seatTop, fr);
  // SEAT: a rounded pad with a dished top — softer and squarer than a barrel, as the art draws it
  b.add(rbox(seatW, 3.6, seatW * 0.94, hide, 0, seatTop - 3.6, 0, 2.0, 3));
  b.add(cyl(seatW * 0.42, 0.9, hide, 0, seatTop - 1.0, 0, seatW * 0.46));
  // BACK: a tall curved wrap, reclined, with a rolled top edge
  const back = new THREE.Group();
  back.position.set(0, seatTop - 1.6, d * 0.31);
  back.rotation.x = -0.18;
  g.add(back);
  const bb = new Baker();
  bb.add(rbox(seatW * 0.94, 11.0, 2.8, hide, 0, 0, 0, 1.8, 3));
  bb.add(rbox(seatW * 0.80, 2.2, 3.2, hide, 0, 9.8, -0.4, 1.2, 3)); //           rolled top edge
  for (const s of [-1, 1]) { //                                                  the wrap's two wings
    const wing = rbox(2.6, 9.2, 3.2, hide, s * (seatW * 0.45), 0.6, -1.1, 1.3, 3);
    wing.rotation.y = -s * 0.34;
    bb.add(wing);
  }
  bb.bakeInto(back, "ai-task-back");
  // ARMS: a silver loop each side, back post → armrest → down to the seat front
  for (const s of [-1, 1]) {
    const post = rbox(1.5, 8.2, 1.5, fr, s * (seatW * 0.55), seatTop - 4.8, d * 0.18, 0.5);
    post.rotation.z = -s * 0.09;
    b.add(post);
    b.add(rbox(2.1, 1.4, d * 0.46, fr, s * (seatW * 0.57), seatTop + 2.8, -d * 0.02, 0.7));
    b.add(cyl(0.7, 5.2, fr, s * (seatW * 0.57), seatTop - 2.6, -d * 0.20));
  }
  b.bakeInto(g, "ai-task-chair");
  return g;
}

/** LEAD CHAIR (ai-lead-chair.png, the tall one): a light grey three-panel tufted back under a SEPARATE
 *  floating headrest, dark grey arms, polished base. The headrest and the horizontal tufting seams are
 *  the asset's signature and are built, not implied. */
function leadChair(e: Entity): THREE.Group {
  const r = rectOf(e);
  const g = placed(r, facingOf(e));
  const { w, d } = localSize(r, facingOf(e));
  const hide = fabric(key(e, "color", "aiSeatLead"));
  const fr = frameMat(key(e, "frame", "aiFrame"));
  shadow(g, w * 0.98, d * 0.98, 0.16);
  const b = new Baker();
  const seatTop = AI_LEAD_CHAIR.cushionTop, seatW = w * 0.80;
  starBase(b, seatW, seatTop, fr);
  b.add(rbox(seatW, 4.0, seatW * 0.96, hide, 0, seatTop - 4.0, 0, 2.2, 3)); //   seat pad
  // BACK: three stacked panels with the art's seams between them, on a slight recline
  const back = new THREE.Group();
  back.position.set(0, seatTop - 2.0, d * 0.26);
  back.rotation.x = -0.15;
  g.add(back);
  const bb = new Baker();
  for (let i = 0; i < 3; i++) {
    const y = 1.4 + i * 6.4;
    bb.add(rbox(seatW * (0.94 - i * 0.02), 5.6, 3.0, hide, 0, y, 0, 1.5, 3));
    bb.add(rbox(seatW * 0.90, 0.6, 3.4, mat("aiCarbon", 0.85), 0, y + 5.6, -0.1, 0.25)); // seam
  }
  // the FLOATING HEADREST, held off the top panel on two short stems
  for (const s of [-1, 1]) bb.add(cyl(0.5, 2.6, fr, s * seatW * 0.24, 20.6, 0.4));
  bb.add(rbox(seatW * 0.62, 4.0, 3.2, hide, 0, 23.0, 0, 1.6, 3));
  bb.bakeInto(back, "ai-lead-back");
  // ARMS: dark grey, curved in from the back posts
  for (const s of [-1, 1]) {
    const arm = rbox(1.8, 1.6, d * 0.48, mat("aiCarbon", 0.6), s * (seatW * 0.56), seatTop + 3.2, -d * 0.02, 0.7);
    b.add(arm);
    const stem = cyl(0.8, 6.0, mat("aiCarbon", 0.6), s * (seatW * 0.56), seatTop - 2.4, d * 0.14);
    stem.rotation.z = -s * 0.12;
    b.add(stem);
  }
  b.bakeInto(g, "ai-lead-chair");
  return g;
}

/** VISITOR CHAIR (the two low chairs on the same sheet): a grey tub shell with WHITE wrapped arms, on a
 *  four-star castor base. Half the height of the lead chair, which is exactly how the art reads them. */
function visitorChair(e: Entity): THREE.Group {
  const r = rectOf(e);
  const g = placed(r, facingOf(e));
  const { w, d } = localSize(r, facingOf(e));
  const hide = fabric(key(e, "color", "aiSeatVisitor"));
  const fr = frameMat(key(e, "frame", "aiFrame"));
  shadow(g, w * 0.95, d * 0.95, 0.15);
  const b = new Baker();
  const seatW = Math.min(w, d) * 0.86, seatTop = AI_VISITOR_CHAIR.cushionTop;
  starBase(b, seatW, seatTop, fr, 4);
  // TUB: a low shell drawn in at the base with a dished pad sunk into its top
  b.add(lathe([[seatW * 0.42, 0], [seatW * 0.50, 1.6], [seatW * 0.52, 4.6], [seatW * 0.50, 5.4], [0, 5.4]],
    hide, 0, seatTop - 5.4, 0, 20));
  b.add(cyl(seatW * 0.46, 1.2, hide, 0, seatTop - 1.1, 0, seatW * 0.49));
  // the low wrapped back, barely proud of the arms
  const back = new THREE.Group();
  back.position.set(0, seatTop - 0.8, d * 0.28);
  back.rotation.x = -0.20;
  g.add(back);
  const bb = new Baker();
  bb.add(rbox(seatW * 0.94, 5.6, 2.8, hide, 0, 0, 0, 1.6, 3));
  for (const s of [-1, 1]) {
    const wing = rbox(2.4, 5.0, 3.0, hide, s * (seatW * 0.44), 0.3, -1.0, 1.2, 3);
    wing.rotation.y = -s * 0.40;
    bb.add(wing);
  }
  bb.bakeInto(back, "ai-visitor-back");
  // WHITE arms: a wrapped pad each side running the tub's full depth
  for (const s of [-1, 1])
    b.add(rbox(2.6, 2.0, d * 0.52, plastic("white"), s * (seatW * 0.52), seatTop + 1.2, -d * 0.02, 0.9));
  b.bakeInto(g, "ai-visitor-chair");
  return g;
}

// ---- the service robot -----------------------------------------------------------------------------
/** THE OPS ROBOT — the white service droid the reference parks on its charging pad in the north-west
 *  corner, and the one object a visitor remembers this room by. A tapered white shell, a dark visor with
 *  two cyan eyes, a lit chest panel and a blue charging ring under it. Built by build/ai.ts as part of the
 *  room's static fit-out (it never moves), but modelled here with the rest of the room's furniture. */
export function opsRobot(cx: number, cz: number, r: number, h: number): THREE.Group {
  const g = new THREE.Group();
  g.name = "ai-robot-body"; // the DOCK group is the "ai-robot" pick target; this is the droid on it
  g.position.set(cx, 0, cz);
  const shell = mat("aiRobot", 0.42);
  const b = new Baker();
  // BODY: a tapered column, widest at the waist, drawn in at the base and the shoulders
  b.add(lathe([[r * 0.62, 0], [r * 0.80, 2.0], [r * 0.92, h * 0.30], [r * 0.88, h * 0.62],
    [r * 0.74, h * 0.78], [r * 0.70, h * 0.86], [0, h * 0.88]], shell, 0, 0, 0, 24));
  // HEAD: a rounded cap sitting on a short neck
  b.add(cyl(r * 0.34, 2.0, shell, 0, h * 0.86, 0, r * 0.44));
  b.add(rbox(r * 1.06, h * 0.20, r * 0.92, shell, 0, h * 0.86, 0, r * 0.44, 3));
  b.bakeInto(g, "ai-robot-shell");
  // VISOR: a dark wrapped band across the front (local −z, facing into the room)
  const visor = rbox(r * 0.92, h * 0.10, 0.9, mat("aiCarbonDeep", 0.25), 0, h * 0.92, -r * 0.44, 0.45);
  visor.castShadow = false;
  g.add(visor);
  for (const s of [-1, 1]) {
    const eye = cyl(0.9, 0.4, emissiveMat("aiLed", 2.2, 0.25), s * r * 0.22, h * 0.955, -r * 0.46, 0.9);
    eye.rotation.x = Math.PI / 2;
    eye.castShadow = eye.receiveShadow = false;
    g.add(eye);
  }
  // CHEST PANEL: the lit status display the art draws "AUTOMATE / SCALE" on
  const chest = rbox(r * 0.72, h * 0.20, 0.7, emissiveMat("aiScreenUi", 0.9, 0.3), 0, h * 0.40, -r * 0.82, 0.4);
  chest.castShadow = false;
  g.add(chest);
  ledLine(g, r * 0.60, 0.4, 0.5, 0, h * 0.505, -r * 0.86);
  // CHARGING RING at its foot
  const ring = cyl(r * 0.96, 0.3, glowMat("aiLed", 0.34), 0, 0.3, 0, r * 0.96);
  ring.castShadow = ring.receiveShadow = false;
  g.add(ring);
  g.add(rbox(r * 0.5, 1.0, r * 0.5, metal(), 0, 0, 0, 0.3));
  return g;
}

export function buildAiFurniture(e: Entity): THREE.Group | null {
  switch (e.kind as AiKind) {
    case "ai-bench-desk": return benchDesk(e);
    case "ai-lead-desk": return leadDesk(e);
    case "ai-task-chair": return taskChair(e);
    case "ai-lead-chair": return leadChair(e);
    case "ai-visitor-chair": return visitorChair(e);
    default: return null;
  }
}
