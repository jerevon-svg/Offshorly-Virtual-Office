import { describe, expect, it } from "vitest";
import { fitGlassesPositions, type GlassesDesign, type GlassesFitData } from "./humanGlasses";

// a synthetic face: a sphere (radius 0.45 about (0, 1.2, -0.12)) — the fit must hold for any face it is given
const C = [0, 1.2, -0.12], RAD = 0.45;
const sphereZ = (x: number, y: number) => { const d = RAD * RAD - x * x - (y - C[1]) ** 2; return d > 0 ? C[2] + Math.sqrt(d) : null; };
function fitData(): GlassesFitData {
  const grid = { x0: -0.55, y0: 0.9, dx: 0.025, dy: 0.02, nx: 45, ny: 27, z: [] as (number | null)[] };
  for (let j = 0; j < grid.ny; j++) for (let i = 0; i < grid.nx; i++) grid.z.push(sphereZ(grid.x0 + i * grid.dx, grid.y0 + j * grid.dy));
  const side = { y: [1.17, 1.22, 1.27], z0: 0.3, dz: -0.025, n: 18, x: [] as (number | null)[][] };
  for (const y of side.y) side.x.push(Array.from({ length: side.n }, (_, k) => { const z = side.z0 + k * side.dz, d = RAD * RAD - (y - C[1]) ** 2 - (z - C[2]) ** 2; return d > 0 ? Math.sqrt(d) : null; }));
  return { v: 1, grid, faceHalfW: 0.4, side, ear: [0.44, 1.2, -0.12] };
}
const design: GlassesDesign = { lens: { dx: 0.03, dy: -0.02, halfW: 0.36, halfH: 0.25 }, hingeX: 0.87, templeY: 0.12, standoff: 0.03, wrap: 0.6, rimDepth: 0.04 };
const eyes = { l: [-0.18, 1.2, 0.3], r: [0.18, 1.2, 0.3] };
// fit-space geometry: both rims (front + back face), and both temples
const G: number[] = [];
for (const sx of [1, -1]) for (let k = 0; k < 48; k++) { const a = (k / 48) * 2 * Math.PI; for (const dz of [0, -0.04]) G.push(0, sx * (0.53 + Math.cos(a) * 0.36), -0.02 + Math.sin(a) * 0.25, dz); }
for (const part of [1, 2]) for (let k = 0; k <= 20; k++) G.push(part, k / 20, 0, 0);

describe("glasses fitting (fit space → any identity)", () => {
  const P = fitGlassesPositions(G, design, eyes, fitData()), n = G.length / 4;
  it("keeps every frame vertex in front of the face", () => {
    for (let i = 0; i < n; i++) { if (G[i * 4] !== 0) continue; const z = sphereZ(P[i * 3], P[i * 3 + 1]); if (z !== null) expect(P[i * 3 + 2]).toBeGreaterThan(z); }
  });
  it("is mirror-symmetric", () => {
    const front = []; for (let i = 0; i < n; i++) if (G[i * 4] === 0) front.push(i);
    const half = front.length / 2; for (let k = 0; k < half; k++) { const a = front[k], b = front[k + half]; expect(P[a * 3] + P[b * 3]).toBeCloseTo(0, 5); expect(P[a * 3 + 1]).toBeCloseTo(P[b * 3 + 1], 5); expect(P[a * 3 + 2]).toBeCloseTo(P[b * 3 + 2], 5); }
  });
  it("runs the temples outside the head back to the ears (then tucks behind them)", () => {
    for (let i = 0; i < n; i++) { if (G[i * 4] === 0 || G[i * 4 + 1] > 0.85) continue; const d = Math.hypot(P[i * 3] - C[0], P[i * 3 + 1] - C[1], P[i * 3 + 2] - C[2]); expect(d).toBeGreaterThan(RAD - 0.02); }
    const tip = n - 1; expect(P[tip * 3 + 2]).toBeLessThan(-0.12);   // tucked behind the ear root
  });
  it("scales the style UNIFORMLY from the eyes (a lens keeps its aspect) and centres each lens on its eye", () => {
    const lens = (sg: number) => { let x0 = 9, x1 = -9, y0 = 9, y1 = -9; for (let i = 0; i < n; i++) if (G[i * 4] === 0 && G[i * 4 + 3] === 0 && Math.sign(G[i * 4 + 1]) === sg) { x0 = Math.min(x0, P[i * 3]); x1 = Math.max(x1, P[i * 3]); y0 = Math.min(y0, P[i * 3 + 1]); y1 = Math.max(y1, P[i * 3 + 1]); } return { w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2 }; };
    const L = lens(1); expect(L.w / L.h).toBeCloseTo(0.36 / 0.25, 1); expect(Math.abs(L.cx - 0.53 * 0.36)).toBeLessThan(0.04);
  });
});

// the SAME style on different faces: narrow / wide / deep / shallow spheres (radius, depth offset) — always in front of
// the face, centred on the eyes, temples over the ears, the lens aspect unchanged
describe("one glasses style fits every face", () => {
  const face = (rad: number, dz: number) => { const c = [0, 1.2, -0.12 + dz], zf = (x: number, y: number) => { const d = rad * rad - x * x - (y - c[1]) ** 2; return d > 0 ? c[2] + Math.sqrt(d) : null; };
    const grid = { x0: -0.55, y0: 0.9, dx: 0.025, dy: 0.02, nx: 45, ny: 27, z: [] as (number | null)[] }; for (let j = 0; j < grid.ny; j++) for (let i = 0; i < grid.nx; i++) grid.z.push(zf(grid.x0 + i * grid.dx, grid.y0 + j * grid.dy));
    const side = { y: [1.17, 1.22, 1.27], z0: c[2] + rad * 0.9, dz: -0.025, n: 18, x: [] as (number | null)[][] };
    for (const y of side.y) side.x.push(Array.from({ length: side.n }, (_, k) => { const z = side.z0 + k * side.dz, d = rad * rad - (y - c[1]) ** 2 - (z - c[2]) ** 2; return d > 0 ? Math.sqrt(d) : null; }));
    const ez = (zf(0.18, 1.2) ?? 0) - 0.01;
    return { fit: { v: 1 as const, grid, faceHalfW: rad * 0.9, side, ear: [rad - 0.01, 1.2, c[2]] as [number, number, number] }, zf, eyes: { l: [-0.18, 1.2, ez], r: [0.18, 1.2, ez] }, ears: { l: { top: [-(rad - 0.01), 1.24, c[2]], back: [-(rad - 0.03), 1.2, c[2] - 0.05], outer: null }, r: { top: [rad - 0.01, 1.24, c[2]], back: [rad - 0.03, 1.2, c[2] - 0.05], outer: null } } };
  };
  for (const [name, rad, dz] of [["narrow", 0.38, 0], ["wide", 0.55, 0], ["deep", 0.45, 0.05], ["shallow", 0.45, -0.06]] as const) it(name, () => {
    const f = face(rad, dz), P = fitGlassesPositions(G, design, f.eyes, f.fit, { ears: f.ears }), n = G.length / 4;
    let x0 = 9, x1 = -9, y0 = 9, y1 = -9, minGap = 9;
    for (let i = 0; i < n; i++) { if (G[i * 4] !== 0) continue; const z = f.zf(P[i * 3], P[i * 3 + 1]); if (z !== null) { expect(P[i * 3 + 2]).toBeGreaterThan(z); minGap = Math.min(minGap, P[i * 3 + 2] - z); }
      if (G[i * 4 + 1] > 0 && G[i * 4 + 3] === 0) { x0 = Math.min(x0, P[i * 3]); x1 = Math.max(x1, P[i * 3]); y0 = Math.min(y0, P[i * 3 + 1]); y1 = Math.max(y1, P[i * 3 + 1]); } }
    expect(minGap).toBeLessThan(0.05);                                       // resting on the face, not floating
    expect((x1 - x0) / (y1 - y0)).toBeCloseTo(0.36 / 0.25, 1);               // the style's own proportions
    let reach = 9; for (let i = 0; i < n; i++) if (G[i * 4] === 1 && G[i * 4 + 1] > 0.7 && G[i * 4 + 1] < 0.9) reach = Math.min(reach, Math.hypot(P[i * 3] - f.ears.r.top[0], P[i * 3 + 1] - f.ears.r.top[1], P[i * 3 + 2] - f.ears.r.top[2]));
    expect(reach).toBeLessThan(0.06);                                        // the temple reaches the ear
  });
});
