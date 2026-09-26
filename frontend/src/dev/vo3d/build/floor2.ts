// vo3d build — FLOOR 2's shell: a slab, a glazed perimeter and a perimeter cove, with the Meeting
// Floor's district (build/floor2Meeting.ts) standing on it. The shell is what makes a storey read as a
// storey you have just arrived on:
//
//   • the plate, in the same world-phased tile the ground floor is laid in;
//   • a CURTAIN WALL on all four sides — a low spandrel, a tall run of glass, a head band — because the
//     first live ride arrived into a dim grey box and nothing about it said "one floor up";
//   • a PERIMETER COVE, so the floor is lit by its own architecture;
//   • no ceiling slab, for the same reason no room downstairs has one: Office View looks down at it.
//
// The view THROUGH the glass is build/floor2Context.ts — the elevated exterior that makes this read as
// the storey above the office rather than a plate somewhere else in the world.
import * as THREE from "three";
import { rbox, shadowed } from "./helpers";
import { TILE, TILE_PHASE, emissiveMat, facadeGlassMat, floorMat, mat, plastic, tileMat } from "../render/Materials";
import { FLOOR_RECT, FRAME, WALL_H, WALL_T, WALLS } from "../rooms/floor2";
import { MEETING_ROOMS } from "../rooms/floor2Meeting";

const SLAB_DROP = 0.05;
/** the curtain wall's three bands: solid spandrel, glazing, solid head */
const SPANDREL_H = 10;
const HEAD_H = 10;
/** mullion pitch along a glazed run, and the mullion's own width */
const MULLION_PITCH = 118;
const MULLION_W = 3;
/** how far below the wall head the cove and the ceiling strips hang */
const COVE_DROP = 8;

/** THE HALL FLOOR: the office's own polished tile, top face at 0 exactly like a room's, phased to the WORLD
 *  so its grout runs on unbroken into every room — and built AROUND the meeting rooms' floors rather than
 *  under them. That is the ground floor's rule (the hall has a hole where each reconstructed room's tile
 *  lies): two floors are never stacked, so nothing can fight for the same pixels at any zoom or angle.
 *  One mesh with world-space UVs, so the whole hall is one draw. */
function hallFloor(): THREE.Mesh {
  // ONE CONTINUOUS SURFACE WITH HOLES, not strips: strips meeting at T-junctions left hairline cracks that
  // sparkled along every band edge. Shape +y maps to world −z once rotated flat, so z is negated in.
  const F = FLOOR_RECT;
  const shape = new THREE.Shape();
  shape.moveTo(F.x, -F.z); shape.lineTo(F.x + F.w, -F.z); shape.lineTo(F.x + F.w, -(F.z + F.d)); shape.lineTo(F.x, -(F.z + F.d)); shape.closePath();
  for (const h of MEETING_ROOMS.map((r) => r.interior)) {
    const hole = new THREE.Path();
    hole.moveTo(h.x, -h.z); hole.lineTo(h.x, -(h.z + h.d)); hole.lineTo(h.x + h.w, -(h.z + h.d)); hole.lineTo(h.x + h.w, -h.z); hole.closePath();
    shape.holes.push(hole);
  }
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute, uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let k = 0; k < pos.count; k++) uv.setXY(k, (pos.getX(k) - TILE_PHASE.x) / TILE, (pos.getZ(k) - TILE_PHASE.z) / TILE);
  const mesh = new THREE.Mesh(geo, tileMat("hallTile"));
  mesh.name = "floor-2-hall";
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildFloor2(): THREE.Group {
  const g = new THREE.Group();
  g.name = "floor-2";
  const F = FRAME;
  const plinth = rbox(F.w + 28, 6, F.d + 28, floorMat("plinth", 1), F.x + F.w / 2, -10, F.z + F.d / 2, 2);
  plinth.castShadow = false;
  g.add(plinth);
  const slab = rbox(F.w, 3, F.d, floorMat("exterior", 1), F.x + F.w / 2, -3 - SLAB_DROP, F.z + F.d / 2, 1);
  slab.castShadow = false;
  g.add(slab);
  g.add(hallFloor());

  // ---- the curtain wall --------------------------------------------------------------------------
  const wallM = mat("wall", 0.96);
  const frameM = plastic("white");
  const glassM = facadeGlassMat();
  const glassH = WALL_H - SPANDREL_H - HEAD_H;
  for (const w of WALLS) {
    const along: "x" | "z" = w.w > w.d ? "x" : "z";
    const from = along === "x" ? w.x : w.z;
    const to = along === "x" ? w.x + w.w : w.z + w.d;
    const at = along === "x" ? w.z + w.d / 2 : w.x + w.w / 2;
    const put = (len: number, h: number, y0: number, centre: number, m: THREE.Material, t = WALL_T): THREE.Mesh =>
      along === "x" ? rbox(len, h, t, m, centre, y0, at, 0.6) : rbox(t, h, len, m, at, y0, centre, 0.6);
    const span = to - from, mid = (from + to) / 2;
    g.add(put(span, SPANDREL_H, 0, mid, wallM));
    g.add(put(span, HEAD_H, WALL_H - HEAD_H, mid, wallM));
    // the glazing: one pane per bay, with a mullion between bays and a sill/transom top and bottom
    g.add(put(span, 2, SPANDREL_H, mid, frameM, WALL_T * 0.8));
    g.add(put(span, 2, WALL_H - HEAD_H - 2, mid, frameM, WALL_T * 0.8));
    const bays = Math.max(1, Math.round(span / MULLION_PITCH));
    for (let i = 0; i <= bays; i++) {
      const at2 = from + (span * i) / bays;
      g.add(put(MULLION_W, glassH, SPANDREL_H, at2, frameM, WALL_T * 0.8));
    }
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(span - 2, glassH - 4), glassM);
    if (along === "x") pane.position.set(mid, SPANDREL_H + glassH / 2, at);
    else { pane.position.set(at, SPANDREL_H + glassH / 2, mid); pane.rotation.y = Math.PI / 2; }
    g.add(shadowed(pane, false, false));
  }

  // ---- architectural lighting --------------------------------------------------------------------
  // A PERIMETER COVE. Emissive rather than a real light, for the same reason the lift car's downlights
  // are: this renderer carries one key and one fill for the whole world and a per-room light would
  // recompile every material in it. There is no ceiling slab — Office View looks down at this floor.
  const coveM = emissiveMat("white", 1.0, 0.3);
  const inset = WALL_T + 1.4;
  for (const [x, z, w, d] of [
    [F.x + inset, F.z + inset, F.w - 2 * inset, 2],
    [F.x + inset, F.z + F.d - inset - 2, F.w - 2 * inset, 2],
    [F.x + inset, F.z + inset, 2, F.d - 2 * inset],
    [F.x + F.w - inset - 2, F.z + inset, 2, F.d - 2 * inset],
  ] as [number, number, number, number][]) {
    const strip = rbox(w, 1.6, d, coveM, x + w / 2, WALL_H - COVE_DROP, z + d / 2, 0.4);
    strip.castShadow = false;
    g.add(strip);
  }
  // THE DISTRICT (build/floor2Meeting) is built by app/world.ts beside this shell, because its doors,
  // displays and signs are driven live and the world needs the handles.
  // THE BUILDING'S ENVELOPE CASTS NOTHING INTO THE FLOOR. Its spandrel, head band and mullion grid are
  // 60 tall on every edge of a roofless plate: at a low sun they raked the whole floor in parallel bands
  // (the stripes across Summit and Vista). The envelope receives light and shadow; the district's own
  // architecture is what casts.
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = false; });
  return g;
}
