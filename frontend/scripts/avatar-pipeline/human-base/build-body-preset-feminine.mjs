// build-body-preset-feminine.mjs — the reusable FEMININE HumanBase body preset. ZERO CREDITS.
//
//   node scripts/avatar-pipeline/human-base/build-body-preset-feminine.mjs
//
// Same file, same skeleton (joint names, rest transforms, inverse bind matrices), same clip library, same skin weights,
// same UVs, same regions — only the bind-pose SURFACE of the body moves, by restrained smooth fields:
//   · upper torso under the armpits narrower, waist narrower and slightly shallower (softer waist transition);
//   · hips/pelvis slightly wider, blending into the thigh tops;
//   · shoulder tops slightly rounded (sloped) without moving the arm root (the arms attach exactly where they did);
//   · upper arms / forearms slightly slimmer around their own bone axis.
// Hands, feet, neck, head boundary and every socket are untouched. Not an employee: any employee can select it.
import fs from "node:fs";
import { draco, prune } from "@gltf-transform/functions";
import * as C from "../../../src/dev/vo3d/human/humanBaseContract.ts";
import { BASE_OUT, computeNormals, io, weldNormals } from "./lib.mjs";

import { FEMININE, presetDisplace } from "../../../src/dev/vo3d/human/humanBodyPresets.ts";
const doc = await io.read(`${BASE_OUT}/human-base.glb`);
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const POS = prim.getAttribute("POSITION"), P = Float32Array.from(POS.getArray()), REG = prim.getAttribute("_REGION").getArray(), I = prim.getIndices().getArray();
const n = P.length / 3, R = C.BODY_REGIONS, P0 = Float32Array.from(P);
const joints = Object.fromEntries(doc.getRoot().listSkins()[0].listJoints().map((j) => { const m = j.getWorldMatrix(); return [j.getName(), [m[12], m[13], m[14]]]; }));
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const J = { spineZ: joints.Spine02[2], armL: joints.LeftArm, handL: joints.LeftHand, armR: joints.RightArm, handR: joints.RightHand };
const partOf = (r) => (r === R.CHEST ? "chest" : [R.BELLY, R.PELVIS, R.THIGH_L, R.THIGH_R].includes(r) ? "torso" : [R.UPPERARM_L, R.FOREARM_L].includes(r) ? "armL" : [R.UPPERARM_R, R.FOREARM_R].includes(r) ? "armR" : "none");
const torso = new Set([R.CHEST, R.BELLY, R.PELVIS, R.THIGH_L, R.THIGH_R]);
let moved = 0;
// the same continuous field the garments get (hands, feet, neck and head lie outside it: y/x ranges)
for (let i = 0; i < n; i++) { const r = Math.round(REG[i]); if (r === R.NECK || r === R.HAND_L || r === R.HAND_R || r === R.FOOT_L || r === R.FOOT_R) continue; const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]; if (presetDisplace("feminine", p, null, J)) moved++; P.set(p, i * 3); }
POS.setArray(P);
prim.getAttribute("NORMAL").setArray(weldNormals(P, computeNormals(P, I)));
// measurements: half-widths per height, standard → feminine
const widthAt = (A, y, regs) => { let m = 0; for (let i = 0; i < n; i++) if (regs.has(Math.round(REG[i])) && Math.abs(A[i * 3 + 1] - y) < 0.008) m = Math.max(m, Math.abs(A[i * 3])); return m * 2; };
const report = {}; for (const [k, y] of [["shoulderTop", 0.76], ["underArm", 0.62], ["waist", 0.53], ["hips", 0.43]]) { const a = widthAt(P0, y, torso), b = widthAt(P, y, torso); report[k] = { y, standard: +a.toFixed(3), feminine: +b.toFixed(3), change: `${((b / a - 1) * 100).toFixed(1)}%` }; }
let hMin = 9, hMax = -9; for (let i = 0; i < n; i++) { hMin = Math.min(hMin, P[i * 3 + 1]); hMax = Math.max(hMax, P[i * 3 + 1]); }
report.bodyHeight = { standard: +(Math.max(...Array.from({ length: n }, (_, i) => P0[i * 3 + 1])) - Math.min(...Array.from({ length: n }, (_, i) => P0[i * 3 + 1]))).toFixed(4), feminine: +(hMax - hMin).toFixed(4) };
report.verticesMoved = moved;
doc.getRoot().listNodes().find((q) => q.getName() === "humanbase_body")?.setExtras({ ...(doc.getRoot().listNodes().find((q) => q.getName() === "humanbase_body").getExtras()), bodyPreset: "feminine", presetParams: FEMININE });
await doc.transform(prune(), draco({ method: "edgebreaker", quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeGeneric: 12 }));
await io.write(`${BASE_OUT}/human-base-feminine.glb`, doc);
fs.writeFileSync("scripts/avatar-pipeline/output/human-base/body-preset-feminine.json", JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
