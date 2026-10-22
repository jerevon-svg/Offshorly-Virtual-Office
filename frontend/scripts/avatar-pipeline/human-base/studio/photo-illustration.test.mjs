// photo-illustration.test.mjs — the photo → illustration stage is the production-five Stage A recipe (flat house-style headshot, the
// approved sprites as style references) — never the soft-3D chibi prompt — and keying stays harmless. No network: the paid call is never made here. From frontend/:
//   npx vitest run scripts/avatar-pipeline/human-base/studio/photo-illustration.test.mjs
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import { OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE } from "../../generate-production-v2.mjs";
import { keyMagentaToWhite, PROMPT, STAGE_A_PROMPT, STYLE_REFS } from "./photo-illustration.mjs";
const sharp = createRequire(`${process.cwd()}/package.json`)("sharp");

describe("photo → Offshorly illustration (studio/photo-illustration.mjs)", () => {
  it("is the Stage A flat headshot recipe (verbatim) for a true front view — never the soft-3D chibi prompt", () => {
    expect(PROMPT.endsWith(STAGE_A_PROMPT)).toBe(true); expect(STAGE_A_PROMPT).toMatch(/semi-flat vector style/); expect(PROMPT).toMatch(/true front view/);
    expect(PROMPT).toMatch(/FIRST image is the photo/); expect(PROMPT.includes(OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE)).toBe(false); expect(PROMPT).not.toMatch(/soft-3D/i); });
  it("styles from the approved five's own sprites only", () => {
    expect(STYLE_REFS.length).toBeGreaterThanOrEqual(3); for (const f of STYLE_REFS) expect(f).toMatch(/meshy-ref\/(angelo|clang|france|micah|bon)\//);
    for (const f of STYLE_REFS.filter((x) => fs.existsSync(x))) expect(f.endsWith("-ref-original.png")).toBe(true); });
  it("keys the flat magenta background to white and leaves the character's colours untouched", async () => {
    const W = 40, px = Buffer.alloc(W * W * 3); for (let i = 0; i < W * W; i++) { const x = i % W, y = Math.floor(i / W), inside = x >= 10 && x < 30 && y >= 10 && y < 30; px.set(inside ? [200, 150, 120] : [255, 0, 255], i * 3); }
    const out = await keyMagentaToWhite(await sharp(px, { raw: { width: W, height: W, channels: 3 } }).png().toBuffer()), { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    const at = (x, y) => Array.from(data.subarray((y * W + x) * 3, (y * W + x) * 3 + 3)); expect(at(2, 2)).toEqual([255, 255, 255]); expect(at(20, 20)).toEqual([200, 150, 120]); });
});
