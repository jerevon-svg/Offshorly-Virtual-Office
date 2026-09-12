import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { WorldState } from "./world/WorldState";
import { DESIGN_ROOM, SHELL, designRoomEntities, RECT } from "./rooms/design-room";
import { SceneMirror } from "./render/SceneMirror";
import { summarize, percentile, PRESETS } from "./devtools/Bench";

describe("vo3d build — Design Room mirrors the world deterministically", () => {
  it("builds shell + baked + every entity at WORLD positions; rebuild is identical", () => {
    const world = new WorldState(); world.addRoom(DESIGN_ROOM); for (const e of designRoomEntities()) world.addEntity(e);
    const scene = new THREE.Scene(); const mirror = new SceneMirror(world, scene);
    mirror.buildRoom(DESIGN_ROOM, { wallHeight: SHELL.wallHeight, frontWall: "low" });
    const count = (o: THREE.Object3D) => { let m = 0, t = 0; o.traverse((c) => { const mm = c as THREE.Mesh; if (mm.isMesh) { m++; const idx = mm.geometry.getIndex(); const n = idx ? idx.count / 3 : mm.geometry.getAttribute("position").count / 3; t += (mm as THREE.InstancedMesh).isInstancedMesh ? n * (mm as THREE.InstancedMesh).count : n; } }); return { m, t: Math.round(t) }; };
    const a = count(mirror.root);
    expect(a.m).toBeGreaterThan(800); expect(a.t).toBeGreaterThan(100000);
    // shell group sits at the room's world origin; entity views at their world positions
    const roomGroup = mirror.root.getObjectByName(`room:${DESIGN_ROOM.id}`)!;
    expect(roomGroup.children[0].position.x).toBeCloseTo(RECT.x, 6);
    const chair = mirror.view(`${DESIGN_ROOM.id}/design-member-chair-4`);
    expect(chair.position.x).toBeCloseTo(RECT.x + 146.1 + 18.5 / 2, 0);
    const bbox = new THREE.Box3().setFromObject(mirror.root);
    expect(bbox.min.x).toBeLessThan(RECT.x); expect(bbox.max.x).toBeGreaterThan(RECT.x + RECT.w); // exterior slab surrounds the room
    expect(mirror.sway.nodeCount).toBeGreaterThan(300);
    mirror.rebuildRoom(DESIGN_ROOM, { wallHeight: SHELL.wallHeight, frontWall: "low" });
    expect(count(mirror.root)).toEqual(a);
  });
  it("bench statistics still behave (promoted verbatim)", () => {
    const s = summarize([16, 16, 17, 16, 33, 16, 50, 16, 16, 16].map((dt, i) => ({ dt, calls: 1700 + i, triangles: 1 })), 1);
    expect(s.worstFrameMs).toBe(50); expect(s.medianFrameMs).toBe(16); expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    expect(PRESETS.map((p) => p.id)).toEqual(["A", "B", "C", "D"]);
  });
});
