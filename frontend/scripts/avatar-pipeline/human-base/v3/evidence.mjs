// v3/evidence.mjs — HumanBase V3 proof: read IDENTITY EVIDENCE. ZERO CREDITS.
// Evidence is never production geometry. Two kinds are read here:
//   · 3D evidence = an existing chibified identity file (Meshy raw → the approved Offshorly style transform): its skin
//     surface + painted texture, its hair surfaces (shape, colour, flow), its living-eye/mouth shells and landmarks;
//   · 2D evidence = the employee's approved Offshorly illustration (prepped, flat-lit, glasses removed).
import fs from "node:fs";
import sharp from "sharp";
import { io } from "../lib.mjs";
import { TriIndex, boundaryLoops, triNormal, vertexNormals, weld } from "./geom.mjs";

const decode = async (bytes) => { const { data, info } = await sharp(Buffer.from(bytes)).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, width: info.width, height: info.height, channels: 4 }; };

/** merge meshes (by name predicate) into one evidence surface with per-vertex UV/paint/flow and a per-triangle layer id */
function merge(doc, pick) {
  const P = [], UV = [], PAINT = [], FLOW = [], CLUMP = [], I = [], layerOfTri = [], layers = [];
  let tex = null;
  for (const m of doc.getRoot().listMeshes()) { if (!pick(m.getName())) continue;
    const p = m.listPrimitives()[0], o = P.length / 3, a = p.getAttribute("POSITION").getArray(), n = a.length / 3;
    const paA = p.getAttribute("_PAINT"), paS = paA?.getNormalized() ? (paA.getArray() instanceof Uint8Array ? 1 / 255 : paA.getArray() instanceof Uint16Array ? 1 / 65535 : 1) : 1;   // normalized integer paint
    const uv = p.getAttribute("TEXCOORD_0")?.getArray(), pa = paA ? Float32Array.from(paA.getArray(), (x) => x * paS) : null, fl = p.getAttribute("_FLOW")?.getArray(), cl = p.getAttribute("_CLUMP")?.getArray();
    const li = layers.length; layers.push(m.getName());
    const t = p.getMaterial()?.getBaseColorTexture()?.getImage(); if (t && !tex) tex = t;
    const own = t ?? null;
    for (let i = 0; i < n; i++) { P.push(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]); UV.push(uv?.[i * 2] ?? 0, uv?.[i * 2 + 1] ?? 0); PAINT.push(pa?.[i * 4] ?? 0, pa?.[i * 4 + 1] ?? 0, pa?.[i * 4 + 2] ?? 0, pa?.[i * 4 + 3] ?? 0); FLOW.push(fl?.[i * 3] ?? 0, fl?.[i * 3 + 1] ?? 0, fl?.[i * 3 + 2] ?? 0); CLUMP.push(cl?.[i] ?? 0); }
    for (const v of p.getIndices().getArray()) I.push(v + o);
    for (let k = 0; k < p.getIndices().getCount() / 3; k++) layerOfTri.push(li);
    layers[li] = { name: m.getName(), texture: own };
  }
  return { P: Float32Array.from(P), UV: Float32Array.from(UV), PAINT: Float32Array.from(PAINT), FLOW: Float32Array.from(FLOW), CLUMP: Float32Array.from(CLUMP), I: Uint32Array.from(I), layerOfTri: Uint16Array.from(layerOfTri), layers };
}

/** 3D evidence from a chibified identity GLB */
export async function load3D(file) {
  let ev_mouth = null;
  const doc = await io.read(file), root = doc.getRoot(), H = root.listScenes()[0].getExtras().humanIdentity;
  const skin = merge(doc, (n) => n === "identity_head" || n.startsWith("identity_face_"));
  const hair = merge(doc, (n) => n.startsWith("identity_hair_") && n !== "identity_hair_base");
  for (const s of [skin, hair]) {
    s.N = vertexNormals(s.P, s.I);
    s.index = new TriIndex(s.P, s.I, 0.02);
    const cache = new Map(); s.images = [];
    for (const l of s.layers) { if (!l.texture) { s.images.push(null); continue; } if (!cache.has(l.texture)) cache.set(l.texture, await decode(l.texture)); s.images.push(cache.get(l.texture)); }
  }
  // evidence reliability: triangles touching an OPEN boundary of the welded skin (cut lines, hair/skin label edges) and
  // their 2-ring are unreliable shape evidence (that is where the old pipeline's cuts and relabels live)
  const LMs = JSON.parse(JSON.stringify(H.landmarks));   // a copy: fitting uses validated landmarks, the output keeps the evidence's
  // ---- LANDMARK VALIDATION: evidence landmarks are never trusted blindly. The mouth is re-measured on the face's own
  // midline profile (the lip crease = the most concave point between the nose tip and the chin) and overrides a
  // landmark that disagrees by more than 2.5 cm-eq (a generated head's stale/broken landmark)
  const audit = {};
  { let chinY = Infinity; for (let i = 0; i < skin.P.length / 3; i++) if (Math.abs(skin.P[i * 3]) < 0.02 && skin.P[i * 3 + 2] > 0.15) chinY = Math.min(chinY, skin.P[i * 3 + 1]);
    const tipY = LMs.attach?.nose?.tip?.[1] ?? (LMs.eyes.l[1] - 0.12), prof = [];
    for (let y = chinY + 0.03; y <= tipY - 0.03; y += 0.004) { const r = skin.index.raycast(0, y, 1.2, 0, 0, -1, 1.4); if (r) prof.push([y, 1.2 - r.d]); }
    let best = null; for (let k = 2; k < prof.length - 2; k++) { const c = (prof[k - 2][1] + prof[k + 2][1]) / 2 - prof[k][1]; if (prof[k][1] < prof[k - 1][1] && prof[k][1] <= prof[k + 1][1] && (!best || c > best.c)) best = { y: prof[k][0], z: prof[k][1], c }; }
    if (best) { const old = LMs.mouth?.c; audit.mouth = { evidence: old, measured: [0, +best.y.toFixed(4), +best.z.toFixed(4)], concavity: +best.c.toFixed(4) };
      if (!old || Math.abs(old[1] - best.y) > 0.025) { LMs.mouth = { ...(LMs.mouth ?? {}), c: [0, best.y, best.z] }; audit.mouth.overridden = true; } } }
  // EARS: an ear landmark is usable only where the evidence actually has a surface (skin) at it. Ears hidden under
  // hair are invented by the generating pipeline — they must never drive the canonical head (they drag its sides)
  for (const s of ["l", "r"]) { const e = LMs.attach?.ears?.[s]; if (!e) continue;
    const pts = ["top", "lobe", "outer", "back"].map((k) => e[k]), seen = pts.filter((p) => { const q = skin.index.closest(p[0], p[1], p[2], 0.012); return q && q.d < 0.008; }).length;
    audit[`ear_${s}`] = { visibleLandmarks: seen, of: 4 }; if (seen < 3) { LMs.attach.ears[s] = null; audit[`ear_${s}`].ignored = true; } }
  skin.audit = audit;
  const feats = [LMs.mouth?.c, LMs.eyes?.l, LMs.eyes?.r].filter(Boolean);
  { const w = weld(skin.P, skin.I, 1e-5), nv = w.P.length / 3, loops = boundaryLoops(w.I, nv), bad = new Uint8Array(nv);
    // FEATURE OPENINGS (a small loop around the mouth or an eye: the lips/eye module fills it) are real anatomy, not cuts
    let featureLoops = 0;
    for (const L of loops) { let cx = 0, cy = 0, cz = 0; for (const v of L) { cx += w.P[v * 3]; cy += w.P[v * 3 + 1]; cz += w.P[v * 3 + 2]; } cx /= L.length; cy /= L.length; cz /= L.length;
      if (L.length < 400 && feats.some((f) => Math.hypot(f[0] - cx, f[1] - cy, f[2] - cz) < 0.09)) { featureLoops++;
        // the MOUTH OPENING (the loop nearest the mouth landmark) is kept as a polygon: it becomes the canonical lip seam
        if (LMs.mouth?.c && Math.hypot(LMs.mouth.c[0] - cx, LMs.mouth.c[1] - cy, LMs.mouth.c[2] - cz) < 0.09 && (!skin.mouthLoop || L.length > skin.mouthLoop.length / 3)) skin.mouthLoop = Float32Array.from(L.flatMap((v) => [w.P[v * 3], w.P[v * 3 + 1], w.P[v * 3 + 2]]));
        continue; }
      for (const v of L) bad[v] = 1; }
    skin.featureLoops = featureLoops;
    const nbr = Array.from({ length: nv }, () => []); for (let t = 0; t < w.I.length; t += 3) for (let k = 0; k < 3; k++) nbr[w.I[t + k]].push(w.I[t + (k + 1) % 3], w.I[t + (k + 2) % 3]);
    for (let r = 0; r < 1; r++) { const b2 = Uint8Array.from(bad); for (let v = 0; v < nv; v++) if (bad[v]) for (const u of nbr[v]) b2[u] = 1; bad.set(b2); }
    skin.unreliableTri = new Uint8Array(skin.I.length / 3); for (let t = 0; t < skin.I.length / 3; t++) for (let k = 0; k < 3; k++) if (bad[w.map[skin.I[t * 3 + k]]]) skin.unreliableTri[t] = 1; }
  // shells (living eyes, mouth) and HumanBase-owned neck pieces are carried as modules, re-seated on the new head
  const shells = [];
  for (const m of root.listMeshes()) { const nm = m.getName(); if (nm !== "face_eyes" && nm !== "face_mouth") continue;
    const p = m.listPrimitives()[0], attrs = {};
    for (const sem of p.listSemantics()) attrs[sem] = { type: p.getAttribute(sem).getType(), array: p.getAttribute(sem).getArray(), normalized: p.getAttribute(sem).getNormalized() };
    const t = p.getMaterial()?.getBaseColorTexture();
    shells.push({ name: nm, attrs, I: p.getIndices().getArray(), texture: t ? t.getImage() : null, material: p.getMaterial()?.getName() }); }
  // the mouth module's surface is shape evidence for the lips (the skin has an opening there)
  const mouth = shells.find((x) => x.name === "face_mouth");
  if (mouth) { const P = Float32Array.from(mouth.attrs.POSITION.array), I = Uint32Array.from(mouth.I); ev_mouth = { P, I, N: vertexNormals(P, I), index: new TriIndex(P, I, 0.02) }; }
  // the chin: lowest front-midline skin point
  let chin = null; for (let i = 0; i < skin.P.length / 3; i++) if (Math.abs(skin.P[i * 3]) < 0.02 && skin.P[i * 3 + 2] > 0.15 && (!chin || skin.P[i * 3 + 1] < chin[1])) chin = [skin.P[i * 3], skin.P[i * 3 + 1], skin.P[i * 3 + 2]];
  return { file, identity: H, landmarks: H.landmarks, fitLandmarks: LMs, skin, hair, shells, chin, chains: H.chains, hairMotion: H.hairMotion, mouth: ev_mouth };
}

/** evidence colour (sRGB 0–255) at barycentric point of triangle t: texture × the runtime's _PAINT override */
export function colourAt(ev, t, u, v, w) {
  const a = ev.I[t * 3], b = ev.I[t * 3 + 1], c = ev.I[t * 3 + 2], img = ev.images[ev.layerOfTri[t]];
  let rgb = [200, 160, 140];
  if (img) { const U = ev.UV[a * 2] * u + ev.UV[b * 2] * v + ev.UV[c * 2] * w, V = ev.UV[a * 2 + 1] * u + ev.UV[b * 2 + 1] * v + ev.UV[c * 2 + 1] * w;
    const s = sampleBilinear(img, U, V); rgb = [s[0], s[1], s[2]]; }
  const pa = [0, 1, 2, 3].map((q) => ev.PAINT[a * 4 + q] * u + ev.PAINT[b * 4 + q] * v + ev.PAINT[c * 4 + q] * w);
  if (pa[3] > 0.001) for (let q = 0; q < 3; q++) rgb[q] = rgb[q] * (1 - pa[3]) + pa[q] * 255 * pa[3];
  return rgb;
}
function sampleBilinear(img, u, v) {
  const { data, width: W, height: H } = img, x = Math.min(W - 1.001, Math.max(0, u * W - 0.5)), y = Math.min(H - 1.001, Math.max(0, v * H - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, o = [0, 0, 0];
  for (let q = 0; q < 3; q++) { const A = data[(y0 * W + x0) * 4 + q], B = data[(y0 * W + x0 + 1) * 4 + q], C = data[((y0 + 1) * W + x0) * 4 + q], D = data[((y0 + 1) * W + x0 + 1) * 4 + q]; o[q] = (A * (1 - fx) + B * fx) * (1 - fy) + (C * (1 - fx) + D * fx) * fy; }
  return o;
}

/** 2D evidence: the prepped illustration (RGBA) + its measured traits (illustration-traits.mjs output) */
export async function load2D(who) {
  const dir = `scripts/avatar-pipeline/output/human-base/meshy-ref/${who}`;
  const file = fs.existsSync(`${dir}/${who}-ref-final.png`) ? `${dir}/${who}-ref-final.png` : `${dir}/${who}-ref-noglasses.png`;
  return { file, image: await decode(fs.readFileSync(file)) };
}
export { triNormal };
