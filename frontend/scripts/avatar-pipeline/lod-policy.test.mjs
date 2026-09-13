import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ATLAS_PAD_RADIUS,
  IDLE_PROFILES,
  idleActionIdFor,
  LOD_TIERS,
  REQUIRED_CLIP_NAMES,
  TEXTURE_ENCODING,
} from "./lod-policy.mjs";

describe("LOD policy (quality pass 2026-08-29)", () => {
  it("ships 2048 / 1024 / 512 textures for lod0 / lod1 / lod2", () => {
    expect(LOD_TIERS.map((t) => [t.name, t.textureSize])).toEqual([["lod0", 2048], ["lod1", 1024], ["lod2", 512]]);
  });

  it("encodes every tier as near-lossless WebP (edge-preserving), never JPEG", () => {
    expect(TEXTURE_ENCODING.targetFormat).toBe("webp");
    expect(TEXTURE_ENCODING.nearLossless).toBe(true);
    // near-lossless is a lossless-mode preprocessor in libwebp — without this
    // flag the encoder silently falls back to plain lossy output.
    expect(TEXTURE_ENCODING.lossless).toBe(true);
    expect(TEXTURE_ENCODING.quality).toBeGreaterThanOrEqual(60);
  });

  it("keeps Draco on every tier with TEXCOORD quantization of at least 10 bits (lod2 raised from 8)", () => {
    for (const t of LOD_TIERS) {
      expect(t.dracoQuant.quantizeTexcoord).toBeGreaterThanOrEqual(10);
      expect(t.dracoQuant.quantizePosition).toBeGreaterThanOrEqual(10);
    }
    expect(LOD_TIERS.find((t) => t.name === "lod2").dracoQuant.quantizeTexcoord).toBe(10);
  });

  it("leaves geometry budgets unchanged and pads atlases by 8-16 texels", () => {
    expect(LOD_TIERS.map((t) => t.triangleTarget)).toEqual([25_000, 12_500, 4_000]);
    expect(ATLAS_PAD_RADIUS).toBeGreaterThanOrEqual(8);
    expect(ATLAS_PAD_RADIUS).toBeLessThanOrEqual(16);
  });

  it("requires exactly the CharacterCanvas clip names, in order", () => {
    // `running` joined on 2026-09-13 — free with every Meshy rig, never generated. It sits next to
    // `walking` because the two are one locomotion pair, and the VO3D player crossfades between them.
    expect(REQUIRED_CLIP_NAMES).toEqual(["idle-9", "walking", "running", "agree-gesture", "listening-gesture", "sit-on-chair-arms", "sitting-answering"]);
  });
});

describe("IDLE_PROFILES", () => {
  it("declares exactly the two profiles the registry can name", () => {
    expect(Object.keys(IDLE_PROFILES).sort()).toEqual(["feminine", "masculine"]);
  });

  it("maps each profile to its Meshy action id and the correction its clip needs", () => {
    expect(IDLE_PROFILES.masculine).toEqual({ actionId: 249, meshyName: "Idle_9", correction: "wrist" });
    expect(IDLE_PROFILES.feminine).toEqual({ actionId: 252, meshyName: "Idle_12", correction: "arm-chain" });
  });

  it("resolves a profile to its action id, and refuses anything else", () => {
    expect(idleActionIdFor("masculine")).toBe(249);
    expect(idleActionIdFor("feminine")).toBe(252);
    expect(() => idleActionIdFor("neutral")).toThrow(/unknown idle profile/);
    expect(() => idleActionIdFor(undefined)).toThrow(/unknown idle profile/);
  });

  it("keeps both profiles on the single runtime idle slot", () => {
    // Whichever library clip is generated, it is baked as `idle-9` — the app
    // resolves states by clip NAME and has exactly one idle state.
    expect(REQUIRED_CLIP_NAMES).toContain("idle-9");
    expect(REQUIRED_CLIP_NAMES.filter((n) => n.startsWith("idle")).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Shipped-asset contract. The policy above says which clips a consolidated GLB
// must carry; this checks that Bon's actually does — the pipeline's output, not
// just its intent. Reads the GLB's JSON chunk directly: no loader, no GPU.
// ---------------------------------------------------------------------------
describe("shipped Bon LODs", () => {
  // vitest runs from the frontend root; import.meta.url is not a file: URL under its transform, and the
  // repo path contains a space, so neither URL route survives here
  const asset = (name) => `${process.cwd()}/public/avatars/bon-v3-hq-idle9/${name}`;
  const clipsOf = (file) => {
    const buf = fs.readFileSync(file);
    const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString("utf8"));
    return { names: (json.animations ?? []).map((a) => a.name), joints: json.skins?.[0]?.joints?.length };
  };

  for (const tier of [0, 1, 2]) {
    it(`lod${tier} carries every required clip, in policy order, on the one 24-joint rig`, () => {
      const { names, joints } = clipsOf(asset(`bon-v3-lod${tier}.glb`));
      // exact equality, not containment: a clip appearing twice or drifting out of order would break the
      // mixer's name lookup just as surely as a missing one
      expect(names).toEqual(REQUIRED_CLIP_NAMES);
      // one skeleton for all of them, which is what lets AnimationMixer crossfade without swapping models
      expect(joints).toBe(24);
    });
  }
});
