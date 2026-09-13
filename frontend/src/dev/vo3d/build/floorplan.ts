// vo3d build — the shared GROUND-FLOOR architectural skeleton in WORLD coordinates: one slab for the
// whole frame, the sidewalk, and for every unreconstructed room its footprint plate + boundary walls with
// the hand-painted door openings carved out. Deliberately lightweight: ~75 meshes over 4 shared materials.
// Room interiors (desks, chairs, plants, glass runs …) are NOT built here — they are per-room phases.
import * as THREE from "three";
import { rbox } from "./helpers";
import { mat } from "../render/Materials";
import type { Facing, Rect } from "../core/coords";
import { roomSouthZ, type FloorRoom, type GroundFloor } from "../rooms/ground-floor";

const PLINTH_MARGIN = 48;
/** how far the shared hall slab sits below the rooms' tiled floors, so neither needs a depth bias */
const SLAB_DROP = 0.05;
/** how far the shared front ledge stands proud of the hall slab — enough to win the depth test, far too
 *  little to read as a step (the sidewalk beyond it is already 0.2 proud). */
const LEDGE_LIFT = 0.08;

export function buildGroundFloor(plan: GroundFloor): THREE.Group {
  const g = new THREE.Group();
  g.name = "ground-floor";
  const F = plan.frame;
  const plinth = rbox(F.w + 2 * PLINTH_MARGIN, 5, F.d + 2 * PLINTH_MARGIN, mat("plinth", 1), F.x + F.w / 2, -8, F.z + F.d / 2, 2);
  plinth.castShadow = false;
  g.add(plinth);
  // The hall floor: the V1 floor.png tone (measured 219,202,187 ≈ PALETTE.exterior). Its top face sits
  // SLAB_DROP below y = 0 rather than exactly on it. The rooms' tiled floors are at y = 0, and when the two
  // were coplanar the tile needed a polygonOffset to win — a depth bias that scales with screen-space slope
  // and, at wide zoom, grew until the floor swallowed the rugs and inlays lying on it. A constant gap is
  // unambiguous at every zoom and is 0.05 units across a 1440-unit floor: invisible.
  const slab = rbox(F.w, 3, F.d, mat("exterior", 1), F.x + F.w / 2, -3 - SLAB_DROP, F.z + F.d / 2, 1);
  slab.castShadow = false;
  g.add(slab);
  const S = plan.sidewalk;
  const sidewalk = rbox(S.w, 3.2, S.d, mat("sidewalk", 0.95), S.x + S.w / 2, -3, S.z + S.d / 2, 0.6);
  sidewalk.castShadow = false;
  g.add(sidewalk);
  // the shared exterior ledge between the street façade and the sidewalk, spanning the WHOLE front row —
  // one piece of continuous ground-floor architecture, not per-room geometry
  const front = plan.rooms.filter((r) => r.rect.z + r.rect.d > plan.facadeZ);
  if (front.length) {
    const x0 = Math.min(...front.map((r) => r.rect.x)), x1 = Math.max(...front.map((r) => r.rect.x + r.rect.w));
    const z0 = plan.facadeZ + plan.shell.wallThickness;
    // +LEDGE_LIFT for the same reason the footprint plates carry plateLift: a top face at exactly y = 0 is
    // coplanar with the hall slab over 1424 x 35 units and z-fights across the whole street frontage.
    const ledge = rbox(x1 - x0, 1.6 + LEDGE_LIFT, Math.max(0, S.z - z0), mat("plinth", 1), (x0 + x1) / 2, -1.6, (z0 + S.z) / 2, 0.3);
    ledge.castShadow = false;
    g.add(ledge);
  }
  for (const room of plan.rooms) if (!room.reconstructed) g.add(buildFootprint(room, plan));
  return g;
}

/** Footprint plate (+0.5 lip so it never z-fights the slab) and, for walled rooms, the boundary walls:
 *  rear/side walls full height, front (south) wall low — the same 2.5D language as the Design Room shell. */
export function buildFootprint(room: FloorRoom, plan: GroundFloor): THREE.Group {
  const g = new THREE.Group();
  g.name = `footprint:${room.id}`;
  const r = room.rect;
  const { wallThickness: T, wallHeight: H, frontWallHeight: FH, capRadius: R, doorHeight: DH, plateLift } = plan.shell;
  const inset = room.walls ? T : 0;
  // front-row rooms stop at the SHARED façade plane, not at their own art bounding box (see roomSouthZ)
  const zEnd = roomSouthZ(room, plan);
  const plate = rbox(r.w - 2 * inset, 1 + plateLift, zEnd - r.z - 2 * inset, mat("floor", 0.82), r.x + r.w / 2, -1, (r.z + zEnd) / 2, 0.3);
  plate.castShadow = false;
  g.add(plate);
  if (!room.walls) return g;
  const wallM = mat("wall", 0.96);
  const openings = plan.openings.filter((o) => o.roomId === room.id);
  const sides: { side: Facing; axis: "x" | "z"; at: number; from: number; to: number; h: number }[] = [
    { side: "north", axis: "x", at: r.z + T / 2, from: r.x, to: r.x + r.w, h: H },
    { side: "south", axis: "x", at: zEnd - T / 2, from: r.x, to: r.x + r.w, h: FH },
    { side: "west", axis: "z", at: r.x + T / 2, from: r.z, to: zEnd, h: H },
    { side: "east", axis: "z", at: r.x + r.w - T / 2, from: r.z, to: zEnd, h: H },
  ];
  for (const s of sides) {
    const gaps = openings.filter((o) => o.side === s.side).sort((a, b) => a.from - b.from);
    let cursor = s.from;
    for (const o of gaps) {
      const a = Math.max(s.from, o.from), b = Math.min(s.to, o.to);
      if (a > cursor) g.add(run(s.axis, s.at, cursor, a, s.h, T, wallM, R));
      if (s.h > DH) g.add(header(s.axis, s.at, a, b, DH, s.h, T, wallM, R)); // doorway header over a full-height wall
      cursor = Math.max(cursor, b);
    }
    if (cursor < s.to) g.add(run(s.axis, s.at, cursor, s.to, s.h, T, wallM, R));
  }
  return g;
}

/** a wall run along `axis` at the fixed coordinate `at`, from → to, base at y 0 */
function run(axis: "x" | "z", at: number, from: number, to: number, h: number, T: number, m: THREE.Material, R: number): THREE.Mesh {
  return axis === "x" ? rbox(to - from, h, T, m, (from + to) / 2, 0, at, R) : rbox(T, h, to - from, m, at, 0, (from + to) / 2, R);
}
function header(axis: "x" | "z", at: number, from: number, to: number, y0: number, top: number, T: number, m: THREE.Material, R: number): THREE.Mesh {
  return axis === "x" ? rbox(to - from, top - y0, T, m, (from + to) / 2, y0, at, R) : rbox(T, top - y0, to - from, m, at, y0, (from + to) / 2, R);
}

/** world rects of every wall run (for tests/devtools: proves footprints, not visuals) */
export function footprintWallRects(room: FloorRoom, plan: GroundFloor): Rect[] {
  const out: Rect[] = [];
  buildFootprint(room, plan).traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const p = (m.geometry as THREE.BoxGeometry).parameters as { width?: number; depth?: number } | undefined;
    if (!p) return;
    if (p.width === undefined || p.depth === undefined || m.position.y < 0) return; // plate sits below y 0
    out.push({ x: m.position.x - p.width / 2, z: m.position.z - p.depth / 2, w: p.width, d: p.depth });
  });
  return out;
}
