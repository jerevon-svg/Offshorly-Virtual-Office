// vo3d adapter — READ-ONLY view of the live positions V1 has already persisted. Phase 4B.
//
// PURE, and given its inputs rather than fetching them, exactly like adapters/v1Coworkers.ts: the React
// host (app/Vo3dHost.tsx) subscribes to V1's OWN movement store through V1's OWN hooks and hands the
// snapshot in. So this module opens no socket, issues no request, emits nothing, and cannot trigger
// apiFetch's 401 -> /login redirect.
//
// BOTH HALVES OF THE MOVEMENT FEED, NOW. services/presence/movementSync.ts carries two things per peer:
// `stable` (the last position they ARRIVED at) and `active` (a walk currently in flight, with its path,
// duration and server-stamped start).
//
//   Phase 4B read `stable` and only `stable`: a peer mid-walk kept the position they last stopped at
//   until their walk_arrived landed, and then jumped. Correct, and visibly a teleport.
//
//   PHASE 6A ALSO READS `active`, as Vo3dCoworker.walk — the route, the duration and how far in it is by
//   V1's own server clock. `stable` REMAINS THE AUTHORITY and is still what `point` reports; the walk is
//   only what the body does on the way to it. That split is what makes every awkward case recoverable: a
//   superseded walk is replaced by its successor, an interrupted one is corrected by the arrival that
//   follows it, and a walk whose arrival is lost still leaves the body on a position V1 vouches for.
//
// THE CLOCK OFFSET IS PASSED IN, not read here, for the same reason `snapshotReady` is: this module stays
// pure and given its inputs, and the host already owns every subscription (getServerClockOffsetMs is a
// plain read of movementSync's own last-snapshot offset — the same one V1's PeerWalker fast-forwards with).
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
import type { ActiveMovement, PeerMovementState, Pt } from "../../../services/presence/movementSync";
import type { Vo3dCoworker, Vo3dCoworkerSet, Vo3dCoworkerWalk } from "../app/coworkers";
import type { Vec2 } from "../core/coords";

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

/** Undo a sprite's TOP-LEFT origin against THAT person's own box — the one conversion this module does,
 *  applied identically to a stable position and to every point of a walk. */
const toCentre = (p: Pt, box: { width: number; height: number }): Vec2 => ({
  x: p.x + box.width / 2,
  z: p.y + box.height / 2,
});

/**
 * ONE PEER'S IN-FLIGHT WALK, as the world needs it — or null when there is nothing to replay.
 *
 * Refused, and the body left to its stable position, whenever the movement is not something V2 can draw
 * honestly:
 *   • no active movement at all, which is the normal case for almost everybody almost always;
 *   • an empty path, or any point of it that is not a believable V1 position (isUsablePosition, the same
 *     predicate the stable half is judged by) — a route V2 cannot express is not replayed in part;
 *   • a duration that is not a positive number, which would make the progress arithmetic meaningless.
 *
 * THE ORIGIN IS PATH[0]. V1 publishes them separately (`origin` plus the waypoints to visit), and a
 * replay needs one continuous polyline starting where the body actually was.
 *
 * ELAPSED IS V1'S OWN FAST-FORWARD ARITHMETIC, not a second version of it: `startedAt` is server epoch
 * ms, `serverClockOffsetMs` is serverTime - Date.now() from the last snapshot, and the difference is how
 * far in the walk is on this client's clock. Clamped to [0, durationMs] for the same reason V1's
 * PeerWalker clamps it — clock skew must not rewind a walk or push it past its end.
 */
export function resolveWalk(
  active: ActiveMovement | null,
  box: { width: number; height: number },
  serverClockOffsetMs: number,
  now = Date.now(),
): Vo3dCoworkerWalk | null {
  if (!active || !Array.isArray(active.path) || active.path.length === 0) return null;
  if (!Number.isFinite(active.durationMs) || active.durationMs <= 0) return null;
  if (!isUsablePosition(active.origin) || active.path.some((p) => !isUsablePosition(p))) return null;
  const elapsed = now + serverClockOffsetMs - active.startedAt;
  if (!Number.isFinite(elapsed)) return null;
  return {
    movementId: active.movementId,
    path: [toCentre(active.origin, box), ...active.path.map((p) => toCentre(p, box))],
    durationMs: active.durationMs,
    elapsedMs: Math.min(active.durationMs, Math.max(0, elapsed)),
  };
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
  serverClockOffsetMs = 0,
): Vo3dCoworkerSet {
  if (!snapshotReady || set.coworkers.length === 0 || peers.length === 0) return set;

  const byEmail = new Map<string, PeerMovementState>();
  for (const peer of peers) byEmail.set(peer.email, peer);

  let changed = false;
  const coworkers: Vo3dCoworker[] = set.coworkers.map((coworker) => {
    const peer = byEmail.get(coworker.email);
    if (!peer) return coworker;
    // PHASE 6A — the walk is resolved even for a peer whose STABLE position is unusable. The two halves
    // are independent facts: a corrupt persisted row is no reason to refuse a route that is fine, and the
    // body simply keeps its derived desk as the thing it settles on.
    const walk = resolveWalk(peer.active, coworker.box, serverClockOffsetMs);
    if (!isUsablePosition(peer.stable.pos)) {
      if (!walk) return coworker;
      // `changed` has to be set here too, or the by-reference return below discards this mapped array —
      // a set in which the ONLY thing that changed is somebody's walk would come back unmodified.
      changed = true;
      return { ...coworker, walk };
    }

    changed = true;
    return {
      ...coworker,
      // The conversion, in one place: their own box's halves, and nothing else.
      point: toCentre(peer.stable.pos, coworker.box),
      // V1's recorded arrival facing replaces the seat's own direction — they are not at the seat any
      // more, so the chair's direction is no longer the fact about them. Translated through the one
      // sprite-vocabulary table both other adapters use.
      facing: FACING_BY_DIRECTION[peer.stable.facing],
      posSource: "live",
      ...(walk ? { walk } : {}),
    };
  });

  if (!changed) return set;
  // `missingAvatar` is carried through untouched: it is a roster fact, and a position cannot create or
  // cure a missing 3D character.
  return { coworkers, missingAvatar: set.missingAvatar };
}

/** How many of a set have a walk in flight. For the readouts, a count and never a list of who. */
export function countWalking(set: Vo3dCoworkerSet): number {
  let n = 0;
  for (const coworker of set.coworkers) if (coworker.walk) n++;
  return n;
}

/** How many of a set stand on a live persisted position rather than a derived desk. For the host's
 *  redacted readout and the dev verification surface — a COUNT, never a list of who. */
export function countLivePositions(set: Vo3dCoworkerSet): number {
  let n = 0;
  for (const coworker of set.coworkers) if (coworker.posSource === "live") n++;
  return n;
}
