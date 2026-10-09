// v3/stage1/calibrate-proportions.mjs — learns the OFFSHORLY STYLE TRANSFORM per proportion relationship from the approved pairs
// (approved-pairs.json: approved head ↔ the sprite it was made from). Both sides are measured with proportions.mjs definitions:
// sprite = Stage 0 (population run); approved 3D = dense canonical fit (landmark verts, nostril line, menton, silhouette widths)
// + the approved head's own eye half-width. Writes stage1-proof/style-proportions.json. Calibration only — never an identity source.
//   node scripts/avatar-pipeline/human-base/v3/stage1/calibrate-proportions.mjs
import fs from "node:fs";
import { io } from "../../lib.mjs";
import { loadTemplate } from "../fit.mjs";
import { measureS0, measure3D, learnStyle, subnasale, faceOutlineX, mentonY, withEyeEvidence } from "./proportions.mjs";
import { T_GRID, faceFrame, evidence, completeFor, hairOuterFrom } from "./envelope.mjs";
import { classifyMouth, smilePrior } from "./mouth.mjs";
import { inputGate } from "./input-gate.mjs";
import sharp from "sharp";
const t = loadTemplate(), TL = t.landmarks, RG = t.REGION, O = "scripts/avatar-pipeline/output/human-base/stage1-proof";
const POP = Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(`${O}/population/identity.json`, "utf8")).results).map(([k, v]) => [k, withEyeEvidence(v)])),   /* eye evidence repaired + flagged (FC-EYE-EVIDENCE-QUARANTINE) */ PAIRS = JSON.parse(fs.readFileSync(new URL("./approved-pairs.json", import.meta.url), "utf8")).pairs;
/** 3D level/width provider for a canonical-topology head X (+ optional eye half-width) */
export function g3OfCanonical(X, tp, halfW) { const g = (i) => [X[i * 3], X[i * 3 + 1]], cR = g(tp.landmarks.eyeL), cL = g(tp.landmarks.eyeR), eyeY = (cR[1] + cL[1]) / 2, mouthY = X[tp.landmarks.mouth * 3 + 1];
  const chinY = mentonY(X, tp.n, mouthY);
  const sn = subnasale(X, tp.n, X[tp.landmarks.noseTip * 3 + 1], X[tp.landmarks.noseTip * 3 + 2], mouthY);
  const widthAtX = (y) => faceOutlineX(X, tp.n, tp.region, tp.REGION.earL, tp.REGION.earR, tp.centre[2], Math.abs(cR[0] - cL[0]), y, 0.004, tp.I);
  const o = { eyeY, noseY: sn ? sn.y : (X[tp.landmarks.noseTip * 3 + 1] + mouthY) / 2, mouthY, chinY, cR, cL, widthAtX, widthAt: (y) => { const w = widthAtX(y); return w[1] - w[0]; } };
  if (halfW) { const sR = Math.sign(cR[0] - cL[0]); Object.assign(o, { iR: [cR[0] - sR * halfW, cR[1]], oR: [cR[0] + sR * halfW, cR[1]], iL: [cL[0] + sR * halfW, cL[1]], oL: [cL[0] - sR * halfW, cL[1]] }); }
  return o; }
import { pathToFileURL } from "node:url";
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  // FACE-SHAPE PRIOR for completion: population OBSERVED half-widths per level (kept per member → leave-one-out at use) + the style
  // base front silhouette shape (fills levels the population never sees, e.g. temples under hair)
  // CLOSED-SMILE PRIOR (mouth.mjs): population closed-smile curvature (line mouths) + drawn closed-lip height — used only where the reference does not draw them
  for (const [id, p] of Object.entries(POP)) if (p.mouth?.found) { const { data, info } = await sharp(`${O}/population/${id}-canonical.png`).removeAlpha().raw().toBuffer({ resolveWithObject: true }); p.__mouthKind = classifyMouth(p.mouth, (x, y) => { const o = (Math.max(0, Math.min(info.height - 1, y)) * info.width + Math.max(0, Math.min(info.width - 1, x))) * 3; return [data[o], data[o + 1], data[o + 2]]; }).kind; }
  const SMILE = smilePrior(Object.fromEntries(Object.entries(POP).filter(([, p]) => inputGate(p).pass)));   // refused (implausible) Stage 0 records never feed a prior console.log("smile prior", JSON.stringify(SMILE), Object.entries(POP).map(([k, p]) => `${k}:${p.__mouthKind}`).join(" "));
  const obs = T_GRID.map(() => []); for (const [id, p] of Object.entries(POP)) { if (!(p.contour && p.eyes?.R?.found && p.eyes?.L?.found && p.mouth?.found && p.nose?.found)) continue; const fr = faceFrame(p);
    evidence(p, fr, await hairOuterFrom(`${O}/population/${id}-hairmask.png`, sharp)).forEach((s2, i) => { for (const side of ["L", "R"]) if (s2.sides[side]?.kind === "OBSERVED") obs[i].push([id, +s2.sides[side].w.toFixed(4)]); }); }
  const B2 = Float32Array.from(JSON.parse(fs.readFileSync(`${O}/base2.json`, "utf8")).P), gb = g3OfCanonical(B2, t, null), iodB = Math.abs(gb.cR[0] - gb.cL[0]), Hb = gb.eyeY - gb.chinY;
  const styleProf = T_GRID.map((tt) => { const y = gb.eyeY - tt * Hb; if (y < gb.chinY + 0.003) return null; const w = gb.widthAtX(y); return Number.isFinite(w[0]) ? (w[1] - w[0]) / 2 / iodB : null; });
  const priorData = { obs, style: styleProf };
  const PERHW = {}, QUAR = {}; const pairs = []; for (const [fit, sprite] of PAIRS) { const X = Float32Array.from(JSON.parse(fs.readFileSync(`${O}/approved-fits/${fit}.json`, "utf8")).X), d = await io.read(`public/avatars/human-base-v1/production/${fit}-v1.glb`);
    const Lp = d.getRoot().listScenes()[0].getExtras().humanIdentity.landmarks, iodP = Math.hypot(Lp.eyes.r[0] - Lp.eyes.l[0], Lp.eyes.r[1] - Lp.eyes.l[1]), g3 = g3OfCanonical(X, t, null), iodF = Math.abs(g3.cR[0] - g3.cL[0]);
    PERHW[fit] = Lp.eyes.halfW / iodP; const env = completeFor(POP[sprite], priorData, await hairOuterFrom(`${O}/population/${sprite}-hairmask.png`, sharp), sprite);
    const s3 = measure3D(g3OfCanonical(X, t, (Lp.eyes.halfW / iodP) * iodF)).map, s0 = measureS0(POP[sprite], { env }).map;
    // QUARANTINE (FC-CALIBRATION-OCCLUDED-EYES): a calibration head whose sprite eye evidence is flagged had its approved 3D eye built from that same
    // evidence — its eye-SHAPE relations (both sides) and its eye side margin leave calibration until verified; everything else stays, flagged
    const ef = POP[sprite].eyeEvidence?.flag ?? "observed"; if (ef !== "observed") { for (const k of ["h.eyeW_IOD", "h.innerGap_IOD"]) { delete s0[k]; delete s3[k]; } QUAR[fit] = { sprite, eyeEvidence: POP[sprite].eyeEvidence, quarantined: ["h.eyeW_IOD", "h.innerGap_IOD", "eye.sideMargin_IOD"], kept: "all other relations, with provenance " + ef }; }
    pairs.push({ fit, sprite, s0, s3 }); }
  const style = learnStyle(pairs);
  // STYLE-LOCKED relations (not observable in a front drawing): nose-tip height above the nostril line, as a fraction of eye→chin
  const tipRel = PAIRS.map(([fit]) => { const X = Float32Array.from(JSON.parse(fs.readFileSync(`${O}/approved-fits/${fit}.json`, "utf8")).X), g = g3OfCanonical(X, t, null); return (X[TL.noseTip * 3 + 1] - g.noseY) / (g.eyeY - g.chinY); });
  // population cheek/jaw relation (evidence-backed members only) — used to infer a hair-hidden cheek width
  const cj = Object.values(POP).filter((p) => p.contour && p.eyes?.R?.found && p.eyes?.L?.found && p.mouth?.found && p.nose?.found).map((p) => measureS0(p).g).filter((g) => /^(observed|mirrored)/.test(g.cheekW.flag) && /^(observed|mirrored|probable)/.test(g.jawW.flag)).map((g) => g.cheekW.v / g.jawW.v).sort((a, b) => a - b);
  // eye-to-side margin of the approved style (outer canthus → front silhouette at the eye line, IOD units) — anatomical containment bound
  const sideM = PAIRS.filter(([fit]) => !QUAR[fit]).map(([fit]) => { const X = Float32Array.from(JSON.parse(fs.readFileSync(`${O}/approved-fits/${fit}.json`, "utf8")).X), g = g3OfCanonical(X, t, null), iod = Math.abs(g.cR[0] - g.cL[0]), w = g.widthAtX(g.eyeY), hw = PERHW[fit] * iod;
    return ((w[1] - w[0]) / 2 - (iod / 2 + hw)) / iod; });
  const tipS = [...tipRel].sort((a, b) => a - b), hwV = Object.entries(PERHW).filter(([fit]) => !QUAR[fit]).map(([, v]) => v), locked = { "eye.halfW_IOD_range": { v: [Math.min(...hwV) * 0.9, Math.max(...hwV) * 1.1], stat: "span of approved heads with verified eye evidence ± 10% (the standard style margin)", per: Object.fromEntries(Object.entries(PERHW).map(([k, v]) => [k, +v.toFixed(3)])), quarantined: Object.keys(QUAR) }, "eye.sideMargin_IOD": { v: Math.min(...sideM), stat: "min over approved heads with verified eye evidence", per: sideM, quarantined: Object.keys(QUAR) }, "nose.tipAboveBase_H": { v: tipS.length % 2 ? tipS[tipS.length >> 1] : (tipS[tipS.length / 2 - 1] + tipS[tipS.length / 2]) / 2, stat: "median (robust to one noisy fit)", per: tipRel } }, prior = { cheekOverJaw: cj.length >= 3 ? cj[cj.length >> 1] : null, n: cj.length, envelope: priorData, smile: SMILE }; fs.writeFileSync(`${O}/style-proportions.json`, JSON.stringify({ pairs: PAIRS, quarantine: QUAR, style, locked, prior, per: pairs }, null, 1)); console.log("locked", JSON.stringify(locked), "prior cheek/jaw", prior.cheekOverJaw?.toFixed(3), "envelope obs per level", obs.map((o) => o.length).join(","));
  for (const [k, v] of Object.entries(style)) console.log(k.padEnd(24), `k ${v.k.toFixed(3)} (raw ${v.kRaw.toFixed(3)}, sd ${v.sdLog.toFixed(3)}, trust ${v.trust.toFixed(2)}, n ${v.n}) range ${v.range.map((x) => x.toFixed(3)).join("–")}`);
}
