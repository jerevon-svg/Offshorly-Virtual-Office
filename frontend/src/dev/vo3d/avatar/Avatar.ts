// vo3d avatar — production GLB/LOD/clip loading and animation. NO movement logic here: the root is
// moved only by the active controller owner (avatar/Controller.ts) or an interaction that owns it.
// INVARIANT: every writer of the root's orientation sets the COMPLETE rotation (rotation.set(0, yaw, 0)).
// Object3D.attach re-derives Euler angles from the world quaternion; at yaw ≈ π that yields (±π, 0, ±π),
// and a later `rotation.y = …` would mirror the heading (the backward-walking regression).
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { BON_LODS, CLIP_IDLE, CLIP_SIT, CLIP_SIT_ANSWER, DRACO_PATH, type AvatarLod } from "../adapters/v1Avatar";
import type { Vec2 } from "../core/coords";

let loader: GLTFLoader | null = null;
function gltfLoader(): GLTFLoader {
  if (loader) return loader;
  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_PATH);
  loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  return loader;
}

export class Avatar {
  readonly root = new THREE.Group();
  private readonly model = new THREE.Group();
  mixer: THREE.AnimationMixer | null = null;
  gltf: GLTF | null = null;
  private actions: Record<string, THREE.AnimationAction> = {};
  private current: string | null = null;
  private litMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private unlitMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  nativeHeight = 0;
  triangles = 0;
  /** authoritative yaw (radians); the root's rotation is always exactly (0, yaw, 0) in its parent */
  yaw = 0;
  private height: number;
  private lit: boolean;
  /** THE THREE GLB URLS THIS INSTANCE LOADS FROM, one per LOD. Per-instance rather than the module
   *  constant it used to read directly, so a world can put the player in the body of whoever is actually
   *  signed in (app/world.ts passes adapters/v1Avatar's castLods(avatarId)). Defaults to BON_LODS, which
   *  is what makes the standalone dev page — and every existing caller — behave exactly as before. */
  private readonly lods: Record<AvatarLod, string>;

  constructor(opts: { height: number; lit: boolean; lods?: Record<AvatarLod, string> }) {
    this.height = opts.height;
    this.lit = opts.lit;
    this.lods = opts.lods ?? BON_LODS;
    this.root.name = "avatar";
    this.root.add(this.model);
  }

  async load(lod: AvatarLod): Promise<void> {
    const gltf = await gltfLoader().loadAsync(this.lods[lod]);
    this.dispose();
    this.gltf = gltf;
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    this.nativeHeight = box.max.y - box.min.y;
    const s = this.height / this.nativeHeight;
    scene.scale.setScalar(s);
    scene.position.set(-(box.min.x + box.max.x) / 2 * s, -box.min.y * s, -(box.min.z + box.max.z) / 2 * s); // feet on y=0, centred
    this.triangles = 0;
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false; // skinned bounds do not follow the animation
      const idx = m.geometry.getIndex();
      this.triangles += idx ? idx.count / 3 : m.geometry.getAttribute("position").count / 3;
      const src = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[];
      const lit = src.map((sm) => { const mm = new THREE.MeshStandardMaterial({ map: sm.map ?? null, color: sm.color?.clone() ?? new THREE.Color(0xffffff), roughness: 0.9, metalness: 0, side: sm.side, transparent: sm.transparent, opacity: sm.opacity, alphaTest: sm.alphaTest }); if (mm.map) mm.map.anisotropy = 8; return mm; });
      const unlit = src.map((sm) => new THREE.MeshBasicMaterial({ map: sm.map ?? null, color: sm.color?.clone() ?? new THREE.Color(0xffffff), side: sm.side, transparent: sm.transparent, opacity: sm.opacity, alphaTest: sm.alphaTest }));
      this.litMaterials.set(m, Array.isArray(m.material) ? lit : lit[0]);
      this.unlitMaterials.set(m, Array.isArray(m.material) ? unlit : unlit[0]);
      m.material = this.lit ? this.litMaterials.get(m)! : this.unlitMaterials.get(m)!;
    });
    this.model.add(scene);
    this.mixer = new THREE.AnimationMixer(scene);
    for (const clip of gltf.animations) this.actions[clip.name] = this.mixer.clipAction(clip);
    this.current = null;
    // THE CLIP ASKED FOR BEFORE THE GLB LANDED WINS. A seated restore (Phase 6C) can put the body in a chair
    // while the model is still downloading; forcing idle here left that body sitting in the idle pose.
    this.play(this.requested ?? CLIP_IDLE, 0);
  }
  setLit(lit: boolean): void {
    this.lit = lit;
    for (const [m, mat] of lit ? this.litMaterials : this.unlitMaterials) m.material = mat;
  }
  get loaded(): boolean { return this.gltf !== null; }

  // ---- transform (the ONLY orientation writers) ----
  get position(): Vec2 { return { x: this.root.position.x, z: this.root.position.z }; }
  setPosition(p: Vec2, y = 0): void { this.root.position.set(p.x, y, p.z); }
  /** full rotation write — pure yaw about +y relative to the current parent */
  setYaw(yaw: number): void { this.yaw = yaw; this.root.rotation.set(0, yaw, 0); }
  /** world-space yaw when the parent may be rotated (carrier) */
  setWorldYaw(yaw: number): void {
    const parentYaw = this.root.parent ? new THREE.Euler().setFromQuaternion(this.root.parent.getWorldQuaternion(new THREE.Quaternion()), "YXZ").y : 0;
    this.yaw = yaw;
    this.root.rotation.set(0, yaw - parentYaw, 0);
  }
  /** re-parent into a carrier keeping world pose, then re-express orientation as pure yaw (guards the Euler residue) */
  attachTo(carrier: THREE.Object3D): void { carrier.attach(this.root); this.setWorldYaw(this.yaw); }
  detachTo(parent: THREE.Object3D): void { parent.attach(this.root); this.setWorldYaw(this.yaw); }
  worldPosition(): THREE.Vector3 { return this.root.getWorldPosition(new THREE.Vector3()); }

  // ---- animation ----
  /** The clip most recently asked for, whether or not the GLB was there to play it — see load(). Kept
   *  UNRESOLVED (the caller's own word), so a later Global Chat flip re-resolves it — see
   *  setGlobalChatActive. */
  private requested: string | null = null;
  /** GLOBAL CHAT ACTIVITY for the signed-in employee — V1's `isGlobalChatActive`, pushed in from
   *  app/Vo3dOverlay through the world facade. It is a presence fact about the PERSON, not about the
   *  seat, which is why it lives here and not in the seat interactions: every one of them already asks
   *  for CLIP_SIT and gets the right clip without knowing this exists. */
  private globalChatActive = false;
  /** V1's resolver, applied to one clip name: seated + an open Global Chat window plays the answering
   *  loop instead of the folded-arms sit. Everything else is returned untouched — a STANDING body in
   *  Global Chat keeps its ordinary idle, exactly as resolveCharacterAnimState orders it. A package
   *  without the clip falls back to the sit rather than freezing. */
  private resolveClip(name: string): string {
    if (name !== CLIP_SIT || !this.globalChatActive) return name;
    return this.actions[CLIP_SIT_ANSWER] ? CLIP_SIT_ANSWER : name;
  }
  /** Enter/leave the seated answering pose. Only a body that is actually ASKING for the seated clip
   *  changes anything: a walking or standing avatar simply remembers it for the next sit. */
  setGlobalChatActive(on: boolean): void {
    if (this.globalChatActive === on) return;
    this.globalChatActive = on;
    if (this.requested === CLIP_SIT) this.play(CLIP_SIT);
  }
  play(name: string, fade = 0.25): void {
    this.requested = name;
    const resolved = this.resolveClip(name);
    if (this.current === resolved) return;
    const next = this.actions[resolved];
    if (!next) return;
    const prev = this.current ? this.actions[this.current] : null;
    next.reset().setEffectiveWeight(1).play();
    if (prev && fade > 0) prev.crossFadeTo(next, fade, false);
    else if (prev) prev.stop();
    this.current = resolved;
  }
  setClipTimeScale(name: string, scale: number): void { const a = this.actions[name]; if (a) a.timeScale = scale; }
  /** HOLD A CLIP STILL AT ONE POSE — the whole of the procedural airborne pose (player/PlayerMode).
   *
   *  No shipped character package carries a jump clip (only bon-v3 even has `running`), and generating
   *  one is asset work. What the existing rig and runtime CAN do is stop a clip on a chosen frame: the
   *  walk cycle's contact pose is legs split and arms counter-swung, which is a readable jump silhouette
   *  and costs nothing but the mixer call that was already there.
   *
   *  `phase` is 0..1 of the clip's own duration, so it is resolution-independent. A no-op for a clip the
   *  loaded GLB does not carry, exactly like play(); the caller restores the time scale on landing. */
  freezeClipAt(name: string, phase: number): void {
    const a = this.actions[name];
    if (!a) return;
    this.play(name, 0.12);
    a.timeScale = 0;
    a.time = (a.getClip().duration || 0) * Math.min(1, Math.max(0, phase));
  }
  /** does the loaded GLB carry this clip? Lets a caller fall back rather than silently freeze on the
   *  clip it was already playing (play() returns quietly for an unknown name). */
  hasClip(name: string): boolean { return this.actions[name] !== undefined; }
  get currentClip(): string | null { return this.current; }
  /** DIAGNOSTIC: what the mixer is really doing with a clip — is it bound, running, and at what weight.
   *  `currentClip` alone cannot tell "the pose is playing" from "the pose was asked for and the GLB had
   *  no such clip", which is exactly the distinction a missing local gesture turns on. */
  clipDebug(name: string): { bound: boolean; running: boolean; weight: number } {
    const a = this.actions[name];
    return { bound: a !== undefined, running: a?.isRunning() ?? false, weight: a?.getEffectiveWeight() ?? 0 };
  }
  update(dt: number): void { this.mixer?.update(dt); }

  dispose(): void {
    if (this.gltf) {
      this.mixer?.stopAllAction();
      this.model.remove(this.gltf.scene);
      this.gltf.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
    }
    this.litMaterials.clear(); this.unlitMaterials.clear(); this.actions = {}; this.gltf = null; this.mixer = null;
  }
}
