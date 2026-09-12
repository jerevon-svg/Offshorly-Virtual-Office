import { describe, expect, it } from "vitest";
import manifest from "../../data/office-assets-manifest.json";
import { WorldState } from "./world/WorldState";
import { DESIGN_ROOM, designRoomEntities, HERO_PLANT_ID, RECT } from "./rooms/design-room";
import { groundFloor, groundFloorRegions, registerGroundFloor } from "./rooms/ground-floor";
import { MEETING_ROOM } from "./rooms/meeting";
import { PROJECT_ROOM } from "./rooms/project";
import { RECEPTION_ROOM } from "./rooms/reception";
import { FRAME, v1DoorOpenings, v1Rooms } from "./adapters/v1Floor";
import { CELL, v1Static, worldToCell } from "./adapters/v1Grid";
import { Walkability, composeStatic } from "./nav/Walkability";
import { clearanceLayer, worldClearances } from "./nav/clearance";
import { planWalk } from "./nav/planner";
import { footprintWallRects } from "./build/floorplan";
import { pointInRect, type Rect, type Vec2 } from "./core/coords";

const APPROACH: Vec2 = { x: RECT.x + 174.5, z: RECT.z + 187.8 }; // chair-4 stand-here cell (11,31)
const HALL_EXEC_DOOR: Vec2 = { x: 728, z: 312 }; // outside stand in front of the Executive door (45,19)
const DOOR_BAND: Rect = { x: 304, z: 400, w: 32, d: 64 }; // physically clear door cells col 19 + outside col 20, rows 25–28

function rig() {
  const world = new WorldState();
  world.addRoom(DESIGN_ROOM);
  world.addRoom(RECEPTION_ROOM);
  for (const e of designRoomEntities()) world.addEntity(e);
  world.addRoom(MEETING_ROOM);
  world.addRoom(PROJECT_ROOM);
  const plan = registerGroundFloor(world);
  const inBounds = (p: Vec2) => world.walkableAt(p);
  const wk = new Walkability(composeStatic(v1Static, inBounds, clearanceLayer(worldClearances(world))));
  wk.syncFromWorld(world);
  return { world, plan, inBounds, wk };
}
function legsWalkable(from: Vec2, path: Vec2[], walk: (cx: number, cy: number) => boolean): void {
  const pts = [from, ...path];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], len = Math.hypot(b.x - a.x, b.z - a.z);
    for (let d = 0; d <= len; d += 1) { const t = len ? d / len : 0; const c = worldToCell({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }); expect(walk(c.cx, c.cy), `leg ${i} at ${c.cx},${c.cy}`).toBe(true); }
  }
}
const crossesDoor = (from: Vec2, path: Vec2[]): boolean => {
  const pts = [from, ...path];
  for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; for (let t = 0; t <= 1; t += 0.02) if (pointInRect({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, DOOR_BAND)) return true; }
  return false;
};

describe("vo3d ground floor — every V1 room in ONE world", () => {
  it("all 11 room footprints sit exactly at their V1 manifest rects (Design Room included)", () => {
    const rooms = v1Rooms();
    const v1 = (manifest as { id: string; kind: string; x: number; y: number; width: number; height: number }[]).filter((l) => l.kind === "room");
    expect(rooms.map((r) => r.id)).toEqual(v1.map((l) => l.id));
    expect(rooms).toHaveLength(11);
    for (const r of rooms) { const l = v1.find((x) => x.id === r.id)!; expect(r.rect).toEqual({ x: l.x, z: l.y, w: l.width, d: l.height }); expect(pointInRect({ x: r.rect.x, z: r.rect.z }, FRAME)).toBe(true); expect(r.rect.x + r.rect.w).toBeLessThanOrEqual(FRAME.w + 1e-6); }
    expect(rooms.find((r) => r.id === "design-room")!.rect).toEqual(DESIGN_ROOM.rect);
    const plan = groundFloor();
    // manifest order, not phase order: project-room and meeting-room precede reception-room in the manifest
    expect(plan.rooms.filter((r) => r.reconstructed).map((r) => r.id)).toEqual(["design-room", "project-room", "meeting-room", "reception-room"]);
    expect(plan.rooms.find((r) => r.id === "central-hub")!.walls).toBe(false);
    // room art boxes never overlap by more than one cell (gaming/project overlap by 12 units in V1) → interiorRects are disjoint
    for (const a of rooms) for (const b of rooms) if (a !== b) { const ox = Math.min(a.rect.x + a.rect.w, b.rect.x + b.rect.w) - Math.max(a.rect.x, b.rect.x), oz = Math.min(a.rect.z + a.rect.d, b.rect.z + b.rect.d) - Math.max(a.rect.z, b.rect.z); expect(Math.min(ox, oz) <= CELL, `${a.id} vs ${b.id}`).toBe(true); }
  });

  it("world regions: 4 reconstructed floors, sidewalk, 7 unwalkable footprints, shared floor with room holes; bounds = frame", () => {
    const { world, plan } = rig();
    expect(world.bounds).toEqual(FRAME);
    const regions = groundFloorRegions(plan, world);
    expect(regions.map((r) => r.kind)).toEqual([...Array(4).fill("room-floor"), "exterior", ...Array(7).fill("room-floor"), "shared-floor"]);
    expect(regions.filter((r) => r.walkable)).toHaveLength(6);
    expect(regions.filter((r) => r.walkable).map((r) => r.id)).toEqual(["floor:design-room", "floor:project-room", "floor:meeting-room", "floor:reception-room", "exterior:sidewalk", "shared:ground-floor"]);
    expect(regions[regions.length - 1].holes).toHaveLength(11);
    expect(world.regionAt(APPROACH)?.id).toBe("floor:design-room");
    expect(world.regionAt({ x: 328, z: 408 })?.id).toBe("shared:ground-floor"); // just outside the Design Room door
    expect(world.regionAt(HALL_EXEC_DOOR)?.id).toBe("shared:ground-floor");
    expect(world.regionAt({ x: 720, z: 600 })).toMatchObject({ id: "footprint:central-hub", walkable: false });
    expect(world.regionAt({ x: 150, z: 150 })).toMatchObject({ id: "footprint:ai-room", walkable: false });
    expect(world.regionAt({ x: 700, z: 1216 })).toMatchObject({ id: "exterior:sidewalk", walkable: true });
    // Reception: its floor owns the gate band, the interior and the entry threshold, and hands off to the
    // sidewalk with NO gap (row 72 centre z=1160 → Reception, row 73 centre z=1176 → sidewalk)
    expect(world.regionAt({ x: 720, z: 1000 })?.id).toBe("floor:reception-room"); // interior
    expect(world.regionAt({ x: 656, z: 840 })?.id).toBe("floor:reception-room"); // gate lane 1, north band
    expect(world.regionAt({ x: 720, z: 1160 })?.id).toBe("floor:reception-room");
    expect(world.regionAt({ x: 720, z: 1176 })?.id).toBe("exterior:sidewalk");
    // Phase 4B: the east/west transitions are OPEN — both neighbours are reconstructed and their floors
    // abut Reception's exactly (no overlap: Meeting stops at 332.33, Project starts at 1081.285)
    expect(world.regionAt({ x: 280, z: 968 })).toMatchObject({ id: "floor:meeting-room", walkable: true });
    expect(world.regionAt({ x: 1120, z: 1000 })).toMatchObject({ id: "floor:project-room", walkable: true });
    expect(world.regionAt({ x: 1080, z: 1000 })?.id).toBe("floor:reception-room"); // the contested cell centre
    expect(world.regionAt({ x: -5, z: 400 })).toBeNull();
    expect(world.regionAt({ x: 700, z: FRAME.d + 1 })).toBeNull();
    expect(world.regionAt({ x: RECT.x + 100, z: RECT.z + 250 })).toBeNull(); // the Design Room's front band: in no region
    expect(world.regionAt({ x: 728, z: 312 })?.id).toBe("shared:ground-floor"); // exec outside stand: the art box overshoots this cell
  });

  it("door openings come from the hand-painted '+' cells and attach to the right wall of the right room", () => {
    const o = v1DoorOpenings();
    const by = (id: string) => o.filter((x) => x.roomId === id).map((x) => ({ side: x.side, from: x.from, to: x.to }));
    expect(by("design-room")).toEqual([{ side: "east", from: 384, to: 496 }]);
    expect(by("ai-room")).toEqual([{ side: "south", from: 304, to: 336 }]);
    expect(by("executive-room")).toEqual([{ side: "south", from: 688, to: 768 }]);
    expect(by("dev-room")).toEqual([{ side: "south", from: 1248, to: 1296 }]);
    expect(by("cms-room")).toEqual([{ side: "west", from: 432, to: 496 }]);
    expect(by("gaming-room")).toEqual([{ side: "west", from: 720, to: 752 }]);
    expect(by("qa-room")).toEqual([{ side: "east", from: 656, to: 720 }]);
    expect(by("reception-room").map((x) => x.side).sort()).toEqual(["north", "north", "north", "south"]);
    expect(by("meeting-room")).toEqual([]); expect(by("project-room")).toEqual([]); expect(by("central-hub")).toEqual([]);
    expect(o).toHaveLength(11);
  });

  it("the Design Room doorway connects its floor to the shared hall; unreconstructed doors stay closed", () => {
    const { wk } = rig();
    // V1 paints the door band as rows 24–30; the physically clear passage (north jamb … parked leaf, minus Bon's radius) is rows 25–28
    for (let cy = 25; cy <= 28; cy++) { expect(wk.staticLayer(19, cy), `door cell 19,${cy}`).toBe(true); expect(wk.staticLayer(20, cy), `outside cell 20,${cy}`).toBe(true); }
    for (const cy of [24, 29, 30]) { expect(v1Static(19, cy), `V1 door cell 19,${cy}`).toBe(true); expect(wk.staticLayer(19, cy), `brushes jamb/leaf 19,${cy}`).toBe(false); }
    expect(wk.staticLayer(18, 27)).toBe(true); // inside stand
    expect(wk.staticLayer(19, 23)).toBe(false); // wall north of the door
    expect(wk.staticLayer(19, 17)).toBe(false); // AI door cell: V1-walkable but the AI room is not reconstructed
    expect(v1Static(19, 17)).toBe(true);
    expect(wk.staticLayer(20, 19)).toBe(true); // outside stand of the AI door: hall
    expect(wk.staticLayer(45, 18)).toBe(false); expect(wk.staticLayer(45, 19)).toBe(true); // executive door / its outside stand
  });

  it("outbound: chair approach → hall (exec door) through the REAL doorway; inbound: back to the approach", () => {
    const { wk, inBounds } = rig();
    const out = planWalk(APPROACH, HALL_EXEC_DOOR, wk, inBounds);
    expect(out.ok).toBe(true);
    if (out.ok) { expect(out.path.length).toBeGreaterThanOrEqual(3); legsWalkable(APPROACH, out.path, wk.walkable); expect(crossesDoor(APPROACH, out.path)).toBe(true); expect(out.destination).toEqual({ x: (45 + 0.5) * CELL, z: (19 + 0.5) * CELL }); }
    const back = planWalk(HALL_EXEC_DOOR, APPROACH, wk, inBounds);
    expect(back.ok).toBe(true);
    if (back.ok) { legsWalkable(HALL_EXEC_DOOR, back.path, wk.walkable); expect(crossesDoor(HALL_EXEC_DOOR, back.path)).toBe(true); expect(worldToCell(back.destination)).toEqual({ cx: 11, cy: 31 }); }
    // far hall destinations: in front of the reception entrance, the QA door, the gaming door
    for (const to of [{ x: 712, z: 824 }, { x: 344, z: 664 }, { x: 1096, z: 728 }]) { const r = planWalk(APPROACH, to, wk, inBounds); expect(r.ok, `${to.x},${to.z}`).toBe(true); if (r.ok) legsWalkable(APPROACH, r.path, wk.walkable); }
  });

  it("rejects non-world and unreconstructed destinations; never routes through an unbuilt interior", () => {
    const { wk, inBounds } = rig();
    expect(planWalk(APPROACH, { x: -20, z: 400 }, wk, inBounds)).toMatchObject({ ok: false, reason: "outside-world" });
    expect(planWalk(APPROACH, { x: 1500, z: 400 }, wk, inBounds)).toMatchObject({ ok: false, reason: "outside-world" });
    expect(planWalk(APPROACH, { x: 150, z: 150 }, wk, inBounds)).toMatchObject({ ok: false, reason: "outside-world" }); // AI room interior
    expect(planWalk(APPROACH, { x: 720, z: 600 }, wk, inBounds)).toMatchObject({ ok: false, reason: "outside-world" }); // central hub
    expect(planWalk({ x: 328, z: 312 }, { x: 312, z: 280 }, wk, inBounds)).toMatchObject({ ok: false, reason: "outside-world" }); // step through the AI door
    // the sidewalk is now REACHABLE — Reception is reconstructed, so the hall → gates → entry door route exists
    const street = planWalk(APPROACH, { x: 700, z: 1216 }, wk, inBounds);
    expect(street.ok).toBe(true);
    if (street.ok) { legsWalkable(APPROACH, street.path, wk.walkable); expect(street.path.some((p) => p.z > 1120 && p.z < 1200 && p.x >= 640 && p.x <= 800), "leaves through the V1 entry door span").toBe(true); }
    expect(planWalk(APPROACH, { x: 408, z: 40 }, wk, inBounds)).toMatchObject({ ok: false, reason: "unwalkable" }); // hall cell (vending alcove top) blocked by the V1 grid
    expect(planWalk(APPROACH, { x: 328, z: 300 }, wk, inBounds).ok).toBe(true); // the AI door threshold cell straddles the art box: hall, V1 '+' walkable
  });

  it("redirect across regions and DynamicNav still compose (plant on column 17 forces the detour)", () => {
    const { world, wk, inBounds } = rig();
    const mid = { x: 328, z: 440 }; // in the hall just outside the door
    const r1 = planWalk(mid, HALL_EXEC_DOOR, wk, inBounds); expect(r1.ok).toBe(true);
    const r2 = planWalk(mid, APPROACH, wk, inBounds); expect(r2.ok).toBe(true);
    if (r2.ok) legsWalkable(mid, r2.path, wk.walkable);
    world.commit((tx) => tx.setTransform(HERO_PLANT_ID, { pos: { x: RECT.x + 270.5, z: RECT.z + 125 }, yaw: 0 }));
    wk.syncFromWorld(world);
    const detour = planWalk({ x: RECT.x + 270.5, z: RECT.z + 141 }, { x: RECT.x + 270.5, z: RECT.z + 109 }, wk, inBounds);
    expect(detour.ok).toBe(true);
    if (detour.ok) { expect(detour.path.length).toBeGreaterThanOrEqual(2); legsWalkable({ x: RECT.x + 270.5, z: RECT.z + 141 }, detour.path, wk.walkable); }
  });

  it("footprint walls stay inside their room rect and leave the V1 door span open below door height", () => {
    const plan = groundFloor();
    for (const room of plan.rooms.filter((r) => !r.reconstructed && r.walls)) {
      const walls = footprintWallRects(room, plan);
      expect(walls.length).toBeGreaterThanOrEqual(4);
      for (const w of walls) { expect(w.x).toBeGreaterThanOrEqual(room.rect.x - 1e-6); expect(w.z).toBeGreaterThanOrEqual(room.rect.z - 1e-6); expect(w.x + w.w).toBeLessThanOrEqual(room.rect.x + room.rect.w + 1e-6); expect(w.z + w.d).toBeLessThanOrEqual(room.rect.z + room.rect.d + 1e-6); }
    }
    const ai = plan.rooms.find((r) => r.id === "ai-room")!;
    const aiWalls = footprintWallRects(ai, plan);
    const doorPoint = { x: 320, z: ai.rect.z + ai.rect.d - plan.shell.wallThickness / 2 };
    expect(aiWalls.some((w) => pointInRect(doorPoint, w))).toBe(false); // the low south wall is cut at the door
    expect(aiWalls.some((w) => pointInRect({ x: 200, z: doorPoint.z }, w))).toBe(true);
    expect(footprintWallRects(plan.rooms.find((r) => r.id === "central-hub")!, plan)).toEqual([]);
  });
});
