import type { WalkDirection } from "../../data/bonWalkFrames";
import type { PeerWalkerRenderState } from "./PeerWalker";

type Pt = { x: number; y: number };

export interface PeerOverrides {
  pos: Record<string, Pt>;
  src: Record<string, string>;
  isWalking: Record<string, boolean>;
  isSitting: Record<string, boolean>;
  direction: Record<string, WalkDirection>;
}

/**
 * Merges live movementSync-reported peer state into the override maps
 * OfficeMap.tsx feeds OfficeStage — EXCLUDING any email in `offlineEmails`
 * (the same Atlas-offline predicate offlineLineupPlacement.ts's
 * applyOfflineLineupPositions uses, via computeOfflineEmailSet).
 *
 * A peer who has gone Atlas-offline/checked-out must render at their
 * sidewalk lineup position (or wherever applyOfflineLineupPositions puts
 * them), never at a stale synced desk position from a positions_snapshot/
 * walk_arrived that predates them going offline — this drops their entry
 * from every override map (pos/src/isWalking/isSitting/direction) the
 * moment they're offline, so nothing lingers. The underlying
 * peerWalkState record itself is untouched (still holds their last known
 * state) — the moment they come back online this same filter naturally
 * lets their synced entry apply again, with no separate "clear on offline /
 * restore on online" bookkeeping needed.
 */
export function resolvePeerOverrides(
  peerWalkState: Record<string, PeerWalkerRenderState>,
  offlineEmails: Set<string>,
): PeerOverrides {
  const pos: Record<string, Pt> = {};
  const src: Record<string, string> = {};
  const isWalking: Record<string, boolean> = {};
  const isSitting: Record<string, boolean> = {};
  const direction: Record<string, WalkDirection> = {};
  for (const [email, s] of Object.entries(peerWalkState)) {
    if (offlineEmails.has(email)) continue;
    pos[email] = s.pos;
    src[email] = s.src;
    isWalking[email] = s.isWalking;
    isSitting[email] = s.isSitting;
    direction[email] = s.direction;
  }
  return { pos, src, isWalking, isSitting, direction };
}

/**
 * Which peer emails get a live <PeerWalker> instance: must have a real
 * roster layer, must not be self, and must not be Atlas-offline (an
 * offline peer's position is owned by applyOfflineLineupPositions/the
 * sidewalk lineup, not movementSync replay — mounting a PeerWalker for them
 * would fight that placement with a stale synced desk position).
 */
export function resolveRenderablePeerEmails(
  peerEmails: string[],
  rosterLayerEmailSet: Set<string>,
  offlineEmails: Set<string>,
  selfEmailLower: string,
): string[] {
  return peerEmails.filter(
    (email) =>
      email !== selfEmailLower && rosterLayerEmailSet.has(email) && !offlineEmails.has(email),
  );
}
