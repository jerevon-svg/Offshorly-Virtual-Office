// vo3d build — entity kind → builder. A builder returns a Group positioned in WORLD space for the
// entity's current transform; the scene mirror re-positions it on later transform changes.
import * as THREE from "three";
import type { Entity } from "../world/WorldState";
import type { Facing } from "../core/coords";
import { buildFurniture, FURNITURE_KINDS, type FurnitureKind } from "./furniture";
import { plantFor, type PlantSpec } from "./plants";
import type { SwayNode } from "../render/Sway";
import { rbox, shadowed } from "./helpers";
import { glassMat, metal } from "../render/Materials";

export type BuildResult = { group: THREE.Group; sway: SwayNode[] };

export function buildEntity(e: Entity): BuildResult {
  const sway: SwayNode[] = [];
  if ((FURNITURE_KINDS as readonly string[]).includes(e.kind)) {
    const w = Number(e.props.w), d = Number(e.props.d);
    const group = buildFurniture({
      kind: e.kind as FurnitureKind,
      rect: { x: e.transform.pos.x - w / 2, z: e.transform.pos.z - d / 2, w, d },
      facing: e.props.facing as Facing,
      mirrored: Boolean(e.props.mirrored),
    });
    return { group, sway };
  }
  if (e.kind === "plant") {
    const spec: PlantSpec = { x: e.transform.pos.x, z: e.transform.pos.z, r: Number(e.props.r), h: Number(e.props.h), hanging: Boolean(e.props.hanging), y: Number(e.props.y) };
    return { group: plantFor(spec, sway), sway };
  }
  if (e.kind === "sliding-door") {
    // glass leaf standing in the wall plane (local x = 0), its long axis along z; handle on the room-side face
    const leafW = Number(e.props.leafW), glassH = Number(e.props.glassH);
    const group = new THREE.Group();
    group.position.set(e.transform.pos.x, 0, e.transform.pos.z);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(leafW, glassH - 1), glassMat());
    pane.rotation.y = Math.PI / 2;
    pane.position.set(0, 3 + glassH / 2, 0);
    group.add(shadowed(pane, false, false));
    group.add(rbox(1, 8, 1.2, metal(), Number(e.props.handleX), 24, Number(e.props.handleZ), 0.3));
    return { group, sway };
  }
  if (e.kind === "solid") return { group: new THREE.Group(), sway }; // footprint-only entity (baked decor drawn by the shell builder)
  throw new Error(`no builder for entity kind "${e.kind}" (${e.id})`);
}
