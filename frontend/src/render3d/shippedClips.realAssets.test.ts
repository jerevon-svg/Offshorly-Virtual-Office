// EVERY SHIPPED CHARACTER PACKAGE CARRIES EVERY REQUIRED CLIP, IN EVERY LOD.
//
// This is the guard the project did not have. `running` became a required clip on 2026-09-13
// (scripts/avatar-pipeline/lod-policy.mjs REQUIRED_CLIP_NAMES), but four characters — alex-v2,
// micah-v5, gelo-v1 and jan-v1 — had already been packaged and stayed on disk with six clips each.
// Nothing failed: the pipeline only ever checked the clips it was ABOUT to build, the standalone
// validator carried its own stale copy of the list, and the runtime's fallback did exactly what a
// good fallback does and hid the gap. Four employees ran as fast-walking bodies for weeks.
//
// So the assertion is made against the FILES THE APP ACTUALLY LOADS, read straight off disk, rather
// than against anything the pipeline says about them:
//
//   * the registry (live3dCharacters.ts) is the list of characters — a new employee is covered the
//     day they are registered, with no edit here;
//   * every LOD url each one declares is opened, because a clip present in LOD0 and missing from
//     LOD2 is a character who stops running when the viewer's device tier drops;
//   * the clips are read with gltf-transform, the same reader the pipeline itself writes them with,
//     so this needs no GPU and no renderer — and the DURATIONS come with them, which is what lets it
//     also refuse a `running` entry that is really the walk under another name.
//
// Deliberately NOT a check on the walk fallback: gait.ts must keep handling a package without a run
// clip, because a legacy or in-progress package is a real thing. This test is what stops one
// SHIPPING.
import { describe, expect, it } from "vitest";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
// @ts-expect-error - draco3dgltf ships no type declarations
import draco3d from "draco3dgltf";
import { LIVE_3D_CHARACTERS } from "./live3dCharacters";
import {
  CLIP_IDLE,
  CLIP_RUN,
  CLIP_SIT,
  CLIP_SIT_ANSWER,
  CLIP_TALK_AGREE,
  CLIP_TALK_LISTEN,
  CLIP_WALK,
} from "../dev/vo3d/adapters/v1Avatar";

/** EVERY CLIP THE APP NAMES, from the app's own constants — the runtime half of the contract
 *  scripts/avatar-pipeline/lod-policy.mjs's REQUIRED_CLIP_NAMES states for the pipeline (which
 *  build-character-lods.mjs enforces on its own side, per tier, at build time). Listing them from
 *  the constants rather than as strings is what makes a renamed clip a compile error here. */
const REQUIRED_CLIPS = [
  CLIP_IDLE,
  CLIP_WALK,
  CLIP_RUN,
  CLIP_TALK_AGREE,
  CLIP_TALK_LISTEN,
  CLIP_SIT,
  CLIP_SIT_ANSWER,
];

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "draco3d.decoder": await draco3d.createDecoderModule() });

/** Where a BASE_URL-relative registry url lands, as the other realAssets tests address it: relative
 *  to the frontend package root, which is vitest's cwd. */
const onDisk = (url: string): string => `public/${url.replace(/^\/+/, "")}`;

/** Every (character, tier, url) the registry declares. A tier that falls back to another tier's url
 *  is still listed — the app will load exactly that file for that tier. */
const packages = Object.entries(LIVE_3D_CHARACTERS).flatMap(([id, set]) =>
  (
    [
      ["lod0", set.glbUrl],
      ["lod1", set.lod1GlbUrl ?? set.glbUrl],
      ["lod2", set.lod2GlbUrl ?? set.lod1GlbUrl ?? set.glbUrl],
    ] as const
  ).map(([tier, url]) => ({ id, tier, file: onDisk(url) })),
);

/** Clip name -> duration in seconds, read through gltf-transform (no GPU, no loader). */
async function clips(file: string): Promise<Map<string, number>> {
  const doc = await io.read(file);
  const out = new Map<string, number>();
  for (const anim of doc.getRoot().listAnimations()) {
    let duration = 0;
    for (const sampler of anim.listSamplers()) {
      const max = sampler.getInput()?.getMax([])?.[0] ?? 0;
      if (max > duration) duration = max;
    }
    out.set(anim.getName(), duration);
  }
  return out;
}

describe("shipped 3D character packages", () => {
  it("registers at least the cast this project ships, so an empty registry cannot pass silently", () => {
    expect(Object.keys(LIVE_3D_CHARACTERS).length).toBeGreaterThanOrEqual(5);
    expect(packages.length).toBe(Object.keys(LIVE_3D_CHARACTERS).length * 3);
  });

  it.each(packages)("$id $tier carries every required clip", async ({ file }) => {
    const found = await clips(file);
    const missing = REQUIRED_CLIPS.filter((n) => !found.has(n));
    expect(missing, `${file} is missing ${missing.join(", ")} (has: ${[...found.keys()].join(", ")})`).toEqual([]);
  });

  it.each(packages)("$id $tier carries a genuine run clip, not a re-timed walk", async ({ file }) => {
    // The two cycles are authored at different lengths — the run is 1.6x the walk's cadence — so a
    // `running` entry whose duration equals the walk's is a copy of the walk under another name.
    // That is the one substitution this project refuses to make (see the pipeline standard), and it
    // would otherwise pass the name check above.
    const found = await clips(file);
    const run = found.get(CLIP_RUN) ?? 0;
    const walk = found.get(CLIP_WALK) ?? 0;
    expect(run, `${file}: no running clip`).toBeGreaterThan(0);
    expect(walk, `${file}: no walking clip`).toBeGreaterThan(0);
    expect(
      run,
      `${file}: running (${run}s) is not shorter than walking (${walk}s) — a re-timed walk, not a run`,
    ).toBeLessThan(walk * 0.9);
  });
});
