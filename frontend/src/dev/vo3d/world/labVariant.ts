// vo3d world — THE AI LAB's FOOTPRINT as the exterior reads it (the ground model, the tree layout, the perimeter
// shading are all built once from it). Since Phase 6B.8 there is one Lab, the treehouse Lab; the porch, steps, lake
// spur and causeways it shares with the exterior stay in world/ailab.
import type { Vec2 } from "../core/coords";
import { LAB2_PLINTH, LAB2_TERRACE_SHRUBS, WALL_SEGS_V2 } from "./ailabV2";

/** the parts of the Lab's footprint the EXTERIOR reads */
export type LabFootprint = {
  plinth: readonly Vec2[];
  wallSegs: readonly (readonly [Vec2, Vec2])[];
  terraceShrubs: readonly { x: number; z: number; r: number }[];
};
export const LAB_FP: LabFootprint = { plinth: LAB2_PLINTH, wallSegs: WALL_SEGS_V2, terraceShrubs: LAB2_TERRACE_SHRUBS };
