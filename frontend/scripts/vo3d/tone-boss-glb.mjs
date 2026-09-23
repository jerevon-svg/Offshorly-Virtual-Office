#!/usr/bin/env node
/**
 * Level the generated boss statue's baseColor map to the Central Hub monument's cast stone.
 *
 * The generator returns a cool mid-grey sculpt map. three.js `material.color` can only MULTIPLY it, so
 * tinting toward the ring's warm cream darkens the statue into mud instead of matching it. The fix is to
 * level the map itself once, at build time: lift the black point, gain the midtones, and bias the channels
 * to the monument stone. Every carved shadow the sculpt baked in survives — only the overall tone moves.
 *
 * Usage: node scripts/vo3d/tone-boss-glb.mjs <in.glb> <out.glb>
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import draco3d from "draco3dgltf";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [src, dst] = process.argv.slice(2);
if (!src || !dst) { console.error("usage: tone-boss-glb.mjs <in.glb> <out.glb>"); process.exit(1); }

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "draco3d.decoder": await draco3d.createDecoderModule(),
  "draco3d.encoder": await draco3d.createEncoderModule(),
});
const doc = await io.read(src);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "boss-tone-"));
let n = 0;
for (const tex of doc.getRoot().listTextures()) {
  const mime = tex.getMimeType() || "image/png";
  const ext = mime.split("/")[1].replace("jpeg", "jpg");
  const inF = path.join(tmp, `t${n}.${ext}`), outF = path.join(tmp, `t${n}-out.png`);
  fs.writeFileSync(inF, Buffer.from(tex.getImage()));
  execFileSync("python3", ["-c", `
from PIL import Image
import sys
im = Image.open(sys.argv[1]).convert("RGB")
# black point 18 -> 0, gain to the monument stone (216,209,198) at the map's own midtone
LO, GAIN = 18.0, 1.34
BIAS = (1.000, 0.975, 0.935)   # warm it: pull green/blue down a touch against red
lut = []
for c in range(3):
    lut += [min(255, max(0, int(((v - LO) / (255.0 - LO)) * 255.0 * GAIN * BIAS[c]))) for v in range(256)]
im.point(lut).save(sys.argv[2], "PNG")
`, inF, outF]);
  tex.setImage(new Uint8Array(fs.readFileSync(outF))).setMimeType("image/png");
  n++;
}
await io.write(dst, doc);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`toned ${n} texture(s): ${src} -> ${dst} (${(fs.statSync(dst).size / 1024).toFixed(0)} KB)`);
