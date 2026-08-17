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
import { findPath, roomOf } from "../../data/officePathfinding";
import {
  cellToWorld,
  findRoomDoorCell,
  nearestStandSpotConnectedTo,
  nearestWalkableConnectedTo,
  worldToCell,
} from "../../data/officeGrid";
import { doorStandForRoom } from "../../data/doorStandPoints";
import { seatsForRoomId } from "../../data/roomSeats";
import type { Pt } from "../../data/walkable-zones";
import { DOOR_ANIM_MS, DOOR_LAYERS_BY_ROOM } from "../../data/officeDoors";
import type { AssetLayer } from "../../types/office";
import { chatMode } from "../../services/chat";
import type { ChatMessage } from "../../services/chat";
import { useUnreadTotal } from "../../services/chat/useUnreadTotal";
import { MessageNotificationBadge } from "../Chat/MessageNotificationBadge";
import { isRealZohoMode } from "../../services/zoho";
import { OfficeStage } from "./OfficeStage";
import { CharacterSearch } from "./CharacterSearch";
import { CharacterActionMenu } from "./CharacterActionMenu";
import { RoomSidebar } from "./RoomSidebar";
import { CheckinModal } from "./CheckinModal";
import { ReceptionActionMenu } from "./ReceptionActionMenu";
import {
  computeCenterTransform,
  computeRoomFocusTransform,
  SIDEBAR_WIDTH,
} from "./panMath";
import { useCharacterWalk, directionBetween } from "./useCharacterWalk";
import type { WalkDirection } from "../../data/bonWalkFrames";
import { SavedAvatarWalker, type SavedAvatarWalkApi, type SavedAvatarWalkState } from "./SavedAvatarWalker";
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
import { CheckoutReminderToast } from "./checkout/CheckoutReminderToast";
import { CheckoutConfirmModal } from "./checkout/CheckoutConfirmModal";
import { TimeSummaryPanel } from "./checkout/TimeSummaryPanel";
import { TimeLogForm } from "./checkout/TimeLogForm";
import { ConversationView } from "../Chat/ConversationView";
import { getCurrentUserId, useCurrentUserAvatarId } from "../../data/currentUser";
import { useCurrentUser } from "../../auth/currentUserStore";
import { useOfficeRoster } from "../../services/office/useOfficeRoster";
import { officePeopleToLayers, rosterSrcById } from "../../data/rosterLayers";
import { TimeLogReview } from "./checkout/TimeLogReview";
import { SubmissionFailedPanel } from "./checkout/SubmissionFailedPanel";
import { CheckoutSuccessCard } from "./checkout/CheckoutSuccessCard";
import { CheckoutDebugPanel } from "./checkout/CheckoutDebugPanel";
import checkoutStyles from "./checkout/checkout.module.css";
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
function nearestSeatTo(roomId: string, point: Pt): Pt | null {
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
  // Anchored action menu opened by clicking the reception room itself — the
  // sole entry point for check-in/check-out now that Arisha's own menu no
  // longer offers "Check in" and the room-picker step is gone.
  const [receptionMenu, setReceptionMenu] = useState<{ clientX: number; clientY: number } | null>(
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

  // Unread-message notification badge (Phase 3, functional placeholder —
  // Bon will restyle it once this is confirmed working). Real-mode-only,
  // same gating precedent as resolvePeerChatId/chatDisabled below.
  const { total: unreadTotal, unreadConversations } = useUnreadTotal(selfChatId);

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
    () => [...savedAvatarsToLayers(customAvatars), ...rosterLayers],
    [customAvatars, rosterLayers],
  );
  const extraCharacterSrcById = useMemo(() => {
    const map: Record<string, string> = { ...rosterSrcById(rosterLayers) };
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
  }, [customAvatars, rosterLayers]);
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
  const [talkingIds, setTalkingIds] = useState<string[]>([]);
  const [openChat, setOpenChat] = useState<AssetLayer | null>(null);
  // Latest sent message text per character id, shown in their talking bubble
  // until it expires (falls back to the looping dots otherwise).
  const [talkingTextById, setTalkingTextById] = useState<Record<string, string>>({});
  const talkingTimersRef = useRef<Record<string, number>>({});

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
    walkTo,
    playPat,
    face,
    cancel: cancelWalk,
    resetPos: resetBonPos,
  } = useCharacterWalk({
    x: bonLayer.x,
    y: bonLayer.y,
  });
  const playerSpriteSrc = characterSprite(
    viewerSpriteSet,
    isPatting ? "pat" : isWalking ? "walk" : "idle",
    direction,
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
    const seatAt = checkoutFlow.state === "CHECKED_OUT" ? bonLayer : viewerLayer;
    resetBonPos({ x: seatAt.x, y: seatAt.y });
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
  const hiddenCharacterIds = useMemo(() => {
    return rosterActive
      ? npcCharacterLayers.filter((layer) => layer.id !== playerLayerId).map((layer) => layer.id)
      : [];
  }, [rosterActive, playerLayerId]);

  const checkoutBusy =
    checkoutFlow.state === "SAYING_GOODBYE" ||
    checkoutFlow.state === "WALKING_TO_RECEPTION" ||
    checkoutFlow.state === "WALKING_TO_EXIT";
  const exitTriggeredRef = useRef(false);
  const [frozenCheckoutAtMs, setFrozenCheckoutAtMs] = useState<number | null>(null);

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
    walkOutOfRoomThenTo(goal, goalRoomId, () => {
      face(directionBetween(arriveCenter, tc));
      checkoutFlow.arrivedAtReception();
      const ref = transformRef.current;
      const wrapper = ref?.instance.wrapperComponent;
      if (ref && wrapper) {
        const rect = wrapper.getBoundingClientRect();
        const focusScale = initialScale * 3;
        const { x, y } = computeCenterTransform(arisha, focusScale, rect.width, rect.height);
        ref.setTransform(x, y, focusScale, 500, "easeOut");
      }
    });
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
      walkOutOfRoomThenTo(goal, goalRoomId, () => {
        face("front");
        window.clearTimeout(greetTimerRef.current);
        greetNonceRef.current += 1;
        setGreeting({ characterId: playerLayerId, nonce: greetNonceRef.current, text: "Bye, everyone! 👋" });
        greetTimerRef.current = window.setTimeout(() => {
          setGreeting(null);
          checkoutFlow.finishExit();
        }, 1500);
      });
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
    walkTo(path, () => {
      face(directionBetween(arriveCenter, tc));
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
    });
  }

  // Bridges the `rooms`/`teamRooms` namespace roomIdForPerson() returns
  // (e.g. "design-team", "executive-team") into the `roomLayers`/manifest
  // namespace (e.g. "design-room", "executive-room") used by the walk/zoom
  // logic below — via that room's flat-rect CENTER point run through
  // roomContainingPoint(), the existing documented convention for crossing
  // these two id schemes (see office-layout.ts).
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

      function finishArrival() {
        face("front");
        window.clearTimeout(greetTimerRef.current);
        greetNonceRef.current += 1;
        setGreeting({ characterId: playerLayerId, nonce: greetNonceRef.current, text: "Hi team!" });
        greetTimerRef.current = window.setTimeout(() => setGreeting(null), 3000);
        setOnboarding("done");
        setHasCheckedIn(true);
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

        walkTo(pathToOutStand, () => {
          // The full-map reveal (resetToInitialView above) has done its job
          // by now (bon has walked all the way to the door) — narrow to
          // room-fit right as the door is about to slide open, so the
          // animation is actually visible, then hold room-fit through the
          // door crossing + arrival greeting.
          focusRoomFit(flatRoomId);
          onDoorOpen(flatRoomId);
          window.setTimeout(() => {
            const pathToInStand = findPath(outGoal, inGoal, layer.id, layer.id);
            walkTo(pathToInStand, () => {
              onDoorClose(flatRoomId);
              // Don't leave bon glued to the door threshold — walk him one
              // more short leg to an actual seat inside the room. This makes
              // checkout's first leg (seat -> inStand) a real, visible walk
              // instead of a zero-distance one that fires its arrival
              // callback synchronously (see useCharacterWalk.ts). Falls back
              // to greeting immediately if this room has no painted seats.
              const nearestSeat = nearestSeatTo(flatRoomId, doorPair.inStand);
              if (nearestSeat) {
                const seatGoal = { x: nearestSeat.x - bw / 2, y: nearestSeat.y - bh / 2 };
                const pathToSeat = findPath(inGoal, seatGoal, layer.id, layer.id);
                walkTo(pathToSeat, finishArrival);
              } else {
                finishArrival();
              }
            });
          }, DOOR_ANIM_MS);
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

      walkTo(path, finishArrival);
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
    window.clearTimeout(checkoutDoorTimerRef.current);
    checkoutDoorTimerRef.current = undefined;
    checkoutDoorNonceRef.current += 1;
    const nonce = checkoutDoorNonceRef.current;

    if (doorPair) {
      const inGoal = { x: doorPair.inStand.x - bw / 2, y: doorPair.inStand.y - bh / 2 };
      const outGoal = { x: doorPair.outStand.x - bw / 2, y: doorPair.outStand.y - bh / 2 };
      const pathToInStand = findPath({ x: bonPos.x, y: bonPos.y }, inGoal, startRoomId, startRoomId);

      walkTo(pathToInStand, () => {
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
          walkTo(pathToOutStand, () => {
            if (checkoutDoorNonceRef.current !== nonce) return;
            onDoorClose(flatStartRoomId!);
            const pathToGoal = findPath(outGoal, finalGoal, startRoomId, finalGoalRoomId);
            walkTo(pathToGoal, () => {
              if (checkoutDoorNonceRef.current !== nonce) return;
              onArrive();
            });
          });
        }, DOOR_ANIM_MS);
      });
      return;
    }

    // Fallback: bon isn't currently in a room with a complete door pair —
    // existing single-goal walk behavior, unchanged.
    const path = findPath({ x: bonPos.x, y: bonPos.y }, finalGoal, startRoomId, finalGoalRoomId);
    walkTo(path, onArrive);
  }

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
    const standSpot = nearestStandSpotConnectedTo(tcCell.cx, tcCell.cy, bcCell.cx, bcCell.cy);
    const goal = standSpot
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
    const startRoomId = roomOf(bc)?.id ?? null;
    const goalRoomId = roomOf(tc)?.id ?? null;
    const arriveCenter = { x: goal.x + bw / 2, y: goal.y + bh / 2 };

    const flatStartRoomId = flatRoomIdAt(bc);
    const flatGoalRoomId = flatRoomIdAt(tc);
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
    window.clearTimeout(approachDoorTimerRef.current);
    approachDoorTimerRef.current = undefined;
    approachNonceRef.current += 1;
    const nonce = approachNonceRef.current;

    if (doorCrossing) {
      const doorPair = doorCrossing.pair;
      const outGoal = { x: doorPair.outStand.x - bw / 2, y: doorPair.outStand.y - bh / 2 };
      const inGoal = { x: doorPair.inStand.x - bw / 2, y: doorPair.inStand.y - bh / 2 };
      const pathToOutStand = findPath({ x: bonPos.x, y: bonPos.y }, outGoal, startRoomId, goalRoomId);

      walkTo(pathToOutStand, () => {
        if (approachNonceRef.current !== nonce) return;
        onDoorOpen(doorCrossing.roomId);
        approachDoorTimerRef.current = window.setTimeout(() => {
          approachDoorTimerRef.current = undefined;
          if (approachNonceRef.current !== nonce) return;
          const pathToInStand = findPath(outGoal, inGoal, goalRoomId, goalRoomId);
          walkTo(pathToInStand, () => {
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
            walkTo(pathToStandSpot, () => {
              if (approachNonceRef.current !== nonce) return;
              face(directionBetween(arriveCenter, tc));
              onArrive(arriveCenter, tc);
            });
          });
        }, DOOR_ANIM_MS);
      });
      return;
    }

    // Fallback: same room already, or no complete door stand-point pairing
    // painted for this room yet — existing single-goal walk, unchanged.
    const path = findPath({ x: bonPos.x, y: bonPos.y }, goal, startRoomId, goalRoomId);
    walkTo(path, () => {
      face(directionBetween(arriveCenter, tc));
      onArrive(arriveCenter, tc);
    });
  }

  function handleChoose(action: "chat" | "call" | "approach" | "walkDemo" | "patDemo") {
    if (!menu) return;
    const target = menu.layer;
    const name = formatCharacterName(target);
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
      // camera view when opening the chat panel.
      setMenu(null);
      approachCharacter(target, () => {
        setOpenChat(target);
        setTalkingIds([playerLayerId, target.id]);
      });
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

  // Placeholder click-through for the unread-notification badge — opens the
  // conversation directly (no walk-up-and-approach beat, unlike the normal
  // "chat" action-menu path) since this is a simple testing affordance, not
  // the polished entry point. Prefers the peer's real on-map layer (for
  // name/avatar) when they're currently a rendered character; falls back to
  // a minimal synthetic layer (id-derived display name) otherwise, since the
  // conversation can still be opened by email even if they're not currently
  // visible on the floor.
  function openChatWithPeerEmail(peerEmail: string) {
    const email = peerEmail.toLowerCase();
    const layer =
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
      } as AssetLayer);
    setOpenChat(layer);
    setTalkingIds([playerLayerId, layer.id]);
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
              [playerLayerId]: playerSpriteSrc,
            }}
            extraCharacterLayers={extraCharacterLayers}
            extraCharacterSrcById={extraCharacterSrcById}
            onCharacterClick={handleCharacterClick}
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
            talkingCharacterIds={talkingIds}
            talkingTextById={talkingTextById}
            openDoorLayerIds={openDoorLayerIds}
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
              extraCharacterLayers={extraCharacterLayers}
              extraCharacterSrcById={extraCharacterSrcById}
              hiddenCharacterIds={hiddenCharacterIds}
              talkingCharacterIds={talkingIds}
              talkingTextById={talkingTextById}
              openDoorLayerIds={openDoorLayerIds}
            />
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
      {openChat && (
        <ConversationView
          peer={openChat}
          selfId={selfChatId}
          peerChatId={resolvePeerChatId(openChat)}
          selfAvatarUrl={playerSpriteSrc}
          onIncomingMessage={handleTalkingMessage}
          onClose={() => {
            setOpenChat(null);
            setTalkingIds([]);
            for (const timerId of Object.values(talkingTimersRef.current)) {
              window.clearTimeout(timerId);
            }
            talkingTimersRef.current = {};
            setTalkingTextById({});
          }}
        />
      )}
      {chatMode === "real" && (
        <MessageNotificationBadge
          total={unreadTotal}
          unreadConversations={unreadConversations}
          onSelectPeer={openChatWithPeerEmail}
        />
      )}
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
