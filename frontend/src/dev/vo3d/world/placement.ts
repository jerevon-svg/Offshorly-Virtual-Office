// vo3d world — placement validation owned by the world, driven by entity placement rules.
import { circleOverlapsRect, growRect, type Rect, type Vec2 } from "../core/coords";
import type { Entity, EntityId, WorldState } from "./WorldState";

export type PlacementCheck = { ok: true } | { ok: false; reason: "not-movable" | "outside-room" | "overlaps-furniture" | "anchor-blocked" | "no-room" | "protected" };

/** May `entity` stand at `pos`? Inside its room's floor (minus its own extent) and clear of every other
 *  solid footprint.
 *
 *  A RECT footprint is judged as a rect, a round one as a disc. That distinction matters the moment more
 *  than one piece is editable: a 120-unit desk read as a disc of radius 60 reports itself as overlapping
 *  its own neighbours while standing exactly where the room authored it, so nothing long could ever be
 *  moved or even turned in place. The footprint model is unchanged — this reads the shape that is already
 *  declared instead of inflating it. Footprints remain axis-aligned under yaw (Slice 1 boundary: oriented
 *  footprints would change what navigation rasterises, which is not an editor decision).
 *
 *  `ignore` names solids this check must not count. It exists for one honest reason: rooms author pieces
 *  that already touch — the two desks of a bench run overlap by design — and a piece may not be reported
 *  as illegally placed where its own room put it. The editor supplies the contacts a piece ALREADY has
 *  (EditSession.baseline); every other solid is judged normally, so a move into something new is still
 *  refused. */
export function validatePlacement(world: WorldState, entity: Entity, pos: Vec2, ignore?: ReadonlySet<EntityId>): PlacementCheck {
  if (!entity.placement?.movable) return { ok: false, reason: "not-movable" };
  const room = world.rooms.get(entity.roomId);
  if (!room) return { ok: false, reason: "outside-room" };
  const { hw, hd } = halfExtent(entity);
  const f: Rect = room.floorRect;
  if (!(pos.x > f.x + hw && pos.x < f.x + f.w - hw && pos.z > f.z + hd && pos.z < f.z + f.d - hd)) return { ok: false, reason: "outside-room" };
  for (const { id } of world.solidEntityRects(entity.id)) {
    if (ignore?.has(id)) continue; // a contact the ROOM already authored — see EditSession.baseline
    if (contactsSolid(world, entity, pos, id)) return { ok: false, reason: "overlaps-furniture" };
  }
  return { ok: true };
}

/** half-extents of an entity's footprint: a rect's own, a round shape's radius on both axes */
function halfExtent(entity: Entity): { hw: number; hd: number } {
  const fp = entity.footprint;
  if (!fp) return { hw: 0, hd: 0 };
  if (fp.shape === "rect") return { hw: fp.w / 2, hd: fp.d / 2 };
  const r = fp.shape === "circle" ? fp.r : fp.rOut;
  return { hw: r, hd: r };
}

/** Does `entity` standing at `pos` touch the solid belonging to `otherId`? One shape rule, used by the
 *  validator and by whoever needs to know WHICH solids a piece touches. */
function contactsSolid(world: WorldState, entity: Entity, pos: Vec2, otherId: EntityId): boolean {
  const found = world.solidEntityRects(entity.id).find((s) => s.id === otherId);
  if (!found) return false;
  const { hw, hd } = halfExtent(entity);
  const grown = growRect(found.rect, entity.placement?.clearance ?? 0);
  if (entity.footprint?.shape !== "rect") return circleOverlapsRect(pos, hw, grown);
  const self: Rect = { x: pos.x - hw, z: pos.z - hd, w: 2 * hw, d: 2 * hd };
  return self.x < grown.x + grown.w && self.x + self.w > grown.x && self.z < grown.z + grown.d && self.z + self.d > grown.z;
}

/** Every solid `entity` already touches at `pos` — the contacts its own room authored. */
export function solidContacts(world: WorldState, entity: Entity, pos: Vec2): Set<EntityId> {
  const out = new Set<EntityId>();
  const { hw, hd } = halfExtent(entity);
  const self: Rect = { x: pos.x - hw, z: pos.z - hd, w: 2 * hw, d: 2 * hd };
  const rect = entity.footprint?.shape === "rect";
  for (const { id, rect: other } of world.solidEntityRects(entity.id)) {
    const grown = growRect(other, entity.placement?.clearance ?? 0);
    const hit = rect
      ? self.x < grown.x + grown.w && self.x + self.w > grown.x && self.z < grown.z + grown.d && self.z + self.d > grown.z
      : circleOverlapsRect(pos, hw, grown);
    if (hit) out.add(id);
  }
  return out;
}
