// vo3d build — THE MEETING FLOOR's architecture, from the plan in rooms/floor2Meeting.ts. Nothing is
// measured here; every position is read from that plan.
//
// ============================= THE LANGUAGE =====================================================
// CONSTRUCTED, NOT OUTLINED. A glass wall is a real 6-unit frame section: a dark metal shoe with a satin
// top edge, the pane seated in it, slim mullions, a head beam whose satin cap is what you see from above,
// and square corner posts. A door is a portal — deeper jambs, a head at door height, a glazed transom, a
// raised stone threshold. Between the window rooms stand solid plaster PIERS with walnut faces, a cornice
// and warm LED edges, so the streets have built mass and rhythm rather than gaps.
//
// GROUND-FLOOR FINISH. Polished world-phased tile in every room (two neutral tones), a threshold's height
// proud of the circulation tile; stone runners down the streets and the axis; contact shadows under
// every wall, table, counter and credenza; warm light pools on the floor under every pendant, lounge and
// pier. Bronze is an accent only.
//
// ============================= WHAT IS NOT BAKED ================================================
// The architecture is baked to one mesh per material. The DOOR LEAVES (interact/Door slides them), the
// DISPLAYS (a share lands on the face; a click is a walk-up) and the SIGNS (redrawn with the room's
// state) stay live. Seating is not here: every chair, stool and sofa is a world entity with a real seat.
import * as THREE from "three";
import { Baker, cyl, rbox, shadowed, slab } from "./helpers";
import { buildFurniture } from "./furniture";
import { plantFor } from "./plants";
import { tiledFloor } from "./tile";
import { laptop, mug, book } from "./props";
import { FoliageSystem } from "../render/Foliage";
import { applyFloorLayerOrder } from "../render/floorLayers";
import { SwaySystem } from "../render/Sway";
import { contactShadowMat, emissiveMat, glassMat, glowMat, mat, plastic, uiScreenMat, wood } from "../render/Materials";
import type { Facing, Rect } from "../core/coords";
import {
  AMENITIES, COMMONS, FRAME_D, GLASS_H, GLASS_RUNS, ISLAND, LEAF_W, MEETING_ROOMS, PIERS, ROOM_DETAILS, RUNNERS,
  displayPick, meetingRoomAt, screenRect, type Amenity, type GlassRun, type MeetingRoomSpec,
} from "../rooms/floor2Meeting";

/** THE FLOOR STACK, every flat layer at its own height so no two can ever fight for a pixel:
 *    slab −0.05 · hall + room tile 0 (never stacked: the hall is cut round every room) · contact 0.04 ·
 *    runner 0.08 · inlay 0.11 · pools 0.16 · plaques 0.2 · rugs 0.6 / 0.8 */
const POOL_Y = 0.16;
/** the Commons' columns and the rail they carry: just over the rooms' head, under the building's */
const COLUMN_H = 52;
let ribbedM: THREE.MeshStandardMaterial | null = null;
/** the screens' ribbed glass: a warm-white translucent pane that catches light but reads as glass */
const ribbedGlass = (): THREE.MeshStandardMaterial =>
  (ribbedM ??= new THREE.MeshStandardMaterial({ color: 0xf2eee6, roughness: 0.35, metalness: 0.05, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.4 }));
let ribsM: THREE.MeshStandardMaterial | null = null;
const ribM = (): THREE.MeshStandardMaterial =>
  (ribsM ??= new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, transparent: true, opacity: 0.28, depthWrite: false }));
const DIR: Record<Facing, { x: number; z: number }> = { north: { x: 0, z: -1 }, south: { x: 0, z: 1 }, east: { x: 1, z: 0 }, west: { x: -1, z: 0 } };
const faceY = (f: Facing): number => Math.atan2(DIR[f].x, DIR[f].z);

/** SATIN CHARCOAL, not black: the frames catch the key light as brushed metal, so they read as members
 *  with depth rather than as ink lines */
const frameM = (): THREE.Material => mat("mfFrame", 0.4, { metalness: 0.55 });
const capM = (): THREE.Material => mat("metal", 0.28, { metalness: 0.7 });
const bronzeM = (): THREE.Material => mat("bronze", 0.28, { metalness: 0.65 });
let frostM: THREE.MeshStandardMaterial | null = null;
const frost = (): THREE.MeshStandardMaterial =>
  (frostM ??= new THREE.MeshStandardMaterial({ color: 0xf3f4f3, roughness: 0.55, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));

/** a soft contact shadow — the ground floor's own plate, flat, never casting */
/** No flat overlay sits closer than this to the floor it lies on: at Player View's grazing angle a
 *  hundredths-of-a-unit gap is below depth precision, and a plate that close breaks up along its edges. */
const CONTACT_MIN_Y = 0.12, POOL_MIN_Y = 0.22;
function contact(g: THREE.Group, r: Rect, y: number, opacity = 0.2, round = false): void {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.d), contactShadowMat(opacity, round ? "round" : "rect"));
  m.rotation.x = -Math.PI / 2;
  m.position.set(r.x + r.w / 2, Math.max(y, CONTACT_MIN_Y), r.z + r.d / 2);
  g.add(shadowed(m, false, false));
}
/** a warm pool of light on the floor — additive, the way the office's own coves spill */
function pool(g: THREE.Group, r: Rect, y: number, opacity = 0.09): void {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.d), glowMat("coveWarm", opacity));
  m.rotation.x = -Math.PI / 2;
  m.position.set(r.x + r.w / 2, Math.max(y, POOL_MIN_Y), r.z + r.d / 2);
  g.add(shadowed(m, false, false));
}
/** a pendant: a short warm drum on a stem, and its pool below */
function pendant(g: THREE.Group, x: number, z: number, poolY: number, r = 4, y = 40): void {
  // A PENDANT CASTS NOTHING: a stem and a drum hung in a roofless room throw long raking lines across
  // the floor at a low sun — the banding the first build showed at sunset. Its light is what it adds.
  g.add(shadowed(cyl(0.25, 46 - y, frameM(), x, y + 2.6, z), false, false));
  g.add(shadowed(cyl(r, 2.6, frameM(), x, y, z, r * 0.85), false, true));
  g.add(shadowed(cyl(r * 0.8, 0.4, emissiveMat("coveWarm", 1.4, 0.3), x, y - 0.3, z), false, false));
  // a ROUND pool: a lamp's light has no corners
  const m = new THREE.Mesh(new THREE.CircleGeometry(r * 6, 40), glowMat("coveWarm", 0.07));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, Math.max(poolY, POOL_MIN_Y), z);
  g.add(shadowed(m, false, false));
}

// ============================= GLAZING ==========================================================

const SHOE_H = 3.4;
const HEAD_H = 2.6;
const MULLION_PITCH = 80;
const POST = 5;
const DOOR_HEAD_Y = 39;

function glassRun(g: THREE.Group, run: GlassRun): void {
  const fm = frameM(), cap = capM();
  const T = FRAME_D;
  const put = (len: number, h: number, y0: number, at: number, m: THREE.Material, thick: number, r = 0.3): THREE.Mesh =>
    run.axis === "x" ? rbox(len, h, thick, m, at, y0, run.at, r) : rbox(thick, h, len, m, run.at, y0, at, r);
  const spans: [number, number][] = run.door ? [[run.from, run.door.from], [run.door.to, run.to]] : [[run.from, run.to]];
  const paneH = GLASS_H - SHOE_H - HEAD_H;
  contact(g, run.axis === "x" ? { x: run.from - 4, z: run.at - 9, w: run.to - run.from + 8, d: 18 } : { x: run.at - 9, z: run.from - 4, w: 18, d: run.to - run.from + 8 }, 0.04, 0.24);
  for (const [a, b] of spans) {
    const len = b - a;
    if (len < 0.5) continue;
    const mid = (a + b) / 2;
    // THE SHOE: a 6-deep dark section with a satin top edge the pane sits into
    g.add(put(len, SHOE_H, -0.5, mid, fm, T));
    g.add(put(len, 0.5, SHOE_H - 0.5, mid, cap, T * 0.9, 0.15));
    // THE PANE, seated in the middle of the section, with a bead each side top and bottom
    g.add(shadowed(put(len - 0.6, paneH, SHOE_H - 0.1, mid, glassMat(), 0.9, 0.1), false, false));
    for (const s of [-1, 1]) {
      const bead = (y: number): THREE.Mesh => run.axis === "x" ? rbox(len, 0.9, 0.7, fm, mid, y, run.at + s * 0.9, 0.2) : rbox(0.7, 0.9, len, fm, run.at + s * 0.9, y, mid, 0.2);
      g.add(shadowed(bead(SHOE_H - 0.1), false, true));
      g.add(shadowed(bead(GLASS_H - HEAD_H - 0.9), false, true));
    }
    // THE HEAD BEAM: dark, 6 deep, with the satin cap Office View sees as a crisp lit edge
    g.add(put(len, HEAD_H, GLASS_H - HEAD_H, mid, fm, T));
    g.add(put(len, 0.4, GLASS_H, mid, cap, T - 1.2, 0.15));
    const bays = Math.max(1, Math.round(len / MULLION_PITCH));
    // mullions throw hairlines across a whole room at a low sun: they receive, they do not cast
    for (let i = 1; i < bays; i++) g.add(shadowed(put(1.6, paneH, SHOE_H - 0.1, a + (len * i) / bays, fm, T * 0.8), false, true));
    const band = (y0: number, h: number): void => { g.add(shadowed(put(len - 1.2, h, y0, mid, frost(), 1.3, 0), false, false)); };
    if (run.band === "solid") band(16.5, 5.5);
    else if (run.band === "double") { band(16.4, 1.4); band(19.4, 1.4); }
    else for (let s = a + 2.4; s < b - 2; s += 3.4) g.add(shadowed(put(1.4, 1.4, 18.4, s, frost(), 1.3, 0), false, false));
  }
  // CORNER POSTS: a square post with a satin cap (bronze on the rooms that carry it) and a plinth
  for (const at of [run.from, run.to]) {
    const px = run.axis === "x" ? at : run.at, pz = run.axis === "x" ? run.at : at;
    g.add(rbox(POST, GLASS_H + 0.5, POST, fm, px, -0.5, pz, 0.5));
    g.add(rbox(POST + 0.6, 0.7, POST + 0.6, run.frame === "bronze" ? bronzeM() : capM(), px, GLASS_H, pz, 0.2));
    g.add(rbox(POST + 1.2, 1.2, POST + 1.2, fm, px, -0.5, pz, 0.3));
  }
  if (run.door) {
    const { from, to } = run.door;
    const c = (from + to) / 2, w = to - from;
    // THE PORTAL: deeper jambs, a head at door height, a glazed transom, a raised stone threshold
    for (const at of [from - 1.6, to + 1.6]) g.add(put(3.2, GLASS_H + 0.5, -0.5, at, fm, T + 1, 0.4));
    g.add(put(w, 2.6, DOOR_HEAD_Y, c, fm, T + 1));
    g.add(put(w, 0.5, DOOR_HEAD_Y + 2.6, c, run.frame === "bronze" ? bronzeM() : capM(), T + 1, 0.15));
    g.add(shadowed(put(w, GLASS_H - HEAD_H - DOOR_HEAD_Y - 3.1, DOOR_HEAD_Y + 3.1, c, glassMat(), 0.9, 0.1), false, false));
    g.add(put(w, HEAD_H, GLASS_H - HEAD_H, c, fm, T));
    g.add(put(w, 0.4, GLASS_H, c, capM(), T - 1.2, 0.15));
    const sill = put(w + 8, 0.9, -0.55, c, mat("hubStone", 0.4), T + 8, 0.2);
    sill.castShadow = false;
    g.add(sill);
  }
}

/** The sliding leaf: frameless glass in fine rails with a bronze pull, built at its CLOSED centre with its
 *  length along the wall. Returns the leaf (what interact/Door slides) and its fixed track. */
function doorLeaf(r: MeetingRoomSpec): { leaf: THREE.Group; track: THREE.Mesh } {
  const d = r.door;
  const leaf = new THREE.Group();
  leaf.name = `door:${r.id}`;
  leaf.position.set(d.leafClosed.x, 0, d.leafClosed.z);
  const horiz = d.side === "north" || d.side === "south";
  leaf.rotation.y = horiz ? 0 : Math.PI / 2;
  const h = DOOR_HEAD_Y - 0.6;
  const fm = frameM();
  leaf.add(shadowed(rbox(LEAF_W - 1, h - 2.4, 0.8, glassMat(), 0, 1.2, 0, 0.1), false, false));
  leaf.add(rbox(LEAF_W, 1.4, 1.4, fm, 0, 0.2, 0, 0.3));
  leaf.add(rbox(LEAF_W, 1.4, 1.4, fm, 0, h - 1.4, 0, 0.3));
  for (const sx of [-1, 1]) leaf.add(rbox(1.2, h, 1.4, fm, sx * (LEAF_W / 2 - 0.6), 0, 0, 0.3));
  // the pull on the leading stile, both faces
  const along = horiz ? d.slide.x : d.slide.z;
  const localAlong = horiz ? along : -along;
  for (const sz of [-1, 1]) leaf.add(rbox(1, 16, 1, bronzeM(), -localAlong * (LEAF_W / 2 - 4), 12, sz * 1.8, 0.4));
  // the track the leaf hangs from, over the door and the run it parks along
  const tr = horiz
    ? rbox(LEAF_W * 2, 0.9, 1.2, fm, d.leafClosed.x + along * LEAF_W / 2, DOOR_HEAD_Y + 0.4, d.leafClosed.z, 0.3)
    : rbox(1.2, 0.9, LEAF_W * 2, fm, d.leafClosed.x, DOOR_HEAD_Y + 0.4, d.leafClosed.z + along * LEAF_W / 2, 0.3);
  return { leaf, track: tr };
}

// ============================= PIERS ============================================================

/** A solid plaster pier between window rooms: walnut slats on its street face, a cornice cap, warm LED
 *  edges at both street corners, a pool of light on the street in front of it. */
function pier(g: THREE.Group, p: Rect, streetSide: 1 | -1): void {
  const cx = p.x + p.w / 2, cz = p.z + p.d / 2;
  contact(g, { x: p.x - 6, z: p.z - 6, w: p.w + 12, d: p.d + 12 }, 0.04, 0.28);
  g.add(rbox(p.w, GLASS_H + 0.5, p.d, mat("plaster", 0.9), cx, -0.5, cz, 0.8));
  g.add(rbox(p.w + 1.6, 1.8, p.d + 1.6, capM(), cx, GLASS_H, cz, 0.4));
  g.add(rbox(p.w + 1.2, 3, p.d + 1.2, mat("walnutDark", 0.7), cx, -0.5, cz, 0.3));
  const faceZ = streetSide > 0 ? p.z + p.d : p.z;
  for (let i = 0; i < 5; i++) g.add(rbox(3.2, GLASS_H - 8, 1.6, mat("walnut", 0.55), p.x + 4 + i * 5.5, 3, faceZ + streetSide * 0.8, 0.3));
  for (const ex of [p.x + 0.6, p.x + p.w - 0.6]) {
    const led = rbox(0.8, GLASS_H - 6, 0.8, emissiveMat("coveWarm", 1.6, 0.3), ex, 3, faceZ + streetSide * 0.5, 0.2);
    led.castShadow = false;
    g.add(led);
  }
  pool(g, { x: cx - 36, z: faceZ + (streetSide > 0 ? 0 : -46), w: 72, d: 46 }, POOL_Y, 0.1);
}

// ============================= ROOM FURNITURE ===================================================

const TOP_Y = 24;

function tableShape(shape: string, w: number, d: number): THREE.Shape {
  const s = new THREE.Shape();
  if (shape === "round") { s.absarc(0, 0, w / 2, 0, Math.PI * 2, false); return s; }
  const r = shape === "boat" ? Math.min(w, d) * 0.46 : shape === "low" ? 4 : 3;
  const hw = w / 2, hd = d / 2, bow = shape === "boat" ? Math.min(w, d) * 0.12 : 0;
  const long = w >= d;
  s.moveTo(-hw + r, -hd);
  if (long) s.quadraticCurveTo(0, -hd - bow, hw - r, -hd); else s.lineTo(hw - r, -hd);
  s.quadraticCurveTo(hw, -hd, hw, -hd + r);
  if (!long) s.quadraticCurveTo(hw + bow, 0, hw, hd - r); else s.lineTo(hw, hd - r);
  s.quadraticCurveTo(hw, hd, hw - r, hd);
  if (long) s.quadraticCurveTo(0, hd + bow, -hw + r, hd); else s.lineTo(-hw + r, hd);
  s.quadraticCurveTo(-hw, hd, -hw, hd - r);
  if (!long) s.quadraticCurveTo(-hw - bow, 0, -hw, -hd + r); else s.lineTo(-hw, -hd + r);
  s.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
  return s;
}

function table(g: THREE.Group, r: MeetingRoomSpec): void {
  const t = r.table, cx = t.rect.x + t.rect.w / 2, cz = t.rect.z + t.rect.d / 2;
  const topM = t.tone === "oak" ? wood("extrude", true) : t.tone === "walnut" ? mat("walnut", 0.4) : plastic("white");
  const legM = frameM();
  const low = t.shape === "low";
  const y = low ? 14 : TOP_Y;
  contact(g, { x: t.rect.x - 6, z: t.rect.z - 6, w: t.rect.w + 12, d: t.rect.d + 12 }, 0.05, 0.22, t.shape === "round");
  pool(g, { x: t.rect.x - 24, z: t.rect.z - 24, w: t.rect.w + 48, d: t.rect.d + 48 }, 0.07, 0.06);
  const top = slab(tableShape(t.shape, t.rect.w, t.rect.d), 2.2, topM, y - 2.2, 0.5);
  top.position.x = cx;
  top.position.z = cz;
  g.add(top);
  if (low) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(cyl(0.9, y - 2.2, legM, cx + sx * (t.rect.w / 2 - 4), 0, cz + sz * (t.rect.d / 2 - 4)));
    return;
  }
  if (t.shape === "round" || t.shape === "square" || Math.max(t.rect.w, t.rect.d) < 70) {
    g.add(cyl(2.6, y - 2.4, legM, cx, 0, cz));
    g.add(cyl(Math.min(t.rect.w, t.rect.d) * 0.3, 0.9, legM, cx, 0, cz, Math.min(t.rect.w, t.rect.d) * 0.26));
    return;
  }
  const long = t.rect.w >= t.rect.d;
  const L = long ? t.rect.w : t.rect.d, D = long ? t.rect.d : t.rect.w;
  for (const s of [-1, 1]) {
    const off = s * L * 0.3;
    g.add(long ? rbox(4, y - 2.4, D * 0.55, legM, cx + off, 0, cz, 0.6) : rbox(D * 0.55, y - 2.4, 4, legM, cx, 0, cz + off, 0.6));
  }
  g.add(long ? rbox(L * 0.6, 2, 3, legM, cx, y - 6, cz, 0.4) : rbox(3, 2, L * 0.6, legM, cx, y - 6, cz, 0.4));
  g.add(cyl(3, 0.8, mat("charcoal", 0.5), cx, y, cz));
  if (r.capacity >= 8) g.add(long ? rbox(L * 0.7, 0.2, 0.8, bronzeM(), cx, y, cz, 0.1) : rbox(0.8, 0.2, L * 0.7, bronzeM(), cx, y, cz, 0.1));
}

/** the pendants: a row of drums along a big table's long axis, one over a small table */
function roomLights(g: THREE.Group, r: MeetingRoomSpec): void {
  const t = r.table.rect, cx = t.x + t.w / 2, cz = t.z + t.d / 2;
  if (!r.pendant) { pendant(g, cx, cz, 0.07, 4.4, 41); return; }
  const long = t.w >= t.d, L = long ? t.w : t.d, n = L > 200 ? 4 : 3;
  for (let i = 0; i < n; i++) {
    const s = -L * 0.35 + (L * 0.7 * i) / (n - 1);
    pendant(g, long ? cx + s : cx, long ? cz : cz + s, 0.07, 3.6, 41);
  }
}

// ============================= DISPLAYS =========================================================

function drawIdleScreen(name: string): (ctx: CanvasRenderingContext2D, w: number, h: number) => void {
  return (ctx, w, h) => {
    const grd = ctx.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, "#1a2537"); grd.addColorStop(1, "#0e1522");
    ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.font = `600 ${Math.round(h * 0.13)}px system-ui, sans-serif`;
    ctx.fillText(name, w * 0.08, h * 0.36);
    ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.font = `500 ${Math.round(h * 0.08)}px system-ui, sans-serif`;
    ctx.fillText("Start a meeting to share your screen here", w * 0.08, h * 0.54);
    ctx.fillStyle = "#b8925c"; ctx.fillRect(w * 0.08, h * 0.72, w * 0.14, h * 0.02);
  };
}

export interface RoomDisplayView { group: THREE.Group; face: THREE.Mesh; idle: THREE.Material; w: number; h: number }

/** The room's screen: hung on a pier over a slim walnut ledge, or on a media credenza. The GROUP is the
 *  display's pick target; the FACE is what a share is drawn onto. */
function display(r: MeetingRoomSpec, g: THREE.Group): RoomDisplayView {
  // THE INSTALLATION, back to front, each layer with its own depth so nothing is coplanar:
  //   wall (local z −2) → feature/felt panels (built by roomDetails, flush on the wall) → a 2-deep bracket
  //   → the TV housing (1.6 deep) → a slim bezel → THE ACTIVE SCREEN, exactly 16:9.
  // The active screen is sized for 1920 × 1080: its width follows the room (bigger rooms, bigger TVs) and
  // its height is always width × 9/16. Rooms are 46 high, so the largest active screen is 50 wide.
  const s = r.screen;
  const unit = new THREE.Group();
  unit.name = displayPick(r.id);
  unit.userData.roomId = r.id;
  unit.position.set(s.x, 0, s.z);
  unit.rotation.y = faceY(s.facing);
  const rr = screenRect(s);
  contact(g, { x: rr.x - 4, z: rr.z - 4, w: rr.w + 8, d: rr.d + 8 }, 0.05, 0.24);
  const faceW = Math.min(s.w * 0.75 + 4, 50), faceH = (faceW * 9) / 16;
  const BEZEL = 1.1, housingW = faceW + 2 * BEZEL, housingH = faceH + 2 * BEZEL, HOUSING_D = 1.6;
  const bottom = 16.5; // clear of a 14.7 ledge / credenza top by 1.8
  let backZ: number;
  if (s.mount === "wall") {
    // a slim walnut ledge on the wall under the screen, clear of it
    unit.add(rbox(housingW + 6, 2.2, 6, mat("walnut", 0.5), 0, 12, 1, 0.5));
    unit.add(rbox(housingW + 6.2, 0.5, 6.2, capM(), 0, 14.2, 1, 0.15));
    unit.add(rbox(housingW * 0.4, housingH * 0.5, 2, frameM(), 0, bottom + housingH * 0.25, -1, 0.3)); // bracket
    backZ = 0;
  } else {
    const depth = Math.min(rr.w, rr.d);
    unit.add(rbox(s.w + 10, 13, depth, mat("walnut", 0.5), 0, 0, 0, 0.8));
    unit.add(rbox(s.w + 10.4, 0.8, depth + 0.4, capM(), 0, 13, 0, 0.3));
    backZ = -depth / 2 + 2;
    unit.add(rbox(3, bottom + 2 - 13.8, 2, frameM(), 0, 13.8, backZ - 1, 0.3)); // spine
  }
  // THE PANEL hangs from its TOP edge, so an east/west-facing screen can tip its face up toward the Office
  // View camera by swinging its bottom out — never its top into the wall behind it.
  const panel = new THREE.Group();
  panel.position.set(0, bottom + housingH, backZ);
  if (s.facing === "east" || s.facing === "west") panel.rotation.x = -0.22;
  panel.add(rbox(housingW, housingH, HOUSING_D, mat("charcoal", 0.3, { metalness: 0.3 }), 0, -housingH, HOUSING_D / 2, 0.3));
  const idle = uiScreenMat(`mf-screen-${r.id}`, 384, 216, drawIdleScreen(r.name), 0.8, true);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(faceW, faceH), idle);
  face.position.set(0, -housingH / 2, HOUSING_D + 0.06);
  face.name = `mf-screen:${r.id}`;
  panel.add(face);
  unit.add(panel);
  unit.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  face.castShadow = false;
  return { group: unit, face, idle, w: faceW, h: faceH };
}

/** Put a live share on a room's display (letterboxed to the face), or put the idle card back. */
export function setRoomDisplayTexture(v: RoomDisplayView, tex: THREE.Texture | null, aspect = 16 / 9): void {
  if (!tex) { v.face.material = v.idle; v.face.scale.set(1, 1, 1); return; }
  let m = v.face.userData.live as THREE.MeshBasicMaterial | undefined;
  if (!m) { m = new THREE.MeshBasicMaterial({ toneMapped: false }); v.face.userData.live = m; }
  if (m.map !== tex) { m.map = tex; m.needsUpdate = true; }
  v.face.material = m;
  const faceAspect = v.w / v.h;
  v.face.scale.set(aspect >= faceAspect ? 1 : aspect / faceAspect, aspect >= faceAspect ? faceAspect / aspect : 1, 1);
}

// ============================= SIGNS ============================================================

const KIND_LABEL: Record<MeetingRoomSpec["kind"], string> = { huddle: "Huddle", standard: "Meeting", large: "Meeting", boardroom: "Boardroom", project: "Project room", lounge: "Lounge meeting" };
/** WHAT THE DOOR SIGN SAYS. Room status only — never anybody's personal status. */
export type RoomSignState = "available" | "upcoming" | "starting" | "in-meeting" | "private" | "ended";
const SIGN_LINE: Record<RoomSignState, { text: string; sub?: string; color: string }> = {
  available: { text: "Available", color: "#62e393" },
  upcoming: { text: "Upcoming", color: "#7fc4ff" },
  starting: { text: "Starting Soon", color: "#f2c14e" },
  "in-meeting": { text: "In Meeting", color: "#ff8a4c" },
  private: { text: "In Meeting", sub: "Private · DND", color: "#ff5a52" },
  ended: { text: "Meeting ended", color: "#9aa3ad" },
};

/** SCHEDULED MEETINGS' additions to a sign: the second line ("Product Sync · 2:00 PM", "Next: …"), the
 *  status word and its small line. Each falls back to the room's printed default. */
export interface RoomSignDetail { line2?: string; text?: string; sub?: string }
export interface RoomSignView { setState(state: RoomSignState, detail?: RoomSignDetail): void; readonly state: RoomSignState }

/** THE DOOR SIGN: beside the door on the corridor side, the room's one printed identity —
 *
 *      BRAVO
 *      Meeting · 6 seats
 *      ● Available            (● In Meeting · Private · DND while a private meeting runs)
 *
 *  Redrawn only when its state changes. */
function signs(r: MeetingRoomSpec, into: THREE.Group): RoomSignView {
  const canvas = typeof document === "undefined" ? null : document.createElement("canvas");
  if (canvas) { canvas.width = 256; canvas.height = 144; }
  const plate = canvas?.getContext("2d") ?? null;
  const tex = canvas ? new THREE.CanvasTexture(canvas) : null;
  if (tex) { tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; }
  let current: RoomSignState = "available";
  let drawn = "";
  /** longest prefix of `text` that fits `max` px in the plate's current font, with an ellipsis */
  const fit = (text: string, max: number): string => {
    if (!plate || plate.measureText(text).width <= max) return text;
    let t = text;
    while (t.length > 1 && plate.measureText(`${t}…`).width > max) t = t.slice(0, -1);
    return `${t.trimEnd()}…`;
  };
  const draw = (state: RoomSignState, detail: RoomSignDetail = {}): void => {
    current = state;
    const key = `${state}|${detail.line2 ?? ""}|${detail.text ?? ""}|${detail.sub ?? ""}`;
    if (!plate || !tex || key === drawn) return;
    drawn = key;
    const base = SIGN_LINE[state];
    const line = { ...base, text: detail.text ?? base.text, sub: detail.sub ?? base.sub };
    const w = 256, h = 144;
    plate.fillStyle = "#151c27"; plate.fillRect(0, 0, w, h);
    plate.fillStyle = "#ffffff"; plate.font = `800 ${Math.round(h * 0.25)}px system-ui, sans-serif`;
    plate.fillText(r.name.toUpperCase(), w * 0.08, h * 0.32);
    plate.fillStyle = "rgba(255,255,255,0.62)"; plate.font = `500 ${Math.round(h * 0.12)}px system-ui, sans-serif`;
    plate.fillText(fit(detail.line2 ?? `${KIND_LABEL[r.kind]} · ${r.capacity} seats`, w * 0.86), w * 0.08, h * 0.52);
    plate.fillStyle = line.color; plate.beginPath(); plate.arc(w * 0.1, h * 0.72, h * 0.045, 0, Math.PI * 2); plate.fill();
    plate.font = `700 ${Math.round(h * 0.13)}px system-ui, sans-serif`; plate.fillText(line.text, w * 0.16, h * 0.76);
    if (line.sub) { plate.font = `600 ${Math.round(h * 0.1)}px system-ui, sans-serif`; plate.fillText(line.sub, w * 0.16, h * 0.92); }
    tex.needsUpdate = true;
  };
  const s = new THREE.Group();
  s.name = `sign:${r.id}`;
  s.userData.roomId = r.id;
  s.position.set(r.sign.x, 0, r.sign.z);
  s.rotation.y = faceY(r.sign.facing);
  // a satin plate standing 1 proud of the glazing, the face 0.5 in front of it: nothing coplanar
  s.add(rbox(16, 9.8, 1, r.frame === "bronze" ? bronzeM() : frameM(), 0, 26.6, 0.5, 0.3));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(15, 8.4), new THREE.MeshStandardMaterial({ color: 0x000000, map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.85, roughness: 0.3 }));
  face.position.set(0, 31.5, 1.52);
  s.add(face);
  into.add(s);
  draw("available");
  // redrawn only when what it says changes (draw() compares the whole text, not just the state)
  return { setState: (st, detail) => draw(st, detail), get state() { return current; } };
}

function drawDirectory(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = "#151c27"; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#b8925c"; ctx.fillRect(w * 0.08, h * 0.07, w * 0.12, h * 0.008);
  ctx.fillStyle = "#ffffff"; ctx.font = `800 ${Math.round(h * 0.09)}px system-ui, sans-serif`;
  ctx.fillText("02", w * 0.08, h * 0.17);
  ctx.font = `600 ${Math.round(h * 0.042)}px system-ui, sans-serif`;
  ctx.fillText("MEETING FLOOR", w * 0.08, h * 0.23);
  const group = (y: number, arrow: string, title: string, idx: number[]): void => {
    ctx.fillStyle = "#d6b98c"; ctx.font = `700 ${Math.round(h * 0.036)}px system-ui, sans-serif`;
    ctx.fillText(`${arrow}  ${title}`, w * 0.08, y);
    ctx.fillStyle = "rgba(255,255,255,0.78)"; ctx.font = `500 ${Math.round(h * 0.032)}px system-ui, sans-serif`;
    idx.forEach((k, i) => ctx.fillText(`${MEETING_ROOMS[k].name} · ${MEETING_ROOMS[k].capacity}`, w * 0.12 + (i % 2) * w * 0.42, y + h * 0.045 * (1 + Math.floor(i / 2))));
  };
  group(h * 0.3, "↑", "North Street", [0, 1, 2, 3, 4]);
  group(h * 0.5, "→", "Commons & Boardroom", [5, 6, 7]);
  group(h * 0.66, "↓", "South Street", [8, 9, 10, 11, 12]);
  ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = `500 ${Math.round(h * 0.03)}px system-ui, sans-serif`;
  ctx.fillText("Café · lounges · work bench", w * 0.08, h * 0.95);
}

// ============================= THE COMMONS AND THE SECONDARY SPACES ============================

const FLOOR = 0; // the circulation tile's top — flush with every room's

function amenity(g: THREE.Group, flora: THREE.Group, a: Amenity): void {
  switch (a.kind) {
    case "rug": {
      const r = a.rect;
      contact(g, { x: r.x - 3, z: r.z - 3, w: r.w + 6, d: r.d + 6 }, 0.03, 0.12);
      const rug = rbox(r.w, 0.6, r.d, mat("mfRug", 1), r.x + r.w / 2, 0, r.z + r.d / 2, 0.4);
      rug.castShadow = false;
      g.add(rug);
      const field = rbox(r.w - 12, 0.8, r.d - 12, mat("mfFloorStone", 1), r.x + r.w / 2, 0, r.z + r.d / 2, 0.3);
      field.castShadow = false;
      g.add(field);
      return;
    }
    case "glow": pool(g, a.rect, 0.42, 0.07); return;
    case "feature-wall": {
      // the café's feature wall: walnut slats on a dark ground, a lit menu panel, a warm wash at its foot
      const r = a.rect, cx = r.x + r.w / 2, cz = r.z + r.d / 2;
      g.add(rbox(r.w, GLASS_H - 2, r.d, mat("walnutDark", 0.7), cx, 0, cz, 0.3));
      for (let x = r.x + 4; x < r.x + r.w - 2; x += 6) g.add(rbox(3, GLASS_H - 8, 1.4, mat("walnut", 0.5), x, 4, r.z + r.d + 0.7, 0.3));
      g.add(rbox(r.w + 2, 1.4, r.d + 2, capM(), cx, GLASS_H - 2, cz, 0.3));
      const menu = new THREE.Mesh(new THREE.PlaneGeometry(56, 20), uiScreenMat("mf-cafe-menu", 280, 100, drawMenu, 0.8));
      menu.position.set(cx + 60, 32, r.z + r.d + 1.6);
      g.add(menu);
      g.add(rbox(58, 22, 1, mat("charcoal", 0.3), cx + 60, 21, r.z + r.d + 1, 0.3));
      // a floating walnut shelf of cups over the back bar
      g.add(rbox(110, 1.4, 5, mat("walnut", 0.5), r.x + 70, 34, r.z + r.d + 2.5, 0.3));
      for (let i = 0; i < 9; i++) g.add(mug(r.x + 22 + i * 11, 35.4, r.z + r.d + 2.5));
      const wash = rbox(r.w - 10, 0.6, 0.6, emissiveMat("coveWarm", 1.3, 0.3), cx, 43, r.z + r.d + 1.6, 0.1);
      wash.castShadow = false;
      g.add(wash);
      return;
    }
    case "planter": {
      // a low built-in planter edging a lounge off the axis: stone trough, walnut rim, planting
      const r = a.rect, cx = r.x + r.w / 2, cz = r.z + r.d / 2;
      contact(g, { x: r.x - 4, z: r.z - 4, w: r.w + 8, d: r.d + 8 }, 0.03, 0.24);
      g.add(rbox(r.w, 14, r.d, mat("hubStone", 0.7), cx, 0, cz, 0.8));
      g.add(rbox(r.w + 1, 1, r.d + 1, mat("walnut", 0.5), cx, 14, cz, 0.3));
      g.add(rbox(r.w - 3, 0.5, r.d - 3, mat("potDark", 1), cx, 14.4, cz, 0.2));
      for (let x = r.x + 20; x < r.x + r.w - 10; x += 42) flora.add(plantFor({ x, z: cz, r: 7, h: 20, y: 14.4, pot: false, lush: 1.2 }, []));
      return;
    }
    // a plant stands on the floor it is on: a room's raised tile (0) or the Commons' hall tile (FLOOR)
    case "plant": flora.add(plantFor({ x: a.c.x, z: a.c.z, r: a.r, h: a.h, y: meetingRoomAt(a.c) ? 0 : FLOOR }, [])); return;
    case "screen": {
      // A FRAMED RIBBED-GLASS SCREEN: a stone plinth, satin posts every bay, a translucent ribbed pane that
      // catches the light, a head rail — seen through, never walked through
      const r = a.rect, alongX = r.w > r.d, len = alongX ? r.w : r.d, cx = r.x + r.w / 2, cz = r.z + r.d / 2;
      const put = (l: number, h: number, y0: number, at: number, m: THREE.Material, t: number, rad = 0.3): THREE.Mesh =>
        alongX ? rbox(l, h, t, m, at, y0, cz, rad) : rbox(t, h, l, m, cx, y0, at, rad);
      const a0 = alongX ? r.x : r.z;
      contact(g, alongX ? { x: r.x - 3, z: cz - 7, w: r.w + 6, d: 14 } : { x: cx - 7, z: r.z - 3, w: 14, d: r.d + 6 }, 0.03, 0.22);
      g.add(put(len, 3, 0, a0 + len / 2, mat("hubStone", 0.5), 5));
      g.add(shadowed(put(len - 1, 34, 3, a0 + len / 2, ribbedGlass(), 1.2, 0.1), false, false));
      for (let k = a0 + 3; k < a0 + len - 1; k += 3.2) g.add(shadowed(put(0.6, 33, 3.5, k, ribM(), 1.6, 0), false, false));
      const bays = Math.max(1, Math.round(len / 52));
      for (let i = 0; i <= bays; i++) g.add(put(2.2, 40, 0, Math.min(Math.max(a0 + (len * i) / bays, a0 + 1.1), a0 + len - 1.1), frameM(), 3.2, 0.3));
      g.add(shadowed(put(len, 1.6, 38.4, a0 + len / 2, frameM(), 3.2), false, true));
      g.add(shadowed(put(len, 0.4, 40, a0 + len / 2, capM(), 2.6, 0.1), false, true));
      return;
    }
    case "cabinet": {
      // a low walnut cabinet on a huddle's quiet wall, with a lamp and a few books
      const r = a.rect, cx = r.x + r.w / 2, cz = r.z + r.d / 2, y0 = -FLOOR; // stands on the room's raised tile
      contact(g, { x: r.x - 3, z: r.z - 3, w: r.w + 6, d: r.d + 6 }, y0 + 0.05, 0.24);
      g.add(rbox(r.w, 13, r.d, mat("walnut", 0.5), cx, y0, cz, 0.6));
      g.add(rbox(r.w + 0.6, 0.8, r.d + 0.6, mat("hubStone", 0.35), cx, y0 + 13, cz, 0.2));
      g.add(cyl(0.6, 9, frameM(), r.x + 10, y0 + 13.8, cz));
      g.add(shadowed(cyl(2.8, 3, mat("mfOat", 0.9), r.x + 10, y0 + 22.8, cz, 2.2), false, true));
      g.add(shadowed(cyl(2.2, 0.4, emissiveMat("coveWarm", 1.2, 0.3), r.x + 10, y0 + 22.6, cz), false, false));
      for (let i = 0; i < 4; i++) g.add(book(r.x + r.w - 20 + i * 3, y0 + 13.8, cz, 2.6, 8, (["mfCharcoal", "mfOat", "mfCognac", "mfOlive"] as const)[i], 0));
      return;
    }
    case "column": {
      // a structural column: plaster shaft, walnut base, satin collar, a warm uplight at its foot
      contact(g, { x: a.c.x - 14, z: a.c.z - 14, w: 28, d: 28 }, 0.03, 0.26, true);
      // shaft, a stone plinth, walnut fluting on the lower two-thirds, a satin collar, a capital that
      // carries the light rail, and a warm wash on the column face
      g.add(rbox(14, COLUMN_H, 14, mat("plaster", 0.9), a.c.x, 0, a.c.z, 1));
      g.add(rbox(18, 4, 18, mat("hubStone", 0.5), a.c.x, 0, a.c.z, 0.8));
      for (let f = 0; f < 4; f++) for (let k = -2; k <= 2; k++) {
        const off = k * 2.6, sx = [0, 1, 0, -1][f], sz = [1, 0, -1, 0][f];
        g.add(rbox(sx ? 1.2 : 1.6, 26, sx ? 1.6 : 1.2, mat("walnut", 0.5), a.c.x + sx * 7.4 + (sx ? 0 : off), 4, a.c.z + sz * 7.4 + (sz ? 0 : off), 0.3));
      }
      g.add(rbox(15.6, 0.9, 15.6, bronzeM(), a.c.x, 30, a.c.z, 0.3));
      g.add(rbox(18, 2.4, 18, mat("plaster", 0.9), a.c.x, COLUMN_H - 2.4, a.c.z, 0.6));
      g.add(rbox(18.6, 0.6, 18.6, capM(), a.c.x, COLUMN_H, a.c.z, 0.2));
      g.add(shadowed(rbox(0.6, 12, 0.6, emissiveMat("coveWarm", 1.4, 0.3), a.c.x, 32, a.c.z + 7.2, 0.1), false, false));
      pool(g, { x: a.c.x - 26, z: a.c.z - 26, w: 52, d: 52 }, 0.42, 0.08);
      return;
    }
    case "backbar": {
      // the café's back bar: walnut base units under a stone top, a coffee machine, a water tower, a snack
      // case with a warm-lit shelf, and cups; a warm cove under the top edge
      const r = a.rect, cx = r.x + r.w / 2, cz = r.z + r.d / 2;
      contact(g, { x: r.x - 4, z: r.z - 4, w: r.w + 8, d: r.d + 8 }, 0.03, 0.26);
      g.add(rbox(r.w, 22, r.d, mat("walnut", 0.55), cx, 0, cz, 0.8));
      g.add(rbox(r.w + 1, 1.4, r.d + 1, mat("hubStone", 0.35), cx, 21.5, cz, 0.3));
      const cove = rbox(r.w - 4, 0.6, 0.6, emissiveMat("coveWarm", 1.5, 0.3), cx, 20, r.z + r.d + 0.2, 0.1);
      cove.castShadow = false;
      g.add(cove);
      const x0 = r.x + 20;
      g.add(rbox(22, 16, 12, mat("charcoal", 0.3, { metalness: 0.5 }), x0 + 10, 22.9, cz, 1)); //         espresso machine
      g.add(rbox(20, 2, 8, capM(), x0 + 10, 38.9, cz, 0.4));
      g.add(cyl(4.2, 20, mat("glass", 0.1, { transparent: true, opacity: 0.6 }), x0 + 44, 22.9, cz)); //    water tower
      g.add(cyl(4.4, 2, capM(), x0 + 44, 42.9, cz));
      g.add(rbox(48, 14, 12, glassMat(), x0 + 90, 22.9, cz, 0.4)); //                                        snack case
      const shelf = rbox(46, 0.6, 10, emissiveMat("coveWarm", 0.9, 0.3), x0 + 90, 29, cz, 0.1);
      shelf.castShadow = false;
      g.add(shelf);
      for (let i = 0; i < 6; i++) g.add(mug(x0 + 130 + i * 8, 22.9, cz + (i % 2) * 3));
      for (let i = 0; i < 3; i++) pendant(g, r.x + 40 + i * 80, r.z + r.d + 36, 0, 3.4, 38);
      return;
    }
    case "counter": {
      // a standing counter: stone top at standing height, walnut body, a warm cove under the overhang
      const r = a.rect, cx = r.x + r.w / 2, cz = r.z + r.d / 2;
      contact(g, { x: r.x - 4, z: r.z - 4, w: r.w + 8, d: r.d + 8 }, 0.03, 0.24);
      g.add(rbox(r.w - 6, 26, r.d - 6, mat("walnut", 0.55), cx, 0, cz, 0.8));
      g.add(rbox(r.w, 1.6, r.d + 2, mat("hubStone", 0.3), cx, 25.5, cz, 0.4));
      for (const s of [-1, 1]) {
        const c = rbox(r.w - 8, 0.5, 0.5, emissiveMat("coveWarm", 1.2, 0.3), cx, 24.5, cz + s * (r.d / 2 - 2.6), 0.1);
        c.castShadow = false;
        g.add(c);
      }
      for (let i = 0; i < 3; i++) g.add(mug(r.x + 40 + i * 60, 27.1, cz));
      return;
    }
    case "cafe-table": {
      contact(g, { x: a.c.x - 14, z: a.c.z - 14, w: 28, d: 28 }, 0.03, 0.2, true);
      g.add(buildFurniture({ kind: "cafe-table", rect: { x: a.c.x - 11, z: a.c.z - 11, w: 22, d: 22 }, facing: "north", mirrored: false, color: "white" }));
      return;
    }
    case "worktable": {
      // the shared touchdown bench: an oak top on dark frames, a power spine, laptops and task lamps
      const r = a.rect, cx = r.x + r.w / 2, cz = r.z + r.d / 2;
      contact(g, { x: r.x - 6, z: r.z - 6, w: r.w + 12, d: r.d + 12 }, 0.03, 0.22);
      g.add(rbox(r.w, 2.2, r.d, wood(), cx, 22, cz, 0.6));
      for (const s of [-1, 1]) g.add(rbox(4, 22, r.d - 6, frameM(), cx + s * (r.w / 2 - 8), 0, cz, 0.4));
      g.add(rbox(r.w - 30, 3, 5, frameM(), cx, 24.2, cz, 0.6));
      for (const [i, ch] of a.chairs.entries()) {
        const lz = ch.z < cz ? cz - 10 : cz + 10;
        const lt = laptop(ch.x, 24.2, lz);
        if (ch.z > cz) lt.rotation.y = Math.PI;
        g.add(lt);
        if (i % 3 === 1) pendant(g, ch.x, cz, 0, 3.2, 38);
      }
      return;
    }
    case "desk": {
      const r = a.rect, cx = r.x + r.w / 2, cz = r.z + r.d / 2;
      contact(g, { x: r.x - 4, z: r.z - 4, w: r.w + 8, d: r.d + 8 }, 0.03, 0.22);
      g.add(rbox(r.w, 2, r.d, wood(), cx, 22, cz, 0.5));
      for (const s of [-1, 1]) g.add(rbox(r.w - 4, 22, 2, frameM(), cx, 0, cz + s * (r.d / 2 - 2), 0.3));
      const lt = laptop(cx + 2, 24, cz);
      lt.rotation.y = -Math.PI / 2;
      g.add(lt);
      g.add(cyl(0.5, 10, frameM(), r.x + 4, 24, r.z + 5));
      const lamp = cyl(2.2, 1.6, emissiveMat("coveWarm", 1.2, 0.3), r.x + 5.5, 33, r.z + 5);
      lamp.castShadow = false;
      g.add(lamp);
      pool(g, { x: r.x - 6, z: r.z - 6, w: r.w + 40, d: r.d + 12 }, 0.42, 0.07);
      return;
    }
    case "shelf": {
      // a low walnut shelf unit with books and a few objects on it
      const r = a.rect, cx = r.x + r.w / 2, cz = r.z + r.d / 2;
      contact(g, { x: r.x - 3, z: r.z - 3, w: r.w + 6, d: r.d + 6 }, 0.03, 0.24);
      g.add(rbox(r.w, 30, r.d, mat("walnut", 0.55), cx, 0, cz, 0.6));
      for (const y of [10, 20]) g.add(rbox(r.w - 1.6, 0.8, r.d - 2, mat("walnutDark", 0.6), cx, y, cz, 0.2));
      const keys = ["mfCharcoal", "mfOat", "mfCognac", "mfStone", "mfOlive"] as const;
      for (let i = 0; i < 12; i++) g.add(book(cx + 1, i < 6 ? 10.8 : 20.8, r.z + 8 + (i % 6) * 13, 8, 2.2, keys[i % keys.length], 0));
      g.add(cyl(3, 7, plastic("white"), cx, 29.5, r.z + 20, 2.4));
      return;
    }
    case "side-table": {
      const r = a.rect, cx = r.x + r.w / 2, cz = r.z + r.d / 2;
      contact(g, { x: r.x - 3, z: r.z - 3, w: r.w + 6, d: r.d + 6 }, 0.03, 0.2, true);
      g.add(cyl(r.w / 2, 1.4, mat("walnut", 0.45), cx, 15, cz));
      g.add(cyl(1, 15, frameM(), cx, 0, cz));
      g.add(cyl(r.w * 0.3, 0.6, frameM(), cx, 0, cz));
      g.add(cyl(1.6, 6, emissiveMat("coveWarm", 1.0, 0.3), cx, 16.4, cz, 1.2));
      return;
    }
    case "lounge-table": {
      contact(g, { x: a.rect.x - 5, z: a.rect.z - 5, w: a.rect.w + 10, d: a.rect.d + 10 }, FLOOR + 0.25, 0.2);
      g.add(buildFurniture({ kind: "lounge-table", rect: a.rect, facing: "north", mirrored: false, tone: "lounge" }));
      pendant(g, a.rect.x + a.rect.w / 2, a.rect.z + a.rect.d / 2, 0, 5, 40);
      return;
    }
    default: return; // sofas, armchairs: world entities with real seats
  }
}

function drawMenu(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = "#141a22"; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#d6b98c"; ctx.font = `700 ${Math.round(h * 0.2)}px system-ui, sans-serif`;
  ctx.fillText("COFFEE BAR", w * 0.06, h * 0.3);
  ctx.fillStyle = "rgba(255,255,255,0.8)"; ctx.font = `500 ${Math.round(h * 0.14)}px system-ui, sans-serif`;
  ["Espresso", "Flat white", "Cold brew", "Tea"].forEach((t, i) => ctx.fillText(t, w * (0.06 + (i % 2) * 0.45), h * (0.58 + Math.floor(i / 2) * 0.24)));
}

/** THE COMMONS' STRUCTURE: timber beams on the four columns, framing the Commons as a room of its own —
 *  above head height, with a warm cove on their underside. */
function commonsBeams(g: THREE.Group): void {
  const cols = AMENITIES.filter((a): a is Extract<Amenity, { kind: "column" }> => a.kind === "column").map((a) => a.c);
  const xs = [...new Set(cols.map((c) => c.x))].sort((a, b) => a - b), zs = [...new Set(cols.map((c) => c.z))].sort((a, b) => a - b);
  // A SLIM LIT RAIL, not a beam: 3 wide, 2.4 deep, walnut-faced with a warm channel underneath, carried on
  // the capitals above the rooms' 46 head — structure you read from above, not a bar across Player View
  const y = COLUMN_H - 2.4;
  const rail = (len: number, cx: number, cz: number, alongX: boolean): void => {
    // an overhead member this slim throws a hairline across the floor at every sun angle: it receives only
    g.add(shadowed(alongX ? rbox(len, 2.4, 3, mat("walnut", 0.5), cx, y, cz, 0.4) : rbox(3, 2.4, len, mat("walnut", 0.5), cx, y, cz, 0.4), false, true));
    g.add(shadowed(alongX ? rbox(len - 20, 0.4, 1.2, emissiveMat("coveWarm", 1.3, 0.3), cx, y - 0.3, cz, 0.1) : rbox(1.2, 0.4, len - 20, emissiveMat("coveWarm", 1.3, 0.3), cx, y - 0.3, cz, 0.1), false, false));
  };
  for (const z of zs) rail(xs[1] - xs[0] - 18, (xs[0] + xs[1]) / 2, z, true);
  for (const x of xs) rail(zs[1] - zs[0] - 18, x, (zs[0] + zs[1]) / 2, false);
}

/** THE SOCIAL ISLAND: a circular stone inlay with a bronze ring; an outward-facing stone bench with
 *  walnut-slatted fascia and oat cushions; a planter ring; and at the heart a slim walnut column carrying a
 *  lit digital band and a warm halo. It is the one round thing on the floor. */
function island(g: THREE.Group, flora: THREE.Group): THREE.Group {
  const I = ISLAND, c = I.c;
  const live = new THREE.Group();
  live.name = "floor-2/island-bench";
  // the floor: a stone disc, a threshold proud, ringed in bronze, with a soft pool round it
  const inlay = cyl(I.inlayR, 0.15, mat("mfRunner", 0.3), c.x, -0.05, c.z);
  inlay.castShadow = false;
  g.add(inlay);
  const ring = new THREE.Mesh(new THREE.RingGeometry(I.inlayR - 2, I.inlayR, 96), bronzeM());
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(c.x, 0.2, c.z);
  g.add(shadowed(ring, false, true));
  // a ROUND pool — the island's light follows the island's own shape
  const lightPool = new THREE.Mesh(new THREE.CircleGeometry(I.inlayR + 16, 64), glowMat("coveWarm", 0.07));
  lightPool.rotation.x = -Math.PI / 2;
  lightPool.position.set(c.x, POOL_MIN_Y, c.z);
  g.add(shadowed(lightPool, false, false));
  contact(g, { x: c.x - I.benchOut - 8, z: c.z - I.benchOut - 8, w: 2 * I.benchOut + 16, d: 2 * I.benchOut + 16 }, 0.16, 0.26, true);
  // the bench: a lathe-turned stone shell, a slatted walnut fascia, a cushion ring
  const shell = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(I.benchIn, 0), new THREE.Vector2(I.benchOut, 0), new THREE.Vector2(I.benchOut, 10), new THREE.Vector2(I.benchIn, 10)], 72), mat("hubStone", 0.6));
  shell.position.set(c.x, 0.1, c.z);
  live.add(shadowed(shell));
  for (let i = 0; i < 72; i++) {
    const t = (i / 72) * Math.PI * 2;
    const slat = rbox(3.4, 8, 1.2, mat("walnut", 0.5), c.x + Math.cos(t) * (I.benchOut + 0.5), 1, c.z + Math.sin(t) * (I.benchOut + 0.5), 0.3);
    slat.rotation.y = -t + Math.PI / 2;
    live.add(slat);
  }
  const cushion = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(I.benchIn + 1, 0), new THREE.Vector2(I.benchOut - 1, 0), new THREE.Vector2(I.benchOut - 1.6, 2.4), new THREE.Vector2(I.benchIn + 1.6, 2.4)], 72), mat("mfOat", 0.95));
  cushion.position.set(c.x, 10.1, c.z);
  live.add(shadowed(cushion));
  // the planter ring inside the bench, and its planting
  const planter = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(I.columnR + 4, 0), new THREE.Vector2(I.planterR, 0), new THREE.Vector2(I.planterR, 16), new THREE.Vector2(I.columnR + 4, 16)], 64), mat("hubStone", 0.7));
  planter.position.set(c.x, 0.1, c.z);
  live.add(shadowed(planter));
  const soil = cyl(I.planterR - 1, 0.6, mat("potDark", 1), c.x, 15.6, c.z);
  live.add(soil);
  for (let i = 0; i < 6; i++) {
    const t = (i / 6) * Math.PI * 2 + 0.5;
    flora.add(plantFor({ x: c.x + Math.cos(t) * 29, z: c.z + Math.sin(t) * 29, r: 7, h: 24, y: 15.8, pot: false, lush: 1.2 }, []));
  }
  // the column: walnut, a bronze collar, a digital band wrapped round it, a warm halo at its crown
  live.add(cyl(I.columnR, 44, mat("walnut", 0.45), c.x, 0.1, c.z));
  live.add(cyl(I.columnR + 0.6, 1, bronzeM(), c.x, 16.2, c.z));
  const band = new THREE.Mesh(new THREE.CylinderGeometry(I.columnR + 0.4, I.columnR + 0.4, 10, 48, 1, true), uiScreenMat("mf-island-band", 512, 64, drawBand, 0.9));
  band.position.set(c.x, 32, c.z);
  live.add(shadowed(band, false, false));
  live.add(cyl(I.columnR + 0.8, 1.2, capM(), c.x, 44, c.z));
  const halo = cyl(I.columnR + 0.4, 0.4, emissiveMat("coveWarm", 1.6, 0.3), c.x, 45.2, c.z);
  live.add(shadowed(halo, false, false));
  return live;
}
function drawBand(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = "#101720"; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#d6b98c"; ctx.font = `700 ${Math.round(h * 0.5)}px system-ui, sans-serif`;
  for (let i = 0; i < 2; i++) ctx.fillText("02 · MEETING FLOOR", i * w / 2 + 10, h * 0.66);
}

/** A ROOM'S OWN FINISH: a walnut credenza under the window with a lamp and a plant, a framed print on the
 *  pier opposite the display, and an acoustic felt panel behind a wall-hung display. */
function roomDetails(g: THREE.Group, r: MeetingRoomSpec): void {
  const d = ROOM_DETAILS.get(r.id);
  if (d?.credenza) {
    const c = d.credenza, cx = c.x + c.w / 2, cz = c.z + c.d / 2;
    contact(g, { x: c.x - 4, z: c.z - 4, w: c.w + 8, d: c.d + 8 }, 0.05, 0.24);
    g.add(rbox(c.w, 14, c.d, mat("walnut", 0.5), cx, 0, cz, 0.6));
    g.add(rbox(c.w + 0.6, 0.8, c.d + 0.6, mat("hubStone", 0.35), cx, 14, cz, 0.2));
    const long = c.w > c.d;
    const lx = long ? c.x + 10 : cx, lz = long ? cz : c.z + 12;
    g.add(cyl(0.6, 10, frameM(), lx, 14.8, lz));
    g.add(shadowed(cyl(3, 3, mat("mfOat", 0.9), lx, 24.8, lz, 2.4), false, true));
    g.add(shadowed(cyl(2.4, 0.4, emissiveMat("coveWarm", 1.2, 0.3), lx, 24.6, lz), false, false));
    for (let i = 0; i < 3; i++) g.add(book(long ? cx + 10 + i * 3 : cx, 14.8, long ? cz : cz + 10 + i * 3, 2.6, 8, (["mfCharcoal", "mfOat", "mfCognac"] as const)[i], 0));
  }
  if (d?.art) {
    const a = d.art, dir = DIR[a.facing];
    const f = new THREE.Group();
    f.position.set(a.x + dir.x * 0.8, 30, a.z + dir.z * 0.8);
    f.rotation.y = faceY(a.facing);
    f.add(rbox(a.w, 26, 1.2, mat("walnut", 0.5), 0, -13, 0, 0.3));
    const art = new THREE.Mesh(new THREE.PlaneGeometry(a.w - 4, 22), uiScreenMat(`mf-art-${a.w}`, 256, 100, drawArt, 0.35));
    art.position.z = 0.65;
    f.add(art);
    g.add(f);
  }
  if (r.screen.mount === "wall") {
    const s = r.screen, dir = DIR[s.facing];
    const felt = new THREE.Group();
    // the TV's unit origin is 2 in front of the wall: these panels sit ON the wall, behind the bracket
    felt.position.set(s.x - dir.x * 2, 0, s.z - dir.z * 2);
    felt.rotation.y = faceY(s.facing);
    felt.add(rbox(Math.min(s.w * 0.75 + 4, 50) + 18, 36, 0.8, mat(r.upholstery === "cognac" ? "mfStone" : "mfCharcoal", 0.98), 0, 9, 1.3, 0.3));
    // THE EXECUTIVE ROOMS (large, project, boardroom) carry a full walnut feature wall behind the display,
    // with a satin reveal at its top; the standard rooms keep the plaster and the felt alone
    if (r.kind === "large" || r.kind === "project" || r.kind === "boardroom") {
      const span = r.rect.d - 36;
      felt.add(rbox(span, 40, 0.8, mat("walnut", 0.5), 0, 2, 0.4, 0.2));
      felt.add(rbox(span, 0.5, 1, capM(), 0, 42, 0.5, 0.1));
      for (let k = -span / 2 + 20; k < span / 2 - 10; k += 40) felt.add(rbox(0.5, 40, 0.3, mat("walnutDark", 0.6), k, 2, 0.95, 0.1));
    }
    g.add(felt);
  }
}
function drawArt(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const grd = ctx.createLinearGradient(0, 0, w, h);
  grd.addColorStop(0, "#e8e1d6"); grd.addColorStop(1, "#cfc3b2");
  ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "rgba(154,100,64,0.75)"; ctx.beginPath(); ctx.arc(w * 0.34, h * 0.55, h * 0.28, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(58,60,65,0.8)"; ctx.fillRect(w * 0.52, h * 0.2, w * 0.28, h * 0.6);
  ctx.fillStyle = "rgba(111,118,70,0.7)"; ctx.fillRect(w * 0.12, h * 0.78, w * 0.7, h * 0.05);
}

function arrival(g: THREE.Group): void {
  // NO FLOOR RING AT THE LIFT: the axis runner already starts at the doors, and the island's inlay is the
  // floor's one circle. The arrival reads by light alone — a soft warm pool in front of the lift.
  const a = COMMONS.arrival;
  const arrivalLight = new THREE.Mesh(new THREE.CircleGeometry(48, 48), glowMat("coveWarm", 0.06));
  arrivalLight.rotation.x = -Math.PI / 2;
  arrivalLight.position.set(a.x, POOL_MIN_Y, a.z);
  g.add(shadowed(arrivalLight, false, false));
  const d = COMMONS.directory;
  contact(g, { x: d.x - 16, z: d.z - 16, w: 32, d: 32 }, 0.04, 0.22, true);
  const totem = new THREE.Group();
  totem.position.set(d.x, 0, d.z);
  totem.rotation.y = Math.atan2(d.facing.x, d.facing.z);
  totem.add(rbox(28, 3, 8, frameM(), 0, FLOOR, 0, 0.6));
  totem.add(rbox(26, 40, 4, mat("walnut", 0.5), 0, 2, 0, 0.8));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(22, 34), uiScreenMat("mf-directory", 220, 340, drawDirectory, 0.8));
  face.position.set(0, 24, 2.05);
  totem.add(face);
  g.add(totem);
}

// ============================= THE FLOOR ========================================================

export interface MeetingFloorRoomViews { leaf: THREE.Group; display: RoomDisplayView; sign: RoomSignView }
export interface MeetingFloorBuild { group: THREE.Group; rooms: Map<string, MeetingFloorRoomViews>; draws: number; blades: number }

export function buildMeetingFloor(): MeetingFloorBuild {
  const root = new THREE.Group();
  root.name = "meeting-floor";
  const g = new THREE.Group();
  const flora = new THREE.Group();
  const live = new THREE.Group();
  live.name = "meeting-floor-live";
  const rooms = new Map<string, MeetingFloorRoomViews>();

  // ---- floors: stone runners on the streets and the axis; every room on its own tile, a threshold proud
  const runnerM = mat("mfRunner", 0.3, { metalness: 0.02 });
  for (const r of RUNNERS) {
    const m = rbox(r.w, 0.13, r.d, runnerM, r.x + r.w / 2, -0.05, r.z + r.d / 2, 0);
    m.castShadow = false;
    g.add(m);
    // a fine bronze inlay each side of every runner
    for (const s of [0, 1]) {
      const inl = r.w > r.d ? rbox(r.w, 0.16, 0.8, bronzeM(), r.x + r.w / 2, -0.05, r.z + s * r.d, 0) : rbox(0.8, 0.16, r.d, bronzeM(), r.x + s * r.w, -0.05, r.z + r.d / 2, 0);
      inl.castShadow = false;
      g.add(inl);
    }
  }
  for (const r of MEETING_ROOMS) g.add(tiledFloor(r.interior, 0.9, r.finish === "graphite" ? "mfFloorGraphite" : "mfFloorStone"));

  // ---- architecture ----------------------------------------------------------------------------------
  for (const p of PIERS) pier(g, p, p.z < 600 ? 1 : -1);
  for (const run of GLASS_RUNS) glassRun(g, run);
  for (const r of MEETING_ROOMS) {
    table(g, r);
    roomLights(g, r);
    if (r.corner) {
      const t = r.corner.table;
      g.add(cyl(t.w / 2, 1.4, mat("walnut", 0.45), t.x + t.w / 2, 15, t.z + t.d / 2));
      g.add(cyl(1, 15, frameM(), t.x + t.w / 2, 0, t.z + t.d / 2));
      pendant(g, t.x + t.w / 2, t.z + t.d / 2, 0.07, 4, 40);
    }
    for (const p of r.plants ?? []) flora.add(plantFor(p, []));
    const { leaf, track } = doorLeaf(r);
    live.add(leaf);
    g.add(track);
    const disp = display(r, g);
    live.add(disp.group);
    rooms.set(r.id, { leaf, display: disp, sign: signs(r, live) });
  }

  // ---- the Commons, the café, the pockets --------------------------------------------------------------
  // THE COMMONS IS AUTHORED ON ITS OWN FLOOR: everything below stands on the hall tile, not at 0
  const cg = new THREE.Group();
  cg.position.y = FLOOR;
  g.add(cg);
  for (const a of AMENITIES) amenity(cg, flora, a);
  commonsBeams(cg);
  live.add(island(g, flora));
  for (const r of MEETING_ROOMS) roomDetails(g, r);
  arrival(g);
  // the axis: a pool of warm light every bay, so the route reads lit from the lift to the boardroom door
  for (let x = 6180; x <= 7080; x += 150) if (Math.abs(x - ISLAND.c.x) > ISLAND.inlayR + 30) pool(g, { x: x - 40, z: 622 - 40, w: 80, d: 80 }, POOL_Y, 0.06);

  // ---- bake -----------------------------------------------------------------------------------------
  g.add(flora);
  root.add(g);
  root.updateMatrixWorld(true);
  const blades = new FoliageSystem(new SwaySystem()).collect("meeting-floor", flora);
  const loose: THREE.Mesh[] = [];
  g.traverse((o) => { if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh)) loose.push(o); });
  // BAKE CASTERS AND NON-CASTERS SEPARATELY. Baker merges per material and makes the merged mesh a caster
  // if ANY part casts — so the flat stone runners, which share a material with the (casting) island inlay,
  // were baked into a caster lying on the floor. A floor-level caster self-shadows the tile in shadow-map
  // texel blocks, and those blocks slide as the shadow frustum follows the Office View zoom: the stripes
  // that changed with every zoom step. Anything flat at floor level never casts.
  const casters = new Baker(), others = new Baker();
  const flat = new THREE.Group();
  flat.name = "meeting-floor-baked";
  root.add(flat);
  const box = new THREE.Box3();
  for (const m of loose) {
    flat.attach(m);
    box.setFromObject(m);
    if (box.max.y - box.min.y < 1.5 && box.max.y < 2) m.castShadow = false;
    (m.castShadow ? casters : others).add(m);
  }
  for (const m of loose) flat.remove(m);
  const draws = casters.bakeInto(flat, "meeting-floor-cast") + others.bakeInto(flat, "meeting-floor-flat");
  // THE FLOOR OVERLAY STACK, the ground floor's own (render/floorLayers): contact shadows are pinned under
  // the additive pools regardless of camera, where SceneMirror does it per room — this plate is not a room.
  applyFloorLayerOrder(root);
  root.add(live);
  return { group: root, rooms, draws, blades };
}
