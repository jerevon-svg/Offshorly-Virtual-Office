// vo3d build — CENTRAL HUB static geometry, built in WORLD coordinates.
//
// Phase 6B. Everything the hub owns that is NOT an entity: the floor plate and its brass outline, the
// medallion inlay, the four bench/planter arcs with their warm cove, the west pantry run with its
// appliances, and the east library run with its planter boxes.
//
// The room has NO WALLS, so this file builds no shell, no glass and no door — the source plan has none,
// and inventing any would be the exact 4B mistake 4C had to undo. It DOES build the floor: the moment a
// room flips to `reconstructed`, build/floorplan.ts stops drawing its placeholder plate.
//
// Lighting discipline: one warm channel (THEME.cove), at ankle height, under the two lower arcs and the
// counter toe-kick, plus two small appliance status dots. No second hue, no real THREE light. The Gaming
// Room's ~20 ambient channels are the thing this room must NOT be.
import * as THREE from "three";
import { Baker, cyl, rbox, shadowed } from "./helpers";
import { tagSurface } from "../editor/surfaces";
import { flatRing, polar, ringShape, shapeAngle } from "./arc";
import { tiledFloor } from "./tile";
import { plantFor } from "./plants";
import { book, smallPot } from "./props";
import { ledStrip } from "./led";
import { hubMonument } from "./hub-monument";
import { counterNosing, cupStack } from "./detail-props";
import { animated, powered } from "../render/Ambient";
import { contactShadowMat, emissiveMat, glowMat, mat, terrazzoMat, metal, plastic, type MatKey } from "../render/Materials";
import type { RoomDef } from "../world/WorldState";
import type { SwayNode } from "../render/Sway";
import {
  APPLIANCES, ARCS, COUNTER, COUNTER_PLANTERS, EAST_PLANTERS, ISLAND, NOTCH, OUTLINE_W, PLATE, RECT,
  SHELF_PLANTER, SHELF_RUN, THEME, type HubArc,
} from "../rooms/central-hub";

const key = (k: keyof typeof THEME): MatKey => THEME[k] as MatKey;
const stone = (rough = 0.85) => mat(key("shell"), rough);
const stoneDark = () => mat(key("shellDark"), 0.9);

// ---- floor plate --------------------------------------------------------------------------------
/** The plate outline as a THREE.Shape: a rounded rectangle with the north notch cut out of its top edge.
 *  `inset` shrinks it uniformly so the same path serves the plate body and its brass outline. */
function plateShape(inset: number): THREE.Shape {
  const x0 = PLATE.x + inset, x1 = PLATE.x + PLATE.w - inset;
  const z0 = PLATE.z + inset, z1 = PLATE.z + PLATE.d - inset;
  const r = Math.max(2, PLATE.radius - inset);
  // the notch is a CUT-OUT of the plate, so an inward inset makes it WIDER and DEEPER. (Getting this
  // sign wrong crosses the outline's outer path over its hole and fills the whole north edge solid.)
  const nx0 = NOTCH.x0 - inset, nx1 = NOTCH.x1 + inset, nz = NOTCH.z1 + inset;
  const s = new THREE.Shape();
  s.moveTo(x0 + r, z0);
  s.lineTo(nx0, z0); // north edge, west of the notch
  s.lineTo(nx0, nz); // down into the notch …
  s.lineTo(nx1, nz);
  s.lineTo(nx1, z0); // … and back up
  s.lineTo(x1 - r, z0);
  s.quadraticCurveTo(x1, z0, x1, z0 + r);
  s.lineTo(x1, z1 - r);
  s.quadraticCurveTo(x1, z1, x1 - r, z1);
  s.lineTo(x0 + r, z1);
  s.quadraticCurveTo(x0, z1, x0, z1 - r);
  s.lineTo(x0, z0 + r);
  s.quadraticCurveTo(x0, z0, x0 + r, z0);
  return s;
}

/** An extruded horizontal shape authored in WORLD x/z, exactly as build/arc.flatRing does it. */
function flatShape(shape: THREE.Shape, t: number, m: THREE.Material, y0: number, curveSegments = 16): THREE.Mesh {
  const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, y0 + t, 0);
  return shadowed(new THREE.Mesh(geo, m), false, true);
}

/** The plaza floor: the hall's own world-phased tile, so the grout runs unbroken into the corridors, and
 *  over it the plate — a pale terrazzo lip 0.35 proud with a brass outline. That outline is the ONLY
 *  thing that makes an unwalled room read as a defined place, which is why it is architecture and not
 *  decoration. */
function floorPlate(): THREE.Group {
  const g = new THREE.Group();
  g.name = "hub-floor";
  g.add(tiledFloor(RECT, undefined, undefined, { roomId: "central-hub", label: "Central Hub tile" }));
  // THE PLATE IS CAST TERRAZZO, not a fill. Its own colour is unchanged — hubTerrazzo still sets the tone —
  // but the aggregate map gives it the one thing a 15,000-unit plate of flat cream could never have: a
  // surface. The chips are sized in WORLD units (see terrazzoMat), so the plate reads at the same physical
  // scale as the tile joints running under it out in the hall.
  const plate = flatShape(plateShape(0), PLATE.lift, terrazzoMat(key("plate"), 0.5, 55), 0);
  // ROOM EDITOR: the hub's cast plate is its own surface, separate from the tile field around it.
  tagSurface(plate, { id: "central-hub/plate", kind: "floor", roomId: "central-hub", label: "Central Hub plate", preset: "terrazzo", size: { u: RECT.w, v: RECT.d } });
  plate.castShadow = false;
  g.add(plate);
  // brass outline: the plate path at two insets, the outer one lifted a hair above the plate face
  const outline = new THREE.Shape(plateShape(1.2).getPoints(96));
  outline.holes.push(new THREE.Path(plateShape(1.2 + OUTLINE_W).getPoints(96)));
  const line = flatShape(outline, 0.12, mat(key("inlay"), 0.35, { metalness: 0.6 }), PLATE.lift);
  line.castShadow = false;
  g.add(line);
  return g;
}

/** The brass medallion at the island's centre: a single thin ring inlaid flush in the plate. The source
 *  draws nothing inside it — it is an empty gathering floor, and 6B keeps it empty. */
function medallion(): THREE.Group {
  const g = new THREE.Group();
  g.name = "hub-medallion";
  const { centre, medallionR } = ISLAND;
  const ring = flatRing(ringShape(centre.x, centre.z, medallionR - 1.4, medallionR, 0, Math.PI * 2), 0.12, mat(key("inlay"), 0.32, { metalness: 0.65 }), PLATE.lift, 72);
  ring.castShadow = false;
  g.add(ring);
  return g;
}

// ---- the hero: four bench / planter arcs ---------------------------------------------------------
const SOIL_TOP = ISLAND.seatH + 7;
/** Curve resolution for the island's rings. build/arc defaults to 64 points per arc, which Reception's
 *  counter needs because its fascia is the closest thing to the camera in the whole office. These arcs
 *  span ~56° each: 20 points is one vertex every 2.8°, visually identical here and a third of the cost. */
const ARC_SEG = 20;

/** Bed planting — the arc beds, the counter boxes, the shelf planter — grows INSIDE a raised stone rim,
 *  so almost every shadow it casts lands on that rim. build/plants gives each leaf its own mesh, and with
 *  shadows on, each mesh is drawn twice; dropping the shadow pass for bed foliage alone is worth several
 *  hundred draw calls a frame and costs a shadow you cannot see. The free-standing floor plants keep
 *  theirs — those DO read on the plate. */
function bedPlant(g: THREE.Object3D): THREE.Object3D {
  g.traverse((o) => { o.castShadow = false; });
  return g;
}

function arcBench(a: HubArc, sway: SwayNode[]): THREE.Group {
  const g = new THREE.Group();
  g.name = `hub-${a.id}`;
  const { centre: c, rIn, rOut, plinthH, seatH, rimH, inset } = ISLAND;
  const A = (d: number) => shapeAngle(d);
  const ring = (r0: number, r1: number, s: { from: number; to: number }) => ringShape(c.x, c.z, r0, r1, A(s.from), A(s.to));
  const band = (r0: number, r1: number, s: { from: number; to: number }, t: number, m: THREE.Material, y0: number) => flatRing(ring(r0, r1, s), t, m, y0, ARC_SEG);
  const b = new Baker();

  // recessed plinth (the shadow gap the cove lives in) + the bench mass above it
  b.add(band(rIn + 2, rOut - 2, a.span, plinthH, stoneDark(), 0));
  b.add(band(rIn, rOut, a.span, seatH - plinthH, stone(), plinthH));

  // the upholstered length: a soft slab inset from both faces
  b.add(band(rIn + inset, rOut - inset, a.cushion, 4.5, mat(a.colour, 0.98), seatH));

  // the planting bed: a rim frame (outer + inner walls, radial end caps) around recessed soil
  const p = a.planter;
  b.add(band(rOut - 4, rOut, p, rimH - seatH, stone(), seatH));
  b.add(band(rIn, rIn + 4, p, rimH - seatH, stone(), seatH));
  for (const deg of [p.from, p.to]) {
    const mid = polar(c.x, c.z, (rIn + rOut) / 2, deg);
    const cap = rbox(rOut - rIn, rimH - seatH, 3, stone(), mid.x, seatH, mid.z, 0.5);
    cap.rotation.y = ((90 - deg) * Math.PI) / 180; // turns rbox local +x to point radially OUT at this bearing
    b.add(cap);
  }
  b.add(band(rIn + 4, rOut - 4, p, 1.6, mat("potDark", 1), SOIL_TOP - 1.6));
  b.bakeInto(g, a.id);

  // Planting, spaced along the bed's centre line, sizes alternating so a bed reads as mixed rather than
  // cloned. DENSITY IS DELIBERATELY LOW: build/plants gives every leaf its own mesh and its own sway node,
  // so a bed at the source's painted density costs ~130 meshes per specimen. At game distance four beds of
  // three restrained shrubs read exactly like four beds of eight lush ones and cost a third as much.
  const arcLen = ((p.to - p.from) * Math.PI * ((rIn + rOut) / 2)) / 180;
  const n = Math.max(2, Math.round(arcLen / 26));
  for (let i = 0; i < n; i++) {
    const deg = p.from + ((i + 0.5) / n) * (p.to - p.from);
    const at = polar(c.x, c.z, (rIn + rOut) / 2, deg);
    const big = i % 2 === 0;
    g.add(bedPlant(plantFor({ x: at.x, z: at.z, y: SOIL_TOP, r: big ? 7 : 6, h: big ? 16 : 12, lush: big ? 0.8 : 0.65, pot: false }, sway)));
  }

  // the warm cove, on the two LOWER arcs only — exactly where the source paints its glow
  if (a.cove) {
    const mid = (rIn + rOut) / 2;
    const led = band(mid - 1, mid + 1, a.span, 0.6, emissiveMat(key("cove"), 2.2, 0.4), 0.3);
    led.castShadow = led.receiveShadow = false;
    g.add(powered(led));
    // two additive spill rings falling off outward, the same restrained language as the arc counter
    for (const [r0, r1, op] of [[rOut - 2, rOut + 12, 0.3], [rOut + 8, rOut + 26, 0.12]] as const) {
      const spill = band(r0, r1, a.span, 0.04, glowMat(key("cove"), op), 0.06);
      spill.castShadow = spill.receiveShadow = false;
      g.add(animated(spill, { kind: "fade", period: 7.5, phase: a.id === "arc-se" ? 0 : 2.4, min: op * 0.78, max: op }));
    }
  }
  // contact shadow so the arc sits ON the plate instead of hovering over it
  const sh = band(rIn - 3, rOut + 3, a.span, 0.02, contactShadowMat(0.13), PLATE.lift + 0.02);
  sh.castShadow = sh.receiveShadow = false;
  g.add(sh);
  return g;
}

function island(sway: SwayNode[]): THREE.Group {
  const g = new THREE.Group();
  g.name = "hub-island";
  g.add(medallion());
  g.add(hubMonument()); // the hero centrepiece, inside the ring of benches
  for (const a of ARCS) g.add(arcBench(a, sway));
  return g;
}

// ---- west pantry run ------------------------------------------------------------------------------
/** A stone planter box: rim frame + recessed soil. Shared by the counter run and the shelf run. */
function planterBox(r: { x: number; z: number; w: number; d: number }, h: number, b: Baker): void {
  const cx = r.x + r.w / 2, cz = r.z + r.d / 2;
  b.add(rbox(r.w, h, r.d, stone(0.9), cx, 0, cz, 1.2));
  b.add(rbox(r.w - 5, 1.4, r.d - 5, mat("potDark", 1), cx, h - 1.5, cz, 0.4));
}

function pantryRun(sway: SwayNode[]): THREE.Group {
  const g = new THREE.Group();
  g.name = "hub-pantry";
  const b = new Baker();
  const c = COUNTER, cx = c.x + c.w / 2, cz = c.z + c.d / 2;
  b.add(rbox(c.w - 4, c.toe, c.d - 3, stoneDark(), cx, 0, cz, 0.4)); // recessed toe-kick
  b.add(rbox(c.w, c.h - c.toe - c.topT, c.d, mat(key("wood"), 0.62), cx, c.toe, cz, 1.0)); // carcass, stopping under the worktop
  for (let i = 1; i < 3; i++) b.add(rbox(c.w + 0.3, 18, 0.6, stoneDark(), cx, c.toe + 2, c.z + (c.d * i) / 3, 0.15)); // door reveals
  b.add(rbox(c.w + 2, c.topT, c.d + 2, mat("white", 0.3, { metalness: 0.02 }), cx, c.h - c.topT, cz, 0.5)); // worktop
  for (const p of COUNTER_PLANTERS) planterBox(p, 18, b);
  b.bakeInto(g, "pantry");

  const top = c.h;
  // espresso machine: dark body, chrome group head, drip tray, and ONE small ready light
  const e = APPLIANCES.espresso, eb = new Baker();
  eb.add(rbox(e.w, e.h, e.d, mat("charcoal", 0.45), e.x, top, e.z, 1.2));
  eb.add(rbox(e.w - 4, 2, 4, metal(), e.x, top + e.h * 0.2, e.z - e.d / 2 + 1.6, 0.5));
  eb.add(rbox(e.w - 3, 0.8, e.d - 6, metal(), e.x, top, e.z - e.d / 2 + 3.2, 0.2));
  eb.bakeInto(g, "espresso");
  const dot = cyl(0.7, 0.35, emissiveMat("readyGreen", 1.8, 0.3), e.x + 4, top + e.h - 0.4, e.z, 0.7);
  dot.castShadow = false;
  g.add(animated(dot, { kind: "pulse", period: 4.2, phase: 0, min: 0.9, max: 1.9 }));
  // filter machine: pale body, glass carafe, one cool power dot
  const f = APPLIANCES.filter, fb = new Baker();
  fb.add(rbox(f.w, f.h, f.d, plastic("white"), f.x, top, f.z, 1.4));
  fb.add(rbox(f.w - 5, 1, f.d - 4, mat("charcoal", 0.6), f.x, top, f.z, 0.3));
  fb.bakeInto(g, "filter");
  g.add(cyl(3.2, 6, mat("glass", 0.1, { transparent: true, opacity: 0.45 }), f.x, top + 1, f.z + 1.5, 2.8));
  const pwr = cyl(0.5, 0.3, emissiveMat("cyan", 1.5, 0.3), f.x - 4, top + f.h - 0.3, f.z, 0.5);
  pwr.castShadow = false;
  g.add(powered(pwr));
  const bowl = APPLIANCES.bowl;
  g.add(cyl(bowl.r, bowl.h, mat("greenDark", 0.7), bowl.x, top, bowl.z, bowl.r * 1.25));
  // THE WORKTOP'S FRONT EDGE. A 2.6-thick slab with a square arris reads as a sheet of card at any camera
  // angle; a bullnose with a drip return under it reads as a counter. Shared profile, one draw call, on
  // the run's EAST face — the side the whole plaza looks at (detail-props counterNosing → arch NOSING).
  g.add(counterNosing({ axis: "z", at: c.x + c.w + 1, dir: 1, from: c.z - 1, to: c.z + c.d + 1, top: c.h, key: "white", name: "hub-counter-nosing" }));
  // cups and saucers stacked in the gap between the two machines: the pantry stops being a worktop with
  // appliances on it and starts being somewhere a drink is actually served
  g.add(cupStack({ x: 493.5, y0: top, z: 586, columns: 2, key: "white", name: "hub-cups" }));

  // the counter's own toe-kick cove — a pantry reads as open when its plinth glows
  g.add(ledStrip({ axis: "z", from: c.z + 3, to: c.z + c.d - 3, at: c.x + c.w - 1.4, y: c.toe - 1.6, dir: 1,
    color: key("cove"), intensity: 1.6, housing: false, wash: { reach: 16, opacity: 0.12 }, name: "hub-counter-cove", editable: { roomId: "central-hub", label: "Counter cove" } }));
  for (const p of COUNTER_PLANTERS) {
    const n = p.d > 40 ? 2 : 1;
    for (let i = 0; i < n; i++) g.add(bedPlant(plantFor({ x: p.x + p.w / 2, z: p.z + (p.d * (i + 0.5)) / n, y: 17, r: n > 1 ? 7 : 8, h: n > 1 ? 17 : 20, lush: 0.9, pot: false }, sway)));
  }
  return g;
}

// ---- east library run -----------------------------------------------------------------------------
function shelfRun(sway: SwayNode[]): THREE.Group {
  const g = new THREE.Group();
  g.name = "hub-shelf-run";
  const s = SHELF_RUN, cx = s.x + s.w / 2;
  const b = new Baker();
  b.add(rbox(s.w, s.h, 2.5, stone(0.75), cx, 0, s.z + 1.25, 0.5)); // north end panel
  b.add(rbox(s.w, s.h, 2.5, stone(0.75), cx, 0, s.z + s.d - 1.25, 0.5)); // south end panel
  b.add(rbox(2.5, s.h, s.d, stone(0.75), s.x + 1.25, 0, s.z + s.d / 2, 0.5)); // west face
  b.add(rbox(2.5, s.h, s.d, stone(0.75), s.x + s.w - 1.25, 0, s.z + s.d / 2, 0.5)); // east face
  for (let i = 0; i <= s.bays; i++) {
    const y = 3 + ((s.h - 6) * i) / s.bays;
    b.add(rbox(s.w - 4, 1.2, s.d - 4, mat(key("wood"), 0.6), cx, y, s.z + s.d / 2, 0.3));
  }
  planterBox(SHELF_PLANTER, 20, b);
  b.bakeInto(g, "shelf-run");

  // dressing: a few laid books and small pots per bay. The pots are succulent ANCHORS — SceneMirror turns
  // every one of them in the room into three InstancedMeshes, so they cost nothing per pot.
  const bookKeys: MatKey[] = ["cushionCream", "hubSage", "walnutDark", "white"];
  const booked = new Baker(); // Baker already buckets by material, so one pass gives one mesh per colour
  for (let i = 0; i < s.bays; i++) {
    const y = 3 + ((s.h - 6) * i) / s.bays + 1.2;
    const zc = s.z + 12 + (i * (s.d - 24)) / (s.bays - 1);
    for (let k = 0; k < 3; k++) booked.add(book(cx - 3 + k * 3, y, zc + (k - 1) * 4.5, 9, 6.5, bookKeys[(i + k) % bookKeys.length], (k - 1) * 0.22));
    g.add(smallPot(cx + 4, y, zc + 9, 1.7));
    if (i % 2 === 0) g.add(smallPot(cx - 4, y, zc - 9, 1.4));
  }
  // SHADOW DISCIPLINE. Books lying flat on a shelf, inside a carcass that already shadows them, contribute
  // nothing to the image but are redrawn into the shadow map every time it refreshes. The shelf run itself
  // still casts — only its dressing stops.
  booked.bakeInto(g, "shelf-books");
  g.traverse((o) => { if (o.name.startsWith("shelf-books")) o.castShadow = false; });

  // the two big floor planters east of the run (the entities' plants stand IN these)
  const pb = new Baker();
  for (const p of EAST_PLANTERS) {
    pb.add(cyl(p.r, p.h - 0.2, mat("potDark", 0.55, { metalness: 0.08 }), p.x, 0, p.z, p.r * 0.94));
    pb.add(cyl(p.r + 0.6, 1.4, stone(0.6), p.x, p.h - 1.4, p.z));
    pb.add(cyl(p.r - 1.4, 1.0, mat("potDark", 1), p.x, p.h - 0.6, p.z));
  }
  pb.bakeInto(g, "east-planters");
  g.add(bedPlant(plantFor({ x: SHELF_PLANTER.x + SHELF_PLANTER.w / 2, z: SHELF_PLANTER.z + SHELF_PLANTER.d / 2, y: 19, r: 9, h: 20, lush: 1.0, pot: false }, sway)));
  return g;
}

/** Everything the Central Hub owns structurally. World space; the mirror adds it as-is.
 *  Builds NO wall, NO glass and NO door — the source has none. */
export function centralHubStatic(_room: RoomDef): THREE.Group {
  const g = new THREE.Group();
  g.name = "static:central-hub";
  // Static bed planting — the arc beds, the counter boxes, the shelf planter — is NOT an entity (it
  // belongs to the architecture it grows out of), but it should still breathe like the potted plants
  // beside it. SceneMirror picks these up off `userData.sway`; see its buildRoom.
  const sway: SwayNode[] = [];
  g.add(floorPlate());
  g.add(island(sway));
  g.add(pantryRun(sway));
  g.add(shelfRun(sway));
  // NOTHING FREE-STANDING IS ADDED TO THE PLATE. The hub's whole subject is the OPEN plaza around the
  // monument, and a plaza is read by the floor you can see across it. Its share of the art pass is at the
  // pantry counter (its front edge and its service) and nowhere else — see pantryRun above.
  g.userData.sway = sway;
  return g;
}
