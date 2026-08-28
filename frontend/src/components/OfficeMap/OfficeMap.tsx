import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TransformWrapper,
  TransformComponent,
  type ReactZoomPanPinchRef,
} from "react-zoom-pan-pinch";
import {
  FRAME_HEIGHT,
  FRAME_WIDTH,
  bonLayer,
  charactersInRoom,
  formatCharacterName,
  npcCharacterLayers,
  rooms,
  roomContainingPoint,
  roomLayers,
  roomMembersById,
} from "../../data/office-layout";
import { FALLBACK_ROOM_ID, roomIdForPerson } from "../../data/roomIdentity";
import { findPath, roomOf, classifyDestination } from "../../data/officePathfinding";
import {
  cellToWorld,
  findRoomDoorCell,
  nearestStandSpotConnectedTo,
  nearestWalkableConnectedTo,
  worldToCell,
} from "../../data/officeGrid";
import { doorStandForRoom } from "../../data/doorStandPoints";
import { seatsForRoomId, type Seat } from "../../data/roomSeats";
import { computeEmptySeats, seatCentroidKey, type SeatTarget } from "../../data/emptySeats";
import type { Pt } from "../../data/walkable-zones";
import { DOOR_ANIM_MS, DOOR_LAYERS_BY_ROOM } from "../../data/officeDoors";
import type { AssetLayer } from "../../types/office";
import { chatMode, chatService } from "../../services/chat";
import type { ChatMessage } from "../../services/chat";
import type { Conversation } from "../../services/chat/types";
import { useUnreadTotal } from "../../services/chat/useUnreadTotal";
import { MessageNotificationBadge } from "../Chat/MessageNotificationBadge";
import { EmployeePickerModal } from "../Chat/EmployeePickerModal";
import { GroupConversationView } from "../Chat/GroupConversationView";
import { isRealZohoMode } from "../../services/zoho";
import { ErrorBoundary } from "../ErrorBoundary";
import { OfficeStage } from "./OfficeStage";
import { remapSelfKey } from "./responderMap";
import {
  applyPeerTypingUpdate,
  deriveAnyTypingCharacterIds,
  deriveSpatialTypingCharacterIds,
  typingTimerKey,
  type PeerTypingState,
} from "./spatialTyping";
import { CharacterSearch } from "./CharacterSearch";
import { CharacterActionMenu } from "./CharacterActionMenu";
import { RoomSidebar } from "./RoomSidebar";
import { CheckinModal } from "./CheckinModal";
import { ReceptionActionMenu } from "./ReceptionActionMenu";
import { SeatActionMenu } from "./SeatActionMenu";
import {
  computeCenterTransform,
  computeRoomFocusTransform,
  SIDEBAR_WIDTH,
} from "./panMath";
import { useCharacterWalk, directionBetween } from "./useCharacterWalk";
import type { WalkDirection } from "../../data/bonWalkFrames";
import { SavedAvatarWalker, type SavedAvatarWalkApi, type SavedAvatarWalkState } from "./SavedAvatarWalker";
import { PeerWalker, type PeerWalkerRenderState } from "./PeerWalker";
import {
  usePeerMovements,
  getPeerMovementSnapshot,
  type PeerMovementState,
} from "../../services/presence/movementSync";
import { makeMoveSelf } from "./useSelfMovement";
import { resolvePeerOverrides, resolveRenderablePeerEmails } from "./peerOverrides";
import { EMAIL_TO_AVATAR_ID } from "../../data/avatarRegistry";
import {
  ALEX_SPRITE_SET,
  LUI_SPRITE_SET,
  MICAH_SPRITE_SET,
  SPRITE_SET_BY_AVATAR_ID,
  characterSprite,
} from "../../data/bonWalkFrames";
import { useOfficePhase } from "./useOfficePhase";
import { OfficePhaseDebugControl } from "./OfficePhaseDebugControl";
import { AvatarCreator } from "../AvatarCreator/AvatarCreator";
import { loadSavedAvatars } from "../../services/avatar/MockAvatarService";
import { findSavedAvatarByOwnerEmail, updateSavedAvatar } from "../../services/avatar/avatarStorage";
import { realAvatarService } from "../../services/avatar/RealAvatarService";
import { PLACEHOLDER_SPRITE_SET } from "../../services/avatar/placeholder";
import type { AvatarSpriteSet, SavedAvatar } from "../../services/avatar/types";
import { savedAvatarsToLayers } from "../../data/savedAvatarLayers";
import { useCheckoutFlow } from "./useCheckoutFlow";
import { WorkingStatusIndicator } from "./checkout/WorkingStatusIndicator";
import { StatusPicker } from "./StatusPicker";
import { useAutoStatusDetection } from "../../services/presence/useAutoStatusDetection";
import { endDnd, useSelfStatus } from "../../services/presence/selfStatusStore";
import { mapAtlasToOfficeStatus, type OfficeStatus } from "../../services/presence/status";
import { resolveManualStatusMovement } from "../../services/presence/statusMovement";
import { emitGoOffline, emitComeOnline, useOfflineLineup } from "../../services/presence/offlineLineupClient";
import { slotIndexToPosition } from "../../services/presence/lineupSlots";
import { applyOfflineLineupPositions, computeOfflineEmailSet } from "../../services/presence/offlineLineupPlacement";
import { CENTRAL_HUB_ROOM_ID } from "../../data/centralHub";
import { CheckoutReminderToast } from "./checkout/CheckoutReminderToast";
import { CheckoutConfirmModal } from "./checkout/CheckoutConfirmModal";
import { StatusOvertimePrompt } from "./StatusOvertimePrompt";
import { TimeSummaryPanel } from "./checkout/TimeSummaryPanel";
import { TimeLogForm } from "./checkout/TimeLogForm";
import { ConversationView } from "../Chat/ConversationView";
import {
  emitSpatialSessionLeave,
  emitSpatialSessionStart,
  useSpatialSessions,
  type SpatialSessionEntry,
} from "../../services/presence/spatialSessionStore";
import { createJoinRequest, onRequestResolved } from "../../services/chat/requestsClient";
import { JoinRequestPrompt } from "./JoinRequestPrompt";
import {
  cancelRoomEntryRequest,
  createRoomEntryRequest,
  onRoomRequestCancelled,
  onRoomRequestResolved,
} from "../../services/chat/roomRequestsClient";
import { DndRequestQueue } from "./DndRequestQueue";
import { TalkRequestToast } from "./TalkRequestToast";
import {
  cancelTalkRequest,
  createTalkRequest,
  onTalkRequestCancelled,
  onTalkRequestResolved,
  TalkRequestCooldownError,
} from "../../services/chat/talkRequestsClient";
import { RoomLockedToast } from "./RoomLockedToast";
import { emitDndSet, useDndEmails } from "../../services/presence/dndClient";
import { emitGlobalChatActive, useGlobalChatActiveEmails } from "../../services/presence/globalChatActivityClient";
import {
  emitRoomPresenceEnter,
  emitRoomPresenceLeave,
  useRoomPresence,
} from "../../services/presence/roomPresenceClient";
import { isRoomLocked } from "../../data/roomLock";
import { assignClusterSlots } from "../../data/clusterSlots";
import {
  classifyUpgrade,
  computeClusterAnchor,
  incumbentCentersForAnchor,
  resolveSelfSlotWalk,
  slotWalkSignature,
  resolveConversationSlot,
} from "./clusterFormation";
import { getCurrentUserId, useCurrentUserAvatarId } from "../../data/currentUser";
import { useCurrentUser } from "../../auth/currentUserStore";
import { useOfficeRoster } from "../../services/office/useOfficeRoster";
import { officePeopleToLayers, rosterSrcById } from "../../data/rosterLayers";
import { computeBackSitOccupantBaselines } from "../../data/backSitOccupancy";
import { TimeLogReview } from "./checkout/TimeLogReview";
import { SubmissionFailedPanel } from "./checkout/SubmissionFailedPanel";
import { CheckoutSuccessCard } from "./checkout/CheckoutSuccessCard";
import { CheckoutDebugPanel } from "./checkout/CheckoutDebugPanel";
import checkoutStyles from "./checkout/checkout.module.css";
import { CompanyHub } from "./CompanyHub";
import { openCompanyHub, useCompanyHub } from "../../services/hub/companyHubStore";
import { resetDevHubState } from "../../services/hub/hubClient";
import { EmployeeProfile } from "./EmployeeProfile";
import { avatarIdForEmail, mockEmailForAvatarId } from "../../data/avatarIdentity";
import styles from "./OfficeMap.module.css";

// Check-in sequence: bon spawns outside with no popup. Clicking the
// reception room (while not yet checked in) opens an action menu offering
// "Check In", which offers a check-in walk to reception, greets, then
// automatically walks the viewer to their own assigned department room — no
// room picker. Every state other than "done" suppresses normal interactions
// (room/character clicks, search) — see the guards on those handlers below.
type OnboardingState =
  | "checkinPrompt"
  | "walkingToReception"
  | "greeting"
  | "walkingToRoom"
  | "done";

// Door stand-point gating (walkToAssignedDepartment only, for now): when a
// destination room has a complete in/out stand-point pair painted around its
// door (see doorStandPoints.ts), the walk stops just outside, "waits" for the
// door to open, steps through, then stops just inside for a close beat —
// instead of walking straight to one goal point. onDoorOpen/onDoorClose
// (below) drive the door slide animation for rooms that have door art;
// DOOR_ANIM_MS (shared with OfficeStage's slide transition) is the pause
// standing in for that animation's duration.

function computeCoverScale(): number {
  if (typeof window === "undefined") return 0.5;
  const fitW = window.innerWidth / FRAME_WIDTH;
  const fitH = window.innerHeight / FRAME_HEIGHT;
  // cover: office frame fills viewport edge-to-edge (may overflow one axis).
  // Used as both initial and min scale so the frame always fully covers the
  // viewport — zooming out can never reveal the viewport background.
  return Math.max(fitW, fitH);
}

// Camera stages between full-map/tight-on-character and the current
// tight-focus multiplier (2.5x/3x) — wide enough to show a whole room
// (+ its door) while a character walks through it, used by focusRoomFit
// below for every door-gated walk (check-in, chat/pat approach, checkout
// exit).
export const ROOM_FIT_MULTIPLIER = 1.6;

// Plain nearest-seat lookup for a room's hand-painted seats, used only to
// give the LIVE player (bon) a real seat to walk to on check-in — deliberately
// separate from rosterLayers.ts's email-sorted seat assignment for OTHER
// colleagues' static portraits, since bon isn't part of that roster list.
// Returns null if the room has no painted seats yet (fallback: don't add a
// walk leg, keep today's exact behavior).
function nearestSeatTo(roomId: string, point: Pt): Seat | null {
  const seats = seatsForRoomId(roomId);
  if (seats.length === 0) return null;
  let best = seats[0];
  let bestDist = Infinity;
  for (const seat of seats) {
    const dx = seat.x - point.x;
    const dy = seat.y - point.y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = seat;
    }
  }
  return best;
}

// Messenger-style floating chat stack layout — see the render block further down (search
// "floatingChatRightOffsets"). Windows are laid out right-to-left along the bottom edge; an
// expanded window reserves EXPANDED_WIDTH, a minimized (header-only) one reserves the narrower
// MINIMIZED_WIDTH, so restoring/minimizing a window shifts everything to its left without
// overlap.
const FLOATING_CHAT_EDGE_MARGIN = 16;
const FLOATING_CHAT_EXPANDED_WIDTH = 320;
const FLOATING_CHAT_MINIMIZED_WIDTH = 220;
const FLOATING_CHAT_GAP = 12;
// Synthetic key for the single spatial ("Character -> Chat") slot in the combined floating
// layout — distinct from any real conversationId/peer-email key a remote window could have.
const SPATIAL_WINDOW_KEY = "__spatial__";

// Pure layout pass: given an ordered list (index 0 = rightmost/newest) of {key, minimized},
// returns each key's `right` CSS offset in px so windows stack without overlapping.
function computeFloatingChatRightOffsets(items: { key: string; minimized: boolean }[]): Map<string, number> {
  const offsets = new Map<string, number>();
  let cursor = FLOATING_CHAT_EDGE_MARGIN;
  for (const item of items) {
    offsets.set(item.key, cursor);
    cursor += (item.minimized ? FLOATING_CHAT_MINIMIZED_WIDTH : FLOATING_CHAT_EXPANDED_WIDTH) + FLOATING_CHAT_GAP;
  }
  return offsets;
}

export function OfficeMap() {
  const { phase, hourDecimal, overrideHour, setOverrideHour } = useOfficePhase();
  const [initialScale] = useState(computeCoverScale);
  const minScale = initialScale;
  // Multiplier (not additive) of initialScale so zoom depth scales with the
  // viewport's cover-fit scale — gives enough headroom to fill the screen
  // with just a couple of desks + characters (best-effort estimate).
  const maxScale = initialScale * 5;
  const [isDragging, setIsDragging] = useState(false);
  const transformRef = useRef<ReactZoomPanPinchRef | null>(null);

  const [menu, setMenu] = useState<{ layer: AssetLayer; clientX: number; clientY: number } | null>(
    null,
  );
  // Employee Profile V1 (see EmployeeProfile.tsx) — the email currently open, or null when
  // closed. Set from CharacterActionMenu's "View Profile" action, or the self-profile button
  // in the top chrome below.
  const [profileEmail, setProfileEmail] = useState<string | null>(null);
  // Anchored action menu opened by clicking the reception room itself — the
  // sole entry point for check-in/check-out now that Arisha's own menu no
  // longer offers "Check in" and the room-picker step is gone.
  const [receptionMenu, setReceptionMenu] = useState<{ clientX: number; clientY: number } | null>(
    null,
  );
  // Anchored "Sit here" confirm menu opened by clicking an empty seat marker
  // (see emptySeats.ts / OfficeStage's onSeatClick). Confirming calls
  // walkToSeat (declared below); closing (backdrop click or Escape) just
  // clears this without starting a walk.
  const [seatMenu, setSeatMenu] = useState<{ seat: SeatTarget; clientX: number; clientY: number } | null>(
    null,
  );
  const [roomSidebar, setRoomSidebar] = useState<{ layer: AssetLayer; side: "left" | "right" } | null>(
    null,
  );
  const [toast, setToast] = useState<string | null>(null);
  const [isAvatarCreatorOpen, setIsAvatarCreatorOpen] = useState(false);
  // Avatars saved via AvatarCreator (Track 2) — loaded once from
  // localStorage on mount, then appended to live as each new one is saved
  // so it appears in its chosen room without a page refresh.
  const [customAvatars, setCustomAvatars] = useState<SavedAvatar[]>(() => loadSavedAvatars());
  // Live roster from Atlas. Empty in mock mode's absence of a backend and
  // on the first paint, which is what keeps the static cast rendering until
  // real people actually arrive — see rosterActive below.
  const roster = useOfficeRoster();
  const currentUser = useCurrentUser();
  // Offline lineup (Phase 0/1 — v1 explicit-checkout-only, see offline_lineup.py's module
  // docstring): server-assigned slot list (email -> slot), from an in-app checkout. Declared
  // here (moved up from its original spot near checkoutFlow) because Phase 2's
  // applyOfflineLineupPositions memo below needs it, and this is an unconditional hook call
  // — safe to run this early regardless of what else has resolved yet.
  const offlineLineup = useOfflineLineup();

  // Which sprite is "you". Falls back to the default body on the first
  // paint and re-renders once Atlas's /auth/me identity lands, so this must
  // not be captured into anything that only reads it once. Moved up here
  // (out of its old spot next to checkoutFlow) because playerLayerId is
  // needed by the walk hook/sprite-src computation below, which runs before
  // checkoutFlow is declared.
  const currentUserId = useCurrentUserAvatarId();
  // Generalizes what used to be a hardcoded "bon" for the viewer's own
  // animated sprite — anyone with an entry in SPRITE_SET_BY_AVATAR_ID gets
  // their own walk/pat/idle art. Two distinct "no real sprite set" cases,
  // both now handled the same way (the faceless placeholder), NOT a
  // silent fallback to Bon's identity:
  //   - currentUserId === null: avatarIdForEmail found no registry/localpart
  //     match at all (a genuinely new/unmapped person).
  //   - currentUserId is a known id but SPRITE_SET_BY_AVATAR_ID has no entry
  //     for it (e.g. registry points at a real person with only a static
  //     portrait, no animated set built yet).
  const knownSpriteSet = currentUserId !== null ? SPRITE_SET_BY_AVATAR_ID[currentUserId] : undefined;
  const hasOwnSpriteSet = Boolean(knownSpriteSet);
  // Not a real character-layer id (never matches a manifest layer, an NPC,
  // or a sprite-set entry) — deliberately, so the existing
  // `npcCharacterLayers.find(...) ?? bonLayer` geometry fallback below still
  // resolves to bonLayer's position/size for the placeholder case, without
  // that fallback needing to know this id exists.
  const noCharacterPlayerId = "__no_character__";
  const playerLayerId = hasOwnSpriteSet ? (currentUserId as string) : noCharacterPlayerId;
  const viewerSpriteSet = hasOwnSpriteSet ? (knownSpriteSet as AvatarSpriteSet) : PLACEHOLDER_SPRITE_SET;
  // The manifest layer for whichever sprite is playing "you" — used for
  // name formatting/geometry the same way bonLayer used to be used
  // unconditionally.
  const playerCharacterLayer =
    playerLayerId === "bon" ? bonLayer : npcCharacterLayers.find((l) => l.id === playerLayerId) ?? bonLayer;

  // The signed-in viewer is drawn as the animated player (Bon's sprite set,
  // the only one with walk/pat frames), so their static roster portrait is
  // dropped to avoid rendering the same person twice.
  // Seat EVERYONE including the viewer, then split their layer out — the
  // viewer occupies a seat in their room like anyone else, so excluding
  // them before seating would hand their slot to the next person and draw
  // the two on top of each other.
  const { rosterLayers, viewerLayer } = useMemo(() => {
    const viewerEmail = currentUser?.email.trim().toLowerCase() ?? null;
    const seated = officePeopleToLayers(roster.people);
    if (!viewerEmail) return { rosterLayers: seated, viewerLayer: null };
    return {
      rosterLayers: seated.filter((layer) => layer.id.toLowerCase() !== viewerEmail),
      viewerLayer: seated.find((layer) => layer.id.toLowerCase() === viewerEmail) ?? null,
    };
  }, [roster.people, currentUser]);

  // Which lowercased emails have a real roster layer right now — gates
  // which peers get a <PeerWalker> instance (see its render site below).
  // A movementSync store entry for an email with no roster layer yet (e.g.
  // their walk_started/positions_snapshot arrived before /floor's roster
  // landed) still holds its state; once their roster layer appears this set
  // gains their email and PeerWalker mounts, reading the ALREADY-current
  // store state at mount (see PeerWalker's initial useCharacterWalk seed) —
  // no event is lost to timing.
  const rosterLayerEmailSet = useMemo(
    () => new Set(rosterLayers.map((layer) => layer.id.toLowerCase())),
    [rosterLayers],
  );

  // Atlas-offline peer emails (same predicate applyOfflineLineupPositions
  // uses, extracted as computeOfflineEmailSet so this doesn't drift from
  // that module's own definition of "offline"). An offline peer's position
  // is owned by the sidewalk-lineup placement above, never by a synced
  // movementSync desk position — see resolvePeerOverrides'/
  // resolveRenderablePeerEmails' doc comments.
  const offlineEmailSet = useMemo(() => computeOfflineEmailSet(roster.people), [roster.people]);

  // Phase 2: OTHER roster peers marked Atlas-OFFLINE (not just app-checkout users) get
  // repositioned to the sidewalk lineup, reconciled against the server-authoritative
  // offlineLineup where both signals overlap (see offlineLineupPlacement.ts). Self is
  // excluded already (rosterLayers above has the viewer's own layer split out) — this only
  // ever touches other people's positions.
  const positionedPeerLayers = useMemo(
    () => applyOfflineLineupPositions(rosterLayers, roster.people, offlineLineup),
    [rosterLayers, roster.people, offlineLineup],
  );

  // Once real people are on the floor, the manifest's fictional cast is
  // hidden — otherwise employees and characters share the office. Bon is
  // exempt: that layer IS the viewer's avatar, not an NPC.
  // (hiddenCharacterIds is derived further down — it also depends on
  // checkoutFlow, which is declared after the walk hooks.)
  const rosterActive = rosterLayers.length > 0;

  // Chat identity (Phase 3): keyed on EMAIL, never a sprite/layer id — see
  // frontend/src/services/chat/RealChatService.ts and backend/README.md.
  // Falls back to playerLayerId only pre-boot (currentUser not resolved
  // yet) or in mock mode, where the sprite id is harmless.
  const selfChatId = currentUser?.email?.trim().toLowerCase() || playerLayerId;

  // "Ask to Join + Group Conversation" Stage 4: server-driven spatial clustering, live via
  // spatial_sessions pushes. sessionId is always a Conversation.id (never a layer id/email/
  // synthetic value) — see spatialSessionStore.ts's contract doc.
  const spatialSessions = useSpatialSessions();

  // Self "in conversation" status now comes from the server-broadcast spatial session (real
  // chat actually open with >=1 other member), replacing the old client-local talkingIds
  // check. Identified by EMAIL (selfChatId), never playerLayerId — those are different
  // identifiers (sprite/layer id vs. real chat identity). members.length >= 2 guards against
  // counting a session where the viewer opened chat but the peer hasn't joined/has left.
  const inConv = useMemo(
    () =>
      !!selfChatId &&
      spatialSessions.some(
        (s) => s.members.includes(selfChatId) && s.members.length >= 2,
      ),
    [spatialSessions, selfChatId],
  );

  // Peer "talking" visual state, consolidated onto the same server-driven signal (finalized
  // decision: peers' talking visual is now spatial_sessions-driven, not client-local). Any
  // member (by email) of any >=2-member session is included — remapped through playerLayerId
  // for the self entry, since roster peers' layer ids already equal their lowercased email
  // (officePeopleToLayers keys AssetLayer.id on person.email) but the viewer's own layer id
  // (e.g. "bon") is not their email.
  const talkingCharacterIdsFromSessions = useMemo(() => {
    const ids = new Set<string>();
    for (const session of spatialSessions) {
      if (session.members.length < 2) continue;
      for (const member of session.members) {
        ids.add(member === selfChatId ? playerLayerId : member);
      }
    }
    return Array.from(ids);
  }, [spatialSessions, selfChatId, playerLayerId]);

  // Unread-message notification badge (Phase 3, functional placeholder —
  // Bon will restyle it once this is confirmed working). Real-mode-only,
  // same gating precedent as resolvePeerChatId/chatDisabled below.
  const {
    total: unreadTotal,
    conversations: allConversations,
    refetch: refetchConversations,
  } = useUnreadTotal(selfChatId);

  // Shared with JoinRequestPrompt's resolveDisplayName below — a roster
  // person's real display name when known, else a formatted fallback off
  // the raw email/id. Extracted here (Stage B1) so the conversation-list
  // badge and the group panel header can reuse the exact same resolution
  // instead of duplicating the roster lookup.
  const resolveDisplayName = useCallback(
    (email: string) => {
      const person = roster.people.find((p) => p.email.toLowerCase() === email.toLowerCase());
      return person
        ? formatCharacterName({ id: email, name: person.displayName })
        : formatCharacterName({ id: email, name: undefined });
    },
    [roster.people],
  );

  // A person's real email is only known when they're a live roster entry
  // (officePeopleToLayers keys AssetLayer.id on person.email — see
  // frontend/src/data/rosterLayers.ts). The static manifest cast (bon,
  // alex, lui, ...) and any roster person who fell back to the unmapped
  // placeholder sprite have no stable per-human identity to route real
  // chat on, so a click on one of those returns null rather than silently
  // treating their sprite id as if it were an email — ConversationView
  // disables opening a real chat for a null peerChatId instead.
  function resolvePeerChatId(target: AssetLayer): string | null {
    const email = target.id.toLowerCase();
    const isRosterPerson = roster.people.some((person) => person.email.toLowerCase() === email);
    return isRosterPerson ? email : null;
  }

  const extraCharacterLayers = useMemo(
    () => [...savedAvatarsToLayers(customAvatars), ...positionedPeerLayers],
    [customAvatars, positionedPeerLayers],
  );
  const extraCharacterSrcById = useMemo(() => {
    const map: Record<string, string> = { ...rosterSrcById(positionedPeerLayers) };
    for (const avatar of customAvatars) {
      // Avatars with a populated spriteSet resolve through the same
      // characterSprite() selector Bon uses (idle-front frame only — no
      // per-NPC walk animation/pathfinding in this slice). Everyone else
      // keeps falling back to the static preview portrait, unchanged.
      map[`saved-avatar-${avatar.avatarId}`] = avatar.spriteSet
        ? characterSprite(avatar.spriteSet, "idle", "front")
        : avatar.previewUrl;
    }
    return map;
  }, [customAvatars, positionedPeerLayers]);
  // Placeholder-swap flow (Track 2 real mode): jobIds currently being
  // polled, deduped so a job saved via onAvatarSaved and the mount-scan
  // effect below never start a second concurrent poll for the same job.
  const pollingJobIdsRef = useRef<Set<string>>(new Set());

  // Awaits one background generation job through to completion (or failure)
  // and patches the matching SavedAvatar in localStorage + in-memory state
  // in place — same avatarId/layer id throughout, so the character on the
  // map just swaps from placeholder to real result via extraCharacterSrcById.
  function startPollingJob(avatar: SavedAvatar) {
    const jobId = avatar.jobId;
    if (!jobId || pollingJobIdsRef.current.has(jobId)) return;
    pollingJobIdsRef.current.add(jobId);

    realAvatarService
      .finishJob(jobId)
      .then((result) => {
        const updated = updateSavedAvatar(avatar.avatarId, {
          previewUrl: result.previewUrl,
          spriteSet: result.spriteSet,
          generationStatus: "ready",
        });
        if (updated) {
          setCustomAvatars((prev) => prev.map((a) => (a.avatarId === updated.avatarId ? updated : a)));
        }
        // Clear only this call's own message — a functional update guards
        // against clobbering a different toast set by another job that
        // finished in the same ~3s window (each timer only clears the toast
        // it itself set, never one set later by an overlapping completion).
        const readyMsg = `${avatar.nickname}'s character is ready!`;
        setToast(readyMsg);
        window.setTimeout(() => setToast((current) => (current === readyMsg ? null : current)), 3000);
      })
      .catch(() => {
        // Covers both a real pipeline failure and a resumed job the
        // gen-server no longer recognizes (e.g. restarted, lost its
        // in-memory registry) — either way the placeholder would otherwise
        // sit stuck forever with no indication anything went wrong.
        const updated = updateSavedAvatar(avatar.avatarId, { generationStatus: "error" });
        if (updated) {
          setCustomAvatars((prev) => prev.map((a) => (a.avatarId === updated.avatarId ? updated : a)));
        }
        const failMsg = `${avatar.nickname}'s character generation failed`;
        setToast(failMsg);
        window.setTimeout(() => setToast((current) => (current === failMsg ? null : current)), 3000);
      })
      .finally(() => {
        pollingJobIdsRef.current.delete(jobId);
      });
  }

  // On mount (page load/refresh): resume polling any avatar already sitting
  // in localStorage as "pending" — handles the browser being closed/
  // refreshed mid-generation. Deliberately reads the initial customAvatars
  // snapshot only (not a live dependency) — this is a one-time resume scan,
  // not a subscription.
  useEffect(() => {
    for (const avatar of customAvatars) {
      if (avatar.generationStatus === "pending") startPollingJob(avatar);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "No character yet" -> creation flow (interim, no-backend v1): the
  // faceless placeholder (wired above via hasOwnSpriteSet) is the IMMEDIATE
  // stand-in for a signed-in viewer with no registry mapping and no
  // previously saved avatar of their own — not a dead end. The first time
  // identity resolves to that state, this auto-opens the existing
  // AvatarCreator flow (same "Add Employee" generation pipeline, just
  // scoped to the viewer's own email via ownerEmail) instead of leaving
  // them on the placeholder with no path forward. Fires at most once per
  // page load (promptedOwnAvatarRef) — closing the modal without saving
  // does not reopen it; the viewer stays the placeholder until they refresh
  // or re-open "+ Add Employee" themselves.
  //
  // DEV-only, same guard as the "+ Add Employee" button below: the creator
  // runs on MockAvatarService with no server-side persistence yet, so in
  // production auto-opening it would quietly write an invented character
  // into one viewer's localStorage — invisible to everyone else, lost on
  // cache-clear/device-switch. In production an unmapped user just sees the
  // faceless placeholder until real backend-based character assignment
  // exists.
  const promptedOwnAvatarRef = useRef(false);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (promptedOwnAvatarRef.current) return;
    if (!currentUser?.email) return; // identity not resolved yet
    if (hasOwnSpriteSet) return; // already has a real/registry-mapped character
    if (findSavedAvatarByOwnerEmail(currentUser.email)) return; // already generated one
    promptedOwnAvatarRef.current = true;
    setIsAvatarCreatorOpen(true);
  }, [currentUser, hasOwnSpriteSet]);

  const [greeting, setGreeting] = useState<{ characterId: string; nonce: number; text?: string } | null>(
    null,
  );
  const greetTimerRef = useRef<number | undefined>(undefined);
  const greetNonceRef = useRef(0);
  const charMenuTimerRef = useRef<number | undefined>(undefined);

  // Chat feature state — fully separate from the greeting system above.
  const [openChat, setOpenChat] = useState<AssetLayer | null>(null);
  // The Conversation.id of the currently-open chat panel, if any — set once ConversationView's
  // conv.id first resolves (see the onConversationOpen callback below). This is also the
  // spatial-session sessionId for that chat (sessionId === Conversation.id, per the settled
  // contract). Used to emit spatial_session_leave with the right context on explicit
  // close/unmount, and to detect a DM->group conversation-id change on an accepted join
  // request (see the JoinRequestPrompt onResolved handler below).
  const [openConversationId, setOpenConversationId] = useState<string | null>(null);
  const openConversationIdRef = useRef<string | null>(null);
  useEffect(() => {
    openConversationIdRef.current = openConversationId;
  }, [openConversationId]);

  // Stage B1: the open GROUP conversation panel, opened by an EXISTING
  // conversationId via the conversation-list badge — mutually exclusive
  // with openChat (the DM panel) below. Reuses the exact same
  // openConversationId/spatial-session bookkeeping as the DM panel (see
  // GroupConversationView's render block further down).
  const [openGroupConv, setOpenGroupConv] = useState<{
    conversationId: string;
    participantEmails: string[];
    title: string | null;
  } | null>(null);

  // openChat/openGroupConv above are EXCLUSIVELY the spatial "Character -> Chat" floating window
  // (auto-walk, spatial session, In Conversation, Ask to Join) — reused unchanged from before the
  // Messenger-style floating chat redesign. Whether that window shows expanded or collapsed to
  // just its header row.
  const [spatialChatMinimized, setSpatialChatMinimized] = useState(false);

  // Global Chat (persistent 💬 HUD icon) floating windows — completely separate state from
  // openChat/openGroupConv above. Multiple can be open at once, each keyed by peer email (DM) or
  // conversationId (group) so reopening an already-open one focuses/restores it instead of
  // duplicating. Remote windows never call emitSpatialSessionStart/Leave — no auto-walk, no
  // spatial session, no "In Conversation" status, no Ask to Join — that's the whole point of the
  // remote/spatial split.
  type RemoteChatWindow =
    | { kind: "dm"; key: string; peerEmail: string; layer: AssetLayer; minimized: boolean }
    | {
        kind: "group";
        key: string;
        conversationId: string;
        participantEmails: string[];
        title: string | null;
        minimized: boolean;
      };
  const [remoteChatWindows, setRemoteChatWindows] = useState<RemoteChatWindow[]>([]);

  // Drives the EmployeePickerModal — "message"/"findPerson" both resolve to the modal's
  // single-select mode (functionally identical: search, pick one, open/create their DM), kept as
  // distinct values only so the modal's title matches whichever entry point was clicked; "group"
  // is the modal's multi-select mode. null when closed.
  const [chatPickerMode, setChatPickerMode] = useState<"message" | "findPerson" | "group" | null>(null);

  // Same AssetLayer resolution openChatWithPeerEmail used pre-redesign: prefer a live on-map
  // layer (for name/avatar) when the peer is currently rendered; fall back to a minimal synthetic
  // layer (id-derived display name) otherwise, since a remote conversation can still be opened by
  // email even if they're not currently visible on the floor.
  function buildPeerLayer(peerEmail: string): AssetLayer {
    const email = peerEmail.toLowerCase();
    return (
      extraCharacterLayers.find((l) => l.id.toLowerCase() === email) ??
      npcCharacterLayers.find((l) => l.id.toLowerCase() === email) ??
      ({
        id: email,
        kind: "character",
        path: "",
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        transform: null,
      } as AssetLayer)
    );
  }

  // Keeps at most ~3 remote windows expanded at once (a bit fewer while the spatial window is
  // also expanded, since it occupies a slot in the same visual stack) — gracefully minimizes the
  // OLDEST other expanded window rather than the one just opened/restored (protectKey).
  function capExpandedRemoteWindows(windows: RemoteChatWindow[], protectKey: string): RemoteChatWindow[] {
    const spatialTakesSlot = (openChat !== null || openGroupConv !== null) && !spatialChatMinimized;
    const maxExpanded = spatialTakesSlot ? 2 : 3;
    const result = [...windows];
    let expandedCount = result.filter((w) => !w.minimized).length;
    for (let i = result.length - 1; i >= 0 && expandedCount > maxExpanded; i -= 1) {
      if (result[i].key === protectKey) continue;
      if (!result[i].minimized) {
        result[i] = { ...result[i], minimized: true };
        expandedCount -= 1;
      }
    }
    return result;
  }

  // Opens a remote DM window for peerEmail, or focuses/restores it if one is already open —
  // never duplicates. New windows are unshifted to the front (rightmost slot in the stack — see
  // the floatingChatOffsets computation further down).
  function openOrFocusRemoteDm(peerEmail: string) {
    const email = peerEmail.toLowerCase();
    const key = `dm:${email}`;
    setRemoteChatWindows((prev) => {
      if (prev.some((w) => w.key === key)) {
        return capExpandedRemoteWindows(
          prev.map((w) => (w.key === key ? { ...w, minimized: false } : w)),
          key,
        );
      }
      const next: RemoteChatWindow = { kind: "dm", key, peerEmail: email, layer: buildPeerLayer(email), minimized: false };
      return capExpandedRemoteWindows([next, ...prev], key);
    });
  }

  // Same idempotent open-or-focus behavior as openOrFocusRemoteDm, keyed by conversationId
  // instead of peer email (a group has no single "peer").
  function openOrFocusRemoteGroup(conv: { id: string; participantIds: string[]; title: string | null }) {
    const key = `group:${conv.id}`;
    setRemoteChatWindows((prev) => {
      if (prev.some((w) => w.key === key)) {
        return capExpandedRemoteWindows(
          prev.map((w) => (w.key === key ? { ...w, minimized: false } : w)),
          key,
        );
      }
      const next: RemoteChatWindow = {
        kind: "group",
        key,
        conversationId: conv.id,
        participantEmails: conv.participantIds,
        title: conv.title ?? null,
        minimized: false,
      };
      return capExpandedRemoteWindows([next, ...prev], key);
    });
  }

  // Close only dismisses the floating window — the conversation itself (messages, unread state,
  // membership) lives entirely server-side and is untouched.
  function closeRemoteWindow(key: string) {
    setRemoteChatWindows((prev) => prev.filter((w) => w.key !== key));
  }

  function toggleRemoteWindowMinimize(key: string) {
    setRemoteChatWindows((prev) =>
      capExpandedRemoteWindows(
        prev.map((w) => (w.key === key ? { ...w, minimized: !w.minimized } : w)),
        key,
      ),
    );
  }

  // Global Chat ACTIVITY presence fact (animation only — see characterAnimationState.ts's
  // isGlobalChatActive): true while >=1 remote DM/group window is visible and NOT minimized.
  // The spatial "Character -> Chat" window (openChat/openGroupConv) deliberately never counts.
  // Edge-triggered emit to the server (mirrors the DND broadcast below) so peers see this
  // person's seated avatar switch to `sitting-answering`; the server refcounts per socket, so a
  // second tab keeps it true until the LAST window/tab closes, and re-sends the snapshot on
  // (re)connect. Carries only the boolean — no conversation ids or contents.
  const selfGlobalChatActive = remoteChatWindows.some((w) => !w.minimized);
  const selfGlobalChatActiveRef = useRef(false);
  useEffect(() => {
    if (selfGlobalChatActiveRef.current === selfGlobalChatActive) return;
    selfGlobalChatActiveRef.current = selfGlobalChatActive;
    emitGlobalChatActive(selfGlobalChatActive);
  }, [selfGlobalChatActive]);
  useEffect(
    () => () => {
      // Unmount (e.g. navigating away) with a window still open: report false so peers don't
      // keep seeing sitting-answering until the socket eventually drops.
      if (selfGlobalChatActiveRef.current) emitGlobalChatActive(false);
    },
    [],
  );
  const globalChatActiveEmails = useGlobalChatActiveEmails();
  // Layer-id-keyed list for OfficeStage: peers' layer ids equal their lowercased email; the
  // self entry is remapped selfChatId -> playerLayerId (same convention as
  // talkingCharacterIdsFromSessions). Self is additionally OR'd with the local derivation so
  // the viewer's own avatar reacts immediately (and still works in mock mode with no socket).
  const globalChatActiveCharacterIds = useMemo(() => {
    const ids = new Set<string>();
    for (const email of globalChatActiveEmails) ids.add(email === selfChatId ? playerLayerId : email);
    if (selfGlobalChatActive) ids.add(playerLayerId);
    return Array.from(ids);
  }, [globalChatActiveEmails, selfGlobalChatActive, selfChatId, playerLayerId]);

  // Combined right-to-left layout for the floating chat stack: newest remote windows first
  // (remoteChatWindows is already newest-first, see openOrFocusRemoteDm/Group's unshift), then
  // the spatial window (if any) last/leftmost. Purely presentational — has no bearing on which
  // slot is "spatial" vs "remote" for session-bookkeeping purposes, only on where each renders.
  const floatingChatRightOffsets = useMemo(() => {
    const items = remoteChatWindows.map((w) => ({ key: w.key, minimized: w.minimized }));
    if (openChat || openGroupConv) {
      items.push({ key: SPATIAL_WINDOW_KEY, minimized: spatialChatMinimized });
    }
    return computeFloatingChatRightOffsets(items);
  }, [remoteChatWindows, openChat, openGroupConv, spatialChatMinimized]);

  // Routes a conversation-list click (the 💬 Global Chat icon's dropdown — MessageNotification
  // Badge's `conversations` list, below its New Message/Find Person/New Group Chat actions).
  // Global Chat is a unified entry point onto the same persistent conversations, so the slot is
  // decided by the conversation's LIVE state, not by which button was clicked:
  //
  // - SPATIAL (openChat/openGroupConv): a server-broadcast spatial session exists for this exact
  //   conversation id with at least one member other than self — a peer currently has it open
  //   via Character -> Chat (e.g. they walked up and messaged us). Opening it here attaches to
  //   that session through the spatial slot's existing onConversationOpen wiring, so
  //   spatial_session_start, "In Conversation", Mechanism 1's auto-walk to the cluster slot,
  //   and a 3rd person's Ask-to-Join eligibility (>=2 members) all flow through the same
  //   mechanisms as Character -> Chat — no need to find the peer on the map and click Chat
  //   again. Not gated by the target's DND status: the peer initiated this session.
  // - REMOTE (remoteChatWindows): no live session, or only a stale self-only one — a normal
  //   persistent DM/group. Stays a floating remote window: no auto-walk, no
  //   spatial_session_start, no "📍 Spatial Conversation" badge, never DND-gated.
  //
  // The two views are mutually exclusive per conversation: routing to spatial closes any remote
  // window already open for the same DM/group, so a conversation never renders twice. (An
  // earlier version routed EVERY Global Chat click to the spatial slot — which made plain
  // remote chats flip "In Conversation" — and the correction after that routed NONE, which lost
  // the peer's spatial context entirely. resolveConversationSlot is the middle ground.)
  function onSelectConversation(conv: Conversation) {
    const slot = resolveConversationSlot({
      conversationId: conv.id,
      sessions: spatialSessions,
      selfEmail: selfChatId,
    });

    if (conv.type === "group") {
      if (slot === "remote") {
        openOrFocusRemoteGroup({ id: conv.id, participantIds: conv.participantIds, title: conv.title ?? null });
        return;
      }
      closeRemoteWindow(`group:${conv.id}`);
      // Same mutual-exclusion clearing the conversation_upgraded handler does — openChat must be
      // nulled whenever openGroupConv is set, or both render guards go false and both vanish.
      setOpenChat(null);
      setSpatialChatMinimized(false);
      setOpenGroupConv({
        conversationId: conv.id,
        participantEmails: conv.participantIds,
        title: conv.title ?? null,
      });
      return;
    }

    const peerEmail = conv.participantIds.find((id) => id.toLowerCase() !== selfChatId.toLowerCase());
    if (!peerEmail) return;
    if (slot === "remote") {
      openOrFocusRemoteDm(peerEmail);
      return;
    }
    closeRemoteWindow(`dm:${peerEmail.toLowerCase()}`);
    // Mirrors handleChoose's "chat" branch (minus the approach walk — Mechanism 1 walks self to
    // the cluster slot once the session reaches >=2 members): opening the DM panel must clear
    // any open group panel, for the same mutual-exclusion reason as above.
    setOpenGroupConv(null);
    setSpatialChatMinimized(false);
    setOpenChat(buildPeerLayer(peerEmail));
  }

  // Global Chat "New Message"/"Find Person" resolution — both search/select flows land here with
  // the picked employee's email.
  function startRemoteDirectMessage(peerEmail: string) {
    openOrFocusRemoteDm(peerEmail);
  }

  // Global Chat "New Group Chat" resolution — creates (or reuses, per the backend's exact-member
  // idempotency) a group conversation for the picked employees, then opens/focuses its window.
  async function startRemoteGroupChat(participantEmails: string[]) {
    if (!chatService.createGroupConversation) return;
    try {
      const conv = await chatService.createGroupConversation(participantEmails, null);
      openOrFocusRemoteGroup({ id: conv.id, participantIds: conv.participantIds, title: conv.title ?? null });
      void refetchConversations();
    } catch (err) {
      console.error("[chat] failed to create group conversation", err);
      setToast("Couldn't create the group chat.");
      setTimeout(() => setToast(null), 1800);
    }
  }
  // Chat-panel-required per the finalized spatial-clustering decision: leave on unmount only
  // if a chat panel was actually open (explicit close already emits its own leave — see
  // ConversationView's onClose below). Mount-once effect (empty deps) so this only fires on
  // real component unmount, not on every openConversationId change. openConversationId only ever
  // tracks the spatial window (see its declaration above) — remote windows never touch it.
  useEffect(() => {
    return () => {
      if (openConversationIdRef.current) emitSpatialSessionLeave();
    };
  }, []);

  // Stage B2's conversation_upgraded live-reaction effect is declared further
  // down (search "Stage B2: live" below), AFTER approachCharacter/bonPos/
  // walkTo/resolveMemberCenter are all in scope — its dependency array reads
  // bonPos, which is a `const` declared later in this same function; putting
  // the effect here would hit bonPos's temporal dead zone (deps arrays are
  // evaluated immediately, unlike the effect body itself, which only runs
  // after the whole render function has finished).

  // Requester-side toast for a declined "ask to join" — onRequestResolved only ever fires for
  // requests THIS signed-in user created (server routes request_resolved to the requester's
  // own user room), so no extra filtering by requesterEmail is needed here. Reuses the
  // existing generic toast mechanism (setToast) rather than inventing a new notification
  // system, per the finalized "add if simple, skip otherwise" decision.
  useEffect(() => {
    return onRequestResolved((req) => {
      if (req.state !== "declined") return;
      setToast("Your request to join was declined.");
      window.setTimeout(() => setToast((current) => (current === "Your request to join was declined." ? null : current)), 2500);
    });
  }, []);
  // Latest sent message text per character id, shown in their talking bubble
  // until it expires (falls back to the looping dots otherwise).
  const [talkingTextById, setTalkingTextById] = useState<Record<string, string>>({});
  const talkingTimersRef = useRef<Record<string, number>>({});

  // senderId/email -> layer-id remap of the sent-text map (see responderMap.ts) — this is what
  // OfficeStage's overhead-bubble resolver reads (talkingTextById prop,
  // layer-id-keyed), fixing the bug where self's own sent-text bubble never
  // showed (the old direct pass-through was keyed on selfChatId/email, but
  // the render lookup used playerLayerId, e.g. "bon").
  const talkingTextByLayerId = useMemo(
    () => remapSelfKey(talkingTextById, selfChatId, playerLayerId),
    [talkingTextById, selfChatId, playerLayerId],
  );

  // Actively-typing signal (real keystroke activity, see ConversationView.tsx's
  // onTypingChange) — self side, recorded together with the spatial conversation it happened
  // in. Only the two spatial windows wire onTypingChange (remote Global Chat windows never do),
  // and the conversation id is what lets deriveSpatialTypingCharacterIds match it against the
  // live spatial session (see spatialTyping.ts).
  const [selfTypingConversationId, setSelfTypingConversationId] = useState<string | null>(null);
  const selfSpatialConversationId = openGroupConv?.conversationId ?? openConversationId ?? null;
  const selfSpatialConversationIdRef = useRef<string | null>(selfSpatialConversationId);
  selfSpatialConversationIdRef.current = selfSpatialConversationId;
  const setSelfTyping = useCallback((isTyping: boolean) => {
    setSelfTypingConversationId(isTyping ? selfSpatialConversationIdRef.current : null);
  }, []);

  // Peer side, fed by RealChatService's onTyping (mock mode's implementation never invokes
  // listeners, so this stays empty there). Conversation-scoped: lowercased email -> set of
  // conversation ids currently typing in, with one inactivity timer per (email, conversation)
  // so a stop/timeout in one conversation can never clear typing in another.
  const [peerTypingByEmail, setPeerTypingByEmail] = useState<PeerTypingState>({});
  const peerTypingTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    const unsubscribe = chatService.onTyping?.((update) => {
      const email = update.senderId.toLowerCase();
      // Never let a self-echo affect peer state.
      if (email === selfChatId?.toLowerCase()) return;
      const conversationId = update.conversationId;
      const timerKey = typingTimerKey(email, conversationId);

      const timers = peerTypingTimersRef.current;
      if (timers[timerKey]) {
        clearTimeout(timers[timerKey]);
        delete timers[timerKey];
      }

      setPeerTypingByEmail((prev) => applyPeerTypingUpdate(prev, { email, conversationId, isTyping: update.isTyping }));
      if (update.isTyping) {
        // Belt-and-suspenders expiry in case a "stopped typing" event is
        // lost (dropped socket message, tab closed uncleanly, etc).
        timers[timerKey] = setTimeout(() => {
          setPeerTypingByEmail((prev) => applyPeerTypingUpdate(prev, { email, conversationId, isTyping: false }));
          delete timers[timerKey];
        }, 6000);
      }
    });

    return () => {
      unsubscribe?.();
      Object.values(peerTypingTimersRef.current).forEach((timer) => clearTimeout(timer));
      peerTypingTimersRef.current = {};
    };
  }, [selfChatId]);

  // Any-conversation typing — drives the overhead "typing dots" bubble only (unchanged
  // semantics: a peer typing in any conversation with the viewer shows dots).
  const typingCharacterIds = useMemo(
    () => deriveAnyTypingCharacterIds(peerTypingByEmail, selfTypingConversationId !== null, playerLayerId),
    [peerTypingByEmail, selfTypingConversationId, playerLayerId],
  );

  // Spatial-scoped typing — drives the `agree-gesture` animation only: a character counts as
  // typing solely when its typing entry belongs to the conversation of the live spatial session
  // it is a member of (see spatialTyping.ts / characterAnimationState.ts).
  const spatialTypingCharacterIds = useMemo(
    () =>
      deriveSpatialTypingCharacterIds({
        peerTyping: peerTypingByEmail,
        sessions: spatialSessions,
        selfChatId,
        playerLayerId,
        selfTypingConversationId,
      }),
    [peerTypingByEmail, spatialSessions, selfChatId, playerLayerId, selfTypingConversationId],
  );

  // Door art layer ids currently slid open (see officeDoors.ts). Rooms
  // without a DOOR_LAYERS_BY_ROOM entry have no door art yet, so
  // onDoorOpen/onDoorClose below simply no-op for them.
  const [openDoorLayerIds, setOpenDoorLayerIds] = useState<Set<string>>(() => new Set());

  function onDoorOpen(roomId: string): void {
    const ids = DOOR_LAYERS_BY_ROOM[roomId];
    if (!ids) return;
    setOpenDoorLayerIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
  }

  function onDoorClose(roomId: string): void {
    const ids = DOOR_LAYERS_BY_ROOM[roomId];
    if (!ids) return;
    setOpenDoorLayerIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }

  function handleTalkingMessage(msg: ChatMessage) {
    window.clearTimeout(talkingTimersRef.current[msg.senderId]);
    setTalkingTextById((prev) => ({ ...prev, [msg.senderId]: msg.text }));
    talkingTimersRef.current[msg.senderId] = window.setTimeout(() => {
      setTalkingTextById((prev) => {
        const next = { ...prev };
        delete next[msg.senderId];
        return next;
      });
    }, 4500);
  }

  // Onboarding state machine — starts "done" (no auto-popup on load); moves
  // through the check-in states only once the user deliberately clicks the
  // reception room and picks "Check In" from its action menu.
  const [onboarding, setOnboarding] = useState<OnboardingState>("done");
  // Tracks whether the check-in flow has been completed at least once —
  // gates the "Check In" option on the reception menu (hidden once already
  // checked in; "Check Out" appears instead). Declining the "Want to check
  // in?" modal ("Not now") does NOT count as checked-in, so the option stays
  // available to retry.
  //
  // Deliberately NOT derived from timeInMs !== null: timeInMs is stamped as
  // soon as onboarding is "done" — which is also the mount-time DEFAULT, so
  // it goes non-null on page load before any deliberate check-in — making it
  // unusable as an "already checked in" signal. hasCheckedIn is the
  // pre-existing, purpose-built flag for this exact gate.
  const [hasCheckedIn, setHasCheckedIn] = useState(false);

  useEffect(() => {
    return () => {
      window.clearTimeout(greetTimerRef.current);
      window.clearTimeout(charMenuTimerRef.current);
      window.clearTimeout(approachDoorTimerRef.current);
      window.clearTimeout(checkoutDoorTimerRef.current);
      window.clearTimeout(seatDoorTimerRef.current);
      window.clearTimeout(mapRightClickDoorTimerRef.current);
      window.clearTimeout(destinationRingTimerRef.current);
      for (const timerId of Object.values(talkingTimersRef.current)) {
        window.clearTimeout(timerId);
      }
    };
  }, []);

  const {
    pos: bonPos,
    isWalking,
    isPatting,
    direction,
    frameIndex,
    walkTo: walkToRaw,
    face,
    cancel: cancelWalk,
    resetPos: resetBonPos,
  } = useCharacterWalk({
    x: bonLayer.x,
    y: bonLayer.y,
  });

  // Sitting is a FIXED seat-owned pose, never derived from `direction` (the
  // last direction bon happened to be facing/walking before he sat down —
  // see the seat-direction mechanism in data/seatDirections.ts). Set only by
  // the seat-arrival paths below (finishArrival's seatDirection arg, and the
  // initial spawn-at-desk effect), and cleared the moment the player starts
  // walking again (see the walkTo wrapper right below).
  const [isSitting, setIsSitting] = useState(false);
  const [sitDirection, setSitDirection] = useState<WalkDirection>("front");
  // The viewer's own currently-occupied seat, as its centroid key (see
  // emptySeats.ts's seatCentroidKey) — null whenever not sitting in a real
  // painted chair. Set alongside every setIsSitting(true) call site (initial
  // spawn-at-desk effect, sitAtSeat below) and cleared alongside every
  // setIsSitting(false) (the walkTo wrapper right below). Used by the
  // occupiedCentroidKeys memo further down so the viewer's own seat is never
  // offered back to them (or anyone else) as a click-to-sit target while
  // they're in it.
  const [currentSeatKey, setCurrentSeatKey] = useState<string | null>(null);
  // The viewer's own currently-occupied seat's manifest furniture id (see
  // roomSeats.ts's Seat.furnitureId) — undefined whenever not sitting in a
  // real manifest-room chair (non-manifest rooms' seats have no furnitureId
  // at all). Set/cleared alongside currentSeatKey above. Feeds the back-sit
  // occlusion fix's occupant-baseline map (see backSitOccupantBaselines
  // below) so the viewer's own chair can be resolved without re-deriving it
  // via a seat lookup every render.
  const [currentSeatFurnitureId, setCurrentSeatFurnitureId] = useState<string | undefined>(undefined);

  // Wraps the raw walk-hook's walkTo so ANY new walk (re-triggered mid-app,
  // not just the onboarding sequence) clears isSitting — a character who
  // starts moving again is, by definition, no longer sitting. Every call
  // site below uses this wrapper, not walkToRaw directly.
  function walkTo(
    input: Pt | Pt[],
    onArrive?: () => void,
    opts?: { durationMs?: number; elapsedMs?: number },
  ) {
    setIsSitting(false);
    setCurrentSeatKey(null);
    setCurrentSeatFurnitureId(undefined);
    walkToRaw(input, onArrive, opts);
  }

  // Shared "arrived at a seat, now sit in it" finalizer — used by BOTH
  // walkToAssignedDepartment's real-seat arrival leg (finishArrival) and the
  // click-to-sit walkToSeat flow below, so the isSitting/sitDirection/
  // currentSeatKey trio is only ever set together, in exactly one place.
  function sitAtSeat(seat: Seat) {
    setIsSitting(true);
    setSitDirection(seat.direction);
    setCurrentSeatKey(seatCentroidKey(seat.x, seat.y));
    setCurrentSeatFurnitureId(seat.furnitureId);
  }

  // THE single self-movement funnel (see useSelfMovement.ts's doc comment):
  // every self-movement call site below (right-click, seat walks,
  // approachCharacter, spatial self-settle, Ask-to-Join joiner, checkout
  // exit, walkBackToDesk, lineup nudge) calls this instead of bare walkTo/
  // walkToRaw, so every self walk emits the walk_started/walk_arrived wire
  // events peers replay. Recreated every render (like every other walk
  // helper in this file) so its getPos/getDirection closures always read
  // the current render's bonPos/direction/isSitting/sitDirection — moveSelf
  // is only ever invoked synchronously (never stashed across renders).
  const moveSelf = makeMoveSelf({
    walkTo,
    getPos: () => bonPos,
    getDirection: () => (isSitting ? sitDirection : direction),
    // Owner turns to the same arrival facing it broadcasts (see
    // UseSelfMovementDeps.face) — fixes per-browser facing divergence
    // after a spatial-conversation settle.
    face,
  });

  const playerSpriteSrc = characterSprite(
    viewerSpriteSet,
    isPatting ? "pat" : isWalking ? "walk" : isSitting ? "sitType" : "idle",
    isSitting ? sitDirection : direction,
    frameIndex,
  );

  // Move the player to the viewer's own desk once identity resolves. The
  // walk hook is seeded at mount from the manifest's spawn point, which is
  // the only position known before /auth/me and /floor land.
  //
  // Fires ONCE, and never mid-walk: yanking someone out of a walk they
  // started would cancel it silently and strand the pathfinder's target.
  // If they've already moved, the spawn point stopped being meaningful
  // anyway, so leave them where they are.
  //
  // The actual seat/desk-vs-sidewalk decision is made further below, once
  // checkoutFlow is available (see the effect right after its declaration) —
  // this ref is declared here so it stays adjacent to the other
  // useCharacterWalk-related refs, but is only ever flipped by that effect.
  const spawnMovedRef = useRef(false);

  // Alex/Micah/Lui demo-walk instances — same useCharacterWalk hook as bon,
  // seeded from each NPC's actual current manifest position so their demo
  // loop starts exactly where they normally stand.
  const alexLayer = npcCharacterLayers.find((l) => l.id === "alex");
  const micahLayer = npcCharacterLayers.find((l) => l.id === "micah");
  const luiLayer = npcCharacterLayers.find((l) => l.id === "lui");
  const {
    pos: alexPos,
    isWalking: alexIsWalking,
    isPatting: alexIsPatting,
    direction: alexDirection,
    frameIndex: alexFrameIndex,
    walkTo: alexWalkTo,
    playPat: alexPlayPat,
    face: alexFace,
  } = useCharacterWalk({ x: alexLayer?.x ?? 0, y: alexLayer?.y ?? 0 });
  const {
    pos: micahPos,
    isWalking: micahIsWalking,
    isPatting: micahIsPatting,
    direction: micahDirection,
    frameIndex: micahFrameIndex,
    walkTo: micahWalkTo,
    playPat: micahPlayPat,
    face: micahFace,
  } = useCharacterWalk({ x: micahLayer?.x ?? 0, y: micahLayer?.y ?? 0 });
  const {
    pos: luiPos,
    isWalking: luiIsWalking,
    isPatting: luiIsPatting,
    direction: luiDirection,
    frameIndex: luiFrameIndex,
    walkTo: luiWalkTo,
    playPat: luiPlayPat,
    face: luiFace,
  } = useCharacterWalk({ x: luiLayer?.x ?? 0, y: luiLayer?.y ?? 0 });

  // Pat-back lookup — only alex/micah/lui have their own useCharacterWalk
  // instance (and thus their own `face`) above; plain static roster people
  // and not-yet-generalized saved avatars have no directional capability, so
  // this resolves to null for them and the pat handler below no-ops.
  function facerFor(id: string): ((dir: WalkDirection) => void) | null {
    if (id === "alex") return alexFace;
    if (id === "micah") return micahFace;
    if (id === "lui") return luiFace;
    return null;
  }
  const alexSpriteSrc = characterSprite(
    ALEX_SPRITE_SET,
    alexIsPatting ? "pat" : alexIsWalking ? "walk" : "idle",
    alexDirection,
    alexFrameIndex,
  );
  const micahSpriteSrc = characterSprite(
    MICAH_SPRITE_SET,
    micahIsPatting ? "pat" : micahIsWalking ? "walk" : "idle",
    micahDirection,
    micahFrameIndex,
  );
  const luiSpriteSrc = characterSprite(
    LUI_SPRITE_SET,
    luiIsPatting ? "pat" : luiIsWalking ? "walk" : "idle",
    luiDirection,
    luiFrameIndex,
  );

  // Saved-avatar (e.g. Lui, generated via "Add Employee") walk/pat registry —
  // generalizes the alex/micah demo mechanism above to ANY character with a
  // populated spriteSet, not just the 3 hardcoded NPCs. React can't call
  // useCharacterWalk a dynamic number of times directly, so each qualifying
  // avatar gets its own headless <SavedAvatarWalker> instance (rendered
  // below) that owns the hook and reports in/out through this registry:
  // - savedAvatarWalkState: live pos+src per layer id, merged into
  //   characterOverrides/characterSrcOverrides so the avatar animates on-map
  //   exactly like alex/micah do.
  // - savedAvatarApiRef: walkTo/playPat lookup by layer id, used by
  //   runWalkDemo/runPatDemo below.
  const [savedAvatarWalkState, setSavedAvatarWalkState] = useState<
    Record<string, SavedAvatarWalkState>
  >({});
  const savedAvatarApiRef = useRef<Map<string, SavedAvatarWalkApi>>(new Map());

  const registerSavedAvatarApi = useCallback((layerId: string, api: SavedAvatarWalkApi | null) => {
    if (api) savedAvatarApiRef.current.set(layerId, api);
    else savedAvatarApiRef.current.delete(layerId);
  }, []);

  const handleSavedAvatarUpdate = useCallback((layerId: string, state: SavedAvatarWalkState) => {
    setSavedAvatarWalkState((prev) => ({ ...prev, [layerId]: state }));
  }, []);

  // Any saved avatar (customAvatars) with a populated spriteSet gets its own
  // <SavedAvatarWalker> below — same real 20-pose sprite set the pipeline
  // already generates for every "Add Employee" avatar. Excludes still-
  // generating placeholders (generationStatus === "pending") — those carry
  // PLACEHOLDER_SPRITE_SET (truthy) but shouldn't be walk/pat-demoable until
  // the real result swaps in (mirrors savedAvatarsToLayers' `animatable`
  // gate, which CharacterActionMenu's showDemos reads).
  const avatarsWithSpriteSet = useMemo(
    () => customAvatars.filter((a) => a.spriteSet && a.generationStatus !== "pending"),
    [customAvatars],
  );

  const savedAvatarOverridePos = useMemo(() => {
    const map: Record<string, { x: number; y: number }> = {};
    for (const [id, s] of Object.entries(savedAvatarWalkState)) map[id] = s.pos;
    return map;
  }, [savedAvatarWalkState]);

  const savedAvatarOverrideSrc = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [id, s] of Object.entries(savedAvatarWalkState)) map[id] = s.src;
    return map;
  }, [savedAvatarWalkState]);

  // Unified movement-sync: renders OTHER users' movement (walk_started/
  // walk_arrived replay) via the shared movementSync store, one headless
  // <PeerWalker> per peer (see the usePeerMovements().map() below) reporting
  // live pos+src+isWalking+direction+isSitting up here, merged into
  // characterOverrides/characterSrcOverrides/characterIsWalkingById/
  // characterIsSittingById/characterDirectionsById — same pattern as
  // savedAvatarWalkState above.
  const peerMovements = usePeerMovements();
  const [peerWalkState, setPeerWalkState] = useState<Record<string, PeerWalkerRenderState>>({});
  const handlePeerWalkUpdate = useCallback(
    (id: string, s: PeerWalkerRenderState) => setPeerWalkState((prev) => ({ ...prev, [id]: s })),
    [],
  );
  // Excludes any Atlas-offline peer from every override map (see
  // resolvePeerOverrides' doc comment) — an offline peer's synced desk
  // position must never beat their sidewalk-lineup placement.
  const peerOverrides = useMemo(
    () => resolvePeerOverrides(peerWalkState, offlineEmailSet),
    [peerWalkState, offlineEmailSet],
  );
  const peerWalkOverridePos = peerOverrides.pos;
  const peerWalkOverrideSrc = peerOverrides.src;
  const peerIsWalkingById = peerOverrides.isWalking;
  const peerIsSittingById = peerOverrides.isSitting;
  const peerDirectionsById = peerOverrides.direction;

  // Which of the currently-known peer emails get a live <PeerWalker>
  // instance — see resolveRenderablePeerEmails' doc comment (self excluded,
  // must have a roster layer, must not be Atlas-offline).
  const renderablePeerEmailSet = useMemo(
    () =>
      new Set(
        resolveRenderablePeerEmails(
          peerMovements.map((p) => p.email),
          rosterLayerEmailSet,
          offlineEmailSet,
          selfChatId.toLowerCase(),
        ),
      ),
    [peerMovements, rosterLayerEmailSet, offlineEmailSet, selfChatId],
  );

  // Cluster-formation wiring: resolves a member's current WORLD-CENTER
  // position (not top-left) for anchor/slot computation. Mirrors the same
  // layer-lookup chain the peerWalks.map() rendering block and
  // buildPeerLayer already use: extraCharacterLayers (which folds in
  // positionedPeerLayers) first, else npcCharacterLayers. Live peer movement
  // (peerWalkState, top-left coords) takes priority over a peer's static
  // layer position when a walk is in flight/just completed. Returns null
  // when truly unresolvable — callers still include the member in
  // assignClusterSlots' membership list, just skip them for the anchor
  // average. Shared between Mechanism 1 (self-settle effect below) and
  // Mechanism 2 (the joiner branch of the conversation_upgraded handler).
  function resolveMemberCenter(email: string): Pt | null {
    const lower = email.toLowerCase();
    if (lower === selfChatId.toLowerCase()) {
      return {
        x: bonPos.x + playerCharacterLayer.width / 2,
        y: bonPos.y + playerCharacterLayer.height / 2,
      };
    }
    const layer =
      extraCharacterLayers.find((l) => l.id.toLowerCase() === lower) ??
      npcCharacterLayers.find((l) => l.id.toLowerCase() === lower) ??
      null;
    const live = peerWalkState[lower];
    if (live && layer) {
      return { x: live.pos.x + layer.width / 2, y: live.pos.y + layer.height / 2 };
    }
    if (live && !layer) {
      // No known layer dimensions to center against — the raw (top-left)
      // point is still a usable approximation for the anchor average.
      return live.pos;
    }
    if (!layer) return null;
    return { x: layer.x + layer.width / 2, y: layer.y + layer.height / 2 };
  }

  // Mechanism 1 (self-settle): whenever self's spatial-session membership
  // genuinely changes (2-person formation, or an incumbent repositioning
  // once a 3rd person's cluster-slot geometry shifts everyone's slot), walk
  // to THIS client's own deterministic cluster slot — every client
  // independently computes the identical slot map from the same
  // (sorted/lowercased) membership list + anchor, so no server-authoritative
  // position broadcast is needed. Mirrors reconciledLineupSlotRef's effect's
  // exact idiom above (signature-gated, skip while mid-walk). Positioning
  // ONLY — never emits spatial_session_start here; status stays entirely
  // owned by ConversationView/GroupConversationView's onConversationOpen
  // wiring for the 2-person + incumbent-reposition cases (Mechanism 2 below
  // handles the arrival-gated 3-person joiner separately).
  useEffect(() => {
    const decision = resolveSelfSlotWalk({
      sessions: spatialSessions,
      selfEmail: selfChatId,
      lastSignature: slotWalkSignatureRef.current,
      isWalking,
    });
    if (decision === null) return;
    if ("reset" in decision) {
      slotWalkSignatureRef.current = null;
      return;
    }

    slotWalkSignatureRef.current = decision.signature;

    const anchor = computeClusterAnchor(
      decision.members.map((m) => resolveMemberCenter(m)).filter((p): p is Pt => p !== null),
    );
    const slots = assignClusterSlots(decision.members, anchor);
    const mySlotCenter = slots[selfChatId];
    if (!mySlotCenter) return;

    const bw = playerCharacterLayer.width;
    const bh = playerCharacterLayer.height;
    const goal = { x: mySlotCenter.x - bw / 2, y: mySlotCenter.y - bh / 2 };
    const startRoomId = roomOf({ x: bonPos.x + bw / 2, y: bonPos.y + bh / 2 })?.id ?? null;
    const goalRoomId = roomOf(mySlotCenter)?.id ?? null;
    const path = findPath({ x: bonPos.x, y: bonPos.y }, goal, startRoomId, goalRoomId);

    // Facing folded into arrival.facing (rather than a post-arrival face()
    // call) so walk_arrived broadcasts the FINAL intended facing — a
    // post-arrival local face() never reaches the server/DB, leaving peers
    // and a reload with the wrong facing.
    moveSelf({
      path,
      roomId: goalRoomId,
      arrival: { state: "standing", facing: directionBetween({ x: goal.x + bw / 2, y: goal.y + bh / 2 }, anchor) },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spatialSessions, selfChatId, isWalking]);

  // "Walk demo" / "Pat demo" — action-menu items available to alex/micah/lui
  // (their own dedicated useCharacterWalk instances above) AND any saved
  // avatar with a populated spriteSet (via savedAvatarApiRef). Scripts a
  // small in-view closed-loop walk (out ~1-2 tiles, then back) exercising
  // multiple directions, then plays the pat frames. Does not touch bon or his
  // own walk/pat mechanism (see handleChoose's existing "approach"/"chat" branches).
  function runWalkDemo(layer: AssetLayer) {
    const walkTo =
      layer.id === "alex"
        ? alexWalkTo
        : layer.id === "micah"
          ? micahWalkTo
          : layer.id === "lui"
            ? luiWalkTo
            : savedAvatarApiRef.current.get(layer.id)?.walkTo ?? null;
    if (!walkTo) return;
    const start = { x: layer.x, y: layer.y };
    const out = { x: start.x + 40, y: start.y + 32 };
    walkTo([out, start]);
  }

  function runPatDemo(layer: AssetLayer) {
    const playPat =
      layer.id === "alex"
        ? alexPlayPat
        : layer.id === "micah"
          ? micahPlayPat
          : layer.id === "lui"
            ? luiPlayPat
            : savedAvatarApiRef.current.get(layer.id)?.playPat ?? null;
    playPat?.();
  }

  // Checkout flow — stamped once the onboarding sequence reaches "done"
  // (whichever path got there: skipped check-in, or walked to a room).
  const [timeInMs, setTimeInMs] = useState<number | null>(null);
  useEffect(() => {
    if (onboarding === "done" && timeInMs === null) {
      setTimeInMs(Date.now());
    }
  }, [onboarding, timeInMs]);

  // Debug-only override: lets the dev debug panel set a synthetic "hours
  // worked" so the 8h checkout reminder (workedMinutes >= 480) can be tested
  // without waiting. null = use the real check-in timestamp.
  const [debugHoursWorked, setDebugHoursWorked] = useState<number | null>(null);
  const effectiveTimeInMs =
    debugHoursWorked !== null ? Date.now() - debugHoursWorked * 3600_000 : timeInMs;

  const checkoutFlow = useCheckoutFlow({
    employeeId: getCurrentUserId(),
    hourDecimal,
    timeInMs: effectiveTimeInMs,
  });

  // Presence/status system (see services/presence/status.ts). Idle (Away)
  // detection runs once here; inConversation now comes from the server-broadcast
  // spatial session (inConv, derived above from spatial_sessions + selfChatId — see the
  // "Ask to Join" Stage 4 block), offline from not-yet-checked-in OR a hard
  // disconnect/checkout (CHECKED_OUT) — same !hasCheckedIn signal already used
  // for seatInteractionsSuppressed above, so self follows the same "not checked
  // in yet" rule other checked-in-gated behavior in this file already follows.
  // See useAutoStatusDetection.ts.
  useAutoStatusDetection({
    inConversation: inConv,
    offline: !hasCheckedIn || checkoutFlow.state === "CHECKED_OUT",
  });

  // Company Hub V1 (see services/hub/companyHubStore.ts) — opened once check-in completes
  // (finishArrival, below) and reopenable anytime via the Hub button in the top chrome.
  const companyHub = useCompanyHub();

  // Offline lineup (Phase 0/1 — v1 explicit-checkout-only, see offline_lineup.py's module
  // docstring): additive, separate wiring keyed strictly off checkoutFlow.state, never off
  // manualStatus — must not interact with the Break/Lunch auto-walk effect above/below.
  //
  // go_offline/come_online fire exactly once per CHECKED_OUT transition (either direction),
  // tracked via a prev-state ref rather than derived every render, matching
  // prevManualStatusRef's established pattern in this file.
  const prevCheckoutStateForLineupRef = useRef(checkoutFlow.state);
  // The slot index this session has already walked to a reconciling adjustment for — reset
  // whenever a NEW checkout begins, so a later checkout with a different assigned slot can
  // reconcile again.
  const reconciledLineupSlotRef = useRef<number | null>(null);

  // Cluster-formation wiring (final integration of Stage 1's assignClusterSlots
  // geometry + Stage 3's emitAndWalkTo peer-walk broadcast). Mirrors
  // reconciledLineupSlotRef's exact idiom above: a signature of "the last
  // membership set this client already walked to a slot for", reset to null
  // whenever self stops belonging to any >=2-member spatial session, so a
  // NEW cluster (even one with the same signature reused later) can be
  // walked to again. See the self-settle effect (Mechanism 1) below.
  const slotWalkSignatureRef = useRef<string | null>(null);
  // conversation_upgraded joiner-arrival gating (Mechanism 2, in the
  // conversation_upgraded handler below): set the moment a 3rd-person joiner
  // starts walking into the cluster, cleared once their walk completes (or
  // the panel closes mid-walk). Also read by GroupConversationView's
  // onConversationOpen wiring to skip emitting spatial_session_start early —
  // the joiner's status must not flip to "In Conversation" until arrival.
  const pendingJoinerConvIdRef = useRef<string | null>(null);

  useEffect(() => {
    const prev = prevCheckoutStateForLineupRef.current;
    prevCheckoutStateForLineupRef.current = checkoutFlow.state;
    if (prev === checkoutFlow.state) return;

    if (checkoutFlow.state === "CHECKED_OUT" && prev !== "CHECKED_OUT") {
      reconciledLineupSlotRef.current = null;
      // DND should only meaningfully protect an actively checked-in employee (feature spec
      // section 16) — checking out ends any active DND session the same way a manual cancel
      // does (restores the previous status, credits elapsed time, and — via the existing
      // prevSelfOfficeStatusRef effect reacting to the resulting currentStatus change — emits
      // dnd_set(false) so any room this person was protecting unlocks).
      endDnd();
      emitGoOffline();
    } else if (prev === "CHECKED_OUT" && checkoutFlow.state !== "CHECKED_OUT") {
      reconciledLineupSlotRef.current = null;
      emitComeOnline();
      walkBackToDesk();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutFlow.state]);

  // Reconciling adjustment: the exit walk above already lands the viewer at the general
  // sidewalk area (bonLayer) immediately/optimistically. Once the server's authoritative
  // snapshot arrives with THIS user's actual assigned slot, nudge to the exact slot
  // coordinate — but only once per checkout (reconciledLineupSlotRef guard) and never
  // mid-walk (isWalking guard), so it can't collide with the in-flight exit-walk animation.
  useEffect(() => {
    if (checkoutFlow.state !== "CHECKED_OUT" || isWalking) return;
    const selfEmail = currentUser?.email?.trim().toLowerCase();
    if (!selfEmail) return;
    const mine = offlineLineup.find((entry) => entry.email === selfEmail);
    if (!mine || reconciledLineupSlotRef.current === mine.slot) return;
    reconciledLineupSlotRef.current = mine.slot;
    moveSelf({ path: [slotIndexToPosition(mine.slot)], roomId: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offlineLineup, checkoutFlow.state, isWalking, currentUser]);
  const { currentStatus: selfOfficeStatus, manualStatus } = useSelfStatus();

  // DND-room-lock feature: live sets of who else is DND / who occupies which flat room, needed
  // to derive isRoomLocked() at the door-approach gates in walkToSeat/approachCharacter/
  // handleMapRightClick below. See dndClient.ts/roomPresenceClient.ts/data/roomLock.ts.
  const dndEmails = useDndEmails();
  const roomPresenceEntries = useRoomPresence();

  function roomNameFor(roomId: string): string {
    return rooms.find((r) => r.id === roomId)?.name ?? roomId;
  }

  // Edge-triggered self-DND broadcast — mirrors prevManualStatusRef's "initialize to current
  // value so a fresh mount never counts as a transition" contract exactly. DND was previously
  // client-side/localStorage-only (no realtime channel); this is the minimal addition making it
  // visible to other clients, which room-lock derivation needs.
  const prevSelfOfficeStatusRef = useRef(selfOfficeStatus);
  useEffect(() => {
    if (prevSelfOfficeStatusRef.current === selfOfficeStatus) return;
    const wasDnd = prevSelfOfficeStatusRef.current === "DND";
    const isDnd = selfOfficeStatus === "DND";
    prevSelfOfficeStatusRef.current = selfOfficeStatus;
    if (wasDnd !== isDnd) emitDndSet(isDnd);
  }, [selfOfficeStatus]);

  // Edge-triggered self room-occupancy broadcast — fires once per real "crossed into/out of a
  // flat room" transition, reusing the exact same flatRoomIdAt() geometry the door-choreography
  // walks below already use (never a per-frame poll — see room_presence_enter's contract).
  const selfFlatRoomId = flatRoomIdAt({
    x: bonPos.x + playerCharacterLayer.width / 2,
    y: bonPos.y + playerCharacterLayer.height / 2,
  });
  const prevSelfFlatRoomIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevSelfFlatRoomIdRef.current === selfFlatRoomId) return;
    prevSelfFlatRoomIdRef.current = selfFlatRoomId;
    if (selfFlatRoomId) emitRoomPresenceEnter(selfFlatRoomId);
    else emitRoomPresenceLeave();
  }, [selfFlatRoomId]);

  // Set while the viewer's walk into a DND-locked room has stopped at the door's outside stand
  // point (feature spec section 3). `resume` re-enters the exact door-continuation the gating
  // check short-circuited — captured as a closure at the gate site (walkToSeat/approachCharacter/
  // handleMapRightClick) rather than modeled generically, since each site's post-door behavior
  // differs (sit at a seat, arrive at a character, or just stop at the clicked tile).
  // `pendingRequestId` is non-null once the viewer has actually sent a Knock for this gate.
  const [roomEntryGate, setRoomEntryGate] = useState<{
    roomId: string;
    roomName: string;
    resume: () => void;
    pendingRequestId: string | null;
  } | null>(null);
  // Always-latest mirror of roomEntryGate for the room_request_resolved/cancelled socket
  // listeners below (mounted once) and for cancelPendingDoorWalks (called synchronously from
  // event handlers) — both need the CURRENT gate, not the one captured in a stale closure.
  const roomEntryGateRef = useRef(roomEntryGate);
  roomEntryGateRef.current = roomEntryGate;
  // Same always-latest-mirror reasoning as roomEntryGateRef, for the mount-once
  // room_request_cancelled listener below, which needs the CURRENT lock state (not the one from
  // whatever render first mounted the effect) to decide whether to auto-resume.
  const dndEmailsRef = useRef(dndEmails);
  dndEmailsRef.current = dndEmails;
  const roomPresenceEntriesRef = useRef(roomPresenceEntries);
  roomPresenceEntriesRef.current = roomPresenceEntries;
  const [roomEntryDeclined, setRoomEntryDeclined] = useState(false);
  const roomEntryDeclinedTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const offResolved = onRoomRequestResolved((req) => {
      const gate = roomEntryGateRef.current;
      if (!gate || gate.pendingRequestId !== req.id) return; // not this viewer's own outstanding Knock
      if (req.state === "accepted") {
        // One-shot: consume the permission immediately by resuming the exact door-continuation
        // captured at knock time, then clear the gate — a repeat entry after leaving requires a
        // fresh Knock (feature spec section 6: never a persistent whitelist).
        setRoomEntryGate(null);
        gate.resume();
      } else if (req.state === "declined") {
        setRoomEntryGate(null);
        setRoomEntryDeclined(true);
        window.clearTimeout(roomEntryDeclinedTimerRef.current);
        roomEntryDeclinedTimerRef.current = window.setTimeout(() => setRoomEntryDeclined(false), 3000);
      }
    });
    const offCancelled = onRoomRequestCancelled((req) => {
      const gate = roomEntryGateRef.current;
      if (!gate || gate.pendingRequestId !== req.id) return;
      // Almost always this fires because the server auto-cancelled a stale request once the
      // room unlocked (feature spec section 11) — in that case, proceed through the now-open
      // door immediately rather than leaving a stale "🔒 locked" toast up. Re-check live lock
      // state (not just assume unlocked) in case some other occupant is still DND.
      if (!isRoomLocked(gate.roomId, roomPresenceEntriesRef.current, dndEmailsRef.current)) {
        setRoomEntryGate(null);
        gate.resume();
        return;
      }
      setRoomEntryGate({ ...gate, pendingRequestId: null });
    });
    return () => {
      offResolved();
      offCancelled();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleKnock() {
    const gate = roomEntryGateRef.current;
    if (!gate || gate.pendingRequestId) return;
    try {
      const req = await createRoomEntryRequest(gate.roomId);
      setRoomEntryGate((current) => (current && current.roomId === gate.roomId ? { ...current, pendingRequestId: req.id } : current));
    } catch (err) {
      console.error("[roomRequests] failed to send entry request", err);
    }
  }

  function handleCancelKnock() {
    const gate = roomEntryGateRef.current;
    if (!gate?.pendingRequestId) return;
    void cancelRoomEntryRequest(gate.pendingRequestId).catch(() => {});
    setRoomEntryGate({ ...gate, pendingRequestId: null });
  }

  // Person-level DND protection (feature spec section 7) — same shape as roomEntryGate above,
  // but gates Chat/Approach against a specific DND PERSON rather than a room's door. `resume`
  // re-runs the exact approachCharacter call the gate short-circuited. `cooldownUntil` is set
  // only right after a decline (server-authoritative — see talkRequestsClient's
  // TalkRequestCooldownError) so the toast can show "try again in Xm" without polling.
  const [personGate, setPersonGate] = useState<{
    targetEmail: string;
    targetName: string;
    kind: "chat" | "approach";
    resume: () => void;
    pendingRequestId: string | null;
  } | null>(null);
  const personGateRef = useRef(personGate);
  personGateRef.current = personGate;
  const [personGateDeclined, setPersonGateDeclined] = useState(false);
  const [personGateCooldownUntil, setPersonGateCooldownUntil] = useState<string | null>(null);
  const personGateDeclinedTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const offResolved = onTalkRequestResolved((req) => {
      const gate = personGateRef.current;
      if (!gate || gate.pendingRequestId !== req.id) return;
      if (req.state === "accepted") {
        // One-shot: consume the permission immediately, then clear — a future interruption
        // while the target remains DND requires another request (feature spec section 8/9).
        setPersonGate(null);
        gate.resume();
      } else if (req.state === "declined") {
        setPersonGate(null);
        setPersonGateDeclined(true);
        setPersonGateCooldownUntil(null); // this decline's own cooldown isn't known client-side until the NEXT create attempt 429s
        window.clearTimeout(personGateDeclinedTimerRef.current);
        personGateDeclinedTimerRef.current = window.setTimeout(() => setPersonGateDeclined(false), 3000);
      }
    });
    const offCancelled = onTalkRequestCancelled((req) => {
      const gate = personGateRef.current;
      if (!gate || gate.pendingRequestId !== req.id) return;
      // Target turned DND off (or otherwise went stale) while waiting — same "fall back to the
      // resting gate state" reasoning as room-entry's onCancelled handler. If they're no longer
      // DND at all, drop the gate entirely and let the original action proceed normally.
      if (!dndEmailsRef.current.has(gate.targetEmail)) {
        setPersonGate(null);
        gate.resume();
        return;
      }
      setPersonGate({ ...gate, pendingRequestId: null });
    });
    return () => {
      offResolved();
      offCancelled();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRequestTalk() {
    const gate = personGateRef.current;
    if (!gate || gate.pendingRequestId) return;
    try {
      const req = await createTalkRequest(gate.targetEmail, gate.kind);
      setPersonGate((current) => (current && current.targetEmail === gate.targetEmail ? { ...current, pendingRequestId: req.id } : current));
    } catch (err) {
      if (err instanceof TalkRequestCooldownError) {
        setPersonGate(null);
        setPersonGateDeclined(true);
        setPersonGateCooldownUntil(err.cooldownUntil);
        window.clearTimeout(personGateDeclinedTimerRef.current);
        personGateDeclinedTimerRef.current = window.setTimeout(() => setPersonGateDeclined(false), 3000);
        return;
      }
      console.error("[talkRequests] failed to send talk request", err);
    }
  }

  function handleCancelTalkRequest() {
    const gate = personGateRef.current;
    if (!gate?.pendingRequestId) return;
    void cancelTalkRequest(gate.pendingRequestId).catch(() => {});
    setPersonGate({ ...gate, pendingRequestId: null });
  }

  // Break/Lunch auto-walk (client-side-only, see statusMovement.ts): tracks
  // the PREVIOUS manualStatus so the effect below only fires on a genuine
  // user-driven transition, never on mount — initialized to the CURRENT
  // value (which may be BREAK/LUNCH restored from localStorage) so a fresh
  // page load never counts as a "transition" and never triggers a walk.
  const prevManualStatusRef = useRef(manualStatus);
  // Peers' status comes from the read-only Atlas presence feed (5 values),
  // mapped onto our 9-value palette — no backend writes, no new endpoints.
  // Keyed by person.email, which is exactly the layer id rosterLayers.ts
  // assigns roster people (see officePeopleToLayers).
  const statusByLayerId = useMemo<Record<string, OfficeStatus>>(() => {
    const map: Record<string, OfficeStatus> = {};
    for (const person of roster.people) {
      map[person.email] = mapAtlasToOfficeStatus(person.status);
    }
    return map;
  }, [roster.people]);

  // Dev-only preview affordance: ?checkedOut=1 jumps straight into
  // CHECKED_OUT on load, so Bon can preview "avatar standing on the
  // sidewalk after checkout" without walking the whole flow every time.
  // Gated the same way CheckoutDebugPanel already is (import.meta.env.DEV);
  // never wired into any non-dev code path, and doesn't touch the default
  // resume-from-storage behavior for regular users.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (new URLSearchParams(window.location.search).get("checkedOut") !== "1") return;
    checkoutFlow.forceCheckedOut();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Seat the player once identity resolves: at their own desk normally, or
  // at the sidewalk-adjacent exit spawn (bonLayer) if the checkout flow
  // resumed straight into CHECKED_OUT (already checked out today, page
  // reloaded). checkoutFlow.state is safe to read here on the very first
  // render — useCheckoutFlow resolves CHECKED_OUT via a lazy useState
  // initializer (synchronous storage read), not an effect, so there's no
  // "state still says IDLE" race regardless of hook/effect ordering.
  //
  // Still fires ONCE (spawnMovedRef guard) and never mid-walk (isWalking
  // guard) — an in-progress exit-walk animation is left alone.
  useEffect(() => {
    if (spawnMovedRef.current || !viewerLayer || isWalking) return;
    spawnMovedRef.current = true;
    const seatedAtDesk = checkoutFlow.state !== "CHECKED_OUT";
    // Resolve Bon's seat the SAME way the onboarding walk does
    // (resolveOwnSeat: nearest real detected seat to the room's door-in
    // point) rather than viewerLayer.sitDirection — that came from Bon's
    // email-sorted position in the roster array, the same overflow-prone
    // mechanism any other roster person uses, and could disagree with the
    // seat onboarding just walked him to. This keeps "check in fresh" and
    // "reload while already seated" landing in the same seat/direction.
    const seat = seatedAtDesk ? resolveOwnSeat() : null;
    const bw = playerCharacterLayer.width;
    const bh = playerCharacterLayer.height;
    const seatAt = !seatedAtDesk ? bonLayer : seat ? { x: seat.x - bw / 2, y: seat.y - bh / 2 } : viewerLayer;
    resetBonPos({ x: seatAt.x, y: seatAt.y });
    if (seatedAtDesk && seat) {
      sitAtSeat(seat);
    } else {
      setIsSitting(false);
      setCurrentSeatKey(null);
    }
    // Prefer self's OWN last-synced facing (from movement-sync's
    // positions_snapshot, which delivers self's stable entry with
    // stable.facing even though self is excluded from PeerWalker rendering)
    // over the seat/roster default set above — otherwise a reloaded client
    // always shows the seat's fixed direction instead of whichever way bon
    // was actually last facing before reload. Falls back to the seat
    // default (already applied above) when there's no snapshot entry yet.
    const selfSnapshot = getPeerMovementSnapshot().find(
      (p) => p.email === selfChatId.toLowerCase(),
    );
    if (selfSnapshot) {
      if (selfSnapshot.stable.state === "sitting") {
        setSitDirection(selfSnapshot.stable.facing);
      } else {
        face(selfSnapshot.stable.facing);
      }
    }
    // resolveOwnSeat/playerCharacterLayer intentionally omitted below:
    // resolveOwnSeat is a plain function recreated every render (not
    // memoized), and listing it (or the layer dims it reads) would re-fire
    // this effect on every render, defeating the spawnMovedRef "once" guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerLayer, isWalking, resetBonPos, checkoutFlow.state]);

  // Once real people are on the floor, the manifest's fictional cast is
  // hidden — otherwise employees and characters share the office. The
  // viewer's own manifest layer (playerLayerId — not necessarily "bon" any
  // more) is exempt: that layer IS the viewer's avatar, not an NPC, and stays
  // visible after checkout too — checkout auto-walks it to the sidewalk
  // (bonLayer) and it should remain standing there, not vanish.
  // npcCharacterLayers itself only excludes "bon" by construction, so when
  // the viewer is alex/micah/lui we still have to filter their id out here
  // explicitly, or their own manifest layer would get hidden right along
  // with the fictional cast.
  // The manifest "bon" layer is NOT in npcCharacterLayers (excluded by
  // construction), so it was never hidden for a non-Bon viewer — and once a
  // REAL roster person resolves to avatar id "bon" (Bon/Jerevon's own
  // roster layer, keyed by email), that viewer saw two Bons: the static
  // manifest one idling at its manifest spot plus the synced roster one.
  // Hide the manifest bon layer only in that case, so the single surviving
  // Bon is the roster layer that all email-keyed peer state (position,
  // walking, facing, sitting, spatial typing, Global Chat activity) already
  // attaches to. With no roster Bon (pure mock cast) the manifest Bon stays,
  // and the viewer's own player layer is never hidden.
  const hiddenCharacterIds = useMemo(() => {
    if (!rosterActive) return [];
    const ids = npcCharacterLayers.filter((layer) => layer.id !== playerLayerId).map((layer) => layer.id);
    const rosterHasBon = rosterLayers.some((layer) => avatarIdForEmail(layer.id) === "bon");
    if (playerLayerId !== "bon" && rosterHasBon) ids.push("bon");
    return ids;
  }, [rosterActive, playerLayerId, rosterLayers]);

  const checkoutBusy =
    checkoutFlow.state === "SAYING_GOODBYE" ||
    checkoutFlow.state === "WALKING_TO_RECEPTION" ||
    checkoutFlow.state === "WALKING_TO_EXIT";
  const exitTriggeredRef = useRef(false);
  const [frozenCheckoutAtMs, setFrozenCheckoutAtMs] = useState<number | null>(null);

  // Right-click-to-move destination feedback ring (see handleMapRightClick
  // below) — `key` bumps on every right-click, even repeat clicks on the
  // same tile, so OfficeStage's CSS animation restarts each time. Cleared
  // via a timer matching the CSS animation's duration so a lingering
  // (invisible, opacity:0) ring div doesn't sit in the DOM indefinitely.
  const [destinationRing, setDestinationRing] = useState<{ x: number; y: number; valid: boolean; key: number } | null>(null);
  const destinationRingKeyRef = useRef(0);
  const destinationRingTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (checkoutFlow.submissionResult?.submittedAt) {
      setFrozenCheckoutAtMs(new Date(checkoutFlow.submissionResult.submittedAt).getTime());
    }
  }, [checkoutFlow.submissionResult]);

  // Debug-only full reset — wired to the debug panel's "Clear worked-time
  // override" action. Clearing the override (h === null) also lets the dev
  // re-test check-in without a hard refresh: resets the checkout state
  // machine + today's storage, re-arms Arisha's "Check in" menu option, and
  // snaps bon back to his manifest spawn position/visibility in case the
  // checkout exit walk had hidden or moved him.
  function handleSetDebugHoursWorked(h: number | null) {
    setDebugHoursWorked(h);
    if (h !== null) return;
    checkoutFlow.resetToday();
    setHasCheckedIn(false);
    setOnboarding("done");
    setFrozenCheckoutAtMs(null);
    window.clearTimeout(greetTimerRef.current);
    setGreeting(null);
    cancelWalk();
    window.clearTimeout(checkoutDoorTimerRef.current);
    checkoutDoorTimerRef.current = undefined;
    checkoutDoorNonceRef.current += 1;
    resetBonPos({ x: bonLayer.x, y: bonLayer.y });
  }

  // SAYING_GOODBYE/WALKING_TO_RECEPTION: goodbye bubble, then walk to Arisha
  // using the same standoff-goal logic as startCheckin.
  function handleConfirmStartCheckout() {
    checkoutFlow.confirmStartCheckout();
    window.clearTimeout(greetTimerRef.current);
    greetNonceRef.current += 1;
    setGreeting({ characterId: playerLayerId, nonce: greetNonceRef.current, text: "Bye, everyone! 👋" });
    greetTimerRef.current = window.setTimeout(() => {
      setGreeting(null);
      beginWalkToReception();
    }, 2000);
  }

  // Who the viewer walks up to on the way out. With a live roster the
  // scripted receptionist (Arisha) is hidden, so target a real person in
  // reception instead; fall back to her layer only when the roster is empty
  // (mock mode, or before the first load settles).
  function receptionGreetTarget(): AssetLayer | undefined {
    if (rosterActive) {
      const inReception = rosterLayers.find((layer) =>
        roomContainingPoint({
          x: layer.x + layer.width / 2,
          y: layer.y + layer.height / 2,
        })?.id.includes("reception"),
      );
      if (inReception) return inReception;
      // Nobody currently in reception via the live roster — fall through to
      // the scripted Arisha NPC (hidden under rosterActive, but still a valid
      // walk target) so the checkout walk/door-hold still runs, mirroring how
      // startCheckin always targets her regardless of roster state.
    }
    return npcCharacterLayers.find((l) => l.id === "arisha");
  }

  function beginWalkToReception() {
    const arisha = receptionGreetTarget();
    if (!arisha) {
      checkoutFlow.arrivedAtReception();
      return;
    }
    const bw = playerCharacterLayer.width;
    const bh = playerCharacterLayer.height;
    const bc = { x: bonPos.x + bw / 2, y: bonPos.y + bh / 2 };
    const tc = { x: arisha.x + arisha.width / 2, y: arisha.y + arisha.height / 2 };
    const dx = tc.x - bc.x;
    const dy = tc.y - bc.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const standoff = arisha.width / 2 + bw / 2 + 4;
    const bcCell = worldToCell(bc);
    const tcCell = worldToCell(tc);
    const standSpot = nearestStandSpotConnectedTo(tcCell.cx, tcCell.cy, bcCell.cx, bcCell.cy);
    const goal = standSpot
      ? (() => {
          const w = cellToWorld(standSpot.cx, standSpot.cy);
          return { x: w.x - bw / 2, y: w.y - bh / 2 };
        })()
      : (() => {
          // No hand-painted stand spot nearby — fall back to pure geometry,
          // but the geometric offset has no awareness of walls/furniture, so
          // it can land on a blocked tile with the finer 16px grid. Snap to
          // the nearest walkable cell connected to bon's own region before
          // using it as a walk target.
          const raw = { x: tc.x - ux * standoff - bw / 2, y: tc.y - uy * standoff - bh / 2 };
          const rawCell = worldToCell({ x: raw.x + bw / 2, y: raw.y + bh / 2 });
          const snapped = nearestWalkableConnectedTo(rawCell.cx, rawCell.cy, bcCell.cx, bcCell.cy);
          const w = cellToWorld(snapped.cx, snapped.cy);
          return { x: w.x - bw / 2, y: w.y - bh / 2 };
        })();
    const goalRoomId = roomOf(tc)?.id ?? null;

    {
      const ref = transformRef.current;
      const wrapper = ref?.instance.wrapperComponent;
      if (ref && wrapper) {
        const rect = wrapper.getBoundingClientRect();
        const focusScale = initialScale * 2.5;
        const { x, y } = computeCenterTransform(arisha, focusScale, rect.width, rect.height);
        ref.setTransform(x, y, focusScale, 600, "easeOut");
      }
    }
    pipSideRef.current = arisha.x > bonPos.x ? "left" : "right";
    const arriveCenter = { x: goal.x + bw / 2, y: goal.y + bh / 2 };
    // Door-gated on the way OUT of whatever room bon is currently in (his
    // own department, typically) — falls through to the single walk above
    // unchanged when that room has no complete door pair.
    walkOutOfRoomThenTo(
      goal,
      goalRoomId,
      () => {
        checkoutFlow.arrivedAtReception();
        const ref = transformRef.current;
        const wrapper = ref?.instance.wrapperComponent;
        if (ref && wrapper) {
          const rect = wrapper.getBoundingClientRect();
          const focusScale = initialScale * 3;
          const { x, y } = computeCenterTransform(arisha, focusScale, rect.width, rect.height);
          ref.setTransform(x, y, focusScale, 500, "easeOut");
        }
      },
      directionBetween(arriveCenter, tc),
    );
  }

  function handleCancelCheckoutWalk() {
    cancelWalk();
    window.clearTimeout(checkoutDoorTimerRef.current);
    checkoutDoorTimerRef.current = undefined;
    checkoutDoorNonceRef.current += 1;
    checkoutFlow.cancelWalkToReception();
    resetToInitialView();
  }

  // CHECKOUT_SUCCESS -> Arisha speaks the "You're all set" bubble (matches
  // check-in greeting beat timing), THEN bon walks back to his original
  // outside spawn point (bonLayer's initial x/y — the same spot the
  // onboarding mount-focus effect above frames), then finish.
  useEffect(() => {
    if (checkoutFlow.state !== "CHECKOUT_SUCCESS") {
      exitTriggeredRef.current = false;
      return;
    }
    if (exitTriggeredRef.current) return;
    exitTriggeredRef.current = true;

    function proceedWithExitWalk() {
      checkoutFlow.startExitWalk();
      const goal = { x: bonLayer.x, y: bonLayer.y };
      const goalCenter = { x: goal.x + playerCharacterLayer.width / 2, y: goal.y + playerCharacterLayer.height / 2 };
      const goalRoomId = roomOf(goalCenter)?.id ?? null;
      pipSideRef.current = goal.x > bonPos.x ? "left" : "right";
      // Door-gated on the way OUT of reception (bon's current room at this
      // point) — a no-op today since doorStandForRoom("reception-team")
      // (or whatever reception's flat id resolves to) returns null until its
      // stand-point pair is painted, but wired correctly for when that
      // lands. Falls through to the single walk unchanged in the meantime.
      walkOutOfRoomThenTo(
        goal,
        goalRoomId,
        () => {
        window.clearTimeout(greetTimerRef.current);
        greetNonceRef.current += 1;
        setGreeting({ characterId: playerLayerId, nonce: greetNonceRef.current, text: "Bye, everyone! 👋" });
        greetTimerRef.current = window.setTimeout(() => {
          setGreeting(null);
          checkoutFlow.finishExit();
        }, 1500);
        },
        "front",
      );
    }

    const arisha = npcCharacterLayers.find((l) => l.id === "arisha");
    if (arisha) {
      playGreetingBeats(
        [{ characterId: arisha.id, text: "You're all set. Have a great evening! 👋", durationMs: 1800 }],
        proceedWithExitWalk,
      );
    } else {
      proceedWithExitWalk();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutFlow.state]);

  // Mini-camera PiP side: decided ONCE per walk action (not per-frame), based
  // on where that action's interaction target sits relative to bon's
  // starting position — target to the right -> PiP sits bottom-left (out of
  // his path); target to the left -> bottom-right. Set by each walkTo call
  // site below and held fixed for the whole walk; never mutated mid-walk.
  const pipSideRef = useRef<"left" | "right">("left");
  // Pending door-open/door-close timeout for an in-flight approachCharacter
  // door-gated walk (pat/chat) — cleared whenever a new approach starts or
  // the component unmounts, so a stale callback can't fire after the fact.
  // Unlike walkToAssignedDepartment's single onboarding-locked walk, pat/chat
  // can be re-triggered repeatedly during normal play, so this guard matters
  // here.
  const approachDoorTimerRef = useRef<number | undefined>(undefined);
  const approachNonceRef = useRef(0);
  // Pending door-open/door-close timeout for checkout's OUTWARD (room-exit)
  // door-gated walks — beginWalkToReception (leaving the department) and
  // proceedWithExitWalk (leaving reception, once its stand-point pair is
  // painted). Kept separate from approachDoorTimerRef (which gates pat/chat's
  // INWARD walks) so the two independent flows never clash over a shared
  // timer/nonce. Unlike pat/chat, checkout's mid-pause is user-cancelable
  // (handleCancelCheckoutWalk, the debug hours-reset path), so this guard is
  // required here, not just a nice-to-have.
  const checkoutDoorTimerRef = useRef<number | undefined>(undefined);
  const checkoutDoorNonceRef = useRef(0);
  // Pending door-open/door-close timeout for an in-flight click-to-sit
  // walkToSeat walk — dedicated pair (not shared with approachDoorTimerRef/
  // checkoutDoorTimerRef) so re-clicking a different seat mid-walk cancels
  // cleanly without touching an unrelated pat/chat/checkout walk that might
  // also be pending, and vice versa.
  const seatDoorTimerRef = useRef<number | undefined>(undefined);
  const seatDoorNonceRef = useRef(0);
  // Pending door-open/door-close timeout for an in-flight right-click-to-move
  // walk that's crossing into a different room (handleMapRightClick below) —
  // dedicated pair, same reasoning as seatDoorTimerRef/seatDoorNonceRef: a
  // second right-click mid-door-pause must cancel cleanly without touching
  // an unrelated pat/chat/seat/checkout walk that might also be pending.
  const mapRightClickDoorTimerRef = useRef<number | undefined>(undefined);
  const mapRightClickDoorNonceRef = useRef(0);

  // walkToSeat, approachCharacter, and checkout's walkOutOfRoomThenTo are all
  // reachable from the same app-state window (onboarding === "done" &&
  // !checkoutBusy overlaps with the checkout flow's own gating in ways that
  // are easy to get wrong) — each flow's own door-gate refs above only
  // self-cancel, so a click into a DIFFERENT flow's door-gated walk while one
  // is mid-pause (waiting on DOOR_ANIM_MS at a door's outStand point, still
  // clickable) would leave the other flow's stale timeout pending. It later
  // fires and hijacks the new walk (see the click-to-sit vs approach race).
  // Call this at the very top of every door-gated walk starter, before that
  // starter captures its own local `nonce` snapshot, so cross-flow AND
  // same-flow cancellation both happen in one place.
  function cancelPendingDoorWalks() {
    window.clearTimeout(seatDoorTimerRef.current);
    seatDoorTimerRef.current = undefined;
    seatDoorNonceRef.current += 1;

    window.clearTimeout(approachDoorTimerRef.current);
    approachDoorTimerRef.current = undefined;
    approachNonceRef.current += 1;

    window.clearTimeout(checkoutDoorTimerRef.current);
    checkoutDoorTimerRef.current = undefined;
    checkoutDoorNonceRef.current += 1;

    window.clearTimeout(mapRightClickDoorTimerRef.current);
    mapRightClickDoorTimerRef.current = undefined;
    mapRightClickDoorNonceRef.current += 1;

    // Any new door-gated walk invalidates a Knock the viewer left outstanding at a locked
    // room's door — walking away/changing destination cancels it rather than leaving a stale
    // pending request behind (feature spec section 11: "requester walks away while waiting" /
    // "requester changes destination").
    const gate = roomEntryGateRef.current;
    if (gate?.pendingRequestId) {
      void cancelRoomEntryRequest(gate.pendingRequestId).catch(() => {});
    }
    if (gate) setRoomEntryGate(null);
  }

  const PIP_WIDTH = 240;
  const PIP_HEIGHT = 180;
  const pipScale = initialScale * 2.5;
  const pipTransform = computeCenterTransform(
    { x: bonPos.x, y: bonPos.y, width: playerCharacterLayer.width, height: playerCharacterLayer.height },
    pipScale,
    PIP_WIDTH,
    PIP_HEIGHT,
  );

  // Frame the camera on the viewer's outside spawn on mount. Runs once —
  // does not rely on TransformWrapper's own centerOnInit/computeCoverScale
  // framing, since the default cover-fit view may not show the bottom band
  // of the frame where the viewer now spawns on some viewport aspect
  // ratios. The spawn POSITION (bonLayer.x/y) is a fixed physical entrance
  // point shared by whoever is viewing, not an identity — only the framing
  // box's width/height comes from the viewer's own sprite dimensions.
  useEffect(() => {
    const ref = transformRef.current;
    const wrapper = ref?.instance.wrapperComponent;
    if (!ref || !wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    // Close-in, animated zoom on the viewer at mount — matches the
    // room-focus / character-click zoom feel rather than the flat, instant
    // cover framing.
    const focusScale = initialScale * 2.5;
    const { x, y } = computeCenterTransform(
      { x: bonLayer.x, y: bonLayer.y, width: playerCharacterLayer.width, height: playerCharacterLayer.height },
      focusScale,
      rect.width,
      rect.height,
    );
    ref.setTransform(x, y, focusScale, 600, "easeOut");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Plays a sequence of greeting bubbles one at a time, each fully dismissing
  // before the next appears. Reuses the existing greeting/greetTimerRef
  // mechanism — each beat clears any pending timer, bumps the nonce, sets the
  // bubble, then schedules clearing it and advancing to the next beat (or
  // running `onDone` after the last beat clears).
  function playGreetingBeats(
    beats: { characterId: string; text: string; durationMs: number }[],
    onDone: () => void,
  ) {
    function playAt(index: number) {
      const beat = beats[index];
      if (!beat) {
        onDone();
        return;
      }
      window.clearTimeout(greetTimerRef.current);
      greetNonceRef.current += 1;
      setGreeting({ characterId: beat.characterId, nonce: greetNonceRef.current, text: beat.text });
      greetTimerRef.current = window.setTimeout(() => {
        setGreeting(null);
        playAt(index + 1);
      }, beat.durationMs);
    }
    playAt(0);
  }

  function startCheckin() {
    const arisha = npcCharacterLayers.find((l) => l.id === "arisha");
    if (!arisha) {
      // No reception NPC found (shouldn't happen) — skip straight to done
      // rather than getting stuck mid-onboarding.
      setOnboarding("done");
      return;
    }
    const bw = playerCharacterLayer.width;
    const bh = playerCharacterLayer.height;
    const bc = { x: bonPos.x + bw / 2, y: bonPos.y + bh / 2 };
    const tc = { x: arisha.x + arisha.width / 2, y: arisha.y + arisha.height / 2 };
    const dx = tc.x - bc.x;
    const dy = tc.y - bc.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const standoff = arisha.width / 2 + bw / 2 + 4;
    const bcCell = worldToCell(bc);
    const tcCell = worldToCell(tc);
    const standSpot = nearestStandSpotConnectedTo(tcCell.cx, tcCell.cy, bcCell.cx, bcCell.cy);
    const goal = standSpot
      ? (() => {
          const w = cellToWorld(standSpot.cx, standSpot.cy);
          return { x: w.x - bw / 2, y: w.y - bh / 2 };
        })()
      : (() => {
          // No hand-painted stand spot nearby — fall back to pure geometry,
          // but the geometric offset has no awareness of walls/furniture, so
          // it can land on a blocked tile with the finer 16px grid. Snap to
          // the nearest walkable cell connected to bon's own region before
          // using it as a walk target.
          const raw = { x: tc.x - ux * standoff - bw / 2, y: tc.y - uy * standoff - bh / 2 };
          const rawCell = worldToCell({ x: raw.x + bw / 2, y: raw.y + bh / 2 });
          const snapped = nearestWalkableConnectedTo(rawCell.cx, rawCell.cy, bcCell.cx, bcCell.cy);
          const w = cellToWorld(snapped.cx, snapped.cy);
          return { x: w.x - bw / 2, y: w.y - bh / 2 };
        })();
    const startRoomId = roomOf(bc)?.id ?? null;
    const goalRoomId = roomOf(tc)?.id ?? null;
    const path = findPath({ x: bonPos.x, y: bonPos.y }, goal, startRoomId, goalRoomId);

    setOnboarding("walkingToReception");
    // Static camera focus on Arisha — bon may walk off-screen while
    // approaching; the mini-camera PiP (rendered while isWalking) tracks him
    // instead. Mirrors the mount-focus effect above.
    {
      const ref = transformRef.current;
      const wrapper = ref?.instance.wrapperComponent;
      if (ref && wrapper) {
        const rect = wrapper.getBoundingClientRect();
        const focusScale = initialScale * 2.5;
        const { x, y } = computeCenterTransform(arisha, focusScale, rect.width, rect.height);
        ref.setTransform(x, y, focusScale, 600, "easeOut");
      }
    }
    pipSideRef.current = arisha.x > bonPos.x ? "left" : "right";
    const arriveCenter = { x: goal.x + bw / 2, y: goal.y + bh / 2 };
    // Facing folded into arrival.facing (not a post-arrival face() call) so
    // walk_arrived carries the FINAL facing bon turns to face Arisha.
    moveSelf({
      path,
      roomId: goalRoomId,
      arrival: { state: "standing", facing: directionBetween(arriveCenter, tc) },
      onArrive: () => {
      setOnboarding("greeting");
      // Three sequential beats — a proper greet/respond/prompt exchange
      // rather than one static bubble. Each beat fully dismisses before the
      // next appears; the last beat now walks straight to the viewer's own
      // assigned department room (no room-picker step).
      playGreetingBeats(
        [
          { characterId: arisha.id, text: `Hi ${formatCharacterName(playerCharacterLayer)}!`, durationMs: 1500 },
          { characterId: playerLayerId, text: `Hi ${formatCharacterName(arisha)}!`, durationMs: 1500 },
          { characterId: arisha.id, text: "Come on, I'll show you to your desk!", durationMs: 1500 },
        ],
        () => walkToAssignedDepartment(),
      );
      },
    });
  }

  // Bridges the `rooms`/`teamRooms` namespace roomIdForPerson() returns
  // (e.g. "design-team", "executive-team") into the `roomLayers`/manifest
  // namespace (e.g. "design-room", "executive-room") used by the walk/zoom
  // logic below — via that room's flat-rect CENTER point run through
  // roomContainingPoint(), the existing documented convention for crossing
  // these two id schemes (see office-layout.ts).
  // Bon's own live seat, resolved the SAME way for both the onboarding
  // door-gated arrival (below) and the spawn-at-desk effect above — nearest
  // real detected seat to the room's door-in point (or the room's center,
  // for rooms with no painted door stand-point pair yet), NEVER the
  // roster's email-sorted seats[i] assignment (rosterLayers.ts's
  // officePeopleToLayers), which any other roster person can land past into
  // the overflow fallback. Returns null only when the room has no painted
  // seats at all.
  //
  // Always returns the seat's OWN fixed direction — the spawn-at-desk
  // effect above (spawnMovedRef) overrides this with self's own synced
  // facing from movement-sync's positions_snapshot when available (self's
  // stable entry arrives even though self is excluded from PeerWalker
  // rendering), falling back to this seat default only when there's no
  // snapshot entry yet. Self's FINAL facing is also broadcast via
  // walk_arrived (see moveSelf arrival.facing call sites above), so OTHER
  // clients and the DB see the correct facing too. Peers restore their own
  // facing correctly via PeerWalker's stable-state snap.
  function resolveOwnSeat(): Seat | null {
    const flatRoomId = roomIdForPerson(currentUser?.email, currentUser?.team ?? null) ?? FALLBACK_ROOM_ID;
    const doorPair = doorStandForRoom(flatRoomId);
    if (doorPair) return nearestSeatTo(flatRoomId, doorPair.inStand);
    const flatRoom = rooms.find((r) => r.id === flatRoomId);
    if (!flatRoom) return null;
    const center = { x: flatRoom.x + flatRoom.width / 2, y: flatRoom.y + flatRoom.height / 2 };
    return nearestSeatTo(flatRoomId, center);
  }

  function resolveAssignedRoomLayer(): AssetLayer {
    const roomId = roomIdForPerson(currentUser?.email, currentUser?.team ?? null) ?? FALLBACK_ROOM_ID;
    const flatRoom = rooms.find((r) => r.id === roomId) ?? rooms.find((r) => r.id === FALLBACK_ROOM_ID)!;
    const center = { x: flatRoom.x + flatRoom.width / 2, y: flatRoom.y + flatRoom.height / 2 };
    return roomContainingPoint(center) ?? roomLayers.find((l) => l.id === FALLBACK_ROOM_ID)!;
  }

  function walkToAssignedDepartment() {
    const layer = resolveAssignedRoomLayer();
    // Flat rooms/teamRooms-namespace id (e.g. "design-team"), needed to look
    // up a door stand-point pairing — doorStandPoints.ts classifies stand
    // points against office-layout.ts's flat `rooms` rects, which use this
    // id scheme, not the manifest `layer.id` scheme (e.g. "design-room").
    const flatRoomId = roomIdForPerson(currentUser?.email, currentUser?.team ?? null) ?? FALLBACK_ROOM_ID;
    // Hold bon still while the camera zooms out slowly, THEN walk — a
    // deliberate "zoom out to see more of the office, then watch bon walk"
    // sequence rather than an instant cut + concurrent walk.
    setOnboarding("walkingToRoom");
    const zoomOutMs = 1000;
    resetToInitialView(zoomOutMs);
    window.setTimeout(() => {
      const bw = playerCharacterLayer.width;
      const bh = playerCharacterLayer.height;
      const startCenter = { x: bonPos.x + bw / 2, y: bonPos.y + bh / 2 };
      const roomCenter = { x: layer.x + layer.width / 2, y: layer.y + layer.height / 2 };
      const startCell = worldToCell(startCenter);
      const roomCell = worldToCell(roomCenter);
      const startRoomId = roomOf(startCenter)?.id ?? null;

      // `seat` is passed ONLY when this arrival is a real seat (nearestSeat
      // found below) — never for the door-only fallback landing (plain
      // room-center/door-cell walk further down), which leaves the player
      // standing, not sitting.
      function finishArrival(seat?: Seat) {
        if (seat) {
          sitAtSeat(seat);
        }
        // No-seat facing is no longer set here: both moveSelf call sites
        // that lead here with no seat (the door-pair pathToInStand leg
        // above, and the no-door-pair fallback leg below) already carry
        // arrival: { state: "standing", facing: "front" } upfront, so
        // walk_arrived already broadcasts the correct final facing — a
        // local-only face("front") here would be redundant.
        window.clearTimeout(greetTimerRef.current);
        greetNonceRef.current += 1;
        setGreeting({ characterId: playerLayerId, nonce: greetNonceRef.current, text: "Hi team!" });
        greetTimerRef.current = window.setTimeout(() => setGreeting(null), 3000);
        setOnboarding("done");
        setHasCheckedIn(true);
        openCompanyHub("checkin");
      }

      pipSideRef.current = roomCenter.x > startCenter.x ? "left" : "right";

      // Two-leg door-gated walk: stop just outside the room's door, "wait"
      // for it to open, step through, stop just inside for a close beat.
      // Only used when this room's door has a complete hand-painted in/out
      // stand-point pair (see doorStandPoints.ts) — most rooms don't have
      // one painted yet, so this is the exception path, not the norm.
      const doorPair = doorStandForRoom(flatRoomId);
      if (doorPair) {
        const outGoal = { x: doorPair.outStand.x - bw / 2, y: doorPair.outStand.y - bh / 2 };
        const inGoal = { x: doorPair.inStand.x - bw / 2, y: doorPair.inStand.y - bh / 2 };
        const pathToOutStand = findPath({ x: bonPos.x, y: bonPos.y }, outGoal, startRoomId, layer.id);

        moveSelf({
          path: pathToOutStand,
          roomId: layer.id,
          onArrive: () => {
          // The full-map reveal (resetToInitialView above) has done its job
          // by now (bon has walked all the way to the door) — narrow to
          // room-fit right as the door is about to slide open, so the
          // animation is actually visible, then hold room-fit through the
          // door crossing + arrival greeting.
          focusRoomFit(flatRoomId);
          onDoorOpen(flatRoomId);
          window.setTimeout(() => {
            const pathToInStand = findPath(outGoal, inGoal, layer.id, layer.id);
            // Facing folded into arrival.facing ("front", the door-threshold
            // default) rather than a post-arrival face() call — this leg's
            // walk_arrived is superseded a moment later by the pathToSeat
            // leg's own arrival.facing (nearestSeat.direction) when a seat
            // exists, and is the FINAL facing broadcast when it doesn't (see
            // finishArrival's no-seat branch below), so peers/reload see the
            // correct facing either way instead of this leg's last walking
            // direction.
            moveSelf({
              path: pathToInStand,
              roomId: layer.id,
              arrival: { state: "standing", facing: "front" },
              onArrive: () => {
              onDoorClose(flatRoomId);
              // Don't leave bon glued to the door threshold — walk him one
              // more short leg to an actual seat inside the room. This makes
              // checkout's first leg (seat -> inStand) a real, visible walk
              // instead of a zero-distance one that fires its arrival
              // callback synchronously (see useCharacterWalk.ts). Falls back
              // to greeting immediately if this room has no painted seats.
              const nearestSeat = resolveOwnSeat();
              if (nearestSeat) {
                const seatGoal = { x: nearestSeat.x - bw / 2, y: nearestSeat.y - bh / 2 };
                const pathToSeat = findPath(inGoal, seatGoal, layer.id, layer.id);
                moveSelf({
                  path: pathToSeat,
                  roomId: layer.id,
                  arrival: {
                    state: "sitting",
                    seatKey: seatCentroidKey(nearestSeat.x, nearestSeat.y),
                    facing: nearestSeat.direction,
                  },
                  onArrive: () => finishArrival(nearestSeat),
                });
              } else {
                // Facing already correct: the pathToInStand moveSelf above
                // carries arrival.facing="front" upfront (see its comment),
                // so walk_arrived already broadcast the right final facing
                // for this no-seat arrival — nothing left to do here.
                finishArrival();
              }
              },
            });
          }, DOOR_ANIM_MS);
          },
        });
        return;
      }

      // Fallback: no complete door stand-point pairing painted for this room
      // yet (tilemap authoring in progress) — existing single-goal walk
      // behavior, unchanged. Prefers the room's hand-painted door ('+') cell
      // as the true arrival point — e.g. design-room's doorway, pixel-precise
      // from Figma data — over a geometric room-center that can land bon
      // behind desks. Falls back further to the old center-snapping
      // heuristic for rooms without a mapped door cell at all.
      const doorCell = findRoomDoorCell(layer);
      const snapped = doorCell
        ? nearestWalkableConnectedTo(doorCell.cx, doorCell.cy, startCell.cx, startCell.cy)
        : nearestWalkableConnectedTo(roomCell.cx, roomCell.cy, startCell.cx, startCell.cy);
      const snappedWorld = cellToWorld(snapped.cx, snapped.cy);
      const goal = { x: snappedWorld.x - bw / 2, y: snappedWorld.y - bh / 2 };
      const path = findPath({ x: bonPos.x, y: bonPos.y }, goal, startRoomId, layer.id);

      // This fallback never resolves a seat (no door pair means no
      // door-gated "walk one more short leg to a seat" step) — arrival.facing
      // is always "front" here, so it's safe to fold in upfront, unlike the
      // door-pair branch's no-seat case above.
      moveSelf({ path, roomId: layer.id, arrival: { state: "standing", facing: "front" }, onArrive: finishArrival });
    }, zoomOutMs);
  }

  // Looks up the flat rects/teamRooms-namespace room id (e.g. "design-team")
  // containing `point`, or null if outside every flat room. This is the same
  // id scheme doorStandForRoom/doorStandPoints.ts classifies stand points
  // against — NOT the roomLayers/manifest scheme (e.g. "design-room") that
  // roomOf()/findPath's goalRoomId use. Mirrors the flat-rect containment
  // check doorStandPoints.ts itself uses internally.
  function flatRoomIdAt(point: { x: number; y: number }): string | null {
    const room = rooms.find(
      (r) => point.x >= r.x && point.x <= r.x + r.width && point.y >= r.y && point.y <= r.y + r.height,
    );
    return room?.id ?? null;
  }

  // Checkout's OUTWARD door-gate: used by beginWalkToReception (leaving the
  // viewer's own department) and proceedWithExitWalk (leaving reception, once
  // its stand-point pair is painted). Mirrors approachCharacter's 3-leg
  // in/out stand-point gate, but keyed off bon's CURRENT room (the one he's
  // leaving) rather than a target character's room — checkout always walks
  // to a fixed goal point, not a person, so this takes the final goal + its
  // manifest room hint directly instead of resolving them from an AssetLayer.
  //
  // Sequence when bon's current room has a complete door pair: start ->
  // inStand (near side, the side he's coming FROM) -> onDoorOpen -> pause
  // DOOR_ANIM_MS -> outStand (far side) -> onDoorClose -> finalGoal ->
  // onArrive. "Walk to the door, it opens, step through, it closes behind
  // you, then continue on your way" — not a close-then-reopen pattern.
  // Falls back to the existing single-goal walk, unchanged, when bon isn't
  // currently in a room with a complete pair (open corridor, or a room whose
  // door isn't fully painted yet).
  function walkOutOfRoomThenTo(
    finalGoal: { x: number; y: number },
    finalGoalRoomId: string | null,
    onArrive: () => void,
    // Final facing bon should end up turned to once this walk's LAST leg
    // arrives — threaded into that leg's moveSelf arrival.facing (not a
    // post-arrival face() call from the caller) so walk_arrived broadcasts
    // the true final facing to peers/DB. Omitted callers keep the walk's own
    // final direction (moveSelf's default).
    arrivalFacing?: WalkDirection,
  ) {
    const bw = playerCharacterLayer.width;
    const bh = playerCharacterLayer.height;
    const bc = { x: bonPos.x + bw / 2, y: bonPos.y + bh / 2 };
    const startRoomId = roomOf(bc)?.id ?? null;
    const flatStartRoomId = flatRoomIdAt(bc);
    const doorPair = flatStartRoomId ? doorStandForRoom(flatStartRoomId) : null;

    // Cancel any pending door timer from a previous checkout walk that hasn't
    // finished yet, and bump the nonce so its in-flight callbacks become
    // no-ops — checkout's mid-pause is user-cancelable (handleCancelCheckoutWalk,
    // the debug hours-reset path), unlike walkToAssignedDepartment's
    // onboarding-locked walk.
    cancelPendingDoorWalks();
    const nonce = checkoutDoorNonceRef.current;

    if (doorPair) {
      const inGoal = { x: doorPair.inStand.x - bw / 2, y: doorPair.inStand.y - bh / 2 };
      const outGoal = { x: doorPair.outStand.x - bw / 2, y: doorPair.outStand.y - bh / 2 };
      const pathToInStand = findPath({ x: bonPos.x, y: bonPos.y }, inGoal, startRoomId, startRoomId);

      moveSelf({
        path: pathToInStand,
        roomId: startRoomId,
        onArrive: () => {
        if (checkoutDoorNonceRef.current !== nonce) return;
        // Room-fit on the room being LEFT, right as bon reaches the door —
        // synchronized with onDoorOpen below, same beat as the entry-side
        // equivalent in walkToAssignedDepartment. The caller's tight-zoom-at-
        // ARRIVAL call (on Arisha, once bon reaches her) is untouched —
        // that's the correct "zoom back in" moment for this flow.
        focusRoomFit(flatStartRoomId!, 600);
        onDoorOpen(flatStartRoomId!);
        checkoutDoorTimerRef.current = window.setTimeout(() => {
          checkoutDoorTimerRef.current = undefined;
          if (checkoutDoorNonceRef.current !== nonce) return;
          const pathToOutStand = findPath(inGoal, outGoal, startRoomId, startRoomId);
          moveSelf({
            path: pathToOutStand,
            roomId: startRoomId,
            onArrive: () => {
            if (checkoutDoorNonceRef.current !== nonce) return;
            onDoorClose(flatStartRoomId!);
            const pathToGoal = findPath(outGoal, finalGoal, startRoomId, finalGoalRoomId);
            moveSelf({
              path: pathToGoal,
              roomId: finalGoalRoomId,
              ...(arrivalFacing ? { arrival: { state: "standing" as const, facing: arrivalFacing } } : {}),
              onArrive: () => {
              if (checkoutDoorNonceRef.current !== nonce) return;
              onArrive();
              },
            });
            },
          });
        }, DOOR_ANIM_MS);
        },
      });
      return;
    }

    // Fallback: bon isn't currently in a room with a complete door pair —
    // existing single-goal walk behavior, unchanged.
    const path = findPath({ x: bonPos.x, y: bonPos.y }, finalGoal, startRoomId, finalGoalRoomId);
    moveSelf({
      path,
      roomId: finalGoalRoomId,
      ...(arrivalFacing ? { arrival: { state: "standing" as const, facing: arrivalFacing } } : {}),
      onArrive,
    });
  }

  // Click-to-sit: walks the viewer to an empty painted seat clicked via the
  // "Sit here" confirm menu (seatMenu state, below). Modeled directly on
  // walkToAssignedDepartment's real-seat arrival leg — door-gated ONLY when
  // crossing into the seat's room from outside AND that room has a complete
  // hand-painted door in/out stand-point pair (see doorStandPoints.ts);
  // otherwise a single-goal walk straight to the seat, same fallback
  // reasoning as every other walk helper in this file. Uses its own
  // seatDoorTimerRef/seatDoorNonceRef pair (declared above) so re-clicking a
  // different seat mid-walk cancels the previous walk's pending door timer
  // and makes its in-flight callbacks no-ops, instead of leaving a stale
  // timer running or double-firing sitAtSeat.
  function walkToSeat(seat: SeatTarget) {
    const bw = playerCharacterLayer.width;
    const bh = playerCharacterLayer.height;
    const startCenter = { x: bonPos.x + bw / 2, y: bonPos.y + bh / 2 };
    const startRoomId = roomOf(startCenter)?.id ?? null;
    const flatStartRoomId = flatRoomIdAt(startCenter);
    const seatGoal = { x: seat.x - bw / 2, y: seat.y - bh / 2 };
    // seat.roomId is the flat rects/teamRooms-namespace id (rooms.ts) — bridge
    // it into the roomLayers/manifest namespace findPath's goalRoomId expects
    // via the seat's own center point, same convention
    // resolveAssignedRoomLayer/flatRoomIdAt use elsewhere in this file.
    const goalRoomId = roomContainingPoint({ x: seat.x, y: seat.y })?.id ?? null;

    cancelPendingDoorWalks();
    const nonce = seatDoorNonceRef.current;

    pipSideRef.current = seat.x > bonPos.x ? "left" : "right";

    const doorPair = flatStartRoomId !== seat.roomId ? doorStandForRoom(seat.roomId) : null;
    if (doorPair) {
      const outGoal = { x: doorPair.outStand.x - bw / 2, y: doorPair.outStand.y - bh / 2 };
      const inGoal = { x: doorPair.inStand.x - bw / 2, y: doorPair.inStand.y - bh / 2 };
      const pathToOutStand = findPath({ x: bonPos.x, y: bonPos.y }, outGoal, startRoomId, goalRoomId);

      focusRoomFit(seat.roomId, 600);
      moveSelf({
        path: pathToOutStand,
        roomId: goalRoomId,
        onArrive: () => {
        if (seatDoorNonceRef.current !== nonce) return;

        function proceedThroughDoor() {
          onDoorOpen(seat.roomId);
          seatDoorTimerRef.current = window.setTimeout(() => {
            seatDoorTimerRef.current = undefined;
            if (seatDoorNonceRef.current !== nonce) return;
            const pathToInStand = findPath(outGoal, inGoal, goalRoomId, goalRoomId);
            moveSelf({
              path: pathToInStand,
              roomId: goalRoomId,
              onArrive: () => {
              if (seatDoorNonceRef.current !== nonce) return;
              onDoorClose(seat.roomId);
              const pathToSeat = findPath(inGoal, seatGoal, goalRoomId, goalRoomId);
              moveSelf({
                path: pathToSeat,
                roomId: goalRoomId,
                arrival: {
                  state: "sitting",
                  seatKey: seatCentroidKey(seat.x, seat.y),
                  facing: seat.direction,
                },
                onArrive: () => {
                if (seatDoorNonceRef.current !== nonce) return;
                sitAtSeat(seat);
                },
              });
              },
            });
          }, DOOR_ANIM_MS);
        }

        // DND-room-lock gate: the target room is protected and this viewer holds no live
        // permission for it yet — stop right here at the door's outside stand point (already
        // reached) instead of continuing through, and surface the Knock/Request-Entry toast
        // (feature spec section 3).
        if (isRoomLocked(seat.roomId, roomPresenceEntries, dndEmails)) {
          setRoomEntryGate({
            roomId: seat.roomId,
            roomName: roomNameFor(seat.roomId),
            resume: proceedThroughDoor,
            pendingRequestId: null,
          });
          return;
        }

        proceedThroughDoor();
        },
      });
      return;
    }

    // Fallback: already in the seat's room, or no complete door stand-point
    // pairing painted for it yet — single-goal walk straight to the seat.
    const path = findPath({ x: bonPos.x, y: bonPos.y }, seatGoal, startRoomId, goalRoomId);
    moveSelf({
      path,
      roomId: goalRoomId,
      arrival: { state: "sitting", seatKey: seatCentroidKey(seat.x, seat.y), facing: seat.direction },
      onArrive: () => {
        if (seatDoorNonceRef.current !== nonce) return;
        sitAtSeat(seat);
      },
    });
  }

  // Break/Lunch auto-walk target: Central Hub has no door gate and no
  // painted seats (see office-assets-manifest.json), so this is a plain
  // walk-to-point using the exact same no-door fallback branch
  // walkToAssignedDepartment uses for rooms without a door stand-point pair
  // — worldToCell -> nearestWalkableConnectedTo -> findPath -> walkTo, then
  // just face("front") on arrival (no seat/sit step).
  function walkToHub() {
    const layer = roomLayers.find((l) => l.id === CENTRAL_HUB_ROOM_ID);
    if (!layer) return;
    const bw = playerCharacterLayer.width;
    const bh = playerCharacterLayer.height;
    const startCenter = { x: bonPos.x + bw / 2, y: bonPos.y + bh / 2 };
    // Already standing in Central Hub (e.g. re-entering a hub status while
    // still there) — nothing to walk to. Reuses the existing room-lookup
    // helper rather than inventing new geometry.
    if (roomContainingPoint(startCenter)?.id === CENTRAL_HUB_ROOM_ID) return;
    const roomCenter = { x: layer.x + layer.width / 2, y: layer.y + layer.height / 2 };
    const startCell = worldToCell(startCenter);
    const roomCell = worldToCell(roomCenter);
    const startRoomId = roomOf(startCenter)?.id ?? null;
    const doorCell = findRoomDoorCell(layer);
    const snapped = doorCell
      ? nearestWalkableConnectedTo(doorCell.cx, doorCell.cy, startCell.cx, startCell.cy)
      : nearestWalkableConnectedTo(roomCell.cx, roomCell.cy, startCell.cx, startCell.cy);
    const snappedWorld = cellToWorld(snapped.cx, snapped.cy);
    const goal = { x: snappedWorld.x - bw / 2, y: snappedWorld.y - bh / 2 };
    const path = findPath({ x: bonPos.x, y: bonPos.y }, goal, startRoomId, layer.id);
    // Facing folded into arrival.facing (not a post-arrival face() call) so
    // walk_arrived broadcasts the FINAL facing.
    moveSelf({ path, roomId: layer.id, arrival: { state: "standing", facing: "front" } });
  }

  // Available-from-Break/Lunch auto-walk target: the viewer's own assigned
  // desk. Adapts resolveOwnSeat()'s result (a bare Seat, no roomId) into the
  // SeatTarget shape walkToSeat expects — attaching the flat-namespace room
  // id the same way resolveOwnSeat itself resolves it — so the return trip
  // reuses walkToSeat's existing door-gating + sit-down behavior instead of
  // duplicating it. Falls back to walkToAssignedDepartment() (which itself
  // resolves and sits at the same seat) if no painted seat is found.
  function walkBackToDesk() {
    const seat = resolveOwnSeat();
    if (!seat) {
      walkToAssignedDepartment();
      return;
    }
    const flatRoomId = roomIdForPerson(currentUser?.email, currentUser?.team ?? null) ?? FALLBACK_ROOM_ID;
    walkToSeat({
      ...seat,
      roomId: flatRoomId,
      index: 0,
      key: `own-desk-${seatCentroidKey(seat.x, seat.y)}`,
    });
  }

  // Break/Lunch auto-walk trigger (client-side-only visual effect, see
  // statusMovement.ts): keyed ONLY on manualStatus transitions, never on
  // resolveCurrentStatus's derived value — an Away/InConversation/InCall
  // overlay during a Break/Lunch stay must not re-trigger movement.
  useEffect(() => {
    const prev = prevManualStatusRef.current;
    prevManualStatusRef.current = manualStatus;
    if (prev === manualStatus) return;
    // Don't fire during spawn/onboarding or checkout — both already drive
    // their own scripted walks, and firing here would collide with them.
    if (onboarding !== "done" || checkoutBusy) return;
    const move = resolveManualStatusMovement(prev, manualStatus);
    if (move === "HUB") {
      walkToHub();
    } else if (move === "DESK") {
      walkBackToDesk();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualStatus]);

  // Shared "walk up to a character to interact with them" logic — used by
  // both `pat` and `chat` (checkout's walk-to-reception has its own
  // call site and is intentionally NOT routed through this, since Arisha's
  // room has no complete door-stand pairing anyway).
  //
  // Computes the same near-target stand-spot goal both actions always have,
  // then — only when bon is currently OUTSIDE the target's room AND that
  // room has a complete hand-painted door in/out stand-point pair (see
  // doorStandPoints.ts) — inserts a 3-leg door-gated walk in front of it:
  // stand outside the door, "wait" for it to open, step inside, "wait" for
  // it to close, then continue to the actual near-person stand spot.
  // Otherwise (already in the same room, or no door pairing painted yet for
  // that room) falls back to the single existing walk, unchanged.
  // `onArrive` receives the resolved arriveCenter/targetCenter pair (the same
  // ones used for bon's own `face(directionBetween(arriveCenter, tc))` calls
  // below) so callers that also need to turn the TARGET to face bon (e.g. the
  // pat handler, for alex/micah/lui) don't have to recompute them.
  function approachCharacter(
    target: AssetLayer,
    onArrive: (arriveCenter: { x: number; y: number }, targetCenter: { x: number; y: number }) => void,
    destOverride?: { x: number; y: number },
  ) {
    const bw = playerCharacterLayer.width;
    const bh = playerCharacterLayer.height;
    const bc = { x: bonPos.x + bw / 2, y: bonPos.y + bh / 2 };
    const tc = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
    const dx = tc.x - bc.x;
    const dy = tc.y - bc.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const standoff = target.width / 2 + bw / 2 + 4;
    const bcCell = worldToCell(bc);
    const tcCell = worldToCell(tc);
    const goal = destOverride
      ? destOverride
      : (() => {
          const standSpot = nearestStandSpotConnectedTo(tcCell.cx, tcCell.cy, bcCell.cx, bcCell.cy);
          return standSpot
            ? (() => {
                const w = cellToWorld(standSpot.cx, standSpot.cy);
                return { x: w.x - bw / 2, y: w.y - bh / 2 };
              })()
            : (() => {
                // No hand-painted stand spot nearby — fall back to pure
                // geometry, but the geometric offset has no awareness of
                // walls/furniture, so it can land on a blocked tile with the
                // finer 16px grid. Snap to the nearest walkable cell connected
                // to bon's own region before using it as a walk target.
                const raw = { x: tc.x - ux * standoff - bw / 2, y: tc.y - uy * standoff - bh / 2 };
                const rawCell = worldToCell({ x: raw.x + bw / 2, y: raw.y + bh / 2 });
                const snapped = nearestWalkableConnectedTo(rawCell.cx, rawCell.cy, bcCell.cx, bcCell.cy);
                const w = cellToWorld(snapped.cx, snapped.cy);
                return { x: w.x - bw / 2, y: w.y - bh / 2 };
              })();
        })();
    const arriveCenter = { x: goal.x + bw / 2, y: goal.y + bh / 2 };
    // Room lookups for door-crossing routing: when destOverride is given, the
    // actual destination may be in a different room than the target NPC (the
    // joiner's cluster slot vs. the incumbent's own standing position) — key
    // the room lookups off the real destination in that case. Without an
    // override, keep using the target NPC's position, unchanged.
    const roomLookupPoint = destOverride ? arriveCenter : tc;
    const startRoomId = roomOf(bc)?.id ?? null;
    const goalRoomId = roomOf(roomLookupPoint)?.id ?? null;

    const flatStartRoomId = flatRoomIdAt(bc);
    const flatGoalRoomId = flatRoomIdAt(roomLookupPoint);
    const doorCrossing =
      flatGoalRoomId && flatGoalRoomId !== flatStartRoomId
        ? (() => {
            const dp = doorStandForRoom(flatGoalRoomId);
            return dp ? { pair: dp, roomId: flatGoalRoomId } : null;
          })()
        : null;

    // Camera: when this approach crosses through a door (doorCrossing), start
    // wide on the destination ROOM (so the door + room are visible during
    // the crossing) rather than tight on the target — the final leg below
    // zooms tight-on-target only once bon is actually inside, walking the
    // last stretch to them. No crossing (same room already, or no door
    // pairing painted for it) — unchanged: tight on the target immediately,
    // same as before this camera-staging change existed.
    if (doorCrossing) {
      focusRoomFit(doorCrossing.roomId, 600);
    } else {
      const ref = transformRef.current;
      const wrapper = ref?.instance.wrapperComponent;
      if (ref && wrapper) {
        const rect = wrapper.getBoundingClientRect();
        const focusScale = initialScale * 2.5;
        const { x, y } = computeCenterTransform(target, focusScale, rect.width, rect.height);
        ref.setTransform(x, y, focusScale, 600, "easeOut");
      }
    }
    pipSideRef.current = target.x > bonPos.x ? "left" : "right";

    // Cancel any pending door-open/close timer from a previous approach that
    // hasn't finished yet, and bump the nonce so its in-flight callbacks
    // become no-ops — pat/chat can be re-triggered mid-walk, unlike the
    // onboarding-locked check-in flow.
    cancelPendingDoorWalks();
    const nonce = approachNonceRef.current;

    if (doorCrossing) {
      const doorPair = doorCrossing.pair;
      const outGoal = { x: doorPair.outStand.x - bw / 2, y: doorPair.outStand.y - bh / 2 };
      const inGoal = { x: doorPair.inStand.x - bw / 2, y: doorPair.inStand.y - bh / 2 };
      const pathToOutStand = findPath({ x: bonPos.x, y: bonPos.y }, outGoal, startRoomId, goalRoomId);

      moveSelf({
        path: pathToOutStand,
        roomId: goalRoomId,
        onArrive: () => {
        if (approachNonceRef.current !== nonce) return;
        onDoorOpen(doorCrossing.roomId);
        approachDoorTimerRef.current = window.setTimeout(() => {
          approachDoorTimerRef.current = undefined;
          if (approachNonceRef.current !== nonce) return;
          const pathToInStand = findPath(outGoal, inGoal, goalRoomId, goalRoomId);
          moveSelf({
            path: pathToInStand,
            roomId: goalRoomId,
            onArrive: () => {
            if (approachNonceRef.current !== nonce) return;
            onDoorClose(doorCrossing.roomId);
            // Final leg — inside the room now, walking the last stretch to
            // the actual target. Zoom IN from room-fit to tight-on-target
            // here (animated, not instant) so the camera visibly closes in
            // as bon approaches them.
            {
              const ref = transformRef.current;
              const wrapper = ref?.instance.wrapperComponent;
              if (ref && wrapper) {
                const rect = wrapper.getBoundingClientRect();
                const focusScale = initialScale * 2.5;
                const { x, y } = computeCenterTransform(target, focusScale, rect.width, rect.height);
                ref.setTransform(x, y, focusScale, 600, "easeOut");
              }
            }
            const pathToStandSpot = findPath(inGoal, goal, goalRoomId, goalRoomId);
            // Facing folded into arrival.facing (not a post-arrival face()
            // call) so walk_arrived carries the FINAL facing bon turns to
            // face the target — see moveSelf's arrival.facing doc.
            moveSelf({
              path: pathToStandSpot,
              roomId: goalRoomId,
              arrival: { state: "standing", facing: directionBetween(arriveCenter, tc) },
              onArrive: () => {
              if (approachNonceRef.current !== nonce) return;
              onArrive(arriveCenter, tc);
              },
            });
            },
          });
        }, DOOR_ANIM_MS);
        },
      });
      return;
    }

    // Fallback: same room already, or no complete door stand-point pairing
    // painted for this room yet — existing single-goal walk, unchanged.
    const path = findPath({ x: bonPos.x, y: bonPos.y }, goal, startRoomId, goalRoomId);
    // Facing folded into arrival.facing — see the door-crossing branch's
    // identical note above.
    moveSelf({
      path,
      roomId: goalRoomId,
      arrival: { state: "standing", facing: directionBetween(arriveCenter, tc) },
      onArrive: () => {
        onArrive(arriveCenter, tc);
      },
    });
  }

  // Stage B2: live "pop open at formation" reaction to the backend's
  // conversation_upgraded socket event (already emitted by the approved
  // Stage A, to every affected member's user room, the moment an accepted
  // join_group request upgrades a DM into a brand-new group conversation).
  // Re-subscribes if selfChatId changes (e.g. currentUser resolving after
  // this component's initial mount-before-auth render) so the filter below
  // never runs against a stale fallback id. ALSO re-subscribes on every
  // bonPos change (new, for the joiner-walk wiring below): this callback now
  // needs a genuinely CURRENT bonPos/extraCharacterLayers/etc. to compute a
  // correct walk-start position and cluster anchor for the newly-accepted
  // 3rd-person joiner — with the old deps=[selfChatId]-only subscription,
  // this closure would freeze bonPos at whatever it was on the last
  // selfChatId change (effectively mount), sending the joiner's walk from a
  // stale/wrong tile. Re-registering the listener is just a Set add/delete
  // in RealChatService (see its onConversationUpgraded) — cheap even at
  // walk-animation frequency, not a socket reconnect. Declared here (after
  // approachCharacter/bonPos/walkTo/resolveMemberCenter, rather than up near
  // the other early state-declaration effects) because its dependency array
  // references bonPos, a `const` declared earlier in render order but still
  // textually below where this effect used to live — deps arrays are
  // evaluated immediately, so bonPos's temporal dead zone would otherwise
  // throw on every render.
  useEffect(() => {
    const unsubscribe = chatService.onConversationUpgraded?.((payload) => {
      const self = selfChatId.toLowerCase();
      // Defense in depth — should always be true if the event correctly
      // routed to this user's own room, but don't assume.
      if (!payload.participantIds.some((id) => id.toLowerCase() === self)) return;

      // Incumbent: self already had this exact DM panel open before the
      // upgrade (both original DM participants satisfy this — Ask-to-Join
      // can only be offered against a conversation both DM members already
      // had open). Joiner: the newly-accepted 3rd person, who had no prior
      // panel open for this conversation — gets an arrival-gated walk into
      // the cluster below, on top of the same panel-swap/refetch bookkeeping
      // both roles share.
      const role = classifyUpgrade({ selfEmail: selfChatId, openConversationId: openConversationIdRef.current, payload });

      // The old DM panel (if this user had it open) unmounts via a plain
      // state swap below, not via its own onClose handler — so the
      // spatial-session leave for the OLD conversation id has to be emitted
      // explicitly here, mirroring the same "old id differs from new id"
      // transition JoinRequestPrompt's onResolved handler already does
      // further down. The NEW conversation's spatial_session_start is NOT
      // emitted here — GroupConversationView's own onConversationOpen
      // (wired below) fires that exactly once as soon as its conversationId
      // prop resolves, same as the DM panel does today (incumbent case) —
      // or, for the joiner, is deliberately SKIPPED there and fired instead
      // from onJoinerArrived below, once the walk actually completes.
      if (openConversationIdRef.current === payload.oldConversationId) {
        emitSpatialSessionLeave();
      }

      // Explicitly clear both panel setters rather than relying solely on
      // the openChat/openGroupConv mutual-exclusion render guards — those
      // guards only guarantee correctness when setOpenChat(truthy) also
      // clears openGroupConv (Part 1's fix); setOpenGroupConv(truthy) doesn't
      // symmetrically clear openChat anywhere else in this file, so leaving
      // openChat set here would re-trigger the exact vanish bug Part 1 fixed.
      setOpenChat(null);
      setSpatialChatMinimized(false);
      setOpenGroupConv({
        conversationId: payload.conversationId,
        participantEmails: payload.participantIds,
        title: payload.title,
      });

      // Refresh the badge/list data now, live, rather than only after some
      // unrelated future event triggers a refetch — the newly-formed group
      // should show up in the conversation list immediately.
      void refetchConversations();

      if (role !== "joiner") return;

      // Joiner-only: arrival-gated walk into the new cluster. Uses the same
      // cluster-slot geometry Mechanism 1 (the self-settle effect above)
      // uses, but computed directly off payload.participantIds (the fresh
      // membership straight from the event) rather than waiting for
      // spatialSessions to reflect it. onJoinerArrived — not this function —
      // is what flips status (emitSpatialSessionStart), and it also
      // pre-seeds slotWalkSignatureRef so Mechanism 1 doesn't immediately
      // re-walk the joiner once their own spatial-session update reflects
      // the new membership.
      pendingJoinerConvIdRef.current = payload.conversationId;

      const bw = playerCharacterLayer.width;
      const bh = playerCharacterLayer.height;
      // Anchor off the INCUMBENTS only — excluding the joiner's own
      // far-away starting position keeps the cluster centroid (and the
      // incumbents' "make room" repositioning) from lurching toward
      // wherever the joiner happened to start their walk from. Falls back
      // to all members only in the unlikely case no incumbent position
      // resolves at all.
      const anchor = computeClusterAnchor(
        incumbentCentersForAnchor(payload.participantIds, self, resolveMemberCenter),
      );
      const slots = assignClusterSlots(payload.participantIds, anchor);
      const mySlotCenter = slots[self];
      if (!mySlotCenter) {
        // Should never happen (assignClusterSlots always assigns every
        // member a slot) — defensive bail so a geometry edge case can't
        // leave pendingJoinerConvIdRef permanently stuck.
        pendingJoinerConvIdRef.current = null;
        return;
      }
      const goal = { x: mySlotCenter.x - bw / 2, y: mySlotCenter.y - bh / 2 };

      const onJoinerArrived = () => {
        // Defensive — the panel may have closed (or a newer upgrade fired)
        // mid-walk; don't flip status or clobber a newer pending walk.
        if (pendingJoinerConvIdRef.current !== payload.conversationId) return;
        if (openConversationIdRef.current !== payload.conversationId) {
          // Panel closed or switched mid-walk — clear so a later reopen of
          // this same conversation isn't wrongly treated as still pending
          // (see onClose below and onConversationOpen's guard).
          pendingJoinerConvIdRef.current = null;
          return;
        }
        // Set BEFORE emitting start — prevents Mechanism 1 from immediately
        // re-walking the joiner once their own spatial-session update
        // reflects this same membership.
        slotWalkSignatureRef.current = slotWalkSignature(payload.participantIds);
        emitSpatialSessionStart(payload.conversationId);
        pendingJoinerConvIdRef.current = null;
      };

      const incumbentEmail = payload.participantIds.find((id) => id.toLowerCase() !== self);
      const incumbentLayer = incumbentEmail
        ? (extraCharacterLayers.find((l) => l.id.toLowerCase() === incumbentEmail.toLowerCase()) ??
            npcCharacterLayers.find((l) => l.id.toLowerCase() === incumbentEmail.toLowerCase()) ??
            null)
        : null;

      if (incumbentLayer) {
        // Reuses the existing door-crossing/camera-staging logic for free.
        // destOverride=goal makes approachCharacter walk the ENTIRE distance
        // (including any door-crossing) directly to the joiner's real
        // cluster slot in one coherent path, rather than stopping short at
        // the incumbent and then re-pathing a disjointed second leg.
        approachCharacter(incumbentLayer, () => onJoinerArrived(), goal);
      } else {
        // No resolvable incumbent layer — skip the door-staged approach and
        // walk straight to the cluster slot. This fires synchronously in the
        // same tick as the event, so this render's own bonPos (fresh, since
        // this effect now re-subscribes on every bonPos change) is accurate.
        const startRoomId = roomOf({ x: bonPos.x + bw / 2, y: bonPos.y + bh / 2 })?.id ?? null;
        const goalRoomId = roomOf(mySlotCenter)?.id ?? null;
        const path = findPath({ x: bonPos.x, y: bonPos.y }, goal, startRoomId, goalRoomId);
        moveSelf({ path, roomId: goalRoomId, onArrive: onJoinerArrived });
      }
    });
    return () => unsubscribe?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfChatId, bonPos]);

  // Finds the spatial session (sessionId == Conversation.id) a given layer's lowercased
  // email currently belongs to, if any — used both for the Ask-to-Join gating (canAskToJoin
  // below) and the askToJoin action branch itself.
  function findSpatialSessionForLayer(layerId: string): SpatialSessionEntry | undefined {
    const email = layerId.toLowerCase();
    return spatialSessions.find((s) => s.members.includes(email));
  }

  function handleChoose(
    action: "chat" | "call" | "approach" | "walkDemo" | "patDemo" | "askToJoin" | "viewProfile",
  ) {
    if (!menu) return;
    const target = menu.layer;
    const name = formatCharacterName(target);

    // Abandon any stale gate toast left over from a PREVIOUS DND-gated attempt at a different
    // target — any new character-menu interaction supersedes it, same "new attempt cancels the
    // old one" reasoning as cancelPendingDoorWalks for the room-entry gate.
    if (personGateRef.current && personGateRef.current.targetEmail !== target.id.trim().toLowerCase()) {
      const stale = personGateRef.current;
      if (stale.pendingRequestId) void cancelTalkRequest(stale.pendingRequestId).catch(() => {});
      setPersonGate(null);
    }

    // Person-level DND protection (feature spec section 7): Chat/Approach must not auto-walk or
    // open a spatial conversation with a DND person from outside — gate behind Request
    // Permission to Talk instead. Real employees only (target.id is an email, per the existing
    // "real roster people key their layer id straight off email" convention below); demo/NPC
    // characters (bon/alex/micah/lui ids) are never in dndEmails, so they're never gated. "Call"
    // isn't a real spatial interaction yet (falls into the final else-branch's "coming soon"
    // toast) so it needs no gating here. Room-entry protection (walkToSeat/handleMapRightClick)
    // is a SEPARATE, already-existing gate — this one applies regardless of room/location, per
    // "DND protects the employee, not merely the room."
    if ((action === "approach" || action === "chat") && target.id.includes("@")) {
      const targetEmail = target.id.trim().toLowerCase();
      if (dndEmails.has(targetEmail)) {
        setMenu(null);
        setPersonGate({
          targetEmail,
          targetName: name,
          kind: action,
          pendingRequestId: null,
          resume: () => {
            if (action === "approach") {
              approachCharacter(target, (arriveCenter, targetCenter) => {
                facerFor(target.id)?.(directionBetween(targetCenter, arriveCenter));
              });
            } else {
              approachCharacter(target, () => {
                setOpenGroupConv(null);
                setSpatialChatMinimized(false);
                setOpenChat(target);
              });
            }
          },
        });
        return;
      }
    }

    if (action === "viewProfile") {
      closeCharacterMenu();
      // Real roster people key their layer id straight off email (see rosterLayers.ts's
      // officePeopleToLayers); static manifest NPCs (bon/alex/micah/lui) use a sprite id
      // instead — mockEmailForAvatarId is avatarIdentity.ts's own inverse of that same
      // localpart convention (already used to seed MockOfficeService's roster), reused here
      // rather than inventing a second id->email mapping.
      setProfileEmail(target.id.includes("@") ? target.id : mockEmailForAvatarId(target.id));
      return;
    }
    if (action === "walkDemo") {
      setMenu(null);
      runWalkDemo(target);
      return;
    }
    if (action === "patDemo") {
      setMenu(null);
      runPatDemo(target);
      return;
    }
    if (action === "approach") {
      setMenu(null);
      approachCharacter(target, (arriveCenter, targetCenter) => {
        // Turn the NPC to face bon back after he approaches, if it has its
        // own useCharacterWalk instance (alex/micah/lui) — plain static
        // roster people have no directional capability, so facerFor returns
        // null and this is a no-op for them. Left facing bon rather than
        // reverted on a timer — the next time that NPC's own demo/movement
        // runs it recomputes its own direction from its next segment anyway.
        facerFor(target.id)?.(directionBetween(targetCenter, arriveCenter));
      });
    } else if (action === "chat") {
      // setMenu(null) rather than closeCharacterMenu() — avoid resetting the
      // camera view when opening the chat panel. Spatial clustering
      // (spatial_session_start) is NOT emitted here — per the finalized
      // "chat panel required" decision, it only fires once ConversationView's
      // conv.id actually resolves (see its onConversationOpen prop below).
      // Approach alone (the branch above) must never create a spatial
      // session or a DM conversation.
      setMenu(null);
      approachCharacter(target, () => {
        // Opening a DM panel must always clear any open group panel — the
        // two render guards (openChat && !openGroupConv / openGroupConv &&
        // !openChat) are mutually exclusive by construction, so leaving a
        // stale openGroupConv set here would make BOTH guards false and
        // silently vanish both panels (group's onClose never fires either).
        setOpenGroupConv(null);
        setSpatialChatMinimized(false);
        setOpenChat(target);
      });
    } else if (action === "askToJoin") {
      // Ask-to-join affordance: only shown (canAskToJoin, computed below) when the target is
      // currently in a >=2-member spatial session the viewer isn't already part of. Look up
      // that session by the target's layer id (== lowercased email for roster peers) to get
      // its sessionId (== the target conversation's Conversation.id).
      closeCharacterMenu();
      const session = findSpatialSessionForLayer(target.id);
      if (session && session.members.length >= 2) {
        createJoinRequest(session.sessionId).catch((err) => {
          console.error("[requests] failed to create join request", err);
        });
        setToast(`Asked to join ${name}’s conversation…`);
        setTimeout(() => setToast(null), 1800);
      }
    } else {
      closeCharacterMenu();
      setToast(`Calling ${name}… — coming soon`);
      setTimeout(() => setToast(null), 1800);
    }
  }

  // Zooms out (relative to the current tight-focus multipliers) to frame an
  // entire flat room rect — used mid-walk, right as a character reaches a
  // room's door, so the door slide animation (and the room it opens into)
  // is actually visible instead of staying tight on a character/target the
  // whole time. `flatRoomId` is the flat rects/teamRooms-namespace id (e.g.
  // "design-team") — the same scheme doorStandForRoom/flatRoomIdAt use, NOT
  // the roomLayers/manifest scheme. Mirrors every other focus call's
  // guarded ref/wrapper pattern; degrades to a no-op (returns false) if the
  // room rect or the transform ref/wrapper isn't available.
  function focusRoomFit(flatRoomId: string, durationMs = 500): boolean {
    const roomRect = rooms.find((r) => r.id === flatRoomId);
    if (!roomRect) return false;
    const ref = transformRef.current;
    const wrapper = ref?.instance.wrapperComponent;
    if (!ref || !wrapper) return false;
    const rect = wrapper.getBoundingClientRect();
    const scale = initialScale * ROOM_FIT_MULTIPLIER;
    const { x, y } = computeCenterTransform(roomRect, scale, rect.width, rect.height);
    ref.setTransform(x, y, scale, durationMs, "easeOut");
    return true;
  }

  function focusRoom(layer: AssetLayer, side: "left" | "right") {
    const ref = transformRef.current;
    const wrapper = ref?.instance.wrapperComponent;
    if (!ref || !wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const { x, y, scale } = computeRoomFocusTransform(layer, {
      viewportW: rect.width,
      viewportH: rect.height,
      sidebarW: SIDEBAR_WIDTH,
      minScale,
      maxScale,
      side,
    });
    ref.setTransform(x, y, scale, 500, "easeOut");
  }

  function resetToInitialView(durationMs = 400) {
    const ref = transformRef.current;
    const wrapper = ref?.instance.wrapperComponent;
    if (!ref || !wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const { x, y } = computeCenterTransform(
      { x: 0, y: 0, width: FRAME_WIDTH, height: FRAME_HEIGHT },
      initialScale,
      rect.width,
      rect.height,
    );
    ref.setTransform(x, y, initialScale, durationMs, "easeOut");
  }

  function closeRoomSidebar() {
    resetToInitialView();
    setRoomSidebar(null);
  }

  function closeCharacterMenu() {
    resetToInitialView();
    setMenu(null);
  }

  function handleCharacterClick(layer: AssetLayer, anchor: { clientX: number; clientY: number }) {
    // Onboarding sequence must complete before normal character-click
    // interactions resume — every non-"done" state suppresses this handler.
    // checkoutBusy locks manual interaction while bon is mid-checkout-walk.
    if (onboarding !== "done" || checkoutBusy) return;
    // Closing the room sidebar here is fine even though this handler now
    // drives its own zoom: whichever setTransform call happens last (this
    // one) wins on the shared transformRef, so no double-animation fight.
    setRoomSidebar(null);

    const ref = transformRef.current;
    const wrapper = ref?.instance.wrapperComponent;
    if (!ref || !wrapper) {
      // Fallback: preserve prior behavior — open immediately at raw click point.
      setMenu({ layer, ...anchor });
      return;
    }

    window.clearTimeout(charMenuTimerRef.current);

    const rect = wrapper.getBoundingClientRect();
    const currentScale = ref.instance.state.scale;
    // maxScale is the TransformWrapper's own zoom ceiling, so currentScale
    // can never exceed it — targetScale is simply maxScale.
    const targetScale = maxScale;

    if (targetScale > currentScale) {
      const { x, y } = computeCenterTransform(layer, targetScale, rect.width, rect.height);
      const screenX = rect.left + x + (layer.x + layer.width / 2) * targetScale;
      const screenY = rect.top + y + (layer.y + layer.height / 2) * targetScale;
      ref.setTransform(x, y, targetScale, 500, "easeOut");
      charMenuTimerRef.current = window.setTimeout(() => {
        setMenu({ layer, clientX: screenX, clientY: screenY });
      }, 500);
    } else {
      const { positionX, positionY } = ref.instance.state;
      const screenX = rect.left + positionX + (layer.x + layer.width / 2) * currentScale;
      const screenY = rect.top + positionY + (layer.y + layer.height / 2) * currentScale;
      setMenu({ layer, clientX: screenX, clientY: screenY });
    }
  }

  // Opens the "Sit here" confirm menu for a clicked empty-seat marker — same
  // suppression guard as handleCharacterClick/onRoomClick (onboarding must be
  // "done", not mid-checkout-walk).
  function handleSeatClick(seat: SeatTarget, anchor: { clientX: number; clientY: number }) {
    if (onboarding !== "done" || checkoutBusy) return;
    setRoomSidebar(null);
    setSeatMenu({ seat, ...anchor });
  }

  // Dota-style right-click-to-move: classifies the clicked world point as a
  // walkable+reachable tile or not (classifyDestination — no goal-snapping,
  // see its doc comment), then — if that tile is inside a DIFFERENT flat
  // room than bon currently stands in — gates entry through that room's
  // door using the exact same stand-point-pair choreography walkToSeat uses
  // (outStand -> onDoorOpen -> wait DOOR_ANIM_MS -> inStand -> onDoorClose
  // -> final goal), so the avatar can never walk straight through a closed
  // door/wall to a destination inside a room. A target room with no painted
  // door stand-point pair is treated as not enterable via right-click (red
  // ring, no movement) — unlike walkToSeat/approachCharacter's direct-walk
  // fallback for that case, which is safe there because their targets are
  // always a deliberately-chosen seat/character, never an arbitrary click.
  // Same suppression guard as handleCharacterClick/handleSeatClick/onRoomClick.
  function handleMapRightClick(point: Pt) {
    if (onboarding !== "done" || checkoutBusy) return;
    const start = { x: bonPos.x, y: bonPos.y };
    const { valid, cellCenter } = classifyDestination(start, point);

    const bw = playerCharacterLayer.width;
    const bh = playerCharacterLayer.height;
    const startCenter = { x: bonPos.x + bw / 2, y: bonPos.y + bh / 2 };
    const goalCenter = { x: cellCenter.x + bw / 2, y: cellCenter.y + bh / 2 };
    const flatStartRoomId = flatRoomIdAt(startCenter);
    const flatGoalRoomId = flatRoomIdAt(goalCenter);
    const enteringNewRoom = flatGoalRoomId !== null && flatGoalRoomId !== flatStartRoomId;
    const doorPair = enteringNewRoom ? doorStandForRoom(flatGoalRoomId!) : null;
    // Validity is decided ENTIRELY by classifyDestination's grid-based
    // walkability+floodfill reachability check (`valid`) — the same source
    // of truth findPath's A* itself walks against. doorPair only selects
    // HOW to route there (door choreography vs. a direct findPath leg); its
    // absence means "this room's door has no painted stand-point pair yet",
    // per doorStandForRoom's own contract, NOT "this room is unreachable".
    // Gating validity on doorPair (the prior version of this fix) wrongly
    // red-ringed every reachable room without a hand-painted pair (Reception,
    // Meeting, Project, etc.) even though findPath could walk there directly.
    const isValid = valid;

    window.clearTimeout(destinationRingTimerRef.current);
    destinationRingKeyRef.current += 1;
    setDestinationRing({ ...cellCenter, valid: isValid, key: destinationRingKeyRef.current });
    destinationRingTimerRef.current = window.setTimeout(() => setDestinationRing(null), 500);

    if (!isValid) return;

    const startRoomId = roomOf(startCenter)?.id ?? null;
    const goalRoomId = roomOf(goalCenter)?.id ?? null;

    cancelPendingDoorWalks();
    const nonce = mapRightClickDoorNonceRef.current;

    if (doorPair) {
      const outGoal = { x: doorPair.outStand.x - bw / 2, y: doorPair.outStand.y - bh / 2 };
      const inGoal = { x: doorPair.inStand.x - bw / 2, y: doorPair.inStand.y - bh / 2 };
      const pathToOutStand = findPath(start, outGoal, startRoomId, goalRoomId);
      moveSelf({
        path: pathToOutStand,
        roomId: goalRoomId,
        onArrive: () => {
        if (mapRightClickDoorNonceRef.current !== nonce) return;

        function proceedThroughDoor() {
          onDoorOpen(flatGoalRoomId!);
          mapRightClickDoorTimerRef.current = window.setTimeout(() => {
            mapRightClickDoorTimerRef.current = undefined;
            if (mapRightClickDoorNonceRef.current !== nonce) return;
            const pathToInStand = findPath(outGoal, inGoal, goalRoomId, goalRoomId);
            moveSelf({
              path: pathToInStand,
              roomId: goalRoomId,
              onArrive: () => {
              if (mapRightClickDoorNonceRef.current !== nonce) return;
              onDoorClose(flatGoalRoomId!);
              const pathToGoal = findPath(inGoal, cellCenter, goalRoomId, goalRoomId);
              moveSelf({ path: pathToGoal, roomId: goalRoomId });
              },
            });
          }, DOOR_ANIM_MS);
        }

        // DND-room-lock gate — same reasoning as walkToSeat's: right-clicking a tile inside a
        // locked room must never ghost through the door (feature spec section 8). The avatar
        // has already arrived at the door's outside stand point; stop there instead of
        // continuing, and surface the Knock/Request-Entry toast.
        if (isRoomLocked(flatGoalRoomId, roomPresenceEntries, dndEmails)) {
          setRoomEntryGate({
            roomId: flatGoalRoomId!,
            roomName: roomNameFor(flatGoalRoomId!),
            resume: proceedThroughDoor,
            pendingRequestId: null,
          });
          return;
        }

        proceedThroughDoor();
        },
      });
      return;
    }

    // Same room already, or destination isn't inside any flat room (open
    // floor/corridor) — existing single-goal walk, unchanged.
    const path = findPath(start, cellCenter, startRoomId, goalRoomId);
    moveSelf({ path, roomId: goalRoomId });
  }

  // Every seat centroid currently occupied — by a live roster person seated
  // on a real painted chair (rosterLayers entries with sitDirection set, see
  // rosterLayers.ts), or by the viewer's own current seat (currentSeatKey,
  // set by sitAtSeat above). Feeds computeEmptySeats below so occupied seats
  // never get a click-to-sit marker (silent, no dimmed/tooltipped state —
  // see the feature's design decision).
  const occupiedCentroidKeys = useMemo(() => {
    const keys = new Set<string>();
    const syncedByEmail = new Map(peerMovements.map((p) => [p.email, p]));
    for (const layer of rosterLayers) {
      if (!layer.sitDirection) continue;
      // A peer with a live movementSync entry has their occupancy decided
      // by that entry (below), not by the roster's static sitDirection —
      // which goes stale the instant a self-movement-funnel walk stands
      // them up (they keep their Atlas-roster seated portrait/position
      // until the NEXT roster/SSE refresh, but their actual live state is
      // "standing" and their seat must free up immediately).
      if (syncedByEmail.has(layer.id.toLowerCase())) continue;
      keys.add(seatCentroidKey(layer.x + layer.width / 2, layer.y + layer.height / 2));
    }
    // Synced peers occupy a seat exactly when their movementSync stable
    // state says "sitting" (and isn't mid-walk to somewhere else) — seatKey
    // is already the same seatCentroidKey(...) value rosterLayers' own
    // occupancy keys use (both resolve to the seat's centroid), computed
    // once at the sitting arrival's moveSelf call site.
    for (const p of peerMovements) {
      if (!p.active && p.stable.state === "sitting" && p.stable.seatKey) keys.add(p.stable.seatKey);
    }
    if (isSitting && currentSeatKey) keys.add(currentSeatKey);
    return keys;
  }, [rosterLayers, isSitting, currentSeatKey, peerMovements]);

  // Back-sit occlusion fix (manifest rooms only — see furnitureId's doc
  // comment in types/office.ts): furnitureId -> that seat's back-facing
  // occupant's own baseline, for every currently back-sit occupant (roster
  // people via rosterLayers, plus the live player via isSitting/sitDirection/
  // currentSeatFurnitureId/bonPos). Passed to the MAIN OfficeStage instance
  // only — the PiP mini-camera instance below only renders while the viewer
  // is actively walking (isWalking), and walkTo always clears isSitting, so
  // the viewer himself can never be back-sitting while PiP is visible; a
  // roster NPC could still be, but PiP is a small transient preview during
  // the viewer's own walk, not a scene players study, so this fidelity is
  // skipped there rather than threading the prop through a second time.
  const backSitOccupantBaselines = useMemo(
    () =>
      computeBackSitOccupantBaselines(rosterLayers, {
        isSitting,
        sitDirection,
        furnitureId: currentSeatFurnitureId,
        baseline: bonPos.y + playerCharacterLayer.height,
      }),
    [rosterLayers, isSitting, sitDirection, currentSeatFurnitureId, bonPos, playerCharacterLayer.height],
  );

  // Suppresses seat markers entirely under the same conditions the rest of
  // this file already suppresses room/character-click interactions
  // (onboarding not done, mid-checkout-walk), plus checked-out/not-checked-in
  // — clicking a seat to sit down makes no sense before the viewer has
  // checked in, or after they've checked out for the day.
  const seatInteractionsSuppressed =
    onboarding !== "done" ||
    checkoutBusy ||
    checkoutFlow.state === "CHECKED_OUT" ||
    !hasCheckedIn;

  const emptySeats = useMemo(
    () => (seatInteractionsSuppressed ? [] : computeEmptySeats(occupiedCentroidKeys)),
    [seatInteractionsSuppressed, occupiedCentroidKeys],
  );

  // Recomputed on every render (e.g. while the viewer walks with the
  // sidebar open) so the roster reflects the viewer's live position, not a
  // stale snapshot.
  const viewerCenter = {
    x: bonPos.x + playerCharacterLayer.width / 2,
    y: bonPos.y + playerCharacterLayer.height / 2,
  };
  const viewerRoom = roomContainingPoint(viewerCenter);
  const viewerIsHere = roomSidebar !== null && viewerRoom?.id === roomSidebar.layer.id;
  // Saved avatars (extraCharacterLayers) aren't part of the static
  // roomMembersById map — that's derived once from the Figma-manifest NPC
  // roster and has no awareness of dynamically-saved employees. Match each
  // saved avatar into the currently-open room by its actual on-map position
  // (same geometry roomMembersById itself is built from), rather than by
  // roomId string equality — SavedAvatar.roomId uses the legacy
  // `rooms`/teamRooms naming (e.g. "dev-team"), which differs from the
  // manifest room ids used here (e.g. "dev-room"), so geometry is the only
  // stable link between the two id schemes.
  const savedAvatarsInRoom = roomSidebar
    ? charactersInRoom(roomSidebar.layer.id, extraCharacterLayers)
    : [];
  const roomSidebarMembers = roomSidebar
    ? [
        ...roomMembersById[roomSidebar.layer.id],
        ...savedAvatarsInRoom,
        ...(viewerIsHere ? [playerCharacterLayer] : []),
      ]
    : [];
  // Real roster people are keyed by the flat rooms/teamRooms namespace
  // (e.g. "dev-team"), not the manifest room id the sidebar was opened
  // with (e.g. "dev-room") — same id-scheme split flatRoomIdAt/
  // savedAvatarsInRoom above bridge via geometry. Resolve the flat id
  // once here from the room layer's center so the filter below compares
  // like-for-like instead of silently matching nothing for the "-team"
  // rooms whose flat/manifest ids don't happen to coincide.
  const roomSidebarFlatId = roomSidebar
    ? flatRoomIdAt({
        x: roomSidebar.layer.x + roomSidebar.layer.width / 2,
        y: roomSidebar.layer.y + roomSidebar.layer.height / 2,
      })
    : null;

  return (
    <div className={`${styles.viewport} ${isDragging ? styles.dragging : ""}`}>
      <TransformWrapper
        ref={transformRef}
        initialScale={initialScale}
        minScale={minScale}
        maxScale={maxScale}
        centerOnInit
        limitToBounds
        wheel={{ step: 0.1 }}
        pinch={{ step: 5 }}
        doubleClick={{ disabled: true }}
        // react-zoom-pan-pinch defaults allowRightClickPan to true, so a right-button drag both
        // pans the map AND drives the right-click-to-move pathfinding below — right mouse input
        // must be exclusive to movement. Left-click panning (the default) is untouched.
        panning={{ allowRightClickPan: false }}
        onPanningStart={() => {
          setIsDragging(true);
          setMenu(null);
          window.clearTimeout(greetTimerRef.current);
          window.clearTimeout(charMenuTimerRef.current);
          setGreeting(null);
        }}
        onPanningStop={() => setIsDragging(false)}
      >
        <TransformComponent
          wrapperStyle={{ width: "100%", height: "100%" }}
        >
          <OfficeStage
            phase={phase}
            characterOverrides={{
              alex: alexPos,
              micah: micahPos,
              lui: luiPos,
              ...savedAvatarOverridePos,
              // Peer keys are lowercased emails and don't collide with named
              // characters or self. Self ALWAYS applied last — a peer
              // broadcast must never move the local player's own rendered
              // position.
              ...peerWalkOverridePos,
              // Player's own override comes last, so it wins any key
              // collision with the alex/micah/lui demo entries above when
              // the viewer IS one of them.
              [playerLayerId]: bonPos,
            }}
            characterSrcOverrides={{
              alex: alexSpriteSrc,
              micah: micahSpriteSrc,
              lui: luiSpriteSrc,
              ...savedAvatarOverrideSrc,
              ...peerWalkOverrideSrc,
              [playerLayerId]: playerSpriteSrc,
            }}
            characterDirectionsById={{
              alex: alexDirection,
              micah: micahDirection,
              lui: luiDirection,
              ...peerDirectionsById,
              [playerLayerId]: isSitting ? sitDirection : direction,
            }}
            characterIsWalkingById={{
              alex: alexIsWalking,
              micah: micahIsWalking,
              lui: luiIsWalking,
              ...peerIsWalkingById,
              [playerLayerId]: isWalking,
            }}
            // Phase A live-3D animation state: viewer's own seated state
            // (isSitting/sitDirection above) plus every synced peer's
            // reported isSitting/direction/isWalking — so a live-3D-eligible
            // peer (e.g. jerevon@offshorly.com's "bon" character) never
            // defaults to "always walking in place" (see OfficeStage.tsx's
            // characterIsWalkingById fallback fix).
            characterIsSittingById={{ ...peerIsSittingById, [playerLayerId]: isSitting }}
            // playerLayerId is the existing "which sprite is you" identity
            // (see useCurrentUserAvatarId above) — reused here to drive
            // OfficeStage's live-3D self-vs-crowd gating, not a separate
            // concept.
            selfCharacterId={playerLayerId}
            showStatusLabels
            statusByLayerId={statusByLayerId}
            selfStatus={selfOfficeStatus}
            extraCharacterLayers={extraCharacterLayers}
            extraCharacterSrcById={extraCharacterSrcById}
            onCharacterClick={handleCharacterClick}
            onMapRightClick={handleMapRightClick}
            destinationRing={destinationRing}
            showToucan
            hiddenCharacterIds={hiddenCharacterIds}
            onRoomClick={(layer, anchor) => {
              // Onboarding sequence must complete before normal room-click
              // interactions resume — every non-"done" state suppresses this.
              if (onboarding !== "done" || checkoutBusy) return;
              setMenu(null);
              // Reception is the sole entry point for check-in/check-out —
              // intercept its click to open the reception action menu
              // instead of the normal room sidebar. If neither action is
              // currently relevant (e.g. mid-reminder, mid-confirmation),
              // fall through to the normal sidebar rather than popping an
              // empty menu.
              if (layer.id === "reception-room") {
                const canCheckIn = !hasCheckedIn && checkoutFlow.state === "IDLE";
                const canCheckOut =
                  hasCheckedIn &&
                  checkoutFlow.state === "IDLE" &&
                  (import.meta.env.DEV || isRealZohoMode());
                if (canCheckIn || canCheckOut) {
                  setReceptionMenu(anchor);
                  return;
                }
              }
              const side = layer.x + layer.width / 2 > FRAME_WIDTH / 2 ? "left" : "right";
              focusRoom(layer, side);
              setRoomSidebar({ layer, side });
            }}
            greetingCharacterId={greeting?.characterId ?? null}
            greetingNonce={greeting?.nonce}
            greetingText={greeting?.text}
            talkingCharacterIds={talkingCharacterIdsFromSessions}
            talkingTextById={talkingTextByLayerId}
            typingCharacterIds={typingCharacterIds}
            globalChatActiveCharacterIds={globalChatActiveCharacterIds}
            spatialTypingCharacterIds={spatialTypingCharacterIds}
            openDoorLayerIds={openDoorLayerIds}
            emptySeats={emptySeats}
            onSeatClick={handleSeatClick}
            backSitOccupantBaselines={backSitOccupantBaselines}
          />
        </TransformComponent>
      </TransformWrapper>
      {isWalking && (
        <div
          className={styles.pip}
          style={pipSideRef.current === "left" ? { left: 16, bottom: 16 } : { right: 16, bottom: 16 }}
        >
          <div
            className={styles.pipInner}
            style={{ transform: `translate(${pipTransform.x}px, ${pipTransform.y}px) scale(${pipScale})` }}
          >
            <ErrorBoundary>
              {/* PiP mini-camera preview intentionally omits greetingCharacterId,
                  talkingCharacterIds, talkingTextById, and showStatusLabels (status
                  labels default to unset/false): this OfficeStage renders outside
                  the main <TransformWrapper>, so its KeepScale-based chat/greeting/
                  status bubbles would mount with a null pan/zoom context and crash
                  (react-zoom-pan-pinch's KeepScale has no null guard). The PiP is
                  just a walking-preview thumbnail — it doesn't need bubbles. */}
              <OfficeStage
                phase={phase}
                characterOverrides={{
                  alex: alexPos,
                  micah: micahPos,
                  lui: luiPos,
                  ...savedAvatarOverridePos,
                  [playerLayerId]: bonPos,
                }}
                characterSrcOverrides={{
                  alex: alexSpriteSrc,
                  micah: micahSpriteSrc,
                  lui: luiSpriteSrc,
                  ...savedAvatarOverrideSrc,
                  [playerLayerId]: playerSpriteSrc,
                }}
                characterDirectionsById={{
                  alex: alexDirection,
                  micah: micahDirection,
                  lui: luiDirection,
                  [playerLayerId]: isSitting ? sitDirection : direction,
                }}
                characterIsWalkingById={{
                  alex: alexIsWalking,
                  micah: micahIsWalking,
                  lui: luiIsWalking,
                  [playerLayerId]: isWalking,
                }}
                selfCharacterId={playerLayerId}
                extraCharacterLayers={extraCharacterLayers}
                extraCharacterSrcById={extraCharacterSrcById}
                hiddenCharacterIds={hiddenCharacterIds}
                globalChatActiveCharacterIds={globalChatActiveCharacterIds}
            spatialTypingCharacterIds={spatialTypingCharacterIds}
                openDoorLayerIds={openDoorLayerIds}
              />
            </ErrorBoundary>
          </div>
        </div>
      )}
      {checkoutBusy && checkoutFlow.state === "WALKING_TO_RECEPTION" && (
        <div className={checkoutStyles.walkIndicator}>
          <span>Checking out… Heading to Reception</span>
          <button className={checkoutStyles.walkIndicatorCancel} onClick={handleCancelCheckoutWalk}>
            Cancel
          </button>
        </div>
      )}
      {/* Dev-only until time-logging reaches Zoho for real (D3 — see
          docs/OFFICE_TIMELOG_IMPLEMENTATION.md in the Atlas repo).

          The whole flow runs on MockZohoService: the project/task pickers
          are hardcoded constants, and submitTimeLogs waits a fake delay and
          returns success with a deterministic id. So in production an
          employee logs their day, gets a success card with a submission id,
          and is marked checked out in localStorage — while no time entry
          exists in Zoho Projects. It fails by succeeding, which is why this
          is hidden rather than left to look broken.

          The entry points (status chip, 8h reminder) are inside the guard,
          so the flow cannot be started at all.

          UPDATE: now gated on isRealZohoMode() as well, so the flow appears
          in production the moment VITE_ZOHO_INTEGRATION_MODE=real is set
          and disappears again if it is ever unset. Tying visibility to
          whether submissions actually reach Zoho — rather than to a
          hand-maintained DEV flag — is what stops this from silently
          regressing to "logs into the void" on a future deploy. DEV stays
          in the condition so mock-mode development still exercises the UI. */}
      <StatusPicker checkedIn={hasCheckedIn && checkoutFlow.state !== "CHECKED_OUT"} />
      {hasCheckedIn && onboarding === "done" && !checkoutBusy && (
        <button
          className={styles.hubButton}
          onClick={() => openCompanyHub("manual")}
          aria-label="Open Company Hub"
        >
          🏠 Hub
        </button>
      )}
      {hasCheckedIn && onboarding === "done" && !checkoutBusy && currentUser?.email && (
        <button
          className={styles.profileButton}
          onClick={() => setProfileEmail(currentUser.email)}
          aria-label="Open my profile"
        >
          👤 Profile
        </button>
      )}
      {import.meta.env.DEV && (
        <button
          className={styles.hubDevResetButton}
          onClick={() => {
            resetDevHubState()
              .then(({ resetCount }) => {
                setToast(`Reset ${resetCount} dev Hub item state(s) — check in again to re-demo.`);
              })
              .catch((err) => {
                setToast(err instanceof Error ? err.message : "Failed to reset dev Hub state.");
              })
              .finally(() => {
                window.setTimeout(() => setToast(null), 2500);
              });
          }}
          aria-label="Reset Hub demo state"
        >
          ♻️ Reset Hub Demo State
        </button>
      )}
      {companyHub.isOpen && <CompanyHub />}
      {profileEmail && (
        <EmployeeProfile
          email={profileEmail}
          viewerEmail={currentUser?.email ?? getCurrentUserId()}
          roster={roster.people}
          onClose={() => setProfileEmail(null)}
        />
      )}
      {(import.meta.env.DEV || isRealZohoMode()) && (
        <>
          <WorkingStatusIndicator state={checkoutFlow.state} workedLabel={checkoutFlow.workedLabel} />
      <CheckoutReminderToast
        visible={checkoutFlow.reminderVisible}
        onLater={checkoutFlow.dismissReminderForLater}
        onStartCheckout={checkoutFlow.startCheckout}
      />
      <CheckoutConfirmModal
        visible={checkoutFlow.state === "CHECKOUT_CONFIRMATION"}
        onNotYet={checkoutFlow.cancelConfirmation}
        onStartCheckout={handleConfirmStartCheckout}
      />
      {onboarding === "done" && !checkoutBusy && <StatusOvertimePrompt />}
      {(checkoutFlow.state === "AT_RECEPTION" ||
        checkoutFlow.state === "EDITING_TIME_LOG" ||
        checkoutFlow.state === "REVIEWING") && (
        <div className={checkoutStyles.backdrop}>
          <div className={checkoutStyles.panel}>
            <TimeSummaryPanel
              timeInMs={timeInMs}
              breakMinutes={checkoutFlow.breakMinutes}
              workedLabel={checkoutFlow.workedLabel}
              frozenCheckoutAtMs={frozenCheckoutAtMs}
            />
            {checkoutFlow.state === "AT_RECEPTION" && (
              <div className={checkoutStyles.actions}>
                <button className={checkoutStyles.primary} onClick={checkoutFlow.continueToTimeLog}>
                  Log today's work
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {checkoutFlow.state === "EDITING_TIME_LOG" && (
        <div className={checkoutStyles.backdrop}>
          <TimeLogForm
            entries={checkoutFlow.entries}
            projects={checkoutFlow.projects}
            tasks={checkoutFlow.tasks}
            allocation={checkoutFlow.allocation}
            workedLabel={checkoutFlow.workedLabel}
            error={checkoutFlow.error}
            onUpdateEntry={checkoutFlow.updateEntry}
            onAddEntry={checkoutFlow.addEntry}
            onRemoveEntry={checkoutFlow.removeEntry}
            onContinue={checkoutFlow.goToReview}
          />
        </div>
      )}
      {checkoutFlow.state === "REVIEWING" && (
        <div className={checkoutStyles.backdrop}>
          <TimeLogReview
            entries={checkoutFlow.entries}
            allocation={checkoutFlow.allocation}
            workedLabel={checkoutFlow.workedLabel}
            onBack={checkoutFlow.backToEditing}
            onSubmit={() => void checkoutFlow.submit()}
          />
        </div>
      )}
      <SubmissionFailedPanel
        visible={checkoutFlow.state === "SUBMISSION_FAILED"}
        error={checkoutFlow.error}
        result={checkoutFlow.submissionResult}
        onTryAgain={() => void checkoutFlow.retrySubmit()}
        onSaveAndReturnLater={checkoutFlow.saveAndReturnLater}
      />
          <CheckoutSuccessCard
            state={checkoutFlow.state}
            workedLabel={checkoutFlow.workedLabel}
            entries={checkoutFlow.entries}
            submissionResult={checkoutFlow.submissionResult}
          />
        </>
      )}
      {import.meta.env.DEV && (
        <OfficePhaseDebugControl
          phase={phase}
          hourDecimal={hourDecimal}
          overrideHour={overrideHour}
          setOverrideHour={setOverrideHour}
        />
      )}
      {/* DEV only. The ?checkoutDebug=true escape hatch was removed
          deliberately: this panel holds direct handles to startCheckout,
          confirmStartCheckout and submit, so in production it was a
          one-query-param route straight into the mock submission path —
          bypassing the guard on the checkout UI above and writing a
          "logged" day that never reaches Zoho. Restore the query-param
          gate only once time-logging is real (D3). */}
      {import.meta.env.DEV && (
        <CheckoutDebugPanel
          state={checkoutFlow.state}
          overrideHour={overrideHour}
          debugHoursWorked={debugHoursWorked}
          setDebugHoursWorked={handleSetDebugHoursWorked}
          startCheckout={checkoutFlow.startCheckout}
          confirmStartCheckout={handleConfirmStartCheckout}
          submit={checkoutFlow.submit}
          retrySubmit={checkoutFlow.retrySubmit}
          resetToday={checkoutFlow.resetToday}
        />
      )}
      <CharacterSearch
        transformRef={transformRef}
        targetScale={maxScale}
        onLocate={(layer) => {
          // Onboarding sequence must complete before normal search-locate
          // interactions resume — every non-"done" state suppresses this.
          if (onboarding !== "done" || checkoutBusy) return;
          setRoomSidebar(null);
          setMenu(null);
          window.clearTimeout(greetTimerRef.current);
          greetNonceRef.current += 1;
          setGreeting({ characterId: layer.id, nonce: greetNonceRef.current });
          greetTimerRef.current = window.setTimeout(() => setGreeting(null), 3000);
        }}
      />
      {menu && (
        <CharacterActionMenu
          layer={menu.layer}
          anchor={menu}
          onChoose={handleChoose}
          onClose={closeCharacterMenu}
          showDemos={
            menu.layer.id === "alex" ||
            menu.layer.id === "micah" ||
            menu.layer.id === "lui" ||
            Boolean(menu.layer.animatable)
          }
          canAskToJoin={(() => {
            const session = findSpatialSessionForLayer(menu.layer.id);
            return (
              !!session &&
              session.members.length >= 2 &&
              !session.members.includes(selfChatId)
            );
          })()}
        />
      )}
      {seatMenu && (
        <SeatActionMenu
          anchor={seatMenu}
          onClose={() => setSeatMenu(null)}
          onConfirm={() => {
            const seat = seatMenu.seat;
            setSeatMenu(null);
            walkToSeat(seat);
          }}
        />
      )}
      {avatarsWithSpriteSet.map((avatar) => {
        const layerId = `saved-avatar-${avatar.avatarId}`;
        const layer = extraCharacterLayers.find((l) => l.id === layerId);
        if (!layer || !avatar.spriteSet) return null;
        return (
          <SavedAvatarWalker
            key={avatar.avatarId}
            layerId={layerId}
            initial={{ x: layer.x, y: layer.y }}
            spriteSet={avatar.spriteSet}
            onUpdate={handleSavedAvatarUpdate}
            registerApi={registerSavedAvatarApi}
          />
        );
      })}
      {peerMovements
        .filter(
          (p: PeerMovementState) => renderablePeerEmailSet.has(p.email),
          // (self-exclusion is defense-in-depth; server already excludes the
          // sender via skip_sid) — see resolveRenderablePeerEmails' doc
          // comment for the full self/roster/offline gate.
        )
        .map((p: PeerMovementState) => {
          const spriteSet = SPRITE_SET_BY_AVATAR_ID[EMAIL_TO_AVATAR_ID[p.email] ?? ""] ?? null;
          return (
            <PeerWalker
              key={p.email}
              layerId={p.email}
              state={p}
              spriteSet={spriteSet}
              onUpdate={handlePeerWalkUpdate}
            />
          );
        })}
      <RoomSidebar
        open={roomSidebar !== null}
        layer={roomSidebar?.layer ?? null}
        side={roomSidebar?.side ?? "right"}
        members={roomSidebarMembers}
        // Real occupants take over the list once the roster is live —
        // otherwise the sidebar would name the fictional cast the canvas
        // has just stopped drawing. Undefined (not []) when there is no
        // roster, so the manifest fallback still applies.
        people={
          rosterActive && roomSidebar
            ? roster.people.filter(
                (person) => roomSidebarFlatId !== null && person.roomId === roomSidebarFlatId,
              )
            : undefined
        }
        roomNames={roster.roomNames}
        onClose={closeRoomSidebar}
      />
      {/* Messenger-style floating chat stack: the spatial window (openChat/openGroupConv, if
          any) plus every remote (Global Chat) window, each in its own fixed-position slot
          stacked right-to-left along the bottom edge. floatingChatRightOffsets keys by
          "__spatial__" for the spatial slot and by the window's own key for remote ones. */}
      {openChat && !openGroupConv && (
        <div
          className={styles.floatingChatSlot}
          style={{ right: floatingChatRightOffsets.get(SPATIAL_WINDOW_KEY) ?? FLOATING_CHAT_EDGE_MARGIN }}
        >
          <ConversationView
            peer={openChat}
            selfId={selfChatId}
            peerChatId={resolvePeerChatId(openChat)}
            selfAvatarUrl={playerSpriteSrc}
            onIncomingMessage={handleTalkingMessage}
            onTypingChange={setSelfTyping}
            isSpatial
            minimized={spatialChatMinimized}
            onMinimizeToggle={() => setSpatialChatMinimized((v) => !v)}
            onConversationOpen={(conversationId) => {
              // Edge-triggered: fires exactly once, the moment the chat panel's conversation id
              // first resolves — never on a poll. Chat-panel-required per the finalized
              // decision: this is the ONLY place spatial_session_start is emitted. This slot
              // (openChat) is exclusively the spatial "Character -> Chat" window — Global Chat
              // (remote) conversations render through the separate remoteChatWindows stack below
              // and never touch spatial-session bookkeeping at all.
              setOpenConversationId(conversationId);
              emitSpatialSessionStart(conversationId);
            }}
            onClose={() => {
              setOpenChat(null);
              if (openConversationId) emitSpatialSessionLeave();
              setOpenConversationId(null);
              setSpatialChatMinimized(false);
              setSelfTyping(false);
              for (const timerId of Object.values(talkingTimersRef.current)) {
                window.clearTimeout(timerId);
              }
              talkingTimersRef.current = {};
              setTalkingTextById({});
            }}
          />
        </div>
      )}
      {openGroupConv && !openChat && (
        <div
          className={styles.floatingChatSlot}
          style={{ right: floatingChatRightOffsets.get(SPATIAL_WINDOW_KEY) ?? FLOATING_CHAT_EDGE_MARGIN }}
        >
          <GroupConversationView
            conversationId={openGroupConv.conversationId}
            selfId={selfChatId}
            participantEmails={openGroupConv.participantEmails}
            title={openGroupConv.title}
            resolveDisplayName={resolveDisplayName}
            selfAvatarUrl={playerSpriteSrc}
            onIncomingMessage={handleTalkingMessage}
            onTypingChange={setSelfTyping}
            isSpatial
            minimized={spatialChatMinimized}
            onMinimizeToggle={() => setSpatialChatMinimized((v) => !v)}
            onConversationOpen={(conversationId) => {
              // Same spatial-session bookkeeping the DM panel above uses — a
              // reopened group is a legitimate spatial-conversation
              // participant while its panel is open. EXCEPT: when this
              // conversationId is a pending arrival-gated joiner walk (see the
              // conversation_upgraded handler's Mechanism 2 above),
              // spatial_session_start must NOT fire yet — the joiner isn't "In
              // Conversation" until their walk into the cluster actually
              // completes; onJoinerArrived emits it once that happens. Every
              // other case (reopening an existing group, an incumbent's panel
              // swap) still emits immediately, as it does today. This slot
              // (openGroupConv) is exclusively spatial — Global Chat groups
              // render through the separate remoteChatWindows stack below.
              setOpenConversationId(conversationId);
              if (pendingJoinerConvIdRef.current !== conversationId) {
                emitSpatialSessionStart(conversationId);
              }
            }}
            onClose={() => {
              if (pendingJoinerConvIdRef.current === openGroupConv?.conversationId) {
                // Panel closed while the arrival-gated joiner walk was still
                // in progress — clear so a later reopen of this same
                // conversation isn't wrongly skipped by onConversationOpen's
                // pending-joiner guard above.
                pendingJoinerConvIdRef.current = null;
              }
              setOpenGroupConv(null);
              if (openConversationId) emitSpatialSessionLeave();
              setOpenConversationId(null);
              setSpatialChatMinimized(false);
              setSelfTyping(false);
              for (const timerId of Object.values(talkingTimersRef.current)) {
                window.clearTimeout(timerId);
              }
              talkingTimersRef.current = {};
              setTalkingTextById({});
            }}
          />
        </div>
      )}
      {remoteChatWindows.map((w) => (
        <div
          key={w.key}
          className={styles.floatingChatSlot}
          style={{ right: floatingChatRightOffsets.get(w.key) ?? FLOATING_CHAT_EDGE_MARGIN }}
        >
          {w.kind === "dm" ? (
            <ConversationView
              peer={w.layer}
              selfId={selfChatId}
              peerChatId={resolvePeerChatId(w.layer)}
              selfAvatarUrl={playerSpriteSrc}
              minimized={w.minimized}
              // Global Chat DND indicator (feature spec section 11): messaging itself is never
              // blocked — this is a subtitle-only cue that the recipient is DND and may not
              // respond immediately. Same dndEmails source of truth the room-lock/person-level
              // gates use; w.layer.id is the peer's email per this file's existing "real roster
              // people key their layer id straight off email" convention.
              subtitle={dndEmails.has(w.layer.id.toLowerCase()) ? "🔴 DND · Notifications muted" : undefined}
              onMinimizeToggle={() => toggleRemoteWindowMinimize(w.key)}
              onClose={() => closeRemoteWindow(w.key)}
            />
          ) : (
            <GroupConversationView
              conversationId={w.conversationId}
              selfId={selfChatId}
              participantEmails={w.participantEmails}
              title={w.title}
              resolveDisplayName={resolveDisplayName}
              selfAvatarUrl={playerSpriteSrc}
              minimized={w.minimized}
              onMinimizeToggle={() => toggleRemoteWindowMinimize(w.key)}
              onClose={() => closeRemoteWindow(w.key)}
            />
          )}
        </div>
      ))}
      {chatMode === "real" && (
        <MessageNotificationBadge
          total={unreadTotal}
          conversations={allConversations}
          selfId={selfChatId}
          resolveDisplayName={resolveDisplayName}
          onSelectConversation={onSelectConversation}
          onNewMessage={() => setChatPickerMode("message")}
          onFindPerson={() => setChatPickerMode("findPerson")}
          onNewGroupChat={() => setChatPickerMode("group")}
        />
      )}
      {chatMode === "real" && chatPickerMode && (
        <EmployeePickerModal
          mode={chatPickerMode === "group" ? "multi" : "single"}
          title={
            chatPickerMode === "group"
              ? "New Group Chat"
              : chatPickerMode === "findPerson"
                ? "Find Person"
                : "New Message"
          }
          people={roster.people
            .filter((p) => p.email.toLowerCase() !== selfChatId.toLowerCase())
            .map((p) => ({ email: p.email, displayName: resolveDisplayName(p.email) }))}
          onClose={() => setChatPickerMode(null)}
          onConfirm={(emails) => {
            const wasGroup = chatPickerMode === "group";
            setChatPickerMode(null);
            if (wasGroup) {
              void startRemoteGroupChat(emails);
            } else {
              startRemoteDirectMessage(emails[0]);
            }
          }}
        />
      )}
      {chatMode === "real" && (
        <JoinRequestPrompt
          resolveDisplayName={resolveDisplayName}
          onResolved={(req) => {
            // Current participants (who are approving) should treat resultConversationId as
            // their live conversation too — if it differs from the one they already have
            // open, transition spatial-session bookkeeping to the new id. (In today's backend,
            // accept_join_request adds the requester to the SAME conversation_id the request
            // targeted, so this practically never differs for an existing participant — kept
            // for forward-compatibility with a future DM->group conversation-id change.)
            if (
              req.state === "accepted" &&
              req.resultConversationId &&
              openConversationId &&
              req.resultConversationId !== openConversationId
            ) {
              emitSpatialSessionLeave();
              setOpenConversationId(req.resultConversationId);
              emitSpatialSessionStart(req.resultConversationId);
            }
          }}
        />
      )}
      {chatMode === "real" && <DndRequestQueue resolveDisplayName={resolveDisplayName} />}
      <RoomLockedToast
        roomName={roomEntryGate?.roomName ?? null}
        pendingRequestId={roomEntryGate?.pendingRequestId ?? null}
        declined={roomEntryDeclined}
        onKnock={() => void handleKnock()}
        onCancel={handleCancelKnock}
      />
      <TalkRequestToast
        targetName={personGate?.targetName ?? null}
        pendingRequestId={personGate?.pendingRequestId ?? null}
        declined={personGateDeclined}
        cooldownUntil={personGateCooldownUntil}
        onRequest={() => void handleRequestTalk()}
        onCancel={handleCancelTalkRequest}
      />
      {toast && <div className={styles.toast}>{toast}</div>}
      {onboarding === "checkinPrompt" && (
        <CheckinModal onYes={startCheckin} onNotNow={() => setOnboarding("done")} />
      )}
      {receptionMenu && (
        <ReceptionActionMenu
          anchor={receptionMenu}
          onClose={() => setReceptionMenu(null)}
          showCheckIn={!hasCheckedIn && checkoutFlow.state === "IDLE"}
          showCheckOut={
            hasCheckedIn &&
            checkoutFlow.state === "IDLE" &&
            (import.meta.env.DEV || isRealZohoMode())
          }
          onCheckIn={() => {
            setReceptionMenu(null);
            setOnboarding("checkinPrompt");
          }}
          onCheckOut={() => {
            setReceptionMenu(null);
            checkoutFlow.startCheckout();
          }}
        />
      )}
      {/* Dev-only until avatar generation has a server-side home (D2).
          The creator runs on MockAvatarService, so in production it does
          not fail — it quietly succeeds, writing invented colleagues into
          one viewer's localStorage. In a directory of real employees
          that reads as data corruption rather than a demo, and nobody
          else can see the result anyway. Re-enable once generated avatars
          are persisted server-side and belong to a real person. */}
      {import.meta.env.DEV && (
        <button
          type="button"
          className={styles.addEmployeeButton}
          onClick={() => setIsAvatarCreatorOpen(true)}
        >
          + Add Employee
        </button>
      )}
      {isAvatarCreatorOpen && (
        <AvatarCreator
          onClose={() => setIsAvatarCreatorOpen(false)}
          ownerEmail={currentUser?.email ?? null}
          onAvatarSaved={(saved) => {
            setCustomAvatars((prev) => [...prev, saved]);
            if (saved.generationStatus === "pending") startPollingJob(saved);
          }}
        />
      )}
    </div>
  );
}

export default OfficeMap;
