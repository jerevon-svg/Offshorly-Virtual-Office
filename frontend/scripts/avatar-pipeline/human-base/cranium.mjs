// cranium.mjs — THE CRANIUM : FACE RELATION (2026-10-13). ONE definition shared by chibify's canonical-cranium rule, its calibration
// (calibrate-cranium.mjs) and the mounted gate's FC-HEAD-ENVELOPE skull height (src/dev/vo3d/human/gate/mountedGate.ts mountedMetrics):
//   R = (identity skin top − chin) / (eye line − chin), in the identity head's own frame, chin = the gate's fixed chin point (y 0.805)
// The automatic mount scales the head about the Head joint until its face length sits in the approved band, so the gate's skull
// height / body is R × face length / body: a cranium tall for its face (a chibi reference's) is what pushes the skull past it.
import fs from "node:fs";

export const GATE_CHIN_Y = 0.805;   // mountedGate.ts: chin = pt([0, 0.805, 0.3])
export const CALIBRATION = "scripts/avatar-pipeline/human-base/cranium-calibration.json";

/** R of a built identity head (a glTF-Transform Document): skin top = the highest vertex of the identity_head mesh (the scalp under
 *  any hair — what the gate calls the skin top), eye line = the mean of the two eye landmarks */
export function craniumRatio(doc) {
  const lm = doc.getRoot().listScenes()[0]?.getExtras()?.humanIdentity?.landmarks;
  if (!lm?.eyes?.l || !lm?.eyes?.r) throw new Error("cranium: the head carries no eye landmarks");
  let skinTop = -Infinity;
  for (const m of doc.getRoot().listMeshes()) { if (m.getName() !== "identity_head") continue;
    for (const p of m.listPrimitives()) { const a = p.getAttribute("POSITION")?.getArray(); if (a) for (let i = 1; i < a.length; i += 3) skinTop = Math.max(skinTop, a[i]); } }
  if (!Number.isFinite(skinTop)) throw new Error("cranium: no identity_head mesh");
  const eyeY = (lm.eyes.l[1] + lm.eyes.r[1]) / 2;
  return { skinTop: +skinTop.toFixed(4), eyeY: +eyeY.toFixed(4), R: +((skinTop - GATE_CHIN_Y) / (eyeY - GATE_CHIN_Y)).toFixed(4) };
}

/** the approved family's maximum R (calibration data, measured on the approved production heads by calibrate-cranium.mjs) */
export function craniumMax(file = CALIBRATION) {
  const c = JSON.parse(fs.readFileSync(file, "utf8")); if (!(c.max > 1)) throw new Error(`cranium calibration has no maximum (${file})`); return c.max;
}
