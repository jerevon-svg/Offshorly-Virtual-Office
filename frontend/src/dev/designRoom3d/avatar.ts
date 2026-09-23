// Design Room true-3D POC — CHARACTER + 3D WORLD compatibility proof.
//
// Loads ONE existing production avatar GLB (Bon's shipped live-3D set,
// public/avatars/bon-v3-hq-idle9, read-only) into the same Three.js depth
// scene as the room, plays its baked "idle-9" / "walking" clips, and walks it
// along explicit safe waypoints. No DOM sorting, no overlay canvas: depth,
// occlusion and shadows come from the one real scene.
//
// The production stage renders this model UNLIT (MeshBasicMaterial) into a
// per-character canvas; here the same base-colour map is put on a lit
// standard material so the character can receive scene light and shadows.
// A toggle restores the unlit production look for comparison.
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { ROOM, SHELL, FURNITURE, BAKED, type Rect } from "./layout";

export type Ground = { x: number; z: number };

const BASE = import.meta.env.BASE_URL;
export const AVATAR_LODS = {
  0: `${BASE}avatars/bon-v3-hq-idle9/bon-v3-lod0.glb`,
  1: `${BASE}avatars/bon-v3-hq-idle9/bon-v3-lod1.glb`,
  2: `${BASE}avatars/bon-v3-hq-idle9/bon-v3-lod2.glb`,
} as const;
export type AvatarLod = keyof typeof AVATAR_LODS;

// Production clip names (render3d/characterAnimationState.ts). Only these two are used here.
export const CLIP_IDLE = "idle-9";
export const CLIP_WALK = "walking";

// ---- scripted route (room-relative frame units, x east / z south) --------------------
// Explicit safe waypoints only. The desk U is closed on the west, south and
// east and open to the NORTH, and the lounge is reachable only along the
// corridor between the bottom-row chairs and the bottom cabinets. So: glass
// door → south-east floor → that corridor → lounge → back east → north aisle
// → into the U (workstations, centre, left aisle) → lead desk → back east.
export type Waypoint = { x: number; z: number; label: string };
export const ROUTE: readonly Waypoint[] = [
  { x: 298, z: 125, label: "entrance (glass door)" },
  { x: 270, z: 190, label: "south-east open floor" },
  { x: 200, z: 192, label: "corridor south of the chairs" },
  { x: 112, z: 196, label: "lounge (by the beanbag)" },
  { x: 200, z: 192, label: "corridor south of the chairs" },
  { x: 270, z: 190, label: "south-east open floor" },
  { x: 290, z: 56, label: "north-east aisle" },
  { x: 200, z: 56, label: "north aisle" },
  { x: 200, z: 125, label: "workstations (right inner aisle)" },
  { x: 155, z: 125, label: "inside the U" },
  { x: 108, z: 125, label: "left inner aisle" },
  { x: 108, z: 56, label: "north aisle (west)" },
  { x: 155, z: 56, label: "lead desk (north side)" },
  { x: 290, z: 56, label: "north-east aisle" },
];

/** Rects a walking character must never overlap (furniture + baked cabinets), with a small margin. */
export function blockedRects(margin = 1.5): Rect[] {
  const grow = (r: Rect): Rect => ({ x: r.x - margin, z: r.z - margin, w: r.w + 2 * margin, d: r.d + 2 * margin });
  const out: Rect[] = FURNITURE.filter((f) => f.kind !== "rug").map((f) => grow(f.rect));
  out.push(grow(BAKED.rearCabinet), ...BAKED.bottomCabinets.map(grow), grow(BAKED.plantRack));
  return out;
}
export function pointInRect(x: number, z: number, r: Rect): boolean {
  return x >= r.x && x <= r.x + r.w && z >= r.z && z <= r.z + r.d;
}
export function insideFloor(x: number, z: number): boolean {
  const T = SHELL.wallThickness;
  return x > T && x < ROOM.width - T && z > T && z < SHELL.frontWallZ;
}

/** Heading (radians, rotation.y) that makes the model face a movement direction. Model forward = +z at 0. */
export function headingFor(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}
export function stepAngle(from: number, to: number, maxStep: number): number {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return from + Math.max(-maxStep, Math.min(maxStep, d));
}

// ---- loading ------------------------------------------------------------------------
let loader: GLTFLoader | null = null;
function gltfLoader(): GLTFLoader {
  if (loader) return loader;
  const draco = new DRACOLoader();
  draco.setDecoderPath(`${BASE}vendor/draco/`); // same decoder files the production stage ships
  loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  return loader;
}

export type AvatarOptions = {
  /** standing height in world units; the manifest sprite box for bon is 37.2 units tall */
  height: number;
  lit: boolean;
};

export class Avatar {
  readonly root = new THREE.Group();
  readonly model = new THREE.Group();
  mixer: THREE.AnimationMixer | null = null;
  private actions: Record<string, THREE.AnimationAction> = {};
  private current: string | null = null;
  private litMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private unlitMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  gltf: GLTF | null = null;
  /** native model height before scaling, for the report */
  nativeHeight = 0;
  triangles = 0;
  heading = 0;
  // movement: a queue of ground waypoints; empty queue = idle
  path: Ground[] = [];
  /** when true and the queue drains, the scripted demo ROUTE is re-queued (loop) */
  loopRoute = false;
  playing = true;
  walkOverride: "auto" | "idle" | "walk" = "auto";
  speed = 30; // units per second
  /** callback when a queued path is fully consumed */
  onArrive: (() => void) | null = null;
  /** "controlled": an interaction owns movement + clips; update() only advances the mixer */
  mode: "free" | "controlled" = "free";
  private walkAction: THREE.AnimationAction | null = null;
  private opts: AvatarOptions;

  constructor(opts: AvatarOptions) {
    this.opts = opts;
    this.root.add(this.model);
    this.root.name = "avatar";
  }

  async load(lod: AvatarLod): Promise<void> {
    const gltf = await gltfLoader().loadAsync(AVATAR_LODS[lod]);
    this.dispose();
    this.gltf = gltf;
    const scene = gltf.scene;
    // measure + ground + scale
    scene.rotation.y = 0;
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    this.nativeHeight = box.max.y - box.min.y;
    const s = this.opts.height / this.nativeHeight;
    scene.scale.setScalar(s);
    scene.position.set(-(box.min.x + box.max.x) / 2 * s, -box.min.y * s, -(box.min.z + box.max.z) / 2 * s); // feet on y=0, centred on x/z
    this.triangles = 0;
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false; // skinned bounds do not follow the animation
      const geo = m.geometry;
      const idx = geo.getIndex();
      this.triangles += idx ? idx.count / 3 : geo.getAttribute("position").count / 3;
      const src = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[];
      const lit = src.map((sm) => {
        const mm = new THREE.MeshStandardMaterial({ map: sm.map ?? null, color: sm.color?.clone() ?? new THREE.Color(0xffffff), roughness: 0.9, metalness: 0, side: sm.side, transparent: sm.transparent, opacity: sm.opacity, alphaTest: sm.alphaTest });
        if (mm.map) mm.map.anisotropy = 8;
        return mm;
      });
      const unlit = src.map((sm) => new THREE.MeshBasicMaterial({ map: sm.map ?? null, color: sm.color?.clone() ?? new THREE.Color(0xffffff), side: sm.side, transparent: sm.transparent, opacity: sm.opacity, alphaTest: sm.alphaTest }));
      this.litMaterials.set(m, Array.isArray(m.material) ? lit : lit[0]);
      this.unlitMaterials.set(m, Array.isArray(m.material) ? unlit : unlit[0]);
      m.material = this.opts.lit ? this.litMaterials.get(m)! : this.unlitMaterials.get(m)!;
    });
    this.model.add(scene);
    this.mixer = new THREE.AnimationMixer(scene);
    for (const clip of gltf.animations) this.actions[clip.name] = this.mixer.clipAction(clip);
    this.walkAction = this.actions[CLIP_WALK] ?? null;
    this.current = null;
    this.play(CLIP_IDLE, 0);
    this.resetRoute(false);
  }

  setLit(lit: boolean): void {
    this.opts.lit = lit;
    for (const [m, mat] of lit ? this.litMaterials : this.unlitMaterials) m.material = mat;
  }
  setHeight(h: number): void {
    this.opts.height = h;
    if (this.gltf) {
      const scene = this.gltf.scene;
      const s = h / this.nativeHeight;
      const box = new THREE.Box3();
      scene.scale.setScalar(1);
      scene.position.set(0, 0, 0);
      scene.updateMatrixWorld(true);
      box.setFromObject(scene);
      scene.scale.setScalar(s);
      scene.position.set(-(box.min.x + box.max.x) / 2 * s, -box.min.y * s, -(box.min.z + box.max.z) / 2 * s);
    }
  }

  play(name: string, fade = 0.25): void {
    if (this.current === name) return;
    const next = this.actions[name];
    if (!next) return;
    const prev = this.current ? this.actions[this.current] : null;
    next.reset().setEffectiveWeight(1).play();
    if (prev && fade > 0) prev.crossFadeTo(next, fade, false);
    else if (prev) prev.stop();
    this.current = name;
  }
  get currentClip(): string | null {
    return this.current;
  }

  /** Teleport to the demo route's entrance, clear the queue; optionally start the demo loop. */
  resetRoute(startDemo = false): void {
    const w = ROUTE[0];
    this.root.position.set(w.x, 0, w.z);
    const n = ROUTE[1];
    this.heading = headingFor(n.x - w.x, n.z - w.z);
    this.root.rotation.set(0, this.heading, 0); // full set: never leave x/z residue from a prior re-parent
    this.path = [];
    this.loopRoute = startDemo;
    if (startDemo) this.path = ROUTE.slice(1).map((p) => ({ x: p.x, z: p.z }));
  }
  /** Replace the current destination with a new path (repeated clicks redirect cleanly). */
  setPath(path: Ground[]): void {
    this.loopRoute = false;
    this.path = path.filter((p, i) => i === 0 || Math.hypot(p.x - path[i - 1].x, p.z - path[i - 1].z) > 1e-6);
  }
  get moving(): boolean {
    return this.path.length > 0;
  }
  get position(): Ground {
    return { x: this.root.position.x, z: this.root.position.z };
  }

  /** Consume the path queue by dt seconds (movement + turning + clip). Used by update() and by interactions. */
  stepPath(dt: number, driveClips: boolean): void {
    if (this.path.length === 0 && this.loopRoute) this.path = ROUTE.map((p) => ({ x: p.x, z: p.z }));
    const wantsWalk = this.walkOverride === "walk" || (this.walkOverride === "auto" && this.playing && this.path.length > 0);
    if (this.playing && this.path.length > 0 && this.walkOverride !== "idle") {
      let remaining = this.speed * dt;
      const pos = this.root.position;
      while (remaining > 0 && this.path.length > 0) {
        const tgt = this.path[0];
        const dx = tgt.x - pos.x, dz = tgt.z - pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= remaining) {
          pos.set(tgt.x, 0, tgt.z);
          remaining -= dist;
          this.path.shift();
          if (this.path.length === 0 && !this.loopRoute) this.onArrive?.();
        } else {
          pos.x += (dx / dist) * remaining;
          pos.z += (dz / dist) * remaining;
          remaining = 0;
        }
      }
      const next = this.path[0];
      if (next) {
        const target = headingFor(next.x - pos.x, next.z - pos.z);
        this.heading = stepAngle(this.heading, target, dt * 7); // ~0.14 s for a 90° turn
        this.root.rotation.set(0, this.heading, 0); // full set: never leave x/z residue from a prior re-parent
      }
    }
    if (driveClips) {
      const walking = wantsWalk && (this.path.length > 0 || this.walkOverride === "walk");
      this.play(walking ? CLIP_WALK : CLIP_IDLE);
      if (this.walkAction) this.walkAction.timeScale = walking ? this.speed / 30 : 1; // stride matches ground speed at 30 u/s
    }
  }

  /** Advance by dt seconds. In "free" mode this walks the queue; in "controlled" mode the owner moves the root. */
  update(dt: number): void {
    if (this.mode === "free") this.stepPath(dt, true);
    this.mixer?.update(dt);
  }

  dispose(): void {
    if (this.gltf) {
      this.mixer?.stopAllAction();
      this.model.remove(this.gltf.scene);
      this.gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
    }
    this.litMaterials.clear();
    this.unlitMaterials.clear();
    this.actions = {};
    this.gltf = null;
    this.mixer = null;
  }
}

/** Small marker spheres + connecting line for the waypoints. */
export function routeMarkers(): THREE.Group {
  const g = new THREE.Group();
  g.name = "route-markers";
  const geo = new THREE.SphereGeometry(1.6, 12, 8);
  const m = new THREE.MeshStandardMaterial({ color: 0xe0563f, roughness: 0.6, emissive: 0x7a2416, emissiveIntensity: 0.4 });
  for (const w of ROUTE) {
    const s = new THREE.Mesh(geo, m);
    s.position.set(w.x, 1.8, w.z);
    g.add(s);
  }
  const pts = [...ROUTE, ROUTE[0]].map((w) => new THREE.Vector3(w.x, 0.6, w.z));
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xe0563f, transparent: true, opacity: 0.6 })));
  return g;
}
