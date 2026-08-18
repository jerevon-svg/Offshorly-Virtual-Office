import type { WalkDirection } from "../data/bonWalkFrames";

export type Room = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AssetLayer = {
  id: string;
  kind: "floor" | "room" | "character" | "decor" | "furniture" | "sidewalk";
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
  transform: string | null;
  blendMode?: string | null;
  name?: string | null;
  imgCrop?: { wPct: number; hPct: number; leftPct: number; topPct: number } | null;
  // True when this "character" layer has a full AvatarSpriteSet available
  // (see savedAvatarLayers.ts/OfficeMap.tsx) and can be resolved to an
  // animated (currently idle-front only) frame instead of a static portrait.
  // Absent/false = existing static-portrait rendering, unchanged.
  animatable?: boolean;
  // Roster real-seat sitting (see rosterLayers.ts/data/seatDirections.ts):
  // set only when this layer is a roster person seated on a real
  // hand-painted chair (not an overflow grid slot). Lets rosterSrcById
  // resolve their sprite set's directional sitType frame instead of the
  // hardcoded manifest front-sit portrait. `avatarId` is carried alongside
  // since AssetLayer.id is the person's EMAIL, not their avatar id.
  avatarId?: string | null;
  sitDirection?: WalkDirection;
  // Manifest furniture `id` (see office-assets-manifest.json / roomSeats.ts's
  // Seat.furnitureId) of the real painted chair this layer is seated on —
  // set only for a manifest-room real-seat occupant (see rosterLayers.ts).
  // Feeds the back-sit occlusion fix (depthSort.ts): lets the render layer
  // build a furnitureId -> occupant-baseline map for back-facing sitters so
  // the specific occupied chair can be forced to draw in front of them.
  // Undefined everywhere else (overflow seating, the 6 non-manifest rooms,
  // walking/idle characters).
  furnitureId?: string;
  // Set only on a SYNTHETIC backrest-crop layer (see OfficeStage.tsx's
  // synthetic crop-layer generation / chairBackrestCrop.ts) — a clone of a
  // real chair layer, same path/position/size/imgCrop, but rendered with a
  // `clip-path: inset(0 0 ${(1-frontClipBottomPct)*100}% 0)` on its wrapper
  // div so only the top `frontClipBottomPct` fraction (the backrest/headrest
  // region) is visible. Fraction (0-1), not a percentage. Undefined on every
  // other layer (including the ORIGINAL chair layer it was cloned from).
  frontClipBottomPct?: number;
};
