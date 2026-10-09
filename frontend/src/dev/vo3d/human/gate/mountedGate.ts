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
