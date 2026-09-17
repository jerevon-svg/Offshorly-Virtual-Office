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
