export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  sentAt: string; // ISO
  // Derived watermark timestamps (real mode only) — see backend's compute_message_receipts.
  // Undefined/absent in mock mode. Null-in-wire-format arrives as `undefined` here since these
  // are optional fields; both unset = sent only, deliveredAt set + readAt unset = delivered,
  // both set = read.
  deliveredAt?: string;
  readAt?: string;
  // True for the mock-only auto-echo reply — Phase 3 removes echo entirely.
  mock?: boolean;
}

export interface Conversation {
  id: string;
  participantIds: string[];
  lastMessageAt: string;
  // Only populated in real mode (backend-derived, per-requester) — see
  // backend/src/repo/conversations.ts. Absent/undefined in mock mode.
  unreadCount?: number;
}

export type MessageListener = (msg: ChatMessage) => void;

export interface UnreadCountUpdate {
  conversationId: string;
  count: number;
}
export type UnreadCountListener = (update: UnreadCountUpdate) => void;

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

export interface ChatService {
  listConversations(): Promise<Conversation[]>;
  getMessages(conversationId: string): Promise<ChatMessage[]>;
  sendMessage(input: {
    conversationId: string;
    senderId: string;
    text: string;
  }): Promise<ChatMessage>;
  openConversationWith(peerId: string, selfId: string): Promise<Conversation>;
  onMessage(cb: MessageListener): () => void;
  // Real-mode-only additions below — mock mode has no server-side read
  // tracking, so MockChatService simply doesn't implement them.
  markRead?(input: { conversationId: string; upToSentAt: string }): void;
  onUnreadCount?(cb: UnreadCountListener): () => void;
  // Fire-and-forget ack that the caller's client has received message(s) up
  // to a given sentAt — mirrors markRead's shape/semantics but for delivery.
  markDelivered?(input: { conversationId: string; upToSentAt: string }): void;
  onDeliveryReceipt?(cb: DeliveryReceiptListener): () => void;
  onReadReceipt?(cb: ReadReceiptListener): () => void;
}
