// vo3d build — EXECUTIVE ROOM static geometry, built in WORLD coordinates.
//
// Architecture: the light tiled floor, three solid 12-unit walls, a glazed south façade with the V1 door
// band left empty, plus the fixed fit-out — the north display wall (wood feature panel, the big centred
// display, the long media console, a symmetrical award cabinet each side), the two executive desks and
// their kit, the bottom-left display credenza and the bottom-right workstation run.
//
// Rugs, sofas, armchairs, tables, chairs and plants are entity-driven — see rooms/executive.ts.
//
// LIGHTING BUDGET: ZERO real-time lights. Everything that reads as lit here — the cabinet shelf coves,
// the display, the credenza wash — is a static emissive surface or an additive glow plane, the same
// budget the Gaming Room and the Central Hub work to. A premium room is lit by restraint, not by lamps.
import * as THREE from "three";
import type { RoomDef } from "../world/WorldState";
import { Baker, cyl, lathe, rbox } from "./helpers";
import { tagSurface } from "../editor/surfaces";
import { tiledFloor } from "./tile";
import { credenzaRun, glassRun, slatPanel } from "./frontbar";
import { book, laptop, monitor, mug, smallPot } from "./props";
import { brassDeskLamp, deskMat, deskOrganiser, deskPlant, nameplate } from "./exec-furniture";
import { STRUCT } from "../rooms/reception";
import { emissiveMat, glowMat, mat, metal, uiScreenMat } from "../render/Materials";
import {
  CABINET_L, CABINET_R, CREDENZA_SW, DESK_L, DESK_R, DOOR, EAST_WALL, EAST_X, FEATURE_WALL,
  MEDIA_CONSOLE, NORTH_WALL, NORTH_Z, RETURN_SE, SOUTH_GLASS, SOUTH_Z, DESK_SE, THEME, TILE_RECT,
  TV, WEST_WALL, WEST_X, WEST_OUTER_X, EAST_OUTER_X, AXIS,
} from "../rooms/executive";

// ---- shell -------------------------------------------------------------------------------------
function wallBox(x0: number, x1: number, z0: number, z1: number, h: number): THREE.Mesh {
  // ROOM EDITOR: every plaster wall of this room is one addressable surface (editor/surfaces.ts).
  return tagSurface(rbox(x1 - x0, h, z1 - z0, mat(THEME.plaster, 0.95), (x0 + x1) / 2, 0, (z0 + z1) / 2, STRUCT.capRadius), { id: "executive-room/wall", kind: "wall", roomId: "executive-room", label: "Executive Room walls", preset: "plaster", size: { u: Math.max(x1 - x0, z1 - z0), v: h } });
}

/** A slim skirting along an interior wall face — the detail that stops a plaster box reading as a box. */
function skirting(axis: "x" | "z", from: number, to: number, at: number): THREE.Mesh {
  return axis === "x"
    ? rbox(to - from - 1, 1.8, 1.0, mat(THEME.woodDark, 0.7), (from + to) / 2, 0, at, 0.2)
    : rbox(1.0, 1.8, to - from - 1, mat(THEME.woodDark, 0.7), at, 0, (from + to) / 2, 0.2);
}

/** THE SOUTH FAÇADE. A framed glass run either side of the V1 '+' band, on a low solid spandrel so the
 *  hall floor is never seen through the glass at ankle height, with a jamb pilaster at each side of the
 *  opening. Nothing is built inside the band — the two sliding leaves are entities. */
function southFacade(): THREE.Group {
  const g = new THREE.Group();
  g.name = "exec-south-facade";
  const cz = (SOUTH_GLASS.z0 + SOUTH_GLASS.z1) / 2, t = SOUTH_GLASS.z1 - SOUTH_GLASS.z0;
  // spandrel, in the two spans either side of the opening
  for (const [x0, x1] of [[WEST_OUTER_X, DOOR.x0], [DOOR.x1, EAST_OUTER_X]] as const)
    g.add(rbox(x1 - x0, SOUTH_GLASS.spandrel, t, mat(THEME.plaster, 0.95), (x0 + x1) / 2, 0, cz, 0.5));
  g.add(glassRun({
    z: cz, x0: WEST_OUTER_X, x1: EAST_OUTER_X, t: 3.2, h: SOUTH_GLASS.h, sill: SOUTH_GLASS.spandrel,
    panelPitch: SOUTH_GLASS.panelPitch, topRail: true,
    pilasters: [DOOR.x0 - 6, DOOR.x1 + 6], pilasterW: 12,
    openings: [{ x0: DOOR.x0, x1: DOOR.x1 }],
  }));
  // head over the opening, so the doorway reads as an opening rather than a gap in a wall
  g.add(rbox(DOOR.x1 - DOOR.x0, STRUCT.wallHeight - 36, t, mat(THEME.plaster, 0.95), (DOOR.x0 + DOOR.x1) / 2, 36, cz, STRUCT.capRadius));
  return g;
}

// ---- north display wall ------------------------------------------------------------------------
function drawDisplayUi(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  // a calm executive dashboard: a dark ground, a title bar, one rising area chart and three stat tiles
  ctx.fillStyle = "#14161c";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#1d2029";
  ctx.fillRect(0, 0, w, h * 0.12);
  ctx.fillStyle = "#b08d57";
  ctx.fillRect(w * 0.04, h * 0.045, w * 0.14, h * 0.03);
  const cx = w * 0.06, cw = w * 0.56, cy = h * 0.24, ch = h * 0.5;
  const grad = ctx.createLinearGradient(0, cy, 0, cy + ch);
  grad.addColorStop(0, "rgba(176,141,87,0.55)");
  grad.addColorStop(1, "rgba(176,141,87,0.04)");
  ctx.beginPath();
  ctx.moveTo(cx, cy + ch);
  const pts = [0.72, 0.62, 0.66, 0.48, 0.4, 0.44, 0.26, 0.18];
  pts.forEach((v, i) => ctx.lineTo(cx + (cw * i) / (pts.length - 1), cy + ch * v));
  ctx.lineTo(cx + cw, cy + ch);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = "#d8b27a";
  ctx.lineWidth = Math.max(1, h * 0.008);
  ctx.beginPath();
  pts.forEach((v, i) => (i ? ctx.lineTo(cx + (cw * i) / (pts.length - 1), cy + ch * v) : ctx.moveTo(cx, cy + ch * v)));
  ctx.stroke();
  for (let i = 0; i < 3; i++) {
    const ty = h * (0.24 + i * 0.19);
    ctx.fillStyle = "#20242e";
    ctx.fillRect(w * 0.68, ty, w * 0.26, h * 0.14);
    ctx.fillStyle = "#e8e2d6";
    ctx.fillRect(w * 0.70, ty + h * 0.03, w * 0.12, h * 0.035);
    ctx.fillStyle = "#6f7b8a";
    ctx.fillRect(w * 0.70, ty + h * 0.085, w * 0.18, h * 0.02);
  }
}

/** One award: a lathed brass cup on a dark plinth. Small, deliberately — a trophy shelf reads from its
 *  SILHOUETTE and its glint, and twenty high-poly cups would cost more than the whole room's walls. */
function trophy(b: Baker, x: number, y0: number, z: number, h: number): void {
  const r = h * 0.17;
  b.add(rbox(r * 2.6, h * 0.16, r * 2.6, mat(THEME.woodDark, 0.6), x, y0, z, 0.25)); // plinth
  b.add(lathe([[0, 0], [r * 0.55, 0], [r * 0.3, h * 0.12], [r * 0.24, h * 0.34], [r, h * 0.52], [r * 1.05, h * 0.82], [r * 0.72, h * 0.84], [r * 0.66, h * 0.5], [0, h * 0.44]],
    mat(THEME.brass, 0.3, { metalness: 0.72 }), x, y0 + h * 0.16, z, 14));
}
/** A framed award plaque standing against the shelf back. */
function plaque(b: Baker, x: number, y0: number, z: number, w: number, h: number): void {
  b.add(rbox(w, h, 1.0, mat(THEME.brass, 0.35, { metalness: 0.6 }), x, y0, z, 0.2));
  b.add(rbox(w - 2.2, h - 2.2, 1.3, mat(THEME.woodDark, 0.75), x, y0 + 1.1, z - 0.2, 0.15));
}

/** An award cabinet: walnut carcass, a dark recessed back, three glass shelves each with a static LED
 *  cove under its front edge, and the awards standing on them. Built once and MIRRORED for the other
 *  side, so the composition's symmetry is structural rather than hand-copied. */
function awardCabinet(spec: typeof CABINET_L, name: string): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  const b = new Baker();
  const cx = spec.x + spec.w / 2, cz = spec.z + spec.d / 2, frontZ = spec.z + spec.d;
  const carcass = mat(THEME.wood, 0.7);
  b.add(rbox(spec.w, spec.h, spec.d, carcass, cx, 0, cz, 0.6)); // carcass
  b.add(rbox(spec.w - 6, spec.h - 8, spec.d - 6, mat(THEME.woodDark, 0.92), cx, 4, cz - 1.4, 0.4)); // recessed interior
  b.add(rbox(spec.w + 2, 2.4, spec.d + 2, mat(THEME.wood, 0.5), cx, spec.h - 2.4, cz, 0.5)); // cornice
  b.add(rbox(spec.w - 2, 3.0, spec.d - 2, mat(THEME.woodDark, 0.9), cx, 0, cz, 0.3)); // toe kick
  const shelfH = (spec.h - 12) / spec.shelves;
  const trophies = new Baker();
  for (let i = 0; i < spec.shelves; i++) {
    const y = 6 + shelfH * i;
    trophies.add(rbox(spec.w - 10, 1.2, spec.d - 8, mat(THEME.wood, 0.55), cx, y, cz - 1.2, 0.2)); // shelf board
    // shelf cove: a static emissive line under the front lip, plus the warm wash it throws on the shelf
    const cove = rbox(spec.w - 14, 0.7, 1.1, emissiveMat("coveWarm", 1.25, 0.4), cx, y - 1.1, frontZ - 4.4, 0.2);
    cove.castShadow = false;
    g.add(cove);
    const wash = rbox(spec.w - 12, 0.05, spec.d - 10, glowMat("coveWarm", 0.09), cx, y + 1.3, cz - 1.2, 0);
    wash.castShadow = wash.receiveShadow = false;
    g.add(wash);
    // the display itself: awards on the two lower shelves, plaques on the top one
    const n = 5;
    for (let k = 0; k < n; k++) {
      const px = spec.x + 12 + ((spec.w - 24) * k) / (n - 1);
      if (i === spec.shelves - 1) plaque(trophies, px, y + 1.2, cz + 0.6, 13, shelfH * 0.62);
      else trophy(trophies, px, y + 1.2, cz - 0.4, shelfH * 0.74);
    }
  }
  b.bakeInto(g, `${name}-carcass`);
  trophies.bakeInto(g, `${name}-display`);
  // glazed front: one pane per shelf bay, slim brass mullions
  const pane = rbox(spec.w - 8, spec.h - 12, 0.8, mat("glass", 0.06, { metalness: 0.1, transparent: true, opacity: 0.18 }), cx, 6, frontZ - 1.2, 0.1);
  pane.castShadow = false;
  g.add(pane);
  for (const sx of [-1, 0, 1])
    g.add(rbox(1.4, spec.h - 10, 2.0, mat(THEME.brass, 0.35, { metalness: 0.65 }), cx + sx * (spec.w / 2 - 3), 5, frontZ - 1.2, 0.3));
  return g;
}

function displayWall(): THREE.Group {
  const g = new THREE.Group();
  g.name = "exec-media-wall";
  // the wood feature panel between the cabinets — the room's identity surface
  g.add(slatPanel({ axis: "x", at: NORTH_Z, dir: 1, from: FEATURE_WALL.x0, to: FEATURE_WALL.x1, y0: FEATURE_WALL.y0, y1: FEATURE_WALL.y1, pitch: 8.5, name: "exec-feature-wall" }));
  // the large centred display, standing proud of the battens on a slim brass frame
  const z = NORTH_Z + 5.4;
  g.add(rbox(TV.w + 3.2, TV.h + 3.2, 2.2, mat(THEME.brass, 0.35, { metalness: 0.6 }), TV.cx, TV.y0 - 1.6, z, 0.5));
  g.add(rbox(TV.w, TV.h, 1.4, mat("screen", 0.3), TV.cx, TV.y0, z + 0.6, 0.3));
  const screen = rbox(TV.w - 3, TV.h - 3, 0.5, uiScreenMat("exec-display", 512, 200, drawDisplayUi, 0.62), TV.cx, TV.y0 + 1.5, z + 1.1, 0.2);
  screen.castShadow = false;
  g.add(screen);
  // the wash the panel throws back onto the wood behind it — the display reads as ON, with no light added
  const wash = rbox(TV.w + 26, 42, 0.05, glowMat("coveWarm", 0.05), TV.cx, 2, NORTH_Z + 3.0, 0); // stays under the 46 wall head
  wash.castShadow = wash.receiveShadow = false;
  g.add(wash);
  // the long low media console
  g.add(credenzaRun({ ...MEDIA_CONSOLE, along: "x", facing: "south", body: THEME.wood, reveal: THEME.woodDark, name: "exec-media-console" }));
  // restrained dressing on the console top
  const top = MEDIA_CONSOLE.h, cz = MEDIA_CONSOLE.z + MEDIA_CONSOLE.d / 2;
  g.add(book(MEDIA_CONSOLE.x + 22, top, cz, 13, 9, "execWalnutDark", 0.12));
  g.add(book(MEDIA_CONSOLE.x + 22, top + 0.9, cz + 1.2, 12, 8, "execBrass", -0.2));
  g.add(smallPot(MEDIA_CONSOLE.x + MEDIA_CONSOLE.w - 20, top, cz, 2.4));
  trophyOnTop(g, AXIS - 34, top, cz);
  trophyOnTop(g, AXIS + 34, top, cz);
  return g;
}
function trophyOnTop(g: THREE.Group, x: number, y0: number, z: number): void {
  const b = new Baker();
  trophy(b, x, y0, z, 13);
  b.bakeInto(g, "console-award");
}

// ---- executive desks ---------------------------------------------------------------------------
/** ONE EXECUTIVE DESK, rebuilt from the close reference rather than from any existing V2 desk builder.
 *  The reference is specific: a thick dark-walnut top with a visible edge, a full-width dark modesty
 *  panel on the visitor side, a dark leather DESK MAT carrying the monitor / laptop / mouse, a brass
 *  dome desk lamp, a walnut pen organiser, a small potted plant, and an engraved nameplate facing the
 *  visitors. Built once, called for CEO, CTO and (shorter) HR. */
function executiveDesk(spec: typeof DESK_L, mirrored: boolean, label: string, name: string): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  const b = new Baker();
  const cx = spec.x + spec.w / 2, cz = spec.z + spec.d / 2, top = spec.h;
  const carcass = mat(THEME.wood, 0.62);
  b.add(rbox(spec.w, 3.2, spec.d, mat(THEME.wood, 0.5), cx, top - 3.2, cz, 0.5)); //            thick top
  b.add(rbox(spec.w - 1.2, 0.9, spec.d - 1.2, mat(THEME.woodDark, 0.85), cx, top - 4.1, cz, 0.25)); // edge reveal
  b.add(rbox(spec.w - 12, top - 5.0, spec.d - 13, carcass, cx, 0.8, cz, 0.4)); //               plinth body
  b.add(rbox(spec.w - 16, 1.6, spec.d - 17, mat(THEME.woodDark, 0.9), cx, 0, cz, 0.3)); //      toe shadow
  // the reference's full-width dark modesty panel, on the VISITOR side (south)
  b.add(rbox(spec.w, top - 9, 2.2, mat(THEME.woodDark, 0.8), cx, 2.0, spec.z + spec.d - 1.1, 0.3));
  const px = mirrored ? spec.x + spec.w - 22 : spec.x + 22; // drawer pedestal on the outer end
  b.add(rbox(36, top - 5.4, spec.d - 9, carcass, px, 0.8, cz - 1, 0.4));
  for (let i = 0; i < 3; i++)
    b.add(rbox(12, 0.7, 0.9, metal(), px, 5 + i * ((top - 12) / 3), spec.z + spec.d - 5.2, 0.2));
  b.bakeInto(g, `${name}-body`);
  // ---- the desktop, laid out as the close reference lays it ----
  const m = mirrored ? -1 : 1;
  g.add(deskMat(cx - m * 4, top, cz - 3, spec.w * 0.52, spec.d * 0.42));
  g.add(monitor(cx - m * 22, top + 0.35, cz - 6, 24, 13));
  g.add(laptop(cx + m * 4, top + 0.35, cz - 1));
  g.add(cyl(1.6, 0.9, mat(THEME.woodDark, 0.5), cx + m * 20, top + 0.35, cz - 4, 1.2)); // mouse
  g.add(brassDeskLamp(cx - m * (spec.w / 2 - 9), top, cz - 8, m === 1 ? 1 : -1));
  g.add(deskOrganiser(cx + m * (spec.w / 2 - 16), top, cz - 6));
  g.add(deskPlant(cx + m * (spec.w / 2 - 8), top, cz + 5, 3.4));
  g.add(mug(cx - m * 30, top, cz + 7));
  g.add(nameplate(label, cx, top, cz + spec.d * 0.30, Math.min(36, spec.w * 0.33), 7));
  return g;
}

// ---- south fit-out -----------------------------------------------------------------------------
function credenzaSw(): THREE.Group {
  const g = new THREE.Group();
  g.name = "exec-credenza-sw";
  g.add(credenzaRun({ ...CREDENZA_SW, along: "x", facing: "north", body: THEME.wood, reveal: THEME.woodDark, name: "exec-credenza-run" }));
  const top = CREDENZA_SW.h, cz = CREDENZA_SW.z + CREDENZA_SW.d / 2;
  const b = new Baker();
  trophy(b, CREDENZA_SW.x + 18, top, cz, 15);
  trophy(b, CREDENZA_SW.x + 32, top, cz + 2, 11);
  plaque(b, CREDENZA_SW.x + CREDENZA_SW.w - 22, top, cz + 3, 16, 12);
  b.bakeInto(g, "credenza-display");
  g.add(book(CREDENZA_SW.x + 54, top, cz - 2, 15, 11, "execWalnutDark", -0.14));
  g.add(book(CREDENZA_SW.x + 54, top + 0.9, cz - 1, 13, 10, "execBrass", 0.2));
  g.add(deskPlant(CREDENZA_SW.x + 70, top, cz + 4, 3.2));
  // a framed picture on the glass wall behind is wrong — this one hangs its wash on the credenza instead
  const wash = rbox(CREDENZA_SW.w - 10, 0.05, CREDENZA_SW.d + 12, glowMat("coveWarm", 0.05), CREDENZA_SW.x + CREDENZA_SW.w / 2, 0.3, cz - 6, 0);
  wash.castShadow = wash.receiveShadow = false;
  g.add(wash);
  return g;
}

/** The HUMAN RESOURCES workstation: V1's long desk and its short return rebuilt as one L-shaped group in
 *  the same executive language as the CEO/CTO desks — the same top, the same modesty panel, the same
 *  nameplate — at a smaller scale, with the printer and trays the reference puts on the return. */
function workstationSe(): THREE.Group {
  const g = new THREE.Group();
  g.name = "exec-workstation-se";
  g.add(executiveDesk({ ...DESK_SE }, true, "HUMAN RESOURCES", "exec-desk-hr"));
  const b = new Baker();
  const cx = RETURN_SE.x + RETURN_SE.w / 2, cz = RETURN_SE.z + RETURN_SE.d / 2, top = RETURN_SE.h;
  b.add(rbox(RETURN_SE.w, 2.6, RETURN_SE.d, mat(THEME.wood, 0.5), cx, top - 2.6, cz, 0.5)); // return top
  b.add(rbox(RETURN_SE.w - 10, top - 3.4, RETURN_SE.d - 8, mat(THEME.wood, 0.68), cx, 0.8, cz, 0.4));
  b.add(rbox(RETURN_SE.w, top - 8, 1.8, mat(THEME.woodDark, 0.8), cx, 1.8, RETURN_SE.z + 0.9, 0.3));
  // printer + paper trays, as the reference shows on the return
  b.add(rbox(22, 11, 17, mat(THEME.woodDark, 0.55), RETURN_SE.x + 16, top, cz, 1.2));
  b.add(rbox(18, 1.0, 13, mat("metal", 0.5), RETURN_SE.x + 16, top + 11, cz, 0.3));
  for (let i = 0; i < 2; i++)
    b.add(rbox(16, 1.6, 12, mat(THEME.woodDark, 0.7), RETURN_SE.x + 46, top + i * 2.2, cz + 1, 0.3));
  b.bakeInto(g, "exec-return-se");
  g.add(deskPlant(RETURN_SE.x + RETURN_SE.w - 12, top, cz - 4, 3.2));
  return g;
}

// ---- wall sconces ------------------------------------------------------------------------------
/** The reference hangs a pair of warm sconces on each side wall. Static emissive + a soft additive wash
 *  on the plaster: two meshes each, no light, and it is what turns three plaster walls into an interior. */
function sconce(x: number, z: number, faceDir: 1 | -1): THREE.Group {
  const g = new THREE.Group();
  const y = 28;
  g.add(rbox(1.6, 12, 3.4, mat(THEME.brass, 0.35, { metalness: 0.7 }), x + faceDir * 1.4, y, z, 0.4));
  const lamp = rbox(1.0, 9, 2.4, emissiveMat("coveWarm", 1.15, 0.4), x + faceDir * 2.6, y + 1.5, z, 0.3);
  lamp.castShadow = false;
  g.add(lamp);
  const wash = rbox(0.05, 28, 20, glowMat("coveWarm", 0.07), x + faceDir * 0.4, y - 14, z, 0);
  wash.castShadow = wash.receiveShadow = false;
  g.add(wash);
  return g;
}

// ---- assembly ----------------------------------------------------------------------------------
export function executiveStatic(_room: RoomDef): THREE.Group {
  const g = new THREE.Group();
  g.name = "static:executive-room";
  g.add(tiledFloor(TILE_RECT, undefined, undefined, { roomId: "executive-room", label: "Executive Room floor" }));
  // ---- shell: three solid 12-unit walls + the glazed south façade ----
  g.add(wallBox(NORTH_WALL.x0, NORTH_WALL.x1, NORTH_WALL.z0, NORTH_WALL.z1, NORTH_WALL.h));
  g.add(wallBox(WEST_WALL.x0, WEST_WALL.x1, WEST_WALL.z0, WEST_WALL.z1, WEST_WALL.h));
  g.add(wallBox(EAST_WALL.x0, EAST_WALL.x1, EAST_WALL.z0, EAST_WALL.z1, EAST_WALL.h));
  g.add(southFacade());
  g.add(skirting("z", NORTH_Z, SOUTH_Z, WEST_X + 0.5));
  g.add(skirting("z", NORTH_Z, SOUTH_Z, EAST_X - 0.5));
  // ---- fit-out ----
  g.add(displayWall());
  g.add(awardCabinet(CABINET_L, "exec-cabinet-left"));
  g.add(awardCabinet(CABINET_R, "exec-cabinet-right"));
  g.add(executiveDesk(DESK_L, false, "CEO", "exec-desk-left"));
  g.add(executiveDesk(DESK_R, true, "CTO", "exec-desk-right"));
  g.add(credenzaSw());
  g.add(workstationSe());
  for (const z of [96, 214]) {
    g.add(sconce(WEST_X, z, 1));
    g.add(sconce(EAST_X, z, -1));
  }
  return g;
}
