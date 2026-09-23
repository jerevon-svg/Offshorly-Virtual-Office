// vo3d editor — WHAT the room editor is allowed to touch.
//
// The editor arranges FURNISHING, never the building. A piece is editable only when moving it cannot
// invalidate anything authored elsewhere — which in Slice 1 excluded every seat and walk-up point, because
// their gameplay anchors are authored in WORLD space and would have stayed behind.
//
// SLICE 2 removes that exclusion rather than working around it: editor/anchors.ts carries those anchors
// with the transform, so functional furniture is editable on exactly the same terms as a plant. What is
// still refused is architecture (doors, declared clearance, baked structure), a piece with no floor
// footprint to validate against, and a piece whose builder measured its geometry into world space.
//
// Nothing here is a gameplay decision — it is a read-only classification of data that already exists, plus
// one opt-in decoration (`applyEditablePolicy`) applied to the live world at dev-harness boot. Room files
// are untouched, so every room — including rooms added later — is covered by the same rule.
import type { Entity, EntityId, WorldState } from "../world/WorldState";
import { hasAnchors, hasUnmovableAnchors } from "./anchors";

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
  if (hasUnmovableAnchors(c)) return "structural"; // doors and declared architectural clearance
  // SLICE 2: seat / lounge / approach anchors are still WORLD points, but they are no longer a reason to
  // refuse the piece. editor/anchors.ts records the transform they were authored against and carries them
  // with the entity, so a moved chair takes its stand-here cell, its pre-seat gap, its walked waypoints
  // and its seated facing with it. The refusal survives only for an anchor shape nothing knows how to
  // move, which today is exactly the set `hasUnmovableAnchors` already caught above.
  if (hasAnchors(c) && hasUnmovableAnchors(c)) return "functional";
  if (!e.footprint) return "no-footprint"; // nothing to validate a floor placement against
  return null;
}
export const isEditable = (e: Entity): boolean => lockReason(e) === null;

/** Human-readable label for the UI hint shown when a locked piece is clicked. */
export const lockLabel: Record<LockReason, string> = {
  structural: "architecture — not editable",
  functional: "anchors cannot follow a transform — not editable",
  "no-footprint": "no floor footprint — not editable",
  // "world-baked" is decided by SceneMirror, not by this file: its builder measures the piece straight
  // into world space, so the group carries no transform to move. Slice 2 territory.
  "world-baked": "geometry baked in world space — not editable",
};

/** DELETION IS NARROWER THAN EDITING, deliberately.
 *
 *  A functional piece may now be moved and turned, because its anchors follow it. It may NOT be deleted:
 *  the interaction wiring holds its id (the room modules export CAFE_CHAIR_IDS, QA_SEAT_IDS, the lounge
 *  slot lists …) and a sit started against a deleted chair is a crash, not a missing prop. So the rule is:
 *  anything the editor may edit AND that carries no gameplay wiring may be deleted — which covers every
 *  desk, table, rug, plant and prop, and every piece the asset library itself placed. */
export function deleteBlocked(e: Entity): "system" | "locked" | null {
  if (!isEditable(e)) return "locked";
  return hasAnchors(e.capabilities) ? "system" : null;
}
export const deleteLabel: Record<"system" | "locked", string> = {
  system: "gameplay piece — movable, but protected from deletion",
  locked: "not an editable piece",
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
