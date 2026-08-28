// Pure, conversation-scoped typing state for the office map (dependency-free so it is unit
// testable without mounting OfficeMap). Locked 2026-08-28.
//
// Why conversation-scoped: chatService.onTyping delivers typing for EVERY conversation the
// viewer is in (spatial DMs/groups AND remote Global Chat windows). The `agree-gesture`
// animation must only react to typing that happened in the character's CURRENT spatial
// conversation — a peer who is clustered with you but typing in an unrelated remote DM keeps
// showing `listening-gesture`. Keying by (email, conversationId) also makes stop/timeout events
// clear only their own entry, so an out-of-order stop from one conversation can never cancel
// active typing in another.
//
// The overhead "typing dots" bubble deliberately keeps its broader any-conversation semantics
// (deriveAnyTypingCharacterIds) — only the animation is spatial-scoped.

import type { SpatialSessionEntry } from "../../services/presence/spatialSessionStore";

/** lowercased email -> set of conversation ids that email is currently typing in. */
export type PeerTypingState = Record<string, Record<string, true>>;

export interface PeerTypingUpdate {
  email: string;
  conversationId: string;
  isTyping: boolean;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Stable key for the per-(email, conversation) inactivity timer. */
export function typingTimerKey(email: string, conversationId: string): string {
  return `${normalizeEmail(email)}|${conversationId}`;
}

/** Immutable update: adds/removes exactly the (email, conversationId) entry. Returns the same
 * object when nothing changed so React state setters can bail out. */
export function applyPeerTypingUpdate(state: PeerTypingState, update: PeerTypingUpdate): PeerTypingState {
  const email = normalizeEmail(update.email);
  const convs = state[email];
  if (update.isTyping) {
    if (convs?.[update.conversationId]) return state;
    return { ...state, [email]: { ...(convs ?? {}), [update.conversationId]: true } };
  }
  if (!convs?.[update.conversationId]) return state;
  const rest: Record<string, true> = { ...convs };
  delete rest[update.conversationId];
  if (Object.keys(rest).length === 0) {
    const next = { ...state };
    delete next[email];
    return next;
  }
  return { ...state, [email]: rest };
}

/** Any-conversation typing (drives the overhead dots bubble only). Layer-id-keyed: peers'
 * layer ids equal their lowercased email; self is the avatar/layer id. */
export function deriveAnyTypingCharacterIds(
  peerTyping: PeerTypingState,
  selfTyping: boolean,
  playerLayerId: string,
): string[] {
  const ids = new Set<string>();
  if (selfTyping) ids.add(playerLayerId);
  for (const [email, convs] of Object.entries(peerTyping)) {
    if (Object.keys(convs).length > 0) ids.add(email);
  }
  return Array.from(ids);
}

export interface SpatialTypingInput {
  peerTyping: PeerTypingState;
  /** Server-broadcast spatial sessions; sessionId === the spatial Conversation.id. */
  sessions: SpatialSessionEntry[];
  selfChatId: string | null | undefined;
  playerLayerId: string;
  /** Conversation id the viewer is currently typing in (spatial ConversationView /
   * GroupConversationView only), or null when not typing. */
  selfTypingConversationId: string | null;
}

/** Spatial-scoped typing for the `agree-gesture` animation: a character counts as typing only
 * when it is a member of a live (>=2 member) spatial session AND has an unexpired typing entry
 * for THAT session's conversation id. Layer-id-keyed like talkingCharacterIdsFromSessions. */
export function deriveSpatialTypingCharacterIds(input: SpatialTypingInput): string[] {
  const { peerTyping, sessions, selfChatId, playerLayerId, selfTypingConversationId } = input;
  const self = selfChatId ? normalizeEmail(selfChatId) : null;
  const ids = new Set<string>();
  for (const session of sessions) {
    if (session.members.length < 2) continue;
    for (const rawMember of session.members) {
      const member = normalizeEmail(rawMember);
      if (self !== null && member === self) {
        if (selfTypingConversationId === session.sessionId) ids.add(playerLayerId);
        continue;
      }
      if (peerTyping[member]?.[session.sessionId]) ids.add(member);
    }
  }
  return Array.from(ids);
}
