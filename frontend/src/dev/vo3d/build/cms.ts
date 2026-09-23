// vo3d build — CMS ROOM static geometry, built in WORLD coordinates.
//
// Architecture: the cool tiled floor, three solid 12-unit walls, a glazed WEST elevation with the V1 door
// band left empty, plus the fixed fit-out — the north storage run (the team library, the content-planning
// credenza under its whiteboard, the tea point with its under-counter fridge) and the east wall's sticky
// board over the print credenza.
//
// Rugs, sofas, poufs, tables, desks, chairs and plants are entity-driven — see rooms/cms.ts.
//
// LIGHTING BUDGET: ZERO real-time lights, the same budget Gaming, the Central Hub and Executive work to.
// Everything that reads as lit here is a static emissive surface or an additive glow plane.
import * as THREE from "three";
import type { RoomDef } from "../world/WorldState";
import { Baker, cyl, lathe, rbox } from "./helpers";
import { cornice, doorCasing, skirting, type Axis } from "./arch";
import { counterNosing } from "./detail-props";
import { tagSurface } from "../editor/surfaces";
import { tiledFloor } from "./tile";
import { credenzaRun } from "./frontbar";
import { book, smallPot } from "./props";
import { CMS_DESK_TOP, stickyNotes } from "./cms-furniture";
import { STRUCT } from "../rooms/reception";
import { FLOOR_LAYER, PALETTE, floorLayer, glassMat, mat, metal, plastic, uiScreenMat } from "../render/Materials";
import {
  CONTENT_CREDENZA, COUNTER, DOOR, EAST_WALL, EAST_X, FRIDGE, GLASS_SPANDREL, LIBRARY, NORTH_WALL,
  NORTH_Z, PRINT_CREDENZA, RUN_D, SOUTH_WALL, STICKY_WALL, THEME, TILE_RECT, WEST_GLASS_N, WEST_GLASS_S,
  WEST_OUTER_X, WEST_X, WHITEBOARD,
} from "../rooms/cms";

// ---- shell -------------------------------------------------------------------------------------
const wall = () => mat(THEME.plaster, 0.95);
function wallBox(x0: number, x1: number, z0: number, z1: number, h: number): THREE.Mesh {
  // ROOM EDITOR: every plaster wall of this room is one addressable surface (editor/surfaces.ts).
  return tagSurface(rbox(x1 - x0, h, z1 - z0, wall(), (x0 + x1) / 2, 0, (z0 + z1) / 2, STRUCT.capRadius), { id: "cms-room/wall", kind: "wall", roomId: "cms-room", label: "CMS Room walls", preset: "plaster", size: { u: Math.max(x1 - x0, z1 - z0), v: h } });
}
/** THIS ROOM'S BASEBOARD AND CORNICE, over the shared profiled runs in build/arch.ts.
 *
 *  Both were a single rounded box until the high-detail pass: a skirting with no shadow gap at the floor
 *  and no ceiling moulding at all, which is what made a plaster box read as a plaster box. `dir` is the
 *  ROOM side of the wall face — the same information the old call sites encoded as a ±0.5 nudge on `at`,
 *  now stated rather than implied, because a profile has a front and a back where a box did not. */
function skirt(axis: Axis, from: number, to: number, at: number, dir: 1 | -1): THREE.Mesh {
  return skirting({ axis, from, to, at, y0: 0, dir, key: THEME.oakDark, roughness: 0.7 });
}
function crown(axis: Axis, from: number, to: number, at: number, dir: 1 | -1): THREE.Mesh {
  return cornice({ axis, from, to, at, y0: 0, dir, key: THEME.plaster, wallHeight: STRUCT.wallHeight });
}

/** ROOM-LOCAL FLOOR TONE. The shared ground-floor tile is a warm cream; the CMS reference floor is a cool
 *  pale grey (measured 224,221,219). One multiply plane over THIS room's tile does it — the same device
 *  the Gaming Room's moodFloor uses, nothing global, one mesh, under every rug and every piece of
 *  furniture. FLOOR_LAYER.tint keeps it beneath the additive overlays so it can never wipe one out. */
function coolFloor(): THREE.Mesh {
  const m = floorLayer(new THREE.MeshBasicMaterial({
    color: PALETTE.cmsFloorTint, blending: THREE.MultiplyBlending, premultipliedAlpha: true, transparent: true, depthWrite: false, toneMapped: false,
  }), FLOOR_LAYER.tint);
  const p = rbox(TILE_RECT.w - 0.4, 0.02, TILE_RECT.d - 0.4, m, TILE_RECT.x + TILE_RECT.w / 2, 0.015, TILE_RECT.z + TILE_RECT.d / 2, 0);
  p.castShadow = p.receiveShadow = false;
  return p;
}

/** ONE glazed screen of the west elevation: a solid spandrel, a fixed pane in a slim pale frame, mullions
 *  at an even pitch and a capping rail. Built along Z, because this wall runs north–south — build/frontbar's
 *  glassRun is an X-axis helper and rotating a façade is not what it is for. */
function westScreen(gl: typeof WEST_GLASS_N, name: string): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  // THE PARTITION PLANE, not the wall box. An earlier pass passed the 12-unit WALL depth in as the glazing
  // thickness and then applied build/frontbar's own multipliers (×1.25 shoe, ×1.35 mullion, ×2.6 cap) on
  // top of it — which is how a 3-unit glass detail became a 31-unit slab. Those multipliers are authored
  // against a ~3-unit PANE. A glazed screen is a partition: it is built at STRUCT.wallThickness, centred
  // in the wall's own 12-unit reveal, so the room reads enclosed by glass rather than by masonry.
  const T = STRUCT.wallThickness; // 6
  const cx = (gl.x0 + gl.x1) / 2, len = gl.z1 - gl.z0, cz = (gl.z0 + gl.z1) / 2;
  const fr = plastic("white");
  g.add(rbox(T, GLASS_SPANDREL, len, wall(), cx, 0, cz, 0.5)); //                        spandrel
  g.add(rbox(T * 1.1, 1.4, len, metal(), cx, GLASS_SPANDREL - 1.55, cz, 0.3)); //        brushed shoe
  const glassH = gl.h - GLASS_SPANDREL;
  const pane = rbox(1.0, glassH - 1.0, len - 2, glassMat(), cx, GLASS_SPANDREL + 0.5, cz, 0.1);
  pane.castShadow = false;
  g.add(pane);
  const MULL = 1.9;
  for (let i = 0; i <= gl.bays; i++) {
    const z = gl.z0 + MULL / 2 + ((len - MULL) * i) / gl.bays;
    g.add(rbox(T * 0.85, glassH - 0.3, MULL, fr, cx, GLASS_SPANDREL, z, 0.4));
  }
  g.add(rbox(T * 1.1, 2.2, len, metal(), cx, gl.h - 2.2, cz, 0.6)); //                    capping rail
  return g;
}

/** The west elevation: both screens, the two jamb pilasters either side of the V1 door band, and the head
 *  over the opening so the doorway reads as an opening rather than a gap in a wall. Nothing is built
 *  inside the band — the two sliding leaves are entities. */
function westElevation(): THREE.Group {
  const g = new THREE.Group();
  g.name = "cms-west-elevation";
  g.add(westScreen(WEST_GLASS_N, "cms-west-glass-north"));
  g.add(westScreen(WEST_GLASS_S, "cms-west-glass-south"));
  const cx = (WEST_OUTER_X + WEST_X) / 2, T = STRUCT.wallThickness;
  // the opening's two jambs. Slim posts in the partition plane — a jamb is a reveal, not a buttress.
  for (const z of [DOOR.z0 - 4, DOOR.z1 + 4])
    g.add(rbox(T * 1.15, STRUCT.wallHeight, 8, plastic("white"), cx, 0, z, STRUCT.capRadius));
  // the head over the opening, so the doorway reads as an opening rather than a gap in a wall
  g.add(rbox(T, STRUCT.wallHeight - 36, DOOR.z1 - DOOR.z0, wall(), cx, 36, (DOOR.z0 + DOOR.z1) / 2, STRUCT.capRadius));
  // THE ARCHITRAVE + THRESHOLD (build/arch.ts). A head over an opening says "opening"; an opening with no
  // CASED edge still reads as a rectangle cut in plaster. The casing flanks and heads the reveal on both
  // faces without entering it (the leaf drives through there), and the threshold is a flush strip at 0.3
  // — the same device the Design Room's glass run already uses for its floor track. Nav is untouched:
  // nav/solids.ts never reads a THREE object.
  g.add(doorCasing({ axis: "z", at: cx, thickness: T, from: DOOR.z0, to: DOOR.z1, height: 36, casing: THEME.oakDark, threshold: "metal", name: "cms-door-casing" }));
  return g;
}

// ---- the content-planning wall -----------------------------------------------------------------
/** The whiteboard face, drawn once into a canvas: the reference's three hand-written columns — Content
 *  Ideas / Publishing Schedule / To Do — and the block of coloured squares beside them. This board IS the
 *  CMS room's identity, so it is the one surface in here that carries real content. */
function drawContentBoard(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = "#f6f5f3";
  ctx.fillRect(0, 0, w, h);
  const cols: [string, string[]][] = [
    ["Content Ideas", ["Blog Post", "Social Media", "Case Study", "Email Series", "User Story"]],
    ["Publishing Schedule", ["Mon · Blog", "Wed · Social", "Fri · Newsletter"]],
    ["To Do", ["Q2 Blog Drafts", "Update Style Guide", "Review Landing Pages", "Client Meetings", "Team Planning Sync"]],
  ];
  const titleSize = Math.round(h * 0.115), bodySize = Math.round(h * 0.085);
  cols.forEach(([title, items], c) => {
    const x = w * (0.055 + c * 0.29);
    ctx.fillStyle = "#31363d";
    ctx.font = `${titleSize}px sans-serif`;
    ctx.fillText(title, x, h * 0.19);
    ctx.font = `${bodySize}px sans-serif`;
    ctx.fillStyle = "#5a626c";
    items.forEach((t, i) => ctx.fillText(`· ${t}`, x + w * 0.012, h * (0.33 + i * 0.125)));
  });
  // the sticky block on the right: two rows of four, the reference's own colours
  const notes = ["#f2a15c", "#f2a15c", "#f0e06a", "#6fd8ff", "#f2a15c", "#f0e06a", "#6fd8ff", "#6fd8ff"];
  notes.forEach((col, i) => {
    ctx.fillStyle = col;
    const nx = w * 0.875 + (i % 4) * w * 0.030, ny = h * 0.20 + Math.floor(i / 4) * h * 0.20;
    ctx.fillRect(nx, ny, w * 0.024, h * 0.16);
  });
}

/** The north storage run's CENTRE: the long blue credenza with open filing bays, its whiteboard above,
 *  and the props the render stands on its top. */
function contentWall(): THREE.Group {
  const g = new THREE.Group();
  g.name = "cms-content-board"; // the walk-up pick target
  const c = CONTENT_CREDENZA;
  g.add(credenzaRun({ ...c, facing: "south", along: "x", body: THEME.blue, reveal: THEME.blueDeep, name: "cms-content-credenza" }));
  // OPEN FILING BAYS across its face: dark recesses with binders standing in them
  const b = new Baker();
  const bays = 9, bayW = (c.w - 6) / bays, frontZ = c.z + c.d;
  for (let i = 0; i < bays; i++) {
    const bx = c.x + 3 + bayW * (i + 0.5);
    b.add(rbox(bayW - 1.6, 11, 1.2, mat(THEME.oakDark, 0.9), bx, 5.5, frontZ - 0.4, 0.2));
    for (let j = 0; j < 4; j++)
      b.add(rbox(1.5, 9.4, 3.0, mat(j % 2 ? "white" : "cmsBlueDeep", 0.8), bx - bayW / 2 + 2.2 + j * 1.9, 6.0, frontZ - 2.2, 0.15));
  }
  b.bakeInto(g, "cms-filing-bays");
  // THE BOARD: a pale tray with the content plan printed on it, standing off the wall on a slim frame
  const bw = WHITEBOARD.x1 - WHITEBOARD.x0, bh = WHITEBOARD.y1 - WHITEBOARD.y0;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(bw - 2.4, bh - 2.2), uiScreenMat("cms-content-board", 1024, 168, drawContentBoard, 0.32));
  face.position.set((WHITEBOARD.x0 + WHITEBOARD.x1) / 2, (WHITEBOARD.y0 + WHITEBOARD.y1) / 2, NORTH_Z + 1.3);
  face.castShadow = face.receiveShadow = false;
  g.add(face);
  g.add(rbox(bw, bh, 1.2, mat(THEME.board, 0.7), (WHITEBOARD.x0 + WHITEBOARD.x1) / 2, WHITEBOARD.y0, NORTH_Z + 0.6, 0.4));
  g.add(rbox(bw + 1.6, 1.4, 2.0, metal(), (WHITEBOARD.x0 + WHITEBOARD.x1) / 2, WHITEBOARD.y0 - 1.4, NORTH_Z + 1.0, 0.4)); // pen tray
  // the render's own props on the credenza top: a small plant, a cup, a stack of coloured card
  const topY = c.h;
  g.add(smallPot(c.x + c.w * 0.74, topY, c.z + c.d * 0.55, 1.6));
  g.add(cyl(1.3, 2.4, plastic("white"), c.x + c.w * 0.62, topY, c.z + c.d * 0.55));
  g.add(book(c.x + c.w * 0.50, topY, c.z + c.d * 0.55, 5.0, 5.0, "coveWarm", 0.25));
  return g;
}

/** The north storage run's WEST END: the team library — an oak open-shelf carcass on a blue closed base,
 *  binders and folders on the shelves, a plant standing on top. */
function library(): THREE.Group {
  const g = new THREE.Group();
  g.name = "cms-library";
  const s = LIBRARY, cx = s.x + s.w / 2, cz = s.z + s.d / 2, frontZ = s.z + s.d;
  const b = new Baker();
  const baseH = 15;
  b.add(rbox(s.w, baseH, s.d, mat(THEME.blue, 0.72), cx, 0, cz, 0.6)); //            blue closed base
  b.add(rbox(s.w - 2, 0.6, 1.0, mat(THEME.blueDeep, 0.8), cx, baseH * 0.52, frontZ - 0.3, 0.15)); // door reveal
  for (const sx of [-1, 1]) b.add(rbox(0.8, 0.6, 4.0, plastic("white"), cx + sx * 4.5, baseH * 0.58, frontZ - 0.4, 0.2)); // pulls
  b.add(rbox(s.w + 1, 1.4, s.d + 1, mat(THEME.oak, 0.6), cx, baseH, cz, 0.35)); //   its oak deck
  // OPEN SHELVES above, in an oak carcass with a dark back
  const openY = baseH + 1.4, openH = s.h - openY;
  b.add(rbox(s.w, openH, 1.4, mat(THEME.oakDark, 0.85), cx, openY, s.z + 0.7, 0.2)); // back board
  for (const sx of [-1, 1]) b.add(rbox(1.4, openH, s.d, mat(THEME.oak, 0.62), cx + sx * (s.w / 2 - 0.7), openY, cz, 0.25));
  for (let i = 0; i <= s.shelves; i++) {
    const y = openY + (openH * i) / s.shelves;
    b.add(rbox(s.w - 2.8, 1.0, s.d - 1.4, mat(THEME.oak, 0.62), cx, y, cz + 0.7, 0.2));
  }
  // the binders: two runs per shelf, alternating white and blue, plus a few laid flat
  for (let i = 0; i < s.shelves; i++) {
    const y = openY + (openH * i) / s.shelves + 1.0, hh = openH / s.shelves - 2.4;
    for (let j = 0; j < 10; j++)
      b.add(rbox(1.7, hh, 5.5, mat(j % 3 === 0 ? "cmsBlueDeep" : j % 3 === 1 ? "white" : "cmsBlue", 0.8), s.x + 4 + j * 2.4, y, frontZ - 5.0, 0.15));
  }
  b.bakeInto(g, "cms-library");
  g.add(smallPot(cx, s.h, cz, 2.2));
  return g;
}

/** The north storage run's EAST END: the tea point — an oak counter with the coffee machine, canisters
 *  and a plant, over a glass-fronted under-counter fridge stocked with the render's blue bottles. */
function teaPoint(): THREE.Group {
  const g = new THREE.Group();
  g.name = "cms-counter";
  const c = COUNTER, cx = c.x + c.w / 2, cz = c.z + c.d / 2, frontZ = c.z + c.d;
  const b = new Baker();
  b.add(rbox(c.w - 4, 3.0, c.d - 4, mat(THEME.blueDeep, 0.85), cx, 0, cz, 0.3)); //  recessed toe kick
  b.add(rbox(c.w, c.h - 4.4, c.d, mat(THEME.blue, 0.74), cx, 3.0, cz, 0.5));
  b.add(rbox(c.w + 1.4, 1.6, c.d + 1.4, mat(THEME.oak, 0.55), cx, c.h - 1.6, cz, 0.4)); // oak worktop
  b.add(rbox(c.w * 0.42, 0.7, 0.9, plastic("white"), c.x + c.w * 0.24, c.h * 0.58, frontZ + 0.1, 0.2)); // pull
  b.bakeInto(g, "cms-counter");
  // the FRIDGE: a dark carcass with a glazed door and four bottles standing behind it
  const f = FRIDGE, fx = f.x + f.w / 2, fz = f.z + f.d / 2, fFront = f.z + f.d;
  const fb = new Baker();
  fb.add(rbox(f.w, f.h, f.d, mat("charcoal", 0.55), fx, 2.4, fz, 0.4));
  fb.bakeInto(g, "cms-fridge");
  const door = rbox(f.w - 2.4, f.h - 3.4, 0.8, glassMat(), fx, 3.6, fFront - 0.5, 0.2);
  door.castShadow = false;
  g.add(door);
  const bottles = new Baker();
  for (let i = 0; i < 4; i++)
    bottles.add(cyl(1.1, 6.0, mat("cmsBlue", 0.4), f.x + 3.2 + i * 4.0, 5.0, fz, 0.85));
  bottles.bakeInto(g, "cms-fridge-bottles");
  // COFFEE MACHINE, canisters and a plant on the worktop, as the render stands them
  const topY = c.h;
  const m = new Baker();
  m.add(rbox(9.0, 11.0, 8.0, mat("charcoal", 0.5), c.x + c.w * 0.46, topY, cz, 0.7));
  m.add(rbox(6.4, 1.0, 7.0, metal(), c.x + c.w * 0.46, topY + 0.4, cz + 0.4, 0.2)); //  drip tray
  m.add(rbox(3.0, 3.6, 0.8, mat("uiNavy", 0.4), c.x + c.w * 0.46, topY + 6.0, cz + 4.0, 0.2)); // panel
  m.bakeInto(g, "cms-coffee-machine");
  for (let i = 0; i < 3; i++)
    g.add(lathe([[2.0, 0], [2.2, 0.5], [2.2, 4.2], [1.7, 4.8], [1.7, 5.2]], mat(i === 1 ? "cmsOakDark" : "cmsOak", 0.7), c.x + c.w * 0.70 + i * 5.2, topY, cz + (i % 2 ? 1.5 : -1.5), 14));
  g.add(smallPot(c.x + c.w * 0.16, topY, cz, 2.0));
  return g;
}

// ---- east wall ---------------------------------------------------------------------------------
/** The STICKY WALL and the print station under it. The board is the first thing seen on walking in, so
 *  its notes are real geometry rather than a texture: 30 small coloured tiles on a pale ground. */
function eastWall(): THREE.Group {
  const g = new THREE.Group();
  g.name = "cms-sticky-wall";
  const s = STICKY_WALL, cz = (s.z0 + s.z1) / 2, len = s.z1 - s.z0, h = s.y1 - s.y0;
  const b = new Baker();
  b.add(rbox(1.4, h, len, mat(THEME.board, 0.85), EAST_X - 0.7, s.y0, cz, 0.3)); //           board face
  b.add(rbox(2.2, 1.2, len + 2.0, metal(), EAST_X - 1.1, s.y0 - 1.2, cz, 0.3)); //            bottom rail
  b.add(rbox(2.2, 1.2, len + 2.0, metal(), EAST_X - 1.1, s.y1, cz, 0.3)); //                  top rail
  for (let row = 0; row < 3; row++)
    stickyNotes(b, 10, s.z0 + 5, s.z1 - 5, s.y0 + 5 + row * (h - 10) / 2, EAST_X - 1.6, 3.0, "zy");
  b.bakeInto(g, "cms-sticky-notes");
  return g;
}

/** The PRINT STATION: an oak-topped credenza on a blue plinth running south along the east wall, with the
 *  multifunction printer at its north end, a paper stack and a small plant. */
function printStation(): THREE.Group {
  const g = new THREE.Group();
  g.name = "cms-print-credenza";
  const c = PRINT_CREDENZA;
  g.add(credenzaRun({ ...c, facing: "west", along: "z", body: THEME.blue, reveal: THEME.blueDeep, name: "cms-print-run", top: false }));
  const cx = c.x + c.w / 2, topY = c.h;
  g.add(rbox(c.w + 1.4, 1.6, c.d + 1.4, mat(THEME.oak, 0.55), cx, topY - 1.6, c.z + c.d / 2, 0.4)); // oak worktop
  // the printer: a dark block with a paler output tray and a small panel
  const p = new Baker();
  const pz = c.z + 11;
  p.add(rbox(c.w - 3, 9.0, 16.0, mat("charcoal", 0.5), cx, topY, pz, 0.6));
  p.add(rbox(c.w - 5, 1.0, 12.0, mat("potGray", 0.7), cx, topY + 7.2, pz + 1.0, 0.3)); //  output tray
  p.add(rbox(0.8, 2.4, 4.0, mat("uiNavy", 0.4), c.x + 0.6, topY + 4.0, pz - 4.0, 0.2)); // panel
  p.bakeInto(g, "cms-printer");
  g.add(book(cx, topY, c.z + 30, 9.0, 11.0, "white", 0.08)); //                             paper stack
  g.add(smallPot(cx, topY, c.z + 48, 2.0));
  return g;
}

// ---- the room ----------------------------------------------------------------------------------
export function cmsStatic(room: RoomDef, _opts: unknown): THREE.Group {
  const g = new THREE.Group();
  g.name = `static:${room.id}`;
  g.add(tiledFloor(TILE_RECT, undefined, undefined, { roomId: "cms-room", label: "CMS Room floor" }));
  g.add(coolFloor());
  g.add(wallBox(NORTH_WALL.x0, NORTH_WALL.x1, NORTH_WALL.z0, NORTH_WALL.z1, NORTH_WALL.h));
  g.add(wallBox(SOUTH_WALL.x0, SOUTH_WALL.x1, SOUTH_WALL.z0, SOUTH_WALL.z1, SOUTH_WALL.h));
  g.add(wallBox(EAST_WALL.x0, EAST_WALL.x1, EAST_WALL.z0, EAST_WALL.z1, EAST_WALL.h));
  g.add(westElevation());
  // skirtings on the three solid faces; the glazed west has its own shoe
  g.add(skirt("x", WEST_X, EAST_X, NORTH_Z, 1), crown("x", WEST_X, EAST_X, NORTH_Z, 1));
  g.add(skirt("x", WEST_X, EAST_X, SOUTH_WALL.z0, -1), crown("x", WEST_X, EAST_X, SOUTH_WALL.z0, -1));
  g.add(skirt("z", NORTH_Z, SOUTH_WALL.z0, EAST_X, -1), crown("z", NORTH_Z, SOUTH_WALL.z0, EAST_X, -1));
  g.add(library());
  g.add(contentWall());
  g.add(teaPoint());
  g.add(eastWall());
  g.add(printStation());
  // ---- the content credenza's front edge, and NOTHING else --------------------------------------------
  // The north run already carries the library, the content board and the credenza; the room's own content
  // wall is the thing it is about. All it needed was the worktop bullnose the rest of the office now has.
  g.add(counterNosing({ axis: "x", at: CONTENT_CREDENZA.z + CONTENT_CREDENZA.d + 0.7, dir: 1, from: CONTENT_CREDENZA.x + 1, to: CONTENT_CREDENZA.x + CONTENT_CREDENZA.w - 1, top: CONTENT_CREDENZA.h, key: THEME.oak, name: "cms-credenza-nosing" }));
  return g;
}

/** exported for the tests: the run's front plane, which is what the room's north circulation lane is
 *  measured against */
export const RUN_FRONT_Z = NORTH_Z + RUN_D;
export { CMS_DESK_TOP };
