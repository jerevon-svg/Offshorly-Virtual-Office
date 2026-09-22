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
// PHASE 7G ADDS THE TOUCAN — V1's assistant, unrebuilt. Nothing about the assistant itself is here:
// components/OfficeMap/ToucanAssistantPanel is mounted unforked and it still owns its own transcript,
// its own service (services/toucan), its own history, memories, action confirmations, delegation banner
// and error handling. What lives HERE is only what a host has to supply: the window's slot in the same
// right-to-left stack the chat windows use, the board the viewer asked about, the proactive return
// briefing's summon, and the one conversation opener its return card hands a conversation id to.
//
// PHASE 7G — AND THE BIRD IS REAL. What the dock and the lower-right summon button do is CALL IT; the
// world flies it (world/Toucan, over V1's own summon machine) and this file opens the assistant at the
// moment it ARRIVES — `toucanState === "attending"`, which is V1's office sequence line for line. Release
// withdraws the summon and the bird goes home to the Central Hub's perch; the conversation is untouched,
// because it never lived here.
//
// CONTINUITY BETWEEN V1 AND V2 IS THE SERVER'S, not this file's. The transcript is seeded on MOUNT from
// toucanService.loadLatestConversation(), so walking out of V1's office and into V2's world lands in the
// same conversation, mid-thread — and no conversation is created by opening the panel in either place.
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
import { Vo3dRoomDetails } from "./Vo3dRoomDetails";
import { Vo3dRoomLabels } from "./Vo3dRoomLabels";
import { resolveRoomDetails } from "./roomDetails";
import { roomLayers, FRAME_WIDTH } from "../../../data/office-layout";
import { emailKey, selfEmailKey } from "../adapters/v1Coworkers";
import { KIOSK_INTERACTION_ID } from "../rooms/reception";
import { Vo3dKioskCard, type Vo3dKioskState } from "./Vo3dKioskCard";
import { attendanceService } from "../../../services/attendance";
import { getCurrentUserId } from "../../../auth/useAuthGate";
import { Vo3dExitCard } from "./Vo3dExitCard";
import { Vo3dCheckoutPanels } from "./Vo3dCheckoutPanels";
import panelStyles from "./Vo3dCheckoutPanels.module.css";
import { manilaWorkDate, useCheckoutFlow } from "../../../components/OfficeMap/useCheckoutFlow";
import type { CheckoutState } from "../../../data/checkoutState";
import { loadSessionStart } from "../../../data/checkoutStorage";
import { isRealZohoMode } from "../../../services/zoho";
import { mayEnterOffice } from "./access";
import type { V1Attendance } from "../adapters/v1Attendance";
import { Vo3dHud, type Vo3dProfileLanding } from "./Vo3dHud";
import { Vo3dOverheads, SELF_OVERHEAD_KEY, TOUCAN_OVERHEAD_KEY, type Vo3dOverhead } from "./Vo3dOverheads";
import { WhiteboardPanel } from "../../../components/Whiteboard/WhiteboardPanel";
import { type WhiteboardScope } from "../../../services/whiteboard/whiteboardClient";
import { flatRoomIdForRoomLayer, formatRoomName } from "../../../data/office-layout";
import { profileImageFor } from "../../../data/portraits";
import {
  CHAT_BUBBLE_RAIL_GAP,
  CHAT_BUBBLE_SIZE,
} from "../../../components/OfficeMap/chatWindowLayout";
import type { ToucanSummonState } from "../../../components/OfficeMap/toucanSummon";
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
import { isAuthoredMessage } from "../../../services/chat/types";
import { officePeopleToLayers } from "../../../data/rosterLayers";
import { ACTIVE_DETAIL_STATUSES, mapAtlasToOfficeStatus, STATUS_META, type OfficeStatus } from "../../../services/presence/status";
import { emitDndSet, useDndEmails } from "../../../services/presence/dndClient";
import {
  emitGlobalChatActive,
  useGlobalChatActiveEmails,
} from "../../../services/presence/globalChatActivityClient";
import { useTalkPermissionGate } from "../../../components/OfficeMap/useTalkPermissionGate";
import { TalkRequestToast } from "../../../components/OfficeMap/TalkRequestToast";
import { CallInvitePrompt } from "../../../components/OfficeMap/CallInvitePrompt";
import { SpatialCallControls } from "../../../components/OfficeMap/SpatialCallControls";
import { CallOverlay } from "../../../components/OfficeMap/CallOverlay";
import { Vo3dCallBar } from "./Vo3dCallBar";
import { Vo3dMeetingChat } from "./Vo3dMeetingChat";
import {
  expireReactions,
  joinMeetingChat,
  leaveMeetingChat,
  useMeetingChat,
} from "../../../services/meeting/meetingChatClient";
import { isPointerLocked, isTypingTarget } from "./keyGuard";
import { EmployeeProfile } from "../../../components/OfficeMap/EmployeeProfile";
import { ConversationView } from "../../../components/Chat/ConversationView";
import { buildChatAttentionByLayerId } from "../../../components/OfficeMap/chatAttention";
import { useUnreadTotal } from "../../../services/chat/useUnreadTotal";
import { createJoinRequest } from "../../../services/chat/requestsClient";
import { chatMode, chatService } from "../../../services/chat";
import { GroupConversationView } from "../../../components/Chat/GroupConversationView";
import {
  computeFloatingChatRightOffsets,
  FLOATING_CHAT_EDGE_MARGIN,
  SPATIAL_WINDOW_KEY,
  TOUCAN_WINDOW_KEY,
} from "../../../components/OfficeMap/chatWindowLayout";
import { ToucanAssistantPanel } from "../../../components/OfficeMap/ToucanAssistantPanel";
import { subscribeToucanChannelConnected, toucanService, type ToucanCatchUp } from "../../../services/toucan";
import {
  readBriefedSince,
  shouldBriefOnReturn,
  writeBriefedSince,
} from "../../../components/OfficeMap/toucanReturnBriefing";
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
import { openCompanyHub } from "../../../services/hub/companyHubStore";
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
  /** ROOM DETAILS — the rest of V1's roster state the panel needs, passed down from the host's ONE
   *  useOfficeRoster rather than re-subscribed here. `rosterLoading` is what keeps "still loading" from
   *  reading as "nobody is here", and `roomNames` is Atlas's room id -> name map, which is the only way a
   *  live PROJECT / CLIQ_CHANNEL room can be named rather than leaked as a raw id. Both optional so the
   *  standalone callers and the existing test mounts stay valid. */
  rosterLoading?: boolean;
  roomNames?: ReadonlyMap<string, string>;
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

/** HOW LONG ANY MESSAGE HANGS OVER ITS SENDER'S HEAD, ms. V1's own spatial bubble life, and the ONE
 *  figure for both kinds of bubble — a meeting message and a spatial message are the same thing
 *  happening in two places, so they get the same life and the same timer, below. */
const OVERHEAD_BUBBLE_MS = 4500;
/** A long message belongs in the panel; over a head it is a preview and an invitation to open it. */
const MEETING_BUBBLE_CHARS = 70;

function bubbleText(text: string): string {
  return text.length <= MEETING_BUBBLE_CHARS ? text : `${text.slice(0, MEETING_BUBBLE_CHARS - 1)}…`;
}

/** THE ONE OVERHEAD-BUBBLE TIMER, used by the spatial path and the meeting path alike.
 *
 *  This is V1's own mechanism, lifted verbatim out of handleTalkingMessage: per-person state, a
 *  per-person timeout that removes the entry when it expires, and a ref of live timers so they can all
 *  be cancelled at once. The meeting bubbles USED to be derived instead — a useMemo that filtered
 *  `messages` on `Date.now() - atMs`, which is correct the instant it runs and wrong every instant
 *  after, because nothing schedules a render at expiry. A meeting bubble therefore sat over its
 *  sender's head until the next unrelated render happened to knock it off, which is the "stays
 *  visible for too long" being fixed here. Derivation cannot expire anything; only a clock can.
 *
 *  `show` RESTARTS the life on every message: the previous timeout is cancelled before the new one is
 *  armed, so a fast second message cannot be cut short by the first one's expiry (V1 overwrote the
 *  handle without cancelling, and had exactly that bug). */
function useOverheadBubbles(ttlMs: number) {
  const [texts, setTexts] = useState<Record<string, string>>({});
  const timersRef = useRef<Record<string, number>>({});

  const clearAll = useCallback(() => {
    for (const id of Object.values(timersRef.current)) window.clearTimeout(id);
    timersRef.current = {};
    setTexts((prev) => (Object.keys(prev).length === 0 ? prev : {}));
  }, []);

  const show = useCallback((key: string, text: string) => {
    window.clearTimeout(timersRef.current[key]);
    setTexts((prev) => ({ ...prev, [key]: text }));
    timersRef.current[key] = window.setTimeout(() => {
      delete timersRef.current[key];
      setTexts((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }, ttlMs);
  }, [ttlMs]);

  // No bubble may outlive the overlay that owns it.
  useEffect(() => clearAll, [clearAll]);

  // MEMOISED because callers put this object in effect and callback dependency lists. A fresh object
  // every render would re-run the feed effect on every render and make handleTalkingMessage unstable
  // for the conversation views it is handed to.
  return useMemo(() => ({ texts, show, clearAll }), [texts, show, clearAll]);
}

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

/** PHASE 7E — the checkout states that put a PANEL on the screen, and therefore the ones during which
 *  nothing may dismiss anything on the employee's behalf. Everything else in the flow is either not
 *  started (IDLE), a toast (REMINDER_SHOWN) or finished (CHECKED_OUT). */
const CHECKOUT_PANEL_STATES: ReadonlySet<CheckoutState> = new Set<CheckoutState>([
  "CHECKOUT_CONFIRMATION", "SAYING_GOODBYE", "WALKING_TO_RECEPTION", "AT_RECEPTION",
  "EDITING_TIME_LOG", "REVIEWING", "SUBMITTING", "SUBMISSION_FAILED", "CHECKOUT_SUCCESS", "WALKING_TO_EXIT",
]);

export function Vo3dOverlay({ worldRef, ready, people, drawnEmails, attendance, rosterLoading = false, roomNames }: Vo3dOverlayProps) {
  const officeAccess = attendance.access;
  const self = selfEmailKey();
  const [selection, setSelection] = useState<Vo3dCoworkerSelection | null>(null);
  const [anchor, setAnchor] = useState<Vo3dScreenAnchor | null>(null);
  // ---- PHASE 7E: THE RECEPTION CHECK-IN KIOSK ------------------------------------------------------
  // Open only after WALKING to it (app/interactions.ts onInteractionArrived), which is why there is no
  // click-to-open path: the kiosk is a thing you use by standing at it, exactly as the seats and the
  // Cave portal are. `kioskPhase` is THIS CLIENT'S request state and nothing more — what is TRUE about
  // the work session is `attendance`, which comes from V1 and is never inferred from a button press.
  const [kioskOpen, setKioskOpen] = useState(false);
  const [kioskAnchor, setKioskAnchor] = useState<Vo3dScreenAnchor | null>(null);
  const [kioskPhase, setKioskPhase] = useState<"idle" | "submitting" | "failed">("idle");
  /** THE DOUBLE-SUBMIT GUARD, a ref and not state for the reason V1's own `checkinRequestPendingRef` is
   *  one: two clicks in the same frame both read the state from the same render, so only a value that
   *  changes synchronously can refuse the second one. */
  const kioskPendingRef = useRef(false);
  /** THE WELCOME HUB, ONCE PER WORK SESSION.
   *
   *  V1 ends its check-in by opening the Company Hub in "checkin" mode (OfficeMap.tsx's finishArrival),
   *  which is the "what's new / here is your day" screen whose primary button is "Enter Office". V2 had
   *  the same Hub — the HUD's button opens it in "manual" mode — but nothing opened it on arrival, so the
   *  welcome was simply missing from the V2 journey. It is opened HERE, from the one place that learns a
   *  check-in actually happened in V2: the kiosk's confirmed response.
   *
   *  KEYED ON THE SERVER'S `checked_in_at`, the same session identity the checkout flow's new-session
   *  reset uses. A second confirmed answer for the SAME session (a retry whose first response was lost)
   *  reopens nothing; a genuinely new session after a checkout is a new welcome, which is V1's behaviour
   *  too. A failed or unconfirmed check-in never reaches this, and neither does a session that was
   *  already open when the view mounted — a refresh, a V1→V2 view switch, or another tab's check-in are
   *  all observations of an existing session, not this client checking in. */
  const welcomeHubSessionRef = useRef<string | null>(null);

  // ---- PHASE 7E: LEAVING ---------------------------------------------------------------------------
  // V1'S CHECKOUT STATE MACHINE, and the only instance of it in V2. It was created in the HUD when the
  // working-time pill was all that read it; the exit journey drives it, so it lives here with the handlers
  // that change it and is handed down. Two instances would be two state machines over one stored draft.
  //
  // `timeInMs` is the SERVER's checked_in_at, not a mount timestamp, so a reload — or a second browser —
  // resumes the same session rather than restarting the clock. V1's rule, kept.
  const liveTimeInMs = useMemo(() => {
    if (attendance.record?.status !== "CHECKED_IN") return null;
    const parsed = attendance.record.checkedInAt ? Date.parse(attendance.record.checkedInAt) : NaN;
    return Number.isFinite(parsed) ? parsed : Date.now();
  }, [attendance.record]);
  /** THE SESSION THAT JUST ENDED STILL HAS A LENGTH.
   *
   *  `liveTimeInMs` is null the moment attendance reads CHECKED_OUT, which is correct for the HUD pill and
   *  wrong for the success card: it reported "Not checked in yet" against the very day it had just logged.
   *  The start time is therefore held for as long as the flow is still showing something about that
   *  session, and released once it is dismissed and the flow is idle again. */
  const lastSessionStartRef = useRef<number | null>(null);
  if (liveTimeInMs !== null) lastSessionStartRef.current = liveTimeInMs;
  const employeeId = getCurrentUserId();
  // `hourDecimal` is part of the params for API stability and is not read by the reminder trigger.
  const checkoutFlow = useCheckoutFlow({ employeeId, timeInMs: liveTimeInMs ?? lastSessionStartRef.current, hourDecimal: 0 });
  /** What the PANELS are told. The flow itself always gets the held value (its own worked-time maths must
   *  not go blank mid-checkout); the panels drop it once everything is dismissed and idle again. */
  const timeInMs = liveTimeInMs ?? (checkoutFlow.state === "IDLE" ? null : lastSessionStartRef.current);
  const [exitOpen, setExitOpen] = useState(false);
  const [exitAnchor, setExitAnchor] = useState<Vo3dScreenAnchor | null>(null);
  const [successCardDismissed, setSuccessCardDismissed] = useState(false);
  /** Is V1's checkout flow mid-journey? Read inside the world's own callback, which is bound once and must
   *  not close over a stale value. */
  const checkoutBusyRef = useRef(false);
  const [frozenCheckoutAtMs, setFrozenCheckoutAtMs] = useState<number | null>(null);
  /** IS THE VIEWER OUT OF THE BUILDING? The world's own boundary answer (app/interactions.ts).
   *
   *  This used to be "is the body standing inside the AI Lab", and that was the bug: the Lab's own floor
   *  is one patch of an excursion that also crosses the campus and the pavement, so presence flicked back
   *  to Available the moment somebody stepped off it — including for the whole walk home. The excursion is
   *  the thing being described, and its boundary is the building's, not the Lab's. */
  const [outsideBuilding, setOutsideBuilding] = useState(false);
  /** V1's own gate on the checkout UI: without a real Zoho integration the flow logs into the void, so the
   *  row is not offered. Identical condition to OfficeMap.tsx's. */
  const checkoutOffered = import.meta.env.DEV || isRealZohoMode();

  // A NEW WORK SESSION RESETS THE FLOW, exactly as V1's applyAttendance({ newSession: true }) does.
  // Without it, an employee who checked out earlier today and then checked in again at the kiosk finds the
  // flow still resumed to CHECKED_OUT from local storage — the availability picker stays disabled and the
  // working-time pill renders nothing.
  //
  // DERIVED FROM THE SERVER RECORD, NOT FROM THE BUTTON. V1 can be imperative because it OWNS the
  // transition; V2 observes one that may equally have happened in another tab or in V1 itself, so the
  // server's `checked_in_at` IS the session identity. Comparing against the marker `saveSessionStart`
  // already writes is what makes it fire exactly once per real check-in — running it on every mount would
  // throw away an employee's unsent time-log entries on a page refresh.
  useEffect(() => {
    const startedAt = attendance.record?.status === "CHECKED_IN" ? attendance.record.checkedInAt : null;
    if (!startedAt) return;
    if (loadSessionStart(employeeId, manilaWorkDate())?.startedAt === startedAt) return;
    checkoutFlow.beginNewSession(startedAt);
    setSuccessCardDismissed(false);
    setFrozenCheckoutAtMs(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendance.record?.status, attendance.record?.checkedInAt, employeeId]);

  useEffect(() => {
    if (checkoutFlow.submissionResult?.submittedAt) setFrozenCheckoutAtMs(new Date(checkoutFlow.submissionResult.submittedAt).getTime());
  }, [checkoutFlow.submissionResult]);
  // WHICH STATES ACTUALLY OWN THE SCREEN. Written as the list rather than as "not IDLE", because the two
  // that look busy and are not matter: REMINDER_SHOWN is the 8-hour TOAST — a nudge, not a panel, and one
  // that is showing for anybody who has been on the clock a while — and CHECKED_OUT is the finished state.
  // Treating either as busy silently disabled the auto-dismiss for exactly the people most likely to be
  // walking to the door.
  /** IS A CHECKOUT PANEL OWNING THE SCREEN RIGHT NOW? One derivation, read by three things: the busy guard
   *  below, the HUD's own "a tool owns the screen" line, and the wrapper that makes it a real modal. */
  const checkoutPanelOpen = CHECKOUT_PANEL_STATES.has(checkoutFlow.state) || (checkoutFlow.state === "CHECKED_OUT" && !successCardDismissed);
  checkoutBusyRef.current = CHECKOUT_PANEL_STATES.has(checkoutFlow.state);

  // PLAYER's "[E] …" line is drawn dead centre, which is exactly where a checkout panel's primary button
  // sits — the two were overlapping. Driven from the SAME `checkoutPanelOpen` the dock and the modal role
  // already use, so it cannot get out of step with them, and restored the moment the panel closes.
  useEffect(() => {
    worldRef.current?.setInteractionPromptHidden?.(checkoutPanelOpen);
  }, [checkoutPanelOpen, ready, worldRef]);
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
  /** WHICH BOARD IS OPEN, if any — V1's own `whiteboardTarget`, shape for shape. One at a time, because
   *  the panel owns the screen; null is closed.
   *
   *  THE SCOPE IS V1'S CONTRACT, unchanged: `{kind:"conversation"}` for a DM **and** a group (there is no
   *  second contract for the two — a conversation id is a conversation id), `{kind:"room"}` for a room's
   *  boards. Nothing here creates, names or persists anything; services/whiteboard owns all of it. */
  const [whiteboardTarget, setWhiteboardTarget] = useState<{ scope: WhiteboardScope; title: string } | null>(null);
  const openConversationBoard = useCallback((conversationId: string, title: string) => {
    setWhiteboardTarget({ scope: { kind: "conversation", id: conversationId }, title });
  }, []);
  const [profileEmail, setProfileEmail] = useState<string | null>(null);
  // WHERE THE PROFILE SHOULD LAND when something opened it with a destination in mind (today: a feed-post
  // notification, which wants the Feed tab with that post highlighted). V1's own `profileLanding`, reset
  // on CLOSE — the panel's single exit point — so a profile opened any other way (the dock pill, the
  // interaction menu, Search, the Map) always lands on the default tab.
  const [profileLanding, setProfileLanding] = useState<Vo3dProfileLanding>({ tab: "profile", postId: null });
  /** THE ONE PROFILE OPENER. Every caller goes through it, so the landing can never be left over from a
   *  previous open: an ordinary open explicitly resets it. */
  const openProfile = useCallback((email: string, landing?: Vo3dProfileLanding) => {
    setProfileLanding(landing ?? { tab: "profile", postId: null });
    setProfileEmail(email);
  }, []);
  /** ROOM DETAILS — the selected room, as the V1 MANIFEST room layer id the world reports. One at a time,
   *  exactly like the selected coworker, and null means the panel is closed. */
  const [roomDetailsId, setRoomDetailsId] = useState<string | null>(null);
  /** ROOM DISCOVERY — are the room-name labels up. A view-independent preference: switching to PLAYER
   *  hides them without forgetting that they were on, so coming back restores what the employee chose. */
  const [roomDiscovery, setRoomDiscovery] = useState(false);
  /** WHICH CAMERA IS DRIVING, from the world's own feed — the same one the HUD reads, so the labels and
   *  the dock can never disagree about which view is on screen. */
  const [viewMode, setViewMode] = useState<"office" | "explore" | "player">("office");
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
    // PHASE 7E — OUT OF THE OFFICE. The AI Lab, the campus between here and there, and the walk back: one
    // excursion, one answer, held for all of it. Still checked in, still on the clock, simply not at their
    // desk — and it ends only on confirmed re-entry past the façade, which is reachable solely through the
    // entrance, so walking up to the building from outside changes nothing.
    //
    // IT FORCES NOTHING. `away` is one auto condition among several; V1's own precedence (status.ts:
    // OFFLINE > DND > IN_CALL > IN_CONVERSATION > AWAY > manual) decides what is actually shown, so a
    // checked-out viewer still reads OFFLINE, a call still reads IN_CALL, and coming back in simply
    // uncovers whatever the person had chosen for themselves.
    away: outsideBuilding,
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
  /** What each person just said, cleared on V1's own 4.5s timer (useOverheadBubbles). */
  const spatialBubbles = useOverheadBubbles(OVERHEAD_BUBBLE_MS);
  const talkingTextById = spatialBubbles.texts;
  /** IS THE VIEWER TYPING IN THE SPATIAL CHAT. Fed by the spatial panel's onTypingChange — real keystroke
   *  activity on V1's own 2.5s idle timer, never send history.
   *
   *  A BOOLEAN, not V1's nullable conversation id. V1 stores the id because it ALSO scopes the agree
   *  gesture to a particular session; but ConversationView calls onTypingChange(true) before its
   *  conversation id has resolved, so keying the indicator off the id hides the first keystrokes of every
   *  new conversation. The overhead is asking "am I typing", and that is the value it gets; the session
   *  scoping is done separately, against the live session membership, where it belongs. */
  const [selfTyping, setSelfTyping] = useState(false);
  // THE TOUCAN'S two-value share of this block — the rest of it (the board context, the return briefing,
  // the release and the panel itself) lives together further down, under "THE TOUCAN". These two are
  // here because the conversation-pose pass below reads them, and V1 splits the same declaration for the
  // same reason.
  /** Is the assistant panel up. Its own lifetime: releasing closes it and deletes nothing, so reopening
   *  takes the panel's MOUNT path and lands back in the same server-side conversation. NOT what the
   *  controls set — the bird is called first and this follows on its arrival. */
  const [toucanOpen, setToucanOpen] = useState(false);
  /** Has the bird been CALLED. V1's `toucanCalled`: the intent, held here, separate from where the bird
   *  has actually got to. */
  const [toucanCalled, setToucanCalled] = useState(false);
  /** Where the bird has got to, straight off the world — "roaming" until it is called, "approaching"
   *  while it is in the air, "attending" once it is parked beside this body. */
  const [toucanState, setToucanState] = useState<ToucanSummonState>("roaming");
  /** A reply is being prepared. Drives the bird's world-space pill and nothing else: V1 is explicit that
   *  the pill carries BIRD TALK only and must never mirror the assistant's real answer, which is why the
   *  panel reports a boolean here and there is no channel through which text could reach the bird. */
  const [toucanPending, setToucanPending] = useState(false);
  /** Real keystrokes in the Toucan composer, on the panel's own idle timer. Fed ONLY to the body's
   *  conversation pose — never to the overhead typing dots, which V1 deliberately leaves out too. */
  const [toucanTyping, setToucanTyping] = useState(false);

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
    // PHASE 7D: ONLY A ROW SOMEBODY ACTUALLY WROTE BECOMES A SPEECH BUBBLE. `messages` now also carries
    // system records (a missed call), whose text is "" — without this they would pop an EMPTY bubble
    // over the caller's body in the V2 world, through the overhead layer Phase 7A/7B built.
    if (!isAuthoredMessage(msg)) return;
    const email = emailKey(msg.senderId) === self ? SELF_OVERHEAD_KEY : emailKey(msg.senderId);
    spatialBubbles.show(email, msg.text);
  }, [self, spatialBubbles]);

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
      // PHASE 7E — WALKED UP TO A FIXTURE. Reception's kiosk is the only one that opens anything today;
      // every other walk-up point is still the ambient "you are here" it has always been.
      onInteractionArrived: (entityId) => {
        if (entityId !== KIOSK_INTERACTION_ID) return;
        setKioskPhase("idle");
        setKioskOpen(true);
      },
      // PHASE 7E — they walked up to the exit and the world stopped them. Ask what leaving means.
      onExitIntercepted: () => setExitOpen(true),
      // …and they walked off without answering. Close the card: the question was about leaving, and they
      // are not leaving. NOTHING is authorised by this, exactly as Cancel authorises nothing — walking
      // back up to the doors asks again.
      //
      // A CHECKOUT IN PROGRESS IS NEVER INTERRUPTED. Once Check Out is chosen the card is already closed
      // and V1's own panels own the screen, with the draft they are holding; the guard is explicit anyway,
      // because "the dialog closes itself" must never be able to mean "somebody's time log vanished".
      onExitAbandoned: () => {
        if (checkoutBusyRef.current) return;
        setExitOpen(false);
      },
      onZoneChanged: (zone) => setOutsideBuilding(zone === "outside"),
      // ROOM DETAILS — V1's own room click, in V2's world. The world reports which of its floor regions
      // was picked (a manifest room id, or null for the hall / a person / a fixture / outside); what that
      // room CONTAINS is resolved here from V1's roster, in app/roomDetails.ts.
      onRoomSelected: (roomId) => setRoomDetailsId(roomId),
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

  // ---- PHASE 7D: WHERE THE CAMERAS ARE SHOWN --------------------------------------------------------
  // THE CAVE HAS A SCREEN, so it does not need tiles. Its curved front panel and wings already render
  // every live camera in the meeting (media/CaveGallery, driven by the same callStore videoByIdentity
  // these tiles read), so a floating tile over each body inside the Cave is the SAME video drawn twice —
  // once at meeting scale on the wall everyone is looking at, and once as a postage stamp above a head
  // in front of it, the viewer's own included.
  //
  // SUPPRESSED, NOT DISABLED. Nothing here turns a camera off, detaches a shared track, leaves the room
  // or touches call state: the overheads simply stop being given a track while the viewer is in the
  // Cave, so React unmounts those tiles and CallVideoElement detaches each one with ITS OWN element —
  // leaving the gallery's attachment to the very same track untouched. Walking out hands the tracks
  // back and the tiles return, because this is derived state and nothing was destroyed.
  //
  // ONE SOURCE FOR "AM I IN THE CAVE": the world's own caveMeeting feed, which is CaveTransition's
  // `inside` — the same flag the Cave panel appears on. No second notion of location.
  const [insideCave, setInsideCave] = useState(false);
  useEffect(() => {
    const world = worldRef.current;
    if (!ready || !world?.caveMeeting) return;
    return world.caveMeeting.subscribe((s) => setInsideCave(s.inside));
  }, [ready, worldRef]);

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

  // THE KIOSK CARD FOLLOWS THE BODY, for the same reason and through the same loop shape. The employee is
  // standing AT the kiosk when this opens, so their own anchor is the kiosk's position on screen — and it
  // still moves, because the camera does (a pan in OFFICE, every frame in PLAYER). `selfAnchor` is the
  // world's existing API for exactly this; nothing new is measured.
  useEffect(() => {
    if (!kioskOpen) {
      setKioskAnchor(null);
      return;
    }
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const next = worldRef.current?.selfAnchor() ?? null;
      setKioskAnchor((prev) => {
        if (!next) return prev === null ? prev : null;
        if (prev && prev.visible === next.visible && Math.abs(prev.clientX - next.clientX) < 0.5 && Math.abs(prev.clientY - next.clientY) < 0.5) return prev;
        return next;
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [kioskOpen, worldRef]);

  // THE CHECK-IN ITSELF — V1's `startCheckin`, restated with V2's consequences instead of V1's walk.
  //
  // ONE AUTHORITY: `attendanceService.checkIn()` is the same call V1's Reception menu makes, against the
  // same endpoint and the same `employee_attendance` row. Nothing here decides that somebody is checked in;
  // the server does, and a response that is not CHECKED_IN is treated as a FAILURE rather than believed —
  // V1 throws on exactly that case too.
  //
  // THE GATE OPENS BECAUSE THE SHARED ANSWER CHANGED, not because this handler opened it. `attendance.apply`
  // publishes the confirmed record into the one poller every reader shares (adapters/v1Attendance), and
  // app/Vo3dHost.tsx's existing effect pushes the resulting access into the world. There is no second path
  // to the gate and this function knows nothing about walkability.
  const runCheckIn = useCallback(() => {
    if (kioskPendingRef.current) return;
    kioskPendingRef.current = true;
    setKioskPhase("submitting");
    attendanceService
      .checkIn(getCurrentUserId())
      .then((record) => {
        if (record?.status !== "CHECKED_IN") throw new Error("Check-in not confirmed by server");
        attendance.apply(record);
        setKioskPhase("idle");
        // THE WELCOME. The kiosk card has nothing left to say once the answer is green, and the Hub is a
        // full-screen overlay, so the card is closed rather than left floating behind it; walking up
        // again reopens it exactly as before.
        const sessionKey = record.checkedInAt ?? "checked-in";
        if (welcomeHubSessionRef.current !== sessionKey) {
          welcomeHubSessionRef.current = sessionKey;
          setKioskOpen(false);
          openCompanyHub("checkin");
        }
      })
      .catch(() => {
        // FAIL CLOSED: the shared answer is left exactly as V1 last stated it, so nothing is granted on a
        // failed request. A retry is offered; `refresh` asks V1 again in case the write actually landed
        // and only the response was lost, which is also what stops a retry from double-checking-in.
        setKioskPhase("failed");
        attendance.refresh();
      })
      .finally(() => {
        kioskPendingRef.current = false;
      });
  }, [attendance]);

  // The exit card follows the body, through the same loop and for the same reason as the kiosk card.
  useEffect(() => {
    if (!exitOpen) {
      setExitAnchor(null);
      return;
    }
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const next = worldRef.current?.selfAnchor() ?? null;
      setExitAnchor((prev) => {
        if (!next) return prev === null ? prev : null;
        if (prev && prev.visible === next.visible && Math.abs(prev.clientX - next.clientX) < 0.5 && Math.abs(prev.clientY - next.clientY) < 0.5) return prev;
        return next;
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [exitOpen, worldRef]);

  /** THE AI LAB. An authorised departure and nothing else: the exit opens for this one trip, the world is
   *  told where they are going so peers see them arrive there rather than stop at the façade, and the work
   *  session is not touched in any way. No attendance call, no status write, no check-out. */
  const goToAiLab = useCallback(() => {
    setExitOpen(false);
    worldRef.current?.setDepartureDestination("ai-lab");
    worldRef.current?.setExitAuthorized(true);
  }, [worldRef]);

  /** CHECK OUT. Hands straight to V1's own flow at its own entry point. The exit stays SHUT: it is opened
   *  by the effect below, once that flow has actually reached CHECKED_OUT. */
  const startCheckout = useCallback(() => {
    setExitOpen(false);
    setSuccessCardDismissed(false);
    checkoutFlow.startCheckout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutFlow.startCheckout]);

  /** CANCEL. Closes the card and does nothing else — the exit stays held, and the work session is
   *  untouched. Escape and an outside press land here too. */
  const cancelExit = useCallback(() => setExitOpen(false), []);

  // THE ONE PLACE V2 ENDS A WORK SESSION, and it is downstream of everything.
  //
  // V1's rule, restated with V2's consequences: an explicit checkout is the ONLY thing that ends the
  // server-side session, and it is reached solely through Log Time → submit → exit. `useCheckoutFlow` gets
  // to CHECKED_OUT only after a successful Zoho submission, so the POST below cannot run before the time
  // log is safely recorded — which is also why it is keyed on the flow's transition rather than on a
  // button. A failed or abandoned submission never reaches this state, so attendance is left alone.
  //
  // IT CANNOT DOUBLE-SUBMIT: the effect fires on the EDGE into CHECKED_OUT, and the pending ref refuses a
  // second call while one is in flight.
  // THE LAST TWO TRANSITIONS, WHICH V2 HAD NO ONE TO MAKE.
  //
  // `useCheckoutFlow` stops at CHECKOUT_SUCCESS: reaching CHECKED_OUT takes `startExitWalk()` then
  // `finishExit()`, and in V1 those are driven by its scripted walk out of the building. V2 has no such
  // walk — the employee walks themselves — so nobody called them, and the flow sat at CHECKOUT_SUCCESS
  // forever. Nothing downstream ever ran: no success card (it renders only at CHECKED_OUT), no attendance
  // POST, no goodbye and no door. A submitted time log simply went quiet.
  //
  // So they are passed through here, immediately and in the hook's own order — the same thing this file
  // already does with SAYING_GOODBYE and WALKING_TO_RECEPTION at the other end of the flow, and for the
  // same reason: the states describe a walk V2 does not perform. Reached ONLY from a successful
  // submission, because CHECKOUT_SUCCESS is reachable only from one.
  useEffect(() => {
    if (checkoutFlow.state !== "CHECKOUT_SUCCESS") return;
    checkoutFlow.startExitWalk();
    checkoutFlow.finishExit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutFlow.state]);

  const checkoutPostedRef = useRef(false);
  const prevFlowStateRef = useRef(checkoutFlow.state);
  useEffect(() => {
    const prev = prevFlowStateRef.current;
    prevFlowStateRef.current = checkoutFlow.state;
    if (checkoutFlow.state !== "CHECKED_OUT" || prev === "CHECKED_OUT") return;
    if (checkoutPostedRef.current) return;
    checkoutPostedRef.current = true;
    attendanceService
      .checkOut(employeeId)
      .then((record) => {
        attendance.apply(record);
        // THE DEPARTURE, and every part of it is something that already exists.
        //
        //   the goodbye   the SAME overhead bubble a chat message uses, on self's own reserved row.
        //   the doors     `setExitAuthorized` releases the exit reservation, so the entrance doors stop
        //                 being suppressed and open for the body on approach — SlidingDoor's own
        //                 behaviour, on its own timing — and close behind them on its own hold timer.
        //                 Nothing is animated or scripted here.
        //   the office    `record` is CHECKED_OUT, so the same answer that opens the exit re-holds
        //                 Reception's gates behind them. One fact, two consequences, no second switch.
        //
        // NOBODY IS MOVED. No teleport and no scripted walk: the employee walks out themselves, which is
        // why the door is opened rather than the body. And it happens ONLY here — downstream of a
        // confirmed Zoho submission and a confirmed attendance POST — so a failed or abandoned checkout
        // reaches none of it.
        spatialBubbles.show(SELF_OVERHEAD_KEY, "Ciao Ciao!");
        worldRef.current?.setExitAuthorized(true);
      })
      .catch(() => {
        // The local flow completed but the server did not hear it. Attendance is left exactly as V1 last
        // stated it — nothing is granted, nothing is revoked — and the next read reconciles.
        showToast("Checked out here, but the office couldn't save it. It will retry next time you open the office.");
      })
      .finally(() => {
        checkoutPostedRef.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutFlow.state]);

  /** What the card shows. V1'S ANSWER OUTRANKS THIS CLIENT'S REQUEST STATE in both directions: a confirmed
   *  CHECKED_IN closes off the action even if this tab still thinks a request failed, and an unconfirmed
   *  answer never offers one. */
  const kioskState: Vo3dKioskState = useMemo(() => {
    if (kioskPhase === "submitting") return "submitting";
    if (officeAccess === "permitted") return "checkedIn";
    if (kioskPhase === "failed") return "failed";
    if (officeAccess === "denied") return "checkedOut";
    return "unknown";
  }, [kioskPhase, officeAccess]);

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

  // ---- PHASE 7D: THE MEETING'S CHAT ------------------------------------------------------------
  // SUBSCRIBED TO THE MEETING THIS CLIENT IS ACTUALLY IN, and to nothing else. `connectedMeetingId`
  // is the call store's own answer, so there is no second idea of meeting membership — and because
  // joinMeetingChat is idempotent for the same id, leaving the Cave and walking back into the same
  // live meeting re-uses the subscription rather than opening a second one.
  const meetingChat = useMeetingChat();
  const connectedMeetingId = callState.connectedMeetingId;
  // GATED ON *CONNECTED*, NOT MERELY ON HAVING AN ID. `connectedMeetingId` is set the moment the
  // handshake begins, but the server only counts somebody as a participant once their media socket has
  // announced `call_joined` — which happens after it resolves. Asking for the history in between is a
  // request from somebody the server does not yet see in the meeting, and it is answered with nothing:
  // a rejoin came back to an empty panel while everybody else still had the conversation.
  const inMeeting = Boolean(connectedMeetingId) && callState.status === "connected";
  useEffect(() => {
    if (!inMeeting || !connectedMeetingId) {
      leaveMeetingChat();
      return;
    }
    joinMeetingChat(connectedMeetingId);
  }, [inMeeting, connectedMeetingId]);

  // Reactions expire on the frame loop that is already running for the overhead anchors rather than
  // on a timer of their own, so a meeting with nothing happening in it costs nothing.
  useEffect(() => {
    if (meetingChat.reactions.length === 0) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      expireReactions();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [meetingChat.reactions.length]);

  /** WHAT EACH PERSON IN THE MEETING JUST SAID OR SENT, keyed the way the overhead layer keys
   *  everybody — email, with the viewer under the reserved self key. A meeting message becomes the
   *  SAME world-space bubble a spatial message does, so a reader does not have to learn a second
   *  visual language for "they said something"; a long one stays in the panel and only previews. */
  const meeting = useOverheadBubbles(OVERHEAD_BUBBLE_MS);
  const meetingBubbles = meeting.texts;
  /** Message ids already handled. Without it every render would re-show the whole feed, and a late
   *  joiner's history — which arrives in one batch — would pop a bubble over everybody at once. */
  const seenMessagesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!inMeeting) return;
    const now = Date.now();
    for (const m of meetingChat.messages) {
      if (seenMessagesRef.current.has(m.id)) continue;
      seenMessagesRef.current.add(m.id);
      // History is remembered so it is never shown twice, but only a message that is still WITHIN its
      // life becomes a bubble — replayed backlog belongs in the panel, not over a head.
      if (now - m.atMs > OVERHEAD_BUBBLE_MS) continue;
      meeting.show(m.email === self ? SELF_OVERHEAD_KEY : m.email, bubbleText(m.text));
    }
  }, [inMeeting, meetingChat.messages, meeting, self]);

  // LEAVING OR ENDING THE MEETING TAKES ITS BUBBLES WITH IT. Without this the last thing said would
  // hang over people for up to a full bubble-life after the meeting they said it in stopped existing,
  // and the ids would still be marked seen if the same meeting were rejoined.
  useEffect(() => {
    if (inMeeting) return;
    seenMessagesRef.current = new Set();
    meeting.clearAll();
  }, [inMeeting, meeting]);

  const meetingReactions = useMemo(() => {
    const out: Record<string, string> = {};
    for (const r of meetingChat.reactions) {
      out[r.email === self ? SELF_OVERHEAD_KEY : r.email] = r.token;
    }
    return out;
  }, [meetingChat.reactions, self]);

  // ---- PHASE 7D: reaching the call you are already in ------------------------------------------------
  // THE EXPANDED VIEW is V1's own components/OfficeMap/CallOverlay, mounted here exactly as V1 mounts it:
  // pure UI state, no call lifecycle. It is the only place either office renders the other side's CAMERA,
  // and V2 previously had no way to open it at all — the chat header's Expand button was never given a
  // handler, so a video call in V2 was audible and invisible.
  const [callExpanded, setCallExpanded] = useState(false);
  // A call that ends takes its expanded view with it, so the next call does not open into a stale one.
  useEffect(() => {
    if (callState.status !== "connected") setCallExpanded(false);
  }, [callState.status]);

  // THE POINTER LOCK, RELEASED ONLY WHERE AN ANSWER IS REQUIRED. A pointer-locked player cannot click any
  // DOM, so a ring they cannot accept and an expanded view they cannot leave are both dead ends. These
  // are the same two conditions Vo3dHud already applies to its own tools (officeToolOpen) — releasing the
  // lock does NOT stop PLAYER or move the body; PlayerInput clears its held keys on the way out.
  //
  // Deliberately NOT released merely because a call is connected: taking the mouse off somebody mid-walk
  // every time a colleague speaks would be worse than the problem it solved. The call bar stays visible
  // while locked and says which key returns the mouse.
  useEffect(() => {
    if (!callState.incoming && !callExpanded) return;
    if (isPointerLocked()) document.exitPointerLock();
  }, [callState.incoming, callExpanded]);

  // WHERE THE TOP-CENTRE CALL COLUMN STARTS in V2. The dev route's "Back to V1" escape hatch is parked
  // at top: 12 / z-index 1003 in that same column (app/Vo3dHost.tsx), so the call notice and the call bar
  // begin below it here and at the window edge in V1. Published as the one variable both stylesheets
  // read, exactly as the dock publishes its own clearance.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--vo-call-notice-top", "52px");
    return () => {
      root.style.removeProperty("--vo-call-notice-top");
    };
  }, []);

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
        openProfile(email);
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
      activeSpatialSession, closeMenu, dismissMenu, dndEmails, officeAccess, openProfile, self,
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
      // PHASE 7D — a meeting message outranks a spatial one for the same person: it is the newer
      // thing they said, and in a meeting it is the conversation everybody is in.
      const sentText = meetingBubbles[email] ?? talkingTextById[email];
      const typing = typingIds.has(email);
      const attention = chatAttention[email];
      // IN CONVERSATION, from V1's OWN signal. V1 reads a peer's presence off Atlas, which the mock rig
      // never updates; the server-broadcast spatial_sessions feed carries the same fact to every client
      // and is what V1 itself drives the peer talking visual from (its talkingCharacterIdsFromSessions).
      // It only ever UPGRADES the label — it never suppresses a message or the typing dots above it.
      const status = inConversationEmails.has(email) ? "IN_CONVERSATION" : statusByEmail[email];
      // PHASE 7D — THEIR CAMERA. callStore keys videoByIdentity by the LiveKit identity, which is the
      // lowercased email the token was minted for, so it is already the same key the bodies are drawn
      // under — no mapping, no lookup table, and no way for a track to land over the wrong person. The
      // map only ever contains participants of the room THIS client is connected to, so nothing is
      // shown for a call the viewer is not in.
      // Inside the Cave the meeting's own screen shows this camera — see the note above.
      const video = insideCave ? undefined : callState.videoByIdentity[email];
      const reaction = meetingReactions[email];
      // Somebody V1 has no status for AND who has nothing to say gets no overhead at all — V1 renders
      // nothing for them either, rather than an empty pill. A live camera is reason enough on its own.
      if (!sentText && !typing && !attention && !status && !video && !reaction) continue;
      const layer = layersByEmail.get(email);
      const displayName = layer?.name?.trim() || email.split("@")[0] || email;
      out.push({
        email,
        displayName,
        ...(sentText ? { sentText } : {}),
        ...(typing ? { typing } : {}),
        ...(attention ? { unread: { conversationId: attention.conversationId, count: attention.count } } : {}),
        ...(video ? { video } : {}),
        ...(reaction ? { reaction } : {}),
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
    const selfText = meetingBubbles[SELF_OVERHEAD_KEY] ?? talkingTextById[SELF_OVERHEAD_KEY];
    const selfReaction = meetingReactions[SELF_OVERHEAD_KEY];
    // THE VIEWER'S OWN CAMERA rides the same map under the viewer's own identity — callStore puts the
    // local camera in videoByIdentity deliberately, "so self video needs no separate field". Anchored to
    // the player's own body by the reserved self key, exactly as their nameplate is.
    const selfVideo = insideCave ? undefined : callState.videoByIdentity[self];
    if (selfStatus || typingIds.has(self) || selfText || selfVideo || selfReaction) {
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
        ...(selfVideo ? { video: selfVideo } : {}),
        ...(selfReaction ? { reaction: selfReaction } : {}),
        status: selfStatus ? {
          color: STATUS_META[selfStatus].color,
          shortName: "You",
          ...(ACTIVE_DETAIL_STATUSES.has(selfStatus) ? { detail: STATUS_META[selfStatus].label } : {}),
        } : undefined,
      });
    }
    // PHASE 7G — THE BIRD'S OWN PILL, on the one overhead layer this world already has. Anchored to the
    // toucan's world position rather than to a body (TOUCAN_OVERHEAD_KEY), and carrying BIRD TALK only:
    // one fixed string, shown while a reply is being prepared. V1 draws exactly this line and for exactly
    // this reason — the meaningful answer belongs in the panel, and a bird in an office behaves like a
    // bird.
    if (toucanPending) {
      out.push({ email: TOUCAN_OVERHEAD_KEY, displayName: "Toucan", sentText: "Squawk squawk…" });
    }
    return out;
  }, [callState.videoByIdentity, chatAttention, drawnEmails, inConversationEmails, insideCave, layersByEmail, meetingBubbles, meetingReactions, self, selfStatus, statusByEmail, talkingTextById, toucanPending, typingIds]);

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
    // AN OPEN TOUCAN SESSION IS A CONVERSATION, for the viewer's own body only. V1 does exactly this —
    // it adds the viewer's own layer id to the same two arrays this resolver is driven from — so talking
    // to the assistant animates through the EXISTING seam rather than a new one, and stops the same way.
    // Nothing is sent to anybody else: no chat conversation, no spatial session, no socket event.
    world.setConversationPoses(
      poses,
      conversationClipFor(inConversationEmails.has(self) || toucanOpen, typingIds.has(self) || (toucanOpen && toucanTyping)),
    );
  }, [drawnEmails, inConversationEmails, ready, self, toucanOpen, toucanTyping, typingIds, worldRef]);

  // ---- GLOBAL CHAT ACTIVITY (V1 parity) ------------------------------------------------------------
  // The presence fact V1 publishes and consumes through services/presence/globalChatActivityClient.ts,
  // restored here UNCHANGED: the same socket, the same `global_chat_active` / `global_chat_activity`
  // events, the same bare-boolean payload. No new network contract, and nothing about any conversation
  // leaves this client.
  //
  // TRUE while >=1 remote DM/group window is open and NOT minimized — V2's `remoteWindows` is the exact
  // twin of V1's `remoteChatWindows`. The SPATIAL window (openChat / openGroupConv) deliberately never
  // counts, in V2 as in V1: standing with somebody is not Global Chat.
  const selfGlobalChatActive = remoteWindows.some((w) => !w.minimized);
  // Edge-triggered, exactly as V1 does it: the client refcounts per socket, so repeated identical values
  // must not be emitted, and the ref is what makes an unchanged render silent.
  const selfGlobalChatActiveRef = useRef(false);
  useEffect(() => {
    if (selfGlobalChatActiveRef.current === selfGlobalChatActive) return;
    selfGlobalChatActiveRef.current = selfGlobalChatActive;
    emitGlobalChatActive(selfGlobalChatActive);
  }, [selfGlobalChatActive]);
  // CLEANUP — V1's own unmount rule. Leaving V2 (a view switch that unmounts the overlay, a sign-out, a
  // navigation) with a window still open must report false, or peers keep seeing this person answering
  // until the socket eventually drops.
  useEffect(
    () => () => {
      if (selfGlobalChatActiveRef.current) {
        selfGlobalChatActiveRef.current = false;
        emitGlobalChatActive(false);
      }
    },
    [],
  );
  // ---- SELF DND BROADCAST (V1 parity) ---------------------------------------------------------
  // V2 already CONSUMED dnd (useDndEmails above, and the talk/approach gate) and already rendered V1's
  // own StatusPicker, but it never PUBLISHED: emitDndSet had exactly one caller, OfficeMap's effect,
  // which does not run on the `?world=v2` route (App.tsx renders Vo3dHost INSTEAD of OfficeMap). So a V2
  // employee was blocked by everybody else's DND while their own stayed invisible. Restored here
  // UNCHANGED: the same service, the same `dnd_set` event, the same bare boolean.
  //
  // THE SAME EDGE-TRIGGER CONTRACT V1 USES, deliberately copied rather than reinvented — see
  // OfficeMap's prevSelfOfficeStatusRef: the ref is seeded with the CURRENT status so a fresh mount is
  // never mistaken for a transition, and only a real DND⇄not-DND crossing emits. Repeated renders,
  // AVAILABLE→BUSY→LUNCH moves and re-entering the route all stay silent, which is what the server's
  // per-socket refcount requires.
  //
  // DURATION AND EXPIRY NEED NOTHING HERE, by the store's own design: a DND session's expiry is what
  // flips `currentStatus` back off "DND" (services/presence/selfStatusStore.ts, whose comment names this
  // very effect as the thing that publishes it), so an expiring session emits `false` through exactly
  // this path. startDnd/endDnd keep owning the local state and the duration; this only reports it.
  //
  // NO DOUBLE EMIT: V1 and V2 are mutually exclusive routes (App.tsx returns the V2 tree instead of
  // OfficeMap), so the two effects can never be mounted at once; and within V2 this overlay is mounted
  // once. The ref makes a re-render idempotent regardless.
  const selfIsDnd = selfStatus === "DND";
  const prevSelfIsDndRef = useRef(selfIsDnd);
  useEffect(() => {
    if (prevSelfIsDndRef.current === selfIsDnd) return;
    prevSelfIsDndRef.current = selfIsDnd;
    emitDndSet(selfIsDnd);
  }, [selfIsDnd]);
  // CLEANUP — V1 has no unmount rule here and neither does this: DND is a durable, persisted session
  // (localStorage + expiry), not a window that is open or closed, so leaving the route must NOT tell
  // peers the employee is available again. The server's own disconnect handling owns that.

  // THE PEERS. Server-broadcast snapshot, authoritative on every (re)connect — so a V1 client's open
  // window is seen here and a V2 client's open window is seen there, which is the whole point of reusing
  // the service rather than inventing a V2 one. Self is OR'd in from the LOCAL derivation so the viewer's
  // own body reacts immediately and still works in mock mode with no socket at all.
  const globalChatActiveEmails = useGlobalChatActiveEmails();
  useEffect(() => {
    const world = worldRef.current;
    if (!ready || !world) return;
    const peers = new Set<string>();
    for (const email of globalChatActiveEmails) if (email !== self) peers.add(email);
    world.setGlobalChatActive(peers, selfGlobalChatActive || globalChatActiveEmails.has(self));
  }, [globalChatActiveEmails, ready, self, selfGlobalChatActive, worldRef]);

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

  // ---- ROOM DETAILS ---------------------------------------------------------------------------------
  // The whole panel, in three values. Nothing is fetched and nothing is subscribed: `people` is the host's
  // one roster and this recomputes whenever it changes, which is what keeps occupancy live as V1's
  // presence stream moves somebody between rooms.
  const roomDetails = useMemo(
    () => resolveRoomDetails({ roomId: roomDetailsId, people, roomNames, loading: rosterLoading, selfEmail: self }),
    [roomDetailsId, people, roomNames, rosterLoading, self],
  );

  /** WHICH EDGE THE PANEL DOCKS AGAINST. V1's rule, unchanged: a room on the right half of the floor
   *  opens the panel on the left, so the panel never covers the room it is describing. The room's own
   *  manifest rect is the measure, exactly as it is in OfficeMap. */
  const roomDetailsSide = useMemo<"left" | "right">(() => {
    const layer = roomLayers.find((r) => r.id === roomDetailsId);
    if (!layer) return "right";
    return layer.x + layer.width / 2 > FRAME_WIDTH / 2 ? "left" : "right";
  }, [roomDetailsId]);

  /** CLOSE, and tell the world — otherwise it still holds this room and a click on the very same floor
   *  would be deduped away as "already selected", opening nothing. The same contract clearCoworkerSelection
   *  has, for the same reason. */
  const closeRoomDetails = useCallback(() => {
    setRoomDetailsId(null);
    worldRef.current?.setSelectedRoom?.(null);
  }, [worldRef]);

  /** OPEN THE ROOM THE BODY IS STANDING IN — the dock's Room tile, and the only entry PLAYER mode can use
   *  (a pointer-locked player cannot click a floor region). The world answers from the SAME regions the
   *  click path reads, so the two entries can never disagree about which room you are in. */
  useEffect(() => {
    const world = worldRef.current;
    if (!ready || !world) return;
    return world.subscribeViewMode((mode) => setViewMode(mode));
  }, [ready, worldRef]);

  /** OFFICE AND 3D EXPLORE TAKE THE TREATMENT; PLAYER IS UNCHANGED. Not a preference — the labels are a
   *  DOM layer over a floor you are looking down at, and a first-person player is not looking down at
   *  one. Their Room tile keeps the behaviour it shipped with (see the tile handler below). */
  const roomLabelsVisible = roomDiscovery && viewMode !== "player";

  /** ESC DISMISSES THE LABELS. Deliberately BEFORE Room Details' own Escape would matter: the panel
   *  handles its own key while it is open, and this listener is only mounted while the labels are up, so
   *  the two never both act on one press. */
  useEffect(() => {
    if (!roomLabelsVisible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || isTypingTarget(e)) return;
      setRoomDiscovery(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [roomLabelsVisible]);

  /** A ROOM NAME WAS CLICKED. Exactly what a click on that room's FLOOR does — the world is told which
   *  room is selected (which frames it through the existing smooth focus) and the panel opens. The labels
   *  stay up: hopping from room to room is the whole point of discovery, and the panel is docked to one
   *  edge rather than over the floor. */
  const openRoomFromLabel = useCallback(
    (roomId: string) => {
      worldRef.current?.setSelectedRoom?.(roomId);
      setRoomDetailsId(roomId);
    },
    [worldRef],
  );

  const openCurrentRoom = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    // OFFICE / 3D EXPLORE: the tile is the discovery TOGGLE. The labels are how you pick a room there,
    // so opening one from the dock as well would be a second answer to the same question.
    if (viewMode !== "player") {
      setRoomDiscovery((on) => !on);
      return;
    }
    // PLAYER: unchanged. No labels are drawn, so the tile still opens the room the body is standing in.
    const roomId = world.currentRoomId?.() ?? null;
    if (!roomId) {
      showToast("Step into a room to see who’s in it.");
      return;
    }
    world.setSelectedRoom?.(roomId);
    setRoomDetailsId(roomId);
  }, [showToast, viewMode, worldRef]);

  /** SELECTING SOMEBODY FROM THE PANEL runs V1's EXISTING employee interactions and adds none of its own:
   *  it makes the same selection a click on their body makes (world.selectCoworkerByEmail, which is also
   *  what the dock's Search Locate does), so the anchored CoworkerActionMenu opens over them with Chat,
   *  Call, Approach, View Profile and Ask to Join already wired to `runAction`.
   *
   *  TWO HONEST FALLBACKS, because the roster lists people the world is not drawing (offline, or no 3D
   *  character yet) and because you cannot walk up to yourself:
   *    • self          → V1's own profile modal, which is what the HUD already opens for "me".
   *    • no body drawn → the same profile modal, rather than a card anchored to empty floor.
   *  Either way the room panel closes, exactly as V1's own character click closes its room sidebar. */
  const selectRoomPerson = useCallback(
    (email: string, _displayName: string) => {
      const key = emailKey(email);
      closeRoomDetails();
      if (key === self) {
        openProfile(key);
        return;
      }
      if (worldRef.current?.selectCoworkerByEmail?.(key)) return;
      openProfile(key);
    },
    [closeRoomDetails, openProfile, self, worldRef],
  );

  // ---- THE TOUCAN -----------------------------------------------------------------------------------
  // Every line below is a HOST concern. The assistant, its conversation, its actions, its permissions and
  // its error handling are the panel's and the service's, untouched.

  // (toucanOpen / toucanTyping are declared with the chat state far above, because the body's
  //  conversation pose — which is computed up there — reads both.)
  /** W5-C — the board the viewer pressed "Ask Toucan" on, from the dock's Boards panel. */
  const [toucanBoardContext, setToucanBoardContext] = useState<{ boardId: string; title: string } | null>(null);
  /** A5 — the catch-up that qualified as a genuine return, handed to the panel to speak once. */
  const [toucanReturnBriefing, setToucanReturnBriefing] = useState<ToucanCatchUp | null>(null);
  const toucanBriefedSinceRef = useRef<string | null>(null);

  /** V1's own toucan-chrome gate, in V2's terms: offered to somebody V1 says is checked in, and taken
   *  away again while the exit journey owns the screen — a parked assistant beside a departing avatar is
   *  exactly what V1 refuses to leave behind. */
  const toucanAvailable =
    attendance.record?.status === "CHECKED_IN" && checkoutFlow.state !== "CHECKED_OUT" && !checkoutPanelOpen;

  /** COME HERE — the one handler behind the summon button, the dock tile, the T key, a click on the bird
   *  itself and the Boards seam. It opens NOTHING: it tells the world to fly the bird, and the arrival
   *  effect below is what opens the assistant. That ordering is the whole difference between a companion
   *  and a chat icon, and it is V1's. */
  const callToucan = useCallback(() => {
    setToucanCalled(true);
    // OPTIONAL, like every other world verb this file reaches (selectCoworkerByEmail, caveMeeting): the
    // host can mount this overlay over a world that does not carry the bird, and a missing companion must
    // never be an exception on a button press.
    worldRef.current?.toucanSummon?.call();
  }, [worldRef]);

  /** RELEASE, V1's own: the panel closes, the bird is let go — and NOTHING is deleted. The transcript,
   *  the memories and the conversation id are the server's, so re-summoning takes the panel's mount path
   *  and lands back in the same conversation. The bird flies home to the hub's perch (world/Toucan). */
  const releaseToucan = useCallback(() => {
    setToucanCalled(false);
    worldRef.current?.toucanSummon?.release();
    setToucanOpen(false);
    setToucanBoardContext(null);
    setToucanReturnBriefing(null);
    setToucanPending(false);
    // Never leave the body stuck mid-gesture.
    setToucanTyping(false);
  }, [worldRef]);

  /** WHERE THE BIRD IS, pushed by the world on every real change and once on subscribe. */
  useEffect(() => {
    const world = worldRef.current;
    if (!ready || !world?.toucanSummon) return;
    return world.toucanSummon.subscribe(setToucanState);
  }, [ready, worldRef]);

  // ARRIVAL OPENS THE ASSISTANT — V1's own line, and the reason the controls do not open it themselves.
  // Gated on the INTENT as well as the state, so a bird that happens to be parked when somebody releases
  // it cannot re-open the panel behind them.
  useEffect(() => {
    if (toucanCalled && toucanState === "attending") setToucanOpen(true);
  }, [toucanCalled, toucanState]);

  // CHECKOUT (and anything else that takes the chrome away) LETS THE BIRD GO, exactly as V1 refuses to
  // leave it parked beside a departing avatar with an orphaned panel.
  useEffect(() => {
    if (!toucanAvailable && (toucanOpen || toucanCalled)) releaseToucan();
  }, [releaseToucan, toucanAvailable, toucanCalled, toucanOpen]);

  // THE POINTER LOCK, on the same rule the incoming ring and the expanded call use above: a panel a
  // pointer-locked player cannot click is a dead end, and the briefing can open this one without anybody
  // having touched the dock. Releasing the lock does not stop PLAYER or move the body.
  useEffect(() => {
    if (toucanOpen && isPointerLocked()) document.exitPointerLock();
  }, [toucanOpen]);

  /** The return card's Open button, which knows a conversation only by its id. Resolved against the rows
   *  this overlay ALREADY holds (useUnreadTotal) before asking the server for them again, and handed to
   *  the one conversation opener — the inbox's, the Map's and New Message's — so it cannot become a
   *  second way to open a conversation. */
  const openConversationById = useCallback((conversationId: string) => {
    const known = conversations.find((c) => c.id === conversationId);
    if (known) {
      openConversation(known);
      return;
    }
    void chatService
      .listConversations()
      .then((list) => {
        const conv = list.find((c) => c.id === conversationId);
        if (conv) openConversation(conv);
      })
      .catch(() => {});
  }, [conversations, openConversation]);

  // A5 — PROACTIVE RETURN BRIEFING, V1's implementation reached through V1's own modules. The trigger is
  // the server's catch-up and nothing else, and the dedup key is its frozen absence boundary, remembered
  // per viewer in localStorage by toucanReturnBriefing.ts — the SAME key V1's office writes, so a return
  // briefed in one world is never briefed again in the other.
  useEffect(() => {
    let cancelled = false;
    const unsubscribe = subscribeToucanChannelConnected(() => {
      Promise.resolve()
        .then(() => toucanService.getCatchUp())
        .then((catchUp) => {
          if (cancelled || !catchUp) return;
          const viewer = getCurrentUserId();
          const already = toucanBriefedSinceRef.current ?? readBriefedSince(viewer);
          if (shouldBriefOnReturn(catchUp, already)) setToucanReturnBriefing(catchUp);
        })
        .catch(() => {});
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!toucanReturnBriefing || !toucanAvailable) return;
    const since = toucanReturnBriefing.activity.since;
    if (toucanBriefedSinceRef.current === since) return;
    toucanBriefedSinceRef.current = since;
    writeBriefedSince(getCurrentUserId(), since);
    // SUMMONS THE BIRD, exactly as the button does — the briefing is Toucan coming to find you, so it
    // arrives the same way rather than materialising a panel out of nowhere.
    callToucan();
  }, [callToucan, toucanAvailable, toucanReturnBriefing]);

  /** W5-C's seam, from the dock's Boards panel. V1's own two lines: note the board, then summon — the
   *  EXISTING panel opens on arrival, scoped to that board. */
  const askToucanAboutBoard = useCallback((board: { id: string; title: string }) => {
    setToucanBoardContext({ boardId: board.id, title: board.title });
    callToucan();
  }, [callToucan]);

  /** ONE CONDITION for "a panel this file owns has the screen" — V1 lists `whiteboardTarget` in its own
   *  officeToolOpen for exactly this reason, so the dock, the pointer lock and the minimized-chat rail
   *  all step aside for a board the same way they do for Room Details. */
  const overlayToolOpen = profileEmail !== null || checkoutPanelOpen || roomDetailsId !== null || whiteboardTarget !== null;

  /** The FLAT room id for the open Room Details panel — the namespace a room's boards are keyed on, and
   *  null for a room that has no flat twin. */
  const roomBoardScope = useMemo(
    () => (roomDetailsId ? flatRoomIdForRoomLayer(roomDetailsId) : null),
    [roomDetailsId],
  );

  /** WHERE EACH WINDOW SITS. V1's own right-to-left stack (chatWindowLayout), so a spatial window and
   *  several Global Chat windows share one row instead of landing on top of each other. */
  /** THE MINIMIZED ONES. V1 turns a minimized Global Chat window into a circular avatar in a vertical
   *  rail at the bottom-right corner — not a header bar left lying in the row — so this is the same
   *  split it makes: out of the horizontal stack, into the rail. */
  const minimizedRemote = useMemo(() => remoteWindows.filter((w) => w.minimized), [remoteWindows]);

  const windowOffsets = useMemo(() => {
    const items: { key: string; minimized: boolean }[] = [];
    // The Toucan keeps the RIGHTMOST slot while it is open (it never minimizes), so a conversation
    // opened from its own return card lands BESIDE it rather than on top of it. V1's order.
    if (toucanOpen) items.push({ key: TOUCAN_WINDOW_KEY, minimized: false });
    for (const w of remoteWindows) if (!w.minimized) items.push({ key: w.key, minimized: false });
    if (openChat || openGroupConv) items.push({ key: SPATIAL_WINDOW_KEY, minimized: chatMinimized });
    // CLEAR THE RAIL. V1's own base offset: while anything is minimized, the horizontal stack starts to
    // the LEFT of the bubble column instead of underneath it.
    const base =
      FLOATING_CHAT_EDGE_MARGIN + (minimizedRemote.length > 0 ? CHAT_BUBBLE_SIZE + CHAT_BUBBLE_RAIL_GAP : 0);
    return computeFloatingChatRightOffsets(items, base);
  }, [chatMinimized, minimizedRemote.length, openChat, openGroupConv, remoteWindows, toucanOpen]);
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
      {kioskOpen && kioskAnchor?.visible && (
        <Vo3dKioskCard
          state={kioskState}
          anchor={{ clientX: kioskAnchor.clientX, clientY: kioskAnchor.clientY }}
          onCheckIn={runCheckIn}
          onClose={() => setKioskOpen(false)}
        />
      )}
      {exitOpen && exitAnchor?.visible && (
        <Vo3dExitCard
          anchor={{ clientX: exitAnchor.clientX, clientY: exitAnchor.clientY }}
          onAiLab={goToAiLab}
          onCheckOut={startCheckout}
          onCancel={cancelExit}
          showCheckOut={checkoutOffered}
          workedLabel={timeInMs === null ? undefined : checkoutFlow.workedLabel}
        />
      )}
      {checkoutOffered && (
        // THE V2 PRESENTATION WRAPPER. Two jobs and no logic:
        //
        //   • it carries the V2 theme, as CUSTOM PROPERTIES the shared checkout stylesheet already reads
        //     (see checkout.module.css's --vo-co-* contract). V1's office never renders this wrapper, so
        //     V1's checkout keeps the stylesheet's own defaults and is pixel-for-pixel unchanged.
        //   • it declares the modal, which is how V2's existing conventions learn about it: app/keyGuard
        //     treats a `role="dialog"` as owning the keyboard, so C and WASD stop reaching the world
        //     while a panel is up, without a single new listener.
        //
        // It is always mounted and never unmounts the panels: `hidden` is presentation, and the flow's
        // state, its draft and its Zoho work all live in the hook regardless.
        <div
          className={panelStyles.scope}
          data-testid="vo3d-checkout"
          {...(checkoutPanelOpen ? { role: "dialog" as const, "aria-modal": true, "aria-label": "Checking out" } : {})}
        >
          <Vo3dCheckoutPanels
            flow={checkoutFlow}
            timeInMs={timeInMs}
            frozenCheckoutAtMs={frozenCheckoutAtMs}
            successCardDismissed={successCardDismissed}
            onDismissSuccessCard={() => setSuccessCardDismissed(true)}
          />
        </div>
      )}
      <TalkRequestToast {...talkGate.toastProps} />
      <CallInvitePrompt
        resolveDisplayName={resolveDisplayName}
        // PHASE 7D. Only the V2 world can join a meeting, so only it offers the invitation. The join
        // is the world's own one entry point (app/world.ts caveMeeting.start), the same one the Cave
        // panel's button uses — there is no second path into a meeting.
        onAcceptMeeting={() => {
          const meeting = worldRef.current?.caveMeeting;
          if (!meeting) return;
          // WALK IN FIRST, then join. A meeting is a thing you do in a place: joining the media without
          // moving the body left the accepter connected but standing outside the Cave, with no panel,
          // no screen and no way to leave. Entering is the real portal transition, the same one the
          // door uses; `start` is the same create-or-join the Cave panel's own button calls.
          meeting.enter();
          void meeting.start(self);
        }}
      />
      {/* PHASE 7D — the live call, reachable in OFFICE, 3D and PLAYER. It stands down while the spatial
          chat panel is showing the very same controls in its header (see Vo3dCallBar.tsx). */}
      <Vo3dCallBar
        selfId={self}
        resolveDisplayName={resolveDisplayName}
        onExpand={() => setCallExpanded(true)}
        controlsShownElsewhere={Boolean(openChat) && !chatMinimized}
      />
      {/* PHASE 7D — the meeting's own chat. Collapsed by default, never over the curved screen, and
          quieter still while somebody is sharing. Gated on genuinely being IN the meeting. */}
      <Vo3dMeetingChat
        active={inMeeting}
        selfId={self}
        resolveDisplayName={resolveDisplayName}
        presenting={Boolean(callState.screenShare)}
        // Enter hands the mouse back from its own keypress — the one moment a browser grants a lock.
        onResumePointer={() => worldRef.current?.requestPointerLock()}
      />
      <CallOverlay
        expanded={callExpanded}
        onMinimize={() => setCallExpanded(false)}
        resolveDisplayName={resolveDisplayName}
        selfIdentity={self}
      />
      {/* Every remote window stays MOUNTED whatever its state — a minimized one is only HIDDEN here and
          drawn as a bubble in the rail below, so its messages, its draft, its scroll position, its socket
          subscriptions and its read receipts are all untouched by minimizing. V1's own rule, and the
          reason restoring one is instant rather than a reload. */}
      {remoteWindows.map((w) =>
        w.kind === "dm" ? (
          <div key={w.key} className={styles.chatSlot} hidden={w.minimized} style={slotStyle(w.key)}>
            <ConversationView
              peer={peerLayerFor(w.peerEmail)}
              selfId={self}
              peerChatId={layersByEmail.has(w.peerEmail) ? w.peerEmail : null}
              // NOT spatial: no session badge, no call controls, no spatial_session_start. This is
              // Global Chat — the same persistent conversation, reached without walking anywhere.
              minimized={w.minimized}
              onMinimizeToggle={() => toggleRemote(w.key)}
              onClose={() => closeRemote(w.key)}
              // V1's own DM board entry point, and its own signature: the panel hands up the conversation
              // id it already resolved, so the board is scoped to THIS one-to-one conversation and never
              // to a guess made from an email.
              onOpenWhiteboard={chatMode === "real" ? openConversationBoard : undefined}
            />
          </div>
        ) : (
          <div key={w.key} className={styles.chatSlot} hidden={w.minimized} style={slotStyle(w.key)}>
            <GroupConversationView
              conversationId={w.conversationId}
              selfId={self}
              participantEmails={w.participantIds}
              title={w.title}
              resolveDisplayName={resolveDisplayName}
              minimized={w.minimized}
              onMinimizeToggle={() => toggleRemote(w.key)}
              onClose={() => closeRemote(w.key)}
              // The GROUP's own conversation id — the same `{kind:"conversation"}` scope a DM uses, which
              // is V1's contract and not a second one.
              onOpenWhiteboard={
                chatMode === "real"
                  ? () => openConversationBoard(w.conversationId, w.title ?? "Group")
                  : undefined
              }
            />
          </div>
        ),
      )}
      {/* THE RAIL — V1's minimized conversations, as circular employee avatars stacked above the Toucan
          button. Each one carries its own unread count and its own close, because minimizing and closing
          are different decisions: the bubble RESTORES (the very same toggle the window header's minus
          runs) and the ✕ beside it CLOSES (the same closeRemote the header's ✕ runs). No second chat
          state exists here — a bubble is a view of a window that is already open.

          It steps aside for a panel that owns the screen, exactly as the dock and the Toucan button do. */}
      {minimizedRemote.length > 0 && !overlayToolOpen && (
        <div className={styles.bubbleRail} aria-label="Minimized conversations">
          {minimizedRemote.map((w) => {
            const name =
              w.kind === "dm"
                ? resolveDisplayName(w.peerEmail)
                : w.title
                  || w.participantIds.filter((e) => emailKey(e) !== self).map(resolveDisplayName).join(", ")
                  || "Group";
            // A group wears one of its members' faces, as V1's rail does — the roster has no portrait
            // for a conversation, and a generic glyph would make two groups indistinguishable.
            const portraitEmail =
              w.kind === "dm" ? w.peerEmail : (w.participantIds.find((e) => emailKey(e) !== self) ?? "");
            const portrait = profileImageFor(portraitEmail, () => "");
            const conv = conversations.find((c) =>
              w.kind === "group"
                ? c.id === w.conversationId
                : (c.type ?? "dm") !== "group" && c.participantIds.some((id) => emailKey(id) === w.peerEmail),
            );
            // THE SAME ROWS the dock's badge and the inbox read (useUnreadTotal) — messages that land
            // while a conversation is minimized raise its bubble's count, and opening it clears it,
            // because the panel behind the bubble is the thing that marks them read.
            const unread = conv?.unreadCount ?? 0;
            return (
              <div key={w.key} className={styles.bubbleWrap}>
                <button
                  type="button"
                  className={styles.bubble}
                  onClick={() => toggleRemote(w.key)}
                  aria-label={`Restore chat with ${name}${unread > 0 ? `, ${unread} unread` : ""}`}
                  title={name}
                  data-testid={`vo3d-chat-bubble-${w.key}`}
                >
                  {portrait ? (
                    <img className={styles.bubbleImage} src={portrait} alt="" draggable={false} />
                  ) : (
                    <span className={styles.bubbleInitials}>{name.trim().charAt(0).toUpperCase() || "?"}</span>
                  )}
                  {unread > 0 && <span className={styles.bubbleBadge}>{unread > 99 ? "99+" : unread}</span>}
                </button>
                <button
                  type="button"
                  className={styles.bubbleClose}
                  onClick={() => closeRemote(w.key)}
                  aria-label={`Close chat with ${name}`}
                  title="Close"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
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
            headerExtra={<SpatialCallControls sessionId={openConversationId} onExpand={() => setCallExpanded(true)} />}
            // The SPATIAL DM's board — the same conversation, so the same board, whether you reached it
            // by walking up to somebody or from the inbox.
            onOpenWhiteboard={chatMode === "real" ? openConversationBoard : undefined}
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
            onOpenWhiteboard={
              chatMode === "real"
                ? () => openConversationBoard(openGroupConv.id, openGroupConv.title ?? "Group")
                : undefined
            }
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
      {/* THE WHITEBOARD — V1's OWN PANEL, unforked, and the only one in the app. It owns its own boards,
          its access rules, its realtime session and its persistence; all this file supplies is WHICH
          scope to show and where the Ask Toucan button goes. Opening or closing it touches no
          conversation: every chat window stays mounted behind it, so a board is something you open
          BESIDE a conversation rather than instead of it. */}
      {chatMode === "real" && whiteboardTarget && (
        <WhiteboardPanel
          scope={whiteboardTarget.scope}
          title={whiteboardTarget.title}
          resolveDisplayName={resolveDisplayName}
          onClose={() => {
            setWhiteboardTarget(null);
            // V1's own rule: the board you were asking Toucan about goes with the panel that showed it.
            setToucanBoardContext(null);
          }}
          // W5-C's EXISTING seam, the same one the dock's Boards panel uses — one Ask Toucan, not two.
          onAskToucan={toucanAvailable ? askToucanAboutBoard : undefined}
        />
      )}
      {/* THE TOUCAN PANEL — V1's component, unforked, in the floating window stack's rightmost slot.
          Its lifetime is the SESSION, not any flight phase (V2 has no bird): it stays mounted while open
          so the transcript, the draft and any in-flight question survive a view switch, a walk or a
          panel opening over it. W5-C lifts it above the whiteboard overlay (z-index 1200) while a board
          question is in flight, exactly as V1 lifts it. */}
      {toucanOpen && (
        <div
          className={styles.chatSlot}
          style={{ ...slotStyle(TOUCAN_WINDOW_KEY), ...(toucanBoardContext ? { zIndex: 1300 } : {}) }}
          data-testid="vo3d-toucan"
        >
          <ToucanAssistantPanel
            onRelease={releaseToucan}
            onTypingChange={setToucanTyping}
            // A BOOLEAN, and the bird's pill is built from it — see the overhead row below and V1's own
            // note on why no response text may ever reach the world-space bubble.
            onPendingChange={setToucanPending}
            onOpenConversation={openConversationById}
            returnBriefing={toucanReturnBriefing}
            boardContext={toucanBoardContext}
            onClearBoardContext={() => setToucanBoardContext(null)}
          />
        </div>
      )}
      {/* ROOM DISCOVERY — the room names over the floor. Mounted only where the treatment applies, so
          PLAYER keeps exactly the behaviour it shipped with. */}
      <Vo3dRoomLabels
        worldRef={worldRef}
        ready={ready}
        active={roomLabelsVisible}
        onSelectRoom={openRoomFromLabel}
      />
      {/* ROOM DETAILS — V1's room panel, in V2's world. Always mounted so the slide-out animates and its
          content survives the close, exactly as V1's RoomSidebar stays mounted. */}
      <Vo3dRoomDetails
        details={roomDetails}
        side={roomDetailsSide}
        onClose={closeRoomDetails}
        onSelectPerson={selectRoomPerson}
        // THIS ROOM'S BOARDS — V1's own room-sidebar entry point. The scope is the FLAT room id, which is
        // the namespace boards are keyed on, resolved through V1's own helper from the manifest layer id
        // the world reports. `null` (the Central Hub, which has no flat twin) offers no button at all
        // rather than inventing a scope that nothing could answer for.
        onOpenWhiteboards={
          chatMode === "real" && roomBoardScope
            ? () => setWhiteboardTarget({ scope: { kind: "room", id: roomBoardScope }, title: formatRoomName(roomDetailsId!) })
            : undefined
        }
      />
      {profileEmail && (
        <EmployeeProfile
          email={profileEmail}
          viewerEmail={self}
          roster={people as OfficePerson[]}
          // V1'S DEEP-LINK, unchanged: the tab to open on and the feed post to highlight and scroll to.
          initialTab={profileLanding.tab}
          focusPostId={profileLanding.postId}
          onClose={() => {
            setProfileEmail(null);
            setProfileLanding({ tab: "profile", postId: null });
          }}
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
        checkoutFlow={checkoutFlow}
        // THE DOCK'S CHECK OUT BUTTON — the SAME entry the Reception exit card's "Check Out" row uses,
        // not a second one. The dock is the door you can reach from anywhere in the building; the exit
        // card is the one you meet by walking to the doors. Both start this one journey.
        onStartCheckout={checkoutOffered ? startCheckout : undefined}
        peopleLayers={peopleLayers}
        statusByEmail={statusByEmail}
        onCoworkerAction={runAction}
        onOpenProfile={openProfile}
        // NOTIFICATION ROUTING — the host's EXISTING conversation opener, handed to the bell. No new
        // navigation model: the inbox, the Map, the Toucan panel and now a notification all land in the
        // same slot through the same function.
        onOpenConversation={chatMode === "real" ? openConversationById : undefined}
        people={people}
        selfId={self}
        conversations={conversations}
        unreadTotal={unreadTotal}
        resolveDisplayName={resolveDisplayName}
        onSelectConversation={openConversation}
        onOpenDirectMessage={openRemoteDirectMessage}
        onStartGroup={startGroup}
        // ROOM DETAILS — the dock's Room tile, and the ONLY entry PLAYER mode has (see openCurrentRoom).
        onOpenCurrentRoom={openCurrentRoom}
        roomDiscoveryActive={roomLabelsVisible}
        // The profile modal is the overlay's own screen-owning panel, so it joins the dock's ONE
        // visibility rule rather than being a case the dock does not know about.
        // CHECKOUT IS THE SOLE FOCUS while it is up. It joins V1's own one-line "a tool owns the screen"
        // rule rather than getting a second mechanism: the dock steps aside, the pointer lock is released
        // and PLAYER's keys stop reaching the world, exactly as they do for Tasks or the inbox. The
        // Reception exit CARD is deliberately not here — it is an anchored world card, not a tool.
        // ROOM DETAILS joins the same one-line rule, as it does in V1 (OfficeMap's officeToolOpen lists
        // roomSidebar): the dock and the pointer lock step aside for a focused side panel.
        overlayToolOpen={overlayToolOpen}
        // THE TOUCAN. The dock owns the tile; everything else about it is above. The panel is a floating
        // WINDOW, so it deliberately does NOT join `overlayToolOpen` — the dock stays up beside it and
        // every other tool stays reachable while it is open, which is how it behaves in V1's office.
        toucanAvailable={toucanAvailable}
        toucanCalled={toucanCalled}
        toucanState={toucanState}
        onCallToucan={callToucan}
        onAskToucanAboutBoard={askToucanAboutBoard}
        onClearToucanBoardContext={() => setToucanBoardContext(null)}
      />
    </>
  );
}

export default Vo3dOverlay;
