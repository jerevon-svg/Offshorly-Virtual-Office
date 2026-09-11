// vo3d editor — ONE-entity position editing over WorldState.
// Drag preview moves the VIEW only; Confirm commits transform + footprint atomically (one world transaction,
// then walkability re-syncs); Cancel snaps the view back to the committed transform; Reset commits the original.
import type * as THREE from "three";
import type { Vec2 } from "../core/coords";
import type { ControllerStack } from "../avatar/Controller";
import type { Walkability } from "../nav/Walkability";
import type { SceneMirror } from "../render/SceneMirror";
import { validatePlacement, type PlacementCheck } from "../world/placement";
import type { Entity, EntityId, Transform2, WorldState } from "../world/WorldState";

export class EditSession {
  private readonly world: WorldState;
  private readonly mirror: SceneMirror;
  private readonly walkability: Walkability;
  private readonly stack: ControllerStack;
  private readonly original = new Map<EntityId, Transform2>();
  selected: EntityId | null = null;
  previewing = false;
  private active = false;

  constructor(world: WorldState, mirror: SceneMirror, walkability: Walkability, stack: ControllerStack) {
    this.world = world; this.mirror = mirror; this.walkability = walkability; this.stack = stack;
  }
  get editMode(): boolean { return this.active; }
  setEditMode(on: boolean): void {
    if (on === this.active) return;
    if (on) { this.stack.acquire("Editor"); this.active = true; }
    else { this.cancel(); this.selected = null; this.active = false; this.stack.release("Editor"); }
  }
  /** entities the editor may touch */
  editable(): Entity[] { return [...this.world.entities.values()].filter((e) => e.capabilities.editable); }
  select(id: EntityId | null): void { if (this.previewing) this.cancel(); this.selected = id; }
  view(): THREE.Group | null { return this.selected ? this.mirror.view(this.selected) : null; }

  /** move the view (uncommitted) and report validity at that position */
  preview(pos: Vec2): PlacementCheck {
    if (!this.selected) return { ok: false, reason: "not-movable" };
    const e = this.world.get(this.selected);
    if (!this.original.has(e.id)) this.original.set(e.id, e.transform);
    const v = this.mirror.view(e.id);
    v.position.x = pos.x; v.position.z = pos.z;
    this.previewing = true;
    return validatePlacement(this.world, e, pos);
  }
  currentPos(): Vec2 | null { const v = this.view(); return v ? { x: v.position.x, z: v.position.z } : null; }
  validateCurrent(): PlacementCheck { if (!this.selected) return { ok: false, reason: "not-movable" }; const p = this.currentPos()!; return validatePlacement(this.world, this.world.get(this.selected), p); }

  /** ATOMIC: logical transform + footprint/walkability consequences in one world transaction */
  confirm(): PlacementCheck {
    if (!this.selected) return { ok: false, reason: "not-movable" };
    const id = this.selected;
    const pos = this.currentPos()!;
    const v = validatePlacement(this.world, this.world.get(id), pos);
    if (!v.ok) return v;
    this.world.commit((tx) => tx.setTransform(id, { pos, yaw: this.world.get(id).transform.yaw }));
    this.walkability.syncFromWorld(this.world); // old cells released, new cells blocked
    this.previewing = false;
    return v;
  }
  cancel(): void {
    if (!this.selected) return;
    this.mirror.applyTransform(this.selected); // back to committed
    this.previewing = false;
  }
  reset(): void {
    if (!this.selected) return;
    const id = this.selected, orig = this.original.get(id);
    if (!orig) { this.cancel(); return; }
    this.world.commit((tx) => tx.setTransform(id, orig));
    this.walkability.syncFromWorld(this.world);
    this.previewing = false;
  }
  drift(): number {
    if (!this.selected) return 0;
    const e = this.world.get(this.selected), p = this.currentPos()!;
    return Math.hypot(p.x - e.transform.pos.x, p.z - e.transform.pos.z);
  }
}
