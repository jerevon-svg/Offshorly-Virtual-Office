import { useEffect, useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";
import { Room, RoomEvent, Track } from "livekit-client";
import type { RemoteTrack, RemoteTrackPublication } from "livekit-client";
import { getAuthToken } from "../api/client";
import { getCurrentUser } from "../../auth/currentUserStore";

// Stage A voice calls. ALL LiveKit room lifecycle lives here — deliberately NOT in OfficeMap.tsx,
// which only reads this store and renders controls.
//
// Layering, strictly:
//   * The SPATIAL SESSION (spatialSessionStore.ts) is the sole authority for who MAY call. This
//     store never decides eligibility; the backend re-checks it on every token request.
//   * LIVEKIT owns microphone tracks, mute, speaking, transport and reconnection. This store
//     mirrors none of that — it only holds the Room handle and a local mic boolean for the button.
//   * The SOCKET carries one fact LiveKit cannot give a client that has NOT joined: does this
//     spatial session already have a call, and who is in it. That drives Start vs Join.
//
// Own socket connection, matching every other presence client's documented rationale
// (offlineLineupClient.ts, spatialSessionStore.ts). It is also the correct ownership boundary:
// this socket's disconnect ends THIS client's media claim and nothing else — a dropped call
// socket must never touch spatial membership (see backend socket.py's disconnect handler).
//
// LEAVING A CALL NEVER LEAVES THE SPATIAL SESSION. This module does not import
// emitSpatialSessionLeave and must never call it.

export interface CallEntry {
  sessionId: string;
  room: string;
  participants: string[];
}

export type CallStatus = "idle" | "connecting" | "connected" | "error";

/** A ring in flight. Person-to-person; carries no session id and no room (see the backend's
 *  call_invites.py) — the spatial session doesn't exist yet while ringing. */
export interface CallInvite {
  inviteId: string;
  fromEmail: string;
  toEmail: string;
}

/** Terminal ring outcome the caller (or recipient) needs to see once, then dismiss. */
export interface CallInviteOutcome {
  kind: "declined" | "cancelled" | "timeout" | "failed";
  peerEmail: string;
  reason: string | null;
}

export interface CallSnapshot {
  status: CallStatus;
  /** Spatial session id this client is connected to media for, else null. */
  connectedSessionId: string | null;
  micEnabled: boolean;
  error: string | null;
  /** Server-broadcast active calls (all sessions) — drives Start vs Join for non-participants. */
  calls: CallEntry[];
  /** This client's outgoing ring ("Calling X…"), or null. */
  outgoing: CallInvite | null;
  /** An incoming ring awaiting Accept/Decline, or null. */
  incoming: CallInvite | null;
  /** Set once a ring ends without connecting, so the UI can say why. Cleared on dismiss. */
  inviteOutcome: CallInviteOutcome | null;
  /** True when the browser refused to autoplay remote audio — the call is connected and the
   *  track is flowing, but nothing is audible until a user gesture calls resumeAudioPlayback(). */
  audioPlaybackBlocked: boolean;
  /** Peer email whose Accept just landed — OfficeMap consumes this to run the EXISTING
   *  approach/spatial-panel flow, then clears it. Never triggers media directly. */
  acceptedPeerEmail: string | null;
}

function socketBase(): string {
  const raw = import.meta.env.VITE_CHAT_SOCKET_URL;
  if (!raw) {
    throw new Error(
      "VITE_CHAT_SOCKET_URL is not set. Required for the spatial voice-call feature — see .env.example.",
    );
  }
  return raw.replace(/\/+$/, "");
}

let socketInstance: Socket | null = null;
let room: Room | null = null;
let status: CallStatus = "idle";
let connectedSessionId: string | null = null;
let micEnabled = false;
let error: string | null = null;
let calls: CallEntry[] = [];
let outgoing: CallInvite | null = null;
let incoming: CallInvite | null = null;
let inviteOutcome: CallInviteOutcome | null = null;
let acceptedPeerEmail: string | null = null;
let audioPlaybackBlocked = false;
// Elements holding remote audio, one per subscribed remote track. livekit-client does NOT play
// remote audio on its own (only @livekit/components-react's RoomAudioRenderer does that, which we
// deliberately don't use) — a subscribed track is silent until it is attached to an element in the
// DOM. Kept here so every element is detached and removed on unsubscribe/leave.
const remoteAudioElements = new Map<string, HTMLAudioElement>();
// Bumped by every leave() and every new start/join. An in-flight connect whose generation is
// stale discards its own result and tears the room down — this is what stops a call being
// "resurrected" when the user clicks Leave while the connect handshake is still running.
let generation = 0;
let devEmail: string | null = null;

const listeners = new Set<() => void>();
let cached: CallSnapshot | null = null;

function notify(): void {
  cached = null;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Cached so useSyncExternalStore gets a referentially stable object between notifies (a fresh
// object every call would loop).
function getSnapshot(): CallSnapshot {
  if (cached === null) {
    cached = {
      status,
      connectedSessionId,
      micEnabled,
      error,
      calls,
      outgoing,
      incoming,
      inviteOutcome,
      acceptedPeerEmail,
      audioPlaybackBlocked,
    };
  }
  return cached;
}

/** DEV-ONLY: mirrors spatialSessionStore.setDevIdentity exactly. */
export function setDevIdentity(email: string | null): void {
  devEmail = email ? email.trim().toLowerCase() : null;
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}

function ensureSocket(): Socket | null {
  if (socketInstance) return socketInstance;
  // Same credential resolution as callAuthHeaders — otherwise, under an unseeded dev bypass, the
  // call could connect to LiveKit while call_joined was never emitted, leaving peers unable to
  // see the call at all.
  const resolvedDevEmail = resolveDevEmail();
  if (!resolvedDevEmail && !getAuthToken()) return null;

  const auth: Record<string, string | null> = resolvedDevEmail
    ? { "x-dev-email": resolvedDevEmail }
    : { token: getAuthToken() };
  const socket = io(socketBase(), { auth, autoConnect: true });

  socket.on("spatial_calls", (payload: { calls?: CallEntry[] } | undefined) => {
    calls = payload?.calls ?? [];
    notify();
  });

  // --- ringing (call invites) ------------------------------------------------------------
  // Transport only: every handler below moves transient ring state. None of them touch LiveKit,
  // request a token, or publish a microphone — that all stays behind an explicit Accept and the
  // existing eligibility-gated path.
  socket.on("call_invite_incoming", (inv: CallInvite | undefined) => {
    if (!inv?.inviteId) return;
    incoming = inv;
    inviteOutcome = null;
    notify();
  });

  socket.on("call_invite_ringing", (inv: CallInvite | undefined) => {
    if (!inv?.inviteId) return;
    outgoing = inv;
    inviteOutcome = null;
    notify();
  });

  socket.on("call_invite_accepted", (inv: CallInvite | undefined) => {
    if (!inv?.inviteId) return;
    // Both parties get this. Whichever side we are, the OTHER party is the peer to converge with.
    const self = selfEmail();
    acceptedPeerEmail = inv.fromEmail === self ? inv.toEmail : inv.fromEmail;
    outgoing = null;
    incoming = null;
    inviteOutcome = null;
    notify();
  });

  const terminal = (kind: CallInviteOutcome["kind"]) => (
    inv: (CallInvite & { reason?: string }) | undefined,
  ) => {
    if (!inv?.inviteId) return;
    const wasOutgoing = outgoing?.inviteId === inv.inviteId;
    const wasIncoming = incoming?.inviteId === inv.inviteId;
    if (!wasOutgoing && !wasIncoming) return;
    outgoing = null;
    incoming = null;
    // A recipient who declined needs no "declined" banner — only the caller does.
    inviteOutcome = wasOutgoing
      ? {
          kind: inv.reason === "timeout" ? "timeout" : kind,
          peerEmail: inv.toEmail,
          reason: inv.reason ?? null,
        }
      : null;
    notify();
  };
  socket.on("call_invite_declined", terminal("declined"));
  socket.on("call_invite_cancelled", terminal("cancelled"));

  socket.on("call_invite_failed", (p: { toEmail?: string; reason?: string } | undefined) => {
    outgoing = null;
    inviteOutcome = {
      kind: "failed",
      peerEmail: p?.toEmail ?? "",
      reason: p?.reason ?? null,
    };
    notify();
  });

  // Reconnect/reload: restore whichever ring this client is still a party to.
  socket.on("call_invites", (p: { invites?: CallInvite[] } | undefined) => {
    const self = selfEmail();
    const list = p?.invites ?? [];
    outgoing = list.find((i) => i.fromEmail === self) ?? null;
    incoming = list.find((i) => i.toEmail === self) ?? null;
    notify();
  });

  // Re-assert a live media claim after a reconnect, same reasoning as Stage 0's spatial
  // re-assert: the server's registry is per-socket-id, so a reconnect arrives as a new sid with
  // no memory of us. Only ever fires while genuinely connected to LiveKit.
  socket.on("connect", () => {
    if (connectedSessionId && status === "connected") {
      socket.emit("call_joined", { sessionId: connectedSessionId });
    }
  });

  socketInstance = socket;
  return socket;
}

/**
 * Credentials for the chat-backend REST call, in the SAME precedence every other client of this
 * backend uses (talkRequestsClient/roomRequestsClient/requestsClient): a seeded dev identity
 * first, otherwise the app's Atlas bearer token.
 *
 * Two differences from those clients, both deliberate:
 *
 *  1. It THROWS rather than sending a credential-less request. Those clients are
 *     subscription/poll endpoints where a silent 401 is harmless; here an unauthenticated POST
 *     surfaced to the user as the backend's raw "Missing Authorization bearer token", which reads
 *     like a bug in the call feature rather than "you're not signed in".
 *
 *  2. LOCAL-DEV FALLBACK: under the dev auth-gate bypass there is no Atlas token in
 *     localStorage at all — `x-dev-email` is the ONLY possible credential, and it depends on
 *     setDevIdentity() having been seeded for this module (useAuthGate's seedDevBypassIdentity,
 *     which early-returns if an identity was already cached). When that seeding hasn't happened,
 *     fall back to the identity the app itself already resolved instead of firing a doomed
 *     request. Gated on exactly the same condition as useAuthGate's own isGateBypassed()
 *     (`import.meta.env.DEV && VITE_AUTH_GATE === "off"`), so it is dead code in any real build.
 *
 * Security is unchanged either way: the backend still derives identity itself via
 * Depends(get_current_email), still hard-gates the x-dev-email path behind APP_ENV ==
 * "development", and the request body never carries an identity.
 */
function resolveDevEmail(): string | null {
  if (devEmail) return devEmail;
  // Same condition as useAuthGate's own isGateBypassed(), inlined to avoid an import cycle
  // (useAuthGate imports this module to seed setDevIdentity). Dead code in any real build.
  if (import.meta.env.DEV && import.meta.env.VITE_AUTH_GATE === "off") {
    return getCurrentUser()?.email?.trim().toLowerCase() || null;
  }
  return null;
}

/** This client's own email, however identity was resolved. Needed by the invite handlers to tell
 *  which side of a ring we are on — resolveDevEmail alone is null under real Atlas auth. */
function selfEmail(): string {
  return resolveDevEmail() ?? getCurrentUser()?.email?.trim().toLowerCase() ?? "";
}

function callAuthHeaders(): Headers {
  const headers = new Headers({ "Content-Type": "application/json" });

  const email = resolveDevEmail();
  if (email) {
    headers.set("x-dev-email", email);
    return headers;
  }

  const token = getAuthToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
    return headers;
  }

  throw new Error("You're not signed in — reload and try again.");
}

async function fetchToken(
  sessionId: string,
): Promise<{ url: string; token: string; room: string; identity: string }> {
  const res = await fetch(`${socketBase()}/calls/token`, {
    method: "POST",
    headers: callAuthHeaders(),
    body: JSON.stringify({ sessionId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Couldn't join the call (${res.status})`);
  }
  return res.json();
}

function attachRemoteAudio(track: RemoteTrack, publication: RemoteTrackPublication): void {
  if (track.kind !== Track.Kind.Audio) return;
  const key = publication.trackSid;
  if (remoteAudioElements.has(key)) return;
  // attach() returns a wired-up element; it must be IN the document for playback to start in
  // Chrome. Hidden, non-interactive, and never a UI element.
  const el = track.attach() as HTMLAudioElement;
  el.dataset.livekitRemoteAudio = key;
  el.style.display = "none";
  document.body.appendChild(el);
  remoteAudioElements.set(key, el);
}

function detachRemoteAudio(track: RemoteTrack, publication: RemoteTrackPublication): void {
  const key = publication.trackSid;
  const el = remoteAudioElements.get(key);
  if (!el) return;
  remoteAudioElements.delete(key);
  try {
    track.detach(el);
  } catch {
    // Track already ended — removing the element is still the right cleanup.
  }
  el.remove();
}

function detachAllRemoteAudio(): void {
  for (const [, el] of remoteAudioElements) {
    el.srcObject = null;
    el.remove();
  }
  remoteAudioElements.clear();
}

/** Retry blocked autoplay from inside a user gesture. */
export async function resumeAudioPlayback(): Promise<void> {
  const r = room;
  if (!r) return;
  try {
    await r.startAudio();
    audioPlaybackBlocked = !r.canPlaybackAudio;
    notify();
  } catch {
    audioPlaybackBlocked = true;
    notify();
  }
}

function teardownRoom(): void {
  const r = room;
  room = null;
  if (!r) return;
  r.removeAllListeners();
  detachAllRemoteAudio();
  audioPlaybackBlocked = false;
  // Also unpublishes the local microphone track and stops the underlying device.
  void r.disconnect();
}

/**
 * Start a new call or join the existing one for `sessionId` — the same action either way, since
 * the backend creates-or-reuses the room. EXPLICIT ONLY: nothing in this module auto-joins.
 * Idempotent while connecting/connected to the same session, so a double click cannot create a
 * second Room or publish the microphone twice.
 */
export async function startOrJoinCall(sessionId: string): Promise<void> {
  if (!sessionId) return;
  if ((status === "connecting" || status === "connected") && connectedSessionId === sessionId) {
    return;
  }
  // Switching sessions (or retrying after an error) always starts from a clean room.
  teardownRoom();

  const myGeneration = ++generation;
  status = "connecting";
  connectedSessionId = sessionId;
  error = null;
  micEnabled = false;
  notify();

  try {
    const creds = await fetchToken(sessionId);
    if (myGeneration !== generation) return; // left mid-handshake

    const r = new Room();
    room = r;

    r.on(RoomEvent.Disconnected, () => {
      // Covers a LiveKit-side drop as well as our own leave(); safe either way.
      if (room !== r) return;
      room = null;
      status = "idle";
      connectedSessionId = null;
      micEnabled = false;
      notify();
      ensureSocket()?.emit("call_left");
    });
    const syncParticipants = () => {
      if (room === r) notify();
    };
    r.on(RoomEvent.ParticipantConnected, syncParticipants);
    r.on(RoomEvent.ParticipantDisconnected, syncParticipants);

    // PLAYBACK. Without this a remote track is subscribed but inaudible — see
    // remoteAudioElements. Audio only; Stage A publishes and subscribes no video.
    r.on(RoomEvent.TrackSubscribed, (track, publication) => {
      if (room !== r) return;
      attachRemoteAudio(track, publication);
      notify();
    });
    r.on(RoomEvent.TrackUnsubscribed, (track, publication) => {
      if (room !== r) return;
      detachRemoteAudio(track, publication);
      notify();
    });
    // Chrome blocks autoplay until the page has a user gesture. Surface it rather than failing
    // silently — the call is connected and the track is flowing, just muted by the browser.
    r.on(RoomEvent.AudioPlaybackStatusChanged, () => {
      if (room !== r) return;
      audioPlaybackBlocked = !r.canPlaybackAudio;
      notify();
    });

    await r.connect(creds.url, creds.token);
    if (myGeneration !== generation) {
      // Leave was clicked during connect — honour it rather than surfacing a live call.
      r.removeAllListeners();
      void r.disconnect();
      if (room === r) room = null;
      return;
    }

    // Voice only: microphone in, no camera, no screen share anywhere in Stage A.
    await r.localParticipant.setMicrophoneEnabled(true);
    if (myGeneration !== generation) {
      r.removeAllListeners();
      void r.disconnect();
      if (room === r) room = null;
      return;
    }

    status = "connected";
    audioPlaybackBlocked = !r.canPlaybackAudio;
    micEnabled = r.localParticipant.isMicrophoneEnabled;
    error = null;
    notify();

    // Announced only AFTER the real connection succeeded — never optimistically on click.
    ensureSocket()?.emit("call_joined", { sessionId });
  } catch (err) {
    if (myGeneration !== generation) return;
    teardownRoom();
    status = "error";
    connectedSessionId = null;
    micEnabled = false;
    error = err instanceof Error ? err.message : "Couldn't join the call";
    notify();
  }
}

/**
 * Leave the media call and NOTHING else: the spatial session, the chat panel, and the
 * conversation are all untouched (this module never calls emitSpatialSessionLeave). Stops and
 * unpublishes the microphone via Room.disconnect().
 */
export function leaveCall(): void {
  generation += 1; // invalidates any in-flight connect
  teardownRoom();
  status = "idle";
  connectedSessionId = null;
  micEnabled = false;
  error = null;
  notify();
  ensureSocket()?.emit("call_left");
}

/** Local mute/unmute. LiveKit is the source of truth; the boolean here only drives the button. */
export async function setMicEnabled(enabled: boolean): Promise<void> {
  const r = room;
  if (!r || status !== "connected") return;
  await r.localParticipant.setMicrophoneEnabled(enabled);
  micEnabled = r.localParticipant.isMicrophoneEnabled;
  notify();
}

/**
 * Ring someone. Sends ONLY the intent — no walk, no chat panel, no spatial session, no token, no
 * microphone. Everything spatial and media-related waits for the recipient's Accept.
 */
export function sendCallInvite(toEmail: string): void {
  if (!toEmail) return;
  inviteOutcome = null;
  notify();
  ensureSocket()?.emit("call_invite", { toEmail: toEmail.trim().toLowerCase() });
}

/** Recipient accepts. Still no media here — see acceptedPeerEmail's doc comment. */
export function acceptCallInvite(): void {
  const inv = incoming;
  if (!inv) return;
  ensureSocket()?.emit("call_invite_accept", { inviteId: inv.inviteId });
}

/** Recipient declines. No session, no media, and (unlike a talk request) no cooldown. */
export function declineCallInvite(): void {
  const inv = incoming;
  if (!inv) return;
  incoming = null;
  notify();
  ensureSocket()?.emit("call_invite_decline", { inviteId: inv.inviteId });
}

/** Caller cancels before an answer. */
export function cancelCallInvite(): void {
  const inv = outgoing;
  if (!inv) return;
  outgoing = null;
  notify();
  ensureSocket()?.emit("call_invite_cancel", { inviteId: inv.inviteId });
}

/** Consumed by OfficeMap once it has kicked off the existing approach/spatial-panel flow. */
export function clearAcceptedPeer(): void {
  if (acceptedPeerEmail === null) return;
  acceptedPeerEmail = null;
  notify();
}

export function dismissInviteOutcome(): void {
  if (inviteOutcome === null) return;
  inviteOutcome = null;
  notify();
}

/** Emails currently connected to `sessionId`'s call, per the server broadcast. */
export function callParticipantsFor(snapshot: CallSnapshot, sessionId: string | null): string[] {
  if (!sessionId) return [];
  return snapshot.calls.find((c) => c.sessionId === sessionId)?.participants ?? [];
}

/**
 * DEV-ONLY escape hatch for the temporary Audio Debug panel (AudioDebugPanel.tsx). Returns the
 * live Room so the panel can poll LiveKit's own participant/track state — it creates no
 * connection, no token, and no track. Returns null outside dev builds so no production code path
 * can reach the Room object.
 */
export function getRoomForDevDiagnostics(): Room | null {
  if (!import.meta.env.DEV) return null;
  return room;
}

export function getCallSnapshot(): CallSnapshot {
  return getSnapshot();
}

/** True iff this client is connected to LiveKit media — the ONLY input to the IN_CALL status. */
export function isConnectedToMedia(snapshot: CallSnapshot): boolean {
  return snapshot.status === "connected";
}

export function useCallState(): CallSnapshot {
  useEffect(() => {
    ensureSocket();
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Test-only: module state (socket, room, status) outlives a single test. */
export function resetCallStoreForTests(): void {
  generation += 1;
  const r = room;
  room = null;
  r?.removeAllListeners?.();
  socketInstance?.disconnect?.();
  socketInstance = null;
  status = "idle";
  connectedSessionId = null;
  micEnabled = false;
  error = null;
  calls = [];
  outgoing = null;
  incoming = null;
  inviteOutcome = null;
  acceptedPeerEmail = null;
  audioPlaybackBlocked = false;
  detachAllRemoteAudio();
  devEmail = null;
  notify();
}
