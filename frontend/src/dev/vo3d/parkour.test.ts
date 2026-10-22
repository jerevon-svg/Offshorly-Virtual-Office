import { describe, expect, it } from "vitest";
import { DOUBLE_JUMP_SPEED, PlayerJump, WALK_JUMP } from "./player/PlayerJump";
import {
  CAMPUS_BENCH_TOP,
  STANDABLE_KIND_TOPS,
  StandableIndex,
  insidePolygon,
  standableFromBox,
  standableFromEntity,
  standableTop,
} from "./world/standables";
import { exteriorGround, solidOverlaps, WALK_PROFILE } from "./world/exteriorGround";
import { WorldState, type Entity } from "./world/WorldState";
import { CORRIDOR_BANDS, registerGroundFloor } from "./rooms/ground-floor";
import { makeStandTest } from "./player/standTest";
import { DESIGN_ROOM, DESIGN_SOLIDS, designRoomEntities } from "./rooms/design-room";
import { RECEPTION_ROOM, receptionEntities } from "./rooms/reception";
import { MEETING_ROOM, meetingRoomEntities } from "./rooms/meeting";
import { PROJECT_ROOM, projectRoomEntities } from "./rooms/project";
import { GAMING_ROOM, gamingRoomEntities } from "./rooms/gaming";
import { CENTRAL_HUB, centralHubEntities, OPEN_BANDS as HUB_BANDS } from "./rooms/central-hub";
import { EXECUTIVE_ROOM, executiveRoomEntities } from "./rooms/executive";
import { CMS_ROOM, cmsRoomEntities } from "./rooms/cms";
import { AI_ROOM, aiRoomEntities } from "./rooms/ai";
import { DEV_ROOM, devRoomEntities } from "./rooms/dev";
import { QA_ROOM, qaRoomEntities } from "./rooms/qa";
import { Walkability, composeStatic } from "./nav/Walkability";
import { NAV_RADIUS, clearanceLayer, worldClearances } from "./nav/clearance";
import { DerivedNav } from "./nav/derived";
import { openedLayer, v2Static } from "./nav/v2Open";
import { v1Static } from "./adapters/v1Grid";
import type { Vec2 } from "./core/coords";

// PARKOUR V1 — the rules underneath the movement: the double jump's allowance and headroom, and the ONE
// height-aware obstacle vocabulary (world/standables) — what may be stood on, and that nothing else changed.

const DT = 1 / 60;
function arc(j: PlayerJump, floor = 0, ceiling = Infinity, each?: (j: PlayerJump) => void): number {
  let peak = -Infinity;
  for (let i = 0; i < 600 && (i === 0 || j.airborne); i++) {
    j.update(DT, floor, ceiling);
    peak = Math.max(peak, j.feet);
    each?.(j);
  }
  return peak;
}

describe("PlayerJump — the double jump", () => {
  it("a single jump is the hop it always was (~11.7)", () => {
    const j = new PlayerJump();
    expect(j.start(0)).toBe(true);
    const peak = arc(j);
    expect(peak).toBeGreaterThan(11);
    expect(peak).toBeLessThan(12.5);
    expect(j.lastFall).toBeCloseTo(peak, 0);
  });

  it("a second Space in mid-air jumps again — once; a third is refused until the feet are down", () => {
    const j = new PlayerJump();
    j.start(0);
    let tookSecond = false, tookThird = true;
    const peak = arc(j, 0, Infinity, (b) => {
      if (!tookSecond && b.verticalSpeed <= 0) tookSecond = b.airJump();
      else if (tookSecond && tookThird === true) tookThird = b.airJump();
    });
    expect(tookSecond).toBe(true);
    expect(tookThird).toBe(false);
    // given at the top of the first arc: ~11.7 + 90²/(2·260) ≈ 27 — a sofa, a table, a bench are within reach
    expect(peak).toBeGreaterThan(25);
    expect(peak).toBeLessThan(29);
    expect(DOUBLE_JUMP_SPEED).toBe(WALK_JUMP.airTakeoff);
  });

  it("the allowance comes back only with a landing", () => {
    const j = new PlayerJump();
    expect(j.airJump()).toBe(false); // on the floor that is `start`, not an air jump
    j.start(0);
    expect(j.airJump()).toBe(true);
    arc(j);
    expect(j.airborne).toBe(false);
    expect(j.airJump()).toBe(false);
    j.start(0);
    expect(j.canAirJump).toBe(true);
  });

  it("walking off an edge is not a jump: it grants no mid-air jump", () => {
    const j = new PlayerJump();
    j.fall(15.6);
    expect(j.airJump()).toBe(false);
    arc(j, 0);
    expect(j.lastFall).toBeCloseTo(15.6, 1);
  });

  it("HEADROOM: the feet never rise past the ceiling, and a jump with no room above is refused", () => {
    const j = new PlayerJump();
    j.start(0);
    const peak = arc(j, 0, 8);
    expect(peak).toBeLessThanOrEqual(8);
    const k = new PlayerJump();
    k.start(0);
    for (let i = 0; i < 10; i++) k.update(DT, 0, 9);
    expect(k.airJump(k.feet + 2)).toBe(false); // less than 4 of room
    expect(k.canAirJump).toBe(true);
  });

  it("a scooter's hop has no double jump", () => {
    const j = new PlayerJump({ takeoff: 110, gravity: 480 });
    j.start(0);
    expect(j.airJump()).toBe(false);
  });
});

const ent = (over: Partial<Entity>): Entity => ({
  id: "room/x", kind: "x", roomId: "room", transform: { pos: { x: 0, z: 0 }, yaw: 0 },
  footprint: { shape: "rect", w: 20, d: 20 }, capabilities: {}, props: {}, ...over,
} as Entity);

describe("world/standables — eligibility is data, never height", () => {
  it("a seat stands on its own cushion; a lounge piece on its seat surface; a flat-topped kind on its table top", () => {
    expect(standableTop(ent({ capabilities: { seat: { cushionTopY: 14.4 } } as never }))).toBe(14.4);
    expect(standableTop(ent({ capabilities: { lounge: { slots: [{ contactLocal: { x: 0, y: 15.6, z: 0 } }, { contactLocal: { x: 9, y: 15.2, z: 0 } }] } } as never }))).toBe(15.6);
    for (const [kind, top] of Object.entries(STANDABLE_KIND_TOPS)) expect(standableTop(ent({ kind }))).toBe(top);
  });

  it("MISSING DATA BLOCKS: desks, planters, baked solids, screens and anything unknown are not standable", () => {
    for (const kind of ["member-desk", "lead-desk", "exec-planter", "solid", "screen", "cabinet", "column", "plant", "glass-door-leaf"]) {
      expect(standableTop(ent({ kind }))).toBeNull();
    }
    expect(standableFromEntity(ent({ kind: "round-table", footprint: { shape: "circle", r: 16, solid: false } }))).toBeNull();
    expect(standableFromEntity(ent({ kind: "round-table", footprint: undefined }))).toBeNull();
  });

  it("the index answers the top under a body, the tops it has cleared, and validates a published height", () => {
    const idx = new StandableIndex([standableFromEntity(ent({ id: "r/sofa", capabilities: { lounge: { slots: [{ contactLocal: { x: 0, y: 15.6, z: 0 } }] } } as never }))!]);
    expect(idx.topUnder({ x: 0, z: 0 }, 3)).toBe(15.6);
    expect(idx.topUnder({ x: 40, z: 0 }, 3)).toBe(-Infinity);
    expect([...idx.cleared({ x: 0, z: 0 }, 8, 15.6 + 1.5)]).toEqual(["r/sofa"]);
    expect(idx.cleared({ x: 0, z: 0 }, 8, 10).size).toBe(0);
    expect(idx.topMatching({ x: 0, z: 0 }, 3, 15.6)).toBe(15.6);
    expect(idx.topMatching({ x: 0, z: 0 }, 3, 40)).toBeNull(); //   a height that names no real top is ignored
    expect(idx.topMatching({ x: 60, z: 0 }, 3, 15.6)).toBeNull(); // …as is one where there is no piece at all
  });

  it("a campus bench's outline is the very box the ground model blocks with", () => {
    const g = exteriorGround();
    const bench = g.solids.find((s) => s.id.startsWith("bench:") && "box" in s && (s as { box: { sin: number } }).box.sin !== 0)
      ?? g.solids.find((s) => s.id.startsWith("bench:"))!;
    expect("box" in bench).toBe(true);
    const st = standableFromBox(bench.id, CAMPUS_BENCH_TOP, (bench as { box: Parameters<typeof standableFromBox>[2] }).box);
    const { x, z } = (bench as { box: { x: number; z: number } }).box;
    for (let i = 0; i < 400; i++) {
      const p = { x: x + Math.cos(i * 1.7) * (i % 50), z: z + Math.sin(i * 2.3) * (i % 40) };
      expect(st.dist(p) < 4).toBe(solidOverlaps(bench, p, 4));
    }
  });

  it("insidePolygon", () => {
    const sq: Vec2[] = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }];
    expect(insidePolygon({ x: 5, z: 5 }, sq)).toBe(true);
    expect(insidePolygon({ x: 15, z: 5 }, sq)).toBe(false);
  });
});

// ---- the office, for real: the ground floor's rooms and the same stand test the player uses ------------------
const ROOMS = [DESIGN_ROOM, RECEPTION_ROOM, MEETING_ROOM, PROJECT_ROOM, GAMING_ROOM, CENTRAL_HUB, EXECUTIVE_ROOM, CMS_ROOM, AI_ROOM, DEV_ROOM, QA_ROOM];
function office() {
  const world = new WorldState();
  for (const r of ROOMS) world.addRoom(r);
  for (const e of [...designRoomEntities(), ...receptionEntities(), ...meetingRoomEntities(), ...projectRoomEntities(), ...gamingRoomEntities(), ...centralHubEntities(), ...executiveRoomEntities(), ...cmsRoomEntities(), ...aiRoomEntities(), ...devRoomEntities(), ...qaRoomEntities()]) world.addEntity(e);
  DESIGN_SOLIDS.forEach((r, i) => world.addEntity({ id: `${DESIGN_ROOM.id}/solid-${i}`, kind: "solid", roomId: DESIGN_ROOM.id, transform: { pos: { x: r.x + r.w / 2, z: r.z + r.d / 2 }, yaw: 0 }, footprint: { shape: "rect", w: r.w, d: r.d }, capabilities: {}, props: {}, source: { baked: true } }));
  registerGroundFloor(world);
  const inBounds = (p: Vec2) => world.walkableAt(p);
  const walkability = new Walkability(composeStatic(v2Static(v1Static, openedLayer([...HUB_BANDS, ...CORRIDOR_BANDS])), inBounds, clearanceLayer(worldClearances(world))));
  const derived = new DerivedNav(world, { roomIds: new Set(ROOMS.map((r) => r.id)) });
  walkability.attachDerived(derived, world);
  const stand = makeStandTest({ world, walkability, derived, radius: NAV_RADIUS, allowExterior: true });
  const items = [...world.entities.values()].map(standableFromEntity).filter((s): s is NonNullable<typeof s> => s !== null);
  return { world, stand, idx: new StandableIndex(items), items };
}

describe("parkour in the office — the same stand test, height-aware only where data says so", () => {
  const o = office();

  it("indexes the seating and the flat tables in every reconstructed room, and nothing structural", () => {
    const kinds = new Set(o.items.map((s) => o.world.entities.get(s.id)!.kind));
    for (const k of ["sofa", "tub-chair", "armchair", "cafe-chair", "round-table", "cafe-table", "conference-table"]) expect(kinds.has(k)).toBe(true);
    for (const k of kinds) expect(["solid", "plant", "screen", "glass-door-leaf", "column", "member-desk", "lead-desk"]).not.toContain(k);
  });

  it("A SOFA: solid to a body on the floor or below its cushion; stood on once the feet have cleared it", () => {
    const sofa = [...o.world.entities.values()].find((e) => e.kind === "sofa" && e.roomId === RECEPTION_ROOM.id)!;
    const p = sofa.transform.pos, top = standableTop(sofa)!;
    expect(o.stand(p)).toBe(false); //                                                         floor level: blocked, as always
    expect(o.stand(p, undefined, o.idx.cleared(p, NAV_RADIUS + 0.5, top - 4 + WALK_PROFILE.airClear))).toBe(false); // feet too low
    expect(o.stand(p, undefined, o.idx.cleared(p, NAV_RADIUS + 0.5, top + WALK_PROFILE.airClear))).toBe(true);  //    feet over the cushion
    expect(o.idx.topUnder(p, 3)).toBe(top);
  });

  it("WALLS (the Reception balustrade and every room front wall among them) stay closed at every height", () => {
    const everything = new Set(o.items.map((s) => s.id)); // the most permissive thing a body could ever have cleared
    for (const room of ROOMS) for (const r of room.wallSolids ?? []) {
      const c = { x: r.x + r.w / 2, z: r.z + r.d / 2 };
      expect(o.stand(c, undefined, everything)).toBe(false);
    }
    // the ignore set can only ever name entity ids: a wall's id is never one of them
    for (const id of everything) expect(id.includes("#wall")).toBe(false);
  });
});
