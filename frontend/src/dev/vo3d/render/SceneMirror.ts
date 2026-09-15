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
import { AmbientSystem } from "./Ambient";
import { buildGroundFloor } from "../build/floorplan";
import type { GroundFloor } from "../rooms/ground-floor";

export class SceneMirror {
  readonly root = new THREE.Group();
  readonly sway = new SwaySystem();
  /** powered-surface idle animation (screens, sensors, status strips) — one update path for the whole world */
  readonly ambient = new AmbientSystem();
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
    if (buildStatic) {
      const stat = buildStatic(room, opts);
      g.add(stat);
      // A room whose ARCHITECTURE carries planting (the Central Hub's arc beds and planter boxes grow out
      // of the benches they sit in, so they are not entities) hands its sway nodes up on userData.
      const swayNodes = stat.userData.sway as SwayNode[] | undefined;
      if (swayNodes?.length) this.sway.register(`static:${room.id}`, swayNodes);
    }
    for (const e of this.world.inRoom(room.id)) g.add(this.buildEntityView(e));
    finalizeSucculents(g); // desk succulent anchors → 3 instanced meshes
    applyFloorLayerOrder(g); // pin the flat floor-overlay stack so blending cannot depend on the camera
    this.ambient.collect(room.id, g); // `userData.ambient` taggings → channels on the shared ambient system
    this.root.add(g);
    this.roomGroups.set(room.id, g);
  }
  private buildEntityView(e: Entity): THREE.Group {
    const { group, sway } = buildEntity(e);
    group.name = e.id;
    if (e.capabilities.sway) this.sway.register(e.id, sway);
    this.baseYaw.set(e.id, group.rotation.y - e.transform.yaw);
    if (Math.abs(group.position.x - e.transform.pos.x) < 1e-6 && Math.abs(group.position.z - e.transform.pos.z) < 1e-6) this.transformBound.add(e.id);
    this.views.set(e.id, group);
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
    return v;
  }
  /** Detach and dispose the view of an entity the world has just lost. Geometry is released; the shared
   *  material cache is not touched, because every other piece in the office is still using it. */
  removeEntityView(id: EntityId): void {
    const v = this.views.get(id);
    if (!v) return;
    v.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
    v.removeFromParent();
    this.views.delete(id);
    this.baseYaw.delete(id);
    this.transformBound.delete(id);
    this.sway.unregister(id);
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
  }
  rebuildRoom(room: RoomDef, opts: ShellOptions): void {
    const old = this.roomGroups.get(room.id);
    if (old) {
      old.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
      this.root.remove(old);
      for (const e of this.world.inRoom(room.id)) { this.views.delete(e.id); this.baseYaw.delete(e.id); this.transformBound.delete(e.id); this.sway.unregister(e.id); }
      this.sway.unregister(`static:${room.id}`);
      this.ambient.clearRoom(room.id); // channels are re-collected by buildRoom below
    }
    this.buildRoom(room, opts);
  }
}
