// vo3d rooms — ONE rule for turning a furniture kind + its plan size into a LOGICAL footprint.
//
// Every room's furniture factory wrote this expression out by hand, and each one only knew about rects. That
// was harmless while footprints were used for placement alone; the moment navigation started reading them
// (7B) it became a real error, because a ROUND object declared as a square blocks its four corners — 27 %
// of floor that is not there. The Gaming Room's east nook is where it showed: three round poufs, boxed,
// closed the passage to the arcade-print walk-up point that the room has always had.
//
// So the mapping lives here, once, and says what each kind physically IS:
//   round    — bean bags, poufs, round tables, the café octagons (regular, so a circle is the honest read)
//   dressing — rugs and mats: a real extent, explicitly NOT solid, walked straight over
//   default  — everything else is the rect it is drawn as
import type { Footprint } from "../world/WorldState";
import { chairPlanRadius } from "../build/furniture";

/** task chairs: a five-star caster base, round in plan, and sized by the builder rather than by the art box */
export const TASK_CHAIR_KINDS: ReadonlySet<string> = new Set(["chair-a", "chair-b", "lead-chair", "cms-task-chair", "cms-lead-chair", "ai-task-chair", "ai-lead-chair", "ai-visitor-chair", "dev-exec-chair", "dev-task-chair", "qa-task-chair", "qa-lead-chair"]);
/** kinds whose plan is a circle (or a regular polygon close enough to one that a box would lie) */
export const ROUND_KINDS: ReadonlySet<string> = new Set(["beanbag", "round-table", "cafe-table", "exec-planter", "cms-pouf", "cms-round-table", "qa-pouf", "qa-round-table"]);
/** kinds that lie ON the floor rather than standing on it */
export const FLOOR_DRESSING_KINDS: ReadonlySet<string> = new Set(["rug", "mat", "exec-rug", "cms-rug", "dev-rug", "qa-rug"]);

export function kindFootprint(kind: string, w: number, d: number): Footprint {
  if (FLOOR_DRESSING_KINDS.has(kind)) return { shape: "rect", w, d, solid: false };
  if (TASK_CHAIR_KINDS.has(kind)) return { shape: "circle", r: chairPlanRadius(w, d) };
  if (ROUND_KINDS.has(kind)) return { shape: "circle", r: Math.min(w, d) / 2 };
  return { shape: "rect", w, d };
}
