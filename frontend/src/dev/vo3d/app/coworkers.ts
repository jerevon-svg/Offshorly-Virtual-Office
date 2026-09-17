// vo3d app — THE COWORKER CONTRACT, the Phase 4A counterpart to identity.ts and spawn.ts.
//
// Same split, same reason as both of those: the V1 side (adapters/v1Coworkers.ts) reads V1's roster,
// presence and seat tables and therefore pulls in V1's service layer, while app/world.ts must stay
// loadable by the standalone dev page with no V1 anything in its graph. The type both sides name lives
// here, in a module that imports nothing but V2's own coordinate leaf.
//
// WHAT A COWORKER IS — AND IS NOT.
//
// It is one real employee V1's roster lists, placed at the seat V1's own roster seating assigned them
// (data/rosterLayers.ts officePeopleToLayers — the email-sorted per-room assignment, NOT data/homeSeat's
// resolveHomeDesk, which answers a different question and hands EVERY person in a room the same chair).
//
// It is NOT a live position. Phase 4A reads no movement socket, no positions_snapshot, no walk event and
// no attendance: every point here is DERIVED from the roster, and the body that renders it never moves.
// So this says "this is the desk V1 gives this person", never "this person is sitting there right now" —
// and nothing built on it may dress it up as presence. Live positions are Phase 4B's problem.
//
// COORDINATES ARE V1'S, deliberately, exactly as app/spawn.ts's Vo3dHomeDesk is: `point` is in the V1
// frame, and applying a room's V2 world shift is world.ts's job (through the same homeDeskWorldPoint the
// home desk already goes through), so the adapter never has to know a V2 room moved.
import type { Facing, Vec2 } from "../core/coords";

export interface Vo3dCoworker {
  /** THE KEY: the person's email, trimmed and lowercased. Every V1 feed joins on this form (roster
   *  dedupe, movement sync, offline lineup), and nothing else about a person is stable enough to key on
   *  — see app/identity.ts's note on why the employee id is not a usable identity. */
  email: string;
  /** V1's roster display name. Never empty: the adapter falls back to the email's localpart. */
  displayName: string;
  /** The registered 3D character id. NON-NULL by construction — a person with no approved 3D asset set
   *  never becomes a Vo3dCoworker at all; they are counted in `missingAvatar` instead. It must NEVER be
   *  widened to somebody else's character, which is the same rule app/identity.ts states for self. */
  avatarId: string;
  /** The assigned seat's centroid, IN V1 FRAME UNITS, already a ground centre point (the adapter undoes
   *  the layer's top-left origin using THAT PERSON'S OWN box, never Bon's — see the adapter). */
  point: Vec2;
  /** The seat's OWN fixed direction. The direction belongs to the chair, never to whoever sits in it. */
  facing: Facing;
}

export interface Vo3dCoworkerSet {
  /** Renderable coworkers, sorted by email so the placement pass below is deterministic across viewers
   *  and across re-renders of an upstream roster array that is free to reorder itself. */
  coworkers: Vo3dCoworker[];
  /** Display names of coworkers V1 would show but V2 cannot draw — a real employee with a real V1 avatar
   *  and no consolidated GLB ("lui" is exactly that). Carried as names rather than a bare count so the
   *  readout can say WHO is missing instead of only how many, and so the absence stays explicit rather
   *  than silently shrinking the office. */
  missingAvatar: string[];
}

export const EMPTY_COWORKER_SET: Vo3dCoworkerSet = { coworkers: [], missingAvatar: [] };
