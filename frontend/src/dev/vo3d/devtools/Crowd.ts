// vo3d devtools — THE STRESS CROWD. Dev-only, measurement-only.
//
// WHAT THIS IS. A population of extra avatars that cost what real employees cost, so the 1 → 70 scaling
// curve is measured against the V2 avatar path rather than against placeholder boxes. Nothing in here is
// reachable from the product: app/bootstrap constructs it lazily, only when a stress scenario asks for
// it, and the render loop's hooks are null-guarded no-ops until then.
//
// WHY IT IS BUILT THE WAY IT IS — every one of these is a cost decision, and each mirrors what a real
// multiplayer V2 would do rather than what is cheapest to write:
//
//   • FIVE DISTINCT ASSETS, not one repeated. The shipped cast (bon, alex, micah, angelo, jan) is five
//     separate consolidated GLBs — five geometries, five skeletons, five texture sets, five material
//     sets, five shader programs. A crowd built from one model would share a single geometry and a
//     single material and would flatter every number in the report.
//   • ONE PARSE PER CHARACTER, CLONED PER BODY (SkeletonUtils.clone). That is exactly the production
//     shape: glbCache parses a character's GLB once and every CharacterCanvas clones it. A clone gets
//     its OWN skeleton (its own bone matrices, its own per-frame bone texture upload) and its own
//     AnimationMixer, and shares geometry + materials with its siblings. So N bodies of one character
//     cost N skinning passes and N draw calls, which is the real cost, without N × 8 MB of parse.
//   • THE SAME MATERIAL RECIPE AS avatar/Avatar.ts. MeshStandardMaterial, roughness 0.9, anisotropy 8,
//     castShadow + receiveShadow ON, frustumCulled OFF (skinned bounds do not follow the animation —
//     the production avatar turns it off for the same reason, and it is also what guarantees the CAVE
//     scenarios genuinely submit all 70 bodies instead of quietly culling most of them).
//   • REAL CLIPS. idle-9 and walking, the same two the production controller crossfades between, played
//     through a real AnimationMixer at a real crossfade.
//   • NAMEPLATES. V2 has no avatar labels yet; V1 production does, and V2 will. Each body carries a
//     billboarded sprite with its own name + status text on its OWN CanvasTexture — 70 unique textures
//     and 70 extra draw calls at full crowd, which is the honest worst case. `setLabels(false)` takes
//     them out so their share of the frame can be measured rather than assumed.
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { BON_STANDING_HEIGHT, CAST_IDS, CLIP_IDLE, CLIP_WALK, type AvatarLod } from "../adapters/v1Avatar";
// Parse-once/clone-per-body and the nameplate canvas moved to avatar/CastPrototypes.ts when world/
// Coworkers.ts became the second caller — same code, one copy. See that module's header.
import { castLabelTexture, prototypeFor, type CastPrototype } from "../avatar/CastPrototypes";
import { dist, headingFor, stepAngle, type Vec2 } from "../core/coords";
import { DYNAMIC_CASTER_LAYER } from "../render/Renderer";
import { mulberry32 } from "./Stress";

/** walk speed, in world units/s — the figure the `walking` clip's stride was authored for */
const WALK_SPEED = 30;
const TURN_RATE = 7; // rad/s, the NavigationController's own figure
/** how long a roaming body stands still between legs */
const DWELL = [0.8, 3.2] as const;

export type CrowdStatus = "available" | "busy" | "away" | "in a meeting";
const STATUSES: readonly CrowdStatus[] = ["available", "busy", "away", "in a meeting"];
const STATUS_DOT: Record<CrowdStatus, string> = { available: "#4ec26a", busy: "#e2575b", away: "#e6a33a", "in a meeting": "#7a86f0" };

export type CrowdSpawn = {
  /** where this body stands (and, while roaming, the centre it stays near) */
  home: Vec2;
  /** roam radius in world units; 0 = this body never moves */
  roam: number;
};

export type CrowdMemberInfo = { name: string; character: string; status: CrowdStatus; x: number; z: number; clip: string };



class Member {
  readonly root = new THREE.Group();
  readonly mixer: THREE.AnimationMixer;
  readonly name: string;
  readonly character: string;
  readonly status: CrowdStatus;
  readonly triangles: number;
  label: THREE.Sprite | null = null;
  private readonly actions: Record<string, THREE.AnimationAction> = {};
  private current = "";
  private yaw = 0;
  private home: Vec2;
  private roam: number;
  private target: Vec2 | null = null;
  private dwell = 0;
  private rng: () => number;

  constructor(proto: CastPrototype, spawn: CrowdSpawn, name: string, status: CrowdStatus, rng: () => number) {
    this.name = name;
    this.character = proto.id;
    this.status = status;
    this.triangles = proto.triangles;
    this.home = { ...spawn.home };
    this.roam = spawn.roam;
    this.rng = rng;
    const body = cloneSkinned(proto.scene) as THREE.Group;
    this.root.add(body);
    this.root.position.set(spawn.home.x, 0, spawn.home.z);
    this.yaw = rng() * Math.PI * 2;
    this.root.rotation.set(0, this.yaw, 0);
    this.mixer = new THREE.AnimationMixer(body);
    for (const clip of proto.clips) this.actions[clip.name] = this.mixer.clipAction(clip);
    // Stagger the idle phase, or seventy bodies breathe in perfect lockstep — and, more to the point,
    // every skeleton would hit its keyframe boundaries on the same frame.
    this.play(CLIP_IDLE, 0);
    const idle = this.actions[CLIP_IDLE];
    if (idle) idle.time = rng() * (idle.getClip().duration || 1);
    this.dwell = DWELL[0] + rng() * (DWELL[1] - DWELL[0]);
  }

  addLabel(): void {
    if (this.label) return;
    const tex = castLabelTexture(this.name, this.status, STATUS_DOT[this.status]);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
    sprite.scale.set(26, 6.5, 1);
    sprite.position.set(0, BON_STANDING_HEIGHT + 6, 0);
    sprite.frustumCulled = false;
    this.root.add(sprite);
    this.label = sprite;
  }
  removeLabel(): void {
    if (!this.label) return;
    const m = this.label.material;
    m.map?.dispose();
    m.dispose();
    this.root.remove(this.label);
    this.label = null;
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

  get moving(): boolean { return this.target !== null; }
  get clip(): string { return this.current; }
  get position(): Vec2 { return { x: this.root.position.x, z: this.root.position.z }; }

  /** Roam: pick a legal point near home, walk to it, stand a moment, repeat. `canStand` is the world's
   *  own player stand test, so a stress body never ends up inside geometry or outside the floor. */
  update(dt: number, roaming: boolean, canStand: (p: Vec2) => boolean): void {
    if (roaming && this.roam > 0) {
      if (!this.target) {
        this.dwell -= dt;
        if (this.dwell <= 0) this.target = this.pick(canStand);
      } else {
        const pos = this.root.position;
        const dx = this.target.x - pos.x, dz = this.target.z - pos.z;
        const d = Math.hypot(dx, dz);
        const step = WALK_SPEED * dt;
        if (d <= step) {
          pos.x = this.target.x; pos.z = this.target.z;
          this.target = null;
          this.dwell = DWELL[0] + this.rng() * (DWELL[1] - DWELL[0]);
          this.play(CLIP_IDLE);
        } else {
          pos.x += (dx / d) * step; pos.z += (dz / d) * step;
          this.yaw = stepAngle(this.yaw, headingFor(dx, dz), dt * TURN_RATE);
          this.root.rotation.set(0, this.yaw, 0);
          this.play(CLIP_WALK);
        }
      }
    } else if (this.target) {
      this.target = null;
      this.play(CLIP_IDLE);
    }
    this.mixer.update(dt);
  }

  private pick(canStand: (p: Vec2) => boolean): Vec2 | null {
    for (let i = 0; i < 12; i++) {
      const a = this.rng() * Math.PI * 2;
      const r = 8 + this.rng() * this.roam;
      const p = { x: this.home.x + Math.cos(a) * r, z: this.home.z + Math.sin(a) * r };
      if (canStand(p) && dist(p, this.position) > 4) return p;
    }
    return null;
  }

  dispose(): void {
    this.removeLabel();
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.root.removeFromParent();
    this.root.clear();
  }
}

export type CrowdStats = {
  members: number;
  characters: string[];
  lod: AvatarLod;
  triangles: number;
  labels: boolean;
  roaming: boolean;
  moving: number;
};

/** THE CROWD. One group in the scene; everything in it is disposable in one call. */
export class Crowd {
  readonly group = new THREE.Group();
  /** true while ANY body is walking — app/bootstrap folds this into its shadow-staleness test */
  roaming = false;
  private members: Member[] = [];
  private lod: AvatarLod = 1;
  private labels = true;
  private seed = 1;
  private readonly canStand: (p: Vec2) => boolean;

  constructor(parent: THREE.Object3D, canStand: (p: Vec2) => boolean) {
    this.group.name = "stress-crowd";
    this.canStand = canStand;
    parent.add(this.group);
  }

  get size(): number { return this.members.length; }
  get moving(): boolean { return this.roaming && this.members.some((m) => m.moving); }
  get movingCount(): number { return this.members.reduce((n, m) => n + (m.moving ? 1 : 0), 0); }
  get visible(): boolean { return this.group.visible; }
  set visible(v: boolean) { this.group.visible = v; }

  /** Replace the population. Prototypes are cached per character+LOD, so a re-spawn at the same LOD
   *  re-clones from memory and never re-fetches 40 MB of GLB. */
  async spawn(spawns: readonly CrowdSpawn[], opts: { lod?: AvatarLod; labels?: boolean; seed?: number } = {}): Promise<void> {
    this.clear();
    this.lod = opts.lod ?? this.lod;
    this.labels = opts.labels ?? this.labels;
    this.seed = opts.seed ?? 1;
    if (spawns.length === 0) return;
    const ids = CAST_IDS.length ? CAST_IDS : ["bon"];
    const protos = await Promise.all(ids.map((id) => prototypeFor(id, this.lod)));
    const rng = mulberry32(this.seed);
    for (let i = 0; i < spawns.length; i++) {
      const proto = protos[i % protos.length];
      const status = STATUSES[Math.floor(rng() * STATUSES.length)];
      const name = `${cap(proto.id)} ${String(i + 1).padStart(2, "0")}`;
      const m = new Member(proto, spawns[i], name, status, rng);
      if (this.labels) m.addLabel();
      this.group.add(m.root);
      this.members.push(m);
    }
  }

  /** MEASUREMENT ONLY. Drop the crowd out of the SHADOW pass while leaving it in the beauty pass, so a
   *  capture can price the dynamic half of a shadow-map redraw against the static half. */
  setCastShadow(on: boolean): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = on;
      // The split shadow update selects dynamic casters by LAYER, not by castShadow, so a measurement
      // that only cleared castShadow would still see them composited. Both have to move together.
      if (on) o.layers.enable(DYNAMIC_CASTER_LAYER); else o.layers.disable(DYNAMIC_CASTER_LAYER);
    });
  }

  setLabels(on: boolean): void {
    this.labels = on;
    for (const m of this.members) { if (on) m.addLabel(); else m.removeLabel(); }
  }

  update(dt: number): void {
    if (!this.group.visible) return;
    for (const m of this.members) m.update(dt, this.roaming, this.canStand);
  }

  clear(): void {
    for (const m of this.members) m.dispose();
    this.members = [];
    this.group.clear();
  }

  stats(): CrowdStats {
    const characters = [...new Set(this.members.map((m) => m.character))];
    return {
      members: this.members.length,
      characters,
      lod: this.lod,
      triangles: this.members.reduce((n, m) => n + m.triangles, 0),
      labels: this.labels,
      roaming: this.roaming,
      moving: this.movingCount,
    };
  }
  info(): CrowdMemberInfo[] {
    return this.members.map((m) => ({ name: m.name, character: m.character, status: m.status, x: Math.round(m.position.x), z: Math.round(m.position.z), clip: m.clip }));
  }
}

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
