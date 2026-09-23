// Phase 2 — WHICH GLB an Avatar instance loads. The rest of Avatar (materials, clips, transforms) is
// unchanged and covered elsewhere; this file exists purely to pin the asset-selection contract, because
// that contract is what stands between an employee and being shown somebody else's body.
import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Every url the mocked loader has been asked for, in order. */
const requested: string[] = [];

vi.mock("three/examples/jsm/loaders/DRACOLoader.js", () => ({
  DRACOLoader: class {
    setDecoderPath(): void {}
  },
}));
vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    setDRACOLoader(): void {}
    loadAsync(url: string) {
      requested.push(url);
      // A one-mesh scene: Box3.setFromObject needs real geometry to produce a finite height.
      const scene = new THREE.Group();
      scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial()));
      return Promise.resolve({ scene, animations: [] });
    }
  },
}));

const { Avatar } = await import("./Avatar");
const { BON_LODS, castLods } = await import("../adapters/v1Avatar");

beforeEach(() => {
  requested.length = 0;
});

describe("Avatar asset selection", () => {
  it("loads Bon's LOD set when no lods are given — the standalone default, unchanged", async () => {
    const a = new Avatar({ height: 36, lit: true });
    await a.load(1);
    expect(requested).toEqual([BON_LODS[1]]);
  });

  it("loads the LOD set it was given instead", async () => {
    const alex = castLods("alex");
    const a = new Avatar({ height: 36, lit: true, lods: alex });
    await a.load(1);
    expect(requested).toEqual([alex[1]]);
    // The real assertion behind the previous line: it is NOT Bon.
    expect(requested[0]).not.toBe(BON_LODS[1]);
  });

  it("honours the requested LOD within the given set", async () => {
    const micah = castLods("micah");
    const a = new Avatar({ height: 36, lit: true, lods: micah });
    await a.load(0);
    await a.load(2);
    expect(requested).toEqual([micah[0], micah[2]]);
  });

  it("gives two instances genuinely independent asset sets", async () => {
    // Guards the regression the module-level constant made impossible to have: one avatar's set must
    // never leak into another's.
    const a = new Avatar({ height: 36, lit: true, lods: castLods("alex") });
    const b = new Avatar({ height: 36, lit: true });
    await a.load(1);
    await b.load(1);
    expect(requested[0]).toBe(castLods("alex")[1]);
    expect(requested[1]).toBe(BON_LODS[1]);
  });
});

describe("castLods", () => {
  it("returns three distinct real urls for a registered character", () => {
    const lods = castLods("bon");
    for (const lod of [0, 1, 2] as const) expect(lods[lod]).toMatch(/\.glb$/);
  });
});
