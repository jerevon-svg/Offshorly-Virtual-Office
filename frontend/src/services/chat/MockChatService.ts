import type { ChatMessage, ChatService, Conversation, MessageListener, TypingListener } from "./types";

export const CHAT_STORAGE_KEY = "offshorly.chat";

interface ChatStorageShape {
  conversations: Conversation[];
  messages: ChatMessage[];
}

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function load(): ChatStorageShape {
  if (!hasStorage()) return { conversations: [], messages: [] };
  try {
    const raw = window.localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return { conversations: [], messages: [] };
    const parsed = JSON.parse(raw) as ChatStorageShape;
    return {
      conversations: parsed.conversations ?? [],
      messages: parsed.messages ?? [],
    };
  } catch {
    return { conversations: [], messages: [] };
  }
}

function save(state: ChatStorageShape): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures (quota, privacy mode) — chat persistence is
    // best-effort, not required for the flow to function.
  }
}

function conversationId(a: string, b: string): string {
  return `conv-${[a, b].sort().join("__")}`;
}

let msgSeq = 0;
function nextMessageId(): string {
  msgSeq += 1;
  return `msg-${Date.now()}-${msgSeq}`;
}

// Mock-only canned replies used for the auto-echo below. Phase 3 removes this
// entire echo mechanism once a real backend/peer delivers replies.
const CANNED_REPLIES = [
  "Got it, thanks!",
  "Sounds good.",
  "On it.",
  "Sure, give me a sec.",
  "Noted!",
];

function canned(): string {
  return CANNED_REPLIES[Math.floor(Math.random() * CANNED_REPLIES.length)];
}

export class MockChatService implements ChatService {
  private state: ChatStorageShape = load();
  private listeners = new Set<MessageListener>();
  private typingListeners = new Set<TypingListener>();

  async listConversations(): Promise<Conversation[]> {
    return this.state.conversations.slice();
  }

  async getMessages(conversationId: string): Promise<ChatMessage[]> {
    return this.state.messages
      .filter((m) => m.conversationId === conversationId)
      .slice()
      .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  }

  async openConversationWith(peerId: string, selfId: string): Promise<Conversation> {
    const id = conversationId(peerId, selfId);
    let conv = this.state.conversations.find((c) => c.id === id);
    if (!conv) {
      conv = {
        id,
        participantIds: [selfId, peerId],
        lastMessageAt: new Date().toISOString(),
      };
      this.state.conversations.push(conv);
      save(this.state);
    }
    return conv;
  }

  async sendMessage(input: {
    conversationId: string;
    senderId: string;
    text: string;
  }): Promise<ChatMessage> {
    const message = this.appendMessage({
      id: nextMessageId(),
      conversationId: input.conversationId,
      senderId: input.senderId,
      text: input.text,
      sentAt: new Date().toISOString(),
      // Mock mode has no server-side receipt tracking — always empty, never populated.
      deliveredTo: [],
      readBy: [],
    });

    // Mock-only auto-echo: a user-originated send gets one canned reply from
    // the peer after a short delay, so the chat feels alive without a real
    // backend. Phase 3 removes this block entirely once real peer delivery
    // exists. Never echo an echo (mock:true) — that would loop forever.
    if (!message.mock) {
      const conv = this.state.conversations.find((c) => c.id === input.conversationId);
      const peerId = conv?.participantIds.find((id) => id !== input.senderId);
      if (peerId) {
        const delay = 800 + Math.random() * 700;
        setTimeout(() => {
          this.appendMessage({
            id: nextMessageId(),
            conversationId: input.conversationId,
            senderId: peerId,
            text: canned(),
            sentAt: new Date().toISOString(),
            deliveredTo: [],
            readBy: [],
            mock: true,
          });
        }, delay);
      }
    }

    return message;
  }

  onMessage(cb: MessageListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  // No real peer socket in mock mode — a plain no-op satisfies the
  // interface. onTyping's listeners are simply never invoked.
  sendTyping(_input: { conversationId: string; isTyping: boolean }): void {
    // Intentionally a no-op — see class comment above.
  }

  onTyping(cb: TypingListener): () => void {
    this.typingListeners.add(cb);
    return () => {
      this.typingListeners.delete(cb);
    };
  }

  private appendMessage(message: ChatMessage): ChatMessage {
    this.state.messages.push(message);
    const conv = this.state.conversations.find((c) => c.id === message.conversationId);
    if (conv) {
      conv.lastMessageAt = message.sentAt;
    }
    save(this.state);
    this.listeners.forEach((cb) => cb(message));
    return message;
  }
}

export const mockChatService = new MockChatService();
