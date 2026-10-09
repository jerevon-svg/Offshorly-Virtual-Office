// v3/stage1/measure.mjs — Stage 1 identity-preservation measurement in MODEL SPACE (orthographic front silhouette of the
// head mesh, ears excluded; no camera / perspective). Compares each person's 3D deviation from the canonical head with the
// Stage 0 deviation from the population mean (the style translation is relative, so deviations are the contract).
import fs from "node:fs";
import { loadTemplate } from "../fit.mjs";
import { traits } from "../identity/metrics.mjs";
const OUT = "scripts/avatar-pipeline/output/human-base/stage1-proof", tpl = loadTemplate(), TL = tpl.landmarks, RG = tpl.REGION;
const WHO = JSON.parse(fs.readFileSync(`${OUT}/selection.json`, "utf8")); const ids = [WHO.anchor, ...WHO.pair];
const S0T = JSON.parse(fs.readFileSync("scripts/avatar-pipeline/output/human-base/stage0-identity/traits.json", "utf8"));
const POPJ = JSON.parse(fs.readFileSync(`${OUT}/population/identity.json`, "utf8")).results, popT = Object.values(POPJ).filter((p) => p.contour && p.mouth?.found).map((p) => traits(p).t);
const KEYS = ["eyeSpacing_IODoverEM", "lowerFace_eyeToChin", "width_eye", "width_cheek", "width_mouth", "width_jaw", "width_chin"];
const meanT = Object.fromEntries(KEYS.map((k) => { const v = popT.map((t) => t[k]).filter((x) => typeof x === "number"); return [k, v.reduce((a, b) => a + b, 0) / v.length]; }));
function m3(X) { const at = (i) => [X[i * 3], X[i * 3 + 1]], eL = at(TL.eyeL), eR = at(TL.eyeR), eyeY = (eL[1] + eR[1]) / 2, iod = Math.abs(eR[0] - eL[0]), mouthY = at(TL.mouth)[1], chinY = at(TL.chin)[1], em = eyeY - mouthY, u = Math.sqrt(iod * em);
  const half = (y) => { let l = 0, r = 0; for (let i = 0; i < tpl.n; i++) { if (tpl.region[i] === RG.earL || tpl.region[i] === RG.earR || Math.abs(X[i * 3 + 1] - y) > 0.004) continue; l = Math.min(l, X[i * 3]); r = Math.max(r, X[i * 3]); } return (r - l) / u; };
  return { eyeSpacing_IODoverEM: iod / em, lowerFace_eyeToChin: (eyeY - chinY) / u, width_eye: half(eyeY), width_cheek: half(eyeY - 0.5 * em), width_mouth: half(mouthY), width_jaw: half(mouthY - 0.5 * (mouthY - chinY)), width_chin: half(mouthY - 0.85 * (mouthY - chinY)) }; }
const can = m3(tpl.P), res = {}, dev2 = [], dev3 = [];
for (const w of ids) { const X = Float32Array.from(JSON.parse(fs.readFileSync(`${OUT}/${w}/S/pass1/qa-geometry.json`, "utf8")).X), t3 = m3(X); res[w] = {};
  for (const k of KEYS) { const s0 = S0T[w][k], d2 = typeof s0 === "number" ? s0 / meanT[k] - 1 : null, d3 = t3[k] / can[k] - 1; res[w][k] = { stage0: s0, popMean: meanT[k], dev2D: d2, model3D: t3[k], canonical: can[k], dev3D: d3 }; if (d2 !== null) { dev2.push(d2); dev3.push(d3); } } }
const corr = (a, b) => { const ma = a.reduce((x, y) => x + y, 0) / a.length, mb = b.reduce((x, y) => x + y, 0) / b.length; let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; } return sab / Math.sqrt(saa * sbb); };
// rank agreement per trait among the three (does the 3D order match the Stage 0 order?)
const rankOK = {}; for (const k of KEYS) { const v = ids.filter((w) => res[w][k].dev2D !== null); const o2 = [...v].sort((a, b) => res[a][k].stage0 - res[b][k].stage0).join(">"), o3 = [...v].sort((a, b) => res[a][k].model3D - res[b][k].model3D).join(">"); rankOK[k] = { stage0: o2, model3D: o3, same: o2 === o3 }; }
// distinctness in 3D: pairwise + distance from canonical (normalised silhouette vector)
const vecOf = (t) => KEYS.map((k) => t[k]), d = (a, b) => Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0) / a.length);
const pair = {}; for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pair[`${ids[i]}-${ids[j]}`] = +d(KEYS.map((k) => res[ids[i]][k].model3D), KEYS.map((k) => res[ids[j]][k].model3D)).toFixed(3);
const fromCanon = Object.fromEntries(ids.map((w) => [w, +d(KEYS.map((k) => res[w][k].model3D), vecOf(can)).toFixed(3)]));
// the rejected V3-B Nicole (evaluation only) on the same model-space measures
let v3b = null; const f = "scripts/avatar-pipeline/output/human-base/v3-proof/nicole/B/pass1/qa-geometry.json"; if (fs.existsSync(f)) v3b = m3(Float32Array.from(JSON.parse(fs.readFileSync(f, "utf8")).X));
const out = { population: popT.length, deviationCorrelation: +corr(dev2, dev3).toFixed(3), n: dev2.length, rankAgreement: rankOK, pairwise3D: pair, distanceFromCanonical: fromCanon, canonical: can, perPerson: res, nicoleV3B_rejected: v3b };
fs.writeFileSync(`${OUT}/identity-preservation.json`, JSON.stringify(out, null, 1));
console.log(`deviation correlation 2D→3D r=${out.deviationCorrelation} (n=${out.n}) · ranks same: ${Object.entries(rankOK).filter(([, v]) => v.same).length}/${KEYS.length} · pairwise3D ${JSON.stringify(pair)} · fromCanonical ${JSON.stringify(fromCanon)}`);
for (const k of KEYS) console.log(k.padEnd(22), ids.map((w) => `${w} 2D ${typeof res[w][k].stage0 === "number" ? res[w][k].stage0.toFixed(2) : " — "} (${res[w][k].dev2D === null ? "  — " : (res[w][k].dev2D * 100).toFixed(0).padStart(3) + "%"}) 3D ${res[w][k].model3D.toFixed(2)} (${(res[w][k].dev3D * 100).toFixed(0).padStart(3)}%)`).join(" | "), `| canon ${can[k].toFixed(2)}${v3b ? ` | V3-B nicole ${v3b[k].toFixed(2)}` : ""}`, rankOK[k].same ? "rank✓" : `rank✗ ${rankOK[k].stage0} vs ${rankOK[k].model3D}`);
