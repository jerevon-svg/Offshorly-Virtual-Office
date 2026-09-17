// vo3d world — REAL COWORKERS ON THE FLOOR. Phase 4A: static, read-only, one body per roster person.
//
// WHAT THIS OWNS AND WHAT IT DOES NOT. It owns a THREE.Group and everything under it: the cloned bodies,
// their mixers, their nameplates. `dispose()` takes all of it out in one call, and the world calls that
// on unmount. It does NOT own the data — app/Vo3dHost.tsx subscribes to V1's roster through V1's own
// hooks and pushes a resolved list in. React owns subscriptions, the world owns scene objects, and
// neither reaches into the other.
//
// SNAP, NEVER WALK. Every body stands where its Vo3dCoworker says and plays one idle clip. There is no
// roam, no path, no target and no locomotion: devtools/Crowd.ts (which this is modelled on) has all of
// that for the stress harness, and it is deliberately absent here. Phase 4B reads only the ARRIVED half
// of V1's movement feed, so a body's position changes in one step, when V1 says that person stopped
// somewhere new. Interpolating between those steps is a later phase.
//
// TWO KINDS OF CHANGE, AND THEY MUST NOT BE THE SAME CODE PATH. `sync()` is called for both, and tells
// them apart itself:
//
//   • A POPULATION CHANGE — somebody joined the roster, left it, or had their 3D character swapped. This
//     is the expensive path: it disposes bodies, fetches GLBs, and bumps `generation` so a load that
//     lands after a newer roster is dropped.
//   • A POSITION CHANGE — the same people, somewhere new. This is the cheap path, and it is SYNCHRONOUS:
//     it moves root nodes and returns. It does NOT bump `generation`, does not touch mixers, does not
//     re-clone and does not await anything.
//
// Keeping them apart is load-bearing, not tidiness. Positions now arrive from a live feed, and if a
// position update took the population path, every one of them would bump `generation` and cancel whatever
// GLB was in flight — with people moving faster than 2 MB parses, no coworker would EVER finish loading.
// `loading` (the emails whose GLB is in flight) is what lets the cheap path recognise itself while an
// expensive one is still running.
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

/** How close two DESK-PLACED coworkers may stand before the second is nudged to the next legal ring. Half
 *  a body rather than a full one: the roster's own per-room seating already gives everyone a distinct
 *  chair, so this only ever catches the residue — two overflow-grid cells that happen to sit tight, or two
 *  ring nudges that converged — and a larger figure would start shoving people across their own room.
 *
 *  IT DOES NOT APPLY TO A LIVE POSITION, IN EITHER DIRECTION — see placeCoworkers. */
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
 * A LIVE POSITION IS NEVER NUDGED BY ANOTHER COWORKER, AND NEVER NUDGES ONE (Phase 4B). The separation
 * rule is a V2 invention for a V2 problem — the roster's derived seating can put two overflow bodies in
 * each other's laps — and it is resolved in iteration order against a shared list. That is fine while the
 * input is a static seating chart, and wrong the moment one person's position comes from a live feed:
 * every step somebody takes would re-run the resolution and shuffle unrelated, stationary people around
 * the office. So the two kinds of point are kept out of each other's way entirely:
 *
 *    posSource "live" — placed against `canStand` ALONE. V1 is the source of truth for where this person
 *                       is; if V1 has two people standing in each other, V2 draws that honestly rather
 *                       than inventing a correction. Not added to `taken`, so it cannot move anyone else.
 *    posSource "desk" — placed against `canStand` PLUS separation from other desk bodies, exactly as in
 *                       Phase 4A. Unchanged, and now provably independent of anything that moves.
 *
 * `canStand` still applies to both: a persisted position is V1's truth about V1's floor, and V2 has
 * reconstructed rooms V1 never had. Refusing to stand a body inside V2's own furniture is the same
 * refusal Phase 3 makes for the signed-in employee's desk.
 *
 * Deterministic: the input is sorted by email (adapters/v1Coworkers.ts does it), and desk collisions are
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
    const live = coworker.posSource === "live";
    const pos = standablePointNear(toWorld(coworker.point), radius, live ? canStand : free);
    if (!pos) {
      unplaced.push(coworker.displayName);
      continue;
    }
    if (!live) taken.push(pos);
    placed.push({ coworker, pos });
  }
  return { placed, unplaced };
}

/** One coworker's body: a clone, a mixer, an idle action and a nameplate. */
class CoworkerBody {
  readonly root = new THREE.Group();
  readonly avatarId: string;
  readonly displayName: string;
  readonly triangles: number;
  private readonly mixer: THREE.AnimationMixer;
  private label: THREE.Sprite | null = null;

  constructor(proto: CastPrototype, name: string, at: Vec2, yaw: number, phase: number) {
    this.avatarId = proto.id;
    this.displayName = name;
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

  /** Snap to a new spot. Returns TRUE only when something actually moved.
   *
   *  The return value is what keeps the shadow map honest. A coworker's idle clip deforms them every
   *  frame but their ROOT never drifts, so the only thing that can invalidate their shadow is this call —
   *  and only when it changes something. Reporting "moved" for a sync that re-applied identical
   *  coordinates would redraw the shadow map on every snapshot tick, which at a roomful of people costs
   *  more than the bodies do. */
  moveTo(at: Vec2, yaw: number): boolean {
    if (this.root.position.x === at.x && this.root.position.z === at.z && this.root.rotation.y === yaw) {
      return false;
    }
    this.root.position.set(at.x, 0, at.z);
    this.root.rotation.set(0, yaw, 0);
    return true;
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
  /** of `rendered`, how many stand on a LIVE persisted position rather than their derived desk (Phase
   *  4B). A count, never a list of who — the readouts this feeds stay redacted. */
  live: number;
  unplaced: string[];
  missingAvatar: string[];
  triangles: number;
  loading: boolean;
};

/** One rendered body, for the dev verification surface. Display name and world position only — the same
 *  two facts the scene graph already carries in `root.name`, and deliberately NOT the email. */
export type CoworkerPosition = { name: string; x: number; z: number; source: "desk" | "live" };

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
  /** THE LATEST PLACEMENT for everyone who should have a body, by email. Rewritten by every sync,
   *  population or position. A GLB that lands mid-flight reads its body's spot from HERE rather than from
   *  the placement its own batch captured, so somebody who moved while their character was downloading is
   *  added where they are NOW, not where they were when the fetch started. */
  private wanted = new Map<string, CoworkerPlacement>();
  /** Emails whose GLB is in flight right now. This is what lets a position update recognise itself as one
   *  while a population load is still running: somebody who is neither rendered nor loading is a
   *  newcomer, and a sync with no newcomers cannot need to fetch anything. */
  private loading = new Set<string>();
  /** The last sync's roster-shaped facts, kept on the instance rather than closed over, so the expensive
   *  path's final publish (which happens after an await) reports the NEWEST answer and not the one its own
   *  batch captured several syncs ago. */
  private lastUnplaced: string[] = [];
  private lastMissingAvatar: string[] = [];
  private stats: CoworkerStats = { rendered: 0, live: 0, unplaced: [], missingAvatar: [], triangles: 0, loading: false };
  /** Bumped by every POPULATION sync. A GLB that lands after a newer roster arrived belongs to a world
   *  state that no longer exists, and is dropped rather than added — the roster can change while 8 MB is
   *  in flight. Deliberately NOT bumped by a position sync: doing so would cancel every in-flight load
   *  each time anybody took a step, and nobody would ever finish loading. */
  private generation = 0;
  private disposed = false;

  constructor(deps: CoworkersDeps) {
    this.deps = deps;
    this.group.name = "coworkers";
    deps.parent.add(this.group);
  }

  get size(): number { return this.bodies.size; }
  getStats(): CoworkerStats { return this.stats; }

  /** Every rendered body, for the dev verification surface (app/world.ts's `__vo3d.coworkers`). Name and
   *  world position only — no email, no roster row, nothing derived from the session. */
  positions(): CoworkerPosition[] {
    const out: CoworkerPosition[] = [];
    for (const [email, body] of this.bodies) {
      out.push({
        name: body.displayName,
        x: Math.round(body.root.position.x * 10) / 10,
        z: Math.round(body.root.position.z * 10) / 10,
        source: this.wanted.get(email)?.coworker.posSource ?? "desk",
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Reconcile the scene against a roster. Adds what is new, moves what has moved, removes what is gone,
   * and leaves an unchanged body completely untouched (no reload, no re-clone, no nameplate rebuild) —
   * a roster refetch fires on every SSE reconnect, and rebuilding the room each time would restart every
   * idle animation.
   *
   * SPLIT IN TWO INTERNALLY (Phase 4B) — see the module header. A sync with no newcomers never awaits,
   * never bumps `generation` and never touches a mixer, so a stream of live position updates cannot
   * disturb a GLB that is still downloading or restart an idle clip that is already playing.
   */
  async sync(list: readonly Vo3dCoworker[], missingAvatar: readonly string[] = []): Promise<void> {
    if (this.disposed) return;

    const { placed, unplaced } = placeCoworkers(list, this.deps.toWorld, this.deps.canStand, this.deps.radius);
    this.wanted = new Map(placed.map((p) => [p.coworker.email, p]));
    this.lastUnplaced = unplaced;
    this.lastMissingAvatar = [...missingAvatar];

    // ---- population reconciliation, first half: who no longer belongs -------------------------------
    let changed = false;
    for (const [email, body] of [...this.bodies]) {
      const next = this.wanted.get(email);
      // An avatarId change is a different character, not a moved one — the body has to be rebuilt.
      if (!next || next.coworker.avatarId !== body.avatarId) {
        body.dispose();
        this.bodies.delete(email);
        changed = true;
      }
    }

    // ---- position updates, for everyone who already has a body -------------------------------------
    // Synchronous, and the only thing the cheap path does. A body whose coordinates are unchanged is not
    // written to at all, so `changed` stays false and the shadow map is left alone.
    if (this.applyPositions()) changed = true;

    // ---- THE CHEAP PATH: same people, somewhere new ------------------------------------------------
    const newcomers = placed.filter(
      (p) => !this.bodies.has(p.coworker.email) && !this.loading.has(p.coworker.email),
    );
    if (newcomers.length === 0) {
      this.publishStats(this.loading.size > 0);
      if (changed) this.deps.onChanged?.();
      return;
    }

    // ---- THE EXPENSIVE PATH: somebody new, or a different character --------------------------------
    // Takes over everything in flight: `additions` is computed against the RENDERED bodies alone, so a
    // person whose load the previous generation is about to drop is re-requested here rather than lost.
    // prototypeFor is promise-cached per (character, LOD), so re-requesting one already in flight attaches
    // a second continuation to the same fetch — it does not start a second one.
    const generation = ++this.generation;
    const additions = placed.filter((p) => !this.bodies.has(p.coworker.email));
    this.loading = new Set(additions.map((p) => p.coworker.email));
    this.publishStats(true);
    if (changed) this.deps.onChanged?.();

    // Loaded in parallel, added in list order, so the scene graph order does not depend on which GLB
    // happened to resolve first. prototypeFor is cached per (character, LOD), so a second person of the
    // same character costs a clone, not a fetch.
    const lod = this.deps.lod ?? 1;
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
    // The world may have been disposed, or a newer POPULATION roster may have arrived, while those were
    // in flight. The newer batch owns `loading` now, so this one clears nothing on its way out.
    if (this.disposed || generation !== this.generation) return;

    let added = false;
    for (let i = 0; i < additions.length; i++) {
      const proto = protos[i];
      if (!proto) continue;
      const email = additions[i].coworker.email;
      // THE NEWEST SPOT, not the one this batch captured: position syncs have been running freely while
      // this downloaded. A person who dropped off the roster in the meantime has no entry and is skipped.
      const spot = this.wanted.get(email);
      if (!spot || this.bodies.has(email)) continue;
      const { coworker, pos } = spot;
      // Deterministic per person rather than random: the same viewer reloading, and two viewers looking
      // at the same room, see the same stagger instead of a fresh shuffle.
      const phase = phaseFor(coworker.email);
      const body = new CoworkerBody(proto, coworker.displayName, pos, FACING_YAW[coworker.facing], phase);
      this.group.add(body.root);
      this.bodies.set(email, body);
      added = true;
    }

    this.loading.clear();
    this.publishStats(false);
    if (added) this.deps.onChanged?.();
  }

  /** THE POSITION HALF. Moves every rendered body to its latest spot and reports whether ANY of them
   *  actually moved. Touches nothing else: no mixer, no action, no clone, no nameplate — an idle clip
   *  that is already playing keeps playing, mid-cycle, through any number of these. */
  private applyPositions(): boolean {
    let moved = false;
    for (const [email, body] of this.bodies) {
      const spot = this.wanted.get(email);
      if (!spot) continue;
      if (body.moveTo(spot.pos, FACING_YAW[spot.coworker.facing])) moved = true;
    }
    return moved;
  }

  private publishStats(loading: boolean): void {
    let triangles = 0;
    let live = 0;
    for (const [email, body] of this.bodies) {
      triangles += body.triangles;
      if (this.wanted.get(email)?.coworker.posSource === "live") live++;
    }
    this.stats = {
      rendered: this.bodies.size,
      live,
      unplaced: this.lastUnplaced,
      missingAvatar: this.lastMissingAvatar,
      triangles,
      loading,
    };
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
    this.wanted.clear();
    this.loading.clear();
    this.lastUnplaced = [];
    this.lastMissingAvatar = [];
    this.group.removeFromParent();
    this.stats = { rendered: 0, live: 0, unplaced: [], missingAvatar: [], triangles: 0, loading: false };
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
