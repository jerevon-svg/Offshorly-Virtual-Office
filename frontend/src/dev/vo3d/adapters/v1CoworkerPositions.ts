// vo3d adapter — READ-ONLY view of the live positions V1 has already persisted. Phase 4B.
//
// PURE, and given its inputs rather than fetching them, exactly like adapters/v1Coworkers.ts: the React
// host (app/Vo3dHost.tsx) subscribes to V1's OWN movement store through V1's OWN hooks and hands the
// snapshot in. So this module opens no socket, issues no request, emits nothing, and cannot trigger
// apiFetch's 401 -> /login redirect.
//
// THE ONE HALF OF THE MOVEMENT FEED THIS READS. services/presence/movementSync.ts carries two things per
// peer: `stable` (the last position they ARRIVED at) and `active` (a walk currently in flight, with its
// path, duration and server clock offset). This reads `stable` AND ONLY `stable`. A peer mid-walk keeps
// the position they last stopped at until their walk_arrived lands, and then jumps. That is the whole of
// Phase 4B's "snap on arrival": the in-flight half is not consumed, so there is no interpolation to get
// wrong and no clock arithmetic to drift. Walking is a later phase.
//
// TOP-LEFT -> CENTRE, THROUGH THAT PERSON'S OWN BOX. A `stable.pos` is in the SAME coordinate space as
// `layer.x`/`layer.y` (movementSync's own header says so, and V1's OfficeMap.tsx resolveMemberCenter does
// exactly this arithmetic): the sprite's TOP-LEFT. Undoing it needs THAT employee's own width/height —
// data/rosterLayers.ts gives a live-3D employee their own manifest box because micah and angelo are
// deliberately taller for raised-arm headroom. Vo3dCoworker.box carries it, resolved once by
// adapters/v1Coworkers.ts, so the two adapters cannot disagree about which box a person has.
//
// THE ROOM SHIFT IS NOT APPLIED HERE. The result is still in V1 FRAME UNITS, the same basis the derived
// desk is in, so app/world.ts keeps applying its single homeDeskWorldPoint() to both. One room-shift
// table, and this module never has to learn that a V2 room moved.
//
// REVISION ORDERING IS NOT RE-IMPLEMENTED HERE EITHER. movementSync's reducers (applySnapshot /
// applyStarted / applyArrived) already refuse anything whose server-issued revision is not newer than
// what they hold, so the store this reads is monotonic per employee by construction. Re-deciding it here
// would be a second copy of an ordering rule that agrees until one of them is edited.
import { FRAME } from "./v1Floor";
import { FACING_BY_DIRECTION } from "./v1Facing";
import type { PeerMovementState, Pt } from "../../../services/presence/movementSync";
import type { Vo3dCoworker, Vo3dCoworkerSet } from "../app/coworkers";

/** How far outside the V1 frame a persisted position may still be believed.
 *
 *  Not a tolerance for legitimate positions — every place a body can legally stand, sidewalk included, is
 *  a manifest layer INSIDE the 1440 x 1244 frame. It is slack so a position that is merely on the edge is
 *  not thrown away, while an obviously corrupt one is. The check exists at all because nothing upstream
 *  range-checks the snapshot path: the backend validates walk_started/walk_arrived payloads on the way in
 *  but positions_snapshot replays whatever the registry holds, and applySnapshot copies `pos` through
 *  untouched. A NaN or a 1e9 reaching V2 would not throw — it would spin the whole ring search in
 *  standablePointNear and silently move that person into `unplaced`, which reads as "V2 could not place
 *  them" when the truth is "V1 handed over a number that is not a place". */
const OUT_OF_FRAME_SLACK = 200;

/** Is this a position at all? Finite, and somewhere a body could plausibly be. */
export function isUsablePosition(pos: Pt | null | undefined): boolean {
  if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number") return false;
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return false;
  if (pos.x < FRAME.x - OUT_OF_FRAME_SLACK || pos.x > FRAME.x + FRAME.w + OUT_OF_FRAME_SLACK) return false;
  if (pos.y < FRAME.z - OUT_OF_FRAME_SLACK || pos.y > FRAME.z + FRAME.d + OUT_OF_FRAME_SLACK) return false;
  return true;
}

/**
 * The same coworkers, standing where V1 last saw them stop.
 *
 * `snapshotReady` is services/presence/movementSync's own hasReceivedPositionsSnapshot flag, passed in.
 * It is the ONLY honest "we know what V1 knows" signal: before the first positions_snapshot the store is
 * simply empty, and an empty store is indistinguishable from "nobody has ever moved". Gating on it is
 * what keeps Phase 4A's desks on screen during connection instead of flickering through them — the same
 * reason V1's own OfficeMap waits on it before deciding a spawn.
 *
 * EVERY PERSON KEEPS THEIR DESK UNLESS ALL THREE ARE TRUE: the snapshot has arrived, V1 holds a stable
 * entry for them, and that entry's position is usable. There is no fourth path and nothing is invented.
 *
 * `peers` is the WHOLE movement store, which is append-only and outlives the people in it — it holds
 * ex-employees, people in no V1 room, and anyone who has gone offline since. This function is a LEFT JOIN
 * from the coworker set onto it: a peer with no coworker is not drawn, which is what keeps Phase 4A's
 * roster filtering, self-exclusion, missing-avatar bucketing and offline predicate load-bearing. All four
 * have already run by the time this is called, so stale movement data can never resurrect anybody.
 *
 * Returns the INPUT SET BY REFERENCE when nothing applies, so a host memoising on it does not push an
 * identical roster into the world on every snapshot tick.
 */
export function applyLivePositions(
  set: Vo3dCoworkerSet,
  peers: readonly PeerMovementState[],
  snapshotReady: boolean,
): Vo3dCoworkerSet {
  if (!snapshotReady || set.coworkers.length === 0 || peers.length === 0) return set;

  const byEmail = new Map<string, PeerMovementState>();
  for (const peer of peers) byEmail.set(peer.email, peer);

  let changed = false;
  const coworkers: Vo3dCoworker[] = set.coworkers.map((coworker) => {
    const peer = byEmail.get(coworker.email);
    if (!peer || !isUsablePosition(peer.stable.pos)) return coworker;

    changed = true;
    return {
      ...coworker,
      // The conversion, in one place: their own box's halves, and nothing else.
      point: {
        x: peer.stable.pos.x + coworker.box.width / 2,
        z: peer.stable.pos.y + coworker.box.height / 2,
      },
      // V1's recorded arrival facing replaces the seat's own direction — they are not at the seat any
      // more, so the chair's direction is no longer the fact about them. Translated through the one
      // sprite-vocabulary table both other adapters use.
      facing: FACING_BY_DIRECTION[peer.stable.facing],
      posSource: "live",
    };
  });

  if (!changed) return set;
  // `missingAvatar` is carried through untouched: it is a roster fact, and a position cannot create or
  // cure a missing 3D character.
  return { coworkers, missingAvatar: set.missingAvatar };
}

/** How many of a set stand on a live persisted position rather than a derived desk. For the host's
 *  redacted readout and the dev verification surface — a COUNT, never a list of who. */
export function countLivePositions(set: Vo3dCoworkerSet): number {
  let n = 0;
  for (const coworker of set.coworkers) if (coworker.posSource === "live") n++;
  return n;
}
