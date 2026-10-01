// TEST-ONLY: load a real roster GLB in vitest, meshes and all. The shipped GLBs are Draco-compressed with
// WebP textures, neither of which three's GLTFLoader can decode in node — so the file is decoded by the
// pipeline's own gltf-transform + draco3dgltf, its textures dropped (tests never draw), re-written
// uncompressed, and handed to GLTFLoader.parse. What comes back is the same scene, skin, skeleton and
// clips the app loads, normalised exactly as avatar/Avatar.load does it.
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
// @ts-expect-error — draco3dgltf ships no type declarations
import draco3d from "draco3dgltf";
import { LIVE_3D_CHARACTERS } from "../../../render3d/live3dCharacters";
import { BON_STANDING_HEIGHT } from "../adapters/v1Avatar";

/** vitest runs from frontend/, like every file-reading test here (HudIcon.test) */
const PUBLIC = "public/";
let io: NodeIO | null = null;

/** every roster character's LOD0 path, relative to public/ */
export const ROSTER_LOD0: Record<string, string> = Object.fromEntries(
  Object.entries(LIVE_3D_CHARACTERS).map(([id, set]) => [id, set.glbUrl.replace(/^.*?avatars\//, "avatars/")]),
);

export async function loadRosterGlb(id: string): Promise<GLTF> {
  io ??= new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "draco3d.decoder": await draco3d.createDecoderModule() });
  const doc = await io.read(PUBLIC + ROSTER_LOD0[id]);
  for (const t of doc.getRoot().listTextures()) t.dispose();
  for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName === "KHR_draco_mesh_compression" || e.extensionName === "EXT_texture_webp") e.dispose();
  const glb = await io.writeBinary(doc);
  const buf = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
  return new Promise((resolve, reject) => new GLTFLoader().parse(buf, "", resolve, reject));
}

/** Avatar.load's normalisation: scale to the standing height, feet on y = 0, centred on x/z */
export function normaliseLikeAvatar(scene: THREE.Object3D, height = BON_STANDING_HEIGHT): void {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const s = height / (box.max.y - box.min.y);
  scene.scale.setScalar(s);
  scene.position.set(-(box.min.x + box.max.x) / 2 * s, -box.min.y * s, -(box.min.z + box.max.z) / 2 * s);
  scene.updateMatrixWorld(true);
}
