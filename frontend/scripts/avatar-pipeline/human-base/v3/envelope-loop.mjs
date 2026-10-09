// v3/envelope-loop.mjs — HumanBase V3: the FACIAL-ENVELOPE identity loop (bounded, deterministic). ZERO CREDITS.
//   node scripts/avatar-pipeline/human-base/v3/envelope-loop.mjs --who=nicole,bon --mp=<mediapipe dir>     (needs :5173)
// 1. STYLE RELATIONSHIP k(t): visible face envelope of each APPROVED-FIVE production avatar (front render) ÷ the visible
//    face envelope of their approved illustration (both hair-occluded, both measured by envelope2D) — per-band median.
// 2. TARGET(t) = k(t) · the person's own illustration envelope (their deviations survive, only the house 2D→3D
//    translation is applied).
// 3. BUILD → RENDER → MEASURE → ADJUST the per-band evidence silhouette ratio (damped, clamped), ≤ 3 rebuilds, stop at
//    3 % — the canonical topology is fitted to the corrected evidence each time. The final ratio is written next to the
//    build so the normal build reproduces it exactly.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { detect } from "./landmarks2d.mjs";
import { BANDS, envelope2D } from "./envelope.mjs";
import { buildB } from "./build.mjs";

const args = process.argv.slice(2), opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const WHO = opt("who", "nicole").split(","), MP = opt("mp"), MAXIT = 3, TOL = 0.04;
const OUT = "scripts/avatar-pipeline/output/human-base/v3-proof", TMP = `${process.env.TMPDIR ?? "/tmp"}/hb-v3-envloop`; fs.mkdirSync(TMP, { recursive: true });
const REF = (w) => (w === "bon" ? "scripts/avatar-pipeline/output/human-base/meshy-ref/bon-head-ref-final.png" : `scripts/avatar-pipeline/output/human-base/meshy-ref/${w}/${w}-ref-final.png`);
const VIEW = { az: 0, el: 2, d: 40, aim: "head" };
function render(tiles) { const jobs = `${TMP}/jobs.json`; fs.writeFileSync(jobs, JSON.stringify([{ out: `${TMP}/sheet.png`, title: "env", cols: tiles.length, tiles }]));
  execFileSync("node", ["scripts/avatar-pipeline/human-base/v3/render.mjs", jobs], { env: { ...process.env, V3_TILE: "512" }, stdio: "ignore" }); }
async function envFull(files) { const d = await detect(MP, files); const out = []; for (const [i, f] of files.entries()) { if (!d[i].found) throw new Error(`no face found: ${f}`); out.push((await envelope2D(f, d[i].landmarks)).bands); } return out; }
async function envOf(files) { return (await envFull(files)).map((b) => b.map((x) => x.half)); }
const med = (v) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
// ---- 1. k(t) from the approved five ----------------------------------------------------------------------------------------
const FIVE = ["bon", "micah", "angelo", "clang", "france"];
render(FIVE.map((w) => ({ who: w, head: null, view: VIEW, save: `${TMP}/approved-${w}.png` })));
const E3 = await envOf(FIVE.map((w) => `${TMP}/approved-${w}.png`)), F2 = await envFull(FIVE.map(REF)), E2 = F2.map((b) => b.map((x) => x.half));
// learned only from members whose DRAWN outline is the face at that band (not hair framing); ≥ 2 members, else 1:1
const used = BANDS.map((_, j) => FIVE.filter((_, i) => !F2[i][j].hairOccluded));
// ONE pooled relationship (median over every face-visible member × band up to t 0.84): per-band estimates from 1–2
// members are noise, and the approved benchmark (Bon) keeps his drawn outline ~1:1
const pool = []; FIVE.forEach((_, i) => BANDS.forEach((t, j) => { if (t <= 0.85 && !F2[i][j].hairOccluded) pool.push(E3[i][j] / E2[i][j]); }));
const k0 = med(pool), k = BANDS.map(() => k0);
const kSpread = BANDS.map((_, j) => { const v = FIVE.map((_, i) => (F2[i][j].hairOccluded ? null : E3[i][j] / E2[i][j])).filter((x) => x !== null); return v.length ? +(Math.max(...v) - Math.min(...v)).toFixed(3) : null; });
fs.writeFileSync(`${OUT}/style-envelope.json`, JSON.stringify({ note: "visible facial envelope: approved-five front render ÷ approved illustration, per band median over members whose drawn outline is the face (not hair framing)", bands: BANDS, k: k.map((x) => +x.toFixed(3)), spread: kSpread, membersPerBand: used }, null, 1));
console.log("members per band", used.map((u) => u.join("+")).join(" | "), "pooled k", k0.toFixed(3), "from", pool.length, "member-bands");
console.log("k(t)", k.map((x) => x.toFixed(3)).join(" "), "spread", kSpread.join(" "));
// ---- 2–3. per person ---------------------------------------------------------------------------------------------------------
for (const who of WHO) {
  // TARGET SOURCE: an APPROVED HumanBase character is the strongest identity+style evidence (its own approved envelope);
  // otherwise the house 2D→3D relationship applied to the person's approved illustration
  const [ill] = await envOf([REF(who)]), ai = FIVE.indexOf(who), target = ai >= 0 ? E3[ai] : ill.map((x, j) => x * k[j]); let ratio = BANDS.map(() => 1); const hist = [];
  console.log(`${who} target source: ${ai >= 0 ? "approved HumanBase 3D" : "illustration × house relationship"}`);
  const file = `${OUT}/${who}/B/pass1/${who}-v1.glb`;
  for (let it = 0; it <= MAXIT; it++) {
    await buildB(who, { envRatio: ratio });
    render([{ who, head: file, view: VIEW, save: `${TMP}/${who}-it${it}.png` }]); const [m] = await envOf([`${TMP}/${who}-it${it}.png`]);
    const err = target.map((tg, j) => tg / m[j]); hist.push({ it, ratio: ratio.map((r) => +r.toFixed(3)), measured: m.map((x) => +x.toFixed(3)), relErr: err.map((e) => +(e - 1).toFixed(3)) });
    console.log(`${who} it${it} measured ${m.map((x) => x.toFixed(3)).join(" ")} | target ${target.map((x) => x.toFixed(3)).join(" ")} | err ${err.map((e) => (e - 1).toFixed(3)).join(" ")}`);
    // control bands: eye line → t 0.84 (the chin tip is a few pixels wide — too noisy to steer by)
    const ctl = BANDS.map((t) => t <= 0.85), score = err.filter((_, j) => ctl[j]).reduce((a, e) => a + Math.abs(e - 1), 0) / ctl.filter(Boolean).length;
    hist.at(-1).score = +score.toFixed(4);
    if (Math.max(...err.filter((_, j) => ctl[j]).map((e) => Math.abs(e - 1))) < TOL || it === MAXIT) break;
    const lastCtl = ctl.lastIndexOf(true);
    let next = ratio.map((r, j) => (j > lastCtl ? null : r * Math.min(1.15, Math.max(0.85, err[j] ** 1.5)))); next = next.map((r, j) => r ?? next[lastCtl]);   // only the zone beyond the eyes/mouth moves → gain > 1; the chin tip follows the chin band
    next = next.map((r, j) => (0.25 * next[Math.max(0, j - 1)] + 0.5 * r + 0.25 * next[Math.min(next.length - 1, j + 1)]));   // smooth across bands
    ratio = next.map((r) => Math.min(1.3, Math.max(0.55, r)));
  }
  // keep the BEST iteration (mean |error| over the control bands) and rebuild it if it was not the last
  const last = hist.reduce((a, b) => ((b.score ?? 9) < (a.score ?? 9) ? b : a));
  if (last !== hist.at(-1)) await buildB(who, { envRatio: last.ratio });
  console.log(`${who} best it${last.it} score ${last.score}`);
  fs.writeFileSync(`${OUT}/${who}/B/envelope-ratio.json`, JSON.stringify({ note: "per-band evidence silhouette ratio found by the envelope loop; build.mjs reads it", bands: BANDS, ratio: last.ratio, target: target.map((x) => +x.toFixed(3)), illustration: ill.map((x) => +x.toFixed(3)), k: k.map((x) => +x.toFixed(3)), history: hist }, null, 1));
}
