import { io, type Socket } from "socket.io-client";
import { getAuthToken } from "../api/client";
import type {
  ChatMessage,
  ChatService,
  ConnectionState,
  ConnectionStateListener,
  Conversation,
  ConversationUpgradedListener,
  DeliveryReceiptListener,
  DeliveryReceiptUpdate,
  MessageListener,
  ReadReceiptListener,
  ReadReceiptUpdate,
  TypingListener,
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
  private deliveryReceiptListeners = new Set<DeliveryReceiptListener>();
  private readReceiptListeners = new Set<ReadReceiptListener>();
  private typingListeners = new Set<TypingListener>();
  private conversationUpgradedListeners = new Set<ConversationUpgradedListener>();
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
  // Human-readable reason for the most recent "error" state — surfaced to
  // the UI via getConnectionError(). Cleared on a successful connect.
  private connectionErrorReason: string | undefined;
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

  // Returns null (without ever calling io()) when the handshake is doomed
  // from the start — no auth token and no dev-email bypass — rather than
  // opening a socket that will send `{ token: null }` and hang forever.
  private socket(): Socket | null {
    if (this.socketInstance) return this.socketInstance;

    if (!this.devEmail && !getAuthToken()) {
      const reason = "Not signed in — please sign in to use chat.";
      console.error(`[chat] connection error: ${reason}`);
      this.connectionErrorReason = reason;
      this.setConnectionState("error");
      return null;
    }

    const auth: Record<string, string | null> = this.devEmail
      ? { "x-dev-email": this.devEmail }
      : { token: getAuthToken() };
    const socket = io(socketBase(), {
      auth,
      autoConnect: true,
    });

    socket.on("connect", () => {
      this.connectionErrorReason = undefined;
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
    socket.on("connect_error", (err: Error) => {
      // This was previously swallowed entirely — nothing logged the failure
      // and the UI stayed pinned at "connecting" forever. Always log so
      // failures are visible, then disambiguate via socket.active: the
      // manager keeps retrying transport-level failures on its own
      // (socket.active === true), but socket.io v4 does NOT retry after a
      // namespace/auth rejection (socket.active === false) — that's terminal
      // until something calls reconnect().
      console.error("[chat] connect_error", err);
      if (socket.active) {
        this.setConnectionState("reconnecting");
      } else {
        this.connectionErrorReason = err.message || "Connection to the chat server was rejected.";
        this.setConnectionState("error");
      }
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

    socket.on(
      "peer_typing",
      (payload: { conversationId: string; senderEmail: string; isTyping: boolean }) => {
        this.typingListeners.forEach((cb) =>
          cb({
            conversationId: payload.conversationId,
            senderId: payload.senderEmail,
            isTyping: payload.isTyping,
          }),
        );
      },
    );

    socket.on(
      "conversation_upgraded",
      (payload: { oldConversationId: string; newConversationId: string; participants: string[] }) => {
        this.conversationUpgradedListeners.forEach((cb) =>
          cb({
            conversationId: payload.newConversationId,
            oldConversationId: payload.oldConversationId,
            participantIds: payload.participants,
            // Stage A never sets a title on the newly-formed group — see
            // backend/app/routers/requests.py's conversation_upgraded emit.
            title: null,
          }),
        );
      },
    );

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

  getConnectionError(): string | undefined {
    return this.connectionErrorReason;
  }

  // Socket.io does not auto-reconnect after an auth/namespace connect_error
  // (see the connect_error handler above) — a terminal "error" state needs
  // an explicit call to recover, wired to the UI's Retry button.
  reconnect(): void {
    const socket = this.socket();
    socket?.connect();
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
    this.socket()?.emit("message_delivered", { conversationId, upToSentAt: newest });
  }

  async listConversations(): Promise<Conversation[]> {
    this.socket(); // ensure connection is established for live updates
    const res = await restFetch("/conversations", {}, this.devEmail);
    return res.json();
  }

  async getMessages(conversationId: string): Promise<ChatMessage[]> {
    this.activeConversationId = conversationId;
    this.socket()?.emit("join_conversation", { conversationId });
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
    this.socket()?.emit("join_conversation", { conversationId: conv.id });
    return conv;
  }

  async createGroupConversation(
    participantEmails: string[],
    title?: string | null,
  ): Promise<Conversation> {
    this.socket(); // ensure connection is established before REST call
    const res = await restFetch(
      "/conversations/group",
      {
        method: "POST",
        body: JSON.stringify({ participantEmails, title: title ?? null }),
      },
      this.devEmail,
    );
    const conv: Conversation = await res.json();
    this.activeConversationId = conv.id;
    this.socket()?.emit("join_conversation", { conversationId: conv.id });
    return conv;
  }

  sendMessage(input: { conversationId: string; senderId: string; text: string }): Promise<ChatMessage> {
    const clientTempId = nextClientTempId();
    const socket = this.socket();

    if (!socket) {
      // No auth token / doomed handshake — socket() already logged and set
      // state to "error". Reject immediately rather than hanging on a
      // socket that was never opened.
      return Promise.reject(
        new Error(this.connectionErrorReason || "Not connected to the chat server."),
      );
    }

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
    // on connect, or never — the timeout and terminal-error paths both
    // guarantee no emit).
    return new Promise<ChatMessage>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        clearTimeout(connectTimer);
        socket.off("connect", onConnect);
        unsubscribeState();
      };

      const onConnect = () => {
        if (settled) return;
        settled = true;
        cleanup();
        emitAndAwaitAck().then(resolve, reject);
      };

      // A connect_error can land while this send is waiting on the cold
      // path. A terminal ("error") state means socket.io has given up
      // retrying (auth/namespace rejection) — settle now with the reason
      // instead of hanging until the 45s timeout, and guarantee no emit
      // ever fires for this send.
      const unsubscribeState = this.onConnectionState((state) => {
        if (settled || state !== "error") return;
        settled = true;
        cleanup();
        reject(new Error(this.connectionErrorReason || "Couldn't connect to the chat server."));
      });

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
    this.socket()?.emit("message_read", input);
  }

  onUnreadCount(cb: UnreadCountListener): () => void {
    this.unreadCountListeners.add(cb);
    return () => {
      this.unreadCountListeners.delete(cb);
    };
  }

  // Fire-and-forget, same pattern as markRead above.
  markDelivered(input: { conversationId: string; upToSentAt: string }): void {
    this.socket()?.emit("message_delivered", input);
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

  // Fire-and-forget, ephemeral — no ack, no persistence. Same pattern as
  // markRead/markDelivered above.
  sendTyping(input: { conversationId: string; isTyping: boolean }): void {
    this.socket()?.emit("typing", input);
  }

  onTyping(cb: TypingListener): () => void {
    this.typingListeners.add(cb);
    return () => {
      this.typingListeners.delete(cb);
    };
  }

  onConversationUpgraded(cb: ConversationUpgradedListener): () => void {
    this.conversationUpgradedListeners.add(cb);
    return () => {
      this.conversationUpgradedListeners.delete(cb);
    };
  }
}

export const realChatService = new RealChatService();
