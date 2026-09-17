// vo3d world — REAL COWORKERS ON THE FLOOR. Phase 4A: static, read-only, one body per roster person.
//
// WHAT THIS OWNS AND WHAT IT DOES NOT. It owns a THREE.Group and everything under it: the cloned bodies,
// their mixers, their nameplates. `dispose()` takes all of it out in one call, and the world calls that
// on unmount. It does NOT own the data — app/Vo3dHost.tsx subscribes to V1's roster through V1's own
// hooks and pushes a resolved list in. React owns subscriptions, the world owns scene objects, and
// neither reaches into the other.
//
// STATIC BY CONSTRUCTION. Every body stands where the roster seats it and plays one idle clip. There is
// no roam, no path, no target and no walk: devtools/Crowd.ts (which this is modelled on) has all of that
// for the stress harness, and it is deliberately absent here. Phase 4A connects no movement socket, so a
// body that moved would be moving on nothing.
//
// PLACEMENT IS REFUSED, NEVER FORCED. A seat centroid is the point a chair is drawn at, so an 8-unit body
// usually does not fit exactly on it; standablePointNear searches outward in rings by the same test every
// WASD step is judged by. A person whose desk has nothing legal within six body radii — a room V2 has not
// reconstructed, a seat buried in furniture — is SKIPPED and reported, because a body dropped inside a
// desk is worse than a body that is honestly absent.
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { BON_STANDING_HEIGHT, CLIP_IDLE, type AvatarLod } from "../adapters/v1Avatar";
import { castLabelTexture, prototypeFor, type CastPrototype } from "../avatar/CastPrototypes";
import { dist, FACING_YAW, type Vec2 } from "../core/coords";
import { standablePointNear, type StandTest } from "../player/PlayerBody";
import type { Vo3dCoworker } from "../app/coworkers";

/** How close two coworkers may stand before the second is nudged to the next legal ring. Half a body
 *  rather than a full one: the roster's own per-room seating already gives everyone a distinct chair, so
 *  this only ever catches the residue — two overflow-grid cells that happen to sit tight, or two ring
 *  nudges that converged — and a larger figure would start shoving people across their own room. */
const MIN_SEPARATION = 8;

export type CoworkerPlacement = {
  coworker: Vo3dCoworker;
  /** where the body actually stands, in V2 WORLD units */
  pos: Vec2;
};

export type CoworkerPlacementResult = {
  placed: CoworkerPlacement[];
  /** display names of coworkers with no legal standing point near their desk */
  unplaced: string[];
};

/**
 * WHERE EACH COWORKER ACTUALLY STANDS. Pure, and given its world handles rather than importing them, so
 * the world and its tests run the very same arithmetic.
 *
 * `toWorld` converts a V1 frame point into the built V2 world — app/world.ts passes the same
 * homeDeskWorldPoint the signed-in employee's own desk goes through, so a room that stands away from its
 * V1 art box moves its occupants with it. `canStand` is the world's own player stand test.
 *
 * Deterministic: the input is sorted by email (adapters/v1Coworkers.ts does it), and collisions are
 * resolved in that order, so every viewer places the same people in the same spots.
 */
export function placeCoworkers(
  list: readonly Vo3dCoworker[],
  toWorld: (p: Vec2) => Vec2,
  canStand: StandTest,
  radius: number,
): CoworkerPlacementResult {
  const placed: CoworkerPlacement[] = [];
  const unplaced: string[] = [];
  const taken: Vec2[] = [];
  const free: StandTest = (p) => canStand(p) && taken.every((t) => dist(t, p) >= MIN_SEPARATION);

  for (const coworker of list) {
    const pos = standablePointNear(toWorld(coworker.point), radius, free);
    if (!pos) {
      unplaced.push(coworker.displayName);
      continue;
    }
    taken.push(pos);
    placed.push({ coworker, pos });
  }
  return { placed, unplaced };
}

/** One coworker's body: a clone, a mixer, an idle action and a nameplate. */
class CoworkerBody {
  readonly root = new THREE.Group();
  readonly avatarId: string;
  readonly triangles: number;
  private readonly mixer: THREE.AnimationMixer;
  private label: THREE.Sprite | null = null;

  constructor(proto: CastPrototype, name: string, at: Vec2, yaw: number, phase: number) {
    this.avatarId = proto.id;
    this.triangles = proto.triangles;
    const body = cloneSkinned(proto.scene) as THREE.Group;
    this.root.name = `coworker:${name}`;
    this.root.add(body);
    this.root.position.set(at.x, 0, at.z);
    this.root.rotation.set(0, yaw, 0);
    this.mixer = new THREE.AnimationMixer(body);
    const clip = proto.clips.find((c) => c.name === CLIP_IDLE);
    if (clip) {
      const action = this.mixer.clipAction(clip);
      action.reset().setEffectiveWeight(1).play();
      // Stagger the idle phase, or a roomful of people breathe in perfect lockstep — and, more to the
      // point, every skeleton hits its keyframe boundaries on the same frame.
      action.time = phase * (clip.duration || 1);
    }
    this.addLabel(name);
  }

  /** COMPACT: the name and nothing else. No status, no dot — Phase 4A measures no presence detail, and a
   *  plate that showed one would be asserting something nobody read. */
  private addLabel(name: string): void {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: castLabelTexture(name), depthTest: true, transparent: true }));
    sprite.scale.set(22, 5.5, 1);
    sprite.position.set(0, BON_STANDING_HEIGHT + 6, 0);
    sprite.frustumCulled = false;
    this.root.add(sprite);
    this.label = sprite;
  }

  moveTo(at: Vec2, yaw: number): void {
    this.root.position.set(at.x, 0, at.z);
    this.root.rotation.set(0, yaw, 0);
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }

  /** Geometry and materials are the PROTOTYPE's and are shared with every sibling — disposing them here
   *  would blank every other body of the same character. Only what this body owns goes: its mixer's
   *  bindings, its nameplate canvas, and its own node. */
  dispose(): void {
    if (this.label) {
      const m = this.label.material;
      m.map?.dispose();
      m.dispose();
      this.root.remove(this.label);
      this.label = null;
    }
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.root.removeFromParent();
    this.root.clear();
  }
}

export type CoworkerStats = {
  rendered: number;
  unplaced: string[];
  missingAvatar: string[];
  triangles: number;
  loading: boolean;
};

export interface CoworkersDeps {
  parent: THREE.Object3D;
  /** the world's own player stand test */
  canStand: StandTest;
  /** body radius the stand test was built for (NAV_RADIUS) */
  radius: number;
  /** V1 frame point -> built V2 world point, room shifts applied */
  toWorld: (p: Vec2) => Vec2;
  lod?: AvatarLod;
  /** called after bodies are added or removed, so the world can redraw its shadows */
  onChanged?: () => void;
}

/** THE COWORKERS. One group in the scene; everything in it is disposable in one call. */
export class Coworkers {
  readonly group = new THREE.Group();
  private readonly deps: CoworkersDeps;
  private bodies = new Map<string, CoworkerBody>();
  private stats: CoworkerStats = { rendered: 0, unplaced: [], missingAvatar: [], triangles: 0, loading: false };
  /** Bumped by every sync. A GLB that lands after a newer roster arrived belongs to a world state that no
   *  longer exists, and is dropped rather than added — the roster can change while 8 MB is in flight. */
  private generation = 0;
  private disposed = false;

  constructor(deps: CoworkersDeps) {
    this.deps = deps;
    this.group.name = "coworkers";
    deps.parent.add(this.group);
  }

  get size(): number { return this.bodies.size; }
  getStats(): CoworkerStats { return this.stats; }

  /**
   * Reconcile the scene against a roster. Adds what is new, moves what has moved, removes what is gone,
   * and leaves an unchanged body completely untouched (no reload, no re-clone, no nameplate rebuild) —
   * a roster refetch fires on every SSE reconnect, and rebuilding the room each time would restart every
   * idle animation.
   */
  async sync(list: readonly Vo3dCoworker[], missingAvatar: readonly string[] = []): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.generation;

    const { placed, unplaced } = placeCoworkers(list, this.deps.toWorld, this.deps.canStand, this.deps.radius);
    const wanted = new Map(placed.map((p) => [p.coworker.email, p]));

    let changed = false;
    for (const [email, body] of [...this.bodies]) {
      const next = wanted.get(email);
      // An avatarId change is a different character, not a moved one — the body has to be rebuilt.
      if (!next || next.coworker.avatarId !== body.avatarId) {
        body.dispose();
        this.bodies.delete(email);
        changed = true;
      }
    }

    this.stats = { ...this.stats, unplaced, missingAvatar: [...missingAvatar], loading: true };

    // Loaded in parallel, added in list order, so the scene graph order does not depend on which GLB
    // happened to resolve first. prototypeFor is cached per (character, LOD), so a second person of the
    // same character costs a clone, not a fetch.
    const lod = this.deps.lod ?? 1;
    const additions = placed.filter((p) => !this.bodies.has(p.coworker.email));
    const protos = await Promise.all(
      additions.map((p) =>
        // A character whose GLB will not load must not take the world down with it, or one bad asset
        // costs every other coworker too. The failure is swallowed to a null and that person is simply
        // absent, which is the same honest absence a missing registry entry produces.
        prototypeFor(p.coworker.avatarId, lod).catch((e: unknown) => {
          console.warn(`vo3d: could not load the 3D character for ${p.coworker.displayName}`, e);
          return null;
        }),
      ),
    );
    // The world may have been disposed, or a newer roster may have arrived, while those were in flight.
    if (this.disposed || generation !== this.generation) return;

    for (let i = 0; i < additions.length; i++) {
      const proto = protos[i];
      if (!proto) continue;
      const { coworker, pos } = additions[i];
      // Deterministic per person rather than random: the same viewer reloading, and two viewers looking
      // at the same room, see the same stagger instead of a fresh shuffle.
      const phase = phaseFor(coworker.email);
      const body = new CoworkerBody(proto, coworker.displayName, pos, FACING_YAW[coworker.facing], phase);
      this.group.add(body.root);
      this.bodies.set(coworker.email, body);
      changed = true;
    }

    // Everyone who already had a body: move them if the roster moved them, and nothing else.
    for (const { coworker, pos } of placed) {
      const body = this.bodies.get(coworker.email);
      if (!body || additions.some((a) => a.coworker.email === coworker.email)) continue;
      body.moveTo(pos, FACING_YAW[coworker.facing]);
    }

    let triangles = 0;
    for (const body of this.bodies.values()) triangles += body.triangles;
    this.stats = { rendered: this.bodies.size, unplaced, missingAvatar: [...missingAvatar], triangles, loading: false };
    if (changed) this.deps.onChanged?.();
  }

  /** Mixers only — nobody moves in this phase. */
  update(dt: number): void {
    if (!this.group.visible) return;
    for (const body of this.bodies.values()) body.update(dt);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const body of this.bodies.values()) body.dispose();
    this.bodies.clear();
    this.group.removeFromParent();
    this.stats = { rendered: 0, unplaced: [], missingAvatar: [], triangles: 0, loading: false };
  }
}

/** A stable 0..1 from an email — the idle-phase stagger, deterministic per person. */
export function phaseFor(email: string): number {
  let h = 2166136261;
  for (let i = 0; i < email.length; i++) {
    h ^= email.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}
