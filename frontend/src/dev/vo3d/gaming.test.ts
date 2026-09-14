import { describe, expect, it } from "vitest";
import { EXECUTIVE_ROOM } from "./rooms/executive";
import { CMS_ROOM } from "./rooms/cms";
import { CENTRAL_HUB } from "./rooms/central-hub";
import * as THREE from "three";
import manifest from "../../data/office-assets-manifest.json";
import { SEAT_DIRECTIONS, seatCellKey } from "../../data/seatDirections";
import { WorldState } from "./world/WorldState";
import { SceneMirror } from "./render/SceneMirror";
import { registerGroundFloor, RECONSTRUCTED_ROOM_IDS } from "./rooms/ground-floor";
import { DESIGN_ROOM, designRoomEntities } from "./rooms/design-room";
import { RECEPTION_ROOM } from "./rooms/reception";
import { MEETING_ROOM } from "./rooms/meeting";
import { PROJECT_ROOM } from "./rooms/project";
import {
  BEANBAGS, CHAIR_Z, DESK_RUN, DOOR, EAST_X, FLOOR_RECT, GAMING_ROOM, GAMING_ROOM_ID, NOOK,
  NORTH_STRIP, NORTH_Z, RECT, SOFA, SOUTH_PARTITION, SOUTH_Z, STATIONS, STATION_KIT, THEME, TILE_RECT, WALL_T,
  WEST_STRIP, WEST_X, gamingRoomEntities,
  BAG_SEATS, BAG_SEAT_IDS, CHAIR_APPROACH_X, CHAIR_APPROACH_Z, CHAIR_BACK_AT_FULL_PULL, CHAIR_SIZE,
  DARTS_APPROACH, DARTS_INTERACTION_ID, DOOR_LEAF_ID, FRIDGE_APPROACH, FRIDGE_INTERACTION_ID,
  GAMING_CHAIR_IDS, POSTER_APPROACH, POSTER_INTERACTION_ID, SOFA_SEAT_ID, TV_APPROACH, TV_INTERACTION_ID,
  bagCrown,
} from "./rooms/gaming";
import { openedCells, openedLayer, v2Static } from "./nav/v2Open";
import { CELL, v1Static, worldToCell } from "./adapters/v1Grid";
import { SlidingDoor } from "./interact/Door";
import { GAMING_CHAIR, SOFA_CUSHION_TOP, sofaCushionDepth, sofaCushionZ } from "./build/furniture";
import { FACING_YAW, pointInRect, type Rect, type Vec2 } from "./core/coords";

const inRect = (p: Vec2, r: Rect) => pointInRect(p, r);

function rig() {
  const world = new WorldState();
  world.addRoom(DESIGN_ROOM);
  world.addRoom(RECEPTION_ROOM);
  world.addRoom(MEETING_ROOM);
  world.addRoom(PROJECT_ROOM);
  world.addRoom(GAMING_ROOM);
  world.addRoom(CENTRAL_HUB);
  world.addRoom(EXECUTIVE_ROOM);
  world.addRoom(CMS_ROOM);
  for (const e of designRoomEntities()) world.addEntity(e);
  for (const e of gamingRoomEntities()) world.addEntity(e);
  const plan = registerGroundFloor(world);
  return { world, plan };
}

describe("vo3d gaming room — 5B architecture is derived, not invented", () => {
  it("takes its rect from the READ-ONLY V1 manifest", () => {
    const layer = (manifest as { id: string; kind: string; x: number; y: number; width: number; height: number }[])
      .find((l) => l.id === GAMING_ROOM_ID && l.kind === "room")!;
    expect(RECT).toEqual({ x: layer.x, z: layer.y, w: layer.width, d: layer.height });
  });

  it("builds REAL 12-unit walls inside the art box — no 54-unit baked-perspective mass", () => {
    expect(WALL_T).toBe(12);
    // north: the art box top is 617.97 and V1 blocks all the way to 672. The wall is 12 thick, so the
    // 42 units between its inner face and V1's first open row are floor, not wall.
    expect(NORTH_Z - RECT.z).toBeCloseTo(12.03, 1);
    expect(672 - NORTH_Z).toBe(42);
    // west: V1 blocks a 32-unit band (cols 69-70); the wall is 12 and the rest is recovered
    expect(WEST_X - 1112).toBe(12);
    // every wall face stays inside the manifest bounding box. The east wall's outer face lands on the
    // BUILDING perimeter at 1432, which every east-side room shares (dev 1111.14+320.86, cms 1141+291);
    // gaming's own box reads 1431.998 purely from float rounding, hence the hundredth of a unit here.
    expect(WEST_X - WALL_T).toBeGreaterThanOrEqual(RECT.x);
    expect(EAST_X + WALL_T).toBeLessThanOrEqual(RECT.x + RECT.w + 0.01);
    expect(SOUTH_Z + WALL_T).toBeLessThanOrEqual(RECT.z + RECT.d);
  });

  it("floor region sits inside the walls and the tiled plate covers their outer faces", () => {
    expect(FLOOR_RECT).toEqual({ x: WEST_X, z: NORTH_Z, w: EAST_X - WEST_X, d: SOUTH_Z - NORTH_Z });
    expect(TILE_RECT.x).toBeLessThanOrEqual(FLOOR_RECT.x);
    expect(TILE_RECT.z).toBeLessThanOrEqual(FLOOR_RECT.z);
    expect(TILE_RECT.x + TILE_RECT.w).toBeGreaterThanOrEqual(FLOOR_RECT.x + FLOOR_RECT.w);
    expect(TILE_RECT.z + TILE_RECT.d).toBeGreaterThanOrEqual(FLOOR_RECT.z + FLOOR_RECT.d);
    expect(GAMING_ROOM.floorRect).toBe(FLOOR_RECT);
  });

  it("the south partition is glazed OVER an opaque spandrel (never exposing the dead space behind)", () => {
    expect(SOUTH_PARTITION.spandrel).toBeGreaterThan(DESK_RUN.h); // taller than the desks in front of it
    expect(SOUTH_PARTITION.spandrel + SOUTH_PARTITION.head).toBeLessThan(SOUTH_PARTITION.h); // glass remains
  });

  it("is registered as a reconstructed room and gets a walkable floor region", () => {
    expect(RECONSTRUCTED_ROOM_IDS.has(GAMING_ROOM_ID)).toBe(true);
    const { world } = rig();
    const region = world.regions.find((r) => r.id === `floor:${GAMING_ROOM_ID}`)!;
    expect(region.walkable).toBe(true);
    expect(region.rect).toEqual(FLOOR_RECT);
    expect(world.walkableAt({ x: 1272, z: 700 })).toBe(true);
  });
});

describe("vo3d gaming room — seats match V1 exactly", () => {
  it("every anchor equals a data/seatDirections.ts gaming-room key, and all nine are used", () => {
    const authored = new Set(Object.keys(SEAT_DIRECTIONS["gaming-room"].seats!));
    expect(authored.size).toBe(9);
    const ours: Vec2[] = [
      ...STATIONS.map((x) => ({ x, z: CHAIR_Z })),
      ...BEANBAGS.map((b) => ({ x: b.x, z: b.z })),
      { x: SOFA.x, z: 744 }, // the sofa's V1 'ooooo' cluster centroid (the piece itself sits at 747)
      { x: NOOK.poufs[0].x, z: NOOK.poufs[0].z },
      { x: NOOK.poufs[1].x, z: NOOK.poufs[1].z },
    ];
    expect(ours).toHaveLength(9);
    for (const p of ours) expect(authored.has(seatCellKey(p.x, p.z)), `${p.x},${p.z}`).toBe(true);
    expect(new Set(ours.map((p) => seatCellKey(p.x, p.z))).size).toBe(9);
  });

  it("desk stations are the grid's 48-unit pitch and each chair tucks into the run", () => {
    expect(STATIONS).toEqual([1200, 1248, 1296, 1344]);
    for (let i = 1; i < STATIONS.length; i++) expect(STATIONS[i] - STATIONS[i - 1]).toBe(48);
    expect(STATIONS[0] - 24).toBeGreaterThanOrEqual(DESK_RUN.x0);
    expect(STATIONS[3] + 24).toBeLessThanOrEqual(DESK_RUN.x1);
    expect(CHAIR_Z).toBeLessThan(DESK_RUN.z0); // chairs sit north of the desk front
    // the run backs onto the partition with a small service gap — NOT flush: see the sightline test below
    const gap = SOUTH_Z - DESK_RUN.z1;
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThanOrEqual(10);
  });

  // The 5B live render caught what no amount of reading the artwork would have: at the default camera the
  // whole southern band was hidden behind the desks and the spandrel, so four monitors, their lighting and
  // the partition cove rendered as one dead dark mass. These are the numbers that fixed it.
  it("SIGHTLINE: the game camera can actually see the desk kit and the partition cove", () => {
    const TAN = Math.tan((52 * Math.PI) / 180); // camera pitch, from render/Renderer DEFAULT_CAMERA
    const p = SOUTH_PARTITION;
    /** the camera sits south and above; a ray leaving `point` toward it rises going south. It is blocked
     *  if it meets the opaque spandrel or the head rail — the glass between them is see-through. */
    const visible = (z: number, y: number): boolean => {
      for (let zz = Math.max(z, p.z0); zz <= p.z1; zz += 0.25) {
        const yy = y + (zz - z) * TAN;
        if (yy < p.spandrel) return false;
        if (yy >= p.h - p.head && yy <= p.h) return false;
      }
      return true;
    };
    expect(visible(STATION_KIT.monitor, DESK_RUN.h + 2.8)).toBe(true); // monitor bottom edge
    expect(visible(STATION_KIT.monitor + 1.5, DESK_RUN.h + 5)).toBe(true); // rear RGB bar
    expect(visible(STATION_KIT.keyboard, DESK_RUN.h)).toBe(true); // the desktop under the keyboard
    expect(visible(p.z0 + 1.4, p.spandrel + 0.9)).toBe(true); // CHANNEL 1, standing on the sill
    expect(visible(p.z0 + 1.4, p.spandrel + 14)).toBe(false); // any higher and the head rail clips it
    // and the regression this guards: a cove at the partition's BASE is invisible from this camera
    expect(visible(p.z0 - 1.3, 1.4)).toBe(false);
    // the spandrel may never grow back into the sightline
    expect(p.spandrel).toBeLessThanOrEqual(26);
  });
});

describe("vo3d gaming room — navigation", () => {
  it("keeps the V1 west entrance completely clear of geometry", () => {
    const { world } = rig();
    const band: Rect = { x: 1104, z: DOOR.z0, w: 32, d: DOOR.z1 - DOOR.z0 };
    // V1 authored the band as '+' cells: it must still be walkable end to end
    for (let z = DOOR.z0 + 8; z < DOOR.z1; z += 16)
      for (let x = 1096; x < 1136; x += 16) {
        const c = worldToCell({ x, z });
        expect(v1Static(c.cx, c.cy), `door cell ${c.cx},${c.cy}`).toBe(true);
      }
    // and no entity footprint may overlap it
    for (const e of world.inRoom(GAMING_ROOM_ID)) {
      if (!e.footprint || e.footprint.shape !== "rect") continue;
      const { pos } = e.transform;
      const r: Rect = { x: pos.x - e.footprint.w / 2, z: pos.z - e.footprint.d / 2, w: e.footprint.w, d: e.footprint.d };
      const overlaps = r.x < band.x + band.w && r.x + r.w > band.x && r.z < band.z + band.d && r.z + r.d > band.z;
      expect(overlaps, `${e.id} intrudes on the door band`).toBe(false);
    }
  });

  it("the V2-local bands recover floor ONLY inside the room, and never touch the V1 grid file", () => {
    const bands = [NORTH_STRIP, WEST_STRIP];
    const cells = openedCells(bands);
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) {
      const centre = { x: c.cx * CELL + CELL / 2, z: c.cy * CELL + CELL / 2 };
      expect(inRect(centre, FLOOR_RECT), `${c.cx},${c.cy} outside the room floor`).toBe(true);
    }
    // The west strip runs past the door, so a couple of the cells it covers are V1 '+' cells that were
    // already walkable. That is benign by construction — openedLayer only ever ORs into the static layer
    // — but the NET gain must still be real floor V1 had blocked.
    const gained = cells.filter((c) => !v1Static(c.cx, c.cy));
    expect(gained.length).toBeGreaterThanOrEqual(cells.length - 4);
    expect(gained.length).toBeGreaterThan(10);
    // the north lane is the headline correction: it must actually open cells
    const north = openedCells([NORTH_STRIP]);
    expect(north.length).toBeGreaterThanOrEqual(10);
    // v2Static only ever ADDS
    const layer = v2Static(v1Static, openedLayer(bands));
    for (let cy = 38; cy <= 53; cy++)
      for (let cx = 66; cx <= 89; cx++)
        if (v1Static(cx, cy)) expect(layer(cx, cy)).toBe(true);
  });

  it("declares no east band — nothing is opened underneath the nook furniture", () => {
    expect(EAST_X - NOOK.rug.x).toBeLessThan(60); // the nook does reach the east wall
    const nook: Rect = { x: NOOK.rug.x, z: NOOK.rug.z, w: NOOK.rug.w, d: NOOK.rug.d };
    for (const c of openedCells([NORTH_STRIP, WEST_STRIP])) {
      const centre = { x: c.cx * CELL + CELL / 2, z: c.cy * CELL + CELL / 2 };
      // the north lane legitimately clips the rug's top edge; no band may open the seating depth below it
      if (c.cy > 41) expect(inRect(centre, nook), `${c.cx},${c.cy} routes through the nook`).toBe(false);
    }
    for (const p of NOOK.poufs) {
      const c = worldToCell({ x: p.x, z: p.z });
      expect(openedCells([NORTH_STRIP, WEST_STRIP]).some((o) => o.cx === c.cx && o.cy === c.cy)).toBe(false);
    }
  });
});

describe("vo3d gaming room — build + lighting budget", () => {
  function built() {
    const world = new WorldState();
    world.addRoom(GAMING_ROOM);
  world.addRoom(CENTRAL_HUB);
  world.addRoom(EXECUTIVE_ROOM);
  world.addRoom(CMS_ROOM);
    for (const e of gamingRoomEntities()) world.addEntity(e);
    const scene = new THREE.Scene();
    const mirror = new SceneMirror(world, scene);
    mirror.buildRoom(GAMING_ROOM, { wallHeight: 46, frontWall: "low" });
    return mirror;
  }

  it("builds the room and a rebuild is byte-for-byte identical", () => {
    const mirror = built();
    const count = (o: THREE.Object3D) => {
      let m = 0, t = 0;
      o.traverse((c) => {
        const mm = c as THREE.Mesh;
        if (!mm.isMesh) return;
        m++;
        const idx = mm.geometry.getIndex();
        const n = idx ? idx.count / 3 : mm.geometry.getAttribute("position").count / 3;
        t += (mm as THREE.InstancedMesh).isInstancedMesh ? n * (mm as THREE.InstancedMesh).count : n;
      });
      return { m, t: Math.round(t) };
    };
    const a = count(mirror.root);
    expect(a.m).toBeGreaterThan(400);
    mirror.rebuildRoom(GAMING_ROOM, { wallHeight: 46, frontWall: "low" });
    expect(count(mirror.root)).toEqual(a);
  });

  it("spends a budgeted FOURTEEN ambient channels, and spends them on motion rather than count", () => {
    const mirror = built();
    // Nine → fourteen → nineteen → thirty-one, each step driven by watching the room rather than
    // measuring it. The last jump is the two rug borders becoming hero lights (core breath + aura
    // breath + two counter-travelling highlights each) and the four glyph halos that make the
    // PlayStation sequence read as lamps switching rather than outlines dimming. Material sharing
    // still does the heavy lifting: a pulse drives a MATERIAL, so a border's four bars cost one.
    expect(mirror.ambient.channelCount).toBe(31);
    // none of them is scanner-driven: this room has no blue→green state anywhere
    expect(mirror.ambient.scannerIds).toHaveLength(0);
    // and the MIX is the point — a room of nothing but pulses reads as static illumination blinking
    const kinds: Record<string, number> = {};
    mirror.root.traverse((o) => {
      const spec = o.userData.ambient as { kind: string } | undefined;
      if (spec) kinds[spec.kind] = (kinds[spec.kind] ?? 0) + 1;
    });
    expect(kinds.travel, "RGB must actually travel, not just brighten").toBeGreaterThanOrEqual(9);
    expect(kinds.fade, "halos and spills breathe with their own sources").toBeGreaterThanOrEqual(6);
    expect(kinds.blip).toBe(1);
  });

  it("times the room as a composition: perceptible, unhurried, and never in lockstep", () => {
    const mirror = built();
    const periods: number[] = [];
    mirror.root.traverse((o) => {
      const spec = o.userData.ambient as { kind: string; period: number; min?: number; max?: number } | undefined;
      if (!spec) return;
      periods.push(spec.period);
      // fast enough to notice inside a ten-second look, slow enough never to strobe
      expect(spec.period, `${spec.kind} period`).toBeGreaterThanOrEqual(3);
      expect(spec.period, `${spec.kind} period`).toBeLessThanOrEqual(9);
      // and a swing you can actually see: a 10% wobble is indistinguishable from static
      if (spec.kind === "pulse" && spec.min !== undefined && spec.max !== undefined)
        expect(spec.max / spec.min, "pulse depth").toBeGreaterThan(1.4);
    });
    // no two channels share a period exactly often enough to lock the room into one beat
    const spread = new Set(periods);
    expect(spread.size).toBeGreaterThanOrEqual(6);
  });

  it("holds no geometry inside the door lane and nothing floats above the wall head", () => {
    const mirror = built();
    const lane = new THREE.Box3(new THREE.Vector3(1113, 0.6, DOOR.z0 + 1), new THREE.Vector3(1123, 36, DOOR.z1 - 1));
    const box = new THREE.Box3();
    let intruders = 0, tallest = 0;
    mirror.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      box.setFromObject(m);
      if (box.max.y > tallest) tallest = box.max.y;
      // the door LEAF belongs in the lane — it is the door. Nothing else may be there.
      const isLeaf = m.parent?.name === DOOR_LEAF_ID || m.parent?.parent?.name === DOOR_LEAF_ID;
      if (!isLeaf && box.intersectsBox(lane)) intruders++;
    });
    expect(intruders).toBe(0);
    expect(tallest).toBeLessThanOrEqual(56); // wall head 46 + the headrest/lamp reach, nothing adrift
  });

  it("routes every customisable surface through the room THEME", () => {
    expect(Object.keys(THEME)).toEqual(expect.arrayContaining(["accent", "accentAlt", "ledHue"]));
    const e = gamingRoomEntities();
    const chair = e.find((x) => x.id.endsWith("gaming-chair-0"))!;
    expect(chair.props.accent).toBe(THEME.accent);
    expect(e.find((x) => x.id.endsWith("beanbag-west"))!.props.color).toBe(THEME.accent);
    expect(e.find((x) => x.id.endsWith("beanbag-east"))!.props.color).toBe(THEME.accentAlt);
    expect(e.find((x) => x.id.endsWith("rug-gamepad"))!.props.color).toBe(THEME.rug);
    expect(e.find((x) => x.id.endsWith("/sofa"))!.props.color).toBe(THEME.upholstery);
  });

  it("powers DOWN when the idle system is switched off, and back up again", () => {
    const mirror = built();
    expect(mirror.ambient.poweredCount).toBeGreaterThan(20); // glow planes, halos, static fixtures
    const room = mirror.root.getObjectByName(`room:${GAMING_ROOM_ID}`)!;
    const lit = (): number => {
      let sum = 0;
      room.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial & THREE.MeshBasicMaterial;
        if (!m) return;
        if (o.userData.powered || o.userData.ambient) sum += (m.emissiveIntensity ?? 0) + (m.transparent ? m.opacity : 0);
      });
      return sum;
    };
    mirror.ambient.update(0, 0.016);
    const on = lit();
    mirror.ambient.enabled = false;
    const off = lit();
    expect(off).toBeLessThan(on * 0.35); // an unmistakable difference, not a paused animation
    mirror.ambient.enabled = true;
    expect(lit()).toBeGreaterThan(off * 2);
  });
});

// ================= 5C =========================================================================

const BODY = 10.5;
/** the layer navigation actually uses here: the READ-ONLY V1 grid plus this room's two declared bands */
const walk = v2Static(v1Static, openedLayer([NORTH_STRIP, WEST_STRIP]));
const walkableAt = (p: Vec2): boolean => {
  const c = worldToCell(p);
  return walk(c.cx, c.cy);
};

describe("vo3d gaming room — 5C movable desk seating", () => {
  const ents = gamingRoomEntities();
  const chairs = GAMING_CHAIR_IDS.map((id) => ents.find((e) => e.id === id)!);

  it("gives all four stations a movable SeatCapability anchored on V1's own stand cells", () => {
    expect(chairs).toHaveLength(4);
    chairs.forEach((e, i) => {
      const sp = e.capabilities.seat!;
      expect(sp, `station ${i}`).toBeDefined();
      expect(e.capabilities.lounge, "a desk chair is never a fixed lounge seat").toBeUndefined();
      // the approach is V1's own 's' cell, one cell west of the seat's 'oo' pair
      expect(sp.approach).toEqual({ x: CHAIR_APPROACH_X[i], z: CHAIR_APPROACH_Z });
      expect(walkableAt(sp.approach), `station ${i} approach unreachable`).toBe(true);
      expect(v1Static(worldToCell(sp.approach).cx, worldToCell(sp.approach).cy)).toBe(true);
      expect(STATIONS[i] - sp.approach.x).toBe(24);
    });
  });

  it("pulls the chair visibly OFF the desk and still clears the sofa behind it", () => {
    const sp = chairs[1].capabilities.seat!;
    expect(sp.pullDir).toEqual({ x: 0, z: -1 }); // back into the room, away from the monitors
    expect(sp.pullDistance).toBeGreaterThanOrEqual(10); // a pull you can actually see
    expect(sp.pullDistance).toBeLessThan(CHAIR_SIZE / 2);
    // the sofa's south face: centre 747 with a 35-deep body turned a quarter
    const sofaSouth = SOFA.z + SOFA.w / 2;
    expect(CHAIR_BACK_AT_FULL_PULL).toBeGreaterThan(sofaSouth);
    expect(CHAIR_BACK_AT_FULL_PULL - sofaSouth).toBeLessThan(6); // and wastes no circulation doing it
    // the chair tucks back under the sitter rather than staying out in the lane
    expect(sp.seatedTuck).toBeGreaterThan(0);
    expect(sp.seatedTuck).toBeLessThan(sp.pullDistance);
  });

  it("seats the body ON the cushion the builder actually laid, and enters through the vacated gap", () => {
    const sp = chairs[0].capabilities.seat!;
    expect(sp.cushionTopY).toBe(GAMING_CHAIR.cushionTop); // derived, never typed twice
    expect(sp.seatedYaw).toBe(FACING_YAW.south); // the monitors are south of the chair
    // preSeat is between the pulled chair and the desk — the space the chair just left
    expect(sp.preSeat.z).toBeGreaterThan(CHAIR_Z);
    expect(sp.preSeat.z).toBeLessThan(DESK_RUN.z0);
    expect(sp.approachToSeat[sp.approachToSeat.length - 1]).toEqual(sp.preSeat);
    // every leg is a short step: no teleporting between waypoints
    let prev: Vec2 = sp.approach;
    for (const w of sp.approachToSeat) {
      expect(Math.hypot(w.x - prev.x, w.z - prev.z)).toBeLessThanOrEqual(32);
      prev = w;
    }
  });
});

describe("vo3d gaming room — 5C fixed lounge seating", () => {
  const ents = gamingRoomEntities();
  const sofa = ents.find((e) => e.id === SOFA_SEAT_ID)!;
  const bags = BAG_SEAT_IDS.map((id) => ents.find((e) => e.id === id)!);

  it("gives the sofa three places, one per cushion the builder lays", () => {
    const slots = sofa.capabilities.lounge!.slots;
    expect(slots).toHaveLength(3);
    expect(SOFA.seats).toBe(3);
    expect(sofa.props.seats).toBe(3);
    // contact z matches the mesh's own cushion centres, derived from the same exported helpers
    const cushD = sofaCushionDepth(SOFA.d, 3);
    slots.forEach((slot, i) => {
      expect(slot.contactLocal.z).toBeCloseTo(sofaCushionZ(i, 3, cushD), 6);
      expect(slot.contactLocal.y).toBe(SOFA_CUSHION_TOP); // ON the cushion, not inside it
      expect(slot.sink ?? 0).toBe(0); // a firm sofa does not swallow the sitter
      expect(slot.seatedYaw).toBe(FACING_YAW.north); // the sofa opens north, at the display
    });
    // the three places are spread across the seat, never stacked
    const zs = slots.map((s2) => s2.contactLocal.z).sort((a, b) => a - b);
    expect(zs[1] - zs[0]).toBeGreaterThan(20);
    expect(zs[2] - zs[1]).toBeGreaterThan(20);
    // and they stay inside the frame, between the two arms
    for (const z of zs) expect(Math.abs(z) + cushD / 2).toBeLessThanOrEqual(SOFA.d / 2 - 6.5);
  });

  it("seats bags and poufs ON the bag crown, with real compression", () => {
    expect(bags).toHaveLength(4);
    bags.forEach((e, i) => {
      const slots = e.capabilities.lounge!.slots;
      expect(slots).toHaveLength(1);
      const spec = BAG_SEATS[i];
      expect(slots[0].contactLocal.y).toBeCloseTo(bagCrown(spec.r), 6);
      expect(slots[0].sink).toBeGreaterThan(0); // a bag compresses; a bench does not
      expect(slots[0].sink!).toBeLessThan(spec.r * 0.25); // but never swallows him
      expect(e.capabilities.seat, "a bag never moves, so it is never a movable seat").toBeUndefined();
    });
  });

  it("leaves the nook FOOTSTOOL unseated — it is too small to be a valid slot", () => {
    const stool = ents.find((e) => e.id.endsWith("pouf-stool"))!;
    expect(stool).toBeDefined();
    expect(stool.capabilities.lounge).toBeUndefined();
    expect(NOOK.poufs[2].r).toBeLessThan(NOOK.poufs[1].r);
  });

  it("every lounge approach is reachable and every final step is a short one", () => {
    for (const e of [sofa, ...bags])
      for (const slot of e.capabilities.lounge!.slots) {
        expect(walkableAt(slot.approach), `${slot.id} approach unreachable`).toBe(true);
        let prev: Vec2 = slot.approach;
        for (const w of slot.approachToSeat) {
          expect(Math.hypot(w.x - prev.x, w.z - prev.z), `${slot.id} leg`).toBeLessThanOrEqual(40);
          prev = w;
        }
      }
  });

  it("no lounge approach stands inside the furniture it serves", () => {
    for (const b of BAG_SEATS) {
      const d = Math.hypot(b.stand.x - b.x, b.stand.z - b.z);
      expect(d, `${b.id} stand is inside the bag`).toBeGreaterThan(b.r + BODY * 0.5);
    }
  });
});

describe("vo3d gaming room — 5C walk-ups and the west entrance", () => {
  const ents = gamingRoomEntities();
  const anchors = [TV_APPROACH, DARTS_APPROACH, FRIDGE_APPROACH, POSTER_APPROACH];

  it("puts all four walk-up points on reachable, body-clear floor", () => {
    for (const a of anchors) {
      expect(walkableAt(a.point), `${a.label} unreachable`).toBe(true);
      expect(inRect(a.point, FLOOR_RECT), `${a.label} outside the room`).toBe(true);
      expect(a.action.length).toBeGreaterThan(0);
    }
    // they are distinct places, not four names for one spot
    const keys = new Set(anchors.map((a) => `${a.point.x},${a.point.z}`));
    expect(keys.size).toBe(4);
    for (const id of [TV_INTERACTION_ID, DARTS_INTERACTION_ID, FRIDGE_INTERACTION_ID, POSTER_INTERACTION_ID])
      expect(ents.find((e) => e.id === id)!.capabilities.approach).toBeDefined();
  });

  it("faces each anchor at the thing it is for", () => {
    expect(TV_APPROACH.yaw).toBe(FACING_YAW.north); // the display is on the north wall
    expect(DARTS_APPROACH.yaw).toBe(FACING_YAW.north);
    expect(POSTER_APPROACH.yaw).toBe(FACING_YAW.east); // the print is on the east wall
    expect(DARTS_APPROACH.point.z).toBeGreaterThan(NORTH_Z); // standing back from the board, not on it
  });

  it("fills the V1 door band when closed and parks entirely clear of it when open", () => {
    const leaf = ents.find((e) => e.id === DOOR_LEAF_ID)!;
    const d = leaf.capabilities.door!;
    expect(Number(leaf.props.leafW)).toBe(DOOR.z1 - DOOR.z0); // the leaf IS the opening
    expect(leaf.transform.pos.z).toBe((DOOR.z0 + DOOR.z1) / 2);
    expect(d.slideDistance).toBe(DOOR.z1 - DOOR.z0);
    const openZ = leaf.transform.pos.z + d.slide.z * d.slideDistance;
    expect(openZ - Number(leaf.props.leafW) / 2).toBeGreaterThanOrEqual(DOOR.z1); // fully out of the way
    // the declared clearance band is the V1 '+' cells verbatim, and nothing is subtracted from them
    expect(d.clearance.band).toEqual({ x: 69 * CELL, z: DOOR.z0, w: 2 * CELL, d: DOOR.z1 - DOOR.z0 });
    expect(d.clearance.solids).toEqual([]);
    for (const cx of [69, 70])
      for (const cy of [45, 46]) expect(v1Static(cx, cy), `door cell ${cx},${cy}`).toBe(true);
  });

  it("opens from BOTH sides and cannot trap a body in the doorway", () => {
    const d = ents.find((e) => e.id === DOOR_LEAF_ID)!.capabilities.door!;
    const hall: Vec2 = { x: 1096, z: 736 }; // V1's outside stand cell, col 68
    const room: Vec2 = { x: 1144, z: 736 }; // V1's inside stand cell, col 71
    for (const p of [hall, room]) expect(pointInRect(p, d.trigger), `trigger misses ${p.x}`).toBe(true);
    // a body standing in the doorway always holds it open
    const door = new SlidingDoor({ position: { x: 0, z: 0 } } as unknown as THREE.Object3D, d, { x: 0, z: 0 });
    expect(door.bodyInCrossing({ x: 1118, z: 736 })).toBe(true);
    expect(door.bodyInCrossing({ x: 1118, z: 700 })).toBe(false);
    expect(door.wantsOpen(hall, [room])).toBe(true); // a route from hall to room opens it
    expect(door.wantsOpen({ x: 1272, z: 700 }, [{ x: 1272, z: 780 }])).toBe(false); // crossing the room does not
  });
});

describe("vo3d gaming room — 5C corrections to the 5B bands", () => {
  it("no longer opens cells that lie inside the west-wall furniture", () => {
    for (const c of openedCells([NORTH_STRIP, WEST_STRIP])) {
      const p = { x: c.cx * CELL + CELL / 2, z: c.cy * CELL + CELL / 2 };
      for (const solid of [...NORTH_STRIP.solids, ...WEST_STRIP.solids])
        expect(inRect(p, solid), `${c.cx},${c.cy} is inside declared furniture`).toBe(false);
    }
    // and the specific cells 5B wrongly handed back are gone
    const opened = openedCells([NORTH_STRIP, WEST_STRIP]).map((c) => `${c.cx},${c.cy}`);
    for (const k of ["70,42", "70,43", "70,44"]) expect(opened).not.toContain(k);
  });
});
