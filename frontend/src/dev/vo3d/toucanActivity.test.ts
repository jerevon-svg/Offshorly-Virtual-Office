// app/toucanActivity — Phase 6B: the shared Toucan panel never says "beside you" while a job has the bird elsewhere.
import { describe, expect, it } from "vitest";
import { TOUCAN_BUSY_LABEL, toucanBusyWithJob } from "./app/toucanActivity";

const me = { x: 1400, z: 1200 };
const PERCH = { x: 740, z: -620 };
describe("toucanBusyWithJob", () => {
  it("free (not directed by a job): never busy, wherever it flies", () => {
    expect(toucanBusyWithJob(null, me, PERCH)).toBe(false);
  });
  it("directed to the Lab: busy — even before it has left your side", () => {
    expect(toucanBusyWithJob(PERCH, me, PERCH)).toBe(true);
    expect(toucanBusyWithJob(PERCH, me, { x: me.x + 20, z: me.z })).toBe(true);
  });
  it("directed back to you but still on the way: busy; once it is beside you: not", () => {
    expect(toucanBusyWithJob(me, me, PERCH)).toBe(true);
    expect(toucanBusyWithJob(me, me, { x: me.x + 40, z: me.z + 30 })).toBe(false);
  });
  it("the line the panel shows meanwhile", () => {
    expect(TOUCAN_BUSY_LABEL).toBe("Working with the AI team");
  });
});
