import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { WorldState } from "./world/WorldState";
import { DESIGN_ROOM, DESIGN_SOLIDS, HERO_PLANT_ID, designRoomEntities, RECT, SHELL } from "./rooms/design-room";
import { Walkability } from "./nav/Walkability";
import { v1Static, worldToCell } from "./adapters/v1Grid";
import { SceneMirror } from "./render/SceneMirror";
import { EditSession } from "./editor/EditSession";
import { ControllerStack, NavigationController } from "./avatar/Controller";
import { Avatar } from "./avatar/Avatar";
import { planWalk } from "./nav/planner";
import { pointInRect, type Vec2 } from "./core/coords";

const W = (x: number, z: number): Vec2 => ({ x: RECT.x + x, z: RECT.z + z });
const inBounds = (p: Vec2) => pointInRect(p, DESIGN_ROOM.floorRect);
function rig() {
  const world = new WorldState(); world.addRoom(DESIGN_ROOM); for (const e of designRoomEntities()) world.addEntity(e);
  DESIGN_SOLIDS.forEach((r, i) => world.addEntity({ id: `s${i}`, kind: "solid", roomId: DESIGN_ROOM.id, transform: { pos: { x: r.x + r.w / 2, z: r.z + r.d / 2 }, yaw: 0 }, footprint: { shape: "rect", w: r.w, d: r.d }, capabilities: {}, props: {} }));
  const scene = new THREE.Scene(); const mirror = new SceneMirror(world, scene);
  mirror.buildRoom(DESIGN_ROOM, { wallHeight: SHELL.wallHeight, frontWall: "low" });
  const wk = new Walkability(v1Static); wk.syncFromWorld(world);
  const stack = new ControllerStack(); const edit = new EditSession(world, mirror, wk, stack);
  return { world, mirror, wk, stack, edit };
}

describe("vo3d editor — one plant, world transactions, dynamic footprint", () => {
  it("preview moves only the view; confirm commits transform + footprint atomically; old cells released", () => {
    const { world, mirror, wk, edit } = rig();
    edit.setEditMode(true); edit.select(HERO_PLANT_ID);
    const before = world.get(HERO_PLANT_ID).transform.pos; const beforeKeys = [...wk.dynamicBlockedKeys];
    const target = W(270.5, 125);
    expect(edit.preview(target)).toEqual({ ok: true });
    expect(world.get(HERO_PLANT_ID).transform.pos).toEqual(before); // logical state untouched by preview
    expect(mirror.view(HERO_PLANT_ID).position.x).toBeCloseTo(target.x, 6);
    expect(edit.confirm()).toEqual({ ok: true });
    expect(world.get(HERO_PLANT_ID).transform.pos).toEqual(target);
    const c = worldToCell(target); expect(wk.isDynamicallyBlocked(c.cx, c.cy)).toBe(true);
    for (const k of beforeKeys) expect(wk.dynamicBlockedKeys).not.toContain(k);
    expect(edit.drift()).toBe(0);
  });
  it("rejects invalid placements, cancel reverts the view, reset restores the original + footprint, 5 cycles no drift", () => {
    const { world, mirror, wk, edit } = rig();
    edit.setEditMode(true); edit.select(HERO_PLANT_ID);
    const orig = { ...world.get(HERO_PLANT_ID).transform.pos }; const origKeys = [...wk.dynamicBlockedKeys].sort();
    expect(edit.preview({ x: RECT.x - 10, z: RECT.z + 100 })).toMatchObject({ ok: false, reason: "outside-room" });
    expect(edit.confirm().ok).toBe(false);
    expect(edit.preview(W(155, 105))).toMatchObject({ ok: false, reason: "overlaps-furniture" });
    edit.cancel(); expect(mirror.view(HERO_PLANT_ID).position.x).toBeCloseTo(orig.x, 6); expect(edit.drift()).toBe(0);
    for (const s of [W(270.5, 125), W(200, 192), W(200, 56), W(290, 56), W(250, 190)]) { expect(edit.preview(s).ok).toBe(true); expect(edit.confirm().ok).toBe(true); expect(edit.drift()).toBe(0); }
    edit.reset();
    expect(world.get(HERO_PLANT_ID).transform.pos).toEqual(orig); expect([...wk.dynamicBlockedKeys].sort()).toEqual(origKeys);
  });
  it("edit mode owns the avatar (navigation refused) and releases it on exit; sway nodes travel with the moved plant", () => {
    const { mirror, stack, edit } = rig();
    const av = new Avatar({ height: 36, lit: true }); const nav = new NavigationController(av, stack);
    edit.setEditMode(true); expect(stack.owner).toBe("Editor"); expect(nav.setPath([W(1, 1)])).toBe(false);
    edit.select(HERO_PLANT_ID); edit.preview(W(270.5, 125)); edit.confirm();
    const g = mirror.view(HERO_PLANT_ID); const nodes = mirror.sway.nodesOf(HERO_PLANT_ID);
    expect(nodes.length).toBeGreaterThan(20);
    expect(nodes.every((n) => { let o: THREE.Object3D | null = n.obj; while (o) { if (o === g) return true; o = o.parent; } return false; })).toBe(true);
    mirror.sway.update(1.0); expect(g.position.x).toBeCloseTo(W(270.5, 0).x, 6);
    edit.setEditMode(false); expect(stack.owner).toBe("Idle"); expect(nav.setPath([W(1, 1)])).toBe(true);
    // the moved plant now forces a detour for the planner (dynamic layer re-synced on confirm)
    const { world: w2, wk: wk2, edit: e2 } = rig();
    e2.setEditMode(true); e2.select(HERO_PLANT_ID); e2.preview(W(270.5, 125)); e2.confirm();
    const detour = planWalk(W(270.5, 141), W(270.5, 109), wk2, inBounds);
    expect(detour.ok && detour.path.length >= 2).toBe(true);
    expect(w2.get(HERO_PLANT_ID).transform.pos).toEqual(W(270.5, 125));
  });
});
