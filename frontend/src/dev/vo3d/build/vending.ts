// vo3d build — THE VENDING MACHINE, the ground floor's one piece of hallway equipment.
//
// V1 paints two of these banks — assets/office/decor/vendo-machine-left.png and -right.png — standing in
// the two service corridors, AI ↔ Executive and Executive ↔ Dev. They are the only furniture V1 puts in
// the circulation zone, and they were the last V1 element with no V2 reconstruction at all.
//
// WHY THE PRODUCT IS MODELLED AND NOT PAINTED. A vending machine is a lit glass case whose entire job is
// to display goods: the carcass is a black box and the CONTENT is the object. Fill it with coloured blocks
// and it reads as a mini-fridge full of Lego, which is the exact failure the brief names. So the stock is
// built as stock — cans with a seamed rim and a tapered neck, PET bottles with a shoulder and a cap,
// pillow bags with a crimped top and bottom seal — sitting on wire shelves with visible dividers, in
// organised rows, behind glass that has thickness, with the machine's own strip light above them.
//
// AND WHY IT IS STILL CHEAP. Every rigid part of a finished machine is baked by material through
// helpers' `Baker`, exactly as the Central Hub's café chairs are: one machine is ~180 pieces of geometry
// and ~9 draw calls. Only the pieces that must keep their own material identity stay separate — the
// glass, the strip light, the internal wash and the priced UI panel.
import * as THREE from "three";
import { Baker, cyl, lathe, rbox, shadowed } from "./helpers";
import { PALETTE, emissiveMat, glassMat, glowMat, mat, metal, uiScreenMat, type MatKey } from "../render/Materials";

/** What the machine sells. The three the V1 art actually shows, in the order it shows them. */
export type VendingKind = "snack" | "drinks" | "combo";

export type VendingSpec = {
  /** the wall face the machine stands against */
  at: number;
  /** which way it FACES: +1 toward increasing `at`, −1 toward decreasing */
  dir: 1 | -1;
  /** the axis the machine's front spans (the wall's run axis) */
  axis: "x" | "z";
  /** centre of the machine along `axis` */
  along: number;
  kind: VendingKind;
  /** the machine's own brand accent — the fascia band and the UI's key colour */
  accent?: MatKey;
  name?: string;
};

const W = 34; //  across the front
const D = 22; //  into the corridor
const H = 38; //  Bon is 36, so the machine tops out just above his crown — as V1 draws it
const BAY = 7.5; // the dispensing bay at the bottom
const CTRL = 10; // the payment/control column on the right of the front

/** Snack-packet colourways: the gold/tan crisp bag, a blue pack and an orange one, which is what the V1
 *  panels actually show. Three is enough to read as "different products" and keeps the whole stock bake to
 *  three draw calls. Deliberately drawn from the office's own warm/blue keys and NOT from the neon ones —
 *  a vending machine is allowed to be the brightest thing in a corridor, not a different visual language. */
const PACKET: MatKey[] = ["bronze", "cmsBlue", "coveWarm"];
/** Can/bottle colourways: blue, green and amber, as the left and right art panels stock them. */
const CAN: MatKey[] = ["cmsBlue", "readyGreen", "coveWarm"];

/** A SURFACE INSIDE THE CASE.
 *
 *  This is the fix for the case reading as a black hole, and the cause is worth stating because it will
 *  catch the next enclosed prop too: the case is closed on five sides, so NOTHING in the scene lights it.
 *  The office's key is a directional light outside the machine, the strip light above the shelves is an
 *  emissive surface (three.js emissives glow, they do not illuminate), and SSAO then correctly darkens a
 *  deep recess — so a fully modelled shelf of cans rendered as an unlit silhouette behind tinted glass.
 *
 *  Adding eight real point lights to fix eight props is not on the table: this pass must not touch the
 *  approved lighting. So the case's own contents carry a LOW self-emission of their own colour, which is
 *  the same device every lit surface in this office already uses (uiScreenMat, emissiveMat, the LED
 *  channels) and is physically the right read anyway — goods in a lit display case ARE the bright thing.
 *  Intensity is kept well under a real emitter's so the machines do not become lanterns at night. */
function caseLit(key: MatKey, roughness: number, glow: number, metalness = 0): THREE.MeshStandardMaterial {
  return mat(key, roughness, { emissive: new THREE.Color(PALETTE[key]), emissiveIntensity: glow, metalness });
}

/** ONE CAN: the double-seamed base, the barrel, the shoulder taper and the chime at the lip. A revolved
 *  profile, so a whole shelf of them is one geometry per colour after the bake. */
function can(m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  return lathe([
    [0, 0.05], [1.15, 0], [1.3, 0.25], [1.3, 3.6], [1.15, 4.0], [0.85, 4.15], [0.95, 4.35], [0, 4.35],
  ], m, x, y, z, 10);
}
/** ONE PET BOTTLE: base, barrel, shoulder, neck and cap — the silhouette that separates a bottle from a
 *  can at ten metres, which is the only distance that matters here. */
function bottle(m: THREE.Material, cap: THREE.Material, x: number, y: number, z: number): THREE.Mesh[] {
  return [
    lathe([[0, 0.1], [1.1, 0], [1.25, 0.4], [1.25, 4.6], [1.0, 5.4], [0.52, 6.0], [0.5, 6.9], [0, 6.9]], m, x, y, z, 10),
    cyl(0.62, 0.8, cap, x, y + 6.8, z),
  ];
}
/** ONE PILLOW BAG: a puffed body with a crimped seal top and bottom. The crimps are what make it a
 *  PACKET — a rounded box on its own is a sweet, and the eye knows the difference. */
function packet(m: THREE.Material, x: number, y: number, z: number, w: number, h: number, tilt: number): THREE.Mesh[] {
  const body = rbox(w, h * 0.74, 1.9, m, x, y + h * 0.13, z, 0.85, 2);
  body.rotation.z = tilt;
  const out = [body];
  for (const s of [-1, 1]) {
    const crimp = rbox(w * 0.92, h * 0.11, 0.5, m, x, y + (s < 0 ? 0 : h * 0.87), z, 0.12);
    crimp.rotation.z = tilt;
    out.push(crimp);
  }
  return out;
}

/** The priced selection panel — the machine's only screen. One shared canvas for every machine in the
 *  office (uiScreenMat caches by id), drawn as a stock list rather than as abstract UI. */
function drawPanel(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = "#0c1119";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#39d7ff";
  ctx.fillRect(w * 0.08, h * 0.08, w * 0.5, h * 0.07);
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  for (let r = 0; r < 5; r++) {
    ctx.fillRect(w * 0.08, h * (0.26 + r * 0.13), w * 0.44, h * 0.045);
    ctx.fillRect(w * 0.62, h * (0.26 + r * 0.13), w * 0.3, h * 0.045);
  }
  ctx.fillStyle = "#6fe08a";
  ctx.fillRect(w * 0.08, h * 0.9, w * 0.84, h * 0.04);
}

/** One machine, built in WORLD space against `at`, facing `dir`.
 *
 *  Built in a LOCAL frame where the front faces −z and then rotated onto the wall, which is the same
 *  convention build/helpers' `placed` gives furniture: one body of arithmetic serves all four walls. */
export function vendingMachine(spec: VendingSpec): THREE.Group {
  const g = new THREE.Group();
  g.name = spec.name ?? `vending-${spec.kind}`;
  // local −z is the FRONT; the group is then turned so local −z points along `dir` on the wall's axis
  if (spec.axis === "z") {
    g.position.set(spec.at + spec.dir * (D / 2), 0, spec.along);
    g.rotation.y = spec.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
  } else {
    g.position.set(spec.along, 0, spec.at + spec.dir * (D / 2));
    g.rotation.y = spec.dir > 0 ? Math.PI : 0;
  }
  const accent = spec.accent ?? "aiLed";
  const shellM = mat("charcoal", 0.3, { metalness: 0.18 }); // the gloss black carcass V1 paints
  const deepM = mat("caveVoid", 0.85); //                      every recess: the bay, the control panel
  // The liner is lit, but UNDER the goods: pushed any brighter it flattens the stock into pale silhouettes
  // against a light box, which is the opposite of the problem it was added to solve.
  const linerM = caseLit("white", 0.85, 0.24); //              the case LINER — white, and lit, like a real one
  const trimM = metal();
  const front = -D / 2; //                                     the front plane in local z

  // ---- the carcass, AS A SHELL AROUND A REAL CAVITY ---------------------------------------------
  //
  // THIS IS THE WHOLE TRICK, AND GETTING IT WRONG IS INVISIBLE UNTIL YOU LOOK. A vending machine built as
  // one solid box with a frame stuck on its front has no case at all: every shelf, can and packet sits
  // BURIED INSIDE opaque geometry, and the window renders as a perfectly clean black rectangle — which
  // reads, convincingly and wrongly, as "the interior is just unlit". It is not unlit, it is not there.
  //
  // So the body is five slabs around a declared cavity — rear, two cheeks, the header above the glass and
  // the apron below it — with the payment column as the right-hand mass. Same bake, same draw call.
  const CAV = {
    x0: -W / 2 + 2.2,
    x1: W / 2 - CTRL - 3.4,
    y0: BAY + 2.4,
    y1: H - 4.2,
    z0: front + 1.8, //     the glass sits just in front of this
    z1: D / 2 - 3.0, //     and the liner just in front of the rear slab
  };
  /** the cavity's mid-depth. `rbox` takes a CENTRE, so every rack and liner inside the case is placed on
   *  this — measuring from a face instead is what pushed the first build's shelves out through the glass. */
  const CAV_MID = (CAV.z0 + CAV.z1) / 2;
  const winW = CAV.x1 - CAV.x0, winCx = (CAV.x0 + CAV.x1) / 2;
  const winY0 = CAV.y0, winY1 = CAV.y1;
  const b = new Baker();
  b.add(rbox(W, H, 3.0, shellM, 0, 0, D / 2 - 1.5, 0.8, 2)); //                                 rear
  b.add(rbox(CAV.x0 + W / 2, H, D, shellM, (-W / 2 + CAV.x0) / 2, 0, 0, 0.8, 2)); //             left cheek
  b.add(rbox(W / 2 - CAV.x1, H, D, shellM, (CAV.x1 + W / 2) / 2, 0, 0, 0.8, 2)); //              right mass
  b.add(rbox(winW, H - CAV.y1, D - 3, shellM, winCx, CAV.y1, -1.5, 0.5, 2)); //                  header
  b.add(rbox(winW, CAV.y0, D - 3, shellM, winCx, 0, -1.5, 0.5, 2)); //                           apron
  b.add(rbox(W - 3, 2.4, D - 3, deepM, 0, 0, 0, 0.4)); //      recessed plinth: the machine stands ON something
  b.add(rbox(W, 1.4, D + 0.8, shellM, 0, H - 1.4, 0, 0.5)); // the top cap, proud of the body
  // the case frame, standing proud of the front — four members, so the glass is genuinely SET IN
  b.add(rbox(winW + 3.2, 1.8, 1.3, trimM, winCx, winY0 - 1.8, front - 0.4, 0.35)); //  sill
  b.add(rbox(winW + 3.2, 1.8, 1.3, trimM, winCx, winY1, front - 0.4, 0.35)); //        head
  for (const s of [-1, 1]) b.add(rbox(1.6, winY1 - winY0 + 3.6, 1.3, trimM, winCx + s * (winW / 2 + 0.8), winY0 - 1.8, front - 0.4, 0.3));
  // the case LINER: a real machine's cabinet is white inside, and half of why its stock reads from across
  // a corridor is that white bouncing the strip light back through the goods
  b.add(rbox(winW, winY1 - winY0, 0.6, linerM, winCx, winY0, CAV.z1 - 0.3, 0.1)); //   back
  for (const s of [-1, 1]) b.add(rbox(0.6, winY1 - winY0, CAV.z1 - CAV.z0, linerM, winCx + s * (winW / 2 - 0.3), winY0, CAV_MID, 0.1));
  // the brand fascia across the top of the front
  b.add(rbox(winW + 3.2, 2.6, 0.6, mat(accent, 0.55), winCx, winY1 + 1.9, front - 0.5, 0.2));

  // ---- the dispensing bay ----------------------------------------------------------------------
  // a recessed well with a hinged flap over it and a lip under it: the one part of a vending machine a
  // person actually touches, and without it the bottom of the box is a blank panel
  b.add(rbox(winW * 0.62, BAY - 1.6, 4.0, deepM, winCx, 1.3, front + 3.6, 0.3));
  const flap = rbox(winW * 0.6, BAY - 2.4, 0.7, shellM, winCx, 1.9, front + 0.1, 0.25);
  flap.rotation.x = -0.22; //                                 pushed ajar, as a used one always is
  b.add(flap);
  b.add(rbox(winW * 0.66, 0.9, 1.8, trimM, winCx, 0.9, front - 0.3, 0.2)); // the lip below it

  // ---- the payment / control column ------------------------------------------------------------
  const ctrlCx = W / 2 - CTRL / 2 - 1.6;
  b.add(rbox(CTRL, H - BAY - 6, 0.9, deepM, ctrlCx, BAY + 2, front - 0.3, 0.3)); // the recessed panel
  // keypad: three columns of four, as a real selection pad
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 3; c++)
      b.add(rbox(1.5, 1.5, 0.45, trimM, ctrlCx + (c - 1) * 2.3, H - 20 - r * 2.4, front - 0.8, 0.25));
  b.add(rbox(5.6, 0.7, 0.8, trimM, ctrlCx, H - 9.5, front - 0.8, 0.2)); //   the coin slot
  b.add(rbox(4.2, 5.2, 1.0, shellM, ctrlCx, H - 27.5, front - 0.9, 0.35)); // the card reader body
  b.add(rbox(3.4, 1.2, 0.5, deepM, ctrlCx, H - 31.5, front - 1.0, 0.15)); // the coin return cup
  b.bakeInto(g, g.name);

  // ---- the stock ------------------------------------------------------------------------------
  // Shelves first, then the goods on them. Baked by material: the wire work is one call, and each
  // colourway of packet or can is one more, however many are on the shelves.
  const shelf = new Baker();
  const rackM = caseLit("metal", 0.4, 0.22, 0.35); // chrome wire, lit by the case
  const rows = spec.kind === "snack" ? 3 : spec.kind === "combo" ? 3 : 3;
  const usable = winY1 - winY0 - 3.2;
  const pitch = usable / rows;
  const goods = new Map<MatKey, Baker>();
  const bucket = (k: MatKey): Baker => {
    let x = goods.get(k);
    if (!x) goods.set(k, (x = new Baker()));
    return x;
  };
  for (let r = 0; r < rows; r++) {
    const y = winY0 + 1.6 + r * pitch;
    // the shelf pan, its front retaining wire and the dividers between the columns
    shelf.add(rbox(winW - 2.4, 0.4, CAV.z1 - CAV.z0 - 1, rackM, winCx, y, CAV_MID, 0.12));
    shelf.add(rbox(winW - 2.4, 0.35, 0.35, rackM, winCx, y + 1.6, CAV.z0 + 0.6, 0.12));
    // a snack row is a SPIRAL row, a drinks row is a gravity rack: different stock, different structure
    const isPacket = spec.kind === "snack" || (spec.kind === "combo" && r > 0);
    const cols = isPacket ? 4 : 5;
    for (let c = 0; c < cols; c++) {
      const x = winCx + (c - (cols - 1) / 2) * ((winW - 5) / cols);
      if (c > 0) shelf.add(rbox(0.3, pitch - 1.4, CAV.z1 - CAV.z0 - 1.5, rackM, x - (winW - 5) / cols / 2, y + 0.4, CAV_MID, 0.1));
      const key = isPacket ? PACKET[(r + c) % PACKET.length] : CAN[(r * 2 + c) % CAN.length];
      // a packet is printed film, a can is a lacquered aluminium body: different roughness, same low glow
      const m = isPacket ? caseLit(key, 0.62, 0.30) : caseLit(key, 0.4, 0.26, 0.3);
      const bk = bucket(key);
      if (isPacket) {
        // two packets deep per column, the front one tipped forward against the retaining wire
        for (const [dz, tilt] of [[1.4, -0.16], [4.8, -0.06]] as const)
          for (const p of packet(m, x, y + 0.4, CAV.z0 + dz, (winW - 6.4) / cols, pitch - 2.0, tilt)) bk.add(p);
      } else {
        // three deep: the front can on the lip, two queued behind it
        for (const dz of [1.8, 5.2, 8.6]) bk.add(can(m, x, y + 0.4, CAV.z0 + dz));
      }
    }
  }
  // one bottle bay per drinks machine, so the case is not a wall of identical cans
  if (spec.kind !== "snack") {
    const bm = caseLit("glass", 0.25, 0.3, 0.1);
    const bk = bucket("glass");
    for (const c of [-1, 1])
      for (const p of bottle(bm, caseLit("bronze", 0.5, 0.25), winCx + c * (winW / 2 - 3.4), winY0 + 1.9, CAV.z0 + 2.6)) bk.add(p);
  }
  shelf.bakeInto(g, `${g.name}-racks`);
  for (const bk of goods.values()) bk.bakeInto(g, `${g.name}-stock`);

  // ---- the glass, the strip light and its wash --------------------------------------------------
  // A BOX, not a plane: the case glass is the one surface a player reads depth through, and a
  // single-sided quad has no edge to catch the corridor light on.
  const pane = rbox(winW, winY1 - winY0, 0.9, glassMat(), winCx, winY0, CAV.z0 - 1.1, 0.1);
  pane.castShadow = false;
  g.add(shadowed(pane, false, false));
  // the machine's own strip light, tucked under the case head where a real one is — subtle, and warm-white
  // rather than coloured, so it lights the stock instead of tinting the corridor
  const strip = rbox(winW - 3, 0.6, 1.2, emissiveMat("white", 0.9, 0.3), winCx, winY1 - 1.4, CAV.z0 + 1.4, 0.2);
  strip.castShadow = false;
  g.add(strip);
  const wash = rbox(winW - 2, winY1 - winY0 - 3, 0.1, glowMat("white", 0.09), winCx, winY0 + 1.5, CAV.z1 - 0.9, 0);
  wash.castShadow = wash.receiveShadow = false;
  g.add(wash);

  // ---- the priced selection panel --------------------------------------------------------------
  const ui = rbox(CTRL - 3.2, 9.5, 0.3, uiScreenMat("vending-panel", 96, 128, drawPanel, 0.75), ctrlCx, H - 17, front - 1.0, 0.15);
  ui.castShadow = false;
  g.add(ui);
  // the card reader's ready light: one small emitter on a real fixture, never a floating glow
  const led = rbox(1.6, 0.5, 0.35, emissiveMat(accent, 1.2, 0.3), ctrlCx, H - 24.4, front - 1.45, 0.12);
  led.castShadow = false;
  g.add(led);
  return g;
}

/** The machine's PLAN footprint, for anything that needs to know where it stands. Exported so a caller
 *  reasons about the same rect the geometry occupies rather than re-deriving W/D. */
export const VENDING_SIZE = { w: W, d: D, h: H };
