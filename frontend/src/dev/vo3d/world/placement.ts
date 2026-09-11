// vo3d world — placement validation owned by the world, driven by entity placement rules.
import { circleOverlapsRect, growRect, type Rect, type Vec2 } from "../core/coords";
import type { Entity, WorldState } from "./WorldState";

export type PlacementCheck = { ok: true } | { ok: false; reason: "not-movable" | "outside-room" | "overlaps-furniture" };

/** May `entity` stand at `pos`? Inside its room's floor (minus its own radius) and clear of every other solid footprint. */
export function validatePlacement(world: WorldState, entity: Entity, pos: Vec2): PlacementCheck {
  if (!entity.placement?.movable) return { ok: false, reason: "not-movable" };
  const room = world.rooms.get(entity.roomId);
  if (!room) return { ok: false, reason: "outside-room" };
  const r = entity.footprint?.shape === "circle" ? entity.footprint.r : entity.footprint ? Math.max(entity.footprint.w, entity.footprint.d) / 2 : 0;
  const f: Rect = room.floorRect;
  if (!(pos.x > f.x + r && pos.x < f.x + f.w - r && pos.z > f.z + r && pos.z < f.z + f.d - r)) return { ok: false, reason: "outside-room" };
  const clearance = entity.placement.clearance;
  for (const rect of world.solidRects(entity.id)) {
    if (circleOverlapsRect(pos, r, growRect(rect, clearance))) return { ok: false, reason: "overlaps-furniture" };
  }
  return { ok: true };
}
