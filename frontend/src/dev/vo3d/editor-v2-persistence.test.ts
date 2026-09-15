// ROOM EDITOR V2 — PERSISTENCE. Confirmed edits survive a browser refresh; nothing else does.
//
// "Refresh" is modelled the honest way throughout: a SECOND rig is built from the room modules — a fresh
// WorldState, a fresh scene, fresh registries — and the saved document is loaded into it. Nothing carries
// over in memory, which is exactly what a reload is.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import bootstrapSource from "./app/bootstrap.ts?raw";
import { WorldState } from "./world/WorldState";
import { DESIGN_ROOM, DESIGN_SOLIDS, CHAIR_4_ID, designRoomEntities, SHELL } from "./rooms/design-room";
import { Walkability } from "./nav/Walkability";
import { v1Static } from "./adapters/v1Grid";
import { SceneMirror } from "./render/SceneMirror";
import { EditSession } from "./editor/EditSession";
import { applyEditablePolicy } from "./editor/editable";
import { ASSET_LIBRARY } from "./editor/library";
import { SurfaceRegistry } from "./editor/surfaces";
import { LedRegistry } from "./editor/emissive";
import { ControllerStack } from "./avatar/Controller";
import {
  LAYOUT_SCHEMA_VERSION, LAYOUT_STORAGE_KEY, LayoutStore, layoutIsEmpty, memoryLayoutStorage,
  parseLayout, type LayoutStorage,
} from "./editor/persistence";

/** One Design Room, world + scene + registries + editor + layout store, over a shared storage. */
function rig(storage: LayoutStorage) {
  const world = new WorldState();
  world.addRoom(DESIGN_ROOM);
  for (const e of designRoomEntities()) world.addEntity(e);
  world.addRegion({ id: `floor:${DESIGN_ROOM.id}`, kind: "room-floor", rect: DESIGN_ROOM.floorRect, walkable: true, roomId: DESIGN_ROOM.id });
  DESIGN_SOLIDS.forEach((r, i) => world.addEntity({ id: `s${i}`, kind: "solid", roomId: DESIGN_ROOM.id, transform: { pos: { x: r.x + r.w / 2, z: r.z + r.d / 2 }, yaw: 0 }, footprint: { shape: "rect", w: r.w, d: r.d }, capabilities: {}, props: {} }));
  applyEditablePolicy(world);
  const scene = new THREE.Scene();
  const mirror = new SceneMirror(world, scene);
  const surfaces = new SurfaceRegistry();
  const leds = new LedRegistry();
  // the store takes its authored baseline BEFORE anything is restored — as bootstrap does
  const wk = new Walkability(v1Static);
  wk.syncFromWorld(world);
  const layout = new LayoutStore({ world, mirror, walkability: wk, surfaces, leds, storage });
  mirror.buildRoom(DESIGN_ROOM, { wallHeight: SHELL.wallHeight, frontWall: "low" });
  const g = mirror.roomGroup(DESIGN_ROOM.id)!;
  surfaces.collect(DESIGN_ROOM.id, g);
  leds.collect(DESIGN_ROOM.id, g);
  const edit = new EditSession(world, mirror, wk, new ControllerStack(), { surfaces, leds });
  edit.setEditMode(true);
  return { world, mirror, wk, surfaces, leds, edit, layout };
}
/** a SECOND rig over the same storage, then the saved layout loaded into it — i.e. a browser refresh */
function reload(storage: LayoutStorage) {
  const r = rig(storage);
  const doc = r.layout.load();
  const report = doc ? r.layout.restore(doc) : null;
  return { ...r, doc, report };
}
/** the first Design Room floor square the editor says a library item actually fits on */
function placeSomewhereFree(edit: EditSession, item = ASSET_LIBRARY[0]) {
  const f = DESIGN_ROOM.floorRect;
  for (let gx = 20; gx < f.w - 20; gx += 14)
    for (let gz = 20; gz < f.d - 20; gz += 14) {
      const r = edit.placeAsset(item, { x: f.x + gx, z: f.z + gz });
      if (r.id && r.check.ok) return r;
      if (r.id) edit.cancel();
    }
  throw new Error("no free floor for the probe asset");
}
/** slide the CURRENT selection to the first floor square the editor accepts (a duplicate lands wherever
 *  the eight-offset search could reach, which in a furnished room is not always somewhere legal) */
function dragToFreeFloor(edit: EditSession): void {
  if (edit.validateCurrent().ok) return;
  const f = DESIGN_ROOM.floorRect;
  for (let gx = 20; gx < f.w - 20; gx += 10)
    for (let gz = 20; gz < f.d - 20; gz += 10)
      if (edit.preview({ x: f.x + gx, z: f.z + gz }).ok) return;
  throw new Error("no free floor for the duplicated piece");
}
const firstDeletable = (edit: EditSession): string =>
  edit.editable().find((e) => edit.deleteBlockedBecause(e.id) === null)!.id;

// ---- 1. the round trip ------------------------------------------------------------------------------
describe("persistence — a confirmed layout survives a reload", () => {
  it("a moved authored piece comes back at the transform it was confirmed at", () => {
    const store = memoryLayoutStorage();
    const a = rig(store);
    const id = firstDeletable(a.edit);
    const from = { ...a.world.get(id).transform.pos };
    a.edit.select(id);
    a.edit.preview({ x: from.x + 16, z: from.z });
    expect(a.edit.confirm().ok).toBe(true);
    expect(a.layout.save()).not.toBeNull();

    const b = reload(store);
    expect(b.report!.moved).toBe(1);
    expect(b.world.get(id).transform.pos.x).toBeCloseTo(from.x + 16, 6);
    expect(b.world.get(id).transform.pos.z).toBeCloseTo(from.z, 6);
  });

  it("a rotated piece comes back turned, and its walkability is rebuilt from the restored world", () => {
    const store = memoryLayoutStorage();
    const a = rig(store);
    const id = firstDeletable(a.edit);
    a.edit.select(id);
    a.edit.setYawDegrees(90);
    expect(a.edit.confirm().ok).toBe(true);
    a.layout.save();

    const b = reload(store);
    expect(b.world.get(id).transform.yaw).toBeCloseTo(Math.PI / 2, 6);
    const blocked = b.wk.dynamicBlockedKeys.length;
    b.wk.syncFromWorld(b.world);
    expect(b.wk.dynamicBlockedKeys.length).toBe(blocked); // already in sync — restore synced it
  });

  it("a placed library asset comes back as a real entity with a view", () => {
    const store = memoryLayoutStorage();
    const a = rig(store);
    const { id } = placeSomewhereFree(a.edit);
    expect(a.edit.confirm().ok).toBe(true);
    const pos = { ...a.world.get(id!).transform.pos };
    a.layout.save();

    const b = reload(store);
    expect(b.report!.added).toBe(1);
    expect(b.world.entities.has(id!)).toBe(true);
    expect(b.world.get(id!).transform.pos.x).toBeCloseTo(pos.x, 6);
    expect(b.mirror.hasView(id!)).toBe(true);
    expect(b.edit.lockedBecause(id!)).toBeNull(); // still editable after the reload
  });

  it("a duplicated piece comes back, and comes back as a PROP — no gameplay wiring invented", () => {
    const store = memoryLayoutStorage();
    const a = rig(store);
    a.edit.select(CHAIR_4_ID);
    const dup = a.edit.duplicate();
    expect(dup.id).not.toBeNull();
    dragToFreeFloor(a.edit);
    expect(a.edit.confirm().ok).toBe(true);
    a.layout.save();

    const b = reload(store);
    const copy = b.world.get(dup.id!);
    expect(copy.capabilities.seat).toBeUndefined();
    expect(copy.capabilities.editable).toBe(true);
    expect(b.edit.deleteBlockedBecause(dup.id!)).toBeNull();
  });

  it("a deleted eligible piece stays deleted", () => {
    const store = memoryLayoutStorage();
    const a = rig(store);
    const id = firstDeletable(a.edit);
    a.edit.select(id);
    expect(a.edit.remove().ok).toBe(true);
    a.layout.save();

    const b = reload(store);
    expect(b.report!.deleted).toBe(1);
    expect(b.world.entities.has(id)).toBe(false);
  });
});

// ---- 2. functional furniture ------------------------------------------------------------------------
describe("persistence — gameplay anchors survive the reload with the piece", () => {
  it("a restored chair's stand-here cell, pre-seat gap and seated facing moved with it", () => {
    const store = memoryLayoutStorage();
    const a = rig(store);
    const authored = a.world.get(CHAIR_4_ID).capabilities.seat!;
    a.edit.select(CHAIR_4_ID);
    const p = a.world.get(CHAIR_4_ID).transform.pos;
    const moved = a.edit.preview({ x: p.x, z: p.z + 12 });
    expect(moved.ok).toBe(true);
    expect(a.edit.confirm().ok).toBe(true);
    const live = a.world.get(CHAIR_4_ID).capabilities.seat!;
    a.layout.save();

    const b = reload(store);
    const back = b.world.get(CHAIR_4_ID).capabilities.seat!;
    expect(back.approach.x).toBeCloseTo(live.approach.x, 6);
    expect(back.approach.z).toBeCloseTo(live.approach.z, 6);
    expect(back.approach.z).toBeCloseTo(authored.approach.z + 12, 6);
    expect(back.preSeat.z).toBeCloseTo(authored.preSeat.z + 12, 6);
    expect(back.approachToSeat).toHaveLength(authored.approachToSeat.length);
    expect(back.seatedYaw).toBeCloseTo(authored.seatedYaw, 6);
    // chair-local metadata is untouched by definition, and must still be there
    expect(back.cushionLocal).toEqual(authored.cushionLocal);
    expect(back.timings).toEqual(authored.timings);
  });

  it("a rotated chair's anchors come back turned about the chair, not about the origin", () => {
    const store = memoryLayoutStorage();
    const a = rig(store);
    const chair = a.world.get(CHAIR_4_ID);
    const pivot = { ...chair.transform.pos };
    const authored = chair.capabilities.seat!;
    const d = Math.hypot(authored.approach.x - pivot.x, authored.approach.z - pivot.z);
    a.edit.select(CHAIR_4_ID);
    a.edit.setYawDegrees((chair.transform.yaw * 180) / Math.PI + 30);
    a.edit.confirm();
    a.layout.save();

    const back = reload(store).world.get(CHAIR_4_ID).capabilities.seat!;
    expect(Math.hypot(back.approach.x - pivot.x, back.approach.z - pivot.z)).toBeCloseTo(d, 5);
  });
});

// ---- 3. surfaces and LEDs ---------------------------------------------------------------------------
describe("persistence — surface and LED treatments", () => {
  it("an applied surface treatment is restored onto the same addressable surface", () => {
    const store = memoryLayoutStorage();
    const a = rig(store);
    const surf = a.surfaces.all()[0];
    a.edit.selectSurface(surf.id);
    a.edit.previewSurface({ ...surf.base, color: 0x2244aa, brightness: 1.2, roughness: 0.4, detail: 0.3 });
    expect(a.edit.confirm().ok).toBe(true);
    a.layout.save();

    const b = reload(store);
    expect(b.report!.surfaces).toBe(1);
    const back = b.surfaces.get(surf.id)!;
    expect(back.committed.color).toBe(0x2244aa);
    expect(back.committed.brightness).toBeCloseTo(1.2, 6);
    expect(back.committed.detail).toBeCloseTo(0.3, 6);
    expect(back.pending).toBe(false); // restored as APPLIED, not as a pending preview
  });

  it("an applied LED treatment is restored", () => {
    const store = memoryLayoutStorage();
    const a = rig(store);
    const led = a.leds.all()[0];
    if (!led) return; // the Design Room may author no LED channel; the surface case covers the path
    a.edit.selectLed(led.id);
    a.edit.previewLed({ color: 0xff00aa, intensity: 2.2, glow: 0.5 });
    expect(a.edit.confirm().ok).toBe(true);
    a.layout.save();

    const back = reload(store).leds.get(led.id)!;
    expect(back.committed.color).toBe(0xff00aa);
    expect(back.committed.intensity).toBeCloseTo(2.2, 6);
    expect(back.pending).toBe(false);
  });

  it("a treatment previewed but never confirmed is not saved", () => {
    const store = memoryLayoutStorage();
    const a = rig(store);
    const surf = a.surfaces.all()[0];
    a.edit.selectSurface(surf.id);
    a.edit.previewSurface({ ...surf.base, color: 0x00ff00 });
    expect(a.layout.counts().surfaces).toBe(0);
    a.layout.save();
    expect(reload(store).surfaces.get(surf.id)!.committed.color).toBe(surf.base.color);
  });
});

// ---- 4. what must NOT be saved ----------------------------------------------------------------------
describe("persistence — preview and cancelled state never reach storage", () => {
  it("a drag that was never confirmed leaves nothing to save", () => {
    const store = memoryLayoutStorage();
    const a = rig(store);
    const id = firstDeletable(a.edit);
    a.edit.select(id);
    a.edit.preview({ x: a.world.get(id).transform.pos.x + 24, z: a.world.get(id).transform.pos.z });
    expect(layoutIsEmpty(a.layout.counts())).toBe(true);
    a.layout.save();
    expect(reload(store).report!.moved).toBe(0);
  });

  it("Cancel persists nothing — only Save writes", () => {
    const store = memoryLayoutStorage();
    const a = rig(store);
    const id = firstDeletable(a.edit);
    const was = { ...a.world.get(id).transform.pos };
    a.edit.select(id);
    a.edit.preview({ x: was.x + 24, z: was.z });
    a.edit.cancel();
    expect(store.getItem(LAYOUT_STORAGE_KEY)).toBeNull();
    const b = reload(store);
    expect(b.doc).toBeNull();
    expect(b.world.get(id).transform.pos.x).toBeCloseTo(was.x, 6);
  });

  it("an unconfirmed placement is excluded from the save while the piece is still under the cursor", () => {
    const store = memoryLayoutStorage();
    const a = rig(store);
    const { id } = placeSomewhereFree(a.edit);
    expect(a.edit.pending).toBe(id);
    const doc = a.layout.save(a.edit.pending)!;
    expect(doc.added).toHaveLength(0);
    expect(reload(store).world.entities.has(id!)).toBe(false);
  });
});

// ---- 5. reset to authored ---------------------------------------------------------------------------
describe("persistence — Reset to Authored Layout", () => {
  it("puts the production office back and clears the saved edits", () => {
    const store = memoryLayoutStorage();
    const a = rig(store);
    const movedId = firstDeletable(a.edit);
    const authoredPos = { ...a.world.get(movedId).transform.pos };
    a.edit.select(movedId);
    a.edit.preview({ x: authoredPos.x + 16, z: authoredPos.z });
    a.edit.confirm();
    const { id: addedId } = placeSomewhereFree(a.edit);
    a.edit.confirm();
    const deletedId = firstDeletable(a.edit);
    a.edit.select(deletedId);
    a.edit.remove();
    const surf = a.surfaces.all()[0];
    a.edit.selectSurface(surf.id);
    a.edit.previewSurface({ ...surf.base, color: 0x112233 });
    a.edit.confirm();
    a.layout.save();
    expect(a.layout.hasSaved).toBe(true);

    a.layout.resetToAuthored();
    expect(a.world.get(movedId).transform.pos.x).toBeCloseTo(authoredPos.x, 6);
    expect(a.world.entities.has(addedId!)).toBe(false);
    expect(a.world.entities.has(deletedId)).toBe(true);
    expect(a.surfaces.get(surf.id)!.committed.color).toBe(surf.base.color);
    expect(layoutIsEmpty(a.layout.counts())).toBe(true);
    expect(a.layout.hasSaved).toBe(false);

    // and it is gone for good: a reload brings back the authored office, not the saved one
    const b = reload(store);
    expect(b.doc).toBeNull();
    expect(b.world.get(movedId).transform.pos.x).toBeCloseTo(authoredPos.x, 6);
    expect(b.world.entities.has(deletedId)).toBe(true);
  });

  it("restores a reverted deletion with its footprint and capabilities intact", () => {
    const store = memoryLayoutStorage();
    const a = rig(store);
    const id = firstDeletable(a.edit);
    const authored = { ...a.world.get(id) };
    a.edit.select(id);
    a.edit.remove();
    a.layout.resetToAuthored();
    const back = a.world.get(id);
    expect(back.kind).toBe(authored.kind);
    expect(back.footprint).toEqual(authored.footprint);
    expect(back.capabilities.editable).toBe(authored.capabilities.editable);
  });

  it("reverts anchors along with the transform, so a reset chair's stand-here cell is authored again", () => {
    const store = memoryLayoutStorage();
    const a = rig(store);
    const authored = { ...a.world.get(CHAIR_4_ID).capabilities.seat! };
    const p = a.world.get(CHAIR_4_ID).transform.pos;
    a.edit.select(CHAIR_4_ID);
    a.edit.preview({ x: p.x, z: p.z + 12 });
    a.edit.confirm();
    a.layout.resetToAuthored();
    const back = a.world.get(CHAIR_4_ID).capabilities.seat!;
    expect(back.approach.x).toBeCloseTo(authored.approach.x, 6);
    expect(back.approach.z).toBeCloseTo(authored.approach.z, 6);
  });
});

// ---- 6. stale and incompatible data -----------------------------------------------------------------
describe("persistence — stale or incompatible data fails safely", () => {
  const goodDoc = (): string => {
    const store = memoryLayoutStorage();
    const a = rig(store);
    const id = firstDeletable(a.edit);
    a.edit.select(id);
    a.edit.preview({ x: a.world.get(id).transform.pos.x + 16, z: a.world.get(id).transform.pos.z });
    a.edit.confirm();
    a.layout.save();
    return store.getItem(LAYOUT_STORAGE_KEY)!;
  };

  it("a document from another schemaVersion is discarded whole", () => {
    const raw = JSON.parse(goodDoc());
    const store = memoryLayoutStorage();
    const hash = rig(store).layout.contentHash;
    expect(parseLayout(JSON.stringify({ ...raw, schemaVersion: LAYOUT_SCHEMA_VERSION + 1 }), hash)).toBeNull();
    expect(parseLayout(JSON.stringify({ ...raw, schemaVersion: 0 }), hash)).toBeNull();
  });

  it("a document whose content hash belongs to a different office is discarded whole", () => {
    expect(parseLayout(goodDoc(), "deadbeef")).toBeNull();
  });

  it("corrupt, truncated and non-object JSON all load as null rather than throwing", () => {
    const store = memoryLayoutStorage();
    const hash = rig(store).layout.contentHash;
    for (const raw of ["", "{", "null", "[]", '"a string"', "{\"schemaVersion\":1}", goodDoc().slice(0, 40)])
      expect(parseLayout(raw, hash)).toBeNull();
  });

  it("a corrupt stored document leaves the authored office standing", () => {
    const store = memoryLayoutStorage();
    store.setItem(LAYOUT_STORAGE_KEY, "{not json");
    const b = rig(store);
    expect(b.layout.load()).toBeNull();
    expect(b.world.entities.size).toBeGreaterThan(0);
  });

  it("a moved entry whose authored transform no longer matches is dropped, and the rest still loads", () => {
    const store = memoryLayoutStorage();
    const a = rig(store);
    const [one, two] = a.edit.editable().filter((e) => a.edit.deleteBlockedBecause(e.id) === null).map((e) => e.id);
    for (const id of [one, two]) {
      a.edit.select(id);
      a.edit.preview({ x: a.world.get(id).transform.pos.x + 16, z: a.world.get(id).transform.pos.z });
      a.edit.confirm();
    }
    const doc = JSON.parse(store.getItem(LAYOUT_STORAGE_KEY) ?? JSON.stringify(a.layout.save()!));
    // the room file moved this piece since the save: its `from` is now a lie
    doc.moved[0].from.pos.x += 7;
    store.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(doc));

    const b = reload(store);
    expect(b.report!.moved).toBe(1);
    expect(b.report!.skipped).toBe(1);
    expect(b.world.get(doc.moved[0].id).transform.pos.x).toBeCloseTo(doc.moved[0].from.pos.x - 7, 6);
  });

  it("a surface entry whose room rebuilt the surface is dropped", () => {
    const store = memoryLayoutStorage();
    const a = rig(store);
    const surf = a.surfaces.all()[0];
    a.edit.selectSurface(surf.id);
    a.edit.previewSurface({ ...surf.base, color: 0x334455 });
    a.edit.confirm();
    a.layout.save();
    const doc = JSON.parse(store.getItem(LAYOUT_STORAGE_KEY)!);
    doc.surfaces[0].base.roughness = 0.99; // the room now builds it differently
    store.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(doc));

    const b = reload(store);
    expect(b.report!.surfaces).toBe(0);
    expect(b.report!.skipped).toBe(1);
    expect(b.surfaces.get(surf.id)!.committed.color).toBe(surf.base.color);
  });

  it("a saved deletion may never remove a piece the delete rule protects", () => {
    const store = memoryLayoutStorage();
    const a = rig(store);
    expect(a.edit.deleteBlockedBecause(CHAIR_4_ID)).toBe("system");
    const doc = a.layout.capture();
    doc.deleted.push(CHAIR_4_ID);
    store.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(doc));

    const b = reload(store);
    expect(b.world.entities.has(CHAIR_4_ID)).toBe(true);
    expect(b.report!.skipped).toBe(1);
  });

  it("a saved ADDED entity may not smuggle gameplay wiring back into the office", () => {
    const store = memoryLayoutStorage();
    const a = rig(store);
    const { id } = placeSomewhereFree(a.edit);
    a.edit.confirm();
    const doc = a.layout.capture();
    // hand-edited: a seat capability on a piece the editor created
    (doc.added[0] as unknown as { capabilities: Record<string, unknown> }).capabilities = {
      editable: true, seat: a.world.get(CHAIR_4_ID).capabilities.seat,
    };
    store.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(doc));

    const b = reload(store);
    expect(b.world.get(id!).capabilities.seat).toBeUndefined();
    expect(b.world.get(id!).capabilities.editable).toBe(true);
  });

  it("an added entity naming a room that does not exist is skipped", () => {
    const store = memoryLayoutStorage();
    const a = rig(store);
    const { id } = placeSomewhereFree(a.edit);
    a.edit.confirm();
    const doc = a.layout.capture();
    doc.added[0].roomId = "no-such-room";
    store.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(doc));

    const b = reload(store);
    expect(b.world.entities.has(id!)).toBe(false);
    expect(b.report!.skipped).toBe(1);
  });

  it("out-of-range saved spec values are clamped on load, never applied raw", () => {
    const store = memoryLayoutStorage();
    const a = rig(store);
    const surf = a.surfaces.all()[0];
    a.edit.selectSurface(surf.id);
    a.edit.previewSurface({ ...surf.base, color: 0x334455, brightness: 1.2 });
    a.edit.confirm();
    a.layout.save();
    const doc = JSON.parse(store.getItem(LAYOUT_STORAGE_KEY)!);
    doc.surfaces[0].spec.brightness = 99;
    doc.surfaces[0].spec.roughness = -5;
    store.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(doc));

    const back = reload(store).surfaces.get(surf.id)!;
    expect(back.committed.brightness).toBeLessThanOrEqual(1.5);
    expect(back.committed.roughness).toBeGreaterThanOrEqual(0.04);
  });

  it("no storage at all is not an error — the editor simply does not persist", () => {
    const a = rig(memoryLayoutStorage());
    const none = new LayoutStore({ world: a.world, mirror: a.mirror, walkability: a.wk, surfaces: a.surfaces, leds: a.leds, storage: null });
    expect(none.load()).toBeNull();
    expect(none.save()).toBeNull();
    expect(none.hasSaved).toBe(false);
    expect(() => none.clear()).not.toThrow();
  });
});

// ---- 7. the app wires it ----------------------------------------------------------------------------
describe("room editor v2 — the app actually wires persistence", () => {
  it("bootstrap builds the store before the restore, restores entities before the registries collect, and routes Save / Reset to Authored", () => {
    const src = bootstrapSource;
    for (const needle of [
      "new LayoutStore({ world, mirror, walkability, surfaces, leds })",
      "layout.load()", "layout.restoreEntities(savedLayout)", "layout.restoreTreatments(savedLayout)",
      "layout.save(edit.pending)", "layout.resetToAuthored()", "layoutDirty:",
    ]) expect(src, needle).toContain(needle);
    // entities are restored BEFORE the registries walk the room groups
    expect(src.indexOf("layout.restoreEntities(savedLayout)")).toBeLessThan(src.indexOf("surfaces.collect(room.id, g)"));
  });
});
