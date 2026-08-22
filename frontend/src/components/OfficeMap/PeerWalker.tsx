import { useEffect } from "react";
import { useCharacterWalk } from "./useCharacterWalk";
import { characterSprite } from "../../data/bonWalkFrames";
import type { AvatarSpriteSet } from "../../services/avatar/types";

type Pt = { x: number; y: number };
export type PeerWalkerRenderState = { pos: Pt; src: string };

type Props = {
  layerId: string; // peer's lowercased email — matches roster AssetLayer.id
  from: Pt;
  path: Pt[];
  startNonce: number;
  arrivedAt: Pt | null;
  arrivedNonce: number;
  spriteSet: AvatarSpriteSet | null; // resolved by caller; null means position-only (no walk-frame animation)
  staticSrc: string; // peer's existing static roster portrait src, used when spriteSet is null
  onUpdate: (layerId: string, state: PeerWalkerRenderState) => void;
};

// Headless per-peer walk agent, mirroring SavedAvatarWalker.tsx's pattern
// exactly: one useCharacterWalk instance per peer, rendered dynamically from
// OfficeMap (see the peerWalks.map() there) so a dynamic number of peers can
// each own their own hook instance without violating React's "no hooks in a
// loop" rule. Renders no DOM — reports state up to OfficeMap via `onUpdate`
// (merged into characterOverrides/characterSrcOverrides).
//
// Peers with no known sprite set (most roster people — no EMAIL_TO_AVATAR_ID
// entry, or an id with no SPRITE_SET_BY_AVATAR_ID mapping) move position-only
// with their existing static portrait (staticSrc); peers mapped to a known
// sprite set (bon/alex/micah/lui-style pipelines) animate real walk frames.
// This mirrors the existing "sprite set if present, else static" pattern
// OfficeMap.tsx's extraCharacterSrcById already uses for saved avatars.
export function PeerWalker({
  layerId,
  from,
  path,
  startNonce,
  arrivedAt,
  arrivedNonce,
  spriteSet,
  staticSrc,
  onUpdate,
}: Props) {
  const { pos, isWalking, direction, frameIndex, walkTo, resetPos } = useCharacterWalk(from);

  useEffect(() => {
    resetPos(from);
    walkTo(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startNonce]);

  useEffect(() => {
    if (arrivedNonce > 0 && arrivedAt) {
      resetPos(arrivedAt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrivedNonce]);

  useEffect(() => {
    const src = spriteSet
      ? characterSprite(spriteSet, isWalking ? "walk" : "idle", direction, frameIndex)
      : staticSrc;
    onUpdate(layerId, { pos, src });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerId, pos, isWalking, direction, frameIndex, spriteSet, staticSrc]);

  return null;
}

export default PeerWalker;
