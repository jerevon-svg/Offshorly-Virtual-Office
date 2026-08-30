// DPR-aware render-size policy for CharacterCanvas (quality pass 2026-08-29).
//
// Each live-3D character renders offscreen at a FIXED base size
// (live3dCharacters.ts renderWidth/renderHeight, e.g. 210x298) and is then
// CSS-scaled into a map layer that is only ~37 frame units tall — roughly
// 37 CSS px at cover zoom, ~185 CSS px at max zoom (5x), doubled on a 2x
// display. A fixed 298 px render is therefore either heavily downscaled
// (wasted work) or, at max zoom on Retina, upscaled (soft). This policy picks
// a render scale from the canvas's actual on-screen size × devicePixelRatio,
// snapped to a few buckets so the shared WebGL surface is only re-sized when
// the zoom bucket changes — never every frame — and capped at an effective
// DPR of 2 so a 3x phone/laptop display can't triple the fill cost.
//
// Pure + tiny so it is unit-testable without a DOM; CharacterCanvas passes
// getBoundingClientRect().height (which already includes the map's CSS
// transform zoom) and window.devicePixelRatio.

export const MAX_EFFECTIVE_DPR = 2;

// Ascending. 1 == today's fixed base size; the camera/framing calibration
// (CONFIG.camera in CharacterCanvas) is expressed in base units and is
// scale-invariant because width and height scale together.
export const RENDER_SCALE_BUCKETS: readonly number[] = [0.5, 0.75, 1, 1.5, 2];

/** The highest approved bucket — used by the spatial-conversation quality
 *  override, which renders participants at maximum internal resolution
 *  WITHOUT changing their visible CSS size or the camera. */
export const MAX_RENDER_SCALE = RENDER_SCALE_BUCKETS[RENDER_SCALE_BUCKETS.length - 1];

export function resolveRenderScale(cssHeightPx: number, baseHeightPx: number, devicePixelRatio: number): number {
  if (!(cssHeightPx > 0) || !(baseHeightPx > 0)) return 1; // not laid out yet (or jsdom) -> base size
  const dpr = Math.min(Math.max(devicePixelRatio || 1, 1), MAX_EFFECTIVE_DPR);
  const wanted = (cssHeightPx * dpr) / baseHeightPx;
  for (const bucket of RENDER_SCALE_BUCKETS) if (bucket >= wanted) return bucket;
  return RENDER_SCALE_BUCKETS[RENDER_SCALE_BUCKETS.length - 1];
}

export function scaledRenderSize(baseWidth: number, baseHeight: number, scale: number): { width: number; height: number } {
  return { width: Math.max(1, Math.round(baseWidth * scale)), height: Math.max(1, Math.round(baseHeight * scale)) };
}
