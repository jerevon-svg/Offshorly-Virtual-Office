import { useEffect } from "react";
import { useCharacterWalk } from "./useCharacterWalk";
import { characterSprite } from "../../data/bonWalkFrames";
import type { AvatarSpriteSet } from "../../services/avatar/types";

type Pt = { x: number; y: number };

export type SavedAvatarWalkApi = {
  walkTo: (input: Pt | Pt[], onArrive?: () => void) => void;
  playPat: (onDone?: () => void) => void;
};

export type SavedAvatarWalkState = {
  pos: Pt;
  src: string;
};

type Props = {
  // Layer id ("saved-avatar-<avatarId>") — the key everything (menu clicks,
  // characterOverrides/characterSrcOverrides) is keyed on.
  layerId: string;
  initial: Pt;
  spriteSet: AvatarSpriteSet;
  onUpdate: (layerId: string, state: SavedAvatarWalkState) => void;
  registerApi: (layerId: string, api: SavedAvatarWalkApi | null) => void;
};

// Headless per-saved-avatar walk/pat agent — one instance per avatar with a
// populated spriteSet, mounted dynamically from OfficeMap (see
// `avatarsWithSpriteSet` there). Exists purely so each avatar can own its own
// `useCharacterWalk` instance without React's "no hooks in a loop" rule
// getting in the way: OfficeMap can't call useCharacterWalk a dynamic number
// of times directly, but it CAN render a dynamic number of these components,
// each of which calls the hook exactly once. Renders no DOM — reports state
// up to OfficeMap via `onUpdate` (merged into characterOverrides/
// characterSrcOverrides) and exposes its walkTo/playPat via `registerApi`
// (looked up by runWalkDemo/runPatDemo, the same "Walk demo"/"Pat demo"
// action-menu items alex/micah already use).
export function SavedAvatarWalker({ layerId, initial, spriteSet, onUpdate, registerApi }: Props) {
  const { pos, isWalking, isPatting, direction, frameIndex, walkTo, playPat } = useCharacterWalk(initial);

  useEffect(() => {
    registerApi(layerId, { walkTo, playPat });
    return () => registerApi(layerId, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerId]);

  useEffect(() => {
    const src = characterSprite(
      spriteSet,
      isPatting ? "pat" : isWalking ? "walk" : "idle",
      direction,
      frameIndex,
    );
    onUpdate(layerId, { pos, src });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerId, pos, isWalking, isPatting, direction, frameIndex, spriteSet]);

  return null;
}

export default SavedAvatarWalker;
