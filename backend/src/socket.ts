import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { config } from "./config.js";
import { verifyAtlasToken, AtlasAuthError } from "./auth/verifyAtlasToken.js";
import {
  getConversationById,
  isParticipant,
  listConversationsForUser,
  markRead,
  touchConversation,
  unreadCount,
} from "./repo/conversations.js";
import { insertMessage } from "./repo/messages.js";

// Deliberately untyped Socket.IO event maps: this is a small, hand-written
// server (no client-generated types to share), and the payload shapes are
// documented once here rather than duplicated across three generic type
// params. Handlers below validate/narrow every payload field they read.

function userRoom(email: string): string {
  return `user:${email}`;
}

// Dev-only identity bypass for sockets — mirrors http.ts's devEmailFrom.
// Hard-gated off in production: this function always returns null once
// NODE_ENV === "production", regardless of what the client sends.
function devEmailFromHandshake(auth: Record<string, unknown>): string | null {
  if (config.isProduction) return null;
  const raw = auth["x-dev-email"] ?? auth.devEmail;
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim().toLowerCase() : null;
}

function emitUnexpected(socket: Socket, err: unknown): void {
  console.error(err);
  socket.emit("chat_error", { code: "internal_error", message: "Unexpected server error" });
}

async function bootstrapRooms(socket: Socket): Promise<void> {
  try {
    const email = socket.data.userEmail as string;
    socket.join(userRoom(email));
    const conversations = await listConversationsForUser(email);
    for (const conv of conversations) {
      socket.join(conv.id);
    }
  } catch (err) {
    emitUnexpected(socket, err);
  }
}

export function createSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: config.corsOrigins.length > 0 ? config.corsOrigins : true,
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    const auth = (socket.handshake.auth ?? {}) as Record<string, unknown>;
    const devEmail = devEmailFromHandshake(auth);
    if (devEmail) {
      socket.data.userEmail = devEmail;
      next();
      return;
    }

    const token = typeof auth.token === "string" ? auth.token : "";
    if (!token) {
      next(new Error("Missing auth token"));
      return;
    }

    try {
      socket.data.userEmail = await verifyAtlasToken(token);
      next();
    } catch (err) {
      if (err instanceof AtlasAuthError) {
        next(new Error(err.message));
        return;
      }
      next(err instanceof Error ? err : new Error("Auth failed"));
    }
  });

  io.on("connection", (socket) => {
    void bootstrapRooms(socket);

    socket.on("join_conversation", async (payload: { conversationId?: unknown }) => {
      try {
        const conversationId = typeof payload?.conversationId === "string" ? payload.conversationId : "";
        if (!conversationId) return;
        const ok = await isParticipant(conversationId, socket.data.userEmail);
        if (!ok) {
          socket.emit("chat_error", { code: "forbidden", message: "Not a participant" });
          return;
        }
        socket.join(conversationId);
      } catch (err) {
        emitUnexpected(socket, err);
      }
    });

    socket.on(
      "send_message",
      async (payload: { conversationId?: unknown; text?: unknown; clientTempId?: unknown }) => {
        try {
          const conversationId = typeof payload?.conversationId === "string" ? payload.conversationId : "";
          const clientTempId = typeof payload?.clientTempId === "string" ? payload.clientTempId : "";
          const text = typeof payload?.text === "string" ? payload.text.trim() : "";

          if (!conversationId) {
            socket.emit("chat_error", { code: "invalid_message", message: "conversationId is required" });
            return;
          }

          const ok = await isParticipant(conversationId, socket.data.userEmail);
          if (!ok) {
            socket.emit("chat_error", { code: "forbidden", message: "Not a participant" });
            return;
          }
          if (!text) {
            socket.emit("chat_error", { code: "invalid_message", message: "Message text is empty" });
            return;
          }

          // Sender is ALWAYS socket.data.userEmail (server-verified identity)
          // — a client-sent sender id is never trusted, even implicitly.
          const message = await insertMessage({
            conversationId,
            senderId: socket.data.userEmail,
            text,
          });
          await touchConversation(conversationId, message.sentAt);

          socket.emit("message_saved", { clientTempId, message });
          socket.to(conversationId).emit("incoming_message", { message });

          // Push each recipient's (not the sender's) fresh unread count to
          // their own per-user room, so an idle badge updates live without
          // polling — same room/mechanism message_read's push below already
          // uses, just triggered from the receive side instead of the
          // read side.
          const conv = await getConversationById(conversationId);
          const recipients = (conv?.participantIds ?? []).filter(
            (id) => id !== socket.data.userEmail,
          );
          for (const recipient of recipients) {
            const count = await unreadCount(conversationId, recipient);
            io.to(userRoom(recipient)).emit("unread_count", { conversationId, count });
          }
        } catch (err) {
          emitUnexpected(socket, err);
        }
      },
    );

    socket.on("message_read", async (payload: { conversationId?: unknown; upToSentAt?: unknown }) => {
      try {
        const conversationId = typeof payload?.conversationId === "string" ? payload.conversationId : "";
        const upToSentAt =
          typeof payload?.upToSentAt === "string" ? payload.upToSentAt : new Date().toISOString();
        if (!conversationId) return;

        const ok = await isParticipant(conversationId, socket.data.userEmail);
        if (!ok) {
          socket.emit("chat_error", { code: "forbidden", message: "Not a participant" });
          return;
        }
        await markRead(conversationId, socket.data.userEmail, upToSentAt);
        const count = await unreadCount(conversationId, socket.data.userEmail);
        // "This user's other sockets" — broadcast to every socket for this
        // email except the one that just marked it read, via a per-user room
        // joined at connect time (see bootstrapRooms).
        socket.to(userRoom(socket.data.userEmail)).emit("unread_count", { conversationId, count });
      } catch (err) {
        emitUnexpected(socket, err);
      }
    });
  });

  return io;
}
