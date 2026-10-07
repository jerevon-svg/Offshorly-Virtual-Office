import { describe, expect, it } from "vitest";
import { LIFT_RIDER_SLOTS, exitPath, slotPoint } from "./liftRiders";
import { CABIN, GROUND_ELEVATOR, cabinStandTest, toCabin, vestibuleStandTest } from "../rooms/elevator";
import { NAV_RADIUS } from "../nav/clearance";

// Go Together — the shared-ride slots against the REAL car and vestibule geometry.

describe("lift rider slots", () => {
  const riders = LIFT_RIDER_SLOTS.map((s) => slotPoint(CABIN.mark, s));

  it("every slot is standable in the car, and nobody overlaps anybody (the rider at the mark included)", () => {
    for (const p of riders) expect(cabinStandTest(p, NAV_RADIUS)).toBe(true);
    const all = [CABIN.mark, ...riders];
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++)
        expect(Math.hypot(all[i].x - all[j].x, all[i].z - all[j].z)).toBeGreaterThanOrEqual(24);
  });

  it("holds a whole party (leader + 8) and keeps the ride camera's line clear", () => {
    expect(LIFT_RIDER_SLOTS.length).toBeGreaterThanOrEqual(8);
    for (const s of LIFT_RIDER_SLOTS) if (s.rel.x < 0) expect(Math.abs(s.rel.z)).toBeGreaterThanOrEqual(12);
  });

  it("the bay slots exist in a floor's vestibule after the same translation the body takes", () => {
    const v = toCabin(GROUND_ELEVATOR);
    for (const s of LIFT_RIDER_SLOTS) {
      const inCar = slotPoint(CABIN.mark, s);
      const inVestibule = { x: inCar.x - v.x, z: inCar.z - v.z };
      expect(vestibuleStandTest(GROUND_ELEVATOR, inVestibule, NAV_RADIUS)).toBe(s.inBay);
      expect(inVestibule).toEqual(slotPoint(GROUND_ELEVATOR.mark, s));
    }
  });

  it("walks out through the doorway, not through its piers", () => {
    const d = GROUND_ELEVATOR.doorway;
    for (const s of LIFT_RIDER_SLOTS.filter((x) => x.inBay)) {
      const [inside, outside] = exitPath(s, d, GROUND_ELEVATOR.boarding);
      for (const p of [inside, outside]) {
        expect(p.z).toBeGreaterThanOrEqual(d.z + NAV_RADIUS / 2);
        expect(p.z).toBeLessThanOrEqual(d.z + d.d - NAV_RADIUS / 2);
      }
    }
  });
});

// ---- Phase 3: one slot per person, the same on every browser --------------------------------------------
import { PARTY_LIFT_SLOTS, lobbyPoint, partyLiftPlan } from "./liftRiders";

describe("partyLiftPlan — nobody shares a place in the car, and everybody has the same place everywhere", () => {
  const order = ["a@x", "b@x", "c@x"];
  const placeOf = (viewer: string) => {
    const plan = partyLiftPlan(order, order, viewer);
    return new Map([[viewer, plan.self.rel], ...plan.riders.map((r) => [r.email, r.slot.rel] as const)]);
  };

  it("three riders: three distinct slots on each browser, each person in the same slot on all of them", () => {
    const views = order.map(placeOf);
    for (const v of views) {
      expect(v.size).toBe(3);
      expect(new Set([...v.values()].map((p) => `${p.x},${p.z}`)).size).toBe(3);
    }
    for (const e of order) expect(new Set(views.map((v) => JSON.stringify(v.get(e)))).size).toBe(1);
  });

  it("slots are at least two body radii apart", () => {
    const rel = PARTY_LIFT_SLOTS.map((s) => s.rel);
    for (let i = 0; i < rel.length; i++) for (let j = i + 1; j < rel.length; j++) {
      expect(Math.hypot(rel[i].x - rel[j].x, rel[i].z - rel[j].z)).toBeGreaterThanOrEqual(20);
    }
  });

  it("every bay slot a BODY can stand on is standable in the vestibule it boards from (the local body walks in to it)", () => {
    for (const slot of PARTY_LIFT_SLOTS.filter((x) => x.inBay)) {
      expect(vestibuleStandTest(GROUND_ELEVATOR, slotPoint(GROUND_ELEVATOR.mark, slot), NAV_RADIUS)).toBe(true);
    }
  });

  it("a viewer whose own slot is a deep one stands on the mark and hands the mark's owner their slot", () => {
    const big = ["m0", "m1", "m2", "m3", "m4"];
    const plan = partyLiftPlan(big, big, "m4");
    expect(plan.self).toBe(PARTY_LIFT_SLOTS[0]);
    expect(plan.riders.find((r) => r.email === "m0")?.slot).toBe(PARTY_LIFT_SLOTS[4]);
    const all = [plan.self, ...plan.riders.map((r) => r.slot)];
    expect(new Set(all).size).toBe(5);
  });

  it("a rider not riding is simply not in the car; the others keep their own slots", () => {
    const plan = partyLiftPlan(order, ["a@x", "c@x"], "a@x");
    expect(plan.riders).toEqual([{ email: "c@x", slot: PARTY_LIFT_SLOTS[2] }]);
  });

  it("lobby spots are distinct and on the lift's boarding apron", () => {
    const spec = GROUND_ELEVATOR;
    const pts = Array.from({ length: 9 }, (_, i) => lobbyPoint(spec.boarding, i));
    expect(pts[0]).toEqual(spec.boarding); // slot 0: the solo boarding point
    const apron = { x0: spec.outer.x - 20, x1: spec.outer.x + spec.outer.w + 24, z0: spec.outer.z, z1: spec.outer.z + spec.outer.d };
    for (const p of pts) {
      expect(p.x >= apron.x0 && p.x <= apron.x1 && p.z >= apron.z0 && p.z <= apron.z1).toBe(true);
    }
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      expect(Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z)).toBeGreaterThanOrEqual(12);
    }
  });
});
