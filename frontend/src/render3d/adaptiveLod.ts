// ---------------------------------------------------------------------------
// Adaptive LOD selection (2026-08-30).
//
// Which LOD an ALREADY-ELIGIBLE live-3D character uses. This never decides
// whether a character may be 3D at all — that stays with OfficeStage's
// device-tier / crowd-budget gating. It only picks the quality tier, so the
// near/self/zoomed-in character gets the crack-free HQ mesh while distant
// employees stay cheap.
//
// Units: everything here is in office-FRAME units (the same coordinate space
// as layer.x/layer.y and the seat tables). `zoom` is the map scale expressed
// as a MULTIPLE OF COVER SCALE (TransformWrapper's scale / initialScale), so
// 1 is the default view and 5 is the maximum — the thresholds below are then
// independent of viewport size and display density. Seat pitch in the manifest is 48 frame units, so one
// "tile" = 48 and every radius below is expressed as a tile count rather than
// an unexplained pixel constant.
// ---------------------------------------------------------------------------

export type LodTier = "lod0" | "lod1" | "lod2";

/** Manifest seat pitch — the natural distance unit of the office floor. */
export const TILE = 48;

// Enter thresholds, and the wider exit thresholds that give hysteresis. A
// character must get clearly closer/more zoomed to gain a tier, and clearly
// further/less zoomed to lose it, so a viewer hovering exactly on a boundary
// does not oscillate.
export const THRESHOLDS = {
  // zoom at/above which anything visible is worth the HQ mesh. At cover
  // scale a character is only ~30-50 CSS px tall; 2x cover roughly doubles
  // that, which is where the HQ mesh starts to actually resolve.
  zoomHqEnter: 2.0,
  zoomHqExit: 1.7,
  // Zoom-out demotion. Deliberately BELOW cover scale (1.0): the map's own
  // minScale IS cover, so at the default view nothing is demoted by zoom and
  // distance alone decides. Only an embedded/smaller-than-cover context can
  // trigger this, and even then only for medium/distant peers.
  zoomFarEnter: 0.9,
  zoomFarExit: 1.05,
  // near radius (tiles). A visible peer inside this earns the HQ mesh
  // unconditionally — zoom never overrides it (see the precedence list).
  nearEnterTiles: 2,
  nearExitTiles: 3,
  // radius (tiles) beyond which a character is "far"
  farEnterTiles: 8,
  farExitTiles: 6,
} as const;

/** Minimum ms a tier must hold before another switch is allowed. */
export const MIN_TIER_HOLD_MS = 400;

// On-screen size at which a character deserves the maximum internal render
// bucket, expressed in cover multiples like every other zoom threshold.
//
// Spatial Chat frames a pair at PAIR_SCALE_CAP (4.2x cover) and pins render
// scale 2 there. Manually zooming to a comparable size must look the same, but
// could not: resolveRenderScale derives its bucket from the canvas's CSS
// height against the base render height, and even at the map's maximum zoom
// (5x cover) that only reaches bucket 1.5 — the top bucket was reachable ONLY
// through the Spatial Chat pin. These thresholds close that gap; the exit is
// lower than the entry so zooming around a boundary cannot thrash.
export const HD_QUALITY_ZOOM_ENTER = 3.5;
export const HD_QUALITY_ZOOM_EXIT = 3.0;

/**
 * Whether a character should render at the maximum internal resolution
 * bucket. Mirrors resolveLodTier's precedence: attention first, then
 * visibility, then on-screen size. Never promotes anything offscreen, and
 * never depends on Spatial Chat membership alone.
 */
export function shouldUseMaxQuality(input: LodInputs, current: boolean): boolean {
  const { isSelf, isFocused, zoom, isOnScreen = true } = input;
  // Spatial participants (and a focused character) keep the pin they already
  // had, regardless of zoom.
  if (isFocused) return true;
  if (!isOnScreen) return false;
  if (typeof zoom !== "number" || !Number.isFinite(zoom)) return false;
  const threshold = current ? HD_QUALITY_ZOOM_EXIT : HD_QUALITY_ZOOM_ENTER;
  // self gets it at the same on-screen size as anyone else — it is a
  // resolution decision, not an identity one
  void isSelf;
  return zoom >= threshold;
}

export type LodInputs = {
  isSelf: boolean;
  /** Focused/selected in a spatial conversation. */
  isFocused: boolean;
  /**
   * Map zoom scale (TransformWrapper). Optional: where the zoom is not
   * observable, proximity plus self/focus decide on their own and no
   * zoom-based promotion or demotion is applied.
   */
  zoom?: number;
  /** Distance from the viewer's own character, in frame units. */
  distance: number;
  /**
   * Whether the character's layer intersects the visible viewport. Offscreen
   * characters are never promoted, so zooming in does not pull the HQ mesh
   * for the whole office. Defaults to true when unknown.
   */
  isOnScreen?: boolean;
};

/**
 * Pure tier choice with hysteresis. `current` is the tier already in use
 * (null on first resolve) and widens the thresholds in the character's favour
 * so a boundary hover cannot flip-flop.
 */
export function resolveLodTier(input: LodInputs, current: LodTier | null): LodTier {
  const { isSelf, isFocused, zoom, distance, isOnScreen = true } = input;
  const T = THRESHOLDS;
  const tiles = distance / TILE;
  const holdingHq = current === "lod0";
  const holdingFar = current === "lod2";
  const hasZoom = typeof zoom === "number" && Number.isFinite(zoom);

  // PRECEDENCE — strictly ordered, highest visual importance first. Each step
  // returns, so a later rule can never override an earlier one. This ordering
  // is the fix for the regression where wiring up the real map zoom let the
  // default cover view (zoom === 1.0) demote even a nearby, clearly visible
  // peer to the visibly cracked LOD2.

  // 1. Identity / attention. Self, a focused character and every active
  //    Spatial Chat participant are what the user is actually looking at, so
  //    they always get the HQ mesh. Nothing below can downgrade them — not
  //    zoom, not distance, not being scrolled offscreen.
  if (isSelf || isFocused) return "lod0";

  // 2. Offscreen. Never worth the HQ mesh, however far the user zooms in.
  if (!isOnScreen) return "lod2";

  // 3. Near distance. A VISIBLE peer standing within the near radius is
  //    promoted regardless of zoom — at the default view they are the
  //    characters a user is walking up to and talking to.
  const nearTiles = holdingHq ? T.nearExitTiles : T.nearEnterTiles;
  if (tiles <= nearTiles) return "lod0";

  // 4. Zoom-in promotion. Deliberately zooming in earns HQ at any distance.
  if (hasZoom && zoom >= (holdingHq ? T.zoomHqExit : T.zoomHqEnter)) return "lod0";

  // 5. Far distance -> cheapest tier.
  if (tiles >= (holdingFar ? T.farExitTiles : T.farEnterTiles)) return "lod2";

  // 6. Zoom-out demotion. Only reachable for MEDIUM-distance peers, since
  //    self/focus/spatial and near-distance all returned above.
  if (hasZoom && zoom <= (holdingFar ? T.zoomFarExit : T.zoomFarEnter)) return "lod2";

  // 7. A visible peer at medium distance: LOD1 is the floor at the default
  //    cover view. Never the cracked LOD2 just because the map is not zoomed.
  return "lod1";
}

/**
 * Debounce wrapper: keeps `current` until MIN_TIER_HOLD_MS has elapsed since
 * the last switch, so rapid zooming or a character walking along a boundary
 * cannot thrash the loader. Upgrading toward the viewer is never delayed when
 * there is no current tier yet (first resolve must be immediate).
 */
export function applyTierDebounce(
  next: LodTier,
  current: LodTier | null,
  lastSwitchAtMs: number,
  nowMs: number,
): LodTier {
  if (current === null) return next;
  if (next === current) return current;
  if (nowMs - lastSwitchAtMs < MIN_TIER_HOLD_MS) return current;
  return next;
}

/** Whether a layer's box intersects the visible frame-space rectangle. */
export function isLayerOnScreen(
  layer: { x: number; y: number; width: number; height: number },
  view: { x: number; y: number; width: number; height: number } | null | undefined,
): boolean {
  if (!view) return true;   // unknown viewport -> never cull
  return (
    layer.x < view.x + view.width &&
    layer.x + layer.width > view.x &&
    layer.y < view.y + view.height &&
    layer.y + layer.height > view.y
  );
}

/** Distance in frame units between two layer positions (top-left coords). */
export function frameDistance(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  const ax = a.x + a.width / 2, ay = a.y + a.height / 2;
  const bx = b.x + b.width / 2, by = b.y + b.height / 2;
  return Math.hypot(ax - bx, ay - by);
}
