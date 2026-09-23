// ROOM EDITOR V2 — SLICE 1. Selection policy, yaw through the mirror, snapping, numeric entry,
// undo/redo over WorldState commits, and the functional-object safety rule.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import bootstrapSource from "./app/world.ts?raw";
import { WorldState } from "./world/WorldState";
import { DESIGN_ROOM, DESIGN_SOLIDS, HERO_PLANT_ID, designRoomEntities, RECT, SHELL } from "./rooms/design-room";
import { MEETING_ROOM, meetingRoomEntities } from "./rooms/meeting";
import { GAMING_ROOM, gamingRoomEntities } from "./rooms/gaming";
import { QA_ROOM, qaRoomEntities } from "./rooms/qa";
import { EXECUTIVE_ROOM, executiveRoomEntities } from "./rooms/executive";
import { Walkability } from "./nav/Walkability";
import { v1Static } from "./adapters/v1Grid";
import { SceneMirror } from "./render/SceneMirror";
import { EditSession, SNAP_STEP } from "./editor/EditSession";
import { applyEditablePolicy, isEditable, lockReason } from "./editor/editable";
import { TransformHistory, type TransformEntry } from "./editor/History";
import { EditorGizmo, yawToward } from "./editor/EditorGizmo";
import { ControllerStack } from "./avatar/Controller";
import type { Vec2 } from "./core/coords";

const W = (x: number, z: number): Vec2 => ({ x: RECT.x + x, z: RECT.z + z });

/** the Design Room alone — enough for every transform assertion, and it builds in milliseconds */
function rig() {
  const world = new WorldState();
  world.addRoom(DESIGN_ROOM);
  for (const e of designRoomEntities()) world.addEntity(e);
  DESIGN_SOLIDS.forEach((r, i) => world.addEntity({ id: `s${i}`, kind: "solid", roomId: DESIGN_ROOM.id, transform: { pos: { x: r.x + r.w / 2, z: r.z + r.d / 2 }, yaw: 0 }, footprint: { shape: "rect", w: r.w, d: r.d }, capabilities: {}, props: {} }));
  const ids = applyEditablePolicy(world);
  const scene = new THREE.Scene();
  const mirror = new SceneMirror(world, scene);
  mirror.buildRoom(DESIGN_ROOM, { wallHeight: SHELL.wallHeight, frontWall: "low" });
  const wk = new Walkability(v1Static);
  wk.syncFromWorld(world);
  const edit = new EditSession(world, mirror, wk, new ControllerStack());
  edit.setEditMode(true);
  return { world, mirror, wk, edit, ids };
}

/** several rooms, entities only — for the policy sweep (no scene build, so it stays fast) */
function policyWorld(): WorldState {
  const world = new WorldState();
  for (const [room, ents] of [
    [DESIGN_ROOM, designRoomEntities()], [MEETING_ROOM, meetingRoomEntities()], [GAMING_ROOM, gamingRoomEntities()],
    [EXECUTIVE_ROOM, executiveRoomEntities()], [QA_ROOM, qaRoomEntities()],
  ] as const) {
    world.addRoom(room);
    for (const e of ents) world.addEntity(e);
  }
  return world;
}

describe("room editor v2 — selection policy", () => {
  it("opens up real furniture and props, and never architecture or world-anchored functional pieces", () => {
    const world = policyWorld();
    const ids = applyEditablePolicy(world);
    expect(ids.length).toBeGreaterThan(40);
    for (const id of ids) {
      const e = world.get(id);
      expect(e.capabilities.editable, `${id} editable`).toBe(true);
      expect(e.placement?.movable, `${id} movable`).toBe(true);
    }
    for (const e of world.entities.values()) {
      const why = lockReason(e);
      if (!why) continue;
      expect(e.capabilities.editable, `${e.id} (${why}) must stay locked`).toBeUndefined();
      expect(e.placement?.movable, `${e.id} (${why}) must stay unplaceable`).toBeFalsy();
    }
    // architecture is still refused by the real rooms
    const reasons = new Set([...world.entities.values()].map(lockReason).filter(Boolean));
    expect(reasons).toContain("structural");
  });
  it("SLICE 2: architecture stays locked, and functional furniture is now editable because its anchors move", () => {
    const world = policyWorld();
    applyEditablePolicy(world);
    let functional = 0;
    for (const e of world.entities.values()) {
      const c = e.capabilities;
      if (c.door || c.clearance) {
        expect(isEditable(e), `${e.id} is architecture and must not be editable`).toBe(false);
      } else if (c.seat || c.lounge || c.approach) {
        functional++;
        // it may still be refused for a NON-anchor reason (no footprint, baked) — never for its anchors
        expect(lockReason(e), `${e.id} must not be refused for its anchors`).not.toBe("functional");
      }
    }
    expect(functional).toBeGreaterThan(10); // the rooms really do author this many
  });
  it("the hero plant keeps its authored clearance and its capabilities survive the policy", () => {
    const world = policyWorld();
    applyEditablePolicy(world);
    const p = world.get(HERO_PLANT_ID);
    expect(p.placement).toEqual({ movable: true, clearance: 1.5 });
    expect(p.capabilities).toEqual({ sway: true, editable: true, navBlocker: true });
  });
  it("applying the policy twice changes nothing (idempotent)", () => {
    const world = policyWorld();
    const a = applyEditablePolicy(world);
    const snapshot = a.map((id) => JSON.stringify(world.get(id).placement));
    const b = applyEditablePolicy(world);
    expect(b).toEqual(a);
    expect(a.map((id) => JSON.stringify(world.get(id).placement))).toEqual(snapshot);
  });
});

describe("room editor v2 — the mirror carries yaw without erasing authored facing", () => {
  it("every SELECTABLE piece's view sits exactly on its transform — moving it can only move the piece", () => {
    const { mirror, edit } = rig();
    const sel = edit.editable();
    expect(sel.length).toBeGreaterThan(5);
    for (const e of sel) {
      const v = mirror.view(e.id);
      expect(v.position.x, `${e.id} x`).toBeCloseTo(e.transform.pos.x, 6);
      expect(v.position.z, `${e.id} z`).toBeCloseTo(e.transform.pos.z, 6);
    }
  });
  it("a builder that measures straight into WORLD space is refused, not silently teleported", () => {
    const { world, mirror, edit, ids } = rig();
    const baked = ids.filter((id) => !mirror.isTransformBound(id));
    expect(baked.length, "the Design Room's two curve desks are built this way").toBeGreaterThan(0);
    for (const id of baked) {
      expect(mirror.view(id).position.x).not.toBeCloseTo(world.get(id).transform.pos.x, 6);
      expect(edit.lockedBecause(id)).toBe("world-baked");
      expect(edit.editable().some((e) => e.id === id)).toBe(false);
    }
  });
  it("a builder's baked facing is the baseline, and transform yaw adds to it", () => {
    const { world, mirror, edit } = rig();
    const desk = [...world.entities.values()].find((e) => e.kind === "member-desk" && e.capabilities.editable)!;
    const built = mirror.view(desk.id).rotation.y;
    expect(mirror.baseYawOf(desk.id)).toBeCloseTo(built - desk.transform.yaw, 9);
    edit.select(desk.id);
    edit.setYawDegrees(30);
    expect(mirror.view(desk.id).rotation.y).toBeCloseTo(built + Math.PI / 6, 6);
    expect(edit.currentYawDegrees()).toBeCloseTo(30, 3);
    // committing keeps the view where the preview put it, and the logical yaw is the DELTA, not the view's
    expect(edit.confirm()).toEqual({ ok: true });
    expect(world.get(desk.id).transform.yaw).toBeCloseTo(Math.PI / 6, 6);
    expect(mirror.view(desk.id).rotation.y).toBeCloseTo(built + Math.PI / 6, 6);
    expect(edit.yawDrift()).toBe(0);
  });
  it("rotating preserves position, and props metadata survives the transform", () => {
    const { world, edit } = rig();
    const desk = [...world.entities.values()].find((e) => e.kind === "member-desk" && e.capabilities.editable)!;
    const before = { ...desk.transform.pos };
    const props = { ...desk.props };
    edit.select(desk.id);
    edit.setYawDegrees(90);
    edit.confirm();
    const after = world.get(desk.id);
    expect(after.transform.pos).toEqual(before);
    expect(after.props).toEqual(props);
    expect(after.kind).toBe(desk.kind);
    expect(after.capabilities).toEqual(desk.capabilities);
  });
  it("cancel reverts BOTH position and yaw to the committed transform", () => {
    const { world, mirror, edit } = rig();
    edit.select(HERO_PLANT_ID);
    const t = world.get(HERO_PLANT_ID).transform;
    edit.preview(W(270.5, 125));
    edit.previewYaw(1.1);
    edit.cancel();
    expect(mirror.view(HERO_PLANT_ID).position.x).toBeCloseTo(t.pos.x, 6);
    expect(edit.currentYaw()).toBeCloseTo(t.yaw, 6);
    expect(edit.drift()).toBe(0);
    expect(edit.yawDrift()).toBe(0);
  });
});

describe("room editor v2 — snapping and precise entry", () => {
  it("snap OFF is free, snap ON lands on the grid lattice and on 15° increments", () => {
    const { edit } = rig();
    edit.select(HERO_PLANT_ID);
    expect(edit.snap.enabled).toBe(false);
    const free = W(270.3, 124.7);
    edit.preview(free);
    expect(edit.currentPos()!.x).toBeCloseTo(free.x, 6);

    edit.snap.enabled = true;
    edit.preview(free);
    const p = edit.currentPos()!;
    expect(p.x % SNAP_STEP).toBe(0);
    expect(p.z % SNAP_STEP).toBe(0);
    expect(Math.abs(p.x - free.x)).toBeLessThanOrEqual(SNAP_STEP / 2);

    edit.previewYaw((37 * Math.PI) / 180);
    expect(edit.currentYawDegrees()).toBeCloseTo(30, 3);
  });
  it("a typed coordinate is exact even while snap is on, and holds the other axis and the yaw", () => {
    const { edit } = rig();
    edit.select(HERO_PLANT_ID);
    edit.snap.enabled = true;
    edit.setYawDegrees(45);
    const z0 = edit.currentPos()!.z;
    edit.setAxis("x", 270.37);
    expect(edit.currentPos()!.x).toBeCloseTo(270.37, 6);
    expect(edit.currentPos()!.z).toBeCloseTo(z0, 6);
    expect(edit.currentYawDegrees()).toBeCloseTo(45, 3);
    expect(edit.snap.enabled).toBe(true); // the override is scoped to the one call
  });
  it("nudging turns by exactly the increment asked for, snap or no snap", () => {
    const { edit } = rig();
    edit.select(HERO_PLANT_ID);
    edit.setYawDegrees(0);
    edit.nudgeYawDegrees(15);
    expect(edit.currentYawDegrees()).toBeCloseTo(15, 3);
    edit.nudgeYawDegrees(-90);
    expect(edit.currentYawDegrees()).toBeCloseTo(-75, 3);
  });
});

describe("room editor v2 — a piece is never illegal where its own room put it", () => {
  it("authored contacts (a bench run of abutting desks) do not block confirming in place or turning", () => {
    const { world, edit } = rig();
    const desks = [...world.entities.values()].filter((e) => e.kind === "member-desk" && e.capabilities.editable);
    expect(desks.length).toBeGreaterThan(1);
    for (const d of desks) {
      edit.select(d.id);
      expect(edit.validateCurrent(), `${d.id} as authored`).toEqual({ ok: true });
      expect(edit.setYawDegrees(45), `${d.id} turned`).toEqual({ ok: true });
      expect(edit.confirm(), `${d.id} confirm`).toEqual({ ok: true });
    }
  });
  it("but a move into a solid it was NOT already touching is still refused", () => {
    const { world, edit } = rig();
    edit.select(HERO_PLANT_ID);
    expect(edit.validateCurrent()).toEqual({ ok: true });
    expect(edit.preview(W(155, 105))).toMatchObject({ ok: false, reason: "overlaps-furniture" });
    expect(edit.confirm().ok).toBe(false);
    expect(world.get(HERO_PLANT_ID).transform.pos).toEqual(designRoomEntities().find((e) => e.id === HERO_PLANT_ID)!.transform.pos);
  });
  it("the baseline is re-measured per selection, not carried between pieces", () => {
    const { world, edit } = rig();
    const desk = [...world.entities.values()].find((e) => e.kind === "member-desk" && e.capabilities.editable)!;
    edit.select(desk.id);
    expect(edit.validateCurrent()).toEqual({ ok: true });
    edit.select(HERO_PLANT_ID);
    expect(edit.preview(W(155, 105))).toMatchObject({ ok: false, reason: "overlaps-furniture" });
  });
});

describe("room editor v2 — invalid placement cannot be confirmed", () => {
  it("an overlapping or out-of-room preview is reported and refused", () => {
    const { world, edit } = rig();
    edit.select(HERO_PLANT_ID);
    const before = { ...world.get(HERO_PLANT_ID).transform.pos };
    expect(edit.preview({ x: RECT.x - 10, z: RECT.z + 100 })).toMatchObject({ ok: false, reason: "outside-room" });
    expect(edit.validateCurrent().ok).toBe(false);
    expect(edit.confirm().ok).toBe(false);
    expect(world.get(HERO_PLANT_ID).transform.pos).toEqual(before); // nothing committed
    expect(edit.preview(W(155, 105))).toMatchObject({ ok: false, reason: "overlaps-furniture" });
    expect(edit.confirm().ok).toBe(false);
    expect(world.get(HERO_PLANT_ID).transform.pos).toEqual(before);
  });
});

describe("room editor v2 — undo / redo over WorldState commits", () => {
  it("undo restores the previous COMMITTED transform and redo replays it; walkability follows both ways", () => {
    const { world, wk, edit } = rig();
    edit.select(HERO_PLANT_ID);
    const orig = { ...world.get(HERO_PLANT_ID).transform.pos };
    const origKeys = [...wk.dynamicBlockedKeys].sort();
    edit.preview(W(270.5, 125));
    edit.previewYaw(0.5);
    expect(edit.confirm()).toEqual({ ok: true });
    const moved = { ...world.get(HERO_PLANT_ID).transform.pos };
    const movedKeys = [...wk.dynamicBlockedKeys].sort();
    expect(movedKeys).not.toEqual(origKeys);

    expect(edit.canUndo).toBe(true);
    expect(edit.undo()).toBe(true);
    expect(world.get(HERO_PLANT_ID).transform.pos).toEqual(orig);
    expect(world.get(HERO_PLANT_ID).transform.yaw).toBe(0);
    expect([...wk.dynamicBlockedKeys].sort()).toEqual(origKeys);
    expect(edit.drift()).toBe(0);

    expect(edit.redo()).toBe(true);
    expect(world.get(HERO_PLANT_ID).transform.pos).toEqual(moved);
    expect(world.get(HERO_PLANT_ID).transform.yaw).toBeCloseTo(0.5, 6);
    expect([...wk.dynamicBlockedKeys].sort()).toEqual(movedKeys);
    expect(edit.canRedo).toBe(false);
  });
  it("preview is never history: only confirmed changes are recorded", () => {
    const { edit } = rig();
    edit.select(HERO_PLANT_ID);
    edit.preview(W(270.5, 125));
    edit.previewYaw(0.3);
    edit.cancel();
    expect(edit.canUndo).toBe(false);
    expect(edit.history.depth).toBe(0);
  });
  it("a confirm that changes nothing is not recorded, and a new change clears the redo branch", () => {
    const { edit } = rig();
    edit.select(HERO_PLANT_ID);
    expect(edit.confirm()).toEqual({ ok: true });
    expect(edit.history.depth).toBe(0);
    edit.preview(W(270.5, 125)); edit.confirm();
    edit.preview(W(200, 192)); edit.confirm();
    edit.undo();
    expect(edit.canRedo).toBe(true);
    edit.preview(W(200, 56)); edit.confirm();
    expect(edit.canRedo).toBe(false);
  });
  it("history is bounded and never grows past its limit", () => {
    const h = new TransformHistory(3);
    for (let i = 0; i < 10; i++) h.push({ id: "e", before: { pos: { x: i, z: 0 }, yaw: 0 }, after: { pos: { x: i + 1, z: 0 }, yaw: 0 } });
    expect(h.depth).toBe(3);
    expect((h.undo() as TransformEntry).after.pos.x).toBe(10);
  });
  it("undo selects whatever it moved, so the designer sees the piece that changed", () => {
    const { world, edit } = rig();
    const desk = [...world.entities.values()].find((e) => e.kind === "member-desk" && e.capabilities.editable)!;
    edit.select(desk.id); edit.setYawDegrees(30); edit.confirm();
    edit.select(HERO_PLANT_ID);
    edit.undo();
    expect(edit.selected).toBe(desk.id);
    expect(world.get(desk.id).transform.yaw).toBe(0);
  });
});

describe("room editor v2 — confirm / cancel / reset stay the safe workflow", () => {
  it("reset returns to the transform the session first saw, through a real commit", () => {
    const { world, wk, edit } = rig();
    edit.select(HERO_PLANT_ID);
    const orig = { ...world.get(HERO_PLANT_ID).transform.pos };
    const origKeys = [...wk.dynamicBlockedKeys].sort();
    for (const s of [W(270.5, 125), W(200, 192), W(200, 56)]) { edit.preview(s); edit.confirm(); }
    edit.setYawDegrees(120); edit.confirm();
    edit.reset();
    expect(world.get(HERO_PLANT_ID).transform.pos).toEqual(orig);
    expect(world.get(HERO_PLANT_ID).transform.yaw).toBe(0);
    expect([...wk.dynamicBlockedKeys].sort()).toEqual(origKeys);
    expect(edit.drift()).toBe(0);
    expect(edit.undo()).toBe(true); // reset is itself undoable
  });
  it("leaving edit mode drops the preview and releases the avatar", () => {
    const { world, edit } = rig();
    edit.select(HERO_PLANT_ID);
    edit.preview(W(270.5, 125));
    edit.setEditMode(false);
    expect(edit.previewing).toBe(false);
    expect(edit.selected).toBe(null);
    expect(world.get(HERO_PLANT_ID).transform.pos).toEqual(designRoomEntities().find((e) => e.id === HERO_PLANT_ID)!.transform.pos);
  });
});

describe("room editor v2 — gizmo geometry", () => {
  it("the ring is a band around the piece, hit outside it and missed at its centre", () => {
    const scene = new THREE.Scene();
    const g = new EditorGizmo(scene);
    const view = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(40, 20, 20));
    view.add(m);
    g.attach(view);
    const c = { x: 100, z: 100 };
    expect(g.onRing(c, c)).toBe(false);
    expect(g.onRing({ x: c.x + g.ringRadius, z: c.z }, c)).toBe(true);
    expect(g.onRing({ x: c.x + g.ringRadius + 40, z: c.z }, c)).toBe(false);
    g.dispose();
  });
  it("a drag point on the ring reads as the yaw pointing at it (model forward is +z at yaw 0)", () => {
    const c = { x: 0, z: 0 };
    expect(yawToward(c, { x: 0, z: 10 })).toBeCloseTo(0, 6);
    expect(yawToward(c, { x: 10, z: 0 })).toBeCloseTo(Math.PI / 2, 6);
    expect(yawToward(c, { x: 0, z: -10 })).toBeCloseTo(Math.PI, 6);
  });
});

describe("room editor v2 — the app actually wires it", () => {
  it("bootstrap applies the editable policy, builds the panel + gizmo and routes move, rotate, snap, undo", () => {
    for (const needle of [
      "applyEditablePolicy(world)", "new EditorGizmo(R.scene)", "new EditorPanel(document.body",
      'editDrag = "rotate"', "edit.previewYaw(yawToward(", "edit.preview({ x: p.x + grabOffset.x",
      "editGizmo.onRing(floor, centre)", "edit.snap.enabled", "edit.undo()", "edit.redo()",
    ]) expect(bootstrapSource, needle).toContain(needle);
  });
});
