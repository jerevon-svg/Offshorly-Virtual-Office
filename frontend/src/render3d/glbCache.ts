import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

// ---------------------------------------------------------------------------
// Phase C — module-level GLB load cache, keyed by URL. `CharacterCanvas`
// mounts (and remounts, e.g. React StrictMode double-invoke or multiple
// instances of the same character elsewhere on the map) must not re-fetch
// or re-parse the same 17MB GLB every time; the raw parsed `GLTF` result is
// cached here and shared. Each `CharacterCanvas` instance is still
// responsible for cloning `gltf.scene` (via SkeletonUtils.clone, so rigged/
// skinned meshes clone correctly) before mutating/animating it, so multiple
// instances never share one live Object3D graph.
// ---------------------------------------------------------------------------

const loader = new GLTFLoader();
const cache = new Map<string, Promise<GLTF>>();

export function loadGlbCached(url: string): Promise<GLTF> {
  let pending = cache.get(url);
  if (!pending) {
    pending = loader.loadAsync(url);
    cache.set(url, pending);
    // Don't cache a failed load — let the next caller retry.
    pending.catch(() => cache.delete(url));
  }
  return pending;
}

// Test-only escape hatch.
export function __clearGlbCacheForTests(): void {
  cache.clear();
}
