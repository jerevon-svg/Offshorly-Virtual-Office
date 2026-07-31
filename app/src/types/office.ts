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
  kind: "floor" | "room" | "character" | "decor";
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
  transform: string | null;
  blendMode?: string | null;
  name?: string | null;
};
