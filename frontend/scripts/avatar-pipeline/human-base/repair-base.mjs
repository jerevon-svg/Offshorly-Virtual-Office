// repair-base.mjs — CLEAN SKIN CONTRACT for the shared HumanBase bodies (V1.2). ZERO CREDITS. Idempotent.
//
//   node scripts/avatar-pipeline/human-base/repair-base.mjs [file.glb …]   (default: both published base bodies)
//
// The generated base bodies carried ~80 PINHOLES — 4-vertex boundary loops on hands, forearms, upper arms and pelvis —
// that showed the background through the skin as white specks. Every boundary loop of ≤ MAX_LOOP vertices (after welding
// split seam vertices by position) is filled with triangles wound against its boundary edges (consistent with the
// surrounding surface). Larger loops are intended openings (neck top, garment-cut rims) and are left alone.
import { io } from "./lib.mjs";
const SNAP = 0.003, MAX_LOOP = process.argv.includes("--garments") ? 11 : 8, MAX_SLIT = 400, SLIT_WIDTH = 0.004;   // slit: mean width (area / perimeter) under 4 mm-eq
// GARMENT CLOSURE CONTRACT (--garments): every module in public/avatars/human-base-v1/garments/ — small holes (≤ 11 boundary
// vertices) and slits filled, zero-area triangles and loose fragments (< 24 triangles) removed. Never welds (garment layers
// such as ribs and collars lie millimetres apart by design). Design, UVs and attributes untouched: only the index buffer.
import fs from "node:fs";
const GARMENTS = process.argv.includes("--garments"), argFiles = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const files = argFiles.length ? argFiles : GARMENTS ? fs.readdirSync("public/avatars/human-base-v1/garments").filter((f) => f.endsWith(".glb")).map((f) => `public/avatars/human-base-v1/garments/${f}`) : ["public/avatars/human-base-v1/human-base.glb", "public/avatars/human-base-v1/human-base-feminine.glb"];
for (const f of files) { const doc = await io.read(f); let filled = 0, tris = 0, slits = 0, snapped = 0, degen = 0, threads = 0, tjunctions = 0;
  for (const mesh of doc.getRoot().listMeshes()) { if (!GARMENTS && mesh.getName() !== "humanbase_body") continue;
    for (const p of mesh.listPrimitives()) { const P = p.getAttribute("POSITION").getArray(), acc = p.getIndices(), I = Array.from(acc.getArray()), nv = P.length / 3;
      // SEAM DRIFT: a shape preset displaced split seam vertices differently — near-coincident BOUNDARY vertices (≤ SNAP)
      // are welded to one position first (geometric closure); intended openings are far wider and never touched
      if (GARMENTS) { // zero-area triangles + loose fragments out first
        const keep = []; for (let t = 0; t < I.length; t += 3) { const a = I[t], b = I[t + 1], c = I[t + 2], e1 = [0, 1, 2].map((k) => P[b * 3 + k] - P[a * 3 + k]), e2 = [0, 1, 2].map((k) => P[c * 3 + k] - P[a * 3 + k]);
          if (Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) < 1e-10) { degen++; continue; } keep.push(a, b, c); }
        const idp = new Map(), gp = new Int32Array(nv); for (let i = 0; i < nv; i++) { const k = `${Math.round(P[i * 3] * 1e4)},${Math.round(P[i * 3 + 1] * 1e4)},${Math.round(P[i * 3 + 2] * 1e4)}`; if (!idp.has(k)) idp.set(k, i); gp[i] = idp.get(k); }
        const par = new Int32Array(nv).map((_, i) => i), find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
        for (let t = 0; t < keep.length; t += 3) { const a = find(gp[keep[t]]); par[find(gp[keep[t + 1]])] = a; par[find(gp[keep[t + 2]])] = a; }
        const size = new Map(); for (let t = 0; t < keep.length; t += 3) { const r = find(gp[keep[t]]); size.set(r, (size.get(r) ?? 0) + 1); }
        I.length = 0; for (let t = 0; t < keep.length; t += 3) { if (size.get(find(gp[keep[t]])) < 24) { threads++; continue; } I.push(keep[t], keep[t + 1], keep[t + 2]); } }
      if (!GARMENTS) { const PA = p.getAttribute("POSITION"), id0 = new Map(), g0 = new Int32Array(nv); for (let i = 0; i < nv; i++) { const k = `${Math.round(P[i * 3] * 1e4)},${Math.round(P[i * 3 + 1] * 1e4)},${Math.round(P[i * 3 + 2] * 1e4)}`; if (!id0.has(k)) id0.set(k, i); g0[i] = id0.get(k); }
        const c0 = new Map(); for (let t = 0; t < I.length; t += 3) for (let q = 0; q < 3; q++) { const a = g0[I[t + q]], b = g0[I[t + (q + 1) % 3]], k = a < b ? `${a}_${b}` : `${b}_${a}`; c0.set(k, (c0.get(k) ?? 0) + 1); }
        const bnd = new Set(); for (const [k, c] of c0) if (c === 1) for (const v of k.split("_")) bnd.add(+v);
        const cell = new Map(), ck = (x, y, z) => `${Math.floor(x / SNAP)},${Math.floor(y / SNAP)},${Math.floor(z / SNAP)}`; for (const v of bnd) { const k = ck(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); (cell.get(k) ?? cell.set(k, []).get(k)).push(v); }
        const par = new Map(), find = (x) => { while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; }; for (const v of bnd) par.set(v, v);
        for (const v of bnd) { const cx = Math.floor(P[v * 3] / SNAP), cy = Math.floor(P[v * 3 + 1] / SNAP), cz = Math.floor(P[v * 3 + 2] / SNAP);
          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (const u of cell.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) { if (u === v) continue;
            if (Math.hypot(P[u * 3] - P[v * 3], P[u * 3 + 1] - P[v * 3 + 1], P[u * 3 + 2] - P[v * 3 + 2]) <= SNAP) par.set(find(u), find(v)); } }
        const sum = new Map(); for (const v of bnd) { const r = find(v), e = sum.get(r) ?? sum.set(r, [0, 0, 0, 0]).get(r); e[0] += P[v * 3]; e[1] += P[v * 3 + 1]; e[2] += P[v * 3 + 2]; e[3]++; }
        const target = new Map(); for (const v of bnd) { const e = sum.get(find(v)); if (e[3] > 1) target.set(v, [e[0] / e[3], e[1] / e[3], e[2] / e[3]]); }
        let moved = 0; for (let i = 0; i < nv; i++) { const t3 = target.get(g0[i]); if (!t3) continue; P[i * 3] = t3[0]; P[i * 3 + 1] = t3[1]; P[i * 3 + 2] = t3[2]; moved++; }
        if (moved) { PA.setArray(P); snapped += moved; } }
      const id = new Map(), g = new Int32Array(nv); for (let i = 0; i < nv; i++) { const k = `${Math.round(P[i * 3] * 1e4)},${Math.round(P[i * 3 + 1] * 1e4)},${Math.round(P[i * 3 + 2] * 1e4)}`; if (!id.has(k)) id.set(k, i); g[i] = id.get(k); }
      // directed boundary edges (welded): an edge used once; the fill uses it reversed
      const cnt = new Map(); for (let t = 0; t < I.length; t += 3) for (let q = 0; q < 3; q++) { const a = g[I[t + q]], b = g[I[t + (q + 1) % 3]], k = a < b ? `${a}_${b}` : `${b}_${a}`; cnt.set(k, (cnt.get(k) ?? 0) + 1); }
      // T-JUNCTIONS: a boundary vertex lying ON another boundary edge (within 0.5 mm-eq, strictly between its ends) is a crack
      // — the owner triangle of that edge is split at the vertex; repeated until none (closes cracks without a zero-area fill)
      let tj = 0; for (let pass = 0; pass < 6; pass++) { const c2 = new Map(), own = new Map(); for (let t = 0; t < I.length; t += 3) for (let q = 0; q < 3; q++) { const a = g[I[t + q]], b = g[I[t + (q + 1) % 3]], k = a < b ? `${a}_${b}` : `${b}_${a}`; c2.set(k, (c2.get(k) ?? 0) + 1); own.set(k, [t, q]); }
        const bv = new Set(), be = []; for (const [k, c] of c2) if (c === 1) { const [a, b] = k.split("_").map(Number); bv.add(a); bv.add(b); be.push([a, b, k]); }
        const cell = new Map(), CS = 0.01, ck = (x, y, z) => `${Math.floor(x / CS)},${Math.floor(y / CS)},${Math.floor(z / CS)}`; for (const v of bv) { const k = ck(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); (cell.get(k) ?? cell.set(k, []).get(k)).push(v); }
        const used = new Set(); let did = 0;
        for (const [a, b, k] of be) { const [t, q] = own.get(k); if (used.has(t)) continue; const A = [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]], Bv = [P[b * 3], P[b * 3 + 1], P[b * 3 + 2]], L = Math.hypot(Bv[0] - A[0], Bv[1] - A[1], Bv[2] - A[2]); if (L < 0.002) continue;
          let hit = -1; const steps = Math.ceil(L / CS) + 1;
          for (let sI = 0; sI <= steps && hit < 0; sI++) { const f = sI / steps, x = A[0] + (Bv[0] - A[0]) * f, y = A[1] + (Bv[1] - A[1]) * f, z = A[2] + (Bv[2] - A[2]) * f;
            for (const w of cell.get(ck(x, y, z)) ?? []) { if (w === a || w === b) continue; const W = [P[w * 3] - A[0], P[w * 3 + 1] - A[1], P[w * 3 + 2] - A[2]], d = [(Bv[0] - A[0]) / L, (Bv[1] - A[1]) / L, (Bv[2] - A[2]) / L], tt = W[0] * d[0] + W[1] * d[1] + W[2] * d[2];
              if (tt <= 0.0005 || tt >= L - 0.0005) continue; const off = Math.hypot(W[0] - d[0] * tt, W[1] - d[1] * tt, W[2] - d[2] * tt); if (off < 0.0005) { hit = w; break; } } }
          if (hit < 0) continue; const tri = [I[t], I[t + 1], I[t + 2]], i0 = tri[q], i1 = tri[(q + 1) % 3], i2 = tri[(q + 2) % 3];
          I[t] = i0; I[t + 1] = hit; I[t + 2] = i2; I.push(hit, i1, i2); used.add(t); did++; }
        tj += did; if (!did) break; }
      tjunctions += tj;
      // recount after T-junction splits
      cnt.clear(); for (let t = 0; t < I.length; t += 3) for (let q = 0; q < 3; q++) { const a = g[I[t + q]], b = g[I[t + (q + 1) % 3]], k = a < b ? `${a}_${b}` : `${b}_${a}`; cnt.set(k, (cnt.get(k) ?? 0) + 1); }
      // boundary loops by UNDIRECTED walk (a directed next-map breaks at non-manifold vertices): components whose every vertex
      // has boundary degree 2; oriented from one boundary edge's own triangle (the fill runs against it)
      const bedge = new Map(); for (let t = 0; t < I.length; t += 3) for (let q = 0; q < 3; q++) { const a = g[I[t + q]], b = g[I[t + (q + 1) % 3]], k = a < b ? `${a}_${b}` : `${b}_${a}`; if (cnt.get(k) === 1) bedge.set(k, [a, b]); }
      const adj = new Map(); for (const [a, b] of bedge.values()) { (adj.get(a) ?? adj.set(a, []).get(a)).push(b); (adj.get(b) ?? adj.set(b, []).get(b)).push(a); }
      const seen = new Set();
      for (const s0 of adj.keys()) { if (seen.has(s0)) continue; const comp = [], st = [s0]; seen.add(s0); while (st.length) { const v = st.pop(); comp.push(v); for (const u of adj.get(v)) if (!seen.has(u)) { seen.add(u); st.push(u); } }
        // tiny holes (3 vertices) close directly even at non-manifold vertices (bow-tie junctions) — oriented from a boundary edge
        if (comp.length === 3) { const [a, b, c] = comp, e = bedge.get(a < b ? `${a}_${b}` : `${b}_${a}`) ?? bedge.get(b < c ? `${b}_${c}` : `${c}_${b}`) ?? bedge.get(a < c ? `${a}_${c}` : `${c}_${a}`); if (!e) continue;
          const third = comp.find((v) => v !== e[0] && v !== e[1]), e1 = [0, 1, 2].map((k) => P[e[1] * 3 + k] - P[e[0] * 3 + k]), e2 = [0, 1, 2].map((k) => P[third * 3 + k] - P[e[0] * 3 + k]);
          if (Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) < 1e-10) continue; I.push(e[1], e[0], third); tris++; filled++; continue; }
        if (comp.length < 3 || comp.length > MAX_SLIT || comp.some((v) => adj.get(v).length !== 2)) continue;
        const loop = [comp[0]]; let prev = -1, cur = comp[0]; for (;;) { const nx = adj.get(cur).find((u) => u !== prev && u !== loop[0]) ?? adj.get(cur).find((u) => u !== prev); if (nx === undefined || nx === loop[0]) break; loop.push(nx); prev = cur; cur = nx; if (loop.length > comp.length) break; }
        if (loop.length !== comp.length) continue;
        if (loop.length > MAX_LOOP) { const nrm = [0, 0, 0]; let per = 0; for (let k = 0; k < loop.length; k++) { const a = loop[k], b = loop[(k + 1) % loop.length];
            nrm[0] += (P[a * 3 + 1] - P[b * 3 + 1]) * (P[a * 3 + 2] + P[b * 3 + 2]); nrm[1] += (P[a * 3 + 2] - P[b * 3 + 2]) * (P[a * 3] + P[b * 3]); nrm[2] += (P[a * 3] - P[b * 3]) * (P[a * 3 + 1] + P[b * 3 + 1]);
            per += Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]); }
          if (Math.hypot(...nrm) / 2 / per > SLIT_WIDTH) continue; slits++; }
        // orientation: the existing triangle uses edge (loop[0] → loop[1]) in some direction; the fill must use it reversed
        const e0 = bedge.get(loop[0] < loop[1] ? `${loop[0]}_${loop[1]}` : `${loop[1]}_${loop[0]}`), sameDir = e0[0] === loop[0];
        const L2 = sameDir ? loop.slice().reverse() : loop;
        for (let k = 1; k < L2.length - 1; k++) { I.push(L2[0], L2[k], L2[k + 1]); tris++; } filled++; }
      if (filled || degen || threads || tjunctions) acc.setArray(new Uint32Array(I)); } }
  if (filled || snapped || degen || threads || tjunctions) await io.write(f, doc);
  console.log(`${f}: ${filled} loops filled (${slits} of them slits; ${tris} triangles) · ${snapped} seam-drift vertices welded · ${degen} zero-area + ${threads} fragment triangles removed · ${tjunctions} T-junctions split`); }
