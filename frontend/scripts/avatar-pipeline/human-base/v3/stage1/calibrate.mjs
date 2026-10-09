// v3/stage1/calibrate.mjs — measures 3D facial RELIEF (midline profile + cheek depth, in face units u = √(IOD·EM)) on the
// APPROVED HumanBase heads (calibration only — never fitting input, never copied) and on canonical / Stage 1 heads.
import fs from "node:fs";
import { io } from "../../lib.mjs";
import { loadTemplate } from "../fit.mjs";
const tpl = loadTemplate(), TL = tpl.landmarks, O = "scripts/avatar-pipeline/output/human-base/stage1-proof";
export function relief(P, eyeL, eyeR, mouthC) {
  const Ey = (eyeL[1] + eyeR[1]) / 2, My = mouthC[1], EM = Ey - My, IOD = Math.abs(eyeR[0] - eyeL[0]), u = Math.sqrt(IOD * EM);
  const prof = (y, x0 = 0, dx = 0.02) => { let z = NaN; for (let i = 0; i < P.length / 3; i++) if (Math.abs(P[i * 3] - x0) < dx && Math.abs(P[i * 3 + 1] - y) < 0.006) z = Number.isNaN(z) ? P[i * 3 + 2] : Math.max(z, P[i * 3 + 2]); return z; };
  let nose = -9; for (let y = My + 0.15 * EM; y < Ey - 0.15 * EM; y += 0.004) { const v = prof(y); if (!Number.isNaN(v)) nose = Math.max(nose, v); }
  const zE = prof(Ey), zM = prof(My), cy = Ey - 0.35 * EM, cheek = (prof(cy, -0.75 * IOD, 0.03) + prof(cy, 0.75 * IOD, 0.03)) / 2;
  return { noseRelief: (nose - (zE + zM) / 2) / u, chinProj: (prof(My - 0.4 * EM) - zM) / u, browRelief: (prof(Ey + 0.35 * EM) - zE) / u, lipBulge: (zM - (prof(My + 0.25 * EM) + prof(My - 0.3 * EM)) / 2) / u, cheekDepth: (cheek - prof(cy)) / u, midface: (prof(Ey - 0.5 * EM) - (zE + zM) / 2) / u };
}
const rows = {};
for (const w of ["bon", "micah", "angelo", "clang", "france"]) { const d = await io.read(`public/avatars/human-base-v1/production/${w}-v1.glb`), L = d.getRoot().listScenes()[0].getExtras().humanIdentity.landmarks, pts = [];
  for (const m of d.getRoot().listMeshes()) if (["identity_head", "identity_face_twin"].includes(m.getName())) pts.push(...m.listPrimitives()[0].getAttribute("POSITION").getArray());
  rows[`approved:${w}`] = relief(Float32Array.from(pts), L.eyes.l, L.eyes.r, L.mouth.c); }
const at = (X, i) => [X[i * 3], X[i * 3 + 1], X[i * 3 + 2]];
rows.canonical = relief(tpl.P, at(tpl.P, TL.eyeL), at(tpl.P, TL.eyeR), at(tpl.P, TL.mouth));
const VAR = process.argv[2] ?? "V"; for (const w of ["nicole", "carl", "chris"]) { const f = `${O}/${w}/${VAR}/pass1/qa-geometry.json`; if (!fs.existsSync(f)) continue; const X = Float32Array.from(JSON.parse(fs.readFileSync(f, "utf8")).X); rows[`${VAR}:${w}`] = relief(X, at(X, TL.eyeL), at(X, TL.eyeR), at(X, TL.mouth)); }
const keys = Object.keys(rows.canonical), appr = Object.keys(rows).filter((k) => k.startsWith("approved"));
const stat = Object.fromEntries(keys.map((k) => { const v = appr.map((a) => rows[a][k]), m = v.reduce((a, b) => a + b, 0) / v.length; return [k, { mean: m, sd: Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) }]; }));
const ours = Object.keys(rows).filter((k) => k.startsWith(`${VAR}:`)), spread = Object.fromEntries(keys.map((k) => { const v = ours.map((a) => rows[a][k]), m = v.reduce((a, b) => a + b, 0) / (v.length || 1); return [k, Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length || 1))]; }));
fs.writeFileSync(`${O}/relief-calibration-${VAR}.json`, JSON.stringify({ rows, approvedStats: stat, oursSpread: spread }, null, 1));
for (const k of keys) console.log(k.padEnd(11), Object.entries(rows).map(([n, r]) => `${n.replace("approved:", "A:")} ${r[k].toFixed(3)}`).join("  "), `| approved sd ${stat[k].sd.toFixed(3)} · ours sd ${spread[k].toFixed(3)}`);
