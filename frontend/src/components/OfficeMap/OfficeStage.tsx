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
import type { SeatTarget } from "../../data/emptySeats";
import { DOOR_ANIM_MS, DOOR_SLIDE_DIRECTION } from "../../data/officeDoors";
import { backrestCropLayerId } from "../../data/backSitOccupancy";
import { getBackrestCropFraction } from "../../data/chairBackrestCrop";
import { createDepthCompare } from "./depthSort";
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
  // Door art layer ids currently slid open (see officeDoors.ts). Layers not
  // present here render at rest (translateX(0)/no override) — omitting the
  // prop entirely means "no doors open," matching existing callers/tests
  // that don't pass it.
  openDoorLayerIds?: Set<string>;
  // Empty (unoccupied) painted seats to render as clickable "sit here"
  // markers — occupied seats get no marker at all (see emptySeats.ts).
  // Deliberately not passed to the PiP mini-camera OfficeStage instance
  // (OfficeMap.tsx only wires this on the main instance).
  emptySeats?: SeatTarget[];
  onSeatClick?: (seat: SeatTarget, anchor: { clientX: number; clientY: number }) => void;
  // Synthetic backrest-crop layer id (`${furnitureId}-backrest-crop`, see
  // backSitOccupancy.ts's backrestCropLayerId) -> that seat's back-facing
  // occupant's own sprite baseline (position.y + height), for every
  // currently back-sit occupant (see OfficeMap.tsx's
  // computeBackSitOccupantBaselines). OfficeStage generates a synthetic,
  // clip-path-cropped "backrest only" clone of any furniture layer whose id
  // has an entry here (once suffixed) and lets depthSort force THAT clone
  // (not the original chair layer) to render in front of its occupant —
  // see depthSort.ts's sortKey doc comment and chairBackrestCrop.ts for the
  // full reasoning. Omitted/undefined = existing always-behind behavior for
  // every seat, unchanged (matches every existing caller/test that doesn't
  // pass this prop).
  backSitOccupantBaselines?: Record<string, number>;
};

// Shared click-vs-drag threshold logic: only fires onClick when pointer
// movement between down/up stays under 6px (otherwise treated as a drag/pan).
// Generic over the clicked item so it can drive both character/room layer
// clicks (AssetLayer) and empty-seat marker clicks (SeatTarget).
function useClickVsDrag<T>(
  onClick: ((item: T, anchor: { clientX: number; clientY: number }) => void) | undefined,
) {
  const downRef = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      downRef.current = { x: e.clientX, y: e.clientY };
    },
    onPointerUp: (item: T, e: React.PointerEvent) => {
      const d = downRef.current;
      if (d) {
        const dist = Math.hypot(e.clientX - d.x, e.clientY - d.y);
        if (dist < 6) {
          e.stopPropagation();
          onClick?.(item, { clientX: e.clientX, clientY: e.clientY });
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
  openDoorLayerIds,
  emptySeats,
  onSeatClick,
  backSitOccupantBaselines,
}: OfficeStageProps = {}) {
  const characterClick = useClickVsDrag<AssetLayer>(onCharacterClick);
  const roomClick = useClickVsDrag<AssetLayer>(onRoomClick);
  const seatClick = useClickVsDrag<SeatTarget>(onSeatClick);

  // Resolve live character positions (e.g. bon's walking override) BEFORE
  // sorting, so depth ordering reflects true current feet-Y each render.
  const resolved = officeAssetLayers
    .filter((l) => !(l.kind === "character" && hiddenCharacterIds?.includes(l.id)))
    .concat(extraCharacterLayers ?? [])
    .map((l) => {
      const ov = l.kind === "character" ? characterOverrides?.[l.id] : undefined;
      return ov ? { ...l, x: ov.x, y: ov.y } : l;
    });
  // Synthetic backrest-crop layers: for every furniture layer currently
  // back-sit-occupied (its id, once suffixed, is a key in
  // backSitOccupantBaselines — see backSitOccupancy.ts/OfficeMap.tsx), clone
  // it into a new layer sharing the same path/position/size/imgCrop (so it
  // renders identically, and still qualifies for depthSort's isSeat() path-
  // match), but flagged with frontClipBottomPct so only its top "backrest"
  // portion is visible (clip-path applied below at render time). The clone's
  // id gets the -backrest-crop suffix, which is exactly what
  // backSitOccupantBaselines is keyed by, so ONLY this synthetic layer (never
  // the original chair layer, whose id has no such suffix) picks up the
  // front-of-occupant sort-key override in depthSort.ts. Not generated for
  // any other seat (unoccupied, or occupied but facing front/left/right) —
  // gated purely on presence in the map, which backSitOccupancy.ts already
  // restricts to real back-sit occupants.
  const backrestCropLayers: AssetLayer[] = [];
  if (backSitOccupantBaselines) {
    for (const layer of resolved) {
      if (layer.kind !== "furniture") continue;
      const cropId = backrestCropLayerId(layer.id);
      if (backSitOccupantBaselines[cropId] === undefined) continue;
      backrestCropLayers.push({
        ...layer,
        id: cropId,
        frontClipBottomPct: getBackrestCropFraction(layer.path),
      });
    }
  }
  const withBackrestCrops = backrestCropLayers.length
    ? resolved.concat(backrestCropLayers)
    : resolved;
  const sorted = withBackrestCrops.slice().sort(createDepthCompare(backSitOccupantBaselines));

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
            {...(isRoomClickable ? { "data-room-id": layer.id } : {})}
            style={{
              left: `${(layer.x / FRAME_WIDTH) * 100}%`,
              top: `${(layer.y / FRAME_HEIGHT) * 100}%`,
              width: `${(layer.width / FRAME_WIDTH) * 100}%`,
              height: `${(layer.height / FRAME_HEIGHT) * 100}%`,
              ...(layer.transform ? { transform: layer.transform } : {}),
              // Synthetic backrest-crop layer only (see frontClipBottomPct's
              // doc comment in types/office.ts): clip the WRAPPER div itself
              // (not the img inside it) to only its top frontClipBottomPct
              // fraction, showing just the backrest/headrest portion. Never
              // resizes the div (would rescale the imgCrop %-based math
              // below), just visually clips it — same box, same img
              // position, less of it drawn.
              ...(layer.frontClipBottomPct !== undefined
                ? { clipPath: `inset(0 0 ${(1 - layer.frontClipBottomPct) * 100}% 0)` }
                : {}),
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
              style={(() => {
                const cropStyle: React.CSSProperties | undefined = layer.imgCrop
                  ? {
                      position: "absolute",
                      width: `${layer.imgCrop.wPct}%`,
                      height: `${layer.imgCrop.hPct}%`,
                      left: `${layer.imgCrop.leftPct}%`,
                      top: `${layer.imgCrop.topPct}%`,
                      maxWidth: "none",
                    }
                  : undefined;
                const slideDir = DOOR_SLIDE_DIRECTION[layer.id];
                if (!slideDir) return cropStyle;
                const isOpen = openDoorLayerIds?.has(layer.id) ?? false;
                return {
                  ...cropStyle,
                  transition: `transform ${DOOR_ANIM_MS}ms ease-in-out`,
                  transform: isOpen
                    ? slideDir === "left"
                      ? "translateX(-100%)"
                      : "translateX(100%)"
                    : "translateX(0)",
                };
              })()}
            />
          </div>
        );
      })}
      {emptySeats?.map((seat) => {
        // Fixed on-screen marker footprint (world px, before %-conversion) —
        // seat centroids have no inherent size of their own (they're a
        // point), so this is just big enough to be an easy click target
        // without visually dwarfing the chair art underneath it.
        const size = 28;
        return (
          <div
            key={seat.key}
            className={styles.emptySeatMarker}
            style={{
              left: `${((seat.x - size / 2) / FRAME_WIDTH) * 100}%`,
              top: `${((seat.y - size / 2) / FRAME_HEIGHT) * 100}%`,
              width: `${(size / FRAME_WIDTH) * 100}%`,
              height: `${(size / FRAME_HEIGHT) * 100}%`,
            }}
            onPointerDown={seatClick.onPointerDown}
            onPointerUp={(e) => seatClick.onPointerUp(seat, e)}
          />
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
