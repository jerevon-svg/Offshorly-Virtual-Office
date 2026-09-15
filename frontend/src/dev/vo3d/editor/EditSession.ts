// vo3d editor — transform editing (position + yaw) over WorldState.
//
// The safe-preview workflow is unchanged and still the point: a drag, a rotation or a typed number moves
// the VIEW only; Confirm commits pos+yaw in ONE world transaction and re-syncs walkability; Cancel snaps
// the view back to the committed transform; Reset commits the transform the piece had when this session
// first touched it. Undo/Redo replay COMMITTED transforms through the same commit path (editor/History).
//
// Slice 1 extended this file with yaw, grid snapping, numeric setters, history and a multi-entity editable
// set governed by editor/editable.ts.
//
// SLICE 2 extends it again, and again does not replace it. New here:
//   · ANCHOR RETARGETING — a functional piece's gameplay anchors ride its transform (editor/anchors.ts),
//     committed in the SAME world transaction as the transform itself, so the two can never disagree;
//   · ANCHOR VALIDATION — a move is refused when it would strand a stand-here cell inside a solid or
//     outside the walkable world, because a chair nobody can reach is broken in a way nothing reports;
//   · PLACE / DUPLICATE / DELETE — real entities added to and removed from the world through the same
//     commit + walkability path, with the same preview/confirm/cancel workflow a move has;
//   · SURFACE + LED edits — routed to their registries, recorded in the same one history.
import type * as THREE from "three";
import type { Vec2 } from "../core/coords";
import type { ControllerStack } from "../avatar/Controller";
import type { Walkability } from "../nav/Walkability";
import type { SceneMirror } from "../render/SceneMirror";
import { solidContacts, validatePlacement, type PlacementCheck } from "../world/placement";
import { isSolid, type Entity, type EntityId, type Transform2, type WorldState } from "../world/WorldState";
import { deleteBlocked, lockReason, type LockReason } from "./editable";
import { entryKind, TransformHistory, type EditEntry } from "./History";
import { bindAnchors, groundAnchors, hasAnchors, retargetAnchors, type AnchorBinding } from "./anchors";
import { assetEntity, type AssetItem } from "./library";
import type { SurfaceRegistry, SurfaceSpec } from "./surfaces";
import type { EmissiveSpec, LedRegistry } from "./emissive";

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
  /** the authored frame each touched entity's world-space gameplay anchors belong to (editor/anchors.ts) */
  private readonly anchors = new Map<EntityId, AnchorBinding>();
  /** an entity that EXISTS in the world and the scene but has not been confirmed yet. Cancel removes it. */
  private pendingCreate: EntityId | null = null;
  private placed = 0;
  readonly surfaces: SurfaceRegistry | null;
  readonly leds: LedRegistry | null;
  /** the addressable surface / LED channel the panel is editing, if any */
  selectedSurface: string | null = null;
  selectedLed: string | null = null;
  readonly history = new TransformHistory();
  selected: EntityId | null = null;
  previewing = false;
  /** grid + angle snapping. OFF by default: free positioning is the historical behaviour and the toggle
   *  is the designer's, not the system's. */
  snap = { enabled: false, step: SNAP_STEP, degrees: SNAP_DEGREES };
  private active = false;

  constructor(world: WorldState, mirror: SceneMirror, walkability: Walkability, stack: ControllerStack,
              registries: { surfaces?: SurfaceRegistry; leds?: LedRegistry } = {}) {
    this.world = world; this.mirror = mirror; this.walkability = walkability; this.stack = stack;
    this.surfaces = registries.surfaces ?? null;
    this.leds = registries.leds ?? null;
  }
  get editMode(): boolean { return this.active; }
  setEditMode(on: boolean): void {
    if (on === this.active) return;
    if (on) { this.stack.acquire("Editor"); this.active = true; }
    else {
      this.cancel();
      this.selected = null; this.selectedSurface = null; this.selectedLed = null;
      this.active = false; this.stack.release("Editor");
    }
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
    this.selectedSurface = null;
    this.selectedLed = null;
    const e = id ? this.world.get(id) : null;
    this.baseline = e ? solidContacts(this.world, e, e.transform.pos) : new Set();
    if (e && hasAnchors(e.capabilities) && !this.anchors.has(e.id)) this.anchors.set(e.id, bindAnchors(e));
  }
  /** Select an addressable SURFACE (floor / wall). Mutually exclusive with an entity selection: the panel
   *  is one focused tool at a time, and a surface has no transform to show. */
  selectSurface(id: string | null): void {
    if (this.previewing) this.cancel();
    this.selected = null;
    this.selectedLed = null;
    this.selectedSurface = id;
  }
  selectLed(id: string | null): void {
    if (this.previewing) this.cancel();
    this.selected = null;
    this.selectedSurface = null;
    this.selectedLed = id;
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
    return this.check(e.id, { pos: p, yaw: this.currentYaw() });
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
    return this.check(this.selected, this.currentTransform()!);
  }
  /** Placement AND anchors. A functional piece is only validly placed when the points a body has to stand
   *  on to use it are still floor: the room's own footprint check says nothing about them. */
  private check(id: EntityId, t: Transform2): PlacementCheck {
    const e = this.world.get(id);
    const v = validatePlacement(this.world, e, t.pos, this.baseline);
    if (!v.ok) return v;
    return this.anchorsOk(id, t) ? { ok: true } : { ok: false, reason: "anchor-blocked" };
  }
  /** Every ground anchor of `id` at transform `t` lands on walkable floor, clear of every OTHER solid.
   *  The piece's own footprint is excluded — a chair's pre-seat point is meant to be right at the chair. */
  private anchorsOk(id: EntityId, t: Transform2): boolean {
    const binding = this.anchors.get(id);
    if (!binding) return true;
    const caps = retargetAnchors(binding, t);
    const solids = [...this.world.entities.values()].filter((o) => o.id !== id && o.footprint && isSolid(o.footprint));
    for (const p of groundAnchors(caps)) {
      if (!this.world.walkableAt(p)) return false;
      for (const o of solids) {
        const fp = o.footprint!;
        const { x, z } = o.transform.pos;
        const hw = fp.shape === "rect" ? fp.w / 2 : fp.shape === "circle" ? fp.r : fp.rOut;
        const hd = fp.shape === "rect" ? fp.d / 2 : hw;
        if (Math.abs(p.x - x) < hw && Math.abs(p.z - z) < hd) return false;
      }
    }
    return true;
  }
  /** the anchors `id` WOULD have at transform `t` — what the commit writes, and what a test reads */
  anchorsAt(id: EntityId, t: Transform2) {
    const binding = this.anchors.get(id);
    return binding ? retargetAnchors(binding, t) : this.world.get(id).capabilities;
  }

  // ---- commit paths -------------------------------------------------------------------------------
  /** ATOMIC: logical transform + footprint/walkability consequences in one world transaction */
  private apply(id: EntityId, next: Transform2, record: boolean, force = false): PlacementCheck {
    const before = this.world.get(id).transform;
    const v = this.check(id, next);
    if (!v.ok && !force) return v; // RESET is a restore, not a placement: it is never refused
    const binding = this.anchors.get(id);
    this.world.commit((tx) => {
      tx.setTransform(id, next);
      // ONE transaction. The anchors are not a consequence of the move that some later pass applies —
      // they are part of it, so no observer can ever see the piece at its new transform with its old
      // stand-here cell.
      if (binding) tx.setCapabilities(id, retargetAnchors(binding, next));
    });
    this.walkability.syncFromWorld(this.world); // old cells released, new cells blocked
    this.previewing = false;
    if (record && (before.pos.x !== next.pos.x || before.pos.z !== next.pos.z || before.yaw !== next.yaw)) {
      this.history.push({ kind: "transform", id, before: { pos: { ...before.pos }, yaw: before.yaw }, after: { pos: { ...next.pos }, yaw: next.yaw } });
    }
    return v;
  }
  confirm(): PlacementCheck {
    if (this.selectedSurface) return this.applySurface();
    if (this.selectedLed) return this.applyLed();
    if (!this.selected) return { ok: false, reason: "not-movable" };
    const t = this.currentTransform()!;
    if (this.pendingCreate === this.selected) {
      // A placement is confirmed by the same check a move is, then recorded as a creation. Until this
      // point the piece exists but has never been counted by navigation.
      const v = this.apply(this.selected, t, false);
      if (!v.ok) return v;
      this.history.push({ kind: "create", entity: snapshot(this.world.get(this.selected)) });
      this.pendingCreate = null;
      return v;
    }
    return this.apply(this.selected, t, true);
  }
  cancel(): void {
    if (this.selectedSurface) { this.surfaces?.cancel(this.selectedSurface); return; }
    if (this.selectedLed) { this.leds?.cancel(this.selectedLed); return; }
    if (!this.selected) return;
    if (this.pendingCreate === this.selected) { this.discardPending(); return; }
    this.mirror.applyTransform(this.selected); // back to committed pos AND yaw
    this.previewing = false;
  }
  reset(): void {
    if (this.selectedSurface) { this.surfaces?.reset(this.selectedSurface); return; }
    if (this.selectedLed) { this.leds?.reset(this.selectedLed); return; }
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
    // Undo is a COMMIT, so it carries the anchors exactly as a confirm does. Replaying the transform
    // alone would leave a chair back where it started with the stand-here cell of wherever it had been
    // dragged to — the one failure the whole anchor model exists to prevent, arriving through Ctrl-Z.
    const binding = this.anchors.get(id);
    this.world.commit((tx) => {
      tx.setTransform(id, { pos: { ...t.pos }, yaw: t.yaw });
      if (binding) tx.setCapabilities(id, retargetAnchors(binding, t));
    });
    this.walkability.syncFromWorld(this.world);
    this.previewing = false;
    return before.pos.x !== t.pos.x || before.pos.z !== t.pos.z || before.yaw !== t.yaw;
  }
  get canUndo(): boolean { return this.history.canUndo; }
  get canRedo(): boolean { return this.history.canRedo; }
  undo(): boolean { const e = this.history.undo(); if (!e) return false; this.reverse(e, "before"); return true; }
  redo(): boolean { const e = this.history.redo(); if (!e) return false; this.reverse(e, "after"); return true; }
  /** ONE replay path for every kind of edit, driven by the direction being travelled. A create replayed
   *  backwards is a delete and a delete replayed backwards is a create — which is why both record the
   *  whole entity rather than an id. */
  private reverse(e: EditEntry, dir: "before" | "after"): void {
    switch (entryKind(e)) {
      case "transform": {
        const t = e as { id: EntityId; before: Transform2; after: Transform2 };
        this.replay(t.id, dir === "before" ? t.before : t.after);
        return;
      }
      case "create": {
        const c = e as { entity: Entity };
        if (dir === "before") this.destroy(c.entity.id);
        else this.spawn(snapshot(c.entity));
        return;
      }
      case "delete": {
        const d = e as { entity: Entity };
        if (dir === "before") this.spawn(snapshot(d.entity));
        else this.destroy(d.entity.id);
        return;
      }
      case "surface": {
        const r = e as { surfaceId: string; before: SurfaceSpec; after: SurfaceSpec };
        this.surfaces?.replay(r.surfaceId, dir === "before" ? r.before : r.after);
        this.selectSurface(r.surfaceId);
        return;
      }
      case "emissive": {
        const r = e as { ledId: string; before: EmissiveSpec; after: EmissiveSpec };
        this.leds?.replay(r.ledId, dir === "before" ? r.before : r.after);
        this.selectLed(r.ledId);
        return;
      }
    }
  }

  // ---- placing, duplicating and deleting -----------------------------------------------------------
  /** The room a floor point belongs to, or null when it is outside the modelled world. */
  roomAt(p: Vec2): string | null { return this.world.regionAt(p)?.roomId ?? null; }

  /** PLACE a library asset as an UNCONFIRMED entity: it is in the world and on screen so it can be
   *  dragged, turned and validated exactly like any other piece, but navigation has not counted it and
   *  Cancel removes it without a trace. */
  placeAsset(item: AssetItem, pos: Vec2, yaw = 0): { id: EntityId; check: PlacementCheck } | { id: null; check: PlacementCheck } {
    const roomId = this.roomAt(pos);
    if (!roomId || !this.world.rooms.has(roomId)) return { id: null, check: { ok: false, reason: "no-room" } };
    this.discardPending();
    const id = this.freeId(roomId, item.kind);
    const entity = assetEntity(item, id, roomId, this.snapPos(pos), this.snapYaw(yaw));
    if (!this.spawn(entity)) return { id: null, check: { ok: false, reason: "no-room" } };
    this.pendingCreate = id;
    this.previewing = true;
    return { id, check: this.check(id, entity.transform) };
  }
  /** DUPLICATE the selection as a new unconfirmed entity, offset clear of the original. */
  duplicate(offset = 24): { id: EntityId; check: PlacementCheck } | { id: null; check: PlacementCheck } {
    if (!this.selected) return { id: null, check: { ok: false, reason: "not-movable" } };
    const src = this.world.get(this.selected);
    if (this.lockedBecause(src.id)) return { id: null, check: { ok: false, reason: "not-movable" } };
    this.discardPending();
    const id = this.freeId(src.roomId, src.kind);
    // A COPY IS A PROP, NEVER A SECOND GAMEPLAY OBJECT. The interaction wiring names its chairs by id, so
    // a duplicated chair that also carried a seat capability would be a seat no controller can ever drive
    // and a second stand-here cell nothing owns. The copy keeps the geometry and drops the wiring.
    const entity: Entity = {
      ...snapshot(src), id,
      transform: { pos: { x: src.transform.pos.x + offset, z: src.transform.pos.z + offset }, yaw: src.transform.yaw },
      capabilities: { editable: true, ...(src.capabilities.sway ? { sway: true as const } : {}) },
      source: undefined,
    };
    if (!this.spawn(entity)) return { id: null, check: { ok: false, reason: "no-room" } };
    this.pendingCreate = id;
    this.previewing = true;
    // Put the copy DOWN SOMEWHERE, rather than always down-right into whatever is there. A fixed offset
    // lands a duplicated desk inside its neighbour more often than not, and the designer's first act is
    // then always to drag it off. The eight offsets are tried in order and the first that validates wins;
    // if none does, the copy stays at the first one and is simply refused until it is moved — which is
    // the same contract a placement has.
    const t = entity.transform;
    for (const [dx, dz] of [[offset, 0], [0, offset], [-offset, 0], [0, -offset], [offset, offset], [-offset, -offset], [offset, -offset], [-offset, offset]]) {
      const at = { pos: { x: src.transform.pos.x + dx, z: src.transform.pos.z + dz }, yaw: t.yaw };
      if (this.check(id, at).ok) { this.preview(at.pos); return { id, check: { ok: true } }; }
    }
    this.preview(t.pos);
    return { id, check: this.check(id, t) };
  }
  /** Why the editor refuses to DELETE this entity, or null. Wider than the edit rule on purpose. */
  deleteBlockedBecause(id: EntityId): "system" | "locked" | null {
    const e = this.world.entities.get(id);
    return e ? deleteBlocked(e) : "locked";
  }
  /** DELETE the selection. Recorded whole, so undo brings back the same object. */
  remove(): PlacementCheck {
    if (!this.selected) return { ok: false, reason: "not-movable" };
    const id = this.selected;
    if (this.pendingCreate === id) { this.discardPending(); return { ok: true }; }
    if (this.deleteBlockedBecause(id)) return { ok: false, reason: "protected" };
    const entity = snapshot(this.world.get(id));
    this.destroy(id);
    this.history.push({ kind: "delete", entity });
    return { ok: true };
  }

  /** Add an entity to the world + scene and select it (no history, no validation — the callers own both).
   *
   *  A NEW PIECE GETS NO BASELINE, and that is the difference between placing and arranging. An existing
   *  piece is excused the contacts its own room authored (see `baseline`), because refusing to confirm a
   *  desk standing exactly where it was built would make every bench run unmovable. A piece the designer
   *  has just dropped has authored nothing: every solid it touches is a real overlap, and confirming it
   *  has to be refused until it is moved somewhere it fits. */
  private spawn(e: Entity): boolean {
    this.world.commit((tx) => tx.add(e));
    if (!this.mirror.hasView(e.id)) { this.world.commit((tx) => tx.remove(e.id)); return false; }
    this.walkability.syncFromWorld(this.world);
    this.anchors.delete(e.id);
    this.selected = e.id;
    this.selectedSurface = null;
    this.selectedLed = null;
    this.baseline = new Set();
    return true;
  }
  /** remove an entity from the world + scene (no history) */
  private destroy(id: EntityId): void {
    if (!this.world.entities.has(id)) return;
    this.world.commit((tx) => tx.remove(id));
    this.walkability.syncFromWorld(this.world);
    this.anchors.delete(id);
    this.original.delete(id);
    if (this.selected === id) { this.selected = null; this.baseline = new Set(); }
    if (this.pendingCreate === id) this.pendingCreate = null;
    this.previewing = false;
  }
  private discardPending(): void {
    if (this.pendingCreate) this.destroy(this.pendingCreate);
  }
  get pending(): EntityId | null { return this.pendingCreate; }
  private freeId(roomId: string, kind: string): EntityId {
    let id = "";
    do { id = `${roomId}/editor-${kind}-${++this.placed}`; } while (this.world.entities.has(id));
    return id;
  }

  // ---- surfaces and LEDs ---------------------------------------------------------------------------
  /** live preview of a surface treatment (uncommitted) */
  previewSurface(spec: SurfaceSpec): void { if (this.selectedSurface) this.surfaces?.show(this.selectedSurface, spec); }
  previewLed(spec: EmissiveSpec): void { if (this.selectedLed) this.leds?.show(this.selectedLed, spec); }
  private applySurface(): PlacementCheck {
    const e = this.selectedSurface ? this.surfaces?.get(this.selectedSurface) : null;
    if (!e) return { ok: false, reason: "not-movable" };
    if (!e.pending) return { ok: true };
    const before = { ...e.committed };
    const after = e.apply();
    this.history.push({ kind: "surface", surfaceId: e.id, before, after });
    return { ok: true };
  }
  private applyLed(): PlacementCheck {
    const e = this.selectedLed ? this.leds?.get(this.selectedLed) : null;
    if (!e) return { ok: false, reason: "not-movable" };
    if (!e.pending) return { ok: true };
    const before = { ...e.committed };
    const after = e.apply();
    this.history.push({ kind: "emissive", ledId: e.id, before, after });
    return { ok: true };
  }

  /** Is there anything Confirm would commit? Covers a pending transform, a pending placement and a
   *  pending surface / LED treatment — one question the panel asks for all four modes. */
  get hasPending(): boolean {
    if (this.selectedSurface) return this.surfaces?.get(this.selectedSurface)?.pending ?? false;
    if (this.selectedLed) return this.leds?.get(this.selectedLed)?.pending ?? false;
    return this.previewing;
  }

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

/** A detached copy of an entity, safe to keep in history while the world moves on. */
function snapshot(e: Entity): Entity {
  return {
    ...e,
    transform: { pos: { ...e.transform.pos }, yaw: e.transform.yaw },
    footprint: e.footprint ? { ...e.footprint } : undefined,
    placement: e.placement ? { ...e.placement } : undefined,
    capabilities: { ...e.capabilities },
    props: { ...e.props },
  };
}
