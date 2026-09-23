// vo3d build — walls, floor, glass run, exterior slab (promoted from designRoom3d/build.ts).
import * as THREE from "three";
import { rbox, shadowed } from "./helpers";
import { floorMat, glassMat, mat, plastic } from "../render/Materials";
import { cornice, glazingBead, runSegments, skirting, type RunGap } from "./arch";
import { tagSurface } from "../editor/surfaces";
import type { ShellSpec } from "../world/WorldState";

// ---- shell ------------------------------------------------------------------------------------------
export type ShellOptions = {
  wallHeight: number;
  frontWall: "low" | "full" | "hidden";
  /** draw the room's own exterior slab (Phase 1 single-room mode); false once the ground-floor slab exists */
  exterior?: boolean;
  /** Spans on the rear (x) and left (z) walls that the CORNICE must not cross, because the room already
   *  hangs an authored display there. Supplied by the room's static builder from its own baked decor —
   *  see ROOM_STATIC.design-room in build/registry.ts. Absent = an unbroken run, as before. */
  corniceGaps?: { x?: readonly RunGap[]; z?: readonly RunGap[] };
};

/** Room shell in ROOM-LOCAL units; caller positions the group at the room's world origin. */
export function buildShell(rect: { w: number; d: number }, SHELL: ShellSpec, opts: ShellOptions): THREE.Group {
  const g = new THREE.Group();
  const W = rect.w, D = rect.d, T = SHELL.wallThickness, H = opts.wallHeight, R = SHELL.capRadius;
  const frontZ = SHELL.frontWallZ;
  const wallM = mat("wall", 0.96);
  if (opts.exterior !== false) {
    const m = SHELL.exteriorMargin;
    const ext = rbox(W + 2 * m, 3, D + 2 * m, floorMat("exterior", 1), W / 2, -3, D / 2, 1);
    ext.castShadow = false;
    g.add(ext);
  }
  const floor = rbox(W - 2 * T + 0.2, 1.2, frontZ - T + 0.2, floorMat("floor", 0.82), W / 2, -1.2, (T + frontZ) / 2, 0.2);
  floor.castShadow = false;
  // ROOM EDITOR. buildShell describes ONE room's wall arrangement (the Design Room's — see RoomDef.shell),
  // so its floor and its plaster are that room's two addressable surfaces.
  g.add(tagSurface(floor, { id: "design-room/floor", kind: "floor", roomId: "design-room", label: "Design Room floor", preset: "stone", size: { u: W, v: frontZ } }));
  g.add(rbox(W, 1.6, D - frontZ - T, floorMat("wallFace", 1), W / 2, -1.6, frontZ + T + (D - frontZ - T) / 2, 0.3)); // exterior ledge
  // Skirting + cornice inside the rear and left walls, over the shared profiles in build/arch.ts. These
  // were two flat boxes; the profile adds the floor shadow gap the old slab could not have, and the
  // cornice gives the room a stated ceiling plane without a ceiling slab the camera would have to see
  // through. ROOM-LOCAL, like everything else in this builder — the caller positions the group.
  //
  //  THE CORNICE ROUTES AROUND THE ROOM'S WALL-MOUNTED DISPLAYS. The mantra whiteboard on the rear wall
  //  reaches y 50 and the two boards on the left wall reach 44, so an unbroken cornice — which hangs from
  //  39 to 46 and stands 2.4 proud — is drawn ACROSS their faces and cuts the artwork in half. The run
  //  therefore terminates either side of each of them (build/arch.runSegments), which is what a real
  //  ceiling trim does when it meets a mounted panel. The skirting is untouched: nothing is at floor level.
  for (const r of [
    { axis: "x" as const, from: T, to: W - T, at: T, dir: 1 as const, gaps: opts.corniceGaps?.x },
    { axis: "z" as const, from: T, to: frontZ, at: T, dir: 1 as const, gaps: opts.corniceGaps?.z },
  ]) {
    g.add(skirting({ axis: r.axis, from: r.from, to: r.to, at: r.at, dir: r.dir, y0: 0, key: "white", roughness: 0.6 }));
    for (const seg of runSegments(r.from, r.to, r.gaps ?? []))
      g.add(cornice({ axis: r.axis, from: seg.from, to: seg.to, at: r.at, dir: r.dir, y0: 0, key: "wall", wallHeight: H }));
  }
  g.add(tagSurface(rbox(W, H, T, wallM, W / 2, 0, T / 2, R), { id: "design-room/wall", kind: "wall", roomId: "design-room", label: "Design Room walls", preset: "plaster", size: { u: W, v: H } }));
  g.add(tagSurface(rbox(T, H, frontZ + T, wallM, T / 2, 0, (frontZ + T) / 2, R), { id: "design-room/wall", kind: "wall", roomId: "design-room", label: "Design Room walls", preset: "plaster", size: { u: W, v: H } }));
  const gz = SHELL.glass;
  const rx = W - T / 2;
  g.add(tagSurface(rbox(T, H, gz.z0, wallM, rx, 0, gz.z0 / 2, R), { id: "design-room/wall", kind: "wall", roomId: "design-room", label: "Design Room walls", preset: "plaster", size: { u: W, v: H } }));
  g.add(tagSurface(rbox(T, H, frontZ + T - gz.z1, wallM, rx, 0, gz.z1 + (frontZ + T - gz.z1) / 2, R), { id: "design-room/wall", kind: "wall", roomId: "design-room", label: "Design Room walls", preset: "plaster", size: { u: W, v: H } }));
  const glassH = H - 6;
  // horizontal framing: the header runs the whole glass run; the sill and the mid transom stop at the doorway so the
  // opening (z0 … doorZ1) is architecturally clear once the leaf is pocketed — only a flush floor track crosses it
  const fixedMidZ = (gz.doorZ1 + gz.z1) / 2, fixedLen = gz.z1 - gz.doorZ1;
  g.add(rbox(T, 3, fixedLen, plastic("white"), rx, 0, fixedMidZ, 0.6));
  g.add(rbox(T, 0.6, gz.doorZ1 - gz.z0, plastic("white"), rx, 0, (gz.z0 + gz.doorZ1) / 2, 0.2));
  g.add(rbox(T, 3, gz.z1 - gz.z0, plastic("white"), rx, glassH + 3, (gz.z0 + gz.z1) / 2, 0.6));
  const postZs = new Set([gz.z0, gz.doorZ1, gz.z1]);
  for (let z = gz.doorZ1 + gz.postEvery; z < gz.z1 - 4; z += gz.postEvery) postZs.add(z);
  for (const z of postZs) g.add(rbox(T, glassH, 2, plastic("white"), rx, 3, z, 0.4));
  g.add(rbox(T * 0.6, 1.4, fixedLen, plastic("white"), rx, 3 + glassH * 0.55, fixedMidZ, 0.4));
  // the door LEAF (+ handle) is an entity (kind "sliding-door", rooms/design-room.ts) so it can move; only the frame lives here
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(gz.z1 - gz.doorZ1 - 2, glassH - 1), glassMat());
  pane.rotation.y = Math.PI / 2;
  pane.position.set(rx, 3 + glassH / 2, (gz.doorZ1 + gz.z1) / 2);
  g.add(shadowed(pane, false, false));
  // the pane is a single-sided plane: without a bead at sill and head it reads as a tinted quad in a hole
  g.add(glazingBead({ axis: "z", at: rx, from: gz.doorZ1 + 1, to: gz.z1 - 1, y0: 3.2, y1: 3 + glassH, t: T * 0.5 }));
  if (opts.frontWall !== "hidden") {
    const fh = opts.frontWall === "full" ? H : SHELL.frontWallHeight;
    g.add(tagSurface(rbox(W, fh, T, wallM, W / 2, 0, frontZ + T / 2, R), { id: "design-room/wall", kind: "wall", roomId: "design-room", label: "Design Room walls", preset: "plaster", size: { u: W, v: H } }));
    // the front wall's INNER face gets the same baseboard as the other two solid faces — it was the one
    // wall in this room that still met the floor on a hard line. No cornice: this wall is waist-high
    // unless the caller asks for "full", so a ceiling moulding would be hanging in mid-air.
    g.add(skirting({ axis: "x", from: T, to: W - T, at: frontZ, y0: 0, dir: -1, key: "white", roughness: 0.6 }));
    if (opts.frontWall === "full") g.add(cornice({ axis: "x", from: T, to: W - T, at: frontZ, y0: 0, dir: -1, key: "wall", wallHeight: H }));
  }
  return g;
}

