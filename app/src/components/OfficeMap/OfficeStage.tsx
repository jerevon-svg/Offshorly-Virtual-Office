import { useRef } from "react";
import {
  ASSET_PATH_TO_SRC,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  formatCharacterName,
  officeAssetLayers,
} from "../../data/office-layout";
import type { AssetLayer } from "../../types/office";
import type { Phase } from "../../data/officePhase";
import { depthCompare } from "./depthSort";
import { GreetingBubble } from "./GreetingBubble";
import { TalkingBubble } from "./TalkingBubble";
import { OfficePhaseOverlay } from "./OfficePhaseOverlay";
import styles from "./OfficeStage.module.css";

type CharacterOverrides = Record<string, { x: number; y: number }>;

type OfficeStageProps = {
  // Day/night tint — defaults to "day" (near-neutral) so existing callers
  // that don't pass it (e.g. tests) render unaffected.
  phase?: Phase;
  characterOverrides?: CharacterOverrides;
  characterSrcOverrides?: Record<string, string>;
  // Character ids to omit entirely from render (e.g. bon once CHECKED_OUT).
  hiddenCharacterIds?: string[];
  // Additional static-portrait character layers to render alongside the
  // manifest's fixed roster — used for avatars saved via AvatarCreator and
  // positioned in their chosen team room. Each entry's `src` comes from
  // `extraCharacterSrcById` (a data URL / mock preview import), not
  // ASSET_PATH_TO_SRC, since these aren't part of the static asset manifest.
  extraCharacterLayers?: AssetLayer[];
  extraCharacterSrcById?: Record<string, string>;
  onCharacterClick?: (layer: AssetLayer, anchor: { clientX: number; clientY: number }) => void;
  onRoomClick?: (layer: AssetLayer, anchor: { clientX: number; clientY: number }) => void;
  greetingCharacterId?: string | null;
  greetingNonce?: number;
  // Custom greeting text (e.g. onboarding's "Welcome to Offshorly!" instead
  // of the search-locate default "Hi there, I'm {name}!").
  greetingText?: string;
  // Character ids to render a looping "talking" indicator above — fully
  // separate from the greeting system (used by the chat feature).
  talkingCharacterIds?: string[];
  // Text to show inside the talking bubble for a given character id, when
  // that character has recently sent a chat message (falls back to the
  // looping dots when absent).
  talkingTextById?: Record<string, string>;
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
  phase = "day",
  characterOverrides,
  characterSrcOverrides,
  hiddenCharacterIds,
  onCharacterClick,
  onRoomClick,
  greetingCharacterId,
  greetingNonce,
  greetingText,
  extraCharacterLayers,
  extraCharacterSrcById,
  talkingCharacterIds,
  talkingTextById,
}: OfficeStageProps = {}) {
  const characterClick = useClickVsDrag(onCharacterClick);
  const roomClick = useClickVsDrag(onRoomClick);

  // Resolve live character positions (e.g. bon's walking override) BEFORE
  // sorting, so depth ordering reflects true current feet-Y each render.
  const resolved = officeAssetLayers
    .filter((l) => !(l.kind === "character" && hiddenCharacterIds?.includes(l.id)))
    .concat(extraCharacterLayers ?? [])
    .map((l) => {
      const ov = l.kind === "character" ? characterOverrides?.[l.id] : undefined;
      return ov ? { ...l, x: ov.x, y: ov.y } : l;
    });
  const sorted = resolved.slice().sort(depthCompare);

  const resolvedGreetedLayer = greetingCharacterId
    ? resolved.find((l) => l.id === greetingCharacterId)
    : undefined;

  return (
    <div
      className={styles.stage}
      style={{
        width: FRAME_WIDTH,
        aspectRatio: `${FRAME_WIDTH} / ${FRAME_HEIGHT}`,
      }}
    >
      {sorted.map((layer) => {
        const isChar = layer.kind === "character";
        const srcOverride = isChar
          ? (characterSrcOverrides?.[layer.id] ?? extraCharacterSrcById?.[layer.id])
          : undefined;
        const src = srcOverride ?? ASSET_PATH_TO_SRC[layer.path];

        if (layer.kind === "floor") {
          return (
            <div key={layer.id} className={styles.floor}>
              <img src={src} alt="" />
            </div>
          );
        }

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
              left: `${(layer.x / FRAME_WIDTH) * 100}%`,
              top: `${(layer.y / FRAME_HEIGHT) * 100}%`,
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
            <img
              src={src}
              alt=""
              style={
                layer.imgCrop
                  ? {
                      position: "absolute",
                      width: `${layer.imgCrop.wPct}%`,
                      height: `${layer.imgCrop.hPct}%`,
                      left: `${layer.imgCrop.leftPct}%`,
                      top: `${layer.imgCrop.topPct}%`,
                      maxWidth: "none",
                    }
                  : undefined
              }
            />
          </div>
        );
      })}
      {resolvedGreetedLayer && (
        <GreetingBubble
          key={greetingNonce}
          layer={resolvedGreetedLayer}
          text={greetingText ?? `Hi there, I'm ${formatCharacterName(resolvedGreetedLayer)}!`}
        />
      )}
      {talkingCharacterIds?.map((id, index) => {
        const layer = resolved.find((l) => l.id === id);
        if (!layer) return null;
        // Participants standing close together (e.g. bon walked up next to
        // the peer for chat) can land almost-identical bubble anchors —
        // nudge each participant's bubble to its own side so overlapping
        // text stays readable instead of garbling together.
        const sideOffset =
          talkingCharacterIds.length > 1 ? (index - (talkingCharacterIds.length - 1) / 2) * 130 : 0;
        return (
          <TalkingBubble key={id} layer={layer} text={talkingTextById?.[id]} sideOffset={sideOffset} />
        );
      })}
      <OfficePhaseOverlay phase={phase} />
    </div>
  );
}

export default OfficeStage;
