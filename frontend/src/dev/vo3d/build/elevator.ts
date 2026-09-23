// vo3d build — THE LIFT: a shallow entrance on each floor, and the one cabin they share.
//
// ONE INTERIOR, BUILT TWICE. `liftInterior` and `liftFront` are the only things that draw a lift, and
// both the floor VESTIBULES and the cabin's front BAY are made from them with the same numbers. That is
// not tidiness — it is the whole trick: the body is moved between a vestibule and the bay on the frame
// the doors finish closing, and because every surface in frame is the same surface at the same distance,
// the move is invisible. See rooms/elevator.ts.
//
// THE OUTSIDE is the floor's own wall language: plaster, a thin shadow reveal under the cap, a slim
// metal portal, and nothing else. The first build clad it in a white box with a black roof slab and a
// heavy bronze surround, and it read as a room inserted into the Meeting Room rather than a lift.
//
// THE INSIDE is a premium commercial car: dark brushed leaves, champagne wall panels with a waist
// reveal, handrails, recessed ceiling lights, a car-operating panel and a read-out over the doors.
//
// NOTHING IN HERE CASTS A SHADOW. The renderer has one directional key and these are lidded boxes; a
// shadow-casting shell puts its own interior — and the body standing in it — in full shade.
import * as THREE from "three";
import { rbox, shadowed } from "./helpers";
import { PALETTE, emissiveMat, mat, uiScreenMat } from "../render/Materials";
import {
  CABIN, CEILING_H, DOOR_H, LEAF_T, SLAB_T, WALL_T, type ElevatorSpec,
} from "../rooms/elevator";

type R2 = { x: number; z: number; w: number; d: number };

/** THE CAR'S PALETTE. Every surface carries an emissive term: a lidded box gets no key and no sky, so
 *  without one the inside of a lift is black — and a surface that mostly lights itself also cannot
 *  change appearance when the world outside it does. Environment reflection is kept LOW for the same
 *  reason and one more: at full intensity a polished leaf mirrors the scene's IBL, so the shut doors of
 *  a sealed lift rendered as a sheet of pale sky. */
const E = { panel: 0.3, leaf: 0.26, trim: 0.26, floor: 0.2, ceiling: 0.3, lamp: 2.4 };
const panelMat = () => mat("bronze", 0.28, { metalness: 0.66, envMapIntensity: 0.45, emissive: PALETTE.bronze, emissiveIntensity: E.panel });
const leafMat = () => mat("charcoal", 0.36, { metalness: 0.7, envMapIntensity: 0.45, emissive: PALETTE.charcoal, emissiveIntensity: E.leaf });
const trimMat = () => mat("metal", 0.32, { metalness: 0.82, envMapIntensity: 0.5, emissive: PALETTE.metal, emissiveIntensity: E.trim });
const floorMatCar = () => mat("tile", 0.34, { emissive: PALETTE.tile, emissiveIntensity: E.floor });
const ceilMat = () => mat("charcoal", 0.8, { emissive: PALETTE.charcoal, emissiveIntensity: E.ceiling });

function litSurfaces(): { m: THREE.MeshStandardMaterial; base: number }[] {
  return [
    { m: panelMat(), base: E.panel }, { m: leafMat(), base: E.leaf },
    { m: trimMat(), base: E.trim }, { m: floorMatCar(), base: E.floor }, { m: ceilMat(), base: E.ceiling },
  ];
}
const applyLight = (lamps: THREE.Mesh[], level: number): void => {
  for (const s of litSurfaces()) s.m.emissiveIntensity = s.base * level;
  for (const l of lamps) (l.material as THREE.MeshStandardMaterial).emissiveIntensity = E.lamp * level;
};

const smooth = (t: number): number => t * t * (3 - 2 * t);

function indicatorMat(text: string): THREE.MeshStandardMaterial {
  return uiScreenMat(`lift-ind:${text}`, 160, 72, (ctx, w, h) => {
    ctx.fillStyle = "#07090f";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#8fe8ff";
    ctx.font = "700 50px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, w / 2, h / 2 + 2);
  }, 1.2);
}

/** Floor, ceiling, back and side panels, waist reveal, handrails and downlights for one stretch of car.
 *  `back` draws the rear panel (the vestibule and the cabin's volume have one; the bay does not). */
function liftInterior(g: THREE.Group, inner: R2, height: number, lights: THREE.Mesh[], back: boolean): void {
  const plate = rbox(inner.w, 1.2, inner.d, floorMatCar(), inner.x + inner.w / 2, -1.1, inner.z + inner.d / 2, 0.2);
  plate.castShadow = false;
  g.add(plate);
  const ceil = rbox(inner.w, SLAB_T, inner.d, ceilMat(), inner.x + inner.w / 2, height, inner.z + inner.d / 2, 0.3);
  ceil.castShadow = false;
  g.add(ceil);
  const pm = panelMat(), rv = mat("charcoal", 0.5, { metalness: 0.3 });
  for (const z of [inner.z + 0.5, inner.z + inner.d - 0.5]) {
    g.add(rbox(inner.w, height - 2, 1, pm, inner.x + inner.w / 2, 0, z, 0.3));
    g.add(rbox(inner.w, 1.1, 1.4, rv, inner.x + inner.w / 2, 22, z, 0.3));
  }
  if (back) g.add(rbox(1, height - 2, inner.d, pm, inner.x + 0.5, 0, inner.z + inner.d / 2, 0.3));
  for (const z of [inner.z + 2.6, inner.z + inner.d - 2.6]) {
    const rail = rbox(inner.w - 8, 1.5, 1.5, trimMat(), inner.x + inner.w / 2, 21, z, 0.75);
    rail.castShadow = false;
    g.add(rail);
  }
  const cols = Math.max(2, Math.round(inner.w / 34));
  const rows = Math.max(2, Math.round(inner.d / 40));
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      const x = inner.x + (inner.w * (i + 0.5)) / cols;
      const z = inner.z + (inner.d * (j + 0.5)) / rows;
      const recess = rbox(13, 0.8, 9, mat("charcoal", 0.72), x, height - 0.9, z, 1.2);
      recess.castShadow = false;
      g.add(recess);
      const lamp = rbox(10, 0.5, 6.4, emissiveMat("white", E.lamp, 0.25).clone(), x, height - 1.5, z, 0.8);
      lamp.castShadow = false;
      g.add(lamp);
      lights.push(lamp);
    }
}

/** The front wall: the opening, the header, the two leaves, the read-out on both faces and the car's own
 *  operating panel. Returns the handles the cinematic drives. */
function liftFront(
  g: THREE.Group, inner: R2, doorway: R2, leaf: { north: R2; south: R2; slideDistance: number },
  indicator: string, faces: THREE.Mesh[],
): { setOpen(t: number): void } {
  const wallM = mat("wall", 0.96);
  const xFront = doorway.x;
  // the two piers and the header, in the floor's own plaster
  g.add(rbox(WALL_T, CEILING_H + SLAB_T, doorway.z - inner.z, wallM, xFront + WALL_T / 2, 0, (inner.z + doorway.z) / 2, 0.8));
  const sEnd = inner.z + inner.d;
  g.add(rbox(WALL_T, CEILING_H + SLAB_T, sEnd - (doorway.z + doorway.d), wallM, xFront + WALL_T / 2, 0, (doorway.z + doorway.d + sEnd) / 2, 0.8));
  g.add(rbox(WALL_T, CEILING_H + SLAB_T - DOOR_H, doorway.d, wallM, xFront + WALL_T / 2, DOOR_H, doorway.z + doorway.d / 2, 0.8));
  // A SLIM METAL PORTAL, 1.4 proud — a reveal round the opening, not a frame around a picture.
  const jamb = 3;
  for (const z of [doorway.z - jamb / 2, doorway.z + doorway.d + jamb / 2])
    g.add(rbox(1.4, DOOR_H + 3, jamb, trimMat(), xFront + WALL_T + 0.7, 0, z, 0.3));
  g.add(rbox(1.4, 3, doorway.d + 2 * jamb, trimMat(), xFront + WALL_T + 0.7, DOOR_H, doorway.z + doorway.d / 2, 0.3));

  // high in the header band, clear of the world-space name pill that hangs over the rider's own head
  const yInd = DOOR_H + (CEILING_H - DOOR_H) * 0.72;
  const mkFace = (x: number, yaw: number): void => {
    g.add(rbox(1.2, 11, 26, mat("charcoal", 0.5), x, yInd - 5.5, doorway.z + doorway.d / 2, 0.4));
    const f = new THREE.Mesh(new THREE.PlaneGeometry(21, 7.6), indicatorMat(indicator));
    f.position.set(x + (yaw > 0 ? 0.7 : -0.7), yInd, doorway.z + doorway.d / 2);
    f.rotation.y = yaw;
    g.add(shadowed(f, false, false));
    faces.push(f);
  };
  mkFace(xFront + WALL_T + 0.6, Math.PI / 2); // outside, facing the room
  mkFace(xFront - 0.6, -Math.PI / 2); //        inside, over the doors

  // the car-operating panel, on the south wall beside the doors
  const pz = inner.z + inner.d - 1.3, px = inner.x + inner.w - 12;
  g.add(rbox(12, 26, 1.2, mat("charcoal", 0.42), px, 8, pz, 0.5));
  for (let i = 0; i < 2; i++) g.add(rbox(3, 3, 1, emissiveMat("cyan", 1.15, 0.3), px, 13 - i * 6, pz - 0.8, 1));
  const pf = new THREE.Mesh(new THREE.PlaneGeometry(9, 5.2), indicatorMat(indicator));
  pf.position.set(px, 27, pz - 0.9);
  pf.rotation.y = Math.PI;
  g.add(shadowed(pf, false, false));
  faces.push(pf);

  const mk = (r: R2): THREE.Mesh => {
    const m = rbox(LEAF_T, DOOR_H, r.d, leafMat(), r.x + LEAF_T / 2, 0, r.z + r.d / 2, 0.2);
    m.castShadow = false;
    return m;
  };
  const n = mk(leaf.north), s = mk(leaf.south);
  const cn = n.position.z, cs = s.position.z;
  g.add(n, s);
  const track = rbox(2, 0.4, doorway.d, trimMat(), xFront + WALL_T / 2, -0.1, doorway.z + doorway.d / 2, 0.1);
  track.castShadow = false;
  g.add(track);
  let open = -1;
  return {
    setOpen(t: number) {
      const c = Math.max(0, Math.min(1, t));
      if (c === open) return;
      open = c;
      const o = leaf.slideDistance * smooth(c);
      n.position.z = cn - o;
      s.position.z = cs + o;
    },
  };
}

export interface LiftBuild {
  group: THREE.Group;
  setOpen(t: number): void;
  setIndicator(text: string): void;
  setLight(level: number): void;
  dispose(): void;
}
export interface ElevatorCoreBuild extends LiftBuild {
  readonly callPickName: string;
}

/** ONE FLOOR'S ENTRANCE: the shallow plaster box, its vestibule, the doors and the call plate. */
export function buildElevatorCore(spec: ElevatorSpec, indicator: string): ElevatorCoreBuild {
  const g = new THREE.Group();
  g.name = `elevator:${spec.id}`;
  const wallM = mat("wall", 0.96);
  const H = CEILING_H + SLAB_T;
  const [back, north, south] = spec.solids;
  const lights: THREE.Mesh[] = [];
  const faces: THREE.Mesh[] = [];
  for (const s of [back, north, south]) g.add(rbox(s.w, H, s.d, wallM, s.x + s.w / 2, 0, s.z + s.d / 2, 0.8));
  // THE CAP: the room's own plaster with a thin shadow reveal under it — a lift overrun, not a slab.
  g.add(rbox(spec.outer.w + 2.4, 2.4, spec.outer.d + 2.4, wallM, spec.outer.x + spec.outer.w / 2, H, spec.outer.z + spec.outer.d / 2, 0.8));
  g.add(rbox(spec.outer.w + 0.6, 1.2, spec.outer.d + 0.6, mat("wallFace", 1), spec.outer.x + spec.outer.w / 2, H - 1.2, spec.outer.z + spec.outer.d / 2, 0.4));

  liftInterior(g, spec.interior, CEILING_H, lights, true);
  const doors = liftFront(g, spec.interior, spec.doorway, spec.leaf, indicator, faces);

  const callPickName = `elevator-call:${spec.id}`;
  const call = new THREE.Group();
  call.name = callPickName;
  call.add(rbox(1.2, 13, 7, mat("charcoal", 0.45), spec.call.x, spec.call.y - 6.5, spec.call.z, 0.5));
  call.add(rbox(1, 3.4, 3.4, emissiveMat("cyan", 1.3, 0.3), spec.call.x + 0.7, spec.call.y - 2, spec.call.z, 1));
  g.add(call);

  g.traverse((n) => { const m = n as THREE.Mesh; if (m.isMesh) m.castShadow = false; });
  doors.setOpen(0);
  return {
    group: g,
    setOpen: doors.setOpen,
    setIndicator: (t) => { for (const f of faces) f.material = indicatorMat(t); },
    setLight: (l) => applyLight(lights, l),
    callPickName,
    dispose: () => g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); }),
  };
}

/** THE CABIN: the one car, standing alone. Its BAY is an exact copy of a vestibule — same interior, same
 *  front wall, same doors, same read-out, same setback — and the VOLUME behind it is the car proper,
 *  wider and deeper, with room for ten. The join is behind the camera at the moment of the swap. */
export function buildCabin(indicator: string): LiftBuild {
  const g = new THREE.Group();
  g.name = "elevator-cabin";
  const lights: THREE.Mesh[] = [];
  const faces: THREE.Mesh[] = [];
  const { bay, volume, outer, doorway, leaf } = CABIN;
  const wallM = mat("wall", 0.96);
  const H = CEILING_H + SLAB_T;
  // the shell: everything but the front wall, which liftFront builds
  for (const s of [
    { x: outer.x, z: outer.z, w: WALL_T, d: outer.d }, //                          rear
    { x: outer.x, z: outer.z, w: outer.w, d: WALL_T }, //                          north
    { x: outer.x, z: outer.z + outer.d - WALL_T, w: outer.w, d: WALL_T }, //       south
    // the two returns either side of the bay, closing the volume's front face
    { x: bay.x - WALL_T, z: outer.z, w: WALL_T, d: bay.z - outer.z + WALL_T },
    { x: bay.x - WALL_T, z: bay.z + bay.d - WALL_T, w: WALL_T, d: outer.z + outer.d - (bay.z + bay.d) + WALL_T },
  ]) g.add(rbox(s.w, H, s.d, wallM, s.x + s.w / 2, 0, s.z + s.d / 2, 0.8));
  // a lid over the whole thing, so nothing can ever be seen over its walls
  const cap = rbox(outer.w, 2.4, outer.d, wallM, outer.x + outer.w / 2, H, outer.z + outer.d / 2, 0.8);
  cap.castShadow = false;
  g.add(cap);

  liftInterior(g, volume, CEILING_H, lights, true);
  liftInterior(g, bay, CEILING_H, lights, false); // no rear panel: the bay opens into the volume
  const doors = liftFront(g, bay, doorway, leaf, indicator, faces);

  g.traverse((n) => { const m = n as THREE.Mesh; if (m.isMesh) m.castShadow = false; });
  doors.setOpen(0);
  g.visible = false;
  return {
    group: g,
    setOpen: doors.setOpen,
    setIndicator: (t) => { for (const f of faces) f.material = indicatorMat(t); },
    setLight: (l) => applyLight(lights, l),
    dispose: () => g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); }),
  };
}
