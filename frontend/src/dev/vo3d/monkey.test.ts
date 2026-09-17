// vo3d — the AI Lab monkey master: does the SHIPPED asset match what the code
// declares about it? These read the real GLB in public/, so a swapped or
// re-exported file that breaks the contract fails here rather than on screen.
// Uses @gltf-transform/core like characterFraming.realAssets.test.ts, so the
// app tsconfig needs no node type definitions.
import { describe, expect, it, beforeAll } from "vitest";
import { NodeIO, type Document } from "@gltf-transform/core";
import {
  MONKEY_CLIPS, MONKEY_CLIP_NAMES, MONKEY_DECK_Y, MONKEY_JOINT_COUNT,
  MONKEY_SLOT, MONKEY_STANDING_HEIGHT,
} from "./world/monkeyAgent";
import { HUB, SOLIDS, SOLID_CIRCLES, WALK } from "./world/ailab";
import { BON_STANDING_HEIGHT } from "./adapters/v1Avatar";

const GLB = "public/avatars/monkey-base-v1/monkey-master.glb";

describe("ai lab monkey master asset", () => {
  let doc: Document;
  beforeAll(async () => { doc = await new NodeIO().read(GLB); });

  it("ships as a single skinned mesh with one material and one texture", () => {
    const root = doc.getRoot();
    expect(root.listMeshes()).toHaveLength(1);
    expect(root.listSkins()).toHaveLength(1);
    expect(root.listMaterials()).toHaveLength(1);
    expect(root.listTextures()).toHaveLength(1);
  });

  it("carries the 28-joint Mixamo skeleton the loader expects", () => {
    const joints = doc.getRoot().listSkins()[0].listJoints();
    expect(joints).toHaveLength(MONKEY_JOINT_COUNT);
    const names = joints.map((j) => j.getName());
    expect(names).toContain("mixamorig:Hips");
    expect(names).toContain("mixamorig:Head");
    expect(names).toContain("mixamorig:LeftArm");
  });

  it("is NOT the employee 24-joint contract — deliberately kept separate", () => {
    const names = doc.getRoot().listSkins()[0].listJoints().map((j) => j.getName());
    expect(names).not.toContain("Spine02"); // the employee naming
    expect(MONKEY_JOINT_COUNT).not.toBe(24);
  });

  it("contains exactly the clips the code declares, and no invented idle/wave", () => {
    const clips = doc.getRoot().listAnimations().map((a) => a.getName());
    expect([...clips].sort()).toEqual([...MONKEY_CLIP_NAMES].sort());
    for (const name of Object.values(MONKEY_CLIPS)) expect(clips).toContain(name);
    expect(clips).not.toContain("idle-9");
    expect(clips.some((c) => /wave/i.test(c))).toBe(false);
  });

  it("has skinning attributes on the primitive", () => {
    const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
    for (const a of ["POSITION", "NORMAL", "TEXCOORD_0", "JOINTS_0", "WEIGHTS_0"]) {
      expect(prim.getAttribute(a)).toBeTruthy();
    }
  });

  it("places the head joint ABOVE the shoulders (the test both earlier rigs failed)", () => {
    const joints = doc.getRoot().listSkins()[0].listJoints();
    const yOf = (name: string) => {
      const j = joints.find((n) => n.getName() === name);
      expect(j, `joint ${name}`).toBeTruthy();
      return j!.getWorldTranslation()[1];
    };
    expect(yOf("mixamorig:Head")).toBeGreaterThan(yOf("mixamorig:LeftShoulder"));
  });
});

describe("ai lab monkey placement", () => {
  it("stands at employee avatar scale", () => {
    expect(MONKEY_STANDING_HEIGHT).toBe(BON_STANDING_HEIGHT);
  });

  it("stands on the lab deck", () => {
    expect(MONKEY_DECK_Y).toBe(0.2);
  });

  it("stands inside the lab's walkable floor", () => {
    const inside = WALK.some(
      (r) => MONKEY_SLOT.x >= r.x && MONKEY_SLOT.x <= r.x + r.w &&
             MONKEY_SLOT.z >= r.z && MONKEY_SLOT.z <= r.z + r.d,
    );
    expect(inside).toBe(true);
  });

  it("does not stand inside any existing solid, robot slot or the hub", () => {
    for (const s of SOLIDS) {
      const hit = MONKEY_SLOT.x >= s.x && MONKEY_SLOT.x <= s.x + s.w &&
                  MONKEY_SLOT.z >= s.z && MONKEY_SLOT.z <= s.z + s.d;
      expect(hit).toBe(false);
    }
    for (const c of SOLID_CIRCLES) {
      expect(Math.hypot(MONKEY_SLOT.x - c.x, MONKEY_SLOT.z - c.z)).toBeGreaterThan(c.r);
    }
    expect(Math.hypot(MONKEY_SLOT.x - HUB.x, MONKEY_SLOT.z - HUB.z)).toBeGreaterThan(HUB.r);
  });
});
