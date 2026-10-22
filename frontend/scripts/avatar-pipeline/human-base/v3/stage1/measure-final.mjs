// v3/stage1/measure-final.mjs — re-measures the FINAL built head with the IPM definitions (proportions.mjs measure3D): visible eye
// openings (front z-buffer where the eyeball is front-most), nostril line (same definition as the approved calibration), menton,
// silhouette widths (ears excluded). Nose/mouth widths + brow use the pipeline landing (flagged). Passing Stage 0 math is
// meaningless unless the final mesh still measures right after every deformation.
import fs from "node:fs";
import { io } from "../../lib.mjs";
import { loadTemplate } from "../fit.mjs";
import { HD_FILE } from "./hd.mjs";
import { measure3D, subnasale, faceOutlineX, mentonY } from "./proportions.mjs";
/** light loader (surface QA, diagnostics): final head in HD index space + the few levels it needs; no identity measurement */
export async function loadFinal(dir) { const bj = JSON.parse(fs.readFileSync(`${dir}/build.json`, "utf8")), file = fs.readdirSync(dir).find((f) => f.endsWith(".glb")), doc = await io.read(`${dir}/${file}`);
  const ex = doc.getRoot().listScenes()[0].getExtras().humanIdentity, head = doc.getRoot().listMeshes().find((m) => m.getName() === "identity_head").listPrimitives()[0].getAttribute("POSITION").getArray();
  const T = loadTemplate(HD_FILE), n = T.n, X = new Float32Array(n * 3); for (let j = 0; j < T.uv.src.length; j++) X.set(head.subarray(j * 3, j * 3 + 3), T.uv.src[j] * 3);
  const balls = ex.landmarks?.eyes?.balls ?? [], lm = bj.layout.landing, eL = T.landmarks.eyeL, eR = T.landmarks.eyeR, bR = balls.find((b) => b.c[0] < 0) ?? { c: [X[eR * 3], X[eR * 3 + 1]] }, bL = balls.find((b) => b.c[0] > 0) ?? { c: [X[eL * 3], X[eL * 3 + 1]] }, mouthY = lm.mouthC[1];
  const sn = subnasale(X, n, X[T.landmarks.noseTip * 3 + 1], X[T.landmarks.noseTip * 3 + 2], mouthY); const chinY = mentonY(X, n, mouthY);
  return { X, T, bj, balls, g3: { eyeY: (bR.c[1] + bL.c[1]) / 2, cR: [bR.c[0], bR.c[1]], cL: [bL.c[0], bL.c[1]], mouthY, noseY: sn ? sn.y : mouthY, chinY } }; }
export async function measureFinal(dir) { const bj = JSON.parse(fs.readFileSync(`${dir}/build.json`, "utf8")), file = fs.readdirSync(dir).find((f) => f.endsWith(".glb")), doc = await io.read(`${dir}/${file}`);
  const ex = doc.getRoot().listScenes()[0].getExtras().humanIdentity, head = doc.getRoot().listMeshes().find((m) => m.getName() === "identity_head").listPrimitives()[0].getAttribute("POSITION").getArray();
  const T = loadTemplate(HD_FILE), n = T.n, X = new Float32Array(n * 3); for (let j = 0; j < T.uv.src.length; j++) X.set(head.subarray(j * 3, j * 3 + 3), T.uv.src[j] * 3);
  const balls = ex.landmarks.eyes.balls, RG = T.REGION, lm = bj.layout.landing;
  // visible eye openings
  const ey0 = (balls[0].c[1] + balls[1].c[1]) / 2, RES = 0.0012, x0 = -0.36, y0 = ey0 - 0.14, NX = Math.round(0.72 / RES), NY = Math.round(0.28 / RES), Z = new Float32Array(NX * NY).fill(-9), I = T.I;
  for (let t = 0; t < I.length / 3; t++) { const P = [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]].map((i) => [(X[i * 3] - x0) / RES, (X[i * 3 + 1] - y0) / RES, X[i * 3 + 2]]);
    const mnx = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0]))), mxx = Math.min(NX - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0]))), mny = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1]))), mxy = Math.min(NY - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1]))); if (mnx > mxx || mny > mxy) continue;
    const den = (P[1][1] - P[2][1]) * (P[0][0] - P[2][0]) + (P[2][0] - P[1][0]) * (P[0][1] - P[2][1]); if (Math.abs(den) < 1e-12) continue;
    for (let y = mny; y <= mxy; y++) for (let x = mnx; x <= mxx; x++) { const w0 = ((P[1][1] - P[2][1]) * (x - P[2][0]) + (P[2][0] - P[1][0]) * (y - P[2][1])) / den, w1 = ((P[2][1] - P[0][1]) * (x - P[2][0]) + (P[0][0] - P[2][0]) * (y - P[2][1])) / den, w2 = 1 - w0 - w1; if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue; const z = w0 * P[0][2] + w1 * P[1][2] + w2 * P[2][2], k = y * NX + x; if (z > Z[k]) Z[k] = z; } }
  const ap = balls.map((b) => { let inn = null, out = null; for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) { const px = x0 + x * RES, py = y0 + y * RES, dd = b.r * b.r - (px - b.c[0]) ** 2 - (py - b.c[1]) ** 2; if (dd <= 0 || b.c[2] + Math.sqrt(dd) <= Z[y * NX + x] + 1e-5) continue;
      if (!inn || Math.abs(px) < Math.abs(inn[0])) inn = [px, py]; if (!out || Math.abs(px) > Math.abs(out[0])) out = [px, py]; } return { inn, out, cx: b.c[0] }; });
  const A = ap.find((a) => a.cx < 0), B = ap.find((a) => a.cx > 0), mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], cR = A?.inn ? mid(A.inn, A.out) : [balls.find((b) => b.c[0] < 0).c[0], balls.find((b) => b.c[0] < 0).c[1]], cL = B?.inn ? mid(B.inn, B.out) : [balls.find((b) => b.c[0] > 0).c[0], balls.find((b) => b.c[0] > 0).c[1]], eyeY = (cR[1] + cL[1]) / 2;
  const widthAtX = (y) => faceOutlineX(X, n, T.region, RG.earL, RG.earR, T.centre[2], Math.abs(cR[0] - cL[0]), y, 0.004, T.I);
  const mouthY = lm.mouthC[1], sn = subnasale(X, n, X[T.landmarks.noseTip * 3 + 1], X[T.landmarks.noseTip * 3 + 2], mouthY); const chinY = mentonY(X, n, mouthY);
  const g3 = { eyeY, noseY: sn.y, mouthY, chinY, cR, cL, iR: A?.inn ?? null, oR: A?.out && B?.out ? A.out : null, iL: B?.inn ?? null, oL: A?.out && B?.out ? B.out : null, widthAtX, widthAt: (y) => { const w = widthAtX(y); return w[1] - w[0]; },
    noseW: Math.hypot(lm.wingR[0] - lm.wingL[0], lm.wingR[1] - lm.wingL[1]), mouthW: Math.hypot(lm.mouthR[0] - lm.mouthL[0], lm.mouthR[1] - lm.mouthL[1]), browY: lm.browR && lm.browL ? (lm.browR[1] + lm.browL[1]) / 2 : null };
  return { ...measure3D(g3), g3, X, T, bj }; }
