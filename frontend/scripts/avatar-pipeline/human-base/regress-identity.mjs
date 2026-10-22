// regress-identity.mjs — vertex-level regression of a rebuilt identity head against its frozen approved baseline.
//   node scripts/avatar-pipeline/human-base/regress-identity.mjs <approved.glb> <rebuilt.glb>
// Vertices are matched by UV (same raw source → the same UV identifies the same source vertex). V1.1 layered heads are
// compared as the union of identity_head + hair layers (the FRINGE copy is foreground and deliberately lifted — reported
// on its own), matched on their pre-atlas source UVs (_SRCUV) when present. Reports position deviation (native units) for
// all matched vertices, the face, and vertices present in only one of the two.
import { io } from "./lib.mjs";
const read = async (f, skip = ["identity_hair_fringe", "identity_hair_base"]) => { const ms = (await io.read(f)).getRoot().listMeshes(); const P = [], UV = [];
  for (const m of ms) { const n = m.getName(); if (!n.startsWith("identity_") || skip.includes(n)) continue; const p = m.listPrimitives()[0], a = p.getAttribute("POSITION").getArray(), u = (p.getAttribute("_SRCUV") ?? p.getAttribute("TEXCOORD_0")).getArray(); for (const x of a) P.push(x); for (const x of u) UV.push(x); }
  return { P, UV }; };
const [fa, fb] = process.argv.slice(2), A = await read(fa), B = await read(fb);
const key = (uv, i) => `${Math.round(uv[i * 2] * 1e6)},${Math.round(uv[i * 2 + 1] * 1e6)}`;
const mA = new Map(); for (let i = 0; i < A.P.length / 3; i++) mA.set(key(A.UV, i), i);
const d = [], dF = [], hit = new Set(); let onlyB = 0;
for (let i = 0; i < B.P.length / 3; i++) { const j = mA.get(key(B.UV, i)); if (j === undefined) { onlyB++; continue; } hit.add(j); const e = Math.hypot(B.P[i * 3] - A.P[j * 3], B.P[i * 3 + 1] - A.P[j * 3 + 1], B.P[i * 3 + 2] - A.P[j * 3 + 2]); d.push(e); if (A.P[j * 3 + 2] > 0.15 && A.P[j * 3 + 1] > 0.85 && A.P[j * 3 + 1] < 1.35) dF.push(e); }
const st = (a) => { a.sort((x, y) => x - y); return a.length ? `median ${(a[a.length >> 1] * 1e3).toFixed(2)} · p99 ${(a[Math.floor(a.length * 0.99)] * 1e3).toFixed(2)} · max ${(a.at(-1) * 1e3).toFixed(2)}` : "-"; };
console.log(`approved ${A.P.length / 3} · rebuilt ${B.P.length / 3} · matched ${d.length} · only-approved ${A.P.length / 3 - hit.size} · only-rebuilt ${onlyB}`);
console.log(`all  (×1e-3 native): ${st(d)}`); console.log(`face (×1e-3 native): ${st(dF)}`);
