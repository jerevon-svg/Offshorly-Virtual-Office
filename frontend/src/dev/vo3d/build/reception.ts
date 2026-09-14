// vo3d build — RECEPTION static geometry, built in WORLD coordinates.
//
// 3B architecture: tiled floor, north glass balustrade, 4 speed-gate pedestals + bollard, south glass
// curtain wall, central double entry door, façade kerb.
// 3C primary forms: the HERO arc counter, the kiosk totem and the two flanking planter cylinders.
// (Lounge furniture is entity-driven — see rooms/reception.ts receptionEntities.)
//
// `glassRun`/`subtract` have moved to build/frontbar.ts now that Meeting and Project ask for the same
// continuous façade; Reception's calls and its output are unchanged.
import * as THREE from "three";
import { rbox, cyl } from "./helpers";
import { tiledFloor } from "./tile";
import { contactShadowMat, emissiveMat, emissiveMatUnique, glowMat, glowMatUnique, mat, metal, plastic, uiScreenMat, PALETTE } from "../render/Materials";
import { monitor, mug, smallPot } from "./props";
import type { RoomDef } from "../world/WorldState";
import { COUNTER, ENTRY_DOOR_Z, ENTRY_LEAF_W, ENTRY_SCANNER_ID, FACADE, GATE, GATE_SCANNER_IDS, KIOSK, LOGO_AREA, PLANTERS, RECT, STRUCT, TILE_RECT } from "../rooms/reception";
import { offshorlyInlay } from "./logo";
import { glassRun, subtract } from "./frontbar";
import { animated } from "../render/Ambient";
import { arcWall, flatRing, ringShape } from "./arc";

/** The scanner colour language, shared by the gates and the entrance sensors.
 *  IDLE = blue/cyan (powered, waiting). ACTIVE = green (person detected / access approved). */
const SCANNER_TINT = { idle: PALETTE.cyan, active: PALETTE.readyGreen };

/** One speed-gate pedestal, POWERED and visibly idling.
 *  Sizing note: at the normal game camera the whole room is ~2 px per world unit, so the 3D pass's 2.6-unit
 *  strip and 0.8-unit ring were a couple of pixels across and their brightness-only breathing was invisible.
 *  What reads at that distance is AREA and CONTRAST, so the status light is now a wide top-plate band plus a
 *  large additive halo whose OPACITY breathes — both sized to the pedestal's top face, which is the face the
 *  game camera actually sees. */
export function speedGate(cx: number, index = 0): THREE.Group {
  const g = new THREE.Group();
  g.name = `speed-gate:${cx}`;
  const { w, d, h, zCentre } = GATE.pedestal;
  const z0 = zCentre - d / 2;
  const group = GATE_SCANNER_IDS[index] ?? `gate-${index}`;
  // deterministic per-gate offsets: the four gates breathe together but never in lockstep
  const ph = (index * 0.27) % 1;
  const body = mat("charcoal", 0.5, { metalness: 0.15 });
  g.add(rbox(w, h, d, body, cx, 0, zCentre, 1.6));
  g.add(rbox(w - 2, 0.8, d - 2.4, mat("charcoal", 0.3, { metalness: 0.25 }), cx, h, zCentre, 0.3)); // brushed top plate

  // reader / sensor surface at the north end, with a breathing wash over it
  const reader = rbox(w - 4.4, 0.7, 13, uiScreenMat("gate-reader", 64, 96, drawGateReader, 1.1, true), cx, h + 0.8, z0 + 10.5, 0.25);
  reader.rotation.x = 0.12;
  g.add(animated(reader, { kind: "pulse", period: 4.6, phase: ph, min: 0.72, max: 1.12, group, activeGain: 0.5 }));
  g.add(rbox(w - 3.2, 0.4, 14.5, metal(), cx, h + 0.5, z0 + 10.5, 0.2)); // reader bezel
  g.add(animated(rbox(w - 3.6, 0.05, 13.5, glowMatUnique("cyan", 0.2), cx, h + 1.3, z0 + 10.5, 0.2), {
    kind: "fade", period: 4.6, phase: ph, min: 0.07, max: 0.22, group, tint: SCANNER_TINT, activeGain: 0.8,
  }));

  // the main status band: a wide lit strip down the top plate + a large soft halo above it
  const bandZ = z0 + d - 16, bandL = d - 30;
  g.add(animated(rbox(6, 0.5, bandL, emissiveMatUnique("cyan", 1.6, 0.3), cx, h + 0.82, bandZ, 0.25), {
    kind: "pulse", period: 4.6, phase: ph, min: 0.34, max: 0.78, group, tint: SCANNER_TINT, activeGain: 0.7,
  }));
  g.add(animated(rbox(w - 1.5, 0.05, bandL + 10, glowMatUnique("cyan", 0.25), cx, h + 1.35, bandZ, 0.3), {
    kind: "fade", period: 4.6, phase: (ph + 0.08) % 1, min: 0.07, max: 0.24, group, tint: SCANNER_TINT, activeGain: 0.8,
  }));
  // a bright segment travelling the length of the band — the visible "scanning" motion
  // NB: must sit ABOVE the band's top face (band base h+0.82, 0.5 tall) or the sweep is buried inside it
  g.add(animated(rbox(5.6, 0.3, 7.5, emissiveMatUnique("cyan", 0, 0.25), cx, h + 1.36, 0, 0.2), {
    kind: "travel", axis: "z", from: bandZ - bandL / 2 + 4, to: bandZ + bandL / 2 - 4, period: 4.4,
    phase: (index * 0.33) % 1, fade: { min: 0, max: 1.9 }, group, tint: SCANNER_TINT, activeGain: 0.5,
  }));
  // lane-facing light lines on both long faces: what someone walking the lane sees at eye level
  for (const side of [-1, 1])
    g.add(animated(rbox(0.7, 1.6, d - 26, emissiveMatUnique("cyan", 1.3, 0.3), cx + side * (w / 2 - 0.1), h * 0.6, zCentre + 3, 0.2), {
      kind: "pulse", period: 6.2, phase: (ph + 0.5) % 1, min: 0.5, max: 1.05, group, tint: SCANNER_TINT, activeGain: 0.8,
    }));
  // status indicator at the south end — BLUE while idle, GREEN only on detection (no always-green READY)
  // 0.64 tall, not 0.5: at 0.5 its top face landed on the status band's top plane where the two overlap
  g.add(animated(cyl(1.7, 0.64, emissiveMatUnique("cyan", 1.6, 0.3), cx, h + 0.82, z0 + d - 4.2), {
    kind: "pulse", period: 3.4, phase: (index * 0.19) % 1, min: 0.45, max: 1.15, group, tint: SCANNER_TINT, activeGain: 0.9,
  }));
  return g;
}

function drawGateReader(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const grd = ctx.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, "#0e2740");
  grd.addColorStop(1, "#164a6e");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(111,216,255,0.9)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(w / 2, h * 0.42, w * 0.22, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "rgba(111,216,255,0.85)";
  ctx.beginPath(); // small "tap" chevron
  ctx.moveTo(w * 0.42, h * 0.66); ctx.lineTo(w * 0.5, h * 0.74); ctx.lineTo(w * 0.58, h * 0.66);
  ctx.lineTo(w * 0.5, h * 0.7); ctx.closePath(); ctx.fill();
  ctx.fillRect(w * 0.3, h * 0.84, w * 0.4, 3);
}

/** The AUTOMATIC ENTRANCE's fixed parts: the threshold and head tracks the two panels run on, and the
 *  pilaster access sensors. The moving panels themselves are entities (rooms/reception.ts) so the shared
 *  SlidingDoor controller can carry them — see interact/Door.ts. */
export function entryDoors(): THREE.Group {
  const g = new THREE.Group();
  g.name = "reception-entry-doors";
  const z = FACADE.z + STRUCT.wallThickness / 2;
  const { x0, x1 } = FACADE.door;
  const mid = (x0 + x1) / 2, leafW = (x1 - x0) / 2, h = STRUCT.wallHeight;
  void leafW;
  // flush threshold track across the opening (the kerb is cut here, so the panels need their own sill)
  const sill = rbox(x1 - x0 + 8, 1.8, 4.2, metal(), mid, 0, ENTRY_DOOR_Z, 0.3);
  sill.castShadow = false;
  g.add(sill);
  // head track: the carriage rail the panels hang from, long enough to cover both parked positions
  g.add(rbox(x1 - x0 + 2 * ENTRY_LEAF_W + 16, 2.6, 4.6, metal(), mid, h - 2.8, ENTRY_DOOR_Z, 0.4));
  // access sensors on the two pilasters' inner faces at hand height: a small metal puck with a lit ring
  // ---- entrance access sensors: same BLUE-idle / GREEN-detected language as the gates -----------------
  // The pilaster TOP face is what the game camera sees, so the primary indicator lives there; the face-
  // mounted pucks and the sweeping scan bar are what a person standing at the door sees.
  let sensor = 0;
  for (const side of [-1, 1]) {
    const px = mid + side * (leafW + FACADE.pilasterW / 2 + 0.2);
    const ph = (side < 0 ? 0 : 0.31);
    // top-of-post status band + halo — the part that reads from across the room
    g.add(animated(rbox(FACADE.pilasterW - 2.4, 0.5, 4.4, emissiveMatUnique("cyan", 1.6, 0.3), px, h, z, 0.2), {
      kind: "pulse", period: 5.2, phase: ph, min: 0.4, max: 0.95, group: ENTRY_SCANNER_ID, tint: SCANNER_TINT, activeGain: 0.9,
    }));
    g.add(animated(rbox(FACADE.pilasterW + 3, 0.05, 11, glowMatUnique("cyan", 0.25), px, h + 0.6, z, 0.3), {
      kind: "fade", period: 5.2, phase: (ph + 0.07) % 1, min: 0.08, max: 0.28, group: ENTRY_SCANNER_ID, tint: SCANNER_TINT, activeGain: 0.8,
    }));
    for (const face of [-1, 1]) {
      const zz = z + face * (STRUCT.wallThickness * 0.95 + 0.3);
      const puck = cyl(2.6, 0.5, metal(), px, 26, zz);
      puck.rotation.x = Math.PI / 2;
      g.add(puck);
      const ring = cyl(1.5, 0.35, emissiveMatUnique("cyan", 1.5, 0.3), px, 26, zz + face * 0.3);
      ring.rotation.x = Math.PI / 2;
      g.add(animated(ring, { kind: "pulse", period: 5.2, phase: (sensor * 0.23) % 1, min: 0.5, max: 1.15, group: ENTRY_SCANNER_ID, tint: SCANNER_TINT, activeGain: 0.9 }));
      // a soft scanning bar sweeping the pilaster face
      const scan = rbox(FACADE.pilasterW * 0.8, 1.4, 0.3, emissiveMatUnique("cyan", 0, 0.28), px, 0, zz + face * 0.4, 0.15);
      g.add(animated(scan, {
        kind: "travel", axis: "y", from: 9, to: 34, period: 7.5, phase: (sensor * 0.37) % 1,
        fade: { min: 0, max: 1.7 }, group: ENTRY_SCANNER_ID, tint: SCANNER_TINT, activeGain: 0.5,
      }));
      sensor++;
    }
  }
  return g;
}

// ---- 3C primary forms ---------------------------------------------------------------------------

/** THE HERO — the arc reception counter. Concave to the NORTH: staff stand inside the pocket the V1 grid
 *  leaves open (rows 59–63), visitors approach the convex south face. Cross-section, outside → in:
 *      recessed toe-kick (r 165, 0…4.5)   — structural cove, emissive treatment comes in 3D
 *      bronze fascia     (r 173, 4.5…24)  — battered 3 units so the toe reads as a shadow gap
 *      white worktop     (r 144…176, 24…27) — overhangs the fascia by 3 for a crisp shadow line
 *      white staff panel (r 144, 0…24)    — the inner return
 *  Every radius is measured; see COUNTER in rooms/reception.ts. */
export function arcCounter(): THREE.Group {
  const g = new THREE.Group();
  g.name = "reception-arc-counter";
  const { centre, innerR, outerR, fasciaR, toeR, toeH, topY, topT, halfAngleDeg } = COUNTER;
  const half = (halfAngleDeg * Math.PI) / 180;
  const a0 = Math.PI / 2 - half, a1 = Math.PI / 2 + half; // centred on due south (+z)
  const topBase = topY - topT;

  // toe-kick: dark recess carrying the warm LED cove. The light itself is the thin emissive line at the top of
  // the recess; the two additive floor rings fake its spill without a real light (cheap, deterministic).
  g.add(arcWall(toeR - 2, toeR, toeH, 0, mat("bronzeDark", 0.8), a0, a1, centre.x, centre.z));
  // the LED itself: a bright warm line along the top of the recess …
  g.add(arcWall(toeR + 0.2, toeR + 0.4, 0.9, toeH - 1.1, emissiveMat("coveWarm", 2.6, 0.4), a0, a1, centre.x, centre.z));
  // … and its escape under the battered fascia: a warm lit lip at floor level just outside the fascia foot
  g.add(arcWall(fasciaR - 3.2, fasciaR - 2.6, 1.3, 0.05, emissiveMat("coveWarm", 2.4, 0.5), a0, a1, centre.x, centre.z));
  // floor spill OUTSIDE the fascia (anything inside r ≈ 173 is hidden under the counter from every camera):
  // three additive rings falling off with radius. Restrained warm wash, not neon.
  // one notch up from 3D: the hero still reads first at game pitch without becoming a light source
  for (const [r1, op] of [[fasciaR + 9, 0.42], [fasciaR + 19, 0.21], [fasciaR + 34, 0.09]] as const) {
    const spill = flatRing(ringShape(centre.x, centre.z, fasciaR - 3.4, r1, a0, a1), 0.04, glowMat("coveWarm", op), 0.05);
    spill.castShadow = spill.receiveShadow = false;
    g.add(spill);
  }
  // champagne/bronze fascia — brushed metal, battered 3 units
  g.add(arcWall(fasciaR - 3, fasciaR, topBase - toeH, toeH, mat("bronze", 0.36, { metalness: 0.55, envMapIntensity: 1.2 }), a0, a1, centre.x, centre.z));
  // fascia wash: the fascia's lower band catches the cove
  g.add(arcWall(fasciaR - 2.9, fasciaR + 0.05, 3.2, toeH, glowMat("coveWarm", 0.13), a0, a1, centre.x, centre.z));
  g.add(arcWall(innerR, innerR, topBase, 0, plastic("white"), a0, a1, centre.x, centre.z)); // staff-side return
  // end caps close the two tips
  for (const a of [a0, a1]) {
    const cs = Math.cos(a), sn = Math.sin(a);
    const cap = rbox(outerR - innerR, topBase, 2.4, plastic("white"), centre.x + cs * (innerR + outerR) / 2, 0, centre.z + sn * (innerR + outerR) / 2, 0.5);
    cap.rotation.y = -a; // rbox local +x → (cos a, −sin a) in world x/z, so −a points it radially
    g.add(cap);
  }
  // worktop: one extruded annulus, white solid surface
  // worktop: solid-surface white with a slight sheen, and a thin champagne edge trim under the overhang
  g.add(flatRing(ringShape(centre.x, centre.z, innerR, outerR, a0, a1), topT, mat("white", 0.3, { metalness: 0.02 }), topBase));
  g.add(arcWall(outerR - 0.6, outerR - 0.4, 1.0, topBase - 1.0, mat("bronze", 0.4, { metalness: 0.5 }), a0, a1, centre.x, centre.z));
  g.add(counterProps());
  return g;
}

/** Everything that sits ON the worktop, placed in polar coordinates (r from the arc centre, angle from due
 *  south, + = east) so it always lands on the curved top. Positions are measured off the artwork:
 *  two monitors (centre ≈ 2°, right ≈ 42°), five succulents, two mugs and a tray. Monitors face the staff. */
function counterProps(): THREE.Group {
  const g = new THREE.Group();
  g.name = "counter-props";
  const { centre, innerR, outerR, topY } = COUNTER;
  const midR = (innerR + outerR) / 2;
  const at = (deg: number, r: number) => {
    const t = (deg * Math.PI) / 180;
    return { x: centre.x + Math.sin(t) * r, z: centre.z + Math.cos(t) * r, yaw: Math.PI - t }; // yaw: local −z → toward the centre
  };
  const place = (deg: number, r: number, build: (yaw: number) => THREE.Object3D) => {
    const p = at(deg, r);
    const o = build(p.yaw);
    o.position.set(p.x, topY, p.z);
    g.add(o);
  };
  // workstations: monitor toward the visitor edge, keyboard + mouse toward the staff edge
  for (const [deg, ui] of [[2, "monitor-a"], [42, "monitor-b"]] as const) {
    place(deg, midR + 4, (yaw) => {
      const ws = new THREE.Group();
      ws.rotation.y = yaw;
      ws.add(poweredMonitor(ui));
      ws.add(rbox(11, 0.7, 4, mat("charcoal", 0.6), 0, 0, -8.5, 0.25)); // keyboard on the staff side
      ws.add(rbox(8.5, 0.12, 2.6, mat("metal", 0.5), 0, 0.7, -8.5, 0.1)); // keycap field
      ws.add(rbox(1.9, 0.9, 3, plastic("white"), 7.2, 0, -8, 0.6)); // mouse
      return ws;
    });
  }
  // succulents — instanced later by finalizeSucculents()
  for (const [deg, r, size] of [[-52, midR - 2, 2.8], [-38, midR + 1, 2.4], [-31, midR - 3, 2.1], [17, midR + 2, 2.4], [24, midR - 1, 2.0]] as const) {
    place(deg, r, () => smallPot(0, 0, 0, size));
  }
  // mugs + a small tray with a dish, staff side
  place(-12, midR - 7, () => mug(0, 0, 0));
  place(31, midR - 6, () => mug(0, 0, 0));
  place(-25, midR + 6, () => {
    const tray = new THREE.Group();
    tray.add(rbox(7, 0.5, 4.5, mat("bronze", 0.45, { metalness: 0.5 }), 0, 0, 0, 0.3));
    tray.add(cyl(1.6, 0.4, plastic("white"), -1.6, 0.5, 0));
    tray.add(cyl(1.1, 0.7, plastic("white"), 1.8, 0.5, 0.3));
    return tray;
  });
  return g;
}

/** Monitor from props.ts with a lit UI on its screen instead of the flat screenMat. */
function poweredMonitor(ui: "monitor-a" | "monitor-b"): THREE.Group {
  const m = monitor(0, 0, 0, 15, 8.5);
  // props.monitor() adds the screen last; swap its material for the powered UI (same geometry)
  const screen = m.children[m.children.length - 1] as THREE.Mesh;
  screen.material = uiScreenMat(ui, 160, 90, ui === "monitor-a" ? drawFrontDeskUi : drawCalendarUi, 0.85, true);
  // powered, not animated for attention: a barely perceptible luminance drift, nothing moving
  animated(screen, { kind: "pulse", period: ui === "monitor-a" ? 9.2 : 11.4, phase: ui === "monitor-a" ? 0.2 : 0.65, min: 0.8, max: 0.92 });
  // one small status dot beside the screen that gently brightens — the only visible "activity"
  m.add(animated(cyl(0.32, 0.12, emissiveMatUnique("readyGreen", 1.0, 0.3), -6.4, 8.3, 0.1), {
    kind: "pulse", period: 5.6, phase: ui === "monitor-a" ? 0.05 : 0.55, min: 0.5, max: 1.25,
  }));
  return m;
}
function drawFrontDeskUi(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = "#eef1f6"; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#14213a"; ctx.fillRect(0, 0, w, 12);
  ctx.fillStyle = "#6fbf5a"; ctx.beginPath(); ctx.arc(9, 6, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#ffffff"; ctx.fillRect(8, 18, w - 16, 16); ctx.fillRect(8, 40, (w - 16) * 0.62, 12); ctx.fillRect(8, 56, (w - 16) * 0.62, 12);
  ctx.fillStyle = "#3f8fe0"; ctx.fillRect(w - 46, 40, 38, 28);
  ctx.fillStyle = "#c7cdd8";
  ctx.fillRect(12, 22, 60, 2); ctx.fillRect(12, 27, 44, 2); // header lines
  ctx.fillRect(12, 44, 40, 2); ctx.fillRect(12, 60, 52, 2);
}
function drawCalendarUi(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = "#f4f6fa"; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#14213a"; ctx.fillRect(0, 0, w, 12);
  ctx.fillStyle = "#dfe4ec";
  for (let c = 0; c < 5; c++) ctx.fillRect(8 + c * 30, 18, 26, h - 26);
  const blocks: [number, number, number, string][] = [[0, 26, 18, "#6fbf5a"], [1, 40, 14, "#3f8fe0"], [2, 22, 26, "#3f8fe0"], [3, 52, 16, "#6fbf5a"], [4, 30, 22, "#e0a13f"]];
  for (const [c, y, hh, col] of blocks) { ctx.fillStyle = col; ctx.fillRect(10 + c * 30, y, 22, hh); }
}

/** Dark wayfinding/check-in totem west of the counter, POWERED: brushed bezel, lit welcome UI, soft wash. */
export type KioskSpec = { x: number; z: number; w: number; d: number; h: number };
/** The dark screened totem. Defaults to Reception's own kiosk, so `kioskTotem()` is byte-identical to what
 *  3C built; Meeting passes its own footprint, screen id and UI painter for the self-service terminal the
 *  artwork puts on its east side (same object family, no duplicated builder). */
export function kioskTotem(spec: KioskSpec = KIOSK, opts: { name?: string; uiId?: string; draw?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; scanner?: string } = {}): THREE.Group {
  const g = new THREE.Group();
  g.name = opts.name ?? "reception-kiosk";
  const { x, z, w, d, h } = spec;
  g.add(rbox(w, h, d, mat("charcoal", 0.5, { metalness: 0.2 }), x, 0, z, 2));
  g.add(rbox(w - 2.4, 1.0, d - 2.4, mat("charcoal", 0.3, { metalness: 0.3 }), x, h, z, 0.6)); // top plate
  // screen sits in a brushed metal bezel, tilted a touch toward the visitor (south)
  const sw = w - 8, sd = d * 0.5;
  const bezel = rbox(sw + 2.2, 0.6, sd + 2.2, metal(), x, h + 1.0, z - d * 0.1, 0.4);
  g.add(bezel);
  // the panel itself breathes very slightly (screen luminance), so it never reads as a static picture
  const screen = rbox(sw, 0.5, sd, uiScreenMat(opts.uiId ?? "kiosk-ui", 128, 224, opts.draw ?? drawKioskUi, 1.0, true), x, h + 1.45, z - d * 0.1, 0.25);
  const scan = opts.scanner;
  g.add(animated(screen, { kind: "pulse", period: 7.5, phase: 0.1, min: 0.93, max: 1.08, ...(scan ? { group: scan, activeGain: 0.35 } : {}) }));
  // a gentle highlight sweeping down the glass — the "waiting for interaction" tell
  const zTop = z - d * 0.1 - sd / 2, zBot = z - d * 0.1 + sd / 2;
  g.add(animated(rbox(sw - 2, 0.12, 3.4, emissiveMatUnique("cyan", 0, 0.25), x, h + 1.72, 0, 0.12), {
    kind: "travel", axis: "z", from: zTop + 2, to: zBot - 2, period: 6.8, phase: 0.0, fade: { min: 0, max: 0.55 },
    ...(scan ? { group: scan, tint: SCANNER_TINT, activeGain: 0.6 } : {}),
  }));
  // the primary action tile softly pulses (it sits over the blue tile drawn in the UI canvas)
  g.add(animated(rbox(sw * 0.7, 0.1, sd * 0.13, emissiveMatUnique("cyan", 0, 0.3), x, h + 1.7, z - d * 0.1 + sd * 0.12, 0.1), {
    kind: "pulse", period: 2.9, phase: 0.35, min: 0.14, max: 0.5,
    ...(scan ? { group: scan, tint: SCANNER_TINT, activeGain: 0.7 } : {}),
  }));
  // subtle screen wash on the totem top and the floor just south of it
  const wash = rbox(sw + 6, 0.05, sd + 8, glowMat("cyan", 0.06), x, h + 1.05, z - d * 0.1, 0.2);
  wash.castShadow = wash.receiveShadow = false;
  g.add(wash);
  g.add(rbox(w - 6, 1.4, 3, mat("charcoal", 0.8), x, 0.4, z + d / 2 - 2, 0.4)); // base reveal
  // power/status LED on the south face: a slow, barely-there activity breath. A kiosk wired to a scanner
  // idles BLUE and turns green only on detection (the gate/entrance language); Reception's own kiosk has
  // no scanner and keeps its steady green power light exactly as 3D built it.
  g.add(animated(rbox(w - 12, 0.4, 0.5, emissiveMatUnique(scan ? "cyan" : "readyGreen", 1.2, 0.3), x, 4, z + d / 2 + 0.05, 0.15), {
    kind: "pulse", period: 4.1, phase: 0.6, min: 0.85, max: 1.45,
    ...(scan ? { group: scan, tint: SCANNER_TINT, activeGain: 0.6 } : {}),
  }));
  return g;
}
function drawKioskUi(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const grd = ctx.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, "#182a4a"); grd.addColorStop(1, "#0f1c33");
  ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h);
  // ring mark (the company's green rings, abstracted — no legible text required)
  ctx.strokeStyle = "#6fcf5a"; ctx.lineWidth = 9;
  ctx.beginPath(); ctx.arc(w * 0.42, h * 0.22, 17, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(w * 0.62, h * 0.15, 7, 0, Math.PI * 2); ctx.stroke();
  // welcome line + two soft action tiles
  ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.fillRect(w * 0.16, h * 0.38, w * 0.68, 9);
  ctx.fillStyle = "rgba(255,255,255,0.45)"; ctx.fillRect(w * 0.24, h * 0.45, w * 0.52, 5);
  ctx.fillStyle = "#3f8fe0"; ctx.fillRect(w * 0.14, h * 0.56, w * 0.72, h * 0.13);
  ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.fillRect(w * 0.14, h * 0.73, w * 0.72, h * 0.13);
  ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.fillRect(w * 0.24, h * 0.61, w * 0.3, 4); ctx.fillRect(w * 0.24, h * 0.78, w * 0.4, 4);
}

/** The two tall cylindrical planters flanking the arc. The plants themselves are entities that sit on
 *  top of these pots (rooms/reception.ts), so they sway and can later be edited. */
export function planters(): THREE.Group {
  const g = new THREE.Group();
  g.name = "reception-planters";
  for (const p of PLANTERS) {
    // the pot stops 0.2 short of the rim's top plane — a full-disc coplanar pair at y = p.h z-fights the
    // whole mouth of the planter. The face is buried inside the rim, so nothing about the pot changes.
    g.add(cyl(p.r, p.h - 0.2, mat("potDark", 0.55, { metalness: 0.08 }), p.x, 0, p.z, p.r * 0.94)); // slight taper
    g.add(cyl(p.r + 0.6, 1.4, mat("charcoal", 0.5, { metalness: 0.2 }), p.x, p.h - 1.4, p.z)); // rolled rim
    g.add(cyl(p.r - 1.4, 1.0, mat("potDark", 1), p.x, p.h - 0.6, p.z)); // dark soil
    const shadow = cyl(p.r + 5, 0.02, contactShadowMat(0.14, "round"), p.x, 0.04, p.z);
    shadow.castShadow = shadow.receiveShadow = false;
    g.add(shadow);
  }
  return g;
}

/** Everything Reception owns structurally in 3B. World space; the mirror adds it as-is.
 *  Builds NO east or west boundary — the artwork has none and the only nearby wall belongs to Meeting. */
export function receptionStatic(_room: RoomDef): THREE.Group {
  const g = new THREE.Group();
  g.name = "static:reception-room";
  const T = STRUCT.wallThickness;
  const xEast = RECT.x + RECT.w;

  g.add(tiledFloor(TILE_RECT));

  // ---- north: glass balustrade either side of the gate cluster, gate lanes left clear ----------------
  const balustrade = (x0: number, x1: number) =>
    glassRun({ z: GATE.z, x0, x1, t: T * 0.5, h: STRUCT.railHeight, sill: 2.2, panelPitch: GATE.panelPitch, topRail: true, pilasters: [x0 + (x1 - x0) / 2], pilasterW: 10 });
  // (the balustrade reads from above via its capping rail + shoe; the pane itself is nearly edge-on)
  g.add(balustrade(RECT.x, GATE.glassEnd.west));
  g.add(balustrade(GATE.glassEnd.east, xEast));
  GATE.pedestals.forEach((cx, i) => g.add(speedGate(cx, i)));
  g.add(cyl(GATE.bollard.r, GATE.bollard.h, metal(), GATE.bollard.x, 0, GATE.pedestal.zCentre));

  // ---- south: full-height street façade on the SHARED plane, door span left clear --------------------
  g.add(
    glassRun({
      z: FACADE.z + T / 2,
      x0: RECT.x,
      x1: xEast,
      t: T,
      h: STRUCT.wallHeight,
      sill: 2.6,
      panelPitch: FACADE.panelPitch,
      topRail: true,
      pilasters: [FACADE.door.x0 - FACADE.pilasterW / 2, FACADE.door.x1 + FACADE.pilasterW / 2],
      pilasterW: FACADE.pilasterW,
      openings: [FACADE.door],
    }),
  );
  g.add(entryDoors());
  // exterior kerb along the façade base (the art's grey plinth), CUT at the doorway so the threshold stays
  // flush. The shared front ledge beyond it is ground-floor architecture, built once in build/floorplan.ts
  // for the whole bar.
  for (const k of subtract(RECT.x, xEast, [FACADE.door])) {
    const kerb = rbox(k.x1 - k.x0, 2.2, 5, mat("plinth", 1), (k.x0 + k.x1) / 2, -0.6, FACADE.z + T + 2.5, 0.4);
    kerb.castShadow = false;
    g.add(kerb);
  }

  // ---- 3C primary forms ------------------------------------------------------------------------
  // the brand floor inlay sits in the staff pocket, north of the counter and clear of it
  g.add(offshorlyInlay({ area: LOGO_AREA }));
  g.add(arcCounter());
  g.add(kioskTotem());
  g.add(planters());
  return g;
}
