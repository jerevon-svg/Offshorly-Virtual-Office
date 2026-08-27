// frontend/src/components/OfficeMap/clusterFormation.ts
//
// Pure, DOM-free decision helpers wiring together Stage 1's assignClusterSlots
// geometry (data/clusterSlots.ts) and Stage 3's emitAndWalkTo peer-walk
// broadcast (services/presence/spatialWalkClient.ts) into actual
// conversation-formation behavior. Kept free of React/DOM so every branch is
// unit-testable without mounting OfficeMap.tsx — see OfficeMap.tsx's two call
// sites (the self-settle effect, and the conversation_upgraded handler) for
// how these compose with real state.

import type { ConversationUpgradedUpdate } from "../../services/chat/types";

export type Pt = { x: number; y: number };

/** Centroid (mean x, mean y) of the given points. {x:0,y:0} for an empty array
 * — callers should treat that as "no resolvable anchor" rather than a real
 * position, same as assignClusterSlots's own NaN/Infinity guard treats an
 * unusable anchor. */
export function computeClusterAnchor(centers: Pt[]): Pt {
  if (centers.length === 0) return { x: 0, y: 0 };
  const sum = centers.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / centers.length, y: sum.y / centers.length };
}

/**
 * Picks which member centers should feed the cluster anchor centroid for a
 * fresh conversation_upgraded event: the INCUMBENTS only (everyone except
 * `self`), so a newly-arriving joiner's own far-away starting position never
 * drags the anchor (and thus the incumbents' "make room" repositioning)
 * toward wherever the joiner started their walk from. Falls back to ALL
 * members only when no incumbent position resolves at all (e.g. presence
 * data hasn't loaded yet for either incumbent) — preserves the prior
 * behavior for that edge case rather than producing an empty/broken anchor.
 */
export function incumbentCentersForAnchor(
  participantIds: string[],
  self: string,
  resolveMemberCenter: (member: string) => Pt | null,
): Pt[] {
  const selfLower = self.toLowerCase();
  const incumbentCenters = participantIds
    .filter((m) => m.toLowerCase() !== selfLower)
    .map(resolveMemberCenter)
    .filter((p): p is Pt => p !== null);
  if (incumbentCenters.length) return incumbentCenters;
  return participantIds.map(resolveMemberCenter).filter((p): p is Pt => p !== null);
}

/** Stable identity for "this exact membership set" — case- and
 * order-independent, so re-renders with the same members (in any order, any
 * case) collapse to the identical string. Used to detect a genuine membership
 * change vs. a re-render of the same cluster. */
export function slotWalkSignature(members: string[]): string {
  return members
    .map((m) => m.toLowerCase())
    .sort()
    .join(",");
}

export interface SlotWalkSession {
  members: string[];
}

/**
 * Decision logic for the self-settle mechanism (Mechanism 1): given the
 * current spatial sessions, finds the one self belongs to with >=2 members
 * and decides whether the caller should (re)walk to its cluster slot.
 *
 * - No such session -> { reset: true } (caller should null out its signature ref).
 * - Found, but its signature matches lastSignature -> null (already settled).
 * - Found, signature differs, but a walk is already in flight (isWalking) ->
 *   null (don't interrupt it; the caller's effect re-runs once isWalking
 *   flips false, since it's a dependency there).
 * - Found, signature differs, not walking -> { members, signature } (caller
 *   should compute the anchor/slot/path and walk).
 */
export function resolveSelfSlotWalk(input: {
  sessions: SlotWalkSession[];
  selfEmail: string;
  lastSignature: string | null;
  isWalking: boolean;
}): { reset: true } | { members: string[]; signature: string } | null {
  const self = input.selfEmail.toLowerCase();
  const session = input.sessions.find(
    (s) => s.members.length >= 2 && s.members.some((m) => m.toLowerCase() === self),
  );

  if (!session) return { reset: true };

  const signature = slotWalkSignature(session.members);
  if (signature === input.lastSignature) return null;
  if (input.isWalking) return null;

  return { members: session.members, signature };
}

/**
 * Classifies which side of a conversation_upgraded event self is on:
 * - "incumbent": self already had this conversation's OLD (DM) panel open
 *   before the upgrade — both original DM participants satisfy this, since
 *   Ask-to-Join can only be offered against a conversation both DM members
 *   already had open.
 * - "joiner": self had no prior panel open for this conversation — the
 *   newly-accepted 3rd person.
 */
export function classifyUpgrade(input: {
  selfEmail: string;
  openConversationId: string | null;
  payload: Pick<ConversationUpgradedUpdate, "oldConversationId" | "participantIds">;
}): "incumbent" | "joiner" {
  return input.openConversationId === input.payload.oldConversationId ? "incumbent" : "joiner";
}
