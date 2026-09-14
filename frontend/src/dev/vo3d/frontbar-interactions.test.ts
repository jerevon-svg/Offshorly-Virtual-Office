// vo3d — PHASE 4C: Meeting + Project gameplay integration.
// Focused on the interactions only: the 4B geometry is not re-tested here (see frontbar.test.ts).
import { describe, expect, it } from "vitest";
import { EXECUTIVE_ROOM } from "./rooms/executive";
import { CENTRAL_HUB } from "./rooms/central-hub";
import * as THREE from "three";
import { WorldState } from "./world/WorldState";
import { DESIGN_ROOM, designRoomEntities } from "./rooms/design-room";
import { RECEPTION_ROOM, GATE, LOUNGE_SEAT_IDS, GATE_SCANNER_IDS, ENTRY_SCANNER_ID, receptionEntities } from "./rooms/reception";
import {
  MEETING_ROOM, NORTH_WALL as MEETING_NORTH_WALL, CHAIR_CUSHION_TOP, KIOSK_APPROACH, KIOSK_INTERACTION_ID, KIOSK_SCANNER_ID,
  KIOSK_ZONE, MEETING_CHAIR_IDS, CHAIR_CLEARANCE, NORTH_STRIP as MEETING_STRIP, TILE_RECT as MEETING_TILE, meetingRoomEntities,
} from "./rooms/meeting";
import {
  PROJECT_ROOM, NORTH_WALL as PROJECT_NORTH_WALL, ARMCHAIRS, CONSOLE_APPROACH, CONSOLE_INTERACTION_ID, SOFAS, SOFA_CUSHION_TOP, SOFA_SEAT_IDS,
  TUB_SEAT_IDS, TV_APPROACH, TV_INTERACTION_ID, NORTH_STRIP as PROJECT_STRIP, TILE_RECT as PROJECT_TILE, projectRoomEntities,
} from "./rooms/project";
import { GAMING_ROOM } from "./rooms/gaming";
import { meetingStatic } from "./build/meeting";
import { projectStatic } from "./build/project";
import { TUB_CHAIR, TUB_CUSHION_TOP } from "./build/furniture";
import { buildEntity } from "./build/registry";
import { registerGroundFloor } from "./rooms/ground-floor";
import { AmbientSystem } from "./render/Ambient";
import { PALETTE } from "./render/Materials";
import { SeatInteraction } from "./interact/Seat";
import { LoungeSeatInteraction } from "./interact/LoungeSeat";
import { Walkability, composeStatic } from "./nav/Walkability";
import { clearanceLayer, worldClearances } from "./nav/clearance";
import { planWalk } from "./nav/planner";
import { CELL, v1Static, worldToCell } from "./adapters/v1Grid";
import { openedCells, openedLayer, v2Static } from "./nav/v2Open";
import { FACING_YAW, pointInRect, type Vec2 } from "./core/coords";

const BODY_RADIUS = 10.5;

function rig() {
  const world = new WorldState();
  for (const r of [DESIGN_ROOM, RECEPTION_ROOM, MEETING_ROOM, PROJECT_ROOM, GAMING_ROOM, CENTRAL_HUB, EXECUTIVE_ROOM]) world.addRoom(r);
  for (const e of [...designRoomEntities(), ...receptionEntities(), ...meetingRoomEntities(), ...projectRoomEntities()]) world.addEntity(e);
  registerGroundFloor(world);
  const inBounds = (p: Vec2) => world.walkableAt(p);
  const bands = [MEETING_STRIP, PROJECT_STRIP];
  const wk = new Walkability(composeStatic(v2Static(v1Static, openedLayer(bands)), inBounds, clearanceLayer(worldClearances(world))));
  wk.syncFromWorld(world);
  return { world, wk, inBounds, bands, walk: (a: Vec2, b: Vec2) => planWalk(a, b, wk, inBounds) };
}

/** A headless avatar with just the surface the two seat controllers touch. */
function stubAvatar(at: Vec2 = { x: 0, z: 0 }) {
  const root = new THREE.Object3D();
  root.position.set(at.x, 0, at.z);
  const a = {
    root, yaw: 0, gltf: null, position: { x: 0, z: 0 }, currentClip: "",
    setYaw(y: number) { a.yaw = y; root.rotation.y = y; },
    setPosition(p: Vec2) { root.position.set(p.x, 0, p.z); },
    play(c: string) { a.currentClip = c; },
    setClipTimeScale() {},
    attachTo(o: THREE.Object3D) { o.add(root); },
    detachTo(o: THREE.Object3D) { o.add(root); },
    worldPosition() { return root.position; },
  };
  return a as never;
}
function stubStack() {
  const s = { owner: "Idle", acquire(o: string) { s.owner = o; return true; }, release() { s.owner = "Idle"; } };
  return s;
}
const okWalk = (to: Vec2) => ({ ok: true, path: [to], destination: to, cell: worldToCell(to) }) as never;
/** run a controller to completion (or until it stops changing) */
function settle(c: { update(dt: number): void; state: string }, frames = 900): void {
  for (let i = 0; i < frames; i++) c.update(1 / 60);
}

/** is a body of BODY_RADIUS on `p` clear of every mesh in `g` that stands above knee height? */
function bodyClear(p: Vec2, g: THREE.Object3D, slack = 0): { ok: boolean; worst: number } {
  g.updateMatrixWorld(true);
  let worst = Infinity;
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const b = new THREE.Box3().setFromObject(m);
    if (b.max.y <= 12) return; // below knee height: you can stand over it
    const dx = Math.max(b.min.x - p.x, 0, p.x - b.max.x);
    const dz = Math.max(b.min.z - p.z, 0, p.z - b.max.z);
    worst = Math.min(worst, Math.hypot(dx, dz));
  });
  return { ok: worst >= BODY_RADIUS - slack, worst };
}

describe("vo3d Meeting — 4C conference seating", () => {
  it("all six chairs carry the MOVABLE seat capability, and nothing in the room is a fixed lounge seat", () => {
    const es = meetingRoomEntities();
    expect(MEETING_CHAIR_IDS).toHaveLength(6);
    for (const id of MEETING_CHAIR_IDS) {
      const e = es.find((x) => x.id === id)!;
      expect(e, id).toBeTruthy();
      expect(e.capabilities.seat, `${id} movable seat`).toBeTruthy();
      expect(e.capabilities.lounge, `${id} must NOT be a fixed seat`).toBeUndefined();
      const s = e.capabilities.seat!;
      // the whole pull → tuck → return cycle is declared, so the movable architecture is intact
      expect(s.pullDistance).toBeGreaterThanOrEqual(12);
      expect(s.pullDir.x === 0 && Math.abs(s.pullDir.z) === 1).toBe(true);
      expect(s.timings.pullMs).toBeGreaterThan(0);
      expect(s.timings.slideMs).toBeGreaterThan(0);
      expect(s.timings.returnMs).toBeGreaterThan(0);
    }
  });

  it("the pull-out is VISIBLE, clears the wall and the table, and is approached from beside the chair", () => {
    const { wk } = rig();
    const es = meetingRoomEntities();
    for (const id of MEETING_CHAIR_IDS) {
      const e = es.find((x) => x.id === id)!;
      const s = e.capabilities.seat!;
      const north = e.transform.pos.z < 992;
      // a visible gesture, not a token roll
      expect(s.pullDistance, `${id} pull`).toBeGreaterThanOrEqual(12);
      expect(s.pullDir.z, id).toBe(north ? -1 : 1);
      expect(s.seatedTuck, `${id} tucks back in`).toBeGreaterThan(0);
      expect(s.seatedYaw, id).toBe(north ? FACING_YAW.south : FACING_YAW.north);
      // the approach is a real walkable cell centre BESIDE the chair, never inside it
      const c = worldToCell(s.approach);
      expect(s.approach).toEqual({ x: c.cx * CELL + CELL / 2, z: c.cy * CELL + CELL / 2 });
      expect(wk.walkable(c.cx, c.cy), `${id} approach cell (${c.cx},${c.cy})`).toBe(true);
      expect(Math.abs(s.approach.x - e.transform.pos.x), `${id} approach is beside the chair`).toBeGreaterThan(15);
      // the pulled chair's real silhouette clears the corrected wall and stays off the façade
      const box = new THREE.Box3().setFromObject(buildEntity(e).group);
      const half = (box.max.z - box.min.z) / 2;
      const pulled = e.transform.pos.z + s.pullDir.z * s.pullDistance;
      if (north) expect(pulled - half, `${id} vs the north wall face`).toBeGreaterThanOrEqual(948);
      else expect(pulled + half, `${id} vs the façade`).toBeLessThanOrEqual(1120);
      // and the sitter's entry point lies in the gap the pull opens, not inside the chair at rest
      expect(Math.abs(s.preSeat.z - pulled), `${id} preSeat vs pulled chair`).toBeGreaterThan(half - 6);
    }
    expect(CHAIR_CLEARANCE.northBackAtFullPull).toBeGreaterThanOrEqual(948);
    expect(CHAIR_CLEARANCE.southFrontAtFullPull).toBeLessThanOrEqual(1120);
  });

  it("seat metadata is DERIVED from the chair builder, not hand-typed twice", () => {
    // build/furniture.ts chair(): seat pan seatH 13, cushion 3.4 tall based at seatH-2 → top 14.4
    expect(CHAIR_CUSHION_TOP).toBe(14.4);
    for (const id of MEETING_CHAIR_IDS) {
      const s = meetingRoomEntities().find((x) => x.id === id)!.capabilities.seat!;
      expect(s.cushionTopY).toBe(CHAIR_CUSHION_TOP);
      expect(s.cushionLocal).toEqual({ x: 0, z: 0.3 }); // the cushion's own local centre
    }
  });

  it("full cycle on every chair: sit → seated → stand → idle, with ZERO rest drift", () => {
    for (const id of MEETING_CHAIR_IDS) {
      const spec = meetingRoomEntities().find((x) => x.id === id)!.capabilities.seat!;
      const scene = new THREE.Object3D();
      const chair = new THREE.Object3D();
      chair.position.set(200, 0, 1000);
      scene.add(chair);
      const rest = chair.position.clone();
      const avatar = stubAvatar(spec.approach), stack = stubStack();
      const seat = new SeatInteraction(avatar, stack as never, chair, spec, okWalk, () => 30);
      expect(seat.sit()).toBeTruthy();
      settle(seat, 420);
      expect(seat.state, `${id} should be seated`).toBe("seated");
      expect(stack.owner, `${id} owns the avatar while seated`).toBe("Interaction");
      seat.stand();
      settle(seat, 600);
      expect(seat.state, `${id} should return to idle`).toBe("idle");
      expect(stack.owner, `${id} releases ownership`).toBe("Idle");
      expect(seat.chairRestError(), `${id} rest drift`).toBeLessThan(1e-9);
      expect(chair.position.distanceTo(rest)).toBeLessThan(1e-9);
    }
  });

  it("the chair actually moves during the cycle (it is movable, not a fixed seat in disguise)", () => {
    const spec = meetingRoomEntities().find((x) => x.id === MEETING_CHAIR_IDS[0])!.capabilities.seat!;
    const chair = new THREE.Object3D();
    const scene = new THREE.Object3D();
    scene.add(chair);
    const seat = new SeatInteraction(stubAvatar(spec.approach), stubStack() as never, chair, spec, okWalk, () => 30);
    seat.sit();
    let maxMove = 0;
    for (let i = 0; i < 200; i++) { seat.update(1 / 60); maxMove = Math.max(maxMove, chair.position.length()); }
    expect(maxMove).toBeCloseTo(12, 3); // the north row's pull
  });
});

describe("vo3d — 4C corrected north walls + the V2-local walkability they justify", () => {
  it("the north walls are real walls, not masses, and the rooms got their floor back", () => {
    for (const [name, wall, floor] of [
      ["meeting", MEETING_NORTH_WALL, MEETING_ROOM.floorRect],
      ["project", PROJECT_NORTH_WALL, PROJECT_ROOM.floorRect],
    ] as const) {
      expect(wall.z1 - wall.z0, `${name} wall thickness`).toBe(12); // a wall, not a 97/117-unit block
      // both inner faces land on Reception's own balustrade plane — one architectural line for the bar
      expect(wall.z1, `${name} wall inner face`).toBe(GATE.z);
      expect(floor.z, `${name} floor starts at the wall face`).toBe(GATE.z);
      expect(floor.z + floor.d).toBe(1120); // still ends on the shared façade plane
    }
    // the removed mass is real floor now, and both rooms end up the SAME depth as each other
    expect(MEETING_ROOM.floorRect.d).toBe(1120 - GATE.z); // 230, was 160 in 4B
    expect(PROJECT_ROOM.floorRect.d).toBe(MEETING_ROOM.floorRect.d);
    // the tiled plate runs to the wall's outer face so no void is left under it
    for (const [name, tile, wall] of [["meeting", MEETING_TILE, MEETING_NORTH_WALL], ["project", PROJECT_TILE, PROJECT_NORTH_WALL]] as const)
      expect(tile.z, `${name} plate`).toBe(wall.z0);
  });

  it("the override ONLY adds cells, only inside the two declared bands, and the V1 grid is untouched", () => {
    const bands = [MEETING_STRIP, PROJECT_STRIP];
    const open = openedLayer(bands);
    const cells = openedCells(bands);
    expect(cells.length).toBeGreaterThan(20);
    for (const c of cells) {
      expect(v1Static(c.cx, c.cy), `(${c.cx},${c.cy}) is already V1-walkable`).toBe(false); // only ADDITIONS
      expect(c.cy, "only rows between the aligned wall and V1's own lane").toBeGreaterThanOrEqual(56);
      expect(c.cy).toBeLessThanOrEqual(59);
      const centre = { x: c.cx * CELL + CELL / 2, z: c.cy * CELL + CELL / 2 };
      expect(bands.some((b) => pointInRect(centre, b.rect)), "inside a declared band").toBe(true);
    }
    // nothing outside the bands can change, in either room or anywhere else
    for (const [cx, cy] of [[10, 62], [45, 54], [75, 63], [20, 40], [7, 61]] as const)
      expect(open(cx, cy), `(${cx},${cy}) must stay as V1 says`).toBe(false);
    // the composed layer is a strict superset of V1
    const composed = v2Static(v1Static, open);
    for (const c of cells) expect(composed(c.cx, c.cy)).toBe(true);
  });

  it("free circulation: the new strip is reachable and links the whole north lane of both rooms", () => {
    const { walk } = rig();
    for (const [name, a, b] of [
      ["meeting north strip ↔ its own south strip", { x: 168, z: 952 }, { x: 168, z: 1096 }],
      ["project north strip ↔ its own south strip", { x: 1112, z: 952 }, { x: 1112, z: 1112 }],
      ["reception → meeting north strip", { x: 720, z: 1000 }, { x: 168, z: 952 }],
      ["reception → project north strip", { x: 720, z: 1000 }, { x: 1320, z: 952 }],
    ] as const) expect(walk(a, b).ok, name).toBe(true);
  });
});

describe("vo3d Meeting — 4C terminal approach + scanner", () => {
  it("the terminal's walk-up point is walkable, body-clear and reachable from Reception", () => {
    const { wk, walk } = rig();
    const c = worldToCell(KIOSK_APPROACH.point);
    expect(KIOSK_APPROACH.point).toEqual({ x: c.cx * CELL + CELL / 2, z: c.cy * CELL + CELL / 2 });
    expect(wk.walkable(c.cx, c.cy), "terminal approach cell").toBe(true);
    const clear = bodyClear(KIOSK_APPROACH.point, meetingStatic(MEETING_ROOM));
    expect(clear.ok, `body clearance at the terminal: ${clear.worst.toFixed(1)}`).toBe(true);
    expect(KIOSK_APPROACH.yaw).toBe(FACING_YAW.west); // turns to face the machine
    const r = walk({ x: 720, z: 1000 }, KIOSK_APPROACH.point);
    expect(r.ok, r.ok ? "" : r.reason).toBe(true);
  });

  it("the interaction entity adds no geometry and no navigation blocking", () => {
    const e = meetingRoomEntities().find((x) => x.id === KIOSK_INTERACTION_ID)!;
    expect(e.kind).toBe("solid");
    expect(e.footprint).toBeUndefined();
    expect(e.capabilities.navBlocker).toBeUndefined();
    expect(e.props.pick).toBe("meeting-kiosk-assembly");
  });

  it("the terminal idles BLUE and only turns GREEN when someone is detected", () => {
    const g = meetingStatic(MEETING_ROOM);
    const tinted: THREE.Mesh[] = [];
    g.traverse((o) => {
      const spec = o.userData.ambient as { group?: string; tint?: { idle: number; active: number } } | undefined;
      if (spec?.group === KIOSK_SCANNER_ID && spec.tint) tinted.push(o as THREE.Mesh);
    });
    expect(tinted.length, "tinted scanner channels on the terminal").toBeGreaterThanOrEqual(3);
    for (const m of tinted) {
      const spec = m.userData.ambient as { tint: { idle: number; active: number } };
      expect(spec.tint.idle).toBe(PALETTE.cyan);
      expect(spec.tint.active).toBe(PALETTE.readyGreen);
    }
    const amb = new AmbientSystem();
    expect(amb.collect(MEETING_ROOM.id, g)).toBeGreaterThan(0);
    // idle: nothing on the terminal reads green
    amb.update(0, 0.016);
    const green = new THREE.Color(PALETTE.readyGreen), blue = new THREE.Color(PALETTE.cyan);
    const near = (m: THREE.Mesh, c: THREE.Color) => (m.material as THREE.MeshStandardMaterial).color.getHex() === c.getHex();
    for (const m of tinted) expect(near(m, blue), "idle must read blue").toBe(true);
    // detected: the same channels ease to green
    amb.setScanner(KIOSK_SCANNER_ID, true);
    for (let i = 0; i < 200; i++) amb.update(i * 0.016, 0.016);
    expect(amb.scannerActivation(KIOSK_SCANNER_ID)).toBeGreaterThan(0.95);
    for (const m of tinted) expect(near(m, green), "detected must read green").toBe(true);
    // …and releases back to blue
    amb.setScanner(KIOSK_SCANNER_ID, false);
    for (let i = 0; i < 600; i++) amb.update(i * 0.016, 0.016);
    expect(amb.scannerActivation(KIOSK_SCANNER_ID)).toBeLessThan(0.05);
  });

  it("the scanner zone covers the walk-up point and nothing in Reception's lounge", () => {
    expect(pointInRect(KIOSK_APPROACH.point, KIOSK_ZONE)).toBe(true);
    for (const p of [{ x: 385, z: 1005 }, { x: 477, z: 1019 }, { x: 720, z: 1096 }, { x: 184, z: 1064 }])
      expect(pointInRect(p, KIOSK_ZONE), `${p.x},${p.z} must not light the terminal`).toBe(false);
  });
});

describe("vo3d Project — 4C fixed lounge seating", () => {
  const es = () => projectRoomEntities();

  it("two sofas × two cushions + two tub chairs = six FIXED slots, and none of them is movable", () => {
    const all = [...SOFA_SEAT_IDS, ...TUB_SEAT_IDS].map((id) => es().find((x) => x.id === id)!);
    expect(all.every(Boolean)).toBe(true);
    const slots = all.flatMap((e) => e.capabilities.lounge!.slots);
    expect(slots).toHaveLength(6);
    expect(new Set(slots.map((s) => s.id)).size, "occupancy ids are unique").toBe(6);
    for (const e of all) {
      expect(e.capabilities.seat, `${e.id} must NOT be movable`).toBeUndefined();
      for (const s of e.capabilities.lounge!.slots) {
        expect("pullDir" in s).toBe(false);
        expect("seatedTuck" in s).toBe(false);
      }
    }
    // exactly two per sofa — the builder lays two cushions, so a third slot would seat a body on the gap
    for (const id of SOFA_SEAT_IDS) expect(es().find((x) => x.id === id)!.capabilities.lounge!.slots).toHaveLength(2);
    for (const id of TUB_SEAT_IDS) expect(es().find((x) => x.id === id)!.capabilities.lounge!.slots).toHaveLength(1);
  });

  it("contact metadata is DERIVED from the builders, and each slot sits on its own cushion", () => {
    expect(TUB_CUSHION_TOP).toBeCloseTo(TUB_CHAIR.seatH - TUB_CHAIR.cushionDrop + TUB_CHAIR.cushionH, 6);
    expect(SOFA_CUSHION_TOP).toBe(15.6); // deck top 10 + lounge cushion 5.6
    for (const id of TUB_SEAT_IDS)
      for (const s of es().find((x) => x.id === id)!.capabilities.lounge!.slots)
        expect(s.contactLocal.y).toBe(TUB_CUSHION_TOP);
    for (const id of SOFA_SEAT_IDS) {
      const slots = es().find((x) => x.id === id)!.capabilities.lounge!.slots;
      for (const s of slots) expect(s.contactLocal.y).toBe(SOFA_CUSHION_TOP);
      // the two cushions are mirror images about the sofa's own centre line
      expect(slots[0].contactLocal.z).toBe(-slots[1].contactLocal.z);
      expect(slots[0].contactLocal.x).toBe(slots[1].contactLocal.x);
    }
  });

  it("every approach is a V1-walkable stand cell and the sitter ends up facing across the room", () => {
    const { wk } = rig();
    for (const [id, list] of [["sofa", SOFAS], ["tub", ARMCHAIRS]] as const) {
      for (const f of list) {
        const c = worldToCell(f.stand);
        expect(f.stand.x, `${id} ${f.id}`).toBe(c.cx * CELL + CELL / 2);
        expect(wk.walkable(c.cx, c.cy), `${f.id} stand cell (${c.cx},${c.cy})`).toBe(true);
      }
    }
    // west pieces look east, east pieces look west — the two sides face each other
    const yaw = (id: string) => es().find((x) => x.id === `project-room/${id}`)!.capabilities.lounge!.slots[0].seatedYaw;
    expect(yaw("sofa-west")).toBe(FACING_YAW.east);
    expect(yaw("sofa-east")).toBe(FACING_YAW.west);
    expect(yaw("tub-chair-west")).toBe(FACING_YAW.east);
    expect(yaw("tub-chair-east")).toBe(FACING_YAW.west);
  });

  it("full cycle on every slot: sit → seated → stand → idle, furniture NEVER moves", () => {
    for (const id of [...SOFA_SEAT_IDS, ...TUB_SEAT_IDS]) {
      const e = es().find((x) => x.id === id)!;
      for (const slot of e.capabilities.lounge!.slots) {
        const furniture = new THREE.Object3D();
        furniture.position.set(e.transform.pos.x, 0, e.transform.pos.z);
        const before = furniture.position.clone();
        const avatar = stubAvatar(slot.approach), stack = stubStack();
        const seat = new LoungeSeatInteraction(avatar, stack as never, furniture, slot, okWalk, () => 30);
        expect(seat.sit()).toBeTruthy();
        settle(seat, 200);
        expect(seat.state, `${slot.id} seated`).toBe("seated");
        expect(seat.occupiedBy, `${slot.id} holds occupancy`).toBe(slot.id);
        expect(stack.owner).toBe("Interaction");
        seat.stand();
        settle(seat, 400);
        expect(seat.state, `${slot.id} idle`).toBe("idle");
        expect(seat.occupiedBy, `${slot.id} releases occupancy`).toBeNull();
        expect(stack.owner, `${slot.id} releases ownership`).toBe("Idle");
        expect(seat.furnitureDrift(), `${slot.id} furniture drift`).toBe(0);
        expect(furniture.position.equals(before)).toBe(true);
      }
    }
  });

  it("the console and board walk-up points are walkable, body-clear and reachable", () => {
    const { wk, walk } = rig();
    const g = projectStatic(PROJECT_ROOM);
    for (const [name, spec] of [["console", CONSOLE_APPROACH], ["board", TV_APPROACH]] as const) {
      const c = worldToCell(spec.point);
      expect(spec.point, name).toEqual({ x: c.cx * CELL + CELL / 2, z: c.cy * CELL + CELL / 2 });
      expect(wk.walkable(c.cx, c.cy), `${name} approach cell`).toBe(true);
      const clear = bodyClear(spec.point, g);
      expect(clear.ok, `${name} clearance ${clear.worst.toFixed(1)}`).toBe(true);
      expect(spec.yaw).toBe(FACING_YAW.east); // both face the east wall
      const r = walk({ x: 720, z: 1000 }, spec.point);
      expect(r.ok, r.ok ? "" : r.reason).toBe(true);
    }
    expect(CONSOLE_APPROACH.point).not.toEqual(TV_APPROACH.point);
    for (const e of [CONSOLE_INTERACTION_ID, TV_INTERACTION_ID].map((id) => es().find((x) => x.id === id)!)) {
      expect(e.kind).toBe("solid");
      expect(e.footprint).toBeUndefined();
      expect(e.capabilities.navBlocker).toBeUndefined();
    }
  });
});

describe("vo3d — 4C regression: the fixed/movable split and Reception are untouched", () => {
  it("movable seats live only where a chair can actually roll; fixed seats never declare a pull", () => {
    const world = rig().world;
    const movable = [...world.entities.values()].filter((e) => e.capabilities.seat);
    const fixed = [...world.entities.values()].filter((e) => e.capabilities.lounge);
    expect(movable.map((e) => e.roomId).every((r) => r === DESIGN_ROOM.id || r === MEETING_ROOM.id)).toBe(true);
    expect(fixed.map((e) => e.roomId).every((r) => r === RECEPTION_ROOM.id || r === PROJECT_ROOM.id)).toBe(true);
    for (const e of movable) expect(e.capabilities.lounge).toBeUndefined();
    for (const e of fixed) expect(e.capabilities.seat).toBeUndefined();
    expect(movable).toHaveLength(7); // the Design Room desk chair + six conference chairs
    expect(fixed).toHaveLength(6); // Reception's two tub chairs + Project's two sofas and two tub chairs
  });

  it("Reception keeps its two lounge seats, four gate scanners and entrance scanner", () => {
    const es = receptionEntities();
    expect(LOUNGE_SEAT_IDS).toHaveLength(2);
    for (const id of LOUNGE_SEAT_IDS) expect(es.find((x) => x.id === id)!.capabilities.lounge!.slots).toHaveLength(1);
    expect(GATE_SCANNER_IDS).toHaveLength(4);
    expect([...GATE_SCANNER_IDS, ENTRY_SCANNER_ID]).not.toContain(KIOSK_SCANNER_ID);
  });

  it("gate lanes and the entrance route still work with all four rooms live", () => {
    const { walk } = rig();
    const street = { x: 720, z: 1176 };
    const hall = { x: 720, z: 928 };
    for (const [name, a, b] of [
      ["street → hall (through the entrance and a gate)", street, hall],
      ["hall → meeting terminal", hall, KIOSK_APPROACH.point],
      ["hall → coffee station", hall, CONSOLE_APPROACH.point],
    ] as const) expect(walk(a, b).ok, name).toBe(true);
  });
});
