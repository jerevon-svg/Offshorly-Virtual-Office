import { useEffect, useRef, useState } from "react";
import {
  TransformWrapper,
  TransformComponent,
  type ReactZoomPanPinchRef,
} from "react-zoom-pan-pinch";
import {
  FRAME_HEIGHT,
  FRAME_WIDTH,
  bonLayer,
  formatCharacterName,
  npcCharacterLayers,
  roomContainingPoint,
  roomLayers,
  roomMembersById,
} from "../../data/office-layout";
import { findPath, roomOf } from "../../data/officePathfinding";
import { cellToWorld, nearestWalkableConnectedTo, worldToCell } from "../../data/officeGrid";
import type { AssetLayer } from "../../types/office";
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
import { bonSprite } from "../../data/bonWalkFrames";
import styles from "./OfficeMap.module.css";

// On-load onboarding sequence: bon spawns outside, offers a check-in walk to
// reception, greets, then lets the user pick a room. Every state other than
// "done" suppresses normal interactions (room/character clicks, search) —
// see the guards on those handlers below.
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
  const [greeting, setGreeting] = useState<{ characterId: string; nonce: number; text?: string } | null>(
    null,
  );
  const greetTimerRef = useRef<number | undefined>(undefined);
  const greetNonceRef = useRef(0);
  const charMenuTimerRef = useRef<number | undefined>(undefined);

  // Onboarding state machine — replays from "checkinPrompt" on every full
  // page load (no persistence), per explicit product requirement.
  const [onboarding, setOnboarding] = useState<OnboardingState>("checkinPrompt");

  useEffect(() => {
    return () => {
      window.clearTimeout(greetTimerRef.current);
      window.clearTimeout(charMenuTimerRef.current);
    };
  }, []);

  const { pos: bonPos, isWalking, isPatting, direction, frameIndex, walkTo, playPat } = useCharacterWalk({
    x: bonLayer.x,
    y: bonLayer.y,
  });
  const bonSpriteSrc = bonSprite(isPatting ? "pat" : isWalking ? "walk" : "idle", direction, frameIndex);

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
    const goal = { x: tc.x - ux * standoff - bw / 2, y: tc.y - uy * standoff - bh / 2 };
    const startRoomId = roomOf(bc)?.id ?? null;
    const goalRoomId = roomOf(tc)?.id ?? null;
    const path = findPath({ x: bonPos.x, y: bonPos.y }, goal, startRoomId, goalRoomId);

    setOnboarding("walkingToReception");
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
      // Snap the room's center to the nearest walkable cell in bon's connected
      // region, mirroring the connectivity-aware goal snapping findPath itself
      // relies on internally — avoids handing findPath a goal buried in an
      // unreachable furniture pocket.
      const snapped = nearestWalkableConnectedTo(roomCell.cx, roomCell.cy, startCell.cx, startCell.cy);
      const snappedWorld = cellToWorld(snapped.cx, snapped.cy);
      const goal = { x: snappedWorld.x - bw / 2, y: snappedWorld.y - bh / 2 };
      const startRoomId = roomOf(startCenter)?.id ?? null;
      const path = findPath({ x: bonPos.x, y: bonPos.y }, goal, startRoomId, layer.id);

      walkTo(path, () => {
        window.clearTimeout(greetTimerRef.current);
        greetNonceRef.current += 1;
        setGreeting({ characterId: bonLayer.id, nonce: greetNonceRef.current, text: "Hi team!" });
        greetTimerRef.current = window.setTimeout(() => setGreeting(null), 3000);
        setOnboarding("done");
      });
    }, zoomOutMs);
  }

  function handleChoose(action: "chat" | "call" | "pat") {
    if (!menu) return;
    const target = menu.layer;
    const name = formatCharacterName(target);
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
      const goal = { x: tc.x - ux * standoff - bw / 2, y: tc.y - uy * standoff - bh / 2 };
      const startRoomId = roomOf(bc)?.id ?? null;
      const goalRoomId = roomOf(tc)?.id ?? null;
      const path = findPath({ x: bonPos.x, y: bonPos.y }, goal, startRoomId, goalRoomId);

      // View stays exactly where it is — no zoom/pan on Pat. bon simply
      // walks toward the target, potentially entering from off-screen.
      walkTo(path, () => {
        playPat();
      });
    } else {
      closeCharacterMenu();
      setToast(action === "chat" ? `Chat with ${name} — coming soon` : `Calling ${name}… — coming soon`);
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
    if (onboarding !== "done") return;
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
  const roomSidebarMembers = roomSidebar
    ? [...roomMembersById[roomSidebar.layer.id], ...(bonIsHere ? [bonLayer] : [])]
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
            characterOverrides={{ bon: bonPos }}
            characterSrcOverrides={{ bon: bonSpriteSrc }}
            onCharacterClick={handleCharacterClick}
            onRoomClick={(layer) => {
              // Onboarding sequence must complete before normal room-click
              // interactions resume — every non-"done" state suppresses this.
              if (onboarding !== "done") return;
              setMenu(null);
              const side = layer.x + layer.width / 2 > FRAME_WIDTH / 2 ? "left" : "right";
              focusRoom(layer, side);
              setRoomSidebar({ layer, side });
            }}
            greetingCharacterId={greeting?.characterId ?? null}
            greetingNonce={greeting?.nonce}
            greetingText={greeting?.text}
          />
        </TransformComponent>
      </TransformWrapper>
      <CharacterSearch
        transformRef={transformRef}
        targetScale={maxScale}
        onLocate={(layer) => {
          // Onboarding sequence must complete before normal search-locate
          // interactions resume — every non-"done" state suppresses this.
          if (onboarding !== "done") return;
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
        />
      )}
      <RoomSidebar
        open={roomSidebar !== null}
        layer={roomSidebar?.layer ?? null}
        side={roomSidebar?.side ?? "right"}
        members={roomSidebarMembers}
        onClose={closeRoomSidebar}
      />
      {toast && <div className={styles.toast}>{toast}</div>}
      {onboarding === "checkinPrompt" && (
        <CheckinModal onYes={startCheckin} onNotNow={() => setOnboarding("done")} />
      )}
      {onboarding === "roomSelect" && <RoomPickerModal rooms={roomLayers} onChoose={chooseRoom} />}
    </div>
  );
}

export default OfficeMap;
