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
// ---------------------------------------------------------------------------

import { NodeIO } from "@gltf-transform/core";
import {
  ALL_EXTENSIONS,
} from "@gltf-transform/extensions";
import {
  weld,
  simplify,
  draco,
  textureCompress,
  dedup,
  prune,
  copyToDocument,
  cloneDocument,
  unpartition,
} from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import draco3d from "draco3dgltf";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

const character = process.argv[2];
if (!character) {
  console.error("Usage: node build-character-lods.mjs <character-id>");
  process.exit(1);
}

const RAW_DIR = path.join(
  REPO_ROOT,
  "scripts/avatar-pipeline/output/meshy-employees",
  character,
);
const OUT_DIR = path.join(REPO_ROOT, "public/avatars", character);

// Base rigged mesh (no meaningful animation — a placeholder single-frame
// "clip0" clip is present in the raw export and is dropped below).
const BASE_GLB = path.join(RAW_DIR, `${character}-rigged.glb`);

// Source clip GLB -> target AnimationClip name the app looks up by (see
// task spec — CharacterCanvas/live3dCharacters will key off these exact
// strings in a later phase).
const CLIP_SOURCES = {
  [`${character}-idle-9.glb`]: "idle-9",
  [`${character}-basic-walking_glb_url.glb`]: "walking",
  [`${character}-agree-gesture.glb`]: "agree-gesture",
  [`${character}-listening-gesture.glb`]: "listening-gesture",
  [`${character}-sit-on-chair-arms.glb`]: "sit-on-chair-arms",
  [`${character}-sitting-answering.glb`]: "sitting-answering",
};

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
const LOD_TIERS = [
  {
    name: "lod0",
    triangleTarget: 25_000,
    textureSize: 1024,
    simplifyError: 0.1,
    dracoQuant: { quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 },
  },
  {
    name: "lod1",
    triangleTarget: 12_500,
    textureSize: 512,
    simplifyError: 0.2,
    dracoQuant: { quantizePosition: 12, quantizeNormal: 8, quantizeTexcoord: 10 },
  },
  {
    name: "lod2",
    triangleTarget: 4_000,
    textureSize: 256,
    simplifyError: 0.5,
    dracoQuant: { quantizePosition: 10, quantizeNormal: 8, quantizeTexcoord: 8 },
  },
];

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

  const finalClipNames = baseDoc.getRoot().listAnimations().map((a) => a.getName());
  console.log(`[build-character-lods] consolidated clip names: ${finalClipNames.join(", ")}`);
  const expected = Object.values(CLIP_SOURCES);
  const missing = expected.filter((n) => !finalClipNames.includes(n));
  if (missing.length > 0) {
    throw new Error(`consolidated document missing expected clips: ${missing.join(", ")}`);
  }

  return baseDoc;
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

  // Resize + re-encode textures. No toktx/basisu binary present on this
  // machine (checked via `which toktx`/`which basisu` — both absent), so
  // KTX2/Basis compression is skipped for now; falls back to resized JPEG
  // (source material is fully OPAQUE, no alpha channel — jpeg is lossy but
  // needs no extra glTF extension for the loader to support, unlike webp's
  // EXT_texture_webp), which is still a big win over the raw 2048x2048
  // uncompressed-PNG source.
  await doc.transform(
    textureCompress({
      targetFormat: "jpeg",
      quality: 90,
      resize: [tier.textureSize, tier.textureSize],
    }),
  );

  await doc.transform(dedup(), prune());

  // Draco geometry compression, applied last. Actual encode/decode modules
  // are supplied to the shared `io` instance's registerDependencies() call
  // above; this transform just marks the document (with per-tier
  // quantization bit depths) to use KHR_draco_mesh_compression at write
  // time.
  await doc.transform(draco(tier.dracoQuant));

  return doc;
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
    results.push({
      tier: tier.name,
      outPath,
      sizeBytes: bytes.byteLength,
      triangles,
      clipNames,
    });
  }

  console.log("\n[build-character-lods] === SUMMARY ===");
  for (const r of results) {
    console.log(
      `${r.tier}: ${path.relative(REPO_ROOT, r.outPath)} — ${(r.sizeBytes / 1024 / 1024).toFixed(2)}MB, ${r.triangles} triangles, clips: [${r.clipNames.join(", ")}]`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
