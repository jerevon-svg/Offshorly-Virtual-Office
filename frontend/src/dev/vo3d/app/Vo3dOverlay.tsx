// vo3d app — THE V2 OVERLAY: every piece of DOM that sits over the 3D world.
//
// PHASE 6D: WHAT A SELECTED COWORKER MEANS.
//
// The host half of app/interactions.ts. The world hands over an email and a display name; everything
// below is V1's OWN code, from V1's own modules, doing exactly what it does in OfficeMap.tsx:
//
//   chat        services/chat + components/Chat/ConversationView, opened after walking up to the person,
//               emitting spatial_session_start from the SAME onConversationOpen edge V1 emits it from.
//   call        services/call/callStore — already-clustered → start/join; them mid-conversation → refused
//               with the same message; otherwise RING. No media, token or microphone before an accept.
//   approach    the V2 world's own walk (app/world.ts approachCoworker), then V1's approach_arrived quest
//               signal through services/presence/spatialSessionStore.
//   askToJoin   services/chat/requestsClient, against the spatial session the target is actually in.
//   viewProfile components/OfficeMap/EmployeeProfile, against V1's roster.
//
// AND THE TWO GATES, both V1's, in V1's order:
//   • ATTENDANCE — the three verbs that walk this body are refused for an employee V1 has not confirmed
//     checked in. Read through the SAME adapters/v1Attendance answer Phase 5 already gates the working
//     office on; there is no second attendance authority here any more than there is one there.
//   • DND — components/OfficeMap/useTalkPermissionGate, the one implementation of "Request Permission to
//     Talk", now shared with V1's own office. Not a copy of it: the same hook, the same requests, the
//     same one-shot accept, the same cooldown.
//
// PHASE 7B ADDS SPATIAL CHAT ABOVE THE BODIES — the bubble, the typing dots and the glowing unread
// indicator (see Vo3dOverheads.tsx for the anchoring). The state behind all three is derived HERE,
// because it is derived from things this file already holds: the conversation rows Chat's unread badge
// reads, the DM panel's own incoming messages, and V1's typing channel. No second chat subscription and
// no second unread store exist.
//
// PHASE 7A ADDS THE BRANDED HUD, rendered from here rather than beside it, because the two surfaces share
// facts that must not be derived twice: ONE roster-to-layer map, ONE presence map, ONE profile modal, ONE
// toast, and above all ONE action handler — the dock's Search offers Chat and Call on a person, and those
// have to be the SAME Chat and Call the interaction card dispatches, not a second pair that drifts. See
// Vo3dHud.tsx for what the dock itself carries and what it deliberately leaves out.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Vo3dCoworkerSelection, Vo3dScreenAnchor } from "./interactions";
import type { Vo3dWorld } from "./world";
import { CoworkerActionMenu, type Vo3dCoworkerAction } from "./CoworkerActionMenu";
import { emailKey, selfEmailKey } from "../adapters/v1Coworkers";
import { mayEnterOffice } from "./access";
import type { V1Attendance } from "../adapters/v1Attendance";
import { Vo3dHud } from "./Vo3dHud";
import { Vo3dOverheads, SELF_OVERHEAD_KEY, type Vo3dOverhead } from "./Vo3dOverheads";
import { useSelfStatus } from "../../../services/presence/selfStatusStore";
import {
  applyPeerTypingUpdate,
  deriveAnyTypingCharacterIds,
  typingTimerKey,
  type PeerTypingState,
} from "../../../components/OfficeMap/spatialTyping";
import { resolveCharacterAnimState } from "../../../render3d/characterAnimationState";
import { CLIP_TALK_AGREE } from "../adapters/v1Avatar";
import { useAutoStatusDetection } from "../../../services/presence/useAutoStatusDetection";
import { isConnectedToMedia } from "../../../services/call/callStore";
import type { ChatMessage } from "../../../services/chat";
import { officePeopleToLayers } from "../../../data/rosterLayers";
import { ACTIVE_DETAIL_STATUSES, mapAtlasToOfficeStatus, STATUS_META, type OfficeStatus } from "../../../services/presence/status";
import { useDndEmails } from "../../../services/presence/dndClient";
import { useTalkPermissionGate } from "../../../components/OfficeMap/useTalkPermissionGate";
import { TalkRequestToast } from "../../../components/OfficeMap/TalkRequestToast";
import { CallInvitePrompt } from "../../../components/OfficeMap/CallInvitePrompt";
import { SpatialCallControls } from "../../../components/OfficeMap/SpatialCallControls";
import { EmployeeProfile } from "../../../components/OfficeMap/EmployeeProfile";
import { ConversationView } from "../../../components/Chat/ConversationView";
import { buildChatAttentionByLayerId } from "../../../components/OfficeMap/chatAttention";
import { useUnreadTotal } from "../../../services/chat/useUnreadTotal";
import { createJoinRequest } from "../../../services/chat/requestsClient";
import { chatService } from "../../../services/chat";
import { GroupConversationView } from "../../../components/Chat/GroupConversationView";
import {
  computeFloatingChatRightOffsets,
  FLOATING_CHAT_EDGE_MARGIN,
  SPATIAL_WINDOW_KEY,
} from "../../../components/OfficeMap/chatWindowLayout";
import { resolveConversationSlot } from "../../../components/OfficeMap/clusterFormation";
import type { Conversation } from "../../../services/chat/types";
import {
  callParticipantsFor,
  clearAcceptedPeer,
  getCallSnapshot,
  sendCallInvite,
  startOrJoinCall,
  useCallState,
} from "../../../services/call/callStore";
import {
  emitApproachArrived,
  emitSpatialSessionLeave,
  emitSpatialSessionStart,
  useSpatialSessions,
} from "../../../services/presence/spatialSessionStore";
import type { AssetLayer } from "../../../types/office";
import type { OfficePerson } from "../../../services/office/floorMerge";
import styles from "./Vo3dOverlay.module.css";

export interface Vo3dOverlayProps {
  /** The live world, or null until it has been built. Held as a ref by the host for the same reason it
   *  always has been: the world is not rendered by React and must not re-render anything when it lands. */
  worldRef: { current: Vo3dWorld | null };
  /** Flips true once the world exists — the one signal this component subscribes on. */
  ready: boolean;
  /** V1's roster, already fetched by the host. Read-only, and the only place a display name, a status or
   *  a chat-routable identity for somebody other than self comes from. */
  people: readonly OfficePerson[];
  /** The emails V2 is actually DRAWING a body for — app/Vo3dHost.tsx's own coworker set, which has
   *  already dropped self, everybody V1 counts as offline, and everybody with no 3D character. Passed
   *  down rather than read back out of the world: React owns this fact, and asking the scene for it
   *  would mean polling a thing that changes without telling React. */
  drawnEmails: readonly string[];
  /** V1's OWN answer about this employee's work session, passed down from the host rather than re-read
   *  here. The host already holds it (adapters/v1Attendance, the same read Phase 5's office boundary
   *  gates on) and asking a second time would be a second poller against the same endpoint for the same
   *  fact — which is the shape of "two surfaces disagreeing" this whole phase is written to avoid.
   *  Phase 7A reads two more facts off the same record: checked-in (the availability pill) and
   *  checked_in_at (the working-time clock). */
  attendance: V1Attendance;
}

/** How long a transient message stays up, ms — V1's own character-menu toast timings. */
const TOAST_MS = 2400;

/** V1's resolver, asked only the question V2 can answer here. `isWalking` / `isSitting` are deliberately
 *  false: those are facts the world holds about a body, and it already puts both ahead of this pose. A
 *  null answer means "an ordinary idle".
 *
 *  WHY `listening-gesture` MAPS TO THE IDLE AND NOT TO ITSELF.
 *
 *  The V1 STATE is kept exactly — a member of a spatial conversation who is not typing is in the
 *  "listening" state, and that is what this asks V1's own resolver for. What changed is which CLIP that
 *  state plays on V2's rigs, and it changed because of what the asset actually contains: inspected on
 *  Bon's consolidated GLB, `listening-gesture` is a complete, well-formed clip (24/24 skin joints, all
 *  three paths, 9.4s, 7119 keys — nothing missing or degenerate) whose RESTING POSE holds both arms out
 *  away from the body. On these rigs that reads as a stiff, near-T-pose splay rather than as somebody
 *  listening, and it is the pose a conversation sits in almost all of the time.
 *
 *  `idle-9` is the natural standing idle these characters already use everywhere else, so a conversation
 *  now rests in it. `agree-gesture` was inspected the same way and is genuinely good — an expressive,
 *  natural talking motion — so it still plays while somebody is actually typing, which is the moment the
 *  gesture is meant to read. Nothing was regenerated and no clip was edited; this is a selection change.
 *
 *  If the listening clip is ever re-authored with a natural resting pose, the fix is to return
 *  CLIP_TALK_LISTEN on that branch again — the state machine above already produces it. */
function conversationClipFor(inConversation: boolean, isTyping: boolean): string | null {
  if (!inConversation) return null;
  const state = resolveCharacterAnimState({
    isWalking: false,
    isSitting: false,
    isGlobalChatActive: false,
    isSpatialConversation: true,
    isTyping,
  });
  // "listening" -> null, i.e. the body's ordinary natural idle. See the note above.
  return state === "agree-gesture" ? CLIP_TALK_AGREE : null;
}

export function Vo3dOverlay({ worldRef, ready, people, drawnEmails, attendance }: Vo3dOverlayProps) {
  const officeAccess = attendance.access;
  const self = selfEmailKey();
  const [selection, setSelection] = useState<Vo3dCoworkerSelection | null>(null);
  const [anchor, setAnchor] = useState<Vo3dScreenAnchor | null>(null);
  const [openChat, setOpenChat] = useState<AssetLayer | null>(null);
  const [openConversationId, setOpenConversationId] = useState<string | null>(null);
  /** The group conversation panel. Mutually exclusive with the DM panel by construction — opening either
   *  clears the other, which is V1's own rule (two guards that are both false would silently vanish both
   *  panels). One spatial slot, as V1 has. */
  const [openGroupConv, setOpenGroupConv] = useState<{ id: string; participantIds: string[]; title: string | null } | null>(null);
  /** GLOBAL CHAT — V1's remote floating windows, and the other half of its slot split.
   *
   *  A SPATIAL window is the one you get by walking up to somebody: it emits spatial_session_start, shows
   *  "In Conversation", and is what Ask to Join and the call path hang off. A REMOTE window is the same
   *  persistent conversation opened from the inbox, the map or a notification WITHOUT any of that — no
   *  auto-walk, no session, no presence change. V2 had only the spatial slot, so opening a DM from the
   *  inbox claimed a spatial session the employee never entered. The split is V1's own
   *  resolveConversationSlot, applied here to the same conversations.
   *
   *  Several may be open at once, keyed by peer email (DM) or conversation id (group), so reopening one
   *  focuses it instead of duplicating it. */
  type RemoteWindow =
    | { kind: "dm"; key: string; peerEmail: string; minimized: boolean }
    | { kind: "group"; key: string; conversationId: string; participantIds: string[]; title: string | null; minimized: boolean };
  const [remoteWindows, setRemoteWindows] = useState<RemoteWindow[]>([]);
  /** At most three expanded windows at a time, oldest minimized first — V1's own cap. */
  const MAX_EXPANDED_REMOTE = 3;
  const focusRemote = useCallback((next: RemoteWindow) => {
    setRemoteWindows((prev) => {
      const without = prev.filter((w) => w.key !== next.key);
      const merged = [{ ...next, minimized: false }, ...without];
      let expanded = 0;
      return merged.map((w) => {
        if (w.minimized) return w;
        expanded += 1;
        return expanded > MAX_EXPANDED_REMOTE ? { ...w, minimized: true } : w;
      });
    });
  }, []);
  const closeRemote = useCallback((key: string) => {
    setRemoteWindows((prev) => prev.filter((w) => w.key !== key));
  }, []);
  const toggleRemote = useCallback((key: string) => {
    setRemoteWindows((prev) => prev.map((w) => (w.key === key ? { ...w, minimized: !w.minimized } : w)));
  }, []);
  const [chatMinimized, setChatMinimized] = useState(false);
  const [profileEmail, setProfileEmail] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | undefined>(undefined);

  const dndEmails = useDndEmails();
  // The viewer's OWN effective status — the same store the dock's availability picker writes to, so the
  // pill over their head and the pill in the dock can never disagree.
  const { currentStatus: selfStatus } = useSelfStatus();
  const talkGate = useTalkPermissionGate(dndEmails);
  const spatialSessions = useSpatialSessions();
  const callState = useCallState();
  // V1's own conversation subscription, for the Chat row's unread badge and nothing else.
  const { conversations, total: unreadTotal, refetch: refetchConversations } = useUnreadTotal(self);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimerRef.current), []);

  // V1's ROSTER LAYERS, the identity shape every V1 chat/profile component takes. Built with V1's own
  // officePeopleToLayers — the same call adapters/v1Coworkers makes for seating — so a person's layer id
  // here is byte for byte the email key the 3D bodies are keyed on, and no second identity is introduced.
  const layersByEmail = useMemo(() => {
    const map = new Map<string, AssetLayer>();
    for (const layer of officePeopleToLayers(people as OfficePerson[])) map.set(emailKey(layer.id), layer);
    return map;
  }, [people]);

  const statusByEmail = useMemo(() => {
    const map: Record<string, OfficeStatus> = {};
    for (const person of people) map[emailKey(person.email)] = mapAtlasToOfficeStatus(person.status);
    return map;
  }, [people]);

  const chatAttention = useMemo(
    () => buildChatAttentionByLayerId({ conversations, selfEmail: self, selfLayerId: self }),
    [conversations, self],
  );

  const resolveDisplayName = useCallback(
    (email: string) => layersByEmail.get(emailKey(email))?.name?.trim() || email.split("@")[0] || email,
    [layersByEmail],
  );

  /** The chat/profile identity for an email. A roster person has a real layer; anybody else gets the same
   *  minimal stand-in V1's own buildPeerLayer produces, so a peer V1 cannot route to fails the same way. */
  const peerLayerFor = useCallback(
    (email: string): AssetLayer =>
      layersByEmail.get(emailKey(email)) ??
      ({ id: emailKey(email), kind: "character", path: "", x: 0, y: 0, width: 0, height: 0, transform: null } as AssetLayer),
    [layersByEmail],
  );

  // SELF'S "IN CONVERSATION", through V1's OWN hook and V1's OWN inputs. Nothing about the rule is
  // re-decided here: a live (>=2 member) spatial session the viewer belongs to is what V1 counts, media
  // connection outranks it as IN_CALL, and the hook owns idle/Away detection and the writes to
  // selfStatusStore — the same store the availability pill and the "You" overhead already read.
  const inConv = useMemo(
    () => spatialSessions.some((s) => s.members.includes(self) && s.members.length >= 2),
    [self, spatialSessions],
  );
  useAutoStatusDetection({
    inConversation: inConv,
    offline: !mayEnterOffice(attendance.access),
    inCall: isConnectedToMedia(callState),
  });

  const activeSpatialSession = useMemo(
    () => spatialSessions.find((s) => s.members.includes(self)) ?? null,
    [spatialSessions, self],
  );
  const sessionForEmail = useCallback(
    (email: string) => spatialSessions.find((s) => s.members.includes(emailKey(email))),
    [spatialSessions],
  );

  // ---- PHASE 7B: spatial chat state, all of it V1's own --------------------------------------------
  /** Who is typing, keyed (email, conversationId) by V1's OWN reducers. Conversation-scoped for the same
   *  reason V1 scopes it: chatService.onTyping delivers typing for EVERY conversation the viewer is in,
   *  and a stop from one must never clear another. */
  const [peerTyping, setPeerTyping] = useState<PeerTypingState>({});
  const peerTypingTimersRef = useRef<Record<string, number>>({});
  /** What each person just said, cleared on V1's own 4.5s timer. */
  const [talkingTextById, setTalkingTextById] = useState<Record<string, string>>({});
  /** IS THE VIEWER TYPING IN THE SPATIAL CHAT. Fed by the spatial panel's onTypingChange — real keystroke
   *  activity on V1's own 2.5s idle timer, never send history.
   *
   *  A BOOLEAN, not V1's nullable conversation id. V1 stores the id because it ALSO scopes the agree
   *  gesture to a particular session; but ConversationView calls onTypingChange(true) before its
   *  conversation id has resolved, so keying the indicator off the id hides the first keystrokes of every
   *  new conversation. The overhead is asking "am I typing", and that is the value it gets; the session
   *  scoping is done separately, against the live session membership, where it belongs. */
  const [selfTyping, setSelfTyping] = useState(false);
  const talkingTimersRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const unsubscribe = chatService.onTyping?.((update) => {
      const email = emailKey(update.senderId);
      // Never let a self-echo affect peer state.
      if (email === self) return;
      const key = typingTimerKey(email, update.conversationId);
      const timers = peerTypingTimersRef.current;
      if (timers[key]) {
        window.clearTimeout(timers[key]);
        delete timers[key];
      }
      setPeerTyping((prev) => applyPeerTypingUpdate(prev, { email, conversationId: update.conversationId, isTyping: update.isTyping }));
      if (update.isTyping) {
        // Belt-and-suspenders expiry in case a "stopped typing" event is lost (dropped socket message,
        // tab closed uncleanly). V1's own 6s figure.
        timers[key] = window.setTimeout(() => {
          setPeerTyping((prev) => applyPeerTypingUpdate(prev, { email, conversationId: update.conversationId, isTyping: false }));
          delete timers[key];
        }, 6000);
      }
    });
    return () => {
      unsubscribe?.();
      for (const id of Object.values(peerTypingTimersRef.current)) window.clearTimeout(id);
      peerTypingTimersRef.current = {};
    };
  }, [self]);

  /** A message landed in the open spatial conversation: show it over that person for V1's own 4.5s.
   *
   *  THE SENDER SEES THEIR OWN BUBBLE TOO, which is V1's behaviour — its handleTalkingMessage does not
   *  filter self either. It costs no optimistic message and cannot duplicate: ConversationView's
   *  onMessage subscription fires for every message on the conversation including this client's own
   *  (chatService.sendMessage notifies listeners synchronously), and the server's echo is dropped by the
   *  id dedupe there, so this runs exactly once per message. Self is keyed to the overhead layer's
   *  reserved self row, since the viewer has no coworker body to hang it on. */
  const handleTalkingMessage = useCallback((msg: ChatMessage) => {
    const email = emailKey(msg.senderId) === self ? SELF_OVERHEAD_KEY : emailKey(msg.senderId);
    window.clearTimeout(talkingTimersRef.current[email]);
    setTalkingTextById((prev) => ({ ...prev, [email]: msg.text }));
    talkingTimersRef.current[email] = window.setTimeout(() => {
      setTalkingTextById((prev) => {
        const next = { ...prev };
        delete next[email];
        return next;
      });
    }, 4500);
  }, [self]);

  useEffect(() => () => {
    for (const id of Object.values(talkingTimersRef.current)) window.clearTimeout(id);
  }, []);

  // ---- the world subscription -----------------------------------------------------------------------
  // React owns the consequences, the world owns the scene — the same shape as every other write across
  // this boundary. Re-subscribes only when the world lands; a selection made before then cannot exist.
  useEffect(() => {
    const world = worldRef.current;
    if (!ready || !world) return;
    world.setCoworkerInteractions({
      onSelect: (sel) => setSelection(sel),
      // THE ONLY SIGNAL V1 CAN GET for "walk up to a coworker" — the walk itself is client-side. Emitted
      // exactly where OfficeMap.tsx emits it: after a finished approach, keyed on the same email. The
      // server still rejects self and non-roster targets.
      onApproachArrived: (email) => emitApproachArrived(email),
    });
    return () => world.setCoworkerInteractions(null);
  }, [ready, worldRef]);

  /** Close the card AND tell the world, so the two agree about who is selected — otherwise a second click
   *  on the same body would be recognised as "already selected" and open nothing. */
  const closeMenu = useCallback(() => {
    setSelection(null);
    worldRef.current?.clearCoworkerSelection();
    // V1's closeCharacterMenu: a DISMISSAL eases the camera back to where it was before the person was
    // framed. Taking an action does not (see dismissMenu) — V1 is explicit that opening a chat panel must
    // not reset the view underneath it.
    worldRef.current?.restoreCameraView();
  }, [worldRef]);

  /** Dismiss the card but LEAVE THE CAMERA where the focus put it — V1's `setMenu(null)`, used by every
   *  action that then does something with that person. */
  const dismissMenu = useCallback(() => {
    setSelection(null);
    worldRef.current?.clearCoworkerSelection();
  }, [worldRef]);

  // ---- the live anchor ------------------------------------------------------------------------------
  // THE CARD FOLLOWS THE PERSON. Their body moves (a replayed peer walk) and so does the camera (PLAYER
  // mode moves it every frame, OFFICE whenever it is panned or zoomed), so the point is recomputed per
  // animation frame rather than captured at click time. The loop exists only while something is selected.
  useEffect(() => {
    const email = selection?.email;
    if (!email) {
      setAnchor(null);
      return;
    }
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const next = worldRef.current?.coworkerAnchor(email) ?? null;
      setAnchor((prev) => {
        if (!next) return prev === null ? prev : null;
        // Sub-pixel churn is not a move; re-rendering on it would re-render the card sixty times a second
        // while a body merely breathes.
        if (prev && prev.visible === next.visible && Math.abs(prev.clientX - next.clientX) < 0.5 && Math.abs(prev.clientY - next.clientY) < 0.5) return prev;
        return next;
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [selection?.email, worldRef]);

  // ---- V1's own post-accept convergence -------------------------------------------------------------
  // A ring was accepted by either side: converge through the SAME approach + chat-panel flow the "chat"
  // action uses, which is what creates/reuses the conversation and emits spatial_session_start.
  // pendingCallTargetRef then starts media once the session genuinely has both members. No second LiveKit
  // join path, and no token or microphone before this point. Lifted from OfficeMap.tsx unchanged.
  const pendingCallTargetRef = useRef<string | null>(null);
  useEffect(() => {
    const peer = callState.acceptedPeerEmail;
    if (!peer) return;
    clearAcceptedPeer();
    pendingCallTargetRef.current = emailKey(peer);
    worldRef.current?.approachCoworker(emailKey(peer));
    setChatMinimized(false);
    setOpenChat(peerLayerFor(peer));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callState.acceptedPeerEmail]);

  const startSpatialCall = useCallback(
    async (sessionId: string) => {
      await startOrJoinCall(sessionId);
      const snap = getCallSnapshot();
      if (snap.status === "error" && snap.error) showToast(snap.error);
    },
    [showToast],
  );

  // Fires the deferred call exactly once, the moment the spatial session becomes eligible — gated on the
  // SAME derived session the menu's own labels read, so no second notion of call eligibility exists.
  useEffect(() => {
    const wanted = pendingCallTargetRef.current;
    if (!wanted || !activeSpatialSession) return;
    if (!activeSpatialSession.members.includes(wanted)) return;
    pendingCallTargetRef.current = null;
    void startSpatialCall(activeSpatialSession.sessionId);
  }, [activeSpatialSession, startSpatialCall]);

  // ---- the actions ----------------------------------------------------------------------------------
  /** Walk up to this person and, when the panel is wanted, open it on arrival. Split out because chat, the
   *  DND-gated resume and the accepted-call convergence all want exactly this and must not each grow their
   *  own version of it. */
  const walkUpTo = useCallback(
    (email: string, thenOpenChat: boolean) => {
      worldRef.current?.approachCoworker(email);
      if (!thenOpenChat) return;
      // V1 opens the panel on ARRIVAL; V2 opens it now and lets the body catch up, because the walk here is
      // the world's and the panel is React's, and blocking one on the other would mean routing a callback
      // back across a boundary the whole phase is built to keep one-way. The spatial session is still not
      // created until the conversation id resolves (see onConversationOpen) — the rule V1 states as
      // "chat panel required" — so nothing is claimed early.
      setChatMinimized(false);
      setOpenChat(peerLayerFor(email));
    },
    [peerLayerFor, worldRef],
  );

  /** THE ONE IMPLEMENTATION of what an action means, addressed by email rather than by "whoever is
   *  selected". The interaction card calls it for the person it is anchored to; the dock's Search calls
   *  it for the person a name lookup found. Both therefore run the same gates in the same order — which
   *  is the whole reason it takes a target instead of reading the selection.
   *
   *  `closeMenu` is still correct for the Search path: nothing is selected then, so it is a no-op that
   *  also keeps the world's idea of the selection in step. */
  const runAction = useCallback(
    (targetEmail: string, displayName: string, action: Vo3dCoworkerAction) => {
      const email = emailKey(targetEmail);
      const name = displayName;

      // Abandon any stale gate left over from a PREVIOUS DND-gated attempt at a different target — any
      // new interaction supersedes it, exactly as it does in V1's office.
      talkGate.supersede(email);

      if (action === "viewProfile") {
        closeMenu();
        setProfileEmail(email);
        return;
      }

      if (action === "askToJoin") {
        closeMenu();
        const session = sessionForEmail(email);
        if (session && session.members.length >= 2) {
          createJoinRequest(session.sessionId).catch((err) => {
            console.error("[requests] failed to create join request", err);
          });
          showToast(`Asked to join ${name}’s conversation…`);
        }
        return;
      }

      // ATTENDANCE, first and for the same three verbs V1 gates: chat, call and approach all move this
      // body, and an employee V1 has not confirmed checked in cannot move it. Checked BEFORE the DND gate
      // so no walk and no talk-request is ever started.
      if (!mayEnterOffice(officeAccess)) {
        dismissMenu();
        showToast("Check in first to walk up to a colleague.");
        return;
      }

      // PERSON-LEVEL DND, second: the same gate, the same hook, the same request, as V1's office.
      if (dndEmails.has(email)) {
        dismissMenu();
        talkGate.open({
          targetEmail: email,
          targetName: name,
          // "call" rides the existing "chat" talk-request kind — it IS a request to talk, and the
          // backend's CreateTalkRequestIn enum is deliberately left untouched. The call intent itself is
          // remembered in `resume` below.
          kind: action === "approach" ? "approach" : "chat",
          // A DND person is never rung (the server rejects it too). An allowed "call" resumes as a plain
          // spatial conversation; the call can then be started from the menu via the already-in-session
          // path, which needs no invite.
          resume: () => walkUpTo(email, action !== "approach"),
        });
        return;
      }

      if (action === "approach") {
        dismissMenu();
        walkUpTo(email, false);
        return;
      }

      if (action === "chat") {
        // V1 deliberately uses setMenu(null) rather than closeCharacterMenu here — opening the chat panel
        // must not reset the camera out of the framing it just walked you into.
        dismissMenu();
        walkUpTo(email, true);
        return;
      }

      // CALL. The spatial session — never this menu — decides eligibility; this only expresses intent.
      dismissMenu();
      // (a) Already clustered with this person: start/join their call immediately. No ring is needed or
      //     wanted — we are already together, and this is also the rejoin path.
      if (activeSpatialSession?.members.includes(email)) {
        void startSpatialCall(activeSpatialSession.sessionId);
        return;
      }
      // (b) They're mid-conversation with somebody else. Joining that is Ask to Join's job (offered in
      //     this same menu) — do not fabricate a parallel path into a call we aren't eligible for.
      const theirs = sessionForEmail(email);
      if (theirs && theirs.members.length >= 2 && !theirs.members.includes(self)) {
        showToast(`${name} is in a conversation — ask to join first.`);
        return;
      }
      // (c) Not together yet: RING them. Intent only — no walk, no chat panel, no conversation, no
      //     spatial session, no token, no microphone. All of that waits for their Accept.
      sendCallInvite(email);
    },
    [
      activeSpatialSession, closeMenu, dismissMenu, dndEmails, officeAccess, self,
      sessionForEmail, showToast, startSpatialCall, talkGate, walkUpTo,
    ],
  );

  /** The interaction card's handler: the same action, against whoever the card is anchored to. */
  const handleChoose = useCallback(
    (action: Vo3dCoworkerAction) => {
      if (selection) runAction(selection.email, selection.displayName, action);
    },
    [runAction, selection],
  );

  /** The people the HUD's Search may offer: exactly the coworkers V2 is DRAWING, as V1 layers. Anybody
   *  the world has no body for cannot be located in it, so offering them would be a row that does
   *  nothing — the same reason the interaction menu carries no demo rows. */
  /** WHAT IS OVERHEAD, for everybody V2 is drawing. One entry per person who has something to show —
   *  a message, typing, or unread — and nobody else, so a quiet office renders no overhead layer at all.
   *  Every input is V1's: chatAttention's unread derivation, V1's typing reducers, and the DM panel's
   *  own incoming messages. */
  /** WHO IS TYPING, self included — V1's own deriveAnyTypingCharacterIds, keyed on email (V2 has no
   *  separate sprite/layer id, so the viewer's own key is simply their email). */
  const typingIds = useMemo(
    () => new Set(deriveAnyTypingCharacterIds(peerTyping, selfTyping, self)),
    [peerTyping, self, selfTyping],
  );

  /** WHO IS IN A LIVE SPATIAL CONVERSATION — V1's own rule: any member of a >=2-member session. */
  const inConversationEmails = useMemo(() => {
    const ids = new Set<string>();
    for (const session of spatialSessions) {
      if (session.members.length < 2) continue;
      for (const m of session.members) ids.add(emailKey(m));
    }
    return ids;
  }, [spatialSessions]);

  const overheads = useMemo<Vo3dOverhead[]>(() => {
    const drawn = drawnEmails.map((e) => emailKey(e));
    const out: Vo3dOverhead[] = [];
    for (const email of drawn) {
      const sentText = talkingTextById[email];
      const typing = typingIds.has(email);
      const attention = chatAttention[email];
      // IN CONVERSATION, from V1's OWN signal. V1 reads a peer's presence off Atlas, which the mock rig
      // never updates; the server-broadcast spatial_sessions feed carries the same fact to every client
      // and is what V1 itself drives the peer talking visual from (its talkingCharacterIdsFromSessions).
      // It only ever UPGRADES the label — it never suppresses a message or the typing dots above it.
      const status = inConversationEmails.has(email) ? "IN_CONVERSATION" : statusByEmail[email];
      // Somebody V1 has no status for AND who has nothing to say gets no overhead at all — V1 renders
      // nothing for them either, rather than an empty pill.
      if (!sentText && !typing && !attention && !status) continue;
      const layer = layersByEmail.get(email);
      const displayName = layer?.name?.trim() || email.split("@")[0] || email;
      out.push({
        email,
        displayName,
        ...(sentText ? { sentText } : {}),
        ...(typing ? { typing } : {}),
        ...(attention ? { unread: { conversationId: attention.conversationId, count: attention.count } } : {}),
        ...(status
          ? {
              status: {
                color: STATUS_META[status].color,
                // V1's formatShortName: the first word of the display name, never blank.
                shortName: displayName.trim().split(/\s+/)[0] || displayName,
                // Only the statuses V1 spells out beside the name (ACTIVE_DETAIL_STATUSES).
                ...(ACTIVE_DETAIL_STATUSES.has(status) ? { detail: STATUS_META[status].label } : {}),
              },
            }
          : {}),
      });
    }
    // PART 1 — THE VIEWER'S OWN PILL. V1 shows you a "You" nameplate over your own avatar carrying your
    // own effective status (the same selfStatusStore the availability picker writes). Self is not in
    // `drawnEmails` — resolveVo3dCoworkers excludes them by design — so the row is added here, with the
    // reserved key the overhead layer anchors to the player's body rather than to a coworker's.
    const selfText = talkingTextById[SELF_OVERHEAD_KEY];
    if (selfStatus || typingIds.has(self) || selfText) {
      out.push({
        email: SELF_OVERHEAD_KEY,
        displayName: "You",
        // Same one-of-three priority as everybody else: what you just said outranks the dots, which
        // outrank the nameplate. The overhead layer applies it; this only supplies the facts.
        ...(selfText ? { sentText: selfText } : {}),
        // THE VIEWER'S OWN TYPING INDICATOR. V1 puts self in the same typing list as everybody else
        // (deriveAnyTypingCharacterIds takes `selfTyping` as its second argument), and the overhead layer
        // applies the same one-of-three priority — so the "You" pill BECOMES the dots while typing and
        // returns to the status underneath when the idle timer fires.
        ...(typingIds.has(self) ? { typing: true } : {}),
        status: selfStatus ? {
          color: STATUS_META[selfStatus].color,
          shortName: "You",
          ...(ACTIVE_DETAIL_STATUSES.has(selfStatus) ? { detail: STATUS_META[selfStatus].label } : {}),
        } : undefined,
      });
    }
    return out;
  }, [chatAttention, drawnEmails, inConversationEmails, layersByEmail, self, selfStatus, statusByEmail, talkingTextById, typingIds]);

  // THE CONVERSATION POSES. Resolved by V1's OWN resolveCharacterAnimState, not by a rule invented here,
  // and pushed into the world the same way the roster and the occupancy are. Only the two conversation
  // states are sent: walking and sitting are the world's own business and already outrank the pose there,
  // exactly as they outrank it in V1's resolver.
  useEffect(() => {
    const world = worldRef.current;
    if (!ready || !world) return;
    const poses = new Map<string, string | null>();
    for (const email of drawnEmails.map((e) => emailKey(e))) {
      poses.set(email, conversationClipFor(inConversationEmails.has(email), typingIds.has(email)));
    }
    world.setConversationPoses(poses, conversationClipFor(inConversationEmails.has(self), typingIds.has(self)));
  }, [drawnEmails, inConversationEmails, ready, self, typingIds, worldRef]);

  /** Clicking the unread indicator opens that person's DM — the SAME panel the Chat action opens, in the
   *  same slot. Marking-as-read is left entirely to the panel, which is what makes the indicator go away. */
  const openConversationWith = useCallback((email: string) => {
    setOpenGroupConv(null);
    setChatMinimized(false);
    setOpenChat(peerLayerFor(email));
  }, [peerLayerFor]);

  /** THE ONE CONVERSATION OPENER, shared by the inbox, the Map, the unread indicator and New Message.
   *  A DM lands in the DM slot on that peer; a group lands in the group slot. Nothing here creates a
   *  conversation — ConversationView still does that for a DM, and a group row already exists. */
  const openConversation = useCallback((conv: Conversation) => {
    // V1'S OWN RULE, not a guess: a conversation whose spatial session actually has another member in it
    // reopens in the SPATIAL slot (you are standing with them); anything else is Global Chat and opens as
    // a remote window, which emits no session and moves nobody.
    const slot = resolveConversationSlot({ conversationId: conv.id, sessions: spatialSessions, selfEmail: self });
    if ((conv.type ?? "dm") === "group") {
      if (slot === "spatial") {
        setOpenChat(null);
        setChatMinimized(false);
        setOpenGroupConv({ id: conv.id, participantIds: conv.participantIds, title: conv.title ?? null });
        return;
      }
      focusRemote({ kind: "group", key: conv.id, conversationId: conv.id, participantIds: conv.participantIds, title: conv.title ?? null, minimized: false });
      return;
    }
    const peer = conv.participantIds.find((id) => emailKey(id) !== self);
    if (!peer) return;
    if (slot === "spatial") {
      openConversationWith(peer);
      return;
    }
    focusRemote({ kind: "dm", key: emailKey(peer), peerEmail: emailKey(peer), minimized: false });
  }, [focusRemote, openConversationWith, self, spatialSessions]);

  /** Open (or focus) somebody's DM as a GLOBAL CHAT window — New Message, Find Person and the Map's
   *  "message" action all mean this, never a walk. */
  const openRemoteDirectMessage = useCallback((email: string) => {
    focusRemote({ kind: "dm", key: emailKey(email), peerEmail: emailKey(email), minimized: false });
  }, [focusRemote]);

  /** New Group Chat: V1's own idempotent creation call, then the panel. */
  const startGroup = useCallback((emails: string[], groupName?: string) => {
    void chatService
      .createGroupConversation?.([self, ...emails], groupName?.trim() || null)
      .then((conv) => {
        void refetchConversations();
        if (conv) openConversation(conv);
      })
      .catch((err: Error) => {
        console.error("[chat] failed to create group conversation", err);
        showToast("Couldn't start that group chat.");
      });
  }, [openConversation, refetchConversations, self, showToast]);

  const peopleLayers = useMemo(() => {
    const drawn = new Set(drawnEmails.map((e) => emailKey(e)));
    return [...layersByEmail.entries()].filter(([email]) => drawn.has(email)).map(([, layer]) => layer);
  }, [layersByEmail, drawnEmails]);

  /** WHERE EACH WINDOW SITS. V1's own right-to-left stack (chatWindowLayout), so a spatial window and
   *  several Global Chat windows share one row instead of landing on top of each other. */
  const windowOffsets = useMemo(() => {
    const items: { key: string; minimized: boolean }[] = [];
    for (const w of remoteWindows) if (!w.minimized) items.push({ key: w.key, minimized: false });
    if (openChat || openGroupConv) items.push({ key: SPATIAL_WINDOW_KEY, minimized: chatMinimized });
    return computeFloatingChatRightOffsets(items, FLOATING_CHAT_EDGE_MARGIN);
  }, [chatMinimized, openChat, openGroupConv, remoteWindows]);
  const slotStyle = (key: string) => ({ right: windowOffsets.get(key) ?? FLOATING_CHAT_EDGE_MARGIN });

  const menuVisible = selection !== null && anchor !== null && anchor.visible;
  const targetSession = selection ? sessionForEmail(selection.email) : undefined;

  return (
    <>
      {menuVisible && selection && anchor && (
        <CoworkerActionMenu
          displayName={selection.displayName}
          anchor={{ clientX: anchor.clientX, clientY: anchor.clientY }}
          onChoose={handleChoose}
          onClose={closeMenu}
          status={statusByEmail[selection.email]}
          unreadCount={chatAttention[selection.email]?.count}
          // Offered only when the target is in a >=2-member session the viewer is NOT already part of —
          // the same condition V1's menu computes, from the same store.
          canAskToJoin={Boolean(targetSession && targetSession.members.length >= 2 && !targetSession.members.includes(self))}
          // Label only. The row still dispatches "call", into the one join path above.
          targetInActiveCall={callParticipantsFor(callState, activeSpatialSession?.sessionId ?? null).includes(selection.email)}
        />
      )}
      <TalkRequestToast {...talkGate.toastProps} />
      <CallInvitePrompt resolveDisplayName={resolveDisplayName} />
      {remoteWindows.map((w) =>
        w.kind === "dm" ? (
          <div key={w.key} className={styles.chatSlot} style={slotStyle(w.key)}>
            <ConversationView
              peer={peerLayerFor(w.peerEmail)}
              selfId={self}
              peerChatId={layersByEmail.has(w.peerEmail) ? w.peerEmail : null}
              // NOT spatial: no session badge, no call controls, no spatial_session_start. This is
              // Global Chat — the same persistent conversation, reached without walking anywhere.
              minimized={w.minimized}
              onMinimizeToggle={() => toggleRemote(w.key)}
              onClose={() => closeRemote(w.key)}
            />
          </div>
        ) : (
          <div key={w.key} className={styles.chatSlot} style={slotStyle(w.key)}>
            <GroupConversationView
              conversationId={w.conversationId}
              selfId={self}
              participantEmails={w.participantIds}
              title={w.title}
              resolveDisplayName={resolveDisplayName}
              minimized={w.minimized}
              onMinimizeToggle={() => toggleRemote(w.key)}
              onClose={() => closeRemote(w.key)}
            />
          </div>
        ),
      )}
      {openChat && (
        <div className={styles.chatSlot} style={slotStyle(SPATIAL_WINDOW_KEY)}>
          <ConversationView
            peer={openChat}
            selfId={self}
            // A roster person routes on their email; anybody else has no identity the backend can route
            // on, and ConversationView disables itself rather than guessing — V1's own rule.
            peerChatId={layersByEmail.has(openChat.id) ? openChat.id : null}
            isSpatial
            // PHASE 7B — the bubble's source. V1's ConversationView already reports every message that
            // lands in the open conversation; this is the same hook V1's office puts its own speech
            // bubbles on, so no second message subscription exists.
            onIncomingMessage={handleTalkingMessage}
            // SELF TYPING — the same edge V1 wires: real keystrokes on V1's 2.5s idle timer, scoped to
            // the conversation this panel is open on.
            onTypingChange={setSelfTyping}
            headerExtra={<SpatialCallControls sessionId={openConversationId} />}
            minimized={chatMinimized}
            onMinimizeToggle={() => setChatMinimized((v) => !v)}
            onConversationOpen={(conversationId) => {
              // Edge-triggered, exactly once, the moment the panel's conversation id first resolves. This
              // is the ONLY place spatial_session_start is emitted — approach alone must never create a
              // spatial session or a DM conversation.
              setOpenConversationId(conversationId);
              emitSpatialSessionStart(conversationId);
            }}
            onClose={() => {
              setSelfTyping(false);
              setOpenChat(null);
              if (openConversationId) emitSpatialSessionLeave();
              setOpenConversationId(null);
              setChatMinimized(false);
            }}
          />
        </div>
      )}
      {openGroupConv && !openChat && (
        <div className={styles.chatSlot} style={slotStyle(SPATIAL_WINDOW_KEY)}>
          <GroupConversationView
            conversationId={openGroupConv.id}
            selfId={self}
            participantEmails={openGroupConv.participantIds}
            title={openGroupConv.title}
            resolveDisplayName={resolveDisplayName}
            isSpatial
            onIncomingMessage={handleTalkingMessage}
            onTypingChange={setSelfTyping}
            minimized={chatMinimized}
            onMinimizeToggle={() => setChatMinimized((v) => !v)}
            onClose={() => {
              setSelfTyping(false);
              setOpenGroupConv(null);
              setChatMinimized(false);
            }}
          />
        </div>
      )}
      {profileEmail && (
        <EmployeeProfile
          email={profileEmail}
          viewerEmail={self}
          roster={people as OfficePerson[]}
          onClose={() => setProfileEmail(null)}
        />
      )}
      {toast && <div className={styles.toast}>{toast}</div>}
      <Vo3dOverheads
        worldRef={worldRef}
        ready={ready}
        overheads={overheads}
        onOpenConversation={(email) => openConversationWith(email)}
      />
      <Vo3dHud
        worldRef={worldRef}
        ready={ready}
        attendance={attendance}
        peopleLayers={peopleLayers}
        statusByEmail={statusByEmail}
        onCoworkerAction={runAction}
        onOpenProfile={setProfileEmail}
        people={people}
        selfId={self}
        conversations={conversations}
        unreadTotal={unreadTotal}
        resolveDisplayName={resolveDisplayName}
        onSelectConversation={openConversation}
        onOpenDirectMessage={openRemoteDirectMessage}
        onStartGroup={startGroup}
        // The profile modal is the overlay's own screen-owning panel, so it joins the dock's ONE
        // visibility rule rather than being a case the dock does not know about.
        overlayToolOpen={profileEmail !== null}
      />
    </>
  );
}

export default Vo3dOverlay;
