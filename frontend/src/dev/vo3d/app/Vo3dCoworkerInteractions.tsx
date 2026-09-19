// vo3d app — PHASE 6D: WHAT A SELECTED COWORKER MEANS.
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
// WHAT IS DELIBERATELY NOT HERE. The branded HUD (Phase 7A): no dock, no conversation list, no Global
// Chat windows, no notification centre, no search. This mounts what an employee interaction NEEDS in
// order to actually work and not one control more.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Vo3dCoworkerSelection, Vo3dScreenAnchor } from "./interactions";
import type { Vo3dWorld } from "./world";
import { CoworkerActionMenu, type Vo3dCoworkerAction } from "./CoworkerActionMenu";
import { emailKey, selfEmailKey } from "../adapters/v1Coworkers";
import { mayEnterOffice, type OfficeAccess } from "./access";
import { officePeopleToLayers } from "../../../data/rosterLayers";
import { mapAtlasToOfficeStatus, type OfficeStatus } from "../../../services/presence/status";
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
import styles from "./Vo3dCoworkerInteractions.module.css";

export interface Vo3dCoworkerInteractionsProps {
  /** The live world, or null until it has been built. Held as a ref by the host for the same reason it
   *  always has been: the world is not rendered by React and must not re-render anything when it lands. */
  worldRef: { current: Vo3dWorld | null };
  /** Flips true once the world exists — the one signal this component subscribes on. */
  ready: boolean;
  /** V1's roster, already fetched by the host. Read-only, and the only place a display name, a status or
   *  a chat-routable identity for somebody other than self comes from. */
  people: readonly OfficePerson[];
  /** V1's OWN answer about this employee's work session, passed down from the host rather than re-read
   *  here. The host already holds it (adapters/v1Attendance, the same read Phase 5's office boundary
   *  gates on) and asking a second time would be a second poller against the same endpoint for the same
   *  fact — which is the shape of "two surfaces disagreeing" this whole phase is written to avoid. */
  officeAccess: OfficeAccess;
}

/** How long a transient message stays up, ms — V1's own character-menu toast timings. */
const TOAST_MS = 2400;

export function Vo3dCoworkerInteractions({ worldRef, ready, people, officeAccess }: Vo3dCoworkerInteractionsProps) {
  const self = selfEmailKey();
  const [selection, setSelection] = useState<Vo3dCoworkerSelection | null>(null);
  const [anchor, setAnchor] = useState<Vo3dScreenAnchor | null>(null);
  const [openChat, setOpenChat] = useState<AssetLayer | null>(null);
  const [openConversationId, setOpenConversationId] = useState<string | null>(null);
  const [chatMinimized, setChatMinimized] = useState(false);
  const [profileEmail, setProfileEmail] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | undefined>(undefined);

  const dndEmails = useDndEmails();
  const talkGate = useTalkPermissionGate(dndEmails);
  const spatialSessions = useSpatialSessions();
  const callState = useCallState();
  // V1's own conversation subscription, for the Chat row's unread badge and nothing else.
  const { conversations } = useUnreadTotal(self);

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

  const activeSpatialSession = useMemo(
    () => spatialSessions.find((s) => s.members.includes(self)) ?? null,
    [spatialSessions, self],
  );
  const sessionForEmail = useCallback(
    (email: string) => spatialSessions.find((s) => s.members.includes(emailKey(email))),
    [spatialSessions],
  );

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

  const handleChoose = useCallback(
    (action: Vo3dCoworkerAction) => {
      const picked = selection;
      if (!picked) return;
      const email = emailKey(picked.email);
      const name = picked.displayName;

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
        closeMenu();
        showToast("Check in first to walk up to a colleague.");
        return;
      }

      // PERSON-LEVEL DND, second: the same gate, the same hook, the same request, as V1's office.
      if (dndEmails.has(email)) {
        closeMenu();
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
        closeMenu();
        walkUpTo(email, false);
        return;
      }

      if (action === "chat") {
        closeMenu();
        walkUpTo(email, true);
        return;
      }

      // CALL. The spatial session — never this menu — decides eligibility; this only expresses intent.
      closeMenu();
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
      activeSpatialSession, closeMenu, dndEmails, officeAccess, selection, self,
      sessionForEmail, showToast, startSpatialCall, talkGate, walkUpTo,
    ],
  );

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
      {openChat && (
        <div className={styles.chatSlot}>
          <ConversationView
            peer={openChat}
            selfId={self}
            // A roster person routes on their email; anybody else has no identity the backend can route
            // on, and ConversationView disables itself rather than guessing — V1's own rule.
            peerChatId={layersByEmail.has(openChat.id) ? openChat.id : null}
            isSpatial
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
              setOpenChat(null);
              if (openConversationId) emitSpatialSessionLeave();
              setOpenConversationId(null);
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
    </>
  );
}

export default Vo3dCoworkerInteractions;
