import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { config } from "./config.js";
import { verifyAtlasToken, AtlasAuthError } from "./auth/verifyAtlasToken.js";
import {
  isParticipant,
  listConversationsForUser,
  markRead,
  unreadCount,
  upsertConversation,
} from "./repo/conversations.js";
import { listMessages } from "./repo/messages.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userEmail?: string;
    }
  }
}

// Dev-only identity bypass — trusts an x-dev-email header/query param
// instead of calling Atlas, so local two-browser testing works without real
// Atlas tokens. Hard-gated: this branch is structurally unreachable when
// NODE_ENV === "production", not just unlikely to be hit.
function devEmailFrom(req: Request): string | null {
  if (config.isProduction) return null;
  const header = req.header("x-dev-email");
  const queryParam = req.query["x-dev-email"];
  const raw = header ?? (typeof queryParam === "string" ? queryParam : null);
  return raw ? raw.trim().toLowerCase() : null;
}

async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const devEmail = devEmailFrom(req);
  if (devEmail) {
    req.userEmail = devEmail;
    next();
    return;
  }

  const authHeader = req.header("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!match) {
    res.status(401).json({ error: "Missing Authorization bearer token" });
    return;
  }

  try {
    req.userEmail = await verifyAtlasToken(match[1]);
    next();
  } catch (err) {
    if (err instanceof AtlasAuthError) {
      res.status(401).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export function createHttpApp() {
  const app = express();
  app.use(
    cors({
      origin: config.corsOrigins.length > 0 ? config.corsOrigins : true,
      credentials: true,
    }),
  );
  app.use(express.json());

  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  app.use(authMiddleware);

  app.post("/conversations", async (req, res, next) => {
    try {
      const peerEmail = typeof req.body?.peerEmail === "string" ? req.body.peerEmail.trim() : "";
      if (!peerEmail) {
        res.status(400).json({ error: "peerEmail is required" });
        return;
      }
      const conv = await upsertConversation(req.userEmail!, peerEmail);
      res.json(conv);
    } catch (err) {
      next(err);
    }
  });

  app.get("/conversations", async (req, res, next) => {
    try {
      const convs = await listConversationsForUser(req.userEmail!);
      res.json(convs);
    } catch (err) {
      next(err);
    }
  });

  app.get("/conversations/:id/messages", async (req, res, next) => {
    try {
      const { id } = req.params;
      const self = req.userEmail!;
      const participant = await isParticipant(id, self);
      if (!participant) {
        res.status(403).json({ error: "Not a participant in this conversation" });
        return;
      }
      const since = typeof req.query.since === "string" ? req.query.since : undefined;
      const before = typeof req.query.before === "string" ? req.query.before : undefined;
      const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
      const messages = await listMessages(id, { since, before, limit });
      res.json(
        messages.map((m) => ({
          id: m.id,
          conversationId: m.conversationId,
          senderId: m.senderId,
          text: m.text,
          sentAt: m.sentAt,
        })),
      );
    } catch (err) {
      next(err);
    }
  });

  app.post("/conversations/:id/read", async (req, res, next) => {
    try {
      const { id } = req.params;
      const self = req.userEmail!;
      const participant = await isParticipant(id, self);
      if (!participant) {
        res.status(403).json({ error: "Not a participant in this conversation" });
        return;
      }
      const upToSentAt =
        typeof req.body?.upToSentAt === "string" ? req.body.upToSentAt : new Date().toISOString();
      await markRead(id, self, upToSentAt);
      const count = await unreadCount(id, self);
      res.json({ unreadCount: count });
    } catch (err) {
      next(err);
    }
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
