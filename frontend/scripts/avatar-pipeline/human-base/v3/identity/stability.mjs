// v3/identity/stability.mjs — Stage 0 noise floor: the SAME image under resolution / roll / framing changes must give the
// same identity, while different people must stay further apart than that noise. (run from frontend/, after run.mjs)
//   node scripts/avatar-pipeline/human-base/v3/identity/stability.mjs --mp=<dir>
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { vec, dist, traits } from "./metrics.mjs";
const require = createRequire("/Users/lekoffshorly/Documents/AI Agents/frontend/package.json");
const sharp = require("sharp");
const args = process.argv.slice(2), opt = (k) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const OUT = "scripts/avatar-pipeline/output/human-base/stage0-identity", SOUT = path.join(OUT, "_stability"), IMG = path.join(SOUT, "inputs");
fs.mkdirSync(IMG, { recursive: true });
const src = JSON.parse(fs.readFileSync(new URL("./sources.json", import.meta.url), "utf8")).sources, man = { sources: {} };
for (const [id, f] of Object.entries(src)) {
  const m = await sharp(f).metadata(), alpha = m.hasAlpha, { data } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bg = alpha ? { r: 0, g: 0, b: 0, alpha: 0 } : { r: data[0], g: data[1], b: data[2], alpha: 1 }; // harness fill: transparent, or the image's own corner colour
  const out = { s55: path.join(IMG, `${id}__s55.png`), r6: path.join(IMG, `${id}__r6.png`), pad: path.join(IMG, `${id}__pad.png`) };
  if (!fs.existsSync(out.s55)) await sharp(f).resize(Math.round(m.width * 0.55)).png().toFile(out.s55);
  if (!fs.existsSync(out.r6)) await sharp(f).ensureAlpha().rotate(6, { background: bg }).png().toFile(out.r6);
  if (!fs.existsSync(out.pad)) await sharp(f).ensureAlpha().extend({ left: Math.round(m.width * 0.18), top: Math.round(m.height * 0.1), background: bg }).png().toFile(out.pad);
  for (const [k, p] of Object.entries(out)) man.sources[`${id}__${k}`] = p;
}
const manF = path.join(SOUT, "sources.json"); fs.writeFileSync(manF, JSON.stringify(man, null, 1));
execFileSync("node", ["scripts/avatar-pipeline/human-base/v3/identity/run.mjs", `--mp=${opt("mp")}`, `--sources=${manF}`, `--out=${SOUT}`], { stdio: "inherit", env: { ...process.env } });
const A = JSON.parse(fs.readFileSync(path.join(OUT, "identity.json"), "utf8")).results, B = JSON.parse(fs.readFileSync(path.join(SOUT, "identity.json"), "utf8")).results;
const within = {}, keyT = ["eyeSpacing_IODoverEM", "lowerFace_eyeToChin", "width_mouth", "width_jaw", "width_chin", "eyeR_widthOverIOD", "nose_widthOverIOD", "mouth_widthOverIOD"], tdev = {};
for (const id of Object.keys(A)) { const v0 = vec(A[id]), t0 = traits(A[id]).t; within[id] = {};
  for (const k of ["s55", "r6", "pad"]) { const b = B[`${id}__${k}`]; if (!b?.contour) { within[id][k] = { d: null, fail: b?.failure ?? "missing" }; continue; } within[id][k] = dist(v0, vec(b));
    const t1 = traits(b).t; for (const tk of keyT) if (typeof t0[tk] === "number" && typeof t1[tk] === "number") tdev[tk] = Math.max(tdev[tk] ?? 0, Math.abs(t1[tk] - t0[tk]) / Math.abs(t0[tk])); } }
const ids = Object.keys(A), between = []; for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) between.push({ a: ids[i], b: ids[j], ...dist(vec(A[ids[i]]), vec(A[ids[j]])) });
const noise = Object.values(within).flatMap((w) => Object.values(w).map((x) => x.d)).filter((d) => d !== null), maxNoise = Math.max(...noise), meanNoise = noise.reduce((a, b) => a + b, 0) / noise.length;
const minB = between.reduce((a, b) => (b.d < a.d ? b : a));
const summary = `Same-image noise (55% scale / 6° roll / re-framing, 18 runs): mean ${meanNoise.toFixed(3)}, max ${maxNoise.toFixed(3)} u. Closest different pair: ${minB.a}–${minB.b} ${minB.d.toFixed(3)} u (${(minB.d / maxNoise).toFixed(1)}× max noise).`;
fs.writeFileSync(path.join(OUT, "stability.json"), JSON.stringify({ summary, within, between, traitMaxRelDeviation: tdev }, null, 1));
console.log(summary); console.log("trait max relative deviation:", Object.entries(tdev).map(([k, v]) => `${k} ${(v * 100).toFixed(1)}%`).join(", "));
for (const [id, w] of Object.entries(within)) console.log(id, Object.entries(w).map(([k, x]) => `${k}:${x.d === null ? x.fail : x.d.toFixed(3)}`).join(" "));
