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
  roomContainingPoint,
  roomLayers,
  roomMembersById,
} from "../../data/office-layout";
import { findPath, roomOf } from "../../data/officePathfinding";
import {
  cellToWorld,
  findRoomDoorCell,
  nearestStandSpotConnectedTo,
  nearestWalkableConnectedTo,
  worldToCell,
} from "../../data/officeGrid";
import type { AssetLayer } from "../../types/office";
import type { ChatMessage } from "../../services/chat";
import { OfficeStage } from "./OfficeStage";
import { CharacterSearch } from "./CharacterSearch";
import { CharacterActionMenu } from "./CharacterActionMenu";
import { RoomSidebar } from "./RoomSidebar";
import { CheckinModal } from "./CheckinModal";
import { RoomPickerModal } from "./RoomPickerModal";
import {
  computeCenterTransform,
  computeRoomFocusTransform,
  SIDEBAR_WIDTH,
} from "./panMath";
import { useCharacterWalk } from "./useCharacterWalk";
import { SavedAvatarWalker, type SavedAvatarWalkApi, type SavedAvatarWalkState } from "./SavedAvatarWalker";
import { ALEX_SPRITE_SET, MICAH_SPRITE_SET, bonSprite, characterSprite } from "../../data/bonWalkFrames";
import { useOfficePhase } from "./useOfficePhase";
import { OfficePhaseDebugControl } from "./OfficePhaseDebugControl";
import { AvatarCreator } from "../AvatarCreator/AvatarCreator";
import { loadSavedAvatars } from "../../services/avatar/MockAvatarService";
import { updateSavedAvatar } from "../../services/avatar/avatarStorage";
import { realAvatarService } from "../../services/avatar/RealAvatarService";
import type { SavedAvatar } from "../../services/avatar/types";
import { savedAvatarsToLayers } from "../../data/savedAvatarLayers";
import { useCheckoutFlow } from "./useCheckoutFlow";
import { WorkingStatusIndicator } from "./checkout/WorkingStatusIndicator";
import { CheckoutReminderToast } from "./checkout/CheckoutReminderToast";
import { CheckoutConfirmModal } from "./checkout/CheckoutConfirmModal";
import { TimeSummaryPanel } from "./checkout/TimeSummaryPanel";
import { TimeLogForm } from "./checkout/TimeLogForm";
import { ConversationView } from "../Chat/ConversationView";
import { getCurrentUserId } from "../../data/currentUser";
import { TimeLogReview } from "./checkout/TimeLogReview";
import { SubmissionFailedPanel } from "./checkout/SubmissionFailedPanel";
import { CheckoutSuccessCard } from "./checkout/CheckoutSuccessCard";
import { CheckoutDebugPanel } from "./checkout/CheckoutDebugPanel";
import checkoutStyles from "./checkout/checkout.module.css";
import styles from "./OfficeMap.module.css";

// Check-in sequence: bon spawns outside with no popup. Clicking Arisha (while
// not yet checked in) offers a check-in walk to reception, greets, then lets
// the user pick a room. Every state other than "done" suppresses normal
// interactions (room/character clicks, search) — see the guards on those
// handlers below.
type OnboardingState =
  | "checkinPrompt"
  | "walkingToReception"
  | "greeting"
  | "roomSelect"
  | "walkingToRoom"
  | "done";

function computeCoverScale(): number {
  if (typeof window === "undefined") return 0.5;
  const fitW = window.innerWidth / FRAME_WIDTH;
  const fitH = window.innerHeight / FRAME_HEIGHT;
  // cover: office frame fills viewport edge-to-edge (may overflow one axis).
  // Used as both initial and min scale so the frame always fully covers the
  // viewport — zooming out can never reveal the viewport background.
  return Math.max(fitW, fitH);
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
  const [roomSidebar, setRoomSidebar] = useState<{ layer: AssetLayer; side: "left" | "right" } | null>(
    null,
  );
  const [toast, setToast] = useState<string | null>(null);
  const [isAvatarCreatorOpen, setIsAvatarCreatorOpen] = useState(false);
  // Avatars saved via AvatarCreator (Track 2) — loaded once from
  // localStorage on mount, then appended to live as each new one is saved
  // so it appears in its chosen room without a page refresh.
  const [customAvatars, setCustomAvatars] = useState<SavedAvatar[]>(() => loadSavedAvatars());
  const extraCharacterLayers = useMemo(() => savedAvatarsToLayers(customAvatars), [customAvatars]);
  const extraCharacterSrcById = useMemo(() => {
    const map: Record<string, string> = {};
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
  }, [customAvatars]);
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
  // through the check-in states only once the user deliberately clicks
  // Arisha and picks "Check in" from her action menu.
  const [onboarding, setOnboarding] = useState<OnboardingState>("done");
  // Tracks whether the check-in flow has been completed at least once —
  // gates the "Check in" option on Arisha's menu (hidden once already
  // checked in). Declining the "Want to check in?" modal ("Not now") does
  // NOT count as checked-in, so the option stays available to retry.
  const [hasCheckedIn, setHasCheckedIn] = useState(false);

  useEffect(() => {
    return () => {
      window.clearTimeout(greetTimerRef.current);
      window.clearTimeout(charMenuTimerRef.current);
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
    cancel: cancelWalk,
    resetPos: resetBonPos,
  } = useCharacterWalk({
    x: bonLayer.x,
    y: bonLayer.y,
  });
  const bonSpriteSrc = bonSprite(isPatting ? "pat" : isWalking ? "walk" : "idle", direction, frameIndex);

  // Alex/Micah demo-walk instances — same useCharacterWalk hook as bon,
  // seeded from each NPC's actual current manifest position so their demo
  // loop starts exactly where they normally stand.
  const alexLayer = npcCharacterLayers.find((l) => l.id === "alex");
  const micahLayer = npcCharacterLayers.find((l) => l.id === "micah");
  const {
    pos: alexPos,
    isWalking: alexIsWalking,
    isPatting: alexIsPatting,
    direction: alexDirection,
    frameIndex: alexFrameIndex,
    walkTo: alexWalkTo,
    playPat: alexPlayPat,
  } = useCharacterWalk({ x: alexLayer?.x ?? 0, y: alexLayer?.y ?? 0 });
  const {
    pos: micahPos,
    isWalking: micahIsWalking,
    isPatting: micahIsPatting,
    direction: micahDirection,
    frameIndex: micahFrameIndex,
    walkTo: micahWalkTo,
    playPat: micahPlayPat,
  } = useCharacterWalk({ x: micahLayer?.x ?? 0, y: micahLayer?.y ?? 0 });
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

  // "Walk demo" / "Pat demo" — action-menu items available to alex/micah
  // (their own dedicated useCharacterWalk instances above) AND any saved
  // avatar with a populated spriteSet (via savedAvatarApiRef). Scripts a
  // small in-view closed-loop walk (out ~1-2 tiles, then back) exercising
  // multiple directions, then plays the pat frames. Does not touch bon or his
  // own walk/pat mechanism (see handleChoose's existing "pat"/"chat" branches).
  function runWalkDemo(layer: AssetLayer) {
    const walkTo =
      layer.id === "alex"
        ? alexWalkTo
        : layer.id === "micah"
          ? micahWalkTo
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
    resetBonPos({ x: bonLayer.x, y: bonLayer.y });
  }

  // SAYING_GOODBYE/WALKING_TO_RECEPTION: goodbye bubble, then walk to Arisha
  // using the same standoff-goal logic as startCheckin.
  function handleConfirmStartCheckout() {
    checkoutFlow.confirmStartCheckout();
    window.clearTimeout(greetTimerRef.current);
    greetNonceRef.current += 1;
    setGreeting({ characterId: bonLayer.id, nonce: greetNonceRef.current, text: "Bye, everyone! 👋" });
    greetTimerRef.current = window.setTimeout(() => {
      setGreeting(null);
      beginWalkToReception();
    }, 2000);
  }

  function beginWalkToReception() {
    const arisha = npcCharacterLayers.find((l) => l.id === "arisha");
    if (!arisha) {
      checkoutFlow.arrivedAtReception();
      return;
    }
    const bw = bonLayer.width;
    const bh = bonLayer.height;
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
      : { x: tc.x - ux * standoff - bw / 2, y: tc.y - uy * standoff - bh / 2 };
    const startRoomId = roomOf(bc)?.id ?? null;
    const goalRoomId = roomOf(tc)?.id ?? null;
    const path = findPath({ x: bonPos.x, y: bonPos.y }, goal, startRoomId, goalRoomId);

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
    walkTo(path, () => {
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
      const startCenter = { x: bonPos.x + bonLayer.width / 2, y: bonPos.y + bonLayer.height / 2 };
      const goal = { x: bonLayer.x, y: bonLayer.y };
      const goalCenter = { x: goal.x + bonLayer.width / 2, y: goal.y + bonLayer.height / 2 };
      const startRoomId = roomOf(startCenter)?.id ?? null;
      const goalRoomId = roomOf(goalCenter)?.id ?? null;
      const path = findPath({ x: bonPos.x, y: bonPos.y }, goal, startRoomId, goalRoomId);
      pipSideRef.current = goal.x > bonPos.x ? "left" : "right";
      walkTo(path, () => {
        window.clearTimeout(greetTimerRef.current);
        greetNonceRef.current += 1;
        setGreeting({ characterId: bonLayer.id, nonce: greetNonceRef.current, text: "Bye, everyone! 👋" });
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

  const PIP_WIDTH = 240;
  const PIP_HEIGHT = 180;
  const pipScale = initialScale * 2.5;
  const pipTransform = computeCenterTransform(
    { x: bonPos.x, y: bonPos.y, width: bonLayer.width, height: bonLayer.height },
    pipScale,
    PIP_WIDTH,
    PIP_HEIGHT,
  );

  // Frame the camera on bon's outside spawn on mount. Runs once — does not
  // rely on TransformWrapper's own centerOnInit/computeCoverScale framing,
  // since the default cover-fit view may not show the bottom band of the
  // frame where bon now spawns on some viewport aspect ratios.
  useEffect(() => {
    const ref = transformRef.current;
    const wrapper = ref?.instance.wrapperComponent;
    if (!ref || !wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    // Close-in, animated zoom on bon at mount — matches the room-focus /
    // character-click zoom feel rather than the flat, instant cover framing.
    const focusScale = initialScale * 2.5;
    const { x, y } = computeCenterTransform(bonLayer, focusScale, rect.width, rect.height);
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
    const bw = bonLayer.width;
    const bh = bonLayer.height;
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
      : { x: tc.x - ux * standoff - bw / 2, y: tc.y - uy * standoff - bh / 2 };
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
    walkTo(path, () => {
      setOnboarding("greeting");
      // Three sequential beats — a proper greet/respond/prompt exchange
      // rather than one static bubble. Each beat fully dismisses before the
      // next appears; the last beat advances to the room-picker popup.
      playGreetingBeats(
        [
          { characterId: arisha.id, text: `Hi ${formatCharacterName(bonLayer)}!`, durationMs: 1500 },
          { characterId: bonLayer.id, text: `Hi ${formatCharacterName(arisha)}!`, durationMs: 1500 },
          { characterId: arisha.id, text: "Where would you like to go?", durationMs: 1500 },
        ],
        () => setOnboarding("roomSelect"),
      );
    });
  }

  function chooseRoom(layer: AssetLayer) {
    // Dismiss the room picker (it only renders during "roomSelect") and hold
    // bon still while the camera zooms out slowly, THEN walk — a deliberate
    // "zoom out to see more of the office, then watch bon walk" sequence
    // rather than an instant cut + concurrent walk.
    setOnboarding("walkingToRoom");
    const zoomOutMs = 1000;
    resetToInitialView(zoomOutMs);
    window.setTimeout(() => {
      const bw = bonLayer.width;
      const bh = bonLayer.height;
      const startCenter = { x: bonPos.x + bw / 2, y: bonPos.y + bh / 2 };
      const roomCenter = { x: layer.x + layer.width / 2, y: layer.y + layer.height / 2 };
      const startCell = worldToCell(startCenter);
      const roomCell = worldToCell(roomCenter);
      // Prefer the room's hand-painted door ('+') cell as the true arrival
      // point — e.g. design-room's doorway, pixel-precise from Figma data —
      // over a geometric room-center that can land bon behind desks. Falls
      // back to the old center-snapping heuristic for rooms without a
      // mapped door cell.
      const doorCell = findRoomDoorCell(layer);
      const snapped = doorCell
        ? nearestWalkableConnectedTo(doorCell.cx, doorCell.cy, startCell.cx, startCell.cy)
        : nearestWalkableConnectedTo(roomCell.cx, roomCell.cy, startCell.cx, startCell.cy);
      const snappedWorld = cellToWorld(snapped.cx, snapped.cy);
      const goal = { x: snappedWorld.x - bw / 2, y: snappedWorld.y - bh / 2 };
      const startRoomId = roomOf(startCenter)?.id ?? null;
      const path = findPath({ x: bonPos.x, y: bonPos.y }, goal, startRoomId, layer.id);

      pipSideRef.current = roomCenter.x > startCenter.x ? "left" : "right";
      walkTo(path, () => {
        window.clearTimeout(greetTimerRef.current);
        greetNonceRef.current += 1;
        setGreeting({ characterId: bonLayer.id, nonce: greetNonceRef.current, text: "Hi team!" });
        greetTimerRef.current = window.setTimeout(() => setGreeting(null), 3000);
        setOnboarding("done");
        setHasCheckedIn(true);
      });
    }, zoomOutMs);
  }

  function handleChoose(action: "chat" | "call" | "pat" | "checkin" | "walkDemo" | "patDemo") {
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
    if (action === "checkin") {
      // Re-triggers the same "Want to check in?" prompt the old mount effect
      // used to auto-show — now started deliberately from Arisha's menu.
      // Close the menu WITHOUT resetting the camera (unlike closeCharacterMenu)
      // so the view stays exactly as-is while CheckinModal appears; the zoom
      // only happens in startCheckin, once the user confirms.
      setMenu(null);
      setOnboarding("checkinPrompt");
      return;
    }
    if (action === "pat") {
      setMenu(null);
      const bw = bonLayer.width;
      const bh = bonLayer.height;
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
        : { x: tc.x - ux * standoff - bw / 2, y: tc.y - uy * standoff - bh / 2 };
      const startRoomId = roomOf(bc)?.id ?? null;
      const goalRoomId = roomOf(tc)?.id ?? null;
      const path = findPath({ x: bonPos.x, y: bonPos.y }, goal, startRoomId, goalRoomId);

      // Static camera focus on the pat target — bon may walk off-screen
      // while approaching; the mini-camera PiP (rendered while isWalking)
      // tracks him instead.
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
      pipSideRef.current = target.x > bonPos.x ? "left" : "right";
      walkTo(path, () => {
        playPat();
      });
    } else if (action === "chat") {
      // setMenu(null) rather than closeCharacterMenu() — avoid resetting the
      // camera view when opening the chat panel.
      setMenu(null);
      const bw = bonLayer.width;
      const bh = bonLayer.height;
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
        : { x: tc.x - ux * standoff - bw / 2, y: tc.y - uy * standoff - bh / 2 };
      const startRoomId = roomOf(bc)?.id ?? null;
      const goalRoomId = roomOf(tc)?.id ?? null;
      const path = findPath({ x: bonPos.x, y: bonPos.y }, goal, startRoomId, goalRoomId);

      // Static camera focus on the chat target — bon may walk off-screen
      // while approaching; the mini-camera PiP (rendered while isWalking)
      // tracks him instead.
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
      pipSideRef.current = target.x > bonPos.x ? "left" : "right";
      walkTo(path, () => {
        setOpenChat(target);
        setTalkingIds([getCurrentUserId(), target.id]);
      });
    } else {
      closeCharacterMenu();
      setToast(`Calling ${name}… — coming soon`);
      setTimeout(() => setToast(null), 1800);
    }
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

  // Recomputed on every render (e.g. while bon walks with the sidebar open)
  // so the roster reflects bon's live position, not a stale snapshot.
  const bonCenter = { x: bonPos.x + bonLayer.width / 2, y: bonPos.y + bonLayer.height / 2 };
  const bonRoom = roomContainingPoint(bonCenter);
  const bonIsHere = roomSidebar !== null && bonRoom?.id === roomSidebar.layer.id;
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
        ...(bonIsHere ? [bonLayer] : []),
      ]
    : [];

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
            characterOverrides={{ bon: bonPos, alex: alexPos, micah: micahPos, ...savedAvatarOverridePos }}
            characterSrcOverrides={{
              bon: bonSpriteSrc,
              alex: alexSpriteSrc,
              micah: micahSpriteSrc,
              ...savedAvatarOverrideSrc,
            }}
            extraCharacterLayers={extraCharacterLayers}
            extraCharacterSrcById={extraCharacterSrcById}
            onCharacterClick={handleCharacterClick}
            hiddenCharacterIds={checkoutFlow.state === "CHECKED_OUT" ? ["bon"] : undefined}
            onRoomClick={(layer) => {
              // Onboarding sequence must complete before normal room-click
              // interactions resume — every non-"done" state suppresses this.
              if (onboarding !== "done" || checkoutBusy) return;
              setMenu(null);
              const side = layer.x + layer.width / 2 > FRAME_WIDTH / 2 ? "left" : "right";
              focusRoom(layer, side);
              setRoomSidebar({ layer, side });
            }}
            greetingCharacterId={greeting?.characterId ?? null}
            greetingNonce={greeting?.nonce}
            greetingText={greeting?.text}
            talkingCharacterIds={talkingIds}
            talkingTextById={talkingTextById}
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
              characterOverrides={{ bon: bonPos, alex: alexPos, micah: micahPos, ...savedAvatarOverridePos }}
              characterSrcOverrides={{
                bon: bonSpriteSrc,
                alex: alexSpriteSrc,
                micah: micahSpriteSrc,
                ...savedAvatarOverrideSrc,
              }}
              extraCharacterLayers={extraCharacterLayers}
              extraCharacterSrcById={extraCharacterSrcById}
              hiddenCharacterIds={checkoutFlow.state === "CHECKED_OUT" ? ["bon"] : undefined}
              talkingCharacterIds={talkingIds}
              talkingTextById={talkingTextById}
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
        onTryAgain={() => void checkoutFlow.retrySubmit()}
        onSaveAndReturnLater={checkoutFlow.saveAndReturnLater}
      />
      <CheckoutSuccessCard
        state={checkoutFlow.state}
        workedLabel={checkoutFlow.workedLabel}
        entries={checkoutFlow.entries}
        submissionResult={checkoutFlow.submissionResult}
      />
      {import.meta.env.DEV && (
        <OfficePhaseDebugControl
          phase={phase}
          hourDecimal={hourDecimal}
          overrideHour={overrideHour}
          setOverrideHour={setOverrideHour}
        />
      )}
      {(import.meta.env.DEV ||
        new URLSearchParams(window.location.search).get("checkoutDebug") === "true") && (
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
          showCheckin={menu.layer.id === "arisha" && !hasCheckedIn}
          showDemos={
            menu.layer.id === "alex" || menu.layer.id === "micah" || Boolean(menu.layer.animatable)
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
        onClose={closeRoomSidebar}
      />
      {openChat && (
        <ConversationView
          peer={openChat}
          selfId={getCurrentUserId()}
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
      {toast && <div className={styles.toast}>{toast}</div>}
      {onboarding === "checkinPrompt" && (
        <CheckinModal onYes={startCheckin} onNotNow={() => setOnboarding("done")} />
      )}
      {onboarding === "roomSelect" && <RoomPickerModal rooms={roomLayers} onChoose={chooseRoom} />}
      <button
        type="button"
        className={styles.addEmployeeButton}
        onClick={() => setIsAvatarCreatorOpen(true)}
      >
        + Add Employee
      </button>
      {isAvatarCreatorOpen && (
        <AvatarCreator
          onClose={() => setIsAvatarCreatorOpen(false)}
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
