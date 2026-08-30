// ---------------------------------------------------------------------------
// Spatial-conversation focus camera (2026-08-30).
//
// HQ LOD0 is already selected for conversation participants, but at cover zoom
// a character is only ~30-50 CSS px tall, so none of that detail can resolve.
// Entering a spatial conversation therefore moves the CAMERA: pan to the
// participant cluster and zoom to the closest scale that still fits everyone,
// which is what makes participants look like the manually approved max-zoom
// view. Nothing about the model or the CSS footprint changes.
//
// Pure math only — the effect that calls TransformWrapper lives in OfficeMap.
// ---------------------------------------------------------------------------

export type FocusBox = { x: number; y: number; width: number; height: number };
export type FocusTransform = { x: number; y: number; scale: number };

/** Padding around the cluster, in frame units, leaving room for name labels
 *  above each character and chat/typing indicators beside them. */
export const CLUSTER_PADDING = { top: 34, bottom: 14, side: 26 } as const;

/** A two-person conversation gets a deliberately closer, more conversational
 *  view than a crowd; both are still capped by `maxScale`. */
export const PAIR_SCALE_CAP = 4.2;
export const GROUP_SCALE_CAP = 3.2;

/** Union of every participant's layer box. Returns null for an empty cluster. */
export function clusterBounds(boxes: FocusBox[]): FocusBox | null {
  if (boxes.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * The transform that centres `cluster` in a `viewportW x viewportH` wrapper at
 * the closest scale which still fits the whole padded cluster.
 *
 * `minScale`/`maxScale` are the map's own existing limits, so this can never
 * ask for a zoom the user could not reach manually.
 */
export function computeClusterFocus(
  cluster: FocusBox,
  participantCount: number,
  viewportW: number,
  viewportH: number,
  minScale: number,
  maxScale: number,
): FocusTransform {
  const padded = {
    x: cluster.x - CLUSTER_PADDING.side,
    y: cluster.y - CLUSTER_PADDING.top,
    width: cluster.width + CLUSTER_PADDING.side * 2,
    height: cluster.height + CLUSTER_PADDING.top + CLUSTER_PADDING.bottom,
  };
  // largest scale at which the padded cluster still fits both axes
  const fit = Math.min(viewportW / padded.width, viewportH / padded.height);
  const intent = participantCount <= 2 ? PAIR_SCALE_CAP : GROUP_SCALE_CAP;
  const scale = Math.max(minScale, Math.min(fit, maxScale, minScale * intent));
  const cx = padded.x + padded.width / 2;
  const cy = padded.y + padded.height / 2;
  return {
    x: viewportW / 2 - cx * scale,
    y: viewportH / 2 - cy * scale,
    scale,
  };
}

/**
 * Whether the focus transition should run. It fires on entering a session and
 * when the participant set MATERIALLY changes (someone joins or leaves) — never
 * on every render, so a user who pans or zooms mid-conversation is not fought.
 */
export function shouldRefocus(
  prev: { sessionId: string; members: string[] } | null,
  next: { sessionId: string; members: string[] } | null,
): boolean {
  if (!next) return false;
  if (!prev) return true;
  if (prev.sessionId !== next.sessionId) return true;
  if (prev.members.length !== next.members.length) return true;
  const a = [...prev.members].sort();
  const b = [...next.members].sort();
  return a.some((m, i) => m !== b[i]);
}

/**
 * Reads the live map transform off a react-zoom-pan-pinch ref.
 *
 * ReactZoomPanPinchRef is `ReactZoomPanPinchContextState & handlers`, i.e. the
 * scale/positionX/positionY live on the ref ITSELF as `.state`. The inner
 * `.instance` (a ZoomPanPinch) has NO `transformState` property — reading it
 * yields undefined and dereferencing it throws. Because the spatial-focus
 * effect captures the pre-conversation transform exactly when a session first
 * becomes active, that throw fired from inside a useEffect the moment a second
 * participant opened the chat, taking BOTH clients to the error boundary.
 */
export function readMapTransform(
  ref: { state?: { scale: number; positionX: number; positionY: number } } | null | undefined,
): FocusTransform | null {
  const st = ref?.state;
  if (!st || typeof st.scale !== "number") return null;
  return { x: st.positionX, y: st.positionY, scale: st.scale };
}
