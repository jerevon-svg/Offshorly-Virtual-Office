import type { WalkDirection } from "./bonWalkFrames";
import type { AssetLayer } from "../types/office";

// Live player's own back-sit state, as far as this pure function needs it —
// deliberately a small standalone shape (not OfficeMap's full state) so this
// stays trivially testable. `baseline` is the player's own sprite bottom
// edge (position.y + height), matching the same convention depthSort.ts
// already uses for every other layer.
export interface LiveBackSitOccupant {
  isSitting: boolean;
  sitDirection: WalkDirection;
  furnitureId?: string;
  baseline: number;
}

// Suffix applied to a manifest furniture id to derive the SYNTHETIC
// backrest-crop layer id this map is keyed by (see OfficeStage.tsx's
// synthetic crop-layer generation). Exported so callers/tests never need to
// hardcode the literal string.
export const BACKREST_CROP_ID_SUFFIX = "-backrest-crop";

export function backrestCropLayerId(furnitureId: string): string {
  return `${furnitureId}${BACKREST_CROP_ID_SUFFIX}`;
}

// Builds the synthetic-crop-layer-id -> occupant-baseline map depthSort.ts's
// back-sit occlusion override consumes (see depthSort.ts's sortKey doc
// comment). Keyed by the SYNTHETIC backrest-crop layer's id
// (`${furnitureId}-backrest-crop`, see backrestCropLayerId above), NOT the
// base chair furniture id directly — the base chair layer must keep its
// original always-behind (-Infinity) sort key untouched (it still renders
// the seat/armrests/legs beneath/around the occupant exactly as before);
// only OfficeStage.tsx's cloned, clip-path-cropped "backrest only" layer
// (same `path`, so depthSort.ts's isSeat() still matches it) gets the
// front-of-occupant treatment.
//
// Only a back-facing occupant on a real manifest-linked seat (furnitureId
// set — the 4 manifest-driven rooms only, see roomSeats.ts's
// Seat.furnitureId) produces an entry. Front/left/right-facing occupants,
// unoccupied seats, and the 6 non-manifest rooms (no furnitureId) never
// produce an entry — the absence of furnitureId there is what makes this
// naturally no-op for them, no special-casing needed.
export function computeBackSitOccupantBaselines(
  rosterLayers: AssetLayer[],
  livePlayer?: LiveBackSitOccupant,
): Record<string, number> {
  const map: Record<string, number> = {};

  for (const layer of rosterLayers) {
    if (layer.sitDirection === "back" && layer.furnitureId) {
      map[backrestCropLayerId(layer.furnitureId)] = layer.y + layer.height;
    }
  }

  if (livePlayer?.isSitting && livePlayer.sitDirection === "back" && livePlayer.furnitureId) {
    map[backrestCropLayerId(livePlayer.furnitureId)] = livePlayer.baseline;
  }

  return map;
}
