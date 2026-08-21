import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { getSharedRenderer } from "./SharedRenderer";

// ---------------------------------------------------------------------------
// Phase C — module-level GLB load cache, keyed by URL. `CharacterCanvas`
// mounts (and remounts, e.g. React StrictMode double-invoke or multiple
// instances of the same character elsewhere on the map) must not re-fetch
// or re-parse the same 17MB GLB every time; the raw parsed `GLTF` result is
// cached here and shared. Each `CharacterCanvas` instance is still
// responsible for cloning `gltf.scene` (via SkeletonUtils.clone, so rigged/
// skinned meshes clone correctly) before mutating/animating it, so multiple
// instances never share one live Object3D graph.
//
// Phase 0.4 (LOD pipeline) — the new lod0/1/2 GLBs produced by
// scripts/avatar-pipeline/build-character-lods.mjs use
// KHR_draco_mesh_compression for geometry (no KTX2/Basis textures yet — see
// that script's header comment on why toktx/basisu weren't available on
// the build machine). GLTFLoader silently fails to parse a Draco-compressed
// primitive without an attached DRACOLoader, so both decoders are wired up
// here unconditionally. This does NOT break the OLD uncompressed GLBs still
// referenced elsewhere (live3dCharacters.ts, etc.) — GLTFLoader only
// invokes these sub-loaders when the corresponding KHR_draco_mesh_
// compression / KHR_texture_basisu extension is actually present in a given
// file, so plain GLBs parse exactly as before.
// ---------------------------------------------------------------------------

const dracoLoader = new DRACOLoader();
// Decoder files copied from three/examples/jsm/libs/draco (see
// public/vendor/draco/README.md-equivalent — this is a straight vendored
// copy, not authored here) so they're servable as static Vite public
// assets under the app's BASE_URL, matching how every other runtime-built
// path in this project is required to resolve (see vite.config.ts's
// BASE_PATH comment).
dracoLoader.setDecoderPath(`${import.meta.env.BASE_URL}vendor/draco/`);

const ktx2Loader = new KTX2Loader();
ktx2Loader.setTranscoderPath(`${import.meta.env.BASE_URL}vendor/basis/`);

const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);
loader.setKTX2Loader(ktx2Loader);
const cache = new Map<string, Promise<GLTF>>();

// KTX2Loader needs a real `THREE.WebGLRenderer` (not just a canvas) to
// detect which GPU texture formats are supported, to pick a transcode
// target. Deferred to first actual `loadGlbCached` call — not module
// top-level — so this module can still be imported in non-DOM/test
// environments without eagerly constructing SharedRenderer's WebGL
// context (matching that module's own "lazy, first-use-only" contract).
let ktx2SupportDetected = false;
function ensureKtx2SupportDetected(): void {
  if (ktx2SupportDetected) return;
  ktx2SupportDetected = true;
  try {
    ktx2Loader.detectSupport(getSharedRenderer());
  } catch {
    // No real WebGL/DOM environment — KTX2Loader stays attached regardless;
    // it simply won't be exercised until a GLB actually uses
    // KHR_texture_basisu, which none of today's shipped assets do yet.
  }
}

export function loadGlbCached(url: string): Promise<GLTF> {
  let pending = cache.get(url);
  if (!pending) {
    ensureKtx2SupportDetected();
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
