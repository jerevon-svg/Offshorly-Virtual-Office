// v3/stage1/hd.mjs — CANONICAL HD TOPOLOGY: one deterministic, conforming refinement of the V3 canonical head, the SAME for
// every employee. Level 1 = the whole face (face/eyes/nose/mouth/jaw), level 2 = eyes/nose/mouth (lid margins, alae, lip
// borders need ~2 mm edges; the canonical face is ~7.5 mm). Red-green splitting (1/2/3 split edges → 2/3/4 children) keeps
// the head one closed oriented manifold; UV seams are split per UV edge so the UV atlas is preserved exactly.
// New vertices are edge midpoints, recorded as parents so any canonical-resolution head lifts to HD: lift(X, hd).
//   node scripts/avatar-pipeline/human-base/v3/stage1/hd.mjs      (writes stage1-proof/template-hd.json)
import fs from "node:fs";
import { loadTemplate } from "../fit.mjs";
export const HD_FILE = "scripts/avatar-pipeline/output/human-base/stage1-proof/template-hd.json";

function refine(t, inSet) {
  const P = Array.from(t.P), region = Array.from(t.region), UV = Array.from(t.uv.UV), src = Array.from(t.uv.src), chart = t.uv.chart ? Array.from(t.uv.chart) : null, n0 = P.length / 3, parents = [];
  const key = (a, b) => (a < b ? a * 4194304 + b : b * 4194304 + a), split = new Map(), uvSplit = new Map(), PRI = [t.REGION.face, t.REGION.jaw];
  const I = t.I, UI = t.uv.I, nT = I.length / 3;
  for (let tr = 0; tr < nT; tr++) for (let k = 0; k < 3; k++) { const a = I[tr * 3 + k], b = I[tr * 3 + (k + 1) % 3], kk = key(a, b);
    if (split.has(kk) || !inSet(a, region) || !inSet(b, region)) continue; const m = P.length / 3; split.set(kk, m); parents.push([a, b]);
    for (let q = 0; q < 3; q++) P.push((P[a * 3 + q] + P[b * 3 + q]) / 2);
    region.push(region[a] === region[b] ? region[a] : PRI.includes(region[a]) ? region[a] : PRI.includes(region[b]) ? region[b] : region[a]); }
  const mid = (a, b) => split.get(key(a, b)) ?? -1;
  const uvMid = (ua, ub, m) => { const kk = key(ua, ub); let u = uvSplit.get(kk); if (u === undefined) { u = src.length; uvSplit.set(kk, u); src.push(m); if (chart) chart.push(chart[ua]); UV.push((UV[ua * 2] + UV[ub * 2]) / 2, (UV[ua * 2 + 1] + UV[ub * 2 + 1]) / 2); } return u; };
  const NI = [], NU = [], d2 = (a, b) => (P[a * 3] - P[b * 3]) ** 2 + (P[a * 3 + 1] - P[b * 3 + 1]) ** 2 + (P[a * 3 + 2] - P[b * 3 + 2]) ** 2;
  for (let tr = 0; tr < nT; tr++) {
    const c = [I[tr * 3], I[tr * 3 + 1], I[tr * 3 + 2]], u = [UI[tr * 3], UI[tr * 3 + 1], UI[tr * 3 + 2]];
    if (src[u[0]] !== c[0] || src[u[1]] !== c[1] || src[u[2]] !== c[2]) throw new Error(`uv/pos corner mismatch at tri ${tr}`);
    const m = [0, 1, 2].map((k) => mid(c[k], c[(k + 1) % 3])), ns = m.filter((x) => x >= 0).length;
    const mu = m.map((x, k) => (x >= 0 ? uvMid(u[k], u[(k + 1) % 3], x) : -1));
    const emit = (...tris) => { for (const tt of tris) { NI.push(tt[0][0], tt[1][0], tt[2][0]); NU.push(tt[0][1], tt[1][1], tt[2][1]); } };
    const V = (k) => [c[k], u[k]], Mv = (k) => [m[k], mu[k]];
    if (ns === 0) { emit([V(0), V(1), V(2)]); continue; }
    if (ns === 3) { emit([V(0), Mv(0), Mv(2)], [Mv(0), V(1), Mv(1)], [Mv(2), Mv(1), V(2)], [Mv(0), Mv(1), Mv(2)]); continue; }
    if (ns === 1) { const k = m.findIndex((x) => x >= 0); emit([V(k), Mv(k), V((k + 2) % 3)], [Mv(k), V((k + 1) % 3), V((k + 2) % 3)]); continue; }
    // two split edges: rotate so the UNSPLIT edge is (c, a) = edge index 2 after rotation
    const s = m.findIndex((x) => x < 0), r = (s + 1) % 3, A = V(r), B = V((r + 1) % 3), Cc = V((r + 2) % 3), M1 = Mv(r), M2 = Mv((r + 1) % 3);
    emit([M1, B, M2]); if (d2(A[0], M2[0]) <= d2(M1[0], Cc[0])) emit([A, M1, M2], [A, M2, Cc]); else emit([A, M1, Cc], [M1, M2, Cc]);
  }
  return { P, I: NI, region, uv: { ...t.uv, src, UV, I: NU, ...(chart ? { chart } : {}) }, parents, n0 };
}

export function buildHD() {
  const t = loadTemplate(), R = t.REGION, L1 = new Set([R.face, R.eyeL, R.eyeR, R.nose, R.mouth, R.jaw]), L2 = new Set([R.eyeL, R.eyeR, R.nose, R.mouth]);
  const a = refine(t, (i, reg) => L1.has(reg[i]));
  const t1 = { ...t, P: a.P, I: a.I, region: a.region, uv: a.uv };
  const b = refine(t1, (i, reg) => L2.has(reg[i]));
  // mirror map: canonical mirror pairs extend to midpoints of mirrored parents (refinement sets are symmetric by region)
  const parents = [...a.parents, ...b.parents], n = b.P.length / 3, mirror = new Int32Array(n).fill(-1), base = t.n;
  if (Array.isArray(t.mirror) && t.mirror.length === base) for (let i = 0; i < base; i++) mirror[i] = t.mirror[i];
  const pk = new Map(); parents.forEach(([p, q], j) => pk.set(p < q ? `${p},${q}` : `${q},${p}`, base + j));
  parents.forEach(([p, q], j) => { const mp = mirror[p], mq = mirror[q]; if (mp >= 0 && mq >= 0) mirror[base + j] = pk.get(mp < mq ? `${mp},${mq}` : `${mq},${mp}`) ?? -1; });
  const out = { ...JSON.parse(fs.readFileSync("scripts/avatar-pipeline/output/human-base/v3-proof/template/canonical-head-v3p.json", "utf8")) };
  Object.assign(out, { id: `${t.id}-hd2`, P: b.P.map((v) => +v.toFixed(6)), I: b.I, region: b.region, uv: { ...b.uv, I: b.uv.I }, mirror: Array.from(mirror), hd: { baseN: base, parents, levels: { L1: [...L1], L2: [...L2] } } });
  return out;
}
/** lift a canonical-resolution head X (n0×3) to the HD topology by the recorded midpoint parents */
export function lift(X, hd) { const n0 = hd.hd.baseN, par = hd.hd.parents, Y = new Float32Array((n0 + par.length) * 3); Y.set(X.subarray(0, n0 * 3));
  for (let j = 0; j < par.length; j++) { const [a, b] = par[j], m = n0 + j; for (let q = 0; q < 3; q++) Y[m * 3 + q] = (Y[a * 3 + q] + Y[b * 3 + q]) / 2; } return Y; }

import { pathToFileURL } from "node:url";
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const hd = buildHD(); fs.writeFileSync(HD_FILE, JSON.stringify(hd));
  const t = loadTemplate(HD_FILE), e = new Map(); let bad = 0; for (let tr = 0; tr < t.I.length / 3; tr++) for (let k = 0; k < 3; k++) { const a = t.I[tr * 3 + k], b = t.I[tr * 3 + (k + 1) % 3], kk = `${a},${b}`; if (e.has(kk)) bad++; e.set(kk, 1); }
  let open = 0; for (const kk of e.keys()) { const [a, b] = kk.split(","); if (!e.has(`${b},${a}`)) open++; }
  console.log(`HD template: verts ${t.n} (base ${hd.hd.baseN}) · tris ${t.I.length / 3} · uv verts ${t.uv.src.length} · open edges ${open} · duplicate directed edges ${bad} · mirror ${hd.mirror.filter((m) => m >= 0).length}/${t.n}`);
}
