// vo3d build — QA ROOM static geometry, built in WORLD coordinates.
//
// Architecture: the office's one MINT floor, two solid 12-unit walls north and south, a glazed WEST WINDOW
// WALL running the room's whole length, a split EAST elevation with the V1 door band left empty, plus the
// fixed fit-out — the north STORAGE RUN with its books, prints and box files, the east SUPPLY CREDENZA and
// the lounge's oak SHELF UNIT. The wall east of the storage run is left BARE: the flat reference hangs a
// work-rate board there and it is deliberately not reconstructed (see rooms/qa.ts).
//
// Benches, desks, chairs, the sofa, the pouf, the table, the rug and the plants are entity-driven — see
// rooms/qa.ts.
//
// LIGHTING BUDGET: ZERO real-time lights, the same budget every room since Gaming works to. The window
// wall's daylight is the environment's, not this room's.
import * as THREE from "three";
import type { RoomDef } from "../world/WorldState";
import { Baker, cyl, rbox } from "./helpers";
import { tiledFloor } from "./tile";
import { credenzaRun } from "./frontbar";
import { book, smallPot } from "./props";
import { QA_DESK_TOP, deskPot } from "./qa-furniture";
import { STRUCT } from "../rooms/reception";
import { FLOOR_LAYER, PALETTE, floorLayer, facadeGlassMat, mat, metal, plastic, uiScreenMat } from "../render/Materials";
import {
  CREDENZA, CREDENZA_FRONT, DOOR, EAST_CREDENZA, EAST_WALL_N, EAST_WALL_S, EAST_X, GLASS_SPANDREL,
  LOUNGE_SHELF, NORTH_WALL, NORTH_Z, PRINT_PAIR_X, PRINT_X, SOUTH_WALL, SOUTH_Z, THEME,
  TILE_RECT, WEST_GLASS, WEST_X,
} from "../rooms/qa";

// ---- shell -------------------------------------------------------------------------------------
const wall = () => mat(THEME.plaster, 0.95);
function wallBox(x0: number, x1: number, z0: number, z1: number, h: number): THREE.Mesh {
  return rbox(x1 - x0, h, z1 - z0, wall(), (x0 + x1) / 2, 0, (z0 + z1) / 2, STRUCT.capRadius);
}
/** A slim skirting along an interior wall face — the detail that stops a plaster box reading as a box. */
function skirting(axis: "x" | "z", from: number, to: number, at: number): THREE.Mesh {
  return axis === "x"
    ? rbox(to - from - 1, 1.8, 1.0, mat(THEME.linenDeep, 0.8), (from + to) / 2, 0, at, 0.2)
    : rbox(1.0, 1.8, to - from - 1, mat(THEME.linenDeep, 0.8), at, 0, (from + to) / 2, 0.2);
}

/** ROOM-LOCAL FLOOR TONE. The shared ground-floor tile is a warm cream; the QA reference floor is a soft
 *  MINT, and it is the single most recognisable thing about this room. One multiply plane over THIS room's
 *  tile does it — the same device Gaming's moodFloor, CMS's and AI's coolFloor and Dev's paleFloor use.
 *  FLOOR_LAYER.tint keeps it beneath the additive overlays so it can never wipe one out. */
function mintFloor(): THREE.Mesh {
  const m = floorLayer(new THREE.MeshBasicMaterial({
    color: PALETTE.qaFloorTint, blending: THREE.MultiplyBlending, premultipliedAlpha: true, transparent: true, depthWrite: false, toneMapped: false,
  }), FLOOR_LAYER.tint);
  const p = rbox(TILE_RECT.w - 0.4, 0.02, TILE_RECT.d - 0.4, m, TILE_RECT.x + TILE_RECT.w / 2, 0.015, TILE_RECT.z + TILE_RECT.d / 2, 0);
  p.castShadow = p.receiveShadow = false;
  return p;
}

/** THE WEST WINDOW WALL: the room's best feature and the only exterior glazing on this face of the
 *  building. A low white spandrel, a full-height pane, slim mullions at an even pitch and a head rail.
 *  Built along Z, because this wall runs north–south. */
function windowWall(): THREE.Group {
  const g = new THREE.Group();
  g.name = "qa-window-wall"; // the walk-up pick target
  const gl = WEST_GLASS;
  const T = STRUCT.wallThickness; // 6
  const cx = (gl.x0 + gl.x1) / 2, len = gl.z1 - gl.z0, cz = (gl.z0 + gl.z1) / 2;
  const fr = plastic("white");
  g.add(rbox(T, GLASS_SPANDREL, len, wall(), cx, 0, cz, 0.5)); //                       spandrel
  g.add(rbox(T * 1.1, 1.4, len, metal(), cx, GLASS_SPANDREL - 1.55, cz, 0.3)); //       brushed shoe
  const glassH = gl.h - GLASS_SPANDREL;
  const pane = rbox(1.0, glassH - 1.0, len - 2, facadeGlassMat(), cx, GLASS_SPANDREL + 0.5, cz, 0.1);
  pane.castShadow = false;
  g.add(pane);
  const MULL = 2.0;
  for (let i = 0; i <= gl.bays; i++) {
    const z = gl.z0 + MULL / 2 + ((len - MULL) * i) / gl.bays;
    g.add(rbox(T * 0.85, glassH - 0.3, MULL, fr, cx, GLASS_SPANDREL, z, 0.4));
  }
  // one horizontal transom at head height, which is what gives the render its window GRID rather than
  // a row of tall slots
  g.add(rbox(T * 0.85, 1.6, len - 2, fr, cx, gl.h * 0.62, cz, 0.3));
  g.add(rbox(T * 1.1, 2.2, len, metal(), cx, gl.h - 2.2, cz, 0.6)); //                   head rail
  return g;
}

/** The two jamb pilasters and the head over the east entrance, so it reads as an opening rather than a
 *  gap between two walls. */
function doorSurround(): THREE.Group {
  const g = new THREE.Group();
  g.name = "qa-door-surround";
  const cx = (EAST_X + EAST_X + 12) / 2;
  const fr = plastic("white");
  for (const z of [DOOR.z0 - 4, DOOR.z1 + 4]) g.add(rbox(13, STRUCT.wallHeight, 8, fr, cx, 0, z, STRUCT.capRadius));
  g.add(rbox(STRUCT.wallThickness, STRUCT.wallHeight - 36, DOOR.z1 - DOOR.z0, wall(), cx, 36, (DOOR.z0 + DOOR.z1) / 2, STRUCT.capRadius));
  return g;
}

// ---- the north storage run ---------------------------------------------------------------------
/** A row of spine-out books on the credenza's worktop — the render's own left-hand block. */
function bookRow(g: THREE.Group, x0: number, x1: number, y: number, z: number): void {
  const b = new Baker();
  let x = x0;
  let i = 0;
  while (x < x1 - 1.6) {
    const t = 1.6 + (i % 3) * 0.6;
    b.add(rbox(t, 7.0 + (i % 4) * 0.9, 7.0, mat(i % 3 === 0 ? THEME.teal : i % 3 === 1 ? THEME.linen : THEME.oakDark, 0.8), x + t / 2, y, z, 0.15));
    x += t + 0.4;
    i++;
  }
  b.bakeInto(g, "qa-books");
}

/** ONE framed print standing on the worktop, face into the room. */
function framedPrint(x: number, y: number, z: number, w: number, h: number, lines: readonly string[]): THREE.Group {
  const g = new THREE.Group();
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w - 1.4, h - 1.4), uiScreenMat(`qa-print-${x}`, 256, 320, (ctx, cw, ch) => {
    ctx.fillStyle = "#fbfbf9";
    ctx.fillRect(0, 0, cw, ch);
    ctx.strokeStyle = "#2f6f67";
    ctx.lineWidth = 3;
    ctx.strokeRect(cw * 0.10, ch * 0.10, cw * 0.80, ch * 0.80);
    ctx.fillStyle = "#2f6f67";
    ctx.textAlign = "center";
    lines.forEach((t, i) => {
      ctx.font = `${Math.round(ch * 0.085)}px sans-serif`;
      ctx.fillText(t, cw / 2, ch * (0.34 + i * 0.13));
    });
    ctx.textAlign = "left";
  }, 0.2));
  face.position.set(x, y + h / 2, z - 0.8);
  face.rotation.y = Math.PI;
  face.castShadow = face.receiveShadow = false;
  g.add(rbox(w, h, 1.4, mat(THEME.oakDark, 0.7), x, y, z, 0.3));
  g.add(face);
  g.add(rbox(1.0, 0.8, 4.0, mat(THEME.oakDark, 0.7), x, y, z + 2.0, 0.2)); // the easel foot
  return g;
}

/** THE NORTH STORAGE RUN: a white worktop over light oak carcasses with TEAL box files in them, carrying
 *  books, three framed prints and four small plants. The room's "open a box file" pick target. */
function storageRun(): THREE.Group {
  const g = new THREE.Group();
  g.name = "qa-credenza";
  const c = CREDENZA, cx = c.x + c.w / 2, cz = c.z + c.d / 2, front = CREDENZA_FRONT;
  g.add(credenzaRun({ ...c, facing: "south", along: "x", body: THEME.oak, reveal: THEME.oakDark, name: "qa-credenza-run", top: false }));
  g.add(rbox(c.w + 1.6, 1.8, c.d + 1.6, mat(THEME.white, 0.45), cx, c.h - 1.8, cz, 0.4)); // white worktop
  // TEAL box files sitting in the open bays — the run's strongest colour in plan
  const boxes = new Baker();
  for (let i = 0; i < c.modules; i++) {
    const bx = c.x + (c.w * (i + 0.5)) / c.modules;
    if (i % 2 === 1) continue; // the render leaves every other bay open
    for (const o of [-7, 7]) boxes.add(rbox(12, 9.0, c.d - 7, mat(THEME.teal, 0.75), bx + o, 5.0, cz, 0.5));
  }
  boxes.bakeInto(g, "qa-box-files");
  const topY = c.h;
  bookRow(g, c.x + 6, c.x + 34, topY, front - 8);
  bookRow(g, c.x + 122, c.x + 146, topY, front - 8);
  g.add(framedPrint(PRINT_X, topY, front - 7, 22, 24, ["EXCELLENCE", "THROUGH", "FOCUS &", "IMPACT"]));
  g.add(framedPrint(PRINT_PAIR_X - 9, topY, front - 7, 15, 17, [""]));
  g.add(framedPrint(PRINT_PAIR_X + 9, topY, front - 7, 15, 17, [""]));
  for (const x of [c.x + 42, c.x + 60, c.x + 104]) deskPot(g, x, topY, front - 7, 2.4);
  g.add(smallPot(c.x + c.w - 7, topY, front - 7, 2.6));
  return g;
}

// ---- the east supply credenza ------------------------------------------------------------------
/** THE SUPPLY STATION: the white unit down the east wall south of the entrance, with teal trays, a folded
 *  report stack and two plants on it. The room's "collect a report" pick target. */
function supplyCredenza(): THREE.Group {
  const g = new THREE.Group();
  g.name = "qa-supply";
  const c = EAST_CREDENZA, cz = c.z + c.d / 2;
  g.add(credenzaRun({ ...c, facing: "west", along: "z", body: THEME.white, reveal: THEME.linenDeep, name: "qa-supply-run", top: false }));
  g.add(rbox(c.w + 1.4, 1.6, c.d + 1.4, mat(THEME.white, 0.45), c.x + c.w / 2, c.h - 1.6, cz, 0.4));
  g.add(rbox(3.0, c.h - 6, c.d - 4, mat(THEME.oak, 0.7), c.x + 1.5, 3, cz, 0.3)); // the oak side panel
  const topY = c.h;
  const trays = new Baker();
  for (const [z, hgt] of [[c.z + 16, 5.0], [c.z + 42, 3.6]] as const) {
    trays.add(rbox(c.w - 8, hgt, 13, mat(THEME.teal, 0.7), c.x + c.w / 2, topY, z, 0.7));
    trays.add(rbox(c.w - 14, 1.0, 9, mat(THEME.white, 0.5), c.x + c.w / 2, topY + hgt, z, 0.3));
  }
  trays.bakeInto(g, "qa-supply-trays");
  g.add(book(c.x + c.w / 2, topY, c.z + 52, 9.0, 11.0, THEME.linenDeep, 0.1));
  deskPot(g, c.x + c.w / 2, topY, c.z + 7, 2.6);
  deskPot(g, c.x + c.w / 2, topY, c.z + 30, 2.2);
  return g;
}

// ---- the lounge shelf --------------------------------------------------------------------------
/** THE READING SHELF at the lounge's head: a light oak open unit with binders and boxes in it, and the
 *  framed print and two plants the render stands on top. The room's "pick up a book" pick target. */
function loungeShelf(): THREE.Group {
  const g = new THREE.Group();
  g.name = "qa-lounge-shelf";
  const s = LOUNGE_SHELF, cx = s.x + s.w / 2, cz = s.z + s.d / 2, front = s.z + s.d;
  const b = new Baker();
  b.add(rbox(s.w, s.h, s.d, mat(THEME.oak, 0.7), cx, 0, cz, 0.5));
  b.add(rbox(s.w - 3, s.h - 6, s.d - 3, mat(THEME.oakDark, 0.85), cx, 3, cz, 0.3)); // the recessed bays
  b.add(rbox(s.w - 3, 0.9, s.d - 3, mat(THEME.oak, 0.7), cx, s.h / 2, cz, 0.2)); //    the middle shelf
  b.add(rbox(1.2, s.h - 6, s.d - 3, mat(THEME.oak, 0.7), cx, 3, cz, 0.2)); //          its centre divider
  b.bakeInto(g, "qa-shelf-carcass");
  // binders and a storage box in the bays
  const kit = new Baker();
  for (const [x, y] of [[s.x + 5, 4.5], [s.x + 20, 4.5], [s.x + 20, s.h / 2 + 1]] as const)
    kit.add(rbox(9.0, 6.5, s.d - 6, mat(THEME.linenDeep, 0.8), x, y, cz, 0.3));
  kit.add(rbox(8.0, 6.0, s.d - 6, mat(THEME.white, 0.6), s.x + 6, s.h / 2 + 1, cz, 0.3));
  kit.bakeInto(g, "qa-shelf-kit");
  g.add(framedPrint(cx - 4, s.h, front - 5, 14, 16, [""]));
  deskPot(g, s.x + 5, s.h, front - 5, 2.4);
  deskPot(g, s.x + s.w - 5, s.h, front - 6, 2.8);
  g.add(cyl(1.6, 0.9, mat(THEME.oakDark, 0.7), cx + 8, s.h, front - 12, 1.6));
  return g;
}

// ---- the room ----------------------------------------------------------------------------------
export function qaStatic(room: RoomDef, _opts: unknown): THREE.Group {
  const g = new THREE.Group();
  g.name = `static:${room.id}`;
  g.add(tiledFloor(TILE_RECT));
  g.add(mintFloor());
  g.add(wallBox(NORTH_WALL.x0, NORTH_WALL.x1, NORTH_WALL.z0, NORTH_WALL.z1, NORTH_WALL.h));
  g.add(wallBox(SOUTH_WALL.x0, SOUTH_WALL.x1, SOUTH_WALL.z0, SOUTH_WALL.z1, SOUTH_WALL.h));
  g.add(wallBox(EAST_WALL_N.x0, EAST_WALL_N.x1, EAST_WALL_N.z0, EAST_WALL_N.z1, EAST_WALL_N.h));
  g.add(wallBox(EAST_WALL_S.x0, EAST_WALL_S.x1, EAST_WALL_S.z0, EAST_WALL_S.z1, EAST_WALL_S.h));
  g.add(windowWall());
  g.add(doorSurround());
  // skirtings on the three solid faces; the glazed west has its own shoe
  g.add(skirting("x", WEST_X, EAST_X, NORTH_Z + 0.5));
  g.add(skirting("x", WEST_X, EAST_X, SOUTH_Z - 0.5));
  g.add(skirting("z", NORTH_Z, SOUTH_Z, EAST_X - 0.5));
  g.add(storageRun());
  g.add(supplyCredenza());
  g.add(loungeShelf());
  return g;
}

/** exported for the tests: the desk height the room's dressing stands on */
export { QA_DESK_TOP };
