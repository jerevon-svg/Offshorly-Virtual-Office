import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { BAKED, FURNITURE, ROOM, SHELL, facingFor, kindForPath } from "./layout";
import { animateSway, buildRoom, countMeshes, plantStatsOf, swayNodesOf } from "./build";

describe("design room 3d layout (isolated POC)", () => {
  it("places every separated Design Room asset from the manifest inside the room footprint", () => {
    expect(FURNITURE.length).toBe(22); // 21 furniture + the rug (manifest decor)
    for (const f of FURNITURE) {
      expect(f.rect.x).toBeGreaterThanOrEqual(-0.01);
      expect(f.rect.z).toBeGreaterThanOrEqual(-0.01);
      expect(f.rect.x + f.rect.w).toBeLessThanOrEqual(ROOM.width + 0.01);
      expect(f.rect.z + f.rect.d).toBeLessThanOrEqual(ROOM.height + 0.01);
    }
    const kinds = new Map<string, number>();
    for (const f of FURNITURE) kinds.set(f.kind, (kinds.get(f.kind) ?? 0) + 1);
    expect(Object.fromEntries(kinds)).toEqual({
      "lead-desk": 1, "member-desk": 4, "curve-desk": 2, "desk-panel": 3, "side-desk": 1, rug: 1, sofa: 1, beanbag: 1,
      "lead-chair": 1, "chair-a": 4, "chair-b": 3,
    });
  });

  it("derives chair facing from the desk they serve, and mirrors the right-hand curve desk", () => {
    const left = FURNITURE.filter((f) => f.kind === "chair-a" && f.rect.x < ROOM.width / 2);
    const right = FURNITURE.filter((f) => f.kind === "chair-a" && f.rect.x >= ROOM.width / 2);
    expect(left.every((f) => f.facing === "west")).toBe(true);
    expect(right.every((f) => f.facing === "east")).toBe(true);
    expect(FURNITURE.filter((f) => f.kind === "chair-b").every((f) => f.facing === "north")).toBe(true);
    expect(FURNITURE.find((f) => f.kind === "lead-chair")!.facing).toBe("south");
    const curves = FURNITURE.filter((f) => f.kind === "curve-desk").sort((a, b) => a.rect.x - b.rect.x);
    expect(curves.map((c) => c.mirrored)).toEqual([false, true]);
    expect(facingFor("chair-a", { x: 10, z: 0, w: 10, d: 10 })).toBe("west");
    expect(kindForPath("assets/office/furniture/design-team/design-side-mat.png")).toBe("rug");
    expect(kindForPath("assets/office/furniture/dev-team/dev-chair.png")).toBeNull();
  });

  it("keeps baked items inside the shell and the glass run on the right wall within the room depth", () => {
    for (const p of BAKED.plants) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(ROOM.width);
      expect(p.z).toBeGreaterThan(0);
      expect(p.z).toBeLessThan(ROOM.height);
    }
    expect(SHELL.glass.z0).toBeLessThan(SHELL.glass.doorZ1);
    expect(SHELL.glass.doorZ1).toBeLessThan(SHELL.glass.z1);
    expect(SHELL.glass.z1).toBeLessThan(SHELL.frontWallZ);
    expect(BAKED.rearCabinet.x + BAKED.rearCabinet.w).toBeLessThan(BAKED.whiteboard.x0);
  });

  it("builds a volumetric scene graph deterministically (no renderer needed)", () => {
    const a = buildRoom();
    const b = buildRoom();
    const ca = countMeshes(a), cb = countMeshes(b);
    expect(ca.meshes).toBeGreaterThan(250);
    expect(ca.triangles).toBeGreaterThan(20000);
    expect(ca).toEqual(cb);
    // every mesh has real volume-bearing geometry and participates in shadows unless glass/floor
    let casters = 0;
    a.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.castShadow) casters++; });
    expect(casters).toBeGreaterThan(ca.meshes * 0.9);
    const box = new THREE.Box3().setFromObject(a);
    expect(box.max.y).toBeGreaterThanOrEqual(SHELL.wallHeight - 0.01);
    expect(box.min.x).toBeLessThan(0); // exterior slab surrounds the room
    expect(box.max.x).toBeGreaterThan(ROOM.width);
    const full = buildRoom({ wallHeight: 80, frontWall: "full" });
    expect(new THREE.Box3().setFromObject(full).max.y).toBeGreaterThanOrEqual(80 - 0.01);
  });

  it("gives the hero plant many independent sway nodes that animate without rigid whole-plant motion", () => {
    const room = buildRoom();
    const nodes = swayNodesOf(room);
    expect(nodes.length).toBeGreaterThan(30); // trunk + branches + every leaf pivot
    const phases = new Set(nodes.map((n) => n.phase.toFixed(3)));
    expect(phases.size).toBeGreaterThan(nodes.length * 0.8); // desynchronised
    expect(Math.max(...nodes.map((n) => n.amp))).toBeLessThan(0.12); // subtle
    const before = nodes.map((n) => (n.axis === "x" ? n.obj.rotation.x : n.obj.rotation.z));
    animateSway(nodes, 1.37);
    const after = nodes.map((n) => (n.axis === "x" ? n.obj.rotation.x : n.obj.rotation.z));
    const moved = after.filter((v, i) => Math.abs(v - before[i]) > 1e-4).length;
    expect(moved).toBeGreaterThan(nodes.length * 0.9);
    // stays bounded around the base pose
    nodes.forEach((n, i) => expect(Math.abs(after[i] - n.base)).toBeLessThan(n.amp * 1.4 + 1e-6));
  });

  it("builds one tiered plant family: 3 large, 7 medium, 1 hanging, all animated, with instanced static succulents", () => {
    const room = buildRoom();
    const stats = plantStatsOf(room)!;
    expect(stats.animated).toEqual({ large: 3, medium: 7, hanging: 1, small: 0 });
    expect(stats.succulents).toBeGreaterThan(15); // every desk/cabinet pot
    expect(stats.swayNodes).toBe(swayNodesOf(room).length);
    const instanced: THREE.InstancedMesh[] = [];
    room.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) instanced.push(o as THREE.InstancedMesh); });
    expect(instanced).toHaveLength(3); // pots, soil, leaves
    expect(instanced.every((m) => m.count >= stats.succulents && m.castShadow)).toBe(true);
    // no sway node belongs to a succulent (they are static by design)
    const nodes = swayNodesOf(room);
    const freqs = new Set(nodes.map((n) => n.freq.toFixed(4)));
    expect(freqs.size).toBeGreaterThan(nodes.length * 0.7); // never in sync
    expect(nodes.every((n) => n.amp <= 0.1)).toBe(true);
  });
});
