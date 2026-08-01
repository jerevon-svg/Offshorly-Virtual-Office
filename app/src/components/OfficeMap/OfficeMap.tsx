import { useRef, useState } from "react";
import {
  TransformWrapper,
  TransformComponent,
  type ReactZoomPanPinchRef,
} from "react-zoom-pan-pinch";
import { FRAME_HEIGHT, FRAME_WIDTH, bonLayer, formatCharacterName } from "../../data/office-layout";
import { findPath, roomOf } from "../../data/officePathfinding";
import type { AssetLayer } from "../../types/office";
import { OfficeStage } from "./OfficeStage";
import { CharacterSearch } from "./CharacterSearch";
import { CharacterActionMenu } from "./CharacterActionMenu";
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
  const [toast, setToast] = useState<string | null>(null);
  const { pos: bonPos, isWalking, isPatting, direction, frameIndex, walkTo, playPat } = useCharacterWalk({
    x: bonLayer.x,
    y: bonLayer.y,
  });
  const bonSpriteSrc = bonSprite(isPatting ? "pat" : isWalking ? "walk" : "idle", direction, frameIndex);

  function handleChoose(action: "chat" | "call" | "pat") {
    if (!menu) return;
    const target = menu.layer;
    const name = formatCharacterName(target);
    setMenu(null);
    if (action === "pat") {
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
      walkTo(path, () => {
        playPat();
      });
    } else {
      setToast(action === "chat" ? `Chat with ${name} — coming soon` : `Calling ${name}… — coming soon`);
      setTimeout(() => setToast(null), 1800);
    }
  }

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
        }}
        onPanningStop={() => setIsDragging(false)}
      >
        <TransformComponent
          wrapperStyle={{ width: "100%", height: "100%" }}
        >
          <OfficeStage
            characterOverrides={{ bon: bonPos }}
            characterSrcOverrides={{ bon: bonSpriteSrc }}
            onCharacterClick={(layer, anchor) => setMenu({ layer, ...anchor })}
          />
        </TransformComponent>
      </TransformWrapper>
      <CharacterSearch transformRef={transformRef} targetScale={maxScale} />
      {menu && (
        <CharacterActionMenu
          layer={menu.layer}
          anchor={menu}
          onChoose={handleChoose}
          onClose={() => setMenu(null)}
        />
      )}
      {toast && <div className={styles.toast}>{toast}</div>}
    </div>
  );
}

export default OfficeMap;
