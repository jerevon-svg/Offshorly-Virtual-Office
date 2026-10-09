// v3/stage1/fadefolds.mjs — SMOOTH FOLD RESOLUTION (FC-ROLLBACK-PATCHWORK, learned): instead of relaxing zones around folded
// triangles (which left crusty patchwork), the displacement Δ = Y − ref is scaled by (1 − proximity), where proximity is a
// smooth field diffused from the fold vertices. Repeats until fold-free (vs the canonical template). Returns fade stats.
import { triNormal } from "../geom.mjs";
export function fadeFolds(tpl, ref, Y, { maxIter = 8, rings = 8, hidden = null, zOnly = null } = {}) {
  // hidden(Y, i) → true for vertices enclosed by a separate module (e.g. the aperture floor inside an eyeball): a triangle with ALL
  // three vertices hidden is never visible, so its orientation vs the template is not a fold (self-intersection QA still applies)
  const n = tpl.n, foldVerts = () => { const bad = []; for (let t = 0; t < tpl.I.length / 3; t++) { const i0 = tpl.I[t * 3], i1 = tpl.I[t * 3 + 1], i2 = tpl.I[t * 3 + 2]; if (hidden && hidden(Y, i0) && hidden(Y, i1) && hidden(Y, i2)) continue;
    // zOnly: vertices a module moved ONLY along z (a front-plane height field, e.g. eye sockets) — the true fold test there is
    // inversion of the FRONT-PROJECTED triangle; steep socket walls vs an oblique template normal are not folds (FC-SOCKET-WALL-FOLD)
    if (zOnly && zOnly[i0] && zOnly[i1] && zOnly[i2]) { const pr = (P) => (P[i1 * 3] - P[i0 * 3]) * (P[i2 * 3 + 1] - P[i0 * 3 + 1]) - (P[i1 * 3 + 1] - P[i0 * 3 + 1]) * (P[i2 * 3] - P[i0 * 3]); if (pr(ref) * pr(Y) < 0) bad.push(i0, i1, i2); continue; }
    const a = triNormal(tpl.P, tpl.I, t), b = triNormal(Y, tpl.I, t); if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] < 0) bad.push(i0, i1, i2); } return bad; };
  let bad = foldVerts(), it = 0, faded = 0; const first = new Set(bad).size;
  while (bad.length && it < maxIter) { it++; let p = new Float32Array(n); for (const i of bad) p[i] = 1;
    for (let k = 0; k < rings; k++) { const T = p.slice(); for (let i = 0; i < n; i++) { const nb = tpl.nb[i]; if (!nb.length) continue; let a = 0, m = T[i]; for (const j of nb) { a += T[j]; m = Math.max(m, T[j]); } p[i] = Math.max(T[i], 0.5 * (a / nb.length) + 0.5 * m * 0.85); } }
    for (let i = 0; i < n; i++) if (p[i] > 1e-3) { faded++; const s = 1 - Math.min(1, p[i]); for (let q = 0; q < 3; q++) Y[i * 3 + q] = ref[i * 3 + q] + s * (Y[i * 3 + q] - ref[i * 3 + q]); }
    bad = foldVerts(); }
  return { ok: !bad.length, firstFoldVerts: first, iterations: it, fadedVerts: faded };
}
