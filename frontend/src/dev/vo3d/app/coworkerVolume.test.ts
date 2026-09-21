// ONE VOLUME AT A TIME — the rule that decides which bodies the world draws.
//
// The Championship Cave is a separate interior volume east of the V1 frame whose geometry is never drawn
// while nobody is inside it. A peer who walks in keeps publishing real Cave coordinates, so before this
// they were drawn from the office as a body — with a nameplate — standing in an empty field beyond the
// campus. This pins the rule that stopped that, off the `place` the feed already publishes.
import { describe, expect, it } from "vitest";
import { CAVE_PLACE_ID, coworkersInSameVolume } from "./coworkers";

type Person = { email: string; place?: string };
const office: Person = { email: "alex@offshorly.com" };
const inCave: Person = { email: "micah@offshorly.com", place: CAVE_PLACE_ID };
const inLab: Person = { email: "angelo@offshorly.com", place: "ai-lab" };

describe("who the world draws", () => {
  it("hides somebody in the Cave from a viewer standing in the office", () => {
    expect(coworkersInSameVolume([office, inCave], false)).toEqual([office]);
  });

  it("shows ONLY the people in the Cave to a viewer who is inside it", () => {
    expect(coworkersInSameVolume([office, inCave], true)).toEqual([inCave]);
  });

  it("leaves the AI Lab alone — it is a real building on the drawn campus", () => {
    // Somebody standing in the Lab is standing somewhere you can actually see, so nothing hides them.
    expect(coworkersInSameVolume([office, inLab], false)).toEqual([office, inLab]);
  });

  it("is symmetric: nobody is ever drawn in both volumes, or in neither", () => {
    const all = [office, inCave, inLab];
    const outside = coworkersInSameVolume(all, false);
    const inside = coworkersInSameVolume(all, true);
    expect([...outside, ...inside]).toHaveLength(all.length);
    expect(outside.filter((c) => inside.includes(c))).toEqual([]);
  });
});
