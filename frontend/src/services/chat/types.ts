export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  sentAt: string; // ISO
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

// Real-mode-only: surfaces the underlying Socket.IO connection lifecycle so
// the UI can show a "waking up the chat server" banner during a Render
// free-tier cold start instead of silently dropping sends. "reconnecting"
// covers both a mid-session drop and a cold-start handshake in progress.
export type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";
export type ConnectionStateListener = (state: ConnectionState) => void;

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
  // Mock mode has no real socket/connection to report on, so
  // MockChatService simply doesn't implement these.
  getConnectionState?(): ConnectionState;
  onConnectionState?(cb: ConnectionStateListener): () => void;
}
