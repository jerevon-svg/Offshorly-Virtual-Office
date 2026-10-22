// TEST-ONLY: decode the HumanBase_V1 GLBs in vitest exactly as avatar/rosterGlb.testutil does for the roster
// (gltf-transform + draco3dgltf, textures dropped, re-written uncompressed, GLTFLoader.parse). Lets the tests
// compose a real modular avatar from the built files with no browser.
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
// @ts-expect-error — draco3dgltf ships no type declarations
import draco3d from "draco3dgltf";

let io: NodeIO | null = null;
export async function nodeIO(): Promise<NodeIO> {
  io ??= new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "draco3d.decoder": await draco3d.createDecoderModule() });
  return io;
}
/** a catalogue url (…/avatars/human-base-v1/…) → its file under public/ (vitest runs from frontend/) */
export const publicPath = (url: string): string => `public/${url.replace(/^.*?avatars\//, "avatars/")}`;

export async function loadHumanGlb(url: string): Promise<GLTF> {
  const io = await nodeIO();
  const doc = await io.read(publicPath(url));
  for (const t of doc.getRoot().listTextures()) t.dispose();
  for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName === "KHR_draco_mesh_compression" || e.extensionName === "EXT_texture_webp") e.dispose();
  const glb = await io.writeBinary(doc);
  const buf = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
  return new Promise((resolve, reject) => new GLTFLoader().parse(buf, "", resolve, reject));
}
