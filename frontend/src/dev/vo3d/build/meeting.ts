// vo3d build — MEETING ROOM static geometry, built in WORLD coordinates.
//
// Architecture: tiled floor, the north cove wall, the west wall + its walnut unit, the shared south
// façade section with the artwork's (sealed) glass doors, and the exterior ledge planters.
// Fixed installations: the east self-service kiosk + its slatted plant wall, the west credenza run and
// its two screens, and the conference table's desk props.
// Furniture (table, chairs, plants) is entity-driven — see rooms/meeting.ts meetingRoomEntities.
//
// Builds NO east boundary of any kind: the artwork has none and the floor runs straight into Reception.
import * as THREE from "three";
import { cyl, rbox } from "./helpers";
import { tiledFloor } from "./tile";
import { emissiveMatUnique, mat, plastic, uiScreenMat } from "../render/Materials";
import { monitor, smallPot } from "./props";
import { animated } from "../render/Ambient";
import { coveWall, credenzaRun, facadeSection, ledgePlanter, slatPanel } from "./frontbar";
import { cornice, runSegments, skirting } from "./arch";
import { kioskTotem } from "./reception";
import { FACADE, STRUCT } from "../rooms/reception";
import { FACADE_Z } from "../adapters/v1Floor";
import type { RoomDef } from "../world/WorldState";
import {
  CHAIR_ROWS, CHAIR_XS, EAST_EDGE, FACADE_DOOR, KIOSK, KIOSK_BASE, KIOSK_SLATS, LEDGE_PLANTERS, NORTH_WALL, NW_SLATS,
  KIOSK_SCANNER_ID, RECT, TABLE, TILE_RECT, WEST_BACKBOARD, WEST_CREDENZA, WEST_FRAME, WEST_POSTER, WEST_TABLET, WEST_WALL,
} from "../rooms/meeting";

/** The desk props the artwork lines up on the conference table: six monitors back to back down the spine
 *  (three serving each row of chairs), a keyboard and mouse at every place, a conference puck in the
 *  middle and three succulents. `monitor()` faces its own −z, so the south row's screens are turned. */
function tableProps(): THREE.Group {
  const g = new THREE.Group();
  g.name = "meeting-table-props";
  const top = 24;
  const spine = TABLE.z + TABLE.d / 2;
  for (const [i, x] of CHAIR_XS.entries()) {
    for (const row of CHAIR_ROWS) {
      const north = row.facing === "south"; // a chair looking south sits on the NORTH side
      const screen = new THREE.Group();
      screen.add(monitor(0, 0, 0, 15, 8.5));
      screen.position.set(x, top, spine + (north ? -3.5 : 3.5));
      if (!north) screen.rotation.y = Math.PI;
      g.add(screen);
      const kz = north ? TABLE.z + 8 : TABLE.z + TABLE.d - 8;
      g.add(rbox(15, 0.7, 5, plastic("white"), x, top, kz, 0.3)); // keyboard
      g.add(cyl(1.5, 1.1, plastic("white"), x + 11, top, kz, 1.1)); // mouse
    }
    if (i !== 1) g.add(smallPot(x, top, spine + (i === 0 ? -0.5 : 0.5), 1.6));
  }
  // the conference puck at the centre of the table, with a slow status breath
  g.add(cyl(3.2, 1.4, mat("charcoal", 0.5), TABLE.x + TABLE.w / 2, top, spine));
  g.add(animated(cyl(2.1, 0.25, emissiveMatUnique("cyan", 0.9, 0.3), TABLE.x + TABLE.w / 2, top + 1.4, spine), {
    kind: "pulse", period: 5.2, phase: 0.2, min: 0.55, max: 1.0,
  }));
  return g;
}

/** WALL-MOUNTED DISPLAY TILT.
 *  The production artwork is a flat render whose camera sees the west wall's east face straight on. The
 *  GAME camera (pitch 52, yaw 0) sits due south, so a panel whose normal is +x/−x is exactly edge-on and
 *  disappears entirely. Real wall displays and framed panels hang on tilting brackets, so tipping the face
 *  up by ~28° is the physically honest translation of the render's baked viewpoint — the panel keeps its
 *  measured position, size and mount, and becomes readable at the angle the game actually uses. */
const TILT = 0.5;

type PanelSpec = { x: number; z: number; y0: number; y1: number; w: number; tilt: number; face?: "boardBg" | "uiNavy"; ui?: { id: string; cw: number; ch: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void } };
/** A panel mounted on an east-facing wall surface, tipped `tilt` radians so its face catches the camera.
 *  Local origin sits at the mount point; the bezel and face are built around it and the whole group turns. */
function tiltedPanel(spec: PanelSpec): THREE.Group {
  const g = new THREE.Group();
  const h = spec.y1 - spec.y0;
  g.position.set(spec.x, (spec.y0 + spec.y1) / 2, spec.z);
  g.rotation.z = spec.tilt; // +x normal rotates toward +y: the face tips up, out of edge-on
  g.add(rbox(1.4, h, spec.w, mat("charcoal", 0.45), 0, -h / 2, 0, 0.5));
  const fw = spec.w - 3, fh = h - 3;
  const m = spec.ui ? uiScreenMat(spec.ui.id, spec.ui.cw, spec.ui.ch, spec.ui.draw, 0.95, true) : mat(spec.face ?? "boardBg", 0.85);
  const face = rbox(0.3, fh, fw, m, 0.9, -fh / 2, 0, 0.12);
  g.add(spec.ui ? animated(face, { kind: "pulse", period: 8.3, phase: 0.45, min: 0.9, max: 1.08 }) : face);
  return g;
}

/** The tall walnut unit against the west wall: a backboard carrying the framed poster and the wall tablet,
 *  the credenza in front of it, a white ceramic vase on top, and the framed artwork hanging on the bare
 *  wall north of it. Everything faces EAST, into the room. */
function westWallUnit(): THREE.Group {
  const g = new THREE.Group();
  g.name = "meeting-west-unit";
  const b = WEST_BACKBOARD;
  g.add(rbox(b.w, b.h, b.d, mat("walnut", 0.8), b.x + b.w / 2, 0, b.z + b.d / 2, 0.4));
  g.add(credenzaRun({ ...WEST_CREDENZA, facing: "east", along: "z", name: "meeting-credenza" }));
  const faceX = b.x + b.w + 0.2;
  g.add(tiltedPanel({ x: faceX, z: (WEST_POSTER.z0 + WEST_POSTER.z1) / 2, y0: WEST_POSTER.y0, y1: WEST_POSTER.y1, w: WEST_POSTER.z1 - WEST_POSTER.z0, tilt: 0.3, face: "boardBg" }));
  // the wall tablet: a dark bezel around a powered panel that breathes very slightly
  const t = WEST_TABLET;
  const tablet = tiltedPanel({ x: faceX, z: (t.z0 + t.z1) / 2, y0: t.y0, y1: t.y1, w: t.z1 - t.z0, tilt: TILT, ui: { id: "meeting-tablet-ui", cw: 112, ch: 160, draw: drawTabletUi } });
  g.add(tablet);
  // the framed artwork on the bare west wall, north of the unit
  const f = WEST_FRAME;
  g.add(tiltedPanel({ x: WEST_WALL.x1 + 0.2, z: (f.z0 + f.z1) / 2, y0: f.y0, y1: f.y1, w: f.z1 - f.z0, tilt: 0.26, face: "uiNavy" }));
  // the white patterned vase the source stands on the credenza top
  g.add(cyl(4.4, 8, plastic("white"), WEST_CREDENZA.x + WEST_CREDENZA.w / 2, WEST_CREDENZA.h, 1094, 3.4));
  return g;
}
function drawTabletUi(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const grd = ctx.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, "#1d3a6b"); grd.addColorStop(1, "#12244a");
  ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#6fcf5a"; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.arc(w * 0.5, h * 0.26, 15, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.fillRect(w * 0.2, h * 0.46, w * 0.6, 7);
  ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.fillRect(w * 0.28, h * 0.54, w * 0.44, 4);
  ctx.fillStyle = "#3f8fe0"; ctx.fillRect(w * 0.16, h * 0.66, w * 0.68, h * 0.12);
  ctx.fillStyle = "rgba(255,255,255,0.16)"; ctx.fillRect(w * 0.16, h * 0.82, w * 0.68, h * 0.1);
}

/** The east self-service terminal: the same totem builder Reception uses, over its own cream base cabinet,
 *  with the artwork's slatted plant wall standing to its west. */
function kioskAssembly(): THREE.Group {
  const g = new THREE.Group();
  g.name = "meeting-kiosk-assembly";
  const b = KIOSK_BASE;
  g.add(rbox(b.w, b.h, b.d, mat("cushionCream", 0.85), b.x + b.w / 2, 0, b.z + b.d / 2, 0.8));
  g.add(rbox(b.w - 3, 1.0, b.d - 3, plastic("white"), b.x + b.w / 2, b.h, b.z + b.d / 2, 0.4)); // top
  // the printed notice the source mounts on the base's face
  g.add(rbox(b.w - 12, 0.4, 14, plastic("white"), b.x + b.w / 2, b.h * 0.55, b.z + b.d - 0.4, 0.2));
  g.add(kioskTotem(KIOSK, { name: "meeting-kiosk", uiId: "meeting-kiosk-ui", draw: drawTerminalUi, scanner: KIOSK_SCANNER_ID }));
  g.add(slatPanel({ axis: "z", at: KIOSK_SLATS.at, dir: -1, from: KIOSK_SLATS.from, to: KIOSK_SLATS.to, y0: KIOSK_SLATS.y0, y1: KIOSK_SLATS.y1, pitch: 6, name: "meeting-kiosk-slats" }));
  // the dark device strip the artwork runs down the slat wall
  g.add(rbox(3.2, 22, 9, mat("charcoal", 0.6), KIOSK_SLATS.at - 4.4, 12, 1028, 0.6));
  return g;
}
function drawTerminalUi(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = "#1668c8"; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.fillRect(w * 0.1, h * 0.08, w * 0.8, 6);
  // the two large action tiles the source paints ("P" glyphs abstracted to blocks)
  for (const [i, y] of [h * 0.2, h * 0.2].entries()) {
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillRect(w * (0.16 + i * 0.4), y, w * 0.22, h * 0.16);
    ctx.fillStyle = "#1668c8";
    ctx.fillRect(w * (0.2 + i * 0.4), y + h * 0.04, w * 0.09, h * 0.08);
  }
  ctx.fillStyle = "rgba(255,255,255,0.28)"; ctx.fillRect(w * 0.1, h * 0.46, w * 0.8, h * 0.3);
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  for (let i = 0; i < 4; i++) ctx.fillRect(w * 0.16, h * (0.5 + i * 0.06), w * (0.5 - i * 0.06), 3);
  ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.fillRect(w * 0.1, h * 0.82, w * 0.8, 5);
}

export function meetingStatic(_room: RoomDef): THREE.Group {
  const g = new THREE.Group();
  g.name = "static:meeting-room";
  g.add(tiledFloor(TILE_RECT, undefined, undefined, { roomId: "meeting-room", label: "Meeting Room floor" }));

  // ---- north: the cream cove wall that closes the bar's west end ------------------------------------
  g.add(coveWall({ ...NORTH_WALL, phase: 0.0, name: "meeting-cove-wall" }));
  g.add(slatPanel({ axis: "x", at: NORTH_WALL.z1, dir: 1, from: NW_SLATS.from, to: NW_SLATS.to, y0: NW_SLATS.y0, y1: NW_SLATS.y1, name: "meeting-nw-slats" }));

  // ---- west: solid wall + skirting; the unit in front of it is a fixed installation ------------------
  const w = WEST_WALL;
  g.add(rbox(w.x1 - w.x0, w.h, w.z1 - w.z0, mat("plaster", 0.96), (w.x0 + w.x1) / 2, 0, (w.z0 + w.z1) / 2, STRUCT.capRadius));
  // THE WEST ELEVATION'S FINISHING. It carried a single 0.9 x 1.6 box for a skirting — a painted stripe
  // with no undercut — and nothing at all at the top, so the only full-height plaster wall in the room
  // simply stopped. Both are now the shared profiles (build/arch.ts): a baseboard with a real shadow gap,
  // and a cornice that states the ceiling plane the camera looks in over. The north wall keeps the
  // skirting coveWall() already builds for it.
  g.add(skirting({ axis: "z", from: w.z0, to: w.z1, at: w.x1, y0: 0, dir: 1, key: "white", roughness: 0.6 }));
  // THE CORNICE ROUTES AROUND WHAT IS ALREADY ON THIS WALL. It hangs from 39 to 46 and stands 2.4 proud,
  // and this elevation carries the framed artwork (to y 44) and the 44-tall walnut backboard — an
  // unbroken run is drawn straight through both. It therefore terminates either side of them, which is
  // what a ceiling trim does when it meets a mounted panel. build/arch.runSegments.
  for (const seg of runSegments(w.z0, w.z1, [
    { from: WEST_FRAME.z0, to: WEST_FRAME.z1 },
    { from: WEST_BACKBOARD.z, to: WEST_BACKBOARD.z + WEST_BACKBOARD.d },
  ]))
    g.add(cornice({ axis: "z", from: seg.from, to: seg.to, at: w.x1, y0: 0, dir: 1, key: "plaster", wallHeight: w.h }));
  g.add(westWallUnit());

  // ---- east: NOTHING. The floor runs into Reception; the kiosk is furniture, not a boundary ----------
  g.add(kioskAssembly());

  // ---- south: this room's share of the SHARED street façade ------------------------------------------
  // `endPosts.end = false` hands the seam mullion to Reception's run, which already builds a post 0.9 east
  // of the shared edge — without this the bar would show a doubled post at x 332.33.
  g.add(facadeSection({
    x0: RECT.x, x1: EAST_EDGE, facadeZ: FACADE_Z, t: STRUCT.wallThickness, h: STRUCT.wallHeight,
    panelPitch: FACADE.panelPitch, pilasterW: FACADE.pilasterW, door: FACADE_DOOR,
    endPosts: { end: false }, name: "meeting-facade",
  }));
  for (const p of LEDGE_PLANTERS) g.add(ledgePlanter(p.x, p.z, p.r, p.h));

  g.add(tableProps());

  // NO ROOM PROPS. This room's share of the final art pass is its WEST ELEVATION's finishing, above, and
  // nothing else: the composition the artwork authored — table, six chairs, the walnut unit, the kiosk —
  // is complete, and the space around it is deliberate. See the art-direction note in build/detail-props.
  return g;
}
