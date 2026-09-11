// vo3d build — Design Team furniture kinds (promoted verbatim from designRoom3d/build.ts).
// `item.rect` is a WORLD-space footprint rect; groups are positioned at its centre.
import * as THREE from "three";
import type { Facing, Rect } from "../core/coords";
import { cyl, lathe, localSize, placed, rbox, shadowed, slab, sphereGeo } from "./helpers";
import { fabric, mat, metal, plastic, wood } from "../render/Materials";
import { book, laptop, monitor, mug, smallPot } from "./props";

export type FurnitureKind =
  | "lead-desk" | "member-desk" | "desk-panel" | "curve-desk" | "side-desk"
  | "sofa" | "beanbag" | "rug" | "chair-a" | "chair-b" | "lead-chair";
export const FURNITURE_KINDS: readonly FurnitureKind[] = ["lead-desk", "member-desk", "desk-panel", "curve-desk", "side-desk", "sofa", "beanbag", "rug", "chair-a", "chair-b", "lead-chair"];
export type FurnitureItem = { kind: FurnitureKind; rect: Rect; facing: Facing; mirrored: boolean };

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
  // corner wedge joining the column desk to the bottom row: top with the inner
  // corner cut on a soft diagonal, olive base + flutes along the diagonal
  const { w, d } = item.rect;
  const mx = (x: number) => (item.mirrored ? w - x : x);
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
  top.position.z = item.rect.z;
  base.position.x = item.rect.x;
  base.position.z = item.rect.z;
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

function sofa(item: FurnitureItem): THREE.Group {
  // along the left wall: soft deck, two puffy seat cushions, two back cushions
  // against a rounded back panel, rounded arms, short feet, two pillows
  const g = placed(item.rect, "north");
  const { w, d } = item.rect;
  const deckH = 8, armW = 5, backW = 7;
  g.add(rbox(w, deckH, d, fabric("green"), 0, 2, 0, 3, 3));
  for (let i = 0; i < 4; i++) g.add(cyl(1, 2, mat("greenDark", 0.8), (i % 2 ? 1 : -1) * (w / 2 - 3), 0, (i < 2 ? 1 : -1) * (d / 2 - 4)));
  g.add(rbox(backW, 22, d - 1, fabric("greenDark"), -w / 2 + backW / 2, 2, 0, 3, 3)); // back panel (wall side)
  for (const s of [-1, 1]) g.add(rbox(w - backW + 1, 15, armW, fabric("green"), backW / 2, 2, s * (d / 2 - armW / 2), 2.4, 3)); // arms
  const cushW = w - backW - 1.5, cushD = (d - 2 * armW - 3) / 2;
  for (const s of [-1, 1]) {
    g.add(rbox(cushW, 4.2, cushD, fabric("greenSeat"), backW / 2 + 0.5, deckH + 2, s * (cushD / 2 + 0.6), 2, 3)); // seat cushions
    const back = rbox(4.5, 12, cushD - 1, fabric("greenSeat"), -w / 2 + backW + 1.6, deckH + 2, s * (cushD / 2 + 0.6), 2, 3); // back cushions
    back.rotation.z = -0.12;
    g.add(back);
  }
  const p1 = rbox(8.5, 3.2, 8.5, fabric("cushionGray"), backW / 2 + 0.5, deckH + 6.2, -d * 0.2, 1.6, 3);
  p1.rotation.y = 0.35;
  const p2 = rbox(8.5, 3.2, 8.5, fabric("cushionCream"), backW / 2 + 1, deckH + 6.2, d * 0.22, 1.6, 3);
  p2.rotation.y = -0.45;
  g.add(p1, p2);
  return g;
}

function beanbag(item: FurnitureItem): THREE.Group {
  // inflated bag: revolved profile with a soft top dimple and a pinched base
  const g = placed(item.rect, "north");
  const r = Math.min(item.rect.w, item.rect.d) / 2;
  const h = r * 1.05;
  const prof: [number, number][] = [[0, 0.2], [r * 0.55, 0], [r * 0.9, h * 0.18], [r, h * 0.42], [r * 0.9, h * 0.72], [r * 0.6, h * 0.94], [r * 0.25, h], [0, h * 0.95]];
  const bag = lathe(prof, fabric("green"), 0, 0, 0, 28);
  bag.rotation.y = 0.6;
  g.add(bag);
  g.add(cyl(1.4, 0.5, mat("greenDark"), 0, h * 0.94, 0));
  return g;
}

function rug(item: FurnitureItem): THREE.Group {
  const g = placed(item.rect, "north");
  const r = Math.min(item.rect.w, item.rect.d) / 2;
  const m = cyl(r, 0.7, mat("rug", 1), 0, 0, 0);
  m.castShadow = false;
  g.add(m);
  // woven rings
  for (let i = 1; i <= 3; i++) g.add(cyl(r * (1 - i * 0.22), 0.12, mat("wood", 1), 0, 0.7, 0));
  return g;
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

export function buildFurniture(item: FurnitureItem): THREE.Group {
  switch (item.kind) {
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
    case "lead-chair":
      return chair(item, "lead");
  }
}
