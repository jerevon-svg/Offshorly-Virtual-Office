import { getAuthToken } from "../api/client";
import { setDevIdentity as setDelegationDevIdentity } from "./delegationClient";
import {
  ToucanActionUnavailableError,
  ToucanConversationGoneError,
  type ToucanActionResult,
  type ToucanAnswer,
  type ToucanAskOptions,
  type ToucanAskRequest,
  type ToucanConversation,
  type ToucanConversationDetail,
  type ToucanMemory,
  type ToucanService,
  type ToucanDelegation,
} from "./types";

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
// enters the realtime broadcast layer — a Toucan conversation has exactly one
// reader, its owner, so there is nobody to fan out to.
//
// T1 adds three persistence calls alongside ask(). NONE of them sends an owner:
// the backend derives it from the same bearer token below and filters every
// lookup on it, so these endpoints can only ever reach this viewer's own
// conversations.

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
  setDelegationDevIdentity(email);
}

const GREETING =
  "Squawk! I'm the office toucan — parked right beside you. Ask me who's online, where " +
  "someone is, or who's in a call.";

function authHeaders(): Headers {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (devEmail) {
    headers.set("x-dev-email", devEmail);
  } else {
    const token = getAuthToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

/** The viewer's IANA zone, or null when the runtime cannot say (old engines, odd sandboxes). */
export function detectClientTimezone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && zone.length <= 64 ? zone : null;
  } catch {
    return null;
  }
}

async function toucanFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${socketBase()}${path}`, { ...init, headers: authHeaders() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || body?.detail || `Toucan backend request failed (${res.status})`);
  }
  return res;
}

export class RealToucanService implements ToucanService {
  greeting(): string {
    return GREETING;
  }

  async ask(request: ToucanAskRequest, options: ToucanAskOptions = {}): Promise<ToucanAnswer> {
    const res = await fetch(`${socketBase()}/toucan/ask`, {
      method: "POST",
      headers: authHeaders(),
      // Identity is NEVER in the body — the backend derives it from the token
      // above and rejects any extra field outright (see schemas/toucan.py).
      // `conversationId` is not an identity: it only ever selects among
      // conversations this viewer already owns.
      body: JSON.stringify({
        question: request.question,
        history: request.history,
        conversationId: request.conversationId ?? null,
        // A2.3 — only so "until 3 PM" means 3 PM where the viewer is. Not identity.
        clientTimezone: request.clientTimezone ?? detectClientTimezone(),
      }),
      signal: options.signal,
    });

    if (res.status === 404 && request.conversationId) {
      // The conversation was deleted (or never belonged to this viewer). Not a
      // request failure — the panel drops the stale id and starts a fresh one.
      throw new ToucanConversationGoneError(request.conversationId);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || body?.detail || `Toucan backend request failed (${res.status})`);
    }
    return (await res.json()) as ToucanAnswer;
  }

  async loadLatestConversation(
    options: ToucanAskOptions = {},
  ): Promise<ToucanConversationDetail | null> {
    const res = await toucanFetch("/toucan/conversations/latest", { signal: options.signal });
    // 200 + null body is the documented "you have never asked anything" answer.
    return (await res.json()) as ToucanConversationDetail | null;
  }

  async createConversation(options: ToucanAskOptions = {}): Promise<ToucanConversation> {
    const res = await toucanFetch("/toucan/conversations", {
      method: "POST",
      signal: options.signal,
    });
    return (await res.json()) as ToucanConversation;
  }

  async listConversations(options: ToucanAskOptions = {}): Promise<ToucanConversation[]> {
    // The server's own default page size applies; no `limit` is sent, and the
    // History popover shows what comes back. There is no pagination UI because
    // there is nothing yet to page through — see the panel's History note.
    const res = await toucanFetch("/toucan/conversations", { signal: options.signal });
    return (await res.json()) as ToucanConversation[];
  }

  async loadConversation(
    conversationId: string,
    options: ToucanAskOptions = {},
  ): Promise<ToucanConversationDetail> {
    const res = await fetch(`${socketBase()}/toucan/conversations/${conversationId}`, {
      headers: authHeaders(),
      signal: options.signal,
    });
    if (res.status === 404) {
      // Gone, or never this viewer's — the backend cannot tell the two apart on
      // purpose. Either way the panel drops it rather than showing an error.
      throw new ToucanConversationGoneError(conversationId);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || body?.detail || `Toucan backend request failed (${res.status})`);
    }
    return (await res.json()) as ToucanConversationDetail;
  }

  // T8 — the structural confirmation endpoints. Note what is NOT sent: no body at
  // all. The action's args were validated and FROZEN server-side at proposal time;
  // the id is the entire request, so there is no channel through which a client
  // could mutate what executes. Identity rides in the same auth header as
  // everything else — a pending action belonging to someone else is a 404.

  private async resolveAction(
    actionId: string,
    verb: "confirm" | "cancel",
    options: ToucanAskOptions,
  ): Promise<ToucanActionResult> {
    const res = await fetch(`${socketBase()}/toucan/actions/${actionId}/${verb}`, {
      method: "POST",
      headers: authHeaders(),
      signal: options.signal,
    });
    if (res.status === 404) {
      // Expired, already handled, or never this viewer's — deliberately
      // indistinguishable server-side.
      throw new ToucanActionUnavailableError(actionId);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || body?.detail || `Toucan backend request failed (${res.status})`);
    }
    return (await res.json()) as ToucanActionResult;
  }

  async confirmAction(actionId: string, options: ToucanAskOptions = {}): Promise<ToucanActionResult> {
    return this.resolveAction(actionId, "confirm", options);
  }

  async cancelAction(actionId: string, options: ToucanAskOptions = {}): Promise<ToucanActionResult> {
    return this.resolveAction(actionId, "cancel", options);
  }

  // A2.2 — the viewer's own delegation. GET answers null when none is active (the server also
  // lazily ends an expired row on this read). DELETE is Stop: the row becomes ended/cancelled
  // and stays for audit; a 404 means nothing was active any more, which the panel treats the
  // same as a successful stop. Both are owner-scoped by the auth header alone.

  async getDelegation(options: ToucanAskOptions = {}): Promise<ToucanDelegation | null> {
    const res = await toucanFetch("/toucan/delegation", { signal: options.signal });
    return ((await res.json()) as ToucanDelegation | null) ?? null;
  }

  async cancelDelegation(options: ToucanAskOptions = {}): Promise<ToucanDelegation | null> {
    const res = await fetch(`${socketBase()}/toucan/delegation`, {
      method: "DELETE",
      headers: authHeaders(),
      signal: options.signal,
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || body?.detail || `Toucan backend request failed (${res.status})`);
    }
    return (await res.json()) as ToucanDelegation;
  }

  // T9 — the two management calls the polish pass exposes. Both hit endpoints
  // that already existed (T1's DELETE /toucan/conversations/{id}, T4's
  // GET/DELETE /toucan/memories), so T9 adds no route, no schema and no
  // migration. Neither can execute anything: one deletes a transcript, one
  // deletes a memory row, and the pending-action table is not reachable from
  // either.

  async deleteConversation(conversationId: string, options: ToucanAskOptions = {}): Promise<void> {
    const res = await fetch(`${socketBase()}/toucan/conversations/${conversationId}`, {
      method: "DELETE",
      headers: authHeaders(),
      signal: options.signal,
    });
    // Already gone, or never this viewer's — either way the caller's intent is
    // satisfied, so this is a success rather than an error to word.
    if (res.status === 404) return;
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || body?.detail || `Toucan backend request failed (${res.status})`);
    }
  }

  async listMemories(options: ToucanAskOptions = {}): Promise<ToucanMemory[]> {
    // No `limit` is sent: the server's own default and maximum are the bound,
    // exactly as with listConversations.
    const res = await toucanFetch("/toucan/memories", { signal: options.signal });
    return (await res.json()) as ToucanMemory[];
  }

  async deleteMemory(memoryId: string, options: ToucanAskOptions = {}): Promise<void> {
    const res = await fetch(`${socketBase()}/toucan/memories/${memoryId}`, {
      method: "DELETE",
      headers: authHeaders(),
      signal: options.signal,
    });
    if (res.status === 404) return;
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || body?.detail || `Toucan backend request failed (${res.status})`);
    }
  }
}

export const realToucanService = new RealToucanService();
