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
}

export type MessageListener = (msg: ChatMessage) => void;

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
}
