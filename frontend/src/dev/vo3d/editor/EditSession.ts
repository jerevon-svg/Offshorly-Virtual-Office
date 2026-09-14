// vo3d editor — transform editing (position + yaw) over WorldState.
//
// The safe-preview workflow is unchanged and still the point: a drag, a rotation or a typed number moves
// the VIEW only; Confirm commits pos+yaw in ONE world transaction and re-syncs walkability; Cancel snaps
// the view back to the committed transform; Reset commits the transform the piece had when this session
// first touched it. Undo/Redo replay COMMITTED transforms through the same commit path (editor/History).
//
// Slice 1 extends this file — it does not replace it. New here: yaw, grid snapping, numeric setters,
// history, and a multi-entity editable set governed by editor/editable.ts.
import type * as THREE from "three";
import type { Vec2 } from "../core/coords";
import type { ControllerStack } from "../avatar/Controller";
import type { Walkability } from "../nav/Walkability";
import type { SceneMirror } from "../render/SceneMirror";
import { solidContacts, validatePlacement, type PlacementCheck } from "../world/placement";
import type { Entity, EntityId, Transform2, WorldState } from "../world/WorldState";
import { lockReason, type LockReason } from "./editable";
import { TransformHistory } from "./History";

/** V1 authors its walkability grid at 16-unit cells. Half a cell hits both cell edges and cell centres,
 *  so a snapped piece always lands on the lattice navigation itself is reasoned on. */
export const SNAP_STEP = 8;
/** rotation snap, in degrees */
export const SNAP_DEGREES = 15;

export const DEG = 180 / Math.PI;
const wrapPi = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

export class EditSession {
  private readonly world: WorldState;
  private readonly mirror: SceneMirror;
  private readonly walkability: Walkability;
  private readonly stack: ControllerStack;
  private readonly original = new Map<EntityId, Transform2>();
  /** Solids the SELECTED piece already touches where its room put it. They are excluded from its own
   *  placement check for as long as it stays selected, because a room authoring two desks that abut is
   *  not the editor's error to report — and refusing to confirm a piece standing exactly where it was
   *  built would make every run of desks unmovable. Any OTHER solid is still judged normally. */
  private baseline: ReadonlySet<EntityId> = new Set();
  readonly history = new TransformHistory();
  selected: EntityId | null = null;
  previewing = false;
  /** grid + angle snapping. OFF by default: free positioning is the historical behaviour and the toggle
   *  is the designer's, not the system's. */
  snap = { enabled: false, step: SNAP_STEP, degrees: SNAP_DEGREES };
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
  editable(): Entity[] { return [...this.world.entities.values()].filter((e) => this.lockedBecause(e.id) === null); }
  /** why the editor refuses this entity, or null. The data rule (editor/editable.ts) plus the one thing
   *  only the scene knows: whether the builder actually bound the geometry to the transform. */
  lockedBecause(id: EntityId): LockReason | null {
    const e = this.world.entities.get(id);
    if (!e) return "structural";
    const why = lockReason(e);
    if (why) return why;
    if (!e.capabilities.editable) return "structural"; // the policy was never applied to this entity
    return this.mirror.isTransformBound(id) ? null : "world-baked";
  }
  select(id: EntityId | null): void {
    if (this.previewing) this.cancel();
    this.selected = id;
    const e = id ? this.world.get(id) : null;
    this.baseline = e ? solidContacts(this.world, e, e.transform.pos) : new Set();
  }
  view(): THREE.Group | null { return this.selected ? this.mirror.view(this.selected) : null; }

  // ---- snapping -----------------------------------------------------------------------------------
  snapPos(p: Vec2): Vec2 {
    if (!this.snap.enabled) return p;
    const s = this.snap.step;
    return { x: Math.round(p.x / s) * s, z: Math.round(p.z / s) * s };
  }
  snapYaw(yaw: number): number {
    if (!this.snap.enabled) return yaw;
    const step = (this.snap.degrees * Math.PI) / 180;
    return Math.round(yaw / step) * step;
  }

  // ---- preview ------------------------------------------------------------------------------------
  private remember(e: Entity): void { if (!this.original.has(e.id)) this.original.set(e.id, e.transform); }

  /** move the view (uncommitted, snapped) and report validity at that position */
  preview(pos: Vec2): PlacementCheck {
    if (!this.selected) return { ok: false, reason: "not-movable" };
    const e = this.world.get(this.selected);
    this.remember(e);
    const p = this.snapPos(pos);
    const v = this.mirror.view(e.id);
    v.position.x = p.x; v.position.z = p.z;
    this.previewing = true;
    return validatePlacement(this.world, e, p, this.baseline);
  }
  /** turn the view around Y (uncommitted, snapped). Position is untouched — the pivot is the transform. */
  previewYaw(yaw: number): PlacementCheck {
    if (!this.selected) return { ok: false, reason: "not-movable" };
    const e = this.world.get(this.selected);
    this.remember(e);
    this.mirror.view(e.id).rotation.y = this.mirror.baseYawOf(e.id) + this.snapYaw(wrapPi(yaw));
    this.previewing = true;
    return this.validateCurrent();
  }
  /** numeric entry: one axis at a time, everything else held */
  setAxis(axis: "x" | "z", value: number): PlacementCheck {
    const cur = this.currentPos();
    if (!cur) return { ok: false, reason: "not-movable" };
    const was = this.snap.enabled;
    this.snap.enabled = false; // a typed number is exact by definition
    const r = this.preview(axis === "x" ? { x: value, z: cur.z } : { x: cur.x, z: value });
    this.snap.enabled = was;
    return r;
  }
  setYawDegrees(deg: number): PlacementCheck {
    const was = this.snap.enabled;
    this.snap.enabled = false;
    const r = this.previewYaw((deg * Math.PI) / 180);
    this.snap.enabled = was;
    return r;
  }
  nudgeYawDegrees(deg: number): PlacementCheck { return this.setYawDegrees(this.currentYawDegrees() + deg); }

  // ---- reading the live (possibly uncommitted) transform -------------------------------------------
  currentPos(): Vec2 | null { const v = this.view(); return v ? { x: v.position.x, z: v.position.z } : null; }
  currentYaw(): number {
    if (!this.selected) return 0;
    return wrapPi(this.mirror.view(this.selected).rotation.y - this.mirror.baseYawOf(this.selected));
  }
  currentYawDegrees(): number { return Math.round(this.currentYaw() * DEG * 10) / 10; }
  currentTransform(): Transform2 | null { const p = this.currentPos(); return p ? { pos: p, yaw: this.currentYaw() } : null; }
  validateCurrent(): PlacementCheck {
    if (!this.selected) return { ok: false, reason: "not-movable" };
    return validatePlacement(this.world, this.world.get(this.selected), this.currentPos()!, this.baseline);
  }

  // ---- commit paths -------------------------------------------------------------------------------
  /** ATOMIC: logical transform + footprint/walkability consequences in one world transaction */
  private apply(id: EntityId, next: Transform2, record: boolean, force = false): PlacementCheck {
    const before = this.world.get(id).transform;
    const v = validatePlacement(this.world, this.world.get(id), next.pos, this.baseline);
    if (!v.ok && !force) return v; // RESET is a restore, not a placement: it is never refused
    this.world.commit((tx) => tx.setTransform(id, next));
    this.walkability.syncFromWorld(this.world); // old cells released, new cells blocked
    this.previewing = false;
    if (record && (before.pos.x !== next.pos.x || before.pos.z !== next.pos.z || before.yaw !== next.yaw)) {
      this.history.push({ id, before: { pos: { ...before.pos }, yaw: before.yaw }, after: { pos: { ...next.pos }, yaw: next.yaw } });
    }
    return v;
  }
  confirm(): PlacementCheck {
    if (!this.selected) return { ok: false, reason: "not-movable" };
    return this.apply(this.selected, this.currentTransform()!, true);
  }
  cancel(): void {
    if (!this.selected) return;
    this.mirror.applyTransform(this.selected); // back to committed pos AND yaw
    this.previewing = false;
  }
  reset(): void {
    if (!this.selected) return;
    const id = this.selected, orig = this.original.get(id);
    if (!orig) { this.cancel(); return; }
    this.apply(id, { pos: { ...orig.pos }, yaw: orig.yaw }, true, true);
  }

  // ---- undo / redo --------------------------------------------------------------------------------
  /** Replay a recorded transform. Selection follows the change so the designer sees what moved. */
  private replay(id: EntityId, t: Transform2): boolean {
    if (this.previewing) this.cancel();
    this.selected = id;
    const before = this.world.get(id).transform;
    this.world.commit((tx) => tx.setTransform(id, { pos: { ...t.pos }, yaw: t.yaw }));
    this.walkability.syncFromWorld(this.world);
    this.previewing = false;
    return before.pos.x !== t.pos.x || before.pos.z !== t.pos.z || before.yaw !== t.yaw;
  }
  get canUndo(): boolean { return this.history.canUndo; }
  get canRedo(): boolean { return this.history.canRedo; }
  undo(): boolean { const e = this.history.undo(); if (!e) return false; this.replay(e.id, e.before); return true; }
  redo(): boolean { const e = this.history.redo(); if (!e) return false; this.replay(e.id, e.after); return true; }

  /** distance between the previewed view and the committed transform (0 = nothing pending) */
  drift(): number {
    if (!this.selected) return 0;
    const e = this.world.get(this.selected), p = this.currentPos()!;
    return Math.hypot(p.x - e.transform.pos.x, p.z - e.transform.pos.z);
  }
  /** pending yaw difference in degrees (0 = nothing pending) */
  yawDrift(): number {
    if (!this.selected) return 0;
    return Math.round(wrapPi(this.currentYaw() - this.world.get(this.selected).transform.yaw) * DEG * 10) / 10;
  }
}
