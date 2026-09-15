// vo3d build — SHARED ARCHITECTURAL DETAIL: the mouldings, casings and soffits that separate a plaster
// box from a built room. Everything here is axis-aligned and built in WORLD coordinates, like the rest of
// build/.
//
// THE ONE IDEA IN THIS FILE IS `profileRun`. Before it, every architectural moulding in the office was a
// stack of rounded boxes — a skirting was ONE box, so the wall met the floor along a single hard line with
// no undercut, no shadow gap and no top land, which is the detail the eye actually uses to read a wall as
// built rather than extruded. Stacking more boxes to fake a profile costs one draw call per step, and
// there are ~35 wall runs on this floor.
//
// An EXTRUDED PROFILE costs exactly one draw call whatever the silhouette, because the silhouette is in
// the cross-section rather than in the object count. So a skirting with a recessed shadow gap, a board
// face, a chamfer and a top land is the same price as today's single slab — and a cornice, a door
// architrave and a plinth reveal are all the same function with a different cross-section. That is why
// the profiles below are exported as data: a room asks for `SKIRTING`, not for a shape.
//
// NAVIGATION IS UNAFFECTED, BY CONSTRUCTION. nav/solids.ts never reads a THREE object (see its header):
// every obstruction comes from authored room data. Nothing in this file can move a wall, narrow a doorway
// or block a cell — it is purely what the camera sees.
import * as THREE from "three";
import { Baker, rbox, shadowed } from "./helpers";
import { mat, metal, type MatKey } from "../render/Materials";

export type Axis = "x" | "z";

/** A moulding cross-section as `[across, up]` pairs. `across` is measured OUT from the mounting plane in
 *  the run's `dir`; negative values are BURIED in the wall, which is how a moulding gets a clean top
 *  return with no seam. `up` is measured from the run's `y0`. Author them in either winding — the run
 *  normalises the polygon before extruding. */
export type Profile = readonly (readonly [number, number])[];

export type RunSpec = {
  /** the world axis the moulding RUNS along */
  axis: Axis;
  /** the mounting plane: world z for an x-run, world x for a z-run */
  at: number;
  from: number;
  to: number;
  /** base height of the profile */
  y0: number;
  /** +1 = the profile projects toward increasing `at`, −1 = decreasing. This is the ROOM side of the wall. */
  dir?: 1 | -1;
  material: THREE.Material;
  name?: string;
};

/** Normalise a profile into a COUNTER-CLOCKWISE shape after the `sign` flip, so ExtrudeGeometry's face
 *  normals point out of the moulding rather than into it. Doing this by signed area rather than by asking
 *  the caller to author two windings is what lets one profile constant serve all four wall orientations. */
function shapeFrom(profile: Profile, sign: number): THREE.Shape {
  const pts = profile.map(([across, up]) => new THREE.Vector2(sign * across, up));
  let twice = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    twice += a.x * b.y - b.x * a.y;
  }
  if (twice < 0) pts.reverse();
  return new THREE.Shape(pts);
}

/** Extrude `profile` along `spec.axis` as ONE mesh.
 *
 *  AXIS MAPPING, stated as it actually is (the same care build/helpers' `slab` takes). ExtrudeGeometry
 *  lays the shape in local XY and extrudes along local +z, so:
 *    • a z-run needs NO rotation      — shape x → world x, extrusion → world z
 *    • an x-run is rotated +π/2 about Y — local z → world x, local x → world −z
 *  which is why the x-run's profile carries `-dir` and the z-run's carries `+dir`: both land the profile
 *  at `at + dir * across`. Get this wrong and every skirting in the office ends up inside its wall. */
export function profileRun(profile: Profile, spec: RunSpec): THREE.Mesh {
  const dir = spec.dir ?? 1;
  const len = Math.max(0.01, spec.to - spec.from);
  const sign = spec.axis === "x" ? -dir : dir;
  const geo = new THREE.ExtrudeGeometry(shapeFrom(profile, sign), { depth: len, bevelEnabled: false, curveSegments: 1 });
  const mesh = new THREE.Mesh(geo, spec.material);
  if (spec.axis === "x") {
    mesh.rotation.y = Math.PI / 2;
    mesh.position.set(spec.from, spec.y0, spec.at);
  } else {
    mesh.position.set(spec.at, spec.y0, spec.from);
  }
  mesh.name = spec.name ?? "profile-run";
  return shadowed(mesh);
}

// ---- the profile library ---------------------------------------------------------------------------

/** SKIRTING / BASEBOARD. 2.2 tall, 0.9 proud, 0.6 buried.
 *
 *  Reading it from the floor up: a recessed toe (0.45) that leaves a genuine SHADOW GAP where the board
 *  meets the tile, the step out to the board face, the face itself, a chamfer back to a narrow top land.
 *  That gap is the whole point — a single slab standing on the floor has its darkest line at the top,
 *  which is backwards, and it is why the old one-box skirting read as a painted stripe. */
export const SKIRTING: Profile = [
  [-0.6, 0], [0.45, 0], [0.45, 0.3], [0.9, 0.5], [0.9, 1.5], [0.6, 1.85], [0.6, 2.2], [-0.6, 2.2],
];

/** CEILING CORNICE / SOFFIT EDGE. 7.0 tall, 2.4 proud at its widest.
 *
 *  THE OFFICE HAS NO CEILINGS AND MUST NOT GROW ANY: the camera looks down into every room from outside,
 *  so a ceiling slab would simply black the room out. But a room with nothing at the top of its walls has
 *  no ceiling DEPTH either — the walls just stop, which is exactly what makes a 2.5D room read as an
 *  open-topped box. A cornice is how a real interior states its ceiling plane at the wall: a shadow-gap
 *  nose, a cove ramp out to the fascia, and the ceiling land itself. From the game camera the eye reads a
 *  dropped ceiling edge above every wall and stops asking where the ceiling is. */
export const CORNICE: Profile = [
  [-0.6, 0], [1.0, 0], [1.0, 0.45], [0.4, 0.85], [0.4, 1.7], [2.0, 3.3], [2.0, 5.0], [2.4, 5.5], [2.4, 7.0], [-0.6, 7.0],
];

/** WORKTOP / COUNTER NOSING. A bullnose front edge for a slab whose top sits at `y0 + 1.8`: the drip
 *  return underneath is what keeps a counter from reading as a sheet of card. */
export const NOSING: Profile = [
  [-0.8, 0.35], [0.55, 0.35], [0.85, 0.75], [0.85, 1.45], [0.5, 1.8], [-0.8, 1.8], [-0.8, 1.15], [-0.45, 1.0], [-0.45, 0.6],
];

/** CABINETRY PLINTH / TOE-KICK REVEAL. The dark recess a carcass stands on, with the shadow line above
 *  it — the detail that makes joinery read as a built-in rather than as a box resting on the floor. */
export const PLINTH: Profile = [
  [-0.4, 0], [0.5, 0], [0.5, 2.6], [0.9, 3.0], [0.9, 3.6], [-0.4, 3.6],
];

// ---- the shared helpers rooms actually call ----------------------------------------------------------

export type SkirtSpec = Omit<RunSpec, "material" | "axis"> & { axis: Axis; key: MatKey; roughness?: number };

/** A room's baseboard along one wall face. Replaces the single-box `skirting()` that five room builders
 *  each carried their own copy of — same call shape, same `at` plane, same colour key, one real profile. */
export function skirting(spec: SkirtSpec): THREE.Mesh {
  return profileRun(SKIRTING, {
    axis: spec.axis, at: spec.at, from: spec.from + 0.5, to: spec.to - 0.5, y0: spec.y0, dir: spec.dir,
    material: mat(spec.key, spec.roughness ?? 0.7),
    name: spec.name ?? "skirting",
  });
}

/** A span along a wall run that a moulding must not cross. */
export type RunGap = { from: number; to: number };

/** SPLIT A RUN SO IT ROUTES AROUND WHAT IS ALREADY ON THE WALL.
 *
 *  A cornice hangs in the top 7 units of a 46-unit wall, and some walls in this office have an authored
 *  display up there: the Design Room's mantra whiteboard reaches y 50, its left-hand boards reach 44. A
 *  moulding run straight through one of those crosses its FACE — the moulding stands 2.4 proud and the
 *  board's face is 1.4 proud, so the trim is drawn in front of the artwork and cuts the text in half.
 *
 *  Terminating the run either side is what a real ceiling trim does when it meets a wall-mounted panel,
 *  and it is the only option here that leaves the authored display untouched. `clear` is the breathing
 *  space left on each side. Segments shorter than 2 units are dropped rather than drawn as stubs. */
export function runSegments(from: number, to: number, gaps: readonly RunGap[] = [], clear = 3): RunGap[] {
  let out: RunGap[] = [{ from, to }];
  for (const g of gaps) {
    const lo = g.from - clear, hi = g.to + clear;
    out = out.flatMap((s) => {
      if (hi <= s.from || lo >= s.to) return [s]; //                         the gap misses this segment
      const parts: RunGap[] = [];
      if (lo - s.from > 2) parts.push({ from: s.from, to: lo });
      if (s.to - hi > 2) parts.push({ from: hi, to: s.to });
      return parts;
    });
  }
  return out;
}

export type CorniceSpec = SkirtSpec & {
  /** the wall's total height; the cornice hangs from its top */
  wallHeight: number;
};

/** A room's ceiling cornice along one wall face, hung from `wallHeight`. Pass the SAME runs the room
 *  skirts — by construction those are its plain solid faces, so a cornice can never land on a feature. */
export function cornice(spec: CorniceSpec): THREE.Mesh {
  return profileRun(CORNICE, {
    axis: spec.axis, at: spec.at, from: spec.from + 0.5, to: spec.to - 0.5,
    y0: spec.wallHeight - 7.0, dir: spec.dir,
    material: mat(spec.key, spec.roughness ?? 0.94),
    name: spec.name ?? "cornice",
  });
}

export type DoorCasingSpec = {
  /** the wall the opening is in: "x" = the wall runs along x, so the opening spans x */
  axis: Axis;
  /** the wall's CENTRE plane (world z for an x-wall, world x for a z-wall) */
  at: number;
  /** wall thickness; the casings stand on its two faces */
  thickness: number;
  /** the clear opening, along the wall */
  from: number;
  to: number;
  /** clear opening height — the head casing sits ON this, never in it */
  height: number;
  casing: MatKey;
  /** the flush floor strip across the threshold. Omit for no threshold. */
  threshold?: MatKey;
  /** which faces are cased; both by default */
  faces?: readonly (1 | -1)[];
  name?: string;
};

/** ARCHITRAVE + THRESHOLD around a doorway.
 *
 *  NOTHING HERE ENTERS THE OPENING, and that is deliberate rather than cautious: every door on this floor
 *  has a sliding or bi-parting LEAF sized to its clear opening, so a jamb lining inside the reveal would
 *  be geometry for a leaf to drive through. So the casing flanks the opening horizontally (outside
 *  `from`…`to`) and heads it above `height`, standing proud of both wall faces — which is where an
 *  architrave belongs anyway. The one piece that crosses the opening is the threshold, laid flush at 0.3
 *  in exactly the way the Design Room's glass run already lays its floor track.
 *
 *  Baked per material, so a whole doorway — six casing members on two faces plus the strip — costs two
 *  draw calls instead of seven. */
export function doorCasing(spec: DoorCasingSpec): THREE.Group {
  const g = new THREE.Group();
  g.name = spec.name ?? "door-casing";
  const T = spec.thickness, CW = 3.2, CH = 2.6, PROJ = 1.1;
  const casingM = mat(spec.casing, 0.7);
  const b = new Baker();
  const put = (from: number, to: number, y0: number, h: number, face: 1 | -1) => {
    const at = spec.at + face * (T / 2 + PROJ / 2);
    b.add(spec.axis === "x"
      ? rbox(to - from, h, PROJ, casingM, (from + to) / 2, y0, at, 0.25)
      : rbox(PROJ, h, to - from, casingM, at, y0, (from + to) / 2, 0.25));
  };
  for (const face of spec.faces ?? ([1, -1] as const)) {
    put(spec.from - CW, spec.from, 0, spec.height + CH, face); //        jamb casing, near side
    put(spec.to, spec.to + CW, 0, spec.height + CH, face); //             jamb casing, far side
    put(spec.from - CW, spec.to + CW, spec.height, CH, face); //          head casing
  }
  b.bakeInto(g, spec.name ?? "door-casing");
  if (spec.threshold) {
    const t = spec.axis === "x"
      ? rbox(spec.to - spec.from, 0.3, T + 1.2, mat(spec.threshold, 0.5), (spec.from + spec.to) / 2, 0, spec.at, 0.1)
      : rbox(T + 1.2, 0.3, spec.to - spec.from, mat(spec.threshold, 0.5), spec.at, 0, (spec.from + spec.to) / 2, 0.1);
    t.castShadow = false;
    g.add(t);
  }
  return g;
}

export type GlazingBeadSpec = {
  axis: Axis;
  at: number;
  from: number;
  to: number;
  /** glass bottom and top */
  y0: number;
  y1: number;
  /** the frame's thickness, so the bead sits proud of both faces of the glass */
  t: number;
  name?: string;
};

/** GLAZING GASKET / BEAD. Two slim brushed lines where a pane meets its sill and its head.
 *
 *  A frameless pane in this office is a single-sided plane with no thickness, so the moment the camera is
 *  anywhere but square-on the glass reads as a tinted rectangle floating in a hole. The bead is what real
 *  glazing has and what gives the opening DEPTH: it puts a lit edge on the two long joints, so the eye
 *  reads "a sheet set into a frame" instead of "a coloured quad". Two meshes for a whole run. */
export function glazingBead(spec: GlazingBeadSpec): THREE.Group {
  const g = new THREE.Group();
  g.name = spec.name ?? "glazing-bead";
  const len = spec.to - spec.from, mid = (spec.from + spec.to) / 2;
  const m = metal();
  for (const y of [spec.y0, spec.y1 - 0.7]) {
    const bead = spec.axis === "x"
      ? rbox(len, 0.7, spec.t * 1.45, m, mid, y, spec.at, 0.18)
      : rbox(spec.t * 1.45, 0.7, len, m, spec.at, y, mid, 0.18);
    g.add(bead);
  }
  return g;
}
