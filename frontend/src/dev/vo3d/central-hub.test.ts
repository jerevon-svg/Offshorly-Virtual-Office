// Phase 6B — CENTRAL HUB. The room is a wall-less atrium whose one real correction is the medallion, so
// the tests concentrate there: every band must open ONLY physically empty floor, and the V1 grid must
// come out the other side untouched.
import { describe, expect, it } from "vitest";
import { EXECUTIVE_ROOM } from "./rooms/executive";
import { CMS_ROOM } from "./rooms/cms";
import { AI_ROOM } from "./rooms/ai";
import * as THREE from "three";
import manifest from "../../data/office-assets-manifest.json";
import { WorldState } from "./world/WorldState";
import { SceneMirror } from "./render/SceneMirror";
import { registerGroundFloor, RECONSTRUCTED_ROOM_IDS, groundFloor } from "./rooms/ground-floor";
import { DESIGN_ROOM, designRoomEntities } from "./rooms/design-room";
import { RECEPTION_ROOM } from "./rooms/reception";
import { MEETING_ROOM } from "./rooms/meeting";
import { PROJECT_ROOM } from "./rooms/project";
import { GAMING_ROOM } from "./rooms/gaming";
import {
  ARCS, CAFE_CHAIR_OFFSET, CAFE_COLS, CAFE_ROWS, CENTRAL_HUB, CENTRAL_HUB_ID, COUNTER, FLOOR_RECT, GAPS,
  ISLAND, MONUMENT, MONUMENT_FOOTPRINT, NORTH_CHAIRS, NOTCH, OPEN_BANDS, PLATE, RECT, SECTIONAL, SHELF_RUN,
  THEME, BOSS_SLOTS, bossSlotWorld, bossUrl, cafeSeats, cafeTables, centralHubEntities,
  BENCH_ENTITY_ID, BENCH_SEAT_R, BENCH_SEAT_Y, CAFE_CHAIR_IDS, CAFE_PULL,
  counterApproach, COUNTER_INTERACTION_ID, HUB_LOUNGE_IDS, monumentApproach, MONUMENT_INTERACTION_ID,
  shelfApproach, SHELF_INTERACTION_ID, TOUCAN_PERCH, benchSlotRefs, cafeChairId,
} from "./rooms/central-hub";
import { STATUE_YAW_OFFSET, applyBossStatue, replaceBossStatue } from "./build/hub-monument";
import { openedCells, openedLayer, v2Static } from "./nav/v2Open";
import { DerivedNav } from "./nav/derived";
import { Connectivity } from "./nav/connectivity";
import { NAV_RADIUS } from "./nav/clearance";
import { CELL, COLS, ROWS, cellCentre, v1Static, worldToCell } from "./adapters/v1Grid";
import { CAFE_CHAIR } from "./build/furniture";
import { pointInRect, type Rect, type Vec2 } from "./core/coords";
import { PALETTE } from "./render/Materials";
import { BON_STANDING_HEIGHT } from "./adapters/v1Avatar";

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
  world.addRoom(AI_ROOM);
  for (const e of designRoomEntities()) world.addEntity(e);
  for (const e of centralHubEntities()) world.addEntity(e);
  const plan = registerGroundFloor(world);
  return { world, plan };
}

/** compass bearing (0 = north) and radius of a point about the island centre */
function polarOf(p: Vec2): { deg: number; r: number } {
  const dx = p.x - ISLAND.centre.x, dz = p.z - ISLAND.centre.z;
  const deg = (((Math.atan2(dx, -dz) * 180) / Math.PI) % 360 + 360) % 360;
  return { deg, r: Math.hypot(dx, dz) };
}
/** is `deg` inside the arc span `s` (spans never wrap in ARCS) */
const inSpan = (deg: number, s: { from: number; to: number }) => deg >= s.from && deg <= s.to;

describe("central hub — provenance", () => {
  it("takes its rect from the READ-ONLY V1 manifest, unrounded", () => {
    const layer = (manifest as { id: string; kind: string; x: number; y: number; width: number; height: number }[])
      .find((l) => l.id === CENTRAL_HUB_ID && l.kind === "room")!;
    expect(RECT).toEqual({ x: layer.x, z: layer.y, w: layer.width, d: layer.height });
  });

  it("is reconstructed but still WALL-LESS, and has no door of any kind", () => {
    expect(RECONSTRUCTED_ROOM_IDS.has(CENTRAL_HUB_ID)).toBe(true);
    const room = groundFloor().rooms.find((r) => r.id === CENTRAL_HUB_ID)!;
    expect(room.reconstructed).toBe(true);
    expect(room.walls).toBe(false);
    expect(CENTRAL_HUB.shell).toBeUndefined();
    for (const e of centralHubEntities()) {
      expect(e.capabilities.door).toBeUndefined();
      expect(e.kind).not.toBe("sliding-door");
      expect(e.kind).not.toBe("glass-door-leaf");
    }
    // and the ground floor paints no door opening onto it
    expect(groundFloor().openings.some((o) => o.roomId === CENTRAL_HUB_ID)).toBe(false);
  });

  it("declares its walkable floor as the FULL rect, so no cell falls between it and the shared floor", () => {
    expect(FLOOR_RECT).toEqual(RECT);
    const { world } = rig();
    // the shared floor's hole is the rect shrunk by half a cell; every cell centre in the gap between the
    // two must still resolve to a walkable region
    for (const p of [
      { x: RECT.x + 4, z: RECT.z + RECT.d / 2 },
      { x: RECT.x + RECT.w - 4, z: RECT.z + RECT.d / 2 },
      { x: RECT.x + RECT.w / 2, z: RECT.z + 4 },
      { x: RECT.x + RECT.w / 2, z: RECT.z + RECT.d - 4 },
    ]) expect(world.walkableAt(p)).toBe(true);
  });

  it("keeps the plate and its notch inside the rect", () => {
    expect(PLATE.x).toBeGreaterThanOrEqual(RECT.x);
    expect(PLATE.x + PLATE.w).toBeLessThanOrEqual(RECT.x + RECT.w);
    expect(NOTCH.x0).toBeGreaterThan(PLATE.x);
    expect(NOTCH.x1).toBeLessThan(PLATE.x + PLATE.w);
    expect(NOTCH.z1).toBeGreaterThan(PLATE.z);
    // the notch lines up with the Executive room's south approach: V1's 'sss' stand cells, row 20 cols 44–46
    expect(Math.floor(NOTCH.x0 / CELL)).toBe(43);
    expect(Math.floor(NOTCH.x1 / CELL)).toBe(47);
  });
});

describe("central hub — the medallion correction", () => {
  const bandIds = OPEN_BANDS.map((b) => b.id);

  it("declares exactly the five approved bands", () => {
    expect(bandIds).toEqual(["hub-apron", "hub-apron-south", "hub-gap-north", "hub-gap-south", "hub-gap-west", "hub-gap-east"]);
  });

  it("opens ONLY floor with no bench over it", () => {
    const opened = openedCells(OPEN_BANDS);
    expect(opened.length).toBeGreaterThan(30);
    for (const c of opened) {
      const p = cellCentre(c);
      const { deg, r } = polarOf(p);
      if (r < ISLAND.rIn) continue; // inside the ring: open medallion floor
      expect(r).toBeGreaterThan(ISLAND.rIn - 0.001); // never under the annulus …
      for (const a of ARCS) expect(inSpan(deg, a.span)).toBe(false); // … unless it is in a GAP
    }
  });

  it("opens cells V1 blocks, and only inside the island's own bounding box", () => {
    const box: Rect = { x: ISLAND.centre.x - ISLAND.rOut, z: ISLAND.centre.z - ISLAND.rOut, w: ISLAND.rOut * 2, d: ISLAND.rOut * 2 };
    for (const c of openedCells(OPEN_BANDS)) {
      expect(v1Static(c.cx, c.cy)).toBe(false); // it is a correction, not a duplicate of the grid
      const p = cellCentre(c);
      // the south gap band runs a little past the ring into plain hall floor; everything else is in the box
      expect(pointInRect(p, { ...box, d: box.d + 40 })).toBe(true);
    }
  });

  it("never opens a cell under the counter, a café table, the shelf run or the north chairs", () => {
    const solids: Rect[] = [
      { x: COUNTER.x, z: COUNTER.z - 32, w: COUNTER.w, d: COUNTER.d + 96 },
      { x: SHELF_RUN.x, z: SHELF_RUN.z, w: SHELF_RUN.w, d: SHELF_RUN.d },
      ...cafeTables().map((t) => ({ x: t.x - 24, z: t.z - 24, w: 48, d: 48 })),
      ...NORTH_CHAIRS.map((c) => ({ x: c.x - 20, z: c.z - 20, w: 40, d: 40 })),
      { x: SECTIONAL.x - SECTIONAL.w / 2, z: SECTIONAL.z - SECTIONAL.d / 2, w: SECTIONAL.w, d: SECTIONAL.d },
    ];
    for (const c of openedCells(OPEN_BANDS)) {
      const p = cellCentre(c);
      for (const s of solids) expect(pointInRect(p, s)).toBe(false);
    }
  });

  it("BLOCKS the monument and leaves a complete walkable circuit around it", () => {
    // the centrepiece physically occupies the middle of the medallion, so nothing may open under it
    for (const c of openedCells(OPEN_BANDS)) expect(pointInRect(cellCentre(c), MONUMENT_FOOTPRINT)).toBe(false);
    // The apron wraps the monument: north and south walkways plus a full column down each side. ROW 34 IS
    // LOAD-BEARING — it is the only route out for the west and east bench gaps.
    const open = new Set(openedCells(OPEN_BANDS).map((c) => `${c.cx},${c.cy}`));
    for (const cx of [42, 43, 44, 45, 46, 47, 48]) expect(open.has(`${cx},34`), `north apron col ${cx}`).toBe(true);
    for (const cx of [42, 43, 44, 45, 46, 47]) expect(open.has(`${cx},39`), `south apron col ${cx}`).toBe(true);
    for (const cy of [34, 35, 36, 37, 38, 39]) expect(open.has(`42,${cy}`), `west apron row ${cy}`).toBe(true);
    for (const cy of [34, 35, 36, 37, 38]) expect(open.has(`48,${cy}`), `east apron row ${cy}`).toBe(true);
    // the SE corner cell sits UNDER the south-east bench (64.8 from centre) and must never open
    expect(open.has("48,39")).toBe(false);
    // the monument is inside the bench island, clear of the benches
    const corner = Math.hypot(MONUMENT.base / 2, MONUMENT.base / 2);
    expect(corner).toBeLessThan(ISLAND.rIn - 10);
    // it is a HERO, calibrated on the production capture: the bosses DWARF an employee …
    expect(MONUMENT.statueHeight / BON_STANDING_HEIGHT).toBeGreaterThan(1.8);
    // … and still stand ON the canvas, which is what caps them
    expect(MONUMENT.statueX + 0.19 * MONUMENT.statueHeight).toBeLessThan(MONUMENT.canvas / 2);
    expect(MONUMENT.centre).toEqual(ISLAND.centre);
    // the statues stand on the canvas, inside the posts
    expect(MONUMENT.statueX + 4).toBeLessThan(MONUMENT.post);
  });

  it("routes a walker around the monument and keeps it reachable from the open hall", () => {
    const { world } = rig();
    const open = openedLayer(OPEN_BANDS);
    const stat = (cx: number, cy: number) => v2Static(v1Static, open)(cx, cy) && world.walkableAt(cellCentre({ cx, cy }));
    const start = worldToCell({ x: 500, z: 790 }); // production's own "open corridor" anchor
    expect(stat(start.cx, start.cy)).toBe(true);
    // flood fill the whole floor and prove the medallion is in it
    const seen = new Set<string>();
    const q = [start];
    seen.add(`${start.cx},${start.cy}`);
    while (q.length) {
      const c = q.pop()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const n = { cx: c.cx + dx, cy: c.cy + dy };
        const k = `${n.cx},${n.cy}`;
        if (n.cx < 0 || n.cy < 0 || n.cx >= COLS || n.cy >= ROWS || seen.has(k) || !stat(n.cx, n.cy)) continue;
        seen.add(k);
        q.push(n);
      }
    }
    // the monument's own cell is BLOCKED (it is a solid object) …
    const centre = worldToCell(ISLAND.centre);
    expect(stat(centre.cx, centre.cy)).toBe(false);
    // … and the apron all round it is reachable from the hall, through the gaps between the benches
    // one sample on each side of the enlarged monument: west column, east column, north walk, south walk
    for (const p of [{ x: 680, z: 584 }, { x: 776, z: 584 }, { x: 728, z: 552 }, { x: 728, z: 632 }]) {
      const c = worldToCell(p);
      expect(stat(c.cx, c.cy), `apron ${p.x},${p.z}`).toBe(true);
      expect(seen.has(`${c.cx},${c.cy}`), `apron reachable ${p.x},${p.z}`).toBe(true);
    }
    // and at least one cell of every band came through
    for (const b of OPEN_BANDS) expect(openedCells([b]).some((c) => seen.has(`${c.cx},${c.cy}`))).toBe(true);
  });

  it("leaves the V1 grid itself untouched", () => {
    // the island's blocked mass is still blocked in the PRODUCTION layer; only the composed V2 layer differs
    for (const c of openedCells(OPEN_BANDS)) expect(v1Static(c.cx, c.cy)).toBe(false);
    const before = [];
    for (let cy = 0; cy < ROWS; cy++) for (let cx = 0; cx < COLS; cx++) before.push(v1Static(cx, cy) ? 1 : 0);
    openedLayer(OPEN_BANDS);
    let i = 0;
    for (let cy = 0; cy < ROWS; cy++) for (let cx = 0; cx < COLS; cx++) expect(v1Static(cx, cy) ? 1 : 0).toBe(before[i++]);
  });

  it("the four gaps between the arcs are real and consistent with the spans", () => {
    expect(GAPS).toHaveLength(4);
    for (const a of ARCS) {
      expect(a.cushion.from).toBeGreaterThanOrEqual(a.span.from);
      expect(a.cushion.to).toBeLessThanOrEqual(a.span.to);
      expect(a.planter.from).toBeGreaterThanOrEqual(a.span.from);
      expect(a.planter.to).toBeLessThanOrEqual(a.span.to);
      // cushion + planter tile the arc exactly, in either order
      expect(a.cushion.to === a.planter.from || a.planter.to === a.cushion.from).toBe(true);
    }
    // the source asymmetry survives: upper arcs bench-heavy, lower arcs planting-heavy
    const len = (s: { from: number; to: number }) => s.to - s.from;
    for (const a of ARCS) {
      const heavier = len(a.cushion) > len(a.planter);
      expect(heavier).toBe(!a.cove); // cove === the two LOWER arcs
    }
  });
});

describe("central hub — composition", () => {
  it("places 6 café tables and 24 chairs on the V1 grid's own block centres", () => {
    const tables = cafeTables();
    expect(tables).toHaveLength(6);
    for (const t of tables) {
      expect(CAFE_COLS).toContain(t.x);
      expect(CAFE_ROWS).toContain(t.z);
      expect(t.x % CELL).toBe(8); // a cell centre
    }
    const seats = cafeSeats();
    expect(seats).toHaveLength(24);
    for (const s of seats) expect(Math.hypot(s.x - tables[s.table].x, s.z - tables[s.table].z)).toBeCloseTo(CAFE_CHAIR_OFFSET, 6);
  });

  it("keeps every entity inside the room rect and gives each its own addressable id", () => {
    const es = centralHubEntities();
    const ids = new Set(es.map((e) => e.id));
    expect(ids.size).toBe(es.length);
    for (const e of es) {
      expect(e.roomId).toBe(CENTRAL_HUB_ID);
      expect(e.id.startsWith(`${CENTRAL_HUB_ID}/`)).toBe(true);
      expect(pointInRect(e.transform.pos, RECT)).toBe(true);
      // 6C: seating and walk-ups are capabilities on the SAME entities, never new geometry
      expect(e.capabilities.door).toBeUndefined();
      expect(e.capabilities.seat && e.capabilities.lounge, `${e.id} cannot be both movable and fixed`).toBeFalsy();
    }
    // every café chair is its own entity — 6C hangs a SeatCapability on each
    expect(es.filter((e) => e.kind === "cafe-chair")).toHaveLength(24);
    expect(es.filter((e) => e.kind === "cafe-table")).toHaveLength(6);
  });

  it("routes every colour through THEME, never a raw palette key", () => {
    const themed = new Set(Object.values(THEME));
    for (const e of centralHubEntities())
      for (const k of ["color", "colorSeat", "accent"] as const) {
        const v = e.props[k];
        if (v !== undefined) expect(themed.has(v as never)).toBe(true);
      }
    for (const v of Object.values(THEME)) expect(PALETTE[v as keyof typeof PALETTE]).toBeDefined();
  });

  it("builds without throwing and produces geometry inside the room", () => {
    const { world } = rig();
    const mirror = new SceneMirror(world, new THREE.Scene());
    mirror.buildRoom(CENTRAL_HUB, { wallHeight: 46, frontWall: "low", exterior: false });
    const g = mirror.root.getObjectByName(`room:${CENTRAL_HUB_ID}`)!;
    expect(g).toBeDefined();
    let meshes = 0;
    const box = new THREE.Box3();
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { meshes++; box.expandByObject(o); } });
    expect(meshes).toBeGreaterThan(40);
    // the hero centrepiece is present, with both boss anchors
    const mon = g.getObjectByName("hub-monument");
    expect(mon).toBeDefined();
    for (const slot of BOSS_SLOTS) expect(mon!.getObjectByName(slot.id), slot.id).toBeDefined();
    // nothing floats below the floor, and no MASS leaves the footprint. The margin is foliage: a large
    // plant standing in the counter's planter throws leaves a few units over the corridor, exactly as the
    // source draws it — that is canopy, not geometry in the wrong place.
    expect(box.min.y).toBeGreaterThan(-4);
    expect(box.min.x).toBeGreaterThan(RECT.x - 26);
    expect(box.max.x).toBeLessThan(RECT.x + RECT.w + 26);
    expect(box.min.z).toBeGreaterThan(RECT.z - 26);
    expect(box.max.z).toBeLessThan(RECT.z + RECT.d + 26);
    // Height guard. This room has no walls and no ceiling, so a misplaced piece has nothing to hide
    // behind — the bound catches floating/exploded geometry, not foliage: the tallest thing in the hub
    // is the library run (46) and the canopy of the shrub standing beside it.
    expect(box.max.y).toBeLessThan(MONUMENT.deckY + MONUMENT.statueHeight + 26); // the monument is now the tallest thing here
  });
});

describe("central hub — boss statue slots (TEMPORARY placeholders)", () => {
  function monument() {
    const { world } = rig();
    const mirror = new SceneMirror(world, new THREE.Scene());
    mirror.buildRoom(CENTRAL_HUB, { wallHeight: 46, frontWall: "low", exterior: false });
    return mirror.root.getObjectByName(`room:${CENTRAL_HUB_ID}`)!.getObjectByName("hub-monument")!;
  }

  it("declares two slots, facing each other on the deck, inside the ring posts", () => {
    expect(BOSS_SLOTS.map((s) => s.id)).toEqual(["boss-west", "boss-east"]);
    const [w, e] = BOSS_SLOTS;
    expect(w.x).toBe(-e.x);
    expect(w.yaw).toBeCloseTo(-e.yaw, 6);
    // authored facing local −z, so these yaws turn each figure at its opponent
    expect(w.yaw).toBeCloseTo(-Math.PI / 2, 6);
    for (const s of BOSS_SLOTS) {
      expect(Math.abs(s.x) + 4).toBeLessThan(MONUMENT.post); // clear of the corner posts
      expect(s.height).toBe(MONUMENT.statueHeight);
      expect(bossSlotWorld(s).z).toBe(MONUMENT.centre.z);
    }
    expect(BOSS_SLOTS.map((s) => s.hair)).toEqual(["wavy", "bald"]); // the two distinguishing bosses
    expect(BOSS_SLOTS.find((s) => s.glasses)!.id).toBe("boss-east");
  });

  it("puts each figure in its OWN anchor, never in the ring's baked geometry", () => {
    const mon = monument();
    for (const slot of BOSS_SLOTS) {
      const anchor = mon.getObjectByName(slot.id)!;
      expect(anchor).toBeDefined();
      expect(anchor.parent).toBe(mon); // a direct child of the monument, not of a baked mesh
      expect(anchor.position.x).toBe(slot.x);
      expect(anchor.position.y).toBe(MONUMENT.deckY); // standing ON the canvas
      expect(anchor.rotation.y).toBeCloseTo(slot.yaw, 6);
      expect(anchor.userData.bossSlot).toBe(slot.id);
      expect(anchor.userData.placeholder).toBe(true); // ⚠ still the temporary figure
      expect(anchor.children).toHaveLength(1);
      expect(anchor.children[0].name).toBe(`${slot.id}/placeholder`);
    }
    // removing both figures must leave the ring, posts, ropes and plaque completely intact
    const before = (): number => { let n = 0; mon.traverse((o) => { if ((o as THREE.Mesh).isMesh) n++; }); return n; };
    const all = before();
    for (const slot of BOSS_SLOTS) mon.remove(mon.getObjectByName(slot.id)!);
    const ringOnly = before();
    expect(ringOnly).toBeGreaterThan(3); // the ring survives on its own
    expect(ringOnly).toBeLessThan(all);
    expect(mon.getObjectByName("hub-monument-plaque")).toBeDefined();
  });

  it("resolves one sculpted GLB per slot, and half-turns it to the anchor's forward", () => {
    // the generator exports its subject facing +Z; the anchors are authored for the placeholder's −Z
    expect(STATUE_YAW_OFFSET).toBeCloseTo(Math.PI, 6);
    const urls = BOSS_SLOTS.map(bossUrl);
    expect(new Set(urls).size).toBe(BOSS_SLOTS.length); // one file each, never shared
    for (const u of urls) expect(u).toMatch(/vo3d\/boss-(west|east)\.glb$/);
  });

  it("seats a sculpted GLB in its anchor: normalised, centred, feet on the deck", () => {
    const mon = monument();
    for (const slot of BOSS_SLOTS) {
      // a stand-in for a generated statue: wrong scale, off-centre, floating
      const statue = new THREE.Group();
      statue.add(new THREE.Mesh(new THREE.BoxGeometry(40, 260, 40).translate(77, 400, -18)));
      applyBossStatue(mon, slot, statue);
      expect(statue.rotation.y).toBeCloseTo(STATUE_YAW_OFFSET, 6);
      const anchor = mon.getObjectByName(slot.id)!;
      expect(anchor.userData.placeholder).toBe(false);
      expect(anchor.children.map((c) => c.name)).toEqual([`${slot.id}/statue`]);
      const b = new THREE.Box3().setFromObject(statue);
      expect(b.max.y - b.min.y).toBeCloseTo(slot.height, 3); // normalised to the slot
      expect(b.min.y).toBeCloseTo(MONUMENT.deckY, 3); // standing ON the deck
      const w = bossSlotWorld(slot);
      expect((b.min.x + b.max.x) / 2).toBeCloseTo(w.x, 3); // centred on its anchor
      expect((b.min.z + b.max.z) / 2).toBeCloseTo(w.z, 3);
      // and it fits inside the ropes
      expect(Math.max(b.max.x - w.x, w.x - b.min.x)).toBeLessThan(MONUMENT.post);
    }
  });

  it("swaps a slot for a sculpted statue without rebuilding the ring", () => {
    const mon = monument();
    // every mesh that is NOT inside a boss anchor — i.e. the plinth, base, canvas, posts, ropes and plaque
    const inAnchor = (o: THREE.Object3D): boolean => { for (let p: THREE.Object3D | null = o; p && p !== mon; p = p.parent) if (p.userData.bossSlot) return true; return false; };
    const ringMeshes = (): string[] => { const out: string[] = []; mon.traverse((o) => { if ((o as THREE.Mesh).isMesh && !inAnchor(o)) out.push(o.uuid); }); return out; };
    const before = ringMeshes();

    // a stand-in for a loaded GLB, deliberately the wrong size and sitting off the origin
    const glb = new THREE.Group();
    glb.add(new THREE.Mesh(new THREE.BoxGeometry(30, 300, 30).translate(0, 40, 0))); // 300 tall, feet at −110
    const slot = BOSS_SLOTS[0];
    const anchor = replaceBossStatue(mon, slot, glb);

    expect(anchor.children).toHaveLength(1);
    expect(anchor.children[0].name).toBe(`${slot.id}/statue`);
    expect(anchor.userData.placeholder).toBe(false);
    expect(anchor.position.x).toBe(slot.x); // transform untouched by the swap
    expect(anchor.rotation.y).toBeCloseTo(slot.yaw, 6);
    // normalised to the slot height and stood ON the deck, whatever units or origin the GLB arrived with
    const box = new THREE.Box3().setFromObject(glb);
    expect(box.max.y - box.min.y).toBeCloseTo(slot.height, 4);
    expect(box.min.y).toBeCloseTo(MONUMENT.deckY, 4);
    // and every piece of ring geometry is the same object it was — nothing was rebuilt
    expect(ringMeshes()).toEqual(before);
    expect(before.length).toBeGreaterThan(3);
  });
});


describe("central hub — 6C interactions", () => {
  /** Every cell reachable from production's own open-corridor anchor, on the layer the hub ACTUALLY runs.
   *
   *  7B: the hub is a DERIVED room now — inside it, walkability is geometry (floor − arcs − furniture −
   *  planters − monument) judged at NAV_RADIUS, not the V1 grid. Outside it, the V1 grid + this room's
   *  OpenBands, exactly as before. Reachability is what it always was: a 4-connected flood from the hall. */
  function reachable() {
    const { world } = rig();
    const derived = new DerivedNav(world, { roomIds: new Set([CENTRAL_HUB_ID]) });
    const fallback = (cx: number, cy: number) => v2Static(v1Static, openedLayer(OPEN_BANDS))(cx, cy) && world.walkableAt(cellCentre({ cx, cy }));
    // the EDGE test matters: derived stand points move within their cells, so a step between two walkable
    // cells is not automatically walkable. Omitting it here would make the test more permissive than the
    // layer it is testing.
    const connected = new Connectivity(derived.predicate(NAV_RADIUS, fallback), undefined, derived.edge(NAV_RADIUS));
    return (p: Vec2) => connected.at(p);
  }

  it("gives all 24 café chairs a MOVABLE seat, each individually reachable", () => {
    const es = centralHubEntities();
    const chairs = es.filter((e) => e.kind === "cafe-chair");
    expect(chairs).toHaveLength(24);
    expect(new Set(CAFE_CHAIR_IDS).size).toBe(24);
    const canReach = reachable();
    for (const ref of cafeSeats()) {
      const e = es.find((x) => x.id === cafeChairId(ref.table, ref.side))!;
      const seat = e.capabilities.seat;
      expect(seat, e.id).toBeDefined();
      expect(e.capabilities.lounge, `${e.id} must not be both movable and fixed`).toBeUndefined();
      expect(canReach(seat!.approach), `${e.id} approach unreachable`).toBe(true);
      // the chair pulls AWAY from its table, and far enough to open a real gap to step into
      const t = cafeTables()[ref.table];
      const away = { x: ref.x - t.x, z: ref.z - t.z };
      expect(seat!.pullDir.x * away.x + seat!.pullDir.z * away.z).toBeGreaterThan(0);
      const gap = CAFE_CHAIR_OFFSET + CAFE_PULL - 7.5 - 16.5; // pulled front edge − table edge
      expect(gap).toBeGreaterThanOrEqual(10);
      // the sitter faces the table
      const faceX = Math.sin(seat!.seatedYaw), faceZ = Math.cos(seat!.seatedYaw);
      const m = Math.hypot(away.x, away.z);
      expect(faceX * (-away.x / m) + faceZ * (-away.z / m)).toBeGreaterThan(0.99);
      expect(seat!.cushionTopY).toBe(CAFE_CHAIR.cushionTop);
    }
  });

  it("seats the four curved benches only on their cushioned lengths", () => {
    const refs = benchSlotRefs();
    expect(refs.length).toBeGreaterThanOrEqual(4);
    for (const r of refs) {
      const arc = ARCS.find((a) => a.id === r.arc)!;
      expect(r.deg, `${r.arc} slot outside its cushion`).toBeGreaterThanOrEqual(arc.cushion.from);
      expect(r.deg).toBeLessThanOrEqual(arc.cushion.to);
      // never in the planting bed
      expect(r.deg >= arc.planter.from && r.deg <= arc.planter.to).toBe(false);
      const rad = Math.hypot(r.x - ISLAND.centre.x, r.z - ISLAND.centre.z);
      expect(rad).toBeCloseTo(BENCH_SEAT_R, 6);
      expect(rad).toBeGreaterThan(ISLAND.rIn);
      expect(rad).toBeLessThan(ISLAND.rOut);
      // sits facing the monument
      const inward = Math.atan2(ISLAND.centre.x - r.x, ISLAND.centre.z - r.z);
      expect(Math.abs(Math.atan2(Math.sin(r.seatedYaw - inward), Math.cos(r.seatedYaw - inward)))).toBeLessThan(1e-6);
    }
    const bench = centralHubEntities().find((e) => e.id === BENCH_ENTITY_ID)!;
    expect(bench.capabilities.lounge!.slots).toHaveLength(refs.length);
    const canReach = reachable();
    for (const s of bench.capabilities.lounge!.slots) {
      expect(canReach(s.approach), `${s.id} approach unreachable`).toBe(true);
      expect(s.contactLocal.y).toBe(BENCH_SEAT_Y);
    }
  });

  it("wires only real lounge furniture, all reachable, none movable", () => {
    const es = centralHubEntities();
    const canReach = reachable();
    let slots = 0;
    for (const id of HUB_LOUNGE_IDS) {
      const e = es.find((x) => x.id === id);
      expect(e, id).toBeDefined();
      expect(e!.capabilities.lounge, id).toBeDefined();
      expect(e!.capabilities.seat, `${id} is FIXED furniture and must never be movable`).toBeUndefined();
      for (const s of e!.capabilities.lounge!.slots) {
        slots++;
        expect(canReach(s.approach), `${id}/${s.id} approach unreachable`).toBe(true);
      }
    }
    expect(slots).toBeGreaterThanOrEqual(14);
    // decorative pieces are NOT seating
    for (const kind of ["round-table", "cafe-table", "plant"]) {
      for (const e of es.filter((x) => x.kind === kind)) {
        expect(e.capabilities.lounge, `${e.id} is decor`).toBeUndefined();
        expect(e.capabilities.seat, `${e.id} is decor`).toBeUndefined();
      }
    }
  });

  it("adds three reachable walk-up points and no product behaviour", () => {
    const es = centralHubEntities();
    const canReach = reachable();
    for (const [id, spec] of [[COUNTER_INTERACTION_ID, counterApproach()], [SHELF_INTERACTION_ID, shelfApproach()], [MONUMENT_INTERACTION_ID, monumentApproach()]] as const) {
      const e = es.find((x) => x.id === id);
      expect(e, id).toBeDefined();
      expect(e!.capabilities.approach!.label).toBe(spec.label);
      expect(canReach(spec.point), `${id} unreachable`).toBe(true);
      expect(pointInRect(spec.point, RECT), `${id} outside the hub`).toBe(true);
    }
    // 6C adds anchors only: still no door anywhere in this room
    for (const e of es) expect(e.capabilities.door).toBeUndefined();
  });

  it("moves the Toucan perch off the monument", () => {
    expect(pointInRect({ x: TOUCAN_PERCH.x, z: TOUCAN_PERCH.z }, MONUMENT_FOOTPRINT)).toBe(false);
    // the legacy V1 coordinate is now inside the ring — that is why it moved
    expect(pointInRect({ x: 727, z: 556 }, MONUMENT_FOOTPRINT)).toBe(true);
    // it perches on real bench geometry, which is already blocked, so it cannot block circulation
    const r = Math.hypot(TOUCAN_PERCH.x - ISLAND.centre.x, TOUCAN_PERCH.z - ISLAND.centre.z);
    expect(r).toBeGreaterThan(ISLAND.rIn);
    expect(r).toBeLessThan(ISLAND.rOut);
    expect(TOUCAN_PERCH.y).toBe(ISLAND.rimH);
    expect(pointInRect({ x: TOUCAN_PERCH.x, z: TOUCAN_PERCH.z }, RECT)).toBe(true);
  });

  it("leaves circulation intact: monument blocked, north/south gaps and their aprons reachable", () => {
    const canReach = reachable();
    const { world } = rig();
    const open = openedLayer(OPEN_BANDS);
    const walk = (p: Vec2) => { const c = worldToCell(p); return v2Static(v1Static, open)(c.cx, c.cy) && world.walkableAt(p); };
    expect(walk(ISLAND.centre)).toBe(false); // the monument still blocks
    // the two AXIAL passages and the apron strips they lead into
    for (const p of [{ x: 728, z: 552 }, { x: 728, z: 632 }]) expect(canReach(p), `apron ${p.x},${p.z}`).toBe(true);
    for (const p of [{ x: 728, z: 504 }, { x: 728, z: 712 }]) expect(canReach(p), `gap ${p.x},${p.z}`).toBe(true);
  });

  /** 7B FINDING — recorded as a test so it cannot quietly change.
   *
   *  6A/6B declared the apron and all four bench gaps walkable, and at the granularity available then that
   *  was the right call: OpenBands judge a CELL CENTRE against a solid, exactly as the V1 grid does, with no
   *  body width in the question at all. Derived navigation asks the harder question — does Bon FIT — and the
   *  answer for the east and west halves of the ring is no:
   *
   *    • WEST. The monument's base is a 72-unit SQUARE on a 64-unit-radius inner disc, so its corners sit
   *      only ~13 units from the bench's inner face. The widest way out of the west pocket clears 2.6 units;
   *      routing needs NAV_RADIUS.
   *    • EAST. The sectional's west face stands at x 820 and the bench ring's outer edge at x 816.5 — a
   *      3.5-unit slot. The east pocket's widest exit clears 4.0 units.
   *
   *  Both are REAL geometry, not a footprint bug, and neither is this phase's to fix: changing them means
   *  moving the monument or the sectional, which is a composition decision. Until then the west and east
   *  bench gaps are ornamental, the ring is walkable as two separate north/south aprons, and the hub's own
   *  OpenBands over-declare those cells — which is precisely what the diagnostic's v2-obstruction bucket is
   *  for. Nothing in the room depends on them: all 24 café places and all 16 lounge slots reach their seats. */
  it("FINDING: the east and west bench gaps are sealed at body width, and nothing depends on them", () => {
    const canReach = reachable();
    for (const p of [{ x: 680, z: 584 }, { x: 648, z: 600 }]) expect(canReach(p), `west pocket ${p.x},${p.z}`).toBe(false);
    for (const p of [{ x: 776, z: 584 }, { x: 808, z: 600 }]) expect(canReach(p), `east pocket ${p.x},${p.z}`).toBe(false);
    // the cells are genuinely OPEN FLOOR — they are unreachable, not occupied. That distinction is the
    // whole finding: a body fits there, it just cannot get there.
    const { world } = rig();
    const derived = new DerivedNav(world, { roomIds: new Set([CENTRAL_HUB_ID]) });
    for (const p of [{ x: 680, z: 584 }, { x: 776, z: 584 }, { x: 648, z: 600 }, { x: 808, z: 600 }]) {
      const c = worldToCell(p);
      expect(derived.clear(c.cx, c.cy, NAV_RADIUS), `${p.x},${p.z} should be open floor`).toBe(true);
    }
  });
});
