// v3/stage1/delta.mjs — DELTA GLBs: each head coloured by its signed NORMAL displacement from the shared style prior
// (red = outward / added volume, blue = inward / removed; white = unchanged) — and by total displacement magnitude.
//   node scripts/avatar-pipeline/human-base/v3/stage1/delta.mjs <id,id,...>
import fs from "node:fs";
import { Document } from "@gltf-transform/core";
import { io } from "../../lib.mjs";
import { loadTemplate } from "../fit.mjs";
import { vertexNormals } from "../geom.mjs";
const tpl = loadTemplate(), O = "scripts/avatar-pipeline/output/human-base/stage1-proof", base = Float32Array.from(JSON.parse(fs.readFileSync(`${O}/base2.json`, "utf8")).P), NB = vertexNormals(base, tpl.I);
const R = 0.025, div = (t) => { const u = Math.max(-1, Math.min(1, t)); return u >= 0 ? [1, 1 - 0.85 * u, 1 - 0.85 * u] : [1 + 0.85 * u, 1 + 0.6 * u, 1]; }, seq = (t) => { const u = Math.min(1, t); return [1 - 0.1 * u, 1 - 0.75 * u, 1 - 0.95 * u]; };
async function glb(P, C, f) { const doc = new Document(), buf = doc.createBuffer(), prim = doc.createPrimitive().setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(P).setBuffer(buf)).setAttribute("COLOR_0", doc.createAccessor().setType("VEC3").setArray(C).setBuffer(buf)).setIndices(doc.createAccessor().setType("SCALAR").setArray(Uint32Array.from(tpl.I)).setBuffer(buf));
  doc.createScene().addChild(doc.createNode("identity_head").setMesh(doc.createMesh("identity_head").addPrimitive(prim))); await io.write(f, doc); }
const stats = {};
for (const w of process.argv[2].split(",")) { const X = Float32Array.from(JSON.parse(fs.readFileSync(`${O}/${w}/V/pass1/qa-geometry.json`, "utf8")).X), Cs = new Float32Array(X.length), Cm = new Float32Array(X.length); let sn = 0, sm = 0, mx = 0, c = 0;
  for (let i = 0; i < tpl.n; i++) { const d = [0, 1, 2].map((q) => X[i * 3 + q] - base[i * 3 + q]), s = d[0] * NB[i * 3] + d[1] * NB[i * 3 + 1] + d[2] * NB[i * 3 + 2], m = Math.hypot(...d);
    Cs.set(div(s / R), i * 3); Cm.set(seq(m / (2 * R)), i * 3); if (NB[i * 3 + 2] > 0.2) { sn += s * s; sm += m * m; mx = Math.max(mx, Math.abs(s)); c++; } }
  stats[w] = { rmsNormal: +Math.sqrt(sn / c).toFixed(4), rmsTotal: +Math.sqrt(sm / c).toFixed(4), maxAbsNormal: +mx.toFixed(4) };
  await glb(X, Cs, `${O}/clay/${w}-delta-normal.glb`); await glb(X, Cm, `${O}/clay/${w}-delta-total.glb`); }
fs.writeFileSync(`${O}/delta-stats.json`, JSON.stringify(stats, null, 1)); console.log(JSON.stringify(stats));
