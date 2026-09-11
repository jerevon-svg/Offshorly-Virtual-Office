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
// The visible gap between the top of a character's head and the bottom of the
// status pill / talking bubble, in frame units. Single shared target for every
// employee — each one is matched to THIS value rather than to their own layer
// box, so the head-to-pill gap reads identically across the cast.
//
// Originally 4, taken from BON's measured gap under his approved framing
// (4.002). Tightened to 3, then to 2, on 2026-08-31 per successive live visual
// reviews: at default zoom the pill still read as floating away from the head
// at both earlier values. Nothing else about the label changed — this constant
// is the ONLY place the gap lives, so
// every overhead element that anchors through greetingAnchor (StatusLabel's
// name/status pill and TalkingBubble in all three of its variants: typing dots,
// sent chat text, and the greeting bubble) moves together. Per-component or
// per-employee offsets are deliberately not a thing here.
export const HEAD_LABEL_GAP_FRAME_UNITS = 2;

/**
 * Where a character's floating label/bubble anchors.
 *
 * Horizontally: always the layer's centre.
 *
 * Vertically: `layer.y` (the layer's TOP EDGE) is only a proxy for "just above
 * the head", and it silently breaks as soon as a layer carries headroom the
 * character does not fill. Micah's and Angelo's layers had to grow taller so
 * their raised-arm clips stop cropping, and that invisible headroom pushed
 * their labels visibly further from their heads (bon 4.00, alex 2.94, micah
 * 4.69, angelo 5.49 frame units — all different).
 *
 * So a live-3D character anchors from its OWN measured head instead. Because
 * the canonical size policy centres the character in its canvas and scales it
 * as 1/layerHeight, the head's distance below the canvas top is exactly
 * `layerHeight / 2 - headTopAboveCenter`, where `headTopAboveCenter` is a
 * per-character measured constant (see live3dCharacters.ts). That expression is
 * INDEPENDENT of the layer box it is rendered in, so the same character gets
 * the same gap as self (own manifest layer) and as a roster peer (drawn in
 * bon's seat box) — and any future employee just measures the one constant.
 *
 * Characters with no live-3D entry (NPCs, saved avatars, sprite-only people)
 * keep the original top-edge behaviour untouched.
 */
export function greetingAnchor(
  layer: Pick<AssetLayer, "x" | "y" | "width" | "height">,
  headTopAboveCenter?: number,
): { leftPct: number; topPct: number } {
  const headTopY =
    headTopAboveCenter === undefined
      ? layer.y
      : layer.y + layer.height / 2 - headTopAboveCenter - HEAD_LABEL_GAP_FRAME_UNITS;
  return {
    leftPct: ((layer.x + layer.width / 2) / FRAME_WIDTH) * 100,
    topPct: (headTopY / FRAME_HEIGHT) * 100,
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

/** Where a character is ACTUALLY drawn right now, for panning to them.
 *
 * A roster layer's own x/y is that person's ASSIGNED SEAT, which is not where they are rendered
 * whenever something has since moved them: the Atlas-offline sidewalk lineup repositions them
 * (applyOfflineLineupPositions -> positionedPeerLayers), and a walk in flight or just finished
 * moves them again (peerWalkState, top-left coords). Panning at the seat sends the viewer to an
 * empty desk while the avatar they clicked stands elsewhere.
 *
 * This is deliberately the SAME lookup chain the render path and resolveMemberCenter already use
 * — positioned layers first, then the manifest cast, with live walk position winning over both —
 * so Search cannot drift from what is on screen. It introduces no coordinates of its own.
 */
/** World-centre of a layer — the point every "walk to this person" interaction aims at. Pair it
 *  with resolveRenderedLayer so the aim point is the DRAWN position, never the assigned seat. */
export function layerCenter(
  layer: Pick<AssetLayer, "x" | "y" | "width" | "height">,
): { x: number; y: number } {
  return { x: layer.x + layer.width / 2, y: layer.y + layer.height / 2 };
}

export function resolveRenderedLayer(
  layer: AssetLayer,
  chain: readonly (readonly AssetLayer[])[],
  livePosById: Readonly<Record<string, { pos: { x: number; y: number } }>>,
): AssetLayer {
  const id = layer.id.toLowerCase();
  let resolved = layer;
  for (const candidates of chain) {
    const hit = candidates.find((l) => l.id.toLowerCase() === id);
    if (hit) {
      resolved = hit;
      break;
    }
  }
  const live = livePosById[id];
  return live ? { ...resolved, x: live.pos.x, y: live.pos.y } : resolved;
}

/**
 * A character's on-screen CENTRE for the wrapper's current pan/zoom — the anchor point the
 * world interaction menu hangs off. Pure, so OfficeMap can call it both when the menu opens and
 * on every render while it is open (the wrapper's onTransform re-renders OfficeMap on each zoom
 * and pan), which is what keeps the card attached to the character instead of to the screen
 * position it had when clicked. `layer` should be the DRAWN layer (resolveRenderedLayer).
 */
export function characterScreenCenter(
  layer: Pick<AssetLayer, "x" | "y" | "width" | "height">,
  state: { positionX: number; positionY: number; scale: number },
  wrapperRect: { left: number; top: number },
): { clientX: number; clientY: number } {
  return {
    clientX: wrapperRect.left + state.positionX + (layer.x + layer.width / 2) * state.scale,
    clientY: wrapperRect.top + state.positionY + (layer.y + layer.height / 2) * state.scale,
  };
}
