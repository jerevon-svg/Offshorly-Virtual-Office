import { io, type Socket } from "socket.io-client";
import { getAuthToken } from "../api/client";
import type {
  ChatMessage,
  ChatService,
  Conversation,
  DeliveryReceiptListener,
  DeliveryReceiptUpdate,
  MessageListener,
  ReadReceiptListener,
  ReadReceiptUpdate,
  UnreadCountListener,
  UnreadCountUpdate,
} from "./types";

// Real implementation — talks to the Phase 3 backend (../../../backend/)
// over REST for reads/writes-with-history and Socket.IO for live delivery.
//
// Deliberately NOT the same base as the Atlas API client
// (src/services/api/client.ts): this backend is a separate service (see
// backend/README.md), reached via VITE_CHAT_SOCKET_URL, not VITE_API_URL.
// It reuses the same bearer token (getAuthToken()) rather than duplicating
// the localStorage key lookup.

const SEND_TIMEOUT_MS = 8000;

function socketBase(): string {
  const raw = import.meta.env.VITE_CHAT_SOCKET_URL;
  if (!raw) {
    throw new Error(
      "VITE_CHAT_SOCKET_URL is not set. Required when VITE_CHAT_MODE=real — see .env.example.",
    );
  }
  return raw.replace(/\/+$/, "");
}

async function restFetch(
  path: string,
  init: RequestInit = {},
  devEmail: string | null = null,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (devEmail) {
    headers.set("x-dev-email", devEmail);
  } else {
    const token = getAuthToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${socketBase()}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Chat backend request failed (${res.status}) for ${path}`);
  }
  return res;
}

let msgSeq = 0;
function nextClientTempId(): string {
  msgSeq += 1;
  return `tmp-${Date.now()}-${msgSeq}`;
}

interface PendingSend {
  resolve: (msg: ChatMessage) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class RealChatService implements ChatService {
  private socketInstance: Socket | null = null;
  private listeners = new Set<MessageListener>();
  private unreadCountListeners = new Set<UnreadCountListener>();
  private deliveryReceiptListeners = new Set<DeliveryReceiptListener>();
  private readReceiptListeners = new Set<ReadReceiptListener>();
  private pendingSends = new Map<string, PendingSend>();
  // Tracks the most recently seen sentAt per conversation, from any message
  // that has flowed through pushMessage (send, receive, or history fetch).
  // Used as the `since` cursor for the reconnect catch-up fetch below.
  private lastSeenSentAt = new Map<string, string>();
  // The conversation the UI currently has open — set by getMessages()/
  // openConversationWith(), the two call sites ConversationView actually
  // uses when a chat panel is showing. Used to know what to re-fetch after
  // a reconnect.
  private activeConversationId: string | null = null;
  private hadPriorDisconnect = false;
  // DEV-ONLY: when set, requests/sockets authenticate via the backend's
  // `x-dev-email` bypass (backend/src/http.ts `devEmailFrom` / backend/src/
  // socket.ts `devEmailFromHandshake`, both hard-gated to
  // NODE_ENV !== "production" server-side) instead of the real Atlas bearer
  // token. Only ever set by the dev-only test harness (see
  // src/pages/ChatTestPage.tsx) — never touched by the normal app.
  private devEmail: string | null = null;

  // DEV-ONLY: switches this instance to the backend's dev-email bypass
  // (or back to normal token auth when passed null). Tears down any live
  // socket so the next call reconnects with the new identity.
  setDevIdentity(email: string | null): void {
    this.devEmail = email ? email.trim().toLowerCase() : null;
    if (this.socketInstance) {
      this.socketInstance.disconnect();
      this.socketInstance = null;
    }
  }

  private socket(): Socket {
    if (this.socketInstance) return this.socketInstance;

    const auth: Record<string, string | null> = this.devEmail
      ? { "x-dev-email": this.devEmail }
      : { token: getAuthToken() };
    const socket = io(socketBase(), {
      auth,
      autoConnect: true,
    });

    socket.on("connect", () => {
      if (this.hadPriorDisconnect) {
        this.hadPriorDisconnect = false;
        this.catchUpActiveConversation();
      }
    });
    socket.on("disconnect", () => {
      this.hadPriorDisconnect = true;
    });

    socket.on("message_saved", (payload: { clientTempId: string; message: ChatMessage }) => {
      const pending = this.pendingSends.get(payload.clientTempId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingSends.delete(payload.clientTempId);
        pending.resolve(payload.message);
      }
      this.pushMessage(payload.message);
    });

    socket.on("incoming_message", (payload: { message: ChatMessage }) => {
      this.pushMessage(payload.message);
      // Live-receipt case: a message just arrived while we're connected — ack delivery
      // immediately so the sender's "sent" doesn't stay stuck once we're actually here.
      this.ackDelivered(payload.message.conversationId, [payload.message]);
    });

    socket.on("unread_count", (payload: UnreadCountUpdate) => {
      this.unreadCountListeners.forEach((cb) => cb(payload));
    });

    socket.on("delivery_receipt", (payload: DeliveryReceiptUpdate) => {
      this.deliveryReceiptListeners.forEach((cb) => cb(payload));
    });

    socket.on("read_receipt", (payload: ReadReceiptUpdate) => {
      this.readReceiptListeners.forEach((cb) => cb(payload));
    });

    socket.on("chat_error", (payload: { code: string; message: string }) => {
      // Surfaced to any in-flight sendMessage callers via rejection isn't
      // possible generically here (no clientTempId on most chat_errors) —
      // log so failures are at least visible during development/triage.
      console.error(`[chat] ${payload.code}: ${payload.message}`);
    });

    this.socketInstance = socket;
    return socket;
  }

  private pushMessage(msg: ChatMessage): void {
    const seen = this.lastSeenSentAt.get(msg.conversationId);
    if (!seen || msg.sentAt > seen) {
      this.lastSeenSentAt.set(msg.conversationId, msg.sentAt);
    }
    this.listeners.forEach((cb) => cb(msg));
  }

  private async catchUpActiveConversation(): Promise<void> {
    const conversationId = this.activeConversationId;
    if (!conversationId) return;
    try {
      const since = this.lastSeenSentAt.get(conversationId);
      const qs = since ? `?since=${encodeURIComponent(since)}` : "";
      const res = await restFetch(
        `/conversations/${encodeURIComponent(conversationId)}/messages${qs}`,
        {},
        this.devEmail,
      );
      const messages: ChatMessage[] = await res.json();
      // Existing ConversationView dedup (by message id) handles any overlap
      // with what's already rendered — pushing the full catch-up batch
      // through the normal onMessage path is safe.
      for (const msg of messages) this.pushMessage(msg);
      // Offline-then-reconnect case: any message sent to us while we were
      // offline must not stay stuck on "sent" forever now that we've caught
      // up — ack delivery for the whole batch.
      this.ackDelivered(conversationId, messages);
    } catch (err) {
      console.error("[chat] reconnect catch-up fetch failed", err);
    }
  }

  // Fire-and-forget delivery ack, mirroring markRead's pattern — acks up to
  // the newest sentAt in the given batch. Safe to call even for a batch that
  // includes our own sent messages: the server only ever treats a watermark
  // as meaningful for messages sent by the OTHER participant (see backend's
  // compute_message_receipts), so acking our own messages' delivery is a
  // harmless no-op there.
  private ackDelivered(conversationId: string, messages: ChatMessage[]): void {
    if (messages.length === 0) return;
    let newest = messages[0].sentAt;
    for (const msg of messages) {
      if (msg.sentAt > newest) newest = msg.sentAt;
    }
    this.socket().emit("message_delivered", { conversationId, upToSentAt: newest });
  }

  async listConversations(): Promise<Conversation[]> {
    this.socket(); // ensure connection is established for live updates
    const res = await restFetch("/conversations", {}, this.devEmail);
    return res.json();
  }

  async getMessages(conversationId: string): Promise<ChatMessage[]> {
    this.activeConversationId = conversationId;
    this.socket().emit("join_conversation", { conversationId });
    const res = await restFetch(
      `/conversations/${encodeURIComponent(conversationId)}/messages`,
      {},
      this.devEmail,
    );
    const messages: ChatMessage[] = await res.json();
    for (const msg of messages) {
      const seen = this.lastSeenSentAt.get(msg.conversationId);
      if (!seen || msg.sentAt > seen) this.lastSeenSentAt.set(msg.conversationId, msg.sentAt);
    }
    return messages;
  }

  async openConversationWith(peerId: string, _selfId: string): Promise<Conversation> {
    this.socket(); // ensure connection is established before REST call
    const res = await restFetch(
      "/conversations",
      {
        method: "POST",
        body: JSON.stringify({ peerEmail: peerId }),
      },
      this.devEmail,
    );
    const conv: Conversation = await res.json();
    this.activeConversationId = conv.id;
    this.socket().emit("join_conversation", { conversationId: conv.id });
    return conv;
  }

  sendMessage(input: { conversationId: string; senderId: string; text: string }): Promise<ChatMessage> {
    const clientTempId = nextClientTempId();
    const socket = this.socket();

    return new Promise<ChatMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingSends.delete(clientTempId);
        reject(new Error("Timed out waiting for the server to confirm this message was sent."));
      }, SEND_TIMEOUT_MS);

      this.pendingSends.set(clientTempId, { resolve, reject, timer });

      socket.emit("send_message", {
        conversationId: input.conversationId,
        text: input.text,
        clientTempId,
      });
    });
  }

  onMessage(cb: MessageListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  // Fire-and-forget, mirroring the backend's own `message_read` handler
  // (which doesn't ack) — the caller doesn't need a round trip to know a
  // read was recorded, and a dropped event here just means the badge stays
  // stale until the next mark-read call, not a functional break.
  markRead(input: { conversationId: string; upToSentAt: string }): void {
    this.socket().emit("message_read", input);
  }

  onUnreadCount(cb: UnreadCountListener): () => void {
    this.unreadCountListeners.add(cb);
    return () => {
      this.unreadCountListeners.delete(cb);
    };
  }

  // Fire-and-forget, same pattern as markRead above.
  markDelivered(input: { conversationId: string; upToSentAt: string }): void {
    this.socket().emit("message_delivered", input);
  }

  onDeliveryReceipt(cb: DeliveryReceiptListener): () => void {
    this.deliveryReceiptListeners.add(cb);
    return () => {
      this.deliveryReceiptListeners.delete(cb);
    };
  }

  onReadReceipt(cb: ReadReceiptListener): () => void {
    this.readReceiptListeners.add(cb);
    return () => {
      this.readReceiptListeners.delete(cb);
    };
  }
}

export const realChatService = new RealChatService();
