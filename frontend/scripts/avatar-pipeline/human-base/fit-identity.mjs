// fit-identity.mjs — ILLUSTRATED AVATAR TRAITS → HUMANBASE IDENTITY PARAMETERS. ZERO CREDITS.
//
//   node scripts/avatar-pipeline/human-base/fit-identity.mjs <traits.json> [out.json]     (after illustration-traits)
//
// The employee's approved illustration defines WHO they are; the canonical head defines HOW humans are built in VO.
// The translation rule (the same for every employee):
//   · WIDTHS map directly: the illustration's face half-width at the cheeks (W) ↔ the canonical head's (W3);
//   · VERTICAL distances are compressed by the family's face length: V = (canonical eye→chin / W3) / (illustration
//     eye→chin / W). The chibi family has a short face; an illustration's longer face is translated, not copied;
//   · the FACE OUTLINE (jaw/cheek/chin taper) is fitted with the bounded shape controls by exhaustive search over the
//     canonical head's own morph targets — the head shape changes only within the family's envelope;
//   · eyes, brows, nose, mouth land on the illustration's measured positions, expressed as the identity parameters
//     the shared face layer already understands (bounded by PARAM_RANGES).
import fs from "node:fs";
import * as C from "../../../src/dev/vo3d/human/humanBaseContract.ts";

const traits = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const head = JSON.parse(fs.readFileSync("scripts/avatar-pipeline/output/human-base/canonical-head-work.json", "utf8"));
const lm = head.landmarks, EYE_Y = lm.eyes.l[1], EYE_X = lm.eyes.l[0], EHW = lm.eyes.halfW, EHH = lm.eyes.halfH;
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const R = C.PARAM_RANGES;

// ---- the canonical head's front outline (front half, ears excluded) under a set of shape weights ---------------------
const P0 = Float32Array.from(head.P), M = Object.fromEntries(Object.entries(head.morphs).map(([k, v]) => [k, Float32Array.from(v)]));
const front = []; for (let i = 0; i < P0.length / 3; i++) if (P0[i * 3 + 2] > 0 && P0[i * 3 + 1] > 0.78 && P0[i * 3 + 1] < EYE_Y + 0.01 && Math.abs(P0[i * 3]) < 0.37) front.push(i);
function outline(w) {
  const pos = (i, k) => { let v = P0[i * 3 + k]; for (const [n, x] of Object.entries(w)) if (x) v += M[n][i * 3 + k] * x; return v; };
  let chin = 9; const pts = front.map((i) => [Math.abs(pos(i, 0)), pos(i, 1), pos(i, 2)]);
  for (const [x, y, z] of pts) if (x < 0.03 && z > 0.15) chin = Math.min(chin, y);
  const span = EYE_Y - chin, at = (t) => { const y = EYE_Y - t * span; let m = 0; for (const [x, yy] of pts) if (Math.abs(yy - y) < 0.006) m = Math.max(m, x); return m; };
  const W3 = (at(0.35) + at(0.5)) / 2;
  return { span, W3, at };
}
const base = outline({});
const target = traits.silhouette;                              // [{t, halfWidth}] in W units
const W_ill = (target.find((s) => s.t === 0.35).halfWidth + target.find((s) => s.t === 0.5).halfWidth) / 2;
let best = null;
const steps = [-1, -0.6, -0.3, 0, 0.3, 0.6, 1];
for (const faceWidth of [-0.4, 0, 0.4]) for (const jawWidth of steps) for (const chinLength of [-0.6, -0.3, 0, 0.3, 0.6, 1]) for (const cheekFull of steps) {
  const o = outline({ faceWidth, jawWidth, chinLength, cheekFull });
  let err = 0; for (const s of target) err += ((o.at(s.t) / o.W3) - (s.halfWidth / W_ill)) ** 2;
  if (!best || err < best.err) best = { err, w: { faceWidth, jawWidth, chinLength, cheekFull }, o };
}
const W3 = best.o.W3, span = best.o.span;
const V = (span / W3) / traits.faceLength;                       // the vertical translation factor
console.log(`canonical W3 ${W3.toFixed(3)} span ${span.toFixed(3)} · illustration face length ${traits.faceLength} W → V ${V.toFixed(3)}`);
console.log(`outline fit ${JSON.stringify(best.w)} · rms ${Math.sqrt(best.err / target.length).toFixed(3)} · profile 3D ${target.map((s) => (best.o.at(s.t) / W3).toFixed(2)).join(" ")} vs illus ${target.map((s) => (s.halfWidth / W_ill).toFixed(2)).join(" ")}`);

// ---- features ------------------------------------------------------------------------------------------------------
const eyeX = traits.eyes.centreX * W3, eyeHW = traits.eyes.halfWidth * W3;
const scale = clamp(eyeHW / EHW, R.eyes.scale);
const spacing = clamp((eyeX - EYE_X) / EHW, R.eyes.spacing);
const openness = clamp((traits.eyes.halfHeight / traits.eyes.halfWidth) / (EHH / EHW), R.eyes.openness);
const browOff = -traits.brows.y * V * W3;                      // above the eye centre
const exNow = EYE_X + spacing * EHW;
const bi = traits.brows.innerX * W3, bo = traits.brows.outerX * W3;
const noseY = EYE_Y - traits.nose.y * V * W3, mouthY = EYE_Y - traits.mouth.y * V * W3;
const params = {
  shape: { ...Object.fromEntries(C.SHAPE_CONTROLS.map((k) => [k, 0])), ...best.w,
    noseWidth: clamp((traits.nose.halfWidth * W3 - 0.045) / 0.02, R.shape), noseLength: clamp((lm.nose.c[1] - noseY) / 0.012, R.shape), noseSize: 0.3, lipFull: -0.4 },
  eyes: { scale, spacing, openness, lidRest: 0.24, tilt: -0.04, iris: "#1f1714", irisSize: 1, crease: 0.35 },
  brows: { height: clamp((browOff - 0.066) / 0.02, R.brows.height), thickness: clamp((traits.brows.thickness * W3) / 2 / (0.0135 * 1.1), R.brows.thickness)   /* a feature SIZE: not compressed */, arch: 0.1, tilt: -0.1,
    length: clamp((bo - bi) / 0.19, R.brows.length), gap: clamp((bi - (exNow - 0.1)) / 0.02, R.brows.gap), color: "#1c1513" },
  lips: { width: clamp(traits.mouth.halfWidth * W3 / 0.056, R.lips.width), upper: 0.55, lower: 0.6, bow: 0.2, color: "#c4836f",
    offset: clamp((mouthY - lm.mouth.c[1]) / 0.025, R.lips.offset), smile: 0.45, line: 1, under: traits.chinMarks.length ? 1 : 0 },
  nose: { nostril: 1 }, cheeks: { blush: 0.2 },
  facialHair: { stubble: 0, mustache: 0, chin: 0, color: "#1a1616" },
  // the illustration's lit skin, pushed warmer so it survives VO lighting/tone mapping as the same peach
  skin: "#fbbd92",
};
const round = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === "number" ? +v.toFixed(3) : v)));
const out = round(params);
console.log(JSON.stringify(out));
if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify({ source: traits.source, translation: { W3, span, V }, params: out }, null, 1));
