// vo3d build — Design Team furniture kinds (promoted verbatim from designRoom3d/build.ts).
// `item.rect` is a WORLD-space footprint rect; groups are positioned at its centre.
import * as THREE from "three";
import type { Facing, Rect } from "../core/coords";
import { Baker, cyl, lathe, localSize, placed, rbox, shadowed, slab, sphereGeo } from "./helpers";
import { contactShadowMat, emissiveMat, fabric, mat, metal, plastic, wood, type MatKey } from "../render/Materials";
import { book, laptop, monitor, mug, smallPot } from "./props";

export type FurnitureKind =
  | "lead-desk" | "member-desk" | "desk-panel" | "curve-desk" | "side-desk"
  | "sofa" | "beanbag" | "rug" | "chair-a" | "chair-b" | "lead-chair"
  | "tub-chair" | "round-table" | "conference-table" | "lounge-table" | "gaming-chair"
  | "cafe-table" | "cafe-chair" | "armchair";
export const FURNITURE_KINDS: readonly FurnitureKind[] = ["lead-desk", "member-desk", "desk-panel", "curve-desk", "side-desk", "sofa", "beanbag", "rug", "chair-a", "chair-b", "lead-chair", "tub-chair", "round-table", "conference-table", "lounge-table", "gaming-chair", "cafe-table", "cafe-chair", "armchair"];
export type FurnitureItem = { kind: FurnitureKind; rect: Rect; facing: Facing; mirrored: boolean;
  /** upholstery tone. Default = the Design/Gaming rooms' brighter green; "lounge" = reception's darker olive. */
  tone?: "lounge";
  /** PER-PIECE COLOUR (Phase 5B). When set it overrides `tone` entirely. Rooms route these from their own
   *  THEME table (see rooms/gaming.ts) so a future colour editor has one place to write. */
  color?: MatKey;
  /** seat/cushion colour; falls back to `color` */
  colorSeat?: MatKey;
  /** trim colour: chair bolsters, sofa pillows, rug inlay */
  accent?: MatKey;
  /** rug plan shape. Default (omitted) = the round rug the Design Room has always built. */
  shape?: "rect";
  /** emissive intensity of a rug's accent inlay — printed line art catching light, not a light source */
  glow?: number;
  /** SOFA cushion count. Default 2 (every pre-5C sofa). The formula below reduces to the historical
   *  numbers exactly at 2, so Design's and Project's sofas are untouched to the last decimal. */
  seats?: number };
const seatFabric = (t: FurnitureItem, seat = false) =>
  t.color ? fabric(seat ? (t.colorSeat ?? t.color) : t.color)
    : t.tone === "lounge" ? fabric(seat ? "loungeOliveSeat" : "loungeOlive") : fabric(seat ? "greenSeat" : "green");
/** soft contact shadow under a lounge piece (a dark translucent plate just above the floor) */
function contactShadow(g: THREE.Group, w: number, d: number, round = false): void {
  const m = round ? cyl(w / 2 + 3, 0.02, contactShadowMat(0.15, "round"), 0, 0.03, 0) : rbox(w + 5, 0.02, d + 5, contactShadowMat(0.15), 0, 0.03, 0, 2.5);
  m.castShadow = m.receiveShadow = false;
  g.add(m);
}

// ---- furniture ------------------------------------------------------------------------------
const DESK_H = 24;
const TOP_T = 2.4;

function deskTop(w: number, d: number, radius = 1.8): THREE.Mesh {
  return rbox(w, TOP_T, d, wood(), 0, DESK_H - TOP_T, 0, radius, 3);
}
/** Olive drawer pedestal with two drawer fronts and small bar handles. */
function pedestal(w: number, d: number, cx: number, cz: number, h = DESK_H - TOP_T - 0.8): THREE.Group {
  const g = new THREE.Group();
  g.add(rbox(w, h, d, fabric("green"), cx, 0.8, cz, 1.0, 3));
  g.add(rbox(w - 1, 0.8, d - 1, mat("greenDark", 0.9), cx, 0, cz, 0.2)); // plinth
  for (let i = 0; i < 2; i++) {
    const y = 0.8 + h * (0.12 + i * 0.44);
    g.add(rbox(w - 1.6, h * 0.36, 0.5, mat("greenSeat", 0.9), cx, y, cz + d / 2 + 0.05, 0.4)); // drawer front
    g.add(rbox(w * 0.45, 0.5, 0.5, metal(), cx, y + h * 0.36 - 1.2, cz + d / 2 + 0.55, 0.2)); // handle
  }
  return g;
}
function deskLeg(cx: number, cz: number): THREE.Mesh {
  return rbox(1.4, DESK_H - TOP_T, 1.4, metal(), cx, 0, cz, 0.5);
}

function leadDesk(item: FurnitureItem): THREE.Group {
  // production: an asymmetric curved top (straight back edge, soft bulging front-right)
  // over a fluted olive plinth, monitor centred, notebook left, pad + plant + mug right
  const g = placed(item.rect, item.facing);
  const { w, d } = localSize(item.rect, item.facing);
  const hw = w / 2, hd = d / 2;
  const top = new THREE.Shape();
  top.moveTo(-hw + 6, -hd);
  top.lineTo(hw - 8, -hd);
  top.bezierCurveTo(hw + 1, -hd, hw + 1, -hd * 0.1, hw - 1, hd * 0.55);
  top.bezierCurveTo(hw - 3, hd * 1.05, hw * 0.35, hd * 1.05, 0, hd * 0.9);
  top.bezierCurveTo(-hw * 0.5, hd * 0.75, -hw * 0.95, hd * 0.9, -hw, hd * 0.35);
  top.bezierCurveTo(-hw - 1, -hd * 0.3, -hw - 0.5, -hd, -hw + 6, -hd);
  g.add(slab(top, TOP_T, wood("extrude", true), DESK_H - TOP_T, 0.8));
  // base: inset copy of the top outline, olive, with vertical flutes on the camera-facing run
  const base = new THREE.Shape();
  const k = 0.78;
  base.moveTo((-hw + 6) * k, -hd * k);
  base.lineTo((hw - 8) * k, -hd * k);
  base.bezierCurveTo((hw + 1) * k, -hd * k, (hw + 1) * k, -hd * 0.1 * k, (hw - 1) * k, hd * 0.55 * k);
  base.bezierCurveTo((hw - 3) * k, hd * 1.05 * k, hw * 0.35 * k, hd * 1.05 * k, 0, hd * 0.9 * k);
  base.bezierCurveTo(-hw * 0.5 * k, hd * 0.75 * k, -hw * 0.95 * k, hd * 0.9 * k, -hw * k, hd * 0.35 * k);
  base.bezierCurveTo((-hw - 1) * k, -hd * 0.3 * k, (-hw - 0.5) * k, -hd * k, (-hw + 6) * k, -hd * k);
  g.add(slab(base, DESK_H - TOP_T - 1.2, fabric("green"), 0.6, 0.3));
  for (let i = -6; i <= 6; i++) {
    // flutes: thin olive-dark ribs along the front bulge
    const t = i / 6;
    const x = t * hw * 0.62;
    const z = hd * k * (0.92 - 0.12 * t * t) + 0.35;
    g.add(rbox(1.1, DESK_H - TOP_T - 2.4, 0.9, mat("greenDark", 0.9), x, 1.2, z, 0.35));
  }
  g.add(monitor(0, DESK_H, 0));
  g.add(book(-w * 0.32, DESK_H, -1, 6.5, 8.5, "greenDark", 0.08));
  g.add(rbox(6, 0.35, 7.5, plastic("white"), w * 0.24, DESK_H, 2.5, 0.2));
  g.add(smallPot(w * 0.38, DESK_H, -2.5, 1.7));
  g.add(mug(w * 0.3, DESK_H, 7));
  return g;
}

function memberDesk(item: FurnitureItem): THREE.Group {
  // column desk: wood top, olive pedestal on the wall side, slim metal leg on the open side,
  // olive modesty lip along the wall edge, laptop, two small pots, mug
  const g = placed(item.rect, item.facing);
  const { w, d } = localSize(item.rect, item.facing);
  g.add(deskTop(w, d));
  g.add(pedestal(w * 0.36, d * 0.86, -w * 0.3, 0));
  g.add(deskLeg(w * 0.42, -d * 0.42));
  g.add(deskLeg(w * 0.42, d * 0.42));
  g.add(rbox(w * 0.94, 3.2, 1.1, fabric("green"), 0, DESK_H - 3.2 - TOP_T, d / 2 - 0.9, 0.4)); // apron
  g.add(rbox(w * 0.9, 1.6, 1.2, mat("greenDark", 0.9), 0, DESK_H - 0.4, d / 2 - 0.6, 0.4)); // back lip
  g.add(laptop(w * 0.08, DESK_H, 0.5));
  g.add(smallPot(-w * 0.32, DESK_H, -d * 0.32, 1.4));
  g.add(smallPot(-w * 0.32, DESK_H, d * 0.32, 1.4));
  g.add(mug(w * 0.34, DESK_H, -d * 0.36));
  return g;
}

function deskPanel(item: FurnitureItem): THREE.Group {
  // bottom row of the U: wide top, olive drawer pedestals both ends, modesty panel, laptop, pots
  const g = placed(item.rect, item.facing);
  const { w, d } = localSize(item.rect, item.facing);
  g.add(deskTop(w, d));
  g.add(pedestal(w * 0.22, d * 0.78, -w * 0.37, 0.5));
  g.add(pedestal(w * 0.22, d * 0.78, w * 0.37, 0.5));
  g.add(rbox(w * 0.98, DESK_H - TOP_T - 6, 1.1, fabric("green"), 0, 5, -d / 2 + 0.7, 0.5)); // modesty panel
  g.add(laptop(0, DESK_H, 1.5));
  g.add(smallPot(-w * 0.27, DESK_H, -d * 0.25, 1.5));
  g.add(smallPot(-w * 0.27, DESK_H, d * 0.27, 1.5));
  g.add(smallPot(w * 0.3, DESK_H, d * 0.27, 1.5));
  g.add(mug(w * 0.28, DESK_H, -d * 0.28));
  return g;
}

function curveDesk(item: FurnitureItem): THREE.Group {
  // The corner connector joining a side desk COLUMN to the bottom workstation ROW. In the production
  // reference the two corners are chamfered on their OUTER corner — the left desk's cut faces south-WEST
  // toward the lounge, the right desk's faces south-EAST — so both runs meet the corner at full width and
  // the U's inner edge stays unbroken. Nothing cuts inward at the workstation area.
  //
  // Getting there needs two independent things right, and they are easy to confuse:
  //
  //   WHERE it sits — the slabs are anchored at the rect's SOUTH edge, not its north. slab() maps shape +y
  //     to world −z, so with world z = (rect.z + d) − y the wedge spans exactly rect.z … rect.z + d: its
  //     own footprint. Anchoring at rect.z instead drew both slabs a full depth NORTH of the entity, on top
  //     of the column desk, leaving the desk pad and pot hovering over bare floor.
  //   WHICH WAY ROUND — mirroring the shape's y values ALSO fixes the position, but flips the wedge so the
  //     cut points north into the room. Use the anchor, never the y mirror.
  //
  // The points below are therefore authored SOUTH-FIRST (y = 0 lands at the greatest z), and `mx` reflects
  // them so each desk's cut lands on the side AWAY from the room's centre line: the un-mirrored instance is
  // the reflected one, because the left-hand desk is the one whose outer side is its own +x... which is to
  // say the sense here is opposite to the plain `mirrored` flag every other builder uses.
  const { w, d } = item.rect;
  const mx = (x: number) => (item.mirrored ? x : w - x);
  const shapeOf = (inset: number): THREE.Shape => {
    const s = new THREE.Shape();
    const pts: [number, number][] = [
      [mx(inset), inset],
      [mx(w * 0.48), inset],
      [mx(w - inset), d * 0.5],
      [mx(w - inset), d - inset],
      [mx(inset), d - inset],
    ];
    pts.forEach(([x, y], i) => (i === 0 ? s.moveTo(x, y) : s.lineTo(x, y)));
    s.closePath();
    return s;
  };
  const g = new THREE.Group();
  const top = slab(shapeOf(0), TOP_T, wood("extrude"), DESK_H - TOP_T, 0.7);
  const base = slab(shapeOf(2.4), DESK_H - TOP_T - 1.4, fabric("green"), 0.6, 0.3);
  top.position.x = item.rect.x;
  top.position.z = item.rect.z + d; // anchored at the rect's SOUTH edge; see shapeOf above
  base.position.x = item.rect.x;
  base.position.z = item.rect.z + d;
  g.add(top, base);
  g.add(smallPot(item.rect.x + mx(w * 0.6), DESK_H, item.rect.z + d * 0.72, 1.5));
  const pad = rbox(7, 0.5, 5, plastic("white"), item.rect.x + mx(w * 0.62), DESK_H, item.rect.z + d * 0.33, 0.2);
  pad.rotation.y = item.mirrored ? -0.5 : 0.5;
  g.add(pad);
  return g;
}

function sideDesk(item: FurnitureItem): THREE.Group {
  const g = placed(item.rect, item.facing);
  const r = Math.min(item.rect.w, item.rect.d) / 2;
  const h = 19;
  g.add(lathe([[0, h - TOP_T], [r - 1.2, h - TOP_T], [r, h - TOP_T + 0.6], [r, h - 0.5], [r - 0.6, h], [0, h]], wood("box", true), 0, 0, 0, 40));
  g.add(cyl(2.4, h - TOP_T, wood(), 0, 0.8, 0));
  g.add(lathe([[0, 0], [r * 0.55, 0], [r * 0.5, 0.9], [2.6, 1.2], [0, 1.2]], wood(), 0, 0, 0, 32));
  g.add(smallPot(0.5, h, -4, 1.7));
  g.add(book(2, h, 5, 7, 5, "white", 0.15));
  g.add(book(1.6, h + 0.9, 5.2, 6, 4.4, "greenDark", -0.1));
  return g;
}

/** SOFA cushion layout, exported so a room's seat metadata is derived from the same numbers the geometry
 *  uses. `lounge` tone cushions sit on an 8-deep deck + 2, 5.6 tall → their TOP surface is 15.6, and their
 *  local x centre is backW/2 + 0.5 = 5.0 (backW is 9 for the lounge tone). */
export const SOFA_CUSHION_GAP = 1.2;
export const SOFA_CUSHION_MARGIN = 0.9;
export const SOFA_CUSHION_TOP = 15.6;
export const SOFA_CUSHION_LOCAL_X = 5.0;
export const SOFA_ARM_W = 6.5;
export const SOFA_BACK_W = 9;
/** depth of one cushion for a lounge sofa `d` long with `seats` places */
export const sofaCushionDepth = (d: number, seats: number): number =>
  (d - 2 * SOFA_ARM_W - (seats - 1) * SOFA_CUSHION_GAP - 2 * SOFA_CUSHION_MARGIN) / seats;
/** furniture-local z of cushion `i` */
export const sofaCushionZ = (i: number, seats: number, cushD: number): number =>
  (i - (seats - 1) / 2) * (cushD + SOFA_CUSHION_GAP);

function sofa(item: FurnitureItem): THREE.Group {
  // along the left wall: soft deck, two puffy seat cushions, two back cushions
  // against a rounded back panel, rounded arms, short feet, two pillows.
  // The build is authored back-to-WEST, so `facing` is not used here (the manifest gives every sofa the
  // default "south"); `mirrored` flips it back-to-EAST for a sofa on the other side of a composition.
  // Authored back-to-WEST with its long axis in local z; `mirrored` flips it back-to-EAST. The Design and
  // Project rooms only ever need those two and pass the manifest's default "south", so north/south keep
  // the historical no-rotation behaviour exactly. A room whose sofa runs along X instead — Gaming's backs
  // onto the south wall and faces the display — passes "east"/"west" and gets the quarter turn.
  const spun = item.facing === "east" || item.facing === "west";
  const g = placed(item.rect, spun ? item.facing : "north");
  if (item.mirrored) g.rotation.y += Math.PI;
  const { w, d } = item.rect;
  const lounge = item.tone === "lounge";
  if (lounge) contactShadow(g, w, d);
  const deckH = 8, armW = lounge ? 6.5 : 5, backW = lounge ? 9 : 7;
  g.add(rbox(w, deckH, d, seatFabric(item), 0, 2, 0, 3, 3));
  const footMat = item.color ? mat("charcoal", 0.8) : mat("greenDark", 0.8);
  for (let i = 0; i < 4; i++) g.add(cyl(1, 2, footMat, (i % 2 ? 1 : -1) * (w / 2 - 3), 0, (i < 2 ? 1 : -1) * (d / 2 - 4)));
  // lounge tone: a lower, deeper back and rounder arms/cushions so the piece reads as upholstery from the
  // game camera rather than a box; the Design Room's default proportions are unchanged
  const backH = lounge ? 18 : 22, armH = lounge ? 13 : 15;
  const backMat = item.color ? fabric(item.color) : lounge ? fabric("loungeOlive") : fabric("greenDark");
  g.add(rbox(backW, backH, d - 1, backMat, -w / 2 + backW / 2, 2, 0, lounge ? 4 : 3, 3)); // back panel (wall side)
  for (const s of [-1, 1]) g.add(rbox(w - backW + 1, armH, armW, seatFabric(item), backW / 2, 2, s * (d / 2 - armW / 2), lounge ? 3.2 : 2.4, 3)); // arms
  const cushW = w - backW - 1.5;
  const seats = Math.max(1, item.seats ?? 2);
  // n cushions, SOFA_CUSHION_GAP between neighbours and SOFA_CUSHION_MARGIN inside each arm.
  // At n = 2 this yields cushD = (d - 2*armW - 3)/2 and z = ±(cushD/2 + 0.6): the pre-5C numbers exactly.
  const cushD = (d - 2 * armW - (seats - 1) * SOFA_CUSHION_GAP - 2 * SOFA_CUSHION_MARGIN) / seats;
  for (let i = 0; i < seats; i++) {
    const lz = sofaCushionZ(i, seats, cushD);
    g.add(rbox(cushW, lounge ? 5.6 : 4.2, cushD, seatFabric(item, true), backW / 2 + 0.5, deckH + 2, lz, lounge ? 2.8 : 2, 3)); // seat cushions
    const back = rbox(lounge ? 6 : 4.5, lounge ? 13 : 12, cushD - 1, seatFabric(item, true), -w / 2 + backW + (lounge ? 2.2 : 1.6), deckH + 2, lz, lounge ? 2.8 : 2, 3); // back cushions
    back.rotation.z = -0.12;
    g.add(back);
  }
  // pillows: the source shows ONE loose cushion per sofa in a matching tone; the Design Room keeps its two
  if (item.accent) {
    // a themed pair: the artwork's gaming sofa carries one accent cushion at each end
    for (const s2 of [-1, 1]) {
      const p = rbox(9, 3.4, 9, fabric(s2 < 0 ? item.accent : (item.colorSeat ?? item.accent)), backW / 2 + 1, deckH + 7.2, s2 * d * 0.26, 2, 3);
      p.rotation.y = s2 * 0.38;
      g.add(p);
    }
  } else if (lounge) {
    const p = rbox(9, 3.4, 9, fabric("cushionCream"), backW / 2 + 1, deckH + 7.6, -d * 0.16, 2, 3);
    p.rotation.y = 0.4;
    g.add(p);
  } else {
    const p1 = rbox(8.5, 3.2, 8.5, fabric("cushionGray"), backW / 2 + 0.5, deckH + 6.2, -d * 0.2, 1.6, 3);
    p1.rotation.y = 0.35;
    const p2 = rbox(8.5, 3.2, 8.5, fabric("cushionCream"), backW / 2 + 1, deckH + 6.2, d * 0.22, 1.6, 3);
    p2.rotation.y = -0.45;
    g.add(p1, p2);
  }
  return g;
}

function beanbag(item: FurnitureItem): THREE.Group {
  // inflated bag: revolved profile with a soft top dimple and a pinched base
  const g = placed(item.rect, "north");
  const r = Math.min(item.rect.w, item.rect.d) / 2;
  const h = r * 1.05;
  const prof: [number, number][] = [[0, 0.2], [r * 0.55, 0], [r * 0.9, h * 0.18], [r, h * 0.42], [r * 0.9, h * 0.72], [r * 0.6, h * 0.94], [r * 0.25, h], [0, h * 0.95]];
  const bag = lathe(prof, fabric(item.color ?? "green"), 0, 0, 0, 28);
  bag.rotation.y = 0.6;
  g.add(bag);
  g.add(cyl(1.4, 0.5, mat(item.color ? "charcoal" : "greenDark", 0.9), 0, h * 0.94, 0)); // stitched crown button
  return g;
}

function rug(item: FurnitureItem): THREE.Group {
  const g = placed(item.rect, "north");
  if (item.shape === "rect") {
    // RECTANGULAR rug (Phase 5B): a low pile slab with an inset border inlay. `glow` makes the inlay
    // faintly emissive — the Gaming Room's gamepad print reads as printed line art picking up the room's
    // LEDs, which is why the intensity is a third of a real strip's and it is never animated.
    const { w, d } = item.rect;
    const base = rbox(w, 0.7, d, mat(item.color ?? "rug", 1), 0, 0, 0, 1.6);
    base.castShadow = false;
    g.add(base);
    if (item.accent) {
      const inlay = item.glow ? emissiveMat(item.accent, item.glow, 0.6) : mat(item.accent, 1);
      const t = 2.2, inset = 7;
      for (const s of [-1, 1]) {
        const a = rbox(w - inset * 2, 0.12, t, inlay, 0, 0.7, s * (d / 2 - inset), 0.05);
        const b = rbox(t, 0.12, d - inset * 2, inlay, s * (w / 2 - inset), 0.7, 0, 0.05);
        a.castShadow = b.castShadow = false;
        g.add(a, b);
      }
    }
    return g;
  }
  const r = Math.min(item.rect.w, item.rect.d) / 2;
  const m = cyl(r, 0.7, mat(item.color ?? "rug", 1), 0, 0, 0);
  m.castShadow = false;
  g.add(m);
  // woven rings
  for (let i = 1; i <= 3; i++) g.add(cyl(r * (1 - i * 0.22), 0.12, mat("wood", 1), 0, 0.7, 0));
  return g;
}

/** THE CHAIR'S REAL PLAN EXTENT, from the same numbers `chair()` builds with.
 *
 *  A task chair is a five-star base: the widest thing in plan is the caster ring, not the seat. `chair()`
 *  derives everything from `seatW = min(w, d) * 0.8`, puts each caster centre at `seatW * 0.52 * 0.97`, and
 *  gives it a unit sphere — so this is the built chair's silhouette radius, and it moves if the builder
 *  does. It exists because the V1 asset manifest's layer box (which is what the footprint used to be) is an
 *  ART bounding box: it carries the PNG's drop shadow and transparent padding, and overstated every Design
 *  Room chair by 2.3–4.3 units wide and 3.1–11.6 deep. */
export function chairPlanRadius(w: number, d: number): number {
  const seatW = Math.min(w, d) * 0.8;
  return seatW * 0.52 * 0.97 + 1; // caster centre + caster radius (helpers.sphereGeo is a unit sphere)
}

function chair(item: FurnitureItem, style: "a" | "b" | "lead"): THREE.Group {
  // sculpted task chair: five tapered legs with casters, gas lift, seat pan,
  // rounded cushion, two-part contoured back (lumbar + upper) with a slight
  // recline, and L-shaped arms (styles a/lead)
  const g = placed(item.rect, item.facing);
  const { w, d } = localSize(item.rect, item.facing);
  const seatW = Math.min(w, d) * 0.8;
  const seatH = 13;
  const frame = style === "lead" ? mat("charcoal", 0.5) : plastic("white");
  const cushion = fabric(style === "lead" ? "greenDark" : "greenSeat");
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const len = seatW * 0.52;
    const leg = rbox(len, 1.3, 1.5, frame, 0, 0.7, 0, 0.5);
    leg.geometry.translate(len / 2, 0, 0);
    leg.rotation.y = -a;
    leg.rotation.z = 0.08;
    g.add(leg);
    const wheel = new THREE.Mesh(sphereGeo, mat("charcoal", 0.6));
    wheel.scale.set(1, 0.9, 1);
    wheel.position.set(Math.cos(a) * len * 0.97, 0.9, Math.sin(a) * len * 0.97);
    g.add(shadowed(wheel));
  }
  g.add(cyl(1.15, seatH - 3.5, metal(), 0, 1.4, 0));
  g.add(cyl(2.4, 1.2, frame, 0, seatH - 3.6, 0));
  g.add(rbox(seatW * 0.9, 1.4, seatW * 0.9, frame, 0, seatH - 3.2, 0.3, 0.6)); // seat pan
  g.add(rbox(seatW, 3.4, seatW, cushion, 0, seatH - 2, 0.3, 1.7, 3)); // cushion
  // back: lumbar block + upper shell, tilted back around the rear seat edge
  const back = new THREE.Group();
  back.position.set(0, seatH - 0.5, seatW / 2 - 1.2);
  back.rotation.x = -0.14;
  const backH = style === "lead" ? 20 : style === "a" ? 16 : 13;
  back.add(rbox(seatW * 0.86, backH * 0.42, 3.2, cushion, 0, 0, 0, 1.5, 3));
  const upper = rbox(seatW * 0.92, backH * 0.62, 2.6, cushion, 0, backH * 0.38, -0.6, 1.6, 3);
  upper.rotation.x = -0.1;
  back.add(upper);
  back.add(rbox(seatW * 0.16, backH * 0.9, 0.8, frame, 0, 0.8, 1.6, 0.35)); // slim spine
  back.add(rbox(seatW * 0.96, 1.1, 1.0, frame, 0, backH * 0.98, -0.2, 0.4)); // top rim
  g.add(back);
  if (style !== "b") {
    for (const s of [-1, 1]) {
      g.add(rbox(1.2, 6.5, 1.2, frame, s * (seatW / 2 - 0.9), seatH - 0.5, 1.5, 0.4));
      g.add(rbox(2.2, 1.3, seatW * 0.62, frame, s * (seatW / 2 - 0.9), seatH + 6, 0.4, 0.6, 3));
    }
  }
  return g;
}

/** Upholstered TUB / BARREL armchair: a wrap-around shell open at the front, a puffy seat cushion and
 *  small dark feet. Distinct from chair-a/b/lead, which are wheeled task chairs — the reception lounge
 *  chairs in the artwork have no castors, no gas lift and no spine. Reusable for any lounge setting. */
/** Vertical proportions of the tub chair, EXPORTED so seat metadata is derived from the same numbers the
 *  geometry uses and the two can never drift apart.
 *
 *  Measured against the production avatar seated (CLIP_SIT, 36 units standing):
 *      butt → shoulders   10.0     butt → crown   28.3
 *  The 3C chair was seatH 9.5 / backH 20 → cushion top 13.1 with a 20-high wrap-around rim, so the rim
 *  stood level with the sitter's shoulders and swallowed the whole torso. These proportions put the rim at
 *  arm height for this avatar. The PLAN footprint (radius, position, facing) is unchanged. */
export const TUB_CHAIR = { seatH: 6.6, backH: 14.5, cushionH: 4.4, cushionDrop: 0.8 };
/** cushion TOP surface in furniture-local space — the seat contact plane */
export const TUB_CUSHION_TOP = TUB_CHAIR.seatH - TUB_CHAIR.cushionDrop + TUB_CHAIR.cushionH;

function tubChair(item: FurnitureItem): THREE.Group {
  const g = placed(item.rect, item.facing);
  const { w, d } = localSize(item.rect, item.facing);
  const R = Math.min(w, d) / 2;
  const seatH = TUB_CHAIR.seatH, backH = TUB_CHAIR.backH, wall = R * 0.16;
  if (item.tone === "lounge") contactShadow(g, 2 * R, 2 * R, true);
  // shell: one revolved profile up the outside, over the rounded top and back down the inside.
  // LatheGeometry's phi starts at local +z (the chair's BACK, since placed() points local -z at `facing`),
  // so the opening is centred on phi = π and the shell wraps the remaining 250°.
  const prof: [number, number][] = [
    [R, 1.2], [R, backH * 0.55], [R * 0.99, backH * 0.9], [R * 0.93, backH],
    [R * 0.86, backH * 0.97], [R - wall, backH * 0.82], [R - wall, seatH], [R - wall - 1.2, seatH - 1.5],
  ];
  const pts = prof.map(([r, y]) => new THREE.Vector2(r, y));
  const shellGeo = new THREE.LatheGeometry(pts, 30, (235 * Math.PI) / 180, (250 * Math.PI) / 180);
  g.add(shadowed(new THREE.Mesh(shellGeo, seatFabric(item))));
  // low front rail closing the tub between the two shell ends
  g.add(rbox(R * 1.15, seatH + 1.5, wall * 1.1, seatFabric(item), 0, 1.2, -R * 0.82, 1.6, 3));
  g.add(cyl(R - wall * 0.7, seatH - 1.2, seatFabric(item), 0, 1.2, 0)); // seat base block
  g.add(cyl(R - wall - 0.4, TUB_CHAIR.cushionH, seatFabric(item, true), 0, seatH - TUB_CHAIR.cushionDrop, 0, R - wall - 1.4)); // cushion, domed
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    g.add(cyl(1.1, 1.6, mat("charcoal", 0.7), Math.cos(a) * R * 0.66, 0, Math.sin(a) * R * 0.66));
  }
  return g;
}

/** Round lounge COFFEE TABLE: light-wood top on a dark pedestal and foot disc. Reusable. */
function roundTable(item: FurnitureItem): THREE.Group {
  const g = placed(item.rect, item.facing);
  const R = Math.min(item.rect.w, item.rect.d) / 2;
  const h = 14;
  g.add(cyl(R * 0.42, 1.1, mat("charcoal", 0.7), 0, 0, 0)); // foot disc
  g.add(cyl(R * 0.22, h - 3.4, mat("charcoal", 0.6), 0, 1.1, 0)); // pedestal
  g.add(cyl(R * 0.9, 1.0, mat("charcoal", 0.8), 0, h - 3.3, 0)); // dark reveal under the top
  g.add(cyl(R, 2.6, mat(item.color ?? "tableWood", 0.55), 0, h - 2.6, 0)); // top
  if (item.tone === "lounge") {
    contactShadow(g, 2 * R, 2 * R, true);
    // the source shows a small potted plant, a cup on a saucer and a dish on each table
    g.add(smallPot(-R * 0.25, h, -R * 0.1, 1.5));
    g.add(cyl(1.8, 0.25, plastic("white"), R * 0.32, h, R * 0.28)); // saucer
    g.add(mug(R * 0.32, h + 0.25, R * 0.28));
    g.add(cyl(1.4, 0.4, plastic("white"), R * 0.3, h, -R * 0.42)); // dish
  }
  return g;
}

/** MEETING ROOM conference table: one light-oak top over `modules` bases, with the module reveals and the
 *  central cable tray the artwork shows. Built on the desk system's height so a task chair tucks under it. */
function conferenceTable(item: FurnitureItem): THREE.Group {
  const g = placed(item.rect, "north");
  const { w, d } = item.rect;
  const modules = Math.max(1, Math.round(w / 44));
  g.add(slab(roundedRect(w, d, 2.2), TOP_T, wood("extrude", true), DESK_H - TOP_T));
  // reveals between the top's modules: thin grooves 0.1 proud of the top so they never z-fight it
  for (let i = 1; i < modules; i++)
    g.add(rbox(0.6, 0.3, d - 2, mat("woodLight", 0.9), -w / 2 + (w * i) / modules, DESK_H - 0.1, 0, 0.1));
  // a shared cable tray down the spine, and one pedestal base per module
  g.add(rbox(w - 10, 1.6, 7, mat("charcoal", 0.7), 0, DESK_H - TOP_T - 2.4, 0, 0.4));
  for (let i = 0; i < modules; i++) {
    const cx = -w / 2 + (w * (i + 0.5)) / modules;
    g.add(rbox(6, DESK_H - TOP_T - 1, d - 14, wood("box"), cx, 0, 0, 0.8));
    g.add(rbox(9, 1.1, d - 10, mat("charcoal", 0.7), cx, 0, 0, 0.4)); // foot
  }
  return g;
}

/** PROJECT ROOM coffee table: a rectangular light-oak top with a soft radius, an open lower shelf and a
 *  recessed dark plinth. `tone: "lounge"` adds the plant, cup and dish the source puts on it. */
function loungeTable(item: FurnitureItem): THREE.Group {
  const g = placed(item.rect, "north");
  const { w, d } = item.rect;
  const h = 15;
  if (item.tone === "lounge") contactShadow(g, w, d);
  g.add(rbox(w - 8, 3.2, d - 8, mat("charcoal", 0.7), 0, 0, 0, 0.5)); // recessed plinth
  g.add(rbox(w - 3, 1.4, d - 3, mat("tableWood", 0.6), 0, h - 8.6, 0, 0.5)); // lower shelf
  g.add(rbox(w - 2.6, 1.0, d - 2.6, mat("charcoal", 0.8), 0, h - 4.2, 0, 0.4)); // dark reveal under the top
  g.add(slab(roundedRect(w, d, 3.4), 3.2, wood("extrude", true), h - 3.2));
  if (item.tone === "lounge") {
    g.add(smallPot(-w * 0.04, h, -d * 0.22, 1.8));
    g.add(cyl(1.9, 0.25, plastic("white"), -w * 0.1, h, d * 0.05)); // saucer
    g.add(mug(-w * 0.1, h + 0.25, d * 0.05));
    g.add(cyl(2.2, 0.45, plastic("white"), w * 0.02, h, d * 0.2)); // dish
  }
  return g;
}

/** RACING-STYLE GAMING CHAIR (Phase 5B). A bucket seat, not a task chair: high winged backrest with
 *  shoulder bolsters, a separate headrest pillow on a visible spine, a lumbar cushion, deep side bolsters
 *  on the seat pan, and a 5-star base on castors. `color` is the hull, `accent` the bolster/stripe trim —
 *  both routed from the room's THEME so the accent is the obvious per-seat personalisation hook later. */
/** Vertical proportions of the gaming chair, EXPORTED so rooms/gaming.ts's SeatCapability is derived from
 *  the same numbers the mesh uses and the two can never drift. The cushion sits at seatH - 2.9 and is 3.6
 *  tall, so its top surface is at 14.7 whatever the chair's plan size. */
export const GAMING_CHAIR = { seatH: 14, cushionTop: 14.7, cushionLocalZ: 0.2 };

function gamingChair(item: FurnitureItem): THREE.Group {
  const g = placed(item.rect, item.facing);
  const { w, d } = localSize(item.rect, item.facing);
  const seatW = Math.min(w, d) * 0.72;
  const seatH = GAMING_CHAIR.seatH;
  const frame = mat(item.color ?? "charcoal", 0.5);
  const hull = fabric(item.color ?? "charcoal");
  const trim = fabric(item.accent ?? "greenSeat");
  // ---- base: five tapered arms on castors, gas lift, hub ----
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const len = seatW * 0.58;
    const leg = rbox(len, 1.4, 1.8, frame, 0, 0.8, 0, 0.55);
    leg.geometry.translate(len / 2, 0, 0);
    leg.rotation.y = -a;
    leg.rotation.z = 0.07;
    g.add(leg);
    const wheel = new THREE.Mesh(sphereGeo, mat("charcoal", 0.6));
    wheel.scale.set(1.25, 1.05, 1.25);
    wheel.position.set(Math.cos(a) * len * 0.96, 1.0, Math.sin(a) * len * 0.96);
    g.add(shadowed(wheel));
  }
  g.add(cyl(1.35, seatH - 4.6, metal(), 0, 1.6, 0));
  g.add(cyl(2.8, 1.4, frame, 0, seatH - 4.6, 0));
  // ---- seat pan: flat centre with a raised bolster down each side ----
  g.add(rbox(seatW * 0.98, 1.6, seatW * 0.96, frame, 0, seatH - 4.2, 0.2, 0.5));
  g.add(rbox(seatW * 0.66, 3.6, seatW * 0.92, hull, 0, seatH - 2.9, 0.2, 1.4, 3));
  for (const s of [-1, 1]) {
    const bol = rbox(seatW * 0.2, 4.6, seatW * 0.86, trim, s * seatW * 0.4, seatH - 3.2, 0.2, 1.8, 3);
    bol.rotation.z = -s * 0.18;
    g.add(bol);
  }
  // ---- backrest: tall shell + shoulder wings, reclined about the rear seat edge ----
  const back = new THREE.Group();
  back.position.set(0, seatH - 1.4, seatW / 2 - 0.6);
  back.rotation.x = -0.17;
  const backH = 26;
  back.add(rbox(seatW * 0.8, backH, 3.4, hull, 0, 0, 0, 1.5, 3));
  for (const s of [-1, 1]) {
    const wing = rbox(seatW * 0.19, backH * 0.9, 4.6, trim, s * seatW * 0.44, 0.6, -0.4, 1.7, 3);
    wing.rotation.z = s * 0.05;
    back.add(wing);
  }
  back.add(rbox(seatW * 0.5, 4.2, 4.0, trim, 0, 5.4, -1.4, 1.6, 3)); // lumbar cushion
  back.add(rbox(seatW * 0.9, 1.6, 1.2, frame, 0, backH - 1.2, 0.9, 0.4)); // shell rim
  // headrest pillow on its visible spine
  back.add(rbox(seatW * 0.16, 4.2, 1.4, frame, 0, backH - 1.5, 0.2, 0.4));
  back.add(rbox(seatW * 0.46, 5.2, 3.6, trim, 0, backH + 1.6, -1.0, 1.7, 3));
  g.add(back);
  // ---- armrests ----
  for (const s of [-1, 1]) {
    g.add(rbox(1.8, 6.2, 1.8, frame, s * (seatW / 2 + 0.6), seatH - 1.6, 1.2, 0.5));
    g.add(rbox(2.8, 1.6, seatW * 0.52, mat("charcoal", 0.6), s * (seatW / 2 + 0.6), seatH + 4.6, 0.2, 0.7, 3));
  }
  return g;
}

/** a centred rounded rectangle for slab() */
function roundedRect(w: number, d: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const hw = w / 2 - r, hd = d / 2 - r;
  s.moveTo(-hw - r, -hd);
  s.lineTo(-hw - r, hd); s.quadraticCurveTo(-hw - r, hd + r, -hw, hd + r);
  s.lineTo(hw, hd + r); s.quadraticCurveTo(hw + r, hd + r, hw + r, hd);
  s.lineTo(hw + r, -hd); s.quadraticCurveTo(hw + r, -hd - r, hw, -hd - r);
  s.lineTo(-hw, -hd - r); s.quadraticCurveTo(-hw - r, -hd - r, -hw - r, -hd);
  return s;
}


// ---- CENTRAL HUB kinds (Phase 6B) --------------------------------------------------------------
// Three pieces the source plan repeats and no existing kind covers: the octagonal café table, its light
// dining chair (no castors, no gas lift — chair-a/b are task chairs) and a squared-off lounge armchair
// that doubles as the two-seat loveseat at `seats: 2`.
//
// All three BAKE (helpers.Baker): the finished piece collapses to one mesh per material. The hub repeats
// the café chair 24 times; built the way the Design Room builds a chair that is ~240 draw calls for
// furniture nobody looks at closely. Each piece still gets its own Group — and therefore its own
// transform, entity id and future SeatCapability — so 6C can pull any single one of them out. No existing
// room is affected: these kinds did not exist before 6B.

/** Vertical proportions of the café chair, EXPORTED so 6C's seat metadata is derived from the same
 *  numbers the geometry uses and the two can never drift. */
export const CAFE_CHAIR = { seatH: 13.4, cushionTop: 16.6 };
/** Café table top surface — the plane a mug or a laptop rests on. */
export const CAFE_TABLE = { topY: 24 };
/** Lounge armchair / loveseat seat contact plane. */
export const ARMCHAIR = { cushionTop: 13.5 };

/** An octagonal prism: CylinderGeometry with 8 radial segments. `across` is the across-FLATS width the
 *  plan measures, so the circumradius is corrected for the 22.5° half-facet. */
function octagon(across: number, h: number, m: THREE.Material, y0: number): THREE.Mesh {
  const R = across / 2 / Math.cos(Math.PI / 8);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(R, R, h, 8), m);
  mesh.position.set(0, y0 + h / 2, 0);
  mesh.rotation.y = Math.PI / 8; // flat face toward the sitter, as the source plan draws it
  return shadowed(mesh);
}

/** Octagonal café table: white solid top on a slim column and a four-star cast foot. */
function cafeTable(item: FurnitureItem): THREE.Group {
  const g = placed(item.rect, "north");
  const b = new Baker();
  const across = Math.min(item.rect.w, item.rect.d);
  const top = mat(item.color ?? "white", 0.34, { metalness: 0.02 });
  const base = metal();
  b.add(octagon(across, 2.6, top, CAFE_TABLE.topY - 2.6));
  b.add(octagon(across * 0.93, 0.9, mat("grout", 0.8), CAFE_TABLE.topY - 3.4)); // shadow reveal under the top
  b.add(cyl(2.3, CAFE_TABLE.topY - 4.2, base, 0, 1.0, 0, 1.9)); // column
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const len = across * 0.30;
    const leg = rbox(len, 1.5, 2.0, base, 0, 0.5, 0, 0.5);
    leg.geometry = leg.geometry.clone();
    leg.geometry.translate(len / 2, 0, 0);
    leg.rotation.y = -a;
    b.add(leg);
  }
  b.add(cyl(3.0, 1.0, base, 0, 0.2, 0));
  b.bakeInto(g, "cafe-table");
  return g;
}

/** Light dining chair: four tapered metal legs, an upholstered pan and a low curved back. */
function cafeChair(item: FurnitureItem): THREE.Group {
  const g = placed(item.rect, item.facing);
  const { w, d } = localSize(item.rect, item.facing);
  const b = new Baker();
  const pad = seatFabric(item, true);
  const frame = metal();
  const sw = Math.min(w, d) * 0.92;
  const seatH = CAFE_CHAIR.seatH;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) b.add(cyl(0.8, seatH, frame, sx * sw * 0.34, 0, sz * sw * 0.34, 0.55));
  b.add(rbox(sw * 0.84, 1.6, sw * 0.84, frame, 0, seatH - 1.6, 0, 0.5)); // pan, tucked under the cushion
  b.add(rbox(sw, 3.2, sw, pad, 0, seatH, 0, 1.5)); // cushion → top at CAFE_CHAIR.cushionTop
  // back: two slim uprights and a shaped panel, leaning back off the rear cushion edge
  for (const sx of [-1, 1]) b.add(rbox(1.0, 12.5, 1.0, frame, sx * sw * 0.36, seatH + 2.2, sw * 0.42, 0.35));
  const back = rbox(sw * 0.98, 10.5, 2.6, pad, 0, seatH + 4.0, sw * 0.44, 1.7);
  back.rotation.x = -0.11;
  b.add(back);
  b.bakeInto(g, "cafe-chair");
  return g;
}

/** Squared-off lounge ARMCHAIR, and at `seats: 2` the matching loveseat. Wooden splay legs, a deep seat
 *  deck, one cushion per seat, a wrapped back and low arms — the north row and the east cluster in the
 *  source are all this one piece at three colours and two widths. */
function armchair(item: FurnitureItem): THREE.Group {
  const g = placed(item.rect, item.facing);
  const { w, d } = localSize(item.rect, item.facing);
  const b = new Baker();
  const body = seatFabric(item);
  const pad = seatFabric(item, true);
  const legs = mat("tableWood", 0.6);
  const seats = Math.max(1, item.seats ?? 1);
  const armW = w * 0.15, backD = d * 0.17, deckH = 8;
  contactShadow(g, w, d);
  b.add(rbox(w, deckH, d, body, 0, 2.2, 0, 3, 3)); // deck
  b.add(rbox(w, 14.5, backD, body, 0, 2.2, d / 2 - backD / 2, 3.4, 3)); // back shell
  for (const s of [-1, 1]) b.add(rbox(armW, 11, d - backD, body, s * (w / 2 - armW / 2), 2.2, -backD / 2, 3, 3)); // arms
  const cw = (w - 2 * armW - 1.6) / seats;
  for (let i = 0; i < seats; i++) {
    const lx = (i - (seats - 1) / 2) * (cw + 0.8);
    b.add(rbox(cw - 0.8, 4.0, d - backD - 2.4, pad, lx, deckH + 1.5, -backD / 2, 2.2, 3)); // seat cushion → 13.5
    const bc = rbox(cw - 1.4, 11, 4.2, pad, lx, deckH + 2.2, d / 2 - backD - 1.4, 2.4, 3);
    bc.rotation.x = 0.09;
    b.add(bc);
  }
  if (item.accent) {
    const p = rbox(9, 3.2, 9, fabric(item.accent), w * 0.22, deckH + 5.8, d * 0.10, 2, 3);
    p.rotation.y = -0.42;
    b.add(p);
  }
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const leg = cyl(1.3, 2.4, legs, sx * (w / 2 - 3), 0, sz * (d / 2 - 3), 0.9);
      leg.rotation.z = -sx * 0.14;
      b.add(leg);
    }
  b.bakeInto(g, "armchair");
  return g;
}

export function buildFurniture(item: FurnitureItem): THREE.Group {
  switch (item.kind) {
    case "conference-table":
      return conferenceTable(item);
    case "lounge-table":
      return loungeTable(item);
    case "lead-desk":
      return leadDesk(item);
    case "member-desk":
      return memberDesk(item);
    case "desk-panel":
      return deskPanel(item);
    case "curve-desk":
      return curveDesk(item);
    case "side-desk":
      return sideDesk(item);
    case "sofa":
      return sofa(item);
    case "beanbag":
      return beanbag(item);
    case "rug":
      return rug(item);
    case "chair-a":
      return chair(item, "a");
    case "chair-b":
      return chair(item, "b");
    case "tub-chair":
      return tubChair(item);
    case "round-table":
      return roundTable(item);
    case "lead-chair":
      return chair(item, "lead");
    case "gaming-chair":
      return gamingChair(item);
    case "cafe-table":
      return cafeTable(item);
    case "cafe-chair":
      return cafeChair(item);
    case "armchair":
      return armchair(item);
  }
}
