// underside-weld.test.mjs — the EXPERIMENTAL welded underside (underside-weld.mjs): welded exactly where skin bounds the opening, free
// under hair, and a safe fallback for every contour it cannot trust. From frontend/:
//   npx vitest run scripts/avatar-pipeline/human-base/underside-weld.test.mjs
import { describe, expect, it } from "vitest";
import { weldUnderside, tubeWall, WELD } from "./underside-weld.mjs";
import { bakeUndersideTexture } from "./underside-texture.mjs";

// a synthetic head bottom: a skin skirt round a neck axis (top at y 1.2, above the eye line; a jagged rim at ≈ y 1.0, r ≈ 0.30), a
// 36-gon neck tube (r 0.1), a canonical underside sheet rising gently outward
const NA = 72, eyeY = 1.15, iod = 0.36, tube = Array.from({ length: 36 }, (_, s) => { const t = ((s + 0.5) / 36) * 2 * Math.PI - Math.PI; return [0.1 * Math.cos(t), 0.1 * Math.sin(t)]; });
const neck = { cx: 0, cz: 0, wall: tubeWall(tube, 0, 0), y0: 0.8, y1: 1.05 }, sheet = (x, z) => { const r = Math.hypot(x, z); return r > 0.5 ? NaN : 0.98 + 0.05 * (r - 0.1); };
const at = (t, r, y) => [r * Math.cos(t), y, r * Math.sin(t)];
const skirt = ({ hairFrom = null, hairTo = null } = {}) => { const P = [], ring = (r, y, jag) => { const o = P.length / 3; for (let i = 0; i < NA; i++) P.push(...at((2 * Math.PI * i) / NA, r + (jag ? 0.004 * (i % 2) : 0), y + (jag ? 0.003 * (i % 2) : 0))); return o; };
  const r0 = ring(0.32, 1.2, false), r1 = ring(0.31, 1.1, false), r2 = ring(0.3, 1.0, true), skin = [], hair = [];
  for (const [a, b, lower] of [[r0, r1, false], [r1, r2, true]]) for (let i = 0; i < NA; i++) { const j = (i + 1) % NA, tris = [a + i, a + j, b + i, a + j, b + j, b + i];
    const deg = (360 * i) / NA; (lower && hairFrom !== null && deg >= hairFrom && deg < hairTo ? hair : skin).push(...tris); }
  return { P: Float32Array.from(P), skin, hair, rim: r2 }; };
const run = (parts, o = {}) => weldUnderside({ parts, neck, sheet, eyeY, iod, headJoint: 3, colourOf: () => [0.8, 0.6, 0.5], hairColour: [0.1, 0.1, 0.1], ...o });

describe("one welded underside (underside-weld.mjs)", () => {
  it("welds a clean skin rim exactly and closes the opening down to the neck tube", () => {
    const s = skirt(), r = run([{ name: "identity_head", P: s.P, I: s.skin }]); expect(r.info.reason).toBeUndefined(); expect(r.info.weldedVerts).toBe(NA);
    const has = new Set(); for (let v = 0; v < r.part.P.length / 3; v++) has.add([0, 1, 2].map((k) => r.part.P[v * 3 + k]).join(","));
    for (let i = 0; i < NA; i++) expect(has.has([0, 1, 2].map((k) => s.P[(s.rim + i) * 3 + k]).join(","))).toBe(true);   // the rim's very vertices
    // the union's open edges below the eye line: only the surface's own inner ring, ON the tube wall
    const key = (P, v) => [0, 1, 2].map((k) => Math.round(P[v * 3 + k] * 1e6)).join(","), use = new Map(), add = (P, I) => { for (let t = 0; t < I.length; t += 3) for (let q = 0; q < 3; q++) { const a = key(P, I[t + q]), b = key(P, I[t + (q + 1) % 3]), k = a < b ? a + "|" + b : b + "|" + a; use.set(k, (use.get(k) ?? 0) + 1); } };
    add(s.P, s.skin); add(r.part.P, r.part.I); let open = 0, offWall = 0;
    for (const [k, c] of use) { if (c !== 1) continue; const p = k.split("|")[0].split(",").map((x) => +x / 1e6); if (p[1] > eyeY) continue; open++; const rr = Math.hypot(p[0], p[2]), t = Math.atan2(p[2], p[0]); if (Math.abs(rr - neck.wall(t)) > 1e-4) offWall++; }
    expect(open).toBeGreaterThan(0); expect(offWall).toBe(0);
    expect(r.info.folded).toBe(0); expect(r.info.crossings).toBe(0);
  });
  it("never welds to hair: where hair bounds the opening the surface ends just inside it, free", () => {
    const s = skirt({ hairFrom: 0, hairTo: 90 }), r = run([{ name: "identity_head", P: s.P, I: s.skin }, { name: "identity_hair_back", P: s.P, I: s.hair }]);
    expect(r.part).not.toBeNull(); expect(r.info.freeVerts).toBeGreaterThan(0); expect(r.info.weldedVerts).toBeLessThan(NA); expect(r.info.weldedAngle).toBeLessThan(0.8);
    const hairRim = new Set(); for (let i = 0; i <= NA / 4; i++) hairRim.add([0, 1, 2].map((k) => s.P[(s.rim + (i % NA)) * 3 + k]).join(","));
    let onHair = 0; for (let v = 0; v < r.part.P.length / 3; v++) { const k = [0, 1, 2].map((q) => r.part.P[v * 3 + q]).join(","); if (hairRim.has(k)) onHair++; }
    expect(onHair).toBeLessThanOrEqual(2);   // at most the two skin/hair junction vertices
  });
  it("a hole in the skin (a loop that does not go round the neck) is not a rim", () => {
    const s = skirt(), P = Array.from(s.P), o = P.length / 3; P.push(...at(0.3, 0.36, 0.95), ...at(0.33, 0.36, 0.95), ...at(0.315, 0.37, 0.93));
    const r = run([{ name: "identity_head", P: Float32Array.from(P), I: [...s.skin, o, o + 1, o + 2] }]); expect(r.info.reason).toBeUndefined(); expect(r.info.weldedVerts).toBe(NA);
  });
  it("a skin rim closing round the neck by itself bounds the opening alone: a hair cap hanging lower further out is not welded", () => {
    const s = skirt(), P = Array.from(s.P), o = P.length / 3, K = NA / 3, cap = []; for (let i = 0; i <= K; i++) P.push(...at((2 * Math.PI * i) / NA, 0.36, 1.2), ...at((2 * Math.PI * i) / NA, 0.36, 0.97));
    for (let i = 0; i < K; i++) { const u = o + 2 * i, l = u + 1; cap.push(u, u + 2, l, u + 2, l + 2, l); }
    const r = run([{ name: "identity_head", P: Float32Array.from(P), I: s.skin }, { name: "identity_hair_base", P: Float32Array.from(P), I: cap }]);
    expect(r.info.reason).toBeUndefined(); expect(r.info.weldedVerts).toBe(NA); expect(r.info.weldedToCap).toBe(0); expect(r.info.crossings).toBe(0);
  });
  it("a rim touching itself (a hole pinched onto one of its vertices) is followed the way the surface runs: the hole drops out, the rim welds", () => {
    const s = skirt(), P = Array.from(s.P), o = P.length / 3, v = s.rim + 10; P.push(...at((2 * Math.PI * 10.3) / NA, 0.3, 0.96), ...at((2 * Math.PI * 9.7) / NA, 0.3, 0.96));
    const r = run([{ name: "identity_head", P: Float32Array.from(P), I: [...s.skin, v, o, o + 1] }]); expect(r.info.reason).toBeUndefined(); expect(r.info.selfTouching).toBe(1); expect(r.info.weldedVerts).toBe(NA); expect(r.info.foldBacks).toBe(0);
  });
  it("a rim that folds back about the neck by more than a ring step falls back", () => {
    const s = skirt(), P = Float32Array.from(s.P), e = WELD.ringEdgeIod * iod, back = (3 * e) / 0.3; for (let i = 20; i < 24; i++) { const t = (2 * Math.PI * 20) / NA - (i - 19) * back; P.set(at(t, 0.3, 1.0), (s.rim + i) * 3); }
    const r = run([{ name: "identity_head", P, I: s.skin }]); expect(r.part).toBeNull(); expect(r.info.reason).toMatch(/folds back|clean band/);
  });
  it("any other surface in the way stops the weld (hair hanging through the opening)", () => {
    const s = skirt(), P = Array.from(s.P), o = P.length / 3; P.push(...at(1, 0.2, 1.1), ...at(1.2, 0.2, 1.1), ...at(1.1, 0.2, 0.85));
    const r = run([{ name: "identity_head", P: s.P, I: s.skin }, { name: "identity_hair_main", P: Float32Array.from(P), I: [o, o + 1, o + 2] }]); expect(r.part).toBeNull(); expect(r.info.reason).toMatch(/cross/);
  });
  it("is deterministic", () => { const a = run([{ name: "identity_head", P: skirt().P, I: skirt().skin }]), b = run([{ name: "identity_head", P: skirt().P, I: skirt().skin }]);
    expect(Array.from(a.part.P)).toEqual(Array.from(b.part.P)); expect(a.part.I).toEqual(b.part.I); });
});

describe("map-driven welding (opt.openArea from coverage-map.mjs)", () => {
  const Mo = 720, binDeg = (j) => -180 + (j + 0.5) / 2, all = (v) => new Float64Array(Mo).fill(v), U = 0.36;
  it("with every angle open it is exactly the plain weld (map mode changes nothing where the whole ring is open)", () => {
    const s = skirt(), a = run([{ name: "identity_head", P: s.P, I: s.skin }]), b = run([{ name: "identity_head", P: s.P, I: s.skin }], { openArea: all(1), U });
    expect(Array.from(b.part.P)).toEqual(Array.from(a.part.P)); expect(b.part.I).toEqual(a.part.I); });
  // the skin reaching into the neck at the front: a fine skin sheet from a high ring down to a rim that dips smoothly into the neck tube over
  // 20°–140° (ramp° either side) — the coverage map finds no opening there; `rings` = skin rings between the top and the rim
  const dipHead = ({ na = 144, rings = 8, ramp = 60 } = {}) => { const dip = (deg) => { const d = Math.min(Math.abs(deg - 80), 360 - Math.abs(deg - 80)); if (d <= 60) return 1; if (d >= 60 + ramp) return 0; const u = (d - 60) / ramp; return 1 - u * u * (3 - 2 * u); };
    const P = []; for (let k = 0; k <= rings; k++) for (let i = 0; i < na; i++) { const t = (2 * Math.PI * i) / na, w = dip((t * 180) / Math.PI), f = k / rings; P.push(...at(t, 0.32 + (-0.02 - 0.22 * w) * f, 1.2 + (-0.2 - 0.05 * w) * (1 - (1 - f) * (1 - f)))); }
    const I = []; for (let k = 0; k < rings; k++) for (let i = 0; i < na; i++) { const j = (i + 1) % na, a = k * na, b = (k + 1) * na; I.push(a + i, a + j, b + i, a + j, b + j, b + i); }
    const open = all(1); for (let j = 0; j < Mo; j++) open[j] = 1 - dip((binDeg(j) + 360) % 360);
    return { part: { name: "identity_head", P: Float32Array.from(P), I }, open, na }; };
  const inClosed = (part) => { let n = 0; for (let t = 0; t < part.I.length; t += 3) { const c = [0, 2].map((k) => (part.P[part.I[t] * 3 + k] + part.P[part.I[t + 1] * 3 + k] + part.P[part.I[t + 2] * 3 + k]) / 3), deg = (Math.atan2(c[1], c[0]) * 180) / Math.PI; if (deg > 30 && deg < 130) n++; } return n; };
  it("where the skin itself reaches into the neck (no opening) the band gets no surface — it collapses and tapers, fold-, fin- and crossing-free", () => {
    for (const ramp of [60, 30]) { const h = dipHead({ ramp }), r = run([h.part], { openArea: h.open, U });
      expect(r.info.reason).toBeUndefined(); expect(r.info.crossings).toBe(0); expect(r.info.folded).toBe(0); expect(r.info.foldBacks).toBe(0); expect(r.info.fins).toBe(0);
      expect(r.info.weldedVerts).toBeGreaterThan(h.na / 3); expect(inClosed(r.part)).toBe(0); }   // inside the closed range (away from its tapers): nothing
  });
  it("one loop round the neck, tucked over part of its round, keeps one range — its tuck is closed, never 'rims interleave'", () => {
    const h = dipHead(), r = run([h.part], { openArea: h.open, U }); expect(r.info.rims).toBe(1); expect(r.info.weldedAngle).toBe(1);
    expect(r.info.tuckedVerts).toBeGreaterThan(0); expect(r.info.closedPinch).toBeGreaterThanOrEqual(r.info.tuckedVerts); });   // every tucked point is closed
  it("a coarse skin dipping steeply into the neck never ships a fold: it welds clean or falls back with the reason", () => {
    const h = dipHead({ na: 72, rings: 2, ramp: 30 }), r = run([h.part], { openArea: h.open, U }); expect(r.info.reason ?? "").not.toMatch(/interleave/);
    if (r.part) { expect(r.info.folded).toBe(0); expect(r.info.fins).toBe(0); expect(r.info.foldBacks).toBe(0); expect(r.info.crossings).toBe(0); } else expect(r.info.reason).toMatch(/fold|fin|cross/); });
  it("a rim inside the neck tube bounds no opening in map mode (a tucked sleeve is never the owner)", () => {
    const s = skirt(), P = Float32Array.from(s.P); for (let i = 0; i < NA; i++) { const t = (2 * Math.PI * i) / NA; P.set(at(t, 0.08, 1.0), (s.rim + i) * 3); }   // the rim pulled inside the tube (r 0.08 < 0.1)
    const plain = run([{ name: "identity_head", P, I: s.skin }]), mapped = run([{ name: "identity_head", P, I: s.skin }], { openArea: all(1), U });
    expect(plain.info.reason).toMatch(/tucked/); expect(mapped.info.reason ?? "").not.toMatch(/tucked into the neck all the way round/); });
});

describe("the welded underside wears the skin's own texture (underside-texture.mjs)", () => {
  // the skirt's UVs: u = angle / 2π, v from the top ring (0) to the rim (1); a texture whose red channel varies round the neck
  const TW = 128, TH = 32, tex = { width: TW, height: TH, channels: 3, data: new Uint8Array(TW * TH * 3).map((_, k) => { const x = Math.floor(k / 3) % TW, ch = k % 3; return ch === 0 ? Math.round(128 + 100 * Math.sin((4 * Math.PI * x) / TW)) : ch === 1 ? 110 : 90; }) };
  const bake = () => { const s = skirt(), UV = []; for (let v = 0; v < s.P.length / 3; v++) { const t = Math.atan2(s.P[v * 3 + 2], s.P[v * 3]), u = ((t / (2 * Math.PI)) % 1 + 1) % 1; UV.push(u, Math.min(1, (1.2 - s.P[v * 3 + 1]) / 0.2)); }
    const skinPart = { name: "identity_head", P: s.P, I: s.skin, UV: Float32Array.from(UV) }, w = run([skinPart]);
    return { w, b: bakeUndersideTexture({ part: w.part, strip: w.strip, skin: [skinPart], tex, hairColour: [0.1, 0.1, 0.1], ringEdge: w.info.ringEdge }) }; };
  it("its rim row reproduces the skin's own texels at the weld, deeper rows the rim's smoothed tone", () => { const { w, b } = bake(), W = b.image.width;
    let err = 0, n = 0; for (let i = 0; i < W; i += 8) { const R = w.strip.rim[Math.floor(((i + 0.5) / W) * w.strip.M) % w.strip.M], u = ((Math.atan2(R[2], R[0]) / (2 * Math.PI)) % 1 + 1) % 1, want = Math.round(128 + 100 * Math.sin(4 * Math.PI * u));
      err += Math.abs(b.image.data[i * 3] - want); n++; } expect(err / n).toBeLessThan(25);   // the texture varies by ±100 round the neck: the rim follows it
    const last = (b.image.height - 1) * W * 3; let spread = 0; for (let i = 0; i < W; i++) spread = Math.max(spread, Math.abs(b.image.data[last + i * 3] - b.image.data[last])); expect(spread).toBeLessThan(150);   // smoothed, not raw
  });
  it("no triangle spans the wrap round the neck; copies sit exactly on their originals (the weld is untouched)", () => { const { w, b } = bake(), p = b.part;
    for (let t = 0; t < p.I.length; t += 3) { const us = [0, 1, 2].map((q) => p.UV[p.I[t + q] * 2]); expect(Math.max(...us) - Math.min(...us)).toBeLessThanOrEqual(0.5); }
    const n0 = w.part.P.length / 3; for (let v = n0; v < p.P.length / 3; v++) { let found = false; for (let o = 0; o < n0 && !found; o++) found = p.P[v * 3] === w.part.P[o * 3] && p.P[v * 3 + 1] === w.part.P[o * 3 + 1] && p.P[v * 3 + 2] === w.part.P[o * 3 + 2]; expect(found).toBe(true); }
    expect(p.COLOR).toBeUndefined(); expect(p.UV.length / 2).toBe(p.P.length / 3);
  });
  it("is deterministic", () => { const a = bake().b, c = bake().b; expect(Array.from(a.image.data)).toEqual(Array.from(c.image.data)); expect(Array.from(a.part.UV)).toEqual(Array.from(c.part.UV)); });
  it("a hair column fades from the hair colour at the cap edge to the neck's own tone; every column ends in the neck tone at the neck", () => {
    const s = skirt({ hairFrom: 0, hairTo: 90 }), UV = []; for (let v = 0; v < s.P.length / 3; v++) { const t = Math.atan2(s.P[v * 3 + 2], s.P[v * 3]); UV.push(((t / (2 * Math.PI)) % 1 + 1) % 1, Math.min(1, (1.2 - s.P[v * 3 + 1]) / 0.2)); }
    const skinPart = { name: "identity_head", P: s.P, I: s.skin, UV: Float32Array.from(UV) }, w = run([skinPart, { name: "identity_hair_back", P: s.P, I: s.hair }]), neck = [0.9, 0.7, 0.6];
    const b = bakeUndersideTexture({ part: w.part, strip: w.strip, skin: [skinPart], tex, hairColour: [0.1, 0.1, 0.1], neckTone: neck, ringEdge: w.info.ringEdge }), W = b.image.width, Hh = b.image.height, px = (i, row) => [0, 1, 2].map((q) => b.image.data[(row * W + i) * 3 + q]);
    const binOf = (i) => Math.floor(((i + 0.5) / W) * w.strip.M) % w.strip.M, deep = (i) => Math.max(0, Math.floor((w.strip.wallDepth[binOf(i)] / w.strip.maxDepth) * Hh - 1)), far = (a, c) => Math.max(...a.map((x, q) => Math.abs(x - c[q] * 255)));
    const hairCol = [...Array(W).keys()].find((i) => [-W / 16, 0, W / 16].every((d) => w.strip.hairBin[binOf((i + d + W) % W)])), skinCol = [...Array(W).keys()].find((i) => [-W / 16, 0, W / 16].every((d) => !w.strip.hairBin[binOf((i + d + W) % W)]));
    expect(far(px(hairCol, 0), [0.1, 0.1, 0.1])).toBeLessThan(30);   // hair at the cap edge
    expect(far(px(hairCol, deep(hairCol)), neck)).toBeLessThan(25); expect(far(px(skinCol, deep(skinCol)), neck)).toBeLessThan(25);   // the neck's tone at the neck
  });
});

describe("two-rim openings: the rim-to-rim bridge (rim-bridge.mjs, opt-in rimBridge with the coverage map)", () => {
  // a head bottom with a SLOT at the back: the identity's own neck skin ends at an inner rim (r 0.13, y 0.93), the rigid hair-base cap at
  // an outer rim above and outside it (r 0.33, y 1.05); hair strips close the slot's two sides; elsewhere skin runs down into the neck
  // tube (a tucked loop). `curtain`: scalp hair hanging from outside the cap edge down across the slot (the cap edge poking through it)
  const Mo = 720, U = 0.36, NS = 144, T0 = -160, T1 = -20, SIDE = 10, PROF = [[0.32, 1.2], [0.33, 1.12], [0.33, 1.05], [0.29, 1.0], [0.22, 0.965], [0.16, 0.945], [0.13, 0.93], [0.105, 0.9], [0.08, 0.87]], RB = 2, RA = 6;
  const slot = ({ curtain = false } = {}) => { const P = [], deg = (i) => -180 + (360 * i) / NS; for (const [r, y] of PROF) for (let i = 0; i < NS; i++) P.push(...at((deg(i) * Math.PI) / 180, r, y));
    const parts = { identity_head: [], identity_hair_base: [], identity_hair_main: [] }, inSlot = (d) => d >= T0 && d < T1, inSide = (d) => (d >= T0 - SIDE && d < T0) || (d >= T1 && d < T1 + SIDE);
    for (let k = 0; k + 1 < PROF.length; k++) for (let i = 0; i < NS; i++) { const j = (i + 1) % NS, d = deg(i) + 180 / NS, quad = [k * NS + i, k * NS + j, (k + 1) * NS + i, k * NS + j, (k + 1) * NS + j, (k + 1) * NS + i];
      if (k >= RB && k < RA && inSlot(d)) continue; (k < RB && inSlot(d) ? parts.identity_hair_base : k >= RB && k < RA && inSide(d) ? parts.identity_hair_main : parts.identity_head).push(...quad); }
    const Pf = Float32Array.from(P), list = Object.entries(parts).map(([name, I]) => ({ name, P: Pf, I }));
    if (curtain) { const CP = [], CI = [], prof = [[0.36, 1.08], [0.3, 1.02], [0.24, 0.965], [0.2, 0.94]]; for (const [r, y] of prof) for (let i = 0; i <= 40; i++) CP.push(...at(((T0 + ((T1 - T0) * i) / 40) * Math.PI) / 180, r, y));
      for (let k = 0; k + 1 < prof.length; k++) for (let i = 0; i < 40; i++) { const a = k * 41 + i, b = (k + 1) * 41 + i; CI.push(a, a + 1, b, a + 1, b + 1, b); } list.push({ name: "identity_hair_scalp", P: Float32Array.from(CP), I: CI }); }
    const open = new Float64Array(Mo); for (let j = 0; j < Mo; j++) { const d = -180 + (j + 0.5) / 2; open[j] = d >= T0 && d < T1 ? 1 : 0; }
    return { parts: list, open, P: Pf }; };
  const rimOf = (s, k) => { const out = []; for (let i = 0; i < NS; i++) { const d = -180 + (360 * i) / NS; if (d >= T0 && d <= T1) out.push([0, 1, 2].map((q) => s.P[(k * NS + i) * 3 + q])); } return out; };
  it("a clean slot is bridged rim to rim: both rims welded exactly, nothing beyond the slot, fold-, fin- and crossing-free", () => {
    const s = slot(), r = run(s.parts, { openArea: s.open, U, rimBridge: true }); expect(r.info.reason).toBeUndefined(); expect(r.info.bridge).toBe(true);
    expect(r.info.crossings).toBe(0); expect(r.info.folded).toBe(0); expect(r.info.fins).toBe(0); expect(r.info.foldBacks).toBe(0);
    const has = new Set(); for (let v = 0; v < r.part.P.length / 3; v++) has.add([0, 1, 2].map((k) => r.part.P[v * 3 + k]).join(","));
    for (const k of [RA, RB]) for (const q of rimOf(s, k)) expect(has.has(q.join(","))).toBe(true);   // every rim vertex of the slot, exactly
    for (let t = 0; t < r.part.I.length; t += 3) { const c = [0, 2].map((k) => (r.part.P[r.part.I[t] * 3 + k] + r.part.P[r.part.I[t + 1] * 3 + k] + r.part.P[r.part.I[t + 2] * 3 + k]) / 3), d = (Math.atan2(c[1], c[0]) * 180) / Math.PI; expect(d).toBeGreaterThan(T0 - 1); expect(d).toBeLessThan(T1 + 1); }
    expect(r.strip.M).toBeGreaterThan(8); const b = run(s.parts, { openArea: s.open, U, rimBridge: true }); expect(Array.from(b.part.P)).toEqual(Array.from(r.part.P)); expect(b.part.I).toEqual(r.part.I);   // deterministic
  });
  it("hair hanging across the slot with the cap edge poking through it (Kael's case) is refused, never forced", () => {
    const s = slot({ curtain: true }), r = run(s.parts, { openArea: s.open, U, rimBridge: true }); expect(r.info.bridge?.bridge).toBe(true); expect(r.info.bridge.welded).toBe(true);
    expect(r.part === null || r.info.bridge !== true).toBe(true); expect(r.info.bridge.reason).toMatch(/cross|fold/); });
  it("off by default: without rimBridge the slot goes the old way, untouched", () => {
    const s = slot(), a = run(s.parts, { openArea: s.open, U }), b = run(s.parts, { openArea: s.open, U, rimBridge: false }); expect(a.info.bridge).toBeUndefined(); expect(a.info).toEqual(b.info); });
});

describe("the welded underside is lit as one surface (opt.litNormals)", () => {
  let s, base, lit; const both = () => { s = skirt(); const mk = () => [{ name: "identity_head", P: Float32Array.from(s.P), I: s.skin.slice() }]; base = run(mk()); lit = run(mk(), { litNormals: true }); };   // fresh inputs per run, as chibify builds them
  const onRim = (P, v) => { for (let i = 0; i < NA; i++) if ([0, 1, 2].every((k) => P[v * 3 + k] === s.P[(s.rim + i) * 3 + k])) return true; return false; };
  it("changes nothing but shading normals: geometry, topology, colour and the weld's own (skin) normals are identical", () => { both();
    expect(lit.info.reason).toBeUndefined(); expect(Array.from(lit.part.P)).toEqual(Array.from(base.part.P)); expect(Array.from(lit.part.I)).toEqual(Array.from(base.part.I));
    expect(Array.from(lit.part.COLOR ?? [])).toEqual(Array.from(base.part.COLOR ?? []));
    let weld = 0; for (let v = 0; v < base.part.P.length / 3; v++) if (onRim(base.part.P, v)) { weld++; for (let c = 0; c < 3; c++) expect(lit.part.N[v * 3 + c]).toBe(base.part.N[v * 3 + c]); }
    expect(weld).toBe(NA); });
  it("off the weld the normals no longer face down: they turn to the neck wall's outward normal, horizontal on the wall itself", () => { both();
    let sB = 0, sL = 0, n = 0, wallBad = 0, wall = 0; const P = lit.part.P;
    for (let v = 0; v < P.length / 3; v++) { if (onRim(P, v)) continue; n++; sB += base.part.N[v * 3 + 1]; sL += lit.part.N[v * 3 + 1];
      const r = Math.hypot(P[v * 3], P[v * 3 + 2]), t = Math.atan2(P[v * 3 + 2], P[v * 3]); if (Math.abs(r - neck.wall(t)) > 1e-6) continue; wall++;
      const out = [P[v * 3] / r, 0, P[v * 3 + 2] / r], dot = out[0] * lit.part.N[v * 3] + out[2] * lit.part.N[v * 3 + 2]; if (dot < 0.999 || Math.abs(lit.part.N[v * 3 + 1]) > 0.02) wallBad++; }
    expect(n).toBeGreaterThan(0); expect(wall).toBeGreaterThan(0); expect(wallBad).toBe(0); expect(sL / n).toBeGreaterThan(sB / n + 0.2); });
  it("normals stay unit length and the result is deterministic", () => { both();
    const again = run([{ name: "identity_head", P: Float32Array.from(s.P), I: s.skin.slice() }], { litNormals: true }); expect(Array.from(again.part.N)).toEqual(Array.from(lit.part.N));
    for (let v = 0; v < lit.part.N.length / 3; v++) expect(Math.abs(Math.hypot(lit.part.N[v * 3], lit.part.N[v * 3 + 1], lit.part.N[v * 3 + 2]) - 1)).toBeLessThan(1e-5); });
});
