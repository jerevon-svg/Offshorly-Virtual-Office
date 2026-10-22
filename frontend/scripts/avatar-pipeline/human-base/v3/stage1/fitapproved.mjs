// v3/stage1/fitapproved.mjs — STYLE CALIBRATION: dense fit of the canonical topology to ONE approved HumanBase head (V3
// fit3D: landmark warp + bi-Laplacian-regularised non-rigid fit, fold-free). Output = that head's sculpture expressed on the
// shared canonical vertices — calibration data only, never an employee answer. From frontend/:
//   node scripts/avatar-pipeline/human-base/v3/stage1/fitapproved.mjs <who>
import fs from "node:fs";
import { loadTemplate, fit3D } from "../fit.mjs";
import { load3D } from "../evidence.mjs";
const who = process.argv[2], O = "scripts/avatar-pipeline/output/human-base/stage1-proof/approved-fits", out = `${O}/${who}.json`;
if (fs.existsSync(out)) { console.log(`${who}: cached`); process.exit(0); }
const t0 = Date.now(), tpl = loadTemplate(), ev = await load3D(`public/avatars/human-base-v1/production/${who}-v1.glb`), fit = fit3D(tpl, ev);
fs.mkdirSync(O, { recursive: true }); fs.writeFileSync(out, JSON.stringify({ who, folds: fit.flipped, accepted: fit.accepted, finalResidual: fit.log.at(-1)?.meanD, landmarks: ev.fitLandmarks ?? null, X: Array.from(fit.X, (v) => +v.toFixed(5)) }));
console.log(`${who}: fitted folds ${fit.flipped} residual ${fit.log.at(-1)?.meanD?.toFixed(4)} ${Date.now() - t0} ms`);
