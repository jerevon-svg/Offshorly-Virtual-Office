import { officeAssetLayers, bonLayer } from "../../data/office-layout";

// Maps a backend-assigned offline-lineup slot index to a fixed world position on the
// sidewalk, so multiple checked-out people stand in a clean row instead of overlapping at
// the single exit-spawn point (bonLayer). Pure/deterministic — no I/O, safe to call from
// anywhere (client walk targets, future Phase 2 peer-avatar rendering).

const sidewalk = officeAssetLayers.find((layer) => layer.id === "sidewalk");

// bon's own character footprint stands in for "avatar width" generally — every character
// sprite in this office shares the same footprint (see characterSprite/bonWalkFrames), so
// there's no per-person size to account for.
const AVATAR_WIDTH = bonLayer.width;
const AVATAR_HEIGHT = bonLayer.height;

// Gap between adjacent slots, in the same spirit as rosterLayers.ts's SEAT_GAP_X (12px)
// used for seat spacing — sized a bit more generously here since walking avatars (not
// static seated portraits) benefit from a little more breathing room.
const SLOT_GAP_X = 16;
const SLOT_SPACING_X = AVATAR_WIDTH + SLOT_GAP_X;

// Small inward margin so slot 0 doesn't sit flush against the sidewalk's left edge.
const MARGIN_X = 8;

// Vertical row spacing, used only once a row overflows the sidewalk's width (defensive —
// not expected in practice for realistic headcounts, but keeps arbitrarily many slots
// within bounds, wrapping into additional rows rather than running off the sidewalk). Flush
// (no gap) vertically, since the sidewalk band is only ~2 avatar-heights tall — this still
// keeps every row's bounding box non-overlapping with its neighbors.
const ROW_SPACING_Y = AVATAR_HEIGHT;

function sidewalkBounds() {
  if (sidewalk) {
    return { x: sidewalk.x, y: sidewalk.y, width: sidewalk.width, height: sidewalk.height };
  }
  // Defensive fallback if the manifest ever loses its sidewalk layer — anchors the row at
  // bon's own known exit-spawn spot rather than throwing, matching the same spot the
  // pre-slot checkout walk already used.
  return { x: bonLayer.x, y: bonLayer.y, width: AVATAR_WIDTH * 20, height: AVATAR_HEIGHT };
}

/** Fixed world position (top-left, matching AssetLayer/character-position convention) for a
 * given offline-lineup slot index. Deterministic and pure — same slot always maps to the
 * same position. Positions are laid out left-to-right along the sidewalk, wrapping into
 * additional rows (toward the sidewalk's bottom edge) if a row would otherwise run past the
 * sidewalk's right edge. */
export function slotIndexToPosition(slot: number): { x: number; y: number } {
  const bounds = sidewalkBounds();
  const usableWidth = Math.max(SLOT_SPACING_X, bounds.width - MARGIN_X * 2);
  const perRow = Math.max(1, Math.floor(usableWidth / SLOT_SPACING_X));

  const row = Math.floor(slot / perRow);
  const col = slot % perRow;

  const x = bounds.x + MARGIN_X + col * SLOT_SPACING_X;
  // Row 0 sits at the sidewalk's top edge (bonLayer.y already lands within a fraction of a
  // pixel of this — the pre-slot checkout walk always used bonLayer's y); additional wrapped
  // rows stack downward from there, each flush against the last.
  const y = bounds.y + row * ROW_SPACING_Y;

  return { x, y };
}
