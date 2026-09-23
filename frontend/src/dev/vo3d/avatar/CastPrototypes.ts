// vo3d avatar — ONE PARSE PER CHARACTER, CLONED PER BODY, plus the nameplate that hangs over it.
//
// Extracted from devtools/Crowd.ts, which authored both and is still one of the two callers. The other is
// world/Coworkers.ts (Phase 4A, real employees on the floor). The material recipe, the scale-and-centre
// arithmetic and the label canvas all had to be identical in both — a stress body that shades differently
// from a real one prices the wrong thing, and two nameplate canvases drift the moment either is tuned —
// so they live here once rather than twice.
//
// THE SHAPE IS PRODUCTION'S. A character's GLB is parsed ONCE per (id, LOD) and every body is a
// SkeletonUtils.clone of it: a clone gets its own skeleton (its own bone matrices, its own per-frame bone
// texture upload) and its own AnimationMixer, and shares geometry + materials with its siblings. So N
// bodies of one character cost N skinning passes and N draw calls — the real cost — without N x 8 MB of
// parse. This is exactly what render3d/glbCache.ts does for V1, and it is deliberately NOT that module:
// glbCache imports render3d/SharedRenderer, and V2 owns its own renderer. Importing it here would put two
// WebGL contexts in one page.
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { BON_STANDING_HEIGHT, DRACO_PATH, castLods, type AvatarLod } from "../adapters/v1Avatar";

let loader: GLTFLoader | null = null;
function gltfLoader(): GLTFLoader {
  if (loader) return loader;
  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_PATH);
  loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  return loader;
}

/** One parsed character, prepared once: scaled/centred, materials built, triangles counted. */
export type CastPrototype = {
  id: string;
  gltf: GLTF;
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
  triangles: number;
  headY: number;
};

// Module-level and deliberately never evicted: a world that unmounts and remounts (StrictMode does it on
// every dev mount) must not re-fetch 40 MB of GLB, and the cost is bounded at one entry per character per
// LOD for the life of the tab — the same bargain render3d/glbCache.ts strikes. The bodies built from a
// prototype ARE disposed with their world; the prototype itself is the shared source they were cloned
// from and outlives them on purpose.
const prototypes = new Map<string, Promise<CastPrototype>>();

export function prototypeFor(id: string, lod: AvatarLod): Promise<CastPrototype> {
  const key = `${id}@${lod}`;
  let p = prototypes.get(key);
  if (p) return p;
  p = gltfLoader().loadAsync(castLods(id)[lod]).then((gltf) => {
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    const native = box.max.y - box.min.y;
    const s = BON_STANDING_HEIGHT / native;
    scene.scale.setScalar(s);
    scene.position.set((-(box.min.x + box.max.x) / 2) * s, -box.min.y * s, (-(box.min.z + box.max.z) / 2) * s);
    let triangles = 0;
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false; // skinned bounds do not follow the animation
      const idx = m.geometry.getIndex();
      triangles += idx ? idx.count / 3 : m.geometry.getAttribute("position").count / 3;
      const src = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[];
      // ONE material per source material per CHARACTER — clones share these by reference, exactly as
      // production does. Built with avatar/Avatar.ts's recipe so every body shades like the hero avatar.
      const lit = src.map((sm) => {
        const mm = new THREE.MeshStandardMaterial({ map: sm.map ?? null, color: sm.color?.clone() ?? new THREE.Color(0xffffff), roughness: 0.9, metalness: 0, side: sm.side, transparent: sm.transparent, opacity: sm.opacity, alphaTest: sm.alphaTest });
        if (mm.map) mm.map.anisotropy = 8;
        return mm;
      });
      m.material = Array.isArray(m.material) ? lit : lit[0];
    });
    return { id, gltf, scene, clips: gltf.animations, triangles: Math.round(triangles), headY: BON_STANDING_HEIGHT };
  });
  prototypes.set(key, p);
  return p;
}

/** A nameplate texture. One per body (names are unique), disposed with the body that carries it.
 *
 *  `sub` and `dot` are both optional and are what separate the two callers: the stress crowd draws a
 *  fabricated status line with a coloured dot, and a REAL coworker draws neither — Phase 4A reads no
 *  presence detail beyond "V1 lists them as in the office", so a plate that showed a status would be
 *  asserting something nobody measured. Name-only plates centre the name instead of top-aligning it. */
export function castLabelTexture(name: string, sub = "", dot = ""): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(28,24,20,0.72)";
  g.beginPath();
  // rounded pill
  const r = 18;
  g.moveTo(r, 4); g.lineTo(c.width - r, 4); g.quadraticCurveTo(c.width - 4, 4, c.width - 4, 4 + r);
  g.lineTo(c.width - 4, 60 - r); g.quadraticCurveTo(c.width - 4, 60, c.width - r, 60);
  g.lineTo(r, 60); g.quadraticCurveTo(4, 60, 4, 60 - r);
  g.lineTo(4, 4 + r); g.quadraticCurveTo(4, 4, r, 4);
  g.fill();
  let textX = 24;
  if (dot) {
    g.fillStyle = dot;
    g.beginPath(); g.arc(28, 32, 9, 0, Math.PI * 2); g.fill();
    textX = 46;
  }
  g.fillStyle = "#f6efe6";
  g.font = "600 24px ui-sans-serif, system-ui, sans-serif";
  g.textBaseline = "middle";
  g.fillText(name, textX, sub ? 26 : 32);
  if (sub) {
    g.fillStyle = "rgba(246,239,230,0.66)";
    g.font = "400 15px ui-sans-serif, system-ui, sans-serif";
    g.fillText(sub, textX, 47);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
