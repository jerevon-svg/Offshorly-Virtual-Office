// Add the missing `running` clip to a character's ALREADY-SHIPPED LOD GLBs.
//
//   node scripts/avatar-pipeline/repack-running-clip.mjs <character> <shipped-dir> [--profile=hq] [--dry-run]
//
// WHY THIS EXISTS RATHER THAN A REBUILD. `running` became a required clip on
// 2026-09-13 (lod-policy.mjs REQUIRED_CLIP_NAMES); alex-v2, micah-v5, gelo-v1
// and jan-v1 were packaged before that, so their shipped GLBs carry six clips
// and the runtime silently falls back to a faster walk for all four of them
// (dev/vo3d/avatar/gait.ts). Their raw Meshy downloads ALREADY contain the run
// animation — `<id>-rigged-running.glb`, downloaded with the walk in the same
// free bundle at rig time — so nothing needs generating and no credit needs
// spending. The only thing missing is the packing step.
//
// A full `build-character-lods.mjs` re-run would also work, and is the right
// tool for a NEW character. For a character already in production it is the
// wrong risk: it re-simplifies geometry, re-encodes every texture and re-solves
// the idle arm correction, so it can only be trusted if the exact original
// flags are known — and the shipped folders record a profile and an idle
// profile in their NAME and nothing else. Re-running it with a guessed
// `--clip-source=idle-9=...` would quietly ship a different idle.
//
// So this does the one thing that is missing and provably nothing else:
//
//   * MESH, SKELETON, MATERIALS AND TEXTURES ARE NEVER TOUCHED. No simplify, no
//     encodeTextures, no atlas pad — the image buffers are carried through the
//     read/write round trip byte-for-byte. Appearance cannot change.
//   * THE CLIP IS THE REAL ONE. retargetAnimation is build-character-lods.mjs's
//     own function, copied here unchanged, and it binds by SKELETON NODE NAME —
//     it throws if the shipped rig and the raw run export disagree about a
//     single bone, which is the check that this is that character's own run and
//     not somebody else's. Nothing is synthesised and no walk is re-timed: a
//     character with no source run clip is REFUSED, not approximated.
//   * GEOMETRY IS RE-ENCODED AT THE TIER'S OWN DRACO BIT DEPTHS, read from
//     lod-policy's profile table, so a repacked LOD0 is quantized exactly as
//     the LOD0 beside it was.
//
// Idempotent: a GLB that already has `running` is reported and skipped.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { copyToDocument, draco, unpartition } from "@gltf-transform/functions";
import draco3d from "draco3dgltf";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { PROFILES } from "./lod-policy.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

const character = process.argv[2];
const shippedDirArg = process.argv[3];
if (!character || !shippedDirArg || shippedDirArg.startsWith("--")) {
  console.error("usage: node repack-running-clip.mjs <character> <shipped-dir> [--profile=hq] [--dry-run]");
  process.exit(1);
}
const flags = process.argv.slice(4);
const dryRun = flags.includes("--dry-run");
const profileFlag = (flags.find((a) => a.startsWith("--profile=")) || "").slice("--profile=".length) || "hq";
const LOD_TIERS = PROFILES[profileFlag];
if (!LOD_TIERS) {
  console.error(`Unknown --profile="${profileFlag}" (known: ${Object.keys(PROFILES).join(", ")})`);
  process.exit(1);
}

const SHIPPED_DIR = path.resolve(REPO_ROOT, shippedDirArg);
const RAW_DIR = path.join(REPO_ROOT, "scripts/avatar-pipeline/output/meshy-employees", character);

// The same two naming generations build-character-lods.mjs accepts, in the same
// order, so this and the builder can never disagree about which file is the run.
const RUNNING_CANDIDATES = [
  `${character}-rigged-running.glb`,
  `${character}-basic-running_glb_url.glb`,
];
const runningFile = RUNNING_CANDIDATES.find((f) => fs.existsSync(path.join(RAW_DIR, f)));
if (!runningFile) {
  console.error(
    `[repack-running-clip] NO SOURCE RUN ANIMATION for "${character}".\n` +
      `  looked in ${path.relative(REPO_ROOT, RAW_DIR)} for: ${RUNNING_CANDIDATES.join(", ")}\n` +
      `  This character needs its run animation generated before it can be packaged.\n` +
      `  REFUSING to substitute an accelerated walk — the runtime already has an honest\n` +
      `  walk fallback for a package without a run clip (dev/vo3d/avatar/gait.ts).`,
  );
  process.exit(2);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "draco3d.decoder": await draco3d.createDecoderModule(),
  "draco3d.encoder": await draco3d.createEncoderModule(),
});

function findNodeByName(doc, name) {
  return doc.getRoot().listNodes().find((n) => n.getName() === name) ?? null;
}

/** build-character-lods.mjs's retargetAnimation, unchanged — see this file's header. */
function retargetAnimation(targetDoc, sourceDoc, sourceAnim, targetName) {
  const anim = targetDoc.createAnimation(targetName);
  for (const channel of sourceAnim.listChannels()) {
    const srcNode = channel.getTargetNode();
    if (!srcNode) continue;
    const targetPath = channel.getTargetPath();
    const dstNode = findNodeByName(targetDoc, srcNode.getName());
    if (!dstNode) {
      throw new Error(
        `retargetAnimation(${targetName}): no node named "${srcNode.getName()}" in target document`,
      );
    }
    const sampler = channel.getSampler();
    if (!sampler) continue;
    const input = sampler.getInput();
    const output = sampler.getOutput();
    if (!input || !output) continue;
    const copyMap = copyToDocument(targetDoc, sourceDoc, [input, output]);
    const newSampler = targetDoc
      .createAnimationSampler()
      .setInput(copyMap.get(input))
      .setOutput(copyMap.get(output))
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

const runPath = path.join(RAW_DIR, runningFile);
console.log(`[repack-running-clip] character: ${character}`);
console.log(`[repack-running-clip] run source: ${path.relative(REPO_ROOT, runPath)}`);
console.log(`[repack-running-clip] shipped:    ${path.relative(REPO_ROOT, SHIPPED_DIR)}`);

const runDoc = await io.read(runPath);
// The raw rig export carries the placeholder single-frame "clip0" beside the
// real animation, exactly as the walk export does; the longest one with real
// channels is the run.
const candidates = runDoc.getRoot().listAnimations().filter((a) => a.listChannels().length > 0);
if (candidates.length === 0) throw new Error(`${runningFile} carries no animation channels`);
const sourceAnim = candidates.reduce((best, a) => (a.listChannels().length > best.listChannels().length ? a : best));

const report = [];
for (const tier of LOD_TIERS) {
  const file = path.join(SHIPPED_DIR, `${character}-${tier.name}.glb`);
  if (!fs.existsSync(file)) {
    console.log(`[repack-running-clip] ${tier.name}: absent, skipped (${path.relative(REPO_ROOT, file)})`);
    continue;
  }
  const doc = await io.read(file);
  const before = doc.getRoot().listAnimations().map((a) => a.getName());
  if (before.includes("running")) {
    console.log(`[repack-running-clip] ${tier.name}: already has "running", skipped`);
    report.push({ tier: tier.name, clips: before, changed: false });
    continue;
  }

  retargetAnimation(doc, runDoc, sourceAnim, "running");

  // CLIP ORDER IS NOT PART OF THE CONTRACT, and deliberately not fixed up here.
  // An appended clip lands last in the root's animation list, and gltf-transform
  // offers no reorder — but nothing reads that order: three's GLTFLoader hands
  // the app `gltf.animations` and both avatar/Avatar.ts and avatar/CastPrototypes
  // key every clip BY NAME. lod-policy's REQUIRED_CLIP_NAMES is ordered because
  // the builder walks it to map source files, not because a package must store
  // clips in that sequence.

  // copyToDocument brings the run clip's accessors in on their OWN buffer, and a
  // GLB may have at most one — the same unpartition the builder runs before it
  // writes. It moves buffer views, never image or geometry data.
  await doc.transform(unpartition());
  // Re-encode geometry at THIS tier's own bit depths — the only other transform
  // run, and the only reason the file's bytes move at all.
  if (tier.dracoQuant) await doc.transform(draco(tier.dracoQuant));

  const after = doc.getRoot().listAnimations().map((a) => a.getName());
  const bytes = await io.writeBinary(doc);
  if (!dryRun) fs.writeFileSync(file, bytes);
  const sizeKb = (bytes.byteLength / 1024).toFixed(0);
  console.log(
    `[repack-running-clip] ${tier.name}: ${before.length} -> ${after.length} clips, ${sizeKb}KB` +
      `${dryRun ? " (DRY RUN, not written)" : ""}`,
  );
  report.push({ tier: tier.name, clips: after, changed: true, sizeKb });
}

console.log(`\n[repack-running-clip] ${character} done:`);
for (const r of report) console.log(`  ${r.tier.padEnd(5)} ${r.changed ? "repacked" : "unchanged"}  ${r.clips.join(", ")}`);
