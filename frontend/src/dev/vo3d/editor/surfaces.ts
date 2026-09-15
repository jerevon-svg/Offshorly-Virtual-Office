// vo3d editor — THE SURFACE / MATERIAL REGISTRY.
//
// The editor never reaches into an arbitrary Three.js material, and the reason is not tidiness: the whole
// office shares ONE material cache (render/Materials). `mat("plaster", 0.95)` hands the SAME object to
// every wall in the building, so writing a colour into it would repaint eleven rooms at once and there
// would be no way back. So:
//
//   · a surface is ADDRESSABLE — builders tag a mesh (`userData.surface`), the registry groups tagged
//     meshes into named entries, and the panel only ever names an entry;
//   · a surface is COPY-ON-WRITE — the first edit clones the shared material into one this entry owns,
//     and the original object is kept so Reset can put it back byte-for-byte;
//   · a surface is BOUNDED — a spec is a preset plus four clamped scalars. There is no shader field, no
//     blending mode, no depth flag, nothing that can make a surface invisible or break the floor stack.
import * as THREE from "three";
import {
  PALETTE, TILE, TILE_PHASE, canvas2d, tileTexture, woodTexture, type MatKey,
} from "../render/Materials";
import { stoneDetail, stoneTint, terrazzoChips, weaveDetail, woodDetail } from "../render/detail";

export type SurfaceKind = "floor" | "wall";

/** What a builder writes onto a mesh to make it addressable. Pure data; no editor import in build/. */
export type SurfaceTag = {
  /** stable, human-readable: "qa-room/floor", "cms-room/wall" */
  id: string;
  kind: SurfaceKind;
  roomId: string;
  label: string;
  /** the treatment the room BUILT it as — the Reset target and the panel's starting point */
  preset: SurfacePresetId;
  /** world extent used to phase a swapped texture, so a new preset tiles at a real-world size */
  size: { u: number; v: number };
};

/** Tag a mesh as an editable surface. Called from the builders; returns the mesh so it can wrap a call. */
export function tagSurface<T extends THREE.Object3D>(o: T, tag: SurfaceTag): T {
  o.userData.surface = tag;
  return o;
}

// ---- approved presets ----------------------------------------------------------------------------
export const SURFACE_PRESETS = {
  tile: { label: "Tile", kinds: ["floor", "wall"], roughness: 0.42, scale: TILE, color: "tile" },
  terrazzo: { label: "Terrazzo", kinds: ["floor"], roughness: 0.5, scale: 55, color: "hubTerrazzo" },
  stone: { label: "Stone", kinds: ["floor", "wall"], roughness: 0.82, scale: 0, color: "floor" },
  concrete: { label: "Polished concrete", kinds: ["floor", "wall"], roughness: 0.34, scale: 0, color: "plinth" },
  wood: { label: "Wood", kinds: ["floor", "wall"], roughness: 0.62, scale: 120, color: "wood" },
  carpet: { label: "Carpet", kinds: ["floor"], roughness: 0.98, scale: 40, color: "rug" },
  plaster: { label: "Plaster", kinds: ["wall"], roughness: 0.95, scale: 0, color: "plaster" },
} as const satisfies Record<string, { label: string; kinds: readonly SurfaceKind[]; roughness: number; scale: number; color: MatKey }>;
export type SurfacePresetId = keyof typeof SURFACE_PRESETS;
export const SURFACE_PRESET_IDS = Object.keys(SURFACE_PRESETS) as SurfacePresetId[];
export const presetsFor = (kind: SurfaceKind): SurfacePresetId[] =>
  SURFACE_PRESET_IDS.filter((id) => (SURFACE_PRESETS[id].kinds as readonly string[]).includes(kind));

/** A surface treatment. Every field is clamped by `clampSpec`; there is nothing else to set. */
export type SurfaceSpec = {
  preset: SurfacePresetId;
  /** tint multiplied onto the preset's pattern (0xRRGGBB) */
  color: number;
  /** 0.5 … 1.5 — lightness of the tint, so a designer can darken a floor without hunting a new hex */
  brightness: number;
  /** 0.04 … 1 */
  roughness: number;
  /** 0 … 1 — how much of the preset's PATTERN survives (grout, chips, grain, weave). 0 = flat colour. */
  detail: number;
};
const clamp = (v: number, lo: number, hi: number): number => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);
export function clampSpec(s: SurfaceSpec): SurfaceSpec {
  return {
    preset: SURFACE_PRESETS[s.preset] ? s.preset : "stone",
    color: Math.max(0, Math.min(0xffffff, Math.round(s.color))),
    brightness: clamp(s.brightness, 0.5, 1.5),
    roughness: clamp(s.roughness, 0.04, 1),
    detail: clamp(s.detail, 0, 1),
  };
}
export const specFromTag = (tag: SurfaceTag): SurfaceSpec => {
  const p = SURFACE_PRESETS[tag.preset] ?? SURFACE_PRESETS.stone;
  return { preset: tag.preset, color: PALETTE[p.color], brightness: 1, roughness: p.roughness, detail: 1 };
};
export const sameSpec = (a: SurfaceSpec, b: SurfaceSpec): boolean =>
  a.preset === b.preset && a.color === b.color && a.brightness === b.brightness && a.roughness === b.roughness && a.detail === b.detail;

// ---- pattern fading ------------------------------------------------------------------------------
/** The pattern map of a preset, faded toward flat white by `1 − detail`.
 *
 *  three.js has no per-map intensity, so "surface detail 40%" is not a uniform anywhere — it is a texture.
 *  The base canvas is drawn onto white at alpha = detail, which is exactly a linear blend between the
 *  pattern and no pattern, and the result multiplies the tint the same way the original did. Cached by
 *  (preset, detail rounded to 5%), so dragging the slider builds at most twenty small canvases. */
const faded = new Map<string, THREE.Texture | null>();
function fadedPattern(id: SurfacePresetId, detail: number): THREE.Texture | null {
  const base = patternFor(id);
  if (!base) return null;
  const q = Math.round(detail * 20) / 20;
  if (q >= 1) return base;
  const key = `${id}:${q}`;
  const hit = faded.get(key);
  if (hit !== undefined) return hit;
  const img = base.image as HTMLCanvasElement | undefined;
  const ctx = img ? canvas2d(img.width, img.height) : null;
  if (!ctx || !img) { faded.set(key, base); return base; }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, img.width, img.height);
  ctx.globalAlpha = q;
  ctx.drawImage(img, 0, 0);
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = base.anisotropy;
  faded.set(key, tex);
  return tex;
}
function patternFor(id: SurfacePresetId): THREE.Texture | null {
  switch (id) {
    case "tile": return tileTexture();
    case "terrazzo": return terrazzoChips();
    case "wood": return woodTexture();
    case "carpet": return weaveDetail();
    case "stone": return stoneTint();
    default: return null; // concrete and plaster are FLAT treatments: their only breakup is the roughness map
  }
}
const roughnessFor = (id: SurfacePresetId): THREE.Texture | null =>
  id === "wood" ? woodDetail("box") : id === "carpet" ? weaveDetail() : stoneDetail();

/** Build the material a spec describes for a surface of this size. Never cached across surfaces: each
 *  entry owns its material outright, which is the whole point of copy-on-write. */
export function surfaceMaterial(spec: SurfaceSpec, tag: SurfaceTag): THREE.MeshStandardMaterial {
  const p = SURFACE_PRESETS[spec.preset];
  const base = fadedPattern(spec.preset, spec.detail);
  const map = base ? base.clone() : null;
  if (map) {
    map.needsUpdate = true;
    if (p.scale > 0) {
      // Box top/side faces carry 0..1 UVs, so the REPEAT is what phases the pattern to world units. The
      // tile preset keeps the office's own grout phase, so a retreated floor still lines up with the hall.
      map.repeat.set(tag.size.u / p.scale, -tag.size.v / p.scale);
      if (spec.preset === "tile") map.offset.set(-TILE_PHASE.x / TILE, -TILE_PHASE.z / TILE);
    }
  }
  const c = new THREE.Color(spec.color).multiplyScalar(spec.brightness);
  const rough = roughnessFor(spec.preset);
  const m = new THREE.MeshStandardMaterial({
    color: c, map, roughness: spec.roughness, metalness: 0,
    roughnessMap: spec.detail > 0.02 ? rough : null,
    ...(spec.preset === "carpet" && spec.detail > 0.02 ? { bumpMap: weaveDetail(), bumpScale: 0.12 * spec.detail } : {}),
  });
  m.name = `surface:${tag.id}`;
  return m;
}

// ---- the registry --------------------------------------------------------------------------------
type Owned = { mesh: THREE.Mesh; original: THREE.Material | THREE.Material[] };

export class SurfaceEntry {
  readonly tag: SurfaceTag;
  readonly meshes: Owned[] = [];
  /** the treatment the room was BUILT with — Reset's target */
  readonly base: SurfaceSpec;
  /** the last APPLIED treatment; Cancel returns here */
  committed: SurfaceSpec;
  /** what is on screen right now (may be uncommitted) */
  preview: SurfaceSpec;
  private owned: THREE.Material | null = null;

  constructor(tag: SurfaceTag) {
    this.tag = tag;
    this.base = specFromTag(tag);
    this.committed = { ...this.base };
    this.preview = { ...this.base };
  }
  get id(): string { return this.tag.id; }
  get pending(): boolean { return !sameSpec(this.preview, this.committed); }

  /** Put `spec` on screen. The first call clones the shared cache material away; later calls rebuild the
   *  material this entry already owns, so the cache is touched exactly once per surface. */
  show(spec: SurfaceSpec, retarget?: (from: THREE.Material, to: THREE.Material) => void): void {
    const next = clampSpec(spec);
    this.preview = next;
    const m = surfaceMaterial(next, this.tag);
    const prev = this.owned;
    for (const o of this.meshes) o.mesh.material = m;
    if (prev) { retarget?.(prev, m); prev.dispose(); }
    else for (const o of this.meshes) if (!Array.isArray(o.original)) retarget?.(o.original, m);
    this.owned = m;
  }
  /** back to the last applied treatment */
  cancel(retarget?: (from: THREE.Material, to: THREE.Material) => void): void {
    if (sameSpec(this.preview, this.committed)) return;
    if (sameSpec(this.committed, this.base)) this.restore(retarget);
    else this.show({ ...this.committed }, retarget);
    this.preview = { ...this.committed };
  }
  /** make the preview the committed treatment */
  apply(): SurfaceSpec {
    this.committed = { ...this.preview };
    return this.committed;
  }
  /** back to the material the ROOM built, objects and all */
  reset(retarget?: (from: THREE.Material, to: THREE.Material) => void): void {
    this.restore(retarget);
    this.committed = { ...this.base };
    this.preview = { ...this.base };
  }
  private restore(retarget?: (from: THREE.Material, to: THREE.Material) => void): void {
    const prev = this.owned;
    for (const o of this.meshes) o.mesh.material = o.original;
    if (prev) {
      const first = this.meshes[0];
      if (first && !Array.isArray(first.original)) retarget?.(prev, first.original);
      prev.dispose();
    }
    this.owned = null;
  }
  dispose(): void { this.owned?.dispose(); this.owned = null; }
}

export class SurfaceRegistry {
  private readonly entries = new Map<string, SurfaceEntry>();
  private readonly byRoom = new Map<string, string[]>();
  /** called whenever a material object is swapped, so the ambient system keeps writing to a LIVE material */
  retarget: ((from: THREE.Material, to: THREE.Material) => void) | undefined;

  /** Gather every tagged mesh in a freshly built room group. Idempotent per room (a rebuild replaces). */
  collect(roomId: string, root: THREE.Object3D): number {
    this.clearRoom(roomId);
    const ids: string[] = [];
    root.traverse((o) => {
      const tag = o.userData.surface as SurfaceTag | undefined;
      const mesh = o as THREE.Mesh;
      if (!tag || !mesh.isMesh) return;
      let entry = this.entries.get(tag.id);
      if (!entry) { entry = new SurfaceEntry(tag); this.entries.set(tag.id, entry); ids.push(tag.id); }
      entry.meshes.push({ mesh, original: mesh.material });
    });
    this.byRoom.set(roomId, ids);
    return ids.length;
  }
  clearRoom(roomId: string): void {
    for (const id of this.byRoom.get(roomId) ?? []) { this.entries.get(id)?.dispose(); this.entries.delete(id); }
    this.byRoom.delete(roomId);
  }
  get(id: string): SurfaceEntry | null { return this.entries.get(id) ?? null; }
  all(): SurfaceEntry[] { return [...this.entries.values()]; }
  inRoom(roomId: string): SurfaceEntry[] { return this.all().filter((e) => e.tag.roomId === roomId); }
  get size(): number { return this.entries.size; }

  show(id: string, spec: SurfaceSpec): void { this.get(id)?.show(spec, this.retarget); }
  cancel(id: string): void { this.get(id)?.cancel(this.retarget); }
  reset(id: string): void { this.get(id)?.reset(this.retarget); }
  /** replay a recorded spec (undo/redo). `base` restores the room's own material objects. */
  replay(id: string, spec: SurfaceSpec): void {
    const e = this.get(id);
    if (!e) return;
    if (sameSpec(spec, e.base)) e.reset(this.retarget);
    else { e.show(spec, this.retarget); e.apply(); }
  }
}

/** The nearest addressable surface at or above `o`, or null. */
export function surfaceTagOf(o: THREE.Object3D | null): SurfaceTag | null {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) {
    const tag = n.userData.surface as SurfaceTag | undefined;
    if (tag) return tag;
  }
  return null;
}
