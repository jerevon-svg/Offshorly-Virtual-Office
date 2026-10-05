// build-glasses.mjs — a MODULAR glasses style, authored in FIT SPACE and fitted to any identity at equip time. ZERO CREDITS.
//
//   node scripts/avatar-pipeline/human-base/build-glasses.mjs <identity.glb> <style.json> <accessory-id>
//
// V1.1: the frame is no longer fitted once to one head (V1 placed lenses from eye centres only — on other faces, and even
// on the fitted one after the head contract moved, they sat too low, too wide, floated or cut the face). The STYLE is
// still measured from the employee's approved illustration in units of the illustration's eye separation (lens half
// size, offset, rim, roundness, bridge, temples, colour). The geometry is written in fit space with a `_GFIT` vertex
// attribute (see src/dev/vo3d/human/humanGlasses.ts); positions hold the fit on <identity.glb> (a preview), and the runtime
// refits the same module to whichever identity wears it, from that identity's published `glassesFit` landmarks.
import fs from "node:fs";
import * as C from "../../../src/dev/vo3d/human/humanBaseContract.ts";
import { fitGlassesPositions } from "../../../src/dev/vo3d/human/humanGlasses.ts";
import { computeNormals, io, loadBase, weldNormals, writeModule, BASE_OUT } from "./lib.mjs";

const [idFile, styleFile, outId] = process.argv.slice(2);
const S = JSON.parse(fs.readFileSync(styleFile, "utf8"));
const lm = (await io.read(idFile)).getRoot().listScenes()[0].getExtras().humanIdentity.landmarks;
if (!lm.glassesFit) throw new Error(`${idFile} publishes no glassesFit (rebuild it with chibify V1.1)`);
const se = (t, e) => Math.sign(t) * Math.abs(t) ** (2 / e);
const G = [], I = [];   // G: _GFIT per vertex
const add = (part, a, b, c) => { G.push(part, a, b, c); return G.length / 4 - 1; };
const N = 160, hw = S.lens.halfW, hh = S.lens.halfH, rimW = S.rim.width, rimD = S.rim.depth ?? S.rim.width * 0.8;
const lensC = (sx) => [sx * (0.5 + S.lens.dx), S.lens.dy];
// rims: superellipse outer / inner outline × front / back → a closed rectangular-section ring per lens
for (const sx of [1, -1]) { const [cx, cy] = lensC(sx);
  const ring = (inset, dz) => Array.from({ length: N }, (_, k) => { const a = (k / N) * 2 * Math.PI; return add(0, cx + se(Math.cos(a), S.lens.roundness) * (hw - inset), cy + se(Math.sin(a), S.lens.roundness) * (hh - inset), dz); });
  const L = [ring(0, 0), ring(rimW, 0), ring(rimW, -rimD), ring(0, -rimD)];
  for (let q = 0; q < 4; q++) { const A = L[q], B = L[(q + 1) % 4]; for (let k = 0; k < N; k++) { const k1 = (k + 1) % N; I.push(A[k], B[k], A[k1], A[k1], B[k], B[k1]); } } }
// bridge: an arched bar between the inner rim edges (front-space; it rides the wrapped plane like the rims)
{ const xa = 0.5 + S.lens.dx - hw + rimW * 0.5, M = 24, seg = 8, t = S.bridge.thick, b0 = G.length / 4;
  for (let k = 0; k <= M; k++) { const u = k / M, x = -xa + 2 * xa * u, y = S.bridge.dy + S.bridge.arch * Math.sin(Math.PI * u), z = -rimD * 0.5 + 0.01 * Math.sin(Math.PI * u);
    for (let q = 0; q < seg; q++) { const a = (q / seg) * 2 * Math.PI; add(0, x, y + Math.cos(a) * t, z + Math.sin(a) * t * 0.8); } }
  for (let k = 0; k < M; k++) for (let q = 0; q < seg; q++) { const a = b0 + k * seg + q, b = b0 + k * seg + (q + 1) % seg; I.push(a, a + seg, b, b, a + seg, b + seg); } }
// temples: tubes along the fitted temple path (t = 0 hinge → 1 behind the ear)
for (const part of [1, 2]) { const M = 44, seg = 8, t = S.temple.thick, b0 = G.length / 4;
  for (let k = 0; k <= M; k++) for (let q = 0; q < seg; q++) { const a = (q / seg) * 2 * Math.PI; add(part, k / M, Math.cos(a) * t * 0.6, Math.sin(a) * t); }
  for (let k = 0; k < M; k++) for (let q = 0; q < seg; q++) { const a = b0 + k * seg + q, b = b0 + k * seg + (q + 1) % seg; I.push(a, a + seg, b, b, a + seg, b + seg); } }
const design = { lens: { dx: S.lens.dx, dy: S.lens.dy, halfW: hw, halfH: hh }, hingeX: 0.5 + S.lens.dx + hw - rimW * 0.3, templeY: S.lens.dy + hh * S.temple.yFrac, standoff: S.standoff, wrap: S.wrap, rimDepth: rimD };
const GF = Float32Array.from(G), P = fitGlassesPositions(GF, design, lm.eyes, lm.glassesFit, lm.attach), nv = P.length / 3;
const base = await loadBase(), col = [1, 3, 5].map((k) => parseInt(S.colour.slice(k, k + 2), 16) / 255);
const bytes = await writeModule(`${BASE_OUT}/accessories/${outId}.glb`, base, [{ name: "glasses_frame", P, N: weldNormals(P, computeNormals(P, I)), I, COLOR: Array.from({ length: nv }, () => col).flat(),
  J: new Uint8Array(nv * 4).map((_, k) => (k % 4 === 0 ? base.JI.Head : 0)), W: new Float32Array(nv * 4).map((_, k) => (k % 4 === 0 ? 1 : 0)), extraAttrs: { _GFIT: { type: "VEC4", array: GF } },
  material: { name: "glasses_frame", roughness: 0.35, doubleSided: true } }],
  { humanAccessory: { id: outId, slot: "glasses", base: C.HUMAN_BASE_VERSION, light: 0.3 * col[0] + 0.59 * col[1] + 0.11 * col[2] > 0.75, fit: design, previewFittedTo: idFile.split("/").pop(), style: styleFile.split("/").pop() } }, { compress: false });
console.log(`${outId}: ${I.length / 3} tris · ${(bytes / 1024).toFixed(0)} KB · fit-space design ${JSON.stringify(design)}`);
