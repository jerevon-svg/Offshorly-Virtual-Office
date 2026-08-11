import { apiUrl, getAuthToken } from "../api/client";
import { parsePresenceSseEvent, payloadFromFrame, splitSseFrames } from "./officeSse";
import type { Presence } from "./types";

// Live presence stream over SSE.
//
// Three constraints, each of which fails QUIETLY if broken:
//
// 1. fetch + ReadableStream, NOT EventSource. EventSource cannot set an
//    Authorization header, and this endpoint requires a bearer token.
// 2. Absolute URL to the API host via apiUrl(). A relative path resolves
//    against Atlas's origin under the reverse proxy — and a long-lived
//    stream routed through Next's rewrite buffers, so events arrive in
//    clumps or not at all. That looks like "the stream works, slowly".
// 3. The backend sends ": keepalive" every 30s. Those are SSE comments,
//    not data, and are skipped by payloadFromFrame.

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

export interface PresenceStreamHandlers {
  onPresence: (row: Presence) => void;
  /** Fired on open and on every reconnect, so callers can resync the
   *  roster — events missed while disconnected are gone for good. */
  onConnected?: () => void;
  onError?: (error: Error) => void;
}

export interface PresenceStreamHandle {
  close: () => void;
}

// Returns a handle rather than a promise: the stream is long-lived, and
// callers (a React effect) need to tear it down on unmount.
export function openPresenceStream(
  handlers: PresenceStreamHandlers,
): PresenceStreamHandle {
  const controller = new AbortController();
  let closed = false;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  async function connect(): Promise<void> {
    const token = getAuthToken();
    if (!token) {
      // No token: apiFetch's redirect-to-login path owns this case. Don't
      // reconnect-loop against an endpoint that will only ever 401.
      handlers.onError?.(new Error("No auth token; presence stream not started."));
      return;
    }

    const response = await fetch(apiUrl("/api/v1/office/events"), {
      headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`Presence stream failed with HTTP ${response.status}`);
    }

    // Connected: reset backoff so a long healthy session doesn't inherit
    // the delay from an outage hours earlier.
    attempt = 0;
    handlers.onConnected?.();

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += value;
      const { frames, rest } = splitSseFrames(buffer);
      buffer = rest;

      for (const frame of frames) {
        const payload = payloadFromFrame(frame);
        if (payload === null) continue;
        const row = parsePresenceSseEvent(payload);
        if (row) handlers.onPresence(row);
      }
    }

    // A clean end-of-stream is still a disconnect — the server closed or
    // a proxy timed us out. Reconnect rather than silently going stale.
    throw new Error("Presence stream ended");
  }

  function scheduleReconnect(): void {
    if (closed) return;
    // Exponential backoff, capped. No jitter: this is one stream per tab,
    // not a fleet stampeding a cold backend.
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
    attempt += 1;
    retryTimer = setTimeout(() => {
      void run();
    }, delay);
  }

  async function run(): Promise<void> {
    if (closed) return;
    try {
      await connect();
    } catch (err) {
      if (closed || controller.signal.aborted) return;
      handlers.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
    scheduleReconnect();
  }

  void run();

  return {
    close: () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      controller.abort();
    },
  };
}
