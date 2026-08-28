export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  sentAt: string; // ISO
  // Per-reader receipt arrays (real mode only) — see backend's compute_message_receipts.
  // Empty arrays in mock mode (no server-side receipt tracking there); empty (not undefined)
  // means "nobody yet", never null. deliveredTo/readBy are NOT guaranteed subsets of each other.
  deliveredTo: string[];
  readBy: string[];
  // True for the mock-only auto-echo reply — Phase 3 removes echo entirely.
  mock?: boolean;
  // @mentions V1 — server-validated (real conversation participant) emails mentioned in this
  // message. Always an array, never undefined/null on the wire (see backend's
  // serialize_message_dict) — empty for both "no mentions" and pre-mentions-feature rows.
  mentionedEmails: string[];
}

export interface Conversation {
  id: string;
  participantIds: string[];
  lastMessageAt: string;
  // Only populated in real mode (backend-derived, per-requester) — see
  // backend/src/repo/conversations.ts. Absent/undefined in mock mode.
  unreadCount?: number;
  // Only populated in real mode, same convention as unreadCount — count of unread messages that
  // mention the caller (feature spec section 15's "lightweight indicator/count").
  mentionCount?: number;
  // "dm" | "group" — backend already sends this on every row from
  // GET /conversations (see ConversationOut in backend/app/schemas/chat.py).
  // Missing/undefined (e.g. MockChatService, or an older cached row) must be
  // treated as "dm".
  type?: "dm" | "group";
  // Group display name; null/absent for DMs (peer identity derives from
  // participants instead).
  title?: string | null;
}

export type MessageListener = (msg: ChatMessage) => void;

export interface UnreadCountUpdate {
  conversationId: string;
  count: number;
}
export type UnreadCountListener = (update: UnreadCountUpdate) => void;

// @mentions V1 — mirrors UnreadCountUpdate's shape/semantics exactly, scoped to unread messages
// that mention the caller.
export interface MentionCountUpdate {
  conversationId: string;
  count: number;
}
export type MentionCountListener = (update: MentionCountUpdate) => void;

// Delivery/read receipts, Messenger-style watermarks (see backend's
// compute_message_receipts) — a per-conversation timestamp, not a per-message
// payload, since the server derives message-level status off these
// watermarks rather than storing it. Mirrors UnreadCountUpdate's shape.
export interface DeliveryReceiptUpdate {
  conversationId: string;
  deliveredUpTo: string;
}
export type DeliveryReceiptListener = (update: DeliveryReceiptUpdate) => void;

export interface ReadReceiptUpdate {
  conversationId: string;
  readUpTo: string;
}
export type ReadReceiptListener = (update: ReadReceiptUpdate) => void;

// Ephemeral typing-indicator update — no DB persistence, real-mode-only.
// senderId mirrors ChatMessage.senderId's shape (server-verified email).
export interface TypingUpdate {
  conversationId: string;
  senderId: string;
  isTyping: boolean;
}
export type TypingListener = (update: TypingUpdate) => void;

// Stage B2: fired once when an existing DM upgrades into a brand-new group
// conversation (see backend's requests.py `conversation_upgraded` socket
// event, emitted to every affected member's user room on an accepted
// join_group request). Field names here are the frontend's own
// mapping/renaming of the backend payload
// ({oldConversationId, newConversationId, participants}) — see
// RealChatService's onConversationUpgraded for the mapping. `title` is
// always null today since Stage A never sets a title on the newly-formed
// group.
export interface ConversationUpgradedUpdate {
  conversationId: string;
  // The DM conversation this upgrade replaced — needed by callers (see
  // OfficeMap.tsx's classifyUpgrade usage) to tell an "incumbent" (had this
  // exact DM panel open already) apart from the newly-accepted "joiner" (had
  // no prior panel open for it). Passed through unmodified from the backend's
  // conversation_upgraded payload — see RealChatService's onConversationUpgraded.
  oldConversationId: string;
  participantIds: string[];
  title: string | null;
}
export type ConversationUpgradedListener = (update: ConversationUpgradedUpdate) => void;

// Real-mode-only: surfaces the underlying Socket.IO connection lifecycle so
// the UI can show a "waking up the chat server" banner during a Render
// free-tier cold start instead of silently dropping sends. "reconnecting"
// covers both a mid-session drop and a cold-start handshake in progress.
// "error" is a terminal failure (handshake/auth rejected, or no auth token
// available at all) — socket.io v4 will NOT auto-retry after this, unlike
// "reconnecting" which the manager is actively retrying on its own.
export type ConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";
export type ConnectionStateListener = (state: ConnectionState) => void;

export interface ChatService {
  listConversations(): Promise<Conversation[]>;
  getMessages(conversationId: string): Promise<ChatMessage[]>;
  sendMessage(input: {
    conversationId: string;
    senderId: string;
    text: string;
    // @mentions V1 — candidate participant emails the composer resolved via autocomplete;
    // server-side re-validated against actual membership (see insert_message), never trusted
    // as-is. Omitted/empty means no mentions.
    mentionedEmails?: string[];
  }): Promise<ChatMessage>;
  openConversationWith(peerId: string, selfId: string): Promise<Conversation>;
  onMessage(cb: MessageListener): () => void;
  // Real-mode-only: manual group creation for the Global Chat "New Group Chat" flow (distinct
  // from the join_group-upgrade path, which forms groups as a side effect of an accepted
  // request). Idempotent server-side by exact member set — MockChatService has no server-side
  // group-formation concept, so it simply doesn't implement this (same pattern as onUnreadCount
  // et al above).
  createGroupConversation?(participantEmails: string[], title?: string | null): Promise<Conversation>;
  // Real-mode-only additions below — mock mode has no server-side read
  // tracking, so MockChatService simply doesn't implement them.
  markRead?(input: { conversationId: string; upToSentAt: string }): void;
  onUnreadCount?(cb: UnreadCountListener): () => void;
  // @mentions V1 — mock mode has no server-side mention validation/counting, so
  // MockChatService simply doesn't implement this (same pattern as onUnreadCount et al).
  onMentionCount?(cb: MentionCountListener): () => void;
  // Fire-and-forget ack that the caller's client has received message(s) up
  // to a given sentAt — mirrors markRead's shape/semantics but for delivery.
  markDelivered?(input: { conversationId: string; upToSentAt: string }): void;
  onDeliveryReceipt?(cb: DeliveryReceiptListener): () => void;
  onReadReceipt?(cb: ReadReceiptListener): () => void;
  // Fire-and-forget typing signal — mock mode has no server-side room to
  // broadcast to, so MockChatService's implementation is a no-op/local-only.
  sendTyping?(input: { conversationId: string; isTyping: boolean }): void;
  onTyping?(cb: TypingListener): () => void;
  // Stage B2 — real-mode-only, mirrors the other onX listener registrations
  // above. MockChatService has no server-side DM->group upgrade concept, so
  // it simply doesn't implement this (same pattern as onUnreadCount et al).
  onConversationUpgraded?(cb: ConversationUpgradedListener): () => void;
  // Mock mode has no real socket/connection to report on, so
  // MockChatService simply doesn't implement these.
  getConnectionState?(): ConnectionState;
  onConnectionState?(cb: ConnectionStateListener): () => void;
  // Populated when getConnectionState() === "error" — the human-readable
  // reason the connection failed (auth rejected, no token, etc).
  getConnectionError?(): string | undefined;
  // Manually re-arms the connection after a terminal "error" state.
  // socket.io does not auto-reconnect after an auth/namespace connect_error,
  // so recovery requires an explicit call (wired to a UI Retry button).
  reconnect?(): void;
}
