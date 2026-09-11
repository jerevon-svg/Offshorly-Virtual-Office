// vo3d render — shared material cache + the office palette (warm cream / wood / olive).
// Promoted from designRoom3d/build.ts (materials block) and layout.ts (PALETTE). ONE cache for the scene.
import * as THREE from "three";

export const PALETTE = {
  floor: 0xf0e8e2,
  exterior: 0xd9cbbf,
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
export function glassMat(): THREE.MeshStandardMaterial {
  let m = materials.get("glass") as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: PALETTE.glass, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.42, side: THREE.DoubleSide, envMapIntensity: 1.2 });
    materials.set("glass", m);
  }
  return m;
}
