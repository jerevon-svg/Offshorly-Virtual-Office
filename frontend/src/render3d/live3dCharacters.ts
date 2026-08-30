// Live-3D character registry: which avatar ids have an APPROVED, shipped
// consolidated GLB (single mesh/skeleton + all 6 named animation clips,
// see build-character-lods.mjs) eligible to replace the 2D sprite in
// production, subject to the viewer's device tier / crowd budget (see
// OfficeStage.tsx's gating logic and services/render/tierBudgets.ts).
//
// Presence of an entry here means "this character CAN be shown live-3D if
// the viewer's device permits it" — it is the eligibility half of the
// gating decision, not the permission half. This is deliberately separate
// from OfficeStage's dev-only `?live3d=` override map, which exists purely
// to preview NOT-yet-eligible characters (e.g. Alex) without shipping them.
//
// All GLB paths are BASE_URL-relative and live under `public/avatars/` —
// Vite only copies `public/` into a production build (unlike the rest of
// the project root, which `vite dev` happens to also serve, silently
// masking this requirement in dev). Every path here MUST resolve under
// `public/` or it will 404 in a real `vite build`.
//
// Adding employee #2 (once they've gone through the same Meshy pipeline and
// been approved) is a single new entry here — no other code changes.
//
// Phase A: each character now ships exactly ONE consolidated GLB (built by
// build-character-lods.mjs's animation-retargeting pass) containing every
// one of CharacterCanvas's 6 animation-state clips (see
// characterAnimationState.ts's CHARACTER_ANIM_STATES) baked onto a single
// shared skeleton — CharacterCanvas loads it once and drives a single
// AnimationMixer, crossfading between clips as the resolved state changes.
// This replaces the earlier per-pose-GLB shape (walkingGlbUrl/idleGlbUrl/
// shrugGlbUrl/thinkingGlbUrl), which required hard-swapping between up to 4
// independently-loaded models.
export type Live3dAssetSet = {
  // LOD0 — full-detail GLB, used for T2 (strong desktop) viewers.
  glbUrl: string;
  // LOD1 — reduced-detail GLB, used for T1 (including microbench-rescued
  // weak-static devices, see deviceTier.ts's MICROBENCH_T1_RESCUE_MS)
  // viewers. Falls back to glbUrl (LOD0) when a character has no dedicated
  // LOD1 asset yet, so adding a new character without LOD1/LOD2 art doesn't
  // break rendering — it just means every tier gets the same (LOD0) detail
  // until the cheaper LODs are produced.
  lod1GlbUrl?: string;
  // LOD2 — cheapest GLB, used for the confirmed-too-weak-but-has-WebGL
  // static-frame case (software renderer, or a weak-static device that
  // failed/never ran its microbench rescue — see OfficeStage.tsx). Falls
  // back to lod1GlbUrl, then glbUrl, when absent.
  lod2GlbUrl?: string;
  // Fixed offscreen render resolution, matched to this character's
  // office-assets-manifest aspect ratio for a crisp result regardless of
  // the wrapper div's current on-screen (percentage/zoom-scaled) size.
  renderWidth: number;
  renderHeight: number;
  // Horizontal painting capacity, as a multiple of renderWidth.
  //
  // renderWidth/renderHeight match the character's manifest layer aspect, which
  // was sized for their 2D sprite. Wide animated poses (measured worst case:
  // `sitting-answering` at 45deg-family headings) reach past that box and were
  // being cropped at the canvas edge. This widens the offscreen BUFFER and the
  // canvas's painted area together, so the orthographic camera simply sees more
  // world horizontally — the model is never scaled or stretched, standing
  // height and the vertical anchor are untouched, and the character stays
  // horizontally centred.
  //
  // MEASURED, not guessed: render every clip x 8 headings x 7 phases through
  // the app's own camera and take max|x| in NDC (1.0 = the current frame edge),
  // then add ~8% margin. See CHARACTER_PIPELINE_STANDARD.md. Omitted =
  // DEFAULT_WIDTH_CAPACITY.
  widthCapacity?: number;
};

// Fallback for a character whose widest pose has not been measured yet. Covers
// the widest measured character to date (alex, 1.502) with margin, so a new
// employee cannot ship visibly cropped before its own measurement lands.
export const DEFAULT_WIDTH_CAPACITY = 1.65;

/** The horizontal painting capacity to use for an asset set. */
export function resolveWidthCapacity(entry: Live3dAssetSet): number {
  return Math.max(1, entry.widthCapacity ?? DEFAULT_WIDTH_CAPACITY);
}

const BASE = import.meta.env.BASE_URL;

// One entry per avatar id with an approved, shipped live-3D asset set.
// Two real employees through the pipeline so far: bon (Jerevon) and alex.
// NOTE: with two entries, OfficeStage's single-entry "size-gated relaxation"
// no longer applies — self is shown at LIVE_3D_SELF_MIN_TIER (T1+), peers go
// through LIVE_3D_CAP_BY_TIER (T1: 2, T2: 4), exactly as tierBudgets.ts documents.
export const LIVE_3D_CHARACTERS: Record<string, Live3dAssetSet> = {
  // Manifest aspect ratio: width 26.23 / height 37.2.
  // Promoted 2026-08-30 to the bon-v3 set, built straight from the approved
  // T-pose master bon-tpose.png (Meshy pipeline, pose_mode "t-pose":
  // image-to-3d 01a05185 -> remesh 01a05188 -> rig 01a0518b -> 6 clips ->
  // build-character-lods). BOTH earlier sets stay on disk untouched as
  // rollbacks — public/avatars/bon-v2/bon-v2-lod{0,1,2}.glb (2026-08-28) and
  // public/avatars/jerevon/jerevon-lod{0,1,2}.glb (the original): revert these
  // three paths to roll back to either. `?live3d=bon-v2` (OfficeStage's dev
  // override) still points at the bon-v2 files and is kept as a preview aid.
  //
  // Promoted again 2026-08-30 to the quality-first `bon-v3-hq` set. The
  // size-first LOD0 simplified 280k -> 40k, which collapsed vertices across UV
  // chart boundaries and left 6.1% of triangles sampling unrelated parts of
  // the atlas (visible as speckles in hair/clothing). HQ LOD0 keeps the full
  // rigged mesh (0.06%, identical to the rigged source). bon-v3/ stays on disk
  // as the rollback.
  bon: {
    glbUrl: `${BASE}avatars/bon-v3-hq/bon-v3-lod0.glb`,
    lod1GlbUrl: `${BASE}avatars/bon-v3-hq/bon-v3-lod1.glb`,
    lod2GlbUrl: `${BASE}avatars/bon-v3-hq/bon-v3-lod2.glb`,
    renderWidth: 210,
    renderHeight: 298,
    // measured max|x| 1.216 (sitting-answering @45deg, consistent across
    // lod0/1/2) + 8% margin
    widthCapacity: 1.35,
  },
  // Manifest aspect ratio: width 20 / height 34.46.
  // Promoted 2026-08-30 to the alex-v2 set, built from the approved T-pose
  // master alex-tpose.png on the same locked pipeline as bon-v3 (pose_mode
  // "t-pose": image-to-3d 01a051ea -> remesh 01a051ed -> rig 01a051f0 -> 6
  // clips -> build-character-lods, with Idle_12 arm-chain-corrected and
  // embedded as the `idle-9` runtime slot). The original set stays on disk
  // untouched at public/avatars/alex/alex-lod{0,1,2}.glb as the rollback:
  // revert these three paths to roll back. Promoted again 2026-08-30 to the
  // quality-first `alex-v2-hq` set (same crack diagnosis as bon: 6.8% ->
  // 0.06% chart-spanning triangles); alex-v2/ stays on disk as the rollback.
  alex: {
    glbUrl: `${BASE}avatars/alex-v2-hq/alex-v2-lod0.glb`,
    lod1GlbUrl: `${BASE}avatars/alex-v2-hq/alex-v2-lod1.glb`,
    lod2GlbUrl: `${BASE}avatars/alex-v2-hq/alex-v2-lod2.glb`,
    renderWidth: 160,
    renderHeight: 276,
    // measured max|x| 1.502 (sitting-answering @45deg) + 8% margin
    widthCapacity: 1.65,
  },
};

export function isLive3dEligible(avatarId: string | null | undefined): boolean {
  return !!avatarId && avatarId in LIVE_3D_CHARACTERS;
}

/**
 * Picks the right per-LOD GLB url for a given asset set + resolved device
 * tier + "static frame" bucket (see deviceTier.ts's isMobileLike/
 * hasWorkingWebGl/isSoftwareRendererSignal doc comments and OfficeStage.tsx
 * for how the static-frame bucket is determined) — T2 -> LOD0, T1
 * (including microbench-rescued) -> LOD1, static-frame -> LOD2. Each LOD
 * falls back to the next-higher-detail asset when a character hasn't had
 * that LOD produced yet, so a character can ship with only glbUrl and still
 * render (at LOD0 detail) at every tier.
 */
/**
 * Adaptive-LOD variant: picks the asset for an explicitly-chosen quality tier
 * (see adaptiveLod.ts). Falls back down the chain exactly like the
 * device-tier resolver, so a character shipping only glbUrl still renders.
 * Kept separate from resolveLive3dGlbUrl so the device-tier ceiling and the
 * proximity/zoom choice stay independently testable.
 */
export function resolveLive3dGlbUrlForTier(
  entry: Live3dAssetSet,
  tier: "lod0" | "lod1" | "lod2",
): string {
  if (tier === "lod2") return entry.lod2GlbUrl ?? entry.lod1GlbUrl ?? entry.glbUrl;
  if (tier === "lod1") return entry.lod1GlbUrl ?? entry.glbUrl;
  return entry.glbUrl;
}

export function resolveLive3dGlbUrl(
  entry: Live3dAssetSet,
  tier: "T0" | "T1" | "T2",
  isStaticFrame: boolean,
): string {
  if (isStaticFrame) return entry.lod2GlbUrl ?? entry.lod1GlbUrl ?? entry.glbUrl;
  if (tier === "T1") return entry.lod1GlbUrl ?? entry.glbUrl;
  return entry.glbUrl;
}
