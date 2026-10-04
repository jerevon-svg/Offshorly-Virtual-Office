// regress-identity.mjs — vertex-level regression of a rebuilt identity head against its frozen approved baseline.
//   node scripts/avatar-pipeline/human-base/regress-identity.mjs <approved.glb> <rebuilt.glb>
// Vertices are matched by UV (same raw source → the same UV identifies the same source vertex). Reports position
// deviation (native units) for all matched vertices and for the face, plus vertices present in only one of the two.
import { io } from "./lib.mjs";
const read = async (f) => { const ms = (await io.read(f)).getRoot().listMeshes(); const p = (ms.find((m) => m.getName() === "identity_head") ?? ms[0]).listPrimitives()[0]; return { P: p.getAttribute("POSITION").getArray(), UV: p.getAttribute("TEXCOORD_0").getArray() }; };
const [fa, fb] = process.argv.slice(2), A = await read(fa), B = await read(fb);
const key = (uv, i) => `${Math.round(uv[i * 2] * 1e6)},${Math.round(uv[i * 2 + 1] * 1e6)}`;
const mA = new Map(); for (let i = 0; i < A.P.length / 3; i++) mA.set(key(A.UV, i), i);
const d = [], dF = [], hit = new Set(); let onlyB = 0;
for (let i = 0; i < B.P.length / 3; i++) { const j = mA.get(key(B.UV, i)); if (j === undefined) { onlyB++; continue; } hit.add(j); const e = Math.hypot(B.P[i * 3] - A.P[j * 3], B.P[i * 3 + 1] - A.P[j * 3 + 1], B.P[i * 3 + 2] - A.P[j * 3 + 2]); d.push(e); if (A.P[j * 3 + 2] > 0.15 && A.P[j * 3 + 1] > 0.85 && A.P[j * 3 + 1] < 1.35) dF.push(e); }
const st = (a) => { a.sort((x, y) => x - y); return a.length ? `median ${(a[a.length >> 1] * 1e3).toFixed(2)} · p99 ${(a[Math.floor(a.length * 0.99)] * 1e3).toFixed(2)} · max ${(a.at(-1) * 1e3).toFixed(2)}` : "-"; };
console.log(`approved ${A.P.length / 3} · rebuilt ${B.P.length / 3} · matched ${d.length} · only-approved ${A.P.length / 3 - hit.size} · only-rebuilt ${onlyB}`);
console.log(`all  (×1e-3 native): ${st(d)}`); console.log(`face (×1e-3 native): ${st(dF)}`);
