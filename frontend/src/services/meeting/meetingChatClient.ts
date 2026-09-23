import { useEffect, useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";
import { getAuthToken } from "../api/client";

// PHASE 7D — WHAT IS SAID INSIDE A MEETING.
//
// EPHEMERAL AND MEETING-SCOPED, and that is the architectural decision rather than a shortcut. The DM
// system (services/chat) is durable, addressed to a conversation, and feeds unread badges, the inbox,
// Toucan's counts and quest progress — every one of which is wrong for a meeting aside. A dozen "can
// you see my screen?" lines must not become an inbox anybody has to clear. So this writes nothing and
// keeps nothing: the server relays, holds a small catch-up buffer, and forgets it when the meeting
// ends (backend services/meeting_chat.py).
//
// ITS OWN SOCKET, matching the documented rationale every other presence client here carries
// (dndClient, spatialSessionStore, offlineLineupClient): RealChatService keeps its socket entirely
// private, and this feature's needs do not justify refactoring that. It is also the right ownership
// boundary — this connection's disconnect ends THIS client's chat subscription and nothing else.
//
// MEMBERSHIP IS THE SERVER'S. Nothing here decides who may speak or listen: the backend gates every
// event on the call registry's own participant list, which is the same authority the host, the
// head-count and the presence broadcast use. A client cannot talk its way into a meeting.

function socketBase(): string {
  const raw = import.meta.env.VITE_CHAT_SOCKET_URL;
  if (!raw) {
    throw new Error("VITE_CHAT_SOCKET_URL is not set. Required for meeting chat — see .env.example.");
  }
  return raw.replace(/\/+$/, "");
}

/** One thing somebody said in the meeting. `id` is the server's, and is what makes a late joiner's
 *  history merge with what has already arrived instead of duplicating it. */
export interface MeetingChatMessage {
  id: string;
  email: string;
  text: string;
  atMs: number;
}

/** A reaction or sticker in flight: a moment, never a record. `key` is local and exists only so React
 *  can tell two identical tokens from the same person apart while both are on screen. */
export interface MeetingReaction {
  key: string;
  email: string;
  token: string;
  atMs: number;
}

export interface MeetingChatSnapshot {
  /** The meeting these belong to, or null when this client is not in one. */
  meetingId: string | null;
  messages: MeetingChatMessage[];
  reactions: MeetingReaction[];
}

/** HOW MANY REACTIONS MAY BE ON SCREEN AT ONCE, per person and in total. This is the anti-spam rule
 *  and it is deliberately a CAP rather than a queue: a burst of twelve should read as enthusiasm, not
 *  as a wall that hides the presentation behind it. The oldest simply stops being drawn. */
const MAX_REACTIONS = 8;
const MAX_REACTIONS_PER_PERSON = 3;
/** How long one reaction stays up. Long enough to read, short enough not to accumulate. */
export const REACTION_TTL_MS = 2600;

const EMPTY: MeetingChatSnapshot = { meetingId: null, messages: [], reactions: [] };

let socketInstance: Socket | null = null;
let devEmail: string | null = null;
let snapshot: MeetingChatSnapshot = EMPTY;
let joinedMeetingId: string | null = null;
const listeners = new Set<() => void>();
let reactionSeq = 0;

function notify(): void {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): MeetingChatSnapshot {
  return snapshot;
}

/** DEV-ONLY: mirrors dndClient.ts's setDevIdentity, INCLUDING the correction Phase 7D made to the
 *  call store's — re-seeding the same address must not drop the socket, because the server cleans up
 *  by socket id and a needless disconnect reads to it as somebody leaving. */
export function setDevIdentity(email: string | null): void {
  const next = email ? email.trim().toLowerCase() : null;
  if (next === devEmail) return;
  devEmail = next;
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}

function ensureSocket(): Socket | null {
  if (socketInstance) return socketInstance;
  if (!devEmail && !getAuthToken()) return null;

  const auth: Record<string, string | null> = devEmail
    ? { "x-dev-email": devEmail }
    : { token: getAuthToken() };
  const socket = io(socketBase(), { auth, autoConnect: true });

  socket.on("meeting_chat", (msg: (MeetingChatMessage & { meetingId?: string }) | undefined) => {
    if (!msg?.id || msg.meetingId !== joinedMeetingId) return;
    // DEDUPED BY THE SERVER'S ID. The sender receives its own message from the server like everybody
    // else rather than drawing it locally, so there is one source of truth and no echo to reconcile —
    // but history and the live feed can still overlap, and this is where that is handled.
    if (snapshot.messages.some((m) => m.id === msg.id)) return;
    snapshot = { ...snapshot, messages: [...snapshot.messages, toMessage(msg)] };
    notify();
  });

  socket.on(
    "meeting_chat_history",
    (payload: { meetingId?: string; messages?: MeetingChatMessage[] } | undefined) => {
      if (payload?.meetingId !== joinedMeetingId) return;
      const seen = new Set(snapshot.messages.map((m) => m.id));
      const merged = [
        ...(payload.messages ?? []).filter((m) => m?.id && !seen.has(m.id)).map(toMessage),
        ...snapshot.messages,
      ].sort((a, b) => a.atMs - b.atMs);
      snapshot = { ...snapshot, messages: merged };
      notify();
    },
  );

  socket.on(
    "meeting_reaction",
    (payload: { meetingId?: string; email?: string; token?: string } | undefined) => {
      if (!payload?.token || !payload.email || payload.meetingId !== joinedMeetingId) return;
      const email = payload.email.toLowerCase();
      const now = Date.now();
      // TRIMMED ON THE WAY IN, per person first and then overall — so one enthusiastic participant
      // cannot push everybody else's reaction off the screen.
      const mine = snapshot.reactions.filter((r) => r.email === email);
      const others = snapshot.reactions.filter((r) => r.email !== email);
      const keptMine = mine.slice(Math.max(0, mine.length - (MAX_REACTIONS_PER_PERSON - 1)));
      const next = [
        ...others,
        ...keptMine,
        { key: `r${++reactionSeq}`, email, token: payload.token, atMs: now },
      ].sort((a, b) => a.atMs - b.atMs);
      snapshot = { ...snapshot, reactions: next.slice(Math.max(0, next.length - MAX_REACTIONS)) };
      notify();
    },
  );

  socketInstance = socket;
  return socket;
}

function toMessage(m: MeetingChatMessage): MeetingChatMessage {
  return { id: m.id, email: m.email.toLowerCase(), text: m.text, atMs: m.atMs };
}

/** JOIN THE CONVERSATION OF THE MEETING THIS CLIENT IS IN.
 *
 *  Idempotent for the SAME meeting — leaving the Cave and walking back into the same live meeting must
 *  not open a second subscription or ask for the history twice, which is exactly the duplicate this
 *  guard exists to prevent. Switching to a different meeting clears the old one's messages first,
 *  because they belong to that meeting and not to this client. */
export function joinMeetingChat(meetingId: string): void {
  if (joinedMeetingId === meetingId) {
    ensureSocket();
    return;
  }
  joinedMeetingId = meetingId;
  snapshot = { meetingId, messages: [], reactions: [] };
  notify();
  ensureSocket()?.emit("meeting_chat_history", { meetingId });
}

/** The meeting ended, or this client left it. Everything it held goes with it. */
export function leaveMeetingChat(): void {
  if (joinedMeetingId === null && snapshot === EMPTY) return;
  joinedMeetingId = null;
  snapshot = EMPTY;
  notify();
}

export function sendMeetingChat(text: string): void {
  const clean = text.trim();
  if (!clean || !joinedMeetingId) return;
  ensureSocket()?.emit("meeting_chat_send", { text: clean });
}

export function sendMeetingReaction(token: string): void {
  if (!token || !joinedMeetingId) return;
  ensureSocket()?.emit("meeting_reaction", { token });
}

/** Drop reactions whose moment has passed. Called by whatever is already animating — no timer of its
 *  own, so an idle meeting costs nothing. Returns true when something actually expired. */
export function expireReactions(now = Date.now()): boolean {
  if (snapshot.reactions.length === 0) return false;
  const live = snapshot.reactions.filter((r) => now - r.atMs < REACTION_TTL_MS);
  if (live.length === snapshot.reactions.length) return false;
  snapshot = { ...snapshot, reactions: live };
  notify();
  return true;
}

export function useMeetingChat(): MeetingChatSnapshot {
  useEffect(() => {
    ensureSocket();
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function getMeetingChatSnapshot(): MeetingChatSnapshot {
  return snapshot;
}

/** Test-only: module state outlives a single test. */
export function resetMeetingChatForTests(): void {
  socketInstance?.disconnect();
  socketInstance = null;
  joinedMeetingId = null;
  snapshot = EMPTY;
  reactionSeq = 0;
  listeners.clear();
}
