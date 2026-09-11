// vo3d build — walls, floor, glass run, exterior slab (promoted from designRoom3d/build.ts).
import * as THREE from "three";
import { rbox, shadowed } from "./helpers";
import { glassMat, mat, metal, plastic } from "../render/Materials";
import type { ShellSpec } from "../world/WorldState";

// ---- shell ------------------------------------------------------------------------------------------
export type ShellOptions = { wallHeight: number; frontWall: "low" | "full" | "hidden" };

/** Room shell in ROOM-LOCAL units; caller positions the group at the room's world origin. */
export function buildShell(rect: { w: number; d: number }, SHELL: ShellSpec, opts: ShellOptions): THREE.Group {
  const g = new THREE.Group();
  const W = rect.w, D = rect.d, T = SHELL.wallThickness, H = opts.wallHeight, R = SHELL.capRadius;
  const frontZ = SHELL.frontWallZ;
  const wallM = mat("wall", 0.96);
  const m = SHELL.exteriorMargin;
  const ext = rbox(W + 2 * m, 3, D + 2 * m, mat("exterior", 1), W / 2, -3, D / 2, 1);
  ext.castShadow = false;
  g.add(ext);
  const floor = rbox(W - 2 * T + 0.2, 1.2, frontZ - T + 0.2, mat("floor", 0.82), W / 2, -1.2, (T + frontZ) / 2, 0.2);
  floor.castShadow = false;
  g.add(floor);
  g.add(rbox(W, 1.6, D - frontZ - T, mat("wallFace", 1), W / 2, -1.6, frontZ + T + (D - frontZ - T) / 2, 0.3)); // exterior ledge
  // skirting inside the rear and left walls
  g.add(rbox(W - 2 * T, 1.6, 0.8, plastic("white"), W / 2, 0, T + 0.4, 0.2));
  g.add(rbox(0.8, 1.6, frontZ - T, plastic("white"), T + 0.4, 0, (T + frontZ) / 2, 0.2));
  g.add(rbox(W, H, T, wallM, W / 2, 0, T / 2, R));
  g.add(rbox(T, H, frontZ + T, wallM, T / 2, 0, (frontZ + T) / 2, R));
  const gz = SHELL.glass;
  const rx = W - T / 2;
  g.add(rbox(T, H, gz.z0, wallM, rx, 0, gz.z0 / 2, R));
  g.add(rbox(T, H, frontZ + T - gz.z1, wallM, rx, 0, gz.z1 + (frontZ + T - gz.z1) / 2, R));
  const glassH = H - 6;
  g.add(rbox(T, 3, gz.z1 - gz.z0, plastic("white"), rx, 0, (gz.z0 + gz.z1) / 2, 0.6));
  g.add(rbox(T, 3, gz.z1 - gz.z0, plastic("white"), rx, glassH + 3, (gz.z0 + gz.z1) / 2, 0.6));
  const postZs = new Set([gz.z0, gz.doorZ1, gz.z1]);
  for (let z = gz.doorZ1 + gz.postEvery; z < gz.z1 - 4; z += gz.postEvery) postZs.add(z);
  for (const z of postZs) g.add(rbox(T, glassH, 2, plastic("white"), rx, 3, z, 0.4));
  g.add(rbox(T * 0.6, 1.4, gz.z1 - gz.z0, plastic("white"), rx, 3 + glassH * 0.55, (gz.z0 + gz.z1) / 2, 0.4));
  const doorPane = new THREE.Mesh(new THREE.PlaneGeometry(gz.doorZ1 - gz.z0 - 2, glassH - 1), glassMat());
  doorPane.rotation.y = Math.PI / 2;
  doorPane.position.set(rx, 3 + glassH / 2, (gz.z0 + gz.doorZ1) / 2);
  g.add(shadowed(doorPane, false, false));
  g.add(rbox(1, 8, 1.2, metal(), rx - T / 2 - 0.6, 24, gz.doorZ1 - 6, 0.3));
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(gz.z1 - gz.doorZ1 - 2, glassH - 1), glassMat());
  pane.rotation.y = Math.PI / 2;
  pane.position.set(rx, 3 + glassH / 2, (gz.doorZ1 + gz.z1) / 2);
  g.add(shadowed(pane, false, false));
  if (opts.frontWall !== "hidden") {
    const fh = opts.frontWall === "full" ? H : SHELL.frontWallHeight;
    g.add(rbox(W, fh, T, wallM, W / 2, 0, frontZ + T / 2, R));
  }
  return g;
}

