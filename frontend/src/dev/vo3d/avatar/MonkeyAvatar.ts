// vo3d avatar — THE AI LAB MONKEY loader. DEV-ONLY, constructed only when
// `?monkey=1` is present, so the normal office pays nothing for it.
//
// This is a sibling of avatar/Avatar.ts, not a replacement. Avatar.ts is bound to
// the employee cast's 24-joint contract and its `idle-9`/`walking` clip names;
// this master is a 28-joint Mixamo skeleton with `Walking`/`Running`/`restpose`.
// Keeping them apart is what lets the monkey ship without re-binding a rig that
// already measures correct, and without touching the shipped employee path.
//
// SCENERY-SHAPED, like build/ailab itself: one group added straight to the
// scene, never to the world graph, the room mirror, the editor, the nav grid or
// the shadow-caster set. It holds no reference to WorldState or the player, so
// it cannot affect navigation or collision.
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  MONKEY_CLIPS, MONKEY_DECK_Y, MONKEY_EYE_TEXTURE_URL, MONKEY_GLB_URL, MONKEY_SLOT,
  MONKEY_STANDING_HEIGHT,
} from "../world/monkeyAgent";
import { MonkeyOutfit } from "./MonkeyOutfit";

export type MonkeyState = {
  status: "absent" | "loading" | "ready" | "error";
  clip: string;
  triangles: number;
  joints: number;
  /** native height of the source GLB, before it is scaled to the office */
  nativeHeight: number;
  /** triangles the Toucan AI Scientist outfit adds, 0 when undressed */
  outfitTriangles: number;
};

export class MonkeyAvatar {
  readonly root = new THREE.Group();
  private gltf: GLTF | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private actions: Record<string, THREE.AnimationAction> = {};
  private current: string | null = null;
  private outfit: MonkeyOutfit | null = null;
  private originalMaps = new Map<THREE.MeshStandardMaterial, THREE.Texture | null>();
  private ivoryMap: THREE.Texture | null = null;
  readonly state: MonkeyState = {
    status: "absent", clip: "-", triangles: 0, joints: 0, nativeHeight: 0, outfitTriangles: 0,
  };

  constructor() {
    this.root.name = "ai-lab-monkey";
    this.root.visible = false;
  }

  /** LAZY AND FORGIVING, exactly like world/Toucan: a missing or broken GLB
   *  leaves the Lab as it was and never breaks the app. */
  async load(): Promise<boolean> {
    if (this.gltf) return true;
    this.state.status = "loading";
    try {
      const gltf = await new GLTFLoader().loadAsync(MONKEY_GLB_URL);
      const scene = gltf.scene;
      scene.updateMatrixWorld(true);

      // FIT BY MEASUREMENT, never a magic number — the export is ~1.7 units tall
      // and the office works in ~36-unit people.
      const box = new THREE.Box3().setFromObject(scene);
      this.state.nativeHeight = box.max.y - box.min.y;
      const s = MONKEY_STANDING_HEIGHT / Math.max(1e-6, this.state.nativeHeight);
      scene.scale.setScalar(s);
      // feet on the deck, centred on the slot
      scene.position.set(
        -((box.min.x + box.max.x) / 2) * s,
        -box.min.y * s,
        -((box.min.z + box.max.z) / 2) * s,
      );

      let triangles = 0;
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        // The AI Lab is out of the shadow pass entirely (see build/ailab's cost
        // rules) — the monkey obeys the same rule rather than forcing the
        // office's static shadow frustum wider.
        m.castShadow = false;
        m.receiveShadow = false;
        m.frustumCulled = false; // skinned bounds do not follow the animation
        const idx = m.geometry.getIndex();
        triangles += idx ? idx.count / 3 : m.geometry.getAttribute("position").count / 3;
        const src = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[];
        for (const sm of src) {
          if (sm.map) sm.map.anisotropy = 8;
        }
      });
      this.state.triangles = Math.round(triangles);
      this.state.joints = (() => {
        let n = 0;
        scene.traverse((o) => { if ((o as THREE.Bone).isBone) n++; });
        return n;
      })();

      this.gltf = gltf;
      this.root.add(scene);
      this.root.position.set(MONKEY_SLOT.x, MONKEY_DECK_Y, MONKEY_SLOT.z);
      this.root.rotation.set(0, MONKEY_SLOT.yaw, 0);

      this.mixer = new THREE.AnimationMixer(scene);
      for (const clip of gltf.animations) this.actions[clip.name] = this.mixer.clipAction(clip);
      this.state.status = "ready";
      // STATIONARY BY DEFAULT. `restpose` is a real clip in the export; no idle
      // is invented and no clip name is referenced that the file does not carry.
      this.play(MONKEY_CLIPS.rest, 0);
      return true;
    } catch (err) {
      console.warn("[vo3d] ai-lab monkey unavailable:", err);
      this.state.status = "error";
      return false;
    }
  }

  get loaded(): boolean { return this.gltf !== null; }

  /** Dress as the Toucan AI Scientist. Purely additive — the character's mesh,
   *  skeleton, weights, animations and scale are untouched, and `undress()`
   *  restores the approved master exactly. */
  dress(): boolean {
    if (!this.gltf) return false;
    if (!this.outfit) this.outfit = new MonkeyOutfit();
    const ok = this.outfit.attach(this.gltf.scene);
    this.state.outfitTriangles = ok ? this.outfit.triangles : 0;
    return ok;
  }

  undress(): void {
    this.outfit?.dispose();
    this.outfit = null;
    this.state.outfitTriangles = 0;
  }

  get dressed(): boolean { return this.outfit !== null; }

  /** Swap in the warm-ivory-sclera texture. Reversible: the shipped map is kept
   *  per material and restored by `restoreEyes()`. The GLB is never modified. */
  async warmEyes(): Promise<boolean> {
    if (!this.gltf) return false;
    if (!this.ivoryMap) {
      const loader = new THREE.TextureLoader();
      this.ivoryMap = await loader.loadAsync(MONKEY_EYE_TEXTURE_URL);
      this.ivoryMap.flipY = false;                 // glTF convention
      this.ivoryMap.colorSpace = THREE.SRGBColorSpace;
      this.ivoryMap.anisotropy = 8;
    }
    this.gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[];
      for (const mat of mats) {
        // ONLY materials that already carry the character's baked texture. The
        // outfit's pieces are parented to bones INSIDE this scene, so an
        // unguarded swap painted the lab coat with the monkey's fur atlas.
        if (!mat.map) continue;
        if (!this.originalMaps.has(mat)) this.originalMaps.set(mat, mat.map);
        mat.map = this.ivoryMap;
        mat.needsUpdate = true;
      }
    });
    return true;
  }

  restoreEyes(): void {
    for (const [mat, map] of this.originalMaps) {
      mat.map = map;
      mat.needsUpdate = true;
    }
    this.originalMaps.clear();
  }

  get eyesWarm(): boolean { return this.originalMaps.size > 0; }
  get visible(): boolean { return this.root.visible; }
  set visible(v: boolean) { this.root.visible = v; }

  /** does the loaded GLB actually carry this clip? */
  hasClip(name: string): boolean { return this.actions[name] !== undefined; }

  play(name: string, fade = 0.25): void {
    if (this.current === name) return;
    const next = this.actions[name];
    if (!next) return; // unknown clip: stay on what is already playing
    const prev = this.current ? this.actions[this.current] : null;
    next.reset().setEffectiveWeight(1).play();
    if (prev && fade > 0) prev.crossFadeTo(next, fade, false);
    else if (prev) prev.stop();
    this.current = name;
    this.state.clip = name;
  }

  /** the only two states this master can honestly express today */
  setMoving(moving: boolean): void {
    this.play(moving ? MONKEY_CLIPS.walk : MONKEY_CLIPS.rest);
  }

  update(dt: number): void {
    if (!this.root.visible) return;
    this.mixer?.update(dt);
  }

  dispose(): void {
    if (!this.gltf) return;
    this.mixer?.stopAllAction();
    this.root.remove(this.gltf.scene);
    this.gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry?.dispose();
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.undress();
    this.actions = {};
    this.gltf = null;
    this.mixer = null;
    this.current = null;
    this.state.status = "absent";
  }
}
