// vo3d build — SHARED ROOM-DRESSING DETAIL: the small, shared vocabulary the final V2 room art pass uses.
//
// ============================= THE ART-DIRECTION RULE THIS FILE OBEYS =============================
// ARCHITECTURE, EXISTING FURNITURE, MATERIALS AND LIGHTING PROVIDE MOST OF THE RICHNESS.
// ROOM-SPECIFIC PROPS ARE SECONDARY.
//
// The first draft of this pass got that backwards. It added a flipchart, a stack of archive boxes, a
// standing lamp, a water cooler, a nameplate and a card wall to nearly every room, and the live review
// was unambiguous: objects leaning in gaps, boards floating in front of sofas, box stacks tilted against
// plants, decorative furniture placed because a patch of floor looked empty. A premium room needs
// INTENTIONAL NEGATIVE SPACE, and V1/V2's authored composition is the composition — a detail pass does
// not get to change it.
//
// So what survived is what an ARCHITECT would have drawn, not what a set dresser would have carried in:
//
//   • `counterNosing` / `toeKick` — the two remaining build/arch profiles, as edges on joinery that
//     already exists. These are the highest-value additions in the whole pass: every counter in the
//     office met the air on a square arris and read as a sheet of card at the game camera.
//   • `cupStack` / `trophyRow` — service and display ON a surface that already exists and whose purpose
//     is to carry exactly that (a café worktop; a media console).
//   • `pinBoard` — a wall's AUTHORED content, where the flat reference actually hangs a board.
//   • `buntingRun` — one room-defining decoration, in the one room whose brief is celebratory.
//
// And the test for adding anything else is: does the object have a believable functional location that
// the room already implies? If it is uncertain, it does not go in.
//
// THE THREE MECHANICAL RULES, unchanged:
//
//  1. READABLE AT THE GAME CAMERA. ~2 px per world unit, looking down from the south at 52°. Everything
//     here is sized in TENS of units and puts its information on a south- or up-facing surface.
//  2. BAKED. n repeated pieces cost one draw call per material, not one per piece.
//  3. WORLD COORDINATES, AXIS-ALIGNED, NAV-INERT. nav/solids.ts never reads a THREE object, so nothing
//     here can block a cell, narrow a doorway or move a wall.
import * as THREE from "three";
import { Baker, cyl, lathe, rbox, shadowed } from "./helpers";
import { profileRun, NOSING, PLINTH, type Axis } from "./arch";
import { mat, type MatKey } from "../render/Materials";

// ---- the shared mounting frame ----------------------------------------------------------------------

/** Where a wall- or carcass-mounted detail sits: the run's `axis`, the mounting plane `at`, and `dir` —
 *  the ROOM side of that plane. Identical in shape and meaning to build/arch's RunSpec, deliberately: a
 *  room that can call `skirting` already knows how to call everything here. */
export type Mount = { axis: Axis; at: number; dir: 1 | -1 };

/** A box placed against a mounting plane. `along` is the span down the run, `off` how far the box's NEAR
 *  face stands off the plane, `thick` its depth out of it. Folding the four axis/direction cases into one
 *  closure is what keeps the builders below free of orientation arithmetic. */
function mounter(m: Mount) {
  return (alongC: number, alongLen: number, y0: number, h: number, off: number, thick: number, material: THREE.Material, r = 0.2): THREE.Mesh => {
    const across = m.at + m.dir * (off + thick / 2);
    return m.axis === "x"
      ? rbox(alongLen, h, thick, material, alongC, y0, across, r)
      : rbox(thick, h, alongLen, material, across, y0, alongC, r);
  };
}

// ---- 1 + 2: the two remaining arch profiles, as room-facing helpers -----------------------------------

export type EdgeSpec = Mount & { from: number; to: number; /** the finished TOP of the counter */ top: number; key: MatKey; roughness?: number; name?: string };

/** WORKTOP NOSING along a counter's front edge. The NOSING profile puts its top face 1.8 above its own
 *  `y0`, so this takes the counter's FINISHED top and does that arithmetic once — every call site in the
 *  office was otherwise going to subtract 1.8 by hand and one of them was going to get it wrong. */
export function counterNosing(spec: EdgeSpec): THREE.Mesh {
  return profileRun(NOSING, {
    axis: spec.axis, at: spec.at, from: spec.from, to: spec.to, y0: spec.top - 1.8, dir: spec.dir,
    material: mat(spec.key, spec.roughness ?? 0.45), name: spec.name ?? "counter-nosing",
  });
}

export type PlinthSpec = Mount & { from: number; to: number; y0?: number; key: MatKey; roughness?: number; name?: string };

/** CABINETRY TOE-KICK along the base of a carcass: the dark recess and the shadow line above it that make
 *  joinery read as built-in rather than as a box standing on the floor. */
export function toeKick(spec: PlinthSpec): THREE.Mesh {
  return profileRun(PLINTH, {
    axis: spec.axis, at: spec.at, from: spec.from, to: spec.to, y0: spec.y0 ?? 0, dir: spec.dir,
    material: mat(spec.key, spec.roughness ?? 0.85), name: spec.name ?? "toe-kick",
  });
}

// ---- 3: the pinboard --------------------------------------------------------------------------------

export type PinBoardSpec = Mount & {
  from: number; to: number; y0: number; y1: number;
  /** the surround */
  frame: MatKey;
  /** the board field behind the cards */
  board: MatKey;
  /** the pinned cards, cycled across the field. Two or three colours read; six is confetti. */
  cards: readonly MatKey[];
  /** cards across × cards down. Keep the card bigger than ~8 units or the camera loses it. */
  cols?: number;
  rows?: number;
  name?: string;
};

/** A FRAMED BOARD OF PINNED CARDS.
 *
 *  NOT a decoration to hang on a bare wall — see the art-direction rule at the top of this file. It is
 *  here because one wall in the office (QA's, east of its storage run) has a work-rate board in the flat
 *  reference that the 3D build never reconstructed, and this is how that authored content gets built.
 *
 *  The card field is deterministic, not random: card `i` takes its colour, its size trim and its slight
 *  slouch from `i` alone, so a rebuild is identical and a test can assert the field's extent. Every card
 *  in one colour bakes to one mesh, so the whole field costs the frame, the board and two or three cards.
 *
 *  HEIGHT. A room's cornice occupies the top 7 units of its 46-unit wall, so a board's `y1` belongs below
 *  ~38 or it collides with the moulding. */
export function pinBoard(spec: PinBoardSpec): THREE.Group {
  const g = new THREE.Group();
  g.name = spec.name ?? "pin-board";
  const put = mounter(spec);
  const len = spec.to - spec.from, h = spec.y1 - spec.y0, c = (spec.from + spec.to) / 2;
  g.add(put(c, len, spec.y0, h, 0, 1.8, mat(spec.frame, 0.7), 0.4)); //                 the surround
  g.add(put(c, len - 3.2, spec.y0 + 1.6, h - 3.2, 1.8, 0.4, mat(spec.board, 0.92), 0.1)); // the field
  const cols = spec.cols ?? 4, rows = spec.rows ?? 3;
  const cw = (len - 8) / cols, ch = (h - 8) / rows;
  const b = new Baker();
  for (let i = 0; i < cols * rows; i++) {
    const cxi = i % cols, cyi = Math.floor(i / cols);
    // deterministic per-card trim: two coprime strides give a field that reads hand-pinned, never a grid
    const trim = 0.72 + ((i * 7) % 5) * 0.05;
    const nudge = (((i * 3) % 5) - 2) * 0.35;
    b.add(put(
      spec.from + 4 + cw * (cxi + 0.5) + nudge, cw * trim,
      spec.y0 + 4 + ch * cyi + ch * (1 - trim) / 2, ch * trim,
      2.2, 0.35, mat(spec.cards[i % spec.cards.length], 0.85), 0.08,
    ));
  }
  b.bakeInto(g, `${spec.name ?? "pin-board"}-cards`);
  g.traverse((o) => { o.castShadow = false; }); // a 0.35-thick card on a wall casts nothing worth drawing
  return g;
}

// ---- 4: the bunting run -----------------------------------------------------------------------------

export type BuntingSpec = {
  axis: Axis; at: number; from: number; to: number; y: number; sag?: number;
  colors: readonly MatKey[]; count?: number;
  /** pennant length and width. Small by default, and deliberately: a room on this floor has a 46-unit
   *  wall head and a 36-unit body walking under it, so the whole band a hung decoration may occupy is
   *  ten units deep. Big bunting in here is bunting the player walks through. */
  drop?: number; width?: number;
  name?: string;
};

/** A RUN OF PENNANTS on a sagging cord, spanning between two walls the room already has.
 *
 *  The one purely decorative builder that survived the art-direction correction, and only for the Gaming
 *  Room, whose brief is explicitly celebratory. Every pennant of one colour bakes to one mesh. */
export function buntingRun(spec: BuntingSpec): THREE.Group {
  const g = new THREE.Group();
  g.name = spec.name ?? "bunting";
  const n = spec.count ?? 12, sag = spec.sag ?? 2, len = spec.to - spec.from;
  const drop = spec.drop ?? 6, halfW = (spec.width ?? 5) / 2;
  // the cord: short chords following the catenary, one bake
  const cord = new Baker();
  const cordM = mat("charcoal", 0.8);
  const yAt = (t: number): number => spec.y - sag * Math.sin(Math.PI * t);
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    const a0 = spec.from + len * t0, a1 = spec.from + len * t1;
    const y0 = yAt(t0), y1 = yAt(t1);
    const seg = cord.add(rbox(Math.hypot(a1 - a0, y1 - y0), 0.5, 0.5, cordM, 0, 0, 0, 0.1));
    const put = { along: (a0 + a1) / 2, y: (y0 + y1) / 2 };
    if (spec.axis === "x") { seg.position.set(put.along, put.y, spec.at); seg.rotation.z = Math.atan2(y1 - y0, a1 - a0); }
    else { seg.position.set(spec.at, put.y, put.along); seg.rotation.x = -Math.atan2(y1 - y0, a1 - a0); seg.rotation.order = "YXZ"; seg.rotation.y = Math.PI / 2; }
  }
  cord.bakeInto(g, `${spec.name ?? "bunting"}-cord`);
  // the pennants: a triangle hanging from each chord midpoint
  const tri = new THREE.Shape();
  tri.moveTo(-halfW, 0); tri.lineTo(halfW, 0); tri.lineTo(0, -drop); tri.closePath();
  const geo = new THREE.ExtrudeGeometry(tri, { depth: 0.4, bevelEnabled: false, curveSegments: 1 });
  const flags = new Baker();
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const flag = new THREE.Mesh(geo, mat(spec.colors[i % spec.colors.length], 0.88, { side: THREE.DoubleSide }));
    const along = spec.from + len * t;
    if (spec.axis === "x") flag.position.set(along, yAt(t) - 0.4, spec.at);
    else { flag.position.set(spec.at, yAt(t) - 0.4, along); flag.rotation.y = Math.PI / 2; }
    flag.rotation.z = (((i * 7) % 5) - 2) * 0.05; // a little life in the hang
    flags.add(shadowed(flag, false, false));
  }
  flags.bakeInto(g, `${spec.name ?? "bunting"}-flags`);
  geo.dispose();
  g.traverse((o) => { o.castShadow = false; });
  return g;
}

// ---- 5 + 6: what belongs ON a surface that exists to carry it ----------------------------------------

export type CupStackSpec = { x: number; y0: number; z: number; columns?: number; key: MatKey; name?: string };

/** CUPS AND SAUCERS on a café worktop. Tiny, but it is the difference between "a worktop" and "a place
 *  that serves coffee", it sits where crockery actually sits, and it bakes to one mesh. */
export function cupStack(spec: CupStackSpec): THREE.Group {
  const g = new THREE.Group();
  g.name = spec.name ?? "cup-stack";
  const cols = spec.columns ?? 3, m = mat(spec.key, 0.4);
  const b = new Baker();
  for (let i = 0; i < cols; i++) {
    const x = spec.x + (i - (cols - 1) / 2) * 7.5;
    const n = 2 + (i % 2);
    b.add(cyl(3.1, 0.4, m, x, spec.y0, spec.z, 3.1)); // saucer
    for (let k = 0; k < n; k++) b.add(cyl(2.2, 2.6, m, x, spec.y0 + 0.4 + k * 2.4, spec.z, 2.5));
  }
  b.bakeInto(g, spec.name ?? "cup-stack");
  return g;
}

/** A ROW OF AWARD CUPS along a run of shelf or console top — a revolved cup on a plinth, baked.
 *  For a surface whose job is display; not for standing on the floor. */
export function trophyRow(x0: number, x1: number, y0: number, z: number, n: number, key: MatKey, name = "trophy-row"): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  const m = mat(key, 0.35, { metalness: 0.65 });
  const b = new Baker();
  for (let i = 0; i < n; i++) {
    const x = x0 + ((x1 - x0) * (i + 0.5)) / n;
    const h = 7.5 + (i % 3) * 2.2;
    b.add(rbox(5.4, 1.6, 5.4, mat("charcoal", 0.6), x, y0, z, 0.3));
    b.add(lathe([[0, 0], [1.5, 0], [1.1, 1.2], [0.7, 2.4], [2.6, 3.6], [3.0, h - 1.2], [2.3, h], [0, h]], m, x, y0 + 1.6, z, 14));
  }
  b.bakeInto(g, name);
  return g;
}
