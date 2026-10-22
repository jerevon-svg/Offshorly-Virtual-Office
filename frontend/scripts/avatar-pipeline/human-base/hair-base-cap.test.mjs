// hair-base-cap.test.mjs — the hair base cap (hair-layers.mjs hairBaseCap) never covers an ear (opt-in rules.capEarOutline, 2026-10-13).
// From frontend/:  npx vitest run scripts/avatar-pipeline/human-base/hair-base-cap.test.mjs
import { describe, expect, it } from "vitest";
import { hairBaseCap } from "./hair-layers.mjs";

// a synthetic head: skin on a sphere (r 0.432 about the cranium centre), hair over it down to 125° from the top, and an EAR on +x: a C-shaped
// protruding helix (stands off 0.06) OPEN at its upper front, round a SINGLE-LAYER concha floor that stands off only 0.012 — less than the
// cap's own 0.022 offset (Lui's cymba: one direction at a time it reads as scalp). Plus single-layer scalp residue on the back (outside
// the ear box, stands off 0.05).
const CC = [0, 1.25, 0], R0 = 0.432, eyeY = 1.15, LABEL = { SKIN: 0, HAIR: 1 }, deg = Math.PI / 180;
const dirOf = (th, ph) => [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
const earC = dirOf(Math.acos((1.12 - CC[1]) / 0.42), 0), up = (() => { const u = [0 - earC[1] * earC[0], 1 - earC[1] * earC[1], -earC[1] * earC[2]], l = Math.hypot(...u); return u.map((x) => x / l); })(), fwd = [up[1] * earC[2] - up[2] * earC[1], up[2] * earC[0] - up[0] * earC[2], up[0] * earC[1] - up[1] * earC[0]];
const psi = (d) => (Math.atan2(dot(d, fwd), dot(d, up)) / deg + 360) % 360, OPEN = (d) => psi(d) >= 20 && psi(d) <= 100;   // the helix gap: the upper front
const back = dirOf(100 * deg, -90 * deg), RIM0 = 4.4 * deg, RIM1 = 5.6 * deg;
function head({ protruding = true } = {}) { const P = [], label = [], add = (d, r, l) => { P.push(CC[0] + d[0] * r, CC[1] + d[1] * r, CC[2] + d[2] * r); label.push(l); };
  for (let th = 0.25; th < 180; th += 0.5) for (let ph = -180; ph < 180; ph += 0.5) { const d = dirOf(th * deg, ph * deg), a = ang(d, earC);
    if (a < RIM1 && (a < RIM0 || OPEN(d) || !protruding)) add(d, R0 + 0.012, LABEL.SKIN);   // concha / cymba floor: one layer, shallow
    else if (a < RIM1) { add(d, R0, LABEL.SKIN); add(d, R0 + 0.06, LABEL.SKIN); }   // helix in front of the head
    else add(d, ang(d, back) < 12 * deg ? R0 + 0.05 : R0, LABEL.SKIN);
    if (th < 125 && a > 7 * deg) add(d, 0.5, LABEL.HAIR); }
  return { P: Float32Array.from(P), label: Uint8Array.from(label) }; }
const skullMap = { CC, excess: (x, y, z) => Math.hypot(x - CC[0], y - CC[1], z - CC[2]) - R0 };
const layers = { capFront: 0.1, capOffset: 0.022, capGap: 0.005, capEar: 0.035, capPocket: 0.18 };
const run = (H, capEarOutline) => hairBaseCap({ P: H.P, label: H.label, LABEL, skullMap, after: { ears: { z: 0 } }, headJoint: 0, lm: { eyes: { l: [-0.2, eyeY, 0.4], r: [0.2, eyeY, 0.4] } }, tie: null }, { layers, pocketMinCells: 0, ...(capEarOutline === undefined ? {} : { capEarOutline }) });
const radius = (P, v) => Math.hypot(P[v * 3] - CC[0], P[v * 3 + 1] - CC[1], P[v * 3 + 2] - CC[2]), dirV = (P, v) => { const r = radius(P, v); return [0, 1, 2].map((k) => (P[v * 3 + k] - CC[k]) / r); };
const H = head(), off = run(H, false), on = run(H, true);
const byDir = (C) => { const m = new Map(); for (let v = 0; v < C.P.length / 3; v++) m.set(dirV(C.P, v).map((x) => x.toFixed(5)).join(","), radius(C.P, v)); return m; };

describe("the hair base cap never covers an ear (hairBaseCap, rules.capEarOutline)", () => {
  it("NEGATIVE: without the rule the cap lies in front of the open upper concha — the dark notch", () => {
    let over = 0; for (let v = 0; v < off.P.length / 3; v++) { const d = dirV(off.P, v), a = ang(d, earC); if (a < RIM1 && (a < RIM0 || OPEN(d)) && radius(off.P, v) > R0 + 0.012) over++; }
    expect(over).toBeGreaterThan(0); });
  it("with the rule no cap vertex lies inside the ear's outline — rim, concha and the open cymba alike", () => {
    let inside = 0; for (let v = 0; v < on.P.length / 3; v++) if (ang(dirV(on.P, v), earC) < RIM1) inside++;
    expect(inside).toBe(0); });
  it("its new edge dives into the head like the hairline: just outside the outline the cap only ever moves inward, and the first ring sinks", () => {
    const A = byDir(off), B = byDir(on); let sunk = 0, raised = 0;
    for (const [k, rb] of B) { const ra = A.get(k); if (ra === undefined) continue; const a = ang(k.split(",").map(Number), earC); if (a < RIM1 || a > 12 * deg) continue; if (rb > ra + 1e-9) raised++; if (rb < ra - 0.007) sunk++; }
    expect(raised).toBe(0); expect(sunk).toBeGreaterThan(0); });
  it("away from the ear nothing changes, and scalp residue off the ear is still covered", () => {
    const far = (P, v) => ang(dirV(P, v), earC) > 30 * deg, a = [], b = [];
    for (let v = 0; v < off.P.length / 3; v++) if (far(off.P, v)) a.push(off.P[v * 3], off.P[v * 3 + 1], off.P[v * 3 + 2]);
    for (let v = 0; v < on.P.length / 3; v++) if (far(on.P, v)) b.push(on.P[v * 3], on.P[v * 3 + 1], on.P[v * 3 + 2]);
    expect(b).toEqual(a);
    let res = 0, covered = 0; for (let v = 0; v < on.P.length / 3; v++) if (ang(dirV(on.P, v), back) < 4 * deg) { res++; if (radius(on.P, v) > R0 + 0.05) covered++; }
    expect(res).toBeGreaterThan(0); expect(covered).toBe(res); });
  it("acts only on a real (protruding) ear: a head whose ear region never protrudes keeps exactly the old cap", () => {
    const flat = head({ protruding: false }); expect(Array.from(run(flat, true).P)).toEqual(Array.from(run(flat, false).P)); });
  it("is deterministic, and off is exactly the construction without the switch", () => {
    expect(Array.from(run(H, true).P)).toEqual(Array.from(on.P)); expect(Array.from(run(H, undefined).P)).toEqual(Array.from(off.P)); });
});
