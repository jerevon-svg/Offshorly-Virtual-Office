// closure-attachment.mjs — CLOSURE MUST LIE ON THE HEAD IT CLOSES (2026-10-10, universal construction step). ZERO CREDITS.
//
//   node scripts/avatar-pipeline/human-base/closure-attachment.mjs <in.glb> <out.glb>        (a new file; refuses to overwrite)
//
// The skull-base filler (chibify: the canonical donor skull base, inset 4 mm-eq) is selected TRIANGLE BY TRIANGLE by vertical-column
// tests (below the lowest kept skin, inside the cut footprint) and clipped the same way under the jaw. Nothing asks whether a surviving
// piece still sits on the employee's head: where the trimmed skin boundary is jagged (ears, jaw, nape) isolated donor pieces survive
// in the air beside the jaw — skin-toned shards floating in plain sight (2026-10-10: a rejected head's lateral pieces sat 0.040–0.074
// from every surface of its own head; every piece of the approved five within 0.028).
//
// Rule (no name, no island count, no per-person constant): a skull-base piece (connected component) stays when its MEDIAN vertex lies
// within the closure construction's own band of the head it closes — the employee's skin (identity_head / face twin / nape skin) or
// the closure interior. Band = interior margin + donor inset + skull-base inset + the interior's decimation tolerance (chibify
// CHIBI_RULES + optimize-identity; the contract test keeps them identical). A piece farther away closes nothing and is removed whole;
// the interior, hole fills, skin and hair are untouched (the gate's FC-OPEN-HEAD / FC-CLOSURE-EXPOSED re-validate the closed head).
import fs from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { identityParts } from "./visibility.mjs";

export const CLOSURE_BAND = { interiorMargin: 0.01, donorInset: 0.008, skullBaseInset: 0.004, interiorDecimation: 0.01 };
export const BAND = +Object.values(CLOSURE_BAND).reduce((a, b) => a + b, 0).toFixed(4);
const ANCHORS = ["identity_head", "identity_face_twin", "baked_napeskin", "baked_interior"];

/** distance from a point to the nearest triangle of the given parts (uniform grid; exact point-to-triangle); `skip(partIndex,
 *  triangleOffset)` leaves triangles out of one query (a piece measured against everything but itself) */
export function surfaceDistance(parts, cell = 0.02) {
  const g = new Map(), T = [], OWN = [];
  parts.forEach((p, pi) => { for (let t = 0; t < p.I.length; t += 3) { const v = [p.I[t], p.I[t + 1], p.I[t + 2]].map((i) => [p.P[i * 3], p.P[i * 3 + 1], p.P[i * 3 + 2]]), id = T.push(v) - 1; OWN.push([pi, t]);
    const lo = [0, 1, 2].map((k) => Math.floor(Math.min(v[0][k], v[1][k], v[2][k]) / cell)), hi = [0, 1, 2].map((k) => Math.floor(Math.max(v[0][k], v[1][k], v[2][k]) / cell));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) { const k = `${x},${y},${z}`; const L = g.get(k); if (L) L.push(id); else g.set(k, [id]); } } });
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], at = (a, d, s) => [a[0] + s * d[0], a[1] + s * d[1], a[2] + s * d[2]];
  const toTri = (p, [a, b, c]) => {   // closest point on a triangle (Ericson, Real-Time Collision Detection 5.1.5)
    const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap); if (d1 <= 0 && d2 <= 0) return Math.hypot(...ap);
    const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp); if (d3 >= 0 && d4 <= d3) return Math.hypot(...bp);
    const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) return Math.hypot(...sub(p, at(a, ab, d1 / (d1 - d3))));
    const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp); if (d6 >= 0 && d5 <= d6) return Math.hypot(...cp);
    const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) return Math.hypot(...sub(p, at(a, ac, d2 / (d2 - d6))));
    const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return Math.hypot(...sub(p, at(b, sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6)))));
    const den = 1 / (va + vb + vc); return Math.hypot(...sub(p, at(at(a, ab, vb * den), ac, vc * den))); };
  return (p, reach = 0.12, skip = null) => { let m = Infinity; const c = p.map((x) => Math.floor(x / cell)), R = Math.ceil(reach / cell), seen = new Set();
    for (let x = -R; x <= R; x++) for (let y = -R; y <= R; y++) for (let z = -R; z <= R; z++) for (const id of g.get(`${c[0] + x},${c[1] + y},${c[2] + z}`) ?? []) { if (seen.has(id)) continue; seen.add(id); if (skip && skip(OWN[id][0], OWN[id][1])) continue; m = Math.min(m, toTri(p, T[id])); }
    return m; };
}

/** remove the skull-base pieces that do not lie on the head they close (doc edited in place); returns what was removed and the margins */
export function dropDetachedClosure(doc, { band = BAND } = {}) {
  const parts = identityParts(doc), sb = parts.find((p) => p.name === "baked_skullbase"), anchors = parts.filter((p) => ANCHORS.includes(p.name));
  if (!sb || !anchors.length) return { dropped: 0, reason: "no skull base / anchor surface" };
  const dist = surfaceDistance(anchors), P = sb.P, I = sb.I, n = P.length / 3, key = new Map(), wid = new Int32Array(n);
  for (let i = 0; i < n; i++) { const k = `${Math.round(P[i * 3] * 2e4)},${Math.round(P[i * 3 + 1] * 2e4)},${Math.round(P[i * 3 + 2] * 2e4)}`; if (!key.has(k)) key.set(k, i); wid[i] = key.get(k); }
  const par = Int32Array.from({ length: n }, (_, i) => i), find = (x) => { while (par[x] !== x) x = par[x] = par[par[x]]; return x; };
  for (let t = 0; t < I.length; t += 3) { const a = find(wid[I[t]]); par[find(wid[I[t + 1]])] = a; par[find(wid[I[t + 2]])] = a; }
  const pieces = new Map(); for (let t = 0; t < I.length; t += 3) { const r = find(wid[I[t]]); let c = pieces.get(r); if (!c) pieces.set(r, (c = { tris: [], verts: new Set() })); c.tris.push(t); for (let k = 0; k < 3; k++) c.verts.add(wid[I[t + k]]); }
  const drop = new Set(); let keptWorst = 0, droppedNearest = Infinity, droppedPieces = 0;
  for (const c of pieces.values()) { const d = [...c.verts].map((v) => dist([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]])).sort((a, b) => a - b), med = d[(d.length - 1) >> 1];
    if (med > band) { droppedPieces++; droppedNearest = Math.min(droppedNearest, med); for (const t of c.tris) drop.add(t); } else keptWorst = Math.max(keptWorst, med); }
  if (!drop.size) return { dropped: 0, pieces: pieces.size, keptWorstMedian: +keptWorst.toFixed(4), band };
  const keep = []; for (let t = 0; t < I.length; t += 3) if (!drop.has(t)) keep.push(I[t], I[t + 1], I[t + 2]);
  sb.prim.getIndices().setArray(new I.constructor(keep));
  return { dropped: drop.size, droppedPieces, pieces: pieces.size, keptWorstMedian: +keptWorst.toFixed(4), droppedNearestMedian: +droppedNearest.toFixed(4), band };
}

if (process.argv[1]?.endsWith("closure-attachment.mjs")) {
  const [inF, out] = process.argv.slice(2); if (!inF || !out) { console.error("usage: closure-attachment.mjs <in.glb> <out.glb>"); process.exit(2); }
  if (fs.existsSync(out)) { console.error(`refused: ${out} exists (a new file only)`); process.exit(1); }
  const { createRequire } = await import("node:module"), draco3d = createRequire(import.meta.url)("draco3dgltf");
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "draco3d.decoder": await draco3d.createDecoderModule() });
  const doc = await io.read(inF), r = dropDetachedClosure(doc); for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName === "KHR_draco_mesh_compression") e.dispose();
  await io.write(out, doc); console.log(`closure attachment: ${JSON.stringify(r)} → ${out}`);
}
