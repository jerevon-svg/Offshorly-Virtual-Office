import { getAuthToken } from "../api/client";
import type { ToucanAnswer, ToucanAskOptions, ToucanAskRequest, ToucanService } from "./types";

// Live Toucan — talks to the Virtual Office backend's POST /toucan/ask
// (backend/app/routers/toucan.py).
//
// Deliberately NOT the Atlas API base (services/api/client.ts): like chat,
// requests, hub and feed, this is the separate VO backend reached via
// VITE_CHAT_SOCKET_URL. It reuses the same Atlas bearer token rather than
// duplicating the localStorage lookup — same pattern as
// services/chat/requestsClient.ts, whose restFetch this mirrors.
//
// REST, not Socket.IO: one caller, request/response, no fan-out. Nothing here
// enters the realtime broadcast layer.

function socketBase(): string {
  const raw = import.meta.env.VITE_CHAT_SOCKET_URL;
  if (!raw) {
    throw new Error(
      "VITE_CHAT_SOCKET_URL is not set. Required when VITE_TOUCAN_MODE=real — see .env.example.",
    );
  }
  return raw.replace(/\/+$/, "");
}

// DEV-ONLY: mirrors requestsClient.ts's devEmail/setDevIdentity exactly — when
// set, requests authenticate via the backend's hard-gated `x-dev-email` bypass
// (backend/app/auth/deps.py) instead of a real Atlas bearer token, so local
// multi-browser testing with ?as= works. Seeded from useAuthGate.ts.
let devEmail: string | null = null;

export function setDevIdentity(email: string | null): void {
  devEmail = email ? email.trim().toLowerCase() : null;
}

const GREETING =
  "Squawk! I'm the office toucan — parked right beside you. Ask me who's online, where " +
  "someone is, or who's in a call.";

export class RealToucanService implements ToucanService {
  greeting(): string {
    return GREETING;
  }

  async ask(request: ToucanAskRequest, options: ToucanAskOptions = {}): Promise<ToucanAnswer> {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (devEmail) {
      headers.set("x-dev-email", devEmail);
    } else {
      const token = getAuthToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
    }

    const res = await fetch(`${socketBase()}/toucan/ask`, {
      method: "POST",
      headers,
      // Identity is NEVER in the body — the backend derives it from the token
      // above and rejects any extra field outright (see schemas/toucan.py).
      body: JSON.stringify({ question: request.question, history: request.history }),
      signal: options.signal,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || `Toucan backend request failed (${res.status})`);
    }
    return (await res.json()) as ToucanAnswer;
  }
}

export const realToucanService = new RealToucanService();
