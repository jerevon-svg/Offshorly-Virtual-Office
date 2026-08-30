// ---------------------------------------------------------------------------
// lod-policy.mjs — the per-tier LOD policy consumed by build-character-lods.mjs,
// kept in its own import-side-effect-free module so it can be unit-tested
// (build-character-lods.mjs runs its pipeline on import).
//
// Quality pass 2026-08-29 (see the quality diagnosis of the same day):
//   - texture sizes raised 1024/512/256 -> 2048/1024/512: the old sizes lost
//     face/eye/glasses detail once the app started rendering at DPR-aware
//     sizes (up to ~600 device px tall at max zoom on a Retina display);
//   - encoding switched JPEG q90 -> WebP near-lossless: on the padded atlases
//     JPEG q90 / lossy WebP produced edge errors up to ~50/255 (ringing halos
//     along every hard chart/glasses/hair edge) while near-lossless WebP
//     (quality 60) stays within 2/255 at ~2x the JPEG size. GLTFLoader reads
//     EXT_texture_webp natively; glbCache.ts needs no change;
//   - LOD2 TEXCOORD quantization 8 -> 10 bits: 8 bits is a full texel of UV
//     error at 256/512 px, visible as seam wobble on the static-frame tier;
//   - atlas padding (atlas-dilate.mjs) runs before any resize/encode so the
//     opaque-black inter-chart gaps can no longer bleed into chart edges.
// Triangle targets/simplify settings are unchanged (geometry is sufficient).
// ---------------------------------------------------------------------------

// The six AnimationClip names every consolidated character GLB must carry
// (CharacterCanvas resolves states by these exact strings — see
// characterAnimationState.ts's CHARACTER_ANIM_STATES).
export const REQUIRED_CLIP_NAMES = [
  "idle-9",
  "walking",
  "agree-gesture",
  "listening-gesture",
  "sit-on-chair-arms",
  "sitting-answering",
];

// Texel radius for atlas gap padding (atlas-dilate.mjs). 16 texels at the
// 2048 source resolution = 4 texels at LOD2's 512, which is more than the
// 2-texel footprint a trilinear/anisotropic tap can straddle at any mip the
// app will actually sample.
export const ATLAS_PAD_RADIUS = 16;
// ...and beyond that band the flood continues until every gap texel holds a
// chart colour, so nothing in the atlas is left black-by-omission.
export const ATLAS_FILL_REMAINDER = true;

// Texture encoding shared by every tier (see header), passed straight to
// sharp's .webp(). libwebp's near-lossless mode is a preprocessor of its
// LOSSLESS coder, so `lossless` must be on as well; `quality` then sets the
// near-lossless level (60 = light smoothing of noise only, edges kept within
// 2/255 on the measured atlases). `effort` is sharp's 0-6 CPU effort.
export const TEXTURE_ENCODING = {
  targetFormat: "webp",
  lossless: true,
  nearLossless: true,
  quality: 60,
  effort: 6,
};

export const LOD_TIERS = [
  {
    name: "lod0",
    triangleTarget: 25_000,
    textureSize: 2048,
    simplifyError: 0.1,
    dracoQuant: { quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 },
  },
  {
    name: "lod1",
    triangleTarget: 12_500,
    textureSize: 1024,
    simplifyError: 0.2,
    dracoQuant: { quantizePosition: 12, quantizeNormal: 8, quantizeTexcoord: 10 },
  },
  {
    name: "lod2",
    triangleTarget: 4_000,
    textureSize: 512,
    simplifyError: 0.5,
    dracoQuant: { quantizePosition: 10, quantizeNormal: 8, quantizeTexcoord: 10 },
  },
];
