import { useEffect, useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";
import { getAuthToken } from "../api/client";
import type { PartyDestination, PartyNet, PartyWire } from "../../dev/vo3d/app/goTogether";

// GO TOGETHER V1 — THE ONE client-side copy of this person's travel party, in the module-store idiom of
// scheduledMeetingsStore.ts. Everything here is the server's (backend services/travel_party.py):
//
//   party          the party this person is in (leader or member), or null
//   controllerSid  which of this person's sockets drives their body while travelling. THIS store's socket
//                  is the one it compares against, so exactly one tab runs the follow loop; any other tab
//                  of the same person only shows the state (and a reloaded driver re-claims it)
//   invites        invitations waiting for this person's answer
//
// OWN CONNECTION, like scheduledMeetingsStore: the party's events are the only thing it hears and says.
// No movement ever passes through it — see app/goTogether.ts.

export interface PartyInvite {
  inviteId: string;
  fromEmail: string;
  toEmail: string;
  partyId: string;
  party: PartyWire;
}

export interface PartyInviteResult {
  email: string;
  ok: boolean;
  reason?: string;
}

/** ONE LINE OF TRAVEL CHAT (Phase 5). Relayed by the server to the party's current travellers and kept here
 *  only in a small rolling window — never history, never persisted, gone when the journey is. */
export interface TravelChatLine {
  id: string;
  email: string;
  text: string;
  atMs: number;
}

/** How many lines the rolling window holds — a glance at the conversation, not a transcript. */
export const TRAVEL_CHAT_WINDOW = 6;

export interface TravelPartySnapshot {
  party: PartyWire | null;
  controllerSid: string | null;
  socketId: string | null;
  invites: PartyInvite[];
  /** The last invitation round's per-person answer (refusals such as offline / dnd / in_party). */
  lastResults: PartyInviteResult[] | null;
  /** Why the last party ended, for a brief notice; cleared when a new one starts. */
  endedReason: string | null;
  /** THE JOURNEY'S END, remembered: the destination contexts (e.g. a scheduled meeting's id) a party of
   *  this person's has ARRIVED at this session. The one seam the meeting side reads — the reminder does not
   *  offer a second journey to a meeting this person was just walked to, and a later meeting director can
   *  pick up from here. */
  arrivedFor: string[];
  /** TRAVEL CHAT: the last few lines said on THIS party's journey since this tab started hearing it. Cleared
   *  whenever the party ends or changes, and by the overlay whenever this person stops being a traveller. */
  chat: TravelChatLine[];
}

const EMPTY: TravelPartySnapshot = { party: null, controllerSid: null, socketId: null, invites: [], lastResults: null, endedReason: null, arrivedFor: [], chat: [] };

let snapshot: TravelPartySnapshot = EMPTY;
let socketInstance: Socket | null = null;
let devEmail: string | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<TravelPartySnapshot>): void {
  snapshot = { ...snapshot, ...next };
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getTravelPartySnapshot(): TravelPartySnapshot {
  return snapshot;
}

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload();
  });
}

/** Seeds this store's socket identity for the dev bypass (useAuthGate). */
export function setDevIdentity(email: string | null): void {
  devEmail = email;
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}

function socketBase(): string {
  const raw = import.meta.env.VITE_CHAT_SOCKET_URL;
  if (!raw) throw new Error("VITE_CHAT_SOCKET_URL is not set. Required for Go Together — see .env.example.");
  return raw.replace(/\/+$/, "");
}

interface PartyPayload {
  party: PartyWire | null;
  controllerSid?: string | null;
}

function applyParty(p: PartyPayload | undefined): void {
  const party = p?.party ?? null;
  // A different party (or none) takes the old journey's conversation with it.
  const chat = party && party.partyId === snapshot.party?.partyId ? snapshot.chat : [];
  set({ party, chat, controllerSid: party ? p?.controllerSid ?? null : null, ...(party ? { endedReason: null } : {}) });
  // A RELOADED DRIVER takes its body back. Only granted by the server while nobody else drives it.
  if (party && (p?.controllerSid ?? null) === null) socketInstance?.emit("party_claim", {});
}

function ensureSocket(): void {
  if (socketInstance) return;
  if (!devEmail && !getAuthToken()) return;
  const socket = io(socketBase(), { auth: devEmail ? { "x-dev-email": devEmail } : { token: getAuthToken() }, autoConnect: true });
  socket.on("connect", () => set({ socketId: socket.id ?? null }));
  socket.on("disconnect", () => set({ socketId: null }));
  socket.on("travel_party", applyParty);
  socket.on("party_updated", applyParty);
  socket.on("party_ended", (p: { partyId: string; reason: string }) => {
    if (snapshot.party?.partyId !== p.partyId) return;
    const ctx = snapshot.party.destination.context;
    const arrivedFor = p.reason === "arrived" && ctx && !snapshot.arrivedFor.includes(ctx.id) ? [...snapshot.arrivedFor, ctx.id] : snapshot.arrivedFor;
    set({ party: null, controllerSid: null, endedReason: p.reason, arrivedFor, chat: [] });
  });
  socket.on("party_chat", (m: (TravelChatLine & { partyId?: string }) | undefined) => {
    // Only this journey's lines, once each (the sender hears its own from the server like everybody else).
    if (!m?.id || m.partyId !== snapshot.party?.partyId || snapshot.chat.some((c) => c.id === m.id)) return;
    const line = { id: m.id, email: m.email.toLowerCase(), text: m.text, atMs: m.atMs };
    set({ chat: [...snapshot.chat, line].slice(-TRAVEL_CHAT_WINDOW) });
  });
  socket.on("party_invites", (p: { invites?: PartyInvite[] }) => set({ invites: p.invites ?? [] }));
  socket.on("party_invite_incoming", (inv: PartyInvite) =>
    set({ invites: [...snapshot.invites.filter((i) => i.inviteId !== inv.inviteId), inv] }));
  socket.on("party_invite_resolved", (p: { inviteId: string }) =>
    set({ invites: snapshot.invites.filter((i) => i.inviteId !== p.inviteId) }));
  socket.on("party_invite_result", (p: { results?: PartyInviteResult[] }) => set({ lastResults: p.results ?? [] }));
  socketInstance = socket;
}

const emit = (event: string, payload: object = {}) => socketInstance?.emit(event, payload);

// ---- actions ----------------------------------------------------------------------------------------

export function inviteToParty(emails: string[], destination: PartyDestination, floor: string): void {
  set({ lastResults: null, endedReason: null });
  emit("party_invite", { emails, destination, floor });
}
export const acceptPartyInvite = (inviteId: string) => emit("party_invite_accept", { inviteId });
export const declinePartyInvite = (inviteId: string) => emit("party_invite_decline", { inviteId });
/** Leave (a member) or End (the leader). */
export const leaveParty = () => emit("party_leave");
export const setPartyDestination = (destination: PartyDestination) => emit("party_destination", { destination });
export const clearPartyNotice = () => set({ lastResults: null, endedReason: null });
/** Say something to the people travelling with you. The server finds the party and its recipients itself. */
export function sendTravelChat(text: string): void {
  const clean = text.trim();
  if (clean) emit("party_chat_send", { text: clean });
}
/** This person stopped travelling with the group (paused, arrived, left): forget what was said. */
export function clearTravelChat(): void {
  if (snapshot.chat.length) set({ chat: [] });
}

/** What app/goTogether.ts's controller says to the server. */
export const partyNet: PartyNet = {
  followState: (following) => emit("party_follow_state", { following }),
  where: (floor, roomId, position) => emit("party_where", { floor, roomId, position }),
  start: () => emit("party_start"),
  ready: (stageId, floor) => emit("party_ready", { stageId, floor }),
};

/** Subscribable hook. Connects on first mount. */
export function useTravelParty(): TravelPartySnapshot {
  useEffect(() => {
    ensureSocket();
  }, []);
  return useSyncExternalStore(subscribe, getTravelPartySnapshot, getTravelPartySnapshot);
}

// Test-only: module state outlives a single test.
export function resetTravelPartyStoreForTests(): void {
  socketInstance?.disconnect?.();
  socketInstance = null;
  devEmail = null;
  snapshot = EMPTY;
}

export function __setTravelPartySnapshotForTests(next: Partial<TravelPartySnapshot>): void {
  set(next);
}
