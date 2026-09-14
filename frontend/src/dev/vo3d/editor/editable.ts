// vo3d editor — WHAT the room editor is allowed to touch.
//
// Slice 1 arranges EXISTING furniture and props. It never edits architecture, and it never edits a piece
// whose gameplay anchors are authored in WORLD space, because those anchors would not follow the transform
// and the interaction would silently break. That exclusion is the whole of "functional-object safety":
// a piece is editable only when moving it cannot invalidate anything authored elsewhere.
//
// Nothing here is a gameplay decision — it is a read-only classification of data that already exists, plus
// one opt-in decoration (`applyEditablePolicy`) applied to the live world at dev-harness boot. Room files
// are untouched, so every room — including rooms added later — is covered by the same rule.
import type { Entity, EntityId, WorldState } from "../world/WorldState";

/** default keep-out kept from other solids while arranging (the hero plant's authored 1.5 is preserved) */
export const EDITOR_CLEARANCE = 1;

/** kinds that ARE the building, not the furnishing */
const STRUCTURAL_KINDS = new Set(["solid", "sliding-door", "glass-door-leaf"]);

export type LockReason = "structural" | "functional" | "no-footprint" | "world-baked";

/** why the editor refuses this entity, or null when it may be edited */
export function lockReason(e: Entity): LockReason | null {
  if (e.capabilities.editable) return null; // explicit authored opt-in wins (rooms/design-room hero plant)
  if (STRUCTURAL_KINDS.has(e.kind) || e.source?.baked) return "structural";
  const c = e.capabilities;
  if (c.door || c.clearance) return "structural";
  // seat / lounge / approach anchors (approach, preSeat, approachToSeat, slot approaches) are WORLD points
  // authored against V1-walkable cells. They are not entity-relative, so they cannot follow a transform
  // without redesigning the interaction — out of scope for Slice 1.
  if (c.seat || c.lounge || c.approach) return "functional";
  if (!e.footprint) return "no-footprint"; // nothing to validate a floor placement against
  return null;
}
export const isEditable = (e: Entity): boolean => lockReason(e) === null;

/** Human-readable label for the UI hint shown when a locked piece is clicked. */
export const lockLabel: Record<LockReason, string> = {
  structural: "architecture — not editable",
  functional: "functional piece — locked in Slice 1",
  "no-footprint": "no floor footprint — not editable",
  // "world-baked" is decided by SceneMirror, not by this file: its builder measures the piece straight
  // into world space, so the group carries no transform to move. Slice 2 territory.
  "world-baked": "geometry baked in world space — locked in Slice 1",
};

/** Decorate every qualifying entity with `editable` + a movable Placement. Idempotent; returns the ids. */
export function applyEditablePolicy(world: WorldState): EntityId[] {
  const out: EntityId[] = [];
  for (const e of world.entities.values()) {
    if (!isEditable(e)) continue;
    out.push(e.id);
    if (e.capabilities.editable && e.placement?.movable) continue;
    world.entities.set(e.id, {
      ...e,
      capabilities: { ...e.capabilities, editable: true },
      placement: e.placement ?? { movable: true, clearance: EDITOR_CLEARANCE },
    });
  }
  return out;
}
