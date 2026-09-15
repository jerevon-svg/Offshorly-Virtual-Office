// vo3d build — GAMING ROOM static geometry, built in WORLD coordinates.
//
// Architecture: tiled floor, four real 12-unit walls (solid north/east, solid-then-glazed west with the
// V1 door opening, glazed south partition over an opaque spandrel), plus the fixed fit-out: the north
// media wall, the NW display cabinet, the dartboard, the west AV cabinet and drinks fridge, the four-
// station desk run, the east nook's table/lamp/poster, and the gamepad rug's glowing print.
//
// Rugs, sofa, beanbags, poufs, gaming chairs and plants are entity-driven — see rooms/gaming.ts.
//
// LIGHTING BUDGET. The room has seventeen lit surfaces and exactly NINE animated ambient channels:
//   1 south cove · 2 desk underglow · 3 the display · 4+5 the two shared monitor wallpapers ·
//   6 one RGB keyboard sweep · 7 controller neon · 8 PlayStation neon · 9 AV rack status blip.
// Everything else — fridge, cabinet shelves, console backlight, poster, nook lamp, rug print, mice —
// is STATIC emissive. That ratio is the difference between a premium games room and a neon arcade, and
// it is deliberate rather than incidental: see the per-source notes below.
import * as THREE from "three";
import { cyl, rbox, shadowed } from "./helpers";
import { cornice, skirting } from "./arch";
import { tagSurface } from "../editor/surfaces";
import { tiledFloor } from "./tile";
import { ledStrip } from "./led";
import { credenzaRun } from "./frontbar";
import { PALETTE, emissiveMat, emissiveMatUnique, glassMat, glowMat, glowMatUnique, mat, metal, uiScreenMat, wood, FLOOR_LAYER, floorLayer } from "../render/Materials";

// ---- ANIMATION TIMING ---------------------------------------------------------------------------
// One table so the room breathes as a composition rather than nine unrelated loops. Periods are spread
// across 4.6-8.4s and share no common factor, so the effects drift in and out of step instead of
// locking into a beat — that is the difference between "powered" and "disco".
const BEAT = { cove: 4.0, deskFlow: 3.6, keySweep: 3.4, monitors: 5.4, tv: 7.6, controller: 3.8, psStep: 4.0, console: 7.8, rug: 8.4 };

/** Make a material read LINEARLY. The renderer runs NeutralToneMapping at exposure 1.12, which rolls the
 *  top end off hard — an emissive already sitting near 1.5 is clipped, so swinging it to 2.5 changes
 *  almost no pixels on screen. That is why the first pass measured as moving but LOOKED stationary: an
 *  animated emitter has to opt out of the roll-off for its brightness change to survive to the display. */
function linear<T extends THREE.Material>(m: T): T {
  m.toneMapped = false;
  return m;
}
/** An emitter whose light also lands on a surface: additive, unlit, driven by ONE emissiveIntensity — so
 *  a bar and the floor pool under it travel AND brighten together on a single ambient channel. */
/** An UNLIT neon tube. `emissiveMatUnique` sets diffuse AND emissive to the same colour, so the scene
 *  lights the tube regardless of its emissive — which is why a glyph swinging 0.1 → 2.9 still never
 *  looked like it switched off. Real neon that is not firing is dark glass, so the diffuse goes dark and
 *  the emissive alone carries the colour. This is what makes the sequence read as ON / OFF. */
function neonTube(m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  linear(m);
  m.color.setHex(0x0b0b12);
  return m;
}
function travellingLight(color: Parameters<typeof emissiveMatUnique>[0]): THREE.MeshStandardMaterial {
  const m = linear(emissiveMatUnique(color, 0, 0.4));
  m.transparent = true;
  m.opacity = 0.55;
  m.depthWrite = false;
  m.blending = THREE.AdditiveBlending;
  return m;
}

import { animated, powered } from "../render/Ambient";
import { monitor, smallPot } from "./props";
import { STRUCT } from "../rooms/reception";
import type { RoomDef } from "../world/WorldState";
import {
  AV_CABINET, DARTBOARD, DESK_RUN, DOOR, EAST_WALL, EAST_X, FRIDGE, MEDIA_CONSOLE, NEON_CONTROLLER,
  NEON_PS, NOOK, NORTH_WALL, NORTH_Z, NW_CABINET, POSTER, RUG, SOUTH_PARTITION, SOUTH_Z, STATIONS, STATION_KIT,
  THEME, TILE_RECT, TV, WEST_GLASS, WEST_WALL, WEST_X,
} from "../rooms/gaming";

/** The highest a wall-mounted glow plane may reach. Light on a wall stops where the wall does: a wash
 *  sized off its fitting alone grows past the head and reads as glow hanging in mid-air over the room. */
const WASH_TOP = STRUCT.wallHeight - 1; // 45

// ---- room-local contrast --------------------------------------------------------------------------
/** THE ENABLER. The office key light is shared and must not change, but this room's cream tile sits at
 *  ~230/255 — every additive spill thrown at it clipped straight to white, which is why the RGB read as
 *  coloured paint rather than light however hard it was driven. One multiply plane over THIS room's tile
 *  drops the floor to a moody ~150 so coloured light finally has somewhere to land. Nothing global, no
 *  new lights, one mesh; it sits under the rugs and every piece of furniture. */
function moodFloor(): THREE.Mesh {
  // FLOOR_LAYER.tint: this plane MULTIPLIES, so it has to land before every additive glow in the room or
  // it wipes them out. Without the explicit order that decision was left to the transparent depth sort,
  // which flipped with camera yaw and took the rug's print and LED border with it.
  const m = floorLayer(new THREE.MeshBasicMaterial({
    color: PALETTE.gamingMood, blending: THREE.MultiplyBlending, premultipliedAlpha: true, transparent: true, depthWrite: false, toneMapped: false,
  }), FLOOR_LAYER.tint);
  const p = rbox(TILE_RECT.w - 0.4, 0.02, TILE_RECT.d - 0.4, m, TILE_RECT.x + TILE_RECT.w / 2, 0.015, TILE_RECT.z + TILE_RECT.d / 2, 0);
  p.castShadow = p.receiveShadow = false;
  return p;
}

// ---- layered light --------------------------------------------------------------------------------
/** A flat additive layer — halo or spill — lying on the floor. */
function glowLayer(w: number, d: number, x: number, z: number, y: number, m: THREE.Material): THREE.Mesh {
  const p = rbox(w, 0.04, d, m, x, y, z, 0);
  p.castShadow = p.receiveShadow = false;
  return p;
}
/** BRIGHT CORE → coloured HALO overhanging it → wide soft SPILL. Three layers, because one additive
 *  plane cannot be both intense at the source and soft at its edge — and it is the overhang that makes
 *  a strip read as emitting light rather than as a painted line. */
function litEdge(axis: "x" | "z", len: number, t: number, x: number, z: number, core: THREE.Material, halo: THREE.Material, spill: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const dim = (across: number): [number, number] => (axis === "x" ? [len, across] : [across, len]);
  const [sw, sd] = dim(t * 13);
  g.add(glowLayer(sw, sd, x, z, 0.50, spill));
  const [hw, hd] = dim(t * 4.6);
  g.add(glowLayer(hw, hd, x, z, 0.62, halo));
  const [cw, cd] = dim(t);
  const c = rbox(cw, 0.14, cd, core, x, 0.74, z, 0.05);
  c.castShadow = c.receiveShadow = false;
  g.add(c);
  return g;
}
/** Additive material for halo / spill layers. Opacities here are LOW by necessity: additive light adds
 *  to all three channels, so anything much above ~0.15 stops tinting the surface and starts pushing it to
 *  white — which is exactly how "intense glow" turns into flat pale rectangles. */
function auraMat(key: Parameters<typeof emissiveMatUnique>[0], opacity: number): THREE.MeshBasicMaterial {
  // one material per call (a halo may be animated), but the FALLOFF is the shared one every other spill in
  // the office uses — a halo with a hard rectangular border is the single thing that makes light read as a
  // sticker, and the room has a lot of halos
  return glowMatUnique(key, opacity);
}

// ---- local shape helpers ------------------------------------------------------------------------
/** A disc standing in the XY plane (its axis along world z) — wall-mounted round things. */
function disc(r: number, t: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, t, 24), m);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, y, z);
  return shadowed(mesh);
}
/** GAMEPAD OUTLINE as a neon tube: one parametric silhouette walked twice, at full size and inset, so the
 *  inner edge follows the outer one and the tube keeps an even weight. A plain rounded rectangle was tried
 *  first and read as a pill from the game camera — the two bottom grip lobes are what actually say
 *  "controller" at 150 screen pixels, so they are part of the outline rather than bolted-on bars. */
function controllerOutline(w: number, h: number, inset: number): THREE.Shape {
  const walk = (s: THREE.Shape | THREE.Path, k: number): void => {
    const X = (w / 2) * k, Y = (h / 2) * k;
    s.moveTo(-X, Y * 0.1);
    s.bezierCurveTo(-X, Y * 0.85, -X * 0.78, Y, -X * 0.5, Y); // left shoulder
    s.quadraticCurveTo(0, Y * 0.74, X * 0.5, Y); //               the dip across the top
    s.bezierCurveTo(X * 0.78, Y, X, Y * 0.85, X, Y * 0.1); //     right shoulder
    s.bezierCurveTo(X, -Y * 0.55, X * 0.94, -Y, X * 0.66, -Y); // right grip
    s.bezierCurveTo(X * 0.42, -Y, X * 0.38, -Y * 0.42, X * 0.18, -Y * 0.3);
    s.quadraticCurveTo(0, -Y * 0.2, -X * 0.18, -Y * 0.3); //      between the grips
    s.bezierCurveTo(-X * 0.38, -Y * 0.42, -X * 0.42, -Y, -X * 0.66, -Y);
    s.bezierCurveTo(-X * 0.94, -Y, -X, -Y * 0.55, -X, Y * 0.1); // left grip
  };
  const outer = new THREE.Shape();
  walk(outer, 1);
  const hole = new THREE.Path();
  walk(hole, 1 - inset);
  outer.holes.push(hole);
  return outer;
}


// ---- architecture -------------------------------------------------------------------------------
function wallBox(x0: number, x1: number, z0: number, z1: number, h: number): THREE.Mesh {
  // ROOM EDITOR: every plaster wall of this room is one addressable surface (editor/surfaces.ts).
  return tagSurface(rbox(x1 - x0, h, z1 - z0, mat("gamingPlaster", 0.96), (x0 + x1) / 2, 0, (z0 + z1) / 2, STRUCT.capRadius), { id: "gaming-room/wall", kind: "wall", roomId: "gaming-room", label: "Gaming Room walls", preset: "plaster", size: { u: Math.max(x1 - x0, z1 - z0), v: h } });
}

/** The west side: solid plaster north of the V1 door band, the artwork's black-framed glazed screen
 *  south of it, and NOTHING AT ALL inside the band itself — 5C hangs the door controller there. */
function westSide(): THREE.Group {
  const g = new THREE.Group();
  g.name = "gaming-west";
  g.add(wallBox(WEST_WALL.x0, WEST_WALL.x1, WEST_WALL.z0, WEST_WALL.z1, WEST_WALL.h));
  // door jambs: reveals INSIDE the wall thickness, flush with the band edges. They face the opening and
  // never enter it, so the 32-unit passage V1 authored stays 32 units wide.
  for (const z of [DOOR.z0, DOOR.z1]) {
    const inward = z === DOOR.z0 ? -0.5 : 0.5;
    g.add(rbox(WEST_X - WEST_WALL.x0, STRUCT.wallHeight * 0.82, 1.0, mat("gamingDark", 0.6), (WEST_WALL.x0 + WEST_X) / 2, 0, z + inward, 0.25));
  }
  // header over the opening, so the doorway reads as an opening rather than a gap in a wall
  g.add(rbox(WEST_X - WEST_WALL.x0, STRUCT.wallHeight * 0.18, DOOR.z1 - DOOR.z0, mat("gamingPlaster", 0.96), (WEST_WALL.x0 + WEST_X) / 2, STRUCT.wallHeight * 0.82, (DOOR.z0 + DOOR.z1) / 2, STRUCT.capRadius));
  // glazed screen south of the door: slim black frame, three bays, fixed panes
  const gl = WEST_GLASS, cx = (gl.x0 + gl.x1) / 2, len = gl.z1 - gl.z0;
  const fr = mat("gamingDark", 0.45);
  g.add(rbox(gl.x1 - gl.x0, 2.2, len, fr, cx, 0, (gl.z0 + gl.z1) / 2, 0.3)); // sill
  g.add(rbox(gl.x1 - gl.x0, 2.2, len, fr, cx, gl.h - 2.2, (gl.z0 + gl.z1) / 2, 0.3)); // head
  // The end posts are inset by half their own thickness so the run's north post stands entirely SOUTH of
  // the V1 door band. Centred on gl.z0 it overlapped the doorway by a unit — a mullion standing in the
  // opening is exactly the kind of thing the door-lane test exists to catch.
  const MULL = 2.0;
  for (let i = 0; i <= gl.bays; i++) {
    const z = gl.z0 + MULL / 2 + ((len - MULL) * i) / gl.bays;
    g.add(rbox(gl.x1 - gl.x0, gl.h - 4.4, MULL, fr, cx, 2.2, z, 0.3)); // mullion
  }
  const pane = rbox(1.0, gl.h - 5.6, len - 2, glassMat(), cx, 2.8, (gl.z0 + gl.z1) / 2, 0.1);
  pane.castShadow = false;
  g.add(pane);
  return g;
}

/** SOUTH PARTITION: opaque spandrel, glazed upper bays, head rail — and the room's signature LED cove
 *  tucked at the spandrel's base on the ROOM side. Glass above eye level keeps the artwork's character;
 *  the spandrel below it means the dead space behind is never on screen. */
function southPartition(): THREE.Group {
  const g = new THREE.Group();
  g.name = "gaming-south-partition";
  const p = SOUTH_PARTITION, cz = (p.z0 + p.z1) / 2, len = p.x1 - p.x0, cx = (p.x0 + p.x1) / 2;
  g.add(rbox(len, p.spandrel, p.z1 - p.z0, mat("gamingPlaster", 0.96), cx, 0, cz, STRUCT.capRadius));
  // SILL, not a capping rail. A dark 13-deep bar here was the single biggest visual fault in the first
  // 5B render: from above it presented a black band the width of the room AND its north lip overhung the
  // cove below it. A slim plaster nosing does the same architectural job and leaves the sill top clear.
  g.add(rbox(len, 0.9, p.z1 - p.z0 + 0.8, mat("gamingPlaster", 0.8), cx, p.spandrel, cz, 0.3));
  const sillTop = p.spandrel + 0.9;
  const glassH = p.h - sillTop - p.head;
  const fr = mat("gamingDark", 0.45);
  for (let i = 0; i <= p.bays; i++) {
    const x = p.x0 + (len * i) / p.bays;
    g.add(rbox(2.2, glassH, p.z1 - p.z0, fr, x, sillTop, cz, 0.3)); // mullion
  }
  const pane = rbox(len - 3, glassH - 1, 1.0, glassMat(), cx, sillTop + 0.5, cz, 0.1);
  pane.castShadow = false;
  g.add(pane);
  g.add(rbox(len, p.head, p.z1 - p.z0 + 0.6, fr, cx, p.h - p.head, cz, 0.35)); // head rail
  // CHANNEL 1 — the room's primary cove, recessed into the capping rail at the top of the spandrel and
  // throwing north over the desks. The artwork paints it at the FLOOR, and the live render is what ruled
  // that out: a base cove sits on the room side of a 25-unit wall, so a camera beyond that wall looking
  // down can never see it — it lit nothing and read as nothing. On the rail it is seen through the glass
  // above it and draws the continuous line across the room's south edge the artwork is actually after.
  // It stands ON the sill, a little in from its north lip, so nothing overhangs it and the ray out to the
  // camera passes through glass the whole way. The height is a narrow window, not a preference: lower and
  // the spandrel clips it, higher and the head rail on the far side of the glass does — test.ts pins both.
  g.add(ledStrip({
    axis: "x", from: p.x0 + 6, to: p.x1 - 6, at: p.z0 + 1.4, y: sillTop, dir: -1,
    color: THEME.ledHue, intensity: 2.3, wash: { reach: 30, opacity: 0.30, y: sillTop + 0.6 },
    // CHANNELS 1 + 2 — the room's slowest, deepest breath, and the floor under it rising and falling a
    // beat behind. 14s was too slow to notice inside a ten-second look; 6.4 reads without hurrying.
    // the emitter is a 2-unit bar, so the WASH carries this one: a wide patch of floor and spandrel
    // swinging 0.05 → 0.44 in opacity is what "the purple light is breathing" actually looks like
    pulse: { period: BEAT.cove, phase: 0, min: 0.30, max: 1.7 },
    washPulse: { period: BEAT.cove, phase: 0.06, min: 0.05, max: 0.44 }, name: "gaming-south-cove", editable: { roomId: "gaming-room", label: "South cove" },
  }));
  return g;
}

// ---- north media wall ---------------------------------------------------------------------------
function drawTvUi(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  // an abstracted open-world frame: sky gradient, a horizon, a hill silhouette and a bright character mark
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#2f6fd0"); sky.addColorStop(0.55, "#79b7ea"); sky.addColorStop(1, "#a8d8b0");
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#3f7a46";
  ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(0, h * 0.66); ctx.lineTo(w * 0.3, h * 0.52); ctx.lineTo(w * 0.62, h * 0.7); ctx.lineTo(w, h * 0.58); ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  for (let i = 0; i < 5; i++) ctx.fillRect(w * (0.08 + i * 0.19), h * (0.12 + (i % 2) * 0.08), w * 0.07, h * 0.05);
  ctx.fillStyle = "#f2f6ff";
  ctx.beginPath(); ctx.arc(w * 0.5, h * 0.6, h * 0.14, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#14213a";
  ctx.beginPath(); ctx.arc(w * 0.47, h * 0.58, h * 0.035, 0, Math.PI * 2); ctx.arc(w * 0.54, h * 0.58, h * 0.035, 0, Math.PI * 2); ctx.fill();
}
function drawStationUi(hue: string, alt: string) {
  return (ctx: CanvasRenderingContext2D, w: number, h: number): void => {
    const g2 = ctx.createLinearGradient(0, 0, w, h);
    g2.addColorStop(0, "#0a0c18"); g2.addColorStop(0.5, hue); g2.addColorStop(1, "#0a0c18");
    ctx.fillStyle = g2; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = alt; ctx.lineWidth = Math.max(1, h * 0.02);
    ctx.beginPath();
    for (let i = 0; i < 4; i++) { ctx.moveTo(0, h * (0.3 + i * 0.14)); ctx.lineTo(w, h * (0.18 + i * 0.16)); }
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.75)"; ctx.fillRect(w * 0.04, h * 0.06, w * 0.16, h * 0.06);
  };
}

/** The media run: walnut console, the banner display above it, the two neon signs flanking it, and the
 *  console's own static backlight. */
function mediaWall(): THREE.Group {
  const g = new THREE.Group();
  g.name = "gaming-media-wall";
  const c = MEDIA_CONSOLE;
  g.add(credenzaRun({ ...c, facing: "south", along: "x", body: THEME.shell, reveal: "charcoal", name: "gaming-media-console" }));
  // kit lined up on the top: two consoles standing on edge, a soundbar, a pair of controllers
  for (const [dx, wd] of [[-56, 7], [-44, 7]] as const) g.add(rbox(wd, 13, 16, mat("gamingDark", 0.4), c.x + c.w / 2 + dx, c.h, c.z + c.d / 2, 0.8));
  g.add(rbox(74, 4.2, 7, mat("gamingDark", 0.5), TV.cx, c.h, c.z + c.d - 6, 0.8)); // soundbar
  for (const dx of [52, 62]) g.add(rbox(7, 2.6, 10, mat("charcoal", 0.5), c.x + c.w / 2 + dx, c.h, c.z + c.d / 2, 1.1));
  // STATIC — the console's under-shelf backlight. A fixture that lights the wall behind the kit; it has
  // no business breathing, so it does not.
  g.add(ledStrip({
    axis: "x", from: c.x + 8, to: c.x + c.w - 8, at: c.z + c.d - 0.9, y: 1.8, dir: 1,
    color: THEME.accent, intensity: 1.9, housing: false, wash: { reach: 22, opacity: 0.22 },
    pulse: { period: BEAT.cove, phase: 0.4, min: 0.45, max: 1.5 },
    washPulse: { period: BEAT.cove, phase: 0.45, min: 0.05, max: 0.4 }, name: "gaming-console-backlight", editable: { roomId: "gaming-room", label: "Console backlight" },
  }));
  // the floor directly in front of the media run picks the backlight up — the single biggest cue that the
  // north wall is powered rather than merely dark-painted
  // Static. Animating this was tried and measured a 1-level swing: additive violet over near-white
  // floor clips instantly, so a wash on CREAM can never carry a visible breath however far it is driven.
  const floorPool = rbox(c.w + 22, 0.04, 56, auraMat(THEME.accent, 0.11), c.x + c.w / 2, 0.09, c.z + c.d + 26, 0);
  floorPool.castShadow = floorPool.receiveShadow = false;
  g.add(powered(floorPool));

  // ---- the banner display -----------------------------------------------------------------------
  // The artwork's screen is 89 wide on a 46-high wall: a cinema-ratio ultrawide. Built 16:9 it would be
  // 50 units tall and stand through the ceiling, so the honest translation is the wide panel.
  const faceZ = NORTH_Z + 0.2;
  const tvG = new THREE.Group();
  tvG.name = "gaming-wall-tv";
  g.add(tvG);
  // DEPTH ORDER MATTERS: the wall face is at faceZ and the room is at LARGER z, so every layer of a
  // wall-mounted object steps SOUTH. The chassis spans faceZ…faceZ+1.8 and the screen sits proud of it.
  tvG.add(rbox(TV.w + 3, TV.h + 3, 1.8, mat("gamingDark", 0.4), TV.cx, TV.y0 - 1.5, faceZ + 0.9, 0.6));
  // CHANNEL 3 — the display. The brightest single surface in the room and the one the sofa looks at.
  const panel = rbox(TV.w, TV.h, 0.4, uiScreenMat("gaming-tv-ui", 320, 72, drawTvUi, 0.95, true), TV.cx, TV.y0, faceZ + 2.0, 0.15);
  tvG.add(animated(panel, { kind: "pulse", period: BEAT.tv, phase: 0.15, min: 0.78, max: 1.18 })); // CHANNEL 9
  const wash = rbox(TV.w + 30, WASH_TOP - 8, 0.06, glowMat("gamingBlue", 0.17), TV.cx, 8, faceZ + 2.3, 0);
  wash.castShadow = wash.receiveShadow = false;
  tvG.add(powered(wash));

  // ---- neon: the controller ----------------------------------------------------------------------
  // Rebuilt in 5C. A bare rounded-rect ring read as an abstract pill, so the sign now carries what makes
  // a gamepad legible at a glance: a bodied outline with grips, a D-pad on the left, a four-button
  // cluster on the right and two small centre controls. Real neon is a GLASS TUBE on a backing board, so
  // that is what it is built as — board first, tube standing proud of it.
  const n = NEON_CONTROLLER, ny = n.y0 + n.h / 2, tubeZ = faceZ + 0.95, detailZ = tubeZ + 1.15;
  g.add(rbox(n.w + 9, n.h + 3, 0.8, mat("gamingDark", 0.7), n.cx, n.y0 - 2, faceZ + 0.4, 0.6)); // board, capped at the wall head
  const tube = neonTube(emissiveMatUnique("neonPink", 2.1, 0.25));
  // SIZED FOR THE GAME CAMERA. The sign is 42 units wide on a wall ~600 units from the camera, so it
  // resolves to roughly 150 screen pixels: anything under ~1.5 units thick simply is not there. The first
  // pass drew a 1.15-radius button cluster and 0.75-thick centre bars and they vanished into the tube,
  // leaving an abstract pill. Everything here is deliberately chunky.
  const bodyW = n.w, bodyH = n.h;
  const shell = new THREE.Mesh(new THREE.ExtrudeGeometry(controllerOutline(bodyW, bodyH, 0.17), { depth: 1.1, bevelEnabled: false, curveSegments: 10 }), tube);
  shell.position.set(n.cx, ny, tubeZ);
  // CHANNEL 7 — the controller sign's single slow breath
  g.add(animated(shadowed(shell, false, false), { kind: "pulse", period: BEAT.controller, phase: 0.28, min: 0.22, max: 2.9 })); // an unmistakable neon breath
  const dx = bodyW * 0.26;
  // left: the D-pad, a bold plus
  const dy = bodyH * 0.13; // sit the controls in the body, above the grip lobes
  // NOTE: rbox()'s y argument is the BASE of the box, not its centre. Centre each arm explicitly or the
  // D-pad builds as a T instead of a plus — which is exactly what the first live render showed.
  const cy = ny + dy;
  g.add(powered(rbox(8.4, 2.0, 1.0, tube, n.cx - dx, cy - 1.0, detailZ, 0.3)));
  g.add(powered(rbox(2.0, 8.4, 1.0, tube, n.cx - dx, cy - 4.2, detailZ, 0.3)));
  // right: four face buttons in a diamond
  for (let i = 0; i < 4; i++) {
    const a2 = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const btn = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.66, 6, 16), tube);
    btn.position.set(n.cx + dx + Math.cos(a2) * 3.4, cy + Math.sin(a2) * 3.4, detailZ);
    g.add(powered(shadowed(btn, false, false)));
  }
  // centre: the two small system controls
  for (const sgn of [-1, 1]) g.add(powered(cyl(1.05, 1.0, tube, n.cx + sgn * 3.2, cy - 0.5, detailZ).rotateX(Math.PI / 2)));
  g.add(powered(rbox(n.w + 18, WASH_TOP - 20, 0.06, glowMat("neonPink", 0.2), n.cx, 20, faceZ + 0.12, 0)));
  // a tight halo that breathes WITH the tube — the tube alone reads as a pink line on a dark board
  const cHalo = rbox(n.w + 6, n.h + 6, 0.06, auraMat("neonPink", 0.15), n.cx, ny - (n.h + 6) / 2, faceZ + 0.62, 0);
  cHalo.castShadow = cHalo.receiveShadow = false;
  g.add(animated(cHalo, { kind: "fade", period: BEAT.controller, phase: 0.3, min: 0.02, max: 0.19 }));

  // ---- neon: the four PlayStation glyphs ---------------------------------------------------------
  // Rebuilt in 5C. The first pass bent bars by hand and the triangle and square came out as a chevron and
  // a bracket. A neon tube bent into a regular polygon is exactly what TorusGeometry with N tubular
  // segments already is, so the glyphs are now genuinely △ ○ ✕ □ and read at game-camera distance.
  const p = NEON_PS, py = p.y0 + p.h / 2, gw = p.w / 4, glyphZ = faceZ + 1.15;
  g.add(rbox(p.w + 7, p.h + 7, 0.8, mat("gamingDark", 0.7), p.cx, p.y0 - 3.5, faceZ + 0.4, 0.6));
  const gx = (i: number): number => p.cx + (i - 1.5) * gw;
  const R = 3.5, T = 0.62;
  /** one neon tube bent into an N-sided ring (N = 3 triangle, 4 square, high = circle) */
  const polyTube = (sides: number, r: number, rotZ: number, m: THREE.Material, x: number): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(r, T, 6, sides), m);
    mesh.position.set(x, py, glyphZ);
    mesh.rotation.z = rotZ;
    return shadowed(mesh, false, false);
  };
  // One channel per glyph, a quarter period apart, so the sign fires △ → ○ → ✕ → □ and repeats. A faint
  // pad travelling behind them was tried first and read as nothing: the SYMBOLS themselves have to go
  // dark and come back, which needs four materials carrying four phases.
  const triMat = neonTube(emissiveMatUnique("neonCyan", 2.0, 0.25));
  const ringMat = neonTube(emissiveMatUnique("neonPink", 2.0, 0.25));
  const xMat = neonTube(emissiveMatUnique("gamingViolet", 2.2, 0.25));
  const sqMat = neonTube(emissiveMatUnique("neonPink", 2.0, 0.25));
  const step = (i: number) => ({ kind: "pulse" as const, period: BEAT.psStep, phase: i * 0.25, min: 0.1, max: 2.9 });
  g.add(animated(polyTube(3, R * 1.2, Math.PI / 2, triMat, gx(0)), step(0))); // △ — 3 segments, apex up
  g.add(animated(polyTube(48, R, 0, ringMat, gx(1)), step(1))); // ○
  for (const sgn of [-1, 1]) { // ✕ — two crossed tubes
    const bar = rbox(R * 2.1, T * 1.85, 0.9, xMat, gx(2), py - T * 0.9, glyphZ, 0.25);
    bar.rotation.z = (sgn * Math.PI) / 4;
    g.add(sgn < 0 ? animated(shadowed(bar, false, false), step(2)) : shadowed(bar, false, false)); // ✕
  }
  g.add(animated(polyTube(4, R * 1.28, Math.PI / 4, sqMat, gx(3)), step(3))); // □ — 4 segments, rotated square
  // each glyph gets a halo pad on the board that fires with it, so the sequence reads as four lamps
  // switching on and off rather than four outlines changing shade
  const haloKeys = ["neonCyan", "neonPink", "gamingViolet", "neonPink"] as const;
  for (let i = 0; i < 4; i++) {
    const pad = rbox(gw * 0.82, 13, 0.06, auraMat(haloKeys[i], 0.2), gx(i), py - 6.5, faceZ + 0.6, 0);
    pad.castShadow = pad.receiveShadow = false;
    g.add(animated(pad, { kind: "fade", period: BEAT.psStep, phase: i * 0.25, min: 0.01, max: 0.26 }));
  }
  g.add(powered(rbox(p.w + 16, WASH_TOP - 21, 0.06, glowMat("gamingViolet", 0.22), p.cx, 21, faceZ + 0.12, 0)));
  return g;
}

/** NW display cabinet: an open case of lit shelves with the artwork's controller collection on them. */
function nwCabinet(): THREE.Group {
  const g = new THREE.Group();
  g.name = "gaming-nw-cabinet";
  const c = NW_CABINET, cx = c.x + c.w / 2, cz = c.z + c.d / 2;
  g.add(rbox(c.w, c.h, c.d, mat("gamingDark", 0.6), cx, 0, cz, 0.6));
  g.add(rbox(c.w - 3, c.h - 3, c.d - 3, mat("charcoal", 0.85), cx, 1.5, cz + 1.6, 0.4)); // recessed interior
  for (let i = 0; i < c.shelves; i++) {
    const y = 4 + ((c.h - 8) * i) / c.shelves;
    g.add(rbox(c.w - 4, 0.9, c.d - 4, mat("gamingDark", 0.5), cx, y, cz + 1.6, 0.2));
    // STATIC shelf lighting: bare tape under each shelf lip. The carcass already is the fixture.
    g.add(ledStrip({ axis: "x", from: c.x + 3, to: c.x + c.w - 3, at: cz + c.d / 2 - 2.4, y: y + 1.0, dir: 1, color: THEME.accentAlt, intensity: 1.45, housing: false, name: `gaming-nw-shelf-${i}`, editable: { roomId: "gaming-room", label: `NW shelf ${i + 1}` } }));
    // controllers on the shelf, as small silhouettes
    for (let k = 0; k < 3; k++) g.add(rbox(9, 2.2, 5.5, mat(k === 1 ? "white" : "charcoal", 0.6), c.x + 9 + k * 16, y + 0.9, cz + 1.2, 1.6));
  }
  return g;
}

/** The dartboard on its reclaimed-wood backing panel, in the room's NE corner. */
function dartboard(): THREE.Group {
  const g = new THREE.Group();
  g.name = "gaming-dartboard";
  const d = DARTBOARD, cy = d.y0 + d.h / 2, z = NORTH_Z + 0.3;
  g.add(rbox(d.w, d.h, 1.6, wood("box"), d.cx, d.y0, z + 0.8, 0.5)); // backing panel
  for (let i = 0; i < 5; i++) g.add(rbox(d.w - 2, 0.4, 0.4, mat("walnutDark", 0.9), d.cx, d.y0 + 3 + i * ((d.h - 6) / 4), z + 1.65, 0.1)); // plank reveals
  const R = Math.min(d.w, d.h) * 0.32;
  g.add(disc(R, 1.2, mat("charcoal", 0.85), d.cx, cy, z + 2.2));
  g.add(disc(R * 0.94, 1.4, mat("cushionCream", 0.85), d.cx, cy, z + 2.4));
  g.add(disc(R * 0.62, 1.5, mat("charcoal", 0.85), d.cx, cy, z + 2.5));
  g.add(disc(R * 0.3, 1.6, mat("neonGreen", 0.7), d.cx, cy, z + 2.6));
  g.add(disc(R * 0.12, 1.7, mat("neonPink", 0.6), d.cx, cy, z + 2.7));
  for (let i = 0; i < 3; i++) { // darts parked in the board
    const a = 0.5 + i * 0.9;
    g.add(cyl(0.35, 5, metal(), d.cx + Math.cos(a) * R * 0.5, cy + Math.sin(a) * R * 0.5 - 2.5, z + 4.5));
  }
  return g;
}

// ---- west wall fittings -------------------------------------------------------------------------
function westFittings(): THREE.Group {
  const g = new THREE.Group();
  g.name = "gaming-west-fittings";
  const a = AV_CABINET;
  g.add(credenzaRun({ ...a, facing: "east", along: "z", body: THEME.shell, reveal: "charcoal", name: "gaming-av-cabinet" }));
  // a shallow equipment rack on top: two boxes and a vent grille
  for (let i = 0; i < 2; i++) g.add(rbox(20, 5.5, 11, mat("gamingDark", 0.4), a.x + a.w / 2 + 1, a.h + i * 6, a.z + 9 + i * 13, 0.5));
  // CHANNEL 9 — the AV rack's status LED. A RARE, short sparkle: exactly what the blip channel exists
  // for, and the only non-periodic light in the room.
  const led = cyl(0.55, 0.4, emissiveMatUnique("neonGreen", 0.5, 0.28), a.x + a.w + 0.3, a.h + 2.4, a.z + 9);
  led.rotation.z = Math.PI / 2;
  g.add(animated(led, { kind: "blip", period: 7.3, phase: 0.11, duty: 0.12, base: 0.3, peak: 2.4 }));
  for (const dz of [4, 6, 8]) g.add(powered(cyl(0.4, 0.3, emissiveMat("gamingBlue", 1.2, 0.3), a.x + a.w + 0.3, a.h + 8.4, a.z + dz).rotateZ(Math.PI / 2)));

  // ---- the lit drinks fridge --------------------------------------------------------------------
  const f = FRIDGE, fcx = f.x + f.w / 2, fcz = f.z + f.d / 2;
  g.add(rbox(f.w, f.h, f.d, mat("gamingDark", 0.55), fcx, 0, fcz, 0.7));
  g.add(rbox(f.w - 4, f.h - 6, f.d - 3, mat("charcoal", 0.9), fcx + 1, 3, fcz, 0.4)); // cabinet void
  // STATIC: the cold interior wash. A fridge light is on or off — animating it would be a lie.
  g.add(powered(rbox(0.8, f.h - 9, f.d - 5, emissiveMat("glass", 1.7, 0.4), f.x + 2.4, 4.5, fcz, 0.2)));
  const coldPool = rbox(26, 0.04, f.d + 12, glowMat("gamingBlue", 0.16), f.x + f.w + 11, 0.09, fcz, 0);
  coldPool.castShadow = coldPool.receiveShadow = false;
  g.add(powered(coldPool));
  for (let sIdx = 0; sIdx < 3; sIdx++) {
    const y = 6 + sIdx * ((f.h - 12) / 2);
    g.add(rbox(f.w - 6, 0.7, f.d - 5, metal(), fcx + 1, y, fcz, 0.2));
    for (let k = 0; k < 4; k++) g.add(cyl(1.5, 4.4, mat(k % 2 ? "neonPink" : "gamingBlue", 0.5), fcx + 1.5, y + 0.7, f.z + 4 + k * 4.6));
  }
  const door = rbox(1.0, f.h - 5, f.d - 2, glassMat(), f.x + f.w - 0.4, 2.5, fcz, 0.15);
  door.castShadow = false;
  g.add(door);
  g.add(rbox(1.0, f.h - 5, 1.4, metal(), f.x + f.w + 0.5, 2.5, f.z + 3, 0.3)); // handle
  return g;
}

// ---- the four-station desk run ------------------------------------------------------------------
function deskRun(): THREE.Group {
  const g = new THREE.Group();
  g.name = "gaming-desk-run";
  const r = DESK_RUN, len = r.x1 - r.x0, depth = r.z1 - r.z0, cz = (r.z0 + r.z1) / 2;
  const top = r.h;
  g.add(rbox(len, 2.6, depth, mat("gamingDark", 0.42), (r.x0 + r.x1) / 2, top - 2.6, cz, 0.6)); // one continuous top
  g.add(rbox(len - 2, 0.5, depth - 2, mat("charcoal", 0.85), (r.x0 + r.x1) / 2, top - 3.1, cz, 0.2)); // shadow reveal
  // reclaimed-wood trestles at the ends and between every pair of stations
  for (const x of [r.x0 + 4, (r.x0 + r.x1) / 2, r.x1 - 4]) {
    g.add(rbox(8, top - 2.6, depth - 4, wood("box"), x, 0, cz, 0.5));
    g.add(rbox(10, 1.2, depth - 2, mat("walnutDark", 0.9), x, 0, cz, 0.3));
  }
  g.add(rbox(len - 4, 7, 1.4, mat("gamingDark", 0.5), (r.x0 + r.x1) / 2, top - 11, r.z1 - 1.2, 0.3)); // modesty/cable panel
  // STATIC — the recessed cable channel along the back of the worktop. Added after the live render: the
  // rear half of a near-black 28-deep desktop is the one surface the camera sees most of and the light
  // reaches least, and across four stations it read as a dead black bar the width of the room. A lit
  // cable trough is what a desk like this actually has, and it breaks the mass with a line instead of
  // brightening the whole top away from the artwork.
  g.add(rbox(len - 10, 0.6, 5.5, mat("charcoal", 0.9), (r.x0 + r.x1) / 2, top - 0.5, 830, 0.2));
  g.add(ledStrip({
    axis: "x", from: r.x0 + 8, to: r.x1 - 8, at: 830.6, y: top - 0.4, dir: -1,
    color: THEME.accentAlt, intensity: 1.5, housing: false, name: "gaming-desk-cable-channel", editable: { roomId: "gaming-room", label: "Desk cable channel" },
  }));

  // CHANNEL 2 — the desk underglow. The fixture is where a real one goes, in a channel under the front
  // lip, and it is genuinely visible from low and rotated angles. From the DEFAULT camera it is not: no
  // camera above a desk sees that desk's underside. So the surface response carries it — the floor pool
  // it throws forward into the open lane between the chairs is what the game camera reads, and it is
  // pitched to actually register on a cream tiled floor instead of vanishing into it.
  g.add(ledStrip({
    axis: "x", from: r.x0 + 6, to: r.x1 - 6, at: r.z0 - 1.0, y: 5.5, dir: -1,
    color: THEME.ledHue, intensity: 0.7, wash: { reach: 38, opacity: 0.07 }, name: "gaming-desk-underglow", editable: { roomId: "gaming-room", label: "Desk underglow" },
  }));
  // CHANNEL 3 — RGB energy FLOWING along the run. The strip itself is now a steady dim base and this is
  // the bright segment travelling over it. Its floor pool is a CHILD of the segment, so the light on the
  // tiles travels with the source for free rather than costing a second channel.
  const flow = new THREE.Group();
  flow.position.set((r.x0 + r.x1) / 2, 0, r.z0 - 1.1);
  // The base strip is now deliberately DIM so this reads as light MOVING, not a lit strip brightening.
  const flowMat = travellingLight(THEME.ledHue);
  const seg = rbox(58, 1.6, 2.0, flowMat, 0, 5.2, 0, 0.4);
  seg.castShadow = false;
  // halo then wide spill, both children of the core so the aura travels AND brightens with the source
  const segHalo = rbox(74, 0.05, 26, auraMat(THEME.ledHue, 0.15), 0, -5.9, -18, 0);
  const segPool = rbox(132, 0.05, 74, auraMat(THEME.ledHue, 0.055), 0, -5.95, -50, 0);
  segHalo.castShadow = segHalo.receiveShadow = false;
  segPool.castShadow = segPool.receiveShadow = false;
  seg.add(powered(segHalo), powered(segPool));
  flow.add(animated(seg, {
    kind: "travel", axis: "x", from: -(len - 56) / 2, to: (len - 56) / 2,
    period: BEAT.deskFlow, phase: 0, fade: { min: 0.10, max: 1.5 },
  }));
  g.add(flow);

  // two SHARED wallpaper materials across the four panels: stations 0+2 take A, 1+3 take B. Only one
  // mesh of each pair is tagged, so four monitors cost two channels instead of four.
  // The sitter faces SOUTH, so every monitor faces NORTH — directly away from the game camera, which
  // looks north from above the south wall. The screens are still built correctly (they read in rotated
  // and low views, and they are what a seated avatar sees), but from the default camera all four are
  // BACKS. So the animated channels go on the thing the camera can actually see: the rear RGB bar that
  // real gaming panels carry. One shared material per pair, so four monitors still cost two channels.
  const uiA = uiScreenMat("gaming-station-a", 256, 96, drawStationUi("#6d43d6", "#b79bff"), 0.9);
  const uiB = uiScreenMat("gaming-station-b", 256, 96, drawStationUi("#2f6fd0", "#8fd0ff"), 0.9);
  const rearA = emissiveMatUnique(THEME.accent, 1.9, 0.3);
  const rearB = emissiveMatUnique(THEME.accentAlt, 1.9, 0.3);
  const kbA = emissiveMatUnique(THEME.accent, 1.5, 0.4);
  const kbB = emissiveMatUnique(THEME.accentAlt, 1.5, 0.4);
  STATIONS.forEach((cx, i) => {
    const ui = i % 2 === 0 ? uiA : uiB;
    const m = monitor(cx, top, STATION_KIT.monitor, 38, 13, { screen: ui, segments: 3, curve: 0.16, slim: true });
    g.add(m);
    // rear RGB on the chassis back. Height matters: any higher and the partition's head rail clips it
    // from the game camera, any lower and the spandrel does.
    const rear = i % 2 === 0 ? rearA : rearB;
    const rearZ = STATION_KIT.monitor + 1.5;
    const bar = rbox(26, 1.8, 0.7, rear, cx, top + 5, rearZ, 0.25);
    bar.castShadow = false;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.0, 0.55, 6, 18), rear);
    ring.position.set(cx, top + 9.6, rearZ + 0.1);
    shadowed(ring, false, false);
    // CHANNELS 4 and 5 — one tag per shared material drives both monitors that use it
    // CHANNELS 7 + 8 — one tag per shared material; antiphase makes the run alternate violet ↔ blue
    if (i === 0 || i === 1) { linear(rear); animated(bar, { kind: "pulse", period: BEAT.monitors, phase: i * 0.5, min: 0.3, max: 1.8 }); }
    else powered(bar);
    powered(ring);
    g.add(bar, ring);
    const rearWash = rbox(42, 20, 0.06, glowMat(i % 2 === 0 ? THEME.accent : THEME.accentAlt, 0.20), cx, top + 1, rearZ + 0.7, 0);
    rearWash.castShadow = rearWash.receiveShadow = false;
    g.add(powered(rearWash));

    // keyboard: dark deck with a per-key RGB bed underneath it
    const kbZ = STATION_KIT.keyboard;
    g.add(rbox(30, 1.4, 9.5, mat("gamingDark", 0.45), cx, top, kbZ, 0.5));
    // a steady backdrop now — shared-material intensity changes were exactly what read as nothing, so
    // all the keyboard motion moved into the travelling sweep below
    const keyBed = rbox(27, 0.5, 7.5, i % 2 === 0 ? kbA : kbB, cx, top + 1.0, kbZ, 0.2);
    keyBed.castShadow = false;
    g.add(powered(keyBed));
    for (let row = 0; row < 4; row++) // key caps sitting on the lit bed
      for (let k = 0; k < 12; k++)
        g.add(rbox(1.7, 0.7, 1.3, mat("charcoal", 0.7), cx - 13 + k * 2.35, top + 1.5, kbZ - 3 + row * 1.9, 0.2));
    // EVERY station gets a sweep, each a quarter-period behind the last, so the RGB visibly runs down
    // the row of four rather than one keyboard twinkling on its own. Bar + desktop glow share a material,
    // so both travel and brighten together on one channel. (5C's single sweep on one station read as
    // nothing from the normal camera — one keyboard in four is not a room-scale effect.)
    const swMat = travellingLight(i % 2 === 0 ? "neonCyan" : THEME.accentAlt);
    const sweep = rbox(4.4, 0.5, 8.4, swMat, 0, top + 1.2, kbZ, 0.22);
    sweep.castShadow = false;
    // a round pool, not a rectangle: a hard-edged additive slab reads as a card lying on the desk
    const sweepGlow = cyl(9, 0.05, auraMat(i % 2 === 0 ? "neonCyan" : THEME.accentAlt, 0.14), 0, -1.32, 0);
    const sweepSpill = cyl(19, 0.05, auraMat(i % 2 === 0 ? "neonCyan" : THEME.accentAlt, 0.05), 0, -1.36, 0);
    sweepGlow.castShadow = sweepGlow.receiveShadow = false;
    sweepSpill.castShadow = sweepSpill.receiveShadow = false;
    sweep.add(powered(sweepGlow), powered(sweepSpill));
    const carrier = new THREE.Group();
    carrier.position.set(cx, 0, 0);
    carrier.add(animated(sweep, { kind: "travel", axis: "x", from: -14, to: 14, period: BEAT.keySweep, phase: i * 0.25, fade: { min: 0.05, max: 1.15 } }));
    g.add(carrier);
    // mouse on its pad, and a headset on a hook stand
    g.add(rbox(15, 0.25, 12, mat("charcoal", 0.95), cx + 17, top, STATION_KIT.mouse, 0.4));
    g.add(cyl(1.9, 2.4, mat("gamingDark", 0.4), cx + 17, top + 0.25, STATION_KIT.mouse, 1.3));
    g.add(cyl(0.5, 0.28, emissiveMat(THEME.accent, 0.9, 0.35), cx + 17, top + 2.6, STATION_KIT.mouse + 0.6));
    const hookX = cx - 18;
    g.add(cyl(0.8, 13, metal(), hookX, top, STATION_KIT.headset));
    g.add(rbox(5.5, 1.1, 1.1, metal(), hookX, top + 13, STATION_KIT.headset, 0.3));
    g.add(cyl(4.6, 3.2, mat("gamingDark", 0.5), hookX, top + 9.4, STATION_KIT.headset, 4.0)); // earcup
    g.add(rbox(1.6, 9, 1.6, mat("gamingDark", 0.5), hookX, top + 9.4, STATION_KIT.headset, 0.5)); // headband
  });
  return g;
}

// ---- east nook + poster ---------------------------------------------------------------------------
function eastNook(): THREE.Group {
  const g = new THREE.Group();
  g.name = "gaming-east-nook";
  const t = NOOK.table;
  g.add(cyl(t.r * 0.42, 1.0, mat("charcoal", 0.7), t.x, 0, t.z));
  g.add(cyl(t.r * 0.2, t.h - 2.6, mat("charcoal", 0.6), t.x, 1.0, t.z));
  g.add(cyl(t.r, 2.2, wood("box"), t.x, t.h - 2.2, t.z));
  g.add(smallPot(t.x - t.r * 0.3, t.h, t.z - t.r * 0.25, 1.6));
  g.add(rbox(8, 2.0, 5, mat("white", 0.55), t.x + t.r * 0.25, t.h, t.z + t.r * 0.3, 1.4)); // a controller left on it

  // the warm floor lamp — the room's ONE warm source, and the only thing balancing 300 units of violet.
  // STATIC: a lamp that breathes reads as a fault, not as ambience.
  const l = NOOK.lamp;
  g.add(cyl(l.shadeR * 0.75, 0.9, mat("gamingDark", 0.6), l.x, 0, l.z));
  g.add(cyl(0.55, l.h - 4, mat("gamingDark", 0.5), l.x, 0.9, l.z));
  g.add(cyl(l.shadeR, 5.2, mat("cushionCream", 0.7), l.x, l.h - 4, l.z, l.shadeR * 0.82));
  g.add(powered(cyl(l.shadeR * 0.82, 0.5, emissiveMat("coveWarm", 2.4, 0.4), l.x, l.h - 4.4, l.z)));
  g.add(powered(cyl(l.shadeR * 1.04, 4.6, emissiveMat("coveWarm", 0.9, 0.6), l.x, l.h - 4, l.z, l.shadeR * 0.86))); // the lit shade itself
  const pool = cyl(l.shadeR * 4.4, 0.04, glowMat("coveWarm", 0.24), l.x, 0.1, l.z);
  pool.castShadow = pool.receiveShadow = false;
  g.add(powered(pool));

  // the neon poster on the east wall's inner face — STATIC, a framed print with a lit face
  const p = POSTER, pcz = (p.z0 + p.z1) / 2, pw = p.z1 - p.z0;
  const px = EAST_X - 0.3;
  g.add(rbox(1.6, p.h + 4, pw + 4, mat("gamingDark", 0.5), px - 0.8, p.y0 - 2, pcz, 0.5));
  const face = rbox(0.4, p.h, pw, uiScreenMat("gaming-poster", 128, 96, drawPoster, 1.25), px - 1.7, p.y0, pcz, 0.15);
  face.castShadow = false;
  g.add(powered(face));
  const pwash = rbox(0.06, WASH_TOP - 2, pw + 24, glowMat("gamingViolet", 0.2), px - 2.1, 2, pcz, 0);
  pwash.castShadow = pwash.receiveShadow = false;
  g.add(powered(pwash));
  // and the floor beside it picks the print up
  const ppool = rbox(26, 0.04, pw + 16, glowMat("gamingViolet", 0.15), px - 14, 0.09, pcz, 0);
  ppool.castShadow = ppool.receiveShadow = false;
  g.add(powered(ppool));
  return g;
}
function drawPoster(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = "#0b0a16"; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#8257ff"; ctx.lineWidth = w * 0.035; ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.arc(w * 0.5, h * 0.42, w * 0.26, Math.PI * 0.15, Math.PI * 1.85);
  ctx.stroke();
  ctx.beginPath(); ctx.moveTo(w * 0.5, h * 0.42); ctx.lineTo(w * 0.5, h * 0.12); ctx.stroke();
  ctx.fillStyle = "#c8b0ff"; ctx.fillRect(w * 0.22, h * 0.78, w * 0.56, h * 0.04);
}

/** The gamepad print on the centre rug: an outline in the room's accent, laid flat on the pile.
 *  Emissive at a THIRD of a real strip's intensity — this is a print catching the LEDs, not a source. */
/** A HERO FLOOR LIGHT: a rug border that behaves like an LED channel let into the floor — a bright core
 *  with a coloured halo overhanging it and a wide spill reaching both inward onto the dark pile and
 *  outward onto the tile — plus a brighter section physically travelling around the perimeter.
 *
 *  Four channels: the core breathes, the halo breathes with it a beat behind, and two travelling
 *  highlights run in opposite directions on the long sides so the border reads as circulating. */
function rugBorder(rect: { x: number; z: number; w: number; d: number }, key: Parameters<typeof emissiveMatUnique>[0], inset: number, period: number, phase: number): THREE.Group {
  const g = new THREE.Group();
  const cx = rect.x + rect.w / 2, cz = rect.z + rect.d / 2;
  const w = rect.w - inset * 2, d = rect.d - inset * 2, t = 3.0;
  const core = linear(emissiveMatUnique(key, 1.4, 0.6));
  const halo = auraMat(key, 0.14);
  const spill = auraMat(key, 0.055);
  g.add(litEdge("x", w, t, cx, cz - d / 2, core, halo, spill));
  g.add(litEdge("x", w, t, cx, cz + d / 2, core, halo, spill));
  g.add(litEdge("z", d, t, cx - w / 2, cz, core, halo, spill));
  g.add(litEdge("z", d, t, cx + w / 2, cz, core, halo, spill));
  // one tag per material breathes every side at once — four bars, one channel
  const anchor = g.children[0].children[2] as THREE.Mesh;
  animated(anchor, { kind: "pulse", period, phase, min: 0.3, max: 2.8 });
  animated(g.children[1].children[0] as THREE.Mesh, { kind: "fade", period, phase: phase + 0.08, min: 0.015, max: 0.095 });
  powered(g.children[1].children[1] as THREE.Mesh);

  // the travelling energy: a brighter section running the long sides in opposite directions, each with
  // its own halo and spill riding along as children of the core so the aura travels WITH the light
  const runLen = w * 0.34;
  for (const dir of [1, -1] as const) {
    const m = travellingLight(key);
    const seg = rbox(runLen, 0.16, t * 1.25, m, 0, 0.78, 0, 0.06);
    seg.castShadow = seg.receiveShadow = false;
    // the aura gets its OWN faint materials: sharing the core's would just draw a bigger core
    const h = glowLayer(runLen * 1.15, t * 6, 0, -0.14, 0, auraMat(key, 0.13));
    const sp = glowLayer(runLen * 1.35, t * 16, 0, -0.28, 0, auraMat(key, 0.05));
    seg.add(powered(h), powered(sp));
    const carrier = new THREE.Group();
    carrier.position.set(cx, 0, cz + (dir > 0 ? -d / 2 : d / 2));
    carrier.add(animated(seg, {
      kind: "travel", axis: "x", from: (dir * -(w - runLen)) / 2, to: (dir * (w - runLen)) / 2,
      // kept inside the room's 3-9s band: a perimeter run slower than that stops reading as travel
      period: period * 1.55, phase: dir > 0 ? 0 : 0.5, fade: { min: 0.06, max: 1.25 },
    }));
    g.add(carrier);
  }
  return g;
}

function rugPrint(): THREE.Group {
  const g = new THREE.Group();
  g.name = "gaming-rug-print";
  const cx = RUG.x + RUG.w / 2, cz = RUG.z + RUG.d / 2;
  const ink = linear(emissiveMatUnique(THEME.accentAlt, 1.05, 0.65));
  // NOTE: every flat outline here is built from BARS and TORI, not slab(ringRect(...)). slab() mirrors
  // on z, which flips the winding of a flat ring's cap — from directly above the only face the camera
  // can see points away and the outline renders as nothing.
  const bar = (w: number, d: number, x: number, z: number, m: THREE.Material, y = 0.74): THREE.Mesh => {
    const mesh = rbox(w, 0.12, d, m, x, y, z, 0.05);
    mesh.castShadow = mesh.receiveShadow = false;
    return mesh;
  };
  const ring = (r: number, t: number, x: number, z: number, m: THREE.Material): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(r, t, 6, 22), m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.78, z);
    mesh.castShadow = mesh.receiveShadow = false;
    return mesh;
  };
  // THE ROOM'S HERO LIGHT: the main rug's purple border, auraed and circulating
  g.add(rugBorder(RUG, THEME.accent, 7, BEAT.cove, 0.1));
  // the gamepad print: body outline, two stick rings, d-pad, four face buttons
  for (const m of [
    bar(130, 3.2, cx, cz - 28, ink), bar(130, 3.2, cx, cz + 28, ink),
    bar(3.2, 52.8, cx - 65, cz, ink), bar(3.2, 52.8, cx + 65, cz, ink),
  ]) g.add(m);
  for (const sgn of [-1, 1]) g.add(ring(8, 1.2, cx + sgn * 18, cz + 12, ink));
  g.add(bar(15, 4.2, cx - 30, cz - 8, ink));
  g.add(bar(4.2, 15, cx - 30, cz - 8, ink));
  for (let i = 0; i < 4; i++) {
    const a2 = (i / 4) * Math.PI * 2;
    g.add(ring(2.7, 0.9, cx + 30 + Math.cos(a2) * 7.5, cz - 8 + Math.sin(a2) * 7.5, ink));
  }
  // the east nook rug gets the same treatment in the alternate hue, slower
  g.add(rugBorder(NOOK.rug, THEME.accentAlt, 6, BEAT.cove * 1.35, 0.55));
  return g;
}

export function gamingStatic(_room: RoomDef): THREE.Group {
  const g = new THREE.Group();
  g.name = "static:gaming-room";
  g.add(tiledFloor(TILE_RECT, undefined, undefined, { roomId: "gaming-room", label: "Gaming Room floor" }));
  g.add(moodFloor()); // room-local contrast, so the RGB below can actually read
  // ---- shell: four real 12-unit walls (see rooms/gaming.ts for why none of them is 54 units deep) ----
  g.add(wallBox(NORTH_WALL.x0, NORTH_WALL.x1, NORTH_WALL.z0, NORTH_WALL.z1, NORTH_WALL.h));
  g.add(wallBox(EAST_WALL.x0, EAST_WALL.x1, EAST_WALL.z0, EAST_WALL.z1, EAST_WALL.h));
  g.add(westSide());
  g.add(southPartition());
  // skirting + cornice along the two solid faces the camera sees most (build/arch.ts profiles: the
  // baseboard gains its floor shadow gap, and the wall finally states a ceiling plane at its top)
  for (const r of [
    { axis: "x" as const, from: NORTH_WALL.x0, to: NORTH_WALL.x1, at: NORTH_Z, dir: 1 as const },
    { axis: "z" as const, from: NORTH_Z, to: SOUTH_Z, at: EAST_X, dir: -1 as const },
  ]) {
    g.add(skirting({ ...r, y0: 0, key: "gamingDark", roughness: 0.6 }));
    g.add(cornice({ ...r, y0: 0, key: "gamingPlaster", wallHeight: STRUCT.wallHeight }));
  }
  // ---- fit-out ----
  g.add(mediaWall());
  g.add(nwCabinet());
  g.add(dartboard());
  g.add(westFittings());
  g.add(deskRun());
  g.add(eastNook());
  g.add(rugPrint());
  return g;
}
