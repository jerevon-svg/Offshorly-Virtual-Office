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
// PHASE 4B MAKES THE POSITION LIVE — AND NOTHING ELSE. A coworker may now stand at the position V1 has
// actually persisted for them (services/presence/movementSync's stable state) instead of at their derived
// desk, and `posSource` says which of those two facts a given `point` is. Everything else about this
// contract is unchanged, deliberately:
//   • STILL READ-ONLY. Nothing is emitted; no walk_started, no walk_arrived, no position is ever written.
//   • STILL NOT ATTENDANCE. A persisted position is "where V1 last saw this person stop", not "this person
//     is in the building" — employee_positions is NOT attendance-gated and keeps a stale row for someone
//     who checked out hours ago. V1's offline predicate is what decides visibility, exactly as in 4A, and
//     it runs BEFORE any position is applied so stale movement data can never resurrect a checked-out
//     employee at a desk.
//   • PHASE 4B WAS A SNAP, NOT A WALK — it read only the arrived/stable half of the movement feed, so a
//     peer mid-walk stayed where they last stopped until they arrived. PHASE 6A ADDS THE OTHER HALF, as
//     `walk` below: the in-flight route, its duration and how far in it is. The stable half is unchanged
//     and still authoritative; the walk is what the body does on the way there.
//   • STILL DERIVED-BY-DEFAULT. Before the first positions_snapshot, and for every person V1 has no
//     persisted row for, the Phase 4A desk is what renders. A position is never fabricated.
//
// COORDINATES ARE V1'S, deliberately, exactly as app/spawn.ts's Vo3dHomeDesk is: `point` is in the V1
// frame, and applying a room's V2 world shift is world.ts's job (through the same homeDeskWorldPoint the
// home desk already goes through), so the adapter never has to know a V2 room moved.
import type { Facing, Vec2 } from "../core/coords";

/** ONE COWORKER'S WALK THAT IS STILL HAPPENING. Phase 6A, and the half of V1's movement feed Phase 4B
 *  deliberately left unread.
 *
 *  It is V1's published account of a movement in progress: the route, how long it takes, and how far in it
 *  was when this value was produced. world/Coworkers.ts replays it (world/coworkerWalk.ts does the
 *  arithmetic); nothing here is computed by V2.
 *
 *  IT CHANGES ONLY WHEN THE MOVEMENT DOES, never per frame. `elapsedMs` is a stamp taken when the adapter
 *  ran, not a live clock — the world adds its own frame time on top. That is what keeps a walking office
 *  from re-rendering React sixty times a second, and `movementId` is what lets the world tell a NEW
 *  movement from the same one being handed to it again. */
/** How a replay paces a route. "eased" is V1's PeerWalker curve (core/coords easeInOutQuad) and the
 *  default for every walk V1 itself publishes; "linear" is a constant-speed sample of continuous free
 *  movement, which must not be eased or the body halts at both ends of every leg. A local vocabulary
 *  rather than a type import, so the world's module graph stays free of V1 (app/world.ts's rule). */
export type Vo3dWalkPacing = "eased" | "linear";

export interface Vo3dCoworkerWalk {
  /** V1's own movement id. The world starts a replay when this changes and ignores a repeat of it, so a
   *  re-render caused by somebody else's event cannot restart this person's walk. */
  movementId: string;
  /** The route in V1 FRAME UNITS as ground centre points, ORIGIN FIRST — same basis and same per-person
   *  box conversion as `point`. app/world.ts applies its own room shift to every point of it, through the
   *  same homeDeskWorldPoint a desk goes through. */
  path: Vec2[];
  /** How long V1 said the whole walk takes. Not recomputed from the distance: the publisher's own figure
   *  is what every other viewer is replaying against. */
  durationMs: number;
  /** How far into the walk this value was produced, from V1's server clock offset. A movement that began
   *  before this viewer connected arrives most of the way through, and the replay starts there rather
   *  than snapping the body back to the origin. */
  elapsedMs: number;
  /** See Vo3dWalkPacing. Absent means eased. */
  pacing?: Vo3dWalkPacing;
}

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
  /** WHERE THIS PERSON STANDS, IN V1 FRAME UNITS, already a ground centre point (the adapter undoes
   *  the layer's top-left origin using THAT PERSON'S OWN box, never Bon's — see the adapter).
   *
   *  Phase 4B: this is EITHER the derived desk centroid OR the centre of their live persisted position,
   *  and `posSource` says which. It is never a blend of the two and never a guess. */
  point: Vec2;
  /** WHICH FACT `point` IS. Phase 4B's whole distinction, carried explicitly rather than inferred:
   *
   *    "desk" — V1's roster seating (data/rosterLayers.ts). Everyone starts here, and anyone V1 has no
   *             persisted position for STAYS here forever. It says "this is the desk V1 gives them".
   *    "live" — V1's own last-arrived persisted position (services/presence/movementSync's stable state,
   *             backed by employee_positions). It says "this is where V1 last saw them stop".
   *
   *  world/Coworkers.ts reads this for exactly one decision — a live point is V1's truth and is never
   *  nudged by V2's separation rule, while a desk point still is (see placeCoworkers). */
  posSource: "desk" | "live";
  /** PHASE 7D — A NAMED PLACE OUTSIDE V1'S COORDINATE FRAME this person is in, or absent.
   *
   *  V1's wire carries a `roomId` beside every position, and the CAVE publishes itself through it
   *  (adapters/v1SelfMovement's `placed`) because the CAVE is at x 2600 — outside the frame entirely, so
   *  `point` cannot describe it. `point` therefore stays the last REAL in-frame position they had (the
   *  portal), and this says where they actually went. A world that knows the place puts the body there;
   *  one that does not leaves them at the portal, which is where V1 thinks they are. */
  place?: string;
  /** PHASE 7D — WHERE THEY ACTUALLY ARE inside that place, in the place's own world frame, when they
   *  have published it. Absent until they move (the server never persists it), and `point` — the
   *  portal — is the honest fallback meanwhile. */
  localPoint?: Vec2;
  /** PHASE 7D — an ALREADY-WORLD-SPACE position that overrides `point`, for a place `toWorld` cannot
   *  reach. Set only by the world itself, which is the only thing that knows where its own CAVE is. */
  worldPoint?: Vec2;
  /** THAT PERSON'S OWN V1 sprite box (data/rosterLayers.ts gives a live-3D employee their own manifest
   *  dimensions, scaled by their room's overflow scale — micah and angelo are deliberately taller).
   *
   *  Carried because the top-left -> centre conversion of a persisted position must use THIS box and no
   *  other; adapters/v1Pathfinding.ts converts through bonLayer's halves and is a tests-only oracle for
   *  precisely that reason. Resolving it once, here, is what stops the position adapter from re-deriving
   *  the roster seating a second time and drifting from it. */
  box: { width: number; height: number };
  /** The direction this person faces. For a desk point that is the SEAT's own fixed direction (the
   *  direction belongs to the chair, never to whoever sits in it); for a live point it is the facing V1
   *  recorded when they arrived, translated out of V1's sprite vocabulary. */
  facing: Facing;
  /** PHASE 6B — the EXACT yaw this person came to rest at, radians in V2's own yaw space, when the
   *  session that walked them published one (a V2 session does; a V1 one cannot). `facing` above is the
   *  four-word account of the same fact and is what everything V1 reads; this is what the body is turned
   *  to when present, and `facing` is what it falls back to when not. Never derived, never inferred. */
  yaw?: number;
  /** PHASE 6A — their walk, if one is in flight. Absent for everybody standing still, which is almost
   *  everybody almost always.
   *
   *  `point` above STAYS AUTHORITATIVE while this is present: it is where V1 last saw this person stop,
   *  and it is what the body settles on when the walk resolves. The walk is the in-flight picture, not a
   *  replacement for the stable fact — which is what makes a late, lost or superseded arrival recoverable
   *  rather than a body stranded wherever the replay happened to run out. */
  walk?: Vo3dCoworkerWalk;
  /** PHASE 6C — the V2 SEAT ANCHOR this person is sitting in (app/seats.ts ids), when V1's stable state
   *  says "sitting" with a seat key the mapping (adapters/v1Seats) identifies, and no walk is in flight.
   *  Absent for everybody standing, and for a sitter in a chair V2 cannot identify — who is then drawn
   *  standing at V1's centroid, honestly. world/Coworkers.ts puts a body with this on the chair's own
   *  cushion at the chair's own yaw playing the seated clip; `point` stays the authoritative V1 fact. */
  seat?: string;
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

/** THE CAVE'S PLACE NAME on the movement feed. One spelling, shared by the world that resolves it and by
 *  the rule below, so the two cannot drift. */
export const CAVE_PLACE_ID = "championship-cave";

/** WHO IS IN THE SAME VOLUME AS THE VIEWER — the roster the world should actually draw.
 *
 *  The Championship Cave is a separate interior volume 1,146 units east of the V1 frame, and its geometry
 *  is never drawn while nobody is inside it (rooms/cave.ts states that as its contract). A peer who walks
 *  in keeps publishing real Cave coordinates, so before this they were drawn — as a body with a nameplate
 *  standing in an empty field beyond the campus. The room was invisible; the person in it was not.
 *
 *  This applies the geometry's own rule to the bodies, off the `place` the feed already publishes: no new
 *  state, no new message, nothing networked. The AI Lab is deliberately NOT included — it is a real
 *  building on the drawn campus, so somebody standing in it is somewhere you can actually see.
 */
export function coworkersInSameVolume<T extends { place?: string }>(
  list: readonly T[],
  insideCave: boolean,
): T[] {
  return list.filter((c) => (c.place === CAVE_PLACE_ID) === insideCave);
}
