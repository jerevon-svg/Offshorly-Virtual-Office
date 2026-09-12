// vo3d render — shared material cache + the office palette (warm cream / wood / olive).
// Promoted from designRoom3d/build.ts (materials block) and layout.ts (PALETTE). ONE cache for the scene.
import * as THREE from "three";

export const PALETTE = {
  floor: 0xf0e8e2,
  exterior: 0xd9cbbf, // ≈ the V1 hall floor (floor.png measures 219,202,187)
  sidewalk: 0x9a9187,
  plinth: 0xbfb6ac,
  wall: 0xfaf8f5,
  wallFace: 0xf1ece7,
  wood: 0xcfa876,
  woodLight: 0xdcb98a,
  green: 0x7b8a45,
  greenDark: 0x66733a,
  greenSeat: 0x8a9a55,
  white: 0xf7f7f4,
  charcoal: 0x2b2b2e,
  potGray: 0x9a9a96,
  potDark: 0x5e5a56,
  foliage: 0x4f8a3a,
  foliageLight: 0x6fa74a,
  rug: 0xc6a36e,
  cushionGray: 0xb9b3ab,
  cushionCream: 0xe9dfcf,
  metal: 0xc9cbcc,
  glass: 0xcfe3f2,
  boardBg: 0xf4efe6,
  boardPin: 0x6f8a3d,
  screen: 0x1f2430,
  tile: 0xefe8de, // reception/front-bar polished floor tile (measured off reception-room.png)
  grout: 0xc4b7a6,
  bronze: 0xa98a63, // the arc counter's champagne/bronze visitor-facing fascia (measured 135,103,71 lit)
  bronzeDark: 0x6f5738,
  gateLed: 0x2f9fe0,
  cyan: 0x6fd8ff, // powered-electronics status light (gates, sensors)
  readyGreen: 0x62e393,
  coveWarm: 0xffc27a, // the counter's architectural LED cove
  uiNavy: 0x14213a, // kiosk / monitor UI ground
  loungeOlive: 0x5f6a38, // reception lounge upholstery — measured (74,65,33)…(90,95,55), darker than PALETTE.green
  loungeOliveSeat: 0x6e7a42,
  tableWood: 0xd6c2a2, // pale oak of the lounge coffee tables (the Design Room's wood reads too orange here)
  walnut: 0x6b4a31, //     dark stained oak of the front-bar credenza runs + slat features (measured 107,74,49)
  walnutDark: 0x4a3222, // the reveals/grooves between their modules, and the slat panels' backing board
  plaster: 0xf3ece2, //    the front-bar cove walls: a warmer cream than PALETTE.wall (measured 243,236,226)
};

// ---- shared materials -------------------------------------------------------------------
export type MatKey = keyof typeof PALETTE;
const materials = new Map<string, THREE.Material>();

export function canvas2d(w: number, h: number): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c.getContext("2d");
}

// Soft procedural wood grain: warm base + low-contrast streaks. Used at two
// UV scales (rounded boxes have per-face 0..1 UVs; extruded tops have UVs in
// world units).
let woodTex: THREE.CanvasTexture | null | undefined;
function woodTexture(): THREE.CanvasTexture | null {
  if (woodTex !== undefined) return woodTex;
  const ctx = canvas2d(256, 256);
  if (!ctx) return (woodTex = null);
  ctx.fillStyle = "#dab887"; // ≈ production wood (205,165,115) after lighting
  ctx.fillRect(0, 0, 256, 256);
  let s = 3;
  const r = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  for (let i = 0; i < 70; i++) {
    const y = r() * 256, wdt = 1 + r() * 3, a = 0.05 + r() * 0.08;
    ctx.strokeStyle = `rgba(130,90,50,${a})`;
    ctx.lineWidth = wdt;
    ctx.beginPath();
    ctx.moveTo(-10, y);
    ctx.bezierCurveTo(80, y + (r() - 0.5) * 14, 170, y + (r() - 0.5) * 14, 270, y + (r() - 0.5) * 8);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return (woodTex = tex);
}

export function mat(key: MatKey, roughness = 0.9, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  const id = `${key}:${roughness}:${JSON.stringify(extra)}`;
  let m = materials.get(id) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: PALETTE[key], roughness, metalness: 0, ...extra });
    materials.set(id, m);
  }
  return m;
}
export function wood(kind: "box" | "extrude" = "box", light = false): THREE.MeshStandardMaterial {
  const id = `wood:${kind}:${light}`;
  let m = materials.get(id) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    const tex = woodTexture();
    let map: THREE.Texture | null = null;
    if (tex) {
      map = tex.clone();
      map.needsUpdate = true;
      if (kind === "extrude") map.repeat.set(0.02, 0.02);
    }
    // with a grain map the map carries the wood colour; tint only lightly so it does not go orange
    const color = map ? (light ? 0xfff8ee : 0xffffff) : light ? PALETTE.woodLight : PALETTE.wood;
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0, map });
    materials.set(id, m);
  }
  return m;
}
export const fabric = (key: MatKey = "green") => mat(key, 0.98);
export const plastic = (key: MatKey = "white") => mat(key, 0.45);
export const metal = () => mat("metal", 0.35, { metalness: 0.7 });
export function screenMat(): THREE.MeshStandardMaterial {
  return mat("screen", 0.25, { emissive: 0x3a5a86, emissiveIntensity: 0.55 });
}
// ---- floor tile ------------------------------------------------------------------------------
/** grout pitch of the front-bar floor tile, in world units (measured: 40 × 40 on reception-room.png) */
export const TILE = 40;
/** world coordinate a grout line falls on: x ≡ 0, z ≡ 32 (mod TILE). Anchored to the WORLD, never to a
 *  room rect, so the same grid continues unbroken into Meeting and Project when they are reconstructed. */
export const TILE_PHASE = { x: 0, z: 32 };

let tileTex: THREE.CanvasTexture | null | undefined;
function tileTexture(): THREE.CanvasTexture | null {
  if (tileTex !== undefined) return tileTex;
  const N = 256;
  const ctx = canvas2d(N, N);
  if (!ctx) return (tileTex = null);
  ctx.fillStyle = "#efe8de";
  ctx.fillRect(0, 0, N, N);
  let s = 11;
  const r = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  // NON-DIRECTIONAL stone mottle: soft radial blobs at random angles. (Horizontal streaks tiled into
  // visible banding across the floor — every tile shares one texture, so any directional feature lines up.)
  for (let i = 0; i < 460; i++) {
    const cx = r() * N, cy = r() * N, rad = 3 + r() * 11;
    const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    const dark = r() < 0.5;
    gr.addColorStop(0, dark ? "rgba(198,185,168,0.045)" : "rgba(255,253,248,0.055)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  // faint diagonal vein flecks, alternating direction so nothing reads as a stripe
  for (let i = 0; i < 26; i++) {
    const x = r() * N, y = r() * N, len = 10 + r() * 30, a = (r() < 0.5 ? 1 : -1) * (0.5 + r() * 0.7);
    ctx.strokeStyle = `rgba(190,176,157,${0.025 + r() * 0.03})`;
    ctx.lineWidth = 0.8 + r() * 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  // grout: a darker recessed joint with a light chamfer on the tile side, on two edges only
  ctx.fillStyle = "#c4b7a6";
  ctx.fillRect(0, 0, N, 3);
  ctx.fillRect(0, 0, 3, N);
  ctx.fillStyle = "rgba(255,253,249,0.55)";
  ctx.fillRect(0, 3, N, 1.5);
  ctx.fillRect(3, 0, 1.5, N);
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return (tileTex = tex);
}

/** Tile material for ONE floor rect. UVs are world-phased by the caller (build/tile.ts), so each rect needs
 *  its own map instance — the base texture is shared, only the repeat/offset differ. */
export function tileMat(): THREE.MeshStandardMaterial {
  const tex = tileTexture();
  const map = tex ? tex.clone() : null;
  if (map) map.needsUpdate = true;
  return new THREE.MeshStandardMaterial({
    color: map ? 0xffffff : PALETTE.tile,
    map,
    roughness: 0.42,
    metalness: 0,
    // the floor sits at exactly y = 0, coplanar with the shared ground slab's top face
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

/** Emissive surface for powered electronics / architectural LEDs. Cached by its parameters. */
export function emissiveMat(key: MatKey, intensity: number, roughness = 0.35, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  const id = `emissive:${key}:${intensity}:${roughness}:${JSON.stringify(opts)}`;
  let m = materials.get(id) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: PALETTE[key], emissive: PALETTE[key], emissiveIntensity: intensity, roughness, metalness: 0, ...opts });
    materials.set(id, m);
  }
  return m;
}

/** Like emissiveMat but NOT cached: animated surfaces need their own material so each gate/sensor can carry
 *  its own phase. Used only for the handful of ambient-electronics channels. */
export function emissiveMatUnique(key: MatKey, intensity: number, roughness = 0.35): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: PALETTE[key], emissive: PALETTE[key], emissiveIntensity: intensity, roughness, metalness: 0 });
}

/** Soft additive light-spill plane (floor glow under a cove, screen wash). Transparent, no depth write. */
export function glowMat(key: MatKey, opacity: number): THREE.MeshBasicMaterial {
  const id = `glow:${key}:${opacity}`;
  let m = materials.get(id) as THREE.MeshBasicMaterial | undefined;
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: PALETTE[key], transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    materials.set(id, m);
  }
  return m;
}

/** Like glowMat but NOT cached: an animated glow needs its own material to carry its own opacity/tint. */
export function glowMatUnique(key: MatKey, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: PALETTE[key], transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
}

/** Contact-shadow disc/plate under furniture: a soft dark multiply plane just above the floor. */
export function contactShadowMat(opacity = 0.16): THREE.MeshBasicMaterial {
  const id = `contact:${opacity}`;
  let m = materials.get(id) as THREE.MeshBasicMaterial | undefined;
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: 0x3a2e24, transparent: true, opacity, depthWrite: false });
    materials.set(id, m);
  }
  return m;
}

/** A powered display: draw the UI into a canvas and use it as the emissive map so it reads lit, not painted.
 *  `draw` receives a 2D context of `w × h`; returns a plain screenMat when no canvas exists (tests). */
export function uiScreenMat(id: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, intensity = 0.9, unique = false): THREE.MeshStandardMaterial {
  const key = `ui:${id}`;
  let m = materials.get(key) as THREE.MeshStandardMaterial | undefined;
  // `unique` clones the cached material so an animated screen owns its emissiveIntensity; the canvas
  // texture itself is still shared (never redrawn per frame)
  if (m) return unique ? new THREE.MeshStandardMaterial({ color: 0x000000, map: m.map, emissive: 0xffffff, emissiveMap: m.emissiveMap, emissiveIntensity: intensity, roughness: 0.18, metalness: 0.05 }) : m;
  const ctx = canvas2d(w, h);
  if (!ctx) return screenMat();
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  m = new THREE.MeshStandardMaterial({ color: 0x000000, map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: intensity, roughness: 0.18, metalness: 0.05 });
  materials.set(key, m);
  return unique ? new THREE.MeshStandardMaterial({ color: 0x000000, map: m.map, emissive: 0xffffff, emissiveMap: m.emissiveMap, emissiveIntensity: intensity, roughness: 0.18, metalness: 0.05 }) : m;
}

/** Reception's façade / balustrade glass: the source glass is a cool teal-tinted pane and reads a little
 *  denser than the Design Room's. Separate material so the Design Room is untouched. */
export function facadeGlassMat(): THREE.MeshStandardMaterial {
  let m = materials.get("facadeGlass") as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: 0xbfe0e6, roughness: 0.06, metalness: 0.12, transparent: true, opacity: 0.5, side: THREE.DoubleSide, envMapIntensity: 1.4 });
    materials.set("facadeGlass", m);
  }
  return m;
}

export function glassMat(): THREE.MeshStandardMaterial {
  let m = materials.get("glass") as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: PALETTE.glass, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.42, side: THREE.DoubleSide, envMapIntensity: 1.2 });
    materials.set("glass", m);
  }
  return m;
}
