// vo3d media — THE 270° MEETING GALLERY: the call's cameras, laid out on the wrap.
//
// WHAT IT IS. Everything here is a VIEW of tracks the existing LiveKit store already holds
// (callStore's videoByIdentity — local and remote cameras in one identity-keyed map). It opens no
// room, subscribes to nothing, and publishes nothing. Give it a list of {identity, track} and a
// mode, and it puts them on the ribbon; give it an empty list and it disappears without trace.
//
// WHY TILES ARE STRIPS OF THE RIBBON. A flat quad big enough to be cinematic cuts through the 96-
// radius corners. build/cave.ts's ribbonStripGeometry follows the real path instead, so a tile
// hugs the screen wherever the layout puts it — which is what lets the gallery reflow across the
// curve as people join and leave. Geometry is rebuilt ONLY when the layout actually changes (a
// join, a leave, a camera toggle, a source that changed shape); a steady meeting allocates nothing
// per frame, and every discarded geometry is disposed on the spot.
//
// WHY THE SOLO CASE HAS NO TILE. One camera should own the room, and the honest way to do that is
// not a big stretched quad: the true-aspect copy goes on the front panel (the same 320 × 180 panel
// a screen share uses) and the wrap carries a DIMMED continuation of the same texture. This class
// therefore exposes `solo` and draws nothing in that state — see bootstrap's applyCaveMode.
//
// AUDIO IS NEVER TOUCHED. Every element here is muted, exactly like CavePresentation's: the call's
// audio is played once, by callStore's own hidden elements, and nothing in the CAVE may duplicate it.
import * as THREE from "three";
import { ribbonStripGeometry, samplePath, frontChordRange, type CaveBuild, type PathSample } from "../build/cave";
import { SCREEN } from "../rooms/cave";
import type { PresentationSource } from "./CavePresentation";

/** One participant's live camera, as the store already models it. */
export type GalleryCamera = { identity: string; track: PresentationSource };

/** "off" = nothing · "full" = the whole wrap is the gallery · "wings" = a share owns the front. */
export type GalleryMode = "off" | "full" | "wings";

/** HOW MANY CAMERAS ARE DRAWN AT ONCE.
 *
 *  This is the scaling decision, and it is deliberate. Every drawn tile costs one <video> decoding
 *  a live stream plus one texture upload per frame — the expensive half of a call — while an
 *  undrawn participant costs only what LiveKit is already doing for the call's audio. At an All
 *  Hands the answer is NOT "70 tiles at 12 units wide"; it is a bounded stage, and everyone else
 *  is present in the meeting without being decoded. Twelve is a full 270° wall at a size a face is
 *  still readable at (≈83 arc units wide on a 1021-unit wrap). The natural next step, when it is
 *  wanted, is to drive LiveKit's own setSubscribed/setVideoQuality from exactly this list. */
export const MAX_TILES = 12;

/** arc units of breathing room between tiles, and at each end of a region */
const GAP = 10;
/** with a share on the front panel the wings are SUPPORTING cast: tiles cap out at this fraction */
const WING_HEIGHT = 0.5;
const LABEL_HEIGHT = 11;
/** the image band a tile may occupy: the screen's own height, less the name strip under it */
export const TILE_BAND = SCREEN.height - LABEL_HEIGHT;

export type TileSlot = { s0: number; s1: number; y: number; height: number };

/**
 * THE LAYOUT, as pure arithmetic — no three.js, no DOM, which is why it can be tested exhaustively.
 *
 * One row, centred on the front chord, fitted to each source's OWN aspect:
 *   * a tile is never stretched: its width is its height × its own aspect, and both are clamped
 *     to the slot it was given, so an odd-shaped source shrinks rather than distorts
 *   * 2–4 people therefore get big cinematic tiles across the chord and the corners
 *   * more people reflow outward along the wings, shrinking only as far as they must
 *   * with a share on the front panel the front chord is EXCLUDED and the tiles split between the
 *     two wings, alternating so the two sides fill evenly
 */
export function galleryLayout(
  aspects: number[],
  opts: { total: number; front: { s0: number; s1: number }; mode: GalleryMode },
): TileSlot[] {
  if (opts.mode === "off" || aspects.length === 0) return [];
  const regions =
    opts.mode === "wings"
      ? [{ a: 0, b: opts.front.s0 }, { a: opts.front.s1, b: opts.total }]
      : [{ a: 0, b: opts.total }];
  const maxH = opts.mode === "wings" ? TILE_BAND * WING_HEIGHT : TILE_BAND;
  // Alternate across regions so two wings fill evenly; one region takes everybody.
  const buckets: number[][] = regions.map(() => []);
  aspects.forEach((_, i) => buckets[i % regions.length].push(i));

  const out: TileSlot[] = new Array(aspects.length);
  regions.forEach((region, r) => {
    const idx = buckets[r];
    if (idx.length === 0) return;
    const span = region.b - region.a;
    const slot = (span - GAP * (idx.length + 1)) / idx.length;
    if (slot <= 1) return; // nowhere to put anything: draw nothing rather than a sliver
    const widths = idx.map((i) => {
      const aspect = Number.isFinite(aspects[i]) && aspects[i] > 0 ? aspects[i] : 16 / 9;
      let h = Math.min(maxH, slot / aspect);
      let w = h * aspect;
      if (w > slot) { w = slot; h = w / aspect; }
      return { w, h };
    });
    const used = widths.reduce((t, x) => t + x.w, 0) + GAP * (idx.length - 1);
    let cursor = region.a + (span - used) / 2;
    idx.forEach((i, k) => {
      const { w, h } = widths[k];
      out[i] = {
        s0: cursor,
        s1: cursor + w,
        height: h,
        // Centred in the image band, with the label's strip left below it.
        y: SCREEN.bottom + LABEL_HEIGHT + (SCREEN.height - LABEL_HEIGHT - h) / 2,
      };
      cursor += w + GAP;
    });
  });
  return out.filter(Boolean);
}

type Source = {
  identity: string;
  track: PresentationSource;
  el: HTMLVideoElement;
  texture: THREE.VideoTexture;
  aspect: number;
};

type Tile = {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  label: THREE.Mesh;
  labelMaterial: THREE.MeshBasicMaterial;
};

export class CaveGallery {
  private readonly group = new THREE.Group();
  private readonly samples: PathSample[];
  private readonly front: { s0: number; s1: number; total: number };
  /** track -> its element and texture. Keyed by TRACK so a participant who turns their camera off
   *  and on again is a new entry, and a re-layout never re-creates an element that is still live. */
  private readonly sources = new Map<PresentationSource, Source>();
  private readonly labels = new Map<string, THREE.CanvasTexture>();
  private tiles: Tile[] = [];
  private cameras: GalleryCamera[] = [];
  private mode: GalleryMode = "off";
  private active = false;
  private dirty = false;
  readonly state = { mode: "off" as GalleryMode, cameras: 0, drawn: 0, hidden: 0, names: "" };

  constructor(build: CaveBuild) {
    this.samples = samplePath();
    this.front = frontChordRange(this.samples);
    this.group.name = "cave-meeting-gallery";
    this.group.visible = false;
    build.group.add(this.group);
  }

  /** The only camera in the meeting, for the immersive single-speaker view — null otherwise. */
  get solo(): { texture: THREE.VideoTexture; aspect: number } | null {
    if (this.cameras.length !== 1) return null;
    const s = this.sources.get(this.cameras[0].track);
    return s ? { texture: s.texture, aspect: s.aspect } : null;
  }

  get count(): number {
    return this.cameras.length;
  }

  /** Told by the CAVE: true on entering, false on leaving. Leaving frees every element and texture
   *  and keeps the camera LIST, so walking back in costs one attach per visible tile and nothing
   *  is ever unsubscribed from the meeting. */
  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    this.dirty = true;
    this.sync();
  }

  /** Told by the bridge whenever the call's camera set changes. Cheap and idempotent: an unchanged
   *  list (same identities, same track objects, same order) returns without touching anything. */
  setCameras(next: GalleryCamera[]): void {
    if (sameCameras(this.cameras, next)) return;
    this.cameras = next.slice(0, MAX_TILES * 4); // bounded: the list itself is never unbounded work
    this.dirty = true;
    this.sync();
  }

  /** Told by bootstrap: what the wrap is being used for right now. */
  setMode(mode: GalleryMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.dirty = true;
    this.sync();
  }

  /** Per-frame while inside. Reads two numbers per drawn source; relayouts only if a shape changed. */
  sample(): void {
    if (!this.active) return;
    for (const s of this.sources.values()) {
      const w = s.el.videoWidth, h = s.el.videoHeight;
      if (w <= 0 || h <= 0) continue;
      const aspect = w / h;
      if (Math.abs(aspect - s.aspect) < 1e-3) continue;
      s.aspect = aspect;
      this.dirty = true;
    }
    if (this.dirty) this.sync();
  }

  /** True once per change, so the caller re-applies the CAVE's mode only when something moved. */
  consumeChange(): boolean {
    const d = this.dirty;
    this.dirty = false;
    return d;
  }

  private sync(): void {
    const drawnCameras = this.active && this.mode !== "off" ? this.cameras.slice(0, MAX_TILES) : [];
    // A solo camera is shown by the front panel + the ambient wrap, not by a tile (see the header).
    const tiled = this.mode === "full" && drawnCameras.length === 1 ? [] : drawnCameras;
    // The SOLO source still needs its element, so elements follow drawnCameras, not `tiled`.
    this.reconcileSources(drawnCameras);
    const slots = galleryLayout(tiled.map((c) => this.sources.get(c.track)?.aspect ?? 16 / 9), {
      total: this.front.total, front: this.front, mode: this.mode,
    });
    this.drawTiles(tiled, slots);
    this.group.visible = this.active && slots.length > 0;
    this.state.mode = this.mode;
    this.state.cameras = this.cameras.length;
    this.state.drawn = slots.length;
    this.state.hidden = Math.max(0, this.cameras.length - drawnCameras.length);
    this.state.names = tiled.map((c) => shortName(c.identity)).join(", ");
    this.trimLabels();
  }

  /** Create an element+texture for every camera that should be live, drop the rest. */
  private reconcileSources(wanted: GalleryCamera[]): void {
    const keep = new Set(wanted.map((c) => c.track));
    for (const [track, s] of this.sources) {
      if (keep.has(track)) continue;
      this.sources.delete(track);
      releaseSource(s);
    }
    if (typeof document === "undefined") return;
    for (const cam of wanted) {
      if (this.sources.has(cam.track)) continue;
      const el = document.createElement("video");
      // MUTED, always: the meeting's audio is callStore's and is played exactly once.
      el.muted = true;
      el.autoplay = true;
      el.playsInline = true;
      el.dataset.caveCamera = cam.identity;
      el.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-10px;top:-10px";
      document.body.appendChild(el);
      cam.track.attach(el);
      const texture = new THREE.VideoTexture(el);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      this.sources.set(cam.track, { identity: cam.identity, track: cam.track, el, texture, aspect: 16 / 9 });
      // jsdom (and a headless run) can return nothing at all from play(); never throw into a frame.
      const attempt = el.play();
      if (attempt) void attempt.catch(() => {});
    }
  }

  /** Name textures are cheap and reused across reflows, but an All Hands must not accumulate one
   *  per person who ever turned a camera on: past a couple of screenfuls, drop the ones nobody in
   *  the current list needs. */
  private trimLabels(): void {
    if (this.labels.size <= MAX_TILES * 2) return;
    const live = new Set(this.cameras.map((c) => c.identity));
    for (const [identity, tex] of this.labels) {
      if (live.has(identity)) continue;
      tex.dispose();
      this.labels.delete(identity);
    }
  }

  private drawTiles(cameras: GalleryCamera[], slots: TileSlot[]): void {
    for (let i = 0; i < Math.max(slots.length, this.tiles.length); i++) {
      const slot = slots[i];
      if (!slot) { const t = this.tiles[i]; if (t) { t.mesh.visible = false; t.label.visible = false; } continue; }
      const tile = this.tiles[i] ?? this.makeTile();
      const source = this.sources.get(cameras[i].track);
      // Geometry is per-layout: dispose the old strip rather than leaking one per reflow.
      tile.mesh.geometry.dispose();
      tile.mesh.geometry = ribbonStripGeometry(this.samples, slot.s0, slot.s1, slot.y, slot.height);
      tile.label.geometry.dispose();
      tile.label.geometry = ribbonStripGeometry(
        this.samples, slot.s0, slot.s1, slot.y - LABEL_HEIGHT, LABEL_HEIGHT, 1.0,
      );
      tile.material.map = source?.texture ?? null;
      tile.material.color.setHex(source ? 0xffffff : 0x000000);
      tile.material.needsUpdate = true;
      tile.labelMaterial.map = this.labelTexture(cameras[i].identity);
      tile.labelMaterial.needsUpdate = true;
      tile.mesh.visible = true;
      tile.label.visible = true;
    }
  }

  private makeTile(): Tile {
    const material = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false, fog: false, side: THREE.FrontSide });
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    mesh.castShadow = mesh.receiveShadow = false;
    mesh.name = "cave-gallery-tile";
    const labelMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff, toneMapped: false, fog: false, transparent: true, depthWrite: false, side: THREE.FrontSide,
    });
    const label = new THREE.Mesh(new THREE.BufferGeometry(), labelMaterial);
    label.castShadow = label.receiveShadow = false;
    label.name = "cave-gallery-label";
    this.group.add(mesh, label);
    const tile: Tile = { mesh, material, label, labelMaterial };
    this.tiles.push(tile);
    return tile;
  }

  /** One small canvas per NAME, cached: a reflow re-uses it, and a meeting of twelve holds twelve. */
  private labelTexture(identity: string): THREE.CanvasTexture | null {
    const cached = this.labels.get(identity);
    if (cached) return cached;
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = 512; canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.clearRect(0, 0, 512, 64);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, 512, 64);
    ctx.fillStyle = "#e8eef7";
    ctx.font = "600 34px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(shortName(identity), 16, 34, 480);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    this.labels.set(identity, tex);
    return tex;
  }

  dispose(): void {
    for (const [, s] of this.sources) releaseSource(s);
    this.sources.clear();
    for (const t of this.tiles) {
      t.mesh.geometry.dispose(); t.material.dispose();
      t.label.geometry.dispose(); t.labelMaterial.dispose();
    }
    this.tiles = [];
    for (const [, tex] of this.labels) tex.dispose();
    this.labels.clear();
    this.group.clear();
    this.cameras = [];
    this.mode = "off";
    this.active = false;
  }
}

function releaseSource(s: Source): void {
  s.texture.dispose();
  try {
    // ALWAYS with its own element: a bare detach() would rip the app's own tiles off the same track.
    s.track.detach(s.el);
  } catch {
    // Track already ended — clearing the element below is still the right cleanup.
  }
  s.el.pause();
  s.el.srcObject = null;
  s.el.remove();
}

function sameCameras(a: GalleryCamera[], b: GalleryCamera[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((c, i) => c.track === b[i].track && c.identity === b[i].identity);
}

/** "bon@offshorly.com" -> "bon". Identity is all the store has, and all a subtle label needs. */
export function shortName(identity: string): string {
  const local = identity.split("@")[0] ?? identity;
  return local.replace(/[._-]+/g, " ").trim() || identity;
}
