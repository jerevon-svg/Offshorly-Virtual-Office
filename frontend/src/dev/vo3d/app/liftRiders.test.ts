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
