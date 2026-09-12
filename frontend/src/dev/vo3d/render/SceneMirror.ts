// vo3d render — mirrors WorldState into the Three.js scene by entity id.
// Static room shells/baked decor are built once per room; entities get one Group each, re-positioned
// on committed transform changes. Sway nodes are registered per entity so a moved plant keeps them.
import * as THREE from "three";
import type { Entity, EntityId, RoomDef, WorldState } from "../world/WorldState";
import { buildEntity, ROOM_STATIC } from "../build/registry";
import type { ShellOptions } from "../build/shell";
import { finalizeSucculents } from "../build/props";
import { resetSeed } from "../build/helpers";
import { SwaySystem } from "./Sway";
import { AmbientSystem } from "./Ambient";
import { buildGroundFloor } from "../build/floorplan";
import type { GroundFloor } from "../rooms/ground-floor";

export class SceneMirror {
  readonly root = new THREE.Group();
  readonly sway = new SwaySystem();
  /** powered-surface idle animation (screens, sensors, status strips) — one update path for the whole world */
  readonly ambient = new AmbientSystem();
  private readonly views = new Map<EntityId, THREE.Group>();
  private readonly roomGroups = new Map<string, THREE.Group>();
  private readonly world: WorldState;

  constructor(world: WorldState, scene: THREE.Scene) {
    this.world = world;
    this.root.name = "vo3d-world";
    scene.add(this.root);
    world.changes.on(({ changed }) => changed.forEach((id) => this.applyTransform(id)));
  }
  /** The shared ground-floor skeleton (slab, sidewalk, unreconstructed footprints + boundary walls). Static. */
  buildGroundFloor(plan: GroundFloor): THREE.Group {
    const g = buildGroundFloor(plan);
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
    if (buildStatic) g.add(buildStatic(room, opts));
    for (const e of this.world.inRoom(room.id)) g.add(this.buildEntityView(e));
    finalizeSucculents(g); // desk succulent anchors → 3 instanced meshes
    this.ambient.collect(room.id, g); // `userData.ambient` taggings → channels on the shared ambient system
    this.root.add(g);
    this.roomGroups.set(room.id, g);
  }
  private buildEntityView(e: Entity): THREE.Group {
    const { group, sway } = buildEntity(e);
    group.name = e.id;
    if (e.capabilities.sway) this.sway.register(e.id, sway);
    this.views.set(e.id, group);
    return group;
  }
  view(id: EntityId): THREE.Group {
    const v = this.views.get(id);
    if (!v) throw new Error(`no view for entity ${id}`);
    return v;
  }
  /** Re-position a view from its committed logical transform (plants/furniture groups are centred on pos). */
  applyTransform(id: EntityId): void {
    const e = this.world.get(id);
    const v = this.views.get(id);
    if (!v) return;
    v.position.x = e.transform.pos.x;
    v.position.z = e.transform.pos.z;
  }
  rebuildRoom(room: RoomDef, opts: ShellOptions): void {
    const old = this.roomGroups.get(room.id);
    if (old) {
      old.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
      this.root.remove(old);
      for (const e of this.world.inRoom(room.id)) { this.views.delete(e.id); this.sway.unregister(e.id); }
      this.ambient.clearRoom(room.id); // channels are re-collected by buildRoom below
    }
    this.buildRoom(room, opts);
  }
}
