// vo3d human — THE MOUNTED GATE'S MEASUREMENTS (HumanBase failure registry, final stage). Evidence on the FINAL avatar as
// production builds it: the optimised identity on the shared runtime (HumanAvatar.create) with the real body preset,
// uniform, accessories and HEAD_MOUNT scale/pitch, in its bind pose. Pure measurement — the registry
// (scripts/avatar-pipeline/human-base/failure-registry.mjs) owns thresholds and verdicts. Nothing here knows a name.
import * as THREE from "three";
import type { HumanAvatar } from "../HumanAvatar";

/** the low / rear / neck camera set the closure is visible from in play (az: 0 = front, el: + = above) */
export const GATE_VIEWS: Readonly<Record<string, { az: number; el: number }>> = {
  rear: { az: 180, el: 6 }, rear34L: { az: 140, el: 6 }, rear34R: { az: -140, el: 6 }, sideL: { az: 90, el: 2 }, sideR: { az: -90, el: 2 },
  lowRear: { az: 170, el: -38 }, lowSideL: { az: 100, el: -30 }, lowSideR: { az: -100, el: -30 }, lowFront: { az: 10, el: -38 }, under: { az: 0, el: -80 },
  neckFront: { az: 0, el: -8 }, neckBack: { az: 180, el: -10 },
};

type Kind = "closure" | "identity" | "occluder";
type Soup = { P: Float32Array; I: ArrayLike<number>; kind: Kind; part: string };

/** world-space triangle soup of everything drawn (skinned meshes skinned in their current — bind — pose) */
export function worldSoup(root: THREE.Object3D): Soup[] {
  root.updateMatrixWorld(true); const out: Soup[] = []; const v = new THREE.Vector3();
  root.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh || !m.visible) return;
    const g = m.geometry, pos = g.getAttribute("position"), idx = g.getIndex(); if (!pos) return;
    const P = new Float32Array(pos.count * 3), sk = (m as THREE.SkinnedMesh).isSkinnedMesh ? (m as THREE.SkinnedMesh) : null;
    for (let i = 0; i < pos.count; i++) { if (sk) sk.getVertexPosition(i, v); else v.fromBufferAttribute(pos, i); v.applyMatrix4(m.matrixWorld); P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z; }
    const part = m.name.split(":").pop() ?? m.name, isId = m.name.startsWith("identity:");
    const kind: Kind = isId && /^baked_(interior|skullbase)/.test(part) ? "closure" : isId ? "identity" : "occluder";
    out.push({ P, I: idx ? idx.array : Array.from({ length: pos.count }, (_, i) => i), kind, part }); });
  return out;
}

/** orthographic z-buffer per view: of the head pixels below the eye line, the share whose FIRST surface is closure */
export function closureExposure(soup: Soup[], region: { yMin: number; eyeY: number; centre: THREE.Vector3; half: number }, res = 220): { pct: number; worstPct: number; views: Record<string, number>; wholeHead: { pct: number; worstPct: number; views: Record<string, number> } } {
  // wholeHead: the same share over EVERY head pixel (no eye-line cut) — closure is never meant to show anywhere, and the
  // below-eye-line region alone was blind to closure exposed on the back of the head through a gap under short hair
  const wv: Record<string, number> = {}; let wBad = 0, wTot = 0, wWorst = 0;
  const views: Record<string, number> = {}; let bad = 0, tot = 0, worst = 0;
  for (const [name, { az, el }] of Object.entries(GATE_VIEWS)) {
    const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180, d = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));   // toward the camera
    const right = new THREE.Vector3(0, 1, 0).cross(d); if (right.lengthSq() < 1e-6) right.set(1, 0, 0); right.normalize(); const up = d.clone().cross(right).normalize();
    const Z = new Float32Array(res * res).fill(-Infinity), K = new Int8Array(res * res).fill(-1), Y = new Float32Array(res * res);
    const proj = (P: Float32Array, i: number): [number, number, number, number] => { const x = P[i * 3] - region.centre.x, y = P[i * 3 + 1] - region.centre.y, z = P[i * 3 + 2] - region.centre.z;
      return [((x * right.x + y * right.y + z * right.z) / region.half * 0.5 + 0.5) * res, ((x * up.x + y * up.y + z * up.z) / region.half * 0.5 + 0.5) * res, x * d.x + y * d.y + z * d.z, P[i * 3 + 1]]; };
    for (const s of soup) { const code = s.kind === "closure" ? 1 : s.kind === "identity" ? 0 : 2;
      for (let t = 0; t < s.I.length; t += 3) { const A = proj(s.P, s.I[t]), B = proj(s.P, s.I[t + 1]), C = proj(s.P, s.I[t + 2]);
        if (Math.max(A[3], B[3], C[3]) < region.yMin) continue;
        const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0]))), x1 = Math.min(res - 1, Math.ceil(Math.max(A[0], B[0], C[0]))), y0 = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1]))), y1 = Math.min(res - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
        const ar = (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]); if (Math.abs(ar) < 1e-9) continue;
        for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) { const qx = px + 0.5, qy = py + 0.5;
          const w0 = ((B[0] - qx) * (C[1] - qy) - (C[0] - qx) * (B[1] - qy)) / ar, w1 = ((C[0] - qx) * (A[1] - qy) - (A[0] - qx) * (C[1] - qy)) / ar, w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue; const z = w0 * A[2] + w1 * B[2] + w2 * C[2], k = py * res + px;
          if (z > Z[k]) { Z[k] = z; K[k] = code; Y[k] = w0 * A[3] + w1 * B[3] + w2 * C[3]; } } } }
    let vb = 0, vt = 0, ab = 0, at = 0; for (let k = 0; k < res * res; k++) { if (K[k] < 0 || K[k] === 2) continue; at++; if (K[k] === 1) ab++; if (Y[k] > region.eyeY) continue; vt++; if (K[k] === 1) vb++; }
    wv[name] = +(100 * ab / Math.max(1, at)).toFixed(2); wBad += ab; wTot += at; wWorst = Math.max(wWorst, ab / Math.max(1, at));
    views[name] = +(100 * vb / Math.max(1, vt)).toFixed(2); bad += vb; tot += vt; worst = Math.max(worst, vb / Math.max(1, vt)); }
  return { pct: +(100 * bad / Math.max(1, tot)).toFixed(2), worstPct: +(100 * worst).toFixed(2), views, wholeHead: { pct: +(100 * wBad / Math.max(1, wTot)).toFixed(2), worstPct: +(100 * wWorst).toFixed(2), views: wv } };
}

/** VISIBLE SURFACE INTEGRITY: per view, an orthographic label image of the head (identity skin / identity hair / closure;
 *  the body + garments occlude) and the small ISLANDS in it — hair specks or teeth over skin, skin specks or strips showing
 *  through hair. A clean head shows two large continuous regions with an intentional boundary; shredded classification
 *  edges, hair triangles cutting through an ear and skin remnants under a hairline all show up as many small islands.
 *  Measured where the camera sees it, in the final mounted avatar — hidden residue is not a defect. */
export function surfaceIslands(soup: Soup[], region: { yMin: number; centre: THREE.Vector3; half: number }, res = 320, maxIslandPx = 60): { islandsPerView: Record<string, number>; islandPx: Record<string, number>; worst: number; worstPx: number; total: number; capPct: Record<string, number>; capWorstPct: number } {
  const per: Record<string, number> = {}, perPx: Record<string, number> = {}, cap: Record<string, number> = {}; let worst = 0, worstPx = 0, total = 0, capWorst = 0;
  for (const [name, { az, el }] of Object.entries(GATE_VIEWS)) {
    const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180, d = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
    const right = new THREE.Vector3(0, 1, 0).cross(d); if (right.lengthSq() < 1e-6) right.set(1, 0, 0); right.normalize(); const up = d.clone().cross(right).normalize();
    const Z = new Float32Array(res * res).fill(-Infinity), K = new Int8Array(res * res).fill(-1);
    const proj = (P: Float32Array, i: number): [number, number, number, number] => { const x = P[i * 3] - region.centre.x, y = P[i * 3 + 1] - region.centre.y, z = P[i * 3 + 2] - region.centre.z;
      return [((x * right.x + y * right.y + z * right.z) / region.half * 0.5 + 0.5) * res, ((x * up.x + y * up.y + z * up.z) / region.half * 0.5 + 0.5) * res, x * d.x + y * d.y + z * d.z, P[i * 3 + 1]]; };
    for (const s of soup) { const code = s.kind === "occluder" ? 3 : s.kind === "closure" ? 2 : s.part === "identity_hair_base" ? 4 : /^identity_hair_/.test(s.part) ? 1 : 0;
      for (let t = 0; t < s.I.length; t += 3) { const A = proj(s.P, s.I[t]), B = proj(s.P, s.I[t + 1]), C = proj(s.P, s.I[t + 2]);
        if (Math.max(A[3], B[3], C[3]) < region.yMin) continue;
        const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0]))), x1 = Math.min(res - 1, Math.ceil(Math.max(A[0], B[0], C[0]))), y0 = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1]))), y1 = Math.min(res - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
        const ar = (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]); if (Math.abs(ar) < 1e-9) continue;
        for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) { const qx = px + 0.5, qy = py + 0.5;
          const w0 = ((B[0] - qx) * (C[1] - qy) - (C[0] - qx) * (B[1] - qy)) / ar, w1 = ((C[0] - qx) * (A[1] - qy) - (A[0] - qx) * (C[1] - qy)) / ar, w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue; const z = w0 * A[2] + w1 * B[2] + w2 * C[2], k = py * res + px; if (z > Z[k]) { Z[k] = z; K[k] = code; } } } }
    // 4-connected components of skin (0) and hair (1) pixels; a small one NOT touching the background / body is an island
    const seen = new Uint8Array(res * res); let n = 0, px = 0;
    for (let s0 = 0; s0 < res * res; s0++) { const c = K[s0]; if ((c !== 0 && c !== 1) || seen[s0]) continue;
      const q = [s0]; seen[s0] = 1; let area = 0, open = false;
      while (q.length) { const k = q.pop()!; area++; const x = k % res, y = (k / res) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= res || Y >= res) { open = true; continue; }
          const j = Y * res + X; if (K[j] === c) { if (!seen[j]) { seen[j] = 1; q.push(j); } } else if (K[j] === -1 || K[j] === 3) open = true; } }
      if (!open && area <= maxIslandPx) { n++; px += area; } }
    // the hair BASE CAP's visible share of the head (it is meant to sit under the hair, showing only through small gaps)
    let head = 0, capPx = 0; for (let k = 0; k < res * res; k++) { const c = K[k]; if (c === 0 || c === 1 || c === 2 || c === 4) { head++; if (c === 4) capPx++; } }
    cap[name] = +(100 * capPx / Math.max(1, head)).toFixed(2); capWorst = Math.max(capWorst, cap[name]);
    per[name] = n; perPx[name] = px; total += n; worst = Math.max(worst, n); worstPx = Math.max(worstPx, px); }
  return { islandsPerView: per, islandPx: perPx, worst, worstPx, total, capPct: cap, capWorstPct: capWorst };
}

// ---- REPORT-ONLY EVIDENCE (2026-10-10) — measured on every build, never part of the verdict (failure-registry REPORT_ONLY) ----

/** the level ring, the neck views and the shallow ring just under the hairline (between the gate's +6° and −30° sets), plus eye-level
 *  front / three-quarter views — where a gap between the haircut and the nape shows in play. The steep views below (−30° and lower)
 *  are left out on purpose: from there a hanging hair curtain legitimately walls in the skull base of every long haircut. */
export const WALL_VIEWS: Readonly<Record<string, { az: number; el: number }>> = { rear: GATE_VIEWS.rear, rear34L: GATE_VIEWS.rear34L, rear34R: GATE_VIEWS.rear34R, sideL: GATE_VIEWS.sideL, sideR: GATE_VIEWS.sideR,
  neckFront: GATE_VIEWS.neckFront, neckBack: GATE_VIEWS.neckBack, rearUnder: { az: 180, el: -8 }, rearUnderLow: { az: 180, el: -16 }, rear34LUnder: { az: 150, el: -8 }, rear34RUnder: { az: -150, el: -8 },
  rear34LUnderLow: { az: 140, el: -16 }, rear34RUnderLow: { az: -140, el: -16 }, sideLUnder: { az: 90, el: -12 }, sideRUnder: { az: -90, el: -12 }, front: { az: 0, el: 4 }, front34L: { az: 45, el: 4 }, front34R: { az: -45, el: 4 } };

/** CLOSURE WALLED IN BY HAIR in ONE pose, per view of WALL_VIEWS: the view's head px (skin / hair / closure / cap) and every visible
 *  closure patch (≥ 2 px) as [px, share of its border that is HAIR (layers or base cap)]. Closure walled in by hair is bare scalp
 *  showing through the haircut; the nape underside every approved head shows borders skin, the neck, the body or the sky instead. */
export function closureWalls(soup: Soup[], region: { yMin: number; centre: THREE.Vector3; half: number }, res = 320): Record<string, { headPx: number; walled: number[][] }> {
  const out: Record<string, { headPx: number; walled: number[][] }> = {};
  for (const [name, { az, el }] of Object.entries(WALL_VIEWS)) {
    const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180, d = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
    const right = new THREE.Vector3(0, 1, 0).cross(d); if (right.lengthSq() < 1e-6) right.set(1, 0, 0); right.normalize(); const up = d.clone().cross(right).normalize();
    const Z = new Float32Array(res * res).fill(-Infinity), K = new Int8Array(res * res).fill(-1);
    const proj = (P: Float32Array, i: number): [number, number, number, number] => { const x = P[i * 3] - region.centre.x, y = P[i * 3 + 1] - region.centre.y, z = P[i * 3 + 2] - region.centre.z;
      return [((x * right.x + y * right.y + z * right.z) / region.half * 0.5 + 0.5) * res, ((x * up.x + y * up.y + z * up.z) / region.half * 0.5 + 0.5) * res, x * d.x + y * d.y + z * d.z, P[i * 3 + 1]]; };
    for (const s of soup) { const code = s.kind === "occluder" ? 3 : s.kind === "closure" ? 2 : s.part === "identity_hair_base" ? 4 : /^identity_hair_/.test(s.part) ? 1 : 0;
      for (let t = 0; t < s.I.length; t += 3) { const A = proj(s.P, s.I[t]), B = proj(s.P, s.I[t + 1]), C = proj(s.P, s.I[t + 2]);
        if (Math.max(A[3], B[3], C[3]) < region.yMin) continue;
        const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0]))), x1 = Math.min(res - 1, Math.ceil(Math.max(A[0], B[0], C[0]))), y0 = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1]))), y1 = Math.min(res - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
        const ar = (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]); if (Math.abs(ar) < 1e-9) continue;
        for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) { const qx = px + 0.5, qy = py + 0.5;
          const w0 = ((B[0] - qx) * (C[1] - qy) - (C[0] - qx) * (B[1] - qy)) / ar, w1 = ((C[0] - qx) * (A[1] - qy) - (A[0] - qx) * (C[1] - qy)) / ar, w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue; const z = w0 * A[2] + w1 * B[2] + w2 * C[2], k = py * res + px; if (z > Z[k]) { Z[k] = z; K[k] = code; } } } }
    let headPx = 0; for (let k = 0; k < res * res; k++) if (K[k] >= 0 && K[k] !== 3) headPx++;
    const seen = new Uint8Array(res * res), walled: number[][] = [];
    for (let s0 = 0; s0 < res * res; s0++) { if (K[s0] !== 2 || seen[s0]) continue; const q = [s0]; seen[s0] = 1; let area = 0, hairB = 0, allB = 0;
      while (q.length) { const k = q.pop()!; area++; const x = k % res, y = (k / res) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= res || Y >= res) { allB++; continue; }
          const j = Y * res + X; if (K[j] === 2) { if (!seen[j]) { seen[j] = 1; q.push(j); } } else { allB++; if (K[j] === 1 || K[j] === 4) hairB++; } } }
      if (area >= 2) walled.push([area, +(hairB / Math.max(1, allB)).toFixed(2)]); }
    out[name] = { headPx, walled: walled.sort((x, y) => y[0] - x[0]).slice(0, 12) }; }
  return out;
}

/** closure walls in the poses VO shows: the bind pose and the employee's idle clip held at three phases — a gap between the haircut and
 *  the nape that only opens in MOTION is invisible to a bind-pose measurement (2026-10-10: Lui 0 ‰ bound, 58 ‰ idling). Leaves the
 *  avatar holding its idle, so it is measured last. */
export function closureWallEvidence(h: HumanAvatar, idle: string): Record<string, ReturnType<typeof closureWalls>> {
  h.root.updateMatrixWorld(true);
  const lm = h.identityLandmarks as unknown as { eyes: { l: number[] } } | null; if (!lm) throw new Error("mounted gate: identity has no landmarks");
  if (!h.clipNames.includes(idle)) throw new Error(`mounted gate: no idle clip "${idle}" to measure the pose VO shows`);
  const eye = new THREE.Vector3(lm.eyes.l[0], lm.eyes.l[1], lm.eyes.l[2]).applyMatrix4(h.rig.bindMatrixOf("Head", new THREE.Matrix4())), neckTop = h.bones.get("Head")!.getWorldPosition(new THREE.Vector3());
  const region = { yMin: neckTop.y - 3, centre: new THREE.Vector3(0, eye.y, neckTop.z), half: 18 }, poses: Record<string, ReturnType<typeof closureWalls>> = { bind: closureWalls(worldSoup(h.root), region) };
  for (const ph of [0.15, 0.5, 0.85]) { h.hold(idle, ph, 0); h.update(1e-4); poses[`idle${ph}`] = closureWalls(worldSoup(h.root), region); }
  return poses;
}

/** MOVING HAIR THROUGH the head: in one pose, how many triangles of the MOVING hair layers (every identity hair layer but the rigid base
 *  cap and scalp) pass through the welded underside, the closure and the skin — exact triangle-against-triangle tests */
export function hairThrough(soup: Soup[]): Record<"underside" | "closure" | "skin", number> {
  const cls = (p: string) => (p === "baked_underside" ? "underside" : /^baked_(interior|skullbase)/.test(p) ? "closure" : /^identity_(head|face_twin)$/.test(p) ? "skin" : null);
  const moving = soup.filter((s) => s.kind !== "occluder" && /^identity_hair_/.test(s.part) && !/^identity_hair_(base|scalp)$/.test(s.part));
  const cell = 1, grid = new Map<string, [number, Soup, number][]>();
  const tv = (s: Soup, t: number) => [0, 1, 2].map((q) => [s.P[s.I[t + q] * 3], s.P[s.I[t + q] * 3 + 1], s.P[s.I[t + q] * 3 + 2]]);
  const cells = (V: number[][], f: (k: string) => void) => { const lo = [0, 1, 2].map((k) => Math.floor(Math.min(V[0][k], V[1][k], V[2][k]) / cell)), hi = [0, 1, 2].map((k) => Math.floor(Math.max(V[0][k], V[1][k], V[2][k]) / cell));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) f(`${x},${y},${z}`); };
  for (const s of soup) { const c = cls(s.part); if (!c || s.kind === "occluder") continue; for (let t = 0; t < s.I.length; t += 3) cells(tv(s, t), (k) => { const L = grid.get(k) ?? []; if (!grid.has(k)) grid.set(k, L); L.push([c === "underside" ? 0 : c === "closure" ? 1 : 2, s, t]); }); }
  const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const seg = (p0: number[], p1: number[], A: number[], B: number[], C: number[]) => { const d = sub(p1, p0), e1 = sub(B, A), e2 = sub(C, A), h = cross(d, e2), det = dot(e1, h); if (Math.abs(det) < 1e-12) return false;
    const f = 1 / det, s0 = sub(p0, A), u = f * dot(s0, h); if (u <= 1e-6 || u >= 1 - 1e-6) return false; const q = cross(s0, e1), w = f * dot(d, q); if (w <= 1e-6 || u + w >= 1 - 1e-6) return false; const t = f * dot(e2, q); return t > 1e-6 && t < 1 - 1e-6; };
  const hits = (X: number[][], Y: number[][]) => [[0, 1], [1, 2], [2, 0]].some(([i, j]) => seg(X[i], X[j], Y[0], Y[1], Y[2]) || seg(Y[i], Y[j], X[0], X[1], X[2]));
  const out = { underside: 0, closure: 0, skin: 0 }, names = ["underside", "closure", "skin"] as const;
  for (const s of moving) for (let t = 0; t < s.I.length; t += 3) { const V = tv(s, t), found = [false, false, false]; const seen = new Set<string>();
    cells(V, (k) => { for (const [c, o, u] of grid.get(k) ?? []) { if (found[c]) continue; const id = `${o.part}:${u}`; if (seen.has(id)) continue; seen.add(id); if (hits(V, tv(o, u))) found[c] = true; } });
    found.forEach((f, c) => { if (f) out[names[c]]++; }); }
  return out;
}

/** IN MOTION (report-only evidence): the idle clip and the walk PLAYED (frame by frame, so the hair dynamics swing — a held pose shows
 *  the hair at rest), sampled after a second of warm-up: in each sample the closure seen first from the gate's twelve views (exactly
 *  closureExposure, so the bind-pose thresholds compare) and the moving hair through the underside / closure / skin. The bind-pose
 *  measurements were blind to both: the hair lifts off the nape only in motion. Leaves the avatar mid-walk: measured last. */
export function motionEvidence(h: HumanAvatar, idle: string, walk = "walking"): Record<string, { pct: number; worstPct: number; worstView: string; wholeHeadWorstPct: number; hairThrough: ReturnType<typeof hairThrough> }> {
  h.root.updateMatrixWorld(true);
  const lm = h.identityLandmarks as unknown as { eyes: { l: number[] } } | null; if (!lm) throw new Error("mounted gate: identity has no landmarks");
  const eye = new THREE.Vector3(lm.eyes.l[0], lm.eyes.l[1], lm.eyes.l[2]).applyMatrix4(h.rig.bindMatrixOf("Head", new THREE.Matrix4())), neckTop = h.bones.get("Head")!.getWorldPosition(new THREE.Vector3());
  const region = { yMin: neckTop.y - 3, eyeY: eye.y, centre: new THREE.Vector3(0, (neckTop.y + eye.y) / 2 + 2, neckTop.z), half: 16 }, out: ReturnType<typeof motionEvidence> = {};
  { const soup = worldSoup(h.root), c = closureExposure(soup, region), wv = Object.entries(c.views).sort((a, b) => b[1] - a[1])[0];   // at rest first: contact by design (roots in the scalp) reads here too
    out.bind = { pct: c.pct, worstPct: c.worstPct, worstView: wv?.[0] ?? "", wholeHeadWorstPct: c.wholeHead.worstPct, hairThrough: hairThrough(soup) }; }
  for (const [clip, label, cycle] of [[idle, "idle", 90], [walk, "walk", 30]] as const) { if (!h.clipNames.includes(clip)) throw new Error(`mounted gate: no "${clip}" clip to play`);
    for (let f = 0; f <= 2 * cycle; f++) { h.hold(clip, (f / cycle) % 1, 0); h.update(1 / 30);
      if (f >= cycle && (f - cycle) % Math.round(cycle / 3) === 0) { const soup = worldSoup(h.root), c = closureExposure(soup, region), wv = Object.entries(c.views).sort((a, b) => b[1] - a[1])[0];
        out[`${label}${((f / cycle) % 1).toFixed(2)}`] = { pct: c.pct, worstPct: c.worstPct, worstView: wv?.[0] ?? "", wholeHeadWorstPct: c.wholeHead.worstPct, hairThrough: hairThrough(soup) }; } } }
  return out;
}

export type MountedMetrics = {
  neckTopY: number; eyeY: number; chinY: number;
  faceLenToBody: number; cheekWToShoulder: number; headWToShoulder: number; cheekWToHeadW: number;
  /** hair-INDEPENDENT: the identity skin's width at the eye line (skull incl. ears) — hair volume is identity, judged apart */
  skullWToShoulder: number; cheekWToSkullW: number;
  /** hair-INDEPENDENT head height: identity skin top (scalp, under any hair) above the chin, per neck-top height — bounds a
   *  naturally long head by the approved family instead of by a native eye-line number */
  skullHToBody: number;
  closure: ReturnType<typeof closureExposure>;
  islands: ReturnType<typeof surfaceIslands>;
};

/** every mounted measurement of one built avatar (bind pose, head mount applied through the bind matrices) */
export function mountedMetrics(h: HumanAvatar): MountedMetrics {
  h.root.updateMatrixWorld(true);
  const lm = h.identityLandmarks as unknown as { eyes: { l: number[]; r: number[] } } | null; if (!lm) throw new Error("mounted gate: identity has no landmarks");
  const m4 = new THREE.Matrix4(), headM = h.rig.bindMatrixOf("Head", m4), pt = (p: number[]) => new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(headM);
  const eye = pt(lm.eyes.l), chin = pt([0, 0.805, 0.3]), neckTop = h.bones.get("Head")!.getWorldPosition(new THREE.Vector3());
  const soup = worldSoup(h.root);
  // widths: head incl. hair (identity, above the neck top) · cheek band on the identity skin · shoulders (body + top)
  const ext = (pred: (s: Soup) => boolean, yLo: number, yHi: number, zMin = -Infinity) => { let a = Infinity, b = -Infinity;
    for (const s of soup) { if (!pred(s)) continue; for (let i = 0; i < s.P.length; i += 3) { const y = s.P[i + 1]; if (y < yLo || y > yHi || s.P[i + 2] < zMin) continue; a = Math.min(a, s.P[i]); b = Math.max(b, s.P[i]); } }
    return b > a ? b - a : NaN; };
  const cheekY = chin.y + 0.6 * (eye.y - chin.y), sh = h.bones.get("LeftShoulder")!.getWorldPosition(new THREE.Vector3()).y;
  const skullW = ext((s) => s.kind === "identity" && s.part === "identity_head", eye.y - 0.6, eye.y + 0.6);
  let skinTop = -Infinity; for (const sp of soup) if (sp.kind === "identity" && sp.part === "identity_head") for (let i = 1; i < sp.P.length; i += 3) skinTop = Math.max(skinTop, sp.P[i]);
  const headW = ext((s) => s.kind === "identity", neckTop.y, Infinity), cheekW = ext((s) => s.kind === "identity" && s.part === "identity_head", cheekY - 0.3, cheekY + 0.3, neckTop.z), shoulderW = ext((s) => s.kind === "occluder" && (s.part === "humanbase_body" || /tee|top/.test(s.part)), sh - 2, sh + 1);
  const r3 = (x: number) => +x.toFixed(3);
  return { neckTopY: r3(neckTop.y), eyeY: r3(eye.y), chinY: r3(chin.y), faceLenToBody: r3((eye.y - chin.y) / neckTop.y), cheekWToShoulder: r3(cheekW / shoulderW), headWToShoulder: r3(headW / shoulderW), cheekWToHeadW: r3(cheekW / headW), skullWToShoulder: r3(skullW / shoulderW), cheekWToSkullW: r3(cheekW / skullW), skullHToBody: r3((skinTop - chin.y) / neckTop.y),
    closure: closureExposure(soup, { yMin: neckTop.y - 3, eyeY: eye.y, centre: new THREE.Vector3(0, (neckTop.y + eye.y) / 2 + 2, neckTop.z), half: 16 }),
    islands: surfaceIslands(soup, { yMin: neckTop.y - 3, centre: new THREE.Vector3(0, eye.y, neckTop.z), half: 18 }) };
}
