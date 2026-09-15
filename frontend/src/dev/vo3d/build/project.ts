// vo3d build — PROJECT ROOM static geometry, built in WORLD coordinates.
//
// Architecture: tiled floor, the north cove wall, the east wall, the shared south façade section with the
// artwork's (sealed) glass doors, and the exterior ledge planters.
// Fixed installations: the east coffee/equipment console and the machines on it, the large wall display,
// and the low bench between the armchairs.
// Lounge furniture (sofas, coffee table, tub chairs, plants) is entity-driven — see rooms/project.ts.
//
// Builds NO west boundary of any kind: the artwork has none and the floor runs straight into Reception.
import * as THREE from "three";
import { cyl, rbox } from "./helpers";
import { tiledFloor } from "./tile";
import { emissiveMatUnique, glowMat, mat, metal, plastic, uiScreenMat, wood } from "../render/Materials";
import { animated } from "../render/Ambient";
import { coveWall, credenzaRun, facadeSection, ledgePlanter, slatPanel } from "./frontbar";
import { FACADE, STRUCT } from "../rooms/reception";
import { FACADE_Z } from "../adapters/v1Floor";
import type { RoomDef } from "../world/WorldState";
import {
  BENCH, CONSOLE, CONSOLE_KIT, EAST_WALL, FACADE_DOOR, LEDGE_PLANTERS, NE_SLATS, NORTH_WALL,
  RECT, TILE_RECT, WALL_TV, WEST_EDGE,
} from "../rooms/project";

/** the bracket tilt that lifts the east wall's display out of edge-on for the game camera (see below) */
const TV_TILT = -0.5;

/** One machine on the console top. The artwork lines up an espresso machine with twin group heads, two
 *  grinders with clear hoppers and two dark brewers — built as compact silhouettes, not appliances. */
function machine(kind: "espresso" | "brewer" | "grinder", cx: number, y0: number, cz: number): THREE.Group {
  const g = new THREE.Group();
  if (kind === "espresso") {
    g.add(rbox(26, 11, 20, plastic("white"), cx, y0, cz, 1.6));
    g.add(rbox(22, 1.6, 6, metal(), cx, y0 + 11, cz - 4, 0.5)); // cup warmer rail
    for (const s of [-1, 1]) {
      g.add(cyl(2.2, 4.5, metal(), cx + s * 6, y0 + 2, cz + 9));
      g.add(rbox(5, 1.4, 3, mat("charcoal", 0.5), cx + s * 6, y0 + 2, cz + 11.4, 0.3)); // portafilter
    }
  } else if (kind === "grinder") {
    g.add(rbox(13, 13, 15, mat("charcoal", 0.45), cx, y0, cz, 1.2));
    g.add(cyl(4.6, 9, plastic("white"), cx, y0 + 13, cz - 1.5, 3.6)); // hopper
    g.add(rbox(5, 4, 4, metal(), cx, y0 + 3, cz + 7.5, 0.4));
  } else {
    g.add(rbox(22, 12, 18, mat("charcoal", 0.4), cx, y0, cz, 1.4));
    g.add(rbox(14, 0.4, 10, metal(), cx, y0 + 12, cz, 0.3)); // top plate
    g.add(animated(rbox(6, 0.35, 0.5, emissiveMatUnique("coveWarm", 1.0, 0.3), cx, y0 + 4.5, cz + 9.1, 0.15), {
      kind: "pulse", period: 6.4, phase: 0.3, min: 0.7, max: 1.15,
    }));
  }
  return g;
}

/** The dark-walnut coffee/equipment console against the east wall, its machines, and the large wall
 *  display above it. The console faces WEST, into the room. */
function eastConsole(): THREE.Group {
  const g = new THREE.Group();
  g.name = "project-east-console";
  g.add(credenzaRun({ ...CONSOLE, facing: "west", along: "z", name: "project-console" }));
  const top = CONSOLE.h;
  const cx = CONSOLE.x + CONSOLE.w * 0.45;
  for (const k of CONSOLE_KIT) g.add(machine(k.kind, cx, top, k.z));
  // The large wall display, on a tilting bracket. The production artwork's camera sees the east wall's
  // west face straight on; the GAME camera (pitch 52, yaw 0) sits due south, so a panel whose normal is
  // −x is exactly edge-on and vanishes. Tipping the face up ~28° is what a real bracket does and is the
  // honest translation of the render's baked viewpoint — position, size and mount are the measured ones.
  const tv = WALL_TV, faceX = EAST_WALL.x0 - 0.2;
  const h = tv.y1 - tv.y0, w = tv.z1 - tv.z0, cz = (tv.z0 + tv.z1) / 2;
  const tvG = new THREE.Group();
  tvG.name = "project-wall-tv";
  tvG.position.set(faceX, (tv.y0 + tv.y1) / 2, cz);
  tvG.rotation.z = TV_TILT; // −x normal rotates toward +y: the face tips up, out of edge-on
  tvG.add(rbox(1.6, h, w, mat("charcoal", 0.4), 0, -h / 2, 0, 0.5));
  const panel = rbox(0.35, h - 3, w - 3, uiScreenMat("project-tv-ui", 224, 128, drawTvUi, 0.95, true), -1.0, -(h - 3) / 2, 0, 0.12);
  tvG.add(animated(panel, { kind: "pulse", period: 9.1, phase: 0.6, min: 0.9, max: 1.1 }));
  const wash = rbox(0.06, h + 8, w + 10, glowMat("cyan", 0.035), -1.4, -(h + 8) / 2, 0, 0);
  wash.castShadow = wash.receiveShadow = false;
  tvG.add(wash);
  g.add(tvG);
  return g;
}
function drawTvUi(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const grd = ctx.createLinearGradient(0, 0, w, h);
  grd.addColorStop(0, "#123a6e"); grd.addColorStop(1, "#0b1c38");
  ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h);
  // an abstracted board: a header rule, a couple of columns of cards, one accent tile
  ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.fillRect(w * 0.06, h * 0.1, w * 0.3, 6);
  ctx.fillStyle = "#3f8fe0"; ctx.fillRect(w * 0.06, h * 0.26, w * 0.26, h * 0.2);
  ctx.fillStyle = "rgba(255,255,255,0.2)";
  for (let c = 0; c < 3; c++) for (let r = 0; r < 2; r++) ctx.fillRect(w * (0.38 + c * 0.2), h * (0.26 + r * 0.3), w * 0.16, h * 0.2);
  ctx.fillStyle = "#6fcf5a"; ctx.fillRect(w * 0.06, h * 0.56, w * 0.26, h * 0.1);
  ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.fillRect(w * 0.06, h * 0.8, w * 0.86, 4);
}

/** The low light-wood bench/console the artwork puts between the two armchairs, with an open shelf and a
 *  single drawer. Decorative: nothing sits on it in the source. */
function centreBench(): THREE.Group {
  const g = new THREE.Group();
  g.name = "project-bench";
  const b = BENCH, cx = b.x + b.w / 2, cz = b.z + b.d / 2;
  g.add(rbox(b.w - 5, 2.4, b.d - 5, mat("charcoal", 0.7), cx, 0, cz, 0.4)); // plinth
  g.add(rbox(b.w, b.h - 4.2, b.d, wood("box"), cx, 2.4, cz, 0.6));
  g.add(rbox(b.w + 1.2, 1.4, b.d + 1.2, mat("tableWood", 0.6), cx, b.h - 1.4, cz, 0.35)); // top
  g.add(rbox(b.w - 7, 2.6, 0.5, mat("charcoal", 0.85), cx, b.h - 6.4, b.z - 0.1, 0.15)); // open shelf reveal
  g.add(rbox(8, 0.7, 0.7, metal(), cx, b.h - 4.4, b.z - 0.3, 0.2)); // drawer pull
  return g;
}

export function projectStatic(_room: RoomDef): THREE.Group {
  const g = new THREE.Group();
  g.name = "static:project-room";
  g.add(tiledFloor(TILE_RECT, undefined, undefined, { roomId: "project-room", label: "Project Room floor" }));

  // ---- north: the cream cove wall that closes the bar's east end -------------------------------------
  // a different ambient phase from Meeting's, so the two coves never breathe in lockstep
  g.add(coveWall({ ...NORTH_WALL, phase: 0.37, name: "project-cove-wall" }));
  g.add(slatPanel({ axis: "x", at: NORTH_WALL.z1, dir: 1, from: NE_SLATS.from, to: NE_SLATS.to, y0: NE_SLATS.y0, y1: NE_SLATS.y1, name: "project-ne-slats" }));

  // ---- east: solid wall + skirting, with the console standing against it ------------------------------
  const e = EAST_WALL;
  g.add(rbox(e.x1 - e.x0, e.h, e.z1 - e.z0, mat("plaster", 0.96), (e.x0 + e.x1) / 2, 0, (e.z0 + e.z1) / 2, STRUCT.capRadius));
  g.add(rbox(0.9, 1.6, e.z1 - e.z0 - 0.6, plastic("white"), e.x0 - 0.45, 0, (e.z0 + e.z1) / 2, 0.2));
  g.add(eastConsole());
  g.add(centreBench());

  // ---- west: NOTHING. The floor runs into Reception ---------------------------------------------------

  // ---- south: this room's share of the SHARED street façade -------------------------------------------
  // `endPosts.start = false` hands the seam mullion to Reception's run, which already builds a post 0.9
  // west of the shared edge — without this the bar would show a doubled post at x 1081.285.
  g.add(facadeSection({
    x0: WEST_EDGE, x1: RECT.x + RECT.w, facadeZ: FACADE_Z, t: STRUCT.wallThickness, h: STRUCT.wallHeight,
    panelPitch: FACADE.panelPitch, pilasterW: FACADE.pilasterW, door: FACADE_DOOR,
    endPosts: { start: false }, name: "project-facade",
  }));
  for (const p of LEDGE_PLANTERS) g.add(ledgePlanter(p.x, p.z, p.r, p.h));
  return g;
}
