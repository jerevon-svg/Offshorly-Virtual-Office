// v3/identity-qa.mjs — HumanBase V3 proof: IDENTITY / PERCEPTUAL signals (independent of the construction QA). ZERO CREDITS.
//   node scripts/avatar-pipeline/human-base/v3/identity-qa.mjs --mp=<mediapipe dir> --renders=<dir> --roster=<roster landmarks json>
// Signals (no face-recognition model, no stored embeddings — only scores are written):
//   1. ROSTER RETRIEVAL by facial-structure traits (MediaPipe landmarks → scale-free ratios, z-scored by the approved sprite
//      population): rank of the person's own illustration among all sprites, for the render of each variant
//   2. TRAIT DISTANCE render ↔ own illustration (z units)
//   3. APPEARANCE AGREEMENT with the current approved / candidate render (same camera): normalised cross-correlation of the
//      front and ¾ portraits — "did the new construction keep the established look?" (regression signal, not identity truth)
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { detect } from "./landmarks2d.mjs";

const args = process.argv.slice(2), opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const MP = opt("mp"), RD = opt("renders"), ROSTER = JSON.parse(fs.readFileSync(opt("roster"), "utf8"));
const WHO = ["bon", "kael", "lui", "nicole"], SPRITE = { bon: "jerevon", kael: "kael", lui: "lui", nicole: "nicole" }, VARS = ["V2", "B", "A"];
const nm = (f) => path.basename(f).replace("_Sprite.png", "").toLowerCase();
const sprites = ROSTER.filter((x) => x.file.includes("_Sprite") && x.found), K = Object.keys(sprites[0].traits);
const st = Object.fromEntries(K.map((k) => { const v = sprites.map((s) => s.traits[k]), m = v.reduce((a, b) => a + b, 0) / v.length; return [k, { m, sd: Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1 }]; }));
const zt = (t) => Object.fromEntries(K.map((k) => [k, (t[k] - st[k].m) / st[k].sd]));
const files = []; for (const w of WHO) for (const v of VARS) files.push(`${RD}/${w}-${v}-eyeFront.png`);
const det = await detect(MP, files);
// renders are a different domain (3D, lit) — z-score renders by the RENDER population so domain offsets cancel
const rend = det.filter((d) => d.found), rst = Object.fromEntries(K.map((k) => { const v = rend.map((s) => s.traits[k]), m = v.reduce((a, b) => a + b, 0) / v.length; return [k, { m, sd: Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1 }]; }));
const zr = (t) => Object.fromEntries(K.map((k) => [k, (t[k] - rst[k].m) / rst[k].sd]));
const dist = (a, b) => Math.sqrt(K.reduce((s, k) => s + (a[k] - b[k]) ** 2, 0) / K.length);
const results = {};
for (const d of det) {
  const [w, v] = path.basename(d.file, ".png").split("-"), key = `${w}/${v}`;
  if (!d.found) { results[key] = { faceFound: false }; continue; }
  const z = zr(d.traits), order = sprites.map((s) => [nm(s.file), dist(z, zt(s.traits))]).sort((a, b) => a[1] - b[1]);
  results[key] = { faceFound: true, ownSpriteRank: order.findIndex((o) => o[0] === SPRITE[w]) + 1, of: sprites.length, traitDistanceToOwn: +order.find((o) => o[0] === SPRITE[w])[1].toFixed(3), nearest: order[0][0] };
}
// appearance agreement with the approved/candidate render (normalised cross-correlation, 128 px grey)
const ncc = async (a, b) => { const g = async (f) => (await sharp(f).grayscale().resize(128, 128).raw().toBuffer()); const A = await g(a), B = await g(b); let ma = 0, mb = 0; for (let i = 0; i < A.length; i++) { ma += A[i]; mb += B[i]; } ma /= A.length; mb /= B.length; let c = 0, va = 0, vb = 0; for (let i = 0; i < A.length; i++) { c += (A[i] - ma) * (B[i] - mb); va += (A[i] - ma) ** 2; vb += (B[i] - mb) ** 2; } return c / Math.sqrt(va * vb); };
for (const w of WHO) for (const v of ["B", "A"]) { const r = results[`${w}/${v}`] ?? (results[`${w}/${v}`] = {}); r.agreementWithV2 = {}; for (const view of ["eyeFront", "front34L"]) r.agreementWithV2[view] = +(await ncc(`${RD}/${w}-V2-${view}.png`, `${RD}/${w}-${v}-${view}.png`)).toFixed(3); }
fs.writeFileSync("scripts/avatar-pipeline/output/human-base/v3-proof/qa-identity.json", JSON.stringify({ note: "scores only — no landmarks or embeddings stored; MediaPipe Face Landmarker (Apache-2.0) run locally", sprites: sprites.length, results }, null, 1));
for (const [k, r] of Object.entries(results)) console.log(k.padEnd(10), JSON.stringify(r));
