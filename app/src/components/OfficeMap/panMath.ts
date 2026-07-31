import { FRAME_HEIGHT, FRAME_WIDTH } from "../../data/office-layout";
import type { AssetLayer } from "../../types/office";

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function computeCenterTransform(
  layer: Pick<AssetLayer, "x" | "y" | "width" | "height">,
  scale: number,
  viewportW: number,
  viewportH: number,
): { x: number; y: number } {
  const cx = layer.x + layer.width / 2;
  const cy = layer.y + layer.height / 2;
  const contentW = FRAME_WIDTH * scale;
  const contentH = FRAME_HEIGHT * scale;
  return {
    x: clamp(viewportW / 2 - cx * scale, viewportW - contentW, 0),
    y: clamp(viewportH / 2 - cy * scale, viewportH - contentH, 0),
  };
}
