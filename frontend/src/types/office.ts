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
};
