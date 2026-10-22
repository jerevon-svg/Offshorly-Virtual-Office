// build-hair-flower.mjs — a MODULAR head/hair accessory (flower, clip …) fitted to an identity head. ZERO CREDITS.
//
//   node scripts/avatar-pipeline/human-base/build-hair-flower.mjs <identity.glb> <prep.json> <accessory-id> <source-sprite.png>
//
// PLACEMENT is face-relative and measured the same way in both spaces:
//   horizontal: (accessory centre − face centre) / face half-width AT THAT ROW (skin extent),
//   vertical:   (accessory centre − hairline) / (chin − hairline) at the face's centre column;
// in 3D the same numbers come from the identity head's own skin. The accessory is then SEATED on the outermost HAIR
// surface along the view direction at that point (it clips into hair, never onto skin), oriented to that surface.
// COLOUR is the robust median of the accessory's saturated region in the source (outlines and shading never decide it).
// SIZE is relative to the face width. Rigid on Head; removable like any accessory.
import fs from "node:fs";
import sharp from "sharp";
import * as C from "../../../src/dev/vo3d/human/humanBaseContract.ts";
import { BASE_OUT, computeNormals, io, loadBase, readIdentitySurface, weldNormals, writeModule } from "./lib.mjs";

const [idFile, prepFile, outId, srcFile] = process.argv.slice(2);
const prep = JSON.parse(fs.readFileSync(prepFile, "utf8"));
const acc = prep.accessories?.[0]; if (!acc) throw new Error(`no accessory recorded in ${prepFile}`);
const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2], skinish = (c) => c[0] > c[2] + 18 && c[0] > c[1] + 18 && lum(c) > 95;
const sat = (c) => { const mx = Math.max(...c), mn = Math.min(...c); return mx ? (mx - mn) / mx : 0; };

// ---- 2D: the accessory relative to the face, in the source sprite ----
const { data, info } = await sharp(srcFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, px = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2], data[i + 3]]; };
// V1.1: the accessory is LOCATED in the sprite itself — the largest strongly saturated, non-skin blob (prep boxes may be
// recorded on another resolution of the sprite); the recorded box is the fallback
const [bx0, by0, bx1, by1] = (() => { const H = info.height, m = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = px(x, y); if (c[3] > 200 && sat(c) > 0.5 && lum(c) > 35 && !skinish(c)) m[y * W + x] = 1; }
  let best = null; const seen = new Uint8Array(W * H);
  for (let k0 = 0; k0 < W * H; k0++) { if (!m[k0] || seen[k0]) continue; const q = [k0]; seen[k0] = 1; const b = [W, H, 0, 0];
    for (let h = 0; h < q.length; h++) { const k = q[h], x = k % W, y = (k / W) | 0; b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
      for (const k2 of [k - 1, k + 1, k - W, k + W]) if (k2 >= 0 && k2 < W * H && Math.abs((k2 % W) - x) <= 1 && m[k2] && !seen[k2]) { seen[k2] = 1; q.push(k2); } }
    if (!best || q.length > best.n) best = { n: q.length, b }; }
  return best && best.n > 200 ? best.b : acc.box; })(), ax = (bx0 + bx1) / 2, ay = (by0 + by1) / 2;
// the accessory's own (saturated) pixels: colour AND extent (V1.1 — the recorded box is loose; it also held hair around it)
const cols = [], ex = [1e9, 1e9, -1e9, -1e9]; for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) { const c = px(x, y); if (c[3] > 200 && sat(c) > 0.45 && lum(c) > 35) { cols.push(c); ex[0] = Math.min(ex[0], x); ex[1] = Math.min(ex[1], y); ex[2] = Math.max(ex[2], x); ex[3] = Math.max(ex[3], y); } }
const colour = [0, 1, 2].map((k) => cols.map((c) => c[k]).sort((a, b) => a - b)[cols.length >> 1] / 255);
const faceRow = (y) => { let l = W, r = -1; for (let x = 0; x < W; x++) { const c = px(x, y); if (c[3] > 200 && skinish(c) && !(x >= bx0 && x <= bx1 && y >= by0 && y <= by1)) { if (x < l) l = x; if (x > r) r = x; } } return r > l ? [l, r] : null; };
const chin2 = prep.clothingRemoved?.chinY ?? null; if (!chin2) throw new Error("prep.json has no chin (re-run prep-reference.mjs)");
const midRow = faceRow(Math.round((ay + chin2) / 2)) ?? faceRow(Math.round(ay)); const cx2 = (midRow[0] + midRow[1]) / 2;
let hair2 = null; for (let y = 0; y < chin2; y++) { const c = px(Math.round(cx2), y); if (c[3] > 200 && skinish(c)) { hair2 = y; break; } }
const rowA = faceRow(Math.round(ay)) ?? midRow, hw2 = (rowA[1] - rowA[0]) / 2;
const fx = (ax - cx2) / hw2, fy = (ay - hair2) / (chin2 - hair2), fr = (cols.length > 50 ? Math.max(ex[2] - ex[0], ex[3] - ex[1]) : Math.max(bx1 - bx0, by1 - by0)) / 2 / hw2;

// ---- 3D: the same quantities on the identity head ----
const doc = await io.read(idFile), lmId = doc.getRoot().listScenes()[0].getExtras().humanIdentity?.landmarks ?? {};
// V1.1: the identity's whole layered surface (head + hair layers share one texture); the fringe is foreground — a clip
// never seats on it
const SURF = await readIdentitySurface(doc, (nm) => nm.startsWith("identity_") && nm !== "identity_hair_fringe");
const HP = SURF.P, HN = SURF.N, UV = SURF.UV, n = HP.length / 3;
const { data: T, info: ti } = await sharp(SURF.texture).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const tex = (i) => { const u = Math.min(ti.width - 1, Math.max(0, Math.round((UV[i * 2] % 1) * (ti.width - 1)))), v = Math.min(ti.height - 1, Math.max(0, Math.round((UV[i * 2 + 1] % 1) * (ti.height - 1)))), o = (v * ti.width + u) * 3; return [T[o], T[o + 1], T[o + 2]]; };
const isSkin3 = (i) => SURF.layer[i] === "identity_head" && skinish(tex(i)), isHair3 = (i) => lum(tex(i)) < 60;   // face measured on the skin layer only
const front = (i) => HN[i * 3 + 2] > 0.2;
let cx3 = 0, cn = 0, chin3 = 9, hair3 = -9; for (let i = 0; i < n; i++) if (isSkin3(i) && front(i)) { cx3 += HP[i * 3]; cn++; } cx3 /= cn;
for (let i = 0; i < n; i++) if (isSkin3(i) && front(i) && Math.abs(HP[i * 3] - cx3) < 0.03) { chin3 = Math.min(chin3, HP[i * 3 + 1]); hair3 = Math.max(hair3, HP[i * 3 + 1]); }
const y3 = hair3 + fy * (chin3 - hair3);
let l3 = 9, r3 = -9; for (let i = 0; i < n; i++) if (isSkin3(i) && front(i) && Math.abs(HP[i * 3 + 1] - y3) < 0.015) { l3 = Math.min(l3, HP[i * 3]); r3 = Math.max(r3, HP[i * 3]); }
const hw3 = (r3 - l3) / 2, x3 = (l3 + r3) / 2 + fx * hw3, R = fr * hw3; if (process.env.DBG) console.log({ cx3, hair3, chin3, y3, l3, r3, hw3, R });
// seat: the frontmost HAIR vertex near (x3, y3) — widening the search until hair is found
let seat = null, sn = [0, 0, 1];
for (let rad = R * 0.4; !seat && rad < R * 4; rad *= 1.5) { let best = -9; for (let i = 0; i < n; i++) { if (!isHair3(i) || Math.hypot(HP[i * 3] - x3, HP[i * 3 + 1] - y3) > rad) continue; if (HP[i * 3 + 2] > best) { best = HP[i * 3 + 2]; seat = [HP[i * 3], HP[i * 3 + 1], HP[i * 3 + 2]]; } } }
if (!seat) throw new Error("no hair surface near the accessory position");
{ const m = [0, 0, 0]; for (let i = 0; i < n; i++) if (isHair3(i) && Math.hypot(HP[i * 3] - seat[0], HP[i * 3 + 1] - seat[1], HP[i * 3 + 2] - seat[2]) < R * 0.6) for (let k = 0; k < 3; k++) m[k] += HN[i * 3 + k]; const l = Math.hypot(...m) || 1; sn = m.map((v) => v / l); }

// ---- the flower: 5 cupped petals + a centre, in the seat's tangent frame, lifted just off the hair ----
const nrm = sn, u = (() => { const a = Math.abs(nrm[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]; const c = [a[1] * nrm[2] - a[2] * nrm[1], a[2] * nrm[0] - a[0] * nrm[2], a[0] * nrm[1] - a[1] * nrm[0]], l = Math.hypot(...c); return c.map((v) => v / l); })();
const v2 = [nrm[1] * u[2] - nrm[2] * u[1], nrm[2] * u[0] - nrm[0] * u[2], nrm[0] * u[1] - nrm[1] * u[0]];
const P = [], I = [], COL = [], lift = R * 0.08, centre = [0.95, 0.78, 0.3];
const LOC = [];   // V1.1 ATTACHMENT CONTRACT: the module's own local frame (+X = up × normal, +Y = toward the crown, +Z = out of the hair)
const add = (a, b, h, c) => { P.push(seat[0] + u[0] * a + v2[0] * b + nrm[0] * (h + lift), seat[1] + u[1] * a + v2[1] * b + nrm[1] * (h + lift), seat[2] + u[2] * a + v2[2] * b + nrm[2] * (h + lift)); LOC.push(a, b, h + lift); COL.push(...c); return P.length / 3 - 1; };
const PET = 5, SEG = 10, RIN = 6;
for (let p = 0; p < PET; p++) { const a0 = (p / PET) * 2 * Math.PI, ids = [];
  for (let r = 0; r <= RIN; r++) for (let s = 0; s <= SEG; s++) { const t = r / RIN, w = (s / SEG - 0.5) * 2, half = Math.sin(Math.PI * Math.min(1, t * 1.1)) * 0.55, ang = a0 + w * half * 0.7;
    const rr = R * (0.12 + 0.88 * t), h = R * (0.22 * t - 0.2 * t * t + 0.1 * (1 - Math.abs(w)) * t);
    ids.push(add(Math.cos(ang) * rr, Math.sin(ang) * rr, h, colour.map((c) => Math.min(1, c * (0.8 + 0.3 * t))))); }
  for (let r = 0; r < RIN; r++) for (let s = 0; s < SEG; s++) { const a = r * (SEG + 1) + s; I.push(ids[a], ids[a + 1], ids[a + SEG + 1], ids[a + 1], ids[a + SEG + 2], ids[a + SEG + 1]); } }
{ const c0 = add(0, 0, R * 0.14, centre), ring = []; for (let k = 0; k < 16; k++) { const a = (k / 16) * 2 * Math.PI; ring.push(add(Math.cos(a) * R * 0.15, Math.sin(a) * R * 0.15, R * 0.06, centre)); } for (let k = 0; k < 16; k++) I.push(c0, ring[k], ring[(k + 1) % 16]); }
const AC = lmId.attach?.centre ?? [0, 1.25, lmId.glassesFit?.ear?.[2] ?? 0], attachDir = (() => { const d = seat.map((v, k) => v - AC[k]), l = Math.hypot(...d); return d.map((v) => +(v / l).toFixed(4)); })();
const base = await loadBase(), nv = P.length / 3, Pf = Float32Array.from(P);
const bytes = await writeModule(`${BASE_OUT}/accessories/${outId}.glb`, base, [{ name: "accessory_flower", P: Pf, N: weldNormals(Pf, computeNormals(Pf, I)), I, COLOR: COL,
  J: new Uint8Array(nv * 4).map((_, k) => (k % 4 === 0 ? base.JI.Head : 0)), W: new Float32Array(nv * 4).map((_, k) => (k % 4 === 0 ? 1 : 0)), extraAttrs: { _ALOCAL: { type: "VEC3", array: Float32Array.from(LOC) } },
  material: { name: "accessory_flower", roughness: 0.6, doubleSided: true } }],
  // ATTACH (semantic, never XYZ): a direction on the wearer's OUTER hair envelope from the canonical skull centre — the runtime
  // (humanAccessoryFit.placeAccessory) seats the same flower on any hairstyle; positions above are only the preview fit
  { humanAccessory: { id: outId, slot: "accessory", base: C.HUMAN_BASE_VERSION, previewFittedTo: idFile.split("/").pop(), kind: "hair-flower", colour: colour.map((c) => +c.toFixed(3)),
    attach: { region: "hair", dir: attachDir, standoff: 0, scale: 1 } } }, { compress: false });
console.log(`${outId}: face-relative (${fx.toFixed(2)}, ${fy.toFixed(2)}) size ${fr.toFixed(2)} · colour rgb(${colour.map((c) => Math.round(c * 255)).join(",")}) from ${cols.length} px · seat ${seat.map((x) => x.toFixed(3))} on hair · ${I.length / 3} tris · ${(bytes / 1024).toFixed(0)} KB`);
