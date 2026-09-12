import { describe, expect, it } from "vitest";
import { WorldState } from "./world/WorldState";
import { validatePlacement } from "./world/placement";
import { DESIGN_ROOM, DESIGN_SOLIDS, CHAIR_4_ID, HERO_PLANT_ID, designRoomEntities, RECT } from "./rooms/design-room";
import { v1RoomRect } from "./adapters/v1Manifest";
import { pointInRect } from "./core/coords";

function makeWorld(): WorldState {
  const w = new WorldState();
  w.addRoom(DESIGN_ROOM);
  for (const e of designRoomEntities()) w.addEntity(e);
  DESIGN_SOLIDS.forEach((r, i) => w.addEntity({ id: `${DESIGN_ROOM.id}/solid-${i}`, kind: "solid", roomId: DESIGN_ROOM.id, transform: { pos: { x: r.x + r.w / 2, z: r.z + r.d / 2 }, yaw: 0 }, footprint: { shape: "rect", w: r.w, d: r.d }, capabilities: {}, props: {} }));
  return w;
}

describe("vo3d world — Design Room in WORLD coordinates", () => {
  it("places the room at its V1 frame rect (no room-local origin) and every entity inside it", () => {
    expect(RECT).toEqual(v1RoomRect("design-room"));
    expect(RECT.x).toBeCloseTo(9.47, 2);
    expect(RECT.z).toBeCloseTo(316.19, 2);
    const w = makeWorld();
    const ents = w.inRoom(DESIGN_ROOM.id);
    expect(ents.filter((e) => e.kind !== "solid").length).toBe(22 + 11 + 1); // 22 manifest pieces + 11 plants + the east sliding door
    for (const e of ents) expect(pointInRect(e.transform.pos, RECT), e.id).toBe(true);
    // furniture footprints equal the manifest boxes, centred on the entity
    const chair = w.get(CHAIR_4_ID);
    expect(chair.footprint?.shape).toBe("rect");
    if (chair.footprint?.shape === "rect") { expect(chair.footprint.w).toBeCloseTo(18.47, 1); expect(chair.footprint.d).toBeCloseTo(20.77, 1); }
    expect(chair.transform.pos.x).toBeCloseTo(9.47 + 146.1 + 18.5 / 2, 0);
  });

  it("gives the chair a seat capability and the hero plant editable/navBlocker capabilities (composable, no union)", () => {
    const w = makeWorld();
    const seat = w.get(CHAIR_4_ID).capabilities.seat!;
    expect(seat.sitDepth).toBe(3.5);
    expect(seat.seatedTuck).toBe(7);
    expect(seat.approach).toEqual({ x: RECT.x + 174.5, z: RECT.z + 187.8 });
    const plant = w.get(HERO_PLANT_ID);
    expect(plant.capabilities).toEqual({ sway: true, editable: true, navBlocker: true });
    expect(plant.footprint).toEqual({ shape: "circle", r: 8 });
    expect(w.entities.values().next().value?.capabilities.seat).toBeUndefined();
  });

  it("commits transforms atomically with one version bump and one change event", () => {
    const w = makeWorld();
    const seen: string[][] = [];
    w.changes.on((c) => seen.push(c.changed));
    const v0 = w.version;
    w.commit((tx) => { tx.setTransform(HERO_PLANT_ID, { pos: { x: 280, z: 441 }, yaw: 0 }); });
    expect(w.version).toBe(v0 + 1);
    expect(seen).toEqual([[HERO_PLANT_ID]]);
    expect(w.get(HERO_PLANT_ID).transform.pos).toEqual({ x: 280, z: 441 });
  });

  it("validates placement from entity-owned rules: inside the floor, clear of solids", () => {
    const w = makeWorld();
    const plant = w.get(HERO_PLANT_ID);
    expect(validatePlacement(w, plant, { x: RECT.x - 5, z: RECT.z + 100 })).toMatchObject({ ok: false, reason: "outside-room" });
    expect(validatePlacement(w, plant, { x: RECT.x + 155, z: RECT.z + 105 })).toMatchObject({ ok: false, reason: "overlaps-furniture" }); // lead desk
    expect(validatePlacement(w, plant, { x: RECT.x + 270.5, z: RECT.z + 125 })).toEqual({ ok: true });
    expect(validatePlacement(w, w.get(CHAIR_4_ID), { x: RECT.x + 270.5, z: RECT.z + 125 })).toMatchObject({ ok: false, reason: "not-movable" });
  });
});
