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
  // Manifest aspect ratio: width 28.18 / height 39.85 (the same headroom-
  // calibrated box angelo settled on, so raised-arm clips clear the frame top
  // with the canonical 33.06-unit standing height; fraction 0.8296, under the
  // 1.02 ceiling). Registry key is `jan` (roster/manifest id); only the ASSET
  // FILES carry the pipeline chain name `jan-v1`.
  // Built 2026-09-04 from jan-tpose.png, a genuine horizontal T-pose, so
  // pose_mode "t-pose" (image-to-3d 01a06a6e -> remesh 01a06a7c, 281,988 tris
  // -> rig 01a06a7e -> 5 clips -> build-character-lods --profile=hq).
  // MASCULINE idle profile from the start (Meshy Idle_9, action 249). His raw
  // Idle_9 flared (hands 21.9/25.3 outboard of hip, elbows 14.6/11.1) and
  // carries the standard whole-arm-chain correction solved from JAN'S OWN bind
  // axes (jan-v1-idle-9-armfix-v1.mjs -> 16.5/16.1, elbows 8.5/8.5), embedded
  // as `idle-9`.
  // Measured through jan-v1-measure.mjs at 177x251 / layer 39.85: worst
  // max|x| 0.9964 (sitting-answering @45deg) -> x1.08 margin = 1.0761;
  // HEAD_NDC 0.761911 -> 0.761911 x 39.85 / 2 = 15.181; every clip within
  // |ndc.x| <= 0.9964 and ndc.y <= 0.868, so no vertical clipping.
  jan: {
    glbUrl: `${BASE}avatars/jan-v1-hq-idle9/jan-v1-lod0.glb`,
    lod1GlbUrl: `${BASE}avatars/jan-v1-hq-idle9/jan-v1-lod1.glb`,
    lod2GlbUrl: `${BASE}avatars/jan-v1-hq-idle9/jan-v1-lod2.glb`,
    idleProfile: "masculine",
    renderWidth: 177,
    renderHeight: 251,
    // measured max|x| 0.9964 (sitting-answering @45deg) + 8% margin
    widthCapacity: 1.08,
    // measured ndc head 0.761911 @ layer height 39.85
    headTopAboveCenter: 15.181,
  },
  // france, jona and clang (built 2026-09-25) keep their EXISTING manifest
  // layer ids and boxes — they were already on the floor as stock-art layers —
  // except jona, whose 19 x 31.19 box sat under the 33.06-unit canonical
  // standing height and clipped raised-arm clips 7% above the frame top; it
  // was scaled uniformly (aspect kept, bottom-centre anchored) to 22.66 x 37.2,
  // bon's height. Render sizes follow each box's aspect at bon/alex's ~8 px
  // per frame unit. All three are FEMININE (Meshy Idle_12, action 252) with the
  // standard whole-arm-chain correction solved from their OWN bind axes
  // (<chain>-idle-12-armfix-v1.mjs), embedded as `idle-9`.
  //
  // Manifest aspect 21.819 / 38.559. Built from france-tpose.png, pose_mode
  // "t-pose" (image-to-3d 01a0d5ce -> remesh 01a0d5d0-535c -> rig 01a0d5d4-1170).
  // Idle hands 25.9/27.3 -> 16.0/16.2 outboard of hip, elbows 11.0/14.1.
  // Measured through france-v1-measure.mjs at 174x308 / layer 38.559: worst
  // max|x| 1.1920 (sit-on-chair-arms @270deg) x1.08 = 1.2874; HEAD_NDC 0.801897
  // -> 0.801897 x 38.559 / 2 = 15.460; no pose exceeds the frame top.
  france: {
    glbUrl: `${BASE}avatars/france-v1-hq/france-v1-lod0.glb`,
    lod1GlbUrl: `${BASE}avatars/france-v1-hq/france-v1-lod1.glb`,
    lod2GlbUrl: `${BASE}avatars/france-v1-hq/france-v1-lod2.glb`,
    idleProfile: "feminine",
    renderWidth: 174,
    renderHeight: 308,
    // measured max|x| 1.1920 (sit-on-chair-arms @270deg) + 8% margin
    widthCapacity: 1.29,
    // measured ndc head 0.801897 @ layer height 38.559
    headTopAboveCenter: 15.46,
  },
  // Manifest aspect 22.66 / 37.2 (recalibrated, see above). Chain `jona-v1-fix`:
  // Jona's approved, LOCKED jona-v1 t-pose mesh (image-to-3d 01a0d5ce-2d81 ->
  // remesh 01a0d5cf -> rig 01a0d5d4-116a) with a zero-credit local rig repair.
  // Meshy seated her LEFT shoulder/arm joints 2.4 units high in the hair (upper
  // arm 31deg droop, 10.8 long vs her right 13deg / 13.7), so the bundled walk
  // only half-lowered that arm. output/meshy-employees/_rig-repair.mjs
  // (mode mirror --hair) re-seated LeftShoulder/LeftArm as the mirror of the
  // right side with rebuilt inverse binds (rest pose unchanged, max deviation
  // 3e-5% of height), handed residual hair arm weights to Head (drift 0.51% ->
  // 0.05%), and transferred clips as world-rotation deltas from each skeleton's
  // own bind — jan-v1's walk/run/gestures/sits and micah-v5's Idle_12, then the
  // standard idle arm-chain correction from JONA'S OWN axes (hands 12.8/13.3,
  // elbows 11.0/14.0). The A-pose jona-v2 build (taller, smaller head — rejected
  // on proportions) was never committed; it is a local diagnostic reference only.
  // Measured at 182x298 / layer 37.2: worst max|x| 1.1995 (sitting-answering
  // @225deg) x1.08 = 1.2955; HEAD_NDC 0.776323 -> 14.440; no top overshoot.
  jona: {
    glbUrl: `${BASE}avatars/jona-v1-fix-hq/jona-v1-fix-lod0.glb`,
    lod1GlbUrl: `${BASE}avatars/jona-v1-fix-hq/jona-v1-fix-lod1.glb`,
    lod2GlbUrl: `${BASE}avatars/jona-v1-fix-hq/jona-v1-fix-lod2.glb`,
    idleProfile: "feminine",
    renderWidth: 182,
    renderHeight: 298,
    // measured max|x| 1.1995 (sitting-answering @225deg) + 8% margin
    widthCapacity: 1.3,
    // measured ndc head 0.776323 @ layer height 37.2
    headTopAboveCenter: 14.44,
  },
  // Manifest aspect 25.314 / 36.549. Registry key is the manifest id `clang`;
  // her production email clarisse@offshorly.com is joined to it by
  // avatarRegistry.ts's EMAIL_TO_AVATAR_ID (the localpart does not match).
  // Chain `clang-v1-geo-fix`: her clang-v1 t-pose mesh (image-to-3d 01a0d5ce-2de5
  // -> remesh 01a0d5d0-5438 -> rig 01a0d5d4-11a5), which keeps her face, hair,
  // flower, top, trousers, shoes and CROSSBODY BAG, with two zero-credit fixes:
  //  1. GEOMETRY (output/meshy-employees/_clang-legfix.mjs): unlike jona/nicole/
  //     kael, the v1 MESH had drifted — the trouser segment between cuff and hem
  //     was ~2.2x too long in head units (waist->floor 0.380 vs clang-tpose.png's
  //     0.262). Only that segment was compressed (k=0.274, smooth 0.025 ramps,
  //     shoes/cuff untouched, bag masked to move rigidly with the top), solved so
  //     the hem lands on the reference: head 0.565 / top 0.176 / waist->floor 0.259
  //     / hand line 0.420 / span 0.820 vs reference 0.557 / 0.181 / 0.262 / 0.426 /
  //     0.855 (skeleton-free front renders).
  //  2. RIG (_rig-repair.mjs clanggeo --hair --hair-cut=0.045 --hair-band=0.03,
  //     _clang-bagfix.mjs): every joint follows the same height map so it stays on
  //     its weight blend (hips 0.400 -> 0.283 of height), shoulders re-seated on the
  //     corrected arm line at the cast's 1.9% offset (Meshy had them in her hair),
  //     hair handed to Head (head drift 8.44% -> 0%), and the bag — bound 53% to the
  //     left thigh — handed to Hips so it hangs from the pelvis. Rest pose unchanged
  //     (3e-5% of height). Clips: jan-v1's walk/run/gestures/sits + micah-v5's
  //     Idle_12 as world-rotation deltas, then the idle arm-chain correction from
  //     HER OWN axes (hands 12.8/11.6, elbows 11.1/14.1). the A-pose clang-v2 build
  //     (bag lost, proportions also drifted) was never committed — diagnostic only.
  // Measured at 202x292 / layer 36.549: worst max|x| 1.0339 (sit-on-chair-arms
  // @270deg) x1.08 = 1.1166; HEAD_NDC 0.817775 -> 14.944; no top overshoot.
  clang: {
    glbUrl: `${BASE}avatars/clang-v1-geo-fix-hq/clang-v1-geo-fix-lod0.glb`,
    lod1GlbUrl: `${BASE}avatars/clang-v1-geo-fix-hq/clang-v1-geo-fix-lod1.glb`,
    lod2GlbUrl: `${BASE}avatars/clang-v1-geo-fix-hq/clang-v1-geo-fix-lod2.glb`,
    idleProfile: "feminine",
    renderWidth: 202,
    renderHeight: 292,
    // measured max|x| 1.0339 (sit-on-chair-arms @270deg) + 8% margin
    widthCapacity: 1.12,
    // measured ndc head 0.817775 @ layer height 36.549
    headTopAboveCenter: 14.944,
  },
  // Manifest aspect 23.337 / 37.2: nicole's stock-art box (20 x 31.88) sat under
  // the 33.06-unit canonical standing height, so it was scaled uniformly (aspect
  // kept, bottom-centre anchored) to bon's 37.2, exactly as jona's was.
  // Chain `nicole-v1-fix`: her approved, LOCKED nicole-v1 t-pose mesh (image-to-3d
  // 01a0d5ce-2dff -> remesh 01a0d5d0-31f2 -> rig 01a0d5d4-118a) with a zero-credit
  // local rig repair (output/meshy-employees/_rig-repair.mjs mirror --hair
  // --hair-cut=0.045 --hair-band=0.03). Meshy seated her LEFT shoulder/arm joint
  // 5.61% of height above her own T-pose arm line (approved cast 0.7-2.4%; her
  // right side 1.86%) and let the arm bones own her bob — LeftArm 16,424 verts
  // reaching 0.183 above the shoulder — so the bundled walk left her arms out
  // (hand drop 0.60/0.67x torso) and dragged her hair 3.74%. LeftShoulder/LeftArm
  // were re-seated as the mirror of her right side with rebuilt inverse binds
  // (rest pose unchanged, 2e-5% of height), hair above shoulder+0.045 was handed
  // to Head over a 0.03 feather (arm footprint now +0.056/+0.053, head drift 0%),
  // and clips were transferred as world-rotation deltas from each skeleton's own
  // bind: jan-v1's walk/run/gestures/sits and micah-v5's Idle_12, then the
  // standard idle arm-chain correction from NICOLE'S OWN axes (hands 14.1/14.6,
  // elbows 11.1/14.2). The A-pose nicole-v2/v3 chains (taller, smaller head —
  // rejected on proportions) stay on disk as diagnostic references only.
  // Measured at 187x298 / layer 37.2: worst max|x| 1.1779 (sitting-answering
  // @225deg) x1.08 = 1.2722; HEAD_NDC 0.746182 -> 13.879; no top overshoot.
  nicole: {
    glbUrl: `${BASE}avatars/nicole-v1-fix-hq/nicole-v1-fix-lod0.glb`,
    lod1GlbUrl: `${BASE}avatars/nicole-v1-fix-hq/nicole-v1-fix-lod1.glb`,
    lod2GlbUrl: `${BASE}avatars/nicole-v1-fix-hq/nicole-v1-fix-lod2.glb`,
    idleProfile: "feminine",
    renderWidth: 187,
    renderHeight: 298,
    // measured max|x| 1.1779 (sitting-answering @225deg) + 8% margin
    widthCapacity: 1.28,
    // measured ndc head 0.746182 @ layer height 37.2
    headTopAboveCenter: 13.879,
  },
  // Manifest aspect 23.023 / 37.2: kael's stock-art box (19 x 30.7) sat under
  // the 33.06-unit canonical standing height, so it was scaled uniformly (aspect
  // kept, bottom-centre anchored) to bon's 37.2, as jona's and nicole's were. His
  // layer's mirror transform is authored for the flat stock PNG; OfficeStage
  // applies layer transforms to sprites only, so the 3D body is never mirrored.
  // Chain `kael-v1-fix`: his approved, LOCKED kael-v1 t-pose mesh (image-to-3d
  // 01a0d5ce-2d95 -> remesh 01a0d5d0-0f94 -> rig 01a0d5d4-1141) with a zero-credit
  // local rig repair (output/meshy-employees/_rig-repair.mjs mode kael). The mesh
  // is upright, but Meshy bent his skeleton's upper body FORWARD out of it: head
  // +30%, neck +26%, shoulders +18% of hips->head ahead of the hips (approved cast
  // -6..+1%) while elbows/hands sat correctly, so the upper-arm bones pointed
  // 36-41deg backward and the bundled walk left both arms out (hand drop
  // 0.46/0.70x torso). Spine02/Spine01/Spine/neck/Head/shoulders/arms were moved
  // back onto the body line at jan-v1's depth offsets scaled to kael, keeping
  // every joint's world rotation, with rebuilt inverse binds (rest pose unchanged,
  // 4e-5% of height); his shoulder HEIGHTS were already in the cast's band and
  // were not touched, and his weights are Meshy's own. All clips transferred as
  // world-rotation deltas from each skeleton's own bind from jan-v1 (Idle_9 raw,
  // walk/run/gestures/sits), then the standard masculine idle arm-chain
  // correction from KAEL'S OWN axes (hands 16.4/18.0, elbows 8.5/8.5).
  // The A-pose kael-v2/v3 chains (same skeleton defect) are diagnostic only.
  // Measured at 184x298 / layer 37.2: worst max|x| 1.2434 (sitting-answering
  // @225deg) x1.08 = 1.3429; HEAD_NDC 0.745782 -> 13.872; no top overshoot.
  kael: {
    glbUrl: `${BASE}avatars/kael-v1-fix-hq-idle9/kael-v1-fix-lod0.glb`,
    lod1GlbUrl: `${BASE}avatars/kael-v1-fix-hq-idle9/kael-v1-fix-lod1.glb`,
    lod2GlbUrl: `${BASE}avatars/kael-v1-fix-hq-idle9/kael-v1-fix-lod2.glb`,
    idleProfile: "masculine",
    renderWidth: 184,
    renderHeight: 298,
    // measured max|x| 1.2434 (sitting-answering @225deg) + 8% margin
    widthCapacity: 1.35,
    // measured ndc head 0.745782 @ layer height 37.2
    headTopAboveCenter: 13.872,
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
