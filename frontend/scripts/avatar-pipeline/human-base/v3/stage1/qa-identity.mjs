// v3/stage1/qa-identity.mjs — IDENTITY QA (fail-closed): the FINAL 3D head re-measured against its style-translated identity map.
// Structural QA (qa.mjs) proves the mesh is valid; this proves it is still THIS PERSON. Checks (tolerances graded by evidence):
//   W  cross-section widths (temple, eye, cheek, nose, mouth, jaw, chin)     ±6%  (STYLE_PRIOR levels ±12% — uncertain by nature)
//   S  silhouette profile vs the style-translated envelope, evidence-backed levels t∈[−0.3,0.85]: max ≤ 8%, mean ≤ 4%
//   C  chin shape (half-width at 25/50/75% chin-width→menton)              ±0.06 absolute
//   H  face height (eye→chin / eye spacing)                                ±4%
//   V  nose–mouth–chin chain (eye→nose, nose→mouth, mouth→chin, nose→chin) ±0.02 of eye→chin
//   F  feature widths/spacing (inner gap, eye, nose, mouth / eye spacing)  ±6%
//   node scripts/avatar-pipeline/human-base/v3/stage1/qa-identity.mjs --who=a,b,c        (exit 1 on any failure)
import fs from "node:fs";
import { measureFinal } from "./measure-final.mjs";
const O = "scripts/avatar-pipeline/output/human-base/stage1-proof", WHO = (process.argv.find((a) => a.startsWith("--who="))?.slice(6) ?? "").split(",").filter(Boolean);
const WIDTHS = ["frame.templeW_IOD", "frame.eyeLevelW_IOD", "frame.cheekW_IOD", "frame.noseLevelW_IOD", "frame.mouthLevelW_IOD", "frame.jawW_IOD", "frame.chinW_IOD"];
const results = {}; let allPass = true;
for (const who of WHO) { const F = await measureFinal(`${O}/${who}/V/pass1`), T = F.bj.layout.ipm.target, M = F.map, E = F.bj.layout.envTarget, R = { checks: {}, failures: [] };
  const chk = (id, ok, data) => { R.checks[id] = { pass: ok, ...data }; if (!ok) R.failures.push(id); };
  const rel = (k) => (T[k] && M[k] ? (M[k].v - T[k].v) / T[k].v : null);
  for (const k of WIDTHS) { const e = rel(k); if (e == null) continue; const prior = /STYLE_PRIOR/.test(T[k].flag), tol = prior ? 0.12 : 0.06; chk(`W.${k.split(".")[1]}`, Math.abs(e) <= tol, { err: +(e * 100).toFixed(1), tol: tol * 100, provenance: T[k].flag }); }
  // silhouette profile: final front silhouette half-width at the target height of every evidence-backed envelope sample
  { const errs = []; E.t.forEach((t, i) => { if (t < -0.3 || t > 0.85 || /STYLE_PRIOR/.test(E.cls[i] ?? "")) return; const w = F.g3.widthAtX(E.y3[i]), half = (w[1] - w[0]) / 2; if (Number.isFinite(half) && E.halfW3[i] > 0) errs.push(Math.abs(half - E.halfW3[i]) / E.halfW3[i]); });
    const mx = errs.length ? Math.max(...errs) : 0, mean = errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : 0; chk("S.silhouette", mx <= 0.08 && mean <= 0.04, { maxErr: +(mx * 100).toFixed(1), meanErr: +(mean * 100).toFixed(1), samples: errs.length }); }
  for (const f of [25, 50, 75]) { const k = `frame.chinRound${f}`; if (T[k] && M[k]) chk(`C.chinRound${f}`, Math.abs(M[k].v - T[k].v) <= 0.06, { final: +M[k].v.toFixed(3), target: +T[k].v.toFixed(3) }); }
  { const e = rel("frame.faceH_IOD"); if (e != null) chk("H.faceHeight", Math.abs(e) <= 0.04, { err: +(e * 100).toFixed(1) }); }
  for (const k of ["v.eyeNose_H", "v.noseMouth_H", "v.mouthChin_H", "v.noseChin_H"]) if (T[k] && M[k]) chk(`V.${k.split(".")[1]}`, Math.abs(M[k].v - T[k].v) <= 0.02, { final: +M[k].v.toFixed(3), target: +T[k].v.toFixed(3) });
  for (const k of ["h.innerGap_IOD", "h.eyeW_IOD", "h.noseW_IOD", "h.mouthW_IOD"]) { const e = rel(k); if (e != null) chk(`F.${k.split(".")[1]}`, Math.abs(e) <= 0.06, { err: +(e * 100).toFixed(1) }); }
  // style-limited targets are REPORTED (never silent): identity value vs the locked style value
  R.styleLimited = Object.fromEntries(Object.entries(T).filter(([, t]) => t.identity != null).map(([k, t]) => [k, { identity: +t.identity.toFixed(3), target: +t.v.toFixed(3), why: t.style }]));
  R.pass = R.failures.length === 0; if (!R.pass) allPass = false; results[who] = R;
  console.log(`${who.padEnd(8)} ${R.pass ? "PASS" : "FAIL"} ${Object.keys(R.checks).length} checks${Object.keys(R.styleLimited).length ? " · STYLE-LIMITED " + JSON.stringify(R.styleLimited) : ""}${R.failures.length ? " · failed: " + R.failures.map((f) => `${f}(${JSON.stringify(R.checks[f]).slice(0, 80)})`).join(" ") : ""}`); }
fs.writeFileSync(`${O}/qa-identity.json`, JSON.stringify(results, null, 1));
process.exitCode = allPass ? 0 : 1;
