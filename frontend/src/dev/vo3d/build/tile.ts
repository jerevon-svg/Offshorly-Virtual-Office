// vo3d build — the front-bar TILED FLOOR. One helper, shared by every room that sits on the ground-floor
// tile: the grout grid is phased to the WORLD, not to the room rect, so Meeting → Reception → Project read
// as one continuous floor no matter which of them is reconstructed first.
import * as THREE from "three";
import { TILE, TILE_PHASE, tileMat } from "../render/Materials";
import type { Rect } from "../core/coords";

/** UV repeat/offset that make a BoxGeometry TOP face sample the tile texture in WORLD coordinates.
 *  Box +Y face UVs run u: 0→1 along +x, v: 1→0 along +z — hence the negative v repeat. */
export function worldTileUv(rect: Rect): { repeat: THREE.Vector2; offset: THREE.Vector2 } {
  return {
    repeat: new THREE.Vector2(rect.w / TILE, -rect.d / TILE),
    offset: new THREE.Vector2((rect.x - TILE_PHASE.x) / TILE, (rect.z + rect.d - TILE_PHASE.z) / TILE),
  };
}

/** A flat tiled floor slab for `rect`, top face at exactly y = 0 (polygon-offset so it never z-fights the
 *  shared ground slab, which is also flush at 0). Plain BoxGeometry: RoundedBoxGeometry's per-face 0..1 UVs
 *  cannot carry a world phase. */
export function tiledFloor(rect: Rect, thickness = 1.2): THREE.Mesh {
  const m = tileMat();
  if (m.map) {
    const { repeat, offset } = worldTileUv(rect);
    m.map.repeat.copy(repeat);
    m.map.offset.copy(offset);
  }
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(rect.w, thickness, rect.d), m);
  mesh.position.set(rect.x + rect.w / 2, -thickness / 2, rect.z + rect.d / 2);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}
