// vo3d render — mirrors WorldState into the Three.js scene by entity id.
// Static room shells/baked decor are built once per room; entities get one Group each, re-positioned
// on committed transform changes. Sway nodes are registered per entity so a moved plant keeps them.
import * as THREE from "three";
import type { Entity, EntityId, RoomDef, WorldState } from "../world/WorldState";
import { buildEntity, ROOM_STATIC } from "../build/registry";
import type { ShellOptions } from "../build/shell";
import { finalizeSucculents } from "../build/props";
import { applyFloorLayerOrder } from "./floorLayers";
import { resetSeed } from "../build/helpers";
import { SwaySystem, type SwayNode } from "./Sway";
import { FoliageSystem } from "./Foliage";
import { AmbientSystem } from "./Ambient";
import { RoomVisibility } from "./RoomVisibility";
import { addStats, batchStatic, type BatchStats } from "./StaticBatch";
import { buildGroundFloor } from "../build/floorplan";
import type { GroundFloor } from "../rooms/ground-floor";

export class SceneMirror {
  readonly root = new THREE.Group();
  readonly sway = new SwaySystem();
  /** blade leaves → one InstancedMesh per built group per foliage material; driven by the sway pivots
   *  they replace, so the approved motion is unchanged. See render/Foliage. */
  readonly foliage = new FoliageSystem(this.sway);
  /** powered-surface idle animation (screens, sensors, status strips) — one update path for the whole world */
  readonly ambient = new AmbientSystem();
  /** ROOM-LEVEL CULLING. This class is the only thing that owns room subtrees, so it is the only thing
   *  that can register them; the policy itself (which camera, which margins, shadow safety) lives in
   *  render/RoomVisibility and is driven per frame by the Renderer's `cull` hook. */
  readonly visibility = new RoomVisibility();
  /** What STATIC BATCHING collapsed, cumulative over every group built so far (see render/StaticBatch). */
  batching: BatchStats = { merged: 0, batches: 0, singletons: 0, skipped: 0 };
  private readonly views = new Map<EntityId, THREE.Group>();
  /** The rotation a builder BAKED into an entity's group, net of the entity's own authored yaw.
   *
   *  Most furniture is built through `placed()`, which already turns the group to face `props.facing`; a
   *  door leaf instead applies `transform.yaw` itself. Recording `built − authored yaw` reconciles both:
   *  the live rotation is always `baseYaw + transform.yaw`, which reproduces exactly what the builder
   *  produced at yaw 0 and lets the editor turn a piece without erasing its authored facing. */
  private readonly baseYaw = new Map<EntityId, number>();
  /** Entities whose BUILDER put the group on the transform (local geometry), rather than baking world
   *  coordinates into its children. Only these can be re-positioned by `applyTransform` at all — a few
   *  builders (build/furniture curveDesk, and anything else measured straight into world space) return a
   *  group at the origin, and moving that group would teleport the piece away from its own geometry.
   *  Recorded here because it is a property of the BUILDER, not of the entity data. */
  private readonly transformBound = new Set<EntityId>();
  private readonly roomGroups = new Map<string, THREE.Group>();
  private readonly world: WorldState;

  constructor(world: WorldState, scene: THREE.Scene) {
    this.world = world;
    this.root.name = "vo3d-world";
    scene.add(this.root);
    world.changes.on(({ changed, added, removed }) => {
      removed?.forEach((id) => this.removeEntityView(id));
      added?.forEach((id) => this.addEntityView(id));
      changed.forEach((id) => this.applyTransform(id));
    });
  }
  /** The shared ground-floor skeleton (slab, sidewalk, unreconstructed footprints + boundary walls). Static. */
  buildGroundFloor(plan: GroundFloor): THREE.Group {
    const g = buildGroundFloor(plan);
    // The corridors' planting hands its sway nodes up on userData, the same channel a room's static
    // planting uses (see buildRoom below) — the ground floor now carries foliage of its own.
    const swayNodes = g.userData.sway as SwayNode[] | undefined;
    if (swayNodes?.length) this.sway.register("static:ground-floor", swayNodes);
    this.root.add(g);
    this.foliage.collect("static:ground-floor", g);
    // STATIC BATCHING last: the foliage pass has already lifted the blades out into InstancedMeshes, so
    // what is left here is the skeleton itself — slab, sidewalk, footprints, boundary walls, corridors.
    this.batching = addStats(this.batching, batchStatic(g, frozen(swayNodes), "batch:ground-floor"));
    return g;
  }
  /** Build a room's static architecture + every entity in it. Deterministic (seed reset per room).
   *  The static geometry comes from build/registry's ROOM_STATIC table already in WORLD space — this
   *  layer holds no per-room knowledge. */
  buildRoom(room: RoomDef, opts: ShellOptions): void {
    resetSeed();
    const g = new THREE.Group();
    g.name = `room:${room.id}`;
    const buildStatic = ROOM_STATIC[room.id];
    let staticGroup: THREE.Group | null = null;
    let staticSway: SwayNode[] | undefined;
    if (buildStatic) {
      const stat = buildStatic(room, opts);
      staticGroup = stat;
      g.add(stat);
      // A room whose ARCHITECTURE carries planting (the Central Hub's arc beds and planter boxes grow out
      // of the benches they sit in, so they are not entities) hands its sway nodes up on userData.
      const swayNodes = stat.userData.sway as SwayNode[] | undefined;
      staticSway = swayNodes;
      if (swayNodes?.length) this.sway.register(`static:${room.id}`, swayNodes);
      this.foliage.collect(`static:${room.id}`, stat);
    }
    for (const e of this.world.inRoom(room.id)) g.add(this.buildEntityView(e));
    finalizeSucculents(g); // desk succulent anchors → 3 instanced meshes
    applyFloorLayerOrder(g); // pin the flat floor-overlay stack so blending cannot depend on the camera
    // STATIC BATCHING, after floor ordering (it reads the renderOrder that pass writes) and before the
    // ambient collect (which must see the final tree). Scoped per subtree: the room's architecture is one
    // scope, and every entity view is its own — nothing merges across a piece's boundary.
    if (staticGroup) this.batching = addStats(this.batching, batchStatic(staticGroup, frozen(staticSway), `batch:${room.id}`));
    this.ambient.collect(room.id, g); // `userData.ambient` taggings → channels on the shared ambient system
    this.root.add(g);
    this.roomGroups.set(room.id, g);
    this.visibility.register(room.id, g, room.rect);
  }
  private buildEntityView(e: Entity): THREE.Group {
    const { group, sway } = buildEntity(e);
    group.name = e.id;
    if (e.capabilities.sway) this.sway.register(e.id, sway);
    this.baseYaw.set(e.id, group.rotation.y - e.transform.yaw);
    if (Math.abs(group.position.x - e.transform.pos.x) < 1e-6 && Math.abs(group.position.z - e.transform.pos.z) < 1e-6) this.transformBound.add(e.id);
    this.views.set(e.id, group);
    // Per-ENTITY batching, not per-room: the batch rides the piece's own view, so the editor can move,
    // turn and delete a plant with no instance bookkeeping at all, and a click on a blade still
    // raycasts through that view onto the plant (see pickEditable).
    this.foliage.collect(e.id, group);
    // ...and then collapse what is left of the piece into one mesh per material. The GROUP survives, so
    // the entity id, the editor transform, picking, the gizmo and disposal are all exactly as before.
    this.batching = addStats(this.batching, batchStatic(group, frozen(sway), `batch:${e.id}`));
    return group;
  }
  /** Build and attach the view of an entity the world has just gained (editor asset placement / an undone
   *  delete). The piece joins its own room's group, so it is disposed and rebuilt with that room. */
  addEntityView(id: EntityId): THREE.Group | null {
    const e = this.world.entities.get(id);
    if (!e || this.views.has(id)) return null;
    const g = this.roomGroups.get(e.roomId);
    if (!g) return null; // an unreconstructed room has no group to add to
    const v = this.buildEntityView(e);
    g.add(v);
    finalizeSucculents(v);
    applyFloorLayerOrder(v);
    this.visibility.invalidate(e.roomId); // the room just grew
    return v;
  }
  /** Detach and dispose the view of an entity the world has just lost. Geometry is released; the shared
   *  material cache is not touched, because every other piece in the office is still using it. */
  removeEntityView(id: EntityId): void {
    const v = this.views.get(id);
    if (!v) return;
    this.foliage.clear(id); // before the sweep below: the blade geometry is shared by every other plant
    v.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
    v.removeFromParent();
    this.views.delete(id);
    this.baseYaw.delete(id);
    this.transformBound.delete(id);
    this.sway.unregister(id);
    // the entity is already gone from the world by the time this runs, so its room cannot be named:
    // re-measure every room's bounds rather than guess. Editor deletes only.
    this.visibility.invalidate();
  }
  /** a room's built group — what the editor's surface / LED registries collect from */
  roomGroup(roomId: string): THREE.Group | null {
    return this.roomGroups.get(roomId) ?? null;
  }
  hasView(id: EntityId): boolean {
    return this.views.has(id);
  }
  view(id: EntityId): THREE.Group {
    const v = this.views.get(id);
    if (!v) throw new Error(`no view for entity ${id}`);
    return v;
  }
  /** true when re-positioning this entity's group actually moves the piece (see `transformBound`) */
  isTransformBound(id: EntityId): boolean {
    return this.transformBound.has(id);
  }
  /** the builder-baked rotation of an entity's group; 0 for anything built axis-aligned */
  baseYawOf(id: EntityId): number {
    return this.baseYaw.get(id) ?? 0;
  }
  /** Re-position a view from its committed logical transform (plants/furniture groups are centred on pos). */
  applyTransform(id: EntityId): void {
    const e = this.world.get(id);
    const v = this.views.get(id);
    if (!v) return;
    v.position.x = e.transform.pos.x;
    v.position.z = e.transform.pos.z;
    v.rotation.y = this.baseYawOf(id) + e.transform.yaw;
    this.visibility.invalidate(e.roomId); // an edited piece can push the room's bounds out
  }
  rebuildRoom(room: RoomDef, opts: ShellOptions): void {
    const old = this.roomGroups.get(room.id);
    if (old) {
      // Same reason as removeEntityView: every foliage batch hands back the ONE shared blade geometry.
      this.foliage.clear(`static:${room.id}`);
      for (const e of this.world.inRoom(room.id)) this.foliage.clear(e.id);
      old.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
      this.root.remove(old);
      for (const e of this.world.inRoom(room.id)) { this.views.delete(e.id); this.baseYaw.delete(e.id); this.transformBound.delete(e.id); this.sway.unregister(e.id); }
      this.sway.unregister(`static:${room.id}`);
      this.ambient.clearRoom(room.id); // channels are re-collected by buildRoom below
      this.visibility.unregister(room.id); // re-registered, and re-measured, by buildRoom below
    }
    this.buildRoom(room, opts);
  }
}

/** The objects the sway system animates — their subtrees are never batched (see render/StaticBatch). */
function frozen(nodes: SwayNode[] | undefined): ReadonlySet<THREE.Object3D> {
  const s = new Set<THREE.Object3D>();
  if (nodes) for (const n of nodes) s.add(n.obj);
  return s;
}
