// PARKOUR V3 — THE TREEHOUSE, AS GEOMETRY: the Lab's height-aware collision (stacked decks, headroom, rails, posts,
// the ramp), the routes people take on the tree (every point of them clear, every end a real stand point), and the
// surfaces index answering the stacked-deck questions by the feet.
import { describe, expect, it } from "vitest";
import {
  JUMP_PAD, L1, L1_POSTS, L2, LAB2_FLOOR_Y, LAB_ROUTES, RAMP, STAIR, TREE, TRUNK, ZIPLINE, aiLabV2StandTest, aiLabV3StandTest,
  l1Rim, labV2HeightSolids, labV2Surfaces, polar,
} from "./world/ailabV2";
import { StandableIndex, insidePolygon } from "./world/standables";
import { BODY, bandHits } from "./world/heightSolids";
import { routeDuration, routeEntriesAt, routeExit, sampleRoute } from "./world/traversalRoutes";
import type { Vec2 } from "./core/coords";

const R = 8, FY = LAB2_FLOOR_Y;
const on = (feet: number) => ({ feet, airborne: false });
const idx = new StandableIndex(labV2Surfaces());
const solids = labV2HeightSolids();
const xz = (p: { x: number; z: number }): Vec2 => ({ x: p.x, z: p.z });

describe("the Lab's height-aware collision", () => {
  it("the floor is exactly what it was for a body on the floor (every caller that predates this)", () => {
    // a sample of the floor: wherever the old test allowed a floor-level body, the new one does too, and vice versa,
    // except under the ramp's low end (now its own slab, where the old test had a row of discs)
    let same = 0, differ = 0;
    for (let x = 180; x < 1300; x += 23) for (let z = -950; z < -460; z += 23) {
      const p = { x, z };
      const nearRamp = RAMP.path.some((q) => Math.hypot(q.x - x, q.z - z) < RAMP.w + 30);
      // (and the zipline's new floor post)
      if (nearRamp || Math.hypot(ZIPLINE.to.x - x, ZIPLINE.to.z - z) < 12) continue;
      if (aiLabV2StandTest(p, R) === aiLabV3StandTest(p, R)) same++; else differ++;
    }
    expect(differ).toBe(0);
    expect(same).toBeGreaterThan(500);
  });

  it("STACKED DECKS: a body stands on L1, walks beneath L2, stands on L2 — and nowhere falls through or snaps up", () => {
    const onL1 = polar(300, 60), underL2onL1 = { x: 742, z: -780 };
    expect(insidePolygon(underL2onL1, l1Rim())).toBe(true);
    expect(idx.topUnder(underL2onL1, 3, FY + L1.y + BODY.stepUp)).toBeCloseTo(FY + L1.y, 6); // the feet pick L1 …
    expect(idx.topUnder(underL2onL1, 3, FY + L2.y + BODY.stepUp)).toBeCloseTo(FY + L2.y, 6); // … or L2
    expect(idx.topUnder(underL2onL1, 3, FY + BODY.stepUp)).toBe(-Infinity); //               … or nothing: the floor
    expect(aiLabV3StandTest(xz(onL1), R, on(FY + L1.y))).toBe(true);
    // HEADROOM: on L1 under L2 the ceiling is L2's underside; on the floor under L1 it is L1's
    expect(idx.ceilingAbove(underL2onL1, R, FY + L1.y)).toBeCloseTo(FY + L2.y - L2.t, 6);
    expect(idx.ceilingAbove(xz(onL1), R, FY)).toBeCloseTo(FY + L1.y - L1.t, 6);
    expect(idx.ceilingAbove(underL2onL1, R, FY + L2.y)).toBe(Infinity);
  });

  it("a deck's slab is walked under and stood on, never passed through; a post under it stops only the floor", () => {
    // a point just inboard of a post (its rail is outboard of it)
    const post = { x: L1_POSTS[1].x + (TREE.x - L1_POSTS[1].x) * 0.06, z: L1_POSTS[1].z + (TREE.z - L1_POSTS[1].z) * 0.06 };
    expect(aiLabV3StandTest(post, R, on(FY))).toBe(false); //          the floor: a post
    expect(aiLabV3StandTest(post, R, on(FY + L1.y))).toBe(true); //    the deck over it
    // a head rising into L1 from beneath: a body whose feet are 20 up under the deck would have its head in the slab
    const under = polar(45, 60);
    expect(aiLabV3StandTest(xz(under), R, { feet: FY + 20, airborne: true })).toBe(false);
    expect(aiLabV3StandTest(xz(under), R, on(FY))).toBe(true);
  });

  it("the trunk stops everybody at every height; the rails stop a body on their deck and not one beneath", () => {
    const bark = polar(10, TRUNK.r + 6);
    for (const feet of [FY, FY + L1.y, FY + L2.y]) expect(aiLabV3StandTest(xz(bark), R, on(feet))).toBe(false);
    const rim = l1Rim()[1]; // 30°: a railed stretch
    expect(aiLabV3StandTest(rim, R, on(FY + L1.y))).toBe(false);
    expect(solids.some((s) => s.id.startsWith("lab/rail-l1") && s.dist(rim) < R && bandHits(s.band(rim), on(FY + L1.y)))).toBe(true);
    expect(solids.some((s) => s.id.startsWith("lab/rail-l1") && s.dist(rim) < R && bandHits(s.band(rim), on(FY)))).toBe(false);
  });

  it("the RAMP is a sloped walkway: its height under the feet climbs from the floor to L1, and it is walked up", () => {
    const ramp = labV2Surfaces().find((s) => s.id === "lab/ramp")!;
    const mid = { x: (RAMP.path[2].x + RAMP.path[3].x) / 2, z: (RAMP.path[2].z + RAMP.path[3].z) / 2 };
    const h = ramp.heightAt!(mid);
    expect(h).toBeGreaterThan(FY + 14);
    expect(h).toBeLessThan(FY + 41);
    expect(idx.topUnder(mid, 3, h + BODY.stepUp)).toBeCloseTo(h, 6);
    expect(aiLabV3StandTest(mid, R, on(h))).toBe(true);
    // walking the ramp's axis from the floor to the deck: every step is a legal stand point at its own height
    for (let i = 1; i < RAMP.path.length; i++) for (let t = 0; t < 1; t += 0.1) {
      const a = RAMP.path[i - 1], b = RAMP.path[i];
      const q = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      expect(aiLabV3StandTest(q, R, on(ramp.heightAt!(q)))).toBe(true);
    }
  });

  it("the jump stump is a top a double jump reaches, and solid to the floor", () => {
    expect(idx.topUnder(JUMP_PAD, 3)).toBeCloseTo(FY + JUMP_PAD.y, 6);
    expect(aiLabV3StandTest(JUMP_PAD, R, on(FY))).toBe(false);
    expect(aiLabV3StandTest(JUMP_PAD, R, on(FY + JUMP_PAD.y))).toBe(true);
  });
});

describe("the routes on the tree", () => {
  it("every route's ends are real stand points at their own heights, and every point between is clear for the body", () => {
    for (const r of LAB_ROUTES) {
      const first = r.path[0], last = r.path[r.path.length - 1];
      expect(aiLabV3StandTest(xz(first), R, on(first.y)), `${r.id} start`).toBe(true);
      expect(aiLabV3StandTest(xz(last), R, on(last.y)), `${r.id} end`).toBe(true);
      expect(idx.topUnder(xz(first), 3, first.y + BODY.stepUp)).toBeLessThanOrEqual(first.y + 0.01);
      // the whole route, densely: nothing solid in the body's band (a ladder's rungs and a zipline's cable are what it holds)
      for (let u = 0; u <= 1; u += 0.01) {
        const s = sampleRoute(r, "a", u);
        expect(aiLabV3StandTest(xz(s.p), R - 1, { feet: s.p.y, airborne: true }, new Set(r.holds ?? [])), `${r.id} at ${u.toFixed(2)} (${s.p.x.toFixed(0)}, ${s.p.y.toFixed(0)}, ${s.p.z.toFixed(0)})`).toBe(true);
      }
    }
  });

  it("the trunk ladder joins the floor and L1; the ship stair joins L1 and L2; the zipline leaves L2 for the floor", () => {
    const byId = (id: string) => LAB_ROUTES.find((r) => r.id === id)!;
    const ends = (id: string) => { const r = byId(id); return [r.path[0].y, r.path[r.path.length - 1].y]; };
    expect(ends("lab/trunk-ladder")).toEqual([FY, FY + L1.y]);
    expect(ends("lab/ship-stair")).toEqual([FY + L1.y, FY + L2.y]);
    expect(ends("lab/zipline")).toEqual([FY + L2.y, FY]);
    expect(byId("lab/zipline").twoWay).toBe(false);
    // the zipline's rider lets go low over the floor and lands a short step beyond
    const z = byId("lab/zipline"), release = z.path[z.path.length - 2];
    expect(release.y - FY).toBeGreaterThan(2);
    expect(release.y - FY).toBeLessThan(14);
    expect(routeDuration(z)).toBeGreaterThan(3000); // a ride, seen the whole way
    expect(Math.hypot(ZIPLINE.to.x - ZIPLINE.from.x, ZIPLINE.to.z - ZIPLINE.from.z)).toBeGreaterThan(300);
  });

  it("an entry is offered only at an end, within reach, and LEVEL with it (not from the floor under the ladder's top)", () => {
    const lad = LAB_ROUTES.find((r) => r.id === "lab/trunk-ladder")!;
    const foot = lad.path[0], top = lad.path[lad.path.length - 1];
    expect(routeEntriesAt(LAB_ROUTES, foot, foot.y).map((e) => `${e.route.id}:${e.dir}`)).toContain("lab/trunk-ladder:a");
    expect(routeEntriesAt(LAB_ROUTES, top, top.y).map((e) => `${e.route.id}:${e.dir}`)).toContain("lab/trunk-ladder:b");
    expect(routeEntriesAt(LAB_ROUTES, top, FY)).toEqual([]); // under the top, on the floor
    expect(routeEntriesAt(LAB_ROUTES, { x: foot.x + 40, z: foot.z }, foot.y).filter((e) => e.route.id === lad.id)).toEqual([]);
    // the zipline is one-way: its landing is not an entry
    const zip = LAB_ROUTES.find((r) => r.id === "lab/zipline")!;
    expect(routeEntriesAt(LAB_ROUTES, routeExit(zip, "a"), FY).filter((e) => e.route.id === zip.id)).toEqual([]);
  });

  it("the stair's foot is on L1 and its head on L2, faced toward the tree", () => {
    const st = LAB_ROUTES.find((r) => r.id === "lab/ship-stair")!;
    expect(idx.topUnder(st.path[0], 3, st.path[0].y + 1)).toBeCloseTo(FY + L1.y, 6);
    expect(idx.topUnder(st.path[st.path.length - 1], 3, st.path[st.path.length - 1].y + 1)).toBeCloseTo(FY + L2.y, 6);
    expect(Math.hypot(STAIR.top.x - TREE.x, STAIR.top.z - TREE.z)).toBeLessThan(Math.hypot(st.path[0].x - TREE.x, st.path[0].z - TREE.z));
  });
});
