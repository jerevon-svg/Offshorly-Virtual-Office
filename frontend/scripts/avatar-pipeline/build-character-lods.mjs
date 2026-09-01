#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Phase 0.3/0.4 — build-character-lods.mjs
//
// Takes one character's base rigged GLB + N single-clip animation GLBs (all
// sharing the SAME skeleton/node names — same rig_task_id from Meshy) and
// produces 3 LOD-tier GLBs, each containing:
//   - the full mesh + skeleton (simplified per-tier, skin-aware)
//   - ALL named AnimationClips retargeted onto that one skeleton, so a
//     future THREE.AnimationMixer.crossFadeTo can blend between them without
//     ever swapping models.
//
// Why manual retargeting instead of gltf-transform's mergeDocuments/join:
// mergeDocuments would import every source's mesh+skin+animation as a
// SEPARATE parallel skeleton (names collide but node identity doesn't) —
// this project's 6 clip GLBs really are 6 independent exports of the same
// rig, not one file with 6 clips. Since every source's node NAMES are
// confirmed identical to the base rig's (26/26 match, verified by hand
// before writing this script), we instead: for each source animation
// channel, find the base document's node with the same name, copy over
// just that channel's input/output accessors (via gltf-transform's
// copyToDocument, which also pulls in the underlying buffer data), and
// build a new AnimationChannel/Sampler pointing at the base skeleton.
//
// Usage:
//   node scripts/avatar-pipeline/build-character-lods.mjs jerevon
//   node scripts/avatar-pipeline/build-character-lods.mjs bon --out-dir=<dir>
//
// --base-color=<png> (added 2026-08-29): swap in a recovered base-colour atlas
// (same UV layout as the rig) before padding/encoding — see flag comment below.
//
// --out-dir (added 2026-08-28): write the 3 LOD GLBs to <dir> (absolute, or
// relative to the frontend root) instead of the default public/avatars/<id>/.
// Used to stage a candidate for review under the gitignored
// scripts/avatar-pipeline/output/... tree without touching shipped assets.
//
// Quality pass (2026-08-29): atlas gap padding (atlas-dilate.mjs) + the
// 2048/1024/512 near-lossless-WebP texture policy + LOD2 10-bit UVs, all
// defined in lod-policy.mjs. Old LODs were backed up under
// output/quality-pass-backup/ before being replaced.
//
// Walking source (2026-08-28): the rig step now saves the free bundled walk
// as <id>-rigged-walking.glb; older employee folders (jerevon, bonv2) have
// <id>-basic-walking_glb_url.glb. The first that exists is used, so both
// generations of folders keep building unchanged.
// ---------------------------------------------------------------------------

import { NodeIO } from "@gltf-transform/core";
import {
  ALL_EXTENSIONS,
  EXTTextureWebP,
} from "@gltf-transform/extensions";
import {
  weld,
  simplify,
  draco,
  dedup,
  prune,
  copyToDocument,
  cloneDocument,
  unpartition,
} from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import draco3d from "draco3dgltf";
import sharp from "sharp";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { padAtlasImage, rasterizeUvCoverage } from "./atlas-dilate.mjs";
import { ATLAS_FILL_REMAINDER, ATLAS_PAD_RADIUS, PROFILES, REQUIRED_CLIP_NAMES, TEXTURE_ENCODING } from "./lod-policy.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

const character = process.argv[2];
if (!character || character.startsWith("--")) {
  console.error("Usage: node build-character-lods.mjs <character-id> [--out-dir=<dir>]");
  process.exit(1);
}
const outDirFlag = (process.argv.slice(3).find((a) => a.startsWith("--out-dir=")) || "").slice("--out-dir=".length);
// --base-color=<png> (quality pass 2026-08-29): replace the rig's baked
// base-colour atlas with a recovered texture on the SAME UV layout (e.g. the
// raw->remesh closest-point transfer) before padding/encoding. The PNG must
// match the atlas layout of <character>-rigged.glb; geometry/UVs are untouched.
const baseColorFlag = (process.argv.slice(3).find((a) => a.startsWith("--base-color=")) || "").slice("--base-color=".length);
// --profile=<default|hq|source> (added 2026-08-30): which tier set from
// lod-policy.mjs to build. `hq` is the quality-first policy used for the
// near/self/zoomed-in tier; `source` is the unsimplified, un-Draco'd,
// lossless diagnostic baseline. Defaults to the original size-first tiers.
const profileFlag = (process.argv.slice(3).find((a) => a.startsWith("--profile=")) || "").slice("--profile=".length) || "default";
const LOD_TIERS = PROFILES[profileFlag];
if (!LOD_TIERS) {
  console.error(`Unknown --profile="${profileFlag}" (known: ${Object.keys(PROFILES).join(", ")})`);
  process.exit(1);
}
// --clip-source=<clipName>=<file> (added 2026-08-30): build one of the six
// required clips from a DIFFERENT source GLB in the same RAW_DIR, leaving the
// original per-clip export on disk untouched. Repeatable. Used to ship a
// corrected clip (e.g. bon-v3's idle-9 hand-flare fix, see
// <id>-idle-9-handfix-v1.json) without overwriting the raw Meshy download.
// The override must still carry the same skeleton/node names as the base rig —
// retargetAnimation() throws if it doesn't.
const clipSourceOverrides = new Map(
  process.argv.slice(3)
    .filter((a) => a.startsWith("--clip-source="))
    .map((a) => {
      const spec = a.slice("--clip-source=".length);
      const eq = spec.indexOf("=");
      if (eq < 1) throw new Error(`bad --clip-source (expected <clipName>=<file>): ${a}`);
      return [spec.slice(0, eq), spec.slice(eq + 1)];
    }),
);

const RAW_DIR = path.join(
  REPO_ROOT,
  "scripts/avatar-pipeline/output/meshy-employees",
  character,
);
const OUT_DIR = outDirFlag
  ? path.resolve(REPO_ROOT, outDirFlag)
  : path.join(REPO_ROOT, "public/avatars", character);

// Base rigged mesh (no meaningful animation — a placeholder single-frame
// "clip0" clip is present in the raw export and is dropped below).
const BASE_GLB = path.join(RAW_DIR, `${character}-rigged.glb`);

// Source clip GLB -> target AnimationClip name the app looks up by (see
// task spec — CharacterCanvas/live3dCharacters will key off these exact
// strings in a later phase).
const WALKING_CANDIDATES = [
  `${character}-rigged-walking.glb`, // current rig-step naming (preferred)
  `${character}-basic-walking_glb_url.glb`, // legacy naming (jerevon, bonv2)
];
const walkingSource =
  WALKING_CANDIDATES.find((f) => fs.existsSync(path.join(RAW_DIR, f))) ?? WALKING_CANDIDATES[0];

const DEFAULT_CLIP_SOURCES = {
  [`${character}-idle-9.glb`]: "idle-9",
  [walkingSource]: "walking",
  [`${character}-agree-gesture.glb`]: "agree-gesture",
  [`${character}-listening-gesture.glb`]: "listening-gesture",
  [`${character}-sit-on-chair-arms.glb`]: "sit-on-chair-arms",
  [`${character}-sitting-answering.glb`]: "sitting-answering",
};
// Apply any --clip-source overrides, preserving the clip ORDER (the
// REQUIRED_CLIP_NAMES check below depends on it).
const CLIP_SOURCES = {};
for (const [file, clipName] of Object.entries(DEFAULT_CLIP_SOURCES)) {
  CLIP_SOURCES[clipSourceOverrides.get(clipName) ?? file] = clipName;
}
for (const clipName of clipSourceOverrides.keys()) {
  if (!REQUIRED_CLIP_NAMES.includes(clipName)) {
    throw new Error(`--clip-source names "${clipName}", which is not one of the required clips: ${REQUIRED_CLIP_NAMES.join(", ")}`);
  }
}
if (Object.values(CLIP_SOURCES).join() !== REQUIRED_CLIP_NAMES.join()) {
  throw new Error("CLIP_SOURCES drifted from lod-policy REQUIRED_CLIP_NAMES");
}

// NOTE on triangleTarget vs actual output — READ BEFORE CHANGING:
// This source mesh's UV atlas splits nearly every chart boundary (face/
// hair/glasses/body/clothes) into duplicate-position vertices, which
// meshoptimizer's simplifier (via @gltf-transform/functions `simplify`,
// v4.4.2) auto-locks as seams REGARDLESS of the `lockBorder`/`error`/
// `ratio` options — confirmed empirically: ratio swept 0.083 -> 0.0013 and
// error swept 0.02 -> 10 all converged on the same ~53.4-53.6k triangle
// floor. This version of the toolchain has no attribute-tolerant
// simplification path (weld() here is bitwise-only, no fuzzy tolerance;
// `simplifyWithAttributes` isn't exposed by @gltf-transform/functions
// v4.4.2) to relax that seam-lock. Going below ~53k triangles on this mesh
// would require a UV-atlas remesh/re-bake pass (e.g. Blender decimate +
// re-bake fewer UV islands) — out of scope for this tooling pass, flagged
// as a follow-up exactly like the KTX2 gap below. `triangleTarget` here is
// therefore aspirational/spec-driven, not currently achievable in full for
// lod1/lod2 — actual per-tier triangle counts are reported by this script
// and will land near that same ~53k floor for all 3 tiers today. Real
// per-tier differentiation in THIS pass comes from textureSize (resolution)
// and dracoQuant (geometry quantization bit depth) below, both of which are
// genuine, meaningful size/bandwidth reductions even without a triangle
// count difference.
// LOD_TIERS (triangle targets, texture sizes, Draco quantization) and the
// texture encoding now live in lod-policy.mjs so they can be unit-tested —
// see that module's header for the 2026-08-29 quality-pass rationale.

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    "draco3d.decoder": await draco3d.createDecoderModule(),
    "draco3d.encoder": await draco3d.createEncoderModule(),
  });

function findNodeByName(doc, name) {
  return doc
    .getRoot()
    .listNodes()
    .find((n) => n.getName() === name);
}

// Copies every AnimationChannel of `sourceAnim` (which lives in
// `sourceDoc`) onto `targetDoc`'s matching-by-name skeleton nodes, as a
// brand-new Animation named `targetName`. Returns the new Animation.
function retargetAnimation(targetDoc, sourceDoc, sourceAnim, targetName) {
  const anim = targetDoc.createAnimation(targetName);
  for (const channel of sourceAnim.listChannels()) {
    const srcNode = channel.getTargetNode();
    if (!srcNode) continue;
    const targetPath = channel.getTargetPath();
    const dstNode = findNodeByName(targetDoc, srcNode.getName());
    if (!dstNode) {
      throw new Error(
        `retargetAnimation(${targetName}): no node named "${srcNode.getName()}" in base document`,
      );
    }
    const sampler = channel.getSampler();
    if (!sampler) continue;
    const input = sampler.getInput();
    const output = sampler.getOutput();
    if (!input || !output) continue;

    // copyToDocument pulls each accessor + its underlying buffer/bufferView
    // into targetDoc, without touching sourceDoc.
    const copyMap = copyToDocument(targetDoc, sourceDoc, [input, output]);
    const newInput = copyMap.get(input);
    const newOutput = copyMap.get(output);

    const newSampler = targetDoc
      .createAnimationSampler()
      .setInput(newInput)
      .setOutput(newOutput)
      .setInterpolation(sampler.getInterpolation());

    const newChannel = targetDoc
      .createAnimationChannel()
      .setTargetNode(dstNode)
      .setTargetPath(targetPath)
      .setSampler(newSampler);

    anim.addSampler(newSampler);
    anim.addChannel(newChannel);
  }
  return anim;
}

async function buildConsolidatedDocument() {
  console.log(`[build-character-lods] reading base rig: ${BASE_GLB}`);
  const baseDoc = await io.read(BASE_GLB);
  if (baseColorFlag) {
    const pngPath = path.resolve(REPO_ROOT, baseColorFlag);
    if (!fs.existsSync(pngPath)) throw new Error(`--base-color file not found: ${pngPath}`);
    const png = await sharp(fs.readFileSync(pngPath)).removeAlpha().png({ compressionLevel: 6 }).toBuffer();
    const meta = await sharp(png).metadata();
    for (const mat of baseDoc.getRoot().listMaterials()) {
      const tex = mat.getBaseColorTexture();
      if (!tex) continue;
      const [w, h] = tex.getSize() || [];
      if (w !== meta.width || h !== meta.height) throw new Error(`--base-color ${meta.width}x${meta.height} does not match atlas ${w}x${h}`);
      tex.setImage(png).setMimeType("image/png").setName("recovered_basecolor");
    }
    console.log(`[build-character-lods] base colour replaced with ${path.relative(REPO_ROOT, pngPath)} (${meta.width}x${meta.height})`);
  }

  // Drop the placeholder single-frame "clip0" animation baked into the raw
  // rigged export — it carries no real pose data and would otherwise show
  // up as a 7th (nonsense) clip name in the consolidated output.
  for (const anim of baseDoc.getRoot().listAnimations()) {
    anim.dispose();
  }

  for (const [file, clipName] of Object.entries(CLIP_SOURCES)) {
    const srcPath = path.join(RAW_DIR, file);
    if (!fs.existsSync(srcPath)) {
      throw new Error(`missing expected clip source: ${srcPath}`);
    }
    console.log(`[build-character-lods] retargeting ${file} -> "${clipName}"`);
    const srcDoc = await io.read(srcPath);
    const anims = srcDoc.getRoot().listAnimations();
    if (anims.length !== 1) {
      throw new Error(
        `${file}: expected exactly 1 animation clip, found ${anims.length}`,
      );
    }
    retargetAnimation(baseDoc, srcDoc, anims[0], clipName);
  }

  // Each retargeted animation's copyToDocument() call above created a new
  // Buffer in baseDoc (one per source GLB the accessors were copied from),
  // leaving 7 buffers total. GLB containers require exactly 0-1 buffers —
  // collapse them all back into one before this document is cloned/written.
  await baseDoc.transform(unpartition());

  await padAtlasTextures(baseDoc);

  const finalClipNames = baseDoc.getRoot().listAnimations().map((a) => a.getName());
  console.log(`[build-character-lods] consolidated clip names: ${finalClipNames.join(", ")}`);
  const expected = Object.values(CLIP_SOURCES);
  const missing = expected.filter((n) => !finalClipNames.includes(n));
  if (missing.length > 0) {
    throw new Error(`consolidated document missing expected clips: ${missing.join(", ")}`);
  }

  return baseDoc;
}

// Quality pass 2026-08-29: fills the opaque-black gaps between UV charts in
// every base-color texture with the nearest chart colour BEFORE any resize/
// encode, so mipmaps, bilinear/anisotropic taps and the WebP encoder can no
// longer pull black into chart edges (the "scratches" along every seam in the
// old LODs). The gap mask is rasterized from the primitives' own TEXCOORD_0
// (the atlases are fully opaque, so alpha cannot identify gaps — see
// atlas-dilate.mjs). Chart texels are never modified.
async function padAtlasTextures(doc) {
  const root = doc.getRoot();
  for (const texture of root.listTextures()) {
    const size = texture.getSize();
    if (!size) throw new Error(`texture "${texture.getName()}" has no decodable size`);
    const [width, height] = size;
    // Union of the UV coverage of every primitive whose material samples this texture.
    const mask = new Uint8Array(width * height);
    let triangles = 0;
    for (const mesh of root.listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const mat = prim.getMaterial();
        const usesTexture = mat && [mat.getBaseColorTexture(), mat.getEmissiveTexture()].includes(texture);
        if (!usesTexture) continue;
        const uv = prim.getAttribute("TEXCOORD_0");
        if (!uv) continue;
        const indices = prim.getIndices();
        const cov = rasterizeUvCoverage(uv.getArray(), indices ? indices.getArray() : null, width, height, { margin: 1 });
        for (let i = 0; i < mask.length; i++) if (cov.mask[i]) mask[i] = 1;
        triangles += cov.triangles;
      }
    }
    if (triangles === 0) {
      console.log(`[build-character-lods] texture "${texture.getName()}": no primitive samples it, skipping padding`);
      continue;
    }
    const padded = await padAtlasImage(sharp, Buffer.from(texture.getImage()), { radius: ATLAS_PAD_RADIUS, fillRemainder: ATLAS_FILL_REMAINDER, coverage: mask });
    texture.setImage(padded.png).setMimeType("image/png");
    console.log(
      `[build-character-lods] padded atlas "${texture.getName()}" ${width}x${height}: chart texels=${padded.opaque} filled=${padded.filled} still-gap(beyond ${ATLAS_PAD_RADIUS}px)=${padded.remainingTransparent} (${triangles} tris)`,
    );
  }
}

async function buildLodTier(consolidatedDoc, tier, baseTriangleCount) {
  console.log(`\n[build-character-lods] --- building ${tier.name} ---`);
  const doc = cloneDocument(consolidatedDoc);

  const simplifierReady = MeshoptSimplifier.ready ?? Promise.resolve();
  await simplifierReady;

  // ratio drives the actual triangle-count target (this task's spec is
  // triangle-budget-first); error is a generous ceiling so simplification
  // doesn't stop early on tight-error mode (meshoptimizer simplifier stops
  // if it hits ratio OR error first — a tiny default error like 0.0001
  // would block us from reaching lod2's ~1.3%-of-original target).
  // triangleTarget null => keep the rigged geometry untouched (HQ/source
  // near tier). Welding alone is still skipped so the mesh stays byte-faithful
  // to the rigged export.
  if (tier.triangleTarget !== null) {
    const ratio = Math.min(1, tier.triangleTarget / baseTriangleCount);
    // weld first (skin-aware) so simplify has clean shared vertices to work
    // with; lockBorder keeps skinned silhouette seams stable and preserves
    // joint/weight validity as required by the task spec.
    await doc.transform(
      weld({ tolerance: 0.0001 }),
      simplify({
        simplifier: MeshoptSimplifier,
        ratio,
        error: tier.simplifyError,
        lockBorder: true,
      }),
    );
  } else {
    console.log(`[build-character-lods] ${tier.name}: simplification SKIPPED (full rigged geometry)`);
  }

  // Resize + re-encode textures. No toktx/basisu binary present on this
  // machine (checked via `which toktx`/`which basisu` — both absent), so
  // KTX2/Basis compression is skipped for now. Quality pass 2026-08-29:
  // JPEG q90 -> near-lossless WebP (EXT_texture_webp, read natively by
  // GLTFLoader) — see lod-policy.mjs for the measured edge-error rationale.
  // Encoded directly with sharp rather than gltf-transform's textureCompress:
  // libwebp's near-lossless mode is a preprocessor of LOSSLESS encoding, and
  // textureCompress forwards `nearLossless` without `lossless`, which silently
  // produces a plain lossy q60 file (measured: 453KB instead of ~2.4MB, edge
  // error ~50/255 instead of <=2/255).
  await encodeTextures(doc, tier.textureSize, tier.lossless === true);

  await doc.transform(dedup(), prune());

  // Draco geometry compression, applied last. Actual encode/decode modules
  // are supplied to the shared `io` instance's registerDependencies() call
  // above; this transform just marks the document (with per-tier
  // quantization bit depths) to use KHR_draco_mesh_compression at write
  // time.
  if (tier.dracoQuant) {
    await doc.transform(draco(tier.dracoQuant));
  } else {
    console.log(`[build-character-lods] ${tier.name}: Draco SKIPPED (uncompressed float attributes)`);
  }

  return doc;
}

// Resizes every texture to `size` (Lanczos3) and encodes it per
// TEXTURE_ENCODING (near-lossless WebP), registering EXT_texture_webp as a
// required extension on the document.
async function encodeTextures(doc, size, lossless = false) {
  const textures = doc.getRoot().listTextures();
  if (textures.length === 0) return;
  if (lossless) {
    // Diagnostic/source tier: keep PNG so no encoder can be blamed for a seam.
    for (const texture of textures) {
      const encoded = await sharp(Buffer.from(texture.getImage()))
        .resize(size, size, { kernel: "lanczos3", fit: "fill" })
        .png({ compressionLevel: 9 })
        .toBuffer();
      texture.setImage(encoded).setMimeType("image/png").setURI("");
    }
    return;
  }
  const webp = doc.createExtension(EXTTextureWebP).setRequired(true);
  for (const texture of textures) {
    const encoded = await sharp(Buffer.from(texture.getImage()))
      .resize(size, size, { kernel: "lanczos3", fit: "fill" })
      .webp({
        nearLossless: TEXTURE_ENCODING.nearLossless,
        lossless: TEXTURE_ENCODING.lossless,
        quality: TEXTURE_ENCODING.quality,
        effort: TEXTURE_ENCODING.effort,
      })
      .toBuffer();
    texture.setImage(encoded).setMimeType("image/webp").setURI("");
  }
  void webp;
}

async function reportTriangleCount(doc) {
  let triangles = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      if (indices) {
        triangles += indices.getCount() / 3;
      } else {
        const pos = prim.getAttribute("POSITION");
        if (pos) triangles += pos.getCount() / 3;
      }
    }
  }
  return Math.round(triangles);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`[build-character-lods] output dir: ${OUT_DIR}`);
  console.log(`[build-character-lods] walking source: ${walkingSource}`);

  const consolidatedDoc = await buildConsolidatedDocument();
  const baseTriangleCount = await reportTriangleCount(consolidatedDoc);
  console.log(`[build-character-lods] base (pre-simplify) triangle count: ${baseTriangleCount}`);

  const results = [];
  for (const tier of LOD_TIERS) {
    const doc = await buildLodTier(consolidatedDoc, tier, baseTriangleCount);
    const outPath = path.join(OUT_DIR, `${character}-${tier.name}.glb`);
    const bytes = await io.writeBinary(doc);
    fs.writeFileSync(outPath, bytes);
    const triangles = await reportTriangleCount(doc);
    const clipNames = doc.getRoot().listAnimations().map((a) => a.getName());
    const textures = doc.getRoot().listTextures().map((t) => `${t.getMimeType()} ${(t.getSize() || []).join("x")} ${(t.getImage().byteLength / 1024).toFixed(0)}KB`);
    results.push({
      tier: tier.name,
      outPath,
      sizeBytes: bytes.byteLength,
      triangles,
      clipNames,
      textures,
    });
  }

  console.log("\n[build-character-lods] === SUMMARY ===");
  for (const r of results) {
    console.log(
      `${r.tier}: ${path.relative(REPO_ROOT, r.outPath)} — ${(r.sizeBytes / 1024 / 1024).toFixed(2)}MB, ${r.triangles} triangles, textures: [${r.textures.join("; ")}], clips: [${r.clipNames.join(", ")}]`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
