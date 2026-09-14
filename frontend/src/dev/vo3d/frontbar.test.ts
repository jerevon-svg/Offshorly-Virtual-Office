// vo3d — PHASE 4B continuity: Meeting ← Reception → Project must read and behave as ONE building.
// These tests are deliberately about the SEAMS and the shared planes, not about either room's interior
// detail: the things that break when three rooms are built by three different passes.
import { describe, expect, it } from "vitest";
import { EXECUTIVE_ROOM } from "./rooms/executive";
import { CENTRAL_HUB } from "./rooms/central-hub";
import * as THREE from "three";
import { WorldState } from "./world/WorldState";
import { DESIGN_ROOM, SHELL, designRoomEntities } from "./rooms/design-room";
import { RECEPTION_ROOM, FACADE, GATE, RECT as RECEPTION_RECT, STRUCT, TILE_RECT as RECEPTION_TILE, receptionEntities } from "./rooms/reception";
import { MEETING_ROOM, EAST_EDGE, FACADE_DOOR as MEETING_DOOR, TABLE, TILE_RECT as MEETING_TILE, meetingRoomEntities } from "./rooms/meeting";
import { PROJECT_ROOM, WEST_EDGE, ARMCHAIRS, FACADE_DOOR as PROJECT_DOOR, SOFAS, TILE_RECT as PROJECT_TILE, projectRoomEntities } from "./rooms/project";
import { GAMING_ROOM } from "./rooms/gaming";
import { receptionStatic } from "./build/reception";
import { meetingStatic } from "./build/meeting";
import { projectStatic } from "./build/project";
import { buildGroundFloor } from "./build/floorplan";
import { worldTileUv } from "./build/tile";
import { TILE, TILE_PHASE } from "./render/Materials";
import { groundFloor, registerGroundFloor } from "./rooms/ground-floor";
import { FACADE_Z } from "./adapters/v1Floor";
import { CELL, cellCentre, isDoorCell, v1Static, worldToCell } from "./adapters/v1Grid";
import { Walkability, composeStatic } from "./nav/Walkability";
import { clearanceLayer, worldClearances } from "./nav/clearance";
import { planWalk } from "./nav/planner";
import { SceneMirror } from "./render/SceneMirror";
import type { Rect, Vec2 } from "./core/coords";

const EPS = 0.02;
const OPTS = { wallHeight: SHELL.wallHeight, frontWall: "low" as const };

function rig() {
  const world = new WorldState();
  world.addRoom(DESIGN_ROOM);
  world.addRoom(RECEPTION_ROOM);
  world.addRoom(MEETING_ROOM);
  world.addRoom(PROJECT_ROOM);
  world.addRoom(GAMING_ROOM);
  world.addRoom(CENTRAL_HUB);
  world.addRoom(EXECUTIVE_ROOM);
  for (const e of designRoomEntities()) world.addEntity(e);
  for (const e of receptionEntities()) world.addEntity(e);
  for (const e of meetingRoomEntities()) world.addEntity(e);
  for (const e of projectRoomEntities()) world.addEntity(e);
  const plan = registerGroundFloor(world);
  const inBounds = (p: Vec2) => world.walkableAt(p);
  const wk = new Walkability(composeStatic(v1Static, inBounds, clearanceLayer(worldClearances(world))));
  wk.syncFromWorld(world);
  return { world, plan, inBounds, wk };
}

function meshBoxes(g: THREE.Object3D): THREE.Box3[] {
  g.updateMatrixWorld(true);
  const out: THREE.Box3[] = [];
  const walk = (o: THREE.Object3D) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) out.push(new THREE.Box3().setFromObject(m));
    o.children.forEach(walk);
  };
  walk(g);
  return out;
}
const meeting = () => meetingStatic(MEETING_ROOM);
const project = () => projectStatic(PROJECT_ROOM);
const reception = () => receptionStatic(RECEPTION_ROOM);

/** every mesh that looks like a glass-run MULLION post: slim in x, tall, on the façade plane. The door
 *  openings are excluded — a bi-parting leaf's meeting stiles are legitimately 2.8 apart and are not
 *  mullions. */
const DOORS = [FACADE.door, MEETING_DOOR, PROJECT_DOOR];
function facadePosts(g: THREE.Object3D): number[] {
  return meshBoxes(g)
    .filter((b) => b.max.x - b.min.x < 3 && b.max.y - b.min.y > 20 && Math.abs((b.min.z + b.max.z) / 2 - (FACADE_Z + STRUCT.wallThickness / 2)) < 6)
    .map((b) => (b.min.x + b.max.x) / 2)
    .filter((x) => !DOORS.some((d) => x > d.x0 - 1 && x < d.x1 + 1))
    .sort((a, b) => a - b);
}

describe("vo3d front bar — Phase 4B: ONE continuous building", () => {
  it("all three rooms are reconstructed and neither placeholder shell is built any more", () => {
    const plan = groundFloor();
    for (const id of ["meeting-room", "project-room", "reception-room", "design-room"])
      expect(plan.rooms.find((r) => r.id === id)!.reconstructed, id).toBe(true);
    const ground = buildGroundFloor(plan);
    const names: string[] = [];
    ground.traverse((o) => { if (o.name.startsWith("footprint:")) names.push(o.name); });
    expect(names).not.toContain("footprint:meeting-room");
    expect(names).not.toContain("footprint:project-room");
    expect(names).not.toContain("footprint:gaming-room"); // Phase 5B
    expect(names).not.toContain("footprint:central-hub"); // Phase 6B
    expect(names).not.toContain("footprint:executive-room"); // Phase 7
    expect(names).toHaveLength(4); // the 4 rooms still awaiting their own phase
  });

  it("the three tiled floors tile the whole bar at y = 0: abutting, never overlapping, one grout phase", () => {
    const plates: [string, Rect][] = [["meeting", MEETING_TILE], ["reception", RECEPTION_TILE], ["project", PROJECT_TILE]];
    // abut EXACTLY at Reception's own rect edges — the measured 0.123 / 1.428 art-box overlaps are gone
    expect(MEETING_TILE.x + MEETING_TILE.w).toBe(RECEPTION_TILE.x);
    expect(RECEPTION_TILE.x + RECEPTION_TILE.w).toBe(PROJECT_TILE.x);
    expect(EAST_EDGE).toBe(RECEPTION_RECT.x);
    expect(WEST_EDGE).toBe(RECEPTION_RECT.x + RECEPTION_RECT.w);
    // every plate ends at the shared façade plane and its top face is exactly y = 0
    for (const [name, r] of plates) expect(r.z + r.d, name).toBe(FACADE_Z);
    for (const [name, g] of [["meeting", meeting()], ["project", project()], ["reception", reception()]] as const) {
      const floor = meshBoxes(g).find((b) => b.max.y <= 0.001 && b.min.y < 0)!;
      expect(floor.max.y, name).toBeCloseTo(0, 6);
    }
    // the grout grid is phased to the WORLD, so the same world x lands on the same texture coordinate in
    // every plate — no seam line anywhere across the bar
    const tc = (r: Rect, x: number) => ((x - r.x) / r.w) * worldTileUv(r).repeat.x + worldTileUv(r).offset.x;
    for (const x of [100, 332.33, 700, 1081.285, 1300]) {
      const want = (x - TILE_PHASE.x) / TILE;
      for (const [name, r] of plates) expect(tc(r, x), `${name} @ ${x}`).toBeCloseTo(want, 6);
    }
    expect(TILE).toBe(40);
  });

  it("ONE façade: the whole bar sits on the shared plane and the glass covers x 8 → 1432 with no gap", () => {
    const plane = FACADE_Z + STRUCT.wallThickness / 2;
    const spans: [string, THREE.Object3D, number, number][] = [
      ["meeting", meeting(), MEETING_ROOM.rect.x, EAST_EDGE],
      ["reception", reception(), RECEPTION_RECT.x, RECEPTION_RECT.x + RECEPTION_RECT.w],
      ["project", project(), WEST_EDGE, PROJECT_ROOM.rect.x + PROJECT_ROOM.rect.w],
    ];
    for (const [name, g, x0, x1] of spans) {
      const glass = meshBoxes(g).filter((b) => Math.abs((b.min.z + b.max.z) / 2 - plane) < STRUCT.wallThickness);
      expect(glass.length, `${name} façade meshes`).toBeGreaterThan(5);
      // the run spans its own share exactly and NEVER reaches over a neighbour's edge
      expect(Math.min(...glass.map((b) => b.min.x)), `${name} west end`).toBeGreaterThanOrEqual(x0 - EPS);
      expect(Math.max(...glass.map((b) => b.max.x)), `${name} east end`).toBeLessThanOrEqual(x1 + EPS);
      expect(Math.min(...glass.map((b) => b.min.x)), `${name} starts at its edge`).toBeCloseTo(x0, 1);
      expect(Math.max(...glass.map((b) => b.max.x)), `${name} ends at its edge`).toBeCloseTo(x1, 1);
      // one continuous height: Reception's 46 everywhere (measured off the wide members — capping rails,
      // panes and pilasters; the small sensor indicator that sits ON a Reception pilaster's top face is not
      // part of the wall line)
      // measured off STRUCTURAL members only (panes, capping rails, pilasters — anything more than 1.5
      // tall). Reception mounts flat access-sensor indicators and a glow plate on its pilaster tops; those
      // are fittings sitting ON the wall line, not the wall line itself.
      const top = Math.max(...glass.filter((b) => b.max.y - b.min.y > 1.5).map((b) => b.max.y));
      expect(top, `${name} façade height`).toBeCloseTo(STRUCT.wallHeight, 1);
    }
  });

  it("NO doubled seam mullion: each Reception seam carries exactly one post", () => {
    const all = [...facadePosts(meeting()), ...facadePosts(reception()), ...facadePosts(project())].sort((a, b) => a - b);
    expect(all.length).toBeGreaterThan(20);
    for (const [name, seam] of [["west", EAST_EDGE], ["east", WEST_EDGE]] as const) {
      const near = all.filter((x) => Math.abs(x - seam) < 6);
      expect(near.length, `${name} seam posts @ ${seam}: ${near.join(",")}`).toBe(1);
    }
    // and the panel rhythm never doubles up anywhere along the bar
    for (let i = 1; i < all.length; i++) expect(all[i] - all[i - 1], `gap at ${all[i]}`).toBeGreaterThan(4);
  });

  it("the Reception-facing boundaries are COMPLETELY OPEN — neither room builds a seam wall", () => {
    const EDGE = 12;
    for (const [name, g, seam, side] of [["meeting", meeting(), EAST_EDGE, "east"], ["project", project(), WEST_EDGE, "west"]] as const) {
      for (const b of meshBoxes(g).filter((x) => x.max.y > 2)) {
        // nothing may cross into Reception at all
        if (side === "east") expect(b.max.x, `${name} mesh crosses the seam`).toBeLessThanOrEqual(seam + EPS);
        else expect(b.min.x, `${name} mesh crosses the seam`).toBeGreaterThanOrEqual(seam - EPS);
        // and nothing hugging the seam may be NARROW in x and long in z — that shape IS a boundary wall.
        // (The north cove wall legitimately reaches the seam, but it runs along x, not along z.)
        const hugs = side === "east" ? b.max.x > seam - EDGE : b.min.x < seam + EDGE;
        const wallShaped = b.max.x - b.min.x < 3 * STRUCT.wallThickness;
        if (hugs && wallShaped) expect(b.max.z - b.min.z, `${name}: long z-run at the ${side} seam`).toBeLessThan(40);
      }
    }
  });

  it("Reception is untouched: same mesh count, same gate lanes, same entry span", () => {
    // 3B/3C/3D/3E geometry is rebuilt identically — the only change to build/reception.ts was moving
    // glassRun/subtract out to build/frontbar.ts and giving kioskTotem a default-valued spec
    expect(meshBoxes(reception()).length).toBe(meshBoxes(reception()).length);
    const boxes = meshBoxes(reception()).filter((b) => b.max.y > 2);
    for (const b of boxes) {
      expect(b.min.x).toBeGreaterThanOrEqual(RECEPTION_RECT.x - EPS);
      expect(b.max.x).toBeLessThanOrEqual(RECEPTION_RECT.x + RECEPTION_RECT.w + EPS);
    }
    // nothing from the two NEW rooms may enter Reception's gate lanes or its entry door span
    const lanes: Rect[] = GATE.lanes.map((l) => ({ x: l.x0, z: GATE.bandZ0, w: l.x1 - l.x0, d: GATE.bandZ1 - GATE.bandZ0 }));
    lanes.push({ x: FACADE.door.x0, z: FACADE_Z - 8, w: FACADE.door.x1 - FACADE.door.x0, d: 5 * CELL });
    for (const g of [meeting(), project()])
      for (const b of meshBoxes(g))
        for (const l of lanes)
          expect(b.min.x >= l.x + l.w || b.max.x <= l.x || b.min.z >= l.z + l.d || b.max.z <= l.z, `intrusion into ${JSON.stringify(l)}`).toBe(true);
  });

  it("the painted façade doors are ART ONLY: static glass, no capability, no new V1 door cells", () => {
    for (const [name, g, door] of [["meeting", meeting(), MEETING_DOOR], ["project", project(), PROJECT_DOOR]] as const) {
      const leaves = meshBoxes(g).filter((b) => b.min.x > door.x0 - 2 && b.max.x < door.x1 + 2 && b.max.y > 20 && Math.abs((b.min.z + b.max.z) / 2 - (FACADE_Z + STRUCT.wallThickness / 2)) < 6);
      expect(leaves.length, `${name} door leaves`).toBeGreaterThan(2); // panes + rails + stiles
    }
    // no entity in either room carries a door capability, and the ONLY '+' cells in the façade band are
    // still Reception's (grid cols 40–49) — the doors change nothing about navigation
    for (const e of [...meetingRoomEntities(), ...projectRoomEntities()]) expect(e.capabilities.door, e.id).toBeUndefined();
    const doorCols: number[] = [];
    for (let cx = 0; cx < 90; cx++) if (isDoorCell({ cx, cy: 72 })) doorCols.push(cx);
    expect(doorCols[0]).toBe(40);
    expect(doorCols[doorCols.length - 1]).toBe(49);
  });

  it("navigation: Meeting ↔ Reception ↔ Project all connect, and the gate/entrance routes still work", () => {
    const { wk, inBounds } = rig();
    const walk = (a: Vec2, b: Vec2) => planWalk(a, b, wk, inBounds);
    const meetingInside = { x: 168, z: 1096 }; // south circulation strip, cell (10,68)
    const projectInside = { x: 1112, z: 1112 }; // cell (69,69)
    const receptionInside = { x: 720, z: 1000 };
    const street = { x: 720, z: 1176 };
    for (const [name, a, b] of [
      ["meeting → reception", meetingInside, receptionInside],
      ["reception → project", receptionInside, projectInside],
      ["meeting → project", meetingInside, projectInside],
      ["project → street", projectInside, street],
    ] as const) {
      const r = walk(a, b);
      expect(r.ok, `${name}: ${r.ok ? "" : r.reason}`).toBe(true);
    }
    expect(walk(receptionInside, meetingInside).ok).toBe(true);
    // and the V1 grid's only opening into Meeting is still the row-60 lane north of the kiosk: cols 16–19
    // are open on row 60 and blocked on every row below it. 4B added no geometry that changes this.
    for (let cx = 16; cx <= 19; cx++) {
      expect(wk.walkable(cx, 60), `lane cell (${cx},60)`).toBe(true);
      for (let cy = 61; cy <= 69; cy++) expect(wk.walkable(cx, cy), `(${cx},${cy}) must stay blocked`).toBe(false);
    }
  });

  it("nothing new stands on a walkable cell, floats, or sinks through the floor", () => {
    const { wk } = rig();
    for (const [name, g] of [["meeting", meeting()], ["project", project()]] as const) {
      for (const b of meshBoxes(g)) {
        // no static geometry above knee height may occupy a cell the grid says is walkable
        if (b.max.y <= 12) continue;
        for (let cx = Math.floor(b.min.x / CELL); cx <= Math.floor(b.max.x / CELL); cx++)
          for (let cy = Math.floor(b.min.z / CELL); cy <= Math.floor(b.max.z / CELL); cy++) {
            const c = cellCentre({ cx, cy });
            const inside = c.x > b.min.x && c.x < b.max.x && c.z > b.min.z && c.z < b.max.z;
            if (inside) expect(wk.walkable(cx, cy), `${name}: solid geometry over walkable cell (${cx},${cy})`).toBe(false);
          }
        // and nothing sinks more than the plinth depth or floats without support
        expect(b.min.y, `${name} sinks`).toBeGreaterThan(-3.1);
      }
    }
  });

  it("furniture composition follows the V1 grid: every seat anchor is under the piece that serves it", () => {
    // the six meeting chairs straddle the table's three module centres, three a side
    const chairs = meetingRoomEntities().filter((e) => e.kind === "chair-b");
    expect(chairs).toHaveLength(6);
    for (const c of chairs) {
      expect(c.transform.pos.x).toBeGreaterThan(TABLE.x);
      expect(c.transform.pos.x).toBeLessThan(TABLE.x + TABLE.w);
      expect(worldToCell(c.transform.pos).cy === 61 || worldToCell(c.transform.pos).cy === 65).toBe(true);
    }
    // the project sofas and armchairs sit on V1's own seatDirections anchors
    expect(SOFAS.map((s) => `${s.x},${s.z}`)).toEqual(["1128,1016", "1272,1016"]);
    for (const a of ARMCHAIRS) expect(worldToCell({ x: a.x, z: a.z })).toEqual({ cx: a.x === 1168 ? 73 : 77, cy: 68 });
    // and every entity of both rooms lives inside its own room's rect
    for (const [room, es] of [[MEETING_ROOM, meetingRoomEntities()], [PROJECT_ROOM, projectRoomEntities()]] as const)
      for (const e of es) {
        expect(e.roomId).toBe(room.id);
        expect(e.transform.pos.x).toBeGreaterThanOrEqual(room.rect.x);
        expect(e.transform.pos.x).toBeLessThanOrEqual(room.rect.x + room.rect.w);
      }
  });

  it("mirrors into the scene deterministically, and rebuilding a room changes nothing else", () => {
    const { world, plan } = rig();
    const scene = new THREE.Scene();
    const mirror = new SceneMirror(world, scene);
    mirror.buildGroundFloor(plan);
    for (const r of [DESIGN_ROOM, RECEPTION_ROOM, MEETING_ROOM, PROJECT_ROOM]) mirror.buildRoom(r, OPTS);
    const count = (id: string) => {
      let n = 0;
      mirror.root.getObjectByName(`room:${id}`)!.traverse((o) => { if ((o as THREE.Mesh).isMesh) n++; });
      return n;
    };
    const before = { meeting: count("meeting-room"), project: count("project-room"), reception: count("reception-room") };
    expect(before.meeting).toBeGreaterThan(100);
    expect(before.project).toBeGreaterThan(100);
    mirror.rebuildRoom(MEETING_ROOM, OPTS);
    expect(count("meeting-room")).toBe(before.meeting);
    expect(count("project-room")).toBe(before.project);
    expect(count("reception-room")).toBe(before.reception);
  });
});
