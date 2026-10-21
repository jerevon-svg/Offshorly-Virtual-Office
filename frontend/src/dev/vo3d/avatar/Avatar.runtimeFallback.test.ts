import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

// SAFE FALLBACK for a HumanBase body (a runtime-delivered head whose file cannot load, a broken GLB): an employee who also has a
// legacy character falls back to it; an employee with no legacy character is honestly missing — never somebody else's body.

vi.mock("three/examples/jsm/loaders/DRACOLoader.js", () => ({ DRACOLoader: class { setDecoderPath(): void {} } }));
vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    setDRACOLoader(): void {}
    loadAsync() {
      const scene = new THREE.Group();
      scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial()));
      return Promise.resolve({ scene, animations: [new THREE.AnimationClip("idle-9", 1, [])] });
    }
  },
}));
vi.mock("./humanBody", async (orig) => ({
  ...(await orig<typeof import("./humanBody")>()),
  createHumanBody: vi.fn(async () => { throw new Error("404: the runtime head could not be fetched"); }),
}));
vi.spyOn(console, "warn").mockImplementation(() => {});

const { Avatar } = await import("./Avatar");
const { appearanceFor } = await import("./humanBody");
const human = { config: appearanceFor("bon")!, catalogue: new Map() };

describe("a HumanBase body that cannot load", () => {
  it("falls back to the employee's own legacy character when they have one", async () => {
    const a = new Avatar({ height: 36, lit: true, human });
    await a.load(1);
    expect(a.runtime).toBe("legacy-glb");
  });
  it("is an honest failure for a HumanBase-only employee — no body is borrowed", async () => {
    const a = new Avatar({ height: 36, lit: true, lods: null, human });
    await expect(a.load(1)).rejects.toThrow(/runtime head/);
    expect(a.runtime).toBe("none");
  });
});
