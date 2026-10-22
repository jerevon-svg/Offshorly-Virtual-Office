// v3/stage1/input-gate.mjs — STAGE 0 INPUT PLAUSIBILITY GATE (fail closed). Stage 1 never invents proportions to cover a bad measurement: an
// identity whose Stage 0 record is implausible is refused, with the violated checks named (FC-S0-IMPLAUSIBLE, learned: a malformed mouth
// (conf 0.45, touching its box, lip outline end 38 px off the corner, 12.8° tilt) built a ridge from mouth to cheek; asymmetric eyes + a mouth
// 1.6× the eye spacing broke the layout warp). Thresholds come from the 23-sprite population + 6 curated identities: plausible inputs sit at
// eye ratio ≤ 1.15, eye h/w ≤ 0.57, |mouth tilt| ≤ 4.4°, mouth 0.55–0.96 eye spacing, lip end gap ≤ 0.07, lip spike ≤ 0.09 — limits keep margin.
//   node scripts/avatar-pipeline/human-base/v3/stage1/input-gate.mjs <identity.json> [--who=a,b]     (report)
import fs from "node:fs";
import { pathToFileURL } from "node:url";
export const GATE = { eyeRatioMax: 1.3, eyeHWMax: 0.8, mouthTiltMaxDeg: 7, mouthWMin: 0.45, mouthWMax: 1.25, lipEndGapMax: 0.12, lipSpikeMax: 0.12, mouthConfMin: 0.5 };
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]), deg = (a, b) => (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
export function inputGate(p) { const c = {}, chk = (k, ok, v, lim) => (c[k] = { pass: !!ok, value: v, limit: lim });
  const e = p?.eyes, m = p?.mouth; chk("features.present", e?.R && e?.L && m?.found && p?.nose?.found, { eyes: !!(e?.R && e?.L), mouth: !!m?.found, nose: !!p?.nose?.found }, "eyes + mouth + nose base");
  if (!c["features.present"].pass) return { pass: false, checks: c, failed: ["features.present"] };
  const cR = mid(e.R.inner, e.R.outer), cL = mid(e.L.inner, e.L.outer), iod = d(cR, cL), wR = d(e.R.inner, e.R.outer), wL = d(e.L.inner, e.L.outer), [a, b] = cR[0] < cL[0] ? [cR, cL] : [cL, cR], eTilt = deg(a, b);
  const eyeHW = Math.max(...[e.R, e.L].map((q) => { const ys = [...q.upper, ...q.lower].map((v) => v[1]); return (Math.max(...ys) - Math.min(...ys)) / d(q.inner, q.outer); }));
  const [mR, mL] = m.cornerR[0] < m.cornerL[0] ? [m.cornerR, m.cornerL] : [m.cornerL, m.cornerR], mw = d(mR, mL), U = m.upper, L = m.lower, K = U.length;
  const endGap = Math.max(d(U[0], m.cornerR), d(L[0], m.cornerR), d(U[K - 1], m.cornerL), d(L[K - 1], m.cornerL)) / mw, spike = (P) => { let mx = 0; for (let k = 1; k + 1 < P.length; k++) mx = Math.max(mx, Math.abs(P[k][1] - (P[k - 1][1] + P[k + 1][1]) / 2)); return mx / mw; };
  const eyeY = (cR[1] + cL[1]) / 2, mouthY = (mR[1] + mL[1]) / 2, noseY = p.nose.base[1];
  chk("eyes.symmetry", Math.max(wR, wL) / Math.min(wR, wL) <= GATE.eyeRatioMax, +(Math.max(wR, wL) / Math.min(wR, wL)).toFixed(2), `≤ ${GATE.eyeRatioMax}`);
  chk("eyes.shape", eyeHW <= GATE.eyeHWMax, +eyeHW.toFixed(2), `height/width ≤ ${GATE.eyeHWMax}`);
  chk("mouth.reliable", !(m.conf < GATE.mouthConfMin && m.touchesBox), { conf: m.conf, touchesBox: !!m.touchesBox }, `not (conf < ${GATE.mouthConfMin} and touching its search box)`);
  chk("mouth.width", mw / iod >= GATE.mouthWMin && mw / iod <= GATE.mouthWMax, +(mw / iod).toFixed(2), `${GATE.mouthWMin}–${GATE.mouthWMax} × eye spacing`);
  chk("mouth.tilt", Math.abs(deg(mR, mL) - eTilt) <= GATE.mouthTiltMaxDeg, +(deg(mR, mL) - eTilt).toFixed(1), `|tilt vs eye line| ≤ ${GATE.mouthTiltMaxDeg}°`);
  chk("lips.endsAtCorners", endGap <= GATE.lipEndGapMax, +endGap.toFixed(2), `outline ends within ${GATE.lipEndGapMax} × mouth width of the corners`);
  chk("lips.noSpike", Math.max(spike(U), spike(L)) <= GATE.lipSpikeMax, +Math.max(spike(U), spike(L)).toFixed(2), `≤ ${GATE.lipSpikeMax} × mouth width`);
  chk("order.eyeNoseMouth", eyeY < noseY && noseY < mouthY, { eyeY: Math.round(eyeY), noseY: Math.round(noseY), mouthY: Math.round(mouthY) }, "eyes above nose base above mouth");
  const failed = Object.keys(c).filter((k) => !c[k].pass); return { pass: !failed.length, checks: c, failed }; }
if (import.meta.url === pathToFileURL(process.argv[1]).href) { const R = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).results, who = process.argv.find((x) => x.startsWith("--who="))?.slice(6).split(",");
  for (const [w, p] of Object.entries(R)) { if (who && !who.includes(w)) continue; const g = inputGate(p); console.log(`${w.padEnd(9)} ${g.pass ? "PASS" : "FAIL"}${g.failed.length ? " · " + g.failed.map((k) => `${k} ${JSON.stringify(g.checks[k].value)}`).join(" · ") : ""}`); } }
