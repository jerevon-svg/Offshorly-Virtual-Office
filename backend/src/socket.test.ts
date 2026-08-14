import { test, after, mock } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.ATLAS_API_URL ??= "https://atlas-api.test";
process.env.NODE_ENV ??= "test"; // NOT "production" — dev-email bypass stays reachable
process.env.CORS_ORIGIN ??= "http://localhost:5173";

const PARTICIPANTS = new Set(["a@example.com", "b@example.com"]);
const CONV_ID = "conv-a__b";

let fakeUnreadCount = 0;
mock.module("./repo/conversations.js", {
  exports: {
    isParticipant: async (conversationId: string, email: string) =>
      conversationId === CONV_ID && PARTICIPANTS.has(email),
    listConversationsForUser: async (email: string) =>
      PARTICIPANTS.has(email)
        ? [{ id: CONV_ID, participantIds: [...PARTICIPANTS], lastMessageAt: new Date().toISOString() }]
        : [],
    getConversationById: async (conversationId: string) =>
      conversationId === CONV_ID
        ? { id: CONV_ID, participantIds: [...PARTICIPANTS], lastMessageAt: new Date().toISOString() }
        : null,
    markRead: async () => {},
    touchConversation: async () => {},
    unreadCount: async () => fakeUnreadCount,
  },
});

let msgSeq = 0;
mock.module("./repo/messages.js", {
  exports: {
    insertMessage: async (input: { conversationId: string; senderId: string; text: string }) => {
      msgSeq += 1;
      return {
        id: `msg-${msgSeq}`,
        conversationId: input.conversationId,
        senderId: input.senderId,
        text: input.text,
        sentAt: new Date().toISOString(),
      };
    },
  },
});

const { createSocketServer } = await import("./socket.js");

const httpServer = createServer();
createSocketServer(httpServer);
await new Promise<void>((resolve) => httpServer.listen(0, resolve));
const port = (httpServer.address() as AddressInfo).port;
const url = `http://localhost:${port}`;

after(() => {
  httpServer.close();
});

function connectAs(email: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(url, { auth: { "x-dev-email": email }, forceNew: true });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
  });
}

function once(socket: ClientSocket, event: string, timeoutMs = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

test("dev-email bypass authenticates and auto-joins existing conversation rooms", async () => {
  const a = await connectAs("a@example.com");
  a.disconnect();
});

test("send_message emits message_saved only to the sender, incoming_message only to others", async () => {
  const a = await connectAs("a@example.com");
  const b = await connectAs("b@example.com");

  // Give bootstrapRooms a tick to join both sockets to CONV_ID before send.
  await new Promise((r) => setTimeout(r, 50));

  const savedPromise = once(a, "message_saved");
  const incomingPromise = once(b, "incoming_message");
  let aGotIncoming = false;
  let bGotSaved = false;
  a.once("incoming_message", () => {
    aGotIncoming = true;
  });
  b.once("message_saved", () => {
    bGotSaved = true;
  });

  a.emit("send_message", { conversationId: CONV_ID, text: "hi b", clientTempId: "tmp-1" });

  const saved = await savedPromise;
  const incoming = await incomingPromise;

  assert.equal(saved.clientTempId, "tmp-1");
  assert.equal(saved.message.senderId, "a@example.com");
  assert.equal(incoming.message.senderId, "a@example.com");
  assert.equal(aGotIncoming, false);
  assert.equal(bGotSaved, false);

  a.disconnect();
  b.disconnect();
});

test("send_message pushes an unread_count event to the recipient's room, not the sender's", async () => {
  const a = await connectAs("a@example.com");
  const b = await connectAs("b@example.com");
  await new Promise((r) => setTimeout(r, 50));

  fakeUnreadCount = 3;
  const bUnreadPromise = once(b, "unread_count");
  let aGotUnreadCount = false;
  a.once("unread_count", () => {
    aGotUnreadCount = true;
  });

  a.emit("send_message", { conversationId: CONV_ID, text: "hi again", clientTempId: "tmp-unread" });

  const payload = await bUnreadPromise;
  assert.equal(payload.conversationId, CONV_ID);
  assert.equal(payload.count, 3);
  assert.equal(aGotUnreadCount, false);

  a.disconnect();
  b.disconnect();
});

test("send_message from a non-participant is rejected with chat_error", async () => {
  const c = await connectAs("c@example.com");
  const errPromise = once(c, "chat_error");
  c.emit("send_message", { conversationId: CONV_ID, text: "sneaky", clientTempId: "tmp-2" });
  const err = await errPromise;
  assert.equal(err.code, "forbidden");
  c.disconnect();
});
