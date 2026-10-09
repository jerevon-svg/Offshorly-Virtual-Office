// v3/calibrate-envelope.mjs — learn the Offshorly 2D→3D facial-envelope relationship k(t) from the APPROVED FIVE
// (approved illustration ↔ approved production HumanBase head) and report every proof person's envelopes. ZERO CREDITS.
//   node scripts/avatar-pipeline/human-base/v3/calibrate-envelope.mjs --mp=<mediapipe dir>
// Writes output/human-base/v3-proof/style-envelope.json (per-band aggregates only).
import fs from "node:fs";
import { io } from "../lib.mjs";
import { detect } from "./landmarks2d.mjs";
import { BANDS, envelope2D, envelope3D } from "./envelope.mjs";

const MP = process.argv.find((a) => a.startsWith("--mp="))?.slice(5);
const REF = (w) => (w === "bon" ? "scripts/avatar-pipeline/output/human-base/meshy-ref/bon-head-ref-final.png" : `scripts/avatar-pipeline/output/human-base/meshy-ref/${w}/${w}-ref-final.png`);
const FIVE = ["bon", "micah", "angelo", "clang", "france"], PROOF = ["bon", "kael", "lui", "nicole"];
export async function headEnvelope(file) {
  const doc = await io.read(file), L = doc.getRoot().listScenes()[0].getExtras().humanIdentity.landmarks, P = [];
  for (const m of doc.getRoot().listMeshes()) { const n = m.getName(); if (n !== "identity_head" && !n.startsWith("identity_face_")) continue; const a = m.listPrimitives()[0].getAttribute("POSITION").getArray(); for (let i = 0; i < a.length; i++) P.push(a[i]); }
  const A = Float32Array.from(P); let chinY = Infinity; for (let i = 0; i < A.length / 3; i++) if (Math.abs(A[i * 3]) < 0.02 && A[i * 3 + 2] > 0.15) chinY = Math.min(chinY, A[i * 3 + 1]);
  return envelope3D(A, { eyeY: (L.eyes.l[1] + L.eyes.r[1]) / 2, chinY, earZ: L.attach?.ears?.l?.root?.[2] ?? -0.05 });
}
const names = [...new Set([...FIVE, ...PROOF])], det = await detect(MP, names.map(REF)), E2 = {};
for (const [i, w] of names.entries()) { if (!det[i].found) throw new Error(`no face on ${w}'s illustration`); E2[w] = await envelope2D(REF(w), det[i].landmarks); }
const fmt = (b) => b.map((x) => x.half.toFixed(3)).join(" "), fmtO = (b) => b.map((x) => (x.oval ?? 0).toFixed(3)).join(" ");
console.log(`bands t (0 = eye line, 1 = chin):  ${BANDS.join("  ")}`);
const K = BANDS.map(() => []);
for (const w of FIVE) { const e3 = await headEnvelope(`public/avatars/human-base-v1/production/${w}-v1.glb`);
  e3.bands.forEach((b, k) => { if (E2[w].bands[k].half > 0.02 && b.half > 0.02) K[k].push(b.half / E2[w].bands[k].half); });
  console.log(`${w.padEnd(7)} 2D ${fmt(E2[w].bands)} (oval ${fmtO(E2[w].bands)}) | approved 3D ${fmt(e3.bands)}`); }
const k = K.map((v) => { const m = v.reduce((a, b) => a + b, 0) / v.length, sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length); return { mean: +m.toFixed(3), sd: +sd.toFixed(3), n: v.length }; });
console.log("k(t) = approved 3D / 2D:", k.map((x) => `${x.mean}±${x.sd}`).join("  "));
fs.writeFileSync("scripts/avatar-pipeline/output/human-base/v3-proof/style-envelope.json", JSON.stringify({ note: "Offshorly 2D→3D facial-envelope relationship from the approved five (aggregate per band)", bands: BANDS, k }, null, 1));
for (const w of PROOF) { const ev = await headEnvelope(`public/avatars/human-base-v1/identity/${w}-meshy-chibi-v1.glb`);
  console.log(`${w.padEnd(7)} 2D ${fmt(E2[w].bands)} | target 3D ${E2[w].bands.map((b, j) => (b.half * k[j].mean).toFixed(3)).join(" ")} | evidence 3D ${fmt(ev.bands)}`); }
fs.writeFileSync(`${process.env.TMPDIR ?? "/tmp"}/hb-v3-env2d.json`, JSON.stringify(Object.fromEntries(PROOF.map((w) => [w, E2[w].bands.map((b) => b.half)]))));   // transient, consumed by the build
