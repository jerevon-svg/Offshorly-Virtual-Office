// head-closure.mjs — the CANONICAL SKULL as a radial map, and the INTERIOR CLOSURE of an identity head. ZERO CREDITS.
//
// canonicalSkull(): the approved Alex skull (alex-neutral-head-v1, the canonical head-size contract) as a radial map
//   about the cranium centre — "how far out is the canonical skull in this direction". Used by the cranium floor (the
//   identity never sits inside the skull behind the ears), the hair layers (scalp = hair lying on the skull) and here.
//
// interiorShell(): a generated head is an open sheet — cut at the neck, hair shells hanging free. From below or low
//   behind you look INTO it and see the back of the face (and its eyes) from inside. Instead of hiding that with
//   oversized outer geometry (which then intersects hair and collars), the head is closed from INSIDE: the canonical
//   Alex head (a closed skull with the HumanBase neck opening) is shrunk, direction by direction, to sit `margin` inside
//   the nearest identity surface — never outside it, so it can never show through the face, hair or anything fitted.
//   Through any gap it reads as the underside of a real head (jaw, skull base, nape) in the wearer's own skin.
import { computeNormals, weldNormals } from "./lib.mjs";

export function canonicalSkull(AP, centre, { bins = 48, minY = 0.78 } = {}) {
  const CC = centre, NB = bins, RA = new Float32Array(NB * NB);
  const ang = (x, y, z) => { const dx = x - CC[0], dy = y - CC[1], dz = z - CC[2], r = Math.hypot(dx, dy, dz) || 1e-9; return [Math.acos(Math.max(-1, Math.min(1, dy / r))) / Math.PI * NB - 0.5, (Math.atan2(dz, dx) + Math.PI) / (2 * Math.PI) * NB - 0.5, r]; };
  for (let i = 0; i < AP.length / 3; i++) { if (AP[i * 3 + 1] < minY) continue; const [a, b, r] = ang(AP[i * 3], AP[i * 3 + 1], AP[i * 3 + 2]); const k = Math.min(NB - 1, Math.max(0, Math.round(a))) * NB + ((Math.round(b) % NB) + NB) % NB; RA[k] = Math.max(RA[k], r); }
  { const R2 = RA.slice(); for (let t = 0; t < NB; t++) for (let q = 0; q < NB; q++) { let s2 = 0, c2 = 0; for (let dt = -1; dt <= 1; dt++) for (let dq = -1; dq <= 1; dq++) { const tt = t + dt; if (tt < 0 || tt >= NB) continue; const v = R2[tt * NB + ((q + dq) % NB + NB) % NB]; if (v) { s2 += v; c2++; } } if (!R2[t * NB + q] && c2) RA[t * NB + q] = s2 / c2; else if (c2) RA[t * NB + q] = Math.max(R2[t * NB + q], s2 / c2); } }
  const Rat = (a, b) => { const t0 = Math.max(0, Math.min(NB - 1, Math.floor(a))), t1 = Math.min(NB - 1, t0 + 1), ft = Math.max(0, Math.min(1, a - t0)), q0 = ((Math.floor(b) % NB) + NB) % NB, q1 = (q0 + 1) % NB, fq = b - Math.floor(b);
    const g = (t, q) => RA[t * NB + q]; return (g(t0, q0) * (1 - fq) + g(t0, q1) * fq) * (1 - ft) + (g(t1, q0) * (1 - fq) + g(t1, q1) * fq) * ft; };
  /** radial distance of (x,y,z) beyond the canonical skull (negative = inside) */
  const excess = (x, y, z) => { const [a, b, r] = ang(x, y, z), R = Rat(a, b); return R ? r - R : 1; };
  return { CC, ang, Rat, excess };
}

/**
 * @param alex  { P, I, J, W } the canonical Alex head (bind space)
 * @param surfaces [{ P, I }] every identity surface that must stay in front of the shell (head, hair layers, skull base)
 * @returns a module part (name "baked_interior") or null
 */
export function interiorShell(alex, surfaces, { centre, margin = 0.01, alexInset = 0.008, colour, headJoint }) {
  // nearest identity surface per direction: a spherical min-radius map (vertices + triangle centroids splatted)
  const NT = 128, NP = 256, MR = new Float32Array(NT * NP).fill(9);
  const dir = (x, y, z) => { const dx = x - centre[0], dy = y - centre[1], dz = z - centre[2], r = Math.hypot(dx, dy, dz) || 1e-9; return [Math.min(NT - 1, Math.floor(Math.acos(Math.max(-1, Math.min(1, dy / r))) / Math.PI * NT)), Math.min(NP - 1, Math.floor((Math.atan2(dz, dx) + Math.PI) / (2 * Math.PI) * NP)), r]; };
  const splat = (x, y, z) => { const [t, p, r] = dir(x, y, z); const k = t * NP + p; if (r < MR[k]) MR[k] = r; };
  for (const s of surfaces) { const P = s.P, I = s.I; for (let i = 0; i < P.length / 3; i++) splat(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3; for (const [u, v] of [[1 / 3, 1 / 3], [0.6, 0.2], [0.2, 0.6], [0.2, 0.2]]) splat(P[a] + (P[b] - P[a]) * u + (P[c] - P[a]) * v, P[a + 1] + (P[b + 1] - P[a + 1]) * u + (P[c + 1] - P[a + 1]) * v, P[a + 2] + (P[b + 2] - P[a + 2]) * u + (P[c + 2] - P[a + 2]) * v); } }
  // conservative: each direction takes the minimum of its 5×5 neighbourhood (a thin gap in the splat never lets the
  // shell out through the identity surface)
  const M1 = MR.slice(); for (let t = 0; t < NT; t++) for (let p = 0; p < NP; p++) { let m = 9; for (let dt = -2; dt <= 2; dt++) for (let dp = -2; dp <= 2; dp++) { const tt = t + dt; if (tt < 0 || tt >= NT) continue; m = Math.min(m, MR[tt * NP + ((p + dp) % NP + NP) % NP]); } M1[t * NP + p] = m; }
  // SMOOTH UNDER THE CONSTRAINT (2026-10-10): the min filter above leaves flat terraces with steps wherever the identity surfaces are
  // ragged (cut rims, flaps) — the closure copied them as faceted shingles where it shows (nape). A blur no wider than the min filter
  // keeps every value at or below the raw splat of every direction it covers (each blurred sample is a minimum over a window that
  // contains that direction), so the shell stays inside every identity surface while becoming smooth.
  const M2 = M1.slice(); for (let t = 0; t < NT; t++) for (let p = 0; p < NP; p++) { let sum = 0, cnt = 0; for (let dt = -2; dt <= 2; dt++) for (let dp = -2; dp <= 2; dp++) { const tt = t + dt; if (tt < 0 || tt >= NT) continue; sum += M1[tt * NP + ((p + dp) % NP + NP) % NP]; cnt++; } M2[t * NP + p] = sum / cnt; }
  const P = Float32Array.from(alex.P), AN = computeNormals(Float32Array.from(alex.P), alex.I); let pulled = 0, open = 0;
  for (let i = 0; i < P.length / 3; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], [t, p, r] = dir(x, y, z), idR = M2[t * NP + p];
    let r2 = r - alexInset; if (idR < 8) { if (idR - margin < r2) { r2 = idR - margin; pulled++; } } else open++;
    // never through the centre; a vertex whose own Alex inset already sits inside stays put
    r2 = Math.max(0.05, r2); const f = r2 / r; P[i * 3] = centre[0] + (x - centre[0]) * f; P[i * 3 + 1] = centre[1] + (y - centre[1]) * f; P[i * 3 + 2] = centre[2] + (z - centre[2]) * f;
    void AN;
  }
  const N = weldNormals(P, computeNormals(P, alex.I));
  // the shell faces OUT: if the Alex winding is inward, flip
  let out = 0; for (let i = 0; i < P.length / 3; i++) out += N[i * 3] * (P[i * 3] - centre[0]) + N[i * 3 + 1] * (P[i * 3 + 1] - centre[1]) + N[i * 3 + 2] * (P[i * 3 + 2] - centre[2]);
  const I = Array.from(alex.I); if (out < 0) { for (let t = 0; t < I.length; t += 3) [I[t + 1], I[t + 2]] = [I[t + 2], I[t + 1]]; for (let k = 0; k < N.length; k++) N[k] = -N[k]; }
  const nv = P.length / 3;
  return { part: { name: "baked_interior", P, N, I, COLOR: Array.from({ length: nv }, () => colour).flat(),
    J: alex.J ?? new Uint8Array(nv * 4).map((_, k) => (k % 4 === 0 ? headJoint : 0)), W: alex.W ?? new Float32Array(nv * 4).map((_, k) => (k % 4 === 0 ? 1 : 0)),
    material: { name: "baked_interior", roughness: 0.92 } }, info: { verts: nv, tris: I.length / 3, pulledInside: pulled, closesOpenDirections: open } };
}
