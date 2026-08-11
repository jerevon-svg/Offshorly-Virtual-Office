import { FRAME_HEIGHT, FRAME_WIDTH } from "../../data/office-layout";
import type { AssetLayer } from "../../types/office";

// Fixed width (px) of the RoomSidebar overlay. Keep in sync with the literal
// width in RoomSidebar.module.css.
export const SIDEBAR_WIDTH = 340;

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

// Anchor point (as % of the design frame) for a speech-bubble greeting: above
// the character's horizontal center, at the top of their layer.
export function greetingAnchor(
  layer: Pick<AssetLayer, "x" | "y" | "width">,
): { leftPct: number; topPct: number } {
  return {
    leftPct: ((layer.x + layer.width / 2) / FRAME_WIDTH) * 100,
    topPct: (layer.y / FRAME_HEIGHT) * 100,
  };
}

export function computeRoomFocusTransform(
  layer: Pick<AssetLayer, "x" | "y" | "width" | "height">,
  opts: {
    viewportW: number;
    viewportH: number;
    sidebarW: number;
    minScale: number;
    maxScale: number;
    fill?: number;
    side?: "left" | "right";
  },
): { x: number; y: number; scale: number } {
  const { viewportW, viewportH, sidebarW, minScale, maxScale, fill = 0.9, side = "right" } = opts;
  const scale = clamp(
    fill * Math.min((viewportW - sidebarW) / layer.width, viewportH / layer.height),
    minScale,
    maxScale,
  );
  const availW = viewportW - sidebarW;
  const cx = layer.x + layer.width / 2;
  const cy = layer.y + layer.height / 2;
  const contentW = FRAME_WIDTH * scale;
  const contentH = FRAME_HEIGHT * scale;
  const regionCenterX = side === "left" ? sidebarW + availW / 2 : availW / 2;
  const x = clamp(regionCenterX - cx * scale, viewportW - contentW, 0);
  const y = clamp(viewportH / 2 - cy * scale, viewportH - contentH, 0);
  return { x, y, scale };
}
