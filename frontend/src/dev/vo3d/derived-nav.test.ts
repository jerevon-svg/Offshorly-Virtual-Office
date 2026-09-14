// Phase 7B — GEOMETRY-DERIVED NAVIGATION.
//
// The foundation, proved on two rooms and nothing else: the Design Room (smallest dynamic case — one
// movable plant, one sliding door) and the Central Hub (hardest case in the office — a curved bench island,
// a monument, 24 café places). Every other reconstructed room stays on the V1 layer, and these tests assert
// that too: a regression in this phase can only come from the two rooms it switched on.
import { describe, expect, it } from "vitest";
import { EXECUTIVE_ROOM, executiveRoomEntities } from "./rooms/executive";
import { CMS_ROOM, cmsRoomEntities } from "./rooms/cms";
import { WorldState, type Entity } from "./world/WorldState";
import { registerGroundFloor } from "./rooms/ground-floor";
import { DESIGN_ROOM, DESIGN_WALLS, DOOR_ID, HERO_PLANT_ID, designRoomEntities, DESIGN_SOLIDS } from "./rooms/design-room";
import { RECEPTION_ROOM, receptionEntities } from "./rooms/reception";
import { MEETING_ROOM, meetingRoomEntities, NORTH_STRIP as MEETING_STRIP } from "./rooms/meeting";
import { PROJECT_ROOM, projectRoomEntities, NORTH_STRIP as PROJECT_STRIP } from "./rooms/project";
import { GAMING_ROOM, gamingRoomEntities, NORTH_STRIP as GAMING_STRIP, WEST_STRIP as GAMING_WEST } from "./rooms/gaming";
/** the four RETIRED strips, kept here so the retirement stays provable rather than assumed */
const RETIRED_BANDS = [MEETING_STRIP, PROJECT_STRIP, GAMING_STRIP, GAMING_WEST];
import {
  CENTRAL_HUB, CENTRAL_HUB_ID, CAFE_CHAIR_IDS, HUB_LOUNGE_IDS, ISLAND, MONUMENT_FOOTPRINT, OPEN_BANDS,
  cafeChairId, cafeSeats, centralHubEntities, hubArchitectureSolids,
} from "./rooms/central-hub";
import { Walkability, composeStatic } from "./nav/Walkability";
import { clearanceLayer, worldClearances, BODY_RADIUS, NAV_RADIUS } from "./nav/clearance";
import { DerivedNav } from "./nav/derived";
import { Connectivity } from "./nav/connectivity";
import { compareToV1 } from "./nav/diagnostics";
import { distToRect, distToSector, entityShape, roomSolids } from "./nav/solids";
import { openedCells, openedLayer, v2Static } from "./nav/v2Open";
import { planWalk } from "./nav/planner";
import { v1Static, worldToCell, cellCentre, CELL } from "./adapters/v1Grid";
import { pointInRect, type Vec2 } from "./core/coords";

/** 7C: every reconstructed room. The hall and the five unreconstructed rooms stay V1-governed. */
const DERIVED = new Set([DESIGN_ROOM.id, RECEPTION_ROOM.id, MEETING_ROOM.id, PROJECT_ROOM.id, GAMING_ROOM.id, CENTRAL_HUB_ID, EXECUTIVE_ROOM.id, CMS_ROOM.id]);

/** the same wiring bootstrap.ts uses, minus THREE */
function rig(derivedRooms: ReadonlySet<string> = DERIVED) {
  const world = new WorldState();
  for (const r of [DESIGN_ROOM, RECEPTION_ROOM, MEETING_ROOM, PROJECT_ROOM, GAMING_ROOM, CENTRAL_HUB, EXECUTIVE_ROOM, CMS_ROOM]) world.addRoom(r);
  for (const e of [...designRoomEntities(), ...receptionEntities(), ...meetingRoomEntities(), ...projectRoomEntities(), ...gamingRoomEntities(), ...centralHubEntities(), ...executiveRoomEntities(), ...cmsRoomEntities()]) world.addEntity(e);
  DESIGN_SOLIDS.forEach((r, i) =>
    world.addEntity({ id: `${DESIGN_ROOM.id}/solid-${i}`, kind: "solid", roomId: DESIGN_ROOM.id, transform: { pos: { x: r.x + r.w / 2, z: r.z + r.d / 2 }, yaw: 0 }, footprint: { shape: "rect", w: r.w, d: r.d }, capabilities: {}, props: {}, source: { baked: true } } satisfies Entity));
  const plan = registerGroundFloor(world);
  const inBounds = (p: Vec2) => world.walkableAt(p);
  const bands = [...OPEN_BANDS]; // 7C: the four room strips are retired; the hub's six are retained
  const walkability = new Walkability(composeStatic(v2Static(v1Static, openedLayer(bands)), inBounds, clearanceLayer(worldClearances(world))));
  const derived = new DerivedNav(world, { roomIds: derivedRooms });
  walkability.attachDerived(derived, world);
  return { world, walkability, derived, inBounds, plan };
}
const connectivity = (w: Walkability) => new Connectivity(w.walkable, undefined, w.edgeOk);

// ============================= 1 · LOGICAL SOLIDS ================================================
describe("7B — logical solids", () => {
  it("never reads geometry from the render tree: every solid comes from authored room data", () => {
    const { world, derived } = rig();
    const solids = roomSolids(world, DERIVED);
    expect(solids.length).toBeGreaterThan(80);
    // walls are the room's own constants, verbatim
    const walls = solids.filter((s) => s.from === "wall").map((s) => (s.shape.kind === "rect" ? s.shape.rect : null));
    for (const w of DESIGN_WALLS) expect(walls, "design wall missing from the solid set").toContainEqual(w);
    // the hub is a wall-less atrium and says so POSITIVELY
    expect(CENTRAL_HUB.wallSolids).toEqual([]);
    expect(DESIGN_ROOM.wallSolids).toBe(DESIGN_WALLS);
    expect(derived.rebuilds).toBe(1); // one build at construction, not one per entity
  });

  it("physical furniture defaults SOLID and floor dressing opts out", () => {
    const chairs = centralHubEntities().filter((e) => e.kind === "cafe-chair");
    for (const c of chairs) expect(entityShape(c), `${c.id} must carve navigation`).not.toBeNull();
    // rugs / mats have a real extent but are walked over — declared, not merely omitted
    const rugs = gamingRoomEntities().filter((e) => e.kind === "rug");
    expect(rugs.length).toBeGreaterThan(0);
    for (const r of rugs) {
      expect(r.footprint, `${r.id} should still declare its extent`).toBeDefined();
      expect(r.footprint!.solid).toBe(false);
      expect(entityShape(r), `${r.id} must not block`).toBeNull();
    }
  });

  it("gives every floor-standing plant a logical circle, and shelf/hanging plants none", () => {
    const hub = centralHubEntities().filter((e) => e.kind === "plant");
    const onFloor = hub.filter((e) => (e.props.y ?? 0) === 0);
    expect(onFloor.length).toBeGreaterThan(0);
    for (const p of onFloor) expect(p.footprint?.shape, `${p.id}`).toBe("circle");
    for (const p of hub.filter((e) => Number(e.props.y ?? 0) > 0)) expect(p.footprint, `${p.id} sits in a planter`).toBeUndefined();
    const design = designRoomEntities().filter((e) => e.kind === "plant");
    for (const p of design) {
      const floor = !p.props.hanging && Number(p.props.y ?? 0) === 0;
      expect(Boolean(p.footprint), `${p.id} floor=${floor}`).toBe(floor);
    }
  });

  it("models the hub's curved benches as annulus SECTORS, not bounding boxes", () => {
    const arcs = hubArchitectureSolids().filter((e) => e.footprint?.shape === "sector");
    expect(arcs).toHaveLength(4);
    const { derived } = rig();
    // the point dead centre of the island is inside the MONUMENT, and the medallion ring around it is not
    // inside any bench — which a bounding box could never express
    const insideGapRadius = { x: ISLAND.centre.x, z: ISLAND.centre.z - (ISLAND.rIn + ISLAND.rOut) / 2 };
    const c = worldToCell(insideGapRadius);
    expect(derived.clear(c.cx, c.cy, NAV_RADIUS), "the north gap passes between two arcs").toBe(true);
  });

  it("distance functions are exact at the shapes' faces", () => {
    expect(distToRect({ x: 0, z: 0 }, { x: 10, z: 0, w: 5, d: 5 })).toBeCloseTo(10, 6);
    expect(distToRect({ x: 12, z: 2 }, { x: 10, z: 0, w: 5, d: 5 })).toBe(0);
    const sec = { c: { x: 0, z: 0 }, rIn: 10, rOut: 20, from: 0, to: 90 };
    expect(distToSector({ x: 15, z: 0 }, sec)).toBe(0); // due north, mid-annulus → inside
    expect(distToSector({ x: 0, z: 0 }, sec)).toBeCloseTo(10, 6); // centre → rIn away
    expect(distToSector({ x: 0, z: 25 }, sec)).toBeGreaterThan(0); // due south → outside the wedge
  });
});

// ============================= 2 · CLEARANCE ====================================================
describe("7B — clearance", () => {
  it("keeps ONE definition of each radius, and routes looser than it clears architecture", () => {
    expect(BODY_RADIUS).toBe(10.5);
    expect(NAV_RADIUS).toBeLessThan(BODY_RADIUS); // routing furniture is not clearing a door jamb
    expect(NAV_RADIUS).toBeGreaterThan(7); // and it is not a licence to squeeze through anything
  });

  it("NAV_RADIUS is the largest value that costs the Central Hub nothing", () => {
    const { world } = rig();
    const derived = new DerivedNav(world, { roomIds: new Set([CENTRAL_HUB_ID]) });
    const fallback = (cx: number, cy: number) => v2Static(v1Static, openedLayer(OPEN_BANDS))(cx, cy) && world.walkableAt(cellCentre({ cx, cy }));
    const worstApproach = (r: number): number => {
      const walk = derived.predicate(r, fallback);
      const conn = new Connectivity(walk, undefined, derived.edge(r));
      let worst = 0;
      for (const s of cafeSeats()) {
        let best = Infinity;
        const st = worldToCell({ x: s.x, z: s.z });
        for (let dy = -6; dy <= 6; dy++)
          for (let dx = -6; dx <= 6; dx++) {
            const c = { cx: st.cx + dx, cy: st.cy + dy };
            if (!walk(c.cx, c.cy) || !conn.has(c)) continue;
            const p = derived.pointOf(c, r);
            best = Math.min(best, Math.hypot(p.x - s.x, p.z - s.z));
          }
        worst = Math.max(worst, best);
      }
      return worst;
    };
    // THE KNEE: one step up from NAV_RADIUS and an inner café place loses its own aisle and falls back to
    // the next bay. This is the evidence the constant's own comment quotes; if the room's composition ever
    // changes, this is what tells us the number needs choosing again.
    const here = worstApproach(NAV_RADIUS);
    const above = worstApproach(NAV_RADIUS + 0.5);
    expect(here).toBeLessThan(above);
    expect(here).toBeLessThanOrEqual(65);
  });
});

// ============================= 3 · DESIGN ROOM PROOF ============================================
describe("7B proof A — Design Room", () => {
  it("derives its floor from geometry: walls block, open floor walks, V1 is never consulted inside", () => {
    const { derived, walkability } = rig();
    const inside = worldToCell({ x: DESIGN_ROOM.floorRect.x + 120, z: DESIGN_ROOM.floorRect.z + 90 });
    expect(derived.governs(inside.cx, inside.cy)).toBe(true);
    expect(walkability.isDerived(inside.cx, inside.cy)).toBe(true);
    // a cell inside the north wall run is blocked by the wall, and says so
    const wall = worldToCell({ x: DESIGN_ROOM.rect.x + 200, z: DESIGN_ROOM.rect.z + 2 });
    expect(derived.clear(wall.cx, wall.cy, NAV_RADIUS)).toBe(false);
  });

  it("PLANT MOVE: the old space reopens and the new space blocks, with no world rebuild", () => {
    const { world, walkability, derived, inBounds } = rig();
    const plant = world.get(HERO_PLANT_ID);
    const from = { ...plant.transform.pos };
    // dead centre of an open cell, so the 8-unit pot covers enough of it to flip the whole cell's verdict.
    // (Parked in a cell's CORNER an 8-unit pot correctly leaves the far corner standable — sub-cell stand
    // points mean a cell is "somewhere a body fits", and a small obstacle no longer condemns all 256 units
    // of floor around itself. That is the point of the field, but it makes a corner a poor proof.)
    const b = { cx: 17, cy: 27 };
    const to = cellCentre(b);
    const a = worldToCell(from);
    expect(derived.clear(a.cx, a.cy, NAV_RADIUS), "the plant blocks where it stands").toBe(false);
    expect(derived.clear(b.cx, b.cy, NAV_RADIUS), "the target cell starts open").toBe(true);
    const rebuildsBefore = derived.rebuilds;
    const updatesBefore = walkability.stats.invalidations;

    world.commit((tx) => tx.setTransform(HERO_PLANT_ID, { pos: to, yaw: 0 }));

    expect(derived.clear(a.cx, a.cy, NAV_RADIUS), "the space it LEFT reopens").toBe(true);
    expect(derived.clear(b.cx, b.cy, NAV_RADIUS), "the space it TOOK blocks").toBe(false);
    expect(derived.clearanceAtPoint(to)).toBe(0); // the pot is literally there now
    expect(derived.clearanceAtPoint(from)).toBeGreaterThan(NAV_RADIUS); // and no longer there
    expect(derived.rebuilds, "a move must never rebuild the world").toBe(rebuildsBefore);
    expect(walkability.stats.invalidations).toBe(updatesBefore + 1);
    // and the planner agrees: the old spot is now a legal destination, the new one is not
    const start = { x: DESIGN_ROOM.floorRect.x + 60, z: DESIGN_ROOM.floorRect.z + 40 };
    expect(planWalk(start, from, walkability, inBounds).ok).toBe(true);
    const blocked = planWalk(start, to, walkability, inBounds);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toBe("unwalkable");
  });

  it("moves only the cells the change can reach", () => {
    const { world, walkability, derived } = rig();
    const before = walkability.stats.cellsInvalidated;
    world.commit((tx) => tx.setTransform(HERO_PLANT_ID, { pos: cellCentre({ cx: 17, cy: 27 }), yaw: 0 }));
    const touched = walkability.stats.cellsInvalidated - before;
    expect(touched).toBeGreaterThan(0);
    // an 8-unit pot at two positions, dilated by radius + a cell: dozens of cells, not the 7020-cell world
    expect(touched).toBeLessThan(120);
    expect(derived.rebuilds).toBe(1);
  });

  it("DOOR: an AUTOMATIC door is modelled parked, so it can never seal the room that has to open it", () => {
    const { world, derived } = rig();
    const door = world.get(DOOR_ID).capabilities.door!;
    expect(door.leaf, "the door must declare its closed leaf as pure data").toBeDefined();
    expect(door.automatic, "both office doors open for whoever walks up").toBe(true);
    // 7C CORRECTION to 7B. Feeding the LIVE leaf into the routing field deadlocks an automatic door:
    // SlidingDoor only opens when the remaining route already passes through its crossing, so a closed
    // leaf means no route is ever planned through the doorway, the door is never asked to open, and the
    // room is sealed. Modelled parked, the doorway routes — and `clearance.solids` already describes the
    // parked leaf and fixed pane, which is what actually narrows the passage.
    const mid = { x: door.leaf!.x + door.leaf!.w / 2, z: door.leaf!.z + door.leaf!.d / 2 };
    const parked = { x: mid.x + door.slide.x * door.slideDistance, z: mid.z + door.slide.z * door.slideDistance };
    expect(derived.clearanceAtPoint(mid), "the doorway itself is clear").toBeGreaterThan(NAV_RADIUS);
    expect(derived.clearanceAtPoint(parked), "the leaf is solid where it parks").toBeLessThan(NAV_RADIUS);
  });

  it("DOOR: a door that is NOT automatic does move navigation, incrementally and without a rebuild", () => {
    const { world, walkability, derived } = rig();
    // the live-fraction path is what a manual or locked door needs. Exercised here on a synthetic one so
    // the machinery is covered by a test rather than by assertion.
    const id = `${DESIGN_ROOM.id}/test-manual-door`;
    const leaf = { x: DESIGN_ROOM.floorRect.x + 100, z: DESIGN_ROOM.floorRect.z + 60, w: 60, d: 6 };
    world.addEntity({
      id, kind: "solid", roomId: DESIGN_ROOM.id, transform: { pos: { x: leaf.x + leaf.w / 2, z: leaf.z }, yaw: 0 },
      capabilities: { door: { slide: { x: 0, z: 1 }, slideDistance: 64, crossing: leaf, trigger: leaf, leaf, clearance: { band: leaf, solids: [], bodyRadius: BODY_RADIUS }, timings: { openMs: 1, closeMs: 1, holdMs: 1 } } },
      props: {}, source: { baked: true },
    });
    derived.rebuild();
    const mid = { x: leaf.x + leaf.w / 2, z: leaf.z + leaf.d / 2 };
    const rebuilds = derived.rebuilds;
    walkability.setDoorOpenFraction(world, id, 0);
    const closed = derived.clearanceAtPoint(mid);
    walkability.setDoorOpenFraction(world, id, 1);
    const open = derived.clearanceAtPoint(mid);
    expect(closed).toBe(0); // the leaf is right there
    expect(open, "sliding the leaf away frees the space it held").toBeGreaterThan(closed);
    expect(derived.rebuilds, "a door step must never rebuild the world").toBe(rebuilds);
    expect(walkability.stats.invalidations).toBeGreaterThan(0);
  });

  it("still routes out through the real doorway, in both directions", () => {
    const { walkability, inBounds } = rig();
    // the same two anchors floor.test.ts uses for the V1 baseline: chair-4's stand cell (11,31) and the
    // hall cell outside the Executive door (45,19). If derived navigation broke the doorway, this is where
    // it would show — the route has to leave a derived room and cross into V1-governed hall.
    const approach: Vec2 = { x: DESIGN_ROOM.rect.x + 174.5, z: DESIGN_ROOM.rect.z + 187.8 };
    const hall: Vec2 = { x: (45 + 0.5) * CELL, z: (19 + 0.5) * CELL };
    const out = planWalk(approach, hall, walkability, inBounds);
    expect(out.ok, `outbound route failed: ${out.ok ? "" : out.reason}`).toBe(true);
    const back = planWalk(hall, approach, walkability, inBounds);
    expect(back.ok, `inbound route failed: ${back.ok ? "" : back.reason}`).toBe(true);
    // every leg has to be walkable on the composed layer, derived legs included
    if (out.ok) {
      let prev = approach;
      for (const p of out.path) { const c = worldToCell(p); expect(walkability.walkable(c.cx, c.cy), `leg to ${p.x},${p.z}`).toBe(true); prev = p; }
      expect(prev).toBeDefined();
    }
  });
});

// ============================= 4 · CENTRAL HUB PROOF ============================================
describe("7B proof B — Central Hub", () => {
  it("respects the monument, the bench arcs and the planters as physical solids", () => {
    const { derived } = rig();
    const centre = worldToCell(ISLAND.centre);
    expect(derived.clear(centre.cx, centre.cy, NAV_RADIUS), "the monument blocks").toBe(false);
    expect(derived.nearestSolid(centre.cx, centre.cy)?.solid.id).toContain("monument");
    // a point on the bench annulus, between two gaps
    const onBench = { x: ISLAND.centre.x - (ISLAND.rIn + ISLAND.rOut) / 2 * Math.SQRT1_2, z: ISLAND.centre.z - (ISLAND.rIn + ISLAND.rOut) / 2 * Math.SQRT1_2 };
    const bc = worldToCell(onBench);
    expect(derived.clear(bc.cx, bc.cy, NAV_RADIUS), "you cannot stand inside a bench").toBe(false);
  });

  it("reaches ALL 24 café places and every lounge slot, with no hand-typed exception", () => {
    const { world, walkability } = rig();
    const conn = connectivity(walkability);
    for (const ref of cafeSeats()) {
      const e = world.get(cafeChairId(ref.table, ref.side));
      const seat = e.capabilities.seat!;
      expect(conn.at(seat.approach), `${e.id} approach unreachable`).toBe(true);
    }
    expect(CAFE_CHAIR_IDS).toHaveLength(24);
    for (const id of HUB_LOUNGE_IDS)
      for (const slot of world.get(id).capabilities.lounge!.slots)
        expect(conn.at(slot.approach), `${id}/${slot.id} approach unreachable`).toBe(true);
  });

  it("improves every café approach it can and never makes one worse", () => {
    const { world } = rig();
    // the 7A baseline, measured on V1 + OpenBands at cell-centre granularity, before this phase
    const BASELINE_WORST = 78.8;
    const BASELINE_OVER_45 = 10;
    const ds = cafeSeats().map((ref) => {
      const seat = world.get(cafeChairId(ref.table, ref.side)).capabilities.seat!;
      return Math.hypot(seat.approach.x - ref.x, seat.approach.z - ref.z);
    });
    expect(Math.max(...ds)).toBeLessThan(BASELINE_WORST);
    expect(ds.filter((d) => d > 45).length).toBeLessThan(BASELINE_OVER_45);
    // the median place is now within a cell and a half of its chair
    const sorted = [...ds].sort((a, b) => a - b);
    expect(sorted[11]).toBeLessThanOrEqual(CELL * 1.5);
  });

  it("keeps every stand point inside the room and on genuinely open floor", () => {
    const { world, derived } = rig();
    for (const e of world.inRoom(CENTRAL_HUB_ID)) {
      const pts: Vec2[] = [];
      if (e.capabilities.seat) pts.push(e.capabilities.seat.approach);
      if (e.capabilities.approach) pts.push(e.capabilities.approach.point);
      for (const s of e.capabilities.lounge?.slots ?? []) pts.push(s.approach);
      for (const p of pts) {
        expect(pointInRect(p, CENTRAL_HUB.rect), `${e.id} stand point outside the hub`).toBe(true);
        const c = worldToCell(p);
        expect(derived.clear(c.cx, c.cy, NAV_RADIUS), `${e.id} stand point does not hold a body`).toBe(true);
        expect(pointInRect(p, MONUMENT_FOOTPRINT), `${e.id} stand point inside the monument`).toBe(false);
      }
    }
  });
});

// ============================= 5 · DIAGNOSTIC ===================================================
describe("7B — V1 ↔ derived diagnostic", () => {
  it("buckets every governed cell and explains each obstruction", () => {
    const { world, walkability, derived } = rig();
    const conn = connectivity(walkability);
    const report = compareToV1(derived, v1Static, NAV_RADIUS, world, conn);
    const total = Object.values(report.counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(report.governed);
    expect(report.governed).toBeGreaterThan(2000);
    // the 2D painting over-blocked real floor — that is the whole reason this phase exists
    expect(report.counts["legacy-open"]).toBeGreaterThan(0);
    // and every cell geometry closes that V1 allowed names the solid responsible
    for (const o of report.obstructions) expect(o.cause, `${o.cell.cx},${o.cell.cy} unexplained`).not.toBeNull();
    expect([...report.byRoom.keys()].sort()).toEqual([...DERIVED].sort()); // all six reconstructed rooms
  });

  it("treats connectivity as first-class: stranded cells are counted, not hidden", () => {
    const { world, walkability, derived } = rig();
    const conn = connectivity(walkability);
    const report = compareToV1(derived, v1Static, NAV_RADIUS, world, conn);
    // the hub's sealed east/west bench pockets are exactly this: open floor nobody can reach
    expect(report.strandedCells.length).toBeGreaterThan(0);
    for (const c of report.strandedCells) expect(derived.clear(c.cx, c.cy, NAV_RADIUS)).toBe(true);
  });
});

// ============================= 6 · SAFETY =======================================================
describe("7B — safety", () => {
  it("leaves every unmigrated room, the hall and the V1 grid exactly as they were", () => {
    const withDerived = rig();
    const withoutDerived = rig(new Set<string>());
    let differences = 0;
    for (let cy = 0; cy < 78; cy++)
      for (let cx = 0; cx < 90; cx++) {
        if (withDerived.derived.governs(cx, cy)) continue; // the two proof rooms are allowed to differ
        if (withDerived.walkability.walkable(cx, cy) !== withoutDerived.walkability.walkable(cx, cy)) differences++;
      }
    expect(differences, "derived navigation must not touch a cell it does not govern").toBe(0);
  });

  it("governs exactly the six reconstructed rooms — never the hall, never an unreconstructed interior", () => {
    const { derived, world } = rig();
    const rooms = new Set(derived.governedCells().map((c) => world.regionAt(cellCentre(c))?.roomId));
    expect([...rooms].sort()).toEqual([...DERIVED].sort());
    // and every governed cell's centre really is inside its room's own walkable floor region
    for (const c of derived.governedCells()) {
      const region = world.regionAt(cellCentre(c));
      expect(region?.walkable, `${c.cx},${c.cy}`).toBe(true);
      expect(region?.kind).toBe("room-floor");
    }
  });

  it("never double-counts: a derived room's entities are off the legacy dynamic layer", () => {
    const { walkability } = rig();
    // the hero plant is the ONLY navBlocker in the world and it lives in a derived room
    expect(walkability.dynamicBlockedKeys).toHaveLength(0);
  });

  it("RETIRED four OpenBands only because derived navigation reproduces every cell they opened", () => {
    const { derived } = rig();
    for (const band of RETIRED_BANDS)
      for (const c of openedCells([band])) {
        expect(derived.governs(c.cx, c.cy), `${band.id} cell ${c.cx},${c.cy} is outside derived space`).toBe(true);
        expect(derived.clear(c.cx, c.cy, NAV_RADIUS), `${band.id} cell ${c.cx},${c.cy} is not reproduced`).toBe(true);
      }
  });

  it("RETAINS the Central Hub's bands: one of them is not fully reproduced", () => {
    const { derived } = rig();
    const blocked = OPEN_BANDS.flatMap((b) => openedCells([b]).filter((c) => !derived.clear(c.cx, c.cy, NAV_RADIUS)));
    expect(blocked.length, "a hub band still disagrees with geometry, so the set stays").toBeGreaterThan(0);
  });

  it("keeps the retained OpenBands in place and the V1 grid readable and unchanged", () => {
    expect(OPEN_BANDS.length).toBeGreaterThan(0); // the hub's six are retained
    // the production grid still answers for itself, untouched
    expect(v1Static(0, 0)).toBe(false);
    expect(typeof v1Static(45, 60)).toBe("boolean");
  });
});
