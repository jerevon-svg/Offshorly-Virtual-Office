import { io, type Socket } from "socket.io-client";
import { getAuthToken } from "../api/client";
import type {
  ChatMessage,
  ChatService,
  ConnectionState,
  ConnectionStateListener,
  Conversation,
  MessageListener,
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

const SEND_ACK_TIMEOUT_MS = 8000;
// Render's free tier can cold-sleep after ~15min idle; observed wake time is
// ~41s. 45s gives the socket handshake a little headroom beyond that before
// we give up and tell the user the server may be waking up.
const CONNECT_TIMEOUT_MS = 45000;

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
  private connectionState: ConnectionState = "disconnected";
  private connectionStateListeners = new Set<ConnectionStateListener>();
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
      this.setConnectionState("connected");
      if (this.hadPriorDisconnect) {
        this.hadPriorDisconnect = false;
        this.catchUpActiveConversation();
      }
    });
    socket.on("disconnect", () => {
      this.hadPriorDisconnect = true;
      this.setConnectionState("reconnecting");
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
    });

    socket.on("unread_count", (payload: UnreadCountUpdate) => {
      this.unreadCountListeners.forEach((cb) => cb(payload));
    });

    socket.on("chat_error", (payload: { code: string; message: string }) => {
      // Surfaced to any in-flight sendMessage callers via rejection isn't
      // possible generically here (no clientTempId on most chat_errors) —
      // log so failures are at least visible during development/triage.
      console.error(`[chat] ${payload.code}: ${payload.message}`);
    });

    this.socketInstance = socket;
    this.setConnectionState("connecting");
    return socket;
  }

  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState === state) return;
    this.connectionState = state;
    this.connectionStateListeners.forEach((cb) => cb(state));
  }

  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  onConnectionState(cb: ConnectionStateListener): () => void {
    this.connectionStateListeners.add(cb);
    return () => {
      this.connectionStateListeners.delete(cb);
    };
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
    } catch (err) {
      console.error("[chat] reconnect catch-up fetch failed", err);
    }
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

    // Emits `send_message` and arms the ack timeout. There is no server-side
    // idempotency (no client_temp_id column, insert_message is a blind
    // insert) — this MUST be called exactly once per send, ever.
    const emitAndAwaitAck = (): Promise<ChatMessage> => {
      return new Promise<ChatMessage>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pendingSends.delete(clientTempId);
          reject(new Error("Timed out waiting for the server to confirm this message was sent."));
        }, SEND_ACK_TIMEOUT_MS);

        this.pendingSends.set(clientTempId, { resolve, reject, timer });

        socket.emit("send_message", {
          conversationId: input.conversationId,
          text: input.text,
          clientTempId,
        });
      });
    };

    if (socket.connected) {
      // Warm path — unchanged behavior: emit immediately, then wait for ack.
      return emitAndAwaitAck();
    }

    // Cold path — socket not connected (e.g. Render free-tier cold start,
    // measured ~41s wake). Do NOT emit yet: wait for `connect`, bounded by
    // CONNECT_TIMEOUT_MS. Emit fires from exactly one place below (either
    // on connect, or never — the timeout path guarantees no emit).
    return new Promise<ChatMessage>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        clearTimeout(connectTimer);
        socket.off("connect", onConnect);
      };

      const onConnect = () => {
        if (settled) return;
        settled = true;
        cleanup();
        emitAndAwaitAck().then(resolve, reject);
      };

      const connectTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(
          new Error(
            "Couldn't reach the chat server — it may be waking up after a period of inactivity. Please try again in a moment.",
          ),
        );
      }, CONNECT_TIMEOUT_MS);

      socket.on("connect", onConnect);
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
}

export const realChatService = new RealChatService();
