// Phase 4C stage 3 — PLACEMENT BENCHMARK, on the real office floor.
//
// Not a micro-benchmark against a toy stand test: this builds the SAME WorldState, Walkability and
// DerivedNav bootstrap.ts builds, wires the SAME makeStandTest, and uses the SAME homeDeskWorldPoint
// transform app/world.ts hands Coworkers. What it does not build is the renderer — the placement pass is
// pure main-thread JS and never touches WebGL, so the cost measured here is the cost the frame pays.
//
// Run: npx vitest run --include src/dev/vo3d/world/coworkerPlacement.bench.ts
import { describe, expect, it } from "vitest";
import { CoworkerPlacer, placeCoworkers } from "./Coworkers";
import { WorldState, type Entity } from "./WorldState";
import { registerGroundFloor, ROOM_WORLD_SHIFT_Z } from "../rooms/ground-floor";
import { DESIGN_ROOM, DESIGN_SOLIDS, designRoomEntities } from "../rooms/design-room";
import { RECEPTION_ROOM, receptionEntities } from "../rooms/reception";
import { MEETING_ROOM, meetingRoomEntities } from "../rooms/meeting";
import { PROJECT_ROOM, projectRoomEntities } from "../rooms/project";
import { GAMING_ROOM, gamingRoomEntities } from "../rooms/gaming";
import { CENTRAL_HUB, CENTRAL_HUB_ID, OPEN_BANDS, centralHubEntities } from "../rooms/central-hub";
import { EXECUTIVE_ROOM, executiveRoomEntities } from "../rooms/executive";
import { CMS_ROOM, cmsRoomEntities } from "../rooms/cms";
import { AI_ROOM, aiRoomEntities } from "../rooms/ai";
import { DEV_ROOM, devRoomEntities } from "../rooms/dev";
import { QA_ROOM, qaRoomEntities } from "../rooms/qa";
import { Walkability, composeStatic } from "../nav/Walkability";
import { clearanceLayer, worldClearances, NAV_RADIUS } from "../nav/clearance";
import { DerivedNav } from "../nav/derived";
import { v1Static } from "../adapters/v1Grid";
import { openedLayer, v2Static } from "../nav/v2Open";
import { makeStandTest } from "../player/standTest";
import { homeDeskWorldPoint } from "../app/spawn";
import { v1Rooms } from "../adapters/v1Floor";
import { resolveVo3dCoworkers } from "../adapters/v1Coworkers";
import type { OfficePerson } from "../../../services/office/floorMerge";
import type { Vo3dCoworker } from "../app/coworkers";
import type { Vec2 } from "../core/coords";

const DERIVED = new Set([
  DESIGN_ROOM.id, RECEPTION_ROOM.id, MEETING_ROOM.id, PROJECT_ROOM.id, GAMING_ROOM.id,
  CENTRAL_HUB_ID, EXECUTIVE_ROOM.id, CMS_ROOM.id, AI_ROOM.id, DEV_ROOM.id, QA_ROOM.id,
]);

/** bootstrap.ts's wiring, minus THREE — identical to derived-nav.test.ts's rig */
function realFloor() {
  const world = new WorldState();
  for (const r of [DESIGN_ROOM, RECEPTION_ROOM, MEETING_ROOM, PROJECT_ROOM, GAMING_ROOM, CENTRAL_HUB, EXECUTIVE_ROOM, CMS_ROOM, AI_ROOM, DEV_ROOM, QA_ROOM]) world.addRoom(r);
  for (const e of [...designRoomEntities(), ...receptionEntities(), ...meetingRoomEntities(), ...projectRoomEntities(), ...gamingRoomEntities(), ...centralHubEntities(), ...executiveRoomEntities(), ...cmsRoomEntities(), ...aiRoomEntities(), ...devRoomEntities(), ...qaRoomEntities()]) world.addEntity(e);
  DESIGN_SOLIDS.forEach((r, i) =>
    world.addEntity({ id: `${DESIGN_ROOM.id}/solid-${i}`, kind: "solid", roomId: DESIGN_ROOM.id, transform: { pos: { x: r.x + r.w / 2, z: r.z + r.d / 2 }, yaw: 0 }, footprint: { shape: "rect", w: r.w, d: r.d }, capabilities: {}, props: {}, source: { baked: true } } satisfies Entity));
  registerGroundFloor(world);
  const inBounds = (p: Vec2) => world.walkableAt(p);
  const walkability = new Walkability(composeStatic(v2Static(v1Static, openedLayer([...OPEN_BANDS])), inBounds, clearanceLayer(worldClearances(world))));
  const derived = new DerivedNav(world, { roomIds: DERIVED });
  walkability.attachDerived(derived, world);
  const raw = makeStandTest({ world, walkability, derived, radius: NAV_RADIUS, allowExterior: true });
  let calls = 0;
  const canStand = (p: Vec2) => { calls++; return raw(p); };
  return { canStand, calls: () => calls, reset: () => { calls = 0; } };
}

const toWorld = (p: Vec2): Vec2 => homeDeskWorldPoint(p, v1Rooms(), ROOM_WORLD_SHIFT_Z);

function person(email: string, roomId: string, avatarId: string): OfficePerson {
  return { email, displayName: email.split("@")[0], status: "ONLINE", departmentName: "Design", jobTitle: null, currentActivity: null, lastMessage: null, avatarId, roomId, atlasRoomId: null, inEphemeralRoom: false };
}

/** 60 real-shaped roster rows, seated by V1's OWN per-room seating (data/rosterLayers), spread over the
 *  rooms that seating actually recognises — v1Floor's room LAYER ids and the roster's room table do not
 *  fully overlap, and a person in a room the seating has no rect for is dropped rather than seated. */
function seatingRooms(): string[] {
  return v1Rooms()
    .map((r) => r.id)
    .filter((id) => resolveVo3dCoworkers([person(`probe@offshorly.com`, id, "bon")], new Set<string>(), "").coworkers.length === 1);
}

function roster60(): readonly Vo3dCoworker[] {
  const cast = ["bon", "alex", "micah", "jan", "angelo"];
  const rooms = seatingRooms();
  const people: OfficePerson[] = [];
  for (let i = 0; i < 60; i++) people.push(person(`bench${String(i).padStart(2, "0")}@offshorly.com`, rooms[i % rooms.length], cast[i % cast.length]));
  const { coworkers } = resolveVo3dCoworkers(people, new Set<string>(), "");
  return coworkers;
}

function live(c: Vo3dCoworker, point: Vec2): Vo3dCoworker {
  return { ...c, point, posSource: "live" };
}

function stats(ms: number[]) {
  const s = [...ms].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return {
    mean: ms.reduce((a, b) => a + b, 0) / ms.length,
    p50: at(0.5), p95: at(0.95), p99: at(0.99), max: s[s.length - 1],
  };
}

const f4 = (n: number) => n.toFixed(4);

/** One scenario, run BEFORE (a fresh uncached pass every tick, i.e. HEAD 6eeadcd) and AFTER (one placer). */
function run(label: string, ticks: readonly (readonly Vo3dCoworker[])[]): { beforeCalls: number; afterCalls: number } {
  const floorA = realFloor();
  const floorB = realFloor();
  // warm both JIT and both floors' lazily-built structures identically
  for (let i = 0; i < 3; i++) {
    placeCoworkers(ticks[0], toWorld, floorA.canStand, NAV_RADIUS);
    new CoworkerPlacer(toWorld, floorB.canStand, NAV_RADIUS).place(ticks[0]);
  }

  floorA.reset();
  const before: number[] = [];
  for (const list of ticks) {
    const t = performance.now();
    placeCoworkers(list, toWorld, floorA.canStand, NAV_RADIUS);
    before.push(performance.now() - t);
  }

  floorB.reset();
  const placer = new CoworkerPlacer(toWorld, floorB.canStand, NAV_RADIUS);
  const after: number[] = [];
  for (const list of ticks) {
    const t = performance.now();
    placer.place(list);
    after.push(performance.now() - t);
  }

  const b = stats(before);
  const a = stats(after);
  console.log(`\n=== ${label} — ${ticks.length} ticks, ${ticks[0].length} coworkers ===`);
  console.log(`            mean      p50       p95       p99       max       standTest calls`);
  console.log(`BEFORE   ${f4(b.mean)} ms  ${f4(b.p50)} ms  ${f4(b.p95)} ms  ${f4(b.p99)} ms  ${f4(b.max)} ms   ${floorA.calls()}`);
  console.log(`AFTER    ${f4(a.mean)} ms  ${f4(a.p50)} ms  ${f4(a.p95)} ms  ${f4(a.p99)} ms  ${f4(a.max)} ms   ${floorB.calls()}`);
  console.log(`saved    ${(100 - (a.mean / b.mean) * 100).toFixed(1)}% mean, ${(100 - (a.p99 / b.p99) * 100).toFixed(1)}% p99, ${(100 - (floorB.calls() / floorA.calls()) * 100).toFixed(1)}% stand tests`);
  // How the cost lands on a 60 fps budget. The positions feed ticks at 2 Hz and sync() runs inside the
  // frame, so these are the frames that carry it.
  const over = (ms: number[], t: number) => ms.filter((v) => v > t).length;
  console.log(`frames over 1/4 budget (4.2 ms): before ${over(before, 4.17)} / ${ticks.length}, after ${over(after, 4.17)}`);
  console.log(`frames over 1/8 budget (2.1 ms): before ${over(before, 2.08)} / ${ticks.length}, after ${over(after, 2.08)}`);
  return { beforeCalls: floorA.calls(), afterCalls: floorB.calls() };
}

describe("coworker placement on the real floor", () => {
  it("benchmarks 60 coworkers at 2 Hz", () => {
    const base = roster60();
    console.log(`\nroster: ${base.length} placeable coworkers over ${seatingRooms().length} seated rooms`);

    // 1 · the steady state the live feed actually produces: everyone seated, one person walking.
    const oneWalker: Vo3dCoworker[][] = [];
    for (let t = 0; t < 120; t++) {
      const next = [...base];
      next[7] = live(base[7], { x: base[7].point.x + t * 3, z: base[7].point.z + (t % 9) * 2 });
      oneWalker.push(next);
    }
    const walker = run("one coworker walking", oneWalker);
    // The assertion is the CALL COUNT, not the clock: it is deterministic, so this is a regression guard
    // that cannot flake on a loaded machine the way a millisecond threshold would.
    expect(walker.afterCalls).toBeLessThan(walker.beforeCalls * 0.05);

    // 2 · nobody moving at all — a roster refetch on every SSE reconnect.
    const idle = run("nobody moving (idle re-sync)", Array.from({ length: 120 }, () => base));
    // A re-sync of an unchanged roster must cost the FIRST pass and nothing after it.
    expect(idle.afterCalls).toBeLessThan(idle.beforeCalls * 0.02);

    // 3 · six people walking at once, the busy-office case.
    const movers = [3, 11, 19, 29, 41, 53];
    const sixWalkers: Vo3dCoworker[][] = [];
    for (let t = 0; t < 120; t++) {
      const next = [...base];
      for (const i of movers) next[i] = live(base[i], { x: base[i].point.x + t * 2, z: base[i].point.z + (t % 5) * 3 });
      sixWalkers.push(next);
    }
    const six = run("six coworkers walking", sixWalkers);
    expect(six.afterCalls).toBeLessThan(six.beforeCalls * 0.15);

    // 4 · the worst case the cache does NOT help: the roster itself changing every tick.
    const churn: Vo3dCoworker[][] = [];
    for (let t = 0; t < 40; t++) churn.push(base.slice(0, 50 + (t % 10)));
    const churned = run("roster churn every tick (cache miss by design)", churn);
    // Stated rather than hidden: when the roster itself changes every tick there is nothing to reuse, and
    // the cached pass does EXACTLY the work the uncached one did — no more, and no less.
    expect(churned.afterCalls).toBe(churned.beforeCalls);
  }, 120_000);
});
