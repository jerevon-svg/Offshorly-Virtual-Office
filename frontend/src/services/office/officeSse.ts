import type { Presence } from "./types";

// Parsing for Atlas's live office stream (GET /api/v1/office/events).
//
// Ported from Atlas's own client rather than rewritten, because the shape
// here is easy to get subtly wrong in a way that looks like it works. The
// backend broadcasts an ENVELOPE, never a bare presence row:
//
//   {"type": "connected"}
//   {"type": "presence_update", "presence": { ...PresenceOut }}
//
// Parsing the raw payload AS a presence row leaves user_email undefined, so
// every event appends a fresh junk row instead of updating the existing
// one — the floor drifts from reality and never self-corrects. Atlas
// shipped exactly that bug; this file exists so we don't reintroduce it.
//
// Pure functions only. The fetch/stream plumbing lives in presenceStream.ts
// so this half is testable without a network.

// Only the events this app acts on are modelled. Everything else Atlas
// broadcasts (office_toast, agent_update, room_state, huddle_update,
// attention_nudge) parses to null and is skipped — a forward-compatible
// "ignore what you don't recognise" default rather than a throw.
export type OfficeSseEvent =
  | { type: "connected" }
  | { type: "presence_update"; presence: Presence };

export function parseOfficeSseEvent(rawPayload: string): OfficeSseEvent | null {
  let envelope: { type?: string; presence?: Presence };
  try {
    envelope = JSON.parse(rawPayload) as typeof envelope;
  } catch {
    return null;
  }
  if (!envelope || typeof envelope !== "object") return null;

  if (envelope.type === "connected") return { type: "connected" };

  if (envelope.type === "presence_update" && envelope.presence) {
    return { type: "presence_update", presence: envelope.presence };
  }

  return null;
}

// Presence-only convenience wrapper — null for every other envelope type
// and for malformed JSON. Callers skip merging on null.
export function parsePresenceSseEvent(rawPayload: string): Presence | null {
  const event = parseOfficeSseEvent(rawPayload);
  return event?.type === "presence_update" ? event.presence : null;
}

// Update in place by email, else append. Rows with no user_email are
// dropped: they can never be matched against the existing list, so keeping
// them only accumulates unmergeable junk.
//
// Matching is case-insensitive for the same reason the floor/presence join
// is — Zoho, Cliq and Atlas do not agree on capitalization, and a raw
// comparison would append a duplicate row for the same person.
export function mergePresenceRow(
  rows: Presence[],
  row: Presence | null | undefined,
): Presence[] {
  if (!row?.user_email) return rows;
  const key = row.user_email.trim().toLowerCase();
  const index = rows.findIndex((r) => r.user_email.trim().toLowerCase() === key);
  if (index === -1) return [...rows, row];
  const next = [...rows];
  next[index] = row;
  return next;
}

// Splits a raw stream chunk buffer into complete SSE frames, returning the
// frames plus whatever partial frame is left over. A chunk boundary can
// land anywhere — mid-JSON, mid-frame — so the remainder must be carried
// into the next read rather than parsed or dropped.
export function splitSseFrames(buffer: string): {
  frames: string[];
  rest: string;
} {
  const parts = buffer.split("\n\n");
  // The final element is either an incomplete frame or "" when the buffer
  // ended exactly on a boundary; either way it is not yet a frame.
  const rest = parts.pop() ?? "";
  return { frames: parts, rest };
}

// Pulls the payload out of one SSE frame. Lines beginning with ":" are
// comments — the backend sends ": keepalive" every 30s to hold the
// connection open — and must not be parsed as data.
export function payloadFromFrame(frame: string): string | null {
  const dataLines = frame
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());

  if (dataLines.length === 0) return null;
  // Multi-line data fields concatenate with newlines, per the SSE spec.
  return dataLines.join("\n");
}
