// scalp-backing.mjs — SCALP UNDER THE HAIRCUT IS HAIR BASE, NEVER SKIN-TONED CLOSURE (2026-10-10, universal construction step). ZERO CREDITS.
//
//   node scripts/avatar-pipeline/human-base/scalp-backing.mjs <in.glb> <out.glb>        (a new file; refuses to overwrite)
//   node scripts/avatar-pipeline/human-base/scalp-backing.mjs <identity.glb> --in-place  (the build's intermediate identity file)
//
// The generated hair moves (secondary-motion chains, layer 70: lag, sway, and the collider push that holds a chain end out of the
// head / neck spheres even at rest). Wherever the moving hair lifts, the surface under it shows. Where the build trimmed the skin
// under the haircut and the hair base cap stops short, the only surface left there is the skin-toned CLOSURE interior — a bare,
// skin-coloured patch opening through the hair in motion (2026-10-10: a short haircut read 0 ‰ bound, 58 ‰ idling; the gate's
// FC-CLOSURE-THROUGH-HAIR). The approved heads move their hair as much or more; under theirs there is cap or skin.
//
// Rule (no name, no per-person constant): a closure-interior triangle is SCALP when hair lies radially outside it (seen from the skull
// centre, its own or an adjacent 2.5° direction) within half an eye spacing — i.e. it lies UNDER the haircut. Facing is deliberately
// not a test: what lifting hair uncovers is the lower occiput, whose surface faces DOWN-back (measured: 224 of the 225 revealed
// triangles are under the haircut, most facing down); the nape underside the approved heads show from low views lies BELOW the
// haircut and stays closure. Only closure HIDDEN AT REST (visibility.mjs REST_VIEWS — the gate's view ring) changes: what is already
// seen at rest keeps its look (2026-10-10: converting rest-visible closure under a ragged hair edge drew dark teeth into a nape), so
// the step can only change what the moving hair uncovers. Scalp triangles MOVE from baked_interior into the hair base cap
// (identity_hair_base): the same positions, normals and joint bindings, the cap's own paint — no new geometry, deterministic.
import fs from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { identityParts, visibleTriangles } from "./visibility.mjs";

const NT = 144, NP = 72;   // spherical bins about the skull centre (2.5°)

/** move the closure-interior triangles that lie under the haircut into the hair base cap; returns what moved (doc edited in place) */
export function backScalpUnderHair(doc, { reach = 0.5 } = {}) {
  const root = doc.getRoot(), L = root.listScenes()[0].getExtras()?.humanIdentity?.landmarks; if (!L?.eyes || !L?.attach?.ears) throw new Error("scalp backing: identity has no eye / ear landmarks");
  const byName = (n) => root.listMeshes().find((m) => m.getName() === n), interior = byName("baked_interior"), cap = byName("identity_hair_base");
  const hair = root.listMeshes().filter((m) => /^identity_hair_/.test(m.getName()) && m !== cap);
  if (!interior || !cap || !hair.length) return { moved: 0, reason: "no interior / cap / hair layer" };
  const iod = Math.abs(L.eyes.r[0] - L.eyes.l[0]), earZ = (L.attach.ears.l.root[2] + L.attach.ears.r.root[2]) / 2, C = [0, L.eyes.l[1], (earZ + L.eyes.l[2]) / 2 - 0.2 * iod], D = reach * iod;
  const bin = (x, y, z) => { const dx = x - C[0], dy = y - C[1], dz = z - C[2], r = Math.hypot(dx, dy, dz), t = Math.floor(((Math.atan2(dx, dz) + Math.PI) / (2 * Math.PI)) * NT) % NT, p = Math.min(NP - 1, Math.max(0, Math.floor(((Math.asin(Math.max(-1, Math.min(1, dy / r))) + Math.PI / 2) / Math.PI) * NP))); return [p, t, r]; };
  // the haircut's radial extent per bin: its innermost and outermost surface (every hair layer, triangle centroids)
  const hairIn = new Float32Array(NT * NP).fill(Infinity), hairOut = new Float32Array(NT * NP).fill(-Infinity);
  for (const m of hair) for (const pr of m.listPrimitives()) { const P = pr.getAttribute("POSITION").getArray(), I = pr.getIndices().getArray();
    for (let t = 0; t < I.length; t += 3) { const [p, q, r] = bin(...[0, 1, 2].map((k) => (P[I[t] * 3 + k] + P[I[t + 1] * 3 + k] + P[I[t + 2] * 3 + k]) / 3)), b = p * NT + q; hairIn[b] = Math.min(hairIn[b], r); hairOut[b] = Math.max(hairOut[b], r); } }
  const ip = interior.listPrimitives()[0], cp = cap.listPrimitives()[0], P = ip.getAttribute("POSITION").getArray(), I = ip.getIndices().getArray(), keep = [], move = [];
  const seen = visibleTriangles(identityParts(doc), ["baked_interior"]).get("baked_interior");   // closure the camera already sees at rest stays as it is
  for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3, [p0, q0, r] = bin(...[0, 1, 2].map((k) => (P[a + k] + P[b + k] + P[c + k]) / 3)); let under = false;
    for (let dp = -1; dp <= 1 && !under; dp++) for (let dq = -1; dq <= 1; dq++) { const p = p0 + dp; if (p < 0 || p >= NP) continue; const bb = p * NT + ((q0 + dq + NT) % NT); if (hairOut[bb] > r && hairIn[bb] - r < D) { under = true; break; } }
    (under && !seen[t / 3] ? move : keep).push(I[t], I[t + 1], I[t + 2]); }
  if (!move.length) return { moved: 0, reason: "no closure under the haircut" };
  // append the moved triangles to the cap (shared vertices stay shared), in the cap's own attribute formats and paint
  const sem = cp.listSemantics(), n0 = cp.getAttribute("POSITION").getCount(), remap = new Map(), src = [];
  for (const v of move) if (!remap.has(v)) { remap.set(v, n0 + src.length); src.push(v); }
  const paint = cp.getAttribute("_PAINT"), pk = paint ? (() => { const A = paint.getArray(), cnt = new Map(); for (let i = 0; i < A.length; i += 4) { const k = `${A[i]},${A[i + 1]},${A[i + 2]},${A[i + 3]}`; cnt.set(k, (cnt.get(k) ?? 0) + 1); } return [...cnt.entries()].sort((x, y) => y[1] - x[1])[0][0].split(",").map(Number); })() : null;
  for (const s of sem) { const acc = cp.getAttribute(s), old = acc.getArray(), es = acc.getElementSize(), out = new old.constructor(old.length + src.length * es); out.set(old);
    const from = ip.getAttribute(s); src.forEach((v, k) => { const o = (n0 + k) * es; if (from && from.getElementSize() === es) for (let e = 0; e < es; e++) out[o + e] = from.getArray()[v * es + e]; else if (s === "_PAINT" && pk) out.set(pk, o); });   // TEXCOORD / _FLOW / _CLUMP: zero (the cap is painted, rigid)
    acc.setArray(out); }
  const ci = cp.getIndices().getArray(), nc = n0 + src.length, IA = nc > 65535 ? Uint32Array : ci.constructor, outI = new IA(ci.length + move.length); outI.set(ci); move.forEach((v, k) => { outI[ci.length + k] = remap.get(v); });
  cp.getIndices().setArray(outI); ip.getIndices().setArray(new I.constructor(keep));
  return { moved: move.length / 3, kept: keep.length / 3, capVerts: nc };
}

if (process.argv[1]?.endsWith("scalp-backing.mjs")) {
  const [inF, outArg] = process.argv.slice(2), inPlace = outArg === "--in-place", out = inPlace ? inF : outArg;
  if (!inF || !out) { console.error("usage: scalp-backing.mjs <in.glb> <out.glb> | <identity.glb> --in-place"); process.exit(2); }
  if (!inPlace && fs.existsSync(out)) { console.error(`refused: ${out} exists (a new file only; --in-place is for the build's intermediate identity file)`); process.exit(1); }
  const { createRequire } = await import("node:module"), draco3d = createRequire(import.meta.url)("draco3dgltf");
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "draco3d.decoder": await draco3d.createDecoderModule() });
  const doc = await io.read(inF), r = backScalpUnderHair(doc);
  for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName === "KHR_draco_mesh_compression") e.dispose();   // written uncompressed: no re-quantisation of anything it did not move
  await io.write(out, doc);
  console.log(`scalp backing: ${r.moved ? `${r.moved} closure triangles under the haircut → hair base cap (${r.kept} stay closure)` : `nothing to do (${r.reason})`} → ${out}`);
}
