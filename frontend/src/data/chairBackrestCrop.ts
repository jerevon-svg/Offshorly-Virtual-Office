// Per-chair-style "backrest bottom fraction" table for the back-sit
// occlusion fix's synthetic crop layer (see OfficeStage.tsx's synthetic
// backrest-crop layer generation / depthSort.ts's sortKey doc comment).
//
// Value = fraction (0-1) of the CHAIR'S OWN RENDERED LAYER BOX (its manifest
// width/height, post-imgCrop but pre-overflow-clip — i.e. exactly what's
// visible on screen for that furniture layer today) that counts as
// "backrest/headrest" and should occlude a back-facing occupant. The
// synthetic crop layer clips away everything BELOW this fraction via
// `clip-path: inset(0 0 ${(1-fraction)*100}% 0)`, showing only the top
// portion.
//
// Keyed by manifest asset PATH (not furniture `id`) — several manifest
// furniture entries share one underlying chair-style asset (e.g. every
// dev-team visitor-chair instance points at the same dev-visitor-chair.png),
// and the visible-box aspect ratio driving a reasonable fraction is a
// property of the ASSET, not any one instance's placement. This also
// matches depthSort.ts's isSeat(), which already classifies on `path`.
//
// Only the chair/sofa/beanbag styles actually used by a seat that can be
// assigned "back" direction across the 4 manifest-linked rooms (dev-team,
// executive-team, ai-room, design-team — see roomSeats.ts/seatDirections.ts)
// matter here; every other seat style falls through to DEFAULT_BACKREST_
// FRACTION below rather than needing its own entry, so this table degrades
// gracefully instead of no-oping/crashing for an unlisted style.
//
// Starting fractions are a reasonable first-pass estimate from each asset's
// own visible width/height (manifest office-assets-manifest.json) — squarer
// boxes lean toward the higher end (more of the box is plausibly backrest),
// taller/narrower or sofa-like boxes lean lower. Bon has said he'll visually
// spot-check and adjust these afterward — precision here is not the goal.
export const CHAIR_BACKREST_FRACTION: Record<string, number> = {
  // ai-room: ai-visitor-chair-1/2 (visible box ~18x16.63, wider than tall).
  "assets/office/furniture/ai-team/ai-lead-chair.png": 0.45,
  // executive-team: ceo/cto-visitor-chair-1..4 (visible box ~19.8x22.9).
  "assets/office/furniture/executive-team/exec-visitor-chair.png": 0.4,
  // executive-team: bottom-center-sofa (visible box ~27.6x29.4, squarish
  // loveseat — sofas give proportionally less of their box to backrest).
  "assets/office/furniture/executive-team/bottom-center-sofa.png": 0.35,
  // dev-team: every dev-lead*-visitor*/dev-bay*-chair5..8 instance (visible
  // box ~17.7x20.1).
  "assets/office/furniture/dev-team/dev-visitor-chair.png": 0.4,
  // design-team: design-chair-3/design-member-chair-4/5 (visible box
  // ~18.5x20.8).
  "assets/office/furniture/design-team/design-member-chair-b.png": 0.4,
  // design-team: design-side-beanbag (visible box ~28.9x29.3, round — no
  // distinct backrest edge, kept on the lower end alongside the sofa).
  "assets/office/furniture/design-team/design-side-beanbag.png": 0.35,
};

// Fallback for any chair/sofa/beanbag style not explicitly listed above, so
// a future back-facing seat assignment on an unlisted style still gets a
// sensible crop instead of no occlusion at all.
export const DEFAULT_BACKREST_FRACTION = 0.4;

export function getBackrestCropFraction(path: string): number {
  return CHAIR_BACKREST_FRACTION[path] ?? DEFAULT_BACKREST_FRACTION;
}
