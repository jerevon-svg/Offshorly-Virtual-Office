// vo3d — SHARED E-SCOOTERS (single-player): the handling, where a deck may roll, the stations and the exterior's
// dock/ridden-scooter plumbing, held to what they claim.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { SCOOTER, ScooterMotion } from "./player/ScooterMotion";
import { DECK_TOP, scooterStations } from "./world/scooters";
import { FACADE_WALL_T, RIDE_PROFILE, SURFACE_SPEED, exteriorGround, speedClassOf } from "./world/exteriorGround";
import { RAMPS } from "./world/campus";
import { FACADE_Z, FRAME, v1Sidewalk } from "./adapters/v1Floor";
import { ENTRY_ZONE, FACADE } from "./rooms/reception";
import { HALL, PORCH } from "./world/ailab";
import { buildExterior } from "./build/exterior";
import { pointInRect, type Vec2 } from "./core/coords";

const sidewalk = v1Sidewalk();
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

describe("vo3d scooter — where a deck may roll (world/exteriorGround RIDE, Phase 4)", () => {
  const G = exteriorGround();
  const F = RIDE_PROFILE.footRadius;
  // the live ride test's refusals (app/world.ts rideForeign): the office's floor and door mat, the Lab's floor
  const foreign = (q: Vec2): boolean | null =>
    (pointInRect(q, FRAME) && (q.z < FACADE_Z + FACADE_WALL_T || pointInRect(q, ENTRY_ZONE))) || G.groundAt(q).kind === "lab-interior" ? false : null;
  const ride = (p: Vec2, ignore?: string) => G.canOccupy(p, F, RIDE_PROFILE, foreign, ignore);
  it("places 4 docks at Reception and 2 by the Lab; every one sets off onto rideable ground past its own empty dock", () => {
    expect(stations.map((s) => s.docks.length)).toEqual([4, 2]);
    for (const s of stations) for (const d of s.docks) expect(ride(d.mount, `scooter:${d.id}`), d.id).toBe(true);
    // the Reception docks stand OUT of the walking line (in the band against the façade)
    for (const d of stations[0].docks) expect(d.z).toBeLessThan(sidewalk.z + 30);
    expect(DECK_TOP).toBeGreaterThan(4);
  });
  it("the Lab rack lies along the rear path's edge and leaves the path open", () => {
    const d = stations[1].docks[0];
    expect(ride({ x: d.x, z: d.z + 26 })).toBe(true);
    expect(ride({ x: d.x, z: d.z })).toBe(false); // on the other docked scooter's spot
  });
  it("never the office (its floor, its door mat) nor the Lab's floor or porch", () => {
    expect(ride({ x: (FACADE.door.x0 + FACADE.door.x1) / 2, z: FACADE.z + 30 })).toBe(false);
    expect(ride({ x: 700, z: 600 })).toBe(false);
    expect(ride({ x: PORCH.x + PORCH.w / 2, z: PORCH.z + PORCH.d / 2 })).toBe(false);
    expect(ride({ x: HALL.x + 100, z: HALL.z + 200 })).toBe(false);
  });
  it("the whole visible world a wheel rolls on: roads fast, paving normal, grass and fields slow off-road", () => {
    const cls = (p: Vec2) => speedClassOf(G.groundAt(p).kind, RIDE_PROFILE);
    for (const [p, c] of [[{ x: 300, z: 1640 }, "fast"], [{ x: -532, z: 700 }, "fast"], [{ x: 720, z: 1216 }, "normal"], [{ x: 1100, z: -268 }, "normal"], [{ x: 1800, z: 800 }, "slow"], [{ x: 700, z: -2800 }, "slow"], [{ x: 3500, z: 2200 }, "slow"]] as const) {
      expect(ride(p), JSON.stringify(p)).toBe(true);
      expect(cls(p), JSON.stringify(p)).toBe(c);
    }
    expect(SURFACE_SPEED.fast).toBe(1);
    expect(SURFACE_SPEED.slow).toBeLessThan(SURFACE_SPEED.normal);
    // off the kerb and onto the carriageway rolls (a kerb's worth); a stair and water never do
    for (let z = 1480; z <= 1560; z += 2) expect(ride({ x: 300, z }), `kerb z ${z}`).toBe(true);
    expect(ride({ x: 707, z: 1300 })).toBe(false);
    expect(ride({ x: 740, z: -1300 })).toBe(false);
  });
  it("the ramps join the podium to the ground below; the podium's own steps do not", () => {
    for (const r of RAMPS) {
      const across = r.axis === "x" ? r.rect.z + r.rect.d / 2 : r.rect.x + r.rect.w / 2;
      for (let t = -12; t <= (r.axis === "x" ? r.rect.w : r.rect.d) + 12; t += 3) {
        const p = r.axis === "x" ? { x: r.rect.x + t, z: across } : { x: across, z: r.rect.z + t };
        expect(ride(p), `${r.id} @ ${t}`).toBe(true);
      }
    }
    // beside the entry ramp, the plinth ring's 3.2 and 4.65 steps stop a deck (they are a walker's steps)
    expect(ride({ x: 1100, z: 1240 })).toBe(false);
    expect(ride({ x: 1100, z: 1292 })).toBe(false);
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
});
