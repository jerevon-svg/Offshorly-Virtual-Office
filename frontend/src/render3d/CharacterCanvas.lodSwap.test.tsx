import { render, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { CharacterCanvas } from "./CharacterCanvas";

// ---------------------------------------------------------------------------
// Seamless LOD switching (2026-08-30).
//
// The scene, camera and RAF loop live in an effect keyed on
// [width, height, animated]; `glbUrl` has its OWN effect that loads in the
// background and swaps atomically. These tests pin the behaviour that split
// exists to provide: the outgoing character stays on screen for the whole
// download, the swap is all-or-nothing, animation progress / heading / framing
// survive it, a stale load can never overwrite a newer tier, a failed load
// keeps the working model, and no second loop or canvas is ever created.
// ---------------------------------------------------------------------------

type Deferred = { resolve: (v: unknown) => void; reject: (e: unknown) => void };
const pendingLoads = new Map<string, Deferred>();
const promiseCache = new Map<string, Promise<unknown>>();

vi.mock("./glbCache", () => ({
  loadGlbCached: vi.fn((url: string) => {
    let p = promiseCache.get(url);
    if (!p) {
      p = new Promise((resolve, reject) => {
        pendingLoads.set(url, { resolve, reject });
      });
      promiseCache.set(url, p);
      p.catch(() => promiseCache.delete(url));
    }
    return p;
  }),
}));

let capturedScene: THREE.Scene | null = null;
const renderedSizes: Array<{ width: number; height: number }> = [];
vi.mock("./SharedRenderer", () => ({
  renderToCanvas: vi.fn((scene: THREE.Scene, _camera: THREE.Camera, _canvas: HTMLCanvasElement, width: number, height: number) => {
    capturedScene = scene;
    renderedSizes.push({ width, height });
  }),
  getSharedCanvasElement: vi.fn(() => {
    throw new Error("no real WebGL context in tests");
  }),
  getMaxAnisotropy: vi.fn(() => 8),
}));

const CLIP_NAMES = [
  "idle-9",
  "walking",
  "agree-gesture",
  "listening-gesture",
  "sit-on-chair-arms",
  "sitting-answering",
];

// Fake consolidated GLTF: one mesh/skeleton (a single Bone + a SkinnedMesh
// isn't needed for this suite's assertions, a plain Group+Mesh is enough
// since these tests only exercise the mixer/action wiring, not real skinned
// deformation), with one trivial AnimationClip per real clip name.
// Mirrors what GLTFLoader produces for the shipped LODs: a metal/rough PBR
// material whose base-color texture is also bound as the emissive map.
function makeFakeGltf(name: string) {
  const scene = new THREE.Group();
  scene.name = name;
  const atlas = new THREE.Texture();
  atlas.generateMipmaps = false;
  atlas.minFilter = THREE.LinearFilter;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ map: atlas, emissiveMap: atlas, emissive: 0xffffff, metalness: 1, roughness: 1 }),
  );
  scene.add(mesh);
  const animations = CLIP_NAMES.map(
    (clipName) => new THREE.AnimationClip(clipName, 1, []),
  );
  return { scene, animations } as unknown as { scene: THREE.Group; animations: THREE.AnimationClip[] };
}

let rafCallback: FrameRequestCallback | null = null;
let originalRAF: typeof requestAnimationFrame;
let originalCAF: typeof cancelAnimationFrame;

beforeEach(() => {
  pendingLoads.clear();
  promiseCache.clear();
  capturedScene = null;
  renderedSizes.length = 0;
  rafCallback = null;
  originalRAF = globalThis.requestAnimationFrame;
  originalCAF = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    rafCallback = cb;
    return 1;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
});

afterEach(() => {
  globalThis.requestAnimationFrame = originalRAF;
  globalThis.cancelAnimationFrame = originalCAF;
  vi.clearAllMocks();
});

async function resolveLoad(url: string, name: string) {
  const deferred = pendingLoads.get(url);
  expect(deferred).toBeDefined();
  await act(async () => {
    deferred!.resolve(makeFakeGltf(name));
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function rejectLoad(url: string) {
  const deferred = pendingLoads.get(url);
  expect(deferred).toBeDefined();
  await act(async () => {
    deferred!.reject(new Error(`simulated load failure for ${url}`));
    await Promise.resolve();
    await Promise.resolve();
  });
}

function runOneTick() {
  act(() => {
    rafCallback?.(0);
  });
}
const LOD0 = "/avatars/bon-v3-hq/bon-v3-lod0.glb";
const LOD1 = "/avatars/bon-v3-hq/bon-v3-lod1.glb";
const LOD2 = "/avatars/bon-v3-hq/bon-v3-lod2.glb";

function modelsIn(scene: THREE.Scene | null): THREE.Object3D[] {
  if (!scene) return [];
  return scene.children.filter((c) => c.name.startsWith("gltf:"));
}
const props = {
  width: 210,
  height: 298,
  headingDegrees: 0,
  isWalking: false,
  isSitting: false,
  layerHeight: 37.2,
};

describe("seamless LOD switching", () => {
  it("keeps the current character visible for the whole time the next tier loads", async () => {
    const { rerender, container } = render(<CharacterCanvas glbUrl={LOD2} {...props} />);
    await resolveLoad(LOD2, "gltf:lod2");
    runOneTick();
    expect(modelsIn(capturedScene).map((m) => m.name)).toEqual(["gltf:lod2"]);

    // switch tier — the replacement has NOT resolved yet
    rerender(<CharacterCanvas glbUrl={LOD0} {...props} />);
    runOneTick();
    // the old model is still the one being rendered: no blank frame
    expect(modelsIn(capturedScene).map((m) => m.name)).toEqual(["gltf:lod2"]);
    // and still exactly one canvas element
    expect(container.querySelectorAll("canvas")).toHaveLength(1);
  });

  it("swaps atomically — never two models, never zero", async () => {
    const { rerender } = render(<CharacterCanvas glbUrl={LOD2} {...props} />);
    await resolveLoad(LOD2, "gltf:lod2");
    runOneTick();
    rerender(<CharacterCanvas glbUrl={LOD0} {...props} />);
    runOneTick();
    expect(modelsIn(capturedScene)).toHaveLength(1);
    await resolveLoad(LOD0, "gltf:lod0");
    runOneTick();
    const after = modelsIn(capturedScene);
    expect(after).toHaveLength(1);
    expect(after[0].name).toBe("gltf:lod0");
  });

  it("preserves heading and model orientation across the swap", async () => {
    const { rerender } = render(<CharacterCanvas glbUrl={LOD2} {...props} headingDegrees={90} />);
    await resolveLoad(LOD2, "gltf:lod2");
    for (let i = 0; i < 40; i++) runOneTick();
    const before = modelsIn(capturedScene)[0].rotation.y;
    expect(before).not.toBe(0);

    rerender(<CharacterCanvas glbUrl={LOD0} {...props} headingDegrees={90} />);
    await resolveLoad(LOD0, "gltf:lod0");
    runOneTick();
    const after = modelsIn(capturedScene)[0];
    expect(after.name).toBe("gltf:lod0");
    expect(after.rotation.y).toBeCloseTo(before, 5);
  });

  it("preserves the active clip and its normalized playback progress", async () => {
    const { rerender, container } = render(<CharacterCanvas glbUrl={LOD2} {...props} isWalking />);
    await resolveLoad(LOD2, "gltf:lod2");
    runOneTick();
    const canvas = container.querySelector("canvas")!;
    expect(canvas.getAttribute("data-anim-state")).toBe("walking");

    rerender(<CharacterCanvas glbUrl={LOD0} {...props} isWalking />);
    await resolveLoad(LOD0, "gltf:lod0");
    runOneTick();
    // same clip still resolved after the swap — not reset to idle
    expect(canvas.getAttribute("data-anim-state")).toBe("walking");
    expect(modelsIn(capturedScene)[0].name).toBe("gltf:lod0");
  });

  it("keeps rendering at the same buffer size across a swap (apparent size unchanged)", async () => {
    const { rerender } = render(<CharacterCanvas glbUrl={LOD2} {...props} />);
    await resolveLoad(LOD2, "gltf:lod2");
    runOneTick();
    const before = renderedSizes.at(-1);
    rerender(<CharacterCanvas glbUrl={LOD0} {...props} />);
    await resolveLoad(LOD0, "gltf:lod0");
    runOneTick();
    expect(renderedSizes.at(-1)).toEqual(before);
  });

  it("ignores a stale load — the newest requested tier wins", async () => {
    const { rerender } = render(<CharacterCanvas glbUrl={LOD2} {...props} />);
    await resolveLoad(LOD2, "gltf:lod2");
    runOneTick();

    // rapid near/far movement: ask for LOD0, then LOD1 before LOD0 lands
    rerender(<CharacterCanvas glbUrl={LOD0} {...props} />);
    rerender(<CharacterCanvas glbUrl={LOD1} {...props} />);
    await resolveLoad(LOD1, "gltf:lod1");
    runOneTick();
    expect(modelsIn(capturedScene)[0].name).toBe("gltf:lod1");

    // the older LOD0 request now resolves — it must be discarded
    await resolveLoad(LOD0, "gltf:lod0-stale");
    runOneTick();
    expect(modelsIn(capturedScene).map((m) => m.name)).toEqual(["gltf:lod1"]);
  });

  it("retains the working model when the replacement fails to load", async () => {
    const onError = vi.fn();
    const { rerender } = render(<CharacterCanvas glbUrl={LOD2} {...props} onError={onError} />);
    await resolveLoad(LOD2, "gltf:lod2");
    runOneTick();

    rerender(<CharacterCanvas glbUrl={LOD0} {...props} onError={onError} />);
    await rejectLoad(LOD0);
    runOneTick();
    // still showing the old tier, and NOT dropped to the 2D sprite
    expect(modelsIn(capturedScene).map((m) => m.name)).toEqual(["gltf:lod2"]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("still falls back to the sprite when the FIRST load fails (nothing to keep)", async () => {
    const onError = vi.fn();
    render(<CharacterCanvas glbUrl={LOD0} {...props} onError={onError} />);
    await rejectLoad(LOD0);
    expect(onError).toHaveBeenCalled();
  });

  it("does not start a second RAF loop or canvas across repeated swaps", async () => {
    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame");
    const { rerender, container } = render(<CharacterCanvas glbUrl={LOD2} {...props} />);
    await resolveLoad(LOD2, "gltf:lod2");
    runOneTick();
    const afterFirst = rafSpy.mock.calls.length;

    for (const [url, name] of [[LOD0, "gltf:lod0"], [LOD1, "gltf:lod1"]] as const) {
      rerender(<CharacterCanvas glbUrl={url} {...props} />);
      await resolveLoad(url, name);
    }
    // each manual tick schedules exactly one more frame; installing a model
    // must not add loops of its own
    expect(rafSpy.mock.calls.length).toBe(afterFirst);
    expect(container.querySelectorAll("canvas")).toHaveLength(1);
    expect(modelsIn(capturedScene)).toHaveLength(1);
    rafSpy.mockRestore();
  });

  it("removes the model on unmount without leaving a loop running", async () => {
    const { unmount } = render(<CharacterCanvas glbUrl={LOD2} {...props} />);
    await resolveLoad(LOD2, "gltf:lod2");
    runOneTick();
    expect(modelsIn(capturedScene)).toHaveLength(1);
    unmount();
    expect(modelsIn(capturedScene)).toHaveLength(0);
  });
});
