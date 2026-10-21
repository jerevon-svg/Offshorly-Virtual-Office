// vo3d build — THE STOREY BELOW FLOOR 2.
//
// What you see through floor 2's windows is NOT built here any more. It is the ground floor's own
// exterior (build/exterior) and the real AI Lab (build/ailabV2), re-anchored one storey below this plate by
// Environment.anchorExterior / app/world.ts applyFloor — one campus, one Lab, never a copy.
//
// The one thing that re-anchoring cannot supply is the building itself: the ground floor's office is a
// separate volume that is not drawn while you are upstairs. So this file stands in for exactly that and
// nothing else — the podium the office sits on and a plain mass for the ground storey's walls, filling
// the gap between the moved campus and the underside of floor 2's own plinth. From a window it is the
// face of the building dropping away below the glass; it is never seen close up.
//
// Nothing here is navigable and nothing casts or receives a shadow.
import * as THREE from "three";
import { mat } from "../render/Materials";
import { GRADE, PODIUM_MARGIN, PODIUM_TOP } from "../world/campus";
import type { Rect } from "../core/coords";
import { FRAME as FLOOR2_FRAME } from "../rooms/floor2";

/** floor 2's own plinth bottoms out at y -10 (build/floor2); the mass stops short of it so the two never
 *  share a plane (an orthographic depth fight is blocks, not speckle — see the Meeting Floor's history) */
const MASS_TOP = -12;

export type Floor2Context = {
  group: THREE.Group;
  /** re-seat the podium and mass for a storey height (the distance down to the moved campus) */
  setDrop(drop: number): void;
};

export function buildFloor2Context(drop: number): Floor2Context {
  return buildStoreysBelow(FLOOR2_FRAME, 1, drop, "floor-2-storey-below");
}

/** THE STOREYS BELOW ANY UPPER PLATE: the podium, ONE plain mass from the office floor up to just under the
 *  plate (however many storeys that is), and a thin belt at each storey line in between — so floor 4 stands
 *  on three storeys of building, not on a pillar. `level` is the plate's storeys above the ground (app/floors);
 *  floor 2 (level 1) has no intermediate storey and so no belt: its context is exactly what it always was. */
export function buildStoreysBelow(frame: Rect, level: number, drop: number, name: string): Floor2Context {
  const g = new THREE.Group();
  g.name = name;
  const F = frame;
  const cx = F.x + F.w / 2, cz = F.z + F.d / 2;
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const block = (m: THREE.Material, w: number, d: number): THREE.Mesh => {
    const mesh = new THREE.Mesh(unit, m);
    mesh.scale.set(w, 1, d);
    mesh.position.set(cx, 0, cz);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    g.add(mesh);
    return mesh;
  };
  // the podium: the V1 plinth's own footprint (frame grown by PODIUM_MARGIN), grade to office floor
  const podium = block(mat("plinth", 1), F.w + 2 * PODIUM_MARGIN, F.d + 2 * PODIUM_MARGIN);
  // the ground storey: the frame itself, office floor up to just under floor 2's plinth
  const mass = block(mat("wall", 0.95), F.w, F.d);
  const place = (m: THREE.Mesh, y0: number, y1: number): void => {
    m.scale.y = Math.max(0.1, y1 - y0);
    m.position.y = (y0 + y1) / 2;
  };
  // the belts: a slab edge proud of the mass by a hand's width, one per storey line below this plate
  const beltM = mat("plinth", 1);
  const belts = Array.from({ length: Math.max(0, level - 1) }, () => block(beltM, F.w + 6, F.d + 6));
  const setDrop = (d: number): void => {
    place(podium, GRADE - d, PODIUM_TOP - d);
    place(mass, PODIUM_TOP - d, MASS_TOP);
    belts.forEach((b, i) => {
      const y = -((i + 1) * d) / level; // storey lines, top down
      place(b, y - 10, y - 4);
    });
  };
  setDrop(drop);
  return { group: g, setDrop };
}
