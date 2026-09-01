import { beforeEach, describe, expect, it, vi } from "vitest";

// --- fakes -------------------------------------------------------------------------------

class FakeSocket {
  handlers = new Map<string, Array<(...a: unknown[]) => void>>();
  emitted: Array<{ event: string; payload: unknown }> = [];
  on(event: string, cb: (...a: unknown[]) => void) {
    const l = this.handlers.get(event) ?? [];
    l.push(cb);
    this.handlers.set(event, l);
    return this;
  }
  emit(event: string, payload?: unknown) {
    this.emitted.push({ event, payload });
    return this;
  }
  disconnect() {
    return this;
  }
  trigger(event: string, payload?: unknown) {
    for (const cb of this.handlers.get(event) ?? []) cb(payload);
  }
  events() {
    return this.emitted.map((e) => e.event);
  }
}

let lastSocket: FakeSocket | null = null;

class FakeRoom {
  static instances: FakeRoom[] = [];
  static connectImpl: (() => Promise<void>) | null = null;
  handlers = new Map<string, Array<(...a: unknown[]) => void>>();
  connected = false;
  disconnectCalls = 0;
  removeAllCalls = 0;
  micCalls: boolean[] = [];
  canPlaybackAudio = true;
  startAudioCalls = 0;
  localParticipant = {
    isMicrophoneEnabled: false,
    setMicrophoneEnabled: async (on: boolean) => {
      this.micCalls.push(on);
      this.localParticipant.isMicrophoneEnabled = on;
    },
  };
  constructor() {
    FakeRoom.instances.push(this);
  }
  on(event: string, cb: (...a: unknown[]) => void) {
    const l = this.handlers.get(event) ?? [];
    l.push(cb);
    this.handlers.set(event, l);
    return this;
  }
  removeAllListeners() {
    this.removeAllCalls += 1;
    this.handlers.clear();
    return this;
  }
  async connect() {
    if (FakeRoom.connectImpl) await FakeRoom.connectImpl();
    this.connected = true;
  }
  async disconnect() {
    this.disconnectCalls += 1;
    this.connected = false;
  }
  async startAudio() {
    this.startAudioCalls += 1;
    this.canPlaybackAudio = true;
  }
  fire(event: string, ...args: unknown[]) {
    for (const cb of this.handlers.get(event) ?? []) cb(...args);
  }
  trigger(event: string) {
    for (const cb of this.handlers.get(event) ?? []) cb();
  }
}

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => {
    lastSocket = new FakeSocket();
    return lastSocket;
  }),
}));

vi.mock("livekit-client", () => ({
  Room: FakeRoom,
  RoomEvent: {
    Disconnected: "disconnected",
    ParticipantConnected: "participantConnected",
    ParticipantDisconnected: "participantDisconnected",
    TrackSubscribed: "trackSubscribed",
    TrackUnsubscribed: "trackUnsubscribed",
    AudioPlaybackStatusChanged: "audioPlaybackStatusChanged",
  },
  Track: { Kind: { Audio: "audio", Video: "video" }, Source: { Microphone: "microphone" } },
}));

/** Minimal stand-in for a subscribed RemoteAudioTrack: attach() hands back an element. */
function fakeRemoteAudio(sid: string, kind = "audio") {
  const el = document.createElement("audio");
  const track = {
    kind,
    attachCalls: 0,
    detachCalls: 0,
    attach() {
      this.attachCalls += 1;
      return el;
    },
    detach() {
      this.detachCalls += 1;
      return el;
    },
  };
  return { track, publication: { trackSid: sid }, el };
}

vi.mock("../api/client", () => ({ getAuthToken: vi.fn(() => "fake-token") }));

let currentUserEmail: string | null = null;
vi.mock("../../auth/currentUserStore", () => ({
  getCurrentUser: () => (currentUserEmail ? { email: currentUserEmail } : null),
}));

const TOKEN_RESPONSE = {
  url: "wss://test.livekit.example",
  token: "jwt-abc",
  room: "vo-call-opaque123",
  identity: "a@example.com",
};

/** Holds Room.connect() open, and tells the test when it has actually been entered. */
function gateConnect() {
  let entered: () => void;
  const enteredPromise = new Promise<void>((r) => { entered = r; });
  let release: () => void;
  const releasePromise = new Promise<void>((r) => { release = r; });
  FakeRoom.connectImpl = () => { entered!(); return releasePromise; };
  return { entered: enteredPromise, release: () => release!() };
}

function mockTokenFetch(response: unknown = TOKEN_RESPONSE, ok = true, status = 200) {
  const fn = vi.fn(async () => ({ ok, status, json: async () => response }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = "";
  currentUserEmail = null;
  lastSocket = null;
  FakeRoom.instances = [];
  FakeRoom.connectImpl = null;
  (import.meta.env as Record<string, string>).VITE_CHAT_SOCKET_URL = "http://localhost:4800";
  mockTokenFetch();
});

// --- start / join ------------------------------------------------------------------------

describe("callStore start/join", () => {
  it("requests a token with only the sessionId, then connects and publishes the microphone", async () => {
    const fetchFn = mockTokenFetch();
    const { startOrJoinCall, getCallSnapshot } = await import("./callStore");

    await startOrJoinCall("conv-1");

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:4800/calls/token");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ sessionId: "conv-1" });

    expect(FakeRoom.instances).toHaveLength(1);
    expect(FakeRoom.instances[0].connected).toBe(true);
    // Voice only: the microphone is enabled exactly once and nothing else is published.
    expect(FakeRoom.instances[0].micCalls).toEqual([true]);

    const snap = getCallSnapshot();
    expect(snap.status).toBe("connected");
    expect(snap.connectedSessionId).toBe("conv-1");
    expect(snap.micEnabled).toBe(true);
  });

  it("announces call_joined only AFTER the media connection succeeds", async () => {
    const gate = gateConnect();
    const { startOrJoinCall, getCallSnapshot } = await import("./callStore");

    const pending = startOrJoinCall("conv-1");
    await gate.entered;
    expect(getCallSnapshot().status).toBe("connecting");
    // Mid-handshake: nothing announced yet (no socket has even been opened).
    expect(lastSocket?.events() ?? []).not.toContain("call_joined");

    gate.release();
    await pending;
    expect(lastSocket!.emitted).toEqual([
      { event: "call_joined", payload: { sessionId: "conv-1" } },
    ]);
  });

  it("never emits any spatial_session event when starting a call", async () => {
    const { startOrJoinCall } = await import("./callStore");
    await startOrJoinCall("conv-1");
    expect(lastSocket!.events().some((e) => e.startsWith("spatial_session"))).toBe(false);
  });

  it("is idempotent for the same session: no second Room, no double microphone publish", async () => {
    const { startOrJoinCall } = await import("./callStore");
    await startOrJoinCall("conv-1");
    await startOrJoinCall("conv-1");

    expect(FakeRoom.instances).toHaveLength(1);
    expect(FakeRoom.instances[0].micCalls).toEqual([true]);
    expect(lastSocket!.events().filter((e) => e === "call_joined")).toHaveLength(1);
  });

  it("ignores an empty sessionId", async () => {
    const { startOrJoinCall, getCallSnapshot } = await import("./callStore");
    await startOrJoinCall("");
    expect(FakeRoom.instances).toHaveLength(0);
    expect(getCallSnapshot().status).toBe("idle");
  });

  it("surfaces a token rejection as an error and leaves no Room behind", async () => {
    mockTokenFetch({ error: "Not a member of this spatial session" }, false, 403);
    const { startOrJoinCall, getCallSnapshot } = await import("./callStore");

    await startOrJoinCall("conv-1");

    const snap = getCallSnapshot();
    expect(snap.status).toBe("error");
    expect(snap.error).toBe("Not a member of this spatial session");
    expect(snap.connectedSessionId).toBeNull();
    expect(FakeRoom.instances).toHaveLength(0);
  });

  it("allows a clean retry after an error", async () => {
    mockTokenFetch({ error: "boom" }, false, 500);
    const { startOrJoinCall, getCallSnapshot } = await import("./callStore");
    await startOrJoinCall("conv-1");
    expect(getCallSnapshot().status).toBe("error");

    mockTokenFetch();
    await startOrJoinCall("conv-1");
    expect(getCallSnapshot().status).toBe("connected");
    expect(FakeRoom.instances).toHaveLength(1);
  });
});

// --- leave -------------------------------------------------------------------------------

describe("callStore leave", () => {
  it("disconnects the Room, clears media state and stays out of the spatial session", async () => {
    const { startOrJoinCall, leaveCall, getCallSnapshot } = await import("./callStore");
    await startOrJoinCall("conv-1");
    const room = FakeRoom.instances[0];

    leaveCall();

    expect(room.disconnectCalls).toBe(1);
    expect(room.removeAllCalls).toBeGreaterThan(0);
    const snap = getCallSnapshot();
    expect(snap.status).toBe("idle");
    expect(snap.connectedSessionId).toBeNull();
    expect(snap.micEnabled).toBe(false);

    // THE CORE GUARANTEE: leaving media must not leave the spatial conversation.
    expect(lastSocket!.events()).toContain("call_left");
    expect(lastSocket!.events().some((e) => e.startsWith("spatial_session"))).toBe(false);
  });

  it("does not resurrect a call when Leave is clicked mid-connect", async () => {
    const gate = gateConnect();
    const { startOrJoinCall, leaveCall, getCallSnapshot } = await import("./callStore");

    const pending = startOrJoinCall("conv-1");
    await gate.entered;
    expect(getCallSnapshot().status).toBe("connecting");

    leaveCall();
    gate.release();
    await pending;

    expect(getCallSnapshot().status).toBe("idle");
    expect(getCallSnapshot().connectedSessionId).toBeNull();
    // The room that finished connecting late is torn down, and the mic is never published.
    expect(FakeRoom.instances[0].disconnectCalls).toBeGreaterThan(0);
    expect(FakeRoom.instances[0].micCalls).toEqual([]);
    expect(lastSocket!.events()).not.toContain("call_joined");
  });

  it("allows rejoining cleanly after leaving", async () => {
    const { startOrJoinCall, leaveCall, getCallSnapshot } = await import("./callStore");
    await startOrJoinCall("conv-1");
    leaveCall();
    await startOrJoinCall("conv-1");

    expect(getCallSnapshot().status).toBe("connected");
    expect(FakeRoom.instances).toHaveLength(2); // a fresh Room, not a reused one
    expect(FakeRoom.instances[1].micCalls).toEqual([true]);
  });

  it("treats a LiveKit-side disconnect as leaving media, not leaving the conversation", async () => {
    const { startOrJoinCall, getCallSnapshot } = await import("./callStore");
    await startOrJoinCall("conv-1");

    FakeRoom.instances[0].trigger("disconnected");

    expect(getCallSnapshot().status).toBe("idle");
    expect(lastSocket!.events()).toContain("call_left");
    expect(lastSocket!.events().some((e) => e.startsWith("spatial_session"))).toBe(false);
  });
});

// --- mute --------------------------------------------------------------------------------

describe("callStore microphone", () => {
  it("mutes and unmutes through LiveKit", async () => {
    const { startOrJoinCall, setMicEnabled, getCallSnapshot } = await import("./callStore");
    await startOrJoinCall("conv-1");

    await setMicEnabled(false);
    expect(getCallSnapshot().micEnabled).toBe(false);
    await setMicEnabled(true);
    expect(getCallSnapshot().micEnabled).toBe(true);
    expect(FakeRoom.instances[0].micCalls).toEqual([true, false, true]);
  });

  it("is a no-op when not connected", async () => {
    const { setMicEnabled, getCallSnapshot } = await import("./callStore");
    await setMicEnabled(true);
    expect(getCallSnapshot().micEnabled).toBe(false);
  });
});

// --- server-broadcast call state ---------------------------------------------------------

describe("callStore active-call awareness", () => {
  it("tracks the spatial_calls broadcast and exposes participants per session", async () => {
    const { startOrJoinCall, getCallSnapshot, callParticipantsFor } = await import("./callStore");
    await startOrJoinCall("conv-1"); // opens the socket

    lastSocket!.trigger("spatial_calls", {
      calls: [{ sessionId: "conv-1", room: "vo-call-x", participants: ["a@example.com"] }],
    });

    const snap = getCallSnapshot();
    expect(callParticipantsFor(snap, "conv-1")).toEqual(["a@example.com"]);
    expect(callParticipantsFor(snap, "conv-other")).toEqual([]);
    expect(callParticipantsFor(snap, null)).toEqual([]);
  });

  it("re-asserts an active media claim on socket reconnect", async () => {
    const { startOrJoinCall } = await import("./callStore");
    await startOrJoinCall("conv-1");
    lastSocket!.emitted.length = 0;

    lastSocket!.trigger("connect");

    expect(lastSocket!.emitted).toEqual([
      { event: "call_joined", payload: { sessionId: "conv-1" } },
    ]);
  });

  it("does not re-assert after an explicit leave", async () => {
    const { startOrJoinCall, leaveCall } = await import("./callStore");
    await startOrJoinCall("conv-1");
    leaveCall();
    lastSocket!.emitted.length = 0;

    lastSocket!.trigger("connect");

    expect(lastSocket!.emitted).toEqual([]);
  });

  it("isConnectedToMedia is true only while genuinely connected (drives IN_CALL)", async () => {
    const { startOrJoinCall, leaveCall, getCallSnapshot, isConnectedToMedia } = await import(
      "./callStore"
    );
    expect(isConnectedToMedia(getCallSnapshot())).toBe(false);
    await startOrJoinCall("conv-1");
    expect(isConnectedToMedia(getCallSnapshot())).toBe(true);
    leaveCall();
    expect(isConnectedToMedia(getCallSnapshot())).toBe(false);
  });

});

// --- ringing (call invites) ---------------------------------------------------------------

describe("callStore call invites", () => {
  async function ringing() {
    currentUserEmail = "a@example.com";
    const m = await import("./callStore");
    m.sendCallInvite("b@example.com"); // opens the socket
    lastSocket!.trigger("call_invite_ringing", {
      inviteId: "inv-1",
      fromEmail: "a@example.com",
      toEmail: "b@example.com",
    });
    return m;
  }

  it("sendCallInvite emits intent ONLY — no token request, no Room, no microphone", async () => {
    const fetchFn = mockTokenFetch();
    const { sendCallInvite, getCallSnapshot } = await import("./callStore");

    sendCallInvite("B@Example.com");

    expect(lastSocket!.emitted).toEqual([
      { event: "call_invite", payload: { toEmail: "b@example.com" } },
    ]);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(FakeRoom.instances).toHaveLength(0);
    expect(getCallSnapshot().status).toBe("idle");
  });

  it("ignores an empty target", async () => {
    const { sendCallInvite } = await import("./callStore");
    sendCallInvite("");
    expect(lastSocket).toBeNull();
  });

  it("records an outgoing ring from call_invite_ringing", async () => {
    const { getCallSnapshot } = await ringing();
    expect(getCallSnapshot().outgoing).toEqual({
      inviteId: "inv-1",
      fromEmail: "a@example.com",
      toEmail: "b@example.com",
    });
    expect(getCallSnapshot().incoming).toBeNull();
  });

  it("records an incoming ring with no spatial session or chat involved", async () => {
    const { sendCallInvite, getCallSnapshot } = await import("./callStore");
    sendCallInvite("x@example.com"); // just to open the socket
    lastSocket!.trigger("call_invite_incoming", {
      inviteId: "inv-2",
      fromEmail: "c@example.com",
      toEmail: "a@example.com",
    });
    expect(getCallSnapshot().incoming?.fromEmail).toBe("c@example.com");
  });

  it("no token is requested while merely ringing, in either direction", async () => {
    const fetchFn = mockTokenFetch();
    const { sendCallInvite } = await import("./callStore");
    sendCallInvite("b@example.com");
    lastSocket!.trigger("call_invite_ringing", { inviteId: "i", fromEmail: "a@x.com", toEmail: "b@x.com" });
    lastSocket!.trigger("call_invite_incoming", { inviteId: "j", fromEmail: "c@x.com", toEmail: "a@x.com" });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(FakeRoom.instances).toHaveLength(0);
  });

  it("accept emits the acceptance and surfaces the peer for the spatial handoff", async () => {
    currentUserEmail = "a@example.com"; // this client is the recipient
    const { sendCallInvite, acceptCallInvite, getCallSnapshot } = await import("./callStore");
    sendCallInvite("x@example.com");
    lastSocket!.trigger("call_invite_incoming", {
      inviteId: "inv-3",
      fromEmail: "c@example.com",
      toEmail: "a@example.com",
    });
    lastSocket!.emitted.length = 0;

    acceptCallInvite();
    expect(lastSocket!.emitted).toEqual([
      { event: "call_invite_accept", payload: { inviteId: "inv-3" } },
    ]);

    // The server's accepted broadcast is what hands the peer to OfficeMap.
    lastSocket!.trigger("call_invite_accepted", {
      inviteId: "inv-3",
      fromEmail: "c@example.com",
      toEmail: "a@example.com",
    });
    const snap = getCallSnapshot();
    expect(snap.acceptedPeerEmail).toBe("c@example.com");
    expect(snap.incoming).toBeNull();
    // Accept alone must not start media — that is the eligibility-gated path's job.
    expect(FakeRoom.instances).toHaveLength(0);
  });

  it("clearAcceptedPeer makes the handoff single-shot", async () => {
    currentUserEmail = "a@example.com"; // this client is the caller
    const { sendCallInvite, clearAcceptedPeer, getCallSnapshot } = await import("./callStore");
    sendCallInvite("b@example.com");
    lastSocket!.trigger("call_invite_accepted", {
      inviteId: "inv-4",
      fromEmail: "a@example.com",
      toEmail: "b@example.com",
    });
    expect(getCallSnapshot().acceptedPeerEmail).toBe("b@example.com");
    clearAcceptedPeer();
    expect(getCallSnapshot().acceptedPeerEmail).toBeNull();
  });

  it("decline clears the incoming ring and emits, with no media", async () => {
    const { sendCallInvite, declineCallInvite, getCallSnapshot } = await import("./callStore");
    sendCallInvite("x@example.com");
    lastSocket!.trigger("call_invite_incoming", {
      inviteId: "inv-5",
      fromEmail: "c@example.com",
      toEmail: "a@example.com",
    });
    lastSocket!.emitted.length = 0;

    declineCallInvite();

    expect(lastSocket!.emitted).toEqual([
      { event: "call_invite_decline", payload: { inviteId: "inv-5" } },
    ]);
    expect(getCallSnapshot().incoming).toBeNull();
    expect(FakeRoom.instances).toHaveLength(0);
  });

  it("cancel clears the outgoing ring and emits", async () => {
    const { cancelCallInvite, getCallSnapshot } = await ringing();
    lastSocket!.emitted.length = 0;

    cancelCallInvite();

    expect(lastSocket!.emitted).toEqual([
      { event: "call_invite_cancel", payload: { inviteId: "inv-1" } },
    ]);
    expect(getCallSnapshot().outgoing).toBeNull();
  });

  it("a decline the caller receives becomes a visible outcome", async () => {
    const { getCallSnapshot } = await ringing();
    lastSocket!.trigger("call_invite_declined", {
      inviteId: "inv-1",
      fromEmail: "a@example.com",
      toEmail: "b@example.com",
      reason: "declined",
    });
    expect(getCallSnapshot().outgoing).toBeNull();
    expect(getCallSnapshot().inviteOutcome).toMatchObject({ kind: "declined", peerEmail: "b@example.com" });
  });

  it("a TTL timeout is reported as timeout, not a plain cancel", async () => {
    const { getCallSnapshot } = await ringing();
    lastSocket!.trigger("call_invite_cancelled", {
      inviteId: "inv-1",
      fromEmail: "a@example.com",
      toEmail: "b@example.com",
      reason: "timeout",
    });
    expect(getCallSnapshot().inviteOutcome?.kind).toBe("timeout");
  });

  it("a recipient who declined gets no leftover banner", async () => {
    const { sendCallInvite, getCallSnapshot } = await import("./callStore");
    sendCallInvite("x@example.com");
    lastSocket!.trigger("call_invite_incoming", {
      inviteId: "inv-6",
      fromEmail: "c@example.com",
      toEmail: "a@example.com",
    });
    lastSocket!.trigger("call_invite_declined", {
      inviteId: "inv-6",
      fromEmail: "c@example.com",
      toEmail: "a@example.com",
    });
    expect(getCallSnapshot().incoming).toBeNull();
    expect(getCallSnapshot().inviteOutcome).toBeNull();
  });

  it("a terminal event for an unknown invite is ignored", async () => {
    const { getCallSnapshot } = await ringing();
    lastSocket!.trigger("call_invite_cancelled", {
      inviteId: "someone-elses",
      fromEmail: "y@x.com",
      toEmail: "z@x.com",
    });
    expect(getCallSnapshot().outgoing?.inviteId).toBe("inv-1");
  });

  it("surfaces offline/dnd/busy rejections to the caller", async () => {
    const { sendCallInvite, getCallSnapshot } = await import("./callStore");
    for (const reason of ["offline", "dnd", "busy"]) {
      sendCallInvite("b@example.com");
      lastSocket!.trigger("call_invite_failed", { toEmail: "b@example.com", reason });
      expect(getCallSnapshot().inviteOutcome).toMatchObject({ kind: "failed", reason });
      expect(getCallSnapshot().outgoing).toBeNull();
    }
  });

  it("dismissInviteOutcome clears the banner", async () => {
    const { sendCallInvite, dismissInviteOutcome, getCallSnapshot } = await import("./callStore");
    sendCallInvite("b@example.com");
    lastSocket!.trigger("call_invite_failed", { toEmail: "b@example.com", reason: "offline" });
    dismissInviteOutcome();
    expect(getCallSnapshot().inviteOutcome).toBeNull();
  });

  it("restores a pending ring from the reconnect snapshot", async () => {
    currentUserEmail = "a@example.com";
    const { sendCallInvite, getCallSnapshot } = await import("./callStore");
    sendCallInvite("b@example.com");

    lastSocket!.trigger("call_invites", {
      invites: [
        { inviteId: "out-1", fromEmail: "a@example.com", toEmail: "b@example.com" },
        { inviteId: "in-1", fromEmail: "c@example.com", toEmail: "a@example.com" },
      ],
    });

    expect(getCallSnapshot().outgoing?.inviteId).toBe("out-1");
    expect(getCallSnapshot().incoming?.inviteId).toBe("in-1");
  });

  it("an empty reconnect snapshot clears stale ringing UI", async () => {
    const { getCallSnapshot } = await ringing();
    lastSocket!.trigger("call_invites", { invites: [] });
    expect(getCallSnapshot().outgoing).toBeNull();
    expect(getCallSnapshot().incoming).toBeNull();
  });

  it("ringing does not disturb the existing active-call Join state", async () => {
    const { sendCallInvite, callParticipantsFor, getCallSnapshot } = await import("./callStore");
    sendCallInvite("b@example.com");
    lastSocket!.trigger("spatial_calls", {
      calls: [{ sessionId: "conv-1", room: "vo-call-x", participants: ["z@example.com"] }],
    });
    lastSocket!.trigger("call_invite_ringing", { inviteId: "i", fromEmail: "a@x.com", toEmail: "b@x.com" });

    expect(callParticipantsFor(getCallSnapshot(), "conv-1")).toEqual(["z@example.com"]);
  });
});

// --- remote audio playback ----------------------------------------------------------------

describe("callStore remote audio playback", () => {
  it("attaches a subscribed remote audio track into the DOM so it is actually audible", async () => {
    const { startOrJoinCall } = await import("./callStore");
    await startOrJoinCall("conv-1");
    const room = FakeRoom.instances[0];
    const { track, publication, el } = fakeRemoteAudio("sid-remote-1");

    room.fire("trackSubscribed", track, publication);

    expect(track.attachCalls).toBe(1);
    expect(el.dataset.livekitRemoteAudio).toBe("sid-remote-1");
    // In the document — Chrome will not start playback for a detached element.
    expect(document.body.contains(el)).toBe(true);
    expect(document.querySelectorAll("[data-livekit-remote-audio]")).toHaveLength(1);
  });

  it("ignores a video track (Stage A is voice only)", async () => {
    const { startOrJoinCall } = await import("./callStore");
    await startOrJoinCall("conv-1");
    const { track, publication } = fakeRemoteAudio("sid-vid", "video");

    FakeRoom.instances[0].fire("trackSubscribed", track, publication);

    expect(track.attachCalls).toBe(0);
    expect(document.querySelectorAll("[data-livekit-remote-audio]")).toHaveLength(0);
  });

  it("does not double-attach the same track", async () => {
    const { startOrJoinCall } = await import("./callStore");
    await startOrJoinCall("conv-1");
    const room = FakeRoom.instances[0];
    const { track, publication } = fakeRemoteAudio("sid-dupe");

    room.fire("trackSubscribed", track, publication);
    room.fire("trackSubscribed", track, publication);

    expect(track.attachCalls).toBe(1);
    expect(document.querySelectorAll("[data-livekit-remote-audio]")).toHaveLength(1);
  });

  it("detaches and removes the element on unsubscribe", async () => {
    const { startOrJoinCall } = await import("./callStore");
    await startOrJoinCall("conv-1");
    const room = FakeRoom.instances[0];
    const { track, publication, el } = fakeRemoteAudio("sid-bye");
    room.fire("trackSubscribed", track, publication);

    room.fire("trackUnsubscribed", track, publication);

    expect(track.detachCalls).toBe(1);
    expect(document.body.contains(el)).toBe(false);
    expect(document.querySelectorAll("[data-livekit-remote-audio]")).toHaveLength(0);
  });

  it("removes every attached element on leave, leaving no stray audio", async () => {
    const { startOrJoinCall, leaveCall } = await import("./callStore");
    await startOrJoinCall("conv-1");
    const room = FakeRoom.instances[0];
    for (const sid of ["s1", "s2"]) {
      const { track, publication } = fakeRemoteAudio(sid);
      room.fire("trackSubscribed", track, publication);
    }
    expect(document.querySelectorAll("[data-livekit-remote-audio]").length).toBeGreaterThan(0);

    leaveCall();

    expect(document.querySelectorAll("[data-livekit-remote-audio]")).toHaveLength(0);
  });

  it("reports autoplay blocking instead of failing silently", async () => {
    const { startOrJoinCall, getCallSnapshot } = await import("./callStore");
    await startOrJoinCall("conv-1");
    expect(getCallSnapshot().audioPlaybackBlocked).toBe(false);

    const room = FakeRoom.instances[0];
    room.canPlaybackAudio = false;
    room.fire("audioPlaybackStatusChanged");

    expect(getCallSnapshot().audioPlaybackBlocked).toBe(true);
  });

  it("resumeAudioPlayback calls startAudio and clears the blocked flag", async () => {
    const { startOrJoinCall, resumeAudioPlayback, getCallSnapshot } = await import("./callStore");
    await startOrJoinCall("conv-1");
    const room = FakeRoom.instances[0];
    room.canPlaybackAudio = false;
    room.fire("audioPlaybackStatusChanged");

    await resumeAudioPlayback();

    expect(room.startAudioCalls).toBe(1);
    expect(getCallSnapshot().audioPlaybackBlocked).toBe(false);
  });

  it("attaching remote audio creates no extra Room, token request, or mic publish", async () => {
    const fetchFn = mockTokenFetch();
    const { startOrJoinCall } = await import("./callStore");
    await startOrJoinCall("conv-1");
    const room = FakeRoom.instances[0];
    const { track, publication } = fakeRemoteAudio("sid-x");

    room.fire("trackSubscribed", track, publication);

    expect(FakeRoom.instances).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledTimes(1); // the original join only
    expect(room.micCalls).toEqual([true]); // no second publish
  });

  it("the dev diagnostics accessor exposes the Room only in dev and never after leave", async () => {
    const { startOrJoinCall, leaveCall, getRoomForDevDiagnostics } = await import("./callStore");
    expect(getRoomForDevDiagnostics()).toBeNull();
    await startOrJoinCall("conv-1");
    expect(getRoomForDevDiagnostics()).not.toBeNull();
    leaveCall();
    expect(getRoomForDevDiagnostics()).toBeNull();
  });
});

// --- authentication ----------------------------------------------------------------------

describe("callStore /calls/token authentication", () => {
  it("attaches the app's existing Atlas bearer token", async () => {
    const fetchFn = mockTokenFetch();
    const { startOrJoinCall } = await import("./callStore");

    await startOrJoinCall("conv-1");

    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer fake-token");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("never puts an identity in the request body — the server derives it", async () => {
    const fetchFn = mockTokenFetch();
    const { startOrJoinCall } = await import("./callStore");

    await startOrJoinCall("conv-1");

    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ sessionId: "conv-1" });
  });

  it("uses the seeded dev identity header instead of a bearer token when set", async () => {
    const fetchFn = mockTokenFetch();
    const { startOrJoinCall, setDevIdentity } = await import("./callStore");

    setDevIdentity("Dev@Example.com");
    await startOrJoinCall("conv-1");

    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("x-dev-email")).toBe("dev@example.com");
    expect(headers.get("Authorization")).toBeNull();
  });

  it("falls back to the app's resolved identity under the dev auth-gate bypass", async () => {
    // Reproduces the live failure: dev bypass means there is NO token in localStorage, and
    // setDevIdentity had not been seeded for this module.
    vi.doMock("../api/client", () => ({ getAuthToken: vi.fn(() => null) }));
    (import.meta.env as Record<string, unknown>).VITE_AUTH_GATE = "off";
    currentUserEmail = "Bon@Offshorly.com";
    const fetchFn = mockTokenFetch();
    const { startOrJoinCall, getCallSnapshot } = await import("./callStore");

    await startOrJoinCall("conv-1");

    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("x-dev-email")).toBe("bon@offshorly.com");
    expect(getCallSnapshot().status).toBe("connected");
    delete (import.meta.env as Record<string, unknown>).VITE_AUTH_GATE;
  });

  it("fails without sending an unauthenticated request when there are no credentials", async () => {
    vi.doMock("../api/client", () => ({ getAuthToken: vi.fn(() => null) }));
    const fetchFn = mockTokenFetch();
    const { startOrJoinCall, getCallSnapshot } = await import("./callStore");

    await startOrJoinCall("conv-1");

    // No credential-less POST: the old behaviour surfaced the backend's raw
    // "Missing Authorization bearer token" instead.
    expect(fetchFn).not.toHaveBeenCalled();
    expect(getCallSnapshot().status).toBe("error");
    expect(getCallSnapshot().error).toMatch(/not signed in/i);
    expect(FakeRoom.instances).toHaveLength(0);
  });

  it("still surfaces a genuine 401 from the backend rather than bypassing it", async () => {
    mockTokenFetch({ error: "Missing Authorization bearer token" }, false, 401);
    const { startOrJoinCall, getCallSnapshot } = await import("./callStore");

    await startOrJoinCall("conv-1");

    expect(getCallSnapshot().status).toBe("error");
    expect(FakeRoom.instances).toHaveLength(0);
  });

  it("keeps no LiveKit API key or secret anywhere on the client", async () => {
    const { startOrJoinCall, getCallSnapshot } = await import("./callStore");
    await startOrJoinCall("conv-1");

    // The store only ever holds what the token response returns: url/token/room/identity.
    const asText = JSON.stringify(getCallSnapshot());
    expect(asText).not.toMatch(/api[_-]?key|api[_-]?secret/i);
    // And the module reads no LiveKit credential from build-time env.
    expect(Object.keys(import.meta.env).some((k) => k.includes("LIVEKIT"))).toBe(false);
  });
});
