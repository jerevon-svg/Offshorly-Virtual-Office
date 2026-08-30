// ---------------------------------------------------------------------------
// Canonical character size policy (2026-08-30).
//
// Every employee must occupy the SAME visible standing height at the same
// floor position and zoom, regardless of how their T-pose reference was drawn.
//
// Why the old framing did not do this: CharacterCanvas solved the orthographic
// `top` from the padded bone box, taking max(halfHeight, halfWidth/aspect).
// For a T-pose bind skeleton the ARM SPAN usually wins that max, so the zoom
// was driven by how wide a character's arms are rather than how tall they
// stand. Measured result: bon rendered 31.0 frame units tall, alex 28.1 —
// alex was 9.4% short, and any future character would land somewhere else
// again.
//
// The rule here normalizes on STANDING HEIGHT instead:
//
//   visibleHeight = projectedFractionOfCanvas x layerHeight   (frame units)
//
// so to make every character equal we solve the fraction each one needs:
//
//   fraction = CANONICAL_STANDING_FRAME_UNITS / layerHeight
//
// and then pick the camera `top` that yields exactly that fraction. Because
// the projected size of an orthographic camera is proportional to 1/top, that
// is a single division — no per-character constants, no measured fudge.
//
// Character proportions are untouched: this only changes the zoom, so a
// big-headed character still has a big head, they just stand the same height.
// ---------------------------------------------------------------------------

// Bon v3's manually approved on-screen standing height is 31.0 office-frame
// units (his layer is 37.2 tall and he fills 83.1% of it). Every other
// employee is matched to that; it is a product decision, not a per-character
// tweak.
//
// The number below is expressed in the units of the PROXY the runtime can
// afford to measure: the camera-space Y extent of the standing box
// (Box3.setFromObject — see computeStandingBox's warning about the Armature's
// 0.01 scale). Under the 35deg-elevated camera that box's corners project
// ~16% taller than the true silhouette, consistently for every character
// (measured 1.1636 / 1.1645 / 1.1559 on the real bon-v3, bon-v3-hq and
// alex-v2-hq GLBs), because Meshy normalizes every rig to the same 1.70-unit
// height. Bon's approved visible height is 28.5 frame units, so the
// proxy-space constant is 28.5 x 1.16.
export const CANONICAL_STANDING_FRAME_UNITS = 33.06;

// Ceiling on the canonical fraction, in the same proxy units (~0.92 of the
// canvas in true silhouette terms), so raised-gesture clips keep headroom.
// Measured tallest clip/heading after the correction: bon 88.7%, alex 95.5%
// of canvas — both inside the frame, no edge clipping.
export const MAX_STANDING_CANVAS_FRACTION = 1.02;

/**
 * The fraction of its own canvas height a character's STANDING silhouette
 * should occupy so that every employee ends up the same visible height.
 * `layerHeight` is the character's office-manifest layer height (frame units)
 * — the thing that actually sets its CSS footprint on the map.
 */
export function canonicalStandingFraction(layerHeight: number): number {
  if (!(layerHeight > 0)) return 0.8887; // no layer info -> bon's approved framing
  return Math.min(MAX_STANDING_CANVAS_FRACTION, CANONICAL_STANDING_FRAME_UNITS / layerHeight);
}

/**
 * Rescales an already-solved orthographic half-height so the character's
 * standing silhouette lands on the canonical fraction.
 *
 * `solvedTop` is the zoom the existing framing produced and
 * `standingFractionAtSolvedTop` is the fraction of the canvas the standing
 * silhouette occupies at that zoom. Orthographic projected size is
 * proportional to 1/top, so the correction is exact and heading-independent
 * (both inputs are measured with the heading rotation removed).
 */
export function canonicalTop(
  solvedTop: number,
  standingFractionAtSolvedTop: number,
  layerHeight: number,
): number {
  if (!(solvedTop > 0) || !(standingFractionAtSolvedTop > 0)) return solvedTop;
  const wanted = canonicalStandingFraction(layerHeight);
  return solvedTop * (standingFractionAtSolvedTop / wanted);
}
