// vo3d build — entity kind → builder. A builder returns a Group positioned in WORLD space for the
// entity's current transform; the scene mirror re-positions it on later transform changes.
import * as THREE from "three";
import type { Entity } from "../world/WorldState";
import type { Facing } from "../core/coords";
import { buildFurniture, FURNITURE_KINDS, type FurnitureKind } from "./furniture";
import { plantFor, type PlantSpec } from "./plants";
import type { SwayNode } from "../render/Sway";

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
  if (e.kind === "solid") return { group: new THREE.Group(), sway }; // footprint-only entity (baked decor drawn by the shell builder)
  throw new Error(`no builder for entity kind "${e.kind}" (${e.id})`);
}
