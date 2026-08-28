import { useEffect, useRef } from "react";
import { useCharacterWalk } from "./useCharacterWalk";
import { characterSprite } from "../../data/bonWalkFrames";
import { PLACEHOLDER_SPRITE_SET } from "../../services/avatar/placeholder";
import { getServerClockOffsetMs, type PeerMovementState } from "../../services/presence/movementSync";
import type { AvatarSpriteSet } from "../../services/avatar/types";

type Pt = { x: number; y: number };
export type PeerWalkerRenderState = {
  pos: Pt;
  src: string;
  isWalking: boolean;
  direction: import("../../data/bonWalkFrames").WalkDirection;
  isSitting: boolean;
};

type Props = {
  layerId: string; // peer's lowercased email — matches roster AssetLayer.id
  state: PeerMovementState;
  spriteSet: AvatarSpriteSet | null; // resolved by caller; null falls back to the placeholder set
  onUpdate: (layerId: string, state: PeerWalkerRenderState) => void;
};

// Headless per-peer movement-replay agent, mirroring SavedAvatarWalker.tsx's
// pattern: one useCharacterWalk instance per peer, rendered dynamically from
// OfficeMap (see usePeerMovements().map() there) so a dynamic number of
// peers can each own their own hook instance without violating React's
// "no hooks in a loop" rule. Renders no DOM — reports state up to OfficeMap
// via `onUpdate` (merged into characterOverrides/characterSrcOverrides/
// characterIsWalkingById/characterIsSittingById/characterDirectionsById).
//
// Every peer gets a real sprite set now (their own, or the shared
// PLACEHOLDER_SPRITE_SET) — never a blank/empty src, so a seated roster
// person with no registry-mapped sprite renders the placeholder's sit pose
// instead of sliding their static portrait across the floor.
export function PeerWalker({ layerId, state, spriteSet, onUpdate }: Props) {
  const { pos, isWalking, direction, frameIndex, walkTo, resetPos, face, cancel } = useCharacterWalk(
    state.stable.pos,
  );

  // Guards against replaying the SAME movementId twice — e.g. a StrictMode
  // double-mount, or this effect re-running while `state.active` still holds
  // the same movement (no new revision/movementId). Without this, every
  // re-run unconditionally reset+replayed from `origin`, which visibly
  // teleported an already-in-flight peer back to their walk's start.
  const lastPlayedMovementIdRef = useRef<string | null>(null);
  // Guards the arrived-branch below against re-firing its snap-to-stable
  // animation when the SAME revision re-triggers the effect (e.g. a re-mount
  // with unchanged props) — idempotent per revision.
  const lastArrivedRevisionRef = useRef<number | null>(null);

  // Replays an in-flight movement: keyed on movementId so a NEW walk
  // (superseding revision) always replays it exactly once per PeerWalker
  // instance, even if the previous movementId's animation hadn't finished
  // locally yet.
  useEffect(() => {
    if (!state.active) return;
    if (lastPlayedMovementIdRef.current === state.active.movementId) return;
    lastPlayedMovementIdRef.current = state.active.movementId;

    const { origin, path, durationMs, startedAt } = state.active;
    // Fast-forward offset: how much of this movement has already elapsed on
    // the server's clock, translated to local wall-clock via the stored
    // server/local clock offset (serverTime - Date.now(), captured from the
    // most recent positions_snapshot). Used for BOTH snapshot-sourced actives
    // (serverTime present) and live peer_walk_started events (serverTime
    // undefined here) — a live event still started at a real server epoch ms
    // (`startedAt`), and this connection's clock offset is exactly as valid
    // for translating that as it is for a snapshot's active movement; the
    // offset just hasn't been refreshed since the last snapshot (harmless —
    // client/server clock drift is negligible over a session). Clamped to
    // [0, durationMs] so clock skew/rounding can never produce a negative
    // elapsed (which would rewind the walk) or push it past the end (races
    // with the imminent walk_arrived).
    const clockOffset = getServerClockOffsetMs();
    const rawElapsedMs = Date.now() + clockOffset - startedAt;
    const elapsedMs = Math.min(durationMs, Math.max(0, rawElapsedMs));
    // Only snap to `origin` for a movement caught essentially at its start
    // (elapsedMs ~0) — a snapshot fast-forwarding an ALREADY in-flight walk
    // (elapsedMs>0) must start mid-path via walkTo's own opts, never yank the
    // avatar back to origin first (that produced the reported
    // teleport-to-origin-then-glide artifact).
    if (elapsedMs < 50) resetPos(origin);
    walkTo(path, undefined, { durationMs, elapsedMs });

    // Cancels the in-flight rAF loop on unmount/remount instead of leaving a
    // duplicate walk animating in the background.
    return () => cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.active?.movementId]);

  // Snaps to the authoritative stable pos/facing whenever a movement
  // resolves (active clears) or a fresh snapshot/arrival bumps revision
  // while no movement is in flight (e.g. a stale reconnect correction).
  // Idempotent on repeated firing for the SAME revision (e.g. a re-mount
  // with no new data) — only re-snaps when the revision actually advances.
  useEffect(() => {
    if (state.active) return;
    if (lastArrivedRevisionRef.current === state.revision) return;
    lastArrivedRevisionRef.current = state.revision;
    resetPos(state.stable.pos);
    face(state.stable.facing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.revision, state.active === null]);

  useEffect(() => {
    const set = spriteSet ?? PLACEHOLDER_SPRITE_SET;
    const isSitting = !state.active && state.stable.state === "sitting";
    const src = isWalking
      ? characterSprite(set, "walk", direction, frameIndex)
      : isSitting
        ? characterSprite(set, "sitType", state.stable.facing)
        : characterSprite(set, "idle", direction);
    onUpdate(layerId, { pos, src, isWalking, direction, isSitting });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerId, pos, isWalking, direction, frameIndex, spriteSet, state.active, state.stable.state, state.stable.facing]);

  return null;
}

export default PeerWalker;
