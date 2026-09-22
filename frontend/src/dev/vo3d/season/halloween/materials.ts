// vo3d season/halloween — THE HALLOWEEN MATERIAL SET AND ITS TEXTURES.
//
// IT OWNS EVERY MATERIAL IT USES AND NEVER TOUCHES render/Materials' SHARED CACHE. That is the same
// rule build/exterior.ts states in its own header, and it exists for one reason: `mat("plaster")`
// hands the SAME object to every wall in the building, so a season that wrote into it would repaint
// eleven rooms with no way back. Everything here is constructed on `create()` and destroyed on
// `dispose()`, so taking the decorations away is byte-for-byte the office that was there before.
//
// PALETTE — MEASURED OFF THE REFERENCE, not invented. The reference is a dim library set lit almost
// entirely by pumpkins and candles: a violet-charcoal ground, warm saturated orange as the ONLY
// bright hue, pale lavender-white webs, and near-black props that read as silhouettes. The two rules
// that keep it from turning into a cartoon party are that nothing is pure black (a silhouette still
// has a lit edge) and nothing is pure saturated orange at full value (the glow does the brightness,
// the body stays a deep pumpkin).
//
// COST. Two 256² canvas textures (web, bat) and one 128² radial (glow), each built once and shared by
// every instance; roughly a dozen materials total. No downloads, no glTF, nothing per-object.
import * as THREE from "three";

export const HALLOWEEN_PALETTE = {
  /** the deep pumpkin body — never the bright orange, which is what the GLOW is for */
  pumpkin: 0xc2621a,
  pumpkinDeep: 0x9c4a12,
  pumpkinPale: 0xd89a4a,
  /** the lit interior of a jack-o'-lantern, and every flame */
  emberCore: 0xff9a3c,
  ember: 0xffb457,
  candleWax: 0xe8dcc4,
  /** webs: pale lavender-white, never pure white */
  web: 0xcfc8dc,
  /** hanging drapes and bats: near-black with a violet cast, so they sit IN the scene rather than on it */
  shroud: 0x2a2632,
  shroudDeep: 0x1d1a24,
  stem: 0x6b6a3a,
  gourdCream: 0xd9cfa8,
  gourdGreen: 0x7a7a3f,
  /** EERIE GREEN — the third light in the palette, and the one that makes a room read as HAUNTED
   *  rather than merely dark. Used only as spectral light (ghosts, doorway spill, cauldron glow),
   *  never as paint, so it cannot be mistaken for the product's own semantic greens. */
  spectral: 0x6dffc4,
  spectralDeep: 0x2fae86,
  /** bone and dead vegetation */
  bone: 0xd8d2bd,
  boneShadow: 0xaea88f,
  witheredStalk: 0x5c4a34,
  witheredLeaf: 0x7a6338,
} as const;

function canvas(size: number): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return c.getContext("2d");
}

/** A RADIAL SPIDER WEB, drawn once as an alpha map: radial spokes plus sagging catenary rings.
 *  Transparent everywhere else, so one quad carries a whole web with no geometry at all. */
function webTexture(): THREE.Texture | null {
  const ctx = canvas(256);
  if (!ctx) return null;
  const S = 256;
  ctx.clearRect(0, 0, S, S);
  ctx.strokeStyle = "#ffffff";
  ctx.lineCap = "round";
  // The anchor is the CORNER (0,0): a corner web is a quarter of a web, which is what a real one is.
  const spokes = 11;
  ctx.lineWidth = 1.6;
  for (let i = 0; i <= spokes; i++) {
    const a = (i / spokes) * (Math.PI / 2);
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * S * 1.42, Math.sin(a) * S * 1.42);
    ctx.stroke();
  }
  // Rings sag BETWEEN spokes rather than arcing cleanly — a taut circle reads as a dartboard.
  const rings = 9;
  ctx.lineWidth = 1.1;
  for (let r = 1; r <= rings; r++) {
    const rad = (r / rings) * S * 0.98;
    ctx.globalAlpha = 0.55 + 0.35 * (1 - r / rings);
    ctx.beginPath();
    for (let i = 0; i <= spokes; i++) {
      const a0 = (i / spokes) * (Math.PI / 2);
      const a1 = ((i + 1) / spokes) * (Math.PI / 2);
      const mid = (a0 + a1) / 2;
      const sag = rad * 0.9; // the dip between two spokes
      const x0 = Math.cos(a0) * rad, y0 = Math.sin(a0) * rad;
      const xm = Math.cos(mid) * sag, ym = Math.sin(mid) * sag;
      if (i === 0) ctx.moveTo(x0, y0);
      if (i < spokes) ctx.quadraticCurveTo(xm, ym, Math.cos(a1) * rad, Math.sin(a1) * rad);
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/** A BAT SILHOUETTE as an alpha map — one quad each, instanced. Drawn as a filled path rather than
 *  modelled, because at the office camera a bat is four pixels of shape and no amount of geometry
 *  would read; at eye level the silhouette is still the whole of what a bat looks like. */
function batTexture(): THREE.Texture | null {
  const ctx = canvas(256);
  if (!ctx) return null;
  ctx.clearRect(0, 0, 256, 256);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  // body
  ctx.ellipse(128, 132, 17, 30, 0, 0, Math.PI * 2);
  ctx.fill();
  // head + ears
  ctx.beginPath();
  ctx.arc(128, 98, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(114, 88); ctx.lineTo(108, 62); ctx.lineTo(126, 80); ctx.closePath();
  ctx.moveTo(142, 88); ctx.lineTo(148, 62); ctx.lineTo(130, 80); ctx.closePath();
  ctx.fill();
  // wings — scalloped trailing edge, which is the one cue that makes a shape read as "bat"
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(128 + s * 14, 112);
    ctx.quadraticCurveTo(128 + s * 70, 74, 128 + s * 124, 104);
    ctx.quadraticCurveTo(128 + s * 100, 116, 128 + s * 96, 146);
    ctx.quadraticCurveTo(128 + s * 78, 122, 128 + s * 66, 150);
    ctx.quadraticCurveTo(128 + s * 50, 128, 128 + s * 36, 156);
    ctx.quadraticCurveTo(128 + s * 26, 138, 128 + s * 14, 150);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/** A WEB SHEET for the hanging swags — a different thing from the corner web, and the first render
 *  proved why: a radial web stretched along a 200-unit strip reads as smeared blobs, and the strip
 *  itself then reads as a black beam crossing the room. A swag needs a TILEABLE NET: vertical threads
 *  hanging from the top edge, sagging cross-threads between them, and torn gaps so the sheet reads as
 *  cobweb rather than as net curtain. Mostly transparent by area, which is what stops it occluding
 *  the room beneath it at the office camera's steep angle. */
function webSheetTexture(): THREE.Texture | null {
  const ctx = canvas(256);
  if (!ctx) return null;
  const S = 256;
  ctx.clearRect(0, 0, S, S);
  ctx.strokeStyle = "#ffffff";
  ctx.lineCap = "round";
  // Vertical threads, irregular spacing — an even comb reads as a fence.
  const xs: number[] = [];
  for (let x = 4; x < S; x += 26 + ((x * 37) % 22)) xs.push(x);
  ctx.lineWidth = 2.6;
  for (const x of xs) {
    ctx.globalAlpha = 0.5 + ((x * 13) % 40) / 100;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    // threads drift sideways as they fall, and most do not reach the bottom
    const end = S * (0.45 + ((x * 29) % 55) / 100);
    ctx.quadraticCurveTo(x + (((x * 7) % 20) - 10), end * 0.6, x + (((x * 17) % 26) - 13), end);
    ctx.stroke();
  }
  // Sagging cross-threads between neighbours: the actual "web" read.
  ctx.lineWidth = 2;
  for (let r = 0; r < 6; r++) {
    const y = S * (0.1 + r * 0.14);
    ctx.globalAlpha = 0.5 - r * 0.06;
    for (let i = 0; i + 1 < xs.length; i++) {
      // HEAVILY TORN. An intact lattice reads as net curtain; a cobweb is mostly holes.
      if ((i * 3 + r * 5) % 4 !== 0) continue;
      ctx.beginPath();
      ctx.moveTo(xs[i], y);
      ctx.quadraticCurveTo((xs[i] + xs[i + 1]) / 2, y + 9 + ((i * 11) % 7), xs[i + 1], y);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** A SOFT RADIAL FALLOFF for the additive light pools. The office has NO real-time point lights —
 *  every glow in the building is an emissive surface plus an additive plane (see build/led.ts), and
 *  a season full of candles is exactly where that convention pays for itself. */
function glowTexture(): THREE.Texture | null {
  const ctx = canvas(128);
  if (!ctx) return null;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.42)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

export interface HalloweenMaterials {
  pumpkin: THREE.MeshStandardMaterial;
  /** the glowing shell of a lit jack-o'-lantern */
  pumpkinLit: THREE.MeshStandardMaterial;
  pumpkinDeep: THREE.MeshStandardMaterial;
  pumpkinPale: THREE.MeshStandardMaterial;
  gourdCream: THREE.MeshStandardMaterial;
  gourdGreen: THREE.MeshStandardMaterial;
  stem: THREE.MeshStandardMaterial;
  /** the lit face of a jack-o'-lantern and the body of a flame */
  ember: THREE.MeshStandardMaterial;
  wax: THREE.MeshStandardMaterial;
  shroud: THREE.MeshStandardMaterial;
  shroudDeep: THREE.MeshStandardMaterial;
  /** corner web quads — alpha-mapped, double-sided, unlit enough to stay pale in a dark room */
  web: THREE.MeshStandardMaterial;
  /** hanging swag sheets: the tileable net, far more transparent than a corner web */
  webSheet: THREE.MeshStandardMaterial;
  bat: THREE.MeshBasicMaterial;
  /** additive, depth-write off: the light pools and candle haloes */
  glow: THREE.MeshBasicMaterial;
  glowWarm: THREE.MeshBasicMaterial;
  /** the spectral green glow — ghosts, doorway spill, cauldron light */
  glowSpectral: THREE.MeshBasicMaterial;
  bone: THREE.MeshStandardMaterial;
  boneShadow: THREE.MeshStandardMaterial;
  witheredStalk: THREE.MeshStandardMaterial;
  witheredLeaf: THREE.MeshStandardMaterial;
  /** a ghost's body: soft, self-lit, barely there */
  ghost: THREE.MeshStandardMaterial;
  /** ground fog and floor decay: a wide, faint, flat wash */
  fog: THREE.MeshBasicMaterial;
  dispose(): void;
}

export function createHalloweenMaterials(): HalloweenMaterials {
  const P = HALLOWEEN_PALETTE;
  const webTex = webTexture();
  const sheetTex = webSheetTexture();
  const batTex = batTexture();
  const glowTex = glowTexture();

  const std = (color: number, roughness: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });

  const materials = {
    pumpkin: std(P.pumpkin, 0.72),
    // The SHELL of a lit lantern: warm, self-illuminated, the way a candle inside a gourd looks.
    pumpkinLit: std(P.pumpkin, 0.6, { emissive: new THREE.Color(0xff7a1e), emissiveIntensity: 0.85 }),
    pumpkinDeep: std(P.pumpkinDeep, 0.78),
    pumpkinPale: std(P.pumpkinPale, 0.75),
    gourdCream: std(P.gourdCream, 0.8),
    gourdGreen: std(P.gourdGreen, 0.8),
    stem: std(P.stem, 0.92),
    // EMISSIVE, NOT BRIGHT-COLOURED. The face of a lit pumpkin is a light source in the reference; the
    // surrounding body is not. Keeping the brightness in `emissive` is what survives the season's very
    // low exposure without the body turning into a flat orange sticker.
    ember: std(P.emberCore, 0.4, { emissive: new THREE.Color(P.ember), emissiveIntensity: 5.2 }),
    wax: std(P.candleWax, 0.85),
    shroud: std(P.shroud, 0.95),
    shroudDeep: std(P.shroudDeep, 0.97),
    web: new THREE.MeshStandardMaterial({
      color: P.web,
      roughness: 1,
      metalness: 0,
      transparent: true,
      opacity: 0.62,
      // A web is a thread lattice seen from both sides, and it must never occlude anything behind it in
      // the depth buffer or the room's own geometry would punch holes through it at grazing angles.
      side: THREE.DoubleSide,
      depthWrite: false,
      ...(webTex ? { alphaMap: webTex } : {}),
      // A touch of self-illumination so a web still reads in a room lit at a tenth of normal exposure.
      emissive: new THREE.Color(P.web),
      emissiveIntensity: 0.22,
    }),
    webSheet: new THREE.MeshStandardMaterial({
      color: P.web,
      roughness: 1,
      metalness: 0,
      transparent: true,
      // MUCH more transparent than a corner web: a swag spans a whole room and must veil it, never
      // hide it. This number is the difference between "cobwebbed ceiling" and "black bar".
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false,
      ...(sheetTex ? { alphaMap: sheetTex } : {}),
      emissive: new THREE.Color(P.web),
      emissiveIntensity: 0.55,
    }),
    bat: new THREE.MeshBasicMaterial({
      color: P.shroudDeep,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      ...(batTex ? { alphaMap: batTex } : {}),
    }),
    glow: new THREE.MeshBasicMaterial({
      color: P.ember,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      ...(glowTex ? { map: glowTex } : {}),
    }),
    bone: std(P.bone, 0.85),
    boneShadow: std(P.boneShadow, 0.9),
    witheredStalk: std(P.witheredStalk, 0.95),
    witheredLeaf: std(P.witheredLeaf, 0.93),
    ghost: new THREE.MeshStandardMaterial({
      color: P.spectral,
      roughness: 1,
      metalness: 0,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
      emissive: new THREE.Color(P.spectral),
      // Softened: at 1.5 the ghost was the brightest thing in the frame and drew the eye off the
      // pumpkins, which are supposed to be the room's light.
      emissiveIntensity: 0.85,
    }),
    fog: new THREE.MeshBasicMaterial({
      color: 0x9a86c8,
      transparent: true,
      // RAISED from 0.13, which was invisible on screen. Still low enough that the floor beneath
      // stays readable — the constraint is legibility, not subtlety for its own sake.
      opacity: 0.3,
      depthWrite: false,
      side: THREE.DoubleSide,
      ...(glowTex ? { map: glowTex } : {}),
    }),
    glowSpectral: new THREE.MeshBasicMaterial({
      color: P.spectral,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      ...(glowTex ? { map: glowTex } : {}),
    }),
    glowWarm: new THREE.MeshBasicMaterial({
      color: P.emberCore,
      transparent: true,
      opacity: 0.46,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      ...(glowTex ? { map: glowTex } : {}),
    }),
  };

  return {
    ...materials,
    dispose(): void {
      for (const m of Object.values(materials)) (m as THREE.Material).dispose();
      webTex?.dispose();
      sheetTex?.dispose();
      batTex?.dispose();
      glowTex?.dispose();
    },
  };
}
