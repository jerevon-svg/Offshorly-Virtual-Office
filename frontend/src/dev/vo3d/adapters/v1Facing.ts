// vo3d adapter — V1's SPRITE FACING vocabulary translated into V2's COMPASS one, in one place.
//
// V1 names the direction the CAMERA sees ("front" = the sprite's front is toward the viewer); V2 names
// the compass direction the body looks along. The office is drawn with south toward the viewer, so the
// two vocabularies line up one-to-one — the same reading every reconstructed room's seat comments
// already record ("facing 'front' = south into its desk").
//
// It lives here rather than beside its first caller because there are now two: adapters/v1HomeDesk.ts
// (the signed-in employee's own desk, Phase 3) and adapters/v1Coworkers.ts (everybody else's, Phase 4A).
// Two copies of a four-entry table look right until one of them is edited.
import type { WalkDirection } from "../../../data/bonWalkFrames";
import type { Facing } from "../core/coords";

export const FACING_BY_DIRECTION: Record<WalkDirection, Facing> = {
  front: "south",
  back: "north",
  left: "west",
  right: "east",
};

/** The same one-to-one table read the other way, for the direction V2 now has to PUBLISH rather than
 *  consume (Phase 5: the signed-in employee's own walk_arrived facing). Derived from the table above so
 *  the two can never disagree — a hand-written second literal is exactly what the header warns about. */
export const DIRECTION_BY_FACING: Record<Facing, WalkDirection> = Object.fromEntries(
  (Object.keys(FACING_BY_DIRECTION) as WalkDirection[]).map((d) => [FACING_BY_DIRECTION[d], d]),
) as Record<Facing, WalkDirection>;
