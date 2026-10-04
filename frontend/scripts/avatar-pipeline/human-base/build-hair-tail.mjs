// build-hair-tail.mjs — a MODULAR TIED-BACK HAIR piece (low ponytail) for any identity head. ZERO CREDITS.
//
//   node scripts/avatar-pipeline/human-base/build-hair-tail.mjs <identity.glb> <accessory-id> [--length=upperBack|shoulder|midBack]
//
// Generated identity heads only contain the hair Meshy built; tied-back length that the front illustration implies
// (a ponytail / gathered back hair) is added as its own hairstyle piece, so the hairstyle representation can describe
// FRONT length (the identity's own hair) and BACK/TIED extent (this piece) separately:
//   · anchor: the outermost hair surface at the back of the head, low (nape-tie height), measured on the identity;
//   · colour: the identity's own hair colour (median of its dark hair texels), with soft strand striation;
//   · path: from the tie, curving in to rest just behind the HumanBase nape and upper back (measured from the base
//     body's back surface + clearance) down to the length preset;
//   · motion: a 3-joint chain with the shared "long" hair-motion preset (head/neck/shoulder colliders apply).
import sharp from "sharp";
import * as THREE from "three";
import * as C from "../../../src/dev/vo3d/human/humanBaseContract.ts";
import { BASE_OUT, computeNormals, io, loadBase, weldNormals, writeModule } from "./lib.mjs";

const [idFile, outId] = process.argv.slice(2);
const LENGTHS = { shoulder: 0.7, upperBack: 0.6, midBack: 0.5 };
const endY = LENGTHS[process.argv.find((a) => a.startsWith("--length="))?.slice(9) ?? "upperBack"];
const doc = await io.read(idFile);
const prim = doc.getRoot().listMeshes().find((m) => m.getName() === "identity_head").listPrimitives()[0];
const HP = prim.getAttribute("POSITION").getArray(), UV = prim.getAttribute("TEXCOORD_0").getArray(), n = HP.length / 3;
const lm = doc.getRoot().listScenes()[0].getExtras().humanIdentity.landmarks;
const { data: T, info: ti } = await sharp(Buffer.from(prim.getMaterial().getBaseColorTexture().getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const tex = (i) => { const u = Math.min(ti.width - 1, Math.max(0, Math.round((UV[i * 2] % 1) * (ti.width - 1)))), v = Math.min(ti.height - 1, Math.max(0, Math.round((UV[i * 2 + 1] % 1) * (ti.height - 1)))), o = (v * ti.width + u) * 3; return [T[o], T[o + 1], T[o + 2]]; };
const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
// hair colour + the tie anchor (low at the back: between the eye line and the chin height, centred)
const dark = []; for (let i = 0; i < n; i += 3) { const c = tex(i); if (lum(c) < 60) dark.push(c); }
const hair = [0, 1, 2].map((k) => dark.map((c) => c[k]).sort((a, b) => a - b)[dark.length >> 1] / 255);
const tieY = lm.eyes.r[1] - 0.12;
let anchor = null; for (let i = 0; i < n; i++) { if (Math.abs(HP[i * 3]) > 0.06 || Math.abs(HP[i * 3 + 1] - tieY) > 0.04 || lum(tex(i)) > 60) continue; if (!anchor || HP[i * 3 + 2] < anchor[2]) anchor = [HP[i * 3], HP[i * 3 + 1], HP[i * 3 + 2]]; }
if (!anchor) throw new Error("no hair at the back of the head to tie");
// the base body's back surface (min z near the centre line) by height, + clearance
const base = await loadBase(), BP = base.geo.P, backZ = (y) => { let z = 9; for (let i = 0; i < BP.length / 3; i++) if (Math.abs(BP[i * 3]) < 0.08 && Math.abs(BP[i * 3 + 1] - y) < 0.02) z = Math.min(z, BP[i * 3 + 2]); return z > 8 ? -0.12 : z; };
const R0 = 0.07, R1 = 0.03, clear = 0.03;
const pts = [new THREE.Vector3(0, anchor[1], anchor[2] + 0.02)];
for (const y of [anchor[1] - 0.12, 0.82, (0.82 + endY) / 2 + 0.03, endY]) pts.push(new THREE.Vector3(0, y, Math.min(anchor[2] + 0.02, backZ(y) - clear - R0 * 0.8)));
const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
// geometry: a gathered knot + a tapered, slightly flattened tail with strand striation
const P = [], I = [], COL = [], LEN = 60, SEG = 18;
for (let k = 0; k <= LEN; k++) { const t = k / LEN, c = curve.getPointAt(t), tg = curve.getTangentAt(t).normalize(), side = new THREE.Vector3(1, 0, 0), nr = new THREE.Vector3().crossVectors(tg, side).normalize();
  const r = (R0 + (R1 - R0) * t ** 0.8) * (t < 0.06 ? 1.25 - t * 4 : 1) * (t > 0.92 ? 1 - (t - 0.92) * 7 : 1);
  for (let s = 0; s < SEG; s++) { const a = (s / SEG) * 2 * Math.PI, sh = 0.82 + 0.18 * Math.sin(a * 7 + t * 3);
    const p = c.clone().addScaledVector(side, Math.cos(a) * r).addScaledVector(nr, Math.sin(a) * r * 0.75); P.push(p.x, p.y, p.z); COL.push(...hair.map((v) => Math.min(1, v * (0.75 + 0.5 * sh)))); } }
for (let k = 0; k < LEN; k++) for (let s = 0; s < SEG; s++) { const a = k * SEG + s, b = k * SEG + (s + 1) % SEG; I.push(a, b, a + SEG, b, b + SEG, a + SEG); }
{ const tip = curve.getPointAt(1), c0 = P.length / 3; P.push(tip.x, tip.y - 0.005, tip.z); COL.push(...hair); for (let s = 0; s < SEG; s++) I.push(LEN * SEG + s, LEN * SEG + (s + 1) % SEG, c0); }
// motion chain: 3 joints along the tail (hinge at the tie)
const JT = [0, 0.33, 0.66, 1].map((t) => curve.getPointAt(t));
const extraJoints = [0, 1, 2].map((k) => ({ name: `tail_${k}`, parent: k ? `tail_${k - 1}` : "Head", world: new THREE.Matrix4().makeTranslation(JT[k].x, JT[k].y, JT[k].z) }));
const chains = [{ id: "tail", joints: extraJoints.map((j) => j.name), hinge: JT[0].toArray(), ends: [JT[1].toArray(), JT[2].toArray(), JT[3].toArray()], hang: 0 }];
const nv = P.length / 3, Jw = new Uint8Array(nv * 4), Ww = new Float32Array(nv * 4), J0 = base.names.length;
for (let v = 0; v < nv; v++) { const k = Math.min(LEN, Math.floor(v / SEG)), t = k / LEN, f = Math.min(2.999, t * 3), seg = Math.floor(f), fr = f - seg;
  if (t < 0.08) { Jw[v * 4] = base.JI.Head; Ww[v * 4] = 1; continue; }
  Jw[v * 4] = J0 + seg; Ww[v * 4] = seg < 2 ? 1 - fr * 0.5 : 1; if (seg < 2) { Jw[v * 4 + 1] = J0 + seg + 1; Ww[v * 4 + 1] = fr * 0.5; } }
const Pf = Float32Array.from(P);
const bytes = await writeModule(`${BASE_OUT}/accessories/${outId}.glb`, base, [{ name: "accessory_hairtail", P: Pf, N: weldNormals(Pf, computeNormals(Pf, I)), I, COLOR: COL, J: Jw, W: Ww, material: { name: "accessory_hairtail", roughness: 0.55, doubleSided: true } }],
  { humanAccessory: { id: outId, slot: "accessory", base: C.HUMAN_BASE_VERSION, kind: "hair-tail", fittedTo: idFile.split("/").pop(), chains, hairMotion: "long" } }, { compress: false, extraJoints });
console.log(`${outId}: tie at ${anchor.map((v) => v.toFixed(3))} → end y ${endY} · hair rgb(${hair.map((v) => Math.round(v * 255)).join(",")}) · ${I.length / 3} tris · ${(bytes / 1024).toFixed(0)} KB`);
