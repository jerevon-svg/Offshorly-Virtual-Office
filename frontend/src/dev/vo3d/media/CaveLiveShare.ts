// vo3d media — THE BRIDGE to the app's existing LiveKit call.
//
// WHAT THIS IS NOT. It is not a call system, a room, a signalling path or a token client. Every one
// of those already exists in services/call/callStore.ts and is used unchanged: the same Room, the
// same /calls/token endpoint, the same socket broadcast, the same eligibility the backend enforces.
// This file's entire job is to answer one question for the CAVE — "is anyone in the call I am in
// sharing their screen, and which track is it?" — and to hand that track to CavePresentation.
//
// WHY THE CAVE NEEDS TO JOIN AT ALL. The V2 world is a SEPARATE dev entry (dev/vo3d.html): its own
// document, its own module graph, no React and no app shell. A browser tab cannot see another tab's
// WebRTC subscriptions, so a CAVE attendee is a real participant of the meeting like everyone else —
// they just render it as a room instead of as tiles. That is what "the CAVE is another VIEW of the
// existing meeting" means in practice, and it is why the store is IMPORTED rather than reimplemented.
//
// LAZY, DELIBERATELY. The import is dynamic and happens on the first connect() — so opening the V2
// page loads no LiveKit SDK, opens no socket, reads no auth token and touches no network until
// somebody explicitly asks to watch the live call. A CAVE nobody is presenting to costs nothing.
import type { PresentationSource } from "./CavePresentation";
import type { GalleryMember } from "./CaveGallery";

type CallStoreModule = typeof import("../../../services/call/callStore");
type Snapshot = ReturnType<CallStoreModule["getCallSnapshot"]>;

/** THE CAVE'S OWN MEETING ROOM. A fixed id, which is the entire discovery mechanism: everyone who
 *  opens the Cave meeting asks the backend for this id and the server hands them all the same room.
 *  No registry, no invite, no second signalling path — and the host may be the only one in it. */
export const CAVE_MEETING_ID = "cave-all-hands";

export type CaveLiveShareState = {
  status: "off" | "connecting" | "connected" | "error";
  /** PHASE 7D. THE MEETING'S state, not this bridge's. It used to be the latter — connect() set it to
   *  "connected" the moment the call store had been IMPORTED, and read() never touched it again — so the
   *  Cave panel showed the in-meeting controls before anybody had joined anything, and went on showing
   *  them after Leave had torn the room down. It is now derived from the call snapshot on every event
   *  (see read), which is the only thing that actually knows. */
  /** the meeting or spatial session this page is connected to, or "" */
  session: string;
  /** what kind of thing `session` names, for the readout */
  kind: "—" | "meeting" | "spatial";
  /** true while THIS page is the one publishing the screen */
  sharing: boolean;
  /** this client's own publications, mirrored from the store for the buttons */
  mic: boolean;
  camera: boolean;
  /** how many live cameras the meeting currently has (local included) */
  cameras: number;
  /** PHASE 7D. HOW MANY PEOPLE are in the room, cameras or not — LiveKit's own membership, via the
   *  store's `participants`. This is the meeting's real head-count and the only one it has: the
   *  server's spatial call registry describes CONVERSATIONS and never sees a meeting join. */
  people: number;
  /** PHASE 7D — IS A MEETING ALREADY RUNNING, read from the SERVER's broadcast rather than from this
   *  client's own room. That distinction is the whole of Start-vs-Join: `people` above is LiveKit's
   *  view and only exists once you are already in, so it can never answer the question you ask before
   *  joining. Independent of `status` — a meeting can be live while this client is not in it. */
  live: boolean;
  /** The current host's email, or "" when no meeting is running. */
  host: string;
  /** True when the host is THIS client. */
  isHost: boolean;
  /** who is sharing right now, or "" */
  presenter: string;
  /** active calls the server is broadcasting, for the dev readout */
  broadcast: string;
  note: string;
};

export type CaveLiveShareDeps = {
  /** Called whenever the room's active share changes — the track, or null when it stops. */
  onShare: (source: PresentationSource | null, presenter: string) => void;
  /** Called whenever the meeting's set of LIVE cameras changes (local and remote in one list, in a
   *  stable order). The store already removes a camera the moment it is muted or unpublished, so
   *  "camera off", "left" and "dropped" all arrive here as the same thing: a shorter list. */
  onCameras: (cameras: GalleryMember[]) => void;
};

export class CaveLiveShare {
  private readonly d: CaveLiveShareDeps;
  private store: CallStoreModule | null = null;
  private unsubscribe: (() => void) | null = null;
  private lastTrack: PresentationSource | null = null;
  private lastCameras: GalleryMember[] = [];
  /** Which meeting this Cave is showing, and who this client is — both needed to read the server's
   *  broadcast, which is keyed by meeting id and reports the host as an email. */
  private meetingId = CAVE_MEETING_ID;
  private selfEmail = "";
  readonly state: CaveLiveShareState = {
    status: "off", kind: "—", sharing: false, mic: false, camera: false, cameras: 0, people: 0,
    live: false, host: "", isHost: false,
    session: "", presenter: "", broadcast: "", note: "",
  };

  constructor(deps: CaveLiveShareDeps) {
    this.d = deps;
  }

  /** Load the existing call store and start listening. Identity is the dev-bypass one the rest of
   *  the local rig uses (callStore.setDevIdentity) — this page has no auth shell of its own. */
  async connect(email: string): Promise<void> {
    if (email) this.selfEmail = email.trim().toLowerCase();
    if (this.store) {
      // Already connected: re-seed the identity (a no-op for the same address — see the store's
      // setDevIdentity, where re-seeding used to drop the socket) and re-read, because connect() is
      // called again every time the Cave panel remounts and must reflect current state.
      if (email) this.store.setDevIdentity(this.selfEmail);
      this.read(this.store.getCallSnapshot());
      return;
    }
    this.state.status = "connecting";
    this.state.note = "";
    try {
      const store = await import("../../../services/call/callStore");
      this.store = store;
      if (email) store.setDevIdentity(this.selfEmail);
      // Open the store's socket: the CAVE has no React, so nothing else would, and without it the
      // page never hears the `spatial_calls` broadcast that tells it which call to join.
      store.ensureCallSocket();
      // One subscription, for the life of the page. Every LiveKit event the app's own UI reacts to
      // lands here too, which is why presenter-stop, presenter-disconnect, track replacement and
      // reconnect need no handling of their own in the CAVE.
      this.unsubscribe = store.subscribeToCallState(() => this.read(store.getCallSnapshot()));
      this.read(store.getCallSnapshot());
    } catch (err) {
      this.state.status = "error";
      this.state.note = err instanceof Error ? err.message : "could not load the call store";
    }
  }

  /**
   * START (or join) THE CAVE'S MEETING. This is the ordinary way in: a host presses it ALONE, the
   * backend mints a token for the standalone meeting room (no head-count rule — see
   * routers/calls.py), and anyone who presses it later lands in the SAME room. It is the existing
   * store, the existing Room and the existing token service; nothing here is CAVE-specific except
   * the meeting id.
   */
  async startMeeting(meetingId: string = CAVE_MEETING_ID): Promise<void> {
    const store = this.store;
    if (!store) { this.state.note = "connect() first"; return; }
    this.meetingId = meetingId;
    this.state.note = "";
    try {
      await store.startOrJoinMeeting(meetingId);
    } catch (err) {
      this.state.status = "error";
      this.state.note = err instanceof Error ? err.message : "could not start the meeting";
    }
  }

  /** Mic on/off for THIS client — straight through to the store, which is the source of truth.
   *  A meeting's audio is LiveKit's; nothing in the CAVE plays or mutes it. */
  async setMic(on: boolean): Promise<void> {
    const store = this.store;
    if (!store) return;
    await store.setMicEnabled(on);
    this.state.mic = store.getCallSnapshot().micEnabled;
  }

  /** Camera on/off for THIS client. A refusal (no device, permission denied) lands in the store's
   *  own cameraError and leaves the meeting — and any running screen share — untouched. */
  async setCamera(on: boolean): Promise<void> {
    const store = this.store;
    if (!store) return;
    await store.setCameraEnabled(on);
    const snap = store.getCallSnapshot();
    this.state.camera = snap.cameraEnabled;
    if (snap.cameraError) this.state.note = snap.cameraError;
  }

  /**
   * Publish (or stop publishing) THIS browser's screen into the meeting that is already connected.
   * Straight through to the store's setScreenShareEnabled — the same function the app's Share
   * button calls. There is no local-preview path: what the CAVE shows is what the meeting carries,
   * so anyone who joins later sees the same thing.
   */
  async setSharing(on: boolean): Promise<void> {
    const store = this.store;
    if (!store) { this.state.note = "connect() first"; return; }
    if (store.getCallSnapshot().status !== "connected") {
      this.state.note = "start the meeting first, then share";
      return;
    }
    await store.setScreenShareEnabled(on);
    const snap = store.getCallSnapshot();
    this.state.sharing = snap.screenShareEnabled;
    if (snap.screenShareError) this.state.note = snap.screenShareError;
  }

  /** Join the live SPATIAL call the server is broadcasting — kept for A/B testing against the
   *  app's own conversation calls. With no argument it auto-picks the broadcast session. */
  async join(sessionId?: string): Promise<void> {
    const store = this.store;
    if (!store) { this.state.note = "connect() first"; return; }
    const snap = store.getCallSnapshot();
    const id = sessionId ?? snap.calls.find((c) => c.participants.length > 0)?.sessionId ?? snap.calls[0]?.sessionId;
    if (!id) { this.state.note = "no live call is being broadcast yet"; return; }
    this.state.note = "";
    try {
      await store.startOrJoinCall(id);
    } catch (err) {
      this.state.status = "error";
      this.state.note = err instanceof Error ? err.message : "could not join the call";
    }
  }

  /** PHASE 7D — offer somebody this meeting. Intent only: no token, no room, no microphone on either
   *  side. Deliberately the MEETING invitation, never the spatial ring, which invites somebody to a
   *  conversation between two avatars rather than into a room. */
  invite(toEmail: string): void {
    this.store?.sendMeetingInvite(toEmail, this.meetingId);
  }

  /** Leave the media call — and NOTHING else, exactly as the app's own Leave does. */
  leave(): void {
    this.store?.leaveCall();
  }

  /** THE ONE REACTION. A snapshot arrives, the share slot is read, and the CAVE is told only when
   *  the TRACK IDENTITY actually changed — so a mute, a roster update or a camera toggle in the
   *  call does not churn the element or the texture. Track REPLACEMENT (a presenter re-sharing a
   *  different window) is a new track object, so it correctly reads as a change. */
  private read(snap: Snapshot): void {
    // CAMERAS. Sorted by identity so tiles keep their place when somebody else joins or leaves —
    // a gallery that reshuffles on every event is unreadable. The store has already filtered this
    // to LIVE, unmuted cameras, local included.
    // PHASE 7D — THE GALLERY IS THE ROOM, NOT THE CAMERAS. Membership comes from `participants`
    // (LiveKit's own view of who is connected, self included) and a camera is attached to a member
    // when they have one. A meeting where nobody has a camera on therefore still draws a gallery of
    // people, instead of falling back to the boxing video while three of them sit talking in it.
    //
    // Sorted by identity so tiles keep their place when somebody else joins, leaves, or turns a
    // camera on — a wall that reshuffles on every event is unreadable.
    const cameras: GalleryMember[] = [...snap.participants]
      .sort((a, b) => a.localeCompare(b))
      .map((identity) => {
        const track = snap.videoByIdentity[identity] as unknown as PresentationSource | undefined;
        return track ? { identity, track } : { identity };
      });
    // `cameras` on the state stays what it says: how many of them actually have a picture.
    this.state.cameras = cameras.filter((c) => c.track).length;
    this.state.people = snap.participants.length;
    this.state.mic = snap.micEnabled;
    this.state.camera = snap.cameraEnabled;
    if (!sameCameraList(this.lastCameras, cameras)) {
      this.lastCameras = cameras;
      this.d.onCameras(cameras);
    }
    // THE MEETING'S OWN STATUS. Only a MEETING connection counts: somebody standing in the Cave who is in
    // a spatial conversation call is not in the Cave's meeting, and offering them "Leave meeting" would
    // be a button about somebody else's call. A failure to connect leaves the store's error in `note`
    // below and the panel back at its Start state, which is the truth — there is no room to leave.
    const meeting = snap.connectedMeetingId !== null;
    this.state.status = meeting
      ? snap.status === "connected"
        ? "connected"
        : snap.status === "connecting"
          ? "connecting"
          : "off"
      : snap.status === "error"
        ? "error"
        : "off";
    this.state.session = snap.connectedMeetingId ?? snap.connectedSessionId ?? "";
    this.state.kind = snap.connectedMeetingId ? "meeting" : snap.connectedSessionId ? "spatial" : "—";
    this.state.sharing = snap.screenShareEnabled;
    this.state.broadcast = snap.calls.map((c) => `${c.sessionId.slice(0, 8)}…(${c.participants.length})`).join(", ");
    // THE SERVER'S VIEW OF THE MEETING, which is the only one that exists before this client joins.
    const broadcastMeeting = snap.meetings.find((m) => m.meetingId === this.meetingId);
    this.state.live = Boolean(broadcastMeeting && broadcastMeeting.participants.length > 0);
    this.state.host = broadcastMeeting?.host ?? "";
    this.state.isHost = Boolean(broadcastMeeting?.host && broadcastMeeting.host === this.selfEmail);
    if (snap.status === "error" && snap.error) { this.state.note = snap.error; }
    const share = snap.screenShare;
    const track = (share?.track as PresentationSource | undefined) ?? null;
    this.state.presenter = share?.identity ?? "";
    if (track === this.lastTrack) return;
    this.lastTrack = track;
    this.d.onShare(track, share?.identity ?? "");
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.lastTrack = null;
    this.state.status = "off";
  }
}

/** Identity AND track object must match: a participant who turns their camera off and on again
 *  publishes a NEW track, and the gallery has to re-attach to it. */
function sameCameraList(a: GalleryMember[], b: GalleryMember[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((c, i) => c.identity === b[i].identity && c.track === b[i].track);
}
