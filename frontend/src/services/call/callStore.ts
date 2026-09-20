import { useEffect, useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";
import { Room, RoomEvent, Track } from "livekit-client";
import type {
  LocalVideoTrack,
  Participant,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  RemoteVideoTrack,
  TrackPublication,
} from "livekit-client";
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

/** A camera track ready to be shown over someone's avatar. Local and remote video tracks share
 *  the attach()/detach() surface SpatialVideoTile needs, and nothing here cares which is which —
 *  that is the whole reason self video needs no second code path. */
export type SpatialVideoTrack = LocalVideoTrack | RemoteVideoTrack;

/** A ring in flight. Person-to-person; carries no session id and no room (see the backend's
 *  call_invites.py) — the spatial session doesn't exist yet while ringing. */
export interface CallInvite {
  inviteId: string;
  fromEmail: string;
  toEmail: string;
  /** PHASE 7D. Present only on a MEETING invitation — the room being offered. */
  meetingId?: string;
}

/** Terminal ring outcome the caller (or recipient) needs to see once, then dismiss. */
export interface CallInviteOutcome {
  kind: "declined" | "cancelled" | "timeout" | "failed";
  peerEmail: string;
  reason: string | null;
}

/** What a media connection is FOR. W5-B: the same Room lifecycle serves a spatial conversation
 *  call and a whiteboard's voice room; only the token endpoint and the presence signal differ.
 *  Exactly one target can be connected at a time — there is one Room. */
export type CallTarget =
  | { kind: "spatial"; sessionId: string }
  | { kind: "whiteboard"; boardId: string }
  /** A STANDALONE MEETING (All Hands, a Championship Cave session). The one target a HOST MAY
   *  OPEN ALONE — a spatial call needs two avatars standing together by definition, and this is
   *  the other thing an office needs: a room you start and wait in. Same Room, same store, same
   *  token service; only the endpoint and the "who may join" rule differ (backend
   *  routers/calls.py: any signed-in employee, no head-count). */
  | { kind: "meeting"; meetingId: string };

/** PHASE 7D — a standalone meeting the server is broadcasting, with its host. Separate from
 *  `CallEntry` because it is a separate broadcast for a separate thing: `calls` describes
 *  CONVERSATIONS and is matched against conversation ids, and a meeting is not one. */
export interface MeetingEntry {
  meetingId: string;
  participants: string[];
  /** The current host's email, or "" while the server has nobody in the room. */
  host: string;
}

export interface CallSnapshot {
  status: CallStatus;
  /** Spatial session id this client is connected to media for, else null. */
  connectedSessionId: string | null;
  /** W5-B. Whiteboard id this client is connected to voice for, else null. Mutually exclusive with
   *  connectedSessionId. Board voice never announces call_joined/call_left — its presence rides on
   *  the whiteboard socket (WhiteboardEditor emits whiteboard_voice from this field). */
  connectedBoardId: string | null;
  /** Standalone meeting id this client is connected to, else null. Mutually exclusive with the
   *  other two — there is one Room. A meeting never announces call_joined/call_left: the spatial
   *  call registry describes CONVERSATIONS, and a meeting is not one. */
  connectedMeetingId: string | null;
  /** W5-B. Last board-voice failure, scoped to the board it happened on so the board's own
   *  controls show it and nothing spatial ever does. `error`/status "error" stay spatial-only. */
  boardError: { boardId: string; message: string } | null;
  micEnabled: boolean;
  /** Stage B. Local camera publication state — mirrors LiveKit's own
   *  localParticipant.isCameraEnabled and drives the camera button ONLY. Always starts false for
   *  every new/rejoined call: nothing in this module ever turns the camera on by itself. */
  cameraEnabled: boolean;
  /** Stage B. Last camera-specific failure (permission denied, no device). Deliberately separate
   *  from `error`, which means "the CALL failed" — a camera failure must never take voice down. */
  cameraError: string | null;
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
  /** Stage B. LiveKit IDENTITY (a lowercased Atlas email — see the backend's
   *  AccessToken.with_identity) -> that participant's LIVE, UNMUTED camera track. Includes this
   *  client's own local camera under its own identity, so self video needs no separate field.
   *  A participant with the camera off is ABSENT from this map, never present-but-muted — that
   *  is what stops a frozen last frame hanging over an avatar. Referentially stable between
   *  changes so React can depend on it directly. */
  videoByIdentity: Record<string, SpatialVideoTrack>;
  /** V1 SCREEN SHARE. The ONE active screen-share video track in the room, with the LiveKit
   *  identity publishing it, or null when nobody is sharing. Deliberately a single slot rather
   *  than an identity map: a share is a room-wide presentation, every surface that shows one
   *  (the CAVE's front panel today) shows THE share, and "who is presenting" is one answer. The
   *  first live share wins; a second presenter's track is ignored until the first ends, so the
   *  picture can never flip between two sources mid-demo.
   *
   *  This is a VIDEO track only. Screen-share AUDIO is a separate LiveKit source that arrives as
   *  an ordinary audio track and is played by the existing hidden-element path — which is exactly
   *  why nothing that renders this field may ever unmute its own element. */
  screenShare: { identity: string; track: SpatialVideoTrack } | null;
  /** Local publication state — drives the Share button ONLY, same contract as cameraEnabled. */
  screenShareEnabled: boolean;
  /** Last screen-share-specific failure (the user cancelled the picker, no permission). Separate
   *  from `error` and `cameraError` for the same reason those are separate: a refused share must
   *  never take voice, video or the call down. */
  screenShareError: string | null;
  /** Peer email whose Accept just landed — OfficeMap consumes this to run the EXISTING
   *  approach/spatial-panel flow, then clears it. Never triggers media directly. */
  acceptedPeerEmail: string | null;
  /** PHASE 7D. Standalone meetings the SERVER is broadcasting, host included. This is the only thing
   *  a client that has NOT joined can read, and therefore the only honest source of "Start" versus
   *  "Join" before connecting — `participants` below is LiveKit's view and exists only once you are
   *  already in. Empty when no meeting is running anywhere. */
  meetings: MeetingEntry[];
  /** PHASE 7D. An incoming invitation to a MEETING, or null. Deliberately a separate field from
   *  `incoming`: that is a ring to a conversation between two avatars, this is an offer of a room,
   *  and one must never resolve the other. */
  incomingMeetingInvite: CallInvite | null;
  /** This client's outgoing meeting invitation, or null. */
  outgoingMeetingInvite: CallInvite | null;
  /** Why a meeting invitation ended without being accepted. Cleared on dismiss. */
  meetingInviteOutcome: CallInviteOutcome | null;
  /** PHASE 7D. WHO IS ACTUALLY IN THE ROOM THIS CLIENT IS CONNECTED TO — read from LiveKit itself
   *  (localParticipant + remoteParticipants), lowercased and sorted, self always included.
   *
   *  It is deliberately NOT a second call registry and it never replaces `calls`: that field is the
   *  SERVER's broadcast and is the only thing a client who has NOT joined can read, which is why Start
   *  vs Join for a spatial session still comes from there. This one answers the different question a
   *  CONNECTED client can answer for itself and previously could not see at all — "how many of us are
   *  in here" — which is the only honest head-count a MEETING has, since a meeting never announces
   *  call_joined/call_left (see the fields above and the backend's socket.py gate).
   *
   *  Empty whenever `status` is not "connected". LiveKit already raises ParticipantConnected /
   *  ParticipantDisconnected into this store's notify(), so it is live without a new subscription. */
  participants: string[];
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
let connectedBoardId: string | null = null;
let connectedMeetingId: string | null = null;
let boardError: { boardId: string; message: string } | null = null;
let micEnabled = false;
let cameraEnabled = false;
let cameraError: string | null = null;
// Stage B. A camera toggle is slow (getUserMedia prompt + device start), easily long enough for a
// second click to land mid-flight. LiveKit would serialise those internally, but the SNAPSHOT
// would briefly disagree with the device. Guarded here so the button cannot be double-fired.
let cameraPending = false;
let screenShareEnabled = false;
let screenShareError: string | null = null;
// Same re-entrancy reasoning as cameraPending: getDisplayMedia opens a native picker the user can
// sit on for seconds, easily long enough for a second click.
let screenSharePending = false;
let error: string | null = null;
let calls: CallEntry[] = [];
let outgoing: CallInvite | null = null;
let incoming: CallInvite | null = null;
let inviteOutcome: CallInviteOutcome | null = null;
// PHASE 7D — meetings. Separate slots from the spatial ring above, for the reason stated on the
// snapshot fields: a meeting invitation and a call to a person are different offers.
let meetings: MeetingEntry[] = [];
let incomingMeetingInvite: CallInvite | null = null;
let outgoingMeetingInvite: CallInvite | null = null;
let meetingInviteOutcome: CallInviteOutcome | null = null;
let acceptedPeerEmail: string | null = null;
let audioPlaybackBlocked = false;
// Elements holding remote audio, one per subscribed remote track. livekit-client does NOT play
// remote audio on its own (only @livekit/components-react's RoomAudioRenderer does that, which we
// deliberately don't use) — a subscribed track is silent until it is attached to an element in the
// DOM. Kept here so every element is detached and removed on unsubscribe/leave.
const remoteAudioElements = new Map<string, HTMLAudioElement>();
// Stage B. LiveKit identity -> that participant's live camera track. Deliberately holds TRACKS,
// not elements: the DOM element for video is owned by the React tile that renders it
// (SpatialVideoTile), which is what makes several participants work without any bookkeeping here.
// Audio is the opposite — no component renders it, so this module owns those elements above.
// The two registries never touch each other.
const videoTracks = new Map<string, SpatialVideoTrack>();
// Snapshot-facing projection of `videoTracks`, rebuilt only when the map actually changes so the
// object stays referentially stable for React consumers between video events.
let videoByIdentity: Record<string, SpatialVideoTrack> = {};
// V1 screen share. ONE slot, holding the TRACK (never an element): the element belongs to whoever
// renders it — the CAVE's presentation adapter owns its own — exactly like the camera registry above.
let screenShare: { identity: string; track: SpatialVideoTrack } | null = null;
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
      connectedBoardId,
      connectedMeetingId,
      boardError,
      micEnabled,
      cameraEnabled,
      cameraError,
      error,
      calls,
      outgoing,
      incoming,
      inviteOutcome,
      acceptedPeerEmail,
      audioPlaybackBlocked,
      videoByIdentity,
      screenShare,
      screenShareEnabled,
      screenShareError,
      participants: currentParticipants(),
      meetings,
      incomingMeetingInvite,
      outgoingMeetingInvite,
      meetingInviteOutcome,
    };
  }
  return cached;
}

/** DEV-ONLY: mirrors spatialSessionStore.setDevIdentity exactly, with ONE correction.
 *
 *  RE-SEEDING THE SAME IDENTITY MUST NOT DROP THE SOCKET. Tearing it down is right when the identity
 *  genuinely CHANGES — the connection authenticates as one person and a new one has to be opened — but
 *  this used to do it on every call, and callers re-seed the same address routinely: `useAuthGate` on a
 *  re-render, and `CaveLiveShare.connect()` every time the Cave panel remounts.
 *
 *  A dropped socket is not a cosmetic churn here. The server cleans up BY SID, so each needless
 *  disconnect told it, wrongly, that this person had gone:
 *    * `meeting_invites.clear_sid` cancelled an invitation the moment after it was sent — the recipient's
 *      notice vanished, and the inviter, whose socket was the one that went, never heard the
 *      cancellation and sat on a "Waiting for them to join" card forever;
 *    * `call_registry.clear_sid` dropped the person's meeting claim, handing the host to somebody else
 *      while they were still standing in the Cave.
 *
 *  Both of those were Phase 7D blockers and both were this one line. Comparing before disconnecting is
 *  the fix: an unchanged identity keeps its connection, a changed one still gets a fresh socket. */
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

  // PHASE 7D — STANDALONE MEETINGS. Its own event, never folded into spatial_calls: that feed is
  // matched against conversation ids by every chat surface, and a meeting is not a conversation. The
  // server sends this once on connect as well, so a client that walks into the Cave already knows
  // whether a meeting is running before it asks for a token.
  socket.on("meeting_presence", (payload: { meetings?: MeetingEntry[] } | undefined) => {
    meetings = payload?.meetings ?? [];
    notify();
  });

  socket.on("meeting_invite_incoming", (inv: CallInvite | undefined) => {
    if (!inv?.inviteId) return;
    incomingMeetingInvite = inv;
    meetingInviteOutcome = null;
    notify();
  });

  socket.on("meeting_invite_ringing", (inv: CallInvite | undefined) => {
    if (!inv?.inviteId) return;
    outgoingMeetingInvite = inv;
    meetingInviteOutcome = null;
    notify();
  });

  socket.on("meeting_invites", (payload: { invites?: CallInvite[] } | undefined) => {
    // Reconnect/reload: restore whichever side of an in-flight invitation this client is on.
    for (const inv of payload?.invites ?? []) {
      if (inv.toEmail === selfEmail()) incomingMeetingInvite = inv;
      else outgoingMeetingInvite = inv;
    }
    notify();
  });

  socket.on("meeting_invite_accepted", (inv: CallInvite | undefined) => {
    clearMeetingInvite(inv);
    // The RECIPIENT's own client is the one that joins, from its own Accept. Nothing is joined here
    // for either side — this event only clears the prompts.
    notify();
  });

  socket.on("meeting_invite_declined", (inv: CallInvite | undefined) => {
    const wasOutgoing = outgoingMeetingInvite?.inviteId === inv?.inviteId;
    clearMeetingInvite(inv);
    if (wasOutgoing && inv) {
      meetingInviteOutcome = { kind: "declined", peerEmail: inv.toEmail, reason: null };
    }
    notify();
  });

  socket.on("meeting_invite_cancelled", (inv: (CallInvite & { reason?: string }) | undefined) => {
    const wasIncoming = incomingMeetingInvite?.inviteId === inv?.inviteId;
    clearMeetingInvite(inv);
    if (wasIncoming) meetingInviteOutcome = null; // the recipient simply stops being offered it
    else if (inv) {
      meetingInviteOutcome = {
        kind: inv.reason === "timeout" ? "timeout" : "cancelled",
        peerEmail: inv.toEmail,
        reason: inv.reason ?? null,
      };
    }
    notify();
  });

  socket.on(
    "meeting_invite_failed",
    (payload: { toEmail?: string; reason?: string } | undefined) => {
      outgoingMeetingInvite = null;
      meetingInviteOutcome = {
        kind: "failed",
        peerEmail: payload?.toEmail ?? "",
        reason: payload?.reason ?? null,
      };
      notify();
    },
  );

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
    // PHASE 7D: the same re-assert for a meeting. Without it a reconnect silently drops this client
    // out of the meeting's presence — and, if they were hosting, hands the meeting to somebody else
    // while they are still sitting in it.
    if (connectedMeetingId && status === "connected") {
      socket.emit("call_joined", { meetingId: connectedMeetingId });
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
  target: CallTarget,
): Promise<{ url: string; token: string; room: string; identity: string }> {
  // Two endpoints, one token shape (backend services/livekit_tokens.py). Eligibility is the
  // server's: spatial-session membership for calls, the board's can_access for board voice.
  const url =
    target.kind === "spatial"
      ? `${socketBase()}/calls/token`
      : target.kind === "whiteboard"
        ? `${socketBase()}/whiteboards/${encodeURIComponent(target.boardId)}/voice/token`
        : `${socketBase()}/meetings/${encodeURIComponent(target.meetingId)}/token`;
  const res = await fetch(url, {
    method: "POST",
    headers: callAuthHeaders(),
    // Only the spatial endpoint takes a body; the other two carry their id in the path.
    ...(target.kind === "spatial" ? { body: JSON.stringify({ sessionId: target.sessionId }) } : {}),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const noun =
      target.kind === "spatial" ? "the call" : target.kind === "whiteboard" ? "board voice" : "the meeting";
    throw new Error(body?.error || body?.detail || `Couldn't join ${noun} (${res.status})`);
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

// --- camera video registry -------------------------------------------------------------------
// CAMERA ONLY, everywhere below: every entry point filters on Track.Source.Camera, so a future
// screen-share publication can never be mistaken for somebody's face.

/** Stable empty list, so a disconnected snapshot never hands React a fresh array. */
const NO_PARTICIPANTS: readonly string[] = [];

/** PHASE 7D. Room membership straight off the live Room — no cache to go stale, because the snapshot
 *  itself is only rebuilt when something notified. Sorted so a tile order or a name list does not
 *  reshuffle when somebody else joins. */
function currentParticipants(): string[] {
  const r = room;
  if (!r || status !== "connected") return NO_PARTICIPANTS as string[];
  const out: string[] = [];
  const me = normalizeIdentity(r.localParticipant?.identity);
  if (me) out.push(me);
  // Defensive against the Room shape rather than assuming it: this runs on EVERY snapshot rebuild, and
  // a snapshot read must never be the thing that throws. A room mid-teardown, or a livekit-client whose
  // participant map moved, degrades to "just me" instead of taking the whole call UI down.
  const remotes = r.remoteParticipants;
  if (remotes && typeof remotes.values === "function") {
    for (const p of remotes.values()) {
      const id = normalizeIdentity(p?.identity);
      if (id && !out.includes(id)) out.push(id);
    }
  }
  return out.sort();
}

function normalizeIdentity(identity: string | undefined): string {
  return identity?.trim().toLowerCase() ?? "";
}

function isCameraVideo(publication: {
  kind?: unknown;
  source?: unknown;
}): boolean {
  return publication.kind === Track.Kind.Video && publication.source === Track.Source.Camera;
}

/** SCREEN SHARE, and only screen share. Mirrors isCameraVideo exactly so the two sources can never
 *  be confused in either direction: a share never becomes somebody's face tile, and a camera never
 *  becomes the presentation. */
function isScreenShareVideo(publication: { kind?: unknown; source?: unknown }): boolean {
  return publication.kind === Track.Kind.Video && publication.source === Track.Source.ScreenShare;
}

/** First live share wins — see the CallSnapshot.screenShare note. Returns true iff it changed. */
function setScreenShare(identity: string, track: SpatialVideoTrack | undefined): boolean {
  const key = normalizeIdentity(identity);
  if (!key || !track) return false;
  if (screenShare?.track === track) return false;
  if (screenShare && screenShare.identity !== key) return false; // somebody else is already sharing
  screenShare = { identity: key, track };
  return true;
}

/** Clear the share iff it belongs to `identity` — so a second participant's unpublish, or their
 *  disconnect, can never pull the live presenter's picture off the wall. */
function clearScreenShareFor(identity: string): boolean {
  const key = normalizeIdentity(identity);
  if (!screenShare || (key && screenShare.identity !== key)) return false;
  screenShare = null;
  return true;
}

function clearScreenShare(): void {
  screenShare = null;
}

function syncVideoByIdentity(): void {
  videoByIdentity = Object.fromEntries(videoTracks);
}

function setVideoTrack(identity: string, track: SpatialVideoTrack | undefined): boolean {
  const key = normalizeIdentity(identity);
  if (!key || !track) return false;
  if (videoTracks.get(key) === track) return false;
  videoTracks.set(key, track);
  syncVideoByIdentity();
  return true;
}

function clearVideoTrack(identity: string): boolean {
  const key = normalizeIdentity(identity);
  if (!videoTracks.delete(key)) return false;
  syncVideoByIdentity();
  return true;
}

function clearAllVideoTracks(): void {
  if (videoTracks.size === 0) return;
  videoTracks.clear();
  syncVideoByIdentity();
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
  // Camera state is per-room and never survives one: a rejoin always starts with the camera OFF.
  // Cleared unconditionally (before the null-room bail) so a torn-down store can't strand a stale
  // "camera on" button.
  cameraEnabled = false;
  cameraError = null;
  cameraPending = false;
  screenShareEnabled = false;
  screenShareError = null;
  screenSharePending = false;
  // The presentation dies with the room too: a torn-down store must never leave a stale track
  // pinned on the CAVE wall.
  clearScreenShare();
  // Every tile — self and remote — disappears with the room. Room.disconnect() below also stops
  // the local camera device, so nothing is left publishing.
  clearAllVideoTracks();
  if (!r) return;
  r.removeAllListeners();
  detachAllRemoteAudio();
  audioPlaybackBlocked = false;
  // Also unpublishes the local microphone AND camera tracks and stops the underlying devices.
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
  await connectTo({ kind: "spatial", sessionId });
}

/**
 * W5-B. Join a whiteboard's voice room — EXPLICIT ONLY, exactly like startOrJoinCall: opening a
 * board never calls this, and nothing here touches the whiteboard socket or the spatial session.
 * Same single Room: joining board voice while in a spatial call (or another board's voice) tears
 * that call down first — the UI disables Join Voice in that case so it cannot happen by accident.
 */
export async function startOrJoinBoardVoice(boardId: string): Promise<void> {
  if (!boardId) return;
  await connectTo({ kind: "whiteboard", boardId });
}

/**
 * START OR JOIN A STANDALONE MEETING — the one call a HOST MAY OPEN ALONE.
 *
 * Deliberately the same three lines as startOrJoinCall and startOrJoinBoardVoice: one Room, one
 * token service, one set of LiveKit handlers. What differs is entirely the server's rule for the
 * endpoint it hits — a meeting has no head-count requirement (backend routers/calls.py), which is
 * exactly why a single host can start one and wait for people to arrive.
 *
 * Create-or-join is the SERVER's answer, not this client's: everyone who passes the same meeting
 * id gets the same room, whether they are first or fifth. Screen share, mic, camera and the CAVE's
 * presentation panel all work here unchanged, because none of them know what kind of target the
 * Room was opened for.
 *
 * EXPLICIT ONLY. Nothing auto-joins a meeting, and the spatial >=2-person rule is untouched.
 */
export async function startOrJoinMeeting(meetingId: string): Promise<void> {
  if (!meetingId) return;
  await connectTo({ kind: "meeting", meetingId: meetingId.trim().toLowerCase() });
}

/** W5-B. Leave board voice iff connected to THIS board's voice — the editor calls it on close so
 *  a board's audio never outlives the board, while a spatial call is never touched by it. */
export function leaveBoardVoice(boardId: string): void {
  if (connectedBoardId === boardId) leaveCall();
}

export function clearBoardError(): void {
  if (boardError === null) return;
  boardError = null;
  notify();
}

function isConnectedTo(target: CallTarget): boolean {
  if (status !== "connecting" && status !== "connected") return false;
  if (target.kind === "spatial") return connectedSessionId === target.sessionId;
  if (target.kind === "whiteboard") return connectedBoardId === target.boardId;
  return connectedMeetingId === target.meetingId;
}

async function connectTo(target: CallTarget): Promise<void> {
  if (isConnectedTo(target)) return;
  // Leaving a SPATIAL call for board voice is a spatial leave: tell the server so the call
  // registry does not keep a stale claim (nothing else will announce it — board voice never
  // emits call_*). Spatial → spatial keeps its existing semantics (call_joined replaces).
  const leavingSpatialForBoard =
    target.kind !== "spatial" && connectedSessionId !== null && (status === "connecting" || status === "connected");
  // Switching targets (or retrying after an error) always starts from a clean room.
  teardownRoom();
  if (leavingSpatialForBoard) ensureSocket()?.emit("call_left");

  const myGeneration = ++generation;
  status = "connecting";
  connectedSessionId = target.kind === "spatial" ? target.sessionId : null;
  connectedBoardId = target.kind === "whiteboard" ? target.boardId : null;
  connectedMeetingId = target.kind === "meeting" ? target.meetingId : null;
  error = null;
  if (target.kind === "whiteboard") boardError = null;
  micEnabled = false;
  // Stage B: EVERY new/rejoined call starts with the camera off. There is deliberately no
  // "remember my last camera state" — turning a camera on is always an explicit, per-call act.
  cameraEnabled = false;
  cameraError = null;
  screenShareEnabled = false;
  screenShareError = null;
  notify();

  try {
    const creds = await fetchToken(target);
    if (myGeneration !== generation) return; // left mid-handshake

    const r = new Room();
    room = r;

    r.on(RoomEvent.Disconnected, () => {
      if (room !== r) return;
      const wasSpatial = connectedSessionId !== null;
      const wasMeeting = connectedMeetingId;
      room = null;
      status = "idle";
      connectedSessionId = null;
      connectedBoardId = null;
      connectedMeetingId = null;
      micEnabled = false;
      cameraEnabled = false;
      cameraError = null;
      cameraPending = false;
      screenShareEnabled = false;
      screenShareError = null;
      screenSharePending = false;
      clearScreenShare();
      clearAllVideoTracks();
      notify();
      // call_left is a SPATIAL fact; board voice presence is derived from this snapshot by the
      // editor and sent over the whiteboard socket instead.
      if (wasSpatial) ensureSocket()?.emit("call_left");
      // PHASE 7D: a meeting must announce its departure too, or the host never transfers and the
      // meeting never ends. The server resolves WHICH room from the socket id, so the payload is the
      // same empty one a spatial leave sends.
      else if (wasMeeting) ensureSocket()?.emit("call_left");
    });
    const syncParticipants = () => {
      if (room === r) notify();
    };
    r.on(RoomEvent.ParticipantConnected, syncParticipants);
    r.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      if (room !== r) return;
      // A participant who vanishes without an orderly unsubscribe (crash, reload, network drop)
      // would otherwise leave their tile pinned over their avatar forever.
      clearVideoTrack(participant?.identity ?? "");
      // PRESENTER DISCONNECT. A share is unpublished on an orderly stop, but a crash/reload/network
      // drop never unpublishes anything — without this the CAVE would hold a dead track forever.
      clearScreenShareFor(participant?.identity ?? "");
      notify();
    });

    // PLAYBACK. Without this a remote track is subscribed but inaudible — see
    // remoteAudioElements. The AUDIO half below is Stage A, unchanged; Stage B adds the camera
    // half beside it, and the two never share an element.
    r.on(
      RoomEvent.TrackSubscribed,
      (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (room !== r) return;
        // UNCHANGED Stage A audio path — attachRemoteAudio itself ignores non-audio tracks.
        attachRemoteAudio(track, publication);
        // Stage B, strictly beside it: video is never attached to those hidden audio elements.
        // A publication that arrives already muted (camera off before we subscribed) is left out
        // of the map on purpose — TrackUnmuted below adds it if and when it goes live.
        if (isCameraVideo(publication) && !publication.isMuted) {
          setVideoTrack(participant?.identity ?? "", publication.videoTrack);
        }
        // Screen share, strictly beside the camera path and never in the same registry.
        if (isScreenShareVideo(publication) && !publication.isMuted) {
          setScreenShare(participant?.identity ?? "", publication.videoTrack);
        }
        notify();
      },
    );
    r.on(
      RoomEvent.TrackUnsubscribed,
      (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (room !== r) return;
        detachRemoteAudio(track, publication);
        if (isCameraVideo(publication)) {
          clearVideoTrack(participant?.identity ?? "");
        }
        // The ORDINARY end of a share: livekit-client UNPUBLISHES screen share (it only mutes
        // cameras), so this is the event that restores the CAVE to its own video.
        if (isScreenShareVideo(publication)) {
          clearScreenShareFor(participant?.identity ?? "");
        }
        notify();
      },
    );
    // FROZEN-FRAME GUARD. livekit-client turns a camera OFF by MUTING the publication, not by
    // unpublishing it (only screen-share unpublishes — see LocalParticipant.setTrackEnabled), so
    // TrackUnsubscribed never fires for a camera-off. Without these two handlers the subscriber
    // keeps a live-but-stalled track and the tile hangs on the last decoded frame over the
    // avatar. Muted => out of the map immediately; unmuted => back in.
    // Base Participant/TrackPublication types on purpose: LiveKit raises these for the LOCAL
    // participant as well, and self video lives in the same map as everyone else's.
    r.on(RoomEvent.TrackMuted, (publication: TrackPublication, participant: Participant) => {
      if (room !== r) return;
      if (isScreenShareVideo(publication)) {
        clearScreenShareFor(participant?.identity ?? "");
        notify();
        return;
      }
      if (!isCameraVideo(publication)) return;
      clearVideoTrack(participant?.identity ?? "");
      notify();
    });
    r.on(RoomEvent.TrackUnmuted, (publication: TrackPublication, participant: Participant) => {
      if (room !== r) return;
      if (isScreenShareVideo(publication)) {
        setScreenShare(participant?.identity ?? "", publication.videoTrack as SpatialVideoTrack | undefined);
        notify();
        return;
      }
      if (!isCameraVideo(publication)) return;
      setVideoTrack(participant?.identity ?? "", publication.videoTrack);
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
    // Voice only on connect — the camera is never published here (see setCameraEnabled).
    cameraEnabled = false;
    error = null;
    notify();

    // Announced only AFTER the real connection succeeded — never optimistically on click.
    if (target.kind === "spatial") ensureSocket()?.emit("call_joined", { sessionId: target.sessionId });
    // PHASE 7D — A MEETING ANNOUNCES ITSELF TOO, and this is what makes Start-vs-Join, the head-count
    // and the host possible at all: before this the server had no way to know anybody was in a meeting
    // (its call_joined handler gated on spatial membership, which a meeting has none of). Emitted only
    // AFTER the real connection succeeded, exactly like the spatial line above.
    if (target.kind === "meeting") ensureSocket()?.emit("call_joined", { meetingId: target.meetingId });
  } catch (err) {
    if (myGeneration !== generation) return;
    teardownRoom();
    connectedSessionId = null;
    connectedBoardId = null;
    connectedMeetingId = null;
    micEnabled = false;
    if (target.kind === "whiteboard") {
      // Contained: the board's own controls show this; status stays idle so no spatial surface
      // (toast, overlay, IN_CALL status) reacts to a board-voice failure.
      status = "idle";
      boardError = { boardId: target.boardId, message: err instanceof Error ? err.message : "Couldn't join board voice" };
    } else {
      status = "error";
      error = err instanceof Error ? err.message : "Couldn't join the call";
    }
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
  const wasSpatial = connectedSessionId !== null;
  const wasMeeting = connectedMeetingId !== null;
  teardownRoom();
  status = "idle";
  connectedSessionId = null;
  connectedBoardId = null;
  connectedMeetingId = null;
  micEnabled = false;
  error = null;
  notify();
  // Spatial or MEETING (see the Disconnected handler): board voice never announces itself here.
  if (wasSpatial || wasMeeting) ensureSocket()?.emit("call_left");
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
 * Stage B camera on/off. Deliberately shaped exactly like setMicEnabled above — same connected-
 * call guard, same "LiveKit is the source of truth, the boolean only drives the button" rule.
 *
 * Three things make this safe to add to a working voice call:
 *
 *  1. NOTHING ELSE CALLS IT. There is no call to setCameraEnabled anywhere in the ringing,
 *     accept, spatial-setup, connect or join/rejoin paths — turning a camera on is always an
 *     explicit user act, and every new call starts with it off.
 *
 *  2. A CAMERA FAILURE NEVER TAKES VOICE DOWN. getUserMedia rejects on a denied permission or a
 *     missing device; that lands in `cameraError` and leaves status/`error`/the room untouched,
 *     so the call stays connected and audible. This is why cameraError is a separate field.
 *
 *  3. It is re-entrancy guarded. `cameraPending` is held across the await so a double click
 *     cannot start two device acquisitions or leave the snapshot disagreeing with the device.
 *
 * NOTE on turning the camera OFF: livekit-client MUTES the camera publication rather than
 * unpublishing it (only screen-share unpublishes), and LocalVideoTrack.mute() stops the
 * underlying MediaStreamTrack so the camera indicator light goes out. Peers therefore observe
 * camera-off as RoomEvent.TrackMuted, NOT TrackUnsubscribed — see the remote video handlers.
 */
export async function setCameraEnabled(enabled: boolean): Promise<void> {
  const r = room;
  if (!r || status !== "connected") return;
  if (cameraPending) return;
  cameraPending = true;
  cameraError = null;
  notify();
  try {
    await r.localParticipant.setCameraEnabled(enabled);
    cameraEnabled = r.localParticipant.isCameraEnabled;
  } catch (err) {
    // The call itself is untouched: still connected, mic still published, remote audio still
    // attached. Only the camera failed, and only the camera reports it.
    cameraEnabled = r.localParticipant.isCameraEnabled;
    cameraError =
      err instanceof Error ? err.message : "Couldn't turn the camera on";
  } finally {
    cameraPending = false;
    syncLocalVideoTrack(r);
    notify();
  }
}

/**
 * Mirror the local camera publication into the same identity-keyed map remote cameras use, so
 * self video renders through the identical tile with no second path.
 *
 * Registered explicitly rather than off RoomEvent.LocalTrackPublished because a FIRST publish is
 * not an unmute — only a re-enable after a mute raises TrackUnmuted. Reading the publication
 * after the await covers both, and re-reading `isCameraEnabled` keeps LiveKit authoritative.
 */
function syncLocalVideoTrack(r: Room): void {
  const identity = normalizeIdentity(r.localParticipant.identity) || selfEmail();
  const publication = r.localParticipant.getTrackPublication(Track.Source.Camera);
  const track = publication?.videoTrack;
  if (r.localParticipant.isCameraEnabled && track && !publication?.isMuted) {
    setVideoTrack(identity, track as SpatialVideoTrack);
  } else {
    clearVideoTrack(identity);
  }
}

/**
 * V1 SCREEN SHARE on/off. Shaped exactly like setCameraEnabled above — same connected-call guard,
 * same "LiveKit is the source of truth, the boolean only drives the button", same re-entrancy
 * guard, same "a failure here never touches voice" rule.
 *
 * THIS IS THE WHOLE PUBLISH SIDE. It adds no room, no token, no endpoint and no second call
 * system: a share is one more TRACK SOURCE on the Room this client is already connected to, and
 * the backend's existing grant (can_publish, no source restriction — services/livekit_tokens.py)
 * already allows it, which is why this needed no backend change.
 *
 * AUDIO IS NOT DUPLICATED. `audio: true` asks the browser for the shared surface's audio, which
 * LiveKit publishes as the SEPARATE ScreenShareAudio source; on every subscriber that arrives as
 * an ordinary audio track and is played by the existing hidden-element path (attachRemoteAudio),
 * once. Nothing that renders the VIDEO half may ever unmute its own element.
 *
 * Stopping is either this call with false, or the browser's own "Stop sharing" — livekit-client
 * watches the MediaStreamTrack's `ended` event and unpublishes, so peers see TrackUnsubscribed
 * either way and the local boolean is re-read from LiveKit on the next notify.
 */
export async function setScreenShareEnabled(enabled: boolean): Promise<void> {
  const r = room;
  if (!r || status !== "connected") return;
  if (screenSharePending) return;
  screenSharePending = true;
  screenShareError = null;
  notify();
  try {
    await r.localParticipant.setScreenShareEnabled(enabled, { audio: true });
    screenShareEnabled = r.localParticipant.isScreenShareEnabled;
  } catch (err) {
    // Cancelling the picker rejects — which is a normal user action, not a call failure. The call
    // is untouched: still connected, mic still published, remote audio still attached.
    screenShareEnabled = r.localParticipant.isScreenShareEnabled;
    const message = err instanceof Error ? err.message : "Couldn't share your screen";
    screenShareError = /permission|denied|abort|cancel/i.test(message) ? null : message;
  } finally {
    screenSharePending = false;
    syncLocalScreenShare(r);
    notify();
  }
}

/**
 * Mirror the LOCAL screen-share publication into the same single slot remote shares use, so the
 * presenter's own CAVE shows what everyone else is seeing through one code path.
 *
 * Registered explicitly rather than off RoomEvent.LocalTrackPublished for the same reason
 * syncLocalVideoTrack is: a first publish is not an unmute.
 */
function syncLocalScreenShare(r: Room): void {
  const identity = normalizeIdentity(r.localParticipant.identity) || selfEmail();
  const publication = r.localParticipant.getTrackPublication(Track.Source.ScreenShare);
  const track = publication?.videoTrack;
  if (r.localParticipant.isScreenShareEnabled && track && !publication?.isMuted) {
    setScreenShare(identity, track as SpatialVideoTrack);
  } else {
    clearScreenShareFor(identity);
  }
}

/** Dismiss a screen-share failure without touching the call. */
export function clearScreenShareError(): void {
  if (screenShareError === null) return;
  screenShareError = null;
  notify();
}

/** Dismiss a camera failure banner without touching the call. */
export function clearCameraError(): void {
  if (cameraError === null) return;
  cameraError = null;
  notify();
}

/**
 * Ring someone. Sends ONLY the intent — no walk, no chat panel, no spatial session, no token, no
 * microphone. Everything spatial and media-related waits for the recipient's Accept.
 */
/** Clear whichever slot this invitation occupied. Both are checked because a terminal event fans out
 *  to BOTH parties (see the backend's _emit_meeting_invite_terminal) and each side holds a different one. */
function clearMeetingInvite(inv: { inviteId?: string } | undefined): void {
  if (!inv?.inviteId) return;
  if (incomingMeetingInvite?.inviteId === inv.inviteId) incomingMeetingInvite = null;
  if (outgoingMeetingInvite?.inviteId === inv.inviteId) outgoingMeetingInvite = null;
}

/** PHASE 7D. Offer somebody a MEETING. Intent only — no token, no room, no microphone on either side;
 *  the recipient's own client connects if and when they accept. */
export function sendMeetingInvite(toEmail: string, meetingId: string): void {
  ensureSocket()?.emit("meeting_invite", { toEmail: toEmail.trim().toLowerCase(), meetingId });
}

export function acceptMeetingInvite(): void {
  const inv = incomingMeetingInvite;
  if (!inv) return;
  ensureSocket()?.emit("meeting_invite_accept", { inviteId: inv.inviteId });
}

export function declineMeetingInvite(): void {
  const inv = incomingMeetingInvite;
  if (!inv) return;
  ensureSocket()?.emit("meeting_invite_decline", { inviteId: inv.inviteId });
}

export function cancelMeetingInvite(): void {
  const inv = outgoingMeetingInvite;
  if (!inv) return;
  ensureSocket()?.emit("meeting_invite_cancel", { inviteId: inv.inviteId });
}

export function dismissMeetingInviteOutcome(): void {
  if (!meetingInviteOutcome) return;
  meetingInviteOutcome = null;
  notify();
}

/** The meeting the server says is running under this id, or undefined. THE source for Start vs Join. */
export function meetingFor(snapshot: CallSnapshot, meetingId: string): MeetingEntry | undefined {
  return snapshot.meetings.find((m) => m.meetingId === meetingId);
}

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

/** Open the call socket from OUTSIDE React — exactly what useCallState's effect does on mount.
 *  Without it a non-React consumer subscribes to a store that never hears `spatial_calls`, so it
 *  can see neither the active calls nor anything else the server broadcasts. */
export function ensureCallSocket(): void {
  ensureSocket();
}

/** Subscribe to the snapshot from OUTSIDE React. Exactly the subscription useSyncExternalStore
 *  already uses — exported because the vo3d CAVE is a plain three.js page with no React in it, and
 *  its presentation bridge must read THIS store rather than start a call system of its own. */
export function subscribeToCallState(listener: () => void): () => void {
  return subscribe(listener);
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
  connectedBoardId = null;
  connectedMeetingId = null;
  boardError = null;
  micEnabled = false;
  cameraEnabled = false;
  cameraError = null;
  cameraPending = false;
  screenShareEnabled = false;
  screenShareError = null;
  screenSharePending = false;
  clearScreenShare();
  error = null;
  calls = [];
  outgoing = null;
  incoming = null;
  inviteOutcome = null;
  acceptedPeerEmail = null;
  audioPlaybackBlocked = false;
  detachAllRemoteAudio();
  clearAllVideoTracks();
  devEmail = null;
  notify();
}
