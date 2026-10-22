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
import { RiderPose } from "./riderPose";
import { CrashPose, type CrashBodyFrame } from "./crashPose";
import { GaitPose, type GaitInput } from "./gaitPose";
import { CRASH } from "../world/accidentMotion";
import { RIDER_GRIPS } from "../world/scooters";
import type { HumanAvatar } from "../human/HumanAvatar";
import { createHumanBody, type HumanBody } from "./humanBody";
import { idleClip, type AppearanceAsset, type EmployeeAvatar } from "../human/humanBaseContract";
import { SeatedWork } from "../human/seatedWork";
import { ArmPerch } from "../human/armPerch";

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
   *  is what makes the standalone dev page — and every existing caller — behave exactly as before. NULL = this
   *  employee has NO legacy body (a HumanBase-only employee): a HumanBase failure then leaves the body empty
   *  (runtime "none") rather than dressing them in Bon's. */
  private readonly lods: Record<AvatarLod, string> | null;

  /** THE SCOOTER RIDER'S POSE (avatar/riderPose): a post-mixer layer on the model group, idle until mounted */
  private readonly rider: RiderPose;
  /** S6 — THE CRASH on the skeleton (avatar/crashPose): a post-mixer layer after the rider's, idle until a fall */
  private readonly crash: CrashPose;
  private crashing = false;
  /** SPRINT / SKID / BANK over the locomotion clips (avatar/gaitPose): before the rider pose, idle until fast */
  private readonly gait: GaitPose;

  /** HUMANBASE BODY (production integration, avatar/humanBody): when set, `load` builds this appearance on the
   *  shared HumanBase runtime instead of fetching the legacy GLB. Everything outside this class — controllers,
   *  seats, scooter, lift, camera, nameplate, multiplayer — keeps talking to the same Avatar API. A HumanBase
   *  load failure falls back to the legacy GLB (`lods`), so the player is never left without a body. */
  private readonly humanCfg: { config: EmployeeAvatar; catalogue: ReadonlyMap<string, AppearanceAsset> } | null;
  /** the live HumanBase body, or null on the legacy path */
  human: HumanAvatar | null = null;
  /** what a seated HumanBase body does with its hands: types at a workstation, rests on its lap elsewhere (human/seatedWork) */
  seatedWork: SeatedWork | null = null;
  /** the seat this body sits in is a work desk's chair (true), something else (false) or unknown — app/world says */
  atWorkstation: boolean | undefined = undefined;
  /** the forearm a summoned Toucan lands on (human/armPerch); app/world raises and lowers it */
  armPerch: ArmPerch | null = null;
  /** which runtime is actually drawing this body: "humanbase" | "legacy-glb" | "none" (diagnostic) */
  get runtime(): "humanbase" | "legacy-glb" | "none" { return this.human ? "humanbase" : this.gltf ? "legacy-glb" : "none"; }

  constructor(opts: { height: number; lit: boolean; lods?: Record<AvatarLod, string> | null; human?: { config: EmployeeAvatar; catalogue: ReadonlyMap<string, AppearanceAsset> } | null }) {
    this.height = opts.height;
    this.lit = opts.lit;
    this.lods = opts.lods === null ? null : opts.lods ?? BON_LODS;
    this.humanCfg = opts.human ?? null;
    this.root.name = "avatar";
    this.root.add(this.model);
    this.rider = new RiderPose(this.model, RIDER_GRIPS);
    this.crash = new CrashPose(this.model, () => this.rider.drop());
    this.gait = new GaitPose(this.model);
  }

  async load(lod: AvatarLod): Promise<void> {
    if (this.humanCfg) {
      if (this.human) return;   // one HumanBase body per Avatar (it has no LODs yet — the LOD selector is a no-op)
      try { this.adoptHuman(await createHumanBody(this.humanCfg.config, this.humanCfg.catalogue)); return; }
      catch (e) { if (!this.lods) throw e; console.warn("[vo3d] HumanBase body failed to load — falling back to the legacy GLB", e); }
    }
    if (!this.lods) throw new Error("no legacy body for this employee");
    this.adopt(await gltfLoader().loadAsync(this.lods[lod]));
  }
  /** Take a built HumanBase body. Already in world units (HUMAN_STANDING_HEIGHT = 36 = BON_STANDING_HEIGHT), feet on
   *  y = 0; no re-normalisation. VO's clip names map 1:1 onto the shared library except the idle (resolveClip). */
  private adoptHuman(body: HumanBody): void {
    const h = body.human;
    this.dispose();
    this.human = h;
    this.seatedWork = new SeatedWork(h);
    this.armPerch = new ArmPerch(h);
    h.addLayer(this.armPerch.layer());
    this.model.add(h.root);
    // the seat contract (interact/seatContact) reads the rig's clips by VO's names: the idle is aliased under CLIP_IDLE
    this.gltf = { scene: h.scene, animations: body.clips } as unknown as GLTF;
    this.nativeHeight = this.height;
    this.triangles = h.stats().triangles;
    // the scooter rider is a HumanBase layer (the same contract the HumanBase QA viewer drives)
    this.rider.setScene(h.scene);
    this.gait.setScene(h.scene);
    h.addLayer({ id: "vo-gait-shape", order: 25, update: (dt) => this.gait.update(dt) });
    h.addLayer({ id: "vo-scooter-rider", order: 30, update: (dt) => this.rider.update(dt) });
    this.crash.setScene(h.scene);
    h.addLayer({ id: "vo-scooter-crash", order: 40, update: (dt) => this.crash.update(dt) });
    this.current = null;
    this.play(this.requested ?? CLIP_IDLE, 0);
  }
  /** Take a loaded character package as this body: normalise it, dress it, bind its clips. `load` is the
   *  fetch in front of this; tests hand it a roster GLB decoded in node (avatar/rosterGlb.testutil). */
  adopt(gltf: GLTF): void {
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
    this.rider.setScene(scene);
    this.crash.setScene(scene);
    this.gait.setScene(scene);
    this.mixer = new THREE.AnimationMixer(scene);
    for (const clip of gltf.animations) this.actions[clip.name] = this.mixer.clipAction(clip);
    this.current = null;
    // THE CLIP ASKED FOR BEFORE THE GLB LANDED WINS. A seated restore (Phase 6C) can put the body in a chair
    // while the model is still downloading; forcing idle here left that body sitting in the idle pose.
    this.play(this.requested ?? CLIP_IDLE, 0);
  }
  setLit(lit: boolean): void {
    this.lit = lit;
    if (this.human) return;   // HumanBase materials are its own (skin / garment / face shaders) — always lit
    for (const [m, mat] of lit ? this.litMaterials : this.unlitMaterials) m.material = mat;
  }
  get loaded(): boolean { return this.gltf !== null; }

  // ---- transform (the ONLY orientation writers) ----
  get position(): Vec2 { return { x: this.root.position.x, z: this.root.position.z }; }
  /** THE GROUND UNDER A POINT (the world's exterior ground model; 0 indoors), or null for a flat world. Used
   *  whenever a caller places the body without saying how high — navigation walks, interactions, teleports —
   *  but never while the body rides a carrier (a seat, the lift car), whose frame is not the world's. */
  ground: ((p: Vec2) => number) | null = null;
  private carried = false;
  /** the ground height at `p`, or 0 when there is no ground provider or the body is carried */
  groundAt(p: Vec2): number { return this.ground && !this.carried ? this.ground(p) : 0; }
  /** stand on the ground where the body already is (a walk step); a no-op when carried or flat */
  settleOnGround(): void { if (this.ground && !this.carried) this.root.position.y = this.ground(this.root.position); }
  /** place the body; `y` is absolute — omitted, it stands on the ground */
  setPosition(p: Vec2, y?: number): void { this.root.position.set(p.x, y ?? this.groundAt(p), p.z); }
  /** full rotation write — pure yaw about +y relative to the current parent */
  setYaw(yaw: number): void { this.yaw = yaw; this.root.rotation.set(0, yaw, 0); }
  /** S6 — ONE FRAME OF A CRASH (world/accidentMotion via app/world), or null: the body is its own again. While
   *  it plays, the clip is held on the idle's first frame and every other clip request waits (nothing walks or
   *  idles over the fall); the root stays where the caller put it (upright, under the hips). A body without the
   *  standard chain is tipped whole about its hips instead. */
  setCrash(f: CrashBodyFrame | null): void {
    if (f && !this.crashing) { this.gait.drop(); this.freezeClipAt(CLIP_IDLE, 0); this.crashing = true; }
    if (!f && this.crashing) {
      this.crashing = false;
      this.setClipTimeScale(CLIP_IDLE, 1);
      this.current = null;
      this.play(CLIP_IDLE, 0.2);
    }
    this.crash.set(f);
    if (f && !this.crash.rigged) {
      this.root.quaternion.copy(f.q);
      this.root.position.set(f.hip.x, f.hip.y, f.hip.z).sub(new THREE.Vector3(0, CRASH.HIP, 0).applyQuaternion(f.q));
    }
  }
  get inCrash(): boolean { return this.crashing; }
  /** DIAGNOSTIC: the crash layer's ground contact */
  get crashStats(): CrashPose["stats"] { return this.crash.stats; }
  /** world-space yaw when the parent may be rotated (carrier) */
  setWorldYaw(yaw: number): void {
    const parentYaw = this.root.parent ? new THREE.Euler().setFromQuaternion(this.root.parent.getWorldQuaternion(new THREE.Quaternion()), "YXZ").y : 0;
    this.yaw = yaw;
    this.root.rotation.set(0, yaw - parentYaw, 0);
  }
  /** re-parent into a carrier keeping world pose, then re-express orientation as pure yaw (guards the Euler residue) */
  attachTo(carrier: THREE.Object3D): void { carrier.attach(this.root); this.carried = true; this.setWorldYaw(this.yaw); }
  detachTo(parent: THREE.Object3D): void { parent.attach(this.root); this.carried = false; this.setWorldYaw(this.yaw); }
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
    return this.actions[CLIP_SIT_ANSWER] || this.human?.clipNames.includes(CLIP_SIT_ANSWER) ? CLIP_SIT_ANSWER : name;
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
    if (this.crashing) return;   // S6: the crash owns the body until setCrash(null)
    const resolved = this.resolveClip(name);
    if (this.human) {   // HumanBase: the shared library's own names; VO's idle-9 is this employee's idle profile
      const hn = resolved === CLIP_IDLE ? idleClip(this.human.config.idleProfile) : resolved;
      if (this.current === hn) return;
      if (!this.human.clipNames.includes(hn)) return;
      this.human.play(hn, fade); this.current = hn; return;
    }
    if (this.current === resolved) return;
    const next = this.actions[resolved];
    if (!next) return;
    const prev = this.current ? this.actions[this.current] : null;
    next.reset().setEffectiveWeight(1).play();
    if (prev && fade > 0) prev.crossFadeTo(next, fade, false);
    else if (prev) prev.stop();
    this.current = resolved;
  }
  /** the mixer action behind a VO clip name, on either runtime */
  private action(name: string): THREE.AnimationAction | undefined {
    if (!this.human) return this.actions[name];
    const hn = name === CLIP_IDLE ? idleClip(this.human.config.idleProfile) : name;
    return this.human.actionFor(hn);
  }
  setClipTimeScale(name: string, scale: number): void { const a = this.action(name); if (a) a.timeScale = scale; }
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
    const a = this.action(name);
    if (!a) return;
    this.play(name, 0.12);
    a.timeScale = 0;
    a.time = (a.getClip().duration || 0) * Math.min(1, Math.max(0, phase));
  }
  /** does the loaded GLB carry this clip? Lets a caller fall back rather than silently freeze on the
   *  clip it was already playing (play() returns quietly for an unknown name). */
  hasClip(name: string): boolean { return this.action(name) !== undefined; }
  get currentClip(): string | null { return this.current; }
  /** DIAGNOSTIC: what the mixer is really doing with a clip — is it bound, running, and at what weight.
   *  `currentClip` alone cannot tell "the pose is playing" from "the pose was asked for and the GLB had
   *  no such clip", which is exactly the distinction a missing local gesture turns on. */
  clipDebug(name: string): { bound: boolean; running: boolean; weight: number } {
    const a = this.action(name);
    return { bound: a !== undefined, running: a?.isRunning() ?? false, weight: a?.getEffectiveWeight() ?? 0 };
  }
  update(dt: number): void {
    if (this.human) {   // seated hands, then mixer + behaviour layers (clearance, contacts, face, hair, rider)
      if (this.seatedWork) this.seatedWork.atWorkstation = this.atWorkstation;
      this.seatedWork?.update(dt, this.current === CLIP_SIT);
      this.human.update(dt);
      return;
    }
    this.mixer?.update(dt);
    this.gait.update(dt);
    this.rider.update(dt);
    this.crash.update(dt);
  }

  // ---- the scooter rider (avatar/riderPose) ----
  /** mount (true) or dismount (false): hands to the grips and the body onto the deck, blended either way */
  setRiding(on: boolean): void { if (on) this.gait.drop(); this.rider.set(on); }
  /** this frame's sprint / skid / bank (player/PlayerMode, from the body's own momentum), or null */
  setGait(g: GaitInput | null): void { this.gait.set(this.crashing ? null : g); }
  get gaitStats(): GaitPose["stats"] { return this.gait.stats; }
  /** the deck's roll this frame (world/scooters' lean), so the body leans with the scooter */
  setRideLean(lean: number): void { this.rider.setLean(lean); }
  /** the deck's pitch this frame (nose up +), so the body climbs and descends with the scooter */
  setRidePitch(pitch: number): void { this.rider.setPitch(pitch); }
  /** 0 = not riding at all, 1 = fully on the grips; the blend in between */
  get ridingWeight(): number { return this.rider.weight; }
  /** DIAGNOSTIC: the rider solve's last stance and palm-to-grip distances */
  get riderStats(): RiderPose["stats"] { return this.rider.stats; }

  dispose(): void {
    this.rider.setScene(null);
    if (this.human) { this.seatedWork?.dispose(); this.seatedWork = null; this.armPerch = null; this.human.dispose(); this.human = null; this.gltf = null; this.current = null; return; }
    if (this.gltf) {
      this.mixer?.stopAllAction();
      this.model.remove(this.gltf.scene);
      this.gltf.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
    }
    this.litMaterials.clear(); this.unlitMaterials.clear(); this.actions = {}; this.gltf = null; this.mixer = null;
  }
}
