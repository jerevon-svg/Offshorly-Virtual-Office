// vo3d — SHARED E-SCOOTERS V1 (single-player): the handling, the ride area, the stations and the exterior's
// dock/ridden-scooter plumbing, held to what they claim.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { SCOOTER, ScooterMotion } from "./player/ScooterMotion";
import { DECK_TOP, clearOfDocks, dockSolids, inRideArea, rideArea, scooterStations } from "./world/scooters";
import { FRAME, v1Sidewalk } from "./adapters/v1Floor";
import { ENTRY_ZONE, FACADE } from "./rooms/reception";
import { HALL, PORCH, SOUTH_BAY } from "./world/ailab";
import { buildExterior } from "./build/exterior";
import { pointInRect } from "./core/coords";

const sidewalk = v1Sidewalk();
const area = rideArea(sidewalk, ENTRY_ZONE.x + ENTRY_ZONE.w);
const stations = scooterStations(sidewalk);

describe("vo3d scooter — the handling (player/ScooterMotion)", () => {
  const run = (m: ScooterMotion, input: { throttle: number; steer: number; boost?: boolean }, secs: number) => {
    for (let t = 0; t < secs; t += 1 / 60) m.step({ boost: false, ...input }, 1 / 60);
  };
  it("rolls up to its top speed over about a second and a half — not an instant jump", () => {
    const m = new ScooterMotion(0);
    run(m, { throttle: 1, steer: 0 }, 0.5);
    expect(m.speed).toBeGreaterThan(40);
    expect(m.speed).toBeLessThan(SCOOTER.maxSpeed * 0.6);
    run(m, { throttle: 1, steer: 0 }, 1.5);
    expect(m.speed).toBeCloseTo(SCOOTER.maxSpeed, 0);
    expect(SCOOTER.maxSpeed).toBeGreaterThan(2.4 * 70); // well beyond a walk (70) and a sprint (100)
  });
  it("coasts down when released, brakes hard, and only creeps in reverse", () => {
    const m = new ScooterMotion(0);
    run(m, { throttle: 1, steer: 0 }, 2);
    run(m, { throttle: 0, steer: 0 }, 1);
    expect(m.speed).toBeGreaterThan(60); // still rolling after a second of coasting
    run(m, { throttle: -1, steer: 0 }, 0.6);
    expect(m.speed).toBeLessThanOrEqual(0.5); // braked to a stop
    run(m, { throttle: -1, steer: 0 }, 2);
    expect(m.speed).toBeGreaterThanOrEqual(-SCOOTER.reverseSpeed - 1e-6);
  });
  it("steers quicker slow than fast, turns only by steering, and leans into the turn within bounds", () => {
    const slow = new ScooterMotion(0), fast = new ScooterMotion(0);
    run(slow, { throttle: 0.25, steer: 0 }, 0.3);
    run(fast, { throttle: 1, steer: 0 }, 2);
    const h0s = slow.heading, h0f = fast.heading;
    run(slow, { throttle: 0.1, steer: 1 }, 0.5);
    run(fast, { throttle: 1, steer: 1 }, 0.5);
    expect(slow.heading - h0s).toBeGreaterThan(0);
    expect(fast.heading - h0f).toBeGreaterThan(0);
    // the turn RADIUS at speed stays wide enough to feel like momentum, not a pivot
    expect(fast.speed / SCOOTER.turnFast).toBeGreaterThan(80);
    expect(Math.abs(fast.lean)).toBeGreaterThan(0.05);
    expect(Math.abs(fast.lean)).toBeLessThanOrEqual(SCOOTER.maxLean + 1e-6);
    const straight = new ScooterMotion(1.2);
    run(straight, { throttle: 1, steer: 0 }, 2);
    expect(straight.heading).toBeCloseTo(1.2, 9);
  });
  it("keeps the speed it made good along a wall (a graze), and stops head-on", () => {
    const m = new ScooterMotion(0);
    run(m, { throttle: 1, steer: 0 }, 2);
    const v = m.speed, dt = 1 / 60;
    m.bumped(v * dt * 0.97, dt); // slid along the wall at 97% of the intended step
    expect(m.speed).toBeGreaterThan(v * 0.9);
    m.bumped(0, dt); // nose-first into it
    expect(m.speed).toBe(0);
  });
});

describe("vo3d scooter — the ride area and the stations (world/scooters)", () => {
  it("is exterior only: every rect is outside the office's walls, clear of the door sensor and short of the Lab porch", () => {
    for (const r of area) {
      const insideFrame = r.x >= FRAME.x && r.x + r.w <= FRAME.x + FRAME.w && r.z >= FRAME.z && r.z + r.d <= FRAME.z + FRAME.d;
      // the only rect inside the V1 frame is the front pavement, which is entirely south of the façade
      if (insideFrame) expect(r.z).toBeGreaterThan(FACADE.z);
    }
    expect(area[0].x).toBeGreaterThanOrEqual(ENTRY_ZONE.x + ENTRY_ZONE.w + 30);
    for (const r of area) {
      for (const lab of [HALL, SOUTH_BAY]) expect(r.x + r.w <= lab.x || r.x >= lab.x + lab.w || r.z + r.d <= lab.z || r.z >= lab.z + lab.d).toBe(true);
      expect(r.z >= PORCH.z + PORCH.d || r.x >= PORCH.x + PORCH.w || r.x + r.w <= PORCH.x || r.z + r.d <= PORCH.z).toBe(true);
    }
    // the door itself and the working office are never in it
    expect(inRideArea(area, { x: (FACADE.door.x0 + FACADE.door.x1) / 2, z: FACADE.z + 30 })).toBe(false);
    expect(inRideArea(area, { x: 700, z: 600 })).toBe(false);
  });
  it("runs continuously from the Reception pavement to the Lab walk (each rect overlaps the next)", () => {
    for (let i = 0; i + 1 < area.length; i++) {
      const a = area[i], b = area[i + 1];
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.z < b.z + b.d && b.z < a.z + a.d;
      expect(overlap, `rect ${i} → ${i + 1}`).toBe(true);
    }
  });
  it("places 4 docks at Reception and 2 by the Lab, each reachable from the ride area, and the Lab rack leaves the path open", () => {
    expect(stations.map((s) => s.docks.length)).toEqual([4, 2]);
    for (const s of stations) for (const d of s.docks) expect(inRideArea(area, d.mount), d.id).toBe(true);
    // the Reception docks stand OUT of the walking line (in the planted band against the façade)
    for (const d of stations[0].docks) expect(d.z).toBeLessThan(sidewalk.z + 30);
    const solids = dockSolids(stations);
    expect(solids.length).toBe(2);
    // a rider can pass the Lab rack on the path's open half
    expect(clearOfDocks(solids, { x: stations[1].docks[0].x, z: stations[1].docks[0].z + 20 }, 8)).toBe(true);
    expect(clearOfDocks(solids, { x: stations[1].docks[0].x, z: stations[1].docks[0].z }, 8)).toBe(false);
    expect(DECK_TOP).toBeGreaterThan(4);
  });
});

describe("vo3d scooter — drawn with the fleet (build/exterior)", () => {
  it("adds the racks and scooters to the existing batches (no new draw calls) and exposes dock/ridden control", () => {
    const base = buildExterior();
    const withDocks = buildExterior({ scooterStations: stations });
    const draws = (sc: ReturnType<typeof buildExterior>) => { let n = 0; sc.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) n++; }); return n; };
    expect(draws(withDocks)).toBe(draws(base));
    expect(base.scooters).toBeNull();
    expect(withDocks.stats.docks).toBe(6);
    const s = withDocks.scooters!;
    const parked = withDocks.root.getObjectByName("vehicles-gloss") as THREE.BatchedMesh;
    const visibleCount = () => { let n = 0; for (let i = 0; i < 400; i++) { try { if (parked.getVisibleAt(i)) n++; } catch { break; } } return n; };
    const before = visibleCount();
    s.setDocked("scooter-r2", false);
    expect(visibleCount()).toBe(before - 3); // its paint, gloss and lamp instances
    s.setDocked("scooter-r2", true);
    expect(visibleCount()).toBe(before);
    s.showRidden(true);
    s.placeRidden(1200, 1213, 0.4, 0.1);
    const moving = withDocks.root.getObjectByName("traffic-gloss") as THREE.BatchedMesh;
    expect(moving.castShadow).toBe(false); // the ridden scooter moves: it casts no stale shadow
  });
  it("keeps the ride area off the vehicle roads entirely", () => {
    for (const r of area) expect(pointInRect({ x: r.x + r.w / 2, z: r.z + r.d / 2 }, { x: -840, z: -1992, w: 3020, d: 3504 })).toBe(true); // inside the Offshorly lot
  });
});
