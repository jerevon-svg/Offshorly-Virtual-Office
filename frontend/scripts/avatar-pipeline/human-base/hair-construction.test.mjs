// hair-construction.test.mjs — the 2026-10-10 construction invariants: hanging hair must be attached (hair-debris.mjs) and the
// closure interior stays inside every identity surface while smoothing their raggedness (head-closure.mjs). From frontend/:
//   npx vitest run scripts/avatar-pipeline/human-base/hair-construction.test.mjs
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { dropUnattachedHairDebris, NECK_COLUMN } from "./hair-debris.mjs";
import { interiorShell } from "./head-closure.mjs";
import { identityParts, visibleTriangles } from "./visibility.mjs";
import { fairSkinBoundaries } from "./boundary-fairing.mjs";
import { keepUndersideSheet } from "./underside-sheet.mjs";

const CLEAR = 0.045, ON = 0.005;
/** a small quad piece (2 triangles) of a hair layer at (x, y, z), half-size h */
const quad = (x, y, z, h = 0.01) => ({ P: [x - h, y, z, x + h, y, z, x + h, y - h, z, x - h, y - h, z], I: [0, 1, 2, 0, 2, 3] });
const part = (name, ...qs) => { const P = [], I = []; for (const q of qs) { const o = P.length / 3; P.push(...q.P); I.push(...q.I.map((i) => i + o)); } return { name, P: Float32Array.from(P), I }; };

describe("hanging hair must be attached (hair-debris.mjs)", () => {
  it("removes a piece welded to nothing inside the collar zone — and nothing else", () => {
    const debris = quad(0.18, 0.85, -0.013), above = quad(0.18, 1.02, -0.013), outside = quad(0.4, 0.85, -0.013), cap = quad(-0.18, 0.85, -0.013);
    const hair = part("identity_hair_main", debris, above, outside), base = part("identity_hair_base", cap), skin = part("identity_head", quad(0, 1.2, 0.3));
    const r = dropUnattachedHairDebris([skin, hair, base], { clearance: CLEAR, onSurface: ON });
    expect(r).toEqual({ pieces: 1, tris: 2 }); expect(hair.I.length).toBe(12); expect(base.I.length).toBe(6);   // above-zone + outside-zone kept; the cap is never hair debris
  });
  it("keeps an unwelded piece that LIES ON another surface (hair paint on the skin)", () => {
    const paint = quad(0.18, 0.85, -0.013), skin = part("identity_head", { P: [0.15, 0.87, -0.0131, 0.21, 0.87, -0.0131, 0.21, 0.83, -0.0131, 0.15, 0.83, -0.0131], I: [0, 1, 2, 0, 2, 3] }), hair = part("identity_hair_main", paint);
    expect(dropUnattachedHairDebris([skin, hair], { clearance: CLEAR, onSurface: ON }).pieces).toBe(0);   // 0.1 mm-eq off the skin: paint, not debris
  });
  it("keeps hanging hair that is welded to anything (rooted long hair)", () => {
    const strand = quad(0.18, 0.85, -0.013), root = part("identity_hair_scalp", { P: strand.P.slice(0, 6), I: [] }), hair = part("identity_hair_back", strand);
    root.P = Float32Array.from([...strand.P.slice(0, 3), ...strand.P.slice(3, 6), 0, 1, 0]); root.I = [0, 1, 2];   // shares two corners with the strand
    expect(dropUnattachedHairDebris([root, hair], { clearance: CLEAR, onSurface: ON }).pieces).toBe(0); expect(hair.I.length).toBe(6);
  });
  it("the collar zone is the neck-hair column plus chibify's hanging-hair clearance", async () => {
    const { CHIBI_RULES } = await import("./chibify.mjs"); expect(NECK_COLUMN).toMatchObject({ cx: 0, cz: -0.013, r: 0.17, yTop: 0.96 }); expect(CHIBI_RULES.hairClearance).toBe(CLEAR); expect(CHIBI_RULES.layers.clear).toBe(ON);
    expect(fs.readFileSync("scripts/avatar-pipeline/human-base/chibify.mjs", "utf8")).toMatch(/if \(y < 0\.78 \|\| y > 0\.96\) continue; if \(Math\.hypot\(P\[i \* 3\], P\[i \* 3 \+ 2\] \+ 0\.013\) < 0\.17\)/);   // neckHairClear's own column
  });
  it.runIf(fs.existsSync("scripts/avatar-pipeline/output/human-base/candidates/kael/corr-pass2/kael-v1.glb"))("real artifacts: the rejected head's collar debris goes; nothing VISIBLE leaves an approved head", async () => {
    const { NodeIO } = await import("@gltf-transform/core"), { ALL_EXTENSIONS } = await import("@gltf-transform/extensions"), draco3d = (await import("draco3dgltf")).default;
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "draco3d.decoder": await draco3d.createDecoderModule() });
    const run = async (file) => { const parts = identityParts(await io.read(file)), hair = parts.filter((p) => /^identity_hair_/.test(p.name) && p.name !== "identity_hair_base"), vis = visibleTriangles(parts, hair.map((p) => p.name));
      const before = hair.map((p) => Array.from(p.I)), r = dropUnattachedHairDebris(parts, { clearance: CLEAR, onSurface: ON });
      let visibleRemoved = 0; hair.forEach((p, k) => { const kept = new Set(); for (let t = 0; t < p.I.length; t += 3) kept.add(`${p.I[t]},${p.I[t + 1]},${p.I[t + 2]}`); const b = before[k]; for (let t = 0; t < b.length; t += 3) if (!kept.has(`${b[t]},${b[t + 1]},${b[t + 2]}`) && vis.get(p.name)[t / 3]) visibleRemoved++; });
      return { ...r, visibleRemoved }; };
    const kael = await run("scripts/avatar-pipeline/output/human-base/candidates/kael/corr-pass2/kael-v1.glb"); expect(kael.pieces).toBeGreaterThanOrEqual(4); expect(kael.visibleRemoved).toBeGreaterThan(100);
    for (const w of ["bon", "micah", "angelo", "clang", "france"]) expect((await run(`public/avatars/human-base-v1/production/${w}-v1.glb`)).visibleRemoved, w).toBe(0);
  }, 300000);
});

describe("the closure interior stays inside every identity surface and smooths its raggedness (head-closure.mjs)", () => {
  // a ragged identity sheet (a sphere of radius ~1 with seeded radial noise, like a cut rim) and a larger canonical 'Alex' sphere
  const sphere = (R, noise, seg = 48) => { const P = [], I = []; let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
    for (let a = 0; a <= seg; a++) for (let b = 0; b < seg; b++) { const th = (a / seg) * Math.PI, ph = (b / seg) * 2 * Math.PI, r = R * (1 + noise * rnd()); P.push(r * Math.sin(th) * Math.cos(ph), 1.25 + r * Math.cos(th), r * Math.sin(th) * Math.sin(ph)); }
    for (let a = 0; a < seg; a++) for (let b = 0; b < seg; b++) { const i0 = a * seg + b, i1 = a * seg + ((b + 1) % seg), i2 = (a + 1) * seg + b, i3 = (a + 1) * seg + ((b + 1) % seg); I.push(i0, i2, i1, i1, i2, i3); }
    return { P: Float32Array.from(P), I }; };
  const radius = (P, i) => Math.hypot(P[i * 3], P[i * 3 + 1] - 1.25, P[i * 3 + 2]);
  const rough = (P, I) => { let s = 0; for (let t = 0; t < I.length; t += 3) s += Math.abs(radius(P, I[t]) - radius(P, I[t + 1])) + Math.abs(radius(P, I[t + 1]) - radius(P, I[t + 2])); return s / I.length; };
  const id = sphere(0.4, 0.08), alex = sphere(0.5, 0), run = () => interiorShell({ ...alex, J: null, W: null }, [id], { centre: [0, 1.25, 0], margin: 0.01, alexInset: 0.008, colour: [1, 1, 1], headJoint: 0 }).part;
  /** the exact identity radius along the ray from the centre through (x,y,z) — Möller–Trumbore over the ragged sheet */
  const hitR = (x, y, z) => { const L = Math.hypot(x, y - 1.25, z), d = [x / L, (y - 1.25) / L, z / L]; let best = Infinity;
    for (let t = 0; t < id.I.length; t += 3) { const a = id.I[t] * 3, b = id.I[t + 1] * 3, c = id.I[t + 2] * 3, A = [id.P[a], id.P[a + 1] - 1.25, id.P[a + 2]], e1 = [id.P[b] - id.P[a], id.P[b + 1] - id.P[a + 1], id.P[b + 2] - id.P[a + 2]], e2 = [id.P[c] - id.P[a], id.P[c + 1] - id.P[a + 1], id.P[c + 2] - id.P[a + 2]];
      const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]], det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2]; if (Math.abs(det) < 1e-12) continue;
      const tv = [-A[0], -A[1], -A[2]], u = (tv[0] * p[0] + tv[1] * p[1] + tv[2] * p[2]) / det; if (u < 0 || u > 1) continue; const q = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]];
      const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det; if (v < 0 || u + v > 1) continue; const r = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det; if (r > 0) best = Math.min(best, r); } return best; };
  it("never outside the identity surface: along every shell vertex's own direction the ragged sheet is farther out", () => {
    const shell = run(); let worst = -Infinity; for (let i = 0; i < shell.P.length / 3; i += 3) { const r = radius(shell.P, i), h = hitR(shell.P[i * 3], shell.P[i * 3 + 1], shell.P[i * 3 + 2]); if (h < Infinity) worst = Math.max(worst, r - h); }
    expect(worst).toBeLessThanOrEqual(0);
  });
  it("smoother than the ragged surface it sits inside, and deterministic", () => {
    const a = run(), b = run(); expect(Array.from(a.P)).toEqual(Array.from(b.P)); expect(rough(a.P, a.I)).toBeLessThan(0.5 * rough(id.P, id.I));   // at least 2× smoother than the ragged sheet
  });
});

describe("the skin's boundary curves are smooth (boundary-fairing.mjs)", () => {
  // a flat 24×24 grid (z = 0, normals +z); HEAD cells left of a one-cell zigzag (the whole-triangle staircase every split leaves)
  const G = 24, grid = () => { const P = [], N = [], I = [], head = []; for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) { P.push(i / G, j / G, 0); N.push(0, 0, 1); }
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { const a = j * (G + 1) + i, b = a + 1, c = a + G + 1, d = c + 1, h = i < 12 + (j % 2); I.push(a, b, d, a, d, c); head.push(h, h); }
    return { P: Float32Array.from(P), N: Float32Array.from(N), I, head }; };
  const run = () => { const g = grid(), r = fairSkinBoundaries({ P: g.P, N: g.N, I: g.I, isHeadTri: (t) => g.head[t], active: (v) => { const x = g.P[v * 3], y = g.P[v * 3 + 1]; return x > 0.05 && x < 0.95 && y > 0.05 && y < 0.95; } }); return { g, r }; };
  it("straightens the staircase: jaggedness falls by more than half", () => { const { r } = run(); expect(r.curves).toBeGreaterThan(10); expect(r.jaggedAfter).toBeLessThan(0.5 * r.jaggedBefore); });
  it("moves only within the surface and only near the curve (no crack: shared vertices move once, together)", () => {
    const { g } = run(), o = grid(); let far = 0; for (let v = 0; v < g.P.length / 3; v++) { expect(g.P[v * 3 + 2]).toBe(0); if (Math.abs(o.P[v * 3] - 12.5 / G) > 5 / G && (g.P[v * 3] !== o.P[v * 3] || g.P[v * 3 + 1] !== o.P[v * 3 + 1])) far++; }
    expect(far).toBe(0);
  });
  it("is deterministic", () => { expect(Array.from(run().g.P)).toEqual(Array.from(run().g.P)); });
  it("never collapses a small closed loop (a hole keeps its size) and no curve vertex moves beyond half its own curve edges", () => {
    // a 16-gon hole in a flat sheet: ring of HEAD triangles around an empty centre (the hole's rim is a closed skin boundary)
    const K = 16, P = [], I = [], head = []; for (let k = 0; k < K; k++) { const a = (k / K) * 2 * Math.PI, z = k % 2 ? 0.012 : -0.012; P.push(Math.cos(a) * (0.1 + z), Math.sin(a) * (0.1 + z), 0, Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0); }
    for (let k = 0; k < K; k++) { const i0 = 2 * k, o0 = 2 * k + 1, i1 = (2 * k + 2) % (2 * K), o1 = (2 * k + 3) % (2 * K); I.push(i0, o0, o1, i0, o1, i1); head.push(true, true); }
    const P0 = Float32Array.from(P), Pm = Float32Array.from(P), N = new Float32Array(P.length).map((_, i) => (i % 3 === 2 ? 1 : 0));
    fairSkinBoundaries({ P: Pm, N, I, isHeadTri: (t) => head[t] });
    const rIn = (Q) => { let s = 0; for (let k = 0; k < K; k++) s += Math.hypot(Q[k * 6], Q[k * 6 + 1]); return s / K; }; expect(rIn(Pm) / rIn(P0)).toBeGreaterThan(0.9);   // no shrink to the centre
    for (let k = 0; k < K; k++) { const v = 2 * k, a = 2 * ((k + K - 1) % K), b = 2 * ((k + 1) % K), e = (Math.hypot(P0[a * 3] - P0[v * 3], P0[a * 3 + 1] - P0[v * 3 + 1]) + Math.hypot(P0[b * 3] - P0[v * 3], P0[b * 3 + 1] - P0[v * 3 + 1])) / 2;
      expect(Math.hypot(Pm[v * 3] - P0[v * 3], Pm[v * 3 + 1] - P0[v * 3 + 1])).toBeLessThanOrEqual(0.5 * e + 1e-6); }
  });
  it("never moves anything outside the active region — not even the fade", () => {
    const g = grid(), o = grid(); fairSkinBoundaries({ P: g.P, N: g.N, I: g.I, isHeadTri: (t) => g.head[t], active: (v) => g.P[v * 3 + 1] < 0.5 });   // only the lower half may move
    for (let v = 0; v < g.P.length / 3; v++) if (o.P[v * 3 + 1] >= 0.5) { expect(g.P[v * 3]).toBe(o.P[v * 3]); expect(g.P[v * 3 + 1]).toBe(o.P[v * 3 + 1]); }
  });
  it("a staircase is at the mesh's own scale: where the boundary's edges are 10× longer, nothing moves beyond `cap` × the median edge", () => {
    const g = grid(); for (let j = 0; j <= G; j++) if (j > 18) for (let i = 0; i <= G; i++) g.P[(j * (G + 1) + i) * 3 + 1] = 18 / G + (j - 18) * 10 / G;   // rows above 18 stretched 10×
    const P0 = g.P.slice(); fairSkinBoundaries({ P: g.P, N: g.N, I: g.I, isHeadTri: (t) => g.head[t], active: (v) => { const x = P0[v * 3]; return x > 0.05 && x < 0.95; } });
    let worst = 0; for (let v = 0; v < g.P.length / 3; v++) worst = Math.max(worst, Math.hypot(g.P[v * 3] - P0[v * 3], g.P[v * 3 + 1] - P0[v * 3 + 1]));
    expect(worst).toBeGreaterThan(0); expect(worst).toBeLessThanOrEqual(0.5 * (1 / G) * 1.5 + 1e-6);   // the median boundary edge ≈ one fine cell (1–1.5 cells along the zigzag)
  });
  it("on a coarse curved surface every moved vertex stays within `clear` of its own triangles' planes (and would not without the limit)", () => {
    // a coarse sphere patch (radius 0.5, cells ≈ 0.13 — the coarse skin under the hair): the staircase split, normals radial
    const C = 6, sphere = () => { const P = [], N = [], I = [], head = []; for (let j = 0; j <= C; j++) for (let i = 0; i <= C; i++) { const a = (i / C - 0.5) * 1.6, b = (j / C - 0.5) * 1.6, n = [Math.sin(a) * Math.cos(b), Math.sin(b), Math.cos(a) * Math.cos(b)]; P.push(...n.map((x) => 0.5 * x)); N.push(...n); }
      for (let j = 0; j < C; j++) for (let i = 0; i < C; i++) { const a = j * (C + 1) + i, b = a + 1, c = a + C + 1, d = c + 1, h = i < C / 2 + (j % 2); I.push(a, b, d, a, d, c); head.push(h, h); } return { P: Float32Array.from(P), N: Float32Array.from(N), I, head }; };
    const worst = (clear) => { const g = sphere(), P0 = g.P.slice(); fairSkinBoundaries({ P: g.P, N: g.N, I: g.I, isHeadTri: (t) => g.head[t], ...(clear === undefined ? {} : { clear }) }); let w = 0;
      for (let t = 0; t < g.I.length / 3; t++) { const [a, b, c] = [g.I[t * 3], g.I[t * 3 + 1], g.I[t * 3 + 2]], e1 = [0, 1, 2].map((k) => P0[b * 3 + k] - P0[a * 3 + k]), e2 = [0, 1, 2].map((k) => P0[c * 3 + k] - P0[a * 3 + k]), n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], l = Math.hypot(...n);
        for (const v of [a, b, c]) w = Math.max(w, Math.abs([0, 1, 2].reduce((s2, k) => s2 + (g.P[v * 3 + k] - P0[v * 3 + k]) * n[k], 0)) / l); } return w; };
    expect(worst()).toBeLessThanOrEqual(0.005 + 1e-6); expect(worst(Infinity)).toBeGreaterThan(0.005);
  });
  it("a coarse edge never drags fine hair: nothing folds, a vertex stops short of its fine triangles' opposite edges", () => {
    // the staircase grid plus a fine hair rosette (four triangles a tenth of a cell across) around every vertex of the zigzag
    const g = grid(), e = 0.1 / G, P = Array.from(g.P), N = Array.from(g.N), I = [...g.I], head = [...g.head], zig = [];
    for (let j = 1; j < G; j++) for (const i of [12, 13]) { const v = j * (G + 1) + i, x = P[v * 3], y = P[v * 3 + 1], k = P.length / 3; zig.push(v);
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) { P.push(x + dx * e, y + dy * e, 0); N.push(0, 0, 1); }
      for (let q = 0; q < 4; q++) { I.push(v, k + q, k + ((q + 1) % 4)); head.push(false); } }
    // …also when the rosette is NOT live (a lifted lock welded to the curve: it moves with the point, so the limits must see it)
    for (const live of [undefined, (t) => t < g.I.length / 3]) {
      const P0 = Float32Array.from(P), Pm = Float32Array.from(P), r = fairSkinBoundaries({ P: Pm, N: Float32Array.from(N), I, isHeadTri: (t) => head[t], ...(live ? { live } : {}), active: (v) => { const x = P0[v * 3], y = P0[v * 3 + 1]; return x > 0.05 && x < 0.95 && y > 0.05 && y < 0.95; } });
      const area = (Q, t) => { const [a, b, c] = [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]]; return (Q[b * 3] - Q[a * 3]) * (Q[c * 3 + 1] - Q[a * 3 + 1]) - (Q[c * 3] - Q[a * 3]) * (Q[b * 3 + 1] - Q[a * 3 + 1]); };
      expect(r.moved).toBeGreaterThan(0); for (let t = 0; t < I.length / 3; t++) { const a0 = area(P0, t), a1 = area(Pm, t); expect(Math.sign(a1)).toBe(Math.sign(a0)); expect(Math.abs(a1)).toBeGreaterThan(0); }
      for (const v of zig) expect(Math.hypot(Pm[v * 3] - P0[v * 3], Pm[v * 3 + 1] - P0[v * 3 + 1])).toBeLessThanOrEqual(0.5 * e + 1e-6); }
  });
  // the opt-in experiment (2026-10-13, default OFF): localScale — the median edge along the curve, not over the region
  it("localScale: a coarse staircase beside a long fine one smooths at its OWN scale (the region median held it to the fine one); the fine one is untouched; a few long slivers stay capped", () => {
    // the fine staircase grid + a coarse copy (cells 8× larger, at x ≥ 2): the fine curve's vertices dominate the region's median edge
    const two = () => { const g = grid(), P = Array.from(g.P), N = Array.from(g.N), I = [...g.I], head = [...g.head], C = 6, s = 8 / G, o = P.length / 3;
      for (let j = 0; j <= C; j++) for (let i = 0; i <= C; i++) { P.push(2 + i * s, j * s, 0); N.push(0, 0, 1); }
      for (let j = 0; j < C; j++) for (let i = 0; i < C; i++) { const a = o + j * (C + 1) + i, b = a + 1, c = a + C + 1, d = c + 1, h = i < 3 + (j % 2); I.push(a, b, d, a, d, c); head.push(h, h); }
      return { P: Float32Array.from(P), N: Float32Array.from(N), I, head }; };
    const act = (P0) => (v) => { const x = P0[v * 3], y = P0[v * 3 + 1]; return x < 1.5 ? x > 0.05 && x < 0.95 && y > 0.05 && y < 0.95 : x > 2.2 && x < 2 + 6 * (8 / G) - 0.2 && y > 0.2 && y < 6 * (8 / G) - 0.2; };
    const runT = (o) => { const g = two(), P0 = g.P.slice(), r = fairSkinBoundaries({ P: g.P, N: g.N, I: g.I, isHeadTri: (t) => g.head[t], active: act(P0), diagnose: true, region: (v) => (P0[v * 3] > 1.5 ? "coarse" : "fine"), ...o }); return { g, d: r.diag }; };
    const base = runT({}), loc = runT({ localScale: true });
    expect(base.d.coarse.bendAfter).toBeGreaterThan(0.8 * base.d.coarse.bendBefore); expect(loc.d.coarse.bendAfter).toBeLessThan(0.5 * loc.d.coarse.bendBefore);
    for (let v = 0; v < (G + 1) * (G + 1); v++) expect(Math.hypot(loc.g.P[v * 3] - base.g.P[v * 3], loc.g.P[v * 3 + 1] - base.g.P[v * 3 + 1])).toBeLessThan(1e-6);   // (float rounding: a median of edges vs of edge means)
    // the v5 case (rows above 18 stretched 10×) keeps its bound
    const g = grid(); for (let j = 19; j <= G; j++) for (let i = 0; i <= G; i++) g.P[(j * (G + 1) + i) * 3 + 1] = 18 / G + (j - 18) * 10 / G;
    const P0 = g.P.slice(); fairSkinBoundaries({ P: g.P, N: g.N, I: g.I, isHeadTri: (t) => g.head[t], active: (v) => { const x = P0[v * 3]; return x > 0.05 && x < 0.95; }, localScale: true });
    let worst = 0; for (let v = 0; v < g.P.length / 3; v++) worst = Math.max(worst, Math.hypot(g.P[v * 3] - P0[v * 3], g.P[v * 3 + 1] - P0[v * 3 + 1])); expect(worst).toBeLessThanOrEqual(0.5 * (1 / G) * 1.5 + 1e-6);
  });
  for (const mode of [{ localScale: true }]) {
    const tag = Object.keys(mode).join("+"), runM = () => { const g = grid(), r = fairSkinBoundaries({ P: g.P, N: g.N, I: g.I, isHeadTri: (t) => g.head[t], active: (v) => { const x = g.P[v * 3], y = g.P[v * 3 + 1]; return x > 0.05 && x < 0.95 && y > 0.05 && y < 0.95; }, diagnose: true, ...mode }); return { g, r }; };
    // the BEND (distance from the neighbours' chord, diagnostics) — what the eye reads as a staircase
    it(`${tag}: still straightens the staircase (bend falls by more than half), within the surface, deterministically`, () => {
      const { g, r } = runM(), d = r.diag.all; expect(d.bendAfter).toBeLessThan(0.5 * d.bendBefore); for (let v = 0; v < g.P.length / 3; v++) expect(g.P[v * 3 + 2]).toBe(0);
      expect(Array.from(runM().g.P)).toEqual(Array.from(g.P));
    });
    it(`${tag}: keeps every safeguard — no fold around fine hair, the hole keeps its size, nothing outside the active region moves`, () => {
      const g = grid(), e = 0.1 / G, P = Array.from(g.P), N = Array.from(g.N), I = [...g.I], head = [...g.head];
      for (let j = 1; j < G; j++) for (const i of [12, 13]) { const v = j * (G + 1) + i, x = P[v * 3], y = P[v * 3 + 1], k = P.length / 3;
        for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) { P.push(x + dx * e, y + dy * e, 0); N.push(0, 0, 1); }
        for (let q = 0; q < 4; q++) { I.push(v, k + q, k + ((q + 1) % 4)); head.push(false); } }
      const P0 = Float32Array.from(P), Pm = Float32Array.from(P), r = fairSkinBoundaries({ P: Pm, N: Float32Array.from(N), I, isHeadTri: (t) => head[t], active: (v) => P0[v * 3 + 1] < 0.5 && P0[v * 3 + 1] > 0.05, ...mode });
      const area = (Q, t) => { const [a, b, c] = [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]]; return (Q[b * 3] - Q[a * 3]) * (Q[c * 3 + 1] - Q[a * 3 + 1]) - (Q[c * 3] - Q[a * 3]) * (Q[b * 3 + 1] - Q[a * 3 + 1]); };
      expect(r.moved).toBeGreaterThan(0); for (let t = 0; t < I.length / 3; t++) { expect(Math.sign(area(Pm, t))).toBe(Math.sign(area(P0, t))); expect(Math.abs(area(Pm, t))).toBeGreaterThan(0); }
      for (let v = 0; v < Pm.length / 3; v++) if (P0[v * 3 + 1] >= 0.5) { expect(Pm[v * 3]).toBe(P0[v * 3]); expect(Pm[v * 3 + 1]).toBe(P0[v * 3 + 1]); }
      const K = 16, H = [], HI = [], hh = []; for (let k = 0; k < K; k++) { const a = (k / K) * 2 * Math.PI, z = k % 2 ? 0.012 : -0.012; H.push(Math.cos(a) * (0.1 + z), Math.sin(a) * (0.1 + z), 0, Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0); }
      for (let k = 0; k < K; k++) { const i0 = 2 * k, o0 = 2 * k + 1, i1 = (2 * k + 2) % (2 * K), o1 = (2 * k + 3) % (2 * K); HI.push(i0, o0, o1, i0, o1, i1); hh.push(true, true); }
      const H0 = Float32Array.from(H), Hm = Float32Array.from(H); fairSkinBoundaries({ P: Hm, N: new Float32Array(H.length).map((_, i) => (i % 3 === 2 ? 1 : 0)), I: HI, isHeadTri: (t) => hh[t], ...mode });
      const rIn = (Q) => { let s = 0; for (let k = 0; k < K; k++) s += Math.hypot(Q[k * 6], Q[k * 6 + 1]); return s / K; }; expect(rIn(Hm) / rIn(H0)).toBeGreaterThan(0.9);
    });
  }
});

describe("the head's underside is one sheet (underside-sheet.mjs keepUndersideSheet)", () => {
  // a 40×40 field (cell 0.005): a sloped sheet around an opening at the centre (empty), plus patches elsewhere
  const G = { nx: 40, nz: 40, c: 0.005 }, DOWN = -0.3, field = () => { const ug = new Float32Array(G.nx * G.nz).fill(9);
    for (let zz = 0; zz < G.nz; zz++) for (let xx = 0; xx < 30; xx++) { const r = Math.hypot(xx - 15, zz - 20); if (r > 4 && r < 12) ug[zz * G.nx + xx] = 1 + 0.004 * r; } return ug; };
  const seed = (xx, zz) => Math.hypot(xx - 15, zz - 20) < 6;
  it("keeps the sheet around the opening and drops a detached raised patch (a protrusion's own underside)", () => {
    const ug = field(); for (let zz = 16; zz < 24; zz++) for (let xx = 33; xx < 38; xx++) ug[zz * G.nx + xx] = 1.14;   // the 'ear': separate, higher
    const r = keepUndersideSheet(ug, G, seed, DOWN); expect(r.dropped).toBe(40); expect(r.filled).toBe(0); expect(ug[20 * G.nx + 35]).toBe(9); expect(ug[20 * G.nx + 15 + 8]).toBeLessThan(8); });
  it("a raised patch touching the sheet (steeper than any downward-facing face) is replaced by the sheet continued under it", () => {
    const ug = field(), edge = 1 + 0.004 * 11; for (let zz = 16; zz < 24; zz++) for (let xx = 26; xx < 32; xx++) ug[zz * G.nx + xx] = 1.14;   // overlaps the sheet's edge
    const r = keepUndersideSheet(ug, G, seed, DOWN); expect(r.dropped).toBe(48); expect(r.filled).toBe(48);
    for (let zz = 16; zz < 24; zz++) for (let xx = 26; xx < 32; xx++) { expect(ug[zz * G.nx + xx]).toBeGreaterThan(1.03); expect(ug[zz * G.nx + xx]).toBeLessThan(edge + 0.005); } });
  it("keeps a patch that continues the sheet with a gentle slope", () => {
    const ug = field(); for (let zz = 16; zz < 24; zz++) for (let xx = 27; xx < 38; xx++) ug[zz * G.nx + xx] = 1 + 0.004 * 11 + 0.01 * (xx - 26);
    const r = keepUndersideSheet(ug, G, seed, DOWN); expect(r.dropped).toBe(0); });
  it("leaves the field unchanged without a seed", () => { const ug = field(), u0 = ug.slice(); expect(keepUndersideSheet(ug, G, () => false, DOWN)).toEqual({ kept: 0, dropped: 0 }); expect(ug).toEqual(u0); });
});
