// vo3d — MOVING TRAFFIC (world/traffic + build/exterior), held to what it claims: in lane, clear of every
// standing thing, never closing on the vehicle ahead, turning smoothly, and not a conga line.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { TRAFFIC_LOOPS, buildLoopPath, carriageways, poseAt, wrapAngle, type LoopPath } from "./world/traffic";
import { PARK_LAMPS, VEHICLES, VEHICLE_LENGTH, LAYBY, PARKING, pathLightSpots, streetLightSpots } from "./world/campus";
import { buildExterior } from "./build/exterior";
import type { Rect } from "./core/coords";

const paths = TRAFFIC_LOOPS.map(buildLoopPath);
const inRect = (x: number, z: number, r: Rect, g = 0) => x > r.x - g && x < r.x + r.w + g && z > r.z - g && z < r.z + r.d + g;
const onRoad = (x: number, z: number) => carriageways().some((r) => inRect(x, z, r));
/** the widest vehicle half-width in the traffic mix, plus a margin */
const BODY = 34;

describe("vo3d traffic — the two loops", () => {
  it("keeps every sample, body width included, inside a carriageway", () => {
    for (const p of paths) {
      for (let i = 0; i < p.x.length; i++) {
        const nx = -Math.sin(p.heading[i]), nz = Math.cos(p.heading[i]);
        for (const side of [-1, 0, 1]) expect(onRoad(p.x[i] + nx * BODY * side, p.z[i] + nz * BODY * side), `${p.loop.id} @${Math.round(p.x[i])},${Math.round(p.z[i])}`).toBe(true);
      }
    }
  });

  it("drives past — never through — lamps, trees, bollards, parked vehicles, the lay-by and the car park", () => {
    const sc = buildExterior();
    const standing: { x: number; z: number; r: number; what: string }[] = [
      ...streetLightSpots().map((l) => ({ ...l, r: 6, what: "lamp" })),
      ...PARK_LAMPS.map((l) => ({ ...l, r: 6, what: "lot lamp" })),
      ...pathLightSpots().map((b) => ({ ...b, r: 5, what: "bollard" })),
    ];
    // parked vehicles are long and thin: test their real footprint (length along the yaw, ~32 half-width)
    const parkedHit = (x: number, z: number) => VEHICLES.find((v) => {
      const c = Math.cos(v.yaw), s = Math.sin(v.yaw), dx = x - v.x, dz = z - v.z;
      const along = Math.abs(dx * s + dz * c), across = Math.abs(dx * c - dz * s);
      return along < VEHICLE_LENGTH[v.kind] / 2 + BODY && across < 32 + BODY;
    });
    const m = new THREE.Matrix4(), v = new THREE.Vector3();
    sc.root.traverse((o) => {
      const im = o as THREE.InstancedMesh;
      if (!im.isInstancedMesh || !/-trunk$/.test(im.name)) return;
      for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, m); v.setFromMatrixPosition(m); standing.push({ x: v.x, z: v.z, r: 10, what: im.name }); }
    });
    for (const p of paths) {
      for (let i = 0; i < p.x.length; i += 4) {
        expect(inRect(p.x[i], p.z[i], LAYBY, BODY) || inRect(p.x[i], p.z[i], PARKING, BODY), `${p.loop.id} into the lay-by/car park`).toBe(false);
        for (const s of standing) expect(Math.hypot(p.x[i] - s.x, p.z[i] - s.z) > s.r + BODY, `${p.loop.id} through ${s.what} at ${Math.round(s.x)},${Math.round(s.z)}`).toBe(true);
        expect(parkedHit(p.x[i], p.z[i])?.kind, `${p.loop.id} through a parked vehicle`).toBeUndefined();
      }
    }
  }, 30000);

  it("the loops never meet: different lanes on the straights, concentric arcs at the corners", () => {
    const [a, b] = paths;
    let min = Infinity;
    for (let i = 0; i < a.x.length; i += 3) for (let j = 0; j < b.x.length; j += 3) min = Math.min(min, Math.hypot(a.x[i] - b.x[j], a.z[i] - b.z[j]));
    expect(min).toBeGreaterThan(100); // one lane (108) apart everywhere — room for two bodies side by side
  });

  it("keeps every vehicle behind the one ahead, turns smoothly, and never stops", () => {
    const pose = { x: 0, z: 0, yaw: 0, heading: 0, speed: 0 };
    for (const p of paths) {
      const n = p.loop.vehicles.length;
      const prevYaw = new Array(n).fill(NaN);
      let minGap = Infinity, maxYawStep = 0, minSpeed = Infinity;
      for (let t = 0; t < p.period; t += 1 / 30) {
        const at = p.loop.vehicles.map((_, k) => { poseAt(p, k, t, pose); return { ...pose }; });
        for (let k = 0; k < n; k++) {
          const q = at[k], r = at[(k + 1) % n];
          const need = (VEHICLE_LENGTH[p.loop.vehicles[k].kind] + VEHICLE_LENGTH[p.loop.vehicles[(k + 1) % n].kind]) / 2;
          minGap = Math.min(minGap, Math.hypot(q.x - r.x, q.z - r.z) - need);
          if (!Number.isNaN(prevYaw[k])) maxYawStep = Math.max(maxYawStep, Math.abs(wrapAngle(q.yaw - prevYaw[k])));
          prevYaw[k] = q.yaw;
          minSpeed = Math.min(minSpeed, q.speed);
        }
      }
      expect(minGap, `${p.loop.id} spacing`).toBeGreaterThan(120);
      expect(maxYawStep, `${p.loop.id} yaw per 1/30 s`).toBeLessThan(0.12); // no snapped rotation anywhere
      expect(minSpeed, `${p.loop.id} never stops`).toBeGreaterThan(40);
    }
  });

  it("is not a conga line, and the mix is mostly road cars with the Philippine set appearing now and then", () => {
    for (const p of paths) {
      expect(new Set(p.loop.vehicles.map((v) => v.gap)).size).toBeGreaterThanOrEqual(4); // irregular gaps
      const gaps = p.offsets.map((o, k) => ((k + 1 < p.offsets.length ? p.offsets[k + 1] : p.period) - o));
      expect(Math.min(...gaps)).toBeGreaterThan(6); // seconds
    }
    const all = TRAFFIC_LOOPS.flatMap((l) => l.vehicles.map((v) => v.kind));
    const cars = all.filter((k) => k === "sport" || k === "supercar" || k === "supercarWing" || k === "pickup").length;
    expect(cars / all.length).toBeGreaterThanOrEqual(0.6);
    expect(all.filter((k) => k === "jeepney").length).toBeLessThanOrEqual(2);
    expect(all).not.toContain("kalesa"); // the kalesa stays ambient in the lay-by
  });

  it("is a pure function of time — the same moment gives the same pose on every client", () => {
    const a = { x: 0, z: 0, yaw: 0, heading: 0, speed: 0 }, b = { ...a };
    poseAt(paths[0], 2, 1234.5, a);
    poseAt(buildLoopPath(TRAFFIC_LOOPS[0]), 2, 1234.5 + paths[0].period * 3, b);
    expect(b.x).toBeCloseTo(a.x, 6);
    expect(b.z).toBeCloseTo(a.z, 6);
  });
});

describe("vo3d traffic — drawn from the parked fleet's own geometry", () => {
  it("moves its instances with the clock, casts no shadow and adds only a handful of draws", () => {
    const sc = buildExterior();
    const names: string[] = [];
    sc.root.traverse((o) => { if (/^traffic-/.test(o.name)) names.push(o.name); });
    expect(names.sort()).toEqual(["traffic-gloss", "traffic-headlight-pools", "traffic-lamps", "traffic-matte", "traffic-shadows"]);
    const gloss = sc.root.getObjectByName("traffic-gloss") as THREE.BatchedMesh;
    expect(gloss.castShadow).toBe(false);
    const m0 = new THREE.Matrix4(), m1 = new THREE.Matrix4();
    sc.trafficTick(100); gloss.getMatrixAt(0, m0);
    sc.trafficTick(103); gloss.getMatrixAt(0, m1);
    expect(m0.equals(m1)).toBe(false);
    expect(sc.stats.traffic).toBe(TRAFFIC_LOOPS.reduce((n, l) => n + l.vehicles.length, 0));
  });

  it("laps in a believable time at a believable speed", () => {
    for (const p of paths as LoopPath[]) {
      expect(p.period).toBeGreaterThan(60);
      expect(p.period).toBeLessThan(130);
      expect(p.loop.cruise).toBeLessThan(200);
    }
  });
});
