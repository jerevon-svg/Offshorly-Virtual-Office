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
  roomContainingPoint,
  roomMembersById,
} from "../../data/office-layout";
import { findPath, roomOf } from "../../data/officePathfinding";
import type { AssetLayer } from "../../types/office";
import { OfficeStage } from "./OfficeStage";
import { CharacterSearch } from "./CharacterSearch";
import { CharacterActionMenu } from "./CharacterActionMenu";
import { RoomSidebar } from "./RoomSidebar";
import {
  computeCenterTransform,
  computeRoomFocusTransform,
  SIDEBAR_WIDTH,
} from "./panMath";
import { useCharacterWalk } from "./useCharacterWalk";
import { bonSprite } from "../../data/bonWalkFrames";
import styles from "./OfficeMap.module.css";

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
  const [greeting, setGreeting] = useState<{ characterId: string; nonce: number } | null>(null);
  const greetTimerRef = useRef<number | undefined>(undefined);
  const greetNonceRef = useRef(0);
  const charMenuTimerRef = useRef<number | undefined>(undefined);

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

  function resetToInitialView() {
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
    ref.setTransform(x, y, initialScale, 400, "easeOut");
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
              setMenu(null);
              const side = layer.x + layer.width / 2 > FRAME_WIDTH / 2 ? "left" : "right";
              focusRoom(layer, side);
              setRoomSidebar({ layer, side });
            }}
            greetingCharacterId={greeting?.characterId ?? null}
            greetingNonce={greeting?.nonce}
          />
        </TransformComponent>
      </TransformWrapper>
      <CharacterSearch
        transformRef={transformRef}
        targetScale={maxScale}
        onLocate={(layer) => {
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
    </div>
  );
}

export default OfficeMap;
