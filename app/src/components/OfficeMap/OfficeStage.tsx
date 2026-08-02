import { useRef } from "react";
import {
  ASSET_PATH_TO_SRC,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  formatCharacterName,
  officeAssetLayers,
} from "../../data/office-layout";
import type { AssetLayer } from "../../types/office";
import { GreetingBubble } from "./GreetingBubble";
import styles from "./OfficeStage.module.css";

// Render order: floor first (base), then room/decor images, then character
// images last so characters always sit above their room.
const KIND_ORDER: Record<AssetLayer["kind"], number> = {
  floor: 0,
  room: 1,
  decor: 1,
  character: 2,
};

const sortedLayers = [...officeAssetLayers].sort(
  (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
);

type CharacterOverrides = Record<string, { x: number; y: number }>;

type OfficeStageProps = {
  characterOverrides?: CharacterOverrides;
  characterSrcOverrides?: Record<string, string>;
  onCharacterClick?: (layer: AssetLayer, anchor: { clientX: number; clientY: number }) => void;
  onRoomClick?: (layer: AssetLayer, anchor: { clientX: number; clientY: number }) => void;
  greetingCharacterId?: string | null;
  greetingNonce?: number;
};

// Shared click-vs-drag threshold logic: only fires onClick when pointer
// movement between down/up stays under 6px (otherwise treated as a drag/pan).
function useClickVsDrag(
  onClick: ((layer: AssetLayer, anchor: { clientX: number; clientY: number }) => void) | undefined,
) {
  const downRef = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      downRef.current = { x: e.clientX, y: e.clientY };
    },
    onPointerUp: (layer: AssetLayer, e: React.PointerEvent) => {
      const d = downRef.current;
      if (d) {
        const dist = Math.hypot(e.clientX - d.x, e.clientY - d.y);
        if (dist < 6) {
          e.stopPropagation();
          onClick?.(layer, { clientX: e.clientX, clientY: e.clientY });
        }
      }
      downRef.current = null;
    },
  };
}

export function OfficeStage({
  characterOverrides,
  characterSrcOverrides,
  onCharacterClick,
  onRoomClick,
  greetingCharacterId,
  greetingNonce,
}: OfficeStageProps = {}) {
  const characterClick = useClickVsDrag(onCharacterClick);
  const roomClick = useClickVsDrag(onRoomClick);

  const greetedLayer = greetingCharacterId
    ? sortedLayers.find((l) => l.id === greetingCharacterId)
    : undefined;
  const greetedOverride = greetedLayer ? characterOverrides?.[greetedLayer.id] : undefined;
  const resolvedGreetedLayer =
    greetedLayer && greetedOverride
      ? { ...greetedLayer, x: greetedOverride.x, y: greetedOverride.y }
      : greetedLayer;

  return (
    <div
      className={styles.stage}
      style={{
        width: FRAME_WIDTH,
        aspectRatio: `${FRAME_WIDTH} / ${FRAME_HEIGHT}`,
      }}
    >
      {sortedLayers.map((layer) => {
        const isChar = layer.kind === "character";
        const srcOverride = isChar ? characterSrcOverrides?.[layer.id] : undefined;
        const src = srcOverride ?? ASSET_PATH_TO_SRC[layer.path];

        if (layer.kind === "floor") {
          return (
            <div key={layer.id} className={styles.floor}>
              <img src={src} alt="" />
            </div>
          );
        }

        const ov = isChar ? characterOverrides?.[layer.id] : undefined;
        const x = ov?.x ?? layer.x;
        const y = ov?.y ?? layer.y;
        const isClickable = isChar && layer.id !== "bon";
        const isRoomClickable = layer.kind === "room";

        const className = [styles.layer, isClickable ? styles.characterLayer : ""]
          .filter(Boolean)
          .join(" ");

        return (
          <div
            key={layer.id}
            className={className}
            style={{
              left: `${(x / FRAME_WIDTH) * 100}%`,
              top: `${(y / FRAME_HEIGHT) * 100}%`,
              width: `${(layer.width / FRAME_WIDTH) * 100}%`,
              height: `${(layer.height / FRAME_HEIGHT) * 100}%`,
              ...(layer.transform ? { transform: layer.transform } : {}),
              ...(layer.blendMode
                ? { mixBlendMode: layer.blendMode as React.CSSProperties["mixBlendMode"] }
                : {}),
            }}
            {...(isClickable
              ? {
                  onPointerDown: characterClick.onPointerDown,
                  onPointerUp: (e: React.PointerEvent) => characterClick.onPointerUp(layer, e),
                }
              : isRoomClickable
                ? {
                    onPointerDown: roomClick.onPointerDown,
                    onPointerUp: (e: React.PointerEvent) => roomClick.onPointerUp(layer, e),
                  }
                : {})}
          >
            <img src={src} alt="" />
          </div>
        );
      })}
      {resolvedGreetedLayer && (
        <GreetingBubble
          key={greetingNonce}
          layer={resolvedGreetedLayer}
          text={`Hi there, I'm ${formatCharacterName(resolvedGreetedLayer)}!`}
        />
      )}
    </div>
  );
}

export default OfficeStage;
