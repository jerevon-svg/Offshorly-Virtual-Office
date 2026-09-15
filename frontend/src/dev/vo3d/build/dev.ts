// vo3d build — DEV ROOM static geometry, built in WORLD coordinates.
//
// Architecture: a near-white tiled floor, three solid 12-unit walls, a glazed SOUTH elevation with the V1
// door band left empty, plus the fixed fit-out — the north run (team bookcase, neon sign, build board over
// its media console, neon cloud, build servers), the west TOOL WALL and its three framed prints, the east
// TEA SHELF and systems schematic, and the south-east PANTRY counter.
//
// Benches, desks, chairs, the sofa, the rug and the plants are entity-driven — see rooms/dev.ts.
//
// LIGHTING BUDGET: ZERO real-time lights, the same budget Gaming, the Central Hub, Executive, CMS and AI
// work to. Every blue line in here is a static emissive surface with an additive halo plane beside it.
import * as THREE from "three";
import type { RoomDef } from "../world/WorldState";
import { Baker, cyl, rbox } from "./helpers";
import { cornice, doorCasing, skirting, type Axis } from "./arch";
import { tagSurface } from "../editor/surfaces";
import { tiledFloor } from "./tile";
import { credenzaRun } from "./frontbar";
import { smallPot } from "./props";
import { DEV_DESK_TOP, bookRow, neonLine, pantryProps, troughPlanting } from "./dev-furniture";
import { STRUCT } from "../rooms/reception";
import { FLOOR_LAYER, PALETTE, emissiveMat, floorLayer, glassMat, mat, metal, plastic, uiScreenMat } from "../render/Materials";
import {
  BOOKCASE, BUILD_BOARD, CUPS_X, DOOR, EAST_WALL, EAST_X, ESPRESSO_X, FRIDGE_X, GLASS_SPANDREL, MEDIA,
  NEON_CLOUD, NEON_SIGN, NORTH_WALL, NORTH_Z, PANEL_D, PANTRY, POSTERS, POSTER_Y, RUN_FRONT, SCHEMATIC,
  SERVERS, SIGN_X, SOUTH_GLASS_E, SOUTH_GLASS_W, SOUTH_Z, TEA_SHELF, THEME, TILE_RECT, TOOL_WALL,
  WEST_WALL, WEST_X,
} from "../rooms/dev";

// ---- shell -------------------------------------------------------------------------------------
const wall = () => mat(THEME.plaster, 0.95);
function wallBox(x0: number, x1: number, z0: number, z1: number, h: number): THREE.Mesh {
  // ROOM EDITOR: every plaster wall of this room is one addressable surface (editor/surfaces.ts).
  return tagSurface(rbox(x1 - x0, h, z1 - z0, wall(), (x0 + x1) / 2, 0, (z0 + z1) / 2, STRUCT.capRadius), { id: "dev-room/wall", kind: "wall", roomId: "dev-room", label: "Dev Room walls", preset: "plaster", size: { u: Math.max(x1 - x0, z1 - z0), v: h } });
}
/** THIS ROOM'S BASEBOARD AND CORNICE, over the shared profiled runs in build/arch.ts.
 *
 *  Both were a single rounded box until the high-detail pass: a skirting with no shadow gap at the floor
 *  and no ceiling moulding at all, which is what made a plaster box read as a plaster box. `dir` is the
 *  ROOM side of the wall face — the same information the old call sites encoded as a ±0.5 nudge on `at`,
 *  now stated rather than implied, because a profile has a front and a back where a box did not. */
function skirt(axis: Axis, from: number, to: number, at: number, dir: 1 | -1): THREE.Mesh {
  return skirting({ axis, from, to, at, y0: 0, dir, key: THEME.walnutDark, roughness: 0.7 });
}
function crown(axis: Axis, from: number, to: number, at: number, dir: 1 | -1): THREE.Mesh {
  return cornice({ axis, from, to, at, y0: 0, dir, key: THEME.plaster, wallHeight: STRUCT.wallHeight });
}

/** ROOM-LOCAL FLOOR TONE. The shared ground-floor tile is a warm cream; the Dev reference floor is a near-
 *  white grid. One multiply plane over THIS room's tile does it — the same device Gaming's moodFloor, CMS's
 *  coolFloor and AI's coolFloor use. FLOOR_LAYER.tint keeps it beneath the additive overlays. */
function paleFloor(): THREE.Mesh {
  const m = floorLayer(new THREE.MeshBasicMaterial({
    color: PALETTE.devFloorTint, blending: THREE.MultiplyBlending, premultipliedAlpha: true, transparent: true, depthWrite: false, toneMapped: false,
  }), FLOOR_LAYER.tint);
  const p = rbox(TILE_RECT.w - 0.4, 0.02, TILE_RECT.d - 0.4, m, TILE_RECT.x + TILE_RECT.w / 2, 0.015, TILE_RECT.z + TILE_RECT.d / 2, 0);
  p.castShadow = p.receiveShadow = false;
  return p;
}

/** THE COVE LINE: the single blue neon run that ties all four elevations together, at the head of the
 *  north run and along both side walls. The room's one continuous graphic. */
function coveLine(g: THREE.Group): void {
  const y = RUN_FRONT - 2;
  neonLine(g, EAST_X - WEST_X - 4, 0.8, 1.0, (WEST_X + EAST_X) / 2, y, NORTH_Z + 1.4, THEME.neon);
  for (const [x, s] of [[WEST_X + 1.4, 1], [EAST_X - 1.4, -1]] as const) {
    void s;
    neonLine(g, 1.0, 0.8, SOUTH_Z - NORTH_Z - 8, x, y, (NORTH_Z + SOUTH_Z) / 2, THEME.neon);
  }
}

/** ONE glazed run of the south elevation: a tall white spandrel washed by a neon line, a fixed pane in a
 *  slim pale frame, mullions at an even pitch and a capping rail. Built along X. */
function southScreen(gl: typeof SOUTH_GLASS_W, name: string, jambSide: -1 | 1): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  // THE PARTITION PLANE, not the wall box — built at STRUCT.wallThickness and centred in the wall's own
  // 12-unit reveal, exactly as CMS's west and AI's south elevations are.
  const T = STRUCT.wallThickness; // 6
  const cz = (gl.z0 + gl.z1) / 2, len = gl.x1 - gl.x0, cx = (gl.x0 + gl.x1) / 2;
  const fr = plastic("white");
  g.add(rbox(len, GLASS_SPANDREL, T, wall(), cx, 0, cz, 0.5)); //                        spandrel
  g.add(rbox(len, 1.6, T * 1.1, metal(), cx, GLASS_SPANDREL - 1.75, cz, 0.3)); //        brushed shoe
  neonLine(g, len - 4, 0.7, 1.0, cx, GLASS_SPANDREL - 3.0, cz - T * 0.6, THEME.neon); // the art's blue line
  const glassH = gl.h - GLASS_SPANDREL;
  const pane = rbox(len - 2, glassH - 1.0, 1.0, glassMat(), cx, GLASS_SPANDREL + 0.5, cz, 0.1);
  pane.castShadow = false;
  g.add(pane);
  const MULL = 2.0;
  for (let i = 0; i <= gl.bays; i++) {
    const x = gl.x0 + MULL / 2 + ((len - MULL) * i) / gl.bays;
    g.add(rbox(MULL, glassH - 0.3, T * 0.85, fr, x, GLASS_SPANDREL, cz, 0.4));
  }
  g.add(rbox(len, 2.2, T * 1.1, metal(), cx, gl.h - 2.2, cz, 0.6)); //                    capping rail
  // the opening's jamb pilaster on the side that faces the door
  g.add(rbox(8, STRUCT.wallHeight, T * 1.15, fr, jambSide < 0 ? gl.x1 + 4 : gl.x0 - 4, 0, cz, STRUCT.capRadius));
  return g;
}

/** The head over the doorway, its architrave and its threshold, so it reads as an opening rather than a
 *  gap between two screens. See build/arch.ts doorCasing for why nothing here enters the reveal. */
function doorHead(): THREE.Group {
  const g = new THREE.Group();
  g.name = "dev-door-head";
  const cz = (SOUTH_GLASS_W.z0 + SOUTH_GLASS_W.z1) / 2;
  g.add(rbox(DOOR.x1 - DOOR.x0, STRUCT.wallHeight - 36, STRUCT.wallThickness, wall(), (DOOR.x0 + DOOR.x1) / 2, 36, cz, STRUCT.capRadius));
  g.add(doorCasing({ axis: "x", at: cz, thickness: STRUCT.wallThickness, from: DOOR.x0, to: DOOR.x1, height: 36, casing: THEME.walnutDark, threshold: "metal", name: "dev-door-casing" }));
  return g;
}

// ---- the north run -----------------------------------------------------------------------------
/** THE TEAM BOOKCASE: a dark walnut carcass of open shelves, spine-out books and a couple of small pots.
 *  The room's "browse the shelf" pick target. */
function bookcase(): THREE.Group {
  const g = new THREE.Group();
  g.name = "dev-bookcase";
  const s = BOOKCASE, cx = s.x + s.w / 2, cz = s.z + s.d / 2, front = s.z + s.d;
  const b = new Baker();
  b.add(rbox(s.w, s.h, s.d, mat(THEME.walnut, 0.72), cx, 0, cz, 0.6));
  for (let i = 0; i <= s.shelves; i++)
    b.add(rbox(s.w - 3, 0.9, s.d - 3, mat(THEME.walnutDark, 0.85), cx, 4 + (i * (s.h - 8)) / s.shelves, cz, 0.2));
  b.bakeInto(g, "dev-bookcase-carcass");
  for (let i = 0; i < s.shelves; i++)
    bookRow(g, s.x + 3, s.x + s.w - 3, 4.9 + (i * (s.h - 8)) / s.shelves, front - 6, 7.5);
  g.add(smallPot(s.x + 8, s.h, front - 7, 2.4));
  g.add(smallPot(s.x + s.w - 9, s.h, front - 7, 2.2));
  neonLine(g, s.w - 3, 0.5, 0.7, cx, s.h + 0.4, front - 1.2, THEME.neon);
  return g;
}

/** THE BUILD SERVERS: a dark rack whose face is a grid of blue status text, with a lit head strip. The
 *  room's "check the build" pick target. */
function servers(): THREE.Group {
  const g = new THREE.Group();
  g.name = "dev-servers";
  const s = SERVERS, cx = s.x + s.w / 2, cz = s.z + s.d / 2, front = s.z + s.d;
  const b = new Baker();
  b.add(rbox(s.w, 3.0, s.d, mat(THEME.inkDeep, 0.9), cx, 0, cz, 0.3)); //     plinth
  const bayW = s.w / s.bays;
  for (let i = 0; i < s.bays; i++) {
    const bx = s.x + bayW * (i + 0.5);
    b.add(rbox(bayW - 1.4, s.h - 3.0, s.d, mat(THEME.ink, 0.62), bx, 3.0, cz, 0.5));
    b.add(rbox(bayW - 4.0, s.h - 9.0, 1.0, mat(THEME.inkDeep, 0.85), bx, 6.0, front - 0.4, 0.2));
  }
  b.bakeInto(g, "dev-server-carcass");
  // the blue status grid: rows of small emissive dashes across both bays, baked as one mesh
  const leds = new Baker();
  for (let i = 0; i < s.bays; i++) {
    const bx = s.x + bayW * (i + 0.5);
    for (let row = 0; row < 10; row++) for (const c of [-1, 0, 1])
      leds.add(rbox(2.6, 0.6, 0.3, emissiveMat(THEME.neon, 1.2, 0.3), bx + c * 4.2, 8.0 + row * 2.6, front - 0.2, 0.1));
  }
  leds.bakeInto(g, "dev-server-leds");
  neonLine(g, s.w - 2, 0.6, 0.8, cx, s.h - 1.4, front - 0.3, THEME.neon);
  return g;
}

// ---- hung panels -------------------------------------------------------------------------------
const PIPELINE = ["checkout", "install", "lint", "unit", "build", "e2e", "deploy"];

/** Every hung graphic in this room is drawn on the same ground with the same ink — one canvas routine,
 *  switched on the panel's kind, so the four elevations read as ONE system rather than four posters. */
function drawPanel(kind: string, lines: readonly string[] = []): (ctx: CanvasRenderingContext2D, w: number, h: number) => void {
  return (ctx, w, h) => {
    const blue = "#2f8cff", ink = "#14161c";
    if (kind === "board") {
      // THE BUILD BOARD: a whiteboard of pipeline columns, each a titled stack of task cards
      ctx.fillStyle = "#f3f4f6";
      ctx.fillRect(0, 0, w, h);
      const cols = PIPELINE.length;
      for (let c = 0; c < cols; c++) {
        const x0 = w * (0.02 + (c * 0.96) / cols);
        ctx.fillStyle = ink;
        ctx.font = `${Math.round(h * 0.09)}px sans-serif`;
        ctx.fillText(PIPELINE[c], x0 + w * 0.008, h * 0.14);
        ctx.strokeStyle = "rgba(47,140,255,0.5)";
        ctx.beginPath(); ctx.moveTo(x0, h * 0.18); ctx.lineTo(x0 + (w * 0.9) / cols, h * 0.18); ctx.stroke();
        for (let r = 0; r < 5; r++) {
          ctx.fillStyle = r % 3 === 0 ? "rgba(47,140,255,0.30)" : "rgba(20,22,28,0.20)";
          ctx.fillRect(x0 + w * 0.008, h * (0.26 + r * 0.14), (w * 0.82 / cols) * (0.5 + ((c * 5 + r * 3) % 9) / 16), h * 0.10);
        }
      }
      return;
    }
    if (kind === "poster") {
      // THE THREE FRAMED PRINTS: white card, black centred type
      ctx.fillStyle = "#fbfbfb";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#1a1b1f"; ctx.lineWidth = Math.max(2, w * 0.02);
      ctx.strokeRect(w * 0.06, h * 0.06, w * 0.88, h * 0.88);
      ctx.fillStyle = ink;
      ctx.textAlign = "center";
      lines.forEach((t, i) => {
        ctx.font = `${t === t.toUpperCase() ? "bold " : ""}${Math.round(h * (t === t.toUpperCase() ? 0.19 : 0.13))}px sans-serif`;
        ctx.fillText(t, w / 2, h * (0.34 + i * 0.22));
      });
      ctx.textAlign = "left";
      return;
    }
    // "schematic": the blue systems diagram down the east wall — a wired node ring over readout bars
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(47,140,255,0.16)";
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += Math.round(w / 24)) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    const cxp = w * 0.5, cyp = h * 0.44, rad = Math.min(w, h) * 0.26;
    ctx.strokeStyle = "rgba(47,140,255,0.5)";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const nx = cxp + Math.cos(a) * rad, ny = cyp + Math.sin(a) * rad;
      ctx.beginPath(); ctx.moveTo(cxp, cyp); ctx.lineTo(nx, ny); ctx.stroke();
      ctx.fillStyle = blue;
      ctx.beginPath(); ctx.arc(nx, ny, Math.min(w, h) * 0.026, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeRect(cxp - rad * 0.40, cyp - rad * 0.28, rad * 0.80, rad * 0.56);
    ctx.fillStyle = "rgba(140,190,245,0.5)";
    for (let i = 0; i < 9; i++) ctx.fillRect(w * 0.10, h * (0.76 + i * 0.023), w * 0.80 * (0.35 + ((i * 5) % 9) / 12), h * 0.012);
  };
}

/** ONE hung display: a dark tray standing PANEL_D proud of the wall face with the drawn graphic on its
 *  front. `plane` says which wall it hangs on. No footprint — it starts 14 above the floor. */
function hungPanel(name: string, kind: string, a0: number, a1: number, y0: number, y1: number, at: number, plane: "north" | "east", lines: readonly string[] = []): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  const len = a1 - a0, hh = y1 - y0, mid = (a0 + a1) / 2, ymid = (y0 + y1) / 2;
  const px = Math.min(1024, Math.max(256, Math.round(len * 8))), py = Math.min(512, Math.max(96, Math.round(hh * 8)));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(len - 2.0, hh - 2.0), uiScreenMat(`dev-${name}`, px, py, drawPanel(kind, lines), kind === "schematic" ? 0.5 : 0.25));
  const tray = plane === "north"
    ? rbox(len, hh, PANEL_D, mat(THEME.inkDeep, 0.55), mid, y0, at, 0.5)
    : rbox(PANEL_D, hh, len, mat(THEME.inkDeep, 0.55), at, y0, mid, 0.5);
  g.add(tray);
  if (plane === "north") {
    face.position.set(mid, ymid, at + PANEL_D / 2 + 0.2);
  } else {
    face.rotation.y = -Math.PI / 2;
    face.position.set(at - PANEL_D / 2 - 0.2, ymid, mid);
  }
  face.castShadow = face.receiveShadow = false;
  g.add(face);
  return g;
}

/** A neon TUBE sign: emissive strokes on the wall face, no panel behind them. The room has two — the
 *  CODE / BUILD / TEST / REPEAT stack west of the board and the cloud glyph east of it. */
function neonStack(name: string, x0: number, x1: number, y0: number, y1: number, rows: number): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  const step = (y1 - y0) / rows;
  for (let i = 0; i < rows; i++) {
    const len = (x1 - x0) * (0.55 + ((i * 3) % 4) / 9);
    neonLine(g, len, 1.0, 0.7, (x0 + x1) / 2, y1 - step * (i + 0.6), NORTH_Z + 1.3, THEME.neon);
  }
  return g;
}

/** The neon cloud glyph: a tube outline, built as four arcs of small emissive boxes. */
function neonCloud(): THREE.Group {
  const g = new THREE.Group();
  g.name = "dev-neon-cloud";
  const c = NEON_CLOUD;
  for (const [ox, orr] of [[-c.w * 0.28, c.h * 0.38], [0, c.h * 0.52], [c.w * 0.30, c.h * 0.36]] as const) {
    for (let i = 0; i < 14; i++) {
      const a = Math.PI * (0.05 + (i / 13) * 0.9);
      const seg = rbox(1.5, 1.0, 0.7, emissiveMat(THEME.neon, 1.6, 0.3),
        c.x + ox + Math.cos(a) * orr * 1.5, c.y + Math.sin(a) * orr, NORTH_Z + 1.3, 0.3);
      seg.castShadow = seg.receiveShadow = false;
      g.add(seg);
    }
  }
  neonLine(g, c.w * 1.25, 0.9, 0.7, c.x, c.y - c.h * 0.05, NORTH_Z + 1.3, THEME.neon);
  return g;
}

/** THE BUILD BOARD and the low media console it hangs over — the room's "read the build board" target. */
function buildBoard(): THREE.Group {
  const g = new THREE.Group();
  g.name = "dev-build-board";
  const m = MEDIA;
  g.add(credenzaRun({ ...m, facing: "south", along: "x", body: THEME.walnut, reveal: THEME.walnutDark, name: "dev-media-run" }));
  neonLine(g, m.w - 6, 0.6, 0.8, m.x + m.w / 2, m.h - 3.4, m.z + m.d - 0.4, THEME.neon);
  g.add(hungPanel("build-board", "board", BUILD_BOARD.x0, BUILD_BOARD.x1, BUILD_BOARD.y0, BUILD_BOARD.y1, NORTH_Z + 2.0, "north"));
  // the router stack and the pair of small pots the render stands on the console
  const b = new Baker();
  b.add(rbox(16, 3.2, m.d - 8, mat(THEME.ink, 0.6), m.x + 18, m.h, m.z + m.d / 2, 0.5));
  b.add(rbox(12, 2.0, m.d - 10, mat(THEME.ink, 0.6), m.x + m.w - 20, m.h, m.z + m.d / 2, 0.4));
  b.bakeInto(g, "dev-media-kit");
  g.add(smallPot(m.x + m.w / 2, m.h, m.z + m.d - 5, 2.4));
  return g;
}

// ---- the two wall units ------------------------------------------------------------------------
/** THE WEST TOOL WALL: a walnut board of cable loops, adaptors and dev hardware under a neon "</>" glyph,
 *  with the three framed prints hung below it on the same wall. Two pick targets in one elevation. */
function toolWall(): THREE.Group {
  const g = new THREE.Group();
  g.name = "dev-tool-wall";
  const s = TOOL_WALL, cz = s.z + s.d / 2, front = s.x + s.w;
  const b = new Baker();
  b.add(rbox(s.w, s.h, s.d, mat(THEME.walnut, 0.72), s.x + s.w / 2, 0, cz, 0.6));
  b.add(rbox(s.w - 2, s.h - 6, s.d - 6, mat(THEME.walnutDark, 0.85), s.x + s.w / 2, 3, cz, 0.4));
  b.bakeInto(g, "dev-tool-carcass");
  // the hanging hardware: loops of cable and small dark blocks over the whole board
  const kit = new Baker();
  for (let i = 0; i < 9; i++) {
    const z = s.z + 6 + (i * (s.d - 12)) / 8;
    const ring = cyl(3.0, 0.8, mat(THEME.inkDeep, 0.85), front - 0.9, 8 + (i % 3) * 10, z, 3.0);
    ring.rotation.z = Math.PI / 2;
    kit.add(ring);
    kit.add(rbox(1.0, 3.4, 5.0, mat(THEME.ink, 0.6), front - 0.8, 22 + (i % 2) * 9, z, 0.3));
  }
  kit.bakeInto(g, "dev-tool-kit");
  neonLine(g, 0.8, 4.0, 10.0, front - 0.5, s.h - 8, s.z + 9, THEME.neon); // the "</>" glyph, abstracted
  neonLine(g, 0.8, 0.6, s.d - 4, front - 0.5, s.h + 0.6, cz, THEME.neon);
  for (const p of POSTERS)
    g.add(hungPanel(p.id, "poster", p.z0, p.z1, POSTER_Y.y0, POSTER_Y.y1, WEST_X + PANEL_D, "east", p.lines));
  return g;
}

/** THE EAST TEA SHELF: a walnut unit with plants on top, the neon EAT / SLEEP / CODE / REPEAT sign on its
 *  face and mugs on its lower shelves — plus the big blue systems schematic hung below it. */
function teaShelf(): THREE.Group {
  const g = new THREE.Group();
  g.name = "dev-tea-point";
  const s = TEA_SHELF, cz = s.z + s.d / 2, front = s.x;
  const b = new Baker();
  b.add(rbox(s.w, s.h, s.d, mat(THEME.walnut, 0.72), s.x + s.w / 2, 0, cz, 0.6));
  for (const y of [12, 26]) b.add(rbox(s.w - 2, 0.9, s.d - 4, mat(THEME.walnutDark, 0.85), s.x + s.w / 2, y, cz, 0.2));
  b.add(rbox(s.w - 2, 14, s.d * 0.42, mat(THEME.inkDeep, 0.6), s.x + s.w / 2, 27, s.z + s.d * 0.30, 0.4)); // the sign field
  b.bakeInto(g, "dev-tea-carcass");
  for (let i = 0; i < 4; i++)
    neonLine(g, 0.8, 0.9, 9.0, front + 0.6, 30 + i * 2.6, s.z + s.d * 0.30, THEME.neon);
  for (let i = 0; i < 5; i++) g.add(smallPot(s.x + s.w / 2, 12.9, s.z + s.d * 0.62 + i * 5.2, 1.8));
  g.add(smallPot(s.x + s.w / 2, s.h, s.z + 10, 2.6));
  g.add(smallPot(s.x + s.w / 2, s.h, s.z + s.d - 11, 2.4));
  neonLine(g, 0.8, 0.6, s.d - 4, front + 0.5, s.h + 0.6, cz, THEME.neon);
  return g;
}

/** The systems schematic on the east wall below the tea shelf — its own group, because it is the room's
 *  "study the schematic" pick target and the shelf is a different one. */
function schematic(): THREE.Group {
  const g = new THREE.Group();
  g.name = "dev-schematic";
  g.add(hungPanel("schematic-panel", "schematic", SCHEMATIC.z0, SCHEMATIC.z1, SCHEMATIC.y0, SCHEMATIC.y1, EAST_X - PANEL_D, "east"));
  // the hung panel builder draws east-plane trays at `at`, facing WEST into the room
  g.children.forEach((c) => { c.position.x += 0; });
  return g;
}

// ---- the pantry --------------------------------------------------------------------------------
/** THE PANTRY BAR: the walnut run along the south-east wall with the espresso machine, the cup shelf, the
 *  green ">_ git push" sign and the glass-fronted drinks fridge. The room's "grab a snack" target. */
function pantry(): THREE.Group {
  const g = new THREE.Group();
  g.name = "dev-pantry";
  const c = PANTRY, cz = c.z + c.d / 2, frontZ = c.z;
  g.add(credenzaRun({ ...c, facing: "north", along: "x", body: THEME.walnut, reveal: THEME.walnutDark, name: "dev-pantry-run", top: false }));
  g.add(rbox(c.w + 1.4, 1.6, c.d + 1.4, mat(THEME.walnut, 0.42), c.x + c.w / 2, c.h - 1.6, cz, 0.4)); // worktop
  neonLine(g, c.w - 6, 0.6, 1.0, c.x + c.w / 2, c.h - 4.2, frontZ + 0.3, THEME.neon);
  const topY = c.h;
  // ESPRESSO MACHINE: a dark block with a lit panel and a portafilter arm
  const m = new Baker();
  m.add(rbox(17, 13.0, c.d - 8, mat(THEME.ink, 0.5), ESPRESSO_X, topY, cz, 0.7));
  m.add(rbox(12, 1.0, c.d - 12, metal(), ESPRESSO_X, topY + 0.4, cz - 0.6, 0.2));
  m.add(cyl(1.0, 4.0, metal(), ESPRESSO_X, topY + 3.0, frontZ + 4.0));
  m.bakeInto(g, "dev-espresso");
  const panel = rbox(5.0, 3.0, 0.6, emissiveMat(THEME.screen, 0.8, 0.3), ESPRESSO_X, topY + 7.0, frontZ + 1.2, 0.2);
  panel.castShadow = false;
  g.add(panel);
  pantryProps(g, CUPS_X, topY, cz);
  // THE ">_ git push" SIGN: a dark plate with a green terminal line on it
  const sign = rbox(22, 8.0, 1.6, mat(THEME.inkDeep, 0.4), SIGN_X, topY + 2.0, frontZ + 1.4, 0.6);
  g.add(sign);
  const glyph = rbox(15, 1.2, 0.5, emissiveMat("devTerminal", 1.4, 0.3), SIGN_X, topY + 5.6, frontZ + 0.6, 0.2);
  glyph.castShadow = false;
  g.add(glyph);
  // THE FRIDGE: a glass-fronted under-counter unit with lit shelves of cans
  const fridge = new Baker();
  fridge.add(rbox(18, 15.0, c.d - 6, mat(THEME.ink, 0.5), FRIDGE_X, topY, cz, 0.6));
  fridge.bakeInto(g, "dev-fridge-body");
  const door = rbox(14, 11.0, 0.8, glassMat(), FRIDGE_X, topY + 2.0, frontZ + 0.8, 0.2);
  door.castShadow = false;
  g.add(door);
  const cans = new Baker();
  for (let r = 0; r < 3; r++) for (let i = 0; i < 4; i++)
    cans.add(cyl(1.2, 3.0, mat(r % 2 ? THEME.neonDeep : THEME.frame, 0.5), FRIDGE_X - 6 + i * 4, topY + 2.4 + r * 3.6, cz, 1.2));
  cans.bakeInto(g, "dev-fridge-cans");
  // the small ledge planter the art runs along the counter's lower shelf
  troughPlanting(g, c.x + 4, c.x + 34, 8.0, cz, 4.0);
  return g;
}

// ---- the room ----------------------------------------------------------------------------------
export function devStatic(room: RoomDef, _opts: unknown): THREE.Group {
  const g = new THREE.Group();
  g.name = `static:${room.id}`;
  g.add(tiledFloor(TILE_RECT, undefined, undefined, { roomId: "dev-room", label: "Dev Room floor" }));
  g.add(paleFloor());
  g.add(wallBox(NORTH_WALL.x0, NORTH_WALL.x1, NORTH_WALL.z0, NORTH_WALL.z1, NORTH_WALL.h));
  g.add(wallBox(WEST_WALL.x0, WEST_WALL.x1, WEST_WALL.z0, WEST_WALL.z1, WEST_WALL.h));
  g.add(wallBox(EAST_WALL.x0, EAST_WALL.x1, EAST_WALL.z0, EAST_WALL.z1, EAST_WALL.h));
  g.add(southScreen(SOUTH_GLASS_W, "dev-south-glass-west", 1));
  g.add(southScreen(SOUTH_GLASS_E, "dev-south-glass-east", -1));
  g.add(doorHead());
  // skirtings on the three solid faces; the glazed south has its own shoe
  g.add(skirt("x", WEST_X, EAST_X, NORTH_Z, 1), crown("x", WEST_X, EAST_X, NORTH_Z, 1));
  g.add(skirt("z", NORTH_Z, SOUTH_Z, WEST_X, 1), crown("z", NORTH_Z, SOUTH_Z, WEST_X, 1));
  g.add(skirt("z", NORTH_Z, SOUTH_Z, EAST_X, -1), crown("z", NORTH_Z, SOUTH_Z, EAST_X, -1));
  coveLine(g);
  g.add(bookcase());
  g.add(neonStack("dev-neon-sign", NEON_SIGN.x0, NEON_SIGN.x1, NEON_SIGN.y0, NEON_SIGN.y1, 4));
  g.add(buildBoard());
  g.add(neonCloud());
  g.add(servers());
  g.add(toolWall());
  g.add(teaShelf());
  g.add(schematic());
  g.add(pantry());
  return g;
}

/** exported for the tests: the north run's front plane is what the room's north lane is measured against,
 *  and the desk height the room's dressing stands on */
export { DEV_DESK_TOP };
