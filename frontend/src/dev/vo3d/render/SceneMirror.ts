// vo3d render — mirrors WorldState into the Three.js scene by entity id.
// Static room shells/baked decor are built once per room; entities get one Group each, re-positioned
// on committed transform changes. Sway nodes are registered per entity so a moved plant keeps them.
import * as THREE from "three";
import type { Entity, EntityId, RoomDef, WorldState } from "../world/WorldState";
import { buildEntity } from "../build/registry";
import { buildShell, type ShellOptions } from "../build/shell";
import { buildDesignBaked, type DesignBaked } from "../build/baked";
import { finalizeSucculents } from "../build/props";
import { resetSeed } from "../build/helpers";
import { SwaySystem } from "./Sway";

export class SceneMirror {
  readonly root = new THREE.Group();
  readonly sway = new SwaySystem();
  private readonly views = new Map<EntityId, THREE.Group>();
  private readonly roomGroups = new Map<string, THREE.Group>();
  private readonly world: WorldState;

  constructor(world: WorldState, scene: THREE.Scene) {
    this.world = world;
    this.root.name = "vo3d-world";
    scene.add(this.root);
    world.changes.on(({ changed }) => changed.forEach((id) => this.applyTransform(id)));
  }
  /** Build a room's static shell/decor + every entity in it. Deterministic (seed reset per room). */
  buildRoom(room: RoomDef, opts: ShellOptions): void {
    resetSeed();
    const g = new THREE.Group();
    g.name = `room:${room.id}`;
    const shell = buildShell({ w: room.rect.w, d: room.rect.d }, room.shell, opts);
    shell.position.set(room.rect.x, 0, room.rect.z); // static geometry offset only — logic never uses a room-local origin
    g.add(shell);
    if (room.id === "design-room") {
      const baked = buildDesignBaked(room.baked as DesignBaked, room.shell);
      baked.position.set(room.rect.x, 0, room.rect.z);
      g.add(baked);
    }
    for (const e of this.world.inRoom(room.id)) g.add(this.buildEntityView(e));
    finalizeSucculents(g); // desk succulent anchors → 3 instanced meshes
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
    }
    this.buildRoom(room, opts);
  }
}
