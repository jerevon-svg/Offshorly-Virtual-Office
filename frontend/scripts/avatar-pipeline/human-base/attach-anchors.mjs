// attach-anchors.mjs — THE ACCESSORY ATTACHMENT CONTRACT's anchors (V1.1), measured on an identity's own fitted geometry.
// Used by chibify.mjs at build time; also a CLI that (re)publishes `landmarks.attach` on existing identity heads:
//   node scripts/avatar-pipeline/human-base/attach-anchors.mjs [who …]
//
//   ears {l, r}: root / outer / top / lobe / back — each ear measured on ITS OWN side (the outermost 2.5 cm-eq of skin round
//                the eye line; the skull side above the ear is not ear), nose: bridge / tip, crown, forehead,
//   envelope:    the OUTER head+hair surface (radius per direction about the canonical skull centre) + the same map over
//                skin only — hats, bands, headsets, clips and flowers fit against the actual hairstyle, not the skull.
export function computeAttach({ parts, eyes, mouthY, earHalf, earZ, centre }) {
  const C0 = centre, NT = 24, NP = 48, outer = new Float32Array(NT * NP), skin = new Float32Array(NT * NP);
  const bin = (x, y, z) => { const dx = x - C0[0], dy = y - C0[1], dz = z - C0[2], r = Math.hypot(dx, dy, dz) || 1e-9; return [Math.min(NT - 1, Math.floor(Math.acos(Math.max(-1, Math.min(1, dy / r))) / Math.PI * NT)) * NP + Math.min(NP - 1, Math.floor((Math.atan2(dz, dx) + Math.PI) / (2 * Math.PI) * NP)), r]; };
  // OUTER = the 85th-percentile radius per direction (the max is set by stray strand tips: a band / clip would hover);
  // SKIN = the max (anything inside it is inside the head)
  const radii = Array.from({ length: NT * NP }, () => []);
  for (const part of parts) { if (!part.name.startsWith("identity_")) continue; const isSkin = part.name === "identity_head" || part.name === "identity_face_twin";
    for (let v = 0; v < part.P.length / 3; v++) { const [k, r] = bin(part.P[v * 3], part.P[v * 3 + 1], part.P[v * 3 + 2]); radii[k].push(r); if (isSkin && r > skin[k]) skin[k] = r; } }
  for (let k = 0; k < NT * NP; k++) { const a = radii[k]; if (!a.length) continue; a.sort((x, y) => x - y); outer[k] = Math.max(skin[k], a[Math.floor(0.85 * (a.length - 1))]); }
  for (const A2 of [outer, skin]) for (let it = 0; it < 8; it++) { const c = A2.slice(); for (let t = 0; t < NT; t++) for (let p2 = 0; p2 < NP; p2++) { const k = t * NP + p2; if (c[k] > 0) continue; let s2 = 0, n2 = 0;
      for (const [dt, dp] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const tt = t + dt; if (tt < 0 || tt >= NT) continue; const v2 = c[tt * NP + (p2 + dp + NP) % NP]; if (v2 > 0) { s2 += v2; n2++; } } if (n2) A2[k] = s2 / n2; } }
  const HP = (() => { const hs = parts.filter((p2) => p2.name === "identity_head" || p2.name === "identity_face_twin"); const out = new Float32Array(hs.reduce((a, p2) => a + p2.P.length, 0)); let o = 0; for (const p2 of hs) { out.set(p2.P, o); o += p2.P.length; } return out; })(), eyY = eyes.l[1], r4 = (a) => a && a.map((q) => +q.toFixed(4));
  const inBand = (x, y, z, sg) => x * sg > 0 && Math.abs(z - earZ) <= 0.06 && Math.abs(y - eyY) <= 0.15;   // round the MEASURED ear extreme (cheeks lie further forward)
  const ear = (sg) => { let mx = 0; for (let v = 0; v < HP.length / 3; v++) if (inBand(HP[v * 3], HP[v * 3 + 1], HP[v * 3 + 2], sg)) mx = Math.max(mx, HP[v * 3] * sg);
    let top = null, lobe = null, back = null, n2 = 0, rx = 0, ry = 0, rz = 0;
    for (let v = 0; v < HP.length / 3; v++) { const x = HP[v * 3], y = HP[v * 3 + 1], z = HP[v * 3 + 2]; if (!inBand(x, y, z, sg) || x * sg < mx - 0.025) continue;
      if (!top || y > top[1]) top = [x, y, z]; if (!lobe || y < lobe[1]) lobe = [x, y, z]; if (!back || z < back[2]) back = [x, y, z]; rx += x; ry += y; rz += z; n2++; }
    // SANITY: a real ear reaches the measured lateral extreme, spans 8–30 cm-eq and is centred near the eye line; hair-covered
    // or split ears fail it → the CANONICAL chibi ear proportions (top / lobe ±0.11 about the eye line) on this identity's
    // own measured ear extreme
    const sane = top && lobe && mx > earHalf - 0.03 && top[1] - lobe[1] > 0.08 && top[1] - lobe[1] < 0.3 && Math.abs((top[1] + lobe[1]) / 2 - eyY) < 0.08;
    const X = sg * earHalf;
    // (canonical points are projected onto THIS head's skin surface along their direction from the skull centre — a hair-
    //  covered or smaller ear must not leave an earring hanging in the air)
    // V1.2: never MEDIAL of the ear plane — under hair the skin map is shallow and pulled a canonical ear inside the skull
    // (France's left ear top at x −0.26: every glasses temple followed it into the head)
    const onSkin = (p) => { const [k] = bin(p[0], p[1], p[2]), d = [p[0] - C0[0], p[1] - C0[1], p[2] - C0[2]], l = Math.hypot(...d) || 1, r = skin[k] > 0 ? skin[k] - 0.004 : l, q = d.map((c, i) => C0[i] + (c / l) * r);
      if (q[0] * sg < earHalf - 0.02) q[0] = sg * (earHalf - 0.02); return q; };
    if (!sane) return { root: r4([sg * (earHalf - 0.05), eyY, earZ]), outer: r4(onSkin([X, eyY, earZ])), top: r4(onSkin([X - sg * 0.01, eyY + 0.11, earZ])), lobe: r4(onSkin([X - sg * 0.02, eyY - 0.11, earZ + 0.01])), back: r4(onSkin([X - sg * 0.03, eyY, earZ - 0.05])), measured: false };
    return { root: r4([sg * (Math.min(mx, earHalf) - 0.05), eyY, earZ]), outer: n2 ? r4([rx / n2, ry / n2, rz / n2]) : null, top: r4(top), lobe: r4(lobe), back: r4(back), measured: true }; };
  let tip = null, bridge = null, fore = null;
  for (let v = 0; v < HP.length / 3; v++) { const x = HP[v * 3], y = HP[v * 3 + 1], z = HP[v * 3 + 2];
    if (Math.abs(x) <= 0.05 && y <= eyY - 0.04 && y >= mouthY + 0.03 && (!tip || z > tip[2])) tip = [x, y, z];
    if (Math.abs(x) <= 0.03 && Math.abs(y - (eyY - 0.005)) <= 0.02 && (!bridge || z > bridge[2])) bridge = [0, y, z];
    if (Math.abs(x) <= 0.03 && y >= eyY + 0.12 && y <= eyY + 0.3 && (!fore || z > fore[2])) fore = [0, y, z]; }
  const crownR = (() => { const [k] = bin(C0[0], C0[1] + 1, C0[2] - 0.15); return outer[k]; })();
  // EARS ARE A MIRROR PAIR (V1.2): an ear hidden under hair fails its sanity check while its twin is measured — it then
  // mirrors the measured twin about the face's midline (x = 0 after the skull fit) instead of falling back to canonical
  const ears = { l: ear(-1), r: ear(1) }, mirrorEar = (e) => Object.fromEntries(Object.entries(e).map(([k, v]) => [k, Array.isArray(v) ? [-v[0], v[1], v[2]] : v === true ? "mirrored" : v]));
  if (!ears.l.measured && ears.r.measured === true) ears.l = { ...mirrorEar(ears.r), measured: false, mirrored: true };
  else if (!ears.r.measured && ears.l.measured === true) ears.r = { ...mirrorEar(ears.l), measured: false, mirrored: true };
  return { v: 1, centre: C0.map((q) => +q.toFixed(4)), ears, nose: { bridge: r4(bridge), tip: r4(tip) },
    crown: [C0[0], +(C0[1] + crownR * 0.989).toFixed(4), +(C0[2] - crownR * 0.148).toFixed(4)], forehead: r4(fore),
    envelope: { nt: NT, np: NP, outer: Array.from(outer, (r) => +r.toFixed(4)), skin: Array.from(skin, (r) => +r.toFixed(4)) } };
}

if (process.argv[1]?.endsWith("attach-anchors.mjs")) {
  const { io } = await import("./lib.mjs"), { fileURLToPath } = await import("node:url");
  const ID = fileURLToPath(new URL("../../../public/avatars/human-base-v1/identity/", import.meta.url));
  for (const who of process.argv.slice(2).length ? process.argv.slice(2) : ["bon", "micah", "angelo", "clang", "france"]) {
    const file = `${ID}${who}-meshy-chibi-v1.glb`, doc = await io.read(file), sc = doc.getRoot().listScenes()[0], ex = sc.getExtras(), lm = ex.humanIdentity.landmarks;
    const parts = doc.getRoot().listMeshes().map((m) => ({ name: m.getName(), P: m.listPrimitives()[0].getAttribute("POSITION").getArray() }));
    lm.attach = computeAttach({ parts, eyes: lm.eyes, mouthY: lm.mouth.c[1], earHalf: lm.glassesFit.ear[0], earZ: lm.glassesFit.ear[2], centre: lm.attach?.centre ?? [0, 1.25, lm.glassesFit.ear[2]] });
    sc.setExtras(ex); await io.write(file, doc);
    console.log(`${who}: ears L ${lm.attach.ears.l.measured ? "measured" : "canonical"} ${JSON.stringify(lm.attach.ears.l.top)}/${JSON.stringify(lm.attach.ears.l.lobe)} R ${lm.attach.ears.r.measured ? "measured" : "canonical"} ${JSON.stringify(lm.attach.ears.r.top)}/${JSON.stringify(lm.attach.ears.r.lobe)} · nose ${JSON.stringify(lm.attach.nose.bridge)}`);
  }
}
