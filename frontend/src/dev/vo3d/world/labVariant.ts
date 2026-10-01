// vo3d world — WHICH AI LAB IS BUILT: the production Lab (V1) or the treehouse Lab blockout (V2, `?ailab=v2`).
//
// Read ONCE, at module load, because the exterior's ground model, its tree layout and its perimeter shading
// are built once from the Lab's footprint. Without the flag every consumer gets exactly V1's footprint, so
// the production Lab and the campus around it are byte-for-byte what they were. V2 stays isolated behind the
// flag until its blockout is approved.
import type { Vec2 } from "../core/coords";
import { LAB_PLINTH, LAB_TERRACE_SHRUBS, WALL_SEGS } from "./ailab";
import { LAB2_PLINTH, LAB2_TERRACE_SHRUBS, WALL_SEGS_V2 } from "./ailabV2";

export type LabVariant = "v1" | "v2";
export const LAB_VARIANT: LabVariant = (() => {
  try {
    return typeof location !== "undefined" && new URLSearchParams(location.search).get("ailab") === "v2" ? "v2" : "v1";
  } catch {
    return "v1";
  }
})();

/** the parts of the Lab's footprint the EXTERIOR reads (everything else — porch, steps, lake spur, causeways —
 *  is the same in both variants and stays imported from world/ailab) */
export type LabFootprint = {
  plinth: readonly Vec2[];
  wallSegs: readonly (readonly [Vec2, Vec2])[];
  terraceShrubs: readonly { x: number; z: number; r: number }[];
};
export const LAB_FOOTPRINTS: Readonly<Record<LabVariant, LabFootprint>> = {
  v1: { plinth: LAB_PLINTH, wallSegs: WALL_SEGS, terraceShrubs: LAB_TERRACE_SHRUBS },
  v2: { plinth: LAB2_PLINTH, wallSegs: WALL_SEGS_V2, terraceShrubs: LAB2_TERRACE_SHRUBS },
};
export const LAB_FP: LabFootprint = LAB_FOOTPRINTS[LAB_VARIANT];
