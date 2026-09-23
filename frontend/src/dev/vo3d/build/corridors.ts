// vo3d build — THE SERVICE CORRIDORS: the two north-south slots between the top row of rooms.
//
// V1 draws these as furnished circulation, and they were the last part of the ground floor with no V2
// reconstruction: the corridors existed only as bare hall tile with an OPEN north end, so a player walking
// up either of them looked straight out of the building through a hole in the north elevation.
//
// The composition is V1's, not invented — it is read straight off assets/office/decor/vendo-machine-left
// .png and -right.png, whose manifest boxes (x 340.6…501.1 and 955.3…1115.8, z 17.5…228.8) land exactly on
// these two corridors:
//
//   • a framed GLASS WINDOW closing the corridor's north end, with planting visible beyond it
//   • a tall FLOOR PLANT in each of the two north corners, just inside the glass
//   • two VENDING MACHINES against each side wall, in the two z clusters the art puts them in, with small
//     pots on their tops
//
// WALKABILITY IS UNTOUCHED, AND V1 ALREADY AGREES WITH THIS. The V1 grid blocks a 32-unit band against
// each corridor side wall (cols 21–22 and 29–30 in the west corridor, 59–61 and 68–70 in the east) and
// every row north of z 48 — which is to say V1 already reserves exactly the floor these machines, plants
// and the window stand on, because V1 drew them there. Nothing here is walkable floor being taken away,
// and nav/solids.ts never reads a THREE object in any case.
import * as THREE from "three";
import { rbox, resetSeed, shadowed } from "./helpers";
import { glassRun } from "./frontbar";
import { mediumPlant } from "./plants";
import { finalizeSucculents, smallPot } from "./props";
import { vendingMachine, VENDING_SIZE, type VendingKind } from "./vending";
import { mat } from "../render/Materials";
import { STRUCT } from "../rooms/reception";
import type { SwayNode } from "../render/Sway";

/** One corridor: the two room wall faces that bound it, and the composition between them. */
type Corridor = {
  id: string;
  /** inner face of the room wall on the WEST side of the corridor */
  westX: number;
  /** inner face of the room wall on the EAST side */
  eastX: number;
  /** what each side wall's two machines sell, north cluster first — as the V1 panels show them */
  west: readonly [VendingKind, VendingKind];
  east: readonly [VendingKind, VendingKind];
};

/** THE NORTH ELEVATION BAND. The rooms either side put their north wall between z 8 and z 20, so the
 *  corridor's window stands on the same plane — the building gets one continuous north face instead of two
 *  walls with a gap between them. */
const NORTH_Z = 8, NORTH_OUTER_Z = 20, NORTH_T = 4;
/** the window's own plane: the CENTRE of that band, not its north face.
 *
 *  `glassRun`'s capping rail is deliberately 2.6× the run thickness (it is what actually draws the head
 *  line from the game camera — see build/frontbar), so a run pushed to the north face would put its rail
 *  10 units proud of the building's north elevation and out over the plinth. Centred in the band at
 *  t = 4, the whole assembly — shoe, posts, panes, rail — stays inside z 8…20 with the rooms' own walls. */
const GLASS_Z = (NORTH_Z + NORTH_OUTER_Z) / 2;
/** z of the two machine clusters' centres, from the art's two dark blocks (≈91 and ≈162 of its 17.5…228.8 box) */
const CLUSTER_Z = [91, 162] as const;
/** the corner plants, just inside the glass — the art centres them at ≈39 */
const PLANT_Z = 40;

const CORRIDORS: readonly Corridor[] = [
  // AI ↔ Executive. The left art panel: crisps and a cold-drinks machine on the west wall, a combo and a
  // second cold-drinks machine on the east.
  { id: "ai-executive", westX: 344, eastX: 494, west: ["snack", "drinks"], east: ["combo", "drinks"] },
  // Executive ↔ Dev. The right panel reads the same way round.
  { id: "executive-dev", westX: 958, eastX: 1111, west: ["combo", "drinks"], east: ["snack", "drinks"] },
];

/** The planting the V1 art shows THROUGH the corridor window: a low clipped bed in the setback north of
 *  the glass. Deliberately a hedge and not a plant — it is read at a glancing angle through two panes from
 *  inside the building, so what has to be right is the mass and the tone, not the leaf. */
function hedgeBeyond(x0: number, x1: number): THREE.Group {
  const g = new THREE.Group();
  g.name = "corridor-hedge";
  const w = x1 - x0, cx = (x0 + x1) / 2;
  // the bed sits in the SETBACK north of the glass (z 0…8), clear of the window's capping rail
  const BED_Z = 4.0;
  const trough = rbox(w, 3.0, 6.4, mat("plinth", 1), cx, -0.4, BED_Z, 0.4);
  trough.castShadow = false;
  g.add(trough);
  // the clipped mass, as overlapping lumps so its top is not a ruled line
  const n = Math.max(3, Math.round(w / 34));
  for (let i = 0; i < n; i++) {
    const seg = w / n;
    g.add(rbox(seg * 1.04, 5.2 + (i % 2) * 0.9, 5.2, mat("foliage", 0.9), x0 + seg * (i + 0.5), 2.4, BED_Z, 1.9, 2));
  }
  return g;
}

/** Both corridors' fit-out, in WORLD space. Called from build/floorplan's ground-floor build, because
 *  this is shared circulation architecture and belongs to no room. */
export function buildCorridors(): THREE.Group {
  const root = new THREE.Group();
  root.name = "corridors";
  // the plants use the shared deterministic LCG; reset it so a rebuild is identical, exactly as
  // SceneMirror.buildRoom does per room
  resetSeed();
  const sway: SwayNode[] = [];

  for (const c of CORRIDORS) {
    const g = new THREE.Group();
    g.name = `corridor:${c.id}`;

    // ---- the north window -----------------------------------------------------------------------
    // The same builder the whole street façade is made of, so the corridor's glazing has the front bar's
    // framing and depth: a brushed shoe, panes on an even mullion pitch, a capping rail — and, since the
    // high-detail pass, a glazing bead at sill and head so the sheet reads as set into a frame.
    g.add(glassRun({
      z: GLASS_Z, x0: c.westX, x1: c.eastX, t: NORTH_T, h: STRUCT.wallHeight,
      sill: 3.2, panelPitch: 38, topRail: true,
    }));
    g.add(hedgeBeyond(c.westX, c.eastX));

    // ---- the two corner plants ------------------------------------------------------------------
    for (const x of [c.westX + 13, c.eastX - 13]) {
      g.add(mediumPlant({ x, z: PLANT_Z, r: 6.4, h: 27, lush: 1.4 }, sway, "potDark"));
    }

    // ---- the machines ---------------------------------------------------------------------------
    for (const side of [-1, 1] as const) {
      const at = side < 0 ? c.westX : c.eastX; //  the wall face the bank stands against
      const dir: 1 | -1 = side < 0 ? 1 : -1; //    and therefore which way its front looks
      const kinds = side < 0 ? c.west : c.east;
      kinds.forEach((kind, i) => {
        const along = CLUSTER_Z[i];
        g.add(vendingMachine({
          axis: "z", at, dir, along, kind,
          accent: kind === "drinks" ? "aiLed" : kind === "snack" ? "coveWarm" : "readyGreen",
          name: `vending:${c.id}:${side < 0 ? "west" : "east"}:${kind}`,
        }));
        // the pots V1 stands on every machine top. smallPot() only drops an ANCHOR — the pass at the end
        // of this function turns every one of them into three instanced meshes for the whole floor.
        for (const dz of [-8, 4]) g.add(anchorPot(at + dir * (VENDING_SIZE.d * 0.45), VENDING_SIZE.h, along + dz));
      });
    }
    root.add(g);
  }
  // one instanced pot/soil/leaf triple for every machine-top plant in both corridors
  finalizeSucculents(root);
  root.userData.sway = sway;
  return root;
}

/** a machine-top pot anchor, at world (x, y, z) — 2.4 is the scale the V1 art's top pots read at */
function anchorPot(x: number, y: number, z: number): THREE.Object3D {
  return shadowed(smallPot(x, y, z, 2.4), false, false);
}
