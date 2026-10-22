// v3/identity/run.mjs — Stage 0 driver (run from frontend/):
//   node scripts/avatar-pipeline/human-base/v3/identity/run.mjs --mp=<dir> [--out=<dir>] [--debug]
// Manifest = sources.json (id → file). Ids only name files; the extraction path is identical for every entry.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { detect } from "../landmarks2d.mjs";
import { loadSource, canonical, evidence, CW, CH } from "./extract.mjs";
import { analyse } from "./analyse.mjs";
const require = createRequire("/Users/lekoffshorly/Documents/AI Agents/frontend/package.json");
const sharp = require("sharp");

const args = process.argv.slice(2), opt = (k) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const MPDIR = opt("mp"), OUT = opt("out") ?? "scripts/avatar-pipeline/output/human-base/stage0-identity", DEBUG = args.includes("--debug");
const manifest = JSON.parse(fs.readFileSync(opt("sources") ?? new URL("./sources.json", import.meta.url), "utf8"));
const only = opt("only")?.split(",");
const entries = Object.entries(manifest.sources).filter(([id]) => !only || only.includes(id));
fs.mkdirSync(OUT, { recursive: true });
const t0 = Date.now(), log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

// landmarks are a pure function of the file bytes → cache by content hash (reuse completed work, never recompute)
const crypto = await import("node:crypto");
const cacheF = path.join(OUT, "_mp-cache.json"), cache = fs.existsSync(cacheF) ? JSON.parse(fs.readFileSync(cacheF, "utf8")) : {};
const hashOf = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex").slice(0, 16);
const need = entries.filter(([, f]) => !cache[hashOf(f)]);
if (need.length) { log(`mediapipe on ${need.length} image(s)…`); const r = await detect(MPDIR, need.map(([, f]) => f));
  r.forEach((x, i) => { cache[hashOf(need[i][1])] = { found: x.found, faces: x.faces, size: x.size, landmarks: x.landmarks }; }); fs.writeFileSync(cacheF, JSON.stringify(cache)); log("mediapipe done"); }

const results = {};
for (const [id, file] of entries) {
  const det = cache[hashOf(file)];
  if (!det.found) { results[id] = { id, file, status: "FAIL", failure: "FC-NO-FACE" }; log(id, "NO FACE"); continue; }
  const src = await loadSource(file);
  const C = await canonical(src, det.landmarks);
  const E = evidence(C);
  if (E.fail) { results[id] = { id, file, status: "FAIL", failure: E.fail }; log(id, E.fail); continue; }
  const R = analyse(C, E);
  results[id] = { id, file, sourceHash: hashOf(file), background: src.bg, transform: C.xf, ...R.rep };
  log(id, "ok", R.rep.status, R.rep.failures?.join(",") ?? "");
  // canonical crop for the sheets (source pixels only, no annotation)
  const rgba = Buffer.alloc(CW * CH * 4);
  for (let o = 0; o < CW * CH; o++) { const bg = C.OUT[o] ? [236, 232, 226] : null; const a = C.A[o] / 255;
    for (let c = 0; c < 3; c++) rgba[o * 4 + c] = bg ? bg[c] : Math.round(C.rgb[o * 3 + c] * a + 247 * (1 - a)); rgba[o * 4 + 3] = 255; }
  await sharp(rgba, { raw: { width: CW, height: CH, channels: 4 } }).png().toFile(path.join(OUT, `${id}-canonical.png`));
  { const hm = Buffer.alloc(CW * CH); for (let o = 0; o < CW * CH; o++) hm[o] = R.HAIR[o] ? 255 : 0; await sharp(hm, { raw: { width: CW, height: CH, channels: 1 } }).png().toFile(path.join(OUT, `${id}-hairmask.png`)); }
  if (DEBUG) { // class map: skin lit/shadow, hair, bg, out, feature hull
    const d = Buffer.alloc(CW * CH * 4); const pal = [[250, 205, 170], [205, 140, 110], [150, 110, 90]];
    for (let o = 0; o < CW * CH; o++) { let c = [120, 120, 120];
      if (C.OUT[o]) c = [255, 255, 255]; else if (E.BG[o]) c = [210, 230, 255]; else if (E.SKIN[o]) c = pal[Math.min(2, E.tone[o])]; else if (R.HAIR?.[o]) c = [60, 160, 60]; else c = [40, 40, 40];
      if (R.Hm?.[o] && !E.SKIN[o]) c = [c[0] * 0.5 + 120, c[1] * 0.5, c[2] * 0.5 + 120];
      d[o * 4] = c[0]; d[o * 4 + 1] = c[1]; d[o * 4 + 2] = c[2]; d[o * 4 + 3] = 255; }
    await sharp(d, { raw: { width: CW, height: CH, channels: 4 } }).png().toFile(path.join(OUT, `_debug-${id}-classes.png`));
  }
}
fs.writeFileSync(path.join(OUT, "identity.json"), JSON.stringify({ stage: "stage0-identity", version: 1, results }, null, 1));
log("wrote", path.join(OUT, "identity.json"));
