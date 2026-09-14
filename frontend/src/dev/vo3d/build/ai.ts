// vo3d build — AI ROOM static geometry, built in WORLD coordinates.
//
// Architecture: the coolest, palest tiled floor in the office, three solid 12-unit walls, a glazed SOUTH
// elevation with the V1 door band left empty, plus the fixed fit-out — the north-west machine end (the
// robot's charging pad and the three server racks), the north MISSION WALL, the west DISPLAY STACK and the
// east counter run with its tea point and lab printer.
//
// Benches, desks, chairs and plants are entity-driven — see rooms/ai.ts.
//
// LIGHTING BUDGET: ZERO real-time lights, the same budget Gaming, the Central Hub, Executive and CMS work
// to. Every blue line in here is a static emissive surface with an additive halo plane beside it.
import * as THREE from "three";
import type { RoomDef } from "../world/WorldState";
import { Baker, cyl, rbox } from "./helpers";
import { tiledFloor } from "./tile";
import { credenzaRun } from "./frontbar";
import { book, smallPot } from "./props";
import { AI_DESK_TOP, ledLine, opsRobot } from "./ai-furniture";
import { STRUCT } from "../rooms/reception";
import { FLOOR_LAYER, PALETTE, emissiveMat, floorLayer, glassMat, glowMat, mat, metal, plastic, uiScreenMat } from "../render/Materials";
import {
  COFFEE_Z, COUNTER, DOOR, EAST_WALL, EAST_X, GLASS_SPANDREL, NORTH_WALL, NORTH_Z, PANELS, PANEL_D,
  PRINTER_Z, RACKS, ROBOT, ROBOT_DOCK, SOUTH_GLASS, SOUTH_Z, THEME, TILE_RECT, WALL_BAND, WEST_PANELS,
  WEST_PANEL_Y, WEST_WALL, WEST_X,
} from "../rooms/ai";

// ---- shell -------------------------------------------------------------------------------------
const wall = () => mat(THEME.plaster, 0.95);
function wallBox(x0: number, x1: number, z0: number, z1: number, h: number): THREE.Mesh {
  return rbox(x1 - x0, h, z1 - z0, wall(), (x0 + x1) / 2, 0, (z0 + z1) / 2, STRUCT.capRadius);
}
/** A slim skirting along an interior wall face — the detail that stops a plaster box reading as a box. */
function skirting(axis: "x" | "z", from: number, to: number, at: number): THREE.Mesh {
  return axis === "x"
    ? rbox(to - from - 1, 1.8, 1.0, mat(THEME.carbon, 0.7), (from + to) / 2, 0, at, 0.2)
    : rbox(1.0, 1.8, to - from - 1, mat(THEME.carbon, 0.7), at, 0, (from + to) / 2, 0.2);
}

/** ROOM-LOCAL FLOOR TONE. The shared ground-floor tile is a warm cream; the AI reference floor is the
 *  coolest, palest surface in the building (measured 216,215,221). One multiply plane over THIS room's
 *  tile does it — the same device Gaming's moodFloor and CMS's coolFloor use. FLOOR_LAYER.tint keeps it
 *  beneath the additive overlays so it can never wipe one out. */
function coolFloor(): THREE.Mesh {
  const m = floorLayer(new THREE.MeshBasicMaterial({
    color: PALETTE.aiFloorTint, blending: THREE.MultiplyBlending, transparent: true, depthWrite: false, toneMapped: false,
  }), FLOOR_LAYER.tint);
  const p = rbox(TILE_RECT.w - 0.4, 0.02, TILE_RECT.d - 0.4, m, TILE_RECT.x + TILE_RECT.w / 2, 0.015, TILE_RECT.z + TILE_RECT.d / 2, 0);
  p.castShadow = p.receiveShadow = false;
  return p;
}

/** THE SOUTH GLAZED SCREEN: a solid spandrel washed by a blue LED line, a fixed pane in a slim pale frame,
 *  mullions at an even pitch and a capping rail. Built along X, because this wall runs east–west. */
function southScreen(): THREE.Group {
  const g = new THREE.Group();
  g.name = "ai-south-glass";
  const gl = SOUTH_GLASS;
  // THE PARTITION PLANE, not the wall box — built at STRUCT.wallThickness and centred in the wall's own
  // 12-unit reveal, exactly as CMS's west elevation is, so the room reads enclosed by glass not masonry.
  const T = STRUCT.wallThickness; // 6
  const cz = (gl.z0 + gl.z1) / 2, len = gl.x1 - gl.x0, cx = (gl.x0 + gl.x1) / 2;
  const fr = plastic("white");
  g.add(rbox(len, GLASS_SPANDREL, T, wall(), cx, 0, cz, 0.5)); //                        spandrel
  g.add(rbox(len, 1.4, T * 1.1, metal(), cx, GLASS_SPANDREL - 1.55, cz, 0.3)); //        brushed shoe
  ledLine(g, len - 4, 0.6, 1.0, cx, GLASS_SPANDREL - 2.6, cz - T * 0.6); //              the art's blue line
  const glassH = gl.h - GLASS_SPANDREL;
  const pane = rbox(len - 2, glassH - 1.0, 1.0, glassMat(), cx, GLASS_SPANDREL + 0.5, cz, 0.1);
  pane.castShadow = false;
  g.add(pane);
  const MULL = 1.9;
  for (let i = 0; i <= gl.bays; i++) {
    const x = gl.x0 + MULL / 2 + ((len - MULL) * i) / gl.bays;
    g.add(rbox(MULL, glassH - 0.3, T * 0.85, fr, x, GLASS_SPANDREL, cz, 0.4));
  }
  g.add(rbox(len, 2.2, T * 1.1, metal(), cx, gl.h - 2.2, cz, 0.6)); //                    capping rail
  // the opening's west jamb and its head, so the doorway reads as an opening rather than a gap in a wall
  g.add(rbox(8, STRUCT.wallHeight, T * 1.15, fr, DOOR.x0 - 4, 0, cz, STRUCT.capRadius));
  g.add(rbox(DOOR.x1 - DOOR.x0, STRUCT.wallHeight - 36, T, wall(), (DOOR.x0 + DOOR.x1) / 2, 36, cz, STRUCT.capRadius));
  return g;
}

// ---- the north machine end ---------------------------------------------------------------------
/** The robot's CHARGING PAD: a low dark plinth with a blue ring let into its face, and the robot itself
 *  standing on it. This is the room's pick target for the "wake the robot" walk-up. */
function robotDock(): THREE.Group {
  const g = new THREE.Group();
  g.name = "ai-robot";
  const s = ROBOT_DOCK, cx = s.x + s.w / 2, cz = s.z + s.d / 2;
  const b = new Baker();
  b.add(rbox(s.w, s.h, s.d, mat(THEME.carbon, 0.7), cx, 0, cz, 0.8));
  b.add(rbox(s.w - 4, 1.0, s.d - 4, mat(THEME.carbonDeep, 0.9), cx, s.h - 1.0, cz, 0.4));
  b.bakeInto(g, "ai-robot-dock");
  const ring = cyl(ROBOT.r * 1.05, 0.3, glowMat(THEME.led, 0.30), ROBOT.x, s.h + 0.1, ROBOT.z, ROBOT.r * 1.05);
  ring.castShadow = ring.receiveShadow = false;
  g.add(ring);
  const bot = opsRobot(ROBOT.x, ROBOT.z, ROBOT.r, ROBOT.h);
  bot.position.y = s.h;
  bot.rotation.y = -0.35; // turned a touch into the room, as the render poses it
  g.add(bot);
  return g;
}

/** THE COMPUTE CLUSTER: three racks of dark cabinet, each with a column of blue indicator squares down its
 *  face and a lit strip along its head — the art's whole north-west corner. */
function racks(): THREE.Group {
  const g = new THREE.Group();
  g.name = "ai-racks";
  const s = RACKS, cz = s.z + s.d / 2, frontZ = s.z + s.d;
  const b = new Baker();
  const bayW = s.w / s.bays;
  b.add(rbox(s.w, 3.0, s.d, mat(THEME.carbonDeep, 0.9), s.x + s.w / 2, 0, cz, 0.3)); //    plinth
  for (let i = 0; i < s.bays; i++) {
    const bx = s.x + bayW * (i + 0.5);
    b.add(rbox(bayW - 1.4, s.h - 3.0, s.d, mat(THEME.carbon, 0.62), bx, 3.0, cz, 0.5));
    b.add(rbox(bayW - 4.0, s.h - 8.0, 1.0, mat(THEME.carbonDeep, 0.85), bx, 6.0, frontZ - 0.4, 0.2)); // door recess
  }
  b.bakeInto(g, "ai-racks");
  // the blue indicator grid: two columns of small emissive squares per bay, baked as one mesh
  const leds = new Baker();
  for (let i = 0; i < s.bays; i++) {
    const bx = s.x + bayW * (i + 0.5);
    for (let row = 0; row < 9; row++) for (const c of [-1, 1])
      leds.add(rbox(1.4, 0.7, 0.3, emissiveMat(THEME.led, 1.3, 0.3), bx + c * 3.2, 8.0 + row * 2.6, frontZ - 0.2, 0.1));
  }
  leds.bakeInto(g, "ai-rack-leds");
  ledLine(g, s.w - 2, 0.6, 0.8, s.x + s.w / 2, s.h - 1.4, frontZ - 0.3);
  return g;
}

// ---- the mission wall --------------------------------------------------------------------------
const STRAPLINE = ["Smarter", "Systems.", "Bigger Impact."];
const MISSION_LINES = ["Build intelligent solutions", "Automate with purpose", "Innovate responsibly", "Scale impact globally"];

/** Every hung panel in this room is drawn on the same dark UI ground with the same blue ink — one canvas
 *  routine, switched on the panel's kind, so the wall reads as ONE system rather than four posters. */
function drawPanel(kind: string, title = ""): (ctx: CanvasRenderingContext2D, w: number, h: number) => void {
  return (ctx, w, h) => {
    ctx.fillStyle = "#0a1526";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(70,150,240,0.18)";
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += Math.round(w / 26)) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    const blue = "#4aa3f0", pale = "#cfe2fa";
    if (kind === "text") {
      ctx.fillStyle = pale;
      ctx.font = `${Math.round(h * 0.16)}px sans-serif`;
      STRAPLINE.forEach((t, i) => ctx.fillText(t, w * 0.08, h * (0.34 + i * 0.21)));
      return;
    }
    if (kind === "mission") {
      ctx.fillStyle = pale;
      ctx.font = `${Math.round(h * 0.15)}px sans-serif`;
      ctx.fillText("OUR MISSION", w * 0.07, h * 0.21);
      ctx.font = `${Math.round(h * 0.095)}px sans-serif`;
      ctx.fillStyle = blue;
      MISSION_LINES.forEach((t, i) => ctx.fillText(`· ${t}`, w * 0.09, h * (0.40 + i * 0.145)));
      return;
    }
    if (kind === "brain") {
      // the neural network: three layers of nodes, every node wired to the next layer
      const layers = [5, 7, 7, 4];
      const pts: [number, number][][] = layers.map((n, li) =>
        Array.from({ length: n }, (_, i) => [w * (0.34 + li * 0.15), h * ((i + 1) / (n + 1))] as [number, number]));
      ctx.strokeStyle = "rgba(74,163,240,0.35)";
      for (let li = 0; li < pts.length - 1; li++)
        for (const a of pts[li]) for (const bpt of pts[li + 1]) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(bpt[0], bpt[1]); ctx.stroke(); }
      ctx.fillStyle = blue;
      for (const layer of pts) for (const p of layer) { ctx.beginPath(); ctx.arc(p[0], p[1], h * 0.028, 0, Math.PI * 2); ctx.fill(); }
      // the left-hand log column and the right-hand readouts the render draws beside it
      ctx.fillStyle = "rgba(140,190,245,0.55)";
      for (let i = 0; i < 12; i++) ctx.fillRect(w * 0.04, h * (0.10 + i * 0.066), w * 0.20 * (0.4 + ((i * 7) % 10) / 14), h * 0.028);
      for (let i = 0; i < 4; i++) ctx.fillRect(w * 0.86, h * (0.62 + i * 0.09), w * 0.11, h * 0.05);
      return;
    }
    if (kind === "schematic") {
      // the west stack: a titled technical diagram — a ring of nodes wired to a boxed core, over a band of
      // readout bars. Abstract on purpose: the reference draws blueprint, not readable text.
      ctx.fillStyle = pale;
      ctx.font = `${Math.round(h * 0.048)}px sans-serif`;
      title.split("\n").forEach((t, i) => ctx.fillText(t, w * 0.10, h * (0.075 + i * 0.055)));
      const cxp = w * 0.5, cyp = h * 0.46, rad = Math.min(w, h) * 0.22;
      ctx.strokeStyle = "rgba(74,163,240,0.45)";
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const nx = cxp + Math.cos(a) * rad, ny = cyp + Math.sin(a) * rad;
        ctx.beginPath(); ctx.moveTo(cxp, cyp); ctx.lineTo(nx, ny); ctx.stroke();
        ctx.fillStyle = blue;
        ctx.beginPath(); ctx.arc(nx, ny, Math.min(w, h) * 0.026, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeRect(cxp - rad * 0.42, cyp - rad * 0.30, rad * 0.84, rad * 0.60);
      ctx.fillStyle = "rgba(140,190,245,0.5)";
      for (let i = 0; i < 7; i++) ctx.fillRect(w * 0.12, h * (0.78 + i * 0.028), w * 0.76 * (0.35 + ((i * 5) % 9) / 12), h * 0.014);
      return;
    }
    // "map": a dotted world plate with a few bright deployment markers
    ctx.fillStyle = "rgba(74,163,240,0.42)";
    for (let r = 0; r < 22; r++) for (let c = 0; c < 52; c++) {
      const nx = c / 52, ny = r / 22;
      const land = Math.sin(nx * 7.1 + ny * 2.3) + Math.cos(ny * 5.7 - nx * 3.1);
      if (land > 0.45) ctx.fillRect(w * 0.06 + nx * w * 0.88, h * 0.12 + ny * h * 0.76, w * 0.008, h * 0.018);
    }
    ctx.fillStyle = "#8fd0ff";
    for (const [mx, my] of [[0.24, 0.34], [0.47, 0.56], [0.68, 0.30], [0.80, 0.62]])
      { ctx.beginPath(); ctx.arc(w * mx, h * my, h * 0.030, 0, Math.PI * 2); ctx.fill(); }
  };
}

/** ONE hung display: a dark tray standing PANEL_D proud of the wall face, with the drawn UI on its front
 *  and a thin blue edge-glow around it. `plane` says which wall it hangs on. */
function hungPanel(name: string, kind: string, a0: number, a1: number, y0: number, y1: number, at: number, plane: "north" | "west", title = ""): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  const len = a1 - a0, hh = y1 - y0, mid = (a0 + a1) / 2, ymid = (y0 + y1) / 2;
  const px = Math.max(256, Math.round(len * 8)), py = Math.max(96, Math.round(hh * 8));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(len - 2.0, hh - 2.0), uiScreenMat(`ai-${name}`, Math.min(px, 1024), Math.min(py, 512), drawPanel(kind, title), 0.5));
  const tray = plane === "north"
    ? rbox(len, hh, PANEL_D, mat(THEME.carbonDeep, 0.55), mid, y0, at, 0.5)
    : rbox(PANEL_D, hh, len, mat(THEME.carbonDeep, 0.55), at, y0, mid, 0.5);
  g.add(tray);
  if (plane === "north") {
    face.position.set(mid, ymid, at + PANEL_D / 2 + 0.2);
  } else {
    face.rotation.y = Math.PI / 2;
    face.position.set(at + PANEL_D / 2 + 0.2, ymid, mid);
  }
  face.castShadow = face.receiveShadow = false;
  g.add(face);
  // the blue edge line under every panel — the detail that ties the two elevations together
  if (plane === "north") ledLine(g, len, 0.5, 0.8, mid, y0 - 1.0, at + PANEL_D / 2);
  else ledLine(g, 0.8, 0.5, len, at + PANEL_D / 2, y0 - 1.0, mid);
  return g;
}

/** THE MISSION WALL: the carbon band across the north elevation east of the racks, its vertical blue LED
 *  strips, and the four hung panels — strapline, neural dashboard, mission list, deployment map. */
function missionWall(): THREE.Group {
  const g = new THREE.Group();
  g.name = "ai-mission-wall"; // the walk-up pick target
  const b = WALL_BAND;
  const band = new Baker();
  band.add(rbox(b.x1 - b.x0, b.y1 - b.y0, 2.0, mat(THEME.carbon, 0.62), (b.x0 + b.x1) / 2, b.y0, NORTH_Z + 1.0, 0.5));
  band.bakeInto(g, "ai-wall-band");
  // vertical LED strips in the gaps BETWEEN the panels, plus one at each end of the band
  const edges = [b.x0 + 1, ...PANELS.flatMap((p) => [p.x0 - 1, p.x1 + 1]), b.x1 - 1];
  for (const x of edges) ledLine(g, 0.8, b.y1 - b.y0 - 3, 0.7, x, b.y0 + 1.5, NORTH_Z + 2.1);
  for (const p of PANELS) g.add(hungPanel(p.id, p.kind, p.x0, p.x1, p.y0, p.y1, NORTH_Z + 2.0, "north"));
  return g;
}

/** THE WEST DISPLAY STACK: three tall schematic panels running down the west wall, on the same tray and
 *  edge-glow treatment as the mission wall so both elevations read as one system. */
function westDisplays(): THREE.Group {
  const g = new THREE.Group();
  g.name = "ai-west-displays"; // the walk-up pick target
  const first = WEST_PANELS[0], last = WEST_PANELS[WEST_PANELS.length - 1];
  const band = new Baker();
  band.add(rbox(2.0, WEST_PANEL_Y.y1 - WEST_PANEL_Y.y0 + 6, last.z1 - first.z0 + 6,
    mat(THEME.carbon, 0.62), WEST_X + 1.0, WEST_PANEL_Y.y0 - 3, (first.z0 + last.z1) / 2, 0.5));
  band.bakeInto(g, "ai-west-band");
  for (const p of WEST_PANELS)
    g.add(hungPanel(p.id, "schematic", p.z0, p.z1, WEST_PANEL_Y.y0, WEST_PANEL_Y.y1, WEST_X + 2.0, "west", p.title));
  return g;
}

// ---- the east counter --------------------------------------------------------------------------
/** THE TECH BAR: the white lacquer run down the east wall, a blue LED line under its lip, the coffee
 *  machine and a plant at its north end and the lab printer at its south. */
function counterRun(): THREE.Group {
  const g = new THREE.Group();
  g.name = "ai-counter";
  const c = COUNTER, cx = c.x + c.w / 2, frontX = c.x;
  g.add(credenzaRun({ ...c, facing: "west", along: "z", body: THEME.counter, reveal: THEME.frame, name: "ai-counter-run" }));
  g.add(rbox(c.w + 1.4, 1.6, c.d + 1.4, mat(THEME.counter, 0.42), cx, c.h - 1.6, c.z + c.d / 2, 0.4)); // worktop
  ledLine(g, 1.0, 0.6, c.d - 6, frontX + 0.3, c.h - 4.0, c.z + c.d / 2);
  const topY = c.h;
  // COFFEE MACHINE: a dark block with a lit panel, as the art stands it
  const m = new Baker();
  m.add(rbox(c.w - 7, 11.0, 9.0, mat(THEME.carbon, 0.5), cx + 1.0, topY, COFFEE_Z, 0.7));
  m.add(rbox(c.w - 11, 1.0, 7.4, metal(), cx + 1.0, topY + 0.4, COFFEE_Z - 0.6, 0.2)); //   drip tray
  m.bakeInto(g, "ai-coffee-machine");
  const panel = rbox(0.6, 3.2, 4.0, emissiveMat(THEME.screen, 0.8, 0.3), frontX + 1.2, topY + 5.6, COFFEE_Z, 0.2);
  panel.castShadow = false;
  g.add(panel);
  // THE LAB PRINTER at the south end: a dark carcass with a glazed front and a lit bed. Its OWN group,
  // because it is the room's "collect a print" pick target and the counter run is a separate one.
  const printer = new THREE.Group();
  printer.name = "ai-printer";
  const p = new Baker();
  p.add(rbox(c.w - 5, 13.0, 18.0, mat(THEME.carbon, 0.5), cx, topY, PRINTER_Z, 0.6));
  p.add(rbox(c.w - 9, 1.0, 14.0, mat(THEME.carbonDeep, 0.8), cx, topY + 1.0, PRINTER_Z, 0.3)); // bed
  p.bakeInto(printer, "ai-printer-body");
  const door = rbox(0.8, 9.0, 14.0, glassMat(), frontX + 1.0, topY + 2.0, PRINTER_Z, 0.2);
  door.castShadow = false;
  printer.add(door);
  ledLine(printer, c.w - 7, 0.4, 0.5, cx, topY + 1.6, PRINTER_Z - 7.4);
  g.add(printer);
  // the two plants and the stack of paper the render puts on the worktop
  g.add(smallPot(cx, topY, c.z + 10, 2.2));
  g.add(smallPot(cx, topY, 178, 2.0));
  g.add(book(cx, topY, c.z + c.d - 12, 9.0, 11.0, "white", 0.08));
  return g;
}

// ---- the room ----------------------------------------------------------------------------------
export function aiStatic(room: RoomDef, _opts: unknown): THREE.Group {
  const g = new THREE.Group();
  g.name = `static:${room.id}`;
  g.add(tiledFloor(TILE_RECT));
  g.add(coolFloor());
  g.add(wallBox(NORTH_WALL.x0, NORTH_WALL.x1, NORTH_WALL.z0, NORTH_WALL.z1, NORTH_WALL.h));
  g.add(wallBox(WEST_WALL.x0, WEST_WALL.x1, WEST_WALL.z0, WEST_WALL.z1, WEST_WALL.h));
  g.add(wallBox(EAST_WALL.x0, EAST_WALL.x1, EAST_WALL.z0, EAST_WALL.z1, EAST_WALL.h));
  g.add(southScreen());
  // skirtings on the three solid faces; the glazed south has its own shoe
  g.add(skirting("x", WEST_X, EAST_X, NORTH_Z + 0.5));
  g.add(skirting("z", NORTH_Z, SOUTH_Z, WEST_X + 0.5));
  g.add(skirting("z", NORTH_Z, SOUTH_Z, EAST_X - 0.5));
  g.add(robotDock());
  g.add(racks());
  g.add(missionWall());
  g.add(westDisplays());
  g.add(counterRun());
  return g;
}

/** exported for the tests: the north run's front plane, which is what the room's north lane is measured
 *  against, and the desk height the room's dressing stands on */
export { AI_DESK_TOP };
