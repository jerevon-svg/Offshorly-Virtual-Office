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
// been approved) is a single new entry here — no other code changes. That entry
// must state its `idleProfile` (see the type below): the pipeline generates a
// different Meshy idle for each profile, and nothing else records which one a
// shipped GLB actually holds.
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
/**
 * Which of Meshy's two standing idles this character's `idle-9` runtime clip
 * was built from — masculine = Idle_9 (action 249), feminine = Idle_12 (252).
 * The action ids and the per-clip arm correction each one needs live in the
 * pipeline's own authority, scripts/avatar-pipeline/lod-policy.mjs
 * (IDLE_PROFILES); this type only carries the DECLARATION.
 *
 * Every character was previously generated on Idle_12 regardless, because the
 * pipeline standard named that one clip unconditionally — so the whole cast
 * idled with the feminine hip-shifted sway and the only record of the choice
 * was prose in each entry's comment. Declaring it per character makes the pick
 * explicit and reviewable, and stops a new employee inheriting it by accident.
 */
export type IdleProfile = "masculine" | "feminine";

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
  // Distance, in office-frame units, from the vertical CENTRE of this
  // character's canvas up to the top of its STANDING head.
  //
  // Used by panMath.greetingAnchor to hang the status pill / talking bubble off
  // the real head instead of the layer's top edge. The canonical size policy
  // centres the character in its canvas and scales it as 1/layerHeight, so
  // `layerHeight / 2 - headTopAboveCenter` gives the head's distance below the
  // canvas top for ANY layer box — which is why the same value works whether
  // the character is drawn in its own manifest layer (as self) or in bon's
  // seat box (as a roster peer).
  //
  // MEASURED, not guessed: render the bind pose through the app's own camera
  // and take the highest mesh vertex in NDC, then headTopAboveCenter =
  // ndcHeadTop x layerHeight / 2. Same harness as widthCapacity.
  headTopAboveCenter?: number;
  // Which standing idle this set's `idle-9` clip actually holds. REQUIRED, not
  // optional: the point of the field is that a new character has to state it
  // rather than silently inherit whatever the last build used.
  idleProfile: IdleProfile;
};

// Fallback for a character whose widest pose has not been measured yet. Covers
// the widest measured character to date (alex, 1.502) with margin, so a new
// employee cannot ship visibly cropped before its own measurement lands.
// Every registered character now carries its own measured value, so this is
// only ever used by a not-yet-measured newcomer.
export const DEFAULT_WIDTH_CAPACITY = 1.65;

/** The horizontal painting capacity to use for an asset set. */
export function resolveWidthCapacity(entry: Live3dAssetSet): number {
  return Math.max(1, entry.widthCapacity ?? DEFAULT_WIDTH_CAPACITY);
}

const BASE = import.meta.env.BASE_URL;

// One entry per avatar id with an approved, shipped live-3D asset set.
// Four real employees through the pipeline so far: bon (Jerevon), alex, micah
// and angelo. NOTE: with more than one entry, OfficeStage's single-entry
// "size-gated relaxation" no longer applies — self is shown at
// LIVE_3D_SELF_MIN_TIER (T1+), peers go through LIVE_3D_CAP_BY_TIER (T1: 2,
// T2: 4), exactly as tierBudgets.ts documents. Growing from two entries to
// four changes WHICH characters are eligible, never the crowd budgets.
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
  //
  // Promoted again 2026-08-31 to the MASCULINE idle profile: same bon-v3-hq
  // geometry and textures, rebuilt with Meshy Idle_9 (action 249) in the
  // `idle-9` slot instead of Idle_12. Zero credits — his Idle_9 was already
  // generated and on disk from 2026-08-30.
  //
  // It ships the WHOLE-ARM-CHAIN correction (bon-v3-idle-9-armfix-v1.mjs ->
  // hands 14.2/17.4 outboard of hip, elbows 9.9/9.8), not the earlier
  // wrist-only handfix of the same clip. The handfix killed the fin read but
  // left his hands 20.4/27.2 — the widest and least symmetric idle in the cast
  // once alex and angelo were corrected to ~16-17. Both clips stay on disk;
  // rebuild with --clip-source=idle-9=bon-v3-idle-9-handfix-v1.glb to go back
  // to the wrist-only variant, or revert these three paths to bon-v3-hq/ to
  // drop the masculine profile entirely.
  bon: {
    glbUrl: `${BASE}avatars/bon-v3-hq-idle9/bon-v3-lod0.glb`,
    lod1GlbUrl: `${BASE}avatars/bon-v3-hq-idle9/bon-v3-lod1.glb`,
    lod2GlbUrl: `${BASE}avatars/bon-v3-hq-idle9/bon-v3-lod2.glb`,
    idleProfile: "masculine",
    renderWidth: 210,
    renderHeight: 298,
    // measured max|x| 1.216 (sitting-answering @45deg, consistent across
    // lod0/1/2) + 8% margin
    widthCapacity: 1.35,
    // measured ndc head 0.784838 @ layer height 37.2
    headTopAboveCenter: 14.598,
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
  // Promoted again 2026-08-31 to the MASCULINE idle profile: same alex-v2-hq
  // geometry and textures, rebuilt with Meshy Idle_9 (action 249, 3 credits) in
  // the `idle-9` slot. His Idle_9 flared too (hands 25.1/28.9 outboard of hip
  // against bon's approved 20.4/27.2), so it carries the standard whole-arm-
  // chain correction solved from ALEX'S OWN bind axes and his own approved
  // targets (alex-v2-idle-9-armfix-v1.mjs -> 16.7/17.0, elbows 9.8/9.9), i.e.
  // it lands in the same band his reviewed Idle_12 armfix did (19.8/20.2).
  // alex-v2-hq/ stays on disk as the rollback.
  alex: {
    glbUrl: `${BASE}avatars/alex-v2-hq-idle9/alex-v2-lod0.glb`,
    lod1GlbUrl: `${BASE}avatars/alex-v2-hq-idle9/alex-v2-lod1.glb`,
    lod2GlbUrl: `${BASE}avatars/alex-v2-hq-idle9/alex-v2-lod2.glb`,
    idleProfile: "masculine",
    renderWidth: 160,
    renderHeight: 276,
    // measured max|x| 1.502 (sitting-answering @45deg) + 8% margin
    widthCapacity: 1.65,
    // measured ndc head 0.829558 @ layer height 34.46
    headTopAboveCenter: 14.293,
  },
  // Manifest aspect ratio: width 24.36 / height 39.10.
  // Promoted 2026-08-31 to the micah-v5 set, built straight from the approved
  // T-pose master micah-tpose1.png (pose_mode "t-pose": image-to-3d 01a05658
  // -> remesh 01a0565b -> rig 01a0565e -> 5 clips -> build-character-lods
  // --profile=hq). The micah-v4 set stays on disk untouched at
  // public/avatars/micah-v4-hq/ as the rollback — revert these three paths to
  // roll back. Earlier rejected chains (micah/, micah-v2/, and the long-hair
  // v3 archived under output/meshy-employees/rejected/) are never referenced.
  //
  // Feminine idle profile (now declared as `idleProfile` below rather than left
  // to this comment): Meshy Idle_12 (action 252), embedded as the `idle-9`
  // runtime slot. It DID flare on v5 (hands 25.4/26.9 outboard of
  // hip, elbows 28/30 deg) so it carries the standard whole-arm-chain
  // correction solved from V5'S OWN bind axes
  // (micah-v5-idle-12-armfix-v1.mjs -> 16.3/17.3, elbows 11.0/14.1, matching
  // alex's corrected 10.9/13.6). Note v4 needed NO such correction — its
  // a-pose bind already hung the arms low — which is why the correction is
  // re-decided per chain rather than inherited.
  //
  // The rigged base carries a v5-DERIVED weight correction
  // (micah-v5-weightfix-v1.mjs): Meshy again left Arm/Shoulder influence on
  // her scalp/hair/glasses, worse than v4 (4.00% of body height dragged during
  // walking vs v4's 1.59%). The cut is solved from v5's own data (y=1.280) and
  // the feather band is 0.11 x body height, NOT v4's 0.15 — at 0.15 the ramp
  // only reached full strength at y=1.535, above the scalp itself, leaving
  // 1.12%. Result 0.14% (bon 0.28%, angelo 0.39%).
  //
  // Layer geometry is UNCHANGED from the v4 calibration: v5 already clears the
  // frame at 24.36 x 39.10 with 7.5% vertical margin (0 of 1152 clip/heading/
  // phase poses overshoot), so feet anchor, labels and hitbox all stay put.
  micah: {
    glbUrl: `${BASE}avatars/micah-v5-hq/micah-v5-lod0.glb`,
    lod1GlbUrl: `${BASE}avatars/micah-v5-hq/micah-v5-lod1.glb`,
    lod2GlbUrl: `${BASE}avatars/micah-v5-hq/micah-v5-lod2.glb`,
    // The one FEMININE idle in the cast, and the only entry the 2026-08-31
    // profile split left alone: she was already deliberately built on Idle_12,
    // so her assets are untouched — only the declaration is new.
    idleProfile: "feminine",
    renderWidth: 182,
    renderHeight: 292,
    // measured max|x| 1.288 (sitting-answering @225deg) + 8% margin
    widthCapacity: 1.4,
    // measured ndc head 0.740101 @ layer height 39.10
    headTopAboveCenter: 14.469,
  },
  // Manifest aspect ratio: width 28.18 / height 39.85. Registry key is
  // `angelo` (the office-assets-manifest / roster id that avatarIdForEmail
  // produces); only the ASSET FILES carry the pipeline's `gelo-v1` chain name.
  // Built 2026-08-30 from gelo-tpose.png, a genuine horizontal T-pose, so
  // pose_mode "t-pose" (image-to-3d 01a05325 -> remesh 01a05329 -> rig
  // 01a0532b -> 5 clips -> build-character-lods --profile=hq). Idle_12 DID
  // flare (hands 34.8/37.3 outboard of hip, worse than alex's pre-fix
  // 30.3/31.1) and carries the standard whole-arm-chain correction solved from
  // ANGELO'S OWN bind axes (gelo-v1-idle-12-armfix-v1.mjs -> 15.2/16.3),
  // embedded as `idle-9`.
  //
  // His manifest layer was authored as background stock art at 22.149 x 31.323
  // — far short of bon 37.2 / micah 36.526 / alex 34.46 — which pushed the
  // canonical rule's wanted fraction to 33.06/31.323 = 1.0555, ABOVE
  // characterSize.ts's MAX_STANDING_CANVAS_FRACTION ceiling of 1.02. He
  // therefore clamped and rendered ~3.4% short, with 4 of 6 clips overflowing
  // the frame top (agree-gesture peaked at 1.160, cutting his raised hand).
  // Recalibrated to 28.18 x 39.85: uniform (aspect 0.7071 preserved to 4dp, so
  // object-fit:cover never crops or stretches his sprite) and re-anchored so
  // his feet stay on the exact same world spot. The fraction is now 0.8296,
  // clear of the ceiling, so he stands the canonical 33.06 frame units —
  // matching bon/alex/micah — and his tallest pose peaks at 0.945.
  // The shared rendering policy is unchanged; only this one undersized layer
  // was corrected.
  // Promoted 2026-08-31 to the MASCULINE idle profile: same gelo-v1-hq geometry
  // and textures, rebuilt with Meshy Idle_9 (action 249, 3 credits) in the
  // `idle-9` slot. His Idle_9 flared hardest of the three (hands 32.4/37.6
  // outboard of hip) and carries the standard whole-arm-chain correction solved
  // from ANGELO'S OWN bind axes and his own approved targets
  // (gelo-v1-idle-9-armfix-v1.mjs -> 15.8/15.9, elbows 8.5/8.5, matching his
  // reviewed Idle_12 armfix at 15.2/16.3). gelo-v1-hq/ stays on disk as the
  // rollback.
  angelo: {
    glbUrl: `${BASE}avatars/gelo-v1-hq-idle9/gelo-v1-lod0.glb`,
    lod1GlbUrl: `${BASE}avatars/gelo-v1-hq-idle9/gelo-v1-lod1.glb`,
    lod2GlbUrl: `${BASE}avatars/gelo-v1-hq-idle9/gelo-v1-lod2.glb`,
    idleProfile: "masculine",
    renderWidth: 177,
    renderHeight: 251,
    // measured max|x| 1.121 (sitting-answering @225deg) + 8% margin, re-measured
    // after his manifest layer was recalibrated to 28.18 x 39.85 (see below)
    widthCapacity: 1.22,
    // measured ndc head 0.724536 @ layer height 39.85
    headTopAboveCenter: 14.437,
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
