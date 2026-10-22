// isolate-head.mjs — A FULL-BODY MESHY FIGURE → ITS HEAD, as a head-only raw (2026-10-13). ZERO CREDITS. The paid raw is only read:
// the head is a DERIVED file beside it (never over it) with its provenance. Generic — nothing here names a person:
//   detect  measured AROUND THE HEAD'S VERTICAL AXIS (profileOf), so long hair never hides the neck: the first constriction under the
//           head is the neck; a FULL BODY's lies in the middle of the figure (35–58 % from the top: a chibi body is about as tall as its
//           head), a head-only Meshy result's low (≥ 64 % on every raw head on disk — a neck stump, bust or plinth below it)
//   cut     at that neck; every triangle with a corner below it is dropped and the unused vertices with it
//   frame   the head is re-framed exactly like a head-only Meshy result (bounding box centred, its largest side the same normalized
//           size) by ONE uniform scale + translation — geometry, texture and UVs are the person's own: no sculpting, no identity change
//   node scripts/avatar-pipeline/human-base/isolate-head.mjs <raw.glb> <out.glb>   → last stdout line = JSON { fullBody, … }
import fs from "node:fs";
import crypto from "node:crypto";

export const ISOLATE = { version: 3, slices: 200, sectors: 24, smooth: 5, headZone: 0.5, axisZone: 0.25, neckDrop: 0.5, neckBand: [0.35, 0.58], size: 1.903 };

/** the vertical profile of a point set around the head's vertical axis (the mean x, z of its top quarter), top → down: per slice the
 *  CORE radius (median over angular sectors of the innermost surface — a neck under long hair is still a neck: hair lies outside it)
 *  and the share of EMPTY sectors (between two legs the axis is outside the body; inside a neck, bust or plinth no sector is empty) */
export function profileOf(arrays, o = ISOLATE) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const P of arrays) for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i + k]); hi[k] = Math.max(hi[k], P[i + k]); }
  const H = hi[1] - lo[1]; let ax = 0, az = 0, an = 0;
  for (const P of arrays) for (let i = 0; i < P.length; i += 3) if (hi[1] - P[i + 1] <= o.axisZone * H) { ax += P[i]; az += P[i + 2]; an++; }
  ax /= an; az /= an;
  const S = o.slices, A = o.sectors, minR = new Float64Array(S * A).fill(Infinity);
  for (const P of arrays) for (let i = 0; i < P.length; i += 3) {
    const s = Math.min(S - 1, Math.floor(((hi[1] - P[i + 1]) / H) * S)), dx = P[i] - ax, dz = P[i + 2] - az, a = Math.min(A - 1, Math.floor(((Math.atan2(dz, dx) + Math.PI) / (2 * Math.PI)) * A)), r = Math.hypot(dx, dz);
    if (r < minR[s * A + a]) minR[s * A + a] = r; }
  const core = [], empty = [];
  for (let s = 0; s < S; s++) { const rs = []; for (let a = 0; a < A; a++) if (Number.isFinite(minR[s * A + a])) rs.push(minR[s * A + a]); rs.sort((x, y) => x - y);
    empty.push(1 - rs.length / A); core.push(rs.length >= A / 4 ? rs[rs.length >> 1] / H : NaN); }
  return { lo, hi, H, axis: [ax, az], core, empty };
}

const smoothed = (v, w) => v.map((_, i) => { let a = 0, n = 0; for (let j = Math.max(0, i - (w >> 1)); j <= Math.min(v.length - 1, i + (w >> 1)); j++) if (Number.isFinite(v[j])) { a += v[j]; n++; } return n ? a / n : NaN; });

/** the neck: going down from the head's widest core, the FIRST constriction (core below neckDrop × the head's) followed to the
 *  bottom of its dip — the dip ends where the core rises again (above 1.6 × its minimum and 0.02 of the height over it) */
export function neckCut(p, o = ISOLATE) {
  const S = p.core.length, c = smoothed(p.core, o.smooth); let ih = -1;
  for (let i = 0; i < Math.floor(S * o.headZone); i++) if (Number.isFinite(c[i]) && (ih < 0 || c[i] > c[ih])) ih = i;
  if (ih < 0) return null; let i = ih + 1; while (i < S && !(c[i] < o.neckDrop * c[ih])) i++; if (i >= S) return null;
  let iN = i; for (let j = i + 1; j < S; j++) { if (!Number.isFinite(c[j])) continue; if (c[j] <= c[iN]) iN = j; else if (c[j] > Math.max(1.6 * c[iN], c[iN] + 0.02)) break; }
  const at = (iN + 0.5) / S;
  return { slice: iN, y: p.hi[1] - at * p.H, at: +at.toFixed(3), headSlice: ih, neckRatio: +(c[iN] / c[ih]).toFixed(3) };
}

/** full body or head-only: the neck lies in the middle of the figure (neckBand, from the top) — a chibi body under it is about as tall
 *  as the head; a head-only Meshy result's neck is low (its neck stump, bust or plinth is a third of the height at most) */
export function detectFullBody(p, o = ISOLATE) {
  const cut = neckCut(p, o), fullBody = !!cut && cut.at >= o.neckBand[0] && cut.at <= o.neckBand[1];
  return { fullBody, neckAt: cut?.at ?? null, neckRatio: cut?.neckRatio ?? null };
}

/** keep the triangles wholly above y and only the vertices they use (every attribute and the indices are rewritten) */
function keepAbove(prim, y) {
  const pos = prim.getAttribute("POSITION").getArray(), idx = prim.getIndices()?.getArray(), n = pos.length / 3;
  const tri = idx ?? Uint32Array.from({ length: n }, (_, i) => i), map = new Int32Array(n).fill(-1), kept = []; let m = 0, dropped = 0;
  for (let t = 0; t < tri.length; t += 3) { const a = tri[t], b = tri[t + 1], c = tri[t + 2]; if (pos[a * 3 + 1] < y || pos[b * 3 + 1] < y || pos[c * 3 + 1] < y) { dropped++; continue; }
    for (const v of [a, b, c]) { if (map[v] < 0) map[v] = m++; kept.push(map[v]); } }
  for (const sem of prim.listSemantics()) { const acc = prim.getAttribute(sem), src = acc.getArray(), sz = acc.getElementSize(), out = new src.constructor(m * sz);
    for (let v = 0; v < n; v++) if (map[v] >= 0) for (let k = 0; k < sz; k++) out[map[v] * sz + k] = src[v * sz + k]; acc.setArray(out); }
  const ia = prim.getIndices(); if (ia) ia.setArray(m > 65535 ? Uint32Array.from(kept) : Uint16Array.from(kept)); return { kept: kept.length / 3, dropped, verts: m };
}

/** isolate the head of a full-body raw into out (a no-op for a head-only raw); reuses an existing derived file made from the same raw */
export async function isolateHead(rawFile, outFile, io) {
  const sha = crypto.createHash("sha256").update(fs.readFileSync(rawFile)).digest("hex"), provFile = outFile.replace(/\.glb$/, ".json");
  const prev = fs.existsSync(provFile) ? JSON.parse(fs.readFileSync(provFile, "utf8")) : null;
  if (prev?.sourceSha256 === sha && prev.version === ISOLATE.version && fs.existsSync(outFile)) return { ...prev, reused: true };
  const doc = await io.read(rawFile), prims = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
  const p = profileOf(prims.map((q) => q.getAttribute("POSITION").getArray())), det = detectFullBody(p);
  if (!det.fullBody) return { fullBody: false, ...det };
  const cut = neckCut(p);
  const stats = prims.map((q) => keepAbove(q, cut.y));
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const q of prims) { const P = q.getAttribute("POSITION").getArray(); for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i + k]); hi[k] = Math.max(hi[k], P[i + k]); } }
  const c = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2), s = ISOLATE.size / Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  for (const q of prims) { const acc = q.getAttribute("POSITION"), P = acc.getArray().slice(); for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) P[i + k] = (P[i + k] - c[k]) * s; acc.setArray(P); }
  fs.mkdirSync(outFile.slice(0, outFile.lastIndexOf("/")), { recursive: true }); await io.write(outFile, doc);
  const rec = { version: ISOLATE.version, fullBody: true, source: rawFile, sourceSha256: sha, out: outFile, outSha256: crypto.createHash("sha256").update(fs.readFileSync(outFile)).digest("hex"),
    ...det, cut, kept: stats.reduce((a, x) => a + x.kept, 0), dropped: stats.reduce((a, x) => a + x.dropped, 0), frame: { centre: c.map((v) => +v.toFixed(5)), scale: +s.toFixed(6) }, madeAt: new Date().toISOString() };
  fs.writeFileSync(provFile, JSON.stringify(rec, null, 1)); return rec;
}

if (process.argv[1]?.endsWith("isolate-head.mjs")) {
  const [raw, out] = process.argv.slice(2); if (!raw || !out || !fs.existsSync(raw)) { console.error("usage: isolate-head.mjs <raw.glb> <out.glb>"); process.exit(2); }
  const { io } = await import("./lib.mjs");
  console.log(JSON.stringify(await isolateHead(raw, out, io)));
}
