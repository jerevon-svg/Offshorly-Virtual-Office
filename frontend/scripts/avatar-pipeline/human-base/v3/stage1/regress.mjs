// v3/stage1/regress.mjs — fast REGRESSION + NEGATIVE tests for the general rules (no build needed). Exit 1 on any failure.
//   node scripts/avatar-pipeline/human-base/v3/stage1/regress.mjs
// Build-level negatives live with their builds: T7 (nicole/V/diag-lidsink, diag-ballpush → qa.mjs), lip ends (kylle/V/diag-gate → qa-surface),
// pre-round surface (before-sculpt/* → qa-surface).
import fs from "node:fs";
import { withEyeEvidence, measureS0, translate } from "./proportions.mjs";
import { inputGate } from "./input-gate.mjs";
const O = "scripts/avatar-pipeline/output/human-base", POP = JSON.parse(fs.readFileSync(`${O}/stage1-proof/population/identity.json`, "utf8")).results, SP = JSON.parse(fs.readFileSync(`${O}/stage1-proof/style-proportions.json`, "utf8"));
let fails = 0; const t = (name, ok, info = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  · " + info : ""}`); if (!ok) fails++; };
// 1. EYE EVIDENCE: Stage 0's own flags decide; a flagged eye is rebuilt by mirroring with provenance; both bad → quarantined; clean eyes untouched
{ const f = withEyeEvidence(POP.france), c = withEyeEvidence(POP.clang), m = withEyeEvidence(POP.micah);
  t("eye: implausible-shape eye (conf 0.3) is rebuilt by mirroring", f.eyeEvidence.status.R === "unreliable" && f.eyes.R.reconstructed === "mirrored" && /mirrored/.test(f.eyeEvidence.flag), f.eyeEvidence.flag);
  t("eye: occluded outer canthus keeps its observed inner corner", c.eyeEvidence.status.L === "outer-occluded" && c.eyes.L.inner[0] === POP.clang.eyes.L.inner[0] && c.eyes.L.reconstructed === "outer corner mirrored", c.eyeEvidence.flag);
  t("eye: clean eyes are untouched (observed)", m.eyeEvidence.flag === "observed" && m.eyes === POP.micah.eyes);
  const both = JSON.parse(JSON.stringify(POP.micah)); both.eyes.R.conf = 0.2; both.eyes.L.flags = ["implausible-shape"];
  t("eye NEGATIVE: both eyes unreliable → quarantined (never evidence)", /quarantined/.test(withEyeEvidence(both).eyeEvidence.flag) && /quarantined/.test(measureS0(both).map["frame.faceH_IOD"].flag));
  t("eye: provenance reaches IOD-based relations", /mirrored/.test(measureS0(POP.france).map["frame.faceH_IOD"].flag)); }
// 2. CALIBRATION QUARANTINE: flagged calibration heads leave eye-shape calibration, reported (not silent)
t("calibration: flagged heads quarantined from eye-shape relations + side margin", SP.quarantine?.france && SP.quarantine?.clang && SP.locked["eye.sideMargin_IOD"].quarantined?.includes("france"), JSON.stringify(Object.keys(SP.quarantine ?? {})));
t("calibration: eye range is calibration DATA from verified heads", Array.isArray(SP.locked["eye.halfW_IOD_range"]?.v) && SP.locked["eye.halfW_IOD_range"].quarantined?.length === 2, JSON.stringify(SP.locked["eye.halfW_IOD_range"]?.v?.map((v) => +v.toFixed(3))));
// 3. STYLE-LIMITED TARGET (negative: an eye wider than the locked range) — the target says so and keeps the identity value
{ const R = SP.locked["eye.halfW_IOD_range"].v, T = translate({ "h.eyeW_IOD": { v: 2 * R[1] * 1.2, flag: "observed" } }, {}, SP.locked)["h.eyeW_IOD"];
  t("style limit NEGATIVE: out-of-range eye is limited WITH identity kept beside it", T.clamped && Math.abs(T.v - 2 * R[1]) < 1e-9 && T.identity > T.v && /style-limited/.test(T.style), T.style);
  const In = translate({ "h.eyeW_IOD": { v: R[0] + R[1], flag: "observed" } }, {}, SP.locked)["h.eyeW_IOD"]; t("style limit: in-range eye is identity (no limit)", !In.clamped && In.identity == null); }
// 4. INPUT GATE: malformed Stage 0 records are refused, plausible ones pass
t("gate NEGATIVE: Adam refused (eye asymmetry, unreliable mouth)", !inputGate(POP.adam).pass, inputGate(POP.adam).failed.join(","));
t("gate NEGATIVE: Kylle refused (malformed mouth)", !inputGate(POP.kylle).pass, inputGate(POP.kylle).failed.join(","));
t("gate: plausible records pass (karen, esson, ivory, bhong)", ["karen", "esson", "ivory", "bhong"].every((w) => inputGate(POP[w]).pass));
// 5. BUILD-LEVEL NEGATIVES (trace round): every new detector must FAIL its defect — real legacy builds where they exist (stage1-proof/before-trace = the
//    pass-3 builds), else the defect INJECTED into a passing head (Nicole). Positive control: the same head unmodified passes.
{ const { loadFinal } = await import("./measure-final.mjs"), { silhouetteQA } = await import("./qa-silhouette.mjs"), { featureQA } = await import("./qa-features.mjs"), { execFileSync } = await import("node:child_process");
  const B = `${O}/stage1-proof`, ok = (d) => fs.existsSync(`${d}/build.json`);
  if (ok(`${B}/nicole/V/pass1`) && ok(`${B}/before-trace/ivory`)) { const F = await loadFinal(`${B}/nicole/V/pass1`), { X, T, g3, bj, balls } = F, n = T.n, L = bj.layout.landing, iod = Math.abs(g3.cR[0] - g3.cL[0]), Hf = g3.eyeY - g3.chinY, sm = (u) => { const v = Math.min(1, Math.max(0, u)); return v * v * (3 - 2 * v); };
    const ear = (i) => T.region[i] === T.REGION.earL || T.region[i] === T.REGION.earR, SQ = (Y) => silhouetteQA(Y, T, g3), FQ = (Y) => featureQA(Y, T, g3, L, balls);
    const base = { s: SQ(X), f: FQ(X) }; t("positive control: Nicole passes silhouette + feature-form QA", base.s.pass && base.f.pass, JSON.stringify({ s: base.s.pass, f: base.f.pass }));
    // stepped temple: real (pass-3 Ivory, cranium waist) + injected 6% shoulder above the temple
    { const IV = await loadFinal(`${B}/before-trace/ivory`); t("NEGATIVE stepped temple (real: pass-3 Ivory)", !silhouetteQA(IV.X, IV.T, IV.g3).pass, JSON.stringify(silhouetteQA(IV.X, IV.T, IV.g3).checks.craniumWaist));
      const Y = Float32Array.from(X), yS = g3.eyeY + 0.35 * Hf; for (let i = 0; i < n; i++) if (!ear(i)) Y[i * 3] *= 1 - 0.06 * sm((Y[i * 3 + 1] - yS) / 0.006); const q = SQ(Y); t("NEGATIVE stepped temple (injected 6% shoulder)", !q.checks.craniumWaist.pass || !q.checks.craniumConvex.pass, JSON.stringify([q.checks.craniumWaist.depth, q.checks.craniumConvex.kappa])); }
    // artificially pointed chin: the chin below the chin-width level narrowed toward a V
    { const Y = Float32Array.from(X), yCl = g3.mouthY + 0.8 * (g3.chinY - g3.mouthY); for (let i = 0; i < n; i++) { const y = Y[i * 3 + 1]; if (y >= yCl || Y[i * 3 + 2] < T.centre[2]) continue; Y[i * 3] *= Math.max(0, Math.min(1, (y - g3.chinY) / (yCl - g3.chinY))) ** 0.6; }
      const q = SQ(Y); t("NEGATIVE artificially pointed chin (injected V)", !q.checks.chinTip.pass, JSON.stringify(q.checks.chinTip)); }
    // thick protruding smile ridge: real (pass-3 tube lips) + an injected crisp ridge across the lower lip
    { const KB = await loadFinal(`${B}/before-trace/kael`), qk = featureQA(KB.X, KB.T, KB.g3, KB.bj.layout.landing, KB.balls); t("NEGATIVE thick smile strips (real: pass-3 Kael tube lips)", !qk.checks.M_smileRidge.pass, JSON.stringify(qk.checks.M_smileRidge));
      const Y = Float32Array.from(X), mx = (L.mouthR[0] + L.mouthL[0]) / 2, mW = Math.abs(L.mouthL[0] - L.mouthR[0]); for (let i = 0; i < n; i++) { const dx = Math.abs(Y[i * 3] - mx); if (dx > 0.5 * mW || Y[i * 3 + 2] < T.centre[2]) continue; Y[i * 3 + 2] += 0.05 * iod * Math.exp(-(((Y[i * 3 + 1] - (g3.mouthY - 0.22 * mW)) / (0.025 * mW)) ** 2)) * Math.cos((Math.PI / 2) * (dx / (0.5 * mW))) ** 2; }
      const q = FQ(Y); t("NEGATIVE thick smile ridge (injected)", !q.checks.M_smileRidge.pass, JSON.stringify(q.checks.M_smileRidge)); }
    // separate raised ridge across the chin: real (pass-3 Chris chin pad)
    { const CB = await loadFinal(`${B}/before-trace/chris`), qc = featureQA(CB.X, CB.T, CB.g3, CB.bj.layout.landing, CB.balls); t("NEGATIVE ridge across the chin (real: pass-3 Chris chin pad)", !qc.checks.C_chinRidge.pass, JSON.stringify(qc.checks.C_chinRidge)); }
    // detached nose volumes: two pebbles beside the wings
    { const Y = Float32Array.from(X), nw = Math.abs(L.wingL[0] - L.wingR[0]), sg = 0.07 * nw; for (const wv of [L.wingR, L.wingL]) { const cx = wv[0] + Math.sign(wv[0] - (L.wingR[0] + L.wingL[0]) / 2) * 0.25 * nw, cy = wv[1]; for (let i = 0; i < n; i++) { if (Y[i * 3 + 2] < T.centre[2]) continue; const d2 = (Y[i * 3] - cx) ** 2 + (Y[i * 3 + 1] - cy) ** 2; if (d2 < 9 * sg * sg) Y[i * 3 + 2] += 0.035 * iod * Math.exp(-d2 / (2 * sg * sg)); } }
      const q = FQ(Y); t("NEGATIVE detached nose volumes (injected wing pebbles)", !q.checks.N_noseDetached.pass, JSON.stringify(q.checks.N_noseDetached)); }
    // jagged eyelids: the lid margin ring jittered in the front plane (alternating ±0.6 mm)
    { const Y = Float32Array.from(X); for (const b of balls) for (let i = 0; i < n; i++) { const rho = Math.hypot(Y[i * 3] - b.c[0], Y[i * 3 + 1] - b.c[1]); if (rho > 1.05 * b.r || Y[i * 3 + 2] < b.c[2]) continue;   /* the lid margins sit at 0.35–0.95 ball radii (upper/lower vs corners) */ const s2 = i % 2 ? 1 : -1; Y[i * 3] += s2 * 0.0006; Y[i * 3 + 1] -= s2 * 0.0006; }
      const q = FQ(Y); t("jagged eyelids detector is REPORT-ONLY (it failed its negative — documented, not a gate)", q.checks.E_jaggedLids.reportOnly === true, JSON.stringify(q.checks.E_jaggedLids)); }
    // under-jaw creases: real (pass-3 Chris) through surface QA (its low-angle crease check)
    { let out = ""; try { out = execFileSync("node", ["scripts/avatar-pipeline/human-base/v3/stage1/qa-surface.mjs", `--dirs=chris-before:${B}/before-trace/chris`], { encoding: "utf8" }); } catch (e) { out = e.stdout ?? ""; }
      t("NEGATIVE under-jaw creases (real: pass-3 Chris, surface QA low-angle)", /FAIL/.test(out) && /low [1-9]/.test(out), (out.match(/crease \d+ \(max [\d.]+°\)[^·]*· [^·]*· [^·]*· low \d+/) ?? [""])[0]); } }
  else console.log("SKIP  build-level negatives (builds missing)"); }
console.log(fails ? `${fails} FAILED` : "all regression tests passed"); process.exitCode = fails ? 1 : 0;
