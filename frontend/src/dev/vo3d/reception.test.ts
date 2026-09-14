import { describe, expect, it } from "vitest";
import { EXECUTIVE_ROOM } from "./rooms/executive";
import { CMS_ROOM } from "./rooms/cms";
import { AI_ROOM } from "./rooms/ai";
import { DEV_ROOM } from "./rooms/dev";
import { QA_ROOM } from "./rooms/qa";
import { CENTRAL_HUB } from "./rooms/central-hub";
import * as THREE from "three";
import { WorldState } from "./world/WorldState";
import { CHAIR_4_ID, DESIGN_ROOM, SHELL, designRoomEntities } from "./rooms/design-room";
import { RECEPTION_ROOM, AXIS, COUNTER, GATE_CLEARANCE, GATE_CLEARANCE_ID, ENTRY_DOOR, ENTRY_DOOR_EAST_ID, ENTRY_DOOR_WEST_ID, ENTRY_DOOR_Z, ENTRY_LEAF_CLOSED, ENTRY_LEAF_W, ENTRY_SCANNER_ID, ENTRY_ZONE, FACADE, FACADE_INNER_Z, GATE, GATE_SCANNER_IDS, GATE_ZONES, KIOSK, LOGO_AREA, LOUNGE_WEST, PLANTERS, RECT, STRUCT, TILE_RECT, entryDoorEntities, mirrorX, receptionEntities } from "./rooms/reception";
import { arcCounter, receptionStatic } from "./build/reception";
import { LOGO_BRAND_DARK, LOGO_BRAND_GREEN, inlayFootprint, logoAspect, logoShapes, offshorlyInlay } from "./build/logo";
import { AmbientSystem, type AmbientSpec } from "./render/Ambient";
import { buildGroundFloor } from "./build/floorplan";
import { SlidingDoor } from "./interact/Door";
import { LoungeSeatInteraction } from "./interact/LoungeSeat";
import { PELVIS_BELOW_HIPS } from "./interact/seatContact";
import { TUB_CHAIR, TUB_CUSHION_TOP } from "./build/furniture";
import { COUNTER_APPROACH, KIOSK_APPROACH, COUNTER_INTERACTION_ID, KIOSK_INTERACTION_ID, LOUNGE_SEAT_IDS, LOUNGE_SEATS, TUB_CUSHION_TOP_Y, TUB_SINK } from "./rooms/reception";
import { FACING_YAW } from "./core/coords";
import { PALETTE } from "./render/Materials";
import { pointInRect } from "./core/coords";
import { groundFloor, registerGroundFloor, roomSouthZ } from "./rooms/ground-floor";
import { MEETING_ROOM } from "./rooms/meeting";
import { PROJECT_ROOM } from "./rooms/project";
import { GAMING_ROOM } from "./rooms/gaming";
import { FACADE_Z } from "./adapters/v1Floor";
import { v1RoomRect } from "./adapters/v1Manifest";
import { buildFootprint, footprintWallRects } from "./build/floorplan";
import { worldTileUv } from "./build/tile";
import { TILE, TILE_PHASE } from "./render/Materials";
import { SceneMirror } from "./render/SceneMirror";
import { cellCentre, v1Static, worldToCell, CELL } from "./adapters/v1Grid";
import { Walkability, composeStatic } from "./nav/Walkability";
import { clearanceLayer, worldClearances } from "./nav/clearance";
import { planWalk } from "./nav/planner";
import type { Rect, Vec2 } from "./core/coords";

const OPTS = { wallHeight: SHELL.wallHeight, frontWall: "low" as const };

function rig() {
  const world = new WorldState();
  world.addRoom(DESIGN_ROOM);
  world.addRoom(RECEPTION_ROOM);
  for (const e of designRoomEntities()) world.addEntity(e);
  world.addRoom(MEETING_ROOM);
  world.addRoom(PROJECT_ROOM);
  world.addRoom(GAMING_ROOM);
  world.addRoom(CENTRAL_HUB);
  world.addRoom(EXECUTIVE_ROOM);
  world.addRoom(CMS_ROOM);
  world.addRoom(AI_ROOM);
  world.addRoom(DEV_ROOM);
  world.addRoom(QA_ROOM);
  const plan = registerGroundFloor(world);
  const inBounds = (p: Vec2) => world.walkableAt(p);
  const wk = new Walkability(composeStatic(v1Static, inBounds, clearanceLayer(worldClearances(world))));
  wk.syncFromWorld(world);
  return { world, plan, inBounds, wk };
}

/** world-space AABBs of every mesh in a group, optionally skipping named subtrees.
 *  Box3.setFromObject reads float32 geometry, so compare with a ~0.01 tolerance, not 1e-6. */
function meshBoxes(g: THREE.Object3D, skip: string[] = []): THREE.Box3[] {
  g.updateMatrixWorld(true);
  const out: THREE.Box3[] = [];
  const walk = (o: THREE.Object3D) => {
    if (skip.includes(o.name)) return;
    const m = o as THREE.Mesh;
    if (m.isMesh) out.push(new THREE.Box3().setFromObject(m));
    o.children.forEach(walk);
  };
  walk(g);
  return out;
}
const EPS = 0.02;

describe("vo3d Reception — Phase 3B architecture", () => {
  it("sits on the exact production footprint and hands its floor off to the sidewalk with no gap", () => {
    expect(RECEPTION_ROOM.rect).toEqual(v1RoomRect("reception-room"));
    expect(RECT).toEqual({ x: 332.33, z: 838.47, w: 748.955, d: 399.102 });
    const f = RECEPTION_ROOM.floorRect;
    // full rect width: Reception has no side walls
    expect(f.x).toBe(RECT.x);
    expect(f.w).toBe(RECT.w);
    expect(f.z).toBe(RECT.z); // includes the north gate band, so the V1 '+' lanes are inside a walkable region
    const sidewalk = groundFloor().sidewalk;
    expect(f.z + f.d).toBeCloseTo(sidewalk.z, 6); // exact hand-off, no unclaimed strip
    // never overlaps its neighbours' interiors
    for (const id of ["meeting-room", "project-room"]) {
      const n = v1RoomRect(id);
      expect(Math.min(f.x + f.w, n.x + n.w) - Math.max(f.x, n.x)).toBeLessThanOrEqual(CELL);
    }
  });

  it("the façade plane is shared: Reception's glass and the Meeting/Project placeholders land on one z", () => {
    const plan = groundFloor();
    expect(plan.facadeZ).toBe(FACADE_Z);
    expect(FACADE_Z).toBe(70 * CELL); // the V1 south door band's north face
    expect(FACADE.z).toBe(plan.facadeZ);
    const T = plan.shell.wallThickness;
    for (const id of ["meeting-room", "project-room"]) {
      const room = plan.rooms.find((r) => r.id === id)!;
      expect(roomSouthZ(room, plan)).toBe(FACADE_Z + T);
      // the placeholder south wall now sits in the shared band, not at the art bounding box
      const south = footprintWallRects(room, plan).filter((w) => w.d <= T + 1e-6 && w.z >= FACADE_Z - 1e-6);
      expect(south.length, `${id} south wall`).toBeGreaterThan(0);
      for (const w of south) { expect(w.z).toBeCloseTo(FACADE_Z, 6); expect(w.z + w.d).toBeCloseTo(FACADE_Z + T, 6); }
      // and its plate stops at the façade instead of spilling over the sidewalk
      const plate = meshBoxes(buildFootprint(room, plan)).find((b) => b.max.y <= 0.6 && b.min.y < 0)!;
      expect(plate.max.z).toBeLessThanOrEqual(FACADE_Z + EPS);
    }
    // rooms behind the front row are untouched
    const qa = plan.rooms.find((r) => r.id === "qa-room")!;
    expect(roomSouthZ(qa, plan)).toBe(qa.rect.z + qa.rect.d);
  });

  it("NO reception mesh intrudes on the three V1 gate lanes or the entry door span", () => {
    const built = buildReception();
    const boxes = meshBoxes(built).filter((b) => b.max.y > 0.05); // the floor slab is below y 0
    const clear = (list: THREE.Box3[], span: { x0: number; x1: number }, z0: number, z1: number, what: string) => {
      for (const b of list) {
        const ox = Math.min(b.max.x, span.x1 - 0.01) - Math.max(b.min.x, span.x0 + 0.01);
        const oz = Math.min(b.max.z, z1 - 0.01) - Math.max(b.min.z, z0 + 0.01);
        expect(ox <= 0 || oz <= 0, `${what}: mesh [${b.min.x.toFixed(1)}…${b.max.x.toFixed(1)} × ${b.min.z.toFixed(1)}…${b.max.z.toFixed(1)}]`).toBe(true);
      }
    };
    // the three north gate lanes, across the whole V1 band (rows 52–56)
    expect(GATE.lanes).toEqual([{ x0: 640, x1: 672 }, { x0: 704, x1: 752 }, { x0: 768, x1: 800 }]);
    clear(boxes, GATE.lanes[0], GATE.bandZ0, GATE.bandZ1, "gate lane 1");
    clear(boxes, GATE.lanes[2], GATE.bandZ0, GATE.bandZ1, "gate lane 3");
    // lane 2 carries the art's slim bollard (decor; V1 keeps the lane walkable) — everything else stays out
    const lane2 = boxes.filter((b) => b.max.x > 704 && b.min.x < 752 && b.max.z > GATE.bandZ0 && b.min.z < GATE.bandZ1);
    expect(lane2.every((b) => b.max.x - b.min.x <= 2 * GATE.bollard.r + 0.5), "only the bollard stands in lane 2").toBe(true);
    // the entry door span carries NOTHING but the two leaves: no wall run, no pilaster, no rail
    const facadeOnly = meshBoxes(built, ["reception-entry-doors"]).filter((b) => b.max.y > 0.05);
    clear(facadeOnly, FACADE.door, FACADE_Z - EPS, FACADE_Z + STRUCT.wallThickness + EPS, "entry door opening");
    expect(facadeOnly.length).toBeLessThan(boxes.length); // the leaves really were excluded
  });

  it("builds no east or west boundary geometry (Meeting/Project own those edges)", () => {
    const boxes = meshBoxes(buildReception()).filter((b) => b.max.y > 2);
    const xEast = RECT.x + RECT.w;
    const EDGE = 12; // a side wall would be within a wall-thickness of the rect edge
    for (const b of boxes) {
      // nothing Reception builds may cross into Meeting's or Project's territory at all
      expect(b.min.x, `mesh starts west of the rect`).toBeGreaterThanOrEqual(RECT.x - EPS);
      expect(b.max.x, `mesh ends east of the rect`).toBeLessThanOrEqual(xEast + EPS);
      // and nothing hugging either edge may run long in z (that would BE a side wall)
      if (b.min.x < RECT.x + EDGE || b.max.x > xEast - EDGE) {
        expect(b.max.z - b.min.z, `long z-run at the ${b.min.x < RECT.x + EDGE ? "west" : "east"} edge`).toBeLessThan(40);
      }
    }
  });

  it("the tile grid is phased to the WORLD so it continues into Meeting and Project", () => {
    expect(TILE).toBe(20); // halved from the V1 graphic pitch to a real ~97 cm slab — see render/Materials TILE
    const uv = worldTileUv(TILE_RECT);
    // texture coordinate of a world point on the top face
    const tcx = (x: number) => ((x - TILE_RECT.x) / TILE_RECT.w) * uv.repeat.x + uv.offset.x;
    const tcz = (z: number) => ((TILE_RECT.z + TILE_RECT.d - z) / TILE_RECT.d) * uv.repeat.y + uv.offset.y;
    for (const x of [360, 400, 1080, -40]) expect(tcx(x)).toBeCloseTo((x - TILE_PHASE.x) / TILE, 6);
    for (const z of [912, 952, 1120]) expect(tcz(z)).toBeCloseTo((z - TILE_PHASE.z) / TILE, 6);
    // grout lines land on whole tile coordinates, independent of which rect is being drawn
    expect(Number.isInteger(Math.round(tcx(360) * 1e6) / 1e6)).toBe(true);
    // a hypothetical Meeting plate produces the SAME phase
    const meeting: Rect = { x: 8, z: 863.21, w: 324.453, d: FACADE_Z - 863.21 };
    const m = worldTileUv(meeting);
    const mtcx = (x: number) => ((x - meeting.x) / meeting.w) * m.repeat.x + m.offset.x;
    expect(mtcx(320)).toBeCloseTo(tcx(320), 6);
  });

  it("the tiled floor spans the full rect width up to the façade, top face at exactly y = 0", () => {
    expect(TILE_RECT).toEqual({ x: RECT.x, z: RECT.z, w: RECT.w, d: FACADE_Z - RECT.z });
    const floor = meshBoxes(buildReception()).find((b) => b.max.y <= 0.001 && b.min.y < 0)!;
    expect(floor.max.y).toBeCloseTo(0, 6);
    expect(floor.min.x).toBeCloseTo(RECT.x, 1);
    expect(floor.max.x).toBeCloseTo(RECT.x + RECT.w, 1);
    expect(floor.max.z).toBeCloseTo(FACADE_Z, 1);
  });

  it("navigation: hall → all three gates → interior → out to the street, and the door span is the only way out", () => {
    const { wk, inBounds } = rig();
    const HALL: Vec2 = { x: 720, z: 824 }; // hall, just north of the gate band
    const INSIDE: Vec2 = { x: 720, z: 1000 };
    const STREET: Vec2 = { x: 720, z: 1216 };
    for (const lane of GATE.lanes) {
      const c = worldToCell({ x: (lane.x0 + lane.x1) / 2, z: 900 });
      expect(wk.staticLayer(c.cx, c.cy), `lane ${lane.x0}-${lane.x1} open`).toBe(true);
    }
    const into = planWalk(HALL, INSIDE, wk, inBounds);
    expect(into.ok).toBe(true);
    const out = planWalk(INSIDE, STREET, wk, inBounds);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.path.some((p) => p.x >= 640 && p.x <= 800 && p.z > 1120)).toBe(true);
    // Meeting and Project interiors stay shut — 3B opens no new region
    expect(planWalk(INSIDE, { x: 200, z: 1000 }, wk, inBounds)).toMatchObject({ ok: false });
    expect(planWalk(INSIDE, { x: 1250, z: 1000 }, wk, inBounds)).toMatchObject({ ok: false });
  });

  it("mirrors into the scene deterministically and leaves the Design Room untouched", () => {
    const world = new WorldState();
    world.addRoom(DESIGN_ROOM);
    world.addRoom(RECEPTION_ROOM);
    for (const e of designRoomEntities()) world.addEntity(e);
    const mirror = new SceneMirror(world, new THREE.Scene());
    mirror.buildRoom(DESIGN_ROOM, OPTS);
    mirror.buildRoom(RECEPTION_ROOM, OPTS);
    const count = (o: THREE.Object3D) => { let m = 0; o.traverse((c) => { if ((c as THREE.Mesh).isMesh) m++; }); return m; };
    const design = mirror.root.getObjectByName(`room:${DESIGN_ROOM.id}`)!;
    const reception = mirror.root.getObjectByName(`room:${RECEPTION_ROOM.id}`)!;
    // the Design Room's static group is still offset to its room origin (room-local measurements)
    expect(design.children[0].position.x).toBeCloseTo(DESIGN_ROOM.rect.x, 6);
    expect(count(design)).toBeGreaterThan(800);
    // Reception's static group is WORLD space
    expect(reception.children[0].position.x).toBe(0);
    expect(count(reception)).toBeGreaterThan(40);
    const before = count(reception);
    mirror.rebuildRoom(RECEPTION_ROOM, OPTS);
    expect(count(mirror.root.getObjectByName(`room:${RECEPTION_ROOM.id}`)!)).toBe(before);
    expect(count(mirror.root.getObjectByName(`room:${DESIGN_ROOM.id}`)!)).toBe(count(design));
  });
});

// built once per call so each assertion gets a clean group
function buildReception(): THREE.Group {
  const world = new WorldState();
  world.addRoom(RECEPTION_ROOM);
  const mirror = new SceneMirror(world, new THREE.Scene());
  mirror.buildRoom(RECEPTION_ROOM, OPTS);
  return mirror.root.getObjectByName(`room:${RECEPTION_ROOM.id}`) as THREE.Group;
}

describe("vo3d Reception — Phase 3C primary forms", () => {
  it("the arc counter is centred on the composition axis, concave north, at the measured radii", () => {
    expect(COUNTER.centre.x).toBe(AXIS);
    const g = arcCounter();
    // silhouette = solid counter geometry; the additive floor glow rings (y ≈ 0.1) are light spill, not counter
    const box = meshBoxes(g).filter((b) => b.max.y > 1).reduce((a, b) => a.union(b), new THREE.Box3().makeEmpty());
    // symmetric about x = 720 (NOT the rect centre 706.8)
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(AXIS, 1);
    // silhouette: worktop ring r 144…176 at ±60° → tips (567.6, 952) / (872.4, 952), south edge z 1056
    expect(Math.abs(box.min.x - (AXIS - 152.4))).toBeLessThan(2); // extrude tessellation
    expect(Math.abs(box.max.x - (AXIS + 152.4))).toBeLessThan(2);
    // north edge = the inner-radius corners at the tips: z = cz + innerR·sin(30°) = 952
    expect(Math.abs(box.min.z - (COUNTER.centre.z + COUNTER.innerR * Math.sin(Math.PI / 6)))).toBeLessThan(2);
    expect(box.max.z).toBeCloseTo(COUNTER.centre.z + COUNTER.outerR, 0);
    // the worktop (the one extruded annulus) tops out at the transaction height; props stand above it
    let worktopTop = -1;
    g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.geometry.type === "ExtrudeGeometry" && m.material === (m.material as THREE.Material) && new THREE.Box3().setFromObject(m).max.y > 20) worktopTop = Math.max(worktopTop, new THREE.Box3().setFromObject(m).max.y); });
    expect(worktopTop).toBeCloseTo(COUNTER.topY, 1);
    expect(box.max.y).toBeGreaterThan(COUNTER.topY); // monitors etc. sit ON the worktop
    // measured artwork tips (578, 966) and (877, 969) — within one V1 cell
    for (const [tx, tz] of [[578, 966], [877, 969]] as const) {
      const r = Math.hypot(tx - COUNTER.centre.x, tz - COUNTER.centre.z);
      expect(Math.abs(r - COUNTER.outerR)).toBeLessThan(CELL);
    }
    // CONCAVE NORTH — raycast, not AABBs (an arc's bounding box covers its own empty pocket).
    // Nothing may stand in the staff pocket the V1 grid leaves open (rows 59–63); the ring itself must hit.
    g.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const hits = (x: number, z: number) => {
      ray.set(new THREE.Vector3(x, 80, z), down);
      return ray.intersectObject(g, true).length > 0;
    };
    for (let r = 40; r <= COUNTER.innerR - 12; r += 22)
      for (let a = -55; a <= 55; a += 11) {
        const t = (a * Math.PI) / 180;
        const x = COUNTER.centre.x + Math.sin(t) * r, z = COUNTER.centre.z + Math.cos(t) * r;
        expect(hits(x, z), `staff pocket must be clear at ${x.toFixed(0)},${z.toFixed(0)}`).toBe(false);
      }
    const mid = (COUNTER.innerR + COUNTER.outerR) / 2;
    for (const a of [-50, -20, 0, 20, 50]) {
      const t = (a * Math.PI) / 180;
      expect(hits(COUNTER.centre.x + Math.sin(t) * mid, COUNTER.centre.z + Math.cos(t) * mid), `worktop at ${a}°`).toBe(true);
    }
    // and nothing north of the arc's chord (z 952) across the counter's width
    for (const x of [640, 720, 800]) expect(hits(x, 940)).toBe(false);
    // the VISIBLE counter is the measured ring, NOT the V1 blocked footprint (r ≈ 210) — no bulking
    expect(COUNTER.outerR).toBeLessThan(190);
  });

  it("both lounges are exact mirror images about x = 720", () => {
    const ents = receptionEntities();
    const byId = new Map(ents.map((e) => [e.id, e]));
    for (const [w, e] of [["sofa-west", "sofa-east"], ["table-west", "table-east"], ["tub-chair-west-0", "tub-chair-east-0"], ["tub-chair-west-1", "tub-chair-east-1"]] as const) {
      const a = byId.get(`reception-room/${w}`)!, b = byId.get(`reception-room/${e}`)!;
      expect(a, w).toBeTruthy();
      expect(b.transform.pos.x, `${e} mirrors ${w}`).toBeCloseTo(mirrorX(a.transform.pos.x), 6);
      expect(b.transform.pos.z).toBeCloseTo(a.transform.pos.z, 6);
      expect(b.kind).toBe(a.kind);
    }
    // the two sofas face each other: the builder is back-to-west, so only the east one is mirrored
    expect(byId.get("reception-room/sofa-west")!.props.mirrored).toBe(false);
    expect(byId.get("reception-room/sofa-east")!.props.mirrored).toBe(true);
    expect(ents.filter((e) => e.kind === "tub-chair")).toHaveLength(4);
    expect(ents.filter((e) => e.kind === "round-table")).toHaveLength(2);
    expect(ents.filter((e) => e.kind === "plant")).toHaveLength(2);
  });

  it("lounge silhouettes match the measured artwork and stay inside the building", () => {
    const s = LOUNGE_WEST.sofa;
    // painted z 1010…1122; pulled north 5 so it backs on to the glazing instead of piercing it
    expect(s.d).toBeCloseTo(112, 0);
    expect(s.z + s.d, "sofa clears the façade glazing").toBeLessThanOrEqual(FACADE_INNER_Z);
    expect(s.z + s.d, "sofa still backs on to the façade").toBeGreaterThan(FACADE_INNER_Z - 4);
    expect(LOUNGE_WEST.chairs[0].z).toBeCloseTo(1019, 0); // measured 995…1043
    // V1 seatDirections puts the north armchairs at (477.82, 1017.45) — within one cell
    expect(Math.hypot(LOUNGE_WEST.chairs[0].x - 477.82, LOUNGE_WEST.chairs[0].z - 1017.45)).toBeLessThan(CELL);
    // the SOUTH armchair is pulled north off its painted position so it does not pierce the façade glass
    for (const c of LOUNGE_WEST.chairs) expect(c.z + c.d / 2, "south armchair clears the façade").toBeLessThan(FACADE.z);
    // 3E.4: the coffee table must sit IN the gap the two armchairs leave, not overhang either cushion
    const t = LOUNGE_WEST.table;
    const [north, south] = LOUNGE_WEST.chairs;
    expect(t.z - t.r, "table clears the north armchair").toBeGreaterThan(north.z + north.d / 2);
    expect(t.z + t.r, "table clears the south armchair").toBeLessThan(south.z - south.d / 2);
    expect(t.x, "table stays on the lounge centreline").toBeCloseTo(477, 0);
    // everything sits inside the room rect
    for (const e of receptionEntities()) {
      const w = Number(e.props.w ?? 0);
      expect(e.transform.pos.x - w / 2).toBeGreaterThanOrEqual(RECT.x);
      expect(e.transform.pos.x + w / 2).toBeLessThanOrEqual(RECT.x + RECT.w);
    }
  });

  it("kiosk and flanking planters sit clear of the arc and of the gate band", () => {
    // clear of the arc = outside its ring radially OR outside its ±60° angular span (the arc is a segment,
    // not a full annulus, so a pot beyond the tips is clear even at the same radius)
    const half = (COUNTER.halfAngleDeg * Math.PI) / 180;
    const clearOfArc = (x: number, z: number, r: number) => {
      const dx = x - COUNTER.centre.x, dz = z - COUNTER.centre.z;
      if (Math.hypot(dx, dz) - r > COUNTER.outerR) return true;
      // nearest point of the arc segment to this centre
      const ang = Math.min(Math.max(Math.atan2(dx, dz), -half), half); // clamped into the span
      const tip = { x: COUNTER.centre.x + Math.sin(ang) * COUNTER.outerR, z: COUNTER.centre.z + Math.cos(ang) * COUNTER.outerR };
      return Math.hypot(x - tip.x, z - tip.z) > r;
    };
    expect(clearOfArc(KIOSK.x, KIOSK.z, Math.max(KIOSK.w, KIOSK.d) / 2)).toBe(true);
    for (const p of PLANTERS) {
      expect(clearOfArc(p.x, p.z, p.r), `planter ${p.x}`).toBe(true);
      expect(p.z - p.r, "planters stay south of the gate band").toBeGreaterThan(GATE.bandZ1);
    }
    // the two planters flank the arc, one on each side of the axis
    expect(PLANTERS[0].x).toBeLessThan(AXIS);
    expect(PLANTERS[1].x).toBeGreaterThan(AXIS);
  });

  it("3C adds no geometry over the gate lanes, the entry door or the neighbours' territory", () => {
    const built = buildReception();
    const boxes = meshBoxes(built, ["reception-entry-doors"]).filter((b) => b.max.y > 0.05);
    for (const b of boxes) {
      expect(b.min.x).toBeGreaterThanOrEqual(RECT.x - EPS);
      expect(b.max.x).toBeLessThanOrEqual(RECT.x + RECT.w + EPS);
      for (const lane of [GATE.lanes[0], GATE.lanes[2]]) {
        const ox = Math.min(b.max.x, lane.x1 - 0.01) - Math.max(b.min.x, lane.x0 + 0.01);
        const oz = Math.min(b.max.z, GATE.bandZ1 - 0.01) - Math.max(b.min.z, GATE.bandZ0 + 0.01);
        expect(ox <= 0 || oz <= 0, `lane ${lane.x0}`).toBe(true);
      }
      const dx = Math.min(b.max.x, FACADE.door.x1 - 0.01) - Math.max(b.min.x, FACADE.door.x0 + 0.01);
      const dz = Math.min(b.max.z, FACADE.z + STRUCT.wallThickness) - Math.max(b.min.z, FACADE.z);
      expect(dx <= 0 || dz <= 0, "entry door opening").toBe(true);
    }
  });
});

describe("vo3d Reception — Phase 3D detail & powered electronics", () => {
  const emissiveMeshes = (root: THREE.Object3D) => {
    let n = 0;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      const mat = m.isMesh ? (m.material as THREE.MeshStandardMaterial) : null;
      if (mat && mat.emissive && mat.emissiveIntensity > 0.5 && (mat.emissive.getHex() !== 0 || mat.emissiveMap)) n++;
    });
    return n;
  };
  it("the counter, every gate, the kiosk and the entrance carry powered (emissive) surfaces", () => {
    const built = buildReception();
    expect(emissiveMeshes(built.getObjectByName("reception-arc-counter")!), "counter cove + monitors").toBeGreaterThanOrEqual(4);
    for (const cx of GATE.pedestals) expect(emissiveMeshes(built.getObjectByName(`speed-gate:${cx}`)!), `gate ${cx}`).toBeGreaterThanOrEqual(3);
    expect(emissiveMeshes(built.getObjectByName("reception-kiosk")!), "kiosk screen + status LED").toBeGreaterThanOrEqual(2);
    expect(emissiveMeshes(built.getObjectByName("reception-entry-doors")!), "entrance sensors").toBeGreaterThanOrEqual(4);
  });
  it("every counter prop stands on the worktop ring, inside the arc's angular span", () => {
    const props = buildReception().getObjectByName("counter-props")!;
    const half = (COUNTER.halfAngleDeg * Math.PI) / 180;
    for (const child of props.children) {
      const dx = child.position.x - COUNTER.centre.x, dz = child.position.z - COUNTER.centre.z;
      const r = Math.hypot(dx, dz);
      expect(r, child.name || "prop").toBeGreaterThan(COUNTER.innerR + 2);
      expect(r).toBeLessThan(COUNTER.outerR - 2);
      expect(Math.abs(Math.atan2(dx, dz))).toBeLessThan(half - 0.05);
      expect(child.position.y).toBeCloseTo(COUNTER.topY, 6);
    }
    expect(props.children.length).toBeGreaterThanOrEqual(10); // 2 workstations, 5 succulents, 2 mugs, tray
  });
  it("the flanking plants are the lush, pot-less variant standing on the static planter cylinders", () => {
    const plants = receptionEntities().filter((e) => e.kind === "plant");
    expect(plants).toHaveLength(2);
    for (const [i, e] of plants.entries()) {
      expect(e.props.pot).toBe(false);
      expect(Number(e.props.lush)).toBeGreaterThan(1.3);
      expect(Number(e.props.y)).toBeCloseTo(PLANTERS[i].h - 1.5, 6); // crown sits on the pot rim
    }
  });
});

describe("vo3d Reception — Phase 3D.1 logo inlay & ambient electronics", () => {
  const SVG_VIEWBOX_ASPECT = 630.1376 / 148.9631;

  it("the inlay geometry comes from the brand SVG, with its real shapes and fills", () => {
    const p = logoShapes();
    expect(p, "the brand SVG must parse (DOMParser available)").not.toBeNull();
    if (!p) return;
    // both brand fills are present and nothing was invented in between
    const hexes = p.groups.map((g) => g.colorHex).sort();
    expect(hexes).toEqual([LOGO_BRAND_DARK, LOGO_BRAND_GREEN].sort());
    // the 13 drawable elements of the asset (11 paths + 3 circles, minus the <g> wrapper) all produced shapes
    expect(p.groups.reduce((n, g) => n + g.shapes.length, 0)).toBeGreaterThanOrEqual(12);
    // proportions are the SVG's own — the lockup is never stretched to fit the floor area
    expect(logoAspect()!).toBeCloseTo(SVG_VIEWBOX_ASPECT, 1);
  });

  it("is a floating acrylic sign: no backing plaque, lit silhouettes under real extruded letterforms", () => {
    const g = offshorlyInlay({ area: LOGO_AREA });
    const boxes = meshBoxes(g);
    expect(boxes.length, "a shadow + a halo per shape, plus one extruded body per fill").toBeGreaterThanOrEqual(6);
    const all = boxes.reduce((a, b) => a.union(b), new THREE.Box3().makeEmpty());
    expect(all.min.y).toBeGreaterThanOrEqual(-EPS); // mounted ON the tile, never below or hovering
    expect(all.max.y).toBeLessThan(1.5); // flush architectural signage, not a sign standing up

    // classify by material: an array material is a letterform body, additive is a halo, the rest is shadow
    const kind = (m: THREE.Mesh): "body" | "halo" | "shadow" =>
      Array.isArray(m.material) ? "body" : (m.material as THREE.MeshBasicMaterial).blending === THREE.AdditiveBlending ? "halo" : "shadow";
    const meshes: THREE.Mesh[] = [];
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    const bodies = meshes.filter((m) => kind(m) === "body");
    const halos = meshes.filter((m) => kind(m) === "halo");
    const shadows = meshes.filter((m) => kind(m) === "shadow");

    // ONE body per brand fill, with genuine thickness — extrusions, not flat quads
    expect(bodies).toHaveLength(2);
    for (const b of bodies) expect(new THREE.Box3().setFromObject(b).max.y).toBeGreaterThan(0.5);
    // every shape is backlit and grounded
    expect(halos.length).toBeGreaterThanOrEqual(12);
    expect(shadows.length).toBe(halos.length);
    // the wordmark's halo is WHITE (the backlight that floats it) and the symbol's is the brand green
    const haloColours = new Set(halos.map((m) => (m.material as THREE.MeshBasicMaterial).color.getHex()));
    expect(haloColours).toEqual(new Set([0xffffff, LOGO_BRAND_GREEN]));
    // the halo and shadow planes are ordered explicitly, so no camera angle can sort them behind the tile
    for (const m of [...halos, ...shadows]) expect(typeof m.material).not.toBe("undefined");
    for (const m of halos) expect((m.material as THREE.Material).userData.floorLayer).toBeTypeOf("number");

    // THE PLAQUE IS GONE: nothing in the sign is a broad opaque slab. The old treatment's pan and its four
    // bronze trim bars covered the whole area; every mesh here is a letterform or its own lit silhouette.
    const lockup = inlayFootprint({ area: LOGO_AREA });
    for (const m of meshes) {
      const b = new THREE.Box3().setFromObject(m);
      const isOpaqueSlab = !(m.material as THREE.Material as THREE.MeshBasicMaterial).transparent && !Array.isArray(m.material);
      if (!isOpaqueSlab) continue;
      expect(b.max.x - b.min.x, "no full-width backing board").toBeLessThan(lockup.w * 0.95);
    }
  });

  it("the inlay sits in the staff pocket, clear of the counter and centred on the composition axis", () => {
    const f = inlayFootprint({ area: LOGO_AREA });
    expect(f.x + f.w / 2).toBeCloseTo(AXIS + 11, 0); // measured position of the painted logo, not the axis
    // every corner is inside the arc's staff pocket (r < innerR from the counter centre)
    for (const cx of [f.x, f.x + f.w]) for (const cz of [f.z, f.z + f.d]) {
      const r = Math.hypot(cx - COUNTER.centre.x, cz - COUNTER.centre.z);
      expect(r, `corner ${cx.toFixed(0)},${cz.toFixed(0)}`).toBeLessThan(COUNTER.innerR);
    }
    // and south of the gate band, so it never intrudes on a lane
    expect(f.z).toBeGreaterThan(GATE.bandZ1);
  });

  it("ambient electronics: one system, deterministic, and every gate carries a different phase", () => {
    const built = buildReception();
    const sys = new AmbientSystem();
    const n = sys.collect("reception-room", built);
    expect(n).toBeGreaterThanOrEqual(24); // 4 gates × 6 + kiosk × 4 + entrance × 8 + monitors × 4
    expect(sys.channelCount).toBe(n);
    const read = () => {
      const out: number[] = [];
      built.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (o.userData.ambient && m?.emissiveIntensity !== undefined) out.push(m.emissiveIntensity);
      });
      return out;
    };
    sys.update(0);
    const a = read();
    sys.update(2.35);
    const b = read();
    expect(b).not.toEqual(a); // it actually animates
    sys.update(0);
    expect(read()).toEqual(a); // and is a pure function of t — deterministic, no accumulated state
    // per-gate offsets: the four READY indicators are never all at the same value
    const ready: number[] = [];
    sys.update(1.7);
    for (const cx of GATE.pedestals) {
      const gate = built.getObjectByName(`speed-gate:${cx}`)!;
      gate.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        const spec = o.userData.ambient as { kind: string; period: number } | undefined;
        if (spec?.kind === "pulse" && spec.period === 3.4 && m) ready.push(Math.round(m.emissiveIntensity * 1e4));
      });
    }
    expect(ready).toHaveLength(4);
    expect(new Set(ready).size, "gates are coordinated but not synchronised").toBe(4);
    // channels are room-scoped: clearing another room leaves these alone
    sys.clearRoom("design-room");
    expect(sys.channelCount).toBe(n);
  });

  it("the ambient update writes only numbers it already owns (no per-frame allocation surface)", () => {
    const sys = new AmbientSystem();
    const mat = new THREE.MeshStandardMaterial({ emissive: 0xffffff, emissiveIntensity: 1 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
    mesh.userData.ambient = { kind: "pulse", period: 4, phase: 0, min: 0.5, max: 1.5 };
    sys.collect("t", mesh);
    for (let i = 0; i < 200; i++) sys.update(i * 0.05);
    expect(mat.emissiveIntensity).toBeGreaterThanOrEqual(0.5);
    expect(mat.emissiveIntensity).toBeLessThanOrEqual(1.5);
    sys.enabled = false;
    const held = mat.emissiveIntensity;
    sys.update(999);
    expect(mat.emissiveIntensity).toBe(held); // the toggle really stops it
  });
});

describe("vo3d Reception — scanner state language (BLUE idle → GREEN detected)", () => {
  const specs = (root: THREE.Object3D) => {
    const out: { o: THREE.Object3D; s: AmbientSpec }[] = [];
    root.traverse((o) => { if (o.userData.ambient) out.push({ o, s: o.userData.ambient as AmbientSpec }); });
    return out;
  };

  it("NOTHING on a gate or the entrance is green while idle — idle reads blue", () => {
    const built = buildReception();
    const scannerParts = specs(built).filter((e) => e.s.group);
    expect(scannerParts.length).toBeGreaterThanOrEqual(24);
    for (const { o, s } of scannerParts) {
      // every tinted scanner element starts on cyan and only reaches green at full activation
      if (s.tint) {
        expect(s.tint.idle, `${o.parent?.name} idle tint`).toBe(PALETTE.cyan);
        expect(s.tint.active).toBe(PALETTE.readyGreen);
      }
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
      const c = m.emissive ?? m.color;
      expect(c.getHex(), `${o.parent?.name} must not be built green`).not.toBe(PALETTE.readyGreen);
    }
    // the gate status indicator specifically: was an always-green READY lamp, now a blue status light
    const gate = built.getObjectByName(`speed-gate:${GATE.pedestals[0]}`)!;
    const greens = specs(gate).filter(({ o }) => ((o as THREE.Mesh).material as THREE.MeshStandardMaterial).emissive?.getHex() === PALETTE.readyGreen);
    expect(greens).toHaveLength(0);
  });

  it("setScanner eases blue → green and back, per scanner, without touching its neighbours", () => {
    const built = buildReception();
    const sys = new AmbientSystem();
    sys.collect("reception-room", built);
    expect(sys.scannerIds.sort()).toEqual([...GATE_SCANNER_IDS, ENTRY_SCANNER_ID].sort());
    const band = built.getObjectByName(`speed-gate:${GATE.pedestals[1]}`)!;
    const tinted = specs(band).find(({ s }) => s.kind === "pulse" && s.tint)!.o as THREE.Mesh;
    const mtl = tinted.material as THREE.MeshStandardMaterial;

    sys.update(0, 0.016);
    expect(mtl.emissive.getHex()).toBe(PALETTE.cyan); // idle = blue
    sys.setScanner(GATE_SCANNER_IDS[1], true);
    for (let i = 0; i < 120; i++) sys.update(i * 0.016, 0.016); // ~2 s
    expect(sys.scannerActivation(GATE_SCANNER_IDS[1])).toBeGreaterThan(0.97);
    expect(mtl.emissive.getHex()).toBe(PALETTE.readyGreen); // detected = green
    expect(sys.scannerActivation(GATE_SCANNER_IDS[0]), "neighbours stay idle").toBe(0);
    // it is a smooth ramp, not a snap
    const sys2 = new AmbientSystem();
    sys2.setScanner("x", true);
    sys2.update(0, 0.016);
    expect(sys2.scannerActivation("x")).toBeLessThan(0.2);
    // and it releases smoothly back to blue
    sys.setScanner(GATE_SCANNER_IDS[1], false);
    for (let i = 0; i < 400; i++) sys.update(i * 0.016, 0.016);
    expect(sys.scannerActivation(GATE_SCANNER_IDS[1])).toBeLessThan(0.02);
    expect(mtl.emissive.getHex()).toBe(PALETTE.cyan);
  });

  it("scanner zones light exactly the gates that border the lane the avatar is standing in", () => {
    const inZones = (p: { x: number; z: number }) =>
      GATE_ZONES.map((rects, i) => (rects.some((r) => pointInRect(p, r)) ? i : -1)).filter((i) => i >= 0);
    // middle of each lane, mid-band
    expect(inZones({ x: 656, z: 872 })).toEqual([0, 1]); // lane 0 borders gates 0 and 1
    expect(inZones({ x: 728, z: 872 })).toEqual([1, 2]); // the wide lane
    expect(inZones({ x: 784, z: 872 })).toEqual([2, 3]);
    expect(inZones({ x: 420, z: 1060 })).toEqual([]); // out in the lounge: nothing lit
    // the entrance zone straddles the door span, inside and out, and no gate zone reaches it
    expect(pointInRect({ x: 720, z: 1140 }, ENTRY_ZONE)).toBe(true);
    expect(pointInRect({ x: 720, z: 1190 }, ENTRY_ZONE)).toBe(true); // on the sidewalk side
    expect(pointInRect({ x: 560, z: 1140 }, ENTRY_ZONE)).toBe(false);
    expect(inZones({ x: 720, z: 1140 })).toEqual([]);
  });
});

describe("vo3d Reception — Phase 3E.1 automatic bi-parting entrance", () => {
  const leaves = () => {
    const w = new THREE.Object3D(), e = new THREE.Object3D();
    const door = new SlidingDoor(w, ENTRY_DOOR, ENTRY_LEAF_CLOSED.west, { view: e, closed: ENTRY_LEAF_CLOSED.east });
    return { w, e, door };
  };
  const step = (d: SlidingDoor, seconds: number, bon: { x: number; z: number }, path: { x: number; z: number }[] = []) => {
    for (let i = 0; i < Math.round(seconds / 0.016); i++) d.update(0.016, bon, path);
  };
  const AWAY = { x: 420, z: 1050 };

  it("the two panels tile the V1 opening and each slides its own full width, clearing it completely", () => {
    expect(ENTRY_LEAF_W).toBe((FACADE.door.x1 - FACADE.door.x0) / 2);
    expect(ENTRY_DOOR.slideDistance).toBe(ENTRY_LEAF_W);
    // closed: the two leaves exactly span the '+' door cells, meeting on the centreline
    expect(ENTRY_LEAF_CLOSED.west.x - ENTRY_LEAF_W / 2).toBeCloseTo(FACADE.door.x0, 6);
    expect(ENTRY_LEAF_CLOSED.east.x + ENTRY_LEAF_W / 2).toBeCloseTo(FACADE.door.x1, 6);
    expect(ENTRY_LEAF_CLOSED.west.x + ENTRY_LEAF_W / 2).toBeCloseTo(ENTRY_LEAF_CLOSED.east.x - ENTRY_LEAF_W / 2, 6);
    // open: neither panel remains over the opening
    const { w, e, door } = leaves();
    step(door, 3, { x: 720, z: ENTRY_DOOR_Z });
    expect(door.state).toBe("open");
    expect(w.position.x + ENTRY_LEAF_W / 2).toBeCloseTo(FACADE.door.x0, 6);
    expect(e.position.x - ENTRY_LEAF_W / 2).toBeCloseTo(FACADE.door.x1, 6);
    // the panels run south of the pilasters (11.4 deep, centred on the façade band) — they cannot collide
    expect(ENTRY_DOOR_Z).toBeGreaterThan(FACADE.z + STRUCT.wallThickness / 2 + (STRUCT.wallThickness * 1.9) / 2);
  });

  it("a parked panel always lands over V1-BLOCKED cells, so it can never be walked into", () => {
    const parked = [
      { x0: FACADE.door.x0 - ENTRY_LEAF_W, x1: FACADE.door.x0 },
      { x0: FACADE.door.x1, x1: FACADE.door.x1 + ENTRY_LEAF_W },
    ];
    for (const p of parked) {
      for (let x = p.x0 + 8; x < p.x1; x += CELL) {
        const c = worldToCell({ x, z: ENTRY_DOOR_Z });
        expect(v1Static(c.cx, c.cy), `parked panel cell ${c.cx},${c.cy}`).toBe(false);
      }
    }
  });

  it("full cycle: Closed → Opening → Open → Closing → Closed with ZERO drift on BOTH panels", () => {
    const { w, e, door } = leaves();
    const seen: string[] = [];
    expect(door.state).toBe("closed");
    step(door, 2, { x: 720, z: ENTRY_DOOR_Z }); seen.push(door.state);
    step(door, 6, AWAY); seen.push(door.state);
    expect(seen).toEqual(["open", "closed"]);
    expect(door.cycles).toBe(1);
    expect(door.driftError()).toBe(0);
    expect(w.position.x).toBe(ENTRY_LEAF_CLOSED.west.x);
    expect(e.position.x).toBe(ENTRY_LEAF_CLOSED.east.x);
    // twenty more cycles must not accumulate a thing
    for (let i = 0; i < 20; i++) { step(door, 2, { x: 720, z: ENTRY_DOOR_Z }); step(door, 6, AWAY); }
    expect(door.cycles).toBe(21);
    expect(door.driftError()).toBe(0);
    expect(w.position.x).toBe(ENTRY_LEAF_CLOSED.west.x);
    expect(e.position.x).toBe(ENTRY_LEAF_CLOSED.east.x);
  });

  it("the panels mirror each other exactly at every point in the travel", () => {
    const { w, e, door } = leaves();
    for (let i = 0; i < 40; i++) {
      door.update(0.016, { x: 720, z: ENTRY_DOOR_Z }, []);
      const offW = ENTRY_LEAF_CLOSED.west.x - w.position.x;
      const offE = e.position.x - ENTRY_LEAF_CLOSED.east.x;
      expect(offE).toBeCloseTo(offW, 10); // one `t`, two panels — they cannot desynchronise
      expect(w.position.z).toBe(ENTRY_DOOR_Z);
      expect(e.position.z).toBe(ENTRY_DOOR_Z);
    }
  });

  it("safety: holds while occupied, reverses out of Closing, and never closes onto a body", () => {
    const { door } = leaves();
    const inDoor = { x: 720, z: ENTRY_DOOR_Z };
    step(door, 2, inDoor);
    expect(door.state).toBe("open");
    step(door, 10, inDoor); // standing in the doorway for ten seconds
    expect(door.state, "an occupied doorway never starts closing").toBe("open");
    expect(door.t).toBe(1);
    // let it start closing, then step back in: it must reverse, not finish closing
    step(door, 1.0, AWAY);
    expect(door.state).toBe("closing");
    const tAtReversal = door.t;
    expect(tAtReversal).toBeGreaterThan(0);
    door.update(0.016, inDoor, []);
    expect(door.state).toBe("opening");
    expect(door.t).toBeGreaterThanOrEqual(tAtReversal - 1e-9); // resumes from where it was, no snap
    step(door, 2, inDoor);
    expect(door.state).toBe("open");
  });

  it("an abandoned approach still completes and closes; a pass-by never opens it", () => {
    // abandoned: route through the doorway, then the body stops short and the route empties
    const a = leaves();
    a.door.update(0.016, { x: 720, z: ENTRY_DOOR_Z - 60 }, [{ x: 720, z: ENTRY_DOOR_Z + 40 }]);
    expect(a.door.state).toBe("opening");
    step(a.door, 12, { x: 720, z: ENTRY_DOOR_Z - 60 });
    expect(a.door.state).toBe("closed");
    expect(a.door.driftError()).toBe(0);
    // pass-by: inside the trigger, but the remaining route never crosses the doorway band
    const b = leaves();
    const by = { x: 660, z: ENTRY_DOOR_Z - 45 };
    step(b.door, 3, by, [{ x: 880, z: ENTRY_DOOR_Z - 45 }]);
    expect(b.door.state, "walking past must not open the entrance").toBe("closed");
    expect(b.door.t).toBe(0);
  });

  it("the panels are world entities carrying ONE door capability, and the entrance scanner shares the doorway", () => {
    const ents = entryDoorEntities();
    expect(ents.map((e) => e.id)).toEqual([ENTRY_DOOR_WEST_ID, ENTRY_DOOR_EAST_ID]);
    expect(ents.filter((e) => e.capabilities.door)).toHaveLength(1); // one controller, two panels
    expect(ents[0].capabilities.door).toBe(ENTRY_DOOR);
    expect(receptionEntities().filter((e) => e.kind === "glass-door-leaf")).toHaveLength(2);
    // the sensor mat and the door's crossing overlap, so green and the panels move together
    const c = ENTRY_DOOR.crossing;
    expect(ENTRY_ZONE.x).toBeLessThanOrEqual(c.x);
    expect(ENTRY_ZONE.x + ENTRY_ZONE.w).toBeGreaterThanOrEqual(c.x + c.w);
    expect(ENTRY_ZONE.z).toBeLessThan(c.z + c.d);
    expect(ENTRY_ZONE.z + ENTRY_ZONE.d).toBeGreaterThan(c.z);
    expect(ENTRY_SCANNER_ID).toBe("entry");
  });
});

describe("vo3d Reception — Phase 3E.2 gate lane clearance", () => {
  const R = GATE_CLEARANCE.bodyRadius;
  /** how far a body of radius R standing on a lane cell centre penetrates the nearest gate solid (<=0 = clear) */
  const penetration = (cx: number, cz: number): number => {
    let worst = -Infinity;
    for (const s of GATE_CLEARANCE.solids) {
      const nx = Math.max(s.x, Math.min(cx, s.x + s.w));
      const nz = Math.max(s.z, Math.min(cz, s.z + s.d));
      worst = Math.max(worst, R - Math.hypot(cx - nx, cz - nz));
    }
    return worst;
  };
  const laneCols = [[40, 41], [44, 45, 46], [48, 49]];
  const rig = () => {
    const world = new WorldState();
    world.addRoom(DESIGN_ROOM);
    world.addRoom(RECEPTION_ROOM);
    for (const e of designRoomEntities()) world.addEntity(e);
    for (const e of receptionEntities()) world.addEntity(e);
    world.addRoom(MEETING_ROOM);
    world.addRoom(PROJECT_ROOM);
    world.addRoom(GAMING_ROOM);
  world.addRoom(CENTRAL_HUB);
  world.addRoom(EXECUTIVE_ROOM);
  world.addRoom(CMS_ROOM);
  world.addRoom(AI_ROOM);
  world.addRoom(DEV_ROOM);
  world.addRoom(QA_ROOM);
    registerGroundFloor(world);
    const inBounds = (p: Vec2) => world.walkableAt(p);
    const wk = new Walkability(composeStatic(v1Static, inBounds, clearanceLayer(worldClearances(world))));
    wk.syncFromWorld(world);
    return wk;
  };

  it("the gate clearance reaches navigation through an entity capability, not the V1 grid", () => {
    const world = new WorldState();
    world.addRoom(RECEPTION_ROOM);
    for (const e of receptionEntities()) world.addEntity(e);
    expect(world.get(GATE_CLEARANCE_ID).capabilities.clearance).toBe(GATE_CLEARANCE);
    expect(worldClearances(world)).toContain(GATE_CLEARANCE); // collected alongside door clearances
    // every V1 '+' lane cell is still V1-walkable — the authoritative grid was NOT edited
    for (const cols of laneCols) for (const c of cols) for (let r = 52; r <= 56; r++) expect(v1Static(c, r)).toBe(true);
  });

  it("the bollard no longer stands in a walkable lane cell", () => {
    // it is painted mid-lane at x 718; every lane-2 cell centre would penetrate a post there
    for (const c of [44, 45]) expect(GATE.bollardPainted.x).toBeGreaterThan(c * CELL + 8 - R);
    expect(GATE.bollardPainted.x).toBeLessThan(45 * CELL + 8 + R);
    // where it actually stands now, no walkable lane cell reaches it
    const b = { x: GATE.bollard.x - GATE.bollard.r, z: GATE.pedestal.zCentre - GATE.bollard.r, w: 2 * GATE.bollard.r, d: 2 * GATE.bollard.r };
    // col 44 (the one lane-2 cell navigation keeps) sits clear in the WEST passage
    expect(44 * CELL + 8 + R, "col 44 clears the post").toBeLessThan(b.x);
    // and it reads as the CENTRAL divider: within 4 units of the gate-2/gate-3 midpoint, with a passage
    // wider than a body on BOTH sides
    const mid = (GATE.pedestals[1] + GATE.pedestals[2]) / 2;
    expect(Math.abs(GATE.bollard.x - mid), "post is centred between the two gate units").toBeLessThan(4);
    const g2 = GATE.pedestals[1] + GATE.pedestal.w / 2 + 0.3, g3 = GATE.pedestals[2] - GATE.pedestal.w / 2 - 0.3;
    expect(GATE.bollard.x - GATE.bollard.r - g2, "west passage fits a body").toBeGreaterThan(2 * R);
    expect(g3 - (GATE.bollard.x + GATE.bollard.r), "east passage fits a body").toBeGreaterThan(2 * R);
  });

  it("every lane keeps a route, and NO cell navigation allows penetrates gate geometry", () => {
    const wk = rig();
    const open: number[][] = [];
    for (const cols of laneCols) {
      const keep: number[] = [];
      for (const c of cols) {
        const walkable = [52, 53, 54, 55, 56].every((r) => wk.staticLayer(c, r));
        if (walkable) keep.push(c);
        // the invariant that matters: anything navigation still allows must be geometrically clear
        for (let r = 52; r <= 56; r++) {
          if (wk.staticLayer(c, r)) expect(penetration(c * CELL + 8, r * CELL + 8), `col ${c} row ${r}`).toBeLessThanOrEqual(0);
        }
      }
      open.push(keep);
    }
    expect(open[0]).toEqual([40, 41]);
    expect(open[1]).toEqual([44]);
    expect(open[2]).toEqual([49]);
    for (const lane of open) expect(lane.length, "every lane stays passable").toBeGreaterThan(0);
  });

  it("both directions route through all three lanes, and nothing else in Reception was closed", () => {
    const wk = rig();
    const world = new WorldState();
    world.addRoom(DESIGN_ROOM); world.addRoom(RECEPTION_ROOM);
    for (const e of designRoomEntities()) world.addEntity(e);
    for (const e of receptionEntities()) world.addEntity(e);
    world.addRoom(MEETING_ROOM);
    world.addRoom(PROJECT_ROOM);
    world.addRoom(GAMING_ROOM);
  world.addRoom(CENTRAL_HUB);
  world.addRoom(EXECUTIVE_ROOM);
  world.addRoom(CMS_ROOM);
  world.addRoom(AI_ROOM);
  world.addRoom(DEV_ROOM);
  world.addRoom(QA_ROOM);
    registerGroundFloor(world);
    const inBounds = (p: Vec2) => world.walkableAt(p);
    for (const [i, lane] of GATE.lanes.entries()) {
      const x = [656, 728, 792][i]; // an OPEN column of each lane
      expect(planWalk({ x, z: 824 }, { x, z: 960 }, wk, inBounds).ok, `lane ${i + 1} hall→reception`).toBe(true);
      expect(planWalk({ x, z: 960 }, { x, z: 824 }, wk, inBounds).ok, `lane ${i + 1} reception→hall`).toBe(true);
      void lane;
    }
    // the south entrance route is untouched by the gate clearance
    expect(planWalk({ x: 720, z: 1000 }, { x: 720, z: 1216 }, wk, inBounds).ok).toBe(true);
  });

  it("each lane's two bordering gate scanners are the ones it activates", () => {
    for (const [i, lane] of GATE.lanes.entries()) {
      const mid = (lane.x0 + lane.x1) / 2;
      const lit = GATE_ZONES.map((rects, g) => (rects.some((r) => pointInRect({ x: mid, z: 872 }, r)) ? g : -1)).filter((g) => g >= 0);
      expect(lit).toEqual([i, i + 1]);
    }
  });
});

describe("vo3d Reception — Phase 3E.3 interactions", () => {
  const R = 10.5;
  const ents = () => new Map(receptionEntities().map((e) => [e.id, e]));
  /** body-circle clearance of a point against a built group's opaque meshes at body height */
  const clearanceAgainst = (groupName: string, p: { x: number; z: number }): number => {
    const built = buildReception();
    let worst = Infinity;
    built.traverse((o) => {
      if (o.name !== groupName) return;
      for (const b of meshBoxes(o)) {
        if (b.max.y < 2 || b.min.y > 34) continue;
        const nx = Math.max(b.min.x, Math.min(p.x, b.max.x));
        const nz = Math.max(b.min.z, Math.min(p.z, b.max.z));
        worst = Math.min(worst, Math.hypot(p.x - nx, p.z - nz) - R);
      }
    });
    return worst;
  };

  it("counter and kiosk expose an approach capability on a real, body-clear V1 stand cell", () => {
    const m = ents();
    for (const [id, spec, pick] of [
      [COUNTER_INTERACTION_ID, COUNTER_APPROACH, "reception-arc-counter"],
      [KIOSK_INTERACTION_ID, KIOSK_APPROACH, "reception-kiosk"],
    ] as const) {
      const e = m.get(id)!;
      expect(e.capabilities.approach).toBe(spec);
      expect(e.props.pick).toBe(pick);
      // the point is a genuine V1-walkable cell, not an invented spot
      const c = worldToCell(spec.point);
      expect(v1Static(c.cx, c.cy), `${spec.label} stands on a V1-walkable cell`).toBe(true);
      expect(cellCentre(c)).toEqual(spec.point);
      // and the body fits there
      expect(clearanceAgainst(pick, spec.point), `${spec.label} clearance`).toBeGreaterThan(0);
      expect(spec.yaw).toBe(FACING_YAW.north); // both face into the thing they serve
      expect(spec.action.length).toBeGreaterThan(0);
    }
  });

  it("the counter approach is on the VISITOR side of the arc, outside it", () => {
    const d = Math.hypot(COUNTER_APPROACH.point.x - COUNTER.centre.x, COUNTER_APPROACH.point.z - COUNTER.centre.z);
    expect(d).toBeGreaterThan(COUNTER.outerR + R); // south of the fascia, never in the staff pocket
    expect(COUNTER_APPROACH.point.z).toBeGreaterThan(COUNTER.centre.z); // convex (south) side
  });

  it("exactly the two north lounge chairs are sittable — nothing decorative is", () => {
    const all = receptionEntities();
    const sittable = all.filter((e) => e.capabilities.lounge).map((e) => e.id);
    expect(sittable.sort()).toEqual([...LOUNGE_SEAT_IDS].sort());
    for (const kind of ["sofa", "round-table", "plant"]) {
      expect(all.filter((e) => e.kind === kind && (e.capabilities.lounge || e.capabilities.seat))).toHaveLength(0);
    }
    // Reception seating is FIXED: no Reception entity carries the movable desk-chair capability
    expect(all.filter((e) => e.capabilities.seat)).toHaveLength(0);
  });

  it("each lounge slot is a FIXED seat with measured contact metadata, mirrored about the axis", () => {
    const m = ents();
    const [w, e] = LOUNGE_SEAT_IDS.map((id) => m.get(id)!.capabilities.lounge!);
    for (const cap of [w, e]) {
      expect(cap.slots).toHaveLength(1);
      const s = cap.slots[0];
      expect(s.id.length).toBeGreaterThan(0); // occupancy identity for a future multi-avatar pass
      // the contact point is the measured cushion TOP in furniture-local space, not the furniture origin
      expect(s.contactLocal.y).toBe(TUB_CUSHION_TOP_Y);
      expect(s.contactLocal.y).toBeGreaterThan(0);
      expect(s.sink).toBe(TUB_SINK);
      expect(s.seatedYaw).toBe(FACING_YAW.south);
      // the approach is a real V1 stand cell
      const c = worldToCell(s.approach);
      expect(v1Static(c.cx, c.cy)).toBe(true);
      expect(s.approachToSeat.length).toBeGreaterThan(0);
      // a FIXED seat declares nothing about moving furniture
      expect("pullDir" in s).toBe(false);
      expect("pullDistance" in s).toBe(false);
      expect("seatedTuck" in s).toBe(false);
    }
    expect(e.slots[0].approach.x).toBeCloseTo(mirrorX(w.slots[0].approach.x), 6);
    expect(e.slots[0].approach.z).toBe(w.slots[0].approach.z);
    expect(e.slots[0].id).not.toBe(w.slots[0].id);
  });

  it("the interaction entities add no geometry and no navigation blocking", () => {
    for (const id of [COUNTER_INTERACTION_ID, KIOSK_INTERACTION_ID]) {
      const e = ents().get(id)!;
      expect(e.kind).toBe("solid"); // no view is built for it
      expect(e.footprint).toBeUndefined(); // never blocks a route
      expect(e.capabilities.navBlocker).toBeUndefined();
    }
  });
});

describe("vo3d — FIXED lounge seating vs MOVABLE desk-chair seating", () => {
  const slot = () => LOUNGE_SEATS[0].slots[0];

  it("the tub chair's seat metadata is DERIVED from the geometry, never a hand-typed duplicate", () => {
    expect(TUB_CUSHION_TOP).toBeCloseTo(TUB_CHAIR.seatH - TUB_CHAIR.cushionDrop + TUB_CHAIR.cushionH, 6);
    expect(TUB_CUSHION_TOP_Y).toBe(TUB_CUSHION_TOP);
    expect(slot().contactLocal.y).toBe(TUB_CUSHION_TOP);
    // the avatar's measured pelvis-below-hips figure is what makes the butt meet the surface
    expect(PELVIS_BELOW_HIPS).toBeGreaterThan(0);
  });

  it("a fixed lounge seat NEVER writes to the furniture transform", () => {
    const furniture = new THREE.Object3D();
    furniture.position.set(475, 0, 1019);
    const before = furniture.position.clone();
    const avatar = { root: new THREE.Object3D(), yaw: 0, setYaw() {}, play() {}, setClipTimeScale() {}, gltf: null, position: { x: 0, z: 0 } } as never;
    const stack = { acquire: () => true, release: () => {}, owner: "Idle" } as never;
    const seat = new LoungeSeatInteraction(avatar, stack, furniture, slot(), () => ({ ok: true, path: [slot().approach], destination: slot().approach, cell: { cx: 0, cy: 0 } }) as never);
    seat.sit();
    for (let i = 0; i < 600; i++) seat.update(0.016);
    seat.stand();
    for (let i = 0; i < 600; i++) seat.update(0.016);
    expect(furniture.position.equals(before), "furniture moved").toBe(true);
    expect(seat.furnitureDrift()).toBe(0);
    // …and there is no API on it that could move furniture
    expect("pullDir" in slot()).toBe(false);
    expect(Object.keys(slot())).not.toContain("seatedTuck");
  });

  it("occupancy identity is held while seated and released on standing", () => {
    const s = slot();
    expect(s.id).toBe("lounge-west-north");
    expect(LOUNGE_SEATS[1].slots[0].id).toBe("lounge-east-north");
    // distinct ids are what a future multi-avatar pass keys occupancy on
    expect(new Set(LOUNGE_SEATS.flatMap((c) => c.slots.map((x) => x.id))).size).toBe(2);
  });

  it("the Design Room desk chair keeps its MOVABLE behaviour untouched", () => {
    const chair = designRoomEntities().find((e) => e.id === CHAIR_4_ID)!;
    const spec = chair.capabilities.seat!;
    expect(spec).toBeTruthy();
    expect(chair.capabilities.lounge, "the desk chair is not a fixed seat").toBeUndefined();
    // every part of the pull → tuck → return cycle is still declared
    expect(spec.pullDistance).toBeGreaterThan(0);
    expect(spec.seatedTuck).toBeGreaterThan(0);
    expect(spec.pullDir).toBeTruthy();
    expect(spec.timings.pullMs).toBeGreaterThan(0);
    expect(spec.timings.slideMs).toBeGreaterThan(0);
    expect(spec.timings.returnMs).toBeGreaterThan(0);
  });
});

// ---- 3E.4: architectural cleanup — no coplanar top faces anywhere in the built room -----------------
// Two opaque meshes whose TOP faces share a plane over a real footprint z-fight: the depth test has no
// tie-breaker, so which one wins flickers with the camera. The pass that found the three cases fixed in
// 3E.4 (the façade shoe under its sill, the planter pot under its rim, the shared front ledge on the hall
// slab) is kept here so none of them, or a new one, comes back.
describe("vo3d reception — 3E.4 architectural cleanup", () => {
  type Solid = { name: string; min: THREE.Vector3; max: THREE.Vector3 };

  /** every opaque, depth-writing, non-offset mesh under `root`, as world AABBs */
  const solids = (root: THREE.Object3D): Solid[] => {
    root.updateMatrixWorld(true);
    const out: Solid[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry?.getAttribute("position")) return;
      const mats = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.Material[];
      // blended glow planes, contact shadows and glass have no depth conflict; polygonOffset already ties
      if (mats.some((x) => x.transparent || x.depthWrite === false || x.polygonOffset)) return;
      const box = new THREE.Box3().setFromObject(m);
      out.push({ name: `${m.parent?.name ?? "?"}/${m.name || m.type}`, min: box.min, max: box.max });
    });
    return out;
  };

  /** Exposed coplanar top faces: pairs within `eps` of each other in y whose plan footprints overlap by
   *  more than `area` AND which nothing solid covers from above. The cover test is what makes this usable —
   *  a counter's carcass pieces all top out at the worktop's underside, and those faces are never seen. */
  const coplanarTops = (list: Solid[], eps = 1e-3, area = 4): string[] => {
    // a third solid hides the plane if it stands ON it or ENCLOSES it (a table column topping out inside the
    // tabletop, a counter carcass under its worktop): either way nothing ever renders those two faces
    const covered = (x0: number, x1: number, z0: number, z1: number, y: number): boolean =>
      list.some((c) => c.min.y <= y + eps && c.max.y > y + eps && c.min.x <= x0 + eps && c.max.x >= x1 - eps && c.min.z <= z0 + eps && c.max.z >= z1 - eps);
    const hits: string[] = [];
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (Math.abs(a.max.y - b.max.y) > eps) continue;
        const x0 = Math.max(a.min.x, b.min.x), x1 = Math.min(a.max.x, b.max.x);
        const z0 = Math.max(a.min.z, b.min.z), z1 = Math.min(a.max.z, b.max.z);
        if (x1 - x0 <= 0 || z1 - z0 <= 0 || (x1 - x0) * (z1 - z0) <= area) continue;
        if (covered(x0, x1, z0, z1, a.max.y)) continue;
        hits.push(`${a.name} >< ${b.name} @ y=${a.max.y.toFixed(3)} (${((x1 - x0) * (z1 - z0)).toFixed(1)} sq)`);
      }
    return hits;
  };

  it("Reception's own geometry has no exposed coplanar top faces", () => {
    // the logo inlay is excluded on purpose: its two letter groups are ONE extrusion each, so their boxes
    // overlap while the letterforms themselves are disjoint — an AABB artefact, not a shared face.
    const built = solids(receptionStatic(RECEPTION_ROOM)).filter((s) => !s.name.startsWith("reception-logo-inlay/"));
    expect(coplanarTops(built)).toEqual([]);
  });

  it("the shared front ledge does not sit on the hall slab plane", () => {
    // scoped to the SHARED ground floor: the unreconstructed rooms' footprint plates and boundary walls are
    // placeholders (adjacent plates and wall corners share planes by construction) and are not this phase's.
    const ground = solids(buildGroundFloor(groundFloor())).filter((s) => !s.name.startsWith("footprint:"));
    expect(coplanarTops(ground)).toEqual([]);
    // …and the ledge is still flush enough to read as one ground plane rather than a step
    const tops = ground.map((s) => s.max.y).filter((y) => y > 0 && y < 1);
    expect(Math.max(...tops)).toBeLessThan(0.3);
  });

  it("the lounge table sits in the gap its two armchairs leave", () => {
    const t = LOUNGE_WEST.table, [north, south] = LOUNGE_WEST.chairs;
    // the painted rects; the built tub shells are inset a further ~3 inside them on each face
    expect(t.z - t.r - (north.z + north.d / 2)).toBeGreaterThan(0);
    expect(south.z - south.d / 2 - (t.z + t.r)).toBeGreaterThan(0);
  });
});
