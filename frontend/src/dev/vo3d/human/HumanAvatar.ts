// vo3d human — ONE MODULAR EMPLOYEE: HumanBase_V1 + an appearance configuration, composed at runtime.
//
// THE BASE IS PARSED ONCE. Every avatar is a SkeletonUtils clone of it (its own bones, mixer and material
// instances; shared geometry) — exactly what avatar/CastPrototypes does for today's baked employees.
//
// A SLOT IS EQUIPPED ON ITS OWN. A module GLB (identity head, hair, top, bottom, shoes, glasses) is skinned to
// the base's 36 joints; its meshes are rebound by joint NAME onto this avatar's bones with the base's own inverse
// bind matrices, so it deforms with the shared clips immediately. Swapping a slot removes that slot's meshes
// and adds the new ones — the skeleton, the mixer, the playing clip, the face and every other slot are untouched
// (no rebuild, no rerig, no reanimation). Colourways and skin tone are uniform changes; they load nothing.
//
// PER FRAME, IN THIS ORDER: shared clip (mixer) → post-mixer LAYERS (procedural overlays, the scooter rider pose,
// behaviours: hand contacts, props, attention) → the face. A layer never stores state in the bones: the mixer
// rewrites what it animates every frame, and the digits are set absolutely.
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  HUMAN_SOCKETS, HUMAN_WORLD_SCALE, NEUTRAL_IDENTITY, SHAPE_CONTROLS, changedSlots, clampIdentity, idleClip, regionMask,
  type AppearanceAsset, type AppearanceSlot, type BodyRegion, type EmployeeAvatar, type HeadMount, type IdentityLandmarks, type IdentityParams, type SocketName,
} from "./humanBaseContract";
import { HUMAN_BODY_PRESET_URLS } from "./humanCatalogue";
import { presetDisplace } from "./humanBodyPresets";
import { HumanFace } from "./humanFace";
import { bakedEyeMaterial, bodySkinMaterial, decalLightFor, canonicalHeadMaterial, faceMaterial, garmentMaterial, hairMaterial, headPaintUniforms, identityHeadMaterial, vertexColourMaterial, type Fabric, type GarmentUniforms, type HeadPaintUniforms, type SkinUniforms } from "./humanMaterials";
import { HairDynamics, type HairChain, type HairMotionPreset } from "./humanHair";
import { fitGlassesPositions, type GlassesAttach, type GlassesDesign, type GlassesFitData } from "./humanGlasses";
import { placeAccessory, type AttachData, type AttachSpec } from "./humanAccessoryFit";
import { HumanRig } from "./humanRig";
import { BodyClearance } from "./humanClearance";

const DRACO_PATH = `${import.meta.env.BASE_URL}vendor/draco/`;
let loader: GLTFLoader | null = null;
const loads = new Map<string, Promise<GLTF>>();
let fetchGlb: (url: string) => Promise<GLTF> = (url) => {
  if (!loader) { const d = new DRACOLoader(); d.setDecoderPath(DRACO_PATH); loader = new GLTFLoader(); loader.setDRACOLoader(d); }
  return loader.loadAsync(url);
};
/** TEST-ONLY: decode GLBs some other way (vitest has no fetch/Draco worker — see human/humanGlb.testutil) */
export function setGlbFetcher(f: (url: string) => Promise<GLTF>): void { fetchGlb = f; loads.clear(); }
/** every GLB is fetched + parsed ONCE per page; avatars share geometry */
export function loadGlb(url: string): Promise<GLTF> {
  let p = loads.get(url);
  if (!p) { p = fetchGlb(url); loads.set(url, p); p.catch(() => loads.delete(url)); }
  return p;
}

/** fallback for the base's own skin luminance (the base GLB publishes the measured value in its extras) */
const BASE_SKIN_LUM = 0.56;

/** Area-weighted vertex normals averaged over every vertex sharing a position (UV seams split vertices; their own normals
 *  left the shared base body faceted on hands and limbs). In place, once per geometry. */
function smoothSeamNormals(g: THREE.BufferGeometry): void {
  if (g.userData.seamNormals) return; g.userData.seamNormals = true;
  const pos = g.getAttribute("position"), idx = g.getIndex(); if (!pos || !idx) return;
  const key = (i: number) => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  const grp = new Map<string, number>(), gid = new Int32Array(pos.count); for (let i = 0; i < pos.count; i++) { const k = key(i); if (!grp.has(k)) grp.set(k, grp.size); gid[i] = grp.get(k)!; }
  const acc = new Float32Array(grp.size * 3), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < idx.count; t += 3) { const i0 = idx.getX(t), i1 = idx.getX(t + 1), i2 = idx.getX(t + 2); a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1).sub(a); c.fromBufferAttribute(pos, i2).sub(a); b.cross(c);
    for (const i of [i0, i1, i2]) { acc[gid[i] * 3] += b.x; acc[gid[i] * 3 + 1] += b.y; acc[gid[i] * 3 + 2] += b.z; } }
  const n = new Float32Array(pos.count * 3); for (let i = 0; i < pos.count; i++) { const g3 = gid[i] * 3, l = Math.hypot(acc[g3], acc[g3 + 1], acc[g3 + 2]) || 1; n[i * 3] = acc[g3] / l; n[i * 3 + 1] = acc[g3 + 1] / l; n[i * 3 + 2] = acc[g3 + 2] / l; }
  g.setAttribute("normal", new THREE.BufferAttribute(n, 3));
  // …and ONE skin binding per position: split vertices with different weights drift apart when posed — hairline cracks that
  // show the background (white specks on knuckles, a zig-zag at the wrist)
  const si = g.getAttribute("skinIndex"), sw = g.getAttribute("skinWeight"); if (!si || !sw) return;
  const first = new Int32Array(grp.size).fill(-1); for (let i = 0; i < pos.count; i++) { const f = first[gid[i]]; if (f < 0) { first[gid[i]] = i; continue; }
    for (let k = 0; k < 4; k++) { si.setComponent(i, k, si.getComponent(f, k)); sw.setComponent(i, k, sw.getComponent(f, k)); } }
  si.needsUpdate = true; sw.needsUpdate = true;
}
/** body region → the clearance capsule a garment over it thickens */
const REGION_CAPSULE: Partial<Record<BodyRegion, string>> = { CHEST: "torso", BELLY: "torso", PELVIS: "pelvis", THIGH_L: "thighL", THIGH_R: "thighR", UPPERARM_L: "upperArmL", UPPERARM_R: "upperArmR", FOREARM_L: "forearmL", FOREARM_R: "forearmR" };
/** the bind-space head-mount transform: T(pivot) · Rx(−pitch) · S(scale) · T(−pivot), or null when it is the identity */
export function headMountMatrix(mount: HeadMount | undefined, pivot: THREE.Vector3): THREE.Matrix4 | null {
  const s = mount?.scale ?? 1, pitch = ((mount?.pitchDeg ?? 0) * Math.PI) / 180;
  if (s === 1 && pitch === 0) return null;
  // (bind space is +y up, +z forward: a rotation of −pitch about +x lifts the face)
  return new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z).multiply(new THREE.Matrix4().makeRotationX(-pitch))
    .multiply(new THREE.Matrix4().makeScale(s, s, s)).multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
}
type Piece = { asset: AppearanceAsset; meshes: THREE.Object3D[]; hides: readonly BodyRegion[]; garment?: GarmentUniforms; meta: Record<string, unknown>;
  /** joints the module owns (hair chains), created under the avatar's bones on equip, removed with it */
  ownedBones?: THREE.Bone[]; paint?: HeadPaintUniforms; hairColor?: { value: THREE.Color }; layerId?: string };
export type Layer = { id: string; order: number; update: (dt: number, a: HumanAvatar) => void };
export type AvatarStats = { pieces: { slot: string; id: string; triangles: number; draws: number }[]; triangles: number; draws: number; hideMask: number };

export class HumanAvatar {
  /** world placement (position, yaw) */
  readonly root = new THREE.Group();
  /** the model frame (a scooter rider pose leans this) — parent of the scaled scene */
  readonly model = new THREE.Group();
  scene!: THREE.Object3D;
  body!: THREE.SkinnedMesh;
  bones = new Map<string, THREE.Bone>();
  rig!: HumanRig;
  mixer!: THREE.AnimationMixer;
  face: HumanFace | null = null;
  config: EmployeeAvatar;
  private readonly catalogue: ReadonlyMap<string, AppearanceAsset>;
  private actions: Record<string, THREE.AnimationAction> = {};
  private current: string | null = null;
  private readonly pieces = new Map<string, Piece>();
  private skin!: SkinUniforms;
  private layers: Layer[] = [];
  private landmarks: IdentityLandmarks | null = null;
  /** the identity parameters on the canonical head (shape controls, eyes, paint) */
  identity: IdentityParams = structuredClone(NEUTRAL_IDENTITY);
  /** the last equip's wall time (ms) and per-frame costs, for the proof's performance panel */
  readonly timing = { lastEquipMs: 0, mixerMs: 0, layersMs: 0 };

  private constructor(cfg: EmployeeAvatar, catalogue: ReadonlyMap<string, AppearanceAsset>) {
    this.config = cfg; this.catalogue = catalogue;
    this.root.name = `human:${cfg.employeeId}`;
    this.root.add(this.model);
  }

  static async create(cfg: EmployeeAvatar, catalogue: ReadonlyMap<string, AppearanceAsset>): Promise<HumanAvatar> {
    const a = new HumanAvatar(cfg, catalogue);
    await a.adoptBase(await loadGlb(HUMAN_BODY_PRESET_URLS[cfg.bodyPreset ?? "standard"]));
    const all: AppearanceSlot[] = ["identity", "hair", "top", "bottom", "shoes", "glasses", "accessory"];
    await a.applySlots(cfg, all);
    a.play(idleClip(cfg.idleProfile), 0);
    return a;
  }

  private async adoptBase(gltf: GLTF): Promise<void> {
    const scene = cloneSkinned(gltf.scene);
    this.scene = scene;
    scene.traverse((o) => {
      const b = o as THREE.Bone; if (b.isBone) this.bones.set(b.name, b);
      const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh) this.body = m;
    });
    // scale: the contract's world units per native unit, measured on the bind Hips (feet at 0)
    this.model.add(scene);
    scene.updateMatrixWorld(true);
    const ii = this.body.skeleton.bones.findIndex((b) => b.name === "Hips");
    const nativeHips = new THREE.Vector3().setFromMatrixPosition(this.body.skeleton.boneInverses[ii].clone().invert());
    const worldHips = this.bones.get("Hips")!.getWorldPosition(new THREE.Vector3());
    scene.scale.multiplyScalar(HUMAN_WORLD_SCALE / (worldHips.y / nativeHips.y));
    scene.updateMatrixWorld(true);
    const src = this.body.material as THREE.MeshStandardMaterial;
    const lum = (this.body.userData?.humanBase as { skinLum?: number } | undefined)?.skinLum ?? BASE_SKIN_LUM;
    smoothSeamNormals(this.body.geometry);   // V1.2: no faceting across split (UV-seam) vertices
    const { material, uniforms } = bodySkinMaterial(src.map ?? null, "#feba83", lum);
    this.skin = uniforms;
    this.body.material = material;
    this.body.castShadow = true; this.body.receiveShadow = true; this.body.frustumCulled = false;
    this.mixer = new THREE.AnimationMixer(scene);
    for (const clip of gltf.animations) this.actions[clip.name] = this.mixer.clipAction(clip);
    this.clips = gltf.animations;
    this.rig = new HumanRig(this.model, this.body, this.bones);
    this.clearance = new BodyClearance(this.rig, this.body, HUMAN_WORLD_SCALE);
    this.addLayer(this.clearance.layer());
    // HEAD MOUNT: this avatar's own inverse binds (the cloned skeleton shares the cached array) — taken AFTER the rig's
    // rest pose and the clearance envelopes are measured, so neither ever sees a mount
    this.ownBinds(this.body, this.body.skeleton.boneInverses);
  }
  /** the authored inverse binds per skinned mesh (read-only, possibly the page-wide cached array) */
  private readonly baseBinds = new WeakMap<THREE.SkinnedMesh, readonly THREE.Matrix4[]>();
  private ownBinds(mesh: THREE.SkinnedMesh, authored: readonly THREE.Matrix4[]): void {
    this.baseBinds.set(mesh, authored);
    mesh.skeleton.boneInverses = authored.map((m) => m.clone());
  }
  /** re-derive every Head-subtree inverse bind (body + all worn modules) from the authored ones and the configured
   *  mount — idempotent, so it runs after every equip and every applied configuration */
  private applyHeadMount(): void {
    const head = this.bones.get("Head"), base = this.baseBinds.get(this.body);
    if (!head || !base) return;
    const pivot = new THREE.Vector3().setFromMatrixPosition(base[this.body.skeleton.bones.indexOf(head)].clone().invert());
    const M = headMountMatrix(this.config.identity.mount, pivot);
    const inHead = (b: THREE.Object3D | null): boolean => { for (let o = b; o; o = o.parent) if (o === head) return true; return false; };
    const meshes: THREE.SkinnedMesh[] = [this.body];
    for (const p of this.pieces.values()) for (const m of p.meshes) if ((m as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(m as THREE.SkinnedMesh);
    for (const m of meshes) {
      const authored = this.baseBinds.get(m); if (!authored) continue;
      m.skeleton.bones.forEach((b, i) => { const ib = m.skeleton.boneInverses[i].copy(authored[i]); if (M && inHead(b)) ib.multiply(M); });
    }
  }
  /** the head mount actually applied (tests / QA read it) */
  get headMount(): Readonly<HeadMount> { return this.config.identity.mount ?? {}; }
  /** the body's self-clearance (anatomical envelopes + worn garment thickness) */
  clearance!: BodyClearance;

  // ---- appearance -------------------------------------------------------------------------------------------

  /** Apply a whole configuration: only the slots that changed are re-equipped. Returns those slots. */
  async apply(cfg: EmployeeAvatar): Promise<AppearanceSlot[]> {
    if (cfg.employeeId !== this.config.employeeId) throw new Error("an avatar configuration belongs to one employee");
    const slots = changedSlots(this.config, cfg);
    await this.applySlots(cfg, slots);
    // slots load concurrently: whatever finished last, every wearable ends fitted to the identity now worn (idempotent)
    this.fitGlasses(); this.fitAttached();
    if (cfg.idleProfile !== this.config.idleProfile && this.current?.startsWith("idle-")) this.play(idleClip(cfg.idleProfile), 0.3);
    this.config = cfg;
    return slots;
  }

  private async applySlots(cfg: EmployeeAvatar, slots: readonly AppearanceSlot[]): Promise<void> {
    const t0 = performance.now();
    const jobs: Promise<unknown>[] = [];
    for (const s of slots) {
      if (s === "identity") jobs.push(this.equip("identity", cfg.identity.headAssetId).then(() => { if (cfg.identity.skinTone) this.setSkinTone(cfg.identity.skinTone); }));
      if (s === "hair") jobs.push(this.equip("hair", cfg.hair.assetId));
      if (s === "top") jobs.push(this.equip("top", cfg.top.assetId, cfg.top.colorway));
      if (s === "bottom") jobs.push(this.equip("bottom", cfg.bottom.assetId, cfg.bottom.colorway));
      if (s === "shoes") jobs.push(this.equip("shoes", cfg.shoes.assetId, cfg.shoes.colorway));
      if (s === "glasses") jobs.push(this.equip("glasses", cfg.glasses.assetId));
    }
    await Promise.all(jobs);
    // accessories last: a socket item sits on whatever top is now worn
    if (slots.includes("accessory")) {
      for (const k of [...this.pieces.keys()]) if (k.startsWith("accessory:") && !cfg.accessories.some((a) => `accessory:${a.assetId}` === k)) this.unequip(k);
      for (const a of cfg.accessories) if (!this.pieces.has(`accessory:${a.assetId}`)) await this.equip("accessory", a.assetId);
    }
    this.config = { ...cfg };
    this.applyHeadMount();
    this.timing.lastEquipMs = performance.now() - t0;
  }

  /** Equip one slot (null clears an optional slot). Never touches the skeleton, the mixer or any other slot. */
  async equip(slot: AppearanceSlot, assetId: string | null, colorway?: string): Promise<void> {
    const key = slot === "accessory" ? `accessory:${assetId}` : slot;
    if (!assetId) { this.unequip(key); return; }
    const asset = this.catalogue.get(assetId);
    if (!asset || asset.slot !== slot) throw new Error(`no ${slot} asset ${assetId}`);
    const prev = this.pieces.get(key);
    if (prev?.asset.id === assetId) { if (colorway) this.setColorway(slot, colorway); return; }
    const piece = asset.url.startsWith("procedural:") ? this.buildProcedural(asset) : await this.buildModule(asset, colorway);
    if (prev) this.unequip(key);
    this.pieces.set(key, piece);
    this.updateHideMask();
    if (slot === "identity") this.adoptIdentity(piece);
    if (slot === "hair" && piece.hairColor) piece.hairColor.value.set(this.config.hair.color ?? "#161415");
    if (slot === "glasses" || slot === "identity") this.fitGlasses();
    if (slot === "accessory" || slot === "identity") this.fitAttached();
    this.applyShape();
    this.applyHeadMount();
  }

  unequip(key: string): void {
    const p = this.pieces.get(key);
    if (!p) return;
    for (const m of p.meshes) m.removeFromParent();
    for (const b of p.ownedBones ?? []) { b.removeFromParent(); this.bones.delete(b.name); }
    if (p.layerId) this.removeLayer(p.layerId);
    this.pieces.delete(key);
    if (key === "hair") { this.hair = null; this.applyShape(); }
    if (key === "identity") this.face = null;
    this.updateHideMask();
  }

  private async buildModule(asset: AppearanceAsset, colorway?: string): Promise<Piece> {
    const gltf = await loadGlb(asset.url);
    const meta = (gltf.scene.userData ?? {}) as Record<string, Record<string, unknown>>;
    const info = (meta.humanGarment ?? meta.humanIdentity ?? meta.humanHair ?? meta.humanAccessory ?? {}) as Record<string, unknown>;
    const hides = (info.hides as BodyRegion[] | undefined) ?? asset.hides ?? [];
    const meshes: THREE.Object3D[] = [];
    let garment: GarmentUniforms | undefined;
    const sources: THREE.SkinnedMesh[] = [];
    gltf.scene.traverse((o) => { const s = o as THREE.SkinnedMesh; if (s.isSkinnedMesh) sources.push(s); });
    // THIS AVATAR'S geometry per source mesh. The parsed GLB is cached page-wide and shared by every avatar wearing the
    // module, so a per-avatar edit (body-preset displacement, glasses refit) goes on an own copy kept HERE — never written
    // back onto the cached source, where the next avatar would inherit (and re-apply) it.
    const own = new Map<THREE.SkinnedMesh, THREE.BufferGeometry>();
    const geomOf = (s: THREE.SkinnedMesh) => own.get(s) ?? s.geometry;
    // MODULE-OWNED JOINTS (hair chains): created under their parent on THIS avatar. The base skeleton, the mixer and
    // every shared clip are untouched; local = IBM(parent) · IBM(joint)⁻¹, both from the module's own skeleton.
    const ownedBones: THREE.Bone[] = [];
    const moduleJoints = (meta.moduleJoints ?? []) as unknown as { name: string; parent: string }[];
    if (moduleJoints.length && sources[0]) {
      const sk = sources[0].skeleton, ibm = (n: string) => sk.boneInverses[sk.bones.findIndex((b) => b.name === n)];
      for (const mj of moduleJoints) {
        if (this.bones.has(mj.name)) continue;
        const parent = this.bones.get(mj.parent);
        if (!parent) throw new Error(`${asset.id}: module joint ${mj.name} has no parent ${mj.parent}`);
        const bone = new THREE.Bone(); bone.name = mj.name;
        new THREE.Matrix4().copy(ibm(mj.parent)).multiply(ibm(mj.name).clone().invert()).decompose(bone.position, bone.quaternion, bone.scale);
        parent.add(bone); this.bones.set(mj.name, bone); ownedBones.push(bone);
      }
    }
    let paint: HeadPaintUniforms | undefined, hairColor: { value: THREE.Color } | undefined;
    // BODY PRESET: garments (any slot except the head, hair and glasses) follow the body preset's displacement field
    const preset = this.config.bodyPreset;
    // (head-mounted accessories ride the head, not the body field)
    if (preset && preset !== "standard" && ["top", "bottom", "shoes", "accessory"].includes(asset.slot) && !(asset.socket ?? "").startsWith("head") && asset.socket !== "identity-face") for (const s of sources) {
      const g = s.geometry.clone(), pos = g.getAttribute("position"), ji = g.getAttribute("skinIndex"), wi = g.getAttribute("skinWeight");
      const names = s.skeleton.bones.map((b) => b.name), wp = (n: string) => new THREE.Vector3().setFromMatrixPosition(s.skeleton.boneInverses[names.indexOf(n)].clone().invert()).toArray() as [number, number, number];
      const J = { spineZ: wp("Spine02")[2], armL: wp("LeftArm"), handL: wp("LeftHand"), armR: wp("RightArm"), handR: wp("RightHand") };
      const p: [number, number, number] = [0, 0, 0];
      void ji; void wi;
      for (let i = 0; i < pos.count; i++) { p[0] = pos.getX(i); p[1] = pos.getY(i); p[2] = pos.getZ(i); if (presetDisplace(preset, p, null, J)) pos.setXYZ(i, p[0], p[1], p[2]); }
      g.computeVertexNormals();
      own.set(s, g);
    }
    for (const s of sources) {
      // REBIND BY JOINT NAME onto THIS avatar's bones — the module's own skeleton is never animated
      const bones = s.skeleton.bones.map((b) => this.bones.get(b.name));
      if (bones.some((b) => !b)) throw new Error(`${asset.id}: skeleton does not match HumanBase_V1`);
      const srcMat = s.material as THREE.MeshStandardMaterial;
      let mat: THREE.Material;
      const name = s.name;
      if (name === "identity_head" && info.canonical) {
        const lm = info.landmarks as IdentityLandmarks & { nose: { c: number[] } };
        paint = headPaintUniforms({ eye: [lm.eyes.l[0], lm.eyes.l[1], lm.eyes.halfW, lm.eyes.halfH], noseY: lm.nose.c[1], mouthY: lm.mouth.c[1] });
        mat = canonicalHeadMaterial(paint);
      } else if (name === "identity_head" || name.startsWith("identity_face_") || name.startsWith("identity_hair_")) { mat = identityHeadMaterial(srcMat.map ?? null, name.startsWith("identity_hair_")); mat.side = srcMat.side; }   // V1.1 layered hair shares the identity texture
      else if (name === "face_eyes" || name === "face_mouth") mat = new THREE.MeshBasicMaterial({ map: srcMat.map ?? null }); // replaced by adoptIdentity
      else if (name.startsWith("hair_") && info.class) { const h = hairMaterial(this.config.hair.color ?? "#161415"); mat = h.material; hairColor = h.uniforms.uHair; }
      else if (name.startsWith("hair_")) mat = vertexColourMaterial(0.55, true);
      else if (name.startsWith("accessory_")) mat = vertexColourMaterial(0.6, true);
      else if (name.startsWith("glasses_")) { mat = vertexColourMaterial(info.light ? 0.45 : 0.32, true); if (info.light) (mat as THREE.MeshStandardMaterial).emissive.set("#9a968f"); }   // light frames keep reading white in shade
      else if (name === "shoes_sneakers") mat = vertexColourMaterial(0.72);
      // a module part whose look is fully authored in the file (texture and/or vertex colours) keeps its own material
      // HumanBase-owned skin carried by a module (the neck extension hidden inside an identity head): the body's own material
      else if (name.startsWith("bodyskin_")) mat = this.body.material as THREE.Material;
      else if (name.startsWith("baked_")) mat = new THREE.MeshStandardMaterial({ map: srcMat.map ?? null, vertexColors: !!geomOf(s).getAttribute("color"), roughness: srcMat.roughness ?? 0.8, metalness: 0, side: srcMat.side });
      else {
        const look = { ...(info.look as { main: string; trim?: string; accent?: string }), ...(colorway ? asset.colorways?.[colorway] : {}) };
        const g = garmentMaterial((info.fabric as Fabric) ?? "jersey", look, srcMat.map ?? null, (info.fabric as string) === "clog" || (info.fabric as string) === "sneaker" ? 0.5 : 0.92, info.decalTint === true);
        mat = g.material; garment = g.uniforms; garment.uSkinG.value.copy(this.skin.uSkin.value);
      }
      // FIT-SPACE GLASSES (V1.1): the module is refitted to whichever identity wears it (fitGlasses) — own geometry copy
      const gDesign = asset.slot === "glasses" && info.fit && geomOf(s).getAttribute("_gfit") ? (info.fit as GlassesDesign) : null;
      const mesh = new THREE.SkinnedMesh(gDesign ? geomOf(s).clone() : geomOf(s), mat);
      if (gDesign) mesh.userData.glassesDesign = gDesign;
      // ATTACHMENT CONTRACT (V1.1): a module with a semantic `attach` and local-frame geometry is placed on the wearer's
      // own anchors (humanAccessoryFit) — own geometry copy, refitted on every identity change
      if (info.attach && geomOf(s).getAttribute("_alocal")) { mesh.geometry = geomOf(s).clone(); mesh.userData.attachSpec = info.attach as AttachSpec; }
      mesh.name = `${asset.slot}:${asset.id}:${name}`;
      mesh.castShadow = !name.startsWith("face_"); mesh.receiveShadow = true; mesh.frustumCulled = false;
      this.body.parent!.add(mesh);
      mesh.position.copy(this.body.position); mesh.quaternion.copy(this.body.quaternion); mesh.scale.copy(this.body.scale);
      mesh.bind(new THREE.Skeleton(bones as THREE.Bone[], s.skeleton.boneInverses), this.body.bindMatrix);
      this.ownBinds(mesh, s.skeleton.boneInverses);   // own inverse binds: the head mount edits these, never the cached source
      // identity shape controls: the module's morph dictionary travels with the geometry
      if (s.morphTargetDictionary) { mesh.morphTargetDictionary = { ...s.morphTargetDictionary }; mesh.morphTargetInfluences = new Array(Object.keys(s.morphTargetDictionary).length).fill(0); }
      meshes.push(mesh);
    }
    // a garment's measured standoff per covered capsule (V1.2): baggy cloth keeps the hands out by its real volume
    const standoff = garment && this.clearance && sources[0] && hides.length ? this.clearance.garmentStandoff({ skeleton: sources[0].skeleton, geometry: geomOf(sources[0]) }, [...new Set(hides.map((r) => REGION_CAPSULE[r]).filter((c): c is string => !!c))]) : undefined;
    const piece: Piece = { asset, meshes, hides, garment, meta: standoff ? { ...info, standoff } : info, ownedBones, paint, hairColor };
    const chains = info.chains as HairChain[] | undefined;
    if (chains?.length && sources[0]) {
      const sk = sources[0].skeleton;
      const dyn = new HairDynamics(chains, this.bones, (n) => sk.boneInverses[sk.bones.findIndex((b) => b.name === n)], HUMAN_WORLD_SCALE, (info.hairMotion as HairMotionPreset | undefined) ?? "medium");
      piece.layerId = `hair-dynamics:${asset.id}`;
      this.addLayer({ ...dyn.layer(), id: piece.layerId });
      this.hair = dyn;
    }
    return piece;
  }

  /** the identity publishes landmarks + skin tone; the face layer is built on its shells */
  private adoptIdentity(p: Piece): void {
    const lm = (p.meta.landmarks as IdentityLandmarks | undefined) ?? null;
    this.landmarks = lm;
    if (!lm) { this.face = null; return; }
    const face = new HumanFace(lm);
    for (const m of p.meshes) {
      const mesh = m as THREE.SkinnedMesh;
      const baked = (mesh.material as THREE.MeshBasicMaterial).map, bake = (lm as IdentityLandmarks & { eyeBake?: { sclera: string; look: [number, number]; lid?: number } }).eyeBake;
      if (mesh.name.endsWith(":face_eyes")) mesh.material = baked && bake?.lid === 3 ? bakedEyeMaterial(face.uniforms, baked, bake.sclera, bake.look) : faceMaterial(face.uniforms, true);
      if (mesh.name.endsWith(":face_mouth")) mesh.material = faceMaterial(face.uniforms, false);
      // the face shell sits a hair above the sculpted head: it must not receive the head relief's own shadow (iris/lash ghosts)
      if (mesh.name.endsWith(":face_eyes")) { mesh.renderOrder = 2; mesh.receiveShadow = false; mesh.castShadow = false; }
      // the mirrored twin patch lies 1 mm in front of the face under it: it must not shadow its own rim (dotted seam)
      if (mesh.name.endsWith(":identity_face_twin")) mesh.castShadow = false;
    }
    // the hairstyle's flow highlights: strength + tint from the identity (lighter variation of its own hair)
    const hh = (lm as IdentityLandmarks & { hairHighlight?: { strength: number; color: [number, number, number] } }).hairHighlight;
    for (const m of p.meshes) { const u = ((m as THREE.Mesh).material as THREE.Material).userData?.hairHL as { uHL: { value: THREE.Color }; uHLs: { value: number } } | undefined; if (!u) continue;
      u.uHLs.value = hh?.strength ?? 0; if (hh) u.uHL.value.setRGB(...hh.color); }
    this.face = face;
    if (p.paint) this.setIdentity(this.config.identity.params ?? NEUTRAL_IDENTITY);
    else this.setSkinTone(this.config.identity.skinTone ?? lm.skin);
  }

  /** fit the worn glasses (fit-space modules only) to the worn identity's published glassesFit — a no-op otherwise */
  private fitGlasses(): void {
    const g = this.pieces.get("glasses"), lm = this.landmarks as (IdentityLandmarks & { glassesFit?: GlassesFitData }) | null;
    if (!g || !lm?.glassesFit) return;
    for (const m of g.meshes) { const mesh = m as THREE.SkinnedMesh, design = mesh.userData.glassesDesign as GlassesDesign | undefined; if (!design) continue;
      const geo = mesh.geometry, gf = geo.getAttribute("_gfit"); if (!gf) continue;
      // (attributes may arrive interleaved: read element-wise, write a fresh position attribute)
      const G = new Float32Array(gf.count * 4); for (let i = 0; i < gf.count; i++) { G[i * 4] = gf.getX(i); G[i * 4 + 1] = gf.getY(i); G[i * 4 + 2] = gf.getZ(i); G[i * 4 + 3] = gf.getW(i); }
      geo.setAttribute("position", new THREE.BufferAttribute(fitGlassesPositions(G, design, lm.eyes, lm.glassesFit, (lm as { attach?: GlassesAttach }).attach), 3));
      geo.computeVertexNormals(); geo.computeBoundingSphere(); }
  }

  /** seat every attach-spec accessory on the current identity's semantic anchors (landmarks.attach) */
  private fitAttached(): void {
    const at = (this.landmarks as { attach?: AttachData } | null)?.attach; if (!at) return;
    for (const [key, piece] of this.pieces) { if (!key.startsWith("accessory:")) continue;
      for (const m of piece.meshes) { const mesh = m as THREE.SkinnedMesh, spec = mesh.userData.attachSpec as AttachSpec | undefined, la = mesh.geometry.getAttribute("_alocal"); if (!spec || !la) continue;
        const M = placeAccessory(at, spec), v = new THREE.Vector3(), out = new Float32Array(la.count * 3);
        for (let i = 0; i < la.count; i++) { v.set(la.getX(i), la.getY(i), la.getZ(i)).applyMatrix4(M); out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z; }
        mesh.geometry.setAttribute("position", new THREE.BufferAttribute(out, 3)); mesh.geometry.computeVertexNormals(); mesh.geometry.computeBoundingSphere(); } }
  }

  /** hair dynamics of the worn hairstyle (null for rigid hair) */
  hair: HairDynamics | null = null;

  /** IDENTITY PARAMETERS → the canonical head: shape controls (morph influences on every head-fitted piece), the
   *  eyes, the painted features, the skin. Uniform and influence writes only — nothing is rebuilt or reloaded. */
  setIdentity(params: IdentityParams): void {
    const p = clampIdentity(params);
    this.identity = p;
    this.config = { ...this.config, identity: { ...this.config.identity, params: p, skinTone: p.skin } };
    this.applyShape();
    const paint = this.pieces.get("identity")?.paint;
    if (paint) {
      (paint.uSkinH.value as THREE.Color).set(p.skin);
      (paint.uEyeP.value as THREE.Vector4).set(p.eyes.scale, p.eyes.spacing, p.eyes.openness, p.eyes.tilt);
      paint.uCrease.value = p.eyes.crease;
      (paint.uBrow.value as THREE.Vector4).set(p.brows.height, p.brows.thickness, p.brows.arch, p.brows.tilt);
      (paint.uBrow2.value as THREE.Vector2).set(p.brows.length, p.brows.gap);
      (paint.uBrowC.value as THREE.Color).set(p.brows.color);
      (paint.uNose.value as THREE.Vector3).set(p.shape.noseSize, p.shape.noseWidth, p.nose.nostril);
      (paint.uLip.value as THREE.Vector4).set(p.lips.width, p.lips.upper, p.lips.lower, p.lips.bow);
      paint.uLipFull.value = p.shape.lipFull;
      (paint.uLipC.value as THREE.Color).set(p.lips.color);
      (paint.uLip2.value as THREE.Vector4).set(p.lips.offset ?? 0, p.lips.smile ?? 0, p.lips.line ?? 0, p.lips.under ?? 0);
      paint.uBlush.value = p.cheeks.blush;
      (paint.uStub.value as THREE.Vector3).set(p.facialHair.stubble, p.facialHair.mustache, p.facialHair.chin);
      (paint.uStubC.value as THREE.Color).set(p.facialHair.color);
    }
    if (this.face) {
      const u = this.face.uniforms;
      u.uEyeP.value.set(p.eyes.scale, p.eyes.spacing, p.eyes.openness, p.eyes.tilt);
      u.uIrisSize.value = p.eyes.irisSize;
      u.uMouthDY.value = ((p.lips.offset ?? 0) * 0.025) / (this.face.landmarks.mouth.halfW * 1.25);
      u.uIris.value.set(p.eyes.iris);
      this.face.lidRest = p.eyes.lidRest;
    }
    this.setSkinTone(p.skin);
  }

  /** the shape controls on every piece that carries them (head, face shells, fitted hair and glasses) */
  private applyShape(): void {
    // a hairstyle that covers the ears tucks them (the canonical head's earTuck control)
    const tuck = this.pieces.get("hair")?.meta.tucksEars ? 1 : 0;
    for (const piece of this.pieces.values()) for (const o of piece.meshes) {
      const m = o as THREE.Mesh; if (!m.morphTargetDictionary || !m.morphTargetInfluences) continue;
      for (const k of SHAPE_CONTROLS) { const i = m.morphTargetDictionary[k]; if (i !== undefined) m.morphTargetInfluences[i] = this.identity.shape[k]; }
      const t = m.morphTargetDictionary.earTuck; if (t !== undefined) m.morphTargetInfluences[t] = tuck;
    }
  }
  setHairColor(hex: string): void { this.pieces.get("hair")?.hairColor?.value.set(hex); this.config = { ...this.config, hair: { ...this.config.hair, color: hex } }; }

  /** a rigid accessory on a contract socket (the proof's badge is built here; production ones arrive as GLBs
   *  through the same socket path) */
  private buildProcedural(asset: AppearanceAsset): Piece {
    const socket = HUMAN_SOCKETS[(asset.socket as SocketName) ?? "chest"];
    const g = new THREE.Group(); g.name = `accessory:${asset.id}`;
    const card = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.1, 0.006), new THREE.MeshStandardMaterial({ color: 0xf6f4ef, roughness: 0.4 }));
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.022, 0.0065), new THREE.MeshStandardMaterial({ color: 0x5dd9b3, roughness: 0.4 }));
    band.position.y = 0.032;
    const clip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.016, 0.01), new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.3, metalness: 0.6 }));
    clip.position.y = 0.055;
    const photo = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.034, 0.0068), new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.5 }));
    photo.position.set(-0.014, -0.012, 0);
    g.add(card, band, clip, photo);
    g.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
    // bone-local = boneInverse · bindMatrix · socket(bind) — plus the worn top's thickness so it sits ON the fabric
    const top = this.pieces.get("top");
    const standoff = top?.asset.id === "hoodie-crrn" ? 0.034 : 0.016;
    const sock = new THREE.Matrix4().compose(new THREE.Vector3(socket.position[0], socket.position[1], socket.position[2] + standoff), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.12, 0, 0)), new THREE.Vector3(1, 1, 1));
    const i = this.body.skeleton.bones.findIndex((b) => b.name === socket.bone);
    const local = this.body.skeleton.boneInverses[i].clone().multiply(this.body.bindMatrix).multiply(sock);
    local.decompose(g.position, g.quaternion, g.scale);
    this.bones.get(socket.bone)!.add(g);
    return { asset, meshes: [g], hides: [], meta: {} };
  }

  setColorway(slot: AppearanceSlot, name: string): void {
    const p = this.pieces.get(slot);
    const cw = p?.asset.colorways?.[name];
    if (!p?.garment || !cw) return;
    p.garment.uMain.value.set(cw.main);
    p.garment.uTrim.value.set(cw.trim ?? cw.main);
    if (cw.accent) p.garment.uAccent.value.set(cw.accent);
    p.garment.uDecalLight.value = decalLightFor(cw.main);
    const s = slot as "top" | "bottom" | "shoes";
    if (s === "top" || s === "bottom" || s === "shoes") this.config = { ...this.config, [s]: { ...this.config[s], colorway: name } };
  }

  setSkinTone(hex: string): void {
    this.skin.uSkin.value.set(hex);
    for (const p of this.pieces.values()) p.garment?.uSkinG.value.set(hex);
    this.face?.setSkin(hex);
  }

  private updateHideMask(): void {
    this.skin.uHide.value = regionMask([...this.pieces.values()].flatMap((p) => p.hides)) | 0;
    // garments thicken the envelopes of the regions they cover
    const CAP = REGION_CAPSULE, extra: Record<string, number> = {};
    // (thickness = the larger of the catalogue value and the garment's MEASURED standoff over that region — V1.2)
    for (const p of this.pieces.values()) { const so = (p.meta.standoff ?? {}) as Record<string, number>; for (const r of p.hides) { const c = CAP[r]; if (c) extra[c] = Math.max(extra[c] ?? 0, p.asset.thickness ?? 0, so[c] ?? 0); } }
    if (this.clearance) this.clearance.extra = extra;
  }
  get hideMask(): number { return this.skin.uHide.value; }
  piece(slot: string): { id: string; meshes: readonly THREE.Object3D[] } | null { const p = this.pieces.get(slot); return p ? { id: p.asset.id, meshes: p.meshes } : null; }

  // ---- animation --------------------------------------------------------------------------------------------

  play(name: string, fade = 0.25): void {
    const next = this.actions[name];
    if (!next || this.current === name) return;
    const prev = this.current ? this.actions[this.current] : null;
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
    if (prev && fade > 0) prev.crossFadeTo(next, fade, false); else prev?.stop();
    this.current = name;
  }
  /** hold a clip still at a phase (0..1) — a seated base pose for desk work, the rider's neutral idle */
  hold(name: string, phase: number, fade = 0.3): void {
    this.play(name, fade);
    const a = this.actions[name];
    if (!a) return;
    a.timeScale = 0;
    a.time = a.getClip().duration * Math.min(0.999, Math.max(0, phase));
  }
  setTimeScale(s: number): void { if (this.current) this.actions[this.current].timeScale = s; }
  get clip(): string | null { return this.current; }
  get clipNames(): string[] { return Object.keys(this.actions); }
  /** the mixer action bound to a library clip (read access for host runtimes: time scale, freeze, debug) */
  actionFor(name: string): THREE.AnimationAction | undefined { return this.actions[name]; }
  /** the shared clip library as loaded (read-only; host runtimes read hip tracks from it — vo3d interact/seatContact) */
  clips: readonly THREE.AnimationClip[] = [];

  addLayer(l: Layer): void { this.layers = [...this.layers.filter((x) => x.id !== l.id), l].sort((a, b) => a.order - b.order); }
  removeLayer(id: string): void { this.layers = this.layers.filter((x) => x.id !== id); }

  /** the clip's own pose of every bone, captured right after the mixer (see update) */
  private clipPose: { q: THREE.Quaternion; p: THREE.Vector3 }[] | null = null;

  update(dt: number): void {
    const t0 = performance.now();
    // THREE's mixer only writes a bone whose mixed value CHANGES: a held clip (the seated pose, the rider's idle)
    // never changes, so last frame's procedural edits would stay in the bones and compound. Restore the clip's
    // pose first; the mixer then overwrites whatever it animates; the result is captured as this frame's base.
    const bones = this.body.skeleton.bones;
    if (this.clipPose) bones.forEach((b, i) => { b.quaternion.copy(this.clipPose![i].q); b.position.copy(this.clipPose![i].p); });
    this.mixer.update(dt);
    if (!this.clipPose) this.clipPose = bones.map((b) => ({ q: b.quaternion.clone(), p: b.position.clone() }));
    else bones.forEach((b, i) => { this.clipPose![i].q.copy(b.quaternion); this.clipPose![i].p.copy(b.position); });
    this.root.updateMatrixWorld(true);
    const t1 = performance.now();
    for (const l of this.layers) l.update(dt, this);
    const t2 = performance.now();
    this.face?.update(dt, this.rig);
    this.timing.mixerMs = t1 - t0; this.timing.layersMs = t2 - t1;
  }

  stats(): AvatarStats {
    const tris = (o: THREE.Object3D) => { let n = 0, d = 0; o.traverse((x) => { const m = x as THREE.Mesh; if (m.isMesh && m.visible) { const idx = m.geometry.getIndex(); n += (idx ? idx.count : m.geometry.getAttribute("position").count) / 3; d++; } }); return [n, d] as const; };
    const [bt] = tris(this.body);
    const pieces = [{ slot: "base", id: "human-base-v1", triangles: bt, draws: 1 }];
    for (const [k, p] of this.pieces) { let n = 0, d = 0; for (const m of p.meshes) { const [a, b] = tris(m); n += a; d += b; } pieces.push({ slot: k, id: p.asset.id, triangles: n, draws: d }); }
    return { pieces, triangles: pieces.reduce((a, p) => a + p.triangles, 0), draws: pieces.reduce((a, p) => a + p.draws, 0), hideMask: this.hideMask };
  }

  /** world position of a socket (bind-space point carried by its bone) */
  socketWorld(name: SocketName, out = new THREE.Vector3()): THREE.Vector3 {
    const s = HUMAN_SOCKETS[name];
    return this.rig.bindPoint(s.bone, { x: s.position[0], y: s.position[1], z: s.position[2] }, out);
  }
  get identityLandmarks(): IdentityLandmarks | null { return this.landmarks; }

  dispose(): void {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
  }
}
