import { render, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { CharacterCanvas } from "./CharacterCanvas";

// ---------------------------------------------------------------------------
// Regression coverage for the "invisible character, no fallback" bug: a
// non-walking variant (idle, or the chosen gesture) that FAILS to load must
// never leave the walk model hidden — visibility must be driven by
// loaded-model availability, not by GLB-url/prop presence. See
// CharacterCanvas.tsx's applyVisibility()/tick-loop `effectiveGesture` logic.
//
// loadGlbCached is mocked so each url's resolve/reject is controlled
// directly per test (no real network/GLTF parsing). SharedRenderer is
// mocked too — real WebGL isn't available in jsdom, and this suite only
// cares about which model Object3D is `.visible`, not actual pixels.
// ---------------------------------------------------------------------------

type Deferred = { resolve: (v: unknown) => void; reject: (e: unknown) => void };
const pendingLoads = new Map<string, Deferred>();
// Mirrors glbCache.ts's real dedupe-by-url behavior: a second call for a
// URL that's already pending (or already resolved) reuses the same
// promise/settled value instead of creating a fresh one. This matters for
// the shared-resource test below, which mounts two `CharacterCanvas`
// instances against the same URL and needs both to receive the exact same
// (mock) GLTF object, just like the real cache does.
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
vi.mock("./SharedRenderer", () => ({
  renderToCanvas: vi.fn((scene: THREE.Scene) => {
    capturedScene = scene;
  }),
  getSharedCanvasElement: vi.fn(() => {
    throw new Error("no real WebGL context in tests");
  }),
}));

function makeFakeGltf(name: string) {
  const scene = new THREE.Group();
  scene.name = name;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  scene.add(mesh);
  // animations: [] deliberately — keeps normalizeToReferenceHeight/mixer
  // setup as no-ops, since this suite only exercises visibility wiring.
  return { scene, animations: [] } as unknown as { scene: THREE.Group; animations: [] };
}

function findModelByName(scene: THREE.Scene, name: string): THREE.Object3D | undefined {
  let found: THREE.Object3D | undefined;
  scene.traverse((o) => {
    if (o.name === name) found = o;
  });
  return found;
}

// The fake gltf's `scene` (found above by name) is a Group wrapping a single
// unnamed Mesh child — walk to find that mesh, whose geometry/material are
// what glbCache/SkeletonUtils.clone actually share across instances.
function findFirstMesh(root: THREE.Object3D): THREE.Mesh | undefined {
  let found: THREE.Mesh | undefined;
  root.traverse((o) => {
    if (!found && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh;
  });
  return found;
}

let rafCallback: FrameRequestCallback | null = null;
let originalRAF: typeof requestAnimationFrame;
let originalCAF: typeof cancelAnimationFrame;

beforeEach(() => {
  pendingLoads.clear();
  promiseCache.clear();
  capturedScene = null;
  rafCallback = null;
  originalRAF = global.requestAnimationFrame;
  originalCAF = global.cancelAnimationFrame;
  global.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    rafCallback = cb;
    return 1;
  }) as typeof requestAnimationFrame;
  global.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
});

afterEach(() => {
  global.requestAnimationFrame = originalRAF;
  global.cancelAnimationFrame = originalCAF;
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

describe("CharacterCanvas visibility fallback on load failure", () => {
  it("keeps the walk model visible when the idle glb fails to load while stationary", async () => {
    render(
      <CharacterCanvas
        walkingGlbUrl="walk.glb"
        idleGlbUrl="idle.glb"
        isWalking={false}
        width={100}
        height={100}
      />,
    );

    await resolveLoad("walk.glb", "walkModel");
    await rejectLoad("idle.glb");
    runOneTick();

    expect(capturedScene).not.toBeNull();
    const walkModel = findModelByName(capturedScene!, "walkModel");
    expect(walkModel).toBeDefined();
    // Idle never loaded (idleModelRef stays null) -> walk model must remain
    // the visible fallback even though isWalking=false and idleGlbUrl was
    // provided, instead of staying hidden forever waiting for an idle model
    // that will never arrive.
    expect(walkModel!.visible).toBe(true);
  });

  it("keeps the walk model visible+idle hidden once idle loads successfully (sanity check)", async () => {
    render(
      <CharacterCanvas
        walkingGlbUrl="walk.glb"
        idleGlbUrl="idle.glb"
        isWalking={false}
        width={100}
        height={100}
      />,
    );

    await resolveLoad("walk.glb", "walkModel");
    await resolveLoad("idle.glb", "idleModel");
    runOneTick();

    const walkModel = findModelByName(capturedScene!, "walkModel");
    const idleModel = findModelByName(capturedScene!, "idleModel");
    expect(walkModel!.visible).toBe(false);
    expect(idleModel!.visible).toBe(true);
  });

  it("keeps walk/idle visible (not the failed gesture) when the chosen gesture glb fails during an active chat/call", async () => {
    // Force Math.random() to always pick the first option ("shrug", the
    // only gesture glb registered here) deterministically.
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    const { rerender } = render(
      <CharacterCanvas
        walkingGlbUrl="walk.glb"
        idleGlbUrl="idle.glb"
        shrugGlbUrl="shrug.glb"
        isWalking={false}
        gestureActive={false}
        width={100}
        height={100}
      />,
    );

    await resolveLoad("walk.glb", "walkModel");
    await resolveLoad("idle.glb", "idleModel");

    // false -> true transition: rolls "shrug" as the chosen gesture.
    rerender(
      <CharacterCanvas
        walkingGlbUrl="walk.glb"
        idleGlbUrl="idle.glb"
        shrugGlbUrl="shrug.glb"
        isWalking={false}
        gestureActive={true}
        width={100}
        height={100}
      />,
    );

    await rejectLoad("shrug.glb");
    runOneTick();

    const walkModel = findModelByName(capturedScene!, "walkModel");
    const idleModel = findModelByName(capturedScene!, "idleModel");
    // The chosen gesture (shrug) never loaded -> effectiveGesture must be
    // false, so idle stays the visible stand-in (character is stationary),
    // never a blank canvas waiting on a gesture model that failed.
    expect(walkModel!.visible).toBe(false);
    expect(idleModel!.visible).toBe(true);

    randomSpy.mockRestore();
  });
});

describe("CharacterCanvas cleanup does not dispose cache-owned geometry/material", () => {
  it("does not call geometry.dispose()/material.dispose() on the cloned mesh when an instance unmounts", async () => {
    const { unmount } = render(
      <CharacterCanvas walkingGlbUrl="walk.glb" isWalking={false} width={100} height={100} />,
    );

    await resolveLoad("walk.glb", "walkModel");
    runOneTick();

    const walkModel = findModelByName(capturedScene!, "walkModel");
    expect(walkModel).toBeDefined();
    const mesh = findFirstMesh(walkModel!)!;
    expect(mesh).toBeDefined();
    const geomDisposeSpy = vi.spyOn(mesh.geometry, "dispose");
    const material = mesh.material as THREE.Material;
    const matDisposeSpy = vi.spyOn(material, "dispose");

    unmount();

    // The bug being fixed: geometry/material are owned by the module-level
    // glbCache entry (shared across every SkeletonUtils.clone() of that
    // entry), not by this one CharacterCanvas instance. Disposing them here
    // would corrupt any other still-mounted clone of the same character
    // (e.g. main office view + PiP mini-camera both showing the self-avatar
    // while walking).
    expect(geomDisposeSpy).not.toHaveBeenCalled();
    expect(matDisposeSpy).not.toHaveBeenCalled();
  });

  it("leaves a still-mounted instance's model geometry/material intact after a second instance sharing the same cached GLTF unmounts (main view + PiP scenario)", async () => {
    // Instance A: simulates the main office view for the self-avatar.
    render(<CharacterCanvas walkingGlbUrl="walk.glb" isWalking={true} width={100} height={100} />);
    await resolveLoad("walk.glb", "walkModel");
    runOneTick();

    const sceneA = capturedScene;
    const modelA = findModelByName(sceneA!, "walkModel")!;
    expect(modelA).toBeDefined();
    const meshA = findFirstMesh(modelA)!;
    expect(meshA).toBeDefined();
    const geomA = meshA.geometry;
    const matA = meshA.material as THREE.Material;
    const geomDisposeSpy = vi.spyOn(geomA, "dispose");
    const matDisposeSpy = vi.spyOn(matA, "dispose");

    // Instance B: simulates the PiP mini-camera view, mounted against the
    // exact same URL — per glbCache's dedupe-by-url, it resolves to the
    // SAME underlying GLTF, and SkeletonUtils.clone() shares geometry/
    // material by reference across both clones (only nodes/bones/skeleton
    // are per-clone), matching the real cache + clone behavior.
    const { unmount: unmountB } = render(
      <CharacterCanvas walkingGlbUrl="walk.glb" isWalking={true} width={100} height={100} />,
    );
    // Already resolved in promiseCache -> flush the microtask queue so B's
    // `.then()` runs without needing a second resolveLoad call.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    runOneTick();

    const sceneB = capturedScene;
    const modelB = findModelByName(sceneB!, "walkModel")!;
    expect(modelB).toBeDefined();
    const meshB = findFirstMesh(modelB)!;
    expect(meshB).toBeDefined();
    expect(modelB).not.toBe(modelA); // distinct clones (distinct nodes)...
    expect(meshB.geometry).toBe(geomA); // ...but shared geometry
    expect(meshB.material).toBe(matA); // ...and shared material

    // PiP (instance B) unmounts, e.g. because isWalking gating hides it.
    unmountB();

    // Main view (instance A) is still mounted and must be unaffected: its
    // model is still in the scene graph, and the shared geometry/material
    // were never disposed by B's cleanup.
    expect(findModelByName(sceneA!, "walkModel")).toBe(modelA);
    expect(geomDisposeSpy).not.toHaveBeenCalled();
    expect(matDisposeSpy).not.toHaveBeenCalled();
  });
});
